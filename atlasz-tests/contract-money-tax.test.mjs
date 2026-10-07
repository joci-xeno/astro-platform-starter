// Contract tests for the money chain and tax engine (V7.3 §11, §27). They prove the honesty rules, not live revenue.
import test from "node:test";
import assert from "node:assert/strict";
import { transition, DEAL_STATES } from "../atlasz-addons/deal-state.mjs";
import { qualifyOpportunity, rankOpportunities, dedupeOpportunities } from "../atlasz-addons/opportunity-qualification-engine.mjs";
import { buildBuyerQuery, normalizeContact, rankContacts, contactReady } from "../atlasz-addons/buyer-decision-maker-finder.mjs";
import { nextFollowUp, stopOnReply } from "../atlasz-addons/follow-up-engine.mjs";
import { buildProfitStatement, validateMoneyEntry } from "../atlasz-addons/profit-accounting-engine.mjs";
import { createDelivery, requestDeliveryApproval, approveDelivery, markDelivered } from "../atlasz-addons/delivery-engine.mjs";
import { createInvoice, approveInvoice, markInvoiceSent } from "../atlasz-addons/invoice-engine.mjs";
import { TaxAccountingEngine, TAX_STATES } from "../atlasz-addons/tax-accounting-engine.mjs";
import { createClientDNA, getClientDNA } from "../atlasz-addons/client-dna-engine.mjs";

