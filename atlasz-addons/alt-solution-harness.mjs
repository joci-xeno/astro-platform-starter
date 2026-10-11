// Alternative-solution test harness (PKG150 GE15 "alternative software solution testing").
// Runs several candidate JavaScript solutions against the SAME test cases, each candidate in ONE run of the existing restricted sandbox
// (code-sandbox.mjs: separate process, no network in NAMESPACE mode, private work dir, timeout + output caps). This module never evaluates candidate code
// itself (no vm, no eval, no child_process here) and never asks for a process-only run: if the sandbox cannot isolate, the candidate is NOT_RUN.
// Only test INPUTS enter the sandbox; expected outputs stay on the host and the comparison is done here, so a candidate cannot read the answers.
// Hidden tests: their inputs, expected and actual values are withheld from the report (only pass/fail counts). Runtime ranking uses the sandbox's own
// wall-clock measurement; the per-test times printed from inside the sandbox are labelled self-reported (a candidate could tamper with them).
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";

export const LIMITS = Object.freeze({ maxCandidates: 10, maxTests: 200, maxCandidateBytes: 90000, maxInputBytes: 90000, maxTimeoutMs: 30000, defaultTimeoutMs: 5000, maxErrorChars: 200 });
export const LABEL = "Sandboxed comparison on the supplied tests only. A pass rate is not proof of correctness.";
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, ENTRY = /^[A-Za-z_$][A-Za-z0-9_$]{0,40}$/;
const NOT_RUN = /^(?:ISOLATION_NOT_AVAILABLE|BUSY|REFUSED|INVALID|LANGUAGE_UNAVAILABLE|ERROR)/;
const sha = s => createHash("sha256").update(s).digest("hex");

/** Canonical JSON (sorted keys) so equal values hash equally regardless of key order. */
export function canonical(v, depth = 0) {
  if (depth > 50) return '"[too deep]"';
  if (Array.isArray(v)) return "[" + v.map(x => canonical(x, depth + 1)).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonical(v[k], depth + 1)).join(",") + "}";
  return JSON.stringify(v ?? null);
}
/** Deep equality with an absolute numeric tolerance. */
export function equivalent(a, b, tol = 0, depth = 0) {
  if (depth > 50) return false;
  if (typeof a === "number" && typeof b === "number") return a === b || Math.abs(a - b) <= tol;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => equivalent(x, b[i], tol, depth + 1));
  if (a && b && typeof a === "object" && typeof b === "object") { const ka = Object.keys(a).sort(), kb = Object.keys(b).sort(); return ka.length === kb.length && ka.every((k, i) => k === kb[i] && equivalent(a[k], b[k], tol, depth + 1)); }
  return a === b;
}
/** Accept plain scripts, CommonJS (module.exports) and simple ESM (`export function solve`, `export default`). */
export function normaliseSource(src) {
  return String(src).replace(/^\s*export\s+default\s+/m, "module.exports = ").replace(/^(\s*)export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/gm, "$1");
}
/** The program that runs INSIDE the sandbox: candidate code in its own function scope, then one result line per test prefixed with a run nonce. */
export function wrapperFor(code, entry, nonce) {
  return `// ATLASZ alt-solution harness wrapper
const __harness = (function () {
const module = { exports: {} }, exports = module.exports;
${code}
;return typeof ${entry} === "function" ? ${entry} : typeof module.exports === "function" ? module.exports : (module.exports && typeof module.exports.${entry} === "function" ? module.exports.${entry} : null);
})();
(function () {
  const N = ${JSON.stringify(nonce)}, put = s => process.stdout.write(N + " " + s + "\\n");
  let buf = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", c => { buf += c; });
  process.stdin.on("end", async () => {
    if (typeof __harness !== "function") { put(JSON.stringify({ load: "ENTRY_NOT_FOUND" })); return; }
    const tests = JSON.parse(buf);
    for (const t of tests) {
      const t0 = process.hrtime.bigint(); let out = null, err = null;
      try { out = __harness(t.input); if (out && typeof out.then === "function") out = await out; } catch (e) { err = String((e && e.message) || e).slice(0, ${LIMITS.maxErrorChars}); }
      let s = null; if (err === null) { try { s = JSON.stringify(out === undefined ? null : out); } catch { err = "UNSERIALIZABLE_OUTPUT"; } }
      put(JSON.stringify({ i: t.i, ms: Number(process.hrtime.bigint() - t0) / 1e6, err, out: s }));
    }
  });
})();
`;
}

