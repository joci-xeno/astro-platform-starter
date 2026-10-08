import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createScheduler, nextSlot } from "../atlasz-addons/scheduler.mjs";
import { createToolRegistry } from "../atlasz-addons/typed-tools.mjs";
import { rig } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

const MIN = 60000, T0 = Date.parse("2026-10-07T10:00:00Z");
function world(over = {}) {
  const r = rig(), dir = tmp("sch-"), clock = { t: T0 }, now = () => new Date(clock.t).toISOString();
  const reg = createToolRegistry({ chain: r.sys.chain, blackBox: r.blackBox });
  const calls = { ping: 0, flaky: 0, mail: [] }, beh = { flakyFail: 0 };
  reg.register({ name: "ping", operation: "READ_STATUS", input: { type: "object", properties: { n: { type: "integer" } } }, handler: () => { calls.ping++; return { ok: true }; } });
  reg.register({ name: "flaky", operation: "READ_STATUS", input: { type: "object", properties: {} }, handler: () => { calls.flaky++; if (beh.flakyFail > 0) { beh.flakyFail--; throw new Error("transient"); } return { ok: true }; } });
  reg.register({ name: "mail", operation: "SEND_EXTERNAL", input: { type: "object", required: ["to"], properties: { to: { type: "string" } } }, handler: a => { calls.mail.push(a.to); return { sent: a.to }; } });
  const file = path.join(dir, "sch.json");
  const mk = () => createScheduler({ file, tools: reg, gate: x => r.emergency.gate(x), now, blackBox: r.blackBox, ...over });
  return { r, dir, clock, reg, calls, beh, file, mk, s: mk(), done: () => { rm(r.dir); rm(dir); } };
}

test("interval job runs on schedule, survives restart, and a long outage is ONE run with the missed slots counted, never a burst", async () => {
  const w = world(); try {
    const j = w.s.create({ name: "heartbeat", kind: "INTERVAL", spec: { everyMs: 5 * MIN }, tool: "ping", args: { n: 1 } });
    assert.equal((await w.s.tick()).ran, 0);                                        // not yet due
    w.clock.t += 5 * MIN; assert.equal((await w.s.tick()).ran, 1); assert.equal(w.calls.ping, 1);
    const s2 = w.mk();                                                              // restart: same file
    assert.equal(s2.get(j.id).history.length, 1); assert.equal(s2.get(j.id).state, "ACTIVE");
    w.clock.t += 5 * MIN * 6;                                                        // 30 minutes down
    const t = await s2.tick(); assert.equal(t.ran, 1); assert.equal(w.calls.ping, 2); assert.equal(s2.get(j.id).missedRuns, 5);
    assert.equal((await s2.tick()).ran, 0);                                         // no replay burst
    assert.ok(Date.parse(s2.get(j.id).nextRunAt) > w.clock.t);
  } finally { w.done(); }
});

test("retry policy: transient failures back off exponentially then succeed; exhausted ONCE jobs FAIL; recurring jobs pause after repeated failures and need the owner to resume", async () => {
  const w = world(); try {
    w.beh.flakyFail = 2;
    const j = w.s.create({ name: "once", kind: "ONCE", spec: { at: new Date(T0 + MIN).toISOString() }, tool: "flaky", retry: { maxAttempts: 3, backoffMs: MIN } });
    w.clock.t += MIN; assert.equal((await w.s.tick()).results[0].status, "HANDLER_ERROR");
    assert.equal(w.s.get(j.id).nextRunAt, new Date(w.clock.t + MIN).toISOString());           // 1st backoff
    w.clock.t += MIN; await w.s.tick(); assert.equal(w.s.get(j.id).nextRunAt, new Date(w.clock.t + 2 * MIN).toISOString());   // doubled
    w.clock.t += 2 * MIN; assert.equal((await w.s.tick()).results[0].status, "OK"); assert.equal(w.s.get(j.id).state, "DONE"); assert.equal(w.calls.flaky, 3);
    w.beh.flakyFail = 99;
    const dead = w.s.create({ name: "dead", kind: "ONCE", spec: { at: new Date(w.clock.t).toISOString() }, tool: "flaky", retry: { maxAttempts: 2, backoffMs: MIN } });
    for (let i = 0; i < 4; i++) { w.clock.t += 10 * MIN; await w.s.tick(); }
    assert.equal(w.s.get(dead.id).state, "FAILED");
    const rec = w.s.create({ name: "rec", kind: "INTERVAL", spec: { everyMs: 10 * MIN }, tool: "flaky", retry: { maxAttempts: 1, backoffMs: MIN } });
    for (let i = 0; i < 6; i++) { w.clock.t += 10 * MIN; await w.s.tick(); }
    assert.equal(w.s.get(rec.id).state, "PAUSED_BY_FAILURES");
    const before = w.calls.flaky; w.clock.t += 60 * MIN; await w.s.tick(); assert.equal(w.calls.flaky, before);   // paused jobs do not run
    w.beh.flakyFail = 0; assert.equal(w.s.resume(rec.id).state, "ACTIVE"); w.clock.t += 10 * MIN; assert.equal((await w.s.tick()).results.find(x => x.id === rec.id).status, "OK");
  } finally { w.done(); }
});

