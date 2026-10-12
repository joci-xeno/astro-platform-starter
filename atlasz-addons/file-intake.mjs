// ATLASZ untrusted file intake: the ONLY path by which an untrusted file (attachment, download, upload, package) enters the system.
//   1 size is checked BEFORE the bytes are accepted;  2 the bytes go straight into the quarantine store (read-only 0400, no exec bit, hashed name) - they are never written to a working folder;
//   3 type by magic bytes, name tricks, archive structure (bombs, zip-slip, links) are inspected WITHOUT extraction;  4 the configured established scanner (ClamAV / Defender) scans the stored copy;
//   5 a security event is audited and the owner alerted;  6 a scanner detection or blocking finding is a CONFIRMED incident (the file's hash is blocked);  7 release happens only through the quarantine's
//   owner-signed, single-use, hash-and-destination-bound approval. Nothing here executes, opens or imports the file, and no agent tool can read the quarantine store.
// State vocabulary (never "clean"): BLOCKED_DETECTED | BLOCKED_STRUCTURAL | HELD_SCANNER_UNAVAILABLE | HELD_SCANNER_ERROR | HELD_NO_DETECTION_NOT_PROVEN_SAFE (all need an owner release).
import { createQuarantine } from "./quarantine.mjs";
import { scrub } from "./secret-patterns.mjs";

export const INTAKE_MAX_BYTES = 25 * 1024 * 1024;
export function createFileIntake({ dir, boundary = null, ownerAuth = null, scanner = null, isStopped = () => false, maxBytes = INTAKE_MAX_BYTES, alert = () => {}, onIncident = () => {}, now = () => Date.now() } = {}) {
  const q = createQuarantine({ dir, ownerAuth, scanner, isStopped, nowFn: now, limits: { maxFileBytes: maxBytes } });
  const notify = a => { try { alert(a); return true; } catch { return false; } };
  const stateOf = rec => rec.scan.status === "SCANNER_DETECTED" ? "BLOCKED_DETECTED" : rec.findings.some(f => f.severity === "BLOCK") ? "BLOCKED_STRUCTURAL"
    : rec.scan.status === "NO_SCANNER_CONFIGURED" ? "HELD_SCANNER_UNAVAILABLE" : rec.scan.status === "SCANNER_ERROR" ? "HELD_SCANNER_ERROR" : "HELD_NO_DETECTION_NOT_PROVEN_SAFE";
  async function submit({ name = "unnamed", bytes, source = "unknown", declaredSize = null } = {}) {
    if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) return { ok: false, reason: "BYTES_REQUIRED" };
    if ((Number.isFinite(declaredSize) && declaredSize > maxBytes) || bytes.length > maxBytes) { notify({ at: new Date(now()).toISOString(), level: "WARN", kind: "INTAKE_REJECTED_TOO_LARGE", text: "file rejected before storage: larger than " + maxBytes + " bytes" }); return { ok: false, reason: "FILE_TOO_LARGE", state: "REJECTED" }; }
    const r = await q.quarantineBuffer(Buffer.from(bytes), { name: String(name).slice(0, 200), reason: "UNTRUSTED_INTAKE", source: String(source).slice(0, 100) });
    if (!r.ok) return { ok: false, reason: r.reason, state: "REJECTED" };
    const rec = r.record, state = stateOf(rec), blocked = state.startsWith("BLOCKED");
    const level = blocked ? "CRITICAL" : "WARN";
    notify({ at: new Date(now()).toISOString(), level, kind: "UNTRUSTED_FILE_HELD", sha256: rec.sha256, state, text: scrub((blocked ? "BLOCKED " : "HELD ") + rec.originalName + " (" + rec.type + "): " + state + (rec.findings.length ? " [" + rec.findings.slice(0, 3).map(f => f.code).join(",") + "]" : "") + ". Release only by owner approval.") });
    if (blocked) { try { onIncident({ kind: state === "BLOCKED_DETECTED" ? "MALWARE_DETECTED_BY_SCANNER" : "MALICIOUS_FILE_STRUCTURE", severity: "CRITICAL", confirmed: true, operation: "file:" + rec.sha256, detail: rec.originalName + " " + state, evidence: { sha256: rec.sha256, scan: rec.scan, findings: rec.findings.slice(0, 10) } }); } catch { /* the file is still held */ } }
    return { ok: true, state, sha256: rec.sha256, type: rec.type, executable: rec.executable, scan: rec.scan, findings: rec.findings, releasedToAgents: false };
  }
  const release = (...a) => { if (boundary) { let b; try { b = boundary.check({ agentId: null, tool: "quarantine.release", opClass: "FILE_RELEASE" }); } catch { b = { allowed: false, reason: "BOUNDARY_ERROR" }; } if (!b.allowed) return { ok: false, reason: "BOUNDARY:" + b.reason }; } return q.release(...a); };
  return { submit, list: q.list, get: q.get, release, remove: q.remove, verify: q.verify, status: q.status, scannerName: scanner?.name ?? null, auditEntries: q.auditEntries };
}
