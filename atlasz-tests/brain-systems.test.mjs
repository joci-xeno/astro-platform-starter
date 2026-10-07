import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createEmergencyStop } from "../atlasz-addons/emergency-stop.mjs";
import { createGovernance } from "../atlasz-addons/brain/governance.mjs";
import { createBlackBox } from "../atlasz-addons/brain/black-box.mjs";
import { createCapabilityGraph } from "../atlasz-addons/brain/capability-graph.mjs";
import { createPlanningBrain } from "../atlasz-addons/brain/planning-brain.mjs";
import { createVerifier } from "../atlasz-addons/brain/verifier.mjs";
import { createSecurityBrain } from "../atlasz-addons/brain/security-brain.mjs";
import { createOrchestrator } from "../atlasz-addons/brain/orchestrator.mjs";
import { createModelIntelligence } from "../atlasz-addons/brain/model-intelligence.mjs";
import { createSimulationLab, SimulationLiveActionBlocked } from "../atlasz-addons/brain/simulation-lab.mjs";
import { createCentralBrain, createBrainBus, BRAINS } from "../atlasz-addons/brain/central-brain.mjs";
import { tmp, rm } from "./helpers.mjs";

function owner() { const k = generateOwnerKeyPair(); return { auth: createOwnerAuth({ publicKeyB64: k.publicKeyB64 }), ap: (action, subject) => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action, subject }) }; }
const ok = () => ({ ok: true });

// ---------- model intelligence ----------
let clockNow = 0;
function models() {
  const g = createCapabilityGraph(), mi = createModelIntelligence({ graph: g, clockMs: () => clockNow });   // deterministic latency: probes advance this clock explicitly, never the wall clock
  mi.register({ id: "fast", family: "fA", costClass: "FREE", contextLimit: 8000, tools: [], capabilities: ["text"], requiredCredentials: ["K1"] });
  mi.register({ id: "strong", family: "fB", costClass: "FREE", contextLimit: 200000, tools: ["code"], capabilities: ["text", "reason"], requiredCredentials: ["K2"] });
  mi.register({ id: "other", family: "fC", costClass: "FREE", contextLimit: 32000, tools: ["code"], capabilities: ["text", "reason"], requiredCredentials: ["K3"] });
  mi.register({ id: "paid", family: "fD", costClass: "HIGH", contextLimit: 1000000, capabilities: ["text", "reason"], requiredCredentials: ["K4"] });
  for (const id of ["fast", "strong", "other", "paid"]) g.setCredentials(id, true);
  return { g, mi };
}
test("model intelligence: nothing is LIVE without a real passing probe; failed probes mark DOWN; routing honors context/tools/cost", async () => {
  const { g, mi } = models();
  assert.equal(mi.route({ capabilities: ["text"] }).modelId, null); assert.ok(mi.health().every(h => h.state === "NOT_PROBED"));
  assert.equal((await mi.probe("fast", async () => ({ ok: true }))).ok, true);
  assert.equal((await mi.probe("strong", async () => ({ ok: true }))).ok, true);
  assert.equal((await mi.probe("other", async () => { throw new Error("401"); })).ok, false);
  assert.equal((await mi.probe("paid", async () => ({ ok: true }))).ok, true);
  assert.equal((await mi.probe("fast", async () => ({ ok: false }))).ok, false);                    // ok:false is a failure, not a pass
  assert.equal(g.view("fast").usable, false); await mi.probe("fast", async () => ({ ok: true }));
  const h = Object.fromEntries(mi.health().map(x => [x.id, x.state])); assert.equal(h.other, "DOWN"); assert.equal(h.strong, "LIVE");
  assert.equal(mi.route({ capabilities: ["text"], complexity: "HIGH" }).modelId, "strong");           // paid excluded by no-spend default
  assert.equal(mi.route({ capabilities: ["text"], minContext: 100000 }).modelId, "strong");
  assert.equal(mi.route({ capabilities: ["reason"], minContext: 500000 }).modelId, null);             // only the paid one qualifies and spend is not allowed
  assert.equal(mi.route({ capabilities: ["reason"], minContext: 500000, allowCost: true }).modelId, "paid");
  assert.equal(mi.route({ capabilities: ["text"], needsTools: ["code"] }).modelId, "strong");
  assert.equal(mi.route({ capabilities: ["text"], preferFamilyNot: "fB" }).modelId, "fast");
  await assert.rejects(mi.probe("zzz", ok), /UNKNOWN_MODEL/);
});
test("model intelligence: multi-model workflows need distinct live families; a model never reviews itself", async () => {
  const { mi } = models();
  assert.equal(mi.workflow("GENERATE_CRITIQUE_VERIFY", { capabilities: ["text"] }).blocked, true);
  await mi.probe("fast", async () => { clockNow += 1; return { ok: true }; }); await mi.probe("strong", async () => { clockNow += 50; return { ok: true }; });
  const two = mi.workflow("GENERATE_CRITIQUE_VERIFY", { capabilities: ["text"] }); assert.equal(two.blocked, true); assert.match(two.reason, /DISTINCT_LIVE_MODEL_FAMILIES/);
  await mi.probe("other", async () => { clockNow += 20; return { ok: true }; });
  const w = mi.workflow("GENERATE_CRITIQUE_VERIFY", { capabilities: ["text"] }); assert.equal(w.blocked, false); assert.equal(new Set(w.steps.map(s => s.family)).size, 3);
  const t = mi.workflow("FAST_TRIAGE_STRONG_QA", { capabilities: ["text"] }); assert.equal(t.steps[0].modelId, "fast"); assert.equal(new Set(t.steps.map(s => s.family)).size, 3);
  assert.throws(() => mi.workflow("NOPE"), /UNKNOWN_WORKFLOW/);
});

