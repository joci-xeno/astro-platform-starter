// Contract tests for factory/planning modules that previously had no tests.
import test from "node:test";
import assert from "node:assert/strict";
import { compileOutcome, validateOutcomePlan, requestExecution } from "../atlasz-addons/outcome-compiler.mjs";
import { createGeneralCapabilityExtension, GENERAL_CAPABILITY_SLOTS } from "../atlasz-addons/general-intelligence-extensions.mjs";
import { analyzeMarketSignals, proposeSearchStrategy } from "../atlasz-addons/market-intelligence-engine.mjs";
import { createSkillDefinition, testSkill, skillGet } from "../atlasz-addons/skill-factory.mjs";
import { createAgentBlueprint, validateBlueprint, instantiateAgent, cloneBlueprint } from "../atlasz-addons/agent-factory.mjs";
import { createTeamLeadWorkflow, teamLeadDispatch } from "../atlasz-addons/team-lead-workflows.mjs";
import { createExecutionJob, assignExecution, advanceExecution, executionToolPlan, EXECUTION_STAGES } from "../atlasz-addons/execution-factory.mjs";

test("outcome-compiler: compiles, flags missing capabilities, owner gate blocks bare boolean", () => {
  assert.throws(() => compileOutcome({}), /OUTCOME_REQUIRED/);
  const p = compileOutcome({ outcome: "o", availableCapabilities: ["c1"], availableTools: ["t1"] });
  assert.equal(p.stages.length, 7); assert.equal(p.requiresPlanner, true);
  assert.deepEqual(validateOutcomePlan(p, { capabilityMatches: [], toolMatches: ["t1"] }).missingCapabilities, ["c1"]);
  assert.equal(validateOutcomePlan(p, { capabilityMatches: ["c1"], toolMatches: ["t1"] }).ready, true);
  assert.equal(requestExecution(p, { ownerApprovalRequired: true, ownerApproved: true }).status, "AWAITING_OWNER_APPROVAL");
  assert.equal(requestExecution(p).status, "READY_FOR_ORCHESTRATOR");
});
test("general capability slots: 8 slots, never live/tested by themselves", () => {
  assert.equal(GENERAL_CAPABILITY_SLOTS.length, 8);
  const x = createGeneralCapabilityExtension({ providers: { "general-reasoning-planning": { name: "p" } } });
  const s = x.summary();
  assert.equal(s.live, 0); assert.equal(s.connectedUntested, 1); assert.equal(s.placeholders, 7);
  assert.equal(x.get("general-reasoning-planning").tested, false);
  assert.equal(x.safety.searchAgents, 5); assert.equal(x.safety.executionAgents, 25);
});
test("market intelligence: signals without source/time/strength are ignored; no evidence => no strategy change", () => {
  const a = analyzeMarketSignals({ signals: [{ topic: "x", strength: 3 }, { source: "s", observedAt: "2026-01-01", strength: 4, topic: "ai" }] });
  assert.equal(a.invalidSignals, 1); assert.equal(a.trends[0].topic, "ai");
  assert.equal(analyzeMarketSignals({ signals: [] }).status, "NO_EVIDENCE");
  assert.equal(proposeSearchStrategy({ analysis: analyzeMarketSignals({}) }).change, false);
  assert.equal(proposeSearchStrategy({ analysis: a }).requiresOutcomeMeasurement, true);
});
test("skill factory: untested until a real test passes; TESTED needs a passing function", async () => {
  createSkillDefinition({ id: "sk-ct-1", goal: "g", implementation: () => 1 });
  assert.equal(skillGet("sk-ct-1").state, "CODE_ADDED");
  await assert.rejects(testSkill("sk-ct-1", {}), /REAL_TEST_REQUIRED/);
  assert.equal((await testSkill("sk-ct-1", { test: async () => ({ passed: false }) })).state, "TEST_FAILED");
  assert.equal((await testSkill("sk-ct-1", { test: async () => ({ passed: true }) })).state, "TESTED");
  assert.throws(() => createSkillDefinition({ id: "sk-ct-1", goal: "g" }), /SKILL_ALREADY_EXISTS/);
  createSkillDefinition({ id: "sk-ct-2", goal: "g" });
  await assert.rejects(testSkill("sk-ct-2", { test: () => ({ passed: true }) }), /SKILL_IMPLEMENTATION_REQUIRED/);
});
test("agent factory: validation, blocked on missing capability/tool, owner gate, clone gets new id", () => {
  assert.throws(() => createAgentBlueprint({ name: "n", role: "BOSS", goal: "g" }), /VALID_NAME_ROLE_GOAL_REQUIRED/);
  const b = createAgentBlueprint({ name: "n", role: "EXECUTION", goal: "g", capabilities: ["c"], tools: ["t"] });
  assert.equal(validateBlueprint(b).valid, true);
  assert.equal(instantiateAgent(b, { availableCapabilities: [], availableTools: ["t"] }).status, "BLOCKED");
  assert.equal(instantiateAgent(b, { availableCapabilities: ["c"], availableTools: ["t"] }).status, "READY_FOR_RUNTIME");
  const g = { ...b, approvalPolicy: "OWNER_BEFORE_CREATE" };
  assert.equal(instantiateAgent(g, { availableCapabilities: ["c"], availableTools: ["t"], ownerApproved: true }).status, "AWAITING_OWNER_APPROVAL");
  assert.notEqual(cloneBlueprint(b, {}).agentId, b.agentId);
});
test("team lead workflow: lead cannot be a member; dispatch only for known task and member", () => {
  assert.throws(() => createTeamLeadWorkflow({ teamId: "t", leadAgentId: "L", memberAgentIds: ["L"], objective: "o" }), /TEAM_LEAD_CANNOT_BE_MEMBER/);
  const w = createTeamLeadWorkflow({ teamId: "t", leadAgentId: "L", memberAgentIds: ["a"], objective: "o", taskIds: ["k"] });
  assert.equal(teamLeadDispatch(w, { taskId: "k", agentId: "a" }).allowed, true);
  assert.equal(teamLeadDispatch(w, { taskId: "zz", agentId: "a" }).reason, "TASK_NOT_IN_MASTER_WORKFLOW");
  assert.equal(teamLeadDispatch(w, { taskId: "k", agentId: "q" }).reason, "AGENT_NOT_IN_TEAM");
});
test("execution factory: strict stage order, QA before delivery approval, owner approval before READY", () => {
  assert.throws(() => createExecutionJob({ jobId: "j" }), /EXECUTION_JOB_REQUIRES/);
  let j = assignExecution(createExecutionJob({ jobId: "j", dealId: "d", scope: "s" }), "agent-1");
  assert.equal(j.status, "IN_PROGRESS");
  assert.throws(() => advanceExecution(j, "QA"), /INVALID_EXECUTION_TRANSITION/);
  for (const s of ["EXECUTE", "TEST", "QA"]) j = advanceExecution(j, s);
  j = advanceExecution(j, "FIX"); // FIX allowed from any stage
  j = { ...j, stage: "PACKAGE" };
  assert.throws(() => advanceExecution(j, "DELIVERY_APPROVAL", { qaPassed: false }), /QA_PASS_REQUIRED/);
  j = advanceExecution(j, "DELIVERY_APPROVAL", { qaPassed: true });
  assert.throws(() => advanceExecution(j, "READY_TO_DELIVER", { ownerApproved: true }), /OWNER_DELIVERY_APPROVAL_REQUIRED/);
  assert.ok(EXECUTION_STAGES.includes("READY_TO_DELIVER"));
  assert.deepEqual(executionToolPlan("software")[1], "code_workspace");
  assert.deepEqual(executionToolPlan("nope"), executionToolPlan("GENERIC"));
});
