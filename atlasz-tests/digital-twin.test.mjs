import test from "node:test";
import assert from "node:assert/strict";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createDigitalTwin } from "../atlasz-addons/digital-twin.mjs";

const key = generateOwnerKeyPair(), ownerAuth = createOwnerAuth({ publicKeyB64: key.publicKeyB64 });
const sign = (a, s) => issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action: a, subject: s });
const ok = { kind: "OFFER", summary: "Quote project A", costUsd: 0, expectedRevenueUsd: 1000, probability: 0.6, reversible: true, assumptions: [{ text: "Client has budget", evidence: "email 2026-10-01" }] };

test("simulation is always labelled SIMULATED, never proof, and models expected value / margin", () => {
  const t = createDigitalTwin({ ownerAuth }), s = t.simulate(ok);
  assert.equal(s.environment, "SIMULATED"); assert.equal(s.isProof, false); assert.match(s.disclaimer, /Not evidence/);
  assert.equal(s.model.expectedRevenueUsd, 600); assert.equal(s.model.expectedNetUsd, 600); assert.equal(s.verdict, "PROCEED_TO_JUDGE");
});
test("spend, irreversibility, unverified assumptions, budget and margin violations and forbidden resources are detected", () => {
  const t = createDigitalTwin({ ownerAuth });
  const a = t.simulate({ ...ok, costUsd: 50, reversible: false, assumptions: [{ text: "guess" }] });
  assert.ok(a.problems.includes("SPEND_REQUIRES_JOCI_APPROVAL")); assert.ok(a.problems.includes("IRREVERSIBLE")); assert.ok(a.problems.some(p => p.startsWith("UNVERIFIED_ASSUMPTIONS")));
  assert.equal(t.simulate({ ...ok, costUsd: 500, constraints: { maxCostUsd: 100 } }).verdict, "REJECT");
  assert.equal(t.simulate({ ...ok, costUsd: 590, constraints: { minMarginPct: 20 } }).verdict, "REJECT");
  const c = t.simulate({ ...ok, touches: ["prod-db"], constraints: { forbiddenResources: ["prod-db"] } });
  assert.equal(c.verdict, "REJECT"); assert.deepEqual(c.conflicts, ["FORBIDDEN_RESOURCE:prod-db"]);
  assert.ok(t.simulate({ ...ok, touches: ["x"] }, { baseline: { lockedResources: ["x"] } }).conflicts[0].startsWith("RESOURCE_LOCKED"));
});
test("compare ranks by risk-adjusted value and never recommends a rejected alternative", () => {
  const t = createDigitalTwin({ ownerAuth });
  const a = t.simulate(ok), b = t.simulate({ ...ok, summary: "Bigger but forbidden", expectedRevenueUsd: 99999, touches: ["x"], constraints: { forbiddenResources: ["x"] } });
  const r = t.compare([a.id, b.id]); assert.equal(r.recommendation, a.id); assert.equal(r.rejected[0].id, b.id);
});
test("SIMULATE -> JUDGE -> EXECUTE: no execution without an independent judge PASS; consequential kinds also need an owner approval bound to that simulation", async () => {
  const t = createDigitalTwin({ ownerAuth }), s = t.simulate(ok);
  assert.equal(t.authorizeExecution(s.id).reason, "NOT_JUDGED");
  await assert.rejects(t.judge(s.id, { judgeId: "MASTER", judgeFn: () => ({ pass: true }) }), /JUDGE_MUST_BE_INDEPENDENT/);
  await assert.rejects(t.judge(s.id, { judgeId: "judge-1" }), /JUDGE_FUNCTION_REQUIRED/);
  await t.judge(s.id, { judgeId: "judge-1", judgeFn: () => ({ pass: false, reasons: ["thin margin"] }) });
  assert.equal(t.authorizeExecution(s.id).reason, "JUDGE_DID_NOT_PASS");
  await t.judge(s.id, { judgeId: "judge-1", judgeFn: () => ({ pass: true }) });
  assert.match(t.authorizeExecution(s.id).reason, /OWNER_APPROVAL_REQUIRED/);                       // OFFER is consequential
  assert.match(t.authorizeExecution(s.id, { ownerApproval: true }).reason, /OWNER_APPROVAL_REQUIRED/);
  assert.match(t.authorizeExecution(s.id, { ownerApproval: sign("EXECUTE_SIMULATED_CHANGE", "wrong") }).reason, /OWNER_APPROVAL_REQUIRED/);
  const g = t.get(s.id); assert.equal(t.authorizeExecution(s.id, { ownerApproval: sign("EXECUTE_SIMULATED_CHANGE", g.id + ":" + g.hash.slice(0, 16)) }).allowed, true);
  const r = createDigitalTwin({ ownerAuth }), rej = r.simulate({ ...ok, touches: ["x"], constraints: { forbiddenResources: ["x"] } });
  await r.judge(rej.id, { judgeId: "j", judgeFn: () => ({ pass: true }) });
  assert.equal(r.authorizeExecution(rej.id).reason, "SIMULATION_REJECTED");                          // a lenient judge cannot override a rejected simulation
});
