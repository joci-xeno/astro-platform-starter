import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createPluginManager } from "../atlasz-addons/plugin-manager.mjs";
import { createOwnerAuth, generateOwnerKeyPair, issueOwnerApproval } from "../atlasz-addons/owner-auth.mjs";
import { tmp, rm } from "./helpers.mjs";

const key = generateOwnerKeyPair(), ap = (action, subject) => issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action, subject });
const base = { schema: 1, version: "1.0.0", permissions: ["READ_STATE"], atlaszCompat: ">=7.3.0" };
const ok = "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const {hook,input}=JSON.parse(d);console.log(JSON.stringify({hook,echo:input}));});";
function rig() {
  const root = tmp("plc-"), plugins = path.join(root, "plugins"); fs.mkdirSync(plugins);
  const d = path.join(plugins, "echo"); fs.mkdirSync(d); fs.writeFileSync(path.join(d, "plugin.json"), JSON.stringify({ ...base, id: "echo", name: "Echo", kind: "PLUGIN", entry: "main.mjs" })); fs.writeFileSync(path.join(d, "main.mjs"), ok);
  const pm = createPluginManager({ roots: [plugins], stateDir: path.join(root, "state"), ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }), hookTimeoutMs: 1500, quarantineAfter: 2 });
  return { root, pm, state: path.join(root, "state"), enable: p => p.enable("echo", { ownerApproval: ap("PLUGIN_ENABLE", p.enableSubject("echo")) }), done: () => rm(root) };
}

test("R6: an unwritable state file rolls the enable back (no plugin enabled in memory only) and hooks never run for it", async () => {
  const r = rig(); try {
    fs.mkdirSync(path.join(r.state, "plugins-state.json.tmp"), { recursive: true });                 // the atomic-write target cannot be created
    const e = r.enable(r.pm); assert.equal(e.ok, false); assert.match(e.reason, /STATE_NOT_WRITTEN|AUDIT/);
    assert.equal(r.pm.list().plugins[0].status, "DISABLED"); assert.equal((await r.pm.invoke("echo", "h", {})).ok, false);
  } finally { r.done(); }
});

test("R6: invoke never rejects: circular input, corrupt audit log and a failing scan are results, and a hook only runs when its start was audited", async () => {
  const r = rig(); try {
    assert.equal(r.enable(r.pm).ok, true);
    const circ = {}; circ.self = circ; const c = await r.pm.invoke("echo", "h", circ); assert.equal(c.ok, false); assert.equal(c.reason, "INPUT_NOT_SERIALISABLE");
    const good = await r.pm.invoke("echo", "h", { a: 1 }); assert.equal(good.ok, true);
    assert.ok(fs.readFileSync(path.join(r.state, "plugins-audit.jsonl"), "utf8").includes("PLUGIN_HOOK_STARTED"));
    fs.appendFileSync(path.join(r.state, "plugins-audit.jsonl"), "garbage\nmore garbage\n");
    const bad = await r.pm.invoke("echo", "h", {}); assert.equal(bad.ok, false); assert.equal(bad.reason, "AUDIT_UNAVAILABLE");
  } finally { r.done(); }
});

test("R6: a readable but unwritable audit log means the hook does not run (start must be audited)", async () => {
  const r = rig(); try {
    assert.equal(r.enable(r.pm).ok, true);
    const real = fs.openSync; fs.openSync = (f, ...a) => { if (String(f).endsWith("plugins-audit.jsonl") && a[0] === "a") { const e = new Error("EACCES"); e.code = "EACCES"; throw e; } return real(f, ...a); };
    try { const res = await r.pm.invoke("echo", "h", { a: 1 }); assert.equal(res.ok, false); assert.equal(res.reason, "AUDIT_UNAVAILABLE"); } finally { fs.openSync = real; }
    assert.equal((await r.pm.invoke("echo", "h", { a: 1 })).ok, true, "works again once the log is writable");
  } finally { r.done(); }
});

test("R6 round 6: two managers on one state dir share enabled state; a quarantine whose state write failed stays quarantined; a failed change leaves a compensating audit record; a bad root is a result, not a throw", async () => {
  const r = rig(); try {
    const pm2 = createPluginManager({ roots: [path.join(r.root, "plugins")], stateDir: r.state, ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }), hookTimeoutMs: 1500, quarantineAfter: 1 });
    assert.equal(r.enable(r.pm).ok, true); assert.equal(pm2.list().plugins[0].status, "ENABLED", "B sees A's enable");
    assert.equal(r.pm.disable("echo").ok, true); assert.equal((await pm2.invoke("echo", "h", {})).ok, false, "B does not run a plugin A disabled");
    assert.equal(pm2.list().plugins[0].status, "DISABLED");
    // a failing hook + unwritable state => quarantine still holds in memory and across re-reads
    assert.equal(r.enable(pm2).ok, true);
    fs.writeFileSync(path.join(r.root, "plugins", "echo", "main.mjs"), "process.exit(3)");   // code changed -> must not run at all
    assert.equal((await pm2.invoke("echo", "h", {})).reason, "CODE_CHANGED_SINCE_ENABLE");
    fs.writeFileSync(path.join(r.root, "plugins", "echo", "main.mjs"), ok); assert.equal((await pm2.invoke("echo", "h", {})).ok, true);
    // failed enable leaves a compensating record
    const r2 = rig(); try { fs.mkdirSync(path.join(r2.state, "plugins-state.json.tmp"), { recursive: true }); assert.equal(r2.enable(r2.pm).ok, false); const log = fs.readFileSync(path.join(r2.state, "plugins-audit.jsonl"), "utf8"); assert.ok(log.includes("PLUGIN_CHANGE_NOT_APPLIED"), log); } finally { r2.done(); }
    const bad = createPluginManager({ roots: ["/etc/hostname"], stateDir: path.join(r.root, "s3"), ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }) });
    assert.doesNotThrow(() => bad.list()); assert.ok(bad.list().rejected.some(x => x.problems.includes("ROOT_UNREADABLE")));
  } finally { r.done(); }
});

