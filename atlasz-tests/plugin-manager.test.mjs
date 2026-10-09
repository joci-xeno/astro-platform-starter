import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createPluginManager, validateManifest } from "../atlasz-addons/plugin-manager.mjs";
import { tmp, rm } from "./helpers.mjs";

const key = generateOwnerKeyPair();
const ap = (action, subject) => issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action, subject });
const base = { schema: 1, version: "1.0.0", permissions: ["READ_STATE"], atlaszCompat: ">=7.3.0" };
function rig() {
  const root = tmp("plg-"), plugins = path.join(root, "plugins"); fs.mkdirSync(plugins);
  const mk = (dir, manifest, files = {}) => { const d = path.join(plugins, dir); fs.mkdirSync(d); fs.writeFileSync(path.join(d, "plugin.json"), JSON.stringify(manifest)); for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(d, f), c); };
  const pm = createPluginManager({ roots: [plugins], stateDir: path.join(root, "state"), ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }), hookTimeoutMs: 1500, quarantineAfter: 2 });
  return { root, mk, pm, done: () => rm(root) };
}
const ok = "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const {hook,input}=JSON.parse(d);console.log(JSON.stringify({hook,echo:input,secretVisible:Boolean(process.env.ATLASZ_OWNER_PASSPHRASE||process.env.ATLASZ_VAULT_KEY)}));});";

