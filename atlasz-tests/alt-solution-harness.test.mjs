import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAltSolutionHarness, canonical, equivalent, normaliseSource, wrapperFor, LIMITS, LABEL } from "../atlasz-addons/alt-solution-harness.mjs";
import { createCodeSandbox } from "../atlasz-addons/code-sandbox.mjs";
import { tmp, rm } from "./helpers.mjs";

const BASE = tmp("alt-harness-");
process.on("exit", () => rm(BASE));
const sandbox = createCodeSandbox({ baseDir: path.join(BASE, "runs"), auditFile: path.join(BASE, "audit.jsonl") });
const NS = sandbox.capabilities().level === "NAMESPACE";
const needNs = { skip: !NS && "no OS-level sandbox isolation on this host: the harness refuses to run candidates (covered by the PROCESS_ONLY test)" };
const H = createAltSolutionHarness({ sandbox });
const SUM_TESTS = [{ id: "small", input: [1, 2, 3], expected: 6 }, { id: "empty", input: [], expected: 0 }, { id: "neg", input: [-5, 5, 10], expected: 10 }, { id: "secret-case", input: [100, 23], expected: 123, hidden: true }];
const GOOD = "function solve(a) { return a.reduce((s, x) => s + x, 0); }";
const SLOW = "function solve(a) { const t = Date.now(); while (Date.now() - t < 60) {} let s = 0; for (const x of a) s += x; return s; }";
const WRONG = "function solve(a) { return a.length; }";
const row = (r, id) => r.table.find(x => x.id === id);

test("ranks candidates by pass rate, then sandbox-measured runtime; reports output equivalence", needNs, async () => {
  const r = await H.run({ candidates: [{ id: "wrong", code: WRONG }, { id: "slow", code: SLOW }, { id: "good", code: GOOD }], tests: SUM_TESTS });
  assert.equal(r.ok, true); assert.equal(r.label, LABEL); assert.equal(r.isolation, "NAMESPACE"); assert.equal(r.executedOutsideSandbox, false);
  assert.deepEqual(r.table.map(x => x.id), ["good", "slow", "wrong"]); assert.deepEqual(r.table.map(x => x.rank), [1, 2, 3]);
  assert.equal(row(r, "good").passRate, 1); assert.equal(row(r, "wrong").passed, 1, "length equals the sum only for the empty input");
  assert.ok(row(r, "slow").wallMs > row(r, "good").wallMs);
  const pair = r.equivalence.find(p => p.a === "slow" && p.b === "good"); assert.equal(pair.sameOutput, 4);
  assert.equal(r.perTest.find(t => t.id === "small").distinctOutputs, 2);
});

test("hidden tests: inputs, expected and actual values never appear in the report", needNs, async () => {
  const r = await H.run({ candidates: [{ id: "good", code: GOOD }, { id: "wrong", code: WRONG }], tests: [{ input: [1], expected: 1 }, { id: "h1", input: [424242, 1], expected: 424243, hidden: true }] });
  const j = JSON.stringify(r); assert.ok(!j.includes("424242") && !j.includes("424243"));
  assert.equal(row(r, "good").hiddenPassed, 1); assert.equal(row(r, "wrong").hiddenPassed, 0); assert.deepEqual(r.hiddenTests[0].passedBy, ["good"]);
});

test("expected outputs never enter the sandbox: a candidate that reads everything it can still cannot see them", needNs, async () => {
  const snoop = "function solve() { const fs = require('fs'); let all = ''; for (const f of fs.readdirSync('.')) { try { all += fs.readFileSync(f, 'utf8'); } catch {} } const m = ['EXPECTED', 'MARKER', '77'].join('-'); return all.includes(m) ? m : 'not found'; }";
  const r = await H.run({ candidates: [{ id: "snoop", code: snoop }], tests: [{ input: 1, expected: "EXPECTED-MARKER-77" }] });
  assert.equal(row(r, "snoop").passed, 0); assert.equal(r.perTest[0].results[0].actual, "not found");
});

test("timeouts, output floods, exceptions, syntax errors and a missing entry are contained per candidate", needNs, async () => {
  const r = await H.run({ timeoutMs: 1500, tests: SUM_TESTS.slice(0, 2), candidates: [
    { id: "loop", code: "function solve() { for (;;) {} }" }, { id: "flood", code: "function solve() { for (;;) console.log('x'.repeat(10000)); }" },
    { id: "throws", code: "function solve() { throw new Error('boom'); }" }, { id: "syntax", code: "function solve( {" }, { id: "noentry", code: "function other() { return 1; }" }, { id: "good", code: GOOD }] });
  assert.equal(r.table[0].id, "good");
  assert.equal(row(r, "loop").status, "TIMEOUT"); assert.equal(row(r, "flood").status, "OUTPUT_LIMIT");
  const th = r.perTest[0].results.find(x => x.candidate === "throws"); assert.equal(th.status, "ERROR"); assert.equal(th.error, "boom");
  assert.equal(row(r, "syntax").status, "LOAD_FAILED"); assert.equal(row(r, "noentry").status, "LOAD_FAILED");
  for (const id of ["loop", "flood", "throws", "syntax", "noentry"]) assert.equal(row(r, id).passed, 0, id);
});

