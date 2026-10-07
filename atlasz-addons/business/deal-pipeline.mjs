// Governed deal pipeline (package §6). DISCOVERED > SCREENED > QUALIFIED > FEASIBLE > READY_FOR_OUTREACH > OUTREACH_DRAFTED > OUTREACH_APPROVED_IF_REQUIRED
// > SENT > REPLIED > NEGOTIATING > WON | LOST | BLOCKED | CANCELLED.
//  * SENT needs a communication that is really SENT (provider reference); a draft or queued message is not;
//  * REPLIED needs a stored inbound reference; a positive message is never WON;
//  * WON needs customer-acceptance evidence AND a signed owner approval (binding terms are owner decisions);
//  * the existing legacy deal-state.mjs / money-pipeline-controller.mjs are kept; this is the durable governed state machine on top.
import { createStore, needEvidence, clone } from "./store.mjs";

export const DEAL_STATUSES = Object.freeze(["DISCOVERED", "SCREENED", "QUALIFIED", "FEASIBLE", "READY_FOR_OUTREACH", "OUTREACH_DRAFTED", "OUTREACH_APPROVED_IF_REQUIRED", "SENT", "REPLIED", "NEGOTIATING", "WON", "LOST", "BLOCKED", "CANCELLED"]);
const NEXT = Object.freeze({
  DISCOVERED: ["SCREENED"], SCREENED: ["QUALIFIED"], QUALIFIED: ["FEASIBLE"], FEASIBLE: ["READY_FOR_OUTREACH"], READY_FOR_OUTREACH: ["OUTREACH_DRAFTED"],
  OUTREACH_DRAFTED: ["OUTREACH_APPROVED_IF_REQUIRED", "READY_FOR_OUTREACH"], OUTREACH_APPROVED_IF_REQUIRED: ["SENT", "OUTREACH_DRAFTED"], SENT: ["REPLIED", "LOST"],
  REPLIED: ["NEGOTIATING", "WON", "LOST"], NEGOTIATING: ["WON", "LOST", "REPLIED"], WON: [], LOST: [], CANCELLED: [], BLOCKED: []
});
const TERMINAL = new Set(["WON", "LOST", "CANCELLED"]);
const LINKS = Object.freeze({ communications: "communications", documents: "documents", costs: "costs", revenue: "revenue", evidence: "evidence" });

