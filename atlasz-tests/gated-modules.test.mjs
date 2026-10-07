// Proves the 14 modules that used to accept `ownerApproved: true` now require a verified signed approval.
import test from "node:test";
import assert from "node:assert/strict";
import { generateOwnerKeyPair, issueOwnerApproval, configureOwnerAuth, getDefaultOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createInvoice, approveInvoice } from "../atlasz-addons/invoice-engine.mjs";
import { createDelivery, requestDeliveryApproval, approveDelivery } from "../atlasz-addons/delivery-engine.mjs";
import { createMoneyPipeline, transitionMoneyPipeline } from "../atlasz-addons/money-pipeline-controller.mjs";
import { guardAction } from "../atlasz-addons/guardrail-engine.mjs";
import { transition } from "../atlasz-addons/deal-state.mjs";
import { registerAgentControl, authorize, setKillSwitch, controlPlaneStatus } from "../atlasz-addons/enterprise-control-plane.mjs";
import { createComputerUseFabric } from "../atlasz-addons/computer-use-fabric.mjs";
import { markAgreement } from "../atlasz-addons/negotiation-engine.mjs";
import { TaxAccountingEngine, TAX_CAPABILITY } from "../atlasz-addons/tax-accounting-engine.mjs";
import { createApprovalGateway } from "../atlasz-addons/approval-command-gateway.mjs";

const k = generateOwnerKeyPair();
configureOwnerAuth({ publicKeyB64: k.publicKeyB64 });
const sign = (action, subject = null) => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action, subject });
const inv = () => createInvoice({ invoiceId: "INV-1", dealId: "D1", client: "ACME", items: [{ description: "x", quantity: 1, unitPrice: 100 }] });

