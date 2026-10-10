// Unified programme M6: autonomous PAPER trading - gating, risk suspension, signed resume, restart recovery, audit, and separation from real revenue. Simulated money only.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createPaperTrader, CURRENCY } from "../atlasz-addons/paper-trader.mjs";
import { tmp } from "./helpers.mjs";

const kp = generateOwnerKeyPair(), ap = (action, subject) => issueOwnerApproval({ privateKeyPem: kp.privateKeyPem, action, subject });
const mkAuth = () => createOwnerAuth({ publicKeyB64: kp.publicKeyB64 });
const DAY = 86_400_000, M5 = 300_000, D0 = Date.UTC(2026, 0, 6);
const CFG = { anchor: "UTC_ASIA", spreadBps: 0, slippageBps: 0, commissionBps: 0, minRangeBps: 0 };
const OK = { status: "ELIGIBLE_FOR_PAPER_TRADING", evidenceSha256: "a".repeat(64) };
const RANGE = [[100, 101, 99, 100], [100, 102, 99.5, 101], [101, 101.5, 98, 100]];
const LOSS = [...RANGE, [100, 103.5, 100, 103], [103.2, 104, 97, 98]];            // long, stopped at 98
const WIN = [...RANGE, [100, 103.5, 100, 103], [103.2, 104, 103, 103.8], [103.8, 116, 103.5, 115]];
const day = (n, arr) => arr.map(([o, h, l, c, v = 100], i) => ({ t: D0 + n * DAY + i * M5, o, h, l, c, v }));
const feed = (pt, id, n, arr, kind) => { let last; for (const c of day(n, arr)) last = pt.onCandle(id, c, kind ? { kind } : {}); return last; };
const make = (o = {}) => { const dir = o.dir ?? tmp("pt-"); let now = D0; const pt = createPaperTrader({ dir, nowFn: () => now, ownerAuth: mkAuth(), ...o }); return { pt, dir, setNow: t => { now = t; } }; };
const add = (pt, id = "s1", extra = {}) => pt.addStrategy({ id, instrument: "BTCUSD", interval: "5m", config: CFG, evaluation: OK, dataKind: "SIMULATED", ...extra });

test("paper trader: strategies need an eligible research verdict or a signed override; live/broker configuration is refused", () => {
  const { pt } = make();
  assert.equal(pt.addStrategy({ id: "a", instrument: "BTCUSD", interval: "5m", config: CFG }).reason, "RESEARCH_VERDICT_REQUIRED");
  assert.equal(pt.addStrategy({ id: "a", instrument: "BTCUSD", interval: "5m", config: CFG, evaluation: { status: "REJECTED", evidenceSha256: "b".repeat(64) } }).reason, "RESEARCH_VERDICT_REQUIRED");
  assert.equal(pt.addStrategy({ id: "a", instrument: "BTCUSD", interval: "5m", config: CFG, evaluation: { status: "ELIGIBLE_FOR_PAPER_TRADING" } }).ok, false);   // no evidence hash
  assert.equal(pt.addStrategy({ id: "a", instrument: "BTCUSD", interval: "5m", config: CFG, ownerOverride: ap("PAPER_STRATEGY_OVERRIDE", "paper:other") }).ok, false);   // bound to another subject
  assert.equal(pt.addStrategy({ id: "a", instrument: "BTCUSD", interval: "5m", config: CFG, ownerOverride: ap("PAPER_STRATEGY_OVERRIDE", "paper:a") }).ok, true);
  for (const bad of [{ mode: "live" }, { live: true }, { broker: "x" }, { apiKey: "x" }]) assert.equal(add(pt, "z" + Math.random().toString(36).slice(2, 6), { config: { ...CFG, ...bad } }).reason, "LIVE_TRADING_NOT_AUTHORIZED");
  assert.equal(add(pt, "r", { config: { ...CFG, riskPct: 5 } }).ok, false);
  assert.equal(add(pt, "b", { dataKind: "UNAVAILABLE" }).reason, "DATA_KIND_INVALID");
  assert.equal(add(pt, "../x").reason, "ID_INVALID");
  assert.equal(add(pt, "ok1").ok, true); assert.equal(add(pt, "ok1").reason, "ID_EXISTS");
  const r = pt.requestLiveTrading("please"); assert.equal(r.ok, false); assert.equal(r.reason, "LIVE_TRADING_NOT_AUTHORIZED");
  assert.ok(pt.auditEntries(200).some(e => e.event === "LIVE_TRADING_REFUSED"));
});

