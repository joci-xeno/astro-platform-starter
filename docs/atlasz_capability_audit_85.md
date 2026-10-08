# ATLASZ V7.3 — 85-capability audit

Statuses: MISSING 14, PARTIAL 42, EXTERNAL_BLOCKER 23, VERIFIED_WORKING 6, total 85

## M01 — Universal AI Browser Sidebar — **MISSING**
- Registry links (candidates): V73-S19-001, V73-S19-002, V73-S19-003, V73-S19-004, V73-S19-005, V73-S19-006
- Modules: atlasz-addons/computer-use-fabric.mjs (action policy only); tool-fabric.mjs (catalogue entry 'browser')
- Evidence: Policy tests for AUTO/ASK/FORBIDDEN actions only (computer-use-fabric tests). No browser companion exists.
- Missing: Browser extension/sidebar, page extraction, page Q&A, task launch
- Integration gaps / blockers: Needs an extension host; page content is untrusted input -> must pass Security Brain
- Security: Page text is hostile input; no auto-actions; owner approval for any task launch
- Plan: Build page-content ingestion (security-screened, provenance) as a reusable module; extension shell itself needs a browser-extension build (blocked on distribution/approval)
- Tests required: ingest screening, injection quarantine, provenance, no-action-without-approval

## M02 — Intelligent Knowledge Projects — **PARTIAL**
- Registry links (candidates): V73-S03-017, V73-S05-013, V73-S06-002, V73-S06-007, V73-S07-001, V73-S07-002
- Modules: document-center.mjs; brain/knowledge-brain.mjs; brain/memory-fabric.mjs; shared-project-registry.mjs; business/entity-graph.mjs
- Evidence: document-intelligence.test (6), doc-extractors.test (5), memory-fabric.test, knowledge-brain tests
- Missing: Named workspaces grouping docs/notes/webpages/images with source refs; semantic (embedding) retrieval
- Integration gaps / blockers: Search is keyword-token based, no embeddings; shared-project-registry is in-process
- Security: Tenant+role gates already enforced; screening before agent read
- Plan: Build Knowledge Projects over document-center (collections, members, citations); embeddings need a provider (EXTERNAL) so token retrieval stays labelled non-semantic
- Tests required: project isolation, citation traceability, superseded versions, agent-read gating

## M03 — Multi-Model Conversation Interface — **PARTIAL**
- Registry links (candidates): V73-S02-002, V73-S03-007, V73-S03-010, V73-S08-001, V73-S08-002, V73-S08-003
- Modules: multi-model-brain.mjs; provider-resilience.mjs; brain/model-intelligence.mjs; cost-model-router.mjs
- Evidence: provider-resilience.test, brain-systems.test (deterministic clock), contract tests
- Missing: Shared conversation object, per-turn model switching, context windows, per-conversation cost
- Integration gaps / blockers: No provider is LIVE; no conversation/context manager
- Security: Keys server-side only; LIVE only from our own probe
- Plan: Conversation manager with context budget + token/cost accounting over existing router; providers stay blocked
- Tests required: context trimming, switch audit, cost accrual, no-LIVE-without-probe

## M04 — Autonomous Task Agent — **PARTIAL**
- Registry links (candidates): V73-S03-001, V73-S03-002, V73-S03-003, V73-S03-004, V73-S03-005, V73-S03-006
- Modules: brain/orchestrator.mjs; brain/planning-brain.mjs; brain/governed-dispatch.mjs; master-planner-orchestrator.mjs
- Evidence: brain-orchestration.test, governed-dispatch.test, brain-runtime-wiring.test
- Missing: Real tool/model execution for documents/research/calculations/artifacts (no live models)
- Integration gaps / blockers: Tool execution is adapter-gated; typed tool calls missing
- Security: Control chain on every action
- Plan: Typed tool registry (shared) + sandboxed calculation so plans can execute locally verifiable steps
- Tests required: plan->tool->verify loops, failure replan, approval points

## M05 — Skills and Plugin Framework — **PARTIAL**
- Registry links (candidates): V73-S02-002, V73-S09-015, V73-S18-004, V73-S21-039, V73-S21-040, V73-S22-001
- Modules: plugin-manager.mjs; skill-factory.mjs; capability-registry.mjs; control-center plugin panel
- Evidence: plugin-manager.test, control-center-plugins.test (manifest validation, permissions, isolated hook process, health)
- Missing: Versioned install from package, rollback of a bad plugin version, skill testing harness
- Integration gaps / blockers: Skill Factory creates definitions only
- Security: Plugin code never runs in core process; forbidden permissions refused
- Plan: Add versioned skill packages with test-gate + rollback on the shared typed-tool registry
- Tests required: install/upgrade/rollback, permission escalation refused

## M06 — Isolated Sandbox Workspace — **PARTIAL**
- Registry links (candidates): V73-S19-001, V73-S19-002, V73-S19-003, V73-S19-004, V73-S19-005, V73-S19-006
- Modules: computer-use-fabric.mjs (policy); plugin-manager.mjs (child process, minimal env, timeout)
- Evidence: plugin-manager.test timeouts/containment
- Missing: General code execution sandbox with CPU/memory/time/file limits and no network
- Integration gaps / blockers: No OS-level isolation (namespaces/containers) available to verify here
- Security: Untrusted code must never get secrets; honest label if isolation is process-level only
- Plan: Build code-sandbox runner (child process, rlimits, scrubbed env, temp dir, output caps) and label isolation level truthfully
- Tests required: timeout kill, memory cap, env scrub, path escape refused, output cap

## M07 — Advanced Analyst Mode — **MISSING**
- Registry links (candidates): V73-S09-020, V73-S26-006, V73-S30-007, ATLASZ-BR-004
- Modules: doc-extractors.mjs (XLSX/ODS read); tool-fabric.mjs (catalogue 'data-analysis')
- Evidence: Extractors read spreadsheets as text only
- Missing: Cleaning, calculation, statistics, charts, reproducible reports
- Integration gaps / blockers: Needs sandbox runner + deterministic calc library
- Security: Computations must be reproducible and hash-recorded
- Plan: Analyst module: CSV/XLSX table load, profile, clean, stats, chart spec (data only), report with input hashes
- Tests required: stats correctness vs known values, malformed input, reproducibility hash

