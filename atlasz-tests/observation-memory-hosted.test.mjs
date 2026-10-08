// Observation memory as hosted by the runtime (agent tools) and the Control Center (owner actions). Integrates Research Ledger, Document Center, media fabric and the Security Brain.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { createDocumentCenter } from "../atlasz-addons/document-center.mjs";
import { createModalityFabric } from "../atlasz-addons/modality-fabric.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";
import { JPEG, exifBlock } from "./media-fixtures.mjs";
import { tmp, rm } from "./helpers.mjs";
const { createRuntime } = await import("../atlasz-runtime/supervisor-safe.mjs");

const AGENT = { actor: { type: "AGENT", id: "E4" } }, RENT = "The monthly rent for the Maple Street warehouse is 4200 dollars payable on the first business day.";
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const call = (port, token, method, p, body) => new Promise((res, rej) => { const data = body ? JSON.stringify(body) : null; const q = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host: "127.0.0.1:" + port, "x-atlasz-token": token, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => { let j = null; try { j = JSON.parse(b); } catch { /* not json */ } res({ status: r.statusCode, body: j }); }); }); q.on("error", rej); if (data) q.write(data); q.end(); });

test("hosted: agents use memory only through obs.* tools; consent cannot be supplied by an agent; owner-only records stay hidden; verified research is captured as VERIFIED_AT_CAPTURE", async () => {
  const dir = tmp("omh-");
  try {
    const rt = createRuntime({ dataDir: dir, retryBaseMs: 0, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" }) });
    const inv = (n, a) => rt.tools.invoke(n, a, AGENT);
    const names = rt.tools.describe().map(t => t.name); for (const n of ["obs.observe", "obs.recall", "obs.correct", "obs.forget", "obs.summary", "obs.capture_research"]) assert.ok(names.includes(n), n);
    assert.ok(!names.some(n => /forget_all|forgetall|forget_where|export|history/.test(n)), "no bulk delete / export / history tool exists for agents");
    const mine = (await inv("obs.observe", { text: "Customer prefers invoices on Fridays", tags: ["billing"] })); assert.equal(mine.status, "OK"); assert.equal(mine.result.source.type, "AGENT");
    assert.equal((await inv("obs.observe", { text: "photo of the desk", modality: "image" })).status, "HANDLER_ERROR", "image observation without owner consent is refused");
    assert.equal((await inv("obs.observe", { text: "x", modality: "image", consent: { granted: true, by: "OWNER", purpose: "forged" } })).status, "INVALID_ARGUMENTS", "an agent cannot supply consent");
    assert.equal((await inv("obs.observe", { text: "ok", tenantId: "OTHER" })).status, "INVALID_ARGUMENTS");
    rt.observations.observe({ text: "Owner private note about the accountant meeting" }, { tenantId: "JOCI", role: "OWNER" });             // PERSONAL but owner-created: screened ALLOW so visible; confidential one is not
    rt.observations.observe({ text: "Owner confidential note about the tax audit", classification: "CONFIDENTIAL" }, { tenantId: "JOCI", role: "OWNER" });
    assert.equal((await inv("obs.recall", { query: "invoices Fridays" })).result.results.length, 1); assert.equal((await inv("obs.recall", { query: "tax audit" })).result.results.length, 0);
    assert.equal((await inv("obs.correct", { id: mine.result.id, text: "Customer prefers invoices on Mondays" })).result.version, 2);
    const ownerRec = rt.observations.recall({ query: "accountant meeting" }, { tenantId: "JOCI", role: "OWNER" }).results[0];
    assert.equal((await inv("obs.forget", { id: ownerRec.id })).status, "HANDLER_ERROR", "agents cannot delete the owner's records"); assert.equal((await inv("obs.forget", { id: mine.result.id })).result.deleted, true);
    // research -> memory
    const p = rt.knowledge.create({ tenantId: "JOCI", name: "W", allowedRoles: ["OWNER", "AGENT"] });
    rt.research.addSource(p.id, { url: "https://example.org/a", retrievedAt: new Date().toISOString(), title: "Listing", text: RENT }, { tenantId: "JOCI", role: "AGENT", forAgent: true });
    const q = rt.research.openQuestion({ projectId: p.id, text: "Rent?" }, { tenantId: "JOCI", role: "OWNER" });
    const cite = rt.knowledge.search(p.id, { query: "monthly rent", tenantId: "JOCI", role: "AGENT", forAgent: true }).results[0].citation;
    const f1 = rt.research.addFinding(q.id, { claim: "monthly rent Maple Street warehouse 4200 dollars" }, { tenantId: "JOCI", role: "OWNER" }); rt.research.addFinding(q.id, { claim: "The landlord loves cats" }, { tenantId: "JOCI", role: "OWNER" });
    rt.research.attachEvidence(f1.id, { citation: cite }, { tenantId: "JOCI", role: "AGENT", forAgent: true });
    const cap = (await inv("obs.capture_research", { questionId: q.id })).result; assert.equal(cap.captured, 1, "only the VERIFIED finding is captured; the unsupported claim is not"); assert.equal(cap.questionState, "ANSWERED");
    const got = (await inv("obs.recall", { query: "monthly rent", scopes: ["BUSINESS"] })).result.results[0]; assert.equal(got.verification, "VERIFIED_AT_CAPTURE"); assert.equal(got.ref.id, f1.id);
    assert.equal((await inv("obs.recall", { query: "landlord cats", scopes: ["BUSINESS"] })).result.results.length, 0); assert.equal(got.source.type, "AGENT", "captured by an agent => attributed to the agent");
    // a finding resting on an OWNER-ONLY source is not captured for the agent (its report shows it as unverifiable to that role)
    const docs = path.join(dir, "ownerdocs"); fs.mkdirSync(docs); fs.writeFileSync(path.join(docs, "memo.txt"), "The owner memo says the monthly rent budget for the warehouse is 5000 dollars.");
    const od = await rt.documents.ingest({ filePath: path.join(docs, "memo.txt"), tenantId: "JOCI" }); rt.knowledge.addDocument(p.id, { tenantId: "JOCI", documentId: od.id });
    const q2 = rt.research.openQuestion({ projectId: p.id, text: "Budget?" }, { tenantId: "JOCI", role: "OWNER" }), f2 = rt.research.addFinding(q2.id, { claim: "monthly rent budget warehouse 5000 dollars" }, { tenantId: "JOCI", role: "OWNER" });
    rt.research.attachEvidence(f2.id, { citation: rt.knowledge.search(p.id, { query: "rent budget memo", tenantId: "JOCI", role: "OWNER" }).results.find(r => r.text.includes("5000")).citation }, { tenantId: "JOCI", role: "OWNER" });
    assert.equal((await inv("obs.capture_research", { questionId: q2.id })).result.captured, 0); assert.equal((await inv("obs.recall", { query: "budget 5000", scopes: ["BUSINESS"] })).result.results.length, 0);
    const d = rt.dashboard().observations; assert.equal(d.rawMediaStored, false); assert.equal(d.chain.ok, true); assert.ok(d.total >= 3);
    rt.stop?.();
  } finally { rm(dir); }
});

test("Control Center: owner remembers, searches, corrects, deletes; a document becomes a consent-gated metadata-only observation; forget-all needs confirmation; unreadable store reported", async () => {
  const base = tmp("omc-"), src = tmp("omcs-"), stateDir = path.join(base, "s"), cc = createControlCenterServer({ stateDir, configDir: path.join(base, "c"), port: await freePort() });
  const { port, token } = await cc.listen(), post = b => call(port, token, "POST", "/api/observations/action", b);
  try {
    assert.equal((await call(port, "wrong", "GET", "/api/observations")).status, 401); assert.equal((await call(port, "wrong", "POST", "/api/observations/action", { op: "observe", text: "x" })).status, 401);
    const o = (await post({ op: "observe", text: "Remember the garage door code is changed monthly" })).body.result; assert.equal(o.classification, "PERSONAL");
    assert.equal((await post({ op: "observe", text: "token sk-" + "q".repeat(30) })).status, 400);
    assert.equal((await post({ op: "search", query: "garage door" })).body.result.results.length, 1);
    assert.equal((await post({ op: "correct", id: o.id, text: "Remember the garage door code is changed quarterly", reason: "fix" })).body.result.version, 2);
    assert.equal((await post({ op: "history", id: o.id })).body.result.previous.length, 1);
    const doc = await createDocumentCenter({ dir: path.join(stateDir, "documents"), media: createModalityFabric() }).ingest({ filePath: (() => { const f = path.join(src, "desk.jpg"); fs.writeFileSync(f, JPEG(640, 480, exifBlock({ gps: true }))); return f; })(), tenantId: "JOCI" });
    assert.equal((await post({ op: "observeDocument", documentId: doc.id })).status, 400, "no consent => refused");
    const m = (await post({ op: "observeDocument", documentId: doc.id, consent: { granted: true, by: "OWNER", purpose: "inventory" } })).body.result; assert.equal(m.classification, "CONFIDENTIAL"); assert.match(m.text, /metadata only/); assert.equal(m.rawMediaStored, false);
    assert.equal((await post({ op: "observeDocument", documentId: "nope", consent: { granted: true, by: "OWNER", purpose: "x" } })).status, 400);
    assert.equal((await post({ op: "forgetAll", confirm: "nope" })).status, 400); assert.equal((await post({ op: "forgetWhere", filter: {} })).status, 400); assert.equal((await post({ op: "wipe" })).status, 400);
    assert.equal((await post({ op: "forget", id: o.id, reason: "done" })).body.result.deleted, true);
    const v = (await call(port, token, "GET", "/api/observations")).body; assert.equal(v.state, "CONNECTED"); assert.equal(v.summary.total, 1); assert.equal(v.summary.deleted, 1);
    assert.equal((await post({ op: "forgetAll", confirm: "JOCI" })).body.result.deleted, 1); assert.equal((await call(port, token, "GET", "/api/observations")).body.summary.total, 0);
    const f = path.join(stateDir, "memory", "observations.json"); fs.writeFileSync(f, "{x");
    assert.equal((await call(port, token, "GET", "/api/observations")).body.state, "UNREADABLE"); assert.equal(fs.readFileSync(f, "utf8"), "{x");
  } finally { await cc.close?.(); rm(base); rm(src); }
});
