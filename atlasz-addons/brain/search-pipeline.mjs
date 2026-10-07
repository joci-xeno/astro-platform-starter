// Governed SEARCH/SALES intelligence pipeline (V7.3 Joci package §4). The five SEARCH agents feed this; it never contacts anyone.
// DISCOVER > SECURITY SCREEN > DEDUPLICATE > VERIFY SOURCE > EXTRACT > SCORE > QUALIFY > FEASIBILITY > CAPABILITY MATCH > PRIORITIZE > CREATE RECORD > HAND OFF
// Unknown stays unknown: no value, cost, profit or effort is invented. Preliminary qualification here NEVER drops a candidate that is clean and new;
// the authoritative, independently verified screening happens in the 25-agent execution pool (hand-off).
import { scoreOpportunity } from "./opportunity-intelligence.mjs";

export const SEARCH_STAGES = Object.freeze(["DISCOVER", "SECURITY_SCREEN", "DEDUPLICATE", "VERIFY_SOURCE", "EXTRACT", "SCORE", "QUALIFY", "FEASIBILITY", "CAPABILITY_MATCH", "PRIORITIZE", "CREATE_RECORD", "HAND_OFF"]);
const SOURCES = Object.freeze({ hn: { host: "news.ycombinator.com", trust: "PUBLIC_SOURCE_AUTHOR_UNVERIFIED" } });

