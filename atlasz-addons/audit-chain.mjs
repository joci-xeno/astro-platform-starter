// ATLASZ tamper-evident audit chain (V7.3 §34 immutable security events, §14 immutable kill-switch events).
// Append-only, hash-chained. Optional file persistence (JSON lines, fsync on every append).
// "Immutable" here means tamper-EVIDENT: any edit/removal/reorder breaks verifyChain().
// It is not WORM storage; an attacker with file access can delete the whole file (callers must treat a missing
// chain after a known start as suspicious).
import fs from "node:fs";
import { withFileLock } from "./file-lock.mjs";
import path from "node:path";
import { createHash } from "node:crypto";

export const GENESIS = "0".repeat(64);
export const hashEntry = e => createHash("sha256")
  .update([e.seq, e.at, e.event, JSON.stringify(e.data ?? null), e.prevHash].join("\n"))
  .digest("hex");

export function verifyChain(entries) {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e !== "object" || Array.isArray(e)) return { ok: false, brokenAt: i + 1, reason: "ENTRY_NOT_AN_OBJECT" };
    if (e.seq !== i + 1) return { ok: false, brokenAt: i + 1, reason: "SEQUENCE_GAP_OR_REORDER" };
    if (e.prevHash !== prev) return { ok: false, brokenAt: i + 1, reason: "PREV_HASH_MISMATCH" };
    if (hashEntry(e) !== e.hash) return { ok: false, brokenAt: i + 1, reason: "ENTRY_HASH_MISMATCH" };
    prev = e.hash;
  }
  return { ok: true, length: entries.length, head: prev };
}

export function readAuditFile(file) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  const out = [];
  for (const [i, line] of lines.entries()) {
    try { out.push(JSON.parse(line)); }
    catch {
      // A torn final line (crash mid-append) is tolerated; a corrupt middle line is tampering.
      if (i === lines.length - 1 && !raw.endsWith("\n")) break;                                    // only a line WITHOUT its newline can be a torn write; a damaged complete line is tampering
      throw new Error("AUDIT_FILE_CORRUPT_AT_LINE_" + (i + 1));
    }
  }
  return out;
}

/** fastAppend (opt-in, for high-volume access logs): an append skips the full re-read and re-verification when the file is exactly as this instance last left it (same size, modification time and inode). Any other change - another process appending, an edit -
 *  takes the full path. An explicit reload()/verify() is always a full check, so tampering that keeps size and timestamp is still found by the next explicit verification (the chain is tamper-evident, not tamper-proof). */
