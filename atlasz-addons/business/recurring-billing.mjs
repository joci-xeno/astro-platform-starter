// Recurring / subscription engine (package §18). A subscription is a CONTRACT, not revenue:
//   DRAFT > ACTIVE (needs customer-acceptance evidence + signed owner approval bound to the exact terms) > PAUSED | CANCELLED | ENDED
// Each billing period yields exactly one invoice DRAFT (idempotent by subscription+period start). This module never issues, sends or collects anything: issue/send/payment stay
// with the Invoice Engine (owner-gated) and the Payment Verification Engine. "Recurring revenue" is reported in two classes that are never combined:
//   CONTRACTED (a claim about the future) and VERIFIED (periods whose invoice is VERIFIED_PAID in this environment). Churn and dunning are recorded, never auto-actioned externally.
import { createStore, clone, needEvidence } from "./store.mjs";

export const SUBSCRIPTION_STATES = Object.freeze(["DRAFT", "ACTIVE", "PAUSED", "CANCELLED", "ENDED"]);
export const INTERVALS = Object.freeze(["WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"]);
const MONTHS = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };
const round = n => Math.round(n * 100) / 100;
const iso = d => d.toISOString().slice(0, 10);
/** UTC date arithmetic with end-of-month clamping (Jan 31 + 1 month = Feb 28/29), always computed from the ANCHOR so drift cannot accumulate. */
export function periodStart(anchor, interval, n) {
  const a = new Date(anchor + "T00:00:00Z"); if (!Number.isFinite(a.getTime())) throw new Error("BAD_ANCHOR_DATE");
  if (interval === "WEEKLY") return iso(new Date(a.getTime() + n * 7 * 86400000));
  const months = MONTHS[interval]; if (!months) throw new Error("BAD_INTERVAL");
  const total = a.getUTCMonth() + n * months, y = a.getUTCFullYear() + Math.floor(total / 12), m = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m, Math.min(a.getUTCDate(), last))));
}

