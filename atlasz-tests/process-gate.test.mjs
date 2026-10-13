// SEC-GAP-5: child processes obey the execution boundary (incident block on the acting agent, owner stop). Real spawns of the local Node binary; no network.
import test, { afterEach } from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path";
import { processGate } from "../atlasz-addons/process-gate.mjs";
import { createExecutionBoundary } from "../atlasz-addons/execution-boundary.mjs";
import { restrictedNodeCommand } from "../atlasz-addons/restricted-node.mjs";
import { createToolRegistry } from "../atlasz-addons/typed-tools.mjs";
import { runRestrictedScript } from "../atlasz-addons/agent-executors.mjs";
import { tmp, rm } from "./helpers.mjs";
afterEach(() => processGate.configure(null));

test("before configuration the gate allows and says it is NOT enforced (honest)", () => { processGate.configure(null); const d = processGate.check({ tool: "x" }); assert.equal(d.allowed, true); assert.equal(d.enforced, false); assert.equal(processGate.isEnforced(), false); });
test("configured: owner stop and an incident block on the acting agent refuse spawns; other agents are unaffected", () => {
  let stopped = false; const blocked = new Set(["EXECUTION-7"]);
  processGate.configure(createExecutionBoundary({ isBlocked: ({ agentId }) => (blocked.has(agentId) ? "CONTAINED" : null), isStopped: () => stopped }));
  assert.equal(processGate.check({ tool: "t", agentId: "EXECUTION-3" }).allowed, true);
  const d = processGate.check({ tool: "t", agentId: "EXECUTION-7" }); assert.equal(d.allowed, false); assert.match(d.reason, /INCIDENT_CONTAINMENT/);
  const viaAls = processGate.runAs({ agentId: "EXECUTION-7" }, () => processGate.check({ tool: "t" })); assert.equal(viaAls.allowed, false, "ambient actor is attributed");
  stopped = true; assert.equal(processGate.check({ tool: "t", agentId: "EXECUTION-3" }).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
  processGate.configure({ check() { throw new Error("boom"); } }); assert.equal(processGate.check({ tool: "t" }).allowed, false, "a broken boundary fails closed");
});
test("restrictedNodeCommand (used by plugins, MCP servers, repo tests, agent executors, update self-tests) refuses while blocked and works again after", () => {
  const d = tmp("pg-"); try {
    const script = path.join(d, "s.mjs"); fs.writeFileSync(script, "export {}");
    let stopped = false; processGate.configure(createExecutionBoundary({ isStopped: () => stopped }));
    const ok = restrictedNodeCommand({ script, readDirs: [d] }); assert.doesNotMatch(String(ok.reason ?? ""), /BOUNDARY_REFUSED/, "not refused while running");
    stopped = true; const r = restrictedNodeCommand({ script, readDirs: [d] }); assert.equal(r.ok, false); assert.equal(r.reason, "BOUNDARY_REFUSED:OWNER_STOP_OR_SAFE_MODE_ACTIVE");
  } finally { rm(d); }
});
test("agent executor script run is refused (promise rejects, nothing spawned) while the owner stop is active", async () => {
  const d = tmp("pg-"); try {
    fs.writeFileSync(path.join(d, "t.mjs"), "process.stdout.write('ran')");
    processGate.configure(createExecutionBoundary({ isStopped: () => true }));
    await assert.rejects(() => runRestrictedScript(d, "t.mjs"), /BOUNDARY_REFUSED|SANDBOX_UNAVAILABLE/);
  } finally { rm(d); }
});
test("typed tool registry runs handlers with the calling agent as ambient actor; a spawn gate inside the handler is attributed and a contained agent never reaches the handler", async () => {
  const boundary = createExecutionBoundary({ isBlocked: ({ agentId }) => (agentId === "EXECUTION-9" ? "CONTAINED" : null) }); processGate.configure(boundary);
  const reg = createToolRegistry({ chain: { evaluate: () => ({ allowed: true }) }, boundary }); const seen = [];
  reg.register({ name: "demo.spawn", operation: "READ", input: { type: "object", properties: {}, additionalProperties: false }, output: { type: "object", properties: { ok: { type: "boolean" } }, additionalProperties: false }, handler: () => { seen.push(processGate.actor()); return { ok: processGate.check({ tool: "demo.spawn" }).allowed }; } });
  const r = await reg.invoke("demo.spawn", {}, { actor: { type: "AGENT", id: "EXECUTION-2" }, taskId: "t1" }); assert.equal(r.status, "OK", JSON.stringify(r)); assert.equal(seen[0].agentId, "EXECUTION-2"); assert.equal(seen[0].taskId, "t1");
  const b = await reg.invoke("demo.spawn", {}, { actor: { type: "AGENT", id: "EXECUTION-9" } }); assert.equal(b.status, "DENIED"); assert.equal(seen.length, 1, "handler not reached");
  assert.equal(processGate.actor(), null, "no ambient actor outside the handler");
});
