// Unified programme M6: Opening Range Breakout (ORB) research engine - one state machine shared by the backtester and the paper trader.
//   Rules (standard 15-minute form, all configurable):
//     1. The session open is the anchor (New York, London, UTC, or a crypto anchor: markets that trade 24/7 get an explicit, configurable anchor).
//     2. The first `rangeMinutes` candles after the open give the opening range high/low. An incomplete range (missing candles) means NO TRADE that day.
//     3. The first later candle whose CLOSE is outside the range (by at least minBreakBps) is the signal. It is known only when that candle is complete.
//     4. Entry is at the OPEN of the next candle (never at the breakout close): spread (half each way) and slippage are applied against the trader, plus commission per side.
//     5. Stop = opposite side of the range (or the midpoint); target = rr x risk (default 2:1). If stop and target are both touched inside one candle the STOP is assumed first.
//     6. Stop fills include slippage and a gap through the stop fills at the open (worse price). Targets are limit fills at the target price. A position still open at the end of the session is closed at the last close (market, with costs).
//     7. Position size = riskPct of CURRENT equity / risk per unit, capped at maxNotionalMult x equity (no leverage by default). Results are also expressed in risk units (R).
//   The engine only ever sees candles that are complete and in order, so a decision can use no future information by construction.
//   Nothing here talks to a broker or an exchange. Whatever feeds it decides whether the result is SIMULATED, HISTORICAL or LIVE-data paper trading; real orders do not exist in this code base.
import { SESSIONS, INTERVALS, sessionFor, sessionState } from "./market-data.mjs";

export const DEFAULT_ORB = Object.freeze({
  anchor: "NEW_YORK", rangeMinutes: 15, rr: 2, stopMode: "range_opposite", minBreakBps: 0, minRangeBps: 5, maxRangeBps: 1500, maxRiskBps: 1500,
  entryRule: "breakout", riskPct: 1, maxNotionalMult: 1, commissionBps: 5, fixedFee: 0, spreadBps: 2, slippageBps: 2, allowLong: true, allowShort: true
});
const num = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
export function normaliseConfig(cfg = {}) {
  const c = { ...DEFAULT_ORB, ...cfg };
  if (!Object.hasOwn(SESSIONS, c.anchor)) return { ok: false, reason: "ANCHOR_UNKNOWN" };
  if (![5, 10, 15, 30, 60].includes(c.rangeMinutes)) return { ok: false, reason: "RANGE_MINUTES_INVALID" };
  if (!num(c.rr, 0.5, 10)) return { ok: false, reason: "RR_INVALID" };
  if (!["range_opposite", "range_mid"].includes(c.stopMode)) return { ok: false, reason: "STOP_MODE_INVALID" };
  for (const [k, lo, hi] of [["minBreakBps", 0, 500], ["minRangeBps", 0, 5000], ["maxRangeBps", 1, 20000], ["maxRiskBps", 1, 20000], ["riskPct", 0.01, 5], ["maxNotionalMult", 0.1, 5], ["commissionBps", 0, 200], ["fixedFee", 0, 1000], ["spreadBps", 0, 500], ["slippageBps", 0, 500]]) if (!num(c[k], lo, hi)) return { ok: false, reason: k.toUpperCase() + "_INVALID" };
  if (c.maxNotionalMult > 1) return { ok: false, reason: "LEVERAGE_NOT_ALLOWED" };      // research and paper trading run unlevered; leverage would need a separate owner decision
  if (!["breakout", "random"].includes(c.entryRule)) return { ok: false, reason: "ENTRY_RULE_INVALID" };
  if (typeof c.allowLong !== "boolean" || typeof c.allowShort !== "boolean" || (!c.allowLong && !c.allowShort)) return { ok: false, reason: "DIRECTION_INVALID" };
  return { ok: true, config: Object.freeze({ ...c }) };
}