export function createDealPipeline({ file = null, ownerAuth, environment = "SANDBOX", lookups = {}, now = () => new Date().toISOString(), blackBox = null, outreachApprovalRequired = true } = {}) {
  if (!ownerAuth) throw new Error("OWNER_AUTH_REQUIRED");
  const S = createStore({ file, init: () => ({ deals: {} }) }), deals = () => S.data.deals;
  const must = id => { const d = deals()[id]; if (!d) throw new Error("UNKNOWN_DEAL"); return d; };
  const need = (ok, reason) => { if (!ok) throw new Error(reason); };
  const rec = (kind, d, extra = {}) => { try { blackBox?.record({ kind, resource: d.id, jobId: d.jobId ?? undefined, ...extra }); } catch { /* ignore */ } };
  const owner = (ap, action, subject) => { const v = ownerAuth.verifyApproval(ap, { action, subject }); need(v.allowed, "OWNER_APPROVAL_REQUIRED:" + action); };

  function create({ id, tenantId, entityId = null, opportunityId, source, agentId = null, summary = null } = {}) {
    if (!id || !tenantId || !opportunityId || !source) throw new Error("ID_TENANT_OPPORTUNITY_SOURCE_REQUIRED");
    if (deals()[id]) return { ...clone(deals()[id]), duplicate: true };
    const d = { id, tenantId, entityId, opportunityId, source, agentId, summary, jobId: null, status: "DISCOVERED", communications: [], documents: [], costs: [], revenue: [], evidence: [], blockedFrom: null, lostReason: null, environment, createdAt: now(), updatedAt: now(), history: [{ at: now(), from: null, to: "DISCOVERED" }] };
    deals()[id] = d; S.save(); rec("DEAL_CREATED", d, { decision: "DISCOVERED" }); return { ...clone(d), duplicate: false };
  }
  function link(id, kind, ref) { const d = must(id), k = LINKS[kind]; need(k, "UNKNOWN_LINK:" + kind); if (!d[k].some(x => JSON.stringify(x) === JSON.stringify(ref))) d[k].push(ref); d.updatedAt = now(); S.save(); return clone(d); }
  function attachJob(id, jobId, agentId = null) { const d = must(id); d.jobId = jobId; if (agentId) d.agentId = agentId; S.save(); return clone(d); }

  function transition(id, to, p = {}) {
    const d = must(id);
    need(DEAL_STATUSES.includes(to), "UNKNOWN_DEAL_STATUS");
    if (TERMINAL.has(d.status)) throw new Error("DEAL_IS_TERMINAL:" + d.status);
    if (to === "BLOCKED") { need(p.reason, "BLOCK_REASON_REQUIRED"); d.blockedFrom = d.status; return commit(d, "BLOCKED", { reason: p.reason }); }
    if (d.status === "BLOCKED") { need(to === d.blockedFrom, "BLOCKED_DEAL_RESUMES_ONLY_TO_" + d.blockedFrom); d.blockedFrom = null; return commit(d, to, { reason: "UNBLOCKED" }); }
    if (to === "CANCELLED") { need(p.reason, "CANCEL_REASON_REQUIRED"); return commit(d, "CANCELLED", { reason: p.reason }); }
    if (to === "LOST") { need(p.reason, "LOST_REASON_REQUIRED"); d.lostReason = p.reason; return commit(d, "LOST", { reason: p.reason }); }
    need((NEXT[d.status] ?? []).includes(to), `INVALID_DEAL_TRANSITION:${d.status}->${to}`);
    switch (to) {
      case "SCREENED": need(p.screen && ["ALLOW", "WARN"].includes(p.screen.decision), "SECURITY_SCREEN_ALLOW_REQUIRED"); break;
      case "QUALIFIED": need(p.qualification && Number.isFinite(Number(p.qualification.score)) && Array.isArray(p.qualification.reasons), "QUALIFICATION_WITH_SCORE_AND_REASONS_REQUIRED"); break;
      case "FEASIBLE": need(p.feasibility?.capabilityMatch === true, "CAPABILITY_MATCH_REQUIRED"); break;
      case "READY_FOR_OUTREACH": need(p.buyerRef, "BUYER_OR_CONTACT_REFERENCE_REQUIRED"); break;
      case "OUTREACH_DRAFTED": {
        need(lookups.communication, "COMMUNICATION_CENTER_NOT_CONNECTED"); const c = lookups.communication(p.communicationId);
        need(c && ["DRAFT", "APPROVAL_REQUIRED", "APPROVED", "QUEUED"].includes(c.state), "OUTREACH_DRAFT_NOT_FOUND"); d.outreachCommId = p.communicationId; link(id, "communications", p.communicationId); break;
      }
      case "OUTREACH_APPROVED_IF_REQUIRED": {
        const c = lookups.communication?.(d.outreachCommId); need(c, "OUTREACH_DRAFT_NOT_FOUND");
        if (outreachApprovalRequired || c.external) need(["APPROVED", "QUEUED"].includes(c.state) && c.approval, "OUTREACH_OWNER_APPROVAL_REQUIRED"); break;
      }
      case "SENT": {
        const c = lookups.communication?.(d.outreachCommId); need(c, "OUTREACH_DRAFT_NOT_FOUND");
        need(["SENT", "DELIVERED_IF_VERIFIABLE"].includes(c.state) && c.providerRef && c.sendEvidence, "SENT_REQUIRES_PROVIDER_SEND_EVIDENCE");     // QUEUED/DRAFT != SENT
        need(c.environment === environment, "SEND_EVIDENCE_ENVIRONMENT_MISMATCH"); d.evidence.push(clone(c.sendEvidence)); break;
      }
      case "REPLIED": need(p.inbound?.reference && p.inbound?.receivedAt, "INBOUND_REPLY_REFERENCE_REQUIRED"); d.reply = clone(p.inbound); break;
      case "NEGOTIATING": break;
      case "WON": {
        const a = p.acceptance;
        need(a && a.kind === "CUSTOMER_ACCEPTANCE" && a.reference, "CUSTOMER_ACCEPTANCE_EVIDENCE_REQUIRED");        // a positive message is not acceptance
        need(!p.inferredFromMessage, "WON_CANNOT_BE_INFERRED_FROM_A_MESSAGE"); needEvidence(a.evidence, environment);
        owner(p.ownerApproval, "ACCEPT_DEAL_TERMS", id + ":" + a.reference); d.acceptance = clone(a); d.evidence.push(clone(a.evidence)); break;
      }
      default: break;
    }
    return commit(d, to, { reason: p.reason ?? null });
  }
  function commit(d, to, extra = {}) { d.history.push({ at: now(), from: d.status, to, ...extra }); d.status = to; d.updatedAt = now(); S.save(); rec("DEAL_" + to, d, { decision: to, reason: extra.reason ?? undefined }); return clone(d); }
  const get = id => (deals()[id] ? clone(deals()[id]) : null);
  const list = (f = {}) => Object.values(deals()).filter(d => Object.entries(f).every(([k, v]) => d[k] === v)).map(clone);
  const summary = () => Object.fromEntries(DEAL_STATUSES.map(s => [s, Object.values(deals()).filter(d => d.status === s).length]));
  return { create, link, attachJob, transition, get, list, summary, statuses: DEAL_STATUSES, environment };
}
