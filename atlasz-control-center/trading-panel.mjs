// Unified programme M6: Live Trading & Crypto panel of the Control Center. Thin layer over market-data / orb-strategy / backtest / paper-trader.
//   * Every figure on the panel is computed from stored candles or from the paper trader's own state; nothing is typed in by the UI.
//   * Every dataset carries its KIND (LIVE / DELAYED / HISTORICAL / SIMULATED) and source; there is NO live connection in this build, so the panel states UNAVAILABLE for live data.
//   * Research verdicts are produced and stored HERE (server side); a paper strategy is bound to the stored verdict of its exact dataset + configuration, a client cannot supply its own verdict.
//   * Paper trading is simulated money only (SIM-USD). Nothing on this panel is, or is ever added to, verified revenue.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { makeDataset, parseCsv, generateSimulated, sessionFor, analyse, detectAnomalies, freshness, INTERVALS, KINDS } from "../atlasz-addons/market-data.mjs";
import { normaliseConfig } from "../atlasz-addons/orb-strategy.mjs";
import { runBacktest, walkForward, evaluateCandidate, buyAndHold } from "../atlasz-addons/backtest.mjs";
import { createPaperTrader, CURRENCY } from "../atlasz-addons/paper-trader.mjs";

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/, sha = t => crypto.createHash("sha256").update(t).digest("hex");
const LEGEND = Object.freeze({ LIVE: "streaming from an authorised provider", DELAYED: "provider data older than two candles", HISTORICAL: "recorded past data from a named source", SIMULATED: "generated locally - NOT market data", UNAVAILABLE: "no data" });
const MAX_DAYS = 60, MAX_CSV = 60_000, MAX_CANDLES = 20_000, MAX_DATASETS = 20;      // a request is synchronous work on the server's event loop: bounded datasets keep every request short
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const writeJson = (f, o) => { const t = f + "." + crypto.randomBytes(4).toString("hex") + ".tmp"; fs.writeFileSync(t, JSON.stringify(o), { mode: 0o600 }); fs.renameSync(t, f); };
const cfgHash = c => sha(JSON.stringify(Object.keys(c).sort().map(k => [k, c[k]])));
const provOf = d => sha(JSON.stringify([d.kind, d.source, d.licence, d.assetClass, d.retrievedAt ?? null, d.sha256]));          // provenance is covered by its own hash: relabelling a dataset on disk is detected
const recHash = r => { const { recSha256, ...rest } = r; return sha(JSON.stringify(Object.keys(rest).sort().map(k => [k, rest[k]]))); };