test("deal state: forward-only machine; WON/AGREED need signed approval; CONTACTED/DELIVERED/INVOICED need external evidence; PAID needs confirmation + evidence", () => {
  assert.ok(DEAL_STATES.includes("PAID"));
  assert.throws(() => transition({ status: "NEW" }, "PAID"), /INVALID_DEAL_TRANSITION/);
  assert.throws(() => transition({ status: "PROPOSED" }, "AGREED", { ownerApproved: true }), /OWNER_APPROVAL_REQUIRED/);
  assert.throws(() => transition({ status: "CONTACT_READY" }, "CONTACTED"), /EXTERNAL_EVIDENCE_REQUIRED_FOR_CONTACTED/);
  assert.throws(() => transition({ status: "INVOICED" }, "PAID", { paymentConfirmed: true }), /PAYMENT_CONFIRMATION_AND_EVIDENCE_REQUIRED/);
  assert.throws(() => transition({ status: "INVOICED" }, "PAID", { externalEvidence: "x" }), /PAYMENT_CONFIRMATION_AND_EVIDENCE_REQUIRED/);
  assert.equal(transition({ status: "INVOICED" }, "PAID", { paymentConfirmed: true, externalEvidence: "bank-ref" }).status, "PAID");
  assert.equal(transition({ status: "CONTACT_READY" }, "CONTACTED", { externalEvidence: "msg-id" }).status, "CONTACTED");
});
test("opportunity qualification blocks upfront spend, illegal/deceptive, non-remote, unheld license, missing evidence; ranking by expected net per hour", () => {
  const base = { sourceUrl: "u", estimatedValueUsd: 1000, winProbability: 0.5, estimatedHours: 10 };
  assert.deepEqual(qualifyOpportunity({ ...base, upfrontSpendRequired: true }).qualification.blockers, ["UPFRONT_SPEND_REQUIRED"]);
  assert.ok(qualifyOpportunity({ ...base, illegalOrDeceptive: true }).qualification.blockers.includes("ILLEGAL_OR_DECEPTIVE"));
  assert.ok(qualifyOpportunity({ ...base, requiresPhysicalPresence: true }).qualification.blockers.includes("NOT_REMOTE_DELIVERABLE"));
  assert.ok(qualifyOpportunity({ ...base, requiresUnheldLicense: true }).qualification.blockers.includes("LICENSE_REQUIRED"));
  assert.ok(qualifyOpportunity({ estimatedValueUsd: 5 }).qualification.blockers.includes("NO_SOURCE_EVIDENCE"));
  const r = rankOpportunities([{ ...base, title: "slow", estimatedHours: 100 }, { ...base, title: "fast" }, { title: "bad", estimatedValueUsd: 9999 }]);
  assert.deepEqual(r.map(x => x.title), ["fast", "slow"]);
  assert.equal(dedupeOpportunities([{ url: "A" }, { url: "a" }]).length, 1);
});
test("buyer finder: only business contacts with a source are ranked; contactReady needs email, source and confidence >= 0.6", () => {
  assert.throws(() => buildBuyerQuery({}), /COMPANY_OR_DOMAIN_REQUIRED/);
  const a = normalizeContact({ name: "A", email: "a@x.com", source: "site", businessContact: true, confidence: 0.9, verified: true });
  const b = normalizeContact({ name: "B", email: "b@x.com", businessContact: true, confidence: 0.99 });                  // no source
  const c = normalizeContact({ name: "C", email: "c@x.com", source: "s", businessContact: false, confidence: 0.99 });     // private person
  assert.deepEqual(rankContacts([a, b, c]).map(x => x.name), ["A"]);
  assert.equal(contactReady(a), true); assert.equal(contactReady({ ...a, confidence: 0.5 }), false); assert.equal(contactReady({ ...a, email: null }), false);
});
test("follow-up: due on the 2/5/10 day schedule, never after a reply, never after terminal status", () => {
  const day = 86400000, t0 = Date.parse("2026-01-01T00:00:00Z");
  const conv = { firstContactAt: new Date(t0).toISOString(), followUpsSent: 0 };
  assert.equal(nextFollowUp(conv, t0 + day).due, false); assert.equal(nextFollowUp(conv, t0 + 2 * day).due, true);
  assert.equal(nextFollowUp({ ...conv, followUpsSent: 3 }, t0 + 99 * day), null);
  assert.equal(nextFollowUp(stopOnReply(conv), t0 + 99 * day), null); assert.equal(nextFollowUp({ ...conv, status: "LOST" }, t0 + 99 * day), null);
  assert.equal(nextFollowUp({}, t0), null);
});
test("profit statement: unconfirmed revenue is never profit", () => {
  const s = buildProfitStatement({ jobId: "j", entries: [{ type: "COST", amountUsd: 10 }, { type: "REVENUE", amountUsd: 500 }, { type: "REVENUE", stage: "PAID", amountUsd: 100, confirmedReceived: true, externalEvidence: "bank" }] });
  assert.equal(s.verifiedReceivedUsd, 100); assert.equal(s.unconfirmedRevenueUsd, 500); assert.equal(s.verifiedNetProfitUsd, 90);
  assert.equal(validateMoneyEntry({ type: "REVENUE", stage: "PAID", amountUsd: 5 }).valid, false);
  assert.throws(() => buildProfitStatement({ jobId: "j", entries: [{ type: "X", amountUsd: 1 }] }), /INVALID_MONEY_ENTRY/);
});
test("delivery: QA pass -> signed owner approval -> external evidence; nothing is 'delivered' on assertion", () => {
  const d = createDelivery({ deliveryId: "d", jobId: "j", dealId: "x", artifacts: ["a"], acceptanceEvidence: ["e"] });
  assert.throws(() => requestDeliveryApproval(d, {}), /QA_PASS_REQUIRED/);
  const w = requestDeliveryApproval(d, { qaPassed: true });
  assert.throws(() => approveDelivery(w, { ownerApproved: true }), /OWNER_APPROVAL_REQUIRED/);
  assert.throws(() => markDelivered(w, { externalEvidence: "x" }), /DELIVERY_NOT_APPROVED/);
});
test("invoice: owner approval, then external reference before it counts as sent", () => {
  const inv = createInvoice({ invoiceId: "i", dealId: "d", client: "c", items: [{ description: "x", quantity: 1, unitPrice: 10 }] });
  assert.throws(() => approveInvoice(inv, { ownerApproved: true }), /OWNER_APPROVAL_REQUIRED/);
  assert.throws(() => markInvoiceSent(inv, { externalReference: "r" }), /INVOICE_NOT_APPROVED/);
  assert.throws(() => createInvoice({ invoiceId: "i", dealId: "d", client: "c", items: [{ description: "x", unitPrice: 0 }] }), /INVOICE_AMOUNT_INVALID/);
});
test("tax engine: unsupported jurisdiction, unverified rules and missing documents BLOCK; no LLM arithmetic; external tax actions need owner approval", async () => {
  const mk = o => new TaxAccountingEngine({ ruleStore: { get: async () => ({ version: "v1" }) }, sourceVerifier: { verify: async () => true }, calculator: { calculate: async () => ({ total: 1 }) }, ...o });
  const q = { country: "CA", region: "BC", taxType: "GST_HST", taxYear: 2026 };
  assert.equal((await mk().plan({ country: "HU", taxType: "GST", taxYear: 2026 })).status, TAX_STATES.BLOCKED_MISSING_TAX_JURISDICTION);
  assert.equal((await mk({ sourceVerifier: { verify: async () => false } }).plan(q)).status, TAX_STATES.BLOCKED_TAX_RULE_UNVERIFIED);
  assert.equal((await mk({ ruleStore: { get: async () => null } }).plan(q)).status, TAX_STATES.BLOCKED_TAX_RULE_UNVERIFIED);
  assert.equal((await mk().plan({ ...q, taxType: "NOT_A_TAX" })).status, TAX_STATES.BLOCKED_MISSING_TAX_JURISDICTION);
  assert.equal((await mk().plan(q)).status, "PLANNED");
  assert.equal((await mk().prepare({ ...q, records: [] })).status, TAX_STATES.BLOCKED_MISSING_DOCUMENTS);
  await assert.rejects(() => mk({ calculator: null }).prepare({ ...q, records: [{ a: 1 }] }), /calculator is not configured/);
  assert.equal((await mk().prepare({ ...q, records: [{ a: 1 }] })).status, TAX_STATES.READY_FOR_OWNER_REVIEW);
  const a = mk().authorizeExternalAction("file-return", true);
  assert.notEqual(a.status, "AUTHORIZED");
});
test("client DNA is tenant-scoped", () => {
  createClientDNA({ tenantId: "T1", clientId: "C", voice: { tone: "formal" } });
  assert.equal(getClientDNA("T1", "C").voice.tone, "formal"); assert.equal(getClientDNA("T2", "C"), null);
});