export function createAltSolutionHarness({ sandbox, candidateRoot = null } = {}) {
  if (!sandbox || typeof sandbox.run !== "function" || typeof sandbox.capabilities !== "function") throw new Error("SANDBOX_REQUIRED");

  function loadCandidate(c) {
    if (!c || typeof c !== "object" || !ID.test(String(c.id ?? ""))) return { ok: false, reason: "CANDIDATE_ID_INVALID" };
    let src;
    if (typeof c.code === "string") src = c.code;
    else if (typeof c.file === "string") {
      if (!candidateRoot) return { ok: false, reason: "CANDIDATE_ROOT_NOT_CONFIGURED" };
      if (!/\.(?:js|mjs|cjs)$/.test(c.file)) return { ok: false, reason: "FILE_TYPE_NOT_ALLOWED" };
      let root, real; try { root = fs.realpathSync(candidateRoot); real = fs.realpathSync(path.resolve(root, c.file)); } catch { return { ok: false, reason: "FILE_NOT_FOUND" }; }
      if (!real.startsWith(root + path.sep)) return { ok: false, reason: "FILE_OUTSIDE_ROOT" };
      const st = fs.statSync(real); if (!st.isFile() || st.size > LIMITS.maxCandidateBytes) return { ok: false, reason: "FILE_INVALID_OR_TOO_LARGE" };
      src = fs.readFileSync(real, "utf8");
    } else return { ok: false, reason: "CODE_OR_FILE_REQUIRED" };
    if (!src.trim()) return { ok: false, reason: "CODE_EMPTY" };
    if (Buffer.byteLength(src) > LIMITS.maxCandidateBytes) return { ok: false, reason: "CODE_TOO_LARGE" };
    return { ok: true, id: c.id, code: normaliseSource(src), bytes: Buffer.byteLength(src), sha256: sha(src) };
  }

  /**
   * run({candidates:[{id, code}|{id, file}], tests:[{id?, input, expected, hidden?}], entry?, timeoutMs?, tolerance?}) -> ranked report. Never throws.
   */
  async function run({ candidates, tests, entry = "solve", timeoutMs = LIMITS.defaultTimeoutMs, tolerance = 0 } = {}) {
    const caps = sandbox.capabilities();
    const base = { label: LABEL, isolation: caps.level, executedOutsideSandbox: false };
    if (!Array.isArray(candidates) || candidates.length < 1) return { ok: false, reason: "CANDIDATES_REQUIRED", ...base };
    if (candidates.length > LIMITS.maxCandidates) return { ok: false, reason: "TOO_MANY_CANDIDATES", ...base };
    if (!Array.isArray(tests) || tests.length < 1) return { ok: false, reason: "TESTS_REQUIRED", ...base };
    if (tests.length > LIMITS.maxTests) return { ok: false, reason: "TOO_MANY_TESTS", ...base };
    if (!ENTRY.test(String(entry))) return { ok: false, reason: "ENTRY_INVALID", ...base };
    if (!(Number.isFinite(tolerance) && tolerance >= 0)) return { ok: false, reason: "TOLERANCE_INVALID", ...base };
    const T = []; for (let i = 0; i < tests.length; i++) { const t = tests[i]; if (!t || typeof t !== "object" || !("input" in t) || !("expected" in t)) return { ok: false, reason: "TEST_INVALID:" + i, ...base }; T.push({ i, id: String(t.id ?? "t" + (i + 1)).slice(0, 64), hidden: t.hidden === true, input: t.input, expected: t.expected }); }
    let stdin; try { stdin = JSON.stringify(T.map(t => ({ i: t.i, input: t.input }))); } catch { return { ok: false, reason: "TEST_INPUT_NOT_JSON", ...base }; }
    if (Buffer.byteLength(stdin) > LIMITS.maxInputBytes) return { ok: false, reason: "TEST_INPUTS_TOO_LARGE", ...base };
    const ids = new Set(); const loaded = [];
    for (const c of candidates) { const l = loadCandidate(c); if (l.ok && ids.has(l.id)) return { ok: false, reason: "DUPLICATE_CANDIDATE_ID", ...base }; if (l.ok) ids.add(l.id); loaded.push(l.ok ? l : { ...l, id: ID.test(String(c?.id ?? "")) ? c.id : "invalid-" + loaded.length }); }
    const to = Math.min(Math.max(Number(timeoutMs) || LIMITS.defaultTimeoutMs, 100), LIMITS.maxTimeoutMs);
    const rows = [];
    for (const c of loaded) {                                                   // sequential: the sandbox has its own concurrency cap
      if (!c.ok) { rows.push({ id: c.id, status: "NOT_RUN", reason: c.reason, results: T.map(t => ({ i: t.i, status: "NOT_RUN" })) }); continue; }
      const nonce = randomBytes(12).toString("hex");
      const r = await sandbox.run({ language: "javascript", code: wrapperFor(c.code, entry, nonce), stdin, timeoutMs: to }, { actor: "ALT_SOLUTION_HARNESS" });
      if (NOT_RUN.test(String(r.status))) { rows.push({ id: c.id, status: "NOT_RUN", reason: r.status, bytes: c.bytes, sha256: c.sha256, results: T.map(t => ({ i: t.i, status: "NOT_RUN" })) }); continue; }
      const lines = new Map(); let load = null, forged = new Set();
      for (const line of String(r.stdout ?? "").split("\n")) {
        if (!line.startsWith(nonce + " ")) continue;
        let o; try { o = JSON.parse(line.slice(nonce.length + 1)); } catch { continue; }
        if (o && o.load) { load = String(o.load).slice(0, 40); continue; }
        if (!o || !Number.isInteger(o.i) || o.i < 0 || o.i >= T.length) continue;
        if (lines.has(o.i)) forged.add(o.i); lines.set(o.i, o);
      }
      const loadFailed = load || (r.status === "NONZERO_EXIT" && lines.size === 0);
      const results = T.map(t => {
        if (forged.has(t.i)) return { i: t.i, status: "AMBIGUOUS_OUTPUT" };
        const o = lines.get(t.i);
        if (!o) return { i: t.i, status: loadFailed ? "LOAD_FAILED" : r.status === "TIMEOUT" ? "TIMEOUT" : r.status === "OUTPUT_LIMIT" ? "OUTPUT_LIMIT" : "NO_RESULT" };
        if (o.err !== null && o.err !== undefined) return { i: t.i, status: "ERROR", error: String(o.err).slice(0, LIMITS.maxErrorChars), selfReportedMs: Number(o.ms) || 0 };
        let out; try { out = JSON.parse(o.out); } catch { return { i: t.i, status: "UNPARSEABLE_OUTPUT" }; }
        return { i: t.i, status: equivalent(out, t.expected, tolerance) ? "PASS" : "FAIL", out, outSha256: sha(canonical(out)), selfReportedMs: Number(o.ms) || 0 };
      });
      rows.push({ id: c.id, status: loadFailed ? "LOAD_FAILED" : r.status === "OK" ? "COMPLETED" : r.status, sandboxStatus: r.status, wallMs: r.durationMs, bytes: c.bytes, sha256: c.sha256, stderr: String(r.stderr ?? "").slice(0, 300), loadError: load, results });
    }
    // ---- scoring, equivalence, ranking ----
    const visible = T.filter(t => !t.hidden), hidden = T.filter(t => t.hidden);
    const pass = (row, set) => set.filter(t => row.results[t.i].status === "PASS").length;
    const table = rows.map(row => ({ id: row.id, status: row.status, ...(row.reason ? { reason: row.reason } : {}), passed: pass(row, T), total: T.length, passRate: Math.round(pass(row, T) / T.length * 1000) / 1000,
      visiblePassed: pass(row, visible), visibleTotal: visible.length, hiddenPassed: pass(row, hidden), hiddenTotal: hidden.length,
      errors: row.results.filter(x => !["PASS", "FAIL"].includes(x.status)).length, wallMs: row.wallMs ?? null,
      selfReportedMs: Math.round(row.results.reduce((a, x) => a + (x.selfReportedMs ?? 0), 0) * 1000) / 1000, codeBytes: row.bytes ?? null, codeSha256: row.sha256 ?? null }));
    const ran = r => r.status !== "NOT_RUN";
    table.sort((a, b) => (ran(b) - ran(a)) || (b.passRate - a.passRate) || (a.errors - b.errors) || ((a.wallMs ?? Infinity) - (b.wallMs ?? Infinity)) || ((a.codeBytes ?? Infinity) - (b.codeBytes ?? Infinity)) || (a.id < b.id ? -1 : 1));
    table.forEach((r, i) => { r.rank = ran(r) ? i + 1 : null; });
    const sig = (row, t) => { const x = row.results[t.i]; return x.status === "PASS" || x.status === "FAIL" ? x.outSha256 : "STATUS:" + x.status; };
    const pairs = [];
    for (let a = 0; a < rows.length; a++) for (let b = a + 1; b < rows.length; b++) if (ran(rows[a]) && ran(rows[b])) pairs.push({ a: rows[a].id, b: rows[b].id, sameOutput: T.filter(t => sig(rows[a], t) === sig(rows[b], t)).length, total: T.length });
    const perTest = visible.map(t => ({ id: t.id, input: t.input, expected: t.expected, distinctOutputs: new Set(rows.filter(ran).map(r => sig(r, t))).size,
      results: rows.map(r => ({ candidate: r.id, status: r.results[t.i].status, ...(r.results[t.i].status === "FAIL" ? { actual: r.results[t.i].out } : {}), ...(r.results[t.i].error ? { error: r.results[t.i].error } : {}) })) }));
    const hiddenSummary = hidden.map(t => ({ id: t.id, distinctOutputs: new Set(rows.filter(ran).map(r => sig(r, t))).size, passedBy: rows.filter(r => r.results[t.i].status === "PASS").map(r => r.id) }));
    return { ok: true, ...base, entry, timeoutMs: to, tolerance, table, equivalence: pairs, perTest, hiddenTests: hiddenSummary,
      notes: ["wallMs is measured by the sandbox per candidate (includes process start-up); selfReportedMs comes from inside the sandbox and can be tampered with by a candidate.", "Hidden tests: inputs, expected and actual values are not reported."] };
  }
  return { run };
}
