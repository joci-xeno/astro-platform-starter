import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { auditAccessibility } from "../atlasz-addons/a11y-audit.mjs";
import { createPluginManager } from "../atlasz-addons/plugin-manager.mjs";
import { createProfiles } from "../atlasz-addons/assistant-profiles.mjs";
import { createDocumentCenter } from "../atlasz-addons/document-center.mjs";
import { createKnowledgeProjects } from "../atlasz-addons/knowledge-projects.mjs";
import { createResearchLedger } from "../atlasz-addons/research-ledger.mjs";
import { createOwnerAuth, generateOwnerKeyPair, issueOwnerApproval } from "../atlasz-addons/owner-auth.mjs";
import { rig } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

// ---------- A13 ----------
const page = body => `<!doctype html><html lang="en"><head><title>t</title><meta name="viewport" content="width=device-width"></head><body><main>${body}</main></body></html>`;
const rules = r => r.findings.map(f => f.rule), inc = r => r.incomplete.join("|");
const A = (body, css = "p{color:#000;background:#fff}") => auditAccessibility({ html: page(body), css, js: "" });

test("A13 r8: a tag name runs to whitespace, '/' or '>' (<style;=\"x> is an unknown element, not <style>) so markup after it is still audited", () => {
  const r = A('<style;="x><img src=a></main>'); assert.ok(rules(r).includes("IMG_ALT"), "the <img> is not hidden inside a fake style/quote");
  const r2 = A('<img;="x" src=a><img src=b>'); assert.ok(rules(r2).includes("IMG_ALT"));
  const r3 = A('<style;="x><img src=a><p title="q">y</p>'); assert.ok(rules(r3).includes("IMG_ALT"), "a quote inside the tag name opens no attribute value");
  const r4 = A('<p>x</p;="y><img src=a><p title="q">y</p>'); assert.ok(rules(r4).includes("IMG_ALT"), "same for closing tags");
});
test("A13 r8: in svg/math, script/style/xmp/iframe/noembed/noframes are ordinary elements: no raw-text skipping, and the result is ambiguous (never a clean pass)", () => {
  for (const t of ["script", "style", "xmp", "iframe", "noembed", "noframes"]) {
    const r = A(`<svg><${t}><img src=x></${t}></svg>`); assert.ok(rules(r).includes("IMG_ALT"), t + ": markup inside is audited"); assert.equal(r.complete, false); assert.match(inc(r), /HTML_PARSING_AMBIGUOUS/);
  }
});
test("A13 r8: <svg x=a/> is NOT self-closing (the slash is part of the unquoted value); <svg x=\"a\"/> and <svg/> are", () => {
  const open = A("<svg x=a/><img src=1>"), closed = A('<svg x="a"/><script><img src=1></script>'), bare = A("<svg/><script><img src=1></script>");
  assert.match(inc(open), /|/); assert.equal(rules(open).includes("IMG_ALT"), true);
  assert.equal(rules(closed).includes("IMG_ALT"), false, "a self-closed svg leaves HTML script raw text"); assert.equal(rules(bare).includes("IMG_ALT"), false);
  const open2 = A("<svg x=a/><script><img src=1></script>"); assert.equal(open2.complete, false, "still inside foreign content: ambiguous, not clean");
});
test("A13 r8: a backslash anywhere in an at-keyword (@im\\70 ort) is reported as an unevaluated stylesheet; escaped inline-style properties are reported", () => {
  const r = A("<p>x</p>", '@im\\70 ort "x.css";p{color:#000;background:#fff}'); assert.equal(r.complete, false); assert.match(inc(r), /EXTERNAL_STYLESHEET_NOT_EVALUATED/);
  const r2 = A('<p style="c\\olor:#fff;b\\ackground:#fff">x</p>'); assert.equal(r2.complete, false); assert.match(inc(r2), /COLOUR_RULES_NOT_EVALUATED/);
});

// ---------- plugins ----------
const key = generateOwnerKeyPair(), ap = (a, s) => issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action: a, subject: s });
test("plugins r8: failures below the threshold still accumulate toward quarantine when the state write keeps failing", async () => {
  const root = tmp("pl8-"), plugins = path.join(root, "plugins"); fs.mkdirSync(plugins);
  const d = path.join(plugins, "bad"); fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, "plugin.json"), JSON.stringify({ schema: 1, version: "1.0.0", permissions: ["READ_STATE"], atlaszCompat: ">=7.3.0", id: "bad", name: "Bad", kind: "PLUGIN", entry: "main.mjs" })); fs.writeFileSync(path.join(d, "main.mjs"), "process.exit(3);");
  const state = path.join(root, "state"), pm = createPluginManager({ roots: [plugins], stateDir: state, ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }), hookTimeoutMs: 1500, quarantineAfter: 3 });
  try {
    assert.equal(pm.enable("bad", { ownerApproval: ap("PLUGIN_ENABLE", pm.enableSubject("bad")) }).ok, true);
    fs.rmSync(path.join(state, "plugins-state.json.tmp"), { force: true }); fs.mkdirSync(path.join(state, "plugins-state.json.tmp"));      // from now on the state cannot be written
    for (let i = 0; i < 3; i++) await pm.invoke("bad", "h", {});
    assert.equal(pm.list().plugins[0].status, "QUARANTINED", "three failures quarantine even though no failure count could be saved");
    assert.equal((await pm.invoke("bad", "h", {})).ok, false);
  } finally { rm(root); }
});

