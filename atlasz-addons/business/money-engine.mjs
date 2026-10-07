// ATLASZ Money Engine (internal flow, package §9/§16/§28): wires the governed engines into ONE traceable lifecycle
//   OPPORTUNITY > QUALIFIED > FEASIBLE > APPROVAL > OFFER > NEGOTIATION > WON > EXECUTION > QA > DELIVERY > INVOICE > PAYMENT CLAIM
//   > AUTHORITATIVE PAYMENT VERIFICATION > VERIFIED RECEIVED > COST > VERIFIED NET PROFIT > LEARNING
// Every stage is a thin, explicit call into an engine that holds the evidence rules; this module adds NO shortcuts. Where no real provider exists the stage reports
// NOT_CONNECTED / EXTERNAL_VERIFICATION_REQUIRED and the flow stops there — SENT / WON / DELIVERED / PAID / REVENUE / PROFIT are never fabricated.
// `environment` is SANDBOX | STAGING | LIVE: engines refuse evidence from another environment, and a SANDBOX flow never counts as revenue.
import path from "node:path";
import { createSearchPipeline } from "../brain/search-pipeline.mjs";
import { createEvidenceSources } from "../brain/evidence-sources.mjs";
import { createFinancialLedger } from "../financial-ledger.mjs";
import { createJobSystem } from "./job-system.mjs";
import { createArtifactRegistry } from "./artifact-registry.mjs";
import { createQaFactory } from "./qa-factory.mjs";
import { createJudgePanel } from "./judge.mjs";
import { createCommunicationCenter } from "./communication-center.mjs";
import { createDealPipeline } from "./deal-pipeline.mjs";
import { createDeliveryService } from "./delivery-service.mjs";
import { createInvoiceService } from "./invoice-service.mjs";
import { createPaymentVerifier } from "./payment-verification.mjs";
import { createFinanceIntelligence } from "./finance-intelligence.mjs";
import { createRecurringBilling } from "./recurring-billing.mjs";

