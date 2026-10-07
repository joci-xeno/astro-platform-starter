# Item-level statuses for the P1 sections (S08, S15, S17, S18, S19, S20, S23, S24, S37, S46, S48, S51, S52). Same rules as the P0 file.
A, T, R = "atlasz-addons/", "atlasz-tests/", "atlasz-runtime/"
TESTS = dict(auth=T+"owner-auth.test.mjs", es=T+"emergency-stop.test.mjs", gated=T+"gated-modules.test.mjs", q=T+"durable-queue.test.mjs", br=T+"backup-recovery.test.mjs",
  uc=T+"update-center.test.mjs", cr=T+"canonical-runtime.test.mjs", cq=T+"canonical-queue-safety.test.mjs", safe=T+"safety-modules.test.mjs", cc=T+"control-center.test.mjs",
  c1=T+"contract-existing-modules.test.mjs", c2=T+"contract-core-engine.test.mjs", pe=T+"probe-evidence.test.mjs", stop=T+"stop-enforcement.test.mjs", ar=T+"approval-requests.test.mjs",
  reg=T+"registry-integrity.test.mjs", pol=T+"policy-guards.test.mjs")
EW, NT, PA, SO, MI, EB, JA = "EXISTS_AND_WORKING", "EXISTS_NEEDS_TEST", "PARTIAL", "STRUCTURAL_ONLY", "MISSING", "EXTERNAL_BLOCKER", "BLOCKED_AWAITING_JOCI_APPROVAL"
MEM = "In-memory module state: lost on restart"
NOPROV = "EXTERNAL: no credentials/provider connected; any paid API needs separate Joci approval"
I = {}
def add(sec, rows):
    for n, (st, loc, tests, ev, blk) in rows.items():
        I["V73-S%02d-%03d" % (sec, n)] = dict(status=st, implementation_location=loc, tests=[TESTS[t] for t in tests.split()] if tests else [], evidence=[ev] if ev else [], blocker=blk)
def many(sec, rng, row):
    add(sec, {n: row for n in rng})

add(8, {n: (EB, A+"multi-model-brain.mjs", "pe", "Provider slot exists; nothing attached", NOPROV) for n in range(1, 8)})
add(8, {
 8: (PA, A+"multi-model-brain.mjs", "pe", "Any provider needs probe evidence; Joci-approval gating of new models not enforced in code", "Add owner-gated provider registration"),
 9: (PA, A+"multi-model-brain.mjs", "pe c2", "registerModelProvider/modelProviderList tested", MEM),
 10: (PA, A+"multi-model-brain.mjs", "c2", "selectModel by required capabilities; untested providers never chosen", MEM),
 11: (SO, A+"cost-model-router.mjs", "c2", "Routes by cost/quality only; no task classification", "Needs a task classifier (model)"),
 12: (MI, None, "", "No fast/deep router", None),
 13: (PA, A+"cost-model-router.mjs", "c2", "Budget-bounded route choice; none within budget -> owner approval", None),
 14: (PA, A+"cost-model-router.mjs", "c2", "minimumQuality filter on caller-supplied scores", "No measured quality data"),
 15: (MI, None, "", "No fallback router (self-heal has an alternate hook only)", None),
 16: (PA, A+"multi-model-brain.mjs", "c2", "independentJudgePlan requires a different live provider", NOPROV),
 17: (SO, A+"multi-model-brain.mjs", "pe", "modelProviderHealth lists registered state; no live probing", NOPROV),
 18: (PA, A+"budget-consumption-governor.mjs; cost-model-router.mjs", "c1 c2", "Budget usage and actualCost tested", MEM),
 19: (MI, None, "", "No model performance memory", None), 20: (MI, None, "", "No availability monitoring", None)})
