import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { prioritizeTests, findTestGaps, generateTestScaffold, recordCoverageTrend, readCoverageTrend, STATUS } from "../atlasz-addons/test-intelligence.mjs";
import { tokenize, parseModule } from "../atlasz-addons/dev-assist-common.mjs";
import { tmp, rm } from "./helpers.mjs";

const write = (root, files) => { for (const [rel, c] of Object.entries(files)) { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); } return root; };
const treeHash = root => { const out = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(p + ":" + fs.readFileSync(p, "base64")); } }; walk(root); return out.join("\n"); };
const FIX = {
  "src/math.mjs": "export function add(a, b) { return a + b; }\nexport function sub(a, b = 0) { return a - b; }\nexport const PI = 3.14;\n",
  "src/fmt.mjs": 'import { add } from "./math.mjs";\nexport const show = (x, { digits = 2 } = {}) => add(x, 0).toFixed(digits);\nexport default function banner(title) { return "== " + title; }\n',
  "src/lonely.mjs": "export async function orphan(input) { return input; }\n",
  "src/index.mjs": 'export { show } from "./fmt.mjs";\nexport * from "./math.mjs";\n',
  "tests/math.test.mjs": 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../src/math.mjs";\ntest("add", () => assert.equal(add(1, 2), 3));\n',
  "tests/fmt.test.mjs": 'import test from "node:test";\nimport * as F from "../src/fmt.mjs";\nimport banner from "../src/fmt.mjs";\ntest("show", () => { F.show(1); banner("x"); });\n',
  "tests/unrelated.test.mjs": 'import test from "node:test";\n// mentions orphan by name only\nconst orphan = 1;\ntest("x", () => {});\n',
  "README.md": "# demo\n"
};

test("tokenizer: comments, strings, templates and regex literals never leak fake imports/exports", () => {
  const m = parseModule('// export function a() {}\n/* import x from "./c.mjs" */\nconst s = "export const b = 1";\nconst t = `${"import y from \'./d.mjs\'"} ${`x`}`;\nconst r = /export function c\\(/g;\nexport function real() {}\n');
  assert.deepEqual(m.exports.map(e => e.name), ["real"]); assert.equal(m.imports.length, 0);
  const t = tokenize("a = b / c / d; x = /re[/]x/.test(y)");
  assert.equal(t.tokens.filter(x => x.t === "re").length, 1);
  assert.equal(tokenize('"unterminated').unterminated, 1);
});

test("prioritizeTests ranks direct importers first, then transitive, then history-only; every entry has reasons", () => {
  const root = write(tmp("ti-"), FIX); try {
    const r = prioritizeTests({ root, changedFiles: ["src/math.mjs"], history: [{ file: "tests/unrelated.test.mjs", status: "FAILED", durationMs: 50 }] });
    assert.equal(r.ok, true);
    const by = Object.fromEntries(r.plan.map(p => [p.test, p]));
    assert.equal(by["tests/math.test.mjs"].depth, 1); assert.equal(by["tests/fmt.test.mjs"].depth, 2);
    assert.ok(by["tests/math.test.mjs"].rank < by["tests/fmt.test.mjs"].rank);
    assert.ok(by["tests/math.test.mjs"].reasons.includes("DIRECTLY_IMPORTS_CHANGED:src/math.mjs"));
    assert.ok(by["tests/fmt.test.mjs"].reasons.some(x => x.startsWith("REACHES_CHANGED_VIA_IMPORTS:src/math.mjs@depth2")));
    assert.ok(by["tests/unrelated.test.mjs"].reasons.includes("FAILED_LAST_RUN")); assert.equal(by["tests/unrelated.test.mjs"].decision, "RUN");
    assert.equal(r.recommendation, "RUN_SELECTED_THEN_FULL_SUITE_BEFORE_MERGE");
  } finally { rm(root); }
});

test("prioritizeTests: a changed test file outranks everything; budget defers the rest; no-signal tests are deferred not dropped", () => {
  const root = write(tmp("ti-"), FIX); try {
    const r = prioritizeTests({ root, changedFiles: ["tests/fmt.test.mjs", "src/math.mjs"], budgetMs: 1500 });
    assert.equal(r.plan[0].test, "tests/fmt.test.mjs"); assert.ok(r.plan[0].reasons.includes("TEST_FILE_ITSELF_CHANGED"));
    assert.deepEqual(r.selected, ["tests/fmt.test.mjs"]);
    assert.equal(r.plan.find(p => p.test === "tests/math.test.mjs").decision, "OVER_BUDGET_RUN_LATER");
    assert.equal(r.plan.find(p => p.test === "tests/unrelated.test.mjs").decision, "DEFERRED_NO_SIGNAL");
    assert.equal(r.testsTotal, 3); assert.equal(r.plan.length, 3);
  } finally { rm(root); }
});

