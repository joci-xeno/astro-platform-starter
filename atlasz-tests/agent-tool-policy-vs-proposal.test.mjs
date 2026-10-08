// The approved policy may differ from the proposal the owner reviewed ONLY where the owner decided so (D3, D5, D6) - nothing else may drift.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_POLICY, DEFAULT_LIMITS } from "../atlasz-addons/agent-tool-policy.mjs";
const P = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "m2_tool_permissions_PROPOSED.json"), "utf8"));
test("approved policy = reviewed proposal + exactly the owner's stricter decisions", () => {
  assert.deepEqual(Object.keys(TOOL_POLICY).sort(), Object.keys(P.tools).sort());
  const diffs = [];
  for (const [n, v] of Object.entries(P.tools)) for (const role of ["SEARCH", "EXECUTION"]) if (TOOL_POLICY[n][role] !== v[role]) diffs.push(`${n}:${role}:${v[role]}->${TOOL_POLICY[n][role]}`);
  assert.deepEqual(diffs.sort(), ["inbox.summary:EXECUTION:ALLOW->DENY", "money.panel:EXECUTION:ALLOW->DENY", "sandbox.run_process_only:EXECUTION:APPROVAL->DENY"]);
  for (const [n, v] of Object.entries(P.tools)) assert.equal(TOOL_POLICY[n].dataRisk, v.dataRisk, n);
  assert.equal(TOOL_POLICY["model.complete"].disabled !== null, true);
  const rank = { DENY: 0, APPROVAL: 1, ALLOW: 2 };
  for (const [n, v] of Object.entries(P.tools)) for (const role of ["SEARCH", "EXECUTION"]) assert.ok(rank[TOOL_POLICY[n][role]] <= rank[v[role]], "never looser than the proposal: " + n);
});
test("approved default limits equal the proposal in section 4 of the package (D2)", () => {
  const L = DEFAULT_LIMITS;
  assert.deepEqual([L.perAgentPerMinute, L.perAgentPerHour, L.perJob, L.perJobWrites, L.globalConcurrency, L.globalPerHour], [10, 100, 20, 5, 5, 300]);
  assert.deepEqual([L.perCallTimeoutMs, L.resultMaxBytes, L.refusalStreak, L.pendingApprovalsPerAgent, L.pendingApprovalsTotal], [15000, 65536, 5, 3, 20]);
  assert.deepEqual(L.perTool["sandbox.run"], { perJob: 3, perAgentPerHour: 10, timeoutMsCap: 10000 });
  assert.deepEqual(L.perTool["model.complete"], { perJob: 5, perAgentPerHour: 20, globalPerDay: 100, promptMaxChars: 8000 });
  assert.equal(L.perTool["research.add_source"].textMaxChars, 50000);
  assert.ok(Object.isFrozen(L) && Object.isFrozen(L.perTool) && Object.isFrozen(TOOL_POLICY) && Object.isFrozen(TOOL_POLICY["kp.list"]));
});
