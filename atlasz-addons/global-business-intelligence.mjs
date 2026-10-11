// GLOBAL BUSINESS INTELLIGENCE (read-only analytics manager under the Master Coordinator).
// It owns no data: it reads the discovery engine, the workforce pipeline, the ranking, the agents' real task history and the financial ledger, and reports them side by side with the
// evidence class kept apart (verified receipts / estimates / simulated / operator-captured / connector-retrieved). It never fabricates interest, proposals, contracts or revenue,
// never converts currencies (amounts stay in the source currency), never sends anything and holds no authority.
const R = (reason, extra = {}) => ({ ok: false, reason, ...extra });
const by = (arr, f) => arr.reduce((o, x) => { const k = f(x) ?? "UNKNOWN"; o[k] = (o[k] ?? 0) + 1; return o; }, {});
const STAGES = ["DISCOVERED", "VERIFIED", "QUALIFIED", "PLANNED", "APPROVAL_REQUIRED", "PROPOSED", "CONTRACTED", "IN_PROGRESS", "QUALITY_CHECKED", "DELIVERED", "PAYMENT_PENDING", "PAID"];

export function createGlobalBusinessIntelligence({ workforce, discovery = null, models = null, now = () => new Date().toISOString(), clock = () => Date.now() } = {}) {
  if (!workforce || typeof workforce.systemView !== "function") throw new Error("WORKFORCE_REQUIRED");
  function report() {
    const sys = workforce.systemView(), agents = workforce.agentViews(), pipe = sys.pipeline, t = clock();
    const disc = discovery ? { sources: discovery.sources(), coverage: discovery.coverage() } : null;
    const funnel = Object.fromEntries(STAGES.map(s => [s, 0])); for (const o of pipe) if (o.lifecycle in funnel) funnel[o.lifecycle]++;
    const withDisc = pipe.filter(o => o.discovery);
    const sourceStats = Object.entries(by(withDisc, o => o.discovery.sourceId)).map(([sourceId, n]) => { const mine = withDisc.filter(o => o.discovery.sourceId === sourceId); return { sourceId, opportunities: n, eligible: mine.filter(o => o.eligible).length, ineligible: mine.filter(o => !o.eligible).length, retrieval: by(mine, o => o.retrieval), connected: disc?.sources.find(s => s.id === sourceId)?.genuinelyConnected ?? false }; });
    const regions = disc ? Object.entries(disc.coverage).map(([region, c]) => ({ region, catalogued: c.catalogued, readyApprovedHost: c.readyOrConnected, genuinelyConnected: c.genuinelyConnected, blocked: c.blocked })) : [];
    const deadlines = withDisc.filter(o => o.discovery.deadline && o.retrieval !== "FIXTURE").map(o => { const days = +((Date.parse(o.discovery.deadline) - t) / 864e5).toFixed(1); return { opportunityId: o.id, title: o.title, deadline: o.discovery.deadline, daysLeft: days, state: days < 0 ? "PASSED" : days <= 7 ? "NEAR" : "OPEN", lifecycle: o.lifecycle }; }).sort((a, b) => a.daysLeft - b.daysLeft);
    // amounts stay in the source currency; nothing is converted (no invented exchange rate)
    const exposure = {}; for (const o of withDisc.filter(x => x.eligible && x.retrieval !== "FIXTURE")) { const cur = o.discovery.currency ?? "UNKNOWN"; exposure[cur] ??= { opportunities: 0 }; exposure[cur].opportunities++; }
    const perf = agents.map(a => ({ agentId: a.id, team: a.team, tasks: a.history.total, verified: a.history.verified, failed: a.history.failed, reworked: a.history.rejectedThenReworked, successRate: a.history.total ? +(a.history.verified / a.history.total).toFixed(3) : null, costUsd: a.cost.taskCostUsd })).filter(p => p.tasks > 0);
    const real = sys.deliverables.filter(d => d.provenance !== "SIMULATED"), sim = sys.deliverables.filter(d => d.provenance === "SIMULATED");
    return { ok: true, at: now(),
      funnel, funnelNote: "A stage counts only with its evidence; DISCOVERED is not a contract, PROPOSED is not accepted, DELIVERED is not paid.",
      sources: sourceStats, regions, deadlines, currencyExposure: exposure, currencyNote: "Counts per source currency. No conversion: no exchange rate with a date and source has been supplied.",
      ranking: sys.ranking, performance: perf,
      deliverables: { verifiedReal: real.filter(d => d.status === "VERIFIED").length, simulated: sim.length, awaitingCheck: real.filter(d => d.status === "SUBMITTED").length },
      financial: { verifiedReceivedUsd: sys.verifiedRevenue.verifiedReceivedUsd, paymentRecords: sys.verifiedRevenue.paymentRecords, estimatedPipelineUsd: sys.estimatesAndPipeline.opportunityEstimates, unconfirmedPipelineUsd: sys.estimatesAndPipeline.unconfirmedPipelineUsd, costsUsd: sys.costs.totalUsd, kinds: { verifiedReceived: "VERIFIED_RECEIPTS_ONLY", estimates: "ESTIMATE_NOT_REVENUE", simulated: "NEVER_REVENUE" } },
      claims: { proposalsSent: 0, contracts: pipe.filter(o => ["CONTRACTED", "IN_PROGRESS", "QUALITY_CHECKED", "DELIVERED", "PAYMENT_PENDING", "PAID"].includes(o.lifecycle)).length, note: "ATLASZ itself sends nothing; proposal drafts are not bids. Contract counts come only from lifecycle stages recorded with owner approval and evidence." } };
  }
  const health = () => { try { const r = report(); return { ok: r.ok === true, detail: "funnel over " + Object.values(r.funnel).reduce((a, b) => a + b, 0) + " opportunities; " + r.sources.length + " source(s) seen", data: { opportunities: Object.values(r.funnel).reduce((a, b) => a + b, 0) } }; } catch (e) { return { ok: false, reason: String(e?.message ?? e).slice(0, 80) }; } };
  return { report, health };
}
