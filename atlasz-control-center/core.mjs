// ATLASZ Windows Control Center — core (V7.3 §21, §41, addendum). Every owner function that the CLI offers is exposed here
// as a plain function so the GUI (server.mjs + public/) and tests use exactly the same code path.
// Owner-signed actions: the passphrase unlocks Joci's local key only for the moment of signing; nothing is cached.
import fs from "node:fs";
import os from "node:os";
import { createPaymentEventLedger } from "../atlasz-addons/business/payment-events.mjs";
import { createFileIntake } from "../atlasz-addons/file-intake.mjs";
import { detectScanner } from "../atlasz-addons/malware-scanner.mjs";
import { createIncidentResponse } from "../atlasz-addons/incident-response.mjs";
import { listDeadLetters } from "../atlasz-addons/dead-letter-queue.mjs";
import { revenueOps as buildRevenueOps } from "./revenue-ops.mjs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { scrub } from "../atlasz-addons/secret-patterns.mjs";
import { createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createEmergencyStop } from "../atlasz-addons/emergency-stop.mjs";
import { createSafeMode } from "../atlasz-addons/safe-mode.mjs";
import { runStartupSelfCheck } from "../atlasz-addons/startup-self-check.mjs";
import { detectNodeRestrictions } from "../atlasz-addons/restricted-node.mjs";
import { createPortableBackup, verifyPortableBackup, restorePortableBackup } from "../atlasz-addons/portable-backup.mjs";
import { execFileSync } from "node:child_process";
import { createBackup, verifyBackup, recoveryDrill, createLkgRegistry, rollbackToLastKnownGood, restoreBackup, LKG_CRITERIA } from "../atlasz-addons/backup-recovery.mjs";
import { createUpdateCenter } from "../atlasz-addons/update-center.mjs";
import { readAuditFile, verifyChain } from "../atlasz-addons/audit-chain.mjs";
import { createFinancialLedger } from "../atlasz-addons/financial-ledger.mjs";
import { createLocalUpdateAdapters, SELFTEST } from "../atlasz-addons/local-update-adapters.mjs";
import { createPluginManager } from "../atlasz-addons/plugin-manager.mjs";
import { createPluginInstaller, packageHash } from "../atlasz-addons/plugin-installer.mjs";
import { createMcpClient } from "../atlasz-addons/mcp-client.mjs";
import { analyzeRepo, runRepoTests } from "../atlasz-addons/repo-analyzer.mjs";
import { createPrototypeBuilder } from "../atlasz-addons/prototype-builder.mjs";
import { createPersonalCommandCenter } from "../atlasz-addons/personal-command-center.mjs";
import { buildDailyBrief, answerQuery, DEFAULT_PREFS, briefDue, markBriefShown } from "../atlasz-addons/master-brief.mjs";
import { assessImpact } from "../atlasz-addons/human-core.mjs";
import { createMobileApi } from "../atlasz-addons/mobile-api.mjs";
import { createApprovalRequests } from "../atlasz-addons/approval-requests.mjs";
import { createObservationMemory } from "../atlasz-addons/observation-memory.mjs";
import { createMemoryPanel } from "./memory-panel.mjs";
import { createModelRegistryPanel } from "./model-registry-panel.mjs";
import { createSecurityCenterPanel } from "./security-center-panel.mjs";
import { createAgentsPanel } from "./agents-panel.mjs";
import { createTickLoop } from "../atlasz-addons/tick-loop.mjs";
import { createToolRegistry } from "../atlasz-addons/typed-tools.mjs";
import { createModuleBroker } from "../atlasz-addons/module-broker.mjs";
import { MANAGER_IDS } from "../atlasz-addons/master-coordinator.mjs";
import { createBrainSystem } from "../atlasz-addons/brain/brain-system.mjs";
import { createBrainMasterBridge } from "../atlasz-addons/brain-master-bridge.mjs";
import { registerModels } from "../atlasz-addons/registrations/models.mjs";
import { registerTools } from "../atlasz-addons/registrations/tools.mjs";
import { registerBrain } from "../atlasz-addons/registrations/brain.mjs";
import { createDigitalTwin } from "../atlasz-addons/digital-twin.mjs";
import { registerDiscovery } from "../atlasz-addons/registrations/discovery.mjs";
import { createSourceAllowlist } from "../atlasz-addons/source-allowlist.mjs";
import { createCapabilityProfileStore } from "../atlasz-addons/eligibility-model.mjs";
import { registerAgents } from "../atlasz-addons/registrations/agents.mjs";
import { createAgentToolBroker } from "../atlasz-addons/agent-tool-broker.mjs";
import { COMBINED_POLICY, EXTENSION_SHA, D12_ACTION } from "../atlasz-addons/agent-tool-policy-ext.mjs";
import { TOOL_POLICY } from "../atlasz-addons/agent-tool-policy.mjs";
import { verifyDurableDecision } from "../atlasz-addons/owner-auth.mjs";
import { approvalActionName } from "../atlasz-addons/owner-control/owner-authority.mjs";
import { registerWorkflow } from "../atlasz-addons/registrations/workflow.mjs";
import { registerBusiness } from "../atlasz-addons/registrations/business.mjs";
import { createMoneyEngine } from "../atlasz-addons/business/money-engine.mjs";
import { createInboxPipeline } from "../atlasz-addons/business/inbox-pipeline.mjs";
import { createRevenuePersistence } from "../atlasz-addons/revenue-persistence.mjs";
import { qualify } from "../atlasz-addons/lead-qualifier.mjs";
import { registerRuntime } from "../atlasz-addons/registrations/runtime.mjs";
import { createScheduler } from "../atlasz-addons/scheduler.mjs";
import { createCredentialBroker } from "../atlasz-addons/credential-broker.mjs";
import { mapRecoverySources } from "../atlasz-addons/owner-control/recovery-source-map.mjs";
import { registerSafety } from "../atlasz-addons/registrations/safety.mjs";
import { registerSecurity } from "../atlasz-addons/registrations/security.mjs";
import { createOwnerControlSystem } from "../atlasz-addons/owner-control/owner-control-system.mjs";
import { createBlackBox } from "../atlasz-addons/brain/black-box.mjs";
import { createSecurityBrain } from "../atlasz-addons/brain/security-brain.mjs";
import { createVerifier } from "../atlasz-addons/brain/verifier.mjs";
import { ROSTER as AGENT_ROSTER } from "../atlasz-addons/agent-registry.mjs";
import { BUILTIN_EXECUTORS as BUILTIN_TOOLS } from "../atlasz-addons/agent-executors.mjs";
import { createVaultPanel } from "./vault-panel.mjs";
import { createChatProvidersPanel } from "./chat-providers-panel.mjs";
import { createReleaseVerifier } from "../atlasz-addons/release-signing.mjs";
import { createTradingPanel } from "./trading-panel.mjs";
import { createOpsViews } from "./ops-views.mjs";
import { createModalityFabric } from "../atlasz-addons/modality-fabric.mjs";
import { createCodeSandbox } from "../atlasz-addons/code-sandbox.mjs";
import { createResearchLedger } from "../atlasz-addons/research-ledger.mjs";
import { createKnowledgeProjects } from "../atlasz-addons/knowledge-projects.mjs";
import { createDocumentCenter } from "../atlasz-addons/document-center.mjs";
import { createUniversalInbox } from "../atlasz-addons/universal-inbox.mjs";
import { createVoiceSession } from "../atlasz-addons/voice-session.mjs";
import { createVoiceConversation } from "../atlasz-addons/voice-conversation.mjs";
import { createWorkbench } from "../atlasz-addons/workbench.mjs";
import { createModelGateway } from "../atlasz-addons/model-gateway.mjs";
import { createProviderResilience } from "../atlasz-addons/provider-resilience.mjs";
import { createModelIntelligence } from "../atlasz-addons/brain/model-intelligence.mjs";
import { createCapabilityGraph } from "../atlasz-addons/brain/capability-graph.mjs";
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