export function createSearchPipeline({ security, opportunity, graph = null, blackBox = null, isDuplicate = () => false, extract, requiredCapabilities = ["screen"], now = () => new Date().toISOString() } = {}) {
  if (!security || !opportunity || typeof extract !== "function") throw new Error("SECURITY_OPPORTUNITY_EXTRACT_REQUIRED");
  const rec = (kind, p) => { try { return blackBox?.record({ kind, ...p }); } catch { return null; } };

  /** raw: {id, title, text, url, published, source:'hn'}. Returns {handoff, stage, reasons, record, candidate, correlationId}. */
  function process(raw = {}, { agentId = null } = {}) {
    const corr = blackBox?.newCorrelationId?.() ?? null, trail = [];
    const stop = (stage, decision, reasons, extra = {}) => { rec("SEARCH_PIPELINE", { correlationId: corr, agentId, jobId: raw.id, workflow: stage, decision, reason: reasons.join(","), team: "SEARCH" }); return { handoff: false, stage, decision, reasons, correlationId: corr, trail, ...extra }; };
    const pass = (stage, note) => trail.push({ stage, note: note ?? "OK" });
    // 1 DISCOVER
    if (!raw.id || !raw.url || !(raw.title || raw.text)) return stop("DISCOVER", "REJECT", ["MALFORMED_INPUT"]);
    pass("DISCOVER");
    // 2 SECURITY SCREEN (before anything else reads the text)
    const sec = security.assess({ kind: "EXTERNAL_INSTRUCTION", agentId: null, source: raw.source ?? "?", text: String(raw.text ?? "") });
    if (!sec.allowed) { rec("EXTERNAL_TEXT_QUARANTINED", { correlationId: corr, agentId, decision: sec.decision, reason: sec.reasons.join(","), inputRef: raw.id }); return stop("SECURITY_SCREEN", sec.decision, sec.reasons, { quarantined: true }); }
    pass("SECURITY_SCREEN", sec.decision);
    // 3 DEDUPLICATE
    if (isDuplicate(raw)) return stop("DEDUPLICATE", "DUPLICATE", ["ALREADY_SEEN"]);
    pass("DEDUPLICATE");
    // 4 VERIFY SOURCE (only what can be checked: host matches the declared source; author/buyer identity is NOT verified)
    const src = SOURCES[raw.source];
    let host = null; try { host = new URL(raw.url).host; } catch { /* invalid */ }
    const sourceVerification = !src ? { level: "UNKNOWN_SOURCE", host } : host === src.host ? { level: src.trust, host, buyerIdentity: "UNVERIFIED" } : { level: "SOURCE_HOST_MISMATCH", host };
    if (sourceVerification.level === "SOURCE_HOST_MISMATCH" || sourceVerification.level === "UNKNOWN_SOURCE") return stop("VERIFY_SOURCE", "REJECT", [sourceVerification.level]);
    pass("VERIFY_SOURCE", sourceVerification.level);
    // 5 EXTRACT
    const x = extract(raw);
    const estimatedValue = x.leadValue ? { amount: x.leadValue.amount, currency: x.leadValue.currency, basis: "BUDGET_STATED_IN_SOURCE_UNVERIFIED" } : null;
    pass("EXTRACT");
    // 6 SCORE (explainable; unknown factors stay unknown)
    const factors = { capabilityFit: x.skill ? 1 : null, legitimacy: x.reject.includes("UPFRONT_COST_OR_SCAM_SIGNAL") ? 0 : null, lowRisk: x.reject.includes("UPFRONT_COST_OR_SCAM_SIGNAL") ? 0 : null };
    const scoring = scoreOpportunity({ factors, estRevenueUsd: x.leadValue?.currency === "USD" ? x.leadValue.amount : null, estCostUsd: null });
    pass("SCORE", scoring.score + "/100");
    // 7 QUALIFY (preliminary)
    const preQualified = x.reject.length === 0;
    pass("QUALIFY", preQualified ? "PRELIMINARY_PASS" : "PRELIMINARY_FAIL:" + x.reject.join(","));
    // 8 FEASIBILITY
    const feasibility = { remote: x.checks?.remoteExplicit === true ? "EXPLICIT" : "UNVERIFIED", deliverable: x.checks?.deliverable ?? "UNVERIFIED", paymentRoute: x.checks?.paymentRoute ?? "UNVERIFIED", credentials: x.checks?.requiredCredentials ?? "UNVERIFIED" };
    pass("FEASIBILITY");
    // 9 CAPABILITY MATCH (graph decides)
    const m = graph ? graph.match({ capabilities: requiredCapabilities }) : null;
    const capabilityMatch = m ? { agent: m.combination.AGENT ?? null, missing: m.missingCapabilities } : { agent: null, missing: ["NO_GRAPH"] };
    pass("CAPABILITY_MATCH", capabilityMatch.missing.length ? "MISSING:" + capabilityMatch.missing.join(",") : "OK");
    // 10 PRIORITIZE
    const priority = !preQualified ? "LOW_PREFILTERED" : scoring.score >= 60 ? "HIGH" : scoring.score >= 30 ? "MEDIUM" : "LOW";
    pass("PRIORITIZE", priority);
    // 11 CREATE OPPORTUNITY RECORD
    const d = opportunity.discover({ title: raw.title || raw.id, source: raw.source, url: raw.url });
    const profit = scoring.estProfitUsd;
    const patch = {
      customerProblem: String(raw.title || "").slice(0, 200) + " — " + String(raw.text ?? "").slice(0, 300), opportunityType: x.skill ?? "UNCLASSIFIED", estimatedValue, confidence: { score: scoring.score, coverage: scoring.coverage, note: scoring.explanation },
      requiredWork: x.skill ? "Digital project work: " + x.skill + " (scope to be confirmed by buyer brief)" : "UNKNOWN", requiredCapabilities: requiredCapabilities, estimatedEffort: "UNKNOWN", estimatedCostUsd: null,
      profitPotentialUsd: profit, profitBasis: profit === null ? "UNKNOWN_COST_NOT_ESTIMATED" : "EST_REVENUE_MINUS_EST_COST", risk: x.reject.length ? x.reject : ["BUYER_UNVERIFIED"], recurringPotential: "UNKNOWN",
      status: preQualified ? "PRELIMINARY_QUALIFIED" : "PRELIMINARY_FILTERED", evidence: [{ type: "SOURCE_URL", ref: raw.url }, { type: "SOURCE_VERIFICATION", ref: sourceVerification.level }, { type: "SECURITY_SCREEN", ref: sec.decision }],
      nextAction: preQualified ? "SCREEN_IN_EXECUTION_POOL" : "SCREEN_IN_EXECUTION_POOL_LOW_PRIORITY", feasibility, capabilityMatch, priority, sourceVerification, correlationId: corr, createdBy: agentId, searchTrail: trail.map(t => t.stage)
    };
    opportunity.update(d.id, patch);
    pass("CREATE_RECORD", d.id);
    // 12 HAND OFF
    rec("SEARCH_PIPELINE", { correlationId: corr, agentId, jobId: raw.id, workflow: "HAND_OFF", decision: priority, reason: "opportunity:" + d.id, team: "SEARCH" });
    pass("HAND_OFF");
    return { handoff: true, stage: "HAND_OFF", decision: priority, reasons: [], opportunityId: d.id, duplicateOpportunity: d.duplicate, priority, preQualified, extraction: x, sourceVerification, correlationId: corr, trail };
  }
  return { process, stages: SEARCH_STAGES };
}
