// Financial Intelligence (package §15). Five classes that are NEVER combined:
//   FORECAST (a projection) | ESTIMATE (a pre-work cost/value guess) | CLAIM (someone says money moved) | ACTUAL (recorded, not independently evidenced)
//   | VERIFIED_ACTUAL (documented cost in the ledger / payment VERIFIED by an authoritative source).
// Verified net profit = VERIFIED_ACTUAL revenue - VERIFIED_ACTUAL costs. Everything else is reported beside it, labelled, and excluded from it.
// Unknown stays unknown (null), nothing is zero-filled to look good, and a SANDBOX report never counts as revenue.
import { createStore, clone } from "./store.mjs";

export const FINANCE_CLASSES = Object.freeze(["FORECAST", "ESTIMATE", "CLAIM", "ACTUAL", "VERIFIED_ACTUAL"]);
const sum = l => l.reduce((s, x) => s + x, 0);

export function createFinanceIntelligence({ file = null, ledger = null, jobs = null, payments = null, invoices = null, recurring = null, environment = "SANDBOX", entity = "ATLASZ_EXTERNAL", now = () => new Date().toISOString() } = {}) {
  const S = createStore({ file, init: () => ({ forecasts: [] }) });
  function forecast({ refId, amountUsd, basis, horizon = null } = {}) {
    const a = Number(amountUsd); if (!refId || !Number.isFinite(a) || !basis) throw new Error("REF_AMOUNT_BASIS_REQUIRED");
    S.data.forecasts.push({ refId, amountUsd: a, basis, horizon, at: now(), class: "FORECAST" }); S.save(); return clone(S.data.forecasts.at(-1));
  }
  function report({ jobId = null } = {}) {
    const allJobs = jobs ? jobs.list().filter(j => !jobId || j.id === jobId) : [];
    // ESTIMATE: pre-work cost estimates carried on jobs (unknown stays unknown)
    const estimates = allJobs.flatMap(j => j.costs.filter(c => c.class === "ESTIMATE").map(c => ({ jobId: j.id, amountUsd: c.amountUsd, category: c.category })));
    const jobActuals = allJobs.flatMap(j => j.costs.filter(c => c.class === "ACTUAL").map(c => ({ jobId: j.id, amountUsd: c.amountUsd, category: c.category, ref: c.ref })));
    // CLAIM: payment claims not (yet) verified + invoices where a customer says paid
    const claims = payments ? payments.list().filter(p => ["CLAIMED", "PENDING_VERIFICATION", "UNKNOWN"].includes(p.status) && (!jobId || p.jobId === jobId)) : [];
    // VERIFIED_ACTUAL: ledger documented costs (evidence required by the ledger) and VERIFIED payments in THIS environment
    const L = ledger ? ledger.entries().filter(r => !jobId || r.jobId === jobId) : [];
    const ledgerCosts = L.filter(r => r.type === "COST" && (r.entity || "ATLASZ_EXTERNAL") === entity), ledgerPaid = L.filter(r => r.type === "REVENUE" && r.stage === "PAID" && (r.entity || "ATLASZ_EXTERNAL") === entity), ledgerRev = L.filter(r => r.type === "REVENUE" && r.stage === "REVERSED" && (r.entity || "ATLASZ_EXTERNAL") === entity);
    const verifiedPay = payments ? payments.list().filter(p => p.status === "VERIFIED" && p.environment === environment && (!jobId || p.jobId === jobId)) : [];
    // In LIVE the ledger holds the verified receipts (payment verifier writes them there). In SANDBOX the verifier's own VERIFIED records are the (non-revenue) evidence.
    const verifiedRevenue = environment === "LIVE" ? sum(ledgerPaid.map(r => r.amountUsd)) - sum(ledgerRev.map(r => r.amountUsd)) : sum(verifiedPay.map(p => p.amount));
    const verifiedCosts = sum(ledgerCosts.map(r => r.amountUsd));
    const attributed = ledgerCosts.filter(r => r.jobId).reduce((s, r) => s + r.amountUsd, 0), overhead = verifiedCosts - attributed;
    const gross = verifiedRevenue - attributed, net = verifiedRevenue - verifiedCosts;
    const by = k => { const m = {}; for (const c of ledgerCosts) m[c[k] ?? "UNATTRIBUTED"] = (m[c[k] ?? "UNATTRIBUTED"] ?? 0) + c.amountUsd; return m; };
    const catOf = c => (c.category === "MODEL" || /model|token|llm/i.test(c.category ?? "")) ? "model" : (c.category === "TOOL" ? "tool" : "other");
    const rec = recurring?.summary?.() ?? null;
    return {
      environment, entity, generatedAt: now(), classes: FINANCE_CLASSES,
      FORECAST: { totalUsd: sum(S.data.forecasts.filter(f => !jobId || f.refId === jobId).map(f => f.amountUsd)), items: S.data.forecasts.filter(f => !jobId || f.refId === jobId).length, note: "projection - not revenue" },
      ESTIMATE: { costUsd: sum(estimates.map(e => e.amountUsd ?? 0)), unknownEntries: estimates.filter(e => e.amountUsd === null).length, items: estimates.length, note: "estimates; unknown stays unknown" },
      CLAIM: { amountUsd: sum(claims.map(c => c.amount)), items: claims.length, note: "customer/agent claims - not money received" },
      ACTUAL: { costUsd: sum(jobActuals.map(a => a.amountUsd ?? 0)), unknownEntries: jobActuals.filter(a => a.amountUsd === null).length, items: jobActuals.length, note: "recorded on jobs; not independently evidenced here" },
      VERIFIED_ACTUAL: {
        revenueUsd: verifiedRevenue, costUsd: verifiedCosts, grossProfitUsd: gross, netProfitUsd: net, paymentRecords: environment === "LIVE" ? ledgerPaid.length : verifiedPay.length,
        costs: { model: sum(ledgerCosts.filter(r => catOf(r) === "model").map(r => r.amountUsd)), tool: sum(ledgerCosts.filter(r => catOf(r) === "tool").map(r => r.amountUsd)), byProvider: by("provider"), byJob: by("jobId"), byCategory: by("category"), overheadUnattributedUsd: overhead, tokensIn: sum(ledgerCosts.map(r => r.tokensIn ?? 0)), tokensOut: sum(ledgerCosts.map(r => r.tokensOut ?? 0)) },
        recurringRevenue: rec ? { verifiedMonthlyUsd: rec.verifiedRecurringMonthlyUsd ?? 0, activeContracts: rec.active ?? 0 } : { verifiedMonthlyUsd: 0, activeContracts: 0, source: "NOT_CONNECTED" },
        basis: "VERIFIED_RECEIPTS_MINUS_DOCUMENTED_COSTS", countsAsRevenue: environment === "LIVE" },
      separation: "classes are never summed together; only VERIFIED_ACTUAL feeds profit",
      reconciliation: { unverifiedActualCostsNotInProfitUsd: sum(jobActuals.map(a => a.amountUsd ?? 0)) - 0, note: "ACTUAL job costs without ledger evidence are excluded from verified profit; profit may be overstated until they are evidenced" }
    };
  }
  return { forecast, report, classes: FINANCE_CLASSES, environment };
}
