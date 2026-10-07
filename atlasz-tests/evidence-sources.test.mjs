// V7.3 §8: internal evidence sources feeding Independent Verification. Every source is tested for VERIFIED / NOT_VERIFIED / FAILED_VERIFICATION /
// UNKNOWN / EXTERNAL_VERIFICATION_REQUIRED, with negative cases. External truth is never "verified" from internal records.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createEvidenceSources } from "../atlasz-addons/brain/evidence-sources.mjs";
import { createVerifier } from "../atlasz-addons/brain/verifier.mjs";
import { createFinancialLedger } from "../atlasz-addons/financial-ledger.mjs";
import { tmp, rm } from "./helpers.mjs";
const { createRuntime } = await import("../atlasz-runtime/supervisor-safe.mjs");

const NOFETCH = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" });
const S = (readers, external) => createEvidenceSources({ readers, external });

test("unconnected sources are UNKNOWN (never VERIFIED); unsupported sources too; connected() is honest", () => {
  const es = S({});
  for (const src of ["JOB", "COST_LEDGER", "REVENUE_LEDGER", "PROFIT_LEDGER", "QUEUE", "ARTIFACT", "BACKUP", "RESTORE", "UPDATE", "HEALTH", "BLACK_BOX", "APPROVAL"]) {
    const r = es.verify({ source: src }); assert.equal(r.status, "UNKNOWN", src); assert.match(r.reason, /SOURCE_NOT_CONNECTED/);
  }
  assert.equal(es.verify({ source: "WEATHER" }).status, "UNKNOWN");
  assert.equal(es.connected().JOB, "NOT_CONNECTED"); assert.equal(es.connected().EXTERNAL, "NOT_CONNECTED");
  assert.equal(S({ JOB: { get: () => null } }).connected().JOB, "CONNECTED");
});

test("JOB: DONE needs independent ACCEPT verification; in-progress is NOT_VERIFIED; missing/failed is FAILED_VERIFICATION", () => {
  const jobs = { a: { state: "DONE", verification: { verdict: "ACCEPT", independent: true } }, b: { state: "DONE", verification: { verdict: "ACCEPT", independent: false } }, c: { state: "EXECUTING" }, d: { state: "ESCALATED" } };
  const es = S({ JOB: { get: id => jobs[id] ?? null } });
  assert.equal(es.verify({ source: "JOB", jobId: "a" }).status, "VERIFIED");
  assert.equal(es.verify({ source: "JOB", jobId: "b" }).status, "NOT_VERIFIED");
  assert.equal(es.verify({ source: "JOB", jobId: "c" }).status, "NOT_VERIFIED");
  assert.equal(es.verify({ source: "JOB", jobId: "d" }).status, "FAILED_VERIFICATION");
  assert.equal(es.verify({ source: "JOB", jobId: "zzz" }).status, "FAILED_VERIFICATION");
});

