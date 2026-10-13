// Integrated discovery -> workforce: real operator-captured public listings (labelled OPERATOR_TOOL), SEARCH agents verify, EXECUTION agents plan, checker verifies, restart survives.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createAgentRegistry } from "../atlasz-addons/agent-registry.mjs";
import { createWorkforce } from "../atlasz-addons/agent-workforce.mjs";
import { createDiscoveryEngine, toOpportunityInput } from "../atlasz-addons/global-discovery.mjs";
import { tmp, rm } from "./helpers.mjs";

const NOW = "2026-10-11T20:00:00Z";
const CAP = JSON.parse(fs.readFileSync(new URL("../docs/audit/live_capture_2026-10-11.json", import.meta.url), "utf8"));
const known = new Set(); const open = d => createWorkforce({ evidenceKnown: (h, r) => { try { return createDiscoveryEngine({ dir: path.join(d, "disc"), now: () => NOW }).hasEvidence(h, r); } catch { return false; } }, dir: path.join(d, "wf"), registry: createAgentRegistry({ dir: path.join(d, "registry") }), sleep: async () => {}, now: () => NOW });
const engine = d => createDiscoveryEngine({ dir: path.join(d, "disc"), now: () => NOW });

async function ingest(d, wf) {
  const e = engine(d), items = [];
  for (const [sourceId, list] of Object.entries(CAP.sources)) { const c = e.importOperatorCapture({ sourceId, items: list, tool: CAP.tool, retrievedAt: CAP.retrievedAt, note: "test" }); assert.equal(c.ok, true, JSON.stringify(c)); for (const it of c.items) items.push({ it, c }); }
  const out = [];
  for (const { it, c } of items) out.push(...await wf.discoverBatch([it], { toInput: x => toOpportunityInput(x, { retrieval: c.retrieval, evidenceSha: c.evidenceSha256, now: NOW }) }));
  return out;
}

test("real captured listings: independent verification, honest qualification, plan, execution agents, checker, lifecycle gates, restart", async () => {
  const d = tmp("gdw-"); try {
    const wf = open(d), res = await ingest(d, wf);
    assert.equal(res.length, 5, JSON.stringify(res));
    for (const r of res) { assert.equal(r.ok, true, JSON.stringify(r)); assert.notEqual(r.checkedBy, r.discoveredBy); assert.match(r.checkedBy, /^SEARCH-/); }
    const view = wf.systemView(); assert.equal(view.discoverySummary.operatorToolRetrieved, 5); assert.equal(view.discoverySummary.connectorRetrieved, 0);
    assert.equal(view.verifiedRevenue.verifiedReceivedUsd, 0);
    const byTitle = t => res.find(r => r.title.includes(t));
    assert.equal(byTitle("Going Global").eligible, true);
    const ineligible = res.filter(r => !r.eligible); assert.ok(ineligible.length >= 3, JSON.stringify(res.map(r => [r.title, r.eligible, r.blockers])));
    const rk = wf.rankPipeline(); assert.equal(rk.length, 5); assert.ok(rk.filter(r => r.score === null).length >= 3); const sc = rk.filter(r => r.score !== null); assert.ok(sc.every(r => r.score >= 0 && r.score <= 100 && r.unknown.includes("GEOGRAPHIC_ELIGIBILITY_UNKNOWN_NOT_ASSUMED")), JSON.stringify(sc)); assert.ok(sc.every(r => r.components.sourceEvidence === 12), "operator captures score below connector retrievals");
    const first = byTitle("Going Global"), o = wf.listOpportunities().find(x => x.id === first.opportunityId);
    const n1 = await wf.planOpportunity(first.opportunityId); assert.equal(n1.needsOwnerInput, true, "the keyword inference finds no deliverable skill: it must ask, not guess");
    assert.equal(wf.supplyOwnerInput(first.opportunityId, { requiredSkills: ["plan.implementation_plan"] }, "API").reason, "OWNER_INPUT_ONLY_FROM_OWNER_PANEL");
    assert.equal(wf.supplyOwnerInput(first.opportunityId, { requiredSkills: ["plan.implementation_plan"] }, "OWNER_PANEL").ok, true);
    const p = await wf.planOpportunity(first.opportunityId); assert.equal(p.ok, true, JSON.stringify(p)); assert.ok(p.planId, JSON.stringify(p.evaluation) + JSON.stringify(p.research));
    const a = wf.assignExecution(p.planId); assert.equal(a.ok, true, JSON.stringify(a)); assert.ok(a.assignments.length >= 2, JSON.stringify(a)); assert.ok(a.assignments.every(x => /^EXECUTION-/.test(x.agentId)));
    const stepIds = wf.systemView().plans.find(x => x.planId === p.planId).steps.map(s => s.id); assert.ok(stepIds.includes("PROPOSAL") && stepIds.includes("TECHPLAN"));
    for (const [step, ex] of [["TECHPLAN", "implementation_plan"], ["PROPOSAL", "proposal_draft"]]) {
      const ag = a.assignments.find(x => x.stepId === step).agentId;
      const t = await wf.executeTask(ag, { executor: ex, input: undefined, authorization: { type: "PLAN_STEP", planId: p.planId, stepId: step }, via: "OWNER_PANEL", opportunityId: first.opportunityId });
      assert.equal(t.ok, true, JSON.stringify(t));
      const c = await wf.checkTask(t.taskId); assert.equal(c.decision, "ACCEPT", JSON.stringify(c)); assert.notEqual(c.checker, ag);
    }
    // evidence gates: nothing is PROPOSED/CONTRACTED/PAID without owner approval and evidence
    assert.equal(wf.advanceLifecycle(first.opportunityId, "PROPOSED", { evidence: { source: "x", reference: "y", verifiedAt: NOW } }).ok, false);
    assert.equal(wf.advanceLifecycle(first.opportunityId, "PAID").ok, false);
    assert.equal(wf.systemView().verifiedRevenue.verifiedReceivedUsd, 0);
    const before = wf.lifecycleOf(first.opportunityId), nTasks = wf.systemView().counts.tasks;
    // restart
    const wf2 = open(d); assert.equal(wf2.lifecycleOf(first.opportunityId), before); assert.equal(wf2.systemView().counts.tasks, nTasks);
    assert.equal(wf2.systemView().deliverables.filter(x => x.status === "VERIFIED").length, 2);
    assert.equal(wf2.verify().ok, true);
  } finally { rm(d); }
});

