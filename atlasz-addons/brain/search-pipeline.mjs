// Governed SEARCH/SALES intelligence pipeline (V7.3 Joci package §4). The five SEARCH agents feed this; it never contacts anyone.
// DISCOVER > SECURITY SCREEN > DEDUPLICATE > VERIFY SOURCE > EXTRACT > SCORE > QUALIFY > FEASIBILITY > CAPABILITY MATCH > PRIORITIZE > CREATE RECORD > HAND OFF
// Unknown stays unknown: no value, cost, profit or effort is invented. Preliminary qualification here NEVER drops a candidate that is clean and new;
// the authoritative, independently verified screening happens in the 25-agent execution pool (hand-off).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { scoreOpportunity } from "./opportunity-intelligence.mjs";

export const SEARCH_STAGES = Object.freeze(["DISCOVER", "SECURITY_SCREEN", "NORMALIZE", "DEDUPLICATE", "VERIFY_SOURCE", "EXTRACT", "SCORE", "QUALIFY", "FEASIBILITY", "CAPABILITY_MATCH", "PRIORITIZE", "CREATE_RECORD", "SALES_ACTION", "HAND_OFF"]);
const DEFAULT_SOURCES = Object.freeze({ hn: { host: "news.ycombinator.com", trust: "PUBLIC_SOURCE_AUTHOR_UNVERIFIED" } });
// control characters and zero-width characters never reach later stages; text/title are length-capped so a hostile source cannot flood the pipeline
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
export const fingerprintOf = n => crypto.createHash("sha256").update((n.title + "\n" + n.text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()).digest("hex").slice(0, 32);
export function defaultNormalize(raw) { return { id: String(raw.id), title: clean(raw.title, 300), text: clean(raw.text, 4000), url: String(raw.url ?? "").trim(), published: raw.published ?? null, source: raw.source ?? null }; }

export function createSearchPipeline({ security, opportunity, graph = null, blackBox = null, isDuplicate = () => false, extract, requiredCapabilities = ["screen"], sources = DEFAULT_SOURCES, file = null, now = () => new Date().toISOString() } = {}) {
  if (!security || !opportunity || typeof extract !== "function") throw new Error("SECURITY_OPPORTUNITY_EXTRACT_REQUIRED");
  // durable duplicate memory + rejection log (provenance of every decision, including the "no")
  let mem = { fingerprints: {}, rejections: [], counts: {} };
  if (file && fs.existsSync(file)) { try { mem = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("SEARCH_STORE_UNREADABLE"); } }
  const persist = () => { if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); const t = file + ".tmp"; fs.writeFileSync(t, JSON.stringify(mem)); fs.renameSync(t, file); };
  const SOURCES = { ...sources }, normalizers = {};
  /** Add a source adapter. normalize(raw)->{id,title,text,url,published,source}. Adapters only describe data; they never fetch here. */
  const registerSource = (id, { host, trust = "PUBLIC_SOURCE_AUTHOR_UNVERIFIED", normalize = null } = {}) => { if (!id || !host) throw new Error("SOURCE_ID_AND_HOST_REQUIRED"); SOURCES[id] = { host, trust }; if (normalize) normalizers[id] = normalize; return { registered: id }; };
  const reject = (raw, stage, decision, reasons) => { mem.counts[stage + ":" + decision] = (mem.counts[stage + ":" + decision] ?? 0) + 1; mem.rejections.push({ at: now(), id: raw?.id ?? null, source: raw?.source ?? null, stage, decision, reasons }); if (mem.rejections.length > 500) mem.rejections.shift(); persist(); };
  const rec = (kind, p) => { try { return blackBox?.record({ kind, ...p }); } catch { return null; } };

  /** raw: {id, title, text, url, published, source:'hn'}. Returns {handoff, stage, reasons, record, candidate, correlationId}. */
  function process(raw = {}, { agentId = null } = {}) {
    const corr = blackBox?.newCorrelationId?.() ?? null, trail = [];
    const stop = (stage, decision, reasons, extra = {}) => { reject(raw, stage, decision, reasons); rec("SEARCH_PIPELINE", { correlationId: corr, agentId, jobId: raw.id, workflow: stage, decision, reason: reasons.join(","), team: "SEARCH" }); return { handoff: false, stage, decision, reasons, correlationId: corr, trail, ...extra }; };
    const pass = (stage, note) => trail.push({ stage, note: note ?? "OK" });
    // 1 DISCOVER
    const rawStrings = Object.entries(raw).filter(([k, v]) => typeof v === "string" && !["id", "url", "source"].includes(k)).map(([, v]) => v);
    if (!raw.id || !raw.url || !rawStrings.some(v => v.trim())) return stop("DISCOVER", "REJECT", ["MALFORMED_INPUT"]);
    pass("DISCOVER");
    // 2 SECURITY SCREEN (before anything else reads the text)
    const sec = security.assess({ kind: "EXTERNAL_INSTRUCTION", agentId: null, source: raw.source ?? "?", text: rawStrings.join("\n") });
    if (!sec.allowed) { rec("EXTERNAL_TEXT_QUARANTINED", { correlationId: corr, agentId, decision: sec.decision, reason: sec.reasons.join(","), inputRef: raw.id }); return stop("SECURITY_SCREEN", sec.decision, sec.reasons, { quarantined: true }); }
    pass("SECURITY_SCREEN", sec.decision);
    // 2b NORMALIZE (source adapter, then the common clean-up; the original raw object is never mutated)
    let norm; try { norm = (normalizers[raw.source] ?? defaultNormalize)(raw); norm = { ...defaultNormalize({ ...raw, ...norm }), source: raw.source }; } catch (e) { return stop("NORMALIZE", "REJECT", ["NORMALIZE_FAILED:" + String(e.message).slice(0, 60)]); }
    if (!norm.title && !norm.text) return stop("NORMALIZE", "REJECT", ["EMPTY_AFTER_NORMALIZATION"]);
    raw = { ...raw, ...norm };
    pass("NORMALIZE");
    // 3 DEDUPLICATE (same id OR same normalized content under a different id/URL)
    const fp = fingerprintOf(norm);
    if (isDuplicate(raw)) return stop("DEDUPLICATE", "DUPLICATE", ["ALREADY_SEEN"]);
    if (mem.fingerprints[fp]) return stop("DEDUPLICATE", "DUPLICATE", ["DUPLICATE_CONTENT_OF:" + mem.fingerprints[fp].opportunityId]);
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
      nextAction: preQualified ? "SCREEN_IN_EXECUTION_POOL" : "SCREEN_IN_EXECUTION_POOL_LOW_PRIORITY", feasibility, capabilityMatch, priority, sourceVerification, correlationId: corr, createdBy: agentId, sourceRawId: raw.id, searchTrail: trail.map(t => t.stage)
    };
    opportunity.update(d.id, patch);
    pass("CREATE_RECORD", d.id);
    mem.fingerprints[fp] = { opportunityId: d.id, rawId: raw.id, at: now() }; persist();
    // 11b SALES ACTION (a recommendation only: this pipeline never contacts anyone)
    const salesAction = !preQualified ? { action: "NO_ACTION", reason: "PRELIMINARY_FILTERED" } : capabilityMatch.missing.length ? { action: "HOLD_CAPABILITY_GAP", reason: capabilityMatch.missing.join(","), requiresApproval: false } : { action: "DRAFT_OUTREACH_FOR_OWNER_REVIEW", requiresApproval: true, external: false, note: "needs execution-pool screening, buyer contact and owner approval before anything is sent" };
    opportunity.update(d.id, { salesAction }); pass("SALES_ACTION", salesAction.action);
    // 12 HAND OFF
    rec("SEARCH_PIPELINE", { correlationId: corr, agentId, jobId: raw.id, workflow: "HAND_OFF", decision: priority, reason: "opportunity:" + d.id, team: "SEARCH" });
    pass("HAND_OFF");
    return { handoff: true, salesAction, fingerprint: fp, stage: "HAND_OFF", decision: priority, reasons: [], opportunityId: d.id, duplicateOpportunity: d.duplicate, priority, preQualified, extraction: x, sourceVerification, correlationId: corr, trail };
  }
  /** Opportunity history: status transitions + the search trail that created it + any rejections of the same source id. */
  const history = id => { const o = opportunity.get(id); return { opportunityId: id, stage: o.stage, transitions: o.history, searchTrail: o.searchTrail ?? [], salesAction: o.salesAction ?? null, rejections: mem.rejections.filter(r => r.id === (o.sourceRawId ?? null)) }; };
  const rejections = ({ stage = null, limit = 50 } = {}) => mem.rejections.filter(r => !stage || r.stage === stage).slice(-limit).map(r => structuredClone(r));
  return { process, registerSource, history, rejections, rejectionCounts: () => ({ ...mem.counts }), sources: () => Object.keys(SOURCES), stages: SEARCH_STAGES };
}
