import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { auditAccessibility } from "../atlasz-addons/a11y-audit.mjs";
import { createPluginManager } from "../atlasz-addons/plugin-manager.mjs";
import { createAuditChain } from "../atlasz-addons/audit-chain.mjs";
import { createProfiles, createAgentProfileGate } from "../atlasz-addons/assistant-profiles.mjs";
import { createDocumentCenter } from "../atlasz-addons/document-center.mjs";
import { createKnowledgeProjects } from "../atlasz-addons/knowledge-projects.mjs";
import { createResearchLedger } from "../atlasz-addons/research-ledger.mjs";
import { createOwnerAuth, generateOwnerKeyPair, issueOwnerApproval } from "../atlasz-addons/owner-auth.mjs";
import { rig } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

const page = (body, head = "") => `<!doctype html><html lang="en"><head><title>t</title><meta name="viewport" content="width=device-width">${head}</head><body><main>${body}</main></body></html>`;
const OKCSS = "p{color:#000;background:#fff}", rules = r => r.findings.map(f => f.rule), inc = r => r.incomplete.join("|");
const A = (body, css = OKCSS, head = "") => auditAccessibility({ html: page(body, head), css, js: "" });

test("A13 r9: a stray '<' is text and does not swallow the next tag; '<' before a space/digit/'=' too", () => {
  for (const b of ["<p>1 < 2 <img src=a.png></p>", "<p>a <3 <img src=a.png></p>", "<p>x <= y <img src=a></p>", "<p>a < b</p><img src=a>"]) assert.ok(rules(A(b)).includes("IMG_ALT"), b);
});
test("A13 r9: whitespace around '=' still opens a quoted value (title = \">\")", () => {
  assert.ok(rules(A('<img src=a.png title = " alt=x>">')).includes("IMG_ALT"));
  assert.ok(rules(A("<img src=a.png title =\t' alt=x>'>")).includes("IMG_ALT"));
  assert.equal(rules(A('<img src=a.png title = "x" alt="d">')).includes("IMG_ALT"), false);
});
test("A13 r9: <image> is <img> to the HTML parser", () => { assert.ok(rules(A("<image src=x>")).includes("IMG_ALT")); });
test("A13 r9: <template> content is inert (cannot satisfy main/title/viewport) and is reported; media/disabled/non-CSS <style> is not merged and is reported", () => {
  const h = '<!doctype html><html lang="en"><body><template><main>x</main><title>T</title><meta name=viewport content="width=device-width"></template></body></html>';
  const r = auditAccessibility({ html: h, css: OKCSS }); assert.ok(rules(r).includes("LANDMARK_MAIN")); assert.ok(rules(r).includes("TITLE")); assert.match(inc(r), /TEMPLATE_CONTENT_NOT_EVALUATED/);
  for (const st of ["<style media=print>p{color:#000;background:#fff}</style>", "<style disabled>p{color:#000;background:#fff}</style>", "<style type=text/x-nope>p{color:#000;background:#fff}</style>"]) {
    const r2 = A("<p>x</p>", "p{color:#eee;background:#fff}", st); assert.ok(rules(r2).includes("CONTRAST"), "the print/disabled style does not rescue the page: " + st); assert.match(inc(r2), /CONDITIONAL_STYLE_NOT_EVALUATED/);
  }
  assert.match(inc(A("<noscript><style>p{color:#000}</style></noscript>")), /NOSCRIPT_CONTENT_AMBIGUOUS/);
});
test("A13 r9: @layer, earlier !important, ';' inside strings, and colour-changing properties never give a clean result", () => {
  assert.equal(A("<p>x</p>", "p{color:#eee;background:#fff} @layer x{p{color:#000}}").complete, false);
  { const r = A("<p>x</p>", "p{color:#eee!important;color:#000;background:#fff}"); assert.equal(r.complete, false); }
  { const r = A("<p>x</p>", 'p{color:#eee;background:#fff;content:"a;color:#000;b"}'); assert.ok(rules(r).includes("CONTRAST"), "the string is one declaration"); }
  { const r = A("<p>x</p>", 'p{color:#eee;background:#fff;content:"a\\";color:#000;b"}'); assert.ok(rules(r).includes("CONTRAST"), "an escaped quote does not end the string"); }
  { const r = A("<p>x</p>", "p{color:#eee;background:#fff;content:url(a;color:#000)}"); assert.ok(rules(r).includes("CONTRAST"), "';' inside parentheses does not split"); }
  { const r = A('<p style=\'color:#eee;background:#fff;content:"a;color:#000"\'>x</p>'); assert.ok(rules(r).includes("CONTRAST")); }
  for (const extra of ["opacity:.15", "background-image:url(w.png)", "-webkit-text-fill-color:#fff", "filter:invert(1)", "mix-blend-mode:difference"]) { const r = A("<p>x</p>", `p{color:#000;background:#fff;${extra}}`); assert.equal(r.complete, false, extra); assert.match(inc(r), /COLOUR_AFFECTING_PROPERTY_NOT_EVALUATED/); }
  assert.equal(A('<p style="color:#000;background:#fff;opacity:.1">x</p>').complete, false);
});
test("A13 r9: every way of removing the focus outline is a FAIL unless a real replacement exists", () => {
  for (const c of ["button:focus{outline:none!important}", "button:focus{outline:0px}", "button:focus{outline-width:0}", "button:focus{outline:transparent}", ".b:focus-visible{outline:none}", "*:focus-visible{outline:none}", "button:focus{outline:none;box-shadow:none}", "a:focus{outline:0;box-shadow:0}"])
    assert.ok(rules(A("<p>x</p>", OKCSS + c)).includes("FOCUS_REMOVED"), c);
  for (const c of ["button:focus{outline:none;box-shadow:0 0 0 2px #00f}", "button:focus:not(:focus-visible){outline:none}"]) assert.equal(rules(A("<p>x</p>", OKCSS + c)).includes("FOCUS_REMOVED"), false, c);
});
test("A13 r9: markup rules: unclosed label, empty aria-labelledby/aria-label, several viewport metas, entities in aria-hidden, more focusables, tabindex parsing, image inputs, nbsp title, duplicate ids through a label", () => {
  assert.ok(rules(A("<div><label>foo</div><input>")).includes("INPUT_LABEL"));
  assert.equal(rules(A("<label>foo <input></label>")).includes("INPUT_LABEL"), false);
  assert.ok(rules(A('<input aria-labelledby="">')).includes("INPUT_LABEL")); assert.ok(rules(A('<button aria-labelledby=""></button>')).includes("BUTTON_NAME")); assert.ok(rules(A('<nav aria-label="">x</nav>')).includes("NAV_LABEL"));
  assert.ok(rules(A("<p>x</p>", OKCSS, '<meta name=viewport content="user-scalable=no">')).includes("ZOOM_BLOCKED"));
  assert.ok(rules(A('<a href=x aria-hidden="&#116;rue">x</a>')).includes("ARIA_HIDDEN_FOCUSABLE"));
  for (const t of ["<summary>x</summary>", "<iframe></iframe>", "<video></video>", "<div contenteditable>x</div>"]) assert.ok(rules(A(`<div aria-hidden=true>${t}</div>`)).includes("ARIA_HIDDEN_FOCUSABLE"), t);
  assert.ok(rules(A('<div tabindex="1abc">x</div>')).includes("TABINDEX_POSITIVE"));
  assert.ok(rules(A("<input type=image src=a>")).includes("INPUT_LABEL"));
  assert.ok(rules(auditAccessibility({ html: '<!doctype html><html lang="en"><head><title>&nbsp;</title></head><body><main>x</main></body></html>', css: OKCSS })).includes("TITLE"));
  assert.ok(rules(A('<label id=a>x</label><div id=a>y</div>')).includes("DUPLICATE_ID"));
});

