// Brain Health / self-evaluation (V7.3 Brain §16). Measures; recommends; never changes authority or removes a control.
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
export function computeBrainHealth({ blackBox, verifier = null, planner = null, graph = null } = {}) {
  if (!blackBox) throw new Error("BLACKBOX_REQUIRED");
  const ev = blackBox.all(), n = k => ev.filter(e => e.kind === k).length;
  const executed = n("PIPELINE_EXECUTE"), completed = n("PIPELINE_COMPLETE"), verifyFail = ev.filter(e => e.kind === "PIPELINE_VERIFY" && e.verification && e.verification !== "ACCEPT").length;
  const execErr = ev.filter(e => e.result === "EXECUTOR_ERROR").length, recoveries = n("RECOVERY"), blocked = ev.filter(e => e.kind === "PIPELINE_PLAN" && /DENY|NEEDS_APPROVAL/.test(e.decision ?? "")).length;
  const cost = ev.reduce((s, e) => s + (Number(e.costUsd) || 0), 0), vs = verifier?.stats?.() ?? null;
  const plans = planner ? planner.list().map(p => planner.get(p.id)) : [];
  const replans = plans.reduce((s, p) => s + (p.version - 1), 0), plansDone = plans.filter(p => p.status === "COMPLETE").length;
  const m = { executionSuccessPct: pct(completed, executed), planCompletionPct: plans.length ? pct(plansDone, plans.length) : null, replanCount: replans, verificationFailures: verifyFail, executorErrors: execErr, recoveries,
    falseSuccessDetections: vs?.falseSuccess ?? null, selfVerificationAttempts: vs?.selfVerification ?? null, blockedByGovernance: blocked, costPerCompletedUsd: completed ? Math.round((cost / completed) * 100) / 100 : null, tasksCompleted: completed, eventsObserved: ev.length };
  const rec = [];
  if (m.executionSuccessPct !== null && m.executionSuccessPct < 70) rec.push("Execution success is below 70%: review failing agents/models in the capability graph.");
  if (m.falseSuccessDetections > 0) rec.push("Executors claimed success without evidence " + m.falseSuccessDetections + " time(s): tighten executor output contracts.");
  if (m.verificationFailures > m.tasksCompleted) rec.push("More verification failures than completions: review task definitions and acceptance criteria.");
  if (m.recoveries > 3) rec.push("Frequent recovery actions: investigate the root cause of repeated failures.");
  if (graph) { const weak = graph.list().filter(x => x.reliability !== null && x.stats.runs >= 5 && x.reliability < 0.5).map(x => x.id); if (weak.length) rec.push("Low-reliability nodes: " + weak.join(", ")); }
  return { metrics: m, recommendations: rec, noData: ev.length === 0, authorityChange: false, note: "Recommendations only. Brain Health cannot change permissions, approvals, controls or its own authority." };
}