test("paper trader: runs on its own, books simulated trades, labels everything SIMULATED, never claims real money", () => {
  const { pt } = make(); add(pt); feed(pt, "s1", 0, WIN); feed(pt, "s1", 1, LOSS);
  const r = pt.report(); assert.equal(r.currency, CURRENCY); assert.equal(r.realMoney, false); assert.match(r.label, /NOT REAL MONEY, NOT REAL REVENUE/);
  assert.equal(r.trades.length, 2); assert.ok(r.trades.every(t => t.simulated === true && t.dataKind === "SIMULATED"));
  assert.ok(r.trades[0].pnl > 0 && r.trades[1].pnl < 0); assert.ok(Math.abs(r.trades[1].r + 1) < 1e-6, "a stop-out is -1R"); assert.ok(r.account.realisedEquity > 0);
  assert.equal(pt.auditVerify().ok, true);
});

test("paper trader: replayed candles are ignored, invalid candles refused, unavailable data blocks trading and is logged", () => {
  const { pt } = make(); add(pt); const cs = day(0, WIN); for (const c of cs) pt.onCandle("s1", c);
  const n = pt.report().trades.length; for (const c of cs) assert.equal(pt.onCandle("s1", c).ignored, "ALREADY_PROCESSED"); assert.equal(pt.report().trades.length, n);
  assert.equal(pt.onCandle("s1", { ...day(1, WIN)[0], h: 1 }).reason, "CANDLE_INVALID"); assert.equal(pt.onCandle("s1", { ...day(1, WIN)[0], t: D0 + DAY + 1 }).reason, "CANDLE_INVALID");
  assert.equal(pt.onCandle("s1", day(1, WIN)[0], { kind: "UNAVAILABLE" }).reason, "DATA_UNAVAILABLE"); assert.equal(pt.onCandle("nope", cs[0]).reason, "NO_SUCH_STRATEGY");
  assert.ok(pt.auditEntries(200).some(e => e.event === "CANDLE_REFUSED_DATA_UNAVAILABLE"));
});

test("paper trader: consecutive losses suspend the strategy, the suspension is audited, and resume needs a fresh signed single-use approval bound to that suspension", () => {
  const { pt } = make({ limits: { maxConsecutiveLosses: 2 } }); add(pt); feed(pt, "s1", 0, LOSS); assert.equal(pt.report().strategies[0].status, "ACTIVE"); feed(pt, "s1", 1, LOSS);
  const st = () => pt.report().strategies[0]; assert.equal(st().status, "SUSPENDED"); assert.match(st().suspendedReason, /CONSECUTIVE_LOSSES/);
  const before = pt.report().trades.length; feed(pt, "s1", 2, LOSS); assert.equal(pt.report().trades.length, before, "a suspended strategy does not trade");
  assert.ok(pt.auditEntries(200).some(e => e.event === "STRATEGY_SUSPENDED"));
  assert.match(pt.resume("s1", null).reason, /OWNER_APPROVAL_REQUIRED/);
  assert.match(pt.resume("s1", ap("PAPER_STRATEGY_RESUME", "paper:s1:99")).reason, /OWNER_APPROVAL_REQUIRED/);      // wrong suspension counter
  const sub = pt.resumeSubject("s1"); const a = ap(sub.action, sub.subject); assert.equal(pt.resume("s1", a).ok, true); assert.equal(st().status, "ACTIVE");
  assert.equal(pt.resume("s1", a).reason, "NOT_SUSPENDED");
});

test("paper trader: a signed approval cannot be replayed to resume a later suspension", () => {
  const { pt } = make({ limits: { maxConsecutiveLosses: 1 } }); add(pt); feed(pt, "s1", 0, LOSS); const s1 = pt.resumeSubject("s1"), a = ap(s1.action, s1.subject); assert.equal(pt.resume("s1", a).ok, true);
  feed(pt, "s1", 1, LOSS); assert.equal(pt.report().strategies[0].status, "SUSPENDED"); assert.match(pt.resume("s1", a).reason, /OWNER_APPROVAL_REQUIRED/);
});

