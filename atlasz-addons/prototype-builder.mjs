// P04 Rapid prototype builder (85-capability audit): idea -> small working prototype WITH generated tests, SANDBOX only.
// What this is: deterministic, parameterised templates (no model, no network). The owner picks a template and parameters; the builder validates them strictly, writes a new folder under the
// repos area and records a manifest. A prototype is only ever reported as TESTS_PASSED_IN_SANDBOX after its own generated tests ran in the restricted launcher (the same owner-approved,
// content-bound REPO_TEST_RUN gate as any repository) and passed, and only while its files still hash to what was tested. Nothing is installed, deployed, published or sent.
// What it is NOT: a code generator from free text (that would need a model provider - owner decision D5), and it never claims a prototype is production-ready.
//   * Parameters never become code: every user value is embedded with JSON.stringify (JS) or HTML-escaping (html), after a printable-character check.
//   * Owner only: agent ids and spoofed spellings are refused. Existing folders are never overwritten.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createStore } from "./business/store.mjs";
import { analyzeRepo, runRepoTests } from "./repo-analyzer.mjs";
import { redactSecrets } from "./text-compare.mjs";

export const LIMITS = Object.freeze({ maxPrototypes: 100, maxIdea: 200, maxText: 200, maxRoutes: 10, maxRouteBody: 200 });
const NAME = /^[a-z][a-z0-9-]{1,40}$/, ROUTE = /^\/[a-z0-9_/-]{0,40}$/, PRINTABLE = /^[^\u0000-\u001f\u007f\u2028\u2029]*$/;
const OPS = ["slugify", "titleCase", "wordCount", "reverseWords"];

const line = (v, max, reason, { empty = false } = {}) => (typeof v === "string" && (empty || v.trim()) && v.length <= max && PRINTABLE.test(v) && v.isWellFormed() ? { ok: true, v: redactSecrets(v.trim()) } : { ok: false, reason });
const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const J = JSON.stringify;

// ---- templates: each returns { files: {path: content} } from validated parameters ----
const OP_SRC = {
  slugify: 's => s.toLowerCase().normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")',
  titleCase: 's => s.toLowerCase().replace(/(^|\\s)(\\S)/g, (m, a, b) => a + b.toUpperCase())',
  wordCount: 's => (s.trim() ? s.trim().split(/\\s+/).length : 0)',
  reverseWords: 's => s.trim().split(/\\s+/).filter(Boolean).reverse().join(" ")'
};
const OP_CASES = { slugify: ["  Héllo,  World! 2026 ", "hello-world-2026"], titleCase: ["hELLO big wORLD", "Hello Big World"], wordCount: ["  one two   three ", 3], reverseWords: [" a b  c ", "c b a"] };

