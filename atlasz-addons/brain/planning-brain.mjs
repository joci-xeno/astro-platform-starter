// Planning Brain (V7.3 Brain §3): GOAL -> PROJECT -> MILESTONES -> TASKS -> SUBTASKS, dependency graph, approval points, cost estimate, failure policy.
// Durable (atomic JSON) and resumable. It PLANS only: it never authorizes spending and never marks a task DONE without an accepting verification.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const FAILURE_ACTIONS = Object.freeze(["RETRY", "REPLAN", "CHANGE_AGENT", "CHANGE_MODEL", "CHANGE_TOOL", "USE_FALLBACK", "ESCALATE", "ASK_JOCI", "STOP_SAFELY"]);
export const TASK_STATES = Object.freeze(["PENDING", "RUNNING", "DONE", "FAILED", "BLOCKED", "CANCELLED"]);

export function createPlanningBrain({ file = null, now = () => new Date().toISOString(), maxRetries = 2 } = {}) {
  let plans = {};
  if (file && fs.existsSync(file)) { try { plans = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("PLAN_STORE_UNREADABLE"); } }
  const save = () => { if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); const t = file + ".tmp"; fs.writeFileSync(t, JSON.stringify(plans)); fs.renameSync(t, file); };

  function flatten(spec) {
    const tasks = [];
    for (const [pi, pr] of (spec.projects ?? []).entries()) for (const [mi, ms] of (pr.milestones ?? []).entries()) for (const t of ms.tasks ?? []) {
      tasks.push({ ...t, project: pr.name ?? "P" + pi, milestone: ms.name ?? "M" + mi, dependsOn: t.dependsOn ?? [], capabilities: t.capabilities ?? [], subtasks: (t.subtasks ?? []).map((s, i) => ({ id: t.id + "." + (i + 1), title: s.title ?? String(s), status: "PENDING" })) });
    }
    return tasks;
  }
  function topo(tasks) {
    const byId = new Map(tasks.map(t => [t.id, t])), indeg = new Map(tasks.map(t => [t.id, 0])), out = new Map(tasks.map(t => [t.id, []]));
    for (const t of tasks) for (const d of t.dependsOn) { if (!byId.has(d)) throw new Error("UNKNOWN_DEPENDENCY:" + t.id + "->" + d); indeg.set(t.id, indeg.get(t.id) + 1); out.get(d).push(t.id); }
    const order = [], ready = tasks.filter(t => indeg.get(t.id) === 0);
    const pri = t => -(Number(t.priority ?? 0)) ;
    while (ready.length) {
      ready.sort((a, b) => pri(a) - pri(b) || a.id.localeCompare(b.id)); const t = ready.shift(); order.push(t.id);
      for (const n of out.get(t.id)) { indeg.set(n, indeg.get(n) - 1); if (indeg.get(n) === 0) ready.push(byId.get(n)); }
    }
    if (order.length !== tasks.length) throw new Error("DEPENDENCY_CYCLE");
    return order;
  }
  function analyze(tasks) {
    const approvalPoints = tasks.filter(t => t.external === true || Number(t.estCostUsd ?? 0) > 0 || t.requiresApproval === true)
      .map(t => ({ taskId: t.id, reasons: [t.external === true && "EXTERNAL_ACTION", Number(t.estCostUsd ?? 0) > 0 && "SPEND", t.requiresApproval === true && "FLAGGED"].filter(Boolean) }));
    const known = tasks.filter(t => Number.isFinite(Number(t.estCostUsd)));
    return { approvalPoints, estCost: { knownUsd: known.reduce((s, t) => s + Number(t.estCostUsd), 0), unknownTasks: tasks.length - known.length, authorized: false, note: "Estimate only. The Planning Brain cannot authorize spend." },
      risk: { max: Math.max(0, ...tasks.map(t => Number(t.risk ?? 0))), highRiskTasks: tasks.filter(t => Number(t.risk ?? 0) >= 2).map(t => t.id) } };
  }
  function createPlan(spec = {}) {
    if (!spec.goal) throw new Error("GOAL_REQUIRED");
    const tasks = flatten(spec), ids = new Set();
    if (!tasks.length) throw new Error("NO_TASKS");
    for (const t of tasks) { if (!t.id || ids.has(t.id)) throw new Error("TASK_ID_MISSING_OR_DUPLICATE:" + t.id); ids.add(t.id); }
    const order = topo(tasks);
    const id = "plan-" + crypto.randomUUID().slice(0, 8);
    plans[id] = { id, goal: spec.goal, createdAt: now(), status: "ACTIVE", order, tasks: Object.fromEntries(tasks.map(t => [t.id, { ...t, status: "PENDING", attempts: 0, verification: null, result: null }])), history: [], ...analyze(tasks), version: 1 };
    save(); return structuredClone(plans[id]);
  }
  const P = id => { const p = plans[id]; if (!p) throw new Error("UNKNOWN_PLAN"); return p; };
  const T = (p, id) => { const t = p.tasks[id]; if (!t) throw new Error("UNKNOWN_TASK"); return t; };
  function nextTasks(planId) {
    const p = P(planId); if (p.status !== "ACTIVE") return [];
    return p.order.map(i => p.tasks[i]).filter(t => t.status === "PENDING" && t.dependsOn.every(d => p.tasks[d]?.status === "DONE")).map(t => structuredClone(t));
  }
  function markTask(planId, taskId, status, { result = null, verification = null } = {}) {
    const p = P(planId), t = T(p, taskId);
    if (!TASK_STATES.includes(status)) throw new Error("BAD_STATUS");
    if (status === "DONE" && !(verification && verification.verdict === "ACCEPT" && verification.independent === true)) throw new Error("DONE_REQUIRES_INDEPENDENT_ACCEPT");
    if (status === "RUNNING" && !t.dependsOn.every(d => p.tasks[d]?.status === "DONE")) throw new Error("DEPENDENCIES_NOT_DONE");
    if (status === "RUNNING") t.attempts++;
    t.status = status; if (result !== null) t.result = result; if (verification) t.verification = verification;
    p.history.push({ at: now(), taskId, status });
    if (Object.values(p.tasks).every(x => x.status === "DONE" || x.status === "CANCELLED")) p.status = "COMPLETE";
    save(); return structuredClone(t);
  }
  /** failure: {kind, detail?}; alt: {agents?:[], models?:[], tools?:[], fallback?:bool}. Returns {action, reason}; recorded in plan history. */
  function decideOnFailure(planId, taskId, failure = {}, alt = {}) {
    const p = P(planId), t = T(p, taskId), k = String(failure.kind ?? "UNKNOWN").toUpperCase(), n = t.attempts;
    let action, reason;
    if (["OWNER_STOP", "SAFE_MODE", "SECURITY_BLOCK", "KILL_SWITCH"].includes(k)) { action = "STOP_SAFELY"; reason = "Safety control active; no retry, no workaround."; }
    else if (["APPROVAL_REQUIRED", "APPROVAL_DENIED", "SPEND_REQUIRED"].includes(k)) { action = "ASK_JOCI"; reason = "Owner decision needed."; }
    else if (k === "TRANSIENT" || k === "TIMEOUT") { action = n <= maxRetries ? "RETRY" : alt.fallback ? "USE_FALLBACK" : "ESCALATE"; reason = "attempt " + n; }
    else if (k === "AGENT_FAILURE") { action = alt.agents?.length ? "CHANGE_AGENT" : "ESCALATE"; reason = alt.agents?.length ? "alternative agent available" : "no alternative agent"; }
    else if (k === "MODEL_FAILURE") { action = alt.models?.length ? "CHANGE_MODEL" : alt.fallback ? "USE_FALLBACK" : "ESCALATE"; reason = "model failed"; }
    else if (k === "TOOL_FAILURE") { action = alt.tools?.length ? "CHANGE_TOOL" : alt.fallback ? "USE_FALLBACK" : "ESCALATE"; reason = "tool failed"; }
    else if (k === "VERIFICATION_REJECTED") { action = n <= 1 ? "RETRY" : "REPLAN"; reason = "rejected by independent verifier"; }
    else if (["DEPENDENCY_FAILED", "PLAN_INVALID", "REQUIREMENTS_CHANGED"].includes(k)) { action = "REPLAN"; reason = k; }
    else { action = "ESCALATE"; reason = "unclassified failure"; }
    if (action === "ESCALATE" && n > maxRetries + 1) { action = "ASK_JOCI"; reason += "; escalation exhausted"; }
    t.status = action === "RETRY" || action === "CHANGE_AGENT" || action === "CHANGE_MODEL" || action === "CHANGE_TOOL" || action === "USE_FALLBACK" ? "PENDING" : action === "STOP_SAFELY" ? "BLOCKED" : "FAILED";
    p.history.push({ at: now(), taskId, failure: k, action, reason }); save();
    return { action, reason, taskStatus: t.status };
  }
  /** Replan keeps DONE work, cancels removed tasks, adds new ones; dependencies and cycles are revalidated. Never auto-approves anything. */
  function replan(planId, { cancel = [], add = [] } = {}) {
    const p = P(planId), draft = structuredClone(p);
    for (const id of cancel) { const t = T(draft, id); if (t.status === "DONE") throw new Error("CANNOT_CANCEL_DONE_TASK"); t.status = "CANCELLED"; }
    for (const t of flatten({ projects: [{ name: "replan", milestones: [{ name: "r" + (p.version + 1), tasks: add }] }] })) { if (draft.tasks[t.id]) throw new Error("DUPLICATE_TASK:" + t.id); draft.tasks[t.id] = { ...t, status: "PENDING", attempts: 0, verification: null, result: null }; }
    const live = Object.values(draft.tasks).filter(t => t.status !== "CANCELLED");
    for (const t of live) for (const d of t.dependsOn) if (draft.tasks[d]?.status === "CANCELLED") throw new Error("DEPENDS_ON_CANCELLED:" + t.id + "->" + d);
    draft.order = topo(live); Object.assign(draft, analyze(live)); draft.version++; draft.status = "ACTIVE"; draft.history.push({ at: now(), replan: { cancel, add: add.map(a => a.id) } });
    plans[planId] = draft; save(); return structuredClone(draft);
  }
  function progress(planId) {
    const p = P(planId), l = Object.values(p.tasks), c = s => l.filter(t => t.status === s).length;
    return { planId, status: p.status, total: l.length, done: c("DONE"), failed: c("FAILED"), blocked: c("BLOCKED"), pending: c("PENDING"), running: c("RUNNING"), percent: l.length ? Math.round((100 * c("DONE")) / l.filter(t => t.status !== "CANCELLED").length || 0) : 0 };
  }
  return { createPlan, nextTasks, markTask, decideOnFailure, replan, progress, get: id => structuredClone(P(id)), list: () => Object.values(plans).map(p => ({ id: p.id, goal: p.goal, status: p.status })) };
}
