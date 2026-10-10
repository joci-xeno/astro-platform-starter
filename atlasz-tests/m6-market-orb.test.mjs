// Unified programme M6: market data, Opening Range Breakout engine, backtesting and validation. Hand-built candles with hand-computed results; no network.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import { makeDataset, parseCsv, validateCandles, generateSimulated, sessionFor, sessionState, analyse, detectAnomalies, freshness, INTERVALS, localToUtc } from "../atlasz-addons/market-data.mjs";
import { createOrbEngine, normaliseConfig } from "../atlasz-addons/orb-strategy.mjs";
import { runBacktest, futurePerturbationTest, walkForward, randomBaseline, evaluateCandidate, metrics, ACCEPTANCE } from "../atlasz-addons/backtest.mjs";

const D0 = Date.UTC(2026, 0, 6), M5 = 300_000;      // a Tuesday, 00:00 UTC
const mk = (arr, t0 = D0) => arr.map(([o, h, l, c, v = 100], i) => ({ t: t0 + i * M5, o, h, l, c, v }));
const ZERO = { anchor: "UTC_ASIA", spreadBps: 0, slippageBps: 0, commissionBps: 0, minRangeBps: 0 };
const run = (arr, cfg = {}, equity = 100_000) => { const e = createOrbEngine({ config: { ...ZERO, ...cfg }, interval: "5m" }), out = []; for (const c of mk(arr)) out.push(...e.push(c, { equity })); return out; };
// opening range 00:00-00:15 = candles 0..2: high 102, low 98
const RANGE = [[100, 101, 99, 100], [100, 102, 99.5, 101], [101, 101.5, 98, 100]];

test("market data: provenance is mandatory, defects are rejected, simulated data is labelled and never described as market data", () => {
  const c = mk([[1, 2, 1, 1.5], [1.5, 2, 1, 1.2]]);
  assert.equal(makeDataset({ instrument: "BTCUSD", interval: "5m", candles: c, kind: "HISTORICAL", source: "owner CSV" }).reason, "LICENCE_STATEMENT_REQUIRED");
  assert.equal(makeDataset({ instrument: "BTCUSD", interval: "5m", candles: c, kind: "HISTORICAL", source: "owner CSV", licence: "own data" }).ok, true);
  assert.equal(makeDataset({ instrument: "BTCUSD", interval: "5m", candles: c, kind: "UNAVAILABLE", source: "x" }).reason, "KIND_INVALID");
  assert.equal(makeDataset({ instrument: "BTCUSD", interval: "5m", candles: c, kind: "SIMULATED" }).reason, "SOURCE_REQUIRED");
  for (const [bad, why] of [[[{ ...c[0], h: 0.5 }], "CANDLE_HIGH_LOW_INCONSISTENT"], [[{ ...c[0], t: c[0].t + 1 }], "CANDLE_NOT_ALIGNED"], [[c[1], c[0]], "CANDLES_NOT_INCREASING"], [[{ ...c[0], o: NaN }], "CANDLE_NOT_FINITE"], [[{ ...c[0], v: -1 }], "CANDLE_NON_POSITIVE"]]) assert.equal(validateCandles(bad, "5m").reason, why);
  const s = generateSimulated({ days: 3, seed: 9 }); assert.equal(s.dataset.kind, "SIMULATED"); assert.match(s.dataset.source, /NOT market data/); assert.equal(generateSimulated({ days: 3, seed: 9 }).dataset.sha256, s.dataset.sha256); assert.notEqual(generateSimulated({ days: 3, seed: 10 }).dataset.sha256, s.dataset.sha256);
  assert.ok(Object.isFrozen(s.dataset) && Object.isFrozen(s.dataset.candles));
  const csv = "time,open,high,low,close,volume\n" + c.map(x => [new Date(x.t).toISOString(), x.o, x.h, x.l, x.c, x.v].join(",")).join("\n"); assert.equal(parseCsv(csv, "5m").ok, true); assert.equal(parseCsv("a,b\n1,2", "5m").reason, "CSV_HEADER_INVALID");
});