// ---------- plugins ----------
const key = generateOwnerKeyPair(), ap = (a, s) => issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action: a, subject: s });
function plug(code, o = {}) {
  const root = tmp("pl9-"), plugins = path.join(root, "plugins"); fs.mkdirSync(plugins); const d = path.join(plugins, "p1"); fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, "plugin.json"), JSON.stringify({ schema: 1, version: "1.0.0", permissions: ["READ_STATE"], atlaszCompat: ">=7.3.0", id: "p1", name: "P", kind: "PLUGIN", entry: "main.mjs" })); fs.writeFileSync(path.join(d, "main.mjs"), code);
  const mk = () => createPluginManager({ roots: [plugins], stateDir: path.join(root, "state"), ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }), hookTimeoutMs: 3000, quarantineAfter: 3, ...o });
  const pm = mk(); return { root, pm, mk, state: path.join(root, "state"), enable: m => m.enable("p1", { ownerApproval: ap("PLUGIN_ENABLE", m.enableSubject("p1")) }), reset: m => m.resetQuarantine("p1", { ownerApproval: ap("PLUGIN_RESET_QUARANTINE", "p1") }), done: () => rm(root) };
}
test("plugins r9: a malformed hook name is a result, never a plugin failure; null options do not throw; multi-byte output survives chunking", async () => {
  const r = plug("console.log(JSON.stringify({s:'€'.repeat(60000)}));"); try {
    assert.equal(r.enable(r.pm).ok, true);
    for (const h of ["a\0b", "x".repeat(200), "1abc", "", null, 5]) assert.equal((await r.pm.invoke("p1", h, {})).reason, "HOOK_NAME_INVALID");
    assert.notEqual(r.pm.list().plugins[0].status, "QUARANTINED"); assert.equal(r.pm.list().plugins[0].failures, 0);
    assert.equal(r.pm.enable("p1", null).ok, false); assert.equal(r.pm.resetQuarantine("p1", null).ok, false);
    const o = await r.pm.invoke("p1", "h", {}); assert.equal(o.ok, true); assert.equal(o.result.s.length, 60000); assert.equal(o.result.s.includes("�"), false);
  } finally { r.done(); }
});
test("plugins r9: after another manager resets a quarantine, this manager does not resurrect the old failure count", async () => {
  const r = plug("process.exit(3);"); try {
    const m1 = r.pm, m2 = r.mk(); assert.equal(r.enable(m1).ok, true);
    for (let i = 0; i < 3; i++) await m1.invoke("p1", "h", {}); assert.equal(m1.list().plugins[0].status, "QUARANTINED");
    assert.equal(r.reset(m2).ok, true); assert.equal(r.enable(m2).ok, true);
    const s = m1.list().plugins[0]; assert.equal(s.failures, 0); assert.equal(s.status, "ENABLED");
  } finally { r.done(); }
});
test("plugins r9: in-flight runs of a crashing plugin are capped and quarantine is recorded once", async () => {
  const r = plug("setTimeout(()=>process.exit(3),200);"); try {
    assert.equal(r.enable(r.pm).ok, true); const res = await Promise.all(Array.from({ length: 8 }, () => r.pm.invoke("p1", "h", {})));
    assert.ok(res.filter(x => x.reason === "PLUGIN_BUSY").length >= 6); const log = fs.readFileSync(path.join(r.state, "plugins-audit.jsonl"), "utf8");
    assert.ok((log.match(/PLUGIN_QUARANTINED/g) ?? []).length <= 1); assert.equal(r.pm.auditVerify().ok, true);
  } finally { r.done(); }
});
const run = (code, args) => new Promise(res => { const c = spawn(process.execPath, ["--input-type=module", "-e", code, ...args], { stdio: ["ignore", "pipe", "pipe"] }); let e = ""; c.stderr.on("data", d => e += d); c.on("close", k => res({ k, e })); });
test("audit chain r9: four processes appending to one log keep an unbroken chain", async () => {
  const d = tmp("ac9-"); try {
    const f = path.join(d, "a.jsonl"), mod = new URL("../atlasz-addons/audit-chain.mjs", import.meta.url).href;
    const code = `import { createAuditChain } from ${JSON.stringify(mod)}; const c = createAuditChain({ filePath: process.argv[1] }); for (let i = 0; i < 60; i++) c.append("E", { i, p: process.pid });`;
    const rs = await Promise.all([1, 2, 3, 4].map(() => run(code, [f]))); for (const x of rs) assert.equal(x.k, 0, x.e);
    const c = createAuditChain({ filePath: f }); assert.equal(c.verify().ok, true); assert.equal(c.verify().entries ?? 240, 240);
    assert.equal(fs.readFileSync(f, "utf8").trim().split("\n").length, 240);
  } finally { rm(d); }
});

