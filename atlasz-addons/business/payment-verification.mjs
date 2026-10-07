// Payment Verification Engine (package §14). CLAIMED -> PENDING_VERIFICATION -> VERIFIED | FAILED | UNKNOWN.
// Payment truth comes ONLY from an authoritative source adapter (payment processor, banking connector, verified transaction source, approved accounting source).
// A customer's "I paid" is a CLAIM and can never become VERIFIED by itself. Only VERIFIED payments enter verified revenue — and only in the engine's own environment.
import { createStore, clone } from "./store.mjs";

export const PAYMENT_STATES = Object.freeze(["CLAIMED", "PENDING_VERIFICATION", "VERIFIED", "FAILED", "UNKNOWN"]);
export const AUTHORITY_TYPES = Object.freeze(["PAYMENT_PROCESSOR", "BANK_CONNECTOR", "VERIFIED_TRANSACTION_SOURCE", "APPROVED_ACCOUNTING_SOURCE"]);

export function createPaymentVerifier({ file = null, environment = "SANDBOX", now = () => new Date().toISOString(), blackBox = null, ledger = null, lookups = {}, entity = "ATLASZ_EXTERNAL" } = {}) {
  const S = createStore({ file, init: () => ({ payments: {}, seq: 0 }) });
  const authorities = new Map();
  const must = id => { const p = S.data.payments[id]; if (!p) throw new Error("UNKNOWN_PAYMENT"); return p; };
  const rec = (kind, p, extra = {}) => { try { blackBox?.record({ kind, resource: p.id, jobId: p.jobId ?? undefined, ...extra }); } catch { /* ignore */ } };
  const move = (p, to, extra = {}) => { p.history.push({ at: now(), from: p.status, to, ...extra }); p.status = to; p.updatedAt = now(); S.save(); rec("PAYMENT_" + to, p, { decision: to, reason: extra.reason }); };

  /** a: {id, type, verify:(claim)=>{status, amount, currency, reference, settledAt, environment}} — supplied by a real provider adapter in LIVE. */
  function registerAuthority(a = {}) { if (!a.id || !AUTHORITY_TYPES.includes(a.type) || typeof a.verify !== "function") throw new Error("AUTHORITY_ID_TYPE_VERIFY_REQUIRED"); authorities.set(a.id, a); return { registered: a.id }; }

  /** A claim: customer message, spreadsheet row, "paid" email... Recorded as a claim only. */
  function claim({ invoiceId, jobId = null, amount, currency = "USD", claimant, via = "MESSAGE", note = null } = {}) {
    const amt = Number(amount); if (!invoiceId || !Number.isFinite(amt) || amt <= 0 || !claimant) throw new Error("INVOICE_AMOUNT_CLAIMANT_REQUIRED");
    const id = "pay-" + String(++S.data.seq).padStart(5, "0"), p = { id, invoiceId, jobId, amount: amt, currency, claimant, via, note, status: "CLAIMED", verification: null, authorityId: null, environment, createdAt: now(), updatedAt: now(), history: [{ at: now(), from: null, to: "CLAIMED" }] };
    S.data.payments[id] = p; S.save(); rec("PAYMENT_CLAIMED", p, { decision: "CLAIMED" }); return clone(p);
  }
  async function verify(id, authorityId) {
    const p = must(id); if (p.status === "VERIFIED") return clone(p);
    const auth = authorities.get(authorityId);
    if (!auth) { if (p.status === "CLAIMED") move(p, "PENDING_VERIFICATION", { reason: "NO_AUTHORITATIVE_SOURCE_CONNECTED" }); return { ...clone(p), authoritative: false, reason: "EXTERNAL_VERIFICATION_REQUIRED:NO_AUTHORITATIVE_SOURCE" }; }
    if (p.status === "CLAIMED") move(p, "PENDING_VERIFICATION", { authorityId });
    let r; try { r = await auth.verify({ paymentId: id, invoiceId: p.invoiceId, amount: p.amount, currency: p.currency }); } catch (e) { move(p, "UNKNOWN", { reason: "AUTHORITY_ERROR:" + String(e.message).slice(0, 60) }); return clone(p); }
    p.authorityId = authorityId;
    if (!r || !["VERIFIED", "FAILED", "PENDING"].includes(r.status)) { move(p, "UNKNOWN", { reason: "AUTHORITY_INCONCLUSIVE" }); return clone(p); }
    if (r.status === "PENDING") { p.history.push({ at: now(), event: "STILL_PENDING" }); S.save(); return clone(p); }
    if (r.status === "FAILED") { p.verification = { status: "FAILED", reason: r.reason ?? "AUTHORITY_SAYS_NOT_RECEIVED", at: now() }; move(p, "FAILED", { reason: p.verification.reason }); return clone(p); }
    // r.status === VERIFIED : cross-check everything the authority tells us against the claim and the system's own records
    const bad = [];
    if ((r.environment ?? "LIVE") !== environment) bad.push("ENVIRONMENT_MISMATCH");
    if (!r.reference) bad.push("NO_AUTHORITY_REFERENCE");
    if (Number(r.amount) !== p.amount) bad.push("AMOUNT_MISMATCH");
    if ((r.currency ?? p.currency) !== p.currency) bad.push("CURRENCY_MISMATCH");
    if (Object.values(S.data.payments).some(o => o.id !== id && o.status === "VERIFIED" && o.verification?.reference === r.reference && o.authorityId === authorityId)) bad.push("DUPLICATE_AUTHORITY_REFERENCE");
    const inv = lookups.invoice?.(p.invoiceId); if (lookups.invoice && !inv) bad.push("INVOICE_NOT_FOUND"); if (inv && inv.currency !== p.currency) bad.push("INVOICE_CURRENCY_MISMATCH");
    if (bad.length) { p.verification = { status: "FAILED", reason: bad.join(","), at: now() }; move(p, "FAILED", { reason: bad.join(",") }); return clone(p); }
    p.verification = { status: "VERIFIED", reference: r.reference, settledAt: r.settledAt ?? null, authorityType: auth.type, at: now(), environment };
    move(p, "VERIFIED", { reference: r.reference });
    if (environment === "LIVE" && ledger && p.jobId) { try { ledger.recordRevenue({ entity, jobId: p.jobId, amountUsd: p.amount, stage: "PAID", confirmedReceived: true, evidence: { source: auth.id, reference: r.reference, verifiedAt: now() } }); } catch (e) { p.ledgerError = String(e.message).slice(0, 80); S.save(); } }
    return clone(p);
  }
  const get = id => (S.data.payments[id] ? clone(S.data.payments[id]) : null);
  const list = () => Object.values(S.data.payments).map(clone);
  const forInvoice = invoiceId => Object.values(S.data.payments).filter(p => p.invoiceId === invoiceId).map(clone);
  /** Verified revenue = VERIFIED payments in THIS environment. SANDBOX engines report countsAsRevenue:false. */
  function verifiedRevenue({ currency = "USD" } = {}) {
    const l = Object.values(S.data.payments).filter(p => p.status === "VERIFIED" && p.currency === currency);
    return { environment, currency, verifiedAmount: l.reduce((s, p) => s + p.amount, 0), payments: l.length, countsAsRevenue: environment === "LIVE", claimedNotVerified: Object.values(S.data.payments).filter(p => ["CLAIMED", "PENDING_VERIFICATION", "UNKNOWN"].includes(p.status)).reduce((s, p) => s + p.amount, 0) };
  }
  const summary = () => Object.fromEntries(PAYMENT_STATES.map(s => [s, Object.values(S.data.payments).filter(p => p.status === s).length]));
  return { registerAuthority, claim, verify, get, list, forInvoice, verifiedRevenue, summary, authorities: () => [...authorities.values()].map(a => ({ id: a.id, type: a.type })), environment };
}