export function createRecurringBilling({ file = null, ownerAuth, invoices, lookups = {}, environment = "SANDBOX", maxCatchUp = 3, now = () => new Date().toISOString(), blackBox = null } = {}) {
  if (!ownerAuth || !invoices) throw new Error("OWNERAUTH_AND_INVOICES_REQUIRED");
  const S = createStore({ file, init: () => ({ subs: {}, periods: {}, seq: 0 }) });
  const need = (ok, r) => { if (!ok) throw new Error(r); };
  const must = id => { const s = S.data.subs[id]; need(s, "UNKNOWN_SUBSCRIPTION"); return s; };
  const rec = (kind, s, extra = {}) => { try { blackBox?.record({ kind, resource: s.id, ...extra }); } catch { /* ignore */ } };
  const move = (s, to, extra = {}) => { s.history.push({ at: now(), from: s.status, to, ...extra }); s.status = to; s.updatedAt = now(); S.save(); rec("SUBSCRIPTION_" + to, s, { decision: to, reason: extra.reason }); };
  const termsSubject = s => `${s.id}:${s.amount}:${s.currency}:${s.interval}:${s.anchorDate}:${s.customerId}`;
  const owner = (ap, action, subject) => { const v = ownerAuth.verifyApproval(ap, { action, subject }); need(v.allowed, "OWNER_APPROVAL_REQUIRED:" + action); };

  function create({ tenantId = "ATLASZ", entityId = null, customerId, jobId, description = "", amount, currency = "USD", interval, anchorDate, endDate = null, taxes = [], dueDays = 14 } = {}) {
    need(customerId && jobId && description !== null, "CUSTOMER_AND_JOB_REQUIRED");
    const a = Number(amount); need(Number.isFinite(a) && a > 0, "AMOUNT_INVALID"); need(INTERVALS.includes(interval), "BAD_INTERVAL"); periodStart(anchorDate, interval, 0);
    need(Number.isInteger(dueDays) && dueDays >= 0 && dueDays <= 120, "BAD_DUE_DAYS");
    const id = "sub-" + String(++S.data.seq).padStart(4, "0");
    const s = { id, tenantId, entityId, customerId, jobId, description, amount: round(a), currency, interval, anchorDate, endDate, taxes, dueDays, status: "DRAFT", acceptance: null, approval: null, priceHistory: [], pausedAt: null, cancelledAt: null, cancelReason: null, environment, createdAt: now(), updatedAt: now(), history: [{ at: now(), from: null, to: "DRAFT" }] };
    S.data.subs[id] = s; S.save(); return clone(s);
  }
  /** The subscription becomes ACTIVE only with real customer-acceptance evidence AND a signed owner approval bound to the exact terms (amount/currency/interval/anchor/customer). */
  function activate(id, { acceptance, ownerApproval } = {}) {
    const s = must(id); need(s.status === "DRAFT", "ONLY_DRAFT_CAN_ACTIVATE");
    needEvidence(acceptance, environment); need(acceptance.kind === "CUSTOMER_ACCEPTANCE", "CUSTOMER_ACCEPTANCE_EVIDENCE_REQUIRED");
    owner(ownerApproval, "START_SUBSCRIPTION", termsSubject(s));
    s.acceptance = { reference: acceptance.reference, source: acceptance.source, at: now() }; s.approval = { at: now(), subject: termsSubject(s) }; move(s, "ACTIVE"); return clone(s);
  }
  const pause = (id, reason = "") => { const s = must(id); need(s.status === "ACTIVE", "ONLY_ACTIVE_CAN_PAUSE"); s.pausedAt = now().slice(0, 10); move(s, "PAUSED", { reason }); return clone(s); };
  function resume(id) { const s = must(id); need(s.status === "PAUSED", "ONLY_PAUSED_CAN_RESUME"); s.pausedAt = null; move(s, "ACTIVE"); return clone(s); }   // periods skipped while paused are NOT back-billed
  /** Cancelling stops FUTURE periods; invoices already created or paid are untouched. A customer-side cancellation is evidence-bound; an owner-side one is owner-approved. */
  function cancel(id, { reason, by = "OWNER", ownerApproval = null, evidence = null } = {}) {
    const s = must(id); need(["DRAFT", "ACTIVE", "PAUSED"].includes(s.status), "NOT_CANCELLABLE"); need(reason, "REASON_REQUIRED");
    if (by === "CUSTOMER") needEvidence(evidence, environment); else owner(ownerApproval, "CANCEL_SUBSCRIPTION", s.id);
    s.cancelledAt = now().slice(0, 10); s.cancelReason = reason; move(s, "CANCELLED", { reason, by }); return clone(s);
  }
  /** A price change needs the owner and applies to periods that start AFTER it; existing period invoices keep their amount. */
  function changePrice(id, newAmount, ownerApproval) {
    const s = must(id); need(["ACTIVE", "PAUSED"].includes(s.status), "NOT_ACTIVE"); const a = Number(newAmount); need(Number.isFinite(a) && a > 0, "AMOUNT_INVALID");
    owner(ownerApproval, "CHANGE_SUBSCRIPTION_PRICE", `${s.id}:${s.amount}->${round(a)}`);
    s.priceHistory.push({ from: s.amount, to: round(a), effectiveFromPeriodAfter: now().slice(0, 10), at: now() }); s.amount = round(a); s.updatedAt = now(); S.save(); return clone(s);
  }

  /** Create invoice DRAFTS for every period that has started on or before `asOf`. Idempotent; paused/cancelled/draft subscriptions bill nothing; more than `maxCatchUp`
   *  missed periods are NOT billed automatically (returned as NEEDS_OWNER_REVIEW) so a long outage can never produce a surprise invoice burst. */
  function generateDue(asOf = now().slice(0, 10)) {
    const out = { created: [], skipped: [], needsOwnerReview: [] };
    for (const s of Object.values(S.data.subs)) {
      if (s.status !== "ACTIVE") { out.skipped.push({ subscriptionId: s.id, reason: "STATUS_" + s.status }); continue; }
      const due = []; for (let n = 0; ; n++) { const st = periodStart(s.anchorDate, s.interval, n); if (st > asOf || (s.endDate && st > s.endDate)) break; due.push({ n, st }); if (n > 5000) break; }
      const missing = due.filter(p => !S.data.periods[s.id + "@" + p.st]);
      if (missing.length > maxCatchUp) { out.needsOwnerReview.push({ subscriptionId: s.id, missingPeriods: missing.length, reason: "CATCH_UP_LIMIT_EXCEEDED" }); continue; }
      for (const p of missing) {
        const key = s.id + "@" + p.st, end = periodStart(s.anchorDate, s.interval, p.n + 1);
        const inv = invoices.create({ jobId: s.jobId, customerId: s.customerId, items: [{ description: `${s.description} (${p.st} to ${end})`.trim(), quantity: 1, unitPrice: s.amount }], currency: s.currency, taxes: s.taxes,
          dueDate: iso(new Date(new Date(p.st + "T00:00:00Z").getTime() + s.dueDays * 86400000)), paymentRef: key });
        S.data.periods[key] = { key, subscriptionId: s.id, periodStart: p.st, periodEnd: end, n: p.n, amount: s.amount, currency: s.currency, invoiceId: inv.id, createdAt: now(), environment };
        out.created.push({ subscriptionId: s.id, key, invoiceId: inv.id, status: "INVOICE_DRAFT" }); rec("SUBSCRIPTION_PERIOD_DRAFTED", s, { reason: key });
      }
      // a finished term ends the subscription (no more periods will ever exist)
      if (s.endDate && periodStart(s.anchorDate, s.interval, due.length) > s.endDate && missing.length <= maxCatchUp) { if (s.status === "ACTIVE") move(s, "ENDED", { reason: "TERM_COMPLETE" }); }
    }
    S.save(); return out;
  }
  /** Period state is DERIVED from the invoice (single source of truth), never stored separately. */
  function periodStatus(p) {
    const inv = lookups.invoice?.(p.invoiceId) ?? invoices.get(p.invoiceId); if (!inv) return "UNKNOWN";
    return inv.status === "VERIFIED_PAID" ? "PAID_VERIFIED" : inv.status === "OVERDUE" ? "OVERDUE" : inv.status === "CANCELLED" ? "CANCELLED" : ["PAID_CLAIMED", "PAYMENT_VERIFICATION_REQUIRED"].includes(inv.status) ? "PAYMENT_CLAIMED_NOT_VERIFIED" : "INVOICE_" + inv.status;
  }
  const periods = (subId) => Object.values(S.data.periods).filter(p => !subId || p.subscriptionId === subId).sort((a, b) => a.periodStart.localeCompare(b.periodStart)).map(p => ({ ...clone(p), status: periodStatus(p) }));
  /** Dunning list: overdue periods that need a reminder. Recommendation only: sending goes through the Communication Center with owner approval. */
  const dunning = () => periods().filter(p => p.status === "OVERDUE").map(p => ({ ...p, recommendedAction: "DRAFT_REMINDER_FOR_OWNER_REVIEW", external: false }));
  function report() {
    const subs = Object.values(S.data.subs), all = periods();
    const active = subs.filter(s => s.status === "ACTIVE"), monthly = s => (s.interval === "WEEKLY" ? s.amount * 52 / 12 : s.amount / MONTHS[s.interval]);
    const verifiedPeriods = all.filter(p => p.status === "PAID_VERIFIED"), claimed = all.filter(p => p.status === "PAYMENT_CLAIMED_NOT_VERIFIED");
    return { environment, subscriptions: Object.fromEntries(SUBSCRIPTION_STATES.map(k => [k, subs.filter(s => s.status === k).length])),
      contracted: { class: "CLAIM_ABOUT_FUTURE", mrrUsd: round(active.reduce((t, s) => t + monthly(s), 0)), note: "Contracted, not received. Never revenue." },
      verified: { class: "VERIFIED_ACTUAL", periods: verifiedPeriods.length, receivedUsd: round(verifiedPeriods.reduce((t, p) => t + p.amount, 0)), countsAsRevenue: environment === "LIVE" },
      claimedNotVerifiedUsd: round(claimed.reduce((t, p) => t + p.amount, 0)), overduePeriods: all.filter(p => p.status === "OVERDUE").length,
      churn: { cancelled: subs.filter(s => s.status === "CANCELLED").length, ended: subs.filter(s => s.status === "ENDED").length, activeAtStart: subs.filter(s => ["ACTIVE", "PAUSED", "CANCELLED", "ENDED"].includes(s.status)).length } };
  }
  const get = id => { const s = S.data.subs[id]; return s ? clone(s) : null; };
  const list = (f = {}) => Object.values(S.data.subs).filter(s => (!f.status || s.status === f.status) && (!f.customerId || s.customerId === f.customerId)).map(clone);
  return { create, activate, pause, resume, cancel, changePrice, generateDue, periods, dunning, report, get, list, environment };
}
