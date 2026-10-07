// Governed Communication Center (package §22). States: DRAFT -> APPROVAL_REQUIRED -> APPROVED -> QUEUED -> SENT -> DELIVERED_IF_VERIFIABLE | FAILED.
//  * DRAFT/QUEUED are not SENT; SENT needs the provider's acceptance reference from a connected adapter;
//  * external messages need a signed owner approval bound to the exact text (editing after approval voids it);
//  * no adapter for a channel => the message stays QUEUED and the center reports NOT_CONNECTED — it never pretends to send.
import crypto from "node:crypto";
import { createStore, clone } from "./store.mjs";

export const COMM_STATES = Object.freeze(["DRAFT", "APPROVAL_REQUIRED", "APPROVED", "QUEUED", "SENT", "DELIVERED_IF_VERIFIABLE", "FAILED"]);
const sha = s => crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);

export function createCommunicationCenter({ file = null, ownerAuth, adapters = {}, security = null, environment = "SANDBOX", now = () => new Date().toISOString(), blackBox = null } = {}) {
  if (!ownerAuth) throw new Error("OWNER_AUTH_REQUIRED");
  const S = createStore({ file, init: () => ({ msgs: {}, seq: 0 }) });
  const must = id => { const m = S.data.msgs[id]; if (!m) throw new Error("UNKNOWN_MESSAGE"); return m; };
  const rec = (kind, m, extra = {}) => { try { blackBox?.record({ kind, resource: m.id, jobId: m.jobId ?? undefined, ...extra }); } catch { /* ignore */ } };
  const textHash = m => sha(JSON.stringify([m.channel, m.to, m.subject, m.body]));
  const move = (m, to, extra = {}) => { m.history.push({ at: now(), from: m.state, to, ...extra }); m.state = to; m.updatedAt = now(); S.save(); rec("COMM_" + to, m, { decision: to }); };

  function draft({ tenantId, channel = "EMAIL", to, subject = "", body, dealId = null, jobId = null, external = true, author = null } = {}) {
    if (!tenantId || !to || !body) throw new Error("TENANT_RECIPIENT_BODY_REQUIRED");
    if (security) { const r = security.assess({ kind: "AGENT_OUTPUT", agentId: null, source: "comm:" + (author ?? "?"), text: body }); if (!r.allowed) throw new Error("OUTBOUND_BLOCKED_BY_SECURITY:" + r.reasons.join(",")); }
    const id = "msg-" + String(++S.data.seq).padStart(5, "0"), m = { id, tenantId, channel, to, subject, body, dealId, jobId, external, author, state: "DRAFT", approvedHash: null, approval: null, providerRef: null, sendEvidence: null, receipt: null, environment, createdAt: now(), updatedAt: now(), history: [{ at: now(), from: null, to: "DRAFT" }] };
    S.data.msgs[id] = m; S.save(); rec("COMM_DRAFT", m, { decision: "DRAFT" }); return clone(m);
  }
  function edit(id, patch = {}) {
    const m = must(id); if (["SENT", "DELIVERED_IF_VERIFIABLE"].includes(m.state)) throw new Error("SENT_MESSAGE_IS_IMMUTABLE");
    for (const k of ["to", "subject", "body", "channel"]) if (patch[k] !== undefined) m[k] = patch[k];
    if (m.state !== "DRAFT") { m.approval = null; m.approvedHash = null; move(m, "DRAFT", { reason: "EDITED_APPROVAL_VOIDED" }); } else S.save();
    return clone(m);
  }
  function requestApproval(id) { const m = must(id); if (m.state !== "DRAFT") throw new Error("ONLY_DRAFT_CAN_REQUEST_APPROVAL"); move(m, "APPROVAL_REQUIRED"); return { id, state: m.state, approvalSubject: id + ":" + textHash(m), action: "APPROVE_COMMUNICATION" }; }
  /** Signed owner approval bound to the exact text. */
  function approve(id, ownerApproval) {
    const m = must(id); if (m.state !== "APPROVAL_REQUIRED") throw new Error("NOT_AWAITING_APPROVAL");
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "APPROVE_COMMUNICATION", subject: id + ":" + textHash(m) });
    if (!v.allowed) throw new Error("OWNER_APPROVAL_REQUIRED:" + (v.reason ?? "INVALID"));
    m.approvedHash = textHash(m); m.approval = { at: now() }; move(m, "APPROVED"); return clone(m);
  }
  function queue(id) {
    const m = must(id);
    if (m.external && (m.state !== "APPROVED" || m.approvedHash !== textHash(m))) throw new Error("EXTERNAL_MESSAGE_NEEDS_CURRENT_OWNER_APPROVAL");
    if (!m.external && !["DRAFT", "APPROVED"].includes(m.state)) throw new Error("CANNOT_QUEUE_FROM_" + m.state);
    move(m, "QUEUED"); return clone(m);
  }
  /** Send through the channel adapter. Without an adapter nothing is sent and the message remains QUEUED. */
  async function send(id) {
    const m = must(id); if (m.state !== "QUEUED") throw new Error("ONLY_QUEUED_MESSAGES_CAN_BE_SENT");
    if (m.external && m.approvedHash !== textHash(m)) { m.approval = null; move(m, "DRAFT", { reason: "TEXT_CHANGED_AFTER_APPROVAL" }); throw new Error("APPROVAL_VOID_TEXT_CHANGED"); }
    const ad = adapters[m.channel]; if (!ad?.send) return { state: m.state, sent: false, status: "NOT_CONNECTED", reason: "NO_ADAPTER_FOR_" + m.channel };
    let r; try { r = await ad.send({ id, to: m.to, subject: m.subject, body: m.body, idempotencyKey: id }); } catch (e) { m.error = String(e.message).slice(0, 120); move(m, "FAILED", { reason: "ADAPTER_ERROR" }); return { state: "FAILED", sent: false, reason: m.error }; }
    if (!(r?.accepted === true && r.providerRef)) { m.error = r?.reason ?? "PROVIDER_DID_NOT_ACCEPT"; move(m, "FAILED", { reason: m.error }); return { state: "FAILED", sent: false, reason: m.error }; }
    if ((r.environment ?? "LIVE") !== environment) { m.error = "ENVIRONMENT_MISMATCH"; move(m, "FAILED", { reason: m.error }); return { state: "FAILED", sent: false, reason: m.error }; }
    m.providerRef = r.providerRef; m.sendEvidence = { source: ad.name ?? m.channel, reference: r.providerRef, verifiedAt: now(), environment }; move(m, "SENT", { providerRef: r.providerRef });
    return { state: "SENT", sent: true, evidence: clone(m.sendEvidence) };
  }
  /** DELIVERED_IF_VERIFIABLE: only with a delivery receipt from the channel. Channels without receipts stay SENT. */
  function recordReceipt(id, receipt = {}) {
    const m = must(id); if (m.state !== "SENT") throw new Error("ONLY_SENT_MESSAGES_CAN_HAVE_RECEIPT");
    if (!receipt.reference || !receipt.source || !Number.isFinite(Date.parse(receipt.verifiedAt)) || (receipt.environment ?? "LIVE") !== environment) throw new Error("RECEIPT_EVIDENCE_INVALID");
    m.receipt = clone(receipt); move(m, "DELIVERED_IF_VERIFIABLE"); return clone(m);
  }
  const get = id => (S.data.msgs[id] ? clone(S.data.msgs[id]) : null);
  const list = (f = {}) => Object.values(S.data.msgs).filter(m => Object.entries(f).every(([k, v]) => m[k] === v)).map(clone);
  const summary = () => Object.fromEntries(COMM_STATES.map(s => [s, Object.values(S.data.msgs).filter(m => m.state === s).length]));
  return { draft, edit, requestApproval, approve, queue, send, recordReceipt, get, list, summary, connected: () => Object.keys(adapters), environment };
}
