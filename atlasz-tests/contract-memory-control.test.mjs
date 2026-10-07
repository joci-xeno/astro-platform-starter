// S07 contract tests + control-plane emergency-stop enforcement.
import test from "node:test";
import assert from "node:assert/strict";
import { remember, recall } from "../atlasz-addons/business-memory.mjs";
import { recordExperience, lessonsFor, approveLesson } from "../atlasz-addons/experience-learning-engine.mjs";
import { upsertEntity, linkEntities, entityView } from "../atlasz-addons/unified-entity-graph.mjs";
import { createProject, projectGet, updateProject } from "../atlasz-addons/shared-project-registry.mjs";
import { registerAgentControl, authorize } from "../atlasz-addons/enterprise-control-plane.mjs";

test("business-memory: remember/recall filters and expired entries are not recalled", () => {
  remember({ entityType: "client", entityId: "c1", category: "pref", text: "likes email", importance: 0.9 });
  remember({ entityType: "client", entityId: "c1", category: "pref", text: "old", expiresAt: new Date(Date.now() - 1000).toISOString() });
  const r = recall({ entityType: "client", entityId: "c1" });
  assert.ok(r.some(x => x.text === "likes email"));
  assert.ok(!r.some(x => x.text === "old"));
  assert.equal(recall({ entityType: "client", entityId: "nobody" }).length, 0);
});
test("experience-learning: lessons are reusable only after owner approval", () => {
  const e = recordExperience({ tenantId: "t1", agentId: "a", taskType: "tt-mem", action: "x", outcome: "OK", reward: 5 });
  assert.equal(lessonsFor({ tenantId: "t1", taskType: "tt-mem" }).length, 0);
  assert.throws(() => approveLesson(e.id, { ownerApproved: true }), /OWNER_APPROVAL_REQUIRED/);
  assert.equal(lessonsFor({ tenantId: "t1", taskType: "tt-mem" }).length, 0);
});
test("entity graph is tenant-isolated", () => {
  upsertEntity({ tenantId: "A", type: "client", id: "x", attributes: { n: 1 } });
  upsertEntity({ tenantId: "B", type: "client", id: "x", attributes: { n: 2 } });
  linkEntities({ tenantId: "A", fromType: "client", fromId: "x", toType: "job", toId: "j", relation: "OWNS" });
  assert.equal(entityView({ tenantId: "A", type: "client", id: "x" }).relationships.length, 1);
  assert.equal(entityView({ tenantId: "B", type: "client", id: "x" }).relationships.length, 0);
  assert.throws(() => upsertEntity({ tenantId: "A", type: "client" }), /ENTITY_FIELDS_REQUIRED/);
});
test("shared-project-registry: owner must be JOCI; patch cannot change owner/id", () => {
  assert.throws(() => createProject({ projectId: "p1", objective: "o", owner: "AGENT" }), /PROJECT_OWNER_MUST_BE_JOCI/);
  createProject({ projectId: "p1", objective: "o" });
  updateProject("p1", { owner: "AGENT", projectId: "zzz", objective: "o2" });
  const p = projectGet("p1");
  assert.equal(p.owner, "JOCI"); assert.equal(p.projectId, "p1");
});
test("control-plane authorize obeys the owner emergency stop (and still allows when running)", () => {
  registerAgentControl({ agentId: "ag", tenantId: "T", owner: "JOCI", permissions: ["read"], tools: ["web"] });
  assert.equal(authorize({ tenantId: "T", agentId: "ag", permission: "read" }).allowed, true);
  const stop = () => ({ allowed: false, reason: "PAUSE_ALL" });
  const d = authorize({ tenantId: "T", agentId: "ag", permission: "read", tool: "web", gate: stop });
  assert.equal(d.allowed, false); assert.equal(d.reason, "OWNER_EMERGENCY_STOP");
  assert.equal(authorize({ tenantId: "T", agentId: "ag", permission: "read", gate: () => ({ allowed: true }) }).allowed, true);
});
