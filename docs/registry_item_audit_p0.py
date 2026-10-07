# Item-level, evidence-based statuses for the P0 sections (V7.3 registry). Merged into the registry by build_registry.py.
# Rule used: EXISTS_AND_WORKING = mechanism implemented AND covered by a passing automated test AND no known gap inside its own scope.
# In-memory module-global state (lost on restart) is capped at PARTIAL. Anything needing a provider/credential/Joci approval says so.
A, T, R = "atlasz-addons/", "atlasz-tests/", "atlasz-runtime/"
TESTS = dict(auth=T+"owner-auth.test.mjs", es=T+"emergency-stop.test.mjs", gated=T+"gated-modules.test.mjs", q=T+"durable-queue.test.mjs", br=T+"backup-recovery.test.mjs",
  uc=T+"update-center.test.mjs", cr=T+"canonical-runtime.test.mjs", cq=T+"canonical-queue-safety.test.mjs", safe=T+"safety-modules.test.mjs", cc=T+"control-center.test.mjs",
  c1=T+"contract-existing-modules.test.mjs", c2=T+"contract-core-engine.test.mjs", pe=T+"probe-evidence.test.mjs", stop=T+"stop-enforcement.test.mjs", ar=T+"approval-requests.test.mjs",
  reg=T+"registry-integrity.test.mjs")
EW, NT, PA, SO, MI, EB, JA = "EXISTS_AND_WORKING", "EXISTS_NEEDS_TEST", "PARTIAL", "STRUCTURAL_ONLY", "MISSING", "EXTERNAL_BLOCKER", "BLOCKED_AWAITING_JOCI_APPROVAL"
NOKEY = "Owner public key not provisioned by Joci (owner auth cannot be LIVE until then)"
MEM = "In-memory module state: lost on restart"
I = {}
def add(sec, rows):
    for n, (st, loc, tests, ev, blk) in rows.items():
        I["V73-S%02d-%03d" % (sec, n)] = dict(status=st, implementation_location=loc, tests=[TESTS[t] for t in tests.split()] if tests else [], evidence=[ev] if ev else [], blocker=blk)

add(2, {
 1: (PA, A+"owner-auth.mjs; "+R+"supervisor-safe.mjs", "auth gated", "Signed owner approvals gate 14 modules; MASTER->agents delegation is not enforced as a chain in code", NOKEY),
 2: (PA, A+"owner-auth.mjs; guardrail-engine.mjs", "auth gated stop", "Server holds only the public key so agents cannot forge approvals; in-process plugins are not sandboxed", "No plugin sandbox"),
 3: (EW, R+"supervisor-safe.mjs; "+A+"startup-self-check.mjs", "cr cq", "Fixed Array.from({length:30}); topology asserted in tests and by the startup self-check (FAIL => Safe Mode)", None)})