add(15, {
 1: (PA, A+"multi-model-brain.mjs; qa-reviewer.mjs", "c2", "Plan requires a different provider", NOPROV), 2: (EW, A+"qa-reviewer.mjs", "c1", "PASS only with evidence for every required check", None),
 3: (MI, None, "", "No human impact judge", None), 4: (EW, A+"guardrail-engine.mjs", "c2 stop", "High-risk actions, truthfulness, credentials", None),
 5: (PA, A+"guardrail-engine.mjs; tax-accounting-engine.mjs", "c2", "Risk classification only", "No transaction risk model"),
 6: (EW, A+"anti-collusion-guard.mjs", "c2", "Unauthorised goals, self-evaluation, hidden channels flagged", None),
 7: (EW, A+"anti-collusion-guard.mjs", "c2", "GAME_EVALUATION/SACRIFICE intents flagged", None), 8: (MI, None, "", "No emergent behaviour monitor", None),
 9: (EW, A+"regression-eval-suite.mjs", "c2", "Failing/throwing/duplicate tests handled; regression gate", None), 10: (MI, None, "", "No contradiction checks", None),
 11: (EW, A+"qa-reviewer.mjs; tracing-evals.mjs", "c1 c2", "Evidence required per check/criterion", None)})
add(17, {
 1: (EW, "atlasz-control-center/core.mjs", "cc", "Doctor: self-check + audit verification + backup/LKG/runtime findings with remedies", "Runs on demand, not scheduled"),
 2: (EW, A+"watchdog.mjs", "safe", "Heartbeat/probe/hang detection, escalation to Safe Mode", None),
 3: (PA, R+"supervisor-safe.mjs; "+A+"startup-self-check.mjs", "cq safe", "/health, startup self-check, watchdog", None),
 4: (PA, A+"startup-self-check.mjs", "safe", "Node, disk, state files", "No external dependency probing"),
 5: (SO, A+"multi-model-brain.mjs", "pe", "Registered state only", NOPROV), 6: (MI, None, "", "No anomaly detection", None),
 7: (PA, A+"self-healing-loop.mjs; update-center.mjs", "c1 uc", "Repair limited to retry/alternate/rollback; otherwise BLOCKED for human", None),
 8: (EW, A+"update-center.mjs; backup-recovery.mjs", "uc br cc", "Automatic and manual rollback, LKG restore", None),
 9: (PA, A+"audit-chain.mjs; update-center.mjs", "uc safe", "Audit chains record failures; no incident entity", None), 10: (MI, None, "", "No push/email alerting; banner only while the UI is open", None)})
add(18, {
 1: (PA, A+"tool-fabric.mjs", "pe", "Catalogue + evidence-gated connect", NOPROV), 2: (PA, A+"executor-toolbox-registry.mjs", "pe c2", "Registry with evidence-gated availability", MEM),
 3: (PA, A+"capability-registry.mjs", "c2", "Match agents by capabilities", MEM), 4: (NT, A+"skill-factory.mjs", "", "Not covered by tests", None),
 5: (NT, A+"agent-factory.mjs", "gated", "Owner gate tested; creation logic not", None), 6: (NT, A+"execution-factory.mjs", "gated", "Owner gate tested; logic not", None),
 7: (SO, A+"tool-fabric.mjs", "", "Catalogue lookup only", None), 8: (PA, A+"executor-toolbox-registry.mjs", "c2", "executionPlan reports missing capabilities", MEM),
 9: (SO, A+"probe-evidence.mjs", "pe", "Evidence gate exists; nothing runs probes", None), 10: (PA, A+"universal-connector-layer.mjs", "pe", "Evidence-gated TESTED status; permission match", NOPROV),
 11: (NT, A+"tool-bridge.mjs", "", "attach() wires three registries; not tested directly", None), 12: (PA, A+"internal-integration-hub.mjs", "cq", "Runs inside the runtime; internal only, no external side effects", None),
 13: (MI, None, "", "No real provider adapters", NOPROV), 14: (PA, A+"universal-connector-layer.mjs", "c2", "permission match in resolveConnector", None),
 15: (PA, A+"tool-fabric.mjs", "pe", "toolFabricSummary counts only evidenced tools", None), 16: (PA, A+"update-center.mjs", "uc", "Component versions tracked for updates", None),
 17: (EW, A+"probe-evidence.mjs", "pe", "LIVE requires structured probe evidence; mutation-tested", None)})
