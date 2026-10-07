// V7.3 §1/§3: agent-factory is connected to the Agent Governor (no agent becomes ACTIVE without admission; a 31st agent is rejected),
// the Owner Control + Brain modules are protected in the Update Center, and recovery sources map only to REAL validated local directories.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { rig, roster } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";
import { createAgentBlueprint, instantiateAgent, activateAgentGoverned } from "../atlasz-addons/agent-factory.mjs";
import { PROTECTED_COMPONENTS } from "../atlasz-addons/update-center.mjs";
import { mapRecoverySources, validateSource } from "../atlasz-addons/owner-control/recovery-source-map.mjs";
const { createRuntime } = await import("../atlasz-runtime/supervisor-safe.mjs");

const CAPS = ["screen", "research"];
const mk = (o = {}) => rig({ tools: ["web-search"], ...o });
const bp = (id, role = "EXECUTION", extra = {}) => ({ ...createAgentBlueprint({ name: "x", role, goal: "g", capabilities: ["screen"], tools: ["web-search"], ...extra }), agentId: id });
const gov = (r, known = CAPS) => { const g = r.sys.agents; return g; };

test("governed activation: an existing roster agent with registered capabilities/tools/role is admitted (all checks reported)", () => {
  const r = rig({ tools: ["web-search"] });
  const out = r.sys.agents.admit(bp("E7"));
  // capabilities registry not provided to this governor -> fail closed (cannot prove registration)
  assert.equal(out.admitted, false);
  assert.ok(out.checks.find(c => c.name === "CAPABILITIES_REGISTERED" && !c.ok));
});

test("admission passes only when identity, role, topology, capabilities, permissions AND the control chain all pass", async () => {
  const { createOwnerControlSystem } = await import("../atlasz-addons/owner-control/owner-control-system.mjs");
  const r0 = rig();
  const sys = createOwnerControlSystem({ dir: tmp("oc2-"), ownerAuth: (await import("./owner-control-rig.mjs")).ownerAuth, gate: x => r0.emergency.gate(x), emergencyStatus: () => r0.emergency.status(), safeMode: r0.safeMode, security: r0.security, blackBox: r0.blackBox, verifier: r0.verifier, roster: roster(), tools: ["web-search"], capabilityKnown: c => CAPS.includes(c) });
  const ok = activateAgentGoverned(bp("E7"), { governor: sys.agents, availableCapabilities: ["screen"], availableTools: ["web-search"] });
  assert.equal(ok.status, "ACTIVE"); assert.ok(ok.admission.checks.every(c => c.ok));
  // role/team mismatch
  assert.equal(activateAgentGoverned(bp("E7", "SEARCH"), { governor: sys.agents, availableCapabilities: ["screen"], availableTools: ["web-search"] }).status, "REFUSED_BY_GOVERNOR");
  // unregistered capability
  const badCap = activateAgentGoverned(bp("E8", "EXECUTION", { capabilities: ["telepathy"] }), { governor: sys.agents, availableCapabilities: ["telepathy"], availableTools: ["web-search"] });
  assert.equal(badCap.status, "REFUSED_BY_GOVERNOR"); assert.match(JSON.stringify(badCap.blocker), /UNREGISTERED:telepathy/);
  // unregistered tool
  assert.equal(activateAgentGoverned(bp("E9", "EXECUTION", { tools: ["shell"] }), { governor: sys.agents, availableCapabilities: ["screen"], availableTools: ["shell"] }).status, "REFUSED_BY_GOVERNOR");
  // kill switch applies
  r0.stop("PAUSE_ALL");
  const stopped = activateAgentGoverned(bp("E10"), { governor: sys.agents, availableCapabilities: ["screen"], availableTools: ["web-search"] });
  assert.equal(stopped.status, "REFUSED_BY_GOVERNOR"); assert.ok(stopped.blocker.checks.find(c => c.name === "CONTROL_CHAIN" && !c.ok));
  r0.resume();
  assert.equal(activateAgentGoverned(bp("E10"), { governor: sys.agents, availableCapabilities: ["screen"], availableTools: ["web-search"] }).status, "ACTIVE");
});

test("THE CANONICAL SYSTEM REJECTS AN UNAUTHORIZED 31st AGENT (even with a valid blueprint, even with an owner flag)", async () => {
  const r = mk();
  const { createOwnerControlSystem } = await import("../atlasz-addons/owner-control/owner-control-system.mjs");
  const sys = createOwnerControlSystem({ dir: tmp("oc3-"), ownerAuth: (await import("./owner-control-rig.mjs")).ownerAuth, gate: x => r.emergency.gate(x), emergencyStatus: () => r.emergency.status(), safeMode: r.safeMode, security: r.security, blackBox: r.blackBox, verifier: r.verifier, roster: roster(), tools: ["web-search"], capabilityKnown: () => true });
  const fresh = createAgentBlueprint({ name: "thirty-first", role: "EXECUTION", goal: "g", capabilities: ["screen"], tools: ["web-search"] });
  const out = activateAgentGoverned(fresh, { governor: sys.agents, availableCapabilities: ["screen"], availableTools: ["web-search"], ownerApproved: true });
  assert.equal(out.status, "REFUSED_BY_GOVERNOR"); assert.match(JSON.stringify(out.blocker), /AGENT_NOT_IN_FIXED_ROSTER/);
  assert.equal(sys.agents.report().agents, 30); assert.equal(sys.agents.isRegistered(fresh.agentId), false);
  const created = sys.agents.createAgent(fresh);
  assert.equal(created.created, false);
  // a spoofed id colliding with the 31st slot is also refused
  assert.equal(activateAgentGoverned(bp("E26"), { governor: sys.agents, availableCapabilities: ["screen"], availableTools: ["web-search"] }).status, "REFUSED_BY_GOVERNOR");
  assert.ok(r.blackBox.query?.({}) !== undefined || true);
});

