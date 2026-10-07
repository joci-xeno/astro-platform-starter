// Contract tests for pre-existing core-engine modules (V7.3 §3, §10, §15, §52). Mechanism only; not live operation.
import test from "node:test";
import assert from "node:assert/strict";
import * as cp from "../atlasz-addons/checkpoint-engine.mjs";
import * as dlq from "../atlasz-addons/dead-letter-queue.mjs";
import * as tl from "../atlasz-addons/task-ledger.mjs";
import * as pl from "../atlasz-addons/progress-ledger.mjs";
import * as st from "../atlasz-addons/stall-replanner.mjs";
import * as rec from "../atlasz-addons/recovery.mjs";
import * as gr from "../atlasz-addons/guardrail-engine.mjs";
import * as ac from "../atlasz-addons/anti-collusion-guard.mjs";
import * as ev from "../atlasz-addons/regression-eval-suite.mjs";
import * as bus from "../atlasz-addons/event-bus.mjs";
import * as cap from "../atlasz-addons/capability-registry.mjs";
import * as ap from "../atlasz-addons/agent-portfolio-manager.mjs";
import * as te from "../atlasz-addons/tracing-evals.mjs";
import * as mp from "../atlasz-addons/master-planner-orchestrator.mjs";

test("checkpoint: snapshot is a deep copy and resume restores it; invalid checkpoint refused", () => {
  const s = { a: { n: 1 } }, c = cp.checkpoint(s, { workflowId: "w", step: 2 });
  s.a.n = 99;
  assert.equal(cp.resume(c).state.a.n, 1); assert.equal(cp.resume(c).step, 2);
  assert.throws(() => cp.checkpoint(s, {}), /WORKFLOW_ID_REQUIRED/); assert.throws(() => cp.resume({}), /INVALID_CHECKPOINT/);
});
test("dead-letter queue (in-memory): open/resolve lifecycle, invalid attempts refused", () => {
  const e = dlq.deadLetter({ item: { id: 1 }, error: new Error("x"), attempts: 3 });
  assert.equal(dlq.listDeadLetters().some(x => x.id === e.id), true);
  dlq.resolveDeadLetter(e.id, "fixed"); assert.equal(dlq.listDeadLetters("OPEN").some(x => x.id === e.id), false);
  assert.throws(() => dlq.deadLetter({ item: 1, attempts: -1 }), /INVALID_DEAD_LETTER_ATTEMPTS/); assert.throws(() => dlq.resolveDeadLetter("nope"), /NOT_FOUND/);
});
test("task ledger: complete only when every done-criterion passed; taskId immutable", () => {
  const l = tl.createTaskLedger({ taskId: "t", goal: "g", doneDefinition: [{ id: 1, passed: true }, { id: 2, passed: false }] });
  assert.equal(tl.taskComplete(l), false);
  const l2 = tl.updateTaskLedger(l, { taskId: "evil", doneDefinition: [{ id: 1, passed: true }] });
  assert.equal(l2.taskId, "t"); assert.equal(tl.taskComplete(l2), true);
  assert.equal(tl.taskComplete(tl.createTaskLedger({ taskId: "u", goal: "g" })), false);          // empty definition is never "done"
  assert.throws(() => tl.createTaskLedger({ taskId: "t" }), /GOAL_REQUIRED/);
});
test("progress ledger + stall detection + replan avoids failed actions", () => {
  const e = [pl.progressEntry({ taskId: "t", metric: "m", before: 1, after: 1 }), pl.progressEntry({ taskId: "t", metric: "m", before: 1, after: 1 }), pl.progressEntry({ taskId: "t", metric: "m", before: 1, after: 0 })];
  assert.equal(pl.summarizeProgress(e).stalled, 2); assert.equal(st.detectStall(e, 3).stalled, true); assert.equal(st.detectStall(e.slice(0, 2), 3).stalled, false);
  assert.throws(() => pl.progressEntry({ taskId: "t", metric: "m", before: "x", after: 1 }), /INVALID_PROGRESS/);
  const r = st.replan({ goal: "g", failedActions: ["a", "a", "b"] }); assert.deepEqual(r.avoid, ["a", "b"]); assert.equal(r.requiresFreshEvidence, true);
});
test("recovery plan: retry -> alternate -> BLOCKED requires human", () => {
  assert.equal(rec.recoveryPlan("e", { attempt: 0, maxRetries: 2 }).action, "RETRY");
  assert.equal(rec.recoveryPlan("e", { attempt: 2, maxRetries: 2, alternateAvailable: true }).action, "ALTERNATE_TOOL_OR_MODEL");
  const b = rec.recoveryPlan("e", { attempt: 2, maxRetries: 2 }); assert.equal(b.action, "BLOCKED"); assert.equal(b.requiresHuman, true);
});
test("guardrail: high-risk actions need a signed owner approval; truthfulness and credentials required", () => {
  for (const a of ["spend-money", "purchase", "subscribe", "sign-contract", "send-payment", "credential-change", "delete-data"]) {
    assert.equal(gr.guardAction({ action: a, ownerApproved: true }).allowed, false, a);          // a bare boolean is never approval
    assert.equal(gr.guardAction({ action: a }).risk, "HIGH");
  }
  assert.equal(gr.guardAction({ action: "read-file" }).allowed, true);
  assert.deepEqual(gr.guardAction({ action: "read-file", truthful: false, hasRequiredCredential: false }).reasons.sort(), ["MISSING_REQUIRED_CREDENTIAL", "TRUTHFULNESS_REQUIRED"]);
  assert.throws(() => gr.assertAllowed({ action: "purchase" }), /GUARDRAIL_BLOCK/);
});
test("anti-collusion: unauthorised shared goals, self-evaluation, hidden channels, gaming are flagged", () => {
  const r = ac.inspectCoordination({ messages: [{ id: 1, taskId: "x" }, { id: 2, fromAgent: "J", targetAgent: "J", type: "EVALUATION_REQUEST" }, { id: 3, hiddenChannel: true }, { id: 4, intent: "GAME_EVALUATION" }], masterTaskIds: ["t"], judgeAgentIds: ["J"] });
  assert.equal(r.status, "ISOLATE_AND_REVIEW"); assert.equal(r.findings.length, 4);
  assert.equal(ac.inspectCoordination({ messages: [{ taskId: "t" }], masterTaskIds: ["t"] }).status, "PASS");
});
test("regression eval suite: failing/throwing tests FAIL; duplicate ids refused; regression gate", async () => {
  const ok = { id: "a", run: () => 1, assert: v => v === 1 }, bad = { id: "b", run: () => { throw new Error("boom"); }, assert: () => true };
  const r = await ev.runEvalSuite([ok, bad]); assert.equal(r.status, "FAIL"); assert.equal(r.failed, 1);
  await assert.rejects(() => ev.runEvalSuite([ok, ok]), /DUPLICATE_EVAL_ID/);
  assert.equal(ev.requireNoRegression({ passed: 1, failed: 1 }, { passed: 2, failed: 0 }).passed, false);
});
test("event bus: only known events, handlers run, unsubscribe works", async () => {
  let n = 0; const off = bus.subscribe("LEAD_FOUND", () => { n++; });
  await bus.publish("LEAD_FOUND", {}); off(); await bus.publish("LEAD_FOUND", {});
  assert.equal(n, 1); await assert.rejects(() => bus.publish("NOT_AN_EVENT"), /UNKNOWN_EVENT/);
});
test("capability registry matches agents by required capabilities", () => {
  cap.registerCapability("A1", { capabilities: ["code", "test"] }); cap.registerCapability("A2", { capabilities: ["code"] });
  assert.deepEqual(cap.matchAgents(["code"]).map(a => a.agentId), ["A2", "A1"]); assert.equal(cap.matchAgents(["video"]).length, 0);
});
test("agent portfolio ranks by net value and tracks error/QA rates", () => {
  ap.recordAgentResult({ agentId: "P1", success: true, qaPassed: true, valueUsd: 10, costUsd: 1 }); ap.recordAgentResult({ agentId: "P2", success: false, error: true, costUsd: 5 });
  const r = ap.rankAgents(); assert.equal(r[0].agentId, "P1"); assert.equal(r.find(a => a.agentId === "P2").errorRate, 1);
});
test("tracing evals: criteria are typed; EVIDENCE criteria need matching evidence; unknown types fail", () => {
  const crit = [{ id: "ne", type: "NONEMPTY" }, { id: "ct", type: "CONTAINS", value: "ok" }, { id: "ev", type: "EVIDENCE", value: "e1" }];
  assert.equal(te.evaluate({ output: "all ok", criteria: crit, evidence: [{ id: "e1" }] }).status, "PASS");
  assert.equal(te.evaluate({ output: "all ok", criteria: crit, evidence: [] }).status, "FAIL");
  assert.equal(te.evaluate({ output: "", criteria: [{ type: "NONEMPTY" }] }).status, "FAIL");
  assert.equal(te.evaluate({ output: "x", criteria: [{ type: "WHATEVER" }] }).status, "FAIL");
});
test("planner: QA-gated advance (a step cannot complete without QA PASS) and replan keeps history", () => {
  const p = mp.createMasterPlan({ objective: "o", steps: [{ id: "a", title: "A", dependsOn: [] }] });
  const bad = mp.advanceMasterPlan(p, { stepId: "a", result: { ok: true }, qa: { status: "FAIL" } });
  assert.notEqual(bad.steps.find(s => s.id === "a").status, "DONE");
  const good = mp.advanceMasterPlan(p, { stepId: "a", result: { ok: true }, qa: { status: "PASS" } });
  assert.equal(good.steps.find(s => s.id === "a").status, "DONE");
  assert.equal(mp.replanMasterPlan(good, { reason: "r", newSteps: [{ id: "b", title: "B", dependsOn: [] }] }).steps.length, 2);
});
