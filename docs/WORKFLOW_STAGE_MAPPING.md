# Business workflow ↔ the existing 14 stages

The two business-level sequences in the owner directives are **names for the existing 14-stage definition** in `atlasz-addons/workflow-stages.mjs` (enforced by `opportunity-registry` + `verifyStageEvidence` in the Control Center core). No second stage list exists. Every stage is idempotent per opportunity (content hash), persisted (atomic files / hash chains), and audited.

| Business step | Existing stage | Input → output | Evidence / authority to enter | Persistent state | Failure / restart |
|---|---|---|---|---|---|
| DISCOVER (+ NORMALIZE, DEDUPLICATE) | DISCOVER | source item → unified opportunity record (`retrieval` LIVE/OPERATOR_TOOL/FIXTURE; unknowns explicit) | provenance | opportunity registry + live-discovery run log | dedupe → CREATED/UPDATED/DUPLICATE_UNCHANGED; history kept; scheduler resumes after restart; backoff |
| VERIFY | VERIFY | record → Master intake (10 checks) | `handoff.taskId` | handoff store (locked read-modify-write) | each opportunity routed once; HELD_NEEDS_INFO/REJECTED are visible, never silent |
| QUALIFY | QUALIFY | → legitimacy / feasibility / skill fit / risk | qualification fields | registry | fraud indicators stop drafting |
| MASTER REVIEW (+ ASSIGN) | ESTIMATE, PLAN | verdict QUALIFIED → costs/effort estimate → plan with owner gates; ranked by commercial factors (`rankPipeline`; daily objective ≤ 5/100) | estimate + plan fields | workforce plans | agent without the skill is never assigned (`NO_USABLE_EXECUTION_AGENT_WITH_SKILL`) |
| PROPOSAL DRAFT | PLAN (artifact) | → `proposal-stage` draft, maker-checker, `DRAFT_NOT_SENT` | verified draft | proposal-drafts.json | corrupt state is never overwritten |
| OWNER APPROVAL | OWNER_APPROVAL | → signed approval for the exact action | `OWNER_APPROVAL` authority | approval store | expired/forged approvals fail closed |
| CUSTOMER AGREEMENT | OWNER_APPROVAL → EXECUTE entry | owner-supplied signed agreement (`contract-review`, lexical only) | owner approval id | contract review log | nothing is signed or sent by the system |
| EXECUTE | EXECUTE | → artifacts | `OWNER_APPROVAL` authority | task store | resumable tasks, error recovery, owner stop |
| INDEPENDENT QA | QUALITY_ASSURANCE, DELIVERY_APPROVAL | → checker ≠ maker accepts | `QA_ACCEPT` | task/checker records | rework path |
| DELIVERY | DELIVER | → package delivery record (`LOCAL_PACKAGE` adapter, approved channel) | `DELIVERY_RECORD` (LIVE evidence) | delivery store | fixture delivery never counts |
| INVOICE | INVOICE | → invoice from owner-supplied agreed price | `INVOICE_RECORD` | invoice store | draft ≠ issued ≠ sent |
| PAYMENT CONFIRMATION | PAYMENT_VERIFICATION | → processor-confirmed payment for the exact invoice/amount/currency | `PAYMENT_VERIFIED` (payment-events, LIVE) | payment-events ledger | duplicate/replayed webhooks, out-of-order events, test mode, disputes handled |
| FINANCIAL RECONCILIATION | RECONCILIATION | → fees and refunds reconciled; ledger `PAID` entries reconciled against processor | `PAYMENT_VERIFIED` | payment ledger + reconciliation report | mismatch reported, never counted |
| VERIFIED NET PROFIT | NET_PROFIT | → verified net in the daily objective | **`NET_PROFIT_VERIFIED`** (new): payment confirmed, live, undisputed, fee known, convertible, owner cost attestation for that day — claimed flags alone are refused | daily objective (derived), shortfall log | unknown stays unknown |

Fixture ≠ real: `retrieval: FIXTURE`, SANDBOX environment and test-mode events never satisfy a stage that needs LIVE evidence.
