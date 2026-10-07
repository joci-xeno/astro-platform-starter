import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createInternalAddonHub } from "../atlasz-addons/internal-integration-hub.mjs";
import { emergencyGate, emergencyStatus } from "../atlasz-addons/emergency-stop.mjs";
import { createDurableQueue } from "../atlasz-addons/durable-queue.mjs";
import { createSafeMode } from "../atlasz-addons/safe-mode.mjs";
import { createWatchdog } from "../atlasz-addons/watchdog.mjs";
import { runStartupSelfCheck } from "../atlasz-addons/startup-self-check.mjs";
import { createSecretVault } from "../atlasz-addons/secret-vault.mjs";
import { getDefaultOwnerAuth } from "../atlasz-addons/owner-auth.mjs";

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
export function createRuntime({ dataDir = process.env.ATLASZ_STATE_DIR || "./data", persistent = Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH), fetchImpl = fetch, updateGate = () => ({ allowed: true, reason: null }) } = {}) {
  const addons = createInternalAddonHub({ tenantId: "ATLASZ-MAIN", dailyBudgetUsd: 0 });
  const addonSnapshot = () => addons.snapshot();
  fs.mkdirSync(dataDir, { recursive: true });
  // ---- V7.3 safety layer: self-check -> safe mode -> durable queue -> watchdog (fixed topology 5 SEARCH + 25 EXECUTION) ----
  const ownerAuth = getDefaultOwnerAuth();
  const vault = createSecretVault({ dir: path.join(dataDir, "vault"), ownerAuth });
  const safeMode = createSafeMode({ statePath: path.join(dataDir, "safe-mode.json"), auditPath: path.join(dataDir, "safe-mode-audit.jsonl"), ownerAuth });
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
  const queue = createDurableQueue({ dir: path.join(dataDir, "queue"), maxAttempts: 3, leaseMs: 120000 });
  const recoveredQueue = queue.resume().length;
  for (const c of state.candidates) if (c.status === "NEW") queue.enqueue({ id: c.id, payload: { candidateId: c.id } });
  state.agents = Array.from({ length: 30 }, (_, i) => ({
    id: i < 5 ? "SEARCH-" + (i + 1) : "EXECUTION-" + (i - 4),
    role: i < 5 ? "SEARCH" : "EXECUTION", status: "STARTING", currentTask: null,
    lastActivity: now(), nextTask: i < 5 ? "DISCOVER_PROJECT_REQUESTS" : "QUALIFY_DISCOVERED_REQUEST",
    results: 0, blocker: null, nextAction: null
  }));
  for (const agent of state.agents) addons.onAgentRegistered(agent);
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
    const round = Math.floor(state.searchCycles / 5);
    const query = queryLanes[(index + round) % queryLanes.length] + (round % 2 ? " " + topics[(index + round) % topics.length] : "");
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
        seen.add(id);
        state.candidates.push({ id, title: clean(hit.story_title || hit.title), description: clean(hit.comment_text || hit.story_text).slice(0, 16000), published: hit.created_at, url: "https://news.ycombinator.com/item?id=" + encodeURIComponent(hit.objectID), source: "Hacker News public comments", status: "NEW", foundAt: now(), foundBy: agent.id });
        queue.enqueue({ id, payload: { candidateId: id } });
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
  function execute(index) {
    const agent = state.agents[index];
    watchdog.beat("scheduler");
    const eg = emergencyGate({ external: false }), sg = safeMode.gate({ write: true });
    const gate = !eg.allowed ? eg : sg;
    if (!gate.allowed) { update(agent, "HALTED_BY_OWNER_STOP", eg.allowed ? "Safe Mode active" : "Owner emergency stop active", gate.reason); return; }
    const job = queue.lease({ worker: agent.id });
    if (!job) {
      update(agent, "WAITING_FOR_INPUT", "No unprocessed project request", "NO_QUALIFICATION_TASK_OR_CLIENT_JOB");
      return;
    }
    const candidate = state.candidates.find(c => c.id === job.id);
    if (!candidate || candidate.status !== "NEW") { queue.ack(job.id); return; }   // already handled before a crash between save and ack
    let nacked = false;
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
      update(agent, "SCHEDULED", "Screening complete: " + candidate.status);
      event("screening_completed", { agentId: agent.id, candidateId: candidate.id, result: candidate.status, reasons: assessment.reject });
    } catch (e) {
      candidate.status = "NEW";
      const r = queue.nack(job.id, { error: String(e.message) }); nacked = true;
      if (r.state === "DEAD") candidate.status = "FAILED_DEAD_LETTER";
      addons.onAgentResult({ agentId: agent.id, success: false, qaPassed: false, error: true });
      update(agent, "BLOCKED", "Screening failed; task returned to queue", String(e.message));
    }
    state.lastSystemRun = now();
    save();
    if (!nacked) queue.ack(job.id);                 // checkpoint first (save), acknowledge second: a crash in between is replayed idempotently
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
      agents: state.agents, blockers, sourceErrors: state.sourceErrors, emergency: emergencyStatus(), safeMode: safeMode.status(), queue: queue.stats(), watchdog: watchdog.status(),
      selfCheck: { level: selfCheck.level, problems: selfCheck.checks.filter(c => c.status !== "OK").map(c => ({ id: c.id, status: c.status, detail: c.detail })) },
      vault: vault.status(), internalAddons: addonSnapshot()
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
  }
  function stop() { stopping = true; watchdog.stop(); for (const t of timers) clearTimeout(t); save(); }
  return { state, search, execute, dashboard, save, start, stop, recoveredStalled, recoveredQueue, queue, safeMode, watchdog, selfCheck, vault };
}

if (process.env.ATLASZ_TEST_MODE !== "1") {
  const runtime = createRuntime();
  const server = http.createServer((req, res) => {
    const route = (req.url || "/").split("?")[0];
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") { res.writeHead(405); res.end('{"error":"read_only"}'); return; }
    const dashboard = runtime.dashboard();
    if (route === "/health") {
      res.end(JSON.stringify({ ok: true, version: VERSION, status: dashboard.status, safeMode: dashboard.safeMode.mode, selfCheck: dashboard.selfCheck.level, search: dashboard.search, lastSystemRun: dashboard.lastSystemRun }));
    } else if (route === "/opportunities") {
      res.end(JSON.stringify({ count: runtime.state.leads.length, topActionable: [], opportunities: runtime.state.leads.map(({ description, assessment, ...l }) => ({ ...l, score: assessment.score, checks: assessment.checks })), warning: "Unverified candidates are not approved for outreach." }));
    } else if (route === "/events") {
      res.end(JSON.stringify(runtime.state.events.slice(-100)));
    } else if (route === "/" || route === "/status" || route === "/revenue") {
      res.end(JSON.stringify(dashboard));
    } else { res.writeHead(404); res.end('{"error":"not_found"}'); }
  });
  server.listen(Number(process.env.PORT || 8080), "0.0.0.0", () => runtime.start());
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { runtime.stop(); server.close(() => process.exit(0)); });
}
