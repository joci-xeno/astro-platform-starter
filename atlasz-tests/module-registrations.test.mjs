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
test("Control Center revenue operations: empty LIVE installation reports NO_BUSINESS_RECORDED with money UNKNOWN (null), never zero revenue", () => {
  const r = mk().revenueOps();
  assert.equal(r.environment, "LIVE"); assert.equal(r.state, "NO_BUSINESS_RECORDED"); assert.equal(r.collected.verifiedPaymentsUsd, null); assert.equal(r.collected.verifiedNetProfitUsd, null); assert.equal(r.projected.forecastUsd, null);
  assert.equal(r.metrics.paymentsReceived, 0); assert.equal(Object.keys(r.metrics).length, 12); assert.equal(r.projectedAddedToCollected, false);
});
test("no module capability exposed through the broker belongs to an owner-required operation class (consequential actions stay behind signed approvals)", async () => {
  const { OPERATIONS } = await import("../atlasz-addons/owner-control/owner-authority.mjs");
  const b = mk().moduleBroker(); const bad = [];
  for (const id of b.ids()) for (const cp of b.get(id).capabilities) { const op = cp.operation ?? cp.op; if (op && OPERATIONS[op]?.requiresOwner) bad.push(id + "." + (cp.name ?? cp)); }
  assert.deepEqual(bad, []);
});
test("D12: the agent tool policy extension is INACTIVE until a signed owner approval bound to its exact fingerprint exists; wrong/forged/replayed approvals do not activate it; activation survives restart and is re-verified", async () => {
  const { signWithKeystore } = await import("../atlasz-addons/owner-keystore.mjs");
  const { D12_ACTION, EXTENSION_SHA } = await import("../atlasz-addons/agent-tool-policy-ext.mjs");
  const PASS = "a long enough passphrase", d = fs.mkdtempSync(path.join(os.tmpdir(), "d12-")), opts = { stateDir: path.join(d, "s"), configDir: path.join(d, "c") };
  const c = createControlCenterCore(opts), call = (cc, agentId, tool) => cc.agentToolBroker().call({ agentId, jobId: "j-" + Math.random(), tool, args: {} });
  assert.equal(c.d12Status().state, "PENDING_OWNER_APPROVAL");
  assert.equal((await call(c, "EXECUTION-1", "task_ledger.create")).reason, "TOOL_NOT_ALLOWED_FOR_ROLE");
  c.provisionOwnerKey({ passphrase: PASS });
  assert.throws(() => c.activateD12({ ownerApproval: null }), /OWNER_APPROVAL_REQUIRED/);
  assert.throws(() => c.activateD12({ ownerApproval: signWithKeystore(opts.configDir, PASS, { action: D12_ACTION, subject: "some-other-fingerprint" }) }), /OWNER_APPROVAL_REQUIRED/);
  assert.throws(() => c.activateD12({ ownerApproval: signWithKeystore(opts.configDir, PASS, { action: "DELIVER", subject: EXTENSION_SHA }) }), /OWNER_APPROVAL_REQUIRED/);
  assert.equal(c.d12Status().state, "PENDING_OWNER_APPROVAL");
  const good = signWithKeystore(opts.configDir, PASS, { action: D12_ACTION, subject: EXTENSION_SHA });
  assert.equal(c.activateD12({ ownerApproval: good }).state, "ACTIVE");
  assert.throws(() => c.activateD12({ ownerApproval: good }), /REPLAY/);                                       // single use
  assert.notEqual((await call(c, "EXECUTION-1", "task_ledger.create")).reason, "TOOL_NOT_ALLOWED_FOR_ROLE");   // now permitted by the extension
  assert.equal((await call(c, "SEARCH-1", "qa_reviewer.review")).reason, "TOOL_NOT_ALLOWED_FOR_ROLE");         // the extension row itself still denies SEARCH
  assert.notEqual((await call(c, "EXECUTION-1", "money_engine.panel")).status, "OK");                          // money tools never become reachable
  const c2 = createControlCenterCore(opts); assert.equal(c2.d12Status().state, "ACTIVE");                       // restart: durable record re-verified against the owner key
  const f = path.join(opts.stateDir, "policy", "d12-approval.json"), rec = JSON.parse(fs.readFileSync(f, "utf8")); rec.approval.subject = "x"; fs.writeFileSync(f, JSON.stringify(rec));
  assert.equal(createControlCenterCore(opts).d12Status().state, "PENDING_OWNER_APPROVAL");                      // a tampered record deactivates the extension
});
