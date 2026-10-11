// Phase 4 required workflow: OWNER -> MASTER -> BRAIN -> MANAGER -> AGENT -> TOOL -> VERIFIER -> MASTER -> CONTROL CENTER, with a real Master, workforce, discovery evidence and Brain System.
// Fixture data is the operator-captured live capture (labelled OPERATOR_CAPTURE by the discovery engine); nothing here spends money or contacts a network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createAgentRegistry } from "../atlasz-addons/agent-registry.mjs";
import { createWorkforce } from "../atlasz-addons/agent-workforce.mjs";
import { BUILTIN_EXECUTORS } from "../atlasz-addons/agent-executors.mjs";
import { createDiscoveryEngine, toOpportunityInput } from "../atlasz-addons/global-discovery.mjs";
import { createMasterCoordinator } from "../atlasz-addons/master-coordinator.mjs";
import { createBrainSystem } from "../atlasz-addons/brain/brain-system.mjs";
import { createBrainMasterBridge, STAGES } from "../atlasz-addons/brain-master-bridge.mjs";
import { createOwnerAuth, generateOwnerKeyPair } from "../atlasz-addons/owner-auth.mjs";
import { ROSTER } from "../atlasz-addons/agent-registry.mjs";
import { tmp, rm } from "./helpers.mjs";

const NOW = "2026-10-11T20:00:00Z";
const CAP = JSON.parse(fs.readFileSync(new URL("../docs/audit/live_capture_2026-10-11.json", import.meta.url), "utf8"));
const stopFlag = { v: false };
async function rig(d) {
  const e = () => createDiscoveryEngine({ dir: path.join(d, "disc"), now: () => NOW });
  const wf = createWorkforce({ dir: path.join(d, "wf"), registry: createAgentRegistry({ dir: path.join(d, "registry") }), sleep: async () => {}, now: () => NOW, isStopped: () => stopFlag.v, executors: { ...BUILTIN_EXECUTORS }, evidenceKnown: (h, r) => e().hasEvidence(h, r) });
  const master = createMasterCoordinator({ dir: path.join(d, "master"), workforce: wf, isStopped: () => stopFlag.v, now: () => NOW, clock: () => Date.parse(NOW) });
  const eng = e(), res = [];
  for (const [sid, list] of Object.entries(CAP.sources)) { const c = eng.importOperatorCapture({ sourceId: sid, items: list, tool: CAP.tool, retrievedAt: CAP.retrievedAt }); for (const it of c.items) res.push(...await wf.discoverBatch([it], { toInput: x => toOpportunityInput(x, { retrieval: c.retrieval, evidenceSha: c.evidenceSha256, now: NOW }) })); }
  const good = res.find(r => r.eligible && /Going Global/.test(r.title)); await wf.planOpportunity(good.opportunityId);
  assert.equal(wf.supplyOwnerInput(good.opportunityId, { requiredSkills: ["plan.implementation_plan", "doc.proposal_draft"] }, "OWNER_PANEL").ok, true);
  const p = await wf.planOpportunity(good.opportunityId);
  const k = generateOwnerKeyPair(), ownerAuth = createOwnerAuth({ publicKeyB64: k.publicKeyB64 });
  const brain = createBrainSystem({ dir: path.join(d, "brain"), ownerAuth, roster: ROSTER.map(id => ({ id, team: id.startsWith("SEARCH") ? "SEARCH" : "EXECUTION" })), gate: () => ({ allowed: !stopFlag.v, reason: stopFlag.v ? "OWNER_STOP" : null }) });
  const bridge = createBrainMasterBridge({ master, brain, dir: path.join(d, "bridge"), now: () => NOW });
  return { wf, master, brain, bridge, planId: p.planId };
}

test("OWNER -> MASTER -> BRAIN -> MANAGER -> AGENT -> TOOL -> VERIFIER -> MASTER -> CONTROL CENTER: every stage recorded, maker != checker, completion recorded by the Master", async () => {
  stopFlag.v = false; const d = tmp("bmw-"); try {
    const { master, bridge, brain, planId } = await rig(d);
    const r = await bridge.runWorkflow({ requestedBy: "OWNER", request: "Draft the proposal for the Going Global opportunity", planId, stepId: "PROPOSAL" });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual(r.stages.map(s => s.stage), [...STAGES]); assert.ok(r.stages.every(s => s.ok));
    assert.match(r.agentId, /^EXECUTION-/); assert.notEqual(r.checker, r.agentId); assert.match(r.checker, /^(SEARCH|EXECUTION)-/);
    assert.equal(master.jobs().find(j => j.id === r.jobId).state, "VERIFIED");
    assert.ok(master.auditEntries().some(e => e.event === "TASK_COMPLETION_RECORDED"));
    assert.equal(bridge.verify().ok, true); assert.equal(bridge.workflows().at(-1).ok, true);
    assert.ok(brain.blackBox.stats().events >= 9, "Brain black box saw every stage"); assert.equal(brain.blackBox.verify().ok, true);
    assert.ok(brain.governance.audit.verify().ok);
  } finally { rm(d); }
});
test("workflow stops (fail closed) and says where: non-owner request, unknown plan step, owner stop, unconnected manager", async () => {
  stopFlag.v = false; const d = tmp("bmw-"); try {
    const { bridge, planId, master } = await rig(d);
    assert.equal((await bridge.runWorkflow({ requestedBy: "AGENT", request: "do it", planId, stepId: "PROPOSAL" })).failedStage, "OWNER");
    assert.equal((await bridge.runWorkflow({ requestedBy: "OWNER", request: "do it", planId, stepId: "NOPE" })).failedStage, "MASTER");
    assert.equal((await bridge.runWorkflow({ requestedBy: "OWNER", request: "do it", planId, stepId: "SEND" })).reason, "STEP_IS_AN_OWNER_APPROVAL_GATE_NOT_WORK");
    stopFlag.v = true;
    const s = await bridge.runWorkflow({ requestedBy: "OWNER", request: "do it", planId, stepId: "PROPOSAL" }); assert.equal(s.ok, false); assert.ok(["MASTER", "BRAIN"].includes(s.failedStage), s.failedStage);
    stopFlag.v = false;
    assert.equal(master.jobs().filter(j => ["QUEUED", "DISPATCHED"].includes(j.state)).length, 0, "no orphaned job after a stopped workflow");
  } finally { stopFlag.v = false; rm(d); }
});
test("a tampered workflow trace is detected on reload", async () => {
  stopFlag.v = false; const d = tmp("bmw-"); try {
    const { bridge, master, brain, planId } = await rig(d);
    await bridge.runWorkflow({ requestedBy: "OWNER", request: "Draft the proposal", planId, stepId: "PROPOSAL" });
    const f = path.join(d, "bridge", "brain-master-workflows.jsonl"), lines = fs.readFileSync(f, "utf8").split("\n").filter(Boolean); lines[2] = lines[2].replace('"ok":true', '"ok":false'); fs.writeFileSync(f, lines.join("\n") + "\n");
    assert.throws(() => createBrainMasterBridge({ master, brain, dir: path.join(d, "bridge") }), /AUDIT_CHAIN_TAMPERED/);
  } finally { rm(d); }
});