## M08 — Deep Research — **PARTIAL**
- Registry links (candidates): V73-S03-011, V73-S07-005, V73-S07-016, V73-S09-005, V73-S09-006, V73-S09-015
- Modules: brain/verifier.mjs; brain/evidence-sources.mjs; market-intelligence-engine.mjs; enterprise-knowledge-agentic-rag.mjs
- Evidence: evidence-sources.test, brain verifier tests
- Missing: Multi-source collection, citation tracking, evidence comparison, uncertainty report
- Integration gaps / blockers: No live web provider; no citation ledger
- Security: Fetched pages are untrusted; claims need provenance
- Plan: Research ledger: source records (url/hash/retrieved_at), claims linked to sources, agreement/conflict/uncertainty; fetcher is injected (provider blocked)
- Tests required: claim-source linkage, conflict flagging, stale-source detection, no uncited claim marked VERIFIED

## M09 — Video Intelligence — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S05-012, V73-S05-013, V73-S28-002
- Modules: voice-session.mjs (state machine only)
- Evidence: None for video
- Missing: Video/transcript analysis, timestamps, summaries
- Integration gaps / blockers: Needs transcription/vision provider
- Security: Authorized videos only; privacy class
- Plan: Transcript-based pipeline (timestamped transcript ingest -> index -> summary/action steps) buildable without a provider when a transcript is supplied
- Tests required: timestamp integrity, transcript screening, action-step verification

## M10 — Creative Studio — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S09-024, V73-S22-006, V73-S23-012, V73-S28-001, V73-S28-002, V73-S28-003
- Modules: tool-fabric.mjs (catalogue only)
- Evidence: None
- Missing: Image/doc/slide creation through providers
- Integration gaps / blockers: No generation provider
- Security: Generated content labelled; no impersonation/trademark reproduction
- Plan: Modality fabric slots + job records; providers blocked
- Tests required: provider-slot honesty, content labelling

## M11 — Intelligent Communication Assistant — **PARTIAL**
- Registry links (candidates): V73-S04-011, V73-S25-001, V73-S25-002, V73-S25-003, V73-S25-004, V73-S25-005
- Modules: business/communication-center.mjs; business/inbox-pipeline.mjs; universal-inbox.mjs; human-core.mjs
- Evidence: inbox-pipeline.test (6), universal-inbox.test, business-engines.test (DRAFT/QUEUED != SENT)
- Missing: Real email/chat connector; drafting with a language model
- Integration gaps / blockers: No connector credentials/model; sending is approval-gated
- Security: External sending always needs owner approval + provider evidence
- Plan: Keep as is; add draft-with-verified-context helper when a model is connected
- Tests required: draft provenance, approval before send, no SENT without provider ref

## M12 — Custom AI Assistants — **PARTIAL**
- Registry links (candidates): V73-S04-010, V73-S06-001, V73-S06-002, V73-S06-003, V73-S06-004, V73-S06-005
- Modules: agent-factory.mjs; owner-control/agent-governor.mjs; capability-graph.mjs
- Evidence: agent-factory-governor.test (31st agent refused, unknown capability refused)
- Missing: Configurable assistant profiles (instructions, tools, memory scope, permissions) separate from the fixed 30 runtime agents
- Integration gaps / blockers: Fixed 30 limit applies to runtime agents; profiles are not agents
- Security: Profiles cannot add agents or permissions beyond the owner grant
- Plan: Assistant Profiles module (config only, no extra agents) using memory scopes + typed tool allowlists
- Tests required: profile cannot exceed grants, scope isolation, no agent-count change

## M13 — Interactive Artifacts and Prototypes — **PARTIAL**
- Registry links (candidates): V73-S06-011, ATLASZ-BR-027, ATLASZ-PKG84-004, ATLASZ-PKG84-007, ATLASZ-PKG84-012
- Modules: business/artifact-registry.mjs; atlasz-control-center (own UI)
- Evidence: business-engines.test (content-addressed artifacts, CREATED!=VERIFIED!=DELIVERED)
- Missing: Chart/diagram/app preview generation and rendering
- Integration gaps / blockers: Artifact store has no preview renderer
- Security: Previews must be sandboxed (no script from untrusted artifacts)
- Plan: Static preview generator (SVG/HTML with CSP, data-only charts) registered as artifacts
- Tests required: preview sandbox/CSP, content hash, no remote loads

## C01 — Advanced Software Engineering Agent — **MISSING**
- Registry links (candidates): V73-S08-001, V73-S08-007, V73-S12-005, V73-S12-006, V73-S16-003, V73-S20-006
- Modules: tool-fabric.mjs (catalogue 'code','test','github'); regression-eval-suite.mjs; skill-factory.mjs
- Evidence: Only catalogue entries and an eval suite scaffold
- Missing: Repo analysis, edit, test run, review workflow as governed tools
- Integration gaps / blockers: No code tools wired; needs sandbox + typed tools
- Security: Writes only inside a project sandbox; no push without approval
- Plan: Engineering toolkit on shared sandbox: repo scan, test runner, diff review (P07) — read/analyze first
- Tests required: repo scan correctness, test-run capture, path escape refused

## C02 — Computer-Based Task Execution — **PARTIAL**
- Registry links (candidates): V73-S02-001, V73-S05-016, V73-S19-001, V73-S19-002, V73-S19-003, V73-S19-004
- Modules: computer-use-fabric.mjs; tool-fabric.mjs
- Evidence: computer-use-fabric tests (AUTO/ASK/FORBIDDEN, kill switch, audit)
- Missing: Real provider executing actions
- Integration gaps / blockers: Provider PLACEHOLDER_UNCONNECTED; never reports LIVE
- Security: Policy engine already fail-closed
- Plan: Keep policy; connect a provider only when one exists and is probed
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## C03 — Multi-Agent Coordination — **PARTIAL**
- Registry links (candidates): V73-S02-001, V73-S02-002, V73-S02-003, V73-S03-001, V73-S03-002, V73-S03-003
- Modules: brain/orchestrator.mjs; brain/capability-graph.mjs; owner-control/agent-governor.mjs; durable-queue.mjs; brain/governed-dispatch.mjs
- Evidence: brain-orchestration.test, canonical-runtime.test (5+25), durable-queue.test (backpressure), governed-dispatch.test
- Missing: Explicit task ownership/dependency handoff verification across agents at runtime; concurrency limits per type
- Integration gaps / blockers: Agent-to-agent handoff verification and duplicate-work detection only partly covered
- Security: Topology fixed at 30; governor refuses extras
- Plan: Handoff contract + duplicate-work check on top of governed dispatch
- Tests required: handoff acceptance, duplicate dispatch refused, dependency order

