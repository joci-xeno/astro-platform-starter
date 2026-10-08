process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { createPersonalCommandCenter, registerPccTools } from "../atlasz-addons/personal-command-center.mjs";
import { createScheduler } from "../atlasz-addons/scheduler.mjs";
import { createToolRegistry } from "../atlasz-addons/typed-tools.mjs";
import { buildDailyBrief } from "../atlasz-addons/master-brief.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";
import { rig } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

const H = 3600000, T0 = Date.parse("2026-10-07T18:00:00Z"), at = ms => new Date(ms).toISOString();
const mk = (o = {}) => { const clock = { t: T0 }; return { clock, pcc: createPersonalCommandCenter({ now: () => at(clock.t), ...o }) }; };

test("agenda is computed from stored items and the clock: overdue / today (owner's local day) / upcoming / reminders / undated, priority-ordered; empty means 'nothing recorded'", () => {
  const { pcc, clock } = mk({ utcOffsetMinutes: -420 });                   // owner in UTC-7: local day 2026-10-07 = 07:00Z .. next 07:00Z
  assert.equal(pcc.agenda().openTotal, 0);
  pcc.add({ type: "TASK", title: "late low", dueAt: at(T0 - 5 * H), priority: "LOW" });
  pcc.add({ type: "TASK", title: "late urgent", dueAt: at(T0 - 2 * H), priority: "URGENT" });
  pcc.add({ type: "DEADLINE", title: "tonight", dueAt: at(T0 + 6 * H) });        // 00:00Z next day = 17:00 local today
  pcc.add({ type: "DEADLINE", title: "tomorrow local", dueAt: at(T0 + 14 * H) }); // 08:00Z next day = 01:00 local tomorrow
  pcc.add({ type: "DEADLINE", title: "far", dueAt: at(T0 + 100 * H) });
  pcc.add({ type: "REMINDER", title: "call", remindAt: at(T0 - H) });
  pcc.add({ type: "TASK", title: "someday" });
  const a = pcc.agenda();
  assert.deepEqual(a.overdue.map(i => i.title), ["late urgent", "late low"]);          // urgent first
  assert.deepEqual(a.dueToday.map(i => i.title), ["tonight"]); assert.deepEqual(a.upcoming.map(i => i.title), ["tomorrow local"]);   // "far" is beyond the 48h horizon
  assert.deepEqual(a.remindersDue.map(i => i.title), ["call"]); assert.equal(a.undated, 1); assert.equal(a.openTotal, 7);
  const r = a.remindersDue[0]; assert.equal(pcc.ack(r.id).ackedAt !== null, true); assert.equal(pcc.agenda().remindersDue.length, 0);   // ack stops surfacing it
  const d = pcc.list({ type: "TASK" }).find(i => i.title === "late low"); pcc.complete(d.id); assert.equal(pcc.agenda().overdue.length, 1);
  assert.equal(pcc.complete(d.id).error, "INVALID_STATE:DONE"); assert.equal(pcc.cancel("nope"), null);
  clock.t += 200 * H; assert.ok(pcc.agenda().overdue.length >= 3);                    // time passing turns open items overdue, nothing is dropped
});

test("validation, tenant isolation, durability across restart (and a second writer), corrupt store never replaced", () => {
  const dir = tmp("pcc-"); try {
    const f = path.join(dir, "pcc.json"), clock = { t: T0 }, now = () => at(clock.t);
    const a = createPersonalCommandCenter({ file: f, now }), b = createPersonalCommandCenter({ file: f, now });   // two processes' view of one file
    assert.throws(() => a.add({ type: "NOTE", title: "x" }), /TYPE_INVALID/); assert.throws(() => a.add({ type: "TASK", title: " " }), /TITLE_REQUIRED/);
    assert.throws(() => a.add({ type: "TASK", title: "x".repeat(201) }), /TITLE_TOO_LONG/); assert.throws(() => a.add({ type: "DEADLINE", title: "d" }), /DEADLINE_REQUIRES_DUE_AT/);
    assert.throws(() => a.add({ type: "REMINDER", title: "r" }), /REMINDER_REQUIRES_REMIND_AT/); assert.throws(() => a.add({ type: "TASK", title: "t", dueAt: "soon" }), /DUEAT_INVALID/);
    assert.throws(() => a.add({ type: "TASK", title: "t", priority: "MEGA" }), /PRIORITY_INVALID/); assert.throws(() => a.add({ type: "TASK", title: "t", classification: "TOP" }), /CLASSIFICATION_INVALID/);
    const one = a.add({ type: "TASK", title: "from a" }), two = b.add({ type: "TASK", title: "from b" });          // b must not overwrite a's item with a stale copy
    assert.equal(a.list().length, 2); assert.notEqual(one.id, two.id);
    assert.equal(createPersonalCommandCenter({ file: f, now }).list().length, 2);                                   // restart
    const other = createPersonalCommandCenter({ file: f, now, tenantId: "OTHER" }); assert.equal(other.list().length, 0); assert.equal(other.get(one.id), null); assert.equal(other.complete(one.id), null);
    assert.equal(a.get(one.id).source, "OWNER");
    fs.writeFileSync(f, "{broken"); assert.throws(() => createPersonalCommandCenter({ file: f, now }), /STORE_UNREADABLE/); assert.throws(() => a.list(), /STORE_UNREADABLE/); assert.equal(fs.readFileSync(f, "utf8"), "{broken");
  } finally { rm(dir); }
});

