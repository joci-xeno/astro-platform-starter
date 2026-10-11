// Owner-facing 30-agent workforce (Phase 5). Hosts the registry + workforce inside the Control Center process (single writer for the coordinator and the task store).
// Honest by construction: every number is read from the task store / coordinator / ledgers; an agent is WORKING only while one of its own tasks is RUNNING; nothing is sent, spent or signed here.
// Mutations: pause/resume (owner click), limit changes (raises of cost limits need a signed AGENT_LIMITS_RAISE bound to the exact limits), and the workflow actions below. Owner-directed work is only accepted from this panel.
import path from "node:path";
import { createAgentRegistry, limitsSubject } from "../atlasz-addons/agent-registry.mjs";
import { createWorkforce } from "../atlasz-addons/agent-workforce.mjs";
import { createDiscoveryEngine, toOpportunityInput } from "../atlasz-addons/global-discovery.mjs";
import { createEgressPolicy, normaliseEgressPolicy, policySubject } from "../atlasz-addons/egress-policy.mjs";
import { createPinnedTransport } from "../atlasz-addons/provider-adapters.mjs";

export function createAgentsPanel({ stateDir, ownerAuth, sign, isStopped = () => false, approvals = null, memory = null, models = null, discoveryTransport = null } = {}) {
  const dir = path.join(stateDir, "workforce");
  const auth = { verifyApproval: (...a) => { try { return ownerAuth().verifyApproval(...a); } catch { return { allowed: false, reason: "NO_OWNER_KEY" }; } }, verifyRecorded: (...a) => { try { return ownerAuth().verifyRecorded(...a); } catch { return false; } } };
  let wf = null, openError = null;
  const open = () => {
    if (wf) return wf;
    try { const registry = createAgentRegistry({ dir: path.join(dir, "registry"), ownerAuth: auth, isStopped }); wf = createWorkforce({ dir, registry, approvals, memory: memory?.() ?? null, models, isStopped, evidenceKnown: (h, r) => { try { return discovery()?.hasEvidence(h, r) === true; } catch { return false; } } }); openError = null; }
    catch (e) { openError = String(e?.message ?? e).slice(0, 120); wf = null; }
    return wf;
  };
  let eng = null, engError = null;
  const discovery = () => {
    if (eng) return eng;
    try { const egress = createEgressPolicy({ ownerAuth: auth, stateDir: path.join(dir, "discovery", "egress"), isStopped }); eng = createDiscoveryEngine({ dir: path.join(dir, "discovery"), egress, transport: discoveryTransport ?? createPinnedTransport(), isStopped }); eng._egress = egress; engError = null; }
    catch (e) { engError = String(e?.message ?? e).slice(0, 120); eng = null; }
    return eng;
  };
  const need = (v, w) => { if (typeof v !== "string" || !v) throw new Error(w + "_REQUIRED"); return v; };
  function view() {
    const w = open(); if (!w) return { state: "ERROR", error: openError ?? "WORKFORCE_UNAVAILABLE" };
    const sys = w.systemView(), agents = w.agentViews(), reg = w.registry.summary();
    const d = discovery(), dv = d ? { state: "CONNECTED", sources: d.sources(), coverage: d.coverage(), runs: d.runLog().slice(-40).reverse().map(e => ({ at: e.at, event: e.event, sourceId: e.data?.sourceId ?? null, agentId: e.data?.agentId ?? null, retrieval: e.data?.retrieval ?? null, items: e.data?.items ?? null, code: e.data?.code ?? null })), integrity: d.verify(), catalogueEvidence: d.catalogueEvidence } : { state: "ERROR", error: engError ?? "DISCOVERY_UNAVAILABLE" };
    const blockers = dv.sources ? dv.sources.filter(x => /^BLOCKED|NEEDS_OWNER|NO_ADAPTER/.test(x.state)).map(x => ({ sourceId: x.id, state: x.state, reason: x.blocker })) : [];
    return { state: "CONNECTED", discovery: dv, discoveryBlockers: blockers, registry: reg, agents, system: sys, stopped: Boolean(isStopped()),
      memoryGateway: memory ? "CONNECTED" : "NOT_CONNECTED", modelGateway: models ? "CONNECTED_NO_PAID_USAGE" : "NOT_CONNECTED",
      dependencies: [
        { name: "Neural embedding model", state: "BLOCKED", note: "Stays BLOCKED until the owner approves and a local model is operational; agent memory is lexical only." },
        { name: "Cloud model providers", state: "UNAVAILABLE_WITHOUT_CREDENTIALS", note: "No cloud provider has been contacted. Agents keep working with local executors." },
        { name: "Runtime supervisor agents", state: "NOT_CONNECTED", note: "The runtime's own screening pipeline is unchanged; connecting it to this workforce is a recorded next dependency." },
        { name: "Global discovery sources", state: dv.sources && dv.sources.some(x => x.genuinelyConnected) ? "PARTIALLY_CONNECTED" : "NOT_CONNECTED", note: "A source counts as connected only after a logged live run. Every host needs the owner's signed egress approval; the sandbox itself has no network." },
        { name: "Campaign Manager / Global Business Intelligence", state: "NOT_CONNECTED", note: "Opportunities enter via the discovery engine (owner-approved hosts or labelled operator captures) or the owner; nothing is sent externally." }],
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
      case "discoverySourceRun": {
        const d = discovery(); if (!d) return { ok: false, reason: "DISCOVERY_UNAVAILABLE", detail: engError }; const agent = need(a.agentId, "AGENT_ID");
        const r = await d.run(need(a.sourceId, "SOURCE_ID"), { url: a.url ?? null, agentId: agent }); if (!r.ok) return r;
        return { ok: true, runId: r.runId, retrieval: r.retrieval, retrieved: r.items.length, results: await w.discoverBatch(r.items, { toInput: x => toOpportunityInput(x, { retrieval: r.retrieval, runId: r.runId, evidenceSha: r.evidenceSha256 }), maxItems: a.maxItems ?? 10 }) };
      }
      case "discoveryImportCapture": {
        const d = discovery(); if (!d) return { ok: false, reason: "DISCOVERY_UNAVAILABLE", detail: engError };
        const r = d.importOperatorCapture({ sourceId: a.sourceId, items: a.items, tool: a.tool, retrievedAt: a.retrievedAt, note: a.note }); if (!r.ok) return r;
        return { ok: true, retrieval: r.retrieval, retrieved: r.items.length, results: await w.discoverBatch(r.items, { toInput: x => toOpportunityInput(x, { retrieval: r.retrieval, evidenceSha: r.evidenceSha256 }), maxItems: a.maxItems ?? 10 }) };
      }
      case "discoveryApproveHost": {
        const d = discovery(); if (!d) return { ok: false, reason: "DISCOVERY_UNAVAILABLE", detail: engError }; const pol = d.proposedPolicy(need(a.sourceId, "SOURCE_ID")); if (!pol || pol.ok === false) return pol ?? { ok: false, reason: "UNKNOWN_SOURCE" };
        const norm = normaliseEgressPolicy(pol).policy; if (!a.passphrase) return { ok: true, needsSignature: true, proposedPolicy: norm, action: "EGRESS_POLICY_SET" };
        return d._egress.setPolicy(pol, { ownerApproval: sign(a.passphrase, "EGRESS_POLICY_SET", policySubject(norm)) });
      }
      case "ownerInput": return w.supplyOwnerInput(need(a.opportunityId, "OPPORTUNITY_ID"), { requiredSkills: a.requiredSkills, note: a.note }, "OWNER_PANEL");
      case "advance": return w.advanceLifecycle(need(a.opportunityId, "OPPORTUNITY_ID"), need(a.stage, "STAGE"), { evidence: a.evidence ?? null });
      case "assignExecution": return w.assignExecution(need(a.planId, "PLAN_ID"));
      case "discover": return w.discoverOpportunity(need(a.agentId, "AGENT_ID"), a.input);
      case "plan": return await w.planOpportunity(need(a.opportunityId, "OPPORTUNITY_ID"));
      case "execute": return await w.executeTask(need(a.agentId, "AGENT_ID"), { executor: a.executor, input: a.input, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" });
      case "executeStep": return await w.executeTask(need(a.agentId, "AGENT_ID"), { executor: a.executor, input: a.input, authorization: { type: "PLAN_STEP", planId: a.planId, stepId: a.stepId }, via: "OWNER_PANEL", opportunityId: a.opportunityId });
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
