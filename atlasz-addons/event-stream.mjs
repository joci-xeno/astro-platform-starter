// G12 Streaming tool observability: a read-only Server-Sent-Events feed over the tamper-evident Black Box chain.
// The stream never writes state, never reveals more than the redacted chain entry, and is bounded in clients, batch size, frame size and buffered bytes.
import { redactSecrets } from "./brain/black-box.mjs";

export const LIMITS = Object.freeze({ maxClients: 5, pollMs: 1000, heartbeatMs: 15000, batch: 100, backlog: 20, maxDataChars: 4000, maxBufferedBytes: 1048576 });
const TYPE = /[^A-Za-z0-9_.:-]/g;

/** One SSE frame for a chain entry: id = sequence number, event = sanitised type, data = redacted JSON (single line, size capped). */
export function frame(entry, { maxDataChars = LIMITS.maxDataChars } = {}) {
  const type = String(entry?.event ?? "message").replace(TYPE, "_").slice(0, 60) || "message";
  let data = JSON.stringify(redactSecrets({ seq: entry.seq, at: entry.at, event: entry.event, data: entry.data ?? null }));
  if (data.length > maxDataChars) data = JSON.stringify({ seq: entry.seq, at: entry.at, event: String(entry.event ?? "").slice(0, 60), truncated: true });
  return `id: ${Number(entry.seq)}\nevent: ${type}\ndata: ${data}\n\n`;
}
/** Last-Event-ID is untrusted: only a plain non-negative integer is honoured. */
export const parseLastEventId = v => { const s = Array.isArray(v) ? v[0] : v; return typeof s === "string" && /^\d{1,12}$/.test(s) ? Number(s) : null; };

export function createEventStream({ read, limits = {}, setTimer = setInterval, clearTimer = clearInterval } = {}) {
  if (typeof read !== "function") throw new Error("READ_REQUIRED");
  const L = { ...LIMITS, ...limits }, clients = new Set();
  const safeRead = () => { try { const r = read(); return Array.isArray(r) ? r : null; } catch { return null; } };
  function drop(c) { if (!clients.delete(c)) return; clearTimer(c.timer); try { c.res.end(); } catch { /* already closed */ } }
  function push(c, text) { if (c.res.writableLength > L.maxBufferedBytes) { drop(c); return false; } try { c.res.write(text); return true; } catch { drop(c); return false; } }
  function tick(c) {
    const all = safeRead();
    if (all === null) { c.errors++; if (c.errors === 1) push(c, "event: stream-error\ndata: {\"code\":\"SOURCE_UNREADABLE\"}\n\n"); return; }
    c.errors = 0;
    const head = all.length ? all[all.length - 1].seq : 0;
    if (c.last > head) { c.last = 0; if (!push(c, "event: reset\ndata: {\"reason\":\"LOG_RESTARTED\"}\n\n")) return; }
    let sent = 0;
    for (const e of all) { if (e.seq <= c.last) continue; if (sent >= L.batch) break; if (!push(c, frame(e, L))) return; c.last = e.seq; sent++; }
  }
  /** Attach a response. Returns { ok:false, reason } when the client cap is reached; the caller answers 503. */
  function attach(req, res) {
    if (clients.size >= L.maxClients) return { ok: false, reason: "TOO_MANY_STREAM_CLIENTS" };
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Content-Type-Options": "nosniff" });
    const all = safeRead() ?? [], head = all.length ? all[all.length - 1].seq : 0, given = parseLastEventId(req.headers?.["last-event-id"]);
    const c = { res, last: given ?? Math.max(0, head - L.backlog), errors: 0, beat: 0, timer: null };
    clients.add(c); res.write(": ATLASZ observability stream (read-only)\nretry: 3000\n\n");
    c.timer = setTimer(() => { c.beat += L.pollMs; tick(c); if (c.beat >= L.heartbeatMs) { c.beat = 0; push(c, ": heartbeat\n\n"); } }, L.pollMs); c.timer?.unref?.();
    tick(c);
    const gone = () => drop(c); req.on?.("close", gone); res.on?.("close", gone);
    return { ok: true };
  }
  const closeAll = () => { for (const c of [...clients]) drop(c); };
  return { attach, closeAll, count: () => clients.size, _tick: () => { for (const c of clients) tick(c); } };
}
