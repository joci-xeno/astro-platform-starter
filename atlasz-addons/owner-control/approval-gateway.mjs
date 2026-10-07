// ATLASZ Owner Approval Gateway (V7.3 Owner Control §4). ONE place where every approval request is made and decided.
// A request must show WHAT/WHY/WHO/TARGET/EXPECTED RESULT/COST/FINANCIAL+SECURITY+DATA RISK/REVERSIBILITY/ROLLBACK/REQUIRED CREDENTIAL.
// Outcomes are exactly APPROVED | REJECTED | EXPIRED | CANCELLED | BLOCKED (plus PENDING while open). "Maybe" does not exist.
// APPROVED is only recorded with a signature-valid approval bound to this request's operation + exact params (checked without consuming
// the nonce; the executor consumes it when it acts, so an approval can be used once).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createOwnerAuthority, actionSubject, approvalActionName } from "./owner-authority.mjs";

export const GATEWAY_OUTCOMES = Object.freeze(["APPROVED", "REJECTED", "EXPIRED", "CANCELLED", "BLOCKED"]);
export const GATEWAY_FIELDS = Object.freeze(["operation", "params", "what", "why", "requestedBy", "target", "expectedResult", "costUsd", "financialRisk", "securityRisk", "dataRisk", "reversibility", "rollbackPossible", "requiredCredential"]);
const LEVEL = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const REV = new Set(["REVERSIBLE", "PARTIALLY_REVERSIBLE", "IRREVERSIBLE"]);

const append = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const fd = fs.openSync(f, "a", 0o600); try { fs.writeSync(fd, JSON.stringify(o) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
const read = f => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);

export function createApprovalGateway({ dir, ownerAuth, ttlMs = 24 * 3600 * 1000, now = () => Date.now() } = {}) {
  if (!dir || !ownerAuth) throw new Error("DIR_AND_OWNER_AUTH_REQUIRED");
  const authority = createOwnerAuthority({ ownerAuth });
  const reqF = path.join(dir, "gateway-requests.jsonl"), decF = path.join(dir, "gateway-decisions.jsonl");

  function validate(r) {
    const m = f => { throw new Error("GATEWAY_REQUEST_INCOMPLETE:" + f); };
    if (!r || typeof r !== "object") m("request");
    for (const f of ["operation", "what", "why", "target", "expectedResult", "requiredCredential"]) if (typeof r[f] !== "string" || !r[f].trim()) m(f);
    if (!r.requestedBy || typeof r.requestedBy.type !== "string" || typeof r.requestedBy.id !== "string") m("requestedBy");
    if (!(Number.isFinite(r.costUsd) && r.costUsd >= 0)) m("costUsd");
    for (const f of ["financialRisk", "securityRisk", "dataRisk"]) if (!LEVEL.has(r[f])) m(f);
    if (!REV.has(r.reversibility)) m("reversibility");
    if (typeof r.rollbackPossible !== "boolean") m("rollbackPossible");
    if (r.params !== undefined && (typeof r.params !== "object" || r.params === null)) m("params");
  }
  const idOf = r => createHash("sha256").update(JSON.stringify([r.operation, actionSubject(r.operation, r.params ?? {}), r.what, r.requestedBy.id])).digest("hex").slice(0, 16);

  function request(r) {
    validate(r);
    const c = authority.classify(r.operation), params = r.params ?? {}, id = idOf({ ...r, operation: String(r.operation).toUpperCase() });
    const dup = list().find(x => x.id === id && x.status === "PENDING");
    if (dup) return { id, duplicate: true, status: "PENDING" };
    // blocked up-front: unknown operation, forbidden attempt, or a requester that may never ask
    let blocked = null;
    if (!c.known) blocked = "UNKNOWN_OPERATION";
    else if (c.forbidden) blocked = "FORBIDDEN_ATTEMPT";
    else if (c.agentMayRequest === false && r.requestedBy.type !== "OWNER") blocked = "REQUESTER_MAY_NOT_ASK";
    else if (!c.requiresOwner) blocked = "NO_APPROVAL_REQUIRED_FOR_THIS_OPERATION";
    append(reqF, { id, createdAt: now(), ...r, operation: c.operation, params, subject: actionSubject(c.operation, params), approvalAction: approvalActionName(c.operation), category: c.category ?? null });
    if (blocked) { append(decF, { id, decidedAt: now(), decision: "BLOCKED", reason: blocked, approval: null }); return { id, duplicate: false, status: "BLOCKED", reason: blocked }; }
    return { id, duplicate: false, status: "PENDING" };
  }
  function decide({ id, decision, approval = null, reason = "" } = {}) {
    const req = read(reqF).find(x => x.id === id);
    if (!req) throw new Error("GATEWAY_REQUEST_NOT_FOUND");
    if (read(decF).some(d => d.id === id)) throw new Error("GATEWAY_ALREADY_DECIDED");
    if (!["APPROVED", "REJECTED", "CANCELLED"].includes(decision)) throw new Error("INVALID_DECISION");
    if (decision === "APPROVED") {
      if (now() - req.createdAt > ttlMs) { append(decF, { id, decidedAt: now(), decision: "EXPIRED", reason: "REQUEST_TTL_ELAPSED", approval: null }); return { id, decision: "EXPIRED" }; }
      const v = ownerAuth.verifyApproval(approval, { action: req.approvalAction, subject: req.subject, consume: false });
      if (!v.allowed) { append(decF, { id, decidedAt: now(), decision: "BLOCKED", reason: "APPROVAL_INVALID:" + v.reason, approval: null }); return { id, decision: "BLOCKED", reason: v.reason }; }
    }
    append(decF, { id, decidedAt: now(), decision, reason: String(reason), approval: decision === "APPROVED" ? approval : null });
    return { id, decision };
  }
  function list() {
    const dec = new Map(read(decF).map(d => [d.id, d]));
    return read(reqF).map(r => {
      const d = dec.get(r.id);
      const status = d ? d.decision : now() - r.createdAt > ttlMs ? "EXPIRED" : "PENDING";
      return { ...r, status, decidedAt: d?.decidedAt ?? null, reason: d?.reason ?? null };
    });
  }
  /** What the requester gets back: the signed approval only if APPROVED. The approval is NOT a capability by itself: chain/authority verify it against the exact action. */
  const outcome = id => { const r = list().find(x => x.id === id); if (!r) return { status: "UNKNOWN", approval: null }; const d = read(decF).find(x => x.id === id); return { status: r.status, approval: r.status === "APPROVED" ? d.approval : null }; };
  return { request, decide, list, pending: () => list().filter(x => x.status === "PENDING"), outcome, authority };
}
