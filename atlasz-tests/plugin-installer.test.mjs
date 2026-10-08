import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createPluginManager } from "../atlasz-addons/plugin-manager.mjs";
import { createPluginInstaller, INSTALL_LIMITS } from "../atlasz-addons/plugin-installer.mjs";
import { execFileSync } from "node:child_process";
import { tmp, rm } from "./helpers.mjs";

const key = generateOwnerKeyPair();
const ap = (action, subject) => issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action, subject });
const MAIN = "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const {hook}=JSON.parse(d);console.log(JSON.stringify({hook,v:process.env.V??null}));});";
function rig(o = {}) {
  const root = tmp("pin-"), plugins = path.join(root, "plugins"), state = path.join(root, "state"), inbox = path.join(root, "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  const auth = createOwnerAuth({ publicKeyB64: key.publicKeyB64 });
  const pm = createPluginManager({ roots: [plugins], stateDir: path.join(state, "pm"), ownerAuth: auth, hookTimeoutMs: 3000 });
  const ins = createPluginInstaller({ pluginRoot: plugins, stateDir: path.join(state, "inst"), ownerAuth: auth, pluginManager: pm, ...o });
  const pkg = (name, { version = "1.0.0", id = "demo-plugin", files = {}, manifest = {} } = {}) => {
    const d = path.join(inbox, name); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "plugin.json"), JSON.stringify({ schema: 1, id, name: "Demo", version, kind: "PLUGIN", entry: "main.mjs", permissions: ["READ_STATE"], atlaszCompat: ">=7.3.0", ...manifest }));
    fs.writeFileSync(path.join(d, "main.mjs"), MAIN);
    for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); }
    return d;
  };
  return { root, plugins, pm, ins, pkg, inbox, done: () => rm(root) };
}
const sub = p => p.subject;

