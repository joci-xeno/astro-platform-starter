// ATLASZ Safe Mode scope + module isolation (V7.3 Owner Control §10). In Safe Mode: unsafe external actions are blocked (the chain consults
// safe-mode.gate), affected workflows stop, faulty modules are ISOLATED, diagnostics are preserved, read-only monitoring and
// System Doctor / recovery / incident inspection stay available, and the system never reports "normal" while degraded.
export function createModuleIsolation({ blackBox = null, now = () => new Date().toISOString() } = {}) {
  const modules = new Map(), workflows = new Map();
  const rec = (kind, p) => { try { blackBox?.record({ kind, ...p }); } catch { /* ignore */ } };
  function isolate(moduleId, { reason = "FAULT", workflows: wf = [], diagnostics = {} } = {}) {
    modules.set(moduleId, { since: now(), reason, diagnostics: JSON.parse(JSON.stringify(diagnostics)) });
    for (const w of wf) workflows.set(w, { since: now(), stoppedBecause: moduleId });
    rec("MODULE_ISOLATED", { tool: moduleId, reason, decision: "ISOLATE" });
    return { isolated: true, workflowsStopped: wf };
  }
  const check = ({ moduleId = null, workflowId = null } = {}) => {
    if (moduleId && modules.has(moduleId)) return { blocked: true, reason: "MODULE_ISOLATED:" + moduleId };
    if (workflowId && workflows.has(workflowId)) return { blocked: true, reason: "WORKFLOW_STOPPED:" + workflowId };
    return { blocked: false };
  };
  /** Releasing needs the chain's owner-approved path in the caller; here we only record the release. */
  function release(moduleId) { modules.delete(moduleId); for (const [w, v] of workflows) if (v.stoppedBecause === moduleId) workflows.delete(w); rec("MODULE_RELEASED", { tool: moduleId }); }
  return { isolate, check, release, list: () => ({ modules: [...modules].map(([id, v]) => ({ id, ...v })), workflows: [...workflows].map(([id, v]) => ({ id, ...v })) }) };
}
/** What stays possible inside Safe Mode / emergency stop (read-only + recovery). Everything else is a write/external action and is gated. */
export const SAFE_MODE_ALLOWED = Object.freeze(["READ_STATUS", "RUN_SYSTEM_DOCTOR", "VERIFY_BACKUP", "CREATE_RESTORE_POINT", "VIEW_INCIDENTS", "ENTER_SAFE_MODE"]);
export function safeModeBanner(safeModeStatus) {
  return safeModeStatus?.mode === "SAFE_MODE" ? { normal: false, banner: "SAFE MODE ACTIVE — external actions blocked", reason: safeModeStatus.reason } : { normal: safeModeStatus?.mode === "NORMAL", banner: null, reason: null };
}
