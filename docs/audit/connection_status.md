# Connection status ledger (evidence-based; IMPLEMENTED != CONNECTED != TESTED != LIVE)

| Module | Connected to | Test evidence | LIVE? | Next |
|---|---|---|---|---|
| model-registry + model-routing-bridge | gateway/provider-resilience, provider-egress, egress-policy, billing guard, Control Center "Models & Providers" | model-routing-bridge.test, control-center-model-registry.test (real HTTP) | NO - only a passing real probe makes a model LIVE; only the loopback Ollama adapter exists | cloud provider adapters (Phase 4), owner egress approval |
| quarantine (prescan + store) | Document Center ingest; Security Center panel (list/verify/signed release/delete) | document-center-quarantine.test, control-center-security.test | n/a (no malware scanner chosen: BLOCKED_NO_SCANNER_CHOSEN) | inbox/downloads intake; scanner choice |
| release-signing | local-update-adapters stager (verify before staging, optional requireSignature); trust anchors via Security Center (owner-signed) | local-update-signing.test, control-center-security.test | NO - no real publisher key/anchor yet | owner provides publisher key; install-time `accept` (replay/downgrade history) |
| ransomware canary monitor | NOT connected | quarantine.test (unit) | NO | start from supervisor |
| commit leak gate | NOT connected to hooks/CI | security-gates.test | NO | pre-commit hook |
| browser extension API | NOT connected | browser-extension-guard.test | NO | origin allowance + extension id |
| supervisor-safe documents | NOT using quarantine (two processes must not append one audit chain) | - | NO | single-writer design |

## Phase 5 — the 30 permanent agents (workforce)

| Module | Connected to | Test evidence | LIVE? | Next |
|---|---|---|---|---|
| agent-registry (30 fixed ids: 5 SEARCH + 25 EXECUTION; profiles, limits, retry, pause) | persistent `agents.json` bound to a hash-chained audit + head pin; fails closed (read-only) on edit/truncation/deletion; cost-limit raises need a signed single-use `AGENT_LIMITS_RAISE` | agent-registry.test, agent-workforce.test | n/a - a registry entry is never "LIVE"; state shows NO_ACTIVITY_YET until a task exists | wire profile model policy to the model registry assignments |
| agent-workforce (workflows A-F) | agent-coordination (identity-bound handles, independent checker chosen by the coordinator, bounded rejections, checkpoints), financial-ledger, revenue pipeline (OPEN_QUALIFIED only after independent acceptance), approval-requests (gated steps are requests, never actions), master-planner | agent-workforce.test (induced failure, loop guard, dead letter, owner stop, restart), control-center-agents30.test (real HTTP) | executed locally with REAL_LOCAL_TOOL provenance; no external customer, send or payment exists | connect runtime supervisor pipeline, Campaign Manager, Global Business Intelligence |
| agent-executors (csv_to_json, extract_summary, module_with_tests) | recomputed or re-run independently by the checker; module tests run in Node's permission model (async, killed at deadline) and report "test script exited 0" - not coverage | agent-workforce.test | local only | more executors from PKG150 capabilities, each with an independent recompute |
| Control Center "30 Agents (workforce)" | `/api/agents30`, `/api/agents30/action`; agents WORKING only while an own task is RUNNING; verified revenue and estimates/simulated shown separately | control-center-agents30.test | n/a | per-agent model assignment editor |
| agent memory | memory panel's agent gateway; verified work written on acceptance. Neural embeddings stay BLOCKED | agent-workforce.test (hook), memory tests | lexical only | recall context in executors |
| model use by agents | `ctx.model` -> model bridge (budget = min(per task, per day) minus spend, default 0; cost booked before enforcement) | agent-workforce.test (MED-1) | NO provider contacted; no paid usage | credentials + owner authorisation |

Known limitations (recorded, not hidden): `workforce.json` is sha-enveloped but not anchored to the audit chain (a local attacker with write access could rewrite it consistently); interrupted SEARCH-side analysis tasks are not resumable and count toward the open-task limit until the store is pruned; raising non-cost limits (tokens, timeout, open tasks) needs no signature but is bounded by `LIMIT_BOUNDS`; no external opportunity discovery exists (opportunities come from the owner or Document Center).
