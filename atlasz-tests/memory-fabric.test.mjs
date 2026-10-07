// Package §1/§23: Knowledge Brain integrated with Business Memory, Experience Learning and the Entity Graph through ONE governed facade;
// simulation runs persist and compare. Negative tests: model output never becomes fact; unverified outcomes never reward; tenants and scopes never leak.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createKnowledgeBrain } from "../atlasz-addons/brain/knowledge-brain.mjs";
import { createMemoryFabric } from "../atlasz-addons/brain/memory-fabric.mjs";
import { createSimulationLab } from "../atlasz-addons/brain/simulation-lab.mjs";
import { createBrainSystem } from "../atlasz-addons/brain/brain-system.mjs";
import * as bm from "../atlasz-addons/business-memory.mjs";
import * as xp from "../atlasz-addons/experience-learning-engine.mjs";
import * as eg from "../atlasz-addons/unified-entity-graph.mjs";
import { ownerAuth, sign, roster } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

const T = () => "T" + crypto.randomUUID().slice(0, 6);
const fab = (d, extra = {}) => { const k = createKnowledgeBrain({ file: d ? path.join(d, "k.json") : null, ownerAuth }); return { k, f: createMemoryFabric({ knowledge: k, businessMemory: bm, experience: xp, entityGraph: eg, ...extra }) }; };
const EV = { source: "ledger", reference: "r1" };

test("remember() routes one record to Knowledge Brain + Business Memory + Entity Graph with source/time/provenance/confidence/scope/owner/verification", () => {
  const { f } = fab(null), t = T();
  const r = f.remember({ tenantId: t, key: "client.pref", value: "prefers email", kind: "FACT", source: { type: "DOCUMENT", ref: "doc-1" }, evidenceRef: EV, confidence: 0.9, entity: { type: "CUSTOMER", id: "c1", attributes: { name: "Acme" } }, links: [{ relation: "HAS_JOB", toType: "JOB", toId: "j1" }] });
  assert.equal(r.kind, "FACT"); assert.equal(r.verificationState, "VERIFIED"); assert.equal(r.scope, "BUSINESS"); assert.equal(r.owner, t);
  assert.deepEqual(r.mirrors.sort(), ["BUSINESS_MEMORY", "ENTITY_GRAPH"]); assert.ok(r.time && r.source.ref === "doc-1" && r.provenance.evidenceRef);
  const rc = f.recall({ tenantId: t, query: "email", entity: { type: "CUSTOMER", id: "c1" } });
  assert.equal(rc.items.length, 1); assert.equal(rc.mirrored.length, 1); assert.match(rc.mirrored[0].text, /^\[VERIFIED\/FACT\]/);
  assert.equal(rc.graph.root.attributes.name, "Acme"); assert.equal(rc.graph.relationships[0].relation, "HAS_JOB");
});

test("NEGATIVE: unverified model output never becomes a trusted fact in ANY backing store", () => {
  const { f } = fab(null), t = T();
  const m = f.remember({ tenantId: t, key: "market.size", value: "10B", kind: "FACT", source: { type: "MODEL", ref: "gpt" }, evidenceRef: EV, entity: { type: "MARKET", id: "m" } });
  assert.equal(m.kind, "INFERENCE"); assert.equal(m.verificationState, "INFERRED");
  const n = f.remember({ tenantId: t, key: "x", value: "y", kind: "FACT", source: { type: "WEB", ref: "u" }, entity: { type: "MARKET", id: "m" } });
  assert.equal(n.kind, "UNVERIFIED"); assert.equal(n.verificationState, "UNVERIFIED");
  const rc = f.recall({ tenantId: t, entity: { type: "MARKET", id: "m" } });
  assert.ok(rc.items.every(i => i.verificationState !== "VERIFIED")); assert.ok(rc.mirrored.every(i => i.verificationState === "UNVERIFIED"));
  assert.throws(() => f.remember({ tenantId: t, key: "p", value: 1, kind: "OWNER_DECISION", source: { type: "OWNER" } }), /OWNER_APPROVAL_REQUIRED/);   // cannot fabricate an owner decision
});