many(19, range(1, 9), (EB, A+"computer-use-fabric.mjs", "pe stop", "Owner-gated provider slot; no provider attached", "EXTERNAL: no computer-use provider"))
add(19, {9: (EB, None, "", "No sandboxed browser provider attached", "EXTERNAL: provider"), 10: (PA, A+"computer-use-fabric.mjs", "pe stop", "Authorize decisions audited", MEM)})
add(20, {1: (MI, None, "", "No real adapters", NOPROV), 2: (MI, None, "", "No connector auth flow", NOPROV), 3: (PA, A+"universal-connector-layer.mjs", "c2", "Permission matching", None),
 4: (PA, A+"secret-vault.mjs", "safe", "Vault exists; no connector uses it", None), 5: (PA, A+"universal-connector-layer.mjs", "pe", "connectorHealth", NOPROV),
 6: (EB, None, "", "Needs authorized real accounts", "EXTERNAL + Joci approval"), 7: (EB, None, "", "None collected", "EXTERNAL"),
 8: (PA, A+"self-healing-loop.mjs; update-center.mjs", "c1 uc", "Fail-closed/BLOCKED behaviour", None)})
many(23, range(1, 26), (MI, None, "", "No document center module; document-format tools exist only as catalogue entries", None))
add(23, {26: (MI, None, "", "No document versioning", None), 27: (MI, None, "", "Not built", None), 28: (MI, None, "", "Not built", None), 29: (MI, None, "", "Not built", None),
 30: (PA, A+"audit-chain.mjs", "safe", "Generic audit chain exists; not document-specific", None), 31: (PA, A+"backup-recovery.mjs", "br", "Backs up the state directory, not a document store", None),
 32: (PA, A+"backup-recovery.mjs", "br", "Restore of state directory only", None), 33: (MI, None, "", "No conversions", None), 34: (MI, None, "", "No archive handling", None),
 35: (MI, None, "", "No archive extraction (backup walk skips symlinks)", None), 36: (MI, None, "", "No extraction", None)})
many(24, range(1, 14), (MI, None, "", "Not built", None))
add(24, {9: (SO, A+"enterprise-knowledge-agentic-rag.mjs", "c1", "Lexical token overlap, not semantic", None), 10: (PA, A+"enterprise-knowledge-agentic-rag.mjs", "c1", "Tenant/role-isolated lexical retrieval", MEM+"; no embeddings"),
 11: (PA, A+"enterprise-knowledge-agentic-rag.mjs", "c1", "Citations carry sourceId/uri", None)})
add(37, {
 1: (MI, None, "", "No automatic backup policy/scheduler", None), 2: (EW, "atlasz-control-center/core.mjs", "cc br", "backupNow with sha256 manifest", None), 3: (EW, A+"backup-recovery.mjs", "br cc", "Verified restore; overwrite needs signed approval", None),
 4: (EW, A+"backup-recovery.mjs; update-center.mjs", "br uc", "LKG rollback and update rollback", None), 5: (PA, A+"backup-recovery.mjs", "br", "Backup ids/manifests; no version browser", None),
 6: (MI, None, "", "No point-in-time recovery", None), 7: (MI, None, "", "No disaster-recovery package", None), 8: (PA, A+"backup-recovery.mjs", "br", "Config in the state dir is covered; owner key dir is separate", None),
 9: (MI, None, "", "No database exists (state is files)", None), 10: (PA, A+"backup-recovery.mjs", "br", "State dir backup", None), 11: (PA, A+"backup-recovery.mjs", "br", "Audit/evidence files in state dir are covered", None),
 12: (EW, A+"backup-recovery.mjs", "br cc", "recoveryDrill restores to scratch and compares hashes", None)})