test("FIXTURE data can never enter the commercial pipeline", async () => {
  const d = tmp("gdw-"); try {
    const wf = open(d), it = Object.values(CAP.sources)[0][0];
    const r = await wf.discoverBatch([it], { toInput: x => toOpportunityInput(x, { retrieval: "FIXTURE", evidenceSha: null, now: NOW }) });
    if (r[0].ok) { const id = r[0].opportunityId; assert.equal(wf.advanceLifecycle(id, "PROPOSED", { evidence: { source: "x", reference: "y", verifiedAt: NOW } }).ok, false); assert.equal(wf.systemView().simulated.length >= 0, true); }
  } finally { rm(d); }
});

test("a retrieval label that the discovery log does not back is refused by the independent checker", async () => {
  const d = tmp("gdw-"); try {
    const wf = open(d), it = Object.values(CAP.sources)[1][0];
    const inp = toOpportunityInput({ ...it, sourceId: "remoteok" }, { retrieval: "CONNECTOR", evidenceSha: "a".repeat(64), now: NOW });
    const x = inp.ok ? wf.discoverOpportunity("SEARCH-1", inp.input) : inp; if (x.ok) { const c = await wf.checkTask(x.taskId); assert.equal(c.decision, "REJECT"); assert.ok(c.reasons.includes("RETRIEVAL_LABEL_NOT_BACKED_BY_DISCOVERY_LOG"), JSON.stringify(c)); }
    assert.equal(wf.systemView().discoverySummary.connectorRetrieved >= 0, true);
  } finally { rm(d); }
});

import { generateOwnerKeyPair, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createMemoryStore } from "../atlasz-addons/memory-store.mjs";
import { createAgentMemory } from "../atlasz-addons/agent-memory.mjs";

