// ATLASZ Owner Authority (V7.3 Owner Control §2). Joci is the final authority; this module is the single catalogue of
// WHAT needs Joci and HOW an approval is bound to one exact action. Unknown operations fail closed (blocked, never "allowed").
// No component can change the owner identity or the catalogue at runtime (frozen); changing the owner is itself a catalogue entry
// that only a signed owner approval can ever authorise, and it is never grantable to agents/brains/models.
import { createHash } from "node:crypto";

export const OWNER_ID = "JOCI";
const D = (category, risk, extra = {}) => Object.freeze({ category, risk, ...extra });
/** requiresOwner: true = needs a signed, action-bound Joci approval. agentMayRequest: may an agent/brain even ASK (via the gateway). */
export const OPERATIONS = Object.freeze({
  // owner-required classes (spec §2)
  SPEND: D("SPENDING", "HIGH", { requiresOwner: true, external: true }),
  FINANCIAL_COMMITMENT: D("FINANCIAL_COMMITMENT", "HIGH", { requiresOwner: true, external: true }),
  SUBSCRIBE: D("SUBSCRIPTION", "HIGH", { requiresOwner: true, external: true }),
  PURCHASE: D("PURCHASE", "HIGH", { requiresOwner: true, external: true }),
  SIGN_CONTRACT: D("CONTRACT", "CRITICAL", { requiresOwner: true, external: true }),
  CONFIGURE_PAYMENT: D("BANKING_PAYMENT_CONFIG", "CRITICAL", { requiresOwner: true, external: true }),
  DEPLOY_PRODUCTION: D("PRODUCTION_DEPLOYMENT", "CRITICAL", { requiresOwner: true, external: true }),
  DEPLOY: D("PRODUCTION_DEPLOYMENT", "CRITICAL", { requiresOwner: true, external: true }),
  CHANGE_SECURITY_SETTING: D("SECURITY_CHANGE", "HIGH", { requiresOwner: true }),
  CHANGE_CREDENTIAL: D("CREDENTIAL_CHANGE", "CRITICAL", { requiresOwner: true }),
  CHANGE_OWNER_PERMISSION: D("OWNER_PERMISSION_CHANGE", "CRITICAL", { requiresOwner: true, agentMayRequest: false }),
  DELETE_DATA: D("DESTRUCTIVE_OPERATION", "CRITICAL", { requiresOwner: true }),
  PUBLISH: D("EXTERNAL_PUBLICATION", "HIGH", { requiresOwner: true, external: true }),
  SELL: D("EXTERNAL_PUBLICATION", "HIGH", { requiresOwner: true, external: true }),
  LAUNCH_BUSINESS: D("EXTERNAL_PUBLICATION", "HIGH", { requiresOwner: true, external: true }),
  SEND_EXTERNAL: D("EXTERNAL_PUBLICATION", "MEDIUM", { requiresOwner: true, external: true }),
  HIGH_RISK_CHANGE: D("HIGH_RISK_SYSTEM_CHANGE", "HIGH", { requiresOwner: true }),
  ADOPT_LESSON: D("HIGH_RISK_SYSTEM_CHANGE", "MEDIUM", { requiresOwner: true }),
  RESTORE: D("DESTRUCTIVE_OPERATION", "HIGH", { recovery: true, requiresOwner: true }),
  ROLLBACK: D("HIGH_RISK_SYSTEM_CHANGE", "HIGH", { recovery: true, requiresOwner: true }),
  EXIT_SAFE_MODE: D("HIGH_RISK_SYSTEM_CHANGE", "HIGH", { recovery: true, requiresOwner: true }),
  RESUME_EMERGENCY_STOP: D("HIGH_RISK_SYSTEM_CHANGE", "CRITICAL", { recovery: true, requiresOwner: true, agentMayRequest: false }),
  RELEASE_QUARANTINE: D("SECURITY_CHANGE", "HIGH", { requiresOwner: true }),
  SET_SPEND_POLICY: D("SPENDING", "CRITICAL", { requiresOwner: true, agentMayRequest: false }),
  MONEY_APPROVE_SEND: D("EXTERNAL_PUBLICATION", "HIGH", { requiresOwner: true, external: true }),
  COMPUTER_USE_CONSEQUENTIAL: D("HIGH_RISK_SYSTEM_CHANGE", "HIGH", { requiresOwner: true, external: true }),
  CREATE_AGENT: D("HIGH_RISK_SYSTEM_CHANGE", "CRITICAL", { requiresOwner: true, agentMayRequest: false }),
  // no owner needed (internal, reversible, side-effect-free); still subject to kill switch / safe mode / security
  READ_STATUS: D("INTERNAL", "LOW", { requiresOwner: false, readOnly: true }),
  INTERNAL_COMPUTE: D("INTERNAL", "LOW", { requiresOwner: false }),
  DRAFT: D("INTERNAL", "LOW", { requiresOwner: false }),
  RECOMMEND: D("INTERNAL", "LOW", { requiresOwner: false }),
  SIMULATE: D("INTERNAL", "LOW", { requiresOwner: false }),
  INTERNAL_BRAIN_ACTION: D("INTERNAL", "LOW", { requiresOwner: false }),
  EXTERNAL_READ: D("EXTERNAL_READ", "LOW", { requiresOwner: false, external: true }),
  CREATE_RESTORE_POINT: D("RECOVERY", "LOW", { requiresOwner: false, recovery: true }),
  VERIFY_BACKUP: D("RECOVERY", "LOW", { requiresOwner: false, recovery: true, readOnly: true }),
  RUN_SYSTEM_DOCTOR: D("RECOVERY", "LOW", { requiresOwner: false, recovery: true, readOnly: true }),
  VIEW_INCIDENTS: D("RECOVERY", "LOW", { requiresOwner: false, recovery: true, readOnly: true }),
  ENTER_SAFE_MODE: D("RECOVERY", "LOW", { requiresOwner: false, recovery: true }),
});

