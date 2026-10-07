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
