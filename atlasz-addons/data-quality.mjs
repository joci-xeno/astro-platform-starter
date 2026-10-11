// Data-quality monitor (PKG150 HK15) and bidirectional sync consistency check (S509). Deterministic, offline, READ-ONLY on the stores it inspects.
//   loadStore            JSON (array / {records|items|data:[...]} / object map), JSONL/NDJSON and CSV (own RFC-4180 parser) with byte, record and line caps; malformed rows are counted with line numbers.
//   checkStore           duplicate / missing keys, null rates (and null SPIKES against a baseline), schema drift against a baseline (field added / removed / type changed), mixed types,
//                        numeric outliers (robust z-score on median and MAD), stale files (mtime older than staleAfterMs). Every finding carries evidence (field, rows, values).
//   baselineFrom         turns a checkStore result into the baseline the next run compares against (the caller stores it; this module writes nothing).
//   checkAuditChain      verifies a hash-chained JSONL audit file with audit-chain.mjs verifyChain (read through the confined reader; a corrupt middle line is reported, never skipped).
//   runQualityMonitor    one monitor pass over several stores and chains: a plain function, no timers. registerQualityJobs wires it to scheduler.mjs as a READ_STATUS typed tool + INTERVAL jobs.
//   checkSyncConsistency compares two stores record by record (optionally against a common ancestor): one-sided changes become PROPOSED propagations, two-sided changes are CONFLICTS with a
//                        rule-based PROPOSAL (last writer / A wins / B wins / manual). Nothing is ever applied: resolutionApplied is always false, ties and suspicious clocks need the owner.
// Honest limits: types are inferred from values (CSV numbers are parsed, everything else is text); outlier detection assumes a roughly unimodal field; "no issues" means none by these rules.
import { readConfined, clean, canonical, sha256, W2_STATUS } from "./dev-assist-common.mjs";
import { verifyChain } from "./audit-chain.mjs";

export const LIMITS = Object.freeze({ maxStoreBytes: 16 * 1048576, maxRecords: 200000, maxFields: 500, maxLineChars: 1048576, maxEvidence: 50, maxStores: 100, maxChainBytes: 32 * 1048576 });
export const DEFAULT_THRESHOLDS = Object.freeze({ nullSpikeDelta: 0.2, nullRateMax: 0.5, outlierZ: 3.5, outlierMinN: 10, mixedTypeMin: 0.05, maxOutliersPerField: 20 });
export const STATUS = Object.freeze({ ...W2_STATUS, schedulerAdapter: "registerQualityJobs (typed tool + INTERVAL jobs), unit-tested with the real scheduler and tool registry" });
const typeOf = v => v === null || v === undefined ? "null" : Array.isArray(v) ? "array" : typeof v;

/** RFC-4180-ish CSV: quoted fields, doubled quotes, CRLF, embedded newlines. Bounded. */
export function parseCsv(text, { maxRecords = LIMITS.maxRecords } = {}) {
  const rows = [], lines = []; let row = [], f = "", q = false, line = 1, rowLine = 1, truncated = false, unterminated = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else { if (c === "\n") line++; f += c; } continue; }
    if (c === '"' && f === "") { q = true; continue; }
    if (c === ",") { row.push(f); f = ""; continue; }
    if (c === "\r" && text[i + 1] === "\n") continue;
    if (c === "\n") { row.push(f); f = ""; if (!(row.length === 1 && row[0] === "")) { rows.push(row); lines.push(rowLine); } row = []; line++; rowLine = line; if (rows.length > maxRecords) { truncated = true; break; } continue; }
    f += c;
  }
  if (q) unterminated = true;
  if (!truncated && (f !== "" || row.length)) { row.push(f); rows.push(row); lines.push(rowLine); }
  return { rows, lines, truncated, unterminated };
}
const csvValue = v => v === "" ? null : /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(v.trim()) && v.trim().length < 20 ? Number(v) : v;