add(46, {
 1: (EB, "atlasz-control-center/", "cc", "Installer config written; never built or run on Windows", "EXTERNAL: electron/electron-builder blocked (403) here; needs GitHub push or a Windows build"),
 2: (EB, ".github/workflows/build-windows-installer.yml", "", "Installer creates desktop shortcut by config only", "Not built/run"),
 3: (PA, "atlasz-control-center/", "cc", "Owner key + passphrase; local token session; no user accounts", None), 4: (MI, None, "", "No MASTER chat", None),
 5: (EB, None, "", "No voice provider", "EXTERNAL"), 6: (MI, None, "", "No Human Core", None),
 7: (EW, "atlasz-control-center/core.mjs; "+R+"supervisor-safe.mjs", "cc cr", "Agents panel + runtime show 5+25", None),
 8: (PA, R+"supervisor-safe.mjs", "cq", "Queue works; scheduler is timers", None), 9: (MI, None, "", "No user-startable task (only automatic screening)", None),
 10: (PA, R+"supervisor-safe.mjs", "cq", "Screening checkpoint/resume only", None), 11: (PA, A+"computer-use-fabric.mjs", "stop", "Gate tested; no provider", "EXTERNAL"),
 12: (SO, A+"tool-fabric.mjs", "pe", "No real tool connected", NOPROV), 13: (EB, None, "", "No connectors", "EXTERNAL + Joci approval"),
 14: (MI, None, "", "No document center", None), 15: (PA, A+"money-pipeline-controller.mjs", "c1", "States real in code; no real money data", "EXTERNAL: payment evidence source"),
 16: (EW, A+"money-pipeline-controller.mjs; profit-ledger.mjs; payment-confirmation-adapter.mjs", "c1", "PAID requires evidence; nothing counted without it", "Provider signature verification is caller-asserted (adapter wiring pending)"),
 17: (PA, A+"multi-model-brain.mjs", "c2", "Needs a second provider", NOPROV), 18: (PA, A+"owner-auth.mjs", "auth ar", "Mechanism works; key not provisioned", "Joci must create the owner key"),
 19: (EW, A+"emergency-stop.mjs; atlasz-control-center/core.mjs", "es cc stop", "Real runtime process paused by signed approval, CLI and GUI paths", None),
 20: (PA, "atlasz-control-center/", "cc", "Approvals history, doctor, blockers visible; no event log panel", None), 21: (EW, A+"backup-recovery.mjs", "br cc", "Backup + drill + signed restore tested", None),
 22: (EW, "atlasz-control-center/core.mjs", "cc", "Doctor tested incl. tampered chain", None), 23: (PA, "", "pol", "Static secret-pattern scan of tracked files passes", "Not a full secret scanner"),
 24: (EW, "atlasz-control-center/public/app.js", "cr cc", "Blockers listed on Overview; honest NOT BUILT panels", None),
 25: (PA, "", "reg pe pol", "Registry forbids LIVE statuses; probe evidence gate", "Not exhaustive across all modules")})
add(48, {
 1: (PA, A+"probe-evidence.mjs; money-pipeline-controller.mjs", "pe c1 reg", "Gates exist and are mutation-tested", "Payment provider confirmation flags are still caller-asserted"),
 2: (PA, A+"secret-vault.mjs", "safe", "No credential is ever fabricated by code; vault stores real ones only", None),
 3: (PA, A+"probe-evidence.mjs; payment-confirmation-adapter.mjs", "pe c1", "Evidence structure enforced; authenticity not provable without provider", "Needs real provider verification adapter"),
 4: (PA, R+"supervisor-safe.mjs", "cr", "No outreach exists at all; nothing is sent", None), 5: (MI, None, "", "No legality check on work types", None),
 6: (EW, A+"owner-auth.mjs", "auth gated", "Booleans rejected in 14 modules", None), 7: (PA, A+"owner-auth.mjs", "auth stop", "Server cannot forge approvals; in-process code could bypass guards", "No plugin sandbox"),
 8: (PA, A+"audit-chain.mjs; computer-use-fabric.mjs", "safe c1", "Tamper-evident; 'disable-audit-log' is a FORBIDDEN computer action", None), 9: (PA, A+"computer-use-fabric.mjs; secret-vault.mjs", "c1 safe", "Forbidden action + redaction", None),
 10: (EW, A+"guardrail-engine.mjs; budget-consumption-governor.mjs", "c2 c1", "Spend actions need owner approval; runtime budget $0", None),
 11: (EW, A+"guardrail-engine.mjs", "stop", "Loan/credit need owner approval", None), 12: (EW, R+"supervisor-safe.mjs", "cr", "Fixed 30; self-check FAIL on other topology", None),
 13: (EW, "runtime code", "pol", "Static test: no VIRENA/GMP integration in runtime code", None),
 14: (PA, "atlasz-runtime/worker.js", "pol", "No 300-agent code; legacy worker.js still carries the 'atlasz-competition-v1' policy (30 agents, 6 teams, prize text); not reachable from start:canonical", "JOCI DECISION: quarantine or remove legacy worker.js (EXCLUDED_LEGACY)"),
 15: (PA, "docs/", "reg", "Old Railway/commit statements recorded as historical only (Railway = UNKNOWN)", None)})
