// Phase C: the common opportunity record, update-aware de-duplication, the SEARCH -> Master hand-off (10 checks, resumable) and the source inventory.
// Reuses: global-discovery (assessListing, scamIndicators, canonicalUrl), source-adapters (validateRecord shape), text-compare (INJECTION_PATTERNS), audit-chain.
// Honesty rules: a missing budget / deadline / client / payment term stays null and is listed in `unknownFields` - never invented; a published budget is never revenue; nothing is "won" here;
// a FIXTURE or OPERATOR record is labelled as such and can never be presented as a live connector retrieval; external text is DATA and is never executed or obeyed.
import fs from "node:fs"; import path from "node:path"; import { createHash, randomBytes } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { assessListing, scamIndicators, canonicalUrl, inferRequirements, DISCOVERY_LIMITS } from "./global-discovery.mjs";
import { INJECTION_PATTERNS } from "./text-compare.mjs";
import { containsSecret, scrub } from "./secret-patterns.mjs";

export const WORKFLOW_STAGES = Object.freeze(["DISCOVER", "VERIFY", "QUALIFY", "ESTIMATE", "PLAN", "OWNER_APPROVAL", "EXECUTE", "QUALITY_ASSURANCE", "DELIVERY_APPROVAL", "DELIVER", "INVOICE", "PAYMENT_VERIFICATION", "RECONCILIATION", "NET_PROFIT"]);
export const RETRIEVALS = Object.freeze(["CONNECTOR", "OPERATOR_TOOL", "FIXTURE"]);
export const HANDOFF_STATES = Object.freeze(["RECEIVED", "VALIDATED", "EVIDENCE_CHECKED", "DEDUPED", "RISK_SCREENED", "FEASIBILITY_CHECKED", "COST_CHECKED", "CAPABILITY_CHECKED", "APPROVAL_DECIDED", "ROUTED", "REJECTED", "HELD_NEEDS_INFO"]);
const TERMINAL = new Set(["ROUTED", "REJECTED", "HELD_NEEDS_INFO"]);
const sha = t => createHash("sha256").update(t).digest("hex");
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g;
const clip = (v, n) => (v == null ? null : String(v).replace(CTRL, "").replace(/\s+/g, " ").trim().slice(0, n) || null);
const num = v => (Number.isFinite(v) && v >= 0 ? v : null);
const PAY = [["CRYPTO", /\b(btc|bitcoin|eth|ethereum|usdt|usdc|crypto(currency)?|stablecoin|web3 payment)\b/i], ["BANK_TRANSFER", /\b(bank transfer|wire transfer|sepa|invoice (net|within)|ach)\b/i], ["CARD_OR_PLATFORM", /\b(paypal|stripe|escrow|platform (payment|escrow)|credit card)\b/i]];
const stableKey = r => (r.sourceId && r.externalId ? r.sourceId + ":" + r.externalId : null);
export const contentHash = r => sha(JSON.stringify([r.title, r.description, r.client, r.budget?.min ?? null, r.budget?.max ?? null, r.currency, r.deadline]).toLowerCase().replace(/\s+/g, " "));
export const contentKey = r => sha(String(r.title ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() + "|" + String(r.client ?? "").toLowerCase().trim()).slice(0, 32);

/** Normalise one retrieved item (a global-discovery item or a source-adapter record) into the common record. Never invents a missing field. */
export function normalizeOpportunity(item = {}, { sourceId = item.sourceId, retrieval = "FIXTURE", evidenceSha256 = null, discoveredAt = new Date().toISOString(), sourceUrl = item.url ?? null } = {}) {
  if (!RETRIEVALS.includes(retrieval)) return { ok: false, reason: "RETRIEVAL_LABEL_INVALID" };
  const title = clip(item.title, 300); if (!title) return { ok: false, reason: "TITLE_REQUIRED" };
  const description = clip(item.description, DISCOVERY_LIMITS.maxText);
  const text = [title, description, (item.tags ?? []).join(" ")].join(" . ");
  const url = canonicalUrl(sourceUrl); const externalId = clip(item.externalId ?? item.id, 120);
  const a = assessListing({ ...item, title, description }, discoveredAt), req = inferRequirements(text);
  const pay = PAY.filter(([, re]) => re.test(text)).map(([k]) => k);
  const injection = INJECTION_PATTERNS.filter(p => p.test(text)).length, secret = containsSecret(text);
  const risk = [...a.hardBlockers, ...a.fraud.indicators.map(x => "FRAUD_INDICATOR:" + x), ...(injection ? ["EMBEDDED_INSTRUCTIONS_IGNORED"] : []), ...(secret ? ["SECRET_LIKE_TEXT_REDACTED"] : []), ...(pay.includes("CRYPTO") ? ["CRYPTO_PAYMENT_COMPLIANCE_REVIEW"] : [])];
  const rec = { opportunityId: null, sourceId: clip(sourceId, 60), externalId, sourceUrl: url, discoveredAt, retrieval, client: clip(item.buyerName ?? item.client, 200), description: secret ? scrub(description ?? "") : description, title: secret ? scrub(title) : title,
    requiredSkills: req.skills, unsupportedRequirements: req.unsupported, estimatedScope: clip(item.scope, 300), budget: { min: num(item.valueAmount ?? item.estimatedValueMin), max: num(item.estimatedValueMax ?? item.valueAmount ?? item.estimatedValueMin), kind: "PUBLISHED_BUDGET_NOT_REVENUE" },
    currency: clip(item.currency, 3)?.toUpperCase() ?? null, deadline: item.deadline && Number.isFinite(Date.parse(item.deadline)) ? new Date(item.deadline).toISOString() : null,
    geographicRestrictions: a.geoRestrictions, remoteEligibility: a.requiresPhysicalPresence ? "PHYSICAL_PRESENCE_INDICATED" : item.remote === true ? "REMOTE_STATED" : "UNKNOWN", submissionRequirements: clip(item.submission, 400), paymentMethods: pay.length ? pay : null,
    contractualRequirements: Array.isArray(item.contract) ? item.contract.map(x => clip(x, 120)).filter(Boolean).slice(0, 12) : null,
    evidence: { retrieval, evidenceSha256: /^[0-9a-f]{64}$/.test(String(evidenceSha256)) ? evidenceSha256 : null, listingKind: a.listingKind, deadlineState: a.deadlineState, fraudLevel: a.fraud.level, confidence: "LEXICAL_HEURISTIC" }, riskFlags: [...new Set(risk)],
    stage: "DISCOVER", untrusted: true };
  if (rec.budget.min === null && rec.budget.max === null) rec.budget.kind = "NOT_PUBLISHED";
  rec.unknownFields = ["client", "estimatedScope", "currency", "deadline", "submissionRequirements", "paymentMethods", "contractualRequirements"].filter(k => rec[k] === null || (Array.isArray(rec[k]) && !rec[k].length)).concat(rec.budget.min === null ? ["budget"] : []);
  rec.contentHash = contentHash(rec); return { ok: true, record: rec };
}

/** Durable registry. Same stable source id (or same title+client) is the same opportunity: changed content = UPDATED (history kept), unchanged = DUPLICATE_UNCHANGED. */
export function createOpportunityRegistry({ dir, now = () => new Date().toISOString() } = {}) {
  if (!dir) throw new Error("DIR_REQUIRED"); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const audit = createAuditChain({ filePath: path.join(dir, "opportunities-audit.jsonl"), headPinFile: path.join(dir, "opportunities-audit.headpin.json"), now });
  const FILE = path.join(dir, "opportunities.json"); let S = { items: {}, byKey: {}, byContent: {} };
  if (fs.existsSync(FILE)) { try { S = JSON.parse(fs.readFileSync(FILE, "utf8")); if (!S.items || !S.byKey || !S.byContent) throw new Error("shape"); } catch { throw new Error("OPPORTUNITY_STORE_UNREADABLE"); } }
  const save = () => { const t = FILE + ".tmp"; fs.writeFileSync(t, JSON.stringify(S), { mode: 0o600 }); fs.renameSync(t, FILE); };
  function upsert(rec) {
    const k = stableKey(rec), ck = contentKey(rec); let id = (k && S.byKey[k]) || S.byContent[ck] || null;
    if (!id) { id = "opp-" + randomBytes(5).toString("hex"); S.items[id] = { ...rec, opportunityId: id, firstSeenAt: now(), lastSeenAt: now(), seen: 1, history: [] }; if (k) S.byKey[k] = id; S.byContent[ck] = id; audit.append("OPPORTUNITY_CREATED", { id, sourceId: rec.sourceId, retrieval: rec.retrieval, hash: rec.contentHash }); save(); return { action: "CREATED", id }; }
    const cur = S.items[id]; cur.lastSeenAt = now(); cur.seen++;
    if (cur.contentHash === rec.contentHash) { audit.append("OPPORTUNITY_SEEN_UNCHANGED", { id }); save(); return { action: "DUPLICATE_UNCHANGED", id }; }
    const changed = ["title", "description", "client", "currency", "deadline"].filter(f => cur[f] !== rec[f]).concat(JSON.stringify(cur.budget) !== JSON.stringify(rec.budget) ? ["budget"] : []);
    cur.history.push({ at: now(), previousHash: cur.contentHash, changed }); if (cur.history.length > 50) cur.history.shift();
    Object.assign(cur, { title: rec.title, description: rec.description, client: rec.client, budget: rec.budget, currency: rec.currency, deadline: rec.deadline, riskFlags: rec.riskFlags, evidence: rec.evidence, requiredSkills: rec.requiredSkills, unknownFields: rec.unknownFields, contentHash: rec.contentHash, retrieval: rec.retrieval });
    if (k) S.byKey[k] = id; S.byContent[ck] = id; audit.append("OPPORTUNITY_UPDATED", { id, changed }); save(); return { action: "UPDATED", id, changed };
  }
  function setStage(id, stage, by, note = null) { const o = S.items[id]; if (!o) return { ok: false, reason: "UNKNOWN_OPPORTUNITY" }; if (!WORKFLOW_STAGES.includes(stage)) return { ok: false, reason: "STAGE_INVALID" };
    const from = WORKFLOW_STAGES.indexOf(o.stage), to = WORKFLOW_STAGES.indexOf(stage); if (to > from + 1) return { ok: false, reason: "STAGE_SKIP_REFUSED:" + o.stage + "->" + stage };      // no skipping entry criteria
    o.stage = stage; (o.stageLog ??= []).push({ at: now(), stage, by: clip(by, 40), note: clip(note, 200) }); audit.append("OPPORTUNITY_STAGE", { id, stage, by: clip(by, 40) }); save(); return { ok: true, stage }; }
  const get = id => (S.items[id] ? structuredClone(S.items[id]) : null), list = () => Object.values(S.items).map(x => structuredClone(x));
  const counts = () => { const l = Object.values(S.items), by = f => l.reduce((o, x) => (o[f(x)] = (o[f(x)] ?? 0) + 1, o), {}); return { total: l.length, byStage: by(x => x.stage), byRetrieval: by(x => x.retrieval) }; };
  return { upsert, setStage, get, list, counts, verify: () => audit.verify(), auditEntries: () => audit.entries() };
}

/** SEARCH -> Master hand-off. Ten checks; every handoff has task id, provenance, timestamp, current owner, stage, audit trail, failure reason and recovery info; checkpointed so an interrupted hand-off resumes without duplicating. */
export function createMasterIntake({ dir, registry, capabilities = [], isStopped = () => false, approvalRules = {}, now = () => new Date().toISOString(), crashAfter = null } = {}) {
  if (!dir || !registry) throw new Error("DIR_AND_REGISTRY_REQUIRED"); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const audit = createAuditChain({ filePath: path.join(dir, "handoffs-audit.jsonl"), headPinFile: path.join(dir, "handoffs-audit.headpin.json"), now });
  const FILE = path.join(dir, "handoffs.json"); let S = { handoffs: {} };
  if (fs.existsSync(FILE)) { try { S = JSON.parse(fs.readFileSync(FILE, "utf8")); if (!S.handoffs) throw new Error("shape"); } catch { throw new Error("HANDOFF_STORE_UNREADABLE"); } }
  const save = () => { const t = FILE + ".tmp"; fs.writeFileSync(t, JSON.stringify(S), { mode: 0o600 }); fs.renameSync(t, FILE); };
  const R = { highValue: 5000, ...approvalRules }, have = new Set(capabilities);
  const SEARCH_ID = /^SEARCH-[1-5]$/;
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };
  const step = (h, state) => { h.state = state; h.trail.push({ at: now(), state }); save(); if (crashAfter === state) throw new Error("SIMULATED_CRASH_AFTER:" + state); };
  const finish = (h, state, reason, extra = {}) => { h.state = state; h.reason = reason ?? null; h.owner = state === "ROUTED" ? "MASTER:PLANNING" : state === "REJECTED" ? "MASTER:CLOSED" : "SEARCH:" + h.from; Object.assign(h, extra); h.trail.push({ at: now(), state, reason: reason ?? null }); audit.append("HANDOFF_" + state, { taskId: h.taskId, reason: reason ?? null, opportunityId: h.opportunityId ?? null }); save(); return view(h); };
  const view = h => structuredClone({ taskId: h.taskId, from: h.from, state: h.state, owner: h.owner, reason: h.reason, opportunityId: h.opportunityId ?? null, requiresOwnerApproval: h.requiresOwnerApproval ?? null, approvalReasons: h.approvalReasons ?? [], provenance: h.provenance, receivedAt: h.receivedAt, trail: h.trail, recovery: TERMINAL.has(h.state) ? null : { resumeFrom: h.state, how: "call resume(); steps are idempotent" } });

  /** receive({agentId, record}) -> view. `record` is the common record from normalizeOpportunity (with retrieval/evidence labels). */
  function receive({ agentId, record } = {}) {
    if (stopped()) return { ok: false, reason: "OWNER_STOP_OR_SAFE_MODE_ACTIVE" };
    if (typeof agentId !== "string" || !SEARCH_ID.test(agentId)) return { ok: false, reason: "SENDER_NOT_A_SEARCH_AGENT" };
    if (!record || typeof record !== "object") return { ok: false, reason: "RECORD_REQUIRED" };
    const taskId = "ho-" + sha(JSON.stringify([record.sourceId, record.externalId, record.contentHash, record.title])).slice(0, 16);     // idempotent: the same record is the same hand-off
    if (S.handoffs[taskId]) { return TERMINAL.has(S.handoffs[taskId].state) ? { ok: true, duplicate: true, ...view(S.handoffs[taskId]) } : resume(taskId); }
    const h = { taskId, from: agentId, owner: "MASTER:INTAKE", state: "RECEIVED", receivedAt: now(), provenance: { sourceId: record.sourceId ?? null, sourceUrl: record.sourceUrl ?? null, retrieval: record.retrieval ?? null, evidenceSha256: record.evidence?.evidenceSha256 ?? null }, record: structuredClone(record), trail: [{ at: now(), state: "RECEIVED" }] };
    S.handoffs[taskId] = h; audit.append("HANDOFF_RECEIVED", { taskId, from: agentId, sourceId: h.provenance.sourceId }); save(); return { ok: true, ...run(h) };
  }
  function run(h) {
    const r = h.record;
    // 2 structure
    if (h.state === "RECEIVED") { const bad = !r.title || typeof r.title !== "string" || !RETRIEVALS.includes(r.retrieval) || !r.sourceId || !Array.isArray(r.requiredSkills) || !Array.isArray(r.riskFlags) || !r.evidence;
      if (bad) return finish(h, "REJECTED", "MALFORMED_RECORD"); step(h, "VALIDATED"); }
    // 3 source evidence: a CONNECTOR retrieval needs an evidence hash; FIXTURE / OPERATOR records are routed but labelled and never counted as live
    if (h.state === "VALIDATED") { if (r.retrieval === "CONNECTOR" && !r.evidence.evidenceSha256) return finish(h, "REJECTED", "CONNECTOR_RETRIEVAL_WITHOUT_EVIDENCE"); if (!r.sourceUrl && r.retrieval === "CONNECTOR") return finish(h, "REJECTED", "SOURCE_URL_MISSING"); step(h, "EVIDENCE_CHECKED"); }
    // 4 duplicates (idempotent upsert: re-running after a crash cannot create a second opportunity)
    if (h.state === "EVIDENCE_CHECKED") { const u = registry.upsert(r); h.opportunityId = u.id; h.dedupe = u.action; if (u.action === "DUPLICATE_UNCHANGED" && registry.get(u.id).stage !== "DISCOVER") return finish(h, "REJECTED", "ALREADY_IN_WORKFLOW:" + registry.get(u.id).stage, { opportunityId: u.id }); step(h, "DEDUPED"); }
    // 5 risk screening: external text is data. Hard blockers close the record; embedded instructions are ignored (flag only) and never reach a prompt as instructions.
    if (h.state === "DEDUPED") { const hard = r.riskFlags.filter(f => /^(SCAM_INDICATORS_HIGH|PHYSICAL_PRESENCE_INDICATED|LICENSE_INDICATED|DEADLINE_PASSED|NOT_A_DELIVERABLE_WORK_PACKAGE)/.test(f) || /^FRAUD_INDICATOR:(UPFRONT_FEE|GIFT_CARD_OR_PREPAID|CHEQUE_OVERPAYMENT)/.test(f));
      if (hard.length) return finish(h, "REJECTED", "RISK_SCREEN:" + hard[0]); if (r.riskFlags.includes("LISTING_KIND_UNCLEAR")) return finish(h, "HELD_NEEDS_INFO", "LISTING_KIND_UNCLEAR"); step(h, "RISK_SCREENED"); }
    // 6 delivery feasibility
    if (h.state === "RISK_SCREENED") { if (r.remoteEligibility === "PHYSICAL_PRESENCE_INDICATED" || r.unsupportedRequirements?.length) return finish(h, "REJECTED", "NOT_DELIVERABLE_DIGITALLY:" + (r.unsupportedRequirements?.[0] ?? "PHYSICAL_PRESENCE")); step(h, "FEASIBILITY_CHECKED"); }
    // 7 costs: an unknown cost stays unknown; the opportunity is routed to ESTIMATE, never given an invented margin
    if (h.state === "FEASIBILITY_CHECKED") { h.costState = "UNKNOWN_ESTIMATE_REQUIRED"; step(h, "COST_CHECKED"); }
    // 8 capabilities (the real set supplied by the Master; nothing assumed)
    if (h.state === "COST_CHECKED") { const missing = r.requiredSkills.filter(s => !have.has(s)); h.missingCapabilities = missing;
      if (!r.requiredSkills.length) return finish(h, "HELD_NEEDS_INFO", "REQUIREMENTS_UNCLEAR_NO_SKILL_MATCH"); if (missing.length) return finish(h, "HELD_NEEDS_INFO", "CAPABILITY_GAP:" + missing.join(",")); step(h, "CAPABILITY_CHECKED"); }
    // 9 owner approval: outreach, acceptance and payment always need it later; here we record WHY it is needed already at planning time
    if (h.state === "CAPABILITY_CHECKED") { const why = ["OUTREACH_AND_CONTRACT_ACCEPTANCE_ALWAYS_NEED_SIGNED_OWNER_APPROVAL"]; if ((r.budget?.max ?? 0) >= R.highValue) why.push("HIGH_PUBLISHED_BUDGET"); if (r.paymentMethods?.includes("CRYPTO")) why.push("CRYPTO_PAYMENT_COMPLIANCE_REVIEW"); if (!r.client) why.push("CLIENT_IDENTITY_UNKNOWN"); if (r.retrieval !== "CONNECTOR") why.push("NOT_A_LIVE_CONNECTOR_RETRIEVAL:" + r.retrieval);
      h.requiresOwnerApproval = true; h.approvalReasons = why; step(h, "APPROVAL_DECIDED"); }
    // 10 route to the execution planning workflow (stage VERIFY -> QUALIFY ... planning still needs ESTIMATE; no jump to EXECUTE)
    if (h.state === "APPROVAL_DECIDED") { const o = registry.get(h.opportunityId); if (o.stage === "DISCOVER") registry.setStage(h.opportunityId, "VERIFY", "MASTER", "intake checks passed"); return finish(h, "ROUTED", null, { opportunityId: h.opportunityId }); }
    return view(h);
  }
  /** Re-drive every unfinished hand-off from its last checkpoint (restart recovery). Terminal ones are untouched. */
  function resume(taskId = null) {
    const one = id => { const h = S.handoffs[id]; if (!h) return { ok: false, reason: "UNKNOWN_HANDOFF" }; if (TERMINAL.has(h.state)) return { ok: true, ...view(h) }; if (stopped()) return { ok: false, reason: "OWNER_STOP_OR_SAFE_MODE_ACTIVE" }; return { ok: true, ...run(h) }; };
    return taskId ? one(taskId) : { ok: true, resumed: Object.keys(S.handoffs).filter(id => !TERMINAL.has(S.handoffs[id].state)).map(id => one(id)) };
  }
  const list = () => Object.values(S.handoffs).map(view), get = id => (S.handoffs[id] ? view(S.handoffs[id]) : null);
  const summary = () => Object.values(S.handoffs).reduce((o, h) => (o[h.state] = (o[h.state] ?? 0) + 1, o), {});
  return { receive, resume, list, get, summary, verify: () => audit.verify(), auditEntries: () => audit.entries() };
}

