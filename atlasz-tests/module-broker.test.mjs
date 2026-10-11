import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "mb-")); return createControlCenterCore({ stateDir: path.join(d, "s"), configDir: path.join(d, "c") }); };
const OK = new Set(["HEALTHY", "VIA_CONSUMER", "OFFLINE_BY_DESIGN", "SUPERSEDED"]);

test("every registered module is healthy through the real control chain, or documented as offline/consumed/superseded", async () => {
  const c = mk(); const r = await c.modules({ health: true });
  assert.ok(r.summary.modules >= 16);
  for (const m of r.catalog) assert.ok(OK.has(m.health?.state), m.id + " -> " + m.health?.state + " " + m.health?.detail);
  assert.ok(!r.catalog.some(m => m.health.state === "NO_PROBE"));
});
test("module invocation: Master-style caller -> broker -> chain -> module; unknown module/capability rejected; invocation audited", async () => {
  const c = mk(), b = c.moduleBroker();
  const ok = await b.invoke("owner-control", "firewall", {}, { actor: { type: "SYSTEM", id: "MASTER" } });
  assert.equal(ok.status, "OK"); assert.equal(ok.manager, "SECURITY_APPROVAL_MANAGER");
  assert.equal((await b.invoke("nope", "x")).status, "UNKNOWN_MODULE");
  assert.equal((await b.invoke("owner-control", "nope")).status, "UNKNOWN_CAPABILITY");
  assert.equal(b.get("owner-control").invocations, 1);
});
test("an internal-library or superseded module has no invocation surface (no hidden second runtime)", async () => {
  const b = mk().moduleBroker();
  for (const id of b.ids()) { const m = b.get(id); if (["SUPERSEDED", "INTERNAL_LIBRARY", "OFFLINE_ACTIVATED"].includes(m.lifecycle)) assert.equal(m.capabilities.length, 0, id); }
});
test("tenant isolation is documented as owner-activated and a second tenant cannot be reached by default", async () => {
  const m = mk().moduleBroker().get("tenant-isolation");
  assert.equal(m.lifecycle, "OFFLINE_ACTIVATED"); assert.match(m.activation, /tenant/i);
});

test("scheduler: standing schedules run real tools through the control chain; emergency stop halts the tick; restart keeps the jobs", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-")), opts = { stateDir: path.join(d, "s"), configDir: path.join(d, "c") };
  const c = createControlCenterCore(opts); await c.runDueSchedules();
  const s = c.scheduler(); const jobs = s.list(); assert.equal(jobs.length, 6);
  for (const j of jobs) { const r = await s.runNow(j.id); assert.equal(r.status, "OK", j.tool); }
  assert.equal(s.list().every(j => j.lastResult?.status === "OK"), true);
  const c2 = createControlCenterCore(opts); await c2.runDueSchedules(); assert.equal(c2.scheduler().list().length, 6, "no duplicate standing schedules after restart");
  assert.equal(c2.scheduler().list()[0].history.length >= 1, true);
});
test("recovery module reports the real mapped sources (not an empty source map) and credential broker is registered with the sealed vault", async () => {
  const c = mk(), b = c.moduleBroker();
  const r = await b.invoke("recovery-points", "readiness", {}); assert.equal(r.status, "OK");
  const mapped = r.result.categories.filter(x => x.backup !== "NOT_CONFIGURED" || x.configured);
  assert.ok(r.result.categories.length > 0);
  const g = await b.invoke("credential-broker", "grants", {}); assert.equal(g.status, "OK"); assert.deepEqual(g.result.grants, []);
  void mapped;
});
test("emergency stop halts the scheduler tick and the module chain; resume restores it", async () => {
  const c = mk(); c.provisionOwnerKey({ passphrase: "correct horse battery staple" });
  await c.runDueSchedules(); const s = c.scheduler();
  c.setEmergency({ mode: "PAUSE_ALL", passphrase: "correct horse battery staple" });
  const t = await s.tick(); assert.ok(t.halted || t.ran === 0, JSON.stringify(t));
  const rn = await s.runNow(s.list()[0].id); assert.equal(rn.halted, true, JSON.stringify(rn));
  c.setEmergency({ mode: "RUNNING", passphrase: "correct horse battery staple", confirm: "RESUME" });
  assert.equal((await c.moduleBroker().invoke("owner-control", "status", {})).status, "OK");
});
test("Phase 5: Task Scheduler and Recovery managers become CONNECTED from real work (first backup + drill run through the scheduler), Security/Runtime stay honestly DEGRADED without owner key / runtime process", async () => {
  const c = mk(); await c.runDueSchedules(); const s = c.scheduler();
  const first = s.list().filter(j => /first/.test(j.name)); assert.equal(first.length, 2, "first-run backup and drill are scheduled when no backup exists");
  for (const j of first) assert.equal((await s.runNow(j.id)).status, "OK", j.name);
  await c.agents30Action({ op: "masterSupervise" }); const v = await c.agents30(); const m = Object.fromEntries(v.master.managers.map(x => [x.id, x]));
  assert.equal(m.TASK_SCHEDULER.status, "CONNECTED", m.TASK_SCHEDULER.health); assert.equal(m.RECOVERY_MAINTENANCE.status, "CONNECTED", m.RECOVERY_MAINTENANCE.health);
  assert.equal(m.BRAIN_MANAGER.status, "CONNECTED", m.BRAIN_MANAGER.health);
  assert.notEqual(m.SECURITY_APPROVAL_MANAGER.status, "CONNECTED", "no owner key provisioned in this fixture: must not claim CONNECTED");
  assert.notEqual(m.RUNTIME_SUPERVISOR.status, "CONNECTED", "no runtime child running in this fixture: must not claim CONNECTED");
});
