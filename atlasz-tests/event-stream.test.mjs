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

test("bounds: client cap, batch size, heartbeat, one shared timer and one read per poll, close cleanup, buffered-bytes drop", () => {
  const log = Array.from({ length: 500 }, (_, i) => ent(i + 1)); const t = timers(); let reads = 0;
  const s = createEventStream({ read: () => { reads++; return log; }, setTimer: t.set, clearTimer: t.clear, limits: { maxClients: 2, batch: 100, pollMs: 5000, heartbeatMs: 10000 } });
  const a = fakeRes(), b = fakeRes(), c = fakeRes(); assert.equal(s.attach(fakeReq({ "last-event-id": "0" }), a).ok, true); assert.equal(s.attach(fakeReq(), b).ok, true);
  assert.equal(t.fns.length, 1, "one timer for all clients");
  const refused = s.attach(fakeReq(), c); assert.deepEqual(refused, { ok: false, reason: "TOO_MANY_STREAM_CLIENTS" }); assert.equal(c.head, null, "a refused client gets no stream headers");
  assert.equal(ids(a).length, 100, "one tick sends at most `batch` frames"); const r0 = reads; t.fns[0](); assert.equal(reads, r0 + 1, "one read per poll however many clients"); assert.equal(ids(a).length, 200); assert.equal(a.out.join("").includes(": heartbeat"), false); t.fns[0](); assert.ok(a.out.join("").includes(": heartbeat"), "a heartbeat after heartbeatMs");
  log.push(ent(501)); b.writableLength = LIMITS.maxBufferedBytes + 1; t.fns[0](); assert.equal(b.ended, true); assert.equal(s.count(), 1, "a client with an unread backlog is dropped");
  a.emit("close"); assert.equal(s.count(), 0); assert.equal(t.cleared, 1, "the timer stops with the last client"); assert.equal(s.attach(fakeReq(), fakeRes()).ok, true, "a slot is free again after close"); assert.equal(t.fns.length, 2, "and a new timer starts");
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

test("mutation hardening: default client cap, exact size boundaries, empty event names, exact buffer limit, error re-reporting, heartbeat spacing, gap notice", () => {
  assert.equal(LIMITS.maxClients, 5); const t = timers(); const s = createEventStream({ read: () => [], setTimer: t.set, clearTimer: t.clear });
  for (let i = 0; i < 5; i++) assert.equal(s.attach(fakeReq(), fakeRes()).ok, true); assert.equal(s.attach(fakeReq(), fakeRes()).ok, false, "the sixth stream is refused");
  const e = ent(3, { a: 1 }); const exact = JSON.stringify({ seq: 3, at: e.at, event: e.event, data: e.data }).length;
  assert.doesNotMatch(frame(e, { maxDataChars: exact }), /truncated/, "data of exactly the cap is kept"); assert.match(frame(e, { maxDataChars: exact - 1 }), /truncated/);
  assert.match(frame(ent(4, {}, "")), /event: message\n/); assert.match(frame(ent(4, {}, "///")), /event: ___\n/);
  const t3 = timers(); const log = [ent(1)]; const s3 = createEventStream({ read: () => log, setTimer: t3.set, clearTimer: t3.clear }); const r3 = fakeRes(); s3.attach(fakeReq(), r3); r3.writableLength = LIMITS.maxBufferedBytes; log.push(ent(2)); t3.fns[0](); assert.equal(r3.ended, false, "exactly at the limit is still allowed"); assert.deepEqual(ids(r3), [1, 2]);
  let bad = false; const t4 = timers(); const s4 = createEventStream({ read: () => { if (bad) throw new Error("x"); return []; }, setTimer: t4.set, clearTimer: t4.clear, limits: { pollMs: 1000, heartbeatMs: 3000 } }); const r4 = fakeRes(); s4.attach(fakeReq(), r4);
  bad = true; t4.fns[0](); bad = false; t4.fns[0](); bad = true; t4.fns[0](); assert.equal((r4.out.join("").match(/stream-error/g) || []).length, 2, "a new failure after recovery is reported again");
  const t5 = timers(); const s5 = createEventStream({ read: () => [], setTimer: t5.set, clearTimer: t5.clear, limits: { pollMs: 1000, heartbeatMs: 3000 } }); const r5 = fakeRes(); s5.attach(fakeReq(), r5);
  for (let i = 0; i < 4; i++) t5.fns[0](); assert.equal((r5.out.join("").match(/: heartbeat/g) || []).length, 1, "tick 3 sends one heartbeat, tick 4 none (counter reset)");
  // the window only keeps the newest entries: a client far behind is told about the gap and then continues
  const t6 = timers(); const win = Array.from({ length: 5 }, (_, i) => ent(i + 100)); const s6 = createEventStream({ read: () => win, setTimer: t6.set, clearTimer: t6.clear }); const r6 = fakeRes(); s6.attach(fakeReq({ "last-event-id": "10" }), r6);
  assert.match(r6.out.join(""), /event: gap\ndata: \{"from":11,"to":99\}/); assert.deepEqual(ids(r6), [100, 101, 102, 103, 104]);
  const r7 = fakeRes(); s6.attach(fakeReq({ "last-event-id": "99" }), r7); assert.equal(r7.out.join("").includes("event: gap"), false, "no gap when the next entry follows directly"); assert.deepEqual(ids(r7), [100, 101, 102, 103, 104]);
  const r8 = fakeRes(); s6.attach(fakeReq({ "last-event-id": "0" }), r8); assert.equal(r8.out.join("").includes("event: gap"), false, "id 0 means from the start, not a gap"); 
});

test("frame never throws and never emits what looks like a credential, in the data, the event name or nested under a secret-looking key", () => {
  let deep = { v: 1 }; for (let i = 0; i < 20000; i++) deep = { n: deep };
  const f = frame(ent(9, deep)); assert.match(f, /^id: 9\nevent: BB_TOOL\ndata: \{.*"truncated":true\}\n\n$/, "an unserialisable entry becomes a minimal frame");
  const K = SK, J = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV";
  const g = frame(ent(5, { secret: { k: "nested-secret-val" }, password: 123456789, token: 99887766, auth: { Authorization: "Bearer abcdefghijklmnop" }, url: "https://user:pw12345@host/x", jwt: J, note: "key_" + K, bare: "Bearer abcdefghijklmnop" }, "BB_" + K));
  for (const bad of ["nested-secret-val", "123456789", "99887766", "abcdefghijklmnop", "pw12345", J, K]) assert.equal(g.includes(bad), false, bad);
  assert.equal(frame({ seq: "x", at: 1, event: { toString() { throw new Error("boom"); } } }).startsWith("id: 0\n"), true, "hostile fields do not throw");
});

test("createChainTail: reads only appended lines, keeps the newest window, survives torn tails, shrinking files and corrupt lines", async () => {
  const { createChainTail } = await import("../atlasz-addons/event-stream.mjs"); const fs = await import("node:fs"); const path = await import("node:path"); const { tmp, rm } = await import("./helpers.mjs");
  const dir = tmp("tail-"); const f = path.join(dir, "bb.jsonl"); try {
    const tail = createChainTail(f, { keep: 3 }); assert.deepEqual(tail.read(), [], "a missing file is an empty log");
    const line = n => JSON.stringify(ent(n)) + "\n"; fs.writeFileSync(f, line(1) + line(2));
    assert.deepEqual(tail.read().map(e => e.seq), [1, 2]); fs.appendFileSync(f, line(3).slice(0, 10)); assert.deepEqual(tail.read().map(e => e.seq), [1, 2], "a torn last line waits");
    fs.appendFileSync(f, line(3).slice(10) + line(4) + line(5)); assert.deepEqual(tail.read().map(e => e.seq), [3, 4, 5], "only the newest `keep` entries are retained");
    const same = tail.read(); assert.equal(tail.read(), same, "nothing changed: the cached array is returned");
    fs.writeFileSync(f, line(1)); assert.deepEqual(tail.read().map(e => e.seq), [1], "a shrunken file is re-read from the start");
    fs.appendFileSync(f, "not json\n"); assert.throws(() => tail.read(), /LOG_CORRUPT/); fs.writeFileSync(f, line(1) + line(2)); assert.deepEqual(tail.read().map(e => e.seq), [1, 2], "recovers once the file is sound");
    fs.writeFileSync(f, JSON.stringify(ent(1, { t: "é€😀" })) + "\n"); const t2 = createChainTail(f); assert.equal(t2.read()[0].data.t, "é€😀");
  } finally { rm(dir); }
});

test("verification fixes G12: a replaced (rotated) file is detected even when bigger; an endless line and huge entries are bounded", async () => {
  const { createChainTail } = await import("../atlasz-addons/event-stream.mjs"); const fs = await import("node:fs"); const path = await import("node:path"); const { tmp, rm } = await import("./helpers.mjs");
  const dir = tmp("tail2-"); const f = path.join(dir, "bb.jsonl"); try {
    const line = (n, d) => JSON.stringify(ent(n, d)) + "\n";
    fs.writeFileSync(f, line(1) + line(2) + line(3)); const tail = createChainTail(f); assert.deepEqual(tail.read().map(e => e.seq), [1, 2, 3]);
    // rotation: a NEW file (different inode) that is already longer than the old offset, with a first line ending exactly at the old offset
    fs.renameSync(f, f + ".1"); fs.writeFileSync(f, line(101, { pad: "x".repeat(2000) }) + line(102) + line(103) + line(104)); assert.deepEqual(tail.read().map(e => e.seq), [101, 102, 103, 104], "no stale entries from the old file");
    // an endless line is refused instead of buffered
    const f2 = path.join(dir, "endless.jsonl"); fs.writeFileSync(f2, "x".repeat(2 * 1048576)); const t2 = createChainTail(f2); assert.throws(() => t2.read(), /LOG_CORRUPT/);
    // a huge entry is kept at a bounded size
    const f3 = path.join(dir, "big.jsonl"); fs.writeFileSync(f3, line(1, { blob: "y".repeat(300000) }) + line(2)); const t3 = createChainTail(f3), got = t3.read(); assert.deepEqual(got.map(e => e.seq), [1, 2]); assert.equal(got[0].oversize, true); assert.ok(JSON.stringify(got[0]).length < 500);
  } finally { rm(dir); }
});

test("createChainTail: a log larger than one read chunk is caught up over successive reads", async () => {
  const { createChainTail } = await import("../atlasz-addons/event-stream.mjs"); const fs = await import("node:fs"); const path = await import("node:path"); const { tmp, rm } = await import("./helpers.mjs");
  const d = tmp(); try {
    const f = path.join(d, "big.jsonl"); const pad = "x".repeat(400); const n = 24000; const lines = [];
    for (let i = 1; i <= n; i++) lines.push(JSON.stringify({ seq: i, event: "E", pad }));
    fs.writeFileSync(f, lines.join("\n") + "\n"); assert.ok(fs.statSync(f).size > 8 * 1048576);
    const tail = createChainTail(f, { keep: 5 }); let last = 0;
    for (let i = 0; i < 5 && last < n; i++) { const r = tail.read(); last = r.length ? r[r.length - 1].seq : 0; }
    assert.equal(last, n, "the tail reaches the end of a >8 MB log without a size change");
  } finally { rm(d); }
});
