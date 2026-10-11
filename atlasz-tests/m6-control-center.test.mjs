// Unified programme M6: Operations Center over real HTTP - trading panel, live agent activity, operations and revenue dashboards, live state stream, restart restore.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { tmp } from "./helpers.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";
import { createCoordinator } from "../atlasz-addons/agent-coordination.mjs";
import { createFinancialLedger } from "../atlasz-addons/financial-ledger.mjs";

const PW = "correct horse battery";
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const raw = (port, p, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => { const q = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); }); q.on("error", reject); if (body) q.write(body); q.end(); });
async function boot(base = tmp("ccm6-"), extra = {}) {
  const stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort(), ...extra }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const c = { cc, base, stateDir, token, port, get: (p, t = token) => raw(port, p, { headers: { ...H, ...(t ? { "x-atlasz-token": t } : {}) } }), post: (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) }) };
  c.json = async p => JSON.parse((await c.get(p)).body); c.act = async b => { const r = await c.post("/api/trading/action", b); return { status: r.status, ...JSON.parse(r.body) }; };
  c.key = async () => assert.equal((await c.post("/api/owner-key", { passphrase: PW })).status, 200);
  return c;
}
const SIM = { op: "generate", id: "sim1", seed: 11, days: 12, interval: "5m" }, CFG = { anchor: "UTC_ASIA" };

test("M6 routes need the token; a fresh install reports honest empty states (agents UNKNOWN, no payment evidence, live data UNAVAILABLE, real-money NOT_AUTHORIZED)", async () => {
  const c = await boot();
  try {
    for (const p of ["/api/trading", "/api/operations", "/api/agents/activity", "/api/revenue-dashboard", "/api/trading/candles?dataset=x", "/api/live"]) assert.equal((await c.get(p, null)).status, 401, p);
    assert.equal((await c.post("/api/trading/action", { op: "paperTick" }, null)).status, 401);
    const a = await c.json("/api/agents/activity"); assert.equal(a.available, false); assert.equal(a.agents.length, 30); assert.ok(a.agents.every(x => x.state === "UNKNOWN"));
    const t = await c.json("/api/trading"); assert.equal(t.liveData.state, "UNAVAILABLE"); assert.equal(t.realMoneyTrading.state, "NOT_AUTHORIZED"); assert.equal(t.paper.realMoney, false); assert.match(t.paper.label, /NOT REAL REVENUE/);
    const r = await c.json("/api/revenue-dashboard"); assert.equal(r.realBusiness.state, "NO_PAYMENT_EVIDENCE_RECORDED"); assert.equal(r.combinedTotal, null); assert.equal(r.simulatedPaperTrading.realMoney, false);
    const o = await c.json("/api/operations"); assert.equal(o.agents.available, false); assert.equal(o.revenue.state, "NO_PAYMENT_EVIDENCE_RECORDED"); assert.equal(o.topology.expectedSearch, 5); assert.equal(o.topology.expectedExecution, 25);
  } finally { await c.cc.close(); }
});

