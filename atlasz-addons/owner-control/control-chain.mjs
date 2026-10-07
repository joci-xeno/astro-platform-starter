// ATLASZ unified control chain (V7.3 Owner Control §1, §7). ONE evaluation path that every consequential action takes:
//   OWNER AUTHORITY → KILL SWITCH → SAFE MODE → SECURITY BRAIN → FINANCIAL FIREWALL → OWNER APPROVAL → (execute) → BLACK BOX
// followed by INDEPENDENT VERIFICATION of the outcome (verifyOutcome). Layers can only make a decision STRICTER; none can loosen another.
// FAIL CLOSED: unknown operation, unreadable kill-switch/safe-mode state, missing security layer for a risky action, or any layer that
// throws => BLOCK. Read-only and recovery operations (doctor, backup verification, restore points) stay available during an
// emergency stop / Safe Mode so Joci can inspect and recover.
import { actionSubject, approvalActionName, NEVER_FOR_NON_OWNER } from "./owner-authority.mjs";

export const VERDICTS = Object.freeze(["ALLOW", "WARN", "REQUIRE_APPROVAL", "BLOCK"]);
export const ACTOR_TYPES = Object.freeze(["OWNER", "AGENT", "BRAIN", "MODEL", "COMPUTER_USE", "CONNECTOR", "MONEY_ENGINE", "BUSINESS_FACTORY", "WORKFLOW", "SCHEDULER", "TOOL", "SIMULATION", "SYSTEM"]);

/** Every route that can cause an action. Each is registered with the chain and exercised by the kill-switch coverage test. */
export const CONTROLLED_PATHS = Object.freeze([
  ["agents.runtime.30", "AGENT", "INTERNAL_COMPUTE", false], ["agents.external", "AGENT", "SEND_EXTERNAL", true],
  ["brain.orchestrator", "BRAIN", "INTERNAL_BRAIN_ACTION", false], ["brain.planning", "BRAIN", "INTERNAL_BRAIN_ACTION", false],
  ["brain.capability_graph", "BRAIN", "INTERNAL_BRAIN_ACTION", false], ["brain.knowledge", "BRAIN", "INTERNAL_BRAIN_ACTION", false],
  ["brain.simulation", "SIMULATION", "SIMULATE", false], ["brain.verification", "BRAIN", "INTERNAL_BRAIN_ACTION", false],
  ["brain.security", "BRAIN", "INTERNAL_BRAIN_ACTION", false], ["brain.opportunity", "BRAIN", "INTERNAL_BRAIN_ACTION", false],
  ["brain.business_factory", "BUSINESS_FACTORY", "INTERNAL_BRAIN_ACTION", false], ["brain.observability", "BRAIN", "INTERNAL_BRAIN_ACTION", false],
  ["brain.owner_command", "BRAIN", "INTERNAL_BRAIN_ACTION", false], ["brain.model_router", "BRAIN", "INTERNAL_BRAIN_ACTION", false],
  ["brain.health", "BRAIN", "INTERNAL_BRAIN_ACTION", false],
  ["brain.external_action", "BRAIN", "PUBLISH", true], ["model.external_action", "MODEL", "SEND_EXTERNAL", true],
  ["computer_use", "COMPUTER_USE", "COMPUTER_USE_CONSEQUENTIAL", true], ["connectors.mutating", "CONNECTOR", "SEND_EXTERNAL", true],
  ["outbound.communications", "TOOL", "SEND_EXTERNAL", true], ["money_engine.external", "MONEY_ENGINE", "MONEY_APPROVE_SEND", true],
  ["business_factory.external", "BUSINESS_FACTORY", "PUBLISH", true], ["workflow.automated", "WORKFLOW", "INTERNAL_COMPUTE", false],
  ["workflow.external", "WORKFLOW", "SEND_EXTERNAL", true], ["scheduler.action", "SCHEDULER", "INTERNAL_COMPUTE", false],
  ["scheduler.external", "SCHEDULER", "SEND_EXTERNAL", true], ["tool.external_execution", "TOOL", "SEND_EXTERNAL", true],
].map(([id, actor, operation, external]) => Object.freeze({ id, actor, operation, external })));

