// Durable, tenant-isolated Customer / Entity Graph (package §19). One graph for customers, companies, contacts, opportunities, deals, jobs, documents, communications,
// invoices, payments, artifacts and agents. The CRM (§20) is a VIEW over this graph — customer data is never copied into a second store.
//  * every operation names a tenant; reads and traversals never cross tenants (a cross-tenant link is impossible by construction: both ends are looked up in the SAME tenant);
//  * known relations enforce their allowed endpoint types; free-form relations are accepted (memory fabric) but marked `known:false`;
//  * identical links merge (evidence accumulates) instead of duplicating; entities are never hard-deleted (retire / merge leave a trail);
//  * a corrupt store is never replaced silently.
// Drop-in compatible with the legacy module API: upsertEntity / linkEntities / entityView.
import { createStore, clone } from "./store.mjs";

export const ENTITY_TYPES = Object.freeze(["customer", "company", "contact", "opportunity", "deal", "job", "document", "communication", "invoice", "payment", "artifact", "agent", "subscription", "followup"]);
/** relation -> [allowed from types, allowed to types] */
export const RELATIONS = Object.freeze({
  WORKS_AT: [["contact"], ["company"]], REPRESENTS: [["contact"], ["customer", "company"]], IS_COMPANY_OF: [["company"], ["customer"]],
  SOURCED_AS: [["customer", "company", "contact"], ["opportunity"]], BECAME: [["opportunity"], ["deal"]], OWNS_DEAL: [["customer", "company"], ["deal"]],
  HAS_JOB: [["deal", "customer"], ["job"]], EXECUTED_BY: [["job"], ["agent"]], PRODUCED: [["job"], ["artifact"]], DOCUMENTS: [["document"], ["deal", "job", "customer", "invoice", "opportunity"]],
  ABOUT: [["communication"], ["deal", "job", "customer", "opportunity", "invoice", "contact", "company"]], WITH_CONTACT: [["communication"], ["contact"]],
  BILLED_BY: [["job", "subscription"], ["invoice"]], SETTLES: [["payment"], ["invoice"]], BILLS: [["subscription"], ["customer"]], FOLLOWS_UP: [["followup"], ["deal", "opportunity", "customer", "job"]]
});
const norm = s => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const key = (t, type, id) => `${t}|${type}|${id}`;

