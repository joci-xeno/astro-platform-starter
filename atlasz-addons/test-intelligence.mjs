// Test intelligence (PKG150 O513 risk-based test prioritisation; S09/S502 test-gap finder + test scaffold generator; coverage-trend record). Deterministic and offline.
//   prioritizeTests   ranks the project's test files for a change set: static import reach (reverse import graph from the changed files), historical failures and duration. Every entry carries its reasons.
//                     A changed file the graph cannot see (non-JS, deleted, unparsed, dynamic-only) makes the plan recommend RUN_ALL as a safety net: a ranking is a schedule, never permission to skip.
//   findTestGaps      exported symbols cross-referenced with the names test files import AND use. A name that only appears in a test that does not import its module is "weak", not covered.
//                     Scaffold placeholders (ATLASZ_SCAFFOLD_TODO:<name>) never count as coverage.
//   generateTestScaffold  node:test file text for exported symbols. Each test calls assert.fail(...) until a person replaces it, so a scaffold can never fake coverage. Assertion AUTHORING needs a model:
//                     with an injected `model` adapter its drafts are added BELOW the failing line, marked unreviewed; without one the result says MODEL_NOT_CONFIGURED. Nothing is written into the project.
//   recordCoverageTrend / readCoverageTrend  append-only JSONL trend of the gap counts in a caller-owned state file (refused inside the analysed project).
// Honest limits: "tested" means "a test imports and references the symbol", not that the symbol's behaviour is asserted; this is not line/branch coverage. Read-only on the analysed project.
import fs from "node:fs";
import path from "node:path";
import { buildGraph, bfs, isTestFile, readConfined, parseModule, realRoot, clean, sha256, MODEL_NOT_CONFIGURED, W2_STATUS } from "./dev-assist-common.mjs";
import { scrub } from "./secret-patterns.mjs";

export const LIMITS = Object.freeze({ maxChanged: 500, maxHistory: 20000, maxPlan: 2000, defaultDurationMs: 1000, maxScaffoldSymbols: 100, maxDraftChars: 4000, modelTimeoutMs: 15000, maxTrendBytes: 1048576, maxReexportDepth: 6 });
export const STATUS = Object.freeze({ ...W2_STATUS, assertionAuthoring: "NEEDS_INJECTED_MODEL_ADAPTER" });
const relOk = r => typeof r === "string" && r.length > 0 && r.length <= 400 && !/[\0\\]/.test(r) && !r.startsWith("/") && !/^[A-Za-z]:/.test(r) && !path.posix.normalize(r).split("/").includes("..");

function historyStats(history) {
  const per = new Map(); if (!Array.isArray(history)) return { per, used: 0, ignored: 0 };
  let ignored = 0; const recs = history.slice(-LIMITS.maxHistory);
  for (const h of recs) {
    if (!h || typeof h !== "object" || !relOk(h.file) || typeof h.status !== "string") { ignored++; continue; }
    const s = per.get(h.file) ?? { runs: 0, failures: 0, durations: [], last: null, recent: [] };
    const failed = /^(FAIL|FAILED|ERROR|TIMEOUT)$/i.test(h.status);
    s.runs++; if (failed) s.failures++; s.recent.push(failed); if (s.recent.length > 10) s.recent.shift();
    if (Number.isFinite(h.durationMs) && h.durationMs >= 0) s.durations.push(Math.min(h.durationMs, 3600000));
    s.last = failed ? "FAILED" : "PASSED"; per.set(h.file, s);
  }
  return { per, used: recs.length - ignored, ignored: ignored + Math.max(0, history.length - LIMITS.maxHistory) };
}

