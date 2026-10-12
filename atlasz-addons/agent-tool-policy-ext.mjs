// Agent tool policy EXTENSION for the module-broker tools (owner decision D12 is still PENDING: the owner reviews this table; until then it is deliberately minimal and every row is
// internal, deterministic and side-effect free). The base table (agent-tool-policy.mjs) is unchanged. The Agent Tool Broker re-validates every row against the really registered tool on
// every call (pinned operation class, zero spend), so a row can never grant more than its pinned class, and an unlisted tool stays DENIED.
//   rows: [tool, SEARCH, EXECUTION, pinned operation, dataRisk, write?]
// Money, payment, invoice, CRM, credential, recovery, scheduler, approval and model tools are NOT listed (= DENY) and must never be added without an explicit owner decision.
import { TOOL_POLICY } from "./agent-tool-policy.mjs";
const A = "ALLOW", D = "DENY";
export const EXTENSION_ROWS = Object.freeze([
  // working-state libraries (pure functions over caller-supplied data)
  ["task_ledger.create", A, A, "INTERNAL_COMPUTE", "LOW"], ["task_ledger.update", A, A, "INTERNAL_COMPUTE", "LOW"], ["task_ledger.complete", A, A, "READ_STATUS", "LOW"],
  ["progress_ledger.entry", A, A, "INTERNAL_COMPUTE", "LOW"], ["progress_ledger.summarize", A, A, "INTERNAL_COMPUTE", "LOW"],
  ["checkpoint_engine.checkpoint", A, A, "INTERNAL_COMPUTE", "LOW"], ["checkpoint_engine.resume", A, A, "INTERNAL_COMPUTE", "LOW"],
  ["recovery.plan", A, A, "INTERNAL_COMPUTE", "LOW"],
  // verification
  ["qa_reviewer.review", D, A, "INTERNAL_COMPUTE", "LOW"], ["evidence_record.build", D, A, "INTERNAL_COMPUTE", "LOW"],
  // execution drafts (drafts only: nothing is sent, signed or priced for the buyer)
  ["proposal_quote_engine.validate", D, A, "READ_STATUS", "MEDIUM"],
  // search-side analysis
  ["market_intelligence_engine.analyze", A, D, "INTERNAL_COMPUTE", "LOW"], ["market_intelligence_engine.propose_strategy", A, D, "INTERNAL_COMPUTE", "LOW"],
  ["eligibility_model.evaluate", A, D, "INTERNAL_COMPUTE", "MEDIUM"],
  ["buyer_decision_maker_finder.rank", A, D, "INTERNAL_COMPUTE", "MEDIUM"],
  // catalogue (read only)
  ["agent_tool_catalog.match_agents", A, A, "READ_STATUS", "LOW"], ["agent_tool_catalog.plan", A, A, "READ_STATUS", "LOW"]
]);
export const EXTENSION_POLICY = Object.freeze(Object.fromEntries(EXTENSION_ROWS.map(([tool, SEARCH, EXECUTION, operation, dataRisk, write = false]) => [tool, Object.freeze({ tool, SEARCH, EXECUTION, operation, dataRisk, write, disabled: null, note: "D12_PENDING_OWNER_REVIEW" })])));
/** The policy the Control Center's Agent Tool Broker uses: the base table plus the reviewed-pending extension. Extension rows can never override a base row. */
export const COMBINED_POLICY = Object.freeze({ ...EXTENSION_POLICY, ...TOOL_POLICY });