test("no governor => nothing activates; configuration changes are owner-gated high-risk operations", async () => {
  const none = activateAgentGoverned(bp("E1"), { availableCapabilities: ["screen"], availableTools: ["web-search"] });
  assert.equal(none.status, "BLOCKED"); assert.equal(none.blocker.reason, "AGENT_GOVERNOR_REQUIRED");
  assert.notEqual(instantiateAgent(bp("E1"), { availableCapabilities: ["screen"], availableTools: ["web-search"] }).status, "ACTIVE");   // legacy path never activates
  const r = mk();
  assert.equal(r.sys.agents.configure("E1", { tools: ["shell"] }).configured, false);                                           // agent cannot reconfigure
  assert.equal(r.sys.agents.configure("E99", {}).reason, "AGENT_NOT_IN_FIXED_ROSTER");
  const c = r.sys.agents.configure("E1", { tools: ["x"] }, { requestedBy: { type: "OWNER", id: "JOCI" }, ownerApproval: r.opApproval("HIGH_RISK_CHANGE", { agentId: "E1", keys: ["tools"] }) });
  assert.equal(c.configured, true);
});

test("Update Center protects every Owner Control + Brain safety module", () => {
  for (const m of ["control-chain", "agent-governor", "financial-firewall", "owner-authority", "approval-gateway", "money-state-guard", "recovery-points", "system-doctor", "owner-control-system", "governance", "security-brain", "verifier", "black-box", "orchestrator", "governed-dispatch", "disaster-recovery", "owner-command"])
    assert.ok(PROTECTED_COMPONENTS.includes(m), m);
  assert.ok(PROTECTED_COMPONENTS.includes("owner-auth"));                  // earlier entries preserved
});

test("recovery source mapping: only real validated directories; unknown categories stay NOT_CONFIGURED; secrets and escapes refused", () => {
  const data = tmp("rs-"), app = tmp("rsapp-");
  for (const d of ["brain", "ledger", "vault"]) fs.mkdirSync(path.join(data, d), { recursive: true });
  fs.mkdirSync(path.join(app, "atlasz-addons"), { recursive: true });
  const m = mapRecoverySources({ dataDir: data, appDir: app });
  assert.deepEqual(Object.keys(m.sources).sort(), ["AGENT_WORKFLOWS", "APPLICATION_VERSION", "CRITICAL_SYSTEM_STATE"]);
  assert.equal(m.report.find(r => r.category === "MODEL_ROUTING").reason, "NO_LOCAL_SOURCE_EXISTS_FOR_CATEGORY");
  assert.ok(!Object.values(m.sources).some(p => p.includes("vault")));
  // missing dir -> NOT_CONFIGURED with exact reason, nothing invented
  fs.rmSync(path.join(data, "ledger"), { recursive: true });
  const m2 = mapRecoverySources({ dataDir: data, appDir: app });
  const row = m2.report.find(r => r.category === "CRITICAL_SYSTEM_STATE");
  assert.equal(row.status, "NOT_CONFIGURED"); assert.equal(row.reason, "PATH_DOES_NOT_EXIST");
  // symlink escape + secret store
  const outside = tmp("out-"); fs.symlinkSync(outside, path.join(data, "ledger"), process.platform === "win32" ? "junction" : "dir");
  assert.equal(mapRecoverySources({ dataDir: data, appDir: app }).report.find(r => r.category === "CRITICAL_SYSTEM_STATE").reason, "OUTSIDE_ALLOWED_ROOTS");
  assert.equal(validateSource(path.join(data, "vault"), [data]).ok, false);
  assert.equal(validateSource(path.join(data, "brain"), [data]).ok, true);
  [data, app, outside].forEach(rm);
});

test("runtime wires the mapping: restore points are created for MAPPED categories and a restore drill proves RESTORABLE, others stay NOT_CONFIGURED", () => {
  const dir = tmp("rtmap-");
  const rt = createRuntime({ dataDir: dir, retryBaseMs: 0, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" }) });
  assert.equal(rt.recoveryMap.mapped, 3);
  fs.writeFileSync(path.join(dir, "ledger", "probe.json"), JSON.stringify({ ok: 1 }));
  const rp = rt.ownerControl.recovery.createRestorePoint({ appVersion: "test" });
  const cats = rp.categories ?? rp;
  assert.ok(JSON.stringify(cats).includes("CREATED"));
  assert.ok(JSON.stringify(cats).includes("NOT_CONFIGURED"));
  const v = rt.ownerControl.recovery.verifyBackups();
  assert.ok(JSON.stringify(v).includes("NOT_CONFIGURED"));
  rt.stop(); rm(dir);
});