export function createControlChain({ authority, gate, safeMode = null, security = null, firewall = null, blackBox = null, verifier = null, isolation = null, now = () => new Date().toISOString() } = {}) {
  if (!authority) throw new Error("OWNER_AUTHORITY_REQUIRED");
  if (typeof gate !== "function") throw new Error("KILL_SWITCH_GATE_REQUIRED");
  const paths = new Map();
  const tally = { evaluated: 0, ALLOW: 0, WARN: 0, REQUIRE_APPROVAL: 0, BLOCK: 0 };

  function evaluate(req = {}, { verifyApproval = true } = {}) {
    const trace = [];
    let verdict = "ALLOW", layer = null, reason = "ALL_LAYERS_PASSED", needApproval = false;
    const step = (l, v, r) => { trace.push({ layer: l, verdict: v, reason: r }); if (VERDICTS.indexOf(v) > VERDICTS.indexOf(verdict)) { verdict = v; layer = l; reason = r; } };
    const actor = { type: ACTOR_TYPES.includes(req.actor?.type) ? req.actor.type : "UNKNOWN", id: req.actor?.id ?? null };
    const spend = Number(req.spendUsd ?? 0);
    const op = authority.classify(req.operation);
    const params = { ...(req.params ?? {}), ...(spend > 0 ? { spendUsd: spend } : {}) };
    const subject = op.known && !op.forbidden ? actionSubject(op.operation, params) : null;
    try {
      // 1 OWNER AUTHORITY
      if (op.forbidden) step("OWNER_AUTHORITY", "BLOCK", "FORBIDDEN_ATTEMPT:" + op.operation);
      else if (!op.known) step("OWNER_AUTHORITY", "BLOCK", "UNKNOWN_OPERATION_FAIL_CLOSED");
      else if (actor.type === "UNKNOWN") step("OWNER_AUTHORITY", "BLOCK", "UNKNOWN_ACTOR_FAIL_CLOSED");
      else if (NEVER_FOR_NON_OWNER.includes(op.operation) && actor.type !== "OWNER") step("OWNER_AUTHORITY", "BLOCK", "OPERATION_RESERVED_FOR_OWNER");
      else if (actor.type === "SIMULATION" && (op.external || spend > 0)) step("OWNER_AUTHORITY", "BLOCK", "SIMULATION_NEVER_EXECUTES_LIVE");
      else if (!Number.isFinite(spend) || spend < 0) step("OWNER_AUTHORITY", "BLOCK", "INVALID_SPEND");
      else step("OWNER_AUTHORITY", "ALLOW", op.requiresOwner ? "OWNER_APPROVAL_REQUIRED_CLASS:" + op.category : "NO_OWNER_APPROVAL_CLASS");
      const external = Boolean(op.external) || Boolean(req.external) || spend > 0;
      const exempt = op.readOnly === true || op.recovery === true;
      if (verdict !== "BLOCK" && isolation) { const iso = isolation.check({ moduleId: req.moduleId, workflowId: req.workflowId }); if (iso.blocked) step("SAFE_MODE", "BLOCK", iso.reason); }
      // 2 KILL SWITCH
      if (!exempt && verdict !== "BLOCK") {
        const g = gate({ external });
        if (!g || typeof g.allowed !== "boolean") step("KILL_SWITCH", "BLOCK", "KILL_SWITCH_STATE_UNKNOWN");
        else if (!g.allowed) step("KILL_SWITCH", "BLOCK", "EMERGENCY_STOP_ACTIVE:" + (g.reason ?? ""));
        else step("KILL_SWITCH", "ALLOW", "RUNNING");
      }
      // 3 SAFE MODE
      if (!exempt && verdict !== "BLOCK") {
        if (!safeMode) { if (external) step("SAFE_MODE", "BLOCK", "SAFE_MODE_STATE_UNKNOWN"); }
        else { const s = safeMode.gate({ external, write: true }); if (!s || typeof s.allowed !== "boolean") step("SAFE_MODE", "BLOCK", "SAFE_MODE_STATE_UNKNOWN"); else if (!s.allowed) step("SAFE_MODE", "BLOCK", s.reason ?? "SAFE_MODE"); else step("SAFE_MODE", "ALLOW", "NORMAL"); }
      }
      // 4 SECURITY BRAIN (cannot grant authority: it can only tighten)
      if (verdict !== "BLOCK" && !op.readOnly && (external || op.requiresOwner || op.risk === "HIGH" || op.risk === "CRITICAL" || req.securityEvent)) {
        if (!security) step("SECURITY_BRAIN", "BLOCK", "SECURITY_STATUS_UNKNOWN");
        else {
          const a = security.assess({ kind: "CHAIN_CHECK", agentId: actor.id, ...(req.securityEvent ?? {}) });
          if (["BLOCK", "QUARANTINE", "ENTER_SAFE_MODE"].includes(a.decision)) step("SECURITY_BRAIN", "BLOCK", a.decision + ":" + a.reasons.join(","));
          else if (a.decision === "REQUIRE_APPROVAL") { needApproval = true; step("SECURITY_BRAIN", "REQUIRE_APPROVAL", a.reasons.join(",")); }
          else step("SECURITY_BRAIN", a.decision === "WARN" ? "WARN" : "ALLOW", a.reasons.join(",") || "CLEAR");
        }
      }
      // 5 FINANCIAL FIREWALL (NO-SPEND default)
      if (verdict !== "BLOCK" && (spend > 0 || op.category === "SPENDING")) {
        if (!firewall) step("FINANCIAL_FIREWALL", spend > 0 ? "BLOCK" : "REQUIRE_APPROVAL", "FIREWALL_UNAVAILABLE");
        else { const f = firewall.check({ spendUsd: spend, scopeId: req.budgetScope ?? null }); if (f.verdict === "BLOCK") step("FINANCIAL_FIREWALL", "BLOCK", f.reason); else if (f.verdict === "REQUIRE_APPROVAL") { needApproval = true; step("FINANCIAL_FIREWALL", "REQUIRE_APPROVAL", f.reason); } else step("FINANCIAL_FIREWALL", "ALLOW", f.reason); }
      }
      // 6 OWNER APPROVAL (exact action, time-bound, single use)
      if (verdict !== "BLOCK" && (op.requiresOwner || needApproval)) {
        if (!verifyApproval) step("OWNER_APPROVAL", "REQUIRE_APPROVAL", "APPROVAL_CHECK_DEFERRED_TO_CALLER");
        else if (!req.ownerApproval) step("OWNER_APPROVAL", "REQUIRE_APPROVAL", "NO_OWNER_APPROVAL_PRESENTED");
        else {
          const v = authority.verify({ operation: op.operation, params, approval: req.ownerApproval });
          if (v.allowed) { trace.push({ layer: "OWNER_APPROVAL", verdict: "ALLOW", reason: "APPROVAL_VALID_FOR_EXACT_ACTION" }); if (verdict === "REQUIRE_APPROVAL") { verdict = "ALLOW"; layer = "OWNER_APPROVAL"; reason = "OWNER_APPROVED_EXACT_ACTION"; } }
          else step("OWNER_APPROVAL", "BLOCK", "APPROVAL_REJECTED:" + v.reason);
        }
      }
    } catch (e) { step("CHAIN", "BLOCK", "LAYER_ERROR_FAIL_CLOSED:" + String(e?.message ?? e).slice(0, 80)); }
    tally.evaluated++; tally[verdict]++;
    const decision = { verdict, allowed: verdict === "ALLOW" || verdict === "WARN", layer, reason, trace, actor, operation: op.operation ?? String(req.operation), subject,
      approvalRequired: verdict === "REQUIRE_APPROVAL" ? { operation: op.operation, subject, approvalAction: approvalActionName(op.operation) } : null };
    if (blackBox) { try { decision.correlationId = blackBox.record({ kind: "CONTROL_DECISION", agentId: actor.id, decision: verdict, reason: `${layer ?? "-"}:${reason}`, tool: decision.operation, workflow: req.pathId ?? null, approval: req.ownerApproval ? { nonce: req.ownerApproval.nonce ?? null } : null, costUsd: spend > 0 ? spend : undefined, correlationId: req.correlationId }).correlationId; } catch { /* recording failure must not loosen a decision */ if (decision.allowed) { decision.verdict = "BLOCK"; decision.allowed = false; decision.layer = "BLACK_BOX"; decision.reason = "BLACK_BOX_UNAVAILABLE_FAIL_CLOSED"; } } }
    return decision;
  }

  function registerPath(def) { if (!def?.id || !ACTOR_TYPES.includes(def.actor)) throw new Error("INVALID_PATH"); paths.set(def.id, Object.freeze({ ...def })); }
  function registerStandardPaths() { for (const p of CONTROLLED_PATHS) registerPath(p); return paths.size; }
  /** Run fn only if the chain allows the registered path. fn never runs on BLOCK / REQUIRE_APPROVAL. */
  function run(pathId, { ownerApproval = null, params = {}, spendUsd = 0, securityEvent } = {}, fn) {
    const p = paths.get(pathId);
    if (!p) { const d = evaluate({ operation: "UNREGISTERED_PATH", actor: { type: "SYSTEM", id: pathId }, pathId }); return { executed: false, decision: d, result: null }; }
    const d = evaluate({ actor: { type: p.actor, id: pathId }, operation: p.operation, external: p.external, params, spendUsd, ownerApproval, securityEvent, pathId });
    if (!d.allowed) return { executed: false, decision: d, result: null };
    return { executed: true, decision: d, result: fn() };
  }
  /** Independent verification of an outcome claim. No verifier or no evidence source => NOT VERIFIED (never assumed true). */
  function verifyOutcome(p = {}) {
    if (!verifier) return { verdict: "ESCALATE", reason: "NO_VERIFIER_NOT_VERIFIED", independent: false };
    const r = verifier.verify(p);
    if (blackBox) { try { blackBox.record({ kind: "OUTCOME_VERIFICATION", agentId: p.executorId, decision: r.verdict, reason: r.reason, verification: r.verdict }); } catch { /* ignore */ } }
    return r;
  }
  return { evaluate, run, registerPath, registerStandardPaths, paths: () => [...paths.values()], tally: () => ({ ...tally }), verifyOutcome, subjectFor: (operation, params = {}, spendUsd = 0) => actionSubject(String(operation).toUpperCase(), { ...params, ...(Number(spendUsd) > 0 ? { spendUsd: Number(spendUsd) } : {}) }) };
}
