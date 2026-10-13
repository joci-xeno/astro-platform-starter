# ATLASZ V7.3 — RESUME CHECKPOINT
- Branch: `atlasz-v73-integration` (remote `github` only; never `origin`, never `main`)
- Last verified: Batch 8 Phase A + C + E (stage authorities + proposal-draft stage `atlasz-addons/proposal-stage.mjs`, owner-panel `/api/proposal/draft`, drafts are DRAFT_NOT_SENT, checker-verified)+ daily-profit objective (`daily-profit-objective.mjs`, docs/DAILY_PROFIT_OBJECTIVE.md) + UI — + safe worker image (`atlasz-runtime/Dockerfile.worker` -> supervisor-safe only; image build unverified, no Docker daemon), contract review, invoice preparation (DRAFT), LOCAL_PACKAGE delivery adapter — + first live source readiness (runner, unsigned approval request docs/owner/FIRST_LIVE_SOURCE_APPROVAL_REQUEST.md), model connection runbook, SEC-GAP-5 process gate — gate 2205/2205 incl. cross-process hand-off lock (C-003), shortfall log + AURÓRA daily-target answers (previous: 2198, 2185, 2177, 2168, 2165, 2163, 2160, 2148). Exact commit id: `git log -1` / `git ls-remote github atlasz-v73-integration`.
- Current batch: 6 complete → next: Batch 7 (real authorized AI model connectivity), then Batch 8–14.

## Completed (Batch 8 Phase E slice + UI)
- `workflow-stages.mjs`: entry criteria (required evidence) for the 14 stages; `registry.setStage` refuses skip/reverse/unverified evidence. All five authorities connected (`core.verifyStageEvidence`): owner approval (real signature, single use), QA accept (workforce, independent checker), delivery & invoice (money-engine records), payment (processor-confirmed ledger, exact amount/currency, LIVE only). No delivery adapter exists, so DELIVER cannot verify yet. Link opportunity->job is asserted by the Master (limit).
- Control Center: Opportunity Pipeline page, network supervision section, model inventory rows (12 facts).

## Completed (Batch 8 Phase C + demonstrations)
- `opportunity-intake.mjs`: common opportunity record (directive 5.3; unknown stays null), durable update-aware registry, SEARCH->Master hand-off with 10 checks + checkpoints + resume, source inventory (10 facts). Wired in Control Center (`masterIntake`, `opportunityRegistry`), broker module `opportunity-intake`, AURÓRA reports registry items with FIXTURE/OPERATOR/live labels.
- `scripts/demonstrations.mjs` (+ `docs/audit/demonstrations_evidence.json`, test): demos A-H run locally; A (live retrieval), F (model call) and G (real audio) carry explicit blockers.
- `scripts/validate-malware-scanner.mjs` + `docs/MALWARE_SCANNER_VALIDATION.md`: owner proves the engine detects EICAR; until then BLOCKED.
- Existing and re-used (not rebuilt): agent-workforce real executors with maker-checker (Phase D slice), brain-failure-modes, payment-events (Phase E/H slice).

## Completed (Batch 8 Phase A — security closure)
- `execution-boundary.mjs`: one independent incident/stop check at the typed tool registry (every module capability and agent tool call), credential broker, model egress, quarantine release, connectors and the SEARCH-agent fetch. `network-supervisor.mjs`: per-agent/task/tool/host attribution + detectors (broker bypass = CONFIRMED, contains the agent). Runtime supervisor wired with its own incident controller. Reach and limits: `docs/audit/enforcement_coverage.json` (+ test). SEC-GAP-1 closed on wired paths, SEC-GAP-2 narrowed, SEC-GAP-5 (local child processes) open. No OS-level isolation; no universal-isolation claim. Gate 2148/2148.

## Completed (Batch 7 A/B/D — AURORA directive)
- 7A: durable event-sourced dead-letter store (B6-004 TESTED), runtime `npm start` -> `supervisor-safe.mjs` (legacy `supervisor.js` not started; `Dockerfile.worker` still legacy: owner/dependency decision), restart-recovery tests. D12 stays disabled.
- 7B: model evidence ladder REGISTERED/CONFIGURED/AUTHENTICATED/CALL_VERIFIED/LIVE_OPERATIONAL/BLOCKED from REAL transports only; credential leak fixes B7-001/002. **0 models LIVE_OPERATIONAL** (no owner-authorised credentials).
- 7D: AURORA interface (`atlasz-addons/aurora.mjs`, no authority, not an agent; 30 agents unchanged), emotion/strong-language handling that never ends the conversation, fixed-reply refusal of voice/typed authorisation, honest briefing with freshness classes, voice settings; voice = **NOT_TESTED** until the owner confirms real audio in/out in their browser.
- 7E (partial): agent statuses normalised (8 states; completion needs verification) in supervision and Control Center.

