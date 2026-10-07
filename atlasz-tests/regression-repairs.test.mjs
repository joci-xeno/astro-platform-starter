// Regression tests for defects found by the V7.3 audit in pre-existing modules.
import test from "node:test";
import assert from "node:assert/strict";
import { registerAgentControl, controlPlaneStatus } from "../atlasz-addons/enterprise-control-plane.mjs";
import { createProject, projectList } from "../atlasz-addons/shared-project-registry.mjs";
import { createInternalAddonHub } from "../atlasz-addons/internal-integration-hub.mjs";

test("REPAIR: controlPlaneStatus works once agents are registered (was: map(structuredClone) threw)", () => {
  registerAgentControl({ agentId: "R1", tenantId: "TR", owner: "JOCI", permissions: ["P"], tools: [] });
  assert.equal(controlPlaneStatus().agents.some(a => a.agentId === "R1"), true);
});
test("REPAIR: projectList works with entries (was: map(structuredClone) threw)", () => {
  createProject({ projectId: "PR1", objective: "regression" });
  assert.ok(projectList().length >= 1);
});
test("hub snapshot exposes control-plane status after agents register (was silently null)", () => {
  const hub = createInternalAddonHub({ tenantId: "TH", dailyBudgetUsd: 0 });
  hub.onAgentRegistered({ id: "SEARCH-1", role: "SEARCH", status: "STARTING" });
  const s = hub.snapshot();
  assert.ok(s.control && Array.isArray(s.control.agents), "control must not be null");
  assert.equal(s.externalSideEffects, false);
});

test("REPAIR: an unknown runtime event must not cause an unhandled rejection (would crash Node >=15)", async () => {
  const seen = []; const h = e => seen.push(String(e?.message || e)); process.on("unhandledRejection", h);
  try {
    const hub = createInternalAddonHub({ tenantId: "TU", dailyBudgetUsd: 0 });
    hub.onRuntimeEvent("never_heard_of_this_event", { a: 1 });
    hub.onRuntimeEvent("dispatch_blocked", { agentId: "SEARCH-1", reason: "PAUSE_ALL" });
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(seen, [], "unhandled rejections: " + seen.join(","));
    const errs = hub.snapshot().errors; assert.ok(errs.some(e => e.event === "NEVER_HEARD_OF_THIS_EVENT"), "unknown event is recorded as an error, not swallowed");
    assert.ok(!errs.some(e => e.event === "DISPATCH_BLOCKED"), "dispatch_blocked is a registered event");
  } finally { process.off("unhandledRejection", h); }
});