export function createTradingPanel({ stateDir, ownerAuth, sign, isStopped = () => false, nowFn = () => Date.now() } = {}) {
  const root = path.join(stateDir, "trading"), dsDir = path.join(root, "datasets"), vDir = path.join(root, "verdicts"), feedsFile = path.join(root, "paper-feeds.json");
  for (const d of [dsDir, vDir]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const auth = { verifyApproval: (...a) => { try { return ownerAuth().verifyApproval(...a); } catch { return { allowed: false, reason: "NO_OWNER_KEY" }; } } };
  let pt = null; const trader = () => (pt ??= createPaperTrader({ dir: path.join(root, "paper"), nowFn, ownerAuth: auth, isStopped }));
  const cache = new Map();
  const loadDs = id => {
    if (typeof id !== "string" || !ID.test(id)) return null; const f = path.join(dsDir, id + ".json"); let sig; try { const st = fs.statSync(f); sig = st.mtimeMs + ":" + st.size + ":" + st.ino; } catch { cache.delete(id); return null; }
    const hit = cache.get(id); if (hit && hit.sig === sig) return hit.ds;          // the cache is keyed by the file's stat: an edit on disk is noticed at the next read, not at the next restart
    cache.delete(id); const raw = readJson(f); if (!raw) return null;
    const r = makeDataset({ instrument: raw.instrument, interval: raw.interval, candles: raw.candles, kind: raw.kind, source: raw.source, licence: raw.licence, retrievedAt: raw.retrievedAt, assetClass: raw.assetClass });
    if (!r.ok || r.dataset.sha256 !== raw.sha256 || raw.prov !== provOf(r.dataset)) return null; cache.set(id, { sig, ds: r.dataset }); return r.dataset;      // a file edited on disk no longer matches its recorded hash
  };
  const listDs = () => { let names = []; try { names = fs.readdirSync(dsDir).filter(n => n.endsWith(".json")).map(n => n.slice(0, -5)); } catch { /* none */ } return names.sort().map(id => { const d = loadDs(id); return d ? { id, instrument: d.instrument, interval: d.interval, kind: d.kind, source: d.source, licence: d.licence, count: d.count, from: d.from, to: d.to, sha256: d.sha256, freshness: freshness(d, nowFn()), kindMeaning: LEGEND[d.kind] } : { id, error: "DATASET_UNREADABLE_OR_ALTERED" }; }); };
  const save = (id, ds) => { writeJson(path.join(dsDir, id + ".json"), { ...ds, candles: ds.candles, prov: provOf(ds) }); cache.delete(id); };
  const countDs = () => { try { return fs.readdirSync(dsDir).filter(n => n.endsWith(".json")).length; } catch { return 0; } };
  const btCache = new Map();
  const verdictFile = (dsId, ch) => path.join(vDir, `${dsId}-${ch.slice(0, 16)}.json`);
  const feeds = () => readJson(feedsFile) ?? {};
  const need = (v, what) => { if (typeof v !== "string" || !v) throw new Error(what + "_REQUIRED"); return v; };

  /** Opening-range levels per session day, computed from the candles themselves. */
  function orbLevels(ds, cfg) {
    const n = normaliseConfig(cfg); if (!n.ok) return []; const c = n.config, out = new Map(), len = c.rangeMinutes * 60_000;
    for (const k of ds.candles) { const s = sessionFor(k.t, c.anchor); if (!s) continue; let o = out.get(s.key); if (!o) { o = { day: s.key, open: s.open, rangeEnd: s.open + len, high: null, low: null, close: s.close, candles: 0 }; out.set(s.key, o); } if (k.t >= s.open && k.t < s.open + len) { o.high = o.high === null ? k.h : Math.max(o.high, k.h); o.low = o.low === null ? k.l : Math.min(o.low, k.l); o.candles++; } }
    const need2 = Math.round(len / INTERVALS[ds.interval]); return [...out.values()].map(o => ({ ...o, complete: o.candles >= need2 })).filter(o => o.high !== null);
  }

  function view() {
    const t = trader(), rep = t.report(), f = feeds(), ds = listDs();
    return { state: "CONNECTED", at: new Date(nowFn()).toISOString(), legend: LEGEND, currency: CURRENCY,
      liveData: { state: "UNAVAILABLE", note: "No live market-data provider is configured. A provider, its licence and a source allowlist need separate owner approval; until then every chart is HISTORICAL or SIMULATED and says so." },
      realMoneyTrading: { state: "NOT_AUTHORIZED", note: "Real-money trading, exchange accounts, transfers and live trading APIs are not available in this system." },
      datasets: ds, verdicts: verdicts(), paper: { ...rep, feeds: Object.fromEntries(Object.entries(f).map(([id, x]) => [id, { dataset: x.dataset, cursor: x.cursor, remaining: Math.max(0, (loadDs(x.dataset)?.count ?? 0) - x.cursor) }])) },
      paperAuditOk: t.auditVerify().ok, stopped: Boolean(isStopped()) };
  }
  function verdicts() { let names = []; try { names = fs.readdirSync(vDir).filter(n => n.endsWith(".json")); } catch { /* none */ } return names.map(n => readJson(path.join(vDir, n))).filter(v => v && v.recSha256 === recHash(v)).map(v => ({ dataset: v.dataset, instrument: v.instrument, kind: v.dataKind, status: v.status, evidenceSha256: v.evidenceSha256, configHash: v.configHash, reasons: v.reasons, at: v.at, statement: v.statement })); }

  /** Candles for the chart (last `limit`), opening-range levels, markers from a stored backtest or the paper trades, analytics. */
  function candles({ dataset, limit = 300, config = {}, markers = "backtest", strategy = null } = {}) {
    let ds = loadDs(dataset); if (!ds) return { ok: false, reason: "DATASET_NOT_FOUND" }; const n = normaliseConfig(config); if (!n.ok) return n;
    // A paper session only ever sees candles up to its feed cursor (including cursor 0 = nothing yet): the chart must not show the "future" of a session that is replaying a stored series.
    let replay = null;
    if (markers === "paper") { const fs2 = Object.values(feeds()).filter(f => f.dataset === dataset); if (fs2.length) { const cur = Math.max(...fs2.map(f => f.cursor)); replay = { cursor: cur, total: ds.count, note: "Paper session replaying stored data: candles after the cursor are not shown." }; if (cur < ds.count) { const cs0 = ds.candles.slice(0, cur); ds = { ...ds, candles: cs0, count: cs0.length, to: cs0.length ? cs0[cs0.length - 1].t : ds.from }; } } }
    const meta = { id: dataset, instrument: ds.instrument, interval: ds.interval, kind: ds.kind, source: ds.source, licence: ds.licence, sha256: ds.sha256, count: ds.count };
    if (!ds.candles.length) return { ok: true, empty: true, banner: `${ds.kind} - paper session has not received any candle yet`, dataset: meta, freshness: { label: ds.kind, ageMs: null }, replay, candles: [], levels: [], markers: [], markersSource: "none", config: n.config, analytics: null, anomalies: [] };
    const lim = Math.max(20, Math.min(1500, Number.isInteger(limit) ? limit : 300)), cs = ds.candles.slice(-lim), from = cs[0].t, fr = freshness(ds, nowFn()), mk = x => ({ side: x.side, entryT: x.entryT, exitT: x.exitT, entry: x.entry, exit: x.exit, r: x.r, pnl: x.pnl, reason: x.exitReason, simulated: true }); let marks = [], source = "none";
    if (markers === "paper") { marks = trader().report().trades.filter(x => x.instrument === ds.instrument && (!strategy || x.strategy === strategy)).map(mk).filter(x => x.exitT >= from && x.exitT <= ds.to + INTERVALS[ds.interval]); source = "paper trades (simulated)"; }
    else if (markers === "backtest") {
      const key = ds.sha256 + ":" + cfgHash(n.config); let b = btCache.get(key); if (!b) { b = runBacktest({ dataset: ds, config: n.config }); if (btCache.size >= 8) btCache.delete(btCache.keys().next().value); btCache.set(key, b); }
      if (b.ok) { marks = b.trades.map(mk).filter(x => x.exitT >= from); source = "backtest over the FULL stored series " + b.resultSha256.slice(0, 12) + " (not a live view)"; }
    }
    return { ok: true, banner: `${fr.label}${ds.kind === "SIMULATED" ? " - generated locally, NOT market data" : ""}${markers === "backtest" ? " - full stored series with backtest markers" : ""}`, dataset: meta, freshness: fr, replay, candles: cs, levels: orbLevels(ds, n.config).filter(l => l.close > from).slice(-8), config: n.config, markers: marks, markersSource: source, analytics: ds.candles.length >= 40 ? analyse(ds) : null, anomalies: ds.candles.length >= 120 ? detectAnomalies(ds).anomalies.slice(-10) : [] };
  }

  async function action({ op, ...a } = {}) {
    switch (op) {
      case "generate": {
        const id = need(a.id, "ID"); if (!ID.test(id)) throw new Error("ID_INVALID"); if (fs.existsSync(path.join(dsDir, id + ".json"))) throw new Error("ID_EXISTS");
        const days = Number.isInteger(a.days) ? a.days : 30; if (days < 1 || days > MAX_DAYS) throw new Error("DAYS_INVALID"); if (countDs() >= MAX_DATASETS) throw new Error("TOO_MANY_DATASETS"); { const per = Math.round(86_400_000 / (INTERVALS[a.interval ?? "5m"] ?? 0)); if (!Number.isFinite(per) || days * per > MAX_CANDLES) throw new Error("DATASET_TOO_LARGE_MAX_" + MAX_CANDLES + "_CANDLES"); } const r = generateSimulated({ instrument: a.instrument ?? "SIM-BTCUSD", interval: a.interval ?? "5m", seed: Number.isInteger(a.seed) ? a.seed : 1, days, drift: Number.isFinite(a.drift) ? a.drift : 0, volPct: Number.isFinite(a.volPct) ? a.volPct : 0.12, startPrice: Number.isFinite(a.startPrice) && a.startPrice > 0 ? a.startPrice : 100 });
        if (!r.ok) return r; save(id, r.dataset); return { ok: true, id, kind: r.dataset.kind, count: r.dataset.count, sha256: r.dataset.sha256, note: "SIMULATED data: generated locally with a seed; it says nothing about real markets." };
      }
      case "importCsv": {
        const id = need(a.id, "ID"); if (!ID.test(id)) throw new Error("ID_INVALID"); if (fs.existsSync(path.join(dsDir, id + ".json"))) throw new Error("ID_EXISTS"); if (typeof a.csv !== "string" || a.csv.length > MAX_CSV) throw new Error("CSV_TOO_LARGE"); if (countDs() >= MAX_DATASETS) throw new Error("TOO_MANY_DATASETS");
        if (!["HISTORICAL"].includes(a.kind)) throw new Error("ONLY_HISTORICAL_IMPORT_ALLOWED");      // imported files are recorded past data; LIVE/DELAYED need a provider connection, which does not exist here
        const p = parseCsv(a.csv, a.interval ?? "5m"); if (!p.ok) return p; const r = makeDataset({ instrument: need(a.instrument, "INSTRUMENT"), interval: a.interval ?? "5m", candles: p.candles, kind: "HISTORICAL", source: need(a.source, "SOURCE"), licence: need(a.licence, "LICENCE"), retrievedAt: new Date(nowFn()).toISOString(), assetClass: a.assetClass ?? "UNSPECIFIED" });
        if (!r.ok) return r; save(id, r.dataset); return { ok: true, id, kind: "HISTORICAL", count: r.dataset.count, sha256: r.dataset.sha256 };
      }
      case "deleteDataset": { const id = need(a.id, "ID"); if (!ID.test(id)) throw new Error("ID_INVALID"); if (Object.values(feeds()).some(f => f.dataset === id)) throw new Error("DATASET_IN_USE_BY_PAPER_FEED"); try { fs.unlinkSync(path.join(dsDir, id + ".json")); } catch { throw new Error("NOT_FOUND"); } cache.delete(id); return { ok: true }; }
      case "analyse": { const ds = loadDs(a.dataset); if (!ds) return { ok: false, reason: "DATASET_NOT_FOUND" }; return { ok: true, analytics: analyse(ds), anomalies: detectAnomalies(ds), freshness: freshness(ds, nowFn()), buyAndHold: buyAndHold(ds) }; }
      case "backtest": { const ds = loadDs(a.dataset); if (!ds) return { ok: false, reason: "DATASET_NOT_FOUND" }; const b = runBacktest({ dataset: ds, config: a.config ?? {}, startingEquity: Number.isFinite(a.startingEquity) ? a.startingEquity : 100_000 }); if (!b.ok) return b; return { ...b, trades: b.trades.slice(-200), label: ds.kind === "SIMULATED" ? "SIMULATED DATA - NOT A STATEMENT ABOUT REAL MARKETS" : "BACKTEST ON " + ds.kind + " DATA - NOT PROOF OF FUTURE PROFIT" }; }
      case "walkForward": { const ds = loadDs(a.dataset); if (!ds) return { ok: false, reason: "DATASET_NOT_FOUND" }; return walkForward({ dataset: ds, baseConfig: a.config ?? {} }); }
      case "evaluate": {
        const ds = loadDs(a.dataset); if (!ds) return { ok: false, reason: "DATASET_NOT_FOUND" }; const n = normaliseConfig(a.config ?? {}); if (!n.ok) return n; const ev = evaluateCandidate({ dataset: ds, config: n.config }); if (!ev.ok) return ev;
        const ch = cfgHash(n.config), rec = { dataset: a.dataset, datasetSha256: ds.sha256, instrument: ds.instrument, dataKind: ds.kind, configHash: ch, config: n.config, status: ev.status, evidenceSha256: ev.evidenceSha256, reasons: ev.reasons, statement: ev.statement, at: new Date(nowFn()).toISOString() }; rec.recSha256 = recHash(rec); writeJson(verdictFile(a.dataset, ch), rec);
        return { ...ev, configHash: ch, stored: true, note: "AI or agent agreement is not evidence of profitability; this verdict only gates SIMULATED paper trading." };
      }
      case "paperAdd": {
        const id = need(a.id, "ID"), ds = loadDs(a.dataset); if (!ds) return { ok: false, reason: "DATASET_NOT_FOUND" }; const n = normaliseConfig(a.config ?? {}); if (!n.ok) return n; const v = readJson(verdictFile(a.dataset, cfgHash(n.config)));
        const verdictOk = Boolean(v && v.recSha256 === recHash(v) && v.dataset === a.dataset && v.datasetSha256 === ds.sha256 && v.dataKind === ds.kind && v.configHash === cfgHash(n.config) && v.status !== "REJECTED");      // the verdict belongs to THIS data, of THIS kind, and THIS configuration
        const r = trader().addStrategy({ id, instrument: ds.instrument, interval: ds.interval, config: n.config, evaluation: verdictOk ? { status: v.status, evidenceSha256: v.evidenceSha256 } : null, dataKind: ds.kind, ownerOverride: !verdictOk && a.passphrase ? sign(a.passphrase, "PAPER_STRATEGY_OVERRIDE", "paper:" + id) : null });
        if (!r.ok) return r; const f = feeds(), start = Number.isInteger(a.startIndex) && a.startIndex >= 0 && a.startIndex < ds.count ? a.startIndex : 0; f[id] = { dataset: a.dataset, cursor: start }; writeJson(feedsFile, f); return { ok: true, id, basis: verdictOk ? "STORED_VERDICT " + v.status : "OWNER_OVERRIDE", feedStart: start };
      }
      case "paperTick": return tick({ candlesPerStrategy: Number.isInteger(a.candles) ? a.candles : 1 });
      case "paperStop": return trader().stopStrategy(need(a.id, "ID"));
      case "paperResume": { const id = need(a.id, "ID"), s = trader().resumeSubject(id); if (!s) throw new Error("NO_SUCH_STRATEGY"); need(a.passphrase, "PASSPHRASE"); return trader().resume(id, sign(a.passphrase, s.action, s.subject)); }
      case "paperReset": { need(a.passphrase, "PASSPHRASE"); const r = trader().reset(sign(a.passphrase, "PAPER_ACCOUNT_RESET", "paper:account")); if (r.ok) writeJson(feedsFile, {}); return r; }
      case "liveRequest": return trader().requestLiveTrading(String(a.why ?? "").slice(0, 120));
      default: throw new Error("UNKNOWN_TRADING_OP");
    }
  }

  /** Autonomous paper session step: every ACTIVE strategy receives its next stored candle(s). Called by the server's scheduler (no manual start needed) and by the owner's "step" button. */
  function tick({ candlesPerStrategy = 1 } = {}) {
    if (isStopped()) return { ok: false, reason: "OWNER_STOP_OR_SAFE_MODE_ACTIVE" }; const t = trader(), f = feeds(), n = Math.max(1, Math.min(500, candlesPerStrategy)), out = {}; let changed = false;
    for (const s of t.report().strategies) {
      const fd = f[s.id]; if (!fd) { out[s.id] = { skipped: "NO_FEED" }; continue; } const ds = loadDs(fd.dataset); if (!ds) { out[s.id] = { skipped: "DATASET_UNAVAILABLE" }; continue; }
      if (s.status !== "ACTIVE") { out[s.id] = { skipped: s.status }; continue; } let fed = 0;
      for (let i = 0; i < n && fd.cursor < ds.count; i++) { let r; try { r = t.onCandle(s.id, ds.candles[fd.cursor], { kind: ds.kind }); } catch (e) { r = { ok: false, reason: "STRATEGY_ERROR:" + String(e?.message ?? e).slice(0, 60) }; } if (!r.ok) { out[s.id] = { error: r.reason }; break; } fd.cursor++; fed++; changed = true; if (t.report().strategies.find(x => x.id === s.id)?.status !== "ACTIVE") break; }
      out[s.id] = { ...(out[s.id] ?? {}), fed, cursor: fd.cursor, ended: fd.cursor >= ds.count };
    }
    if (changed) writeJson(feedsFile, f); return { ok: true, strategies: out };
  }
  return { view, candles, action, tick, close: () => { pt = null; cache.clear(); }, KINDS };
}