/** Source inventory (directive 5.1): one row per catalogued source with the ten required facts. A catalogue entry is NOT a working connection. */
const FIELDS = { OCDS_JSON: ["title", "description", "buyer", "value", "currency", "deadline", "url", "country"], WB_JSON: ["title", "buyer", "country", "deadline", "url"], RSS: ["title", "description", "published", "url"], ALGOLIA_HN_JSON: ["title", "text", "published", "url"] };
export function sourceInventory(discovery) {
  return discovery.sources().map(s => ({ name: s.name, sourceId: s.id, urlOrProvider: s.hosts.join(", "), accessMethod: s.format ?? "NO_ADAPTER", authentication: s.access === "PUBLIC" ? "NONE_REQUIRED" : s.access, usageRestrictions: s.blocker ?? s.notes ?? "none recorded", egressApproval: s.state === "READY_APPROVED_HOST" ? "OWNER_APPROVED" : s.state === "NEEDS_OWNER_HOST_APPROVAL" ? "NOT_APPROVED" : "NOT_APPLICABLE:" + s.state,
    rateLimit: Math.round(DISCOVERY_LIMITS.minIntervalMs / 1000) + "s minimum between requests per source", dataFields: FIELDS[s.format] ?? [], lastSuccessfulRetrieval: s.runsOk > 0 ? s.lastRunAt : null, operationalStatus: s.genuinelyConnected ? "CONNECTED_VERIFIED" : s.state, catalogueEvidence: s.evidence }));
}
