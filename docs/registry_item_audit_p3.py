# Item-level statuses for P3/P4 sections: S04 S05 S06 S07 S16 S21 S22 S28-S33 S38 S39 S40 S47 S49 S50.
# Rule: a status here comes from reading the code and finding a test; absence of code is stated as MISSING (verified by repo keyword scan 2026-10-07).
A, T, R, C = "atlasz-addons/", "atlasz-tests/", "atlasz-runtime/", "atlasz-control-center/"
TESTS = dict(cc=T+"control-center.test.mjs", cm=T+"contract-memory-control.test.mjs", cf=T+"contract-factories.test.mjs", c1=T+"contract-existing-modules.test.mjs", c2=T+"contract-core-engine.test.mjs",
  pe=T+"probe-evidence.test.mjs", ar=T+"approval-requests.test.mjs", br=T+"backup-recovery.test.mjs", uc=T+"update-center.test.mjs", cr=T+"canonical-runtime.test.mjs", cq=T+"canonical-queue-safety.test.mjs",
  es=T+"emergency-stop.test.mjs", stop=T+"stop-enforcement.test.mjs", q=T+"durable-queue.test.mjs", safe=T+"safety-modules.test.mjs", auth=T+"owner-auth.test.mjs", mt=T+"contract-money-tax.test.mjs", ev=T+"evidence-record.test.mjs", reg=T+"registry-integrity.test.mjs")
EW, NT, PA, SO, MI, EB = "EXISTS_AND_WORKING", "EXISTS_NEEDS_TEST", "PARTIAL", "STRUCTURAL_ONLY", "MISSING", "EXTERNAL_BLOCKER"
MEM = "In-memory module state: lost on restart"
NOPROV = "EXTERNAL: no provider/credentials connected; any paid API needs separate Joci approval"
I = {}
def add(sec, rows):
    for n, (st, loc, tests, ev, blk) in rows.items():
        I["V73-S%02d-%03d" % (sec, n)] = dict(status=st, implementation_location=loc, tests=[TESTS[t] for t in tests.split()] if tests else [], evidence=[ev] if ev else [], blocker=blk)
def many(sec, rng, row): add(sec, {n: row for n in rng})
NOCODE = "Repo keyword scan: no implementation exists"

# S04 Human Core: nothing implemented (scan for emotion/compassion/tone/human-impact found only registry labels and UI text).
many(4, range(1, 18), (MI, None, "", NOCODE + " (only a PLANNED label in completion-registry)", None))
add(4, {8: (MI, None, "", NOCODE + "; Guardrails/owner approval gates exist but are not a Human Impact Judge", None),
        16: (PA, A+"approval-command-gateway.mjs; "+A+"approval-requests.mjs", "ar auth", "Owner-approval requirement decision exists for consequential actions; not a human-consequence review", None)})

# S05 Voice: provider-neutral wrapper only; a tested STT+TTS pair is required for LIVE.
add(5, {
 1: (MI, None, "", "No session/continuous conversation logic", None), 2: (MI, None, "", "No push-to-talk/hands-free", None),
 3: (PA, A+"voice-interface.mjs", "pe", "stt provider object; transcribe refuses untested provider (VOICE_STT_UNTESTED)", NOPROV),
 4: (PA, A+"voice-interface.mjs", "pe", "tts provider object; speak refuses untested provider", NOPROV),
 5: (MI, None, "", "Single stt/tts only; no fallback chain", None), 6: (EB, None, "", "No microphone capture code", "EXTERNAL: Windows audio device / provider"),
 7: (EB, None, "", "No audio playback code", "EXTERNAL: Windows audio device / provider"), 8: (MI, None, "", "No interrupt handling", None),
 9: (MI, None, "", "No voice command parser", None), 10: (MI, None, "", "No spoken status", None),
 11: (PA, A+"approval-command-gateway.mjs; "+A+"owner-auth.mjs", "auth", "Approvals are Ed25519-signed; a bare boolean/voice assertion is rejected. No voice path exists", "No voice, and strong voice auth is not designed"),
 12: (MI, None, "", "No transcript store", None), 13: (MI, None, "", "No memory linkage", None), 14: (MI, None, "", "No latency metrics", None),
 15: (PA, A+"voice-interface.mjs", "pe", "status(): PLACEHOLDER_UNCONNECTED / CONNECTED_UNTESTED / LIVE only with probe evidence", None),
 16: (SO, C+"public/app.js", "", "Voice panel states NOT BUILT; no controls", None), 17: (MI, None, "", "No on/off setting", None), 18: (MI, None, "", "No voice selection", None)})

