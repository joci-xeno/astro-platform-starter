import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { analyzeRepo } from "../atlasz-addons/repo-analyzer.mjs";
import { createPrototypeBuilder, templateNames, LIMITS } from "../atlasz-addons/prototype-builder.mjs";
import { detectNodeRestrictions } from "../atlasz-addons/restricted-node.mjs";
import { tmp, rm } from "./helpers.mjs";

const key = generateOwnerKeyPair(), ap = (action, subject) => issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action, subject }), auth = createOwnerAuth({ publicKeyB64: key.publicKeyB64 });
const caps = detectNodeRestrictions(), ISOLATED = caps.permission && caps.namespace, SK = "s" + "k-ABCDEFGHIJKLMNOPQRSTUV";
const mk = o => { const base = tmp("proto-"); return { base, repoRoot: path.join(base, "repos"), b: createPrototypeBuilder({ repoRoot: path.join(base, "repos"), file: path.join(base, "p.json"), ...o }) }; };
const LIM = { maxPrototypes: 100, maxIdea: 200, maxText: 200, maxRoutes: 10, maxRouteBody: 200 };
const SPECS = {
  "text-transform": { template: "text-transform", name: "tt", idea: "slug helper", params: { ops: ["slugify", "titleCase"] } },
  "csv-to-json": { template: "csv-to-json", name: "csv", idea: "table reader" },
  "http-handler": { template: "http-handler", name: "api", idea: "hello", params: { routes: [{ path: "/", body: "home" }, { path: "/hello", body: "hi there" }] } },
  "static-page": { template: "static-page", name: "page", idea: "landing", params: { title: "A <b>Title</b> & co", heading: "Hello \"you\"", text: "It's <script>alert(1)</script> fine" } }
};

test("templates are listed; preview writes nothing and shows file sizes", () => {
  const { base, repoRoot, b } = mk(); try {
    assert.deepEqual(templateNames().sort(), Object.keys(SPECS).sort()); assert.equal(b.templates().length, 4);
    const p = b.preview(SPECS["csv-to-json"]); assert.equal(p.ok, true); assert.deepEqual(p.files.map(f => f.path), ["README.md", "package.json", "src/index.mjs", "tests/index.test.mjs"]); assert.ok(p.files.every(f => f.bytes > 0));
    assert.equal(fs.existsSync(repoRoot), false, "preview wrote nothing");
  } finally { rm(base); }
});

