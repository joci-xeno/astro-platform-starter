// Owner-facing 30-agent workforce (Phase 5). Hosts the registry + workforce inside the Control Center process (single writer for the coordinator and the task store).
// Honest by construction: every number is read from the task store / coordinator / ledgers; an agent is WORKING only while one of its own tasks is RUNNING; nothing is sent, spent or signed here.
// Mutations: pause/resume (owner click), limit changes (raises of cost limits need a signed AGENT_LIMITS_RAISE bound to the exact limits), and the workflow actions below. Owner-directed work is only accepted from this panel.
import path from "node:path";
import { createAgentRegistry, limitsSubject } from "../atlasz-addons/agent-registry.mjs";
import { createWorkforce } from "../atlasz-addons/agent-workforce.mjs";

export function createAgentsPanel({ stateDir, ownerAuth, sign, isStopped = () => false, approvals = null, memory = null, models = null } = {}) {
  const dir = path.join(stateDir, "workforce");
  const auth = { verifyApproval: (...a) => { try { return ownerAuth().verifyApproval(...a); } catch { return { allowed: false, reason: "NO_OWNER_KEY" }; } } };
  let wf = null, openError = null;
  const open = () => {
    if (wf) return wf;
    try { const registry = createAgentRegistry({ dir: path.join(dir, "registry"), ownerAuth: auth, isStopped }); wf = createWorkforce({ dir, registry, approvals, memory: memory?.() ?? null, models, isStopped }); openError = null; }
    catch (e) { openError = String(e?.message ?? e).slice(0, 120); wf = null; }
    return wf;
  };
  const need = (v, w) => { if (typeof v !== "string" || !v) throw new Error(w + "_REQUIRED"); return v; };
  function view() {
    const w = open(); if (!w) return { state: "ERROR", error: openError ?? "WORKFORCE_UNAVAILABLE" };
    const sys = w.systemView(), agents = w.agentViews(), reg = w.registry.summary();
    return { state: "CONNECTED", registry: reg, agents, system: sys, stopped: Boolean(isStopped()),
      memoryGateway: memory ? "CONNECTED" : "NOT_CONNECTED", modelGateway: models ? "CONNECTED_NO_PAID_USAGE" : "NOT_CONNECTED",
      dependencies: [
        { name: "Neural embedding model", state: "BLOCKED", note: "Stays BLOCKED until the owner approves and a local model is operational; agent memory is lexical only." },
        { name: "Cloud model providers", state: "UNAVAILABLE_WITHOUT_CREDENTIALS", note: "No cloud provider has been contacted. Agents keep working with local executors." },
        { name: "Runtime supervisor agents", state: "NOT_CONNECTED", note: "The runtime's own screening pipeline is unchanged; connecting it to this workforce is a recorded next dependency." },
        { name: "Campaign Manager / Global Business Intelligence", state: "NOT_CONNECTED", note: "Opportunity records are entered by the owner or from the Document Center; no external discovery runs." }],
      note: "Estimated opportunity values are never revenue. Verified revenue comes only from the ledger (PAID with external evidence). Simulated results are listed separately." };
  }
  async function action(a) {
    const w = open(); if (!w) return { ok: false, reason: "WORKFORCE_UNAVAILABLE", detail: openError };
    switch (a.op) {
      case "pause": return w.registry.setPaused(need(a.agentId, "AGENT_ID"), true, String(a.reason ?? "owner pause").slice(0, 80));
      case "resume": return w.registry.setPaused(need(a.agentId, "AGENT_ID"), false);
      case "setLimits": {
        const id = need(a.agentId, "AGENT_ID"), patch = a.limits ?? {}, cur = w.registry.get(id); if (!cur) return { ok: false, reason: "NOT_ONE_OF_THE_30_PERMANENT_AGENTS" };
        const next = { ...cur.limits, ...patch }, doc = a.passphrase ? sign(a.passphrase, "AGENT_LIMITS_RAISE", limitsSubject(id, next)) : null;
        return w.registry.setLimits(id, patch, { ownerApproval: doc });
      }
      case "discover": return w.discoverOpportunity(need(a.agentId, "AGENT_ID"), a.input);
      case "plan": return await w.planOpportunity(need(a.opportunityId, "OPPORTUNITY_ID"));
      case "execute": return await w.executeTask(need(a.agentId, "AGENT_ID"), { executor: a.executor, input: a.input, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" });
      case "executeStep": return await w.executeTask(need(a.agentId, "AGENT_ID"), { executor: a.executor, input: a.input, authorization: { type: "PLAN_STEP", planId: a.planId, stepId: a.stepId }, via: "OWNER_PANEL" });
      case "check": return await w.checkTask(need(a.taskId, "TASK_ID"));
      case "rework": return await w.reworkTask(need(a.taskId, "TASK_ID"));
      case "resumeTask": return await w.resumeTask(need(a.taskId, "TASK_ID"));
      case "outcome": return w.recordOutcome(need(a.taskId, "TASK_ID"), { expenses: a.expenses ?? [], revenue: a.revenue ?? null });
      case "task": return { ok: true, task: w.getTask(need(a.taskId, "TASK_ID")) };
      case "verify": return { ok: true, ...w.verify() };
      default: throw new Error("UNKNOWN_AGENTS_OP");
    }
  }
  return { view, action, workforce: open };
}
