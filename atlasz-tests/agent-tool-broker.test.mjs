// M2 broker: deny-by-default permission matrix, D2 limits, approval-queue integration (D7), fail-closed behaviour. Spy handlers prove a refused call never reaches a tool.
import test from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry } from "../atlasz-addons/typed-tools.mjs";
import { createAgentToolBroker } from "../atlasz-addons/agent-tool-broker.mjs";
import { TOOL_POLICY, DEFAULT_LIMITS, validatePolicy, permissionFor, roleOf } from "../atlasz-addons/agent-tool-policy.mjs";
import { createApprovalRequests } from "../atlasz-addons/approval-requests.mjs";
import { approvalActionName } from "../atlasz-addons/owner-control/owner-authority.mjs";
import { rig } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

const SEARCH = Array.from({ length: 5 }, (_, i) => "SEARCH-" + (i + 1)), EXEC = Array.from({ length: 25 }, (_, i) => "EXECUTION-" + (i + 1)), ALL = [...SEARCH, ...EXEC];
const roster = () => ALL.map(id => ({ id, team: id.startsWith("S") ? "SEARCH" : "EXECUTION" }));
const SCHEMA = { type: "object", properties: { x: { type: "string", maxLength: 100000 }, text: { type: "string", maxLength: 300000 }, prompt: { type: "string", maxLength: 300000 }, timeoutMs: { type: "integer" } }, additionalProperties: false };

function setup({ policy = TOOL_POLICY, limits = DEFAULT_LIMITS, clock = null, handlers = {}, withApprovals = false } = {}) {
  const r = rig({ roster: roster() }), calls = [], t = { v: 1_000_000 };
  const reg = createToolRegistry({ chain: r.sys.chain, blackBox: r.blackBox });
  for (const e of Object.values(TOOL_POLICY)) reg.register({ name: e.tool, description: e.tool, operation: e.operation, input: SCHEMA, handler: async a => { calls.push({ tool: e.tool, a }); return handlers[e.tool] ? handlers[e.tool](a) : { ok: true, tool: e.tool }; } });
  const dir = tmp("brk-"), approvalRequests = withApprovals ? createApprovalRequests({ dir }) : null, signals = [];
  const broker = createAgentToolBroker({ tools: reg, blackBox: r.blackBox, policy, limits, now: clock ?? (() => t.v), onSignal: s => signals.push(s), approvalRequests, approvalAction: approvalActionName, approvalSubject: (op, p, s) => r.sys.chain.subjectFor(op, p, s), isStopped: () => r.emergency.status().mode !== "RUNNING" || r.safeMode.status().mode !== "NORMAL" });
  return { r, reg, broker, calls, t, signals, approvalRequests, dir, done: () => { rm(dir); } };
}
let jn = 0; const J = () => "job-" + (++jn);

