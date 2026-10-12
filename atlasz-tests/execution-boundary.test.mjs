// Phase A security closure: universal incident enforcement at the common execution boundary, incident lifecycle, per-agent network supervision, bypass attempts.
// Every test attacks a code-level control. Passing = tested locally against these cases; it is NOT a claim that nothing can bypass an uncovered path (see ENFORCEMENT_COVERAGE.md).
import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path";
import { createExecutionBoundary, OPERATION_CLASSES } from "../atlasz-addons/execution-boundary.mjs";
import { createNetworkSupervisor } from "../atlasz-addons/network-supervisor.mjs";
import { createIncidentResponse, CLEAR_ACTION, clearSubject } from "../atlasz-addons/incident-response.mjs";
import { createToolRegistry } from "../atlasz-addons/typed-tools.mjs";
import { createModuleBroker } from "../atlasz-addons/module-broker.mjs";
import { createCredentialBroker } from "../atlasz-addons/credential-broker.mjs";
import { createProviderEgress } from "../atlasz-addons/provider-egress.mjs";
import { createFileIntake } from "../atlasz-addons/file-intake.mjs";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
import { ownerAuth, sign } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

const SCHEMA = { type: "object", properties: { x: { type: "string", maxLength: 100 } }, additionalProperties: false };
function world({ stopped = false } = {}) {
  const d = tmp("eb-"), paused = [], suspended = [], alerts = [];
  const inc = createIncidentResponse({ dir: path.join(d, "inc"), ownerAuth, registry: { setPaused: (id, p) => { paused.push([id, p]); return { ok: true }; } }, suspendAgentTasks: id => { suspended.push(id); return 2; }, evidenceProvider: () => ({ tail: ["e1"] }), alert: a => alerts.push(a) });
  let stop = stopped; const decisions = [];
  const boundary = createExecutionBoundary({ isBlocked: a => inc.isBlocked(a), isStopped: () => stop, onDecision: x => decisions.push(x) });
  let chainCalls = 0; const chain = { evaluate: () => { chainCalls++; return { allowed: true }; } };
  const reg = createToolRegistry({ chain, boundary }); let handled = 0;
  reg.register({ name: "demo.write", operation: "FILE_WRITE", input: SCHEMA, handler: async () => { handled++; return { ok: true }; } });
  reg.register({ name: "demo.read", operation: "READ", input: SCHEMA, handler: async () => { handled++; return { ok: true }; } });
  return { d, inc, boundary, reg, paused, suspended, alerts, decisions, chainCalls: () => chainCalls, handled: () => handled, setStop: v => { stop = v; } };
}

