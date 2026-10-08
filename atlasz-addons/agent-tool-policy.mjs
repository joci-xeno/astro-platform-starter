// M2 - approved per-role tool permissions for the 30 agents (owner decisions D1-D10, 2026-10-07). Deny by default.
// This table is DATA for the broker; it never grants anything by itself: the broker re-validates every entry against the really registered tool
// (pinned operation class, zero spend, data risk) before a call, and the control chain still classifies every call. A tool that is not listed here is DENIED.
//
// Changes against the proposal the owner reviewed (all stricter):
//   D3  sandbox.run_process_only      EXECUTION APPROVAL -> DENY
//   D4  pcc.* and voice.status        stay DENY for everyone
//   D5  model.complete                ALLOW on paper but DISABLED (no provider is selected, no paid or credentialed provider is activated)
//   D6  money.panel, inbox.summary    EXECUTION ALLOW -> DENY (pending a privacy and permissions review)
//   --  effort.choose, analyst.analyze, chunk.plan (added after the proposal)  DENY/DENY (decision D11 has not been taken)
export const ROLES = Object.freeze(["SEARCH", "EXECUTION"]);
export const AGENT_ID_RE = /^(?:(SEARCH)-[1-5]|(EXECUTION)-(?:[1-9]|1\d|2[0-5]))$/;
export const roleOf = id => { if (typeof id !== "string") return null; const m = AGENT_ID_RE.exec(id); return m ? (m[1] ?? m[2]) : null; };
export const SAFE_AGENT_OPERATIONS = Object.freeze(["READ_STATUS", "INTERNAL_COMPUTE", "EXTERNAL_READ"]);   // what an ALLOW entry may ever be classified as
export const NEVER_FOR_AGENTS = Object.freeze([/^pcc\./, /^voice\./]);                                       // hard floor: even a mistaken ALLOW entry is ignored

const A = "ALLOW", D = "DENY", P = "APPROVAL";
// [tool, SEARCH, EXECUTION, pinned operation, dataRisk, extras]
const ROWS = [
  ["atlasz.queue", A, A, "READ_STATUS", "LOW"], ["money.panel", D, D, "READ_STATUS", "MEDIUM", { note: "D6" }], ["inbox.summary", D, D, "READ_STATUS", "MEDIUM", { note: "D6" }],
  ["model.complete", A, A, "EXTERNAL_READ", "MEDIUM", { disabled: "D5_NO_PROVIDER_SELECTED" }],
  ["pcc.agenda", D, D, "READ_STATUS", "HIGH", { note: "D4" }], ["pcc.add", D, D, "INTERNAL_COMPUTE", "HIGH", { note: "D4" }], ["pcc.complete", D, D, "INTERNAL_COMPUTE", "HIGH", { note: "D4" }], ["pcc.summary", D, D, "READ_STATUS", "HIGH", { note: "D4" }],
  ["media.inspect_document", D, A, "READ_STATUS", "MEDIUM"], ["media.status", A, A, "READ_STATUS", "LOW"],
  ["kp.list", A, A, "READ_STATUS", "LOW"], ["kp.search", A, A, "READ_STATUS", "LOW"], ["kp.answer", A, A, "READ_STATUS", "LOW"], ["kp.verify", A, A, "READ_STATUS", "LOW"],
  ["research.open_question", A, D, "INTERNAL_COMPUTE", "LOW", { write: true }], ["research.add_source", A, D, "INTERNAL_COMPUTE", "MEDIUM", { write: true }], ["research.add_finding", A, D, "INTERNAL_COMPUTE", "LOW", { write: true }],
  ["research.attach_evidence", A, D, "INTERNAL_COMPUTE", "LOW", { write: true }], ["research.declare_contradiction", A, D, "INTERNAL_COMPUTE", "LOW", { write: true }],
  ["research.report", A, A, "READ_STATUS", "LOW"], ["research.unresolved", A, A, "READ_STATUS", "LOW"],
  ["sandbox.run", D, A, "INTERNAL_COMPUTE", "MEDIUM"], ["sandbox.run_process_only", D, D, "HIGH_RISK_CHANGE", "HIGH", { note: "D3" }], ["sandbox.status", A, A, "READ_STATUS", "LOW"],
  ["obs.observe", A, A, "INTERNAL_COMPUTE", "MEDIUM", { write: true }], ["obs.recall", A, A, "READ_STATUS", "MEDIUM"], ["obs.correct", A, A, "INTERNAL_COMPUTE", "LOW", { write: true }],
  ["obs.forget", A, A, "INTERNAL_COMPUTE", "LOW", { write: true }], ["obs.summary", A, A, "READ_STATUS", "LOW"], ["obs.capture_research", A, D, "INTERNAL_COMPUTE", "LOW", { write: true }],
  ["voice.status", D, D, "READ_STATUS", "LOW", { note: "D4" }],
  ["effort.choose", D, D, "INTERNAL_COMPUTE", "LOW", { note: "added after proposal; D11 pending" }], ["analyst.analyze", D, D, "INTERNAL_COMPUTE", "LOW", { note: "added after proposal; D11 pending" }], ["chunk.plan", D, D, "INTERNAL_COMPUTE", "LOW", { note: "added after proposal; D11 pending" }],
];
export const TOOL_POLICY = Object.freeze(Object.fromEntries(ROWS.map(([tool, SEARCH, EXECUTION, operation, dataRisk, x = {}]) => [tool, Object.freeze({ tool, SEARCH, EXECUTION, operation, dataRisk, write: Boolean(x.write), disabled: x.disabled ?? null, note: x.note ?? null })])));

