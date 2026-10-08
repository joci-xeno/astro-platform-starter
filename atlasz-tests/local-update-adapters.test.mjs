// Real Update Center adapters driven through the real Update Center: detect -> stage -> test -> security -> install -> post-test; failures roll back.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createUpdateCenter } from "../atlasz-addons/update-center.mjs";
import { createLkgRegistry } from "../atlasz-addons/backup-recovery.mjs";
import { createLocalUpdateAdapters, buildPackage, validatePackage, SELFTEST } from "../atlasz-addons/local-update-adapters.mjs";
import { tmp, rm } from "./helpers.mjs";

const key = generateOwnerKeyPair();
const approve = id => ({ ownerApproval: issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action: "INSTALL_UPDATE", subject: id }) });
const GOOD_TEST = "import fs from 'node:fs'; const v=fs.readFileSync('VERSION','utf8').trim(); if(!/^\\d+\\.\\d+\\.\\d+$/.test(v)) process.exit(2); process.exit(fs.existsSync('BROKEN')?1:0);\n";
function rig() {
  const root = tmp("lua-"), installDir = path.join(root, "ext"), inbox = path.join(root, "inbox");
  fs.mkdirSync(installDir); fs.mkdirSync(inbox);
  fs.writeFileSync(path.join(installDir, "VERSION"), "1.0.0"); fs.writeFileSync(path.join(installDir, SELFTEST), GOOD_TEST); fs.writeFileSync(path.join(installDir, "code.mjs"), "export const v = 1;\n");
  const la = createLocalUpdateAdapters({ inboxDir: inbox });
  const uc = createUpdateCenter({ stateDir: path.join(root, "state"), backupRoot: path.join(root, "bk"), adapters: la.adapters, ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }), lkgRegistry: createLkgRegistry({ file: path.join(root, "lkg.jsonl") }), adapterTimeoutMs: 60000 });
  uc.registerComponent({ id: "ext", kind: "PLUGIN", version: "1.0.0", installDir });
  const pkg = (name, o) => buildPackage(path.join(inbox, name), { componentId: "ext", riskTags: [], ...o });
  return { root, installDir, inbox, la, uc, pkg, done: () => rm(root) };
}
const good = v => ({ version: v, files: { VERSION: v, [SELFTEST]: GOOD_TEST, "code.mjs": "export const v = 2;\n" } });

