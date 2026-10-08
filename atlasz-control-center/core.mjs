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
import { createFinancialLedger } from "../atlasz-addons/financial-ledger.mjs";
import { createLocalUpdateAdapters, SELFTEST } from "../atlasz-addons/local-update-adapters.mjs";
import { createPluginManager } from "../atlasz-addons/plugin-manager.mjs";
import { createPersonalCommandCenter } from "../atlasz-addons/personal-command-center.mjs";
import { buildDailyBrief, answerQuery, DEFAULT_PREFS, briefDue, markBriefShown } from "../atlasz-addons/master-brief.mjs";
import { assessImpact } from "../atlasz-addons/human-core.mjs";
import { createMobileApi } from "../atlasz-addons/mobile-api.mjs";
import { createApprovalRequests } from "../atlasz-addons/approval-requests.mjs";
import { createDocumentCenter } from "../atlasz-addons/document-center.mjs";
import { createUniversalInbox } from "../atlasz-addons/universal-inbox.mjs";
import { createVoiceSession } from "../atlasz-addons/voice-session.mjs";
import { createConnectorCatalog } from "../atlasz-addons/connector-catalog.mjs";
import { createSecretVault } from "../atlasz-addons/secret-vault.mjs";
import { createTechWatch } from "../atlasz-addons/tech-watch.mjs";
import { createBrainViews } from "./brain-views.mjs";
import { createMoneyViews } from "./money-views.mjs";
import { createOwnerCommandLayer, COMMANDS } from "../atlasz-addons/brain/owner-command.mjs";
import { createSystemDoctor } from "../atlasz-addons/owner-control/system-doctor.mjs";
import { createApprovalGateway } from "../atlasz-addons/owner-control/approval-gateway.mjs";
import { createOwnerKeystore, signWithKeystore, keystoreStatus } from "../atlasz-addons/owner-keystore.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_ENTRY = path.join(HERE, "..", "atlasz-runtime", "supervisor-safe.mjs");
const AUDITS = ["owner-auth-audit.jsonl", "emergency-audit.jsonl", "update-center-audit.jsonl", "safe-mode-audit.jsonl", "vault/vault-audit.jsonl", "ledger/ledger.jsonl"];