/** Load a confined store file into records. */
export function loadStore({ root, file, maxBytes = LIMITS.maxStoreBytes } = {}) {
  const r = readConfined(root, file, Math.min(maxBytes, LIMITS.maxStoreBytes)); if (!r.ok) return r;
  const malformed = [], issues = []; let records = [], truncated = false, format;
  if (/\.json$/i.test(r.rel)) {
    format = "json"; let j;
    try { j = JSON.parse(r.text); } catch (e) { return { ok: false, reason: "JSON_INVALID", detail: clean(e.message).slice(0, 120) }; }
    if (Array.isArray(j)) records = j;
    else if (j && typeof j === "object") { const arr = ["records", "items", "data", "rows"].find(k => Array.isArray(j[k])); if (arr) records = j[arr]; else if (Object.values(j).every(v => v && typeof v === "object" && !Array.isArray(v))) records = Object.entries(j).map(([k, v]) => ({ _key: k, ...v })); else return { ok: false, reason: "JSON_SHAPE_UNSUPPORTED" }; }
    else return { ok: false, reason: "JSON_SHAPE_UNSUPPORTED" };
    const objs = []; records.forEach((x, i) => { if (x && typeof x === "object" && !Array.isArray(x)) objs.push(x); else malformed.push({ row: i, reason: "NOT_AN_OBJECT" }); }); records = objs;
  } else if (/\.(jsonl|ndjson)$/i.test(r.rel)) {
    format = "jsonl"; const ls = r.text.split("\n");
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i]; if (!l.trim()) continue;
      if (records.length >= LIMITS.maxRecords) { truncated = true; break; }
      if (l.length > LIMITS.maxLineChars) { malformed.push({ line: i + 1, reason: "LINE_TOO_LONG" }); continue; }
      try { const o = JSON.parse(l); if (o && typeof o === "object" && !Array.isArray(o)) records.push(o); else malformed.push({ line: i + 1, reason: "NOT_AN_OBJECT" }); } catch { malformed.push({ line: i + 1, reason: "JSON_INVALID" }); }
    }
  } else if (/\.csv$/i.test(r.rel)) {
    format = "csv"; const p = parseCsv(r.text); truncated = p.truncated; if (p.unterminated) issues.push({ kind: "CSV_UNTERMINATED_QUOTE" });
    if (!p.rows.length) return { ok: true, file: r.rel, format, records: [], malformed, issues, truncated, mtimeMs: r.mtimeMs, sha256: r.sha256, bytes: r.bytes };
    const header = p.rows[0].map(h => h.trim());
    const dupH = header.filter((h, i) => header.indexOf(h) !== i); if (dupH.length) issues.push({ kind: "DUPLICATE_HEADER", fields: [...new Set(dupH)].slice(0, 20) });
    if (header.length > LIMITS.maxFields) return { ok: false, reason: "TOO_MANY_FIELDS" };
    for (let i = 1; i < p.rows.length && records.length < LIMITS.maxRecords; i++) {
      const row = p.rows[i]; if (row.length !== header.length) { malformed.push({ line: p.lines[i], reason: "COLUMN_COUNT_" + row.length + "_EXPECTED_" + header.length }); continue; }
      const o = {}; header.forEach((h, k) => { o[h] = csvValue(row[k]); }); records.push(o);
    }
  } else return { ok: false, reason: "UNSUPPORTED_STORE_FORMAT" };
  if (records.length > LIMITS.maxRecords) { records = records.slice(0, LIMITS.maxRecords); truncated = true; }
  return { ok: true, file: r.rel, format, records, malformed, issues, truncated, mtimeMs: r.mtimeMs, sha256: r.sha256, bytes: r.bytes };
}