add(51, {
 1: (PA, R+"supervisor-safe.mjs", "cr", "VERSION constant 3.3.0 + git hash in bundle", "No build id endpoint"), 2: (PA, "package.json", "", "Versions in package.json; no lockfile check", None),
 3: (EW, A+"backup-recovery.mjs", "br", "LKG criterion healthOk enforced", None), 4: (EW, A+"backup-recovery.mjs", "br", "LKG criterion smokeTestsPassed enforced (+evidence)", None),
 5: (PA, A+"backup-recovery.mjs", "br", "LKG criterion migrationStateKnown (no DB)", None), 6: (EW, A+"backup-recovery.mjs; update-center.mjs", "br uc", "Backup before every install", None),
 7: (EW, A+"backup-recovery.mjs; update-center.mjs", "br uc", "Rollback path hash-verified", None), 8: (EW, A+"backup-recovery.mjs", "br", "LKG_EVIDENCE_REQUIRED", None),
 9: (PA, A+"update-center.mjs", "uc", "Component versions", None), 10: (MI, None, "", "No config versioning", None), 11: (MI, None, "", "No schema version (no DB)", None),
 12: (MI, None, "", "No agent/workflow versions", None), 13: (MI, None, "", "No connector config versions", None), 14: (MI, None, "", "No routing config versions", None),
 15: (PA, A+"update-center.mjs", "uc", "Per-component versions", None), 16: (EW, A+"backup-recovery.mjs", "br", "createLkgRegistry.latest()", None),
 17: (PA, "atlasz-control-center/core.mjs", "cc", "backups() lists verified backups", None), 18: (PA, A+"backup-recovery.mjs", "br", "Drill result not persisted as 'last restore test'", None),
 19: (PA, "atlasz-control-center/core.mjs", "cc", "Doctor shows LKG/backups", None), 20: (PA, "atlasz-control-center/core.mjs", "cc", "Doctor/backups show restore availability", None),
 21: (PA, A+"update-center.mjs; safe-mode.mjs", "uc safe", "Freeze and Safe Mode states exist", None)})
add(52, {
 1: (EW, A+"startup-self-check.mjs", "safe cq", "Runs at boot; FAIL -> Safe Mode", None), 2: (PA, A+"watchdog.mjs", "safe", "Watchdog ticks every 15 s for scheduler and queue", None),
 3: (PA, A+"startup-self-check.mjs", "safe", "Self-check is pre-flight for the runtime only", None), 4: (EW, A+"update-center.mjs", "uc", "Staged update flow with rollback", "Real adapters not written"),
 5: (PA, A+"startup-self-check.mjs", "safe", "Topology and state shape validated", None), 6: (MI, None, "", "No database", None),
 7: (EW, A+"audit-chain.mjs; durable-queue.mjs; backup-recovery.mjs", "q br safe", "Checksums/hash chains/manifest hashes verified", None),
 8: (MI, None, "", "No circuit breaker", None), 9: (PA, A+"startup-self-check.mjs", "safe", "Disk free check only", None),
 10: (EW, A+"watchdog.mjs; durable-queue.mjs", "safe q", "Hanging probe timeout; stalled lease requeue", None), 11: (EW, A+"safe-mode.mjs", "safe", "3 boots in window -> Safe Mode", None),
 12: (PA, A+"update-center.mjs", "uc", "Compatibility check (node/requirements)", None), 13: (EW, A+"durable-queue.mjs", "q cq", "Idempotency keys", None),
 14: (PA, A+"durable-queue.mjs; supervisor-safe.mjs", "cq", "Save-before-ack ordering", None), 15: (MI, None, "", "No time/schedule safety (clock jumps)", None),
 16: (PA, A+"startup-self-check.mjs", "safe pol", "Owner-auth/vault state + tracked-secret scan", None), 17: (EW, A+"backup-recovery.mjs", "br cc", "recoveryDrill", None),
 18: (MI, None, "", "No failure injection beyond unit tests", None), 19: (EW, A+"safe-mode.mjs", "safe cq", "Safe Mode", None),
 20: (EW, A+"update-center.mjs; backup-recovery.mjs", "uc br", "Evidence records on update/LKG", None)})
many(52, range(21, 29), (PA, A+"update-center.mjs", "uc", "Update/rollback audit entries record cause, versions and evidence; no unified incident report", "No Joci-facing incident report format"))
