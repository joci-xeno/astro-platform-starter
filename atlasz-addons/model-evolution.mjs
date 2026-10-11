// Automatic model evolution (Global Business package §7.1-7.6; 23-point items 4/5/18) ON TOP OF model-registry.mjs. It never adds a second router or registry:
// models live in the registry; this module keeps the candidate lifecycle, test/benchmark evidence, deprecation records and the upgrade policy.
//
//   lifecycle   DISCOVERED -> BENCHMARKING -> RECOMMENDED -> APPROVED_FOR_ROLLOUT -> ROLLED_OUT -> ROLLED_BACK, and REJECTED from any pre-rollout state. Illegal moves are refused.
//   discovery   discoverFromCatalogue(text): an INJECTED catalogue (fixture JSON; no network) is validated with caps; new models are added to the registry DISABLED
//               (registry.addModel) and become DISCOVERED candidates. A higher version of an existing id is recorded as a VERSION_NOTICE (benchmark it by registering
//               it under its own id) - this module never upgrades a model in place.
//   compatibility  runCompatibility(): fixed prompts with deterministic checks (contains / regex / json keys / max chars) through INJECTED adapters only.
//   benchmark   A/B vs the approved baseline (an ENABLED registry model) on fixed prompts: latency (injected clock), cost (adapter-reported; unknown stays null and
//               blocks a recommendation for a non-free model), quality scored by an INDEPENDENT JUDGE whose family differs from both candidate and baseline.
//               The score formula and every component are returned (transparent scoring).
//   spend guard calling a cloud or non-free candidate costs money: benchmarking it needs a signed owner approval (MODEL_BENCHMARK, subject bench:<id>:<configHash>).
//   policy      {mode: MANUAL | RECOMMEND_ONLY | AUTO_FOR_FREE_LOCAL, maxErrorRate, minHealthSamples, qualityTolerance, maxCostIncrease, maxLatencyRatio}; changing it needs
//               a signed owner approval (MODEL_EVOLUTION_POLICY). Default MANUAL. Paid or cloud models ALWAYS need the owner's signed MODEL_ENABLE approval through
//               registry.enable() - no mode can skip it. AUTO_FOR_FREE_LOCAL may approve + roll out only LOCAL+FREE candidates.
//   rollout     sets the registry role default or the assignments of named permanent agents; the previous configuration and registry revision are recorded.
//   rollback    revert() (automatic, e.g. health threshold breached): disables the candidate and restores the recorded previous role default/assignments - both
//               risk-reducing registry operations; rollbackRegistry() restores a registry SNAPSHOT and needs the owner's MODEL_REGISTRY_ROLLBACK approval (registry rule).
//   deprecations  recordDeprecation() + deprecationReport(): models in use that retire soon -> FIND_REPLACEMENT proposals; retired-but-assigned -> alert.
//   records     every lifecycle step is appended to a hash-chained audit log (tamper-evident, not WORM).
//
// Status honesty: IMPLEMENTED + unit TESTED with fake adapters and fixed prompts. No real provider adapter exists, nothing is CONNECTED or LIVE. Benchmarks on a
// handful of fixed prompts are a smoke-level comparison, not a statistically valid evaluation; the judge is itself a model and can be wrong.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { parseVersion, compareVersions } from "./update-center.mjs";
import { needsApproval, modelConfigHash } from "./model-registry.mjs";

export const STATES = Object.freeze(["DISCOVERED", "BENCHMARKING", "RECOMMENDED", "APPROVED_FOR_ROLLOUT", "ROLLED_OUT", "REJECTED", "ROLLED_BACK"]);
const NEXT = Object.freeze({ DISCOVERED: ["BENCHMARKING", "REJECTED"], BENCHMARKING: ["BENCHMARKING", "RECOMMENDED", "REJECTED"], RECOMMENDED: ["APPROVED_FOR_ROLLOUT", "REJECTED"], APPROVED_FOR_ROLLOUT: ["ROLLED_OUT", "REJECTED"], ROLLED_OUT: ["ROLLED_BACK"], REJECTED: [], ROLLED_BACK: [] });
export const MODES = Object.freeze(["MANUAL", "RECOMMEND_ONLY", "AUTO_FOR_FREE_LOCAL"]);
export const DEFAULT_POLICY = Object.freeze({ mode: "MANUAL", maxErrorRate: 0.2, minHealthSamples: 20, qualityTolerance: 0.5, maxCostIncrease: 0.1, maxLatencyRatio: 1.5 });
export const LIMITS = Object.freeze({ maxCatalogueBytes: 256 * 1024, maxCatalogueEntries: 200, maxCandidates: 500, maxOutputChars: 20000, adapterTimeoutMs: 30000, maxPrompts: 50, maxDeprecations: 500 });
export const DEFAULT_COMPAT_SUITE = Object.freeze([
  { id: "echo", prompt: "Reply with exactly the word: READY", check: { type: "contains", value: "READY" } },
  { id: "json", prompt: "Return a JSON object with keys \"status\" and \"items\" (an array). No prose.", check: { type: "jsonKeys", value: ["status", "items"] } },
  { id: "arith", prompt: "What is 17 + 25? Answer with the number only.", check: { type: "regex", value: "^\\s*42\\s*$" } },
  { id: "brevity", prompt: "Summarise in one sentence: The meeting moved to Tuesday.", check: { type: "maxChars", value: 300 } }
]);
export const DEFAULT_BENCH_PROMPTS = Object.freeze([
  "Draft a two-sentence status update for a client whose website fix is delayed by one day.",
  "List three risks of accepting a fixed-price software contract without a written scope.",
  "Explain in plain language what an invoice is versus a payment receipt."
]);
const JUDGE_TEMPLATE = (task, answer) => `You are an impartial judge. Rate the ANSWER to the TASK for correctness, usefulness and clarity from 0 to 10.\nTASK:\n${task}\nANSWER:\n${answer}\nEnd with a final line exactly in the form SCORE: <0-10>`;
const sha = t => createHash("sha256").update(t).digest("hex");
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const sortedObj = o => Array.isArray(o) ? o.map(sortedObj) : o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort().map(k => [k, sortedObj(o[k])])) : o;

