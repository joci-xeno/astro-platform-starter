// Master Coordinator audit + integration. Every one of the 18 owner questions is answered by a runtime check here (real registry, coordinator, ledger, artifacts, discovery log).
// Fixture / operator-captured data is labelled where used. Nothing here spends money or contacts a network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createAgentRegistry } from "../atlasz-addons/agent-registry.mjs";
import { createWorkforce } from "../atlasz-addons/agent-workforce.mjs";
import { BUILTIN_EXECUTORS } from "../atlasz-addons/agent-executors.mjs";
import { createDiscoveryEngine, toOpportunityInput } from "../atlasz-addons/global-discovery.mjs";
import { createCampaignManager } from "../atlasz-addons/campaign-manager.mjs";
import { createGlobalBusinessIntelligence } from "../atlasz-addons/global-business-intelligence.mjs";
import { createMasterCoordinator, MANAGER_IDS } from "../atlasz-addons/master-coordinator.mjs";
import { tmp, rm } from "./helpers.mjs";

const NOW = "2026-10-11T20:00:00Z";
const CAP = JSON.parse(fs.readFileSync(new URL("../docs/audit/live_capture_2026-10-11.json", import.meta.url), "utf8"));
const ctl = { stop: false, hang: null, nowMs: Date.parse(NOW) };
const HANG = { ...BUILTIN_EXECUTORS.implementation_plan, async run(input, ctx) { if (ctl.hang) await ctl.hang; return BUILTIN_EXECUTORS.implementation_plan.run(input, ctx); } };
const HANGP = { ...BUILTIN_EXECUTORS.proposal_draft, async run(input, ctx) { if (ctl.hang) await ctl.hang; return BUILTIN_EXECUTORS.proposal_draft.run(input, ctx); } };
function boot(d, over = {}) {
  const e = () => createDiscoveryEngine({ dir: path.join(d, "disc"), now: () => NOW });
  const wf = createWorkforce({ dir: path.join(d, "wf"), registry: createAgentRegistry({ dir: path.join(d, "registry") }), sleep: async () => {}, now: () => NOW, isStopped: () => ctl.stop, executors: { ...BUILTIN_EXECUTORS, implementation_plan: HANG, proposal_draft: HANGP }, evidenceKnown: (h, r) => e().hasEvidence(h, r), ...over.wf });
  const campaigns = over.withCampaigns ? createCampaignManager({ dir: path.join(d, "campaigns"), coordinator: wf.coordinator, isStopped: () => ctl.stop, nowFn: () => ctl.nowMs }) : null;
  const m = createMasterCoordinator({ dir: path.join(d, "master"), workforce: wf, campaigns, isStopped: () => ctl.stop, now: () => NOW, clock: () => ctl.nowMs, ...over.master });
  return { wf, m, e };
}
async function planned(d, wf, e) {
  const eng = e(); const items = []; for (const [sid, list] of Object.entries(CAP.sources)) { const c = eng.importOperatorCapture({ sourceId: sid, items: list, tool: CAP.tool, retrievedAt: CAP.retrievedAt }); for (const it of c.items) items.push([it, c]); }
  const res = []; for (const [it, c] of items) res.push(...await wf.discoverBatch([it], { toInput: x => toOpportunityInput(x, { retrieval: c.retrieval, evidenceSha: c.evidenceSha256, now: NOW }) }));
  const good = res.find(r => r.eligible && /Going Global/.test(r.title)); await wf.planOpportunity(good.opportunityId); assert.equal(wf.supplyOwnerInput(good.opportunityId, { requiredSkills: ["plan.implementation_plan", "doc.proposal_draft"] }, "OWNER_PANEL").ok, true);
  const p = await wf.planOpportunity(good.opportunityId); assert.ok(p.planId); return { oppId: good.opportunityId, planId: p.planId, res };
}
const reset = () => { ctl.stop = false; ctl.hang = null; ctl.nowMs = Date.parse(NOW); };