/** Risk-based ordering of test files for a change. Never runs anything. */
export function prioritizeTests({ root, changedFiles = [], history = [], budgetMs = null, maxTests = LIMITS.maxPlan } = {}) {
  if (!Array.isArray(changedFiles)) return { ok: false, reason: "CHANGED_FILES_MUST_BE_ARRAY" };
  if (changedFiles.length > LIMITS.maxChanged) return { ok: false, reason: "TOO_MANY_CHANGED_FILES", max: LIMITS.maxChanged };
  const bad = changedFiles.find(c => !relOk(c)); if (bad !== undefined) return { ok: false, reason: "PATH_TRAVERSAL_OR_INVALID_PATH_REFUSED", path: clean(bad) };
  const g = buildGraph(root); if (!g.ok) return g;
  const changed = [...new Set(changedFiles.map(c => path.posix.normalize(c)))];
  const inGraph = changed.filter(c => g.files.has(c)), unknownImpact = changed.filter(c => !g.files.has(c));
  const tests = [...g.files.keys()].filter(isTestFile).sort();
  const reach = new Map();   // test -> {depth, via}
  const testsReaching = new Map();
  for (const c of inGraph) { const d = bfs(g.reverse, [c]); testsReaching.set(c, tests.filter(t => d.has(t)).length); for (const t of tests) if (d.has(t)) { const cur = reach.get(t); if (!cur || d.get(t) < cur.depth || (d.get(t) === cur.depth && c < cur.via)) reach.set(t, { depth: d.get(t), via: c }); } }
  const hs = historyStats(history);
  const plan = tests.map(t => {
    const r = reach.get(t), h = hs.per.get(t), reasons = []; let impact = 0, risk = 0;
    if (r) { impact = r.depth === 0 ? 100 : Math.round(80 / r.depth); reasons.push(r.depth === 0 ? "TEST_FILE_ITSELF_CHANGED" : r.depth === 1 ? "DIRECTLY_IMPORTS_CHANGED:" + r.via : "REACHES_CHANGED_VIA_IMPORTS:" + r.via + "@depth" + r.depth); }
    if (h) { const rate = h.failures / h.runs, recent = h.recent.filter(Boolean).length / h.recent.length; risk = Math.round(25 * rate + 15 * recent + (h.last === "FAILED" ? 20 : 0)); if (h.last === "FAILED") reasons.push("FAILED_LAST_RUN"); if (h.failures) reasons.push("FAILURE_RATE:" + rate.toFixed(2)); if (h.recent.some(Boolean) && h.recent.some(x => !x)) reasons.push("MIXED_RECENT_RESULTS_POSSIBLY_FLAKY"); }
    else reasons.push("NO_HISTORY");
    const dur = h?.durations.length ? Math.round(h.durations.reduce((a, b) => a + b, 0) / h.durations.length) : null;
    reasons.push(dur === null ? "DURATION_UNKNOWN_ASSUMED_" + LIMITS.defaultDurationMs + "MS" : "AVG_DURATION_MS:" + dur);
    return { test: t, score: impact + risk, impact, risk, depth: r?.depth ?? null, viaChanged: r?.via ?? null, estDurationMs: dur ?? LIMITS.defaultDurationMs, reasons };
  }).sort((a, b) => b.score - a.score || a.estDurationMs - b.estDurationMs || (a.test < b.test ? -1 : 1)).slice(0, Math.max(1, Math.min(maxTests, LIMITS.maxPlan)));
  let spent = 0;
  for (const [i, p] of plan.entries()) {
    p.rank = i + 1;
    const relevant = p.score > 0, fits = budgetMs === null || spent + p.estDurationMs <= budgetMs;
    p.decision = !relevant ? "DEFERRED_NO_SIGNAL" : fits ? "RUN" : "OVER_BUDGET_RUN_LATER";
    if (p.decision === "RUN") spent += p.estDurationMs;
  }
  const changedWithoutTests = inGraph.filter(c => !isTestFile(c) && !testsReaching.get(c));
  return { ok: true, graphHash: g.hash, changed, unknownImpact, changedWithoutTests, testsTotal: tests.length,
    selected: plan.filter(p => p.decision === "RUN").map(p => p.test), estimatedMs: spent, plan,
    recommendation: unknownImpact.length || g.unresolved.length || g.notParsed.oversize || g.walk.capped ? "RUN_ALL_AS_SAFETY_NET" : "RUN_SELECTED_THEN_FULL_SUITE_BEFORE_MERGE",
    history: { used: hs.used, ignored: hs.ignored }, graph: { unresolvedImports: g.unresolved.length, notParsed: g.notParsed, capped: g.walk.capped },
    note: "Ordering from static imports + history only. Dynamic imports, fixtures, config and child processes are invisible here; a DEFERRED test is not proven irrelevant." };
}

