// G12 SSE stream hosted by the real Control Center: token-gated, read-only, redacted, resumable.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";
import { createAuditChain } from "../atlasz-addons/audit-chain.mjs";
import { detectNodeRestrictions } from "../atlasz-addons/restricted-node.mjs";

const PW = "correct horse battery", caps = detectNodeRestrictions(), SK = "s" + "k-ABCDEFGHIJKLMNOPQRSTUV";
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const raw = (port, p, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => { const q = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); }); q.on("error", reject); if (body) q.write(body); q.end(); });
async function boot() {
  const base = tmp("strh-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort() }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const post = (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) });
  const get = (p, t = token) => raw(port, p, { headers: { ...H, ...(t ? { "x-atlasz-token": t } : {}) } });
  const J = r => JSON.parse(r.body), P = async (p, b) => J(await post(p, b)).result, W = async (op, args = {}) => { const r = J(await post("/api/workbench/action", { op, args })); return r.result ?? (r.error !== undefined ? { ok: false, reason: String(r.error) } : r); };
  return { base, configDir, cc, post, get, J, P, W, done: async () => { await cc.close?.(); rm(base); } };
}
function openStream(port, headers, { want = 1, ms = 4000 } = {}) {
  return new Promise(resolve => {
    const q = http.request({ host: "127.0.0.1", port, path: "/api/stream", method: "GET", headers }, res => {
      let d = ""; const done = () => { clearTimeout(tm); q.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: d }); };
      const tm = setTimeout(done, ms); res.on("data", c => { d += c; if ((d.match(/^id: /gm) || []).length >= want) done(); }); res.on("end", () => { clearTimeout(tm); resolve({ status: res.statusCode, headers: res.headers, body: d }); });
    }); q.on("error", () => resolve({ status: 0, body: "" })); q.end();
  });
}
test("HTTP: /api/stream needs the token, rejects foreign hosts and non-GET, streams redacted black-box entries and resumes after Last-Event-ID", async () => {
  const base = tmp("strh-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(path.join(stateDir, "brain"), { recursive: true });
  const chain = createAuditChain({ filePath: path.join(stateDir, "brain", "blackbox.jsonl") });
  chain.append("BB_TOOL_CALL", { tool: "atlasz.queue", note: "key " + SK, password: "hunter2hunter2" }); chain.append("BB_TOOL_RESULT", { ok: true }); chain.append("BB_PROGRESS", { pct: 50 });
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort() }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  try {
    assert.equal((await openStream(port, H)).status, 401); assert.equal((await openStream(port, { ...H, "x-atlasz-token": "wrong" })).status, 401);
    assert.equal((await openStream(port, { host: "evil.example:" + port, "x-atlasz-token": token })).status, 403);
    const post = await raw(port, "/api/stream", { method: "POST", headers: { ...H, "x-atlasz-token": token, "content-type": "application/json" }, body: "{}" }); assert.equal(post.status, 404, "the stream is read-only");
    const ok = await openStream(port, { ...H, "x-atlasz-token": token }, { want: 3 });
    assert.equal(ok.status, 200); assert.match(ok.headers["content-type"], /^text\/event-stream/); assert.equal(ok.headers["cache-control"], "no-store");
    const idsOf = b => [...b.matchAll(/^id: (\d+)$/gm)].map(m => Number(m[1])); assert.deepEqual(idsOf(ok.body), [1, 2, 3]);
    assert.equal(ok.body.includes(SK), false); assert.equal(ok.body.includes("hunter2"), false); assert.ok(ok.body.includes("[REDACTED]"));
    const live = openStream(port, { ...H, "x-atlasz-token": token, "last-event-id": "3" }, { want: 1, ms: 6000 }); await new Promise(r => setTimeout(r, 300)); chain.append("BB_PROGRESS", { pct: 100 });
    const l = await live; assert.deepEqual(idsOf(l.body), [4], "a reconnect resumes after the last seen id and receives only the new entry");
    const flood = await Promise.all(Array.from({ length: 7 }, () => openStream(port, { ...H, "x-atlasz-token": token }, { want: 99, ms: 700 }))); assert.ok(flood.filter(r => r.status === 503).length >= 2, "more than 5 simultaneous streams are refused (503)");
  } finally { await cc.close?.(); rm(base); }
});
