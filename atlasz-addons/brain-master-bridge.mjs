// BRAIN <-> MASTER BRIDGE: the one governed workflow  OWNER -> MASTER -> BRAIN -> MANAGER -> AGENT -> TOOL -> VERIFIER -> MASTER -> CONTROL CENTER.
// The Brain ADVISES and AUTHORIZES (decision brief, governance, security status); the Master QUEUES, DISPATCHES and RECORDS; a manager must be CONNECTED for the work to proceed;
// the permanent agent runs the plan step's executor tool through the control chain; an INDEPENDENT checker (never the maker) verifies; only then does the Master record completion.
// Every stage is written to a hash-chained trace (stage, reference, outcome). A stage that fails stops the workflow and says where; nothing is retried silently and nothing is invented.
import path from "node:path";
import crypto from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";

export const STAGES = Object.freeze(["OWNER", "MASTER", "BRAIN", "MANAGER", "AGENT", "TOOL", "VERIFIER", "MASTER_RECORD", "CONTROL_CENTER"]);
const MANAGER_FOR = { EXECUTION: "EXECUTION_AGENT_MANAGER", SEARCH: "SEARCH_AGENT_MANAGER" };

export function createBrainMasterBridge({ master, brain, dir, now = () => new Date().toISOString(), maxDispatchRounds = 3 } = {}) {
  if (!master || typeof master.enqueue !== "function") throw new Error("MASTER_REQUIRED");
  if (!brain || !brain.central || !brain.governance) throw new Error("BRAIN_REQUIRED");
  if (!dir) throw new Error("DIR_REQUIRED");
  const trace = createAuditChain({ filePath: path.join(dir, "brain-master-workflows.jsonl"), headPinFile: path.join(dir, "brain-master-workflows.headpin.json"), now });
  const R = (stage, reason, extra = {}) => ({ ok: false, failedStage: stage, reason, ...extra });

  /** Any unexpected exception becomes a recorded, named failure (never an unhandled rejection and never a silent half-run). */
  async function runWorkflow(args = {}) {
    try { return await runWorkflowInner(args); }
    catch (e) { const reason = "WORKFLOW_EXCEPTION:" + String(e?.code ?? e?.message ?? e).slice(0, 80); try { trace.append("WORKFLOW_STAGE", { workflowId: "wf-exception", stage: "INTERNAL", ok: false, reason }); } catch { /* trace unwritable: the caller still gets the failure */ } return R("INTERNAL", reason, { workflowId: null, stages: [] }); }
  }
  async function runWorkflowInner({ requestedBy, request, planId, stepId, priority = 9 } = {}) {
    const wf = "wf-" + crypto.randomBytes(5).toString("hex"), stages = [];
    const mark = (stage, ok, detail = {}) => { stages.push({ stage, ok, at: now(), ...detail }); trace.append("WORKFLOW_STAGE", { workflowId: wf, stage, ok, ...detail }); try { brain.blackBox.record({ kind: "WORKFLOW_" + stage, correlationId: wf, decision: ok ? "OK" : "STOP", reason: detail.reason ?? null }); } catch { /* the trace above is the evidence; black box is secondary */ } };
    const stop = (stage, reason, extra = {}) => { mark(stage, false, { reason, ...extra }); return { ...R(stage, reason, extra), workflowId: wf, stages }; };
    // 1 OWNER - the request itself. The caller (HTTP layer / owner command) has already authenticated the owner; a request without an owner identity is refused.
    if (requestedBy !== "OWNER") return stop("OWNER", "OWNER_IDENTITY_REQUIRED");
    if (typeof request !== "string" || request.trim().length < 3) return stop("OWNER", "REQUEST_TEXT_REQUIRED");
    mark("OWNER", true, { request: request.slice(0, 200), planId, stepId });
    // 2 MASTER - queue (conflict, gate and owner-stop rules are the Master's)
    const q = master.enqueue({ planId, stepId, priority, note: "brain workflow " + wf }); if (!q.ok) return stop("MASTER", q.reason ?? "ENQUEUE_REFUSED");
    mark("MASTER", true, { jobId: q.jobId });
    const abort = (stage, reason, extra) => { try { master.cancel(q.jobId); } catch { /* best effort: job stays QUEUED and is visible */ } return stop(stage, reason, extra); };
    // 3 BRAIN - decision brief (advice only) + governance (kill switch, safe mode, owner-control chain) + security status
    const job = master.jobs().find(j => j.id === q.jobId);
    let brief; try { brief = brain.central.decide({ what: request.slice(0, 200), why: "owner request via Master", capabilities: [], governanceAction: "EXECUTE_TASK", external: false, estCostUsd: 0, reversible: true, successCriteria: "independent verifier ACCEPT" }); } catch (e) { return abort("BRAIN", "DECISION_FAILED:" + String(e?.message ?? e).slice(0, 80)); }
    const gov = brain.governance.authorize({ brain: "CENTRAL", action: "EXECUTE_TASK", external: false, spendUsd: 0, subject: q.jobId });
    if (!gov.allowed) return abort("BRAIN", "GOVERNANCE_" + gov.decision + ":" + gov.reason);
    const sec = brain.security.status();
    mark("BRAIN", true, { governance: gov.decision, ownerApprovalRequired: brief.ownerApprovalRequired, risks: brief.expected?.risks ?? [], security: sec?.mode ?? sec?.state ?? "STATUS_OK" });
    // 4 MANAGER - the responsible manager must be live (CONNECTED), otherwise the work is not started
    const team = "EXECUTION", mid = MANAGER_FOR[team];
    const st = await master.status(); const mgr = (st.managers ?? []).find(m => m.id === mid);
    if (!mgr || mgr.status !== "CONNECTED") return abort("MANAGER", mid + "_" + (mgr?.status ?? "UNKNOWN"));
    mark("MANAGER", true, { manager: mid, health: mgr.health });
    // 5 AGENT / 6 TOOL - the Master dispatches (the control chain is asked inside dispatch); the agent runs the plan step's executor
    let disp = null;
    for (let i = 0; i < maxDispatchRounds && !disp; i++) { const d = await master.dispatch({ max: 1 }); if (!d.ok) return abort("AGENT", d.reason ?? "DISPATCH_REFUSED"); if (d.held) return abort("AGENT", "DISPATCH_HELD:" + d.held); disp = d.dispatched.find(x => x.jobId === q.jobId) ?? null; if (!d.dispatched.length) break; }
    if (!disp) { const j = master.jobs().find(x => x.id === q.jobId); return abort("AGENT", "NOT_DISPATCHED:" + (j?.note ?? j?.state ?? "UNKNOWN")); }
    mark("AGENT", true, { agentId: disp.agentId, taskId: disp.taskId });
    mark("TOOL", true, { tool: job?.executor ?? null, taskId: disp.taskId });
    // 7 VERIFIER - independent checker (the maker never checks its own work)
    const v = await master.verifyPending(); const mine = (v.checked ?? []).find(x => x.taskId === disp.taskId);
    if (!mine) return stop("VERIFIER", "NOT_VERIFIED_YET", { jobId: q.jobId, taskId: disp.taskId });
    if (mine.decision !== "ACCEPT") return stop("VERIFIER", "CHECKER_" + mine.decision, { checker: mine.checker, jobId: q.jobId });
    if (mine.checker === disp.agentId) return stop("VERIFIER", "SELF_CHECK_FORBIDDEN");
    mark("VERIFIER", true, { checker: mine.checker, maker: disp.agentId, decision: mine.decision });
    // 8 MASTER_RECORD - the Master's own completion record must exist for this task
    const rec = master.auditEntries().some(e => e.event === "TASK_COMPLETION_RECORDED" && e.data?.taskId === disp.taskId);
    if (!rec) return stop("MASTER_RECORD", "COMPLETION_NOT_RECORDED");
    mark("MASTER_RECORD", true, { jobId: q.jobId, state: master.jobs().find(x => x.id === q.jobId)?.state });
    // 9 CONTROL CENTER - what the panel shows; the trace head proves the sequence was not edited afterwards
    mark("CONTROL_CENTER", true, { visibleAs: "Master queue job " + q.jobId + " + workflow " + wf });
    return { ok: true, workflowId: wf, jobId: q.jobId, taskId: disp.taskId, agentId: disp.agentId, checker: mine.checker, stages, traceHead: trace.entries().at(-1)?.hash ?? null };
  }
  const workflows = (limit = 20) => { const by = new Map(); for (const e of trace.entries()) { const d = e.data ?? e.payload ?? e; const id = d.workflowId; if (!id) continue; (by.get(id) ?? by.set(id, []).get(id)).push({ stage: d.stage, ok: d.ok, at: e.at ?? d.at, reason: d.reason ?? null }); } return [...by.entries()].slice(-limit).map(([id, stages]) => ({ id, ok: stages.length === STAGES.length && stages.every(s => s.ok), stages })); };
  return { runWorkflow, workflows, verify: () => trace.verify(), STAGES };
}
