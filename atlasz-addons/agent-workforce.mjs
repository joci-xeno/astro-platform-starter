// Phase 5: the working layer of the 30 permanent agents. It COMPOSES existing modules (it replaces none of them):
//   agent-registry (identities/profiles) · agent-coordination (Master Coordinator logic: tasks, delegation, loop limits, checkpoints, independent maker-checker) · handoff ledger (via the coordinator)
//   · model-routing-bridge (optional `models.complete`) · agent-memory (optional) · financial-ledger (costs and verified revenue) · revenue-persistence (opportunity pipeline) · approval-requests · opportunity-qualification-engine.
// Workflows (all run as an identity-bound agent handle; the coordinator, not the maker, picks the checker):
//   A discoverOpportunity   SEARCH agent records an opportunity from owner/doc-supplied source material with provenance; a DIFFERENT SEARCH agent re-derives and accepts or rejects it.
//   B planOpportunity       two different SEARCH agents research and evaluate it (checked), then a plan is made; every external/binding/spending step becomes an owner approval request, never an action.
//   C executeTask           an EXECUTION agent runs a real local executor (csv->json, extractive summary, sandboxed module+tests) and produces a hash-fixed artifact.
//   D checkTask             the assigned independent checker recomputes/re-runs and ACCEPTs or REJECTs; REJECT sends the task back to its owner (bounded).
//   E recordOutcome         costs need evidence; revenue goes through the financial ledger (PAID only with external evidence); SIMULATED results can never be recorded as revenue.
//   F retries/recovery      bounded attempts with backoff, identical-failure loop stop, checkpoint before every attempt, partial artifacts never kept, dead-letter + escalation, restart recovery.
// Honesty rules: provenance on every result (REAL_LOCAL_TOOL | MODEL:<id> | SIMULATED); nothing here sends anything outside, spends money, signs anything or contacts a customer;
// opportunity values are ESTIMATES (never revenue); an agent is "working" only while a task of its own is RUNNING in this store.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";
import { createCoordinator } from "./agent-coordination.mjs";
import { createFinancialLedger } from "./financial-ledger.mjs";
import { qualifyOpportunity } from "./opportunity-qualification-engine.mjs";
import { createMasterPlan } from "./master-planner-orchestrator.mjs";
import { containsSecret, scrub } from "./secret-patterns.mjs";
import { BUILTIN_EXECUTORS, executorSkill } from "./agent-executors.mjs";
import { ROSTER } from "./agent-registry.mjs";
import { roleOf } from "./agent-tool-policy.mjs";
import { SOURCE_CATALOGUE, assessListing, convertAmount, hostOf, canonicalUrl } from "./global-discovery.mjs";

export const WF_LIMITS = Object.freeze({ maxTasks: 3000, maxOpportunities: 1000, maxPlans: 500, maxEvents: 200, maxText: 2000, maxTitle: 200, artifactBytes: 2 * 1024 * 1024, maxReworks: 2, escalations: 200 });
const sha = t => crypto.createHash("sha256").update(t).digest("hex");
const canon = v => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x));
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, " ").trim().slice(0, n);
const R = (reason, extra = {}) => ({ ok: false, reason, ...extra });
const NUM_RE = /^\s*-?\d{1,15}(\.\d{1,10})?\s*$/;
const isBlank = v => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const numValid = v => isBlank(v) || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && NUM_RE.test(v));
const numOrNull = v => (isBlank(v) ? null : Number(v));
const NUM_CAP = { estimatedValueUsd: 1e12, winProbability: 1, estimatedHours: 1e5, estimatedCostsUsd: 1e12, daysToCash: 3650 };
const idPart = t => sha(t).slice(0, 10);
const SOURCE_TYPES = ["OWNER_PROVIDED", "DOCUMENT_CENTER", "MANUAL_ENTRY", "PUBLIC_SOURCE"];
const RETRIEVALS = ["CONNECTOR", "OPERATOR_TOOL", "FIXTURE"], STAGES_AFTER_PLAN = ["PROPOSED", "CONTRACTED", "IN_PROGRESS", "QUALITY_CHECKED", "DELIVERED", "PAYMENT_PENDING", "PAID"];
const sourceById = id => SOURCE_CATALOGUE.find(x => x.id === id) ?? null;