test("M6 trading: simulated data is labelled everywhere, a rejected verdict blocks paper trading, a client cannot supply its own verdict, an owner-signed override is the only way in", async () => {
  const c = await boot();
  try {
    await c.key(); const g = await c.act(SIM); assert.equal(g.ok, true); assert.equal(g.result.kind, "SIMULATED"); assert.equal((await c.act(SIM)).status, 400);        // duplicate id
    const cd = await c.json(`/api/trading/candles?dataset=sim1&limit=600&config=${encodeURIComponent(JSON.stringify(CFG))}`); assert.match(cd.banner, /SIMULATED.*NOT market data/); assert.equal(cd.dataset.kind, "SIMULATED"); assert.equal(cd.candles.length, 600); assert.ok(cd.levels.length >= 1 && cd.levels.every(l => l.high >= l.low)); assert.ok(cd.candles.every(k => k.h >= k.l));
    assert.equal((await c.get("/api/trading/candles?dataset=nope")).status, 400); assert.equal((await c.get("/api/trading/candles?dataset=sim1&config=%7Bbad")).status, 400);
    const bt = await c.act({ op: "backtest", dataset: "sim1", config: CFG }); assert.equal(bt.result.ok, true); assert.match(bt.result.label, /SIMULATED DATA/); const bt2 = await c.act({ op: "backtest", dataset: "sim1", config: CFG }); assert.equal(bt2.result.resultSha256, bt.result.resultSha256, "reproducible");
    const ev = await c.act({ op: "evaluate", dataset: "sim1", config: CFG }); assert.equal(ev.result.ok, true); assert.equal(ev.result.stored, true);
    // a random walk has no edge: the verdict is REJECTED, so paper trading must be refused without an owner override - even if the client claims an eligible verdict
    assert.equal(ev.result.status, "REJECTED");
    const forged = await c.act({ op: "paperAdd", id: "p1", dataset: "sim1", config: CFG, evaluation: { status: "ELIGIBLE_FOR_PAPER_TRADING", evidenceSha256: "a".repeat(64) } }); assert.equal(forged.result.ok, false); assert.equal(forged.result.reason, "RESEARCH_VERDICT_REQUIRED");
    const wrongPw = await c.act({ op: "paperAdd", id: "p1", dataset: "sim1", config: CFG, passphrase: "wrong" }); assert.ok(wrongPw.status === 400 || wrongPw.result?.ok === false);
    const add = await c.act({ op: "paperAdd", id: "p1", dataset: "sim1", config: CFG, passphrase: PW }); assert.equal(add.result.ok, true); assert.equal(add.result.basis, "OWNER_OVERRIDE");
    const t0 = await c.json("/api/trading"); assert.equal(t0.paper.strategies[0].basis, "OWNER_OVERRIDE"); assert.equal(t0.paper.strategies[0].dataKind, "SIMULATED");
    const live = await c.act({ op: "liveRequest", why: "go live" }); assert.equal(live.result.ok, false); assert.equal(live.result.reason, "LIVE_TRADING_NOT_AUTHORIZED");
    assert.equal((await c.act({ op: "importCsv", id: "x", csv: "t,o,h,l,c,v", kind: "LIVE", instrument: "BTCUSD", source: "s", licence: "l" })).status, 400);
    assert.equal((await c.act({ op: "nope" })).status, 400);
  } finally { await c.cc.close(); }
});

test("M6 autonomous paper session: the server's own scheduler feeds the strategy without a manual start; P&L is simulated and never enters revenue", async () => {
  const c = await boot(undefined, { tradingTickMs: 1000 });
  try {
    await c.key(); await c.act({ ...SIM, days: 20 }); await c.act({ op: "evaluate", dataset: "sim1", config: CFG }); await c.act({ op: "paperAdd", id: "p1", dataset: "sim1", config: CFG, passphrase: PW });
    const f0 = (await c.json("/api/trading")).paper.feeds.p1.cursor; await new Promise(r => setTimeout(r, 2600)); const f1 = (await c.json("/api/trading")).paper.feeds.p1.cursor; assert.ok(f1 > f0, "the scheduler advanced the feed on its own");
    await c.act({ op: "paperTick", candles: 400 }); await c.act({ op: "paperTick", candles: 400 }); const t = await c.json("/api/trading"); assert.ok(t.paper.trades.length > 0, "simulated trades were booked"); assert.ok(t.paper.trades.every(x => x.simulated === true && x.dataKind === "SIMULATED")); assert.equal(t.paperAuditOk, true);
    const full = await c.json(`/api/trading/candles?dataset=sim1&limit=1500&config=${encodeURIComponent(JSON.stringify(CFG))}&markers=backtest`), cur = t.paper.feeds.p1.cursor, seen = await c.json(`/api/trading/candles?dataset=sim1&limit=1500&config=${encodeURIComponent(JSON.stringify(CFG))}&markers=paper`);
    assert.ok(cur < full.dataset.count && seen.candles.length > 0); assert.equal(seen.candles.at(-1).t, full.candles.at(-1).t - (full.dataset.count - seen.replay.cursor) * 300_000, "the chart of a paper session ends at the feed cursor (no look-ahead)"); assert.ok(seen.replay && seen.replay.cursor >= cur);      // the server scheduler keeps feeding: the chart is judged against the cursor it reports itself
    assert.ok(seen.markers.every(m => m.simulated === true && m.exitT <= seen.candles.at(-1).t));
    const r = await c.json("/api/revenue-dashboard"); assert.equal(r.realBusiness.verifiedReceivedUsd, 0); assert.equal(r.realBusiness.state, "NO_PAYMENT_EVIDENCE_RECORDED"); assert.equal(r.combinedTotal, null); assert.equal(r.simulatedPaperTrading.trades, t.paper.trades.length); assert.match(r.simulatedPaperTrading.label, /NOT REAL REVENUE/);
    assert.equal((await c.json("/api/finance")).revenue.verifiedReceivedUsd, 0); assert.equal((await c.json("/api/operations")).revenue.state, "NO_PAYMENT_EVIDENCE_RECORDED");
  } finally { await c.cc.close(); }
});