test("a schedule cannot grant authority: external-effect tool waits for an approval bound to its exact args; swapped args and no approval never send", async () => {
  const w = world(); try {
    const j = w.s.create({ name: "mail bob", kind: "ONCE", spec: { at: new Date(T0 + MIN).toISOString() }, tool: "mail", args: { to: "bob" } });
    w.clock.t += MIN; assert.equal((await w.s.tick()).results[0].status, "REQUIRES_APPROVAL"); assert.equal(w.s.get(j.id).state, "AWAITING_APPROVAL"); assert.equal(w.calls.mail.length, 0);
    w.clock.t += 10 * MIN; assert.equal((await w.s.tick()).ran, 0);                                  // does not spin
    assert.equal(w.s.summary().awaitingApproval.length, 1);
    const wrong = await w.s.runNow(j.id, { ownerApproval: w.r.opApproval("SEND_EXTERNAL", { to: "eve" }) });
    assert.notEqual(wrong.status, "OK"); assert.equal(w.calls.mail.length, 0);
    const good = await w.s.runNow(j.id, { ownerApproval: w.r.opApproval("SEND_EXTERNAL", { to: "bob" }) });
    assert.equal(good.status, "OK"); assert.deepEqual(w.calls.mail, ["bob"]); assert.equal(w.s.get(j.id).state, "DONE");
  } finally { w.done(); }
});

test("emergency stop halts the whole tick; nothing runs until Joci resumes; then due work proceeds", async () => {
  const w = world(); try {
    w.s.create({ name: "hb", kind: "INTERVAL", spec: { everyMs: MIN }, tool: "ping" });
    w.r.stop(); w.clock.t += 3 * MIN;
    const h = await w.s.tick(); assert.equal(h.halted, true); assert.equal(h.ran, 0); assert.equal(w.calls.ping, 0);
    w.r.resume(); assert.equal((await w.s.tick()).ran, 1); assert.equal(w.calls.ping, 1);
    const broken = createScheduler({ file: null, tools: w.reg, gate: () => { throw new Error("x"); }, now: () => new Date(w.clock.t).toISOString() });
    broken.create({ name: "x", kind: "ONCE", spec: { at: new Date(T0).toISOString() }, tool: "ping" });
    assert.equal((await broken.tick()).halted, true);                                    // unknown gate state fails closed
  } finally { w.done(); }
});

test("crash mid-run: the interrupted run is recorded on restart and the job runs again (at-least-once, disclosed); a corrupt file is never replaced", async () => {
  const w = world(); try {
    const j = w.s.create({ name: "hb", kind: "INTERVAL", spec: { everyMs: 5 * MIN }, tool: "ping" });
    const raw = JSON.parse(fs.readFileSync(w.file, "utf8")); raw.jobs[j.id].runningSince = new Date(w.clock.t).toISOString(); raw.jobs[j.id].runId = "dead"; fs.writeFileSync(w.file, JSON.stringify(raw));
    const s2 = w.mk(); const g = s2.get(j.id);
    assert.equal(g.history.at(-1).status, "INTERRUPTED"); assert.equal(g.interruptedRuns, 1); assert.equal(g.runningSince, null);
    assert.equal((await s2.tick()).ran, 1);                                              // re-run immediately
    assert.equal(s2.summary().delivery, "AT_LEAST_ONCE"); assert.equal(s2.summary().interruptedRuns, 1);
    fs.writeFileSync(w.file, "{not json"); assert.throws(() => w.mk(), /STORE_UNREADABLE/); assert.equal(fs.readFileSync(w.file, "utf8"), "{not json");
  } finally { w.done(); }
});

