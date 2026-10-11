// MASTER COORDINATOR (supervision facade). There is ONE coordinator in ATLASZ: agent-coordination.mjs (identity-bound handles, handoff ledger, independent verifiers, stall reclaim).
// This module is not a second one: it is the owner-facing control layer ON TOP of that coordinator and the workforce. It adds what a passive ledger cannot do by itself:
//   * a persistent, prioritised dispatch queue with conflict prevention (one live assignment per plan step), approval gates and spend guard before any dispatch;
//   * a supervision tick: stalled / overloaded / conflicting work, deadlines, provider availability (with approved alternatives), spend vs the owner-signed cap, integrity of every chain;
//   * task control: suspend, resume, reassign (only through the one-shot Master capability of the workforce; OWNER_DIRECTED work is never dispatched or reassigned by the Master on its own);
//   * a manager registry: every management responsibility with a LIVE health probe. "Connected" means the probe succeeded just now, never that a module file exists;
//   * a hash-chained audit log of every Master decision; the owner stop / Safe Mode freezes every mutation.
// The Master never spends, never contacts anyone outside, never signs, never grants itself approvals. Simulated work is counted apart from real work.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { executorSkill } from "./agent-executors.mjs";

export const MASTER_LIMITS = Object.freeze({ maxQueue: 500, maxJobsKept: 1000, stallMs: 15 * 60_000, deadlineWarnDays: 7, maxPriority: 9, autoResumeMax: 3, maxFindings: 200 });
export const MANAGER_IDS = Object.freeze(["MASTER_COORDINATOR", "WORKFORCE_MANAGER", "SEARCH_AGENT_MANAGER", "EXECUTION_AGENT_MANAGER", "CAMPAIGN_MANAGER", "GLOBAL_BUSINESS_INTELLIGENCE", "AI_MODEL_MANAGER", "SECURITY_APPROVAL_MANAGER", "MEMORY_KNOWLEDGE_MANAGER", "FINANCIAL_REVENUE_MANAGER", "RUNTIME_SUPERVISOR", "TASK_SCHEDULER", "QUALITY_ASSURANCE", "RECOVERY_MAINTENANCE"]);
const R = (reason, extra = {}) => ({ ok: false, reason, ...extra });
const sha = t => crypto.createHash("sha256").update(t).digest("hex");
const TERMINAL_TASK = new Set(["VERIFIED", "DEAD_LETTER", "REJECTED_FINAL", "REASSIGNED"]);

