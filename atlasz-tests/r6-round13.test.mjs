import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { restrictedNodeCommand, detectNodeRestrictions } from "../atlasz-addons/restricted-node.mjs";
import { createPluginManager } from "../atlasz-addons/plugin-manager.mjs";
import { createProfiles, createAgentProfileGate } from "../atlasz-addons/assistant-profiles.mjs";
import { createDocumentCenter } from "../atlasz-addons/document-center.mjs";
import { createKnowledgeProjects } from "../atlasz-addons/knowledge-projects.mjs";
import { createResearchLedger } from "../atlasz-addons/research-ledger.mjs";
import { createOwnerAuth, generateOwnerKeyPair, issueOwnerApproval } from "../atlasz-addons/owner-auth.mjs";
import { rig } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

// ---------- launcher: no signalling of the host's process group ----------
function runPlugin(rc) { return new Promise(res => { const c = spawn(rc.cmd, rc.args, { env: rc.env, stdio: ["ignore", "pipe", "pipe"] }); let o = "", e = ""; c.stdout.on("data", d => o += d); c.stderr.on("data", d => e += d); c.on("close", k => res({ k, o, e })); }); }
for (const allowNetwork of [false, true]) test(`plugins r13: a hook (allowNetwork=${allowNetwork}) cannot signal the host's process group with kill(0) / kill(-1)`, async () => {
  const caps = detectNodeRestrictions(); if (!(allowNetwork ? caps.pidNamespace : caps.namespace)) return;      // no namespace support on this host: the launcher then claims nothing stronger
  const d = tmp("rn13-"); try {
    const script = path.join(d, "s.mjs"); fs.writeFileSync(script, "for (const p of [0, -1]) { try { process.kill(p, 'SIGUSR2'); } catch {} } console.log('done');");
    // the "host" is a separate process in its OWN process group, so a leaking mutant can never take the test runner down with it
    const mod = new URL("../atlasz-addons/restricted-node.mjs", import.meta.url).href;
    const hostCode = `import { spawn } from "node:child_process"; import { restrictedNodeCommand } from ${JSON.stringify(mod)}; let hits = 0; process.on("SIGUSR2", () => { hits++; });
      const rc = restrictedNodeCommand({ script: process.argv[1], readDirs: [process.argv[2]], allowNetwork: process.argv[3] === "1" }); const c = spawn(rc.cmd, rc.args, { env: rc.env, stdio: ["ignore", "pipe", "pipe"] }); let o = "";
      c.stdout.on("data", x => o += x); c.on("close", () => setTimeout(() => { console.log(JSON.stringify({ hits, out: o.trim() })); process.exit(0); }, 300));`;
    const r = await new Promise(res => { const h = spawn(process.execPath, ["--input-type=module", "-e", hostCode, script, d, allowNetwork ? "1" : "0"], { detached: true, stdio: ["ignore", "pipe", "pipe"] }); let o = ""; h.stdout.on("data", x => o += x); h.on("close", k => res({ k, o })); });
    const j = JSON.parse(r.o.trim() || "{}"); assert.equal(j.out, "done"); assert.equal(j.hits, 0, "the host received no signal from the plugin");
  } finally { rm(d); }
});
test("launcher r13: a script path that starts with '-' is refused (it would be read as a node option)", () => {
  assert.equal(restrictedNodeCommand({ script: "--allow-fs-write=/", readDirs: [] }).reason, "SCRIPT_INVALID"); assert.equal(restrictedNodeCommand({ script: "-e" }).reason, "SCRIPT_INVALID"); assert.equal(restrictedNodeCommand({ script: 5 }).reason, "SCRIPT_INVALID");
});

