import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { auditAccessibility } from "../atlasz-addons/a11y-audit.mjs";
import { withFileLock, lockTimings, _takeOver } from "../atlasz-addons/file-lock.mjs";
import { createAuditChain } from "../atlasz-addons/audit-chain.mjs";
import { createProfiles, createAgentProfileGate } from "../atlasz-addons/assistant-profiles.mjs";
import { createPluginManager } from "../atlasz-addons/plugin-manager.mjs";
import { createOwnerAuth, generateOwnerKeyPair, issueOwnerApproval } from "../atlasz-addons/owner-auth.mjs";
import { createDocumentCenter } from "../atlasz-addons/document-center.mjs";
import { createKnowledgeProjects } from "../atlasz-addons/knowledge-projects.mjs";
import { createResearchLedger } from "../atlasz-addons/research-ledger.mjs";
import { rig } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

const run = (code, args) => new Promise(res => { const c = spawn(process.execPath, ["--input-type=module", "-e", code, ...args], { stdio: ["ignore", "pipe", "pipe"] }); let o = "", e = ""; c.stdout.on("data", d => o += d); c.stderr.on("data", d => e += d); c.on("close", k => res({ k, o, e })); });
const withTimings = (t, fn) => { const old = { ...lockTimings }; Object.assign(lockTimings, t); let r; try { r = fn(); } catch (e) { Object.assign(lockTimings, old); throw e; } if (r && typeof r.then === "function") return r.finally(() => Object.assign(lockTimings, old)); Object.assign(lockTimings, old); return r; };

// ---------- lock ----------
test("lock r10: a dangling symlink, a stale directory or a future-dated lock never spin forever: stale ones are taken over, live ones time out", () => {
  const d = tmp("lk-"); try {
    const f = path.join(d, "s.json");
    fs.symlinkSync("/nonexistent/target", f + ".lock"); assert.equal(withFileLock(f, () => 7), 7, "a dangling symlink in the lock's place is stale");
    fs.mkdirSync(f + ".lock"); assert.equal(withFileLock(f, () => 8), 8, "a directory in the lock's place is stale");
    fs.writeFileSync(f + ".lock", "x"); const fut = new Date(Date.now() + 3600e3); fs.utimesSync(f + ".lock", fut, fut); assert.equal(withFileLock(f, () => 9), 9, "a lock dated in the future is stale");
    fs.writeFileSync(f + ".lock", "live"); const t0 = Date.now();
    assert.throws(() => withTimings({ waitMs: 300 }, () => withFileLock(f, () => 1)), /LOCK_TIMEOUT/); assert.ok(Date.now() - t0 < 3000, "bounded wait");
    assert.equal(fs.readFileSync(f + ".lock", "utf8"), "live", "a live foreign lock is never deleted");
    fs.rmSync(f + ".lock"); assert.equal(withFileLock(f, () => withFileLock(f, () => "nested")), "nested", "re-entrant");
  } finally { rm(d); }
});
test("lock r10: take-over re-checks under the guard: a lock that was renewed or replaced since it was seen as stale is NOT removed", () => {
  const d = tmp("lk5-"); try {
    const lp = path.join(d, "x.lock"); fs.writeFileSync(lp, "dead"); const old = new Date(Date.now() - 60e3); fs.utimesSync(lp, old, old);
    const seen = fs.lstatSync(lp); fs.rmSync(lp); fs.writeFileSync(lp, "live-new-holder");                 // somebody else took the stale lock over first and now holds a fresh one
    assert.equal(_takeOver(lp, seen), false); assert.equal(fs.readFileSync(lp, "utf8"), "live-new-holder");
    fs.utimesSync(lp, old, old); const seen2 = fs.lstatSync(lp); assert.equal(_takeOver(lp, seen2), true); assert.equal(fs.existsSync(lp), false);
    assert.equal(fs.existsSync(lp + ".guard"), false, "guard released");
  } finally { rm(d); }
});
test("lock r10: a holder never removes a lock that now belongs to somebody else", () => {
  const d = tmp("lk2-"); try {
    const f = path.join(d, "s.json");
    withFileLock(f, () => { fs.writeFileSync(f + ".lock", "someone-elses-token"); });
    assert.equal(fs.readFileSync(f + ".lock", "utf8"), "someone-elses-token");
  } finally { rm(d); }
});
test("lock r10: six processes racing on one STALE lock never overlap and never lose an update", async () => {
  const d = tmp("lk3-"); try {
    const f = path.join(d, "ctr.txt"), mod = new URL("../atlasz-addons/file-lock.mjs", import.meta.url).href;
    const code = `import fs from "node:fs"; import { withFileLock, lockTimings, _takeOver } from ${JSON.stringify(mod)}; lockTimings.staleMs = 400; const f = process.argv[1]; for (let i = 0; i < 25; i++) withFileLock(f, () => { const n = Number(fs.readFileSync(f, "utf8")); const t = Date.now(); while (Date.now() - t < 2) { /* hold */ } fs.writeFileSync(f, String(n + 1)); });`;
    for (let trial = 0; trial < 4; trial++) {
      fs.writeFileSync(f, "0"); fs.writeFileSync(f + ".lock", "dead-holder"); const old = new Date(Date.now() - 60e3); fs.utimesSync(f + ".lock", old, old);
      const rs = await Promise.all(Array.from({ length: 6 }, () => run(code, [f]))); for (const x of rs) assert.equal(x.k, 0, x.e);
      assert.equal(fs.readFileSync(f, "utf8"), "150", "trial " + trial + ": 6 x 25 increments, none lost");
    }
  } finally { rm(d); }
});
test("lock r10: the same store reached through different path spellings shares one lock", () => {
  const d = tmp("lk4-"); try {
    fs.mkdirSync(path.join(d, "real")); fs.symlinkSync(path.join(d, "real"), path.join(d, "alias"));
    const a = path.join(d, "real", "s.json"), b = path.join(d, "alias", "s.json");
    assert.equal(withTimings({ waitMs: 200, staleMs: 600000 }, () => withFileLock(a, () => withFileLock(b, () => "inner"))), "inner", "one lock for both spellings (otherwise the inner call would time out)");
  } catch (e) { assert.fail(String(e)); } finally { rm(d); }
});

