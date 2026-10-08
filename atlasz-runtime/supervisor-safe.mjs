import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createEvidenceSources } from "../atlasz-addons/brain/evidence-sources.mjs";
import { mapRecoverySources } from "../atlasz-addons/owner-control/recovery-source-map.mjs";
import { createInternalAddonHub } from "../atlasz-addons/internal-integration-hub.mjs";
import { emergencyGate, emergencyStatus } from "../atlasz-addons/emergency-stop.mjs";
import { createDurableQueue } from "../atlasz-addons/durable-queue.mjs";
import { createSafeMode } from "../atlasz-addons/safe-mode.mjs";
import { createWatchdog } from "../atlasz-addons/watchdog.mjs";
import { runStartupSelfCheck } from "../atlasz-addons/startup-self-check.mjs";
import { createFinancialLedger } from "../atlasz-addons/financial-ledger.mjs";
import { createSecretVault } from "../atlasz-addons/secret-vault.mjs";
import { createApprovalRequests } from "../atlasz-addons/approval-requests.mjs";
import { getDefaultOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createBrainSystem } from "../atlasz-addons/brain/brain-system.mjs";
import { createSearchPipeline } from "../atlasz-addons/brain/search-pipeline.mjs";
import { createMoneyEngine } from "../atlasz-addons/business/money-engine.mjs";
import { createUniversalInbox } from "../atlasz-addons/universal-inbox.mjs";
import { createProviderResilience } from "../atlasz-addons/provider-resilience.mjs";
import { createModelGateway } from "../atlasz-addons/model-gateway.mjs";
import { createScheduler } from "../atlasz-addons/scheduler.mjs";
import { createPersonalCommandCenter, registerPccTools } from "../atlasz-addons/personal-command-center.mjs";
import { createDocumentCenter } from "../atlasz-addons/document-center.mjs";
import { createKnowledgeProjects } from "../atlasz-addons/knowledge-projects.mjs";
import { createResearchLedger } from "../atlasz-addons/research-ledger.mjs";
import { createCodeSandbox, registerSandboxTools } from "../atlasz-addons/code-sandbox.mjs";
import { createModalityFabric, registerModalityTools } from "../atlasz-addons/modality-fabric.mjs";
import { createRuntimeHandler } from "./runtime-http.mjs";
import { createVoiceSession } from "../atlasz-addons/voice-session.mjs";
import { createVoiceConversation, registerVoiceTools } from "../atlasz-addons/voice-conversation.mjs";
import { createObservationMemory, registerObservationTools, registerResearchCapture } from "../atlasz-addons/observation-memory.mjs";
import { createToolRegistry } from "../atlasz-addons/typed-tools.mjs";
import { createInboxPipeline } from "../atlasz-addons/business/inbox-pipeline.mjs";
import { createOwnerControlSystem } from "../atlasz-addons/owner-control/owner-control-system.mjs";

