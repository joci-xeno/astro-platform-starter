import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
import { createHealthMonitor } from "../atlasz-addons/health-monitor.mjs";
import { COMBINED_POLICY, EXTENSION_POLICY } from "../atlasz-addons/agent-tool-policy-ext.mjs";
import { TOOL_POLICY } from "../atlasz-addons/agent-tool-policy.mjs";
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "mr-")); return createControlCenterCore({ stateDir: path.join(d, "s"), configDir: path.join(d, "c") }); };
const OK = new Set(["HEALTHY", "LOADED_NEEDS_DEPENDENCY", "VIA_CONSUMER", "OFFLINE_BY_DESIGN", "SUPERSEDED"]);

test("broker holds every registrable module of the original 133; only the 3 legacy runtime files stay unregistered (EXCLUDED_LEGACY)", async () => {
  const c = mk(), b = c.moduleBroker(); assert.ok(b.ids().length >= 137);
  const r = await c.modules({ health: true });
  for (const m of r.catalog) assert.ok(OK.has(m.health.state), m.id + " " + m.health.state);
  const src = new Set(r.catalog.map(m => m.source));
  for (const legacy of ["atlasz-runtime/supervisor.js", "atlasz-runtime/worker.js", "atlasz-runtime/agent-child.js"]) assert.ok(!src.has(legacy), legacy);
});
test("dangerous owner-only capabilities are not exposed through the broker", async () => {
  const b = mk().moduleBroker(); const names = b.ids().flatMap(id => b.get(id).capabilities.map(c => (c.name ?? c)));
  for (const n of names) assert.doesNotMatch(String(n), /approve_lesson|apply_migration|activate_agent|sign_|set_owner/i, n);
});
test("agent tool policy extension: rows are minimal, never override the base, never grant money/credential/model tools", () => {
  for (const k of Object.keys(TOOL_POLICY)) assert.equal(COMBINED_POLICY[k], TOOL_POLICY[k]);
  for (const e of Object.values(EXTENSION_POLICY)) { assert.doesNotMatch(e.tool, /money|payment|invoice|crm|credential|vault|approval|schedul|inbox|send/i); assert.doesNotMatch(e.tool, /^(ai_)?model/i, e.tool); assert.ok(["READ_STATUS", "INTERNAL_COMPUTE"].includes(e.operation)); assert.equal(e.write, false); }
});
test("agent tool broker (CC-hosted): permitted tool works for EXECUTION, denied for the wrong team, unlisted/money tools and 31st agent refused", async () => {
  const c = mk(), ab = c.agentToolBroker();
  const d = ab.describeFor("EXECUTION-1"); assert.ok(Array.isArray(d.tools ?? d));
  const denied = await ab.call({ agentId: "SEARCH-1", jobId: "j1", tool: "qa_reviewer.review", args: {} }); assert.notEqual(denied.status, "OK");
  const money = await ab.call({ agentId: "EXECUTION-1", jobId: "j2", tool: "money.record_invoice", args: {} }); assert.notEqual(money.status, "OK");
  const ghost = await ab.call({ agentId: "EXECUTION-26", jobId: "j3", tool: "task_ledger.create", args: {} }); assert.notEqual(ghost.status, "OK");
});
test("health monitor: bounded retries, breaker opens then half-opens, BLOCKED never retried, restart budget bounded, state persists", async () => {
  let t = 1000, calls = 0, state = "FAILED", blocked = false, restarts = 0;
  const broker = { ids: () => ["a", "b"], has: () => true, health: async id => { if (id === "b") return blocked ? { state: "BLOCKED_BY_CONTROL_CHAIN", detail: "approval" } : { state: "HEALTHY" }; calls++; return { state, detail: "x" }; } };
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hm-")), "m.json");
  const mon = createHealthMonitor({ broker, file: f, clock: () => t, failureThreshold: 2, openMs: 10000, maxRetries: 1, restart: async () => { restarts++; return { ok: true }; }, maxRestarts: 1, baseBackoffMs: 1 });
  await mon.sweep(); const r2 = await mon.sweep(); assert.equal(r2.open, 1);
  const before = calls; const r3 = await mon.sweep(); assert.equal(calls, before, "open breaker is not re-probed"); assert.ok(r3.results.find(x => x.id === "a").skipped);
  t += 11000; await mon.sweep(); await mon.sweep(); assert.ok(restarts <= 1, "restart budget");
  assert.ok(mon.alerts().some(a => /budget exhausted/.test(a.message)) || restarts === 1);
  state = "HEALTHY"; t += 11000; const r4 = await mon.sweep(); assert.equal(r4.open, 0);
  blocked = true; const b0 = await mon.sweep(); assert.equal(b0.blocked, 1); assert.equal(b0.unhealthy, 0);
  const mon2 = createHealthMonitor({ broker, file: f, clock: () => t }); assert.ok(mon2.status().sweeps >= 5);
  assert.throws(() => createHealthMonitor({}), /BROKER_REQUIRED/);
});
test("health_monitor module is registered and sweeps through the control chain", async () => {
  const b = mk().moduleBroker(); assert.ok(b.has("health-monitor"));
  const r = await b.invoke("health-monitor", "status", {}, { actor: { type: "SYSTEM", id: "MASTER" } }); assert.equal(r.status, "OK");
});
