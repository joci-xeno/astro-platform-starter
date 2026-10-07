import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateOwnerKeyPair, issueOwnerApproval } from "../atlasz-addons/owner-auth.mjs";
import { OPERATIONS, FORBIDDEN_ATTEMPTS, actionSubject, approvalActionName } from "../atlasz-addons/owner-control/owner-authority.mjs";
import { CONTROLLED_PATHS } from "../atlasz-addons/owner-control/control-chain.mjs";
import { GATEWAY_OUTCOMES, createApprovalGateway } from "../atlasz-addons/owner-control/approval-gateway.mjs";
import { rig, sign, ownerAuth, KEY } from "./owner-control-rig.mjs";
import { rm } from "./helpers.mjs";

const REQ = (over = {}) => ({ operation: "PUBLISH", params: { page: "offer-1" }, what: "Publish offer page", why: "Customer-facing launch", requestedBy: { type: "BRAIN", id: "BUSINESS_FACTORY" }, target: "site:example", expectedResult: "Page live",
  costUsd: 0, financialRisk: "LOW", securityRisk: "LOW", dataRisk: "LOW", reversibility: "REVERSIBLE", rollbackPossible: true, requiredCredential: "OWNER_SIGNATURE_ED25519", ...over });

test("owner authority: every spec class needs Joci; unknown/forbidden operations fail closed", () => {
  const r = rig(); try {
    const a = r.sys.authority;
    for (const op of ["SPEND", "FINANCIAL_COMMITMENT", "SUBSCRIBE", "PURCHASE", "SIGN_CONTRACT", "CONFIGURE_PAYMENT", "DEPLOY_PRODUCTION", "CHANGE_SECURITY_SETTING", "CHANGE_CREDENTIAL", "CHANGE_OWNER_PERMISSION", "DELETE_DATA", "PUBLISH", "HIGH_RISK_CHANGE"])
      assert.equal(a.classify(op).requiresOwner, true, op);
    assert.equal(a.classify("MAKE_COFFEE").known, false); assert.equal(a.classify("MAKE_COFFEE").requiresOwner, true);
    for (const f of FORBIDDEN_ATTEMPTS) assert.equal(a.classify(f).forbidden, true, f);
    assert.ok(Object.isFrozen(OPERATIONS)); assert.equal(a.ownerId, "JOCI"); assert.equal(a.status().immutable, true);
    assert.equal(r.sys.chain.evaluate({ actor: { type: "AGENT", id: "E1" }, operation: "MAKE_COFFEE" }).verdict, "BLOCK");
  } finally { rm(r.dir); }
});

test("approvals are bound to the EXACT action: other params / other operation / bad signature / expiry / replay are all BLOCKED", () => {
  const r = rig(); try {
    const ev = (op, params, approval) => r.sys.chain.evaluate({ actor: { type: "BRAIN", id: "B" }, operation: op, params, ownerApproval: approval });
    const ok = r.opApproval("PUBLISH", { page: "A" });
    assert.equal(ev("PUBLISH", { page: "B" }, ok).verdict, "BLOCK");                       // approval for A does not authorize B (params)
    assert.match(ev("PUBLISH", { page: "B" }, ok).reason, /SUBJECT_MISMATCH/);
    assert.match(ev("SELL", { page: "A" }, ok).reason, /ACTION_MISMATCH/);                  // ... nor another operation
    const other = generateOwnerKeyPair();
    const forged = issueOwnerApproval({ privateKeyPem: other.privateKeyPem, action: approvalActionName("PUBLISH"), subject: actionSubject("PUBLISH", { page: "A" }) });
    assert.match(ev("PUBLISH", { page: "A" }, forged).reason, /SIGNATURE_INVALID/);
    const old = issueOwnerApproval({ privateKeyPem: KEY.privateKeyPem, action: approvalActionName("PUBLISH"), subject: actionSubject("PUBLISH", { page: "A" }), ttlMs: 60000, now: Date.now() - 180000 });
    assert.match(ev("PUBLISH", { page: "A" }, old).reason, /EXPIRED/);
    assert.equal(ev("PUBLISH", { page: "A" }, true).verdict, "BLOCK");                     // bare boolean
    assert.equal(ev("PUBLISH", { page: "A" }, null).verdict, "REQUIRE_APPROVAL");
    assert.equal(ev("PUBLISH", { page: "A" }, ok).verdict, "ALLOW");                        // exact match works once
    assert.match(ev("PUBLISH", { page: "A" }, ok).reason, /REPLAY_DETECTED/);               // non-transferable / single use
    // a blocked evaluation must not burn the nonce of an unrelated valid approval
    const ok2 = r.opApproval("PUBLISH", { page: "C" }); ev("PUBLISH", { page: "D" }, ok2); assert.equal(ev("PUBLISH", { page: "C" }, ok2).verdict, "ALLOW");
  } finally { rm(r.dir); }
});