export const VERSION = "3.3.0";
const now = () => new Date().toISOString();
const clean = x => String(x || "").replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const topics = ["website", "automation", "data", "translation", "video", "spreadsheet", "API", "research", "design", "testing"];
const queryLanes = ["freelance", "contract project", "looking for developer", "need help website", "paid project"];
export function qualify(candidate) {
  const text = clean(candidate.title + " " + candidate.description);
  const age = Date.now() - Date.parse(candidate.published);
  const reject = [];
  if (!Number.isFinite(age) || age > 30 * 86400000 || age < -86400000) reject.push("STALE_OR_UNDATED");
  if (/\b(seeking work|available for hire|for hire|my portfolio)\b/i.test(text)) reject.push("SELLER_NOT_BUYER");
  if (/\b(full[- ]time|permanent role|salary|equity|employee benefits|on[- ]site|relocat|chief .*officer|head of)\b/i.test(text)) reject.push("EMPLOYMENT_OR_OFFLINE");
  const buyer = /\b(looking for|need(?:ed)?|seeking|hiring|request for|help wanted)\b/i.test(text);
  const project = /\b(project|freelance|contractor|deliverable|one[- ]off|fixed[- ]price|gig)\b/i.test(text);
  const skill = topics.find(t => new RegExp("\\b" + t + "\\b", "i").test(text)) || (/\b(developer|coding|programming)\b/i.test(text) ? "software" : null);
  if (!buyer || !project || !skill) reject.push("NO_CLEAR_DIGITAL_PROJECT_REQUEST");
  if (/pay to apply|membership fee|buy credits|upfront fee|crypto deposit|wire.*deposit/i.test(text)) reject.push("UPFRONT_COST_OR_SCAM_SIGNAL");
  const budget = text.match(/(?:USD\s*|\$)\s*(\d[\d,]*(?:\.\d{1,2})?)/i);
  const emails = [...new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])];
  const remote = /\b(remote|worldwide|anywhere|online)\b/i.test(text);
  return {
    reject, skill, emails,
    leadValue: budget ? { amount: Number(budget[1].replaceAll(",", "")), currency: /\bUSD\b/.test(text) ? "USD" : "UNSPECIFIED_DOLLAR", evidence: budget[0] } : null,
    checks: {
      digitallyRelevant: Boolean(skill), remoteExplicit: remote, requiredCredentials: "UNVERIFIED",
      offlineExcludedByText: !reject.includes("EMPLOYMENT_OR_OFFLINE"),
      noFalseReferencesRequired: "UNVERIFIED", noUpfrontCostSignal: !reject.includes("UPFRONT_COST_OR_SCAM_SIGNAL"),
      deliverable: "REQUIRES_BRIEF_REVIEW", paymentRoute: "UNVERIFIED",
      contactRoute: emails.length ? "PUBLISHED_EMAIL_REQUIRES_REVIEW" : "SOURCE_PAGE_REQUIRES_REVIEW",
      buyerAuthenticity: "UNVERIFIED"
    },
    score: reject.length ? 0 : 20 + (remote ? 10 : 0) + (emails.length ? 10 : 0) + (budget ? 10 : 0) + (/urgent|asap|this week/i.test(text) ? 5 : 0)
  };
}
export function createRuntime({ retryBaseMs = 2000, dataDir = process.env.ATLASZ_STATE_DIR || "./data", persistent = Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH), fetchImpl = fetch, updateGate = () => ({ allowed: true, reason: null }) } = {}) {
  const addons = createInternalAddonHub({ tenantId: "ATLASZ-MAIN", dailyBudgetUsd: 0 });
  const addonSnapshot = () => addons.snapshot();
  fs.mkdirSync(dataDir, { recursive: true });
  // ---- V7.3 safety layer: self-check -> safe mode -> durable queue -> watchdog (fixed topology 5 SEARCH + 25 EXECUTION) ----
  const ownerAuth = getDefaultOwnerAuth();
  const vault = createSecretVault({ dir: path.join(dataDir, "vault"), ownerAuth });
  const safeMode = createSafeMode({ statePath: path.join(dataDir, "safe-mode.json"), auditPath: path.join(dataDir, "safe-mode-audit.jsonl"), ownerAuth });
  const ledger = createFinancialLedger({ dir: path.join(dataDir, "ledger") });
  const bootedAt = new Date().toISOString();
  const approvalRequests = createApprovalRequests({ dir: path.join(dataDir, "approvals") });
  const selfCheck = runStartupSelfCheck({ stateDir: dataDir, ownerAuth, vault, expectedAgents: { search: 5, execution: 25 } });
  if (selfCheck.level === "FAIL") safeMode.enter("SELF_CHECK_FAILED", { failed: selfCheck.checks.filter(c => c.status === "FAIL").map(c => c.id) });
  const file = path.join(dataDir, "atlasz-state.json");
  let state = { version: VERSION, startedAt: now(), lastSystemRun: null, searchCycles: 0, candidates: [], leads: [], artifacts: [], events: [], sourceErrors: {}, agents: [] };
  if (fs.existsSync(file)) {
    const restored = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(restored.leads) || !Array.isArray(restored.candidates)) throw new Error("Invalid saved state: refusing to overwrite");
    state = { ...state, ...restored, version: VERSION };
  }
  // Stall recovery (V7.3 §52 #10/#11): a crash mid-screening leaves candidates stuck in PROCESSING forever.
  let recoveredStalled = 0;
  for (const c of state.candidates) if (c.status === "PROCESSING") { c.status = "NEW"; recoveredStalled++; }
  // Durable queue/checkpoint: every unprocessed candidate has exactly one journaled job. Leases left by a dead process are requeued.
  const queue = createDurableQueue({ dir: path.join(dataDir, "queue"), maxAttempts: 3, leaseMs: 120000, maxPending: Number(process.env.ATLASZ_QUEUE_MAX_PENDING) || 1000 });
  const recoveredQueue = queue.resume().length;
  for (const c of state.candidates) if (c.status === "NEW") queue.enqueue({ id: c.id, payload: { candidateId: c.id } });
  state.agents = Array.from({ length: 30 }, (_, i) => ({
    id: i < 5 ? "SEARCH-" + (i + 1) : "EXECUTION-" + (i - 4),
    role: i < 5 ? "SEARCH" : "EXECUTION", status: "STARTING", currentTask: null,
    lastActivity: now(), nextTask: i < 5 ? "DISCOVER_PROJECT_REQUESTS" : "QUALIFY_DISCOVERED_REQUEST",
    results: 0, blocker: null, nextAction: null
  }));
  for (const agent of state.agents) addons.onAgentRegistered(agent);
  // ---- Brain layer: observes and protects the existing 30 agents (it creates none). Brain failures must never stop the runtime. ----
  // The Brain's governance consults the unified Owner Control chain; until that chain exists every Brain decision is BLOCKED (fail closed).
  const ocHolder = { sys: null };
  const chainProxy = { evaluate: (...a) => (ocHolder.sys ? ocHolder.sys.chain.evaluate(...a) : { verdict: "BLOCK", allowed: false, layer: "OWNER_CONTROL", reason: "CONTROL_CHAIN_NOT_READY", trace: [] }) };
  // Execution pool: the 25 EXECUTION agents are the orchestrator's executors; the screening work itself is unchanged (screeningExecutor). Verification evidence comes from internalRecord (independent of the executor).
  const execIds = state.agents.filter(a => a.role === "EXECUTION").map(a => a.id);
  const brain = createBrainSystem({ dir: path.join(dataDir, "brain"), ownerAuth, roster: state.agents.map(a => ({ id: a.id, team: a.role })), safeMode, chain: chainProxy, redact: t => vault.redact(t),
    executors: Object.fromEntries(execIds.map(id => [id, args => screeningExecutor(id, args)])), lookups: { internalRecord: claim => internalRecord(claim) },
    dispatchOptions: { maxAttempts: 3, backoff: { baseMs: retryBaseMs, maxMs: Math.max(retryBaseMs, 60000) } } });
  // Multi-layer owner control (V7.3 Owner Control): every dispatch of the fixed 30 agents is routed through the chain (owner authority, kill switch, safe mode, security, firewall, black box).
  fs.mkdirSync(path.join(dataDir, "brain"), { recursive: true }); fs.mkdirSync(path.join(dataDir, "ledger"), { recursive: true });
  const recoveryMap = mapRecoverySources({ dataDir, appDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") });
  const ownerControl = createOwnerControlSystem({ sources: recoveryMap.sources, dir: path.join(dataDir, "owner-control"), ownerAuth, gate: emergencyGate, emergencyStatus, safeMode, security: brain.security, blackBox: brain.blackBox, verifier: brain.verifier,
    roster: state.agents.map(a => ({ id: a.id, team: a.role })), tools: ["hn-search", "screening"], capabilityKnown: c => brain.graph.list().some(n => n.capabilities.includes(c)) });
  ocHolder.sys = ownerControl;
  const searchPipeline = createSearchPipeline({ security: brain.security, opportunity: brain.opportunity, graph: brain.graph, blackBox: brain.blackBox, isDuplicate: raw => seen.has(raw.id),
    extract: raw => qualify({ title: raw.title, description: raw.text, published: raw.published }) });
  // Money Engine hosted in the runtime (durable under <data>/money). LIVE environment with NO provider adapters: every external stage reports NOT_CONNECTED /
  // EXTERNAL_VERIFICATION_REQUIRED, so nothing can be SENT / WON / DELIVERED / PAID here until Joci connects real adapters and signs approvals.
  const moneyEngine = createMoneyEngine({ dir: path.join(dataDir, "money"), ownerAuth, brain, environment: "LIVE", adapters: {}, extract: raw => qualify({ title: raw.title, description: raw.text, published: raw.published }), now });
  // Universal Inbox + pipeline (RECEIVE > SECURITY SCREEN > CLASSIFY > ENTITY LINK > DEAL LINK > PRIORITIZE > ROUTE > RECORD). No inbound endpoint is exposed: sources must be authorized connectors calling receive().
  const inbox = createUniversalInbox({ dir: path.join(dataDir, "inbox"), ownerAuth, now });
  const inboxPipeline = createInboxPipeline({ inbox, security: brain.security, graph: brain.entityGraph, tenantId: "ATLASZ", file: path.join(dataDir, "inbox", "pipeline.json"), blackBox: brain.blackBox, now,
    lookups: { deal: id => moneyEngine.engines.deals.get(id), job: id => moneyEngine.engines.jobs.get(id) }, handlers: { recordReply: (dealId, inbound) => moneyEngine.recordReply(dealId, inbound) } });
  // Typed tool surface (G06/GE08): the ONLY way a model/agent calls an ATLASZ function. Schema-checked in and out, classified by the control chain
  // on every call. These built-ins are READ-ONLY views of persisted state; any external-effect tool must declare a gated operation.
  const EMPTY = { type: "object", properties: {} };
  const tools = createToolRegistry({ chain: ownerControl.chain, blackBox: brain.blackBox, now });
  tools.register({ name: "atlasz.queue", description: "Durable queue pressure (ready/leased/dead counts).", operation: "READ_STATUS", input: EMPTY, output: { type: "object", properties: { full: { type: "boolean" } }, additionalProperties: true }, handler: () => queue.pressure() });
  tools.register({ name: "money.panel", description: "Money Engine panel (LIVE vs SANDBOX separate; verified vs claimed).", operation: "READ_STATUS", input: EMPTY, output: { type: "object", properties: {}, additionalProperties: true }, handler: () => moneyEngine.panel() });
  tools.register({ name: "inbox.summary", description: "Inbox pipeline summary (counts only, no message bodies).", operation: "READ_STATUS", input: EMPTY, output: { type: "object", properties: {}, additionalProperties: true }, handler: () => inboxPipeline.summary() });
  // Model gateway: provider-resilience (breaker, no-spend cost router, fallback, independent judge, cost ledger) over the Brain's measured model graph.
  // NO provider is registered here: credentials/adapters are attached by the owner-approved connector path, and LIVE comes only from our own probe.
  const modelGateway = createModelGateway({ resilience: createProviderResilience({ gate: emergencyGate, ledger }), models: brain.models, security: brain.security, blackBox: brain.blackBox });
  tools.register({ name: "model.complete", description: "Ask a language model (no-spend, free providers only; output is UNTRUSTED text screened by the Security Brain).", operation: "EXTERNAL_READ",
    input: { type: "object", required: ["prompt"], properties: { prompt: { type: "string", minLength: 1, maxLength: 20000 }, capability: { enum: ["text", "code", "reasoning", "judge"] } } },
    output: { type: "object", required: ["ok", "untrusted"], properties: { ok: { type: "boolean" }, untrusted: { type: "boolean" } }, additionalProperties: true }, handler: a => modelGateway.complete({ prompt: a.prompt, capability: a.capability ?? "text", budgetUsd: 0 }) });
  // Personal Command Center + durable scheduler: schedules call ONLY registered typed tools (control chain on every run, actor SCHEDULER). Emergency stop / Safe Mode halt the whole tick.
  const pcc = createPersonalCommandCenter({ file: path.join(dataDir, "pcc", "items.json"), now, blackBox: brain.blackBox });
  registerPccTools(tools, pcc);
  // Knowledge Projects over the Document Center. Tool callers are AGENTS: they always read as role AGENT with forAgent:true (Security-Brain ALLOW text only, SECRET hidden);
  // tenant is fixed to the owner's tenant and is never an argument. Retrieval is keyword-based, answers are extractive + cited (see knowledge-projects.mjs).
  const KP_TENANT = "JOCI", kpWho = { tenantId: KP_TENANT, role: "AGENT", forAgent: true };
  // Multimodal fabric: built-in metadata for images/audio/video + document text; OCR / speech-to-text / vision slots exist but NO provider is attached (external).
  const modality = createModalityFabric({ security: brain.security, blackBox: brain.blackBox, now });
  const documents = createDocumentCenter({ dir: path.join(dataDir, "documents"), security: brain.security, graph: brain.entityGraph, media: modality });
  registerModalityTools(tools, modality, documents, { tenantId: KP_TENANT, role: "AGENT" });
  const knowledge = createKnowledgeProjects({ file: path.join(dataDir, "knowledge", "projects.json"), documents, security: brain.security, blackBox: brain.blackBox, now });
  const anyObj = { type: "object", additionalProperties: true, properties: {} }, KP_ID = { type: "string", minLength: 1, maxLength: 80 };
  tools.register({ name: "kp.list", description: "List knowledge projects the agent role may use.", operation: "READ_STATUS", input: { type: "object", properties: {} }, output: { type: "object", required: ["projects"], properties: { projects: { type: "array" } } }, handler: () => ({ projects: knowledge.list({ tenantId: KP_TENANT, role: "AGENT" }) }) });
  tools.register({ name: "kp.search", description: "Keyword search inside a knowledge project; returns cited passages (not semantic).", operation: "READ_STATUS", input: { type: "object", required: ["projectId", "query"], properties: { projectId: KP_ID, query: { type: "string", minLength: 1, maxLength: 500 }, limit: { type: "integer", minimum: 1, maximum: 50 } } }, output: anyObj, handler: a => knowledge.search(a.projectId, { query: a.query, limit: a.limit ?? 10, ...kpWho }) });
  tools.register({ name: "kp.answer", description: "Extractive cited answer from a knowledge project, or NO_SUPPORTING_EVIDENCE.", operation: "READ_STATUS", input: { type: "object", required: ["projectId", "query"], properties: { projectId: KP_ID, query: { type: "string", minLength: 1, maxLength: 500 } } }, output: anyObj, handler: a => knowledge.answer(a.projectId, { query: a.query, ...kpWho }) });
  tools.register({ name: "kp.verify", description: "Re-check a citation against its current source.", operation: "READ_STATUS", input: { type: "object", required: ["citation"], properties: { citation: { type: "object", additionalProperties: true, properties: {} } } }, output: anyObj, handler: a => knowledge.verifyCitation(a.citation, kpWho) });
  // Research Ledger over Knowledge Projects: agents record questions/findings/evidence only through typed tools, as role AGENT (author recorded as AGENT).
  // Finding status is recomputed from re-verified citations on every read; agents can neither verify their own claims nor resolve contradictions (OWNER only, Control Center).
  const research = createResearchLedger({ file: path.join(dataDir, "research", "ledger.json"), knowledge, security: brain.security, blackBox: brain.blackBox, now });
  const S80 = { type: "string", minLength: 1, maxLength: 80 }, RID = S80;
  const obj = { type: "object", additionalProperties: true, properties: {} };
  const rtool = (name, description, operation, props, required, fn) => tools.register({ name, description, operation, input: { type: "object", required, properties: props }, output: obj, handler: fn });
  rtool("research.open_question", "Open a research question inside a knowledge project.", "INTERNAL_COMPUTE", { projectId: RID, text: { type: "string", minLength: 1, maxLength: 500 } }, ["projectId", "text"], a => research.openQuestion(a, kpWho));
  rtool("research.add_source", "Record already-retrieved web text (URL + retrievedAt) or a note as a source; it is screened as untrusted input.", "INTERNAL_COMPUTE", { projectId: RID, kind: { enum: ["webpage", "note"] }, url: { type: "string", maxLength: 2000 }, retrievedAt: { type: "string", maxLength: 40 }, title: { type: "string", minLength: 1, maxLength: 160 }, text: { type: "string", minLength: 1, maxLength: 200000 } }, ["projectId", "title", "text"], a => research.addSource(a.projectId, a, kpWho));
  rtool("research.add_finding", "Record a claim (CLAIM) or an explicit ASSUMPTION for a question. Status is computed, never set by the author.", "INTERNAL_COMPUTE", { questionId: RID, claim: { type: "string", minLength: 1, maxLength: 1000 }, kind: { enum: ["CLAIM", "ASSUMPTION"] }, topic: { type: "string", maxLength: 120 }, value: { type: "string", maxLength: 200 } }, ["questionId", "claim"], a => research.addFinding(a.questionId, a, kpWho));
  rtool("research.attach_evidence", "Attach a verifiable knowledge citation to a finding (must verify now and cover the claim).", "INTERNAL_COMPUTE", { findingId: RID, citation: { type: "object", additionalProperties: true, properties: {} }, relation: { enum: ["SUPPORTS", "REFUTES"] } }, ["findingId", "citation"], a => research.attachEvidence(a.findingId, a, kpWho));
  rtool("research.declare_contradiction", "Flag two findings of one question as contradicting. Only the owner can resolve it.", "INTERNAL_COMPUTE", { a: RID, b: RID, note: { type: "string", maxLength: 1000 } }, ["a", "b"], x => research.declareContradiction(x.a, x.b, { note: x.note }, kpWho));
  rtool("research.report", "Structured report: verified facts, conflicted, refuted, outdated, unverifiable, unsupported, assumptions (re-verified now).", "READ_STATUS", { questionId: RID }, ["questionId"], a => research.report(a.questionId, kpWho));
  rtool("research.unresolved", "Questions without a verified, uncontested answer.", "READ_STATUS", { projectId: RID }, [], a => ({ questions: research.unresolved(kpWho, { projectId: a.projectId ?? null }) }));
  // Code sandbox: untrusted code runs in a separate OS process (never in this runtime). Isolation level is detected and reported; process-only runs need a signed, argument-bound owner approval.
  const sandbox = createCodeSandbox({ baseDir: path.join(dataDir, "sandbox", "runs"), auditFile: path.join(dataDir, "sandbox", "audit.jsonl"), blackBox: brain.blackBox, now });
  registerSandboxTools(tools, sandbox);
  // Observation memory: consent / retention / correction / deletion for personal observations. Agents reach it only through obs.* typed tools (role AGENT; PUBLIC/PERSONAL, Security-Brain ALLOW only).
  const observations = createObservationMemory({ file: path.join(dataDir, "memory", "observations.json"), security: brain.security, blackBox: brain.blackBox, now });
  registerObservationTools(tools, observations, { tenantId: KP_TENANT }); registerResearchCapture(tools, observations, research, { tenantId: KP_TENANT });
  // Live Voice: conversation layer over the existing voice-session state machine. NO STT/TTS provider is registered here (EXTERNAL_BLOCKER), so voice reports BLOCKED_NO_PROVIDER
  // until a provider with probe evidence is attached. Every turn is gated by the owner kill switch and Safe Mode; voice can never approve. Agents get a counts-only status tool.
  const voice = createVoiceConversation({ session: createVoiceSession({ transcriptDir: null }), file: path.join(dataDir, "memory", "voice-conversations.json"), security: brain.security, blackBox: brain.blackBox, now,
    gate: () => { const e = emergencyGate({ external: false }); if (!e.allowed) return e; return safeMode.gate({ write: true }); } });
  registerVoiceTools(tools, voice);
  const scheduler = createScheduler({ file: path.join(dataDir, "scheduler", "schedules.json"), tools, now, blackBox: brain.blackBox,
    gate: o => { const e = emergencyGate(o); if (!e.allowed) return e; return safeMode.gate({ ...o, write: true }); } });
  const brainSafe = fn => { try { return fn(); } catch (e) { try { console.log(JSON.stringify({ at: now(), type: "brain_error", error: String(e.message).slice(0, 120) })); } catch { /* ignore */ } return null; } };
  brainSafe(() => brain.dispatch?.resumeAll());                           // restart: in-flight governed jobs go back to QUEUED (attempts, plans, checkpoints preserved)
  const seen = new Set(state.candidates.map(c => c.id));
  const timers = new Set();
  let stopping = false;
  function save() {
    const temp = file + ".tmp";
    const fd = fs.openSync(temp, "w", 0o600);
    try { fs.writeSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  }
  function event(type, details = {}) {
    const entry = { at: now(), type, ...details };
    state.events.push(entry);
    if (state.events.length > 300) state.events.splice(0, state.events.length - 300);
    addons.onRuntimeEvent(type, details);
    console.log(JSON.stringify(entry));
  }
  function update(agent, status, task, blocker = null) {
    Object.assign(agent, { status, currentTask: task, lastActivity: now(), blocker, nextAction: blocker ? "RESOLVE_BLOCKER" : agent.nextTask });
  }
  async function search(index) {
    const agent = state.agents[index];
    watchdog.beat("scheduler");
    const eg = emergencyGate({ external: true }), sg = safeMode.gate({ external: true });
    const gate = !eg.allowed ? eg : !sg.allowed ? sg : updateGate({ external: true });
    if (!gate.allowed) { update(agent, "HALTED_BY_OWNER_STOP", "Owner emergency stop active", gate.reason); event("dispatch_blocked", { agentId: agent.id, reason: gate.reason }); return; }
    const oc = ownerControl.agents.act(agent.id, "EXTERNAL_READ", { external: true, tool: "hn-search" });
    if (!oc.allowed) { update(agent, "HALTED_BY_OWNER_STOP", "Owner control chain blocked this dispatch", oc.reason); event("dispatch_blocked", { agentId: agent.id, reason: "OWNER_CONTROL:" + oc.reason }); return; }
    const round = Math.floor(state.searchCycles / 5);
    const query = queryLanes[(index + round) % queryLanes.length] + (round % 2 ? " " + topics[(index + round) % topics.length] : "");
    if (queue.pressure().full) { update(agent, "WAITING_BACKPRESSURE", "Work queue is full; search paused until the execution agents catch up"); event("backpressure", { agentId: agent.id, ...queue.pressure() }); return; }      // slow the producers instead of dropping or overfilling
    update(agent, "RUNNING", "Search recent public project requests: " + query);
    try {
      const url = "https://hn.algolia.com/api/v1/search_by_date?tags=comment&hitsPerPage=50&numericFilters=created_at_i%3E" + Math.floor((Date.now() - 30 * 86400000) / 1000) + "&query=" + encodeURIComponent(query);
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "ATLASZ-30/3.1 project-research" } });
      if (!response.ok) throw new Error("SOURCE_HTTP_" + response.status);
      const json = await response.json();
      if (!Array.isArray(json.hits)) throw new Error("SOURCE_SCHEMA_MISMATCH");
      let added = 0;
      for (const hit of json.hits) {
        if (!hit.objectID) continue;
        const id = "hn-" + hit.objectID;
        if (seen.has(id)) continue;
        // SEARCH pipeline: security screen > dedupe > source check > extract > score > qualify > feasibility > capability match > prioritize > opportunity record > hand-off.
        // If the Brain pipeline itself fails the item is NOT queued (fail closed) and stays unseen so a later cycle retries it.
        const raw = { id, title: clean(hit.story_title || hit.title), text: clean(hit.comment_text || hit.story_text), url: "https://news.ycombinator.com/item?id=" + encodeURIComponent(hit.objectID), published: hit.created_at, source: "hn" };
        const out = brainSafe(() => searchPipeline.process(raw, { agentId: agent.id }));
        if (!out) continue;
        seen.add(id);
        if (!out.handoff) continue;                                                       // quarantined / duplicate / malformed: never queued, never shown to an execution agent
        state.candidates.push({ id, title: raw.title, description: raw.text.slice(0, 16000), published: hit.created_at, url: raw.url, source: "Hacker News public comments", status: "NEW", foundAt: now(), foundBy: agent.id,
          opportunityId: out.opportunityId, priority: out.priority, correlationId: out.correlationId });
        queue.enqueue({ id, payload: { candidateId: id }, priority: out.priority === "HIGH" ? 2 : out.priority === "MEDIUM" ? 1 : 0 });
        added++;
      }
      agent.results += added;
      state.searchCycles++;
      state.lastSystemRun = now();
      delete state.sourceErrors[agent.id];
      update(agent, "SCHEDULED", "Search completed; next rotation scheduled");
      event("search_completed", { agentId: agent.id, query, fetched: json.hits.length, newCandidates: added });
    } catch (e) {
      state.sourceErrors[agent.id] = String(e.message);
      update(agent, "BLOCKED", "Search retry scheduled", String(e.message));
      event("search_failed", { agentId: agent.id, error: String(e.message) });
    }
    save();
  }
  // ---- 25-agent execution pool, routed through the governed Brain dispatch (Joci-approved SANDBOX change) ----
  // queue job > durable dispatch job (idempotent) > plan > capability graph assignment > orchestrator (governance chain gate, execute, INDEPENDENT verification, black box)
  const agentById = id => state.agents.find(a => a.id === id);
  /** The screening work itself (unchanged logic). Runs only when the orchestrator has passed every control layer for the assigned agent. */
  async function screeningExecutor(agentId, { task }) {
    const agent = agentById(agentId), candidate = state.candidates.find(c => c.id === task.candidateId);
    if (!agent || !candidate) throw new Error("EXECUTOR_CONTEXT_MISSING");
    if (candidate.status === "NEEDS_VERIFICATION" || candidate.status === "REJECTED") return { claimType: "INTERNAL_RECORD", claim: { kind: "SCREENING", candidateId: candidate.id, executorId: candidate.processedBy }, summary: "already screened", evidenceRef: "candidate:" + candidate.id };   // idempotent replay
    candidate.status = "PROCESSING";
    update(agent, "RUNNING", "Evidence-based screening: " + candidate.id);
    try {
      const assessment = qualify(candidate);
      candidate.assessment = assessment;
      addons.onCandidate(candidate, assessment);
      candidate.processedAt = now();
      candidate.processedBy = agent.id;
      candidate.status = assessment.reject.length ? "REJECTED" : "NEEDS_VERIFICATION";
      if (!assessment.reject.length && !state.leads.some(l => l.id === candidate.id)) {
        state.leads.push({ ...candidate, agreedValue: null, proposedValue: null, invoicedValue: null, paidValue: null, firstContactAt: null, replyAt: null, followUpAt: null, outreachStatus: "NOT_SENT", projectStatus: "NOT_WON" });
        const content = [
          "Scope review for " + candidate.url,
          "Source excerpt: " + candidate.description,
          "Potential service category: " + assessment.skill,
          "Before an offer: verify the buyer and current availability; confirm remote delivery, exact deliverable, acceptance criteria, deadline, required access, payment route and budget currency.",
          "Unknown checks: " + JSON.stringify(assessment.checks),
          "No offer has been sent. No client job has been won."
        ].join("\n\n");
        const artifactId = createHash("sha256").update(content).digest("hex").slice(0, 16);
        state.artifacts.push({ id: artifactId, leadId: candidate.id, type: "SCOPE_REVIEW", createdAt: now(), createdBy: agent.id, qa: content.includes(candidate.url) && content.includes("No offer has been sent.") ? "PASSED_SOURCE_LINK_CHECK" : "FAILED", content });
      }
      agent.results++;
      addons.onAgentResult({ agentId: agent.id, success: true, qaPassed: !assessment.reject.length });
      event("screening_completed", { agentId: agent.id, candidateId: candidate.id, result: candidate.status, reasons: assessment.reject });
      return { claimType: "INTERNAL_RECORD", claim: { kind: "SCREENING", candidateId: candidate.id, executorId: agent.id }, summary: candidate.status, evidenceRef: "candidate:" + candidate.id, quality: 1 };
    } catch (e) {
      candidate.status = "NEW";
      addons.onAgentResult({ agentId: agent.id, success: false, qaPassed: false, error: true });
      update(agent, "BLOCKED", "Screening failed; governed retry/replan applies", String(e.message));
      throw e;
    }
  }
  /** Independent internal evidence for the verifier (job ledger = candidates/leads/artifacts). Does not trust the executor's own return value. */
  // Internal evidence sources (read-only views onto durable internal stores). Unconnected sources report UNKNOWN; external claims need an authoritative adapter.
  const evidenceSources = createEvidenceSources({ readers: {
    JOB: { get: id => brain.dispatch?.get(id) ?? null },
    COST_LEDGER: ledger, REVENUE_LEDGER: ledger, PROFIT_LEDGER: ledger,
    QUEUE: { get: id => queue.get(id) },
    ARTIFACT: { get: id => state.artifacts.find(a => a.id === id) ?? null },
    BACKUP: { readiness: () => ownerControl.recovery.readiness() }, RESTORE: { readiness: () => ownerControl.recovery.readiness() },
    HEALTH: { probe: n => ownerControl.probe(n) },
    BLACK_BOX: brain.blackBox, APPROVAL: ownerControl.gateway } });
  function internalRecord(claim) {
    if (claim?.source) return evidenceSources.verify(claim);
    if (claim?.kind !== "SCREENING") return { status: "UNKNOWN", reason: "UNSUPPORTED_RECORD_KIND" };
    const c = state.candidates.find(x => x.id === claim.candidateId);
    if (!c) return { status: "FAILED_VERIFICATION", reason: "CANDIDATE_MISSING" };
    if (c.status === "PROCESSING" || c.status === "NEW") return { status: "NOT_VERIFIED", reason: "NOT_COMPLETED" };
    if (!c.assessment || c.processedBy !== claim.executorId) return { status: "FAILED_VERIFICATION", reason: "ASSESSMENT_OR_EXECUTOR_MISMATCH" };
    let re; try { re = qualify(c); } catch { return { status: "UNKNOWN", reason: "RECOMPUTE_FAILED" }; }
    if (JSON.stringify(re.reject) !== JSON.stringify(c.assessment.reject)) return { status: "FAILED_VERIFICATION", reason: "ASSESSMENT_NOT_REPRODUCIBLE" };
    const expected = c.assessment.reject.length ? "REJECTED" : "NEEDS_VERIFICATION";
    if (c.status !== expected) return { status: "FAILED_VERIFICATION", reason: "STATUS_INCONSISTENT" };
    if (expected === "NEEDS_VERIFICATION") {
      const lead = state.leads.find(l => l.id === c.id), art = state.artifacts.find(a => a.leadId === c.id);
      if (!lead || !art) return { status: "FAILED_VERIFICATION", reason: "LEAD_OR_ARTIFACT_MISSING" };
      if (art.qa !== "PASSED_SOURCE_LINK_CHECK" || !art.content.includes(c.url) || !art.content.includes("No offer has been sent.")) return { status: "FAILED_VERIFICATION", reason: "ARTIFACT_QA_FAILED" };
      if (lead.outreachStatus !== "NOT_SENT" || lead.paidValue !== null) return { status: "FAILED_VERIFICATION", reason: "UNAUTHORIZED_EXTERNAL_STATE" };
    }
    return { status: "VERIFIED", reason: "RECORD_REPRODUCED_INDEPENDENTLY" };
  }
  async function execute(index) {
    const agent = state.agents[index];
    watchdog.beat("scheduler");
    const eg = emergencyGate({ external: false }), sg = safeMode.gate({ write: true });
    const gate = !eg.allowed ? eg : sg;
    if (!gate.allowed) { update(agent, "HALTED_BY_OWNER_STOP", eg.allowed ? "Safe Mode active" : "Owner emergency stop active", gate.reason); return; }
    const oc = ownerControl.agents.act(agent.id, "INTERNAL_COMPUTE", { tool: "screening" });
    if (!oc.allowed) { update(agent, "HALTED_BY_OWNER_STOP", "Owner control chain blocked this dispatch", oc.reason); return; }
    const job = queue.lease({ worker: agent.id });
    if (!job) {
      // jobs the dispatch owns durably (halted by a stop, waiting for the stop to clear, retry due) are picked up before idling
      const due = brainSafe(() => brain.dispatch?.nextDue());
      if (due) { await runGoverned(agent, due, null); state.lastSystemRun = now(); save(); return; }
      update(agent, "WAITING_FOR_INPUT", "No unprocessed project request", "NO_QUALIFICATION_TASK_OR_CLIENT_JOB");
      return;
    }
    const candidate = state.candidates.find(c => c.id === job.id);
    if (!candidate || !["NEW", "PROCESSING"].includes(candidate.status)) { queue.ack(job.id); return; }   // already handled before a crash between save and ack
    if (!brain.dispatch) { queue.nack(job.id, { error: "DISPATCH_UNAVAILABLE_FAIL_CLOSED" }); update(agent, "BLOCKED", "Governed dispatch unavailable", "DISPATCH_UNAVAILABLE"); return; }
    brain.dispatch.submit({ id: candidate.id, kind: "SCREENING", payload: { task: { candidateId: candidate.id } }, correlationId: candidate.correlationId });   // durable + idempotent
    const res = await runGoverned(agent, candidate.id, job);
    state.lastSystemRun = now();
    save();
    if (res.queueAction === "ACK") queue.ack(job.id);                 // checkpoint first (save), acknowledge second: a crash in between is replayed idempotently
  }
  /** One governed attempt. Returns {queueAction: ACK|NACK|NONE}. NACK = the queue (not a second scheduler) re-offers the job after the backoff; the queue's own attempt cap becomes the dead-letter. */
  async function runGoverned(agent, jobId, qjob) {
    let r;
    try { r = await brain.dispatch.run(jobId, { preferredAgentId: agent.id }); } catch (e) { r = { status: "ERROR", reason: String(e.message) }; }
    const cand = state.candidates.find(c => c.id === jobId), who = agentById(r.agentId) ?? agent;
    const done = (st, detail) => update(who, st, detail);
    if (r.status === "DONE" || r.status === "ALREADY_DONE") { if (cand) done("SCHEDULED", "Screening complete: " + cand.status); return { queueAction: "ACK" }; }
    if (r.status === "RETRY_WAIT" || r.status === "BACKOFF") { update(agent, "BLOCKED", "Governed retry scheduled", r.action ?? "BACKOFF"); if (qjob) { const q = queue.nack(qjob.id, { error: r.action ?? "BACKOFF", retryDelayMs: Math.max(0, (r.retryAt ?? now()) - Date.now()) }); if (q.state === "DEAD" && cand) cand.status = "FAILED_DEAD_LETTER"; return { queueAction: "NONE" }; } return { queueAction: "NONE" }; }
    if (r.status === "ESCALATED") {
      const attempts = r.job?.attempts ?? 0;
      if (cand) cand.status = "FAILED_ESCALATED";
      update(agent, "BLOCKED", "Escalated to owner after bounded retries", r.failure?.reason ?? "ESCALATED");
      if (qjob && attempts >= 3) { const q = queue.nack(qjob.id, { error: "ESCALATED" }); if (q.state === "DEAD" && cand) cand.status = "FAILED_DEAD_LETTER"; return { queueAction: "NONE" }; }
      return { queueAction: qjob ? "ACK" : "NONE" };
    }
    if (r.status === "HALTED") { update(agent, "HALTED_BY_OWNER_STOP", "Owner control halted this job; it resumes when cleared", r.reason ?? "HALTED"); return { queueAction: qjob ? "ACK" : "NONE" }; }
    if (r.status === "WAITING_APPROVAL") { update(agent, "WAITING_FOR_INPUT", "Waiting for Joci's approval", r.reason ?? "APPROVAL"); return { queueAction: qjob ? "ACK" : "NONE" }; }
    update(agent, "BLOCKED", "Governed dispatch: " + r.status, r.reason ?? r.status);
    return { queueAction: "NONE" };
  }
  function dashboard() {
    const blockers = [
      { code: "AI_EXECUTION_DISABLED_NO_SPEND", detail: "No paid AI calls are enabled. Client deliverable execution is not configured." },
      { code: "OUTREACH_NOT_CONNECTED", detail: "No authenticated delivery adapter; drafts never count as sent." },
      { code: "PAYMENT_VERIFICATION_NOT_CONNECTED", detail: "No bank or payment processor evidence is available." },
      { code: "SOURCE_COVERAGE_LIMITED", detail: "Only public Hacker News project-request discovery is currently implemented." }
    ];
    if (!persistent) blockers.push({ code: "DURABLE_VOLUME_MISSING", detail: "State is saved on local disk and restored on process restart; redeploy durability is not guaranteed." });
    return {
      system: "ATLASZ-30", version: VERSION, status: "PARTIAL_BLOCKED",
      capabilities: {
        publicSearch: true, sourceScreening: true, scopePreparation: true,
        aiExecution: addonSnapshot().models.live > 0,
        emailSending: false, paymentVerification: false,
        computerUse: addonSnapshot().computerUse?.state === "LIVE",
        voice: addonSnapshot().voice?.state === "LIVE"
      },
      search: { configured: 5, runningOrScheduled: state.agents.slice(0, 5).filter(a => ["RUNNING", "SCHEDULED"].includes(a.status)).length },
      execution: { configured: 25, clientJobsRunning: 0, screeningTasksCompleted: state.agents.slice(5).reduce((s, a) => s + a.results, 0) },
      metrics: { candidatesFound: state.candidates.length, activeLeads: state.leads.length, qualifiedOpportunities: 0, scopeReviews: state.artifacts.length, outreachSent: 0, replies: 0, won: 0, inProgress: 0, delivered: 0, awaitingPayment: 0, confirmedPaid: 0, costs: null, verifiedNetProfit: null, monthlyRecurringRevenue: 0 },
      lastSystemRun: state.lastSystemRun, searchCycles: state.searchCycles,
      persistence: { savedLocally: true, durableVolume: persistent },
      agents: state.agents, blockers, sourceErrors: state.sourceErrors, emergency: emergencyStatus(), safeMode: safeMode.status(), pendingApprovals: approvalRequests.pending().length, queue: queue.stats(), watchdog: watchdog.status(),
      selfCheck: { level: selfCheck.level, problems: selfCheck.checks.filter(c => c.status !== "OK").map(c => ({ id: c.id, status: c.status, detail: c.detail })) },
      vault: vault.status(), internalAddons: addonSnapshot(),
      brain: brainSafe(() => brain.summary()) ?? { state: "ERROR" }, models: brainSafe(() => modelGateway.summary()) ?? { state: "ERROR" }, voice: brainSafe(() => { const x = voice.summary({}); return { conversations: x.conversations, open: x.open, live: x.voice.live, providerMode: x.providerMode, blocker: x.voice.blocker, canApprove: false }; }) ?? { state: "ERROR" }, observations: brainSafe(() => { const x = observations.summary({ tenantId: KP_TENANT, role: "OWNER" }); return { total: x.total, expired: x.expired, deleted: x.deleted, rawMediaStored: false, chain: x.chain, method: x.method }; }) ?? { state: "ERROR" }, modality: brainSafe(() => { const m = modality.summary(); return { builtIn: m.builtIn.length, externalSlotsNotLive: m.external, note: m.note }; }) ?? { state: "ERROR" }, sandbox: brainSafe(() => { const x = sandbox.summary(); return { level: x.level, languages: x.languages, runs: x.runs, audit: x.audit, label: x.label }; }) ?? { state: "ERROR" }, research: brainSafe(() => research.summary({ tenantId: KP_TENANT, role: "OWNER" })) ?? { state: "ERROR" }, knowledge: brainSafe(() => ({ projects: knowledge.list({ tenantId: KP_TENANT }).length, documents: documents.summary().total, method: "KEYWORD_BM25_NOT_SEMANTIC" })) ?? { state: "ERROR" }, scheduler: brainSafe(() => scheduler.summary()) ?? { state: "ERROR" }, pcc: brainSafe(() => pcc.summary()) ?? { state: "ERROR" }, moneyEngine: brainSafe(() => moneyEngine.panel()) ?? { state: "ERROR" }, behavior: brainSafe(() => brain.behavior.summary()) ?? { state: "ERROR" }, inbox: brainSafe(() => ({ ...inbox.counts(), pipeline: inboxPipeline.summary() })) ?? { state: "ERROR" }, ownerControl: brainSafe(() => ownerControl.status()) ?? { state: "ERROR" }, ledger: ledger.summary(), uptime: { startedAt: bootedAt, seconds: Math.round((Date.now() - Date.parse(bootedAt)) / 1000) }
    };
  }
  const watchdog = createWatchdog({ onEscalate: e => safeMode.enter("WATCHDOG:" + e.id, { detail: e.detail }) });
  watchdog.register({ id: "scheduler", critical: true, heartbeatMaxAgeMs: 120000 });
  watchdog.register({ id: "queue", critical: true, probe: () => ({ ok: queue.stats().total >= 0 }) });
  function schedule(fn, delay) {
    const timer = setTimeout(async () => {
      timers.delete(timer);
      if (stopping) return;
      try { await fn(); } catch (e) { event("scheduler_error", { error: String(e.message) }); }
      if (!stopping) schedule(fn, delay);
    }, delay);
    timers.add(timer);
  }
  async function start() {
    safeMode.recordBoot();
    watchdog.start(15000);
    const healthy = setTimeout(() => safeMode.markHealthy(), 60000); healthy.unref?.();
    event("runtime_started", { version: VERSION, searchAgents: 5, executionAgents: 25, paidAiCallsEnabled: false });
    for (let i = 0; i < 5; i++) {
      void search(i);
      schedule(() => search(i), 300000 + i * 10000);
    }
    for (let i = 5; i < 30; i++) schedule(() => execute(i), 1000 + (i - 5) * 50);
    schedule(() => brainSafe(() => scheduler.tick()), 30000);               // durable scheduler tick (typed tools only; at-least-once)
    schedule(() => brainSafe(() => brain.behavior.scan()), 60000);          // behaviour anomaly scan over the tamper-evident Black Box (detect + recommend only)
  }
  function stop() { stopping = true; watchdog.stop(); for (const t of timers) clearTimeout(t); save(); }
  return { tools, modelGateway, knowledge, research, sandbox, modality, observations, voice, documents, pcc, scheduler, inbox, inboxPipeline, moneyEngine, evidenceSources, recoveryMap, brain, ownerControl, ledger, state, search, execute, dashboard, save, start, stop, recoveredStalled, recoveredQueue, queue, approvalRequests, safeMode, watchdog, selfCheck, vault };
}

if (process.env.ATLASZ_TEST_MODE !== "1") {
  const runtime = createRuntime();
  const server = http.createServer(createRuntimeHandler({ runtime, version: VERSION }));      // authenticated; only /health is open (see runtime-http.mjs)
  server.listen(Number(process.env.PORT || 8080), "0.0.0.0", () => runtime.start());
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { runtime.stop(); server.close(() => process.exit(0)); });
}