## C04 — Computer Use — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S02-001, V73-S19-001, V73-S19-002, V73-S19-003, V73-S19-004, V73-S19-005
- Modules: computer-use-fabric.mjs
- Evidence: Policy tests only
- Missing: Visual interaction provider
- Integration gaps / blockers: No provider
- Security: Same as C02
- Plan: Provider-dependent; policy already built
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## C05 — Reusable Agent Skills — **PARTIAL**
- Registry links (candidates): V73-S09-015, V73-S18-004, V73-S29-004, V73-S29-008, ATLASZ-BR-014, ATLASZ-OSC-018
- Modules: skill-factory.mjs; capability-graph.mjs; plugin-manager.mjs
- Evidence: skill-factory + capability-graph tests
- Missing: Versioned skill definitions with permission boundary and a pass/fail test gate before activation
- Integration gaps / blockers: Skill Factory registers definitions untested
- Security: Skills inherit caller permissions only
- Plan: Skill package format + test gate (shared with M05)
- Tests required: version pin, test-gate refusal, permission boundary

## C06 — MCP Integration Framework — **PARTIAL**
- Registry links (candidates): V73-S02-001, V73-S02-002, V73-S12-006, V73-S18-010, V73-S18-014, V73-S20-001
- Modules: connector-catalog.mjs; universal-connector-layer.mjs; tool-bridge.mjs; secret-vault.mjs
- Evidence: connector-catalog.test + typed-tools.test (typed descriptors, approval classes, timeout/failure containment)
- Missing: MCP transport/protocol client and capability discovery against a real MCP server (EXTERNAL: no server available)
- Integration gaps / blockers: Tool Bridge has no tests; MCP transport missing
- Security: Credentials only via vault; each MCP tool call approval-classed
- Plan: Define MCP-style tool descriptor + typed invocation over the shared registry; transport blocked until an MCP server is available
- Tests required: descriptor validation, auth failure, approval classes, timeout/failure handling

## C07 — Project Memory — **PARTIAL**
- Registry links (candidates): V73-S03-017, V73-S04-010, V73-S05-013, V73-S06-002, V73-S07-001, V73-S07-002
- Modules: brain/memory-fabric.mjs; brain/knowledge-brain.mjs; business-memory.mjs; experience-learning-engine.mjs; shared-project-registry.mjs
- Evidence: memory-fabric.test (tenant isolation, HISTORICAL_RESULT only from independent ACCEPT)
- Missing: Decision log with provenance across sessions; project registry is in-process
- Integration gaps / blockers: shared-project-registry not durable
- Security: Tenant isolation verified
- Plan: Persist shared-project-registry; decision records in Knowledge Projects
- Tests required: restart durability, tenant isolation, provenance required

## C08 — Advanced Research — **PARTIAL**
- Registry links (candidates): V73-S09-005, V73-S09-006, V73-S09-015, V73-S31-005, V73-S32-006, V73-S38-004
- Modules: see M08
- Evidence: see M08
- Missing: see M08
- Integration gaps / blockers: see M08
- Security: see M08
- Plan: Shared with M08 (research ledger)
- Tests required: see M08

## C09 — Interactive Artifact Generation — **PARTIAL**
- Registry links (candidates): ATLASZ-BR-027, ATLASZ-PKG84-004, ATLASZ-PKG84-007, ATLASZ-PKG84-012
- Modules: see M13
- Evidence: see M13
- Missing: see M13
- Integration gaps / blockers: see M13
- Security: see M13
- Plan: Shared with M13
- Tests required: see M13

## C10 — Adaptive Reasoning Allocation — **PARTIAL**
- Registry links (candidates): V73-S02-002, V73-S03-001, V73-S03-007, V73-S03-010, V73-S08-001, V73-S08-002
- Modules: brain/model-intelligence.mjs; cost-model-router.mjs; budget-consumption-governor.mjs
- Evidence: brain-systems.test routing by measured suitability
- Missing: Effort/depth selection by complexity, risk and budget
- Integration gaps / blockers: Router picks a model, not an effort level
- Security: Spend limited by no-spend default
- Plan: Effort policy function (complexity x risk x budget -> tier) feeding the router
- Tests required: tier monotonic in risk, never exceeds budget, no-spend respected

## C11 — Permission-Aware Knowledge Search — **VERIFIED_WORKING**
- Registry links (candidates): V73-S02-003, V73-S06-007, V73-S07-001, V73-S07-002, V73-S07-003, V73-S07-004
- Modules: document-center.mjs; tenant-isolation.mjs; enterprise-knowledge-agentic-rag.mjs
- Evidence: document-intelligence.test (tenant+role gate on list/search/get/versions, forAgent read, 4 mutation checks); tenant-isolation.test
- Missing: None for document scope; other knowledge stores covered by tenant-isolation
- Integration gaps / blockers: Enterprise RAG is in-memory demo (separate item G07/GE09)
- Security: Role/tenant enforced at every read; SECRET hidden
- Plan: Keep; reuse in Knowledge Projects
- Tests required: (done) + regression

## C12 — Scheduled and Recurring Tasks — **VERIFIED_WORKING**
- Registry links (candidates): V73-S10-001, V73-S10-002, V73-S10-003, V73-S10-004, V73-S10-005, V73-S10-006
- Modules: atlasz-addons/scheduler.mjs; atlasz-addons/typed-tools.mjs; atlasz-addons/personal-command-center.mjs; supervisor-safe.mjs (tick every 30s); business/recurring-billing.mjs
- Evidence: scheduler.test (7: restart persistence, outage = one run + missedRuns, exponential backoff, failed-ONCE/paused-by-failures, approval-gated external tools, emergency-stop halt, crash->INTERRUPTED, corrupt file never replaced; 8 mutation checks caught, 1 equivalent), personal-command-center.test E2E (scheduled job -> typed tool -> PCC item, survives restart, halted by stop), money-engine-hosted.test (hosted tick)
- Missing: Cron expressions (ONCE/INTERVAL/DAILY only); exactly-once delivery (at-least-once, disclosed); calendar-aware (timezone/DST) schedules
- Integration gaps / blockers: Runs inside the supervisor process; the Control Center only reads the persisted schedule file (no schedule creation UI yet)
- Security: Schedules cannot grant authority; external actions still go through the control chain
- Plan: Build durable scheduler (shared with P06/P08/P11)
- Tests required: restart persistence, catch-up limit, retry/backoff, kill-switch/safe-mode stop, owner pause