// ---------- audit chain ----------
test("audit r10: a damaged but fully written final line is tampering (not a crash artefact) and is never silently cut away; a torn line without newline still heals", () => {
  const d = tmp("ac10-"); try {
    const f = path.join(d, "a.jsonl"), A = createAuditChain({ filePath: f }); A.append("A"); A.append("B"); A.append("C");
    const raw = fs.readFileSync(f, "utf8"); const lines = raw.trimEnd().split("\n"); lines[2] = lines[2].slice(0, -2) + "XX"; fs.writeFileSync(f, lines.join("\n") + "\n");
    assert.throws(() => createAuditChain({ filePath: f }), /AUDIT_FILE_CORRUPT|AUDIT_CHAIN_TAMPERED/);
    fs.writeFileSync(f, lines.slice(0, 2).join("\n") + "\n" + '{"seq":3,"at":"x'); const B = createAuditChain({ filePath: f }); B.append("D"); assert.equal(createAuditChain({ filePath: f }).entries().length, 3);
    const tail = fs.readFileSync(f, "utf8").trimEnd().split("\n"); tail[tail.length - 1] = "{broken}"; fs.writeFileSync(f, tail.join("\n") + "\n"); const C = createAuditChain.length >= 0 ? null : null; void C;
    assert.throws(() => createAuditChain({ filePath: f }), /AUDIT_FILE_CORRUPT|AUDIT_CHAIN_TAMPERED/);
  } finally { rm(d); }
});

