# ATLASZ V7.3 — Best-practice review, gap analysis and revenue workflow map
Status of this document: computed from the code and tests in the repository on branch `atlasz-v73-integration` (see commit in the resume checkpoint). Nothing here claims LIVE operation: no provider is authenticated, no customer, job, invoice or payment exists. Reference architectures (LangGraph, Temporal, OpenAI Agents SDK, OWASP agentic guidance) were used as checklists only; no framework was added.

## 1. Gap analysis (ALREADY | PARTIAL | MISSING → action, benefit, risk, test)
| # | Practice | State | Evidence in ATLASZ | Action taken / recommended | Business benefit | Risk | Test |
|---|---|---|---|---|---|---|---|
| 1 | Durable checkpoints / resumable state (LangGraph) | ALREADY | `durable-queue` (fsync journal, lease requeue), `checkpoint-engine`, Master job store, Brain workflow persisted | none | work survives restarts | low | durable-queue / master tests |
| 2 | Reliable retries, timeouts, backoff (Temporal) | ALREADY | durable-queue `maxAttempts`, brain dispatch backoff, broker per-tool timeouts, health-monitor bounded restarts | none | no retry storms | low | existing + health-monitor test |
| 3 | Idempotency / duplicate prevention | ALREADY | `idempotencyKey` in durable-queue; deal/job ids; approvals single-use | none | no double work/spend | low | queue + approval tests |
| 4 | Dead-letter handling | PARTIAL | durable-queue DEAD state persisted; `dead-letter-queue.mjs` is **in-memory only** | Dashboard counts the DLQ open items; persisted queue is the authority. Recommended: owner review whether the in-memory module should be SUPERSEDED by the queue DEAD state | owner sees stuck work | low | dashboard failedWorkflows test |
| 5 | Tracing, handoffs, tool validation (Agents SDK) | ALREADY | `tracing-evals`, `handoff-ledger`, black box (`AGENT_TOOL_CALL`), typed tool schemas, Agent Tool Broker | none | traceability | low | broker + tracing tests |
| 6 | Human review gates | ALREADY | Ed25519 single-use owner approvals; DRAFT≠SENT; control chain | none | no unauthorised external action | low | owner-control tests |
| 7 | OWASP agentic: tool misuse / excessive agency | ALREADY | deny-by-default agent tool policy, operation classes, D12 extension pending owner review | owner reviews D12 | contains blast radius | low | agent-tool-broker tests |
| 8 | OWASP: prompt injection / untrusted tool output | PARTIAL | `guardrail-engine`, untrusted-output labelling in model bridge | tool-output validation sweep in Batch 6 | safer web discovery | medium | existing 9 tests; add tool-output tests |
| 9 | Observability, health, incident recovery | PARTIAL → improved | health-monitor (breakers, bounded restart, alerts) added this batch; runtime restart hook not wired | Batch 12: wire `restart` to the runtime supervisor | faster recovery | low | module-registrations test |
| 10 | Model fallback | ALREADY (cloud: not exercised LIVE) | routing bridge failover only after settled zero-cost failure | live proof needs provider credentials (OWNER_BLOCKED) | resilience | low | model-routing tests |
| 11 | Budget enforcement | ALREADY | budget-consumption-governor, owner spend caps, registry billing guard | none | no overspend | low | 50 tests mention budget |
| 12 | Emergency stop | ALREADY | PAUSE_ALL / STOP_EXTERNAL_ACTIONS in chain, queue and scheduler | none | kill switch | low | 41 tests |
| 13 | **Encrypted portable backup + tested restore** | **MISSING → DONE this batch** | `portable-backup.mjs` (AES-256-GCM/scrypt, partial-write detection, isolated rehearsal boots a fresh Control Center) | owner chooses the USB path and supplies the passphrase | recoverable after disk/OS failure | passphrase loss = data loss (by design) | portable-backup.test.mjs (rehearsal) |
| 14 | **Revenue operations dashboard (12 count metrics + collected vs projected)** | **MISSING → DONE** | `revenue-ops.mjs`, `/api/revenue-ops`, UI "Revenue Operations" | none | owner sees true funnel | low | money-engine-sandbox + registrations tests |
| 15 | **Master prioritisation by net, success probability, time, risk, deadline, payment reliability, availability, owner restrictions** | **PARTIAL → DONE (advisory)** | `scoreOpportunity` / `rankedExplained` in revenue-persistence; Master queue still integer priority | wiring `rankedExplained` into Master `enqueue` suggestions is a follow-up; it never approves | picks best paying work first | wrong inputs → wrong ranking, hence explanation + confidence | priority-explained.test.mjs |
| 16 | Real paid job proven | MISSING (EXTERNAL/OWNER) | SANDBOX E2E proven only; LIVE 0 | see section 4 | the actual goal | external | n/a |

No genuinely new component was added except the portable backup (owner-mandated and absent) and the revenue-ops view (a read-only composition of existing engines). Everything else extends existing modules.

