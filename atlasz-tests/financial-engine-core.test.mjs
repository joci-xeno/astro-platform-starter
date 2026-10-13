// Financial engine wired into the Control Center core: one profit objective over one receipt authority, owner-signed attestations/rates, persistence across restart, AURÓRA text. FIXTURE only: no real payment exists.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test"; import assert from "node:assert/strict"; import path from "node:path";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
import { signWithKeystore } from "../atlasz-addons/owner-keystore.mjs";
import { attestationSubject } from "../atlasz-addons/cost-completeness.mjs";
import { rateSubject } from "../atlasz-addons/fx-rates.mjs";

const PW = "correct horse battery";
const world = async () => { const base = tmp("fec-"), configDir = path.join(base, "c"), stateDir = path.join(base, "s"), core = createControlCenterCore({ stateDir, configDir }); await core.provisionOwnerKey({ passphrase: PW });
  return { core, configDir, stateDir, sign: (action, subject) => signWithKeystore(configDir, PW, { action, subject, ttlMs: 60000 }), reopen: () => createControlCenterCore({ stateDir, configDir }), done: () => rm(base) }; };

test("dashboard: zone, objective, every required field present; nothing recorded => honest unknowns, no claim of success", async () => {
  const w = await world(); try {
    const x = w.core.profitDashboard();
    assert.equal(x.timeZone, "America/Vancouver"); assert.equal(x.target.minimumUsd, 500); assert.equal(x.target.stopsWorkWhenReached, false);
    for (const k of ["daily", "cumulative", "activeContracts", "completedJobs", "pendingPayments", "pendingInvoices", "refundsAndChargebacks", "currencyConversion", "financialVerification", "analytics", "activity", "blockers", "forecast"]) assert.ok(k in x, k);
    assert.equal(x.daily.verifiedNetProfitUsd, null, "costs are not attested: net unknown, not zero"); assert.equal(x.daily.status, "BELOW_MINIMUM"); assert.equal(x.daily.statusBasis, "UPPER_BOUND_BELOW_MINIMUM_UNKNOWN_ITEMS_CAN_ONLY_LOWER_IT");
    assert.equal(x.financialVerification.state, "UNRESOLVED"); assert.equal(x.financialVerification.costCompleteness, "NOT_ATTESTED_UNKNOWN"); assert.equal(x.financialVerification.receiptAuthority, "PAYMENT_EVENTS_LEDGER"); assert.equal(x.financialVerification.reconciliation.clean, true);
    assert.ok(x.blockers.includes("PAYMENT_PROCESSOR_WEBHOOK_NOT_CONFIGURED_NO_EVENTS")); assert.ok(x.blockers.some(b => b.startsWith("NO_AUTHORISED_LIVE_SOURCE")));
    assert.equal(x.analytics.estimates.addedToActuals, false); assert.equal(x.refundsAndChargebacks.openDisputes.count, 0); assert.equal(x.pendingInvoices.kind, "INVOICE_NOT_PAID");
  } finally { w.done(); }
});
test("owner-signed cost attestation makes the net exact; it survives restart; unsigned, wrong-subject and revoked attestations do not", async () => {
  const w = await world(); try {
    const day = w.core.profitObjective().daily().day, body = { categories: ["AI_USAGE", "HOSTING_INFRA", "OTHER_ATTRIBUTABLE"], fromDay: day, toDay: null };
    assert.equal(w.core.attestCosts({ ...body, approval: null }).reason, "OWNER_APPROVAL_REQUIRED"); assert.equal(w.core.attestCosts({ ...body, approval: w.sign("COST_ATTESTATION", "other") }).reason, "OWNER_APPROVAL_REQUIRED");
    const a = w.core.attestCosts({ ...body, approval: w.sign("COST_ATTESTATION", attestationSubject(body)) }); assert.equal(a.ok, true, JSON.stringify(a));
    let x = w.core.profitDashboard(); assert.equal(x.daily.verifiedNetProfitUsd, 0); assert.equal(x.daily.statusBasis, "EXACT_VERIFIED_NET"); assert.equal(x.daily.costsComplete, true); assert.equal(x.financialVerification.costCompleteness, "OWNER_ATTESTED"); assert.equal(x.financialVerification.state, "VERIFIED");
    const w2 = w.reopen(); x = w2.profitDashboard(); assert.equal(x.daily.costsComplete, true, "attestation persisted"); assert.equal(x.financialVerification.costAttestations, 1);
    const r = w2.revokeCostAttestation({ id: a.id, approval: w.sign("COST_ATTESTATION_REVOKE", a.id) }); assert.equal(r.ok, true); assert.equal(w2.profitDashboard().daily.costsComplete, false, "from today the costs are unknown again");
  } finally { w.done(); }
});
test("owner-signed documented exchange rate, fee evidence and financial-action assessment go through the core; unsigned or speculative requests are refused", async () => {
  const w = await world(); try {
    const t = new Date(Date.now() - 3600_000).toISOString(), rate = { from: "CAD", rate: 0.73, asOf: t, source: "owner-recorded bank quote" };
    assert.equal(w.core.recordFxRate({ ...rate }).reason, "OWNER_APPROVAL_REQUIRED"); assert.equal(w.core.recordFxRate({ ...rate, approval: w.sign("FX_RATE_RECORD", rateSubject({ ...rate, asOf: new Date(t).toISOString() })) }).ok, true); assert.equal(w.core.rateBook().list().length, 1);
    assert.equal(w.core.attachPaymentFee({ paymentKey: "pi_none", feeMinor: 5, currency: "usd", source: "s", reference: "r" }).reason, "UNKNOWN_PAYMENT", "unknown payment is refused before anything else");
    assert.equal(w.core.assessFinancial({ action: "SPEND", targetPressure: true }).allowed, false); assert.equal(w.core.assessFinancial({ action: "CRYPTO_TRADING", approval: w.sign("FINANCIAL_CRYPTO_TRADING", "") }).allowed, false); assert.equal(w.core.assessFinancial({ action: "SPEND", subject: "20", approval: w.sign("FINANCIAL_SPEND", "20") }).allowed, true);
    assert.equal(w.core.financialReconciliation().authority, "PAYMENT_EVENTS_LEDGER_ONLY");
  } finally { w.done(); }
});
test("AURÓRA explains the unattested-cost state in Hungarian with the time zone and does not claim the target", async () => {
  const w = await world(); try { const hu = await w.core.auroraRespond({ text: "Mennyi a napi profitcél állása?", language: "hu" });
    assert.match(hu.reply, /America\/Vancouver/); assert.match(hu.reply, /nincs igazolva/); assert.match(hu.reply, /biztosan a \$500\.00 minimum alatt/); assert.doesNotMatch(hu.reply, /teljesült|elértük/);
  } finally { w.done(); }
});

