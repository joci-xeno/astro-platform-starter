import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assessArchitecture, planRefactor, STATUS } from "../atlasz-addons/architecture-assessor.mjs";
import { stronglyConnected } from "../atlasz-addons/dev-assist-common.mjs";
import { tmp, rm } from "./helpers.mjs";

const write = (root, files) => { for (const [rel, c] of Object.entries(files)) { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); } return root; };
const treeHash = root => { const out = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(p + ":" + fs.readFileSync(p, "base64")); } }; walk(root); return out.join("\n"); };
// a realistic-ish block (>60 normalised tokens) duplicated with renamed identifiers
const block = (n, v) => `export function ${n}(${v}, opts = {}) {\n  const out = [];\n  for (const item of ${v}) {\n    if (!item || typeof item !== "object") continue;\n    const key = String(item.id ?? "").trim();\n    if (!key) throw new Error("ID_REQUIRED");\n    out.push({ key, value: item.value ?? null, at: opts.now ?? 0 });\n  }\n  return out.sort((a, b) => (a.key < b.key ? -1 : 1));\n}\n`;
const FIX = {
  "src/ui/view.mjs": 'import { svc } from "../service/svc.mjs";\nexport const view = () => svc();\n',
  "src/service/svc.mjs": 'import { repo } from "../data/repo.mjs";\nexport function svc() { return repo(); }\n',
  "src/data/repo.mjs": 'import { view } from "../ui/view.mjs";\nexport function repo() { return typeof view; }\n',          // upward import + cycle
  "src/util/a.mjs": block("normaliseA", "rows"), "src/util/b.mjs": block("normaliseB", "records"),
  "src/util/orphan.mjs": "export const unused = 1;\n",
  "src/index.mjs": 'import { view } from "./ui/view.mjs";\nimport { normaliseA } from "./util/a.mjs";\nimport { normaliseB } from "./util/b.mjs";\nview(); normaliseA([]); normaliseB([]);\n',
  "tests/svc.test.mjs": 'import { svc } from "../src/service/svc.mjs";\nsvc();\n'
};
const LAYERS = { layers: [{ name: "ui", paths: ["src/ui"] }, { name: "service", paths: ["src/service"] }, { name: "data", paths: ["src/data"] }] };

test("Tarjan SCC (iterative) finds every cycle including self-loops and survives 20k-node chains", () => {
  const e = new Map([["a", new Set(["b"])], ["b", new Set(["c"])], ["c", new Set(["a"])], ["d", new Set(["d"])], ["e", new Set()]]);
  assert.deepEqual(stronglyConnected(e), [["a", "b", "c"], ["d"]]);
  const big = new Map(); for (let i = 0; i < 20000; i++) big.set("n" + i, new Set(["n" + (i + 1) % 20000]));
  assert.equal(stronglyConnected(big)[0].length, 20000);
});

test("assessArchitecture finds the cycle with a concrete path and import lines", () => {
  const root = write(tmp("aa-"), FIX); try {
    const r = assessArchitecture({ root });
    const c = r.findings.find(f => f.kind === "IMPORT_CYCLE");
    assert.deepEqual(c.files, ["src/data/repo.mjs", "src/service/svc.mjs", "src/ui/view.mjs"]);
    assert.equal(c.evidence.cycle[0], c.evidence.cycle.at(-1)); assert.equal(c.evidence.cycle.length, 4);
    assert.ok(c.evidence.imports.every(i => Number.isInteger(i.line)));
    assert.equal(r.findings[0].kind, "IMPORT_CYCLE", "cycles rank first"); assert.equal(r.verdict, "FINDINGS_BY_THESE_RULES");
  } finally { rm(root); }
});

test("layering: ordered layers flag the upward import only; an explicit allow-list is honoured", () => {
  const root = write(tmp("aa-"), FIX); try {
    const r = assessArchitecture({ root, layers: LAYERS });
    const v = r.findings.filter(f => f.kind === "LAYER_VIOLATION");
    assert.equal(v.length, 1); assert.deepEqual(v[0].evidence, { from: "src/data/repo.mjs", to: "src/ui/view.mjs", fromLayer: "data", toLayer: "ui", line: 1, rule: "ORDERED_LAYERS_DOWNWARD_ONLY" });
    assert.equal(r.metrics.unlayered, 4);   // util/a, util/b, util/orphan and index
    const r2 = assessArchitecture({ root, layers: { ...LAYERS, allow: { ui: ["service"], service: [], data: ["ui"] } } });
    assert.deepEqual(r2.findings.filter(f => f.kind === "LAYER_VIOLATION").map(f => f.evidence.from + ">" + f.evidence.to), ["src/service/svc.mjs>src/data/repo.mjs"]);
  } finally { rm(root); }
});