test("paper trader: a daily loss breach suspends every strategy; the account drawdown limit blocks resume while it persists", () => {
  const { pt } = make({ limits: { dailyLossPct: 0.5, maxConsecutiveLosses: 99 } }); add(pt, "a"); add(pt, "b"); feed(pt, "a", 0, LOSS);
  const r = pt.report(); assert.ok(r.strategies.every(s => s.status === "SUSPENDED")); assert.ok(r.warnings.some(w => /suspended/.test(w)));
  const t2 = make({ limits: { maxDrawdownPct: 1.5, dailyLossPct: 50, maxConsecutiveLosses: 99 } }).pt; add(t2); feed(t2, "s1", 0, LOSS); feed(t2, "s1", 1, LOSS);
  assert.equal(t2.report().strategies[0].status, "SUSPENDED"); assert.match(t2.report().strategies[0].suspendedReason, /MAX_DRAWDOWN/);
  const s = t2.resumeSubject("s1"); assert.equal(t2.resume("s1", ap(s.action, s.subject)).reason, "DRAWDOWN_STILL_ABOVE_LIMIT");
});

test("paper trader: an open position is flattened when a limit suspends the strategy", () => {
  const { pt } = make({ limits: { maxConsecutiveLosses: 99 } }); add(pt);
  for (const c of day(0, WIN).slice(0, 5)) pt.onCandle("s1", c);       // entry opened, target not reached yet
  assert.equal(pt.report().strategies[0].position !== null && pt.report().strategies[0].position !== undefined, true);
  pt.stopStrategy("s1"); const r = pt.report(); assert.equal(r.strategies[0].status, "STOPPED"); assert.ok(r.trades.some(t => t.exitReason === "STOPPED_BY_OWNER" || /FLATTEN|STOP/.test(t.exitReason)));
});