// ---------- M12 ----------
test("M12 r8: a write after out-of-band tampering is refused instead of re-stamping the marker over the tampered state", () => {
  const d = tmp("pw8-"); try {
    const file = path.join(d, "p.json"), P = createProfiles({ file });
    assert.equal(P.create("JOCI", { actor: "OWNER", id: "p1", name: "narrow", instructions: "x", tools: [] }).ok, true);
    assert.equal(P.assign("JOCI", "EXECUTION-3", "p1", { actor: "OWNER" }).ok, true);
    const orig = fs.readFileSync(file, "utf8"), j = JSON.parse(orig); j.tenants.JOCI.assignments = {}; fs.writeFileSync(file, JSON.stringify(j));
    const r = P.create("JOCI", { actor: "OWNER", id: "p2", name: "other", instructions: "y", tools: [] }); assert.equal(r.ok, false);
    assert.equal(fs.readFileSync(file + ".in-use", "utf8").includes("EXECUTION-3"), true, "the marker was not rewritten over the tampering");
    assert.equal(P.assign("JOCI", "EXECUTION-4", "p1", { actor: "OWNER" }).ok, false);
    fs.writeFileSync(file, orig); assert.equal(P.create("JOCI", { actor: "OWNER", id: "p2", name: "other", instructions: "y", tools: [] }).ok, true, "restored state: normal writes work");
  } finally { rm(d); }
});

// ---------- ledger ----------
const T = "T1", OWNER = { tenantId: T, role: "OWNER" };
const RENT = "The monthly rent for the Maple Street warehouse is 4200 dollars payable on the first business day.";
function world() {
  const d = tmp("rl8-"), r = rig(), now = () => "2026-10-07T12:00:00.000Z";
  const dc = createDocumentCenter({ dir: path.join(d, "docs"), security: r.security, now });
  const kp = createKnowledgeProjects({ file: path.join(d, "kp.json"), documents: dc, security: r.security, now });
  const mk = () => createResearchLedger({ file: path.join(d, "rl.json"), knowledge: kp, security: r.security, blackBox: r.blackBox, now });
  const p = kp.create({ tenantId: T, name: "W", allowedRoles: ["OWNER", "AGENT"] }); kp.addWebSnapshot(p.id, { tenantId: T, url: "https://example.org/a", retrievedAt: now(), title: "A", text: RENT });
  return { d, kp, p, mk, file: path.join(d, "rl.json"), done: () => { rm(d); r.stop?.(); } };
}
test("ledger r8: evidence whose citation omits optional fields (undefined) round-trips: the seal survives a reload and the ledger is not bricked", () => {
  const w = world(); try {
    const rl = w.mk(), q = rl.openQuestion({ projectId: w.p.id, text: "Rent?" }, OWNER), fi = rl.addFinding(q.id, { claim: "The monthly rent for the Maple Street warehouse is 4200 dollars" }, OWNER);
    const c = { ...w.kp.answer(w.p.id, { query: "monthly rent Maple Street", ...OWNER }).passages[0].citation }; delete c.title; delete c.kind; delete c.version;
    let x; try { x = rl.attachEvidence(fi.id, { citation: c }, OWNER); } catch (e) { assert.fail("attach threw: " + e.message); }       // a verifier that insists on the fields is also fine: it fails closed, never bricks
    rl.confirmEvidence(fi.id, x.id, { note: "ok" }, OWNER);
    const rl2 = w.mk(); assert.equal(rl2.verifyChain().ok, true); assert.equal(rl2.report(q.id, OWNER).state, "ANSWERED"); rl2.openQuestion({ projectId: w.p.id, text: "Another?" }, OWNER);
  } finally { w.done(); }
});
test("ledger r8: verifyChain() and summary().chain report a store-only deletion of a question's findings (the seal), not just the event chain", () => {
  const w = world(); try {
    const rl = w.mk(), q = rl.openQuestion({ projectId: w.p.id, text: "Rent?" }, OWNER); rl.addFinding(q.id, { claim: "The monthly rent for the Maple Street warehouse is 4200 dollars" }, OWNER);
    const j = JSON.parse(fs.readFileSync(w.file, "utf8")); j.findings = {}; fs.writeFileSync(w.file, JSON.stringify(j));
    const rl2 = w.mk(); const v = rl2.verifyChain(); assert.equal(v.ok, false); assert.equal(v.reason, "STORE_ALTERED_OUTSIDE_LEDGER"); assert.equal(rl2.summary(OWNER).chain.ok, false);
  } finally { w.done(); }
});