export function createWorkforce({ dir, registry, ledger = null, revenue = null, memory = null, models = null, approvals = null, tools = null, executors = BUILTIN_EXECUTORS, simulatedModelIds = [], isStopped = () => false, evidenceKnown = null, now = () => new Date().toISOString(), sleep = ms => new Promise(r => setTimeout(r, ms)), clock = () => Date.now() } = {}) {
  if (!dir) throw new Error("DIR_REQUIRED"); if (!registry || typeof registry.list !== "function") throw new Error("REGISTRY_REQUIRED");
  fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true, mode: 0o700 });
  // The Master Coordinator facade is the only holder of this one-shot capability: it may dispatch PLAN_STEP work (never OWNER_DIRECTED) and suspend/reassign tasks. API callers cannot claim it.
  const MASTER_TOKEN = crypto.randomBytes(16).toString("hex"); let masterBound = false;
  const bindMaster = () => { if (masterBound) return null; masterBound = true; return MASTER_TOKEN; };
  const isMaster = tok => masterBound && typeof tok === "string" && tok.length === MASTER_TOKEN.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(MASTER_TOKEN));
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };
  const coordinator = createCoordinator({ dir: path.join(dir, "coordination"), isStopped: stopped, nowFn: clock, toolsOf: () => [], ledgerLimits: { maxTasks: 1000 } });
  const money = ledger ?? createFinancialLedger({ dir: path.join(dir, "ledger") });
  const events = createAuditChain({ filePath: path.join(dir, "events.jsonl"), headPinFile: path.join(dir, "events.headpin.json"), now });
  const FILE = path.join(dir, "workforce.json");
  let S = { v: 1, tasks: {}, opps: {}, plans: {}, escalations: [], daySpend: {} }, loadNote = null;
  if (fs.existsSync(FILE)) {
    try { const w = JSON.parse(fs.readFileSync(FILE, "utf8")); if (w.sha !== sha(w.body)) throw new Error("sha"); const b = JSON.parse(w.body); if (b.v !== 1 || typeof b.tasks !== "object" || typeof b.opps !== "object" || typeof b.plans !== "object") throw new Error("shape"); S = { ...S, ...b }; }
    catch { throw new Error("WORKFORCE_STORE_UNREADABLE"); }      // never silently start empty over damaged state
  }
  const save = () => { const body = JSON.stringify(S), t = FILE + "." + crypto.randomBytes(4).toString("hex") + ".tmp"; fs.writeFileSync(t, JSON.stringify({ sha: sha(body), body }), { mode: 0o600 }); fs.renameSync(t, FILE); };
  const ev = (type, data = {}) => { try { events.append(type, data); } catch { /* an unwritable event log is reported by verify(); work stops via gate() */ } };
  const eventsOk = () => { try { events.reload(); return events.verify().ok; } catch { return false; } };

  // ---- recovery on open: tasks that were RUNNING when the process died are INTERRUPTED (resumable), never silently "done" ----
  let recovery = { coordinator: null, interrupted: 0 };
  try { recovery.coordinator = coordinator.recover(); } catch (e) { recovery.coordinator = { ok: false, error: String(e?.message ?? e).slice(0, 80) }; }
  for (const t of Object.values(S.tasks)) if (t.status === "RUNNING") { t.status = "INTERRUPTED"; t.updatedAt = now(); recovery.interrupted++; ev("TASK_INTERRUPTED_BY_RESTART", { taskId: t.taskId, agentId: t.agentId }); }
  for (const t of Object.values(S.tasks)) if (t.status === "REASSIGNING") { compensateReassign(t, "RESTART_DURING_REASSIGNMENT"); recovery.interrupted++; }
  if (recovery.interrupted) save();

  // ---- gates ----
  function gate(agentId, team) {
    if (stopped()) return R("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    if (!ROSTER.includes(agentId)) return R("NOT_ONE_OF_THE_30_PERMANENT_AGENTS");
    if (roleOf(agentId) !== team) return R("AGENT_TEAM_MISMATCH");
    if (!registry.isUsable(agentId)) return R("AGENT_NOT_USABLE", { status: registry.get(agentId)?.status ?? "UNKNOWN" });
    if (!eventsOk()) return R("EVENT_LOG_UNVERIFIABLE");
    return null;
  }
  const capacity = id => { const open = Object.values(S.tasks).filter(t => t.agentId === id && ["RUNNING", "SUBMITTED", "INTERRUPTED"].includes(t.status)).length; return (registry.get(id)?.limits.maxOpenTasks ?? 1) - open; };
  /** Coordinator choice of a worker: usable, in the team, not excluded, with capacity; least loaded first (ties by id). */
  function pickAgent(team, exclude = []) {
    const load = id => Object.values(S.tasks).filter(t => t.agentId === id && ["RUNNING", "SUBMITTED", "INTERRUPTED"].includes(t.status)).length;
    return ROSTER.filter(id => roleOf(id) === team && !exclude.includes(id) && registry.isUsable(id) && capacity(id) > 0).sort((a, b) => load(a) - load(b) || (a < b ? -1 : 1))[0] ?? null;
  }
  const rememberTask = t => { if (Object.keys(S.tasks).length >= WF_LIMITS.maxTasks) { const old = Object.values(S.tasks).filter(x => ["VERIFIED", "DEAD_LETTER", "REJECTED_FINAL"].includes(x.status)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).slice(0, 100); for (const o of old) delete S.tasks[o.taskId]; } S.tasks[t.taskId] = t; };
  const touch = (t, patch = {}) => { Object.assign(t, patch, { updatedAt: now() }); save(); };

  // ---- artifacts: written to a temp dir, hashed, then renamed; a failed attempt leaves nothing behind ----
  const artDir = taskId => path.join(dir, "artifacts", taskId);
  function writeArtifact(taskId, files, extra = {}) {
    const final = artDir(taskId), tmp = final + ".tmp-" + crypto.randomBytes(4).toString("hex"); fs.mkdirSync(tmp, { recursive: true, mode: 0o700 });
    try {
      let total = 0; const list = [];
      for (const [name, content] of Object.entries(files)) {
        if (!/^[A-Za-z0-9._-]{1,60}$/.test(name) || name === "manifest.json") throw Object.assign(new Error("ARTIFACT_NAME_INVALID"), { code: "ARTIFACT_NAME_INVALID" });
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8"); total += buf.length; if (total > WF_LIMITS.artifactBytes) throw Object.assign(new Error("ARTIFACT_TOO_LARGE"), { code: "ARTIFACT_TOO_LARGE" });
        fs.writeFileSync(path.join(tmp, name), buf, { mode: 0o600 }); list.push({ name, sha256: sha(buf), size: buf.length });
      }
      list.sort((a, b) => (a.name < b.name ? -1 : 1));
      const manifest = { taskId, files: list, ...extra }; fs.writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify(manifest, null, 1), { mode: 0o600 });
      fs.rmSync(final, { recursive: true, force: true }); fs.renameSync(tmp, final);
      return { manifest, resultSha256: sha(canon(manifest)) };
    } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e; }
  }
  function readArtifact(taskId) {
    const d = artDir(taskId); let manifest; try { manifest = JSON.parse(fs.readFileSync(path.join(d, "manifest.json"), "utf8")); } catch { return { ok: false, reason: "MANIFEST_MISSING_OR_UNREADABLE" }; }
    let present; try { present = fs.readdirSync(d); } catch { return { ok: false, reason: "ARTIFACT_DIR_UNREADABLE" }; }
    const listed = new Set([...(manifest.files ?? []).map(f => f.name), "manifest.json"]); const extra = present.find(n => !listed.has(n)); if (extra) return { ok: false, reason: "ARTIFACT_UNLISTED_FILE:" + extra.slice(0, 40) };
    const files = {}; for (const f of manifest.files ?? []) { let buf; try { buf = fs.readFileSync(path.join(d, f.name)); } catch { return { ok: false, reason: "ARTIFACT_FILE_MISSING:" + f.name }; } if (sha(buf) !== f.sha256 || buf.length !== f.size) return { ok: false, reason: "ARTIFACT_FILE_ALTERED:" + f.name }; files[f.name] = buf; }
    return { ok: true, manifest, files, resultSha256: sha(canon(manifest)) };
  }

  // ====================================================================== Workflow A
  function validateOpportunityInput(inp) {
    if (!inp || typeof inp !== "object") return "INPUT_REQUIRED";
    const title = clean(inp.title, WF_LIMITS.maxTitle); if (!title) return "TITLE_REQUIRED";
    if (!SOURCE_TYPES.includes(inp.sourceType)) return "SOURCE_TYPE_INVALID"; if (!clean(inp.sourceRef, 300)) return "SOURCE_REF_REQUIRED";
    const ex = clean(inp.sourceExcerpt, WF_LIMITS.maxText); if (ex.length < 10) return "SOURCE_EXCERPT_REQUIRED"; if (containsSecret(ex) || scrub(ex) !== ex) return "SECRET_IN_SOURCE";
    if (inp.sourceType === "PUBLIC_SOURCE") {
      const d = inp.discovery; if (!d || typeof d !== "object") return "DISCOVERY_META_REQUIRED"; const src = sourceById(d.sourceId); if (!src) return "SOURCE_UNKNOWN"; if (!RETRIEVALS.includes(d.retrieval)) return "RETRIEVAL_LABEL_REQUIRED";
      const h = hostOf(inp.sourceRef); if (!h || !src.hosts.map(x => x.replace(/^www\./, "")).includes(h.replace(/^www\./, ""))) return "SOURCE_URL_NOT_ON_SOURCE_HOST"; if (!/^https:\/\//.test(String(inp.sourceRef)) || !canonicalUrl(inp.sourceRef)) return "SOURCE_URL_MUST_BE_HTTPS";
      if (typeof d.originalText === "string" && (containsSecret(d.originalText) || scrub(d.originalText) !== d.originalText)) return "SECRET_IN_SOURCE";
    } else if (inp.discovery !== undefined && inp.discovery !== null) return "DISCOVERY_META_ONLY_FOR_PUBLIC_SOURCE";
    for (const k of Object.keys(NUM_CAP)) { if (!numValid(inp[k])) return "NUMBER_INVALID:" + k; const v = numOrNull(inp[k]); if (v !== null && (v < 0 || v > NUM_CAP[k])) return "NUMBER_INVALID:" + k; }
    for (const k of ["title", "sourceRef"]) { const t = clean(inp[k], 300); if (containsSecret(t) || scrub(t) !== t) return "SECRET_IN_" + k.toUpperCase(); }
    
    if (inp.requiredSkills !== undefined && (!Array.isArray(inp.requiredSkills) || inp.requiredSkills.length > 10 || !inp.requiredSkills.every(s => typeof s === "string" && /^[a-z][a-z0-9._-]{1,48}$/.test(s)))) return "REQUIRED_SKILLS_INVALID";
    return null;
  }
  const normaliseOpp = inp => ({
    title: clean(inp.title, WF_LIMITS.maxTitle), sourceType: inp.sourceType, sourceRef: clean(inp.sourceRef, 300), sourceExcerpt: clean(inp.sourceExcerpt, WF_LIMITS.maxText),
    estimatedValueUsd: numOrNull(inp.estimatedValueUsd), winProbability: numOrNull(inp.winProbability), estimatedHours: numOrNull(inp.estimatedHours), estimatedCostsUsd: numOrNull(inp.estimatedCostsUsd), daysToCash: numOrNull(inp.daysToCash),
    remoteDeliverable: inp.remoteDeliverable !== false, upfrontSpendRequired: inp.upfrontSpendRequired === true, requiresUnheldLicense: inp.requiresUnheldLicense === true, illegalOrDeceptive: inp.illegalOrDeceptive === true, requiresPhysicalPresence: inp.requiresPhysicalPresence === true,
    requiredSkills: [...new Set(inp.requiredSkills ?? [])], recurring: inp.recurring === true,
    discovery: inp.sourceType === "PUBLIC_SOURCE" ? { sourceId: inp.discovery.sourceId, retrieval: inp.discovery.retrieval, runId: clean(inp.discovery.runId, 40) || null, evidenceSha256: /^[0-9a-f]{64}$/.test(inp.discovery.evidenceSha256 ?? "") ? inp.discovery.evidenceSha256 : null, jurisdiction: clean(inp.discovery.jurisdiction, 12) || null, currency: /^[A-Z]{3}$/.test(inp.discovery.currency ?? "") ? inp.discovery.currency : null,
      valueAmount: Number.isFinite(inp.discovery.valueAmount) ? inp.discovery.valueAmount : null, valueKind: clean(inp.discovery.valueKind, 40) || null, language: clean(inp.discovery.language, 12) || null, publishedAt: Number.isFinite(Date.parse(inp.discovery.publishedAt)) ? new Date(inp.discovery.publishedAt).toISOString() : null,
      deadline: Number.isFinite(Date.parse(inp.discovery.deadline)) ? new Date(inp.discovery.deadline).toISOString() : null, buyer: clean(inp.discovery.buyer, 200) || null, kindHint: clean(inp.discovery.kindHint, 30) || null, geoOpen: inp.discovery.geoOpen === true ? true : null, tags: (inp.discovery.tags ?? []).slice(0, 20).map(t => clean(t, 40)),
      originalText: clean(inp.discovery.originalText, 4000), translatedSummary: null, translationNote: "No translation was performed: the original text is kept as published.", assessedAt: now() } : null
  });
  /** Pure derivation used by BOTH the maker and the checker (the checker recomputes it from the stored raw input, not from the maker's result). */
  function deriveOpportunity(raw) {
    const dsc = raw.discovery ? assessListing({ title: raw.title, description: raw.discovery.originalText || raw.sourceExcerpt, tags: raw.discovery.tags, deadline: raw.discovery.deadline, kindHint: raw.discovery.kindHint, geoOpen: raw.discovery.geoOpen }, raw.discovery.assessedAt) : null;
    const q = qualifyOpportunity({ ...raw, sourceEvidence: raw.sourceExcerpt, sourceUrl: raw.sourceType === "DOCUMENT_CENTER" ? null : raw.sourceRef,
      estimatedValueUsd: raw.estimatedValueUsd ?? 0, winProbability: raw.winProbability ?? 0, estimatedHours: raw.estimatedHours ?? 24, estimatedCostsUsd: raw.estimatedCostsUsd ?? 0 }).qualification;
    const known = raw.estimatedValueUsd !== null && raw.winProbability !== null, blockers = [...q.blockers, ...(dsc?.hardBlockers ?? [])];
    const sv = raw.discovery && raw.discovery.valueAmount !== null ? { amount: raw.discovery.valueAmount, currency: raw.discovery.currency, kind: raw.discovery.valueKind, usd: null, note: "Source-published figure in the source currency; not ATLASZ income. No exchange rate was supplied, so no USD figure exists." } : null;
    return { eligible: blockers.length === 0, blockers, economics: known ? "KNOWN_OWNER_ESTIMATE" : "UNKNOWN", expectedNetUsd: known ? q.expectedNetUsd : null, expectedNetPerHour: known ? q.expectedNetPerHour : null,
      unknownFields: ["estimatedValueUsd", "winProbability", "estimatedHours", "daysToCash"].filter(k => raw[k] === null), kind: "ESTIMATE_NOT_REVENUE", sourceValue: sv,
      discovery: dsc ? { listingKind: dsc.listingKind, fraud: dsc.fraud, deadlineState: dsc.deadlineState, geoRestrictions: dsc.geoRestrictions, internationalEligibility: dsc.internationalEligibility, requirements: dsc.requirements, jurisdiction: raw.discovery.jurisdiction, currency: raw.discovery.currency, language: raw.discovery.language, publishedAt: raw.discovery.publishedAt, deadline: raw.discovery.deadline, retrieval: raw.discovery.retrieval, sourceId: raw.discovery.sourceId } : null };
  }
  function discoverOpportunity(agentId, input) {
    const g = gate(agentId, "SEARCH"); if (g) return g; const bad = validateOpportunityInput(input); if (bad) return R(bad);
    const raw = normaliseOpp(input), fp = sha(raw.title.toLowerCase() + "\0" + raw.sourceRef.toLowerCase());
    const dup = Object.values(S.opps).find(o => o.fingerprint === fp); if (dup) return R("DUPLICATE_OPPORTUNITY", { existing: dup.id, status: dup.status });
    if (Object.keys(S.opps).length >= WF_LIMITS.maxOpportunities) return R("OPPORTUNITY_LIMIT");
    if (capacity(agentId) <= 0) return R("AGENT_AT_CONCURRENCY_LIMIT");
    const oppId = "opp-" + fp.slice(0, 12), taskId = "disc-" + fp.slice(0, 12), h = coordinator.connect(agentId);
    const reg = h.register({ id: taskId, kind: "search.discover", payload: { fp } }); if (!reg.ok) return R("COORDINATOR_REFUSED:" + reg.reason);
    const st = h.start(taskId); if (!st.ok) return R("COORDINATOR_REFUSED:" + st.reason);
    const task = { taskId, workflow: "A", kind: "search.discover", agentId, status: "RUNNING", attempts: [], provenance: raw.discovery?.retrieval === "FIXTURE" ? "SIMULATED" : "REAL_LOCAL_TOOL", opportunityId: oppId, input: raw, createdAt: now(), updatedAt: now() }; rememberTask(task); save();
    ev("TASK_STARTED", { taskId, agentId, kind: task.kind, workflow: "A" });
    const derived = deriveOpportunity(raw), record = { id: oppId, fingerprint: fp, raw, derived, discoveredBy: agentId, valueIsRevenue: false, sourceEvidence: { type: raw.sourceType, ref: raw.sourceRef, excerptSha256: sha(raw.sourceExcerpt) } };
    let art; try { art = writeArtifact(taskId, { "opportunity.json": JSON.stringify(record, null, 1) }, { executor: "opportunity.record", agentId, provenance: "REAL_LOCAL_TOOL" }); } catch (e) { return failTask(task, h, e); }
    S.opps[oppId] = { id: oppId, fingerprint: fp, title: raw.title, retrieval: raw.discovery?.retrieval ?? "OWNER_OR_MANUAL", stages: [], status: "AWAITING_CHECK", discoveredBy: agentId, taskId, derived, createdAt: now(), updatedAt: now() };
    h.checkpoint(taskId, { phase: "RECORDED", resultSha256: art.resultSha256 });
    const c = h.complete(taskId, art.resultSha256); if (!c.ok) return failTask(task, h, Object.assign(new Error(c.reason), { code: c.reason }));
    touch(task, { status: "SUBMITTED", resultSha256: art.resultSha256, checker: coordinator.verifierOf(taskId) });
    ev("OPPORTUNITY_RECORDED", { opportunityId: oppId, taskId, agentId, eligible: derived.eligible }); ev("TASK_SUBMITTED", { taskId, agentId, checker: task.checker });
    return { ok: true, taskId, opportunityId: oppId, status: "SUBMITTED_AWAITING_INDEPENDENT_CHECK", checker: task.checker, eligibleByQualification: derived.eligible, blockers: derived.blockers };
  }

  /** Gated steps the given step depends on (transitively) whose owner approval request is not APPROVED. Without a way to read decisions, every gate counts as open. */
  function unmetGates(plan, step) {
    const seen = new Set(), open = [], stack = [...step.dependsOn];
    while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); const dep = plan.steps.find(x => x.id === id); if (!dep) continue; stack.push(...dep.dependsOn);
      if (dep.requiresOwnerApproval) { const ap = plan.requiredApprovals.find(a => a.stepId === id); let ok = false; try { ok = Boolean(ap?.requestId && approvals?.outcome?.(ap.requestId)?.decision === "APPROVED"); } catch { ok = false; } if (!ok) open.push(id); } }
    return open;
  }

  // ====================================================================== Workflow C (+F)
  const OPP_EXECUTORS = new Set(["implementation_plan", "proposal_draft"]);
  /** The recorded opportunity, as the data an opportunity deliverable is allowed to see (no secrets, only stored fields). */
  function oppSnapshot(oppId) {
    const o = Object.hasOwn(S.opps, oppId) ? S.opps[oppId] : null, t = o ? S.tasks[o.taskId] : null; if (!t) return null; const r = t.input, d = r.discovery;
    return { opportunity: { title: r.title, sourceRef: r.sourceRef, description: d?.originalText || r.sourceExcerpt, jurisdiction: d?.jurisdiction ?? undefined, currency: d?.currency ?? undefined, valueAmount: d?.valueAmount ?? undefined, valueKind: d?.valueKind ?? undefined, deadline: d?.deadline ?? undefined, publishedAt: d?.publishedAt ?? undefined, buyer: d?.buyer ?? undefined, language: d?.language ?? undefined, kindHint: d?.kindHint ?? undefined, tags: d?.tags, assessedAt: d?.assessedAt ?? t.createdAt, retrieval: d?.retrieval, sourceId: d?.sourceId } };
  }
  function executorFor(name) { return Object.hasOwn(executors, name) ? executors[name] : null; }
  async function executeTask(agentId, { executor, input, authorization = null, opportunityId = null, via = "API", masterToken = null } = {}) {
    const asMaster = isMaster(masterToken);
    const g = gate(agentId, "EXECUTION"); if (g) return g; const ex = executorFor(executor); if (!ex) return R("UNKNOWN_EXECUTOR");
    // "authorized digital task": an owner-directed request from the Control Center, or a step of an accepted plan that needs no owner approval.
    if (!authorization || typeof authorization !== "object") return R("AUTHORIZATION_REQUIRED");
    let authRef;
    if (authorization.type === "OWNER_DIRECTED") { if (via !== "OWNER_PANEL") return R("OWNER_DIRECTED_ONLY_FROM_OWNER_PANEL"); authRef = "owner-directed"; }
    else if (authorization.type === "PLAN_STEP") {
      if (via !== "OWNER_PANEL" && !asMaster) return R("PLAN_STEP_ONLY_FROM_OWNER_PANEL");
      const plan = Object.hasOwn(S.plans, authorization.planId) ? S.plans[authorization.planId] : null, step = plan?.steps.find(s => s.id === authorization.stepId);
      if (!plan || !step) return R("PLAN_STEP_NOT_FOUND"); if (step.requiresOwnerApproval) return R("STEP_REQUIRES_OWNER_APPROVAL_NOT_AN_EXECUTION_STEP"); if (step.executor !== executor) return R("STEP_EXECUTOR_MISMATCH");
      const open = unmetGates(plan, step); if (open.length) return R("PLAN_STEP_WAITING_FOR_OWNER_APPROVAL", { waitingFor: open });
      authRef = "plan:" + plan.planId + ":" + step.id; opportunityId = plan.opportunityId;
    } else return R("AUTHORIZATION_TYPE_INVALID");
    if (!registry.get(agentId).capabilityProfile.skills.includes(executorSkill(executor) ?? executor)) return R("AGENT_LACKS_SKILL");
    if (OPP_EXECUTORS.has(executor) && (input === undefined || input === null) && opportunityId) { const snap = oppSnapshot(opportunityId); if (!snap) return R("UNKNOWN_OPPORTUNITY"); input = snap; }
    if (OPP_EXECUTORS.has(executor) && opportunityId && input && typeof input === "object" && input.priorWork === undefined) {
      // Reuse approved memory of THIS opportunity's project only (coordinator-level grant; participation checked). Retrieved text is data and is stored in the task input so the checker recomputes identically.
      try { const proj = String(opportunityId).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 23), tid = "pre-" + opportunityId.replace(/[^A-Za-z0-9]/g, "").slice(0, 20); const m = memory?.contextForProject ? await memory.contextForProject(agentId, { taskId: tid, query: (S.opps[opportunityId]?.title ?? "") + " " + executor, project: proj, maxChars: 1500 }) : null; if (m?.ok && m.ids.length) input = { ...input, priorWork: { ids: m.ids.slice(0, 10), text: m.text.slice(0, 3900) } }; } catch { /* memory is a second line of support */ }
    }
    const bad = ex.validate?.(input); if (bad) return R(bad);
    if (opportunityId && !Object.hasOwn(S.opps, opportunityId)) return R("UNKNOWN_OPPORTUNITY");
    if (capacity(agentId) <= 0) return R("AGENT_AT_CONCURRENCY_LIMIT");
    const inputSha = sha(canon(input)), taskId = "exec-" + idPart(agentId + executor + inputSha + authRef + clock()), h = coordinator.connect(agentId);
    const reg = h.register({ id: taskId, kind: "execute." + executor, payload: { inputSha, authRef } }); if (!reg.ok) return R("COORDINATOR_REFUSED:" + reg.reason);
    const st = h.start(taskId); if (!st.ok) return R("COORDINATOR_REFUSED:" + st.reason);
    const task = { taskId, workflow: "C", kind: "execute." + executor, executor, agentId, status: "RUNNING", attempts: [], provenance: "REAL_LOCAL_TOOL", opportunityId, authorization: authRef, authz: authorization.type === "PLAN_STEP" ? { type: "PLAN_STEP", planId: authorization.planId, stepId: authorization.stepId } : { type: "OWNER_DIRECTED" }, dispatchedBy: asMaster ? "MASTER" : "OWNER_PANEL", inputSha, input, createdAt: now(), updatedAt: now(), costUsd: 0 };
    rememberTask(task); save(); ev("TASK_STARTED", { taskId, agentId, kind: task.kind, workflow: "C", authorization: authRef });
    return runWithRetries(task, h, ex);
  }
  /** Bounded attempts. Before each attempt a checkpoint (attempt number + input hash) is stored; a retry first validates it. Same failure code twice = stop (loop guard). Exhaustion = dead letter + escalation. */
  async function runWithRetries(task, h, ex) {
    const prof = registry.get(task.agentId), max = prof.limits.maxRetries + 1, backoff = prof.retry.backoffMs, codes = [];
    for (let n = 1; n <= max; n++) {
      if (stopped()) { touch(task, { status: "INTERRUPTED" }); ev("TASK_PAUSED_BY_OWNER_STOP", { taskId: task.taskId }); return R("OWNER_STOP_OR_SAFE_MODE_ACTIVE", { taskId: task.taskId, status: "INTERRUPTED" }); }
      if (task.suspendRequested) { task.suspendRequested = false; touch(task, { status: "SUSPENDED", suspendedFrom: "INTERRUPTED", suspendReason: task.suspendReason ?? "MASTER" }); ev("TASK_SUSPENDED", { taskId: task.taskId, agentId: task.agentId, reason: task.suspendReason ?? null }); return R("TASK_SUSPENDED", { taskId: task.taskId, status: "SUSPENDED" }); }
      const cp = h.checkpoint(task.taskId, { attempt: n, inputSha: task.inputSha, phase: "BEFORE_ATTEMPT" }); if (!cp.ok) return failTask(task, h, Object.assign(new Error(cp.reason), { code: "CHECKPOINT_REFUSED" }));
      if (n > 1) { const back = h.resume(task.taskId); if (!back.ok || back.state?.inputSha !== task.inputSha) return failTask(task, h, Object.assign(new Error("CHECKPOINT_RESTORE_MISMATCH"), { code: "CHECKPOINT_RESTORE_MISMATCH" })); }
      const t0 = clock();
      try {
        const out = await withTimeout(Promise.resolve().then(() => ex.run(task.input, ctxFor(task))), prof.limits.taskTimeoutMs);
        const art = writeArtifact(task.taskId, out.files, { executor: task.executor, agentId: task.agentId, provenance: out.provenance ?? "REAL_LOCAL_TOOL", inputSha256: task.inputSha, meta: out.meta ?? null });
        task.attempts.push({ n, at: now(), ok: true, ms: clock() - t0 }); touch(task, { provenance: out.provenance ?? "REAL_LOCAL_TOOL", resultSha256: art.resultSha256 });
        ev("ARTIFACT_WRITTEN", { taskId: task.taskId, agentId: task.agentId, files: art.manifest.files.length, resultSha256: art.resultSha256 });
        const c = h.complete(task.taskId, art.resultSha256); if (!c.ok) return failTask(task, h, Object.assign(new Error(c.reason), { code: c.reason }));
        task.suspendRequested = false; touch(task, { status: "SUBMITTED", checker: coordinator.verifierOf(task.taskId) }); ev("TASK_SUBMITTED", { taskId: task.taskId, agentId: task.agentId, checker: task.checker });
        return { ok: true, taskId: task.taskId, status: "SUBMITTED_AWAITING_INDEPENDENT_CHECK", checker: task.checker, provenance: task.provenance, attempts: task.attempts.length };
      } catch (e) {
        const code = String(e?.code ?? "EXECUTOR_ERROR").slice(0, 40); task.attempts.push({ n, at: now(), ok: false, code, detail: scrub(String(e?.detail ?? e?.message ?? "")).slice(0, 120) }); touch(task, {});
        ev("ATTEMPT_FAILED", { taskId: task.taskId, agentId: task.agentId, attempt: n, code });
        const retryable = prof.retry.retryableCodes.includes(code);
        if (code === "SANDBOX_UNAVAILABLE" || code === "NO_SOURCE_AND_NO_MODEL") return blockTask(task, h, code);
        if (!retryable || n >= max) return failTask(task, h, e, { exhausted: n >= max });
        if (prof.retry.stopOnRepeatedCode && codes.includes(code)) return failTask(task, h, e, { loopGuard: true });
        codes.push(code); ev("RETRY_SCHEDULED", { taskId: task.taskId, attempt: n + 1, afterMs: backoff[Math.min(n - 1, backoff.length - 1)] ?? 0 });
        const wait = backoff[Math.min(n - 1, backoff.length - 1)] ?? 0; if (wait) await sleep(wait);
      }
    }
    return failTask(task, h, new Error("EXHAUSTED"), { exhausted: true });
  }
  function withTimeout(p, ms) { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error("TIMEOUT"), { code: "TIMEOUT" })), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); }
  function blockTask(task, h, code) { coordinator.abandon(task.taskId, code); touch(task, { status: "BLOCKED", blocker: code }); ev("TASK_BLOCKED", { taskId: task.taskId, agentId: task.agentId, code }); return R(code, { taskId: task.taskId, status: "BLOCKED" }); }
  function failTask(task, h, e, flags = {}) {
    const code = String(e?.code ?? e?.message ?? "FAILED").slice(0, 60); try { coordinator.abandon(task.taskId, code); } catch { /* the ledger may already have closed it */ }
    fs.rmSync(artDir(task.taskId), { recursive: true, force: true });          // a failed task keeps no partial artifact
    touch(task, { status: "DEAD_LETTER", failure: { code, ...flags } });
    S.escalations.push({ at: now(), taskId: task.taskId, agentId: task.agentId, code, reason: flags.loopGuard ? "REPEATED_FAILURE_LOOP_STOPPED" : flags.exhausted ? "RETRIES_EXHAUSTED" : "NOT_RETRYABLE", note: "Needs owner attention; nothing was retried beyond the agent's limits." });
    if (S.escalations.length > WF_LIMITS.escalations) S.escalations.shift(); save();
    ev("TASK_DEAD_LETTERED", { taskId: task.taskId, agentId: task.agentId, code, ...flags });
    return R("TASK_FAILED:" + code, { taskId: task.taskId, status: "DEAD_LETTER", ...flags });
  }
  /** Context for an executor: bounded model access (cost-limited, ledgered) and agent memory context. Neither is required. */
  function ctxFor(task) {
    return {
      taskId: task.taskId, agentId: task.agentId,
      async model(prompt, { capability = "code" } = {}) {
        if (!models) throw Object.assign(new Error("NO_SOURCE_AND_NO_MODEL"), { code: "NO_SOURCE_AND_NO_MODEL" });
        const lim = registry.get(task.agentId).limits, dayKey = task.agentId + ":" + now().slice(0, 10), spentToday = S.daySpend[dayKey] ?? 0;
        const budget = Math.max(0, Math.min(lim.maxCostUsdPerTask - (task.costUsd ?? 0), lim.maxCostUsdPerDay - spentToday));
        const r = await models.complete({ agentId: task.agentId, prompt, capability, maxCostUsd: budget, requestKey: "wf:" + task.taskId + ":" + task.attempts.length + ":" + (task.modelCalls = (task.modelCalls ?? 0) + 1) });
        if (!r.ok || r.output == null) throw Object.assign(new Error(r.reason ?? "MODEL_UNAVAILABLE"), { code: r.reason === "NO_ELIGIBLE_MODEL" ? "NO_SOURCE_AND_NO_MODEL" : "TRANSIENT" });
        const cost = Number.isFinite(r.costUsd) && r.costUsd > 0 ? r.costUsd : 0;
        // Account for the spend FIRST (so nothing that can throw later hides it), then enforce the budget on what was actually reported.
        if (cost > 0) { S.daySpend[dayKey] = spentToday + cost; task.costUsd = (task.costUsd ?? 0) + cost; save(); }
        if (cost > 0) { try { money.recordCost({ entity: "ATLASZ_EXTERNAL", jobId: task.taskId, provider: r.providerId ?? "UNKNOWN", category: "MODEL", amountUsd: cost, evidence: { source: "provider-usage", reference: r.requestKey ?? task.taskId, verifiedAt: now() }, note: "agent " + task.agentId }); } catch (e) { ev("COST_LEDGER_WRITE_FAILED", { taskId: task.taskId, agentId: task.agentId, reason: String(e?.message ?? e).slice(0, 60) }); } }
        if (cost > budget + 1e-9) throw Object.assign(new Error("MODEL_COST_ABOVE_BUDGET"), { code: "MODEL_COST_ABOVE_BUDGET" });
        if (r.costKnown === false && budget === 0 && r.providerId && r.providerId !== "local") throw Object.assign(new Error("MODEL_COST_UNKNOWN_UNDER_ZERO_BUDGET"), { code: "MODEL_COST_ABOVE_BUDGET" });
        task.modelId = r.modelId; ev("MODEL_CALL", { taskId: task.taskId, agentId: task.agentId, modelId: r.modelId, costKnown: r.costKnown, simulated: simulatedModelIds.includes(r.modelId) });
        return { text: String(r.output), modelId: r.modelId, simulated: simulatedModelIds.includes(r.modelId) };
      },
      async memoryContext(query) { try { const h = memory?.forAgent(task.agentId); return h ? await h.contextFor({ taskId: task.taskId, query }) : { ok: false, reason: "MEMORY_NOT_CONNECTED" }; } catch { return { ok: false, reason: "MEMORY_ERROR" }; } }
    };
  }

  // ====================================================================== Workflow D (independent check)
  /** The checker named by the coordinator re-derives the result from the stored INPUT and the artifact on disk. Never trusts the maker's own report. */
  async function checkTask(taskId) {
    const t = Object.hasOwn(S.tasks, taskId) ? S.tasks[taskId] : null; if (!t) return R("UNKNOWN_TASK"); if (t.status !== "SUBMITTED") return R("TASK_NOT_AWAITING_CHECK", { status: t.status });
    if (stopped()) return R("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    const verifier = coordinator.verifierOf(taskId); if (!verifier) return R("NO_CHECKER_ASSIGNED"); if (verifier === t.agentId) return R("CHECKER_NOT_INDEPENDENT");
    if (!registry.isUsable(verifier)) { const e = coordinator.assignVerifier(taskId); if (!e || !registry.isUsable(e)) return R("CHECKER_NOT_AVAILABLE", { verifier }); }
    const checkerId = coordinator.verifierOf(taskId), vh = coordinator.connect(checkerId);
    const art = readArtifact(taskId); const reasons = [], evidence = { checker: checkerId };
    if (!art.ok) reasons.push(art.reason); else if (art.resultSha256 !== t.resultSha256) reasons.push("RESULT_HASH_DIFFERS_FROM_SUBMISSION");
    if (!reasons.length) {
      if (t.workflow === "A") reasons.push(...checkOpportunity(t, art));
      else if (t.workflow === "R" || t.workflow === "E") reasons.push(...checkAnalysis(t, art));
      else { const ex = executorFor(t.executor); if (!ex) reasons.push("EXECUTOR_UNKNOWN_TO_CHECKER"); else reasons.push(...await checkExecution(t, art, ex, evidence)); }
    }
    const decision = reasons.length ? "REJECT" : "ACCEPT", r = vh.verify(taskId, { decision, resultSha256: t.resultSha256 });
    if (!r.ok) return R("COORDINATOR_REFUSED:" + r.reason);
    const rec = { checker: checkerId, decision, at: now(), reasons: reasons.slice(0, 8), evidence }; t.checks = [...(t.checks ?? []), rec];
    if (decision === "ACCEPT") { touch(t, { status: "VERIFIED", verifiedBy: checkerId }); onVerified(t); ev("CHECK_ACCEPTED", { taskId, checker: checkerId, owner: t.agentId }); }
    else {
      t.rejections = (t.rejections ?? 0) + 1;
      if (t.rejections > WF_LIMITS.maxReworks) { coordinator.abandon(taskId, "TOO_MANY_REJECTIONS"); touch(t, { status: "REJECTED_FINAL" }); S.escalations.push({ at: now(), taskId, agentId: t.agentId, code: "REJECTED_TOO_OFTEN", reason: "CHECK_REJECTED_REPEATEDLY", note: "Needs owner attention." }); save(); }
      else touch(t, { status: "REJECTED_REWORK_ALLOWED" });
      ev("CHECK_REJECTED", { taskId, checker: checkerId, owner: t.agentId, reasons: reasons.slice(0, 4) });
    }
    return { ok: true, taskId, decision, checker: checkerId, maker: t.agentId, reasons, status: t.status };
  }
  function checkOpportunity(t, art) {
    const out = []; let rec; try { rec = JSON.parse(art.files["opportunity.json"].toString("utf8")); } catch { return ["OPPORTUNITY_JSON_UNREADABLE"]; }
    if (canon(rec.raw) !== canon(t.input)) out.push("RAW_INPUT_DIFFERS_FROM_STORED_INPUT");
    if (rec.sourceEvidence?.excerptSha256 !== sha(t.input.sourceExcerpt)) out.push("SOURCE_EVIDENCE_HASH_MISMATCH");
    if (canon(rec.derived) !== canon(deriveOpportunity(t.input))) out.push("QUALIFICATION_NOT_REPRODUCIBLE");
    if (rec.valueIsRevenue !== false) out.push("VALUE_MARKED_AS_REVENUE");
    if (rec.discoveredBy !== t.agentId) out.push("MAKER_IDENTITY_MISMATCH");
    const dsc = t.input.discovery; if (dsc) { const src = sourceById(dsc.sourceId), h = hostOf(t.input.sourceRef); if (!src || !h || !src.hosts.map(x => x.replace(/^www\./, "")).includes(h.replace(/^www\./, ""))) out.push("SOURCE_HOST_MISMATCH"); if (dsc.retrieval === "CONNECTOR" && !dsc.evidenceSha256) out.push("CONNECTOR_RETRIEVAL_WITHOUT_EVIDENCE_HASH"); if ((dsc.retrieval === "CONNECTOR" || dsc.retrieval === "OPERATOR_TOOL") && !(typeof evidenceKnown === "function" && (() => { try { return evidenceKnown(dsc.evidenceSha256, dsc.retrieval) === true; } catch { return false; } })())) out.push("RETRIEVAL_LABEL_NOT_BACKED_BY_DISCOVERY_LOG"); if (!dsc.originalText) out.push("ORIGINAL_TEXT_MISSING"); }
    return out;
  }
  async function checkExecution(t, art, ex, evidence) {
    const out = []; if (art.manifest.inputSha256 !== t.inputSha) out.push("INPUT_HASH_MISMATCH"); if (art.manifest.agentId !== t.agentId) out.push("MAKER_IDENTITY_MISMATCH");
    if (typeof ex.verifyFiles === "function") { const v = await ex.verifyFiles(Object.fromEntries(Object.entries(art.files))); evidence.rerun = v.evidence; if (v.blocked) out.push("CHECKER_SANDBOX_UNAVAILABLE"); else if (!v.ok) out.push("INDEPENDENT_RERUN_FAILED"); }
    else {
      let again; try { again = await ex.run(t.input, ctxFor(t)); } catch (e) { return [...out, "INDEPENDENT_RECOMPUTE_FAILED:" + String(e.code ?? e.message).slice(0, 30)]; }
      for (const [name, content] of Object.entries(again.files)) { const mine = art.files[name]; if (!mine || sha(mine) !== sha(Buffer.isBuffer(content) ? content : Buffer.from(String(content)))) out.push("OUTPUT_DIFFERS_ON_RECOMPUTE:" + name); }
      for (const name of Object.keys(art.files)) if (!(name in again.files)) out.push("UNEXPECTED_FILE:" + name);
    }
    return out;
  }
  function onVerified(t) {
    if (t.workflow === "A") {
      const o = S.opps[t.opportunityId]; if (!o) return; const d = o.derived;
      o.status = d.eligible ? "VERIFIED_QUALIFIED" : "VERIFIED_NOT_ELIGIBLE"; o.verifiedBy = t.verifiedBy; o.updatedAt = now(); save();
      if (d.eligible && revenue && o.retrieval !== "FIXTURE") {
        const searchAgent = t.agentId, r = revenue.track({ id: o.id, searchAgent, status: "OPEN_QUALIFIED", eligibility: "ELIGIBLE", expectedNetUsd: d.expectedNetUsd, paymentProbability: S.tasks[t.taskId].input.winProbability, feasibility: null, daysToRevenue: S.tasks[t.taskId].input.daysToCash });
        if (!r.ok) ev("PIPELINE_TRACK_REFUSED", { opportunityId: o.id, reason: r.reason });
      }
      ev("OPPORTUNITY_VERIFIED", { opportunityId: o.id, status: o.status });
    }
    // memory of VERIFIED work is written by the coordinator hook when a memory gateway is connected (see setOnVerified below)
  }
  coordinator.setOnVerified(({ id, verifier }) => {
    try { const t = S.tasks[id]; if (!t || !memory) return; const summary = "Task " + id + " (" + t.kind + (t.executor ? ", " + t.executor : "") + ")" + (t.opportunityId && S.opps[t.opportunityId] && t.provenance !== "SIMULATED" ? " for the opportunity titled: " + String(S.opps[t.opportunityId].title).slice(0, 120).replace(/[^\p{L}\p{N} .,_-]/gu, " ") : "") + " by " + t.agentId + " was accepted by independent checker " + verifier + "; provenance " + t.provenance + ". Result hash " + String(t.resultSha256).slice(0, 16) + "."; const project = t.opportunityId && t.provenance !== "SIMULATED" ? String(t.opportunityId).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 23) : null; memory.recordVerifiedWork({ taskId: id, owner: t.agentId, verifier, summary, project: project && /^[a-z0-9][a-z0-9_.]{0,22}$/.test(project) ? project : null }); } catch { /* memory is a second line of support */ }
  });
  /** After a REJECT the owner reworks (bounded): the same task, a fresh attempt series. */
  async function reworkTask(taskId) {
    const t = Object.hasOwn(S.tasks, taskId) ? S.tasks[taskId] : null; if (!t || t.status !== "REJECTED_REWORK_ALLOWED") return R("TASK_NOT_REWORKABLE", { status: t?.status });
    if (t.workflow === "A") return R("REWORK_OF_OPPORTUNITY_RECORDS_NOT_SUPPORTED_RECORD_A_NEW_ONE");
    const g = gate(t.agentId, "EXECUTION"); if (g) return g; const ex = executorFor(t.executor); if (!ex) return R("UNKNOWN_EXECUTOR");
    touch(t, { status: "RUNNING" }); ev("TASK_REWORK_STARTED", { taskId, agentId: t.agentId }); return runWithRetries(t, coordinator.connect(t.agentId), ex);
  }
  // ---- Master controls: suspend / resume / reassign (all need the Master capability; the owner panel reaches them through the Master) ----
  const SUSPENDABLE = ["SUBMITTED", "INTERRUPTED", "REJECTED_REWORK_ALLOWED", "BLOCKED"];
  function suspendTask(taskId, { reason = "MASTER", masterToken = null } = {}) {
    if (!isMaster(masterToken)) return R("MASTER_CAPABILITY_REQUIRED"); const t = Object.hasOwn(S.tasks, taskId) ? S.tasks[taskId] : null; if (!t) return R("UNKNOWN_TASK");
    if (t.status === "RUNNING") { t.suspendRequested = true; t.suspendReason = clean(reason, 80); touch(t, {}); ev("TASK_SUSPEND_REQUESTED", { taskId, agentId: t.agentId }); return { ok: true, taskId, status: "RUNNING", suspendRequested: true, note: "The attempt in flight finishes; no further attempt starts." }; }
    if (!SUSPENDABLE.includes(t.status)) return R("TASK_NOT_SUSPENDABLE", { status: t.status });
    touch(t, { status: "SUSPENDED", suspendedFrom: t.status, suspendReason: clean(reason, 80) }); ev("TASK_SUSPENDED", { taskId, agentId: t.agentId, reason: t.suspendReason }); return { ok: true, taskId, status: "SUSPENDED", suspendedFrom: t.suspendedFrom };
  }
  function unsuspendTask(taskId, { masterToken = null } = {}) {
    if (!isMaster(masterToken)) return R("MASTER_CAPABILITY_REQUIRED"); if (stopped()) return R("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const t = Object.hasOwn(S.tasks, taskId) ? S.tasks[taskId] : null; if (!t || t.status !== "SUSPENDED") return R("TASK_NOT_SUSPENDED", { status: t?.status });
    const back = SUSPENDABLE.includes(t.suspendedFrom) ? t.suspendedFrom : "INTERRUPTED"; touch(t, { status: back, suspendedFrom: undefined, suspendReason: undefined }); ev("TASK_UNSUSPENDED", { taskId, agentId: t.agentId, status: back }); return { ok: true, taskId, status: back };
  }
  /** A stuck execution task is handed to another agent of the team (never the previous owner, never its checker). Owner-directed tasks are reassigned only by the owner.
   *  COMPENSATING TRANSACTION (DEF-001): 1 PREPARE (validate everything the replacement needs; old task keeps its status, only an intent is recorded) -> 2 HOLD (old task REASSIGNING, ledger entry released so the same work can be registered)
   *  -> 3 RUN the replacement -> 4a COMMIT (old task REASSIGNED) or 4b COMPENSATE (old task restored to its previous status with the failure recorded). A crash between 2 and 4 is compensated at the next open. */
  async function reassignTask(taskId, toAgent, { masterToken = null, ownerPanel = false } = {}) {
    if (!isMaster(masterToken)) return R("MASTER_CAPABILITY_REQUIRED"); const t = Object.hasOwn(S.tasks, taskId) ? S.tasks[taskId] : null; if (!t) return R("UNKNOWN_TASK");
    if (t.workflow !== "C") return R("ONLY_EXECUTION_TASKS_ARE_REASSIGNABLE"); if (!["SUSPENDED", "INTERRUPTED", "BLOCKED"].includes(t.status)) return R("TASK_NOT_REASSIGNABLE", { status: t.status });
    if (t.authz?.type !== "PLAN_STEP" && ownerPanel !== true) return R("OWNER_DIRECTED_TASK_NEEDS_THE_OWNER"); if (toAgent === t.agentId || toAgent === t.checker) return R("REASSIGN_TARGET_NOT_INDEPENDENT");
    // 1 PREPARE: everything that can be checked without side effects is checked while the old task is untouched
    const g = gate(toAgent, "EXECUTION"); if (g) return { ...g, reassignAborted: "BEFORE_ANY_CHANGE" };
    if (!executorFor(t.executor)) return R("UNKNOWN_EXECUTOR", { reassignAborted: "BEFORE_ANY_CHANGE" });
    if (!registry.get(toAgent).capabilityProfile.skills.includes(executorSkill(t.executor) ?? t.executor)) return R("AGENT_LACKS_SKILL", { reassignAborted: "BEFORE_ANY_CHANGE" });
    if (capacity(toAgent) <= 0) return R("AGENT_AT_CONCURRENCY_LIMIT", { reassignAborted: "BEFORE_ANY_CHANGE" });
    const from = t.agentId, prev = t.status, prevMeta = { suspendedFrom: t.suspendedFrom, suspendReason: t.suspendReason, blocker: t.blocker };
    // 2 HOLD
    t.reassignIntent = { to: toAgent, from, prevStatus: prev, prevMeta, at: now() }; touch(t, { status: "REASSIGNING" }); ev("REASSIGN_PREPARED", { taskId, from, to: toAgent, prevStatus: prev });
    try { coordinator.abandon(taskId, "REASSIGNING_TO_" + toAgent); } catch { /* the ledger may have closed it already */ }
    // 3 RUN
    let r; try { r = await executeTask(toAgent, { executor: t.executor, input: t.input, authorization: t.authz, opportunityId: t.opportunityId, via: ownerPanel ? "OWNER_PANEL" : "MASTER", masterToken }); } catch (e) { r = R("REASSIGN_EXECUTION_THREW", { detail: scrub(String(e?.message ?? e)).slice(0, 80) }); }
    if (r.ok && r.taskId && S.tasks[r.taskId]) {
      // 4a COMMIT
      S.tasks[r.taskId].reassignedFrom = taskId; delete t.reassignIntent; touch(t, { status: "REASSIGNED", reassignedTo: toAgent }); ev("TASK_REASSIGNED", { taskId, from, to: toAgent, newTaskId: r.taskId });
      return { ...r, reassignedFrom: taskId, from, to: toAgent };
    }
    // 4b COMPENSATE: the old task is NOT lost: it returns to the status it had and the failure is recorded
    compensateReassign(t, r.reason ?? "REASSIGN_FAILED"); save(); return { ...r, ok: false, reassignedFrom: taskId, rolledBack: true, restoredStatus: t.status, note: "The replacement did not start; the original task was restored (" + t.status + "). The owner can retry." };
  }
  function compensateReassign(t, reason) {
    const it = t.reassignIntent ?? {}; const back = ["SUSPENDED", "INTERRUPTED", "BLOCKED"].includes(it.prevStatus) ? it.prevStatus : "INTERRUPTED";
    delete t.reassignIntent; Object.assign(t, { status: back, ...(it.prevMeta ?? {}), reassignFailure: { at: now(), reason: scrub(String(reason)).slice(0, 80), attemptedTo: it.to ?? null }, ledgerReleased: true, updatedAt: now() });   // no touch(): also runs during open, before touch exists; callers save()
    ev("REASSIGN_ROLLED_BACK", { taskId: t.taskId, restored: back, reason: scrub(String(reason)).slice(0, 80) });
  }

  /** Restart recovery for tasks that were interrupted (process death or owner stop): continue within limits from the last checkpoint. */
  async function resumeTask(taskId) {
    const t = Object.hasOwn(S.tasks, taskId) ? S.tasks[taskId] : null; if (!t || t.status !== "INTERRUPTED") return R("TASK_NOT_INTERRUPTED", { status: t?.status });
    if (t.workflow !== "C") return R("ONLY_EXECUTION_TASKS_ARE_RESUMABLE"); const g = gate(t.agentId, "EXECUTION"); if (g) return g; const ex = executorFor(t.executor); if (!ex) return R("UNKNOWN_EXECUTOR");
    const h = coordinator.connect(t.agentId); const cp = h.resume(t.taskId); if (!cp.ok) return R("CHECKPOINT_UNAVAILABLE:" + cp.reason);
    touch(t, { status: "RUNNING" }); ev("TASK_RESUMED", { taskId, agentId: t.agentId }); return runWithRetries(t, h, ex);
  }

  // ====================================================================== Workflow B (research, evaluation, plan, approvals)
  const SKILL_OF_EXECUTOR = Object.fromEntries(Object.keys(executors).map(k => [executorSkill(k) ?? k, k]));
  function analysisTask(kind, workflow, agentId, oppId, build) {
    const g = gate(agentId, "SEARCH"); if (g) return g; if (capacity(agentId) <= 0) return R("AGENT_AT_CONCURRENCY_LIMIT");
    const taskId = (kind === "search.research" ? "res-" : "eva-") + idPart(oppId + agentId + clock()), h = coordinator.connect(agentId);
    const reg = h.register({ id: taskId, kind, payload: { oppId, n: clock() } }); if (!reg.ok) return R("COORDINATOR_REFUSED:" + reg.reason); const st = h.start(taskId); if (!st.ok) return R("COORDINATOR_REFUSED:" + st.reason);
    const task = { taskId, workflow, kind, agentId, status: "RUNNING", attempts: [], provenance: "REAL_LOCAL_TOOL", opportunityId: oppId, createdAt: now(), updatedAt: now() }; rememberTask(task); save(); ev("TASK_STARTED", { taskId, agentId, kind, workflow });
    let doc, art; try { doc = build(); art = writeArtifact(taskId, { "analysis.json": JSON.stringify(doc, null, 1) }, { executor: kind, agentId, provenance: "REAL_LOCAL_TOOL" }); } catch (e) { return failTask(task, h, e); }
    task.analysis = doc; const c = h.complete(taskId, art.resultSha256); if (!c.ok) return failTask(task, h, Object.assign(new Error(c.reason), { code: c.reason }));
    touch(task, { status: "SUBMITTED", resultSha256: art.resultSha256, checker: coordinator.verifierOf(taskId) }); ev("TASK_SUBMITTED", { taskId, agentId, checker: task.checker });
    return { ok: true, taskId, checker: task.checker };
  }
  const researchDoc = opp => {
    const raw = S.tasks[opp.taskId].input, have = new Set(registry.list().flatMap(a => a.team === "EXECUTION" && a.status === "REGISTERED_READY" ? a.capabilityProfile.skills : []));
    const reqSkills = opp.ownerInput?.requiredSkills ?? raw.requiredSkills, matched = reqSkills.filter(s => have.has(s)), unmatched = reqSkills.filter(s => !have.has(s)), dd = opp.derived.discovery, unsupported = opp.ownerInput ? [] : (dd?.requirements.unsupported ?? []);
    return { opportunityId: opp.id, requiredSkills: reqSkills, matchedSkills: matched, unmatchedSkills: unmatched, unsupported, dataGaps: opp.derived.unknownFields,
      risks: [...(raw.upfrontSpendRequired ? ["UPFRONT_SPEND_REQUIRED"] : []), ...(unmatched.length ? ["SKILLS_NOT_AVAILABLE:" + unmatched.join(",")] : []), ...unsupported.map(u => "OUTSIDE_CAPABILITY:" + u), ...(raw.sourceType === "MANUAL_ENTRY" ? ["SOURCE_IS_MANUAL_ENTRY_UNVERIFIED_BY_DOCUMENT"] : []),
        ...(dd ? ["GEOGRAPHIC_ELIGIBILITY_" + dd.internationalEligibility, "CAPABILITY_COVERAGE_IS_KEYWORD_BASED_AND_UNASSESSED_BEYOND_THE_MATCHED_SKILLS", ...(dd.fraud.level !== "NONE" ? ["SCAM_INDICATORS_" + dd.fraud.level] : [])] : [])],
      basis: "Derived only from the recorded opportunity and the current agent skills. No external research was performed." };
  };
  const evaluationDoc = (opp, res) => {
    const n = res.requiredSkills.length || 1, coverage = res.matchedSkills.length / n, penalty = res.risks.length * 0.1, feasibility = Math.max(0, Math.min(1, +(coverage - penalty).toFixed(3)));
    return { opportunityId: opp.id, skillCoverage: +coverage.toFixed(3), feasibility, recommendation: !opp.derived.eligible ? "DECLINE" : res.requiredSkills.length === 0 || res.unsupported.length ? "NEEDS_OWNER_INPUT" : feasibility >= 0.5 ? "PROCEED_TO_PLAN" : "NEEDS_OWNER_INPUT", reasons: res.risks.slice(), unknowns: opp.derived.unknownFields };
  };
  function checkAnalysis(t, art) {
    const out = []; let doc; try { doc = JSON.parse(art.files["analysis.json"].toString("utf8")); } catch { return ["ANALYSIS_UNREADABLE"]; }
    const opp = S.opps[t.opportunityId]; if (!opp) return ["OPPORTUNITY_UNKNOWN"];
    const res = researchDoc(opp);
    if (t.kind === "search.research" && canon(doc) !== canon(res)) out.push("RESEARCH_NOT_REPRODUCIBLE");
    if (t.kind === "search.evaluate") { const resTask = S.tasks[t.basisTaskId]; if (!resTask || resTask.status !== "VERIFIED") out.push("RESEARCH_BASIS_NOT_VERIFIED"); else if (canon(doc) !== canon(evaluationDoc(opp, resTask.analysis))) out.push("EVALUATION_NOT_REPRODUCIBLE"); }
    return out;
  }
  async function planOpportunity(opportunityId) {
    const opp = Object.hasOwn(S.opps, opportunityId) ? S.opps[opportunityId] : null; if (!opp) return R("UNKNOWN_OPPORTUNITY"); if (opp.status !== "VERIFIED_QUALIFIED") return R("OPPORTUNITY_NOT_VERIFIED_QUALIFIED", { status: opp.status });
    if (Object.values(S.plans).some(p => p.opportunityId === opportunityId)) return R("PLAN_ALREADY_EXISTS");
    const maker = opp.discoveredBy, researcher = pickAgent("SEARCH", [maker]); if (!researcher) return R("NO_AVAILABLE_SEARCH_AGENT_FOR_RESEARCH");
    const r1 = analysisTask("search.research", "R", researcher, opportunityId, () => researchDoc(opp)); if (!r1.ok) return r1;
    const c1 = await checkTask(r1.taskId); if (!c1.ok || c1.decision !== "ACCEPT") return R("RESEARCH_NOT_ACCEPTED", { detail: c1.reasons ?? c1.reason });
    const evaluator = pickAgent("SEARCH", [maker, researcher]); if (!evaluator) return R("NO_AVAILABLE_SEARCH_AGENT_FOR_EVALUATION");
    const res = S.tasks[r1.taskId].analysis;
    const e1 = analysisTask("search.evaluate", "E", evaluator, opportunityId, () => evaluationDoc(opp, res)); if (!e1.ok) return e1;
    S.tasks[e1.taskId].basisTaskId = r1.taskId; save();
    const c2 = await checkTask(e1.taskId); if (!c2.ok || c2.decision !== "ACCEPT") return R("EVALUATION_NOT_ACCEPTED", { detail: c2.reasons ?? c2.reason });
    const evaln = S.tasks[e1.taskId].analysis;
    if (evaln.recommendation === "DECLINE") { opp.status = "DECLINED_BY_EVALUATION"; opp.updatedAt = now(); save(); ev("OPPORTUNITY_DECLINED", { opportunityId }); return { ok: true, declined: true, evaluation: evaln }; }
    if (evaln.recommendation !== "PROCEED_TO_PLAN") { opp.status = "NEEDS_OWNER_INPUT"; opp.updatedAt = now(); save(); return { ok: true, needsOwnerInput: true, evaluation: evaln, research: res }; }
    // Plan: internal digital steps are executable by agents; every external communication, binding commitment or spend is an owner-approval gate and has NO executor.
    const raw = S.tasks[opp.taskId].input, skillSteps = res.matchedSkills.map((s, i) => ({ id: "BUILD" + (i + 1), title: "Deliver: " + s, requires: [s], dependsOn: ["PROPOSAL"], executor: SKILL_OF_EXECUTOR[s] ?? null }));
    const steps = [
      { id: "PROPOSAL", title: "Prepare a proposal draft (internal, nothing is sent)", requires: [], dependsOn: [], executor: "proposal_draft" },
      { id: "TECHPLAN", title: "Prepare the technical implementation plan (internal)", requires: [], dependsOn: [], executor: "implementation_plan" },
      { id: "SEND", title: "Send the proposal to the prospect", requires: [], dependsOn: ["PROPOSAL", "TECHPLAN"], gate: "EXTERNAL_COMMUNICATION" },
      { id: "AGREE", title: "Accept terms / sign an agreement", requires: [], dependsOn: ["SEND"], gate: "BINDING_COMMITMENT" },
      ...skillSteps.map(s => ({ ...s, dependsOn: ["AGREE"] })),
      { id: "INVOICE", title: "Issue the invoice to the customer", requires: [], dependsOn: skillSteps.length ? skillSteps.map(s => s.id) : ["AGREE"], gate: "EXTERNAL_COMMUNICATION" },
      { id: "PAYMENT", title: "Record payment only with external evidence", requires: [], dependsOn: ["INVOICE"] }
    ];
    const mp = createMasterPlan({ objective: "Opportunity " + opportunityId + ": " + raw.title, constraints: ["no external effect without owner approval", "no spend without owner approval", "estimates are not revenue"], doneDefinition: ["independent check accepted", "payment evidence recorded"], context: { opportunityId }, steps });
    const planId = "plan-" + idPart(opportunityId), plan = { planId, opportunityId, masterPlanId: mp.planId, createdAt: now(), evaluation: evaln,
      steps: mp.steps.map(s => { const src = steps.find(x => x.id === s.id); return { id: s.id, title: s.title, dependsOn: s.dependsOn, executor: src.executor ?? null, requiresOwnerApproval: Boolean(src.gate), gate: src.gate ?? null, status: src.gate ? "BLOCKED_PENDING_OWNER_APPROVAL" : "PLANNED" }; }),
      requiredApprovals: [], note: "Gated steps have no executor: they are proposals for the owner, never actions." };
    for (const s of plan.steps.filter(x => x.requiresOwnerApproval)) {
      const subject = "plan:" + planId + ":" + s.id + ":" + sha(canon({ s: s.title, o: opportunityId })).slice(0, 12), a = { stepId: s.id, action: s.gate, subject, requestId: null };
      if (approvals) {
        try {
          const rq = approvals.request({ action: s.gate, subject, what: s.title + " (opportunity " + opportunityId + ")", why: "Part of the plan for a verified, qualified opportunity (estimated, not revenue).", costUsd: 0, risk: { level: s.gate === "BINDING_COMMITMENT" ? "HIGH" : "MEDIUM", description: s.gate === "BINDING_COMMITMENT" ? "A binding commitment with a third party." : "Outbound communication in the owner's name." }, externalEffect: s.gate === "BINDING_COMMITMENT" ? "A contract or binding terms would be accepted." : "A message would be sent to an external party.", reversible: false, irreversibleNote: "Once sent or signed it cannot be recalled.", ifOwnerSaysNo: "The step stays blocked; the opportunity remains in the pipeline unchanged.", noSpendAlternative: "Keep the work internal until the owner decides.", requestedBy: "COORDINATOR" });
          a.requestId = rq.id;
        } catch (e) { a.requestError = String(e?.message ?? e).slice(0, 80); }
      }
      plan.requiredApprovals.push(a);
    }
    if (Object.keys(S.plans).length >= WF_LIMITS.maxPlans) return R("PLAN_LIMIT"); S.plans[planId] = plan; opp.status = "PLANNED"; opp.planId = planId; opp.updatedAt = now(); save();
    ev("PLAN_CREATED", { planId, opportunityId, steps: plan.steps.length, approvalsRequested: plan.requiredApprovals.length });
    return { ok: true, planId, plan, evaluation: evaln, research: res };
  }

  // ====================================================================== Workflow E (result tracking)
  const evOk = e => Boolean(e && typeof e === "object" && e.source && e.reference && Number.isFinite(Date.parse(e.verifiedAt)));
  function recordOutcome(taskId, { expenses = [], revenue: rev = null } = {}) {
    if (stopped()) return R("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    const t = Object.hasOwn(S.tasks, taskId) ? S.tasks[taskId] : null; if (!t) return R("UNKNOWN_TASK"); if (t.status !== "VERIFIED") return R("TASK_NOT_VERIFIED", { status: t.status });
    if (t.outcome) return R("OUTCOME_ALREADY_RECORDED_FOR_THIS_TASK");
    const simulated = t.provenance === "SIMULATED"; const jobId = t.opportunityId ?? taskId, written = [];
    if (!Array.isArray(expenses) || expenses.length > 20) return R("EXPENSES_INVALID"); if (!expenses.length && !rev) return R("NOTHING_TO_RECORD");
    if ((expenses.length || rev) && simulated) return R("SIMULATED_RESULT_NOT_RECORDABLE");
    // Validate EVERYTHING before writing anything, so a refusal leaves the ledger untouched.
    for (const e of expenses) { const a = Number(e?.amountUsd); if (!Number.isFinite(a) || a < 0) return R("EXPENSE_AMOUNT_INVALID"); if (a > 0 && !evOk(e.evidence)) return R("EXPENSE_REQUIRES_EVIDENCE"); }
    if (rev) { if (!t.opportunityId || !S.opps[t.opportunityId]) return R("REVENUE_REQUIRES_A_RECORDED_OPPORTUNITY"); if (!Number.isFinite(Number(rev.amountUsd)) || Number(rev.amountUsd) < 0) return R("REVENUE_AMOUNT_INVALID"); if (rev.stage === "PAID" && (rev.confirmedReceived !== true || !evOk(rev.evidence))) return R("PAID_REQUIRES_CONFIRMED_RECEIPT_AND_EVIDENCE"); }
    try {
      for (const e of expenses) written.push(money.recordCost({ entity: "ATLASZ_EXTERNAL", jobId, provider: clean(e.provider, 60) || "UNSPECIFIED", category: clean(e.category, 40) || "OTHER", amountUsd: Number(e.amountUsd), evidence: e.evidence ?? null, note: clean(e.note, 120) }));
      if (rev) written.push(money.recordRevenue({ entity: "ATLASZ_EXTERNAL", jobId, amountUsd: Number(rev.amountUsd), stage: rev.stage, confirmedReceived: rev.confirmedReceived === true, evidence: rev.evidence ?? null, note: clean(rev.note, 120) }));
    } catch (e) { t.outcome = { at: now(), partial: true, written: written.length }; save(); return R("LEDGER_REFUSED:" + String(e?.message ?? e).slice(0, 80), { recordedBeforeRefusal: written.length }); }
    t.outcome = { at: now(), expenses: expenses.length, revenueStage: rev?.stage ?? null }; save(); ev("OUTCOME_RECORDED", { taskId, expenses: expenses.length, revenueStage: rev?.stage ?? null });
    return { ok: true, recorded: written.length, note: "Revenue counts as verified only for stage PAID with external evidence; everything else is pipeline." };
  }

  // ====================================================================== Lifecycle, batch discovery, work packages (owner priority directive)
  /** DISCOVERED > VERIFIED > QUALIFIED > PLANNED > APPROVAL_REQUIRED > PROPOSED > CONTRACTED > IN_PROGRESS > QUALITY_CHECKED > DELIVERED > PAYMENT_PENDING > PAID. Each stage past PLANNED exists only because evidence was recorded. */
  function lifecycleOf(o) {
    const st = o.stages ?? [], last = st.at(-1)?.stage;
    if (last) return last; const plan = o.planId ? S.plans[o.planId] : null;
    if (plan) { const open = plan.requiredApprovals.some(a => { try { return !(approvals?.outcome?.(a.requestId)?.decision === "APPROVED"); } catch { return true; } }); return open ? "APPROVAL_REQUIRED" : "PLANNED"; }
    if (o.status === "VERIFIED_QUALIFIED") return "QUALIFIED"; if (o.status === "VERIFIED_NOT_ELIGIBLE") return "VERIFIED"; return "DISCOVERED";
  }
  const evOkStage = e => Boolean(e && typeof e === "object" && typeof e.source === "string" && e.source && typeof e.reference === "string" && e.reference && Number.isFinite(Date.parse(e.verifiedAt)));
  const gateApproved = (plan, gateStep) => { const a = plan.requiredApprovals.find(x => x.stepId === gateStep); try { return Boolean(a?.requestId && approvals?.outcome?.(a.requestId)?.decision === "APPROVED"); } catch { return false; } };
  function advanceLifecycle(opportunityId, stage, { evidence = null } = {}) {
    if (stopped()) return R("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const o = Object.hasOwn(S.opps, opportunityId) ? S.opps[opportunityId] : null; if (!o) return R("UNKNOWN_OPPORTUNITY");
    if (!STAGES_AFTER_PLAN.includes(stage)) return R("STAGE_NOT_ADVANCEABLE_BY_EVIDENCE"); if (o.retrieval === "FIXTURE") return R("FIXTURE_OPPORTUNITIES_CANNOT_ENTER_THE_COMMERCIAL_PIPELINE");
    const plan = o.planId ? S.plans[o.planId] : null; if (!plan) return R("OPPORTUNITY_NOT_PLANNED"); const have = new Set((o.stages ?? []).map(x => x.stage)), idx = STAGES_AFTER_PLAN.indexOf(stage);
    if (have.has(stage)) return R("STAGE_ALREADY_RECORDED"); if (idx > 0 && !have.has(STAGES_AFTER_PLAN[idx - 1]) && !(stage === "QUALITY_CHECKED" && have.has("IN_PROGRESS"))) return R("PREVIOUS_STAGE_MISSING", { needs: STAGES_AFTER_PLAN[idx - 1] });
    const mine = Object.values(S.tasks).filter(t => t.opportunityId === opportunityId && t.workflow === "C");
    if (stage === "PROPOSED") { if (!gateApproved(plan, "SEND")) return R("OWNER_APPROVAL_FOR_SEND_NOT_GRANTED"); if (!evOkStage(evidence)) return R("EVIDENCE_REQUIRED_OF_THE_SENDING"); }
    if (stage === "CONTRACTED") { if (!gateApproved(plan, "AGREE")) return R("OWNER_APPROVAL_FOR_AGREEMENT_NOT_GRANTED"); if (!evOkStage(evidence)) return R("EVIDENCE_REQUIRED_OF_THE_AGREEMENT"); }
    if (stage === "QUALITY_CHECKED" && !mine.some(t => t.status === "VERIFIED" && !/^(implementation_plan|proposal_draft)$/.test(t.executor))) return R("NO_INDEPENDENTLY_VERIFIED_DELIVERABLE");
    if (stage === "DELIVERED" && !evOkStage(evidence)) return R("EVIDENCE_REQUIRED_OF_THE_DELIVERY");
    if (stage === "PAYMENT_PENDING") { if (!gateApproved(plan, "INVOICE")) return R("OWNER_APPROVAL_FOR_INVOICE_NOT_GRANTED"); if (!evOkStage(evidence)) return R("EVIDENCE_REQUIRED_OF_THE_INVOICE"); }
    if (stage === "PAID" && !mine.some(t => t.outcome?.revenueStage === "PAID")) return R("NO_PAID_RECEIPT_RECORDED_IN_THE_LEDGER");
    (o.stages ??= []).push({ stage, at: now(), evidence: evidence ? { source: clean(evidence.source, 80), reference: clean(evidence.reference, 160), verifiedAt: evidence.verifiedAt } : { source: "workforce", reference: mine.filter(t => t.status === "VERIFIED").map(t => t.taskId).join(",").slice(0, 160) || "n/a", verifiedAt: now() } });
    o.updatedAt = now(); save(); ev("LIFECYCLE_ADVANCED", { opportunityId, stage }); return { ok: true, stage };
  }
  /** The owner states which agent skills the work needs when the keyword inference found none. Recorded as an OWNER assertion (never as a verified fact); only from the owner panel. */
  function supplyOwnerInput(opportunityId, { requiredSkills, note = "" } = {}, via = "API") {
    if (stopped()) return R("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); if (via !== "OWNER_PANEL") return R("OWNER_INPUT_ONLY_FROM_OWNER_PANEL");
    const o = Object.hasOwn(S.opps, opportunityId) ? S.opps[opportunityId] : null; if (!o) return R("UNKNOWN_OPPORTUNITY"); if (o.status !== "NEEDS_OWNER_INPUT") return R("OPPORTUNITY_NOT_AWAITING_OWNER_INPUT", { status: o.status }); if (!o.derived.eligible) return R("OPPORTUNITY_NOT_ELIGIBLE");
    if (!Array.isArray(requiredSkills) || !requiredSkills.length || requiredSkills.length > 10 || !requiredSkills.every(x => typeof x === "string" && /^[a-z][a-z0-9._-]{1,48}$/.test(x))) return R("REQUIRED_SKILLS_INVALID");
    o.ownerInput = { requiredSkills: [...new Set(requiredSkills)], note: clean(note, 300), at: now(), by: "OWNER_PANEL", kind: "OWNER_ASSERTION_NOT_VERIFIED_FACT" }; o.status = "VERIFIED_QUALIFIED"; o.updatedAt = now(); save(); ev("OWNER_INPUT_RECORDED", { opportunityId }); return { ok: true, status: o.status };
  }
  /** Dynamic assignment: each item goes to the least-loaded usable SEARCH agent; the coordinator names an independent checker; the check runs immediately. Duplicates are dropped before any agent is used. */
  async function discoverBatch(items, { toInput, maxItems = 10 } = {}) {
    const out = [], list = (Array.isArray(items) ? items : []).slice(0, maxItems);
    for (const it of list) {
      const conv = toInput(it); if (!conv.ok) { out.push({ ok: false, title: it?.title, reason: conv.reason }); continue; }
      const agent = pickAgent("SEARCH"); if (!agent) { out.push({ ok: false, title: it.title, reason: "NO_AVAILABLE_SEARCH_AGENT" }); continue; }
      const d = discoverOpportunity(agent, conv.input); if (!d.ok) { out.push({ ok: false, title: it.title, reason: d.reason }); continue; }
      const c = await checkTask(d.taskId); out.push({ ok: true, opportunityId: d.opportunityId, title: it.title, discoveredBy: agent, checkedBy: c.checker ?? null, decision: c.decision ?? c.reason, lifecycle: lifecycleOf(S.opps[d.opportunityId]), eligible: S.opps[d.opportunityId].derived.eligible, blockers: S.opps[d.opportunityId].derived.blockers });
    }
    return out;
  }
  /** Execution hand-off: which execution agent would take which internal step, with the models/tools actually available. Nothing runs here. */
  function assignExecution(planId) {
    const plan = Object.hasOwn(S.plans, planId) ? S.plans[planId] : null; if (!plan) return R("UNKNOWN_PLAN"); const taken = [], assignments = [];
    for (const st of plan.steps.filter(x => x.executor && !x.requiresOwnerApproval)) { const ag = pickAgent("EXECUTION", taken) ?? pickAgent("EXECUTION"); if (!ag) { assignments.push({ stepId: st.id, executor: st.executor, agentId: null, blocker: "NO_AVAILABLE_EXECUTION_AGENT" }); continue; } taken.push(ag); assignments.push({ stepId: st.id, executor: st.executor, agentId: ag, skill: executorSkill(st.executor), models: models ? "MODEL_GATEWAY_CONNECTED_NO_PAID_USAGE" : "NONE (local deterministic tools only)" }); }
    plan.assignments = assignments; save(); ev("EXECUTION_ASSIGNED", { planId, steps: assignments.length }); return { ok: true, assignments };
  }

  /** Transparent, deterministic prioritisation. Only components with evidence score; every unknown is listed and scores 0 (never guessed). No earnings are inferred. */
  function rankPipeline() {
    const have = new Set(registry.list().flatMap(a => a.team === "EXECUTION" && a.status === "REGISTERED_READY" ? a.capabilityProfile.skills : []));
    const rows = Object.values(S.opps).map(o => {
      if (!o.derived.eligible) return { opportunityId: o.id, title: o.title, score: null, reason: "INELIGIBLE:" + o.derived.blockers.join(",") };
      const d = o.derived.discovery, unknown = [], c = {};
      c.sourceEvidence = o.retrieval === "CONNECTOR" ? 20 : o.retrieval === "OPERATOR_TOOL" ? 12 : o.retrieval === "OWNER_OR_MANUAL" ? 8 : 0;
      const skills = o.ownerInput?.requiredSkills ?? d?.requirements?.skills ?? []; if (!skills.length) { unknown.push("DELIVERABILITY_NO_SKILL_MATCH"); c.deliverability = 0; } else c.deliverability = Math.round(25 * skills.filter(x => have.has(x)).length / skills.length);
      c.deadline = !d ? 5 : d.deadlineState === "OPEN" ? ((Date.parse(d.deadline) - Date.parse(now())) / 864e5 >= 7 ? 15 : 8) : d.deadlineState === "UNKNOWN" ? 5 : 0; if (d?.deadlineState === "UNKNOWN") unknown.push("DEADLINE_UNKNOWN");
      c.geography = !d ? 5 : d.geoRestrictions?.length ? 0 : d.internationalEligibility === "SOURCE_STATES_OPEN" ? 15 : 5; unknown.push(...(d && !d.geoRestrictions?.length && d.internationalEligibility !== "SOURCE_STATES_OPEN" ? ["GEOGRAPHIC_ELIGIBILITY_UNKNOWN_NOT_ASSUMED"] : []), ...(d?.geoRestrictions?.length ? ["GEOGRAPHIC_RESTRICTION_FOUND"] : []));
      c.valueKnown = o.derived.sourceValue || o.derived.expectedNetUsd !== null ? 10 : 0; if (!c.valueKnown) unknown.push("VALUE_UNKNOWN"); if (o.derived.economics === "UNKNOWN") unknown.push("MARGIN_UNKNOWN");
      c.scamRisk = !d ? 8 : d.fraud?.level === "NONE" ? 15 : d.fraud?.level === "LOW" ? 8 : 0;
      const score = Object.values(c).reduce((a, b) => a + b, 0);
      return { opportunityId: o.id, title: o.title, score, components: c, unknown: [...new Set(unknown)], maxScore: 100, lifecycle: lifecycleOf(o), basis: "Evidence-weighted checklist, not a revenue forecast." };
    });
    return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }

  // ====================================================================== Views (real data only)
  const taskOf = id => Object.values(S.tasks).filter(t => t.agentId === id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  function agentViews() {
    const evs = events.entries().slice(-400);
    return registry.list().map(p => {
      const mine = taskOf(p.id), running = mine.find(t => t.status === "RUNNING"), last = mine.find(t => t.status === "VERIFIED"), failed = mine.find(t => ["DEAD_LETTER", "BLOCKED"].includes(t.status)), mem = (() => { try { return memory?.forAgent(p.id)?.activity?.() ?? null; } catch { return null; } })();
      const waiting = mine.find(t => ["SUBMITTED", "REJECTED_REWORK_ALLOWED", "INTERRUPTED"].includes(t.status));
      const state = !p.state.enabled ? "DISABLED" : p.state.paused ? "PAUSED" : running ? "WORKING" : waiting ? "WAITING" : failed && failed.updatedAt > (last?.updatedAt ?? "") ? "BLOCKED_OR_FAILED" : mine.length ? "IDLE" : "NO_ACTIVITY_YET";
      return { id: p.id, name: p.name, team: p.team, role: p.role, registryStatus: p.status, state, liveEvidence: running ? "RUNNING task " + running.taskId : mine.length ? "last event " + mine[0].updatedAt : "none: registered only",
        currentTask: running ? { taskId: running.taskId, kind: running.kind } : null, assignedModel: models?.assignmentOf?.(p.id) ?? null, modelPolicy: p.modelPolicy, toolsInUse: running ? [running.executor ?? running.kind] : [],
        recentActivity: evs.filter(e => e.data?.agentId === p.id).slice(-5).map(e => ({ at: e.at, event: e.event, taskId: e.data.taskId ?? null })), lastSuccess: last ? { taskId: last.taskId, at: last.updatedAt, provenance: last.provenance } : null,
        blocker: failed && state === "BLOCKED_OR_FAILED" ? { taskId: failed.taskId, code: failed.failure?.code ?? failed.blocker } : p.state.paused ? { code: "PAUSED", reason: p.state.pausedReason } : null,
        history: { total: mine.length, verified: mine.filter(t => t.status === "VERIFIED").length, failed: mine.filter(t => ["DEAD_LETTER", "REJECTED_FINAL"].includes(t.status)).length, rejectedThenReworked: mine.filter(t => (t.rejections ?? 0) > 0).length, recent: mine.slice(0, 8).map(t => ({ taskId: t.taskId, kind: t.kind, status: t.status, at: t.updatedAt, provenance: t.provenance })) },
        cost: { taskCostUsd: +mine.reduce((s, t) => s + (t.costUsd ?? 0), 0).toFixed(6), limits: { perTask: p.limits.maxCostUsdPerTask, perDay: p.limits.maxCostUsdPerDay }, tokensIn: null, usageNote: "Model usage is recorded only when a model call happened." },
        memory: mem ? { available: true, notes: mem.notes, lastAt: mem.lastAt } : { available: false, reason: memory ? "NO_ACTIVITY" : "MEMORY_GATEWAY_NOT_CONNECTED" }, limits: p.limits, authorisedTools: p.authorisedTools.map(t => t.tool + ":" + t.permission), skills: p.capabilityProfile.skills };
    });
  }
  function systemView() {
    const ts = Object.values(S.tasks), by = s => ts.filter(t => Array.isArray(s) ? s.includes(t.status) : t.status === s);
    const led = money.summary({ entity: "ATLASZ_EXTERNAL" }), opps = Object.values(S.opps);
    return {
      state: "CONNECTED", counts: { agents: registry.list().length, tasks: ts.length }, active: agentViews().filter(a => a.state === "WORKING").map(a => a.id), waiting: agentViews().filter(a => a.state === "WAITING").map(a => a.id), failed: agentViews().filter(a => a.state === "BLOCKED_OR_FAILED").map(a => a.id),
      queues: { running: by("RUNNING").length, awaitingCheck: by("SUBMITTED").length, interrupted: by("INTERRUPTED").length, reworkAllowed: by("REJECTED_REWORK_ALLOWED").length, deadLetter: by("DEAD_LETTER").length, blocked: by("BLOCKED").length },
      delegation: coordinator.ledger.list("JOCI", {}).slice(-30).map(k => ({ id: k.id, kind: k.kind, owner: k.owner, status: k.status, owners: k.owners })),
      makerChecker: ts.flatMap(t => (t.checks ?? []).map(c => ({ taskId: t.taskId, maker: t.agentId, checker: c.checker, decision: c.decision, at: c.at, reasons: c.reasons }))).slice(-40).reverse(),
      pipeline: opps.map(o => ({ id: o.id, title: o.title, status: o.status, lifecycle: lifecycleOf(o), stages: (o.stages ?? []).map(x => x.stage), retrieval: o.retrieval, discoveredBy: o.discoveredBy, verifiedBy: o.verifiedBy ?? null, eligible: o.derived.eligible, blockers: o.derived.blockers, economics: o.derived.economics, expectedNetUsd: o.derived.expectedNetUsd, unknownFields: o.derived.unknownFields, planId: o.planId ?? null, kind: "ESTIMATE_NOT_REVENUE",
        discovery: o.derived.discovery ? { sourceId: o.derived.discovery.sourceId, listingKind: o.derived.discovery.listingKind, jurisdiction: o.derived.discovery.jurisdiction, currency: o.derived.discovery.currency, language: o.derived.discovery.language, publishedAt: o.derived.discovery.publishedAt, deadline: o.derived.discovery.deadline, deadlineState: o.derived.discovery.deadlineState, fraudLevel: o.derived.discovery.fraud.level, fraud: o.derived.discovery.fraud.indicators, geoRestrictions: o.derived.discovery.geoRestrictions, internationalEligibility: o.derived.discovery.internationalEligibility, sourceValue: o.derived.sourceValue } : null })),
      ranking: rankPipeline(),
      discoverySummary: { connectorRetrieved: opps.filter(o => o.retrieval === "CONNECTOR").length, operatorToolRetrieved: opps.filter(o => o.retrieval === "OPERATOR_TOOL").length, fixtures: opps.filter(o => o.retrieval === "FIXTURE").length, ownerOrManual: opps.filter(o => o.retrieval === "OWNER_OR_MANUAL").length, verified: opps.filter(o => /^VERIFIED|PLANNED|NEEDS|DECLINED/.test(o.status)).length, qualified: opps.filter(o => o.status === "VERIFIED_QUALIFIED" || o.status === "PLANNED").length, byLifecycle: Object.fromEntries([...new Set(opps.map(lifecycleOf))].map(k => [k, opps.filter(o => lifecycleOf(o) === k).length])) },
      deliverables: ts.filter(t => t.workflow === "C" && t.opportunityId).map(t => ({ taskId: t.taskId, opportunityId: t.opportunityId, executor: t.executor, agentId: t.agentId, status: t.status, checker: t.checker ?? null, provenance: t.provenance, resultSha256: t.resultSha256 ?? null })),
      plans: Object.values(S.plans).map(p => ({ planId: p.planId, opportunityId: p.opportunityId, steps: p.steps.map(s => ({ id: s.id, title: s.title, status: s.status, gate: s.gate })), approvals: p.requiredApprovals })),
      execution: ts.filter(t => t.workflow === "C").slice(-30).reverse().map(t => ({ taskId: t.taskId, executor: t.executor, agentId: t.agentId, status: t.status, provenance: t.provenance, checker: t.checker ?? null, attempts: t.attempts.length, opportunityId: t.opportunityId })),
      verifiedRevenue: { verifiedReceivedUsd: led.revenue.verifiedReceivedUsd, paymentRecords: led.revenue.paymentRecords, source: led.revenue.source, kind: "VERIFIED_RECEIPTS_ONLY" },
      estimatesAndPipeline: { unconfirmedPipelineUsd: led.revenue.unconfirmedPipelineUsd, opportunityEstimates: opps.filter(o => o.derived.expectedNetUsd !== null).reduce((s, o) => s + o.derived.expectedNetUsd, 0), kind: "ESTIMATE_NOT_REVENUE" },
      costs: { totalUsd: led.costs.totalUsd, byCategory: led.costs.byCategory },
      simulated: ts.filter(t => t.provenance === "SIMULATED").map(t => ({ taskId: t.taskId, agentId: t.agentId, status: t.status, note: "SIMULATED: never recorded as revenue" })),
      escalations: S.escalations.slice(-20).reverse(), events: events.entries().slice(-60).reverse().map(e => ({ at: e.at, type: e.event, agentId: e.data?.agentId ?? null, taskId: e.data?.taskId ?? null, detail: e.data })),
      integrity: { events: eventsOk(), registry: registry.verify().ok, coordination: coordinator.auditVerify().ok, ledger: led.chain?.ok ?? null },
      recovery, note: "Everything here is read from the task store, the coordinator and the ledgers. An agent is WORKING only while one of its own tasks is RUNNING."
    };
  }
  const getTask = id => (Object.hasOwn(S.tasks, id) ? structuredClone({ ...S.tasks[id], input: undefined }) : null);
  const verify = () => ({ ok: eventsOk() && registry.verify().ok, events: eventsOk(), registry: registry.verify() });
  return { selectAgent: (team, { skill = null, exclude = [], only = null } = {}) => { const load = id => Object.values(S.tasks).filter(t => t.agentId === id && ["RUNNING", "SUBMITTED", "INTERRUPTED", "SUSPENDED"].includes(t.status)).length; return ROSTER.filter(id => roleOf(id) === team && !exclude.includes(id) && (only === null || only === id) && registry.isUsable(id) && capacity(id) > 0 && (!skill || registry.get(id).capabilityProfile.skills.includes(skill))).sort((a, b) => load(a) - load(b) || (a < b ? -1 : 1))[0] ?? null; },
    planStep: (planId, stepId) => { const plan = Object.hasOwn(S.plans, planId) ? S.plans[planId] : null, st = plan?.steps.find(x => x.id === stepId); return st ? { planId, stepId, opportunityId: plan.opportunityId, executor: st.executor ?? null, requiresOwnerApproval: Boolean(st.requiresOwnerApproval), gate: st.gate ?? null, unmetGates: unmetGates(plan, st), skill: st.executor ? executorSkill(st.executor) ?? st.executor : null } : null; },
    planSteps: planId => { const plan = Object.hasOwn(S.plans, planId) ? S.plans[planId] : null; return plan ? plan.steps.map(st => ({ id: st.id, executor: st.executor ?? null, requiresOwnerApproval: Boolean(st.requiresOwnerApproval), dependsOn: st.dependsOn ?? [], skill: st.executor ? executorSkill(st.executor) ?? st.executor : null })) : null; },
    bindMaster, suspendTask, unsuspendTask, reassignTask, rankPipeline, discoverOpportunity, supplyOwnerInput, discoverBatch, advanceLifecycle, assignExecution, lifecycleOf: id => (Object.hasOwn(S.opps, id) ? lifecycleOf(S.opps[id]) : null), planOpportunity, executeTask, checkTask, reworkTask, resumeTask, recordOutcome, agentViews, systemView, getTask, verify, coordinator, ledger: money, registry, listOpportunities: () => Object.values(S.opps).map(o => ({ ...o })), listTasks: () => Object.values(S.tasks).map(t => ({ ...t, input: undefined })) };
}