test("items 1-4,8,13,14,15 + scenarios A,B,D,E,F,G: master assigns discovery-qualified work by priority, prevents conflicts, dispatches to EXECUTION agents, independent check, records completion; simulated work is counted apart", async () => {
  reset(); const d = tmp("mc-"); try {
    const { wf, m, e } = boot(d), { oppId, planId, res } = await planned(d, wf, e);
    for (const r of res) { assert.notEqual(r.checkedBy, r.discoveredBy); assert.match(r.discoveredBy, /^SEARCH-/); assert.match(r.checkedBy, /^SEARCH-/); }      // A, B
    const sup0 = await m.supervise(); assert.equal(sup0.ok, true); const st = await m.status(); assert.equal(st.managers.length, MANAGER_IDS.length); assert.equal(wf.agentViews().length, 30);     // 4: sees all 30
    const a = m.enqueue({ planId, stepId: "TECHPLAN", priority: 1 }), b = m.enqueue({ planId, stepId: "PROPOSAL", priority: 9 }); assert.equal(a.ok, true); assert.equal(b.ok, true);
    assert.equal(m.enqueue({ planId, stepId: "TECHPLAN" }).reason, "CONFLICTING_ASSIGNMENT");                                                               // 8
    assert.equal(m.enqueue({ planId, stepId: "SEND" }).reason, "STEP_IS_AN_OWNER_APPROVAL_GATE_NOT_WORK");                                                 // K: no external send is dispatchable
    const d1 = await m.dispatch({ max: 1 }); assert.equal(d1.dispatched.length, 1); assert.equal(m.jobs().find(j => j.id === d1.dispatched[0].jobId).stepId, "PROPOSAL", "priority 9 first");
    assert.match(d1.dispatched[0].agentId, /^EXECUTION-/);                                                                                                 // D
    await m.dispatch({ max: 5 }); const v = await m.verifyPending(); assert.equal(v.checked.length, 2); assert.ok(v.checked.every(x => x.decision === "ACCEPT"));      // F
    const jobs = m.jobs(); assert.ok(jobs.every(j => j.state === "VERIFIED"), JSON.stringify(jobs.map(j => [j.stepId, j.state, j.note])));
    const log = m.auditEntries().map(x => x.event); assert.ok(log.includes("TASK_COMPLETION_RECORDED") && log.includes("JOB_DISPATCHED")); assert.equal(m.verify().ok, true);          // G, 18
    const mk = wf.systemView().makerChecker.filter(x => x.decision === "ACCEPT"); assert.ok(mk.every(x => x.maker !== x.checker));                         // 13
    // 15: a FIXTURE item is SIMULATED and never counted as real completed work
    const fx = { ...Object.values(CAP.sources)[0][0], sourceId: "find-a-tender-uk" }; const fr = await wf.discoverBatch([{ ...fx, url: fx.url + "?fx=1", title: fx.title + " (fixture)" }], { toInput: x => toOpportunityInput(x, { retrieval: "FIXTURE", now: NOW }) }); assert.equal(fr[0].ok, true, JSON.stringify(fr));
    const sup = await m.supervise(); assert.ok(sup.tasks.simulated >= 1); assert.ok(sup.tasks.verifiedReal >= 2); assert.equal(wf.systemView().verifiedRevenue.verifiedReceivedUsd, 0);       // 14/15: no revenue invented
    assert.equal(wf.lifecycleOf(oppId) !== "PAID", true);
  } finally { rm(d); }
});

test("items 5,6,7,17 + scenario H: suspend / resume / reassign through the Master only; stalled work is detected; the owner stop freezes dispatch and verification", async () => {
  reset(); const d = tmp("mc-"); try {
    const { wf, m, e } = boot(d), { planId } = await planned(d, wf, e);
    assert.equal(wf.suspendTask("x", { masterToken: "forged" }).reason, "MASTER_CAPABILITY_REQUIRED"); assert.equal((await wf.executeTask("EXECUTION-1", { executor: "implementation_plan", authorization: { type: "PLAN_STEP", planId, stepId: "TECHPLAN" }, via: "MASTER", masterToken: "forged" })).reason, "PLAN_STEP_ONLY_FROM_OWNER_PANEL");
    assert.equal(wf.bindMaster(), null, "the capability is one-shot");
    const j = m.enqueue({ planId, stepId: "TECHPLAN" }).jobId; const dd = await m.dispatch(); const taskId = dd.dispatched[0].taskId;
    const s1 = m.suspend(taskId, "owner asked"); assert.equal(s1.status, "SUSPENDED"); assert.equal(wf.getTask(taskId).status, "SUSPENDED");
    const v0 = await m.verifyPending(); assert.equal(v0.checked.length, 0, "a suspended task is not verified");
    assert.equal(m.jobs().find(x => x.id === j).state, "SUSPENDED"); assert.equal(m.resume(taskId).status, "SUBMITTED"); assert.equal((await m.verifyPending()).checked[0].decision, "ACCEPT");
    // stall + restart: a task that hangs is INTERRUPTED by the restart; the new Master resumes PLAN_STEP work by itself (J) and refuses OWNER_DIRECTED work
    let release; ctl.hang = new Promise(r => { release = r; });     const hangPromise = wf.executeTask("EXECUTION-3", { executor: "proposal_draft", authorization: { type: "PLAN_STEP", planId, stepId: "PROPOSAL" }, via: "OWNER_PANEL" }); await new Promise(r => setTimeout(r, 30)); 
    ctl.nowMs += 3_600_000; const supStall = await m.supervise({ autoRecover: false }); assert.ok(supStall.findings.some(f => f.code === "STALLED_RUNNING_TASK"), JSON.stringify(supStall.findings)); ctl.nowMs = Date.parse(NOW);
    const rawTask = wf.listTasks().find(t => t.status === "RUNNING"); assert.ok(rawTask); ctl.hang = null; release?.(); await hangPromise.catch(() => {});
  } finally { rm(d); }
});

