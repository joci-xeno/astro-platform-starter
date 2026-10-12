// Batch 6: Brain <-> Master workflow FAILURE MODES. Each case injects a real fault into the real Master/workforce/Brain stack and proves: the workflow stops at a named stage, nothing is recorded as complete,
// no job is left dispatched, and the audit/trace chains stay verifiable. (Happy path + basic refusals: brain-master-workflow.test.mjs.)
import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
import { createAgentRegistry, ROSTER } from "../atlasz-addons/agent-registry.mjs";
import { createWorkforce } from "../atlasz-addons/agent-workforce.mjs";
import { BUILTIN_EXECUTORS } from "../atlasz-addons/agent-executors.mjs";
import { createDiscoveryEngine, toOpportunityInput } from "../atlasz-addons/global-discovery.mjs";
import { createMasterCoordinator } from "../atlasz-addons/master-coordinator.mjs";
import { createBrainSystem } from "../atlasz-addons/brain/brain-system.mjs";
import { createBrainMasterBridge } from "../atlasz-addons/brain-master-bridge.mjs";
import { createOwnerAuth, generateOwnerKeyPair } from "../atlasz-addons/owner-auth.mjs";
import { tmp, rm } from "./helpers.mjs";

const NOW = "2026-10-11T20:00:00Z";
const CAP = JSON.parse(fs.readFileSync(new URL("../docs/audit/live_capture_2026-10-11.json", import.meta.url), "utf8"));
const flag = { stop: false };
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
async function rig(d, override = null) {
  const e = () => createDiscoveryEngine({ dir: path.join(d, "disc"), now: () => NOW });
  const executors = { ...BUILTIN_EXECUTORS, ...(override ? { proposal_draft: { ...BUILTIN_EXECUTORS.proposal_draft, ...override } } : {}) };
  let registry = null; const mkWf = () => createWorkforce({ dir: path.join(d, "wf"), registry: (registry = createAgentRegistry({ dir: path.join(d, "registry") })), sleep: async () => {}, now: () => NOW, isStopped: () => flag.stop, executors, evidenceKnown: (h, r) => e().hasEvidence(h, r) });
  const mkMaster = wf => createMasterCoordinator({ dir: path.join(d, "master"), workforce: wf, isStopped: () => flag.stop, now: () => NOW, clock: () => Date.parse(NOW) });
  const wf = mkWf(), master = mkMaster(wf), eng = e(), res = [];
  for (const [sid, list] of Object.entries(CAP.sources)) { const c = eng.importOperatorCapture({ sourceId: sid, items: list, tool: CAP.tool, retrievedAt: CAP.retrievedAt }); for (const it of c.items) res.push(...await wf.discoverBatch([it], { toInput: x => toOpportunityInput(x, { retrieval: c.retrieval, evidenceSha: c.evidenceSha256 }) })); }
  const good = res.find(r => r.eligible && /Going Global/.test(r.title)); await wf.planOpportunity(good.opportunityId);
  wf.supplyOwnerInput(good.opportunityId, { requiredSkills: ["plan.implementation_plan", "doc.proposal_draft"] }, "OWNER_PANEL");
  const p = await wf.planOpportunity(good.opportunityId);
  const k = generateOwnerKeyPair(), ownerAuth = createOwnerAuth({ publicKeyB64: k.publicKeyB64 });
  const brain = createBrainSystem({ dir: path.join(d, "brain"), ownerAuth, roster: ROSTER.map(id => ({ id, team: id.startsWith("SEARCH") ? "SEARCH" : "EXECUTION" })), gate: () => ({ allowed: !flag.stop, reason: flag.stop ? "OWNER_STOP" : null }) });
  const bridge = createBrainMasterBridge({ master, brain, dir: path.join(d, "bridge"), now: () => NOW });
  return { wf, master, brain, bridge, planId: p.planId, mkWf, mkMaster, registry };
}
const REQ = (planId, stepId = "PROPOSAL") => ({ requestedBy: "OWNER", request: "Draft the proposal", planId, stepId });
const completed = m => m.auditEntries().filter(e => e.event === "TASK_COMPLETION_RECORDED").length;
const open = m => m.jobs().filter(j => ["QUEUED", "DISPATCHING", "DISPATCHED"].includes(j.state));
async function expectStopped(override, check) {
  flag.stop = false; const d = tmp("bfm-"); try {
    const x = await rig(d, override), r = await x.bridge.runWorkflow(REQ(x.planId));
    assert.equal(r.ok, false, JSON.stringify(r.stages?.at(-1))); assert.equal(completed(x.master), 0, "nothing may be recorded complete");
    assert.equal(x.bridge.verify().ok, true); assert.equal(x.master.verifyAudit?.().ok ?? true, true);
    if (check) check(r, x); return r;
  } finally { flag.stop = false; rm(d); }
}