// ---------- plugins ----------
const key = generateOwnerKeyPair(), ap = (a, s) => issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action: a, subject: s });
test("plugins r10: a busy state lock is a result (STATE_LOCKED) and never turns a healthy run into a plugin failure", async () => {
  const root = tmp("pl10-"), plugins = path.join(root, "plugins"); fs.mkdirSync(plugins); const d = path.join(plugins, "p1"); fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, "plugin.json"), JSON.stringify({ schema: 1, version: "1.0.0", permissions: ["READ_STATE"], atlaszCompat: ">=7.3.0", id: "p1", name: "P", kind: "PLUGIN", entry: "main.mjs" })); fs.writeFileSync(path.join(d, "main.mjs"), "console.log(JSON.stringify({ok:1}));");
  const pm = createPluginManager({ roots: [plugins], stateDir: path.join(root, "state"), ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }), hookTimeoutMs: 3000, quarantineAfter: 3 });
  try {
    assert.equal(pm.enable("p1", { ownerApproval: ap("PLUGIN_ENABLE", pm.enableSubject("p1")) }).ok, true);
    const lock = path.join(root, "state", "plugins-state.json.lock"); fs.writeFileSync(lock, "other-process");
    await withTimings({ waitMs: 200, staleMs: 600000 }, async () => {
      const r = await pm.invoke("p1", "h", {}); assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(fs.existsSync(lock), "lock survived invoke");
      const dd = pm.disable("p1"); assert.equal(dd.ok, false, JSON.stringify(dd)); assert.equal(dd.reason, "STATE_LOCKED", JSON.stringify(dd));
      assert.ok(fs.existsSync(lock), "lock survived disable"); assert.equal(pm.enable("p1", null).ok, false);
    });
    fs.rmSync(lock); assert.equal(pm.list().plugins[0].failures, 0); assert.equal(pm.list().plugins[0].status, "ENABLED");
  } finally { rm(root); }
});

// ---------- M12 ----------
test("M12 r10: deleting the store then writing something unrelated does not silently free a restricted agent; the owner can acknowledge the loss explicitly", () => {
  const d = tmp("pg10-"); try {
    const file = path.join(d, "p.json"), P = createProfiles({ file }), gate = createAgentProfileGate({ file, tenantId: "JOCI" });
    assert.equal(P.create("JOCI", { actor: "OWNER", id: "p1", name: "n", instructions: "x", tools: [] }).ok, true); assert.equal(P.assign("JOCI", "SEARCH-1", "p1", { actor: "OWNER" }).ok, true);
    fs.rmSync(file); assert.equal(gate("SEARCH-1", "sandbox.x").allowed, false);
    const P2 = createProfiles({ file }); const w = P2.create("JOCI", { actor: "OWNER", id: "p2", name: "m", instructions: "y", tools: [] }); assert.equal(w.ok, false);
    assert.equal(gate("SEARCH-1", "sandbox.x").allowed, false, "still denied: the write did not recreate the store and re-stamp the marker");
    const rc = P2.reconcileMarker({ actor: "OWNER" }); assert.equal(rc.ok, true); assert.deepEqual(rc.changed, ["JOCI/SEARCH-1"]); assert.equal(rc.storeMissing, true);
    assert.equal(P2.create("JOCI", { actor: "OWNER", id: "p2", name: "m", instructions: "y", tools: [] }).ok, true);
  } finally { rm(d); }
  { const d2 = tmp("pg10b-"); try { const file = path.join(d2, "p.json"), P = createProfiles({ file }); fs.writeFileSync(file + ".lock", "other");
      withTimings({ waitMs: 150, staleMs: 600000 }, () => { const r = P.create("JOCI", { actor: "OWNER", id: "p1", name: "n", instructions: "x", tools: [] }); assert.deepEqual([r.ok, r.reason], [false, "PROFILE_STORE_BUSY"]); }); } finally { rm(d2); } }
  assert.equal(createAgentProfileGate({ file: "/tmp/x.json", tenantId: "a b" })("EXECUTION-3", "x").allowed, false, "a syntactically invalid tenant id is refused");
});

