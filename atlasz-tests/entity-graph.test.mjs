// Package §19: durable, tenant-isolated entity graph; typed relations; merge/retire trail; integrity; legacy-API compatible.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmp, rm } from "./helpers.mjs";
import { createEntityGraph, RELATIONS, ENTITY_TYPES } from "../atlasz-addons/business/entity-graph.mjs";

const T = "acme", U = "other";
test("all required entity types are supported and known relations enforce endpoint types", () => {
  for (const t of ["customer", "company", "contact", "opportunity", "deal", "job", "document", "communication", "invoice", "payment", "artifact", "agent"]) assert.ok(ENTITY_TYPES.includes(t), t);
  const g = createEntityGraph();
  g.upsertEntity({ tenantId: T, type: "contact", id: "p1", attributes: { name: "Pat" } }); g.upsertEntity({ tenantId: T, type: "company", id: "c1" });
  assert.equal(g.linkEntities({ tenantId: T, fromType: "contact", fromId: "p1", toType: "company", toId: "c1", relation: "WORKS_AT", evidence: "e1" }).known, true);
  assert.throws(() => g.linkEntities({ tenantId: T, fromType: "company", fromId: "c1", toType: "contact", toId: "p1", relation: "WORKS_AT" }), /FROM_TYPE_NOT_ALLOWED/);
  assert.throws(() => g.linkEntities({ tenantId: T, fromType: "payment", fromId: "x", toType: "agent", toId: "E1", relation: "SETTLES" }), /TO_TYPE_NOT_ALLOWED/);
  assert.equal(g.linkEntities({ tenantId: T, fromType: "foo", fromId: "1", toType: "bar", toId: "2", relation: "freeform" }).known, false);   // memory-fabric style free-form link still works
  assert.ok(Object.keys(RELATIONS).length >= 15);
});

test("tenant isolation: same ids in two tenants are separate; traversal and views never cross; links cannot reach another tenant", () => {
  const g = createEntityGraph();
  g.upsertEntity({ tenantId: T, type: "customer", id: "c1", attributes: { name: "A" } }); g.upsertEntity({ tenantId: U, type: "customer", id: "c1", attributes: { name: "B" } });
  g.linkEntities({ tenantId: T, fromType: "customer", fromId: "c1", toType: "deal", toId: "d1", relation: "OWNS_DEAL" });
  assert.equal(g.entityView({ tenantId: U, type: "customer", id: "c1" }).relationships.length, 0); assert.equal(g.entityView({ tenantId: U, type: "customer", id: "c1" }).root.attributes.name, "B");
  assert.deepEqual(g.neighbors({ tenantId: U, type: "customer", id: "c1", depth: 3 }), []); assert.equal(g.neighbors({ tenantId: T, type: "customer", id: "c1" }).length, 1);
  assert.equal(g.list({ tenantId: U, type: "deal" }).length, 0); assert.throws(() => g.list({}), /TENANT_REQUIRED/);
  assert.equal(g.entityView({ tenantId: "ghost", type: "customer", id: "c1" }).root, null);
  assert.equal(g.integrity().ok, true);
});

test("full chain customer > opportunity > deal > job > artifact/agent, invoice > payment; neighbors depth and relation filters", () => {
  const g = createEntityGraph(), L = (a, ai, b, bi, r) => g.linkEntities({ tenantId: T, fromType: a, fromId: ai, toType: b, toId: bi, relation: r, evidence: "ev" });
  L("customer", "c1", "opportunity", "o1", "SOURCED_AS"); L("opportunity", "o1", "deal", "d1", "BECAME"); L("deal", "d1", "job", "j1", "HAS_JOB"); L("job", "j1", "agent", "E3", "EXECUTED_BY"); L("job", "j1", "artifact", "a1", "PRODUCED");
  L("job", "j1", "invoice", "i1", "BILLED_BY"); L("payment", "p1", "invoice", "i1", "SETTLES"); L("communication", "m1", "deal", "d1", "ABOUT"); L("document", "doc1", "job", "j1", "DOCUMENTS");
  const all = g.neighbors({ tenantId: T, type: "customer", id: "c1", depth: 6 }); assert.deepEqual(new Set(all.map(n => n.type)), new Set(["opportunity", "deal", "job", "agent", "artifact", "invoice", "payment", "communication", "document"]));
  assert.equal(g.neighbors({ tenantId: T, type: "customer", id: "c1", depth: 1 }).length, 1);
  assert.deepEqual(g.neighbors({ tenantId: T, type: "job", id: "j1", relations: ["EXECUTED_BY"] }).map(n => n.id), ["E3"]);
  assert.equal(g.neighbors({ tenantId: T, type: "invoice", id: "i1", depth: 1, types: ["payment"] })[0].id, "p1");
});

test("identical links merge evidence instead of duplicating; stubs are visible and fill in on upsert", () => {
  const g = createEntityGraph(); const a = { tenantId: T, fromType: "customer", fromId: "c1", toType: "deal", toId: "d1", relation: "OWNS_DEAL" };
  g.linkEntities({ ...a, evidence: "one" }); g.linkEntities({ ...a, evidence: "two" }); assert.equal(g.entityView({ tenantId: T, type: "deal", id: "d1" }).relationships.length, 1);
  assert.equal(g.entityView({ tenantId: T, type: "deal", id: "d1" }).root.stub, true); assert.equal(g.integrity().stubs, 2);
  g.upsertEntity({ tenantId: T, type: "deal", id: "d1", attributes: { value: 5 } }); assert.equal(g.entityView({ tenantId: T, type: "deal", id: "d1" }).root.stub, false);
});

