// Unified programme M6: market-data model for the research subsystem. Local only: this module never opens a network connection and has no live provider.
//   * Every dataset carries its provenance: kind LIVE | DELAYED | HISTORICAL | SIMULATED | UNAVAILABLE, a source string, a licence note and a content hash. A chart or a backtest cannot be built from data without a kind.
//   * SIMULATED data (the seeded generator below) is never described as market data. HISTORICAL data comes only from files/CSV the owner provides, with the licence statement the owner gives.
//   * Candles are validated (finite, consistent high/low, aligned, strictly increasing); a dataset with a defect is rejected, never silently repaired.
//   * Analytics: volume, volatility (stdev of returns, ATR), liquidity score, spread estimate (Corwin-Schultz from high/low), session tracking (New York, London, UTC) and robust anomaly detection.
import crypto from "node:crypto";

export const KINDS = Object.freeze(["LIVE", "DELAYED", "HISTORICAL", "SIMULATED", "UNAVAILABLE"]);
export const INTERVALS = Object.freeze({ "1m": 60_000, "5m": 300_000, "15m": 900_000 });
export const SESSIONS = Object.freeze({
  NEW_YORK: { tz: "America/New_York", hour: 9, minute: 30, lengthHours: 6.5, note: "US equity cash session" },
  LONDON: { tz: "Europe/London", hour: 8, minute: 0, lengthHours: 8.5, note: "London session" },
  UTC: { tz: "UTC", hour: 0, minute: 0, lengthHours: 24, note: "UTC day" },
  NY_CRYPTO: { tz: "America/New_York", hour: 9, minute: 30, lengthHours: 8, note: "crypto anchored on the New York open (market trades 24/7)" },
  UTC_ASIA: { tz: "UTC", hour: 0, minute: 0, lengthHours: 8, note: "crypto anchored on 00:00 UTC (24/7)" }
});
const sha = t => crypto.createHash("sha256").update(t).digest("hex");
const INSTR = /^[A-Z0-9][A-Z0-9._:-]{0,23}$/;

// ------------------------------------------------------------------ time and sessions (DST aware, no dependencies)
const FMT = new Map();
const partsIn = (ms, tz) => { let f = FMT.get(tz); if (!f) { f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); FMT.set(tz, f); } const o = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value; return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second }; };
const offsetMs = (ms, tz) => { const p = partsIn(ms, tz); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; };
/** The UTC instant at which the wall clock in tz shows hour:minute on the calendar day y-mo-d (the day is the LOCAL day). */
export function localToUtc(y, mo, d, hour, minute, tz) {
  const guess = Date.UTC(y, mo - 1, d, hour, minute); let t = guess - offsetMs(guess, tz); t = guess - offsetMs(t, tz); return t;
}
/** Session containing instant ms (or null): { key: "YYYY-MM-DD", open, close } using the session anchor (local calendar day of the open). */
const SESS_CACHE = new Map();
/** Memoised per 10-minute bucket (every session boundary is a multiple of 10 minutes), so a backtest does not pay for time-zone arithmetic on every candle. */
export function sessionFor(ms, anchor) {
  let m = SESS_CACHE.get(anchor); if (!m) { m = new Map(); SESS_CACHE.set(anchor, m); }
  const b = Math.floor(ms / 600_000); if (m.has(b)) return m.get(b);
  const r = sessionFor0(b * 600_000, anchor); if (m.size > 200_000) m.clear(); m.set(b, r); return r;
}
function sessionFor0(ms, anchor) {
  const s = SESSIONS[anchor]; if (!s) throw new Error("SESSION_UNKNOWN"); const lenMs = s.lengthHours * 3600_000;
  const p = partsIn(ms, s.tz);
  for (const dd of [0, -1]) {      // today's session, or yesterday's if it is still running (24 h sessions, late-evening opens)
    const base = new Date(Date.UTC(p.y, p.mo - 1, p.d + dd)); const open = localToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), s.hour, s.minute, s.tz);
    if (ms >= open && ms < open + lenMs) return { key: base.toISOString().slice(0, 10), open, close: open + lenMs };
  }
  return null;
}
export const weekday = (ms, tz) => { const p = partsIn(ms, tz); return new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay(); };
/** Is the session open at ms? Equity anchors skip weekends (US holidays are NOT modelled: a holiday simply has no candles and the day is reported as missing data). */
export function sessionState(ms, anchor) {
  const s = sessionFor(ms, anchor); if (!s) return { open: false }; const wd = weekday(s.open, SESSIONS[anchor].tz);
  if ((anchor === "NEW_YORK" || anchor === "LONDON") && (wd === 0 || wd === 6)) return { open: false, reason: "WEEKEND" };
  return { open: true, key: s.key, opensAt: s.open, closesAt: s.close };
}

