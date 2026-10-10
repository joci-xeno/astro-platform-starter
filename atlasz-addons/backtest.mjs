// Unified programme M6: reproducible backtesting and strategy validation for the ORB research engine.
//   * runBacktest: deterministic; the result carries a SHA-256 over (data hash, interval, config, trades), so a repeated run can be compared byte for byte.
//   * Metrics in money and in risk units (R): win rate, expectancy, profit factor, max drawdown, costs. Profit factor is null (not "infinite") when there is no losing trade.
//   * futurePerturbationTest: a look-ahead audit. Every sampled entry must be unchanged when ALL later candles are replaced by garbage.
//   * walkForward: parameters are chosen on a training window only and judged on the next, unseen window; the grid size is reported (multiple-testing warning).
//   * baselines: random-side null model (same range/stops/targets/costs, side = coin flip) and buy-and-hold.
//   * evaluateCandidate: predefined acceptance criteria. Simulated data can never produce an "eligible" verdict, and nothing here says a strategy is profitable: at best it is ELIGIBLE_FOR_PAPER_TRADING.
import crypto from "node:crypto";
import { createOrbEngine, normaliseConfig } from "./orb-strategy.mjs";
import { sessionFor, prng, INTERVALS } from "./market-data.mjs";

const sha = t => crypto.createHash("sha256").update(t).digest("hex");
const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
const r6 = x => (Number.isFinite(x) ? Number(x.toFixed(6)) : x);

export const ACCEPTANCE = Object.freeze({ minTrades: 30, minExpectancyR: 0.1, minProfitFactor: 1.2, maxDrawdownR: 15, minOosTrades: 20, minOosExpectancyR: 0.0, oosToInSampleRatio: 0.5, randomPercentile: 0.9 });

export function metrics(trades, startingEquity) {
  const n = trades.length, wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0), sum = a => a.reduce((x, y) => x + y, 0);
  let eq = startingEquity, peak = eq, ddMoney = 0, ddPct = 0, cum = 0, peakR = 0, ddR = 0;
  for (const t of trades) { eq += t.pnl; peak = Math.max(peak, eq); ddMoney = Math.max(ddMoney, peak - eq); ddPct = Math.max(ddPct, (peak - eq) / peak * 100); cum += t.r; peakR = Math.max(peakR, cum); ddR = Math.max(ddR, peakR - cum); }
  const gw = sum(wins.map(t => t.pnl)), gl = -sum(losses.map(t => t.pnl));
  return { trades: n, wins: wins.length, losses: losses.length, winRate: n ? wins.length / n : null, expectancyR: n ? sum(trades.map(t => t.r)) / n : null, avgWinR: wins.length ? sum(wins.map(t => t.r)) / wins.length : null, avgLossR: losses.length ? sum(losses.map(t => t.r)) / losses.length : null,
    profitFactor: gl > 0 ? gw / gl : null, profitFactorNote: gl > 0 ? "" : n ? "no losing trade" : "no trades", netPnl: sum(trades.map(t => t.pnl)), totalReturnPct: (eq - startingEquity) / startingEquity * 100, maxDrawdownPct: ddPct, maxDrawdownMoney: ddMoney, maxDrawdownR: ddR, totalR: cum,
    costsPaid: sum(trades.map(t => t.fees)), longs: trades.filter(t => t.side === "LONG").length, shorts: trades.filter(t => t.side === "SHORT").length, endingEquity: eq };
}

