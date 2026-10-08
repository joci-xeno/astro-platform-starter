// Research Ledger as hosted by the runtime (typed tools, agent role) and the Control Center (owner role, token-protected, resolves contradictions).
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

const AGENT = { actor: { type: "AGENT", id: "S2" } }, RENT = "The monthly rent for the Maple Street warehouse is 4200 dollars payable on the first business day.";
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const call = (port, token, method, p, body) => new Promise((res, rej) => { const data = body ? JSON.stringify(body) : null; const q = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host: "127.0.0.1:" + port, "x-atlasz-token": token, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => { let j = null; try { j = JSON.parse(b); } catch { /* not json */ } res({ status: r.statusCode, body: j }); }); }); q.on("error", rej); if (data) q.write(data); q.end(); });

test("hosted: an agent runs the whole research loop through typed tools; its own claims are never self-verified; owner-only projects and contradiction resolution are out of its reach", async () => {
  const dir = tmp("rlh-");
  try {
    const rt = createRuntime({ dataDir: dir, retryBaseMs: 0, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" }) });
    const inv = (n, a) => rt.tools.invoke(n, a, AGENT);
    const names = rt.tools.describe().map(t => t.name); for (const n of ["research.open_question", "research.add_source", "research.add_finding", "research.attach_evidence", "research.declare_contradiction", "research.report", "research.unresolved"]) assert.ok(names.includes(n), n);
    assert.ok(!names.some(n => /(^|\.)resolve/.test(n)), "no tool can resolve a contradiction");
    const p = rt.knowledge.create({ tenantId: "JOCI", name: "Warehouse", allowedRoles: ["OWNER", "AGENT"] }), priv = rt.knowledge.create({ tenantId: "JOCI", name: "Owner only" });
    assert.equal((await inv("research.open_question", { projectId: priv.id, text: "x?" })).status, "HANDLER_ERROR");
    const q = (await inv("research.open_question", { projectId: p.id, text: "Monthly rent?" })).result;
    assert.equal((await inv("research.add_source", { projectId: p.id, url: "https://example.org/a", retrievedAt: new Date().toISOString(), title: "Listing", text: RENT })).status, "OK");
    const f = (await inv("research.add_finding", { questionId: q.id, claim: "monthly rent Maple Street warehouse 4200 dollars" })).result; assert.equal(f.createdBy, "AGENT");
    let r = (await inv("research.report", { questionId: q.id })).result; assert.equal(r.verifiedFacts.length, 0); assert.equal(r.unsupported.length, 1);        // an agent's claim is not a fact
    const cite = rt.knowledge.search(p.id, { query: "monthly rent", tenantId: "JOCI", role: "AGENT", forAgent: true }).results[0].citation;
    assert.equal((await inv("research.attach_evidence", { findingId: f.id, citation: cite })).status, "OK");
    r = (await inv("research.report", { questionId: q.id })).result; assert.equal(r.state, "ANSWERED"); assert.equal(r.verifiedFacts[0].confidence, "MEDIUM");
    assert.equal((await inv("research.attach_evidence", { findingId: f.id, citation: { ...cite, quote: "forged" } })).status, "HANDLER_ERROR");
    assert.equal((await inv("research.add_finding", { questionId: q.id, claim: "x", tenantId: "OTHER" })).status, "INVALID_ARGUMENTS");
    assert.equal((await inv("research.unresolved", {})).result.questions.length, 0);
    assert.equal(rt.dashboard().research.questions, 1); assert.equal(rt.dashboard().research.chain.ok, true);
    assert.equal(rt.research.summary({ tenantId: "JOCI", role: "OWNER" }).events, 4);
    rt.stop?.();
  } finally { rm(dir); }
});

test("Control Center: research view/actions are token-protected; owner resolves a contradiction; bad input is 400; unreadable store reported and not replaced", async () => {
  const base = tmp("rlc-"), cc = createControlCenterServer({ stateDir: path.join(base, "s"), configDir: path.join(base, "c"), port: await freePort() });
  const { port, token } = await cc.listen();
  const post = (b) => call(port, token, "POST", "/api/research/action", b), kp = b => call(port, token, "POST", "/api/knowledge/action", b);
  try {
    assert.equal((await call(port, "wrong", "GET", "/api/research")).status, 401); assert.equal((await call(port, "wrong", "POST", "/api/research/action", { op: "openQuestion" })).status, 401);
    const pid = (await kp({ op: "create", name: "R" })).body.result.id;
    const qid = (await post({ op: "openQuestion", projectId: pid, text: "Rent?" })).body.result.id;
    await post({ op: "addSource", projectId: pid, url: "https://example.org/a", retrievedAt: new Date().toISOString(), title: "A", text: RENT });
    await post({ op: "addSource", projectId: pid, url: "https://example.org/b", retrievedAt: new Date().toISOString(), title: "B", text: "A second listing says the monthly rent for the Maple Street warehouse is 4800 dollars." });
    const hit = async t => (await kp({ op: "search", projectId: pid, query: "monthly rent Maple Street warehouse" })).body.result.results.find(x => x.text.includes(t)).citation;
    const fa = (await post({ op: "addFinding", questionId: qid, claim: "monthly rent Maple Street warehouse 4200 dollars" })).body.result, fb = (await post({ op: "addFinding", questionId: qid, claim: "monthly rent Maple Street warehouse 4800 dollars" })).body.result;
    assert.equal((await post({ op: "attachEvidence", findingId: fa.id, citation: await hit("4200") })).status, 200); assert.equal((await post({ op: "attachEvidence", findingId: fb.id, citation: await hit("4800") })).status, 200);
    const k = (await post({ op: "declareContradiction", a: fa.id, b: fb.id, note: "listings differ" })).body.result;
    let v = (await call(port, token, "GET", "/api/research")).body; assert.equal(v.state, "CONNECTED"); assert.equal(v.questions[0].state, "CONTESTED"); assert.equal(v.questions[0].verifiedFacts.length, 0); assert.equal(v.summary.unresolved, 1);
    assert.equal((await post({ op: "resolveContradiction", id: k.id, winner: fa.id, note: "" })).status, 400);                    // note required
    assert.equal((await post({ op: "resolveContradiction", id: k.id, winner: fa.id, note: "Lease says 4200" })).status, 200);
    v = (await call(port, token, "GET", "/api/research")).body; assert.equal(v.questions[0].state, "ANSWERED"); assert.equal(v.questions[0].rejected[0].id, fb.id); assert.equal(v.summary.chain.ok, true);
    assert.ok(v.events.some(e => e.type === "CONTRADICTION_RESOLVED" && e.by === "OWNER"));
    assert.equal((await post({ op: "wipe" })).status, 400); assert.equal((await post({ op: "openQuestion", projectId: "kp-nope", text: "x" })).status, 400);
    const f = path.join(base, "s", "research", "ledger.json"); fs.writeFileSync(f, "{x");
    assert.equal((await call(port, token, "GET", "/api/research")).body.state, "UNREADABLE"); assert.equal(fs.readFileSync(f, "utf8"), "{x");
  } finally { await cc.close?.(); rm(base); }
});