test("R6 round 6: quarantine survives an unwritable state file (re-read keeps it quarantined)", async () => {
  const r = rig(); try {
    const dir = path.join(r.root, "plugins", "echo"); fs.writeFileSync(path.join(dir, "main.mjs"), "process.exit(3)");
    const pm = createPluginManager({ roots: [path.join(r.root, "plugins")], stateDir: r.state, ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }), hookTimeoutMs: 1500, quarantineAfter: 1 });
    assert.equal(pm.enable("echo", { ownerApproval: ap("PLUGIN_ENABLE", pm.enableSubject("echo")) }).ok, true);
    fs.mkdirSync(path.join(r.state, "plugins-state.json.tmp"), { recursive: true });
    assert.equal((await pm.invoke("echo", "h", {})).reason, "PLUGIN_CRASHED");
    assert.equal(pm.list().plugins[0].status, "QUARANTINED", "still quarantined although the state file could not be written");
    assert.equal((await pm.invoke("echo", "h", {})).ok, false);
  } finally { r.done(); }
});

test("R6 round 7: a finishing hook never overwrites another manager's change; an unauthenticated reset cannot undo an in-memory quarantine; an unreadable state mid-run disables everything; malformed health entries cannot crash callbacks", async () => {
  const r = rig(); try {
    const slow = path.join(r.root, "plugins", "slow"); fs.mkdirSync(slow);
    fs.writeFileSync(path.join(slow, "plugin.json"), JSON.stringify({ ...base, id: "slow", name: "Slow", kind: "PLUGIN", entry: "main.mjs" })); fs.writeFileSync(path.join(slow, "main.mjs"), "setTimeout(()=>console.log('{}'),400);process.stdin.resume();");
    const mkpm = () => createPluginManager({ roots: [path.join(r.root, "plugins")], stateDir: r.state, ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }), hookTimeoutMs: 3000, quarantineAfter: 1 }), A = mkpm(), B = mkpm();
    assert.equal(r.enable(A).ok, true); assert.equal(A.enable("slow", { ownerApproval: ap("PLUGIN_ENABLE", A.enableSubject("slow")) }).ok, true);
    const run = A.invoke("slow", "h", {}); await new Promise(res => setTimeout(res, 100));
    assert.equal(B.disable("echo").ok, true); const res = await run; assert.equal(res.ok, true);
    assert.equal(mkpm().list().plugins.find(x => x.id === "echo").status, "DISABLED", "the finishing hook did not resurrect the plugin B disabled");
    // unreadable state mid-run
    const sf = path.join(r.state, "plugins-state.json"); fs.rmSync(sf); fs.mkdirSync(sf);
    assert.equal((await A.invoke("slow", "h", {})).ok, false); assert.equal(A.disable("slow").ok, false); assert.ok(A.list().plugins.every(x => x.status === "DISABLED"));
    fs.rmSync(sf, { recursive: true });
    // malformed health entry
    fs.writeFileSync(sf, JSON.stringify({ enabled: {}, health: { echo: 5 }, theme: null })); assert.doesNotThrow(() => mkpm().list());
  } finally { r.done(); }
});

test("R6 round 7: an unapproved resetQuarantine leaves an in-memory-only quarantine in place", async () => {
  const r = rig(); try {
    fs.writeFileSync(path.join(r.root, "plugins", "echo", "main.mjs"), "process.exit(3)");
    const pm = createPluginManager({ roots: [path.join(r.root, "plugins")], stateDir: r.state, ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }), hookTimeoutMs: 1500, quarantineAfter: 1 });
    assert.equal(pm.enable("echo", { ownerApproval: ap("PLUGIN_ENABLE", pm.enableSubject("echo")) }).ok, true);
    fs.mkdirSync(path.join(r.state, "plugins-state.json.tmp"), { recursive: true });
    await pm.invoke("echo", "h", {}); assert.equal(pm.list().plugins[0].status, "QUARANTINED");
    assert.match(pm.resetQuarantine("echo", {}).reason, /OWNER_APPROVAL_REQUIRED/); assert.equal(pm.list().plugins[0].status, "QUARANTINED");
    const rs = pm.resetQuarantine("echo", { ownerApproval: ap("PLUGIN_RESET_QUARANTINE", "echo") }); assert.equal(rs.ok, false, "a reset whose state write fails does not lift the quarantine"); assert.equal(pm.list().plugins[0].status, "QUARANTINED");
    assert.equal((await pm.invoke("echo", "h", {})).ok, false);
  } finally { r.done(); }
});
