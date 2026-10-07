// Governed dispatch (V7.3 Joci package §1,3,5,6,7): the ONE route from an accepted opportunity/candidate to an EXECUTION agent.
//   JOB (durable, idempotent) > PLANNING BRAIN (plan+task) > CAPABILITY GRAPH (assignment) > ORCHESTRATOR (governance gate, execute, independent verify, black box)
//   > failure classification > retry (limit + backoff) / alternative agent / replan (limit) / escalate.
// It is subordinate to the control chain: the orchestrator's governance consults owner authority, kill switch, safe mode, security and the financial firewall,
// and nothing here can mark a task DONE without an independent verifier ACCEPT. It creates no agents: it only uses the roster the orchestrator was built with.
import fs from "node:fs";
import path from "node:path";

export const JOB_STATES = Object.freeze(["QUEUED", "PLANNED", "ASSIGNED", "EXECUTING", "VERIFYING", "DONE", "RETRY_WAIT", "HALTED", "WAITING_APPROVAL", "BLOCKED_SECURITY", "ESCALATED"]);
const TERMINAL = new Set(["DONE", "ESCALATED", "BLOCKED_SECURITY"]);

export function createGovernedDispatch({ file = null, planner, graph, orchestrator, blackBox = null, executionAgentIds = [], now = () => Date.now(), maxAttempts = 3, maxReplans = 1, backoff = { baseMs: 1000, maxMs: 60000 }, learn = null } = {}) {
  if (!planner || !graph || !orchestrator) throw new Error("PLANNER_GRAPH_ORCHESTRATOR_REQUIRED");
  let jobs = {};
  const active = new Set();
  if (file && fs.existsSync(file)) { try { jobs = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("JOB_STORE_UNREADABLE"); } }
  const save = () => { if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); const t = file + ".tmp"; fs.writeFileSync(t, JSON.stringify(jobs)); fs.renameSync(t, file); };
  const rec = (kind, j, p = {}) => { try { blackBox?.record({ kind, correlationId: j.correlationId, jobId: j.id, ...p }); } catch { /* observability must not stop work */ } };
  const delay = n => Math.min(backoff.maxMs, backoff.baseMs * 2 ** Math.max(0, n - 1));
  const cp = (j, name, data = {}) => { j.checkpoints.push({ at: now(), name, ...data }); j.state = j.state; save(); };

  /** Idempotent: the same id never creates a second job, and a DONE job is never executed again. */
  function submit({ id, kind = "SCREENING", payload = {}, correlationId = null } = {}) {
    if (!id) throw new Error("JOB_ID_REQUIRED");
    if (jobs[id]) return { id, duplicate: true, state: jobs[id].state };
    jobs[id] = { id, kind, payload, correlationId, state: "QUEUED", attempts: 0, replans: 0, notBefore: 0, planId: null, taskId: null, assignments: [], checkpoints: [{ at: now(), name: "SUBMITTED" }], lastFailure: null, verification: null, createdAt: now() };
    save(); return { id, duplicate: false, state: "QUEUED" };
  }
  const get = id => (jobs[id] ? structuredClone(jobs[id]) : null);
  /** After a restart: nothing in flight survives silently. Work that was PLANNED/ASSIGNED/EXECUTING/VERIFYING goes back to QUEUED with attempts preserved. */
  function resumeAll() {
    const resumed = [];
    for (const j of Object.values(jobs)) if (["PLANNED", "ASSIGNED", "EXECUTING", "VERIFYING"].includes(j.state)) {
      if (j.taskId && j.planId) { try { const t = planner.get(j.planId).tasks[j.taskId]; if (t?.status === "RUNNING") planner.markTask(j.planId, j.taskId, "FAILED"); if (planner.get(j.planId).tasks[j.taskId]?.status === "FAILED") planner.decideOnFailure(j.planId, j.taskId, { kind: "TRANSIENT" }); } catch { j.planId = null; j.taskId = null; } }
      j.state = "QUEUED"; cp(j, "RESUMED_AFTER_RESTART"); rec("JOB_RESUMED", j, { decision: "QUEUED" }); resumed.push(j.id);
    }
    save(); return resumed;
  }
  /** Next job that may run now (never WAITING_APPROVAL / terminal / still backing off). HALTED jobs are retried: the gates decide again. */
  const nextDue = (t = now()) => Object.values(jobs).filter(j => ["QUEUED", "RETRY_WAIT", "HALTED"].includes(j.state) && j.notBefore <= t).sort((a, b) => a.notBefore - b.notBefore || a.createdAt - b.createdAt)[0]?.id ?? null;

  function pickAgent(j, preferred) {
    const others = executionAgentIds.filter(a => a !== preferred);
    const asked = j.payload.capabilities ?? ["screen"];
    if (preferred && j.attempts === 0) { const m = graph.match({ capabilities: asked, exclude: others }); if (m.combination.AGENT === preferred && !m.missingCapabilities.length) return { agentId: preferred, via: "GRAPH_CONFIRMED_PREFERRED" }; }
    const m = graph.match({ capabilities: asked, exclude: j.assignments.filter(a => a.failed).map(a => a.agentId) });
    return { agentId: m.combination.AGENT ?? null, via: "GRAPH_BEST_MATCH", missing: m.missingCapabilities };
  }

  async function run(id, opts = {}) {
    if (!jobs[id]) throw new Error("UNKNOWN_JOB");
    if (active.has(id)) return { status: "IN_PROGRESS", job: get(id) };
    active.add(id);
    try { return await runInner(id, opts); } finally { active.delete(id); }
  }
  async function runInner(id, { preferredAgentId = null, ownerApproval = null } = {}) {
    const j = jobs[id];
    if (j.state === "DONE") return { status: "ALREADY_DONE", job: get(id) };            // idempotency: no second consequential execution
    if (TERMINAL.has(j.state)) return { status: j.state, job: get(id) };
    if (j.state === "WAITING_APPROVAL" && !ownerApproval) return { status: "WAITING_APPROVAL", job: get(id) };
    if (j.notBefore > now()) return { status: "BACKOFF", retryAt: j.notBefore, job: get(id) };
    if (j.attempts >= maxAttempts) { j.state = "ESCALATED"; cp(j, "RETRY_LIMIT_REACHED"); rec("JOB_ESCALATED", j, { decision: "ESCALATE", reason: "RETRY_LIMIT" }); return { status: "ESCALATED", job: get(id) }; }
    // A HALTED job's plan task was parked BLOCKED (STOP_SAFELY); the gates decide again, so unblock it before re-running
    if (j.state === "HALTED" && j.planId) { try { planner.resume(j.planId, j.taskId); } catch { /* not blocked */ } }
    // PLAN
    if (!j.planId) {
      const p = planner.createPlan({ goal: j.kind + " " + id, projects: [{ name: j.kind, milestones: [{ name: "m1", tasks: [{ id: "t1", title: j.kind + " " + id, capabilities: j.payload.capabilities ?? ["screen"], risk: 0, jobRef: id, ...(j.payload.task ?? {}) }] }] }] });
      j.planId = p.id; j.taskId = "t1"; j.state = "PLANNED"; cp(j, "PLANNED", { planId: p.id }); rec("JOB_PLANNED", j, { workflow: p.id, decision: "PLANNED" });
    }
    // ASSIGN (capability graph; the preferred worker is used only if the graph confirms it is valid)
    const a = pickAgent(j, preferredAgentId);
    if (!a.agentId) { return fail(j, { status: "NO_AGENT", decision: { action: "ESCALATE" } }); }
    j.assignments.push({ agentId: a.agentId, via: a.via, at: now(), attempt: j.attempts + 1 }); j.state = "ASSIGNED"; cp(j, "ASSIGNED", { agentId: a.agentId, via: a.via });
    rec("JOB_ASSIGNED", j, { agentId: a.agentId, workflow: j.planId, decision: a.via });
    // EXECUTE (orchestrator: governance gate, execution, independent verification, black box)
    j.state = "EXECUTING"; save();
    let r;
    try { r = await orchestrator.runTask(j.planId, j.taskId, { agentId: a.agentId, correlationId: j.correlationId ?? undefined, ownerApproval }); }
    catch (e) { r = { status: "FAILED", reason: String(e.message).slice(0, 160), decision: { action: "ESCALATE" } }; }
    if (r.status === "DONE") { j.state = "DONE"; j.verification = { verdict: r.verification?.verdict, independent: r.verification?.independent, verifierId: r.verification?.verifierId, reason: r.verification?.reason }; cp(j, "DONE", { agentId: a.agentId }); rec("JOB_DONE", j, { agentId: a.agentId, verification: "ACCEPT", decision: "DONE" }); try { learn?.({ job: get(id), outcome: "VERIFIED" }); } catch { /* learning must not fail a verified job */ } return { status: "DONE", agentId: a.agentId, job: get(id) }; }
    if (r.status === "STOPPED" && !/OWNER_STOP|SAFE_MODE|KILL_SWITCH|EMERGENCY/.test(String(r.reason))) { j.state = "ESCALATED"; cp(j, "DENIED_BY_CONTROL", { reason: r.reason }); rec("JOB_ESCALATED", j, { decision: "DENIED", reason: r.reason }); return { status: "ESCALATED", reason: r.reason, job: get(id) }; }   // permanent denial (e.g. NO-SPEND): never retried, never worked around
    if (r.status === "STOPPED") { j.state = "HALTED"; j.notBefore = now() + 250; cp(j, "HALTED", { reason: r.reason }); rec("JOB_HALTED", j, { decision: "HALTED", reason: r.reason }); return { status: "HALTED", reason: r.reason, job: get(id) }; }
    if (r.status === "WAITING_APPROVAL") { j.state = "WAITING_APPROVAL"; cp(j, "WAITING_APPROVAL", { reason: r.reason }); return { status: "WAITING_APPROVAL", reason: r.reason, job: get(id) }; }
    if (r.status === "SECURITY_BLOCKED") { j.state = "BLOCKED_SECURITY"; cp(j, "BLOCKED_SECURITY"); rec("JOB_BLOCKED", j, { decision: "BLOCK", reason: "SECURITY" }); return { status: "BLOCKED_SECURITY", job: get(id) }; }
    if (r.status === "DEFERRED" || r.status === "SKIPPED") { j.state = "QUEUED"; j.notBefore = now() + 100; save(); return { status: r.status, job: get(id) }; }
    return fail(j, r, a.agentId);
  }

  /** DETECT > CLASSIFY > RETRY POLICY > ALTERNATIVE AGENT/MODEL/TOOL/WORKFLOW (planner) > REPLAN > RETRY OR ESCALATE. Bounded by attempts, backoff and replans. */
  function fail(j, r, agentId = null) {
    j.attempts++;
    if (agentId && j.assignments.length) j.assignments[j.assignments.length - 1].failed = true;
    const action = r.decision?.action ?? "ESCALATE";
    j.lastFailure = { at: now(), status: r.status, reason: r.reason ?? r.verdict ?? null, action, attempt: j.attempts };
    rec("JOB_FAILURE", j, { agentId, error: String(r.reason ?? r.status).slice(0, 160), recovery: action, retry: j.attempts });
    if (j.attempts >= maxAttempts) { j.state = "ESCALATED"; cp(j, "ESCALATED", { reason: "RETRY_LIMIT" }); rec("JOB_ESCALATED", j, { decision: "ESCALATE", reason: "RETRY_LIMIT" }); try { learn?.({ job: get(j.id), outcome: "FAILED" }); } catch { /* ignore */ } return { status: "ESCALATED", failure: j.lastFailure, job: get(j.id) }; }
    if (["RETRY", "CHANGE_AGENT", "CHANGE_MODEL", "CHANGE_TOOL", "USE_FALLBACK"].includes(action)) { j.state = "RETRY_WAIT"; j.notBefore = now() + delay(j.attempts); cp(j, "RETRY_SCHEDULED", { action, retryAt: j.notBefore }); return { status: "RETRY_WAIT", action, retryAt: j.notBefore, job: get(j.id) }; }
    if (action === "REPLAN" && j.replans < maxReplans) {
      try {
        const nid = "t" + (j.replans + 2); const old = planner.get(j.planId).tasks[j.taskId];
        planner.replan(j.planId, { cancel: [j.taskId], add: [{ id: nid, title: old.title + " (replanned)", capabilities: old.capabilities, risk: old.risk, jobRef: j.id }] });
        j.replans++; j.taskId = nid; j.state = "RETRY_WAIT"; j.notBefore = now() + delay(j.attempts); cp(j, "REPLANNED", { newTask: nid }); rec("JOB_REPLANNED", j, { decision: "REPLAN" });
        return { status: "RETRY_WAIT", action: "REPLAN", job: get(j.id) };
      } catch (e) { /* fall through to escalation */ }
    }
    j.state = action === "STOP_SAFELY" ? "HALTED" : "ESCALATED"; if (j.state === "HALTED") j.notBefore = now() + 250;
    cp(j, j.state, { action }); rec(j.state === "ESCALATED" ? "JOB_ESCALATED" : "JOB_HALTED", j, { decision: action });
    return { status: j.state, failure: j.lastFailure, job: get(j.id) };
  }
  /** Joci released an approval-waiting job (the approval itself is verified by the orchestrator's governance, not here). */
  function release(id) { const j = jobs[id]; if (!j || j.state !== "WAITING_APPROVAL") throw new Error("JOB_NOT_WAITING"); j.state = "QUEUED"; try { planner.resume(j.planId, j.taskId); } catch { /* not blocked */ } cp(j, "RELEASED"); return get(id); }
  const summary = () => { const c = Object.fromEntries(JOB_STATES.map(s => [s, 0])); for (const j of Object.values(jobs)) c[j.state]++; return { total: Object.keys(jobs).length, byState: c }; };
  return { submit, run, get, list: () => Object.values(jobs).map(j => structuredClone(j)), nextDue, resumeAll, release, summary };
}
