// Unified programme M6: autonomous PAPER trading. Everything here is simulated money (currency "SIM-USD"); there is no broker, exchange, wallet or network code, and no way to create one through this module.
//   * Strategies run on their own once added (the owner does not start every trade), fed candle by candle with the same ORB state machine the backtester uses.
//   * A strategy needs a research verdict (evaluateCandidate) of ELIGIBLE_FOR_PAPER_TRADING or SIMULATED_ONLY_NO_EDGE_CLAIM; anything else needs a signed owner override. The verdict is an input and is recorded with its evidence hash.
//   * Account-level risk limits (daily loss, max drawdown, consecutive losses, open positions) suspend strategies automatically; the open position is flattened at the last close. Resuming needs a signed, single-use owner approval.
//   * Every decision is appended to a hash-chained audit log; the state is written atomically after every candle and restored after a restart (already processed candles are ignored, so a replay cannot double-count).
//   * Real-money trading does not exist: requestLiveTrading() always refuses and logs the request.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";
import { createOrbEngine, normaliseConfig } from "./orb-strategy.mjs";
import { metrics } from "./backtest.mjs";
import { INTERVALS, KINDS } from "./market-data.mjs";

const sha = t => crypto.createHash("sha256").update(t).digest("hex");
export const CURRENCY = "SIM-USD";
export const DEFAULT_LIMITS = Object.freeze({ dailyLossPct: 3, maxDrawdownPct: 10, maxConsecutiveLosses: 5, maxOpenPositions: 3, maxStrategies: 20, maxStaleMs: 3 * 3600_000, maxTradesKept: 2000 });
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/, INSTR = /^[A-Z0-9][A-Z0-9._:-]{0,23}$/;
const ELIGIBLE = new Set(["ELIGIBLE_FOR_PAPER_TRADING", "SIMULATED_ONLY_NO_EDGE_CLAIM"]);
const dayOf = ms => new Date(ms).toISOString().slice(0, 10);