# S06 Personal ATLASZ: nothing implemented beyond the owner-only registry.
many(6, range(1, 13), (MI, None, "", NOCODE, None))
add(6, {2: (PA, A+"shared-project-registry.mjs", "cm", "Project registry (owner JOCI only)", MEM), 4: (PA, A+"owner-auth.mjs; "+A+"enterprise-control-plane.mjs", "auth cm", "Permissions for agents/tools; owner approvals", MEM),
        6: (PA, A+"approval-command-gateway.mjs", "auth", "Approval rules by action risk are hard-coded", "No owner-editable rule store"),
        9: (PA, A+"secret-vault.mjs", "safe", "Secrets are owner-gated; no general owner-only data store", None)})

# S07 Memory / learning / knowledge
add(7, {
 1: (PA, A+"business-memory.mjs", "cm", "remember/recall with importance and expiry", MEM), 2: (PA, A+"business-memory.mjs", "cm", "Same module", MEM),
 3: (PA, A+"experience-learning-engine.mjs", "cm", "Experiences recorded; lessons reusable only after owner approval", MEM),
 4: (PA, A+"approval-requests.mjs", "ar", "Owner decisions persisted (decisions.jsonl); no general decision memory", "Only approval decisions"),
 5: (PA, A+"audit-chain.mjs; "+A+"evidence-record.mjs", "ev safe", "Hash-chained audit and evidence records of real actions", None),
 6: (PA, A+"dead-letter-queue.mjs; "+A+"durable-queue.mjs", "q c2", "Dead-letter jobs persisted in the durable queue journal", "Not a searchable knowledge base"),
 7: (PA, A+"experience-learning-engine.mjs", "cm", "lessonsFor ranks approved lessons by reward minus cost", MEM),
 8: (PA, A+"shared-project-registry.mjs", "cm", "Project objective/status/evidence", MEM),
 9: (PA, A+"enterprise-knowledge-agentic-rag.mjs", "c1", "Role/tenant-gated knowledge store", MEM+"; secret-vault is for secrets, not knowledge"),
 10: (PA, A+"enterprise-knowledge-agentic-rag.mjs", "c1", "Token-overlap retrieval and grounded context with citations; no vector index", MEM),
 11: (PA, A+"unified-entity-graph.mjs", "cm", "Tenant-scoped entities and links", MEM),
 12: (PA, A+"shared-project-registry.mjs", "cm", "Owner JOCI only; patch cannot change owner/id", MEM),
 13: (EW, A+"outcome-compiler.mjs", "cf", "Compile, validate, owner-gated execution request", None),
 14: (MI, None, "", NOCODE, None), 15: (MI, None, "", NOCODE, None),
 16: (PA, A+"enterprise-knowledge-agentic-rag.mjs; "+A+"evidence-record.mjs", "c1 ev", "sourceId/uri/verified returned as citations", "Only on knowledge and evidence objects"),
 17: (PA, A+"enterprise-knowledge-agentic-rag.mjs", "c1", "freshnessAt stored and returned", "No staleness decision or ranking")})

# S16 Digital Twin / Simulation Lab
many(16, range(1, 7), (MI, None, "", NOCODE + " (completion-registry only names it)", None))
add(16, {4: (PA, A+"cost-model-router.mjs; "+A+"opportunity-qualification-engine.mjs", "c2 mt", "Cost estimate and qualification margin checks exist for real decisions, not a simulation lab", None)})