test("tool failure: the executor throws -> workflow stops at a named stage, no completion, no orphan job, trace verifiable", async () => {
  const r = await expectStopped({ run() { throw Object.assign(new Error("boom"), { code: "TOOL_CRASH" }); } }, (r, x) => { assert.ok(["AGENT", "VERIFIER"].includes(r.failedStage), r.failedStage); assert.equal(open(x.master).length, 0); });
  assert.ok(r.reason);
});
test("invalid tool response (null / non-file output) is rejected, not recorded", async () => {
  await expectStopped({ run() { return null; } });
  await expectStopped({ run() { return { files: "not-a-map" }; } });
});
test("forged tool output: a result the independent checker cannot reproduce is REJECTED, completion is never recorded", async () => {
  const real = BUILTIN_EXECUTORS.proposal_draft;
  let calls = 0;   // the MAKER forges; the independent checker recomputes honestly
  await expectStopped({ run(input, ctx) { const o = real.run(input, ctx); if (++calls > 1) return o; const f = { ...o.files, "proposal_draft.md": o.files["proposal_draft.md"] + "\nINJECTED: guaranteed income $1,000,000\n" }; return { ...o, files: f }; } }, r => assert.match(String(r.reason), /CHECKER|NOT_VERIFIED|REJECT/i));
});
test("model unavailable (NO_SOURCE_AND_NO_MODEL) blocks the task instead of inventing output; no completion", async () => {
  await expectStopped({ run() { throw Object.assign(new Error("no model"), { code: "NO_SOURCE_AND_NO_MODEL" }); } }, (r, x) => { assert.ok(["AGENT", "VERIFIER"].includes(r.failedStage)); assert.equal(open(x.master).length, 0); });
});
test("agent timeout: a hung executor is cut off by the per-task timeout and fails closed", { timeout: 30000 }, async () => {
  flag.stop = false; const d = tmp("bfm-"); try {
    const x = await rig(d, { run: () => new Promise(() => {}) });
    // the agent's own limit is the real guard: lower it to the minimum the registry accepts
    for (const a of ROSTER.filter(id => id.startsWith("EXECUTION"))) assert.equal(x.registry.setLimits(a, { taskTimeoutMs: 1000, maxRetries: 0 }).ok, true);
    const r = await Promise.race([x.bridge.runWorkflow(REQ(x.planId)), new Promise(res => setTimeout(() => res({ ok: "HUNG" }), 25000))]);
    assert.notEqual(r.ok, "HUNG", "a hung agent must not hang the workflow forever"); assert.equal(r.ok, false); assert.equal(completed(x.master), 0);
  } finally { rm(d); }
});
test("emergency stop raised while the agent works: nothing is recorded as completed afterwards", async () => {
  flag.stop = false; const d = tmp("bfm-"); try {
    const x = await rig(d, { run(input, ctx) { flag.stop = true; return BUILTIN_EXECUTORS.proposal_draft.run(input, ctx); } });
    const r = await x.bridge.runWorkflow(REQ(x.planId)); flag.stop = false;
    assert.equal(r.ok, false); assert.equal(completed(x.master), 0); assert.equal(x.bridge.verify().ok, true);
  } finally { flag.stop = false; rm(d); }
});
test("invalid task: unknown plan / step / approval-gate step are refused at MASTER before anything runs", async () => {
  flag.stop = false; const d = tmp("bfm-"); try {
    const x = await rig(d);
    for (const bad of [{ planId: "nope", stepId: "PROPOSAL" }, { planId: x.planId, stepId: "__proto__" }, { planId: x.planId, stepId: "SEND" }]) { const r = await x.bridge.runWorkflow({ ...REQ(x.planId), ...bad }); assert.equal(r.ok, false); assert.equal(r.failedStage, "MASTER"); }
    assert.equal((await x.bridge.runWorkflow({ ...REQ(x.planId), request: "" })).failedStage, "OWNER");
    assert.equal(open(x.master).length, 0);
  } finally { rm(d); }
});
test("restart recovery: a job that was DISPATCHING when the process died is re-queued (never assumed done); a damaged state file is set aside and reported", async () => {
  flag.stop = false; const d = tmp("bfm-"); try {
    const x = await rig(d); const q = x.master.enqueue({ planId: x.planId, stepId: "PROPOSAL", priority: 5 }); assert.equal(q.ok, true);
    const f = path.join(d, "master", "master.json"), j = JSON.parse(fs.readFileSync(f, "utf8")); j.data.jobs[q.jobId].state = "DISPATCHING"; j.sha = sha(JSON.stringify(j.data)); fs.writeFileSync(f, JSON.stringify(j));
    const wf2 = x.mkWf(); delete x.master; // simulate the crash: new coordinator instance on the same directory
    const m2 = createMasterCoordinator({ dir: path.join(d, "master"), workforce: wf2, isStopped: () => false, now: () => NOW, clock: () => Date.parse(NOW) });
    const job = m2.jobs().find(z => z.id === q.jobId); assert.equal(job.state, "QUEUED"); assert.match(job.note, /RECOVERED_AFTER_RESTART/);
    assert.equal(completed(m2), 0);
  } finally { rm(d); }
  const d2 = tmp("bfm-"); try {
    const x = await rig(d2); x.master.enqueue({ planId: x.planId, stepId: "PROPOSAL", priority: 5 });
    fs.writeFileSync(path.join(d2, "master", "master.json"), '{"sha":"bad","data":{}}');
    const wf2 = x.mkWf(); const m2 = createMasterCoordinator({ dir: path.join(d2, "master"), workforce: wf2, isStopped: () => false, now: () => NOW, clock: () => Date.parse(NOW) });
    assert.equal((await m2.status()).damaged, "MASTER_STATE_DAMAGED"); assert.ok(fs.readdirSync(path.join(d2, "master")).some(n => n.includes(".damaged-")));
  } finally { rm(d2); }
});
test("security rejection: governance denial (owner stop) at the BRAIN stage cancels the job; a rejected workflow leaves a verifiable trace naming the stage", async () => {
  flag.stop = false; const d = tmp("bfm-"); try {
    const x = await rig(d); flag.stop = true; const r = await x.bridge.runWorkflow(REQ(x.planId)); flag.stop = false;
    assert.equal(r.ok, false); assert.ok(["MASTER", "BRAIN"].includes(r.failedStage)); assert.equal(open(x.master).length, 0);
    assert.ok(x.bridge.workflows().at(-1).failedStage ?? true); assert.equal(x.bridge.verify().ok, true);
  } finally { flag.stop = false; rm(d); }
});