export function createPaperTrader({ dir, nowFn = () => Date.now(), ownerAuth = null, isStopped = () => false, limits = {}, startingBalance = 100_000 } = {}) {
  if (!dir) throw new Error("PAPER_DIR_REQUIRED"); if (!Number.isFinite(startingBalance) || startingBalance <= 0 || startingBalance > 1e9) throw new Error("STARTING_BALANCE_INVALID");
  const L = { ...DEFAULT_LIMITS, ...limits }; fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stateFile = path.join(dir, "paper-state.json"), audit = createAuditChain({ filePath: path.join(dir, "paper-audit.jsonl") });
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };
  const fresh = () => ({ v: 1, currency: CURRENCY, realMoney: false, createdAt: new Date(nowFn()).toISOString(), account: { starting: startingBalance, equity: startingBalance, peak: startingBalance }, daily: {}, strategies: {}, trades: [], events: [], suspendAll: null });
  let S = fresh(), loadedFrom = "FRESH";
  const wrap = body => JSON.stringify({ sha: sha(body), body });
  if (fs.existsSync(stateFile)) {
    try { const w = JSON.parse(fs.readFileSync(stateFile, "utf8")); if (!w || typeof w.body !== "string" || w.sha !== sha(w.body)) throw new Error("hash"); const b = JSON.parse(w.body); if (b?.v !== 1 || b.realMoney !== false || b.currency !== CURRENCY || typeof b.strategies !== "object" || !Array.isArray(b.trades)) throw new Error("shape"); S = b; loadedFrom = "FILE"; }
    catch { try { fs.renameSync(stateFile, stateFile + ".corrupt-" + Date.now()); } catch { /* ignore */ } S = fresh(); loadedFrom = "CORRUPT_STARTED_EMPTY"; }
  }
  const save = () => { const t = stateFile + "." + crypto.randomBytes(4).toString("hex") + ".tmp"; fs.writeFileSync(t, wrap(JSON.stringify(S)), { mode: 0o600 }); fs.renameSync(t, stateFile); };
  const log = (event, data = {}) => { audit.append(event, data); S.events.push({ at: new Date(nowFn()).toISOString(), event, ...data }); if (S.events.length > 500) S.events.shift(); };
  const engines = new Map();
  const engineOf = st => { let e = engines.get(st.id); if (!e) { e = createOrbEngine({ config: st.config, interval: st.interval }); if (st.engine) e.restore(st.engine); engines.set(st.id, e); } return e; };
  const equityNow = () => S.account.equity + unrealised();
  function unrealised() { let u = 0; for (const st of Object.values(S.strategies)) { const p = st.position; if (p && st.lastClose) u += (p.side === "LONG" ? 1 : -1) * (st.lastClose - p.entry) * p.qty; } return u; }
  const openCount = () => Object.values(S.strategies).filter(s => s.position).length;
  const dayRec = d => (S.daily[d] ??= { pnl: 0, trades: 0, startEquity: S.account.equity });

  function suspendAll(reason, t) { S.suspendAll = { reason, at: new Date(t).toISOString() }; for (const st of Object.values(S.strategies)) if (st.status === "ACTIVE") suspend(st, reason, t); }
  function suspend(st, reason, t) {
    const eng = engineOf(st), ev = st.lastClose ? eng.flatten(st.lastClose, t, "SUSPENSION_FLATTEN") : null; if (ev) applyExit(st, ev.trade, t, true);
    st.status = "SUSPENDED"; st.suspendedReason = reason; st.suspensions = (st.suspensions ?? 0) + 1; st.engine = eng.snapshot(); log("STRATEGY_SUSPENDED", { id: st.id, reason, suspensions: st.suspensions });
  }
  function applyExit(st, tr, t, noLimits = false) {
    const trade = { ...tr, strategy: st.id, instrument: st.instrument, dataKind: st.dataKind, simulated: true }; S.account.equity += tr.pnl; S.account.peak = Math.max(S.account.peak, S.account.equity);
    const d = dayRec(dayOf(tr.exitT)); d.pnl += tr.pnl; d.trades++; st.position = null; st.stats.trades++; st.stats.net += tr.pnl; st.stats.consecutiveLosses = tr.pnl > 0 ? 0 : st.stats.consecutiveLosses + 1;
    S.trades.push(trade); if (S.trades.length > L.maxTradesKept) S.trades.shift(); log("PAPER_EXIT", { id: st.id, trade: tr.id, side: tr.side, pnl: Number(tr.pnl.toFixed(2)), r: Number(tr.r.toFixed(3)), reason: tr.exitReason, simulated: true });
    if (noLimits) return;
    const dd = (S.account.peak - S.account.equity) / S.account.peak * 100, dayLossPct = -d.pnl / d.startEquity * 100;
    if (dd >= L.maxDrawdownPct) suspendAll(`MAX_DRAWDOWN ${dd.toFixed(2)}% >= ${L.maxDrawdownPct}%`, t);
    else if (dayLossPct >= L.dailyLossPct) suspendAll(`DAILY_LOSS ${dayLossPct.toFixed(2)}% >= ${L.dailyLossPct}%`, t);
    else if (st.stats.consecutiveLosses >= L.maxConsecutiveLosses && st.status === "ACTIVE") suspend(st, `CONSECUTIVE_LOSSES ${st.stats.consecutiveLosses}`, t);
  }

  function addStrategy({ id, instrument, interval, config = {}, evaluation = null, dataKind = "SIMULATED", ownerOverride = null } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); if (typeof id !== "string" || !ID.test(id)) return fail("ID_INVALID"); if (S.strategies[id]) return fail("ID_EXISTS");
    if (Object.keys(S.strategies).length >= L.maxStrategies) return fail("TOO_MANY_STRATEGIES"); if (typeof instrument !== "string" || !INSTR.test(instrument)) return fail("INSTRUMENT_INVALID"); if (!INTERVALS[interval]) return fail("INTERVAL_INVALID");
    if (!KINDS.includes(dataKind) || dataKind === "UNAVAILABLE") return fail("DATA_KIND_INVALID"); if (config.mode !== undefined || config.live !== undefined || config.broker !== undefined || config.apiKey !== undefined) return fail("LIVE_TRADING_NOT_AUTHORIZED");
    const n = normaliseConfig(config); if (!n.ok) return n; if (n.config.riskPct > 2) return fail("RISK_PER_TRADE_ABOVE_PAPER_CAP");
    let basis = "VERDICT"; if (!(evaluation && ELIGIBLE.has(evaluation.status) && typeof evaluation.evidenceSha256 === "string")) {
      if (!ownerAuth) return fail("RESEARCH_VERDICT_REQUIRED"); const v = ownerAuth.verifyApproval(ownerOverride, { action: "PAPER_STRATEGY_OVERRIDE", subject: "paper:" + id }); if (!v.allowed) return fail("RESEARCH_VERDICT_REQUIRED", { overrideReason: v.reason }); basis = "OWNER_OVERRIDE";
    }
    try { createOrbEngine({ config: n.config, interval }); } catch (e) { return fail(String(e.message)); }
    S.strategies[id] = { id, instrument, interval, config: n.config, dataKind, basis, evidenceSha256: evaluation?.evidenceSha256 ?? null, verdict: evaluation?.status ?? "OWNER_OVERRIDE", status: "ACTIVE", suspensions: 0, addedAt: new Date(nowFn()).toISOString(), lastT: null, lastClose: null, lastDataKind: null, lastCandleAt: null, position: null, engine: null, stats: { trades: 0, net: 0, consecutiveLosses: 0, candles: 0 } };
    log("STRATEGY_ADDED", { id, instrument, interval, config: n.config, basis, verdict: S.strategies[id].verdict, evidence: S.strategies[id].evidenceSha256, simulated: true }); save(); return { ok: true, id };
  }

  /** Feed one COMPLETED candle. Idempotent: a candle at or before lastT is ignored (restart replays are safe). */
  function onCandle(id, candle, { kind = null } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const st = S.strategies[id]; if (!st) return fail("NO_SUCH_STRATEGY");
    const dk = kind ?? st.dataKind; if (!KINDS.includes(dk) || dk === "UNAVAILABLE") { log("CANDLE_REFUSED_DATA_UNAVAILABLE", { id }); save(); return fail("DATA_UNAVAILABLE"); }
    if (!candle || ![candle.t, candle.o, candle.h, candle.l, candle.c, candle.v].every(Number.isFinite) || candle.t % INTERVALS[st.interval] !== 0 || candle.h < Math.max(candle.o, candle.c, candle.l) || candle.l > Math.min(candle.o, candle.c, candle.h)) return fail("CANDLE_INVALID");
    if (st.lastT !== null && candle.t <= st.lastT) return { ok: true, ignored: "ALREADY_PROCESSED" };
    st.lastT = candle.t; st.lastClose = candle.c; st.lastDataKind = dk; st.lastCandleAt = candle.t; st.stats.candles++;
    if (st.status !== "ACTIVE") { save(); return { ok: true, status: st.status }; }
    const stale = (dk === "LIVE" || dk === "DELAYED") && nowFn() - (candle.t + INTERVALS[st.interval]) > L.maxStaleMs;
    const blocked = stale || Boolean(S.suspendAll) || openCount() >= L.maxOpenPositions && !st.position; const eng = engineOf(st), out = [];
    for (const ev of eng.push(candle, { equity: S.account.equity, allowEntry: !blocked })) {
      if (ev.type === "SIGNAL") { log("PAPER_SIGNAL", { id, side: ev.side, day: ev.day, level: ev.level, simulated: true }); out.push(ev); }
      else if (ev.type === "ENTRY") { st.position = { side: ev.side, entry: ev.price, stop: ev.stop, target: ev.target, qty: ev.qty, riskAmount: ev.riskAmount, since: ev.t }; log("PAPER_ENTRY", { id, side: ev.side, price: Number(ev.price.toFixed(6)), stop: ev.stop, target: ev.target, qty: ev.qty, risk: Number(ev.riskAmount.toFixed(2)), simulated: true }); out.push(ev); }
      else if (ev.type === "EXIT") { applyExit(st, ev.trade, candle.t); out.push(ev); }
      else if (ev.type === "NO_ENTRY" || ev.type === "NO_TRADE") { log("PAPER_NO_TRADE", { id, reason: stale && ev.reason === "ENTRY_BLOCKED_BY_RISK_LIMIT" ? "STALE_DATA" : ev.reason }); }
    }
    if (st.status === "ACTIVE") st.engine = eng.snapshot(); save(); return { ok: true, events: out.map(e => e.type), equity: equityNow() };
  }

  function resume(id, ownerApproval) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const st = S.strategies[id]; if (!st) return fail("NO_SUCH_STRATEGY"); if (st.status !== "SUSPENDED") return fail("NOT_SUSPENDED"); if (!ownerAuth) return fail("OWNER_AUTH_REQUIRED");
    const subject = `paper:${id}:${st.suspensions}`, v = ownerAuth.verifyApproval(ownerApproval, { action: "PAPER_STRATEGY_RESUME", subject }); if (!v.allowed) return fail("OWNER_APPROVAL_REQUIRED:" + v.reason, { subject });
    if (S.suspendAll) { const dd = (S.account.peak - S.account.equity) / S.account.peak * 100; if (dd >= L.maxDrawdownPct) return fail("DRAWDOWN_STILL_ABOVE_LIMIT"); S.suspendAll = null; }
    st.status = "ACTIVE"; st.suspendedReason = null; st.stats.consecutiveLosses = 0; log("STRATEGY_RESUMED", { id, nonce: v.nonce }); save(); return { ok: true };
  }
  const resumeSubject = id => (S.strategies[id] ? { action: "PAPER_STRATEGY_RESUME", subject: `paper:${id}:${S.strategies[id].suspensions}` } : null);
  function stopStrategy(id) { const st = S.strategies[id]; if (!st) return fail("NO_SUCH_STRATEGY"); if (st.status === "STOPPED") return { ok: true }; const eng = engineOf(st); if (st.lastClose) { const ev = eng.flatten(st.lastClose, st.lastT + INTERVALS[st.interval], "STOPPED_BY_OWNER"); if (ev) applyExit(st, ev.trade, st.lastT, true); } st.status = "STOPPED"; st.engine = eng.snapshot(); log("STRATEGY_STOPPED", { id }); save(); return { ok: true }; }
  /** Real-money trading is not available in this system. The request is refused and recorded. */
  function requestLiveTrading(why = "") { log("LIVE_TRADING_REFUSED", { why: String(why).slice(0, 120) }); save(); return fail("LIVE_TRADING_NOT_AUTHORIZED", { detail: "No broker, exchange or wallet integration exists; real-money trading needs a separate explicit owner authorization and a separate, reviewed implementation." }); }

  function report() {
    const t = nowFn(), eq = equityNow(), dd = (S.account.peak - eq) / S.account.peak * 100, today = dayOf(t), d = S.daily[today] ?? { pnl: 0, trades: 0 }, warnings = [];
    const dayLoss = d.startEquity ? -d.pnl / d.startEquity * 100 : 0; if (dd >= 0.7 * L.maxDrawdownPct) warnings.push(`drawdown ${dd.toFixed(2)}% is near the ${L.maxDrawdownPct}% limit`); if (dayLoss >= 0.7 * L.dailyLossPct) warnings.push(`today's loss ${dayLoss.toFixed(2)}% is near the ${L.dailyLossPct}% limit`);
    if (S.suspendAll) warnings.push("all strategies suspended: " + S.suspendAll.reason);
    return { ok: true, currency: CURRENCY, realMoney: false, label: "SIMULATED PAPER TRADING - NOT REAL MONEY, NOT REAL REVENUE", loadedFrom, account: { starting: S.account.starting, realisedEquity: S.account.equity, equityMarkedToMarket: eq, unrealised: unrealised(), peak: S.account.peak, drawdownPct: Math.max(0, dd), totalReturnPct: (eq / S.account.starting - 1) * 100, today: { day: today, pnl: d.pnl, trades: d.trades } }, limits: L,
      strategies: Object.values(S.strategies).map(st => ({ id: st.id, instrument: st.instrument, interval: st.interval, status: st.status, suspendedReason: st.suspendedReason ?? null, suspensions: st.suspensions, basis: st.basis, verdict: st.verdict, evidenceSha256: st.evidenceSha256, dataKind: st.dataKind, lastDataKind: st.lastDataKind, lastCandleAt: st.lastCandleAt ? new Date(st.lastCandleAt).toISOString() : null, position: st.position, performance: metrics(S.trades.filter(x => x.strategy === st.id), S.account.starting), candles: st.stats.candles })),
      trades: S.trades.slice(-100), recentEvents: S.events.slice(-60), warnings, auditHead: audit.head(), auditLength: audit.length() };
  }
  function reset(ownerApproval) { if (!ownerAuth) return fail("OWNER_AUTH_REQUIRED"); const v = ownerAuth.verifyApproval(ownerApproval, { action: "PAPER_ACCOUNT_RESET", subject: "paper:account" }); if (!v.allowed) return fail("OWNER_APPROVAL_REQUIRED:" + v.reason); log("PAPER_ACCOUNT_RESET", { nonce: v.nonce, previousEquity: S.account.equity }); const ev = S.events; S = fresh(); S.events = ev; engines.clear(); save(); return { ok: true }; }
  return { addStrategy, onCandle, resume, resumeSubject, stopStrategy, requestLiveTrading, report, reset, auditVerify: () => { try { audit.reload(); } catch (e) { return { ok: false, reason: String(e.message).slice(0, 80) }; } return audit.verify(); }, auditEntries: (n = 50) => audit.entries().slice(-n), limits: L, loadedFrom: () => loadedFrom, trades: () => S.trades.map(t => ({ ...t })) };
}
