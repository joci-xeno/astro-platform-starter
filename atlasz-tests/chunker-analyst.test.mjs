import test from "node:test";
import assert from "node:assert/strict";
import { chunkText, verifyCoverage, mapReducePlan, LIMITS as CL } from "../atlasz-addons/chunker.mjs";
import { parseCsv, toCsv, profile, clean, describe, correlation, linearRegression, groupBy, chartSpecs, analyze, reportToMarkdown, LIMITS as AL } from "../atlasz-addons/analyst.mjs";

let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;      // deterministic LCG for property-style tests
const words = n => Array.from({ length: n }, () => ["alpha", "beta", "gamma", "delta", "x".repeat(1 + Math.floor(rnd() * 12))][Math.floor(rnd() * 5)]).join(rnd() < 0.1 ? "\n\n" : " ");

// ---------- chunker (GE01)
test("chunker: property - for many random texts and sizes every character is covered, chunks respect the size cap, indices are sequential and the slices are faithful", () => {
  for (let k = 0; k < 40; k++) {
    const text = words(50 + Math.floor(rnd() * 3000)), maxTokens = 16 + Math.floor(rnd() * 300), overlapTokens = Math.floor(rnd() * (maxTokens / 2 - 1));
    const r = chunkText(text, { maxTokens, overlapTokens }); assert.equal(r.ok, true, JSON.stringify({ maxTokens, overlapTokens }));
    assert.equal(r.coverage.complete, true, "coverage " + JSON.stringify(r.coverage));
    r.chunks.forEach((c, i) => { assert.equal(c.index, i); assert.ok(c.text.length <= maxTokens * 4, "chunk too big"); assert.equal(text.slice(c.start, c.end), c.text); if (i) assert.ok(c.start > r.chunks[i - 1].start, "must advance"); });
  }
});
test("chunker: prefers paragraph then sentence boundaries; hard-splits a giant unbroken token; empty text -> no chunks; bad parameters refused", () => {
  const para = "A".repeat(150) + "\n\n" + "B".repeat(150); const a = chunkText(para, { maxTokens: 64, overlapTokens: 0 }); assert.equal(a.chunks[0].text.endsWith("\n\n"), true);
  const g = chunkText("z".repeat(3000), { maxTokens: 64, overlapTokens: 0 }); assert.ok(g.ok && g.chunks.length >= 12 && g.coverage.complete);
  assert.deepEqual(chunkText("", {}).chunks, []);
  for (const bad of [{ maxTokens: 4 }, { maxTokens: 100, overlapTokens: 60 }, { maxTokens: 100, overlapTokens: -1 }, { maxTokens: 1.5 }]) assert.equal(chunkText("hello world", bad).ok, false);
  assert.equal(chunkText(5).reason, "TEXT_REQUIRED"); assert.equal(chunkText("x".repeat(CL.maxChars + 1)).reason, "TEXT_TOO_LARGE");
});
test("chunker: coverage verifier really detects a gap or a tampered chunk; map-reduce plan is exact", () => {
  const text = words(800), r = chunkText(text, { maxTokens: 100, overlapTokens: 10 });
  const gap = r.chunks.filter((_, i) => i !== 2); assert.equal(verifyCoverage(text, gap).complete, false);
  const bad = r.chunks.map((c, i) => i === 1 ? { ...c, text: c.text.slice(1) } : c); assert.equal(verifyCoverage(text, bad).faithful, false);
  assert.deepEqual(mapReducePlan(100, { fanIn: 10 }).stages, [{ stage: "MAP", tasks: 100 }, { stage: "REDUCE", tasks: 10 }, { stage: "REDUCE", tasks: 1 }]);
  assert.equal(mapReducePlan(1).levels, 0); assert.equal(mapReducePlan(0).totalTasks, 0); assert.equal(mapReducePlan(5, { fanIn: 1 }).ok, false); assert.equal(mapReducePlan(-1).ok, false);
});