/** Operations nobody except a signed owner approval path may perform; agents/brains/models can never hold them. */
export const NEVER_FOR_NON_OWNER = Object.freeze(["CHANGE_OWNER_PERMISSION", "RESUME_EMERGENCY_STOP", "SET_SPEND_POLICY", "CREATE_AGENT"]);
/** Self-service attempts that are always forbidden (not even approvable by an agent request). */
export const FORBIDDEN_ATTEMPTS = Object.freeze(["GRANT_PERMISSION", "REMOVE_APPROVAL_REQUIREMENT", "HIDE_ACTION", "DISABLE_AUDIT", "DISABLE_KILL_SWITCH", "CHANGE_OWNER_AUTHORITY", "DISABLE_SAFE_MODE", "SELF_APPROVE", "EXPAND_AUTHORITY", "BYPASS_CONTROL", "DISABLE_SECURITY_BRAIN", "DISABLE_FIREWALL"]);

const canon = v => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v);
/** The exact-action fingerprint an approval is bound to. Approval for action A can never match action B. */
export function actionSubject(operation, params = {}) {
  return createHash("sha256").update(JSON.stringify(canon({ operation: String(operation).toUpperCase(), params }))).digest("hex").slice(0, 32);
}
export const approvalActionName = operation => "OWNER_OP_" + String(operation).toUpperCase();

export function createOwnerAuthority({ ownerAuth } = {}) {
  if (!ownerAuth || typeof ownerAuth.verifyApproval !== "function") throw new Error("OWNER_AUTH_REQUIRED");
  function classify(operation) {
    const op = String(operation ?? "").toUpperCase();
    if (FORBIDDEN_ATTEMPTS.includes(op)) return { known: true, forbidden: true, operation: op, requiresOwner: false, reason: "FORBIDDEN_ATTEMPT" };
    const d = OPERATIONS[op];
    if (!d) return { known: false, forbidden: false, operation: op, requiresOwner: true, reason: "UNKNOWN_OPERATION_FAIL_CLOSED" };
    return { known: true, forbidden: false, operation: op, ...d };
  }
  /** Verify (and consume) an approval bound to exactly this operation + params. */
  function verify({ operation, params = {}, approval, consume = true } = {}) {
    const c = classify(operation);
    if (!c.known || c.forbidden) return { allowed: false, reason: c.reason };
    const r = ownerAuth.verifyApproval(approval, { action: approvalActionName(c.operation), subject: actionSubject(c.operation, params), consume });
    return r.allowed ? { allowed: true, reason: null, nonce: r.nonce, ownerId: r.ownerId } : { allowed: false, reason: r.reason };
  }
  const status = () => ({ ownerId: OWNER_ID, ownerAuth: ownerAuth.status?.() ?? null, catalogueSize: Object.keys(OPERATIONS).length, immutable: Object.isFrozen(OPERATIONS) });
  return { classify, verify, status, ownerId: OWNER_ID };
}
