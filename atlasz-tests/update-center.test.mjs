import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createUpdateCenter, compareVersions, satisfies, updateKind, UPDATE_STATES } from "../atlasz-addons/update-center.mjs";
import { createLkgRegistry } from "../atlasz-addons/backup-recovery.mjs";
import { tmp, rm } from "./helpers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const key = generateOwnerKeyPair();
const sign = (action, subject) => issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action, subject });
const snap = dir => Object.fromEntries(fs.readdirSync(dir).sort().map(f => [f, fs.readFileSync(path.join(dir, f), "utf8")]));

// rig: one MODULE component "mod-a" v1.0.0 in a temp install dir; behaviour is steered by the update's `notes`.
function rig({ detect, adapters = {}, lkg = false, adapterTimeoutMs = 5000, extra = [] } = {}) {
  const root = tmp(), installDir = path.join(root, "mod-a"), stateDir = path.join(root, "state"), backupRoot = path.join(root, "backups");
  fs.mkdirSync(installDir); fs.writeFileSync(path.join(installDir, "VERSION"), "1.0.0"); fs.writeFileSync(path.join(installDir, "code.txt"), "original code");
  const ownerAuth = createOwnerAuth({ publicKeyB64: key.publicKeyB64 });
  const calls = [];
  const base = {
    detector: async () => detect ?? [{ componentId: "mod-a", version: "1.1.0", riskTags: [] }],
    stager: async ({ update, stagingDir }) => { fs.writeFileSync(path.join(stagingDir, "VERSION"), update.version); fs.writeFileSync(path.join(stagingDir, "code.txt"), "new code " + update.version);
      if (update.notes === "poison") fs.writeFileSync(path.join(stagingDir, "BROKEN"), "1"); return { ok: true, evidence: "staged" }; },
    tester: async ({ dir, phase }) => { calls.push(phase); const bad = fs.existsSync(path.join(dir, "BROKEN")) && phase !== "STAGING"; return { passed: !bad, evidence: phase + (bad ? " FAIL" : " ok") }; },
    securityHealth: async () => ({ ok: true, findings: [] })
  };
  const lkgRegistry = lkg ? createLkgRegistry({ file: path.join(root, "lkg.jsonl") }) : null;
  const make = (over = {}) => createUpdateCenter({ stateDir, backupRoot, ownerAuth, lkgRegistry, adapterTimeoutMs, adapters: { ...base, ...adapters, ...over } });
  const uc = make();
  uc.registerComponent({ id: "mod-a", kind: "MODULE", version: "1.0.0", installDir });
  for (const c of extra) uc.registerComponent(c);
  return { root, installDir, stateDir, backupRoot, uc, make, calls, lkgRegistry, done: () => rm(root) };
}

test("semver helpers", () => {
  assert.equal(compareVersions("1.2.3", "1.10.0"), -1); assert.equal(compareVersions("2.0.0", "2.0.0-rc.1"), 1);
  assert.ok(satisfies("1.4.2", "^1.2.0")); assert.ok(!satisfies("2.0.0", "^1.2.0")); assert.ok(satisfies("1.2.9", "~1.2.0")); assert.ok(!satisfies("1.3.0", "~1.2.0"));
  assert.ok(satisfies("3.0.0", ">=2.0.0 <4.0.0")); assert.ok(!satisfies("4.0.0", ">=2.0.0 <4.0.0")); assert.ok(satisfies("0.2.5", "^0.2.1")); assert.ok(!satisfies("0.3.0", "^0.2.1"));
  assert.equal(updateKind("1.0.0", "2.0.0"), "MAJOR"); assert.equal(updateKind("1.0.0", "1.1.0"), "MINOR"); assert.equal(updateKind("1.0.0", "1.0.1"), "PATCH");
  assert.throws(() => compareVersions("x", "1.0.0"), /INVALID_VERSION/);
  assert.equal(UPDATE_STATES.length, 10);
});

test("fails closed: no detector / no tester / no stager never produce a pass", async () => {
  const r = rig({ adapters: { detector: undefined } }); try {
    assert.equal((await r.uc.checkForUpdates()).reason, "DETECTOR_NOT_CONFIGURED");
  } finally { r.done(); }
  const r2 = rig({ adapters: { tester: undefined } }); try {
    await r2.uc.checkForUpdates(); const v = await r2.uc.testUpdate("mod-a@1.1.0");
    assert.equal(v.state, "BLOCKED"); assert.equal(v.tests.error, "TESTER_NOT_CONFIGURED");
  } finally { r2.done(); }
  const r3 = rig({ adapters: { stager: undefined } }); try {
    await r3.uc.checkForUpdates(); assert.equal((await r3.uc.testUpdate("mod-a@1.1.0")).state, "FAILED");
  } finally { r3.done(); }
  const r4 = rig({ adapters: { securityHealth: undefined } }); try {
    await r4.uc.checkForUpdates(); assert.equal((await r4.uc.testUpdate("mod-a@1.1.0")).state, "BLOCKED");
  } finally { r4.done(); }
});

