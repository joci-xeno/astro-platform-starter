// Owner directive: USD 500 daily MINIMUM verified net profit. Floor not ceiling; unknown never zero; forecasts never added; bounded persistent discovery.
import test from "node:test"; import assert from "node:assert/strict"; import path from "node:path";
import { createProfitObjective, createDiscoveryScheduler, DAILY_MINIMUM_NET_PROFIT_USD, OBJECTIVE, dayOf } from "../atlasz-addons/daily-profit-objective.mjs";
import { tmp, rm } from "./helpers.mjs";

const T = "2026-10-12T20:00:00.000Z", SEC = Date.parse(T) / 1000;
const pay = (o = {}) => ({ key: "pi_" + Math.random().toString(36).slice(2, 8), state: "PAYMENT_SUCCEEDED", at: SEC, amountMinor: 60000, currency: "usd", feeMinor: 1000, refundedMinor: 0, dispute: null, invoiceId: "inv-1", ...o });
const mk = (payments, costs = [], extra = {}) => createProfitObjective({ payments: () => payments, costs: () => costs, now: () => T, ...extra });

test("the objective is a minimum of USD 500 net, with no ceiling and no stop", () => {
  assert.equal(DAILY_MINIMUM_NET_PROFIT_USD, 500); assert.equal(OBJECTIVE.kind, "MINIMUM_NOT_CEILING"); assert.equal(OBJECTIVE.ceilingUsd, null); assert.equal(OBJECTIVE.stopsWorkWhenReached, false); assert.ok(Object.isFrozen(OBJECTIVE));
});
test("nothing recorded: net is 0 receipts but no claim of success; below minimum, work continues", () => {
  const d = mk([]).daily(); assert.equal(d.verifiedGrossReceiptsUsd, 0); assert.equal(d.verifiedNetProfitUsd, 0); assert.equal(d.status, "BELOW_MINIMUM"); assert.equal(d.remainingToMinimumUsd, 500); assert.equal(d.continueWork, true);
});
test("net = gross - refunds - lost chargebacks - fees - documented costs; reaching the minimum still says continue", () => {
  const d = mk([pay({ amountMinor: 90000, feeMinor: 2000, refundedMinor: 10000 }), pay({ amountMinor: 30000, feeMinor: 500, dispute: { status: "LOST" } })], [{ at: T, amountUsd: 20 }, { at: "2026-10-11T20:00:00Z", amountUsd: 999 }]).daily();
  assert.equal(d.verifiedGrossReceiptsUsd, 1200); assert.equal(d.refundsUsd, 100); assert.equal(d.chargebacksLostUsd, 300); assert.equal(d.processingFeesUsd, 25); assert.equal(d.operatingCostsUsd, 20, "only today's costs");
  assert.equal(d.verifiedNetProfitUsd, 755); assert.equal(d.status, "MINIMUM_MET"); assert.equal(d.excessOverMinimumUsd, 255); assert.equal(d.continueWork, true); assert.equal(d.continueReason, "MINIMUM_IS_A_FLOOR_NOT_A_STOPPING_POINT");
});
test("unknown fee, non-USD receipt or unreadable costs make the net UNKNOWN (null), never 0 and never MET", () => {
  assert.equal(mk([pay({ feeMinor: null, amountMinor: 999999 })]).daily().verifiedNetProfitUsd, null); assert.equal(mk([pay({ feeMinor: null, amountMinor: 999999 })]).daily().status, "NOT_VERIFIABLE");
  const e = mk([pay({ currency: "eur", amountMinor: 999999 })]).daily(); assert.equal(e.verifiedNetProfitUsd, null); assert.ok(e.unresolved.some(x => x.startsWith("NON_USD")));
  const c = createProfitObjective({ payments: () => [pay()], costs: () => { throw new Error("x"); }, now: () => T }).daily(); assert.equal(c.verifiedNetProfitUsd, null);
});
test("pending, initiated, failed payments and open disputes are never earned; invoices/forecast stay separate", () => {
  const d = mk([pay({ state: "PAYMENT_PENDING", amountMinor: 700000 }), pay({ state: "PAYMENT_FAILED", amountMinor: 700000 }), pay({ dispute: { status: "OPEN" }, amountMinor: 700000 })], [], { pipeline: () => ({ expectedUsd: 100000 }) }).daily();
  assert.equal(d.verifiedGrossReceiptsUsd, 0); assert.equal(d.pendingUncollected.usd, 7000); assert.equal(d.disputesHeldNotCounted, 1); assert.equal(d.status, "BELOW_MINIMUM");
  assert.equal(d.forecast.addedToResults, false); assert.equal(d.forecast.kind, "FORECAST_NOT_RESULT"); assert.notEqual(d.verifiedNetProfitUsd, 100000);
});
test("a non-LIVE environment is never revenue", () => { const d = mk([pay({ amountMinor: 999999 })], [], { environment: "SANDBOX" }).daily(); assert.equal(d.verifiedGrossReceiptsUsd, null); assert.equal(d.verifiedNetProfitUsd, null); assert.equal(d.status, "NOT_VERIFIABLE"); });
test("other days do not leak into today; cumulative covers all; time zone is explicit", () => {
  const old = pay({ at: SEC - 3 * 86400, amountMinor: 100000, feeMinor: 0 }), today = pay({ amountMinor: 20000, feeMinor: 0 }); const o = mk([old, today]);
  assert.equal(o.daily().verifiedGrossReceiptsUsd, 200); assert.equal(o.cumulative().verifiedGrossReceiptsUsd, 1200); assert.equal(o.daily().timeZone, "UTC");
  assert.equal(dayOf("2026-10-13T03:00:00Z", "America/Los_Angeles"), "2026-10-12");
});
test("scheduler: bounded, persistent, backoff, owner stop, no source = honest no-op, corrupt state kept", async () => {
  const d = tmp("sch-"); try {
    let t = Date.parse(T), calls = 0, fail = false, stopped = false; const now = () => new Date(t).toISOString();
    const mkS = () => createDiscoveryScheduler({ dir: d, now, isStopped: () => stopped, minIntervalMs: 60_000, maxPerDay: 3, backoffMs: 120_000, run: async () => { calls++; if (fail) throw Object.assign(new Error("boom"), { code: "SRC_DOWN" }); return { found: 2 }; } });
    let s = mkS(); assert.equal((await s.tick()).ran, true); assert.equal((await s.tick()).reason, "NOT_DUE");
    t += 61_000; fail = true; const f = await s.tick(); assert.equal(f.ok, false); assert.equal(f.code, "SRC_DOWN"); t += 61_000; assert.equal((await s.tick()).reason, "NOT_DUE", "backoff outlasts the plain interval");
    t += 121_000; fail = false; s = mkS(); assert.equal((await s.tick()).ok, true, "state survives restart"); assert.equal(calls, 3);
    t += 600_000; assert.equal((await s.tick()).reason, "DAILY_RUN_CAP_REACHED"); stopped = true; assert.equal((await s.tick()).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    t += 86_400_000; stopped = false; assert.equal((await s.tick()).ran, true, "new day resets the cap");
    assert.equal((await createDiscoveryScheduler({ dir: tmp("sch2-"), now }).tick()).reason, "NO_AUTHORISED_LIVE_SOURCE_CONNECTED");
    const bad = tmp("sch3-"); (await import("node:fs")).writeFileSync(path.join(bad, "discovery-scheduler.json"), "{x"); assert.throws(() => createDiscoveryScheduler({ dir: bad }), /CORRUPT_NOT_OVERWRITTEN/);
  } finally { rm(d); }
});
test("control center: dashboard from real (empty) ledgers claims nothing, scheduler honest", async () => {
  const { createControlCenterCore } = await import("../atlasz-control-center/core.mjs");
  const d = tmp("pdash-"); try {
    const core = createControlCenterCore({ stateDir: path.join(d, "s"), configDir: path.join(d, "c") }), x = core.profitDashboard();
    assert.equal(x.target.minimumUsd, 500); assert.equal(x.daily.status, "BELOW_MINIMUM"); assert.equal(x.daily.verifiedGrossReceiptsUsd, 0); assert.equal(x.cumulative.verifiedNetProfitUsd, 0);
    assert.equal(x.daily.continueWork, true); assert.equal(x.forecast.addedToResults, false); assert.match(x.note, /MINIMUM/);
    assert.equal((await core.discoveryScheduler().tick()).reason, "NO_AUTHORISED_LIVE_SOURCE_CONNECTED");
  } finally { rm(d); }
});
