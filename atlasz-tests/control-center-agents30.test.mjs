// Control Center 30-agent workforce (Phase 5): real HTTP, real registry/coordinator/ledger, real approvals store. Agents are never LIVE by registration; no revenue is invented.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";

const PW = "correct horse battery";
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const raw = (port, p, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => { const q = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); }); q.on("error", reject); if (body) q.write(body); q.end(); });
const mk = async (base, stateDir, configDir) => {
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort() }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const c = { token, get: async (p, t = token) => raw(port, p, { headers: { ...H, ...(t ? { "x-atlasz-token": t } : {}) } }), post: (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) }), stop: async () => { await cc.close?.(); } };
  c.view = async () => JSON.parse((await c.get("/api/agents30")).body);
  c.act = async b => { const r = await c.post("/api/agents30/action", b); return { status: r.status, ...JSON.parse(r.body) }; };
  return c;
};
test("30-agent panel over HTTP: exactly 30, none working by registration; workflows A-E end to end; approvals requested not granted; restart keeps identities and history", async () => {
  const base = tmp("cc30-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  let c = await mk(base, stateDir, configDir);
  try {
    assert.equal((await c.get("/api/agents30", null)).status, 401); assert.equal((await c.post("/api/agents30/action", { op: "verify" }, null)).status, 401);
    let v = await c.view(); assert.equal(v.state, "CONNECTED"); assert.equal(v.agents.length, 30); assert.equal(v.registry.search, 5); assert.equal(v.registry.execution, 25);
    assert.ok(v.agents.every(a => a.state === "NO_ACTIVITY_YET" && a.currentTask === null)); assert.equal(v.system.verifiedRevenue.verifiedReceivedUsd, 0);
    assert.equal(v.dependencies.find(d => d.name === "Neural embedding model").state, "BLOCKED");
    const d = await c.act({ op: "discover", agentId: "SEARCH-1", input: { title: "Price list conversion", sourceType: "OWNER_PROVIDED", sourceRef: "owner-note", sourceExcerpt: "A small firm needs CSV price lists converted to JSON.", estimatedValueUsd: 300, winProbability: 0.5, estimatedHours: 4, daysToCash: 10, requiredSkills: ["data.csv_to_json"] } });
    assert.equal(d.result.ok, true, JSON.stringify(d)); const chk = await c.act({ op: "check", taskId: d.result.taskId }); assert.equal(chk.result.decision, "ACCEPT"); assert.notEqual(chk.result.checker, chk.result.maker);
    v = await c.view(); const oppId = v.system.pipeline[0].id; assert.equal(v.system.pipeline[0].status, "VERIFIED_QUALIFIED");
    const pl = await c.act({ op: "plan", opportunityId: oppId }); assert.equal(pl.result.ok, true, JSON.stringify(pl));
    assert.equal(pl.result.plan.requiredApprovals.length, 3); const ap = JSON.parse((await c.get("/api/approvals")).body);
    assert.ok(JSON.stringify(ap).includes("EXTERNAL_COMMUNICATION") && !JSON.stringify(ap).includes('"status":"APPROVED"'));
    const ex = await c.act({ op: "execute", agentId: "EXECUTION-2", executor: "csv_to_json", input: { csv: "a,b\n1,2\n" } }); assert.equal(ex.result.ok, true, JSON.stringify(ex));
    v = await c.view(); assert.equal(v.system.queues.awaitingCheck, 1); assert.equal(v.agents.find(a => a.id === "EXECUTION-2").state, "WAITING");
    assert.equal((await c.act({ op: "check", taskId: ex.result.taskId })).result.decision, "ACCEPT");
    assert.equal((await c.act({ op: "outcome", taskId: ex.result.taskId, revenue: { amountUsd: 50, stage: "PAID", confirmedReceived: false } })).result.ok, false);
    assert.equal((await c.view()).system.verifiedRevenue.verifiedReceivedUsd, 0);
    assert.equal((await c.act({ op: "pause", agentId: "EXECUTION-5" })).result.ok, true);
    assert.equal((await c.act({ op: "setLimits", agentId: "EXECUTION-5", limits: { maxCostUsdPerDay: 5 } })).result.ok, false, "raising a cost limit needs a signed owner approval");
    assert.equal((await c.act({ op: "execute", agentId: "EXECUTION-5", executor: "csv_to_json", input: { csv: "a\n1\n" } })).result.reason, "AGENT_NOT_USABLE");
    await c.stop(); c = await mk(base, stateDir, configDir);
    v = await c.view(); assert.equal(v.agents.length, 30); assert.equal(v.agents.find(a => a.id === "EXECUTION-5").state, "PAUSED"); assert.equal(v.agents.find(a => a.id === "EXECUTION-2").history.verified, 1);
    assert.equal(v.system.pipeline.length, 1); assert.equal(v.system.integrity.registry, true); assert.equal(v.system.integrity.events, true);
    assert.equal((await c.act({ op: "nope" })).status, 400);
  } finally { await c.stop(); rm(base); }
});
