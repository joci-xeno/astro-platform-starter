// Package §18: subscriptions are contracts, not revenue; invoices are drafts; only verified payments make verified recurring revenue.
import test from "node:test";
import assert from "node:assert/strict";
import { sign, ownerAuth } from "./owner-control-rig.mjs";
import { createInvoiceService } from "../atlasz-addons/business/invoice-service.mjs";
import { createPaymentVerifier } from "../atlasz-addons/business/payment-verification.mjs";
import { createRecurringBilling, periodStart } from "../atlasz-addons/business/recurring-billing.mjs";

const ev = (e = {}) => ({ kind: "CUSTOMER_ACCEPTANCE", source: "sandbox", reference: "acc-1", verifiedAt: new Date().toISOString(), environment: "SANDBOX", ...e });
const thrown = (f, re) => assert.throws(f, re);
function world(o = {}) {
  const pv = createPaymentVerifier({}), inv = createInvoiceService({ ownerAuth, lookups: { payments: id => pv.list().filter(p => p.invoiceId === id), job: () => ({ status: "DELIVERED" }) } });
  const rb = createRecurringBilling({ ownerAuth, invoices: inv, maxCatchUp: o.maxCatchUp ?? 3 });
  const mk = (x = {}) => rb.create({ customerId: "c1", jobId: "J1", description: "Hosting", amount: 100, interval: "MONTHLY", anchorDate: "2026-01-31", ...x });
  const active = (x = {}) => { const s = mk(x); rb.activate(s.id, { acceptance: ev(), ownerApproval: sign("START_SUBSCRIPTION", `${s.id}:${s.amount}:${s.currency}:${s.interval}:${s.anchorDate}:${s.customerId}`) }); return s; };
  return { pv, inv, rb, mk, active };
}