test("validation: names, templates, ideas, per-template parameters; values never become code", () => {
  const { base, b } = mk(); try {
    const bad = (o, reason) => assert.equal(b.preview({ ...SPECS["text-transform"], ...o }).reason, reason, JSON.stringify(o).slice(0, 80));
    for (const n of ["", "A", "a", "x".repeat(42), "../x", "a b", "1a", "a_b", null, 5]) bad({ name: n }, "NAME_INVALID");
    bad({ template: "nope" }, "TEMPLATE_UNKNOWN"); bad({ template: "__proto__" }, "TEMPLATE_UNKNOWN"); bad({ template: "constructor" }, "TEMPLATE_UNKNOWN");
    bad({ idea: "x".repeat(LIM.maxIdea + 1) }, "IDEA_INVALID"); bad({ idea: "a\nb" }, "IDEA_INVALID"); bad({ idea: 5 }, "IDEA_INVALID");
    assert.equal(b.preview({ ...SPECS["text-transform"], idea: "x".repeat(LIM.maxIdea) }).ok, true, "idea at the cap is fine"); assert.equal(b.preview({ ...SPECS["text-transform"], idea: undefined }).ok, true);
    for (const ops of [[], "slugify", ["nope"], ["slugify", "slugify"], ["__proto__"], ["slugify", "titleCase", "wordCount", "reverseWords", "x"]]) bad({ params: { ops } }, "OPS_INVALID");
    assert.equal(b.preview({ ...SPECS["text-transform"], params: {} }).ok, true, "ops default to all"); assert.equal(b.preview({ ...SPECS["text-transform"], params: null }).ok, true);
    const h = x => b.preview({ ...SPECS["http-handler"], params: { routes: x } }).reason;
    assert.equal(h([]), "ROUTES_INVALID"); assert.equal(h("x"), "ROUTES_INVALID"); assert.equal(h(Array.from({ length: LIM.maxRoutes + 1 }, (_, i) => ({ path: "/r" + i, body: "b" }))), "ROUTES_INVALID");
    for (const p of ["x", "/A", "/a b", "/a?b", "/..%2f", "/" + "a".repeat(41), null, 5]) assert.equal(h([{ path: p, body: "b" }]), "ROUTE_PATH_INVALID", String(p));
    assert.equal(h([{ path: "/a", body: "" }]), "ROUTE_BODY_INVALID"); assert.equal(h([{ path: "/a", body: "x".repeat(LIM.maxRouteBody + 1) }]), "ROUTE_BODY_INVALID"); assert.equal(h([{ path: "/a", body: "b" }, { path: "/a", body: "c" }]), "ROUTE_DUPLICATE");
    assert.equal(h([null]), "ROUTE_PATH_INVALID");
    assert.equal(b.preview({ ...SPECS["http-handler"], params: { routes: Array.from({ length: LIM.maxRoutes }, (_, i) => ({ path: "/r" + i, body: "x".repeat(LIM.maxRouteBody) })) } }).ok, true, "exactly the maximum number of routes with maximum-size bodies is fine");
    assert.equal(b.preview({ ...SPECS["http-handler"], params: { routes: [{ path: "/a", body: "b" }] } }).ok, true, "a single route is fine");
    assert.equal(b.preview({ ...SPECS["static-page"], params: { title: "t".repeat(LIM.maxText), heading: "h", text: "x" } }).ok, true); assert.equal(b.preview({ ...SPECS["static-page"], params: { title: "t".repeat(LIM.maxText + 1), heading: "h", text: "x" } }).reason, "TITLE_INVALID");
    assert.equal(b.preview({ ...SPECS["static-page"], params: { title: "t", heading: "h" } }).reason, "TEXT_INVALID"); assert.equal(b.preview({ ...SPECS["static-page"], params: { title: " ", heading: "h", text: "x" } }).reason, "TITLE_INVALID");
    assert.equal(b.preview({ ...SPECS["static-page"], params: { title: "t", heading: "h x", text: "x" } }).reason, "HEADING_INVALID");
    assert.equal(b.preview(null).reason, "SPEC_INVALID"); assert.equal(b.preview("x").reason, "SPEC_INVALID");
    // hostile values are embedded as data: generate and read the sources back
  } finally { rm(base); }
});