add(3, {
 1: (SO, A+"general-intelligence-extensions.mjs", "", "Structure only; no reasoning engine/LLM connected", "EXTERNAL: no model provider; spend needs Joci approval"),
 2: (MI, None, "", "No strategic planning module found", None),
 3: (PA, A+"master-planner-orchestrator.mjs", "c1 c2", "Plan creation, readiness, QA-gated advance, replan tested; not wired into the runtime loop", None),
 4: (SO, A+"master-planner-orchestrator.mjs", "c1", "Steps are supplied by the caller; no automatic decomposition", "Needs a reasoning model (EXTERNAL)"),
 5: (EW, A+"master-planner-orchestrator.mjs", "c1 c2", "dependsOn gating and cycle rejection tested", None),
 6: (PA, A+"master-planner-orchestrator.mjs; capability-registry.mjs", "c2", "routePlanStep picks a ready agent with required tools and reports gaps", "Not wired to the 30 runtime agents"),
 7: (PA, A+"multi-model-brain.mjs; cost-model-router.mjs", "c2 pe", "Only probe-evidenced providers selectable; no-budget route needs owner approval", "EXTERNAL: no provider connected; "+MEM),
 8: (PA, A+"progress-ledger.mjs; stall-replanner.mjs", "c2", "Progress deltas and stall detection tested", "Not wired into the runtime"),
 9: (PA, A+"master-planner-orchestrator.mjs; stall-replanner.mjs", "c2", "replanMasterPlan appends steps; replan() only emits an instruction", "No generative replanner (needs model)"),
 10: (PA, A+"qa-reviewer.mjs; multi-model-brain.mjs", "c1 c2", "QA PASS needs evidence per check; independent judge requires a different live provider", "EXTERNAL: second provider"),
 11: (EW, A+"task-ledger.mjs; qa-reviewer.mjs", "c1 c2", "taskComplete needs every done-criterion passed; empty definition never done", None),
 12: (MI, None, "", "No contradiction handling module found", None),
 13: (EW, A+"executor-toolbox-registry.mjs", "c2", "executionPlan reports missing capabilities; untested tools never counted", None),
 14: (PA, A+"approval-command-gateway.mjs; approval-requests.mjs", "stop ar", "Gateway + approval cards tested", "Planner does not yet route approvals automatically"),
 15: (MI, None, "", "No daily/startup briefing (startup self-check is technical, not a briefing)", None),
 16: (MI, None, "", "No conversational command interface; voice is structural only", None),
 17: (SO, A+"durable-queue.mjs; master-planner-orchestrator.mjs", "q c2", "Components exist but no long-running project coordinator", None),
 18: (PA, A+"checkpoint-engine.mjs; "+R+"supervisor-safe.mjs", "c2 cq", "Checkpoint snapshot/resume and crash-safe state+journal tested", "Only screening state is checkpointed"),
 19: (PA, A+"self-healing-loop.mjs; recovery.mjs; safe-mode.mjs; watchdog.mjs", "c1 c2 safe", "Retry->alternate->BLOCKED for human; watchdog escalates to Safe Mode", "Not wired to all agent tasks")})
add(9, {
 1: (EW, R+"supervisor-safe.mjs", "cr", "5 SEARCH agents created and scheduled", None),
 2: (EW, R+"supervisor-safe.mjs", "cr cq", "25 EXECUTION agents created and scheduled", None),
 3: (EW, R+"supervisor-safe.mjs", "cr", "Exactly 30 asserted", None),
 4: (PA, R+"supervisor-safe.mjs", "cr", "HN public search with injected fetch tested", "Real network search unverified from the sandbox; one source only"),
 5: (SO, A+"market-intelligence-engine.mjs", "", "Module exists; no data source", "EXTERNAL: data sources"),
 6: (SO, A+"buyer-decision-maker-finder.mjs", "", "Module exists; no data source", "EXTERNAL: data sources"),
 7: (EW, R+"supervisor-safe.mjs", "cr", "qualify() rejects seller/stale/employment/scam signals; leads carry evidence", None),
 8: (NT, A+"opportunity-qualification-engine.mjs", "", "Not covered by tests", None),
 9: (PA, R+"supervisor-safe.mjs; "+A+"buyer-decision-maker-finder.mjs", "cr", "Published emails extracted; no decision-maker discovery verified", None),
 10: (MI, None, "", "No tender/RFP source", None),
 11: (NT, A+"proposal-quote-engine.mjs", "gated", "Owner gate tested; matching logic not", None),
 12: (PA, R+"supervisor-safe.mjs", "cr", "Scope review artifacts with QA flag", "Scope review only; no offer drafting"),
 13: (PA, A+"follow-up-engine.mjs; "+R+"supervisor-safe.mjs", "cr", "Preparation only; nothing is ever sent", "EXTERNAL: no authenticated delivery adapter"),
 14: (JA, A+"execution-factory.mjs", "gated", "AI execution disabled (no spend)", "JOCI APPROVAL needed for any model/tool spend"),
 15: (SO, A+"skill-factory.mjs", "", "No research executor", "Needs provider + spend approval"), 16: (SO, A+"tool-fabric.mjs", "pe", "Catalogue only", "Needs provider + spend approval"),
 17: (SO, A+"tool-fabric.mjs", "pe", "Catalogue only", "Needs provider + spend approval"), 18: (SO, A+"tool-fabric.mjs", "pe", "Catalogue only", "Needs provider + spend approval"),
 19: (SO, A+"tool-fabric.mjs", "pe", "Catalogue only", "No document tools connected"), 20: (SO, A+"tool-fabric.mjs", "pe", "Catalogue only", "No spreadsheet tools connected"),
 21: (SO, A+"tool-fabric.mjs", "pe", "Catalogue only", "No presentation tools connected"), 22: (SO, A+"tool-fabric.mjs", "pe", "Catalogue only", "No web tools connected"),
 23: (SO, A+"tool-fabric.mjs", "pe", "Catalogue only", "Needs provider + spend approval"), 24: (SO, A+"tool-fabric.mjs", "pe", "Catalogue only", "No media tools connected"),
 25: (SO, A+"tool-fabric.mjs", "pe", "Catalogue only", "Needs provider + spend approval"),
 26: (EW, A+"qa-reviewer.mjs", "c1", "Evidence-required QA gate tested", None),
 27: (MI, None, "", "No customer-support module", None),
 28: (PA, A+"delivery-engine.mjs", "gated", "Delivery state machine needs QA pass + owner approval + external evidence", "Nothing is actually delivered"),
 29: (SO, A+"execution-factory.mjs", "", "Structural only", "Depends on connected tools")})
