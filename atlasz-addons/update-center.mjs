// ATLASZ Update Center / Safe Update System (V7.3 addendum, Joci 2026-10-07).
//
// Flow:    DETECT -> COMPATIBILITY -> BACKUP/LKG -> STAGING -> AUTOMATED TESTS -> SECURITY/HEALTH
//          -> APPROVE (signed owner approval, or auto ONLY if opted-in AND low-risk AND all gates green)
//          -> INSTALL -> POST-UPDATE TEST -> EVIDENCE
// Failure: FAIL -> FREEZE unsafe (external) actions -> PRESERVE failed build as evidence
//          -> AUTOMATIC ROLLBACK to the pre-update snapshot -> VERIFY -> REPORT
//
// Honesty rules (V7.3 §12):
//  * Every external dependency is an injected adapter. A missing adapter FAILS CLOSED (BLOCKED), never "passes".
//  * An integration/model with a breaking change is ISOLATED; it returns to LIVE only after a passing probe
//    taken AFTER the fix was installed. The center never claims it "auto-repaired" anything without that evidence.
//  * Nothing is ever deleted: failed builds and replaced versions are moved aside.
import fs from "node:fs";
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";
import { createBackup, verifyBackup, recoveryDrill, rollbackInstall } from "./backup-recovery.mjs";
import { getDefaultOwnerAuth } from "./owner-auth.mjs";

export const UPDATE_STATES = Object.freeze(["UPDATE_AVAILABLE", "CHECKING", "TESTING", "READY", "APPROVAL_REQUIRED", "INSTALLING", "INSTALLED", "FAILED", "ROLLED_BACK", "BLOCKED"]);
const NEXT = Object.freeze({
  UPDATE_AVAILABLE: ["CHECKING"],
  CHECKING: ["TESTING", "BLOCKED"],
  TESTING: ["READY", "BLOCKED", "FAILED"],
  READY: ["APPROVAL_REQUIRED", "INSTALLING", "CHECKING"],
  APPROVAL_REQUIRED: ["INSTALLING", "CHECKING", "BLOCKED"],
  INSTALLING: ["INSTALLED", "FAILED"],
  INSTALLED: ["ROLLED_BACK"],
  FAILED: ["ROLLED_BACK", "BLOCKED", "CHECKING"],
  ROLLED_BACK: ["CHECKING"],
  BLOCKED: ["CHECKING"]
});
export const COMPONENT_KINDS = Object.freeze(["SYSTEM", "MODULE", "PLUGIN", "CONNECTOR", "DEPENDENCY", "MODEL", "INTEGRATION"]);
export const HIGH_RISK_TAGS = Object.freeze(["FINANCIAL", "SECURITY", "PERMISSIONS", "CREDENTIAL_AUTH", "DB_SCHEMA", "CONTRACT", "SPENDING", "OWNER_AUTH"]);
// Core safety components: any update to these always needs a signed owner approval.
export const PROTECTED_COMPONENTS = Object.freeze(["owner-auth", "approval-command-gateway", "emergency-stop", "guardrail-engine", "budget-consumption-governor",
  "enterprise-control-plane", "payment-confirmation-adapter", "money-pipeline-controller", "tax-accounting-engine", "backup-recovery", "update-center", "audit-chain"]);

// ---- minimal semver (x.y.z, optional -pre); ranges: *, exact, ^, ~, >=, >, <=, <, space = AND ----
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v ?? "").trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null };
}
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw new Error("INVALID_VERSION");
  for (const k of ["major", "minor", "patch"]) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}
export function satisfies(version, range) {
  const r = String(range ?? "*").trim();
  if (r === "*" || r === "") return true;
  return r.split(/\s+/).every(part => {
    const m = /^(\^|~|>=|<=|>|<|=)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(part);
    if (!m) return false;
    const [, op = "=", base] = m, c = compareVersions(version, base), b = parseVersion(base);
    if (op === "=") return c === 0;
    if (op === ">=") return c >= 0;
    if (op === ">") return c > 0;
    if (op === "<=") return c <= 0;
    if (op === "<") return c < 0;
    const v = parseVersion(version);
    if (c < 0) return false;
    if (op === "~") return v.major === b.major && v.minor === b.minor;
    return b.major > 0 ? v.major === b.major : (b.minor > 0 ? v.major === 0 && v.minor === b.minor : v.major === 0 && v.minor === 0 && v.patch === b.patch);
  });
}
export function updateKind(from, to) {
  const a = parseVersion(from), b = parseVersion(to);
  if (!a || !b) return "UNKNOWN";
  if (b.major !== a.major) return "MAJOR";
  if (b.minor !== a.minor) return "MINOR";
  return "PATCH";
}