test("generate: owner only, never overwrites, atomic, secrets redacted, hostile text escaped or JSON-quoted", () => {
  const { base, repoRoot, b } = mk(); try {
    for (const a of [undefined, null, "SEARCH-1", "EXECUTION-25", "owner", "SYSTEM", ["OWNER"], { x: 1 }]) assert.equal(b.generate(SPECS["csv-to-json"], { actor: a }).reason, "ONLY_OWNER_MAY_BUILD_PROTOTYPES", String(a));
    assert.equal(b.generate(SPECS["csv-to-json"]).reason, "ONLY_OWNER_MAY_BUILD_PROTOTYPES"); assert.equal(fs.existsSync(repoRoot), false);
    const g = b.generate({ ...SPECS["static-page"], idea: "landing page " + SK }, { actor: "OWNER" }); assert.equal(g.ok, true, JSON.stringify(g)); assert.equal(g.status, "GENERATED_UNTESTED");
    const html = fs.readFileSync(path.join(repoRoot, "page", "index.html"), "utf8"); assert.ok(html.includes("&lt;script&gt;")); assert.doesNotMatch(html, /<script|<b>/);
    assert.equal(fs.readFileSync(path.join(repoRoot, "page", "README.md"), "utf8").includes(SK), false); assert.equal(JSON.stringify(b.status("page")).includes(SK), false);
    assert.equal(fs.readFileSync(path.join(repoRoot, "page", "package.json"), "utf8").includes(SK), false);
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "page", "package.json"), "utf8")); assert.deepEqual([pkg.private, pkg.scripts, pkg.dependencies], [true, {}, {}], "no scripts and no dependencies to install");
    assert.equal(b.generate(SPECS["static-page"], { actor: "OWNER" }).reason, "PROTOTYPE_EXISTS", "no overwrite");
    fs.mkdirSync(path.join(repoRoot, "taken")); assert.equal(b.generate({ ...SPECS["csv-to-json"], name: "taken" }, { actor: "OWNER" }).reason, "PROTOTYPE_EXISTS", "an existing folder is never touched");
    assert.deepEqual(fs.readdirSync(repoRoot).filter(n => n.startsWith(".proto-")), [], "no temp folders are left behind");
    assert.equal(b.generate({ ...SPECS["csv-to-json"], name: "BAD" }, { actor: "OWNER" }).reason, "NAME_INVALID");
    assert.equal(b.status("page").status, "GENERATED_UNTESTED"); assert.equal(b.status("ghost").reason, "PROTOTYPE_NOT_FOUND"); assert.equal(b.status("__proto__").reason, "PROTOTYPE_NOT_FOUND");
    assert.deepEqual(b.list(), [{ name: "page", template: "static-page", status: "GENERATED_UNTESTED" }]);
    const again = createPrototypeBuilder({ repoRoot, file: path.join(base, "p.json") }); assert.equal(again.list().length, 1, "the manifest is durable"); assert.equal((fs.statSync(path.join(base, "p.json")).mode & 0o777).toString(8), "600");
  } finally { rm(base); }
});

test("status tracks edits: a changed file is reported and an edited-then-tested folder keeps its own hash", async () => {
  const stub = async ({ root }) => ({ ok: true, ran: 1, passed: 1, failed: 0, results: [], isolation: "STUB" });
  const { base, repoRoot, b } = mk({ run: stub }); try {
    b.generate(SPECS["csv-to-json"], { actor: "OWNER" }); fs.appendFileSync(path.join(repoRoot, "csv", "src", "index.mjs"), "// edit\n"); assert.equal(b.status("csv").status, "MODIFIED_BEFORE_TEST");
    const t = await b.test("csv", { ownerAuth: auth }); assert.equal(t.ok, true); assert.equal(t.status, "TESTS_PASSED_IN_SANDBOX");
    fs.appendFileSync(path.join(repoRoot, "csv", "src", "index.mjs"), "// edit 2\n"); assert.equal(b.status("csv").status, "MODIFIED_AFTER_TEST", "a passed result does not carry over to changed files");
    assert.equal((await b.test("ghost", {})).reason, "PROTOTYPE_NOT_FOUND");
  } finally { rm(base); }
});

test("the gate: zero tests or any failing test never counts as passed; a refused run records nothing", async () => {
  let res = { ok: true, ran: 0, passed: 0, failed: 0, results: [] }; const { base, b } = mk({ run: async () => res }); try {
    b.generate(SPECS["csv-to-json"], { actor: "OWNER" });
    await b.test("csv", { ownerAuth: auth }); assert.equal(b.status("csv").status, "TESTS_FAILED", "ran = 0 is not a pass");
    res = { ok: true, ran: 2, passed: 1, failed: 1, results: [] }; await b.test("csv", { ownerAuth: auth }); assert.equal(b.status("csv").status, "TESTS_FAILED");
    res = { ok: true, ran: 2, passed: 2, failed: 0, results: [] }; await b.test("csv", { ownerAuth: auth }); assert.equal(b.status("csv").status, "TESTS_PASSED_IN_SANDBOX");
    res = { ok: false, reason: "OWNER_APPROVAL_REQUIRED:NO_APPROVAL" }; assert.equal((await b.test("csv", { ownerAuth: auth })).reason, "OWNER_APPROVAL_REQUIRED:NO_APPROVAL"); assert.equal(b.status("csv").status, "TESTS_PASSED_IN_SANDBOX", "a refused run leaves the earlier record alone");
  } finally { rm(base); }
});

