import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createDurableQueue } from "../atlasz-addons/durable-queue.mjs";
import { tmp, rm } from "./helpers.mjs";

test("priority order, FIFO within priority", () => {
  const d = tmp(); try { const q = createDurableQueue({ dir: d });
    q.enqueue({ id: "a", priority: 1 }); q.enqueue({ id: "b", priority: 5 }); q.enqueue({ id: "c", priority: 5 });
    assert.deepEqual([q.lease().id, q.lease().id, q.lease().id], ["b", "c", "a"]); assert.equal(q.lease(), null);
  } finally { rm(d); }
});
test("idempotency: same key never creates a second job, even after completion", () => {
  const d = tmp(); try { const q = createDurableQueue({ dir: d });
    assert.equal(q.enqueue({ id: "j1", idempotencyKey: "K" }).accepted, true);
    q.ack(q.lease().id);
    assert.equal(q.enqueue({ id: "j2", idempotencyKey: "K" }).duplicate, true);
    assert.equal(q.stats().total, 1);
  } finally { rm(d); }
});
test("work survives a restart; leased items of a dead process are requeued by resume()", () => {
  const d = tmp(); try {
    const q1 = createDurableQueue({ dir: d }); q1.enqueue({ id: "x", payload: { n: 1 } }); q1.enqueue({ id: "y" });
    assert.equal(q1.lease().id, "x");                      // process "crashes" holding x
    const q2 = createDurableQueue({ dir: d });
    assert.equal(q2.get("x").state, "LEASED");
    assert.deepEqual(q2.resume(), ["x"]);
    assert.equal(q2.get("x").state, "READY"); assert.deepEqual(q2.get("x").payload, { n: 1 });
    assert.equal(q2.stats().depth, 2);
  } finally { rm(d); }
});
test("retry with backoff, then dead-letter after maxAttempts; DLQ survives restart", () => {
  const d = tmp(); let t = 1000; try {
    const q = createDurableQueue({ dir: d, maxAttempts: 2, now: () => t });
    q.enqueue({ id: "r" });
    q.nack(q.lease().id, { error: "boom", retryDelayMs: 500 });
    assert.equal(q.lease(), null); t += 600;               // not yet / now eligible
    assert.equal(q.nack(q.lease().id, { error: "boom2" }).state, "DEAD");
    const q2 = createDurableQueue({ dir: d, maxAttempts: 2 });
    assert.equal(q2.deadLetters().length, 1); assert.equal(q2.deadLetters()[0].lastError, "boom2");
  } finally { rm(d); }
});
test("stalled lease is requeued after lease expiry", () => {
  const d = tmp(); let t = 0; try {
    const q = createDurableQueue({ dir: d, leaseMs: 100, now: () => t });
    q.enqueue({ id: "s" }); q.lease(); t = 50; assert.deepEqual(q.requeueStalled(), []);
    t = 200; assert.deepEqual(q.requeueStalled(), ["s"]); assert.equal(q.get("s").state, "READY");
  } finally { rm(d); }
});
test("torn final line (crash mid-write) is dropped, earlier work intact", () => {
  const d = tmp(); try {
    const q = createDurableQueue({ dir: d }); q.enqueue({ id: "keep" });
    fs.appendFileSync(q.journalPath, '{"s":99,"op":"ENQ","id":"torn","pay');
    const q2 = createDurableQueue({ dir: d });
    assert.equal(q2.get("keep").state, "READY"); assert.equal(q2.get("torn"), null);
    q2.enqueue({ id: "after" });                           // journal still appendable and valid
    assert.equal(createDurableQueue({ dir: d }).stats().total, 2);
  } finally { rm(d); }
});
test("tampered middle line is refused, not silently skipped", () => {
  const d = tmp(); try {
    const q = createDurableQueue({ dir: d }); q.enqueue({ id: "a" }); q.enqueue({ id: "b" }); q.enqueue({ id: "c" });
    const lines = fs.readFileSync(q.journalPath, "utf8").split("\n"); lines[1] = lines[1].replace('"b"', '"z"');
    fs.writeFileSync(q.journalPath, lines.join("\n"));
    assert.throws(() => createDurableQueue({ dir: d }), /QUEUE_JOURNAL_CORRUPT_AT_LINE_2/);
  } finally { rm(d); }
});
test("ack/nack on an unleased item is rejected", () => {
  const d = tmp(); try { const q = createDurableQueue({ dir: d }); q.enqueue({ id: "u" });
    assert.throws(() => q.ack("u"), /REQUIRES_LEASED/); assert.throws(() => q.nack("u"), /REQUIRES_LEASED/);
  } finally { rm(d); }
});

test("backpressure: a full queue refuses new work with an explicit signal (nothing dropped or logged); finishing work frees capacity; duplicates still report duplicate; durable across restart", () => {
  const d = tmp("qbp-"); try {
    const q = createDurableQueue({ dir: d, maxPending: 2 });
    assert.equal(q.enqueue({ id: "a" }).accepted, true); assert.equal(q.enqueue({ id: "b" }).accepted, true);
    const full = q.enqueue({ id: "c" }); assert.equal(full.accepted, false); assert.equal(full.backpressure, true); assert.equal(full.reason, "QUEUE_FULL"); assert.equal(q.get("c"), null);
    assert.equal(q.enqueue({ id: "a" }).duplicate, true); assert.equal(q.pressure().full, true); assert.equal(q.pressure().pending, 2);
    const l = q.lease({ worker: "w" }); assert.equal(q.pressure().pending, 2, "a leased job is still pending work"); q.ack(l.id); assert.equal(q.pressure().full, false); assert.equal(q.enqueue({ id: "c" }).accepted, true);
    assert.equal(createDurableQueue({ dir: d, maxPending: 2 }).pressure().pending, 2);                    // rebuilt from the journal
    const dead = createDurableQueue({ dir: tmp("qbp2-"), maxPending: 1, maxAttempts: 1 }); dead.enqueue({ id: "x" }); const lx = dead.lease({}); dead.nack(lx.id, "boom"); assert.equal(dead.pressure().pending, 0, "dead-lettered work does not block the queue"); assert.equal(dead.enqueue({ id: "y" }).accepted, true);
  } finally { rm(d); }
});