const TEMPLATES = {
  "text-transform": {
    title: "Text transformer", describe: "Pure functions on text (slugify, titleCase, wordCount, reverseWords).", params: { ops: `subset of ${OPS.join(", ")} (default all)` },
    check(p) { const ops = p.ops ?? OPS; if (!Array.isArray(ops) || !ops.length || ops.length > OPS.length || new Set(ops).size !== ops.length || !ops.every(o => OPS.includes(o))) return { ok: false, reason: "OPS_INVALID" }; return { ok: true, p: { ops: [...ops].sort() } }; },
    build: p => ({
      "src/index.mjs": `const OPS = {\n${p.ops.map(o => `  ${o}: ${OP_SRC[o]}`).join(",\n")}\n};\nexport const operations = Object.freeze(Object.keys(OPS));\nexport function transform(text, op) {\n  if (typeof text !== "string") throw new TypeError("text must be a string");\n  if (!Object.hasOwn(OPS, op)) throw new RangeError("unknown operation");\n  return OPS[op](text);\n}\n`,
      "tests/index.test.mjs": `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { transform, operations } from "../src/index.mjs";\n\ntest("lists exactly the chosen operations", () => assert.deepEqual([...operations].sort(), ${J(p.ops)}));\n${p.ops.map(o => `test(${J(o + " works")}, () => assert.equal(transform(${J(OP_CASES[o][0])}, ${J(o)}), ${J(OP_CASES[o][1])}));`).join("\n")}\ntest("rejects unknown operations and non-strings", () => {\n  assert.throws(() => transform("x", "__proto__"), RangeError);\n  assert.throws(() => transform("x", "constructor"), RangeError);\n  assert.throws(() => transform(5, ${J(p.ops[0])}), TypeError);\n});\n`
    })
  },
  "csv-to-json": {
    title: "CSV to JSON", describe: "Parses CSV text (quotes, commas, CRLF) into objects keyed by the header row.", params: {},
    check: () => ({ ok: true, p: {} }),
    build: () => ({
      "src/index.mjs": `export function parseCsv(text) {\n  if (typeof text !== "string") throw new TypeError("text must be a string");\n  const rows = []; let row = [], cell = "", q = false;\n  for (let i = 0; i < text.length; i++) {\n    const c = text[i];\n    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }\n    else if (c === '"') q = true;\n    else if (c === ",") { row.push(cell); cell = ""; }\n    else if (c === "\\n" || c === "\\r") { if (c === "\\r" && text[i + 1] === "\\n") i++; row.push(cell); cell = ""; rows.push(row); row = []; }\n    else cell += c;\n  }\n  if (q) throw new SyntaxError("unterminated quote");\n  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }\n  const [head = [], ...body] = rows.filter(r => r.some(x => x !== ""));\n  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));\n}\n`,
      "tests/index.test.mjs": `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { parseCsv } from "../src/index.mjs";\n\ntest("parses a simple table", () => assert.deepEqual(parseCsv("a,b\\n1,2\\n3,4"), [{ a: "1", b: "2" }, { a: "3", b: "4" }]));\ntest("handles quotes, embedded commas and doubled quotes", () => assert.deepEqual(parseCsv('n,t\\n"Smith, J","say ""hi"""'), [{ n: "Smith, J", t: 'say "hi"' }]));\ntest("accepts CRLF and ignores blank lines", () => assert.deepEqual(parseCsv("a\\r\\n1\\r\\n\\r\\n2\\r\\n"), [{ a: "1" }, { a: "2" }]));\ntest("empty input gives no rows; a missing cell is empty", () => { assert.deepEqual(parseCsv(""), []); assert.deepEqual(parseCsv("a,b\\n1"), [{ a: "1", b: "" }]); });\ntest("rejects an unterminated quote and non-strings", () => { assert.throws(() => parseCsv('a\\n"x'), SyntaxError); assert.throws(() => parseCsv(null), TypeError); });\n`
    })
  },
  "http-handler": {
    title: "HTTP route handler", describe: "A pure request handler for fixed GET routes (no server is started).", params: { routes: `1-${LIMITS.maxRoutes} of { path: "/x", body: "text" }` },
    check(p) {
      const r = p.routes; if (!Array.isArray(r) || !r.length || r.length > LIMITS.maxRoutes) return { ok: false, reason: "ROUTES_INVALID" }; const out = [];
      for (const x of r) { if (!x || typeof x !== "object" || typeof x.path !== "string" || !ROUTE.test(x.path)) return { ok: false, reason: "ROUTE_PATH_INVALID" }; if (x.path === "/__missing__" || x.path === "/__proto__") return { ok: false, reason: "ROUTE_PATH_RESERVED" }; const b = line(x.body, LIMITS.maxRouteBody, "ROUTE_BODY_INVALID"); if (!b.ok) return b; out.push({ path: x.path, body: b.v }); }
      if (new Set(out.map(x => x.path)).size !== out.length) return { ok: false, reason: "ROUTE_DUPLICATE" }; return { ok: true, p: { routes: out } };
    },
    build: p => ({
      "src/index.mjs": `const ROUTES = new Map(${J(p.routes.map(r => [r.path, r.body]))});\nexport function handle(req) {\n  const method = String(req?.method ?? "GET").toUpperCase(), path = String(req?.path ?? "/");\n  if (!ROUTES.has(path)) return { status: 404, body: "not found" };\n  if (method !== "GET") return { status: 405, body: "method not allowed", allow: "GET" };\n  return { status: 200, body: ROUTES.get(path) };\n}\n`,
      "tests/index.test.mjs": `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { handle } from "../src/index.mjs";\n\nconst ROUTES = ${J(p.routes.map(r => [r.path, r.body]))};\nfor (const [path, body] of ROUTES) test("GET " + path, () => assert.deepEqual(handle({ method: "GET", path }), { status: 200, body }));\ntest("unknown path is 404 and other methods are 405", () => {\n  assert.equal(handle({ method: "GET", path: "/__missing__" }).status, 404);\n  assert.deepEqual(handle({ method: "POST", path: ROUTES[0][0] }), { status: 405, body: "method not allowed", allow: "GET" });\n  assert.equal(handle({ method: "GET", path: "/__proto__" }).status, 404);\n  assert.equal(handle().status, ROUTES.some(r => r[0] === "/") ? 200 : 404);\n});\n`
    })
  },
  "static-page": {
    title: "Static page", describe: "One accessible HTML page (lang, title, viewport, high-contrast colours, escaped text).", params: { title: "text", heading: "text", text: "text" },
    check(p) { const o = {}; for (const k of ["title", "heading", "text"]) { const r = line(p[k], LIMITS.maxText, k.toUpperCase() + "_INVALID"); if (!r.ok) return r; if (/https?:\/\/|\bon[a-z]+\s*=/i.test(r.v)) return { ok: false, reason: k.toUpperCase() + "_HAS_URL_OR_SCRIPT" }; o[k] = r.v; } return { ok: true, p: o }; },
    build: p => ({
      "index.html": `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(p.title)}</title>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<main>\n<h1>${esc(p.heading)}</h1>\n<p>${esc(p.text)}</p>\n</main>\n</body>\n</html>\n`,
      "style.css": `:root { --bg: #ffffff; --ink: #111111; }\nbody { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, sans-serif; }\nmain { max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }\n`,
      "tests/index.test.mjs": `import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");\nconst esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);\nconst P = ${J(p)};\n\ntest("has language, charset, viewport and one h1", () => {\n  assert.match(html, /<html lang="en">/); assert.match(html, /<meta charset="utf-8">/); assert.match(html, /name="viewport"/);\n  assert.equal((html.match(/<h1>/g) || []).length, 1);\n});\ntest("shows the given text, escaped", () => {\n  assert.ok(html.includes("<title>" + esc(P.title) + "</title>")); assert.ok(html.includes("<h1>" + esc(P.heading) + "</h1>")); assert.ok(html.includes("<p>" + esc(P.text) + "</p>"));\n});\ntest("contains no script, inline handler or external resource", () => {\n  assert.doesNotMatch(html, /<script|\\son[a-z]+=|https?:\\/\\//i);\n});\n`
    })
  }
};

