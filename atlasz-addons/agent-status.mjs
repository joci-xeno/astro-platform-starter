// Normalised agent status for the Master / Control Center supervision view (owner directive Part 11). Derived ONLY from the registry state and the agent's most recent task;
// COMPLETED_VERIFIED requires the task to have PASSED independent verification (task status VERIFIED) - an agent's own "done" never counts.
export const AGENT_STATUSES = Object.freeze(["IDLE", "RUNNING", "WAITING_FOR_APPROVAL", "WAITING_FOR_DEPENDENCY", "FAILED", "RECOVERING", "COMPLETED_VERIFIED", "SUSPENDED", "UNKNOWN"]);
const APPROVAL = new Set(["BLOCKED_PENDING_OWNER_APPROVAL", "NEEDS_OWNER_INPUT"]);
const DEPENDENCY = new Set(["SUBMITTED", "SUBMITTED_AWAITING_INDEPENDENT_CHECK", "AWAITING_CHECK", "PLANNED"]);
const RECOVERING = new Set(["INTERRUPTED", "REJECTED_REWORK_ALLOWED", "REASSIGNING", "REASSIGN_PREPARED"]);
const FAILED = new Set(["DEAD_LETTER", "BLOCKED", "TASK_BLOCKED", "REJECTED_FINAL", "REJECTED_TOO_OFTEN"]);
export function normalizeAgentStatus(view, { blockedByIncident = false } = {}) {
  if (!view) return "UNKNOWN";
  if (blockedByIncident || view.state === "PAUSED" || view.state === "DISABLED") return "SUSPENDED";
  const last = view.history?.recent?.[0]?.status ?? null;
  if (last === "SUSPENDED") return "SUSPENDED";
  if (view.state === "WORKING" || last === "RUNNING") return "RUNNING";
  if (APPROVAL.has(last)) return "WAITING_FOR_APPROVAL";
  if (RECOVERING.has(last)) return "RECOVERING";
  if (DEPENDENCY.has(last)) return "WAITING_FOR_DEPENDENCY";
  if (view.state === "BLOCKED_OR_FAILED" || FAILED.has(last)) return "FAILED";
  if (last === "VERIFIED") return "COMPLETED_VERIFIED";
  if (view.state === "IDLE" || view.state === "NO_ACTIVITY_YET") return "IDLE";
  if (view.state === "WAITING") return "WAITING_FOR_DEPENDENCY";
  return "UNKNOWN";
}