test("detect: only newer versions of known components, no duplicates", async () => {
  const r = rig({ detect: [{ componentId: "mod-a", version: "1.1.0", riskTags: [] }, { componentId: "mod-a", version: "0.9.0" }, { componentId: "ghost", version: "9.9.9" }, { componentId: "mod-a", version: "bad" }] }); try {
    assert.deepEqual((await r.uc.checkForUpdates()).found, ["mod-a@1.1.0"]);
    assert.deepEqual((await r.uc.checkForUpdates()).found, []);
    assert.equal(r.uc.get("mod-a@1.1.0").state, "UPDATE_AVAILABLE");
  } finally { r.done(); }
});

test("incompatible update (node too old / unmet requirement) is BLOCKED before anything is staged", async () => {
  const r = rig({ detect: [{ componentId: "mod-a", version: "1.1.0", riskTags: [], minNode: "99.0.0" }, { componentId: "mod-a", version: "1.2.0", riskTags: [], requires: { "mod-b": "^2.0.0" } }] }); try {
    await r.uc.checkForUpdates();
    const a = await r.uc.testUpdate("mod-a@1.1.0"), b = await r.uc.testUpdate("mod-a@1.2.0");
    assert.equal(a.state, "BLOCKED"); assert.match(a.compatibility.problems[0], /NODE_TOO_OLD/);
    assert.equal(b.state, "BLOCKED"); assert.match(b.compatibility.problems[0], /REQUIRED_COMPONENT_MISSING:mod-b/);
    assert.equal(r.calls.length, 0, "tester must not run"); assert.equal(snap(r.installDir)["VERSION"], "1.0.0");
  } finally { r.done(); }
});

test("full safe update with signed owner approval: backup, staging, tests, install, post-test, LKG, evidence", async () => {
  const r = rig({ lkg: true }); try {
    await r.uc.checkForUpdates();
    const t = await r.uc.testUpdate("mod-a@1.1.0");
    assert.equal(t.state, "APPROVAL_REQUIRED"); assert.equal(t.tests.passed, true); assert.equal(snap(r.installDir)["VERSION"], "1.0.0", "testing never touches the live install");
    const v = await r.uc.safeUpdate("mod-a@1.1.0", { ownerApproval: sign("INSTALL_UPDATE", "mod-a@1.1.0") });
    assert.equal(v.state, "INSTALLED"); assert.equal(v.installMode, "OWNER_APPROVED");
    assert.deepEqual(snap(r.installDir), { "VERSION": "1.1.0", "code.txt": "new code 1.1.0" });
    assert.equal(r.uc.componentVersion("mod-a"), "1.1.0"); assert.deepEqual(r.calls, ["STAGING", "POST_INSTALL"]);
    const steps = r.uc.get("mod-a@1.1.0").evidence.map(e => e.step);
    for (const s of ["COMPATIBILITY", "STAGE", "TESTS", "SECURITY_HEALTH", "APPROVAL", "BACKUP", "POST_INSTALL_TESTS", "POST_INSTALL_SECURITY_HEALTH", "LKG_MARKED"]) assert.ok(steps.includes(s), "missing evidence " + s);
    assert.equal(r.lkgRegistry.latest().build.version, "1.1.0");
    assert.equal(r.uc.auditVerify().ok, true); assert.equal(r.uc.gate({ external: true }).allowed, true);
  } finally { r.done(); }
});

test("without a valid signed approval the update is NOT installed (boolean, wrong subject, replay)", async () => {
  const r = rig(); try {
    await r.uc.checkForUpdates();
    for (const bad of [true, null, sign("INSTALL_UPDATE", "mod-a@9.9.9"), sign("SPEND_MONEY", "mod-a@1.1.0")]) {
      const v = await r.uc.safeUpdate("mod-a@1.1.0", { ownerApproval: bad });
      assert.equal(v.state, "APPROVAL_REQUIRED"); assert.equal(v.approvalGranted, false);
      assert.equal(snap(r.installDir)["VERSION"], "1.0.0");
    }
    const good = sign("INSTALL_UPDATE", "mod-a@1.1.0");
    assert.equal((await r.uc.safeUpdate("mod-a@1.1.0", { ownerApproval: good })).state, "INSTALLED");
  } finally { r.done(); }
});

