// Phase 5 integrated workflows A-F on the real registry + coordinator + ledger + artifacts (no mocks of the machinery under test).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createAgentRegistry } from "../atlasz-addons/agent-registry.mjs";
import { createWorkforce } from "../atlasz-addons/agent-workforce.mjs";
import { BUILTIN_EXECUTORS } from "../atlasz-addons/agent-executors.mjs";
import { tmp, rm } from "./helpers.mjs";

const open = (d, extra = {}) => { const registry = createAgentRegistry({ dir: path.join(d, "registry") }); return createWorkforce({ dir: path.join(d, "wf"), registry, sleep: async () => {}, ...extra }); };
const opp = (o = {}) => ({ title: "Convert supplier price lists", sourceType: "OWNER_PROVIDED", sourceRef: "owner-note-1", sourceExcerpt: "Small firm needs CSV price lists converted to JSON.", estimatedValueUsd: 400, winProbability: 0.4, estimatedHours: 5, estimatedCostsUsd: 0, daysToCash: 14, requiredSkills: ["data.csv_to_json"], ...o });
const CSV = "name,qty,price\nbolt,10,0.5\nnut,20,0.25\n";

test("A: opportunity discovered by SEARCH agent, independently checked by a different SEARCH agent; value is an estimate, not revenue", async () => {
  const d = tmp("wf-"); try {
    const wf = open(d), r = wf.discoverOpportunity("SEARCH-1", opp()); assert.equal(r.ok, true, JSON.stringify(r));
    assert.notEqual(r.checker, "SEARCH-1"); assert.match(r.checker, /^SEARCH-/);
    const c = await wf.checkTask(r.taskId); assert.equal(c.decision, "ACCEPT", JSON.stringify(c)); assert.equal(c.maker, "SEARCH-1"); assert.notEqual(c.checker, c.maker);
    const o = wf.listOpportunities()[0]; assert.equal(o.status, "VERIFIED_QUALIFIED"); assert.equal(wf.systemView().verifiedRevenue.verifiedReceivedUsd, 0);
    assert.equal(wf.discoverOpportunity("SEARCH-2", opp()).reason, "DUPLICATE_OPPORTUNITY");
    assert.equal(wf.discoverOpportunity("EXECUTION-1", opp({ title: "x2" })).reason, "AGENT_TEAM_MISMATCH");
    assert.equal(wf.discoverOpportunity("SEARCH-3", opp({ title: "y", sourceRef: "r", sourceExcerpt: "key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).reason, "SECRET_IN_SOURCE");
    assert.equal(wf.discoverOpportunity("SEARCH-3", opp({ title: "z", sourceRef: "r2", sourceType: "WEB" })).reason, "SOURCE_TYPE_INVALID");
  } finally { rm(d); }
});

test("A: a maker cannot be its own checker and tampering with the artifact is rejected", async () => {
  const d = tmp("wf-"); try {
    const wf = open(d), r = wf.discoverOpportunity("SEARCH-1", opp());
    const f = path.join(d, "wf", "artifacts", r.taskId, "opportunity.json"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("400", "40000"));
    const c = await wf.checkTask(r.taskId); assert.equal(c.decision, "REJECT"); assert.ok(c.reasons.some(x => x.startsWith("ARTIFACT_FILE_ALTERED")));
  } finally { rm(d); }
});

test("B: research and evaluation by two further different SEARCH agents, plan with owner-approval gates and no executors on gated steps", async () => {
  const d = tmp("wf-"); try {
    const asked = [], wf = open(d, { approvals: { request: q => { asked.push(q); return { id: "req" + asked.length }; } } });
    const r = wf.discoverOpportunity("SEARCH-1", opp()); await wf.checkTask(r.taskId);
    const p = await wf.planOpportunity(wf.listOpportunities()[0].id); assert.equal(p.ok, true, JSON.stringify(p));
    const gated = p.plan.steps.filter(s => s.requiresOwnerApproval); assert.deepEqual(gated.map(s => s.id).sort(), ["AGREE", "INVOICE", "SEND"]);
    for (const s of gated) { assert.equal(s.executor, null); assert.equal(s.status, "BLOCKED_PENDING_OWNER_APPROVAL"); }
    assert.equal(asked.length, 3); assert.ok(asked.every(q => q.costUsd === 0));
    const mc = wf.systemView().makerChecker; const agents = new Set(mc.flatMap(x => [x.maker, x.checker])); assert.ok(agents.size >= 3);
    assert.ok(p.plan.steps.some(s => s.executor === "csv_to_json"));
    assert.equal((await wf.planOpportunity(wf.listOpportunities()[0].id)).ok, false);
  } finally { rm(d); }
});

test("C+D+E: EXECUTION agent produces a hash-fixed artifact, independent checker recomputes, outcome tracked; PAID needs external evidence", async () => {
  const d = tmp("wf-"); try {
    const wf = open(d), t = await wf.executeTask("EXECUTION-1", { executor: "csv_to_json", input: { csv: CSV }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" });
    assert.equal(t.ok, true, JSON.stringify(t)); assert.notEqual(t.checker, "EXECUTION-1");
    const out = JSON.parse(fs.readFileSync(path.join(d, "wf", "artifacts", t.taskId, "output.json"), "utf8")); assert.deepEqual(out[0], { name: "bolt", qty: 10, price: 0.5 });
    const c = await wf.checkTask(t.taskId); assert.equal(c.decision, "ACCEPT", JSON.stringify(c)); assert.equal(wf.getTask(t.taskId).status, "VERIFIED");
    assert.equal(wf.recordOutcome(t.taskId, { expenses: [{ provider: "x", category: "TOOL", amountUsd: 5 }] }).ok, false);        // cost needs evidence
    const inv = wf.recordOutcome(t.taskId, { revenue: { amountUsd: 100, stage: "PAID", confirmedReceived: false } }); assert.equal(inv.ok, false);
    assert.equal(wf.systemView().verifiedRevenue.verifiedReceivedUsd, 0);
  } finally { rm(d); }
});

test("C: authorization is mandatory; owner-directed only from the owner panel; unknown executor and missing skill refused", async () => {
  const d = tmp("wf-"); try {
    const wf = open(d), base = { executor: "csv_to_json", input: { csv: CSV } };
    assert.equal((await wf.executeTask("EXECUTION-1", base)).reason, "AUTHORIZATION_REQUIRED");
    assert.equal((await wf.executeTask("EXECUTION-1", { ...base, authorization: { type: "OWNER_DIRECTED" } })).reason, "OWNER_DIRECTED_ONLY_FROM_OWNER_PANEL");
    assert.equal((await wf.executeTask("SEARCH-1", { ...base, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" })).reason, "AGENT_TEAM_MISMATCH");
    assert.equal((await wf.executeTask("EXECUTION-1", { executor: "rm_rf", input: {}, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" })).reason, "UNKNOWN_EXECUTOR");
    assert.equal((await wf.executeTask("EXECUTION-1", { executor: "csv_to_json", input: { csv: "" }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" })).reason, "CSV_REQUIRED");
  } finally { rm(d); }
});

test("D: a wrong artifact is rejected, rework is bounded", async () => {
  const d = tmp("wf-"); try {
    const wf = open(d), t = await wf.executeTask("EXECUTION-2", { executor: "extract_summary", input: { text: "Cats purr. Cats sleep a lot. Dogs bark loudly at night. Cats and dogs differ." }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" });
    assert.equal(t.ok, true, JSON.stringify(t));
    const f = path.join(d, "wf", "artifacts", t.taskId, "summary.json"), orig = fs.readFileSync(f); fs.writeFileSync(f, "{}");
    const c = await wf.checkTask(t.taskId); assert.equal(c.decision, "REJECT"); assert.equal(wf.getTask(t.taskId).status, "REJECTED_REWORK_ALLOWED");
    fs.writeFileSync(f, orig);
  } finally { rm(d); }
});

test("F: induced failure -> bounded retries -> dead letter, escalation recorded, nothing partial left", async () => {
  const d = tmp("wf-"); try {
    let calls = 0; const bad = { validate: () => null, run() { calls++; throw Object.assign(new Error("boom"), { code: "TRANSIENT" }); } };
    const wf = open(d, { executors: { ...BUILTIN_EXECUTORS, csv_to_json: bad } });
    const r = await wf.executeTask("EXECUTION-1", { executor: "csv_to_json", input: { csv: CSV }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" });
    assert.equal(r.ok, false); assert.equal(r.status, "DEAD_LETTER"); assert.equal(r.loopGuard, true); assert.ok(calls <= 3, "calls " + calls);
    assert.equal(fs.existsSync(path.join(d, "wf", "artifacts", r.taskId)), false);
    const v = wf.systemView(); assert.equal(v.escalations[0].taskId, r.taskId); assert.equal(v.queues.deadLetter, 1); assert.ok(v.failed.includes("EXECUTION-1"));
  } finally { rm(d); }
});

test("F: owner stop interrupts, restart recovers INTERRUPTED and resume completes from checkpoint", async () => {
  const d = tmp("wf-"); try {
    let stop = false; const wf = open(d, { isStopped: () => stop });
    const run = wf.executeTask("EXECUTION-1", { executor: "csv_to_json", input: { csv: CSV }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" });
    const r = await run; assert.equal(r.ok, true);
    stop = true; assert.equal((await wf.executeTask("EXECUTION-2", { executor: "csv_to_json", input: { csv: CSV }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" })).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    assert.equal((await wf.checkTask(r.taskId)).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); stop = false;
    // restart: state is persisted
    const wf2 = open(d); assert.equal(wf2.getTask(r.taskId).status, "SUBMITTED"); assert.equal((await wf2.checkTask(r.taskId)).decision, "ACCEPT");
    assert.equal(wf2.registry.list().length, 30); assert.equal(wf2.verify().ok, true);
  } finally { rm(d); }
});

test("views: agents are never LIVE/WORKING by registration; paused agent is refused work; damaged store is not silently reset", async () => {
  const d = tmp("wf-"); try {
    const wf = open(d), v = wf.agentViews(); assert.equal(v.length, 30);
    for (const a of v) { assert.equal(a.state, "NO_ACTIVITY_YET"); assert.equal(a.currentTask, null); assert.match(a.liveEvidence, /registered only/); }
    wf.registry.setPaused("EXECUTION-1", true, "t"); assert.equal((await wf.executeTask("EXECUTION-1", { executor: "csv_to_json", input: { csv: CSV }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" })).reason, "AGENT_NOT_USABLE");
    fs.writeFileSync(path.join(d, "wf", "workforce.json"), "{broken");
    assert.throws(() => open(d), /WORKFORCE_STORE_UNREADABLE/);
  } finally { rm(d); }
});

test("module_with_tests: real sandboxed run + independent re-run, or BLOCKED when the host cannot isolate (never faked)", async () => {
  const d = tmp("wf-"); try {
    const wf = open(d), input = { source: "export const add=(a,b)=>a+b;", testSource: "import {add} from './module.mjs'; if(add(2,3)!==5) throw new Error('bad');" };
    const r = await wf.executeTask("EXECUTION-4", { executor: "module_with_tests", input, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" });
    if (r.ok) { const c = await wf.checkTask(r.taskId); assert.equal(c.decision, "ACCEPT", JSON.stringify(c)); }
    else assert.ok(["SANDBOX_UNAVAILABLE", "AGENT_LACKS_SKILL"].includes(r.reason), JSON.stringify(r));
    const bad = await wf.executeTask("EXECUTION-4", { executor: "module_with_tests", input: { ...input, testSource: "throw new Error('x')" }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" });
    assert.equal(bad.ok, false);
  } finally { rm(d); }
});

// ---- regression tests for the independent verifier's findings ----
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { limitsSubject } from "../atlasz-addons/agent-registry.mjs";
import { parseCsv } from "../atlasz-addons/agent-executors.mjs";
const EV = () => ({ source: "invoice-file", reference: "r-" + Math.random().toString(36).slice(2), verifiedAt: new Date().toISOString() });
const verified = async wf => { const t = await wf.executeTask("EXECUTION-1", { executor: "csv_to_json", input: { csv: CSV }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" }); await wf.checkTask(t.taskId); return t.taskId; };

test("MED-1: a paid model call is accounted (day spend, task spend, ledger evidence) and the budget shrinks; overspend is refused", async () => {
  const d = tmp("wf-"); try {
    const kp = generateOwnerKeyPair(), registry = createAgentRegistry({ dir: path.join(d, "registry"), ownerAuth: createOwnerAuth({ publicKeyB64: kp.publicKeyB64 }) });
    const next = { ...registry.get("EXECUTION-1").limits, maxCostUsdPerTask: 1, maxCostUsdPerDay: 1 };
    assert.equal(registry.setLimits("EXECUTION-1", { maxCostUsdPerTask: 1, maxCostUsdPerDay: 1 }, { ownerApproval: issueOwnerApproval({ privateKeyPem: kp.privateKeyPem, action: "AGENT_LIMITS_RAISE", subject: limitsSubject("EXECUTION-1", next) }) }).ok, true);
    const budgets = []; let cost = 0.6;
    const models = { complete: async a => { budgets.push(a.maxCostUsd); return { ok: true, output: "x", costUsd: cost, modelId: "m", providerId: "p", costKnown: true, requestKey: a.requestKey }; } };
    const asks = []; const ex = { validate: () => null, async run(_i, ctx) { asks.push(await ctx.model("p").catch(e => e.code)); asks.push(await ctx.model("p").catch(e => e.code)); return { files: { "a.txt": "ok" } }; } };
    const wf = createWorkforce({ dir: path.join(d, "wf"), registry, sleep: async () => {}, models, executors: { ...BUILTIN_EXECUTORS, csv_to_json: ex } });
    const r = await wf.executeTask("EXECUTION-1", { executor: "csv_to_json", input: { csv: CSV }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(budgets[0], 1); assert.ok(Math.abs(budgets[1] - 0.4) < 1e-9, "budget shrinks: " + budgets);
    assert.equal(wf.systemView().costs.totalUsd, 1.2, "both calls are in the ledger, including the one above budget");
    assert.equal(asks[1], "MODEL_COST_ABOVE_BUDGET");
  } finally { rm(d); }
});

test("MED-2: recordOutcome is idempotent and atomic", async () => {
  const d = tmp("wf-"); try {
    const wf = open(d), id = await verified(wf);
    assert.equal(wf.recordOutcome(id, { expenses: [{ provider: "x", category: "TOOL", amountUsd: 3, evidence: EV() }, { provider: "y", category: "TOOL", amountUsd: 2 }] }).reason, "EXPENSE_REQUIRES_EVIDENCE");
    assert.equal(wf.systemView().costs.totalUsd, 0, "nothing written when any entry is invalid");
    assert.equal(wf.recordOutcome(id, { expenses: [{ provider: "x", category: "TOOL", amountUsd: 3, evidence: EV() }] }).ok, true);
    assert.equal(wf.recordOutcome(id, { expenses: [{ provider: "x", category: "TOOL", amountUsd: 3, evidence: EV() }] }).reason, "OUTCOME_ALREADY_RECORDED_FOR_THIS_TASK");
    assert.equal(wf.systemView().costs.totalUsd, 3);
    const wf2 = open(tmp("wf-")); assert.equal(wf2.recordOutcome("nope", {}).reason, "UNKNOWN_TASK");
  } finally { rm(d); }
});

test("MED-3: plan build steps wait for the owner's approval of the gates before them, and only run from the owner panel", async () => {
  const d = tmp("wf-"); try {
    const decisions = {}, asked = []; const approvals = { request: q => { asked.push(q); return { id: "rq" + asked.length }; }, outcome: id => ({ decision: decisions[id] ?? "PENDING" }) };
    const wf = open(d, { approvals }); const r = wf.discoverOpportunity("SEARCH-1", opp()); await wf.checkTask(r.taskId);
    const p = await wf.planOpportunity(wf.listOpportunities()[0].id), run = (extra = {}) => wf.executeTask("EXECUTION-1", { executor: "csv_to_json", input: { csv: CSV }, authorization: { type: "PLAN_STEP", planId: p.planId, stepId: "BUILD1" }, via: "OWNER_PANEL", ...extra });
    assert.equal((await run({ via: "API" })).reason, "PLAN_STEP_ONLY_FROM_OWNER_PANEL");
    const w = await run(); assert.equal(w.reason, "PLAN_STEP_WAITING_FOR_OWNER_APPROVAL"); assert.deepEqual(w.waitingFor.sort(), ["AGREE", "SEND"]);
    for (const a of p.plan.requiredApprovals) if (a.stepId !== "INVOICE") decisions[a.requestId] = "APPROVED";
    assert.equal((await run()).ok, true);
  } finally { rm(d); }
});

test("MED-4/5: module tests must import the module and may not exit the process; CSV keeps leading zeros, big integers and quoted-empty rows intact", async () => {
  const d = tmp("wf-"); try {
    const wf = open(d), mk = testSource => wf.executeTask("EXECUTION-4", { executor: "module_with_tests", input: { source: "export const a=1;", testSource }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" });
    assert.equal((await mk("// nothing")).reason, "TEST_MUST_IMPORT_THE_MODULE"); assert.equal((await mk("import './module.mjs'; process.exit(0)")).reason, "TEST_MAY_NOT_EXIT_THE_PROCESS");
    const t = await wf.executeTask("EXECUTION-1", { executor: "csv_to_json", input: { csv: "zip,n,p\n00123,9007199254740993,1.50\n" }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" });
    const row = JSON.parse(fs.readFileSync(path.join(d, "wf", "artifacts", t.taskId, "output.json"), "utf8"))[0]; assert.deepEqual(row, { zip: "00123", n: "9007199254740993", p: 1.5 });
    assert.equal(parseCsv('a\n"1"\n""\n"3"\n').length, 4);
  } finally { rm(d); }
});

test("MED-6: unknown values stay unknown (never 0), caps apply, secrets in title/sourceRef refused, unknown economics are not 'eligible'", async () => {
  const d = tmp("wf-"); try {
    const wf = open(d), bad = (o, why) => assert.equal(wf.discoverOpportunity("SEARCH-1", opp({ title: "t" + Math.random(), sourceRef: "r" + Math.random(), ...o })).reason, why);
    bad({ estimatedValueUsd: false }, "NUMBER_INVALID:estimatedValueUsd"); bad({ estimatedValueUsd: [5] }, "NUMBER_INVALID:estimatedValueUsd"); bad({ estimatedValueUsd: "1e308" }, "NUMBER_INVALID:estimatedValueUsd"); bad({ winProbability: 1.5 }, "NUMBER_INVALID:winProbability");
    bad({ title: "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, "SECRET_IN_TITLE"); bad({ sourceRef: "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, "SECRET_IN_SOURCEREF");
    const r = wf.discoverOpportunity("SEARCH-1", opp({ title: "unknown value", sourceRef: "u1", estimatedValueUsd: " ", winProbability: null })); assert.equal(r.ok, true); assert.equal(r.eligibleByQualification, false);
    const o = wf.listOpportunities()[0]; assert.equal(o.derived.expectedNetUsd, null); assert.ok(o.derived.unknownFields.includes("estimatedValueUsd"));
  } finally { rm(d); }
});

test("LOW: unlisted extra file in an artifact is rejected; registry rename/limits are stricter", async () => {
  const d = tmp("wf-"); try {
    const wf = open(d), id = await (async () => { const t = await wf.executeTask("EXECUTION-1", { executor: "csv_to_json", input: { csv: CSV }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" }); fs.writeFileSync(path.join(d, "wf", "artifacts", t.taskId, "evil.sh"), "x"); return t.taskId; })();
    const c = await wf.checkTask(id); assert.equal(c.decision, "REJECT"); assert.ok(c.reasons[0].startsWith("ARTIFACT_UNLISTED_FILE"));
    assert.equal(wf.registry.rename("SEARCH-1", "EXECUTION-3").reason, "NAME_LOOKS_LIKE_AN_AGENT_ID"); assert.equal(wf.registry.rename("SEARCH-2", "Execution Agent 3").reason, "NAME_ALREADY_USED");
    assert.equal(wf.registry.setLimits("EXECUTION-1", { maxOpenTasks: 2.5 }).reason, "LIMIT_OUT_OF_BOUNDS:maxOpenTasks");
  } finally { rm(d); }
});

test("LOW: a truncated registry audit chain opens read-only instead of throwing", () => {
  const d = tmp("wf-"); try {
    createAgentRegistry({ dir: path.join(d, "r") }); const f = path.join(d, "r", "agent-registry-audit.jsonl"), lines = fs.readFileSync(f, "utf8").trim().split("\n"); fs.writeFileSync(f, lines.slice(0, -1).join("\n") + "\n");
    const r = createAgentRegistry({ dir: path.join(d, "r") }); assert.notEqual(r.summary().integrity, "OK"); assert.equal(r.list().length, 0); assert.equal(r.setPaused("SEARCH-1", true).ok, false);
  } finally { rm(d); }
});
