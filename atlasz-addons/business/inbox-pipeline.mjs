// Universal Inbox pipeline (package §21):  RECEIVE > SECURITY SCREEN > CLASSIFY > ENTITY LINK > JOB/DEAL LINK > PRIORITIZE > ROUTE > RECORD
// Wraps the existing durable Universal Inbox (which keeps the append-only record). Rules:
//  * external text is screened BEFORE anything else reads it; a quarantined message is stored with its body withheld (only a hash is kept) and never reaches routing handlers;
//  * entity/deal/job links are only made to records that EXIST (ids written inside a message are checked against the real engines, never trusted);
//  * an ambiguous link is reported as ambiguous, not guessed;
//  * routing is a recommendation recorded with the item. A handler is called only for cases that carry authoritative evidence (e.g. a customer reply needs a provider reference);
//  * a payment message is a CLAIM and is only ever routed to payment verification.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createStore, clone } from "./store.mjs";

export const KINDS = Object.freeze(["CUSTOMER_REPLY", "JOB_INVITATION", "APPROVAL", "PAYMENT_CLAIM", "SYSTEM", "QUARANTINED", "OTHER"]);
export const ROUTES = Object.freeze({ SECURITY_REVIEW: "owner", DEAL_PIPELINE: "deal", OWNER_REVIEW: "owner", APPROVAL_CENTER: "approvals", PAYMENT_VERIFICATION: "payments", INCIDENT_CENTER: "incidents", OPPORTUNITY_INTAKE: "search" });
const PRIORITY = ["LOW", "NORMAL", "HIGH", "CRITICAL"];
const up = (a, b) => (PRIORITY.indexOf(b) > PRIORITY.indexOf(a) ? b : a);
const sha = t => crypto.createHash("sha256").update(String(t)).digest("hex");
const emailOf = s => { const m = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(String(s ?? "")); return m ? m[0].toLowerCase() : null; };
const INVITE = /(invit(e|ation)|we would like to hire|looking for (a|an) (freelanc|develop|contractor)|request for (proposal|quote)|rfp\b|project (proposal|opportunity))/i;
const PAYMENT = /(paid|payment (sent|made|completed)|transferred|wire|e-?transfer|receipt)/i;

