// ATLASZ Owner Approval UX data model (V7.3 §41). A request is only valid when it answers ALL eight owner questions:
//   WHAT does it want to do · WHY · WHAT cost · WHAT risk · WHAT external effect · REVERSIBLE? · WHAT if Joci says no · is there a no-spend alternative.
// Two single-writer files (no cross-process append races): requests.jsonl (runtime writes) and decisions.jsonl (Control Center writes).
// A decision never carries authority by itself: an approval is a signed object (see owner-auth.mjs) that expires within minutes.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const REQUEST_FIELDS = Object.freeze(["action", "subject", "what", "why", "costUsd", "risk", "externalEffect", "reversible", "ifOwnerSaysNo", "noSpendAlternative", "requestedBy"]);
const RISK = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const canon = a => String(a ?? "").trim().toUpperCase().replace(/-/g, "_");

function appendLine(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, "a", 0o600);
  try { fs.writeSync(fd, JSON.stringify(obj) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function readLines(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const l of fs.readFileSync(file, "utf8").split("\n")) { if (!l) continue; try { out.push(JSON.parse(l)); } catch { /* torn tail */ } }
  return out;
}
export function validateRequest(r) {
  const miss = f => { throw new Error("APPROVAL_REQUEST_INCOMPLETE:" + f); };
  if (!r || typeof r !== "object") miss("request");
  for (const f of ["action", "subject", "what", "why", "externalEffect", "ifOwnerSaysNo", "noSpendAlternative", "requestedBy"]) if (typeof r[f] !== "string" || !r[f].trim()) miss(f);
  if (!(Number.isFinite(r.costUsd) && r.costUsd >= 0)) miss("costUsd");
  if (!r.risk || !RISK.has(r.risk.level) || typeof r.risk.description !== "string" || !r.risk.description.trim()) miss("risk");
  if (typeof r.reversible !== "boolean") miss("reversible");
  if (r.reversible === false && !(typeof r.irreversibleNote === "string" && r.irreversibleNote.trim())) miss("irreversibleNote");
  return true;
}

export function createApprovalRequests({ dir, ttlMs = 24 * 3600 * 1000, now = () => Date.now() } = {}) {
  if (!dir) throw new Error("APPROVAL_DIR_REQUIRED");
  const reqFile = path.join(dir, "requests.jsonl"), decFile = path.join(dir, "decisions.jsonl");
  const idOf = r => createHash("sha256").update([canon(r.action), r.subject, r.what].join("\n")).digest("hex").slice(0, 16);

  function request(r) {
    validateRequest(r);
    const id = idOf(r);
    const existing = list().find(x => x.id === id && x.status === "PENDING");
    if (existing) return { id, duplicate: true };
    appendLine(reqFile, { id, createdAt: now(), ...r, action: canon(r.action) });
    return { id, duplicate: false };
  }
  function decide({ id, decision, approval = null, reason = "" }) {
    const req = readLines(reqFile).find(x => x.id === id);
    if (!req) throw new Error("APPROVAL_REQUEST_NOT_FOUND");
    if (readLines(decFile).some(d => d.id === id)) throw new Error("APPROVAL_ALREADY_DECIDED");
    if (!["APPROVED", "REJECTED"].includes(decision)) throw new Error("INVALID_DECISION");
    if (decision === "APPROVED" && !(approval && approval.action === req.action && (approval.subject ?? null) === req.subject)) throw new Error("SIGNED_APPROVAL_FOR_THIS_REQUEST_REQUIRED");
    appendLine(decFile, { id, decidedAt: now(), decision, approval: decision === "APPROVED" ? approval : null, reason: String(reason) });
    return { id, decision };
  }
  function list() {
    const decisions = new Map(readLines(decFile).map(d => [d.id, d]));
    return readLines(reqFile).map(r => {
      const d = decisions.get(r.id);
      const status = d ? d.decision : now() - r.createdAt > ttlMs ? "EXPIRED" : "PENDING";
      return { ...r, status, decidedAt: d?.decidedAt ?? null, reason: d?.reason ?? null };
    });
  }
  // What the requester receives: the signed approval (to be verified by owner-auth), only if approved.
  const outcome = id => { const d = readLines(decFile).find(x => x.id === id); return d ? { decision: d.decision, approval: d.approval } : { decision: "PENDING", approval: null }; };
  return { request, decide, list, pending: () => list().filter(x => x.status === "PENDING"), outcome };
}