export function runBacktest({ dataset, config = {}, startingEquity = 100_000, rng = null } = {}) {
  if (!dataset?.candles?.length) return { ok: false, reason: "NO_DATASET" }; if (!Number.isFinite(startingEquity) || startingEquity <= 0) return { ok: false, reason: "EQUITY_INVALID" };
  const n = normaliseConfig(config); if (!n.ok) return n;
  let eng; try { eng = createOrbEngine({ config: n.config, interval: dataset.interval, rng }); } catch (e) { return { ok: false, reason: String(e.message) }; }
  let equity = startingEquity; const trades = [], signals = [], skipped = {}, entries = [];
  for (const c of dataset.candles) for (const ev of eng.push(c, { equity })) {
    if (ev.type === "EXIT") { trades.push({ instrument: dataset.instrument, ...ev.trade }); equity += ev.trade.pnl; }
    else if (ev.type === "SIGNAL") signals.push({ t: ev.t, side: ev.side, level: ev.level, close: ev.close, day: ev.day });
    else if (ev.type === "ENTRY") entries.push(ev);
    else if (ev.type === "NO_TRADE" || ev.type === "NO_ENTRY") skipped[ev.reason] = (skipped[ev.reason] ?? 0) + 1;
  }
  const m = metrics(trades, startingEquity), result = { ok: true, dataset: { instrument: dataset.instrument, interval: dataset.interval, kind: dataset.kind, source: dataset.source, sha256: dataset.sha256, from: dataset.from, to: dataset.to, candles: dataset.count }, config: n.config, startingEquity, metrics: m, trades, signals: signals.length, skippedDays: skipped,
    ambiguousStopTargetCandles: trades.filter(t => t.ambiguousCandle).length, assumptions: ["entry at the open after the breakout candle closes", "half the spread plus slippage against every market fill", "commission per side", "stop assumed first when stop and target are touched in one candle", "targets are limit fills at the target price", "no leverage", "session end closes the position at the last close"] };
  result.resultSha256 = sha(stable({ data: dataset.sha256, interval: dataset.interval, config: n.config, startingEquity, trades: trades.map(t => ({ ...t, gross: r6(t.gross), pnl: r6(t.pnl), fees: r6(t.fees), r: r6(t.r) })) }));
  return result;
}

/** Look-ahead audit: for sampled trades, replace every candle AFTER the entry candle with garbage and re-run; entry side, price, stop, target and size must not change. */
export function futurePerturbationTest({ dataset, config = {}, startingEquity = 100_000, sample = 25, runner = runBacktest } = {}) {
  const base = runBacktest({ dataset, config, startingEquity }); if (!base.ok) return base; const rnd = prng(12345), step = Math.max(1, Math.ceil(base.trades.length / sample)), picks = base.trades.map((t, i) => ({ t, i })).filter(x => x.i % step === 0).slice(0, sample); const bad = [];
  const before = i => { let e = startingEquity; for (let k = 0; k < i; k++) e += base.trades[k].pnl; return e; };      // position size depends on the equity at the time, which is past information
  for (const { t: tr, i: ti } of picks) {
    const idx = dataset.candles.findIndex(c => c.t === tr.entryT); if (idx < 0) { bad.push({ id: tr.id, reason: "ENTRY_CANDLE_NOT_FOUND" }); continue; }
    const day0 = dataset.candles.findIndex(c => { const s = sessionFor(c.t, base.config.anchor); return s && s.key === tr.day; });
    const cand = dataset.candles.slice(Math.max(0, day0 - 1), idx + 1).map(c => ({ ...c })); let p = cand[cand.length - 1].c;
    for (let i = 0; i < 400; i++) { const t = tr.entryT + (i + 1) * INTERVALS[dataset.interval], o = p, c = o * (0.7 + rnd() * 0.6); cand.push({ t, o, h: Math.max(o, c) * 1.2, l: Math.min(o, c) * 0.8, c, v: 1 }); p = c; }
    const alt = runner({ dataset: { ...dataset, candles: cand, count: cand.length, sha256: "perturbed" }, config, startingEquity: before(ti) }); const a = alt.trades.find(t => t.id === tr.id);
    if (!a || a.side !== tr.side || a.entry !== tr.entry || a.stop !== tr.stop || a.target !== tr.target || a.qty !== tr.qty) bad.push({ id: tr.id, reason: "ENTRY_DEPENDS_ON_FUTURE" });
  }
  return { ok: bad.length === 0, checked: picks.length, violations: bad };
}

function dayIndex(dataset, anchor) {
  const keys = [], from = new Map(); dataset.candles.forEach((c, i) => { const s = sessionFor(c.t, anchor); const k = s ? s.key : null; if (k && !from.has(k)) { from.set(k, { start: i, end: i }); keys.push(k); } if (k) from.get(k).end = i; }); return { keys, from };
}
const subset = (dataset, di, a, b) => { const first = di.from.get(di.keys[a]).start, last = di.from.get(di.keys[b]).end; const candles = dataset.candles.slice(Math.max(0, first - 1), last + 1); return { ...dataset, candles, count: candles.length, sha256: dataset.sha256 + `:${first}-${last}`, from: candles[0].t, to: candles[candles.length - 1].t }; };

