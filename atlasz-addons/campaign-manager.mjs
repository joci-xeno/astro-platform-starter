// O502 / S501 / SN01 Long-running development campaigns (W3). Orchestration logic, NOT an agent: campaign tasks are owned by the 30 permanent agents through the
// EXISTING M4 coordinator task API (agent-coordination.mjs -> handoff ledger). This module adds the campaign layer only:
//   * Persistent records (goal, milestones, tasks, checkpoints, budget, observations) in one atomic, hash-checked file; a damaged file is set aside, never trusted.
//     resume after restart = a new manager on the same dir + resumeAll().
//   * Budget in TOKENS and TIME only. Any money-like budget key is refused: campaigns can never spend.
//   * Maker-checker for every "done": a task is DONE only when the ledger says DONE, which needs an ACCEPT from an independent verifier assigned by the coordinator.
//     claimDone() only SUBMITS the maker's result hash; milestone/campaign completion is derived from the ledger and markMilestoneDone() refuses otherwise.
//   * Owner approval: starting a campaign that touches files needs a signed owner approval (owner-auth.mjs, action CAMPAIGN_START, subject = plan sha256).
//     No owner key configured -> denied (fail closed). The approval is bound to the exact plan: any change to the plan changes the hash.
//   * Stall detection with the existing stall-replanner (detectStall over progress deltas); a stall produces a REPLAN PROPOSAL (replan()), never an action.
//   * Daily summary. Every decision is appended to a hash-chained audit log. The kill switch (isStopped) freezes every mutation.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";
import { KIND_ROLES } from "./agent-coordination.mjs";
import { AGENT_ID_RE, roleOf } from "./agent-tool-policy.mjs";
import { createMasterPlan } from "./master-planner-orchestrator.mjs";
import { detectStall, replan } from "./stall-replanner.mjs";
import { containsSecret, scrub } from "./secret-patterns.mjs";
import { sha256, canon, boundText } from "./reasoning-common.mjs";

export const LIMITS = Object.freeze({ maxCampaigns: 50, maxMilestones: 10, maxTasks: 50, maxGoal: 1000, maxTitle: 160, maxFiles: 100, maxCheckpoints: 20, maxCheckpointChars: 4000, maxObservations: 200, maxTokens: 50_000_000, maxTimeMs: 90 * 86_400_000, stallThreshold: 3 });
export const STATUSES = Object.freeze(["DRAFT", "ACTIVE", "STALLED", "PAUSED_BUDGET", "COMPLETED", "CANCELLED"]);
const CID = /^[a-z0-9][a-z0-9-]{0,19}$/, TID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,30}$/, MONEY = /usd|eur|huf|gbp|money|cost|price|spend|dollar|credit|cash|fiat|pay/i;
const kindRole = kind => { const p = String(kind).split(/[._-]/)[0]; return Object.hasOwn(KIND_ROLES, p) ? KIND_ROLES[p] : null; };
const plain = v => v !== null && typeof v === "object" && !Array.isArray(v);
const fileOk = f => typeof f === "string" && f.length > 0 && f.length <= 300 && !path.isAbsolute(f) && !/^[A-Za-z]:/.test(f) && !f.split(/[\\/]/).includes("..") && !f.includes("\0");