test("manifest validation: forbidden/unknown permissions, incompatible version, code in themes, unsafe theme variables", () => {
  assert.ok(validateManifest({ ...base, id: "good-one", name: "G", kind: "PLUGIN", entry: "main.mjs" }).ok);
  assert.match(validateManifest({ ...base, id: "x1", name: "x", kind: "PLUGIN", entry: "m.mjs", permissions: ["SECRETS"] }).problems.join(), /FORBIDDEN_PERMISSION:SECRETS/);
  assert.match(validateManifest({ ...base, id: "x1", name: "x", kind: "PLUGIN", entry: "m.mjs", permissions: ["ROOT"] }).problems.join(), /UNKNOWN_PERMISSION/);
  assert.match(validateManifest({ ...base, id: "x1", name: "x", kind: "PLUGIN", entry: "m.mjs", atlaszCompat: ">=9.0.0" }).problems.join(), /INCOMPATIBLE/);
  assert.match(validateManifest({ ...base, id: "x1", name: "x", kind: "PLUGIN", entry: "../evil.mjs" }).problems.join(), /ENTRY_REQUIRED/);
  assert.match(validateManifest({ ...base, id: "t1", name: "t", kind: "THEME", permissions: ["UI_THEME"], entry: "x.mjs", variables: {} }).problems.join(), /THEMES_CANNOT_CONTAIN_CODE/);
  assert.match(validateManifest({ ...base, id: "t1", name: "t", kind: "THEME", permissions: ["UI_THEME"], variables: { "--bg": "url(http://evil/x)" } }).problems.join(), /UNSAFE_THEME_VARIABLE/);
  assert.ok(validateManifest({ ...base, id: "t1", name: "t", kind: "THEME", permissions: ["UI_THEME"], variables: { "--bg": "#101820", "--accent": "rgb(10, 200, 30)" } }).ok);
});
test("scan rejects bad packages without throwing; plugins start DISABLED; enabling code needs a signed owner approval", () => {
  const r = rig();
  try {
    r.mk("good", { ...base, id: "echo", name: "Echo", kind: "PLUGIN", entry: "main.mjs" }, { "main.mjs": ok });
    r.mk("bad", { ...base, id: "evil", name: "Evil", kind: "PLUGIN", entry: "main.mjs", permissions: ["SPEND"] }, { "main.mjs": ok });
    fs.mkdirSync(path.join(r.root, "plugins", "junk")); fs.writeFileSync(path.join(r.root, "plugins", "junk", "plugin.json"), "{nope");
    const l = r.pm.list(); assert.equal(l.plugins.length, 1); assert.equal(l.plugins[0].status, "DISABLED"); assert.equal(l.rejected.length, 2);
    assert.match(r.pm.enable("echo", {}).reason, /OWNER_APPROVAL_REQUIRED/); assert.match(r.pm.enable("echo", { ownerApproval: true }).reason, /OWNER_APPROVAL_REQUIRED/);
    assert.match(r.pm.enable("echo", { ownerApproval: ap("PLUGIN_ENABLE", "other-plugin") }).reason, /OWNER_APPROVAL_REQUIRED/);   // approval is bound to the exact plugin
    assert.equal(r.pm.enable("echo", { ownerApproval: ap("PLUGIN_ENABLE", r.pm.enableSubject("echo")) }).ok, true);
    assert.equal(r.pm.list().plugins[0].status, "ENABLED");
  } finally { r.done(); }
});
test("hooks run in an isolated child process with no secrets; disabled plugins cannot run", async () => {
  const r = rig();
  try {
    r.mk("echo", { ...base, id: "echo", name: "Echo", kind: "PLUGIN", entry: "main.mjs" }, { "main.mjs": ok });
    assert.equal((await r.pm.invoke("echo", "h", {})).reason, "NOT_ENABLED");
    r.pm.enable("echo", { ownerApproval: ap("PLUGIN_ENABLE", r.pm.enableSubject("echo")) });
    process.env.ATLASZ_OWNER_PASSPHRASE = "super-secret"; process.env.ATLASZ_VAULT_KEY = "k";
    try { const res = await r.pm.invoke("echo", "greet", { a: 1 }); assert.equal(res.ok, true); assert.deepEqual(res.result.echo, { a: 1 }); assert.equal(res.result.secretVisible, false); }
    finally { delete process.env.ATLASZ_OWNER_PASSPHRASE; delete process.env.ATLASZ_VAULT_KEY; }
  } finally { r.done(); }
});
test("a crashing / hanging / garbage plugin cannot take the core down; repeated failures quarantine it; reset needs the owner", async () => {
  const r = rig();
  try {
    r.mk("crash", { ...base, id: "crash", name: "C", kind: "PLUGIN", entry: "m.mjs" }, { "m.mjs": "process.exit(7);" });
    r.mk("hang", { ...base, id: "hang", name: "H", kind: "PLUGIN", entry: "m.mjs" }, { "m.mjs": "setInterval(()=>{},1000);" });
    r.mk("junk", { ...base, id: "junk", name: "J", kind: "PLUGIN", entry: "m.mjs" }, { "m.mjs": "console.log('not json');" });
    for (const id of ["crash", "hang", "junk"]) r.pm.enable(id, { ownerApproval: ap("PLUGIN_ENABLE", r.pm.enableSubject(id)) });
    assert.equal((await r.pm.invoke("crash", "x")).reason, "PLUGIN_CRASHED");
    assert.equal((await r.pm.invoke("hang", "x")).reason, "TIMEOUT");
    assert.equal((await r.pm.invoke("junk", "x")).reason, "INVALID_OUTPUT");
    assert.equal(r.pm.list().plugins.find(p => p.id === "crash").status, "DEGRADED");
    await r.pm.invoke("crash", "x");                                           // 2nd failure => quarantine (quarantineAfter: 2)
    assert.equal(r.pm.list().plugins.find(p => p.id === "crash").status, "QUARANTINED");
    assert.equal((await r.pm.invoke("crash", "x")).reason, "NOT_ENABLED");
    assert.match(r.pm.enable("crash", { ownerApproval: ap("PLUGIN_ENABLE", r.pm.enableSubject("crash")) }).reason, /QUARANTINED/);
    assert.match(r.pm.resetQuarantine("crash", {}).reason, /OWNER_APPROVAL_REQUIRED/);
    assert.equal(r.pm.resetQuarantine("crash", { ownerApproval: ap("PLUGIN_RESET_QUARANTINE", "crash") }).ok, true);
    assert.equal(r.pm.auditVerify().ok, true);
  } finally { r.done(); }
});
test("themes are data-only: no approval needed, variables whitelisted, can be set/cleared; cannot set a non-theme", () => {
  const r = rig();
  try {
    r.mk("dark", { ...base, id: "dark-teal", name: "Dark", kind: "THEME", permissions: ["UI_THEME"], variables: { "--bg": "#0b1f24", "--accent": "#19c3b1" } });
    r.mk("code", { ...base, id: "codey", name: "Co", kind: "PLUGIN", entry: "m.mjs" }, { "m.mjs": ok });
    assert.equal(r.pm.setTheme("dark-teal").ok, true); assert.equal(r.pm.activeTheme().variables["--bg"], "#0b1f24");
    assert.equal(r.pm.setTheme("codey").ok, false);
    r.pm.setTheme(null); assert.deepEqual(r.pm.activeTheme().variables, {});
  } finally { r.done(); }
});