test("M6 revenue dashboard: only a ledger PAID entry with evidence is real revenue; invoices and paper profit are not", async () => {
  const c = await boot();
  try {
    const led = createFinancialLedger({ dir: path.join(c.stateDir, "ledger") }); led.recordRevenue({ entity: "ATLASZ_EXTERNAL", jobId: "j1", amountUsd: 500, stage: "INVOICED" });
    let r = await c.json("/api/revenue-dashboard"); assert.equal(r.realBusiness.verifiedReceivedUsd, 0); assert.equal(r.realBusiness.state, "NO_PAYMENT_EVIDENCE_RECORDED"); assert.equal(r.realBusiness.unconfirmedPipelineUsd, 500); assert.equal(r.realBusiness.funnel.stages.INVOICED, 1);
    led.recordRevenue({ entity: "ATLASZ_EXTERNAL", jobId: "j1", amountUsd: 500, stage: "PAID", confirmedReceived: true, evidence: { source: "bank-statement", reference: "TEST-REF-1", verifiedAt: new Date().toISOString() } });
    r = await c.json("/api/revenue-dashboard"); assert.equal(r.realBusiness.verifiedReceivedUsd, 500); assert.equal(r.realBusiness.state, "VERIFIED"); assert.equal(r.combinedTotal, null);
    fs.writeFileSync(path.join(c.stateDir, "ledger", "ledger.jsonl"), "garbage\n"); r = await c.json("/api/revenue-dashboard"); assert.equal(r.realBusiness.state, "LEDGER_UNREADABLE"); assert.equal(r.realBusiness.verifiedReceivedUsd, null, "an unreadable ledger is UNKNOWN, never silently zero or verified"); assert.equal(r.realBusiness.costsUsd, null); assert.equal((await c.json("/api/operations")).revenue.state, "LEDGER_UNREADABLE");
    const led2 = path.join(c.stateDir, "ledger", "ledger.jsonl"); fs.writeFileSync(led2, "");
  } finally { await c.cc.close(); }
});