test("kill switch path coverage: with EMERGENCY STOP every registered path is BLOCKED at the kill switch and its action never runs", () => {
  const r = rig(); try {
    assert.ok(r.sys.chain.paths().length >= CONTROLLED_PATHS.length && CONTROLLED_PATHS.length >= 27);
    for (const id of ["agents.runtime.30", "brain.orchestrator", "brain.planning", "brain.capability_graph", "brain.knowledge", "brain.simulation", "brain.verification", "brain.security", "brain.opportunity", "brain.business_factory", "brain.observability", "brain.owner_command", "brain.model_router", "brain.health", "computer_use", "connectors.mutating", "outbound.communications", "money_engine.external", "business_factory.external", "workflow.automated", "scheduler.action", "tool.external_execution"])
      assert.ok(r.sys.chain.paths().some(p => p.id === id), "path registered: " + id);
    r.stop("PAUSE_ALL");
    let ran = 0;
    for (const p of r.sys.chain.paths()) {
      const out = r.sys.chain.run(p.id, { ownerApproval: p.external ? r.opApproval(p.operation, {}) : null }, () => ++ran);
      assert.equal(out.executed, false, p.id); assert.equal(out.decision.verdict, "BLOCK", p.id); assert.equal(out.decision.layer, "KILL_SWITCH", p.id);
    }
    assert.equal(ran, 0);
    assert.equal(r.sys.status().killSwitch.banner, "EMERGENCY STOP ACTIVE");
    // read-only / recovery remain available while stopped
    assert.equal(r.sys.chain.evaluate({ actor: { type: "OWNER", id: "JOCI" }, operation: "RUN_SYSTEM_DOCTOR" }).verdict, "ALLOW");
    r.resume(); r.stop("STOP_EXTERNAL_ACTIONS");
    for (const p of r.sys.chain.paths()) {
      const out = r.sys.chain.run(p.id, { ownerApproval: p.external ? r.opApproval(p.operation, {}) : null }, () => ++ran);
      if (p.external) { assert.equal(out.executed, false, p.id); assert.equal(out.decision.layer, "KILL_SWITCH", p.id); } else assert.equal(out.executed, true, p.id);
    }
  } finally { rm(r.dir); }
});

test("normal operation: external paths need Joci's exact approval; internal ones run; every decision lands in the Black Box", () => {
  const r = rig(); try {
    let ran = 0;
    for (const p of r.sys.chain.paths()) {
      const o = r.sys.chain.run(p.id, {}, () => ++ran);
      if (p.external) { assert.equal(o.executed, false, p.id); assert.equal(o.decision.verdict, "REQUIRE_APPROVAL", p.id); assert.equal(o.decision.approvalRequired.approvalAction, approvalActionName(p.operation)); }
      else assert.equal(o.executed, true, p.id);
    }
    const p = r.sys.chain.paths().find(x => x.id === "outbound.communications");
    assert.equal(r.sys.chain.run(p.id, { ownerApproval: r.opApproval("SEND_EXTERNAL", {}) }, () => "sent").executed, true);
    const bb = r.blackBox.all().filter(e => e.kind === "CONTROL_DECISION");
    assert.ok(bb.length >= r.sys.chain.paths().length); assert.equal(r.blackBox.verify().ok, true);
    assert.equal(r.sys.chain.run("not.registered", {}, () => 1).executed, false);          // unregistered route fails closed
  } finally { rm(r.dir); }
});