# S22 plugins / themes
many(22, range(1, 14), (MI, None, "", NOCODE, None))
add(22, {3: (PA, A+"update-center.mjs", "uc", "Component version/compatibility/rollback exists for update components", "No plugin lifecycle"),
         8: (PA, A+"enterprise-control-plane.mjs", "cm", "Per-agent permissions/tools; no per-plugin permissions", MEM),
         9: (PA, A+"update-center.mjs", "uc", "Compatibility check for update components", "No plugin compatibility"),
         12: (PA, A+"update-center.mjs; "+A+"backup-recovery.mjs", "uc br", "Rollback to LKG for update components", "No plugin uninstall")})

# S28 media: tool names only
many(28, range(1, 11), (MI, None, "", NOCODE + " (no media adapters)", None))
add(28, {2: (SO, A+"execution-factory.mjs", "cf", "VIDEO tool-profile names only: script_assets, media_pipeline, subtitle_audio, render, qc", "No adapters")})
many(28, [1, 2, 3, 4, 5], (MI, None, "", NOCODE + " (no media adapters)", NOPROV))
add(28, {2: (SO, A+"execution-factory.mjs", "cf", "VIDEO tool-profile names only", NOPROV)})

# S29 software / automation factory
add(29, {
 1: (MI, None, "", "No code generation in ATLASZ runtime (model call path has no provider)", NOPROV), 2: (MI, None, "", NOCODE, None),
 3: (PA, A+"self-healing-loop.mjs; "+A+"recovery.mjs", "c1 c2", "Bounded detect/retry/repair loops tested; no code debugging", None),
 4: (PA, A+"skill-factory.mjs", "cf", "testSkill requires a real test function; TESTED only on pass", None), 5: (MI, None, "", NOCODE, None),
 6: (PA, A+"tool-bridge.mjs; "+A+"universal-connector-layer.mjs", "pe", "Connector/tool registration; TESTED needs probe evidence", NOPROV),
 7: (MI, None, "", NOCODE, None), 8: (SO, A+"skill-factory.mjs; "+A+"executor-toolbox-registry.mjs", "cf pe", "Definitions only", None),
 9: (MI, None, "", "No deploy preparation module", None), 10: (PA, A+"qa-reviewer.mjs", "c1", "QA reviewer exists; not code review", None),
 11: (PA, T+"policy-guards.test.mjs", "", "Static policy guards scan repo for secrets/forbidden markers", "Not a security scanner for generated code"),
 12: (EW, A+"regression-eval-suite.mjs", "c2", "requireNoRegression enforced", None), 13: (PA, A+"backup-recovery.mjs", "br", "Backup/LKG rollback for ATLASZ state", "Not code deployment rollback"),
 14: (PA, "docs/", "", "docs/CONTROL_CENTER.md and audit report exist; no doc generator", None), 15: (EW, A+"evidence-record.mjs", "ev", "Structured evidence records", None)})

# S30 website operations
many(30, range(1, 9), (MI, None, "", NOCODE, None))

