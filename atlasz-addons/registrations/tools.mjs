// Registrations: developer-assist analyzers, small knowledge/inbox tools and the runtime process itself.
// The analyzers are READ-ONLY over a project folder; every root is confined to the application directory (or the owner-chosen dev roots), so a tool caller cannot point them at arbitrary files.
// The legacy competition runtime (the three legacy runtime files) is deliberately NOT registered: the policy guard keeps it EXCLUDED_LEGACY until the owner decides to quarantine or remove it.
import fs from "node:fs"; import path from "node:path";
import { ANY, str, num, int, bool, arr, obj, cap, POLICY } from "./_util.mjs";
import { auditAccessibility } from "../a11y-audit.mjs";
import { assessArchitecture, planRefactor } from "../architecture-assessor.mjs";
import { prioritizeTests, findTestGaps } from "../test-intelligence.mjs";
import { extractApi, syncDocs, checkDocs, verifyTranslations, scanHardcodedStrings } from "../doc-sync.mjs";
import { checkStore, checkAuditChain, loadStore } from "../data-quality.mjs";
import { planMigration } from "../migration-planner.mjs";
import { parseFormHtml, buildFillPlan } from "../form-assistant.mjs";
import { analyzeFeedback, checkPlaceholders, extractPlaceholders } from "../translation-feedback.mjs";
import { caseMetrics } from "../retrieval-eval.mjs";
import { configureKnowledgeStore, ingestKnowledge, retrieveKnowledge, buildGroundedContext, knowledgeHealth } from "../enterprise-knowledge-agentic-rag.mjs";
import { createOrgIntelligence } from "../org-intelligence.mjs";
import { createVoiceInterface } from "../voice-interface.mjs";
import { traceEvent, evaluate as evalTrace, aggregateTraces } from "../tracing-evals.mjs";
import { createProject, updateProject, projectGet, projectList, attachProjectEvidence } from "../shared-project-registry.mjs";

const plain = x => JSON.parse(JSON.stringify(x ?? null));
const clip = (o, n = 60) => { const j = plain(o); for (const k of Object.keys(j ?? {})) if (Array.isArray(j[k]) && j[k].length > n) { j[k + "Total"] = j[k].length; j[k] = j[k].slice(0, n); } return j; };