test("generated prototypes really pass their own generated tests in the restricted sandbox (needs the owner's approval bound to the content)", { skip: !ISOLATED && "restricted launcher not available on this host" }, async () => {
  const scr = tmp("scr-"); const { base, repoRoot, b } = mk({ run: (o) => import("../atlasz-addons/repo-analyzer.mjs").then(m => m.runRepoTests({ ...o, timeoutMs: 20000, scratchRoot: scr })) }); try {
    for (const spec of Object.values(SPECS)) {
      assert.equal(b.generate(spec, { actor: "OWNER" }).ok, true, spec.template);
      const sub = spec.name + "#" + analyzeRepo(path.join(repoRoot, spec.name)).hash;
      const none = await b.test(spec.name, { ownerAuth: auth, isStopped: () => false }); assert.match(none.reason, /^OWNER_APPROVAL_REQUIRED/, spec.template + ": no approval, nothing runs"); assert.equal(b.status(spec.name).status, "GENERATED_UNTESTED");
      const wrong = await b.test(spec.name, { ownerAuth: auth, isStopped: () => false, ownerApproval: ap("REPO_TEST_RUN", spec.name + "#" + "0".repeat(64)) }); assert.match(wrong.reason, /^OWNER_APPROVAL_REQUIRED/, "an approval for other content is refused");
      const stopped = await b.test(spec.name, { ownerAuth: auth, isStopped: () => true, ownerApproval: ap("REPO_TEST_RUN", sub) }); assert.equal(stopped.reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
      const r = await b.test(spec.name, { ownerAuth: auth, isStopped: () => false, ownerApproval: ap("REPO_TEST_RUN", sub) });
      assert.equal(r.ok, true, spec.template + " " + JSON.stringify(r).slice(0, 600)); assert.equal(r.failed, 0, spec.template + " " + JSON.stringify(r.results).slice(0, 800)); assert.ok(r.ran >= 1);
      assert.equal(b.status(spec.name).status, "TESTS_PASSED_IN_SANDBOX", spec.template);
    }
    // a deliberately broken prototype must FAIL its generated tests (the gate can fail)
    const f = path.join(repoRoot, "csv", "src", "index.mjs"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('throw new SyntaxError("unterminated quote")', "return []"));
    const sub = "csv#" + analyzeRepo(path.join(repoRoot, "csv")).hash; const r = await b.test("csv", { ownerAuth: auth, isStopped: () => false, ownerApproval: ap("REPO_TEST_RUN", sub) });
    assert.equal(r.ok, true); assert.ok(r.failed >= 1); assert.equal(b.status("csv").status, "TESTS_FAILED");
  } finally { rm(base); rm(scr); }
});

test("corrupt manifest fails closed; limits on prototype count", () => {
  const base = tmp("proto-"); try {
    const f = path.join(base, "p.json"); fs.writeFileSync(f, "{not json"); assert.throws(() => createPrototypeBuilder({ repoRoot: path.join(base, "r"), file: f }), /STORE_UNREADABLE/); assert.equal(fs.readFileSync(f, "utf8"), "{not json");
    assert.throws(() => createPrototypeBuilder({}), /REPO_ROOT_REQUIRED/);
    const b = createPrototypeBuilder({ repoRoot: path.join(base, "r") }); for (let i = 0; i < LIM.maxPrototypes; i++) assert.equal(b.generate({ template: "csv-to-json", name: "p" + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)) }, { actor: "OWNER" }).ok, true, "i=" + i);
    assert.equal(b.generate({ template: "csv-to-json", name: "overflow" }, { actor: "OWNER" }).reason, "TOO_MANY_PROTOTYPES");
  } finally { rm(base); }
});