// ---- Task 4 / M1.2 (ATLASZ-T3-002): least-privilege hooks ----
const probeHook = (outsideFile, ownDir) => `let d='';process.stdin.on('data',c=>d+=c).on('end',async()=>{const fs=await import('node:fs');const cp=await import('node:child_process');
const t=f=>{try{f();return 'ALLOWED'}catch{return 'DENIED'}};
console.log(JSON.stringify({readOutside:t(()=>fs.readFileSync(${JSON.stringify(outsideFile)})),writeOwn:t(()=>fs.writeFileSync(${JSON.stringify(path.join(ownDir, "o.txt"))},'x')),spawn:t(()=>cp.execSync('echo hi')),env:Object.keys(process.env).sort()}));});`;
test("hook runs with least privilege: cannot read outside its dir, cannot spawn, cannot write without FILESYSTEM_PLUGIN_DIR, env holds only PATH + plugin id/hook", async () => {
  const r = rig(); const outside = path.join(r.root, "plugins", "sibling-secret.txt"); fs.writeFileSync(outside, "SECRET");   // a SIBLING of the plugin dir, inside the plugins root
  try {
    const dir = path.join(r.root, "plugins", "probe");
    r.mk("probe", { ...base, id: "probe", name: "P", kind: "PLUGIN", entry: "m.mjs" }, { "m.mjs": probeHook(outside, dir) });
    assert.equal(r.pm.enable("probe", { ownerApproval: ap("PLUGIN_ENABLE", r.pm.enableSubject("probe")) }).ok, true);
    process.env.ATLASZ_VAULT_KEY = "vault-secret";
    try {
      const res = await r.pm.invoke("probe", "go"); assert.equal(res.ok, true, JSON.stringify(res));
      const { env: childEnv, ...rest } = res.result;
      assert.deepEqual(rest, { readOutside: "DENIED", writeOwn: "DENIED", spawn: "DENIED" });
      assert.deepEqual(childEnv.filter(k => k !== "PATH"), ["ATLASZ_PLUGIN_HOOK", "ATLASZ_PLUGIN_ID"]);
      assert.ok(!fs.existsSync(path.join(dir, "o.txt")));
    } finally { delete process.env.ATLASZ_VAULT_KEY; }
  } finally { r.done(); }
});
test("FILESYSTEM_PLUGIN_DIR grant (given at enable time) allows writing inside the plugin dir only", async () => {
  const r = rig(); const outside = path.join(r.root, "outside-secret.txt"); fs.writeFileSync(outside, "SECRET");
  try {
    const dir = path.join(r.root, "plugins", "wr");
    r.mk("wr", { ...base, id: "wr", name: "W", kind: "PLUGIN", entry: "m.mjs", permissions: ["READ_STATE", "FILESYSTEM_PLUGIN_DIR"] }, { "m.mjs": probeHook(outside, dir) });
    assert.equal(r.pm.enable("wr", { ownerApproval: ap("PLUGIN_ENABLE", r.pm.enableSubject("wr")) }).ok, true);
    const res = await r.pm.invoke("wr", "go"); assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.result.writeOwn, "ALLOWED"); assert.equal(res.result.readOutside, "DENIED"); assert.equal(res.result.spawn, "DENIED");
  } finally { r.done(); }
});
test("host that cannot restrict Node => hook is NOT run (fails closed): SANDBOX_UNAVAILABLE, audited as PLUGIN_HOOK_NOT_RUN, plugin not quarantined, marker never written", async () => {
  const r = rig(); const marker = path.join(r.root, "RAN.txt");
  const fakeNode = path.join(r.root, "fake-node.sh"); fs.writeFileSync(fakeNode, `#!/bin/sh\nif [ "$1" = "--permission" ]; then exit 9; fi\necho ran > ${JSON.stringify(marker)}\n`, { mode: 0o755 });
  try {
    const plugins = path.join(r.root, "plugins");
    const pm = createPluginManager({ roots: [plugins], stateDir: path.join(r.root, "state2"), ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }), nodeBin: fakeNode, hookTimeoutMs: 1500, quarantineAfter: 1 });
    r.mk("nr", { ...base, id: "nr", name: "N", kind: "PLUGIN", entry: "m.mjs" }, { "m.mjs": "console.log('{}')" });
    assert.equal(pm.enable("nr", { ownerApproval: ap("PLUGIN_ENABLE", pm.enableSubject("nr")) }).ok, true);
    for (let i = 0; i < 3; i++) assert.deepEqual(await pm.invoke("nr", "go"), { ok: false, reason: "SANDBOX_UNAVAILABLE" });
    assert.ok(!fs.existsSync(marker), "unrestricted fallback must never run");
    assert.equal(pm.list().plugins.find(p => p.id === "nr").status, "ENABLED");
    assert.ok(fs.readFileSync(path.join(r.root, "state2", "plugins-audit.jsonl"), "utf8").includes("PLUGIN_HOOK_NOT_RUN"));
  } finally { r.done(); }
});

