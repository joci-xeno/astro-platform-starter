// Central Brain + Brain Bus (V7.3 Brain §1, §14). The Central Brain reads authorized state and produces a decision brief; it coordinates, it does not execute.
// Brains talk only through the bus, which enforces per-brain topic ACLs, forbids authority-granting topics and stops circular authority.
export const BRAINS = Object.freeze(["CENTRAL", "ORCHESTRATOR", "PLANNING", "CAPABILITY", "KNOWLEDGE", "SECURITY", "OPPORTUNITY", "BUSINESS_FACTORY", "VERIFICATION", "SIMULATION", "RECOVERY"]);
const FORBIDDEN_TOPICS = new Set(["GRANT_PERMISSION", "OWNER_AUTH", "DISABLE_AUDIT", "DISABLE_KILL_SWITCH", "SELF_APPROVE", "CHANGE_OWNER_AUTHORITY", "SPEND_APPROVED"]);
export const DEFAULT_ACL = Object.freeze({
  CENTRAL: ["TASK_ANALYZED", "PLAN_REQUESTED", "STATUS_REQUESTED"], ORCHESTRATOR: ["TASK_ASSIGNED", "TASK_RESULT", "VERIFY_REQUESTED", "SECURITY_CHECK_REQUESTED"], PLANNING: ["PLAN_CREATED", "REPLAN_PROPOSED", "FAILURE_DECISION"],
  CAPABILITY: ["MATCH_RESULT"], KNOWLEDGE: ["KNOWLEDGE_RESULT", "CONFLICT_FOUND"], SECURITY: ["SECURITY_DECISION", "QUARANTINE"], OPPORTUNITY: ["OPPORTUNITY_SCORED", "HANDOFF_PROPOSED"], BUSINESS_FACTORY: ["SERVICE_DRAFTED"],
  VERIFICATION: ["VERIFICATION_RESULT"], SIMULATION: ["SIMULATION_RESULT"], RECOVERY: ["INCIDENT_UPDATE"] });

export function createBrainBus({ acl = DEFAULT_ACL, blackBox = null, maxHops = 4 } = {}) {
  const subs = new Map(), denied = [];
  function subscribe(brain, topic, fn) { if (!BRAINS.includes(brain)) throw new Error("UNKNOWN_BRAIN"); if (FORBIDDEN_TOPICS.has(topic)) throw new Error("FORBIDDEN_TOPIC"); (subs.get(topic) ?? subs.set(topic, []).get(topic)).push({ brain, fn }); }
  /** event chain `path` lists brains that already handled this causal chain; a brain already on the path is not re-invoked (no loops), and depth is capped. */
  async function publish(from, topic, payload = {}, path = []) {
    const refuse = reason => { denied.push({ from, topic, reason }); blackBox?.record({ kind: "BUS_DENIED", agentId: from, decision: "DENY", reason: topic + ":" + reason }); return { delivered: 0, denied: true, reason }; };
    if (!BRAINS.includes(from)) return refuse("UNKNOWN_SENDER");
    if (FORBIDDEN_TOPICS.has(topic)) return refuse("FORBIDDEN_TOPIC");
    if (!(acl[from] ?? []).includes(topic)) return refuse("SENDER_NOT_ALLOWED_TO_PUBLISH_TOPIC");
    if (path.length >= maxHops) return refuse("MAX_HOPS_EXCEEDED");
    const chain = [...path, from]; let delivered = 0;
    for (const s of subs.get(topic) ?? []) { if (chain.includes(s.brain)) continue; await s.fn({ from, topic, payload: structuredClone(payload), path: chain }); delivered++; }
    blackBox?.record({ kind: "BUS_" + topic, agentId: from, decision: "DELIVERED:" + delivered }); return { delivered, denied: false };
  }
  return { subscribe, publish, denied: () => denied.slice(-100) };
}

/** sources: functions returning authorized, read-only state; any missing source is reported NOT_CONNECTED (never invented). */
export function createCentralBrain({ graph, planner, governance, sources = {}, bus = null } = {}) {
  if (!graph || !planner || !governance) throw new Error("CENTRAL_BRAIN_REQUIRES_GRAPH_PLANNER_GOVERNANCE");
  const keys = ["agents", "jobs", "opportunities", "plans", "tools", "models", "connectors", "memory", "knowledge", "costs", "risks", "approvals", "runtimeHealth", "evidence", "recoveryState"];
  function snapshot() {
    const out = {}; for (const k of keys) { const f = sources[k]; if (typeof f !== "function") { out[k] = { state: "NOT_CONNECTED" }; continue; } try { out[k] = { state: "OK", data: f() }; } catch (e) { out[k] = { state: "ERROR", error: String(e.message).slice(0, 100) }; } }
    out.capabilityGraph = { state: "OK", data: graph.summary() }; out.plans = out.plans.state === "OK" ? out.plans : { state: "OK", data: planner.list() };
    return out;
  }
  /** Decision brief for a task: WHAT / WHY / WHICH agent+model+tools / dependencies / cost / risk / approval / verification / failure plan. Advice only. */
  function decide(task = {}) {
    if (!task.what) throw new Error("WHAT_REQUIRED");
    const m = graph.match({ capabilities: task.capabilities ?? [], allowCost: Number(task.estCostUsd ?? 0) > 0, sandbox: task.sandbox === true });
    const req = governance.requirements({ action: task.governanceAction ?? "EXECUTE_TASK", external: task.external === true, spendUsd: Number(task.estCostUsd ?? 0) });
    const risks = [...(task.external ? ["EXTERNAL_EFFECT"] : []), ...(Number(task.estCostUsd ?? 0) > 0 ? ["SPEND"] : []), ...(m.missingCapabilities.length ? ["CAPABILITY_GAP:" + m.missingCapabilities.join(",")] : []), ...(task.reversible === false ? ["IRREVERSIBLE"] : [])];
    return { what: task.what, why: task.why ?? "NOT_STATED", which: { agent: m.combination.AGENT ?? null, model: m.combination.MODEL ?? null, tools: [m.combination.TOOL, m.combination.CONNECTOR].filter(Boolean), workflow: m.combination.WORKFLOW ?? null }, dependencies: task.dependsOn ?? [],
      expected: { costUsd: Number.isFinite(Number(task.estCostUsd)) ? Number(task.estCostUsd) : null, risks }, ownerApprovalRequired: Boolean(req.approvalAction) || req.denied, approvalAction: req.approvalAction, forbidden: req.denied === true,
      verification: task.successCriteria ?? "UNDEFINED: define acceptance criteria before execution", onFailure: ["RETRY (bounded)", "CHANGE_AGENT/MODEL/TOOL", "USE_FALLBACK", "REPLAN", "ASK_JOCI", "STOP_SAFELY"], matched: m.matched, excluded: m.excluded, note: "Advice only: execution still passes governance, security and independent verification." };
  }
  return { snapshot, decide, bus };
}