const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
/** Field profile: counts, nulls, type mix, numeric stats. */
export function profileRecords(records) {
  const fields = new Map(), total = records.length;
  for (const r of records) for (const k of Object.keys(r)) { if (!fields.has(k)) { if (fields.size >= LIMITS.maxFields) continue; fields.set(k, { present: 0, nulls: 0, types: {}, nums: [] }); } const f = fields.get(k), v = r[k], t = typeOf(v); f.present++; if (t === "null") f.nulls++; else { f.types[t] = (f.types[t] ?? 0) + 1; if (t === "number" && Number.isFinite(v)) f.nums.push(v); } }
  const out = {};
  for (const [k, f] of [...fields].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const nonNull = f.present - f.nulls, dominant = Object.entries(f.types).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? "null";
    let numeric = null; if (f.nums.length) { const md = median(f.nums), mad = median(f.nums.map(x => Math.abs(x - md))); let mn = Infinity, mx = -Infinity; for (const x of f.nums) { if (x < mn) mn = x; if (x > mx) mx = x; } numeric = { n: f.nums.length, min: mn, max: mx, median: md, mad }; }
    out[k] = { present: f.present, nulls: f.nulls, missing: total - f.present, nullRate: total ? +((f.nulls + total - f.present) / total).toFixed(4) : 0, types: f.types, dominantType: dominant, nonNull, numeric };
  }
  return { total, fields: out };
}

/** Quality findings for one store. Read-only. */
export function checkStore({ root, file, key = null, baseline = null, staleAfterMs = null, now = Date.now(), thresholds = {}, maxBytes } = {}) {
  const T = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const s = loadStore({ root, file, maxBytes }); if (!s.ok) return { ok: false, file: clean(file), reason: s.reason, detail: s.detail };
  const findings = [], add = (sev, kind, evidence) => findings.push({ severity: sev, kind, file: s.file, ...evidence });
  if (s.malformed.length) add("HIGH", "MALFORMED_ROWS", { count: s.malformed.length, examples: s.malformed.slice(0, LIMITS.maxEvidence) });
  for (const i of s.issues) add("MEDIUM", i.kind, { fields: i.fields ?? null });
  if (s.truncated) add("MEDIUM", "STORE_TRUNCATED_AT_LIMIT", { maxRecords: LIMITS.maxRecords });
  const prof = profileRecords(s.records);
  if (key !== null) {
    if (typeof key !== "string" || !key) return { ok: false, reason: "KEY_INVALID" };
    const seen = new Map(), missing = [];
    s.records.forEach((r, i) => { const v = r[key]; if (v === null || v === undefined || v === "") { missing.push(i); return; } const k = typeOf(v) + ":" + String(v); if (!seen.has(k)) seen.set(k, []); seen.get(k).push(i); });
    const dups = [...seen].filter(([, rows]) => rows.length > 1);
    if (dups.length) add("HIGH", "DUPLICATE_KEY", { key, count: dups.length, examples: dups.slice(0, LIMITS.maxEvidence).map(([k, rows]) => ({ value: clean(k.slice(k.indexOf(":") + 1)), rows: rows.slice(0, 10) })) });
    if (missing.length) add("HIGH", "MISSING_KEY", { key, count: missing.length, rows: missing.slice(0, LIMITS.maxEvidence) });
  }
  const base = baseline?.fields ?? null;
  for (const [name, f] of Object.entries(prof.fields)) {
    const nm = clean(name);
    if (base && base[name]) { const d = f.nullRate - base[name].nullRate; if (d > T.nullSpikeDelta) add("HIGH", "NULL_SPIKE", { field: nm, nullRate: f.nullRate, baselineNullRate: base[name].nullRate, delta: +d.toFixed(4) }); if (base[name].dominantType !== "null" && f.dominantType !== "null" && base[name].dominantType !== f.dominantType) add("HIGH", "SCHEMA_TYPE_CHANGED", { field: nm, from: base[name].dominantType, to: f.dominantType }); }
    else if (base) add("MEDIUM", "SCHEMA_FIELD_ADDED", { field: nm, nullRate: f.nullRate });
    else if (f.nullRate > T.nullRateMax && prof.total >= 4) add("LOW", "HIGH_NULL_RATE", { field: nm, nullRate: f.nullRate });
    const nonNull = f.nonNull, mix = Object.entries(f.types).filter(([, n]) => nonNull && n / nonNull >= T.mixedTypeMin);
    if (mix.length > 1) add("MEDIUM", "MIXED_TYPES", { field: nm, types: Object.fromEntries(mix) });
    if (f.numeric && f.numeric.n >= T.outlierMinN && f.numeric.mad > 0) {
      const out = []; s.records.forEach((r, i) => { const v = r[name]; if (typeof v === "number" && Number.isFinite(v)) { const z = 0.6745 * (v - f.numeric.median) / f.numeric.mad; if (Math.abs(z) > T.outlierZ && out.length < T.maxOutliersPerField) out.push({ row: i, value: v, robustZ: +z.toFixed(2) }); } });
      if (out.length) add("MEDIUM", "NUMERIC_OUTLIERS", { field: nm, median: f.numeric.median, mad: f.numeric.mad, outliers: out });
    }
  }
  if (base) for (const [name, bf] of Object.entries(base)) if (!prof.fields[name] && bf.nullRate < 1) add("HIGH", "SCHEMA_FIELD_REMOVED", { field: clean(name), baselineNullRate: bf.nullRate });
  if (Number.isFinite(staleAfterMs) && staleAfterMs > 0 && now - s.mtimeMs > staleAfterMs) add("MEDIUM", "STALE_FILE", { ageMs: Math.round(now - s.mtimeMs), staleAfterMs, modifiedAt: new Date(s.mtimeMs).toISOString() });
  return { ok: true, file: s.file, format: s.format, records: s.records.length, sha256: s.sha256, profile: prof, findings };
}

