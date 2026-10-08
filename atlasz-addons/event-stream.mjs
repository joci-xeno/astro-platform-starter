// G12 Streaming tool observability: a read-only Server-Sent-Events feed over the tamper-evident Black Box chain.
// The stream never writes state, never reveals more than the redacted chain entry, and is bounded in clients, batch size, frame size and buffered bytes.
import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { redactSecrets } from "./brain/black-box.mjs";

export const LIMITS = Object.freeze({ maxClients: 5, pollMs: 1000, heartbeatMs: 15000, batch: 100, backlog: 20, maxDataChars: 4000, maxBufferedBytes: 1048576 });
const TYPE = /[^A-Za-z0-9_.:-]/g;

/** One SSE frame for a chain entry: id = sequence number, event = sanitised + redacted type, data = redacted JSON (single line, size capped). Never throws: an entry that cannot be serialised
 *  (for example nested thousands of levels deep) becomes a minimal frame that says so. */
export function frame(entry, { maxDataChars = LIMITS.maxDataChars } = {}) {
  const seq = Number.isSafeInteger(entry?.seq) ? entry.seq : 0;
  const clean = v => { try { return String(redactSecrets(String(v ?? ""))); } catch { return ""; } };
  const type = clean(entry?.event ?? "message").replace(TYPE, "_").slice(0, 60) || "message";
  let data;
  try { data = JSON.stringify(redactSecrets({ seq, at: entry.at, event: clean(entry.event), data: entry.data ?? null })); if (data.length > maxDataChars) throw new RangeError("too large"); }
  catch { data = JSON.stringify({ seq, at: clean(entry?.at).slice(0, 40), event: clean(entry?.event).slice(0, 60), truncated: true }); }
  return `id: ${seq}\nevent: ${type}\ndata: ${data}\n\n`;
}
/** Last-Event-ID is untrusted: only a plain non-negative integer is honoured. */
export const parseLastEventId = v => { const s = Array.isArray(v) ? v[0] : v; return typeof s === "string" && /^\d{1,12}$/.test(s) ? Number(s) : null; };

export function createEventStream({ read, limits = {}, setTimer = setInterval, clearTimer = clearInterval } = {}) {
  if (typeof read !== "function") throw new Error("READ_REQUIRED");
  const L = { ...LIMITS, ...limits }, clients = new Set(); let timer = null;
  const safeRead = () => { try { const r = read(); return Array.isArray(r) ? r : null; } catch { return null; } };
  function drop(c) { if (!clients.delete(c)) return; try { c.res.end(); } catch { /* already closed */ } if (!clients.size && timer) { clearTimer(timer); timer = null; } }
  function push(c, text) { if (c.res.writableLength > L.maxBufferedBytes) { drop(c); return false; } try { c.res.write(text); return true; } catch { drop(c); return false; } }
  function tick(c, all) {
    if (all === null) { c.errors++; if (c.errors === 1) push(c, "event: stream-error\ndata: {\"code\":\"SOURCE_UNREADABLE\"}\n\n"); return; }
    c.errors = 0;
    const head = all.length ? all[all.length - 1].seq : 0;
    if (c.last > head) { c.last = 0; if (!push(c, "event: reset\ndata: {\"reason\":\"LOG_RESTARTED\"}\n\n")) return; }
    if (all.length && all[0].seq > c.last + 1 && c.last > 0) { if (!push(c, `event: gap\ndata: {"from":${c.last + 1},"to":${all[0].seq - 1}}\n\n`)) return; c.last = all[0].seq - 1; }
    let sent = 0;
    for (const e of all) { if (e.seq <= c.last) continue; if (sent >= L.batch) break; if (!push(c, frame(e, L))) return; c.last = e.seq; sent++; }
  }
  /** One read of the source per poll, shared by every client (a slow log is never re-read once per client). */
  function poll() {
    const all = safeRead();
    for (const c of [...clients]) { tick(c, all); if (!clients.has(c)) continue; c.beat += L.pollMs; if (c.beat >= L.heartbeatMs) { c.beat = 0; push(c, ": heartbeat\n\n"); } }
  }
  /** Attach a response. Returns { ok:false, reason } when the client cap is reached; the caller answers 503. */
  function attach(req, res) {
    if (clients.size >= L.maxClients) return { ok: false, reason: "TOO_MANY_STREAM_CLIENTS" };
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Content-Type-Options": "nosniff" });
    const all = safeRead(), head = all?.length ? all[all.length - 1].seq : 0, given = parseLastEventId(req.headers?.["last-event-id"]);
    const c = { res, last: given ?? Math.max(0, head - L.backlog), errors: 0, beat: 0 };
    clients.add(c); res.write(": ATLASZ observability stream (read-only)\nretry: 3000\n\n");
    if (!timer) { timer = setTimer(poll, L.pollMs); timer?.unref?.(); }
    tick(c, all);
    const gone = () => drop(c); req.on?.("close", gone); res.on?.("close", gone);
    return { ok: true };
  }
  const closeAll = () => { for (const c of [...clients]) drop(c); };
  return { attach, closeAll, count: () => clients.size, _tick: poll };
}

/** Incremental tail of a hash-chained JSON-lines log: reads only appended bytes, keeps the newest `keep` entries, and re-reads from scratch if the file shrank (restart/rotation).
 *  A torn last line is left for the next poll; a corrupt complete line makes read() throw so the stream reports SOURCE_UNREADABLE instead of serving partial data. */
export function createChainTail(file, { keep = 2000 } = {}) {
  let offset = 0, buf = "", entries = [], sig = "", ident = "", dec = new StringDecoder("utf8");
  const reset = () => { offset = 0; buf = ""; entries = []; sig = ""; ident = ""; dec = new StringDecoder("utf8"); };
  return {
    read() {
      let st; try { st = fs.statSync(file); } catch { reset(); return []; }
      const id = st.dev + ":" + st.ino; if (ident && id !== ident) reset(); ident = id;      // a replaced file (rotation) is a different file even if it is bigger
      if (st.size < offset) reset();
      const s2 = st.size + ":" + st.mtimeMs; if (s2 === sig) return entries;
      if (st.size > offset) {
        const fd = fs.openSync(file, "r"); let chunk; try { const n = Math.min(st.size - offset, 8 * 1048576); chunk = Buffer.alloc(n); fs.readSync(fd, chunk, 0, n, offset); offset += n; } finally { fs.closeSync(fd); }
        buf += dec.write(chunk); const lines = buf.split("\n"); buf = lines.pop();
        if (buf.length > 1048576) { reset(); throw new Error("LOG_CORRUPT"); }                 // a "line" that never ends is not buffered without bound
        for (const line of lines) { if (!line) continue; let e; try { e = JSON.parse(line); } catch { reset(); throw new Error("LOG_CORRUPT"); } if (Number.isSafeInteger(e?.seq)) entries.push(line.length > 65536 ? { seq: e.seq, event: typeof e.event === "string" ? e.event.slice(0, 80) : "EVENT", oversize: true } : e); }   // an entry is kept in memory at a bounded size
        if (entries.length > keep) entries = entries.slice(-keep);
      }
      sig = s2; return entries;
    }
  };
}
