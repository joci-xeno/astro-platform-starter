// ATLASZ Windows Control Center — core (V7.3 §21, §41, addendum). Every owner function that the CLI offers is exposed here
// as a plain function so the GUI (server.mjs + public/) and tests use exactly the same code path.
// Owner-signed actions: the passphrase unlocks Joci's local key only for the moment of signing; nothing is cached.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createEmergencyStop } from "../atlasz-addons/emergency-stop.mjs";
import { createSafeMode } from "../atlasz-addons/safe-mode.mjs";
import { runStartupSelfCheck } from "../atlasz-addons/startup-self-check.mjs";
import { createBackup, verifyBackup, recoveryDrill, createLkgRegistry, rollbackToLastKnownGood, restoreBackup, LKG_CRITERIA } from "../atlasz-addons/backup-recovery.mjs";
import { createUpdateCenter } from "../atlasz-addons/update-center.mjs";
import { readAuditFile, verifyChain } from "../atlasz-addons/audit-chain.mjs";
import { createOwnerKeystore, signWithKeystore, keystoreStatus } from "../atlasz-addons/owner-keystore.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_ENTRY = path.join(HERE, "..", "atlasz-runtime", "supervisor-safe.mjs");
const AUDITS = ["owner-auth-audit.jsonl", "emergency-audit.jsonl", "update-center-audit.jsonl", "safe-mode-audit.jsonl", "vault/vault-audit.jsonl"];

