// W6 Revenue Persistence Engine (integration report §5): targets are targets; only verified collected counts; proposals only; 30 agents fixed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRevenuePersistence, dailyTargetReport, TARGETS, validatePolicy, workflowSubject } from "../atlasz-addons/revenue-persistence.mjs";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { ROSTER } from "../atlasz-addons/agent-activity.mjs";
import { tmp, rm } from "./helpers.mjs";

const kp = generateOwnerKeyPair(), other = generateOwnerKeyPair();
const wfAuth = (id, k = kp, now = Date.parse("2026-10-10T08:00:00Z"), steps = ["a", "b"], agentId = "EXECUTION-2") => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action: "WORKFLOW_AUTHORIZE", subject: workflowSubject({ workflowId: id, opportunityId: null, agentId, steps }), now });
function mk(policy = {}) {
  const dir = tmp("revpers-"); let t = Date.parse("2026-10-10T08:00:00Z");
  const open = (o = {}) => createRevenuePersistence({ dir, ownerAuth: createOwnerAuth({ publicKeyB64: kp.publicKeyB64, nowFn: () => Date.parse("2026-10-10T08:00:30Z") }), policy, now: () => new Date(t).toISOString(), ...o });
  return { dir, rp: open(), open, tick: h => { t += h * 3600000; }, done: () => rm(dir) };
}
const DAY = "2026-10-10", AT = "2026-10-10T12:00:00Z";
const paid = (amt, o = {}) => ({ stage: "PAID", amountUsd: amt, costUsd: 0, confirmedReceived: true, externalEvidence: "stripe:ch_fixture_" + amt, currency: "USD", at: AT, ...o });

test("targets are fixed TARGETS ONLY (500 minimum, 1,000,000 aspirational) and verified collected counts only PAID+confirmed+evidence", () => {
  assert.equal(TARGETS.minimumDailyUsd, 500); assert.equal(TARGETS.aspirationalDailyUsd, 1000000); assert.match(TARGETS.kind, /NOT_A_FORECAST_NOT_INCOME/);
  const r = dailyTargetReport(DAY, [paid(300), paid(250), { stage: "INVOICED", amountUsd: 5000, costUsd: 0, at: AT }, { stage: "AGREED", amountUsd: 7000, costUsd: 0, at: AT }, { stage: "LEAD_VALUE", amountUsd: 90000, costUsd: 0, at: AT }]);
  assert.equal(r.verifiedCollectedUsd, 550); assert.equal(r.minimumMet, true); assert.equal(r.status, "MINIMUM_TARGET_MET_VERIFIED");
  assert.deepEqual(r.separate, { estimatedUsd: 90000, agreedUsd: 7000, invoicedUsd: 5000, notRevenue: true });
});

test("estimates presented as revenue are NOT counted: PAID without confirmation / evidence, 'confirmedReceived' strings, estimate flags", () => {
  const r = dailyTargetReport(DAY, [
    { stage: "PAID", amountUsd: 10000, costUsd: 0, at: AT },                                               // no confirmation
    { stage: "PAID", amountUsd: 10000, costUsd: 0, confirmedReceived: true, at: AT },                     // no evidence
    { stage: "PAID", amountUsd: 10000, costUsd: 0, confirmedReceived: "yes", externalEvidence: "x123", at: AT },   // truthy string is not confirmation
    { stage: "PAID", amountUsd: 10000, costUsd: 0, confirmedReceived: true, externalEvidence: " ", at: AT },        // blank evidence
    paid(10000, { isEstimate: true }), paid(10000, { source: "FORECAST" })
  ]);
  assert.equal(r.verifiedCollectedUsd, 0); assert.equal(r.minimumMet, null); assert.equal(r.status, "LOWER_BOUND_UNKNOWN_ENTRIES"); assert.equal(r.verifiedCollectedIsLowerBound, true); assert.equal(r.gapToMinimumUsd, 500);
  assert.equal(r.buckets.rejected.length, 4); assert.equal(r.buckets.excludedSimulated.length, 2);
});