// ---------- simulation lab ----------
test("simulation: clones state, never touches it, traps every LIVE action, can never run as LIVE, result is never proof", () => {
  const lab = createSimulationLab(), state = { config: { route: "A" }, queue: [1, 2] };
  const r = lab.run({ name: "bad change", kind: "CONFIG_CHANGE", state, scenario: w => { w.state.config.route = "B"; w.live.deploy({ x: 1 }); return {}; } });
  assert.equal(r.verdict, "FAIL"); assert.match(r.violations[0], /SIMULATION_LIVE_ACTION_BLOCKED:deploy/); assert.equal(r.liveAttemptsBlocked.length, 1);
  assert.deepEqual(state, { config: { route: "A" }, queue: [1, 2] }); assert.equal(r.stateUntouched, true); assert.equal(r.isProof, false); assert.equal(r.environment, "SIMULATION");
  assert.throws(() => lab.run({ name: "x", kind: "X", state, scenario: () => ({}), environment: "LIVE" }), /CANNOT_RUN_LIVE/);
  assert.throws(() => lab.run({ name: "x", kind: "X", state, scenario: () => ({}), environment: "PROD" }), /BAD_ENVIRONMENT/);
  assert.equal(lab.run({ name: "ok", kind: "X", state, scenario: w => { w.state.queue.push(3); return {}; } }).verdict, "PASS_IN_SIMULATION");
  assert.ok(new SimulationLiveActionBlocked("x") instanceof Error);
});
test("simulation: provider outage, queue crash recovery, rollback, routing/config changes, money transitions", () => {
  const lab = createSimulationLab();
  assert.equal(lab.providerOutage({ providers: ["p1", "p2"], outage: ["p1"] }).verdict, "PASS_IN_SIMULATION");
  assert.match(lab.providerOutage({ providers: ["p1", "p2"], outage: ["p1", "p2"] }).violations[0], /NO_PROVIDER_AVAILABLE/);
  assert.equal(lab.queueFailure({ jobs: ["a", "b", "c", "d"], crashAfter: 2 }).verdict, "PASS_IN_SIMULATION");
  assert.equal(lab.rollback({ before: { v: 1, cfg: { a: 1 } }, change: s => { s.v = 2; s.cfg.a = 9; }, rollbackFn: s => { s.v = 1; s.cfg.a = 1; } }).verdict, "PASS_IN_SIMULATION");
  assert.equal(lab.rollback({ before: { v: 1 }, change: s => { s.v = 2; }, rollbackFn: s => { s.v = 3; } }).verdict, "FAIL");   // incomplete rollback detected
  assert.equal(lab.change({ kind: "AGENT_ROUTING_CHANGE", name: "route all to one agent", state: { routes: { a: "E1", b: "E2" } }, mutate: s => { s.routes.b = "E1"; }, invariants: [{ name: "no agent overloaded", check: s => Object.values(s.routes).filter(x => x === "E1").length < 2 }] }).verdict, "FAIL");
  const good = ["DISCOVERED", "QUALIFIED", "PROPOSAL_DRAFT", "APPROVED_TO_SEND", "SENT", "WON", "ASSIGNED", "EXECUTING", "QA_PASSED", "DELIVERY_APPROVED", "DELIVERED", "INVOICE_APPROVED", "INVOICED", "PAID_VERIFIED"];
  assert.equal(lab.moneyTransitions({ path: good, evidence: { paymentConfirmedByLedger: true, customerAcceptance: true } }).verdict, "PASS_IN_SIMULATION");
  assert.match(lab.moneyTransitions({ path: good, evidence: { customerAcceptance: true } }).violations.join(), /PAID_VERIFIED_WITHOUT_LEDGER_EVIDENCE/);
  assert.match(lab.moneyTransitions({ path: ["INVOICED", "PAID_CLAIMED", "PAID_VERIFIED"], evidence: { paymentConfirmedByLedger: true } }).violations.join(), /UNKNOWN_STATE:PAID_CLAIMED/);   // customer says paid is not a pipeline state
  assert.match(lab.moneyTransitions({ path: ["DISCOVERED", "PAID_VERIFIED"], evidence: { paymentConfirmedByLedger: true } }).violations.join(), /ILLEGAL:DISCOVERED->PAID_VERIFIED/);
  assert.match(lab.moneyTransitions({ path: ["SENT", "WON"], evidence: {} }).violations.join(), /WON_WITHOUT_CUSTOMER_ACCEPTANCE/);
  assert.ok(lab.runs().every(r => r.isProof === false && r.environment === "SIMULATION"));
});