export function createControlCenterCore({ stateDir, configDir, backupRoot = path.join(configDir, "backups"), port = 8080, fetchImpl = fetch,
  updateAdapters = {}, runtimeEntry = RUNTIME_ENTRY, nodeBin = process.execPath } = {}) {
  if (!stateDir || !configDir) throw new Error("STATE_DIR_AND_CONFIG_DIR_REQUIRED");
  fs.mkdirSync(stateDir, { recursive: true }); fs.mkdirSync(configDir, { recursive: true });
  let child = null, childExit = null;

  const ownerAuth = () => {
    const k = keystoreStatus(configDir);
    // No stateDir on purpose: the running runtime owns owner-auth-audit.jsonl (two processes must not append to one chain).
    return createOwnerAuth({ publicKeyB64: k.publicKeyB64 });
  };
  const sign = (passphrase, action, subject) => signWithKeystore(configDir, passphrase, { action, subject, ttlMs: 60000 });
  const emergency = () => createEmergencyStop({ statePath: path.join(stateDir, "emergency-stop.json"), auditPath: path.join(stateDir, "emergency-audit.jsonl"), ownerAuth: ownerAuth() });
  const safeMode = () => createSafeMode({ statePath: path.join(stateDir, "safe-mode.json"), auditPath: path.join(stateDir, "safe-mode-audit.jsonl"), ownerAuth: ownerAuth() });
  const lkg = () => createLkgRegistry({ file: path.join(backupRoot, "lkg-registry.jsonl") });
  let updateCenter = null;
  const uc = () => (updateCenter ??= createUpdateCenter({ stateDir: path.join(stateDir, "updates"), backupRoot: path.join(backupRoot, "updates"), adapters: updateAdapters, ownerAuth: ownerAuth(), lkgRegistry: lkg() }));

  async function runtimeDashboard() {
    try {
      const r = await fetchImpl("http://127.0.0.1:" + port + "/status", { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return { reachable: false, reason: "HTTP_" + r.status, dashboard: null };
      return { reachable: true, reason: null, dashboard: await r.json() };
    } catch (e) { return { reachable: false, reason: String(e.cause?.code || e.message), dashboard: null }; }
  }

  // ---- read-only views ----
  async function status() {
    const rt = await runtimeDashboard();
    const d = rt.dashboard;
    return {
      at: new Date().toISOString(),
      runtime: { reachable: rt.reachable, reason: rt.reason, managedByControlCenter: Boolean(child && child.exitCode === null), lastExit: childExit,
        version: d?.version ?? null, status: d?.status ?? "NOT_RUNNING", lastSystemRun: d?.lastSystemRun ?? null },
      ownerKey: { ...keystoreStatus(configDir), ownerAuthState: ownerAuth().status().state },
      emergency: emergency().status(), safeMode: safeMode().status(),
      agents: d ? { search: d.agents.filter(a => a.role === "SEARCH"), execution: d.agents.filter(a => a.role === "EXECUTION") } : { search: [], execution: [] },
      topology: { expectedSearch: 5, expectedExecution: 25, actualSearch: d ? d.agents.filter(a => a.role === "SEARCH").length : 0, actualExecution: d ? d.agents.filter(a => a.role === "EXECUTION").length : 0 },
      metrics: d?.metrics ?? null, queue: d?.queue ?? null, blockers: d?.blockers ?? [], sourceErrors: d?.sourceErrors ?? {},
      providers: d?.internalAddons ?? null, capabilities: d?.capabilities ?? null,
      money: { note: "Verified revenue counts ONLY with authoritative payment evidence. None is connected.", confirmedPaidUsd: 0, outreachSent: d?.metrics?.outreachSent ?? 0, won: d?.metrics?.won ?? 0 }
    };
  }
  function opportunities() {
    const f = path.join(stateDir, "atlasz-state.json");
    if (!fs.existsSync(f)) return { count: 0, items: [] };
    const s = JSON.parse(fs.readFileSync(f, "utf8"));
    return { count: s.leads.length, items: s.leads.slice(-100).map(({ description, assessment, ...l }) => ({ ...l, score: assessment?.score ?? null })) };
  }
  function approvals() {
    const f = path.join(stateDir, "owner-auth-audit.jsonl");
    const entries = fs.existsSync(f) ? readAuditFile(f).filter(e => /APPROVAL|OWNER_/.test(e.event)).slice(-50).reverse() : [];
    return { pendingApprovalApi: "NOT_EXPOSED_BY_RUNTIME", note: "Runtime keeps no pending-approval queue yet; this shows the signed approval history only.", history: entries };
  }

  // ---- owner key ----
  function provisionOwnerKey({ passphrase }) { const r = createOwnerKeystore(configDir, passphrase); return { publicKeyB64: r.publicKeyB64, next: "The Control Center passes this public key to the runtime it starts. Back up the key file offline." }; }

  // ---- owner controls ----
  function setEmergency({ mode, passphrase, reason = "Control Center", confirm = null }) {
    const action = mode === "RUNNING" ? "EMERGENCY_RESUME" : "EMERGENCY_STOP";
    return emergency().setMode({ mode, ownerApproval: sign(passphrase, action, mode), reason, confirm });
  }
  function exitSafeMode({ passphrase }) {
    const sc = runStartupSelfCheck({ stateDir, ownerAuth: ownerAuth() });
    const r = safeMode().exit({ ownerApproval: sign(passphrase, "SAFE_MODE_EXIT", "NORMAL"), selfCheck: sc });
    return { safeMode: r, selfCheck: sc };
  }

  // ---- runtime process control (start:canonical, local) ----
  function startRuntime() {
    if (child && child.exitCode === null) return { started: false, reason: "ALREADY_RUNNING", pid: child.pid };
    const k = keystoreStatus(configDir);
    const env = { ...process.env, ATLASZ_STATE_DIR: stateDir, PORT: String(port), ...(k.publicKeyB64 ? { ATLASZ_OWNER_PUBLIC_KEY: k.publicKeyB64 } : {}) };
    delete env.ATLASZ_TEST_MODE;
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";    // packaged app: the Electron binary doubles as Node for the runtime
    child = spawn(nodeBin, [runtimeEntry], { env, stdio: "ignore", windowsHide: true });
    childExit = null;
    child.on("exit", (code, sig) => { childExit = { code, signal: sig, at: new Date().toISOString() }; });
    return { started: true, pid: child.pid, entry: "start:canonical (supervisor-safe.mjs)", topology: "5 SEARCH + 25 EXECUTION" };
  }
  function stopRuntime() {
    if (!child || child.exitCode !== null) return Promise.resolve({ stopped: false, reason: "NOT_RUNNING_UNDER_CONTROL_CENTER" });
    return new Promise(res => { child.once("exit", (code, sig) => res({ stopped: true, code, signal: sig })); child.kill("SIGTERM"); setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 8000).unref(); });
  }

  // ---- backup / restore / LKG ----
  function backups() {
    if (!fs.existsSync(backupRoot)) return { items: [], lkg: null };
    const items = fs.readdirSync(backupRoot, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== "updates").map(e => {
      const v = verifyBackup(path.join(backupRoot, e.name)); return { id: e.name, ok: v.ok, problems: v.problems, createdAt: v.manifest?.createdAt ?? null, files: v.manifest?.files.length ?? 0 };
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { items, lkg: lkg().latest() };
  }
  const backupNow = ({ label = "manual" } = {}) => { const b = createBackup({ srcDir: stateDir, backupRoot, label }); return { id: b.id, files: b.manifest.files.length, manifestHash: b.manifest.manifestHash }; };
  function drill() { return recoveryDrill({ srcDir: stateDir, backupRoot, scratchDir: path.join(configDir, "drill-scratch") }); }
  function markLastKnownGood({ smokeEvidence }) {
    if (!smokeEvidence) throw new Error("LKG_EVIDENCE_REQUIRED: supply the test-run evidence (e.g. npm test output reference)");
    const b = createBackup({ srcDir: stateDir, backupRoot, label: "lkg" });
    const d = drill(), sc = runStartupSelfCheck({ stateDir, ownerAuth: ownerAuth() });
    const checks = { smokeTestsPassed: Boolean(smokeEvidence), healthOk: sc.level !== "FAIL", backupVerified: verifyBackup(b.dir).ok, restoreDrillPassed: d.passed, migrationStateKnown: true };
    return lkg().mark({ backupDir: b.dir, build: { by: "control-center" }, checks, evidence: { smokeEvidence, drill: { passed: d.passed, files: d.files }, selfCheck: sc.level } });
  }
  function restoreLastKnownGood({ passphrase }) {
    const target = stateDir;
    return rollbackToLastKnownGood({ registry: lkg(), targetDir: target, ownerAuth: ownerAuth(), ownerApproval: sign(passphrase, "RESTORE_OVERWRITE", path.basename(path.resolve(target))) });
  }
  function restoreFromBackup({ id, passphrase }) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(id))) throw new Error("INVALID_BACKUP_ID");
    return restoreBackup({ backupDir: path.join(backupRoot, id), targetDir: stateDir, ownerAuth: ownerAuth(), ownerApproval: sign(passphrase, "RESTORE_OVERWRITE", path.basename(path.resolve(stateDir))) });
  }

  // ---- System Doctor ----
  async function doctor() {
    const sc = runStartupSelfCheck({ stateDir, ownerAuth: ownerAuth(), expectedAgents: { search: 5, execution: 25 } });
    const findings = sc.checks.filter(c => c.status !== "OK").map(c => ({ severity: c.status, id: c.id, detail: c.detail, remedy: remedy(c) }));
    const audits = AUDITS.map(f => { const p = path.join(stateDir, f); if (!fs.existsSync(p)) return { file: f, present: false }; try { const v = verifyChain(readAuditFile(p)); return { file: f, present: true, ok: v.ok !== false }; } catch (e) { return { file: f, present: true, ok: false, error: String(e.message) }; } });
    for (const a of audits) if (a.present && !a.ok) findings.push({ severity: "FAIL", id: "audit:" + a.file, detail: a.error ?? "CHAIN_INVALID", remedy: "Keep the file as evidence; restore from last known good." });
    const rt = await runtimeDashboard();
    if (!rt.reachable) findings.push({ severity: "DEGRADED", id: "runtime", detail: rt.reason, remedy: "Press Start ATLASZ (or check the port)." });
    const bk = backups();
    if (!bk.items.length) findings.push({ severity: "DEGRADED", id: "backup", detail: "NO_BACKUP_EXISTS", remedy: "Create a backup." });
    else if (bk.items.some(b => !b.ok)) findings.push({ severity: "FAIL", id: "backup", detail: "BACKUP_CORRUPT", remedy: "Create a new backup and investigate the corrupt one." });
    if (!bk.lkg) findings.push({ severity: "DEGRADED", id: "lkg", detail: "NO_LAST_KNOWN_GOOD", remedy: "Mark a verified backup as last known good (needs test evidence)." });
    const level = findings.some(f => f.severity === "FAIL") ? "FAIL" : findings.length ? "DEGRADED" : "OK";
    return { level, selfCheck: sc, audits, findings, runtimeReachable: rt.reachable };
  }
  const remedy = c => ({ "owner-auth": "Provision the owner key in Owner Controls.", "secret-vault": "Set ATLASZ_VAULT_KEY on the host (needed before any credential is stored).", "emergency-stop": "Resume via Owner Controls when it is safe.",
    "queue-journal": "Do not delete. Restore from last known good.", "runtime-state": "Do not overwrite. Restore from last known good.", "disk-free": "Free disk space.", topology: "Fixed topology must be 5 SEARCH + 25 EXECUTION." }[c.id] ?? "See detail.");

  // ---- Update Center (same flow as the CLI/tests; no real detector adapters yet => honest BLOCKED) ----
  const updates = () => ({ ...uc().viewModel(), adapters: { detector: Boolean(updateAdapters.detector), stager: Boolean(updateAdapters.stager), tester: Boolean(updateAdapters.tester), securityHealth: Boolean(updateAdapters.securityHealth) },
    notice: updateAdapters.detector ? null : "BLOCKED: no update detector adapter is configured, so nothing can be detected or installed. Fails closed." });
  const act = async (fn) => { try { return { ok: true, result: await fn() }; } catch (e) { return { ok: false, error: String(e.message) }; } };
  const updateActions = {
    check: () => act(() => uc().checkForUpdates()),
    test: ({ id }) => act(() => uc().testUpdate(id)),
    install: ({ id, passphrase }) => act(() => uc().safeUpdate(id, { ownerApproval: passphrase ? sign(passphrase, "INSTALL_UPDATE", id) : null })),   // id = update id (componentId@version)
    rollback: ({ id, passphrase }) => act(() => uc().rollback(id, { ownerApproval: sign(passphrase, "UPDATE_ROLLBACK", id) })),
    setAuto: ({ enabled, passphrase }) => act(() => uc().setAutoUpdate(Boolean(enabled), { ownerApproval: sign(passphrase, "UPDATE_SET_AUTO", String(Boolean(enabled))) })),
    unfreeze: ({ passphrase }) => act(() => uc().unfreeze({ ownerApproval: sign(passphrase, "UPDATE_UNFREEZE", uc().freezeStatus().updateId) }))
  };

  return { status, opportunities, approvals, provisionOwnerKey, setEmergency, exitSafeMode, startRuntime, stopRuntime, backups, backupNow, drill, markLastKnownGood,
    restoreLastKnownGood, restoreFromBackup, doctor, updates, updateActions, LKG_CRITERIA };
}
