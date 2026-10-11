// Phase 5 agent registry: exactly 30 fixed identities, persistence across restart, tamper detection, owner-controlled limits.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createAgentRegistry, ROSTER, limitsSubject } from "../atlasz-addons/agent-registry.mjs";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { tmp, rm } from "./helpers.mjs";

const kp = generateOwnerKeyPair(), auth = () => createOwnerAuth({ publicKeyB64: kp.publicKeyB64 });
test("exactly 30 agents (5 SEARCH + 25 EXECUTION), valid profiles, none LIVE merely by registration, no coordinator entry", () => {
  const d = tmp("areg-"); try {
    const r = createAgentRegistry({ dir: d }), l = r.list();
    assert.equal(l.length, 30); assert.equal(l.filter(a => a.team === "SEARCH").length, 5); assert.equal(l.filter(a => a.team === "EXECUTION").length, 25);
    assert.deepEqual(l.map(a => a.id), [...ROSTER]); assert.equal(new Set(l.map(a => a.name)).size, 30);
    for (const a of l) { assert.equal(a.status, "REGISTERED_READY"); assert.equal(a.capabilityProfile.fixedNiche, null); assert.ok(a.limits.maxRetries >= 0); assert.ok(Array.isArray(a.authorisedTools)); assert.equal(a.limits.maxCostUsdPerDay, 0, "no-spend by default"); }
    assert.equal(l.some(a => /coordinator|master/i.test(a.id)), false); assert.equal(r.summary().masterCoordinatorIsAgent, false); assert.equal(r.summary().integrity, "OK");
    assert.equal(r.get("COORDINATOR"), null); assert.equal(r.get("EXECUTION-26"), null); assert.equal(r.get("__proto__"), null);
  } finally { rm(d); }
});
test("identities and changes persist across restart; pause/rename work; unknown ids are refused", () => {
  const d = tmp("areg-"); try {
    let r = createAgentRegistry({ dir: d });
    assert.equal(r.setPaused("EXECUTION-3", true, "maintenance").ok, true); assert.equal(r.rename("SEARCH-2", "Scout Two").ok, true);
    assert.equal(r.setPaused("EXECUTION-26", true).reason, "NOT_ONE_OF_THE_30_PERMANENT_AGENTS"); assert.equal(r.rename("SEARCH-2", "<script>").reason, "NAME_INVALID");
    r = createAgentRegistry({ dir: d });
    assert.equal(r.list().length, 30); assert.equal(r.get("EXECUTION-3").status, "PAUSED"); assert.equal(r.get("SEARCH-2").name, "Scout Two"); assert.equal(r.isUsable("EXECUTION-3"), false); assert.equal(r.isUsable("EXECUTION-4"), true);
    assert.equal(r.verify().ok, true);
  } finally { rm(d); }
});
test("a hand-edited, truncated or deleted registry file makes the registry read only (fail closed), not silently reseeded", () => {
  for (const mode of ["edit", "garbage", "delete"]) {
    const d = tmp("areg-"); try {
      createAgentRegistry({ dir: d }); const f = path.join(d, "agents.json");
      if (mode === "edit") { const w = JSON.parse(fs.readFileSync(f, "utf8")), b = JSON.parse(w.body); b.agents["EXECUTION-1"].limits.maxCostUsdPerDay = 500; const body = JSON.stringify(b); fs.writeFileSync(f, JSON.stringify({ sha: (await_sha(body)), body })); }
      if (mode === "garbage") fs.writeFileSync(f, "{not json"); if (mode === "delete") fs.rmSync(f);
      const r = createAgentRegistry({ dir: d });
      assert.equal(r.summary().readOnly, true, mode); assert.notEqual(r.summary().integrity, "OK"); assert.equal(r.setPaused("SEARCH-1", true).ok, false); assert.equal(r.isUsable("SEARCH-1"), false); assert.equal(r.list().length, 0);
    } finally { rm(d); }
  }
});
import { createHash } from "node:crypto"; function await_sha(t) { return createHash("sha256").update(t).digest("hex"); }
test("raising a cost limit needs a signed owner approval bound to the exact limits; lowering does not; out-of-range values are refused", () => {
  const d = tmp("areg-"); try {
    const r = createAgentRegistry({ dir: d, ownerAuth: auth() });
    assert.equal(r.setLimits("EXECUTION-1", { maxCostUsdPerDay: 5 }).reason, "OWNER_APPROVAL_REQUIRED");
    const next = { ...r.get("EXECUTION-1").limits, maxCostUsdPerDay: 5 };
    assert.equal(r.setLimits("EXECUTION-1", { maxCostUsdPerDay: 5 }, { ownerApproval: issueOwnerApproval({ privateKeyPem: kp.privateKeyPem, action: "AGENT_LIMITS_RAISE", subject: limitsSubject("EXECUTION-2", next) }) }).ok, false, "approval for another agent");
    const ap = issueOwnerApproval({ privateKeyPem: kp.privateKeyPem, action: "AGENT_LIMITS_RAISE", subject: limitsSubject("EXECUTION-1", next) });
    assert.equal(r.setLimits("EXECUTION-1", { maxCostUsdPerDay: 5 }, { ownerApproval: ap }).ok, true);
    assert.equal(r.setLimits("EXECUTION-1", { maxCostUsdPerDay: 5 }, { ownerApproval: ap }).ok, true, "same value is not a raise");
    assert.equal(r.setLimits("EXECUTION-1", { maxCostUsdPerDay: 9 }, { ownerApproval: ap }).reason, "OWNER_APPROVAL_REQUIRED", "approval cannot be reused for a different value");
    assert.equal(r.setLimits("EXECUTION-1", { maxCostUsdPerDay: 1 }).ok, true, "lowering is free");
    assert.match(r.setLimits("EXECUTION-1", { maxRetries: 99 }).reason, /LIMIT_OUT_OF_BOUNDS/); assert.match(r.setLimits("EXECUTION-1", { maxCostUsdPerDay: NaN }).reason, /LIMIT_OUT_OF_BOUNDS/); assert.match(r.setLimits("EXECUTION-1", { evil: 1 }).reason, /UNKNOWN_FIELD/);
    assert.equal(createAgentRegistry({ dir: d, ownerAuth: auth() }).get("EXECUTION-1").limits.maxCostUsdPerDay, 1);
  } finally { rm(d); }
});
test("kill switch / safe mode freezes registry changes", () => {
  const d = tmp("areg-"); try { const r = createAgentRegistry({ dir: d, isStopped: () => true }); assert.equal(r.setPaused("SEARCH-1", true).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); assert.equal(createAgentRegistry({ dir: d, isStopped: () => { throw new Error("x"); } }).setPaused("SEARCH-1", true).ok, false); } finally { rm(d); }
});