add(10, {
 1: (EW, A+"durable-queue.mjs; "+R+"supervisor-safe.mjs", "q cq", "Durable journaled priority queue drives screening", "Wired for screening jobs only"),
 2: (PA, R+"supervisor-safe.mjs", "cr", "In-process timer scheduler per agent", "No persisted/cron schedule"),
 3: (PA, A+"priority-queue-rate-limit-governor.mjs", "c1", "Token-bucket limiter tested", MEM),
 4: (MI, None, "", "No queue-depth based backpressure; search keeps adding candidates", None),
 5: (EW, A+"durable-queue.mjs", "q", "Higher priority leased first, FIFO within priority", None),
 6: (EW, A+"durable-queue.mjs", "q cq", "nack with backoff, attempts counted, max attempts -> DLQ", None),
 7: (PA, A+"durable-queue.mjs; watchdog.mjs; update-center.mjs", "q safe uc", "Lease expiry, probe timeout and adapter timeout tested", "No per-task execution timeout inside agents"),
 8: (PA, A+"master-planner-orchestrator.mjs", "c2", "Planner dependsOn tested; queue itself has no dependencies", None),
 9: (EW, A+"durable-queue.mjs; stall-replanner.mjs; watchdog.mjs", "q c2 safe", "Expired leases requeued; stalls detected; stale heartbeat detected", None),
 10: (PA, A+"durable-queue.mjs; stall-replanner.mjs", "q cq c2", "Requeue works; replan only emits an instruction", None),
 11: (EW, A+"durable-queue.mjs", "q cq", "Exhausted retries -> durable DEAD state, owner-reviewable", "Separate in-memory dead-letter-queue.mjs is not wired"),
 12: (EW, R+"supervisor-safe.mjs; "+A+"durable-queue.mjs", "cq q", "State saved (fsync) before job ack; crash between save and ack replays safely", None),
 13: (PA, A+"task-ledger.mjs", "c2", "Pure ledger tested", "Not wired into runtime"), 14: (PA, A+"progress-ledger.mjs", "c2", "Progress deltas tested", "Not wired into runtime"),
 15: (PA, A+"event-bus.mjs", "c2", "Known-event pub/sub tested", MEM),
 16: (EW, R+"supervisor-safe.mjs; "+A+"durable-queue.mjs", "cq q cr", "Leased jobs requeued on restart; PROCESSING reset; no duplicates", None),
 17: (EW, A+"durable-queue.mjs", "q cq", "Idempotency key survives restart and completion", None),
 18: (PA, R+"supervisor-safe.mjs", "cq", "Dashboard exposes queue, agents, watchdog", "No history/trends"),
 19: (PA, A+"agent-portfolio-manager.mjs", "c2", "Per-agent results ranked", MEM),
 20: (EW, R+"supervisor-safe.mjs", "cq", "dashboard.queue ready/leased/done/dead/depth", None),
 21: (PA, R+"supervisor-safe.mjs", "cr", "startedAt/lastSystemRun only", "No runtime duration metrics"),
 22: (PA, A+"agent-portfolio-manager.mjs", "c2", "errorRate per agent tested", MEM+"; not on dashboard"),
 23: (PA, A+"watchdog.mjs; "+R+"supervisor-safe.mjs", "safe cr", "Watchdog + /health", "No availability history")})