export function createControlCenterCore({ ollamaFetch = null, cloudFetch = null, cloudResolve = null, a11yWorkerUrl = null, a11yTimeoutMs = 3000, stateDir, configDir, backupRoot = path.join(configDir, "backups"), port = 8080, fetchImpl = fetch,
  updateAdapters = null, localUpdates = true, runtimeEntry = RUNTIME_ENTRY, nodeBin = process.execPath, evidenceDir = process.env.ATLASZ_EVIDENCE_DIR || null } = {}) {
  if (!stateDir || !configDir) throw new Error("STATE_DIR_AND_CONFIG_DIR_REQUIRED");
  fs.mkdirSync(stateDir, { recursive: true }); fs.mkdirSync(configDir, { recursive: true });
  let child = null, childExit = null;

  let authCache = null;       // one verifier per public key for the life of this process, so a used approval nonce is remembered (single-use holds, not just per call)
  const ownerAuth = () => {
    const k = keystoreStatus(configDir);
    // No stateDir on purpose: the running runtime owns owner-auth-audit.jsonl (two processes must not append to one chain).
    if (authCache && authCache.key === k.publicKeyB64) return authCache.auth;
    const auth = createOwnerAuth({ publicKeyB64: k.publicKeyB64 }); authCache = { key: k.publicKeyB64, auth }; return auth;
  };
  const sign = (passphrase, action, subject) => signWithKeystore(configDir, passphrase, { action, subject, ttlMs: 60000 });
  const emergency = () => createEmergencyStop({ statePath: path.join(stateDir, "emergency-stop.json"), auditPath: path.join(stateDir, "emergency-audit.jsonl"), ownerAuth: ownerAuth() });
  const safeMode = () => createSafeMode({ statePath: path.join(stateDir, "safe-mode.json"), auditPath: path.join(stateDir, "safe-mode-audit.jsonl"), ownerAuth: ownerAuth() });
  const lkg = () => createLkgRegistry({ file: path.join(backupRoot, "lkg-registry.jsonl") });
  let updateCenter = null;
  // Real local adapters (offline hash-verified packages in <state>/updates/inbox) unless the caller injects its own or disables them.
  // Release signature verifier (trust anchors are owner-signed, kept in <state>/updates/release-signing). Built lazily; with no owner key it fails closed ("VERIFIER_UNAVAILABLE").
  let relV = null;
  const releaseVerifier = () => (relV ??= createReleaseVerifier({ ownerAuth: ownerAuth(), stateDir: path.join(stateDir, "updates", "release-signing"), isStopped: () => emergency().status().mode !== "RUNNING" || safeMode().status().mode !== "NORMAL" }));
  const releaseVerifierProxy = { verifyBundle: (...a) => { try { return releaseVerifier().verifyBundle(...a); } catch { return { ok: false, reasons: ["VERIFIER_UNAVAILABLE"] }; } }, accept: (...a) => { try { return releaseVerifier().accept(...a); } catch { return { ok: false, reasons: ["VERIFIER_UNAVAILABLE"] }; } } };
  const localAdapters = !updateAdapters && localUpdates ? createLocalUpdateAdapters({ inboxDir: path.join(stateDir, "updates", "inbox"), releaseVerifier: releaseVerifierProxy }) : null;
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

  // Token the runtime requires on every route except /health (ATLASZ-T3-001). A runtime started outside the Control Center keeps its own token via ATLASZ_RUNTIME_TOKEN.
  const runtimeToken = process.env.ATLASZ_RUNTIME_TOKEN && process.env.ATLASZ_RUNTIME_TOKEN.length >= 24 ? process.env.ATLASZ_RUNTIME_TOKEN : randomBytes(24).toString("hex");
  async function runtimeDashboard() {
    try {
      const r = await fetchImpl("http://127.0.0.1:" + port + "/status", { signal: AbortSignal.timeout(3000), headers: { "x-atlasz-token": runtimeToken } });
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
  // Two schedulers may exist: the runtime child's (schedules.json) and the Master's (schedules-cc.json). Each process owns exactly one file; this view merges them and says which is which.
  const schedules = () => {
    const rd = (f, source) => { const file = path.join(stateDir, "scheduler", f); if (!fs.existsSync(file)) return { source, state: "NOT_CONNECTED", jobs: [] }; try { return { source, state: "CONNECTED", jobs: Object.values(JSON.parse(fs.readFileSync(file, "utf8")).jobs ?? {}).map(x => ({ id: x.id, name: x.name, kind: x.kind, tool: x.tool, state: x.state, nextRunAt: x.nextRunAt, lastStatus: x.lastResult?.status ?? null, missedRuns: x.missedRuns, interruptedRuns: x.interruptedRuns ?? 0, source })) }; } catch { return { source, state: "UNREADABLE", jobs: [] }; } };
    const parts = [rd("schedules-cc.json", "MASTER"), rd("schedules.json", "RUNTIME")], bad = parts.find(x => x.state === "UNREADABLE");
    const live = parts.filter(x => x.state === "CONNECTED");
    return live.length ? { state: bad ? "UNREADABLE" : "CONNECTED", delivery: "AT_LEAST_ONCE", sources: parts.map(x => ({ source: x.source, state: x.state, jobs: x.jobs.length })), jobs: live.flatMap(x => x.jobs) } : { state: bad ? "UNREADABLE" : "NOT_CONNECTED", note: "No schedules recorded.", jobs: [] };
  };
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
  function provisionOwnerKey({ passphrase }) {
    // the owner's key must never be created where Git could track it
    const repoRoot = path.resolve(HERE, ".."), cfg = path.resolve(configDir);
    if (cfg === repoRoot || cfg.startsWith(repoRoot + path.sep)) throw new Error("KEY_DIR_INSIDE_REPOSITORY: choose a configuration directory outside the source tree");
    const r = createOwnerKeystore(configDir, passphrase); ocCache = null; brokerCache = null; toolsCache = null; schedCache = null; credBroker = null; brainCache = null; bridgeCache = null; moneyCache = null; inboxPipeCache = null; revPersistCache = null; srcAllowCache = null; capProfCache = null; twinCache = null; agentToolCache = null; incidentCache = null; intakeCache = null; return { publicKeyB64: r.publicKeyB64, next: "The Control Center passes this public key to the runtime it starts. Back up the key file offline." }; }

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
    const env = { ...process.env, ATLASZ_STATE_DIR: stateDir, PORT: String(port), ATLASZ_RUNTIME_TOKEN: runtimeToken, ...(k.publicKeyB64 ? { ATLASZ_OWNER_PUBLIC_KEY: k.publicKeyB64 } : {}) };
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

  const revenueOps = () => buildRevenueOps({ money: money(), pending: () => approvalStore().pending(), workforceTasks: () => { try { return agentsPanel.workforce()?.listTasks?.() ?? []; } catch { return []; } }, deadLetters: () => { try { return listDeadLetters("OPEN").length; } catch { return 0; } }, revenuePersistence: revenuePersistence() });
  // ---- incident response (independent of the Brain / models): block, isolate, preserve evidence, alert the owner ----
  let incidentCache = null; const ownerAlerts = [];
  const incidentResponse = () => (incidentCache ??= createIncidentResponse({ dir: path.join(stateDir, "incidents"), ownerAuth: (() => { try { return ownerAuth(); } catch { return null; } })(),
    registry: (() => { try { return agentsPanel.workforce()?.registry ?? null; } catch { return null; } })(),
    suspendAgentTasks: (agentId, reason) => { const m = agentsPanel.masterRef?.(), w = agentsPanel.workforce?.(); let n = 0; for (const t of (w?.listTasks?.() ?? [])) if (t.agentId === agentId && ["RUNNING", "QUEUED", "ASSIGNED", "INTERRUPTED"].includes(t.status)) { try { if (m?.suspend?.(t.taskId, reason)?.ok) n++; } catch { /* reported by the count */ } } return n; },
    evidenceProvider: ({ agentId, tool }) => ({ agentToolSignals: agentToolSignals.slice(-50), brokerStats: (() => { try { return agentToolBroker().stats(); } catch { return null; } })(), blackBoxTail: (() => { try { return ocBlackBox.all?.().slice(-100) ?? null; } catch { return null; } })(), agentId, tool }),
    alert: a => { ownerAlerts.push(a); if (ownerAlerts.length > 200) ownerAlerts.shift(); } }));
  // ---- untrusted file intake (quarantine + established scanner); submit is a containment step and is allowed even under emergency stop, release is not ----
  let intakeCache = null, scannerCache;
  const malwareScanner = () => (scannerCache === undefined ? (scannerCache = detectScanner()) : scannerCache);
  const fileIntake = () => (intakeCache ??= createFileIntake({ dir: path.join(stateDir, "intake-quarantine"), ownerAuth: (() => { try { return ownerAuth(); } catch { return null; } })(), scanner: malwareScanner(),
    isStopped: () => { try { return emergency().status().mode !== "RUNNING"; } catch { return true; } }, alert: a => { ownerAlerts.push(a); if (ownerAlerts.length > 200) ownerAlerts.shift(); }, onIncident: i => incidentResponse().declare(i) }));
  async function intakeFile({ name, contentBase64, source = "owner-upload" } = {}) { if (typeof contentBase64 !== "string" || contentBase64.length > 40 * 1024 * 1024) return { ok: false, reason: "CONTENT_BASE64_REQUIRED_OR_TOO_LARGE" }; return fileIntake().submit({ name, bytes: Buffer.from(contentBase64, "base64"), source }); }
  const intakeStatus = () => ({ scanner: malwareScanner() ? { name: malwareScanner().name, engine: malwareScanner().engine } : null, scannerState: malwareScanner() ? "ENGINE_DETECTED" : "NO_SCANNER_INSTALLED: every file stays HELD (install ClamAV, or run on Windows with Defender)", held: fileIntake().list().length });
  // ---- agent supervision: one row per permanent agent (task, tools, model, cost, errors, security warnings, blocks, recovery) composed from the workforce views, the tool-call audit and the incident store ----
  function agentSupervision() {
    let views = []; try { views = agentsPanel.workforce()?.agentViews?.() ?? []; } catch { /* workforce unavailable: rows then say UNKNOWN */ }
    const calls = {}; try { for (const e of (ocBlackBox?.all?.() ?? [])) if (e.kind === "AGENT_TOOL_CALL" && e.agentId) { const c = (calls[e.agentId] ??= { total: 0, ok: 0, denied: 0, rateLimited: 0, pendingApproval: 0, other: 0 }); c.total++; const d = String(e.decision ?? ""); if (d === "OK") c.ok++; else if (d === "DENIED") c.denied++; else if (d === "RATE_LIMITED") c.rateLimited++; else if (d === "PENDING_OWNER_APPROVAL") c.pendingApproval++; else c.other++; } } catch { /* audit unreadable */ }
    const inc = incidentResponse().open(), alerts = ownerAlerts.slice(-200);
    const ids = [...Array.from({ length: 5 }, (_, i) => "SEARCH-" + (i + 1)), ...Array.from({ length: 25 }, (_, i) => "EXECUTION-" + (i + 1))], byId = new Map(views.map(v => [v.id, v]));
    const agents = ids.map(id => { const v = byId.get(id) ?? null, mine = inc.filter(x => x.agentId === id), blocked = incidentResponse().isBlocked({ agentId: id, tool: null });
      return { id, state: v?.state ?? "UNKNOWN", currentTask: v?.currentTask ?? null, toolsInUse: v?.toolsInUse ?? [], assignedModel: v?.assignedModel ?? null, costUsd: v?.cost?.taskCostUsd ?? null, costLimits: v?.cost?.limits ?? null,
        toolCalls: calls[id] ?? { total: 0, ok: 0, denied: 0, rateLimited: 0, pendingApproval: 0, other: 0 }, errors: v?.history?.failed ?? null, blocker: v?.blocker ?? null, recovery: v ? { retriesOrReworks: v.history.rejectedThenReworked, lastSuccess: v.lastSuccess } : null,
        securityWarnings: alerts.filter(a => a.agentId === id).length + mine.length, openIncidents: mine.map(x => ({ id: x.id, kind: x.kind, state: x.state })), blockedByIncident: Boolean(blocked) }; });
    const sum = f => agents.reduce((n, a) => n + (f(a) ?? 0), 0);
    return { at: new Date().toISOString(), agents, totals: { agents: agents.length, working: agents.filter(a => a.state === "WORKING").length, blocked: agents.filter(a => a.blockedByIncident).length, toolCalls: sum(a => a.toolCalls.total), toolCallsDenied: sum(a => a.toolCalls.denied), costUsd: sum(a => a.costUsd), openIncidents: inc.length },
      openIncidents: inc, ownerAlerts: alerts.slice(-20), notes: { suspiciousNetworkActivity: "Outbound requests are allowed only through the egress policy; denied requests are audited there. This view does not yet aggregate them per agent.", modelUsage: "Model usage appears only when a model call really happened (no live model today)." } };
  }
  // ---- D12: the agent tool policy EXTENSION stays inactive until the owner signs an approval bound to its exact fingerprint (durable record re-verified against the owner public key on every start) ----
  const d12File = () => path.join(stateDir, "policy", "d12-approval.json");
  function d12Active() {
    try { const r = JSON.parse(fs.readFileSync(d12File(), "utf8")), pk = keystoreStatus(configDir).publicKeyB64;
      return r.extensionSha === EXTENSION_SHA && verifyDurableDecision(r.approval, { publicKeyB64: pk, action: D12_ACTION, subject: EXTENSION_SHA }); } catch { return false; }
  }
  function d12Status() { return { state: d12Active() ? "ACTIVE" : "PENDING_OWNER_APPROVAL", extensionSha: EXTENSION_SHA, action: D12_ACTION, subject: EXTENSION_SHA, effect: d12Active() ? "Extension rows are enforced (still re-validated per call)." : "Only the base 34-tool policy is enforced; extension tools are DENIED for every agent." }; }
  function activateD12({ ownerApproval } = {}) {
    const v = ownerAuth().verifyApproval(ownerApproval, { action: D12_ACTION, subject: EXTENSION_SHA });
    if (!v.allowed) throw new Error("OWNER_APPROVAL_REQUIRED:" + v.reason);
    fs.mkdirSync(path.dirname(d12File()), { recursive: true, mode: 0o700 }); fs.writeFileSync(d12File(), JSON.stringify({ extensionSha: EXTENSION_SHA, approvedAt: new Date().toISOString(), approval: ownerApproval }), { mode: 0o600 });
    agentToolCache = null; try { ocBlackBox.record({ kind: "D12_POLICY_ACTIVATED", decision: "ACTIVE", reason: EXTENSION_SHA.slice(0, 16) }); } catch { /* audit is best effort */ }
    return d12Status();
  }
  // ---- portable encrypted backup (OWNER surface only: the passphrase is supplied by the owner per call and is never stored, logged or exposed through the module broker) ----
  const portableSets = (tmp) => {
    const root = path.resolve(HERE, ".."), sets = [{ name: "state", dir: stateDir }, { name: "config", dir: configDir, exclude: ["backups", "drill-scratch"] }];
    if (fs.existsSync(path.join(root, "docs"))) sets.push({ name: "docs", dir: path.join(root, "docs") });
    const man = path.join(tmp, "manifests"); fs.mkdirSync(man, { recursive: true });
    for (const f of ["package.json", "atlasz-runtime/package.json", "atlasz-control-center/package.json"]) { try { fs.copyFileSync(path.join(root, f), path.join(man, f.replace(/\//g, "__"))); } catch { /* optional manifest */ } }
    sets.push({ name: "manifests", dir: man });
    try { const g = path.join(tmp, "git"); fs.mkdirSync(g, { recursive: true }); execFileSync("git", ["bundle", "create", path.join(g, "atlasz.bundle"), "--all"], { cwd: root, stdio: "ignore", timeout: 120000 }); sets.push({ name: "git", dir: g }); } catch { /* no git history available (installed build): source stays on GitHub */ }
    return sets;
  };
  function portableBackup({ destination, passphrase, label = "owner" } = {}) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atlbak-"));
    try { let commit = null; try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.resolve(HERE, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* not a checkout */ }
      const r = createPortableBackup({ sets: portableSets(tmp), destination, passphrase, label, extra: { gitCommit: commit, node: process.version } });
      try { ocBlackBox.record({ kind: "PORTABLE_BACKUP", decision: "CREATED", reason: r.id }); } catch { /* audit is best effort */ }
      return r; } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  const portableVerify = ({ file, passphrase }) => verifyPortableBackup(file, passphrase);
  /** Restore into an ISOLATED scratch tree, boot a fresh Control Center on it and run its health checks. Never touches the live state. */
  async function portableRestoreRehearsal({ file, passphrase } = {}) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "atlrest-")), t = { state: path.join(d, "state"), config: path.join(d, "config"), docs: path.join(d, "docs"), manifests: path.join(d, "manifests"), git: path.join(d, "git") };
    try {
      const rr = restorePortableBackup({ file, passphrase, targets: t });
      const c2 = createControlCenterCore({ stateDir: t.state, configDir: t.config });
      const r = await c2.modules({ health: true }); const bad = r.catalog.filter(m => !["HEALTHY", "LOADED_NEEDS_DEPENDENCY", "VIA_CONSUMER", "OFFLINE_BY_DESIGN", "SUPERSEDED"].includes(m.health?.state));
      const sc = runStartupSelfCheck({ stateDir: t.state, ownerAuth: null });
      return { passed: bad.length === 0, restored: rr.restored, backupId: rr.backupId, modules: r.summary.modules, unhealthy: bad.map(m => m.id), startupSelfCheck: sc?.ok ?? sc?.passed ?? null, isolated: true, gitBundlePresent: fs.existsSync(path.join(t.git, "atlasz.bundle")), notice: rr.notice };
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  }
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
  const modalityFabric = createModalityFabric(), secPanel = createSecurityCenterPanel({ stateDir, releaseVerifier: () => releaseVerifier(), ownerAuth: () => ownerAuth(), sign: (p, a, su) => sign(p, a, su), isStopped: () => emergency().status().mode !== "RUNNING" || safeMode().status().mode !== "NORMAL" }), docCenter = () => createDocumentCenter({ dir: path.join(stateDir, "documents"), media: modalityFabric, quarantine: secPanel.quarantine() });
  const documents = () => { const d = docCenter(); return { summary: d.summary(), items: d.list({ tenantId: "JOCI", role: "OWNER" }).slice(0, 100) }; };
  // Multimodal view: built-in capability, provider slots (all external), and the media documents the Document Center already holds (metadata only).
  const media = () => { try { const d = docCenter().list({ tenantId: "JOCI", role: "OWNER" }).filter(x => x.extraction?.status === "METADATA_ONLY"); return { state: "CONNECTED", ...modalityFabric.summary(), documents: d.map(x => ({ id: x.id, name: x.name, ingestedAt: x.ingestedAt, classification: x.classification, ...x.extraction.meta })) }; } catch (e) { return { state: "UNREADABLE", error: String(e.message) }; } };
  // Knowledge Projects (owner view): same files the runtime uses. Owner reads as OWNER (not forAgent); SECRET stays hidden even from the owner view.
  const KP_T = "JOCI", kpInst = () => createKnowledgeProjects({ file: path.join(stateDir, "knowledge", "projects.json"), documents: docCenter() });
  const knowledge = () => { try { const k = kpInst(); return { state: "CONNECTED", method: "KEYWORD_BM25_NOT_SEMANTIC", projects: k.list({ tenantId: KP_T }).map(p => ({ ...p, ...k.summary(p.id, { tenantId: KP_T }) })) }; } catch (e) { return { state: "UNREADABLE", error: String(e.message) }; } };
  function knowledgeAction({ op, projectId, ...r } = {}) {
    const k = kpInst(), w = { tenantId: KP_T };
    switch (op) {
      case "create": return k.create({ ...w, name: r.name, description: r.description, allowedRoles: r.allowedRoles ?? ["OWNER"] });
      case "addDocument": return k.addDocument(projectId, { ...w, documentId: r.documentId });
      case "addNote": return k.addNote(projectId, { ...w, title: r.title, text: r.text });
      case "addWebSnapshot": return k.addWebSnapshot(projectId, { ...w, url: r.url, retrievedAt: r.retrievedAt, title: r.title, text: r.text });
      case "removeMember": return k.removeMember(projectId, { ...w, memberId: r.memberId });
      case "ask": return k.answer(projectId, { ...w, role: "OWNER", query: r.query });
      case "search": return k.search(projectId, { ...w, role: "OWNER", query: r.query });
      case "verify": return k.verifyCitation(r.citation, { ...w, role: "OWNER" });
      default: throw new Error("UNKNOWN_KP_OP");
    }
  }
  // Research Ledger (owner view): same files as the runtime. Resolving a contradiction is OWNER-only and available only here.
  const rlInst = () => createResearchLedger({ file: path.join(stateDir, "research", "ledger.json"), knowledge: kpInst() }), RW = { tenantId: KP_T, role: "OWNER" };
  const research = () => { try { const r = rlInst(), qs = r.list(RW).map(q => r.report(q.id, RW)); return { state: "CONNECTED", summary: r.summary(RW), projects: kpInst().list({ tenantId: KP_T }), questions: qs, events: r.events(RW, { limit: 30 }) }; } catch (e) { return { state: "UNREADABLE", error: String(e.message) }; } };
  function researchAction({ op, ...a } = {}) {
    if (op === "confirmEvidence" || op === "resolveContradiction") {          // decisions that turn a lexical match into a fact (or settle a conflict): signed from the passphrase, bound to the exact item, never just the dashboard token
      const { passphrase, ...rest } = a; a = rest; const action = op === "confirmEvidence" ? "RESEARCH_CONFIRM" : "RESEARCH_RESOLVE", subject = op === "confirmEvidence" ? String(a.findingId ?? "") + "#" + String(a.evidenceId ?? "") : String(a.id ?? "") + ":" + String(a.winner ?? "none");
      if (typeof passphrase !== "string" || !passphrase) throw new Error("PASSPHRASE_REQUIRED");
      const v = ownerAuth().verifyApproval(sign(passphrase, action, subject), { action, subject }); if (!v.allowed) throw new Error("OWNER_APPROVAL_REQUIRED:" + v.reason);
    }
    const r = rlInst();
    switch (op) {
      case "openQuestion": return r.openQuestion({ projectId: a.projectId, text: a.text }, RW);
      case "addSource": return r.addSource(a.projectId, a, RW);
      case "addFinding": return r.addFinding(a.questionId, a, RW);
      case "attachEvidence": return r.attachEvidence(a.findingId, { citation: a.citation, relation: a.relation }, RW);
      case "declareContradiction": return r.declareContradiction(a.a, a.b, { note: a.note }, RW);
      case "resolveContradiction": return r.resolveContradiction(a.id, { winner: a.winner ?? null, note: a.note }, RW);
      case "confirmEvidence": return r.confirmEvidence(a.findingId, a.evidenceId, { note: a.note }, RW);
      case "report": return r.report(a.questionId, RW);
      default: throw new Error("UNKNOWN_RESEARCH_OP");
    }
  }
  // Observation memory (owner view; same file as the runtime). Media observations are metadata-only and need explicit consent with a purpose.
  const OW = { tenantId: KP_T, role: "OWNER" }, obsInst = () => createObservationMemory({ file: path.join(stateDir, "memory", "observations.json") });
  const observations = ({ query = "", scopes = ["PERSONAL", "BUSINESS", "CUSTOMER", "SYSTEM"] } = {}) => { try { const m = obsInst(); return { state: "CONNECTED", summary: m.summary(OW), results: m.recall({ query, scopes, limit: 50 }, OW).results, events: m.events(OW, { limit: 20 }) }; } catch (e) { return { state: "UNREADABLE", error: String(e.message) }; } };
  function observationsAction({ op, ...a } = {}) {
    const m = obsInst();
    switch (op) {
      case "observe": return m.observe({ text: a.text, kind: a.kind, scope: a.scope, classification: a.classification, tags: a.tags, retentionDays: a.retentionDays, modality: a.modality, consent: a.consent }, OW);
      case "observeDocument": { const bytes = docCenter().readBytes(a.documentId, { tenantId: KP_T, role: "OWNER" }); if (!bytes) throw new Error("DOCUMENT_NOT_AVAILABLE"); return m.observeMedia(modalityFabric.describe(bytes, {}), { consent: a.consent, tags: a.tags, retentionDays: a.retentionDays }, OW); }
      case "search": return m.recall({ query: a.query, scopes: a.scopes ?? ["PERSONAL", "BUSINESS", "CUSTOMER", "SYSTEM"], limit: 50 }, OW);
      case "correct": return m.correct(a.id, { text: a.text, reason: a.reason }, OW);
      case "forget": return m.forget(a.id, { reason: a.reason }, OW);
      case "forgetWhere": return m.forgetWhere(a.filter ?? {}, OW);
      case "forgetAll": return m.forgetAll({ confirm: a.confirm }, OW);
      case "purge": return m.purgeExpired(OW);
      case "history": return m.history(a.id, OW);
      case "export": return m.exportAll(OW);
      default: throw new Error("UNKNOWN_OBSERVATION_OP");
    }
  }
  // Code sandbox (owner view). Runs here use NAMESPACE isolation only; a process-only run needs a signed approval through the control chain and is not offered from this form.
  let sandboxCache = null;     // ONE instance: the concurrency cap and the in-memory audit chain head must be shared by every request
  const sandboxInst = () => (sandboxCache ??= createCodeSandbox({ baseDir: path.join(stateDir, "sandbox", "runs"), auditFile: path.join(stateDir, "sandbox", "audit.jsonl") }));
  const sandboxFresh = () => createCodeSandbox({ baseDir: path.join(stateDir, "sandbox", "runs"), auditFile: path.join(stateDir, "sandbox", "audit.jsonl") });   // read view: re-reads the log, so a corrupted audit log is reported
  const sandbox = () => { try { const s = sandboxFresh(); return { state: "CONNECTED", summary: s.summary(), history: s.history({ limit: 25 }).reverse() }; } catch (e) { return { state: "UNREADABLE", error: String(e.message) }; } };
  async function sandboxRun({ language, code, stdin } = {}) { sandboxFresh(); const r = await sandboxInst().run({ language, code, stdin }, { actor: "OWNER" }); if (/^INVALID/.test(r.status)) throw new Error(r.status); return r; }

  // A13 accessibility audit (static source checks). Targets: the Control Center's own three public files (fixed names) or text the owner pastes. It never fetches a URL, opens a path
  // the caller names, or runs the audited script; the engine runs in a worker thread with a hard timeout. A failed, timed-out or partial audit is never reported as clean.
  const A11Y_FIELDS = new Set(["target", "html", "css", "js"]), A11Y_MAX = 60000;
  async function a11yAudit(b = {}) {
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error("A11Y_BODY_MUST_BE_AN_OBJECT");
    for (const k of Object.keys(b)) if (!A11Y_FIELDS.has(k)) throw new Error("A11Y_UNSUPPORTED_FIELD:" + String(k).slice(0, 30));
    const target = b.target ?? "control-center"; if (target !== "control-center" && target !== "custom") throw new Error("A11Y_TARGET_INVALID");
    let input;
    if (target === "control-center") {
      if (b.html !== undefined || b.css !== undefined || b.js !== undefined) throw new Error("A11Y_TEXT_ONLY_WITH_CUSTOM_TARGET");
      const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "public"); input = {};
      for (const [k, f] of [["html", "index.html"], ["css", "style.css"], ["js", "app.js"]]) input[k] = fs.readFileSync(path.join(dir, f), "utf8"); input.cssSources = ["/style.css"];
    } else {
      input = { html: b.html ?? "", css: b.css ?? "", js: b.js ?? "" };
      for (const v of Object.values(input)) if (typeof v !== "string") throw new Error("A11Y_TEXT_MUST_BE_STRINGS");
      if (input.html.length + input.css.length + input.js.length > A11Y_MAX) throw new Error("A11Y_INPUT_TOO_LARGE");
    }
    let r = await new Promise(resolve => {
      let done = false, w; const fin = v => { if (done) return; done = true; clearTimeout(t); try { w?.terminate(); } catch { /* gone */ } resolve(v); };
      const t = setTimeout(() => fin({ ok: false, reason: "AUDIT_TIMEOUT" }), a11yTimeoutMs);
      try { w = new Worker(a11yWorkerUrl ?? new URL("../atlasz-addons/a11y-worker.mjs", import.meta.url), { workerData: input }); w.once("message", m => fin(m && typeof m === "object" ? (m.ok ? m.result : m) : { ok: false, reason: "AUDIT_ENGINE_FAILED" })); w.once("error", () => fin({ ok: false, reason: "AUDIT_ENGINE_FAILED" })); w.once("exit", () => fin({ ok: false, reason: "AUDIT_ENGINE_FAILED" })); } catch { fin({ ok: false, reason: "AUDIT_ENGINE_FAILED" }); }
    });
    if (!r || typeof r !== "object" || (r.ok !== true && r.ok !== false) || (r.ok && (typeof r.verdict !== "string" || !r.counts || typeof r.counts !== "object" || !Array.isArray(r.findings) || typeof r.complete !== "boolean")) || (!r.ok && typeof r.reason !== "string")) r = { ok: false, reason: "AUDIT_ENGINE_FAILED" };   // a worker answer of the wrong shape is a failure, never a result
    if (!r.ok) return { ok: false, verdict: "AUDIT_NOT_COMPLETED", reason: r.reason, note: "No result: a failed audit says nothing about accessibility." };
    return { ...r, target, wcagClaim: "NONE", note: "Automated static checks cover only part of WCAG (contrast of declared colours, document structure, some control names). They cannot establish compliance; manual keyboard and screen-reader testing is still required." };
  }
  const inboxMod = () => createUniversalInbox({ dir: path.join(stateDir, "inbox"), ownerAuth: ownerAuth() });
  const inbox = () => { const i = inboxMod(); return { counts: i.counts(), chain: i.verify(), items: i.list().slice(0, 100), note: "Drafts are never sent from here. Sending needs a proven connector, an open kill switch and your signed approval." }; };
  // Workbench (85-capability programme B0): conversations, analyst, previews, annotations, guidance, effort, chunking, detail policy. ATLASZ attaches NO model provider, so a conversation
  // "complete" honestly answers NO_ELIGIBLE_PROVIDER; nothing is fabricated, nothing is spent, and every call is gated by the kill switch.
  const wbGateway = () => createModelGateway({ resilience: createProviderResilience({ gate: x => emergency().gate(x), clock: () => Date.now(), timeoutMs: 15000 }), models: createModelIntelligence({ graph: createCapabilityGraph(), clockMs: () => Date.now() }) });
  let wbCache = null;                                   // ONE workbench per Control Center: workflow run-guards and batch state must be shared across requests
  const wbInst = () => (wbCache ??= createWorkbench({ ownerAuth: () => ownerAuth(), conversationFile: path.join(stateDir, "workbench", "conversations.json"), memoryFile: path.join(stateDir, "workbench", "project-memory.json"), notesFile: path.join(stateDir, "workbench", "notes.json"), tutorFile: path.join(stateDir, "workbench", "tutor.json"), workflowFile: path.join(stateDir, "workbench", "workflows.json"), skillsFile: path.join(stateDir, "workbench", "skills.json"), prefsFile: path.join(stateDir, "workbench", "preferences.json"), profilesFile: path.join(stateDir, "workbench", "profiles.json"), studyFile: path.join(stateDir, "workbench", "study.json"), suggestionsFile: path.join(stateDir, "workbench", "suggestions.json"), suggestionExtras: () => ({ approvals: [...approvalStore().pending().map(x => ({ id: x.id, action: x.operation ?? x.action })), ...createApprovalGateway({ dir: path.join(stateDir, "owner-control", "approvals"), ownerAuth: ownerAuth() }).pending().map(x => ({ id: x.id, action: x.operation }))], plugins: plugins().list().plugins }),
    gateway: wbGateway(), tenantId: KP_T, isStopped: () => emergency().status().mode !== "RUNNING" || safeMode().status().mode !== "NORMAL" }));
  async function workbench() {
    try { const w = wbInst(), g = wbGateway(); return { state: "CONNECTED", ops: w.ops, conversations: (await w.run("conv.list")).conversations, providers: g.summary(), note: "No model provider is attached: asking a model returns NO_ELIGIBLE_PROVIDER. Analysis, rendering, chunking and policy tools run locally and spend nothing." }; }
    catch (e) { return { state: "UNREADABLE", error: String(e.message) }; }
  }
  async function workbenchAction({ op, args } = {}) {
    if (emergency().status().mode !== "RUNNING" && /^(conv\.complete|(workflow\.(run|resume|batchRun|tick)|skill\.run))$/.test(String(op))) throw new Error("EMERGENCY_STOP_ACTIVE");
    let a = args ?? {};
    if (/^skill\.(activate|rollback|deactivate)$/.test(String(op))) {          // owner approval for skill changes: signed here from the passphrase, bound to this exact skill version and content, never accepted from the request
      const { passphrase, ownerApproval: _ignored, ...rest } = a; a = rest; const verb = String(op).slice(6).toUpperCase();
      if (typeof passphrase !== "string" || !passphrase) throw new Error("PASSPHRASE_REQUIRED");
      const sub = await wbInst().run("skill.subject", { verb, id: a.id, version: a.version }); if (!sub?.ok) throw new Error(String(sub?.reason ?? "FAILED"));
      a.ownerApproval = sign(passphrase, "SKILL_" + verb, sub.subject);
    }
    if (/^workflow\.(review|rewind|cancel)$/.test(String(op))) {              // these re-allow side-effecting steps or end work: a signed, subject-bound owner approval from the passphrase, never just the dashboard token
      const { passphrase, ...rest } = a; a = rest; const verb = String(op).slice(9).toUpperCase(), subject = String(a.id ?? "") + (a.stepId ? "#" + a.stepId : a.toStepId ? "#" + a.toStepId : "") + (verb === "REVIEW" ? ":" + String(a.decision ?? "") : "");
      if (typeof passphrase !== "string" || !passphrase) throw new Error("PASSPHRASE_REQUIRED");
      const v = ownerAuth().verifyApproval(sign(passphrase, "WORKFLOW_" + verb, subject), { action: "WORKFLOW_" + verb, subject }); if (!v.allowed) throw new Error("OWNER_APPROVAL_REQUIRED:" + v.reason);
    }
    if (/^profile\.(create|assign|remove|rollback)$/.test(String(op))) {      // a profile (or its assignment/removal) changes what an agent may do within the owner matrix: signed from the passphrase, bound to the exact change, never just the dashboard token
      const { passphrase, ...rest } = a; a = rest; const verb = String(op).slice(8).toUpperCase();
      const subject = verb === "ASSIGN" ? String(a.agentId ?? "") + "=" + String(a.profile ?? "") : verb === "ROLLBACK" ? String(a.id ?? "") + "#" + String(a.version ?? "") : verb === "CREATE" ? String(a.id ?? "") + ":" + createHash("sha256").update(JSON.stringify([a.name, a.instructions, a.tools, a.skills, a.memoryScopes])).digest("hex").slice(0, 16) : String(a.id ?? "");
      if (typeof passphrase !== "string" || !passphrase) throw new Error("PASSPHRASE_REQUIRED");
      const v = ownerAuth().verifyApproval(sign(passphrase, "PROFILE_" + verb, subject), { action: "PROFILE_" + verb, subject }); if (!v.allowed) throw new Error("OWNER_APPROVAL_REQUIRED:" + v.reason);
    }
    const r = await wbInst().run(String(op), a);
    if (!r || r.ok === false) throw new Error(String(r?.reason ?? "FAILED"));
    return r;
  }
  // Live Voice (owner view of the same conversation file as the runtime). No provider is attached by ATLASZ, so voice is never reported live here; owners can read and delete transcripts.
  const voiceInst = () => createVoiceConversation({ session: createVoiceSession({}), file: path.join(stateDir, "memory", "voice-conversations.json") });
  const voice = () => { const v = createVoiceSession({}); const st = v.status(); try { const c = voiceInst(); return { ...st, state: st.state, conversationStore: "CONNECTED", summary: c.summary({ tenantId: KP_T }), conversations: c.list({ tenantId: KP_T }).reverse().slice(0, 50), note: st.live ? null : "BLOCKED: no tested speech-to-text and text-to-speech provider is attached, so voice is not live. Voice can never approve anything. Transcripts are text only; raw audio is never stored." }; } catch (e) { return { ...st, conversationStore: "UNREADABLE", error: String(e.message), conversations: [], note: "Voice conversation store is unreadable and will not be replaced." }; } };
  function voiceAction({ op, id, ...a } = {}) {
    const c = voiceInst();
    switch (op) {
      case "get": { const g = c.get(id, { tenantId: KP_T }); if (!g) throw new Error("CONVERSATION_NOT_FOUND"); return g; }
      case "delete": return c.remove(id, { tenantId: KP_T });
      case "purge": return c.purgeExpired({ tenantId: KP_T });
      case "remember": { // transcript -> memory linkage: the OWNER chooses a turn; it becomes an ordinary observation (consent, retention, correction and deletion all apply). Nothing is linked automatically.
        const g = c.get(id, { tenantId: KP_T }); if (!g) throw new Error("CONVERSATION_NOT_FOUND"); const t = g.turns.find(x => x.n === a.turn); if (!t || !t.userText) throw new Error("TURN_NOT_FOUND");
        return obsInst().observe({ text: "Voice note: " + t.userText, kind: "CONTEXT", scope: "PERSONAL", tags: ["voice"], source: { type: "OWNER", ref: { conversationId: g.id, turn: t.n } } }, OW);
      }
      default: throw new Error("UNKNOWN_VOICE_OP");
    }
  }
  const connectors = () => { let vault; try { vault = createSecretVault({ dir: path.join(stateDir, "vault") }); } catch (e) { return { error: String(e.message), connectors: [] }; } return createConnectorCatalog({ vault }).health(); };
  const techWatch = () => createTechWatch({ feedDir: path.join(configDir, "tech-watch"), installed: () => uc().viewModel().components.map(c => ({ componentId: c.id, version: c.version })) }).scan();
  // ---- Update Center (same flow as the CLI/tests; no real detector adapters yet => honest BLOCKED) ----
  const plugins = () => createPluginManager({ roots: [path.join(configDir, "plugins"), path.join(packDir, "plugins")], stateDir: path.join(stateDir, "plugins"), ownerAuth: ownerAuth(), isStopped: () => emergency().status().mode !== "RUNNING" || safeMode().status().mode !== "NORMAL" });
  // Installer (M05): packages are read ONLY from <configDir>/plugin-inbox/<name> (a fixed folder; no arbitrary paths from the UI). Always owner-signed; installs DISABLED.
  const pluginInbox = path.join(configDir, "plugin-inbox");
  const installer = () => createPluginInstaller({ pluginRoot: path.join(configDir, "plugins"), stateDir: path.join(stateDir, "plugin-installer"), ownerAuth: ownerAuth(), pluginManager: plugins(), isStopped: () => emergency().status().mode !== "RUNNING" || safeMode().status().mode !== "NORMAL" });
  const inboxPkg = name => { const ins = installer(); if (!ins.nameOk(name)) throw new Error("PACKAGE_NAME_INVALID"); return { ins, dir: path.join(pluginInbox, String(name)) }; };
  const pluginView = () => {
    const base = plugins().list(), ins = installer(); let names = [];
    try { names = fs.readdirSync(pluginInbox, { withFileTypes: true }).filter(e => e.isDirectory() && ins.nameOk(e.name)).map(e => e.name).slice(0, 50); } catch { /* no inbox yet */ }
    return { ...base, inbox: names.map(name => { const r = ins.inspectPackage(path.join(pluginInbox, name)); return r.ok ? { name, ok: true, id: r.manifest.id, version: r.manifest.version, kind: r.manifest.kind, permissions: r.manifest.permissions, files: r.fileCount, hash: r.hash } : { name, ok: false, problems: r.problems.slice(0, 5) }; }), installed: base.plugins.map(x => ({ id: x.id, ...installer().versions(x.id) })) };
  };
  // MCP servers (C06 slice): folders under <configDir>/mcp-servers/<id>/ with mcp-server.json {entry, description}. Starting a server and every tool call need the owner's passphrase (approval bound to content hash / exact arguments).
  let mcpCache = null; const mcpRejected = new Map();
  const mcpInst = () => (mcpCache ??= createMcpClient({ stateDir: path.join(stateDir, "mcp"), ownerAuth: ownerAuth(), isStopped: () => emergency().status().mode !== "RUNNING" || safeMode().status().mode !== "NORMAL" }));
  const mcpRoot = path.join(configDir, "mcp-servers");
  function mcpScan() {
    const c = mcpInst(); let names = []; try { names = fs.readdirSync(mcpRoot, { withFileTypes: true }).filter(e => e.isDirectory() && /^[a-z][a-z0-9-]{1,39}$/.test(e.name)).map(e => e.name).slice(0, 40); } catch { /* no folder yet */ }
    for (const name of names) {
      if (c.list().some(x => x.id === name)) continue;
      let cfg; try { const f = path.join(mcpRoot, name, "mcp-server.json"); if (fs.statSync(f).size > 4096) throw new Error("big"); cfg = JSON.parse(fs.readFileSync(f, "utf8")); } catch { mcpRejected.set(name, ["MCP_SERVER_JSON_MISSING_OR_INVALID"]); continue; }
      const r = c.register({ id: name, dir: path.join(mcpRoot, name), entry: cfg?.entry, description: cfg?.description ?? "" }); if (r.ok) mcpRejected.delete(name); else mcpRejected.set(name, [r.reason, ...(r.problems ?? [])]);
    }
    return c;
  }
  const mcp = () => { const c = mcpScan(); return { servers: c.list(), rejected: [...mcpRejected].map(([name, problems]) => ({ name, problems })), note: "Local MCP stdio servers only. Starting one runs foreign code (read-only folder, no network, no child processes) and needs your passphrase; every tool call needs a fresh approval for the exact arguments. Results are untrusted data." }; };
  const mcpActions = {
    start: ({ id, passphrase }) => act(async () => { const c = mcpScan(), dir = path.join(mcpRoot, String(id)), h = packageHash(dir); if (!h.ok) return { ok: false, reason: "DIR_REJECTED" }; return c.start(String(id), { ownerApproval: passphrase ? sign(passphrase, "MCP_SERVER_START", String(id) + "#" + h.hash) : null }); }),
    call: ({ id, tool, args = {}, passphrase }) => act(async () => { const c = mcpScan(); return c.callTool(String(id), String(tool), args, { ownerApproval: passphrase ? sign(passphrase, "MCP_TOOL_CALL", c.callSubject(String(id), String(tool), args)) : null }); }),
    stop: ({ id }) => act(() => mcpScan().stop(String(id)))
  };
  // ---- repositories (C01 slice): folders under <configDir>/repos/<name>; analysis is read-only, test runs need the owner's signed approval bound to the analysed content
  const repoRoot = path.join(configDir, "repos"), REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
  const repos = () => { let names = []; try { names = fs.readdirSync(repoRoot, { withFileTypes: true }).filter(e => e.isDirectory() && REPO_NAME.test(e.name)).map(e => e.name).slice(0, 50); } catch { /* none yet */ } return { repos: names, note: "Put a repository folder under the ATLASZ config 'repos' folder. Analysis only reads; running its tests needs your passphrase and happens in a read-only, no-network, no-child-process sandbox. It cannot edit, install, push or open pull requests." }; };
  const repoActions = {
    analyze: ({ name }) => act(() => { if (typeof name !== "string" || !REPO_NAME.test(name)) return { ok: false, reason: "REPO_NAME_INVALID" }; return analyzeRepo(path.join(repoRoot, name)); }),
    test: ({ name, passphrase }) => act(async () => {
      if (typeof name !== "string" || !REPO_NAME.test(name)) return { ok: false, reason: "REPO_NAME_INVALID" };
      const root = path.join(repoRoot, name), a = analyzeRepo(root); if (!a.ok) return a;
      return runRepoTests({ name, root, ownerAuth: ownerAuth(), ownerApproval: passphrase ? sign(passphrase, "REPO_TEST_RUN", name + "#" + a.hash) : null, isStopped: () => emergency().status().mode !== "RUNNING" || safeMode().status().mode !== "NORMAL" });
    })
  };
  let protoInst = null; const protos = () => (protoInst ??= createPrototypeBuilder({ repoRoot, file: path.join(stateDir, "workbench", "prototypes.json"), isStopped: () => emergency().status().mode !== "RUNNING" || safeMode().status().mode !== "NORMAL" }));
  const prototypes = () => { try { const b = protos(); return { state: "CONNECTED", templates: b.templates(), prototypes: b.list(), note: "Sandbox prototypes from fixed templates, with generated tests. A prototype is only marked tested after its own tests passed in the restricted sandbox with your signed approval. Nothing is deployed or published." }; } catch (e) { return { state: "UNREADABLE", reason: String(e.message).slice(0, 80) }; } };
  const prototypeActions = {
    preview: spec => act(() => protos().preview(spec)),
    generate: spec => act(() => protos().generate(spec, { actor: "OWNER" })),
    status: ({ name }) => act(() => protos().status(name)),
    previewPage: ({ name }) => act(() => protos().previewPage(name)),
    test: ({ name, passphrase }) => act(async () => {
      if (typeof name !== "string" || !REPO_NAME.test(name)) return { ok: false, reason: "REPO_NAME_INVALID" };
      const a = analyzeRepo(path.join(repoRoot, name)); if (!a.ok) return a;
      return protos().test(name, { ownerAuth: ownerAuth(), ownerApproval: passphrase ? sign(passphrase, "REPO_TEST_RUN", name + "#" + a.hash) : null, isStopped: () => emergency().status().mode !== "RUNNING" || safeMode().status().mode !== "NORMAL" });
    })
  };
  const pluginActions = {
    install: ({ name, passphrase }) => act(() => { const { ins, dir } = inboxPkg(name), p = ins.inspectPackage(dir); if (!p.ok) return { ok: false, reason: "PACKAGE_REJECTED", problems: p.problems.slice(0, 10) }; return ins.install(dir, { ownerApproval: passphrase ? sign(passphrase, "PLUGIN_INSTALL", p.subject) : null }); }),
    rollback: ({ id, version, passphrase }) => act(() => { const ins = installer(), s = ins.rollbackSubject(id, version); return ins.rollback(id, version, { ownerApproval: passphrase && s ? sign(passphrase, "PLUGIN_ROLLBACK", s) : null }); }),
    uninstall: ({ id, passphrase }) => act(() => installer().uninstall(id, { ownerApproval: passphrase ? sign(passphrase, "PLUGIN_UNINSTALL", id) : null })),
    enable: ({ id, passphrase }) => act(() => { const pm = plugins(), sub = pm.enableSubject(id); return pm.enable(id, { ownerApproval: passphrase ? sign(passphrase, "PLUGIN_ENABLE", sub ?? id) : null }); }),
    /** Run one hook of an ENABLED plugin. The manager still enforces: enabled by a code-hash-bound owner approval, exact code unchanged, not quarantined, kill switch / Safe Mode off, isolated child with the granted permissions only.
     *  The plugin's answer is untrusted data: credential-shaped text is redacted and the size is capped before it reaches the console. */
    invoke: async ({ id, hook, input = {} } = {}) => {
      if (typeof id !== "string" || !/^[a-z][a-z0-9._-]{0,59}$/.test(id)) return { ok: false, error: "PLUGIN_ID_INVALID" };
      if (typeof hook !== "string" || !/^[a-z][a-z0-9._-]{0,39}$/.test(hook)) return { ok: false, error: "HOOK_INVALID" };
      let js; try { js = JSON.stringify(input ?? {}); } catch { return { ok: false, error: "INPUT_NOT_JSON" }; } if (!input || typeof input !== "object" || Array.isArray(input) || js.length > 10000) return { ok: false, error: "INPUT_INVALID_OR_TOO_LARGE" };
      const r = await plugins().invoke(id, hook, JSON.parse(js)); if (!r.ok) return { ok: true, result: r };
      let out = JSON.stringify(r.result ?? null); if (out.length > 20000) return { ok: true, result: { ok: false, reason: "RESULT_TOO_LARGE" } };
      const deep = (v, d = 0) => (typeof v === "string" ? scrub(v) : d > 20 ? "[TOO_DEEP]" : Array.isArray(v) ? v.map(x => deep(x, d + 1)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [scrub(k), deep(x, d + 1)])) : v);   // redact per string so the JSON stays well-formed
      return { ok: true, result: { ok: true, result: deep(JSON.parse(out)), untrusted: true } };
    },
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
    const report = createSystemDoctor({ probes }).run();
    // Informational (does not change `overall`): fail-closed means a host without a process sandbox is SAFE but runs no plugin hooks / update self-tests. The owner should see that, not discover it.
    const r = detectNodeRestrictions();
    report.components.process_sandbox = { informational: true, ...(!r.permission ? { state: "BLOCKED", detail: "Node --permission unavailable on this host: plugin hooks and update self-tests will NOT run (fail closed)" } : !r.namespace ? { state: "DEGRADED", detail: "filesystem/process restriction active; NO network isolation on this platform (" + r.platform + ")" } : { state: "HEALTHY", detail: "filesystem/process restriction + network namespace" }) };
    return report;
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
  const memoryPanel = createMemoryPanel({ stateDir, ownerAuth: () => ownerAuth(), sign: (p, a, s) => sign(p, a, s), fetchImpl });
  const memory = () => { try { return memoryPanel.view(); } catch (e) { return { state: "ERROR", error: String(e?.message ?? e).slice(0, 200) }; } };
  const memoryAction = b => memoryPanel.action(b ?? {});
  // Provider credentials live ONLY in the encrypted vault (<state>/vault); the model panel receives a resolver that reads one at call time and a presence check. No vault/key -> no credential -> cloud calls fail closed.
  let modelVault = null;
  const vaultOrNull = () => { try { return (modelVault ??= createSecretVault({ dir: path.join(stateDir, "vault") })); } catch { return null; } };
  const modelCredentialPresent = ref => { try { return Boolean(ref && vaultOrNull()?.has(ref)); } catch { return false; } };
  const modelCredential = ref => { try { const v = vaultOrNull(); return v && ref && v.has(ref) ? v.get(ref, { purpose: "model-provider-call" }) : null; } catch { return null; } };
  const modelRegPanel = createModelRegistryPanel({ credentialResolver: modelCredential, hasCredential: modelCredentialPresent, cloudFetch, cloudResolve, stateDir, ownerAuth: () => ownerAuth(), sign: (p, ac, su) => sign(p, ac, su), isStopped: () => emergency().status().mode !== "RUNNING" || safeMode().status().mode !== "NORMAL", ollamaFetch });
  const modelRegistry = () => { try { return modelRegPanel.view(); } catch (e) { return { state: "ERROR", error: String(e?.message ?? e).slice(0, 200) }; } };
  const modelRegistryAction = b => modelRegPanel.action(b ?? {});
  // Phase 5: the 30 permanent agents. Approval requests go to the same store as every other owner approval; memory and model access reuse the memory panel's agent gateway and the model bridge (no paid usage: budgets default to 0).
  let masterLoop = null;
  // UNIFIED OWNER CONTROL IN THE RUNTIME PATH (DEF-003): owner authority -> kill switch -> safe mode -> security brain -> financial firewall (NO-SPEND default) -> owner approval -> black box,
  // plus the 5+25 agent governor. The Master asks this chain before every dispatch, resume, reassignment and any model spend. Kill switch / safe mode are read fresh from their state files on each call.
  let ocCache = null, ocBlackBox = null;
  const ownerControl = () => (ocCache ??= (() => {
    const bb = (ocBlackBox = createBlackBox({ filePath: path.join(ccBrainDir, "control-blackbox.jsonl") })), sm = { gate: o => safeMode().gate(o), status: () => safeMode().status() };
    const sec = createSecurityBrain({ ownerAuth: ownerAuth(), safeMode: sm, blackBox: bb });
    return createOwnerControlSystem({ dir: path.join(ccBrainDir, "owner-control"), ownerAuth: ownerAuth(), gate: x => emergency().gate(x), emergencyStatus: () => emergency().status(), safeMode: sm, security: sec, blackBox: bb, verifier: createVerifier({}),
      roster: AGENT_ROSTER.map(id => ({ id, team: id.startsWith("SEARCH") ? "SEARCH" : "EXECUTION" })), tools: Object.keys(BUILTIN_TOOLS), sources: mapRecoverySources({ dataDir: stateDir, appDir: path.resolve(HERE, "..") }).sources });
  })());
  const masterGuard = ({ kind, agentId, spendUsd = 0, params = {} }) => {
    const a = ownerControl().agents;
    return kind === "MODEL_SPEND" ? a.act(agentId, "SPEND", { external: true, spendUsd, params }) : a.act(agentId, "INTERNAL_COMPUTE", { params, tool: params.tool });
  };
  const controlStatus = () => { const s = ownerControl().status(); return { attached: true, decisions: s.decisions, controlledPaths: s.controlledPaths, financialFirewall: s.financialFirewall, killSwitch: s.killSwitch, safeMode: s.safeMode?.mode ?? s.safeMode }; };
  const agentsPanel = createAgentsPanel({ brainWorkflow: a => brainWorkflow(a), brainWorkflows: () => brainWorkflows(), controlGuard: masterGuard, controlStatus, loop: () => masterLoop, stateDir, ownerAuth: () => ownerAuth(), sign: (p, a, s) => sign(p, a, s), isStopped: () => emergency().status().mode !== "RUNNING" || safeMode().status().mode !== "NORMAL", approvals: { request: q => approvalStore().request(q), outcome: id => approvalStore().outcome(id) }, memory: () => { try { return memoryPanel.agentMemory(); } catch { return null; } }, models: { complete: a => modelRegPanel.action({ op: "ask", agentId: a.agentId, prompt: a.prompt, capability: a.capability, maxCostUsd: a.maxCostUsd }), assignmentOf: () => null },
    // Master Coordinator wiring: live model/cost view, pending-approval count, and real health probes for the managers that live in the host (nothing here grants authority; they only report).
    modelView: () => modelRegPanel.view(), approvalsPending: () => { let n = 0; try { n += approvalStore().pending().length; } catch { /* store unavailable: counted as 0 */ } return n; },
    hostProbes: {
      BRAIN_MANAGER: async () => { const b = brainSystem(), sm = b.summary(), h = b.health(); const ok = sm.orchestrator === "READY" && sm.blackBox.chain && sm.governanceAudit; return { ok, detail: ok ? "orchestrator READY, black box chain intact, governance audit intact; topology " + sm.topology.search + "+" + sm.topology.execution : "brain degraded: orchestrator " + sm.orchestrator + ", blackBox chain " + sm.blackBox.chain + ", governance audit " + sm.governanceAudit, data: { plans: sm.plans, capabilityGraph: sm.capabilityGraph } }; },
      SECURITY_APPROVAL_MANAGER: async () => { const k = keystoreStatus(configDir), a = ownerAuth().status().state; return { ok: !!k.provisioned && a === "LIVE", detail: k.provisioned ? "owner key provisioned, owner auth " + a : "no owner key provisioned: every approval-gated action stays blocked", data: { ownerAuthState: a } }; },
      TASK_SCHEDULER: async () => { ensureStandingSchedules(); const sm = scheduler().summary(), bad = (sm.byState.FAILED ?? 0) + (sm.byState.PAUSED_BY_FAILURES ?? 0), ml = masterLoop?.status?.() ?? null; const ok = sm.total > 0 && bad === 0 && (!ml || ml.state !== "ESCALATED"); return { ok, detail: ok ? sm.total + " schedule(s), none failed; delivery AT_LEAST_ONCE; driven by the Master loop" : sm.total === 0 ? "no schedules" : bad + " schedule(s) failed or paused by failures", data: { jobs: sm.total, byState: sm.byState, nextDue: sm.nextDue } }; },
      RUNTIME_SUPERVISOR: async () => { const alive = !!child && childExit == null; return { ok: alive, detail: alive ? "runtime supervisor child process running" : "runtime supervisor not running (start it from the Control Center)", data: { running: alive } }; },
      RECOVERY_MAINTENANCE: async () => { const bk = backups(), d = drills().at(-1) ?? null; return { ok: bk.items.length > 0 && !bk.items.some(b => !b.ok) && d?.ok === true, detail: !bk.items.length ? "no backup exists" : bk.items.some(b => !b.ok) ? "a backup is corrupt" : d?.ok ? "backup verified, restore drill passed" : "restore drill not yet passed", data: { backups: bk.items.length } }; }
    } });
  // BRAIN (Phase 4): one Brain System for the Control Center process (its own directory: the runtime process owns <state>/brain), governed by the same control chain; the bridge carries the owner workflow through the Master.
  let brainCache = null, bridgeCache = null;
  const brainSystem = () => (brainCache ??= createBrainSystem({ dir: path.join(ccBrainDir, "brain"), ownerAuth: ownerAuth(), roster: AGENT_ROSTER.map(id => ({ id, team: id.startsWith("SEARCH") ? "SEARCH" : "EXECUTION" })), gate: x => emergency().gate(x), safeMode: { gate: o => safeMode().gate(o), status: () => safeMode().status() }, chain: ownerControl().chain }));
  const brainBridge = () => (bridgeCache ??= createBrainMasterBridge({ master: agentsPanel.masterRef(), brain: brainSystem(), dir: path.join(ccBrainDir, "bridge") }));
  const brainWorkflow = a => brainBridge().runWorkflow(a), brainWorkflows = () => brainBridge().workflows();
  // MONEY ENGINE (Phase 9): hosted by the Control Center in its own store (<state>/money-cc) so it never shares files with the runtime child's <state>/money. LIVE label, NO send/deliver adapters: nothing can leave the machine from here.
  let moneyCache = null, inboxPipeCache = null, revPersistCache = null;
  const money = () => { if (!moneyCache) { moneyCache = createMoneyEngine({ dir: path.join(stateDir, "money-cc"), ownerAuth: ownerAuth(), brain: brainSystem(), environment: "LIVE", adapters: {}, extract: raw => qualify({ title: raw.title, description: raw.text, published: raw.published }) });
    try { moneyCache.engines.payments.registerAuthority(paymentEvents().authority()); } catch { /* the engine keeps working without an authority: payments stay unverified */ } } return moneyCache; };
  // ---- verified payment events (Stripe-compatible). The webhook secret is read from the sealed vault only inside this process; without it every event is refused (Stripe is deferred). Receive-only: no money movement exists here. ----
  let payEvCache = null;
  const paymentEvents = () => (payEvCache ??= createPaymentEventLedger({ dir: path.join(stateDir, "payment-events"), environment: "LIVE", secretFor: (provider, env) => { try { return vaultOrNull()?.get(provider + "_webhook_secret_" + String(env).toLowerCase(), { purpose: "payment webhook signature verification" }) ?? null; } catch { return null; } },
    onSecurityEvent: e => { ownerAlerts.push({ at: e.at, level: "CRITICAL", kind: "PAYMENT_WEBHOOK_" + e.type, text: "payment webhook security event: " + e.type }); if (ownerAlerts.length > 200) ownerAlerts.shift(); } }));
  const ingestPaymentWebhook = a => paymentEvents().ingest(a);
  const inboxPipeline = () => (inboxPipeCache ??= createInboxPipeline({ inbox: inboxMod(), security: brainSystem().security, graph: brainSystem().entityGraph, tenantId: "ATLASZ", file: path.join(stateDir, "inbox", "pipeline-cc.json"), blackBox: brainSystem().blackBox, lookups: { deal: id => money().engines.deals.get(id), job: id => money().engines.jobs.get(id) }, handlers: { recordReply: (dealId, inbound) => money().recordReply(dealId, inbound) } }));
  const revenuePersistence = () => (revPersistCache ??= createRevenuePersistence({ dir: path.join(stateDir, "revenue-persistence"), ownerAuth: ownerAuth() }));
  // MODULE BROKER (Phase 2/3): modules register a spec + typed capabilities; every call goes through the typed-tool registry -> unified control chain. Built lazily so start-up cost is nil.
  let brokerCache = null, toolsCache = null, schedCache = null, credBroker = null;
  const toolRegistry = () => (toolsCache ??= (() => { const oc = ownerControl(); return createToolRegistry({ chain: oc.chain, blackBox: ocBlackBox }); })());
  const scheduler = () => (schedCache ??= createScheduler({ file: path.join(stateDir, "scheduler", "schedules-cc.json"), tools: toolRegistry(), gate: x => emergency().gate(x), blackBox: (ownerControl(), ocBlackBox) }));
  // The credential broker is the ONLY path from an agent to a vault secret: grant-bound (host, method, agent/role, expiry), spend-free, audited, with the vault read through the same sealed vault the owner manages.
  const credentialBroker = () => (credBroker ??= createCredentialBroker({ vault: { has: n => { try { return !!vaultOrNull()?.has(n); } catch { return false; } }, get: (n, o) => vaultOrNull().get(n, o) }, ownerAuth: ownerAuth(), fetchImpl, gate: x => emergency().gate(x), stateDir: path.join(stateDir, "credential-broker"), isKnownAgent: id => AGENT_ROSTER.includes(id) }));
  // AGENT TOOL BROKER (CC-hosted): the only path from one of the 30 agents to a typed module tool. Approval-class tools only ever ASK (owner decides); base policy + pending-review extension (D12).
  let twinCache = null;
  const digitalTwin = () => (twinCache ??= createDigitalTwin({ ownerAuth: ownerAuth() }));
  // The ONE adapter by which Brain reasoning engines reach models: AI Model Manager bridge (registry > egress > gateway > billing guard). Brain is not an agent: it asks as the Master.
  const modelAdapter = () => async ({ role, prompt }) => { const r = await modelRegPanel.action({ op: "ask", agentId: "MASTER", prompt, capability: "text", maxCostUsd: 0 }); if (!r?.ok || typeof r.output !== "string") throw Object.assign(new Error(r?.reason ?? "NO_ELIGIBLE_MODEL"), { code: r?.reason ?? "NO_ELIGIBLE_MODEL" }); return { text: r.output, family: String(r.family ?? r.providerId ?? "unknown") }; };
  const usableModelCount = () => { try { return (modelRegPanel.view().models ?? []).filter(m => m.live === true && m.enabled !== false).length; } catch { return 0; } };
  let srcAllowCache = null, capProfCache = null;
  const sourceAllowlist = () => (srcAllowCache ??= createSourceAllowlist({ ownerAuth: ownerAuth(), stateDir: path.join(stateDir, "source-allowlist"), isStopped: () => emergency().status().mode !== "RUNNING" || safeMode().status().mode !== "NORMAL", hasCredential: n => { try { return !!vaultOrNull()?.has(n); } catch { return false; } } }));
  const capabilityProfiles = () => (capProfCache ??= createCapabilityProfileStore({ ownerAuth: ownerAuth(), dir: path.join(stateDir, "capability-profile") }));
  let agentToolCache = null; const agentToolSignals = [];
  const agentToolBroker = () => (agentToolCache ??= (() => { const oc = ownerControl(); return createAgentToolBroker({ tools: toolRegistry(), blackBox: ocBlackBox, approvalRequests: approvalStore(), approvalAction: approvalActionName, approvalSubject: (op, p, spend) => oc.chain.subjectFor(op, p, spend), isStopped: () => emergency().status().mode !== "RUNNING" || safeMode().status().mode !== "NORMAL", onSignal: sig => { agentToolSignals.push({ at: new Date().toISOString(), ...sig }); if (agentToolSignals.length > 100) agentToolSignals.shift(); try { if (sig.type === "BYPASS_ATTEMPT") incidentResponse().declare({ kind: "REPEATED_POLICY_BYPASS_ATTEMPT", severity: "HIGH", confirmed: true, agentId: sig.agentId, detail: "refused tool calls in a row: " + sig.refusals, evidence: sig }); else if (sig.type === "SECRET_IN_TOOL_OUTPUT") incidentResponse().declare({ kind: "SECRET_IN_TOOL_OUTPUT", severity: "HIGH", confirmed: true, agentId: sig.agentId, tool: sig.tool, detail: "a tool returned credential-shaped data (redacted before reaching the agent)", evidence: sig }); } catch { /* containment failure is surfaced by incidentResponse().open(); never throw into the broker */ } },
      isBlocked: a => incidentResponse().isBlocked(a), policy: d12Active() ? COMBINED_POLICY : TOOL_POLICY }); })());
  const moduleBroker = () => (brokerCache ??= (() => {
    const b = createModuleBroker({ tools: toolRegistry(), managers: MANAGER_IDS, audit: (e, d) => { try { agentsPanel.loopEvent("MODULE:" + e, d); } catch { /* audit is best-effort here; the control chain audits the decision itself */ } } });
    const ctx = { incidentResponse, fileIntake, intakeStatus, paymentEvents, modelPanel: () => modelRegPanel, runtimeStatus: async () => (await status()).runtime, runtimeRunning: () => Boolean(child && child.exitCode === null && child.signalCode === null), ownerAuthOrNull: () => { try { return ownerAuth(); } catch { return null; } }, brainSystem, digitalTwin, modelAdapter, usableModelCount, sourceAllowlist, capabilityProfiles, agentToolBroker, workforceTasks: () => { try { return agentsPanel.workforce()?.listTasks?.() ?? []; } catch { return []; } }, money, inboxPipeline, revenuePersistence, backups: () => backups(), backupNow: a => backupNow(a), drill: () => drill(), lastDrill: () => drills().at(-1) ?? null, ownerControl, stateDir, appDir: path.resolve(HERE, ".."), credentialBroker, scheduler, superviseNow: () => agentsPanel.superviseNow() };
    registerSafety(b, ctx); registerSecurity(b, ctx); registerRuntime(b, ctx); registerBusiness(b, ctx); registerWorkflow(b, ctx); registerAgents(b, ctx); registerDiscovery(b, ctx); registerBrain(b, ctx); registerTools(b, ctx); registerModels(b, ctx); return b;
  })());
  const modules = async ({ health = false } = {}) => { const b = moduleBroker(); if (health) await b.healthAll(); return { summary: b.summary(), catalog: b.catalog() }; };
  const superviseMaster = () => agentsPanel.superviseNow();
  // Master supervision loop (DEF-002): one tick at a time, stuck ticks detected, bounded restarts, ESCALATED when it keeps failing; every change is in the Master audit chain.
  // Standing schedules the system registers for itself (idempotent by name). They only call registered tools, so every run is gated by the control chain.
  const STANDING = [{ name: "State backup: daily", kind: "INTERVAL", spec: { everyMs: 86400000 }, tool: "state_backup.create" }, { name: "State backup: restore drill", kind: "INTERVAL", spec: { everyMs: 86400000 }, tool: "state_backup.drill" }, { name: "Master: module health sweep", kind: "INTERVAL", spec: { everyMs: 900000 }, tool: "master_runtime.module_health" }, { name: "Recovery: verify latest backups", kind: "INTERVAL", spec: { everyMs: 21600000 }, tool: "recovery_points.verify" }];
  const ensureStandingSchedules = () => { moduleBroker(); const have = new Set(scheduler().list().map(j => j.name)); for (const s of STANDING) if (!have.has(s.name)) scheduler().create({ ...s, createdBy: "MASTER" });
    // first run: a system with no backup at all must not wait a day for its first restore point and drill
    if (!backups().items.length) for (const [n, tool, delay] of [["State backup: first restore point", "state_backup.create", 5000], ["State backup: first restore drill", "state_backup.drill", 15000]]) if (!have.has(n)) scheduler().create({ name: n, kind: "ONCE", spec: { at: new Date(Date.now() + delay).toISOString() }, tool, createdBy: "MASTER" }); };
  const runDueSchedules = async () => { try { ensureStandingSchedules(); return await scheduler().tick(); } catch (e) { agentsPanel.loopEvent("SCHEDULER_TICK_FAILED", { error: String(e?.message ?? e).slice(0, 160) }); return null; } };
  const startMasterLoop = (intervalMs = 60000) => { masterLoop ??= createTickLoop({ run: async () => { const r = await agentsPanel.superviseNow(); await runDueSchedules(); return r; }, intervalMs, onEvent: (t, d) => agentsPanel.loopEvent(t, d) }); return masterLoop.start(); };
  const stopMasterLoop = () => { const r = masterLoop?.stop() ?? null; agentsPanel.close(); return r; }, masterLoopStatus = () => masterLoop?.status() ?? null;
  const stoppedNow = () => emergency().status().mode !== "RUNNING" || safeMode().status().mode !== "NORMAL";
  const vaultPanel = createVaultPanel({ stateDir, ownerAuth: () => ownerAuth(), sign: (p, a, s) => sign(p, a, s), isStopped: stoppedNow });
  const vaultView = () => { try { return vaultPanel.view(); } catch (e) { return { state: "ERROR", error: String(e?.message ?? e).slice(0, 200) }; } };
  const vaultAction = b => vaultPanel.action(b ?? {});
  const chatPanel = createChatProvidersPanel({ stateDir, inbox: { ingest: (...a) => inboxMod().ingest(...a) }, vaultHas: n => { try { return vaultPanel.has?.(n) ?? false; } catch { return false; } }, isStopped: stoppedNow });
  const chatProviders = () => { try { return chatPanel.view(); } catch (e) { return { state: "ERROR", error: String(e?.message ?? e).slice(0, 200) }; } };
  const chatProvidersAction = b => chatPanel.action(b ?? {});
  const agents30 = () => { try { return agentsPanel.view(); } catch (e) { return { state: "ERROR", error: String(e?.message ?? e).slice(0, 200) }; } };
  const agents30Action = b => agentsPanel.action(b ?? {});
  const security = () => { try { return secPanel.view(); } catch (e) { return { state: "ERROR", error: String(e?.message ?? e).slice(0, 200) }; } };
  const securityAction = b => secPanel.action(b ?? {});
  // M6: trading research / simulated paper trading panel, live agent activity, operations and revenue dashboards (all read from real sources; nothing is invented).
  const tradingPanel = createTradingPanel({ stateDir, ownerAuth: () => ownerAuth(), sign: (p, a, s) => sign(p, a, s), isStopped: () => emergency().status().mode !== "RUNNING" || safeMode().status().mode !== "NORMAL" });
  const trading = () => tradingPanel.view(), tradingCandles = q => tradingPanel.candles(q ?? {}), tradingAction = b => tradingPanel.action(b ?? {}), tradingTick = () => tradingPanel.tick({ candlesPerStrategy: 1 });
  const ops = createOpsViews({ stateDir, status, finance, approvals, tradingView: trading, memoryView: memory, ledgerEntries: () => createFinancialLedger({ dir: path.join(stateDir, "ledger") }).entries() });
  return { agentSupervision, paymentEvents, ingestPaymentWebhook, intakeFile, intakeStatus, fileIntake, incidentResponse, ownerAlerts: () => ownerAlerts.slice(), d12Status, activateD12, revenueOps, portableBackup, portableVerify, portableRestoreRehearsal, agentToolBroker, trading, tradingCandles, tradingAction, tradingTick, agentsActivity: ops.agents, agentActivityOne: ops.agent, operations: ops.operations, revenueDashboard: ops.revenue, memory, memoryAction, modelRegistry, modelRegistryAction, security, securityAction, agents30, agents30Action, superviseMaster, startMasterLoop, stopMasterLoop, masterLoopStatus, money, brainSystem, brainWorkflow, brainWorkflows, runDueSchedules, moduleBroker, modules, scheduler, credentialBroker, vaultView, vaultAction, chatProviders, chatProvidersAction, prototypes, prototypeActions, pcc, pccAction, knowledge, knowledgeAction, research, researchAction, observations, observationsAction, voiceAction, workbench, workbenchAction, a11yAudit, media, sandbox, sandboxRun, moneyEngine: () => moneyViews.money(), moneyJobs: () => moneyViews.jobs(), moneyAgents: () => moneyViews.agents(), moneyRecurring: () => moneyViews.recurring(), crmInbox: () => moneyViews.crmInbox(), ownerSafety, ownerSafetyAction, doctorV2, brain: () => brainViews.all(), brainCommand, documents, inbox, voice, connectors, techWatch, mobile: req => mobile().handle(req), brief, chat, prefs, setPrefs, plugins: () => pluginView(), mcp, mcpActions, repos, repoActions, theme: () => plugins().activeTheme(), pluginActions, finance, evidence, status, opportunities, approvals, decideApproval, provisionOwnerKey, setEmergency, exitSafeMode, startRuntime, stopRuntime, backups, backupNow, drill, markLastKnownGood,
    restoreLastKnownGood, restoreFromBackup, doctor, updates, updateActions, LKG_CRITERIA };
}
