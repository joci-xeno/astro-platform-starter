// Brain Orchestrator (V7.3 Brain §2): TASK -> ANALYZE -> PLAN -> CAPABILITY MATCH -> ASSIGN -> EXECUTE -> OBSERVE -> VERIFY -> REPLAN -> COMPLETE -> EVIDENCE -> LEARN.
// It coordinates the EXISTING 5 SEARCH + 25 EXECUTION agents (it does not create agents). Executors are injected; every task passes governance,
// the Security Brain and the Independent Verifier. A task is DONE only when an independent verifier accepts it.
export const PIPELINE = Object.freeze(["ANALYZE", "PLAN", "CAPABILITY_MATCH", "ASSIGN", "EXECUTE", "OBSERVE", "VERIFY", "COMPLETE", "EVIDENCE", "LEARN"]);

export function validateRoster(roster) {
  const s = roster.filter(a => a.team === "SEARCH").length, e = roster.filter(a => a.team === "EXECUTION").length, ids = new Set(roster.map(a => a.id));
  return { ok: s === 5 && e === 25 && ids.size === 30, search: s, execution: e, unique: ids.size };
}

export function createOrchestrator({ roster, graph, planner, governance, verifier, blackBox, security = null, executors = {}, learn = null, now = () => Date.now(), strictTopology = true } = {}) {
  for (const [k, v] of Object.entries({ roster, graph, planner, governance, verifier, blackBox })) if (!v) throw new Error("ORCHESTRATOR_REQUIRES:" + k);
  const topo = validateRoster(roster); if (strictTopology && !topo.ok) throw new Error("TOPOLOGY_MUST_BE_5_SEARCH_PLUS_25_EXECUTION");
  const agentIds = new Set(roster.map(a => a.id)), locks = new Map(), inFlight = new Map(), failedAgents = new Map();
  const trace = [];

  async function runTask(planId, taskId, ctx = {}) {
    const plan = planner.get(planId), task = plan.tasks[taskId]; if (!task) throw new Error("UNKNOWN_TASK");
    const corr = ctx.correlationId ?? blackBox.newCorrelationId(), step = (name, extra = {}) => { trace.push({ taskId, step: name }); blackBox.record({ kind: "PIPELINE_" + name, correlationId: corr, jobId: plan.id, taskId, ...extra }); };
    step("ANALYZE", { decision: "ready=" + task.dependsOn.every(d => plan.tasks[d].status === "DONE") });
    if (task.status !== "PENDING") return { status: "SKIPPED", reason: "TASK_NOT_PENDING:" + task.status, correlationId: corr };
    // duplicate / conflicting work
    const key = task.dedupeKey ?? task.id;
    if (inFlight.has(key)) { step("PLAN", { decision: "DEFER", reason: "DUPLICATE_IN_FLIGHT" }); return { status: "DEFERRED", reason: "DUPLICATE_IN_FLIGHT", correlationId: corr }; }
    for (const r of task.resources ?? []) if (locks.has(r) && locks.get(r) !== task.id) { step("PLAN", { decision: "DEFER", reason: "RESOURCE_LOCKED:" + r }); return { status: "DEFERRED", reason: "RESOURCE_LOCKED:" + r, correlationId: corr }; }
    // governance: kill switch / approvals / spend
    const gov = governance.authorize({ brain: "ORCHESTRATOR", action: task.governanceAction ?? "EXECUTE_TASK", external: task.external === true, spendUsd: Number(task.estCostUsd ?? 0), subject: task.id, ownerApproval: ctx.ownerApproval ?? null });
    step("PLAN", { decision: gov.decision, reason: gov.reason });
    if (!gov.allowed) {
      const failure = gov.decision === "NEEDS_APPROVAL" ? "APPROVAL_REQUIRED" : "OWNER_STOP";
      const d = planner.decideOnFailure(planId, taskId, { kind: failure }); return { status: gov.decision === "NEEDS_APPROVAL" ? "WAITING_APPROVAL" : "STOPPED", reason: gov.reason, decision: d, correlationId: corr };
    }
    // capability match (graph decides; the plan only states requirements)
    const m = graph.match({ capabilities: task.capabilities, task: task.taskType, allowCost: Number(task.estCostUsd ?? 0) > 0, sandbox: ctx.sandbox === true, exclude: [...(failedAgents.get(task.id) ?? [])] });
    step("CAPABILITY_MATCH", { decision: JSON.stringify(m.combination), reason: m.missingCapabilities.length ? "MISSING:" + m.missingCapabilities.join(",") : "OK" });
    const agentId = ctx.agentId ?? m.combination.AGENT;
    if (!agentId || !agentIds.has(agentId)) { const d = planner.decideOnFailure(planId, taskId, { kind: "AGENT_FAILURE" }, { agents: [] }); return { status: "NO_AGENT", reason: agentId ? "AGENT_NOT_IN_ROSTER:" + agentId : "NO_CAPABLE_AGENT", missing: m.missingCapabilities, decision: d, correlationId: corr }; }
    if (m.missingCapabilities.length && !ctx.allowPartial) { const d = planner.decideOnFailure(planId, taskId, { kind: "PLAN_INVALID" }); return { status: "CAPABILITY_GAP", missing: m.missingCapabilities, decision: d, correlationId: corr }; }
    if (security) { const s = security.assess({ kind: "AGENT_ACTION", agentId }); if (!s.allowed) { const d = planner.decideOnFailure(planId, taskId, { kind: "SECURITY_BLOCK" }); step("ASSIGN", { decision: s.decision, reason: s.reasons.join(",") }); return { status: "SECURITY_BLOCKED", reasons: s.reasons, decision: d, correlationId: corr }; } }
    step("ASSIGN", { agentId, model: m.combination.MODEL, tool: m.combination.TOOL, connector: m.combination.CONNECTOR, workflow: m.combination.WORKFLOW });
    const exec = executors[agentId]; if (!exec) { const d = planner.decideOnFailure(planId, taskId, { kind: "AGENT_FAILURE" }, { agents: [] }); return { status: "NO_EXECUTOR", agentId, decision: d, correlationId: corr }; }
    // execute
    planner.markTask(planId, taskId, "RUNNING"); inFlight.set(key, taskId); for (const r of task.resources ?? []) locks.set(r, task.id);
    const t0 = now(); let res, err = null;
    try { step("EXECUTE", { agentId, model: m.combination.MODEL }); res = await exec({ task: structuredClone(task), plan: { id: plan.id, goal: plan.goal }, match: m, correlationId: corr }); } catch (e) { err = e; }
    finally { inFlight.delete(key); for (const r of task.resources ?? []) if (locks.get(r) === task.id) locks.delete(r); }
    const ms = now() - t0;
    if (err) {
      graph.recordOutcome(agentId, { ok: false, ms }); step("OBSERVE", { agentId, error: String(err.message).slice(0, 200), durationMs: ms, result: "EXECUTOR_ERROR" });
      if (!failedAgents.has(task.id)) failedAgents.set(task.id, new Set()); failedAgents.get(task.id).add(agentId);
      const kind = /timeout/i.test(err.message) ? "TIMEOUT" : "AGENT_FAILURE";
      const d = planner.decideOnFailure(planId, taskId, { kind }, { agents: ["*"], fallback: false }); blackBox.record({ kind: "RECOVERY", correlationId: corr, taskId, recovery: d.action });
      return { status: "FAILED", reason: String(err.message).slice(0, 200), decision: d, correlationId: corr };
    }
    step("OBSERVE", { agentId, durationMs: ms, result: "EXECUTOR_RETURNED", costUsd: res?.costUsd });
    // verify independently
    const v = verifier.verify({ claimType: res?.claimType ?? "JOB_COMPLETION", claim: res?.claim, evidence: res?.evidence, executorId: agentId, claimText: res?.summary, highValue: task.highValue === true, generatorFamily: m.combination.MODEL ? graph.get(m.combination.MODEL)?.family : undefined, judge: ctx.judge });
    step("VERIFY", { agentId, verification: v.verdict, reason: v.reason });
    if (v.verdict !== "ACCEPT") {
      graph.recordOutcome(agentId, { ok: false, ms, quality: 0 });
      const d = planner.decideOnFailure(planId, taskId, { kind: v.verdict === "ESCALATE" ? "UNKNOWN" : "VERIFICATION_REJECTED" }, {});
      return { status: "NOT_VERIFIED", verdict: v.verdict, reason: v.reason, decision: d, correlationId: corr };
    }
    planner.markTask(planId, taskId, "DONE", { result: res.summary ?? "verified", verification: { verdict: "ACCEPT", independent: v.independent, verifierId: v.verifierId, reason: v.reason } });
    step("COMPLETE", { agentId, result: "DONE" });
    graph.recordOutcome(agentId, { ok: true, ms, quality: res?.quality ?? 1 }); if (m.combination.MODEL) graph.recordOutcome(m.combination.MODEL, { ok: true, ms, quality: res?.quality ?? 1 });
    step("EVIDENCE", { evidenceRef: res?.evidenceRef ?? ("blackbox:" + corr), outputRef: res?.claim?.path ?? null });
    try { learn?.({ planId, taskId, agentId, outcome: "VERIFIED", correlationId: corr }); step("LEARN", { decision: learn ? "recorded" : "no-learner" }); } catch { /* learning must never fail a verified task */ }
    return { status: "DONE", agentId, correlationId: corr, verification: v };
  }

  /** Runs ready tasks sequentially until nothing is runnable, a stop/approval is hit, or maxSteps is reached. */
  async function runPlan(planId, ctx = {}, { maxSteps = 100 } = {}) {
    const results = []; let steps = 0;
    while (steps++ < maxSteps) {
      const ready = planner.nextTasks(planId); if (!ready.length) break;
      let progressed = false;
      for (const t of ready) {
        const r = await runTask(planId, t.id, ctx); results.push({ taskId: t.id, ...r });
        if (["STOPPED", "WAITING_APPROVAL", "SECURITY_BLOCKED"].includes(r.status)) return { halted: r.status, results, progress: planner.progress(planId) };
        if (r.status === "DONE") progressed = true;
        else if (r.decision && ["ESCALATE", "ASK_JOCI", "REPLAN", "STOP_SAFELY"].includes(r.decision.action)) return { halted: r.decision.action, results, progress: planner.progress(planId) };
      }
      if (!progressed && !planner.nextTasks(planId).length) break;
    }
    return { halted: null, results, progress: planner.progress(planId) };
  }
  return { runTask, runPlan, topology: topo, pipeline: PIPELINE, trace: () => trace.slice(-500), locks: () => [...locks] };
}