## C13 — Advanced Administration and Security — **VERIFIED_WORKING**
- Registry links (candidates): V73-S02-001, V73-S02-002, V73-S02-003, V73-S03-014, V73-S06-004, V73-S06-007
- Modules: owner-auth.mjs; owner-control/*; secret-vault.mjs; audit-chain.mjs; brain/security-brain.mjs; safe-mode.mjs
- Evidence: owner-auth.test (24), owner-control-bypass/core/extra tests, safety-modules.test, control-center-ownersafety.test, emergency-stop.test
- Missing: Multi-user RBAC (not required: single-owner model by design)
- Integration gaps / blockers: Single owner; no delegated admin roles
- Security: Ed25519 single-use bound approvals; vault AES-256-GCM; hash-chained audit
- Plan: Keep; only extend if the owner later wants delegated admins
- Tests required: (done) + regression

## G01 — Social Information Search — **EXTERNAL_BLOCKER**
- Registry links (candidates): none
- Modules: market-intelligence-engine.mjs; tech-watch.mjs (file feeds)
- Evidence: Offline feed-file monitoring only
- Missing: Approved social sources
- Integration gaps / blockers: No credentials/provider; platform ToS
- Security: Public/approved sources only; no scraping bypass
- Plan: Source-adapter slot with provenance + rate state; blocked until credentials exist
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## G02 — Live Web Research — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S09-005, V73-S09-006, V73-S09-015, V73-S09-022, V73-S29-007, V73-S30-001
- Modules: tool-fabric.mjs (catalogue 'web-search')
- Evidence: None
- Missing: Fresh retrieval and stale-claim detection
- Integration gaps / blockers: Web search runs through the agent's own tooling, not an ATLASZ runtime connector
- Security: Fetched content untrusted
- Plan: Research ledger with injected fetcher (see M08); freshness check uses retrieved_at
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## G03 — Multi-Agent Analysis — **PARTIAL**
- Registry links (candidates): V73-S02-001, V73-S02-002, V73-S02-003, V73-S03-006, V73-S03-007, V73-S03-010
- Modules: business/judge.mjs; brain/verifier.mjs; anti-collusion-guard.mjs; brain/orchestrator.mjs
- Evidence: judge tests (8), verifier tests (8)
- Missing: Parallel independent investigations + synthesis with anti-collusion
- Integration gaps / blockers: Needs live models to be independent in practice
- Security: Anti-collusion required
- Plan: Parallel investigation runner with independence check on top of judge panel
- Tests required: independent routes, collusion flagged, synthesis cites each

## G04 — Advanced Reasoning — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S03-001
- Modules: brain/model-intelligence.mjs; business/judge.mjs
- Evidence: Routing exists; no reasoning provider live
- Missing: Reasoning model + validation
- Integration gaps / blockers: No provider
- Security: Independent validation for important conclusions
- Plan: Covered by C10 + judge; provider blocked
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## G05 — Secure Code Execution — **PARTIAL**
- Registry links (candidates): V73-S02-003, V73-S09-002, V73-S09-013, V73-S09-014, V73-S09-029, V73-S10-001
- Modules: see M06
- Evidence: see M06
- Missing: see M06
- Integration gaps / blockers: see M06
- Security: see M06
- Plan: Shared with M06
- Tests required: see M06

## G06 — Function Calling — **VERIFIED_WORKING**
- Registry links (candidates): V73-S02-001, V73-S03-007, V73-S03-013, V73-S09-016, V73-S09-017, V73-S09-018
- Modules: capability-registry.mjs; executor-toolbox-registry.mjs; tool-bridge.mjs
- Evidence: typed-tools.test (5 tests, 7 mutation checks caught: input/output validation, chain gate, additionalProperties, type check, schema keyword allowlist, timeout); money-engine-hosted.test (hosted built-ins through the control chain). No live model calls these yet (no provider) - the schema/permission layer itself is verified.
- Missing: Live model attachment (EXTERNAL); more built-in tools
- Integration gaps / blockers: No validator
- Security: Every call classified by owner-authority
- Plan: Build typed tool registry with strict schema validation (shared with GE08/P14)
- Tests required: reject extra/missing/typed-wrong args, output validation, permission class, unknown tool refused

## G07 — Collections and Knowledge Search — **PARTIAL**
- Registry links (candidates): V73-S06-007, V73-S07-001, V73-S07-002, V73-S07-003, V73-S07-004, V73-S07-005
- Modules: document-center.mjs; enterprise-knowledge-agentic-rag.mjs
- Evidence: document-intelligence.test; enterprise RAG basic test
- Missing: Named collections with citation spans; persistent index for RAG module
- Integration gaps / blockers: RAG module in-memory
- Security: Tenant/role enforced
- Plan: Collections via Knowledge Projects (M02)
- Tests required: citation to source+offset, tenant isolation

## G08 — Image Understanding — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S03-008, V73-S23-012, V73-S28-001, ATLASZ-CR-007, ATLASZ-OSC-028
- Modules: doc-extractors.mjs (no OCR)
- Evidence: Scanned PDFs reported NO_TEXT_LAYER, never faked
- Missing: Vision model/OCR
- Integration gaps / blockers: No provider
- Security: Images may be personal data
- Plan: Modality fabric slot 'vision'
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## G09 — Video Understanding — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S28-002
- Modules: none
- Evidence: None
- Missing: Video model
- Integration gaps / blockers: No provider
- Security: Authorized only
- Plan: Modality fabric slot 'video-understanding'
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## G10 — Voice Intelligence — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S05-001, V73-S05-002, V73-S05-003, V73-S05-004, V73-S05-005, V73-S05-006
- Modules: voice-interface.mjs; voice-session.mjs
- Evidence: voice-session.test: state machine reports BLOCKED_NO_PROVIDER, no LISTEN without probed chain, approvals same as text
- Missing: Real STT/TTS
- Integration gaps / blockers: No provider
- Security: Voice identity is not authentication
- Plan: Keep state machine; provider slot
- Tests required: (done) + roundtrip when provider exists

## G11 — Image and Video Generation — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S09-024, V73-S22-006, V73-S26-005, V73-S26-006, V73-S28-001, V73-S28-002
- Modules: tool-fabric.mjs (catalogue)
- Evidence: None
- Missing: Provider interface
- Integration gaps / blockers: No provider; spend gate
- Security: Spending needs approval; content labelling
- Plan: Media fabric slot with cost estimate + approval (no-spend default)
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## G12 — Streaming Tool Observability — **PARTIAL**
- Registry links (candidates): V73-S03-008, V73-S10-014, V73-S13-004, V73-S34-001, V73-S34-002, V73-S34-003
- Modules: event-bus.mjs; brain/black-box.mjs; task-ledger.mjs; progress-ledger.mjs; Control Center polling
- Evidence: black-box tests (8), control-center tests
- Missing: Live push stream of tool calls/progress to the UI
- Integration gaps / blockers: UI polls; no server-sent events
- Security: Black Box redacts secrets
- Plan: Add SSE endpoint over event bus (read-only, token-gated)
- Tests required: token required, no secrets, ordering, reconnect

## G13 — Context and Cost Optimization — **PARTIAL**
- Registry links (candidates): V73-S03-007, V73-S03-018, V73-S04-004, V73-S04-011, V73-S08-011, V73-S08-013
- Modules: financial-ledger.mjs (token/API ledger); budget-consumption-governor.mjs; provider-resilience.mjs
- Evidence: financial-ledger tests (6), provider-resilience tests
- Missing: Context-window management, provider prompt caching, token accounting per conversation
- Integration gaps / blockers: No context manager; caching is provider-side
- Security: No-spend default
- Plan: Context budgeter (M03) ; caching deferred to provider adapters
- Tests required: budget never exceeded, accounting sums, unknown cost not zero

## GE01 — Long-Context Intelligence — **PARTIAL**
- Registry links (candidates): V73-S03-017, V73-S03-018, V73-S04-004, V73-S04-011, V73-S07-001, V73-S07-008
- Modules: document-center.mjs (tokens index); doc-extractors.mjs (size limits)
- Evidence: extractor limit tests
- Missing: Chunking/retrieval strategy for large docs and codebases
- Integration gaps / blockers: No chunker; limits truncate
- Security: Truncation is flagged, not silent
- Plan: Chunker + retrieval with source offsets in Knowledge Projects
- Tests required: chunk boundary integrity, truncation flagged

## GE02 — Unified Multimodal Understanding — **EXTERNAL_BLOCKER**
- Registry links (candidates): none
- Modules: none (text only)
- Evidence: None
- Missing: Cross-modal pipeline
- Integration gaps / blockers: Needs vision/audio/video providers
- Security: Privacy class per modality
- Plan: Modality fabric common envelope
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## GE03 — Real-Time Voice Interaction — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S05-001, V73-S05-002, V73-S05-003, V73-S05-004, V73-S05-005, V73-S05-006
- Modules: voice-session.mjs
- Evidence: State machine (interruption states) tested
- Missing: Low-latency streaming provider
- Integration gaps / blockers: No provider
- Security: Same as G10
- Plan: Keep
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## GE04 — Grounded Search — **PARTIAL**
- Registry links (candidates): none
- Modules: see M08
- Evidence: see M08
- Missing: Citation verification, freshness
- Integration gaps / blockers: see M08
- Security: see M08
- Plan: Shared with M08
- Tests required: see M08

## GE05 — Productivity Suite Integration — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S02-001, V73-S02-002, V73-S12-006, V73-S18-010, V73-S18-014, V73-S20-001
- Modules: connector-catalog.mjs; universal-inbox.mjs
- Evidence: Connector descriptors BLOCKED_NO_CREDENTIALS
- Missing: Credentials and OAuth for email/calendar/drive
- Integration gaps / blockers: No credentials
- Security: Read-only first; sending approval-gated
- Plan: Keep descriptors; add calendar/task data model locally (Personal Command Center) independent of provider
- Tests required: vault-only credentials, no LIVE without probe

## GE06 — Browser and Computer Interaction — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S02-001, V73-S12-004, V73-S14-005, V73-S19-001, V73-S19-002, V73-S19-003
- Modules: computer-use-fabric.mjs
- Evidence: Policy only
- Missing: Provider
- Integration gaps / blockers: No provider
- Security: Same as C02
- Plan: See C02
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## GE07 — Analytical Code Execution — **MISSING**
- Registry links (candidates): none
- Modules: see M07/M06
- Evidence: None
- Missing: Runner + libraries
- Integration gaps / blockers: depends on M06
- Security: reproducible, hash recorded
- Plan: Shared with M06/M07
- Tests required: see M07

## GE08 — Structured Tool Invocation — **VERIFIED_WORKING**
- Registry links (candidates): V73-S02-001, V73-S03-007, V73-S03-013, V73-S09-016, V73-S09-017, V73-S09-018
- Modules: see G06
- Evidence: typed-tools.test (5 tests, 7 mutation checks caught: input/output validation, chain gate, additionalProperties, type check, schema keyword allowlist, timeout); money-engine-hosted.test (hosted built-ins through the control chain)
- Missing: Live model attachment (EXTERNAL)
- Integration gaps / blockers: see G06
- Security: see G06
- Plan: Shared with G06
- Tests required: see G06

## GE09 — File Search and RAG — **PARTIAL**
- Registry links (candidates): V73-S07-009, V73-S07-010, V73-S07-016, V73-S07-017, V73-S09-019, V73-S21-031
- Modules: document-center.mjs; enterprise-knowledge-agentic-rag.mjs
- Evidence: document-intelligence.test
- Missing: Evidence-grounded answer assembly with citations
- Integration gaps / blockers: RAG not persistent
- Security: tenant/role + screening
- Plan: Knowledge Projects answer assembly (extractive, cited)
- Tests required: extractive answer cites source, refuses unsupported

## GE10 — Geographic Intelligence — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S31-020, V73-S32-001, V73-S32-002, V73-S32-003, V73-S32-004, V73-S32-005
- Modules: none
- Evidence: None
- Missing: Mapping provider
- Integration gaps / blockers: No provider
- Security: Location is personal data
- Plan: Slot only
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## GE11 — Agent Development Architecture — **PARTIAL**
- Registry links (candidates): V73-S02-001, V73-S02-002, V73-S02-003, V73-S03-001, V73-S03-002, V73-S03-003
- Modules: brain/planning-brain.mjs; brain/orchestrator.mjs; team-lead-workflows.mjs; agent-factory.mjs
- Evidence: planning-brain tests (4), orchestrator tests (11)
- Missing: Reusable workflow templates, stateful delegation primitives
- Integration gaps / blockers: Workflows not reusable as templates
- Security: Fixed topology
- Plan: Workflow templates on durable scheduler (P06)
- Tests required: template instantiate/validate, state resume

## GE12 — Multimodal Content Generation — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S09-024, V73-S22-006, V73-S26-005, V73-S26-006, V73-S28-001, V73-S28-002
- Modules: see G11
- Evidence: None
- Missing: Providers
- Integration gaps / blockers: No provider
- Security: see G11
- Plan: see G11
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## GE13 — Scalable Deployment Architecture — **PARTIAL**
- Registry links (candidates): V73-S08-017, V73-S08-020, V73-S10-018, V73-S14-005, V73-S15-006, V73-S15-008
- Modules: tenant-isolation.mjs; atlasz-runtime/Dockerfile.worker; watchdog.mjs; update-center.mjs; startup-self-check.mjs
- Evidence: tenant-isolation.test, watchdog tests, update-center tests (4)
- Missing: Deployment is not performed (production untouched); isolated instance bootstrap not rehearsed
- Integration gaps / blockers: Railway untouched by design
- Security: Production changes need owner approval
- Plan: Rehearse isolated-instance bootstrap locally (no deploy)
- Tests required: instance dir isolation, config separation

## A01 — Live Visual Understanding — **EXTERNAL_BLOCKER**
- Registry links (candidates): none
- Modules: none
- Evidence: None
- Missing: Camera pipeline + vision provider
- Integration gaps / blockers: No provider
- Security: Camera = highest privacy class; explicit consent
- Plan: Modality slot + consent gate
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## A02 — Screen Awareness — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S19-008, ATLASZ-BR-033, ATLASZ-PKG84-014, ATLASZ-PKG84-019
- Modules: computer-use-fabric.mjs (action 'screenshot' policy)
- Evidence: Policy classification only
- Missing: Screenshot ingestion + vision
- Integration gaps / blockers: No provider
- Security: Screens may hold secrets -> redaction
- Plan: Screenshot ingest with screening/redaction hook
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## A03 — Natural Real-Time Conversation — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S03-016, V73-S04-009, V73-S05-001, V73-S05-002, V73-S05-003, V73-S05-004
- Modules: voice-session.mjs; human-core.mjs
- Evidence: State machine; Human Core tone
- Missing: Streaming providers
- Integration gaps / blockers: No provider
- Security: Approvals via strong auth only
- Plan: Keep
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## A04 — Multilingual Live Communication — **PARTIAL**
- Registry links (candidates): V73-S09-025, V73-S12-001, V73-S12-002, V73-S12-003, V73-S12-004, V73-S12-005
- Modules: master-brief.mjs and owner-command.mjs (EN/HU templates only)
- Evidence: human-core.test (hu/en)
- Missing: General translation, language switching
- Integration gaps / blockers: No translation provider
- Security: Translations of approvals must not alter bound subject
- Plan: Language packs for system text; translation via provider slot
- Tests required: hu/en parity, approval text not machine-translated

## A05 — Multimodal Memory — **MISSING**
- Registry links (candidates): V73-S04-010, V73-S05-013, V73-S07-001, V73-S07-002, V73-S07-003, V73-S07-004
- Modules: brain/memory-fabric.mjs (text)
- Evidence: Text memory only
- Missing: Observation memory with modality, consent, retention, privacy class
- Integration gaps / blockers: none
- Security: Consent + classification + deletion required
- Plan: Observation memory module (metadata/descriptions; raw media not stored by default)
- Tests required: consent required, class enforced, retention expiry, recall permission

## A06 — Object and Equipment Recognition — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S24-007, ATLASZ-PKG84-016
- Modules: none
- Evidence: None
- Missing: Vision model
- Integration gaps / blockers: No provider
- Security: Uncertainty must be expressed
- Plan: Slot; uncertainty schema
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## A07 — Visual Guidance — **MISSING**
- Registry links (candidates): none
- Modules: none
- Evidence: None
- Missing: Instruction/overlay descriptors
- Integration gaps / blockers: Needs a renderer in Control Center
- Security: Overlays cannot execute actions
- Plan: Data model for annotated steps (renderer later)
- Tests required: schema validation

## A08 — Contextual Proactive Assistance — **PARTIAL**
- Registry links (candidates): ATLASZ-PKG84-012
- Modules: human-core.mjs (planHelp); master-brief.mjs; brain/central-brain.mjs
- Evidence: human-core.test (7)
- Missing: Suggestion engine across state sources, suppression, rate limits
- Integration gaps / blockers: Suggestions never act
- Security: Suggest-only; restricted actions need approval
- Plan: Suggestion queue fed by brief sources with dismissal memory
- Tests required: suggest-only, rate limit, no restricted action

## A09 — Environmental Context Awareness — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S03-018, V73-S04-004, V73-S04-011, V73-S33-005, V73-S35-022, ATLASZ-SV-004
- Modules: none
- Evidence: None
- Missing: Sensors
- Integration gaps / blockers: No provider
- Security: Consent
- Plan: Slot
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## A10 — Application Assistance — **PARTIAL**
- Registry links (candidates): V73-S02-001, V73-S03-007, V73-S03-013, V73-S09-016, V73-S09-017, V73-S09-018
- Modules: tool-bridge.mjs; computer-use-fabric.mjs
- Evidence: policy tests
- Missing: Validated tools per application
- Integration gaps / blockers: Provider missing
- Security: Approval classes
- Plan: Via typed tools
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## A11 — Personalized Assistance — **PARTIAL**
- Registry links (candidates): V73-S04-010, V73-S06-001, V73-S06-002, V73-S06-003, V73-S06-004, V73-S06-005
- Modules: master-brief.mjs (prefs); human-core.mjs; owner-keystore.mjs
- Evidence: control-center-home.test prefs; personal-command-center.test (owner-local day via utcOffsetMinutes, tasks/reminders/deadlines, hu/en brief)
- Missing: Preference/history store beyond language, signature and UTC offset; suggestion engine (A08)
- Integration gaps / blockers: Limited prefs
- Security: No hardcoded personal data in reusable code (config only)
- Plan: Profile store (config-driven) for Personal Command Center
- Tests required: prefs isolated per profile

## A12 — Cross-Device Continuity — **PARTIAL**
- Registry links (candidates): V73-S39-001, V73-S39-002, V73-S39-003, V73-S39-004, V73-S39-005, V73-S39-006
- Modules: mobile-api.mjs; durable server state; Control Center
- Evidence: mobile-api.test (signed requests, nonce, rate limit)
- Missing: Task handoff Windows<->mobile; no transport exposed
- Integration gaps / blockers: Mobile transport not hosted
- Security: Every request owner-signed
- Plan: Continuity token view on existing task ledger
- Tests required: signed handoff, replay refused

## A13 — Visual Accessibility and Guidance — **PARTIAL**
- Registry links (candidates): none
- Modules: Control Center UI
- Evidence: none specific
- Missing: Scene descriptions (provider), UI accessibility audit
- Integration gaps / blockers: Provider for scenes
- Security: None
- Plan: UI accessibility checklist tests (labels, contrast tokens)
- Tests required: a11y static checks

## P01 — Personal Learning Tutor — **MISSING**
- Registry links (candidates): V73-S07-001, V73-S07-002, V73-S07-003, V73-S07-004, V73-S07-005, V73-S07-006
- Modules: none
- Evidence: None
- Missing: Lessons, quizzes, adaptive plan
- Integration gaps / blockers: Content generation needs a model for novel lessons; spaced-repetition scheduler is local
- Security: Personal data minimal
- Plan: Tutor engine: deck/quiz store + spaced-repetition scheduler (local, deterministic); content authoring by model later
- Tests required: scheduler intervals, scoring, persistence

## P02 — Video-to-Action Workflow — **MISSING**
- Registry links (candidates): V73-S02-001, V73-S04-010, V73-S05-003, V73-S05-004, V73-S07-005, V73-S13-006
- Modules: none
- Evidence: None
- Missing: Transcript -> steps
- Integration gaps / blockers: Transcript source
- Security: Authorized only
- Plan: Transcript->actionable steps with verification checklist (see M09)
- Tests required: step extraction, each step verifiable

## P03 — Personal Knowledge Organizer — **PARTIAL**
- Registry links (candidates): V73-S06-007, V73-S07-001, V73-S07-002, V73-S07-003, V73-S07-004, V73-S07-005
- Modules: document-center.mjs; brain/knowledge-brain.mjs
- Evidence: document-intelligence.test
- Missing: Notes/books/ideas model with tags
- Integration gaps / blockers: No notes model
- Security: Classification PERSONAL/CONFIDENTIAL
- Plan: Knowledge Projects: notes + tags
- Tests required: tag search, classification

## P04 — Rapid Prototype Builder — **MISSING**
- Registry links (candidates): V73-S08-001, V73-S08-007, V73-S29-001, V73-S29-010, V73-S43-011, V73-S48-013
- Modules: none
- Evidence: None
- Missing: Idea->prototype with tests
- Integration gaps / blockers: Needs sandbox + model
- Security: Sandbox only
- Plan: After M06/C01
- Tests required: generated-test pass required

## P05 — Task State Rewind — **PARTIAL**
- Registry links (candidates): V73-S03-018, V73-S10-012, V73-S14-007, V73-S23-032, V73-S35-017, V73-S37-003
- Modules: owner-control/recovery-points.mjs; checkpoint-engine.mjs; backup-recovery.mjs; durable-queue.mjs
- Evidence: backup-recovery tests (3), recovery-points tests
- Missing: Per-task state rewind without touching financial/audit facts
- Integration gaps / blockers: Restore is per category, not per task
- Security: Audit and payment facts must never rewind
- Plan: Task checkpoints with rewind that excludes immutable domains
- Tests required: rewind excludes audit/payments, verified hash

## P06 — Reusable Personal Workflows — **PARTIAL**
- Registry links (candidates): V73-S02-002, V73-S21-001, V73-S26-002, V73-S26-008, V73-S28-003, V73-S30-003
- Modules: brain/planning-brain.mjs; team-lead-workflows.mjs
- Evidence: planning-brain tests
- Missing: Templates parameterized + schedulable
- Integration gaps / blockers: none
- Security: Approval points preserved
- Plan: Workflow templates on scheduler
- Tests required: parameter validation, approval preserved

## P07 — Independent Code Reviewer — **PARTIAL**
- Registry links (candidates): V73-S03-010, V73-S03-011, V73-S04-012, V73-S08-001, V73-S08-007, V73-S09-026
- Modules: qa-reviewer.mjs; business/judge.mjs; business/qa-factory.mjs
- Evidence: qa-factory/judge tests (generic work QA)
- Missing: Code-specific static checks (secrets, injection patterns, test presence)
- Integration gaps / blockers: none for code
- Security: Findings advisory; Judge independent of author
- Plan: Code review checks module (rule-based, no model needed)
- Tests required: detects seeded defects, no false OK on empty

## P08 — Interrupted Task Continuation — **PARTIAL**
- Registry links (candidates): V73-S03-018, V73-S10-012, V73-S10-016, V73-S14-007, V73-S39-004, V73-S46-010
- Modules: durable-queue.mjs; checkpoint-engine.mjs; brain/planning-brain.mjs; startup-self-check.mjs
- Evidence: durable-queue.test (replay, lease, DLQ), canonical-queue-safety, scheduler.test (crash mid-run recorded INTERRUPTED and rerun)
- Missing: Task-level resume contract for planning-brain tasks across a real process restart (module-level only)
- Integration gaps / blockers: Per-module durable; no unified resume test across restart
- Security: Corrupt state is never replaced
- Plan: End-to-end restart scenario test + resume contract
- Tests required: kill mid-task, resume exactly once

## P09 — Social Signal Monitoring — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S08-017, V73-S08-020, V73-S10-018, V73-S15-006, V73-S15-008, ATLASZ-PKG84-016
- Modules: tech-watch.mjs; market-intelligence-engine.mjs
- Evidence: Feed-file monitor only
- Missing: Live social sources
- Integration gaps / blockers: No credentials
- Security: Approved public sources only
- Plan: Source slot
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## P10 — Independent Multi-Model Verification — **PARTIAL**
- Registry links (candidates): V73-S02-002, V73-S03-007, V73-S03-010, V73-S04-008, V73-S08-001, V73-S08-002
- Modules: business/judge.mjs; brain/verifier.mjs; brain/model-intelligence.mjs (different families required)
- Evidence: judge + verifier tests (8+8); different-family rule tested
- Missing: Disagreement escalation with real models
- Integration gaps / blockers: No live second provider
- Security: Single-provider limit reported truthfully
- Plan: Disagreement escalation path (exists) + live providers blocked
- Tests required: (done offline) + live when providers exist

## P11 — Batch Processing Engine — **PARTIAL**
- Registry links (candidates): V73-S03-002, V73-S03-017, V73-S07-006, V73-S10-001, V73-S10-002, V73-S10-003
- Modules: durable-queue.mjs; priority-queue-rate-limit-governor.mjs; dead-letter-queue.mjs
- Evidence: durable-queue.test (maxPending, DLQ), canonical-queue-safety
- Missing: Batch job abstraction with checkpoint per item, rate limit, error isolation
- Integration gaps / blockers: none
- Security: Spend/approval gates per item
- Plan: Batch runner on scheduler/queue
- Tests required: error isolation, resume mid-batch, rate limit

## P12 — Personal Media Organizer — **MISSING**
- Registry links (candidates): V73-S09-024, V73-S22-006, V73-S28-001, V73-S28-002, V73-S28-003, V73-S28-004
- Modules: document-center.mjs (documents only)
- Evidence: None
- Missing: Photo/audio/video index
- Integration gaps / blockers: Metadata only without providers
- Security: Personal/private class; consent
- Plan: Media index: metadata, tags, classification via observation memory (no content analysis)
- Tests required: consent, class, no raw bytes leakage

## P13 — Multi-Website Comparison — **MISSING**
- Registry links (candidates): V73-S16-006, V73-S30-001, V73-S30-002, V73-S30-003, V73-S30-004, V73-S30-005
- Modules: none
- Evidence: None
- Missing: Structured diff of user-specified pages
- Integration gaps / blockers: Fetcher is a provider/adapter
- Security: Untrusted content
- Plan: Comparison over fetched snapshots (injected fetcher) with structured differences
- Tests required: diff correctness, injection screened

## P14 — Strict Structured Output Engine — **VERIFIED_WORKING**
- Registry links (candidates): V73-S24-005, V73-S34-001, V73-S43-006, V73-S51-011, ATLASZ-OSC-014, ATLASZ-OSC-015
- Modules: business/qa-factory.mjs (QA only)
- Evidence: typed-tools.test (5 tests, 7 mutation checks caught: input/output validation, chain gate, additionalProperties, type check, schema keyword allowlist, timeout); money-engine-hosted.test (hosted built-ins through the control chain); parseStructured rejects non-JSON, extra fields and out-of-enum values without repair
- Missing: Domain schemas for every module output (incremental)
- Integration gaps / blockers: none
- Security: Reject invalid, never coerce silently
- Plan: Shared schema validator (see G06)
- Tests required: accept/reject matrix, no coercion

## P15 — Adaptive Multimodal Processing — **MISSING**
- Registry links (candidates): none
- Modules: none
- Evidence: None
- Missing: Detail-level chooser
- Integration gaps / blockers: Providers
- Security: Cost gating
- Plan: Policy function in modality fabric
- Tests required: detail never exceeds budget

## P16 — Long-Session Continuity — **PARTIAL**
- Registry links (candidates): V73-S03-018, V73-S04-004, V73-S04-011, V73-S05-001, V73-S05-002, V73-S05-005
- Modules: brain/memory-fabric.mjs; checkpoint-engine.mjs; planning-brain.mjs
- Evidence: memory-fabric.test
- Missing: Conversation state persistence
- Integration gaps / blockers: Conversation object missing (M03)
- Security: Provenance retained
- Plan: With M03 conversation store
- Tests required: restart restores validated state

## P17 — Voice Focus and Noise Handling — **EXTERNAL_BLOCKER**
- Registry links (candidates): V73-S05-001, V73-S05-002, V73-S05-003, V73-S05-004, V73-S05-005, V73-S05-006
- Modules: voice-session.mjs
- Evidence: State machine only
- Missing: Audio DSP/provider
- Integration gaps / blockers: No provider
- Security: Speaker intent != authentication
- Plan: Slot
- Tests required: No live provider/credential in this workspace; nothing may be reported LIVE without our own passing probe.

## P18 — Visual Highlighting — **MISSING**
- Registry links (candidates): none
- Modules: none
- Evidence: None
- Missing: Region annotation schema
- Integration gaps / blockers: Renderer
- Security: Annotations cannot act
- Plan: Annotation schema (see A07)
- Tests required: schema validation

## P19 — Personal Object and Information Recall — **MISSING**
- Registry links (candidates): V73-S04-010, V73-S05-013, V73-S07-001, V73-S07-002, V73-S07-003, V73-S07-004
- Modules: brain/memory-fabric.mjs (text)
- Evidence: Text only
- Missing: Authorized observation recall
- Integration gaps / blockers: none
- Security: Consent, retention, deletion
- Plan: Observation memory (A05)
- Tests required: recall requires permission and consent

## P20 — Situational Assistance — **PARTIAL**
- Registry links (candidates): V73-S38-001
- Modules: human-core.mjs; master-brief.mjs
- Evidence: human-core.test
- Missing: Cross-source next-step suggestions
- Integration gaps / blockers: Suggestions limited to brief
- Security: Suggest-only
- Plan: Suggestion queue (A08)
- Tests required: suggest-only