export function createAuditChain({ filePath = null, now = () => new Date().toISOString(), fastAppend = false, headPinFile = null } = {}) {
  /** headPinFile (opt-in): after every append an atomic {length, headHash} is written beside the log. On open/reload a chain that is SHORTER than the pin, or whose entry at the pinned length has another hash, throws AUDIT_CHAIN_TRUNCATED -
   *  cutting the last lines (e.g. to undo an owner-signed removal) is detected unless the pin file is rewritten as well. It raises the bar from one file to two; it is still not WORM storage. */
  function checkPin(list) {
    if (!headPinFile || !fs.existsSync(headPinFile)) return;
    let pin; try { pin = JSON.parse(fs.readFileSync(headPinFile, "utf8")); } catch { throw new Error("AUDIT_HEAD_PIN_CORRUPT"); }
    if (!pin || !Number.isInteger(pin.length) || pin.length < 0 || typeof pin.headHash !== "string") throw new Error("AUDIT_HEAD_PIN_CORRUPT");
    if (list.length < pin.length) throw new Error("AUDIT_CHAIN_TRUNCATED:" + list.length + "<" + pin.length);
    if (pin.length > 0 && list[pin.length - 1].hash !== pin.headHash) throw new Error("AUDIT_CHAIN_TRUNCATED:HEAD_MISMATCH");
  }
  function writePin(list) {
    if (!headPinFile) return; fs.mkdirSync(path.dirname(headPinFile), { recursive: true });
    const t = headPinFile + ".tmp"; fs.writeFileSync(t, JSON.stringify({ length: list.length, headHash: list.length ? list[list.length - 1].hash : GENESIS }), { mode: 0o600 }); fs.renameSync(t, headPinFile);
  }
  // Read + verify + pin check happen under the same cross-process lock the writers use: otherwise a process that starts (or reloads) while another appends can see a pin that is ahead of the log it just read and report a false AUDIT_CHAIN_TRUNCATED.
  const locked = fn => (filePath && fs.existsSync(path.dirname(filePath)) ? withFileLock(filePath, fn) : fn());
  let entries = locked(() => {
    const list = filePath ? readAuditFile(filePath) : [];
    const initial = verifyChain(list);
    if (!initial.ok) throw new Error("AUDIT_CHAIN_TAMPERED:" + initial.reason + "@" + initial.brokenAt);
    if (filePath) checkPin(list);
    return list;
  });
  if (filePath) fs.mkdirSync(path.dirname(filePath), { recursive: true });

  /** A crash mid-append can leave a final line without its newline. A complete entry just gets its newline; an unparseable fragment is cut off (it was never a valid entry), so the next entry does not glue onto it and turn ordinary crash recovery into a permanent "tampered" state. */
  function healTail() {
    let raw; try { raw = fs.readFileSync(filePath, "utf8"); } catch { return; }
    if (!raw) return;
    const body = raw.replace(/\n+$/, ""), nl = body.lastIndexOf("\n"), frag = body.slice(nl + 1);
    let whole = false; try { JSON.parse(frag); whole = true; } catch { /* torn or garbage */ }
    if (!whole && raw.endsWith("\n")) throw new Error("AUDIT_FILE_CORRUPT_TAIL");               // a damaged line that was fully written is evidence, not a crash artefact: never cut it away
    if (!whole) { fs.truncateSync(filePath, Buffer.byteLength(body.slice(0, nl + 1))); return; }       // the reader already ignores an unparseable LAST line; it is cut off so the next entry cannot bury it mid-file
    if (!raw.endsWith("\n")) fs.appendFileSync(filePath, "\n");
  }
  function append(event, data = {}) { return filePath ? withFileLock(filePath, () => append0(event, data)) : append0(event, data); }      // one writer at a time across processes: the sequence is never forked
  let seen = null;
  const statKey = () => { try { const st = fs.statSync(filePath); return st.size + ":" + st.mtimeMs + ":" + st.ino; } catch { return null; } };
  function append0(event, data = {}) {
    if (!event) throw new Error("AUDIT_EVENT_REQUIRED");
    if (filePath && !(fastAppend && seen !== null && seen === statKey())) { reload(); healTail(); }                                  // another manager in this process (or the owner CLI) may have appended since we last looked: continue the real tail, never fork the chain
    const prev = entries.length ? entries[entries.length - 1].hash : GENESIS;
    const e = { seq: entries.length + 1, at: now(), event: String(event), data: structuredClone(data), prevHash: prev };
    e.hash = hashEntry(e);
    if (filePath) {
      const fd = fs.openSync(filePath, "a", 0o600);
      try { fs.writeSync(fd, JSON.stringify(e) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    entries.push(e); if (filePath && fastAppend) seen = statKey(); if (filePath) writePin(entries);
    return structuredClone(e);
  }
  // Re-read the file (another process, e.g. the owner CLI, may have appended). Tampering still throws.
  function reload() {
    if (!filePath) return;
    locked(() => {
      const before = fastAppend ? statKey() : null;      // the file as it was BEFORE we read it: if another process appends while we read and verify, the next append sees a different state and takes the full path
      const fresh = readAuditFile(filePath);
      const v = verifyChain(fresh);
      if (!v.ok) throw new Error("AUDIT_CHAIN_TAMPERED:" + v.reason + "@" + v.brokenAt);
      checkPin(fresh); entries = fresh; if (fastAppend) seen = before;
    });
  }
  return {
    reload,
    append,
    entries: () => structuredClone(entries),
    verify: () => verifyChain(entries),
    verifyFile: () => (filePath ? verifyChain(readAuditFile(filePath)) : verifyChain(entries)),
    head: () => (entries.length ? entries[entries.length - 1].hash : GENESIS),
    length: () => entries.length
  };
}
