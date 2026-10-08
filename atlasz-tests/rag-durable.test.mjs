import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ingestKnowledge, retrieveKnowledge, buildGroundedContext, knowledgeHealth, configureKnowledgeStore, removeKnowledge } from "../atlasz-addons/enterprise-knowledge-agentic-rag.mjs";
import { tmp, rm } from "./helpers.mjs";

const doc = (o = {}) => ({ tenantId: "A", sourceId: "s1", title: "Warehouse lease", text: "The warehouse lease runs five years with a break clause", ...o });
test("durable mode: items survive a restart of the store; tenant and role enforcement still hold after reload", () => {
  const d = tmp("rag-"), f = path.join(d, "k", "rag.json");
  try {
    configureKnowledgeStore({ file: null }); assert.deepEqual(configureKnowledgeStore({ file: f }), { items: 0, skipped: 0, durable: true });
    const a = ingestKnowledge(doc({ id: "i1", allowedRoles: ["SEARCH"], verified: true })), b = ingestKnowledge(doc({ id: "i2", tenantId: "B", text: "tenant B warehouse secret lease terms" }));
    assert.equal(fs.statSync(f).mode & 0o777, 0o600); assert.equal(fs.existsSync(f + ".tmp"), false);
    configureKnowledgeStore({ file: null }); assert.equal(retrieveKnowledge({ query: "warehouse lease", tenantId: "A", role: "SEARCH" }).length, 0, "memory mode starts empty");
    assert.deepEqual(configureKnowledgeStore({ file: f }), { items: 2, skipped: 0, durable: true });
    const r = retrieveKnowledge({ query: "warehouse lease", tenantId: "A", role: "SEARCH" }); assert.deepEqual(r.map(x => x.id), ["i1"]); assert.equal(r[0].verified, true);
    assert.equal(retrieveKnowledge({ query: "warehouse lease", tenantId: "A", role: "EXECUTION" }).length, 0, "role gate survives reload");
    assert.ok(!retrieveKnowledge({ query: "secret lease terms", tenantId: "A", role: "SEARCH" }).some(x => x.id === "i2"));
    assert.deepEqual(knowledgeHealth({ tenantId: "A" }), { items: 1, verified: 1, unverified: 0, tenants: ["A"] });
    assert.equal(buildGroundedContext({ query: "warehouse lease", tenantId: "A", role: "SEARCH" }).evidence.length, 1);
  } finally { configureKnowledgeStore({ file: null }); rm(d); }
});
test("memory mode (default) still works and writes nothing", () => {
  configureKnowledgeStore({ file: null });
  const x = ingestKnowledge(doc({ id: "mem" })); assert.equal(x.id, "mem"); assert.equal(retrieveKnowledge({ query: "warehouse lease", tenantId: "A" }).length, 1); assert.equal(removeKnowledge({ id: "mem", tenantId: "A" }).ok, true); configureKnowledgeStore({ file: null });
});
test("a corrupt store is never overwritten (fail closed); invalid entries are skipped and counted; bad file arguments are refused", () => {
  const d = tmp("rag2-"), f = path.join(d, "rag.json");
  try {
    fs.writeFileSync(f, "{not json"); assert.throws(() => configureKnowledgeStore({ file: f }), /KNOWLEDGE_STORE_UNREADABLE/); assert.equal(fs.readFileSync(f, "utf8"), "{not json", "corrupt file untouched");
  } catch (e) { rm(d); throw e; }
  try {
    configureKnowledgeStore({ file: null });
    fs.writeFileSync(f, JSON.stringify({ version: 1, items: [{ id: "ok", tenantId: "A", sourceId: "s", text: "good text here", allowedRoles: ["*"] }, { id: "no-text", tenantId: "A", sourceId: "s", allowedRoles: ["*"] }, { id: "ok", tenantId: "A", sourceId: "dup", text: "dup", allowedRoles: ["*"] }, { id: "norole", tenantId: "A", sourceId: "s", text: "t", allowedRoles: [] }, { id: "badrole", tenantId: "A", sourceId: "s", text: "t", allowedRoles: [5] }, null, "str"] }));
    assert.deepEqual(configureKnowledgeStore({ file: f }), { items: 1, skipped: 6, durable: true });
    fs.writeFileSync(f, JSON.stringify({ version: 1 })); assert.throws(() => configureKnowledgeStore({ file: f }), /KNOWLEDGE_STORE_UNREADABLE/);
    for (const bad of ["", 5, {}, [], true]) assert.throws(() => configureKnowledgeStore({ file: bad }), /KNOWLEDGE_FILE_INVALID/, String(bad));
  } finally { configureKnowledgeStore({ file: null }); rm(d); }
});
test("a failed configure leaves the previous store intact; a failed write rolls the ingest back; ids cannot be taken over by another tenant; removal is tenant-scoped and durable", () => {
  const d = tmp("rag3-"), f = path.join(d, "rag.json"), g = path.join(d, "other.json");
  try {
    configureKnowledgeStore({ file: f }); ingestKnowledge(doc({ id: "keep" }));
    fs.writeFileSync(g, "garbage"); assert.throws(() => configureKnowledgeStore({ file: g }), /UNREADABLE/); assert.equal(retrieveKnowledge({ query: "warehouse lease", tenantId: "A" }).length, 1, "still serving the previous store");
    ingestKnowledge(doc({ id: "keep", title: "Updated title" })); assert.equal(retrieveKnowledge({ query: "updated", tenantId: "A" })[0].title, "Updated title", "same tenant may update its own id");
    assert.throws(() => ingestKnowledge(doc({ id: "keep", tenantId: "B" })), /KNOWLEDGE_ID_BELONGS_TO_ANOTHER_TENANT/); assert.equal(retrieveKnowledge({ query: "warehouse", tenantId: "B" }).length, 0);
    assert.equal(removeKnowledge({ id: "keep", tenantId: "B" }).reason, "NOT_FOUND"); assert.equal(removeKnowledge({ id: "keep" }).reason, "NOT_FOUND"); assert.equal(removeKnowledge({ id: "nope", tenantId: "A" }).reason, "NOT_FOUND");
    // a write failure (the directory is replaced by a file) must not leave the item in memory
    fs.rmSync(f); fs.mkdirSync(f);
    assert.throws(() => ingestKnowledge(doc({ id: "lost" })), /./); assert.equal(retrieveKnowledge({ query: "warehouse lease", tenantId: "A" }).some(x => x.id === "lost"), false, "failed persist rolled back");
    assert.throws(() => ingestKnowledge(doc({ id: "keep", title: "Changed again" })), /./); assert.equal(retrieveKnowledge({ query: "updated", tenantId: "A" })[0].title, "Updated title", "failed update restored the previous version");
    assert.throws(() => removeKnowledge({ id: "keep", tenantId: "A" }), /./); assert.equal(retrieveKnowledge({ query: "updated", tenantId: "A" }).length, 1, "failed removal restored the item");
    fs.rmSync(f, { recursive: true }); assert.equal(removeKnowledge({ id: "keep", tenantId: "A" }).ok, true); configureKnowledgeStore({ file: f }); assert.equal(retrieveKnowledge({ query: "warehouse", tenantId: "A" }).length, 0, "removal persisted");
  } finally { configureKnowledgeStore({ file: null }); rm(d); }
});
