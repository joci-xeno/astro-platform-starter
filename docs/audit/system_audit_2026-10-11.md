# ATLASZ system audit 2026-10-11

Computed by `scripts/system-audit.mjs` (live probes + file existence). Tally: {"VERIFIED_WORKING":9,"PARTIAL":7,"EXTERNAL_BLOCKER":2}

Agents: 30 (5 SEARCH + 25 EXECUTION)

## Hierarchy

`OWNER (signatures: host approvals, spend caps, plan gates, enabling paid models)` -> `MASTER COORDINATOR = agent-coordination.mjs + master-coordinator.mjs (one coordinator)` -> management layer (WORKFORCE_MANAGER, SEARCH_AGENT_MANAGER, EXECUTION_AGENT_MANAGER, CAMPAIGN_MANAGER, GLOBAL_BUSINESS_INTELLIGENCE, AI_MODEL_MANAGER, SECURITY_APPROVAL_MANAGER, MEMORY_KNOWLEDGE_MANAGER, FINANCIAL_REVENUE_MANAGER, RUNTIME_SUPERVISOR, TASK_SCHEDULER, QUALITY_ASSURANCE, RECOVERY_MAINTENANCE) -> 5 SEARCH + 25 EXECUTION -> verification, evidence, memory, results

## Components

| Component | Status | Live probe | Reason / blocker |
|---|---|---|---|
| Master Coordinator | VERIFIED_WORKING | CONNECTED: coordination audit true, master audit true |  |
| Workforce Manager (30 agents) | VERIFIED_WORKING | CONNECTED: registry integrity true, agents 30 |  |
| SEARCH Agent Manager | VERIFIED_WORKING | CONNECTED: 5 SEARCH agents |  |
| EXECUTION Agent Manager | VERIFIED_WORKING | CONNECTED: 25 EXECUTION agents |  |
| Campaign Manager | VERIFIED_WORKING | CONNECTED: campaign audit true, 0 campaign(s), state FRESH |  |
| Global Business Intelligence | VERIFIED_WORKING | CONNECTED: funnel over 0 opportunities; 0 source(s) seen | Read-only analytics over real pipeline data; shows zero real opportunities until a connector source is approved and run. |
| AI Model Manager + Provider Router | PARTIAL | CONNECTED: 0 model(s) LIVE of 0 registered; providers 0 | No provider has passed an authenticated live test (no vault credential + owner-approved egress yet): 0 providers LIVE. |
| Security and Approval Manager | PARTIAL | DEGRADED: no owner key provisioned: every approval-gated action stays blocked | Probe fresh install: no owner key provisioned here (this is the audit sandbox, not the owner's installation). |
| Memory and Knowledge Manager | VERIFIED_WORKING | CONNECTED: agent-memory access audit true |  |
| Financial and Revenue Manager (ledger) | VERIFIED_WORKING | CONNECTED: ledger chain true |  |
| Stripe payment intake gate | EXTERNAL_BLOCKER | library (tests only) | Intake gate tested; Astra's Stripe package not received; Stripe->KOHO payout NOT connected; no real charge/payout is possible. |
| Runtime Supervisor | PARTIAL | DEGRADED: runtime supervisor not running (start it from the Control Center) | Child process is started by the owner from the Control Center; not running in the audit sandbox. |
| Task Scheduler | PARTIAL | DEGRADED: scheduler state: NOT_CONNECTED | Engine tested; no schedules recorded in the sandbox. |
| Quality Assurance / Independent Checker | VERIFIED_WORKING | CONNECTED: independent verifier assignment via coordinator; 0 check record(s) |  |
| Recovery and Maintenance Manager | PARTIAL | DEGRADED: no backup exists | Backup/restore engine tested; no backup or passed restore drill in the sandbox. |
| Global Discovery Engine | PARTIAL | library (tests only) | 0 sources genuinely CONNECTED: the three first hosts await the owner's signed approval; only operator-captured (labelled) data exists. |
| Windows Electron desktop app | EXTERNAL_BLOCKER | library (tests only) | Installer WAS built once on a GitHub Windows runner (run 37701784773, commit fa2a230, 2026-10-07, 82 MB artifact, test suite passed there) - older than HEAD, never installed or launched on a real Windows machine. Not production-ready. |
| Original 85 / 23-point / additional 150 programme | PARTIAL | library (tests only) | 150 package tally {"EXTERNAL_BLOCKER":14,"PARTIAL_PRE_EXISTING":95,"IMPLEMENTED_TESTED_NOT_CONNECTED":32,"COVERED_BY_VERIFIED_85":6,"NOT_STARTED":2,"MISSING":1}; see docs/audit/ for the 85 and 23-point classifications (not all are connected or live). |

## Models

```json
{
 "providersRegistered": 14,
 "modelRecords": 0,
 "adapterImplemented": 13,
 "credentialsConfigured": 0,
 "authenticatedLiveTestPassed": 0,
 "productionReady": 0,
 "note": "Record count is not usability: only providers with adapter + credential + owner-approved egress + a passed authenticated live test are LIVE."
}
```

## 150-capability package

```json
{
 "EXTERNAL_BLOCKER": 14,
 "PARTIAL_PRE_EXISTING": 95,
 "IMPLEMENTED_TESTED_NOT_CONNECTED": 32,
 "COVERED_BY_VERIFIED_85": 6,
 "NOT_STARTED": 2,
 "MISSING": 1
}
```