test("daily brief shows the real agenda (hu/en), says 'nothing recorded' when empty, and an unreadable store is not presented as an empty agenda", () => {
  const { pcc } = mk({});
  const st = { runtime: { reachable: true, status: "RUNNING", version: "7.3" }, topology: { actualSearch: 5, actualExecution: 25 } };
  const empty = buildDailyBrief({ status: st, prefs: { language: "en" }, agenda: pcc.agenda() }); assert.match(empty.text, /Today: nothing recorded/);
  pcc.add({ type: "TASK", title: "Send quote draft to review", dueAt: at(T0 - H), priority: "HIGH" }); pcc.add({ type: "REMINDER", title: "Call accountant", remindAt: at(T0 - 60000) }); pcc.add({ type: "DEADLINE", title: "Tax workpapers", dueAt: at(T0 + 30 * H) });
  const en = buildDailyBrief({ status: st, prefs: { language: "en" }, agenda: pcc.agenda() });
  assert.match(en.text, /Overdue: 1\n {2}• Send quote draft to review/); assert.match(en.text, /Reminders due: 1\n {2}• Call accountant/); assert.match(en.text, /Upcoming deadlines: 1\n {2}• Tax workpapers/);
  assert.match(buildDailyBrief({ status: st, prefs: { language: "hu" }, agenda: pcc.agenda() }).text, /Lejárt: 1/);
  assert.doesNotMatch(buildDailyBrief({ status: st, prefs: { language: "en" } }).text, /nothing recorded/);          // no agenda supplied -> no claim either way
  assert.equal(en.falseClaimCheck, true);
});

test("END-TO-END: a scheduled recurring task creates PCC items through typed tools under the control chain; it survives a restart, shows in the brief, an agent-created item is marked AGENT, and a stop halts it", async () => {
  const r = rig(), dir = tmp("e2e-"), clock = { t: T0 }, now = () => at(clock.t);
  try {
    const mkAll = () => {
      const pcc = createPersonalCommandCenter({ file: path.join(dir, "pcc.json"), now }), reg = createToolRegistry({ chain: r.sys.chain, blackBox: r.blackBox }); registerPccTools(reg, pcc);
      return { pcc, reg, sch: createScheduler({ file: path.join(dir, "sch.json"), tools: reg, gate: x => r.emergency.gate(x), now, blackBox: r.blackBox }) };
    };
    let w = mkAll();
    const j = w.sch.create({ name: "weekly review task", kind: "INTERVAL", spec: { everyMs: 7 * 24 * H }, tool: "pcc.add", args: { type: "TASK", title: "Weekly review", dueAt: at(T0 + 8 * 24 * H), priority: "HIGH" } });
    assert.throws(() => w.sch.create({ name: "bad", kind: "ONCE", spec: { at: at(T0) }, tool: "pcc.add", args: { type: "TASK" } }), /INVALID_ARGUMENTS/);   // typed args are checked at schedule time
    clock.t += 7 * 24 * H; w = mkAll();                                                    // a week passes AND the process restarts
    assert.equal((await w.sch.tick()).results[0].status, "OK");
    const items = w.pcc.list(); assert.equal(items.length, 1); assert.equal(items[0].source, "AGENT"); assert.equal(items[0].title, "Weekly review");   // provenance: created by a tool, not the owner
    assert.equal(w.pcc.agenda().upcoming.length + w.pcc.agenda().dueToday.length, 1);
    const ag = await w.reg.invoke("pcc.agenda", {}, { actor: { type: "AGENT", id: "E3" } }); assert.equal(ag.status, "OK"); assert.equal(ag.result.openTotal, 1);
    assert.equal((await w.reg.invoke("pcc.add", { type: "TASK", title: "x", extra: 1 }, { actor: { type: "AGENT", id: "E3" } })).status, "INVALID_ARGUMENTS");
    assert.equal((await w.reg.invoke("pcc.complete", { id: items[0].id }, { actor: { type: "AGENT", id: "E3" } })).result.status, "DONE");
    r.stop(); clock.t += 7 * 24 * H; const halted = await w.sch.tick(); assert.equal(halted.halted, true); assert.equal(w.pcc.list().length, 1);       // no new item while stopped
    r.resume(); assert.equal((await w.sch.tick()).ran, 1); assert.equal(w.pcc.list().length, 2); assert.equal(w.sch.get(j.id).history.length, 2);
  } finally { rm(r.dir); rm(dir); }
});

