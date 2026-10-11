import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { extractApi, syncDocs, checkDocs, generateReference, draftDescriptions, verifyTranslations, scanHardcodedStrings, START, END, STATUS } from "../atlasz-addons/doc-sync.mjs";
import { tmp, rm } from "./helpers.mjs";

const write = (root, files) => { for (const [rel, c] of Object.entries(files)) { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); } return root; };
const treeHash = root => { const out = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(p + ":" + fs.readFileSync(p, "base64")); } }; walk(root); return out.join("\n"); };
const SRC = {
  "src/math.mjs": "export function add(a, b) { return a + b; }\nexport function scale(x, { factor = 2 } = {}) { return x * factor; }\nexport const VERSION = '1';\n",
  "src/io.mjs": "export async function load(path, opts) {}\nexport class Store {}\n",
  "tests/math.test.mjs": "export const notApi = 1;\n"
};
const DOCS = {
  "README.md": "# Demo\n\nUse `add(a, b)` to add. Call `add(1, 2)` for 3.\n\n```js\nimport { VERSION } from './src/math.mjs';\n```\n",
  "docs/api.md": "# API\n\n### `scale(x)`\nScales.\n\n### `removedThing()`\nGone.\n\n### `Store`\nA store.\n"
};

test("extractApi lists exports with parsed signatures, excludes tests, is sorted", () => {
  const root = write(tmp("ds-"), SRC); try {
    const a = extractApi({ root });
    assert.deepEqual(a.modules.map(m => m.file), ["src/io.mjs", "src/math.mjs"]);
    assert.deepEqual(a.modules[1].exports.map(e => e.signature), ["VERSION", "add(a, b)", "scale(x, {factor = 2} = {})"]);
  } finally { rm(root); }
});

test("syncDocs: undocumented, stale signature (with evidence), removed heading; usage examples are not signature claims", () => {
  const root = write(tmp("ds-"), { ...SRC, ...DOCS }); try {
    const r = syncDocs({ root });
    assert.deepEqual(r.findings.filter(f => f.kind === "UNDOCUMENTED").map(f => f.name), ["load"]);
    const st = r.findings.filter(f => f.kind === "STALE_SIGNATURE");
    assert.equal(st.length, 1); assert.equal(st[0].name, "scale"); assert.deepEqual(st[0].doc, { file: "docs/api.md", line: 3, text: "scale(x)" }); assert.equal(st[0].actual[0].signature, "scale(x, {factor = 2} = {})");
    assert.deepEqual(r.findings.filter(f => f.kind === "REMOVED_OR_RENAMED").map(f => f.name + "@" + f.doc.file + ":" + f.doc.line), ["removedThing@docs/api.md:6"]);
    assert.deepEqual(r.docsRead, ["README.md", "docs/api.md"]); assert.equal(r.readOnly, true);
  } finally { rm(root); }
});

test("generateReference is deterministic and byte-identical for identical APIs; check passes with a fresh block and fails after a source change", () => {
  const root = write(tmp("ds-"), SRC); try {
    const g1 = generateReference(extractApi({ root })), g2 = generateReference(extractApi({ root }));
    assert.equal(g1.markdown, g2.markdown); assert.equal(g1.authoring, "MODEL_NOT_CONFIGURED");
    assert.ok(g1.markdown.startsWith(START) && g1.markdown.trim().endsWith(END));
    assert.match(g1.body, /\| `scale` \| function \| `scale\(x, \{factor = 2\} = \{\}\)` \|/);
    write(root, { "docs/reference.md": "# Ref\n" + g1.markdown });
    const ok = checkDocs({ root }); assert.equal(ok.pass, true, JSON.stringify(ok.reasons)); assert.equal(ok.exitCode, 0);
    write(root, { "src/math.mjs": "export function add(a, b, c) { return a + b + c; }\nexport function scale(x, { factor = 2 } = {}) { return x * factor; }\nexport const VERSION = '1';\n" });
    const bad = checkDocs({ root }); assert.equal(bad.pass, false); assert.equal(bad.exitCode, 1); assert.ok(bad.reasons.includes("REFERENCE_OUT_OF_DATE:1"));
  } finally { rm(root); }
});