test("simulated trading P&L is excluded and counted, never added to collected", () => {
  const r = dailyTargetReport(DAY, [paid(100), paid(1e6, { kind: "SIMULATED_TRADING_PNL" }), paid(5e5, { simulated: true }), paid(7e5, { source: "PAPER_TRADING" }), paid(1, { source: "backtest" })]);
  assert.equal(r.verifiedCollectedUsd, 100); assert.equal(r.buckets.excludedSimulated.length, 4); assert.equal(r.minimumMet, false);
});

test("no ledger data -> collected is UNKNOWN (null), not zero; an empty ledger or a day without entries is UNKNOWN too", () => {
  const n = dailyTargetReport(DAY, null); assert.equal(n.verifiedCollectedUsd, null); assert.equal(n.status, "NO_LEDGER_DATA"); assert.equal(n.minimumMet, null);
  const z = dailyTargetReport(DAY, []); assert.equal(z.verifiedCollectedUsd, null); assert.equal(z.status, "NO_LEDGER_DATA_FOR_DAY"); assert.equal(z.minimumMet, null);
  const o = dailyTargetReport(DAY, [{ stage: "PAID", amountUsd: 5, costUsd: 0, at: "2026-10-09T10:00:00Z", confirmedReceived: true, externalEvidence: "x:1" }]); assert.equal(o.status, "NO_LEDGER_DATA_FOR_DAY", "entries for other days do not make this day zero");
});

test("non-USD PAID is listed separately (no FX invented); other days, undated and garbage entries are not counted", () => {
  const r = dailyTargetReport(DAY, [paid(400, { currency: "CAD" }), paid(999, { at: "2026-10-09T23:59:59Z" }), { stage: "PAID", amountUsd: 5 }, null, { stage: "BOGUS", amountUsd: 1, costUsd: 0, at: AT }, paid(-5)]);
  assert.equal(r.verifiedCollectedUsd, 0); assert.equal(r.buckets.verifiedPaidOtherCurrency.length, 1); assert.equal(r.buckets.rejected.length, 4);
  assert.throws(() => dailyTargetReport("10/10/2026", []), /DAY_INVALID/); assert.throws(() => dailyTargetReport(DAY, "x"), /ENTRIES_INVALID/);
});

test("replenishment: each of the 5 SEARCH agents below the minimum gets a SEARCH_MORE proposal with its deficit", () => {
  const t = mk({ minOpenQualifiedPerSearchAgent: 2 }); try {
    t.rp.track({ id: "o1", searchAgent: "SEARCH-1" }); t.rp.track({ id: "o2", searchAgent: "SEARCH-1" }); t.rp.track({ id: "o3", searchAgent: "SEARCH-2" });
    const p = t.rp.replenishmentPlan().proposals; assert.equal(p.length, 4); assert.equal(p.find(x => x.agentId === "SEARCH-2").deficit, 1); assert.equal(p.find(x => x.agentId === "SEARCH-5").deficit, 2);
    assert.ok(p.every(x => x.externalEffect === false));
  } finally { t.done(); }
});

test("agents are exactly the 30 permanent ones: unknown/extra/wrong-role ids are refused; a 31-agent roster cannot be used", () => {
  const t = mk(); try {
    assert.equal(t.rp.track({ id: "o1", searchAgent: "SEARCH-6" }).reason, "SEARCH_AGENT_MUST_BE_ONE_OF_SEARCH_1_5");
    assert.equal(t.rp.track({ id: "o1", searchAgent: "EXECUTION-1" }).reason, "SEARCH_AGENT_MUST_BE_ONE_OF_SEARCH_1_5");
    assert.equal(t.rp.track({ id: "o1", searchAgent: "SEARCH-1", executionAgent: "EXECUTION-26" }).reason, "EXECUTION_AGENT_MUST_BE_ONE_OF_EXECUTION_1_25");
    assert.equal(t.rp.proposeOutreach({ agentId: "TEMP-1", opportunityId: "o1" }).reason, "NOT_ONE_OF_THE_30_PERMANENT_AGENTS");
    assert.throws(() => createRevenuePersistence({ dir: t.dir, roster: [...ROSTER, "SEARCH-6"] }), /ROSTER/);
    assert.equal(t.rp.status().agents, 30);
  } finally { t.done(); }
});