/** The baseline the next run compares against (returned to the caller; nothing is written). */
export function baselineFrom(result, { at = new Date().toISOString() } = {}) {
  if (!result?.ok || !result.profile) return { ok: false, reason: "CHECK_RESULT_REQUIRED" };
  return { ok: true, file: result.file, at, records: result.records, sha256: result.sha256, fields: Object.fromEntries(Object.entries(result.profile.fields).map(([k, f]) => [k, { nullRate: f.nullRate, dominantType: f.dominantType }])) };
}

/** Verify a hash-chained audit JSONL file (audit-chain.mjs format). Read-only. */
export function checkAuditChain({ root, file } = {}) {
  const r = readConfined(root, file, LIMITS.maxChainBytes); if (!r.ok) return { ok: false, file: clean(file), reason: r.reason };
  const lines = r.text.split("\n"), entries = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    try { entries.push(JSON.parse(lines[i])); } catch { const lastTorn = i === lines.length - 1 && !r.text.endsWith("\n"); if (lastTorn) { const v = verifyChain(entries); return { ok: true, file: r.rel, intact: v.ok, length: entries.length, tornTail: true, ...(v.ok ? { head: v.head } : { reason: v.reason, brokenAt: v.brokenAt }) }; } return { ok: true, file: r.rel, intact: false, reason: "CORRUPT_LINE", brokenAt: entries.length + 1, line: i + 1 }; }
  }
  const v = verifyChain(entries);
  return { ok: true, file: r.rel, intact: v.ok, length: entries.length, ...(v.ok ? { head: v.head } : { reason: v.reason, brokenAt: v.brokenAt }) };
}

/** One monitor pass. Plain function, no timers: safe to call from a scheduler job. */
export function runQualityMonitor({ root, stores = [], auditChains = [], now = Date.now(), thresholds = {} } = {}) {
  if (!Array.isArray(stores) || !Array.isArray(auditChains) || stores.length + auditChains.length > LIMITS.maxStores) return { ok: false, reason: "MONITOR_CONFIG_INVALID" };
  const results = stores.map(s => checkStore({ root, file: s?.file, key: s?.key ?? null, baseline: s?.baseline ?? null, staleAfterMs: s?.staleAfterMs ?? null, now, thresholds }));
  const chains = auditChains.map(f => checkAuditChain({ root, file: f }));
  const sev = { HIGH: 0, MEDIUM: 0, LOW: 0 }; for (const r of results) for (const f of r.findings ?? []) sev[f.severity]++;
  for (const c of chains) if (c.ok && !c.intact) sev.HIGH++;
  const failed = results.filter(r => !r.ok).length + chains.filter(c => !c.ok).length;
  return { ok: true, checkedAt: new Date(now).toISOString(), verdict: failed ? "INCOMPLETE_SOME_STORES_UNREADABLE" : sev.HIGH + sev.MEDIUM + sev.LOW ? "ISSUES_FOUND" : "NO_ISSUES_BY_THESE_RULES", severity: sev, unreadable: failed, results: results.map(r => r.ok ? { file: r.file, records: r.records, sha256: r.sha256, findings: r.findings } : r), chains };
}

