// Registrations: business, revenue and finance modules. The governed engines (deal pipeline, job system, communication center, invoice service, payment verification ...) are the ones the Money Engine
// wires into ONE lifecycle; the Control Center hosts that Money Engine (ctx.money()). Estimate, simulated, draft, invoice, contract and payment are kept apart by the engines themselves:
// nothing here can mark money PAID (that needs external evidence the engines demand), send anything, or sign anything.
import fs from "node:fs"; import path from "node:path";
import { ANY, str, num, arr, obj, cap, POLICY, must } from "./_util.mjs";
import { buildProposal, validateProposal } from "../proposal-quote-engine.mjs";
import { assessMessage, negotiationNextAction } from "../negotiation-engine.mjs";
import { nextFollowUp, DEFAULT_FOLLOWUPS } from "../follow-up-engine.mjs";
import { rankNextActions, chooseNextAction, priorityScore } from "../money-supervisor.mjs";
import { buildProfitStatement, validateMoneyEntry } from "../profit-accounting-engine.mjs";
import { summarize as summarizeLedger, recordMoney, MONEY_STAGES } from "../profit-ledger.mjs";
import { normalizePaymentEvent } from "../payment-confirmation-adapter.mjs";
import { createMoneyPipeline, transitionMoneyPipeline, moneyPipelineSummary, MONEY_PIPELINE_STATES } from "../money-pipeline-controller.mjs";
import { analyzeContract, compareContracts, BANNER as CONTRACT_BANNER } from "../contract-analysis.mjs";
import { TaxAccountingEngine, TAX_CAPABILITY, TAX_STATES } from "../tax-accounting-engine.mjs";
import { createClientDNA, updateClientDNA, getClientDNA } from "../client-dna-engine.mjs";
import { createRevenuePersistence, dailyTargetReport, TARGETS } from "../revenue-persistence.mjs";
import { lintDraft, platformLength, PLATFORMS, TONES } from "../social-drafts.mjs";
import { reviewPackage, INTAKE_LIMITS } from "../payment-package-intake.mjs";

const plain = x => JSON.parse(JSON.stringify(x ?? null));
const EXPECT_OBJ = r => (r && typeof r === "object" ? true : "no object result");

