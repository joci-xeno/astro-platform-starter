// Owner directive: FINANCIAL AND REVENUE ENGINE. One receipt authority (payment-events), unknown stays unknown, event-time accounting in America/Vancouver, documented conversion,
// owner-attested cost completeness, no financial action by target pressure. Everything here is a FIXTURE test (signed fake webhooks, owner test key): no real money, no live Stripe.
import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path"; import { createHmac } from "node:crypto";
import { createProfitObjective, reconcileReceipts, dayOf, dayBounds, BUSINESS_TIME_ZONE, OBJECTIVE } from "../atlasz-addons/daily-profit-objective.mjs";
import { createCostCompleteness, attestationSubject, canonicalCostCategory, COST_CATEGORIES } from "../atlasz-addons/cost-completeness.mjs";
import { createRateBook, rateSubject } from "../atlasz-addons/fx-rates.mjs";
import { assessFinancialAction, isCryptoCurrency, TARGET_OVERRIDES_AUTHORITY } from "../atlasz-addons/financial-guard.mjs";
import { computeAnalytics } from "../atlasz-addons/revenue-analytics.mjs";
import { createFinancialLedger } from "../atlasz-addons/financial-ledger.mjs";
import { createPaymentEventLedger } from "../atlasz-addons/business/payment-events.mjs";
import { ownerAuth, sign } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

const T = "2026-10-12T20:00:00.000Z", SEC = Date.parse(T) / 1000, DAYS = 86400;
const OK = { missing: () => [] };
const pay = (o = {}) => ({ key: "pi_" + Math.random().toString(36).slice(2, 9), state: "PAYMENT_SUCCEEDED", at: SEC, amountMinor: 60000, currency: "usd", feeMinor: 1000, refundedMinor: 0, refundLog: [], dispute: null, invoiceId: "inv-" + Math.random().toString(36).slice(2, 6), ...o });
const mk = (payments, costs = [], extra = {}) => createProfitObjective({ payments: () => payments, costs: () => costs, completeness: OK, now: () => T, ...extra });
const rate = (o = {}) => ({ from: "CAD", to: "USD", rate: 0.72, asOf: T, source: "owner-recorded bank quote 2026-10-12", ...o });
const verify = (a, x) => ownerAuth.verifyApproval(a, x);