test("outcomes: only an independently verified outcome with evidence becomes a HISTORICAL_RESULT and rewards experience; lessons stay candidates until the owner approves", () => {
  const { f, k } = fab(null), t = T();
  const bad = f.recordOutcome({ tenantId: t, jobId: "j1", taskType: "SCREEN", outcome: "DONE", verification: { verdict: "ACCEPT", independent: false }, evidenceRef: EV, reward: 50, lessons: ["always cite source"] });
  assert.equal(bad.verified, false); assert.equal(bad.kind, "UNVERIFIED");
  assert.equal(xp.lessonsFor({ tenantId: t, taskType: "SCREEN" }).length, 0);                       // nothing approved
  const good = f.recordOutcome({ tenantId: t, jobId: "j2", taskType: "SCREEN", outcome: "DONE", verification: { verdict: "ACCEPT", independent: true }, evidenceRef: EV, reward: 50, lessons: ["check duplicate first"] });
  assert.equal(good.verified, true); assert.equal(good.kind, "HISTORICAL_RESULT"); assert.equal(good.lessonCandidates, 1);
  assert.equal(f.recall({ tenantId: t, query: "duplicate", taskType: "SCREEN" }).approvedLessons.length, 0);   // candidate is not usable
  const lessonId = Object.values(JSON.parse(JSON.stringify(k.summary(t)))).length && null;
  const noEv = f.recordOutcome({ tenantId: t, jobId: "j3", taskType: "SCREEN", outcome: "DONE", verification: { verdict: "ACCEPT", independent: true }, reward: 9 });
  assert.equal(noEv.verified, false);                                                               // independent but no evidence -> not trusted
  assert.equal(f.jobHistory(t, "j2").length, 1);
});

test("lesson lifecycle: proposed -> owner-approved (signed) -> usable; a forged approval is refused", () => {
  const { f, k } = fab(null), t = T();
  f.recordOutcome({ tenantId: t, jobId: "jL", taskType: "X", outcome: "DONE", verification: { verdict: "ACCEPT", independent: true }, evidenceRef: EV, lessons: ["verify before send"] });
  const lid = k.proposeLesson({ tenantId: t, text: "second candidate" }).id ?? null;
  assert.ok(lid);
  assert.throws(() => f.approveLesson(lid, null), /OWNER_APPROVAL_REQUIRED/);
  assert.throws(() => f.approveLesson(lid, sign("ADOPT_LESSON", "some-other-lesson")), /OWNER_APPROVAL_REQUIRED/);   // approval bound to a different subject
  f.approveLesson(lid, sign("ADOPT_LESSON", lid));
  assert.equal(f.recall({ tenantId: t, query: "second candidate" }).approvedLessons.length, 1);
  assert.equal(f.recall({ tenantId: t, query: "verify before send" }).approvedLessons.length, 0);   // the other candidate is still unapproved
});

test("TENANT ISOLATION: tenant B never sees tenant A in knowledge, business memory, graph or lessons", () => {
  const { f } = fab(null), a = T(), b = T();
  f.remember({ tenantId: a, key: "secret.plan", value: "A-only", kind: "FACT", source: { type: "DOCUMENT" }, evidenceRef: EV, entity: { type: "CUSTOMER", id: "shared-id" } });
  const rb = f.recall({ tenantId: b, query: "secret plan A-only", entity: { type: "CUSTOMER", id: "shared-id" } });
  assert.equal(rb.items.length, 0); assert.equal(rb.mirrored.length, 0); assert.equal(rb.graph.root, null); assert.equal(rb.graph.relationships.length, 0);
  assert.throws(() => f.recall({ query: "x" }), /TENANT_REQUIRED/);
});

test("SCOPE SEPARATION: PERSONAL data is invisible unless the caller explicitly asks for PERSONAL; customer work cannot pull personal memory", () => {
  const { f } = fab(null), t = T();
  f.remember({ tenantId: t, scope: "PERSONAL", key: "health.note", value: "dentist tuesday", kind: "FACT", source: { type: "OWNER" }, evidenceRef: EV, entity: { type: "PERSON", id: "joci" } });
  f.remember({ tenantId: t, scope: "BUSINESS", key: "biz.note", value: "invoice terms net30", kind: "FACT", source: { type: "DOCUMENT" }, evidenceRef: EV, entity: { type: "PERSON", id: "joci" } });
  const work = f.recall({ tenantId: t, query: "dentist tuesday", entity: { type: "PERSON", id: "joci" } });
  assert.equal(work.items.length, 0); assert.ok(!JSON.stringify(work).includes("dentist"));
  const personal = f.recall({ tenantId: t, query: "dentist", scopes: ["PERSONAL"], entity: { type: "PERSON", id: "joci" } });
  assert.equal(personal.items.length, 1); assert.ok(!JSON.stringify(personal).includes("net30"));
  assert.throws(() => f.remember({ tenantId: t, scope: "SECRETS", key: "k", value: 1, kind: "UNVERIFIED", source: { type: "SYSTEM" } }), /BAD_SCOPE/);
});