test("failover: a stalled IN_PROGRESS opportunity is marked STALLED and the next best OPEN_QUALIFIED is proposed (unknown economics rank last, not as zero)", () => {
  const t = mk({ stallHours: 24 }); try {
    t.rp.track({ id: "work", searchAgent: "SEARCH-1", executionAgent: "EXECUTION-3", status: "IN_PROGRESS" });
    t.rp.track({ id: "unknown-econ", searchAgent: "SEARCH-2" });
    t.rp.track({ id: "small", searchAgent: "SEARCH-2", expectedNetUsd: 100, paymentProbability: 0.9 });
    t.rp.track({ id: "big", searchAgent: "SEARCH-3", expectedNetUsd: 800, paymentProbability: 0.5 });
    assert.equal(t.rp.failover().stalled.length, 0);
    t.tick(25); const f = t.rp.failover(); assert.deepEqual(f.stalled, ["work"]);
    assert.deepEqual(f.proposals[0], { type: "REASSIGN", agentId: "EXECUTION-3", from: "work", to: "big", externalEffect: false });
    assert.deepEqual(t.rp.ranked().map(o => o.id), ["big", "small", "unknown-econ"]);
    assert.equal(t.rp.applyReassign(f.proposals[0]).ok, true); assert.equal(t.rp.applyReassign(f.proposals[0]).reason, "REASSIGN_NO_LONGER_VALID");
  } finally { t.done(); }
});

test("waiting on a customer is not a stall until the waiting timeout (other work continues in parallel)", () => {
  const t = mk({ stallHours: 24, waitingTimeoutHours: 72 }); try {
    t.rp.track({ id: "w", searchAgent: "SEARCH-1", executionAgent: "EXECUTION-1", status: "WAITING_ON_CUSTOMER" });
    t.tick(48); assert.equal(t.rp.failover().stalled.length, 0);
    t.tick(30); const f = t.rp.failover(); assert.deepEqual(f.stalled, ["w"]); assert.equal(f.proposals[0].type, "NO_NEXT_OPPORTUNITY"); assert.equal(f.proposals[0].followUp, "SEARCH_MORE");
  } finally { t.done(); }
});

test("only ELIGIBLE opportunities can be OPEN_QUALIFIED; invalid economics are refused", () => {
  const t = mk(); try {
    assert.equal(t.rp.track({ id: "x", searchAgent: "SEARCH-1", eligibility: "UNKNOWN_NEEDS_REVIEW" }).reason, "ONLY_ELIGIBLE_CAN_BE_OPEN_QUALIFIED");
    assert.equal(t.rp.track({ id: "x", searchAgent: "SEARCH-1", paymentProbability: 2 }).reason, "ECONOMICS_INVALID");
    assert.equal(t.rp.track({ id: "x", searchAgent: "SEARCH-1", expectedNetUsd: "lots" }).reason, "ECONOMICS_INVALID");
    assert.equal(t.rp.track({ id: "__proto__", searchAgent: "SEARCH-1" }).reason, "ID_INVALID");
    assert.equal(t.rp.track({ id: "x", searchAgent: "SEARCH-1", eligibility: "ELIGIBLE" }).ok, true);
  } finally { t.done(); }
});

test("multi-day carry-over: authorized unfinished workflows survive a restart and are proposed for RESUME the next day", () => {
  const t = mk(); try {
    assert.equal(t.rp.registerWorkflow({ workflowId: "wf-1", agentId: "EXECUTION-2", steps: ["draft", "qa", "package"], completedSteps: 1, authorization: wfAuth("wf-1", kp, Date.parse("2026-10-10T08:00:00Z"), ["draft", "qa", "package"]) }).ok, true);
    const next = t.open(); t.tick(24);
    const c = next.carryOver("2026-10-11"); assert.equal(c.proposals.length, 1); assert.equal(c.proposals[0].type, "RESUME"); assert.equal(c.proposals[0].nextStep, "qa");
    next.stepDone("wf-1"); next.stepDone("wf-1"); assert.equal(next.carryOver("2026-10-12").proposals.length, 0);
  } finally { t.done(); }
});

