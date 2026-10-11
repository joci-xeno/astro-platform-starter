// Independent architecture assessment (PKG150 O501 / AS06 / O506). Deterministic, offline, READ-ONLY: it reads a project folder and returns findings and plans; it never edits, moves or deletes a file.
//   assessArchitecture  static import graph -> import cycles (Tarjan SCC, iterative), fan-in / fan-out, layering violations against a DECLARED layer config, god-modules, dead modules,
//                       duplicate-code clusters (normalised token shingles, winnowed fingerprints, verified token-by-token so a hash collision is never reported), one ranked finding list with evidence.
//   planRefactor        splits a proposed multi-file change into small reviewable steps in dependency order (cycle members stay together), each with the test files to run (reverse import reach).
//                       The output is a PLAN (kind "PLAN", appliesChanges:false). Deleting a file that something outside the change still imports is reported as a blocker.
// Honest limits: only static relative imports are seen (dynamic/computed imports make "dead module" LOW confidence); duplicate detection is lexical (renamed identifiers match, reordered code does not);
// thresholds are heuristics, not quality verdicts. "No findings" means none by these rules on the files that were parsed.
import path from "node:path";
import { buildGraph, bfs, stronglyConnected, isTestFile, tokenize, readConfined, clean, sha256, canonical, W2_STATUS } from "./dev-assist-common.mjs";

export const LIMITS = Object.freeze({ maxLayers: 50, maxChange: 200, maxStepFiles: 20, maxFingerprints: 600000, maxFindings: 500, maxDupOccurrences: 12, maxDupPairs: 200, extendTokens: 20000 });
export const DEFAULTS = Object.freeze({ godLines: 800, godExports: 25, godFanIn: 20, godFanOut: 20, dupMinTokens: 60, dupK: 25, dupW: 8 });
export const STATUS = Object.freeze({ ...W2_STATUS, modelUse: "NONE_REQUIRED" });
const relOk = r => typeof r === "string" && r.length > 0 && r.length <= 400 && !/[\0\\]/.test(r) && !r.startsWith("/") && !/^[A-Za-z]:/.test(r) && !path.posix.normalize(r).split("/").includes("..");
const ENTRY = /(^|\/)(index|main|server|cli|app|worker|supervisor)\.(mjs|cjs|js|ts)$|(^|\/)(bin|scripts)\//;
const KEEP = new Set(["function", "return", "if", "else", "for", "while", "const", "let", "var", "new", "class", "await", "async", "try", "catch", "throw", "import", "export", "this", "true", "false", "null", "undefined", "of", "in", "typeof", "switch", "case", "break", "continue", "default"]);

function validateLayers(cfg) {
  if (cfg === null || cfg === undefined) return { ok: true, layers: null };
  if (!cfg || !Array.isArray(cfg.layers) || !cfg.layers.length || cfg.layers.length > LIMITS.maxLayers) return { ok: false, reason: "LAYER_CONFIG_INVALID" };
  const names = new Set(), layers = [];
  for (const l of cfg.layers) {
    if (!l || typeof l.name !== "string" || !/^[A-Za-z][\w-]{0,40}$/.test(l.name) || names.has(l.name)) return { ok: false, reason: "LAYER_NAME_INVALID_OR_DUPLICATE" };
    if (!Array.isArray(l.paths) || !l.paths.length || l.paths.some(p => !relOk(p))) return { ok: false, reason: "LAYER_PATHS_INVALID:" + l.name };
    names.add(l.name); layers.push({ name: l.name, paths: l.paths.map(p => path.posix.normalize(p)) });
  }
  let allow = null;
  if (cfg.allow) { allow = {}; for (const [k, v] of Object.entries(cfg.allow)) { if (!names.has(k) || !Array.isArray(v) || v.some(x => !names.has(x))) return { ok: false, reason: "LAYER_ALLOW_INVALID:" + clean(k) }; allow[k] = new Set([k, ...v]); } }
  return { ok: true, layers, allow };
}
const layerOf = (L, rel) => { let best = null, len = -1; for (const l of L.layers) for (const p of l.paths) { const pre = p.endsWith("/") ? p : p + "/"; if ((rel === p || rel.startsWith(pre)) && p.length > len) { best = l.name; len = p.length; } } return best; };
const importLine = (g, from, to) => g.files.get(from)?.imports.find(i => i.resolved === to)?.line ?? null;

