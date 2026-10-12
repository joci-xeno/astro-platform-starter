# ATLASZ V7.3 — RESUME CHECKPOINT
- Branch: `atlasz-v73-integration` (remote `github` only; never `origin`, never `main`)
- Last verified: Batch 7 A/B/D (AURORA directive) — gate 2133/2133 (previous: 7a 2091, security 2088, Batch 6 2049). Exact commit id: `git log -1` / `git ls-remote github atlasz-v73-integration`.
- Current batch: 6 complete → next: Batch 7 (real authorized AI model connectivity), then Batch 8–14.

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
Dockerfile.worker still launches legacy supervisor.js (B6-005); 86 non-133 modules remain PARTIAL/OPEN in the total register; discovery scheduler, tool_call executor, auto-update CI/release, Windows evidence, malware scanner, 85+23+150 / 983 reconciliation.

## Required approvals / external blockers
Owner key provisioning; host approvals; provider credentials + `ATLASZ_VAULT_KEY`; malware scanner choice; D12 signature (optional); legacy runtime removal; manual Windows installer run; enable auto-update policy; real USB backup rehearsal; Stripe awaits Astra package (deferred).

## Exact next action
(7A/7B/7D done; see above.) Remaining: 7E financial event tracking dashboard wiring, backup rehearsal on owner device, broker registration of AURORA read-only status, real credentials/voice test by owner.

Older note: (Security directive and Batch 7a done.) Batch 7 remainder: system principals (MASTER/BRAIN) in the model registry; scheduled catalog refresh; credential retrieval via the vault; routing/failover/spend caps/usage accounting; live probes only with credentials the owner has authorised (none exist → models stay NOT LIVE).