// ---------- analyst (M07 / GE07)
test("csv: quotes, embedded delimiters/newlines, CRLF; ragged rows, duplicate/blank headers, unterminated quote and size caps are refused", () => {
  const p = parseCsv('name,note\r\n"Smith, J","said ""hi""\nthere"\nLee,ok\n'); assert.deepEqual(p.rows, [["Smith, J", 'said "hi"\nthere'], ["Lee", "ok"]]);
  assert.equal(parseCsv("a,b\n1\n").reason, "RAGGED_ROWS"); assert.equal(parseCsv("a,a\n1,2").reason, "HEADERS_INVALID"); assert.equal(parseCsv("a,\n1,2").reason, "HEADERS_INVALID");
  assert.equal(parseCsv('a\n"open').reason, "UNTERMINATED_QUOTE"); assert.equal(parseCsv("  ").reason, "CSV_REQUIRED");
  assert.equal(parseCsv("a\n" + "1\n".repeat(AL.maxRows + 5)).reason, "TOO_MANY_ROWS"); assert.equal(parseCsv("a\n" + "x".repeat(AL.maxBytes)).reason, "CSV_TOO_LARGE");
});
test("export neutralises spreadsheet formula injection but keeps plain negative numbers", () => {
  const out = toCsv(["a", "b"], [["=HYPERLINK(\"http://evil\")", "-5"], ["+cmd|' /C calc'!A0", "@SUM(A1)"], ["ok,comma", "-1.5e3"]]);
  assert.ok(out.includes("'=HYPERLINK"), out); assert.ok(!/(^|,)"?=HYPERLINK/m.test(out)); assert.ok(out.includes("'+cmd")); assert.ok(out.includes("'@SUM")); assert.ok(/,-5\n/.test(out)); assert.ok(out.includes('"ok,comma"'));
  assert.equal(parseCsv(out).ok, true);
});
test("statistics are numerically right on known values: mean/median/sd/quartiles, Pearson r, OLS slope/intercept/r2, group-by aggregates", () => {
  const d = describe([2, 4, 4, 4, 5, 5, 7, 9]); assert.equal(d.mean, 5); assert.equal(d.median, 4.5); assert.ok(Math.abs(d.std - Math.sqrt(32 / 7)) < 1e-12); assert.deepEqual([d.min, d.max, d.count], [2, 9, 8]); assert.equal(d.q1, 4); assert.equal(d.q3, 5.5);
  assert.deepEqual(describe([]), { count: 0 }); assert.equal(describe([7]).std, 0); assert.equal(describe([1, NaN, 3]).count, 2);
  assert.ok(Math.abs(correlation([1, 2, 3, 4], [2, 4, 6, 8]).r - 1) < 1e-12); assert.ok(Math.abs(correlation([1, 2, 3, 4], [8, 6, 4, 2]).r + 1) < 1e-12);
  assert.equal(correlation([1, 1, 1], [1, 2, 3]).reason, "ZERO_VARIANCE"); assert.equal(correlation([1, 2], [1, 2]).reason, "NEED_AT_LEAST_3_PAIRS"); assert.equal(correlation([1, 2, 3], [1, 2]).reason, "LENGTH_MISMATCH");
  const L = linearRegression([1, 2, 3, 4], [3, 5, 7, 9]); assert.ok(Math.abs(L.slope - 2) < 1e-12 && Math.abs(L.intercept - 1) < 1e-12 && Math.abs(L.r2 - 1) < 1e-12);
  const g = groupBy({ headers: ["k", "v"], rows: [["b", "1"], ["a", "2"], ["a", "4"], ["b", ""]] }, "k", "v", "sum"); assert.deepEqual(g.groups, [{ key: "a", value: 6, n: 2 }, { key: "b", value: 1, n: 1 }]);
  assert.equal(groupBy({ headers: ["k"], rows: [] }, "k", "zz").reason, "COLUMN_NOT_FOUND"); assert.equal(groupBy({ headers: ["k", "v"], rows: [] }, "k", "v", "evil").reason, "AGG_INVALID");
});
test("cleaning is logged and reproducible: trim, drop empty/duplicate rows, to-number (invalid -> null, counted), fill missing by mean/median/value; unknown op/column refused", () => {
  const p = parseCsv("id,amt\n1, 10 \n1, 10 \n2,\n,\n3,abc\n4,30\n");
  const c = clean(p, [{ op: "trim" }, { op: "dropEmptyRows" }, { op: "dropDuplicates" }, { op: "toNumber", column: "amt" }, { op: "fillMissing", column: "amt", strategy: "mean" }]);
  assert.equal(c.ok, true); assert.deepEqual(c.log.map(l => l.op), ["trim", "dropEmptyRows", "dropDuplicates", "toNumber", "fillMissing"]);
  assert.deepEqual(c.log.find(l => l.op === "dropDuplicates"), { op: "dropDuplicates", removed: 1 }); assert.equal(c.log.find(l => l.op === "toNumber").invalidToNull, 1);
  assert.deepEqual(c.rows.map(r => r[1]), [10, 20, 20, 30]); assert.deepEqual(p.rows[0], ["1", " 10 "], "input must not be mutated");
  assert.equal(clean(p, [{ op: "fillMissing", column: "nope", value: 1 }]).reason, "COLUMN_NOT_FOUND:nope"); assert.equal(clean(p, [{ op: "rm -rf" }]).reason, "OP_UNKNOWN:rm -rf");
  assert.equal(clean(p, [{ op: "fillMissing", column: "id", strategy: "mean" }]).ok, true);
});
test("profile types: integer, number, date, boolean, string; missing and unique counts", () => {
  const p = profile(parseCsv("i,n,d,b,s\n1,1.5,2024-01-02,true,a\n2,2,2024-02-30,FALSE,a\n,3,2024-03-04,true,b\n"));
  assert.deepEqual(p.map(x => x.type), ["integer", "number", "string", "boolean", "string"]);   // 2024-02-30 is not a real date -> the column stays string
  assert.deepEqual([p[0].missing, p[4].unique], [1, 2]);
});
test("analyze: reproducible report (same input+steps => same hash, different input => different hash), charts come from real data, markdown output, no clock/random in the report", () => {
  const csv = "region,units,price\nN,10,2.5\nS,20,2.4\nN,30,2.2\nE,25,2.3\nS,15,2.45\n";
  const a = analyze(csv, { ops: [{ op: "toNumber", column: "units" }] }), b = analyze(csv, { ops: [{ op: "toNumber", column: "units" }] }), c = analyze(csv.replace("30", "31"), { ops: [{ op: "toNumber", column: "units" }] });
  assert.equal(a.report.reportHash, b.report.reportHash); assert.notEqual(a.report.reportHash, c.report.reportHash); assert.deepEqual(a.report, b.report);
  assert.ok(a.report.correlations.some(x => x.a === "units" && x.b === "price" && x.r < 0));
  const kinds = a.charts.map(x => x.type); assert.ok(kinds.includes("histogram") && kinds.includes("bar") && kinds.includes("scatter"));
  const bar = a.charts.find(x => x.type === "bar"); assert.deepEqual(bar.labels, ["E", "N", "S"]); assert.deepEqual(bar.values, [25, 40, 35]);
  const md = reportToMarkdown(a.report); assert.match(md, /Report hash: `[0-9a-f]{64}`/); assert.match(md, /units/);
  assert.equal(analyze("").reason, "CSV_REQUIRED"); assert.equal(analyze(csv, { ops: [{ op: "zzz" }] }).ok, false);
});

test("analyst: NA / N/A / null / - cells are MISSING (never 0, never a text value breaking the column type); headers are redacted in the report; the cleaned table can be exported with formula neutralisation", async () => {
  const { analyze, cleanedCsv } = await import("../atlasz-addons/analyst.mjs");
  const r = analyze("a,b\n1,x\nNA,y\n3,z\nn/a,w\n-,v\nnull,u\n");
  assert.equal(r.ok, true); const col = r.report.profile.find(p => p.column === "a");
  assert.equal(col.type, "integer"); assert.equal(col.missing, 4); assert.equal(r.report.stats.a.count, 2); assert.equal(r.report.stats.a.mean, 2, "missing values are excluded, not counted as 0");
  const t = analyze("a\n5\nNA\n-\n", { ops: [{ op: "toNumber", column: "a" }] }); assert.equal(t.report.steps[0].invalidToNull, 0, "NA is not an invalid number, it is simply missing");
  const f = analyze("a\n5\nNA\n7\n", { ops: [{ op: "fillMissing", column: "a", strategy: "mean" }] }); assert.deepEqual(f.data.rows.map(x => x[0]), ["5", 6, "7"]);
  const K = "s" + "k-ABCDEFGHIJKLMNOPQRSTUVWX", h = analyze("name," + K + "\nx,1\ny,2\n");
  assert.ok(!JSON.stringify(h.report).includes(K), "a secret in a column name never reaches the report"); assert.equal(h.data.headers[1], K, "the data itself is unchanged");
  const csv = cleanedCsv(analyze("a,b\n=1+1,2\nok,3\n")); assert.match(csv, /^a,b\n'=1\+1,2\nok,3\n$/); assert.equal(cleanedCsv({ ok: false }), null);
});

test("R6 verification regressions: chart titles, fill values and error text are redacted; an all-missing group has no sum; export neutralises hidden-prefix formulas; the row cap is exact; bad ops are refused", async () => {
  const { analyze, cleanedCsv, groupBy, parseCsv, LIMITS: AL2 } = await import("../atlasz-addons/analyst.mjs");
  const K = "s" + "k-ABCDEFGHIJKLMNOPQRSTUVWX";
  const h = analyze("k," + K + "\na,1\nb,2\nc,3\n"); assert.ok(h.charts.length > 0); assert.ok(!JSON.stringify(h.charts).includes(K), "no secret in any chart spec");
  const f = analyze("a\n5\nNA\n7\n", { ops: [{ op: "fillMissing", column: "a", value: K }] }); assert.ok(!JSON.stringify(f.report).includes(K), "fill value redacted in the report steps");
  assert.ok(!JSON.stringify(analyze("a\n1\n", { ops: [{ op: "trim" }, { op: "toNumber", column: K }] })).includes(K), "unknown column error text is redacted");
  assert.equal(analyze("a\n1\n", { ops: [null] }).reason, "OP_INVALID"); assert.equal(analyze("a\n1\n", { ops: [[1]] }).reason, "OP_INVALID");
  const g = groupBy({ headers: ["k", "v"], rows: [["a", "1"], ["a", "2"], ["b", "NA"], ["b", ""], ["c", "5"]] }, "k", "v", "sum"); assert.deepEqual(g.groups.map(x => x.value), [3, null, 5], "a group with only missing values has no sum, not 0");
  const bar = analyze("k,v\na,1\na,2\nb,NA\nc,5\n").charts.find(c => c.type === "bar"); assert.deepEqual(bar.values, [3, 5]); assert.deepEqual(bar.labels, ["a", "c"]);
  for (const pre of ["\n", " ", "\u00a0", "\u200b", "\ufeff", "\v", "\f", "\uff1d"]) { const out = cleanedCsv(analyze("a\n\"" + pre + "=1+1\"\nx\n")); assert.ok(out.includes("'" + pre + "=1+1") || out.includes("\"'" + pre + "=1+1"), "prefix " + JSON.stringify(pre) + " -> " + JSON.stringify(out)); }
  assert.equal(cleanedCsv(analyze("a,b\n-5,2\nok,3\n")).includes("'-5"), false, "plain negative numbers are left alone");
  const rows = n => "a\n" + Array.from({ length: n }, (_, i) => String(i)).join("\n");
  assert.equal(parseCsv(rows(AL2.maxRows)).ok, true); assert.equal(parseCsv(rows(AL2.maxRows + 1)).reason, "TOO_MANY_ROWS", "the last row without a newline is counted");
});