test("the webhook receiver only starts with an owner signature bound to host:port, answers on loopback, refuses unsigned events, and stops", async () => {
  const w = await world(); try {
    assert.equal((await w.core.startWebhookReceiver({ port: 0 })).reason, "OWNER_APPROVAL_REQUIRED"); assert.equal((await w.core.startWebhookReceiver({ port: 0, approval: w.sign("PAYMENT_WEBHOOK_RECEIVER_START", "127.0.0.1:9") })).reason, "OWNER_APPROVAL_REQUIRED", "wrong subject"); assert.equal((await w.core.startWebhookReceiver({ port: "x" })).reason, "PORT_INVALID"); assert.equal(w.core.webhookReceiverRunning(), false);
    const r = await w.core.startWebhookReceiver({ port: 0, approval: w.sign("PAYMENT_WEBHOOK_RECEIVER_START", "127.0.0.1:0") }); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.exposure, "LOOPBACK_ONLY"); assert.equal((await w.core.startWebhookReceiver({ port: 0 })).reason, "ALREADY_RUNNING");
    const res = await fetch("http://127.0.0.1:" + r.port + r.path, { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=00" } }); assert.equal(res.status, 503, "no webhook secret in the vault: nothing is accepted (Stripe not live)");
    await w.core.stopWebhookReceiver(); assert.equal(w.core.webhookReceiverRunning(), false);
  } finally { await w.core.stopWebhookReceiver(); w.done(); }
});