test("approval gateway: complete requests only; outcomes are exactly APPROVED/REJECTED/EXPIRED/CANCELLED/BLOCKED", () => {
  let t = 1000; const r = rig(); const dir = path.join(r.dir, "gw");
  const gw = createApprovalGateway({ dir, ownerAuth, ttlMs: 10000, now: () => t });
  try {
    for (const f of ["what", "why", "target", "expectedResult", "requiredCredential"]) assert.throws(() => gw.request(REQ({ [f]: "" })), /INCOMPLETE/);
    for (const f of ["financialRisk", "securityRisk", "dataRisk"]) assert.throws(() => gw.request(REQ({ [f]: "MAYBE" })), /INCOMPLETE/);
    assert.throws(() => gw.request(REQ({ reversibility: "SORT_OF" })), /INCOMPLETE/); assert.throws(() => gw.request(REQ({ rollbackPossible: "yes" })), /INCOMPLETE/);
    const a = gw.request(REQ()), rej = gw.request(REQ({ params: { page: "x2" } })), can = gw.request(REQ({ params: { page: "x3" } })), exp = gw.request(REQ({ params: { page: "x4" } })), bad = gw.request(REQ({ params: { page: "x5" } }));
    assert.equal(gw.pending().length, 5);
    const good = sign(approvalActionName("PUBLISH"), actionSubject("PUBLISH", { page: "offer-1" }));
    assert.equal(gw.decide({ id: a.id, decision: "APPROVED", approval: good }).decision, "APPROVED");
    assert.equal(gw.outcome(a.id).approval.nonce, good.nonce);
    assert.equal(gw.decide({ id: rej.id, decision: "REJECTED", reason: "no" }).decision, "REJECTED");
    assert.equal(gw.decide({ id: can.id, decision: "CANCELLED" }).decision, "CANCELLED");
    // an approval for ANOTHER action is not accepted for this request -> BLOCKED
    assert.equal(gw.decide({ id: bad.id, decision: "APPROVED", approval: good }).decision, "BLOCKED");
    t += 20000; assert.equal(gw.list().find(x => x.id === exp.id).status, "EXPIRED");
    assert.throws(() => gw.decide({ id: a.id, decision: "REJECTED" }), /ALREADY_DECIDED/);
    // blocked up front: unknown operation, agent asking for owner-only operation, operation needing no approval
    assert.equal(gw.request(REQ({ operation: "TELEPORT" })).status, "BLOCKED");
    assert.equal(gw.request(REQ({ operation: "CHANGE_OWNER_PERMISSION", params: { x: 1 } })).status, "BLOCKED");
    assert.equal(gw.request(REQ({ operation: "RECOMMEND" })).status, "BLOCKED");
    assert.ok(gw.list().every(x => [...GATEWAY_OUTCOMES, "PENDING"].includes(x.status)));
    assert.equal(gw.outcome(rej.id).approval, null);
    // double request is not a second pending item
    assert.equal(gw.request(REQ({ params: { page: "z" } })).duplicate, false); assert.equal(gw.request(REQ({ params: { page: "z" } })).duplicate, true);
  } finally { rm(r.dir); }
});

test("gateway approval is consumed exactly once by the executing chain, and cannot be used for a different action", () => {
  const r = rig(); const gw = createApprovalGateway({ dir: path.join(r.dir, "gw"), ownerAuth });
  try {
    const q = gw.request(REQ({ params: { page: "p1" } }));
    gw.decide({ id: q.id, decision: "APPROVED", approval: sign(approvalActionName("PUBLISH"), actionSubject("PUBLISH", { page: "p1" })) });
    const ap = gw.outcome(q.id).approval, ev = params => r.sys.chain.evaluate({ actor: { type: "BRAIN", id: "BF" }, operation: "PUBLISH", params, ownerApproval: ap });
    assert.equal(ev({ page: "other" }).verdict, "BLOCK");
    assert.equal(ev({ page: "p1" }).verdict, "ALLOW");
    assert.equal(ev({ page: "p1" }).verdict, "BLOCK");
  } finally { rm(r.dir); }
});

