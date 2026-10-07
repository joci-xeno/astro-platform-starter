// Governed Delivery Engine (package §12). READY_FOR_DELIVERY > DELIVERY_APPROVAL_REQUIRED > DELIVERY_ATTEMPTED > DELIVERED | DELIVERY_FAILED > DELIVERY_VERIFIED.
// Creating or verifying an artifact is not delivery. DELIVERED needs a connected delivery adapter's acceptance reference; DELIVERY_VERIFIED needs the
// customer-side receipt evidence. No adapter => the delivery stays approved-but-undelivered and the service says NOT_CONNECTED.
import { createStore, needEvidence, clone } from "./store.mjs";

export const DELIVERY_STATES = Object.freeze(["READY_FOR_DELIVERY", "DELIVERY_APPROVAL_REQUIRED", "DELIVERY_ATTEMPTED", "DELIVERED", "DELIVERY_FAILED", "DELIVERY_VERIFIED"]);

export function createDeliveryService({ file = null, ownerAuth, adapters = {}, lookups = {}, environment = "SANDBOX", now = () => new Date().toISOString(), blackBox = null, maxAttempts = 3 } = {}) {
  if (!ownerAuth) throw new Error("OWNER_AUTH_REQUIRED");
  const S = createStore({ file, init: () => ({ deliveries: {}, seq: 0 }) });
  const must = id => { const d = S.data.deliveries[id]; if (!d) throw new Error("UNKNOWN_DELIVERY"); return d; };
  const need = (ok, r) => { if (!ok) throw new Error(r); };
  const rec = (kind, d, extra = {}) => { try { blackBox?.record({ kind, resource: d.id, jobId: d.jobId, ...extra }); } catch { /* ignore */ } };
  const move = (d, to, extra = {}) => { d.history.push({ at: now(), from: d.status, to, ...extra }); d.status = to; d.updatedAt = now(); S.save(); rec("DELIVERY_" + to, d, { decision: to, reason: extra.reason }); };

  /** Only a job whose artifacts are ALL verified (current version) can be made ready. */
  function prepare({ jobId, dealId = null, artifactIds = [], channel = "DEFAULT", recipient = null } = {}) {
    need(jobId && artifactIds.length, "JOB_AND_ARTIFACTS_REQUIRED"); need(lookups.artifact, "ARTIFACT_REGISTRY_NOT_CONNECTED");
    const bad = artifactIds.filter(a => { const x = lookups.artifact(a); return !x || x.verificationStatus !== "VERIFIED" || x.verification?.hash !== x.hash; });
    need(!bad.length, "ARTIFACTS_NOT_VERIFIED:" + bad.join(","));
    const id = "dlv-" + String(++S.data.seq).padStart(5, "0"), d = { id, jobId, dealId, artifactIds: [...artifactIds], channel, recipient, status: "READY_FOR_DELIVERY", attempts: 0, approval: null, evidence: null, receipt: null, environment, createdAt: now(), updatedAt: now(), history: [{ at: now(), from: null, to: "READY_FOR_DELIVERY" }] };
    S.data.deliveries[id] = d; S.save(); rec("DELIVERY_READY_FOR_DELIVERY", d, { decision: "READY_FOR_DELIVERY" }); return clone(d);
  }
  const requestApproval = id => { const d = must(id); need(d.status === "READY_FOR_DELIVERY", "NOT_READY"); move(d, "DELIVERY_APPROVAL_REQUIRED"); return { id, action: "APPROVE_DELIVERY", subject: id }; };
  function approve(id, ownerApproval) {
    const d = must(id); need(d.status === "DELIVERY_APPROVAL_REQUIRED", "NOT_AWAITING_APPROVAL");
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "APPROVE_DELIVERY", subject: id }); need(v.allowed, "OWNER_APPROVAL_REQUIRED:" + (v.reason ?? "INVALID"));
    d.approval = { at: now() }; S.save(); rec("DELIVERY_APPROVED", d, { decision: "APPROVED" }); return clone(d);
  }
  async function attempt(id) {
    const d = must(id); need(d.approval, "DELIVERY_NOT_APPROVED"); need(["DELIVERY_APPROVAL_REQUIRED", "DELIVERY_FAILED"].includes(d.status), "CANNOT_ATTEMPT_FROM_" + d.status); need(d.attempts < maxAttempts, "DELIVERY_ATTEMPT_LIMIT");
    const ad = adapters[d.channel]; if (!ad?.deliver) return { status: d.status, delivered: false, state: "NOT_CONNECTED", reason: "NO_DELIVERY_ADAPTER_FOR_" + d.channel };
    d.attempts++; move(d, "DELIVERY_ATTEMPTED");
    let r; try { r = await ad.deliver({ id, jobId: d.jobId, artifactIds: d.artifactIds, recipient: d.recipient, idempotencyKey: id }); } catch (e) { d.error = String(e.message).slice(0, 120); move(d, "DELIVERY_FAILED", { reason: d.error }); return { status: "DELIVERY_FAILED", delivered: false, reason: d.error }; }
    if (!(r?.accepted === true && r.reference)) { d.error = r?.reason ?? "ADAPTER_DID_NOT_ACCEPT"; move(d, "DELIVERY_FAILED", { reason: d.error }); return { status: "DELIVERY_FAILED", delivered: false, reason: d.error }; }
    if ((r.environment ?? "LIVE") !== environment) { d.error = "ENVIRONMENT_MISMATCH"; move(d, "DELIVERY_FAILED", { reason: d.error }); return { status: "DELIVERY_FAILED", delivered: false, reason: d.error }; }
    d.evidence = { source: ad.name ?? d.channel, reference: r.reference, verifiedAt: now(), environment }; move(d, "DELIVERED", { reference: r.reference });
    return { status: "DELIVERED", delivered: true, evidence: clone(d.evidence) };
  }
  /** Customer-side receipt/acceptance: the only route to DELIVERY_VERIFIED. */
  function verifyReceipt(id, receipt = {}) {
    const d = must(id); need(d.status === "DELIVERED", "ONLY_DELIVERED_CAN_BE_VERIFIED"); needEvidence(receipt, environment);
    d.receipt = clone(receipt); move(d, "DELIVERY_VERIFIED"); return clone(d);
  }
  const get = id => (S.data.deliveries[id] ? clone(S.data.deliveries[id]) : null);
  const list = (f = {}) => Object.values(S.data.deliveries).filter(d => Object.entries(f).every(([k, v]) => d[k] === v)).map(clone);
  const summary = () => Object.fromEntries(DELIVERY_STATES.map(s => [s, Object.values(S.data.deliveries).filter(d => d.status === s).length]));
  return { prepare, requestApproval, approve, attempt, verifyReceipt, get, list, summary, environment };
}