test("M6 live agent activity: states come from the real coordinator; nothing is invented", async () => {
  const c = await boot();
  try {
    const co = createCoordinator({ dir: path.join(c.stateDir, "coordination"), toolsOf: () => ["notes"] }); const s1 = co.connect("SEARCH-2"), e1 = co.connect("EXECUTION-7");
    assert.equal(s1.register({ id: "t-s", kind: "search.leads", payload: { q: 1 } }).ok, true); s1.start("t-s"); assert.equal(e1.register({ id: "t-b", kind: "build.module", payload: { q: 1 } }).ok, true); e1.start("t-b");
    const a = await c.json("/api/agents/activity"); assert.equal(a.available, true); const by = id => a.agents.find(x => x.id === id);
    assert.equal(by("SEARCH-2").state, "SEARCHING"); assert.equal(by("EXECUTION-7").state, "CODING"); assert.equal(by("EXECUTION-8").state, "IDLE"); assert.equal(a.agents.filter(x => x.state !== "IDLE").length, 2);
    const o = await c.json("/api/operations"); assert.equal(o.agents.counts.SEARCHING, 1); assert.equal(o.agents.counts.CODING, 1);
  } finally { await c.cc.close(); }
});

test("M6 live stream: state events arrive, the digest changes when state changes, and after a server restart the state is restored from disk with a new boot id", async () => {
  const base = tmp("ccm6-"); let c = await boot(base);
  const readEvents = (cx, ms) => new Promise(resolve => { const evs = []; const q = http.get({ host: "127.0.0.1", port: cx.port, path: "/api/live", headers: { host: "127.0.0.1:" + cx.port, "x-atlasz-token": cx.token } }, res => { let b = ""; res.on("data", d => { b += d; let i; while ((i = b.indexOf("\n\n")) >= 0) { const f = b.slice(0, i); b = b.slice(i + 2); const m = /^data: (.*)$/m.exec(f); if (m) evs.push(JSON.parse(m[1])); } }); setTimeout(() => { q.destroy(); resolve(evs); }, ms); }); q.on("error", () => resolve(evs)); });
  try {
    await c.key(); await c.act({ ...SIM, days: 20 }); await c.act({ op: "evaluate", dataset: "sim1", config: CFG }); await c.act({ op: "paperAdd", id: "p1", dataset: "sim1", config: CFG, passphrase: PW });
    const p = readEvents(c, 4600); await new Promise(r => setTimeout(r, 300)); await c.act({ op: "paperTick", candles: 300 }); const evs = await p; assert.ok(evs.length >= 2); assert.ok(new Set(evs.map(e => e.digest)).size >= 2, "digest changed after the paper tick"); assert.ok(evs.every(e => e.boot === evs[0].boot && Date.parse(e.at) > 0));
    const before = await c.json("/api/trading"), boot1 = evs[0].boot; await c.cc.close();
    c = await boot(base); const after = await c.json("/api/trading"); assert.equal(after.paper.loadedFrom, "FILE"); assert.deepEqual(after.paper.account, before.paper.account); assert.equal(after.paper.trades.length, before.paper.trades.length); assert.deepEqual(after.paper.feeds, before.paper.feeds); assert.equal(after.datasets.length, 1);
    const evs2 = await readEvents(c, 1200); assert.ok(evs2.length >= 1); assert.notEqual(evs2[0].boot, boot1, "a restart is visible to the client");
    assert.equal((await c.act({ op: "paperTick", candles: 5 })).status, 200);       // the session resumes from the stored cursor
  } finally { await c.cc.close(); }
});

test("M6 emergency stop freezes paper trading", async () => {
  const c = await boot();
  try {
    await c.key(); await c.act({ ...SIM, days: 10 }); await c.act({ op: "evaluate", dataset: "sim1", config: CFG }); await c.act({ op: "paperAdd", id: "p1", dataset: "sim1", config: CFG, passphrase: PW });
    const e = await c.post("/api/owner-safety/action", { action: "EMERGENCY_STOP", passphrase: PW }); assert.equal(e.status, 200);
    const r = await c.act({ op: "paperTick", candles: 10 }); assert.equal(r.result.ok, false); assert.equal(r.result.reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); assert.equal((await c.json("/api/trading")).stopped, true);
  } finally { await c.cc.close(); }
});

