# Task 4 — Milestone M1 (Safety and Reliability Baseline): modifications and test evidence

Branch `atlasz-v73-integration`. All evidence is **SANDBOX** (local, no live provider, no real owner key). Nothing is LIVE_VERIFIED. Passing tests are not operational readiness.

| ID | Modification | Tests / probes | Result | Limits |
|---|---|---|---|---|
| T3-001 | `atlasz-runtime/runtime-http.mjs` (new), wired into `supervisor-safe.mjs`; Control Center passes a per-run random `ATLASZ_RUNTIME_TOKEN` (or the env value if >=24 chars). Only `/health` ({ok,version}) is open; `/`, `/status`, `/revenue`, `/opportunities`, `/events` need the token; no/short token configured => 503 (fail closed); brute-force throttle 429; no stack leaks; constant-time compare | `runtime-http.test.mjs` (8 tests incl. REAL PROCESS boot), `canonical-runtime.test.mjs`, probe P21; mutation: 14/14 mutants killed (first run 13/14, the survivor — query-string routing — got its own test) | PASS | Bind address still `0.0.0.0` (owner decision; changing it may break hosting) |
| T3-002 | `atlasz-addons/restricted-node.mjs` (new): Node `--permission` (read only the plugin/package dir, write only with `FILESYSTEM_PLUGIN_DIR`, no spawn/workers), no network via `unshare --net` unless `NETWORK` granted, env scrubbed to PATH + plugin id/hook. Used by plugin hooks and update self-tests. Fails closed (`SANDBOX_UNAVAILABLE`, hook/self-test not run, audited as `PLUGIN_HOOK_NOT_RUN`, no quarantine). Also fixed a latent TDZ bug in `plugin-manager.invoke` | `restricted-node.test.mjs` (6), `plugin-manager.test.mjs` (+3), `local-update-adapters.test.mjs` (+2) — real child processes prove read-outside/write/spawn denied and secrets invisible; probes P22, P23 | PASS | Network block only where `unshare` works (Linux); Windows = filesystem/process restriction only and reports `networkBlocked:false`; Electron/older Node without `--permission` => hooks/self-tests refuse to run (decision needed). No mutation run on restricted-node.mjs yet |
| T3-005 | Math.random ID fallbacks in tracing-evals / agent-factory / enterprise-knowledge replaced by `node:crypto` | `no-weak-random.test.mjs` (static guard over all production sources + uniqueness + Math.random stub), probe P24 | PASS | `tracing-evals.mjs` is not invoked by a runtime workflow (audit flag kept) |
| T3-006 | Investigated: a restore UI already exists (Owner Safety panel, signed RESTORE) and uses the same core function as `/api/restore/backup`. Test added | `control-center-routes-m1.test.mjs` — both paths refuse a wrong signature and leave state untouched | PARTIAL | Positive signed restore through HTTP not exercised |
| T3-007 | Handler tests for `/api/opportunities`, `/api/money-recurring`, `/api/backup`, `/api/updates/auto` | `control-center-routes-m1.test.mjs` (5) | PASS | |
| T3-003/004 | M2 — plan only: `docs/M2_PLAN.md` | — | NOT STARTED | agents cannot use tools yet |
| T3-008 | Not built: schedule creation from the Control Center is a feature; external-effect jobs must keep requiring owner approval. Deferred (needs owner-approved UX) | — | OPEN | |
| T3-009 | EXTERNAL_BLOCKER: real-source discovery needs outbound network + owner-approved source list | — | BLOCKED | |

## Re-verified controls (independent probes, `docs/audit/independent_probes.mjs`, 25/25 pass)
Owner approval single-use + argument-bound + forged key refused (P01-P03); unknown/money operations fail closed (P04); no-spend (P05); kill switch (P06-P07); sandbox file/network/process isolation and secret refusal (P08-P11); restore/update/plugin-enable ops denied for agents without owner approval (P25); agents have no approve/spend/send/pay/speak tool (P19).

## Validation
- Full suite `npm test --prefix atlasz-runtime`: **554 tests, 554 pass, 0 fail**; also 554/554 across 85 files run one by one. Coverage run not repeated.
- Nothing was classified VERIFIED_WORKING by this work.