test("prioritizeTests: changed files the graph cannot see force RUN_ALL; untested changed source is listed", () => {
  const root = write(tmp("ti-"), FIX); try {
    const r = prioritizeTests({ root, changedFiles: ["package.json", "src/lonely.mjs"] });
    assert.deepEqual(r.unknownImpact, ["package.json"]); assert.equal(r.recommendation, "RUN_ALL_AS_SAFETY_NET");
    assert.deepEqual(r.changedWithoutTests, ["src/lonely.mjs"]);
  } finally { rm(root); }
});

test("prioritizeTests: history failure rate, flakiness and duration shape the order; malformed history rows are ignored and counted", () => {
  const root = write(tmp("ti-"), FIX); try {
    const history = [
      { file: "tests/math.test.mjs", status: "PASSED", durationMs: 9000 }, { file: "tests/fmt.test.mjs", status: "FAILED", durationMs: 10 }, { file: "tests/fmt.test.mjs", status: "PASSED", durationMs: 10 },
      null, { file: "../escape.test.mjs", status: "FAILED" }, { file: "tests/x.test.mjs" }, "junk"
    ];
    const r = prioritizeTests({ root, changedFiles: [], history });
    assert.equal(r.history.ignored, 4); assert.equal(r.history.used, 3);
    const fmt = r.plan.find(p => p.test === "tests/fmt.test.mjs");
    assert.ok(fmt.reasons.includes("MIXED_RECENT_RESULTS_POSSIBLY_FLAKY")); assert.ok(fmt.reasons.includes("FAILURE_RATE:0.50"));
    assert.equal(r.plan.find(p => p.test === "tests/math.test.mjs").estDurationMs, 9000);
    assert.equal(r.plan[0].test, "tests/fmt.test.mjs");
  } finally { rm(root); }
});

test("prioritizeTests refuses path traversal, absolute paths, NUL, non-arrays and oversize change sets (fail closed)", () => {
  const root = write(tmp("ti-"), FIX); try {
    for (const bad of ["../etc/passwd", "/etc/passwd", "src/../../x", "a\0b", "C:/x", "src\\x.mjs", ""]) assert.equal(prioritizeTests({ root, changedFiles: [bad] }).ok, false, bad);
    assert.equal(prioritizeTests({ root, changedFiles: "src/math.mjs" }).reason, "CHANGED_FILES_MUST_BE_ARRAY");
    assert.equal(prioritizeTests({ root, changedFiles: Array.from({ length: 501 }, (_, i) => "f" + i) }).reason, "TOO_MANY_CHANGED_FILES");
    assert.equal(prioritizeTests({ root: path.join(root, "nope") }).ok, false);
  } finally { rm(root); }
});

test("findTestGaps: imported+used names are covered (named, namespace, default, via re-export); name-only mention is weak, not coverage", () => {
  const root = write(tmp("ti-"), FIX); try {
    const r = findTestGaps({ root });
    const sym = (f, n) => r.modules.find(m => m.file === f).exports.find(e => e.name === n);
    assert.equal(sym("src/math.mjs", "add").tested, true); assert.deepEqual(sym("src/math.mjs", "add").testedBy, ["tests/math.test.mjs"]);
    assert.equal(sym("src/math.mjs", "sub").tested, false); assert.equal(sym("src/fmt.mjs", "show").tested, true); assert.equal(sym("src/fmt.mjs", "default").tested, true);
    const orphan = sym("src/lonely.mjs", "orphan"); assert.equal(orphan.tested, false); assert.deepEqual(orphan.weakNameOnlyMatches, ["tests/unrelated.test.mjs"]);
    assert.equal(r.summary.exported, 6); assert.equal(r.summary.tested, 3);
    assert.deepEqual(r.untested.map(u => u.file + "#" + u.name).sort(), ["src/lonely.mjs#orphan", "src/math.mjs#PI", "src/math.mjs#sub"]);
    assert.equal(sym("src/math.mjs", "sub").signature, "sub(a, b = 0)");
  } finally { rm(root); }
});

test("findTestGaps: an import that is never used, and an import through an index re-export, are handled", () => {
  const root = write(tmp("ti-"), { ...FIX, "tests/idx.test.mjs": 'import { show, sub } from "../src/index.mjs";\nsub(3, 1);\n', "tests/unused.test.mjs": 'import { PI } from "../src/math.mjs";\n' }); try {
    const r = findTestGaps({ root }), sym = (f, n) => r.modules.find(m => m.file === f).exports.find(e => e.name === n);
    assert.equal(sym("src/math.mjs", "sub").tested, true, "sub reached through export * from index");
    assert.ok(sym("src/math.mjs", "sub").testedBy.includes("tests/idx.test.mjs"));
    assert.equal(sym("src/math.mjs", "PI").tested, false, "imported but never referenced is not coverage");
  } finally { rm(root); }
});