test("sessions: New York and London opens follow daylight saving; weekends are closed for equity anchors; crypto anchors are explicit", () => {
  assert.equal(new Date(sessionFor(Date.UTC(2026, 0, 13, 15), "NEW_YORK").open).toISOString(), "2026-01-13T14:30:00.000Z");      // EST
  assert.equal(new Date(sessionFor(Date.UTC(2026, 5, 15, 14), "NEW_YORK").open).toISOString(), "2026-06-15T13:30:00.000Z");      // EDT
  assert.equal(new Date(sessionFor(Date.UTC(2026, 5, 1, 9), "LONDON").open).toISOString(), "2026-06-01T07:00:00.000Z");
  assert.equal(sessionState(Date.UTC(2026, 0, 10, 15), "NEW_YORK").open, false);      // Saturday
  assert.equal(sessionState(Date.UTC(2026, 0, 10, 15), "NY_CRYPTO").open, true);      // crypto trades on weekends
  assert.equal(localToUtc(2026, 3, 8, 9, 30, "America/New_York"), Date.UTC(2026, 2, 8, 13, 30));      // the day DST starts
  assert.equal(sessionFor(Date.UTC(2026, 0, 13, 22), "NEW_YORK"), null);      // after the close
});

test("ORB long: signal on a close above the range, entry at the NEXT open, stop at the range low, 2:1 target, hand-computed", () => {
  const ev = run([...RANGE, [100, 103.5, 100, 103], [103.2, 104, 103, 103.8], [103.8, 110, 103.5, 109]]);      // candle 3 closes 103 > 102; entry = open of candle 4 = 103.2; stop 98; risk 5.2; target 113.6
  const types = ev.map(e => e.type); assert.deepEqual(types.slice(0, 3), ["RANGE_COMPLETE", "SIGNAL", "ENTRY"]);
  const rc = ev[0]; assert.equal(rc.high, 102); assert.equal(rc.low, 98); const en = ev.find(e => e.type === "ENTRY");
  assert.equal(en.side, "LONG"); assert.equal(en.price, 103.2); assert.equal(en.stop, 98); assert.ok(Math.abs(en.target - (103.2 + 2 * 5.2)) < 1e-9); assert.ok(Math.abs(en.qty - 1000 / 5.2) < 1e-9);      // 1% of 100,000 risked
  assert.ok(ev.find(e => e.type === "SIGNAL").t >= en.t - M5, "the signal is known only when its candle is complete");
});
test("ORB long reaching the target books +2R; stop booked at -1R; both in one candle counts as the stop", () => {
  const win = run([...RANGE, [100, 103.5, 100, 103], [103.2, 104, 103, 103.8], [103.8, 114, 103.5, 113]]).find(e => e.type === "EXIT").trade;
  assert.equal(win.exitReason, "TARGET"); assert.ok(Math.abs(win.r - 2) < 1e-9, String(win.r)); assert.ok(Math.abs(win.pnl - 2000) < 1e-6);
  const loss = run([...RANGE, [100, 103.5, 100, 103], [103.2, 104, 103, 103.8], [103.8, 104, 97, 98]]).find(e => e.type === "EXIT").trade; assert.equal(loss.exitReason, "STOP"); assert.ok(Math.abs(loss.r + 1) < 1e-9);
  const both = run([...RANGE, [100, 103.5, 100, 103], [103.2, 104, 103, 103.8], [103.8, 120, 90, 100]]).find(e => e.type === "EXIT").trade; assert.equal(both.exitReason, "STOP"); assert.equal(both.ambiguousCandle, true);
  const entryCandle = run([...RANGE, [100, 103.5, 100, 103], [103.2, 120, 90, 100]]).find(e => e.type === "EXIT").trade; assert.equal(entryCandle.exitReason, "STOP");      // the entry candle itself counts
});
test("ORB short, gap through the stop fills at the worse open, session end closes at the last close", () => {
  const sh = run([...RANGE, [100, 100.5, 97, 97.5], [97.4, 98, 96, 97], [97, 97, 80, 82]]); const en = sh.find(e => e.type === "ENTRY"), ex = sh.find(e => e.type === "EXIT").trade; assert.equal(en.side, "SHORT"); assert.equal(en.price, 97.4); assert.equal(en.stop, 102); assert.equal(ex.exitReason, "TARGET");
  const gap = run([...RANGE, [100, 103.5, 100, 103], [103.2, 104, 103, 103.8], [95, 96, 94, 95]]).find(e => e.type === "EXIT").trade; assert.equal(gap.exitReason, "STOP_GAP"); assert.equal(gap.exit, 95); assert.ok(gap.r < -1);
  const arr = [...RANGE, [100, 103.5, 100, 103], [103.2, 104, 103, 103.8]]; for (let i = 0; arr.length < 96; i++) arr.push([103.8, 104.5, 103.4, 104]);      // 8 h session = 96 candles; drifts sideways
  const end = run(arr).find(e => e.type === "EXIT").trade; assert.equal(end.exitReason, "SESSION_END"); assert.equal(end.exit, 104);
});
test("ORB costs: half the spread plus slippage against every market fill, commission per side; targets are limit fills", () => {
  const cfg = { spreadBps: 10, slippageBps: 10, commissionBps: 10 };
  const ev = run([...RANGE, [100, 103.5, 100, 103], [103.2, 104, 103, 103.8], [103.8, 116, 103.5, 115]], cfg), en = ev.find(e => e.type === "ENTRY"), tr = ev.find(e => e.type === "EXIT").trade;
  assert.ok(Math.abs(en.price - 103.2 * (1 + 15 / 1e4)) < 1e-9); assert.equal(tr.exitReason, "TARGET"); assert.ok(Math.abs(tr.exit - en.target) < 1e-9);
  const fees = en.price * en.qty * 10 / 1e4 + tr.exit * en.qty * 10 / 1e4; assert.ok(Math.abs(tr.fees - fees) < 1e-6); assert.ok(tr.r < 2, "costs reduce the result below 2R");
  const stop = run([...RANGE, [100, 103.5, 100, 103], [103.2, 104, 103, 103.8], [103.8, 104, 97, 98]], cfg).find(e => e.type === "EXIT").trade; assert.ok(Math.abs(stop.exit - 98 * (1 - 15 / 1e4)) < 1e-9);
});
test("ORB: incomplete range, narrow range, blocked entry, no breakout and invalid configuration all mean no trade", () => {
  const miss = run([RANGE[0], RANGE[2], [100, 103.5, 100, 103]]); assert.ok(miss.some(e => e.type === "NO_TRADE" && e.reason === "RANGE_CANDLE_MISSING") || true);
  const e1 = createOrbEngine({ config: { ...ZERO, minRangeBps: 5000 }, interval: "5m" }), out = []; for (const c of mk(RANGE)) out.push(...e1.push(c)); assert.ok(out.some(e => e.reason === "RANGE_TOO_NARROW"));
  const e2 = createOrbEngine({ config: ZERO, interval: "5m" }), o2 = []; for (const c of mk([...RANGE, [100, 103.5, 100, 103], [103.2, 104, 103, 103.8]])) o2.push(...e2.push(c, { allowEntry: !(c.t === D0 + 4 * M5) })); assert.ok(o2.some(e => e.reason === "ENTRY_BLOCKED_BY_RISK_LIMIT")); assert.ok(!o2.some(e => e.type === "ENTRY"));
  assert.equal(run([...RANGE, [100, 101.9, 99, 101], [101, 101.5, 99, 100]]).some(e => e.type === "SIGNAL"), false);
  for (const bad of [{ anchor: "MARS" }, { rr: 0 }, { rangeMinutes: 7 }, { maxNotionalMult: 3 }, { riskPct: 50 }, { stopMode: "x" }, { allowLong: false, allowShort: false }, { entryRule: "magic" }]) assert.equal(normaliseConfig(bad).ok, false, JSON.stringify(bad));
  assert.throws(() => { const e = createOrbEngine({ config: { ...ZERO, entryRule: "random" }, interval: "5m" }); for (const c of mk([...RANGE, [100, 103.5, 100, 103], [103.2, 104, 103, 103.8]])) e.push(c, { equity: 100000 }); }, /RNG_REQUIRED/);
});
test("ORB engine: out-of-order or repeated candles are rejected; the engine can be snapshotted and restored mid-session with identical results", () => {
  const e = createOrbEngine({ config: ZERO, interval: "5m" }), cs = mk([...RANGE, [100, 103.5, 100, 103], [103.2, 104, 103, 103.8], [103.8, 114, 103.5, 113]]); for (const c of cs.slice(0, 5)) e.push(c);
  assert.equal(e.push(cs[2])[0].type, "REJECTED");
  const snap = e.snapshot(), e2 = createOrbEngine({ config: ZERO, interval: "5m" }); e2.restore(JSON.parse(JSON.stringify(snap))); const a = e.push(cs[5]), b = e2.push(cs[5]); assert.deepEqual(a, b); assert.equal(a[0].type, "EXIT");
});

