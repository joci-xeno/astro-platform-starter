// Internal Invoice Engine (package §13). DRAFT > READY > ISSUED > SENT > (PARTIALLY_PAID) > PAID_CLAIMED > PAYMENT_VERIFICATION_REQUIRED > VERIFIED_PAID; OVERDUE; CANCELLED.
//  * ISSUED needs a signed owner approval bound to the invoice; SENT needs a really-SENT communication;
//  * a payment CLAIM moves the invoice to PAYMENT_VERIFICATION_REQUIRED — never to paid;
//  * only payments VERIFIED by the Payment Verification Engine count; VERIFIED_PAID needs verified payments covering the full total;
//  * tax rules are not invented: tax lines carry the rate/amount the caller supplies and a rulesStatus of UNVERIFIED until authoritative rules are provided.
import { createStore, clone } from "./store.mjs";

export const INVOICE_STATES = Object.freeze(["DRAFT", "READY", "ISSUED", "SENT", "PARTIALLY_PAID", "PAID_CLAIMED", "PAYMENT_VERIFICATION_REQUIRED", "VERIFIED_PAID", "OVERDUE", "CANCELLED"]);
const round = n => Math.round(n * 100) / 100;

export function createInvoiceService({ file = null, ownerAuth, lookups = {}, environment = "SANDBOX", now = () => new Date().toISOString(), blackBox = null } = {}) {
  if (!ownerAuth) throw new Error("OWNER_AUTH_REQUIRED");
  const S = createStore({ file, init: () => ({ invoices: {}, seq: 0 }) });
  const must = id => { const v = S.data.invoices[id]; if (!v) throw new Error("UNKNOWN_INVOICE"); return v; };
  const need = (ok, r) => { if (!ok) throw new Error(r); };
  const rec = (kind, v, extra = {}) => { try { blackBox?.record({ kind, resource: v.id, jobId: v.jobId ?? undefined, ...extra }); } catch { /* ignore */ } };
  const move = (v, to, extra = {}) => { v.history.push({ at: now(), from: v.status, to, ...extra }); v.status = to; v.updatedAt = now(); S.save(); rec("INVOICE_" + to, v, { decision: to, reason: extra.reason }); };
  const verifiedPaid = v => (lookups.payments?.(v.id) ?? []).filter(p => p.status === "VERIFIED" && p.environment === environment).reduce((s, p) => s + p.amount, 0);

  function create({ jobId, customerId, items = [], currency = "USD", taxes = [], issueDate = null, dueDate = null, paymentRef = null } = {}) {
    need(jobId && customerId && items.length, "JOB_CUSTOMER_ITEMS_REQUIRED");
    const lines = items.map(x => { const q = Number(x.quantity ?? 1), u = Number(x.unitPrice); need(Number.isFinite(q) && q > 0 && Number.isFinite(u) && u >= 0, "INVALID_LINE"); return { description: String(x.description ?? ""), quantity: q, unitPrice: u, amount: round(q * u) }; });
    const subtotal = round(lines.reduce((s, l) => s + l.amount, 0)); need(subtotal > 0, "INVOICE_AMOUNT_INVALID");
    const taxLines = taxes.map(t => { need(t.name && Number.isFinite(Number(t.rate)), "TAX_LINE_NEEDS_NAME_AND_RATE"); return { name: t.name, rate: Number(t.rate), amount: round(subtotal * Number(t.rate)), jurisdiction: t.jurisdiction ?? null, rulesStatus: t.rulesVerified === true ? "VERIFIED_RULE_SUPPLIED" : "UNVERIFIED" }; });
    const total = round(subtotal + taxLines.reduce((s, t) => s + t.amount, 0));
    const id = "inv-" + String(++S.data.seq).padStart(5, "0"), v = { id, jobId, customerId, items: lines, currency, subtotal, taxes: taxLines, total, issueDate, dueDate, paymentRef, status: "DRAFT", approval: null, communicationId: null, paidClaims: [], environment, createdAt: now(), updatedAt: now(), history: [{ at: now(), from: null, to: "DRAFT" }] };
    S.data.invoices[id] = v; S.save(); rec("INVOICE_DRAFT", v, { decision: "DRAFT" }); return clone(v);
  }
  function ready(id) {
    const v = must(id); need(v.status === "DRAFT", "ONLY_DRAFT_CAN_BE_READY");
    if (lookups.job) { const j = lookups.job(v.jobId); need(j, "JOB_NOT_FOUND"); need(["DELIVERED", "INVOICED"].includes(j.status), "JOB_NOT_DELIVERED"); }
    need(v.dueDate && Number.isFinite(Date.parse(v.dueDate)), "DUE_DATE_REQUIRED"); move(v, "READY"); return clone(v);
  }
  function issue(id, ownerApproval) {
    const v = must(id); need(v.status === "READY", "ONLY_READY_CAN_BE_ISSUED");
    const a = ownerAuth.verifyApproval(ownerApproval, { action: "ISSUE_INVOICE", subject: id + ":" + v.total + ":" + v.currency }); need(a.allowed, "OWNER_APPROVAL_REQUIRED:ISSUE_INVOICE");
    v.approval = { at: now() }; v.issueDate = v.issueDate ?? now().slice(0, 10); move(v, "ISSUED"); return clone(v);
  }
  function markSent(id, communicationId) {
    const v = must(id); need(v.status === "ISSUED", "ONLY_ISSUED_CAN_BE_SENT"); need(lookups.communication, "COMMUNICATION_CENTER_NOT_CONNECTED");
    const c = lookups.communication(communicationId); need(c && ["SENT", "DELIVERED_IF_VERIFIABLE"].includes(c.state) && c.providerRef, "SENT_REQUIRES_PROVIDER_SEND_EVIDENCE"); need(c.environment === environment, "SEND_ENVIRONMENT_MISMATCH");
    v.communicationId = communicationId; move(v, "SENT"); return clone(v);
  }
  /** Customer says they paid. This is a CLAIM: it routes the invoice to verification and nothing more. */
  function claimPaid(id, { claimant, via = "MESSAGE", amount = null } = {}) {
    const v = must(id); need(["SENT", "ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(v.status), "CANNOT_CLAIM_PAYMENT_FROM_" + v.status); need(claimant, "CLAIMANT_REQUIRED");
    v.paidClaims.push({ claimant, via, amount, at: now() }); move(v, "PAID_CLAIMED", { reason: "CLAIM_NOT_EVIDENCE" }); move(v, "PAYMENT_VERIFICATION_REQUIRED"); return clone(v);
  }
  /** Re-evaluate against the Payment Verification Engine. Only VERIFIED payments change monetary status. */
  function reconcile(id) {
    const v = must(id); if (["CANCELLED", "VERIFIED_PAID"].includes(v.status)) return clone(v);
    need(lookups.payments, "PAYMENT_VERIFICATION_NOT_CONNECTED"); const paid = round(verifiedPaid(v));
    if (paid >= v.total) move(v, "VERIFIED_PAID", { reason: "VERIFIED_PAYMENTS_COVER_TOTAL", paid });
    else if (paid > 0 && v.status !== "PARTIALLY_PAID") move(v, "PARTIALLY_PAID", { paid });
    v.verifiedPaid = paid; v.outstanding = round(v.total - paid); S.save(); return clone(v);
  }
  function refreshOverdue(at = now()) {
    const out = [];
    for (const v of Object.values(S.data.invoices)) if (["SENT", "PARTIALLY_PAID", "PAYMENT_VERIFICATION_REQUIRED", "ISSUED"].includes(v.status) && v.dueDate && Date.parse(at) > Date.parse(v.dueDate) + 86400000) { move(v, "OVERDUE"); out.push(v.id); }
    return out;
  }
  function cancel(id, reason) { const v = must(id); need(reason, "REASON_REQUIRED"); need(!["VERIFIED_PAID", "CANCELLED"].includes(v.status), "CANNOT_CANCEL_FROM_" + v.status); need(verifiedPaid(v) === 0, "CANNOT_CANCEL_WITH_VERIFIED_PAYMENT"); move(v, "CANCELLED", { reason }); return clone(v); }
  const get = id => (S.data.invoices[id] ? clone(S.data.invoices[id]) : null);
  const list = (f = {}) => Object.values(S.data.invoices).filter(v => Object.entries(f).every(([k, x]) => v[k] === x)).map(clone);
  const summary = () => Object.fromEntries(INVOICE_STATES.map(s => [s, Object.values(S.data.invoices).filter(v => v.status === s).length]));
  return { create, ready, issue, markSent, claimPaid, reconcile, refreshOverdue, cancel, get, list, summary, environment };
}