// symbol origin through re-exports: (module, name) -> (module, name) of the definition (bounded)
function origin(g, mod, name, depth = 0) {
  if (depth > LIMITS.maxReexportDepth) return { mod, name };
  const m = g.files.get(mod); if (!m) return { mod, name };
  const e = m.exports.find(x => x.name === name);
  if (e?.from) { const im = m.imports.find(i => i.kind === "reexport" && i.spec === e.from && i.resolved); if (im) { const n = im.names.find(x => x.local === name); return origin(g, im.resolved, n ? n.imported : name, depth + 1); } }
  if (e && e.kind === "binding" && e.local !== name) {     // export { a as b } of a local or imported binding
    const imp = m.imports.find(i => i.resolved && i.names.some(x => x.local === e.local)); if (imp) return origin(g, imp.resolved, imp.names.find(x => x.local === e.local).imported, depth + 1);
  }
  if (!e) for (const im of m.imports) if (im.kind === "reexport" && im.reexportAll && im.resolved) { const t = g.files.get(im.resolved); if (t?.exports.some(x => x.name === name) || t?.imports.some(i => i.reexportAll)) return origin(g, im.resolved, name, depth + 1); }
  return { mod, name };
}

/** Exported-but-untested symbols. Read-only. */
export function findTestGaps({ root } = {}) {
  const g = buildGraph(root); if (!g.ok) return g;
  const covered = new Map(), weakNames = new Map(), scaffoldOnly = new Map();     // "mod#name" -> Set(test)
  const add = (m, k, t) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(t); };
  const tests = [...g.files.keys()].filter(isTestFile).sort();
  for (const t of tests) {
    const m = g.files.get(t), todo = new Set([...m.text.matchAll(/ATLASZ_SCAFFOLD_TODO:([A-Za-z_$][\w$]*)/g)].map(x => x[1]));
    const used = local => (m.identCounts.get(local) ?? 0) >= 2;           // imported AND referenced at least once more
    for (const im of m.imports) {
      if (!im.resolved || isTestFile(im.resolved)) continue;
      const hits = [];
      for (const n of im.names ?? []) if (used(n.local)) hits.push(n.imported);
      if (im.default && used(im.default)) hits.push("default");
      if (im.ns) for (const mem of m.members) if (mem.startsWith(im.ns + ".")) hits.push(mem.slice(im.ns.length + 1));
      for (const h of hits) { const o = origin(g, im.resolved, h), key = o.mod + "#" + o.name; if (todo.has(h)) add(scaffoldOnly, key, t); else add(covered, key, t); }
    }
    for (const id of m.idents) add(weakNames, id, t);
  }
  const modules = [];
  let exported = 0, tested = 0;
  for (const [rel, m] of [...g.files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (isTestFile(rel) || !m.exports.length) continue;
    const syms = m.exports.filter(e => !e.from).map(e => {
      const key = rel + "#" + e.name, by = [...(covered.get(key) ?? [])].sort(), weak = by.length ? [] : [...(weakNames.get(e.name) ?? [])].sort().slice(0, 10);
      exported++; if (by.length) tested++;
      return { name: e.name, kind: e.kind, signature: clean(e.signature), line: e.line, tested: by.length > 0, testedBy: by.slice(0, 20), weakNameOnlyMatches: e.name === "default" ? [] : weak, scaffoldOnly: [...(scaffoldOnly.get(key) ?? [])].sort() };
    });
    if (syms.length) modules.push({ file: rel, imported_by_tests: tests.some(t => g.edges.get(t)?.has(rel)), exports: syms });
  }
  const untested = modules.flatMap(mo => mo.exports.filter(s => !s.tested).map(s => ({ file: mo.file, name: s.name, kind: s.kind, signature: s.signature, line: s.line, weak: s.weakNameOnlyMatches.length > 0, scaffoldOnly: s.scaffoldOnly.length > 0 })));
  return { ok: true, graphHash: g.hash, summary: { modules: modules.length, exported, tested, untested: exported - tested, ratio: exported ? +(tested / exported).toFixed(4) : null }, untested, modules,
    coverageKind: "IMPORT_AND_REFERENCE_CROSS_REFERENCE_NOT_EXECUTION_COVERAGE", graph: { unresolvedImports: g.unresolved.length, notParsed: g.notParsed, capped: g.walk.capped } };
}

