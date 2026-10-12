// Registrations: workflow, ledger, recovery and health modules. Each wraps the module's REAL exports; stateless modules are exposed as deterministic capabilities,
// small in-memory legacy stores are either superseded by a durable replacement (named with evidence) or kept with their process-local nature stated in the purpose.
import path from "node:path";
import { ANY, str, num, int, bool, arr, obj, cap, POLICY } from "./_util.mjs";
import { checkpoint, resume } from "../checkpoint-engine.mjs";
import { progressEntry, summarizeProgress } from "../progress-ledger.mjs";
import { createTaskLedger, updateTaskLedger, taskComplete } from "../task-ledger.mjs";
import { reviewResult } from "../qa-reviewer.mjs";
import { recoveryPlan } from "../recovery.mjs";
import { runEvalSuite, requireNoRegression } from "../regression-eval-suite.mjs";
import { buildEvidenceRecord, ENV_LABELS, TEST_TYPES, RESULTS } from "../evidence-record.mjs";
import { ATLASZ_EVENTS, subscribe, publish } from "../event-bus.mjs";
import { enqueue, next, configureLimit, acquire } from "../priority-queue-rate-limit-governor.mjs";
import { chooseRoute, actualCost } from "../cost-model-router.mjs";
import { createHealthMonitor } from "../health-monitor.mjs";
import { selfHeal } from "../self-healing-loop.mjs";

const plain = x => JSON.parse(JSON.stringify(x ?? null));
const OBJ = r => (r && typeof r === "object" ? true : "no object result");

/** Built-in invariants: the regression set that guards the safety properties of the workflow libraries (run by `regression-eval-suite.run_invariants`). */
export function workflowInvariants() {
  return [
    { id: "recovery-bounded", run: () => recoveryPlan("x", { attempt: 2, maxRetries: 2 }), assert: r => r.action === "BLOCKED" && r.requiresHuman === true },
    { id: "recovery-retries-then-alternate", run: () => [recoveryPlan("x", { attempt: 0, maxRetries: 1 }), recoveryPlan("x", { attempt: 1, maxRetries: 1, alternateAvailable: true })], assert: r => r[0].action === "RETRY" && r[1].action === "ALTERNATE_TOOL_OR_MODEL" },
    { id: "selfheal-never-loops", run: async () => { let n = 0; const r = await selfHeal({ operation: () => { n++; throw new Error("boom"); }, verify: () => ({ passed: true }), maxRetries: 2 }); return { r, n }; }, assert: o => o.r.state === "BLOCKED" && o.n === 3 },
    { id: "qa-needs-evidence", run: () => reviewResult({ checks: [{ id: "c1", passed: true }], evidence: [] }), assert: r => r.status === "FAIL" && r.nextAction === "RETURN_TO_EXECUTOR" },
    { id: "qa-passes-with-evidence", run: () => reviewResult({ checks: [{ id: "c1", passed: true }], evidence: [{ checkId: "c1" }] }), assert: r => r.status === "PASS" },
    { id: "router-never-over-budget", run: () => chooseRoute({ task: "t", routes: [{ id: "a", estimatedCostUsd: 5, qualityScore: 9 }], maxCostUsd: 1, minimumQuality: 1 }), assert: r => r.route === null && r.requiresOwnerApproval === true },
    { id: "router-rejects-invalid-cost", run: () => actualCost([{ costUsd: 1 }, { costUsd: 2 }]), assert: x => x === 3 },
    { id: "checkpoint-is-a-copy", run: () => { const s = { a: { b: 1 } }; const cp = checkpoint(s, { workflowId: "w" }); s.a.b = 2; return cp.state.a.b; }, assert: v => v === 1 },
    { id: "evidence-needs-reason-on-fail", run: () => { try { buildEvidenceRecord({ component: "c", version: "1", environment: "e", label: "MOCK", testType: "UNIT", result: "FAIL" }); return "accepted"; } catch (e) { return String(e.message); } }, assert: m => /EVIDENCE_FIELD_INVALID/.test(m) },
    { id: "task-ledger-needs-all-done", run: () => taskComplete(createTaskLedger({ taskId: "t", goal: "g", doneDefinition: [{ passed: true }, { passed: false }] })), assert: v => v === false },
    { id: "task-id-immutable", run: () => updateTaskLedger(createTaskLedger({ taskId: "t", goal: "g" }), { taskId: "other" }).taskId, assert: v => v === "t" }
  ];
}