test("adversarial: a candidate that forges result lines (after reading the nonce from its own file) gets AMBIGUOUS_OUTPUT", needNs, async () => {
  const forger = "function solve(x) { const src = require('fs').readFileSync('main.js', 'utf8'); const n = /const N = \"([0-9a-f]+)\"/.exec(src)[1]; process.stdout.write(n + ' ' + JSON.stringify({ i: 0, ms: 0, err: null, out: '6' }) + '\\n'); return 999; }";
  const r = await H.run({ candidates: [{ id: "forger", code: forger }], tests: SUM_TESTS.slice(0, 1) });
  assert.equal(r.perTest[0].results[0].status, "AMBIGUOUS_OUTPUT"); assert.equal(row(r, "forger").passed, 0);
});

test("ESM / CommonJS / async candidates and numeric tolerance", needNs, async () => {
  const r = await H.run({ tolerance: 1e-9, tests: [{ input: [0.1, 0.2], expected: 0.3 }], candidates: [
    { id: "esm", code: "export function solve(a) { return a[0] + a[1]; }" }, { id: "dflt", code: "export default (a) => a[0] + a[1];" },
    { id: "cjs", code: "module.exports = { solve: a => a[0] + a[1] };" }, { id: "async", code: "async function solve(a) { await null; return a[0] + a[1]; }" }] });
  for (const id of ["esm", "dflt", "cjs", "async"]) assert.equal(row(r, id).passed, 1, id);
  const strict = await H.run({ tests: [{ input: [0.1, 0.2], expected: 0.3 }], candidates: [{ id: "esm", code: "export function solve(a) { return a[0] + a[1]; }" }] });
  assert.equal(strict.table[0].passed, 0, "without tolerance 0.1+0.2 !== 0.3");
});

test("without OS-level isolation every candidate is NOT_RUN; the harness never requests a process-only run", async () => {
  const po = createCodeSandbox({ baseDir: path.join(BASE, "po"), forceLevel: "PROCESS_ONLY" });
  const r = await createAltSolutionHarness({ sandbox: po }).run({ candidates: [{ id: "good", code: GOOD }], tests: SUM_TESTS });
  assert.equal(r.ok, true); assert.equal(r.table[0].status, "NOT_RUN"); assert.equal(r.table[0].reason, "ISOLATION_NOT_AVAILABLE_NEEDS_OWNER_APPROVAL"); assert.equal(r.table[0].rank, null);
  assert.equal(po.history().at(-1).status, "ISOLATION_NOT_AVAILABLE_NEEDS_OWNER_APPROVAL");
});