const DRAFT_DENY = /child_process|process\.exit|\beval\s*\(|\bFunction\s*\(|\bimport\s*\(|\brequire\s*\(|\bfetch\s*\(|\bhttps?\.|\bnet\.|\bfs\.(?:write|rm|unlink|append)|ATLASZ_SCAFFOLD_TODO/;
const TRIVIAL = /assert\.(?:ok|equal|strictEqual|deepEqual)\s*\(\s*(?:true|1\s*,\s*1|"([^"]*)"\s*,\s*"\1"|true\s*,\s*true)\s*[,)]/;
const withTimeout = (p, ms) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error("MODEL_TIMEOUT")), ms); })]).finally(() => clearTimeout(t)); };
const ident = /^[A-Za-z_$][\w$]*$/;

/** node:test scaffold text for a module's exported symbols. Returns text only: nothing is written. Every generated test fails until completed. */
export async function generateTestScaffold({ root, file, symbols = null, testPath = null, model = null } = {}) {
  const r = readConfined(root, file); if (!r.ok) return r;
  const m = parseModule(r.text);
  let ex = m.exports.filter(e => e.kind !== "namespace" && (e.name === "default" || ident.test(e.name)));
  if (Array.isArray(symbols)) { const want = new Set(symbols.map(String)); ex = ex.filter(e => want.has(e.name)); }
  ex = [...new Map(ex.map(e => [e.name, e])).values()].slice(0, LIMITS.maxScaffoldSymbols);
  if (!ex.length) return { ok: false, reason: "NO_EXPORTED_SYMBOLS_SELECTED" };
  const tp = testPath ?? "tests/" + path.posix.basename(r.rel).replace(/\.[^.]+$/, "") + ".test.mjs";
  if (!relOk(tp)) return { ok: false, reason: "TEST_PATH_INVALID" };
  let spec = path.posix.relative(path.posix.dirname(path.posix.normalize(tp)), r.rel); if (!spec.startsWith(".")) spec = "./" + spec;
  const named = ex.filter(e => e.name !== "default").map(e => e.name), hasDefault = ex.some(e => e.name === "default");
  const drafts = {}, rejected = [];
  if (model) {
    if (typeof model.draftAssertions !== "function") return { ok: false, reason: "MODEL_ADAPTER_INVALID:draftAssertions_REQUIRED" };
    for (const e of ex) {
      let out; try { out = await withTimeout(Promise.resolve(model.draftAssertions({ symbol: e.name, kind: e.kind, signature: e.signature, file: r.rel })), LIMITS.modelTimeoutMs); } catch (err) { rejected.push({ symbol: e.name, reason: String(err?.message ?? "MODEL_ERROR").slice(0, 80) }); continue; }
      const txt = typeof out === "string" ? out : typeof out?.text === "string" ? out.text : null;
      if (!txt) { rejected.push({ symbol: e.name, reason: "EMPTY_DRAFT" }); continue; }
      if (txt.length > LIMITS.maxDraftChars) { rejected.push({ symbol: e.name, reason: "DRAFT_TOO_LONG" }); continue; }
      if (!/\bassert\.\w+\s*\(/.test(txt)) { rejected.push({ symbol: e.name, reason: "DRAFT_HAS_NO_ASSERTION" }); continue; }
      if (TRIVIAL.test(txt)) { rejected.push({ symbol: e.name, reason: "DRAFT_ASSERTION_TRIVIALLY_TRUE" }); continue; }
      if (DRAFT_DENY.test(txt)) { rejected.push({ symbol: e.name, reason: "DRAFT_USES_FORBIDDEN_API" }); continue; }
      drafts[e.name] = scrub(txt).replace(/\r/g, "");
    }
  }
  const L = [];
  L.push(`// Test scaffold generated by ATLASZ test-intelligence for ${r.rel} (source sha256 ${r.sha256.slice(0, 16)}).`);
  L.push("// EVERY test below FAILS on purpose (assert.fail with ATLASZ_SCAFFOLD_TODO) until a person writes real assertions and deletes that line.");
  if (model) L.push("// Model drafts (if any) sit BELOW the failing line, are UNREVIEWED and do not run until the TODO line is removed.");
  L.push('import test from "node:test";', 'import assert from "node:assert/strict";');
  if (hasDefault) L.push(`import defaultExport from ${JSON.stringify(spec)};`);
  if (named.length) L.push(`import { ${named.join(", ")} } from ${JSON.stringify(spec)};`);
  for (const e of ex) {
    const local = e.name === "default" ? "defaultExport" : e.name;
    L.push("", `test(${JSON.stringify(clean(e.signature) + " - TODO")}, async () => {`, `  // ${e.kind} declared at ${r.rel}:${e.line}; signature: ${clean(e.signature).replace(/\n/g, " ")}`);
    if (e.kind === "function") L.push(`  assert.equal(typeof ${local}, "function");`);
    L.push(`  assert.fail(${JSON.stringify("ATLASZ_SCAFFOLD_TODO:" + e.name + " - write real assertions for " + e.name + ", then delete this line")});`);
    if (drafts[e.name]) { L.push("  // --- model draft, UNREVIEWED ---"); for (const ln of drafts[e.name].split("\n")) L.push("  " + ln); }
    L.push("});");
  }
  const content = L.join("\n") + "\n";
  return { ok: true, testPath: tp, importSpecifier: spec, symbols: ex.map(e => ({ name: e.name, kind: e.kind, signature: clean(e.signature), params: e.params.map(clean), line: e.line })), content, contentSha256: sha256(content),
    failsUntilCompleted: true, written: false, authoring: model ? (Object.keys(drafts).length ? "MODEL_DRAFTS_UNREVIEWED" : "MODEL_DRAFTS_ALL_REJECTED") : MODEL_NOT_CONFIGURED, modelDrafts: Object.keys(drafts), modelRejected: rejected,
    note: "Text only. Nothing was written into the project; a person decides where (and whether) to save it." };
}

/** Append one coverage point (from findTestGaps) to a caller-owned JSONL file. Refused inside the analysed project. */
export function recordCoverageTrend({ stateFile, gaps, root = null, label = null, now = () => new Date().toISOString() } = {}) {
  if (typeof stateFile !== "string" || !path.isAbsolute(stateFile) || stateFile.includes("\0")) return { ok: false, reason: "STATE_FILE_MUST_BE_ABSOLUTE" };
  if (!gaps?.ok || !gaps.summary) return { ok: false, reason: "GAPS_RESULT_REQUIRED" };
  if (root) { const rr = realRoot(root); if (rr.ok) { const dir = (() => { try { return fs.realpathSync(path.dirname(stateFile)); } catch { return path.resolve(path.dirname(stateFile)); } })(); if (dir === rr.real || dir.startsWith(rr.real + path.sep)) return { ok: false, reason: "STATE_FILE_INSIDE_ANALYSED_PROJECT" }; } }
  try { const st = fs.lstatSync(stateFile); if (st.isSymbolicLink() || !st.isFile()) return { ok: false, reason: "STATE_FILE_NOT_A_REGULAR_FILE" }; if (st.size > LIMITS.maxTrendBytes) return { ok: false, reason: "TREND_FILE_FULL" }; } catch { /* new file */ }
  const s = gaps.summary, point = { at: now(), label: label === null ? null : clean(label).slice(0, 80), graphHash: gaps.graphHash, exported: s.exported, tested: s.tested, untested: s.untested, ratio: s.ratio };
  fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.appendFileSync(stateFile, JSON.stringify(point) + "\n", { mode: 0o600 });
  return { ok: true, point };
}

export function readCoverageTrend({ stateFile, last = 50 } = {}) {
  let raw; try { const st = fs.lstatSync(stateFile); if (!st.isFile()) return { ok: false, reason: "STATE_FILE_NOT_A_REGULAR_FILE" }; if (st.size > LIMITS.maxTrendBytes * 2) return { ok: false, reason: "TREND_FILE_TOO_LARGE" }; raw = fs.readFileSync(stateFile, "utf8"); } catch { return { ok: true, points: [], malformed: 0, direction: "INSUFFICIENT_DATA" }; }
  const points = []; let malformed = 0;
  for (const l of raw.split("\n")) { if (!l.trim()) continue; try { const p = JSON.parse(l); if (p && typeof p === "object" && (p.ratio === null || Number.isFinite(p.ratio))) points.push(p); else malformed++; } catch { malformed++; } }
  const pts = points.slice(-Math.max(1, Math.min(last, 1000))), a = pts[pts.length - 2], b = pts[pts.length - 1];
  const delta = a && b && a.ratio !== null && b.ratio !== null ? +(b.ratio - a.ratio).toFixed(4) : null;
  return { ok: true, points: pts, malformed, latest: b ?? null, delta, direction: delta === null ? "INSUFFICIENT_DATA" : delta > 0 ? "IMPROVING" : delta < 0 ? "DECLINING" : "FLAT" };
}
