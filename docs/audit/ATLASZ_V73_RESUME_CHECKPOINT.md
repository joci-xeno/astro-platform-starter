# ATLASZ V7.3 — RESUME CHECKPOINT
- Branch: `atlasz-v73-integration` (remote `github` only; never `origin`, never `main`)
- Last verified: Batch 6 — gate 2049/2049 (previous: 5c 0f12993, 5b 4acfc9d, 5a d578428). The exact commit id of Batch 6 is the one `git log -1` shows on this branch / `git ls-remote github atlasz-v73-integration`.
- Current batch: 6 complete → next: Batch 7 (real authorized AI model connectivity), then Batch 8–14.

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
B6-004 dead-letter module in-memory (owner decision); B6-006 Brain model adapter principal MASTER refused by model registry (Batch 7); `atlasz-runtime/package.json` start script still points to legacy `supervisor.js` (owner decision, recorded B6-005); 86 non-133 modules remain PARTIAL/OPEN in the total register; discovery scheduler, tool_call executor, auto-update CI/release, Windows evidence, malware scanner, 85+23+150 / 983 reconciliation.

## Required approvals / external blockers
Owner key provisioning; host approvals; provider credentials + `ATLASZ_VAULT_KEY`; malware scanner choice; D12 signature (optional); legacy runtime removal; manual Windows installer run; enable auto-update policy; real USB backup rehearsal; Stripe awaits Astra package (deferred).

## Exact next action
Batch 7: system principals (MASTER/BRAIN) in the model registry; scheduled catalog refresh; credential retrieval via the vault; routing/failover/spend caps/usage accounting; live probes only with credentials the owner has authorised (none exist → models stay NOT LIVE).