test("financial firewall: NO-SPEND default, owner-set policy, per-action/total/reserve limits; estimated never shown as verified", () => {
  const r = rig(); const fw = r.sys.firewall; try {
    const spend = (n, ap) => r.sys.chain.evaluate({ actor: { type: "AGENT", id: "E1" }, operation: "SPEND", spendUsd: n, ownerApproval: ap });
    assert.equal(fw.summary().mode, "NO_SPEND");
    assert.equal(spend(5).verdict, "BLOCK"); assert.equal(spend(5).layer, "FINANCIAL_FIREWALL"); assert.match(spend(5).reason, /NO_SPEND_DEFAULT/);
    assert.equal(spend(5, r.opApproval("SPEND", {}, 5)).verdict, "BLOCK");                  // even a valid approval cannot beat NO_SPEND
    assert.throws(() => fw.setPolicy({ maxPerActionUsd: 10, maxTotalUsd: 50, ownerApproval: null }), /OWNER_APPROVAL_REQUIRED/);
    const pol = { maxPerActionUsd: 10, maxTotalUsd: 50, capitalReserveUsd: 20 };
    assert.throws(() => fw.setPolicy({ ...pol, ownerApproval: sign(approvalActionName("SET_SPEND_POLICY"), actionSubject("SET_SPEND_POLICY", { ...pol, maxTotalUsd: 5000 })) }), /OWNER_APPROVAL_REQUIRED/);
    fw.setPolicy({ ...pol, ownerApproval: sign(approvalActionName("SET_SPEND_POLICY"), actionSubject("SET_SPEND_POLICY", pol)) });
    assert.equal(spend(5).verdict, "REQUIRE_APPROVAL"); assert.equal(spend(11).verdict, "BLOCK"); assert.equal(spend(5, r.opApproval("SPEND", {}, 5)).verdict, "ALLOW");
    fw.recordCost({ kind: "ACTUAL", usd: 28, ref: "inv-1" }); assert.match(spend(5).reason, /CAPITAL_PROTECTION/);   // 28+5 > 50-20
    assert.throws(() => fw.recordCost({ kind: "ACTUAL", usd: 1 }), /EVIDENCE_REF/); fw.recordCost({ kind: "ESTIMATED", usd: 100 });
    fw.recordRevenue({ usd: 500, status: "CLAIMED", ref: "customer-says" });
    assert.throws(() => fw.recordRevenue({ usd: 500, status: "VERIFIED", ref: "x", verification: { verdict: "ESCALATE", independent: true } }), /INDEPENDENT_ACCEPT/);
    assert.throws(() => fw.recordRevenue({ usd: 500, status: "VERIFIED", ref: "x", verification: { verdict: "ACCEPT", independent: false } }), /INDEPENDENT_ACCEPT/);
    const s = fw.summary(); assert.equal(s.verifiedRevenueUsd, 0); assert.equal(s.claimedRevenueUsd, 500); assert.equal(s.estimatedCostUsd, 100); assert.equal(s.netProfitUsd, -28);
    fw.recordRevenue({ usd: 100, status: "VERIFIED", ref: "ledger-1", verification: { verdict: "ACCEPT", independent: true } });
    assert.equal(fw.summary().netProfitUsd, 72); assert.equal(fw.summary().profitBasis, "VERIFIED_REVENUE_MINUS_ACTUAL_COST_ONLY");
    assert.equal(spend(-1).verdict, "BLOCK"); assert.equal(spend(NaN).verdict, "BLOCK");
  } finally { rm(r.dir); }
});