test("generateTestScaffold: parsed signatures, correct import path, and the scaffold FAILS when run (cannot fake coverage)", async () => {
  const root = write(tmp("ti-"), FIX); try {
    const s = await generateTestScaffold({ root, file: "src/math.mjs" });
    assert.equal(s.ok, true); assert.equal(s.authoring, "MODEL_NOT_CONFIGURED"); assert.equal(s.written, false); assert.equal(s.testPath, "tests/math.test.mjs");
    assert.deepEqual(s.symbols.map(x => x.signature), ["add(a, b)", "sub(a, b = 0)", "PI"]);
    assert.match(s.content, /import \{ add, sub, PI \} from "\.\.\/src\/math\.mjs";/);
    assert.equal((s.content.match(/assert\.fail\("ATLASZ_SCAFFOLD_TODO:/g) ?? []).length, 3);
    const out = path.join(root, "tests", "scaffold.test.mjs"); fs.writeFileSync(out, s.content);
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; const run = spawnSync(process.execPath, ["--test", out], { encoding: "utf8", timeout: 60000, env });
    assert.notEqual(run.status, 0, "scaffold must fail until completed"); assert.match(run.stdout + run.stderr, /fail 3/);
    // and the gap finder does not count the scaffold as coverage
    const g = findTestGaps({ root }); const sub = g.modules.find(m => m.file === "src/math.mjs").exports.find(e => e.name === "sub");
    assert.equal(sub.tested, false); assert.deepEqual(sub.scaffoldOnly, ["tests/scaffold.test.mjs"]);
  } finally { rm(root); }
});

test("generateTestScaffold: default export, symbol filter, traversal/oversize/binary refused, project untouched", async () => {
  const root = write(tmp("ti-"), { ...FIX, "src/big.mjs": "export const x = 1;\n" + "//" + "a".repeat(600 * 1024), "src/bin.mjs": Buffer.from([0, 1, 2, 3]) }); try {
    const before = treeHash(root);
    const s = await generateTestScaffold({ root, file: "src/fmt.mjs", symbols: ["default"], testPath: "spec/fmt.test.mjs" });
    assert.match(s.content, /import defaultExport from "\.\.\/src\/fmt\.mjs";/); assert.deepEqual(s.symbols.map(x => x.name), ["default"]);
    assert.equal((await generateTestScaffold({ root, file: "../outside.mjs" })).reason, "PATH_TRAVERSAL_REFUSED");
    assert.equal((await generateTestScaffold({ root, file: "src/big.mjs" })).reason, "FILE_TOO_LARGE");
    assert.equal((await generateTestScaffold({ root, file: "src/bin.mjs" })).reason, "BINARY_FILE_REFUSED");
    assert.equal((await generateTestScaffold({ root, file: "src/math.mjs", testPath: "../x.test.mjs" })).reason, "TEST_PATH_INVALID");
    assert.equal((await generateTestScaffold({ root, file: "src/math.mjs", symbols: ["nope"] })).reason, "NO_EXPORTED_SYMBOLS_SELECTED");
    assert.equal(treeHash(root), before, "read-only on the project");
  } finally { rm(root); }
});

test("generateTestScaffold with a model: drafts stay below the failing line; trivial, forbidden, throwing and slow drafts are rejected", async () => {
  const root = write(tmp("ti-"), FIX); try {
    const model = { draftAssertions: async ({ symbol }) => ({ add: "assert.equal(add(2, 3), 5);", sub: "assert.ok(true);", PI: "require('child_process'); assert.equal(PI, 3.14);" })[symbol] };
    const s = await generateTestScaffold({ root, file: "src/math.mjs", model });
    assert.equal(s.authoring, "MODEL_DRAFTS_UNREVIEWED"); assert.deepEqual(s.modelDrafts, ["add"]);
    assert.deepEqual(s.modelRejected.map(x => x.symbol + ":" + x.reason), ["sub:DRAFT_ASSERTION_TRIVIALLY_TRUE", "PI:DRAFT_USES_FORBIDDEN_API"]);
    const i = s.content.indexOf("assert.equal(add(2, 3), 5)"), f = s.content.indexOf("ATLASZ_SCAFFOLD_TODO:add"); assert.ok(f > 0 && i > f, "draft is after the failing TODO line");
    const thrower = await generateTestScaffold({ root, file: "src/math.mjs", symbols: ["add"], model: { draftAssertions: () => { throw new Error("boom"); } } });
    assert.equal(thrower.ok, true); assert.equal(thrower.authoring, "MODEL_DRAFTS_ALL_REJECTED");
    assert.equal((await generateTestScaffold({ root, file: "src/math.mjs", model: {} })).reason, "MODEL_ADAPTER_INVALID:draftAssertions_REQUIRED");
    const leak = await generateTestScaffold({ root, file: "src/math.mjs", symbols: ["add"], model: { draftAssertions: () => 'const k = "s' + 'k-ABCDEFGHIJKLMNOPQRSTUV123"; assert.equal(add(1, 1), 2);' } });
    assert.ok(!leak.content.includes("ABCDEFGHIJKLMNOPQRSTUV123"), "secrets in model output are scrubbed");
  } finally { rm(root); }
});

test("coverage trend: append, read, direction; refused inside the project; malformed lines counted", () => {
  const root = write(tmp("ti-"), FIX), state = tmp("ti-state-"); try {
    const file = path.join(state, "trend.jsonl"); let t = 0; const now = () => new Date(Date.UTC(2026, 0, 1) + t++ * 1000).toISOString();
    const g1 = findTestGaps({ root });
    assert.equal(recordCoverageTrend({ stateFile: file, gaps: g1, root, now }).ok, true);
    write(root, { "tests/sub.test.mjs": 'import { sub } from "../src/math.mjs";\nsub(1);\n' });
    assert.equal(recordCoverageTrend({ stateFile: file, gaps: findTestGaps({ root }), root, now, label: "after" }).ok, true);
    fs.appendFileSync(file, "{not json\n");
    const tr = readCoverageTrend({ stateFile: file });
    assert.equal(tr.points.length, 2); assert.equal(tr.malformed, 1); assert.equal(tr.direction, "IMPROVING"); assert.ok(tr.delta > 0);
    assert.equal(recordCoverageTrend({ stateFile: path.join(root, "trend.jsonl"), gaps: g1, root }).reason, "STATE_FILE_INSIDE_ANALYSED_PROJECT");
    assert.equal(recordCoverageTrend({ stateFile: "relative.jsonl", gaps: g1 }).reason, "STATE_FILE_MUST_BE_ABSOLUTE");
    assert.equal(recordCoverageTrend({ stateFile: file, gaps: { ok: false } }).reason, "GAPS_RESULT_REQUIRED");
    assert.equal(readCoverageTrend({ stateFile: path.join(state, "none.jsonl") }).direction, "INSUFFICIENT_DATA");
  } finally { rm(root); rm(state); }
});

test("symlinks inside the project are not followed; status vocabulary is honest", () => {
  const root = write(tmp("ti-"), FIX), outside = write(tmp("ti-out-"), { "secret.mjs": "export function stolen() {}\n" }); try {
    fs.symlinkSync(path.join(outside, "secret.mjs"), path.join(root, "src", "link.mjs"));
    const g = findTestGaps({ root }); assert.ok(!g.modules.some(m => m.file === "src/link.mjs"));
    assert.equal(prioritizeTests({ root, changedFiles: ["src/link.mjs"] }).recommendation, "RUN_ALL_AS_SAFETY_NET");
    assert.equal(STATUS.live, "NOT_LIVE"); assert.equal(STATUS.controlCenterWiring, "NOT_CONNECTED"); assert.ok(!JSON.stringify(STATUS).includes("VERIFIED_WORKING"));
  } finally { rm(root); rm(outside); }
});

test("pathological input: deeply nested templates, huge token streams and unbalanced brackets terminate", () => {
  let nested = "x"; for (let i = 0; i < 40; i++) nested = "`a${" + nested + "}b`";
  const t0 = Date.now(); const m = parseModule("export const a = " + nested + ";\nexport function f(" + "(".repeat(5000) + "\n");
  assert.ok(Date.now() - t0 < 5000); assert.ok(m.exports.some(e => e.name === "a"));
  const big = tokenize("a ".repeat(300000)); assert.equal(big.truncated, true);
});

test("TypeScript-style './x.js' resolves to x.ts; a broken relative import forces RUN_ALL; import cycles terminate", () => {
  const root = write(tmp("ti-"), {
    "src/a.ts": 'import { b } from "./b.js";\nexport function a(n: number) { return b(n); }\n', "src/b.ts": 'import { a } from "./a.js";\nexport function b(n) { return n ? a(n - 1) : 0; }\n',
    "src/c.mjs": 'import { gone } from "./missing.mjs";\nexport const c = gone;\n', "tests/a.test.ts": 'import { a } from "../src/a.js";\na(1);\n'
  }); try {
    const r = prioritizeTests({ root, changedFiles: ["src/b.ts"] });
    assert.equal(r.plan[0].test, "tests/a.test.ts"); assert.equal(r.plan[0].depth, 2);
    assert.equal(r.recommendation, "RUN_ALL_AS_SAFETY_NET"); assert.equal(r.graph.unresolvedImports, 1);
  } finally { rm(root); }
});
