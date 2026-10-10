// Cross-process mutual exclusion for the small JSON stores (audit chain, research ledger, plugin state, profiles).
// A lock is a file created with O_EXCL next to the store. It records a random token; only its owner removes it.
// A lock older than lockTimings.staleMs (a crashed holder) can be taken over, but ONLY under a short-lived guard lock and only after the same
// lock file (same inode, same mtime) is re-checked inside the guard, so two waiters can never both "take over" and delete a live lock.
// Limits (documented, not hidden): one host only, sections are synchronous and short (milliseconds); a section that runs longer than the stale time
// can be overtaken. It is a consistency aid for cooperating processes, NOT a security boundary.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** Timings are exported so tests can shorten them; production code never touches them. */
export const lockTimings = { staleMs: 15000, waitMs: 5000 };
const held = new Map();                                                                             // lock path -> depth (re-entrant inside one process)
const sleep = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { const t = Date.now() + ms; while (Date.now() < t) { /* spin */ } } };
function lockPath(file) { const abs = path.resolve(file); try { return fs.realpathSync(abs) + ".lock"; } catch { /* the store does not exist yet */ } let dir = path.dirname(abs); try { dir = fs.realpathSync(dir); } catch { /* directory not created yet */ } return path.join(dir, path.basename(abs)) + ".lock"; }      // one lock per real file: symlinked directories AND a symlinked store file resolve to the same lock      // one lock per real location, however the path is spelled
const staleStat = st => !st.isFile() || Math.abs(Date.now() - st.mtimeMs) > lockTimings.staleMs;               // a directory/symlink in the lock's place, or a lock far in the past OR the future, is not a live lock

/** Remove a stale lock, under the guard, after re-checking that it is still the same stale file. */
export function _takeOver(lp, seen) {
  const gp = lp + ".guard"; let gfd = null;
  try { gfd = fs.openSync(gp, "wx", 0o600); }
  catch (e) { if (e?.code === "EEXIST") { try { const g = fs.lstatSync(gp); if (Math.abs(Date.now() - g.mtimeMs) > lockTimings.staleMs || !g.isFile()) fs.rmSync(gp, { recursive: true, force: true }); } catch { /* ignore */ } } return false; }
  try {
    let now; try { now = fs.lstatSync(lp); } catch { return true; }                                   // already gone
    if (now.ino !== seen.ino || now.mtimeMs !== seen.mtimeMs || !staleStat(now)) return false;       // somebody renewed or replaced it: not ours to remove
    fs.rmSync(lp, { recursive: true, force: true }); return true;
  } catch { return false; }
  finally { try { fs.closeSync(gfd); } catch { /* ignore */ } try { fs.unlinkSync(gp); } catch { /* ignore */ } }
}

/** Run fn() while holding `<file>.lock`. Throws LOCK_TIMEOUT when the lock cannot be taken in WAIT_MS (the caller fails closed). */
export function withFileLock(file, fn) {
  const lp = lockPath(file), depth = held.get(lp) ?? 0;
  if (depth > 0) { held.set(lp, depth + 1); try { return fn(); } finally { held.set(lp, held.get(lp) - 1); } }
  const t0 = Date.now(), token = crypto.randomBytes(12).toString("hex"); let fd = null;
  for (let n = 0; ; n++) {
    if (Date.now() - t0 > lockTimings.waitMs) throw new Error("LOCK_TIMEOUT");                                  // checked on EVERY pass: no path can spin forever
    try { fd = fs.openSync(lp, "wx", 0o600); try { fs.writeSync(fd, token); } catch { /* the token is best effort */ } break; }
    catch (e) {
      if (e?.code === "ENOENT") { try { fs.mkdirSync(path.dirname(lp), { recursive: true, mode: 0o700 }); } catch { /* reported by the next open */ } sleep(2); continue; }
      if (e?.code !== "EEXIST") throw e;
      let st = null; try { st = fs.lstatSync(lp); } catch { /* vanished or dangling: retry */ }
      if (st && staleStat(st)) _takeOver(lp, st);
      sleep(Math.min(40, 2 + n * 2));
    }
  }
  held.set(lp, 1);
  try { return fn(); }
  finally {
    held.delete(lp); try { fs.closeSync(fd); } catch { /* ignore */ }
    try { if (fs.readFileSync(lp, "utf8") === token) fs.unlinkSync(lp); } catch { /* ours was already taken over: leave the successor's lock alone */ }
  }
}

/** Wrap the named methods of an API object so each runs under the lock (so reload -> mutate -> save is atomic between processes).
 *  onBusy (optional) turns a lock timeout into that method's own failure value instead of a thrown LOCK_TIMEOUT. */
export function lockMethods(api, file, names, { onBusy = null } = {}) {
  if (!file) return api;
  for (const k of names) { const f = api[k]; if (typeof f === "function") api[k] = (...a) => { try { return withFileLock(file, () => f(...a)); } catch (e) { if (onBusy && e?.message === "LOCK_TIMEOUT") return onBusy(); throw e; } }; }
  return api;
}