/** Scheduler adapter: one READ_STATUS typed tool + one INTERVAL job per configured store set. Store folders come from this configuration, never from job arguments. */
export function registerQualityJobs({ registry, scheduler, stores, everyMs = 3600000, toolName = "data_quality.scan", now = () => Date.now() } = {}) {
  if (!registry || typeof registry.register !== "function" || !scheduler || typeof scheduler.create !== "function") return { ok: false, reason: "REGISTRY_AND_SCHEDULER_REQUIRED" };
  const ids = Object.keys(stores ?? {}); if (!ids.length || ids.length > LIMITS.maxStores || ids.some(id => !/^[a-z][a-z0-9_-]{0,40}$/.test(id))) return { ok: false, reason: "STORES_CONFIG_INVALID" };
  const last = new Map();
  if (!(registry.has?.(toolName))) registry.register({ name: toolName, operation: "READ_STATUS", description: "Read-only data-quality pass over a configured store set", input: { type: "object", required: ["storeId"], properties: { storeId: { type: "string", enum: ids } } }, timeoutMs: 60000,
    handler: ({ storeId }) => { const c = stores[storeId]; if (!c) throw new Error("UNKNOWN_STORE"); const rep = runQualityMonitor({ root: c.root, stores: c.files ?? [], auditChains: c.auditChains ?? [], now: now(), thresholds: c.thresholds ?? {} }); last.set(storeId, rep); return { verdict: rep.verdict ?? rep.reason, severity: rep.severity ?? null, unreadable: rep.unreadable ?? null }; } });
  const jobs = ids.map(id => scheduler.create({ name: "data-quality:" + id, kind: "INTERVAL", spec: { everyMs }, tool: toolName, args: { storeId: id } }).id);
  return { ok: true, tool: toolName, jobs, lastReport: id => last.get(id) ?? null };
}

const parseTs = v => { const t = typeof v === "number" ? v : Date.parse(String(v ?? "")); return Number.isFinite(t) ? t : null; };
function indexBy(records, key) { const m = new Map(), dup = new Set(); for (const r of records) { const v = r[key]; if (v === null || v === undefined || v === "") continue; const k = String(v); if (m.has(k)) dup.add(k); else m.set(k, r); } return { m, dup }; }
const same = (x, y) => canonical(x) === canonical(y);
const diffFields = (x, y) => [...new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})])].filter(k => canonical(x?.[k] ?? null) !== canonical(y?.[k] ?? null)).sort();