export function validatePolicy(raw) {
  if (!raw || typeof raw !== "object") return { error: "POLICY_OBJECT_REQUIRED" };
  const p = { ...DEFAULT_POLICY, ...raw };
  if (Object.keys(p).some(k => !(k in DEFAULT_POLICY))) return { error: "POLICY_FIELD_UNKNOWN" };
  if (!MODES.includes(p.mode)) return { error: "MODE_INVALID" };
  const between = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  if (!between(p.maxErrorRate, 0, 1) || !Number.isInteger(p.minHealthSamples) || !between(p.minHealthSamples, 1, 100000) || !between(p.qualityTolerance, 0, 10) || !between(p.maxCostIncrease, 0, 10) || !between(p.maxLatencyRatio, 1, 100)) return { error: "POLICY_VALUE_OUT_OF_BOUNDS" };
  return { policy: Object.freeze(p) };
}
export const policySubject = p => "model-evolution-policy:" + sha(JSON.stringify(sortedObj(p))).slice(0, 24);

function checkOutput(check, out) {
  switch (check?.type) {
    case "contains": return out.includes(String(check.value));
    case "regex": { try { return new RegExp(check.value).test(out); } catch { return false; } }
    case "maxChars": return out.length <= check.value;
    case "jsonKeys": { let j; const m = /\{[\s\S]*\}/.exec(out); try { j = JSON.parse(m ? m[0] : out); } catch { return false; } return j && typeof j === "object" && check.value.every(k => Object.hasOwn(j, k)); }
    default: return false;
  }
}
export function parseJudgeScore(text) {
  if (typeof text !== "string") return null;
  const lines = text.trim().split(/\r?\n/), last = lines.at(-1)?.trim() ?? "";
  const m = /^SCORE:\s*(10|[0-9])(?:\s*\/\s*10)?$/.exec(last);
  return m ? Number(m[1]) : null;
}

