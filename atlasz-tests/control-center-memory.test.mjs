// Unified programme M5: Control Center memory panel. Real HTTP against the real server; the store, agent memory and embedding activation are the real modules.
// Embedding calls go to an injected stand-in for a local Ollama server (no network). Nothing here may show a success that did not happen.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";
import { createMemoryStore } from "../atlasz-addons/memory-store.mjs";
import { createAgentMemory } from "../atlasz-addons/agent-memory.mjs";
import { createFixtureProvider } from "../atlasz-addons/embedding-provider.mjs";
import { createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";

const PW = "correct horse battery", FAKE_KEY = "AKIA" + "ABCDEFGHIJKLMNOP", E1 = "EXECUTION-1", E2 = "EXECUTION-2";
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const raw = (port, p, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => { const q = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); }); q.on("error", reject); if (body) q.write(body); q.end(); });
async function boot(extra = {}) {
  const base = tmp("ccmem-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort(), ...extra }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const c = { base, stateDir, token, get: async (p, t = token) => raw(port, p, { headers: { ...H, ...(t ? { "x-atlasz-token": t } : {}) } }), post: (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) }), close: async () => { await cc.close?.(); rm(base); } };
  c.view = async () => JSON.parse((await c.get("/api/memory")).body);
  c.act = async (b) => { const r = await c.post("/api/memory/action", b); return { status: r.status, ...JSON.parse(r.body) }; };
  c.key = async () => { assert.equal((await c.post("/api/owner-key", { passphrase: PW })).status, 200); };
  // open the same folders the runtime uses, with the owner's public key (set up by /api/owner-key)
  c.open = ({ ageDays = 0 } = {}) => { const t0 = Date.now() - ageDays * 86400_000, store = createMemoryStore({ dir: path.join(stateDir, "memory", "knowledge-store"), nowFn: () => new Date(t0).toISOString() }); const am = createAgentMemory({ store, dir: path.join(stateDir, "memory", "agent-access"), nowFn: () => t0 }); return { store, am }; };
  return c;
}

test("memory panel: needs the token; a fresh install shows an empty, honest picture (no notes, semantic OFF with the reason, hardware + blockers, no invented numbers)", async () => {
  const c = await boot();
  try {
    assert.equal((await c.get("/api/memory", null)).status, 401); assert.equal((await c.post("/api/memory/action", { op: "verify" }, null)).status, 401);
    const v = await c.view(); assert.equal(v.state, "CONNECTED");
    assert.equal(v.store.notes, 0); assert.equal(v.store.consistent, true); assert.equal(v.indexing.semantic.enabled, false); assert.match(v.indexing.semantic.reason, /NO_EMBEDDING_PROVIDER/); assert.match(v.indexing.ngramSimilarity, /NOT neural/);
    assert.equal(v.embedding.activation, null); assert.ok(v.embedding.runtime.ramMB > 0 && v.embedding.runtime.cpus > 0); assert.ok(Array.isArray(v.embedding.runtime.candidates) && v.embedding.runtime.candidates.length >= 5);
    assert.equal(v.embedding.approvalNeeded.action, "EMBEDDING_ACTIVATE"); assert.deepEqual(v.notes, []); assert.deepEqual(v.pendingForgets, []); assert.equal(v.diagnostics.auditOk.store, true);
    assert.equal((await c.act({ op: "nope" })).status, 400); assert.equal((await c.act({ op: "get" })).status, 400);
    const ver = await c.act({ op: "verify" }); assert.equal(ver.result.consistent, true);
  } finally { await c.close(); }
});

test("memory panel: shows what agents really stored and did - scopes, provenance, activity, access log - without exposing note bodies in the overview; search and open return fenced data", async () => {
  const c = await boot();
  try {
    await c.key(); const { store, am } = c.open();
    try {
      const a1 = am.forAgent(E1), a2 = am.forAgent(E2);
      const priv = a1.remember({ title: "E1 private pricing", body: "Private pricing idea for gutter jobs.", scope: "agent" }), ten = a2.remember({ title: "Depot hours", body: "The depot closes at noon on Fridays.", scope: "tenant" });
      await a2.recall({ query: "gutter pricing" }); a1.remember({ title: "x", body: "password: Tr0ub4dor&3xyz" });
      am.recordVerifiedWork({ taskId: "task-9", owner: E1, verifier: E2, summary: "Screened the depot candidate." });
      const v = await c.view(); assert.equal(v.store.notes, 3); assert.doesNotMatch(JSON.stringify(v.notes), /Private pricing idea|noon on Fridays/);
      const byTitle = Object.fromEntries(v.notes.map(n => [n.title, n])); assert.equal(byTitle["E1 private pricing"].scope, "agent"); assert.equal(byTitle["E1 private pricing"].agent, E1); assert.equal(byTitle["Depot hours"].scope, "tenant"); assert.equal(byTitle["Verified: task-9"].provenance, "verified");
      const act = Object.fromEntries(v.agents.map(a => [a.agent, a])); assert.equal(act[E1].ops.remember, 1); assert.equal(act[E1].ops.refused, 1); assert.equal(act[E2].ops.recall, 1);
      assert.ok(v.accessLog.some(e => e.event === "MEMORY_WRITE_REFUSED") && v.accessLog.some(e => e.event === "MEMORY_RECALLED")); assert.doesNotMatch(JSON.stringify(v.accessLog), /gutter pricing/);      // query text is never logged
      assert.equal(v.diagnostics.auditOk.access, true);
      const s = await c.act({ op: "search", query: "depot hours friday" }); assert.equal(s.ok, true); assert.match(s.result.retrieval, /not neural/); assert.equal(s.result.results[0].id, ten.id); assert.match(s.result.results[0].passage, /^<<UNTRUSTED_MEMORY/);
      const g = await c.act({ op: "get", id: priv.id }); assert.equal(g.result.ok, true); assert.equal(g.result.author, E1); assert.equal(g.result.source, "agent:" + E1); assert.match(g.result.text, /Private pricing idea/); assert.equal(g.result.classification, "PERSONAL");
      assert.equal((await c.act({ op: "get", id: "../etc/passwd" })).result.ok, false);
      assert.doesNotMatch((await c.get("/api/memory")).body, /AKIA|Tr0ub4dor/);
    } finally { store.close(); }
  } finally { await c.close(); }
});

test("memory panel: owner changes are signed with the passphrase and bound to the exact note; a wrong passphrase or missing key changes nothing and says so", async () => {
  const c = await boot();
  try {
    const noKey = await c.act({ op: "approveForget", id: "0".repeat(16), passphrase: PW }); assert.equal(noKey.status, 400);
    await c.key(); const { store, am } = c.open();
    try {
      const a1 = am.forAgent(E1), n = a1.remember({ title: "Wrong fact", body: "The yard is open on Sundays.", scope: "tenant" }), m = a1.remember({ title: "Fine fact", body: "Tiles are stored in bay 4.", scope: "tenant" });
      assert.equal(a1.requestForget(n.id, "outdated").ok, true); a1.requestForget(m.id, "mistake");
      let v = await c.view(); assert.equal(v.pendingForgets.length, 2); assert.match(v.pendingForgets.find(p => p.id === n.id).subject, /^memory:[0-9a-f]{16}:[0-9a-f]{16}$/);
      const bad = await c.act({ op: "approveForget", id: n.id, passphrase: "wrong" }); assert.equal(bad.status, 400); assert.equal(a1.read(n.id).ok, true);
      assert.equal((await c.act({ op: "approveForget", id: n.id })).status, 400);      // no passphrase
      const good = await c.act({ op: "approveForget", id: n.id, passphrase: PW }); assert.equal(good.result.ok, true); assert.equal(a1.read(n.id).ok, false);
      v = await c.view(); assert.deepEqual(v.pendingForgets.map(p => p.id), [m.id]);
      assert.equal((await c.act({ op: "rejectForget", id: m.id })).result.ok, true); assert.equal(a1.read(m.id).ok, true); assert.equal((await c.act({ op: "rejectForget", id: m.id })).result.ok, false);
      // owner note, lowering its class (signed), forgetting (signed)
      const add = await c.act({ op: "addNote", title: "Board note", body: "Quarterly holding company plan.", classification: "CONFIDENTIAL" }); assert.equal(add.result.ok, true);
      assert.equal(a1.read(add.result.id).ok, false); assert.equal((await c.act({ op: "addNote", title: "k", body: "key " + FAKE_KEY })).result.ok, false);
      assert.equal((await c.act({ op: "declassify", id: add.result.id, to: "CONFIDENTIAL", passphrase: PW })).status, 400);      // not a lowering
      assert.equal((await c.act({ op: "declassify", id: add.result.id, to: "PERSONAL", passphrase: "wrong" })).status, 400);
      assert.equal((await c.act({ op: "declassify", id: add.result.id, to: "PERSONAL", passphrase: PW })).result.ok, true); assert.equal(a1.read(add.result.id).ok, true);
      assert.equal((await c.act({ op: "forget", id: add.result.id, passphrase: "wrong" })).status, 400); assert.equal((await c.act({ op: "forget", id: add.result.id, passphrase: PW })).result.ok, true);
      assert.equal(a1.read(add.result.id).ok, false); assert.equal((await c.view()).store.trashed >= 2, true);
    } finally { store.close(); }
  } finally { await c.close(); }
});

test("memory panel: retention preview lists only expired operational notes and the sweep needs the signature", async () => {
  const c = await boot();
  try {
    await c.key(); const { store, am } = c.open({ ageDays: 40 }); let old, lasting;
    try { const a = am.forAgent(E1); old = a.remember({ title: "Scratch", body: "Scratch note about bay 4.", kind: "ops", ttlDays: 7 }); lasting = a.remember({ title: "Kept", body: "Long term note about bay 5.", kind: "long" }); am.forAgent(E2).remember({ title: "Young", body: "Operational note with a long expiry.", kind: "ops", ttlDays: 365 }); } finally { store.close(); }
    const v = await c.view(); assert.deepEqual(v.retention.ids, [old.id]); assert.equal(v.retention.action, "MEMORY_RETENTION_SWEEP"); assert.match(v.retention.subject, /^retention:[0-9a-f]{24}:1$/);
    assert.equal((await c.act({ op: "retentionApply", passphrase: "wrong", subject: v.retention.subject })).status, 400); assert.equal((await c.view()).store.notes, 3);
    assert.equal((await c.act({ op: "retentionApply", subject: v.retention.subject })).status, 400);
    assert.equal((await c.act({ op: "retentionApply", passphrase: PW })).status, 400, "no reviewed subject: nothing is swept"); assert.equal((await c.act({ op: "retentionApply", passphrase: PW, subject: "retention:" + "0".repeat(24) + ":1" })).status, 400); assert.equal((await c.view()).store.notes, 3);
    const r = await c.act({ op: "retentionApply", passphrase: PW, subject: v.retention.subject }); assert.deepEqual(r.result.retired, [old.id]);
    const after = await c.view(); assert.equal(after.store.notes, 2); assert.deepEqual(after.retention.ids, []); assert.ok(after.notes.some(n => n.id === lasting.id));
    assert.ok(after.accessLog.some(e => e.event === "MEMORY_RETENTION_APPLIED"));
    assert.deepEqual((await c.act({ op: "retentionApply", passphrase: PW })).result, { ok: true, retired: [] });      // nothing expired: no signature spent, no fake success count
  } finally { await c.close(); }
});

test("memory panel: activating an embedding model needs the signed approval, writes a loopback-only record, never installs or downloads, and search stays honest about what it used", async () => {
  const calls = []; const fx = createFixtureProvider();
  const fetchImpl = async (url, init) => { calls.push(url); const body = JSON.parse(init.body); return { ok: true, json: async () => ({ embeddings: (await fx.embed(body.input)).map(v => [...v]) }) }; };
  const c = await boot({ fetchImpl });
  try {
    await c.key(); const { store, am } = c.open();
    try {
      am.forAgent(E1).remember({ title: "Van maintenance", body: "The work vehicle needs new brake pads before the long drive.", scope: "tenant" });
      const cfg = path.join(c.stateDir, "memory", "embedding-activation.json");
      assert.equal((await c.act({ op: "activateEmbedding", model: "bge-m3", passphrase: "wrong" })).status, 400); assert.equal(fs.existsSync(cfg), false);
      assert.equal((await c.act({ op: "activateEmbedding", model: "../evil", passphrase: PW })).status, 400); assert.equal(fs.existsSync(cfg), false);
      assert.equal((await c.act({ op: "activateEmbedding", passphrase: PW })).status, 400);
      const ok = await c.act({ op: "activateEmbedding", model: "bge-m3", passphrase: PW }); assert.equal(ok.result.ok, true); assert.match(ok.result.note, /does NOT install or download/);
      const rec = JSON.parse(fs.readFileSync(cfg, "utf8")); assert.equal(rec.baseUrl, "http://127.0.0.1:11434"); assert.equal(rec.model, "bge-m3");
      let v = await c.view(); assert.equal(v.embedding.activation.model, "bge-m3"); assert.equal(v.indexing.semantic.enabled, true); assert.equal(v.indexing.semantic.neural, true); assert.equal(v.indexing.semantic.coverage, 0);
      const before = await c.act({ op: "search", query: "automobile servicing" }); assert.equal(before.result.semantic.used, false); assert.match(before.result.semantic.reason, /NO_VECTORS_YET/);
      const ri = await c.act({ op: "reindexSemantic" }); assert.equal(ri.result.ok, true); assert.equal(ri.result.embedded, 1); assert.ok(calls.every(u => u === "http://127.0.0.1:11434/api/embed"));
      v = await c.view(); assert.equal(v.indexing.semantic.coverage, 1);
      const after = await c.act({ op: "search", query: "automobile servicing" }); assert.equal(after.result.semantic.used, true); assert.match(after.result.retrieval, /NEURAL_EMBEDDINGS\(bge-m3\)/);      // the stand-in here is declared NEURAL by the Ollama adapter: this proves the wiring, not model quality
      // the embedding server being down degrades to lexical, visibly
      const down = await boot({ fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
      try { await down.key(); fs.mkdirSync(path.join(down.stateDir, "memory"), { recursive: true }); fs.copyFileSync(cfg, path.join(down.stateDir, "memory", "embedding-activation.json")); const o = down.open(); try { o.am.forAgent(E1).remember({ title: "Van", body: "Brake pads for the van.", scope: "tenant" }); const r = await down.act({ op: "search", query: "brake pads" }); assert.equal(r.result.ok, true); assert.equal(r.result.semantic.used, false); assert.match(r.result.semantic.reason, /EMBEDDING_UNAVAILABLE/); assert.match(r.result.retrieval, /not neural/); assert.equal(r.result.results.length, 1); const rr = await down.act({ op: "reindexSemantic" }); assert.equal(rr.result.ok, false); } finally { o.store.close(); } } finally { await down.close(); }
      const off = await c.act({ op: "deactivateEmbedding" }); assert.equal(off.result.removed, true); assert.equal(fs.existsSync(cfg), false); v = await c.view(); assert.equal(v.indexing.semantic.enabled, false);
    } finally { store.close(); }
  } finally { await c.close(); }
});

test("memory panel: a tampered activation record that points off-machine is ignored (lexical fallback), never followed", async () => {
  const calls = []; const c = await boot({ fetchImpl: async u => { calls.push(u); throw new Error("must not be called"); } });
  try {
    fs.mkdirSync(path.join(c.stateDir, "memory"), { recursive: true });
    for (const bad of [{ v: 1, provider: "ollama", model: "bge-m3", baseUrl: "http://evil.example:11434" }, { v: 1, provider: "ollama", model: "bge-m3", baseUrl: "http://10.0.0.5:11434" }, { v: 1, provider: "other", model: "x", baseUrl: "http://127.0.0.1:11434" }, { v: 1, provider: "ollama", model: "a b", baseUrl: "http://127.0.0.1:11434" }]) {
      fs.writeFileSync(path.join(c.stateDir, "memory", "embedding-activation.json"), JSON.stringify(bad));
      const v = await c.view(); assert.equal(v.indexing.semantic.enabled, false, JSON.stringify(bad)); assert.equal(v.embedding.activation, null);
    }
    assert.deepEqual(calls, []);
  } finally { await c.close(); }
});