// ---------- M12 ----------
test("M12 r9: an unset tenant id in the gate is a denial; reconcileMarker is owner-only, reports exactly what changed, and unlocks a tampered store", () => {
  const d = tmp("pg9-"); try {
    const file = path.join(d, "p.json"), P = createProfiles({ file });
    assert.equal(P.create("JOCI", { actor: "OWNER", id: "p1", name: "n", instructions: "x", tools: [] }).ok, true); assert.equal(P.assign("JOCI", "EXECUTION-3", "p1", { actor: "OWNER" }).ok, true);
    for (const t of [undefined, null, "", 5]) assert.equal(createAgentProfileGate({ file, tenantId: t })("EXECUTION-3", "sandbox.x").allowed, false);
    const j = JSON.parse(fs.readFileSync(file, "utf8")); j.tenants.JOCI.assignments = {}; fs.writeFileSync(file, JSON.stringify(j));
    assert.equal(P.assign("JOCI", "EXECUTION-4", "p1", { actor: "OWNER" }).ok, false);
    assert.equal(P.reconcileMarker({ actor: "AGENT" }).ok, false); assert.equal(P.reconcileMarker({}).ok, false);
    const rc = P.reconcileMarker({ actor: "OWNER" }); assert.equal(rc.ok, true); assert.deepEqual(rc.changed, ["JOCI/EXECUTION-3"]);
    assert.equal(P.assign("JOCI", "EXECUTION-4", "p1", { actor: "OWNER" }).ok, true);
  } finally { rm(d); }
});
test("M12 r9: processes writing profiles concurrently lose no acknowledged write", async () => {
  const d = tmp("pc9-"); try {
    const file = path.join(d, "p.json"), mod = new URL("../atlasz-addons/assistant-profiles.mjs", import.meta.url).href;
    const code = `import { createProfiles } from ${JSON.stringify(mod)}; const P = createProfiles({ file: process.argv[1] }); const me = process.argv[2]; let ok = 0; for (let i = 0; i < 12; i++) { const r = P.create("JOCI", { actor: "OWNER", id: me + "-" + i, name: "n" + i, instructions: "x", tools: [] }); if (r.ok) ok++; } console.log(ok);`;
    const rs = await Promise.all(["a", "b", "c"].map(n => run(code, [file, n]))); for (const x of rs) assert.equal(x.k, 0, x.e);
    const ids = Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).tenants.JOCI.profiles); assert.equal(ids.length, 36);
  } finally { rm(d); }
});