const withTimeout = (p, ms, label) => {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error("ADAPTER_TIMEOUT:" + label)), ms); });
  return Promise.race([Promise.resolve(p), timeout]).finally(() => clearTimeout(t));
};

export function createUpdateCenter({ stateDir, backupRoot, adapters = {}, ownerAuth = getDefaultOwnerAuth(), lkgRegistry = null,
  nodeVersion = process.versions.node, adapterTimeoutMs = 300000, now = () => new Date().toISOString() } = {}) {
  if (!stateDir || !backupRoot) throw new Error("UPDATE_CENTER_PATHS_REQUIRED");
  fs.mkdirSync(stateDir, { recursive: true });
  const stateFile = path.join(stateDir, "update-center-state.json");
  const audit = createAuditChain({ filePath: path.join(stateDir, "update-center-audit.jsonl"), now });
  let S = { components: {}, updates: {}, integrations: {}, config: { autoUpdate: false }, freeze: { active: false } };
  if (fs.existsSync(stateFile)) S = { ...S, ...JSON.parse(fs.readFileSync(stateFile, "utf8")) };

  function save() {
    const tmp = stateFile + ".tmp", fd = fs.openSync(tmp, "w", 0o600);
    try { fs.writeSync(fd, JSON.stringify(S)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, stateFile);
  }
  const log = (event, data) => audit.append(event, data);
  const ev = (u, step, ok, detail) => { u.evidence.push({ at: now(), step, ok, detail }); };
  function move(u, to, why) {
    if (!(NEXT[u.state] || []).includes(to)) throw new Error("INVALID_UPDATE_TRANSITION:" + u.state + "->" + to);
    log("UPDATE_STATE", { id: u.id, from: u.state, to, why: why ?? null });
    u.state = to; u.updatedAt = now(); save();
  }
  const call = async (name, args) => {
    const fn = adapters[name];
    if (typeof fn !== "function") return { __missing: true };
    try { return await withTimeout(fn(args), adapterTimeoutMs, name); } catch (e) { return { __error: String(e.message || e) }; }
  };

  // ---- components ----
  function registerComponent({ id, kind = "MODULE", version, installDir = null, isProtected } = {}) {
    if (!id || !COMPONENT_KINDS.includes(kind) || !parseVersion(version)) throw new Error("COMPONENT_FIELDS_INVALID");
    if (kind !== "INTEGRATION" && kind !== "MODEL" && !installDir) throw new Error("COMPONENT_INSTALL_DIR_REQUIRED");
    S.components[id] = { id, kind, version, installDir, protected: isProtected ?? PROTECTED_COMPONENTS.includes(id) };
    if (kind === "INTEGRATION" || kind === "MODEL") S.integrations[id] ??= { status: "UNKNOWN", evidence: null, at: now() };
    log("COMPONENT_REGISTERED", { id, kind, version }); save();
    return structuredClone(S.components[id]);
  }

  // ---- detect ----
  async function checkForUpdates() {
    const r = await call("detector", {});
    if (r.__missing) { log("DETECT_SKIPPED", { reason: "DETECTOR_NOT_CONFIGURED" }); return { ok: false, reason: "DETECTOR_NOT_CONFIGURED", found: [] }; }
    if (r.__error || !Array.isArray(r)) { log("DETECT_FAILED", { error: r.__error || "BAD_DETECTOR_OUTPUT" }); return { ok: false, reason: r.__error || "BAD_DETECTOR_OUTPUT", found: [] }; }
    const found = [];
    for (const d of r) {
      const c = S.components[d.componentId];
      if (!c || !parseVersion(d.version)) { log("DETECT_IGNORED", { componentId: d.componentId, why: !c ? "UNKNOWN_COMPONENT" : "BAD_VERSION" }); continue; }
      if (compareVersions(d.version, c.version) <= 0) continue;
      const id = d.componentId + "@" + d.version;
      if (S.updates[id]) continue;
      S.updates[id] = { id, componentId: d.componentId, from: c.version, version: d.version, kind: updateKind(c.version, d.version), state: "UPDATE_AVAILABLE",
        riskTags: d.riskTags ?? null, breaking: d.breaking === true, requires: d.requires ?? {}, minNode: d.minNode ?? null, notes: d.notes ?? null, source: d.source ?? null,
        detectedAt: now(), updatedAt: now(), compatibility: null, tests: null, security: null, evidence: [], rollback: null, install: null };
      log("UPDATE_DETECTED", { id, kind: S.updates[id].kind, breaking: S.updates[id].breaking });
      if (d.breaking === true && (c.kind === "INTEGRATION" || c.kind === "MODEL")) isolateIntegration(c.id, "BREAKING_CHANGE_DETECTED:" + id);
      found.push(id);
    }
    save();
    return { ok: true, found };
  }

  // ---- risk / approval policy ----
  function assessRisk(u) {
    const c = S.components[u.componentId], reasons = [];
    if (c.protected) reasons.push("PROTECTED_COMPONENT");
    if (!Array.isArray(u.riskTags)) reasons.push("RISK_NOT_ASSESSED");
    else for (const t of u.riskTags) if (HIGH_RISK_TAGS.includes(t)) reasons.push("HIGH_RISK_TAG:" + t);
    if (u.breaking) reasons.push("BREAKING_CHANGE");
    if (u.kind === "MAJOR") reasons.push("MAJOR_VERSION");
    if (u.kind === "UNKNOWN" || parseVersion(u.version)?.pre) reasons.push("UNSTABLE_OR_UNKNOWN_VERSION");
    return { level: reasons.length ? "HIGH" : "LOW", reasons, approvalRequired: reasons.length > 0 };
  }

  // ---- compatibility ----
  function checkCompatibility(u) {
    const c = S.components[u.componentId], problems = [];
    if (compareVersions(u.version, c.version) <= 0) problems.push("NOT_NEWER_THAN_INSTALLED");
    if (u.minNode && !satisfies(nodeVersion, ">=" + u.minNode)) problems.push("NODE_TOO_OLD:" + nodeVersion + "<" + u.minNode);
    for (const [cid, range] of Object.entries(u.requires || {})) {
      const dep = S.components[cid];
      if (!dep) problems.push("REQUIRED_COMPONENT_MISSING:" + cid);
      else if (!satisfies(dep.version, range)) problems.push("REQUIRED_VERSION_UNSATISFIED:" + cid + " " + dep.version + " !~ " + range);
    }
    return { compatible: problems.length === 0, problems, breaking: u.breaking };
  }

  function block(u, why) { ev(u, "BLOCKED", false, why); move(u, "BLOCKED", why); return view(u); }

  // ---- test pipeline (never touches the live install) ----
  async function testUpdate(id) {
    const u = S.updates[id]; if (!u) throw new Error("UNKNOWN_UPDATE");
    const c = S.components[u.componentId];
    if (u.state !== "CHECKING") move(u, "CHECKING", "testUpdate");
    u.compatibility = checkCompatibility(u); ev(u, "COMPATIBILITY", u.compatibility.compatible, u.compatibility);
    if (!u.compatibility.compatible) return block(u, "INCOMPATIBLE:" + u.compatibility.problems.join(","));
    const risk = assessRisk(u); u.risk = risk;
    const isIntegration = c.kind === "INTEGRATION" || c.kind === "MODEL";
    const stagingDir = isIntegration ? path.join(stateDir, "staging-" + u.id.replace(/[^\w.-]/g, "_")) : c.installDir + ".staging-" + u.id.replace(/[^\w.-]/g, "_");
    fs.rmSync(stagingDir, { recursive: true, force: true });                // our own scratch dir only
    if (isIntegration) fs.mkdirSync(stagingDir, { recursive: true }); else fs.cpSync(c.installDir, stagingDir, { recursive: true });
    u.stagingDir = stagingDir;
    move(u, "TESTING", "staging prepared");
    const st = await call("stager", { update: structuredClone(u), component: structuredClone(c), stagingDir });
    if (st.__missing || st.__error || st.ok !== true) { ev(u, "STAGE", false, st); move(u, "FAILED", "stage failed"); return view(u); }
    ev(u, "STAGE", true, st.evidence ?? null);
    const t = await call("tester", { update: structuredClone(u), component: structuredClone(c), dir: stagingDir, phase: "STAGING" });
    u.tests = { phase: "STAGING", passed: t.passed === true, evidence: t.evidence ?? null, error: t.__missing ? "TESTER_NOT_CONFIGURED" : t.__error ?? null, at: now() };
    ev(u, "TESTS", u.tests.passed, u.tests);
    if (!u.tests.passed) { move(u, u.tests.error === "TESTER_NOT_CONFIGURED" ? "BLOCKED" : "FAILED", "tests did not pass"); return view(u); }
    const sh = await call("securityHealth", { update: structuredClone(u), component: structuredClone(c), dir: stagingDir });
    u.security = { ok: sh.ok === true, findings: sh.findings ?? [], error: sh.__missing ? "SECURITY_CHECK_NOT_CONFIGURED" : sh.__error ?? null, at: now() };
    ev(u, "SECURITY_HEALTH", u.security.ok, u.security);
    if (!u.security.ok) { move(u, u.security.error === "SECURITY_CHECK_NOT_CONFIGURED" ? "BLOCKED" : "FAILED", "security/health failed"); return view(u); }
    if (isIntegration) {
      const p = await call("probe", { update: structuredClone(u), component: structuredClone(c), dir: stagingDir, phase: "STAGING" });
      u.probe = { ok: p.ok === true, evidence: p.evidence ?? null, error: p.__missing ? "PROBE_NOT_CONFIGURED" : p.__error ?? null };
      ev(u, "PROBE", u.probe.ok, u.probe);
      if (!u.probe.ok) { move(u, u.probe.error === "PROBE_NOT_CONFIGURED" ? "BLOCKED" : "FAILED", "probe failed"); return view(u); }
    }
    move(u, "READY", "all staging gates passed");
    if (risk.approvalRequired || !S.config.autoUpdate) move(u, "APPROVAL_REQUIRED", risk.approvalRequired ? risk.reasons.join(",") : "automatic updates are off");
    return view(u);
  }

  // ---- install / rollback ----
  async function install(u, mode) {
    const c = S.components[u.componentId], isIntegration = c.kind === "INTEGRATION" || c.kind === "MODEL";
    freezeNow(u, "INSTALLING");                                              // external actions pause while code is swapped
    let backup = null;
    if (!isIntegration) {
      backup = createBackup({ srcDir: c.installDir, backupRoot, label: "pre-" + u.id.replace(/[^\w.-]/g, "_"), appVersion: c.version });
      const vb = verifyBackup(backup.dir);
      if (!vb.ok) { ev(u, "BACKUP", false, vb.problems); move(u, "BLOCKED", "pre-update backup invalid"); return view(u); }
      ev(u, "BACKUP", true, { backupId: backup.id, manifestHash: backup.manifest.manifestHash });
    }
    u.install = { mode, backupDir: backup?.dir ?? null, startedAt: now(), previousVersion: c.version };
    move(u, "INSTALLING", mode);
    try {
      if (!isIntegration) {
        const stamp = Date.now(); u.install.asideDir = c.installDir + ".old-" + stamp; save();
        fs.renameSync(c.installDir, u.install.asideDir); fs.renameSync(u.stagingDir, c.installDir);
      }
    } catch (e) { return fail(u, "INSTALL_SWAP_FAILED:" + e.message); }
    const t = await call("tester", { update: structuredClone(u), component: structuredClone(c), dir: c.installDir ?? u.stagingDir, phase: "POST_INSTALL" });
    const ok = t.passed === true; ev(u, "POST_INSTALL_TESTS", ok, { evidence: t.evidence ?? null, error: t.__error ?? (t.__missing ? "TESTER_NOT_CONFIGURED" : null) });
    if (!ok) return fail(u, "POST_INSTALL_TESTS_FAILED");
    const sh = await call("securityHealth", { update: structuredClone(u), component: structuredClone(c), dir: c.installDir ?? u.stagingDir });
    ev(u, "POST_INSTALL_SECURITY_HEALTH", sh.ok === true, sh);
    if (sh.ok !== true) return fail(u, "POST_INSTALL_SECURITY_HEALTH_FAILED");
    if (isIntegration) {
      const p = await call("probe", { update: structuredClone(u), component: structuredClone(c), phase: "POST_INSTALL" });
      ev(u, "POST_INSTALL_PROBE", p.ok === true, p);
      if (p.ok !== true) return fail(u, "POST_INSTALL_PROBE_FAILED");
      S.integrations[c.id] = { status: "LIVE", evidence: p.evidence ?? "probe ok", at: now() };
    }
    c.version = u.version; u.install.finishedAt = now();
    move(u, "INSTALLED", "post-update gates passed");
    if (!isIntegration && lkgRegistry) await markLkg(u, c);
    unfreezeAfter(u);
    log("UPDATE_INSTALLED", { id: u.id, from: u.from, to: u.version, mode });
    save();
    return view(u);
  }
  async function markLkg(u, c) {
    try {
      const nb = createBackup({ srcDir: c.installDir, backupRoot, label: "lkg-" + u.id.replace(/[^\w.-]/g, "_"), appVersion: u.version });
      const scratch = path.join(stateDir, "drill-" + Date.now());
      const drill = recoveryDrill({ srcDir: c.installDir, backupRoot, scratchDir: scratch });
      const m = lkgRegistry.mark({ backupDir: nb.dir, build: { componentId: c.id, version: u.version }, evidence: "post-update tests + security/health passed; recovery drill " + drill.backupId,
        checks: { smokeTestsPassed: true, healthOk: true, backupVerified: true, restoreDrillPassed: drill.passed, migrationStateKnown: !(u.riskTags || []).includes("DB_SCHEMA") } });
      ev(u, "LKG_MARKED", true, { backupId: m.backupId });
    } catch (e) { ev(u, "LKG_MARKED", false, String(e.message)); }
  }
  async function fail(u, why) {
    ev(u, "FAILED", false, why); log("UPDATE_FAILED", { id: u.id, why });
    if (u.state === "INSTALLING") move(u, "FAILED", why);
    return autoRollback(u, why);
  }
  async function autoRollback(u, why) {
    const c = S.components[u.componentId], isIntegration = c.kind === "INTEGRATION" || c.kind === "MODEL";
    freezeNow(u, "ROLLING_BACK:" + why);                                     // FREEZE unsafe actions before touching anything
    let verified = false, detail = null;
    try {
      if (isIntegration) {
        S.integrations[c.id] = { status: "ISOLATED", evidence: "update failed: " + why, at: now() };
        verified = true; detail = "integration stays ISOLATED (not LIVE) until a probe passes";
      } else {
        const r = rollbackInstall({ backupDir: u.install.backupDir, targetDir: c.installDir, now: () => Date.now() });
        u.rollback = { ...r, startedAt: now() };
        const t = await call("tester", { update: structuredClone(u), component: structuredClone(c), dir: c.installDir, phase: "ROLLBACK_VERIFY" });
        verified = t.passed === true; detail = t.evidence ?? t.__error ?? (t.__missing ? "TESTER_NOT_CONFIGURED" : null);
      }
    } catch (e) { detail = "ROLLBACK_ERROR:" + e.message; }
    ev(u, "ROLLBACK_VERIFY", verified, detail);
    u.rollback = { ...(u.rollback || {}), verified, at: now(), reason: why };
    if (verified) { move(u, "ROLLED_BACK", why); unfreezeAfter(u); log("UPDATE_ROLLED_BACK", { id: u.id, why }); }
    else { log("ROLLBACK_UNVERIFIED_STAYING_FROZEN", { id: u.id, why }); if (u.state === "FAILED") move(u, "BLOCKED", "rollback could not be verified; unsafe actions stay frozen"); }
    save();
    return view(u);
  }

  // ---- freeze (system may restrict itself; only an owner-signed approval lifts a stuck freeze) ----
  function freezeNow(u, reason) { S.freeze = { active: true, reason, updateId: u.id, since: now() }; log("UNSAFE_ACTIONS_FROZEN", { id: u.id, reason }); save(); }
  function unfreezeAfter(u) { if (S.freeze.active && S.freeze.updateId === u.id) { log("UNSAFE_ACTIONS_UNFROZEN", { id: u.id }); S.freeze = { active: false }; save(); } }
  function unfreeze({ ownerApproval } = {}) {
    if (!S.freeze.active) return { ok: true, already: true };
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "UPDATE_UNFREEZE", subject: S.freeze.updateId });
    if (!v.allowed) return { ok: false, reason: v.reason };
    log("UNSAFE_ACTIONS_UNFROZEN_BY_OWNER", { id: S.freeze.updateId }); S.freeze = { active: false }; save(); return { ok: true };
  }
  const gate = ({ external = true } = {}) => (S.freeze.active && external ? { allowed: false, reason: "UPDATE_FREEZE:" + S.freeze.reason } : { allowed: true, reason: null });

  // ---- public actions ----
  async function safeUpdate(id, { ownerApproval = null } = {}) {
    let u = S.updates[id]; if (!u) throw new Error("UNKNOWN_UPDATE");
    if (["UPDATE_AVAILABLE", "BLOCKED", "FAILED", "ROLLED_BACK", "READY"].includes(u.state) || (u.state === "APPROVAL_REQUIRED" && !u.tests)) await testUpdate(id);
    u = S.updates[id];
    if (u.state === "BLOCKED" || u.state === "FAILED") return view(u);
    if (u.state === "APPROVAL_REQUIRED") {
      const v = ownerAuth.verifyApproval(ownerApproval, { action: "INSTALL_UPDATE", subject: u.id });
      if (!v.allowed) { ev(u, "APPROVAL", false, v.reason); save(); return { ...view(u), approvalGranted: false, approvalReason: v.reason }; }
      ev(u, "APPROVAL", true, { nonce: v.nonce }); return install(u, "OWNER_APPROVED");
    }
    return install(u, "AUTO_APPROVED_LOW_RISK");
  }
  async function autoTick() {
    if (!S.config.autoUpdate) return { ran: false, reason: "AUTO_UPDATE_OFF" };
    const done = [];
    for (const u of Object.values(S.updates).filter(x => x.state === "UPDATE_AVAILABLE")) {
      const r = await testUpdate(u.id);
      if (r.state === "READY") { done.push((await install(S.updates[u.id], "AUTO_APPROVED_LOW_RISK")).state + ":" + u.id); }
      else done.push(r.state + ":" + u.id);
    }
    return { ran: true, results: done };
  }
  function setAutoUpdate(enabled, { ownerApproval = null } = {}) {
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "UPDATE_SET_AUTO", subject: String(Boolean(enabled)) });
    if (!v.allowed) return { ok: false, reason: v.reason };
    S.config.autoUpdate = Boolean(enabled); log("AUTO_UPDATE_SET", { enabled: S.config.autoUpdate }); save(); return { ok: true, autoUpdate: S.config.autoUpdate };
  }
  async function rollback(id, { ownerApproval = null } = {}) {            // manual rollback of an INSTALLED update
    const u = S.updates[id]; if (!u) throw new Error("UNKNOWN_UPDATE");
    if (u.state !== "INSTALLED" || !u.install?.backupDir) return { ok: false, reason: "NOT_ROLLBACK_ELIGIBLE:" + u.state };
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "UPDATE_ROLLBACK", subject: u.id });
    if (!v.allowed) return { ok: false, reason: v.reason };
    const c = S.components[u.componentId];
    S.components[u.componentId].version = u.from;
    const r = await autoRollback(Object.assign(u, { state: "INSTALLED" }), "MANUAL_ROLLBACK");
    if (r.state !== "ROLLED_BACK") S.components[u.componentId].version = u.version;
    return { ok: r.state === "ROLLED_BACK", ...r, component: c.id };
  }
  // Crash safety: a process death mid-install leaves INSTALLING. On start, roll it back and verify.
  async function recoverInterrupted() {
    const out = [];
    for (const u of Object.values(S.updates).filter(x => x.state === "INSTALLING")) {
      log("INTERRUPTED_INSTALL_FOUND", { id: u.id });
      out.push((await fail(u, "INTERRUPTED_INSTALL_RECOVERY")).state + ":" + u.id);
    }
    return out;
  }

  // ---- integrations (external APIs / models) ----
  function isolateIntegration(id, reason) {
    S.integrations[id] = { status: "ISOLATED", evidence: reason, at: now() };
    log("INTEGRATION_ISOLATED", { id, reason }); save(); return S.integrations[id];
  }
  const integrationStatus = id => structuredClone(S.integrations[id] ?? { status: "UNKNOWN", evidence: null });
  // Direct LIVE claims are impossible without a passing probe object carrying evidence.
  function restoreIntegrationLive(id, probeResult) {
    if (!probeResult || probeResult.ok !== true || !probeResult.evidence) throw new Error("PASSING_PROBE_WITH_EVIDENCE_REQUIRED");
    S.integrations[id] = { status: "LIVE", evidence: probeResult.evidence, at: now() }; log("INTEGRATION_LIVE", { id }); save(); return S.integrations[id];
  }

  // ---- views (Control Center UPDATE CENTER reads this) ----
  function view(u) {
    const c = S.components[u.componentId];
    return { id: u.id, componentId: u.componentId, kind: c.kind, from: u.from, to: u.version, updateKind: u.kind, state: u.state, breaking: u.breaking,
      risk: u.risk ?? null, compatibility: u.compatibility, tests: u.tests, security: u.security, probe: u.probe ?? null,
      rollback: u.rollback ? { verified: u.rollback.verified, reason: u.rollback.reason, at: u.rollback.at } : null,
      installMode: u.install?.mode ?? null, evidenceCount: u.evidence.length, notes: u.notes };
  }
  function viewModel() {
    const updates = Object.values(S.updates).map(view);
    const act = u => ({
      checkForUpdates: true,
      testUpdate: ["UPDATE_AVAILABLE", "BLOCKED", "FAILED", "ROLLED_BACK", "READY", "APPROVAL_REQUIRED"].includes(u.state),
      safeUpdate: ["UPDATE_AVAILABLE", "READY", "APPROVAL_REQUIRED", "BLOCKED", "FAILED", "ROLLED_BACK"].includes(u.state),
      rollback: u.state === "INSTALLED" && Boolean(S.updates[u.id].install?.backupDir)
    });
    return { components: Object.values(S.components).map(c => ({ id: c.id, kind: c.kind, version: c.version, protected: c.protected })),
      updates: updates.map(u => ({ ...u, actions: act(u) })), integrations: structuredClone(S.integrations),
      autoUpdate: S.config.autoUpdate, freeze: structuredClone(S.freeze), auditHead: audit.head(), auditOk: audit.verify().ok,
      buttons: ["Check for Updates", "Test Update", "Safe Update", "Rollback", "Safe Automatic Updates (opt-in, owner-approved)"] };
  }
  return { registerComponent, checkForUpdates, testUpdate, safeUpdate, autoTick, setAutoUpdate, rollback, recoverInterrupted, unfreeze, gate,
    isolateIntegration, integrationStatus, restoreIntegrationLive, viewModel, assessRisk: id => assessRisk(S.updates[id]),
    get: id => (S.updates[id] ? { ...view(S.updates[id]), evidence: structuredClone(S.updates[id].evidence) } : null),
    list: () => Object.values(S.updates).map(view), componentVersion: id => S.components[id]?.version ?? null,
    freezeStatus: () => structuredClone(S.freeze), auditVerify: () => audit.verify(), auditEntries: () => audit.entries() };
}