export function registerWorkflow(broker, ctx) {
  // ---- health monitor and the libraries it composes
  const monitorFile = ctx.stateDir ? path.join(ctx.stateDir, "health", "monitor.json") : null;
  let monitor = null; const hm = () => (monitor ??= createHealthMonitor({ broker, file: monitorFile, critical: ["owner-control", "scheduler", "master-runtime", "credential-broker"], audit: ctx.audit ?? (() => {}), restart: ctx.restartComponent ?? null }));
  broker.register({ id: "health-monitor", source: "atlasz-addons/health-monitor.mjs", manager: "RECOVERY_MAINTENANCE", lifecycle: "CONTINUOUS", policy: POLICY.low,
    purpose: "Continuous module health: probes through the broker with bounded retries, per-module circuit breakers (OPEN after repeated failures, HALF_OPEN re-probe), watchdog escalation for critical modules, persisted alerts and audit. A probe blocked by the control chain is reported BLOCKED and never retried; restarts (when a hook exists) are budgeted per window with backoff.",
    capabilities: [
      cap("sweep", "READ_STATUS", async () => plain(await hm().sweep()), { description: "Probe every registered module once (bounded), update breakers and alerts.", timeoutMs: 120000 }),
      cap("status", "READ_STATUS", () => plain(hm().status()), { description: "Breakers that are not closed, watchdog overall state, alert count." }),
      cap("alerts", "READ_STATUS", a => ({ alerts: plain(hm().alerts(a.limit ?? 50)) }), { input: obj({ limit: int({ minimum: 1, maximum: 200 }) }) })
    ],
    selfTest: { capability: "status", expect: r => (typeof r.sweeps === "number" ? true : "status shape") } });
  broker.register({ id: "watchdog", source: "atlasz-addons/watchdog.mjs", manager: "RECOVERY_MAINTENANCE", lifecycle: "INTERNAL_LIBRARY", consumer: "health-monitor", policy: POLICY.low, purpose: "Hang / stale-heartbeat detection with escalation after N consecutive failures; instantiated inside the health monitor for every tracked module." });
  broker.register({ id: "self-healing-loop", source: "atlasz-addons/self-healing-loop.mjs", manager: "RECOVERY_MAINTENANCE", lifecycle: "INTERNAL_LIBRARY", consumer: "health-monitor", policy: POLICY.low, purpose: "Bounded operation > verify > retry > alternate loop (no policy bypass, no spending); used by the health monitor for every probe." });

  broker.register({ id: "recovery", source: "atlasz-addons/recovery.mjs", manager: "RECOVERY_MAINTENANCE", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Recovery decision for a failed step: RETRY (bounded), ALTERNATE_TOOL_OR_MODEL, or BLOCKED with requiresHuman; it only decides, it never executes.",
    capabilities: [cap("plan", "INTERNAL_COMPUTE", a => plain(recoveryPlan(a.error ?? "UNKNOWN", { attempt: a.attempt ?? 0, maxRetries: a.maxRetries ?? 2, alternateAvailable: a.alternateAvailable === true })), { input: obj({ error: str({ maxLength: 320 }), attempt: int({ minimum: 0, maximum: 100 }), maxRetries: int({ minimum: 0, maximum: 100 }), alternateAvailable: bool() }) })],
    selfTest: { capability: "plan", args: { error: "x", attempt: 0, maxRetries: 1 }, expect: r => (r.action === "RETRY" ? true : "expected RETRY") } });
  broker.register({ id: "checkpoint-engine", source: "atlasz-addons/checkpoint-engine.mjs", manager: "RECOVERY_MAINTENANCE", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Workflow checkpoints: deep-copied state snapshot with workflow id and step, and a validated resume; the Master persists the returned record with the job.",
    capabilities: [
      cap("checkpoint", "INTERNAL_COMPUTE", a => plain(checkpoint(a.state, { workflowId: a.workflowId, step: a.step, reason: a.reason })), { input: obj({ state: ANY, workflowId: str({ maxLength: 120 }), step: str({ maxLength: 120 }), reason: str({ maxLength: 60 }) }, ["state", "workflowId"]) }),
      cap("resume", "INTERNAL_COMPUTE", a => plain(resume(a.checkpoint)), { input: obj({ checkpoint: ANY }, ["checkpoint"]) })
    ],
    selfTest: { capability: "checkpoint", args: { state: { a: 1 }, workflowId: "selftest", step: "s1" }, expect: r => (r.state?.a === 1 && r.workflowId === "selftest" ? true : "checkpoint shape") } });
  broker.register({ id: "progress-ledger", source: "atlasz-addons/progress-ledger.mjs", manager: "TASK_SCHEDULER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Measured progress entries (metric before/after/delta with evidence) and a stall summary; used to detect stalled work from numbers, not narrative.",
    capabilities: [
      cap("entry", "INTERNAL_COMPUTE", a => plain(progressEntry(a)), { input: obj({ taskId: str({ maxLength: 120 }), metric: str({ maxLength: 120 }), before: num(), after: num(), evidence: ANY, note: str({ maxLength: 400 }) }, ["taskId", "metric", "before", "after"]) }),
      cap("summarize", "INTERNAL_COMPUTE", a => plain(summarizeProgress(a.entries)), { input: obj({ entries: arr(ANY) }, ["entries"]) })
    ],
    selfTest: { capability: "entry", args: { taskId: "t", metric: "m", before: 1, after: 3 }, expect: r => (r.delta === 2 ? true : "delta") } });
  broker.register({ id: "task-ledger", source: "atlasz-addons/task-ledger.mjs", manager: "TASK_SCHEDULER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Task ledger (goal, facts, unknowns, subtasks, done definition); a task is complete only when EVERY done-definition item passed; the task id is immutable.",
    capabilities: [
      cap("create", "INTERNAL_COMPUTE", a => plain(createTaskLedger(a)), { input: obj({ taskId: str({ maxLength: 120 }), goal: str({ maxLength: 1000 }), facts: arr(ANY), unknowns: arr(ANY), subtasks: arr(ANY), doneDefinition: arr(ANY) }, ["taskId", "goal"]) }),
      cap("update", "INTERNAL_COMPUTE", a => plain(updateTaskLedger(a.ledger, a.patch ?? {})), { input: obj({ ledger: ANY, patch: ANY }, ["ledger"]) }),
      cap("complete", "READ_STATUS", a => ({ complete: taskComplete(a.ledger) }), { input: obj({ ledger: ANY }, ["ledger"]) })
    ],
    selfTest: { capability: "create", args: { taskId: "t", goal: "g", doneDefinition: [{ passed: true }] }, expect: r => (r.taskId === "t" ? true : "ledger shape") } });
  broker.register({ id: "qa-reviewer", source: "atlasz-addons/qa-reviewer.mjs", manager: "QUALITY_ASSURANCE", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Independent QA gate: PASS only when every required check passed AND has matching evidence; otherwise FAIL and the work returns to the executor. It requests delivery approval but never delivers.",
    capabilities: [cap("review", "INTERNAL_COMPUTE", a => plain(reviewResult({ checks: a.checks, evidence: a.evidence ?? [] })), { input: obj({ checks: arr(obj({ id: str({ maxLength: 120 }), passed: bool(), required: bool() }, ["id"], true)), evidence: arr(ANY) }, ["checks"]) })],
    selfTest: { capability: "review", args: { checks: [{ id: "c", passed: true }], evidence: [] }, expect: r => (r.status === "FAIL" ? true : "a check without evidence must FAIL") } });
  broker.register({ id: "regression-eval-suite", source: "atlasz-addons/regression-eval-suite.mjs", manager: "QUALITY_ASSURANCE", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Executes assertion suites and compares them with a baseline; the built-in invariant suite guards the safety properties of the recovery, QA, routing, checkpoint, evidence and ledger libraries.",
    capabilities: [
      cap("run_invariants", "INTERNAL_COMPUTE", async () => plain(await runEvalSuite(workflowInvariants())), { description: "Run the built-in invariant suite.", timeoutMs: 30000 }),
      cap("compare", "INTERNAL_COMPUTE", a => plain(requireNoRegression(a.current, a.baseline)), { input: obj({ current: ANY, baseline: ANY }, ["current", "baseline"]) })
    ],
    selfTest: { capability: "run_invariants", expect: r => (r.status === "PASS" ? true : "invariant suite failing: " + JSON.stringify(r.results.filter(x => !x.passed).map(x => x.id))) } });
  broker.register({ id: "evidence-record", source: "atlasz-addons/evidence-record.mjs", manager: "QUALITY_ASSURANCE", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Runtime evidence record (component, version/commit/build, environment, MOCK/SANDBOX/STAGING/PRODUCTION label, test type, result, trace id); a failing/blocked record must carry its error or blocker, and a PRODUCTION label cannot be attached to a sandbox environment.",
    capabilities: [cap("build", "INTERNAL_COMPUTE", a => plain(buildEvidenceRecord(a)), { input: obj({ component: str({ maxLength: 120 }), version: str({ maxLength: 60 }), commit: str({ maxLength: 60 }), build: str({ maxLength: 60 }), environment: str({ maxLength: 60 }), label: { type: "string", enum: [...ENV_LABELS] }, testType: { type: "string", enum: [...TEST_TYPES] }, result: { type: "string", enum: [...RESULTS] }, details: ANY, error: str({ maxLength: 400 }), blocker: str({ maxLength: 400 }) }, ["component", "environment", "label", "testType", "result"]) })],
    selfTest: { capability: "build", args: { component: "x", version: "1", environment: "unit", label: "MOCK", testType: "UNIT", result: "PASS" }, expect: r => (r.label === "MOCK" ? true : "label") } });

  // ---- event bus: the Control Center owns ONE recorder subscribed to every event type (process-local ring; the Master audit log stays the durable record)
  const ring = []; let wired = false;
  const wire = () => { if (wired) return; wired = true; for (const t of ATLASZ_EVENTS) subscribe(t, e => { ring.push({ type: e.type, at: e.at, payload: JSON.parse(JSON.stringify(e.payload ?? null)) }); if (ring.length > 200) ring.shift(); try { ctx.onEvent?.(e); } catch { /* subscribers never break publishers */ } }); };
  broker.register({ id: "event-bus", source: "atlasz-addons/event-bus.mjs", manager: "MASTER_COORDINATOR", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Typed internal event bus (closed event vocabulary). The Control Center subscribes one recorder to all events (process-local ring of the last 200; the hash-chained Master audit remains the durable record, so a restart loses only the convenience view).",
    capabilities: [
      cap("publish", "INTERNAL_BRAIN_ACTION", async a => { wire(); const e = await publish(a.type, a.payload ?? {}); return plain(e); }, { input: obj({ type: { type: "string", enum: [...ATLASZ_EVENTS] }, payload: ANY }, ["type"]) }),
      cap("recent", "READ_STATUS", a => { wire(); return { events: plain(ring.filter(e => !a.type || e.type === a.type).slice(-(a.limit ?? 50))) }; }, { input: obj({ type: str({ maxLength: 40 }), limit: int({ minimum: 1, maximum: 200 }) }) }),
      cap("vocabulary", "READ_STATUS", () => ({ events: [...ATLASZ_EVENTS] }))
    ],
    selfTest: { capability: "vocabulary", expect: r => (r.events.length >= 10 ? true : "vocabulary") } });
  broker.register({ id: "priority-queue-rate-limit-governor", source: "atlasz-addons/priority-queue-rate-limit-governor.mjs", manager: "TASK_SCHEDULER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Process-local priority queue with de-duplication plus token-bucket rate limits (used for per-provider request budgets); durable work stays in the Master queue and the scheduler, this is the in-flight admission governor.",
    capabilities: [
      cap("enqueue", "INTERNAL_COMPUTE", a => plain(enqueue(a.item, { priority: a.priority, kind: a.kind, dedupeKey: a.dedupeKey })), { input: obj({ item: ANY, priority: num(), kind: str({ maxLength: 30 }), dedupeKey: str({ maxLength: 120 }) }, ["item"]) }),
      cap("next", "INTERNAL_COMPUTE", () => plain({ item: next() })),
      cap("configure_limit", "INTERNAL_COMPUTE", a => { configureLimit(a.key, { capacity: a.capacity, refillPerSecond: a.refillPerSecond }); return { configured: a.key }; }, { input: obj({ key: str({ maxLength: 80 }), capacity: num({ minimum: 0.000001 }), refillPerSecond: num({ minimum: 0.000001 }) }, ["key", "capacity", "refillPerSecond"]) }),
      cap("acquire", "INTERNAL_COMPUTE", a => plain(acquire(a.key, a.cost ?? 1)), { input: obj({ key: str({ maxLength: 80 }), cost: num({ minimum: 0.000001 }) }, ["key"]) })
    ],
    selfTest: { capability: "acquire", args: { key: "__selftest_unconfigured__" }, expect: r => (r.allowed === false && r.reason === "LIMIT_NOT_CONFIGURED" ? true : "unconfigured limit must deny") } });
  broker.register({ id: "dead-letter-queue", source: "atlasz-addons/dead-letter-queue.mjs", manager: "TASK_SCHEDULER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Dead-letter API (deadLetter/list/resolve) over the DURABLE store: failed work survives restarts and crashes. No in-memory fallback. Read-only here: retry and store recovery need a signed owner approval outside the broker.",
    capabilities: [
      cap("status", "READ_STATUS", () => { const s = ctx.deadLetterStore(); return { ...s.status(), chain: s.verify() }; }, { description: "Store state (OK/CORRUPT), open count, chain integrity." }),
      cap("list", "READ_STATUS", () => ({ open: ctx.deadLetterStore().list("OPEN").slice(0, 100).map(r => ({ id: r.id, taskId: r.taskId, error: r.error, attempts: r.attempts, occurrences: r.occurrences, interruptedRetry: Boolean(r.interruptedRetry), createdAt: r.createdAt })) }), { description: "Open dead letters (no item payloads)." })],
    selfTest: { capability: "status", expect: r => (r.durable === true && r.state === "OK" && r.chain?.ok === true ? true : "dead-letter store not durable/healthy") } });
  broker.register({ id: "durable-dead-letters", source: "atlasz-addons/durable-dead-letters.mjs", manager: "TASK_SCHEDULER", lifecycle: "INTERNAL_LIBRARY", consumer: "dead-letter-queue", policy: POLICY.low, purpose: "Hash-chained, fsynced, head-pinned dead-letter journal with authorised single-run retry, interrupted-retry recovery and fail-closed corruption handling." });
  broker.register({ id: "observability-black-box", source: "atlasz-addons/observability-black-box.mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "SUPERSEDED", supersededBy: "owner-control", policy: POLICY.low,
    purpose: "In-memory black box event list.", rationale: "owner-control hosts the hash-chained, tamper-evident black box (ocBlackBox) that the control chain writes to on every decision; the in-memory variant has no integrity protection and would duplicate state." });

  // ---- AI cost routing helper (pure; the AI Model Manager decides, the spend caps and approvals stay with the control chain)
  broker.register({ id: "cost-model-router", source: "atlasz-addons/cost-model-router.mjs", manager: "AI_MODEL_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Cost-aware route choice among given routes under a maximum cost and minimum quality; with no eligible route it returns requiresOwnerApproval instead of exceeding the budget. Also totals actual cost events and rejects invalid costs.",
    capabilities: [
      cap("choose_route", "RECOMMEND", a => plain(chooseRoute(a)), { input: obj({ task: str({ maxLength: 200 }), routes: arr(obj({ id: str({ maxLength: 80 }), estimatedCostUsd: num({ minimum: 0 }), qualityScore: num(), available: bool() }, ["id"], true)), maxCostUsd: num({ minimum: 0 }), minimumQuality: num() }, ["routes"]) }),
      cap("actual_cost", "INTERNAL_COMPUTE", a => ({ totalUsd: actualCost(a.events) }), { input: obj({ events: arr(obj({ costUsd: num({ minimum: 0 }) }, ["costUsd"], true)) }, ["events"]) })
    ],
    selfTest: { capability: "choose_route", args: { task: "t", routes: [{ id: "a", estimatedCostUsd: 5, qualityScore: 9 }], maxCostUsd: 1, minimumQuality: 1 }, expect: r => (r.route === null && r.requiresOwnerApproval === true ? true : "must not choose an over-budget route") } });
  return { hm };
}