// ------------------------------------------------------------------ validation and datasets
export function validateCandles(candles, interval) {
  const step = INTERVALS[interval]; if (!step) return { ok: false, reason: "INTERVAL_UNKNOWN" };
  if (!Array.isArray(candles) || !candles.length) return { ok: false, reason: "NO_CANDLES" };
  if (candles.length > 600_000) return { ok: false, reason: "TOO_MANY_CANDLES" };
  let prev = -Infinity;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]; if (!c || typeof c !== "object") return { ok: false, reason: "CANDLE_NOT_OBJECT", at: i };
    const { t, o, h, l, c: cl, v } = c;
    if (![t, o, h, l, cl, v].every(Number.isFinite)) return { ok: false, reason: "CANDLE_NOT_FINITE", at: i };
    if (!Number.isInteger(t) || t % step !== 0) return { ok: false, reason: "CANDLE_NOT_ALIGNED", at: i };
    if (t <= prev) return { ok: false, reason: "CANDLES_NOT_INCREASING", at: i };
    if (o <= 0 || h <= 0 || l <= 0 || cl <= 0 || v < 0) return { ok: false, reason: "CANDLE_NON_POSITIVE", at: i };
    if (h < Math.max(o, cl, l) || l > Math.min(o, cl, h)) return { ok: false, reason: "CANDLE_HIGH_LOW_INCONSISTENT", at: i };
    prev = t;
  }
  return { ok: true };
}
const canonical = candles => candles.map(c => [c.t, c.o, c.h, c.l, c.c, c.v].join(",")).join("\n");
/** Build a dataset. Provenance is mandatory; the returned object is frozen. */
export function makeDataset({ instrument, interval, candles, kind, source, licence = "", retrievedAt = null, assetClass = "UNSPECIFIED" } = {}) {
  if (typeof instrument !== "string" || !INSTR.test(instrument)) return { ok: false, reason: "INSTRUMENT_INVALID" };
  if (!KINDS.includes(kind) || kind === "UNAVAILABLE") return { ok: false, reason: "KIND_INVALID" };
  if (typeof source !== "string" || !source.trim() || source.length > 200) return { ok: false, reason: "SOURCE_REQUIRED" };
  if ((kind === "HISTORICAL" || kind === "LIVE" || kind === "DELAYED") && (typeof licence !== "string" || licence.trim().length < 3)) return { ok: false, reason: "LICENCE_STATEMENT_REQUIRED" };
  const v = validateCandles(candles, interval); if (!v.ok) return v;
  const copy = candles.map(c => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }));
  return { ok: true, dataset: Object.freeze({ instrument, interval, kind, source: source.slice(0, 200), licence: String(licence).slice(0, 300), assetClass, retrievedAt, count: copy.length, from: copy[0].t, to: copy[copy.length - 1].t, sha256: sha(instrument + "|" + interval + "|" + canonical(copy)), candles: Object.freeze(copy) }) };
}
/** Parse owner-provided CSV (header: time,open,high,low,close,volume; time = epoch ms, epoch seconds or ISO-8601). */
export function parseCsv(text, interval) {
  if (typeof text !== "string" || text.length > 40_000_000) return { ok: false, reason: "CSV_TOO_LARGE" };
  const lines = text.split(/\r?\n/).filter(x => x.trim()); if (lines.length < 2) return { ok: false, reason: "CSV_EMPTY" };
  const head = lines[0].toLowerCase().split(",").map(x => x.trim()); const idx = n => head.indexOf(n);
  const cols = ["time", "open", "high", "low", "close", "volume"].map(idx); if (cols.some(i => i < 0)) return { ok: false, reason: "CSV_HEADER_INVALID" };
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(",").map(x => x.trim()); let t = f[cols[0]]; let ms = /^\d+$/.test(t) ? Number(t) : Date.parse(t); if (/^\d+$/.test(t) && ms < 1e11) ms *= 1000;
    if (!Number.isFinite(ms)) return { ok: false, reason: "CSV_TIME_INVALID", line: i + 1 };
    out.push({ t: ms, o: Number(f[cols[1]]), h: Number(f[cols[2]]), l: Number(f[cols[3]]), c: Number(f[cols[4]]), v: Number(f[cols[5]]) });
  }
  const v = validateCandles(out, interval); return v.ok ? { ok: true, candles: out } : v;
}