export function createInboxPipeline({ inbox, security, graph = null, tenantId = "ATLASZ", lookups = {}, handlers = {}, file = null, blackBox = null, now = () => new Date().toISOString() } = {}) {
  if (!inbox || !security) throw new Error("INBOX_AND_SECURITY_REQUIRED");
  const S = createStore({ file, init: () => ({ items: {} }) });
  const rec = (kind, id, extra = {}) => { try { blackBox?.record({ kind, resource: id, ...extra }); } catch { /* ignore */ } };

  function classify(src, subject, body, from) {
    const t = `${subject}\n${body}`;
    if (src === "APPROVAL_REQUEST") return "APPROVAL"; if (src === "PAYMENT_EVENT" || (src === "EMAIL" && PAYMENT.test(t) && /\b(invoice|inv-)/i.test(t))) return "PAYMENT_CLAIM";
    if (src === "SYSTEM_ALERT" || src === "JOB_EVENT" || src === "AGENT_MESSAGE" || src === "CONNECTOR_EVENT") return "SYSTEM";
    if (src === "JOB_INVITATION" || INVITE.test(t)) return "JOB_INVITATION"; if (src === "CUSTOMER_REPLY" || /^\s*re:/i.test(subject)) return "CUSTOMER_REPLY";
    return "OTHER";
  }
  function entityLink(from) {
    const addr = emailOf(from); if (!graph || !addr) return { status: addr ? "NO_GRAPH" : "NO_SENDER_ADDRESS", links: [] };
    const hits = graph.list({ tenantId, type: "contact" }).filter(c => String(c.attributes.email ?? "").trim().toLowerCase() === addr);
    if (hits.length === 0) return { status: "UNKNOWN_SENDER", sender: addr, links: [], suggestion: "CREATE_CONTACT_FOR_OWNER_REVIEW" };
    if (hits.length > 1) return { status: "AMBIGUOUS", sender: addr, links: hits.map(h => ({ type: "contact", id: h.id })) };
    return { status: "LINKED", sender: addr, links: [{ type: "contact", id: hits[0].id }] };
  }
  function dealJobLink(text, ent) {
    const out = { deals: [], jobs: [], via: [] };
    for (const m of text.matchAll(/\b(deal-[a-z0-9-]+)\b/gi)) if (lookups.deal?.(m[1])) { out.deals.push(m[1]); out.via.push("TEXT_REFERENCE_VERIFIED"); }
    for (const m of text.matchAll(/\b(job-[a-z0-9-]+|J[0-9]{1,6})\b/g)) if (lookups.job?.(m[1])) { out.jobs.push(m[1]); out.via.push("TEXT_REFERENCE_VERIFIED"); }
    if (!out.deals.length && !out.jobs.length && graph && ent.status === "LINKED") {            // through the entity graph: contact > (customer|company) > deal/job
      const near = graph.neighbors({ tenantId, type: "contact", id: ent.links[0].id, depth: 4, types: ["deal", "job"] });
      const deals = [...new Set(near.filter(n => n.type === "deal" && !lookups.deal?.(n.id)?.closed).map(n => n.id))], jobs = [...new Set(near.filter(n => n.type === "job").map(n => n.id))];
      if (deals.length === 1) { out.deals.push(deals[0]); out.via.push("ENTITY_GRAPH"); } else if (deals.length > 1) out.ambiguous = { deals };
      if (jobs.length === 1 && !out.ambiguous) { out.jobs.push(jobs[0]); out.via.push("ENTITY_GRAPH"); }
    }
    out.deals = [...new Set(out.deals)]; out.jobs = [...new Set(out.jobs)]; return out;
  }
  function chooseRoute(kind, rec) {
    switch (kind) {
      case "QUARANTINED": return "SECURITY_REVIEW"; case "APPROVAL": return "APPROVAL_CENTER"; case "PAYMENT_CLAIM": return "PAYMENT_VERIFICATION"; case "SYSTEM": return "INCIDENT_CENTER";
      case "JOB_INVITATION": return "OPPORTUNITY_INTAKE"; case "CUSTOMER_REPLY": return rec.links.deals.length === 1 ? "DEAL_PIPELINE" : "OWNER_REVIEW"; default: return "OWNER_REVIEW";
    }
  }

  /** Run one inbound message through the whole pipeline. Idempotent per source+externalId. */
  async function receive(msg = {}) {
    const { source, externalId } = msg; const id = source + ":" + externalId; if (S.data.items[id]) return { ...clone(S.data.items[id]), duplicate: true };
    const stages = []; const mark = (n, v) => stages.push({ stage: n, ...(v ? { note: v } : {}) });
    const text = `${msg.subject ?? ""}\n${msg.body ?? ""}`;
    // 1 RECEIVE is the inbox record itself (validated by the inbox); but the screen runs first so a hostile body is never stored in readable form
    const sec = security.assess({ kind: "EXTERNAL_INSTRUCTION", agentId: null, source: String(source), text }); mark("SECURITY_SCREEN", sec.decision);
    const quarantined = !sec.allowed;
    const stored = quarantined ? { ...msg, subject: "[QUARANTINED]", body: "[content withheld by Security Brain]", meta: { ...(msg.meta ?? {}), quarantinedHash: sha(text) } } : msg;
    const ing = inbox.ingest(stored); mark("RECEIVE", ing.duplicate ? "ALREADY_IN_INBOX" : "RECORDED");
    const kind = quarantined ? "QUARANTINED" : classify(source, String(msg.subject ?? ""), String(msg.body ?? ""), msg.from); mark("CLASSIFY", kind);
    const entity = quarantined ? { status: "SKIPPED_QUARANTINED", links: [] } : entityLink(msg.from); mark("ENTITY_LINK", entity.status);
    const links = quarantined ? { deals: [], jobs: [], via: [] } : dealJobLink(text, entity); mark("JOB_DEAL_LINK", links.ambiguous ? "AMBIGUOUS" : links.deals.length || links.jobs.length ? "LINKED" : "NONE");
    let priority = ing.priority ?? "LOW";
    if (quarantined) priority = up(priority, "HIGH"); if (kind === "JOB_INVITATION") priority = up(priority, "HIGH"); if (kind === "CUSTOMER_REPLY" && links.deals.length) priority = up(priority, "HIGH"); if (kind === "PAYMENT_CLAIM") priority = up(priority, "HIGH");
    if (entity.status === "LINKED" && kind === "OTHER") priority = up(priority, "NORMAL"); mark("PRIORITIZE", priority);
    const r = { id, source, kind, quarantined, securityDecision: sec.decision, securityReasons: sec.reasons ?? [], entity, links, priority, route: null, routeStatus: "PENDING", routeDetail: null, receivedAt: now() };
    r.route = chooseRoute(kind, r); mark("ROUTE", r.route);
    // routing side effects: only with authoritative evidence and only through an installed handler
    try {
      if (quarantined) { r.routeStatus = "HELD_FOR_OWNER"; }
      else if (r.route === "DEAL_PIPELINE") {
        const ref = msg.meta?.providerRef; if (!ref) { r.routeStatus = "NEEDS_PROVIDER_EVIDENCE"; r.routeDetail = "A reply is recorded on the deal only with a provider reference (an unverifiable message is not a reply)."; }
        else if (!handlers.recordReply) r.routeStatus = "PENDING_HANDLER"; else { await handlers.recordReply(links.deals[0], { reference: ref, receivedAt: msg.meta?.receivedAt ?? now(), inboxId: id }); r.routeStatus = "APPLIED"; }
      } else if (r.route === "PAYMENT_VERIFICATION") { r.routeStatus = "PENDING_HANDLER"; r.routeDetail = "A customer payment message is a CLAIM. It never marks anything paid."; if (handlers.paymentClaim) { await handlers.paymentClaim({ inboxId: id, from: msg.from, links }); r.routeStatus = "CLAIM_RECORDED_NOT_VERIFIED"; } }
      else if (r.route === "OPPORTUNITY_INTAKE") { if (handlers.opportunity) { await handlers.opportunity({ inboxId: id, from: msg.from, subject: msg.subject, body: msg.body }); r.routeStatus = "SUBMITTED_TO_SEARCH_SCREENING"; } else r.routeStatus = "PENDING_HANDLER"; }
      else r.routeStatus = handlers[r.route] ? (await handlers[r.route]({ inboxId: id, record: r }), "APPLIED") : "QUEUED_FOR_OWNER";
    } catch (e) { r.routeStatus = "FAILED"; r.routeDetail = String(e.message).slice(0, 160); }
    mark("RECORD", r.routeStatus); r.stages = stages; S.data.items[id] = r; S.save();
    rec("INBOX_PIPELINE", id, { decision: r.route, reason: `${kind}:${r.routeStatus}` });
    return { ...clone(r), duplicate: false };
  }
  const get = id => (S.data.items[id] ? clone(S.data.items[id]) : null);
  const list = (f = {}) => Object.values(S.data.items).filter(i => (!f.kind || i.kind === f.kind) && (!f.route || i.route === f.route) && (!f.routeStatus || i.routeStatus === f.routeStatus)).map(clone);
  const summary = () => ({ total: Object.keys(S.data.items).length, byKind: Object.fromEntries(KINDS.map(k => [k, list({ kind: k }).length])), quarantined: list({ kind: "QUARANTINED" }).length, unlinkedSenders: list().filter(i => ["UNKNOWN_SENDER", "AMBIGUOUS"].includes(i.entity.status)).length, needsEvidence: list({ routeStatus: "NEEDS_PROVIDER_EVIDENCE" }).length });
  return { receive, get, list, summary };
}