test("checkDocs fails on stale/removed, honours maxUndocumented and ignore, fails closed on a bad root", () => {
  const root = write(tmp("ds-"), { ...SRC, ...DOCS }); try {
    const c = checkDocs({ root }); assert.equal(c.pass, false); assert.deepEqual(c.reasons.sort(), ["REMOVED_OR_RENAMED:1", "STALE_SIGNATURE:1"]);
    assert.equal(checkDocs({ root, failOn: [], maxUndocumented: 0 }).reasons[0], "UNDOCUMENTED:1>0");
    assert.equal(checkDocs({ root, failOn: [], maxUndocumented: 0, ignore: ["load"] }).pass, true);
    const x = checkDocs({ root: path.join(root, "nope") }); assert.equal(x.pass, false); assert.equal(x.exitCode, 1); assert.match(x.reasons[0], /^CHECK_FAILED_CLOSED/);
  } finally { rm(root); }
});

test("malformed reference markers and unreadable (oversize) docs make the check fail closed", () => {
  const root = write(tmp("ds-"), { ...SRC, "docs/a.md": START + "\n| `add` | x |\n" }); try {
    const r = syncDocs({ root }); assert.equal(r.counts.REFERENCE_BLOCK_MALFORMED, 1);
    write(root, { "docs/a.md": "ok `add(a, b)` `scale(x, {})` `VERSION` `load(path, opts)` `Store`\n", "docs/huge.md": "x".repeat(600 * 1024) });
    const c = checkDocs({ root }); assert.equal(c.pass, false); assert.ok(c.reasons.includes("DOCS_OR_SOURCE_NOT_FULLY_READ"));
  } finally { rm(root); }
});

test("docs folder traversal / symlinked docs folder are refused; analysed project is never modified", () => {
  const root = write(tmp("ds-"), { ...SRC, ...DOCS }), out = write(tmp("ds-out-"), { "x.md": "### `evil()`\n" }); try {
    const before = treeHash(root);
    assert.equal(syncDocs({ root, docsDir: "../" + path.basename(out) }).reason, "DOCS_DIR_PATH_TRAVERSAL_REFUSED");
    fs.symlinkSync(out, path.join(root, "linkdocs"));
    assert.equal(syncDocs({ root, docsDir: "linkdocs" }).reason, "DOCS_DIR_SYMLINK_REFUSED");
    syncDocs({ root }); checkDocs({ root }); fs.unlinkSync(path.join(root, "linkdocs"));
    assert.equal(treeHash(root), before);
  } finally { rm(root); rm(out); }
});

test("model descriptions: injected adapter drafts are scrubbed, single-line, labelled; reference check ignores the description column", async () => {
  const root = write(tmp("ds-"), SRC); try {
    const api = extractApi({ root });
    assert.equal((await draftDescriptions(api, null)).reason, "MODEL_NOT_CONFIGURED");
    const d = await draftDescriptions(api, { describe: ({ name }) => name === "add" ? "Adds\nnumbers <!-- x --> token=" + "s" + "k-ABCDEFGHIJKLMNOPQRSTUVWX" : name === "load" ? Promise.reject(new Error("down")) : "" });
    assert.equal(d.descriptions["src/math.mjs#add"].includes("\n"), false); assert.ok(!d.descriptions["src/math.mjs#add"].includes("ABCDEFGHIJKLMNOPQRSTUVWX")); assert.ok(!d.descriptions["src/math.mjs#add"].includes("<!--"));
    assert.ok(d.rejected.some(r => r.name === "src/io.mjs#load" && r.reason === "down"));
    const g = generateReference(api, { descriptions: d.descriptions }); assert.equal(g.authoring, "MODEL_DRAFTS_UNREVIEWED"); assert.match(g.body, /Description \(model draft, unreviewed\)/);
    write(root, { "docs/ref.md": g.markdown });
    assert.equal(syncDocs({ root }).counts.REFERENCE_OUT_OF_DATE, undefined);
  } finally { rm(root); }
});