export function registerBusiness(broker, ctx) {
  const M = () => ctx.money(), E = () => M().engines;
  const engineModule = (id, file, manager, purpose, summaryFn, extra = {}) => broker.register({ id, source: "atlasz-addons/business/" + file, manager, lifecycle: "ON_DEMAND", policy: extra.policy ?? POLICY.draft, purpose,
    capabilities: [cap("summary", "READ_STATUS", () => plain(summaryFn()), { description: "Recorded state of this engine (zero only when nothing is recorded; never defaults)." }), ...(extra.capabilities ?? [])],
    selfTest: { capability: "summary", expect: EXPECT_OBJ } });

  // ---- the Money Engine itself (hosted in the Control Center; its own store; LIVE label, no send/deliver adapters => nothing leaves the machine)
  broker.register({ id: "business/money-engine", source: "atlasz-addons/business/money-engine.mjs", manager: "FINANCIAL_REVENUE_MANAGER", lifecycle: "CONTINUOUS", policy: POLICY.money,
    purpose: "The internal money lifecycle DISCOVER > DEAL > OUTREACH DRAFT > WIN > JOB > QA > DELIVERY > INVOICE > PAYMENT VERIFICATION > PROFIT, with LIVE and SANDBOX kept apart and verified separate from claimed.",
    capabilities: [
      cap("panel", "READ_STATUS", () => plain(M().panel()), { description: "Recorded values only: deals, jobs, artifacts, communications, deliveries, invoices, payments, recurring, money classes." }),
      cap("trace", "READ_STATUS", ({ dealId }) => plain(M().trace(dealId)), { input: obj({ dealId: str({ maxLength: 120 }) }, ["dealId"]), description: "OPPORTUNITY > DECISION > WORK > RESULT > MONEY joined by stored ids." }),
      cap("discover", "INTERNAL_BRAIN_ACTION", (a, c) => plain(M().discover(a.raw, { agentId: a.agentId ?? null })), { input: obj({ raw: obj({ id: str({ maxLength: 120 }), title: str({ maxLength: 300 }), text: str({ maxLength: 4000 }), url: str({ maxLength: 500 }), source: str({ maxLength: 40 }), published: str({ maxLength: 40 }) }, ["id", "url"], true), agentId: str({ maxLength: 40 }) }, ["raw"]), description: "Run a discovered item through security screening and qualification; creates a deal record only on hand-off (no contact, no send)." }),
      cap("prepare_outreach", "DRAFT", a => plain(M().prepareOutreach(a.dealId, a.draft)), { input: obj({ dealId: str({ maxLength: 120 }), draft: ANY }, ["dealId", "draft"]), description: "Create an outreach DRAFT (DRAFT is not SENT)." })
    ],
    selfTest: { capability: "panel", expect: r => (r.environment && r.money && r.money.verifiedRevenueUsd === 0 || r.money?.verifiedRevenueUsd >= 0 ? true : "panel shape") } });
  engineModule("business/job-system", "job-system.mjs", "FINANCIAL_REVENUE_MANAGER", "Universal Job object: the common work container across ATLASZ with cost classes (estimate / actual / unknown kept apart).", () => Object.fromEntries(E().jobs.statuses.map(s => [s, E().jobs.list({ status: s }).length])));
  engineModule("business/deal-pipeline", "deal-pipeline.mjs", "FINANCIAL_REVENUE_MANAGER", "Governed deal pipeline DISCOVERED > ... > PAID; outreach, contract and delivery steps need evidence or owner approval.", () => E().deals.summary());
  engineModule("business/artifact-registry", "artifact-registry.mjs", "FINANCIAL_REVENUE_MANAGER", "Governed artifact registry: CREATED != VERIFIED != DELIVERED as three independent evidence-backed statuses.", () => E().artifacts.summary());
  engineModule("business/communication-center", "communication-center.mjs", "CAMPAIGN_MANAGER", "Governed communication center: DRAFT > APPROVAL_REQUIRED > APPROVED > QUEUED > SENT; only a connected adapter can send, and only after a signed owner approval.", () => ({ ...E().comms.summary(), connectedAdapters: E().comms.connected() }));
  engineModule("business/delivery-service", "delivery-service.mjs", "FINANCIAL_REVENUE_MANAGER", "Governed delivery: READY > APPROVAL_REQUIRED > ATTEMPTED > DELIVERED with receipt verification; DELIVERED needs evidence.", () => E().delivery.summary());
  engineModule("business/invoice-service", "invoice-service.mjs", "FINANCIAL_REVENUE_MANAGER", "Internal invoice engine: DRAFT > READY > ISSUED > SENT > PAID_CLAIMED > PAYMENT_VERIFICATION_REQUIRED > PAID; an invoice is not a payment.", () => E().invoices.summary(), { policy: POLICY.money });
  engineModule("business/payment-verification", "payment-verification.mjs", "FINANCIAL_REVENUE_MANAGER", "Payment verification: CLAIMED > PENDING_VERIFICATION > VERIFIED | FAILED | UNKNOWN; only a registered authority with evidence can verify.", () => E().payments.summary(), { policy: POLICY.money });
  engineModule("business/recurring-billing", "recurring-billing.mjs", "FINANCIAL_REVENUE_MANAGER", "Subscription engine: a subscription is a contract, not revenue; periods generate invoices only.", () => E().recurring.report(), { policy: POLICY.money });
  engineModule("business/finance-intelligence", "finance-intelligence.mjs", "FINANCIAL_REVENUE_MANAGER", "Five finance classes that are never combined: forecast, estimate, claim, actual, verified actual.", () => E().finance.report(), { policy: POLICY.money });
  engineModule("business/qa-factory", "qa-factory.mjs", "QUALITY_ASSURANCE", "QA factory: selects checks by work type, runs them, routes failures back for repair.", () => ({ profiles: Object.keys(E().qa.profiles), kinds: E().qa.kinds }));
  engineModule("business/entity-graph", "entity-graph.mjs", "MEMORY_KNOWLEDGE_MANAGER", "Tenant-isolated customer / entity graph: customers, companies, contacts, opportunities, deals, jobs, invoices, payments linked by evidence.", () => plain(E().graph?.integrity?.() ?? { state: "NO_GRAPH" }));
  engineModule("business/crm", "crm.mjs", "CAMPAIGN_MANAGER", "Internal CRM: a VIEW over the entity graph and the live engines; it owns no copy of customer, deal, job or invoice.", () => plain(E().crm?.quality?.() ?? { state: "NO_CRM" }));
  engineModule("business/inbox-pipeline", "inbox-pipeline.mjs", "CAMPAIGN_MANAGER", "Universal inbox pipeline: RECEIVE > SECURITY SCREEN > CLASSIFY > ENTITY LINK > DEAL LINK > PRIORITIZE > ROUTE > RECORD; no inbound endpoint exists, only authorized connectors can feed it.", () => plain(ctx.inboxPipeline().summary()));

  // ---- stateless engines (pure, deterministic)
  broker.register({ id: "proposal-quote-engine", source: "atlasz-addons/proposal-quote-engine.mjs", manager: "FINANCIAL_REVENUE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.draft,
    purpose: "Proposal / quote DRAFTS with scope, deliverables, price, assumptions and exclusions; a proposal is not binding and needs a signed owner approval before it may be sent (not exposed here).",
    capabilities: [
      cap("build", "INTERNAL_COMPUTE", a => plain(buildProposal(a)), { input: obj({ dealId: str({ maxLength: 120 }), client: str({ maxLength: 200 }), scope: str({ maxLength: 4000 }), deliverables: arr(str({ maxLength: 300 })), priceUsd: num({ minimum: 0 }), deadline: str({ maxLength: 40 }), assumptions: arr(str({ maxLength: 300 })), exclusions: arr(str({ maxLength: 300 })), evidence: arr(str({ maxLength: 300 })) }, ["dealId", "scope", "priceUsd"]) }),
      cap("validate", "READ_STATUS", a => plain(validateProposal(a.proposal)), { input: obj({ proposal: ANY }, ["proposal"]) })
    ],
    selfTest: { capability: "build", args: { dealId: "SELF-TEST", scope: "self-test scope", deliverables: ["d"], priceUsd: 1, evidence: ["e"] }, expect: r => (r.status === "DRAFT" && r.binding === false ? true : "proposal must be a non-binding draft") } });
  broker.register({ id: "negotiation-engine", source: "atlasz-addons/negotiation-engine.mjs", manager: "CAMPAIGN_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.draft,
    purpose: "Read an inbound negotiation message: amounts, scope change, price below the owner's floor, anything binding; recommends the next action. Agreement can only be marked with an owner approval (not exposed).",
    capabilities: [cap("assess", "INTERNAL_COMPUTE", a => { const x = assessMessage(a); return { assessment: x, nextAction: negotiationNextAction(x) }; }, { input: obj({ message: str({ maxLength: 4000 }), currentOffer: num(), minAcceptableUsd: num({ minimum: 0 }), agreedScope: str({ maxLength: 1000 }) }, ["message"]) })],
    selfTest: { capability: "assess", args: { message: "We accept, please sign the agreement for USD 900", minAcceptableUsd: 500 }, expect: r => (r.nextAction === "OWNER_REVIEW" ? true : "binding language must go to the owner") } });
  broker.register({ id: "follow-up-engine", source: "atlasz-addons/follow-up-engine.mjs", manager: "CAMPAIGN_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "When is the next follow-up due (2, 5 and 10 days after first contact); stops on reply or closed status. Computes a due date only; it sends nothing.",
    capabilities: [cap("next", "INTERNAL_COMPUTE", a => plain(nextFollowUp(a.conversation, a.nowMs ?? Date.now())), { input: obj({ conversation: ANY, nowMs: num() }, ["conversation"]) })],
    selfTest: { capability: "next", args: { conversation: { firstContactAt: "2026-01-01T00:00:00Z", followUpsSent: 0 }, nowMs: Date.parse("2026-01-04T00:00:00Z") }, expect: r => (r && r.number === 1 && r.due === true && DEFAULT_FOLLOWUPS.length === 3 ? true : "follow-up due date wrong") } });
  broker.register({ id: "money-supervisor", source: "atlasz-addons/money-supervisor.mjs", manager: "FINANCIAL_REVENUE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Rank next money actions by win probability x value (incl. recurring) / hours to cash minus friction; recommends only, executes nothing.",
    capabilities: [cap("rank", "INTERNAL_COMPUTE", a => ({ ranked: plain(rankNextActions(a.items)) }), { input: obj({ items: arr(ANY) }, ["items"]) }), cap("choose", "INTERNAL_COMPUTE", a => ({ next: plain(chooseNextAction(a.items)) }), { input: obj({ items: arr(ANY) }, ["items"]) })],
    selfTest: { capability: "choose", args: { items: [{ id: "a", winProbability: 0.2, estimatedValueUsd: 100, hoursToCash: 10 }, { id: "b", winProbability: 0.5, estimatedValueUsd: 100, hoursToCash: 10 }, { id: "c", status: "BLOCKED", winProbability: 1, estimatedValueUsd: 1e6, hoursToCash: 1 }] }, expect: r => (r.next?.id === "b" && priorityScore({ winProbability: 1, estimatedValueUsd: 10, hoursToCash: 10 }) === 1 ? true : "ranking wrong") } });
  broker.register({ id: "profit-accounting-engine", source: "atlasz-addons/profit-accounting-engine.mjs", manager: "FINANCIAL_REVENUE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.money,
    purpose: "Verified cost/profit statement for one job: only revenue with confirmed receipt counts; unconfirmed revenue is reported apart.",
    capabilities: [cap("statement", "READ_STATUS", a => plain(buildProfitStatement(a)), { input: obj({ jobId: str({ maxLength: 120 }), entries: arr(ANY) }, ["jobId", "entries"]) }), cap("validate_entry", "READ_STATUS", a => plain(validateMoneyEntry(a.entry)), { input: obj({ entry: ANY }, ["entry"]) })],
    selfTest: { capability: "statement", args: { jobId: "SELF-TEST", entries: [{ type: "COST", amountUsd: 10 }, { type: "REVENUE", amountUsd: 100, confirmedReceived: false }] }, expect: r => (r.verifiedReceivedUsd === 0 && r.unconfirmedRevenueUsd === 100 && r.verifiedNetProfitUsd === -10 ? true : "unconfirmed revenue leaked into verified") } });
  broker.register({ id: "profit-ledger", source: "atlasz-addons/profit-ledger.mjs", manager: "FINANCIAL_REVENUE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.money,
    purpose: "Staged money entries LEAD_VALUE > PROPOSED > AGREED > INVOICED > PAID; PAID requires confirmed receipt and external evidence; summary counts only confirmed PAID.",
    capabilities: [cap("summarize", "READ_STATUS", a => plain(summarizeLedger(a.entries)), { input: obj({ entries: arr(ANY) }, ["entries"]) }), cap("stages", "READ_STATUS", () => ({ stages: [...MONEY_STAGES] }))],
    selfTest: { capability: "summarize", args: { entries: [{ stage: "INVOICED", amountUsd: 500, costUsd: 0 }, { stage: "PAID", amountUsd: 100, costUsd: 20, confirmedReceived: true, externalEvidence: "bank-ref" }] }, expect: r => (r.confirmedPaidUsd === 100 && r.verifiedNetProfitUsd === 80 && typeof recordMoney === "function" ? true : "invoiced counted as paid") } });
  broker.register({ id: "payment-confirmation-adapter", source: "atlasz-addons/payment-confirmation-adapter.mjs", manager: "FINANCIAL_REVENUE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.money,
    purpose: "Normalize a provider payment event to ATLASZ's shape. Confirming a payment as received needs a provider-signed webhook, which waits for the Stripe/KOHO package (deferred): confirmPaid is deliberately NOT exposed.",
    capabilities: [cap("normalize", "READ_STATUS", a => plain(normalizePaymentEvent(a)), { input: obj({ provider: str(), eventId: str(), invoiceId: str(), dealId: str(), amount: num({ minimum: 0 }), currency: str({ maxLength: 8 }), status: str({ maxLength: 20 }), receivedAt: str({ maxLength: 40 }), evidence: str({ maxLength: 500 }) }, ["provider", "eventId", "amount", "status"]) })],
    selfTest: { capability: "normalize", args: { provider: "self-test", eventId: "e1", amount: 5, status: "paid" }, expect: r => (r.status === "PAID" && !("confirmedReceived" in r) ? true : "normalizing must never confirm receipt") } });
  broker.register({ id: "money-pipeline-controller", source: "atlasz-addons/money-pipeline-controller.mjs", manager: "FINANCIAL_REVENUE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.money,
    purpose: "Auditable 16-state money pipeline state machine; owner-gated states and evidence-gated states are enforced; verified payment needs signature + provider confirmation (not exposed).",
    capabilities: [cap("create", "DRAFT", a => plain(createMoneyPipeline(a)), { input: obj({ id: str(), sourceEvidence: str({ maxLength: 500 }), estimatedValueUsd: num({ minimum: 0 }), currency: str({ maxLength: 8 }), title: str({ maxLength: 200 }) }, ["id", "sourceEvidence"]) }),
      cap("transition", "DRAFT", a => plain(transitionMoneyPipeline(a.pipeline, a.next, { evidence: a.evidence ?? null, note: a.note ?? null })), { input: obj({ pipeline: ANY, next: str({ maxLength: 40 }), evidence: str({ maxLength: 500 }), note: str({ maxLength: 300 }) }, ["pipeline", "next"]), description: "Owner-gated targets are refused here (no ownerApproved flag is accepted from a caller)." }),
      cap("states", "READ_STATUS", () => ({ states: [...MONEY_PIPELINE_STATES] })), cap("summary", "READ_STATUS", a => plain(moneyPipelineSummary(a.pipeline)), { input: obj({ pipeline: ANY }, ["pipeline"]) })],
    selfTest: { capability: "states", expect: r => (r.states.length === 16 ? true : "state list") } });
  broker.register({ id: "contract-analysis", source: "atlasz-addons/contract-analysis.mjs", manager: "FINANCIAL_REVENUE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.draft,
    purpose: "Clause-level contract analysis and comparison for qualified review. " + CONTRACT_BANNER,
    capabilities: [cap("analyze", "INTERNAL_COMPUTE", a => plain(analyzeContract({ id: a.id ?? "doc", text: a.text })), { input: obj({ id: str({ maxLength: 80 }), text: str({ maxLength: 200000 }) }, ["text"]) }), cap("compare", "INTERNAL_COMPUTE", a => plain(compareContracts(a.documents)), { input: obj({ documents: arr(ANY, { maxItems: 8 }) }, ["documents"]) })],
    selfTest: { capability: "analyze", args: { text: "1. Payment. The client shall pay within 30 days.\n\n2. Termination. Either party may terminate on 30 days notice.\n\n3. Liability. Liability is unlimited." }, expect: r => (JSON.stringify(r).match(/legal|review/i) ? true : "analysis must carry the legal-review banner") } });
  broker.register({ id: "tax-accounting-engine", source: "atlasz-addons/tax-accounting-engine.mjs", manager: "FINANCIAL_REVENUE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.money,
    purpose: "Tax & accounting workflow PLANNING for CA/CA-BC: refuses to plan without a source-verified rule set (BLOCKED_TAX_RULE_UNVERIFIED); never files, pays or certifies anything.",
    capabilities: [cap("capability", "READ_STATUS", () => plain(TAX_CAPABILITY)), cap("plan", "INTERNAL_COMPUTE", async a => plain(await new TaxAccountingEngine({}).plan(a)), { input: obj({ country: str({ maxLength: 4 }), region: str({ maxLength: 4 }), taxType: str({ maxLength: 20 }), taxYear: { type: "integer" } }, ["country", "taxType", "taxYear"]) })],
    selfTest: { capability: "plan", args: { country: "CA", region: "BC", taxType: "T1", taxYear: 2025 }, needs: "a source-verified tax rule store (CRA / Government of BC); until then every plan is BLOCKED_TAX_RULE_UNVERIFIED", expect: r => (r.status === TAX_STATES.BLOCKED_TAX_RULE_UNVERIFIED ? true : "unverified rules must block") } });
  broker.register({ id: "revenue-persistence", source: "atlasz-addons/revenue-persistence.mjs", manager: "FINANCIAL_REVENUE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Daily revenue persistence planning and reporting against targets; plans and reports only, never sends or spends; unknown revenue stays unknown.",
    capabilities: [cap("targets", "READ_STATUS", () => plain({ targets: TARGETS })), cap("status", "READ_STATUS", () => plain(ctx.revenuePersistence().status()))],
    selfTest: { capability: "targets", expect: r => (r.targets && typeof createRevenuePersistence === "function" && typeof dailyTargetReport === "function" ? true : "targets missing") } });
  broker.register({ id: "social-drafts", source: "atlasz-addons/social-drafts.mjs", manager: "CAMPAIGN_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.draft,
    purpose: "Social media writing assistance, DRAFT ONLY: platform length lint, tone, claim check; publishing is a separate action that needs a signed owner approval and a connected adapter (none exists).",
    capabilities: [cap("lint", "DRAFT", a => plain(lintDraft({ text: a.text, platform: a.platform })), { input: obj({ text: str({ maxLength: 8000 }), platform: str({ maxLength: 20 }) }, ["text", "platform"]) }), cap("platforms", "READ_STATUS", () => ({ platforms: Object.keys(PLATFORMS), tones: [...TONES], sampleLength: platformLength("x", Object.keys(PLATFORMS)[0]) }))],
    selfTest: { capability: "platforms", expect: r => (r.platforms.length > 0 ? true : "no platforms") } });
  broker.register({ id: "payment-package-intake", source: "atlasz-addons/payment-package-intake.mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "OFFLINE_ACTIVATED", policy: POLICY.security,
    activation: "Used once, when the externally prepared Stripe/KOHO payment package arrives (deferred by the owner): reviewPackage() screens it read-only (no execution of package code) before anything is merged.",
    purpose: "Review gate for an externally prepared payment package BEFORE anything is merged; read-only." });
  // client DNA: module logic is in-memory; this registration persists the profiles (and replays them on start) so a restart never loses a client's voice and rules
  const dnaFile = () => path.join(ctx.stateDir, "business", "client-dna.json");
  const dnaLoad = () => { try { return JSON.parse(fs.readFileSync(dnaFile(), "utf8")); } catch { return { profiles: {} }; } };
  const dnaSave = d => { fs.mkdirSync(path.dirname(dnaFile()), { recursive: true }); const t = dnaFile() + ".tmp"; fs.writeFileSync(t, JSON.stringify(d)); fs.renameSync(t, dnaFile()); };
  broker.register({ id: "client-dna-engine", source: "atlasz-addons/client-dna-engine.mjs", manager: "MEMORY_KNOWLEDGE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.draft,
    purpose: "Per-client voice, rules, prohibitions, products, workflows and preferences with evidence, tenant-keyed and versioned; persisted by this registration (the library itself is in-memory).",
    capabilities: [
      cap("upsert", "DRAFT", a => { const d = dnaLoad(), k = a.tenantId + "|" + a.clientId; const p = d.profiles[k] ? (createClientDNA(d.profiles[k]), updateClientDNA(a.tenantId, a.clientId, a.patch ?? {})) : createClientDNA(a); d.profiles[k] = p; dnaSave(d); return plain(p); }, { input: obj({ tenantId: str({ maxLength: 60 }), clientId: str({ maxLength: 60 }), voice: ANY, rules: arr(str({ maxLength: 300 })), prohibitions: arr(str({ maxLength: 300 })), products: arr(str({ maxLength: 200 })), workflows: arr(str({ maxLength: 200 })), preferences: ANY, evidence: arr(str({ maxLength: 300 })), patch: ANY }, ["tenantId", "clientId"]) }),
      cap("get", "READ_STATUS", a => { const p = dnaLoad().profiles[a.tenantId + "|" + a.clientId] ?? null; return plain(p ? (createClientDNA(p), getClientDNA(a.tenantId, a.clientId)) : null); }, { input: obj({ tenantId: str({ maxLength: 60 }), clientId: str({ maxLength: 60 }) }, ["tenantId", "clientId"]) }),
      cap("count", "READ_STATUS", () => ({ profiles: Object.keys(dnaLoad().profiles).length }))
    ],
    selfTest: { capability: "count", expect: r => (typeof r.profiles === "number" ? true : "count") } });
  // legacy single-purpose helpers whose function is covered by the governed engines above (kept for the audit trail, not activated)
  const sup = (id, file, by, why) => broker.register({ id, source: "atlasz-addons/" + file, manager: "FINANCIAL_REVENUE_MANAGER", lifecycle: "SUPERSEDED", supersededBy: by, rationale: why, policy: POLICY.low, purpose: "Legacy starter module superseded by " + by + "." });
  sup("invoice-engine", "invoice-engine.mjs", "business/invoice-service", "The governed invoice service persists invoices, ties them to communication, payments and jobs and keeps invoice != payment; this starter keeps nothing and would be a second, unaudited invoice path.");
  sup("delivery-engine", "delivery-engine.mjs", "business/delivery-service", "The governed delivery service adds persistence, receipt verification and artifact lookups; this starter has no state.");
  sup("deal-state", "deal-state.mjs", "business/deal-pipeline", "The deal pipeline has the same gates with persistence and communication lookups; this stateless copy has a different state set and would split the truth.");
  sup("budget-consumption-governor", "budget-consumption-governor.mjs", "owner-control/financial-firewall", "Real spend control is the financial firewall (NO-SPEND default) plus the model registry's signed spend caps and billing ledger; this governor keeps budgets in a process-local Map that is lost on restart.");
}