/** Rolling walk-forward: choose the best grid point on the training days, trade it on the following unseen days. */
export function walkForward({ dataset, baseConfig = {}, grid = { rr: [1.5, 2, 3], rangeMinutes: [15, 30] }, trainDays = 20, testDays = 5, minTrainTrades = 8, startingEquity = 100_000 } = {}) {
  const n = normaliseConfig(baseConfig); if (!n.ok) return n; const di = dayIndex(dataset, n.config.anchor); if (di.keys.length < trainDays + testDays) return { ok: false, reason: "NOT_ENOUGH_SESSIONS", sessions: di.keys.length };
  const names = Object.keys(grid), combos = names.reduce((acc, k) => acc.flatMap(a => grid[k].map(v => ({ ...a, [k]: v }))), [{}]), windows = [], oos = []; let eq = startingEquity;
  for (let s = 0; s + trainDays + testDays <= di.keys.length; s += testDays) {
    const train = subset(dataset, di, s, s + trainDays - 1), test = subset(dataset, di, s + trainDays, s + trainDays + testDays - 1); let best = null;
    for (const combo of combos) { const cfg = { ...baseConfig, ...combo }; if (cfg.rangeMinutes && cfg.rangeMinutes * 60_000 % INTERVALS[dataset.interval]) continue; const r = runBacktest({ dataset: train, config: cfg, startingEquity }); if (!r.ok || r.metrics.trades < minTrainTrades) continue; if (!best || r.metrics.expectancyR > best.metrics.expectancyR) best = { combo, metrics: r.metrics }; }
    if (!best) { windows.push({ trainFrom: di.keys[s], testTo: di.keys[s + trainDays + testDays - 1], skipped: "NO_QUALIFYING_PARAMETERS" }); continue; }
    const t = runBacktest({ dataset: test, config: { ...baseConfig, ...best.combo }, startingEquity: eq }); if (!t.ok) continue; eq = t.metrics.endingEquity; oos.push(...t.trades.map(x => ({ ...x, window: windows.length })));
    windows.push({ trainFrom: di.keys[s], trainTo: di.keys[s + trainDays - 1], testFrom: di.keys[s + trainDays], testTo: di.keys[s + trainDays + testDays - 1], chosen: best.combo, inSampleExpectancyR: best.metrics.expectancyR, inSampleTrades: best.metrics.trades, outOfSampleTrades: t.metrics.trades, outOfSampleExpectancyR: t.metrics.expectancyR });
  }
  const used = windows.filter(w => w.chosen), isExp = used.length ? used.reduce((a, w) => a + w.inSampleExpectancyR, 0) / used.length : null, m = metrics(oos, startingEquity);
  return { ok: true, windows, gridSize: combos.length, multipleTestingNote: `${combos.length} parameter sets were compared in every training window; the best-in-sample choice is optimistic by construction`, inSampleExpectancyR: isExp, outOfSample: m, outOfSampleToInSample: isExp && isExp > 0 && m.expectancyR !== null ? m.expectancyR / isExp : null };
}

/** Null model: same range, stops, targets, costs and timing, coin-flip side. Returns the distribution of expectancy over n runs and the percentile of the strategy's own expectancy. */
export function randomBaseline({ dataset, config = {}, runs = 100, seed = 7, startingEquity = 100_000, strategyExpectancyR } = {}) {
  const exp = []; for (let i = 0; i < runs; i++) { const r = runBacktest({ dataset, config: { ...config, entryRule: "random" }, startingEquity, rng: prng(seed + i * 7919) }); if (!r.ok) return r; if (r.metrics.expectancyR !== null) exp.push(r.metrics.expectancyR); }
  exp.sort((a, b) => a - b); const q = p => exp[Math.min(exp.length - 1, Math.floor(p * exp.length))];
  return { ok: true, runs: exp.length, meanExpectancyR: exp.reduce((a, b) => a + b, 0) / (exp.length || 1), p05: q(0.05), p50: q(0.5), p95: q(0.95), strategyPercentile: Number.isFinite(strategyExpectancyR) ? exp.filter(x => x < strategyExpectancyR).length / (exp.length || 1) : null };
}
export function buyAndHold(dataset, startingEquity = 100_000) { const a = dataset.candles[0].o, b = dataset.candles[dataset.candles.length - 1].c; return { returnPct: (b / a - 1) * 100, endingEquity: startingEquity * b / a, note: "unlevered, no costs" }; }