add(12, {
 1: (PA, "registry vocabulary", "reg", "Label defined in the registry; not a runtime state", None), 2: (PA, A+"completion-registry.mjs", "c1", "PLANNED state exists", MEM),
 3: (PA, A+"completion-registry.mjs", "c1", "STRUCTURALLY_WIRED state exists", MEM),
 4: (EW, A+"owner-auth.mjs; tool-fabric.mjs; voice-interface.mjs; computer-use-fabric.mjs", "auth pe", "Shown when nothing is attached", None),
 5: (EW, A+"owner-auth.mjs; multi-model-brain.mjs; tool-fabric.mjs", "auth pe", "Shown when attached without evidence", None),
 6: (PA, A+"universal-connector-layer.mjs", "pe", "Only a connector TESTED status exists", None),
 7: (EW, A+"probe-evidence.mjs; owner-auth.mjs", "pe auth", "LIVE only with probe evidence / proven owner challenge; mutation-tested", None),
 8: (EW, R+"supervisor-safe.mjs; "+A+"update-center.mjs", "cr uc", "BLOCKED surfaced with reason instead of hidden", None),
 9: (PA, "registry vocabulary", "reg", "Label in registry; not a runtime state", None), 10: (PA, A+"update-center.mjs", "uc", "FAILED exists for updates only", None),
 11: (PA, "registry vocabulary", "reg", "Label in registry", None), 12: (PA, "registry vocabulary", "reg", "Label in registry", None), 13: (PA, "registry vocabulary", "reg", "Label in registry", None)})
add(13, {
 1: (PA, A+"guardrail-engine.mjs; approval-command-gateway.mjs; owner-auth.mjs", "gated stop", "No single firewall module; guards in 14 modules + guardrail + gateway", "Enforced where called; no live external action path exists yet"),
 2: (PA, A+"budget-consumption-governor.mjs; "+R+"supervisor-safe.mjs", "c1", "Runtime budget is $0 and no paid call exists", "No capital model"),
 3: (PA, A+"budget-consumption-governor.mjs", "c1", "Unconfigured/exceeded/invalid cost blocked", MEM), 4: (PA, A+"profit-ledger.mjs; observability-black-box.mjs", "c1", "Costs recorded and validated", MEM),
 5: (PA, A+"approval-command-gateway.mjs", "stop auth", "LIVE only after owner-signed challenge", NOKEY),
 6: (EW, A+"owner-auth.mjs + 14 gated modules", "gated stop", "Bare booleans rejected; signed, subject-bound, expiring, replay-protected approvals", None),
 7: (EW, A+"guardrail-engine.mjs; approval-command-gateway.mjs", "stop", "TAKE_LOAN/OPEN_CREDIT/BORROW need owner approval", "No live external action path exists"),
 8: (EW, A+"guardrail-engine.mjs", "c2 stop", "SUBSCRIBE guarded", "No live external action path exists"), 9: (EW, A+"guardrail-engine.mjs", "c2 stop", "PURCHASE/BUY_CREDITS/SPEND_MONEY guarded", "No live external action path exists"),
 10: (EW, A+"guardrail-engine.mjs", "c2 stop", "SEND_PAYMENT guarded", "No live external action path exists"), 11: (EW, A+"guardrail-engine.mjs", "c2 stop", "BANK_CHANGE/BANK_TRANSFER guarded", "No live external action path exists"),
 12: (EW, A+"guardrail-engine.mjs; delivery/deal modules", "c2 gated", "ACCEPT/SIGN_CONTRACT guarded", "No live external action path exists")})