test("install: needs the owner's signed approval for THIS exact package (id@version#hash); installs DISABLED; the approval is single-use", () => {
  const r = rig();
  try {
    const d = r.pkg("a"), p = r.ins.inspectPackage(d); assert.equal(p.ok, true); assert.match(p.subject, /^demo-plugin@1\.0\.0#[0-9a-f]{64}$/);
    for (const bad of [null, undefined, {}, "x", ap("PLUGIN_ENABLE", sub(p)), ap("PLUGIN_INSTALL", "demo-plugin@1.0.0#" + "0".repeat(64)), ap("PLUGIN_INSTALL", "other@1.0.0#" + p.hash)]) {
      const x = r.ins.install(d, { ownerApproval: bad }); assert.equal(x.ok, false); assert.match(x.reason, /^OWNER_APPROVAL_REQUIRED/);
    }
    assert.equal(fs.existsSync(path.join(r.plugins, "demo-plugin")), false, "nothing was installed by any refused attempt");
    const approval = ap("PLUGIN_INSTALL", sub(p)), x = r.ins.install(d, { ownerApproval: approval });
    assert.deepEqual([x.ok, x.version, x.enabled, x.previous], [true, "1.0.0", false, null]);
    assert.equal(r.pm.list().plugins.find(q => q.id === "demo-plugin").status, "DISABLED");
    assert.equal(r.ins.install(d, { ownerApproval: approval }).ok, false, "replayed approval / same version");
  } finally { r.done(); }
});
test("a changed byte changes the subject: an approval for the inspected package does not cover a modified one", () => {
  const r = rig();
  try {
    const d = r.pkg("a"), approval = ap("PLUGIN_INSTALL", sub(r.ins.inspectPackage(d)));
    fs.appendFileSync(path.join(d, "main.mjs"), "\n// tampered");
    assert.match(r.ins.install(d, { ownerApproval: approval }).reason, /^OWNER_APPROVAL_REQUIRED/);
    assert.equal(fs.existsSync(path.join(r.plugins, "demo-plugin")), false);
    const d2 = r.pkg("b", { files: { "x.txt": "1" } }), h1 = r.ins.inspectPackage(d2).hash; fs.renameSync(path.join(d2, "x.txt"), path.join(d2, "y.txt")); assert.notEqual(r.ins.inspectPackage(d2).hash, h1, "renaming a file changes the hash");
  } finally { r.done(); }
});
test("hostile packages are rejected before any approval is considered: symlinks, hidden files, traversal entry, forbidden permission, bad id, missing entry, too big, too many files", () => {
  const r = rig();
  try {
    const cases = {
      symlink: d => fs.symlinkSync("/etc/passwd", path.join(d, "link.txt")),
      symdir: d => fs.symlinkSync("/etc", path.join(d, "sub")),
      hidden: d => fs.writeFileSync(path.join(d, ".env"), "X=1"),
      hiddenDir: d => { fs.mkdirSync(path.join(d, ".git")); fs.writeFileSync(path.join(d, ".git", "c"), "1"); },
      big: d => fs.writeFileSync(path.join(d, "big.bin"), Buffer.alloc(INSTALL_LIMITS.maxFileBytes + 1)),
      many: d => { for (let i = 0; i <= INSTALL_LIMITS.maxFiles; i++) fs.writeFileSync(path.join(d, "f" + i), "1"); },
      deep: d => { let p = d; for (let i = 0; i < INSTALL_LIMITS.maxDepth + 2; i++) { p = path.join(p, "d"); fs.mkdirSync(p); } fs.writeFileSync(path.join(p, "x"), "1"); }
    };
    for (const [n, f] of Object.entries(cases)) { const d = r.pkg("h-" + n); f(d); const p = r.ins.inspectPackage(d); assert.equal(p.ok, false, n); assert.equal(r.ins.install(d, { ownerApproval: ap("PLUGIN_INSTALL", "demo-plugin@1.0.0#" + "0".repeat(64)) }).reason, "PACKAGE_REJECTED", n); }
    const man = (n, manifest) => r.ins.inspectPackage(r.pkg("m-" + n, { manifest }));
    assert.match(man("trav", { entry: "../evil.mjs" }).problems.join(), /ENTRY_REQUIRED/);
    assert.match(man("perm", { permissions: ["SECRETS"] }).problems.join(), /FORBIDDEN_PERMISSION/);
    assert.match(man("compat", { atlaszCompat: ">=99.0.0" }).problems.join(), /INCOMPATIBLE/);
    assert.match(r.ins.inspectPackage(r.pkg("m-id", { id: "../escape" })).problems.join(), /BAD_ID/);
    assert.deepEqual(man("noentry", { entry: "missing.mjs" }).problems, ["ENTRY_FILE_MISSING"]);
    assert.deepEqual(r.ins.inspectPackage(path.join(r.inbox, "nope")).problems, ["PACKAGE_NOT_FOUND"]);
    fs.writeFileSync(path.join(r.inbox, "afile"), "x"); assert.deepEqual(r.ins.inspectPackage(path.join(r.inbox, "afile")).problems, ["PACKAGE_MUST_BE_A_REAL_DIRECTORY"]);
    fs.symlinkSync(r.pkg("real"), path.join(r.inbox, "linkpkg")); assert.deepEqual(r.ins.inspectPackage(path.join(r.inbox, "linkpkg")).problems, ["PACKAGE_MUST_BE_A_REAL_DIRECTORY"]);
    for (const bad of [undefined, null, "", 5]) assert.equal(r.ins.inspectPackage(bad).ok, false);
    assert.equal(fs.readdirSync(r.plugins).length, 0);
  } finally { r.done(); }
});
test("upgrade keeps the old version, refuses same/older, and DISABLES an enabled plugin (new code needs a fresh PLUGIN_ENABLE); rollback restores with its own approval", async () => {
  const r = rig();
  try {
    const d1 = r.pkg("v1"), p1 = r.ins.inspectPackage(d1); assert.equal(r.ins.install(d1, { ownerApproval: ap("PLUGIN_INSTALL", sub(p1)) }).ok, true);
    assert.equal(r.pm.enable("demo-plugin", { ownerApproval: ap("PLUGIN_ENABLE", "demo-plugin") }).ok, true);
    assert.equal((await r.pm.invoke("demo-plugin", "ping")).ok, true, "installed plugin really runs through the restricted launcher");
    const d2 = r.pkg("v2", { version: "1.1.0", files: { "extra.txt": "new" } }), p2 = r.ins.inspectPackage(d2);
    const up = r.ins.install(d2, { ownerApproval: ap("PLUGIN_INSTALL", sub(p2)) }); assert.deepEqual([up.ok, up.previous, up.enabled], [true, "1.0.0", false]);
    assert.equal(r.pm.list().plugins.find(q => q.id === "demo-plugin").status, "DISABLED"); assert.equal((await r.pm.invoke("demo-plugin", "ping")).ok, false);
    assert.deepEqual(r.ins.versions("demo-plugin").kept.map(k => k.version), ["1.0.0"]);
    assert.equal(r.ins.install(d1, { ownerApproval: ap("PLUGIN_INSTALL", sub(p1)) }).reason, "NOT_A_NEWER_VERSION", "no silent downgrade via install");
    assert.equal(r.ins.install(d2, { ownerApproval: ap("PLUGIN_INSTALL", sub(p2)) }).reason, "NOT_A_NEWER_VERSION");
    // rollback
    assert.match(r.ins.rollback("demo-plugin", "1.0.0", { ownerApproval: ap("PLUGIN_INSTALL", sub(p1)) }).reason, /^OWNER_APPROVAL_REQUIRED/, "an install approval does not authorize a rollback");
    assert.equal(r.ins.rollback("demo-plugin", "9.9.9", { ownerApproval: null }).reason, "VERSION_NOT_KEPT");
    const rb = r.ins.rollback("demo-plugin", "1.0.0", { ownerApproval: ap("PLUGIN_ROLLBACK", sub(p1)) }); assert.deepEqual([rb.ok, rb.version, rb.enabled], [true, "1.0.0", false]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(r.plugins, "demo-plugin", "plugin.json"), "utf8")).version, "1.0.0"); assert.equal(fs.existsSync(path.join(r.plugins, "demo-plugin", "extra.txt")), false);
    assert.deepEqual(r.ins.versions("demo-plugin").kept.map(k => k.version), ["1.1.0"], "the replaced version is archived: rollback is reversible");
    assert.equal(r.ins.rollback("demo-plugin", "1.1.0", { ownerApproval: ap("PLUGIN_ROLLBACK", sub(p2)) }).ok, true);
    assert.equal(r.ins.rollback("../x", "1.0.0").reason, "BAD_ARGUMENTS"); assert.equal(r.ins.rollback("demo-plugin", "latest").reason, "BAD_ARGUMENTS");
  } finally { r.done(); }
});
test("a tampered kept copy is never rolled back to; only the newest kept versions are retained", () => {
  const r = rig();
  try {
    let last;
    for (let i = 0; i < INSTALL_LIMITS.maxKeptVersions + 3; i++) { const d = r.pkg("v" + i, { version: "1.0." + i }); last = r.ins.inspectPackage(d); assert.equal(r.ins.install(d, { ownerApproval: ap("PLUGIN_INSTALL", sub(last)) }).ok, true, "1.0." + i); }
    const kept = r.ins.versions("demo-plugin").kept; assert.equal(kept.length, INSTALL_LIMITS.maxKeptVersions); assert.equal(kept.at(-1).version, "1.0." + (INSTALL_LIMITS.maxKeptVersions + 1)); assert.ok(!kept.some(k => k.version === "1.0.0"));
    const target = kept.at(-1), dir = path.join(r.root, "state", "inst", "plugin-versions", "demo-plugin", fs.readdirSync(path.join(r.root, "state", "inst", "plugin-versions", "demo-plugin")).find(n => n.startsWith(target.version + "__")));
    fs.appendFileSync(path.join(dir, "main.mjs"), "\n//evil");
    assert.equal(r.ins.rollback("demo-plugin", target.version, { ownerApproval: ap("PLUGIN_ROLLBACK", "demo-plugin@" + target.version + "#" + "0".repeat(64)) }).reason, "KEPT_COPY_TAMPERED");
  } finally { r.done(); }
});
test("kill switch / Safe Mode stops install, rollback and uninstall (a throwing stop check fails closed); uninstall needs approval and keeps history", () => {
  let stop = false; const r = rig({ isStopped: () => { if (stop === "throw") throw new Error("x"); return stop; } });
  try {
    const d = r.pkg("a"), p = r.ins.inspectPackage(d), approval = ap("PLUGIN_INSTALL", sub(p));
    stop = true; assert.equal(r.ins.install(d, { ownerApproval: approval }).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); stop = "throw"; assert.equal(r.ins.install(d, { ownerApproval: approval }).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    stop = false; assert.equal(r.ins.install(d, { ownerApproval: approval }).ok, true, "the approval was not consumed while stopped");
    stop = true; assert.equal(r.ins.rollback("demo-plugin", "1.0.0").reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); assert.equal(r.ins.uninstall("demo-plugin", { ownerApproval: ap("PLUGIN_UNINSTALL", "demo-plugin") }).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    stop = false; assert.equal(r.ins.uninstall("demo-plugin", {}).reason.startsWith("OWNER_APPROVAL_REQUIRED"), true); assert.equal(r.ins.uninstall("nope", {}).reason, "NOT_INSTALLED"); assert.equal(r.ins.uninstall("../x", {}).reason, "BAD_ID");
    assert.equal(r.ins.uninstall("demo-plugin", { ownerApproval: ap("PLUGIN_UNINSTALL", "demo-plugin") }).ok, true); assert.equal(fs.existsSync(path.join(r.plugins, "demo-plugin")), false);
    assert.deepEqual(r.ins.versions("demo-plugin").kept.map(k => k.version), ["1.0.0"]);
  } finally { r.done(); }
});
test("every attempt (refused or not) is in a hash-chained audit log; the installer's constructor needs its dependencies", () => {
  const r = rig();
  try {
    const d = r.pkg("a"), p = r.ins.inspectPackage(d), good = ap("PLUGIN_INSTALL", sub(p)); r.ins.install(d, {}); r.ins.install(d, { ownerApproval: good });
    const a = r.ins.audit(); assert.deepEqual(a.map(e => e.type ?? e.kind ?? e.event), ["PLUGIN_INSTALL_REFUSED", "PLUGIN_INSTALLED"]); assert.equal(r.ins.auditVerify().ok, true);
    assert.ok(!JSON.stringify(a).includes(good.signature) && !JSON.stringify(a).includes(good.nonce), "no approval material in the audit log");
  } finally { r.done(); }
  assert.throws(() => createPluginInstaller({}), /REQUIRED/); assert.throws(() => createPluginInstaller({ pluginRoot: "/x", stateDir: "/y" }), /REQUIRED/);
});

test("exact refusal codes: symlink, FIFO, and a package over the total size cap (files each under the per-file cap)", () => {
  const r = rig();
  try {
    const d = r.pkg("s"); fs.symlinkSync("/etc/passwd", path.join(d, "l")); assert.deepEqual(r.ins.inspectPackage(d).problems, ["SYMLINK_REFUSED:l"]);
    const f = r.pkg("f"); execFileSync("mkfifo", [path.join(f, "pipe")]); assert.deepEqual(r.ins.inspectPackage(f).problems, ["SPECIAL_FILE_REFUSED:pipe"]);
    const b = r.pkg("b"); for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(b, "chunk" + i), Buffer.alloc(INSTALL_LIMITS.maxFileBytes)); assert.deepEqual(r.ins.inspectPackage(b).problems, ["PACKAGE_TOO_LARGE"]);
    const ok = r.pkg("ok"); for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(ok, "chunk" + i), Buffer.alloc(INSTALL_LIMITS.maxFileBytes)); assert.equal(r.ins.inspectPackage(ok).ok, true, "4 MB is within the cap");
  } finally { r.done(); }
});
test("a faulty copy is caught by re-hashing the COPY: nothing is installed and the previous version stays", () => {
  const r = rig();
  const real = fs.writeFileSync;
  try {
    const d1 = r.pkg("v1"), p1 = r.ins.inspectPackage(d1); assert.equal(r.ins.install(d1, { ownerApproval: ap("PLUGIN_INSTALL", sub(p1)) }).ok, true);
    const d2 = r.pkg("v2", { version: "1.2.0" }), p2 = r.ins.inspectPackage(d2);
    fs.writeFileSync = (f, data, ...rest) => real(f, String(f).includes("plugin-staging") && String(f).endsWith("main.mjs") ? Buffer.from("corrupted") : data, ...rest);
    const x = r.ins.install(d2, { ownerApproval: ap("PLUGIN_INSTALL", sub(p2)) });
    fs.writeFileSync = real;
    assert.equal(x.reason, "COPY_VERIFICATION_FAILED"); assert.equal(JSON.parse(fs.readFileSync(path.join(r.plugins, "demo-plugin", "plugin.json"), "utf8")).version, "1.0.0");
    assert.deepEqual(fs.readdirSync(path.join(r.root, "state", "inst", "plugin-staging")), [], "staging cleaned up");
  } finally { fs.writeFileSync = real; r.done(); }
});
test("rollback refuses a kept copy whose manifest disagrees with its folder name, and a copy identical to the installed one; install/rollback/uninstall all disable the plugin in the manager", () => {
  const calls = [], stub = { disable: id => calls.push(id) }, r = rig({ pluginManager: stub });
  try {
    const d1 = r.pkg("v1"), p1 = r.ins.inspectPackage(d1); r.ins.install(d1, { ownerApproval: ap("PLUGIN_INSTALL", sub(p1)) });
    const keptDir = path.join(r.root, "state", "inst", "plugin-versions", "demo-plugin"); fs.mkdirSync(keptDir, { recursive: true });
    // (a) folder says 1.0.5 but the manifest says 1.0.0 (hash prefix matches the content, so only the manifest check can catch it)
    const lie = path.join(keptDir, "1.0.5__" + p1.hash.slice(0, 12)); fs.cpSync(path.join(r.plugins, "demo-plugin"), lie, { recursive: true });
    assert.equal(r.ins.rollback("demo-plugin", "1.0.5", { ownerApproval: ap("PLUGIN_ROLLBACK", "demo-plugin@1.0.5#" + p1.hash) }).reason, "KEPT_COPY_INVALID");
    // (b) same content as installed
    const same = path.join(keptDir, "1.0.0__" + p1.hash.slice(0, 12)); fs.cpSync(path.join(r.plugins, "demo-plugin"), same, { recursive: true });
    assert.equal(r.ins.rollback("demo-plugin", "1.0.0", { ownerApproval: ap("PLUGIN_ROLLBACK", sub(p1)) }).reason, "ALREADY_INSTALLED");
    assert.deepEqual(calls, ["demo-plugin"], "only the install so far");
    // a real rollback and an uninstall each disable
    const d2 = r.pkg("v2", { version: "1.1.0" }), p2 = r.ins.inspectPackage(d2); r.ins.install(d2, { ownerApproval: ap("PLUGIN_INSTALL", sub(p2)) });
    assert.equal(r.ins.rollback("demo-plugin", "1.0.0", { ownerApproval: ap("PLUGIN_ROLLBACK", sub(p1)) }).ok, true);
    assert.equal(r.ins.uninstall("demo-plugin", { ownerApproval: ap("PLUGIN_UNINSTALL", "demo-plugin") }).ok, true);
    assert.deepEqual(calls, ["demo-plugin", "demo-plugin", "demo-plugin", "demo-plugin"]);
  } finally { r.done(); }
});