export function registerTools(broker, ctx) {
  // ---- confinement: analyzers read only under the app directory, the owner's dev roots, or the self-test fixture
  const roots = () => [ctx.appDir, ...(ctx.devRoots?.() ?? [])].filter(Boolean).map(r => fs.realpathSync(r));
  const confine = r => { const real = fs.realpathSync(path.resolve(r)); if (!roots().some(b => real === b || real.startsWith(b + path.sep))) throw new Error("ROOT_OUTSIDE_ALLOWED_PROJECTS"); return real; };
  const fixture = () => { const d = path.join(ctx.stateDir, "devtools-fixture"); if (!fs.existsSync(path.join(d, "a.mjs"))) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "a.mjs"), 'import { b } from "./b.mjs";\nexport const a = () => b();\n'); fs.writeFileSync(path.join(d, "b.mjs"), 'import { a } from "./a.mjs";\nexport const b = () => typeof a;\n'); fs.writeFileSync(path.join(d, "a.test.mjs"), 'import { a } from "./a.mjs";\nimport test from "node:test";\ntest("a", () => a());\n'); fs.writeFileSync(path.join(d, "data.jsonl"), '{"id":1,"v":1}\n{"id":1,"v":2}\n'); } return d; };
  const confineOrFixture = r => (r && path.resolve(r) === path.resolve(fixture()) ? path.resolve(r) : confine(r));
  const ROOT = obj({ root: str({ maxLength: 500 }) }, ["root"]);
  const dev = (id, file, manager, purpose, caps, selfTest) => broker.register({ id, source: "atlasz-addons/" + file, manager, lifecycle: "ON_DEMAND", policy: POLICY.low, purpose, capabilities: caps, selfTest });

  broker.register({ id: "a11y-audit", source: "atlasz-addons/a11y-audit.mjs", manager: "MASTER_COORDINATOR", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Accessibility audit of supplied HTML/CSS/JS (contrast ratios, labels, alt text, focus, keyboard, ARIA names). Pure; the Control Center runs it in a worker thread with a timeout for its own UI (a11yAudit).",
    capabilities: [cap("audit", "INTERNAL_COMPUTE", a => plain(auditAccessibility(a)), { input: obj({ html: str({ maxLength: 500000 }), css: str({ maxLength: 500000 }), js: str({ maxLength: 500000 }) }), timeoutMs: 30000 })],
    selfTest: { capability: "audit", args: { html: "<html><body><img src=x></body></html>" }, expect: r => (JSON.stringify(r).includes("IMG_ALT") ? true : "a missing alt attribute must be reported") } });
  broker.register({ id: "a11y-worker", source: "atlasz-addons/a11y-worker.mjs", manager: "MASTER_COORDINATOR", lifecycle: "INTERNAL_LIBRARY", consumer: "a11y-audit", policy: POLICY.low, purpose: "Worker-thread entry that runs the accessibility audit off the request thread so a pathological input is killed by a timeout; used by the Control Center a11yAudit." });
  dev("architecture-assessor", "architecture-assessor.mjs", "MASTER_COORDINATOR", "Read-only architecture assessment of a project folder: import cycles, fan-in/out, layering violations, god modules, dead modules (low confidence for dynamic imports), duplicate-code clusters; refactor plans are PLANS only (appliesChanges:false).",
    [cap("assess", "READ_STATUS", a => clip(assessArchitecture({ root: confineOrFixture(a.root) })), { input: ROOT, timeoutMs: 60000 }), cap("plan_refactor", "READ_STATUS", a => plain(planRefactor({ root: confineOrFixture(a.root), change: a.change })), { input: obj({ root: str({ maxLength: 500 }), change: ANY }, ["root", "change"]), timeoutMs: 60000 })],
    { capability: "assess", get args() { return { root: fixture() }; }, expect: r => (JSON.stringify(r).includes("cycle") || JSON.stringify(r).toLowerCase().includes("cycl") ? true : "the fixture import cycle must be found") });
  broker.register({ id: "dev-assist-common", source: "atlasz-addons/dev-assist-common.mjs", manager: "MASTER_COORDINATOR", lifecycle: "INTERNAL_LIBRARY", consumer: "architecture-assessor", policy: POLICY.low, purpose: "Shared read-only folder walk, confined path resolver, JS tokenizer and static import graph used by the architecture, test, documentation, data-quality and migration analyzers." });
  dev("test-intelligence", "test-intelligence.mjs", "QUALITY_ASSURANCE", "Risk-based test prioritisation (static import reach, history), test-gap finder (a name is covered only when a test imports its module AND uses it) and scaffold text that fails until a person replaces it; read-only on the project.",
    [cap("prioritize", "READ_STATUS", a => clip(prioritizeTests({ root: confineOrFixture(a.root), changedFiles: a.changedFiles ?? [] })), { input: obj({ root: str({ maxLength: 500 }), changedFiles: arr(str({ maxLength: 320 })) }, ["root"]), timeoutMs: 60000 }), cap("gaps", "READ_STATUS", a => clip(findTestGaps({ root: confineOrFixture(a.root) })), { input: ROOT, timeoutMs: 60000 })],
    { capability: "prioritize", get args() { return { root: fixture(), changedFiles: ["b.mjs"] }; }, expect: r => (JSON.stringify(r).includes("a.test.mjs") ? true : "a.test.mjs reaches b.mjs through a.mjs and must be planned") });
  dev("doc-sync", "doc-sync.mjs", "RECOVERY_MAINTENANCE", "Documentation synchronisation (undocumented / stale / removed API against README and docs), a CI-style docs check, and hu/en translation verification (missing keys, placeholder mismatches, mojibake); read-only.",
    [cap("api", "READ_STATUS", a => clip(extractApi({ root: confineOrFixture(a.root) })), { input: ROOT, timeoutMs: 60000 }), cap("sync", "READ_STATUS", a => clip(syncDocs({ root: confineOrFixture(a.root) })), { input: ROOT, timeoutMs: 60000 }), cap("check", "READ_STATUS", a => clip(checkDocs({ root: confineOrFixture(a.root) })), { input: ROOT, timeoutMs: 60000 }),
     cap("verify_translations", "INTERNAL_COMPUTE", a => plain(verifyTranslations({ hu: a.hu, en: a.en })), { input: obj({ hu: ANY, en: ANY }, ["hu", "en"]) })],
    { capability: "verify_translations", args: { hu: { greet: "Szia {name}" }, en: { greet: "Hello" } }, expect: r => (JSON.stringify(r).toLowerCase().includes("placeholder") ? true : "a placeholder mismatch must be reported") });
  dev("data-quality", "data-quality.mjs", "RECOVERY_MAINTENANCE", "Data-quality monitor over JSON/JSONL/CSV stores (duplicate keys, null rates, schema drift, outliers, stale files) and hash-chain verification of audit files; read-only, writes nothing.",
    [cap("check_store", "READ_STATUS", a => clip(checkStore({ root: confineOrFixture(a.root), file: a.file, key: a.key ?? null })), { input: obj({ root: str({ maxLength: 500 }), file: str({ maxLength: 320 }), key: str({ maxLength: 80 }) }, ["root", "file"]) }), cap("audit_chain", "READ_STATUS", a => plain(checkAuditChain({ root: confineOrFixture(a.root), file: a.file })), { input: obj({ root: str({ maxLength: 500 }), file: str({ maxLength: 320 }) }, ["root", "file"]) })],
    { capability: "check_store", get args() { return { root: fixture(), file: "data.jsonl", key: "id" }; }, expect: r => (JSON.stringify(r).toLowerCase().includes("duplicate") ? true : "the duplicated key must be reported") });
  dev("migration-planner", "migration-planner.mjs", "RECOVERY_MAINTENANCE", "Data-migration DRY-RUN planning (operations, reversibility, checksums, blockers, plan hash). Applying a migration needs a signed owner approval bound to the plan hash and is NOT exposed; the trial-in-copy path writes files and is also not exposed.",
    [cap("plan", "READ_STATUS", a => clip(planMigration({ sourceRoot: confineOrFixture(a.sourceRoot), files: a.files, source: a.source, target: a.target, mapping: a.mapping ?? {} })), { input: obj({ sourceRoot: str({ maxLength: 500 }), files: arr(str({ maxLength: 200 })), source: ANY, target: ANY, mapping: ANY }, ["sourceRoot", "files", "source", "target"]), timeoutMs: 60000 })],
    { capability: "plan", get args() { return { sourceRoot: fixture(), files: ["data.jsonl"], source: { type: "JSONL", fields: { id: "number", v: "number" } }, target: { type: "JSONL", fields: { id: "number", value: "number" } }, mapping: { renames: { v: "value" } } }; }, expect: r => (r && typeof r === "object" ? true : "plan") });
  dev("form-assistant", "form-assistant.mjs", "MASTER_COORDINATOR", "Form-fill DRY RUN: detects field types and proposes values only from an owner-approved profile; passwords, cards, government ids and one-time codes are never filled, consent boxes never ticked, nothing is submitted (no browser code exists here).",
    [cap("parse", "INTERNAL_COMPUTE", a => plain(parseFormHtml(a.html)), { input: obj({ html: str({ maxLength: 200000 }) }, ["html"]) }), cap("plan", "DRAFT", a => plain(buildFillPlan({ form: a.form ?? parseFormHtml(a.html), profile: a.profile, ownerAuth: ctx.ownerAuthOrNull?.() ?? null, submit: false })), { input: obj({ html: str({ maxLength: 200000 }), form: ANY, profile: ANY }, ["profile"]) })],
    { capability: "parse", args: { html: '<form><input name="email" type="email"><input name="pw" type="password"></form>' }, expect: r => (JSON.stringify(r).toLowerCase().includes("password") ? true : "the password field must be detected") });
  broker.register({ id: "translation-feedback", source: "atlasz-addons/translation-feedback.mjs", manager: "MEMORY_KNOWLEDGE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Feedback analysis that works WITHOUT a model (TF-IDF themes, EN+HU sentiment with negation, quoted evidence) and placeholder checks; HU<->EN translation and reply drafting are model paths that fail closed (MODEL_NOT_CONFIGURED) until a usable model exists.",
    capabilities: [cap("analyze_feedback", "INTERNAL_COMPUTE", async a => plain(await analyzeFeedback({ items: a.items })), { input: obj({ items: arr(ANY) }, ["items"]) }), cap("placeholders", "INTERNAL_COMPUTE", a => plain({ found: extractPlaceholders(a.text) }), { input: obj({ text: str({ maxLength: 5000 }) }, ["text"]) })],
    selfTest: { capability: "analyze_feedback", args: { items: [{ id: "1", text: "great service, very fast" }, { id: "2", text: "slow and bad support" }] }, needs: () => (ctx.usableModelCount?.() > 0 ? null : "a usable AI model for translation and reply drafting (feedback analysis itself works without one)"), expect: r => (JSON.stringify(r).length > 20 ? true : "analysis") } });
  broker.register({ id: "retrieval-eval", source: "atlasz-addons/retrieval-eval.mjs", manager: "MEMORY_KNOWLEDGE_MANAGER", lifecycle: "BUILD_ONLY", policy: POLICY.low,
    activation: "Run by the retrieval benchmark (docs/audit/retrieval_benchmark.mjs) and tests to compare BM25 / n-gram / neural retrieval on a labelled SYNTHETIC corpus; results with the test-fixture embedder prove plumbing only and are never runtime evidence.",
    purpose: "Retrieval quality metrics (recall, MRR, nDCG) over a labelled corpus; build/test-time only." });
  broker.register({ id: "alt-solution-harness", source: "atlasz-addons/alt-solution-harness.mjs", manager: "EXECUTION_AGENT_MANAGER", lifecycle: "OFFLINE_ACTIVATED", policy: POLICY.security,
    activation: "Activated only when the owner runs an alternative-solution comparison: candidate JavaScript runs in the restricted sandbox (separate process, private work dir, timeout and output caps) and NEVER in-process; if the sandbox cannot isolate, the candidate is NOT_RUN. No automatic runtime path exists by design.",
    purpose: "Runs several candidate solutions against the same hidden tests inside the restricted sandbox and compares results; never evaluates candidate code itself." });
  broker.register({ id: "code-edit-workflow", source: "atlasz-addons/code-edit-workflow.mjs", manager: "EXECUTION_AGENT_MANAGER", lifecycle: "OFFLINE_ACTIVATED", policy: POLICY.security,
    activation: "Hosted by the runtime child (propose > independent review > owner-approved apply with snapshot, tests and automatic restore). Applying a change needs a signed owner approval bound to the exact change digest, so it is an owner-initiated flow, not an autonomous one.",
    purpose: "Governed code-edit and repair workflow: propose, independent review (maker != checker), owner-approved apply with snapshot and rollback; no model, network, git or push." });

  // ---- enterprise knowledge (durable, tenant-isolated, lexical retrieval; the hub in the runtime child uses the same library)
  let ragReady = false; const rag = () => { if (!ragReady) { configureKnowledgeStore({ file: path.join(ctx.stateDir, "knowledge-cc", "enterprise-store.json") }); ragReady = true; } };
  broker.register({ id: "enterprise-knowledge-agentic-rag", source: "atlasz-addons/enterprise-knowledge-agentic-rag.mjs", manager: "MEMORY_KNOWLEDGE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.draft,
    purpose: "Durable (atomic, 0600) tenant- and role-isolated knowledge store with lexical, extractive retrieval and a grounded-context builder that tells the model to separate evidence from inference. Semantic/vector ranking is NOT provided here.",
    capabilities: [
      cap("ingest", "INTERNAL_BRAIN_ACTION", a => { rag(); const i = ingestKnowledge(a); return { id: i.id, tenantId: i.tenantId, verified: i.verified }; }, { input: obj({ tenantId: str({ maxLength: 40 }), sourceId: str({ maxLength: 120 }), title: str({ maxLength: 200 }), text: str({ maxLength: 100000 }), uri: str({ maxLength: 500 }), classification: str({ maxLength: 20 }), allowedRoles: arr(str({ maxLength: 40 })), verified: bool() }, ["tenantId", "sourceId", "text"]) }),
      cap("retrieve", "READ_STATUS", a => { rag(); return { evidence: plain(retrieveKnowledge(a)) }; }, { input: obj({ query: str({ maxLength: 500 }), tenantId: str({ maxLength: 40 }), role: str({ maxLength: 40 }), limit: int({ minimum: 1, maximum: 20 }), verifiedOnly: bool() }, ["query", "tenantId"]) }),
      cap("grounded_context", "READ_STATUS", a => { rag(); return plain(buildGroundedContext(a)); }, { input: obj({ query: str({ maxLength: 500 }), tenantId: str({ maxLength: 40 }), role: str({ maxLength: 40 }), limit: int({ minimum: 1, maximum: 20 }) }, ["query", "tenantId"]) }),
      cap("health", "READ_STATUS", a => { rag(); return plain(knowledgeHealth(a)); }, { input: obj({ tenantId: str({ maxLength: 40 }) }) })
    ],
    selfTest: { capability: "retrieve", args: { query: "nothing", tenantId: "SELFTEST_EMPTY" }, expect: r => (Array.isArray(r.evidence) && r.evidence.length === 0 ? true : "an empty tenant must return no evidence") } });
  let org = null; const orgs = () => (org ??= createOrgIntelligence({ dir: path.join(ctx.stateDir, "org-intelligence"), isSourceApproved: id => { try { return ctx.sourceAllowlist().effective(id) !== null; } catch { return false; } } }));
  broker.register({ id: "org-intelligence", source: "atlasz-addons/org-intelligence.mjs", manager: "GLOBAL_BUSINESS_INTELLIGENCE", lifecycle: "ON_DEMAND", policy: POLICY.draft,
    purpose: "Organisation intelligence STORE (no fetching, scraping or contact): every field assertion carries provenance and confidence, conflicts are preserved side by side, only owner-allowlisted sources or the explicit manual source are accepted, personal data lives only in lawful-basis contact records with export/forget support.",
    capabilities: [cap("summary", "READ_STATUS", () => plain(orgs().summary())), cap("list_orgs", "READ_STATUS", () => ({ orgs: orgs().listOrgs() })), cap("view", "READ_STATUS", a => plain(orgs().view(a.orgId)), { input: obj({ orgId: str({ maxLength: 120 }) }, ["orgId"]) }), cap("audit_state", "READ_STATUS", () => plain(orgs().auditVerify()))],
    selfTest: { capability: "audit_state", expect: r => (r && typeof r === "object" ? true : "audit") } });
  broker.register({ id: "voice-interface", source: "atlasz-addons/voice-interface.mjs", manager: "MASTER_COORDINATOR", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Voice capability status: speech-to-text and text-to-speech are PLACEHOLDER_UNCONNECTED until real providers are attached and probed; this module reports that and never fakes a transcript.",
    capabilities: [cap("status", "READ_STATUS", () => plain(createVoiceInterface({}).status()))],
    selfTest: { capability: "status", expect: r => (r.live === false && r.state === "PLACEHOLDER_UNCONNECTED" ? true : "voice must not claim LIVE without providers") } });
  broker.register({ id: "tracing-evals", source: "atlasz-addons/tracing-evals.mjs", manager: "QUALITY_ASSURANCE", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Trace event construction with secret redaction, criteria-based output evaluation (NONEMPTY / CONTAINS / EVIDENCE) and trace aggregation (cost, failures, agents).",
    capabilities: [cap("trace", "INTERNAL_COMPUTE", a => plain(traceEvent(a)), { input: obj({ traceId: str({ maxLength: 40 }), agentId: str({ maxLength: 40 }), type: str({ maxLength: 40 }), tool: str({ maxLength: 80 }), status: str({ maxLength: 20 }), durationMs: num({ minimum: 0 }), costUsd: num({ minimum: 0 }), details: ANY }, ["durationMs"]) }), cap("evaluate", "INTERNAL_COMPUTE", a => plain(evalTrace(a)), { input: obj({ output: ANY, criteria: arr(ANY), evidence: arr(ANY) }, ["criteria"]) }), cap("aggregate", "INTERNAL_COMPUTE", a => plain(aggregateTraces(a.events)), { input: obj({ events: arr(ANY) }, ["events"]) })],
    selfTest: { capability: "trace", args: { durationMs: 5, details: { note: "key sk-abcdefghijklmnop leaked" } }, expect: r => (!JSON.stringify(r).includes("sk-abcdefghijklmnop") ? true : "secrets must be redacted from trace details") } });
  broker.register({ id: "shared-project-registry", source: "atlasz-addons/shared-project-registry.mjs", manager: "WORKFORCE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.draft,
    purpose: "Process-local canonical project records (objective, tasks, files, agents, evidence, approvals); the owner is always JOCI and cannot be changed by an update. Durable job state lives in the Master queue; this registry is empty after a restart.",
    capabilities: [
      cap("create", "INTERNAL_COMPUTE", a => plain(createProject(a)), { input: obj({ projectId: str({ maxLength: 80 }), objective: str({ maxLength: 500 }), metadata: ANY }, ["projectId", "objective"]) }),
      cap("get", "READ_STATUS", a => ({ project: plain(projectGet(a.projectId)) }), { input: obj({ projectId: str({ maxLength: 80 }) }, ["projectId"]) }),
      cap("list", "READ_STATUS", () => ({ projects: plain(projectList().map(p => ({ projectId: p.projectId, status: p.status, owner: p.owner }))) })),
      cap("update", "INTERNAL_COMPUTE", a => plain(updateProject(a.projectId, a.patch ?? {})), { input: obj({ projectId: str({ maxLength: 80 }), patch: ANY }, ["projectId"]) }),
      cap("attach_evidence", "INTERNAL_COMPUTE", a => plain(attachProjectEvidence(a.projectId, a.evidence)), { input: obj({ projectId: str({ maxLength: 80 }), evidence: ANY }, ["projectId", "evidence"]) })
    ],
    selfTest: { capability: "list", expect: r => (Array.isArray(r.projects) ? true : "list") } });

  // ---- the runtime process: status is read from the real child (token-authenticated /status); not running is reported as such, never as healthy
  broker.register({ id: "atlasz-runtime", source: "atlasz-runtime/supervisor-safe.mjs", manager: "RUNTIME_SUPERVISOR", lifecycle: "CONTINUOUS", policy: POLICY.low,
    purpose: "The canonical runtime child (5 SEARCH + 25 EXECUTION agent loop, screening, scheduler, tool registry, money engine) started and supervised by the Control Center. This module reports the REAL process state from its authenticated status endpoint; start/stop remain owner actions of the Control Center.",
    capabilities: [cap("status", "READ_STATUS", async () => { const r = await ctx.runtimeStatus(); return plain({ reachable: r.reachable, managedByControlCenter: r.managedByControlCenter, reason: r.reason, version: r.version, status: r.status, lastExit: r.lastExit }); }, { timeoutMs: 15000 })],
    selfTest: { capability: "status", needs: () => (ctx.runtimeRunning?.() ? null : "the runtime child process (not running right now; start it from the Control Center)"), expect: r => (typeof r.reachable === "boolean" ? true : "status shape") } });
  broker.register({ id: "internal-integration-hub", source: "atlasz-addons/internal-integration-hub.mjs", manager: "RUNTIME_SUPERVISOR", lifecycle: "INTERNAL_LIBRARY", consumer: "atlasz-runtime", policy: POLICY.draft,
    purpose: "Internal add-on hub instantiated by the runtime child (createInternalAddonHub): bridges the legacy add-on stubs with no external sends, payments, deployments or secrets." });
  for (const [id, file, what] of [["runtime-http", "runtime-http.mjs", "authenticated HTTP surface of the runtime (only /health is open; every other route needs the token; read-only; throttled)"]])
    broker.register({ id, source: "atlasz-runtime/" + file, manager: "RUNTIME_SUPERVISOR", lifecycle: "INTERNAL_LIBRARY", consumer: "atlasz-runtime", policy: POLICY.low, purpose: "The " + what + "." });
  broker.register({ id: "owner-cli", source: "atlasz-runtime/owner-cli.mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "OFFLINE_ACTIVATED", policy: POLICY.security,
    activation: "Run by JOCI on his own device (node owner-cli.mjs keygen | sign | emergency): the private key never reaches the server. It is intentionally not reachable from any runtime path, and the emergency subcommand works on the durable state directory even when the app is down.",
    purpose: "Owner command line: key generation, approval signing and a kill-switch path that works with the GUI and runtime down." });
}