export function createEntityGraph({ file = null, now = () => new Date().toISOString(), blackBox = null } = {}) {
  const S = createStore({ file, init: () => ({ entities: {}, edges: {}, aliases: {} }) });
  const need = (ok, r) => { if (!ok) throw new Error(r); };
  const rec = (kind, extra) => { try { blackBox?.record({ kind, ...extra }); } catch { /* ignore */ } };
  const resolve = (t, type, id) => { let k = key(t, type, id), n = 0; while (S.data.aliases[k] && n++ < 20) k = S.data.aliases[k]; return k; };

  function upsertEntity({ tenantId, type, id, attributes = {}, source = null } = {}) {
    need(tenantId && type && id, "ENTITY_FIELDS_REQUIRED");
    const k = resolve(tenantId, type, id), old = S.data.entities[k];
    need(!old?.retired, "ENTITY_RETIRED");
    const [t, ty, i] = old ? [old.tenantId, old.type, old.id] : [tenantId, type, id];
    const v = { tenantId: t, type: ty, id: i, known: ENTITY_TYPES.includes(ty), attributes: { ...(old?.attributes ?? {}), ...attributes }, sources: [...new Set([...(old?.sources ?? []), ...(source ? [source] : [])])], stub: false, retired: false, mergedFrom: old?.mergedFrom ?? [], createdAt: old?.createdAt ?? now(), updatedAt: now() };
    S.data.entities[key(t, ty, i)] = v; S.save(); return clone(v);
  }
  function linkEntities({ tenantId, fromType, fromId, toType, toId, relation, evidence = null } = {}) {
    need(tenantId && fromType && fromId && toType && toId && relation, "LINK_FIELDS_REQUIRED");
    const rule = RELATIONS[relation];
    if (rule) { need(rule[0].includes(fromType), `RELATION_${relation}_FROM_TYPE_NOT_ALLOWED:${fromType}`); need(rule[1].includes(toType), `RELATION_${relation}_TO_TYPE_NOT_ALLOWED:${toType}`); }
    // both ends live in THIS tenant; a missing end becomes a visible stub (never an entity of another tenant)
    for (const [ty, i] of [[fromType, fromId], [toType, toId]]) { const k = resolve(tenantId, ty, i); need(!S.data.entities[k]?.retired, "ENTITY_RETIRED"); if (!S.data.entities[k]) S.data.entities[k] = { tenantId, type: ty, id: i, known: ENTITY_TYPES.includes(ty), attributes: {}, sources: [], stub: true, retired: false, mergedFrom: [], createdAt: now(), updatedAt: now() }; }
    const f = S.data.entities[resolve(tenantId, fromType, fromId)], g = S.data.entities[resolve(tenantId, toType, toId)];
    need(f.tenantId === tenantId && g.tenantId === tenantId, "CROSS_TENANT_LINK_REFUSED");
    const ek = `${tenantId}|${f.type}|${f.id}|${relation}|${g.type}|${g.id}`, old = S.data.edges[ek];
    const e = old ?? { tenantId, from: { type: f.type, id: f.id }, to: { type: g.type, id: g.id }, relation, known: Boolean(rule), evidence: [], at: now() };
    if (evidence != null) e.evidence.push(evidence); S.data.edges[ek] = e; S.save(); return clone({ ...e, evidence: e.evidence.at(-1) ?? null });
  }
  const edgesOf = (t, ty, id) => Object.values(S.data.edges).filter(e => e.tenantId === t && ((e.from.type === ty && e.from.id === id) || (e.to.type === ty && e.to.id === id)));
  function entityView({ tenantId, type, id } = {}) {
    const root = S.data.entities[resolve(tenantId, type, id)] ?? null; if (!root || root.tenantId !== tenantId) return { root: null, relationships: [] };
    return { root: clone(root), relationships: edgesOf(tenantId, root.type, root.id).map(e => clone({ ...e, evidence: e.evidence.at(-1) ?? null })) };
  }
  /** Breadth-first neighbourhood inside ONE tenant. */
  function neighbors({ tenantId, type, id, depth = 1, relations = null, types = null } = {}) {
    need(tenantId, "TENANT_REQUIRED"); const start = S.data.entities[resolve(tenantId, type, id)]; if (!start) return [];
    const seen = new Set([key(tenantId, start.type, start.id)]), out = []; let frontier = [start];
    for (let d = 1; d <= Math.min(depth, 6); d++) {
      const next = [];
      for (const n of frontier) for (const e of edgesOf(tenantId, n.type, n.id)) {
        if (relations && !relations.includes(e.relation)) continue;
        const o = e.from.type === n.type && e.from.id === n.id ? e.to : e.from, k = key(tenantId, o.type, o.id); if (seen.has(k)) continue; seen.add(k);
        const ent = S.data.entities[k]; if (!ent || ent.retired || (types && !types.includes(ent.type))) continue; out.push({ depth: d, via: e.relation, type: ent.type, id: ent.id, stub: ent.stub, attributes: clone(ent.attributes) }); next.push(ent);
      }
      frontier = next;
    }
    return out;
  }
  const list = ({ tenantId, type = null, includeRetired = false } = {}) => { need(tenantId, "TENANT_REQUIRED"); return Object.values(S.data.entities).filter(e => e.tenantId === tenantId && (!type || e.type === type) && (includeRetired || !e.retired)).map(clone); };
  /** Possible duplicates by normalised email / domain / phone / name. A suggestion only — merging is a separate, recorded step. */
  function findDuplicates({ tenantId, type } = {}) {
    const groups = new Map(); for (const e of list({ tenantId, type })) { if (e.stub) continue; for (const f of ["email", "domain", "phone", "name"]) { const v = norm(e.attributes[f]); if (v) { const g = groups.get(f + ":" + v) ?? []; g.push(e.id); groups.set(f + ":" + v, g); } } }
    return [...groups].filter(([, ids]) => ids.length > 1).map(([matchOn, ids]) => ({ matchOn, ids }));
  }
  /** Merge `dropId` into `keepId` (same tenant, same type): attributes of the kept entity win, edges are re-pointed, the dropped id becomes an alias. Nothing is lost. */
  function merge({ tenantId, type, keepId, dropId, reason } = {}) {
    need(tenantId && type && keepId && dropId && reason, "MERGE_FIELDS_REQUIRED"); need(keepId !== dropId, "CANNOT_MERGE_WITH_SELF");
    const keep = S.data.entities[resolve(tenantId, type, keepId)], drop = S.data.entities[resolve(tenantId, type, dropId)]; need(keep && drop, "UNKNOWN_ENTITY"); need(keep.id !== drop.id, "ALREADY_MERGED");
    keep.attributes = { ...drop.attributes, ...keep.attributes }; keep.sources = [...new Set([...keep.sources, ...drop.sources])]; keep.mergedFrom.push({ id: drop.id, at: now(), reason }); keep.stub = keep.stub && drop.stub; keep.updatedAt = now();
    const edges = Object.entries(S.data.edges).filter(([, e]) => e.tenantId === tenantId); let moved = 0;
    for (const [k, e] of edges) {
      let ch = false; for (const side of ["from", "to"]) if (e[side].type === type && e[side].id === drop.id) { e[side].id = keep.id; ch = true; }
      if (!ch) continue; delete S.data.edges[k]; moved++; if (e.from.type === e.to.type && e.from.id === e.to.id) continue;      // a link that became a self-loop is dropped
      const nk = `${tenantId}|${e.from.type}|${e.from.id}|${e.relation}|${e.to.type}|${e.to.id}`, ex = S.data.edges[nk]; if (ex) ex.evidence.push(...e.evidence); else S.data.edges[nk] = e;
    }
    delete S.data.entities[key(tenantId, drop.type, drop.id)]; S.data.aliases[key(tenantId, type, dropId)] = key(tenantId, keep.type, keep.id); S.save();
    rec("ENTITY_MERGED", { resource: `${tenantId}/${type}/${keepId}`, reason }); return { kept: clone(keep), edgesMoved: moved };
  }
  const retire = ({ tenantId, type, id, reason } = {}) => { need(reason, "REASON_REQUIRED"); const e = S.data.entities[resolve(tenantId, type, id)]; need(e && e.tenantId === tenantId, "UNKNOWN_ENTITY"); e.retired = true; e.retiredReason = reason; e.updatedAt = now(); S.save(); rec("ENTITY_RETIRED", { resource: `${tenantId}/${type}/${id}`, reason }); return clone(e); };
  /** Structural integrity: edges whose ends are missing, ends in another tenant, known relations with wrong endpoint types, stubs never filled in. */
  function integrity() {
    const problems = [];
    for (const [k, e] of Object.entries(S.data.edges)) {
      for (const side of ["from", "to"]) { const ent = S.data.entities[key(e.tenantId, e[side].type, e[side].id)]; if (!ent) problems.push({ edge: k, problem: "MISSING_ENTITY:" + side }); else if (ent.tenantId !== e.tenantId) problems.push({ edge: k, problem: "TENANT_MISMATCH:" + side }); }
      const rule = RELATIONS[e.relation]; if (rule && (!rule[0].includes(e.from.type) || !rule[1].includes(e.to.type))) problems.push({ edge: k, problem: "RELATION_TYPE_VIOLATION" });
    }
    const stubs = Object.values(S.data.entities).filter(e => e.stub && !e.retired).length;
    return { ok: problems.length === 0, problems, stubs, entities: Object.keys(S.data.entities).length, edges: Object.keys(S.data.edges).length };
  }
  return { upsertEntity, linkEntities, entityView, neighbors, list, findDuplicates, merge, retire, integrity };
}