export function createCampaignManager({ dir, coordinator, ownerAuth = null, isStopped = () => false, nowFn = () => Date.now(), stallThreshold = LIMITS.stallThreshold } = {}) {
  if (!dir) throw new Error("CAMPAIGN_DIR_REQUIRED");
  if (!coordinator || typeof coordinator.connect !== "function" || !coordinator.ledger) throw new Error("COORDINATOR_REQUIRED");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tenantId = coordinator.summary().tenantId, led = coordinator.ledger;
  const audit = createAuditChain({ filePath: path.join(dir, "campaign-audit.jsonl") });
  const file = path.join(dir, "campaigns.json");
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };
  const log = (event, data = {}) => audit.append(event, data);
  let C = Object.create(null), loadedFrom = "FRESH";
  if (fs.existsSync(file)) {
    try {
      const w = JSON.parse(fs.readFileSync(file, "utf8")); if (typeof w.body !== "string" || w.sha !== sha256(w.body)) throw new Error("hash");
      const b = JSON.parse(w.body); if (!plain(b) || b.v !== 1 || !plain(b.campaigns)) throw new Error("shape");
      for (const [k, c] of Object.entries(b.campaigns)) if (!CID.test(k) || !plain(c) || c.id !== k || !STATUSES.includes(c.status) || !plain(c.tasks) || !Array.isArray(c.milestones) || typeof c.planSha256 !== "string") throw new Error("shape-campaign");
      C = Object.assign(Object.create(null), b.campaigns); loadedFrom = "FILE";
    } catch { try { fs.renameSync(file, file + ".corrupt-" + nowFn()); } catch { /* ignore */ } C = Object.create(null); loadedFrom = "CORRUPT_SET_ASIDE_STARTED_EMPTY"; log("CAMPAIGN_STATE_CORRUPT", {}); }
  }
  const save = () => { const body = JSON.stringify({ v: 1, campaigns: C }), t = file + "." + crypto.randomBytes(4).toString("hex") + ".tmp"; fs.writeFileSync(t, JSON.stringify({ sha: sha256(body), body }), { mode: 0o600 }); fs.renameSync(t, file); };
  const get = id => (typeof id === "string" && CID.test(id) && Object.hasOwn(C, id) ? C[id] : null);
  const planOf = c => ({ id: c.id, goal: c.goal, milestones: c.milestones.map(m => ({ id: m.id, title: m.title, taskIds: m.taskIds })), tasks: Object.values(c.tasks).map(t => ({ id: t.id, kind: t.kind, owner: t.owner, dependsOn: t.dependsOn, payload: t.payload, milestone: t.milestone })).sort((a, b) => (a.id < b.id ? -1 : 1)), touchesFiles: c.touchesFiles, files: c.files, budget: c.budget });
  const planSha = c => sha256(canon(planOf(c)));
  const ledgerTask = t => { if (!t.ledgerId) return null; const r = led.get(tenantId, t.ledgerId); return r.ok ? r.task : null; };

  /** spec: {id, goal, milestones:[{id,title,tasks:[{id,kind,owner,payload?,dependsOn?}]}], files?:[], touchesFiles?, budget:{tokens, timeMs}} */
  function create(spec = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    const { id, goal, milestones, files = [], budget } = spec;
    if (typeof id !== "string" || !CID.test(id)) return fail("CAMPAIGN_ID_INVALID"); if (get(id)) return fail("CAMPAIGN_EXISTS");
    if (Object.keys(C).length >= LIMITS.maxCampaigns) return fail("TOO_MANY_CAMPAIGNS");
    if (typeof goal !== "string" || !goal.trim() || goal.length > LIMITS.maxGoal || containsSecret(goal) || scrub(goal) !== goal) return fail("GOAL_INVALID_OR_CONTAINS_SECRET");
    if (!plain(budget)) return fail("BUDGET_REQUIRED_TOKENS_AND_TIME");
    for (const k of Object.keys(budget)) { if (MONEY.test(k)) return fail("BUDGET_MONEY_NOT_ALLOWED"); if (k !== "tokens" && k !== "timeMs") return fail("BUDGET_KEY_UNKNOWN:" + k.slice(0, 20)); }
    if (!Number.isInteger(budget.tokens) || budget.tokens <= 0 || budget.tokens > LIMITS.maxTokens || !Number.isInteger(budget.timeMs) || budget.timeMs <= 0 || budget.timeMs > LIMITS.maxTimeMs) return fail("BUDGET_OUT_OF_RANGE");
    if (!Array.isArray(files) || files.length > LIMITS.maxFiles || !files.every(fileOk)) return fail("FILES_INVALID");
    if (!Array.isArray(milestones) || !milestones.length || milestones.length > LIMITS.maxMilestones) return fail("MILESTONES_REQUIRED_1_TO_" + LIMITS.maxMilestones);
    const tasks = Object.create(null), ms = [];
    for (const m of milestones) {
      if (!plain(m) || typeof m.id !== "string" || !TID.test(m.id) || ms.some(x => x.id === m.id)) return fail("MILESTONE_ID_INVALID_OR_DUPLICATE");
      if (typeof m.title !== "string" || !m.title.trim() || m.title.length > LIMITS.maxTitle) return fail("MILESTONE_TITLE_INVALID");
      if (!Array.isArray(m.tasks) || !m.tasks.length) return fail("MILESTONE_NEEDS_TASKS:" + m.id);
      for (const t of m.tasks) {
        if (!plain(t) || typeof t.id !== "string" || !TID.test(t.id) || Object.hasOwn(tasks, t.id)) return fail("TASK_ID_INVALID_OR_DUPLICATE");
        if (typeof t.owner !== "string" || !AGENT_ID_RE.test(t.owner)) return fail("TASK_OWNER_NOT_IN_ROSTER:" + t.id);
        const need = kindRole(t.kind); if (!need) return fail("TASK_KIND_NOT_PERMITTED:" + t.id); if (need !== roleOf(t.owner)) return fail("TASK_KIND_NOT_FOR_OWNER_TEAM:" + t.id);
        let pj; try { pj = JSON.stringify(t.payload ?? null); } catch { return fail("TASK_PAYLOAD_INVALID:" + t.id); } if (pj.length > 4000 || containsSecret(pj) || scrub(pj) !== pj) return fail("TASK_PAYLOAD_INVALID_OR_SECRET:" + t.id);
        if (t.dependsOn !== undefined && (!Array.isArray(t.dependsOn) || t.dependsOn.length > 10)) return fail("TASK_DEPENDENCIES_INVALID:" + t.id);
        tasks[t.id] = { id: t.id, kind: t.kind, owner: t.owner, payload: t.payload ?? null, dependsOn: [...new Set(t.dependsOn ?? [])], milestone: m.id, ledgerId: null, state: "PENDING", lastError: null };
      }
      ms.push({ id: m.id, title: boundText(m.title, LIMITS.maxTitle).text, taskIds: m.tasks.map(t => t.id) });
    }
    if (Object.keys(tasks).length > LIMITS.maxTasks) return fail("TOO_MANY_TASKS");
    try { createMasterPlan({ objective: goal, steps: Object.values(tasks).map(t => ({ id: t.id, title: t.id, dependsOn: t.dependsOn, role: roleOf(t.owner) })) }); }   // the existing planner's dependency validation (unknown deps, self-deps, cycles)
    catch (e) { return fail("PLAN_" + String(e.message)); }
    for (const t of Object.values(tasks)) if ((id + "." + t.id).length > 60) return fail("TASK_ID_TOO_LONG_FOR_LEDGER:" + t.id);
    const touchesFiles = Boolean(spec.touchesFiles) || files.length > 0;
    const c = { id, goal, milestones: ms, tasks, touchesFiles, files: [...files], budget: { tokens: budget.tokens, timeMs: budget.timeMs }, used: { tokens: 0 }, status: "DRAFT", createdAt: nowFn(), startedAt: null, activeMs: 0, lastTickAt: null, approval: null, checkpoints: [], observations: [], stall: null, events: 0 };
    c.planSha256 = planSha(c); C[id] = c; log("CAMPAIGN_CREATED", { id, planSha256: c.planSha256, touchesFiles, tasks: Object.keys(tasks).length }); save();
    return { ok: true, id, planSha256: c.planSha256, status: "DRAFT", needsOwnerApproval: touchesFiles, approvalAction: touchesFiles ? "CAMPAIGN_START" : null };
  }

  function start(id, approval = null) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const c = get(id); if (!c) return fail("CAMPAIGN_NOT_FOUND"); if (c.status !== "DRAFT") return fail("BAD_STATE:" + c.status);
    if (planSha(c) !== c.planSha256) { log("CAMPAIGN_PLAN_HASH_MISMATCH", { id }); return fail("PLAN_HASH_MISMATCH"); }
    if (c.touchesFiles) {
      if (!ownerAuth || typeof ownerAuth.verifyApproval !== "function") { log("CAMPAIGN_START_DENIED", { id, reason: "OWNER_AUTH_NOT_AVAILABLE" }); return fail("OWNER_APPROVAL_REQUIRED", { detail: "OWNER_AUTH_NOT_AVAILABLE" }); }
      const v = ownerAuth.verifyApproval(approval, { action: "CAMPAIGN_START", subject: c.planSha256 });
      if (!v.allowed) { log("CAMPAIGN_START_DENIED", { id, reason: v.reason }); return fail("OWNER_APPROVAL_REQUIRED", { detail: v.reason }); }
      c.approval = { nonce: v.nonce, ownerId: v.ownerId, action: "CAMPAIGN_START", subject: c.planSha256, at: nowFn() };
    }
    c.status = "ACTIVE"; c.startedAt = nowFn(); c.lastTickAt = nowFn(); log("CAMPAIGN_STARTED", { id, planSha256: c.planSha256, approvalNonce: c.approval?.nonce ?? null }); const d = dispatch(c); save();
    return { ok: true, id, status: c.status, dispatched: d };
  }

  /** Register (through the owner's coordinator handle) every pending task whose campaign dependencies are DONE in the ledger. */
  function dispatch(c) {
    if (c.status !== "ACTIVE") return [];
    const out = [];
    for (const t of Object.values(c.tasks)) {
      if (t.state !== "PENDING") continue;
      if (!t.dependsOn.every(d => ledgerTask(c.tasks[d])?.status === "DONE")) continue;
      const ledgerId = c.id + "." + t.id;
      const r = coordinator.connect(t.owner).register({ id: ledgerId, kind: t.kind, payload: { campaign: c.id, task: t.id, payload: t.payload }, dependsOn: t.dependsOn.map(d => c.tasks[d].ledgerId) });
      if (r.ok) { t.ledgerId = ledgerId; t.state = "REGISTERED"; t.lastError = null; out.push(ledgerId); log("CAMPAIGN_TASK_DISPATCHED", { id: c.id, task: t.id, ledgerId, owner: t.owner }); }
      else { t.lastError = r.reason; if (r.reason === "TASK_ID_EXISTS") { t.ledgerId = ledgerId; t.state = "REGISTERED"; } }
    }
    return out;
  }
  function tick(c) { const t = nowFn(); if (c.status === "ACTIVE" && c.lastTickAt !== null) c.activeMs += Math.max(0, t - c.lastTickAt); c.lastTickAt = t; }
  function budgetCheck(c) {
    if (c.status !== "ACTIVE") return null;
    const why = c.used.tokens > c.budget.tokens ? "TOKENS" : c.activeMs > c.budget.timeMs ? "TIME" : null;
    if (why) { c.status = "PAUSED_BUDGET"; c.pausedReason = "BUDGET_EXCEEDED:" + why; log("CAMPAIGN_PAUSED_BUDGET", { id: c.id, why, used: c.used.tokens, activeMs: c.activeMs }); }
    return why;
  }
  const doneCount = c => Object.values(c.tasks).filter(t => ledgerTask(t)?.status === "DONE").length;

  /** Refresh from the ledger: milestone/campaign completion (ledger DONE only), budget, stall detection, then dispatch newly unblocked tasks. */
  function sync(id) {
    const c = get(id); if (!c) return fail("CAMPAIGN_NOT_FOUND");
    if (stopped()) return { ok: true, id, status: c.status, frozen: true, progress: progress(c) };
    tick(c); budgetCheck(c);
    const done = doneCount(c), prev = c.observations.at(-1)?.done ?? 0;
    if (c.status === "ACTIVE" || c.status === "STALLED") { c.observations.push({ at: nowFn(), done, delta: done - prev }); if (c.observations.length > LIMITS.maxObservations) c.observations.splice(0, c.observations.length - LIMITS.maxObservations); }
    if (done === Object.keys(c.tasks).length && ["ACTIVE", "STALLED"].includes(c.status)) { c.status = "COMPLETED"; c.completedAt = nowFn(); log("CAMPAIGN_COMPLETED", { id, tasks: done, basis: "LEDGER_DONE_WITH_INDEPENDENT_VERIFIER" }); }
    if (c.status === "ACTIVE") {
      const s = detectStall(c.observations.map(o => ({ delta: o.delta })), stallThreshold);
      if (s.stalled) {
        const blocked = Object.values(c.tasks).filter(t => { const k = ledgerTask(t); return t.lastError || (k && (k.rejections > 0 || k.status === "FAILED")); }).map(t => t.id);
        c.status = "STALLED"; c.stall = { at: nowFn(), observations: s.observations, proposal: { ...replan({ goal: c.goal, failedActions: blocked, availableCapabilities: [] }), kind: "REPLAN_PROPOSAL_NOT_EXECUTED", requiresMasterOrOwnerReview: true } };
        log("CAMPAIGN_STALLED", { id, blocked });
      }
    }
    const d = dispatch(c); save();
    return { ok: true, id, status: c.status, dispatched: d, progress: progress(c), stall: c.stall };
  }
  function progress(c) {
    const by = {}; const tasks = Object.values(c.tasks).map(t => { const k = ledgerTask(t), s = k?.status ?? t.state; by[s] = (by[s] ?? 0) + 1; return { id: t.id, owner: t.owner, milestone: t.milestone, ledgerId: t.ledgerId, status: s, lastError: t.lastError }; });
    const milestones = c.milestones.map(m => ({ id: m.id, title: m.title, done: m.taskIds.every(x => ledgerTask(c.tasks[x])?.status === "DONE"), tasks: m.taskIds.length }));
    return { tasks, byStatus: by, milestones, milestonesDone: milestones.filter(m => m.done).length, budget: { tokens: c.budget.tokens, tokensUsed: c.used.tokens, timeMs: c.budget.timeMs, activeMs: c.activeMs } };
  }

  /** Maker claims a task is done: ONLY submits the result hash through the maker's own coordinator handle; the coordinator assigns an independent checker. */
  function claimDone(id, taskId, handle, resultSha256) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const c = get(id); if (!c) return fail("CAMPAIGN_NOT_FOUND");
    if (!["ACTIVE", "STALLED"].includes(c.status)) return fail("BAD_STATE:" + c.status);
    const t = typeof taskId === "string" && Object.hasOwn(c.tasks, taskId) ? c.tasks[taskId] : null; if (!t || !t.ledgerId) return fail("TASK_NOT_DISPATCHED");
    if (!handle || typeof handle.complete !== "function" || handle.id !== t.owner || coordinator.connect(t.owner) !== handle) return fail("NOT_THE_MAKER_HANDLE");
    const r = handle.complete(t.ledgerId, resultSha256); log("CAMPAIGN_DONE_CLAIMED", { id, task: taskId, ok: r.ok, reason: r.reason ?? null });
    if (!r.ok) return r; save();
    return { ok: true, status: "SUBMITTED_FOR_INDEPENDENT_CHECK", verifier: coordinator.verifierOf(t.ledgerId), note: "Not DONE until the assigned checker ACCEPTs in the ledger." };
  }
  function markMilestoneDone(id, milestoneId) {
    const c = get(id); if (!c) return fail("CAMPAIGN_NOT_FOUND"); const m = c.milestones.find(x => x.id === milestoneId); if (!m) return fail("MILESTONE_NOT_FOUND");
    const open = m.taskIds.filter(x => ledgerTask(c.tasks[x])?.status !== "DONE");
    if (open.length) { log("CAMPAIGN_MILESTONE_DONE_REFUSED", { id, milestone: milestoneId, open }); return fail("MAKER_CHECKER_REQUIRED", { open }); }
    return { ok: true, milestone: milestoneId, done: true, basis: "LEDGER_DONE_WITH_INDEPENDENT_VERIFIER" };
  }
  function recordUsage(id, usage = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const c = get(id); if (!c) return fail("CAMPAIGN_NOT_FOUND");
    if (!plain(usage)) return fail("USAGE_INVALID"); for (const k of Object.keys(usage)) { if (MONEY.test(k)) return fail("MONEY_NOT_TRACKED_HERE"); if (k !== "tokens") return fail("USAGE_KEY_UNKNOWN"); }
    if (!Number.isInteger(usage.tokens) || usage.tokens < 0 || usage.tokens > LIMITS.maxTokens) return fail("USAGE_INVALID");
    c.used.tokens += usage.tokens; tick(c); const why = budgetCheck(c); save(); return { ok: true, used: c.used.tokens, status: c.status, paused: why };
  }
  function checkpoint(id, note) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const c = get(id); if (!c) return fail("CAMPAIGN_NOT_FOUND");
    let text; try { text = typeof note === "string" ? note : JSON.stringify(note); } catch { return fail("CHECKPOINT_NOT_SERIALISABLE"); }
    if (typeof text !== "string" || !text.length || text.length > LIMITS.maxCheckpointChars) return fail("CHECKPOINT_SIZE_INVALID"); if (containsSecret(text) || scrub(text) !== text) return fail("SECRET_IN_CHECKPOINT");
    const n = (c.checkpoints.at(-1)?.n ?? 0) + 1; c.checkpoints.push({ n, at: nowFn(), sha256: sha256(text), text }); if (c.checkpoints.length > LIMITS.maxCheckpoints) c.checkpoints.splice(0, c.checkpoints.length - LIMITS.maxCheckpoints);
    log("CAMPAIGN_CHECKPOINT", { id, n, sha256: sha256(text) }); save(); return { ok: true, n };
  }
  function lastCheckpoint(id) { const c = get(id); if (!c) return fail("CAMPAIGN_NOT_FOUND"); for (let i = c.checkpoints.length - 1; i >= 0; i--) { const k = c.checkpoints[i]; if (sha256(k.text) === k.sha256) return { ok: true, n: k.n, at: k.at, text: k.text, untrusted: true }; } return fail(c.checkpoints.length ? "ALL_CHECKPOINTS_CORRUPT" : "NO_CHECKPOINT"); }
  /** After a stall, the master/owner reviewed the proposal and lets work continue (no new approval: the approved plan is unchanged). */
  function acknowledgeStall(id) { if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const c = get(id); if (!c) return fail("CAMPAIGN_NOT_FOUND"); if (c.status !== "STALLED") return fail("NOT_STALLED"); c.status = "ACTIVE"; c.observations = []; c.lastTickAt = nowFn(); log("CAMPAIGN_STALL_ACKNOWLEDGED", { id }); save(); return { ok: true, status: c.status }; }
  /** Budget can only be raised by a signed owner approval (action CAMPAIGN_BUDGET, subject = campaignId:tokens:timeMs). */
  function raiseBudget(id, { tokens, timeMs }, approval) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const c = get(id); if (!c) return fail("CAMPAIGN_NOT_FOUND");
    if (!Number.isInteger(tokens) || tokens < c.budget.tokens || tokens > LIMITS.maxTokens || !Number.isInteger(timeMs) || timeMs < c.budget.timeMs || timeMs > LIMITS.maxTimeMs) return fail("BUDGET_OUT_OF_RANGE");
    const v = ownerAuth?.verifyApproval?.(approval, { action: "CAMPAIGN_BUDGET", subject: id + ":" + tokens + ":" + timeMs }) ?? { allowed: false, reason: "OWNER_AUTH_NOT_AVAILABLE" };
    if (!v.allowed) { log("CAMPAIGN_BUDGET_DENIED", { id, reason: v.reason }); return fail("OWNER_APPROVAL_REQUIRED", { detail: v.reason }); }
    c.budget = { tokens, timeMs }; if (c.status === "PAUSED_BUDGET") { c.status = "ACTIVE"; c.lastTickAt = nowFn(); delete c.pausedReason; } log("CAMPAIGN_BUDGET_RAISED", { id, tokens, timeMs, nonce: v.nonce }); save(); return { ok: true, status: c.status };
  }
  function cancel(id, reason = "") { if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const c = get(id); if (!c) return fail("CAMPAIGN_NOT_FOUND"); if (["COMPLETED", "CANCELLED"].includes(c.status)) return fail("BAD_STATE:" + c.status); c.status = "CANCELLED"; log("CAMPAIGN_CANCELLED", { id, reason: scrub(String(reason)).slice(0, 100) }); save(); return { ok: true, note: "Ledger tasks stay with their owners; the coordinator's normal rules close them." }; }

  /** After a restart: continue every ACTIVE/STALLED campaign from disk. Time while the process was down is NOT charged to the time budget. */
  function resumeAll() {
    const out = [];
    for (const c of Object.values(C)) if (c.status === "ACTIVE" || c.status === "STALLED") { c.lastTickAt = nowFn(); out.push({ id: c.id, ...sync(c.id) }); }
    log("CAMPAIGN_RESUMED_AFTER_RESTART", { loadedFrom, campaigns: out.map(x => x.id) }); return { ok: true, loadedFrom, resumed: out.map(x => ({ id: x.id, status: x.status, dispatched: x.dispatched })) };
  }
  function dailySummary(dayIso = new Date(nowFn()).toISOString().slice(0, 10)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayIso)) return fail("DAY_INVALID");
    const inDay = t => new Date(t).toISOString().slice(0, 10) === dayIso;
    const rows = Object.values(C).map(c => { const p = progress(c); return { id: c.id, status: c.status, goal: boundText(c.goal, 120).text, milestones: p.milestonesDone + "/" + c.milestones.length, tasks: p.byStatus, tokens: c.used.tokens + "/" + c.budget.tokens, activeMs: c.activeMs, timeMs: c.budget.timeMs, awaitingOwnerApproval: c.status === "DRAFT" && c.touchesFiles, stalled: c.status === "STALLED", checkpointsToday: c.checkpoints.filter(k => inDay(k.at)).length, doneToday: c.observations.filter(o => inDay(o.at)).reduce((a, o) => a + Math.max(0, o.delta), 0) }; });
    const lines = rows.map(r => `${r.id} [${r.status}] milestones ${r.milestones}, tokens ${r.tokens}, done today ${r.doneToday}${r.stalled ? ", STALLED (replan proposal waiting)" : ""}${r.awaitingOwnerApproval ? ", awaiting owner approval" : ""}`);
    return { ok: true, day: dayIso, campaigns: rows, text: ["ATLASZ campaigns " + dayIso + " (" + rows.length + ")", ...lines].join("\n").slice(0, 4000), note: "Status comes from the task ledger; DONE always means independently verified in the ledger." };
  }
  const view = id => { const c = get(id); return c ? { ok: true, campaign: structuredClone({ ...c, progress: progress(c) }) } : fail("CAMPAIGN_NOT_FOUND"); };
  return { create, start, sync, claimDone, markMilestoneDone, recordUsage, checkpoint, lastCheckpoint, acknowledgeStall, raiseBudget, cancel, resumeAll, dailySummary, view, list: () => Object.values(C).map(c => ({ id: c.id, status: c.status })), loadedFrom: () => loadedFrom, auditVerify: () => audit.verify(), planSha256Of: id => { const c = get(id); return c ? planSha(c) : null; } };
}