test("carry-over: unauthorized, forged, wrong-subject workflows are refused; stale authorizations need re-authorization", () => {
  const t = mk({ maxCarryOverDays: 2 }); try {
    const base = { agentId: "EXECUTION-2", steps: ["a", "b"] };
    assert.equal(t.rp.registerWorkflow({ ...base, workflowId: "wf-x" }).reason, "WORKFLOW_NOT_AUTHORIZED");
    assert.equal(t.rp.registerWorkflow({ ...base, workflowId: "wf-x", authorization: wfAuth("wf-x", other) }).reason, "WORKFLOW_NOT_AUTHORIZED");
    assert.equal(t.rp.registerWorkflow({ ...base, workflowId: "wf-x", authorization: wfAuth("wf-other") }).reason, "WORKFLOW_NOT_AUTHORIZED");
    assert.equal(t.rp.registerWorkflow({ ...base, workflowId: "wf-x", agentId: "SEARCH-1", authorization: wfAuth("wf-x") }).reason, "EXECUTION_AGENT_REQUIRED");
    assert.equal(t.rp.registerWorkflow({ ...base, workflowId: "wf-x", authorization: wfAuth("wf-x", kp, Date.parse("2026-10-10T08:00:00Z")) }).ok, true);
    assert.equal(t.rp.carryOver("2026-10-15").proposals[0].type, "NEEDS_REAUTHORIZATION");
    const d2 = tmp("revpers-na-"); try { const noAuth = createRevenuePersistence({ dir: d2 }); assert.equal(noAuth.registerWorkflow({ ...base, workflowId: "wf-y", authorization: wfAuth("wf-y") }).reason, "OWNER_AUTH_NOT_CONFIGURED"); } finally { rm(d2); }
  } finally { t.done(); }
});

test("a tampered workflow authorization on disk is detected at carry-over (signature re-verified)", () => {
  const t = mk(); try {
    t.rp.registerWorkflow({ workflowId: "wf-1", agentId: "EXECUTION-2", steps: ["a", "b"], authorization: wfAuth("wf-1") });
    const f = path.join(t.dir, "revenue-persistence.json"), s = JSON.parse(fs.readFileSync(f, "utf8")); s.workflows["wf-1"].authorization.subject = "workflow:wf-2"; fs.writeFileSync(f, JSON.stringify(s));
    assert.equal(t.open().carryOver("2026-10-11").proposals[0].type, "BLOCKED_AUTHORIZATION_INVALID");
  } finally { t.done(); }
});

test("outreach is proposal-only, approval-gated and capped per day and per agent; duplicates refused", () => {
  const t = mk({ outreachDailyCap: 3, outreachPerAgentDailyCap: 2 }); try {
    for (const id of ["a", "b", "c", "d"]) t.rp.track({ id, searchAgent: "SEARCH-1" });
    const p = t.rp.proposeOutreach({ agentId: "EXECUTION-1", opportunityId: "a", kind: "BID" });
    assert.equal(p.proposal.status, "PENDING_OWNER_APPROVAL"); assert.equal(p.proposal.sent, false); assert.equal(p.proposal.approvalAction, "BID_SUBMIT");
    assert.equal(t.rp.proposeOutreach({ agentId: "EXECUTION-1", opportunityId: "a", kind: "BID" }).reason, "DUPLICATE_OUTREACH_SAME_DAY");
    assert.equal(t.rp.proposeOutreach({ agentId: "EXECUTION-1", opportunityId: "b" }).ok, true);
    assert.equal(t.rp.proposeOutreach({ agentId: "EXECUTION-1", opportunityId: "c" }).reason, "OUTREACH_AGENT_DAILY_CAP_REACHED");
    assert.equal(t.rp.proposeOutreach({ agentId: "EXECUTION-2", opportunityId: "c", kind: "ACCEPT" }).proposal.approvalAction, "CONTRACT_ACCEPT");
    assert.equal(t.rp.proposeOutreach({ agentId: "EXECUTION-3", opportunityId: "d" }).reason, "OUTREACH_DAILY_CAP_REACHED");
    t.tick(24); assert.equal(t.rp.proposeOutreach({ agentId: "EXECUTION-3", opportunityId: "d" }).ok, true, "caps reset the next day");
    assert.equal(t.rp.proposeOutreach({ agentId: "EXECUTION-3", opportunityId: "zzz" }).reason, "UNKNOWN_OPPORTUNITY");
  } finally { t.done(); }
});