export function createMoneyEngine({ dir, ownerAuth, brain, environment = "SANDBOX", adapters = {}, extract, qaRunners = {}, now = () => new Date().toISOString(), tenantId = "ATLASZ", requiredCapabilities = ["screen"] } = {}) {
  if (!dir || !ownerAuth || !brain || typeof extract !== "function") throw new Error("DIR_OWNERAUTH_BRAIN_EXTRACT_REQUIRED");
  const bb = brain.blackBox, p = n => (dir ? path.join(dir, n) : null);
  const ledger = createFinancialLedger({ dir: p("ledger") });
  const artifacts = createArtifactRegistry({ dir: p("artifacts"), environment, now, blackBox: bb });
  const comms = createCommunicationCenter({ file: p("comms.json"), ownerAuth, adapters: adapters.comms ?? {}, security: brain.security, environment, now, blackBox: bb });
  const payments = createPaymentVerifier({ file: p("payments.json"), environment, now, blackBox: bb, ledger: environment === "LIVE" ? ledger : null, lookups: { invoice: id => invoices.get(id) } });
  const jobs = createJobSystem({ file: p("jobs-universal.json"), environment, now, blackBox: bb, lookups: { artifact: id => artifacts.get(id), delivery: id => delivery.get(id), invoice: id => invoices.get(id), payment: id => payments.get(id) } });
  const deals = createDealPipeline({ file: p("deals.json"), ownerAuth, environment, now, blackBox: bb, lookups: { communication: id => comms.get(id) } });
  const delivery = createDeliveryService({ file: p("deliveries.json"), ownerAuth, adapters: adapters.delivery ?? {}, lookups: { artifact: id => artifacts.get(id) }, environment, now, blackBox: bb });
  const invoices = createInvoiceService({ file: p("invoices.json"), ownerAuth, environment, now, blackBox: bb, lookups: { communication: id => comms.get(id), payments: id => payments.list().filter(x => x.invoiceId === id), job: id => jobs.get(id) } });
  const recurring = createRecurringBilling({ file: p("subscriptions.json"), ownerAuth, invoices, lookups: { invoice: id => invoices.get(id) }, environment, now, blackBox: bb });
  const qa = createQaFactory({ security: brain.security, runners: qaRunners, blackBox: bb, now });
  const judges = createJudgePanel({ blackBox: bb, now });
  const finance = createFinanceIntelligence({ file: p("finance.json"), ledger, jobs, payments, environment, now });
  const seen = new Set();
  const search = createSearchPipeline({ security: brain.security, opportunity: brain.opportunity, graph: brain.graph, blackBox: bb, isDuplicate: raw => seen.has(raw.id), extract, requiredCapabilities, now });
  // internal evidence readers for the independent verifier
  const evidence = createEvidenceSources({ readers: {
    JOB: { get: id => brain.dispatch?.get(id) ?? null }, ARTIFACT: { get: id => { const a = artifacts.get(id); return a ? { id, content: artifacts.read(id)?.toString("utf8") ?? null, hash: a.hash } : null; } },
    COST_LEDGER: ledger, REVENUE_LEDGER: ledger, PROFIT_LEDGER: ledger, BLACK_BOX: bb } });
  const ok = (stage, extra = {}) => ({ ok: true, stage, ...extra }), stop = (stage, reason, extra = {}) => ({ ok: false, stage, reason, ...extra });

  // ---- 1. DISCOVER -> FEASIBLE ------------------------------------------------------------------------------------------------------------------------
  function discover(raw, { agentId = null } = {}) {
    const r = search.process(raw, { agentId });
    if (r.handoff) seen.add(raw.id);
    if (!r.handoff) return stop(r.stage, (r.reasons ?? []).join(","), { quarantined: r.quarantined === true, correlationId: r.correlationId });
    const o = brain.opportunity.get(r.opportunityId), dealId = "deal-" + r.opportunityId;
    deals.create({ id: dealId, tenantId, opportunityId: r.opportunityId, source: raw.source, agentId });
    deals.transition(dealId, "SCREENED", { screen: { decision: "ALLOW" } });
    const reasons = o.confidence?.note ? [o.confidence.note] : ["PRELIMINARY_PASS"];
    if (!r.preQualified) return ok("SCREENED", { dealId, opportunityId: r.opportunityId, preQualified: false, salesAction: r.salesAction, correlationId: r.correlationId });
    deals.transition(dealId, "QUALIFIED", { qualification: { score: o.confidence?.score ?? 0, reasons } });
    const gap = (o.capabilityMatch?.missing ?? []).length > 0;
    if (gap) return ok("QUALIFIED", { dealId, opportunityId: r.opportunityId, feasible: false, reason: "CAPABILITY_GAP:" + o.capabilityMatch.missing.join(","), correlationId: r.correlationId });
    deals.transition(dealId, "FEASIBLE", { feasibility: { capabilityMatch: true } });
    return ok("FEASIBLE", { dealId, opportunityId: r.opportunityId, salesAction: r.salesAction, priority: r.priority, correlationId: r.correlationId });
  }

  // ---- 2. OUTREACH (draft -> owner approval -> send). Nothing is sent without the owner's signed approval AND a connected adapter. --------------------------
  function prepareOutreach(dealId, { buyerRef, to, subject, body, channel = "EMAIL" } = {}) {
    deals.transition(dealId, "READY_FOR_OUTREACH", { buyerRef });
    const m = comms.draft({ tenantId, channel, to, subject, body, dealId, author: deals.get(dealId).agentId });
    deals.transition(dealId, "OUTREACH_DRAFTED", { communicationId: m.id });
    return ok("OUTREACH_DRAFTED", { communicationId: m.id, approvalRequest: comms.requestApproval(m.id) });
  }
  async function sendOutreach(dealId, ownerApproval) {
    const d = deals.get(dealId), id = d.outreachCommId;
    comms.approve(id, ownerApproval); deals.transition(dealId, "OUTREACH_APPROVED_IF_REQUIRED", {}); comms.queue(id);
    const r = await comms.send(id);
    if (!r.sent) return stop("OUTREACH_QUEUED", r.status ?? r.reason, { state: comms.get(id).state });
    deals.transition(dealId, "SENT", {}); return ok("SENT", { evidence: r.evidence });
  }
  const recordReply = (dealId, inbound) => (deals.transition(dealId, "REPLIED", { inbound }), ok("REPLIED"));
  function win(dealId, { acceptance, ownerApproval, scope, deliverables, goal }) {
    deals.transition(dealId, "WON", { acceptance, ownerApproval });
    const d = deals.get(dealId), j = jobs.create({ id: "job-" + dealId, tenantId, entityId: d.entityId, source: "DEAL:" + dealId, opportunityId: d.opportunityId, dealId, contractRef: acceptance.reference, goal, scope, deliverables, correlationId: null });
    deals.attachJob(dealId, j.id); jobs.transition(j.id, "SCOPED"); return ok("WON", { jobId: j.id });
  }

  // ---- 3. EXECUTION through the governed dispatch (30-agent runtime), recorded on the universal job ------------------------------------------------------
  async function execute(jobId, { capabilities = requiredCapabilities, preferredAgentId = null, ownerApproval = null } = {}) {
    const j = jobs.get(jobId); if (!brain.dispatch) return stop("EXECUTION", "NO_DISPATCH_TOPOLOGY_INVALID");
    brain.dispatch.submit({ id: jobId, kind: "EXECUTION", correlationId: j.correlationId ?? undefined, payload: { capabilities, task: { jobId, goal: j.goal, scope: j.scope, capabilities } } });
    const r = await brain.dispatch.run(jobId, { preferredAgentId, ownerApproval });
    const dj = brain.dispatch.get(jobId);
    if (dj?.planId && jobs.get(jobId).status === "SCOPED") jobs.transition(jobId, "PLANNED", { planId: dj.planId });
    if (r.status !== "DONE") return stop("EXECUTION", r.status + (r.reason ? ":" + r.reason : ""), { dispatch: r.status });   // IN_PROGRESS / ALREADY_DONE are not re-executed
    const agent = dj.assignments.at(-1)?.agentId; jobs.attach(jobId, "agents", agent);
    if (jobs.get(jobId).status === "PLANNED") jobs.transition(jobId, "ASSIGNED"); if (jobs.get(jobId).status === "ASSIGNED") jobs.transition(jobId, "IN_PROGRESS");
    return ok("EXECUTED", { agentId: agent, dispatchStatus: r.status });
  }

  // ---- 4. QA -> independent judge -> artifact verification -> job VERIFIED -----------------------------------------------------------------------------
  function checkWork(jobId, artifactId, { type = "DOCUMENT", spec = {}, skip = [], required = [], highValue = false, generatorModelId = null, generatorFamily = null, attempt = 1 } = {}) {
    const a = artifacts.get(artifactId), content = artifacts.read(artifactId)?.toString("utf8");
    if (!jobs.get(jobId).artifacts.includes(artifactId)) jobs.attach(jobId, "artifacts", artifactId);
    if (jobs.get(jobId).status === "IN_PROGRESS") jobs.transition(jobId, "IN_QA");
    const q = qa.run({ type, artifact: { id: artifactId, content, hash: a.hash }, spec, skip, required });
    artifacts.recordQa(artifactId, { status: q.status, checks: q.checks, artifactHash: a.hash });
    const route = qa.route(q, { attempt });
    if (q.status !== "PASS") { if (route.action === "REPAIR" || route.action === "REPLAN") { if (jobs.get(jobId).status === "IN_QA") jobs.transition(jobId, "IN_PROGRESS"); } return stop("QA", q.status, { qa: q, route }); }
    const jd = judges.judge({ id: artifactId, executorId: a.creator, generatorModelId, generatorFamily, highValue, claim: { artifactId, hash: a.hash }, artifact: { id: artifactId, content, hash: a.hash } });
    const verification = judges.toVerification(jd);
    if (jd.status !== "INDEPENDENTLY_VERIFIED") return stop("VERIFICATION", jd.status, { qa: q, judge: jd });
    artifacts.verify(artifactId, verification); jobs.transition(jobId, "VERIFIED", { verification, qa: { status: q.status, at: q.at } });
    return ok("VERIFIED", { qa: q, judge: jd });
  }

  // ---- 5. DELIVERY (verified artifacts only; owner approval; adapter acceptance) ------------------------------------------------------------------------
  function prepareDelivery(jobId, { channel = "DEFAULT", recipient = null } = {}) {
    const j = jobs.get(jobId); const d = delivery.prepare({ jobId, dealId: j.dealId, artifactIds: j.artifacts, channel, recipient }); jobs.transition(jobId, "READY_FOR_DELIVERY");
    return ok("READY_FOR_DELIVERY", { deliveryId: d.id, approvalRequest: delivery.requestApproval(d.id) });
  }
  async function deliver(jobId, deliveryId, ownerApproval) {
    delivery.approve(deliveryId, ownerApproval); const r = await delivery.attempt(deliveryId);
    if (r.status !== "DELIVERED") return stop("DELIVERY", r.status ?? r.state, { reason: r.reason });
    for (const aid of delivery.get(deliveryId).artifactIds) artifacts.markDelivered(aid, { deliveryId, evidence: r.evidence });
    jobs.transition(jobId, "DELIVERED", { deliveryId, evidence: r.evidence }); return ok("DELIVERED", { evidence: r.evidence });
  }

  // ---- 6. INVOICE -> PAYMENT CLAIM -> AUTHORITATIVE VERIFICATION -------------------------------------------------------------------------------------------
  function draftInvoice(jobId, { customerId, items, taxes = [], dueDate }) { const v = invoices.create({ jobId, customerId, items, taxes, dueDate }); invoices.ready(v.id); return ok("INVOICE_READY", { invoiceId: v.id, total: v.total, approvalSubject: v.id + ":" + v.total + ":" + v.currency, action: "ISSUE_INVOICE" }); }
  function issueInvoice(jobId, invoiceId, ownerApproval) { invoices.issue(invoiceId, ownerApproval); jobs.transition(jobId, "INVOICED", { invoiceId }); return ok("INVOICE_ISSUED"); }
  const sendInvoice = (invoiceId, communicationId) => (invoices.markSent(invoiceId, communicationId), ok("INVOICE_SENT"));
  function claimPayment(jobId, invoiceId, { claimant, amount, via = "MESSAGE" }) {
    const v = invoices.get(invoiceId); invoices.claimPaid(invoiceId, { claimant, via, amount });
    const c = payments.claim({ invoiceId, jobId, amount: amount ?? v.total, currency: v.currency, claimant, via }); if (jobs.get(jobId).status === "INVOICED") jobs.transition(jobId, "PAYMENT_PENDING");
    return ok("PAYMENT_CLAIMED", { paymentId: c.id, verified: false });
  }
  async function verifyPayment(jobId, paymentId, authorityId) {
    const r = await payments.verify(paymentId, authorityId);
    if (r.status !== "VERIFIED") return stop("PAYMENT_VERIFICATION", r.status, { reason: r.reason ?? r.verification?.reason ?? null, paymentId });
    const inv = invoices.reconcile(r.invoiceId);
    if (inv.status === "VERIFIED_PAID") jobs.transition(jobId, "PAID_VERIFIED", { paymentId });
    return ok("PAYMENT_VERIFIED", { invoiceStatus: inv.status, paymentId, environment });
  }

  // ---- 7. COST -> VERIFIED NET PROFIT -> LEARNING ------------------------------------------------------------------------------------------------------------
  function recordCost(jobId, { provider = "UNSPECIFIED", category = "MODEL", amountUsd, evidence, tokensIn = 0, tokensOut = 0, note = "" }) {
    const row = ledger.recordCost({ jobId, provider, category, amountUsd, evidence, tokensIn, tokensOut, note });
    jobs.addCost(jobId, { class: "ACTUAL", category: ["MODEL", "TOOL", "PROVIDER", "LABOR"].includes(category) ? category : "OTHER", amountUsd, ref: "ledger#" + row.seq }); return ok("COST_RECORDED", { seq: row.seq });
  }
  function close(jobId, { lessons = [] } = {}) {
    const rep = finance.report({ jobId }), net = rep.VERIFIED_ACTUAL.netProfitUsd, j = jobs.get(jobId);
    const profit = { verifiedNetProfitUsd: net, verifiedRevenueUsd: rep.VERIFIED_ACTUAL.revenueUsd, verifiedCostUsd: rep.VERIFIED_ACTUAL.costUsd, environment, countsAsRevenue: environment === "LIVE", basis: rep.VERIFIED_ACTUAL.basis };
    jobs.transition(jobId, "CLOSED", { profit });
    const verified = j.verification?.verdict === "ACCEPT" && j.verification?.independent === true;
    const learned = brain.memory.recordOutcome({ tenantId, jobId, taskType: j.source.split(":")[0], agentId: j.assignedAgents[0] ?? null, action: "MONEY_ENGINE_CYCLE", outcome: "CLOSED", verification: j.verification, evidenceRef: verified ? { source: "INDEPENDENT_VERIFIER", reference: j.verification.verifierId + ":" + jobId } : null, reward: net, costUsd: rep.VERIFIED_ACTUAL.costUsd, lessons, scope: "BUSINESS" });
    return ok("CLOSED", { profit, learned });
  }

  // ---- traceability: OPPORTUNITY > DECISION > WORK > RESULT > MONEY, joined by stored ids (not by assertion) ------------------------------------------------
  function trace(dealId) {
    const d = deals.get(dealId); if (!d) return null; const j = d.jobId ? jobs.get(d.jobId) : null;
    return {
      environment, opportunity: brain.opportunity.get(d.opportunityId) && { id: d.opportunityId, stage: brain.opportunity.get(d.opportunityId).stage },
      decision: { dealId, status: d.status, history: d.history.map(h => h.to), communications: d.communications.map(c => ({ id: c, state: comms.get(c)?.state })) },
      work: j && { jobId: j.id, status: j.status, agents: j.assignedAgents, planId: j.planId, artifacts: j.artifacts.map(a => ({ id: a, qa: artifacts.get(a).qaStatus, verification: artifacts.get(a).verificationStatus, delivery: artifacts.get(a).deliveryStatus })) },
      result: j && { deliveries: delivery.list({ jobId: j.id }).map(x => ({ id: x.id, status: x.status })), verification: j.verification && { verdict: j.verification.verdict, independent: j.verification.independent } },
      money: j && { invoices: invoices.list({ jobId: j.id }).map(x => ({ id: x.id, status: x.status, total: x.total })), payments: payments.list().filter(x => x.jobId === j.id).map(x => ({ id: x.id, status: x.status, amount: x.amount })), costs: jobs.costSummary(j.id), profit: j.profit }
    };
  }
  /** Control Center panel data: recorded values only (zero when nothing is recorded). */
  function panel() {
    const fr = finance.report();
    return { environment, deals: deals.summary(), jobs: Object.fromEntries(jobs.statuses.map(s => [s, jobs.list({ status: s }).length])), artifacts: artifacts.summary(), communications: comms.summary(), deliveries: delivery.summary(), invoices: invoices.summary(), payments: payments.summary(), recurring: recurring.report(),
      money: { forecastUsd: fr.FORECAST.totalUsd, estimateCostUsd: fr.ESTIMATE.costUsd, claimedNotVerifiedUsd: fr.CLAIM.amountUsd, actualUnverifiedCostUsd: fr.ACTUAL.costUsd, verifiedRevenueUsd: fr.VERIFIED_ACTUAL.revenueUsd, verifiedCostUsd: fr.VERIFIED_ACTUAL.costUsd, grossProfitUsd: fr.VERIFIED_ACTUAL.grossProfitUsd, verifiedNetProfitUsd: fr.VERIFIED_ACTUAL.netProfitUsd, countsAsRevenue: fr.VERIFIED_ACTUAL.countsAsRevenue }, judges: judges.list().map(x => x.id) };
  }
  return { discover, prepareOutreach, sendOutreach, recordReply, win, execute, checkWork, prepareDelivery, deliver, draftInvoice, issueInvoice, sendInvoice, claimPayment, verifyPayment, recordCost, close, trace, panel,
    engines: { recurring, jobs, artifacts, qa, judges, comms, deals, delivery, invoices, payments, finance, ledger, search, evidence }, environment };
}