test("layer config is validated (fail closed): bad names, traversal in paths, unknown allow targets", () => {
  const root = write(tmp("aa-"), FIX); try {
    assert.equal(assessArchitecture({ root, layers: { layers: [] } }).reason, "LAYER_CONFIG_INVALID");
    assert.equal(assessArchitecture({ root, layers: { layers: [{ name: "a", paths: ["../x"] }] } }).reason, "LAYER_PATHS_INVALID:a");
    assert.equal(assessArchitecture({ root, layers: { layers: [{ name: "a", paths: ["x"] }, { name: "a", paths: ["y"] }] } }).reason, "LAYER_NAME_INVALID_OR_DUPLICATE");
    assert.match(assessArchitecture({ root, layers: { ...LAYERS, allow: { ui: ["nope"] } } }).reason, /^LAYER_ALLOW_INVALID/);
    assert.equal(assessArchitecture({ root, thresholds: { godLines: -1 } }).reason, "THRESHOLD_INVALID:godLines");
    assert.equal(assessArchitecture({ root, thresholds: { evil: 1 } }).reason, "UNKNOWN_THRESHOLD:evil");
    assert.equal(assessArchitecture({ root, entries: ["../../etc/passwd"] }).reason, "ENTRIES_INVALID");
  } finally { rm(root); }
});

test("duplicate code with renamed identifiers is clustered with line ranges; different code is not", () => {
  const root = write(tmp("aa-"), FIX); try {
    const r = assessArchitecture({ root });
    const d = r.findings.filter(f => f.kind === "DUPLICATE_CODE");
    assert.equal(d.length, 1); assert.deepEqual(d[0].files, ["src/util/a.mjs", "src/util/b.mjs"]);
    assert.ok(d[0].evidence.tokens >= 60); assert.ok(d[0].evidence.members.every(m => m.startLine === 1 && m.endLine >= 9));
    write(root, { "src/util/b.mjs": "export function other(x) { return x * 2; }\n" });
    assert.equal(assessArchitecture({ root }).findings.filter(f => f.kind === "DUPLICATE_CODE").length, 0);
  } finally { rm(root); }
});

test("duplicate detection inside ONE file reports non-overlapping regions", () => {
  const root = write(tmp("aa-"), { "src/one.mjs": block("f1", "xs") + block("f2", "ys"), "src/index.mjs": 'import "./one.mjs";\n' }); try {
    const d = assessArchitecture({ root }).findings.filter(f => f.kind === "DUPLICATE_CODE");
    assert.equal(d.length, 1); const [m1, m2] = d[0].evidence.members; assert.equal(m1.file, m2.file); assert.ok(m1.endLine < m2.startLine);
    // three back-to-back copies: a naive forward extension would make copy1+2 "match" copy2+3 (overlapping regions)
    write(root, { "src/one.mjs": block("f1", "xs") + block("f2", "ys") + block("f3", "zs") });
    const d3 = assessArchitecture({ root }).findings.filter(f => f.kind === "DUPLICATE_CODE");
    assert.ok(d3.length >= 1);
    for (const f of d3) { const ms = [...f.evidence.members].sort((a, b) => a.startLine - b.startLine); for (let i = 1; i < ms.length; i++) assert.ok(ms[i - 1].endLine < ms[i].startLine, "regions overlap: " + JSON.stringify(ms)); }
  } finally { rm(root); }
});

test("dead modules: unimported file is flagged; entries, index files, package.json main and tests are not; dynamic imports lower confidence", () => {
  const root = write(tmp("aa-"), { ...FIX, "package.json": JSON.stringify({ main: "src/start.mjs" }), "src/start.mjs": "export const s = 1;\n" }); try {
    const dead = assessArchitecture({ root }).findings.filter(f => f.kind === "DEAD_MODULE").map(f => f.files[0]);
    assert.deepEqual(dead, ["src/util/orphan.mjs"]);
    assert.equal(assessArchitecture({ root, entries: ["src/util/orphan.mjs"] }).findings.filter(f => f.kind === "DEAD_MODULE").length, 0);
    write(root, { "src/loader.mjs": "export const load = n => import(`./${n}.mjs`);\n" });
    const f = assessArchitecture({ root }).findings.find(x => x.kind === "DEAD_MODULE" && x.files[0] === "src/util/orphan.mjs");
    assert.equal(f.evidence.confidence, "LOW_DYNAMIC_OR_UNRESOLVED_IMPORTS_PRESENT");
    assert.ok(assessArchitecture({ root }).findings.some(x => x.kind === "TEST_ONLY_MODULE") === false);
  } finally { rm(root); }
});