export function createOrbEngine({ config, interval, rng = null }) {
  const n = normaliseConfig(config); if (!n.ok) throw new Error(n.reason); const cfg = n.config, step = INTERVALS[interval]; if (!step) throw new Error("INTERVAL_UNKNOWN");
  if (cfg.rangeMinutes * 60_000 % step !== 0 || cfg.rangeMinutes * 60_000 < step) throw new Error("RANGE_NOT_MULTIPLE_OF_INTERVAL");
  const rangeCandles = cfg.rangeMinutes * 60_000 / step, half = cfg.spreadBps / 2;
  let S = { day: null, phase: "IDLE", lastT: -Infinity, lastClose: null };

  const cost = (price, qty) => price * qty * cfg.commissionBps / 1e4 + cfg.fixedFee;
  function closePosition(ev, p, exit, reason, t, extra = {}) {
    const dir = p.side === "LONG" ? 1 : -1, fees = p.entryFee + cost(exit, p.qty), gross = dir * (exit - p.entry) * p.qty, pnl = gross - fees;
    const trade = { id: `${ev.instrument ?? ""}${S.day}${p.side}`.replace(/[^A-Za-z0-9]/g, ""), day: S.day, side: p.side, signalT: p.signalT, entryT: p.entryT, exitT: t, entry: p.entry, exit, stop: p.stop, target: p.target, qty: p.qty, riskAmount: p.riskAmount,
      gross, fees, pnl, r: pnl / p.riskAmount, exitReason: reason, rangeHigh: p.rangeHigh, rangeLow: p.rangeLow, ...extra };
    S.phase = "DONE"; S.position = null; return { type: "EXIT", t, trade };
  }
  function push(c, { equity = 100_000, allowEntry = true } = {}) {
    const ev = [];
    if (!c || !Number.isFinite(c.t) || c.t <= S.lastT) return [{ type: "REJECTED", reason: "CANDLE_NOT_NEW", t: c?.t }];
    const sess = sessionFor(c.t, cfg.anchor), state = sess ? sessionState(c.t, cfg.anchor) : { open: false };
    const key = state.open ? sess.key : null;
    if (S.day && key !== S.day) {      // the previous session is over
      if (S.phase === "OPEN") ev.push(closePosition({}, S.position, S.lastClose, "DATA_GAP_SESSION_CLOSED", S.lastT));
      else if (S.phase === "PENDING") ev.push({ type: "NO_ENTRY", t: c.t, reason: "SESSION_ENDED_BEFORE_ENTRY" });
      else if (S.phase === "WATCH") ev.push({ type: "NO_TRADE", t: c.t, day: S.day, reason: "NO_BREAKOUT" });
      S = { day: null, phase: "IDLE", lastT: S.lastT, lastClose: S.lastClose };
    }
    S.lastT = c.t; S.lastClose = c.c;
    if (!key) return ev;
    if (S.day !== key) S = { ...S, day: key, phase: "RANGE", open: sess.open, close: sess.close, rangeN: 0, hi: -Infinity, lo: Infinity, position: null, pending: null };
    const rangeEnd = S.open + cfg.rangeMinutes * 60_000;
    if (S.phase === "RANGE") {
      if (c.t < rangeEnd) {
        if (c.t !== S.open + S.rangeN * step) { S.phase = "SKIP"; ev.push({ type: "NO_TRADE", t: c.t, day: S.day, reason: "RANGE_CANDLE_MISSING" }); return ev; }
        S.hi = Math.max(S.hi, c.h); S.lo = Math.min(S.lo, c.l); S.rangeN++;
        if (S.rangeN === rangeCandles) {
          const mid = (S.hi + S.lo) / 2, width = (S.hi - S.lo) / mid * 1e4;
          if (width < cfg.minRangeBps || width > cfg.maxRangeBps) { S.phase = "SKIP"; ev.push({ type: "NO_TRADE", t: c.t, day: S.day, reason: width < cfg.minRangeBps ? "RANGE_TOO_NARROW" : "RANGE_TOO_WIDE", widthBps: width }); return ev; }
          S.phase = "WATCH"; ev.push({ type: "RANGE_COMPLETE", t: c.t + step, day: S.day, high: S.hi, low: S.lo, widthBps: width });
        }
        return ev;
      }
      S.phase = "SKIP"; ev.push({ type: "NO_TRADE", t: c.t, day: S.day, reason: "RANGE_INCOMPLETE" }); return ev;
    }
    if (S.phase === "WATCH") {
      if (cfg.entryRule === "random") {      // NULL MODEL for baselines: same range, stops, targets, costs and timing, but the side is a coin flip instead of the breakout
        if (typeof rng !== "function") throw new Error("RNG_REQUIRED_FOR_RANDOM_RULE");
        const long = (cfg.allowLong && !cfg.allowShort) || (cfg.allowLong && rng() < 0.5); S.pending = { side: long ? "LONG" : "SHORT", signalT: c.t, signalClose: c.c };
        ev.push({ type: "SIGNAL", t: c.t + step, day: S.day, side: S.pending.side, level: null, close: c.c, candleT: c.t });
        if (c.t + step >= S.close) { S.phase = "DONE"; ev.push({ type: "NO_ENTRY", t: c.t, reason: "SIGNAL_ON_LAST_CANDLE" }); } else S.phase = "PENDING"; return ev;
      }
      const up = cfg.allowLong && c.c > S.hi * (1 + cfg.minBreakBps / 1e4), dn = cfg.allowShort && c.c < S.lo * (1 - cfg.minBreakBps / 1e4);
      if (up || dn) {
        S.pending = { side: up ? "LONG" : "SHORT", signalT: c.t, signalClose: c.c };
        ev.push({ type: "SIGNAL", t: c.t + step, day: S.day, side: S.pending.side, level: up ? S.hi : S.lo, close: c.c, candleT: c.t });      // known when the candle is complete
        if (c.t + step >= S.close) { S.phase = "DONE"; ev.push({ type: "NO_ENTRY", t: c.t, reason: "SIGNAL_ON_LAST_CANDLE" }); } else S.phase = "PENDING";
      }
      return ev;
    }
    if (S.phase === "PENDING") {
      if (!allowEntry) { S.phase = "SKIP"; ev.push({ type: "NO_ENTRY", t: c.t, reason: "ENTRY_BLOCKED_BY_RISK_LIMIT" }); return ev; }
      const p = S.pending, long = p.side === "LONG", entry = c.o * (1 + (long ? 1 : -1) * (half + cfg.slippageBps) / 1e4);
      const stop = cfg.stopMode === "range_mid" ? (S.hi + S.lo) / 2 : long ? S.lo : S.hi, risk = long ? entry - stop : stop - entry, riskBps = risk / entry * 1e4;
      if (!(risk > 0)) { S.phase = "SKIP"; ev.push({ type: "NO_ENTRY", t: c.t, reason: "RISK_NOT_POSITIVE" }); return ev; }
      if (riskBps > cfg.maxRiskBps) { S.phase = "SKIP"; ev.push({ type: "NO_ENTRY", t: c.t, reason: "RISK_TOO_WIDE", riskBps }); return ev; }
      const riskBudget = equity * cfg.riskPct / 100; let qty = riskBudget / risk; qty = Math.min(qty, equity * cfg.maxNotionalMult / entry);
      if (!(qty > 0) || qty * entry < 1) { S.phase = "SKIP"; ev.push({ type: "NO_ENTRY", t: c.t, reason: "SIZE_TOO_SMALL" }); return ev; }
      const target = long ? entry + cfg.rr * risk : entry - cfg.rr * risk;
      S.position = { side: p.side, signalT: p.signalT, entryT: c.t, entry, stop, target, qty, riskAmount: qty * risk, entryFee: cost(entry, qty), rangeHigh: S.hi, rangeLow: S.lo };
      S.phase = "OPEN"; ev.push({ type: "ENTRY", t: c.t, day: S.day, side: p.side, price: entry, rawOpen: c.o, stop, target, qty, riskAmount: qty * risk, fees: S.position.entryFee });
    }
    if (S.phase === "OPEN") {
      const p = S.position, long = p.side === "LONG", dir = long ? 1 : -1, adverse = (half + cfg.slippageBps) / 1e4;
      const stopHit = long ? c.l <= p.stop : c.h >= p.stop, targetHit = long ? c.h >= p.target : c.l <= p.target, gapStop = c.t !== p.entryT && (long ? c.o <= p.stop : c.o >= p.stop);
      if (stopHit || gapStop) {
        const base = gapStop ? c.o : p.stop, exit = base * (1 - dir * adverse);
        ev.push(closePosition({}, p, exit, gapStop ? "STOP_GAP" : "STOP", c.t + step, { ambiguousCandle: Boolean(targetHit && !gapStop) }));
      } else if (targetHit) ev.push(closePosition({}, p, p.target, "TARGET", c.t + step));
      else if (c.t + step >= S.close) ev.push(closePosition({}, p, c.c * (1 - dir * adverse), "SESSION_END", c.t + step));
    }
    return ev;
  }
  /** Close an open position at `price` as a market order with costs (used when a strategy is suspended or stopped). */
  function flatten(price, t, reason) { if (S.phase !== "OPEN") return null; const p = S.position, dir = p.side === "LONG" ? 1 : -1, ev = closePosition({}, p, price * (1 - dir * (half + cfg.slippageBps) / 1e4), reason, t); S.phase = "SKIP"; return ev; }
  return { push, flatten, config: cfg, interval, snapshot: () => structuredClone(S), restore: snap => { S = structuredClone(snap); }, phase: () => S.phase, day: () => S.day, openPosition: () => (S.position ? { ...S.position } : null), range: () => (S.hi > -Infinity && S.phase !== "RANGE" ? { high: S.hi, low: S.lo, day: S.day } : null) };
}
