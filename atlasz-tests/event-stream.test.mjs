import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createEventStream, frame, parseLastEventId, LIMITS } from "../atlasz-addons/event-stream.mjs";

const SK = "s" + "k-ABCDEFGHIJKLMNOPQRSTUV";
const ent = (seq, data = {}, event = "BB_TOOL") => ({ seq, at: "2026-10-08T00:00:00.000Z", event, data });
function fakeRes() { const r = new EventEmitter(); r.out = []; r.ended = false; r.writableLength = 0; r.head = null; r.writeHead = (c, h) => { r.head = { c, h }; }; r.write = s => { r.out.push(s); return true; }; r.end = () => { r.ended = true; }; return r; }
const fakeReq = (h = {}) => Object.assign(new EventEmitter(), { headers: h });
const ids = r => r.out.join("").split("\n").filter(l => l.startsWith("id: ")).map(l => Number(l.slice(4)));
const timers = () => { const t = { fns: [], cleared: 0 }; t.set = fn => { t.fns.push(fn); return { unref() {} }; }; t.clear = () => { t.cleared++; }; return t; };

test("frame: one-line JSON, id = seq, type sanitised, secrets redacted, oversize data truncated", () => {
  const f = frame(ent(7, { note: "key " + SK, token: "abcdef123456", list: [SK] }, "BB_TOOL\nevil: 1"));
  assert.match(f, /^id: 7\nevent: BB_TOOL_evil:_1\ndata: \{.*\}\n\n$/); assert.equal(f.includes(SK), false); assert.equal(f.split("\n").length, 5);
  assert.ok(f.includes("[REDACTED]"));
  const big = frame(ent(8, { x: "y".repeat(10000) })); assert.match(big, /"truncated":true/); assert.ok(big.length < 400);
  assert.match(frame({ seq: 1, at: "t" }), /event: message/);
  assert.match(frame(ent(2, {}, "x".repeat(200))), /event: x{60}\n/, "event names are capped at 60 characters");
});

test("Last-Event-ID is only honoured as a plain non-negative integer", () => {
  for (const [v, want] of [["12", 12], ["0", 0], ["-1", null], ["1.5", null], ["abc", null], ["1e3", null], ["", null], [undefined, null], [" 5", null], ["9".repeat(13), null], [["7", "8"], 7], [5, null]]) assert.equal(parseLastEventId(v), want, JSON.stringify(v));
});

test("attach: headers, backlog of the latest 20, then only new entries in order; a reconnect resumes after Last-Event-ID without duplicates", () => {
  const log = Array.from({ length: 30 }, (_, i) => ent(i + 1)); const t = timers();
  const s = createEventStream({ read: () => log, setTimer: t.set, clearTimer: t.clear });
  const res = fakeRes(), req = fakeReq(); assert.deepEqual(s.attach(req, res), { ok: true });
  assert.equal(res.head.c, 200); assert.match(res.head.h["Content-Type"], /^text\/event-stream/); assert.equal(res.head.h["Cache-Control"], "no-store");
  assert.deepEqual(ids(res), Array.from({ length: 20 }, (_, i) => i + 11), "backlog = the last 20");
  log.push(ent(31), ent(32)); t.fns[0](); assert.deepEqual(ids(res).slice(-2), [31, 32]); t.fns[0](); assert.equal(ids(res).length, 22, "nothing is sent twice");
  const res2 = fakeRes(); s.attach(fakeReq({ "last-event-id": "30" }), res2); assert.deepEqual(ids(res2), [31, 32]);
  const res3 = fakeRes(); s.attach(fakeReq({ "last-event-id": "garbage" }), res3); assert.equal(ids(res3).length, 20, "an invalid id falls back to the backlog");
});

test("bounds: client cap, batch size, heartbeat, close cleanup, buffered-bytes drop", () => {
  const log = Array.from({ length: 500 }, (_, i) => ent(i + 1)); const t = timers();
  const s = createEventStream({ read: () => log, setTimer: t.set, clearTimer: t.clear, limits: { maxClients: 2, batch: 100, pollMs: 5000, heartbeatMs: 10000 } });
  const a = fakeRes(), b = fakeRes(), c = fakeRes(); assert.equal(s.attach(fakeReq({ "last-event-id": "0" }), a).ok, true); assert.equal(s.attach(fakeReq(), b).ok, true);
  const refused = s.attach(fakeReq(), c); assert.deepEqual(refused, { ok: false, reason: "TOO_MANY_STREAM_CLIENTS" }); assert.equal(c.head, null, "a refused client gets no stream headers");
  assert.equal(ids(a).length, 100, "one tick sends at most `batch` frames"); t.fns[0](); assert.equal(ids(a).length, 200); assert.equal(a.out.join("").includes(": heartbeat"), false); t.fns[0](); assert.ok(a.out.join("").includes(": heartbeat"), "a heartbeat after heartbeatMs");
  log.push(ent(501)); b.writableLength = LIMITS.maxBufferedBytes + 1; t.fns[1](); assert.equal(b.ended, true); assert.equal(s.count(), 1, "a client with an unread backlog is dropped");
  a.emit("close"); assert.equal(s.count(), 0); assert.ok(t.cleared >= 2); assert.equal(s.attach(fakeReq(), fakeRes()).ok, true, "a slot is free again after close");
  const q = fakeReq(), r = fakeRes(); const s2 = createEventStream({ read: () => [], setTimer: t.set, clearTimer: t.clear }); s2.attach(q, r); q.emit("close"); assert.equal(s2.count(), 0, "request close also detaches"); s2.attach(fakeReq(), fakeRes()); s2.closeAll(); assert.equal(s2.count(), 0);
});