/** Predefined acceptance criteria. SIMULATED data can only reach SIMULATED_ONLY_NO_EDGE_CLAIM; REJECTED lists every failed criterion. */
export function evaluateCandidate({ dataset, config = {}, grid, startingEquity = 100_000, trainDays = 20, testDays = 5, runs = 100, criteria = ACCEPTANCE, runner = runBacktest } = {}) {
  const bt = runBacktest({ dataset, config, startingEquity }); if (!bt.ok) return bt;
  const la = futurePerturbationTest({ dataset, config, startingEquity, runner }), wf = walkForward({ dataset, baseConfig: config, grid, trainDays, testDays, startingEquity }), rb = randomBaseline({ dataset, config, runs, startingEquity, strategyExpectancyR: bt.metrics.expectancyR });
  const m = bt.metrics, reasons = [];
  if (m.trades < criteria.minTrades) reasons.push(`trades ${m.trades} < ${criteria.minTrades}`);
  if (!(m.expectancyR >= criteria.minExpectancyR)) reasons.push(`expectancy ${m.expectancyR === null ? "n/a" : m.expectancyR.toFixed(3)}R < ${criteria.minExpectancyR}R`);
  if (!(m.profitFactor === null ? m.trades > 0 : m.profitFactor >= criteria.minProfitFactor)) reasons.push(`profit factor ${m.profitFactor === null ? "n/a" : m.profitFactor.toFixed(2)} < ${criteria.minProfitFactor}`);
  if (m.maxDrawdownR > criteria.maxDrawdownR) reasons.push(`max drawdown ${m.maxDrawdownR.toFixed(1)}R > ${criteria.maxDrawdownR}R`);
  if (!la.ok) reasons.push("look-ahead audit failed");
  if (!wf.ok) reasons.push("walk-forward not possible: " + wf.reason); else {
    if (wf.outOfSample.trades < criteria.minOosTrades) reasons.push(`out-of-sample trades ${wf.outOfSample.trades} < ${criteria.minOosTrades}`);
    if (!(wf.outOfSample.expectancyR > criteria.minOosExpectancyR)) reasons.push("out-of-sample expectancy not positive");
    if (!(wf.outOfSampleToInSample >= criteria.oosToInSampleRatio)) reasons.push("out-of-sample expectancy below " + criteria.oosToInSampleRatio + " x in-sample (overfitting)");
  }
  if (rb.ok && !(rb.strategyPercentile >= criteria.randomPercentile)) reasons.push(`does not beat the random-side baseline (percentile ${rb.strategyPercentile === null ? "n/a" : rb.strategyPercentile.toFixed(2)} < ${criteria.randomPercentile})`);
  let status = reasons.length ? "REJECTED" : "ELIGIBLE_FOR_PAPER_TRADING";
  if (dataset.kind === "SIMULATED") status = reasons.length ? "REJECTED" : "SIMULATED_ONLY_NO_EDGE_CLAIM";
  const evidence = sha(stable({ status, result: bt.resultSha256, config: bt.config, data: dataset.sha256, criteria }));
  return { ok: true, status, evidenceSha256: evidence, reasons, criteria, backtest: { resultSha256: bt.resultSha256, metrics: m, skippedDays: bt.skippedDays, ambiguousStopTargetCandles: bt.ambiguousStopTargetCandles }, lookAhead: la, walkForward: wf.ok ? { windows: wf.windows.length, gridSize: wf.gridSize, inSampleExpectancyR: wf.inSampleExpectancyR, outOfSample: wf.outOfSample, outOfSampleToInSample: wf.outOfSampleToInSample, multipleTestingNote: wf.multipleTestingNote } : wf, randomBaseline: rb, buyAndHold: buyAndHold(dataset, startingEquity),
    dataKind: dataset.kind, statement: dataset.kind === "SIMULATED" ? "Simulated data only: no statement about real markets." : "A backtest is not proof of future profit. ELIGIBLE_FOR_PAPER_TRADING only permits simulated trading." };
}
