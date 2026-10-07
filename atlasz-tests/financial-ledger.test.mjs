import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFinancialLedger } from "../atlasz-addons/financial-ledger.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "atl-ledger-"));
const ev = (ref = "pi_1") => ({ source: "PAYMENT_PROVIDER", reference: ref, verifiedAt: new Date().toISOString() });

test("empty ledger reports zero revenue and says NOT_CONNECTED, not an invented number", () => {
  const s = createFinancialLedger({ dir: tmp() }).summary();
  assert.equal(s.revenue.verifiedReceivedUsd, 0); assert.match(s.revenue.source, /NOT_CONNECTED/); assert.equal(s.profit.verifiedNetUsd, 0);
});
test("invoice is not PAID; PAID needs confirmation AND external evidence; duplicates count once", () => {
  const l = createFinancialLedger({ dir: tmp() });
  l.recordRevenue({ jobId: "j1", amountUsd: 500, stage: "INVOICED" });
  assert.equal(l.summary().revenue.verifiedReceivedUsd, 0); assert.equal(l.summary().revenue.unconfirmedPipelineUsd, 500);
  assert.throws(() => l.recordRevenue({ jobId: "j1", amountUsd: 500, stage: "PAID", confirmedReceived: false, evidence: ev() }), /PAID_REQUIRES_CONFIRMED_RECEIPT/);
  assert.throws(() => l.recordRevenue({ jobId: "j1", amountUsd: 500, stage: "PAID", confirmedReceived: true }), /PAID_REQUIRES_EXTERNAL_EVIDENCE/);
  assert.throws(() => l.recordRevenue({ jobId: "j1", amountUsd: 500, stage: "PAID", confirmedReceived: true, evidence: { source: "customer email", reference: "x" } }), /PAID_REQUIRES_EXTERNAL_EVIDENCE/);
  l.recordRevenue({ jobId: "j1", amountUsd: 500, stage: "PAID", confirmedReceived: true, evidence: ev("pi_9") });
  assert.throws(() => l.recordRevenue({ jobId: "j1", amountUsd: 500, stage: "PAID", confirmedReceived: true, evidence: ev("pi_9") }), /DUPLICATE_PAYMENT_REFERENCE/);
  const s = l.summary(); assert.equal(s.revenue.verifiedReceivedUsd, 500); assert.equal(s.revenue.unconfirmedPipelineUsd, 0);
});
test("costs need evidence when > 0; verified net profit = verified receipts - documented costs, per job and provider", () => {
  const l = createFinancialLedger({ dir: tmp() });
  assert.throws(() => l.recordCost({ amountUsd: 3, provider: "p" }), /COST_REQUIRES_EVIDENCE/);
  assert.throws(() => l.recordCost({ amountUsd: -1 }), /INVALID_COST_AMOUNT/);
  l.recordCost({ jobId: "j1", provider: "modelA", category: "API", amountUsd: 12.5, evidence: ev("inv_1"), tokensIn: 1000, tokensOut: 200 });
  l.recordCost({ jobId: "j1", provider: "modelA", amountUsd: 0 });                          // zero-cost event is fine (no-spend)
  l.recordRevenue({ jobId: "j1", amountUsd: 100, stage: "PAID", confirmedReceived: true, evidence: ev("pi_2") });
  const s = l.summary();
  assert.equal(s.costs.totalUsd, 12.5); assert.equal(s.costs.byProvider.modelA, 12.5); assert.equal(s.costs.tokensIn, 1000);
  assert.equal(s.profit.verifiedNetUsd, 87.5); assert.equal(s.profit.byJob.j1.verifiedNetProfitUsd, 87.5);
  l.recordRevenue({ jobId: "j1", amountUsd: 100, stage: "REVERSED", evidence: ev("cb_1") });
  assert.equal(l.summary().revenue.verifiedReceivedUsd, 0);
});
test("entities never commingle: GMP/VIRENA/personal records are excluded from ATLASZ_EXTERNAL profit", () => {
  const l = createFinancialLedger({ dir: tmp() });
  l.recordRevenue({ entity: "GREEN_MOUNTAIN_PAINTERS", jobId: "g1", amountUsd: 900, stage: "PAID", confirmedReceived: true, evidence: ev("g_1") });
  assert.equal(l.summary().revenue.verifiedReceivedUsd, 0); assert.equal(l.summary({ entity: "GREEN_MOUNTAIN_PAINTERS" }).revenue.verifiedReceivedUsd, 900);
  assert.throws(() => l.recordCost({ entity: "SOMEONE_ELSE", amountUsd: 0 }), /UNKNOWN_ENTITY/);
});
test("durable and tamper-evident: reload sees entries; editing the file is detected", () => {
  const d = tmp(); let l = createFinancialLedger({ dir: d });
  l.recordRevenue({ jobId: "j", amountUsd: 10, stage: "PAID", confirmedReceived: true, evidence: ev("r1") });
  l = createFinancialLedger({ dir: d }); assert.equal(l.summary().revenue.verifiedReceivedUsd, 10);
  const f = path.join(d, "ledger.jsonl"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"amountUsd":10', '"amountUsd":9999'));
  assert.throws(() => createFinancialLedger({ dir: d }), /AUDIT_CHAIN_TAMPERED/);
});