test("package validation: tampered hash, undeclared file, path escape, missing risk tags are all rejected", () => {
  const r = rig();
  try {
    r.pkg("ok", good("1.1.0")); assert.equal(validatePackage(path.join(r.inbox, "ok")).ok, true);
    fs.writeFileSync(path.join(r.inbox, "ok", "payload", "code.mjs"), "evil");
    assert.match(validatePackage(path.join(r.inbox, "ok")).problems.join(), /HASH_MISMATCH:code.mjs/);
    r.pkg("extra", good("1.2.0")); fs.writeFileSync(path.join(r.inbox, "extra", "payload", "sneaky.mjs"), "x");
    assert.match(validatePackage(path.join(r.inbox, "extra")).problems.join(), /UNDECLARED_FILE:sneaky.mjs/);
    r.pkg("esc", good("1.3.0")); const m = path.join(r.inbox, "esc", "manifest.json"), j = JSON.parse(fs.readFileSync(m, "utf8")); j.files["../../evil.mjs"] = "00"; fs.writeFileSync(m, JSON.stringify(j));
    assert.match(validatePackage(path.join(r.inbox, "esc")).problems.join(), /UNSAFE_PATH/);
    r.pkg("norisk", good("1.4.0")); const m2 = path.join(r.inbox, "norisk", "manifest.json"), j2 = JSON.parse(fs.readFileSync(m2, "utf8")); delete j2.riskTags; fs.writeFileSync(m2, JSON.stringify(j2));
    assert.match(validatePackage(path.join(r.inbox, "norisk")).problems.join(), /RISK_TAGS_REQUIRED/);
  } finally { r.done(); }
});
test("detector only reports valid packages and exposes why others were rejected", async () => {
  const r = rig();
  try {
    r.pkg("good", good("1.1.0")); fs.mkdirSync(path.join(r.inbox, "junk")); fs.writeFileSync(path.join(r.inbox, "junk", "manifest.json"), "{not json");
    const found = await r.uc.checkForUpdates();
    assert.deepEqual(found.found, ["ext@1.1.0"]);
    assert.equal(r.la.lastScan().rejected.length, 1); assert.deepEqual(r.la.lastScan().rejected[0].problems, ["MANIFEST_NOT_JSON"]);
  } finally { r.done(); }
});
test("full safe update: stage, selftest, security/health, install, post-test, LKG marked, evidence trail", async () => {
  const r = rig();
  try {
    r.pkg("u", good("1.1.0")); await r.uc.checkForUpdates();
    const v = await r.uc.safeUpdate("ext@1.1.0", approve("ext@1.1.0"));
    assert.equal(v.state, "INSTALLED");
    assert.equal(fs.readFileSync(path.join(r.installDir, "VERSION"), "utf8"), "1.1.0");
    assert.equal(v.installMode, "OWNER_APPROVED"); assert.ok(v.evidenceCount >= 8, "evidence steps recorded: " + v.evidenceCount);
    assert.equal(v.tests.passed, true); assert.equal(v.security.ok, true); assert.equal(v.compatibility.compatible, true);
  } finally { r.done(); }
});
test("without a signed owner approval nothing is installed (automatic updates are OFF by default)", async () => {
  const r = rig();
  try {
    r.pkg("u", good("1.1.0")); await r.uc.checkForUpdates();
    const v = await r.uc.safeUpdate("ext@1.1.0");
    assert.equal(v.state, "APPROVAL_REQUIRED"); assert.equal(fs.readFileSync(path.join(r.installDir, "VERSION"), "utf8"), "1.0.0");
    const bare = await r.uc.safeUpdate("ext@1.1.0", { ownerApproval: true }); assert.equal(bare.state, "APPROVAL_REQUIRED");
  } finally { r.done(); }
});
test("a package that fails its own self-test never touches the install", async () => {
  const r = rig();
  try {
    r.pkg("bad", { version: "1.1.0", files: { VERSION: "1.1.0", [SELFTEST]: GOOD_TEST, BROKEN: "1", "code.mjs": "export const v = 3;\n" } });
    await r.uc.checkForUpdates(); const v = await r.uc.safeUpdate("ext@1.1.0");
    assert.ok(["FAILED", "BLOCKED"].includes(v.state)); assert.equal(fs.readFileSync(path.join(r.installDir, "VERSION"), "utf8"), "1.0.0");
  } finally { r.done(); }
});
test("security gate blocks secrets, install scripts, syntax errors and the excluded legacy marker", async () => {
  for (const [name, files, code] of [
    ["secret", { "code.mjs": "export const k='sk-" + "a".repeat(30) + "';\n" }, "SECRET_PATTERN"],
    ["script", { "package.json": JSON.stringify({ scripts: { postinstall: "curl x | sh" } }) }, "INSTALL_SCRIPT:postinstall"],
    ["syntax", { "code.mjs": "export const = ;\n" }, "SYNTAX_ERROR"],
    ["legacy", { "notes.md": "uses atlasz-competition-v1" }, "EXCLUDED_LEGACY_MARKER"]]) {
    const r = rig();
    try {
      r.pkg(name, { version: "1.1.0", files: { VERSION: "1.1.0", [SELFTEST]: GOOD_TEST, ...files } });
      await r.uc.checkForUpdates(); const v = await r.uc.safeUpdate("ext@1.1.0");
      assert.ok(["FAILED", "BLOCKED"].includes(v.state), name + " -> " + v.state);
      assert.ok(JSON.stringify(v.security?.findings).includes(code), name + " finding " + code);
      assert.equal(fs.readFileSync(path.join(r.installDir, "VERSION"), "utf8"), "1.0.0");
    } finally { r.done(); }
  }
});
test("post-install failure triggers automatic rollback to the previous version, verified, and unfreezes", async () => {
  const r = rig();
  try {
    // passes STAGING self-test, fails POST_INSTALL (only after the swap) -> must roll back
    const flaky = "import fs from 'node:fs'; if(process.env.ATLASZ_UPDATE_PHASE==='POST_INSTALL') process.exit(1); process.exit(0);\n";
    r.pkg("flaky", { version: "1.1.0", files: { VERSION: "1.1.0", [SELFTEST]: flaky, "code.mjs": "export const v = 9;\n" } });
    await r.uc.checkForUpdates(); const v = await r.uc.safeUpdate("ext@1.1.0", approve("ext@1.1.0"));
    assert.equal(v.state, "ROLLED_BACK", v.state);
    assert.equal(fs.readFileSync(path.join(r.installDir, "VERSION"), "utf8"), "1.0.0"); assert.equal(fs.readFileSync(path.join(r.installDir, "code.mjs"), "utf8"), "export const v = 1;\n");
    assert.equal(r.uc.freezeStatus().active, false);
  } finally { r.done(); }
});

