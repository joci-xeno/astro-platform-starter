// Lightweight internal CRM (package §20): a VIEW layer over the Entity Graph and the live engines — it owns no copy of customer, deal, job, invoice or payment data.
// The only records it keeps itself are FOLLOW-UP tasks (a due date and a note linked to an entity). A follow-up is a reminder for Joci/an agent; sending anything still goes
// through the Communication Center (draft > owner approval > provider evidence). Status values shown here are read from the owning engine at view time.
import { createStore, clone } from "./store.mjs";

export const FOLLOWUP_STATES = Object.freeze(["OPEN", "DONE", "CANCELLED"]);
const TYPES = ["customer", "company", "contact", "opportunity", "deal", "job", "invoice", "subscription"];

export function createCrm({ graph, tenantId = "ATLASZ", lookups = {}, file = null, now = () => new Date().toISOString(), blackBox = null } = {}) {
  if (!graph) throw new Error("ENTITY_GRAPH_REQUIRED");
  const S = createStore({ file, init: () => ({ followups: {}, seq: 0 }) });
  const need = (ok, r) => { if (!ok) throw new Error(r); };
  const rec = (kind, id, extra = {}) => { try { blackBox?.record({ kind, resource: id, ...extra }); } catch { /* ignore */ } };
  const read = (type, id) => { try { return (type === "deal" ? lookups.deal : type === "job" ? lookups.job : type === "invoice" ? lookups.invoice : type === "communication" ? lookups.communication : type === "payment" ? lookups.payment : type === "document" ? lookups.document : null)?.(id) ?? null; } catch { return null; } };
  const brief = (type, id) => { const r = read(type, id); return r ? { status: r.status ?? r.state ?? null, ...(type === "invoice" ? { total: r.total ?? null, currency: r.currency ?? null } : {}), ...(type === "payment" ? { amount: r.amount ?? null } : {}) } : null; };

  const addCustomer = (id, attributes = {}, source = "crm") => graph.upsertEntity({ tenantId, type: "customer", id, attributes, source });
  const addCompany = (id, attributes = {}, source = "crm") => graph.upsertEntity({ tenantId, type: "company", id, attributes, source });
  function addContact(id, { customerId = null, companyId = null, ...attributes } = {}, source = "crm") {
    const c = graph.upsertEntity({ tenantId, type: "contact", id, attributes, source });
    if (companyId) graph.linkEntities({ tenantId, fromType: "contact", fromId: id, toType: "company", toId: companyId, relation: "WORKS_AT", evidence: source });
    if (customerId) graph.linkEntities({ tenantId, fromType: "contact", fromId: id, toType: "customer", toId: customerId, relation: "REPRESENTS", evidence: source });
    return c;
  }
  /** Everything known about one customer, assembled live: related entities from the graph + their CURRENT status from the engine that owns them. */
  function customer360(customerId) {
    const v = graph.entityView({ tenantId, type: "customer", id: customerId }); if (!v.root) return null;
    const near = graph.neighbors({ tenantId, type: "customer", id: customerId, depth: 4 });
    const group = {}; for (const n of near) (group[n.type] ??= []).push({ id: n.id, via: n.via, depth: n.depth, stub: n.stub, current: brief(n.type, n.id) });
    const invoices = group.invoice ?? [], payments = group.payment ?? [];
    return { customer: { id: customerId, attributes: v.root.attributes, sources: v.root.sources, stub: v.root.stub }, related: group,
      money: { invoicesVerifiedPaid: invoices.filter(i => i.current?.status === "VERIFIED_PAID").length, invoicesOpen: invoices.filter(i => i.current && !["VERIFIED_PAID", "CANCELLED", "DRAFT"].includes(i.current.status)).length, paymentsVerified: payments.filter(p => p.current?.status === "VERIFIED").length,
        note: "Counts come from the Invoice and Payment engines at view time; this view stores no money data." },
      followups: followups({ entityType: "customer", entityId: customerId, status: "OPEN" }), unresolvedLinks: near.filter(n => n.stub).map(n => ({ type: n.type, id: n.id })) };
  }
  /** Deal pipeline board straight from the Deal engine. */
  function pipeline() {
    const deals = lookups.deals?.() ?? null; if (!deals) return { state: "NOT_CONNECTED", columns: {} };
    const columns = {}; for (const d of deals) (columns[d.status] ??= []).push({ id: d.id, summary: d.summary ?? null, opportunityId: d.opportunityId ?? null, updatedAt: d.updatedAt });
    return { state: "CONNECTED", columns, counts: Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, v.length])) };
  }
  /** Chronological history for one entity: its graph links (when created) merged with the owning engine's own history. */
  function history(type, id) {
    need(TYPES.concat(["communication", "payment", "document", "artifact", "agent"]).includes(type), "UNKNOWN_ENTITY_TYPE");
    const v = graph.entityView({ tenantId, type, id }); const ev = [];
    for (const e of v.relationships) ev.push({ at: e.at, kind: "LINKED", detail: `${e.from.type}:${e.from.id} ${e.relation} ${e.to.type}:${e.to.id}`, source: "ENTITY_GRAPH" });
    for (const h of lookups.history?.(type, id) ?? []) ev.push({ at: h.at, kind: h.to ? "STATUS:" + h.to : h.kind ?? "EVENT", detail: h.reason ?? h.detail ?? null, source: "ENGINE" });
    for (const f of followups({ entityType: type, entityId: id })) ev.push({ at: f.createdAt, kind: "FOLLOWUP_" + f.status, detail: f.note, source: "CRM" });
    return ev.filter(e => e.at).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }

  function createFollowup({ entityType, entityId, dueAt, note, createdBy = "OWNER" } = {}) {
    need(TYPES.includes(entityType) && entityId && note, "FOLLOWUP_FIELDS_REQUIRED"); need(Number.isFinite(Date.parse(dueAt)), "DUE_DATE_REQUIRED");
    const e = graph.entityView({ tenantId, type: entityType, id: entityId }); need(e.root && !e.root.retired, "UNKNOWN_ENTITY");        // follow-ups attach to entities that exist in THIS tenant
    const id = "fu-" + String(++S.data.seq).padStart(5, "0"), f = { id, tenantId, entityType, entityId, dueAt, note: String(note).slice(0, 500), createdBy, status: "OPEN", createdAt: now(), completedAt: null, outcome: null };
    S.data.followups[id] = f; S.save(); graph.linkEntities({ tenantId, fromType: "followup", fromId: id, toType: entityType, toId: entityId, relation: "FOLLOWS_UP", evidence: "crm" }); rec("FOLLOWUP_CREATED", id); return clone(f);
  }
  function setFollowup(id, status, outcome = null) {
    const f = S.data.followups[id]; need(f, "UNKNOWN_FOLLOWUP"); need(FOLLOWUP_STATES.includes(status) && status !== "OPEN", "BAD_STATUS"); need(f.status === "OPEN", "ALREADY_" + f.status);
    f.status = status; f.completedAt = now(); f.outcome = outcome; S.save(); rec("FOLLOWUP_" + status, id); return clone(f);
  }
  const followups = (flt = {}) => Object.values(S.data.followups).filter(f => (!flt.status || f.status === flt.status) && (!flt.entityType || f.entityType === flt.entityType) && (!flt.entityId || f.entityId === flt.entityId)).sort((a, b) => a.dueAt.localeCompare(b.dueAt)).map(clone);
  const overdue = (asOf = now()) => followups({ status: "OPEN" }).filter(f => Date.parse(f.dueAt) < Date.parse(asOf)).map(f => ({ ...f, recommendedAction: "DRAFT_FOLLOWUP_FOR_OWNER_REVIEW", external: false }));
  /** Data quality: possible duplicate contacts/customers/companies and unresolved stubs. */
  const quality = () => ({ duplicates: ["customer", "company", "contact"].flatMap(type => graph.findDuplicates({ tenantId, type }).map(d => ({ type, ...d }))), integrity: graph.integrity() });
  return { addCustomer, addCompany, addContact, customer360, pipeline, history, createFollowup, completeFollowup: (id, outcome) => setFollowup(id, "DONE", outcome), cancelFollowup: (id, why) => setFollowup(id, "CANCELLED", why), followups, overdue, quality };
}