test("duplicates are suggested; merge re-points edges, keeps attributes/provenance, leaves an alias; nothing is lost; merge across types/tenants impossible", () => {
  const g = createEntityGraph();
  g.upsertEntity({ tenantId: T, type: "contact", id: "p1", attributes: { email: "Pat@Example.com", name: "Pat" }, source: "inbox" }); g.upsertEntity({ tenantId: T, type: "contact", id: "p2", attributes: { email: " pat@example.com ", phone: "555" }, source: "crm" });
  g.linkEntities({ tenantId: T, fromType: "contact", fromId: "p2", toType: "company", toId: "c1", relation: "WORKS_AT", evidence: "x" }); g.linkEntities({ tenantId: T, fromType: "contact", fromId: "p1", toType: "company", toId: "c1", relation: "WORKS_AT", evidence: "y" });
  assert.deepEqual(g.findDuplicates({ tenantId: T, type: "contact" })[0].ids.sort(), ["p1", "p2"]); assert.deepEqual(g.findDuplicates({ tenantId: U, type: "contact" }), []);
  assert.throws(() => g.merge({ tenantId: T, type: "contact", keepId: "p1", dropId: "p2" }), /MERGE_FIELDS_REQUIRED/); assert.throws(() => g.merge({ tenantId: T, type: "contact", keepId: "p1", dropId: "p1", reason: "r" }), /CANNOT_MERGE_WITH_SELF/);
  assert.throws(() => g.merge({ tenantId: U, type: "contact", keepId: "p1", dropId: "p2", reason: "r" }), /UNKNOWN_ENTITY/);
  const m = g.merge({ tenantId: T, type: "contact", keepId: "p1", dropId: "p2", reason: "same email" });
  assert.equal(m.kept.attributes.phone, "555"); assert.equal(m.kept.attributes.name, "Pat"); assert.deepEqual(m.kept.sources.sort(), ["crm", "inbox"]); assert.equal(m.kept.mergedFrom[0].id, "p2");
  assert.equal(g.entityView({ tenantId: T, type: "contact", id: "p1" }).relationships.length, 1);                                      // two WORKS_AT edges collapsed into one
  assert.equal(g.entityView({ tenantId: T, type: "contact", id: "p2" }).root.id, "p1");                                                // alias resolves
  g.upsertEntity({ tenantId: T, type: "contact", id: "p2", attributes: { title: "CTO" } }); assert.equal(g.entityView({ tenantId: T, type: "contact", id: "p1" }).root.attributes.title, "CTO");
  assert.equal(g.integrity().ok, true);
});

test("retire keeps the record and blocks new links; durable across restart; corrupt store is never replaced", () => {
  const d = tmp(), f = path.join(d, "eg.json"); try {
    const g = createEntityGraph({ file: f }); g.upsertEntity({ tenantId: T, type: "customer", id: "c1" }); g.linkEntities({ tenantId: T, fromType: "customer", fromId: "c1", toType: "deal", toId: "d1", relation: "OWNS_DEAL" });
    assert.throws(() => g.retire({ tenantId: T, type: "customer", id: "c1" }), /REASON_REQUIRED/); g.retire({ tenantId: T, type: "customer", id: "c1", reason: "left" });
    assert.throws(() => g.linkEntities({ tenantId: T, fromType: "customer", fromId: "c1", toType: "deal", toId: "d2", relation: "OWNS_DEAL" }), /ENTITY_RETIRED/); assert.throws(() => g.upsertEntity({ tenantId: T, type: "customer", id: "c1" }), /ENTITY_RETIRED/);
    assert.equal(g.list({ tenantId: T, type: "customer" }).length, 0); assert.equal(g.list({ tenantId: T, type: "customer", includeRetired: true }).length, 1);
    const g2 = createEntityGraph({ file: f }); assert.equal(g2.entityView({ tenantId: T, type: "deal", id: "d1" }).relationships.length, 1);
    fs.writeFileSync(f, "{broken"); assert.throws(() => createEntityGraph({ file: f }), /STORE_UNREADABLE/);
  } finally { rm(d); }
});

test("integrity detects tampered store (missing end, tenant mismatch, relation type violation)", () => {
  const d = tmp(), f = path.join(d, "eg.json"); try {
    const g = createEntityGraph({ file: f }); g.linkEntities({ tenantId: T, fromType: "contact", fromId: "p1", toType: "company", toId: "c1", relation: "WORKS_AT" });
    const raw = JSON.parse(fs.readFileSync(f, "utf8")); const [ek, e] = Object.entries(raw.edges)[0]; e.to.type = "agent"; delete raw.entities[Object.keys(raw.entities).find(k => k.includes("|company|"))]; fs.writeFileSync(f, JSON.stringify(raw));
    const r = createEntityGraph({ file: f }).integrity(); assert.equal(r.ok, false); assert.ok(r.problems.some(p => p.problem === "RELATION_TYPE_VIOLATION")); assert.ok(r.problems.some(p => p.problem.startsWith("MISSING_ENTITY")));
  } finally { rm(d); }
});
