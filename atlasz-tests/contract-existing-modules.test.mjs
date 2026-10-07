// Contract smoke tests for PRE-EXISTING modules (reuse-first audit evidence, V7.3 §44).
// They prove documented invariants only; they do not prove live operation.
import test from "node:test";
import assert from "node:assert/strict";
import * as mp from "../atlasz-addons/money-pipeline-controller.mjs";
import * as pay from "../atlasz-addons/payment-confirmation-adapter.mjs";
import * as ledger from "../atlasz-addons/profit-ledger.mjs";
import * as qa from "../atlasz-addons/qa-reviewer.mjs";
import * as plan from "../atlasz-addons/master-planner-orchestrator.mjs";
import * as heal from "../atlasz-addons/self-healing-loop.mjs";
import * as budget from "../atlasz-addons/budget-consumption-governor.mjs";
import * as pq from "../atlasz-addons/priority-queue-rate-limit-governor.mjs";
import * as rag from "../atlasz-addons/enterprise-knowledge-agentic-rag.mjs";
import * as bb from "../atlasz-addons/observability-black-box.mjs";
import * as cr from "../atlasz-addons/completion-registry.mjs";

test("money pipeline: PAID_VERIFIED needs authoritative payment evidence", () => {
  let p = mp.createMoneyPipeline({ id: "d1", sourceEvidence: "lead-url", estimatedValueUsd: 100 });
  assert.equal(p.state, "DISCOVERED");
  assert.throws(() => mp.transitionMoneyPipeline(p, "PAID_VERIFIED", { evidence: "x" }), /INVALID_MONEY_PIPELINE_TRANSITION/);
  assert.throws(() => mp.recordVerifiedPayment(p, { amount: 5, evidence: "e", providerConfirmed: true, signatureVerified: true }), /NOT_READY/);
  assert.equal(mp.moneyPipelineSummary(p).verifiedRevenue ?? 0, 0);
});

test("payment adapter: confirmPaid refuses unsigned / unconfirmed / non-final / no-evidence", () => {
  const ev = pay.normalizePaymentEvent({ provider: "x", eventId: "1", amount: 10, status: "paid", evidence: { ref: "r" } });
  assert.throws(() => pay.confirmPaid(ev), /EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED/);
  assert.throws(() => pay.confirmPaid(ev, { signatureVerified: true }), /EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED/);
  const pend = pay.normalizePaymentEvent({ provider: "x", eventId: "2", amount: 10, status: "pending", evidence: { r: 1 } });
  assert.throws(() => pay.confirmPaid(pend, { signatureVerified: true, providerConfirmed: true }), /PAYMENT_NOT_FINAL/);
  const noev = pay.normalizePaymentEvent({ provider: "x", eventId: "3", amount: 10, status: "paid" });
  assert.throws(() => pay.confirmPaid(noev, { signatureVerified: true, providerConfirmed: true }), /EVIDENCE_REQUIRED/);
  assert.equal(pay.confirmPaid(ev, { signatureVerified: true, providerConfirmed: true }).confirmedReceived, true);
  assert.throws(() => pay.normalizePaymentEvent({ provider: "x", eventId: "4", amount: -1, status: "paid" }), /INVALID_PAYMENT_AMOUNT/);
});

test("profit ledger: PAID only counts with confirmation and external evidence", () => {
  assert.throws(() => ledger.recordMoney({ stage: "PAID", amountUsd: 5, costUsd: 0 }), /PAID_REQUIRES/);
  assert.throws(() => ledger.recordMoney({ stage: "PAID", amountUsd: 5, costUsd: 0, confirmedReceived: true }), /EXTERNAL_EVIDENCE/);
  assert.throws(() => ledger.recordMoney({ stage: "BOGUS", amountUsd: 1, costUsd: 0 }), /INVALID_MONEY_STAGE/);
  const s = ledger.summarize([{ stage: "PROPOSED", amountUsd: 900, costUsd: 0 }, { stage: "PAID", amountUsd: 10, costUsd: 2, confirmedReceived: true, externalEvidence: "bank" }]);
  assert.deepEqual(s, { confirmedPaidUsd: 10, costsUsd: 2, verifiedNetProfitUsd: 8 });
  assert.equal(ledger.summarize([{ stage: "PROPOSED", amountUsd: 900, costUsd: 0 }]).confirmedPaidUsd, 0);
});