# S31 market / opportunity intelligence
add(31, {
 1: (PA, A+"market-intelligence-engine.mjs", "cf", "Signal analysis ignores signals without source/time/strength; no feeds", "EXTERNAL: data sources"),
 2: (PA, A+"unified-entity-graph.mjs", "cm", "Generic entity graph, no company index", MEM), 3: (PA, A+"buyer-decision-maker-finder.mjs", "mt", "Buyer ranking rules", "EXTERNAL: no contact data source"),
 4: (MI, None, "", NOCODE + " (only HN-based discovery in canonical runtime)", None), 5: (MI, None, "", NOCODE, None), 6: (MI, None, "", NOCODE, None), 7: (MI, None, "", NOCODE, None),
 8: (MI, None, "", NOCODE, None), 9: (MI, None, "", NOCODE, None), 10: (PA, A+"market-intelligence-engine.mjs", "cf", "Topic grouping of signals", None),
 11: (MI, None, "", NOCODE, None), 12: (PA, R+"supervisor-safe.mjs", "cr", "Timer-driven recurring search", "No user-defined saved searches"),
 13: (MI, None, "", NOCODE, None), 14: (MI, None, "", "Source is hard-coded", None), 15: (PA, A+"enterprise-knowledge-agentic-rag.mjs", "c1", "freshnessAt field", "No freshness policy"),
 16: (PA, A+"market-intelligence-engine.mjs", "cf", "sources listed per trend", None), 17: (PA, R+"supervisor-safe.mjs; "+A+"durable-queue.mjs", "cq q", "Candidate id and queue idempotency key prevent duplicates", "Not cross-source dedup"),
 18: (MI, None, "", NOCODE, None), 19: (PA, A+"opportunity-qualification-engine.mjs", "mt", "Blockers and qualification rules", "Not tender eligibility"),
 20: (MI, None, "", NOCODE, None), 21: (MI, None, "", NOCODE, None), 22: (MI, None, "", NOCODE, None)})

# S32 map / location
many(32, range(1, 8), (MI, None, "", NOCODE, None))

# S33 performance
add(33, {
 1: (PA, A+"capability-registry.mjs", "c2", "matchAgents by capability", None), 2: (PA, A+"cost-model-router.mjs", "c2", "chooseRoute by cost/quality; no fast/deep modes", NOPROV),
 3: (PA, A+"priority-queue-rate-limit-governor.mjs", "c1", "Concurrency/rate limits", None), 4: (MI, None, "", NOCODE, None), 5: (MI, None, "", NOCODE, None),
 6: (EW, A+"durable-queue.mjs", "q cq", "Durable queue with leases, retries, DLQ, idempotency", None),
 7: (PA, A+"durable-queue.mjs; "+A+"watchdog.mjs", "q safe", "Lease expiry re-queues work; watchdog escalates", "No provider failover (no providers)"),
 8: (PA, A+"priority-queue-rate-limit-governor.mjs; "+A+"budget-consumption-governor.mjs", "c1", "Rate and budget governors", None),
 9: (MI, None, "", NOCODE, None), 10: (MI, None, "", NOCODE, None), 11: (MI, None, "", NOCODE, None), 12: (PA, C+"public/app.js", "cc", "Static UI; no performance measurement", None),
 13: (MI, None, "", "No latency metrics", None), 14: (PA, R+"supervisor-safe.mjs", "cr", "Counters in dashboard; no throughput rates", None), 15: (PA, A+"budget-consumption-governor.mjs", "c1", "Cost recorded", "No performance ratio")})

# S38 modes
add(38, {1: (MI, None, "", "No mode model", None), 2: (MI, None, "", NOCODE, None), 3: (MI, None, "", NOCODE, None), 4: (MI, None, "", NOCODE, None), 5: (MI, None, "", NOCODE, None),
 6: (MI, None, "", NOCODE, None), 7: (MI, None, "", NOCODE, None), 8: (PA, A+"safe-mode.mjs; "+C+"core.mjs", "safe cc", "Safe Mode and System Doctor exist; not a selectable mode", None)})

# S39 mobile
many(39, range(1, 10), (MI, None, "", NOCODE + " (Control Center binds 127.0.0.1 only; no remote/mobile access)", None))

# S40 technology watch
add(40, {1: (MI, None, "", NOCODE, None), 2: (PA, A+"capability-registry.mjs", "c2", "Registry of declared capabilities", None), 3: (PA, A+"completion-registry.mjs; "+A+"internal-integration-hub.mjs", "reg", "Self-inventory of modules", "Static, not runtime-probed"),
 4: (PA, A+"general-intelligence-extensions.mjs", "cf", "8 slots: PLACEHOLDER_UNCONNECTED / CONNECTED_UNTESTED; never live by itself", NOPROV), 5: (PA, A+"general-intelligence-extensions.mjs", "cf", "Placeholder count visible; no gap analysis", None),
 6: (PA, A+"probe-evidence.mjs", "pe", "Probe evidence gate for providers/tools/connectors", NOPROV), 7: (MI, None, "", NOCODE, None), 8: (PA, A+"update-center.mjs", "uc", "Update proposals with risk classification", "No adapters detect real updates"),
 9: (MI, None, "", NOCODE, None), 10: (PA, A+"enterprise-knowledge-agentic-rag.mjs", "c1", "freshnessAt field", "No freshness policy")})