test("invoice approval: boolean rejected, signed accepted, bound to invoiceId", () => {
  assert.throws(() => approveInvoice(inv(), { ownerApproved: true }), /OWNER_APPROVAL_REQUIRED/);
  assert.throws(() => approveInvoice(inv(), { ownerApproved: sign("APPROVE_INVOICE", "INV-OTHER") }), /OWNER_APPROVAL_REQUIRED/);
  assert.equal(approveInvoice(inv(), { ownerApproved: sign("APPROVE_INVOICE", "INV-1") }).status, "APPROVED");
});
test("delivery approval requires signed approval", () => {
  const d = requestDeliveryApproval(createDelivery({ deliveryId: "DL1", jobId: "J", dealId: "D", artifacts: ["a.zip"] }), { qaPassed: true });
  assert.throws(() => approveDelivery(d, { ownerApproved: true }), /OWNER_APPROVAL_REQUIRED/);
  assert.equal(approveDelivery(d, { ownerApproved: sign("APPROVE_DELIVERY", "DL1") }).status, "APPROVED_TO_DELIVER");
});
test("guardrail: high-risk action needs signed approval; boolean cannot unlock spending", () => {
  assert.deepEqual(guardAction({ action: "SPEND_MONEY", ownerApproved: true }).reasons, ["OWNER_APPROVAL_REQUIRED"]);
  assert.equal(guardAction({ action: "SPEND_MONEY" }).allowed, false);
  assert.equal(guardAction({ action: "SPEND_MONEY", ownerApproved: sign("SPEND_MONEY") }).allowed, true);
  assert.equal(guardAction({ action: "READ_PUBLIC_PAGE" }).allowed, true);
});
test("money pipeline owner gates need signed approval bound to pipeline id", () => {
  let p = createMoneyPipeline({ id: "P1", sourceEvidence: "https://example.test/req" });
  p = transitionMoneyPipeline(p, "QUALIFIED", {}); p = transitionMoneyPipeline(p, "PROPOSAL_DRAFT", {});
  assert.throws(() => transitionMoneyPipeline(p, "APPROVED_TO_SEND", { ownerApproved: true }), /OWNER_APPROVAL_REQUIRED/);
  assert.equal(transitionMoneyPipeline(p, "APPROVED_TO_SEND", { ownerApproved: sign("MONEY_APPROVED_TO_SEND", "P1") }).state, "APPROVED_TO_SEND");
});
test("deal-state owner gates (AGREED->WON)", () => {
  assert.throws(() => transition({ status: "AGREED" }, "WON", { ownerApproved: true }), /OWNER_APPROVAL_REQUIRED/);
  assert.equal(transition({ status: "AGREED" }, "WON", { ownerApproved: sign("DEAL_WON") }).status, "WON");
});
test("negotiation agreement and tax external actions need signed approval", () => {
  assert.throws(() => markAgreement({ price: 1 }, { ownerApproved: true }), /OWNER_APPROVAL_REQUIRED_FOR_AGREEMENT/);
  const action = TAX_CAPABILITY.requiresOwnerApproval[0];
  const eng = new TaxAccountingEngine();
  assert.notEqual(eng.authorizeExternalAction(action, true).status, "AUTHORIZED");
  assert.equal(eng.authorizeExternalAction(action, sign("TAX_" + action.toUpperCase().replace(/-/g, "_"))).status, "AUTHORIZED");
});
test("control plane: kill switch needs signed approval; high-risk agent boolean rejected", () => {
  assert.throws(() => setKillSwitch(true, { ownerAuthenticated: true }), /OWNER_AUTHENTICATION_REQUIRED/);
  assert.throws(() => setKillSwitch(true, { ownerApproval: true }), /OWNER_AUTHENTICATION_REQUIRED/);
  assert.equal(controlPlaneStatus().killSwitch, false);
  registerAgentControl({ agentId: "A1", tenantId: "T", owner: "JOCI", permissions: ["P"], tools: [], risk: "HIGH" });
  assert.equal(authorize({ tenantId: "T", agentId: "A1", permission: "P", ownerApproved: true }).reason, "OWNER_APPROVAL_REQUIRED");
  assert.equal(authorize({ tenantId: "T", agentId: "A1", permission: "P", ownerApproved: sign("HIGH_RISK_AGENT_ACTION") }).allowed, true);
  assert.equal(setKillSwitch(true, { ownerApproval: sign("CONTROL_PLANE_KILL_SWITCH", "true") }).killSwitch, true);
  assert.equal(authorize({ tenantId: "T", agentId: "A1", permission: "P" }).reason, "GLOBAL_KILL_SWITCH");
});
test("computer-use: ask-owner actions wait for signed approval; forbidden always denied", async () => {
  const f = createComputerUseFabric();
  assert.equal(f.authorize({ agentId: "A", action: "spend-money", ownerApproved: true }).decision, "WAIT_OWNER");
  assert.equal(f.authorize({ agentId: "A", action: "spend-money", ownerApproved: sign("COMPUTER_SPEND_MONEY") }).decision, "ALLOW");
  assert.equal(f.authorize({ agentId: "A", action: "disable-audit-log", ownerApproved: sign("COMPUTER_DISABLE_AUDIT_LOG") }).decision, "DENY");
  await assert.rejects(f.execute({ agentId: "A", action: "navigate" }), /COMPUTER_USE_PROVIDER_UNAVAILABLE/);
  assert.equal((await f.execute({ agentId: "A", action: "open-page" })).decision, "WAIT_OWNER");   // unlisted action fails closed
  assert.equal(f.status().state, "PLACEHOLDER_UNCONNECTED");
});
test("approval gateway status derives from owner-auth (never caller-asserted)", () => {
  const auth = getDefaultOwnerAuth();
  const gw = createApprovalGateway({ ownerAuth: auth });
  assert.equal(gw.status().state, "CONNECTED_UNTESTED");
  const ch = auth.issueChallenge();
  assert.equal(auth.proveChannel(sign(ch.action, ch.subject)).proven, true);
  assert.equal(gw.status().state, "LIVE");
});