// ---------- central brain + bus ----------
test("brain bus: topic ACLs, forbidden authority topics, no loops, hop cap; nothing can publish GRANT_PERMISSION", async () => {
  const bb = createBlackBox(), bus = createBrainBus({ blackBox: bb, maxHops: 3 }), got = [];
  bus.subscribe("PLANNING", "TASK_ANALYZED", async m => { got.push("planning:" + m.from); await bus.publish("PLANNING", "PLAN_CREATED", {}, m.path); });
  bus.subscribe("ORCHESTRATOR", "PLAN_CREATED", async m => { got.push("orch"); });
  bus.subscribe("CENTRAL", "PLAN_CREATED", async () => got.push("central-should-not-loop"));
  assert.equal((await bus.publish("CENTRAL", "TASK_ANALYZED", { t: 1 })).delivered, 1);
  assert.deepEqual(got, ["planning:CENTRAL", "orch"]);                                              // CENTRAL already on the causal path => not re-invoked
  for (const brain of BRAINS) for (const t of ["GRANT_PERMISSION", "OWNER_AUTH", "DISABLE_KILL_SWITCH", "SELF_APPROVE"]) assert.equal((await bus.publish(brain, t)).reason, "FORBIDDEN_TOPIC");
  assert.equal((await bus.publish("SECURITY", "TASK_ASSIGNED")).reason, "SENDER_NOT_ALLOWED_TO_PUBLISH_TOPIC");
  assert.equal((await bus.publish("ROGUE", "TASK_ANALYZED")).reason, "UNKNOWN_SENDER");
  assert.throws(() => bus.subscribe("PLANNING", "GRANT_PERMISSION", () => {}), /FORBIDDEN_TOPIC/);
  assert.equal((await bus.publish("CENTRAL", "TASK_ANALYZED", {}, ["A", "B", "C"])).reason, "MAX_HOPS_EXCEEDED");
  assert.ok(bus.denied().length >= 18); assert.ok(bb.query({ kind: "BUS_DENIED" }).length >= 18);
});
test("central brain: snapshot reports NOT_CONNECTED instead of inventing state; decision brief names agent/model/approval and flags gaps", () => {
  const { auth } = owner(), g = createCapabilityGraph(), pb = createPlanningBrain(), gov = createGovernance({ gate: () => ({ allowed: true }), ownerAuth: auth });
  g.upsert({ id: "E1", type: "AGENT", capabilities: ["build"] });
  const cb = createCentralBrain({ graph: g, planner: pb, governance: gov, sources: { agents: () => [{ id: "E1" }], costs: () => { throw new Error("ledger down"); } } });
  const s = cb.snapshot(); assert.equal(s.agents.state, "OK"); assert.equal(s.jobs.state, "NOT_CONNECTED"); assert.equal(s.costs.state, "ERROR"); assert.equal(s.recoveryState.state, "NOT_CONNECTED"); assert.equal(s.capabilityGraph.data.total, 1);
  const d = cb.decide({ what: "Build page", why: "customer job", capabilities: ["build"], successCriteria: "page exists" });
  assert.equal(d.which.agent, "E1"); assert.equal(d.ownerApprovalRequired, false); assert.equal(d.matched, true);
  const spend = cb.decide({ what: "Buy asset", capabilities: ["build", "design"], estCostUsd: 20 }); assert.equal(spend.ownerApprovalRequired, true); assert.equal(spend.approvalAction, "BRAIN_SPEND"); assert.ok(spend.expected.risks.some(r => /CAPABILITY_GAP/.test(r))); assert.equal(spend.matched, false);
  assert.equal(cb.decide({ what: "x", governanceAction: "DISABLE_AUDIT" }).forbidden, true);
  assert.match(cb.decide({ what: "x" }).verification, /UNDEFINED/); assert.throws(() => cb.decide({}), /WHAT_REQUIRED/);
  assert.throws(() => createCentralBrain({}), /REQUIRES/);
});