const DRIFT = { op: "generate", id: "drift1", seed: 42, days: 60, drift: 0.0001 };
test("M6 verdict path: a stored eligible verdict admits a paper strategy without any override; a verdict for another configuration or a stolen verdict file does not", async () => {
  const c = await boot();
  try {
    await c.key(); assert.equal((await c.act(DRIFT)).ok, true); const ev = await c.act({ op: "evaluate", dataset: "drift1", config: CFG }); assert.equal(ev.result.status, "SIMULATED_ONLY_NO_EDGE_CLAIM"); assert.deepEqual(ev.result.reasons, []);
    const B = { anchor: "UTC_ASIA", rr: 3 }; assert.equal((await c.act({ op: "paperAdd", id: "pb", dataset: "drift1", config: B })).result.reason, "RESEARCH_VERDICT_REQUIRED", "a verdict for configuration A does not cover B");
    const evB = await c.act({ op: "evaluate", dataset: "drift1", config: B }), vd = path.join(c.stateDir, "trading", "verdicts"), files = fs.readdirSync(vd), recs = files.map(f => [f, JSON.parse(fs.readFileSync(path.join(vd, f), "utf8"))]); const fa = recs.find(([, r]) => r.configHash === ev.result.configHash)[0], fb = recs.find(([, r]) => r.configHash === evB.result.configHash)[0];
    fs.copyFileSync(path.join(vd, fa), path.join(vd, fb)); assert.equal((await c.act({ op: "paperAdd", id: "pb", dataset: "drift1", config: B })).result.reason, "RESEARCH_VERDICT_REQUIRED", "a verdict file copied under another configuration's name is refused");
    const add = await c.act({ op: "paperAdd", id: "pa", dataset: "drift1", config: CFG, passphrase: PW }); assert.equal(add.result.ok, true); assert.match(add.result.basis, /STORED_VERDICT SIMULATED_ONLY_NO_EDGE_CLAIM/, "admitted by the verdict, not by the override");
    assert.equal((await c.act({ op: "paperAdd", id: "pz", dataset: "drift1", config: CFG })).result.ok, true);
  } finally { await c.cc.close(); }
});

test("M6 datasets: size limits, licence/kind rules, an edited dataset file is detected, and a dataset feeding a paper session cannot be deleted", async () => {
  const c = await boot();
  try {
    await c.key(); assert.equal((await c.act({ ...SIM, id: "d61", days: 61 })).status, 400); assert.equal((await c.act({ ...SIM, id: "d0", days: 0 })).status, 400);
    const row = i => `${Date.UTC(2026, 0, 6) + i * 300_000},100,101,99,100.5,10`, csv = n => "time,open,high,low,close,volume\n" + Array.from({ length: n }, (_, i) => row(i)).join("\n"), big = csv(1800); assert.ok(big.length > 60_000 && big.length < 64_000);
    assert.equal((await c.act({ op: "importCsv", id: "big", csv: big, kind: "HISTORICAL", instrument: "BTCUSD", source: "owner file", licence: "own data" })).status, 400);
    assert.equal((await c.act({ op: "importCsv", id: "nolic", csv: csv(50), kind: "HISTORICAL", instrument: "BTCUSD", source: "owner file", licence: "" })).status, 400);
    const ok = await c.act({ op: "importCsv", id: "hist", csv: csv(50), kind: "HISTORICAL", instrument: "BTCUSD", source: "owner file", licence: "own data" }); assert.equal(ok.result.ok, true); const lst = (await c.json("/api/trading")).datasets.find(d => d.id === "hist"); assert.equal(lst.kind, "HISTORICAL"); assert.equal(lst.licence, "own data");
    const f = path.join(c.stateDir, "trading", "datasets", "hist.json"); const j = JSON.parse(fs.readFileSync(f, "utf8")); j.candles[3].c = 150; j.candles[3].h = 151; fs.writeFileSync(f, JSON.stringify(j));
    c.cc.core.tradingAction({ op: "deleteDataset", id: "nolic" }).catch(() => {});      // unrelated id: must not disturb anything
    const t = await c.json("/api/trading"); assert.equal(t.datasets.find(d => d.id === "hist").error, "DATASET_UNREADABLE_OR_ALTERED"); assert.equal((await c.get("/api/trading/candles?dataset=hist")).status, 400); assert.equal((await c.act({ op: "paperAdd", id: "x", dataset: "hist", config: CFG, passphrase: PW })).result.reason, "DATASET_NOT_FOUND");
    await c.act(DRIFT); await c.act({ op: "evaluate", dataset: "drift1", config: CFG }); assert.equal((await c.act({ op: "paperAdd", id: "pa", dataset: "drift1", config: CFG })).result.ok, true);
    assert.equal((await c.act({ op: "deleteDataset", id: "drift1" })).status, 400, "dataset in use by a paper feed"); await c.act({ op: "paperStop", id: "pa" });
    const cur = (await c.json("/api/trading")).paper.feeds.pa.cursor; await c.act({ op: "paperTick", candles: 50 }); assert.equal((await c.json("/api/trading")).paper.feeds.pa.cursor, cur, "a stopped strategy is not fed");
  } finally { await c.cc.close(); }
});