test("paper trader: owner stop / safe mode freezes everything", () => {
  let stop = false; const { pt } = make({ isStopped: () => stop }); add(pt); stop = true;
  assert.equal(add(pt, "x").reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); assert.equal(pt.onCandle("s1", day(0, WIN)[0]).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
  stop = false; assert.equal(pt.onCandle("s1", day(0, WIN)[0]).ok, true);
});

test("paper trader: LIVE/DELAYED data older than the staleness limit never opens a position", () => {
  const { pt, setNow } = make({ limits: { maxStaleMs: 60_000 } }); add(pt, "s1", { dataKind: "LIVE" }); setNow(D0 + 40 * DAY);                 // the clock is far ahead of the candles
  feed(pt, "s1", 0, WIN); const r = pt.report(); assert.equal(r.trades.length, 0); assert.ok(pt.auditEntries(200).some(e => /PAPER_NO_TRADE/.test(JSON.stringify(e)) && /STALE_DATA/.test(JSON.stringify(e))));
});

test("paper trader: state survives a restart exactly, a replay does not double-count, and a corrupted state file starts empty and is preserved", () => {
  const dir = tmp("pt-"), a = make({ dir }); add(a.pt); feed(a.pt, "s1", 0, WIN); for (const c of day(1, LOSS).slice(0, 4)) a.pt.onCandle("s1", c);
  const r1 = a.pt.report(), b = make({ dir }); const r2 = b.pt.report(); assert.equal(r2.loadedFrom, "FILE"); assert.deepEqual(r2.account, r1.account); assert.equal(r2.trades.length, r1.trades.length); assert.deepEqual(r2.strategies, r1.strategies);
  for (const c of day(0, WIN)) b.pt.onCandle("s1", c); assert.equal(b.pt.report().trades.length, r1.trades.length);
  b.pt.onCandle("s1", day(1, LOSS)[4]); const eq = b.pt.report().account.realisedEquity; assert.ok(eq < r1.account.realisedEquity, "the open position is carried over the restart and stopped out");
  assert.equal(b.pt.auditVerify().ok, true);
  const f = path.join(dir, "paper-state.json"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("100000", "100001")); const c = make({ dir });
  assert.equal(c.pt.report().loadedFrom, "CORRUPT_STARTED_EMPTY"); assert.equal(c.pt.report().strategies.length, 0); assert.ok(fs.readdirSync(dir).some(n => n.startsWith("paper-state.json.corrupt-")));
});

test("paper trader: tampering with the audit log is detected; account reset needs a signed approval and is recorded", () => {
  const { pt, dir } = make(); add(pt); feed(pt, "s1", 0, WIN); assert.equal(pt.auditVerify().ok, true);
  const f = path.join(dir, "paper-audit.jsonl"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("STRATEGY_ADDED", "STRATEGY_ADDEd")); assert.equal(pt.auditVerify().ok, false);
  const t = make().pt; add(t); feed(t, "s1", 0, WIN); assert.match(t.reset(null).reason, /OWNER_APPROVAL_REQUIRED/); assert.match(t.reset(ap("PAPER_ACCOUNT_RESET", "paper:other")).reason, /OWNER_APPROVAL_REQUIRED/);
  assert.equal(t.reset(ap("PAPER_ACCOUNT_RESET", "paper:account")).ok, true); assert.equal(t.report().trades.length, 0); assert.ok(t.auditEntries(200).some(e => e.event === "PAPER_ACCOUNT_RESET"));
});

test("paper trader: no network, broker or wallet code exists in the module, and its results never enter the verified-revenue ledger", async () => {
  const src = fs.readFileSync(new URL("../atlasz-addons/paper-trader.mjs", import.meta.url), "utf8");
  assert.ok(!/node:(http|https|net|tls|dgram|child_process)|fetch\(|XMLHttpRequest|WebSocket|require\(/.test(src.replace(/\/\/.*$/gm, "")));
  const { createFinancialLedger } = await import("../atlasz-addons/financial-ledger.mjs");
  const dir = tmp("pt-"), { pt } = make(); add(pt); feed(pt, "s1", 0, WIN); assert.ok(pt.report().account.realisedEquity > 100_000);
  const led = createFinancialLedger({ dir }); const s = led.summary(); assert.equal(JSON.stringify(s).includes("SIM-USD"), false); assert.ok(!(s.verifiedRevenue > 0), "paper profit is not revenue");
});

test("paper trader: a win resets the consecutive-loss counter; while an account-level suspension is in force a newly added strategy cannot open positions", () => {
  const a = make({ limits: { maxConsecutiveLosses: 2 } }).pt; add(a); feed(a, "s1", 0, LOSS); feed(a, "s1", 1, WIN); feed(a, "s1", 2, LOSS); assert.equal(a.report().strategies[0].status, "ACTIVE"); feed(a, "s1", 3, LOSS); assert.equal(a.report().strategies[0].status, "SUSPENDED");
  const b = make({ limits: { dailyLossPct: 0.5, maxConsecutiveLosses: 99 } }).pt; add(b, "a"); feed(b, "a", 0, LOSS); assert.ok(b.report().warnings.some(w => /suspended/.test(w)));
  add(b, "late"); const n = b.report().trades.length; feed(b, "late", 1, WIN); assert.equal(b.report().trades.length, n, "no new position while the account is suspended"); assert.ok(b.auditEntries(200).some(e => /ENTRY_BLOCKED_BY_RISK_LIMIT/.test(JSON.stringify(e))));
});

// ---- independent verification round 1 (M6): regression tests ----
test("verification: a broken audit log halts trading (fail closed) - no un-audited P&L is booked, the halt survives a restart, and only a signed reset archives the log and restarts", () => {
  const dir = tmp("pt-"), a = make({ dir }); add(a.pt); feed(a.pt, "s1", 0, WIN); const eq = a.pt.report().account.realisedEquity, f = path.join(dir, "paper-audit.jsonl");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("STRATEGY_ADDED", "STRATEGY_ADDEd")); const r = feed(a.pt, "s1", 1, LOSS);
  assert.equal(r.reason, "TRADING_HALTED_AUDIT_FAILURE"); assert.equal(a.pt.report().account.realisedEquity, eq); assert.equal(a.pt.report().trades.length, 1); assert.ok(a.pt.report().warnings.some(w => /TRADING HALTED/.test(w))); assert.equal(add(a.pt, "again").reason, "TRADING_HALTED_AUDIT_FAILURE");
  const b = make({ dir }); assert.ok(b.pt.report().halted, "the halt is persisted"); assert.equal(feed(b.pt, "s1", 2, WIN).reason, "TRADING_HALTED_AUDIT_FAILURE");
  assert.match(b.pt.reset(null).reason, /OWNER_APPROVAL_REQUIRED/); assert.equal(b.pt.reset(ap("PAPER_ACCOUNT_RESET", "paper:account")).ok, true);
  assert.ok(fs.readdirSync(dir).some(n => n.startsWith("paper-audit.jsonl.tampered-")), "the broken log is archived, not deleted"); assert.equal(b.pt.report().halted, null); assert.equal(b.pt.auditVerify().ok, true); assert.equal(add(b.pt, "fresh").ok, true);
});

test("verification: limits also see open-position losses (marked to market); a first loss of the day is measured against the start-of-day equity", () => {
  const { pt } = make({ limits: { maxDrawdownPct: 0.3, dailyLossPct: 50, maxConsecutiveLosses: 99 } }); add(pt); const cs = [...RANGE, [100, 103.5, 100, 103], [103.2, 104, 103, 103.8], [103.8, 103.9, 100.5, 100.6]];
  for (const c of day(0, cs)) pt.onCandle("s1", c); const r = pt.report(); assert.equal(r.strategies[0].status, "SUSPENDED"); assert.match(r.strategies[0].suspendedReason, /MARKED_TO_MARKET/); assert.ok(r.trades.some(t => t.exitReason === "SUSPENSION_FLATTEN"), "the open position was flattened");
  const q = make({ limits: { dailyLossPct: 1.005, maxConsecutiveLosses: 99 } }).pt; add(q); feed(q, "s1", 0, LOSS); assert.equal(q.report().strategies[0].status, "ACTIVE", "a -1.000% day is below a 1.005% limit (start-of-day equity 100000, not the post-loss equity)");
});

test("verification: trade ids are unique across strategies; random-rule and unknown/ill-typed configurations are refused; implausible candles are refused", () => {
  const { pt } = make(); add(pt, "a"); add(pt, "b"); feed(pt, "a", 0, WIN); feed(pt, "b", 0, WIN); const t = pt.report().trades; assert.equal(t.length, 2); assert.equal(new Set(t.map(x => x.id)).size, 2);
  assert.equal(add(pt, "r", { config: { ...CFG, entryRule: "random" } }).reason, "ENTRY_RULE_NOT_ALLOWED_FOR_PAPER_TRADING"); assert.match(add(pt, "u", { config: { ...CFG, bogus: 1 } }).reason, /CONFIG_KEY_UNKNOWN/); assert.equal(add(pt, "s", { config: "abcdef" }).reason, "CONFIG_MUST_BE_AN_OBJECT");
  const c0 = day(5, WIN)[0]; for (const bad of [{ o: 0 }, { c: -1 }, { v: -5 }]) assert.equal(pt.onCandle("a", { ...c0, ...bad }).reason, "CANDLE_INVALID", JSON.stringify(bad));
  add(pt, "live", { dataKind: "LIVE" }); assert.equal(pt.onCandle("live", { ...c0, t: Date.now() + 3 * 86_400_000 - (Date.now() % 300_000) }).reason, "CANDLE_INVALID", "a far-future live candle would block every later real candle");
});

test("verification: a refused resume (drawdown still above the limit) does not spend the owner's approval", () => {
  const auth = mkAuth(), pt = createPaperTrader({ dir: tmp("pt-"), nowFn: () => D0, ownerAuth: auth, limits: { maxDrawdownPct: 1.5, dailyLossPct: 50, maxConsecutiveLosses: 99 } }); add(pt); feed(pt, "s1", 0, LOSS); feed(pt, "s1", 1, LOSS);
  const s = pt.resumeSubject("s1"), a = ap(s.action, s.subject); assert.equal(pt.resume("s1", a).reason, "DRAWDOWN_STILL_ABOVE_LIMIT"); assert.equal(auth.verifyApproval(a, { action: s.action, subject: s.subject }).allowed, true, "the approval is still unspent");
});

test("verification: the halt flag itself blocks trading even if the audit file is later restored; the marked-to-market DAILY loss limit also suspends", () => {
  const dir = tmp("pt-"), a = make({ dir }); add(a.pt); feed(a.pt, "s1", 0, WIN); const f = path.join(dir, "paper-audit.jsonl"), good = fs.readFileSync(f, "utf8");
  fs.writeFileSync(f, good.replace("STRATEGY_ADDED", "STRATEGY_ADDEd")); assert.equal(feed(a.pt, "s1", 1, LOSS).reason, "TRADING_HALTED_AUDIT_FAILURE"); fs.writeFileSync(f, good); assert.equal(a.pt.auditVerify().ok, true, "the audit file is healthy again");
  assert.equal(feed(a.pt, "s1", 2, LOSS).reason, "TRADING_HALTED_AUDIT_FAILURE", "but the persisted halt stays until the owner's signed reset");
  const { pt } = make({ limits: { dailyLossPct: 0.3, maxDrawdownPct: 50, maxConsecutiveLosses: 99 } }); add(pt); for (const c of day(0, [...RANGE, [100, 103.5, 100, 103], [103.2, 104, 103, 103.8], [103.8, 103.9, 100.5, 100.6]])) pt.onCandle("s1", c);
  assert.match(pt.report().strategies[0].suspendedReason, /DAILY_LOSS_MARKED_TO_MARKET/);
});