// ---------- end-to-end wiring against the REAL emergency stop ----------
test("wiring: the real owner kill switch halts a Brain plan with an external step; resuming it (owner-signed) lets the plan continue", async () => {
  const d = tmp("brain-e2e-");
  try {
    const k = generateOwnerKeyPair(), auth = createOwnerAuth({ publicKeyB64: k.publicKeyB64 }), ap = (action, subject) => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action, subject });
    const es = createEmergencyStop({ statePath: path.join(d, "es.json"), auditPath: path.join(d, "es-audit.jsonl"), ownerAuth: auth });
    const gov = createGovernance({ gate: es.gate, ownerAuth: auth }), graph = createCapabilityGraph(), planner = createPlanningBrain(), bb = createBlackBox({ filePath: path.join(d, "bb.jsonl") });
    const roster = [...Array.from({ length: 5 }, (_, i) => ({ id: "S" + (i + 1), team: "SEARCH" })), ...Array.from({ length: 25 }, (_, i) => ({ id: "E" + (i + 1), team: "EXECUTION" }))];
    for (const a of roster) graph.upsert({ id: a.id, type: "AGENT", capabilities: ["work"] });
    let sent = 0; const ex = Object.fromEntries(roster.map(a => [a.id, async ({ task }) => { const f = path.join(d, task.id); fs.writeFileSync(f, "x"); if (task.external) sent++; return { claimType: "ARTIFACT", claim: { path: f } }; }]));
    const o = createOrchestrator({ roster, graph, planner, governance: gov, verifier: createVerifier(), blackBox: bb, executors: ex, security: createSecurityBrain({ ownerAuth: auth }) });
    const p = planner.createPlan({ goal: "g", projects: [{ milestones: [{ tasks: [{ id: "t1", capabilities: ["work"] }, { id: "t2", dependsOn: ["t1"], capabilities: ["work"], external: true, governanceAction: "SEND_EXTERNAL" }] }] }] });
    es.setMode({ mode: "STOP_EXTERNAL_ACTIONS", reason: "test", ownerApproval: ap("EMERGENCY_STOP", "STOP_EXTERNAL_ACTIONS") });
    const r1 = await o.runPlan(p.id, { ownerApproval: ap("BRAIN_SEND_EXTERNAL", "t2") });
    assert.equal(r1.halted, "STOPPED"); assert.equal(sent, 0); assert.equal(planner.get(p.id).tasks.t1.status, "DONE");     // internal work continued, external step did not run
    es.setMode({ mode: "RUNNING", reason: "ok", confirm: "RESUME", ownerApproval: ap("EMERGENCY_RESUME", "RUNNING") });
    planner.resume(p.id, "t2");
    const r2 = await o.runPlan(p.id, { ownerApproval: ap("BRAIN_SEND_EXTERNAL", "t2") });
    assert.equal(r2.progress.status, "COMPLETE"); assert.equal(sent, 1);
    assert.equal(bb.verify().ok, true); assert.equal(gov.audit.verify().ok, true);
  } finally { rm(d); }
});
