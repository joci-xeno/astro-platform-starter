// ATLASZ execution boundary: ONE independent check that every privileged or externally consequential path calls BEFORE it does anything (fail closed).
// It consults the incident controller (blocks), the owner stop state and an optional extra predicate. It never grants anything - it can only refuse.
// Wired in (runtime-enforced): typed tool registry (every module capability and every agent tool call), credential broker, provider (model) egress, quarantine release,
// the brokered fetch handed to tool code, and the payment-event ingest. Honest limit: code that does not call this module (a new module that opens its own socket, a child process
// that is spawned outside the sandbox) is NOT covered by it; `docs/audit/ENFORCEMENT_COVERAGE.md` and the coverage test list exactly what is and is not wired.
export const OPERATION_CLASSES = Object.freeze({
  TOOL_EXECUTION: "TOOL_EXECUTION", NETWORK_REQUEST: "NETWORK_REQUEST", MODEL_EGRESS: "MODEL_EGRESS", FILE_ACCESS: "FILE_ACCESS", FILE_RELEASE: "FILE_RELEASE", BROWSER_AUTOMATION: "BROWSER_AUTOMATION",
  EMAIL: "EMAIL", PROPOSAL_SUBMISSION: "PROPOSAL_SUBMISSION", CONTRACT_ACCEPTANCE: "CONTRACT_ACCEPTANCE", DELIVERY: "DELIVERY", INVOICE_ISSUANCE: "INVOICE_ISSUANCE",
  FINANCIAL: "FINANCIAL", DEPLOYMENT: "DEPLOYMENT", CREDENTIAL_ACCESS: "CREDENTIAL_ACCESS" });
const short = (v, n = 80) => (v == null ? null : String(v).slice(0, n));

export function createExecutionBoundary({ isBlocked = () => null, isStopped = () => false, onDecision = () => {} } = {}) {
  const stats = { checked: 0, allowed: 0, refused: 0 }; const byClass = {};
  /** check({agentId, onBehalfOf, tool, operation, opClass}) -> {allowed, reason}. `onBehalfOf` is the agent a SYSTEM actor (the Master) is acting for: a block on either identity applies. */
  function check({ agentId = null, onBehalfOf = null, tool = null, operation = null, opClass = null, taskId = null } = {}) {
    stats.checked++; if (opClass) byClass[opClass] = (byClass[opClass] ?? 0) + 1;
    const ids = [...new Set([agentId, onBehalfOf].filter(x => typeof x === "string" && x))];
    let reason = null;
    try {
      for (const id of ids.length ? ids : [null]) {
        const r = isBlocked({ agentId: id, tool: tool ?? null, operation: operation ?? opClass ?? null });
        if (r) { reason = "INCIDENT_CONTAINMENT:" + short(r, 60); break; }
        if (opClass) { const r2 = isBlocked({ agentId: id, tool: null, operation: opClass }); if (r2) { reason = "INCIDENT_CONTAINMENT:" + short(r2, 60); break; } }
      }
    } catch { reason = "BLOCK_CHECK_ERROR"; }
    if (!reason) { try { if (isStopped()) reason = "OWNER_STOP_OR_SAFE_MODE_ACTIVE"; } catch { reason = "STOP_CHECK_ERROR"; } }
    const d = reason ? { allowed: false, reason } : { allowed: true, reason: null };
    d.allowed ? stats.allowed++ : stats.refused++;
    try { onDecision({ agentId: short(agentId, 40), onBehalfOf: short(onBehalfOf, 40), tool: short(tool), operation: short(operation ?? opClass), opClass, taskId: short(taskId, 80), allowed: d.allowed, reason: d.reason }); } catch { /* observation never changes a verdict */ }
    return d;
  }
  /** Wrap a function so it cannot run while the boundary refuses it. The wrapped function gets the same arguments. */
  function guard(fn, meta = {}) { return (...a) => { const d = check(typeof meta === "function" ? meta(...a) : meta); if (!d.allowed) { const e = new Error("BOUNDARY_REFUSED:" + d.reason); e.code = "BOUNDARY_REFUSED"; throw e; } return fn(...a); }; }
  return { check, guard, stats: () => ({ ...stats, byClass: { ...byClass } }) };
}