test("LEDGERS: cost needs evidence + matching amount; pipeline stages are not revenue; PAID needs confirmed receipt; tampered chain fails; profit is recomputed", () => {
  const d = tmp("evl-"); const L = createFinancialLedger({ dir: d });
  L.recordCost({ jobId: "J1", amountUsd: 4, evidence: { source: "provider-invoice", reference: "inv-1", verifiedAt: new Date().toISOString() } });
  L.recordRevenue({ jobId: "J1", amountUsd: 100, stage: "INVOICED", evidence: { source: "x", reference: "y", verifiedAt: new Date().toISOString() } });
  const es = S({ COST_LEDGER: L, REVENUE_LEDGER: L, PROFIT_LEDGER: L });
  assert.equal(es.verify({ source: "COST_LEDGER", jobId: "J1", amountUsd: 4 }).status, "VERIFIED");
  assert.equal(es.verify({ source: "COST_LEDGER", jobId: "J1", amountUsd: 5 }).status, "FAILED_VERIFICATION");         // inflated claim
  const inv = es.verify({ source: "REVENUE_LEDGER", jobId: "J1", stage: "INVOICED" });
  assert.equal(inv.status, "VERIFIED"); assert.equal(inv.evidence.countsAsRevenue, false);                               // invoice != PAID
  assert.equal(es.verify({ source: "REVENUE_LEDGER", jobId: "J1", stage: "PAID" }).status, "NOT_VERIFIED");              // never recorded
  assert.equal(es.verify({ source: "PROFIT_LEDGER", jobId: "J1", verifiedNetProfitUsd: 96 }).status, "FAILED_VERIFICATION");   // claims profit; verified receipts = 0 => net -4
  assert.equal(es.verify({ source: "PROFIT_LEDGER", jobId: "J1", verifiedNetProfitUsd: -4 }).status, "VERIFIED");
  L.recordRevenue({ jobId: "J1", amountUsd: 100, stage: "PAID", confirmedReceived: true, evidence: { source: "processor", reference: "pay-1", verifiedAt: new Date().toISOString() } });
  assert.equal(es.verify({ source: "PROFIT_LEDGER", jobId: "J1", verifiedNetProfitUsd: 96 }).status, "VERIFIED");
  // tamper with the ledger file -> chain broken -> FAILED
  const f = path.join(d, "ledger.jsonl"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"amountUsd":4', '"amountUsd":1'));
  assert.equal(es.verify({ source: "COST_LEDGER", jobId: "J1", amountUsd: 1 }).status, "FAILED_VERIFICATION");
  rm(d);
});

test("QUEUE / ARTIFACT / APPROVAL / BLACK_BOX / HEALTH readers", () => {
  const q = { x: { state: "DONE" }, y: { state: "LEASED" }, z: { state: "DEAD" } };
  const arts = { a1: { id: "a1", content: "hello" } };
  const apr = { r1: { status: "APPROVED", approval: {} }, r2: { status: "PENDING" }, r3: { status: "DENIED" } };
  let bbOk = true;
  const es = S({ QUEUE: { get: i => q[i] ?? null }, ARTIFACT: { get: i => arts[i] ?? null }, APPROVAL: { outcome: i => apr[i] ?? { status: "UNKNOWN" } },
    BLACK_BOX: { verify: () => ({ ok: bbOk }), query: w => (w.kind === "X" ? [1, 2] : []) }, HEALTH: { probe: n => ({ ok: { state: "HEALTHY" }, bad: { state: "BLOCKED" }, odd: { state: "UNKNOWN" } })[n] ?? null } });
  assert.equal(es.verify({ source: "QUEUE", itemId: "x" }).status, "VERIFIED"); assert.equal(es.verify({ source: "QUEUE", itemId: "y" }).status, "NOT_VERIFIED"); assert.equal(es.verify({ source: "QUEUE", itemId: "z" }).status, "FAILED_VERIFICATION");
  const sha5 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
  const ok = es.verify({ source: "ARTIFACT", artifactId: "a1", hash: sha5 }); assert.equal(ok.status, "VERIFIED"); assert.equal(ok.evidence.delivered, false);   // CREATED != DELIVERED
  assert.equal(es.verify({ source: "ARTIFACT", artifactId: "a1", hash: "0".repeat(64) }).status, "FAILED_VERIFICATION");
  assert.equal(es.verify({ source: "ARTIFACT", artifactId: "nope" }).status, "FAILED_VERIFICATION");
  assert.equal(es.verify({ source: "APPROVAL", requestId: "r1" }).status, "VERIFIED"); assert.equal(es.verify({ source: "APPROVAL", requestId: "r2" }).status, "NOT_VERIFIED");
  assert.equal(es.verify({ source: "APPROVAL", requestId: "r3" }).status, "FAILED_VERIFICATION"); assert.equal(es.verify({ source: "APPROVAL", requestId: "none" }).status, "FAILED_VERIFICATION");
  assert.equal(es.verify({ source: "BLACK_BOX", where: { kind: "X" } }).status, "VERIFIED"); assert.equal(es.verify({ source: "BLACK_BOX", where: { kind: "Q" } }).status, "NOT_VERIFIED");
  bbOk = false; assert.equal(es.verify({ source: "BLACK_BOX", where: { kind: "X" } }).status, "FAILED_VERIFICATION");
  assert.equal(es.verify({ source: "HEALTH", component: "ok" }).status, "VERIFIED"); assert.equal(es.verify({ source: "HEALTH", component: "bad" }).status, "FAILED_VERIFICATION");
  assert.equal(es.verify({ source: "HEALTH", component: "odd" }).status, "UNKNOWN"); assert.equal(es.verify({ source: "HEALTH", component: "none" }).status, "UNKNOWN");
});

test("BACKUP / RESTORE / UPDATE readers: EXISTS != RESTORABLE; rollback must be verified", () => {
  const rdn = c => ({ restoreReadiness: "UNKNOWN", lkg: null, categories: [{ category: "A", backup: "VERIFIED", latestPoint: "p1" }, { category: "B", backup: "NOT_VERIFIED_YET", latestPoint: "p2" }, { category: "C", backup: "NOT_CONFIGURED", latestPoint: null }, { category: "D", backup: "UNRESTORABLE", latestPoint: "p4" }, { category: "E", backup: "NO_BACKUP", latestPoint: null }], ...c });
  const mk = c => S({ BACKUP: { readiness: () => rdn(c) }, RESTORE: { readiness: () => rdn(c) } });
  const es = mk({});
  assert.equal(es.verify({ source: "BACKUP", category: "A" }).status, "VERIFIED"); assert.equal(es.verify({ source: "BACKUP", category: "B" }).status, "NOT_VERIFIED");
  assert.equal(es.verify({ source: "BACKUP", category: "C" }).status, "UNKNOWN"); assert.equal(es.verify({ source: "BACKUP", category: "D" }).status, "FAILED_VERIFICATION");
  assert.equal(es.verify({ source: "BACKUP", category: "E" }).status, "NOT_VERIFIED"); assert.equal(es.verify({ source: "BACKUP", category: "Z" }).status, "FAILED_VERIFICATION");
  assert.equal(es.verify({ source: "RESTORE" }).status, "NOT_VERIFIED"); assert.equal(mk({ restoreReadiness: "READY" }).verify({ source: "RESTORE" }).status, "VERIFIED");
  assert.equal(mk({ restoreReadiness: "NOT_READY" }).verify({ source: "RESTORE" }).status, "FAILED_VERIFICATION"); assert.equal(mk({ restoreReadiness: "NOT_CONFIGURED" }).verify({ source: "RESTORE" }).status, "UNKNOWN");
  assert.equal(es.verify({ source: "RESTORE", require: "LKG" }).status, "NOT_VERIFIED"); assert.equal(mk({ lkg: { backupId: "b" } }).verify({ source: "RESTORE", require: "LKG" }).status, "VERIFIED");
  const ups = { u1: { state: "INSTALLED", tests: { passed: true }, evidenceCount: 3 }, u2: { state: "INSTALLED", evidenceCount: 0 }, u3: { state: "FAILED" }, u4: { state: "ROLLED_BACK", rollback: { verified: true } }, u5: { state: "TESTING" } };
  const eu = S({ UPDATE: { get: i => ups[i] ?? null } });
  assert.equal(eu.verify({ source: "UPDATE", updateId: "u1" }).status, "VERIFIED"); assert.equal(eu.verify({ source: "UPDATE", updateId: "u2" }).status, "NOT_VERIFIED");
  assert.equal(eu.verify({ source: "UPDATE", updateId: "u3" }).status, "FAILED_VERIFICATION"); assert.equal(eu.verify({ source: "UPDATE", updateId: "u5" }).status, "NOT_VERIFIED");
  assert.equal(eu.verify({ source: "UPDATE", updateId: "u4", expectState: "ROLLED_BACK" }).status, "VERIFIED"); assert.equal(eu.verify({ source: "UPDATE", updateId: "nope" }).status, "FAILED_VERIFICATION");
});

test("EXTERNAL claims (payment received, message sent) are EXTERNAL_VERIFICATION_REQUIRED without an authoritative adapter, whatever internal records say", () => {
  const es = S({ REVENUE_LEDGER: { entries: () => [{ type: "REVENUE", jobId: "J", stage: "PAID", confirmedReceived: true, evidence: { source: "s" }, amountUsd: 5 }], verify: () => ({ ok: true }) } });
  for (const kind of ["PAYMENT_RECEIVED", "MESSAGE_SENT", "DELIVERY_RECEIVED", "CUSTOMER_ACCEPTED", "CONTRACT_SIGNED"]) {
    const r = es.verify({ source: "REVENUE_LEDGER", external: kind, jobId: "J" }); assert.equal(r.status, "EXTERNAL_VERIFICATION_REQUIRED", kind); assert.equal(r.scope, "EXTERNAL");
  }
  const withAdapter = S({}, { PAYMENT_RECEIVED: c => ({ status: "VERIFIED", reason: "PROCESSOR_SETTLED", evidence: { ref: c.ref } }), MESSAGE_SENT: () => ({ status: "bogus" }), CONTRACT_SIGNED: () => { throw new Error("boom"); } });
  assert.equal(withAdapter.verify({ external: "PAYMENT_RECEIVED", ref: "p1" }).status, "VERIFIED");
  assert.equal(withAdapter.verify({ external: "MESSAGE_SENT" }).status, "UNKNOWN");                                      // adapter returns garbage -> UNKNOWN
  assert.match(withAdapter.verify({ external: "CONTRACT_SIGNED" }).reason, /EVIDENCE_SOURCE_ERROR/);
  assert.equal(withAdapter.verify({ external: "CUSTOMER_ACCEPTED" }).status, "EXTERNAL_VERIFICATION_REQUIRED");
});

test("a throwing reader fails closed (UNKNOWN), never VERIFIED", () => {
  const es = S({ JOB: { get: () => { throw new Error("db down"); } } });
  const r = es.verify({ source: "JOB", jobId: "x" }); assert.equal(r.status, "UNKNOWN"); assert.match(r.reason, /EVIDENCE_SOURCE_ERROR/);
});

test("Independent Verifier maps evidence statuses to ACCEPT / RETRY / REJECT / ESCALATE and never accepts UNKNOWN or EXTERNAL_VERIFICATION_REQUIRED", () => {
  const es = S({ JOB: { get: id => ({ ok: { state: "DONE", verification: { verdict: "ACCEPT", independent: true } }, run: { state: "EXECUTING" }, bad: { state: "FAILED" } })[id] ?? null } });
  const v = createVerifier({ lookups: { internalRecord: c => es.verify(c) } });
  const run = claim => v.verify({ claimType: "INTERNAL_RECORD", claim, evidence: { ref: 1 }, executorId: "E1" });
  assert.equal(run({ source: "JOB", jobId: "ok" }).verdict, "ACCEPT"); assert.equal(run({ source: "JOB", jobId: "run" }).verdict, "RETRY");
  assert.equal(run({ source: "JOB", jobId: "bad" }).verdict, "REJECT"); assert.equal(run({ source: "BACKUP", category: "A" }).verdict, "ESCALATE");
  assert.equal(run({ external: "PAYMENT_RECEIVED" }).verdict, "ESCALATE");
  assert.equal(createVerifier({}).verify({ claimType: "INTERNAL_RECORD", claim: { source: "JOB" }, evidence: { a: 1 } }).verdict, "ESCALATE");   // no evidence source host => never ACCEPT
});

test("RUNTIME: all internal sources are connected to the real stores; revenue/profit claims come from the ledger; external payment stays EXTERNAL_VERIFICATION_REQUIRED", async () => {
  const d = tmp("evrt-"); const rt = createRuntime({ dataDir: d, retryBaseMs: 0, fetchImpl: NOFETCH });
  try {
    const es = rt.evidenceSources, c = es.connected();
    for (const s of ["JOB", "COST_LEDGER", "REVENUE_LEDGER", "PROFIT_LEDGER", "QUEUE", "ARTIFACT", "BACKUP", "RESTORE", "HEALTH", "BLACK_BOX", "APPROVAL"]) assert.equal(c[s], "CONNECTED", s);
    assert.equal(c.UPDATE, "NOT_CONNECTED");                                                       // no Update Center instance in the runtime: reported honestly
    rt.ledger.recordCost({ jobId: "J9", amountUsd: 2, evidence: { source: "provider", reference: "r1", verifiedAt: new Date().toISOString() } });
    assert.equal(es.verify({ source: "COST_LEDGER", jobId: "J9", amountUsd: 2 }).status, "VERIFIED");
    assert.equal(es.verify({ source: "PROFIT_LEDGER", jobId: "J9", verifiedNetProfitUsd: 50 }).status, "FAILED_VERIFICATION");
    assert.equal(es.verify({ source: "UPDATE", updateId: "u" }).status, "UNKNOWN");
    assert.equal(es.verify({ external: "PAYMENT_RECEIVED", jobId: "J9" }).status, "EXTERNAL_VERIFICATION_REQUIRED");
    assert.equal(es.verify({ source: "BLACK_BOX", minEvents: 1, where: { kind: "EV_PROBE" } }).status, "NOT_VERIFIED");
    rt.brain.blackBox.record({ kind: "EV_PROBE", decision: "x" });
    assert.equal(es.verify({ source: "BLACK_BOX", minEvents: 1, where: { kind: "EV_PROBE" } }).status, "VERIFIED");
    assert.equal(es.verify({ source: "HEALTH", component: "kill_switch" }).status, "VERIFIED");
    assert.equal(es.verify({ source: "HEALTH", component: "agent_topology_30" }).status, "VERIFIED");
    assert.equal(es.verify({ source: "BACKUP", category: "MODEL_ROUTING" }).status, "UNKNOWN");   // not configured
    rt.ownerControl.recovery.createRestorePoint({ appVersion: "t" });
    assert.equal(es.verify({ source: "BACKUP", category: "CRITICAL_SYSTEM_STATE" }).status, "NOT_VERIFIED");   // created, not yet drilled: EXISTS != RESTORABLE
    rt.ownerControl.recovery.verifyBackups();
    assert.equal(es.verify({ source: "BACKUP", category: "CRITICAL_SYSTEM_STATE" }).status, "VERIFIED");
    // routed through the real verifier host lookup
    assert.equal(rt.brain.verifier.verify({ claimType: "INTERNAL_RECORD", claim: { source: "COST_LEDGER", jobId: "J9", amountUsd: 2 }, evidence: { ledger: true }, executorId: "E1" }).verdict, "ACCEPT");
  } finally { rt.stop(); rm(d); }
});