import os from "node:os";
const netHook = `let d='';process.stdin.on('data',c=>d+=c).on('end',async()=>{const os=await import('node:os');console.log(JSON.stringify({ifaces:Object.entries(os.networkInterfaces()).flatMap(([k,v])=>v.map(x=>k)).filter(k=>k!=='lo').length}));});`;
const hostIfaces = Object.keys(os.networkInterfaces()).filter(k => k !== "lo").length;
test("network: a plugin without the NETWORK grant gets no network (namespace) where the host supports it; with the grant it is not isolated", async t => {
  const { detectNodeRestrictions } = await import("../atlasz-addons/restricted-node.mjs");
  if (!detectNodeRestrictions().namespace) return t.skip("no network namespace on this host (documented limit)");
  if (!hostIfaces) return t.skip("host has no non-loopback interface to compare against");
  const r = rig();
  try {
    r.mk("nonet", { ...base, id: "nonet", name: "N", kind: "PLUGIN", entry: "m.mjs" }, { "m.mjs": netHook });
    r.mk("withnet", { ...base, id: "withnet", name: "W", kind: "PLUGIN", entry: "m.mjs", permissions: ["READ_STATE", "NETWORK"] }, { "m.mjs": netHook });
    for (const id of ["nonet", "withnet"]) assert.equal(r.pm.enable(id, { ownerApproval: ap("PLUGIN_ENABLE", r.pm.enableSubject(id)) }).ok, true);
    assert.equal((await r.pm.invoke("nonet", "go")).result.ifaces, 0);
    assert.equal((await r.pm.invoke("withnet", "go")).result.ifaces, hostIfaces);
  } finally { r.done(); }
});
test("privilege escalation by editing the manifest AFTER enabling: granted permissions are the ones the owner approved, not the ones now on disk", async () => {
  const r = rig(); const outside = path.join(r.root, "plugins", "sibling-secret.txt"); fs.writeFileSync(outside, "SECRET");
  try {
    const dir = path.join(r.root, "plugins", "esc");
    r.mk("esc", { ...base, id: "esc", name: "E", kind: "PLUGIN", entry: "m.mjs" }, { "m.mjs": probeHook(outside, dir) });
    assert.equal(r.pm.enable("esc", { ownerApproval: ap("PLUGIN_ENABLE", r.pm.enableSubject("esc")) }).ok, true);
    fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify({ ...base, id: "esc", name: "E", kind: "PLUGIN", entry: "m.mjs", permissions: ["READ_STATE", "FILESYSTEM_PLUGIN_DIR", "NETWORK"] }));
    const res = await r.pm.invoke("esc", "go");
    assert.deepEqual([res.ok, res.reason], [false, "CODE_CHANGED_SINCE_ENABLE"], "any edit after the owner enabled the plugin (manifest included) stops it from running at all");
    assert.ok(!fs.existsSync(path.join(dir, "o.txt")));
  } finally { r.done(); }
});

test("prototype-chain plugin ids are refused as BAD_ID, so they can never read inherited state or write onto Object", () => {
  for (const id of ["constructor", "toString", "hasOwnProperty", "valueOf", "prototype"]) assert.match(validateManifest({ ...base, id, name: "x", kind: "PLUGIN", entry: "m.mjs" }).problems.join(), /BAD_ID/, id);
  const r = rig(); try {
    r.mk("ctor", { ...base, id: "constructor", name: "C", kind: "PLUGIN", entry: "main.mjs" }, { "main.mjs": ok });
    const l = r.pm.list(); assert.equal(l.plugins.length, 0); assert.match(JSON.stringify(l.rejected), /BAD_ID/);
    assert.equal(r.pm.enable("constructor").reason, "UNKNOWN_PLUGIN"); assert.equal(Object.hasOwn(Object, "failures"), false);
  } finally { r.done(); }
});