// ------------------------------------------------------------------ seeded synthetic generator (SIMULATED, never market data)
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = rnd => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
export const prng = mulberry32;
/** Random-walk candles with volatility clustering and an intraday volume shape. `drift` per candle (default 0: no edge). Output is labelled SIMULATED. */
export function generateSimulated({ instrument = "SIM-BTCUSD", interval = "5m", seed = 1, days = 30, startUtc = Date.UTC(2026, 0, 5), startPrice = 100, drift = 0, volPct = 0.12, anchor = "UTC" } = {}) {
  const step = INTERVALS[interval]; if (!step) return { ok: false, reason: "INTERVAL_UNKNOWN" }; if (!Number.isInteger(days) || days < 1 || days > 400) return { ok: false, reason: "DAYS_INVALID" };
  const rnd = mulberry32(seed >>> 0), per = Math.round(86_400_000 / step), out = []; let p = startPrice, vol = volPct / 100;
  const t0 = Math.floor(startUtc / 86_400_000) * 86_400_000;
  for (let i = 0; i < days * per; i++) {
    const t = t0 + i * step, hod = ((t % 86_400_000) / 3_600_000);
    vol = Math.max(0.02 / 100, Math.min(0.6 / 100, 0.94 * vol + 0.06 * (volPct / 100) + 0.02 * Math.abs(gauss(rnd)) * (volPct / 100)));
    const shape = 0.6 + 0.8 * Math.exp(-((hod - 13.5) ** 2) / 8) + 0.5 * Math.exp(-((hod - 8) ** 2) / 6);
    const o = p, r = drift + vol * shape * gauss(rnd), cl = o * Math.exp(r), wick = vol * shape * 0.6;
    const h = Math.max(o, cl) * (1 + Math.abs(gauss(rnd)) * wick), l = Math.min(o, cl) * (1 - Math.abs(gauss(rnd)) * wick);
    const v = Math.round(1000 * shape * (0.7 + rnd() * 0.8) * (1 + 40 * Math.abs(r)));
    out.push({ t, o: +o.toFixed(6), h: +h.toFixed(6), l: +l.toFixed(6), c: +cl.toFixed(6), v }); p = +cl.toFixed(6);
  }
  return makeDataset({ instrument, interval, candles: out, kind: "SIMULATED", source: `ATLASZ_SYNTHETIC_GENERATOR seed=${seed} drift=${drift} vol=${volPct}% (NOT market data)`, licence: "generated locally", assetClass: "SYNTHETIC" });
}

