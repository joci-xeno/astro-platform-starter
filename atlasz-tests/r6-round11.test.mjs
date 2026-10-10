import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { auditAccessibility } from "../atlasz-addons/a11y-audit.mjs";
import { withFileLock, lockTimings } from "../atlasz-addons/file-lock.mjs";
import { createPluginManager } from "../atlasz-addons/plugin-manager.mjs";
import { createProfiles, createAgentProfileGate } from "../atlasz-addons/assistant-profiles.mjs";
import { createDocumentCenter } from "../atlasz-addons/document-center.mjs";
import { createKnowledgeProjects } from "../atlasz-addons/knowledge-projects.mjs";
import { createResearchLedger } from "../atlasz-addons/research-ledger.mjs";
import { createOwnerAuth, generateOwnerKeyPair, issueOwnerApproval } from "../atlasz-addons/owner-auth.mjs";
import { rig } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

// ---------- lock ----------
test("lock r11: a symlinked store FILE shares one lock with its target; a future-dated guard does not block take-over", () => {
  const d = tmp("lk11-"); try {
    const a = path.join(d, "a.json"), b = path.join(d, "b.json"); fs.writeFileSync(a, "{}"); fs.symlinkSync(a, b);
    const old = { ...lockTimings }; lockTimings.waitMs = 200; lockTimings.staleMs = 600000;
    try { assert.equal(withFileLock(a, () => withFileLock(b, () => { const locks = fs.readdirSync(d).filter(x => x.endsWith(".lock")); assert.deepEqual(locks, ["a.json.lock"], "one lock file for both spellings"); return "same"; })), "same"); } finally { Object.assign(lockTimings, old); }
    const f = path.join(d, "f.json"), fut = new Date(Date.now() + 3600e3), past = new Date(Date.now() - 60e3);
    fs.writeFileSync(f + ".lock", "dead"); fs.utimesSync(f + ".lock", past, past); fs.writeFileSync(f + ".lock.guard", "dead"); fs.utimesSync(f + ".lock.guard", fut, fut);
    assert.equal(withFileLock(f, () => "ok"), "ok");
  } finally { rm(d); }
});

// ---------- plugins ----------
const key = generateOwnerKeyPair(), ap = (a, s) => issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action: a, subject: s });
test("plugins r11: the enabled/quarantined check and the audited start happen under the state lock, so a plugin another process just disabled cannot start", async () => {
  const root = tmp("pl11-"), plugins = path.join(root, "plugins"); fs.mkdirSync(plugins); const d = path.join(plugins, "p1"); fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, "plugin.json"), JSON.stringify({ schema: 1, version: "1.0.0", permissions: ["READ_STATE"], atlaszCompat: ">=7.3.0", id: "p1", name: "P", kind: "PLUGIN", entry: "main.mjs" })); fs.writeFileSync(path.join(d, "main.mjs"), "console.log('{}')");
  const mk = () => createPluginManager({ roots: [plugins], stateDir: path.join(root, "state"), ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }), hookTimeoutMs: 3000, quarantineAfter: 3 });
  const m1 = mk(), m2 = mk();
  try {
    assert.equal(m1.enable("p1", { ownerApproval: ap("PLUGIN_ENABLE", m1.enableSubject("p1")) }).ok, true);
    assert.equal((await m1.invoke("p1", "h", {})).ok, true);
    assert.equal(m2.disable("p1").ok, true);                                                         // the other manager disables it; m1 still has the old state in memory
    const r = await m1.invoke("p1", "h", {}); assert.equal(r.ok, false); assert.equal(r.reason, "NOT_ENABLED");
    const log = fs.readFileSync(path.join(root, "state", "plugins-audit.jsonl"), "utf8").trim().split("\n").map(x => JSON.parse(x).event);
    assert.ok(log.lastIndexOf("PLUGIN_DISABLED") > log.lastIndexOf("PLUGIN_HOOK_STARTED"), "no start is recorded after the disable");
  } finally { rm(root); }
});

// ---------- M12 ----------
test("M12 r11: a tenant-less store ({}) is damaged, never empty: no owner write may re-stamp the marker over it; the refusal names the way out", () => {
  const d = tmp("pg11-"); try {
    const file = path.join(d, "p.json"), P = createProfiles({ file }), gate = createAgentProfileGate({ file, tenantId: "JOCI" });
    assert.equal(P.create("JOCI", { actor: "OWNER", id: "p1", name: "n", instructions: "x", tools: [] }).ok, true); assert.equal(P.assign("JOCI", "SEARCH-1", "p1", { actor: "OWNER" }).ok, true);
    for (const bad of ["{}", "[]", '{"tenants":[]}', '{"tenants":null}']) {
      const keep = fs.readFileSync(file, "utf8"); fs.writeFileSync(file, bad);
      let wrote = false; try { const P2 = createProfiles({ file }); wrote = P2.create("JOCI", { actor: "OWNER", id: "p2", name: "m", instructions: "y", tools: [] }).ok; } catch { /* refusing to load a damaged store is fine too */ } assert.equal(wrote, false, bad);
      assert.equal(gate("SEARCH-1", "sandbox.x").allowed, false, bad); assert.match(fs.readFileSync(file + ".in-use", "utf8"), /SEARCH-1/, "marker untouched");
      fs.writeFileSync(file, keep);
    }
    const j = JSON.parse(fs.readFileSync(file, "utf8")); j.tenants.JOCI.assignments = {}; fs.writeFileSync(file, JSON.stringify(j));
    const w = createProfiles({ file }).assign("JOCI", "SEARCH-2", "p1", { actor: "OWNER" }); assert.equal(w.ok, false); assert.equal(w.reason, "PROFILE_STORE_ASSIGNMENTS_CHANGED_RECONCILE_REQUIRED");
  } finally { rm(d); }
});

