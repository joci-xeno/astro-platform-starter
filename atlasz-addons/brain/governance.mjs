// Brain governance chokepoint (V7.3 Brain §1, §17). Every consequential Brain action goes through authorize().
// Brains receive ONLY this object: it can check owner approvals but has no way to issue them, grant permissions, or switch controls off.
import { emergencyGate } from "../emergency-stop.mjs";
import { createAuditChain } from "../audit-chain.mjs";

export const BRAIN_FORBIDDEN = Object.freeze(["GRANT_PERMISSION", "REMOVE_APPROVAL_REQUIREMENT", "HIDE_ACTION", "DISABLE_AUDIT", "DISABLE_KILL_SWITCH", "CHANGE_OWNER_AUTHORITY", "PRODUCTION_CHANGE", "DISABLE_SAFE_MODE", "SELF_APPROVE", "EXPAND_AUTHORITY"]);
export const EXTERNAL_ACTIONS = Object.freeze(["PUBLISH", "SELL", "SEND_EXTERNAL", "SIGN_CONTRACT", "DEPLOY", "LAUNCH_BUSINESS", "SPEND"]);
export const APPROVAL_ACTIONS = Object.freeze([...EXTERNAL_ACTIONS, "ADOPT_LESSON", "EXECUTE_RESTORE", "ROLLBACK"]);

export function createGovernance({ gate = emergencyGate, ownerAuth, safeGate = null, auditPath = null, now = () => new Date().toISOString() } = {}) {
  if (!ownerAuth || typeof ownerAuth.verifyApproval !== "function") throw new Error("OWNER_AUTH_REQUIRED");
  const audit = createAuditChain({ filePath: auditPath, now });
  const log = (decision, p, reason) => audit.append("GOV_" + decision, { brain: p.brain ?? null, action: p.action, external: Boolean(p.external), spendUsd: p.spendUsd ?? 0, subject: p.subject ?? null, reason });
  /** p: {brain, action, external, spendUsd, subject, ownerApproval}. Returns {allowed, decision: ALLOW|DENY|NEEDS_APPROVAL, reason}. */
  function authorize(p = {}) {
    if (!p.action) throw new Error("ACTION_REQUIRED");
    const out = (decision, reason) => { log(decision, p, reason); return { allowed: decision === "ALLOW", decision, reason }; };
    if (BRAIN_FORBIDDEN.includes(p.action)) return out("DENY", "FORBIDDEN_FOR_BRAINS");
    const external = Boolean(p.external) || EXTERNAL_ACTIONS.includes(p.action);
    const g = gate({ external }); if (g && g.allowed === false) return out("DENY", "OWNER_STOP");
    if (safeGate) { const s = safeGate({ external, write: true }); if (s && s.allowed === false) return out("DENY", "SAFE_MODE"); }
    const spend = Number(p.spendUsd ?? 0);
    if (!Number.isFinite(spend) || spend < 0) return out("DENY", "INVALID_SPEND");
    const needsApproval = spend > 0 ? "BRAIN_SPEND" : APPROVAL_ACTIONS.includes(p.action) ? "BRAIN_" + p.action : null;
    if (needsApproval) {
      if (!p.ownerApproval) return out("NEEDS_APPROVAL", needsApproval);
      const v = ownerAuth.verifyApproval(p.ownerApproval, { action: needsApproval, subject: p.subject ?? p.action });
      if (!v.allowed) return out("NEEDS_APPROVAL", needsApproval + ":" + (v.reason ?? "INVALID"));
    }
    return out("ALLOW", needsApproval ? "OWNER_APPROVED" : "NO_APPROVAL_REQUIRED");
  }
  return { authorize, audit: { verify: () => audit.verify(), entries: () => audit.entries(), head: () => audit.head() } };
}