test("protected components and risky changes always need approval, even with automatic updates on", async () => {
  const r = rig(); try {
    const oa = path.join(r.root, "owner-auth"); fs.mkdirSync(oa); fs.writeFileSync(path.join(oa, "VERSION"), "1.0.0");
    r.uc.registerComponent({ id: "owner-auth", kind: "MODULE", version: "1.0.0", installDir: oa });
    const uc = r.make({ detector: async () => [
      { componentId: "mod-a", version: "1.0.1", riskTags: ["FINANCIAL"] }, { componentId: "mod-a", version: "2.0.0", riskTags: [] },
      { componentId: "mod-a", version: "1.0.2" }, { componentId: "owner-auth", version: "1.0.1", riskTags: [] }, { componentId: "mod-a", version: "1.0.3", riskTags: ["DB_SCHEMA"] }] });
    await uc.checkForUpdates();
    assert.equal(uc.setAutoUpdate(true, { ownerApproval: true }).ok, false);
    assert.equal(uc.setAutoUpdate(true, { ownerApproval: sign("UPDATE_SET_AUTO", "true") }).ok, true);
    const res = await uc.autoTick();
    assert.equal(res.results.length, 5);
    assert.ok(res.results.every(x => x.startsWith("APPROVAL_REQUIRED:")), JSON.stringify(res));
    assert.equal(uc.componentVersion("mod-a"), "1.0.0"); assert.equal(uc.componentVersion("owner-auth"), "1.0.0");
    assert.ok(uc.assessRisk("owner-auth@1.0.1").reasons.includes("PROTECTED_COMPONENT"));
    assert.ok(uc.assessRisk("mod-a@1.0.2").reasons.includes("RISK_NOT_ASSESSED"));
    assert.ok(uc.assessRisk("mod-a@2.0.0").reasons.includes("MAJOR_VERSION"));
    assert.ok(uc.assessRisk("mod-a@1.0.1").reasons.includes("HIGH_RISK_TAG:FINANCIAL"));
    assert.ok(uc.assessRisk("mod-a@1.0.3").reasons.includes("HIGH_RISK_TAG:DB_SCHEMA"));
  } finally { r.done(); }
});

test("Safe Automatic Updates (opt-in, owner-enabled) installs ONLY a low-risk, non-protected, non-major update", async () => {
  const r = rig(); try {
    await r.uc.checkForUpdates();
    assert.equal((await r.uc.autoTick()).reason, "AUTO_UPDATE_OFF"); assert.equal(r.uc.componentVersion("mod-a"), "1.0.0");
    assert.equal(r.uc.setAutoUpdate(true, { ownerApproval: sign("UPDATE_SET_AUTO", "true") }).ok, true);
    const res = await r.uc.autoTick();
    assert.deepEqual(res.results, ["INSTALLED:mod-a@1.1.0"]); assert.equal(r.uc.get("mod-a@1.1.0").installMode, "AUTO_APPROVED_LOW_RISK");
    assert.equal(r.uc.componentVersion("mod-a"), "1.1.0");
  } finally { r.done(); }
});

test("post-install failure: FREEZE -> preserve failed build -> auto-rollback to previous bytes -> verify -> unfreeze", async () => {
  const r = rig({ detect: [{ componentId: "mod-a", version: "1.1.0", riskTags: [], notes: "poison" }] }); try {
    const before = snap(r.installDir);
    await r.uc.checkForUpdates();
    let duringGate = null;
    const uc = r.make({ tester: async ({ dir, phase }) => { if (phase === "POST_INSTALL") duringGate = uc.gate({ external: true }); const bad = fs.existsSync(path.join(dir, "BROKEN")) && phase === "POST_INSTALL"; return { passed: !bad, evidence: phase }; } });
    const v = await uc.safeUpdate("mod-a@1.1.0", { ownerApproval: sign("INSTALL_UPDATE", "mod-a@1.1.0") });
    assert.equal(v.state, "ROLLED_BACK"); assert.equal(v.rollback.verified, true);
    assert.deepEqual(snap(r.installDir), before, "install dir must be byte-identical to pre-update");
    assert.equal(uc.componentVersion("mod-a"), "1.0.0");
    assert.equal(duringGate.allowed, false, "unsafe/external actions must be frozen while the new code is being verified");
    assert.equal(uc.gate({ external: true }).allowed, true, "unfrozen after verified rollback");
    const failed = fs.readdirSync(r.root).find(f => f.startsWith("mod-a.failed-")); assert.ok(failed, "failed build preserved as evidence");
    assert.ok(fs.existsSync(path.join(r.root, failed, "BROKEN")));
    const log = uc.auditEntries().map(e => e.event);
    for (const e of ["UNSAFE_ACTIONS_FROZEN", "UPDATE_FAILED", "UPDATE_ROLLED_BACK", "UNSAFE_ACTIONS_UNFROZEN"]) assert.ok(log.includes(e), e);
    assert.equal(uc.auditVerify().ok, true);
  } finally { r.done(); }
});