test("objective: America/Vancouver is the business day, ABOVE/MET/BELOW are exact at the cent, the minimum is a floor", () => {
  assert.equal(BUSINESS_TIME_ZONE, "America/Vancouver"); assert.equal(OBJECTIVE.timeZone, BUSINESS_TIME_ZONE); assert.deepEqual([...OBJECTIVE.statuses], ["NOT_VERIFIABLE", "BELOW_MINIMUM", "MINIMUM_MET", "ABOVE_MINIMUM"]);
  const at = net => mk([pay({ amountMinor: net + 0, feeMinor: 0 })]).daily();
  assert.equal(at(49999).status, "BELOW_MINIMUM"); assert.equal(at(50000).status, "MINIMUM_MET"); assert.equal(at(50001).status, "ABOVE_MINIMUM"); assert.equal(at(50001).excessOverMinimumUsd, 0.01); assert.equal(at(50001).continueWork, true);
  assert.equal(at(50000).remainingToMinimumUsd, 0);
});
test("midnight: the day changes at Vancouver midnight (PDT and PST), not at UTC midnight", () => {
  assert.equal(dayOf("2026-10-13T06:59:59Z"), "2026-10-12"); assert.equal(dayOf("2026-10-13T07:00:00Z"), "2026-10-13");     // PDT = UTC-7
  assert.equal(dayOf("2026-12-01T07:59:59Z"), "2026-11-30"); assert.equal(dayOf("2026-12-01T08:00:00Z"), "2026-12-01");     // PST = UTC-8
  const late = Date.parse("2026-10-13T06:59:59Z") / 1000, early = Date.parse("2026-10-13T07:00:00Z") / 1000;
  const o = createProfitObjective({ payments: () => [pay({ at: late, amountMinor: 10000, feeMinor: 0 }), pay({ at: early, amountMinor: 20000, feeMinor: 0 })], completeness: OK, now: () => "2026-10-13T12:00:00Z" });
  assert.equal(o.daily("2026-10-12").verifiedGrossReceiptsUsd, 100); assert.equal(o.daily("2026-10-13").verifiedGrossReceiptsUsd, 200); assert.equal(o.daily("2026-10-12").finalised, true); assert.equal(o.daily("2026-10-13").finalised, false); assert.match(o.daily("2026-10-13").provisionalNote, /not finished/);
});
test("daylight saving: the local day is 23 h on spring-forward and 25 h on fall-back; records keep the UTC instant", () => {
  assert.equal(dayBounds("2026-03-08").hours, 23); assert.equal(dayBounds("2026-11-01").hours, 25); assert.equal(dayBounds("2026-10-12").hours, 24);
  assert.equal(dayBounds("2026-11-01").startUtc, "2026-11-01T07:00:00.000Z"); assert.equal(dayBounds("2026-11-01").endUtc, "2026-11-02T08:00:00.000Z");
  assert.equal(dayOf("2026-11-01T08:30:00Z"), "2026-11-01", "the repeated 01:30 hour belongs to one local day"); assert.equal(dayOf("2026-11-02T07:59:59Z"), "2026-11-01"); assert.equal(dayOf("2026-11-02T08:00:00Z"), "2026-11-02");
  const d = mk([]).daily("2026-11-01"); assert.equal(d.bounds.hours, 25); assert.equal(d.timeZone, "America/Vancouver");
});
test("refunds and lost chargebacks reduce the day they HAPPEN, not the day of the payment; history of the paid day is not rewritten", () => {
  const p = pay({ at: SEC - 2 * DAYS, amountMinor: 100000, feeMinor: 0, refundedMinor: 30000, refundLog: [{ id: "re_1", amountMinor: 30000, at: SEC }] });
  const lost = pay({ at: SEC - 3 * DAYS, amountMinor: 50000, feeMinor: 0, dispute: { status: "LOST", at: SEC } });
  const o = mk([p, lost]); const today = o.daily(), paidDay = o.daily(dayOf(new Date((SEC - 2 * DAYS) * 1000).toISOString()));
  assert.equal(paidDay.verifiedGrossReceiptsUsd, 1000); assert.equal(paidDay.refundsUsd, 0); assert.equal(today.verifiedGrossReceiptsUsd, 0); assert.equal(today.refundsUsd, 300); assert.equal(today.chargebacksLostUsd, 500); assert.equal(today.verifiedNetProfitUsd, -800, "a bad day can be negative");
  assert.equal(today.status, "BELOW_MINIMUM"); assert.equal(o.cumulative().verifiedNetProfitUsd, 1500 - 300 - 500 + 0 - 0 + 0 - 0, "all time: receipts 1500 - refund 300 - lost chargeback 500");
});
test("open disputes are held out of results; a WON dispute counts; open dispute is listed", () => {
  const d = mk([pay({ amountMinor: 70000, dispute: { status: "OPEN", at: SEC } }), pay({ amountMinor: 70000, feeMinor: 0, dispute: { status: "WON", at: SEC } })]).daily();
  assert.equal(d.verifiedGrossReceiptsUsd, 700); assert.equal(d.openDisputes.count, 1); assert.equal(d.disputesHeldNotCounted, 1);
});
test("duplicate payment records are counted once; two payments for one invoice are flagged for the owner", () => {
  const a = pay({ key: "pi_same", amountMinor: 10000, feeMinor: 0 }); const d = mk([a, { ...a }]).daily(); assert.equal(d.verifiedGrossReceiptsUsd, 100); assert.equal(d.anomalies.duplicatePaymentRecordsIgnored, 1);
  const two = mk([pay({ invoiceId: "inv-X", amountMinor: 10000, feeMinor: 0 }), pay({ invoiceId: "inv-X", amountMinor: 10000, feeMinor: 0 })]).daily(); assert.equal(two.verifiedGrossReceiptsUsd, 200); assert.deepEqual(two.anomalies.multiplePaymentsForInvoice, ["inv-X"]);
});
test("missing processing fee: net is unknown; the upper bound can still prove 'below minimum'; owner fee evidence resolves it", () => {
  const unknown = mk([pay({ amountMinor: 90000, feeMinor: null })]).daily(); assert.equal(unknown.verifiedNetProfitUsd, null); assert.equal(unknown.status, "NOT_VERIFIABLE"); assert.equal(unknown.processingFeesUsd, null);
  const low = mk([pay({ amountMinor: 30000, feeMinor: null })]).daily(); assert.equal(low.verifiedNetProfitUsd, null); assert.equal(low.status, "BELOW_MINIMUM"); assert.equal(low.statusBasis, "UPPER_BOUND_BELOW_MINIMUM_UNKNOWN_ITEMS_CAN_ONLY_LOWER_IT"); assert.equal(low.remainingToMinimumUsd, null);
});
test("unknown costs are UNKNOWN: with no owner attestation the net is null, never zero; categories are separated", () => {
  const none = createProfitObjective({ payments: () => [pay({ amountMinor: 90000, feeMinor: 0 })], costs: () => [], now: () => T }).daily();
  assert.equal(none.verifiedNetProfitUsd, null); assert.equal(none.status, "NOT_VERIFIABLE"); assert.equal(none.costsComplete, false); assert.ok(none.unresolved.includes("COST_COMPLETENESS_NOT_ATTESTED:AI_USAGE")); assert.ok(none.unresolved.includes("COST_COMPLETENESS_NOT_ATTESTED:HOSTING_INFRA"));
  const costs = [{ at: T, category: "MODEL", amountUsd: 12.5 }, { at: T, category: "hosting", amountUsd: 7.25 }, { at: T, category: "legal fee", amountUsd: 30 }, { at: T, category: "FX", amountUsd: 1 }];
  const d = mk([pay({ amountMinor: 90000, feeMinor: 0 })], costs).daily(); assert.equal(d.aiUsageCostsUsd, 12.5); assert.equal(d.hostingInfraCostsUsd, 7.25); assert.equal(d.otherAttributableCostsUsd, 30); assert.equal(d.currencyConversionCostsUsd, 1); assert.equal(d.operatingCostsUsd, 50.75); assert.equal(d.verifiedNetProfitUsd, 849.25);
  assert.equal(canonicalCostCategory("api"), "AI_USAGE"); assert.equal(canonicalCostCategory("Cloud server"), "HOSTING_INFRA"); assert.equal(canonicalCostCategory("???"), "OTHER_ATTRIBUTABLE");
});
test("corrupted financial records are reported, never trusted, and never turn into a number", () => {
  const bad = [null, { key: 7 }, pay({ amountMinor: -5 }), pay({ amountMinor: 1.5 }), pay({ at: NaN })]; const d = mk(bad, [{ at: "garbage", amountUsd: 5 }, { at: T, amountUsd: -9 }, { at: T, amountUsd: "x" }]).daily();
  assert.equal(d.verifiedNetProfitUsd, null); assert.ok(d.unresolved.some(u => u.startsWith("CORRUPT_PAYMENT_RECORDS_5"))); assert.ok(d.unresolved.some(u => u.startsWith("CORRUPT_COST_RECORDS_3"))); assert.equal(d.status, "NOT_VERIFIABLE");
  const thrown = createProfitObjective({ payments: () => { throw new Error("disk"); }, completeness: OK, now: () => T }).daily(); assert.equal(thrown.verifiedNetProfitUsd, null);
});
test("non-USD receipts: counted only with a documented rate within 72 h; otherwise unverified and the net is unknown", () => {
  const cad = pay({ currency: "cad", amountMinor: 100000, feeMinor: 3000 });
  const ok = mk([cad], [], { rates: () => [rate()] }).daily(); assert.equal(ok.verifiedGrossReceiptsUsd, 720); assert.equal(ok.processingFeesUsd, 21.6); assert.equal(ok.currencyConversion.converted[0].source, "owner-recorded bank quote 2026-10-12"); assert.equal(ok.currencyConversion.converted[0].rate, 0.72);
  assert.ok(ok.unresolved.includes("COST_COMPLETENESS_NOT_ATTESTED:CURRENCY_CONVERSION") === false, "attested stub covers everything"); assert.equal(ok.verifiedNetProfitUsd, 698.4); assert.equal(ok.status, "ABOVE_MINIMUM");
  const required = createProfitObjective({ payments: () => [cad], completeness: { missing: (d, cats) => cats.filter(c => c === "CURRENCY_CONVERSION") }, rates: () => [rate()], now: () => T }).daily(); assert.ok(required.unresolved.includes("COST_COMPLETENESS_NOT_ATTESTED:CURRENCY_CONVERSION"), "conversion costs must be attested when a conversion happened"); assert.equal(required.verifiedNetProfitUsd, null);
  for (const [why, rs] of [["none", []], ["stale", [rate({ asOf: new Date(Date.parse(T) - 4 * 86400_000).toISOString() })]], ["invalid rate", [rate({ rate: -1 })]], ["no source", [rate({ source: "" })]], ["bad time", [rate({ asOf: "nope" })]], ["wrong direction", [{ ...rate(), from: "USD", to: "CAD" }]]]) {
    const d = mk([cad], [], { rates: () => rs }).daily(); assert.equal(d.verifiedNetProfitUsd, null, why); assert.equal(d.verifiedGrossReceiptsUsd, 0, why + ": not counted"); assert.ok(d.unresolved.some(u => u.startsWith("NON_USD_RECEIPTS_NOT_CONVERTED")), why); assert.equal(d.currencyConversion.unverified.length > 0, true, why); }
  assert.equal(mk([pay({ currency: "jpy", amountMinor: 100000, feeMinor: 0 })], [], { rates: () => [rate({ from: "JPY", rate: 0.0067 })] }).daily().verifiedGrossReceiptsUsd, 670, "JPY has no minor unit");
  const closest = mk([cad], [], { rates: () => [rate({ rate: 0.5, asOf: new Date(Date.parse(T) - 40 * 3600_000).toISOString() }), rate({ rate: 0.7 })] }).daily(); assert.equal(closest.currencyConversion.converted[0].rate, 0.7, "the rate nearest the event is used");
});
test("crypto: receipts never count until settlement is verified; services are revenue, investment is prohibited", () => {
  const d = mk([pay({ currency: "usdc", amountMinor: 900000, feeMinor: 0 }), pay({ currency: "btc", amountMinor: 5, feeMinor: 0 })], [], { rates: () => [rate({ from: "USDC", rate: 1 })] }).daily();
  assert.equal(d.verifiedGrossReceiptsUsd, 0); assert.equal(d.verifiedNetProfitUsd, null); assert.equal(d.currencyConversion.cryptoReceiptsNotCounted.length, 2); assert.ok(d.unresolved.some(u => u.startsWith("CRYPTO_RECEIPT_SETTLEMENT_NOT_VERIFIED")));
  assert.equal(isCryptoCurrency("ETH"), true); assert.equal(isCryptoCurrency("cad"), false);
  assert.equal(assessFinancialAction({ action: "CRYPTO_SERVICE_REVENUE" }).allowed, true);
  for (const a of ["CRYPTO_INVESTMENT", "CRYPTO_TRADING", "TOKEN_PURCHASE", "AUTONOMOUS_INVESTMENT"]) { const r = assessFinancialAction({ action: a, approval: sign("FINANCIAL_" + a, ""), verifyApproval: verify, subject: "", targetPressure: true }); assert.equal(r.allowed, false, a); assert.equal(r.reason, "PROHIBITED_BY_POLICY_NO_APPROVAL_CAN_ENABLE", "even a valid owner signature cannot enable speculation"); }
});
test("daily target never overrides owner authority: every money-moving action needs a verified signature for that exact subject", () => {
  assert.equal(TARGET_OVERRIDES_AUTHORITY, false);
  for (const a of ["SPEND", "SUBSCRIBE", "REFUND", "TRANSFER_FUNDS", "SIGN_CONTRACT", "SEND_BINDING_PROPOSAL", "CREATE_LIABILITY", "CHANGE_PAYMENT_DESTINATION", "DISABLE_SECURITY_CONTROL"]) {
    const none = assessFinancialAction({ action: a, targetPressure: true, verifyApproval: verify }); assert.equal(none.allowed, false, a); assert.equal(none.reason, "OWNER_APPROVAL_REQUIRED"); assert.equal(none.targetPressureIgnored, true);
    assert.equal(assessFinancialAction({ action: a, approval: sign("FINANCIAL_" + a, "other-subject"), verifyApproval: verify, subject: "x" }).allowed, false, a + " wrong subject");
    assert.equal(assessFinancialAction({ action: a, approval: sign("FINANCIAL_" + a, "x"), verifyApproval: verify, subject: "x" }).allowed, true, a + " signed");
  }
  assert.equal(assessFinancialAction({ action: "BUY_SOMETHING" }).allowed, false); assert.equal(assessFinancialAction({ action: "SPEND", approval: { forged: 1 }, verifyApproval: () => { throw new Error("x"); } }).allowed, false);
});
test("cost completeness: only a signed, hash-chained owner attestation makes costs known; revocation applies from its day; tampering is detected", () => {
  const d = tmp("cc-"); try {
    let t = T; const now = () => t, cc = () => createCostCompleteness({ dir: d, verifyApproval: verify, now, dayOf: iso => dayOf(iso) });
    const x = cc(), body = { categories: ["AI_USAGE", "HOSTING_INFRA", "OTHER_ATTRIBUTABLE"], fromDay: "2026-10-01", toDay: null }, subj = attestationSubject(body);
    assert.equal(x.attest({ approval: null, ...body }).reason, "OWNER_APPROVAL_REQUIRED"); assert.equal(x.attest({ approval: sign("COST_ATTESTATION", "wrong"), ...body }).reason, "OWNER_APPROVAL_REQUIRED"); assert.equal(x.attest({ approval: sign("COST_ATTESTATION", subj), ...body, categories: ["NOPE"] }).reason, "CATEGORIES_INVALID"); assert.equal(x.attest({ approval: sign("COST_ATTESTATION", subj), ...body, fromDay: "2026-13" }).reason, "PERIOD_INVALID");
    assert.deepEqual(x.missing("2026-10-12"), [...COST_CATEGORIES]); const r = x.attest({ approval: sign("COST_ATTESTATION", subj), ...body }); assert.equal(r.ok, true); assert.equal(x.attest({ approval: sign("COST_ATTESTATION", subj), ...body }).duplicate, true);
    assert.deepEqual(x.missing("2026-10-12"), ["CURRENCY_CONVERSION"]); assert.deepEqual(x.missing("2026-09-30").length, 4, "before the period: unknown");
    const o = createProfitObjective({ payments: () => [pay({ amountMinor: 90000, feeMinor: 0 })], costs: () => [], completeness: cc(), now: () => t }); assert.equal(o.daily().verifiedNetProfitUsd, 900);
    t = "2026-10-14T20:00:00Z"; assert.equal(cc().revoke({ approval: null, id: r.id }).reason, "OWNER_APPROVAL_REQUIRED"); assert.equal(cc().revoke({ approval: sign("COST_ATTESTATION_REVOKE", r.id), id: r.id }).revokedFromDay, "2026-10-14");
    assert.deepEqual(cc().missing("2026-10-13").filter(c => c !== "CURRENCY_CONVERSION"), [], "earlier days stay vouched for"); assert.equal(cc().missing("2026-10-14").length, 4, "later days are unknown again"); assert.equal(cc().verify().ok, true);
    const f = path.join(d, "cost-attestations.jsonl"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("2026-10-01", "2025-01-01")); assert.throws(() => cc(), /AUDIT_CHAIN_TAMPERED/, "an edited attestation is detected and refused");
  } finally { rm(d); }
});
test("exchange-rate book: owner-signed, documented, append-only; invented, future-dated or source-less rates are refused", () => {
  const d = tmp("fx-"); try {
    const b = createRateBook({ dir: d, verifyApproval: verify, now: () => T }), good = { from: "cad", rate: 0.72, asOf: T, source: "bank quote" }, ok = { ...good, from: "CAD", asOf: new Date(T).toISOString() };
    assert.equal(b.record({ approval: null, ...good }).reason, "OWNER_APPROVAL_REQUIRED"); assert.equal(b.record({ approval: sign("FX_RATE_RECORD", "x"), ...good }).reason, "OWNER_APPROVAL_REQUIRED");
    for (const [w, o] of [["usd", { from: "USD" }], ["neg", { rate: -2 }], ["nan", { rate: NaN }], ["future", { asOf: "2030-01-01T00:00:00Z" }], ["nosrc", { source: " " }], ["badts", { asOf: "x" }]]) assert.equal(b.record({ approval: sign("FX_RATE_RECORD", "z"), ...good, ...o }).ok, false, w);
    const r = b.record({ approval: sign("FX_RATE_RECORD", rateSubject(ok)), ...good }); assert.equal(r.ok, true); assert.equal(b.record({ approval: sign("FX_RATE_RECORD", rateSubject(ok)), ...good }).duplicate, true); assert.deepEqual(b.list().map(x => [x.from, x.to, x.rate]), [["CAD", "USD", 0.72]]); assert.equal(b.verify().ok, true);
    assert.equal(createRateBook({ dir: d, verifyApproval: verify, now: () => T }).list().length, 1, "survives restart");
  } finally { rm(d); }
});
test("cost ledger refuses the same bill/usage reference twice (retry, restart, duplicate event) but allows distinct references", () => {
  const d = tmp("led-"); try { const L = createFinancialLedger({ dir: d }), ev = ref => ({ source: "provider-invoice", reference: ref, verifiedAt: T });
    L.recordCost({ category: "MODEL", amountUsd: 3, evidence: ev("inv-9") }); assert.throws(() => L.recordCost({ category: "MODEL", amountUsd: 3, evidence: ev("inv-9") }), /DUPLICATE_COST_REFERENCE/); L.recordCost({ category: "MODEL", amountUsd: 3, evidence: ev("inv-10") });
    assert.throws(() => createFinancialLedger({ dir: d }).recordCost({ category: "MODEL", amountUsd: 3, evidence: ev("inv-9") }), /DUPLICATE_COST_REFERENCE/, "also after restart"); assert.throws(() => L.recordCost({ category: "X", amountUsd: 5, evidence: null }), /COST_REQUIRES_EVIDENCE/); assert.equal(L.summary().costs.totalUsd, 6); } finally { rm(d); }
});
test("reconciliation: a cost-ledger PAID entry without a processor-confirmed payment is reported and never a receipt", () => {
  const p = pay({ key: "pi_ok", invoiceId: "inv-1", amountMinor: 50000 }), led = [{ type: "REVENUE", stage: "PAID", jobId: "j1", amountUsd: 500, evidence: { reference: "pi_ok" } }, { type: "REVENUE", stage: "PAID", jobId: "j2", amountUsd: 900, evidence: { reference: "manual-claim" } }, { type: "REVENUE", stage: "PAID", jobId: "j3", amountUsd: 10, evidence: { reference: "inv-1" } }];
  const r = reconcileReceipts({ payments: [p], ledgerEntries: led }); assert.equal(r.matched, 1); assert.equal(r.ledgerPaidWithoutProcessorEvent.length, 1); assert.equal(r.ledgerPaidWithoutProcessorEvent[0].reference, "manual-claim"); assert.equal(r.amountMismatches.length, 1); assert.equal(r.clean, false); assert.equal(r.authority, "PAYMENT_EVENTS_LEDGER_ONLY");
  assert.equal(reconcileReceipts({ payments: [p], ledgerEntries: [] }).processorPaymentsNotBooked.length, 1);
  const d = mk([p], [], {}).daily(); assert.equal(d.verifiedGrossReceiptsUsd, 500, "the objective counts the processor payment once, not the ledger entries");
});
test("outstanding invoices and pending payments are shown apart from results; bank settlement is separate from processor confirmation", () => {
  const d = mk([pay({ state: "PAYMENT_PENDING", amountMinor: 90000 })], [], { invoices: () => [{ id: "i1", amount: 1200, currency: "USD", status: "SENT" }, { id: "i2", amount: 50, currency: "CAD", status: "OVERDUE" }, { id: "i3", amount: 999, currency: "USD", status: "PAID" }, { id: "i4", amount: 5, currency: "USD", status: "DRAFT" }], settlement: () => ({ payouts: { paidByProcessorNotBankConfirmed: 2, bankReconciled: 0 }, money: { bankReconciledMinor: 0 } }) }).daily();
  assert.equal(d.outstandingInvoices.count, 2); assert.deepEqual(d.outstandingInvoices.byCurrency, { USD: 1200, CAD: 50 }); assert.equal(d.outstandingInvoices.kind, "INVOICE_NOT_PAID"); assert.equal(d.verifiedGrossReceiptsUsd, 0); assert.equal(d.pendingUncollected.usd, 900);
  assert.equal(d.bankSettlement.processorPaidNotBankConfirmed, 2); assert.equal(d.bankSettlement.bankReconciledPayouts, 0); assert.equal(mk([]).daily().outstandingInvoices.state, "NOT_CONNECTED");
});
// ---- real payment-events ledger (signed FIXTURE webhooks): event time, delayed confirmation, test-mode, refund by event time, fee evidence, restart ----
const SECRET = "whsec_" + "fixture_secret_0123456789abcdef", sigOf = (body, t) => "t=" + t + ",v1=" + createHmac("sha256", SECRET).update(t + "." + body).digest("hex");
const evt = (id, type, object, created, o = {}) => JSON.stringify({ id, type, livemode: true, created, data: { object }, ...o });
const feed = (L, body, created) => L.ingest({ rawBody: body, signatureHeader: sigOf(body, created), nowSec: created });
const ledger = (d, o = {}) => createPaymentEventLedger({ dir: path.join(d, "pe"), secretFor: () => SECRET, ...o });
test("payment-events -> objective: delayed confirmation keeps the event day; refund dates by refund time; processor fee from balance transaction; duplicates and restart change nothing", () => {
  const d = tmp("fe-"); try {
    const day1 = Math.floor(Date.parse("2026-10-12T18:00:00Z") / 1000), day2 = Math.floor(Date.parse("2026-10-13T18:00:00Z") / 1000);
    let L = ledger(d); const pi = { object: "payment_intent", id: "pi_A", amount: 80000, amount_received: 80000, currency: "usd", metadata: { invoice_id: "inv-A" } };
    feed(L, evt("evt_1", "payment_intent.succeeded", { ...pi, balance_transaction: { id: "txn_1", fee: 2500, currency: "usd" } }, day1), day1);
    const dupe = feed(L, evt("evt_1", "payment_intent.succeeded", { ...pi, balance_transaction: { id: "txn_1", fee: 2500, currency: "usd" } }, day1), day1); assert.equal(dupe.status, "DUPLICATE");
    assert.equal(L.payment("pi_A").feeMinor, 2500); assert.equal(L.payment("pi_A").feeEvidence.source, "PROCESSOR_BALANCE_TRANSACTION");
    const obj = () => createProfitObjective({ payments: () => L.listPayments(), completeness: OK, costs: () => [], now: () => "2026-10-14T12:00:00Z" });
    assert.equal(obj().daily("2026-10-12").verifiedNetProfitUsd, 775); assert.equal(obj().daily("2026-10-12").status, "ABOVE_MINIMUM");
    feed(L, evt("evt_2", "refund.created", { object: "refund", id: "re_1", payment_intent: "pi_A", amount: 20000, currency: "usd" }, day2), day2);
    L = ledger(d);   // restart
    assert.equal(obj().daily("2026-10-12").verifiedNetProfitUsd, 775, "the paid day is not rewritten"); assert.equal(obj().daily("2026-10-13").refundsUsd, 200); assert.equal(obj().daily("2026-10-13").verifiedNetProfitUsd, -200); assert.equal(obj().cumulative().verifiedNetProfitUsd, 575);
    feed(L, evt("evt_3", "charge.dispute.closed", { object: "dispute", id: "dp_1", payment_intent: "pi_A", status: "lost" }, day2 + 3600), day2 + 3600);
    assert.equal(L.payment("pi_A").dispute.status, "LOST"); assert.equal(obj().daily("2026-10-13").chargebacksLostUsd, 600, "amount minus what was already refunded"); assert.equal(L.verify().ok, true);
  } finally { rm(d); }
});
test("payment-events -> objective: test-mode events and wrong-environment ledgers never become revenue; missing webhook secret records nothing", () => {
  const d = tmp("fe2-"); try { const t = Math.floor(Date.parse("2026-10-12T18:00:00Z") / 1000), L = ledger(d);
    const r = feed(L, evt("evt_t", "payment_intent.succeeded", { object: "payment_intent", id: "pi_T", amount: 99999999, currency: "usd" }, t, { livemode: false }), t); assert.equal(r.status, "IGNORED_ENVIRONMENT_MISMATCH"); assert.equal(L.listPayments().length, 0);
    const none = createPaymentEventLedger({ dir: path.join(d, "none"), secretFor: () => null }), b = evt("evt_x", "payment_intent.succeeded", { object: "payment_intent", id: "pi_X", amount: 1, currency: "usd" }, t); assert.equal(none.ingest({ rawBody: b, signatureHeader: sigOf(b, t), nowSec: t }).status, "SECRET_NOT_CONFIGURED"); assert.equal(none.listPayments().length, 0);
    const sandbox = createPaymentEventLedger({ dir: path.join(d, "sb"), environment: "SANDBOX", secretFor: () => SECRET }); feed(sandbox, evt("evt_s", "payment_intent.succeeded", { object: "payment_intent", id: "pi_S", amount: 9999999, currency: "usd" }, t, { livemode: false }), t);
    const o = createProfitObjective({ environment: "SANDBOX", payments: () => sandbox.listPayments(), completeness: OK, now: () => "2026-10-12T20:00:00Z" }).daily(); assert.equal(o.verifiedGrossReceiptsUsd, null); assert.equal(o.verifiedNetProfitUsd, null); assert.equal(o.status, "NOT_VERIFIABLE"); assert.ok(o.unresolved.includes("ENVIRONMENT_NOT_LIVE_NEVER_REVENUE"));
  } finally { rm(d); }
});
test("fee evidence: only owner-authorised, same-currency, never replaces a recorded fee; non-USD ledger summary does not pretend a mixed net", () => {
  const d = tmp("fe3-"); try { const t = Math.floor(Date.parse("2026-10-12T18:00:00Z") / 1000), L = ledger(d);
    feed(L, evt("evt_a", "payment_intent.succeeded", { object: "payment_intent", id: "pi_F", amount: 50000, currency: "cad" }, t), t); assert.equal(L.payment("pi_F").feeMinor, null);
    assert.equal(L.attachFee("pi_F", { feeMinor: 1500, currency: "cad", source: "stripe-balance-report", reference: "txn_9" }).reason, "OWNER_AUTHORISED_FEE_EVIDENCE_REQUIRED"); assert.equal(L.attachFee("pi_F", { feeMinor: 1500, currency: "usd", source: "s", reference: "r", ownerApproved: true }).reason, "FEE_CURRENCY_MISMATCH");
    assert.equal(L.attachFee("pi_F", { feeMinor: -1, currency: "cad", source: "s", reference: "r", ownerApproved: true }).reason, "FEE_EVIDENCE_INCOMPLETE"); assert.equal(L.attachFee("nope", { ownerApproved: true }).reason, "UNKNOWN_PAYMENT");
    assert.equal(L.attachFee("pi_F", { feeMinor: 1500, currency: "CAD", source: "stripe-balance-report", reference: "txn_9", ownerApproved: true }).ok, true); assert.equal(L.attachFee("pi_F", { feeMinor: 1500, currency: "cad", source: "x", reference: "y", ownerApproved: true }).duplicate, true); assert.equal(L.attachFee("pi_F", { feeMinor: 9, currency: "cad", source: "x", reference: "y", ownerApproved: true }).reason, "FEE_ALREADY_RECORDED_DIFFERENT");
    feed(L, evt("evt_b", "payment_intent.succeeded", { object: "payment_intent", id: "pi_G", amount: 1000, currency: "usd", application_fee_amount: 10 }, t), t); assert.equal(L.summary().money.netMinor, null, "two currencies: no mixed net"); assert.deepEqual(L.summary().money.currencies.sort(), ["cad", "usd"]);
  } finally { rm(d); }
});
test("analytics: actuals and estimates are separate; conversion rates need a real sample; unknown stays null", () => {
  const few = computeAnalytics({ metrics: { discovered: 4, validated: 2, qualified: 1, proposalsPrepared: 1, proposalsSubmittedAuthorized: 0, contractsAccepted: 0, jobsCompleted: 0 }, payments: [], net: null, estimates: { expectedUsd: 100000 } });
  assert.equal(few.actual.conversion.verifiedOfDiscovered.value, null); assert.match(few.actual.conversion.verifiedOfDiscovered.reason, /INSUFFICIENT_SAMPLE/); assert.equal(few.estimates.addedToActuals, false); assert.equal(few.estimates.kind, "ESTIMATE_NOT_ACTUAL"); assert.equal(few.actual.averageCostPerCompletedJob.reason, "NO_COMPLETED_JOBS"); assert.equal(few.actual.actualNetMargin.reason, "NET_PROFIT_NOT_VERIFIED");
  const many = computeAnalytics({ metrics: { discovered: 40, validated: 20, qualified: 10, proposalsPrepared: 5, proposalsSubmittedAuthorized: 4, contractsAccepted: 2, jobsCompleted: 2 }, payments: [{ state: "PAYMENT_SUCCEEDED" }], costs: [{ jobId: "j1", amountUsd: 10 }, { jobId: "j2", amountUsd: 20 }, { jobId: "other", amountUsd: 99 }], completedJobIds: ["j1", "j2"], net: 80, grossUsd: 200, costsComplete: true });
  assert.equal(many.actual.conversion.verifiedOfDiscovered.value, 50); assert.equal(many.actual.conversion.qualifiedOfVerified.value, 50); assert.equal(many.actual.conversion.contractsOfApprovedProposals.value, null); assert.equal(many.actual.averageCostPerCompletedJob.value, 15); assert.equal(many.actual.actualNetMargin.value, 40); assert.equal(many.actual.counts.paymentsVerified, 1);
});
test("NET_PROFIT stage: self-reported 'reconciled/costsRecorded' flags are not evidence; the payment ledger plus the owner cost attestation are", async () => {
  const { evaluateStageEntry } = await import("../atlasz-addons/workflow-stages.mjs");
  const claim = { reconciliation: { reconciled: true, costsRecorded: true, paymentKey: "pi_1" } };
  assert.equal(evaluateStageEntry("NET_PROFIT", claim).ok, false, "no authority: refused"); assert.equal(evaluateStageEntry("NET_PROFIT", claim, { verify: () => false }).ok, false);
  const good = pay({ key: "pi_1", feeMinor: 100 }), objOf = (p, extra = {}) => mk(Array.isArray(p) ? p : [p], [], extra);
  assert.deepEqual(objOf(good).paymentNetVerified("pi_1"), { ok: true, day: dayOf(T), paymentKey: "pi_1" });
  const why = (p, extra) => objOf(p, extra).paymentNetVerified(p.key).reason;
  assert.equal(objOf(good).paymentNetVerified("nope").reason, "UNKNOWN_PAYMENT"); assert.equal(why(pay({ key: "p2", state: "PAYMENT_PENDING" })), "NOT_PROCESSOR_CONFIRMED"); assert.equal(why(pay({ key: "p3", feeMinor: null })), "PROCESSING_FEE_UNKNOWN");
  assert.equal(why(pay({ key: "p4", dispute: { status: "OPEN", at: SEC } })), "DISPUTE_NOT_RESOLVED_IN_OUR_FAVOUR"); assert.equal(why(pay({ key: "p5", currency: "usdc" })), "CRYPTO_SETTLEMENT_NOT_VERIFIED"); assert.equal(why(pay({ key: "p6", currency: "cad" })), "NO_DOCUMENTED_RATE");
  assert.match(why(pay({ key: "p7" }), { completeness: { missing: () => ["AI_USAGE"] } }), /^COST_COMPLETENESS_NOT_ATTESTED:AI_USAGE/); assert.equal(why(pay({ key: "p8" }), { environment: "SANDBOX" }), "ENVIRONMENT_NOT_LIVE");
  assert.equal(evaluateStageEntry("NET_PROFIT", claim, { verify: (a, e) => a === "NET_PROFIT_VERIFIED" && objOf(good).paymentNetVerified(e.paymentKey).ok }).ok, true);
});
