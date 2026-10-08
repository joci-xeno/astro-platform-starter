// Advanced Analyst Mode (85-capability programme: M07; used by GE07). Deterministic, dependency-free data analysis: CSV in -> profile -> logged cleaning -> statistics ->
// chart specs -> a reproducible report. Same input + same steps => byte-identical report (hash proves it); there is no clock, randomness or network in here.
// Security: CSV cells that start with = + - @ are neutralised on EXPORT (spreadsheet formula injection); sizes are capped; nothing is executed.
import crypto from "node:crypto";

export const LIMITS = Object.freeze({ maxBytes: 2_000_000, maxRows: 20000, maxCols: 100, maxCategories: 50 });
const sha = s => crypto.createHash("sha256").update(s).digest("hex");

export function parseCsv(text, { delimiter = "," } = {}) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "CSV_REQUIRED" };
  if (Buffer.byteLength(text) > LIMITS.maxBytes) return { ok: false, reason: "CSV_TOO_LARGE" };
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"' && cell === "") q = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; rows.push(row); row = []; if (rows.length > LIMITS.maxRows + 1) return { ok: false, reason: "TOO_MANY_ROWS" }; }
    else cell += ch;
  }
  if (q) return { ok: false, reason: "UNTERMINATED_QUOTE" };
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && rows.at(-1).every(c => c === "")) rows.pop();
  if (rows.length < 1) return { ok: false, reason: "CSV_EMPTY" };
  const headers = rows[0].map(h => h.trim());
  if (headers.length > LIMITS.maxCols) return { ok: false, reason: "TOO_MANY_COLUMNS" };
  if (new Set(headers).size !== headers.length || headers.some(h => !h)) return { ok: false, reason: "HEADERS_INVALID" };
  const body = rows.slice(1); if (body.some(r => r.length !== headers.length)) return { ok: false, reason: "RAGGED_ROWS", line: body.findIndex(r => r.length !== headers.length) + 2 };
  return { ok: true, headers, rows: body, inputHash: sha(text) };
}
export function toCsv(headers, rows) {
  const esc = v => { let s = v === null || v === undefined ? "" : String(v); if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;   // neutralise formula injection (plain negative numbers are left alone)
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [headers, ...rows].map(r => r.map(esc).join(",")).join("\n") + "\n";
}
const isNum = v => Number.isFinite(Number(v)) && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(String(v).trim());
const isDate = v => { const t = String(v).trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false; const d = new Date(t + "T00:00:00Z"); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t; };   // round trip: rejects 2024-02-30
export function profile({ headers, rows }) {
  return headers.map((h, c) => {
    const vals = rows.map(r => r[c]), present = vals.filter(v => v !== null && String(v).trim() !== ""), missing = vals.length - present.length;
    let type = "string"; if (present.length) { if (present.every(isNum)) type = present.every(v => /^[-+]?\d+$/.test(String(v).trim())) ? "integer" : "number"; else if (present.every(isDate)) type = "date"; else if (present.every(v => /^(true|false)$/i.test(String(v).trim()))) type = "boolean"; }
    return { column: h, type, count: vals.length, missing, unique: new Set(present.map(v => String(v).trim())).size };
  });
}
/** ops: [{op:'trim'}|{op:'dropEmptyRows'}|{op:'dropDuplicates'}|{op:'fillMissing',column,value|strategy:'mean'|'median'}|{op:'toNumber',column}] -> {headers,rows,log} */
export function clean(data, ops = []) {
  let { headers, rows } = data; rows = rows.map(r => r.slice()); const log = [];
  const col = name => { const i = headers.indexOf(name); if (i < 0) throw new Error("COLUMN_NOT_FOUND:" + name); return i; };
  try {
    for (const o of ops) {
      if (o.op === "trim") { let n = 0; rows = rows.map(r => r.map(v => { const t = typeof v === "string" ? v.trim() : v; if (t !== v) n++; return t; })); log.push({ op: "trim", changed: n }); }
      else if (o.op === "dropEmptyRows") { const b = rows.length; rows = rows.filter(r => r.some(v => String(v ?? "").trim() !== "")); log.push({ op: "dropEmptyRows", removed: b - rows.length }); }
      else if (o.op === "dropDuplicates") { const seen = new Set(), b = rows.length; rows = rows.filter(r => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; }); log.push({ op: "dropDuplicates", removed: b - rows.length }); }
      else if (o.op === "toNumber") { const i = col(o.column); let bad = 0; rows = rows.map(r => { const v = r[i]; if (isNum(v)) r[i] = Number(v); else { if (String(v ?? "").trim() !== "") bad++; r[i] = null; } return r; }); log.push({ op: "toNumber", column: o.column, invalidToNull: bad }); }
      else if (o.op === "fillMissing") {
        const i = col(o.column), blank = v => v === null || String(v).trim() === ""; let fill;
        if ("value" in o) fill = o.value; else { const nums = rows.map(r => r[i]).filter(v => !blank(v) && isNum(v)).map(Number); if (!nums.length) throw new Error("NO_NUMERIC_VALUES:" + o.column); fill = o.strategy === "median" ? describe(nums).median : o.strategy === "mean" ? describe(nums).mean : (() => { throw new Error("STRATEGY_INVALID"); })(); }
        let n = 0; rows = rows.map(r => { if (blank(r[i])) { r[i] = fill; n++; } return r; }); log.push({ op: "fillMissing", column: o.column, filled: n, with: fill });
      } else throw new Error("OP_UNKNOWN:" + o.op);
    }
  } catch (e) { return { ok: false, reason: String(e.message) }; }
  return { ok: true, headers, rows, log };
}
export function describe(values) {
  const x = values.filter(Number.isFinite).slice().sort((a, b) => a - b), n = x.length; if (!n) return { count: 0 };
  const sum = x.reduce((a, b) => a + b, 0), mean = sum / n, q = p => { const k = (n - 1) * p, f = Math.floor(k), c = Math.ceil(k); return x[f] + (x[c] - x[f]) * (k - f); };
  const sd = n > 1 ? Math.sqrt(x.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return { count: n, sum, mean, std: sd, min: x[0], q1: q(0.25), median: q(0.5), q3: q(0.75), max: x[n - 1] };
}
export function correlation(a, b) {
  if (a.length !== b.length) return { ok: false, reason: "LENGTH_MISMATCH" };
  const p = a.map((v, i) => [Number(v), Number(b[i])]).filter(([u, v]) => Number.isFinite(u) && Number.isFinite(v)), n = p.length; if (n < 3) return { ok: false, reason: "NEED_AT_LEAST_3_PAIRS", n };
  const mx = p.reduce((s, [u]) => s + u, 0) / n, my = p.reduce((s, [, v]) => s + v, 0) / n; let sxy = 0, sxx = 0, syy = 0;
  for (const [u, v] of p) { sxy += (u - mx) * (v - my); sxx += (u - mx) ** 2; syy += (v - my) ** 2; }
  if (sxx === 0 || syy === 0) return { ok: false, reason: "ZERO_VARIANCE", n };
  return { ok: true, n, r: sxy / Math.sqrt(sxx * syy) };
}
export function linearRegression(xs, ys) {
  const c = correlation(xs, ys); if (!c.ok) return c;
  const p = xs.map((v, i) => [Number(v), Number(ys[i])]).filter(([u, v]) => Number.isFinite(u) && Number.isFinite(v)), n = p.length;
  const mx = p.reduce((s, [u]) => s + u, 0) / n, my = p.reduce((s, [, v]) => s + v, 0) / n; let sxy = 0, sxx = 0;
  for (const [u, v] of p) { sxy += (u - mx) * (v - my); sxx += (u - mx) ** 2; }
  const slope = sxy / sxx; return { ok: true, n, slope, intercept: my - slope * mx, r2: c.r ** 2 };
}
export function groupBy(data, byColumn, valueColumn, agg = "sum") {
  const bi = data.headers.indexOf(byColumn), vi = data.headers.indexOf(valueColumn); if (bi < 0 || vi < 0) return { ok: false, reason: "COLUMN_NOT_FOUND" };
  if (!["sum", "mean", "count", "min", "max"].includes(agg)) return { ok: false, reason: "AGG_INVALID" };
  const g = new Map(); for (const r of data.rows) { const k = String(r[bi]); const v = Number(r[vi]); if (!g.has(k)) g.set(k, []); if (Number.isFinite(v) && String(r[vi]).trim() !== "") g.get(k).push(v); }
  if (g.size > LIMITS.maxCategories) return { ok: false, reason: "TOO_MANY_CATEGORIES" };
  const f = { sum: a => a.reduce((s, v) => s + v, 0), mean: a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null, count: a => a.length, min: a => a.length ? Math.min(...a) : null, max: a => a.length ? Math.max(...a) : null }[agg];
  return { ok: true, groups: [...g.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([key, vals]) => ({ key, value: f(vals), n: vals.length })) };
}
/** Chart specs for the renderer (render.mjs). Values come from the data; nothing is invented. */
export function chartSpecs(data, prof = profile(data)) {
  const specs = [], numeric = prof.filter(p => p.type === "number" || p.type === "integer").map(p => p.column), cat = prof.find(p => p.type === "string" && p.unique > 1 && p.unique <= LIMITS.maxCategories);
  for (const c of numeric.slice(0, 3)) specs.push({ type: "histogram", title: "Distribution of " + c, column: c, values: data.rows.map(r => Number(r[data.headers.indexOf(c)])).filter(Number.isFinite) });
  if (cat && numeric[0]) { const g = groupBy(data, cat.column, numeric[0], "sum"); if (g.ok) specs.push({ type: "bar", title: `${numeric[0]} by ${cat.column} (sum)`, labels: g.groups.map(x => x.key), values: g.groups.map(x => x.value) }); }
  if (numeric.length >= 2) specs.push({ type: "scatter", title: `${numeric[1]} vs ${numeric[0]}`, points: data.rows.map(r => [Number(r[data.headers.indexOf(numeric[0])]), Number(r[data.headers.indexOf(numeric[1])])]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).slice(0, 500) });
  return specs;
}
/** Full reproducible analysis. The report hash covers input hash + steps + results (no timestamps), so equal inputs give equal hashes. */
export function analyze(csvText, { ops = [] } = {}) {
  const p = parseCsv(csvText); if (!p.ok) return p;
  const c = clean(p, ops); if (!c.ok) return c;
  const prof = profile(c), numeric = prof.filter(x => x.type === "number" || x.type === "integer");
  const stats = Object.fromEntries(numeric.map(x => [x.column, describe(c.rows.map(r => Number(r[c.headers.indexOf(x.column)])))]));
  const corr = []; for (let i = 0; i < numeric.length; i++) for (let j = i + 1; j < numeric.length; j++) { const r = correlation(c.rows.map(r => r[c.headers.indexOf(numeric[i].column)]), c.rows.map(r => r[c.headers.indexOf(numeric[j].column)])); if (r.ok) corr.push({ a: numeric[i].column, b: numeric[j].column, r: r.r, n: r.n }); }
  const body = { inputHash: p.inputHash, rows: c.rows.length, columns: c.headers.length, steps: c.log, profile: prof, stats, correlations: corr };
  return { ok: true, report: { ...body, reportHash: sha(JSON.stringify(body)) }, data: { headers: c.headers, rows: c.rows }, charts: chartSpecs(c, prof), note: "Descriptive statistics only. Correlation is not causation." };
}
export function reportToMarkdown(rep) {
  const L = ["# Analysis report", "", `Input hash: \`${rep.inputHash}\`  `, `Report hash: \`${rep.reportHash}\`  `, `Rows: ${rep.rows}, columns: ${rep.columns}`, "", "## Steps", ...(rep.steps.length ? rep.steps.map(s => "- " + JSON.stringify(s)) : ["- (none)"]), "", "## Columns", "| column | type | missing | unique |", "|---|---|---|---|", ...rep.profile.map(p => `| ${p.column.replace(/\|/g, "\\|")} | ${p.type} | ${p.missing} | ${p.unique} |`), "", "## Statistics"];
  for (const [k, s] of Object.entries(rep.stats)) L.push(`- **${k}**: n=${s.count}, mean=${+s.mean.toPrecision(6)}, std=${+s.std.toPrecision(6)}, min=${s.min}, median=${s.median}, max=${s.max}`);
  if (rep.correlations.length) { L.push("", "## Correlations (Pearson)"); for (const c of rep.correlations) L.push(`- ${c.a} ~ ${c.b}: r=${+c.r.toPrecision(4)} (n=${c.n})`); }
  return L.join("\n") + "\n";
}