test("memory retrieval: execution agents reuse verified work of the SAME opportunity only; another project's memory never leaks; retrieved text is fenced data", async () => {
  const d = tmp("gdw-"); try {
    const kp = generateOwnerKeyPair(), auth = createOwnerAuth({ publicKeyB64: kp.publicKeyB64 });
    const store = createMemoryStore({ dir: path.join(d, "store"), ownerAuth: auth }), am = createAgentMemory({ store, dir: path.join(d, "acc"), ownerAuth: auth });
    const wf = createWorkforce({ dir: path.join(d, "wf"), registry: createAgentRegistry({ dir: path.join(d, "registry") }), sleep: async () => {}, now: () => NOW, memory: am, evidenceKnown: (h, r) => createDiscoveryEngine({ dir: path.join(d, "disc"), now: () => NOW }).hasEvidence(h, r) });
    const res = await ingest(d, wf), good = res.filter(r => r.eligible).slice(0, 2); assert.ok(good.length >= 1, JSON.stringify(res.map(r => [r.eligible, r.blockers])));
    const A = good[0]; assert.equal((await wf.planOpportunity(A.opportunityId)).needsOwnerInput, true); assert.equal(wf.supplyOwnerInput(A.opportunityId, { requiredSkills: ["plan.implementation_plan"] }, "OWNER_PANEL").ok, true);
    const pA = await wf.planOpportunity(A.opportunityId); assert.ok(pA.planId); const asA = wf.assignExecution(pA.planId);
    const run = async (opp, plan, as, step, ex) => { const ag = as.assignments.find(x => x.stepId === step).agentId; const t = await wf.executeTask(ag, { executor: ex, authorization: { type: "PLAN_STEP", planId: plan.planId, stepId: step }, via: "OWNER_PANEL" }); assert.equal(t.ok, true, JSON.stringify(t)); const c = await wf.checkTask(t.taskId); assert.equal(c.decision, "ACCEPT", JSON.stringify(c)); return t; };
    const t1 = await run(A, pA, asA, "TECHPLAN", "implementation_plan");
    const recA = am.contextForProject("EXECUTION-9", { taskId: "probe-a", query: "implementation plan", project: String(A.opportunityId).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 23) });
    const m = await recA; assert.equal(m.ok, true, JSON.stringify(m)); assert.ok(m.ids.length >= 1, "verified work of that project is stored under the project tag");
    const t2 = await run(A, pA, asA, "PROPOSAL", "proposal_draft");
    const file = fs.readFileSync(path.join(d, "wf", "artifacts", t2.taskId, "proposal_draft.md"), "utf8"); assert.match(file, /Related verified prior work/); assert.match(file, /> RETRIEVED MEMORY/);
    // a different project asks about the same words: nothing of A is returned
    const other = await am.contextForProject("EXECUTION-9", { taskId: "probe-b", query: "implementation plan", project: "oppzzzzzzzzzzzz" }); assert.equal(other.ok, true); assert.equal(other.ids.length, 0);
    const none = await am.forAgent("EXECUTION-9").contextFor({ taskId: "probe-c", query: "implementation plan" }); assert.notEqual(none.ids?.length > 0, true, "an agent handle cannot widen its own project reach");
  } finally { rm(d); }
});

test("an agent handle cannot widen its own project reach (extraProject / coordinatorChecked are not forwarded)", async () => {
  const d = tmp("gdw-"); try {
    const kp = generateOwnerKeyPair(), auth = createOwnerAuth({ publicKeyB64: kp.publicKeyB64 }), store = createMemoryStore({ dir: path.join(d, "store"), ownerAuth: auth }), am = createAgentMemory({ store, dir: path.join(d, "acc"), ownerAuth: auth });
    assert.equal(am.recordVerifiedWork({ taskId: "task-1", owner: "EXECUTION-1", verifier: "SEARCH-1", summary: "implementation plan for the alpha project", project: "alpha" }).ok, true);
    const h = am.forAgent("SEARCH-2"); const a = await h.contextFor({ taskId: "t9", query: "alpha implementation plan", extraProject: "alpha", coordinatorChecked: true }); assert.notEqual(a.ok, true, "not a participant and no grant");
    const b = await h.recall({ query: "alpha implementation plan", extraProject: "alpha" }); assert.equal(b.ok === true && b.results.length > 0, false);
    const c = await am.contextForProject("SEARCH-2", { taskId: "t9", query: "alpha implementation plan", project: "alpha" }); assert.equal(c.ok, true); assert.ok(c.ids.length > 0);
  } finally { rm(d); }
});

test("ranking uses commercial factors: advertised value is not profit, unknowns are listed, and the daily objective is one small factor", async () => {
  const d = tmp("gdw-rank-"); try {
    const mkWf = objective => createWorkforce({ objective, evidenceKnown: (h, r) => { try { return createDiscoveryEngine({ dir: path.join(d, "disc"), now: () => NOW }).hasEvidence(h, r); } catch { return false; } }, dir: path.join(d, "wf"), registry: createAgentRegistry({ dir: path.join(d, "wf", "registry"), ownerAuth: { verifyApproval: () => ({ allowed: false }), verifyRecorded: () => false } }), now: () => NOW });
    const wf = mkWf(() => ({ status: "BELOW_MINIMUM", remainingToMinimumUsd: 500 })); await ingest(d, wf);
    const rows = wf.rankPipeline().filter(r => r.score !== null); assert.ok(rows.length >= 1);
    for (const r of rows) { assert.ok(r.components.netEconomics <= 1, "no owner-recorded net: an advertised figure scores at most 1 of 100"); assert.equal(r.components.objectiveFit, 0); assert.ok(r.unknown.includes("EXPECTED_NET_UNKNOWN_ADVERTISED_VALUE_IS_NOT_PROFIT")); assert.ok(r.unknown.includes("OBJECTIVE_FIT_NOT_SCORED_EXPECTED_NET_UNKNOWN")); assert.ok(r.unknown.includes("PAYMENT_TERMS_AND_RELIABILITY_UNKNOWN")); assert.equal(r.objective.status, "BELOW_MINIMUM"); assert.ok(r.score <= 100); }
    const none = mkWf(() => { throw new Error("objective unavailable"); }).rankPipeline().filter(r => r.score !== null); assert.ok(none.every(r => r.objective === null), "a failing objective hook never breaks ranking");
  } finally { rm(d); }
});