/** Bidirectional consistency check between two stores. Proposes, never applies. */
export function checkSyncConsistency({ a, b, base = null, key, updatedAtField = "updatedAt", rule = "LAST_WRITER_WINS", now = Date.now(), maxFutureSkewMs = 300000 } = {}) {
  if (typeof key !== "string" || !key) return { ok: false, reason: "KEY_REQUIRED" };
  if (!["LAST_WRITER_WINS", "A_WINS", "B_WINS", "MANUAL"].includes(rule)) return { ok: false, reason: "RULE_INVALID" };
  const A = loadStore(a ?? {}); if (!A.ok) return { ok: false, reason: "A_" + A.reason };
  const B = loadStore(b ?? {}); if (!B.ok) return { ok: false, reason: "B_" + B.reason };
  let O = null; if (base) { O = loadStore(base); if (!O.ok) return { ok: false, reason: "BASE_" + O.reason }; }
  const ia = indexBy(A.records, key), ib = indexBy(B.records, key), io = O ? indexBy(O.records, key) : null;
  const ambiguous = [...new Set([...ia.dup, ...ib.dup, ...(io?.dup ?? [])])].sort();
  const keys = [...new Set([...ia.m.keys(), ...ib.m.keys(), ...(io ? io.m.keys() : [])])].filter(k => !ambiguous.includes(k)).sort();
  const conflicts = [], propagations = []; let identical = 0;
  const propose = (k, ra, rb) => {
    const ta = parseTs(ra?.[updatedAtField]), tb = parseTs(rb?.[updatedAtField]);
    if (rule === "MANUAL") return { rule, winner: null, reason: "MANUAL_RULE" };
    if (rule === "A_WINS") return { rule, winner: "A", reason: "A_WINS_RULE" };
    if (rule === "B_WINS") return { rule, winner: "B", reason: "B_WINS_RULE" };
    if (ta === null || tb === null) return { rule, winner: null, reason: "NEEDS_OWNER_DECISION:TIMESTAMP_MISSING_OR_INVALID" };
    if (ta > now + maxFutureSkewMs || tb > now + maxFutureSkewMs) return { rule, winner: null, reason: "NEEDS_OWNER_DECISION:TIMESTAMP_IN_FUTURE" };
    if (ta === tb) return { rule, winner: null, reason: "NEEDS_OWNER_DECISION:TIMESTAMP_TIE" };
    return { rule, winner: ta > tb ? "A" : "B", reason: "LATER_" + updatedAtField };
  };
  for (const k of keys) {
    const ra = ia.m.get(k), rb = ib.m.get(k), ro = io?.m.get(k);
    if (ra && rb && same(ra, rb)) { identical++; continue; }
    if (io) {
      const aCh = !same(ra ?? null, ro ?? null), bCh = !same(rb ?? null, ro ?? null);
      if (aCh && !bCh) { propagations.push({ key: clean(k), direction: "A_TO_B", change: !ra ? "DELETE" : !ro ? "CREATE" : "UPDATE", fields: diffFields(ro, ra) }); continue; }
      if (bCh && !aCh) { propagations.push({ key: clean(k), direction: "B_TO_A", change: !rb ? "DELETE" : !ro ? "CREATE" : "UPDATE", fields: diffFields(ro, rb) }); continue; }
      conflicts.push({ key: clean(k), type: !ra || !rb ? "DELETE_VS_UPDATE" : "BOTH_CHANGED", fields: diffFields(ra, rb), a: ra ? { [updatedAtField]: ra[updatedAtField] ?? null } : null, b: rb ? { [updatedAtField]: rb[updatedAtField] ?? null } : null, proposal: ra && rb ? propose(k, ra, rb) : { rule, winner: null, reason: "NEEDS_OWNER_DECISION:DELETE_VS_UPDATE" }, autoResolved: false });
      continue;
    }
    if (!ra || !rb) { conflicts.push({ key: clean(k), type: ra ? "ONLY_IN_A" : "ONLY_IN_B", fields: [], proposal: { rule, winner: null, reason: "NEEDS_OWNER_DECISION:NO_COMMON_ANCESTOR_CANNOT_TELL_CREATE_FROM_DELETE" }, autoResolved: false }); continue; }
    conflicts.push({ key: clean(k), type: "DIFFERENT_VALUES", fields: diffFields(ra, rb), a: { [updatedAtField]: ra[updatedAtField] ?? null }, b: { [updatedAtField]: rb[updatedAtField] ?? null }, proposal: propose(k, ra, rb), autoResolved: false });
  }
  const counts = { keys: keys.length, identical, propagations: propagations.length, conflicts: conflicts.length, ambiguousKeys: ambiguous.length, needsOwner: conflicts.filter(c => c.proposal.winner === null).length };
  return { ok: true, consistent: !conflicts.length && !propagations.length && !ambiguous.length && !A.malformed.length && !B.malformed.length, counts, conflicts, propagations, ambiguousKeys: ambiguous.map(clean).slice(0, 200),
    malformed: { a: A.malformed.length, b: B.malformed.length }, hashes: { a: A.sha256, b: B.sha256, base: O?.sha256 ?? null }, reportSha256: sha256(canonical({ conflicts, propagations, ambiguous })), resolutionApplied: false,
    note: "Proposals only. Nothing was written to either store; a person (or an owner-approved job) applies the chosen resolution." };
}