export function createMasterCoordinator({ dir, workforce, models = null, campaigns = null, probes = {}, loopStatus = null, processLock = true, controlGuard = null, approvalsPending = null, isStopped = () => false, now = () => new Date().toISOString(), clock = () => Date.now(), limits = {} } = {}) {
  if (!dir) throw new Error("DIR_REQUIRED"); if (!workforce || typeof workforce.bindMaster !== "function") throw new Error("WORKFORCE_REQUIRED");
  const L = { ...MASTER_LIMITS, ...limits }; fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // single instance across PROCESSES (DEF-002): a live lock owned by another process refuses a second Master on the same state; a dead owner is taken over and audited
  const LOCK = path.join(dir, "master.lock"), HB = path.join(dir, "master.heartbeat.json"), instanceId = crypto.randomBytes(8).toString("hex"); let lockTaken = null;
  const pidAlive = pid => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e?.code === "EPERM"; } };
  if (processLock) {
    let held = null; try { held = JSON.parse(fs.readFileSync(LOCK, "utf8")); } catch { /* no lock or unreadable: treated as free */ }
    if (held && held.pid !== process.pid && pidAlive(held.pid)) throw new Error("MASTER_ALREADY_RUNNING_IN_PID_" + held.pid);
    if (held && held.pid !== process.pid) lockTaken = { previousPid: held.pid, previousInstance: held.instanceId };
    fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, instanceId, at: now() }), { mode: 0o600 });
  }
  const token = workforce.bindMaster(); if (!token) { if (processLock) try { fs.rmSync(LOCK, { force: true }); } catch { /* ignore */ } throw new Error("MASTER_ALREADY_BOUND_TO_THIS_WORKFORCE"); }
  const audit = createAuditChain({ filePath: path.join(dir, "master-audit.jsonl"), headPinFile: path.join(dir, "master-audit.headpin.json"), now });
  const FILE = path.join(dir, "master.json"); let S = { v: 1, jobs: {}, seq: 0, lastReport: null, supervisions: 0, startedAt: now() }, damaged = null;
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };
  const log = (event, data = {}) => { try { audit.append(event, data); } catch { /* the audit chain refuses nothing silently: verify() reports it */ } };
  function load() {
    let raw; try { raw = fs.readFileSync(FILE, "utf8"); } catch (e) { if (e?.code === "ENOENT") return; damaged = "MASTER_STATE_UNREADABLE"; return; }
    try { const j = JSON.parse(raw); if (!j || typeof j.sha !== "string" || sha(JSON.stringify(j.data)) !== j.sha) throw new Error("SHA"); S = j.data; }
    catch { damaged = "MASTER_STATE_DAMAGED"; try { fs.renameSync(FILE, FILE + ".damaged-" + clock()); } catch { /* keep going read-only */ } log("MASTER_STATE_DAMAGED_SET_ASIDE"); }
  }
  function save() { if (damaged === "MASTER_STATE_UNREADABLE") return; const data = JSON.parse(JSON.stringify(S)), tmp = FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify({ sha: sha(JSON.stringify(data)), data }), { mode: 0o600 }); fs.renameSync(tmp, FILE); }
  load();
  // ---- recovery on open: a job that was being dispatched when the process died is re-derived from the workforce's real task state, never assumed done ----
  const recovered = { jobs: 0 };
  for (const j of Object.values(S.jobs)) if (j.state === "DISPATCHING") { j.state = "QUEUED"; j.note = "RECOVERED_AFTER_RESTART_NOT_DISPATCHED"; recovered.jobs++; }
  if (recovered.jobs) { save(); log("MASTER_RECOVERED", recovered); }
  log("MASTER_STARTED", { at: now(), damaged, instanceId, pid: process.pid, lockTakenOver: lockTaken });
  const beat = (extra = {}) => { try { fs.writeFileSync(HB, JSON.stringify({ pid: process.pid, instanceId, at: now(), atMs: clock(), supervisions: S.supervisions, ...extra }), { mode: 0o600 }); } catch { /* reported by liveness() as NEVER/STALE */ } };
  beat({ phase: "STARTED" });
  /** Liveness as seen from OUTSIDE the tick: a Master whose heartbeat is older than maxAgeMs is STALE even if its object still exists. */
  function liveness(maxAgeMs = 3 * 60_000) { let hb = null; try { hb = JSON.parse(fs.readFileSync(HB, "utf8")); } catch { return { state: "NEVER", instanceId }; } const age = clock() - (hb.atMs ?? 0); return { state: age <= maxAgeMs ? "ALIVE" : "STALE", ageMs: age, pid: hb.pid, instanceId: hb.instanceId, ownInstance: hb.instanceId === instanceId, supervisions: hb.supervisions }; }
  function close() { if (processLock) { try { const held = JSON.parse(fs.readFileSync(LOCK, "utf8")); if (held.instanceId === instanceId) fs.rmSync(LOCK, { force: true }); } catch { /* already gone */ } } log("MASTER_CLOSED", { instanceId }); }

  const tasks = () => workforce.listTasks();
  /** Every consequential Master step passes the unified owner-control chain (owner authority -> kill switch -> safe mode -> security brain -> financial firewall -> owner approval -> black box).
   *  The chain can only make a decision stricter. A guard that throws, or answers anything but an explicit allow, BLOCKS (fail closed). With no guard attached the Master says so in status() ("NOT_ATTACHED"). */
  const ctl = (kind, agentId, { spendUsd = 0, params = {} } = {}) => {
    if (typeof controlGuard !== "function") return { allowed: true, guarded: false };
    try { const d = controlGuard({ kind, agentId, spendUsd, params }); if (d && d.allowed === true) return { allowed: true, guarded: true, verdict: d.verdict, correlationId: d.correlationId ?? null }; return { allowed: false, guarded: true, verdict: d?.verdict ?? "BLOCK", reason: String(d?.layer ?? "CHAIN") + ":" + String(d?.reason ?? "NOT_ALLOWED").slice(0, 80), approvalRequired: d?.approvalRequired ?? null }; }
    catch (e) { return { allowed: false, guarded: true, verdict: "BLOCK", reason: "GUARD_ERROR_FAIL_CLOSED:" + String(e?.message ?? e).slice(0, 60) }; }
  };
  const taskById = id => tasks().find(t => t.taskId === id) ?? null;
  const live = t => ["RUNNING", "SUBMITTED", "INTERRUPTED", "SUSPENDED"].includes(t.status);

  // ============================================================ dispatch queue
  /** Queue an authorised plan step. Admission refuses conflicts, gated steps and unknown plans before anything runs. */
  function enqueue({ planId, stepId, priority = 5, note = "", preferredAgent = null } = {}) {
    if (damaged) return R(damaged); if (stopped()) return R("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    if (!Number.isInteger(priority) || priority < 0 || priority > L.maxPriority) return R("PRIORITY_INVALID");
    const st = workforce.planStep(planId, stepId); if (!st) return R("PLAN_STEP_NOT_FOUND"); if (st.requiresOwnerApproval) return R("STEP_IS_AN_OWNER_APPROVAL_GATE_NOT_WORK"); if (!st.executor) return R("STEP_HAS_NO_EXECUTOR");
    const dup = Object.values(S.jobs).find(j => j.planId === planId && j.stepId === stepId && !["FAILED", "CANCELLED", "REJECTED"].includes(j.state)); if (dup) return R("CONFLICTING_ASSIGNMENT", { existingJob: dup.id, state: dup.state });
    const busy = tasks().find(t => t.workflow === "C" && t.opportunityId === st.opportunityId && t.executor === st.executor && live(t) && t.authz?.stepId === stepId); if (busy) return R("CONFLICTING_ASSIGNMENT", { activeTask: busy.taskId });
    if (Object.values(S.jobs).filter(j => ["QUEUED", "WAITING_APPROVAL", "DISPATCHED"].includes(j.state)).length >= L.maxQueue) return R("QUEUE_FULL");
    const id = "job-" + (++S.seq).toString(36).padStart(4, "0"); S.jobs[id] = { id, planId, stepId, opportunityId: st.opportunityId, executor: st.executor, priority, preferredAgent: typeof preferredAgent === "string" ? preferredAgent : null, state: "QUEUED", createdAt: now(), updatedAt: now(), note: String(note).slice(0, 120), history: [{ at: now(), state: "QUEUED" }] };
    trimJobs(); save(); log("JOB_QUEUED", { id, planId, stepId, priority }); return { ok: true, jobId: id, state: "QUEUED" };
  }
  const trimJobs = () => { const ks = Object.keys(S.jobs); if (ks.length > L.maxJobsKept) for (const k of ks.filter(k => ["VERIFIED", "FAILED", "CANCELLED", "REJECTED"].includes(S.jobs[k].state)).slice(0, ks.length - L.maxJobsKept)) delete S.jobs[k]; };
  const setJob = (j, state, extra = {}) => { Object.assign(j, extra, { state, updatedAt: now() }); (j.history ??= []).push({ at: now(), state, ...(extra.taskId ? { taskId: extra.taskId } : {}) }); if (j.history.length > 30) j.history.shift(); save(); };
  async function spendGuard() {
    if (typeof models !== "function") return { ok: true, note: "NO_MODEL_VIEW_NO_PAID_PATH_FROM_THE_MASTER" };
    try { const v = await models(); const cap = v?.usage?.cap; if (cap && cap.usd !== null && cap.valid === false) return R("SPEND_CAP_INVALID_HOLD"); if (cap && cap.usd !== null && cap.remainingUsd === 0) return R("SPEND_CAP_REACHED_HOLD"); return { ok: true }; } catch { return R("MODEL_VIEW_UNAVAILABLE_HOLD"); }
  }
  /** One dispatch pass: highest priority first, FIFO inside a priority. Nothing runs while the owner stop is active, a gate is unmet or the spend guard holds. */
  async function dispatch({ max = 5 } = {}) {
    if (damaged) return R(damaged); if (stopped()) return R("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const guard = await spendGuard(); if (!guard.ok) { log("DISPATCH_HELD", { reason: guard.reason }); return { ok: true, dispatched: [], held: guard.reason }; }
    const out = [], order = Object.values(S.jobs).filter(j => ["QUEUED", "WAITING_APPROVAL"].includes(j.state)).sort((a, b) => b.priority - a.priority || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
    for (const j of order) {
      if (out.length >= max) break; const st = workforce.planStep(j.planId, j.stepId); if (!st) { setJob(j, "FAILED", { note: "PLAN_STEP_VANISHED" }); continue; }
      if (st.unmetGates.length) { if (j.state !== "WAITING_APPROVAL") setJob(j, "WAITING_APPROVAL", { waitingFor: st.unmetGates }); continue; }
      const agent = (j.preferredAgent && workforce.selectAgent("EXECUTION", { skill: st.skill, only: j.preferredAgent })) || workforce.selectAgent("EXECUTION", { skill: st.skill }); if (!agent) { j.note = "NO_AVAILABLE_EXECUTION_AGENT"; continue; }
      const gc = ctl("DISPATCH", agent, { params: { planId: j.planId, stepId: j.stepId, tool: st.executor } }); if (!gc.allowed) { j.note = "CONTROL_CHAIN_" + gc.verdict + ":" + gc.reason; log("DISPATCH_BLOCKED_BY_CONTROL_CHAIN", { id: j.id, agent, verdict: gc.verdict, reason: gc.reason }); if (/KILL_SWITCH|EMERGENCY|SAFE_MODE/.test(gc.reason)) break; continue; }
      setJob(j, "DISPATCHING"); log("JOB_DISPATCHING", { id: j.id, agent, controlChain: gc.guarded ? gc.verdict : "NOT_ATTACHED" });
      const r = await workforce.executeTask(agent, { executor: st.executor, authorization: { type: "PLAN_STEP", planId: j.planId, stepId: j.stepId }, via: "MASTER", masterToken: token });
      if (r.ok) { setJob(j, "DISPATCHED", { taskId: r.taskId, agentId: agent }); log("JOB_DISPATCHED", { id: j.id, agent, taskId: r.taskId }); out.push({ jobId: j.id, taskId: r.taskId, agentId: agent }); }
      else if (/OWNER_STOP/.test(r.reason ?? "")) { setJob(j, "QUEUED", { note: r.reason }); break; }
      else { setJob(j, "FAILED", { note: String(r.reason).slice(0, 80) }); log("JOB_FAILED", { id: j.id, reason: r.reason }); }
    }
    return { ok: true, dispatched: out };
  }
  /** Independent verification of everything awaiting a check, then the Master's own completion record. A task is complete only when the independent checker accepted it. */
  async function verifyPending() {
    if (stopped()) return R("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const done = [];
    for (const t of tasks().filter(x => x.status === "SUBMITTED")) {
      const j = Object.values(S.jobs).find(x => x.taskId === t.taskId); const c = await workforce.checkTask(t.taskId);
      if (c.decision === "ACCEPT") { if (j) setJob(j, "VERIFIED", { checker: c.checker }); log("TASK_COMPLETION_RECORDED", { taskId: t.taskId, maker: t.agentId, checker: c.checker, provenance: t.provenance }); done.push({ taskId: t.taskId, decision: "ACCEPT", checker: c.checker }); }
      else if (c.decision) { if (j) setJob(j, "REJECTED", { checker: c.checker, reasons: (c.reasons ?? []).slice(0, 5) }); log("TASK_REJECTED_BY_CHECKER", { taskId: t.taskId, reasons: (c.reasons ?? []).slice(0, 5) }); done.push({ taskId: t.taskId, decision: c.decision }); }
    }
    return { ok: true, checked: done };
  }
  // ============================================================ task control (all audited)
  function suspend(taskId, reason = "OWNER_OR_MASTER") { if (damaged) return R(damaged); const r = workforce.suspendTask(taskId, { reason, masterToken: token }); log(r.ok ? "TASK_SUSPENDED_BY_MASTER" : "TASK_SUSPEND_REFUSED", { taskId, reason: String(reason).slice(0, 80), result: r.ok ? r.status : r.reason }); const j = Object.values(S.jobs).find(x => x.taskId === taskId); if (r.ok && j && r.status === "SUSPENDED") setJob(j, "SUSPENDED"); return r; }
  function resume(taskId) { if (damaged) return R(damaged); const gc0 = ctl("RESUME", taskById(taskId)?.agentId ?? null); if (!gc0.allowed) { log("TASK_RESUME_BLOCKED_BY_CONTROL_CHAIN", { taskId, reason: gc0.reason }); return R("CONTROL_CHAIN_" + gc0.verdict + ":" + gc0.reason); } const r = workforce.unsuspendTask(taskId, { masterToken: token }); log(r.ok ? "TASK_RESUMED_BY_MASTER" : "TASK_RESUME_REFUSED", { taskId, result: r.ok ? r.status : r.reason }); const j = Object.values(S.jobs).find(x => x.taskId === taskId); if (r.ok && j) setJob(j, "DISPATCHED"); return r; }
  async function reassign(taskId, toAgent, { ownerPanel = false } = {}) {
    if (damaged) return R(damaged); if (stopped()) return R("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const to = toAgent ?? (() => { const t = taskById(taskId); return t ? workforce.selectAgent("EXECUTION", { skill: executorSkill(t.executor) ?? t.executor, exclude: [t.agentId, t.checker].filter(Boolean) }) : null; })();
    if (!to) return R("NO_AVAILABLE_TAKER"); const gc = ctl("REASSIGN", to, { params: { taskId } }); if (!gc.allowed) { log("TASK_REASSIGN_BLOCKED_BY_CONTROL_CHAIN", { taskId, to, reason: gc.reason }); return R("CONTROL_CHAIN_" + gc.verdict + ":" + gc.reason); } const r = await workforce.reassignTask(taskId, to, { masterToken: token, ownerPanel }); log(r.ok ? "TASK_REASSIGNED_BY_MASTER" : "TASK_REASSIGN_REFUSED", { taskId, to, result: r.ok ? r.taskId : r.reason });
    if (r.ok) { const j = Object.values(S.jobs).find(x => x.taskId === taskId); if (j) setJob(j, "DISPATCHED", { taskId: r.taskId, agentId: to }); } return r;
  }
  function cancel(jobId) { const j = Object.hasOwn(S.jobs, jobId) ? S.jobs[jobId] : null; if (!j) return R("UNKNOWN_JOB"); if (!["QUEUED", "WAITING_APPROVAL"].includes(j.state)) return R("JOB_NOT_CANCELLABLE", { state: j.state }); setJob(j, "CANCELLED"); log("JOB_CANCELLED", { jobId }); return { ok: true }; }
  function prioritize(jobId, priority) { const j = Object.hasOwn(S.jobs, jobId) ? S.jobs[jobId] : null; if (!j) return R("UNKNOWN_JOB"); if (!Number.isInteger(priority) || priority < 0 || priority > L.maxPriority) return R("PRIORITY_INVALID"); if (!["QUEUED", "WAITING_APPROVAL"].includes(j.state)) return R("JOB_NOT_QUEUED", { state: j.state }); j.priority = priority; j.updatedAt = now(); save(); log("JOB_PRIORITY_SET", { jobId, priority }); return { ok: true }; }
  // ============================================================ models
  /** Approved model choice: the agent's assignment first, then others; only models that are enabled, credentialed AND live; spend 0 unless the caller grants a budget. */
  async function selectModel({ agentId, capability = "text", maxCostUsd = 0 } = {}) {
    if (maxCostUsd > 0) { const gc = ctl("MODEL_SPEND", agentId, { spendUsd: maxCostUsd, params: { capability } }); if (!gc.allowed) { log("MODEL_SPEND_BLOCKED_BY_CONTROL_CHAIN", { agentId, maxCostUsd, reason: gc.reason }); return R("CONTROL_CHAIN_" + gc.verdict + ":" + gc.reason, { approvalRequired: gc.approvalRequired ?? null }); } }
    if (typeof models !== "function") return R("MODEL_VIEW_NOT_CONNECTED"); let v; try { v = await models(); } catch { return R("MODEL_VIEW_UNAVAILABLE"); } if (!v || v.state !== "CONNECTED") return R("MODEL_VIEW_UNAVAILABLE");
    const asg = (v.assignments ?? {})[agentId], pref = asg ? [asg.primary, ...(asg.fallbacks ?? [])] : [];
    const ok = m => m.usable === true && (m.capabilities ?? []).includes(capability) && (maxCostUsd > 0 ? true : (m.costClass === "FREE" || m.costPer1kTokensUsd === 0));
    const byId = new Map((v.models ?? []).map(m => [m.id, m])), ordered = [...pref.map(i => byId.get(i)).filter(Boolean), ...(v.models ?? []).filter(m => !pref.includes(m.id))];
    const unavailablePreferred = pref.map(i => byId.get(i)).filter(m => m && !m.usable).map(m => ({ id: m.id, blockers: m.blockers }));
    const pick = ordered.find(ok) ?? null; return { ok: true, model: pick ? { id: pick.id, providerId: pick.providerId, status: pick.status } : null, noSpend: maxCostUsd === 0, unavailablePreferred, reason: pick ? null : "NO_USABLE_APPROVED_MODEL", failover: pick && unavailablePreferred.length > 0 };
  }
  // ============================================================ managers
  async function probe(fn) { if (typeof fn !== "function") return { ok: false, detail: "NO_PROBE_CONFIGURED" }; try { const r = await fn(); return { ok: r?.ok === true, detail: r?.detail ?? (r?.ok === true ? "OK" : r?.reason ?? "FAILED"), data: r?.data ?? null }; } catch (e) { return { ok: false, detail: "PROBE_ERROR:" + String(e?.message ?? e).slice(0, 60) }; } }
  const DESCR = {
    MASTER_COORDINATOR: { title: "Master Coordinator", implementation: ["atlasz-addons/agent-coordination.mjs", "atlasz-addons/master-coordinator.mjs"], agents: "all 30", permissions: "coordinate, suspend/resume/reassign PLAN_STEP work, hold; NO spending, signing, external contact", tests: ["agent-workforce.test.mjs", "master-coordinator.test.mjs"] },
    WORKFORCE_MANAGER: { title: "Workforce Manager (registry, limits, pause)", implementation: ["atlasz-addons/agent-registry.mjs", "atlasz-addons/agent-workforce.mjs"], agents: "all 30", permissions: "register/pause/limits (cost-limit raises need signature)", tests: ["agent-registry.test.mjs", "agent-workforce.test.mjs"] },
    SEARCH_AGENT_MANAGER: { title: "SEARCH Agent Manager (functional view of the 5 SEARCH agents)", implementation: ["atlasz-addons/agent-workforce.mjs (discoverBatch, planOpportunity)", "atlasz-addons/global-discovery.mjs"], agents: "SEARCH-1..5", permissions: "read public approved hosts, draft only", tests: ["global-discovery-workforce.test.mjs"] },
    EXECUTION_AGENT_MANAGER: { title: "EXECUTION Agent Manager (functional view of the 25 EXECUTION agents)", implementation: ["atlasz-addons/agent-executors.mjs", "atlasz-addons/agent-workforce.mjs"], agents: "EXECUTION-1..25", permissions: "local sandboxed executors only", tests: ["agent-executors*.test.mjs", "master-coordinator.test.mjs"] },
    CAMPAIGN_MANAGER: { title: "Campaign Manager", implementation: ["atlasz-addons/campaign-manager.mjs", "atlasz-addons/master-coordinator.mjs (planCampaign/syncCampaign)"], agents: "owners are the permanent agents (no own agents)", permissions: "token/time budgets only; CAMPAIGN_START signature for file-touching campaigns", tests: ["campaign-manager*.test.mjs"] },
    GLOBAL_BUSINESS_INTELLIGENCE: { title: "Global Business Intelligence", implementation: ["atlasz-addons/global-business-intelligence.mjs"], agents: "reads only", permissions: "read-only analytics", tests: ["global-business-intelligence.test.mjs"] },
    AI_MODEL_MANAGER: { title: "AI Model Manager and Provider Router", implementation: ["atlasz-addons/model-registry.mjs", "atlasz-addons/model-routing-bridge.mjs", "atlasz-addons/provider-egress.mjs"], agents: "per-agent assignments", permissions: "no paid call without signed enable + budget; spend cap owner-signed", tests: ["model-registry.test.mjs", "model-routing-bridge.test.mjs"] },
    SECURITY_APPROVAL_MANAGER: { title: "Security and Approval Manager (owner approvals, vault, egress)", implementation: ["atlasz-addons/owner-auth.mjs", "atlasz-addons/egress-policy.mjs", "atlasz-addons/api-key-vault.mjs"], agents: "none", permissions: "owner-signed, single-use, subject-bound", tests: ["owner-auth*.test.mjs", "egress-policy*.test.mjs"] },
    MEMORY_KNOWLEDGE_MANAGER: { title: "Memory and Knowledge Manager", implementation: ["atlasz-addons/memory-store.mjs", "atlasz-addons/agent-memory.mjs"], agents: "project-scoped access", permissions: "clearance + project grants; retrieved text is data", tests: ["m5-memory-integration.test.mjs"] },
    FINANCIAL_REVENUE_MANAGER: { title: "Financial and Revenue Manager", implementation: ["atlasz-addons/financial-ledger.mjs", "atlasz-addons/revenue-persistence.mjs"], agents: "record only", permissions: "PAID needs external evidence + confirmedReceived", tests: ["financial-ledger*.test.mjs"] },
    RUNTIME_SUPERVISOR: { title: "Runtime Supervisor (separate process)", implementation: ["atlasz-runtime/supervisor-safe.mjs", "atlasz-runtime/supervisor.js"], agents: "runtime screening pipeline", permissions: "own process", tests: ["runtime supervisor tests"] },
    TASK_SCHEDULER: { title: "Task Scheduler", implementation: ["atlasz-addons/scheduler.mjs"], agents: "none", permissions: "registered typed tools only; external effects stop at AWAITING_APPROVAL", tests: ["scheduler*.test.mjs"] },
    QUALITY_ASSURANCE: { title: "Quality Assurance and Independent Checker", implementation: ["atlasz-addons/agent-coordination.mjs (assignVerifier)", "atlasz-addons/agent-workforce.mjs (checkTask)"], agents: "independent SEARCH/EXECUTION checker", permissions: "recompute + compare; maker never checks own work", tests: ["agent-workforce.test.mjs"] },
    RECOVERY_MAINTENANCE: { title: "Recovery and Maintenance Manager", implementation: ["atlasz-addons/backup-recovery.mjs", "atlasz-addons/recovery.mjs"], agents: "none", permissions: "restore into non-empty target needs owner approval", tests: ["backup-recovery*.test.mjs"] }
  };
  async function managers() {
    const wfv = workforce.systemView(), agents = workforce.agentViews();
    const builtin = {
      MASTER_COORDINATOR: async () => { const a = workforce.coordinator.auditVerify(), m = audit.verify(), lp = loopStatus ? loopStatus() : null, bad = lp && ["ESCALATED"].includes(lp.state); return { ok: a.ok && m.ok && !damaged && !bad, detail: "coordination audit " + a.ok + ", master audit " + m.ok + (damaged ? ", " + damaged : "") + (lp ? ", loop " + lp.state : ", no loop attached"), data: { supervisions: S.supervisions, lastSupervisedAt: S.lastReport?.at ?? null, loop: lp, liveness: liveness() } }; },
      WORKFORCE_MANAGER: async () => { const r = workforce.registry.verify(); return { ok: r.ok && agents.length === 30, detail: "registry integrity " + r.ok + ", agents " + agents.length, data: workforce.registry.summary() }; },
      SEARCH_AGENT_MANAGER: async () => { const a = agents.filter(x => x.team === "SEARCH"); return { ok: a.length === 5, detail: a.length + " SEARCH agents", data: { states: countBy(a, "state") } }; },
      EXECUTION_AGENT_MANAGER: async () => { const a = agents.filter(x => x.team === "EXECUTION"); return { ok: a.length === 25, detail: a.length + " EXECUTION agents", data: { states: countBy(a, "state") } }; },
      QUALITY_ASSURANCE: async () => ({ ok: wfv.integrity.coordination === true, detail: "independent verifier assignment via coordinator; " + wfv.makerChecker.length + " check record(s)", data: { checks: wfv.makerChecker.length } }),
      FINANCIAL_REVENUE_MANAGER: async () => ({ ok: wfv.integrity.ledger !== false, detail: "ledger chain " + wfv.integrity.ledger, data: { verifiedReceivedUsd: wfv.verifiedRevenue.verifiedReceivedUsd } })
    };
    const out = [];
    for (const id of MANAGER_IDS) {
      const d = DESCR[id], fn = probes[id] ?? builtin[id], p = await probe(fn);
      const missing = []; if (!p.ok) missing.push(typeof fn === "function" ? "HEALTH_PROBE_FAILED:" + p.detail : "NOT_WIRED_INTO_THE_MASTER");
      out.push({ id, ...d, connectedToMaster: p.ok, status: p.ok ? "CONNECTED" : typeof fn === "function" ? "DEGRADED" : "NOT_CONNECTED", health: p.detail, data: p.data, missingDependencies: missing });
    }
    return out;
  }
  const countBy = (arr, k) => arr.reduce((o, x) => (o[x[k]] = (o[x[k]] ?? 0) + 1, o), {});
  // ============================================================ supervision tick
  async function supervise({ autoRecover = true } = {}) {
    if (damaged) return R(damaged); const t0 = clock(), findings = [], actions = []; const add = (severity, code, subject, detail = null) => { if (findings.length < L.maxFindings) findings.push({ severity, code, subject, detail }); };
    const ts = tasks(), agents = workforce.agentViews(), isStop = stopped();
    if (isStop) add("INFO", "OWNER_STOP_OR_SAFE_MODE_ACTIVE", "workforce", "All mutation is frozen; running work is interrupted at the next attempt boundary.");
    // stalled / overloaded / conflicts
    for (const t of ts.filter(x => x.status === "RUNNING")) { const age = clock() - Date.parse(t.updatedAt); if (age > L.stallMs) { add("WARN", "STALLED_RUNNING_TASK", t.taskId, { agentId: t.agentId, ageMs: age }); if (autoRecover && !isStop) { const r = workforce.suspendTask(t.taskId, { reason: "STALLED", masterToken: token }); actions.push({ action: "SUSPEND_REQUESTED", taskId: t.taskId, ok: r.ok }); log("STALL_ACTION", { taskId: t.taskId, ok: r.ok }); } } }
    const open = {}; for (const t of ts.filter(live)) open[t.agentId] = (open[t.agentId] ?? 0) + 1;
    for (const a of agents) { const lim = workforce.registry.get(a.id)?.limits.maxOpenTasks ?? 1; if ((open[a.id] ?? 0) >= lim) add("WARN", "AGENT_AT_CAPACITY", a.id, { open: open[a.id], limit: lim }); if (a.blocker?.code === "PAUSED") add("INFO", "AGENT_PAUSED_BY_OWNER", a.id); if (a.state === "BLOCKED_OR_FAILED") add("WARN", "AGENT_BLOCKED_OR_FAILED", a.id, a.blocker); }
    const seen = new Map(); for (const t of ts.filter(x => x.workflow === "C" && live(x) && x.authz?.stepId)) { const k = t.opportunityId + "|" + t.authz.stepId; if (seen.has(k)) add("ERROR", "CONFLICTING_ASSIGNMENTS", k, [seen.get(k), t.taskId]); else seen.set(k, t.taskId); }
    // interrupted work: resume (PLAN_STEP origin only) within bounds, otherwise hand to the owner
    for (const t of ts.filter(x => x.status === "INTERRUPTED")) {
      if (t.authz?.type !== "PLAN_STEP") { add("INFO", "INTERRUPTED_OWNER_DIRECTED_TASK_NEEDS_OWNER", t.taskId); continue; }
      const tries = (S.jobs && Object.values(S.jobs).find(j => j.taskId === t.taskId)?.autoResumes) ?? 0;
      if (autoRecover && !isStop && tries < L.autoResumeMax) { const j = Object.values(S.jobs).find(x => x.taskId === t.taskId); if (j) { j.autoResumes = tries + 1; save(); } const r = await workforce.resumeTask(t.taskId); actions.push({ action: "RESUME_INTERRUPTED", taskId: t.taskId, ok: r.ok === true, result: r.ok ? r.status : r.reason }); log("AUTO_RESUME", { taskId: t.taskId, ok: r.ok === true, result: r.ok ? r.status : r.reason }); }
      else add("WARN", "INTERRUPTED_TASK_NOT_AUTO_RESUMED", t.taskId, { tries });
    }
    if (autoRecover && !isStop) { const rc = workforce.coordinator.reclaimStalled({ olderThanMs: L.stallMs * 4 }); if (rc.ok && (rc.reassigned.length || rc.abandoned.length || rc.rescinded.length)) { actions.push({ action: "COORDINATOR_RECLAIM", ...rc }); add("INFO", "COORDINATOR_RECLAIMED_STALLED_WORK", "coordinator", rc); log("RECLAIM", { reassigned: rc.reassigned.length, abandoned: rc.abandoned.length, rescinded: rc.rescinded.length }); } }
    if (!isStop) { const v = await verifyPending(); if (v.ok && v.checked.length) actions.push({ action: "INDEPENDENT_CHECKS", n: v.checked.length }); const d = await dispatch({ max: 5 }); if (d.ok && d.dispatched?.length) actions.push({ action: "DISPATCHED", n: d.dispatched.length }); if (d.held) add("WARN", "DISPATCH_HELD", "spend-guard", d.held); }
    // deadlines (only real, evidence-backed opportunities)
    const sys = workforce.systemView();
    for (const o of sys.pipeline) { const dl = o.discovery?.deadline; if (!dl || o.retrieval === "FIXTURE") continue; const days = (Date.parse(dl) - clock()) / 864e5, early = !["PROPOSED", "CONTRACTED", "IN_PROGRESS", "QUALITY_CHECKED", "DELIVERED", "PAYMENT_PENDING", "PAID"].includes(o.lifecycle); if (days < 0 && early) add("WARN", "DEADLINE_PASSED", o.id, { deadline: dl, lifecycle: o.lifecycle }); else if (days <= L.deadlineWarnDays && early) add("WARN", "DEADLINE_NEAR", o.id, { deadline: dl, daysLeft: +days.toFixed(1), lifecycle: o.lifecycle }); }
    // providers and spend
    let modelInfo = { state: "NOT_CONNECTED" };
    if (typeof models === "function") { try { const v = await models(); if (v?.state === "CONNECTED") { const down = (v.providerLadder ?? []).filter(p => p.credentialsConfigured && !p.authenticatedLiveTestPassed); const alt = (v.models ?? []).filter(m => m.usable).map(m => m.id); modelInfo = { state: "CONNECTED", liveModels: alt.length, providersWithCredentialsButNoLiveProof: down.map(p => p.id), usage: v.usage ?? null }; for (const p of down) add("WARN", "PROVIDER_NOT_LIVE", p.id, { approvedAlternatives: alt.slice(0, 5) }); if (!alt.length) add("INFO", "NO_LIVE_MODEL", "models", "Agents run local executors only; nothing is LIVE until a gateway probe passes."); if (v.usage?.cap?.valid === false) add("ERROR", "SPEND_CAP_INVALID", "models", v.usage.cap.reason); } else modelInfo = { state: "ERROR" }; } catch { modelInfo = { state: "ERROR" }; } }
    let pending = null; try { pending = approvalsPending ? approvalsPending() : null; } catch { pending = null; } if (Number.isFinite(pending) && pending > 0) add("INFO", "OWNER_APPROVALS_PENDING", "approvals", { count: pending });
    // integrity of every chain
    const integ = { events: sys.integrity.events, registry: sys.integrity.registry, coordination: sys.integrity.coordination, ledger: sys.integrity.ledger, master: audit.verify().ok }; for (const [k, v] of Object.entries(integ)) if (v === false) add("ERROR", "INTEGRITY_FAILURE", k);
    const simulated = ts.filter(t => t.provenance === "SIMULATED").length, real = ts.filter(t => t.status === "VERIFIED" && t.provenance !== "SIMULATED").length;
    const report = { at: now(), tookMs: clock() - t0, stopped: isStop, tasks: { total: ts.length, running: ts.filter(t => t.status === "RUNNING").length, awaitingCheck: ts.filter(t => t.status === "SUBMITTED").length, suspended: ts.filter(t => t.status === "SUSPENDED").length, interrupted: ts.filter(t => t.status === "INTERRUPTED").length, deadLetter: ts.filter(t => t.status === "DEAD_LETTER").length, verifiedReal: real, simulated }, queue: countBy(Object.values(S.jobs), "state"), models: modelInfo, integrity: integ, findings, actions };
    S.lastReport = report; S.supervisions++; save(); beat({ phase: "SUPERVISED", findings: findings.length }); log("SUPERVISED", { findings: findings.length, actions: actions.length, tasks: report.tasks.total, stopped: isStop }); return { ok: true, ...report };
  }
  // ============================================================ campaign bridge
  // A campaign organises an approved workflow in the SAME coordinator ledger: its tasks mirror the plan's work steps, owners are permanent agents, the budget is tokens + time only (never money).
  // A campaign task becomes DONE only after the coordinator's independent verifier ACCEPTs in the ledger; the Master's mechanical verification compares the claimed hash with the workforce task
  // that was ALREADY independently checked (so the two layers agree on one artifact hash). Starting needs no owner signature because no files are touched; sending anything stays gated in the plan.
  const campaignIdOf = planId => "c-" + sha(planId).slice(0, 12);
  function planCampaign({ planId, tokens = 200_000, timeMs = 14 * 86_400_000 } = {}) {
    if (!campaigns) return R("CAMPAIGN_MANAGER_NOT_CONNECTED"); if (damaged) return R(damaged); if (stopped()) return R("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    const steps = (workforce.planSteps?.(planId) ?? []).filter(x => x.executor && !x.requiresOwnerApproval); if (!steps.length) return R("PLAN_HAS_NO_WORK_STEPS_OR_UNKNOWN_PLAN");
    const id = campaignIdOf(planId); if ((S.campaigns ??= {})[planId]) return R("CAMPAIGN_ALREADY_PLANNED", { campaignId: S.campaigns[planId].campaignId });
    const taken = [], owners = {}; for (const st of steps) { const ag = workforce.selectAgent("EXECUTION", { skill: st.skill, exclude: taken }) ?? workforce.selectAgent("EXECUTION", { skill: st.skill }); if (!ag) return R("NO_AVAILABLE_EXECUTION_AGENT:" + st.id); taken.push(ag); owners[st.id] = ag; }
    const ids = new Set(steps.map(x => x.id)), tasks = steps.map(st => ({ id: st.id.toLowerCase(), kind: "execute." + st.executor, owner: owners[st.id], payload: { planId, stepId: st.id }, dependsOn: (st.dependsOn ?? []).filter(x => ids.has(x)).map(x => x.toLowerCase()) }));
    const r = campaigns.create({ id, goal: "Prepare owner-reviewable work for plan " + planId + " (drafts only; nothing is sent)", milestones: [{ id: "m1", title: "Prepare and independently verify the plan's work steps", tasks }], files: [], budget: { tokens, timeMs } }); if (!r.ok) return r;
    const st = campaigns.start(id); if (!st.ok) return st; S.campaigns[planId] = { campaignId: id, owners, at: now() }; save(); log("CAMPAIGN_PLANNED", { planId, campaignId: id, tasks: tasks.length }); return { ok: true, campaignId: id, owners, dispatched: st.dispatched };
  }
  /** Claim + verify finished work in the campaign ledger, then refresh the campaign. Never marks anything done by itself: DONE comes from the ledger. */
  async function syncCampaign(planId) {
    if (!campaigns) return R("CAMPAIGN_MANAGER_NOT_CONNECTED"); const link = S.campaigns?.[planId]; if (!link) return R("NO_CAMPAIGN_FOR_PLAN"); if (stopped()) return R("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    const co = workforce.coordinator, cid = link.campaignId, acts = [];
    for (const j of Object.values(S.jobs).filter(x => x.planId === planId && x.state === "VERIFIED" && x.taskId)) {
      const wt = taskById(j.taskId); if (!wt || wt.status !== "VERIFIED" || !wt.resultSha256) continue; const tid = j.stepId.toLowerCase(), owner = link.owners[j.stepId]; if (wt.agentId !== owner) { acts.push({ step: j.stepId, skipped: "EXECUTED_BY_A_DIFFERENT_AGENT_THAN_THE_CAMPAIGN_OWNER" }); continue; }
      const view = campaigns.view?.(cid); const ct = view?.campaign?.progress?.tasks?.find(x => x.id === tid); if (!ct || ct.status === "DONE" || ct.status === "VERIFYING") continue;
      if (ct.status === "ASSIGNED") { const st0 = co.connect(owner).start(cid + "." + tid); if (!st0.ok) { acts.push({ step: j.stepId, start: st0.reason }); continue; } }
      const claim = campaigns.claimDone(cid, tid, co.connect(owner), wt.resultSha256); acts.push({ step: j.stepId, claim: claim.ok ? "SUBMITTED" : claim.reason });
      if (claim.ok && claim.verifier) { const vr = co.connect(claim.verifier).verify(cid + "." + tid, { decision: "ACCEPT", resultSha256: wt.resultSha256 }); acts.push({ step: j.stepId, verifier: claim.verifier, verified: vr.ok ? vr.status : vr.reason }); log("CAMPAIGN_TASK_VERIFIED", { campaignId: cid, task: tid, verifier: claim.verifier, ok: vr.ok === true }); }
    }
    const s = campaigns.sync(cid); return { ok: true, campaignId: cid, status: s.status, progress: s.progress, actions: acts };
  }
  function hierarchy() { return { owner: "OWNER (signatures: host approvals, spend caps, plan gates, enabling paid models)", master: "MASTER COORDINATOR = agent-coordination.mjs + master-coordinator.mjs (one coordinator)", managementLayer: MANAGER_IDS.filter(i => i !== "MASTER_COORDINATOR"), agents: { search: 5, execution: 25, permanent: 30, temporarySubagents: "bounded, only through the coordinator, never counted" }, below: "VERIFICATION, EVIDENCE, MEMORY, RESULTS" }; }
  async function status() { return { ok: true, controlChain: typeof controlGuard === "function" ? "ATTACHED" : "NOT_ATTACHED", started: S.startedAt, damaged, supervisions: S.supervisions, stopped: stopped(), queue: Object.values(S.jobs).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 60), lastReport: S.lastReport, hierarchy: hierarchy(), managers: await managers(), audit: audit.verify(), recovered }; }
  return { recordEvent: (type, data = {}) => log("LOOP_" + String(type).replace(/[^A-Z_]/g, "").slice(0, 30), data), liveness, close, instanceId, planCampaign, syncCampaign, enqueue, dispatch, verifyPending, supervise, suspend, resume, reassign, cancel, prioritize, selectModel, managers, status, hierarchy, jobs: () => Object.values(S.jobs).map(j => ({ ...j })), verify: () => ({ ok: audit.verify().ok && !damaged, audit: audit.verify(), damaged }), auditEntries: () => audit.entries() };
}
