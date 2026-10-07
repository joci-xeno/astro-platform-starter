// ATLASZ JOCI-only Red Kill Switch / Emergency Stop (V7.3 §14).
// - Activation AND resume require an owner-signed approval (Ed25519, see owner-auth.mjs). Bare booleans are rejected.
// - Resume additionally requires the explicit confirmation string "RESUME".
// - State is durable (atomic write + fsync) when a statePath is given and every change goes to a hash-chained audit.
// - Fail-safe: a missing/tampered state file after a recorded stop yields PAUSE_ALL, never RUNNING.
// - It never deletes data. Gates are consulted by the runtime before any dispatch (see supervisor-safe.mjs).
import fs from "node:fs";
import path from "node:path";
import { getDefaultOwnerAuth } from "./owner-auth.mjs";
import { createAuditChain } from "./audit-chain.mjs";

export const EMERGENCY_MODES = Object.freeze(["RUNNING", "PAUSE_ALL", "STOP_EXTERNAL_ACTIONS"]);
const VALID = new Set(EMERGENCY_MODES);
const nowIso = () => new Date().toISOString();

export function createEmergencyStop({ statePath = null, auditPath = null, ownerAuth = getDefaultOwnerAuth() } = {}) {
  const audit = createAuditChain({ filePath: auditPath });
  let state = { mode: "RUNNING", changedAt: nowIso(), changedBy: "SYSTEM", reason: "BOOT", approval: null, integrity: "OK" };
  let seenMtime = -1;

  const lastAuditedMode = () => {
    const ev = audit.entries().filter(e => e.event === "EMERGENCY_MODE_CHANGED").at(-1);
    return ev ? ev.data.mode : null;
  };
  const failSafe = reason => {
    state = { mode: "PAUSE_ALL", changedAt: nowIso(), changedBy: "SYSTEM_FAILSAFE", reason, approval: null, integrity: reason };
    audit.append("EMERGENCY_FAILSAFE_ENGAGED", { reason });
  };

  function load() {
    if (!statePath) return;
    if (!fs.existsSync(statePath)) {
      seenMtime = -1;
      const last = lastAuditedMode();
      if (last && last !== "RUNNING" && state.integrity === "OK") failSafe("STATE_FILE_MISSING_AFTER_STOP");
      return;
    }
    const mtime = fs.statSync(statePath).mtimeMs;
    if (mtime === seenMtime) return;
    seenMtime = mtime;
    try { audit.reload(); } catch { return failSafe("AUDIT_CHAIN_TAMPERED"); }
    let f;
    try { f = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch { return failSafe("STATE_FILE_UNREADABLE"); }
    if (!VALID.has(f.mode)) return failSafe("STATE_FILE_INVALID_MODE");
    const last = lastAuditedMode();
    if (last !== null && last !== f.mode) return failSafe("STATE_FILE_DISAGREES_WITH_AUDIT");
    if (f.approval) {
      const action = f.mode === "RUNNING" ? "EMERGENCY_RESUME" : "EMERGENCY_STOP";
      if (!ownerAuth.verifyRecorded(f.approval, { action, subject: f.mode })) return failSafe("STATE_FILE_SIGNATURE_INVALID");
    } else if (f.mode !== "RUNNING") return failSafe("STATE_FILE_UNSIGNED_STOP");
    state = { ...f, integrity: "OK" };
  }
  function persist() {
    if (!statePath) return;
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const tmp = statePath + ".tmp";
    const fd = fs.openSync(tmp, "w", 0o600);
    try { fs.writeSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, statePath);
    seenMtime = fs.statSync(statePath).mtimeMs;
  }
  load();

  function status() {
    load();
    const { approval, ...pub } = state;
    return { ...pub, banner: state.mode === "RUNNING" ? null : "EMERGENCY STOP ACTIVE", auditHead: audit.head(), approvalNonce: approval?.nonce ?? null };
  }
  function setMode({ mode, ownerApproval = null, reason = "", confirm = null, ownerAuthenticated } = {}) {
    load();
    try { audit.reload(); } catch { failSafe("AUDIT_CHAIN_TAMPERED"); throw new Error("AUDIT_CHAIN_TAMPERED_OWNER_REVIEW_REQUIRED"); }
    if (!VALID.has(mode)) throw new Error("INVALID_EMERGENCY_MODE");
    const deny = why => { audit.append("EMERGENCY_CHANGE_DENIED", { mode, why }); throw new Error("OWNER_AUTHENTICATION_REQUIRED:" + why); };
    if (ownerAuthenticated !== undefined) deny("BARE_BOOLEAN_REJECTED");
    const resume = mode === "RUNNING";
    if (resume && confirm !== "RESUME") deny("EXPLICIT_RESUME_CONFIRMATION_REQUIRED");
    const action = resume ? "EMERGENCY_RESUME" : "EMERGENCY_STOP";
    const v = ownerAuth.verifyApproval(ownerApproval, { action, subject: mode });
    if (!v.allowed) deny(v.reason);
    state = { mode, changedAt: nowIso(), changedBy: ownerAuth.status().ownerId, reason: String(reason), approval: ownerApproval, integrity: "OK" };
    audit.append("EMERGENCY_MODE_CHANGED", { mode, reason: String(reason), approvalNonce: ownerApproval.nonce });
    persist();
    return status();
  }
  function gate({ external = false } = {}) {
    load();
    if (state.mode === "PAUSE_ALL") return { allowed: false, reason: state.integrity === "OK" ? "PAUSE_ALL" : "PAUSE_ALL:" + state.integrity };
    if (state.mode === "STOP_EXTERNAL_ACTIONS" && external) return { allowed: false, reason: "EXTERNAL_ACTIONS_STOPPED" };
    return { allowed: true, reason: null };
  }
  return { status, setMode, gate, auditVerify: () => audit.verify(), auditEntries: () => audit.entries() };
}

// Process-wide default (used by the integration hub and supervisor). Durable when ATLASZ_STATE_DIR is set.
const dir = process.env.ATLASZ_STATE_DIR || null;
const def = createEmergencyStop({
  statePath: dir ? path.join(dir, "emergency-stop.json") : null,
  auditPath: dir ? path.join(dir, "emergency-audit.jsonl") : null
});
export const emergencyStatus = () => def.status();
export const setEmergencyMode = opts => def.setMode(opts);
export const emergencyGate = opts => def.gate(opts);