# S47 commercial, later plan
many(47, range(1, 7), (MI, None, "", NOCODE + " (later plan by design)", None))
add(47, {3: (PA, "AGENTS.md; "+T+"policy-guards.test.mjs", "", "Owner authority is enforced by signed approvals; no tenant model", None)})

# S49 final-goal statements (one per overall capability)
add(49, {
 1: (PA, A+"master-planner-orchestrator.mjs", "c2 c1", "Plan creation/replan logic; no reasoning model connected", NOPROV), 2: (EB, None, "", "No voice, no conversation", "EXTERNAL: STT/TTS; chat not built"),
 3: (MI, None, "", NOCODE, None), 4: (PA, A+"business-memory.mjs; "+A+"experience-learning-engine.mjs", "cm", "Memory modules", MEM),
 5: (EW, R+"supervisor-safe.mjs", "cr cq", "Exactly 5 SEARCH + 25 EXECUTION asserted in real-process tests", None),
 6: (PA, A+"cost-model-router.mjs; "+A+"tool-bridge.mjs", "c2 pe", "Routing logic with probe-evidence gates", NOPROV),
 7: (EB, A+"computer-use-fabric.mjs", "stop pe", "Gated framework; no provider", "EXTERNAL: sandbox computer-use provider"), 8: (MI, None, "", "No document/file management module", None),
 9: (PA, R+"supervisor-safe.mjs", "cr", "HN-based research/discovery only", "One public source"), 10: (PA, R+"supervisor-safe.mjs; "+A+"opportunity-qualification-engine.mjs", "cr mt", "Candidates found and qualified; none verified as paying work", "No real revenue evidence"),
 11: (PA, A+"execution-factory.mjs", "cf", "Job state machine only", "No real client work executed"), 12: (PA, A+"qa-reviewer.mjs; "+A+"anti-collusion-guard.mjs", "c1 c2", "QA modules tested", "No independent live judge model"),
 13: (PA, A+"delivery-engine.mjs; "+A+"invoice-engine.mjs; "+A+"profit-ledger.mjs", "mt", "Truthful state machines", "No real delivery/payment evidence"),
 14: (PA, A+"tax-accounting-engine.mjs", "mt", "Preparation workflow blocked until verified rules", "EXTERNAL: verified rules"), 15: (MI, None, "", "See S28/S29", None),
 16: (EW, A+"watchdog.mjs; "+A+"startup-self-check.mjs", "safe cq", "Watchdog, self-check, doctor", None), 17: (PA, A+"backup-recovery.mjs; "+A+"update-center.mjs", "br uc", "LKG rollback tested", "Update adapters missing"),
 18: (EW, A+"owner-auth.mjs; "+A+"emergency-stop.mjs", "auth es stop", "Signed approvals and durable fail-safe kill switch", "Owner public key not provisioned in a real deployment"),
 19: (EW, A+"evidence-record.mjs", "ev", "Evidence record schema; make-evidence script", None)})

# S50 process instructions for Codex: met by working method; evidence is the repo/process itself
add(50, {1: (EW, "docs/atlasz_v73_requirement_registry.json", "reg", "Registry built once from V7.3, integrity-tested", None), 2: (PA, None, "", "Working method; not testable", None),
 3: (PA, None, "", "Working method", None), 4: (PA, None, "", "Working method", None),
 5: (EW, "atlasz-addons/checkpoint-engine.mjs; /mnt/user-data/outputs/checkpoints", "c2", "Checkpoints taken in this build and in the engine", None), 6: (PA, None, "", "Session summaries and git history", None)})
