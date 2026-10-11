// Master Coordinator over real HTTP: starts with the Control Center (automatic supervision), exposes live manager probes, queue + owner controls, refuses unauthenticated calls.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { tmp } from "./helpers.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const raw = (port, p, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => { const q = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); }); q.on("error", reject); if (body) q.write(body); q.end(); });
const mk = async (stateDir, configDir, extra = {}) => {
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort(), ...extra }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const c = { cc, get: (p, t = token) => raw(port, p, { headers: { ...H, ...(t ? { "x-atlasz-token": t } : {}) } }), post: (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) }) };
  c.view = async () => JSON.parse((await c.get("/api/agents30")).body);
  c.act = async b => { const r = await c.post("/api/agents30/action", b); return { status: r.status, ...JSON.parse(r.body) }; };
  return c;
};

test("Master over HTTP: auth required; 15 managers with honest live status; automatic supervision starts without a click; queue + owner controls", async () => {
  const base = tmp("ccm-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const c = await mk(stateDir, configDir, { masterTickMs: 1000 });
  try {
    assert.equal((await c.post("/api/agents30/action", { op: "masterSupervise" }, null)).status, 401);
    const v0 = await c.view(); assert.equal(v0.state, "CONNECTED"); assert.ok(v0.master, "view carries the Master block");
    // automatic start: the timer in the server runs a supervision pass with nobody clicking
    for (let i = 0; i < 40 && !((await c.act({ op: "masterStatus" })).result?.supervisions >= 1); i++) await new Promise(r => setTimeout(r, 150));
    const st = (await c.act({ op: "masterStatus" })).result; assert.ok(st.supervisions >= 1, "automatic supervision pass happened: " + st.supervisions);
    const lp = (await c.act({ op: "masterLoopStatus" })).result.loop; assert.equal(lp.state, "RUNNING"); assert.ok(lp.ticks >= 1 && lp.lastOkAt, JSON.stringify(lp)); assert.equal(st.managers.find(m => m.id === "MASTER_COORDINATOR").data.loop.state, "RUNNING");
    assert.equal(st.managers.find(m => m.id === "MASTER_COORDINATOR").data.liveness.state, "ALIVE");
    assert.equal(st.managers.length, 15); assert.equal(st.hierarchy.agents.permanent, 30);
    const by = Object.fromEntries(st.managers.map(m => [m.id, m]));
    // honest status without owner key / backups / running runtime: those are NOT shown as connected
    assert.equal(by.SECURITY_APPROVAL_MANAGER.status, "DEGRADED"); assert.equal(by.RUNTIME_SUPERVISOR.status, "DEGRADED"); assert.equal(by.RECOVERY_MAINTENANCE.status, "DEGRADED");
    assert.equal(by.MASTER_COORDINATOR.status, "CONNECTED"); assert.equal(by.WORKFORCE_MANAGER.status, "CONNECTED"); assert.equal(by.CAMPAIGN_MANAGER.status, "CONNECTED"); assert.equal(by.GLOBAL_BUSINESS_INTELLIGENCE.status, "CONNECTED");
    assert.equal(st.audit.ok, true);
    // queue controls refuse unknown work, and an agent-facing id cannot be invented
    assert.equal((await c.act({ op: "masterEnqueue", planId: "no-such-plan", stepId: "s1" })).result.ok, false);
    assert.equal((await c.act({ op: "masterSuspend", taskId: "no-such-task" })).result.ok, false);
    assert.equal((await c.act({ op: "masterReassign", taskId: "no-such-task", toAgent: "EXECUTION-3" })).result.ok, false);
    const g0 = (await c.act({ op: "gbiReport" })).result, g = g0.report; assert.equal(g0.ok, true); assert.equal(g.claims.proposalsSent, 0); assert.equal(g.financial.verifiedReceivedUsd, 0);
    // the view after those operations still shows exactly 30 agents and the Master queue is empty (nothing invented)
    const v1 = await c.view(); assert.equal(v1.agents.length, 30); assert.equal((v1.master.queue ?? []).length, 0);
  } finally { await c.cc.close(); }
});

test("adversarial HTTP inputs to the Master ops: prototype keys, oversized and typed-wrong fields, unknown ops are refused without changing state", async () => {
  const base = tmp("ccm2-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const c = await mk(stateDir, configDir, { masterTickMs: 0 });
  try {
    const bad = [{ op: "masterEnqueue", planId: "__proto__", stepId: "constructor" }, { op: "masterEnqueue", planId: "x".repeat(100000), stepId: "y", note: "n".repeat(1e6) }, { op: "masterEnqueue", planId: ["a"], stepId: { a: 1 }, priority: "9" },
      { op: "masterSuspend", taskId: "../../etc/passwd" }, { op: "masterReassign", taskId: "constructor", toAgent: "SEARCH-1" }, { op: "masterCancel", jobId: "__proto__" }, { op: "masterDispatch", max: 1e9 }, { op: "masterNoSuchOp" }];
    for (const b of bad) { const r = await c.post("/api/agents30/action", b); assert.ok(r.status < 500, JSON.stringify(b).slice(0, 60) + " -> " + r.status); const j = JSON.parse(r.body); assert.ok(r.status >= 400 || j.result?.ok === false || (j.result?.dispatched ?? []).length === 0, "refused or inert: " + JSON.stringify(b).slice(0, 60)); }
    const v = await c.view(); assert.equal(v.agents.length, 30); assert.equal((v.master.queue ?? []).length, 0);
  } finally { await c.cc.close(); }
});