// ---------- ledger ----------
const T = "T1", OWNER = { tenantId: T, role: "OWNER" }, RENT = "The monthly rent for the Maple Street warehouse is 4200 dollars payable on the first business day.";
test("ledger r10: reanchor never reports success unless the anchor now matches; a SEARCH-role caller is authored as an agent", () => {
  const d = tmp("rl10-"), r = rig(), now = () => "2026-10-07T12:00:00.000Z";
  try {
    const dc = createDocumentCenter({ dir: path.join(d, "docs"), security: r.security, now }), kp = createKnowledgeProjects({ file: path.join(d, "kp.json"), documents: dc, security: r.security, now });
    const file = path.join(d, "rl.json"), mk = () => createResearchLedger({ file, knowledge: kp, security: r.security, blackBox: r.blackBox, now });
    const p = kp.create({ tenantId: T, name: "W", allowedRoles: ["OWNER", "AGENT", "SEARCH"] }); kp.addWebSnapshot(p.id, { tenantId: T, url: "https://example.org/a", retrievedAt: now(), title: "A", text: RENT });
    const rl = mk(); rl.openQuestion({ projectId: p.id, text: "Q1?" }, OWNER); rl.openQuestion({ projectId: p.id, text: "Q2?" }, OWNER);
    const store = fs.readFileSync(file, "utf8"); fs.rmSync(file); const rl2 = mk();
    const res = rl2.reanchor(OWNER); assert.equal(res.ok, false); assert.equal(res.reason, "STORE_EMPTY_BUT_HEAD_REMAINS"); assert.equal(rl2.verifyChain().ok, false);
    fs.writeFileSync(file, store); fs.rmSync(file + ".head"); fs.mkdirSync(file + ".head");                           // an unwritable head path
    const rl3 = mk(); const r3 = rl3.reanchor(OWNER); assert.equal(r3.ok, false); assert.equal(r3.reason, "HEAD_NOT_WRITTEN"); assert.equal(rl3.verifyChain().ok, false);
    fs.rmSync(file + ".head", { recursive: true });
    const rl4 = mk(); assert.equal(rl4.reanchor(OWNER).ok, true); assert.equal(rl4.verifyChain().ok, true);
    const q = rl4.openQuestion({ projectId: p.id, text: "By?" }, { tenantId: T, role: "SEARCH" }); void q; assert.ok(rl4.events(OWNER).at(-1).by === "AGENT", "authored as AGENT, not OWNER");
  } finally { rm(d); r.stop?.(); }
});

