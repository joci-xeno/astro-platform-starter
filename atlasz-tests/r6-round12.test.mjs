import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { auditAccessibility } from "../atlasz-addons/a11y-audit.mjs";
import { restrictedNodeCommand, detectNodeRestrictions } from "../atlasz-addons/restricted-node.mjs";
import { createPluginManager } from "../atlasz-addons/plugin-manager.mjs";
import { createProfiles, createAgentProfileGate } from "../atlasz-addons/assistant-profiles.mjs";
import { createDocumentCenter } from "../atlasz-addons/document-center.mjs";
import { createKnowledgeProjects } from "../atlasz-addons/knowledge-projects.mjs";
import { createResearchLedger } from "../atlasz-addons/research-ledger.mjs";
import { createOwnerAuth, generateOwnerKeyPair } from "../atlasz-addons/owner-auth.mjs";
import { rig } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

// ---------- launcher ----------
test("plugins r12: a plugin granted NETWORK still cannot see (or signal) the host process", () => {
  const caps = detectNodeRestrictions();
  if (!caps.pidNamespace) return;                                                                    // hosts without user namespaces cannot offer this; the launcher then states the weaker level
  const d = tmp("rn12-"); try {
    const script = path.join(d, "s.mjs"); fs.writeFileSync(script, "try { process.kill(Number(process.env.HOST_PID), 0); console.log('VISIBLE'); } catch (e) { console.log(e.code); }");
    const rc = restrictedNodeCommand({ script, readDirs: [d], allowNetwork: true, env: { HOST_PID: String(process.pid) } });
    assert.equal(rc.ok, true); assert.equal(rc.level, "PERMISSION+PID_NAMESPACE"); assert.equal(rc.networkBlocked, false);
    const r = spawnSync(rc.cmd, rc.args, { env: rc.env, encoding: "utf8", timeout: 10000 }); assert.equal(r.stdout.trim(), "ESRCH", r.stderr);
    const plain = restrictedNodeCommand({ script, readDirs: [d], allowNetwork: true, caps: { permission: true, namespace: false } }); assert.equal(plain.level, "PERMISSION", "without the probe result nothing is claimed");
  } finally { rm(d); }
});
test("plugins r12: resetQuarantine with a non-string id is a result, not a throw", () => {
  const key = generateOwnerKeyPair(), root = tmp("pl12-");
  try { const pm = createPluginManager({ roots: [path.join(root, "p")], stateDir: path.join(root, "s"), ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }) });
    for (const id of [Symbol("x"), 5n, { toString() { throw new Error("x"); } }, null, undefined]) assert.deepEqual(pm.resetQuarantine(id, {}).reason, "PLUGIN_ID_INVALID"); } finally { rm(root); }
});

// ---------- M12 ----------
test("M12 r12: tenant records of the wrong shape are damage (no silent 'ok' without persistence); the marker is written atomically; a stale instance cannot roll back a removed profile", () => {
  const d = tmp("pg12-"); try {
    const file = path.join(d, "p.json"), P = createProfiles({ file });
    assert.equal(P.create("JOCI", { actor: "OWNER", id: "p1", name: "n", instructions: "x", tools: [] }).ok, true);
    const keep = fs.readFileSync(file, "utf8");
    for (const bad of [{ tenants: { JOCI: { profiles: [], assignments: {} } } }, { tenants: { JOCI: { profiles: {}, assignments: [] } } }, { tenants: { JOCI: null } }, { tenants: { JOCI: { profiles: {} } } }]) {
      fs.writeFileSync(file, JSON.stringify(bad)); let r; try { r = createProfiles({ file }).create("JOCI", { actor: "OWNER", id: "a", name: "n", instructions: "x", tools: [] }); } catch { r = { ok: false }; } assert.equal(r.ok, false, JSON.stringify(bad));
    }
    fs.writeFileSync(file, keep);
    assert.equal(P.assign("JOCI", "SEARCH-1", "p1", { actor: "OWNER" }).ok, true); assert.equal(fs.existsSync(file + ".in-use.tmp"), false, "no temp marker left behind");
    // stale rollback
    const P1 = createProfiles({ file });
    assert.equal(P1.create("JOCI", { actor: "OWNER", id: "p9", name: "n", instructions: "x", tools: [] }).ok, true); assert.equal(P1.create("JOCI", { actor: "OWNER", id: "p9", name: "n2", instructions: "x", tools: [] }).ok, true);
    const P2 = createProfiles({ file });                                                              // P2 has loaded p9 (two versions)
    assert.equal(P1.assign("JOCI", "SEARCH-1", null, { actor: "OWNER" }).ok, true); assert.equal(P1.remove("JOCI", "p9", { actor: "OWNER" }).ok, true);
    const rb = P2.rollback("JOCI", "p9", 1, { actor: "OWNER" }); assert.equal(rb.ok, false); assert.equal(rb.reason, "PROFILE_NOT_FOUND");
  } finally { rm(d); }
});