const freePort = () => new Promise(res => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const call = (port, token, method, p, body) => new Promise((res, rej) => { const data = body ? JSON.stringify(body) : null; const q = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host: "127.0.0.1:" + port, "x-atlasz-token": token, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, rs => { let d = ""; rs.on("data", c => d += c); rs.on("end", () => res({ status: rs.statusCode, body: JSON.parse(d) })); }); q.on("error", rej); if (data) q.write(data); q.end(); });
test("Control Center: /api/pcc and /api/pcc/action are token-protected, add/complete/ack work, bad input is a 400, and the brief picks the item up", async () => {
  const base = tmp("ccp-"), cc = createControlCenterServer({ stateDir: path.join(base, "s"), configDir: path.join(base, "c"), port: await freePort() });
  const { port, token } = await cc.listen();
  try {
    assert.equal((await call(port, "wrong", "GET", "/api/pcc")).status, 401); assert.equal((await call(port, "wrong", "POST", "/api/pcc/action", { op: "add" })).status, 401);
    assert.equal((await call(port, token, "GET", "/api/pcc")).body.summary.openTotal, 0);
    const added = await call(port, token, "POST", "/api/pcc/action", { op: "add", type: "TASK", title: "Prepare GST workpapers", dueAt: new Date(Date.now() - 3600000).toISOString(), priority: "HIGH" });
    assert.equal(added.status, 200); assert.equal(added.body.result.source, "OWNER");
    assert.equal((await call(port, token, "POST", "/api/pcc/action", { op: "add", type: "BOGUS", title: "x" })).status, 400);
    assert.equal((await call(port, token, "POST", "/api/pcc/action", { op: "wipe" })).status, 400);
    const x = (await call(port, token, "GET", "/api/pcc")).body; assert.equal(x.agenda.overdue.length, 1);
    const brief = (await call(port, token, "GET", "/api/brief")).body; assert.match(brief.text, /Prepare GST workpapers/); assert.equal(brief.firstOfDay, true);
    assert.equal((await call(port, token, "GET", "/api/brief")).body.firstOfDay, false);                // the day's first view is remembered
    assert.equal((await call(port, token, "POST", "/api/pcc/action", { op: "complete", id: added.body.result.id })).body.result.status, "DONE");
    assert.equal((await call(port, token, "GET", "/api/pcc")).body.agenda.overdue.length, 0);
    fs.writeFileSync(path.join(base, "s", "pcc", "items.json"), "{x"); assert.equal((await call(port, token, "GET", "/api/pcc")).body.state, "UNREADABLE");
  } finally { await cc.close?.(); rm(base); }
});

test("Control Center schedules view reads the persisted scheduler file: lists real jobs, NOT_CONNECTED when none, UNREADABLE when corrupt", async () => {
  const base = tmp("ccs-"), cc = createControlCenterServer({ stateDir: path.join(base, "s"), configDir: path.join(base, "c"), port: await freePort() });
  const { port, token } = await cc.listen();
  try {
    assert.equal((await call(port, token, "GET", "/api/pcc")).body.schedules.state, "NOT_CONNECTED");
    const r = rig(); const reg = createToolRegistry({ chain: r.sys.chain }); registerPccTools(reg, createPersonalCommandCenter({}));
    const sch = createScheduler({ file: path.join(base, "s", "scheduler", "schedules.json"), tools: reg });
    sch.create({ name: "daily review", kind: "DAILY", spec: { time: "08:00" }, tool: "pcc.summary" }); rm(r.dir);
    const v = (await call(port, token, "GET", "/api/pcc")).body.schedules; assert.equal(v.state, "CONNECTED"); assert.equal(v.jobs[0].name, "daily review"); assert.equal(v.delivery, "AT_LEAST_ONCE");
    fs.writeFileSync(path.join(base, "s", "scheduler", "schedules.json"), "{x"); assert.equal((await call(port, token, "GET", "/api/pcc")).body.schedules.state, "UNREADABLE");
  } finally { await cc.close?.(); rm(base); }
});
