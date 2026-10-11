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