// ---------- ledger ----------
const T = "T1", OWNER = { tenantId: T, role: "OWNER" }, RENT = "The monthly rent for the Maple Street warehouse is 4200 dollars payable on the first business day.";
function world() {
  const d = tmp("rl11-"), r = rig(), now = () => "2026-10-07T12:00:00.000Z";
  const dc = createDocumentCenter({ dir: path.join(d, "docs"), security: r.security, now }), kp = createKnowledgeProjects({ file: path.join(d, "kp.json"), documents: dc, security: r.security, now });
  const file = path.join(d, "rl.json"), mk = () => createResearchLedger({ file, knowledge: kp, security: r.security, blackBox: r.blackBox, now });
  const p = kp.create({ tenantId: T, name: "W", allowedRoles: ["OWNER", "AGENT"] }); kp.addWebSnapshot(p.id, { tenantId: T, url: "https://example.org/a", retrievedAt: now(), title: "A", text: RENT });
  return { d, kp, p, mk, file, cite: () => ({ ...kp.answer(p.id, { query: "monthly rent Maple Street", ...OWNER }).passages[0].citation }), done: () => { rm(d); r.stop?.(); } };
}
const CLAIM = "The monthly rent for the Maple Street warehouse is 4200 dollars";
test("ledger r11: citations are snapshotted to plain values (a stateful toJSON/valueOf cannot desynchronise the seal); a role-less caller has no access; a head ahead of the store is a rollback and is not blessed", () => {
  const w = world(); try {
    const rl = w.mk(), q = rl.openQuestion({ projectId: w.p.id, text: "Rent?" }, OWNER), fi = rl.addFinding(q.id, { claim: CLAIM }, OWNER); const c = w.cite(); let k = 0;
    const evil = { ...c, start: { valueOf() { return c.start; }, toJSON() { return ++k; } } };
    rl.attachEvidence(fi.id, { citation: evil }, OWNER); assert.equal(w.mk().verifyChain().ok, true, "the stored citation is a plain number");
    assert.throws(() => rl.attachEvidence(fi.id, { citation: { ...c, start: "x", end: 1.5 }, relation: "REFUTES" }, OWNER), /CITATION_INVALID_OFFSETS|ALREADY|CITATION_/);
    for (const f of [() => rl.openQuestion({ projectId: w.p.id, text: "Q?" }, { tenantId: T }), () => rl.list({ tenantId: T }), () => rl.report(q.id, { tenantId: T })]) { let r; try { r = f(); } catch { r = "threw"; } assert.ok(r === "threw" || (Array.isArray(r) && r.length === 0) || r?.ok === false, "a caller without a role gets nothing: " + JSON.stringify(r)?.slice(0, 80)); }
    // rollback: restore an older consistent store while the head is ahead
    const snap = fs.readFileSync(w.file, "utf8"); rl.openQuestion({ projectId: w.p.id, text: "Newer?" }, OWNER); fs.writeFileSync(w.file, snap);
    const rl2 = w.mk(); const ra = rl2.reanchor(OWNER); assert.equal(ra.ok, false); assert.equal(ra.reason, "STORE_BEHIND_HEAD_ROLLBACK_SUSPECTED"); assert.equal(rl2.verifyChain().ok, false);
  } finally { w.done(); }
});