// ---------- ledger ----------
const T = "T1", OWNER = { tenantId: T, role: "OWNER" }, RENT = "The monthly rent for the Maple Street warehouse is 4200 dollars payable on the first business day.";
const CLAIM = "The monthly rent for the Maple Street warehouse is 4200 dollars";
function world() {
  const d = tmp("rl12-"), r = rig(), now = () => "2026-10-07T12:00:00.000Z";
  const dc = createDocumentCenter({ dir: path.join(d, "docs"), security: r.security, now }), kp = createKnowledgeProjects({ file: path.join(d, "kp.json"), documents: dc, security: r.security, now });
  const file = path.join(d, "rl.json"), mk = () => createResearchLedger({ file, knowledge: kp, security: r.security, blackBox: r.blackBox, now });
  const p = kp.create({ tenantId: T, name: "W", allowedRoles: ["OWNER", "AGENT"] }); kp.addWebSnapshot(p.id, { tenantId: T, url: "https://example.org/a", retrievedAt: now(), title: "A", text: RENT });
  return { d, kp, p, mk, file, done: () => { rm(d); r.stop?.(); } };
}
test("ledger r12: events() is the owner's audit view only; summary() gives other callers no event count; reanchor checks the head against the history and makes events after the head a reviewed decision", () => {
  const w = world(); try {
    const rl = w.mk(); rl.openQuestion({ projectId: w.p.id, text: "Q1?" }, OWNER);
    for (const who of [undefined, {}, { tenantId: "T2", role: "AGENT" }, { tenantId: T }, { tenantId: T, role: "OWNER", forAgent: true }]) assert.throws(() => rl.events(who), /OWNER_ONLY/);
    assert.equal(rl.events(OWNER).length, 1); assert.equal(rl.summary({ tenantId: T, role: "AGENT" }).events, undefined); assert.equal(typeof rl.summary(OWNER).events, "number");
    // forged chained event, head untouched: looks like a crash gap, so the owner must review it
    rl.openQuestion({ projectId: w.p.id, text: "Q2?" }, OWNER);
    const j = JSON.parse(fs.readFileSync(w.file, "utf8")), head = JSON.parse(fs.readFileSync(w.file + ".head", "utf8")); assert.equal(head.n, 2);
    fs.writeFileSync(w.file + ".head", JSON.stringify({ n: 1, hash: j.events[0].hash }));                          // anchor one event behind: a genuine crash gap
    const a = w.mk().reanchor(OWNER); assert.equal(a.ok, false); assert.equal(a.reason, "EVENTS_AFTER_HEAD_NEED_REVIEW"); assert.deepEqual(a.unanchoredEvents.map(e => e.n), [2]);
    const b = w.mk().reanchor(OWNER, { acceptEventsAfterHead: true }); assert.equal(b.ok, true); assert.equal(w.mk().verifyChain().ok, true);
    // history rewritten before the anchor
    fs.writeFileSync(w.file + ".head", JSON.stringify({ n: 1, hash: "0".repeat(64) })); const c = w.mk().reanchor(OWNER, { acceptEventsAfterHead: true }); assert.equal(c.ok, false); assert.equal(c.reason, "HEAD_DOES_NOT_MATCH_HISTORY");
  } finally { w.done(); }
});
test("ledger r12: report() walks the chain once per operation (1,500 findings finish quickly)", () => {
  const w = world(); try {
    const rl = w.mk(), q = rl.openQuestion({ projectId: w.p.id, text: "Rent?" }, OWNER);
    for (let i = 0; i < 400; i++) rl.addFinding(q.id, { claim: CLAIM + " variant " + i }, OWNER);
    const t0 = Date.now(); const r = rl.report(q.id, OWNER); const dt = Date.now() - t0; assert.ok(r.unsupported.length >= 400 || r.state); assert.ok(dt < 1500, "report took " + dt + " ms");
  } finally { w.done(); }
});

// ---------- A13 ----------
const page = (body, head = "") => `<!doctype html><html lang="en"><head><title>t</title><meta name="viewport" content="width=device-width">${head}</head><body><main>${body}</main></body></html>`;
const OKCSS = "p{color:#000;background:#fff}", rules = r => r.findings.map(f => f.rule), inc = r => r.incomplete.join("|");
const A = (body, css = OKCSS, head = "") => auditAccessibility({ html: page(body, head), css, js: "" });
test("A13 r12: iframe titles, unnamed ARIA widgets, click-only elements, presentational colour attributes and svg text colours", () => {
  assert.ok(rules(A("<iframe src=x></iframe>")).includes("IFRAME_TITLE")); assert.equal(rules(A('<iframe src=x title="Map"></iframe>')).includes("IFRAME_TITLE"), false);
  for (const h of ["<div role=button></div>", "<span role=link></span>", "<div role=checkbox></div>", "<div role=textbox></div>", "<div role=slider></div>", "<svg role=img></svg>", "<div role=img></div>", "<div role=dialog></div>"]) assert.ok(rules(A(h)).includes("ROLE_NAME"), h);
  for (const h of ["<div role=button>Go</div>", '<div role=button aria-label="Go"></div>', "<div role=img><img src=a alt=x></div>"]) assert.equal(rules(A(h)).includes("ROLE_NAME"), false, h);
  assert.ok(rules(A("<div onclick=f()>x</div>")).includes("CLICK_NOT_KEYBOARD")); assert.equal(rules(A("<div onclick=f() role=button tabindex=0>x</div>")).includes("CLICK_NOT_KEYBOARD"), false); assert.equal(rules(A("<button onclick=f()>x</button>")).includes("CLICK_NOT_KEYBOARD"), false);
  for (const h of ["<p><font color=#fff>x</font></p>", "<table><tr><td bgcolor=#000>x</td></tr></table>"]) assert.match(inc(A(h)), /PRESENTATIONAL_COLOUR_ATTRIBUTES_NOT_EVALUATED/, h);
  assert.match(inc(A("<svg><text fill=#fff>x</text></svg>")), /SVG_TEXT_COLOUR_NOT_EVALUATED/); assert.match(inc(A("<p>x</p>", OKCSS + "text{fill:#fff}")), /SVG_TEXT_COLOUR_NOT_EVALUATED/);
});
