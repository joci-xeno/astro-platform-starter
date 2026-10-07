// Control Center finance/evidence views: real ledger state, honest zero, tamper shows FAIL, runtime wiring.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
import { createFinancialLedger } from "../atlasz-addons/financial-ledger.mjs";
process.env.ATLASZ_TEST_MODE = "1";
const { createRuntime } = await import("../atlasz-runtime/supervisor-safe.mjs");

const ev = r => ({ source: "PAYMENT_PROVIDER", reference: r, verifiedAt: new Date().toISOString() });
test("finance view: empty is honest zero/NOT_CONNECTED; ledger entries flow through status.money", async () => {
  const base = tmp("ccf-"); const core = createControlCenterCore({ stateDir: path.join(base, "s"), configDir: path.join(base, "c") });
  try {
    assert.equal(core.finance().revenue.verifiedReceivedUsd, 0); assert.match(core.finance().revenue.source, /NOT_CONNECTED/);
    const l = createFinancialLedger({ dir: path.join(base, "s", "ledger") });
    l.recordRevenue({ jobId: "j", amountUsd: 40, stage: "PAID", confirmedReceived: true, evidence: ev("p1") });
    l.recordCost({ jobId: "j", provider: "x", amountUsd: 15, evidence: ev("i1") });
    assert.equal(core.finance().profit.verifiedNetUsd, 25);
    assert.equal((await core.status()).money.confirmedPaidUsd, 40);
    const e = core.evidence(); assert.equal(e.logs.find(x => x.log.includes("ledger")).ok, true);
    // tampering shows as FAIL in evidence and the finance view refuses to present numbers as fine
    const f = path.join(base, "s", "ledger", "ledger.jsonl"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"amountUsd":40', '"amountUsd":4000'));
    assert.equal(core.evidence().logs.find(x => x.log.includes("ledger")).ok, false);
    const fin = core.finance(); assert.ok(fin.error); assert.equal(fin.revenue.verifiedReceivedUsd, 0);
  } finally { rm(base); }
});
test("runtime wiring: canonical runtime exposes its ledger summary and uptime on the dashboard", () => {
  const d = tmp("rtl-"); const rt = createRuntime({ dataDir: d });
  try {
    const dash = rt.dashboard();
    assert.equal(dash.ledger.revenue.verifiedReceivedUsd, 0); assert.ok(dash.uptime.startedAt);
    rt.ledger.recordCost({ jobId: "a", provider: "p", amountUsd: 0 });
    assert.equal(rt.dashboard().ledger.costs.records, 1);
  } finally { rt.stop(); rm(d); }
});