const BENCH_GRANT_RUNS = 3;
export function createModelEvolution({ dir, registry, ownerAuth = null, adapters = {}, clock = () => performance.now(), now = () => new Date().toISOString(), compatSuite = DEFAULT_COMPAT_SUITE, benchPrompts = DEFAULT_BENCH_PROMPTS, adapterTimeoutMs = LIMITS.adapterTimeoutMs } = {}) {
  if (!dir) throw new Error("DIR_REQUIRED");
  if (!registry || typeof registry.getModel !== "function" || typeof registry.enable !== "function") throw new Error("MODEL_REGISTRY_REQUIRED");
  if (!Array.isArray(compatSuite) || !compatSuite.length || compatSuite.length > LIMITS.maxPrompts || !Array.isArray(benchPrompts) || !benchPrompts.length || benchPrompts.length > LIMITS.maxPrompts) throw new Error("PROMPT_SET_INVALID");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const FILE = path.join(dir, "model-evolution.json"), audit = createAuditChain({ filePath: path.join(dir, "model-evolution-audit.jsonl"), now });
  let st = { policy: { ...DEFAULT_POLICY }, candidates: {}, deprecations: {}, notices: [] };
  if (fs.existsSync(FILE)) { try { st = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { throw new Error("MODEL_EVOLUTION_STORE_UNREADABLE"); } }
  // the persisted policy must be the one the audit chain recorded under an owner signature; otherwise fall back to MANUAL (fail closed)
  (() => { const sets = audit.entries().filter(e => e.event === "POLICY_SET"); const last = sets.at(-1);
    const ok = last && JSON.stringify(sortedObj(last.data.policy)) === JSON.stringify(sortedObj(st.policy)) && ownerAuth?.verifyRecorded?.(last.data.approval, { action: "MODEL_EVOLUTION_POLICY", subject: policySubject(last.data.policy) });
    if (!ok && JSON.stringify(sortedObj(st.policy)) !== JSON.stringify(sortedObj(DEFAULT_POLICY))) st.policy = { ...DEFAULT_POLICY }; })();
  const save = () => { const t = FILE + ".tmp"; fs.writeFileSync(t, JSON.stringify(st), { mode: 0o600 }); fs.renameSync(t, FILE); };
  const R = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  const cand = id => Object.hasOwn(st.candidates, id) ? st.candidates[id] : null;
  function move(c, to, detail = {}) {
    if (!NEXT[c.state].includes(to)) return R("ILLEGAL_TRANSITION:" + c.state + "->" + to);
    const from = c.state; c.state = to; c.history.push({ from, to, at: now(), ...detail }); if (c.history.length > 50) c.history.shift();
    save(); audit.append("CANDIDATE_" + to, { candidateId: c.candidateId, from, ...detail }); return { ok: true, state: to };
  }
  const verifyOwner = (approval, action, subject) => { if (!ownerAuth) return { ok: false, reason: "OWNER_AUTH_NOT_CONFIGURED" }; const r = ownerAuth.verifyApproval(approval, { action, subject }); return r?.allowed === true ? { ok: true } : { ok: false, reason: r?.reason ?? "OWNER_APPROVAL_INVALID" }; };

  async function call(modelId, prompt) {
    const fn = adapters[modelId];
    if (typeof fn !== "function") return { ok: false, error: "NO_ADAPTER" };
    const t0 = clock(); let timer;
    try {
      const r = await Promise.race([Promise.resolve().then(() => fn(prompt)), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("ADAPTER_TIMEOUT")), adapterTimeoutMs); })]);
      const latencyMs = clock() - t0;
      if (!r || typeof r.text !== "string") return { ok: false, error: "ADAPTER_BAD_RESPONSE", latencyMs };
      const cost = r.costUsd === undefined || r.costUsd === null ? null : Number.isFinite(r.costUsd) && r.costUsd >= 0 ? r.costUsd : NaN;
      if (Number.isNaN(cost)) return { ok: false, error: "ADAPTER_COST_INVALID", latencyMs };
      return { ok: true, text: r.text.slice(0, LIMITS.maxOutputChars), truncated: r.text.length > LIMITS.maxOutputChars, latencyMs, costUsd: cost };
    } catch (e) { return { ok: false, error: e?.message === "ADAPTER_TIMEOUT" ? "ADAPTER_TIMEOUT" : "ADAPTER_ERROR", latencyMs: clock() - t0 }; }
    finally { clearTimeout(timer); }
  }

  // ---------------------------------------------------------------- discovery
  function addCandidate(modelId, source) {
    const m = registry.getModel(modelId); if (!m) return R("UNKNOWN_MODEL_IN_REGISTRY");
    const candidateId = modelId + "@" + m.version; if (cand(candidateId)) return R("CANDIDATE_EXISTS");
    if (Object.keys(st.candidates).length >= LIMITS.maxCandidates) return R("CANDIDATE_LIMIT");
    st.candidates[candidateId] = { candidateId, modelId, version: m.version, family: m.family, kind: m.kind, costClass: m.costClass, configHash: modelConfigHash(m), source: String(source).slice(0, 60), state: "DISCOVERED", history: [{ to: "DISCOVERED", at: now() }], compat: null, benchmark: null, rollout: null };
    save(); audit.append("CANDIDATE_DISCOVERED", { candidateId, source: String(source).slice(0, 60) }); return { ok: true, candidateId };
  }
  /** Catalogue fixture: {"models":[{id, providerId, version, capabilities[], costClass, costPer1kTokensUsd?, contextLimit?, displayName?}]} */
  function discoverFromCatalogue(raw, { sourceId = "catalogue" } = {}) {
    if (typeof raw !== "string") return R("CATALOGUE_TEXT_REQUIRED");
    if (Buffer.byteLength(raw) > LIMITS.maxCatalogueBytes) return R("CATALOGUE_TOO_LARGE");
    let j; try { j = JSON.parse(raw); } catch { return R("CATALOGUE_NOT_JSON"); }
    if (!j || !Array.isArray(j.models)) return R("CATALOGUE_SCHEMA");
    if (j.models.length > LIMITS.maxCatalogueEntries) return R("CATALOGUE_TOO_MANY_ENTRIES");
    const added = [], notices = [], rejected = [];
    for (const [i, e] of j.models.entries()) {
      if (!e || typeof e !== "object" || !ID_RE.test(e.id ?? "") || !parseVersion(e.version ?? "")) { rejected.push({ index: i, reason: "ENTRY_INVALID" }); continue; }
      const existing = registry.getModel(e.id);
      if (existing) {
        if (compareVersions(e.version, existing.version) > 0) { const n = { modelId: e.id, currentVersion: existing.version, announcedVersion: e.version, sourceId, at: now(), note: "Register the new version under its own model id to benchmark it; this module never upgrades in place." }; notices.push(n); st.notices.push(n); while (st.notices.length > 200) st.notices.shift(); }
        continue;
      }
      const r = registry.addModel({ id: e.id, providerId: e.providerId, version: e.version, capabilities: e.capabilities, costClass: e.costClass, costPer1kTokensUsd: e.costPer1kTokensUsd, contextLimit: e.contextLimit, displayName: e.displayName });
      if (!r.ok) { rejected.push({ index: i, reason: r.reason }); continue; }
      const c = addCandidate(e.id, sourceId); if (c.ok) added.push(c.candidateId); else rejected.push({ index: i, reason: c.reason });
    }
    save(); audit.append("CATALOGUE_SCANNED", { sourceId, added: added.length, notices: notices.length, rejected: rejected.length });
    return { ok: true, added, versionNotices: notices, rejected, note: "Added models are DISABLED in the registry; nothing was enabled, downloaded or paid." };
  }

  // ---------------------------------------------------------------- spend guard for calling a candidate
  function callGuard(c, approval, autoOnly = false) {
    const m = registry.getModel(c.modelId); if (!m) return R("MODEL_REMOVED_FROM_REGISTRY");
    if (modelConfigHash(m) !== c.configHash) return R("MODEL_CONFIG_CHANGED_SINCE_DISCOVERY");
    if (!needsApproval(m) || m.enabled) return { ok: true };                                            // free local, or already owner-approved via MODEL_ENABLE
    if (m.costPer1kTokensUsd === null || m.costPer1kTokensUsd === undefined) return R("COST_UNKNOWN_BENCHMARK_REFUSED", { note: "a paid or cloud candidate with an unknown price is never benchmarked: set a costPer1kTokensUsd first" });
    // Spend grant: one signed MODEL_BENCHMARK approval is single-use (owner-auth consumes its nonce) and buys at most BENCH_GRANT_RUNS guarded runs for THIS config.
    // The remaining runs are COMPUTED from the hash-chained audit log (approvals granted minus runs taken), never read from the editable state file.
    if (autoOnly) return R("OWNER_APPROVAL_REQUIRED_PER_RUN", { note: "automatic cycles never spend: a paid or cloud candidate needs a fresh MODEL_BENCHMARK approval for each manual run" });
    const left = grantRunsLeft(c);
    if (left > 0) { audit.append("BENCHMARK_RUN_FROM_GRANT", { candidateId: c.candidateId, configHash: c.configHash, runsLeft: left - 1 }); return { ok: true }; }
    const subject = "bench:" + c.candidateId + ":" + c.configHash, v = verifyOwner(approval, "MODEL_BENCHMARK", subject);
    if (!v.ok) return R("OWNER_APPROVAL_REQUIRED_TO_CALL_PAID_OR_CLOUD_CANDIDATE", { detail: v.reason, action: "MODEL_BENCHMARK", subject });
    audit.append("BENCHMARK_SPEND_APPROVED", { candidateId: c.candidateId, configHash: c.configHash, runs: BENCH_GRANT_RUNS, nonce: v.nonce ?? null, approval }); audit.append("BENCHMARK_RUN_FROM_GRANT", { candidateId: c.candidateId, configHash: c.configHash, runsLeft: BENCH_GRANT_RUNS - 1 }); return { ok: true };
  }
  function grantRunsLeft(c) { let n = 0; const seenNonce = new Set(); for (const e of audit.entries()) { if (e.data?.candidateId !== c.candidateId || e.data?.configHash !== c.configHash) continue; if (e.event === "BENCHMARK_SPEND_APPROVED") { const ap = e.data.approval, nn = ap?.nonce; let ok = false; try { ok = typeof nn === "string" && !seenNonce.has(nn) && Boolean(ownerAuth?.verifyRecorded?.(ap, { action: "MODEL_BENCHMARK", subject: "bench:" + c.candidateId + ":" + c.configHash })); } catch { ok = false; } if (ok) { seenNonce.add(nn); n += Math.min(BENCH_GRANT_RUNS, Number(e.data.runs) || 0); } }      // only an owner-signed record buys runs; a forged log line has no signature
       else if (e.event === "BENCHMARK_RUN_FROM_GRANT") n -= 1; } return Math.max(0, n); }

  async function runCompatibility(candidateId, { approval = null, auto = false } = {}) {
    const c = cand(candidateId); if (!c) return R("UNKNOWN_CANDIDATE");
    if (!["DISCOVERED", "BENCHMARKING"].includes(c.state)) return R("WRONG_STATE:" + c.state);
    const g = callGuard(c, approval, auto); if (!g.ok) return g;
    if (c.state === "DISCOVERED") { const mv = move(c, "BENCHMARKING", { step: "COMPATIBILITY" }); if (!mv.ok) return mv; }
    const results = [];
    for (const t of compatSuite) { const r = await call(c.modelId, t.prompt); results.push({ id: t.id, pass: r.ok && !r.truncated && checkOutput(t.check, r.text), error: r.ok ? null : r.error, latencyMs: r.latencyMs ?? null }); }
    const passed = results.filter(r => r.pass).length;
    c.compat = { at: now(), passed, total: results.length, passRate: passed / results.length, results, suiteHash: sha(JSON.stringify(compatSuite)).slice(0, 16) };
    save(); audit.append("COMPATIBILITY_RUN", { candidateId, passed, total: results.length });
    if (passed !== results.length) { move(c, "REJECTED", { reason: "COMPATIBILITY_FAILED" }); return { ok: true, compatible: false, compat: c.compat }; }
    return { ok: true, compatible: true, compat: c.compat };
  }

  async function measure(modelId, judgeId) {
    const rows = [];
    for (const p of benchPrompts) {
      const r = await call(modelId, p);
      let score = null; if (r.ok) { const j = await call(judgeId, JUDGE_TEMPLATE(p, r.text)); score = j.ok ? parseJudgeScore(j.text) : null; }
      rows.push({ ok: r.ok, latencyMs: r.latencyMs ?? null, costUsd: r.ok ? r.costUsd : null, score, error: r.ok ? null : r.error });
    }
    const scored = rows.filter(r => r.score !== null), okRows = rows.filter(r => r.ok);
    const m = registry.getModel(modelId), freeLocal = m && !needsApproval(m);
    const costKnown = okRows.length > 0 && okRows.every(r => r.costUsd !== null || freeLocal);
    return { rows, errors: rows.length - okRows.length, scoredCount: scored.length,
      qualityMean: scored.length >= Math.ceil(rows.length / 2) ? scored.reduce((n, r) => n + r.score, 0) / scored.length : null,
      latencyMsMean: okRows.length ? okRows.reduce((n, r) => n + r.latencyMs, 0) / okRows.length : null,
      costUsdTotal: costKnown ? okRows.reduce((n, r) => n + (r.costUsd ?? 0), 0) : null };
  }
  /** A/B benchmark vs an ENABLED baseline, judged by a model of a third family. */
  async function benchmark(candidateId, { baselineId, judgeId, approval = null, auto = false } = {}) {
    const c = cand(candidateId); if (!c) return R("UNKNOWN_CANDIDATE");
    if (c.state !== "BENCHMARKING" || !c.compat || c.compat.passRate !== 1) return R("COMPATIBILITY_MUST_PASS_FIRST");
    const g = callGuard(c, approval, auto); if (!g.ok) return g;
    const base = registry.getModel(baselineId), judge = registry.getModel(judgeId), cm = registry.getModel(c.modelId);
    if (!base || !base.enabled) return R("BASELINE_MUST_BE_AN_ENABLED_APPROVED_MODEL");
    if (!judge || (!judge.enabled && needsApproval(judge))) return R("JUDGE_MUST_BE_ENABLED_OR_FREE_LOCAL");
    if (judgeId === c.modelId || judgeId === baselineId) return R("JUDGE_MUST_BE_INDEPENDENT");
    if (judge.family === cm.family || judge.family === base.family) return R("JUDGE_MUST_BE_FROM_A_DIFFERENT_FAMILY", { judgeFamily: judge.family, candidateFamily: cm.family, baselineFamily: base.family });
    const cRes = await measure(c.modelId, judgeId), bRes = await measure(baselineId, judgeId), P = st.policy, reasons = [];
    let verdict = "RECOMMEND";
    if (cRes.qualityMean === null || bRes.qualityMean === null) { verdict = "INCONCLUSIVE"; reasons.push("QUALITY_NOT_SCORED_JUDGE_OUTPUT_UNPARSEABLE_OR_ERRORS"); }
    if (cRes.errors > 0) { verdict = "REJECT"; reasons.push("CANDIDATE_ERRORS:" + cRes.errors); }
    if (cRes.costUsdTotal === null) { if (verdict === "RECOMMEND") verdict = "INCONCLUSIVE"; reasons.push("CANDIDATE_COST_UNKNOWN"); }
    const qualityDelta = cRes.qualityMean !== null && bRes.qualityMean !== null ? cRes.qualityMean - bRes.qualityMean : null;
    const costRatio = cRes.costUsdTotal !== null && bRes.costUsdTotal !== null ? (bRes.costUsdTotal === 0 ? (cRes.costUsdTotal === 0 ? 1 : Infinity) : cRes.costUsdTotal / bRes.costUsdTotal) : null;
    const latencyRatio = cRes.latencyMsMean !== null && bRes.latencyMsMean ? cRes.latencyMsMean / bRes.latencyMsMean : null;
    if (verdict === "RECOMMEND") {
      if (qualityDelta < -P.qualityTolerance) { verdict = "REJECT"; reasons.push("QUALITY_BELOW_BASELINE"); }
      if (costRatio !== null && costRatio > 1 + P.maxCostIncrease && !(qualityDelta >= 1)) { verdict = "REJECT"; reasons.push("COST_INCREASE_NOT_JUSTIFIED"); }
      if (latencyRatio !== null && latencyRatio > P.maxLatencyRatio) { verdict = "REJECT"; reasons.push("LATENCY_TOO_HIGH"); }
    }
    const qN = cRes.qualityMean === null ? null : cRes.qualityMean / 10, costS = costRatio === null ? null : Math.max(0, Math.min(1, 2 - costRatio) / 1), latS = latencyRatio === null ? null : Math.max(0, Math.min(1, 2 - latencyRatio));
    const composite = qN === null || costS === null || latS === null ? null : Math.round((0.6 * qN + 0.2 * Math.min(1, costS) + 0.2 * latS) * 1000) / 1000;
    c.benchmark = { at: now(), baselineId, judgeId, judgeFamily: judge.family, candidate: cRes, baseline: bRes, qualityDelta, costRatio, latencyRatio, composite,
      formula: "composite = 0.6*(quality/10) + 0.2*clamp(2-costRatio,0,1) + 0.2*clamp(2-latencyRatio,0,1); recommendation uses the rule thresholds in policy, not the composite alone",
      thresholds: { qualityTolerance: P.qualityTolerance, maxCostIncrease: P.maxCostIncrease, maxLatencyRatio: P.maxLatencyRatio }, verdict, reasons, promptsHash: sha(JSON.stringify(benchPrompts)).slice(0, 16) };
    save(); audit.append("BENCHMARK_RUN", { candidateId, baselineId, judgeId, verdict, qualityDelta, costRatio, latencyRatio });
    if (verdict === "RECOMMEND") move(c, "RECOMMENDED", { baselineId });
    else if (verdict === "REJECT") move(c, "REJECTED", { reason: reasons.join(",") });
    return { ok: true, verdict, benchmark: structuredClone(c.benchmark) };
  }

  // ---------------------------------------------------------------- approval, rollout, rollback
  /** Paid/cloud: the owner's MODEL_ENABLE approval goes straight to registry.enable (bound to the exact config). Free local: AUTO mode, or owner MODEL_EVOLUTION_APPROVE. */
  function approve(candidateId, { approval = null, auto = false } = {}) {
    const c = cand(candidateId); if (!c) return R("UNKNOWN_CANDIDATE"); if (c.state !== "RECOMMENDED") return R("WRONG_STATE:" + c.state);
    const m = registry.getModel(c.modelId); if (!m) return R("MODEL_REMOVED_FROM_REGISTRY"); if (modelConfigHash(m) !== c.configHash) return R("MODEL_CONFIG_CHANGED_SINCE_BENCHMARK");
    if (needsApproval(m)) {
      if (auto) return R("PAID_OR_CLOUD_NEVER_AUTO_APPROVED", { action: "MODEL_ENABLE", subject: registry.enableSubject(m) });
      const e = registry.enable(c.modelId, { approval }); if (!e.ok) return R("REGISTRY_ENABLE_REFUSED", { detail: e.detail ?? e.reason, subject: e.subject ?? registry.enableSubject(m) });
      return move(c, "APPROVED_FOR_ROLLOUT", { by: "OWNER_MODEL_ENABLE" });
    }
    if (auto) { if (st.policy.mode !== "AUTO_FOR_FREE_LOCAL") return R("AUTO_APPROVAL_NOT_ALLOWED_IN_MODE:" + st.policy.mode); }
    else { const v = verifyOwner(approval, "MODEL_EVOLUTION_APPROVE", "evo:" + candidateId + ":" + c.configHash); if (!v.ok) return R("OWNER_APPROVAL_REQUIRED", { detail: v.reason, action: "MODEL_EVOLUTION_APPROVE", subject: "evo:" + candidateId + ":" + c.configHash }); }
    const e = registry.enable(c.modelId); if (!e.ok) return R("REGISTRY_ENABLE_REFUSED", { detail: e.reason });
    return move(c, "APPROVED_FOR_ROLLOUT", { by: auto ? "POLICY_AUTO_FOR_FREE_LOCAL" : "OWNER" });
  }
  /** target: {role:'SEARCH'|'EXECUTION'} or {agentIds:[...], capability}. */
  function rollout(candidateId, { target } = {}) {
    const c = cand(candidateId); if (!c) return R("UNKNOWN_CANDIDATE"); if (c.state !== "APPROVED_FOR_ROLLOUT") return R("WRONG_STATE:" + c.state);
    const m = registry.getModel(c.modelId); if (!m?.enabled) return R("MODEL_NOT_ENABLED_IN_REGISTRY");
    if (!target || typeof target !== "object") return R("TARGET_REQUIRED");
    const preRevision = registry.status().revision, prevDefaults = registry.roleDefaults(), prevAssignments = registry.assignments();
    if (target.role) {
      if (!["SEARCH", "EXECUTION"].includes(target.role)) return R("ROLE_INVALID");
      const r = registry.setRoleDefault(target.role, [c.modelId, ...prevDefaults[target.role].filter(x => x !== c.modelId)].slice(0, 6)); if (!r.ok) return R("REGISTRY_REFUSED", { detail: r.reason });
    } else if (Array.isArray(target.agentIds) && target.agentIds.length && target.agentIds.length <= 30) {
      const roster = new Set(registry.agents()); if (!target.agentIds.every(a => roster.has(a))) return R("NOT_ONE_OF_THE_30_PERMANENT_AGENTS");
      const capability = target.capability ?? "text";
      for (const a of target.agentIds) {
        const prev = prevAssignments[a], fallbacks = prev ? [prev.primary, ...prev.fallbacks].filter(x => x !== c.modelId).slice(0, 5) : [];
        const r = registry.setAssignment(a, { primary: c.modelId, fallbacks, capability });
        if (!r.ok) { restore(prevDefaults, prevAssignments, target); return R("REGISTRY_REFUSED", { detail: r.reason, agentId: a }); }
      }
    } else return R("TARGET_INVALID");
    c.rollout = { at: now(), target: structuredClone(target), preRevision, prevDefaults, prevAssignments, health: { samples: 0, errors: 0 } };
    return move(c, "ROLLED_OUT", { preRevision });
  }
  function restore(prevDefaults, prevAssignments, target) {
    if (target.role) registry.setRoleDefault(target.role, prevDefaults[target.role]);
    for (const a of target.agentIds ?? []) { const p = prevAssignments[a]; if (p) registry.setAssignment(a, { primary: p.primary, fallbacks: p.fallbacks, capability: p.capability }); else registry.clearAssignment(a); }
  }
  /** Automatic (no approval needed: risk-reducing) rollback to the recorded previous assignment + disable the candidate. */
  function revert(candidateId, { reason = "MANUAL_REVERT" } = {}) {
    const c = cand(candidateId); if (!c) return R("UNKNOWN_CANDIDATE"); if (c.state !== "ROLLED_OUT") return R("WRONG_STATE:" + c.state);
    restore(c.rollout.prevDefaults, c.rollout.prevAssignments, c.rollout.target);
    const d = registry.disable(c.modelId);
    return { ...move(c, "ROLLED_BACK", { reason: String(reason).slice(0, 80), disabled: d.ok }), restored: true };
  }
  function reportHealth(candidateId, { samples, errors } = {}) {
    const c = cand(candidateId); if (!c) return R("UNKNOWN_CANDIDATE"); if (c.state !== "ROLLED_OUT") return R("WRONG_STATE:" + c.state);
    if (!Number.isInteger(samples) || !Number.isInteger(errors) || samples < 0 || errors < 0 || errors > samples || samples > 1e7) return R("HEALTH_INVALID");
    c.rollout.health.samples += samples; c.rollout.health.errors += errors; save();
    const h = c.rollout.health, rate = h.samples ? h.errors / h.samples : 0;
    if (h.samples >= st.policy.minHealthSamples && rate > st.policy.maxErrorRate) return { ok: true, autoReverted: true, errorRate: rate, revert: revert(candidateId, { reason: "ERROR_RATE_" + rate.toFixed(3) }) };
    return { ok: true, autoReverted: false, errorRate: rate };
  }
  /** Full registry snapshot restore: owner-approved through the registry (MODEL_REGISTRY_ROLLBACK). */
  function rollbackRegistry(candidateId, { approval = null } = {}) {
    const c = cand(candidateId); if (!c?.rollout) return R("NO_ROLLOUT_RECORDED");
    const rev = c.rollout.preRevision, subject = registry.rollbackSubject(rev); if (!subject) return R("SNAPSHOT_NOT_FOUND", { revision: rev });
    const r = registry.rollback(rev, { approval }); if (!r.ok) return R("REGISTRY_ROLLBACK_REFUSED", { detail: r.detail ?? r.reason, subject });
    audit.append("REGISTRY_SNAPSHOT_RESTORED", { candidateId, revision: rev });
    if (c.state === "ROLLED_OUT") move(c, "ROLLED_BACK", { reason: "REGISTRY_SNAPSHOT_RESTORED" });
    return { ok: true, restoredFrom: rev };
  }
  function reject(candidateId, { reason = "OWNER_REJECTED" } = {}) { const c = cand(candidateId); if (!c) return R("UNKNOWN_CANDIDATE"); return move(c, "REJECTED", { reason: String(reason).slice(0, 80) }); }

  // ---------------------------------------------------------------- policy + auto cycle
  function setPolicy(raw, { approval = null } = {}) {
    const v = validatePolicy(raw); if (v.error) return R(v.error);
    const subject = policySubject(v.policy), a = verifyOwner(approval, "MODEL_EVOLUTION_POLICY", subject);
    if (!a.ok) return R("OWNER_APPROVAL_REQUIRED", { detail: a.reason, subject });
    st.policy = { ...v.policy }; save(); audit.append("POLICY_SET", { policy: st.policy, approval }); return { ok: true, policy: { ...st.policy } };
  }
  /** One bounded cycle. MANUAL: does nothing. RECOMMEND_ONLY: compat + benchmark (free-local or already-approved candidates only). AUTO_FOR_FREE_LOCAL: also approve + roll out free local. */
  async function autoCycle({ baselineId, judgeId, target = null, max = 5 } = {}) {
    const mode = st.policy.mode, out = [];
    if (mode === "MANUAL") return { ok: true, mode, actions: [], note: "MANUAL mode: nothing runs automatically" };
    for (const c of Object.values(st.candidates).filter(x => ["DISCOVERED", "BENCHMARKING", "RECOMMENDED"].includes(x.state)).slice(0, Math.min(max, 20))) {
      const step = { candidateId: c.candidateId, steps: [] };
      if (c.state === "DISCOVERED" || (c.state === "BENCHMARKING" && !c.compat)) { const r = await runCompatibility(c.candidateId, { auto: true }); step.steps.push(["COMPATIBILITY", r.ok ? (r.compatible ? "PASS" : "FAIL") : r.reason]); if (!r.ok || !r.compatible) { out.push(step); continue; } }
      if (c.state === "BENCHMARKING") { const r = await benchmark(c.candidateId, { baselineId, judgeId, auto: true }); step.steps.push(["BENCHMARK", r.ok ? r.verdict : r.reason]); }
      if (c.state === "RECOMMENDED" && mode === "AUTO_FOR_FREE_LOCAL") {
        const r = approve(c.candidateId, { auto: true }); step.steps.push(["APPROVE", r.ok ? "AUTO_APPROVED_FREE_LOCAL" : r.reason]);
        if (r.ok && target) { const ro = rollout(c.candidateId, { target }); step.steps.push(["ROLLOUT", ro.ok ? "ROLLED_OUT" : ro.reason]); }
      }
      out.push(step);
    }
    return { ok: true, mode, actions: out };
  }

  // ---------------------------------------------------------------- deprecations
  function recordDeprecation({ modelId, retiresAt, announcedAt = null, evidenceUrl, sourceId } = {}) {
    if (!ID_RE.test(modelId ?? "")) return R("MODEL_ID_INVALID");
    if (typeof retiresAt !== "string" || !Number.isFinite(Date.parse(retiresAt))) return R("RETIRES_AT_INVALID");
    let u; try { u = new URL(evidenceUrl); } catch { return R("EVIDENCE_URL_REQUIRED"); } if (u.protocol !== "https:") return R("EVIDENCE_URL_REQUIRED");
    if (typeof sourceId !== "string" || !/^[a-z0-9][a-z0-9_.-]{1,47}$/.test(sourceId)) return R("SOURCE_ID_REQUIRED");
    if (!Object.hasOwn(st.deprecations, modelId) && Object.keys(st.deprecations).length >= LIMITS.maxDeprecations) return R("DEPRECATION_LIMIT");
    st.deprecations[modelId] = { modelId, retiresAt: new Date(Date.parse(retiresAt)).toISOString(), announcedAt, evidenceUrl: u.origin + u.pathname, sourceId, recordedAt: now() };
    save(); audit.append("DEPRECATION_RECORDED", { modelId, retiresAt }); return { ok: true };
  }
  function deprecationReport({ withinDays = 30 } = {}) {
    const t = Date.parse(now()), assigned = registry.assignments(), defaults = registry.roleDefaults(), out = [];
    for (const d of Object.values(st.deprecations)) {
      const users = Object.entries(assigned).filter(([, a]) => [a.primary, ...a.fallbacks].includes(d.modelId)).map(([k]) => k), roles = Object.entries(defaults).filter(([, l]) => l.includes(d.modelId)).map(([k]) => k);
      const m = registry.getModel(d.modelId), inUse = users.length > 0 || roles.length > 0 || Boolean(m?.enabled), days = (Date.parse(d.retiresAt) - t) / 86400000;
      if (!inUse) continue;
      if (days <= 0) out.push({ type: "RETIRED_STILL_IN_USE", modelId: d.modelId, agents: users, roles, retiresAt: d.retiresAt, evidenceUrl: d.evidenceUrl });
      else if (days <= withinDays) out.push({ type: "FIND_REPLACEMENT", modelId: d.modelId, agents: users, roles, daysLeft: Math.floor(days), retiresAt: d.retiresAt, evidenceUrl: d.evidenceUrl });
    }
    return { ok: true, items: out };
  }

  const get = id => { const c = cand(id); return c ? structuredClone(c) : null; };
  const summary = () => ({ state: "IMPLEMENTED_NOT_CONNECTED", mode: st.policy.mode, candidates: Object.values(st.candidates).reduce((m, c) => (m[c.state] = (m[c.state] ?? 0) + 1, m), {}), deprecations: Object.keys(st.deprecations).length, versionNotices: st.notices.length, auditHead: audit.head(), note: "No real provider adapter is connected; benchmarks use injected adapters only." });
  return { discoverFromCatalogue, addCandidate, runCompatibility, benchmark, approve, rollout, revert, reportHealth, rollbackRegistry, reject, setPolicy, policy: () => ({ ...st.policy }), autoCycle, recordDeprecation, deprecationReport, get, list: () => Object.values(st.candidates).map(c => structuredClone(c)), summary, audit: () => audit.entries(), auditVerify: () => audit.verifyFile() };
}