test("validation + owner controls: bad specs/tools/args refused, DAILY slots computed in UTC, pause/cancel/resume state rules, concurrent ticks serialised", async () => {
  const w = world(); try {
    const base = { name: "n", kind: "INTERVAL", spec: { everyMs: 5 * MIN }, tool: "ping" };
    assert.throws(() => w.s.create({ ...base, kind: "CRON" }), /KIND_INVALID/);
    assert.throws(() => w.s.create({ ...base, name: " " }), /NAME_REQUIRED/);
    assert.throws(() => w.s.create({ ...base, tool: "nope" }), /UNKNOWN_TOOL/);
    assert.throws(() => w.s.create({ ...base, args: { n: "1" } }), /INVALID_ARGUMENTS/);
    assert.throws(() => w.s.create({ ...base, spec: { everyMs: 1000 } }), /SPEC_EVERY_MS_MIN/);
    assert.throws(() => w.s.create({ ...base, kind: "DAILY", spec: { time: "25:00" } }), /SPEC_TIME_INVALID/);
    assert.throws(() => w.s.create({ ...base, kind: "ONCE", spec: { at: "soon" } }), /SPEC_AT_INVALID/);
    const d = w.s.create({ ...base, kind: "DAILY", spec: { time: "09:30" } }); assert.equal(d.nextRunAt, "2026-10-08T09:30:00.000Z");
    assert.equal(new Date(nextSlot({ kind: "DAILY", spec: { time: "12:00" } }, T0)).toISOString(), "2026-10-07T12:00:00.000Z");
    const j = w.s.create(base);
    assert.equal(w.s.resume(j.id).error, "INVALID_STATE:ACTIVE"); assert.equal(w.s.pause(j.id).state, "PAUSED"); assert.equal(w.s.pause(j.id).error, "INVALID_STATE:PAUSED");
    assert.equal(w.s.resume(j.id).state, "ACTIVE"); assert.equal(w.s.cancel(j.id).state, "CANCELLED"); assert.equal(w.s.resume(j.id).error, "INVALID_STATE:CANCELLED");
    const k = w.s.create(base); w.clock.t += 6 * MIN;
    const [a, b] = await Promise.all([w.s.tick(), w.s.tick()]); assert.equal(a.ran + b.ran, 1); assert.equal(w.calls.ping, 1);   // one tick ran, the other was a no-op
    assert.equal(w.s.get(k.id).history.length, 1);
  } finally { w.done(); }
});

test("paused jobs never run until resumed; a job whose tool disappeared FAILS once instead of retrying forever", async () => {
  const w = world(); try {
    const j = w.s.create({ name: "hb", kind: "INTERVAL", spec: { everyMs: 5 * MIN }, tool: "ping" });
    w.s.pause(j.id); w.clock.t += 20 * MIN; assert.equal((await w.s.tick()).ran, 0); assert.equal(w.calls.ping, 0);
    w.s.resume(j.id); assert.equal((await w.s.tick()).ran, 0);   // resume skips the slots missed while paused
    w.clock.t += 5 * MIN; assert.equal((await w.s.tick()).ran, 1); assert.equal(w.calls.ping, 1);
    // same persisted schedule, but this process no longer has the tool registered
    const bare = createToolRegistry({ chain: w.r.sys.chain });
    const s2 = createScheduler({ file: w.file, tools: bare, gate: x => w.r.emergency.gate(x), now: () => new Date(w.clock.t).toISOString() });
    w.clock.t += 6 * MIN; const t = await s2.tick();
    assert.equal(t.results[0].status, "UNKNOWN_TOOL"); assert.equal(s2.get(j.id).state, "FAILED"); assert.equal(s2.get(j.id).history.filter(h => h.status === "UNKNOWN_TOOL").length, 1);
    w.clock.t += 60 * MIN; assert.equal((await s2.tick()).ran, 0);
  } finally { w.done(); }
});