// ---------- A13 ----------
const page = (body, head = "") => `<!doctype html><html lang="en"><head><title>t</title><meta name="viewport" content="width=device-width">${head}</head><body><main>${body}</main></body></html>`;
const OKCSS = "p{color:#000;background:#fff}", rules = r => r.findings.map(f => f.rule), inc = r => r.incomplete.join("|");
const A = (body, css = OKCSS, head = "") => auditAccessibility({ html: page(body, head), css, js: "" });
test("A13 r11: cascade: !important survives a later normal rule; opacity/filter/text-fill alone are reported; element-level custom properties win; UA default colours are not assumed fine", () => {
  assert.equal(A("<p>x</p>", "p{color:#eee!important;background:#fff} p{color:#000}").complete, false);
  assert.equal(A("<p>x</p>", "p{color:#eee;background:#fff!important} p{background:#000}").complete, false);
  for (const c of ["p{opacity:.3}", "body{opacity:.3}", "p{filter:contrast(.1)}", "p{-webkit-text-fill-color:#fff}", "p{opacity:var(--o)}", "p{opacity:30%}"]) assert.match(inc(A("<p>x</p>", OKCSS + c)), /COLOUR_AFFECTING_PROPERTY_NOT_EVALUATED/, c);
  assert.doesNotMatch(inc(A("<p>x</p>", OKCSS + "button:disabled{opacity:.5}")), /COLOUR_AFFECTING/);
  assert.ok(rules(A("<p>x</p>", "body{--c:#eee;background:#fff;color:var(--c)}:root{--c:#000}")).includes("CONTRAST"));
  assert.equal(A('<a href=x>l</a>', "body{background:#000;color:#fff}").complete, false);
  { const base = ":root{--bg:#fff;--ink:#000}body{color:var(--ink);background:var(--bg)}", ok = A("<p>x</p>", base); assert.equal(ok.complete, true, "baseline is clean: " + inc(ok));
    assert.match(inc(A("<a href=x>l</a>", base)), /COLOUR_RULES_NOT_EVALUATED/, "link without an a{color} rule on a styled page"); assert.equal(A("<a href=x>l</a>", base + "a{color:var(--ink)}").complete, true);
    assert.match(inc(A("<p>x</p>", base + "button{color:#000}")), /COLOUR_RULES_NOT_EVALUATED/, "control colour over the default fill"); assert.equal(A("<p>x</p>", base + "button{color:#000;background:#fff}").complete, true); }
  for (const c of ["button{color:#fff}", "input{color:#fff}", "*{color:#fff}", "select{color:#fff}", "textarea{color:#fff}"]) assert.equal(A("<p>x</p>", OKCSS + c).complete, false, c);
});
test("A13 r11: viewport: last value wins, unquoted content and '+1' are read; names: wrapped empty label, dangling/empty/self aria-labelledby, nbsp/zero-width names, svg-only links; main that is not a landmark; inline outline", () => {
  const vp = c => A("<p>x</p>", OKCSS, `<meta name=viewport content="${c}">`), vpu = c => auditAccessibility({ html: `<!doctype html><html lang=en><head><title>t</title><meta name=viewport content=${c}></head><body><main><p>x</p></main></body></html>`, css: OKCSS });
  assert.ok(rules(vpu("width=device-width,user-scalable=no")).includes("ZOOM_BLOCKED")); assert.ok(rules(vp("maximum-scale=5,maximum-scale=1")).includes("ZOOM_BLOCKED")); assert.ok(rules(vp("maximum-scale=+1")).includes("ZOOM_BLOCKED"));
  assert.equal(rules(vp("maximum-scale=1,maximum-scale=5")).includes("ZOOM_BLOCKED"), false); assert.equal(rules(vp("user-scalable=no,user-scalable=yes")).includes("ZOOM_BLOCKED"), false);
  assert.ok(rules(A("<label><input></label>")).includes("INPUT_LABEL")); assert.equal(rules(A("<label>Name <input></label>")).includes("INPUT_LABEL"), false); assert.equal(rules(A("<label><input> Name</label>")).includes("INPUT_LABEL"), false);
  assert.ok(rules(A('<span id=e></span><input aria-labelledby=e>')).includes("INPUT_LABEL")); assert.ok(rules(A('<input id=s aria-labelledby=s>')).includes("INPUT_LABEL")); assert.equal(rules(A('<span id=n>Name</span><input aria-labelledby=n>')).includes("INPUT_LABEL"), false);
  assert.ok(rules(A("<button>&nbsp;</button>")).includes("BUTTON_NAME")); assert.ok(rules(A("<button>&#8203;</button>")).includes("BUTTON_NAME")); assert.equal(rules(A("<button><span>Go</span></button>")).includes("BUTTON_NAME"), false);
  assert.ok(rules(A("<a href=x><svg></svg></a>")).includes("LINK_NAME")); assert.equal(rules(A("<a href=x><span>Go</span></a>")).includes("LINK_NAME"), false);
  const nm = h => auditAccessibility({ html: `<!doctype html><html lang="en"><head><title>t</title><meta name=viewport content="width=device-width"></head><body>${h}</body></html>`, css: OKCSS });
  for (const h of ["<main role=presentation>x</main>", "<main aria-hidden=true>x</main>"]) assert.ok(rules(nm(h)).includes("LANDMARK_MAIN"), h);
  for (const h of ['<a href=x style="outline:none">l</a>', '<button style="outline:0">b</button>', '<input style="outline:transparent">', '<div tabindex=0 style="outline:none">x</div>', '<div contenteditable style="outline:none">x</div>']) assert.ok(rules(A(h)).includes("FOCUS_REMOVED"), h);
  assert.equal(rules(A('<a href=x style="outline:none;box-shadow:0 0 0 2px #00f">l</a>')).includes("FOCUS_REMOVED"), false); assert.equal(rules(A('<div style="outline:none">x</div>')).includes("FOCUS_REMOVED"), false);
});