test("rollback that cannot be verified keeps the system FROZEN and BLOCKED; only a signed owner approval lifts it", async () => {
  const r = rig({ detect: [{ componentId: "mod-a", version: "1.1.0", riskTags: [], notes: "poison" }] }); try {
    await r.uc.checkForUpdates();
    const uc = r.make({ tester: async ({ dir, phase }) => ({ passed: phase === "STAGING", evidence: phase }) });   // POST_INSTALL and ROLLBACK_VERIFY both fail
    const v = await uc.safeUpdate("mod-a@1.1.0", { ownerApproval: sign("INSTALL_UPDATE", "mod-a@1.1.0") });
    assert.equal(v.state, "BLOCKED");
    assert.equal(uc.gate({ external: true }).allowed, false); assert.equal(uc.gate({ external: false }).allowed, true);
    assert.equal(uc.unfreeze({ ownerApproval: true }).ok, false);
    assert.equal(uc.unfreeze({ ownerApproval: sign("UPDATE_UNFREEZE", "mod-a@1.1.0") }).ok, true);
    assert.equal(uc.gate({ external: true }).allowed, true);
  } finally { r.done(); }
});

test("crash mid-install (hard process death after the swap) is rolled back on restart", async () => {
  const r = rig(); try {
    const res = spawnSync("node", [path.join(HERE, "fixtures", "crash-install.mjs"), r.stateDir, r.backupRoot, r.installDir],
      { env: { ...process.env, TEST_OWNER_PEM: key.privateKeyPem, TEST_OWNER_PUB: key.publicKeyB64 }, encoding: "utf8" });
    assert.equal(res.status, 42, res.stderr);
    assert.equal(snap(r.installDir)["VERSION"], "1.1.0", "crash left the NEW code live (this is the dangerous state)");
    const uc = r.make();
    assert.equal(uc.get("mod-a@1.1.0").state, "INSTALLING"); assert.equal(uc.gate({ external: true }).allowed, false, "freeze survives the crash");
    assert.deepEqual(await uc.recoverInterrupted(), ["ROLLED_BACK:mod-a@1.1.0"]);
    assert.deepEqual(snap(r.installDir), { "VERSION": "1.0.0", "code.txt": "original code" });
    assert.equal(uc.gate({ external: true }).allowed, true); assert.equal(uc.componentVersion("mod-a"), "1.0.0");
  } finally { r.done(); }
});

test("a hanging adapter times out and is treated as a failure, never as a pass", async () => {
  const r = rig({ adapterTimeoutMs: 60, adapters: { tester: () => new Promise(() => {}) } }); try {
    await r.uc.checkForUpdates(); const v = await r.uc.testUpdate("mod-a@1.1.0");
    assert.equal(v.state, "FAILED"); assert.match(v.tests.error, /ADAPTER_TIMEOUT:tester/);
  } finally { r.done(); }
});

test("external API breaking change: ISOLATED, never auto-LIVE; LIVE only after passing probe AFTER install", async () => {
  const probes = []; const mk = ok => async ({ phase }) => { probes.push(phase); return { ok, evidence: ok ? "GET /v2/ping 200 at " + phase : undefined }; };
  const r = rig({ detect: [{ componentId: "stripe-api", version: "2.0.0", riskTags: [], breaking: true }], extra: [{ id: "stripe-api", kind: "INTEGRATION", version: "1.0.0" }] }); try {
    r.uc.restoreIntegrationLive("stripe-api", { ok: true, evidence: "baseline probe" });
    assert.equal(r.uc.integrationStatus("stripe-api").status, "LIVE");
    await r.uc.checkForUpdates();
    assert.equal(r.uc.integrationStatus("stripe-api").status, "ISOLATED", "isolated on detection");
    assert.throws(() => r.uc.restoreIntegrationLive("stripe-api", { ok: true }), /PASSING_PROBE_WITH_EVIDENCE_REQUIRED/);
    assert.throws(() => r.uc.restoreIntegrationLive("stripe-api"), /PASSING_PROBE_WITH_EVIDENCE_REQUIRED/);
    const bad = r.make({ probe: mk(false) });
    assert.equal((await bad.testUpdate("stripe-api@2.0.0")).state, "FAILED"); assert.equal(bad.integrationStatus("stripe-api").status, "ISOLATED");
    const noProbe = r.make({ probe: undefined });
    assert.equal((await noProbe.testUpdate("stripe-api@2.0.0")).state, "BLOCKED");
    const good = r.make({ probe: mk(true) });
    const t = await good.testUpdate("stripe-api@2.0.0"); assert.equal(t.state, "APPROVAL_REQUIRED"); assert.equal(good.integrationStatus("stripe-api").status, "ISOLATED");
    const v = await good.safeUpdate("stripe-api@2.0.0", { ownerApproval: sign("INSTALL_UPDATE", "stripe-api@2.0.0") });
    assert.equal(v.state, "INSTALLED"); const s = good.integrationStatus("stripe-api"); assert.equal(s.status, "LIVE"); assert.match(s.evidence, /POST_INSTALL/);
  } finally { r.done(); }
});