test("verifyTranslations: missing keys both ways, untranslated, placeholders, length, mojibake, wrong Hungarian accents", () => {
  const en = { app: { title: "Control Center", greet: "Hello {name}, you have %d tasks", save: "Save", ok: "OK", url: "https://x.example" }, onlyEn: "Only English", err: "Failed: {{reason}}", short: "Delete item" };
  const hu = { app: { title: "Control Center", greet: "Szia {nev}, %d feladatod van", save: "MentÃ©s", ok: "OK", url: "https://x.example" }, onlyHu: "Csak magyar", err: "Hiba: {{reason}}", short: "A kiválasztott elem végleges és visszavonhatatlan törlése most azonnal", extra: "Kõszönjük, ûrlap" };
  const r = verifyTranslations({ hu, en });
  const kinds = r.findings.map(f => f.kind + ":" + f.key);
  assert.ok(kinds.includes("MISSING_IN_HU:onlyEn")); assert.ok(kinds.includes("MISSING_IN_EN:onlyHu")); assert.ok(kinds.includes("MISSING_IN_EN:extra"));
  assert.ok(kinds.includes("UNTRANSLATED_IDENTICAL:app.title")); assert.ok(!kinds.includes("UNTRANSLATED_IDENTICAL:app.ok"), "too short to judge"); assert.ok(!kinds.includes("UNTRANSLATED_IDENTICAL:app.url"));
  const ph = r.findings.find(f => f.kind === "PLACEHOLDER_MISMATCH"); assert.equal(ph.key, "app.greet"); assert.deepEqual(ph.hu, ["%d", "{nev}"]); assert.deepEqual(ph.en, ["%d", "{name}"]);
  assert.ok(!kinds.includes("PLACEHOLDER_MISMATCH:err"));
  assert.ok(kinds.includes("LENGTH_BLOWUP:short")); assert.ok(kinds.includes("MOJIBAKE:app.save")); assert.ok(kinds.includes("WRONG_HU_ACCENT:extra"));
  assert.equal(r.pass, false);
  const clean = verifyTranslations({ hu: { a: "Mentés {n}" }, en: { a: "Save {n}" } }); assert.equal(clean.pass, true);
  assert.equal(verifyTranslations({ hu: { a: "Control Center" }, en: { a: "Control Center" }, allowIdentical: ["a"] }).pass, true);
});

test("verifyTranslations adversarial input: malformed JSON, arrays, deep nesting, non-strings, empty values, U+FFFD", () => {
  assert.equal(verifyTranslations({ hu: "{bad json", en: {} }).reason, "HU_JSON_INVALID");
  assert.equal(verifyTranslations({ hu: [], en: {} }).reason, "HU_MUST_BE_OBJECT");
  let deep = {}, cur = deep; for (let i = 0; i < 30; i++) { cur.x = {}; cur = cur.x; }
  assert.equal(verifyTranslations({ hu: deep, en: {} }).reason, "HU_TOO_DEEP");
  const r = verifyTranslations({ hu: JSON.stringify({ a: 5, b: " ", c: "Hib�" }), en: { a: "Five", b: "B", c: "Error" } });
  const k = r.findings.map(f => f.kind + ":" + f.key);
  assert.ok(k.includes("NON_STRING_VALUE:a")); assert.ok(k.includes("EMPTY_VALUE:b")); assert.ok(k.includes("MOJIBAKE:c"));
  assert.equal(verifyTranslations({ hu: {}, en: {}, maxRatio: 0 }).reason, "MAX_RATIO_INVALID");
});

