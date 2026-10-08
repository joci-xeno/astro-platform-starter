// M2 in the REAL runtime: the 30 agents reach real tools only through the broker; deny-by-default holds; research loop and dispatch hook work; sandbox only (nothing LIVE).
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import { tmp, rm } from "./helpers.mjs";
const { createRuntime } = await import("../atlasz-runtime/supervisor-safe.mjs");
import { validatePolicy, TOOL_POLICY } from "../atlasz-addons/agent-tool-policy.mjs";

const RENT = "The monthly rent for the Maple Street warehouse is 4200 dollars payable on the first business day.";
const boot = dir => createRuntime({ dataDir: dir, retryBaseMs: 0, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" }) });
let n = 0; const J = () => "hj" + (++n);

test("hosted: the approved policy validates individually against the REAL registry (34 tools, 0 invalid, nothing unlisted)", () => {
  const dir = tmp("at1-"); try {
    const rt = boot(dir), names = rt.tools.describe().map(t => t.name);
    const rows = validatePolicy({ inspect: x => rt.tools.inspect(x), toolNames: names });
    assert.equal(rows.length, 34); assert.deepEqual(rows.filter(r => !r.valid || r.unlisted), []); assert.deepEqual(names.filter(x => !TOOL_POLICY[x]), []);
    assert.equal(rt.dashboard().agentTools.status, "SANDBOX_ENFORCED_NOT_LIVE"); rt.stop?.();
  } finally { rm(dir); }
});
test("hosted: each of the 30 agents calls an allowed read-only tool and gets a real answer with a Black Box entry; denied tools never reach their handlers", async () => {
  const dir = tmp("at2-"); try {
    const rt = boot(dir), ids = rt.state.agents.map(a => a.id); assert.equal(ids.length, 30);
    for (const id of ids) { const r = await rt.agentTools.call({ agentId: id, jobId: J(), tool: "atlasz.queue", args: {} }); assert.equal(r.status, "OK", id); assert.equal(typeof r.result.full, "boolean"); }
    assert.equal(rt.brain.blackBox.query({ kind: "AGENT_TOOL_CALL" }).filter(e => e.decision === "OK").length, 30);
    const before = rt.pcc.summary ? JSON.stringify(rt.pcc.summary()) : "";
    const exec = "EXECUTION-3", search = "SEARCH-2";
    let k = 0; const nextExec = () => "EXECUTION-" + (10 + (k++ % 15));
    for (const [id0, tool, args] of [[exec, "pcc.add", { title: "x" }], [search, "pcc.agenda", {}], [exec, "money.panel", {}], [exec, "inbox.summary", {}], [exec, "sandbox.run_process_only", { language: "javascript", code: "1" }], [search, "sandbox.run", { language: "javascript", code: "1" }], [exec, "research.add_finding", { questionId: "q", claim: "c" }], [search, "model.complete", { prompt: "hi" }], [exec, "model.complete", { prompt: "hi" }], [exec, "voice.status", {}], [exec, "effort.choose", { task: {} }], [exec, "analyst.analyze", { csv: "a\n1" }], [exec, "chunk.plan", { text: "x" }], [exec, "agent.approve", {}], [exec, "money.send", {}]]) {
      const id = id0 === exec ? nextExec() : id0, r = await rt.agentTools.call({ agentId: id, jobId: J(), tool, args }); assert.equal(r.status, "DENIED", id + " " + tool);
    }
    assert.equal(before, rt.pcc.summary ? JSON.stringify(rt.pcc.summary()) : "", "the owner's personal command center was not touched");
    assert.equal(rt.sandbox.stats ? rt.sandbox.stats().runs ?? 0 : 0, 0);
    rt.stop?.();
  } finally { rm(dir); }
});
test("hosted: SEARCH agents run the whole research loop through the broker; EXECUTION agents can read the report but not write; injected fields are rejected; claims are not self-verified", async () => {
  const dir = tmp("at3-"); try {
    const rt = boot(dir), S = (tool, args, id = "SEARCH-1") => rt.agentTools.call({ agentId: id, jobId: J(), tool, args });
    const p = rt.knowledge.create({ tenantId: "JOCI", name: "Warehouse", allowedRoles: ["OWNER", "AGENT"] });
    const q = (await S("research.open_question", { projectId: p.id, text: "Monthly rent?" })).result;
    assert.equal((await S("research.add_source", { projectId: p.id, url: "https://example.org/a", retrievedAt: new Date().toISOString(), title: "Listing", text: RENT })).status, "OK");
    const f = (await S("research.add_finding", { questionId: q.id, claim: "monthly rent Maple Street warehouse 4200 dollars" })).result; assert.equal(f.createdBy, "AGENT");
    let r = (await S("research.report", { questionId: q.id }, "EXECUTION-9")).result; assert.equal(r.verifiedFacts.length, 0);
    assert.equal((await S("research.add_finding", { questionId: q.id, claim: "x" }, "EXECUTION-9")).status, "DENIED");
    assert.equal((await S("research.add_finding", { questionId: q.id, claim: "x", tenantId: "OTHER" })).status, "INVALID_ARGUMENTS");
    const cite = rt.knowledge.search(p.id, { query: "monthly rent", tenantId: "JOCI", role: "AGENT", forAgent: true }).results[0].citation;
    assert.equal((await S("research.attach_evidence", { findingId: f.id, citation: cite })).status, "OK");
    r = (await S("research.report", { questionId: q.id })).result; assert.equal(r.state, "ANSWERED");
    const priv = rt.knowledge.create({ tenantId: "JOCI", name: "Owner only" });
    assert.equal((await S("research.open_question", { projectId: priv.id, text: "x?" })).status, "HANDLER_ERROR", "the tool's own project permission still applies");
    rt.stop?.();
  } finally { rm(dir); }
});
test("hosted: EXECUTION agents use the isolated sandbox (timeout clamped, refuses without OS isolation rather than running unisolated); budgets apply to real tools", async () => {
  const dir = tmp("at4-"); try {
    const rt = boot(dir), E = (args, id = "EXECUTION-4") => rt.agentTools.call({ agentId: id, jobId: "sbx" + id, tool: "sandbox.run", args });
    const st = await rt.agentTools.call({ agentId: "EXECUTION-4", jobId: J(), tool: "sandbox.status", args: {} }); assert.equal(st.status, "OK");
    const r = await E({ language: "javascript", code: "console.log(1+1)", timeoutMs: 30000 }); assert.equal(r.status, "OK");
    assert.ok(["OK", "ISOLATION_NOT_AVAILABLE_NEEDS_OWNER_APPROVAL"].includes(r.result.status), r.result.status);
    if (r.result.status === "OK") assert.equal(r.result.stdout.trim(), "2");
    for (let i = 0; i < 2; i++) await E({ language: "javascript", code: "1" });
    assert.equal((await E({ language: "javascript", code: "1" })).reason, "TOOL_PER_JOB");
    rt.stop?.();
  } finally { rm(dir); }
});
test("hosted: governed dispatch hook - a task.toolPlan runs as the executing agent through the broker after screening (denied step stays denied); no plan = unchanged behaviour", async () => {
  const dir = tmp("at5-"); const hit = (id, text) => ({ objectID: id, comment_text: text, story_title: "Ask HN: freelancer?", created_at: new Date().toISOString() });
  try {
    const rt = createRuntime({ dataDir: dir, retryBaseMs: 0, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ hits: [hit("2", "I need a freelancer to build a small website, remote, budget $800, apply by email.")] }) }) });
    await rt.search(0); assert.equal(rt.state.candidates.length, 1);
    rt.state.candidates[0].toolPlan = [{ tool: "atlasz.queue", args: {} }, { tool: "pcc.add", args: { title: "evil" } }, { tool: "kp.list", args: {} }, { tool: "money.panel", args: {} }];
    await rt.execute(7);
    const calls = rt.brain.blackBox.query({ kind: "AGENT_TOOL_CALL" });
    assert.deepEqual(calls.map(c => [c.tool, c.decision]), [["atlasz.queue", "OK"], ["pcc.add", "DENIED"], ["kp.list", "OK"], ["money.panel", "DENIED"]]);
    assert.ok(calls.every(c => c.agentId === rt.state.agents[7].id && c.agentId.startsWith("EXECUTION-")));
    assert.equal(rt.agentToolSignals.length, 0);
    const base = rt.brain.blackBox.query({ kind: "AGENT_TOOL_CALL" }).length;
    await rt.search(0); // nothing new: duplicate
    assert.equal(rt.brain.blackBox.query({ kind: "AGENT_TOOL_CALL" }).length, base);
    rt.stop?.();
  } finally { rm(dir); }
});
test("hosted: Safe Mode stops every agent tool call (reads included) until the owner exits it", async () => {
  const dir = tmp("at6-"); try {
    const rt = boot(dir);
    assert.equal((await rt.agentTools.call({ agentId: "SEARCH-1", jobId: J(), tool: "atlasz.queue", args: {} })).status, "OK");
    rt.safeMode.enter("M2_TEST", {});
    const r = await rt.agentTools.call({ agentId: "SEARCH-1", jobId: J(), tool: "atlasz.queue", args: {} }); assert.deepEqual([r.status, r.reason], ["DENIED", "OWNER_STOP_OR_SAFE_MODE_ACTIVE"]);
    assert.equal(rt.agentTools.stats().inflight, 0); rt.stop?.();
  } finally { rm(dir); }
});