test("a kept copy that was edited AND renamed to its new hash is refused: the audit chain remembers the real hash", async () => {
  const { createHash } = await import("node:crypto");
  const r = rig();
  try {
    const d1 = r.pkg("a1", { version: "1.0.0" }), p1 = r.ins.inspectPackage(d1); assert.equal(r.ins.install(d1, { ownerApproval: ap("PLUGIN_INSTALL", sub(p1)) }).ok, true);
    const d2 = r.pkg("a2", { version: "1.1.0" }), p2 = r.ins.inspectPackage(d2); assert.equal(r.ins.install(d2, { ownerApproval: ap("PLUGIN_INSTALL", sub(p2)) }).ok, true);
    const keptRoot = path.join(r.root, "state", "inst", "plugin-versions", "demo-plugin"), name = fs.readdirSync(keptRoot).find(n => n.startsWith("1.0.0__")), dir = path.join(keptRoot, name);
    assert.ok(r.ins.audit().some(e => e.event === "PLUGIN_ARCHIVED" && e.data.version === "1.0.0" && e.data.hash.startsWith(name.split("__")[1])), "the archived copy is recorded with its full hash");
    fs.appendFileSync(path.join(dir, "main.mjs"), "\n//evil");
    const sig = r.ins.rollbackSubject("demo-plugin", "1.0.0"); const newHash = sig.split("#")[1];
    fs.renameSync(dir, path.join(keptRoot, "1.0.0__" + newHash.slice(0, 12)));                          // the attacker makes the directory name agree with the edited content
    const res = r.ins.rollback("demo-plugin", "1.0.0", { ownerApproval: ap("PLUGIN_ROLLBACK", r.ins.rollbackSubject("demo-plugin", "1.0.0")) });
    assert.equal(res.reason, "KEPT_COPY_NOT_IN_AUDIT_CHAIN"); assert.equal(r.ins.versions("demo-plugin").installed.version, "1.1.0", "the tampered copy was not installed");
  } finally { r.done(); }
});