test("mutation-style check with a recording fake sandbox: no process-only flag, only inputs on stdin, one run per candidate", async () => {
  const calls = [];
  const fake = { capabilities: () => ({ level: "NAMESPACE" }), run: async (req, opts) => { calls.push({ req, opts }); return { status: "OK", stdout: "", stderr: "", durationMs: 5 }; } };
  await createAltSolutionHarness({ sandbox: fake }).run({ candidates: [{ id: "a", code: GOOD }, { id: "b", code: WRONG }], tests: [{ input: [1], expected: "EXPECTED-ONLY-ON-HOST" }] });
  assert.equal(calls.length, 2);
  for (const c of calls) { assert.equal(c.opts.allowProcessOnly, undefined); assert.equal(c.req.language, "javascript"); assert.ok(!c.req.stdin.includes("EXPECTED-ONLY-ON-HOST")); assert.ok(!c.req.code.includes("EXPECTED-ONLY-ON-HOST")); assert.ok(c.req.timeoutMs <= LIMITS.maxTimeoutMs); }
  const src = fs.readFileSync(fileURLToPath(new URL("../atlasz-addons/alt-solution-harness.mjs", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /node:(?:vm|child_process|worker_threads)|\beval\s*\(|new Function|allowProcessOnly\s*:/);
});

test("input validation fails closed", async () => {
  const f = { capabilities: () => ({ level: "NAMESPACE" }), run: async () => { throw new Error("must not run"); } }, h = createAltSolutionHarness({ sandbox: f });
  const t = [{ input: 1, expected: 1 }];
  assert.equal((await h.run({ candidates: [], tests: t })).reason, "CANDIDATES_REQUIRED");
  assert.equal((await h.run({ candidates: Array.from({ length: 11 }, (_, i) => ({ id: "c" + i, code: GOOD })), tests: t })).reason, "TOO_MANY_CANDIDATES");
  assert.equal((await h.run({ candidates: [{ id: "a", code: GOOD }], tests: [] })).reason, "TESTS_REQUIRED");
  assert.equal((await h.run({ candidates: [{ id: "a", code: GOOD }], tests: [{ input: 1 }] })).reason, "TEST_INVALID:0");
  assert.equal((await h.run({ candidates: [{ id: "a", code: GOOD }], tests: t, entry: "solve();process.exit()" })).reason, "ENTRY_INVALID");
  assert.equal((await h.run({ candidates: [{ id: "a", code: GOOD }], tests: t, tolerance: -1 })).reason, "TOLERANCE_INVALID");
  assert.equal((await h.run({ candidates: [{ id: "a", code: GOOD }], tests: [{ input: "x".repeat(LIMITS.maxInputBytes), expected: 1 }] })).reason, "TEST_INPUTS_TOO_LARGE");
  assert.equal((await h.run({ candidates: [{ id: "a", code: GOOD }], tests: [{ input: 10n, expected: 1 }] })).reason, "TEST_INPUT_NOT_JSON");
  assert.equal((await h.run({ candidates: [{ id: "a", code: GOOD }, { id: "a", code: WRONG }], tests: t })).reason, "DUPLICATE_CANDIDATE_ID");
  const bad = await createAltSolutionHarness({ sandbox: { ...f, run: async () => ({ status: "OK", stdout: "" }) } }).run({ candidates: [{ id: "../x", code: GOOD }, { id: "big", code: "x".repeat(LIMITS.maxCandidateBytes + 1) }, { id: "none" }], tests: t });
  assert.deepEqual(bad.table.map(x => x.reason).sort(), ["CANDIDATE_ID_INVALID", "CODE_OR_FILE_REQUIRED", "CODE_TOO_LARGE"]);
  assert.throws(() => createAltSolutionHarness({}), /SANDBOX_REQUIRED/);
});

test("file candidates: only inside the configured root, only .js/.mjs/.cjs, no symlink escape", async () => {
  const root = path.join(BASE, "cands"); fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "ok.js"), GOOD); fs.writeFileSync(path.join(root, "notes.txt"), GOOD); fs.writeFileSync(path.join(BASE, "outside.js"), GOOD);
  let linked = true; try { fs.symlinkSync(path.join(BASE, "outside.js"), path.join(root, "link.js")); } catch { linked = false; }
  const fake = { capabilities: () => ({ level: "NAMESPACE" }), run: async () => ({ status: "OK", stdout: "", durationMs: 1 }) };
  const r = await createAltSolutionHarness({ sandbox: fake, candidateRoot: root }).run({ tests: [{ input: [1], expected: 1 }], candidates: [{ id: "ok", file: "ok.js" }, { id: "txt", file: "notes.txt" }, { id: "up", file: "../outside.js" }, ...(linked ? [{ id: "link", file: "link.js" }] : []), { id: "missing", file: "nope.js" }] });
  const reason = id => row(r, id).reason;
  assert.equal(reason("ok"), undefined); assert.equal(reason("txt"), "FILE_TYPE_NOT_ALLOWED"); assert.equal(reason("up"), "FILE_OUTSIDE_ROOT"); assert.equal(reason("missing"), "FILE_NOT_FOUND"); if (linked) assert.equal(reason("link"), "FILE_OUTSIDE_ROOT");
  assert.equal((await createAltSolutionHarness({ sandbox: fake }).run({ tests: [{ input: 1, expected: 1 }], candidates: [{ id: "f", file: "ok.js" }] })).table[0].reason, "CANDIDATE_ROOT_NOT_CONFIGURED");
});

test("comparison helpers: canonical JSON, tolerance, nested structures, source normalisation, wrapper shape", () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
  assert.equal(equivalent({ a: [1, 2.0000001] }, { a: [1, 2] }, 1e-6), true); assert.equal(equivalent({ a: [1, 2.1] }, { a: [1, 2] }, 1e-6), false);
  assert.equal(equivalent([1], { 0: 1 }), false); assert.equal(equivalent({ a: 1 }, { a: 1, b: undefined }), false); assert.equal(equivalent(null, 0), false);
  assert.equal(normaliseSource("export default function (x) { return x; }"), "module.exports = function (x) { return x; }");
  assert.match(normaliseSource("  export const solve = x => x;"), /^ {2}const solve/);
  const w = wrapperFor("function solve(){}", "solve", "abc123"); assert.match(w, /const N = "abc123"/); assert.match(w, /typeof solve === "function"/);
});