test("god-module needs two criteria; fan-in/fan-out metrics are exact", () => {
  const files = { "src/hub.mjs": Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n" + "// pad\n".repeat(900) };
  for (let i = 0; i < 25; i++) files[`src/c${i}.mjs`] = `import { v${i} } from "./hub.mjs";\nexport const c${i} = v${i};\n`;
  files["src/index.mjs"] = Array.from({ length: 25 }, (_, i) => `import "./c${i}.mjs";`).join("\n");
  const root = write(tmp("aa-"), files); try {
    const r = assessArchitecture({ root });
    const god = r.findings.find(f => f.kind === "GOD_MODULE"); assert.deepEqual(god.files, ["src/hub.mjs"]); assert.deepEqual(god.evidence.criteria, ["LINES>800", "EXPORTS>25", "FAN_IN>20"]);
    assert.deepEqual(r.metrics.topFanIn[0], { file: "src/hub.mjs", fanIn: 25 }); assert.deepEqual(r.metrics.topFanOut[0], { file: "src/index.mjs", fanOut: 25 });
    assert.equal(assessArchitecture({ root, thresholds: { godLines: 5000, godExports: 100 } }).findings.some(f => f.kind === "GOD_MODULE"), false);
  } finally { rm(root); }
});

test("assessment is read-only, skips symlinks and reports an INCOMPLETE verdict when a file was too large to parse", () => {
  const root = write(tmp("aa-"), { ...FIX, "src/huge.mjs": "export const x = 1;\n//" + "x".repeat(600 * 1024) }), out = write(tmp("aa-out-"), { "x.mjs": "export const y = 2;\n" }); try {
    fs.symlinkSync(path.join(out, "x.mjs"), path.join(root, "src", "link.mjs"));
    const before = treeHash(root), r = assessArchitecture({ root });
    assert.equal(r.verdict, "INCOMPLETE_ASSESSMENT"); assert.equal(r.graph.notParsed.oversize, 1); assert.ok(!r.metrics.perModule.some(m => m.file === "src/link.mjs"));
    assert.equal(treeHash(root), before); assert.equal(r.readOnly, true);
    assert.equal(assessArchitecture({ root: path.join(root, "src", "link.mjs") }).ok, false);
  } finally { rm(root); rm(out); }
});

test("planRefactor: dependency order (leaves first), small steps, tests per step, final full suite, never edits", () => {
  const root = write(tmp("aa-"), FIX); try {
    const before = treeHash(root);
    const p = planRefactor({ root, maxFilesPerStep: 1, change: { files: [{ path: "src/index.mjs", action: "modify" }, { path: "src/util/a.mjs", action: "modify", description: "extract helper" }, { path: "src/util/shared.mjs", action: "create" }] } });
    assert.equal(p.ok, true); assert.equal(p.kind, "PLAN"); assert.equal(p.appliesChanges, false);
    assert.deepEqual(p.steps.map(s => s.changes.map(c => c.path)), [["src/util/shared.mjs"], ["src/util/a.mjs"], ["src/index.mjs"], []]);
    assert.ok(p.steps[0].notes[0].startsWith("NEW_FILES_HAVE_NO_KNOWN_TESTS"));
    assert.deepEqual(p.steps.at(-1).testsToRun, ["FULL_SUITE"]); assert.match(p.planSha256, /^[0-9a-f]{64}$/);
    assert.equal(treeHash(root), before);
  } finally { rm(root); }
});

test("planRefactor: tests reached through imports are listed; cycle members stay in one step even above the limit", () => {
  const root = write(tmp("aa-"), FIX); try {
    const p = planRefactor({ root, maxFilesPerStep: 1, change: { files: [{ path: "src/ui/view.mjs", action: "modify" }, { path: "src/service/svc.mjs", action: "modify" }, { path: "src/data/repo.mjs", action: "modify" }] } });
    assert.equal(p.steps[0].changes.length, 3); assert.ok(p.warnings.some(w => w.kind === "CYCLE_FORCES_LARGER_STEP"));
    assert.deepEqual(p.steps[0].testsToRun, ["tests/svc.test.mjs"]);
  } finally { rm(root); }
});

test("planRefactor: delete with remaining importers is a blocker; deleting together with its importer orders the importer first", () => {
  const root = write(tmp("aa-"), FIX); try {
    const b = planRefactor({ root, change: { files: [{ path: "src/util/b.mjs", action: "delete" }] } });
    assert.equal(b.status, "BLOCKED_SEE_BLOCKERS"); assert.deepEqual(b.blockers[0], { kind: "DELETE_HAS_REMAINING_IMPORTERS", file: "src/util/b.mjs", importers: ["src/index.mjs"] });
    const ok = planRefactor({ root, maxFilesPerStep: 1, change: { files: [{ path: "src/util/b.mjs", action: "delete" }, { path: "src/index.mjs", action: "modify" }] } });
    assert.equal(ok.status, "READY_FOR_REVIEW"); assert.deepEqual(ok.steps.slice(0, 2).map(s => s.changes[0].path), ["src/index.mjs", "src/util/b.mjs"]);
  } finally { rm(root); }
});

test("planRefactor input validation: traversal, duplicates, missing files, existing create targets, oversize, bad step size", () => {
  const root = write(tmp("aa-"), FIX); try {
    assert.equal(planRefactor({ root, change: { files: [{ path: "../x.mjs", action: "modify" }] } }).reason, "PATH_TRAVERSAL_OR_INVALID_PATH_REFUSED");
    assert.equal(planRefactor({ root, change: { files: [{ path: "src/index.mjs", action: "move", to: "/abs.mjs" }] } }).reason, "PATH_TRAVERSAL_OR_INVALID_PATH_REFUSED");
    assert.match(planRefactor({ root, change: { files: [{ path: "src/index.mjs", action: "modify" }, { path: "src/./index.mjs", action: "modify" }] } }).reason, /^DUPLICATE_PATH/);
    assert.equal(planRefactor({ root, change: { files: [{ path: "src/nope.mjs", action: "modify" }] } }).reason, "FILE_NOT_FOUND:src/nope.mjs");
    assert.equal(planRefactor({ root, change: { files: [{ path: "src/index.mjs", action: "create" }] } }).reason, "CREATE_TARGET_EXISTS:src/index.mjs");
    assert.equal(planRefactor({ root, change: { files: [{ path: "src/index.mjs", action: "rm -rf" }] } }).reason, "ACTION_INVALID");
    assert.equal(planRefactor({ root, change: { files: Array.from({ length: 201 }, (_, i) => ({ path: "f" + i, action: "create" })) } }).reason, "CHANGE_TOO_LARGE");
    assert.equal(planRefactor({ root, maxFilesPerStep: 0, change: { files: [{ path: "src/index.mjs", action: "modify" }] } }).reason, "MAX_FILES_PER_STEP_INVALID");
    assert.equal(planRefactor({ root, change: {} }).reason, "CHANGE_FILES_REQUIRED");
  } finally { rm(root); }
});

test("plans and assessments are deterministic (same input -> same hash and order)", () => {
  const root = write(tmp("aa-"), FIX); try {
    const c = { files: [{ path: "src/index.mjs", action: "modify" }, { path: "src/util/a.mjs", action: "modify" }] };
    assert.equal(planRefactor({ root, change: c }).planSha256, planRefactor({ root, change: c }).planSha256);
    assert.deepEqual(assessArchitecture({ root, layers: LAYERS }).findings, assessArchitecture({ root, layers: LAYERS }).findings);
    assert.equal(STATUS.modelUse, "NONE_REQUIRED"); assert.equal(STATUS.live, "NOT_LIVE");
  } finally { rm(root); }
});

test("an empty project yields NO_FINDINGS_BY_THESE_RULES (never 'healthy'); a missing root is refused", () => {
  const root = tmp("aa-"); try {
    const r = assessArchitecture({ root }); assert.equal(r.verdict, "NO_FINDINGS_BY_THESE_RULES"); assert.equal(r.metrics.modules, 0);
    assert.equal(assessArchitecture({ root: path.join(root, "missing") }).reason, "ROOT_NOT_FOUND");
    assert.ok(!JSON.stringify(r).includes("HEALTHY"));
  } finally { rm(root); }
});