test("scanHardcodedStrings finds UI literals and skips translated calls, ids, selectors and URLs", () => {
  const app = [
    'el.textContent = "Save changes";', 'title.textContent = t("app.title");', 'btn.title = "Delete this item";', 'alert("Something went wrong!");',
    'input.setAttribute("placeholder", "Search tasks");', 'box.innerHTML = `<div class="x"><b>Pending approvals</b></div>`;', 'const cfg = { label: "Owner approvals", id: "owner-approvals" };',
    'document.querySelector("#main-panel");', 'fetch("/api/status");', 'el.className = "panel active";', 'el.textContent = i18n.t("x.y");', 'console.log("Debug message here");',
    'const html = `<span>Mentés folyamatban</span>`;'
  ].join("\n");
  const root = write(tmp("ds-"), { "public/app.js": app }); try {
    const r = scanHardcodedStrings({ root, file: "public/app.js" });
    assert.deepEqual(r.findings.map(f => f.line + ":" + f.text), ["1:Save changes", "3:Delete this item", "4:Something went wrong!", "5:Search tasks", "6:Pending approvals", "7:Owner approvals", "13:Mentés folyamatban"]);
    assert.equal(r.findings[0].suggestedKey, "save_changes"); assert.equal(r.findings.at(-1).suggestedKey, "mentes_folyamatban");
    assert.equal(scanHardcodedStrings({ root, file: "../app.js" }).reason, "PATH_TRAVERSAL_REFUSED");
    assert.equal(scanHardcodedStrings({ root, file: "public/missing.js" }).reason, "FILE_NOT_FOUND");
  } finally { rm(root); }
});

test("doc scanning ignores names inside fenced blocks for signature claims but counts them as mentions", () => {
  const root = write(tmp("ds-"), { ...SRC, "README.md": "```js\nscale(x)\nadd(a, b, c)\nload(); Store; VERSION\n```\n" }); try {
    const r = syncDocs({ root });
    assert.equal(r.counts.STALE_SIGNATURE, undefined); assert.equal(r.counts.UNDOCUMENTED, undefined);
  } finally { rm(root); }
});

test("status vocabulary is honest", () => {
  assert.equal(STATUS.completionState, "CODE_ADDED"); assert.equal(STATUS.live, "NOT_LIVE"); assert.equal(STATUS.descriptionAuthoring, "NEEDS_INJECTED_MODEL_ADAPTER");
  assert.ok(!JSON.stringify(STATUS).match(/VERIFIED_WORKING|"LIVE"/));
});

test("generateReference refuses non-API input; pipes and backticks in signatures cannot break the table", () => {
  assert.equal(generateReference(null).reason, "API_RESULT_REQUIRED");
  const g = generateReference({ ok: true, modules: [{ file: "a.mjs", exports: [{ name: "f", kind: "function", signature: "f(a = `x|y`)", reexport: false }] }] });
  assert.match(g.body, /\| `f` \| function \| `f\(a = 'x\\\|y'\)` \|/);
});

test("README missing is tolerated (not an error); a README that is a directory is refused", () => {
  const root = write(tmp("ds-"), SRC); try {
    assert.equal(syncDocs({ root }).ok, true);
    fs.mkdirSync(path.join(root, "README.md"));
    assert.equal(syncDocs({ root }).reason, "README_NOT_A_REGULAR_FILE");
  } finally { rm(root); }
});

test("scanHardcodedStrings: huge or binary files are refused, custom i18n function names honoured", () => {
  const root = write(tmp("ds-"), { "public/app.js": 'el.textContent = gettext("Save now");\nel.title = "Close window";\n', "public/big.js": "x".repeat(600 * 1024), "public/bin.js": Buffer.from([0, 0, 1]) }); try {
    assert.deepEqual(scanHardcodedStrings({ root, file: "public/app.js" }).findings.map(f => f.text), ["Close window"]);
    assert.deepEqual(scanHardcodedStrings({ root, file: "public/app.js", i18nFunctions: ["gettext"] }).findings.map(f => f.text), ["Close window"]);
    assert.equal(scanHardcodedStrings({ root, file: "public/big.js" }).reason, "FILE_TOO_LARGE");
    assert.equal(scanHardcodedStrings({ root, file: "public/bin.js" }).reason, "BINARY_FILE_REFUSED");
  } finally { rm(root); }
});