// D2 limits. Owner-configurable only (a broker is constructed with them; no agent-reachable path changes them). Untuned starting values.
export const DEFAULT_LIMITS = Object.freeze({
  perAgentPerMinute: 10, perAgentPerHour: 100, perJob: 20, perJobWrites: 5, globalConcurrency: 5, globalPerHour: 300,
  perCallTimeoutMs: 15000, resultMaxBytes: 65536, refusalStreak: 5, pendingApprovalsPerAgent: 3, pendingApprovalsTotal: 20,
  perTool: Object.freeze({
    "sandbox.run": Object.freeze({ perJob: 3, perAgentPerHour: 10, timeoutMsCap: 10000 }),
    "model.complete": Object.freeze({ perJob: 5, perAgentPerHour: 20, globalPerDay: 100, promptMaxChars: 8000 }),
    "research.add_source": Object.freeze({ textMaxChars: 50000 }),
  }),
});

export function permissionFor(role, tool, policy = TOOL_POLICY) {
  const e = policy[tool]; if (!e || !ROLES.includes(role)) return "DENY";
  if (NEVER_FOR_AGENTS.some(r => r.test(tool))) return "DENY";
  const v = e[role]; return v === "ALLOW" || v === "APPROVAL" ? v : "DENY";
}

/** Validate every policy entry INDIVIDUALLY against the registered tools (D1). Returns one row per registered tool and per policy entry. Pure; no side effects. */
export function validatePolicy({ inspect, toolNames = [], policy = TOOL_POLICY }) {
  const rows = [], seen = new Set();
  for (const e of Object.values(policy)) {
    seen.add(e.tool); const problems = [], t = inspect(e.tool);
    if (!t) problems.push("NOT_REGISTERED");
    else {
      if (t.operation !== e.operation) problems.push("OPERATION_CHANGED:" + t.operation);
      if (t.spendUsd !== 0) problems.push("TOOL_SPENDS");
    }
    for (const role of ROLES) {
      const v = e[role]; if (!["ALLOW", "DENY", "APPROVAL"].includes(v)) problems.push("BAD_VALUE:" + role);
      if (v === "ALLOW") {
        if (!SAFE_AGENT_OPERATIONS.includes(e.operation)) problems.push("ALLOW_ON_NON_SAFE_OPERATION:" + role);
        if (e.dataRisk === "HIGH") problems.push("ALLOW_ON_HIGH_DATA_RISK:" + role);
        if (NEVER_FOR_AGENTS.some(r => r.test(e.tool))) problems.push("ALLOW_ON_NEVER_FOR_AGENTS:" + role);
      }
      if (v === "APPROVAL" && e.operation !== "HIGH_RISK_CHANGE") problems.push("APPROVAL_ON_UNGATED_OPERATION:" + role);
    }
    rows.push({ tool: e.tool, registered: Boolean(t), valid: problems.length === 0, problems, SEARCH: permissionFor("SEARCH", e.tool, policy), EXECUTION: permissionFor("EXECUTION", e.tool, policy) });
  }
  for (const n of toolNames) if (!seen.has(n)) rows.push({ tool: n, registered: true, valid: true, problems: [], unlisted: true, SEARCH: "DENY", EXECUTION: "DENY" });   // unlisted = DENY
  return rows;
}