// ---------- A13 ----------
const page = (body, head = "") => `<!doctype html><html lang="en"><head><title>t</title><meta name="viewport" content="width=device-width">${head}</head><body><main>${body}</main></body></html>`;
const OKCSS = "p{color:#000;background:#fff}", rules = r => r.findings.map(f => f.rule), inc = r => r.incomplete.join("|");
const A = (body, css = OKCSS, head = "", js = "") => auditAccessibility({ html: page(body, head), css, js });
test("A13 r10: focus removal on class selectors, shorthand variants, invisible outlines and zero shadows", () => {
  for (const c of [".btn{outline:none}", ".nav li{outline:0}", ".btn:focus{all:unset}", ".b{outline-width:0}", ".b{outline-style:none}", ".b{outline:medium none}", ".b{outline:1px hidden}", ".b{outline:0.0px}", ".b{outline:0pt}", ".b{outline:calc(0px)}", ".b:focus{outline:2px solid transparent}", ".b:focus{outline:none;box-shadow:0 0 0 0 red}", ".b:focus{outline:none;box-shadow:inherit}"])
    assert.ok(rules(A("<p>x</p>", OKCSS + c)).includes("FOCUS_REMOVED"), c);
  assert.match(inc(A("<p>x</p>", OKCSS + ".b:focus{outline:var(--x)}")), /COLOUR_RULES_NOT_EVALUATED/);
  for (const c of [".b:focus{outline:2px solid transparent;box-shadow:0 0 0 3px #00f}", "main{outline:none}", ".b:hover{outline:none}"]) assert.equal(rules(A("<p>x</p>", OKCSS + c)).includes("FOCUS_REMOVED"), false, c);
});
test("A13 r10: text colour is also checked against a literal body background; preload stylesheets, iframe srcdoc and JS-built markup are never a clean pass", () => {
  assert.ok(rules(A("<p class=c>x</p>", ":root{--bg:#fff;--ink:#000} body{color:#fff;background:#000} .c{color:#111}")).includes("CONTRAST"));
  assert.match(inc(A("<p>x</p>", OKCSS, '<link rel=preload as=style href=a.css onload="this.rel=\'stylesheet\'">')), /EXTERNAL_STYLESHEET_NOT_EVALUATED/);
  assert.match(inc(A("<p>x</p>", OKCSS, '<link rel=x href=a onload="this.rel=\'stylesheet\'">')), /EXTERNAL_STYLESHEET_NOT_EVALUATED/);
  assert.match(inc(A("<iframe srcdoc='<img src=a>'></iframe>")), /IFRAME_SRCDOC_NOT_EVALUATED/);
  for (const js of ["a.innerHTML='<img src=x>'", "document.createElement('link')", "a.style.outline='none'", "x.insertAdjacentHTML('beforeend','<b>')", "document.write('<img src=x>')"]) assert.match(inc(A("<p>x</p>", OKCSS, "", js)), /JS_BUILT_MARKUP_OR_STYLE_NOT_EVALUATED/, js);
  assert.ok(rules(A("<p>x</p>", OKCSS, "", "const b = h('button',{onclick:()=>{f()}}, '');")).includes("BUTTON_NAME"), "nested braces in the arguments");
});
test("A13 r10: markup: area alt, empty/dangling labels, wrapped label for another control, input type=button, empty links, several or hidden/svg main, user-scalable=false", () => {
  assert.ok(rules(A('<map name=m><area href=x></map>')).includes("IMG_ALT"));
  assert.ok(rules(A('<label for=a></label><input id=a>')).includes("INPUT_LABEL"));
  assert.ok(rules(A('<input aria-labelledby="nothere">')).includes("INPUT_LABEL")); assert.equal(rules(A('<span id=n>Name</span><input aria-labelledby="n">')).includes("INPUT_LABEL"), false);
  assert.ok(rules(A('<label for=z><input></label>')).includes("INPUT_LABEL"));
  assert.ok(rules(A('<input type=button>')).includes("BUTTON_NAME")); assert.equal(rules(A('<input type=button value=Go>')).includes("BUTTON_NAME"), false);
  assert.ok(rules(A('<a href=x></a>')).includes("LINK_NAME")); assert.ok(rules(A('<a href=x>&nbsp;</a>')).includes("LINK_NAME")); assert.equal(rules(A('<a href=x>Go</a>')).includes("LINK_NAME"), false); assert.equal(rules(A('<a href=x><img src=a alt=Go></a>')).includes("LINK_NAME"), false);
  const noMain = h => auditAccessibility({ html: `<!doctype html><html lang="en"><head><title>t</title><meta name=viewport content="width=device-width"></head><body>${h}</body></html>`, css: OKCSS });
  assert.ok(rules(noMain("<main hidden>x</main>")).includes("LANDMARK_MAIN")); assert.ok(rules(noMain("<svg><main>x</main></svg>")).includes("LANDMARK_MAIN"));
  assert.ok(rules(noMain("<main>a</main><main>b</main>")).includes("LANDMARK_MAIN"));
  assert.ok(rules(A("<p>x</p>", OKCSS, '<meta name=viewport content="user-scalable=false">')).includes("ZOOM_BLOCKED"));
});
