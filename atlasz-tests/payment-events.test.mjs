import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path"; import { createHmac } from "node:crypto";
import { createPaymentEventLedger, verifyWebhookSignature } from "../atlasz-addons/business/payment-events.mjs";
import { createPaymentVerifier } from "../atlasz-addons/business/payment-verification.mjs";
import { tmp, rm } from "./helpers.mjs";
const SECRET = "whsec_" + "unit_test_secret_value_0123456789", T0 = 1_800_000_000;
const sig = (body, t = T0, secret = SECRET) => "t=" + t + ",v1=" + createHmac("sha256", secret).update(t + "." + body).digest("hex");
const ev = (id, type, object, extra = {}) => JSON.stringify({ id, type, livemode: true, created: T0, data: { object }, ...extra });
const pi = (o = {}) => ({ object: "payment_intent", id: "pi_1", amount: 20000, currency: "usd", metadata: { invoice_id: "inv-1" }, ...o });
const mk = (d, o = {}) => { const sec = []; return { sec, L: createPaymentEventLedger({ dir: path.join(d, "pe"), secretFor: () => SECRET, onSecurityEvent: e => sec.push(e), ...o }) }; };
const send = (L, body, t = T0, s = SECRET) => L.ingest({ rawBody: body, signatureHeader: sig(body, t, s), nowSec: T0 });

