// V7.3 §39 Mobile Control — backend API only (transport-agnostic, nothing listens on a port here).
// EVERY request must carry an Ed25519 owner approval signed by JOCI's key: reads use action MOBILE_READ (subject = endpoint), control actions reuse the
// exact approvals the desktop requires (EMERGENCY_STOP / EMERGENCY_RESUME / the request's own action+subject). Replay-protected by the owner-auth nonce store.
// Failed attempts are rate limited and audited. Exposing a transport to the internet is a separate JOCI decision (not done).
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";

export const READ_ENDPOINTS = Object.freeze(["STATUS", "REFRESH", "APPROVALS", "ALERTS", "MONEY", "JOBS", "HEALTH"]);
export const CONTROL_ENDPOINTS = Object.freeze(["PAUSE", "RESUME", "APPROVE", "REJECT"]);

export function createMobileApi({ ownerAuth, reads = {}, emergency = null, approvalStore = null, auditDir = null, maxFailures = 5, windowMs = 60000, clock = () => Date.now(), now = () => new Date().toISOString() } = {}) {
  if (!ownerAuth) throw new Error("OWNER_AUTH_REQUIRED");
  const audit = createAuditChain({ filePath: auditDir ? path.join(auditDir, "mobile-api-audit.jsonl") : null, now });
  let fails = [];
  const locked = () => { const t = clock(); fails = fails.filter(x => t - x < windowMs); return fails.length >= maxFailures; };
  const deny = (code, reason, endpoint) => { if (code === 401 || code === 403) fails.push(clock()); audit.append("MOBILE_DENIED", { endpoint, code, reason }); return { status: code, body: { ok: false, error: reason } }; };

  async function handle({ endpoint, approval = null, body = {} } = {}) {
    endpoint = String(endpoint ?? "").toUpperCase();
    if (![...READ_ENDPOINTS, ...CONTROL_ENDPOINTS].includes(endpoint)) return deny(404, "UNKNOWN_ENDPOINT", endpoint);
    if (locked()) return deny(429, "RATE_LIMITED_TOO_MANY_FAILURES", endpoint);
    if (READ_ENDPOINTS.includes(endpoint)) {
      const v = ownerAuth.verifyApproval(approval, { action: "MOBILE_READ", subject: endpoint });
      if (!v.allowed) return deny(401, "OWNER_AUTH_REQUIRED:" + v.reason, endpoint);
      if (typeof reads[endpoint] !== "function") return deny(501, "NOT_CONNECTED", endpoint);
      audit.append("MOBILE_READ", { endpoint }); return { status: 200, body: { ok: true, endpoint, data: await reads[endpoint]() } };
    }
    if (endpoint === "PAUSE" || endpoint === "RESUME") {
      if (!emergency) return deny(501, "NOT_CONNECTED", endpoint);
      const mode = endpoint === "PAUSE" ? "PAUSE_ALL" : "RUNNING";
      if (endpoint === "RESUME" && body.confirm !== "RESUME") return deny(400, "TYPED_CONFIRMATION_REQUIRED", endpoint);
      const pv = ownerAuth.verifyApproval(approval, { action: endpoint === "PAUSE" ? "EMERGENCY_STOP" : "EMERGENCY_RESUME", subject: mode });   // consume the nonce HERE: a captured RESUME must not be replayable later
      if (!pv.allowed) return deny(403, "OWNER_AUTH_REQUIRED:" + pv.reason, endpoint);
      try { const r = emergency.setMode({ mode, ownerApproval: approval, reason: "Mobile control", confirm: body.confirm ?? null }); audit.append("MOBILE_" + endpoint, { mode }); return { status: 200, body: { ok: true, emergency: r } }; }
      catch (e) { return deny(403, String(e.message), endpoint); }
    }
    if (!approvalStore) return deny(501, "NOT_CONNECTED", endpoint);
    const req = approvalStore.list().find(x => x.id === body.id);
    if (!req) return deny(404, "APPROVAL_REQUEST_NOT_FOUND", endpoint); if (req.status !== "PENDING") return deny(409, "NOT_PENDING:" + req.status, endpoint);
    if (endpoint === "REJECT") {
      const v = ownerAuth.verifyApproval(approval, { action: "MOBILE_REJECT", subject: req.id });            // a rejection is safe but must still come from JOCI
      if (!v.allowed) return deny(401, "OWNER_AUTH_REQUIRED:" + v.reason, endpoint);
      audit.append("MOBILE_REJECT", { id: req.id }); return { status: 200, body: { ok: true, decision: approvalStore.decide({ id: req.id, decision: "REJECTED", reason: "Rejected from mobile" }) } };
    }
    const v = ownerAuth.verifyApproval(approval, { action: req.action, subject: req.subject });            // approval authorises ONLY this exact request
    if (!v.allowed) return deny(401, "OWNER_AUTH_REQUIRED:" + v.reason, endpoint);
    audit.append("MOBILE_APPROVE", { id: req.id, action: req.action }); return { status: 200, body: { ok: true, decision: approvalStore.decide({ id: req.id, decision: "APPROVED", approval, reason: "Approved from mobile" }) } };
  }
  return { handle, auditVerify: () => audit.verify(), endpoints: { read: READ_ENDPOINTS, control: CONTROL_ENDPOINTS } };
}