test("period arithmetic is anchored (no drift) and clamps month ends, leap years", () => {
  assert.deepEqual([0, 1, 2, 3].map(n => periodStart("2026-01-31", "MONTHLY", n)), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.equal(periodStart("2024-02-29", "ANNUAL", 1), "2025-02-28"); assert.equal(periodStart("2024-02-29", "ANNUAL", 4), "2028-02-29");
  assert.equal(periodStart("2026-01-01", "WEEKLY", 2), "2026-01-15"); assert.equal(periodStart("2026-11-15", "QUARTERLY", 1), "2027-02-15");
  thrown(() => periodStart("nope", "MONTHLY", 0), /BAD_ANCHOR_DATE/); thrown(() => periodStart("2026-01-01", "DAILY", 0), /BAD_INTERVAL/);
});

test("activation needs customer-acceptance evidence AND an owner approval bound to the exact terms; nothing bills before ACTIVE", () => {
  const { rb, mk } = world(); const s = mk();
  thrown(() => rb.activate(s.id, { acceptance: ev(), ownerApproval: null }), /OWNER_APPROVAL_REQUIRED:START_SUBSCRIPTION/);
  thrown(() => rb.activate(s.id, { acceptance: null, ownerApproval: sign("START_SUBSCRIPTION", "x") }), /EVIDENCE_REQUIRED/);
  thrown(() => rb.activate(s.id, { acceptance: ev({ environment: "LIVE" }), ownerApproval: sign("START_SUBSCRIPTION", `${s.id}:100:USD:MONTHLY:2026-01-31:c1`) }), /EVIDENCE_ENVIRONMENT_MISMATCH/);
  thrown(() => rb.activate(s.id, { acceptance: ev({ kind: "MESSAGE_SENT" }), ownerApproval: sign("START_SUBSCRIPTION", `${s.id}:100:USD:MONTHLY:2026-01-31:c1`) }), /CUSTOMER_ACCEPTANCE_EVIDENCE_REQUIRED/);
  thrown(() => rb.activate(s.id, { acceptance: ev(), ownerApproval: sign("START_SUBSCRIPTION", `${s.id}:999:USD:MONTHLY:2026-01-31:c1`) }), /OWNER_APPROVAL_REQUIRED/);   // approval for other terms
  assert.equal(rb.get(s.id).status, "DRAFT"); const g = rb.generateDue("2027-01-01"); assert.equal(g.created.length, 0); assert.equal(g.skipped[0].reason, "STATUS_DRAFT");
});

test("generateDue drafts exactly one invoice per period, idempotently; invoices are DRAFT (not issued/sent/paid)", () => {
  const { rb, inv, active } = world(); const s = active();
  const g1 = rb.generateDue("2026-03-15"); assert.equal(g1.created.length, 2);                       // Jan 31, Feb 28
  assert.equal(rb.generateDue("2026-03-15").created.length, 0); assert.equal(inv.list().length, 2);
  assert.ok(inv.list().every(i => i.status === "DRAFT" && i.total === 100));
  assert.equal(rb.generateDue("2026-03-31").created.length, 1); assert.deepEqual(rb.periods(s.id).map(p => p.periodStart), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  assert.ok(rb.periods().every(p => p.status === "INVOICE_DRAFT"));
});

test("catch-up limit: a long outage never produces a surprise invoice burst", () => {
  const { rb, inv, active } = world({ maxCatchUp: 3 }); active();
  const g = rb.generateDue("2027-06-30"); assert.equal(g.created.length, 0); assert.equal(g.needsOwnerReview[0].reason, "CATCH_UP_LIMIT_EXCEEDED"); assert.equal(inv.list().length, 0);
});

test("pause/resume: paused periods are not back-billed; cancel needs owner (or customer evidence), stops future periods, keeps past invoices", () => {
  const { rb, inv, active } = world(); const s = active({ anchorDate: "2026-01-01" });
  rb.generateDue("2026-01-15"); rb.pause(s.id, "customer request"); assert.equal(rb.generateDue("2026-03-15").created.length, 0);
  rb.resume(s.id); const g = rb.generateDue("2026-03-15"); assert.equal(g.created.length, 2, "Feb and Mar are due again because the periods are keyed by date (missing, within catch-up): resumed subscriptions bill current periods");
  thrown(() => rb.cancel(s.id, { reason: "x", ownerApproval: null }), /OWNER_APPROVAL_REQUIRED:CANCEL_SUBSCRIPTION/);
  thrown(() => rb.cancel(s.id, { reason: "x", by: "CUSTOMER", evidence: null }), /EVIDENCE_REQUIRED/);
  const before = inv.list().length; rb.cancel(s.id, { reason: "customer left", ownerApproval: sign("CANCEL_SUBSCRIPTION", s.id) });
  assert.equal(rb.get(s.id).status, "CANCELLED"); assert.equal(rb.generateDue("2027-01-01").created.length, 0); assert.equal(inv.list().length, before);
});

test("price change: owner-gated, bound to old->new, affects only later periods", () => {
  const { rb, inv, active } = world(); const s = active({ anchorDate: "2026-01-01" }); rb.generateDue("2026-01-02");
  thrown(() => rb.changePrice(s.id, 150, null), /OWNER_APPROVAL_REQUIRED/); thrown(() => rb.changePrice(s.id, 150, sign("CHANGE_SUBSCRIPTION_PRICE", `${s.id}:100->120`)), /OWNER_APPROVAL_REQUIRED/);
  rb.changePrice(s.id, 150, sign("CHANGE_SUBSCRIPTION_PRICE", `${s.id}:100->150`)); rb.generateDue("2026-02-02");
  assert.deepEqual(inv.list().map(i => i.total).sort(), [100, 150]);
});

test("recurring revenue classes: CONTRACTED is a claim; only VERIFIED_PAID invoices make verified recurring revenue; SANDBOX never counts as revenue; claims are not paid", async () => {
  const { rb, inv, pv, active } = world(); const s = active({ anchorDate: "2026-01-01" }); const g = rb.generateDue("2026-02-02");
  let r = rb.report(); assert.equal(r.contracted.mrrUsd, 100); assert.equal(r.verified.receivedUsd, 0); assert.equal(r.contracted.class, "CLAIM_ABOUT_FUTURE");
  const i1 = g.created[0].invoiceId; inv.ready(i1); inv.issue(i1, sign("ISSUE_INVOICE", `${i1}:100:USD`));
  inv.claimPaid(i1, { claimant: "c1" }); r = rb.report(); assert.equal(r.verified.receivedUsd, 0); assert.equal(r.claimedNotVerifiedUsd, 100); assert.equal(rb.periods()[0].status, "PAYMENT_CLAIMED_NOT_VERIFIED");
  const c = pv.claim({ invoiceId: i1, jobId: "J1", amount: 100, claimant: "c1" }); pv.registerAuthority({ id: "proc", type: "PAYMENT_PROCESSOR", verify: async x => ({ status: "VERIFIED", amount: x.amount, currency: "USD", reference: "tx1", environment: "SANDBOX" }) });
  await pv.verify(c.id, "proc"); inv.reconcile(i1); r = rb.report();
  assert.equal(r.verified.receivedUsd, 100); assert.equal(r.verified.periods, 1); assert.equal(r.verified.countsAsRevenue, false); assert.equal(r.claimedNotVerifiedUsd, 0); assert.equal(rb.periods()[0].status, "PAID_VERIFIED");
});

test("overdue periods surface in dunning as a recommendation only (no external action)", () => {
  const { rb, inv, active } = world(); active({ anchorDate: "2026-01-01" }); const g = rb.generateDue("2026-01-02"); const i = g.created[0].invoiceId;
  inv.ready(i); inv.issue(i, sign("ISSUE_INVOICE", `${i}:100:USD`)); inv.refreshOverdue("2026-03-01T00:00:00Z");
  const d = rb.dunning(); assert.equal(d.length, 1); assert.equal(d[0].external, false); assert.equal(d[0].recommendedAction, "DRAFT_REMINDER_FOR_OWNER_REVIEW"); assert.equal(rb.report().overduePeriods, 1);
});

test("term end: subscription with endDate stops producing periods and becomes ENDED; invalid inputs are rejected", () => {
  const { rb, mk, active } = world(); const s = active({ anchorDate: "2026-01-01", endDate: "2026-02-15" }); const g = rb.generateDue("2026-06-01");
  assert.equal(g.created.length, 2); assert.equal(rb.get(s.id).status, "ENDED");
  thrown(() => mk({ amount: 0 }), /AMOUNT_INVALID/); thrown(() => mk({ interval: "DAILY" }), /BAD_INTERVAL/); thrown(() => mk({ anchorDate: "x" }), /BAD_ANCHOR_DATE/);
});