// ---------- plugins ----------
const key = generateOwnerKeyPair(), ap = (a, s) => issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action: a, subject: s });
test("plugins r13: resetQuarantine only accepts the id of a plugin that exists (no health record for '__proto__', 'constructor', '../x', or an unknown id)", () => {
  const root = tmp("pl13-"); try {
    const pm = createPluginManager({ roots: [path.join(root, "p")], stateDir: path.join(root, "s"), ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }) });
    for (const id of ["__proto__", "constructor", "../../x", "", "nonexistent", "a b"]) { const r = pm.resetQuarantine(id, { ownerApproval: ap("PLUGIN_RESET_QUARANTINE", id) }); assert.equal(r.ok, false, id); assert.match(r.reason, /PLUGIN_ID_INVALID|UNKNOWN_PLUGIN/, id); }
    assert.equal(fs.existsSync(path.join(root, "s", "plugins-state.json")), false, "nothing was written");
  } finally { rm(root); }
});

// ---------- M12 ----------
test("M12 r13: a marker that cannot be written is reported (never ok:true); a planted tmp symlink is not followed", () => {
  const d = tmp("pg13-"); try {
    const file = path.join(d, "p.json"), P = createProfiles({ file });
    assert.equal(P.create("JOCI", { actor: "OWNER", id: "p1", name: "n", instructions: "x", tools: [] }).ok, true);
    // 1) the marker cannot be written (disk full): reported, and the gate stays closed
    const realOpen = fs.openSync; fs.openSync = (f, ...r) => { if (String(f).endsWith(".in-use.tmp")) { const e = new Error("ENOSPC"); e.code = "ENOSPC"; throw e; } return realOpen(f, ...r); };
    try { const a = P.assign("JOCI", "SEARCH-1", "p1", { actor: "OWNER" }); assert.equal(a.ok, false); assert.equal(a.reason, "PROFILE_MARKER_NOT_WRITTEN"); const u = P.create("JOCI", { actor: "OWNER", id: "p3", name: "m", instructions: "y", tools: [] }); assert.equal(u.ok, false); } finally { fs.openSync = realOpen; }
    assert.equal(createAgentProfileGate({ file, tenantId: "JOCI" })("SEARCH-1", "sandbox.x").allowed, false, "fail closed meanwhile");
    assert.equal(P.reconcileMarker({ actor: "OWNER" }).ok, true);
    // 2) a pre-planted symlink at the tmp name
    const victim = path.join(d, "victim.txt"); fs.writeFileSync(victim, "KEEP"); fs.symlinkSync(victim, file + ".in-use.tmp");
    assert.equal(P.assign("JOCI", "SEARCH-2", "p1", { actor: "OWNER" }).ok, true); assert.equal(fs.readFileSync(victim, "utf8"), "KEEP", "the symlink target was not written through");
    assert.equal(fs.lstatSync(file + ".in-use").isFile(), true);
  } finally { rm(d); }
});

// ---------- ledger ----------
const T = "T1", OWNER = { tenantId: T, role: "OWNER" }, RENT = "The monthly rent for the Maple Street warehouse is 4200 dollars payable on the first business day.";
test("ledger r13: deleting the store file under a running ledger is noticed (no stale 'ok' from memory, no resurrection of old data)", () => {
  const d = tmp("rl13-"), r = rig(), now = () => "2026-10-07T12:00:00.000Z";
  try {
    const dc = createDocumentCenter({ dir: path.join(d, "docs"), security: r.security, now }), kp = createKnowledgeProjects({ file: path.join(d, "kp.json"), documents: dc, security: r.security, now });
    const file = path.join(d, "rl.json"), rl = createResearchLedger({ file, knowledge: kp, security: r.security, blackBox: r.blackBox, now });
    const p = kp.create({ tenantId: T, name: "W", allowedRoles: ["OWNER", "AGENT"] }); kp.addWebSnapshot(p.id, { tenantId: T, url: "https://example.org/a", retrievedAt: now(), title: "A", text: RENT });
    rl.openQuestion({ projectId: p.id, text: "Q1?" }, OWNER); assert.equal(rl.verifyChain().ok, true);
    fs.rmSync(file); const s = rl.summary(OWNER); assert.equal(s.chain.ok, false, "the running instance agrees with a fresh one"); assert.equal(s.questions, 0);
    assert.throws(() => rl.openQuestion({ projectId: p.id, text: "Q2?" }, OWNER), /CHAIN_BROKEN/); assert.equal(fs.existsSync(file), false, "the old data was not written back");
  } finally { rm(d); r.stop?.(); }
});