test("policy: 34 entries, every one validates individually against the registered tool; D3/D4/D5/D6 and the post-proposal tools are stricter than the proposal", () => {
  const s = setup();
  try {
    const rows = validatePolicy({ inspect: n => s.reg.inspect(n), toolNames: s.reg.describe().map(t => t.name) });
    assert.equal(rows.length, 34); assert.deepEqual(rows.filter(x => !x.valid), []);
    const P = TOOL_POLICY, perm = (role, t) => permissionFor(role, t);
    assert.equal(perm("EXECUTION", "sandbox.run_process_only"), "DENY"); assert.equal(perm("SEARCH", "sandbox.run_process_only"), "DENY");              // D3
    for (const t of ["pcc.agenda", "pcc.add", "pcc.complete", "pcc.summary", "voice.status"]) for (const role of ["SEARCH", "EXECUTION"]) assert.equal(perm(role, t), "DENY");   // D4
    assert.equal(P["model.complete"].disabled !== null, true);                                                                                      // D5
    assert.equal(perm("EXECUTION", "money.panel"), "DENY"); assert.equal(perm("EXECUTION", "inbox.summary"), "DENY");                                // D6
    for (const t of ["effort.choose", "analyst.analyze", "chunk.plan"]) for (const role of ["SEARCH", "EXECUTION"]) assert.equal(perm(role, t), "DENY");
    const n = (role, v) => Object.keys(P).filter(t => permissionFor(role, t) === v).length;
    assert.deepEqual([n("SEARCH", "ALLOW"), n("SEARCH", "DENY"), n("SEARCH", "APPROVAL")], [21, 13, 0]);
    assert.deepEqual([n("EXECUTION", "ALLOW"), n("EXECUTION", "DENY"), n("EXECUTION", "APPROVAL")], [17, 17, 0]);
    assert.equal(permissionFor("SEARCH", "totally.new.tool"), "DENY"); assert.equal(permissionFor("MANAGER", "kp.list"), "DENY");
  } finally { s.done(); }
});
test("policy: a mistaken entry cannot grant power - ALLOW on a gated operation, a high-risk tool, a pcc.* tool, a changed operation class or a spending tool is flagged invalid and refused at call time", async () => {
  const bad = { ...TOOL_POLICY, "sandbox.run_process_only": { ...TOOL_POLICY["sandbox.run_process_only"], EXECUTION: "ALLOW" }, "pcc.add": { ...TOOL_POLICY["pcc.add"], EXECUTION: "ALLOW" }, "kp.list": { ...TOOL_POLICY["kp.list"], operation: "READ_STATUS", dataRisk: "HIGH" }, "kp.search": { ...TOOL_POLICY["kp.search"], operation: "INTERNAL_COMPUTE" } };
  const s = setup({ policy: bad });
  try {
    const rows = validatePolicy({ inspect: n => s.reg.inspect(n), policy: bad }), by = Object.fromEntries(rows.map(x => [x.tool, x]));
    assert.match(by["sandbox.run_process_only"].problems.join(), /ALLOW_ON_NON_SAFE_OPERATION/); assert.match(by["pcc.add"].problems.join(), /NEVER_FOR_AGENTS/); assert.match(by["kp.list"].problems.join(), /HIGH_DATA_RISK/); assert.match(by["kp.search"].problems.join(), /OPERATION_CHANGED/);
    for (const tool of ["pcc.add", "kp.search"]) { const r = await s.broker.call({ agentId: "EXECUTION-1", jobId: J(), tool, args: {} }); assert.equal(r.status, "DENIED", tool); }
    const g = await s.broker.call({ agentId: "EXECUTION-2", jobId: J(), tool: "sandbox.run_process_only", args: { x: "1" } }); assert.equal(g.status, "DENIED");   // ALLOW on paper -> chain still demands approval -> broker refuses the mismatch
    assert.equal(s.calls.length, 0, "no handler ran for any of them");
  } finally { s.done(); }
});
test("matrix: all 30 agents x all 34 tools - the broker outcome equals the approved table; a DENY never reaches the handler; every ALLOW call is in the Black Box", async () => {
  const s = setup({ limits: { ...DEFAULT_LIMITS, perAgentPerMinute: 1000, perAgentPerHour: 1000, perJob: 1000, perJobWrites: 1000, globalPerHour: 100000, refusalStreak: 100000, perTool: {} } });
  try {
    let allowed = 0, denied = 0;
    for (const id of ALL) for (const tool of Object.keys(TOOL_POLICY)) {
      const before = s.calls.length, exp = permissionFor(roleOf(id), tool), r = await s.broker.call({ agentId: id, jobId: J(), tool, args: {} });
      if (exp === "ALLOW" && !TOOL_POLICY[tool].disabled) { assert.equal(r.status, "OK", id + " " + tool); assert.equal(s.calls.length, before + 1); allowed++; }
      else { assert.equal(r.status, "DENIED", id + " " + tool + " " + r.status); assert.equal(s.calls.length, before, "handler must not run: " + tool); denied++; }
    }
    assert.deepEqual([allowed, denied], [5 * 20 + 25 * 16, 30 * 34 - (5 * 20 + 25 * 16)]);
    const bb = s.r.blackBox.query({ kind: "AGENT_TOOL_CALL" }); assert.equal(bb.length, allowed + denied);
    assert.equal(bb.filter(e => e.decision === "OK").length, allowed); assert.ok(bb.every(e => /^(SEARCH|EXECUTION)-\d+$/.test(e.agentId) && typeof e.inputRef === "string" && e.args === undefined));
  } finally { s.done(); }
});
test("topology: forged or extra agent ids are refused (a 31st agent, wrong case, padding, role-only, non-strings); the role comes from the id, never from the caller", async () => {
  const s = setup();
  try {
    for (const id of ["SEARCH-6", "SEARCH-0", "EXECUTION-26", "EXECUTION-0", "EXECUTION-025", "SEARCH-01", "search-1", " SEARCH-1", "SEARCH-1 ", "SEARCH-1x", "EXECUTION", "SEARCH", "OWNER", "JOCI", "", null, undefined, 7, {}, ["SEARCH-1"]]) {
      const r = await s.broker.call({ agentId: id, jobId: J(), tool: "kp.list", args: {} }); assert.equal(r.status, "DENIED", String(id)); assert.equal(r.reason, "UNKNOWN_AGENT");
    }
    assert.equal(s.calls.length, 0);
    const r = await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "sandbox.run", args: {}, role: "EXECUTION", ownerApproval: { x: 1 } }); assert.equal(r.status, "DENIED");   // caller-supplied role/approval fields are ignored
  } finally { s.done(); }
});
test("arguments: schemas stay strict - injected tenant/consent/approval fields are INVALID_ARGUMENTS and the handler never runs", async () => {
  const s = setup();
  try {
    for (const evil of [{ tenantId: "OTHER" }, { consent: true }, { ownerApproval: { sig: "x" } }, { x: "ok", __proto__x: 1, role: "OWNER" }]) {
      const r = await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "kp.list", args: evil }); assert.equal(r.status, "INVALID_ARGUMENTS");
    }
    assert.equal(s.calls.length, 0);
    for (const bad of [null, "x", [], 5]) assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "kp.list", args: bad })).status, "INVALID_ARGUMENTS");
    assert.equal((await s.broker.call({ agentId: "SEARCH-1", tool: "kp.list", args: {} })).reason, "JOB_ID_REQUIRED");
    assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: 5, args: {} })).status, "INVALID_ARGUMENTS");
    assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "nope.tool", args: {} })).status, "DENIED");
    assert.equal((await s.broker.call()).status, "DENIED");
  } finally { s.done(); }
});
test("kill switch and safe mode: the next call after a stop is DENIED (control chain), and the broker's own stop hook refuses before any budget is used", async () => {
  const s = setup();
  try {
    const ok = await s.broker.call({ agentId: "SEARCH-1", jobId: "kj", tool: "kp.list", args: {} }); assert.equal(ok.status, "OK");
    s.r.stop("PAUSE_ALL");
    const d = await s.broker.call({ agentId: "SEARCH-1", jobId: "kj", tool: "kp.list", args: {} }); assert.deepEqual([d.status, d.reason], ["DENIED", "OWNER_STOP_OR_SAFE_MODE_ACTIVE"]); const n = s.calls.length;
    assert.equal((await s.broker.call({ agentId: "EXECUTION-3", jobId: J(), tool: "atlasz.queue", args: {} })).status, "DENIED"); assert.equal(s.calls.length, n);
    s.r.resume();
    assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: "kj2", tool: "kp.list", args: {} })).status, "OK");
    const hook = createAgentToolBroker({ tools: s.reg, isStopped: () => true }); const h = await hook.call({ agentId: "SEARCH-1", jobId: "h", tool: "kp.list", args: {} }); assert.deepEqual([h.status, h.reason], ["DENIED", "OWNER_STOP_OR_SAFE_MODE_ACTIVE"]);
    const thrower = createAgentToolBroker({ tools: s.reg, isStopped: () => { throw new Error("boom"); } }); assert.equal((await thrower.call({ agentId: "SEARCH-1", jobId: "h", tool: "kp.list", args: {} })).status, "DENIED");   // a failing stop check fails closed
  } finally { s.done(); }
});
test("D2 rate limits: 10/min and 100/h per agent (sliding windows), 20 per job, 5 writes per job, 300/h globally - each refuses the next call and recovers when the window passes", async () => {
  const s = setup();
  try {
    for (let i = 0; i < 10; i++) assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "kp.list", args: {} })).status, "OK");
    const m = await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "kp.list", args: {} }); assert.deepEqual([m.status, m.reason], ["RATE_LIMITED", "AGENT_PER_MINUTE"]);
    assert.equal((await s.broker.call({ agentId: "SEARCH-2", jobId: J(), tool: "kp.list", args: {} })).status, "OK", "other agents are unaffected");
    s.t.v += 60001; assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "kp.list", args: {} })).status, "OK");
    // hour window: 100 total for SEARCH-3, spread over minutes
    for (let i = 0; i < 100; i++) { if (i % 10 === 0) s.t.v += 61000; const r = await s.broker.call({ agentId: "SEARCH-3", jobId: J(), tool: "kp.list", args: {} }); assert.equal(r.status, "OK", "call " + i); }
    s.t.v += 61000; const h = await s.broker.call({ agentId: "SEARCH-3", jobId: J(), tool: "kp.list", args: {} }); assert.deepEqual([h.status, h.reason], ["RATE_LIMITED", "AGENT_PER_HOUR"]);
    s.t.v += 3600001; assert.equal((await s.broker.call({ agentId: "SEARCH-3", jobId: J(), tool: "kp.list", args: {} })).status, "OK");
  } finally { s.done(); }
});
test("D2 job budgets: 20 calls per job in total and 5 write calls per job; the counters are per job", async () => {
  const s = setup();
  try {
    const job = "bigjob"; let ok = 0, last;
    for (let i = 0; i < 25; i++) { if (i % 9 === 0) s.t.v += 61000; const agent = SEARCH[i % 5]; last = await s.broker.call({ agentId: agent, jobId: job, tool: "kp.list", args: {} }); if (last.status === "OK") ok++; }
    assert.equal(ok, 20); assert.deepEqual([last.status, last.reason], ["RATE_LIMITED", "JOB_TOTAL"]);
    const w = "writejob"; s.t.v += 3600001;
    for (let i = 0; i < 5; i++) assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: w, tool: "research.open_question", args: { x: "q" + i } })).status, "OK");
    const r6 = await s.broker.call({ agentId: "SEARCH-1", jobId: w, tool: "research.open_question", args: { x: "q6" } }); assert.deepEqual([r6.status, r6.reason], ["RATE_LIMITED", "JOB_WRITES"]);
    assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: w, tool: "kp.list", args: {} })).status, "OK", "reads are still allowed after the write budget");
    assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: "otherjob", tool: "obs.observe", args: { x: "t" } })).status, "OK");
  } finally { s.done(); }
});
test("D2 global limits: 300 calls/hour across all agents, and at most 5 calls in flight (the 6th is refused, not queued)", async () => {
  const s = setup({ limits: { ...DEFAULT_LIMITS, perAgentPerMinute: 1000, perAgentPerHour: 1000, perJob: 1000 } });
  try {
    for (let i = 0; i < 300; i++) assert.equal((await s.broker.call({ agentId: ALL[i % 30], jobId: J(), tool: "atlasz.queue", args: {} })).status, "OK", "call " + i);
    const g = await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "atlasz.queue", args: {} }); assert.deepEqual([g.status, g.reason], ["RATE_LIMITED", "GLOBAL_PER_HOUR"]);
    s.t.v += 3600001; assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "atlasz.queue", args: {} })).status, "OK");
  } finally { s.done(); }
  let release; const gate = new Promise(r => { release = r; });
  const c = setup({ handlers: { "kp.search": () => gate } });
  try {
    const first = Array.from({ length: 5 }, (_, i) => c.broker.call({ agentId: SEARCH[i], jobId: J(), tool: "kp.search", args: {} }));
    await new Promise(r => setTimeout(r, 30));
    assert.equal(c.broker.stats().inflight, 5);
    const sixth = await c.broker.call({ agentId: "EXECUTION-1", jobId: J(), tool: "kp.list", args: {} }); assert.deepEqual([sixth.status, sixth.reason], ["RATE_LIMITED", "GLOBAL_CONCURRENCY"]);
    release({ ok: true }); assert.deepEqual((await Promise.all(first)).map(x => x.status), Array(5).fill("OK"));
    assert.equal(c.broker.stats().inflight, 0); assert.equal((await c.broker.call({ agentId: "EXECUTION-1", jobId: J(), tool: "kp.list", args: {} })).status, "OK");
  } finally { c.done(); }
});
const cap2 = () => setup({ limits: { ...DEFAULT_LIMITS, perTool: { "research.add_source": { textMaxChars: 15000 } } } });
test("per-tool limits: sandbox.run 3/job and 10/h/agent with the timeout clamped to 10 s; add_source text capped at 50,000; model.complete is DISABLED (D5) and capped when it is ever enabled", async () => {
  const s = setup({ limits: { ...DEFAULT_LIMITS, perAgentPerMinute: 1000, perAgentPerHour: 1000 } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await s.broker.call({ agentId: "EXECUTION-1", jobId: "sj", tool: "sandbox.run", args: { x: "c" + i, timeoutMs: 30000 } })).status, "OK");
    assert.equal((await s.broker.call({ agentId: "EXECUTION-1", jobId: "sj", tool: "sandbox.run", args: { x: "c" } })).reason, "TOOL_PER_JOB");
    assert.deepEqual(s.calls.filter(c => c.tool === "sandbox.run").map(c => c.a.timeoutMs), [10000, 10000, 10000]);
    await s.broker.call({ agentId: "EXECUTION-2", jobId: J(), tool: "sandbox.run", args: { x: "c", timeoutMs: 200 } }); assert.equal(s.calls.at(-1).a.timeoutMs, 200);
    await s.broker.call({ agentId: "EXECUTION-2", jobId: J(), tool: "sandbox.run", args: { x: "c" } }); assert.equal(s.calls.at(-1).a.timeoutMs, 10000);
    for (let i = 0; i < 7; i++) assert.equal((await s.broker.call({ agentId: "EXECUTION-3", jobId: J(), tool: "sandbox.run", args: { x: "c" } })).status, "OK");
    for (let i = 0; i < 3; i++) await s.broker.call({ agentId: "EXECUTION-3", jobId: J(), tool: "sandbox.run", args: { x: "c" } });
    assert.equal((await s.broker.call({ agentId: "EXECUTION-3", jobId: J(), tool: "sandbox.run", args: { x: "c" } })).reason, "TOOL_PER_AGENT_HOUR");
    assert.equal(DEFAULT_LIMITS.perTool["research.add_source"].textMaxChars, 50000);
    const cap = setup({ limits: { ...DEFAULT_LIMITS, perTool: { "research.add_source": { textMaxChars: 15000 } } } });
    try { assert.equal((await cap.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "research.add_source", args: { text: "a".repeat(15000) } })).status, "OK"); } finally { cap.done(); }
    const big = await cap2().broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "research.add_source", args: { text: "a".repeat(15001) } }); assert.deepEqual([big.status, big.reason], ["INVALID_ARGUMENTS", "TEXT_TOO_LONG_FOR_AGENT"]);
    const mc = await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "model.complete", args: { prompt: "hi" } }); assert.equal(mc.status, "DENIED"); assert.match(mc.reason, /^TOOL_DISABLED/);
    assert.equal(s.calls.filter(c => c.tool === "model.complete").length, 0);
    const en = setup({ policy: { ...TOOL_POLICY, "model.complete": { ...TOOL_POLICY["model.complete"], disabled: null } }, limits: { ...DEFAULT_LIMITS, perAgentPerMinute: 1000, perAgentPerHour: 1000, perJob: 1000, perTool: { "model.complete": { ...DEFAULT_LIMITS.perTool["model.complete"], perAgentPerHour: 1000 } } } });
    try {
      assert.equal((await en.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "model.complete", args: { prompt: "p".repeat(8001) } })).reason, "PROMPT_TOO_LONG_FOR_AGENT");
      for (let i = 0; i < 5; i++) assert.equal((await en.broker.call({ agentId: "SEARCH-1", jobId: "mj", tool: "model.complete", args: { prompt: "p" } })).status, "OK");
      assert.equal((await en.broker.call({ agentId: "SEARCH-1", jobId: "mj", tool: "model.complete", args: { prompt: "p" } })).reason, "TOOL_PER_JOB");
      for (let j = 0; j < 19; j++) for (let i = 0; i < 5; i++) await en.broker.call({ agentId: ALL[(j * 5 + i) % 30], jobId: "mj" + j, tool: "model.complete", args: { prompt: "p" } });
      assert.equal((await en.broker.call({ agentId: "SEARCH-2", jobId: "last", tool: "model.complete", args: { prompt: "p" } })).reason, "TOOL_GLOBAL_DAY");
    } finally { en.done(); }
  } finally { s.done(); }
});
test("results: over 64 KB is truncated and flagged; handler errors, invalid output and a hung tool (call timeout) come back as statuses and the broker keeps working", async () => {
  const s = setup({ limits: { ...DEFAULT_LIMITS, perCallTimeoutMs: 80 }, handlers: { "kp.search": () => ({ blob: "x".repeat(70000) }), "kp.answer": () => { throw new Error("handler exploded SECRET-123"); }, "kp.verify": () => new Promise(() => {}) } });
  try {
    const t = await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "kp.search", args: {} }); assert.equal(t.status, "OK"); assert.equal(t.truncated, true); assert.equal(t.result, null); assert.ok(t.originalBytes > 65536); assert.ok(t.preview.length <= 2000); assert.equal(t.untrusted, true);
    const e = await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "kp.answer", args: {} }); assert.equal(e.status, "HANDLER_ERROR");
    const h = await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "kp.verify", args: {} }); assert.equal(h.status, "TIMEOUT"); assert.equal(s.broker.stats().inflight, 0);
    assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "kp.list", args: {} })).status, "OK");
  } finally { s.done(); }
});
test("repeated refusals: 5 consecutive DENIED/INVALID in one job suspend that job, raise a BYPASS_ATTEMPT signal once, never quarantine the agent; a success resets the streak", async () => {
  const s = setup({ limits: { ...DEFAULT_LIMITS, perAgentPerMinute: 1000, perAgentPerHour: 1000 } });
  try {
    for (let i = 0; i < 4; i++) await s.broker.call({ agentId: "SEARCH-1", jobId: "bad", tool: "pcc.add", args: {} });
    assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: "bad", tool: "kp.list", args: {} })).status, "OK");           // reset
    for (let i = 0; i < 4; i++) await s.broker.call({ agentId: "SEARCH-1", jobId: "bad", tool: "money.panel", args: {} });
    assert.equal(s.signals.length, 0);
    await s.broker.call({ agentId: "SEARCH-1", jobId: "bad", tool: "money.panel", args: {} });
    assert.equal(s.signals.length, 1); assert.deepEqual([s.signals[0].type, s.signals[0].agentId, s.signals[0].jobId], ["BYPASS_ATTEMPT", "SEARCH-1", "bad"]);
    const after = await s.broker.call({ agentId: "SEARCH-1", jobId: "bad", tool: "kp.list", args: {} }); assert.deepEqual([after.status, after.reason], ["DENIED", "JOB_SUSPENDED"]);
    assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: "fresh", tool: "kp.list", args: {} })).status, "OK", "the agent itself is not quarantined");
    await s.broker.call({ agentId: "SEARCH-1", jobId: "bad", tool: "pcc.add", args: {} }); assert.equal(s.signals.length, 1, "signal only once per job");
    for (let i = 0; i < 5; i++) await s.broker.call({ agentId: "SEARCH-2", jobId: "inv", tool: "kp.list", args: { evil: 1 } }); assert.equal(s.signals.length, 2);   // INVALID_ARGUMENTS also counts
  } finally { s.done(); }
});
test("approval queue (D7): an approval-class tool only files a PENDING request bound to the exact args; nothing runs until the owner signs; rejected is final; replay and other args need a new approval; limits 3/agent, 20 total", async () => {
  const policy = { ...TOOL_POLICY, "sandbox.run_process_only": { ...TOOL_POLICY["sandbox.run_process_only"], EXECUTION: "APPROVAL" } };
  const s = setup({ policy, withApprovals: true, limits: { ...DEFAULT_LIMITS, perAgentPerMinute: 1000, perAgentPerHour: 1000, perJob: 1000 } });
  try {
    const A1 = { x: "code-1" }, call = (args, id = "EXECUTION-1") => s.broker.call({ agentId: id, jobId: J(), tool: "sandbox.run_process_only", args });
    const p1 = await call(A1); assert.equal(p1.status, "PENDING_OWNER_APPROVAL"); assert.equal(s.calls.length, 0);
    const req = s.approvalRequests.list()[0]; assert.deepEqual([req.status, req.requestedBy, req.action], ["PENDING", "EXECUTION-1", approvalActionName("HIGH_RISK_CHANGE")]);
    const p1b = await call(A1); assert.equal(p1b.status, "PENDING_OWNER_APPROVAL"); assert.equal(p1b.requestId, p1.requestId); assert.equal(s.approvalRequests.list().length, 1, "duplicates merged");
    assert.equal(s.calls.length, 0, "still nothing ran - no automatic approval");
    s.approvalRequests.decide({ id: p1.requestId, decision: "APPROVED", approval: s.r.opApproval("HIGH_RISK_CHANGE", A1) });
    const ok = await call(A1); assert.equal(ok.status, "OK"); assert.equal(s.calls.length, 1);
    const again = await call(A1); assert.equal(again.status, "PENDING_OWNER_APPROVAL", "an approval is single-use: the next identical call needs a NEW request"); assert.equal(s.calls.length, 1);
    const other = await call({ x: "code-2" }); assert.equal(other.status, "PENDING_OWNER_APPROVAL"); assert.notEqual(other.requestId, p1.requestId);
    s.approvalRequests.decide({ id: other.requestId, decision: "REJECTED", reason: "no" });
    const rej = await call({ x: "code-2" }); assert.deepEqual([rej.status, rej.reason], ["DENIED", "OWNER_REJECTED"]); assert.equal(s.calls.length, 1);
    // an approval signed for other args never runs these args
    const p3 = await call({ x: "code-3" }); s.approvalRequests.decide({ id: p3.requestId, decision: "APPROVED", approval: s.r.opApproval("HIGH_RISK_CHANGE", { x: "code-3" }) });
    const swapped = await call({ x: "code-3" }, "EXECUTION-1"); assert.equal(swapped.status, "OK"); assert.deepEqual(s.calls.at(-1).a, { x: "code-3" });
    // SEARCH has no entry at all
    assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "sandbox.run_process_only", args: A1 })).status, "DENIED");
    // pending caps
    const s2 = setup({ policy, withApprovals: true, limits: { ...DEFAULT_LIMITS, perAgentPerMinute: 1000, perAgentPerHour: 1000, perJob: 1000 } });
    try {
      const c2 = (args, id) => s2.broker.call({ agentId: id, jobId: J(), tool: "sandbox.run_process_only", args });
      for (let i = 0; i < 3; i++) assert.equal((await c2({ x: "a" + i }, "EXECUTION-1")).status, "PENDING_OWNER_APPROVAL");
      const cap = await c2({ x: "a9" }, "EXECUTION-1"); assert.deepEqual([cap.status, cap.reason], ["RATE_LIMITED", "PENDING_APPROVALS_LIMIT"]);
      for (let a = 2; a <= 7; a++) for (let i = 0; i < 3; i++) await c2({ x: "b" + a + i }, "EXECUTION-" + a);
      assert.equal(s2.approvalRequests.pending().length, 20);
      assert.equal((await c2({ x: "zz" }, "EXECUTION-8")).reason, "PENDING_APPROVALS_LIMIT");
    } finally { s2.done(); }
  } finally { s.done(); }
});
test("approval class without a queue is refused; the approval queue cannot be fed an approval by the caller", async () => {
  const policy = { ...TOOL_POLICY, "sandbox.run_process_only": { ...TOOL_POLICY["sandbox.run_process_only"], EXECUTION: "APPROVAL" } };
  const s = setup({ policy });
  try {
    const r = await s.broker.call({ agentId: "EXECUTION-1", jobId: J(), tool: "sandbox.run_process_only", args: { x: "c" }, ownerApproval: s.r.opApproval("HIGH_RISK_CHANGE", { x: "c" }) });
    assert.deepEqual([r.status, r.reason], ["DENIED", "APPROVAL_QUEUE_UNAVAILABLE"]); assert.equal(s.calls.length, 0);
  } finally { s.done(); }
});
test("describeFor: an agent sees only the tools it may call (never DENY, disabled or mismatched ones)", () => {
  const s = setup();
  try {
    const se = s.broker.describeFor("SEARCH-1").map(t => t.name), ex = s.broker.describeFor("EXECUTION-1").map(t => t.name);
    assert.ok(se.includes("research.add_source") && !ex.includes("research.add_source")); assert.ok(ex.includes("sandbox.run") && !se.includes("sandbox.run"));
    for (const n of ["model.complete", "pcc.add", "voice.status", "sandbox.run_process_only", "money.panel", "effort.choose"]) assert.ok(!se.includes(n) && !ex.includes(n), n);
    assert.deepEqual(s.broker.describeFor("SEARCH-9"), []); assert.equal(se.length, 20); assert.equal(ex.length, 16);
  } finally { s.done(); }
});
test("broker edge cases: a spending tool is refused even if listed ALLOW; job ids are bounded; an expired approval request can be re-filed; calls run as actor AGENT (owner-only operations stay out of reach)", async () => {
  const s = setup();
  try {
    const spender = createToolRegistry({ chain: s.r.sys.chain, blackBox: s.r.blackBox }); let ran = 0;
    for (const e of Object.values(TOOL_POLICY)) spender.register({ name: e.tool, operation: e.operation, input: SCHEMA, spendUsd: e.tool === "kp.list" ? 0.01 : 0, handler: async () => { ran++; return {}; } });
    const b = createAgentToolBroker({ tools: spender, now: () => 1, policy: TOOL_POLICY });
    const r = await b.call({ agentId: "SEARCH-1", jobId: "x", tool: "kp.list", args: {} }); assert.deepEqual([r.status, r.reason], ["DENIED", "POLICY_MISMATCH:TOOL_SPENDS"]); assert.equal(ran, 0);
    assert.equal(validatePolicy({ inspect: n => spender.inspect(n) }).find(x => x.tool === "kp.list").problems.includes("TOOL_SPENDS"), true);
    assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: "j".repeat(81), tool: "kp.list", args: {} })).reason, "JOB_ID_REQUIRED");
    assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: "j".repeat(80), tool: "kp.list", args: {} })).status, "OK");
    assert.deepEqual(s.calls.map(c => c.tool), ["kp.list"]);
    // calls are made as AGENT, so the chain's owner-only classes can never be reached through the broker
    const seen = []; const fakeTools = { inspect: n => s.reg.inspect(n), describe: () => [], invoke: async (n, a, o) => { seen.push(o.actor); return { status: "OK", result: {} }; } };
    await createAgentToolBroker({ tools: fakeTools }).call({ agentId: "EXECUTION-7", jobId: "q", tool: "atlasz.queue", args: {} }); assert.deepEqual(seen, [{ type: "AGENT", id: "EXECUTION-7" }]);
  } finally { s.done(); }
  const policy = { ...TOOL_POLICY, "sandbox.run_process_only": { ...TOOL_POLICY["sandbox.run_process_only"], EXECUTION: "APPROVAL" } }, tt = { v: 5_000_000 };
  const r2 = rig({ roster: roster() }), dir = tmp("exp-");
  try {
    const reg = createToolRegistry({ chain: r2.sys.chain, blackBox: r2.blackBox }); for (const e of Object.values(TOOL_POLICY)) reg.register({ name: e.tool, operation: e.operation, input: SCHEMA, handler: async () => ({}) });
    const ar = createApprovalRequests({ dir, ttlMs: 1000, now: () => tt.v });
    const b = createAgentToolBroker({ tools: reg, policy, approvalRequests: ar, approvalAction: approvalActionName, approvalSubject: (op, p, sp) => r2.sys.chain.subjectFor(op, p, sp), now: () => tt.v, limits: { ...DEFAULT_LIMITS, perAgentPerMinute: 1000, perAgentPerHour: 1000, perJob: 1000 } });
    const c = () => b.call({ agentId: "EXECUTION-1", jobId: J(), tool: "sandbox.run_process_only", args: { x: "e" } });
    const first = await c(); assert.equal(first.status, "PENDING_OWNER_APPROVAL"); tt.v += 2000;
    assert.equal(ar.list()[0].status, "EXPIRED"); const again = await c(); assert.equal(again.status, "PENDING_OWNER_APPROVAL"); assert.equal(ar.list().length, 2, "a fresh request was filed after expiry");
    assert.equal(ar.pending().length, 1);
  } finally { rm(dir); rm(r2.dir); }
});
test("mutation-driven: exact boundaries and defensive branches (prompt cap, result cap, argument shape reason, call counter, policy values, approval record without a signed approval)", async () => {
  assert.equal(DEFAULT_LIMITS.resultMaxBytes, 65536);
  assert.equal(permissionFor("tool", "kp.list"), "DENY"); assert.equal(permissionFor("operation", "kp.list"), "DENY");
  assert.equal(permissionFor("MANAGER", "kp.list", { "kp.list": { ...TOOL_POLICY["kp.list"], MANAGER: "ALLOW" } }), "DENY", "only the two real roles can ever be granted anything");
  const odd = { ...TOOL_POLICY, "kp.list": { ...TOOL_POLICY["kp.list"], SEARCH: "MAYBE", EXECUTION: undefined } };
  assert.equal(permissionFor("SEARCH", "kp.list", odd), "DENY"); assert.equal(permissionFor("EXECUTION", "kp.list", odd), "DENY");
  const s = setup({ handlers: { "kp.search": () => ({ b: "x".repeat(65536 - 8) }), "kp.answer": () => ({ b: "x".repeat(65536 - 7) }) }, limits: { ...DEFAULT_LIMITS, perAgentPerMinute: 1000, perAgentPerHour: 1000, perJob: 1000 } });
  try {
    const at = await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "kp.search", args: {} }); assert.deepEqual([at.status, at.truncated], ["OK", false]);
    const over = await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "kp.answer", args: {} }); assert.deepEqual([over.status, over.truncated, over.originalBytes], ["OK", true, 65537]);
    for (const bad of [null, "x", [], 5]) assert.equal((await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "kp.list", args: bad })).reason, "ARGS_MUST_BE_OBJECT");
    const before = s.broker.stats().calls; await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "kp.list", args: {} }); await s.broker.call({ agentId: "NOPE", jobId: J(), tool: "kp.list" }); assert.equal(s.broker.stats().calls, before + 2);
    const en = setup({ policy: { ...TOOL_POLICY, "model.complete": { ...TOOL_POLICY["model.complete"], disabled: null } } });
    try { assert.equal((await en.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "model.complete", args: { prompt: "p".repeat(8000) } })).status, "OK"); } finally { en.done(); }
    const bogus = { ...TOOL_POLICY, "kp.list": { ...TOOL_POLICY["kp.list"], SEARCH: "APPROVAL" } };
    assert.match(validatePolicy({ inspect: n => s.reg.inspect(n), policy: bogus }).find(x => x.tool === "kp.list").problems.join(), /APPROVAL_ON_UNGATED_OPERATION:SEARCH/);
    // an APPROVED record that carries no signed approval never runs the tool
    const stubQueue = { list: () => [{ id: "r1", status: "APPROVED", requestedBy: "EXECUTION-1", action: "A", subject: "S", what: "W" }], pending: () => [], request: () => ({ id: "r1" }), outcome: () => ({ decision: "APPROVED", approval: null }) };
    const ap = { ...TOOL_POLICY, "sandbox.run_process_only": { ...TOOL_POLICY["sandbox.run_process_only"], EXECUTION: "APPROVAL" } };
    const calls2 = []; const b = createAgentToolBroker({ tools: { inspect: n => s.reg.inspect(n), describe: () => [], invoke: async (...a) => { calls2.push(a); return { status: "OK", result: {} }; } }, policy: ap, approvalRequests: stubQueue, approvalAction: () => "A", approvalSubject: () => "S" });
    // the broker computes `what` itself, so make the stub match whatever it asks for
    stubQueue.list = () => [{ id: "r1", status: "APPROVED", requestedBy: "EXECUTION-1", action: "A", subject: "S", what: stubQueue.lastWhat }]; const origReq = stubQueue.request; stubQueue.request = r => { stubQueue.lastWhat = r.what; return origReq(r); };
    await b.call({ agentId: "EXECUTION-1", jobId: "z", tool: "sandbox.run_process_only", args: { x: "1" } });                   // files the request, learns `what`
    const r = await b.call({ agentId: "EXECUTION-1", jobId: "z2", tool: "sandbox.run_process_only", args: { x: "1" } });
    assert.deepEqual([r.status, r.reason], ["DENIED", "NO_APPROVAL_ON_RECORD"]); assert.equal(calls2.length, 0);
  } finally { s.done(); }
});

test("a finished tool call leaves no pending timeout timer behind (a leaked 10 s timer kept every hosted process alive)", async () => {
  const s = setup(); try {
    const timers = () => process.getActiveResourcesInfo().filter(x => x === "Timeout").length, before = timers();
    for (let i = 0; i < 5; i++) { const ok = await s.broker.call({ agentId: "SEARCH-1", jobId: J(), tool: "kp.list", args: {} }); assert.equal(ok.status, "OK"); }
    assert.ok(timers() <= before, `timers before ${before}, after ${timers()}`);
  } finally { s.done(); }
});
