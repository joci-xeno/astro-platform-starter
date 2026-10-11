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

## Global opportunity discovery (Phase 5b, 2026-10-11)

Status words follow the standing semantics (IMPLEMENTED ≠ CONNECTED ≠ TESTED ≠ LIVE).

| Item | Status | Evidence / blocker |
|---|---|---|
| Source catalogue (18 sources, 7 regions) | IMPLEMENTED, TESTED | `global-discovery.mjs`, `global-discovery.test.mjs` |
| Parsers: OCDS JSON, RemoteOK JSON, RSS, HN Algolia | IMPLEMENTED, TESTED on labelled FIXTURE data | no TED / CanadaBuys CSV / World Bank / SAM parser yet → `NO_ADAPTER` |
| Live connector fetch | IMPLEMENTED, TESTED with injected transport | **BLOCKED**: each host needs the owner's signed `EGRESS_POLICY_SET`; sandbox has no network. No source is "genuinely connected". |
| KEY_REQUIRED / LOGIN_REQUIRED / TERMS_FORBID_AUTOMATION / PAID sources (SAM.gov, Freelancer, UNGM, Upwork, LinkedIn) | BLOCKED | account, key or terms; not bypassed |
| Operator capture (5 real public listings, 2026-10-11) | IMPLEMENTED, labelled `OPERATOR_TOOL` | `docs/audit/live_capture_2026-10-11.json`; not retrieved by an ATLASZ connector |
| SEARCH agents verify (different agent), qualify, plan; EXECUTION agents produce implementation plan / proposal draft; independent check | TESTED (integration + HTTP) | `global-discovery-workforce.test.mjs`, `control-center-discovery.test.mjs` |
| Lifecycle DISCOVERED→PAID with evidence gates | IMPLEMENTED, TESTED | fixtures refused; PROPOSED/CONTRACTED/PAYMENT_PENDING need owner approval + evidence; PAID needs ledger receipt |
| Memory write (project-scoped per opportunity) | IMPLEMENTED | retrieval by executors still not wired; neural retrieval BLOCKED |
| Control Center: sources, regions, activity, blockers, lifecycle, deliverables | IMPLEMENTED, TESTED | 30 Agents view |
| Outbound proposals / applications / messages | NOT DONE by design | drafts only: "PROPOSAL DRAFT - NOT SENT" |

## Batch 2 (2026-10-11): host approval request, World Bank adapter, memory retrieval, costs/usage, payment intake

| Item | Status | Evidence / blocker |
|---|---|---|
| First three hosts (remoteok.com, www.find-tender.service.gov.uk, hn.algolia.com; HTTPS 443 GET only) | PREPARED; **awaiting owner signature** | Control Center → 30 Agents → "Approval request"; one passphrase signs three exact `EGRESS_POLICY_SET` subjects; verified by test that wrong passphrase / no key approves nothing |
| World Bank procurement adapter (WB_JSON) | IMPLEMENTED, TESTED on a fixture shaped from a real response | not CONNECTED until host approval + a logged run; only CS/NC open notices kept |
| TED (EU) | NO_ADAPTER | search API is POST; engine is GET-only by policy |
| CanadaBuys | NO_ADAPTER | open-data CSV layout not verified from a real file |
| SAM.gov, Freelancer | BLOCKED (API key) / NOT CONFIGURED | key in vault + owner approval needed |
| Execution agents retrieve project memory | IMPLEMENTED, TESTED | coordinator-level `contextForProject`; same-opportunity notes only; fenced as data; stored in task input so the checker recomputes identically |
| Forged retrieval labels | FIXED | checker requires the evidence hash in the discovery log (`hasEvidence`) |
| Costs/Usage + owner-signed monthly cap | IMPLEMENTED, TESTED | `billing.usage()`, `setSpendCap` (`MODEL_SPEND_CAP_SET`, exact amount bound; tampered cap fails closed). No paid call has ever been made. |
| Provider readiness ladder | IMPLEMENTED | registered / adapter / credentials / live test / production; productionReady always false until owner confirms |
| Opportunity ranking | IMPLEMENTED, TESTED | evidence-weighted checklist; unknowns score 0; not a forecast |
| Payment package intake (Stripe handoff) | IMPLEMENTED, TESTED | `docs/STRIPE_HANDOFF.md`; no package received |
| Campaign Manager | NOT CONNECTED | it is a development-campaign layer (tokens/time budget, no money); mapping commercial plans onto it is deferred |
| Global Business Intelligence | MISSING | no such module exists in the repo; ranking + coverage views are the first part |