// ---- independent verification round 1 (M6): regression tests ----
test("verification: a stored verdict is bound to the dataset's content and kind; relabelling a dataset on disk is detected", async () => {
  const c = await boot();
  try {
    await c.key(); await c.act(DRIFT); assert.equal((await c.act({ op: "evaluate", dataset: "drift1", config: CFG })).result.status, "SIMULATED_ONLY_NO_EDGE_CLAIM");
    assert.equal((await c.act({ op: "deleteDataset", id: "drift1" })).result.ok, true);
    const row = i => `${Date.UTC(2026, 0, 6) + i * 300_000},100,100.1,99.9,100,10`, csv = "time,open,high,low,close,volume\n" + Array.from({ length: 200 }, (_, i) => row(i)).join("\n");
    assert.equal((await c.act({ op: "importCsv", id: "drift1", csv, kind: "HISTORICAL", instrument: "BTCUSD", source: "owner file", licence: "own data" })).result.ok, true);
    assert.equal((await c.act({ op: "paperAdd", id: "p1", dataset: "drift1", config: CFG })).result.reason, "RESEARCH_VERDICT_REQUIRED", "the verdict belongs to the old (simulated) data, not to this series");
    await c.act({ ...SIM, id: "sim2" }); const f = path.join(c.stateDir, "trading", "datasets", "sim2.json"), j = JSON.parse(fs.readFileSync(f, "utf8")); j.kind = "HISTORICAL"; j.source = "relabelled"; j.licence = "fake licence"; fs.writeFileSync(f, JSON.stringify(j));
    assert.equal((await c.json("/api/trading")).datasets.find(d => d.id === "sim2").error, "DATASET_UNREADABLE_OR_ALTERED"); assert.equal((await c.act({ op: "evaluate", dataset: "sim2", config: CFG })).result.reason, "DATASET_NOT_FOUND");
    const vd = path.join(c.stateDir, "trading", "verdicts"), vf = fs.readdirSync(vd)[0], vj = JSON.parse(fs.readFileSync(path.join(vd, vf), "utf8")); vj.status = "ELIGIBLE_FOR_PAPER_TRADING"; fs.writeFileSync(path.join(vd, vf), JSON.stringify(vj));
    assert.equal((await c.json("/api/trading")).verdicts.length, 0, "an edited verdict record fails its self-hash and is not listed");
  } finally { await c.cc.close(); }
});