test("Brain system wires the fabric; a verified governed job writes a verified outcome into memory, an unverified one writes nothing trusted", async () => {
  const d = tmp("mf-"); const r = roster(); let verdict = "VERIFIED";
  const b = createBrainSystem({ dir: d, ownerAuth, roster: r, chain: { evaluate: () => ({ allowed: true, verdict: "ALLOW", reason: "TEST" }) }, gate: () => ({ allowed: true }),
    executors: Object.fromEntries(r.map(a => [a.id, async () => ({ claimType: "INTERNAL_RECORD", claim: { kind: "S", executorId: a.id }, summary: "ok", quality: 1 })])), lookups: { internalRecord: () => ({ status: verdict, reason: "T" }) } });
  assert.ok(b.memory);
  b.dispatch.submit({ id: "mem-j1", kind: "SCREENING", payload: { task: { candidateId: "x" } } });
  assert.equal((await b.dispatch.run("mem-j1")).status, "DONE");
  const h = b.memory.jobHistory("ATLASZ", "mem-j1"); assert.equal(h.length, 1); assert.equal(h[0].kind, "HISTORICAL_RESULT"); assert.equal(h[0].verificationState, "VERIFIED");
  verdict = "FAILED_VERIFICATION";
  b.dispatch.submit({ id: "mem-j2", kind: "SCREENING", payload: { task: { candidateId: "y" } } });
  assert.notEqual((await b.dispatch.run("mem-j2")).status, "DONE");
  assert.equal(b.memory.jobHistory("ATLASZ", "mem-j2").length, 0);                                    // nothing learned from an unverified job
  rm(d);
});

test("simulation runs persist (id, version, config, input, planned action, result, tests, failures, risk, evidence, timestamp), survive restart, and compare", () => {
  const d = tmp("simp-"); const file = path.join(d, "sims.json");
  const lab = createSimulationLab({ file });
  const a = lab.change({ kind: "CONFIG_CHANGE", name: "raise limit", state: { limit: 1 }, mutate: s => { s.limit = 2; }, invariants: [{ name: "limit<=5", check: s => s.limit <= 5 }] });
  const b = lab.change({ kind: "CONFIG_CHANGE", name: "raise limit again", state: { limit: 1 }, mutate: s => { s.limit = 9; }, invariants: [{ name: "limit<=5", check: s => s.limit <= 5 }] });
  const c = lab.run({ name: "tries to publish", kind: "AUTOMATION", state: {}, scenario: w => { w.live.publish(); } });
  for (const k of ["id", "recordVersion", "config", "input", "plannedAction", "verdict", "tests", "failures", "risk", "evidence", "at"]) assert.ok(k in a, k);
  assert.equal(a.risk, "LOW"); assert.equal(b.risk, "HIGH"); assert.equal(c.risk, "CRITICAL"); assert.equal(b.failures, 1);
  const lab2 = createSimulationLab({ file });                                                           // "restart"
  assert.equal(lab2.runs().length, 3); assert.equal(lab2.get(b.id).verdict, "FAIL");
  const n = lab2.change({ kind: "X", name: "n", state: {}, mutate: () => {} }); assert.equal(n.id, "sim-4");   // ids continue, never reused
  const cmp = lab2.compare(a.id, b.id);
  assert.equal(cmp.comparable, true); assert.equal(cmp.same, false); assert.deepEqual(cmp.newFailures, ["INVARIANT_FAILED:limit<=5"]);
  assert.equal(lab2.compare(a.id, a.id).same, true);
  assert.throws(() => lab2.compare("sim-1", "nope"), /UNKNOWN_RUN/);
  assert.throws(() => lab2.run({ name: "l", environment: "LIVE", scenario: () => ({}) }), /CANNOT_RUN_LIVE/);   // environments stay isolated
  fs.writeFileSync(file, "{not json"); assert.throws(() => createSimulationLab({ file }), /SIMULATION_STORE_UNREADABLE/);   // corrupt store is never silently replaced
  rm(d);
});