test("signature: only the exact raw bytes signed with the secret within the tolerance verify", () => {
  const b = ev("evt_1", "payment_intent.succeeded", pi());
  assert.equal(verifyWebhookSignature({ rawBody: b, header: sig(b), secret: SECRET, nowSec: T0 }).ok, true);
  for (const [n, a] of [["wrong secret", { header: sig(b, T0, "whsec_other") }], ["tampered body", { rawBody: b.replace("20000", "99999") }], ["old", { header: sig(b, T0 - 4000) }], ["future", { header: sig(b, T0 + 4000) }], ["malformed", { header: "v1=zz" }], ["missing", { header: undefined }], ["pretty-printed body", { rawBody: JSON.stringify(JSON.parse(b), null, 1) }]])
    assert.equal(verifyWebhookSignature({ rawBody: b, header: sig(b), secret: SECRET, nowSec: T0, ...a }).ok, false, n);
  assert.equal(verifyWebhookSignature({ rawBody: b, header: sig(b), secret: null, nowSec: T0 }).reason, "SECRET_NOT_CONFIGURED");
});
test("no webhook secret (Stripe not connected): every event is refused and nothing is recorded", () => {
  const d = tmp("pe-"); try { const L = createPaymentEventLedger({ dir: path.join(d, "pe"), secretFor: () => null }); const b = ev("evt_1", "payment_intent.succeeded", pi()); const r = L.ingest({ rawBody: b, signatureHeader: sig(b), nowSec: T0 });
    assert.equal(r.status, "SECRET_NOT_CONFIGURED"); assert.equal(r.processed, false); assert.equal(L.summary().eventsProcessed, 0); } finally { rm(d); }
});
test("forged or tampered webhooks are rejected, audited as security events, and change nothing", () => {
  const d = tmp("pe-"); try { const { L, sec } = mk(d); const b = ev("evt_1", "payment_intent.succeeded", pi());
    assert.equal(send(L, b, T0, "whsec_attacker").status, "REJECTED_SIGNATURE"); assert.equal(L.ingest({ rawBody: b.replace("20000", "1"), signatureHeader: sig(b), nowSec: T0 }).status, "REJECTED_SIGNATURE");
    assert.equal(sec.length, 2); assert.equal(L.summary().payments.succeededProcessorConfirmed, 0); assert.equal(L.verify().ok, true); } finally { rm(d); }
});
test("duplicate webhook events are processed once, also after restart; same id with a different body is a CONFLICT security event", () => {
  const d = tmp("pe-"); try { const { L, sec } = mk(d); const b = ev("evt_dup", "payment_intent.succeeded", pi());
    assert.equal(send(L, b).status, "PROCESSED"); assert.equal(send(L, b).status, "DUPLICATE"); assert.equal(L.summary().payments.succeededProcessorConfirmed, 1);
    const m2 = mk(d), L2 = m2.L; assert.equal(send(L2, b).status, "DUPLICATE");
    const forged = ev("evt_dup", "payment_intent.succeeded", pi({ amount: 1 })); assert.equal(send(L2, forged).status, "CONFLICT"); assert.equal(mk(d).L.summary().money.grossProcessorConfirmedMinor, 20000);
    assert.ok(m2.sec.some(e => e.type === "EVENT_ID_REPLAYED_WITH_DIFFERENT_BODY")); assert.equal(sec.length, 0); } finally { rm(d); }
});
test("payment states are kept apart and never regress: initiated / pending / succeeded / failed; late older events are ignored", () => {
  const d = tmp("pe-"); try { const { L } = mk(d);
    send(L, ev("evt_a", "payment_intent.created", pi())); assert.equal(L.summary().payments.initiated, 1); assert.equal(L.summary().money.grossProcessorConfirmedMinor, null);
    send(L, ev("evt_b", "payment_intent.processing", pi())); assert.equal(L.summary().payments.pending, 1); assert.equal(L.summary().money.grossProcessorConfirmedMinor, null, "pending is not money");
    send(L, ev("evt_c", "payment_intent.succeeded", pi())); assert.equal(L.summary().payments.succeededProcessorConfirmed, 1);
    const late = send(L, ev("evt_d", "payment_intent.processing", pi())); assert.equal(late.applied, false); assert.equal(L.payment("pi_1").state, "PAYMENT_SUCCEEDED");
    const fail = send(L, ev("evt_e", "payment_intent.payment_failed", pi())); assert.equal(fail.applied, false, "a conflicting terminal event is flagged, not applied");
  } finally { rm(d); }
});
test("test-mode events never count in a LIVE ledger (and live events never in a SANDBOX ledger)", () => {
  const d = tmp("pe-"); try { const { L } = mk(d); const r = send(L, ev("evt_t", "payment_intent.succeeded", pi(), { livemode: false })); assert.equal(r.status, "IGNORED_ENVIRONMENT_MISMATCH"); assert.equal(L.summary().payments.succeededProcessorConfirmed, 0);
    const d2 = tmp("pe-"); const s = mk(d2, { environment: "SANDBOX" }).L; assert.equal(send(s, ev("evt_l", "payment_intent.succeeded", pi())).status, "IGNORED_ENVIRONMENT_MISMATCH"); rm(d2); } finally { rm(d); }
});
test("payout PAID by the processor is NOT a bank receipt: bank reconciliation needs owner-authorised evidence with the exact amount and currency", () => {
  const d = tmp("pe-"); try { const { L } = mk(d); const po = { object: "payout", id: "po_1", amount: 19000, currency: "usd" };
    send(L, ev("evt_p1", "payout.created", po)); assert.equal(L.summary().payouts.initiated, 1); send(L, ev("evt_p2", "payout.paid", po));
    assert.equal(L.summary().payouts.paidByProcessorNotBankConfirmed, 1); assert.equal(L.summary().payouts.bankReconciled, 0); assert.equal(L.summary().money.bankReconciledMinor, 0);
    const good = { reference: "stmt-77", amountMinor: 19000, currency: "USD", receivedAt: "2026-10-15", source: "bank-connector" };
    assert.equal(L.reconcileBank("po_1", { evidence: good, ownerApproved: false }).reason, "OWNER_AUTHORISED_BANK_DATA_REQUIRED");
    assert.equal(L.reconcileBank("po_1", { evidence: { ...good, amountMinor: 18999 }, ownerApproved: true }).reason, "BANK_EVIDENCE_AMOUNT_OR_CURRENCY_MISMATCH");
    assert.equal(L.reconcileBank("po_1", { evidence: { reference: "x" }, ownerApproved: true }).reason, "BANK_EVIDENCE_INCOMPLETE");
    assert.equal(L.reconcileBank("po_1", { evidence: good, ownerApproved: true }).ok, true); assert.equal(L.summary().payouts.bankReconciled, 1); assert.equal(L.summary().money.bankReconciledMinor, 19000);
    send(L, ev("evt_p3", "payout.failed", po)); assert.equal(L.payout("po_1").state, "BANK_RECONCILED", "a late event cannot undo a reconciled payout");
    send(L, ev("evt_p4", "payout.failed", { ...po, id: "po_2" })); assert.equal(L.summary().payouts.failed, 1);
    assert.equal(L.reconcileBank("po_2", { evidence: good, ownerApproved: true }).reason, "PAYOUT_NOT_PAID_BY_PROCESSOR"); } finally { rm(d); }
});
test("net revenue is UNKNOWN (null) while any fee is unknown; refunds reduce it; disputes are tracked", () => {
  const d = tmp("pe-"); try { const { L } = mk(d); send(L, ev("evt_1", "payment_intent.succeeded", pi())); assert.equal(L.summary().money.netMinor, null); assert.equal(L.summary().money.feesMinor, null);
    send(L, ev("evt_2", "charge.refunded", { object: "charge", id: "ch_1", payment_intent: "pi_1", amount_refunded: 5000, currency: "usd" })); assert.equal(L.summary().money.refundedMinor, 5000);
    send(L, ev("evt_3", "charge.dispute.created", { object: "dispute", id: "dp_1", payment_intent: "pi_1", amount: 20000, currency: "usd" })); assert.equal(L.summary().payments.disputesOpen, 1);
    const d2 = tmp("pe-"); const f = mk(d2).L; send(f, ev("evt_f", "payment_intent.succeeded", pi({ application_fee_amount: 600 }))); assert.equal(f.summary().money.netMinor, 19400); rm(d2); } finally { rm(d); }
});
test("as an authority for the payment-verification engine: only a processor-confirmed, exact, undisputed, not fully refunded payment becomes VERIFIED", async () => {
  const d = tmp("pe-"); try { const { L } = mk(d); const pv = createPaymentVerifier({ environment: "LIVE" }); pv.registerAuthority(L.authority());
    const c1 = pv.claim({ invoiceId: "inv-1", amount: 200, currency: "USD", claimant: "cust" }); assert.notEqual((await pv.verify(c1.id, "stripe-webhook-ledger")).status, "VERIFIED", "nothing confirmed yet");
    send(L, ev("evt_1", "payment_intent.succeeded", pi())); const c2 = pv.claim({ invoiceId: "inv-1", amount: 200, currency: "USD", claimant: "cust" }); assert.equal((await pv.verify(c2.id, "stripe-webhook-ledger")).status, "VERIFIED");
    const c3 = pv.claim({ invoiceId: "inv-1", amount: 150, currency: "USD", claimant: "cust" }); assert.notEqual((await pv.verify(c3.id, "stripe-webhook-ledger")).status, "VERIFIED", "wrong amount");
    send(L, ev("evt_3", "charge.dispute.created", { object: "dispute", id: "dp", payment_intent: "pi_1", amount: 20000, currency: "usd" })); const c4 = pv.claim({ invoiceId: "inv-1", amount: 200, currency: "USD", claimant: "cust" }); assert.notEqual((await pv.verify(c4.id, "stripe-webhook-ledger")).status, "VERIFIED", "open dispute");
  } finally { rm(d); }
});
test("the ledger can only RECEIVE: no money-moving API exists, no network/process module is imported, and a damaged store fails closed", () => {
  const d = tmp("pe-"); try { const { L } = mk(d); assert.deepEqual(Object.keys(L).sort(), ["attachFee", "authority", "confirmedPayment", "ingest", "listPayments", "payment", "payout", "reconcileBank", "summary", "verify"]);
    const src = fs.readFileSync(new URL("../atlasz-addons/business/payment-events.mjs", import.meta.url), "utf8"); assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /node:(http|https|net|child_process|dns|tls)|fetch\(|XMLHttpRequest|refund\w*\(|createTransfer|createPayout/);
    fs.writeFileSync(path.join(d, "pe", "payment-events.json"), "{broken"); assert.throws(() => mk(d), /PAYMENT_EVENT_STORE_UNREADABLE/); } finally { rm(d); }
});
test("confirmedPayment (stage gate lookup): exact amount+currency, processor-confirmed, not fully refunded, no open dispute; anything else is not verified", () => {
  const d = tmp("pe-"); try { const { L } = mk(d);
    assert.equal(L.confirmedPayment({ invoiceId: "inv-1", amount: 200, currency: "USD" }).reason, "NO_PROCESSOR_CONFIRMED_PAYMENT_FOR_INVOICE");
    send(L, ev("evt_p1", "payment_intent.created", pi())); assert.equal(L.confirmedPayment({ invoiceId: "inv-1", amount: 200, currency: "USD" }).ok, false, "initiated is not money");
    send(L, ev("evt_p2", "payment_intent.succeeded", pi()));
    const ok = L.confirmedPayment({ invoiceId: "inv-1", amount: 200, currency: "USD" }); assert.equal(ok.ok, true); assert.equal(ok.environment, "LIVE");
    assert.equal(L.confirmedPayment({ invoiceId: "inv-1", amount: 199, currency: "USD" }).reason, "AMOUNT_OR_CURRENCY_MISMATCH"); assert.equal(L.confirmedPayment({ invoiceId: "inv-1", amount: 200, currency: "EUR" }).ok, false);
    assert.equal(L.confirmedPayment({ invoiceId: "inv-2", amount: 200, currency: "USD" }).ok, false);
  } finally { rm(d); }
});