## 2. Revenue workflow stage map
| Stage | Module (existing) | Manager / agent | Tools (broker) | Runtime entry point | State & recovery | Security / approval | Test evidence |
|---|---|---|---|---|---|---|---|
| DISCOVER | `business/money-engine.discover`, `source-allowlist`, discovery adapters | Discovery manager; SEARCH-1..5 | `discovery.*`, EXTERNAL_READ only on allow-listed hosts | `core.money().discover(raw)` | `money-cc/deals.json`, revenue-persistence | host approvals owner-signed; deny by default | money-engine-hosted, sandbox |
| VERIFY | `lead-qualifier`, `qualify` | Discovery manager | `lead_qualifier.*` | `discover()` → SCREENED | deal history | no external effect | sandbox happy path |
| QUALIFY | `eligibility-model`, `qualify` | Discovery / Planning | `eligibility_model.evaluate` | deal → QUALIFIED/FEASIBLE | deal status | – | sandbox |
| ESTIMATE | `digital-twin`, `finance-intelligence`, `proposal-quote-engine` | Business manager | `proposal_quote_engine.validate`, simulate | `prepareOutreach` / quote | ESTIMATE class (never revenue) | spend>0 needs owner | contract-money-tax tests |
| PLAN | `master-planner-orchestrator`, `goal-planner`, Brain | Master + Brain | `goal_planner.*` | `win()` creates job+plan | plan id on job; Brain store | owner approves terms (`ACCEPT_DEAL_TERMS`) | sandbox |
| OWNER APPROVAL | `approval-requests`, `owner-authority` | Security & Approval manager | – (agents can only request) | `approvalStore().request` | `<state>/approvals` | Ed25519, single-use, subject-bound | owner-control tests |
| EXECUTE | Master → EXECUTION agents, `agent-executors` | Master; EXECUTION-1..25 | Agent Tool Broker (policy table) | `m.execute(jobId)` | durable queue + job store; reassign on crash | agent governor, financial firewall | sandbox + master tests |
| QA | `qa-factory`, `qa-reviewer`, independent judge | Verifier (not the producer) | `qa_reviewer.review` | `m.checkWork` | artifact qaStatus/verificationStatus | producer ≠ verifier | sandbox |
| DELIVER | `delivery-service` | Business manager | – | `prepareDelivery` / `deliver` | delivery records | `APPROVE_DELIVERY` owner approval | sandbox |
| INVOICE | `invoice-service` | Finance | – | `draftInvoice` / `issueInvoice` / `sendInvoice` | invoice status | owner approves issue; DRAFT≠SENT | sandbox |
| PAYMENT CONFIRMATION | `payment-verification` | Finance | – | `claimPayment` → `verifyPayment` | payment status | claim ≠ money; only authority evidence = VERIFIED | sandbox (+ fail cases) |
| PROFIT ACCOUNTING | `profit-accounting-engine`, `finance-intelligence`, ledger | Finance | – | `recordCost` / `close` | hash-chained ledger | SANDBOX never counts as revenue | sandbox happy path |
Live status of every stage: NOT_LIVE — the engine is hosted in the Control Center (`money-cc`, adapters `{}`), so outreach/delivery/payment adapters do not exist; the rehearsal ran in SANDBOX with synthetic data only.

## 3. Reliability checklist (verified vs not)
Persistent queue ✔ (durable-queue, runtime) · checkpoints ✔ · crash recovery ✔ (lease requeue, Master lock/heartbeat) · duplicate prevention ✔ · safe retries ✔ · dead letters ◐ (see #4) · model fallback ◐ (code+tests, no LIVE provider) · agent health ✔ · budget ✔ · traceability ✔ · emergency stop ✔ · encrypted portable backup ✔ **new** · tested restoration ✔ **new** (isolated rehearsal in the test suite; a rehearsal on the owner's USB device still has to be done by the owner).

## 4. Shortest safe path to ONE genuine paid digital job (no income is guaranteed)
1. Owner: provision the owner key; sign host approvals for 1–2 free discovery sources (e.g. HN Algolia, RemoteOK); store one provider credential in the vault (`ATLASZ_VAULT_KEY`) so Brain/QA can use a real model (or accept deterministic-only QA).
2. ATLASZ: scheduled discovery produces candidate opportunities; SEARCH agents verify; qualification + `scoreOpportunity` rank them with explanations.
3. Owner picks one; ATLASZ prepares a proposal/deliverable draft and the owner reviews it. **Sending a proposal, accepting terms, and issuing the invoice each need the owner's signed approval.**
4. EXECUTION agent produces the artifact; independent QA verifies; owner approves delivery.
5. Invoice via a payment method the owner already operates (Stripe stays deferred until Astra's package); payment is VERIFIED only with authoritative evidence; profit is then booked.
Blockers outside code: owner key and approvals, a real buyer who agrees, a payment channel. Until a verified payment exists the dashboard shows collected = none.
