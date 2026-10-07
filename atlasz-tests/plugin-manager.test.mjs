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
    assert.equal(r.pm.enable("echo", { ownerApproval: ap("PLUGIN_ENABLE", "echo") }).ok, true);
    assert.equal(r.pm.list().plugins[0].status, "ENABLED");
  } finally { r.done(); }
});
test("hooks run in an isolated child process with no secrets; disabled plugins cannot run", async () => {
  const r = rig();
  try {
    r.mk("echo", { ...base, id: "echo", name: "Echo", kind: "PLUGIN", entry: "main.mjs" }, { "main.mjs": ok });
    assert.equal((await r.pm.invoke("echo", "h", {})).reason, "NOT_ENABLED");
    r.pm.enable("echo", { ownerApproval: ap("PLUGIN_ENABLE", "echo") });
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
    for (const id of ["crash", "hang", "junk"]) r.pm.enable(id, { ownerApproval: ap("PLUGIN_ENABLE", id) });
    assert.equal((await r.pm.invoke("crash", "x")).reason, "PLUGIN_CRASHED");
    assert.equal((await r.pm.invoke("hang", "x")).reason, "TIMEOUT");
    assert.equal((await r.pm.invoke("junk", "x")).reason, "INVALID_OUTPUT");
    assert.equal(r.pm.list().plugins.find(p => p.id === "crash").status, "DEGRADED");
    await r.pm.invoke("crash", "x");                                           // 2nd failure => quarantine (quarantineAfter: 2)
    assert.equal(r.pm.list().plugins.find(p => p.id === "crash").status, "QUARANTINED");
    assert.equal((await r.pm.invoke("crash", "x")).reason, "NOT_ENABLED");
    assert.match(r.pm.enable("crash", { ownerApproval: ap("PLUGIN_ENABLE", "crash") }).reason, /QUARANTINED/);
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
