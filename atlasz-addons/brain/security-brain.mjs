// Security Brain (V7.3 Brain §8). Classifies events into ALLOW / WARN / REQUIRE_APPROVAL / QUARANTINE / BLOCK / ENTER_SAFE_MODE.
// It can only make the system MORE restrictive. It has no API to grant permissions, approve anything or lower a control;
// releasing a quarantine needs a signed owner approval. It is itself subordinate to the owner.
import { redactSecrets } from "./black-box.mjs";

export const DECISIONS = Object.freeze(["ALLOW", "WARN", "REQUIRE_APPROVAL", "QUARANTINE", "BLOCK", "ENTER_SAFE_MODE"]);
const INJECTION = [/ignore (all |any |the )?(previous|prior|above) (instructions|rules)/i, /disregard (your|the) (rules|instructions|policy)/i, /you are now (in )?(developer|dan|admin|root) mode/i, /system prompt/i, /reveal (your )?(secrets?|keys?|credentials|instructions)/i,
  /(disable|turn off|bypass) (the )?(kill ?switch|approval|audit|safe ?mode|firewall)/i, /(send|transfer|wire|pay) .{0,40}(money|funds|\$\d|usd|eur)/i, /(do not|don't) (tell|inform|notify) (joci|the owner)/i];
const NEVER_GRANT = ["OWNER_AUTH", "SECRETS_ALL", "KILL_SWITCH", "AUDIT_WRITE", "PAYMENTS", "BANKING", "SPEND", "SAFE_MODE_DISABLE"];
const BYPASS_KINDS = new Set(["KILL_SWITCH_BYPASS_ATTEMPT", "APPROVAL_BYPASS_ATTEMPT", "AUDIT_DISABLE_ATTEMPT"]);

export function createSecurityBrain({ ownerAuth, safeMode = null, blackBox = null, now = () => new Date().toISOString(), costGrowthWarn = 2, costGrowthApproval = 4, injectionStrikes = 2 } = {}) {
  if (!ownerAuth) throw new Error("OWNER_AUTH_REQUIRED");
  const quarantined = new Map(), strikes = new Map(), costBase = new Map(), events = [];
  const rec = (d, e) => { const r = { at: now(), decision: d.decision, kind: e.kind, agentId: e.agentId ?? null, reasons: d.reasons }; events.push(r); if (events.length > 1000) events.shift(); blackBox?.record({ kind: "SECURITY_" + d.decision, agentId: e.agentId, decision: d.decision, reason: d.reasons.join(",") }); return r; };
  function quarantine(agentId, reason) { if (agentId && !quarantined.has(agentId)) quarantined.set(agentId, { since: now(), reason }); }
  /** e: {kind, agentId?, text?, permission?, requested?, cost?, baseline?, auditOk?, approvedChangeId?, changeId?, amountUsd?, financialKind?} */
  function assess(e = {}) {
    const reasons = []; let decision = "ALLOW", safe = null;
    const up = d => { if (DECISIONS.indexOf(d) > DECISIONS.indexOf(decision)) decision = d; };
    if (e.agentId && quarantined.has(e.agentId)) { reasons.push("AGENT_QUARANTINED"); up("BLOCK"); }
    switch (e.kind) {
      case "EXTERNAL_INSTRUCTION": case "AGENT_OUTPUT": case "CONNECTOR_CONTENT": {
        const t = String(e.text ?? ""), hit = INJECTION.filter(p => p.test(t));
        if (hit.length) { reasons.push("PROMPT_INJECTION_PATTERN"); up("QUARANTINE"); const key = e.source ?? e.agentId ?? "?", n = (strikes.get(key) ?? 0) + 1; strikes.set(key, n); if (n >= injectionStrikes && e.agentId) { quarantine(e.agentId, "REPEATED_INJECTION"); reasons.push("REPEAT_OFFENDER"); } }
        if (redactSecrets(t) !== t) { reasons.push("SECRET_EXPOSURE_RISK"); up("BLOCK"); }
        break; }
      case "PRIVILEGE_REQUEST": {
        const p = String(e.permission ?? "").toUpperCase();
        if (NEVER_GRANT.includes(p)) { reasons.push("NEVER_GRANTABLE:" + p); up("BLOCK"); quarantine(e.agentId, "FORBIDDEN_PRIVILEGE_REQUEST"); } else { reasons.push("PRIVILEGE_ESCALATION_NEEDS_OWNER"); up("REQUIRE_APPROVAL"); }
        break; }
      case "CREDENTIAL_USE": if (!e.expectedPurpose || e.purpose !== e.expectedPurpose) { reasons.push("CREDENTIAL_PURPOSE_MISMATCH"); up("BLOCK"); } break;
      case "CONNECTOR_USE": if (e.allowedHosts && e.host && !e.allowedHosts.includes(e.host)) { reasons.push("CONNECTOR_HOST_NOT_ALLOWED"); up("BLOCK"); } if (e.mutating === true && !e.approved) { reasons.push("MUTATING_CONNECTOR_CALL_NEEDS_APPROVAL"); up("REQUIRE_APPROVAL"); } break;
      case "COST_SAMPLE": {
        const base = e.baseline ?? costBase.get(e.agentId ?? "*"); if (base === undefined) { costBase.set(e.agentId ?? "*", Number(e.cost)); break; }
        if (e.noSpendMode && Number(e.cost) > 0) { reasons.push("SPEND_IN_NO_SPEND_MODE"); up("BLOCK"); }
        else if (Number(base) > 0) { const r = Number(e.cost) / Number(base); if (r >= costGrowthApproval) { reasons.push("COST_GROWTH_x" + r.toFixed(1)); up("REQUIRE_APPROVAL"); } else if (r >= costGrowthWarn) { reasons.push("COST_GROWTH_x" + r.toFixed(1)); up("WARN"); } }
        else if (Number(e.cost) > 0) { reasons.push("COST_FROM_ZERO_BASELINE"); up("WARN"); }
        break; }
      case "FINANCIAL_ACTION": if (["BANK_TRANSFER", "LOAN", "CREDIT", "WITHDRAWAL"].includes(e.financialKind)) { reasons.push("BANKING_ACTION_FORBIDDEN_FOR_AGENTS"); up("BLOCK"); } else { reasons.push("FINANCIAL_ACTION_NEEDS_OWNER"); up("REQUIRE_APPROVAL"); } break;
      case "CONFIG_CHANGE": if (!e.changeId || e.changeId !== e.approvedChangeId) { reasons.push("UNAPPROVED_CONFIG_CHANGE"); up("REQUIRE_APPROVAL"); } break;
      case "AUDIT_CHECK": if (e.auditOk !== true) { reasons.push("AUDIT_CHAIN_INVALID"); up("ENTER_SAFE_MODE"); } break;
      default: if (BYPASS_KINDS.has(e.kind)) { reasons.push(e.kind); up("ENTER_SAFE_MODE"); quarantine(e.agentId, e.kind); } else if (!e.kind) { reasons.push("UNKNOWN_EVENT"); up("WARN"); }
    }
    if (decision === "ENTER_SAFE_MODE" && safeMode?.enter) { try { safe = safeMode.enter("SECURITY_BRAIN:" + reasons.join(","), { agentId: e.agentId ?? null }); } catch (x) { reasons.push("SAFE_MODE_ENTER_FAILED:" + String(x.message).slice(0, 60)); } }
    const d = { decision, reasons, safeModeEntered: Boolean(safe), allowed: decision === "ALLOW" || decision === "WARN", redactedText: e.text !== undefined ? redactSecrets(String(e.text)) : undefined };
    rec(d, e); return d;
  }
  function release(agentId, ownerApproval) {
    if (!quarantined.has(agentId)) return { released: false, reason: "NOT_QUARANTINED" };
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "SECURITY_RELEASE_QUARANTINE", subject: agentId });
    if (!v.allowed) return { released: false, reason: "OWNER_APPROVAL_REQUIRED" };
    quarantined.delete(agentId); strikes.delete(agentId); return { released: true };
  }
  return { assess, release, isQuarantined: id => quarantined.has(id), quarantine: () => [...quarantined].map(([agentId, v]) => ({ agentId, ...v })), recent: () => events.slice(-100), status: () => ({ quarantined: quarantined.size, events: events.length, canGrantPermissions: false }) };
}