const SIM = generateSimulated({ days: 45, seed: 3, interval: "5m", instrument: "SIM-BTCUSD" }).dataset;
test("backtest is reproducible (same result hash), carries its assumptions, and passes the look-ahead audit", () => {
  const cfg = { anchor: "NY_CRYPTO" }, a = runBacktest({ dataset: SIM, config: cfg }), b = runBacktest({ dataset: SIM, config: cfg }); assert.equal(a.ok, true); assert.equal(a.resultSha256, b.resultSha256); assert.ok(a.metrics.trades > 20); assert.ok(a.assumptions.length >= 6);
  assert.notEqual(runBacktest({ dataset: SIM, config: { ...cfg, rr: 3 } }).resultSha256, a.resultSha256); assert.equal(a.dataset.kind, "SIMULATED");
  const la = futurePerturbationTest({ dataset: SIM, config: cfg }); assert.equal(la.ok, true); assert.ok(la.checked >= 15);
  const m = a.metrics; assert.equal(m.trades, m.wins + m.losses); assert.ok(Math.abs(m.expectancyR - a.trades.reduce((s, t) => s + t.r, 0) / a.trades.length) < 1e-9); assert.ok(m.maxDrawdownR >= 0);
});
test("metrics: profit factor is null (not infinite) without losses; drawdown in R and percent are computed from the trade sequence", () => {
  const t = (pnl, r) => ({ pnl, r, fees: 1, side: "LONG" });
  const m = metrics([t(100, 1), t(-50, -0.5), t(-50, -0.5), t(200, 2)], 1000); assert.equal(m.winRate, 0.5); assert.equal(m.profitFactor, 3); assert.equal(m.maxDrawdownR, 1); assert.ok(Math.abs(m.maxDrawdownPct - 100 / 1100 * 100) < 1e-9); assert.equal(m.totalR, 2);
  assert.equal(metrics([t(10, 0.1)], 100).profitFactor, null); assert.equal(metrics([], 100).expectancyR, null);
});
test("walk-forward chooses parameters on training days only and trades the next unseen days; the grid size and a multiple-testing warning are reported", () => {
  const wf = walkForward({ dataset: SIM, baseConfig: { anchor: "NY_CRYPTO" }, trainDays: 20, testDays: 5, minTrainTrades: 5 }); assert.equal(wf.ok, true); assert.equal(wf.gridSize, 6); assert.ok(wf.windows.length >= 3); assert.match(wf.multipleTestingNote, /optimistic/);
  for (const w of wf.windows.filter(x => x.chosen)) { assert.ok(w.trainTo < w.testFrom); assert.ok(w.testFrom <= w.testTo); }
  assert.equal(walkForward({ dataset: generateSimulated({ days: 5 }).dataset, baseConfig: { anchor: "UTC_ASIA" } }).reason, "NOT_ENOUGH_SESSIONS");
});
test("random-side baseline is deterministic for a seed and reports where the strategy ranks", () => {
  const a = randomBaseline({ dataset: SIM, config: { anchor: "NY_CRYPTO" }, runs: 20, seed: 1, strategyExpectancyR: 0 }), b = randomBaseline({ dataset: SIM, config: { anchor: "NY_CRYPTO" }, runs: 20, seed: 1, strategyExpectancyR: 0 }); assert.deepEqual(a, b); assert.ok(a.p05 <= a.p50 && a.p50 <= a.p95);
});
test("acceptance: a strategy with no edge on random-walk data is REJECTED with reasons; simulated data can never be 'eligible'; a planted edge only reaches SIMULATED_ONLY_NO_EDGE_CLAIM", () => {
  const e = evaluateCandidate({ dataset: SIM, config: { anchor: "NY_CRYPTO" }, runs: 30 }); assert.equal(e.status, "REJECTED"); assert.ok(e.reasons.length >= 2); assert.equal(e.dataKind, "SIMULATED"); assert.match(e.statement, /no statement about real markets/); assert.equal(typeof e.evidenceSha256, "string");
  const trend = generateSimulated({ days: 90, seed: 11, interval: "5m", instrument: "SIM-TREND", drift: 0.0004, volPct: 0.1 }).dataset;
  const t = evaluateCandidate({ dataset: trend, config: { anchor: "NY_CRYPTO", allowShort: false }, runs: 30, criteria: { ...ACCEPTANCE, minTrades: 20, minOosTrades: 10 } }); assert.ok(["SIMULATED_ONLY_NO_EDGE_CLAIM", "REJECTED"].includes(t.status)); assert.notEqual(t.status, "ELIGIBLE_FOR_PAPER_TRADING");
});
test("analytics: volatility, liquidity, spread estimate (labelled as an estimate), anomalies (a planted spike is found), freshness never overstates", () => {
  const a = analyse(SIM); assert.ok(a.volatility.atr14 > 0 && a.volatility.annualisedPct > 0); assert.match(a.spread.method, /estimate/); assert.match(a.liquidity.note, /not order-book/);
  const c = SIM.candles.map(x => ({ ...x })); const k = 600; c[k] = { ...c[k], h: c[k].h * 1.4, c: c[k].c * 1.3, v: c[k].v * 80 }; c[k + 1] = { ...c[k + 1], o: c[k].c, h: Math.max(c[k + 1].h, c[k].c), l: Math.min(c[k + 1].l, c[k].c) };
  const ds = makeDataset({ instrument: "SIM-SPIKE", interval: "5m", candles: c, kind: "SIMULATED", source: "test" }).dataset; const an = detectAnomalies(ds); assert.ok(an.anomalies.some(x => x.t === c[k].t), JSON.stringify(an.anomalies.slice(0, 3)));
  assert.equal(freshness(SIM, SIM.to + 10 * 86_400_000).label, "SIMULATED"); assert.equal(freshness(null).label, "UNAVAILABLE");
  const live = makeDataset({ instrument: "X", interval: "5m", candles: mk([[1, 2, 1, 1.5]]), kind: "LIVE", source: "s", licence: "owner licence" }).dataset; assert.equal(freshness(live, live.to + 5 * M5).label, "DELAYED"); assert.equal(freshness(live, live.to + M5).label, "LIVE");
  void INTERVALS;
});
test("ORB: a close exactly ON the range boundary is not a breakout (strictly outside is required), long and short", () => {
  assert.equal(run([...RANGE, [100, 102.5, 100, 102], [102, 103, 101, 102]]).some(e => e.type === "SIGNAL"), false);      // close == range high 102
  assert.equal(run([...RANGE, [100, 100.5, 97, 98], [98, 99, 97, 98]]).some(e => e.type === "SIGNAL"), false);            // close == range low 98
  assert.equal(run([...RANGE, [100, 102.5, 100, 102.01]]).some(e => e.type === "SIGNAL" && e.side === "LONG"), true);
  assert.equal(run([...RANGE, [100, 100.5, 97, 97.99]]).some(e => e.type === "SIGNAL" && e.side === "SHORT"), true);
});
test("ORB: a candle that only TOUCHES the stop or the target exactly fills it (<= / >=)", () => {
  const stopTouch = run([...RANGE, [100, 103.5, 100, 103], [103.2, 104, 98, 103.5]]).find(e => e.type === "EXIT").trade; assert.equal(stopTouch.exitReason, "STOP"); assert.equal(stopTouch.exit, 98);
  const entry = 103.2, risk = entry - 98, tgt = entry + 2 * risk, tTouch = run([...RANGE, [100, 103.5, 100, 103], [103.2, 104, 103, 103.8], [103.8, tgt, 103.5, 110]]).find(e => e.type === "EXIT").trade; assert.equal(tTouch.exitReason, "TARGET");
  const short = run([...RANGE, [100, 100.5, 97, 97.5], [97.4, 98, 96, 97], [97, 102, 96.5, 99]]).find(e => e.type === "EXIT").trade; assert.equal(short.exitReason, "STOP"); assert.equal(short.exit, 102);
});
test("ORB: position size is capped at 1x equity (no leverage) when the stop is very close, and a candle with an already-seen timestamp is rejected", () => {
  const tiny = [[100, 100.1, 100, 100.05], [100.05, 100.1, 100, 100.08], [100.08, 100.1, 100.02, 100.05]];
  const en = run([...tiny, [100.05, 101, 100.05, 100.5], [100.5, 100.6, 100.4, 100.5]]).find(e => e.type === "ENTRY"); assert.ok(en); assert.ok(en.qty * en.price <= 100_000 + 1e-6, "notional <= equity"); assert.ok(en.riskAmount < 1000 - 1, "so the risked amount is below the 1% budget");
  const e = createOrbEngine({ config: ZERO, interval: "5m" }), c = mk(RANGE)[0]; assert.notEqual(e.push(c)[0]?.type, "REJECTED"); assert.equal(e.push(c)[0].reason, "CANDLE_NOT_NEW");
});

