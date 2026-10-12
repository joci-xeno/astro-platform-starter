import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createRevenuePersistence, scoreOpportunity } from "../atlasz-addons/revenue-persistence.mjs";
const NOW = "2026-10-12T00:00:00Z";
test("score uses net, success probability, risk, time and deadline; every score is explained and advisory only", () => {
  const a = scoreOpportunity({ id: "a", expectedNetUsd: 1000, feasibility: 0.8, paymentProbability: 0.5, customerReliability: 1, risk: 0.2, daysToRevenue: 30, deadlineAt: "2026-10-14T00:00:00Z" }, { now: NOW });
  assert.equal(a.score, Math.round(1000 * 0.4 * 0.8 * 0.5 * 1.5 * 100) / 100); assert.equal(a.advisory, true); assert.equal(a.bypassesApproval, false); assert.match(a.explanation, /Score/);
});
test("unknown value is never zero: unknown net gives null score and lowest rank; unknown factors are listed and lower confidence", () => {
  const u = scoreOpportunity({ id: "u", feasibility: 1, paymentProbability: 1 }, { now: NOW }); assert.equal(u.score, null); assert.equal(u.dispatchable, false); assert.ok(u.unknown.includes("expectedNetUsd")); assert.ok(u.confidence < 1);
});
test("hard blockers: owner restriction, no model, no free agent, deadline passed or unreachable; a blocked item never outranks a dispatchable one", () => {
  const base = { id: "x", expectedNetUsd: 9999, feasibility: 1, paymentProbability: 1, risk: 0, daysToRevenue: 1 };
  assert.ok(scoreOpportunity({ ...base, category: "TRADING" }, { now: NOW, ownerRestrictions: { blockedCategories: ["TRADING"] } }).blockers.some(b => /OWNER_RESTRICTION/.test(b)));
  assert.ok(scoreOpportunity(base, { now: NOW, modelsAvailable: false }).blockers.includes("NO_USABLE_MODEL_AVAILABLE"));
  assert.ok(scoreOpportunity(base, { now: NOW, freeExecutionAgents: 0 }).blockers.includes("NO_FREE_AGENT"));
  assert.ok(scoreOpportunity({ ...base, deadlineAt: "2026-10-01T00:00:00Z" }, { now: NOW }).blockers.includes("DEADLINE_PASSED"));
  assert.ok(scoreOpportunity({ ...base, daysToRevenue: 20, deadlineAt: "2026-10-15T00:00:00Z" }, { now: NOW }).blockers.includes("CANNOT_FINISH_BEFORE_DEADLINE"));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rp-")), rp = createRevenuePersistence({ dir: d });
  assert.equal(rp.track({ id: "big", searchAgent: "SEARCH-1", expectedNetUsd: 9999, feasibility: 1, paymentProbability: 1, category: "TRADING" }).ok, true);
  assert.equal(rp.track({ id: "small", searchAgent: "SEARCH-2", expectedNetUsd: 10, feasibility: 1, paymentProbability: 1 }).ok, true);
  assert.equal(rp.track({ id: "unk", searchAgent: "SEARCH-3" }).ok, true);
  const r = rp.rankedExplained({ now: NOW, ownerRestrictions: { blockedCategories: ["TRADING"] } });
  assert.deepEqual(r.map(x => x.id), ["small", "big", "unk"]); assert.equal(r[0].dispatchable, true);
});
