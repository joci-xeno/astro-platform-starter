// Knowledge Projects as hosted by the runtime (typed tools, agent permissions) and the Control Center view (owner permissions, token-protected).
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";
const { createRuntime } = await import("../atlasz-runtime/supervisor-safe.mjs");

const LEASE = "The lease for the Maple Street warehouse runs thirty-six months. The monthly rent is 4200 dollars payable on the first business day.";
const AGENT = { actor: { type: "AGENT", id: "E3" } };
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const call = (port, token, method, p, body) => new Promise((res, rej) => { const data = body ? JSON.stringify(body) : null; const q = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host: "127.0.0.1:" + port, "x-atlasz-token": token, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => { let j = null; try { j = JSON.parse(b); } catch { /* not json */ } res({ status: r.statusCode, body: j }); }); }); q.on("error", rej); if (data) q.write(data); q.end(); });
const put = (d, n, c) => { const p = path.join(d, n); fs.writeFileSync(p, c); return p; };

test("hosted: agents reach knowledge only through typed tools, as role AGENT; tenant cannot be injected; SECRET never appears; dashboard reports the method honestly", async () => {
  const dir = tmp("kph-"), src = tmp("kphs-");
  try {
    const rt = createRuntime({ dataDir: dir, retryBaseMs: 0, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" }) });
    const ok = await rt.documents.ingest({ filePath: put(src, "lease.txt", LEASE), tenantId: "JOCI", allowedRoles: ["*"] });
    const sec = await rt.documents.ingest({ filePath: put(src, "keys.txt", "rent portal key sk-" + "q".repeat(30)), tenantId: "JOCI", allowedRoles: ["*"] });
    const priv = await rt.documents.ingest({ filePath: put(src, "owner.txt", "owner only memo about rent strategy"), tenantId: "JOCI" });
    const p = rt.knowledge.create({ tenantId: "JOCI", name: "Warehouse", allowedRoles: ["OWNER", "AGENT"] });
    for (const d of [ok, sec, priv]) rt.knowledge.addDocument(p.id, { tenantId: "JOCI", documentId: d.id });
    const names = rt.tools.describe().map(t => t.name); for (const n of ["kp.list", "kp.search", "kp.answer", "kp.verify"]) assert.ok(names.includes(n), n);
    rt.knowledge.create({ tenantId: "JOCI", name: "Owner only" });                                // allowedRoles defaults to OWNER
    assert.equal((await rt.tools.invoke("kp.list", {}, AGENT)).result.projects.length, 1);        // the agent sees only the project that allows it
    const a = await rt.tools.invoke("kp.answer", { projectId: p.id, query: "monthly rent payable" }, AGENT);
    assert.equal(a.status, "OK"); assert.equal(a.result.answerable, true); assert.match(a.result.passages[0].text, /4200 dollars/);
    assert.equal((await rt.tools.invoke("kp.verify", { citation: a.result.passages[0].citation }, AGENT)).result.status, "OK");
    const all = JSON.stringify((await rt.tools.invoke("kp.search", { projectId: p.id, query: "rent portal key strategy memo" }, AGENT)).result);
    assert.ok(!all.includes("sk-qqqq")); assert.ok(!all.includes("owner only memo"));          // SECRET and owner-only text never reach an agent
    assert.equal((await rt.tools.invoke("kp.answer", { projectId: p.id, query: "rent", tenantId: "OTHER" }, AGENT)).status, "INVALID_ARGUMENTS");     // tenant is not an argument
    assert.equal((await rt.tools.invoke("kp.answer", { projectId: "kp-nope", query: "rent" }, AGENT)).status, "HANDLER_ERROR");
    const dash = rt.dashboard().knowledge; assert.equal(dash.projects, 2); assert.equal(dash.method, "KEYWORD_BM25_NOT_SEMANTIC");
    rt.stop?.();
  } finally { rm(dir); rm(src); }
});

test("Control Center: knowledge view and actions are token-protected, owner can ask/cite, bad input is 400, an unreadable store is reported and not replaced", async () => {
  const base = tmp("kpc-"), cc = createControlCenterServer({ stateDir: path.join(base, "s"), configDir: path.join(base, "c"), port: await freePort() });
  const { port, token } = await cc.listen();
  try {
    assert.equal((await call(port, "wrong", "GET", "/api/knowledge")).status, 401); assert.equal((await call(port, "wrong", "POST", "/api/knowledge/action", { op: "create", name: "x" })).status, 401);
    const c = await call(port, token, "POST", "/api/knowledge/action", { op: "create", name: "Research" }); assert.equal(c.status, 200);
    const pid = c.body.result.id;
    assert.equal((await call(port, token, "POST", "/api/knowledge/action", { op: "addWebSnapshot", projectId: pid, url: "https://example.org/permits", retrievedAt: "2026-10-01T12:00:00Z", title: "Permit rules", text: "A building permit is required for any structure larger than ten square metres." })).status, 200);
    assert.equal((await call(port, token, "POST", "/api/knowledge/action", { op: "addWebSnapshot", projectId: pid, url: "not-a-url", retrievedAt: "x", text: "x" })).status, 400);
    assert.equal((await call(port, token, "POST", "/api/knowledge/action", { op: "wipe" })).status, 400);
    const ask = (await call(port, token, "POST", "/api/knowledge/action", { op: "ask", projectId: pid, query: "building permit structure" })).body.result;
    assert.equal(ask.answerable, true); assert.equal(ask.passages[0].citation.url, "https://example.org/permits");
    assert.equal((await call(port, token, "POST", "/api/knowledge/action", { op: "verify", citation: ask.passages[0].citation })).body.result.status, "OK");
    assert.equal((await call(port, token, "POST", "/api/knowledge/action", { op: "ask", projectId: pid, query: "quantum helicopter zeppelin" })).body.result.answerable, false);
    const v = (await call(port, token, "GET", "/api/knowledge")).body; assert.equal(v.state, "CONNECTED"); assert.equal(v.projects[0].byKind.webpage, 1); assert.equal(v.method, "KEYWORD_BM25_NOT_SEMANTIC");
    const f = path.join(base, "s", "knowledge", "projects.json"); fs.writeFileSync(f, "{x");
    assert.equal((await call(port, token, "GET", "/api/knowledge")).body.state, "UNREADABLE"); assert.equal(fs.readFileSync(f, "utf8"), "{x");
  } finally { await cc.close?.(); rm(base); }
});