test("integration fix whose post-install probe fails stays ISOLATED (no false 'repaired')", async () => {
  let n = 0;
  const r = rig({ detect: [{ componentId: "llm-x", version: "2.0.0", riskTags: [], breaking: true }], extra: [{ id: "llm-x", kind: "MODEL", version: "1.0.0" }],
    adapters: { probe: async ({ phase }) => (++n, { ok: phase === "STAGING", evidence: "e" }) } }); try {
    await r.uc.checkForUpdates();
    const v = await r.uc.safeUpdate("llm-x@2.0.0", { ownerApproval: sign("INSTALL_UPDATE", "llm-x@2.0.0") });
    assert.equal(v.state, "ROLLED_BACK"); assert.equal(r.uc.integrationStatus("llm-x").status, "ISOLATED"); assert.equal(r.uc.componentVersion("llm-x"), "1.0.0");
  } finally { r.done(); }
});

test("manual rollback needs a signed approval and restores the previous version", async () => {
  const r = rig(); try {
    await r.uc.checkForUpdates(); await r.uc.safeUpdate("mod-a@1.1.0", { ownerApproval: sign("INSTALL_UPDATE", "mod-a@1.1.0") });
    assert.equal((await r.uc.rollback("mod-a@1.1.0", { ownerApproval: true })).ok, false);
    assert.equal(snap(r.installDir)["VERSION"], "1.1.0");
    const rb = await r.uc.rollback("mod-a@1.1.0", { ownerApproval: sign("UPDATE_ROLLBACK", "mod-a@1.1.0") });
    assert.equal(rb.ok, true); assert.equal(rb.state, "ROLLED_BACK");
    assert.deepEqual(snap(r.installDir), { "VERSION": "1.0.0", "code.txt": "original code" }); assert.equal(r.uc.componentVersion("mod-a"), "1.0.0");
    assert.equal((await r.uc.rollback("mod-a@1.1.0", { ownerApproval: sign("UPDATE_ROLLBACK", "mod-a@1.1.0") })).ok, false, "not eligible twice");
  } finally { r.done(); }
});

test("state, versions and audit survive a restart; Control Center view model exposes the required buttons/actions", async () => {
  const r = rig(); try {
    await r.uc.checkForUpdates(); await r.uc.testUpdate("mod-a@1.1.0");
    const uc2 = r.make();
    assert.equal(uc2.get("mod-a@1.1.0").state, "APPROVAL_REQUIRED"); assert.equal(uc2.auditVerify().ok, true);
    const vm = uc2.viewModel();
    assert.deepEqual(vm.buttons.slice(0, 4), ["Check for Updates", "Test Update", "Safe Update", "Rollback"]);
    assert.equal(vm.updates[0].actions.safeUpdate, true); assert.equal(vm.updates[0].actions.rollback, false); assert.equal(vm.autoUpdate, false); assert.equal(vm.auditOk, true);
    assert.equal(vm.updates[0].compatibility.compatible, true); assert.equal(vm.updates[0].tests.passed, true);
    await uc2.safeUpdate("mod-a@1.1.0", { ownerApproval: sign("INSTALL_UPDATE", "mod-a@1.1.0") });
    assert.equal(uc2.viewModel().updates[0].actions.rollback, true);
  } finally { r.done(); }
});

test("a tampered update audit log is refused at startup", async () => {
  const r = rig(); try {
    await r.uc.checkForUpdates();
    const f = path.join(r.stateDir, "update-center-audit.jsonl"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("UPDATE_DETECTED", "UPDATE_SKIPPED_"));
    assert.throws(() => r.make(), /AUDIT_CHAIN_TAMPERED/);
  } finally { r.done(); }
});
