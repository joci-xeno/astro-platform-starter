// V7.3 §16 Digital Twin / Simulation Lab: SIMULATE -> JUDGE -> EXECUTE for consequential actions.
// A simulation is a model of what MIGHT happen. It is labelled SIMULATED, is never proof of real execution, and never authorizes anything:
// execution needs an independent judge PASS and (for consequential kinds) a signed owner approval bound to this exact simulation.
import { createHash, randomUUID } from "node:crypto";

export const ENVIRONMENTS = Object.freeze(["SIMULATED", "STAGING", "LIVE"]);
export const CONSEQUENTIAL_KINDS = Object.freeze(["OFFER", "CONFIG_CHANGE", "PURCHASE", "SPEND_PROPOSAL", "DEPLOYMENT", "CONTRACT", "OUTREACH_CAMPAIGN", "PRICING"]);
const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function createDigitalTwin({ ownerAuth, now = () => new Date().toISOString() } = {}) {
  if (!ownerAuth) throw new Error("OWNER_AUTH_REQUIRED");
  const sims = new Map();

  /** change: {kind, summary, costUsd, expectedRevenueUsd, probability(0..1), reversible, assumptions:[{text, evidence?}], touches:[resource ids], constraints?:{maxCostUsd, minMarginPct, forbiddenResources:[]}} */
  function simulate(change = {}, { baseline = {} } = {}) {
    if (!change.kind || !change.summary) throw new Error("CHANGE_KIND_AND_SUMMARY_REQUIRED");
    const cost = n(change.costUsd), revenue = n(change.expectedRevenueUsd), p = Math.min(1, Math.max(0, n(change.probability, 0)));
    const expectedRevenue = revenue * p, expectedNet = expectedRevenue - cost;
    const marginPct = expectedRevenue > 0 ? Math.round(((expectedRevenue - cost) / expectedRevenue) * 1000) / 10 : null;
    const assumptions = (change.assumptions ?? []).map(a => ({ text: a.text, evidence: a.evidence ?? null, status: a.evidence ? "SUPPORTED" : "UNVERIFIED" }));
    const unverified = assumptions.filter(a => a.status === "UNVERIFIED").length;
    const c = { ...(baseline.constraints ?? {}), ...(change.constraints ?? {}) }, problems = [], conflicts = [];
    if (cost > 0) problems.push("SPEND_REQUIRES_JOCI_APPROVAL");                                   // no-spend default
    if (c.maxCostUsd !== undefined && cost > c.maxCostUsd) problems.push("EXCEEDS_BUDGET:" + cost + ">" + c.maxCostUsd);
    if (c.minMarginPct !== undefined && (marginPct === null || marginPct < c.minMarginPct)) problems.push("MARGIN_BELOW_MINIMUM");
    for (const r of change.touches ?? []) { if ((c.forbiddenResources ?? []).includes(r)) conflicts.push("FORBIDDEN_RESOURCE:" + r); if ((baseline.lockedResources ?? []).includes(r)) conflicts.push("RESOURCE_LOCKED_BY_OTHER_CHANGE:" + r); }
    if (change.reversible === false) problems.push("IRREVERSIBLE");
    if (unverified > 0) problems.push("UNVERIFIED_ASSUMPTIONS:" + unverified);
    const risk = Math.min(100, (change.reversible === false ? 35 : 0) + unverified * 10 + (cost > 0 ? 20 : 0) + conflicts.length * 30 + (p < 0.5 ? 15 : 0));
    const verdict = conflicts.length ? "REJECT" : problems.some(x => /EXCEEDS_BUDGET|MARGIN_BELOW/.test(x)) ? "REJECT" : problems.length ? "REVISE_OR_APPROVE" : "PROCEED_TO_JUDGE";
    const sim = { id: randomUUID(), environment: "SIMULATED", isProof: false, createdAt: now(), kind: change.kind, summary: change.summary, consequential: CONSEQUENTIAL_KINDS.includes(change.kind),
      model: { costUsd: cost, expectedRevenueUsd: expectedRevenue, expectedNetUsd: expectedNet, marginPct, probability: p }, assumptions, conflicts, problems, riskScore: risk, verdict,
      hash: createHash("sha256").update(JSON.stringify([change.kind, change.summary, cost, revenue, p, change.touches ?? []])).digest("hex"), judged: null, executed: false,
      disclaimer: "SIMULATED result. Not evidence that anything happened in production and not an authorization." };
    sims.set(sim.id, sim); return structuredClone(sim);
  }
  /** Compare alternatives by risk-adjusted expected net value; rejected simulations are never recommended. */
  function compare(simIds = []) {
    const rows = simIds.map(id => sims.get(id)).filter(Boolean).map(s => ({ id: s.id, summary: s.summary, verdict: s.verdict, expectedNetUsd: s.model.expectedNetUsd, riskScore: s.riskScore, score: s.model.expectedNetUsd * (1 - s.riskScore / 100) }));
    const eligible = rows.filter(r => r.verdict !== "REJECT").sort((a, b) => b.score - a.score);
    return { ranked: eligible, rejected: rows.filter(r => r.verdict === "REJECT"), recommendation: eligible[0]?.id ?? null, note: "Recommendation only. Final consequential decisions belong to JOCI." };
  }
  /** Independent judge: must be a different identity than the simulator/requester; receives the sim and returns {pass, reasons}. */
  async function judge(simId, { judgeId, requestedBy = "MASTER", judgeFn } = {}) {
    const s = sims.get(simId); if (!s) throw new Error("UNKNOWN_SIMULATION");
    if (!judgeId || judgeId === requestedBy) throw new Error("JUDGE_MUST_BE_INDEPENDENT");
    if (typeof judgeFn !== "function") throw new Error("JUDGE_FUNCTION_REQUIRED");
    const r = await judgeFn(structuredClone(s));
    s.judged = { by: judgeId, pass: r?.pass === true && s.verdict !== "REJECT", reasons: r?.reasons ?? [], at: now() };
    return structuredClone(s.judged);
  }
  /** Authorizes the NEXT step only; this module never performs the real action. The caller executes and records real evidence separately. */
  function authorizeExecution(simId, { ownerApproval = null } = {}) {
    const s = sims.get(simId); if (!s) throw new Error("UNKNOWN_SIMULATION");
    const deny = reason => ({ allowed: false, reason, environment: "SIMULATED" });
    if (s.verdict === "REJECT") return deny("SIMULATION_REJECTED");
    if (!s.judged) return deny("NOT_JUDGED"); if (!s.judged.pass) return deny("JUDGE_DID_NOT_PASS");
    if (s.consequential || s.model.costUsd > 0 || s.problems.length) {
      const v = ownerAuth.verifyApproval(ownerApproval, { action: "EXECUTE_SIMULATED_CHANGE", subject: s.id + ":" + s.hash.slice(0, 16) });
      if (!v.allowed) return deny("OWNER_APPROVAL_REQUIRED:" + v.reason);
    }
    return { allowed: true, simulationId: s.id, note: "Authorized to attempt the real action. Real execution evidence must be recorded separately.", environment: "SIMULATED" };
  }
  return { simulate, compare, judge, authorizeExecution, get: id => (sims.has(id) ? structuredClone(sims.get(id)) : null), list: () => [...sims.values()].map(s => ({ id: s.id, kind: s.kind, verdict: s.verdict, environment: s.environment, judged: s.judged?.pass ?? null })) };
}