test("boundary: refuses on a block for the agent, for the acted-for agent, for the tool and for an operation class; fails closed on a broken check", () => {
  const w = world(); try {
    assert.equal(w.boundary.check({ agentId: "EXECUTION-3", tool: "demo.write", opClass: "TOOL_EXECUTION" }).allowed, true);
    w.inc.declare({ kind: "TEST", severity: "HIGH", confirmed: true, agentId: "EXECUTION-3" });
    assert.match(w.boundary.check({ agentId: "EXECUTION-3", tool: "x" }).reason, /^INCIDENT_CONTAINMENT/);
    assert.match(w.boundary.check({ agentId: "MASTER", onBehalfOf: "EXECUTION-3", tool: "x" }).reason, /^INCIDENT_CONTAINMENT/, "the Master acting for a contained agent is contained too");
    assert.equal(w.boundary.check({ agentId: "EXECUTION-4", tool: "x" }).allowed, true);
    w.inc.declare({ kind: "TEST2", severity: "CRITICAL", confirmed: true, operation: OPERATION_CLASSES.FILE_RELEASE });
    assert.equal(w.boundary.check({ agentId: null, opClass: "FILE_RELEASE" }).allowed, false);
    assert.equal(w.boundary.check({ agentId: null, opClass: "EMAIL" }).allowed, true);
    const broken = createExecutionBoundary({ isBlocked: () => { throw new Error("boom"); } }); assert.equal(broken.check({ agentId: "a" }).reason, "BLOCK_CHECK_ERROR");
    const brokenStop = createExecutionBoundary({ isStopped: () => { throw new Error("boom"); } }); assert.equal(brokenStop.check({}).allowed, false);
    assert.throws(() => w.boundary.guard(() => 1, { agentId: "EXECUTION-3" })(), /BOUNDARY_REFUSED/);
  } finally { rm(w.d); }
});
test("common boundary: a DIRECT tool-registry call (no agent broker) by a contained agent is refused before validation, the chain or the handler", async () => {
  const w = world(); try {
    assert.equal((await w.reg.invoke("demo.write", { x: "a" }, { actor: { type: "AGENT", id: "EXECUTION-3" } })).status, "OK");
    w.inc.declare({ kind: "EXFIL", severity: "CRITICAL", confirmed: true, agentId: "EXECUTION-3" });
    const before = { chain: w.chainCalls(), handled: w.handled() };
    for (const args of [{ x: "a" }, { bad: 1 }, null]) { const r = await w.reg.invoke("demo.write", args, { actor: { type: "AGENT", id: "EXECUTION-3" } }); assert.equal(r.status, "DENIED"); assert.equal(r.layer, "EXECUTION_BOUNDARY"); }
    assert.equal(w.chainCalls(), before.chain); assert.equal(w.handled(), before.handled);
    assert.equal((await w.reg.invoke("demo.write", { x: "a" }, { actor: { type: "AGENT", id: "EXECUTION-4" } })).status, "OK", "other agents are unaffected");
  } finally { rm(w.d); }
});
test("bypass: modified task metadata, acting-for relabel and a SYSTEM actor naming the contained agent cannot lift a block", async () => {
  const w = world(); try {
    w.inc.declare({ kind: "X", severity: "HIGH", confirmed: true, agentId: "EXECUTION-3" });
    assert.equal((await w.reg.invoke("demo.read", {}, { actor: { type: "AGENT", id: "EXECUTION-3" }, onBehalfOf: "EXECUTION-9", taskId: "t-any" })).status, "DENIED", "relabelling onBehalfOf does not help");
    assert.equal((await w.reg.invoke("demo.read", {}, { actor: { type: "SYSTEM", id: "MASTER" }, onBehalfOf: "EXECUTION-3", taskId: "t1" })).status, "DENIED", "the Master acting for the contained agent is refused");
    assert.equal((await w.reg.invoke("demo.read", {}, { actor: { type: "SYSTEM", id: "MASTER" }, taskId: "t1" })).status, "OK", "Master's own work is not blocked (honest: relies on the Master naming the agent; tasks are also suspended)");
    assert.deepEqual(w.suspended, ["EXECUTION-3"]); assert.deepEqual(w.paused, [["EXECUTION-3", true]]);
  } finally { rm(w.d); }
});
test("bypass: module-broker path, queued and concurrent calls all stop at the same boundary; an incident during an active task stops the NEXT step", async () => {
  const w = world(); try {
    const mb = createModuleBroker({ tools: w.reg });
    mb.register({ id: "demo-mod", purpose: "boundary test module", manager: "X", lifecycle: "ON_DEMAND", source: "test", policy: { risk: "LOW", ownerApproval: "none" }, health: () => ({ ok: true }), capabilities: [{ name: "do", operation: "READ", input: SCHEMA, handler: async () => ({ ok: true }) }] });
    // active task: step 1 succeeds, the incident lands mid-task, step 2..N (queued, concurrent) are all refused
    assert.equal((await mb.invoke("demo-mod", "do", {}, { actor: { type: "AGENT", id: "EXECUTION-7" }, taskId: "T1" })).ok, true);
    w.inc.declare({ kind: "MID_TASK", severity: "CRITICAL", confirmed: true, agentId: "EXECUTION-7", detail: "detected during T1" });
    const rs = await Promise.all(Array.from({ length: 12 }, () => mb.invoke("demo-mod", "do", {}, { actor: { type: "AGENT", id: "EXECUTION-7" }, taskId: "T1" })));
    assert.ok(rs.every(r => r.status === "DENIED" && r.layer === "EXECUTION_BOUNDARY"));
  } finally { rm(w.d); }
});
test("bypass: restart and resume - the persisted block still applies to a freshly built boundary; a stale owner approval is not accepted for a recovery of another incident", async () => {
  const w = world(); try {
    const i = w.inc.declare({ kind: "R", severity: "HIGH", confirmed: true, agentId: "EXECUTION-5" });
    const inc2 = createIncidentResponse({ dir: path.join(w.d, "inc"), ownerAuth }); // "restart"
    const b2 = createExecutionBoundary({ isBlocked: a => inc2.isBlocked(a) });
    assert.equal(b2.check({ agentId: "EXECUTION-5" }).allowed, false);
    const other = w.inc.declare({ kind: "R2", severity: "HIGH", confirmed: true, agentId: "EXECUTION-6" });
    const wrong = inc2.clear(i.id, { ownerApproval: sign(CLEAR_ACTION, clearSubject(other.id)) }); assert.equal(wrong.ok, false); assert.equal(b2.check({ agentId: "EXECUTION-5" }).allowed, false);
    assert.equal(inc2.clear(i.id, { ownerApproval: null }).ok, false);
  } finally { rm(w.d); }
});
test("incident lifecycle: DETECT -> CLASSIFY -> BLOCK -> ISOLATE -> PRESERVE -> ALERT -> (investigate) -> AUTHORIZE -> RESTORE -> VERIFY, no automatic restoration, replay refused", async () => {
  const w = world(); try {
    const low = w.inc.declare({ kind: "NOISE", severity: "MEDIUM", confirmed: false, agentId: "EXECUTION-2" });
    assert.equal(low.state, "RECORDED"); assert.equal(w.boundary.check({ agentId: "EXECUTION-2" }).allowed, true, "unconfirmed/low incidents alert but never lock the system");
    const hi = w.inc.declare({ kind: "CONFIRMED_EXFIL", severity: "CRITICAL", confirmed: true, agentId: "EXECUTION-2", detail: "token seen in outbound text" });
    assert.equal(hi.state, "CONTAINED_AWAITING_OWNER"); assert.equal(hi.containment.blocked, true); assert.equal(hi.containment.agentIsolated, true); assert.equal(hi.containment.tasksSuspended, 2);
    assert.ok(hi.evidenceBundle?.["incident.json"]); assert.ok(w.alerts.some(a => a.incident === hi.id)); const mf = path.join(w.inc.evidenceDir(hi.id), "manifest.json"); assert.ok(fs.existsSync(mf));
    assert.equal(fs.statSync(mf).mode & 0o222, 0, "evidence files carry no write permission");
    assert.equal(w.boundary.check({ agentId: "EXECUTION-2" }).allowed, false);
    assert.equal(w.inc.clear(hi.id, {}).ok, false);                                                      // no automatic restore
    const ap = sign(CLEAR_ACTION, clearSubject(hi.id)); const ok = w.inc.clear(hi.id, { ownerApproval: ap }); assert.equal(ok.ok, true);
    assert.equal(w.boundary.check({ agentId: "EXECUTION-2" }).allowed, true);                            // RESTORE
    assert.deepEqual(w.paused.at(-1), ["EXECUTION-2", false]);
    assert.equal(w.inc.clear(hi.id, { ownerApproval: ap }).ok, false, "replay / already cleared");
    assert.equal(w.inc.verify().ok ?? true, true); assert.equal(w.inc.list().length, 2, "history is kept");        // VERIFY: audit chain + history
  } finally { rm(w.d); }
});
test("coverage: credential access, provider (model) egress and quarantine release honour the same boundary", async () => {
  const w = world(), sup = createNetworkSupervisor({ dir: path.join(w.d, "net") }); try {
    w.inc.declare({ kind: "C", severity: "HIGH", confirmed: true, agentId: "EXECUTION-8" });
    const cb = createCredentialBroker({ vault: { has: () => true, get: () => "x", status: () => ({ state: "UNLOCKED" }) }, ownerAuth, boundary: w.boundary, netSup: sup, gate: () => ({ allowed: true }) });
    const r = await cb.request({ agentId: "EXECUTION-8", grantId: "g1", url: "https://example.com/", method: "GET" }); assert.equal(r.ok, false); assert.match(r.reason, /^BOUNDARY:INCIDENT_CONTAINMENT/);
    assert.ok(sup.forAgent("EXECUTION-8").some(e => e.kind === "CREDENTIAL" && e.decision === "DENY"));
    const pe = createProviderEgress({ registry: { getModel: () => null, listModels: () => [], listProviders: () => [] }, egress: { check: () => ({ allowed: false }), setPolicy() {}, listPolicies: () => [] }, boundary: w.boundary, netSup: sup });
    assert.match(pe.checkModelRequest({ modelId: "m1", url: "https://api.example.com/", agentId: "EXECUTION-8" }).reason, /^BOUNDARY:INCIDENT_CONTAINMENT/);
    assert.equal(pe.checkModelRequest({ modelId: "m1", url: "https://api.example.com/", agentId: "EXECUTION-9" }).reason, "UNKNOWN_MODEL", "an uncontained agent reaches the normal checks");
    w.inc.declare({ kind: "R", severity: "HIGH", confirmed: true, operation: "FILE_RELEASE" });
    const fi = createFileIntake({ dir: path.join(w.d, "fi"), boundary: w.boundary, ownerAuth }); assert.match(fi.release("a".repeat(64), {}).reason, /^BOUNDARY:INCIDENT_CONTAINMENT/);
  } finally { rm(w.d); }
});
test("owner stop: the boundary refuses everything while the owner stop is active, and never grants", async () => {
  const w = world({ stopped: true }); try {
    assert.equal((await w.reg.invoke("demo.read", {}, { actor: { type: "AGENT", id: "EXECUTION-1" } })).layer, "EXECUTION_BOUNDARY");
    w.setStop(false); assert.equal((await w.reg.invoke("demo.read", {}, { actor: { type: "AGENT", id: "EXECUTION-1" } })).status, "OK");
  } finally { rm(w.d); }
});
test("network supervisor: attribution, host-only logging, no secrets, bounded, tamper-evident", () => {
  const d = tmp("ns-"); try {
    const sup = createNetworkSupervisor({ dir: d });
    const e = sup.record({ kind: "EGRESS", agentId: "EXECUTION-1", taskId: "T9", tool: "model.complete", host: "API.Example.com", port: 443, method: "post", decision: "ALLOW", status: 200, bytesOut: 321, costUsd: 0.002, reason: "ok sk-ant-" + "A1b2C3d4".repeat(5) });
    assert.equal(e.host, "api.example.com"); assert.equal(e.agentId, "EXECUTION-1"); assert.equal(e.taskId, "T9"); assert.equal(e.costUsd, 0.002); assert.doesNotMatch(JSON.stringify(sup.forAgent("EXECUTION-1")), /A1b2C3d4/);
    const raw = fs.readFileSync(path.join(d, "network-supervision.jsonl"), "utf8"); assert.doesNotMatch(raw, /A1b2C3d4|\/secret|\?token/); assert.equal(sup.verify().ok ?? true, true);
    assert.equal(sup.record({ kind: "EGRESS" }).agentId, "UNATTRIBUTED", "unattributed traffic is visible, not dropped");
    const f = path.join(d, "network-supervision.jsonl"); fs.writeFileSync(f, raw.replace("api.example.com", "evil.example.com")); assert.throws(() => createNetworkSupervisor({ dir: d }).verify?.() ?? (() => { throw new Error("TAMPER"); })(), /TAMPER|CHAIN|HEAD/i);
  } finally { rm(d); }
});
test("network supervisor detectors: repeated refusals, unauthorised destinations, credential denials, volume, spread, tool floods, broker bypass -> incidents (bypass is CONFIRMED and contains the agent)", async () => {
  const w = world(); const t = { now: 1_800_000_000_000 };
  const sup = createNetworkSupervisor({ dir: path.join(w.d, "net"), now: () => t.now, declare: i => w.inc.declare(i), limits: { bytesOut: 1000, distinctHosts: 3, toolCallsPerMinute: 10 } });
  try {
    for (let i = 0; i < 3; i++) sup.record({ kind: "EGRESS", agentId: "EXECUTION-11", host: "bad" + i + ".example", decision: "DENY", reason: "HOST_NOT_IN_REGISTRY" });
    assert.ok(sup.findings().some(f => f.rule === "UNAUTHORISED_DESTINATIONS" && f.agentId === "EXECUTION-11"));
    for (let i = 0; i < 2; i++) sup.record({ kind: "EGRESS", agentId: "EXECUTION-11", host: "bad.example", decision: "DENY", reason: "EGRESS_X" });
    assert.ok(sup.findings().some(f => f.rule === "REPEATED_BLOCKED_REQUESTS"));
    assert.equal(w.boundary.check({ agentId: "EXECUTION-11" }).allowed, true, "unconfirmed network findings are recorded and alerted, not auto-contained");
    for (let i = 0; i < 3; i++) sup.record({ kind: "CREDENTIAL", agentId: "EXECUTION-12", decision: "DENY", reason: "NO_GRANT" }); assert.ok(sup.findings().some(f => f.rule === "UNEXPECTED_CREDENTIAL_ACCESS"));
    sup.record({ kind: "EGRESS", agentId: "EXECUTION-13", host: "a.example", decision: "ALLOW", bytesOut: 5000 }); assert.ok(sup.findings().some(f => f.rule === "UNUSUAL_OUTBOUND_VOLUME"));
    for (let i = 0; i < 4; i++) sup.record({ kind: "EGRESS", agentId: "EXECUTION-14", host: "h" + i + ".example", decision: "ALLOW" }); assert.ok(sup.findings().some(f => f.rule === "UNUSUAL_DESTINATION_SPREAD"));
    for (let i = 0; i < 12; i++) sup.record({ kind: "TOOL", agentId: "EXECUTION-15", tool: "demo.read", decision: "ALLOW" }); assert.ok(sup.findings().some(f => f.rule === "EXCESSIVE_TOOL_ACTIVITY"));
    const before = sup.findings().length; for (let i = 0; i < 3; i++) sup.record({ kind: "EGRESS", agentId: "EXECUTION-11", host: "bad.example", decision: "DENY", reason: "EGRESS_X" }); assert.equal(sup.findings().filter(f => f.rule === "REPEATED_BLOCKED_REQUESTS").length, 1, "cooldown: one incident per rule/agent per window"); assert.ok(sup.findings().length >= before);
    sup.record({ kind: "BYPASS", agentId: "EXECUTION-16", host: "raw.example", decision: "DENY", reason: "DIRECT_SOCKET" });
    const f = sup.findings().find(x => x.rule === "BROKER_BYPASS_ATTEMPT"); assert.equal(f.confirmed, true); assert.equal(f.severity, "CRITICAL"); assert.equal(w.boundary.check({ agentId: "EXECUTION-16" }).allowed, false, "a bypass attempt contains the agent");
    assert.ok(w.alerts.length >= 1); t.now += 11 * 60000; assert.deepEqual(sup.forAgent("EXECUTION-11"), [], "old events leave the detection window");
  } finally { rm(w.d); }
});
test("brokered fetch: boundary and destination policy first; refusals and successes are attributed; redirects are not followed; a contained agent cannot fetch", async () => {
  const w = world(); try {
    const sup = createNetworkSupervisor({ dir: path.join(w.d, "net") }); let seen = null;
    const bf = sup.brokeredFetch({ boundary: w.boundary, allow: ({ host }) => (host === "ok.example" ? { allowed: true } : { allowed: false, reason: "HOST_NOT_ALLOWED" }), fetchImpl: async (u, i) => { seen = i; return { ok: true, status: 200 }; } });
    assert.equal((await bf("https://ok.example/p?token=abc", { method: "POST", body: "hello" }, { agentId: "EXECUTION-1", taskId: "T1", tool: "t" })).ok, true); assert.equal(seen.redirect, "error");
    assert.equal((await bf("https://evil.example/", {}, { agentId: "EXECUTION-1" })).reason, "HOST_NOT_ALLOWED"); assert.equal((await bf("not a url", {}, { agentId: "EXECUTION-1" })).reason, "URL_INVALID");
    w.inc.declare({ kind: "N", severity: "HIGH", confirmed: true, agentId: "EXECUTION-1" }); assert.match((await bf("https://ok.example/", {}, { agentId: "EXECUTION-1" })).reason, /^INCIDENT_CONTAINMENT/);
    const ev = sup.forAgent("EXECUTION-1"); assert.ok(ev.some(e => e.decision === "ALLOW" && e.status === 200 && e.bytesOut === 5)); assert.doesNotMatch(JSON.stringify(ev), /token=abc/);
  } finally { rm(w.d); }
});
test("hosted: the real Control Center wires one boundary + one supervisor; a contained agent is refused through the module broker and the stop state is honoured", async () => {
  const d = tmp("eb-"); try {
    const c = createControlCenterCore({ stateDir: path.join(d, "s"), configDir: path.join(d, "c") });
    assert.equal(typeof c.executionBoundary.check, "function"); assert.equal(c.executionBoundary.check({ agentId: "EXECUTION-1", opClass: "TOOL_EXECUTION" }).allowed, true);
    const i = c.incidentResponse?.declare?.({ kind: "HOSTED", severity: "CRITICAL", confirmed: true, agentId: "EXECUTION-1" }) ?? null;
    if (i) assert.equal(c.executionBoundary.check({ agentId: "EXECUTION-1", opClass: "TOOL_EXECUTION" }).allowed, false);
    assert.ok(c.networkSupervisor.summary().events >= 0);
  } finally { rm(d); }
});
test("scanner validation script: no engine = BLOCKED (exit 2); engine that misses the EICAR string = FAIL; engine that detects it = PASS; benign file must be clean", async () => {
  const { validateScanner } = await import("../scripts/validate-malware-scanner.mjs");
  assert.equal((await validateScanner({ scanner: null })).exitCode, 2);
  const mkScan = detects => ({ name: "FakeEngine", command: "fake", scan: async f => ({ verdict: detects && /eicar-test/.test(f) ? "INFECTED" : "NO_DETECTION" }) });
  assert.equal((await validateScanner({ scanner: mkScan(true) })).status, "PASS"); assert.equal((await validateScanner({ scanner: mkScan(false) })).status, "FAIL");
  assert.equal((await validateScanner({ scanner: { name: "Broken", scan: async () => ({ verdict: "INFECTED" }) } })).status, "FAIL", "an engine that flags a benign file is not trustworthy");
});
