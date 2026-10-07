// ATLASZ tamper-evident audit chain (V7.3 §34 immutable security events, §14 immutable kill-switch events).
// Append-only, hash-chained. Optional file persistence (JSON lines, fsync on every append).
// "Immutable" here means tamper-EVIDENT: any edit/removal/reorder breaks verifyChain().
// It is not WORM storage; an attacker with file access can delete the whole file (callers must treat a missing
// chain after a known start as suspicious).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const GENESIS = "0".repeat(64);
const hashEntry = e => createHash("sha256")
  .update([e.seq, e.at, e.event, JSON.stringify(e.data ?? null), e.prevHash].join("\n"))
  .digest("hex");

export function verifyChain(entries) {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
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
      if (i === lines.length - 1) break;
      throw new Error("AUDIT_FILE_CORRUPT_AT_LINE_" + (i + 1));
    }
  }
  return out;
}

export function createAuditChain({ filePath = null, now = () => new Date().toISOString() } = {}) {
  let entries = filePath ? readAuditFile(filePath) : [];
  const initial = verifyChain(entries);
  if (!initial.ok) throw new Error("AUDIT_CHAIN_TAMPERED:" + initial.reason + "@" + initial.brokenAt);
  if (filePath) fs.mkdirSync(path.dirname(filePath), { recursive: true });

  function append(event, data = {}) {
    if (!event) throw new Error("AUDIT_EVENT_REQUIRED");
    const prev = entries.length ? entries[entries.length - 1].hash : GENESIS;
    const e = { seq: entries.length + 1, at: now(), event: String(event), data: structuredClone(data), prevHash: prev };
    e.hash = hashEntry(e);
    if (filePath) {
      const fd = fs.openSync(filePath, "a", 0o600);
      try { fs.writeSync(fd, JSON.stringify(e) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    entries.push(e);
    return structuredClone(e);
  }
  // Re-read the file (another process, e.g. the owner CLI, may have appended). Tampering still throws.
  function reload() {
    if (!filePath) return;
    const fresh = readAuditFile(filePath);
    const v = verifyChain(fresh);
    if (!v.ok) throw new Error("AUDIT_CHAIN_TAMPERED:" + v.reason + "@" + v.brokenAt);
    entries = fresh;
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