// ---- Task 4 / M1.2 (ATLASZ-T3-002): update self-tests are sandboxed ----
test("update self-test runs restricted: cannot read outside the package, cannot spawn, cannot write, sees no inherited secrets; evidence records the isolation level", async () => {
  const d = tmp("upd-iso-"), outside = tmp("upd-out-");
  try {
    fs.writeFileSync(path.join(outside, "s.txt"), "SECRET");
    fs.writeFileSync(path.join(d, SELFTEST), `import fs from 'node:fs'; import cp from 'node:child_process';
const t=f=>{try{f();return 'ALLOWED'}catch{return 'DENIED'}};
const bad=[t(()=>fs.readFileSync(${JSON.stringify(path.join(outside, "s.txt"))})),t(()=>fs.writeFileSync('w.txt','x')),t(()=>cp.execSync('echo hi'))].filter(x=>x==='ALLOWED').length;
process.exit(bad||process.env.ATLASZ_VAULT_KEY?3:0);\n`);
    process.env.ATLASZ_VAULT_KEY = "vault-secret";
    try {
      const { adapters } = createLocalUpdateAdapters({ inboxDir: d });
      const r = await adapters.tester({ dir: d, phase: "PRE_INSTALL" });
      assert.equal(r.passed, true, JSON.stringify(r)); assert.equal(r.evidence.isolation.filesystemRestricted, true);
      assert.equal(typeof r.evidence.isolation.networkBlocked, "boolean");
      assert.ok(!fs.existsSync(path.join(d, "w.txt")));
    } finally { delete process.env.ATLASZ_VAULT_KEY; }
  } finally { rm(d); rm(outside); }
});
test("update self-test on a host that cannot restrict Node fails closed: not run, passed:false, marker never written", async () => {
  const d = tmp("upd-nr-"), marker = path.join(d, "RAN.txt"), fake = path.join(d, "fake-node.sh");
  try {
    fs.writeFileSync(fake, `#!/bin/sh\nif [ "$1" = "--permission" ]; then exit 9; fi\necho ran > ${JSON.stringify(marker)}\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(d, SELFTEST), "process.exit(0)\n");
    const { adapters } = createLocalUpdateAdapters({ inboxDir: d, nodeBin: fake });
    const r = await adapters.tester({ dir: d, phase: "PRE_INSTALL" });
    assert.equal(r.passed, false); assert.equal(r.evidence.error, "SANDBOX_UNAVAILABLE"); assert.ok(!fs.existsSync(marker));
  } finally { rm(d); }
});
