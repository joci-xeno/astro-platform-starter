// M2 - the ONLY path from one of the 30 agents to a typed tool. Layers: fixed roster -> job/refusal state -> kill switch -> per-agent rate -> role policy (deny by default,
// re-validated against the really registered tool) -> per-tool limits -> concurrency -> tools.invoke (control chain: owner authority, kill switch, safe mode, security, firewall,
// owner approval, black box) -> result cap. The broker can only make things stricter. It never throws, never accepts an owner approval from a caller, never changes a limit at runtime.
import { createHash } from "node:crypto";
import { roleOf, permissionFor, TOOL_POLICY, DEFAULT_LIMITS, SAFE_AGENT_OPERATIONS, NEVER_FOR_AGENTS } from "./agent-tool-policy.mjs";

const HOUR = 3600000, MIN = 60000, DAY = 24 * HOUR;
const hashOf = v => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex").slice(0, 16);

export function createAgentToolBroker({ tools, blackBox = null, approvalRequests = null, approvalAction = null, approvalSubject = null, isStopped = () => false, onSignal = () => {}, now = () => Date.now(), limits = DEFAULT_LIMITS, policy = TOOL_POLICY } = {}) {
  if (!tools || typeof tools.invoke !== "function" || typeof tools.inspect !== "function") throw new Error("TOOLS_REQUIRED");
  const L = limits, win = new Map(), jobs = new Map(), consumed = new Map();
  let inflight = 0; const stats = { calls: 0, ok: 0, refused: 0, rateLimited: 0, pendingApproval: 0 };
  const log = d => { try { blackBox?.record({ kind: "AGENT_TOOL_CALL", jobId: d.job, agentId: d.agentId, team: roleOf(d.agentId) ?? undefined, tool: d.tool, decision: d.status, reason: d.reason, inputRef: d.argsHash }); } catch { /* audit failure never changes the verdict */ } };
  const stamp = (key, span) => { const t = now(), a = (win.get(key) ?? []).filter(x => t - x < span); win.set(key, a); return a; };
  const count = (key, span) => stamp(key, span).length;
  const hit = (key, span) => { stamp(key, span).push(now()); };
  const job = (jobId) => { let j = jobs.get(jobId); if (!j) { if (jobs.size >= 5000) jobs.delete(jobs.keys().next().value); j = { calls: 0, writes: 0, perTool: {}, streak: 0, suspended: false }; jobs.set(jobId, j); } return j; };

  function entryCheck(name) {                                              // D1: every call re-validates the policy entry against the registered tool
    const e = policy[name], t = tools.inspect(name);
    if (!e || !t) return "TOOL_NOT_LISTED_OR_NOT_REGISTERED";
    if (t.operation !== e.operation) return "OPERATION_CHANGED";
    if (t.spendUsd !== 0) return "TOOL_SPENDS";
    return null;
  }
  function describeFor(agentId) {
    const role = roleOf(agentId); if (!role) return [];
    return tools.describe().filter(t => permissionFor(role, t.name, policy) !== "DENY" && !policy[t.name]?.disabled && !entryCheck(t.name)).map(t => ({ name: t.name, description: t.description, parameters: t.parameters, permission: permissionFor(role, t.name, policy) }));
  }

  async function call({ agentId, jobId, tool, args = {} } = {}) {
    stats.calls++;
    const base = { agentId: String(agentId ?? "").slice(0, 40), job: String(jobId ?? "").slice(0, 80), tool: String(tool ?? "").slice(0, 80), argsHash: hashOf(args) };
    const j = typeof jobId === "string" && jobId && jobId.length <= 80 ? job(jobId) : null;
    let streakKind = null;
    const out = (status, extra = {}) => {
      if (status === "OK") stats.ok++; else if (status === "RATE_LIMITED") stats.rateLimited++; else if (status === "PENDING_OWNER_APPROVAL") stats.pendingApproval++; else stats.refused++;
      if (j) {
        if (streakKind === "REFUSAL") { j.streak++; if (j.streak >= L.refusalStreak && !j.suspended) { j.suspended = true; try { onSignal({ type: "BYPASS_ATTEMPT", agentId: base.agentId, jobId: base.job, refusals: j.streak }); } catch { /* signal is best effort */ } log({ ...base, status: "JOB_SUSPENDED", reason: "REPEATED_REFUSALS" }); } }
        else if (streakKind === "RESET") j.streak = 0;
      }
      log({ ...base, status, ...(extra.reason ? { reason: extra.reason } : {}) });
      return { status, agentId: base.agentId, tool: base.tool, ...extra };
    };
    const role = roleOf(agentId);
    if (!role) return out("DENIED", { reason: "UNKNOWN_AGENT" });                                // fixed topology: a 31st id (or any forged id) is refused
    if (!j) return out("INVALID_ARGUMENTS", { reason: "JOB_ID_REQUIRED" });
    if (typeof tool !== "string" || !tool) return out("INVALID_ARGUMENTS", { reason: "TOOL_REQUIRED" });
    if (j.suspended) return out("DENIED", { reason: "JOB_SUSPENDED" });
    let stopped = false; try { stopped = Boolean(isStopped()); } catch { stopped = true; }
    if (stopped) return out("DENIED", { reason: "OWNER_STOP_OR_SAFE_MODE_ACTIVE" });
    // every attempt counts against the agent's own windows, so a flood of refused calls cannot bypass the limit
    if (count("a:" + agentId + ":m", MIN) >= L.perAgentPerMinute) return out("RATE_LIMITED", { reason: "AGENT_PER_MINUTE" });
    if (count("a:" + agentId + ":h", HOUR) >= L.perAgentPerHour) return out("RATE_LIMITED", { reason: "AGENT_PER_HOUR" });
    hit("a:" + agentId + ":m", MIN); hit("a:" + agentId + ":h", HOUR);
    const perm = permissionFor(role, tool, policy);
    if (perm === "DENY") { streakKind = "REFUSAL"; return out("DENIED", { reason: "TOOL_NOT_ALLOWED_FOR_ROLE" }); }
    const bad = entryCheck(tool); if (bad) { streakKind = "REFUSAL"; return out("DENIED", { reason: "POLICY_MISMATCH:" + bad }); }
    if (policy[tool].disabled) return out("DENIED", { reason: "TOOL_DISABLED:" + policy[tool].disabled });
    if (!args || typeof args !== "object" || Array.isArray(args)) { streakKind = "REFUSAL"; return out("INVALID_ARGUMENTS", { reason: "ARGS_MUST_BE_OBJECT" }); }
    const tl = L.perTool[tool] ?? {};
    let a2 = args;
    if (tool === "research.add_source" && typeof args.text === "string" && args.text.length > tl.textMaxChars) { streakKind = "REFUSAL"; return out("INVALID_ARGUMENTS", { reason: "TEXT_TOO_LONG_FOR_AGENT" }); }
    if (tool === "model.complete" && typeof args.prompt === "string" && args.prompt.length > tl.promptMaxChars) { streakKind = "REFUSAL"; return out("INVALID_ARGUMENTS", { reason: "PROMPT_TOO_LONG_FOR_AGENT" }); }
    if (tool === "sandbox.run" && tl.timeoutMsCap) a2 = { ...args, timeoutMs: Math.min(Number.isInteger(args.timeoutMs) ? args.timeoutMs : tl.timeoutMsCap, tl.timeoutMsCap) };
    // job / tool / global budgets (checked together, consumed together only once all pass)
    const pj = j.perTool[tool] ?? 0;
    if (j.calls >= L.perJob) return out("RATE_LIMITED", { reason: "JOB_TOTAL" });
    if (policy[tool].write && j.writes >= L.perJobWrites) return out("RATE_LIMITED", { reason: "JOB_WRITES" });
    if (tl.perJob !== undefined && pj >= tl.perJob) return out("RATE_LIMITED", { reason: "TOOL_PER_JOB" });
    if (tl.perAgentPerHour !== undefined && count("t:" + tool + ":" + agentId, HOUR) >= tl.perAgentPerHour) return out("RATE_LIMITED", { reason: "TOOL_PER_AGENT_HOUR" });
    if (tl.globalPerDay !== undefined && count("t:" + tool + ":g", DAY) >= tl.globalPerDay) return out("RATE_LIMITED", { reason: "TOOL_GLOBAL_DAY" });
    if (count("g:h", HOUR) >= L.globalPerHour) return out("RATE_LIMITED", { reason: "GLOBAL_PER_HOUR" });
    if (inflight >= L.globalConcurrency) return out("RATE_LIMITED", { reason: "GLOBAL_CONCURRENCY" });
    // approval-class tool: the agent only ever ASKS; the signed approval comes from the owner's decision, never from the caller
    let ownerApproval = null, reqKey = null;
    if (perm === "APPROVAL") {
      if (!approvalRequests || !approvalAction || !approvalSubject) return out("DENIED", { reason: "APPROVAL_QUEUE_UNAVAILABLE" });
      const action = approvalAction(policy[tool].operation), subject = approvalSubject(policy[tool].operation, a2, 0);
      const what = `Agent ${agentId} asks to run ${tool} with arguments ${hashOf(a2)}` + (consumed.get(agentId + tool + hashOf(a2)) ? ` (use #${consumed.get(agentId + tool + hashOf(a2)) + 1})` : "");
      reqKey = agentId + tool + hashOf(a2);
      const mine = approvalRequests.list().filter(x => x.action === action && x.subject === subject && x.what === what).at(-1);
      if (mine?.status === "REJECTED") return out("DENIED", { reason: "OWNER_REJECTED", requestId: mine.id });
      if (!mine || mine.status === "EXPIRED") {
        const pend = approvalRequests.pending(); if (pend.length >= L.pendingApprovalsTotal || pend.filter(x => x.requestedBy === agentId).length >= L.pendingApprovalsPerAgent) return out("RATE_LIMITED", { reason: "PENDING_APPROVALS_LIMIT" });
        try { const r = approvalRequests.request({ action, subject, what, why: "Agent workflow needs a gated tool call.", costUsd: 0, risk: { level: "HIGH", description: "Tool is classified HIGH_RISK_CHANGE by the control chain." }, externalEffect: "Depends on the tool; see arguments hash.", reversible: false, irreversibleNote: "Effects of the tool call cannot be assumed reversible.", ifOwnerSaysNo: "The call is not executed; the job continues with other work.", noSpendAlternative: "Skip this call.", requestedBy: agentId }); hit("g:h", HOUR); j.calls++; return out("PENDING_OWNER_APPROVAL", { requestId: r.id, duplicate: r.duplicate }); } catch { return out("DENIED", { reason: "APPROVAL_REQUEST_FAILED" }); }
      }
      if (mine.status === "PENDING") return out("PENDING_OWNER_APPROVAL", { requestId: mine.id, duplicate: true });
      const oc = approvalRequests.outcome(mine.id); if (oc.decision !== "APPROVED" || !oc.approval) return out("DENIED", { reason: "NO_APPROVAL_ON_RECORD" });
      ownerApproval = oc.approval;
    }
    j.calls++; if (policy[tool].write) j.writes++; j.perTool[tool] = pj + 1; hit("g:h", HOUR); hit("t:" + tool + ":" + agentId, HOUR); if (tl.globalPerDay !== undefined) hit("t:" + tool + ":g", DAY);
    inflight++;
    let r;
    let timer;
    try {
      r = await Promise.race([tools.invoke(tool, a2, { actor: { type: "AGENT", id: agentId }, ...(ownerApproval ? { ownerApproval } : {}) }), new Promise(res => { timer = setTimeout(() => res({ status: "TIMEOUT", reason: "BROKER_CALL_TIMEOUT" }), L.perCallTimeoutMs); })]);
    } catch { r = { status: "DENIED", reason: "BROKER_ERROR_FAIL_CLOSED" }; } finally { clearTimeout(timer); inflight--; }
    if (perm === "APPROVAL" && r.status === "OK") consumed.set(reqKey, (consumed.get(reqKey) ?? 0) + 1);
    if (r.status === "REQUIRES_APPROVAL" && perm !== "APPROVAL") { streakKind = "REFUSAL"; return out("DENIED", { reason: "POLICY_MISMATCH:ALLOW_TOOL_NEEDS_APPROVAL" }); }
    if (r.status === "DENIED" || r.status === "INVALID_ARGUMENTS") streakKind = "REFUSAL"; else if (r.status === "OK") streakKind = "RESET";
    if (r.status !== "OK") return out(r.status, { ...(r.reason ? { reason: String(r.reason).slice(0, 200) } : {}), ...(r.errors ? { errors: r.errors.slice(0, 5) } : {}), ...(r.layer ? { layer: r.layer } : {}) });
    let size = 0; try { size = Buffer.byteLength(JSON.stringify(r.result ?? null)); } catch { size = Infinity; }
    if (size > L.resultMaxBytes) { let preview = ""; try { preview = JSON.stringify(r.result).slice(0, 2000); } catch { /* unserialisable */ } return out("OK", { result: null, truncated: true, originalBytes: Number.isFinite(size) ? size : null, preview, untrusted: true }); }
    return out("OK", { result: r.result, truncated: false });
  }
  function endJob(jobId) { jobs.delete(jobId); }
  const statsOut = () => ({ ...stats, inflight, jobsTracked: jobs.size, suspendedJobs: [...jobs.values()].filter(x => x.suspended).length });
  return { call, describeFor, endJob, stats: statsOut, limits: L, policyReport: () => policy, SAFE_AGENT_OPERATIONS, NEVER_FOR_AGENTS };
}