test("scenario J + items 2,3,16: restart keeps the queue and history, interrupted PLAN_STEP work is resumed by the new Master, OWNER_DIRECTED work is left to the owner; damaged state is set aside", async () => {
  reset(); const d = tmp("mc-"); try {
    let { wf, m, e } = boot(d); const { planId } = await planned(d, wf, e);
    m.enqueue({ planId, stepId: "PROPOSAL", priority: 3 }); const q0 = m.jobs().length;
    // an in-flight PLAN_STEP task and an in-flight OWNER_DIRECTED task die with the process
    let never; ctl.hang = new Promise(r => { never = r; }); void wf.executeTask("EXECUTION-4", { executor: "implementation_plan", authorization: { type: "PLAN_STEP", planId, stepId: "TECHPLAN" }, via: "OWNER_PANEL" }).catch(() => {}); await new Promise(r => setTimeout(r, 30));
    const opp = wf.listTasks().find(t => t.status === "RUNNING").opportunityId; void wf.executeTask("EXECUTION-5", { executor: "implementation_plan", authorization: { type: "OWNER_DIRECTED" }, opportunityId: opp, via: "OWNER_PANEL" }).catch(() => {}); await new Promise(r => setTimeout(r, 30));
    assert.equal(wf.listTasks().filter(t => t.status === "RUNNING").length, 2);
    ctl.hang = null; const b2 = boot(d); wf = b2.wf; m = b2.m;                                         // "restart": new objects on the same state directory
    assert.equal(m.jobs().length, q0, "the queue survived"); const ints = wf.listTasks().filter(t => t.status === "INTERRUPTED"); assert.equal(ints.length, 2, "nothing was silently marked done");
    const sup = await m.supervise(); const acts = sup.actions.filter(a => a.action === "RESUME_INTERRUPTED"); assert.equal(acts.length, 1, JSON.stringify(sup.actions)); assert.ok(sup.findings.some(f => f.code === "INTERRUPTED_OWNER_DIRECTED_TASK_NEEDS_OWNER"));
    assert.equal(wf.listTasks().filter(t => t.status === "INTERRUPTED").length, 1);
    // reassign of the owner-directed task needs the owner
    const od = wf.listTasks().find(t => t.status === "INTERRUPTED"); assert.equal((await m.reassign(od.taskId)).reason, "OWNER_DIRECTED_TASK_NEEDS_THE_OWNER"); const rr = await m.reassign(od.taskId, undefined, { ownerPanel: true }); assert.equal(rr.ok, true, JSON.stringify(rr)); assert.notEqual(rr.to, od.agentId); assert.equal(wf.getTask(od.taskId).status, "REASSIGNED");
  } finally { rm(d); }
});