add(14, {
 1: (EW, R+"supervisor-safe.mjs", "cc es", "Real process: PAUSE_ALL halts all agents", None), 2: (EW, R+"supervisor-safe.mjs", "cc cq", "Search and screening dispatch gated", None),
 3: (EW, R+"supervisor-safe.mjs", "cq", "Gate checked before lease", None), 4: (EW, A+"emergency-stop.mjs", "es cq", "STOP_EXTERNAL_ACTIONS blocks external only", None),
 5: (PA, A+"computer-use-fabric.mjs; multi-model-brain.mjs; "+R+"supervisor-safe.mjs", "stop", "Gate enforced at computer-use, model invocation and search", "New action paths must call the gate; no outreach/deploy paths exist"),
 6: (PA, A+"multi-model-brain.mjs; guardrail-engine.mjs", "stop c2", "Model calls blocked while stopped; spend needs approval anyway", None),
 7: (NT, A+"emergency-stop.mjs", "es", "Design never deletes; no dedicated retention assertion", None),
 8: (NT, "atlasz-control-center/public/app.js", "cc", "Red banner 'EMERGENCY STOP ACTIVE' seen in headless browser (evidence/ui-paused.png)", "Not an automated test")})
add(34, {
 1: (PA, R+"supervisor-safe.mjs", "cr", "JSON event lines + audit chains", None), 2: (PA, A+"tracing-evals.mjs", "c2", "traceEvent/aggregate", MEM),
 3: (PA, A+"observability-black-box.mjs", "c1", "jobId/traceId fields", MEM), 4: (PA, A+"observability-black-box.mjs", "c1", "agentId field", MEM),
 5: (PA, A+"tracing-evals.mjs", "c2", "tool field; model id not recorded", MEM), 6: (EW, A+"audit-chain.mjs", "auth", "Every audit/queue record is timestamped", None),
 7: (PA, A+"observability-black-box.mjs", "c1", "costUsd validated", MEM), 8: (PA, A+"observability-black-box.mjs", "c1", "event field", MEM),
 9: (PA, A+"observability-black-box.mjs", "c1", "output/status fields", MEM), 10: (PA, A+"observability-black-box.mjs", "c1", "ERROR status", MEM),
 11: (EW, A+"durable-queue.mjs", "q", "attempts and lastError journaled durably", None), 12: (EW, A+"owner-auth.mjs", "auth", "Approval verified/denied events with nonce in hash-chained audit", None),
 13: (PA, A+"update-center.mjs; observability-black-box.mjs", "uc", "Update evidence recorded", None), 14: (MI, None, "", "No external actions exist, so no receipts", None),
 15: (PA, A+"audit-chain.mjs", "auth safe", "Tamper-evident hash chain, fsync; not WORM", "Local files can be deleted"),
 16: (PA, "atlasz-control-center/core.mjs", "cc", "Approvals history list; no search", None)})
add(36, {
 1: (EW, A+"owner-auth.mjs", "auth", "Ed25519 signed approvals", NOKEY), 2: (PA, A+"enterprise-knowledge-agentic-rag.mjs", "c1", "Role filter in knowledge only", "No global RBAC"),
 3: (EW, A+"secret-vault.mjs", "safe", "Vault with owner-gated set/delete", "No connector uses it yet; master key must be provided by host"),
 4: (EW, A+"secret-vault.mjs", "safe", "AES-256-GCM, entry-bound AAD, tamper detection", "Master key custody (DPAPI) not implemented"),
 5: (PA, A+"secret-vault.mjs; observability-black-box.mjs", "safe c1", "Vault never logs values; redaction in black box", "No automated whole-repo secret scan in CI"),
 6: (PA, A+"owner-auth.mjs", "gated", "Critical actions need owner approval", "No per-agent privilege model"),
 7: (PA, A+"universal-connector-layer.mjs", "pe", "Capability + permission resolution", "No real connectors"),
 8: (EW, "atlasz-control-center/server.mjs", "cc", "Token, Host allow-list, Origin check, CSP, JSON-only, no CORS", None),
 9: (EW, A+"audit-chain.mjs", "auth safe", "Hash-chained audit logs", None), 10: (EW, A+"owner-auth.mjs", "auth", "Approval events hash-chained", None),
 11: (EW, "atlasz-control-center/public/app.js; core.mjs", "cc", "Typed RESUME/RESTORE + passphrase-signed approval", None),
 12: (PA, A+"backup-recovery.mjs", "br", "Backups hash-verified but NOT encrypted (0600 files)", "Backup encryption missing"),
 13: (MI, None, "", "No secure export/import", None), 14: (MI, None, "", "No owner-key revocation mechanism (rotate env key manually)", None),
 15: (EW, A+"secret-vault.mjs", "safe", "Rotating an existing secret is approval-gated and audited", None)})