test("source problems: unreadable log reports a fixed code once and keeps the stream; a restarted log sends reset; throwing read never throws", () => {
  let mode = "bad", log = [ent(1), ent(2)]; const t = timers();
  const s = createEventStream({ read: () => { if (mode === "bad") throw new Error("AUDIT_FILE_CORRUPT_AT_LINE_3 /secret/path " + SK); return log; }, setTimer: t.set, clearTimer: t.clear });
  const res = fakeRes(); s.attach(fakeReq(), res); t.fns[0](); t.fns[0](); const txt = res.out.join("");
  assert.equal((txt.match(/stream-error/g) || []).length, 1, "reported once"); assert.equal(txt.includes("secret/path"), false); assert.equal(txt.includes(SK), false); assert.match(txt, /SOURCE_UNREADABLE/);
  mode = "ok"; t.fns[0](); assert.deepEqual(ids(res), [1, 2], "the stream recovers"); mode = "ok"; log = [ent(1)];
  const res2 = fakeRes(); s.attach(fakeReq({ "last-event-id": "50" }), res2); assert.ok(res2.out.join("").includes("event: reset")); assert.deepEqual(ids(res2), [1]);
  const s3 = createEventStream({ read: () => "nope", setTimer: t.set, clearTimer: t.clear }); const r3 = fakeRes(); assert.equal(s3.attach(fakeReq(), r3).ok, true); assert.match(r3.out.join(""), /SOURCE_UNREADABLE/);
  assert.throws(() => createEventStream({}), /READ_REQUIRED/);
});

test("mutation hardening: default client cap, exact size boundaries, empty event names, error re-reporting, heartbeat spacing", () => {
  assert.equal(LIMITS.maxClients, 5); const t = timers(); const s = createEventStream({ read: () => [], setTimer: t.set, clearTimer: t.clear });
  for (let i = 0; i < 5; i++) assert.equal(s.attach(fakeReq(), fakeRes()).ok, true); assert.equal(s.attach(fakeReq(), fakeRes()).ok, false, "the sixth stream is refused");
  const e = ent(3, { a: 1 }); const exact = JSON.stringify({ seq: 3, at: e.at, event: e.event, data: e.data }).length;
  assert.doesNotMatch(frame(e, { maxDataChars: exact }), /truncated/, "data of exactly the cap is kept"); assert.match(frame(e, { maxDataChars: exact - 1 }), /truncated/);
  assert.match(frame(ent(4, {}, "")), /event: message\n/); assert.match(frame(ent(4, {}, "///")), /event: ___\n/);
  const t2 = timers(); const r = fakeRes(); const s2 = createEventStream({ read: () => [ent(1)], setTimer: t2.set, clearTimer: t2.clear }); s2.attach(fakeReq(), r); r.writableLength = LIMITS.maxBufferedBytes; r.out.length = 0;
  const log = [ent(1)]; const s3 = createEventStream({ read: () => log, setTimer: t2.set, clearTimer: t2.clear }); const r3 = fakeRes(); s3.attach(fakeReq(), r3); r3.writableLength = LIMITS.maxBufferedBytes; log.push(ent(2)); t2.fns.at(-1)(); assert.equal(r3.ended, false, "exactly at the limit is still allowed"); assert.deepEqual(ids(r3), [1, 2]);
  let bad = false; const t4 = timers(); const s4 = createEventStream({ read: () => { if (bad) throw new Error("x"); return []; }, setTimer: t4.set, clearTimer: t4.clear, limits: { pollMs: 1000, heartbeatMs: 3000 } }); const r4 = fakeRes(); s4.attach(fakeReq(), r4);
  bad = true; t4.fns[0](); bad = false; t4.fns[0](); bad = true; t4.fns[0](); assert.equal((r4.out.join("").match(/stream-error/g) || []).length, 2, "a new failure after recovery is reported again");
  const t5 = timers(); const s5 = createEventStream({ read: () => [], setTimer: t5.set, clearTimer: t5.clear, limits: { pollMs: 1000, heartbeatMs: 3000 } }); const r5 = fakeRes(); s5.attach(fakeReq(), r5);
  for (let i = 0; i < 4; i++) t5.fns[0](); assert.equal((r5.out.join("").match(/: heartbeat/g) || []).length, 1, "ticks 3 sends one heartbeat, tick 4 none (counter reset)");
});