## Completed (Batch 7a)
- System principals MASTER/BRAIN in the model registry (`SYSTEM_PRINCIPALS`; roster stays exactly 30; EXECUTION role defaults; same no-spend/LIVE/credential rules); B6-006 TESTED. Still 0 models LIVE: needs owner-authorised credentials / a running local model + egress approval + probe.

## Completed (Security directive — defence in depth)
- incident-response (containment independent of the Brain), file-intake + malware-scanner adapter (ClamAV/Defender; no engine here → files HELD), payment-events ledger (signature, dedupe, payout≠bank receipt), agent supervision view, broker output redaction + containment; all registered in the Module Broker (`registrations/security.mjs`).
- `scripts/secret-history-scan.mjs` (0 non-synthetic secrets in history), `docs/SECURITY_LEAK_RESPONSE.md`, `atlasz-tests/security-adversarial.test.mjs` (16 attacks), `docs/audit/SECURITY_PROTECTION_MATRIX.md`, defects SEC-001..007 (TESTED) and SEC-GAP-1..4 (open).
- BLOCKED: real malware detection (no engine in sandbox), Stripe live, owner key not provisioned, physical USB rehearsal.

## Completed (Batch 6)
- Brain↔Master failure-mode E2E (`brain-failure-modes.test.mjs`, 9 cases): tool failure, invalid tool response, forged output, model unavailable, agent timeout, emergency stop mid-run, invalid task, restart recovery/damaged state, security rejection. Two real defects fixed (B6-001/002).
- Owner-key safety: key cannot be provisioned inside the repository; `.gitignore` for key/vault/.env/backups; tracked-file secret scan (`repo-secret-scan.test.mjs`); procedure in `docs/OWNER_KEY_SETUP.md`.
- Adversarial approval-bypass matrix (10 attack variants × outreach, deal acceptance, delivery, invoice issue + replay) and "no consequential operation class is exposed through the module broker".
- Evidence levels REGISTERED / SELF_TESTED / RUNTIME_CONNECTED / END_TO_END_VERIFIED / LIVE_OPERATIONAL computed by `scripts/module-evidence.mjs` → `docs/audit/module_dispositions.json`; all 133 original findings have a final disposition in `ATLASZ_V73_TOTAL_INTEGRATION_REPAIR.csv` (+ `original_133_resolution.json`). Registration alone does NOT raise a level above REGISTERED/SELF_TESTED.
- D12: the agent tool policy extension is now **INACTIVE by default**; it activates only with an owner-signed approval bound to its fingerprint (durable record re-verified at start). Review report: `docs/audit/D12_TOOL_POLICY_REVIEW.md`.
- Legacy runtime files quarantined (not deleted/activated): `docs/audit/LEGACY_QUARANTINE.md`.

## Original 133 findings — honest state
86 SELF_TESTED, 17 RUNTIME_CONNECTED, 25 REGISTERED (self-test needs an injected dependency or the module is offline by design), 2 END_TO_END_VERIFIED, 3 QUARANTINED legacy (owner decision). **0 LIVE_OPERATIONAL.** Disposition ≠ production readiness.

## Unfinished / outstanding defects
86 non-133 modules remain PARTIAL/OPEN in the total register; discovery scheduler, tool_call executor, auto-update CI/release, Windows evidence, malware scanner, 85+23+150 / 983 reconciliation.

## Required approvals / external blockers
Owner key provisioning; host approvals; provider credentials + `ATLASZ_VAULT_KEY`; malware scanner choice; D12 signature (optional); legacy runtime removal; manual Windows installer run; enable auto-update policy; real USB backup rehearsal; Stripe awaits Astra package (deferred).

## Exact next action
(Batch 8 A/C/E-slice done.) Next: proposal-draft stage from the workforce executors, wire a first authorised live source once the owner signs a host approval, Windows update CI + real smoke test (owner machine), physical backup rehearsal (owner device).

Older: (7A/7B/7D done; see above.) Remaining: 7E financial event tracking dashboard wiring, backup rehearsal on owner device, broker registration of AURORA read-only status, real credentials/voice test by owner.

Older note: (Security directive and Batch 7a done.) Batch 7 remainder: system principals (MASTER/BRAIN) in the model registry; scheduled catalog refresh; credential retrieval via the vault; routing/failover/spend caps/usage accounting; live probes only with credentials the owner has authorised (none exist → models stay NOT LIVE).