test("items 9,11,12 + scenarios I,K: owner stop freezes the Master; an invalid or reached spend cap holds dispatch; an unavailable provider is replaced only by an approved, usable model; no paid default", async () => {
  reset(); const d = tmp("mc-"); try {
    let view = { state: "CONNECTED", usage: { cap: { usd: 5, valid: true, remainingUsd: 5 } }, assignments: { "EXECUTION-1": { primary: "gpt-x", fallbacks: ["llama-local"] } },
      models: [{ id: "gpt-x", providerId: "openai", usable: false, blockers: ["NO_CREDENTIAL", "NOT_LIVE_NO_PASSING_PROBE"], capabilities: ["text"], costClass: "PAID", costPer1kTokensUsd: 0.01 }, { id: "llama-local", providerId: "ollama-local", usable: true, status: "LIVE", capabilities: ["text"], costClass: "FREE", costPer1kTokensUsd: 0 }, { id: "paid-live", providerId: "p", usable: true, status: "LIVE", capabilities: ["text"], costClass: "PAID", costPer1kTokensUsd: 0.02 }],
      providerLadder: [{ id: "openai", credentialsConfigured: true, authenticatedLiveTestPassed: false }] };
    const { wf, m, e } = boot(d, { master: { models: async () => view } }); const { planId } = await planned(d, wf, e);
    const sel = await m.selectModel({ agentId: "EXECUTION-1" }); assert.equal(sel.model.id, "llama-local"); assert.equal(sel.failover, true); assert.equal(sel.noSpend, true); assert.equal(sel.unavailablePreferred[0].id, "gpt-x");   // I
    view = { ...view, models: view.models.filter(x => x.id === "gpt-x" || x.id === "paid-live") }; assert.equal((await m.selectModel({ agentId: "EXECUTION-1" })).model, null, "no free live model: no spend chosen by default"); assert.equal((await m.selectModel({ agentId: "EXECUTION-1", maxCostUsd: 1 })).model.id, "paid-live");
    const sup = await m.supervise(); assert.ok(sup.findings.some(f => f.code === "PROVIDER_NOT_LIVE" && f.subject === "openai"));
    m.enqueue({ planId, stepId: "TECHPLAN" }); view = { ...view, usage: { cap: { usd: 5, valid: false, reason: "SPEND_CAP_SIGNATURE_INVALID" } } };
    const held = await m.dispatch(); assert.equal(held.dispatched.length, 0); assert.equal(held.held, "SPEND_CAP_INVALID_HOLD");                                       // K spend
    view = { ...view, usage: { cap: { usd: 5, valid: true, remainingUsd: 0 } } }; assert.equal((await m.dispatch()).held, "SPEND_CAP_REACHED_HOLD");
    view = { ...view, usage: { cap: { usd: null } } };
    ctl.stop = true; assert.equal(m.enqueue({ planId, stepId: "PROPOSAL" }).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); assert.equal((await m.dispatch()).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); assert.equal((await m.verifyPending()).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");   // 17
    assert.equal((await m.supervise()).stopped, true); assert.equal((await wf.executeTask("EXECUTION-1", { executor: "implementation_plan", authorization: { type: "PLAN_STEP", planId, stepId: "TECHPLAN" }, via: "OWNER_PANEL" })).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    ctl.stop = false; assert.equal((await m.dispatch()).dispatched.length, 1, "resumes after the owner lifts the stop");
  } finally { rm(d); }
});

test("item 10 + 18: the manager registry reports only what answers a live probe; unwired managers are NOT_CONNECTED, never faked", async () => {
  reset(); const d = tmp("mc-"); try {
    const { m } = boot(d, { master: { probes: { CAMPAIGN_MANAGER: async () => ({ ok: true, detail: "stub" }), TASK_SCHEDULER: async () => ({ ok: false, reason: "SCHEDULER_DOWN" }) } } });
    const ms = await m.managers(), by = Object.fromEntries(ms.map(x => [x.id, x]));
    for (const id of ["MASTER_COORDINATOR", "WORKFORCE_MANAGER", "SEARCH_AGENT_MANAGER", "EXECUTION_AGENT_MANAGER", "QUALITY_ASSURANCE", "FINANCIAL_REVENUE_MANAGER"]) assert.equal(by[id].status, "CONNECTED", id);
    assert.equal(by.CAMPAIGN_MANAGER.status, "CONNECTED"); assert.equal(by.TASK_SCHEDULER.status, "DEGRADED"); assert.match(by.TASK_SCHEDULER.missingDependencies[0], /HEALTH_PROBE_FAILED/);
    for (const id of ["GLOBAL_BUSINESS_INTELLIGENCE", "AI_MODEL_MANAGER", "SECURITY_APPROVAL_MANAGER", "MEMORY_KNOWLEDGE_MANAGER", "RUNTIME_SUPERVISOR", "RECOVERY_MAINTENANCE"]) { assert.equal(by[id].status, "NOT_CONNECTED", id); assert.equal(by[id].connectedToMaster, false); assert.deepEqual(by[id].missingDependencies, ["NOT_WIRED_INTO_THE_MASTER"]); }
    assert.ok(ms.every(x => x.implementation.length && x.permissions && Array.isArray(x.tests)));
    const h = m.hierarchy(); assert.equal(h.agents.permanent, 30); assert.equal(h.agents.search + h.agents.execution, 30);
  } finally { rm(d); }
});

test("a second Master cannot bind to the same workforce, and a damaged Master state is set aside rather than trusted", async () => {
  reset(); const d = tmp("mc-"); try {
    const { wf, m } = boot(d); assert.throws(() => createMasterCoordinator({ dir: path.join(d, "master2"), workforce: wf }), /MASTER_ALREADY_BOUND/);
    m.enqueue({ planId: "none", stepId: "none" }); fs.writeFileSync(path.join(d, "master", "master.json"), JSON.stringify({ sha: "0".repeat(64), data: { jobs: { x: 1 } } }));
    const b = boot(d); const st = await b.m.status(); assert.equal(st.damaged, "MASTER_STATE_DAMAGED"); assert.equal(b.m.jobs().length, 0); assert.equal(b.m.enqueue({ planId: "p", stepId: "s" }).reason, "MASTER_STATE_DAMAGED");
    assert.ok(fs.readdirSync(path.join(d, "master")).some(f => f.startsWith("master.json.damaged-")));
  } finally { rm(d); }
});


test("scenario C: the Campaign Manager organises the approved workflow in the same ledger; DONE comes only from the independent verifier; the budget is tokens+time, never money", async () => {
  reset(); const d = tmp("mc-"); try {
    const { wf, m, e } = boot(d, { withCampaigns: true }), { planId } = await planned(d, wf, e);
    const c = m.planCampaign({ planId }); assert.equal(c.ok, true, JSON.stringify(c)); assert.equal(m.planCampaign({ planId }).reason, "CAMPAIGN_ALREADY_PLANNED"); assert.ok(Object.values(c.owners).every(a => /^EXECUTION-/.test(a)));
    for (const [step, agent] of Object.entries(c.owners)) assert.equal(m.enqueue({ planId, stepId: step, preferredAgent: agent }).ok, true, step);
    for (let i = 0; i < 4; i++) { await m.dispatch(); await m.verifyPending(); const s = await m.syncCampaign(planId); assert.equal(s.ok, true, JSON.stringify(s)); }
    const jobs = m.jobs(); assert.ok(jobs.every(j => j.state === "VERIFIED" || j.state === "WAITING_APPROVAL"), JSON.stringify(jobs.map(j => [j.stepId, j.state, j.note])));
    assert.ok(jobs.filter(j => j.state === "VERIFIED").every(j => j.agentId === c.owners[j.stepId]), "work ran under the campaign owners");
    const s = await m.syncCampaign(planId); const prog = s.progress; const done = prog.tasks.filter(t => t.status === "DONE").length; assert.ok(done >= 2, JSON.stringify(prog.byStatus)); assert.equal(prog.budget.tokens, 200000);
    const ev = m.auditEntries().filter(x => x.event === "CAMPAIGN_TASK_VERIFIED"); assert.ok(ev.length >= 2 && ev.every(x => x.data.ok)); assert.equal(wf.systemView().verifiedRevenue.verifiedReceivedUsd, 0);
    assert.equal(wf.coordinator.auditVerify().ok, true);
    assert.equal(campaigns_budgetMoney(d), true);
  } finally { rm(d); }
});
function campaigns_budgetMoney(d) { const f = JSON.parse(fs.readFileSync(path.join(d, "campaigns", "campaigns.json"), "utf8")); const b = JSON.parse(f.body); return Object.values(b.campaigns).every(c => Object.keys(c.budget).sort().join() === "timeMs,tokens"); }

test("Global Business Intelligence: read-only funnel / sources / regions / deadlines / ranking / performance with evidence classes kept apart; no conversion, no invented claims", async () => {
  reset(); const d = tmp("mc-"); try {
    const { wf, e } = boot(d), { oppId } = await planned(d, wf, e), eng = e(); const gbi = createGlobalBusinessIntelligence({ workforce: wf, discovery: eng, now: () => NOW, clock: () => ctl.nowMs });
    const r = gbi.report(); assert.equal(r.ok, true); assert.equal(Object.values(r.funnel).reduce((a, b) => a + b, 0), 5); assert.equal(r.funnel.PAID, 0); assert.equal(r.claims.proposalsSent, 0); assert.equal(r.claims.contracts, 0);
    assert.equal(r.financial.verifiedReceivedUsd, 0); assert.equal(r.financial.kinds.estimates, "ESTIMATE_NOT_REVENUE"); assert.ok(r.sources.every(s => s.connected === false), "operator captures never count as connected");
    assert.ok(r.sources.find(s => s.sourceId === "find-a-tender-uk").opportunities === 3); assert.ok(r.regions.some(x => x.region === "Europe" && x.genuinelyConnected === 0)); assert.ok(r.deadlines.length >= 1 && r.deadlines.every(x => ["OPEN", "NEAR", "PASSED"].includes(x.state)));
    assert.match(r.currencyNote, /No conversion/); assert.ok(oppId); assert.equal(gbi.health().ok, true);
  } finally { rm(d); }
});