function cyclePath(edges, comp) {     // one concrete cycle through comp[0], as evidence
  const set = new Set(comp), start = comp[0], prev = new Map([[start, null]]), q = [start];
  for (let h = 0; h < q.length; h++) { const u = q[h]; for (const v of [...(edges.get(u) ?? [])].sort()) { if (!set.has(v)) continue; if (v === start) { const p = [start]; for (let x = u; x !== null && x !== start; x = prev.get(x)) p.splice(1, 0, x); return [...p, start]; } if (!prev.has(v)) { prev.set(v, u); q.push(v); } } }
  return comp;
}

function normTokens(text) {
  const { tokens } = tokenize(text);
  return tokens.map(t => ({ k: t.t === "id" ? (KEEP.has(t.v) ? t.v : "I") : t.t === "str" ? "S" : t.t === "num" ? "N" : t.t === "tpl" ? "T" : t.t === "re" ? "R" : t.v, line: t.line }));
}

function duplicates(g, { dupMinTokens, dupK, dupW }) {
  const docs = [], fp = new Map(); let fpCount = 0, capped = false;
  const ids = new Map(), idOf = k => { let v = ids.get(k); if (v === undefined) { v = ids.size + 1; ids.set(k, v); } return v; };
  for (const [rel, m] of [...g.files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (isTestFile(rel)) continue;
    const nt = normTokens(m.text); if (nt.length < dupK) continue;
    const di = docs.length; docs.push({ rel, nt, ints: nt.map(t => idOf(t.k)) });
    const ints = docs[di].ints, hs = [];
    for (let i = 0; i + dupK <= ints.length; i++) { let h1 = 0, h2 = 0; for (let j = i; j < i + dupK; j++) { h1 = (h1 * 31 + ints[j]) % 1000000007; h2 = (h2 * 37 + ints[j]) % 998244353; } hs.push(h1 * 1e9 + h2); }   // O(n*k), k small
    let lastPick = -1;
    for (let s = 0; s + dupW <= hs.length || (s === 0 && hs.length); s++) {
      let mi = s; const end = Math.min(s + dupW, hs.length); for (let j = s; j < end; j++) if (hs[j] <= hs[mi]) mi = j;
      if (mi !== lastPick) { lastPick = mi; if (fpCount >= LIMITS.maxFingerprints) { capped = true; break; } const arr = fp.get(hs[mi]) ?? []; if (arr.length <= LIMITS.maxDupOccurrences) arr.push([di, mi]); fp.set(hs[mi], arr); fpCount++; }
      if (end === hs.length) break;
    }
  }
  const regions = [], seen = new Set();
  const covered = (a, ia, b, ib) => regions.some(r => r.a === a && r.b === b && ia >= r.ia && ia < r.ia + r.len && ib - ia === r.ib - r.ia);
  for (const occ of fp.values()) {
    if (occ.length < 2 || occ.length > LIMITS.maxDupOccurrences) continue;          // ubiquitous boilerplate is not a duplicate cluster
    for (let x = 0; x < occ.length; x++) for (let y = x + 1; y < occ.length; y++) {
      let [a, ia] = occ[x], [b, ib] = occ[y]; if (a > b || (a === b && ia > ib)) { [a, ia, b, ib] = [b, ib, a, ia]; }
      if (a === b && Math.abs(ia - ib) < dupK) continue;
      const A = docs[a].ints, B = docs[b].ints; let ok = true; for (let j = 0; j < dupK; j++) if (A[ia + j] !== B[ib + j]) { ok = false; break; }
      if (!ok || covered(a, ia, b, ib)) continue;                                        // hash collision, or already inside a region
      let s = 0; while (s < LIMITS.extendTokens && ia - s - 1 >= 0 && ib - s - 1 >= 0 && A[ia - s - 1] === B[ib - s - 1]) s++;
      let len = dupK; while (len < LIMITS.extendTokens && ia + len < A.length && ib + len < B.length && A[ia + len] === B[ib + len]) len++;
      if (a === b) len = Math.min(len + s, ib - ia) - s;                                  // same file: the two regions must not overlap
      const r = { a, b, ia: ia - s, ib: ib - s, len: len + s }; const key = [a, b, r.ia, r.ib].join(":"); if (seen.has(key)) continue; seen.add(key);
      if (r.len >= dupMinTokens) regions.push(r);
      if (regions.length >= LIMITS.maxDupPairs) break;
    }
  }
  const clusters = new Map();
  for (const r of regions) {
    const A = docs[r.a], B = docs[r.b], sig = sha256(A.ints.slice(r.ia, r.ia + r.len).join(",")).slice(0, 16);
    const loc = (d, i) => ({ file: d.rel, startLine: d.nt[i].line, endLine: d.nt[Math.min(i + r.len - 1, d.nt.length - 1)].line });
    const c = clusters.get(sig) ?? { id: "dup-" + sig, tokens: r.len, members: [] };
    for (const l of [loc(A, r.ia), loc(B, r.ib)]) if (!c.members.some(m => m.file === l.file && m.startLine === l.startLine)) c.members.push(l);
    clusters.set(sig, c);
  }
  return { clusters: [...clusters.values()].sort((x, y) => y.tokens - x.tokens || (x.id < y.id ? -1 : 1)), capped };
}

/** Read-only architecture assessment with a ranked, evidenced finding list. */
export function assessArchitecture({ root, layers = null, entries = [], thresholds = {} } = {}) {
  const L = validateLayers(layers); if (!L.ok) return L;
  if (!Array.isArray(entries) || entries.some(e => !relOk(e))) return { ok: false, reason: "ENTRIES_INVALID" };
  const T = { ...DEFAULTS };
  for (const [k, v] of Object.entries(thresholds ?? {})) { if (!(k in DEFAULTS)) return { ok: false, reason: "UNKNOWN_THRESHOLD:" + clean(k) }; if (!Number.isInteger(v) || v < 1 || v > 1e6) return { ok: false, reason: "THRESHOLD_INVALID:" + k }; T[k] = v; }
  if (T.dupK < 5 || T.dupW < 1 || T.dupMinTokens < T.dupK) return { ok: false, reason: "DUPLICATE_PARAMETERS_INVALID" };
  const g = buildGraph(root); if (!g.ok) return g;
  const findings = [], add = f => { if (findings.length < LIMITS.maxFindings) findings.push(f); };
  const metrics = [...g.files.keys()].sort().map(rel => ({ file: rel, fanIn: g.reverse.get(rel).size, fanOut: g.edges.get(rel).size, lines: g.files.get(rel).lines, exports: g.files.get(rel).exports.length, layer: L.layers ? layerOf(L, rel) : null }));
  const byFile = new Map(metrics.map(m => [m.file, m]));
  // cycles
  const sccs = stronglyConnected(g.edges);
  for (const comp of sccs) { const cyc = cyclePath(g.edges, comp); add({ kind: "IMPORT_CYCLE", severity: "HIGH", score: 80 + Math.min(comp.length, 15), title: "Import cycle between " + comp.length + " module(s)", files: comp, evidence: { cycle: cyc, imports: cyc.slice(0, -1).map((f, i) => ({ from: f, to: cyc[i + 1], line: importLine(g, f, cyc[i + 1]) })) } }); }
  // layering
  let unlayered = 0;
  if (L.layers) {
    const order = new Map(L.layers.map((l, i) => [l.name, i]));
    for (const m of metrics) if (!m.layer && !isTestFile(m.file)) unlayered++;
    for (const [from, tos] of g.edges) { const lf = byFile.get(from).layer; if (!lf || isTestFile(from)) continue; for (const to of tos) { const lt = byFile.get(to).layer; if (!lt) continue; const allowed = L.allow ? (L.allow[lf]?.has(lt) ?? lf === lt) : order.get(lt) >= order.get(lf); if (!allowed) add({ kind: "LAYER_VIOLATION", severity: "HIGH", score: 75, title: `${lf} -> ${lt} is not allowed`, files: [from, to], evidence: { from, to, fromLayer: lf, toLayer: lt, line: importLine(g, from, to), rule: L.allow ? "ALLOW_LIST" : "ORDERED_LAYERS_DOWNWARD_ONLY" } }); } }
  }
  // god modules
  for (const m of metrics) {
    if (isTestFile(m.file)) continue;
    const hits = [m.lines > T.godLines && "LINES>" + T.godLines, m.exports > T.godExports && "EXPORTS>" + T.godExports, m.fanIn > T.godFanIn && "FAN_IN>" + T.godFanIn, m.fanOut > T.godFanOut && "FAN_OUT>" + T.godFanOut].filter(Boolean);
    if (hits.length >= 2) add({ kind: "GOD_MODULE", severity: "MEDIUM", score: 45 + 5 * hits.length, title: "Module concentrates too much: " + hits.join(", "), files: [m.file], evidence: { lines: m.lines, exports: m.exports, fanIn: m.fanIn, fanOut: m.fanOut, criteria: hits } });
  }
  // dead modules
  const dynamicSomewhere = [...g.files.values()].some(m => m.imports.some(i => i.kind === "dynamic-computed")) || g.unresolved.length > 0;
  let pkgEntries = []; const pjr = readConfined(g.root, "package.json", 262144), pj = pjr.ok ? (() => { try { return JSON.parse(pjr.text); } catch { return null; } })() : null;
  if (pj) pkgEntries = [pj.main, ...(typeof pj.bin === "string" ? [pj.bin] : Object.values(pj.bin ?? {}))].filter(x => typeof x === "string").map(x => path.posix.normalize(x));
  const entrySet = new Set([...entries.map(e => path.posix.normalize(e)), ...pkgEntries]);
  for (const m of metrics) {
    if (isTestFile(m.file) || entrySet.has(m.file) || ENTRY.test(m.file)) continue;
    const importers = [...g.reverse.get(m.file)];
    if (!importers.length) add({ kind: "DEAD_MODULE", severity: "LOW", score: 20, title: "No module imports this file", files: [m.file], evidence: { fanIn: 0, confidence: dynamicSomewhere ? "LOW_DYNAMIC_OR_UNRESOLVED_IMPORTS_PRESENT" : "MEDIUM_STATIC_IMPORTS_ONLY" } });
    else if (importers.every(isTestFile)) add({ kind: "TEST_ONLY_MODULE", severity: "INFO", score: 10, title: "Only tests import this file", files: [m.file], evidence: { importers } });
  }
  // duplicates
  const dup = duplicates(g, T);
  for (const c of dup.clusters) add({ kind: "DUPLICATE_CODE", severity: "MEDIUM", score: 40 + Math.min(30, Math.floor(c.tokens / 20)), title: `${c.members.length} near-identical regions of ~${c.tokens} tokens`, files: [...new Set(c.members.map(x => x.file))], evidence: { cluster: c.id, tokens: c.tokens, members: c.members } });
  findings.sort((a, b) => b.score - a.score || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.files[0] < b.files[0] ? -1 : a.files[0] > b.files[0] ? 1 : 0));
  findings.forEach((f, i) => { f.rank = i + 1; f.id = f.kind + ":" + sha256(canonical(f.files)).slice(0, 10); });
  const incomplete = g.walk.capped || g.notParsed.oversize + g.notParsed.binary + g.notParsed.unreadable + g.notParsed.pastFileLimit > 0 || dup.capped;
  const counts = {}; for (const f of findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  return { ok: true, graphHash: g.hash, verdict: incomplete ? "INCOMPLETE_ASSESSMENT" : findings.some(f => f.severity !== "INFO") ? "FINDINGS_BY_THESE_RULES" : "NO_FINDINGS_BY_THESE_RULES", counts, findings,
    metrics: { modules: metrics.length, edges: [...g.edges.values()].reduce((a, s) => a + s.size, 0), cycles: sccs.length, unlayered: L.layers ? unlayered : null, topFanIn: [...metrics].sort((a, b) => b.fanIn - a.fanIn || (a.file < b.file ? -1 : 1)).slice(0, 10).map(m => ({ file: m.file, fanIn: m.fanIn })), topFanOut: [...metrics].sort((a, b) => b.fanOut - a.fanOut || (a.file < b.file ? -1 : 1)).slice(0, 10).map(m => ({ file: m.file, fanOut: m.fanOut })), perModule: metrics },
    graph: { unresolvedImports: g.unresolved, escapes: g.escapes, external: g.external, notParsed: g.notParsed, capped: g.walk.capped }, thresholds: T, readOnly: true };
}

/** Split a proposed multi-file change into small reviewable steps with the tests to run after each. Returns a PLAN; never edits files. */
export function planRefactor({ root, change, maxFilesPerStep = 3 } = {}) {
  const items = change?.files;
  if (!Array.isArray(items) || !items.length) return { ok: false, reason: "CHANGE_FILES_REQUIRED" };
  if (items.length > LIMITS.maxChange) return { ok: false, reason: "CHANGE_TOO_LARGE", max: LIMITS.maxChange };
  if (!Number.isInteger(maxFilesPerStep) || maxFilesPerStep < 1 || maxFilesPerStep > LIMITS.maxStepFiles) return { ok: false, reason: "MAX_FILES_PER_STEP_INVALID" };
  const g = buildGraph(root); if (!g.ok) return g;
  const norm = [], seen = new Set();
  for (const it of items) {
    if (!it || !["modify", "create", "delete", "move"].includes(it.action)) return { ok: false, reason: "ACTION_INVALID" };
    if (!relOk(it.path) || (it.action === "move" && !relOk(it.to))) return { ok: false, reason: "PATH_TRAVERSAL_OR_INVALID_PATH_REFUSED", path: clean(it.path) };
    const p = path.posix.normalize(it.path); if (seen.has(p)) return { ok: false, reason: "DUPLICATE_PATH:" + p }; seen.add(p);
    const exists = g.allFiles.includes(p);
    if ((it.action === "create" && exists) || (it.action !== "create" && !exists)) return { ok: false, reason: (it.action === "create" ? "CREATE_TARGET_EXISTS:" : "FILE_NOT_FOUND:") + p };
    norm.push({ path: p, action: it.action, to: it.to ? path.posix.normalize(it.to) : null, description: clean(it.description ?? "").slice(0, 160), dependsOn: Array.isArray(it.dependsOn) ? it.dependsOn.filter(relOk).map(x => path.posix.normalize(x)) : [] });
  }
  const inChange = new Set(norm.map(n => n.path)), blockers = [], warnings = [];
  // dependency edges inside the change (A depends on B => B goes first)
  const dep = new Map(norm.map(n => [n.path, new Set([...(g.edges.get(n.path) ?? [])].filter(x => inChange.has(x)).concat(n.dependsOn.filter(x => inChange.has(x) && x !== n.path)))]));
  for (const n of norm) {
    if (n.action === "delete" || n.action === "move") {
      const importers = [...(g.reverse.get(n.path) ?? [])].filter(x => !inChange.has(x)).sort();
      if (importers.length) (n.action === "delete" ? blockers : warnings).push({ kind: n.action === "delete" ? "DELETE_HAS_REMAINING_IMPORTERS" : "MOVE_REQUIRES_IMPORT_UPDATES_OUTSIDE_CHANGE", file: n.path, importers });
      for (const imp of (g.reverse.get(n.path) ?? [])) if (inChange.has(imp)) { dep.get(n.path).add(imp); dep.get(imp).delete(n.path); }     // importers are edited before the file they import disappears
    }
  }
  // condensation (cycle members together) then topological order, deterministic
  const comps = stronglyConnected(dep), compOf = new Map(); comps.forEach((c, i) => c.forEach(f => compOf.set(f, "c" + i)));
  for (const n of norm) if (!compOf.has(n.path)) compOf.set(n.path, n.path);
  const groups = new Map(); for (const n of norm) { const k = compOf.get(n.path); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
  const gdeps = new Map([...groups.keys()].map(k => [k, new Set()]));
  for (const [f, ds] of dep) for (const d of ds) { const a = compOf.get(f), b = compOf.get(d); if (a !== b) gdeps.get(a).add(b); }
  const rankAct = gr => Math.max(...gr.map(n => ({ create: 0, modify: 1, move: 2, delete: 3 })[n.action]));
  const done = new Set(), order = [];
  for (let guard = 0; order.length < groups.size && guard <= groups.size; guard++) {
    const ready = [...groups.keys()].filter(k => !done.has(k) && [...gdeps.get(k)].every(d => done.has(d))).sort((a, b) => rankAct(groups.get(a)) - rankAct(groups.get(b)) || (a < b ? -1 : 1));
    if (!ready.length) break;
    for (const k of ready) { done.add(k); order.push(k); }
  }
  for (const k of groups.keys()) if (!done.has(k)) order.push(k);           // unreachable by construction (SCCs removed cycles); kept for safety
  const steps = []; let cur = [];
  const flush = () => { if (cur.length) { steps.push(cur); cur = []; } };
  for (const k of order) { const gr = groups.get(k).sort((a, b) => (a.path < b.path ? -1 : 1)); if (gr.length > 1 && gr.length > maxFilesPerStep) { flush(); steps.push(gr); warnings.push({ kind: "CYCLE_FORCES_LARGER_STEP", files: gr.map(x => x.path) }); continue; } if (cur.length + gr.length > maxFilesPerStep) flush(); cur.push(...gr); }
  flush();
  const testsFor = files => { const d = bfs(g.reverse, files.filter(f => g.files.has(f))); return [...d.keys()].filter(isTestFile).sort(); };
  const out = steps.map((st, i) => {
    const files = st.map(n => n.path), tests = [...new Set([...testsFor(files), ...files.filter(isTestFile)])].sort(), creates = st.filter(n => n.action === "create");
    return { step: i + 1, changes: st.map(n => ({ path: n.path, action: n.action, ...(n.to ? { to: n.to } : {}), description: n.description, lines: g.files.get(n.path)?.lines ?? null })), testsToRun: tests,
      notes: [...(creates.length ? ["NEW_FILES_HAVE_NO_KNOWN_TESTS: add or name tests for " + creates.map(c => c.path).join(", ")] : []), ...(tests.length ? [] : ["NO_TEST_REACHES_THIS_STEP: review by hand or add tests first"])] };
  });
  out.push({ step: out.length + 1, changes: [], testsToRun: ["FULL_SUITE"], notes: ["Run the whole suite once all steps are done: static reach misses dynamic imports, fixtures and config."] });
  const plan = { kind: "PLAN", appliesChanges: false, graphHash: g.hash, maxFilesPerStep, steps: out, blockers, warnings, status: blockers.length ? "BLOCKED_SEE_BLOCKERS" : "READY_FOR_REVIEW" };
  return { ok: true, ...plan, planSha256: sha256(canonical(plan)), note: "A plan only. Nothing was edited. Each step is meant to be proposed, reviewed and approved through the normal code-edit workflow." };
}