test("a state file that cannot be read is kept as found: every plugin stays disabled, nothing is written, mutations are refused with a clear reason", () => {
  const r = rig(); try {
    r.mk("p1", { ...base, id: "p-one", name: "P", kind: "PLUGIN", entry: "main.mjs" }, { "main.mjs": ok });
    const sf = path.join(r.root, "state", "plugins-state.json"); fs.mkdirSync(path.dirname(sf), { recursive: true });
    for (const bad of ["{CORRUPT", "null", "[]", '{"enabled":[]}', '{"health":5}']) {
      fs.writeFileSync(sf, bad);
      const pm = createPluginManager({ roots: [path.join(r.root, "plugins")], stateDir: path.join(r.root, "state"), ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }) });
      const l = pm.list(); assert.equal(l.plugins[0].status, "DISABLED", bad); assert.match(l.stateProblem, /STATE_UNREADABLE/, bad);
      assert.equal(pm.enable("p-one", { ownerApproval: ap("PLUGIN_ENABLE", pm.enableSubject("p-one")) }).reason, "STATE_UNREADABLE:plugins-state.json"); assert.equal(pm.setTheme(null).reason, "STATE_UNREADABLE:plugins-state.json"); assert.equal(pm.resetQuarantine("p-one", { ownerApproval: ap("PLUGIN_RESET_QUARANTINE", "p-one") }).reason, "STATE_UNREADABLE:plugins-state.json");
      assert.equal(fs.readFileSync(sf, "utf8"), bad, "the unreadable file is untouched");
    }
    fs.writeFileSync(sf, JSON.stringify({ enabled: {}, health: {}, theme: null }));
    const ok2 = createPluginManager({ roots: [path.join(r.root, "plugins")], stateDir: path.join(r.root, "state"), ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }) }); assert.equal(ok2.list().stateProblem, undefined); assert.equal(ok2.enable("p-one", { ownerApproval: ap("PLUGIN_ENABLE", ok2.enableSubject("p-one")) }).ok, true);
  } finally { r.done(); }
});

test("verification fix C05-2: only the exact bytes the owner enabled ever run; swapping the entry file, adding a file or losing the pinned hash stops the hook", async () => {
  const r = rig(); try {
    const dir = path.join(r.root, "plugins", "pin");
    r.mk("pin", { ...base, id: "pin", name: "P", kind: "PLUGIN", entry: "m.mjs" }, { "m.mjs": "console.log(JSON.stringify({v:1}));" });
    assert.equal(r.pm.enable("pin", { ownerApproval: ap("PLUGIN_ENABLE", r.pm.enableSubject("pin")) }).ok, true); assert.equal((await r.pm.invoke("pin", "go")).ok, true);
    fs.writeFileSync(path.join(dir, "m.mjs"), "console.log(JSON.stringify({v:'EVIL'}));"); assert.equal((await r.pm.invoke("pin", "go")).reason, "CODE_CHANGED_SINCE_ENABLE");
    fs.writeFileSync(path.join(dir, "m.mjs"), "console.log(JSON.stringify({v:1}));"); assert.equal((await r.pm.invoke("pin", "go")).ok, true, "restoring the exact bytes works again");
    fs.writeFileSync(path.join(dir, "extra.txt"), "x"); assert.equal((await r.pm.invoke("pin", "go")).reason, "CODE_CHANGED_SINCE_ENABLE", "an added file changes the pinned content too");
  } finally { r.done(); }
});
test("verification fix C05-2 (edges): a symlink, a legacy enabled entry without a pinned hash and an unhashable folder all stop the plugin", async () => {
  const r = rig(); try {
    const dir = path.join(r.root, "plugins", "pin2");
    r.mk("pin2", { ...base, id: "pin2", name: "P", kind: "PLUGIN", entry: "m.mjs" }, { "m.mjs": "console.log(JSON.stringify({v:1}));" });
    assert.equal(r.pm.enable("pin2", { ownerApproval: ap("PLUGIN_ENABLE", r.pm.enableSubject("pin2")) }).ok, true); assert.equal((await r.pm.invoke("pin2", "go")).ok, true);
    fs.symlinkSync("/etc", path.join(dir, "lnk")); assert.equal((await r.pm.invoke("pin2", "go")).reason, "CODE_CHANGED_SINCE_ENABLE", "an added symlink is a change"); fs.rmSync(path.join(dir, "lnk"));
    const sf = path.join(r.root, "state", "plugins-state.json"); const st = JSON.parse(fs.readFileSync(sf, "utf8")); delete st.enabled.pin2.hash; fs.writeFileSync(sf, JSON.stringify(st));
    const legacy = createPluginManager({ roots: [path.join(r.root, "plugins")], stateDir: path.join(r.root, "state"), ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }), hookTimeoutMs: 1500 });
    assert.equal((await legacy.invoke("pin2", "go")).reason, "CODE_CHANGED_SINCE_ENABLE", "no pinned hash => re-enable required");
    const big = path.join(r.root, "plugins", "big"); r.mk("big", { ...base, id: "big", name: "B", kind: "PLUGIN", entry: "m.mjs" }, { "m.mjs": "1" }); for (let i = 0; i < 510; i++) fs.writeFileSync(path.join(big, "f" + i), "x");
    assert.equal(r.pm.enable("big", { ownerApproval: ap("PLUGIN_ENABLE", r.pm.enableSubject("big")) }).reason, "PLUGIN_FOLDER_UNHASHABLE");
  } finally { r.done(); }
});