export function createControlCenterCore({ stateDir, configDir, backupRoot = path.join(configDir, "backups"), port = 8080, fetchImpl = fetch,
  updateAdapters = null, localUpdates = true, runtimeEntry = RUNTIME_ENTRY, nodeBin = process.execPath, evidenceDir = process.env.ATLASZ_EVIDENCE_DIR || null } = {}) {
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
  // Real local adapters (offline hash-verified packages in <state>/updates/inbox) unless the caller injects its own or disables them.
  const localAdapters = !updateAdapters && localUpdates ? createLocalUpdateAdapters({ inboxDir: path.join(stateDir, "updates", "inbox") }) : null;
  const adapters = updateAdapters ?? localAdapters?.adapters ?? {};
  const packDir = path.join(configDir, "extension-pack");
  function ensureComponents(center) {
    if (!localAdapters) return;
    if (!fs.existsSync(packDir)) {                                           // baseline extension pack: version file + self-test so a rollback can be verified
      fs.mkdirSync(path.join(packDir, "plugins"), { recursive: true });
      fs.writeFileSync(path.join(packDir, "VERSION"), "1.0.0\n");
      fs.writeFileSync(path.join(packDir, SELFTEST), "import fs from 'node:fs'; const v=fs.readFileSync('VERSION','utf8').trim(); process.exit(/^\\d+\\.\\d+\\.\\d+$/.test(v)?0:2);\n");
    }
    const have = new Set(center.viewModel().components.map(c => c.id));
    if (!have.has("atlasz-extension-pack")) center.registerComponent({ id: "atlasz-extension-pack", kind: "PLUGIN", version: fs.readFileSync(path.join(packDir, "VERSION"), "utf8").trim(), installDir: packDir });
    const decl = path.join(stateDir, "updates", "components.json");           // owner-declared components (never auto-created from a package)
    if (fs.existsSync(decl)) for (const c of JSON.parse(fs.readFileSync(decl, "utf8"))) if (!have.has(c.id)) center.registerComponent(c);
  }
  const uc = () => { if (!updateCenter) { updateCenter = createUpdateCenter({ stateDir: path.join(stateDir, "updates"), backupRoot: path.join(backupRoot, "updates"), adapters, ownerAuth: ownerAuth(), lkgRegistry: lkg() }); ensureComponents(updateCenter); } return updateCenter; };

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
      uptime: d?.uptime ?? null, metrics: d?.metrics ?? null, queue: d?.queue ?? null, blockers: d?.blockers ?? [], sourceErrors: d?.sourceErrors ?? {},
      providers: d?.internalAddons ?? null, models: d?.models ?? null, scheduler: d?.scheduler ?? null, capabilities: d?.capabilities ?? null,
      money: { note: "Verified revenue counts ONLY with authoritative payment evidence recorded in the ledger.", confirmedPaidUsd: finance().revenue.verifiedReceivedUsd, outreachSent: d?.metrics?.outreachSent ?? 0, won: d?.metrics?.won ?? 0 }
    };
  }
  function finance() {
    try { return createFinancialLedger({ dir: path.join(stateDir, "ledger") }).summary(); }
    catch (e) { return { error: String(e.message), revenue: { verifiedReceivedUsd: 0, unconfirmedPipelineUsd: 0, source: "LEDGER_UNREADABLE" }, costs: { totalUsd: 0, byProvider: {}, byJob: {}, byCategory: {}, tokensIn: 0, tokensOut: 0, records: 0 }, profit: { verifiedNetUsd: 0, byJob: {} }, chain: { ok: false } }; }
  }
  // Evidence/audit: integrity of every hash-chained log plus the evidence records on disk (if an evidence dir is configured).
  function evidence() {
    const logs = ["owner-auth-audit.jsonl", "safe-mode-audit.jsonl", "emergency-audit.jsonl", path.join("ledger", "ledger.jsonl"), path.join("vault", "vault-audit.jsonl")]
      .map(rel => { const f = path.join(stateDir, rel); if (!fs.existsSync(f)) return { log: rel, present: false }; try { const e = readAuditFile(f), v = verifyChain(e); return { log: rel, present: true, ok: v.ok, entries: e.length, head: v.head ?? null, reason: v.reason ?? null }; } catch (err) { return { log: rel, present: true, ok: false, reason: String(err.message) }; } });
    const records = [];
    if (evidenceDir && fs.existsSync(evidenceDir)) for (const f of fs.readdirSync(evidenceDir).filter(x => x.endsWith(".json")).sort().slice(-20).reverse()) {
      try { const r = JSON.parse(fs.readFileSync(path.join(evidenceDir, f), "utf8")); records.push({ file: f, timestamp: r.timestamp ?? null, environment: r.environment ?? null, result: r.result ?? null, commit: r.commit ?? r.version ?? null, component: r.component ?? null }); } catch { records.push({ file: f, unreadable: true }); }
    }
    return { logs, records, note: "SANDBOX evidence is never LIVE evidence." };
  }
  // owner preferences (language, greeting, signature phrase) - cosmetic, so no approval needed
  const prefsFile = path.join(configDir, "preferences.json");
  const prefs = () => { try { return { ...DEFAULT_PREFS, ...JSON.parse(fs.readFileSync(prefsFile, "utf8")) }; } catch { return { ...DEFAULT_PREFS }; } };
  function setPrefs(p = {}) {
    const cur = prefs(), next = { ...cur };
    if (["hu", "en"].includes(p.language)) next.language = p.language;
    for (const k of ["greetingName", "signaturePhrase"]) if (typeof p[k] === "string" && p[k].length > 0 && p[k].length <= 60 && !/[<>]/.test(p[k])) next[k] = p[k];
    if (typeof p.enabled === "boolean") next.enabled = p.enabled;
    fs.writeFileSync(prefsFile, JSON.stringify(next, null, 1)); return next;
  }
  // Mobile control backend (transport-agnostic; the local server does NOT expose it). Reads are real core views.
  let mobileApi = null;                                                         // one instance: nonce + rate-limit state must persist across requests
  const mobile = () => (mobileApi ??= createMobileApi({ ownerAuth: createOwnerAuth({ publicKeyB64: keystoreStatus(configDir).publicKeyB64, stateDir: path.join(stateDir, "mobile", "auth") }), emergency: emergency(), approvalStore: approvalStore(), auditDir: path.join(stateDir, "mobile"),
    reads: { STATUS: async () => { const s = await status(); return { runtime: s.runtime.status, topology: s.topology, emergency: s.emergency.mode, safeMode: s.safeMode.mode, queue: s.queue }; },
      REFRESH: async () => { const s = await status(); return { at: s.at, runtime: s.runtime.status }; }, APPROVALS: async () => approvals().pending.map(r => ({ id: r.id, what: r.what, risk: r.risk, cost: r.costUsd })),
      ALERTS: async () => { const s = await status(); return { blockers: s.blockers, safeMode: s.safeMode.mode === "SAFE_MODE" ? s.safeMode.reason : null, dead: s.queue?.dead ?? 0 }; }, MONEY: async () => { const f = finance(); return { verifiedRevenueUsd: f.revenue.verifiedReceivedUsd, costsUsd: f.costs.totalUsd, verifiedNetProfitUsd: f.profit.verifiedNetUsd, unconfirmedPipelineUsd: f.revenue.unconfirmedPipelineUsd }; },
      JOBS: async () => opportunities().items.slice(-20).map(l => ({ id: l.id, title: l.title, outreach: l.outreachStatus, project: l.projectStatus })), HEALTH: async () => { const d = await doctor(); return { level: d.level, findings: d.findings.length }; } } }));
  const briefGate = path.join(stateDir, "brief-gate.json");
  // Personal Command Center: tasks / reminders / deadlines. The owner's local day comes from the saved preference (utcOffsetMinutes), default UTC.
  const pccFile = path.join(stateDir, "pcc", "items.json");
  const pccInst = () => createPersonalCommandCenter({ file: pccFile, utcOffsetMinutes: Number(prefs().utcOffsetMinutes) || 0 });
  const schedules = () => { const f = path.join(stateDir, "scheduler", "schedules.json"); if (!fs.existsSync(f)) return { state: "NOT_CONNECTED", note: "No schedules recorded.", jobs: [] }; try { const j = Object.values(JSON.parse(fs.readFileSync(f, "utf8")).jobs ?? {}); return { state: "CONNECTED", delivery: "AT_LEAST_ONCE", jobs: j.map(x => ({ id: x.id, name: x.name, kind: x.kind, tool: x.tool, state: x.state, nextRunAt: x.nextRunAt, lastStatus: x.lastResult?.status ?? null, missedRuns: x.missedRuns, interruptedRuns: x.interruptedRuns ?? 0 })) }; } catch { return { state: "UNREADABLE", jobs: [] }; } };
  const pcc = () => { try { const c = pccInst(); return { state: "CONNECTED", agenda: c.agenda(), open: c.list({ status: "OPEN" }), summary: c.summary(), schedules: schedules() }; } catch (e) { return { state: "UNREADABLE", error: String(e.message) }; } };
  function pccAction({ op, id, ...rest } = {}) {
    const c = pccInst();
    switch (op) {
      case "add": return c.add({ ...rest, source: "OWNER" });
      case "complete": return c.complete(id, "OWNER");
      case "cancel": return c.cancel(id, "OWNER");
      case "ack": return c.ack(id);
      case "reschedule": return c.reschedule(id, { dueAt: rest.dueAt, remindAt: rest.remindAt }, "OWNER");
      default: throw new Error("UNKNOWN_PCC_OP");
    }
  }
  async function brief({ markShown = false, force = false } = {}) {
    const gate = briefDue({ file: briefGate, force }), b = buildDailyBrief({ status: await status(), finance: finance(), approvals: approvals(), prefs: prefs(), moneyEngine: moneyViews.money(), crmInbox: moneyViews.crmInbox(), behavior: (await brainViews.all())?.behavior, agenda: (() => { try { return pccInst().agenda(); } catch { return null; } })() });
    if (markShown && gate.due) markBriefShown({ file: briefGate });
    return { prefs: prefs(), firstOfDay: gate.due, ...b };
  }
  async function chat({ q = "" } = {}) { return answerQuery(String(q).slice(0, 500), { status: await status(), finance: finance(), approvals: approvals() }); }
  function opportunities() {
    const f = path.join(stateDir, "atlasz-state.json");
    if (!fs.existsSync(f)) return { count: 0, items: [] };
    const s = JSON.parse(fs.readFileSync(f, "utf8"));
    return { count: s.leads.length, items: s.leads.slice(-100).map(({ description, assessment, ...l }) => ({ ...l, score: assessment?.score ?? null })) };
  }
  const approvalStore = () => createApprovalRequests({ dir: path.join(stateDir, "approvals") });
  function approvals() {
    const f = path.join(stateDir, "owner-auth-audit.jsonl");
    const history = fs.existsSync(f) ? readAuditFile(f).filter(e => /APPROVAL|OWNER_/.test(e.event)).slice(-50).reverse() : [];
    const all = approvalStore().list().reverse();
    const impact = r => assessImpact({ summary: r.what, reversible: r.reversible, externalEffect: r.externalEffect && !/^none/i.test(String(r.externalEffect)), affectedParties: r.affectedParties ?? [], alignedWithOwnerGoals: true });
    return { pending: all.filter(x => x.status === "PENDING").map(r => ({ ...r, humanImpact: impact(r) })), decided: all.filter(x => x.status !== "PENDING").slice(0, 50), history,
      note: "A request must answer what/why/cost/risk/external effect/reversible/if-no/no-spend alternative; incomplete requests are refused." };
  }
  function decideApproval({ id, decision, passphrase = null, reason = "" }) {
    const store = approvalStore();
    if (decision === "REJECTED") return store.decide({ id, decision, reason });               // rejecting is always safe: no signature needed
    const req = store.list().find(x => x.id === id);
    if (!req) throw new Error("APPROVAL_REQUEST_NOT_FOUND");
    if (req.status !== "PENDING") throw new Error("APPROVAL_NOT_PENDING:" + req.status);
    return store.decide({ id, decision: "APPROVED", approval: sign(passphrase, req.action, req.subject), reason });
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
    if (child && child.exitCode === null && child.signalCode === null) return { started: false, reason: "ALREADY_RUNNING", pid: child.pid };
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
    // "exited" means exitCode OR signalCode is set: a process ended by a signal (always the case for kill() on Windows) has exitCode === null, and waiting for a second 'exit' event would hang forever
    const exited = () => child.exitCode !== null || child.signalCode !== null;
    if (!child || exited()) return Promise.resolve({ stopped: false, reason: "NOT_RUNNING_UNDER_CONTROL_CENTER" });
    return new Promise(res => { const kill = setTimeout(() => !exited() && child.kill("SIGKILL"), 8000); kill.unref(); child.once("exit", (code, sig) => { clearTimeout(kill); res({ stopped: true, code, signal: sig }); }); child.kill("SIGTERM"); });
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
  const drillLog = path.join(configDir, "drills.jsonl");
  const drills = () => { try { return fs.existsSync(drillLog) ? fs.readFileSync(drillLog, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : []; } catch { return []; } };
  function drill() { const r = recoveryDrill({ srcDir: stateDir, backupRoot, scratchDir: path.join(configDir, "drill-scratch") }); fs.appendFileSync(drillLog, JSON.stringify({ at: new Date().toISOString(), ok: r.passed === true, files: r.files }) + "\n"); return r; }
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

  // ---- Brain panels + Owner Command (V7.3 Brain §13, §18). Panels are read-only views of persisted Brain state; the command box needs a signed approval for anything consequential. ----
  const ccBrainDir = path.join(stateDir, "brain-cc");
  const brainViews = createBrainViews({ stateDir, backups: () => backups(), drills, auditFile: path.join(ccBrainDir, "owner-command-audit.jsonl"), liveSummary: async () => (await runtimeDashboard()).dashboard?.brain ?? null });
  let cmdAuth = null;
  const commandAuth = () => (cmdAuth ??= createOwnerAuth({ publicKeyB64: keystoreStatus(configDir).publicKeyB64, stateDir: path.join(ccBrainDir, "auth") }));   // persistent nonces: a captured approval cannot be replayed
  async function brainCommand({ text, passphrase = null, confirm = null } = {}) {
    const handlers = {
      SHOW_AGENTS: async () => { const s = await status(); return { topology: s.topology, search: s.agents.search.map(a => ({ id: a.id, status: a.status })), execution: s.agents.execution.map(a => ({ id: a.id, status: a.status })) }; },
      FIND_OPPORTUNITIES: async () => opportunities().items.slice(-10).map(l => ({ id: l.id, title: l.title })),
      SHOW_JOBS: async () => opportunities().items.slice(-10).map(l => ({ id: l.id, title: l.title, outreach: l.outreachStatus, project: l.projectStatus })),
      SHOW_REVENUE: async () => finance().revenue, SHOW_COSTS_PROFIT: async () => ({ costs: finance().costs, profit: finance().profit }),
      SHOW_BROKEN: async () => (await doctor()).findings, RUN_DOCTOR: async () => { const d = await doctor(); return { level: d.level, findings: d.findings.length }; },
      CREATE_RESTORE_POINT: async () => backupNow({ label: "owner-command" }), TEST_NEXT_UPDATE: async () => uc().checkForUpdates(),
      PAUSE_EXTERNAL: async () => setEmergency({ mode: "STOP_EXTERNAL_ACTIONS", passphrase, reason: "Owner command" }),
      RESUME_SYSTEM: async () => setEmergency({ mode: "RUNNING", passphrase, reason: "Owner command", confirm }),
      ROLLBACK_LAST_STABLE: async () => restoreLastKnownGood({ passphrase }) };
    const layer = createOwnerCommandLayer({ ownerAuth: commandAuth(), auditPath: path.join(ccBrainDir, "owner-command-audit.jsonl"), handlers });
    const intent = layer.parse(text);
    let approval = null;
    if (intent && COMMANDS[intent].consequential && passphrase) { try { approval = sign(passphrase, "OWNER_COMMAND_" + intent, intent); } catch { return { status: "NEEDS_APPROVAL", intent, reason: "PASSPHRASE_INVALID" }; } }
    return layer.handle(text, { ownerApproval: approval });
  }
  // ---- Documents / Inbox / Voice / Connectors / Tech Watch (read-mostly views over the durable modules) ----
  const docCenter = () => createDocumentCenter({ dir: path.join(stateDir, "documents") });
  const documents = () => { const d = docCenter(); return { summary: d.summary(), items: d.list({ tenantId: "JOCI", role: "OWNER" }).slice(0, 100) }; };
  const inboxMod = () => createUniversalInbox({ dir: path.join(stateDir, "inbox"), ownerAuth: ownerAuth() });
  const inbox = () => { const i = inboxMod(); return { counts: i.counts(), chain: i.verify(), items: i.list().slice(0, 100), note: "Drafts are never sent from here. Sending needs a proven connector, an open kill switch and your signed approval." }; };
  const voice = () => { const v = createVoiceSession({}); const st = v.status(); return { ...st, note: st.live ? null : "BLOCKED: no tested speech-to-text and text-to-speech provider is attached, so voice is not live. Voice can never approve anything." }; };
  const connectors = () => { let vault; try { vault = createSecretVault({ dir: path.join(stateDir, "vault") }); } catch (e) { return { error: String(e.message), connectors: [] }; } return createConnectorCatalog({ vault }).health(); };
  const techWatch = () => createTechWatch({ feedDir: path.join(configDir, "tech-watch"), installed: () => uc().viewModel().components.map(c => ({ componentId: c.id, version: c.version })) }).scan();
  // ---- Update Center (same flow as the CLI/tests; no real detector adapters yet => honest BLOCKED) ----
  const plugins = () => createPluginManager({ roots: [path.join(configDir, "plugins"), path.join(packDir, "plugins")], stateDir: path.join(stateDir, "plugins"), ownerAuth: ownerAuth() });
  const pluginActions = {
    enable: ({ id, passphrase }) => act(() => plugins().enable(id, { ownerApproval: passphrase ? sign(passphrase, "PLUGIN_ENABLE", id) : null })),
    disable: ({ id }) => act(() => plugins().disable(id)),
    setTheme: ({ id = null }) => act(() => plugins().setTheme(id)),
    resetQuarantine: ({ id, passphrase }) => act(() => plugins().resetQuarantine(id, { ownerApproval: sign(passphrase, "PLUGIN_RESET_QUARANTINE", id) }))
  };
  const updates = () => ({ ...uc().viewModel(), adapters: { detector: Boolean(adapters.detector), stager: Boolean(adapters.stager), tester: Boolean(adapters.tester), securityHealth: Boolean(adapters.securityHealth), kind: localAdapters ? "LOCAL_OFFLINE_PACKAGES" : (updateAdapters ? "INJECTED" : "NONE") },
    inbox: localAdapters ? localAdapters.lastScan() : null,
    notice: adapters.detector ? null : "BLOCKED: no update detector adapter is configured, so nothing can be detected or installed. Fails closed." });

  // ---- Owner Safety / Control (V7.3 Owner Control §15, §16). Real status only: anything not observable is UNKNOWN / NOT_CONFIGURED, never HEALTHY. ----
  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
  const chainState = f => { const p = path.join(stateDir, f); if (!fs.existsSync(p)) return "NOT_CONFIGURED"; try { return verifyChain(readAuditFile(p)).ok !== false ? "OK" : "BROKEN"; } catch { return "BROKEN"; } };
  async function doctorV2() {
    const sc = runStartupSelfCheck({ stateDir, ownerAuth: ownerAuth(), expectedAgents: { search: 5, execution: 25 } });
    const rt = await runtimeDashboard(), d = rt.dashboard, oc = d?.ownerControl ?? null, bk = backups();
    const chk = id => sc.checks.find(c => c.id === id);
    const fromCheck = id => { const c = chk(id); if (!c) return { state: "UNKNOWN", detail: "NO_CHECK" }; return c.status === "OK" ? { state: "HEALTHY", detail: c.detail } : c.status === "FAIL" ? { state: "FAILED", detail: c.detail } : { state: "DEGRADED", detail: c.detail }; };
    const live = (fn, why = "runtime not reachable") => (d ? fn(d) : { state: "UNKNOWN", detail: why });
    const upd = (() => { try { return uc().viewModel(); } catch { return null; } })();
    const probes = {
      runtime: () => (rt.reachable ? { state: "HEALTHY", detail: "status endpoint answered" } : { state: "UNKNOWN", detail: rt.reason }),
      agent_topology_30: () => live(x => { const s = x.agents.filter(a => a.role === "SEARCH").length, e = x.agents.filter(a => a.role === "EXECUTION").length; return s === 5 && e === 25 ? { state: "HEALTHY", detail: "5+25" } : { state: "BLOCKED", detail: `${s}+${e}` }; }),
      queue: () => (chk("queue-journal") ? fromCheck("queue-journal") : { state: "NOT_CONFIGURED" }),
      database: () => fromCheck("runtime-state"),
      brain_components: () => live(x => (x.brain && x.brain.state !== "ERROR" ? { state: x.brain.topology?.ok ? "HEALTHY" : "DEGRADED", detail: x.brain.orchestrator } : { state: "FAILED", detail: "brain summary error" })),
      models: () => live(x => { const m = x.brain?.models; return Array.isArray(m) && m.length ? (m.some(z => z.state === "LIVE") ? { state: "DEGRADED", detail: "some models LIVE, others not probed" } : { state: "NOT_CONFIGURED", detail: "no model has a passing probe" }) : { state: "NOT_CONFIGURED", detail: "no models registered" }; }),
      tools: () => ({ state: "UNKNOWN", detail: "no tool health source connected" }),
      connectors: () => { try { const c = connectors(); const l = c.connectors ?? c; return Array.isArray(l) && l.some(x => x.status === "LIVE") ? { state: "DEGRADED", detail: "some connectors LIVE" } : { state: "NOT_CONFIGURED", detail: "no connector is LIVE" }; } catch { return { state: "UNKNOWN" }; } },
      secret_vault: () => fromCheck("secret-vault"),
      owner_authentication: () => { const k = keystoreStatus(configDir); const a = ownerAuth().status().state; return !k.provisioned ? { state: "NOT_CONFIGURED", detail: "no owner key" } : a === "LIVE" ? { state: "HEALTHY" } : { state: "DEGRADED", detail: a }; },
      kill_switch: () => { const e = emergency().status(); return e.mode === "RUNNING" ? { state: "HEALTHY", detail: "armed, RUNNING" } : { state: "BLOCKED", detail: "EMERGENCY STOP ACTIVE " + e.mode }; },
      approval_gateway: () => ({ state: "HEALTHY", detail: createApprovalGateway({ dir: path.join(stateDir, "owner-control", "approvals"), ownerAuth: ownerAuth() }).pending().length + " pending" }),
      security_brain: () => (oc?.securityBrain && oc.securityBrain !== "NOT_CONFIGURED" ? { state: "HEALTHY", detail: JSON.stringify(oc.securityBrain).slice(0, 120) } : { state: "UNKNOWN", detail: "runtime not reachable" }),
      financial_firewall: () => { const f = oc?.financialFirewall ?? readJson(path.join(stateDir, "owner-control", "financial-firewall.json")); return f ? { state: "HEALTHY", detail: f.mode ?? "NO_SPEND" } : { state: "UNKNOWN", detail: "no firewall state observed" }; },
      black_box: () => { const c = chainState("brain/blackbox.jsonl"); return c === "OK" ? { state: "HEALTHY", detail: "hash chain intact" } : c === "BROKEN" ? { state: "FAILED", detail: "hash chain broken" } : { state: "NOT_CONFIGURED", detail: "no black box yet" }; },
      backup: () => (!bk.items.length ? { state: "NOT_CONFIGURED", detail: "no backup exists" } : bk.items.some(b => !b.ok) ? { state: "FAILED", detail: "a backup is corrupt" } : drills().at(-1)?.ok ? { state: "HEALTHY", detail: "latest backup verified, drill passed" } : { state: "UNKNOWN", detail: "backup exists, restore drill not yet passed" }),
      last_known_good: () => (bk.lkg ? { state: "HEALTHY", detail: bk.lkg.backupId } : { state: "NOT_CONFIGURED", detail: "no LKG" }),
      recovery_readiness: () => (!bk.items.length ? { state: "NOT_CONFIGURED" } : bk.items.some(b => !b.ok) ? { state: "FAILED", detail: "corrupt backup" } : bk.lkg && drills().at(-1)?.ok ? { state: "HEALTHY", detail: "LKG + passing drill" } : { state: "UNKNOWN", detail: "need LKG and a passing drill" }),
      update_center: () => (upd ? { state: upd.freeze?.active ? "BLOCKED" : "HEALTHY", detail: upd.freeze?.active ? "unsafe actions frozen by update" : "idle" } : { state: "UNKNOWN" }),
    };
    return createSystemDoctor({ probes }).run();
  }
  async function ownerSafety() {
    const st = await status(), rt = await runtimeDashboard(), oc = rt.dashboard?.ownerControl ?? null, bk = backups(), dr = drills().at(-1) ?? null;
    const gw = createApprovalGateway({ dir: path.join(stateDir, "owner-control", "approvals"), ownerAuth: ownerAuth() });
    const fwFile = readJson(path.join(stateDir, "owner-control", "financial-firewall.json"));
    const doc = await doctorV2();
    const latest = bk.items[0] ?? null;
    return {
      at: new Date().toISOString(),
      ownerAuthority: { ownerId: "JOCI", state: st.ownerKey.ownerAuthState, provisioned: st.ownerKey.provisioned },
      killSwitch: { mode: st.emergency.mode, banner: st.emergency.banner ?? null },
      approvals: { pending: approvalStore().pending().length + gw.pending().length, gatewayPending: gw.pending().slice(0, 20).map(x => ({ id: x.id, operation: x.operation, what: x.what, requestedBy: x.requestedBy, costUsd: x.costUsd, financialRisk: x.financialRisk, securityRisk: x.securityRisk, dataRisk: x.dataRisk, reversibility: x.reversibility })) },
      securityBrain: oc?.securityBrain ?? "UNKNOWN — runtime not reachable", financialFirewall: oc?.financialFirewall ?? (fwFile ? { mode: fwFile.mode, policy: fwFile.policy } : "NOT_OBSERVED — no firewall state yet (default NO_SPEND)"),
      blackBox: oc?.blackBox ?? { chain: chainState("brain/blackbox.jsonl") }, safeMode: st.safeMode,
      currentVersion: rt.dashboard?.version ?? "UNKNOWN — runtime not reachable", lastKnownGood: bk.lkg ?? null,
      latestBackup: latest ? { id: latest.id, ok: latest.ok, createdAt: latest.createdAt, files: latest.files } : null,
      restoreReadiness: !bk.items.length ? "NOT_CONFIGURED" : bk.items.some(b => !b.ok) ? "NOT_READY" : bk.lkg && dr?.ok ? "READY" : "UNKNOWN",
      recoveryStatus: dr ? { lastDrill: dr.at, passed: dr.ok } : "NO_DRILL_YET", systemHealth: { overall: doc.overall, counts: doc.counts, normalOperation: doc.normalOperation },
      controls: ["EMERGENCY_STOP", "PAUSE_EXTERNAL_ACTIONS", "RESUME", "RUN_SYSTEM_DOCTOR", "CREATE_SAFE_RESTORE_POINT", "VERIFY_BACKUP", "ROLL_BACK_TO_LKG", "RESTORE", "VIEW_INCIDENTS", "VIEW_SECURITY_EVENTS", "VIEW_APPROVALS"],
      runtimeReachable: rt.reachable
    };
  }
  async function ownerSafetyAction({ action, passphrase = null, confirm = null, id = null } = {}) {
    switch (action) {
      case "EMERGENCY_STOP": return setEmergency({ mode: "PAUSE_ALL", passphrase, reason: "Owner Safety panel" });
      case "PAUSE_EXTERNAL_ACTIONS": return setEmergency({ mode: "STOP_EXTERNAL_ACTIONS", passphrase, reason: "Owner Safety panel" });
      case "RESUME": return setEmergency({ mode: "RUNNING", passphrase, reason: "Owner Safety panel", confirm });
      case "RUN_SYSTEM_DOCTOR": return doctorV2();
      case "CREATE_SAFE_RESTORE_POINT": return backupNow({ label: "restore-point" });
      case "VERIFY_BACKUP": { const r = drill(); return { drill: { passed: r.passed, files: r.files, mismatches: r.mismatches }, backups: backups().items.map(b => ({ id: b.id, ok: b.ok })) }; }
      case "ROLL_BACK_TO_LKG": return restoreLastKnownGood({ passphrase });
      case "RESTORE": return restoreFromBackup({ id, passphrase });
      case "VIEW_INCIDENTS": return { incidents: brainViews.all().disasterRecovery ?? [], drills: drills().slice(-20) };
      case "VIEW_SECURITY_EVENTS": return { security: brainViews.all().security ?? null };
      case "VIEW_APPROVALS": return { legacy: approvalStore().list().slice(-50), gateway: createApprovalGateway({ dir: path.join(stateDir, "owner-control", "approvals"), ownerAuth: ownerAuth() }).list().slice(-50) };
      default: throw new Error("UNKNOWN_OWNER_SAFETY_ACTION");
    }
  }
  const act = async (fn) => { try { return { ok: true, result: await fn() }; } catch (e) { return { ok: false, error: String(e.message) }; } };
  const updateActions = {
    check: () => act(() => uc().checkForUpdates()),
    test: ({ id }) => act(() => uc().testUpdate(id)),
    install: ({ id, passphrase }) => act(() => uc().safeUpdate(id, { ownerApproval: passphrase ? sign(passphrase, "INSTALL_UPDATE", id) : null })),   // id = update id (componentId@version)
    rollback: ({ id, passphrase }) => act(() => uc().rollback(id, { ownerApproval: sign(passphrase, "UPDATE_ROLLBACK", id) })),
    setAuto: ({ enabled, passphrase }) => act(() => uc().setAutoUpdate(Boolean(enabled), { ownerApproval: sign(passphrase, "UPDATE_SET_AUTO", String(Boolean(enabled))) })),
    unfreeze: ({ passphrase }) => act(() => uc().unfreeze({ ownerApproval: sign(passphrase, "UPDATE_UNFREEZE", uc().freezeStatus().updateId) }))
  };

  const moneyViews = createMoneyViews({ stateDir });
  return { pcc, pccAction, moneyEngine: () => moneyViews.money(), moneyJobs: () => moneyViews.jobs(), moneyAgents: () => moneyViews.agents(), moneyRecurring: () => moneyViews.recurring(), crmInbox: () => moneyViews.crmInbox(), ownerSafety, ownerSafetyAction, doctorV2, brain: () => brainViews.all(), brainCommand, documents, inbox, voice, connectors, techWatch, mobile: req => mobile().handle(req), brief, chat, prefs, setPrefs, plugins: () => plugins().list(), theme: () => plugins().activeTheme(), pluginActions, finance, evidence, status, opportunities, approvals, decideApproval, provisionOwnerKey, setEmergency, exitSafeMode, startRuntime, stopRuntime, backups, backupNow, drill, markLastKnownGood,
    restoreLastKnownGood, restoreFromBackup, doctor, updates, updateActions, LKG_CRITERIA };
}
