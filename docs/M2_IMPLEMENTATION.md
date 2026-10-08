# M2 — Agent tool broker: implementation record (SANDBOX, not LIVE)

Owner authorization 2026-10-07 (D1–D10) applied on branch `atlasz-v73-integration`. Nothing here is deployed; no bind address, network exposure, Electron version or provider was changed.

## What was built
| Piece | File | Role |
|---|---|---|
| Approved permission table + limits | `atlasz-addons/agent-tool-policy.mjs` | Data only. 34 tools, deny by default, `validatePolicy` checks every entry individually against the really registered tool (pinned operation class, zero spend, data risk, hard floor for `pcc.*`/`voice.*`). |
| Broker | `atlasz-addons/agent-tool-broker.mjs` | The only path from an agent to `tools.invoke`. Roster (exactly SEARCH-1..5, EXECUTION-1..25) → job state → kill switch/Safe Mode → per-agent rate → role policy → per-tool limits → concurrency → control chain → result cap. Never throws; accepts no owner approval, role or actor from the caller. |
| Runtime wiring | `atlasz-runtime/supervisor-safe.mjs` | `rt.agentTools`, `rt.agentToolSignals`, dashboard block `agentTools` (status `SANDBOX_ENFORCED_NOT_LIVE`), dispatch hook `task.toolPlan` (default none). `typed-tools.mjs` gained `inspect(name)` (governance view, no handler). |

## Owner decisions as implemented
| Decision | Implementation | Test |
|---|---|---|
| D1 conditional approval, validate every tool, deny by default | table entries re-validated at construction time and on every call; unlisted tool = DENY; ALLOW only for READ_STATUS / INTERNAL_COMPUTE / EXTERNAL_READ and not for HIGH data risk; changed operation class or spending tool → call refused | `agent-tool-broker` (policy ×2, matrix 30×34, edge cases), `agent-tools-hosted` #1 |
| D2 limits | 10/min & 100/h per agent; 20 per job (5 writes); 5 concurrent; 300/h global; sandbox.run 3/job 10/h/agent timeout ≤10 s; model.complete 5/job 20/h/agent 100/day prompt ≤8000; add_source text ≤50 000; results ≤64 KB (truncated + flagged); 15 s call timeout; 5 consecutive refusals suspend the job and raise `BYPASS_ATTEMPT`; pending approvals 3/agent, 20 total | rate/job/global/per-tool/result/streak/approval-cap tests; `agent-tool-policy-vs-proposal` |
| D3 | `sandbox.run_process_only` DENY for both roles | policy test, P28 |
| D4 | `pcc.*`, `voice.status` DENY | policy test, P28 |
| D5 | `model.complete` listed but DISABLED (no provider selected, nothing paid, no credentials) | per-tool test, P28 |
| D6 | `money.panel`, `inbox.summary` DENY for EXECUTION (and SEARCH) | policy test, P28 |
| D7 | approval-class entries only *file* requests in the existing owner queue (`approvals/requests.jsonl`, same Control Center list); request action/subject equal what the control chain verifies; the broker reads the owner's signed decision, never an agent-supplied one; single use; rejected is final; expired can be re-filed. **No tool is currently approval-class** (D3), so this path is exercised only with a test policy. | approval-queue tests |
| D8–D10 | untouched: no bind/exposure change, no deployment, no Electron/installer work, no external discovery | n/a |

## Stricter than the chain on purpose
The control chain lets read-only operations through during an emergency stop. The broker does **not**: while the kill switch is not RUNNING or Safe Mode is active, every agent tool call (reads too) is DENIED (`OWNER_STOP_OR_SAFE_MODE_ACTIVE`), and a failing stop check fails closed.

## Evidence
* Unit/integration: `agent-tool-broker.test.mjs` (17), `agent-tools-hosted.test.mjs` (6, real runtime), `agent-tool-policy-vs-proposal.test.mjs` (2).
* Independent probes P27–P31 (`docs/audit/independent_probes.mjs`).
* Mutation: 61 mutants over broker + policy; first pass 8 survivors, killed by targeted tests; final pass 0 survivors.

## Known limits
* Agents still choose no tools by themselves: plans come from trusted code (`candidate.toolPlan`) because no model provider is configured (EXTERNAL, D5).
* Counters are in memory (reset on restart) — stricter after restart is not guaranteed; the control chain and owner approvals are the durable layer.
* `effort.choose`, `analyst.analyze`, `chunk.plan` remain DENY until decision D11 is taken.
