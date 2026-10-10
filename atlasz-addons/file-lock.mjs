// Cross-process mutual exclusion for the small JSON stores (audit chain, research ledger, plugin state, profiles).
// A lock is a file created with O_EXCL next to the store; it is stale after STALE_MS (a crashed holder) and then taken over.
// This serialises read-modify-write sections between processes on ONE host; it is not a distributed lock and not a security boundary.
import fs from "node:fs";
import path from "node:path";

const STALE_MS = 15000, WAIT_MS = 5000;
const held = new Map();                                                                             // lockPath -> depth (re-entrant inside one process)
const sleep = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { const t = Date.now() + ms; while (Date.now() < t) { /* spin */ } } };

/** Run fn() while holding `<file>.lock`. Throws LOCK_TIMEOUT when the lock cannot be taken in WAIT_MS (the caller fails closed). */
export function withFileLock(file, fn) {
  const lp = file + ".lock", depth = held.get(lp) ?? 0;
  if (depth > 0) { held.set(lp, depth + 1); try { return fn(); } finally { held.set(lp, held.get(lp) - 1); } }
  const t0 = Date.now(); let fd = null;
  for (let n = 0; ; n++) {
    try { fd = fs.openSync(lp, "wx", 0o600); break; }
    catch (e) {
      if (e?.code === "ENOENT") { fs.mkdirSync(path.dirname(lp), { recursive: true, mode: 0o700 }); continue; }
      if (e?.code !== "EEXIST") throw e;
      try { const st = fs.statSync(lp); if (Date.now() - st.mtimeMs > STALE_MS) { try { fs.unlinkSync(lp); } catch { /* another process took it over */ } continue; } } catch { continue; }
      if (Date.now() - t0 > WAIT_MS) throw new Error("LOCK_TIMEOUT");
      sleep(Math.min(40, 2 + n * 2));
    }
  }
  held.set(lp, 1);
  try { return fn(); }
  finally { held.delete(lp); try { fs.closeSync(fd); } catch { /* ignore */ } try { fs.unlinkSync(lp); } catch { /* ignore */ } }
}

/** Wrap the named methods of an API object so each runs under the lock (so reload -> mutate -> save is atomic between processes). */
export function lockMethods(api, file, names) {
  if (!file) return api;
  for (const k of names) { const f = api[k]; if (typeof f === "function") api[k] = (...a) => withFileLock(file, () => f(...a)); }
  return api;
}