add(41, {n: (EW, A+"approval-requests.mjs; atlasz-control-center/public/app.js", "ar cc", "Mandatory field in every approval card: " + w, "No runtime flow requests approvals yet (no external action paths exist)") for n, w in
  {1: "what", 2: "why", 3: "cost", 4: "risk", 5: "external effect", 6: "reversible (+ note if not)", 7: "what if Joci says no", 8: "no-spend alternative"}.items()})
add(42, {
 1: (EW, "docs/atlasz_v73_requirement_registry.json", "reg", "Unique IDs enforced by registry-integrity test", None), 2: (EW, "registry", "reg", "Title present for all", None),
 3: (EW, "registry", "reg", "Description present for all", None), 4: (EW, "registry", "reg", "Source line range present for all", None),
 5: (PA, "registry", "reg", "priority_proposed; some are 'P?'", "Owner has not confirmed priorities"), 6: (PA, "registry", "reg", "dependencies field exists but is not populated", None),
 7: (PA, "registry", "reg", "Filled for audited items only", None), 8: (EW, "registry", "reg", "Status from the allowed vocabulary enforced by test", None),
 9: (PA, "registry", "reg", "Filled for audited items only", None), 10: (PA, "registry", "reg", "Filled for audited items only", None),
 11: (PA, "registry", "reg", "Filled where known", None), 12: (PA, "registry", "reg", "Filled where Joci decided", None)})
add(43, {
 1: (EW, "ATLASZ_V73_AUDIT_REPORT.md", "", "Repository + bundle inspected, git fsck", None), 2: (EW, "ATLASZ_V73_AUDIT_REPORT.md", "", "Branch map in report section 1", None),
 3: (PA, "ATLASZ_V73_AUDIT_REPORT.md", "c1 c2", "65 addon modules imported and classified; per-module report not written", None),
 4: (PA, "", "", "worker image/Dockerfile seen; Railway services UNKNOWN", "EXTERNAL: Railway access"), 5: (PA, "", "", "package.json/config files inspected", None),
 6: (PA, "", "", "No DB/schema found; state is JSON/JSONL files", None), 7: (PA, R+"supervisor-safe.mjs", "cq", "HTTP endpoints enumerated: /health /status /opportunities /events", None),
 8: (PA, A+"universal-connector-layer.mjs", "pe", "No real connectors found", None), 9: (PA, R+"supervisor-safe.mjs", "cr", "30 agents defined in runtime", "Older supervisor.js not audited line by line"),
 10: (PA, "", "", "Workflows are module-level only", None), 11: (EW, "", "", "No desktop code existed (S21 MISSING) - finding", None),
 12: (PA, "", "", "Deployment configs inspected; live deployment UNKNOWN", "EXTERNAL: Railway access"), 13: (EW, "atlasz-tests/", "", "No tests existed before this work; now 130+", None),
 14: (PA, "evidence/", "", "No pre-existing runtime evidence found", None), 15: (PA, "", "", "History scanned for secret patterns; values never printed", "Scan not automated in CI"),
 16: (PA, "atlasz-astra/*.md", "", "Docs read; accuracy not verified line by line", None), 17: (EW, "docs/atlasz_v73_requirement_registry.json", "reg", "Registry built from V7.3 spec", None)})
add(44, {
 1: (PA, "", "", "Applied to P0 modules", "Remaining modules inspected only at export level"), 2: (PA, "", "", "Applied to P0 modules", None),
 3: (PA, "atlasz-tests/", "", "134 tests; most modules still untested", None), 4: (PA, "", "", "Mutation checks on key tests", None),
 5: (PA, "", "", "Compared against spec for P0 sections", None), 6: (PA, "", "", "Correctness evidenced for tested modules only", None),
 7: (PA, "", "", "Security reviewed for P0 modules", None), 8: (PA, "", "", "Maintainability not measured", None),
 9: (PA, "", "", "Compatibility with existing runtime verified by the existing tests still passing", None), 10: (PA, "atlasz-tests/", "", "Testable P0 modules covered", None),
 11: (PA, "docs/atlasz_v73_requirement_registry.json", "reg", "Tracked in registry", None)})