// ------------------------------------------------------------------ analytics
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const stdev = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
export function atr(candles, n = 14) { const tr = []; for (let i = 1; i < candles.length; i++) { const c = candles[i], p = candles[i - 1]; tr.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c))); } return tr.slice(-n).length ? mean(tr.slice(-n)) : null; }
/** Corwin-Schultz (2012) high-low spread estimator, as a fraction of price. An ESTIMATE from candles, not a quoted spread. */
export function spreadEstimate(candles) {
  const s = []; for (let i = 1; i < candles.length; i++) {
    const a = candles[i - 1], b = candles[i]; const beta = Math.log(a.h / a.l) ** 2 + Math.log(b.h / b.l) ** 2, gamma = Math.log(Math.max(a.h, b.h) / Math.min(a.l, b.l)) ** 2;
    const alpha = (Math.SQRT2 - 1) * Math.sqrt(beta) / (3 - 2 * Math.SQRT2) - Math.sqrt(gamma / (3 - 2 * Math.SQRT2)); const sp = 2 * (Math.exp(alpha) - 1) / (1 + Math.exp(alpha)); s.push(Math.max(0, sp));
  } return s.length ? median(s) : null;
}
export function analyse(ds, { window = 288 } = {}) {
  const c = ds.candles.slice(-Math.max(20, window)); const rets = []; for (let i = 1; i < c.length; i++) rets.push(Math.log(c[i].c / c[i - 1].c));
  const dollarVol = c.map(x => x.v * x.c), last = c[c.length - 1], sp = spreadEstimate(c), vol = stdev(rets);
  const amihud = mean(rets.map((r, i) => (dollarVol[i + 1] > 0 ? Math.abs(r) / dollarVol[i + 1] : 0)));
  return { instrument: ds.instrument, kind: ds.kind, source: ds.source, candles: c.length, last: { t: last.t, close: last.c }, volume: { mean: mean(c.map(x => x.v)), last: last.v, relative: mean(c.map(x => x.v)) ? last.v / mean(c.map(x => x.v)) : null },
    volatility: { stdevPerCandle: vol, annualisedPct: vol * Math.sqrt((365 * 86_400_000) / INTERVALS[ds.interval]) * 100, atr14: atr(c, 14), atr14Pct: atr(c, 14) ? atr(c, 14) / last.c * 100 : null },
    liquidity: { meanDollarVolume: mean(dollarVol), amihudIlliquidity: amihud, score: amihud > 0 ? +(1 / (1 + amihud * 1e6)).toFixed(4) : null, note: "relative score from candles; not order-book depth" },
    spread: { estimatePct: sp === null ? null : sp * 100, method: "Corwin-Schultz high-low estimator (estimate, not a quote)" } };
}
/** Robust anomaly detection: returns, ranges and volume compared with the median/MAD of the trailing window. Reports candles, never fabricates a cause. */
export function detectAnomalies(ds, { lookback = 96, threshold = 6 } = {}) {
  const c = ds.candles, out = [];
  for (let i = Math.max(lookback, 2); i < c.length; i++) {
    const w = c.slice(i - lookback, i), rets = w.map((x, j) => (j ? Math.log(x.c / w[j - 1].c) : 0)).slice(1), rng = w.map(x => (x.h - x.l) / x.c), vols = w.map(x => x.v);
    const z = (val, arr) => { const m = median(arr), mad = median(arr.map(x => Math.abs(x - m))) * 1.4826 || 1e-12; return (val - m) / mad; };
    const r = Math.log(c[i].c / c[i - 1].c), zr = z(r, rets), zg = z((c[i].h - c[i].l) / c[i].c, rng), zv = z(c[i].v, vols), flags = [];
    if (Math.abs(zr) >= threshold) flags.push("RETURN"); if (zg >= threshold) flags.push("RANGE"); if (zv >= threshold * 1.5) flags.push("VOLUME");
    if (flags.length) out.push({ t: c[i].t, flags, zReturn: +zr.toFixed(2), zRange: +zg.toFixed(2), zVolume: +zv.toFixed(2) });
  }
  return { ok: true, count: out.length, anomalies: out.slice(-200), method: `median/MAD z-score >= ${threshold} over ${lookback} candles` };
}
/** Data freshness label for a dataset at time `now`: LIVE data older than 2 intervals is reported as DELAYED; nothing is ever reported fresher than it is. */
export function freshness(ds, now = Date.now()) {
  if (!ds) return { label: "UNAVAILABLE", ageMs: null };
  const age = now - (ds.to + INTERVALS[ds.interval]);
  if (ds.kind === "LIVE") return { label: age <= 2 * INTERVALS[ds.interval] ? "LIVE" : "DELAYED", ageMs: age };
  return { label: ds.kind, ageMs: age };
}