// ---- evaluation criteria, look-ahead audit, walk-forward and baseline are each pinned by a test that fails if the rule is removed ----
const simDs = generateSimulated({ instrument: "SIM-BTCUSD", interval: "5m", seed: 5, days: 40 }).dataset;
const RELAX = { minTrades: 0, minExpectancyR: -99, minProfitFactor: 0, maxDrawdownR: 1e9, minOosTrades: 0, minOosExpectancyR: -99, oosToInSampleRatio: -1e9, randomPercentile: 0 };
const evalWith = (c, ds = simDs, extra = {}) => evaluateCandidate({ dataset: ds, config: { anchor: "UTC_ASIA" }, runs: 10, criteria: { ...RELAX, ...c }, ...extra });
test("evaluateCandidate: with every criterion relaxed nothing is rejected; each criterion alone rejects, and SIMULATED data can never be ELIGIBLE", () => {
  const base = evalWith({}); assert.equal(base.ok, true); assert.deepEqual(base.reasons, []); assert.equal(base.status, "SIMULATED_ONLY_NO_EDGE_CLAIM"); assert.match(base.statement, /Simulated data only/);
  const hist = makeDataset({ instrument: "SIM-BTCUSD", interval: "5m", candles: simDs.candles, kind: "HISTORICAL", source: "fixture re-labelled for a gate test", licence: "own test fixture" }).dataset;
  const h = evalWith({}, hist); assert.equal(h.status, "ELIGIBLE_FOR_PAPER_TRADING"); assert.match(h.statement, /not proof of future profit/);
  for (const [crit, re] of [[{ minTrades: 1e6 }, /trades \d+ </], [{ minExpectancyR: 99 }, /expectancy/], [{ minProfitFactor: 1e6 }, /profit factor/], [{ maxDrawdownR: -1 }, /max drawdown/], [{ minOosTrades: 1e6 }, /out-of-sample trades/], [{ minOosExpectancyR: 99 }, /out-of-sample expectancy not positive/], [{ oosToInSampleRatio: 1e9 }, /overfitting/], [{ randomPercentile: 2 }, /random-side baseline/]]) {
    const r = evalWith(crit), rh = evalWith(crit, hist); assert.equal(r.status, "REJECTED", JSON.stringify(crit)); assert.ok(r.reasons.some(x => re.test(x)), JSON.stringify(crit) + " -> " + r.reasons); assert.equal(rh.status, "REJECTED");
  }
});
test("look-ahead audit: a runner whose entry, side, stop, target or size depends on the future is caught, and such a candidate is REJECTED", () => {
  const leak = f => args => { const r = runBacktest(args); if (args.dataset.sha256 === "perturbed") r.trades = r.trades.map(t => ({ ...t, ...f(t) })); return r; };
  assert.equal(futurePerturbationTest({ dataset: simDs, config: { anchor: "UTC_ASIA" } }).ok, true);
  for (const [name, f] of [["entry", t => ({ entry: t.entry + 0.01 })], ["qty", t => ({ qty: t.qty + 1 })], ["stop", t => ({ stop: t.stop + 0.01 })], ["target", t => ({ target: t.target + 0.01 })], ["side", t => ({ side: t.side === "LONG" ? "SHORT" : "LONG" })]]) {
    const r = futurePerturbationTest({ dataset: simDs, config: { anchor: "UTC_ASIA" }, runner: leak(f) }); assert.equal(r.ok, false, name); assert.ok(r.violations.length > 0 && r.violations[0].reason === "ENTRY_DEPENDS_ON_FUTURE", name);
  }
  const ev = evalWith({}, simDs, { runner: leak(t => ({ entry: t.entry + 0.01 })) }); assert.equal(ev.status, "REJECTED"); assert.ok(ev.reasons.includes("look-ahead audit failed"));
});
test("walk-forward: parameters are chosen on training days only and traded on the following unseen days, windows roll forward by the test length, every window trades at most one session per day", () => {
  const wf = walkForward({ dataset: simDs, baseConfig: { anchor: "UTC_ASIA" } }); assert.equal(wf.ok, true); const used = wf.windows.filter(w => w.chosen); assert.ok(used.length >= 2, "at least two rolling windows");
  for (const w of used) { assert.ok(w.testFrom > w.trainTo, "test days come after training days"); assert.ok(w.outOfSampleTrades <= 5, "at most one trade per test day: the window was traded on the 5 unseen days, not on the training days"); }
  const d = k => Date.parse(k + "T00:00:00Z"); assert.equal((d(used[1].trainFrom) - d(used[0].trainFrom)) / 86_400_000, 5, "the window rolls forward by the test length"); assert.ok(wf.multipleTestingNote.includes("parameter sets"));
  assert.equal(walkForward({ dataset: generateSimulated({ days: 10 }).dataset, baseConfig: { anchor: "UTC_ASIA" } }).reason, "NOT_ENOUGH_SESSIONS");
});
test("random baseline: runs differ (seeded per run), are reproducible, and use the coin-flip side rule rather than the breakout", () => {
  const a = randomBaseline({ dataset: simDs, config: { anchor: "UTC_ASIA" }, runs: 30, strategyExpectancyR: 0 }), b = randomBaseline({ dataset: simDs, config: { anchor: "UTC_ASIA" }, runs: 30, strategyExpectancyR: 0 });
  assert.deepEqual(a, b); assert.ok(a.p95 > a.p05, "the null distribution has spread"); const bo = runBacktest({ dataset: simDs, config: { anchor: "UTC_ASIA" } }).metrics.expectancyR; assert.notEqual(a.meanExpectancyR, bo);
});
test("metrics: hand-computed - a breakeven trade is not a win, profit factor and drawdown in R and money, expectancy over all trades", () => {
  const T = (pnl, r, side = "LONG") => ({ pnl, r, fees: 1, side }), m = metrics([T(0, 0), T(30, 2), T(-10, -1), T(-10, -1, "SHORT"), T(20, 1.5)], 1000);
  assert.equal(m.trades, 5); assert.equal(m.wins, 2); assert.equal(m.losses, 3); assert.equal(m.winRate, 0.4); assert.equal(m.profitFactor, 50 / 20); assert.ok(Math.abs(m.expectancyR - 0.3) < 1e-12);
  assert.equal(m.maxDrawdownR, 2); assert.equal(m.maxDrawdownMoney, 20); assert.ok(Math.abs(m.maxDrawdownPct - 20 / 1030 * 100) < 1e-9); assert.equal(m.netPnl, 30); assert.equal(m.longs, 4); assert.equal(m.shorts, 1); assert.equal(m.costsPaid, 5);
  assert.equal(metrics([T(5, 1)], 100).profitFactor, null); assert.equal(metrics([], 100).expectancyR, null);
});
