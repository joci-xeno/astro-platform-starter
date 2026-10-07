// ATLASZ Durable Queue (V7.3 §10 Central Priority Queue / DLQ / Checkpoint / resume; §52 #10 hang detection,
// #13 idempotency). Append-only JSON-lines journal, fsync per operation, per-line checksum, replay on open.
// - A torn final line (crash mid-write) is dropped; a corrupt middle line is refused (possible tampering).
// - Work is never silently lost: a leased item whose worker died is requeued (resume()/requeueStalled()).
// - Idempotency: enqueueing the same idempotencyKey twice never creates a second job, even after it finished.
// - Exhausted retries move the item to the dead-letter state; it stays in the journal for owner review.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const crc = body => createHash("sha256").update(body).digest("hex").slice(0, 16);

export function createDurableQueue({ dir, maxAttempts = 3, leaseMs = 60000, now = () => Date.now() } = {}) {
  if (!dir) throw new Error("QUEUE_DIR_REQUIRED");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "queue-journal.jsonl");
  const items = new Map();       // id -> item
  const idem = new Set();
  let seq = 0;

  function apply(r) {
    seq = Math.max(seq, r.s);
    switch (r.op) {
      case "ENQ":
        items.set(r.id, { id: r.id, payload: r.payload, priority: r.priority, seq: r.s, state: "READY", attempts: 0, notBefore: 0, leaseUntil: null, worker: null, lastError: null });
        idem.add(r.idem); break;
      case "LEASE": { const i = items.get(r.id); if (i) Object.assign(i, { state: "LEASED", leaseUntil: r.leaseUntil, worker: r.worker }); break; }
      case "ACK": { const i = items.get(r.id); if (i) Object.assign(i, { state: "DONE", leaseUntil: null, worker: null }); break; }
      case "NACK": { const i = items.get(r.id); if (i) Object.assign(i, { state: "READY", attempts: r.attempts, notBefore: r.notBefore, lastError: r.error, leaseUntil: null, worker: null }); break; }
      case "DEAD": { const i = items.get(r.id); if (i) Object.assign(i, { state: "DEAD", attempts: r.attempts, lastError: r.error, leaseUntil: null, worker: null }); break; }
      case "REQUEUE": { const i = items.get(r.id); if (i) Object.assign(i, { state: "READY", attempts: r.attempts, leaseUntil: null, worker: null, notBefore: 0 }); break; }
      default: throw new Error("QUEUE_JOURNAL_UNKNOWN_OP:" + r.op);
    }
  }

  function replay() {
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, "utf8");
    const endsClean = raw === "" || raw.endsWith("\n");
    const lines = raw.split("\n");
    if (endsClean) lines.pop();               // trailing "" after the last newline
    let goodBytes = 0;
    for (const [i, line] of lines.entries()) {
      let ok = false, rec;
      try { const o = JSON.parse(line); const { c, ...body } = o; rec = body; ok = c === crc(JSON.stringify(body)); } catch { ok = false; }
      const isLast = i === lines.length - 1;
      if (!ok) {
        if (isLast && !endsClean) { fs.truncateSync(file, goodBytes); return; }   // torn tail from a crash: drop it
        throw new Error("QUEUE_JOURNAL_CORRUPT_AT_LINE_" + (i + 1));
      }
      apply(rec);
      goodBytes += Buffer.byteLength(line) + 1;
    }
    if (!endsClean) fs.appendFileSync(file, "\n");  // last record was complete but unterminated
  }
  replay();

  function log(rec) {
    const body = { s: ++seq, t: now(), ...rec };
    const line = JSON.stringify({ ...body, c: crc(JSON.stringify(body)) }) + "\n";
    const fd = fs.openSync(file, "a", 0o600);
    try { fs.writeSync(fd, line); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    apply(body);
  }

  function enqueue({ id, payload = null, priority = 0, idempotencyKey = id } = {}) {
    if (!id) throw new Error("QUEUE_ITEM_ID_REQUIRED");
    if (!Number.isFinite(Number(priority))) throw new Error("QUEUE_PRIORITY_INVALID");
    if (idem.has(idempotencyKey) || items.has(id)) return { accepted: false, duplicate: true, id };
    log({ op: "ENQ", id, payload, priority: Number(priority), idem: idempotencyKey });
    return { accepted: true, duplicate: false, id };
  }
  function lease({ worker = "worker" } = {}) {
    const t = now();
    const ready = [...items.values()].filter(i => i.state === "READY" && i.notBefore <= t)
      .sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    const it = ready[0];
    if (!it) return null;
    log({ op: "LEASE", id: it.id, worker, leaseUntil: t + leaseMs });
    return structuredClone(items.get(it.id));
  }
  function ack(id) {
    const i = items.get(id);
    if (!i || i.state !== "LEASED") throw new Error("QUEUE_ACK_REQUIRES_LEASED_ITEM");
    log({ op: "ACK", id });
  }
  function nack(id, { error = "UNKNOWN", retryDelayMs = 0 } = {}) {
    const i = items.get(id);
    if (!i || i.state !== "LEASED") throw new Error("QUEUE_NACK_REQUIRES_LEASED_ITEM");
    const attempts = i.attempts + 1;
    if (attempts >= maxAttempts) log({ op: "DEAD", id, attempts, error: String(error) });
    else log({ op: "NACK", id, attempts, error: String(error), notBefore: now() + retryDelayMs });
    return structuredClone(items.get(id));
  }
  function requeueStalled({ force = false } = {}) {
    const t = now(), moved = [];
    for (const i of [...items.values()]) {
      if (i.state !== "LEASED" || !(force || i.leaseUntil <= t)) continue;
      const attempts = i.attempts + 1;
      if (attempts >= maxAttempts) log({ op: "DEAD", id: i.id, attempts, error: "STALLED_MAX_ATTEMPTS" });
      else log({ op: "REQUEUE", id: i.id, attempts });
      moved.push(i.id);
    }
    return moved;
  }
  // Call once at process start: every lease belongs to a dead process.
  const resume = () => requeueStalled({ force: true });
  const stats = () => {
    const c = { ready: 0, leased: 0, done: 0, dead: 0 };
    for (const i of items.values()) c[{ READY: "ready", LEASED: "leased", DONE: "done", DEAD: "dead" }[i.state]]++;
    return { ...c, depth: c.ready + c.leased, total: items.size };
  };
  return { enqueue, lease, ack, nack, requeueStalled, resume, stats, get: id => (items.has(id) ? structuredClone(items.get(id)) : null),
    deadLetters: () => [...items.values()].filter(i => i.state === "DEAD").map(structuredClone), journalPath: file };
}
