// Package §20: CRM is a view over the entity graph + engines; no duplicated customer data; follow-ups are reminders only.
import test from "node:test";
import assert from "node:assert/strict";
import { createEntityGraph } from "../atlasz-addons/business/entity-graph.mjs";
import { createCrm } from "../atlasz-addons/business/crm.mjs";

function world() {
  const graph = createEntityGraph(), eng = { deals: { "d1": { id: "d1", status: "WON", summary: "site", updatedAt: "2026-10-01" }, "d2": { id: "d2", status: "SENT" } }, invoices: { i1: { id: "i1", status: "VERIFIED_PAID", total: 200, currency: "USD" }, i2: { id: "i2", status: "SENT", total: 50, currency: "USD" }, i3: { id: "i3", status: "DRAFT" } }, payments: { p1: { id: "p1", status: "VERIFIED", amount: 200 }, p2: { id: "p2", status: "CLAIMED", amount: 50 } } };
  const crm = createCrm({ graph, now: () => "2026-10-07T12:00:00Z", lookups: { deal: id => eng.deals[id], job: () => null, invoice: id => eng.invoices[id], payment: id => eng.payments[id], deals: () => Object.values(eng.deals),
    history: (t, id) => (t === "deal" && id === "d1" ? [{ at: "2026-09-01T00:00:00Z", to: "SENT" }, { at: "2026-09-10T00:00:00Z", to: "WON", reason: "acceptance" }] : []) } });
  crm.addCompany("co1", { name: "Buyer Inc", domain: "buyer.example" }); crm.addCustomer("c1", { name: "Buyer" }); crm.addContact("p1", { customerId: "c1", companyId: "co1", email: "pat@buyer.example", name: "Pat" });
  const L = (a, ai, b, bi, r) => graph.linkEntities({ tenantId: "ATLASZ", fromType: a, fromId: ai, toType: b, toId: bi, relation: r, evidence: "t" });
  L("customer", "c1", "deal", "d1", "OWNS_DEAL"); L("customer", "c1", "deal", "d2", "OWNS_DEAL"); L("deal", "d1", "job", "j1", "HAS_JOB"); L("job", "j1", "invoice", "i1", "BILLED_BY"); L("job", "j1", "invoice", "i2", "BILLED_BY"); L("job", "j1", "invoice", "i3", "BILLED_BY");
  L("payment", "p1", "invoice", "i1", "SETTLES"); L("payment", "p2", "invoice", "i2", "SETTLES");
  return { crm, graph, eng };
}

test("customer 360 is assembled live from graph + owning engines; money counts only verified/paid states; no money data is stored in the CRM", () => {
  const { crm, eng } = world(); const v = crm.customer360("c1");
  assert.equal(v.customer.attributes.name, "Buyer"); assert.equal(v.related.deal.length, 2); assert.equal(v.related.invoice.length, 3);
  assert.equal(v.money.invoicesVerifiedPaid, 1); assert.equal(v.money.invoicesOpen, 1); assert.equal(v.money.paymentsVerified, 1);                    // CLAIMED payment and DRAFT invoice do not count
  assert.equal(v.related.deal.find(d => d.id === "d1").current.status, "WON");
  eng.invoices.i2.status = "VERIFIED_PAID"; eng.payments.p2.status = "VERIFIED"; const v2 = crm.customer360("c1"); assert.equal(v2.money.invoicesVerifiedPaid, 2);       // follows the engine immediately: nothing cached
  assert.equal(crm.customer360("nobody"), null); assert.ok(v.unresolvedLinks.some(u => u.type === "job" && u.id === "j1"));                              // j1 only exists as a stub: reported honestly
});

test("pipeline board reads the deal engine; NOT_CONNECTED without it", () => {
  const { crm } = world(); assert.deepEqual(crm.pipeline().counts, { WON: 1, SENT: 1 });
  assert.equal(createCrm({ graph: createEntityGraph() }).pipeline().state, "NOT_CONNECTED");
});

test("history merges graph links, engine status history and follow-ups in time order", () => {
  const { crm } = world(); crm.createFollowup({ entityType: "deal", entityId: "d1", dueAt: "2026-10-09", note: "check in" });
  const h = crm.history("deal", "d1"); assert.deepEqual(h.map(e => e.source).includes("ENGINE") && h.map(e => e.source).includes("ENTITY_GRAPH") && h.map(e => e.source).includes("CRM"), true);
  assert.deepEqual(h.map(e => e.at), [...h.map(e => e.at)].sort()); assert.ok(h.some(e => e.kind === "STATUS:WON" && e.detail === "acceptance")); assert.throws(() => crm.history("bogus", "x"), /UNKNOWN_ENTITY_TYPE/);
});

test("follow-ups: attach only to existing entities, are reminders (external:false), overdue list, complete once", () => {
  const { crm } = world();
  assert.throws(() => crm.createFollowup({ entityType: "customer", entityId: "ghost", dueAt: "2026-10-01", note: "x" }), /UNKNOWN_ENTITY/); assert.throws(() => crm.createFollowup({ entityType: "customer", entityId: "c1", dueAt: "soon", note: "x" }), /DUE_DATE_REQUIRED/);
  const a = crm.createFollowup({ entityType: "customer", entityId: "c1", dueAt: "2026-10-01", note: "ask for review" }); crm.createFollowup({ entityType: "deal", entityId: "d2", dueAt: "2026-10-20", note: "nudge" });
  const od = crm.overdue(); assert.deepEqual(od.map(f => f.id), [a.id]); assert.equal(od[0].external, false); assert.equal(od[0].recommendedAction, "DRAFT_FOLLOWUP_FOR_OWNER_REVIEW");
  crm.completeFollowup(a.id, "customer replied"); assert.equal(crm.overdue().length, 0); assert.throws(() => crm.cancelFollowup(a.id, "x"), /ALREADY_DONE/); assert.equal(crm.customer360("c1").followups.length, 0);
});

test("no duplicated data: contacts live only in the graph; data-quality finds duplicates", () => {
  const { crm, graph } = world(); crm.addContact("p9", { customerId: "c1", email: " PAT@buyer.example", name: "Patrick" });
  assert.equal(JSON.stringify(crm).includes("pat@buyer"), false); const q = crm.quality(); assert.ok(q.duplicates.some(d => d.type === "contact" && d.ids.includes("p1") && d.ids.includes("p9")));
  assert.equal(graph.list({ tenantId: "ATLASZ", type: "contact" }).length, 2);
});