test("round-4 fixes: the enable approval is bound to the exact bytes (a stale or name-only approval is refused); a stop blocks enable and invoke; stderr secrets are redacted in state and audit", async () => {
  const r = rig(); let stop = false;
  const pm = createPluginManager({ roots: [path.join(r.root, "plugins")], stateDir: path.join(r.root, "state2"), ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }), hookTimeoutMs: 1500, quarantineAfter: 5, isStopped: () => stop });
  try {
    const dir = path.join(r.root, "plugins", "pin3"), K = "gh" + "p_" + "a".repeat(36);
    r.mk("pin3", { ...base, id: "pin3", name: "P", kind: "PLUGIN", entry: "m.mjs" }, { "m.mjs": "console.log(JSON.stringify({v:1}));" });
    const stale = ap("PLUGIN_ENABLE", pm.enableSubject("pin3")), nameOnly = ap("PLUGIN_ENABLE", "pin3");
    assert.match(pm.enable("pin3", { ownerApproval: nameOnly }).reason, /OWNER_APPROVAL_REQUIRED/, "an approval for the name alone is no longer enough");
    fs.writeFileSync(path.join(dir, "m.mjs"), "console.log(JSON.stringify({v:'SWAPPED'}));");
    assert.match(pm.enable("pin3", { ownerApproval: stale }).reason, /OWNER_APPROVAL_REQUIRED/, "bytes changed after the owner signed");
    assert.equal(pm.enable("pin3", { ownerApproval: ap("PLUGIN_ENABLE", pm.enableSubject("pin3")) }).ok, true);
    stop = true; assert.equal((await pm.invoke("pin3", "go")).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); pm.disable("pin3");
    assert.equal(pm.enable("pin3", { ownerApproval: ap("PLUGIN_ENABLE", pm.enableSubject("pin3")) }).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); stop = false;
    fs.writeFileSync(path.join(dir, "m.mjs"), "console.error('token=" + K + "');process.exit(3);");
    assert.equal(pm.enable("pin3", { ownerApproval: ap("PLUGIN_ENABLE", pm.enableSubject("pin3")) }).ok, true); assert.equal((await pm.invoke("pin3", "go")).reason, "PLUGIN_CRASHED");
    for (const f of fs.readdirSync(path.join(r.root, "state2"))) assert.ok(!fs.readFileSync(path.join(r.root, "state2", f), "utf8").includes(K), f);
    assert.ok(!JSON.stringify(pm.list()).includes(K));
  } finally { r.done(); }
});

test("round-4 fixes: manifest problems never echo a credential-shaped value and are length-bounded", () => {
  const K = "s" + "k-" + "a1b2c3d4e5f6g7h8i9j0k1l2";
  const v = validateManifest({ ...base, id: "x1", name: "x", kind: "PLUGIN", entry: "m.mjs", permissions: [K, "x".repeat(5000)] });
  assert.equal(v.ok, false); assert.ok(!v.problems.join().includes(K)); assert.ok(v.problems.every(p => p.length <= 200));
});