// ---------- ledger ----------
const T = "T1", OWNER = { tenantId: T, role: "OWNER" };
const RENT = "The monthly rent for the Maple Street warehouse is 4200 dollars payable on the first business day.";
function world() {
  const d = tmp("rl9-"), r = rig(), now = () => "2026-10-07T12:00:00.000Z";
  const dc = createDocumentCenter({ dir: path.join(d, "docs"), security: r.security, now }), kp = createKnowledgeProjects({ file: path.join(d, "kp.json"), documents: dc, security: r.security, now });
  const mk = () => createResearchLedger({ file: path.join(d, "rl.json"), knowledge: kp, security: r.security, blackBox: r.blackBox, now });
  const p = kp.create({ tenantId: T, name: "W", allowedRoles: ["OWNER", "AGENT"] }); kp.addWebSnapshot(p.id, { tenantId: T, url: "https://example.org/a", retrievedAt: now(), title: "A", text: RENT });
  const cite = () => ({ ...kp.answer(p.id, { query: "monthly rent Maple Street", ...OWNER }).passages[0].citation });
  return { d, kp, p, mk, cite, file: path.join(d, "rl.json"), done: () => { rm(d); r.stop?.(); } };
}
const CLAIM = "The monthly rent for the Maple Street warehouse is 4200 dollars";
test("ledger r9: a deleted head anchor is not adopted by a new instance (a forged owner confirmation stays CONFLICTED); reanchor is owner-only and verifies the chain", () => {
  const w = world(); try {
    const rl = w.mk(), q = rl.openQuestion({ projectId: w.p.id, text: "Rent?" }, OWNER), fi = rl.addFinding(q.id, { claim: CLAIM }, OWNER); const x = rl.attachEvidence(fi.id, { citation: w.cite() }, OWNER);
    fs.rmSync(w.file + ".head"); const rl2 = w.mk();
    assert.equal(rl2.verifyChain().ok, false); assert.equal(rl2.verifyChain().reason, "HEAD_ANCHOR_MISSING"); assert.throws(() => rl2.openQuestion({ projectId: w.p.id, text: "More?" }, OWNER), /CHAIN_BROKEN/);
    assert.throws(() => rl2.reanchor({ tenantId: T, role: "AGENT", forAgent: true }), /OWNER_ONLY/); assert.throws(() => rl2.reanchor({ tenantId: T }), /OWNER_ONLY/);
    const ra = rl2.reanchor(OWNER); assert.equal(ra.ok, true); assert.equal(rl2.verifyChain().ok, true); rl2.openQuestion({ projectId: w.p.id, text: "More?" }, OWNER);
    // an altered chain is not re-anchored
    fs.rmSync(w.file + ".head"); const j = JSON.parse(fs.readFileSync(w.file, "utf8")); j.events[0].by = "EVIL"; fs.writeFileSync(w.file, JSON.stringify(j));
    const rl3 = w.mk(); const r3 = rl3.reanchor(OWNER); assert.equal(r3.ok, false); assert.equal(r3.reason, "CHAIN_BROKEN"); void x;
  } finally { w.done(); }
});
test("ledger r9: non-JSON citation fields (Date, URL) are stored as plain values and never brick the ledger; confirm needs an explicit OWNER role; injected state with no events fails; 'by' is bounded", () => {
  const w = world(); try {
    const rl = w.mk(), q = rl.openQuestion({ projectId: w.p.id, text: "Rent?" }, OWNER), fi = rl.addFinding(q.id, { claim: CLAIM }, OWNER);
    const x = rl.attachEvidence(fi.id, { citation: { ...w.cite(), title: new Date(0), kind: undefined } }, OWNER);
    const rl2 = w.mk(); assert.equal(rl2.verifyChain().ok, true); rl2.openQuestion({ projectId: w.p.id, text: "Another?" }, OWNER);
    assert.throws(() => rl2.confirmEvidence(fi.id, x.id, { note: "n" }, { tenantId: T }), /OWNER_ONLY/);
    assert.throws(() => rl2.confirmEvidence(fi.id, x.id, { note: "n" }, undefined), /OWNER_ONLY/);
    rl2.confirmEvidence(fi.id, x.id, { note: "n" }, OWNER);
    const e = rl2.events(OWNER).at(-1); assert.equal(e.type, "EVIDENCE_CONFIRMED");
    const q2 = rl2.openQuestion({ projectId: w.p.id, text: "Big by?" }, OWNER); void q2; rl2.addFinding(q.id, { claim: CLAIM + " today", by: "B".repeat(5000) }, OWNER);
    assert.ok(rl2.events(OWNER).every(ev => String(ev.by).length <= 80));
  } finally { w.done(); }
  const w2 = world(); try {
    const rl = w2.mk(); rl.openQuestion({ projectId: w2.p.id, text: "Q?" }, OWNER); const j = JSON.parse(fs.readFileSync(w2.file, "utf8")); j.events = []; fs.rmSync(w2.file + ".head"); fs.writeFileSync(w2.file, JSON.stringify(j));
    const v = w2.mk().verifyChain(); assert.equal(v.ok, false);
  } finally { w2.done(); }
});
test("ledger r9: processes writing concurrently keep the ledger intact", async () => {
  const w = world(); try {
    const code = (mod) => `import fs from "node:fs"; process.argv[1];`; void code;
    const rl0 = w.mk(); rl0.openQuestion({ projectId: w.p.id, text: "seed" }, OWNER);
    const base = new URL("../atlasz-addons/", import.meta.url).href;
    const script = `import path from "node:path"; import { createDocumentCenter } from ${JSON.stringify(base + "document-center.mjs")}; import { createKnowledgeProjects } from ${JSON.stringify(base + "knowledge-projects.mjs")}; import { createResearchLedger } from ${JSON.stringify(base + "research-ledger.mjs")}; import { rig } from ${JSON.stringify(new URL("./owner-control-rig.mjs", import.meta.url).href)};
      const d = process.argv[1], now = () => "2026-10-07T12:00:00.000Z", r = rig(); const dc = createDocumentCenter({ dir: path.join(d, "docs"), security: r.security, now }); const kp = createKnowledgeProjects({ file: path.join(d, "kp.json"), documents: dc, security: r.security, now });
      const rl = createResearchLedger({ file: path.join(d, "rl.json"), knowledge: kp, security: r.security, blackBox: r.blackBox, now }); let ok = 0; for (let i = 0; i < 15; i++) { try { rl.openQuestion({ projectId: process.argv[2], text: "q " + process.argv[3] + " " + i }, { tenantId: "T1", role: "OWNER" }); ok++; } catch (e) { console.error(e.message); } } console.log(ok); r.stop?.(); process.exit(0);`;
    const rs = await Promise.all(["a", "b", "c"].map(n => new Promise(res => { const c = spawn(process.execPath, ["--input-type=module", "-e", script, w.d, w.p.id, n], { stdio: ["ignore", "pipe", "pipe"] }); let o = "", e = ""; c.stdout.on("data", x => o += x); c.stderr.on("data", x => e += x); c.on("close", k => res({ k, o, e })); })));
    for (const x of rs) { assert.equal(x.k, 0, x.e); assert.equal(x.o.trim(), "15", x.e); }
    const rl = w.mk(); assert.equal(rl.verifyChain().ok, true); assert.equal(rl.list(OWNER).length, 46);
  } finally { w.done(); }
});