test("verification: the replay chart never shows future candles (also at cursor 0), work per request is bounded, and a random-side strategy cannot be added", async () => {
  const c = await boot();
  try {
    await c.key(); await c.act(DRIFT); await c.act({ op: "evaluate", dataset: "drift1", config: CFG }); await c.act({ op: "paperAdd", id: "pa", dataset: "drift1", config: CFG });
    const q = `/api/trading/candles?dataset=drift1&limit=500&config=${encodeURIComponent(JSON.stringify(CFG))}&markers=paper`; let r = await c.json(q); assert.equal(r.empty, true); assert.equal(r.candles.length, 0); assert.equal(r.replay.cursor, 0);
    await c.act({ op: "paperTick", candles: 7 }); r = await c.json(q); assert.equal(r.candles.length, 7); assert.equal(r.replay.cursor, 7); assert.ok(r.candles.at(-1).t < (await c.json(`/api/trading/candles?dataset=drift1&limit=1500&config=${encodeURIComponent(JSON.stringify(CFG))}&markers=backtest`)).candles.at(-1).t);
    const bt = await c.json(`/api/trading/candles?dataset=drift1&limit=100&config=${encodeURIComponent(JSON.stringify(CFG))}&markers=backtest`); assert.match(bt.banner, /full stored series/); assert.match(bt.markersSource, /FULL stored series/);
    assert.equal((await c.act({ op: "generate", id: "huge", interval: "1m", days: 30 })).status, 400, "43,200 candles exceed the per-dataset cap"); for (let i = 0; i < 19; i++) assert.equal((await c.act({ ...SIM, id: "g" + i, days: 2 })).status, 200); assert.equal((await c.act({ ...SIM, id: "one-too-many", days: 2 })).status, 400, "dataset count is capped");
    assert.equal((await c.act({ op: "paperAdd", id: "pr", dataset: "g1", config: { anchor: "UTC_ASIA", entryRule: "random" }, passphrase: PW })).result.reason, "ENTRY_RULE_NOT_ALLOWED_FOR_PAPER_TRADING");
    const t = await c.act({ op: "paperTick", candles: 3 }); assert.equal(t.result.ok, true); assert.ok(t.result.strategies.pa.fed >= 1);
  } finally { await c.cc.close(); }
});

test("verification: /api/operations never reports a revenue number while the ledger is unreadable", async () => {
  const c = await boot();
  try {
    const led = createFinancialLedger({ dir: path.join(c.stateDir, "ledger") }); led.recordRevenue({ entity: "ATLASZ_EXTERNAL", jobId: "j1", amountUsd: 500, stage: "PAID", confirmedReceived: true, evidence: { source: "bank-statement", reference: "TEST-REF-2", verifiedAt: new Date().toISOString() } });
    assert.equal((await c.json("/api/operations")).revenue.verifiedReceivedUsd, 500); const f = path.join(c.stateDir, "ledger", "ledger.jsonl"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"amountUsd":500', '"amountUsd":5000'));
    const o = await c.json("/api/operations"); assert.equal(o.revenue.state, "LEDGER_UNREADABLE"); assert.equal(o.revenue.verifiedReceivedUsd, null); assert.ok(o.securityAlerts.some(a => a.kind === "LEDGER_CHAIN") || o.revenue.state === "LEDGER_UNREADABLE");
  } finally { await c.cc.close(); }
});

test("verification: an edited verdict record cannot admit a strategy", async () => {
  const c = await boot();
  try {
    await c.key(); await c.act(SIM); const ev = await c.act({ op: "evaluate", dataset: "sim1", config: CFG }); assert.equal(ev.result.status, "REJECTED");
    const vd = path.join(c.stateDir, "trading", "verdicts"), vf = fs.readdirSync(vd)[0], vj = JSON.parse(fs.readFileSync(path.join(vd, vf), "utf8")); vj.status = "ELIGIBLE_FOR_PAPER_TRADING"; vj.reasons = []; fs.writeFileSync(path.join(vd, vf), JSON.stringify(vj));
    assert.equal((await c.act({ op: "paperAdd", id: "p1", dataset: "sim1", config: CFG })).result.reason, "RESEARCH_VERDICT_REQUIRED");
  } finally { await c.cc.close(); }
});