test("policy is bounded: unknown fields and out-of-range values are refused", () => {
  assert.match(validatePolicy({ outreachDailyCap: 1e6 }).error, /OUT_OF_BOUNDS/); assert.match(validatePolicy({ spendLimit: 5 }).error, /UNKNOWN/); assert.match(validatePolicy({ stallHours: 1.5 }).error, /OUT_OF_BOUNDS/);
  const d = tmp("rp-"); try { assert.throws(() => createRevenuePersistence({ dir: d, policy: { outreachDailyCap: -1 } }), /OUT_OF_BOUNDS/); } finally { rm(d); }
});

test("daily report is persisted with the verified figure only, and the module never exposes a send/spend function", () => {
  const t = mk(); try {
    const r = t.rp.dailyReport(DAY, [paid(200), { stage: "INVOICED", amountUsd: 900, costUsd: 0, at: AT }]);
    assert.equal(r.verifiedCollectedUsd, 200); const s = JSON.parse(fs.readFileSync(path.join(t.dir, "revenue-persistence.json"), "utf8")); assert.equal(s.reports[DAY].verifiedCollectedUsd, 200); assert.equal(s.reports[DAY].separate.invoicedUsd, 900);
    for (const k of Object.keys(t.rp)) assert.doesNotMatch(k, /^(send|pay|spend|submit|accept|bid)/i);
  } finally { t.done(); }
});

test("workflow approval is single-use and bound to the exact steps/agent; paidAt dates count; simulated variants are excluded", () => {
  const t = mk(); try {
    const a = wfAuth("wf-9"); const ok = t.rp.registerWorkflow({ workflowId: "wf-9", agentId: "EXECUTION-2", steps: ["a", "b"], authorization: a }); assert.equal(ok.ok, true);
    assert.equal(t.rp.registerWorkflow({ workflowId: "wf-9b", agentId: "EXECUTION-2", steps: ["a", "b"], authorization: a }).ok, false, "replay");
    assert.equal(t.rp.registerWorkflow({ workflowId: "wf-8", agentId: "EXECUTION-2", steps: ["a", "b", "send-money"], authorization: wfAuth("wf-8") }).reason, "WORKFLOW_NOT_AUTHORIZED", "steps changed after approval");
    const r = dailyTargetReport(DAY, [{ stage: "PAID", amountUsd: 600, costUsd: 0, confirmedReceived: true, externalEvidence: "stripe:ch_1", paidAt: AT }, paid(900, { source: "paper-trade" }), paid(900, { kind: "demo_payment" }), paid(900, { source: "SIM" })]);
    assert.equal(r.verifiedCollectedUsd, 600); assert.equal(r.buckets.excludedSimulated.length, 3);
  } finally { t.done(); }
});

test("hand-edited workflow steps/agent void the approval at carry-over; a day with only non-USD receipts is a lower bound, not zero", () => {
  const t = mk(); try {
    t.rp.registerWorkflow({ workflowId: "wf-e", agentId: "EXECUTION-2", steps: ["a", "b"], authorization: wfAuth("wf-e") });
    const f = path.join(t.dir, "revenue-persistence.json"), s = JSON.parse(fs.readFileSync(f, "utf8")); s.workflows["wf-e"].steps = ["a", "SEND contract to customer"]; s.workflows["wf-e"].agentId = "EXECUTION-9"; fs.writeFileSync(f, JSON.stringify(s));
    assert.equal(t.open().carryOver("2026-10-10").proposals[0].type, "BLOCKED_AUTHORIZATION_INVALID");
    const r = dailyTargetReport(DAY, [paid(900, { currency: "EUR" })]); assert.equal(r.status, "LOWER_BOUND_UNKNOWN_ENTRIES"); assert.equal(r.minimumMet, null); assert.equal(r.verifiedCollectedIsLowerBound, true);
  } finally { t.done(); }
});