test("QA reviewer: PASS only when every required check passed WITH evidence", () => {
  assert.equal(qa.reviewResult({ checks: [{ id: "a", passed: true }], evidence: [] }).status, "FAIL");
  assert.equal(qa.reviewResult({ checks: [{ id: "a", passed: false }], evidence: [{ checkId: "a" }] }).status, "FAIL");
  assert.equal(qa.reviewResult({ checks: [{ id: "a", passed: true }], evidence: [{ checkId: "a" }] }).status, "PASS");
  assert.throws(() => qa.reviewResult({ checks: [{ id: "a" }, { id: "a" }] }), /UNIQUE/);
});

test("master planner: dependency gating and cycle rejection", () => {
  const p = plan.createMasterPlan({ objective: "o", steps: [{ id: "a", title: "A", dependsOn: [] }, { id: "b", title: "B", dependsOn: ["a"] }] });
  assert.deepEqual(plan.planReadySteps(p).map(s => s.id), ["a"]);
  assert.throws(() => plan.createMasterPlan({ objective: "o", steps: [{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }] }));
});

test("self-healing: retries then recovers; exhausted attempts BLOCK for a human, never fake success", async () => {
  let n = 0;
  const r = await heal.selfHeal({ operation: async () => ++n, verify: async v => ({ passed: v >= 2 }), maxRetries: 3 });
  assert.equal(r.state, "RECOVERED"); assert.equal(n, 2);
  const b = await heal.selfHeal({ operation: async () => { throw new Error("boom"); }, verify: async () => ({ passed: true }), maxRetries: 1 });
  assert.equal(b.state, "BLOCKED");
});

test("budget governor: unconfigured and exceeded budgets are blocked", () => {
  assert.equal(budget.recordUsage({ scopeId: "nope", costUsd: 1 }).reason, "BUDGET_NOT_CONFIGURED");
  budget.setBudget({ scopeId: "t", limitUsd: 5 });
  assert.equal(budget.recordUsage({ scopeId: "t", costUsd: 4 }).allowed, true);
  assert.equal(budget.recordUsage({ scopeId: "t", costUsd: 2 }).reason, "BUDGET_EXCEEDED");
  assert.equal(budget.recordUsage({ scopeId: "t", costUsd: -1 }).reason, "INVALID_COST");
  assert.equal(budget.budgetStatus("t").spentUsd, 4);
});

test("priority queue + rate limiter (in-memory): priority order, dedupe, token bucket", () => {
  const a = pq.enqueue({ id: "lo" }, { priority: 1 }), b = pq.enqueue({ id: "hi" }, { priority: 90 });
  assert.equal(a.accepted && b.accepted, true);
  assert.equal(pq.enqueue({ id: "x" }, { dedupeKey: "k" }).accepted, true);
  assert.equal(pq.enqueue({ id: "y" }, { dedupeKey: "k" }).reason, "DUPLICATE");
  assert.equal(pq.next().id, "hi");
  assert.equal(pq.acquire("unset").reason, "LIMIT_NOT_CONFIGURED");
  pq.configureLimit("k1", { capacity: 2, refillPerSecond: 0.001 });
  assert.equal(pq.acquire("k1").allowed, true); assert.equal(pq.acquire("k1").allowed, true);
  assert.equal(pq.acquire("k1").allowed, false);
});

test("knowledge RAG: tenant isolation and role filtering", () => {
  rag.ingestKnowledge({ tenantId: "A", sourceId: "s1", text: "refund policy thirty days", allowedRoles: ["MASTER"] });
  rag.ingestKnowledge({ tenantId: "B", sourceId: "s2", text: "refund policy ninety days" });
  const hitsA = rag.retrieveKnowledge({ query: "refund policy", tenantId: "A", role: "MASTER" });
  assert.equal(hitsA.length, 1); assert.match(hitsA[0].text, /thirty/);
  assert.equal(rag.retrieveKnowledge({ query: "refund policy", tenantId: "A", role: "EXECUTION" }).length, 0);
  assert.equal(rag.retrieveKnowledge({ query: "refund policy", tenantId: "A", role: "MASTER", verifiedOnly: true }).length, 0);
  assert.throws(() => rag.retrieveKnowledge({ query: "x" }), /TENANT/);
});

test("black box redacts secrets", () => {
  const r = bb.blackBoxRecord({ event: "e", input: { apiKey: "SECRETVALUE", token: "t", ok: 1 }, status: "OK" });
  assert.equal(JSON.stringify(r).includes("SECRETVALUE"), false);
  assert.equal(r.input.ok, 1);
});

test("completion registry seed claims no LIVE item", () => {
  cr.seedAtlaszCompletionRegistry();
  const list = cr.completionList();
  assert.ok(list.length > 0);
  assert.equal(list.filter(x => x.state === "LIVE").length, 0);
});