// A host-side fake that "answers" for each candidate by reading the run nonce out of the wrapper (no code is executed): deterministic ranking checks.
function scriptedSandbox(script) {
  return { capabilities: () => ({ level: "NAMESPACE" }), run: async req => {
    const nonce = /const N = "([0-9a-f]+)"/.exec(req.code)[1], id = /\/\*ID:(\w+)\*\//.exec(req.code)[1], s = script[id];
    const lines = (s.lines ?? []).map(l => (typeof l === "string" ? l : nonce + " " + JSON.stringify(l))).join("\n");
    return { status: s.status ?? "OK", stdout: lines, stderr: "", durationMs: s.wallMs ?? 10 };
  } };
}
const cand = id => ({ id, code: "/*ID:" + id + "*/ function solve(x) { return x; }" });
const ok = (i, out, ms = 1) => ({ i, ms, err: null, out: JSON.stringify(out) });

test("ranking tie-breaks: sandbox wall time (not self-reported time), then code size, then id", async () => {
  const tests = [{ input: 1, expected: 1 }, { input: 2, expected: 2 }];
  const sb = scriptedSandbox({ fastLiar: { wallMs: 50, lines: [ok(0, 1, 0.001), ok(1, 2, 0.001)] }, honest: { wallMs: 20, lines: [ok(0, 1, 999), ok(1, 2, 999)] }, errs: { wallMs: 1, lines: [ok(0, 1), { i: 1, ms: 0, err: "x", out: null }] }, b: { wallMs: 20, lines: [ok(0, 1), ok(1, 2)] } });
  const r = await createAltSolutionHarness({ sandbox: sb }).run({ candidates: [cand("fastLiar"), cand("errs"), cand("honest"), cand("b")], tests });
  assert.deepEqual(r.table.map(x => x.id), ["b", "honest", "fastLiar", "errs"], "equal pass rate: lower sandbox wall time first, self-reported ms ignored; same wall time: shorter code, then id");
  assert.equal(row(r, "honest").selfReportedMs, 1998); assert.equal(row(r, "errs").passed, 1);
});

test("malformed, out-of-range and unparseable result lines are ignored or flagged; partial runs mark the rest NO_RESULT", async () => {
  const tests = [{ input: 1, expected: 1 }, { input: 2, expected: 2 }, { input: 3, expected: 3 }];
  const sb = scriptedSandbox({ messy: { status: "NONZERO_EXIT", lines: ["deadbeef " + JSON.stringify(ok(0, 1)), "garbage", { i: 99, ms: 0, err: null, out: "1" }, { i: -1 }, { i: 0, ms: 0, err: null, out: "{not json" }, ok(1, 2)] } });
  const r = await createAltSolutionHarness({ sandbox: sb }).run({ candidates: [cand("messy")], tests });
  assert.deepEqual(r.perTest.map(t => t.results[0].status), ["UNPARSEABLE_OUTPUT", "PASS", "NO_RESULT"]); assert.equal(r.table[0].status, "NONZERO_EXIT");
});

test("NOT_RUN candidates are listed last without a rank; visible FAIL shows the actual value, PASS does not", async () => {
  const sb = scriptedSandbox({ good: { lines: [ok(0, 1)] }, bad: { lines: [ok(0, 5)] }, busy: { status: "BUSY" } });
  const r = await createAltSolutionHarness({ sandbox: sb }).run({ candidates: [cand("busy"), cand("bad"), cand("good")], tests: [{ input: 1, expected: 1 }] });
  assert.deepEqual(r.table.map(x => [x.id, x.rank]), [["good", 1], ["bad", 2], ["busy", null]]); assert.equal(row(r, "busy").reason, "BUSY");
  const res = r.perTest[0].results; assert.equal(res.find(x => x.candidate === "bad").actual, 5); assert.equal("actual" in res.find(x => x.candidate === "good"), false);
});

test("candidate network access is blocked inside the namespace sandbox", needNs, async () => {
  const code = "async function solve() { const net = require('net'); return await new Promise(res => { const s = net.connect({ host: '192.0.2.1', port: 80 }); s.on('connect', () => res('CONNECTED')); s.on('error', e => res(e.code || 'ERR')); setTimeout(() => res('TIMEOUT'), 1500); }); }";
  const r = await H.run({ candidates: [{ id: "net", code }], tests: [{ input: 0, expected: "CONNECTED" }], timeoutMs: 4000 });
  assert.equal(row(r, "net").passed, 0); assert.notEqual(r.perTest[0].results[0].actual, "CONNECTED");
});
