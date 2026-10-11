// DEF-002: process-level watchdog for periodic services (the Master tick) + single-instance Master lock.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createTickLoop } from "../atlasz-addons/tick-loop.mjs";
import { createAgentRegistry } from "../atlasz-addons/agent-registry.mjs";
import { createWorkforce } from "../atlasz-addons/agent-workforce.mjs";
import { BUILTIN_EXECUTORS } from "../atlasz-addons/agent-executors.mjs";
import { createMasterCoordinator } from "../atlasz-addons/master-coordinator.mjs";
import { tmp, rm } from "./helpers.mjs";

const manual = () => { const t = { fn: null }; return { setInterval: (f) => { t.fn = f; return { unref() {} }; }, clearInterval: () => { t.fn = null; }, fire: () => t.fn?.() }; };

test("tick loop: one tick at a time; a stuck tick is detected, its late result ignored, restarts are bounded, then ESCALATED until the owner resets", async () => {
  let now = 1000, calls = 0, release = []; const events = []; const tm = manual();
  const loop = createTickLoop({ run: () => { calls++; return new Promise(r => release.push(r)); }, intervalMs: 100, stuckAfterMs: 500, maxRestarts: 2, onEvent: (t, d) => events.push(t), clock: () => now, timers: tm });
  loop.start(); assert.equal(loop.status().state, "RUNNING");
  tm.fire(); await Promise.resolve(); assert.equal(calls, 1); tm.fire(); await Promise.resolve(); assert.equal(calls, 1, "no overlapping tick");
  now += 600; tm.fire(); await Promise.resolve(); assert.equal(calls, 2, "stuck tick abandoned, fresh tick started"); assert.ok(events.includes("TICK_STUCK") && events.includes("TICK_RESTARTED")); assert.equal(loop.status().stuckEvents, 1);
  release[0](); await Promise.resolve(); assert.equal(loop.status().lastOkAt, null, "the late result of the abandoned tick does not count as health");
  now += 600; tm.fire(); await Promise.resolve(); now += 600; tm.fire(); await Promise.resolve();      // third stuck within the window exceeds maxRestarts=2
  assert.equal(loop.status().state, "ESCALATED"); assert.ok(events.includes("ESCALATED")); const c = calls; tm.fire(); await Promise.resolve(); assert.equal(calls, c, "an escalated loop runs nothing");
  const st = loop.reset(); assert.equal(st.state, "RUNNING"); assert.equal(st.restartsInWindow, 0);
});

test("tick loop: consecutive errors escalate; a success resets the counter; an observer that throws cannot kill the loop", async () => {
  let n = 0; const tm = manual(); const loop = createTickLoop({ run: async () => { n++; if (n <= 2 || n >= 4) throw new Error("boom"); }, maxConsecutiveErrors: 3, onEvent: () => { throw new Error("observer"); }, timers: tm });
  loop.start(); for (let i = 0; i < 3; i++) { tm.fire(); await new Promise(r => setImmediate(r)); }
  assert.equal(loop.status().consecutiveErrors, 0, "tick 3 succeeded and reset the counter"); assert.ok(loop.status().lastOkAt);
  for (let i = 0; i < 3; i++) { tm.fire(); await new Promise(r => setImmediate(r)); }
  assert.equal(loop.status().state, "ESCALATED"); assert.match(loop.status().lastError, /boom/);
});

test("Master lock: a live Master in another process refuses a second one; a dead owner's lock is taken over and audited; heartbeat shows liveness", async () => {
  const d = tmp("mlock-"); let child; try {
    const mk = () => createWorkforce({ dir: path.join(d, "wf"), registry: createAgentRegistry({ dir: path.join(d, "registry") }), sleep: async () => {}, executors: { ...BUILTIN_EXECUTORS } });
    child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" }); await new Promise(r => setTimeout(r, 100));
    fs.mkdirSync(path.join(d, "master"), { recursive: true }); fs.writeFileSync(path.join(d, "master", "master.lock"), JSON.stringify({ pid: child.pid, instanceId: "other" }));
    assert.throws(() => createMasterCoordinator({ dir: path.join(d, "master"), workforce: mk(), isStopped: () => false }), /MASTER_ALREADY_RUNNING_IN_PID_/);
    child.kill("SIGKILL"); await new Promise(r => child.on("exit", r)); child = null;
    const m = createMasterCoordinator({ dir: path.join(d, "master"), workforce: mk(), isStopped: () => false });
    assert.ok(m.auditEntries().some(e => e.event === "MASTER_STARTED" && e.data.lockTakenOver?.previousInstance === "other"), "takeover of the dead owner's lock is audited");
    assert.equal(m.liveness().state, "ALIVE"); await m.supervise(); assert.equal(m.liveness().supervisions, 1);
    m.close(); assert.equal(fs.existsSync(path.join(d, "master", "master.lock")), false, "own lock released on close");
  } finally { try { child?.kill("SIGKILL"); } catch { /* gone */ } rm(d); }
});