const sha = s => crypto.createHash("sha256").update(s).digest("hex");
export const templateNames = () => Object.keys(TEMPLATES);

export function createPrototypeBuilder({ repoRoot, file = null, now = () => Date.now(), run = runRepoTests, isStopped = () => false } = {}) {
  if (typeof repoRoot !== "string" || !repoRoot) throw new Error("REPO_ROOT_REQUIRED");
  const store = createStore({ file, init: () => ({ prototypes: {} }), mode: 0o600 }), d = store.data;
  const owner = actor => (actor === "OWNER" ? null : { ok: false, reason: "ONLY_OWNER_MAY_BUILD_PROTOTYPES" });

  const templates = () => Object.entries(TEMPLATES).map(([id, t]) => ({ id, title: t.title, describe: t.describe, params: t.params }));
  function prepare(spec) {
    if (!spec || typeof spec !== "object") return { ok: false, reason: "SPEC_INVALID" };
    if (typeof spec.name !== "string" || !NAME.test(spec.name)) return { ok: false, reason: "NAME_INVALID" };
    if (typeof spec.template !== "string" || !Object.hasOwn(TEMPLATES, spec.template)) return { ok: false, reason: "TEMPLATE_UNKNOWN" };
    const idea = line(spec.idea ?? "", LIMITS.maxIdea, "IDEA_INVALID", { empty: true }); if (!idea.ok) return idea;
    const t = TEMPLATES[spec.template], c = t.check(spec.params && typeof spec.params === "object" ? spec.params : {}); if (!c.ok) return c;
    const files = { ...t.build(c.p) };
    files["package.json"] = J({ name: spec.name, version: "0.0.1", private: true, type: "module", description: idea.v || t.title, scripts: {}, dependencies: {} }, null, 2) + "\n";
    files["README.md"] = `# ${spec.name}\n\nGenerated ${t.title} prototype. Idea: ${J(idea.v)}\n\nSANDBOX prototype. Generated from the "${spec.template}" template; it has not been reviewed, deployed or published.\nRun its tests with \`node tests/index.test.mjs\`.\n`;
    return { ok: true, template: spec.template, name: spec.name, idea: idea.v, params: c.p, files };
  }
  const preview = s => { const p = prepare(s); return p.ok ? { ok: true, template: p.template, name: p.name, files: Object.entries(p.files).map(([path, c]) => ({ path, bytes: Buffer.byteLength(c) })).sort((a, b) => (a.path < b.path ? -1 : 1)), note: "Preview only: nothing was written." } : p; };

  function generate(spec, { actor } = {}) {
    const no = owner(actor); if (no) return no;
    let stopped = true; try { stopped = Boolean(isStopped()); } catch { /* fail closed */ }
    if (stopped) return { ok: false, reason: "OWNER_STOP_OR_SAFE_MODE_ACTIVE" };
    const p = prepare(spec); if (!p.ok) return p;
    if (Object.hasOwn(d.prototypes, p.name) || fs.existsSync(path.join(repoRoot, p.name))) return { ok: false, reason: "PROTOTYPE_EXISTS" };
    if (Object.keys(d.prototypes).length >= LIMITS.maxPrototypes) return { ok: false, reason: "TOO_MANY_PROTOTYPES" };
    fs.mkdirSync(repoRoot, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(repoRoot, ".proto-")), dest = path.join(repoRoot, p.name);
    try {
      for (const [rel, content] of Object.entries(p.files)) { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content, { flag: "wx", mode: 0o644 }); }
      fs.renameSync(tmp, dest);
    } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, reason: "WRITE_FAILED" }; }
    const a = analyzeRepo(dest); if (!a.ok) { fs.rmSync(dest, { recursive: true, force: true }); return a; }
    d.prototypes[p.name] = { name: p.name, template: p.template, idea: p.idea, params: p.params, createdAt: new Date(now()).toISOString(), generatedHash: a.hash, files: Object.entries(p.files).map(([rel, c]) => ({ path: rel, sha256: sha(c) })).sort((x, y) => (x.path < y.path ? -1 : 1)), tested: null };
    store.save();
    return { ok: true, name: p.name, template: p.template, status: "GENERATED_UNTESTED", hash: a.hash, files: d.prototypes[p.name].files.map(f => f.path), next: "Run its tests with the owner-approved test gate; until then it is not reported as working." };
  }

  function status(name) {
    const m = Object.hasOwn(d.prototypes, name) ? d.prototypes[name] : null; if (!m) return { ok: false, reason: "PROTOTYPE_NOT_FOUND" };
    const a = analyzeRepo(path.join(repoRoot, name)); if (!a.ok) return { ok: true, name, template: m.template, status: "FOLDER_UNREADABLE", reason: a.reason };
    let s = "GENERATED_UNTESTED";
    const testsChanged = m.files.filter(f => f.path.startsWith("tests/")).some(f => { try { return sha(fs.readFileSync(path.join(repoRoot, name, f.path), "utf8")) !== f.sha256; } catch { return true; } })
      || a.testFiles.some(t => !m.files.some(f => f.path === t));                              // a replaced, emptied or additional test file means "passed" no longer says what it used to
    if (testsChanged) s = "TESTS_MODIFIED";
    else if (m.tested) s = m.tested.hash !== a.hash ? "MODIFIED_AFTER_TEST" : m.tested.passed ? "TESTS_PASSED_IN_SANDBOX" : "TESTS_FAILED";
    else if (m.generatedHash !== a.hash) s = "MODIFIED_BEFORE_TEST";
    return { ok: true, name, template: m.template, idea: m.idea, createdAt: m.createdAt, status: s, hash: a.hash, tested: m.tested ? { at: m.tested.at, passed: m.tested.passed, ran: m.tested.ran, failed: m.tested.failed, hash: m.tested.hash } : null, note: "Sandbox prototype. TESTS_PASSED_IN_SANDBOX is not a production-readiness claim." };
  }

  /** Run the prototype's own tests through the owner-approved gate; record the outcome bound to the exact content hash. */
  async function test(name, { ownerAuth, ownerApproval = null, isStopped, nodeBin, caps, scratchRoot } = {}) {
    const m = Object.hasOwn(d.prototypes, name) ? d.prototypes[name] : null; if (!m) return { ok: false, reason: "PROTOTYPE_NOT_FOUND" };
    const root = path.join(repoRoot, name), r = await run({ name, root, ownerAuth, ownerApproval, isStopped, nodeBin, caps, scratchRoot, ...{} }); if (!r.ok) return r;
    const a = analyzeRepo(root); if (!a.ok) return a;
    const passed = r.ran > 0 && r.failed === 0;
    m.tested = { at: new Date(now()).toISOString(), hash: a.hash, passed, ran: r.ran, failed: r.failed }; store.save();
    return { ok: true, name, status: status(name).status, ran: r.ran, passed: r.passed, failed: r.failed, results: r.results, isolation: r.isolation };
  }
  /** Static-page preview for a sandboxed iframe (sandbox="" => no scripts, no forms, no navigation, unique origin). The page is read as found on disk, so it is untrusted; a CSP is injected as well. */
  function previewPage(name) {
    const m = Object.hasOwn(d.prototypes, name) ? d.prototypes[name] : null; if (!m) return { ok: false, reason: "PROTOTYPE_NOT_FOUND" };
    if (m.template !== "static-page") return { ok: false, reason: "PREVIEW_ONLY_FOR_STATIC_PAGES" };
    const root = path.join(repoRoot, name); let html, css;
    try { const st = fs.lstatSync(path.join(root, "index.html")); if (!st.isFile() || st.size > 100000) return { ok: false, reason: "PAGE_UNAVAILABLE" }; html = fs.readFileSync(path.join(root, "index.html"), "utf8"); const cs = fs.lstatSync(path.join(root, "style.css")); css = cs.isFile() && cs.size <= 20000 ? fs.readFileSync(path.join(root, "style.css"), "utf8") : ""; } catch { return { ok: false, reason: "PAGE_UNAVAILABLE" }; }
    const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'">';
    const doc = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/i, () => "<style>" + css.replace(/<\/style/gi, "<\\/style") + "</style>").replace(/<head>/i, () => "<head>" + csp);
    return { ok: true, srcdoc: doc, sandbox: "", bytes: Buffer.byteLength(doc), sha256: sha(doc), status: status(name).status, untrusted: true, note: "Rendered in an iframe with sandbox=\"\" and a restrictive CSP: no script, no network, no navigation." };
  }
  const list = () => Object.keys(d.prototypes).sort().map(n => { const s = status(n); return { name: n, template: d.prototypes[n].template, status: s.status ?? "UNKNOWN" }; });
  return { templates, preview, previewPage, generate, status, test, list };
}
