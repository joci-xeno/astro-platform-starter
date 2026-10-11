// W6 Global Business §7: automatic model evolution on top of model-registry (fake adapters, fixed prompts, no network, no spend).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createModelEvolution, parseJudgeScore, policySubject, validatePolicy, DEFAULT_POLICY } from "../atlasz-addons/model-evolution.mjs";
import { createModelRegistry, modelConfigHash } from "../atlasz-addons/model-registry.mjs";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { tmp, rm } from "./helpers.mjs";

const kp = generateOwnerKeyPair(), other = generateOwnerKeyPair();
const ap = (action, subject, k = kp) => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action, subject });
/** A well-behaved fake model: answers the compatibility prompts correctly and tags its benchmark answers. */
const goodModel = (tag, cost = 0) => async p => ({ costUsd: cost, text: /READY/.test(p) ? "READY" : /JSON object/.test(p) ? "{\"status\":\"ok\",\"items\":[]}" : /17 \+ 25/.test(p) ? "42" : `${tag}: concise answer.` });
const judgeBy = scores => async p => { const m = /ANSWER:\n(\w+):/.exec(p); return { costUsd: 0, text: "reasoning...\nSCORE: " + (scores[m?.[1]] ?? 5) }; };

function mk({ adapters = {}, ...o } = {}) {
  const dir = tmp("mevo-"), auth = createOwnerAuth({ publicKeyB64: kp.publicKeyB64 });
  const reg = createModelRegistry({ dir: path.join(dir, "reg"), ownerAuth: auth, gate: () => ({ allowed: true }) });
  reg.seedDefaults();
  assert.equal(reg.addProvider({ id: "lab-local", displayName: "Lab local", kind: "LOCAL", family: "lab", egressHosts: ["127.0.0.1"] }).ok, true);
  assert.equal(reg.addProvider({ id: "judge-local", displayName: "Judge local", kind: "LOCAL", family: "judgefam", egressHosts: ["127.0.0.1"] }).ok, true);
  reg.addModel({ id: "base-local", providerId: "ollama-local", version: "1.0.0", costClass: "FREE", capabilities: ["text"] }); reg.enable("base-local");
  reg.addModel({ id: "judge-local", providerId: "judge-local", version: "1.0.0", costClass: "FREE", capabilities: ["text"] }); reg.enable("judge-local");
  reg.setRoleDefault("EXECUTION", ["base-local"]);
  const all = { "base-local": goodModel("BASE"), "judge-local": judgeBy({ CAND: 8, BASE: 6, GPT: 9 }), "cand-local": goodModel("CAND"), ...adapters };
  let tick = 0;
  const open = (x = {}) => createModelEvolution({ dir: path.join(dir, "evo"), registry: reg, ownerAuth: auth, adapters: all, clock: () => (tick += 10), ...o, ...x });
  return { dir, reg, auth, evo: open(), open, adapters: all, done: () => rm(dir) };
}
const CAT = (models) => JSON.stringify({ models });
const LOCAL_CAND = { id: "cand-local", providerId: "lab-local", version: "1.0.0", capabilities: ["text"], costClass: "FREE" };
const CLOUD_CAND = { id: "gpt-new", providerId: "openai", version: "1.0.0", capabilities: ["text"], costClass: "PAID", costPer1kTokensUsd: 0.01 };
async function toRecommended(t) {
  t.evo.discoverFromCatalogue(CAT([LOCAL_CAND]));
  assert.equal((await t.evo.runCompatibility("cand-local@1.0.0")).compatible, true);
  const b = await t.evo.benchmark("cand-local@1.0.0", { baselineId: "base-local", judgeId: "judge-local" }); assert.equal(b.verdict, "RECOMMEND", JSON.stringify(b.benchmark?.reasons));
}

test("discovery from an injected catalogue: models added DISABLED, version bumps of existing ids are notices only, malformed entries rejected", () => {
  const t = mk(); try {
    const r = t.evo.discoverFromCatalogue(CAT([LOCAL_CAND, CLOUD_CAND, { id: "base-local", version: "2.0.0" }, { id: "Bad Id", version: "1" }, { id: "nover", providerId: "openai" }, { id: "freecloud", providerId: "openai", version: "1.0.0", capabilities: ["text"], costClass: "FREE" }]));
    assert.deepEqual(r.added.sort(), ["cand-local@1.0.0", "gpt-new@1.0.0"]); assert.equal(r.versionNotices[0].announcedVersion, "2.0.0"); assert.equal(r.rejected.length, 3);
    assert.equal(t.reg.getModel("gpt-new").enabled, false); assert.equal(t.reg.getModel("base-local").version, "1.0.0", "never upgraded in place");
    assert.equal(t.evo.get("gpt-new@1.0.0").state, "DISCOVERED");
  } finally { t.done(); }
});

test("malformed / oversized catalogues fail closed", () => {
  const t = mk(); try {
    assert.equal(t.evo.discoverFromCatalogue("{nope").reason, "CATALOGUE_NOT_JSON");
    assert.equal(t.evo.discoverFromCatalogue("{\"items\":[]}").reason, "CATALOGUE_SCHEMA");
    assert.equal(t.evo.discoverFromCatalogue("x".repeat(300 * 1024)).reason, "CATALOGUE_TOO_LARGE");
    assert.equal(t.evo.discoverFromCatalogue(CAT(Array.from({ length: 201 }, (_, i) => ({ id: "m" + i })))).reason, "CATALOGUE_TOO_MANY_ENTRIES");
    assert.equal(t.evo.discoverFromCatalogue(42).reason, "CATALOGUE_TEXT_REQUIRED");
  } finally { t.done(); }
});

test("lifecycle: illegal transitions are refused (approve/rollout before recommendation)", async () => {
  const t = mk(); try {
    t.evo.discoverFromCatalogue(CAT([LOCAL_CAND]));
    assert.equal(t.evo.approve("cand-local@1.0.0").reason, "WRONG_STATE:DISCOVERED");
    assert.equal(t.evo.rollout("cand-local@1.0.0", { target: { role: "EXECUTION" } }).reason, "WRONG_STATE:DISCOVERED");
    assert.equal((await t.evo.benchmark("cand-local@1.0.0", { baselineId: "base-local", judgeId: "judge-local" })).reason, "COMPATIBILITY_MUST_PASS_FIRST");
    assert.equal(t.evo.reject("cand-local@1.0.0").ok, true); assert.match(t.evo.reject("cand-local@1.0.0").reason, /ILLEGAL_TRANSITION:REJECTED/);
  } finally { t.done(); }
});

test("compatibility suite: a model failing a fixed check (or without an adapter) is REJECTED with per-prompt evidence", async () => {
  const t = mk({ adapters: { "cand-local": async () => ({ text: "I cannot comply", costUsd: 0 }) } }); try {
    t.evo.discoverFromCatalogue(CAT([LOCAL_CAND, { ...LOCAL_CAND, id: "no-adapter" }]));
    const r = await t.evo.runCompatibility("cand-local@1.0.0"); assert.equal(r.compatible, false); assert.equal(r.compat.passed, 1, "only the brevity check passes"); assert.equal(t.evo.get("cand-local@1.0.0").state, "REJECTED");
    const n = await t.evo.runCompatibility("no-adapter@1.0.0"); assert.equal(n.compatible, false); assert.equal(n.compat.results[0].error, "NO_ADAPTER");
  } finally { t.done(); }
});

test("adapter timeout, throwing adapter and oversized output all fail compatibility (bounded)", async () => {
  const t = mk({ adapters: { "slow": () => new Promise(() => {}), "boom": async () => { throw new Error("x"); }, "huge": async () => ({ text: "READY" + "x".repeat(30000) }) } }); try {
    const e2 = t.open({ adapterTimeoutMs: 20 });
    e2.discoverFromCatalogue(CAT(["slow", "boom", "huge"].map(id => ({ ...LOCAL_CAND, id }))));
    assert.equal((await e2.runCompatibility("slow@1.0.0")).compat.results[0].error, "ADAPTER_TIMEOUT");
    assert.equal((await e2.runCompatibility("boom@1.0.0")).compat.results[0].error, "ADAPTER_ERROR");
    assert.equal((await e2.runCompatibility("huge@1.0.0")).compatible, false);
  } finally { t.done(); }
});

test("A/B benchmark: independent judge of a third family, transparent scoring, free-local candidate RECOMMENDED", async () => {
  const t = mk(); try {
    await toRecommended(t);
    const c = t.evo.get("cand-local@1.0.0"), b = c.benchmark;
    assert.equal(c.state, "RECOMMENDED"); assert.equal(b.qualityDelta, 2); assert.equal(b.candidate.qualityMean, 8); assert.equal(b.baseline.qualityMean, 6);
    assert.equal(b.costRatio, 1); assert.equal(b.latencyRatio, 1); assert.match(b.formula, /0\.6\*\(quality\/10\)/); assert.equal(typeof b.composite, "number"); assert.equal(b.judgeFamily, "judgefam");
  } finally { t.done(); }
});

test("judge independence: same family as candidate or baseline, or the candidate itself, is refused", async () => {
  const t = mk({ adapters: { "lab-judge": judgeBy({}) } }); try {
    t.evo.discoverFromCatalogue(CAT([LOCAL_CAND])); t.reg.addModel({ id: "lab-judge", providerId: "lab-local", version: "1.0.0", costClass: "FREE", capabilities: ["text"] });
    await t.evo.runCompatibility("cand-local@1.0.0");
    assert.equal((await t.evo.benchmark("cand-local@1.0.0", { baselineId: "base-local", judgeId: "lab-judge" })).reason, "JUDGE_MUST_BE_FROM_A_DIFFERENT_FAMILY");
    assert.equal((await t.evo.benchmark("cand-local@1.0.0", { baselineId: "base-local", judgeId: "cand-local" })).reason, "JUDGE_MUST_BE_INDEPENDENT");
    assert.equal((await t.evo.benchmark("cand-local@1.0.0", { baselineId: "gpt-x-missing", judgeId: "judge-local" })).reason, "BASELINE_MUST_BE_AN_ENABLED_APPROVED_MODEL");
  } finally { t.done(); }
});

test("worse quality than baseline -> REJECTED; unparseable judge output -> INCONCLUSIVE (stays BENCHMARKING, never recommended)", async () => {
  const t = mk({ adapters: { "judge-local": judgeBy({ CAND: 3, BASE: 7 }) } }); try {
    await (async () => { t.evo.discoverFromCatalogue(CAT([LOCAL_CAND])); await t.evo.runCompatibility("cand-local@1.0.0"); })();
    const r = await t.evo.benchmark("cand-local@1.0.0", { baselineId: "base-local", judgeId: "judge-local" }); assert.equal(r.verdict, "REJECT"); assert.ok(r.benchmark.reasons.includes("QUALITY_BELOW_BASELINE"));
  } finally { t.done(); }
  const t2 = mk({ adapters: { "judge-local": async () => ({ text: "Great answer, 10 out of 10!", costUsd: 0 }) } }); try {
    t2.evo.discoverFromCatalogue(CAT([LOCAL_CAND])); await t2.evo.runCompatibility("cand-local@1.0.0");
    const r = await t2.evo.benchmark("cand-local@1.0.0", { baselineId: "base-local", judgeId: "judge-local" }); assert.equal(r.verdict, "INCONCLUSIVE"); assert.equal(t2.evo.get("cand-local@1.0.0").state, "BENCHMARKING");
  } finally { t2.done(); }
});

test("parseJudgeScore is strict: only a final 'SCORE: n' line in 0..10 counts", () => {
  assert.equal(parseJudgeScore("ok\nSCORE: 7"), 7); assert.equal(parseJudgeScore("SCORE: 10/10"), 10);
  for (const s of ["SCORE: 11", "SCORE: 7\nmore", "score 7", "SCORE: -1", "SCORE: 7.5", null, 7]) assert.equal(parseJudgeScore(s), null, String(s));
});

test("spend guard: calling a paid/cloud candidate needs a signed MODEL_BENCHMARK approval; forged and replayed approvals refused; unknown cost blocks recommendation", async () => {
  const t = mk({ adapters: { "gpt-new": async p => ({ ...(await goodModel("GPT")(p)), costUsd: undefined }) } }); try {
    t.evo.discoverFromCatalogue(CAT([CLOUD_CAND])); const id = "gpt-new@1.0.0", subj = "bench:" + id + ":" + t.evo.get(id).configHash;
    const r0 = await t.evo.runCompatibility(id); assert.equal(r0.reason, "OWNER_APPROVAL_REQUIRED_TO_CALL_PAID_OR_CLOUD_CANDIDATE"); assert.equal(r0.subject, subj);
    assert.equal((await t.evo.runCompatibility(id, { approval: ap("MODEL_BENCHMARK", subj, other) })).detail, "SIGNATURE_INVALID");
    const a = ap("MODEL_BENCHMARK", subj); assert.equal((await t.evo.runCompatibility(id, { approval: a })).compatible, true);
    const b = await t.evo.benchmark(id, { baselineId: "base-local", judgeId: "judge-local" }); assert.equal(b.verdict, "INCONCLUSIVE"); assert.ok(b.benchmark.reasons.includes("CANDIDATE_COST_UNKNOWN")); assert.equal(b.benchmark.candidate.costUsdTotal, null);
    // single-use: the approval cannot be replayed, and the grant is limited to a few guarded runs; after that a NEW approval is required (no permanent spend permission)
    assert.notEqual((await t.evo.runCompatibility(id, { approval: a })).ok, undefined); const t3 = t.open(); assert.ok(t.evo.audit().filter(e => e.event === "BENCHMARK_RUN_FROM_GRANT").length >= 2);
    let refused = null; for (let i = 0; i < 6 && !refused; i++) { const x = await t.evo.runCompatibility(id); if (!x.ok) refused = x.reason; }
    assert.equal(refused, "OWNER_APPROVAL_REQUIRED_TO_CALL_PAID_OR_CLOUD_CANDIDATE", "grant exhausted -> fresh approval needed");
    assert.equal((await t.evo.runCompatibility(id, { approval: a })).ok, false, "replayed approval refused");
  } finally { t.done(); }
});

test("paid/cloud upgrade: never auto-approved in any mode; needs the owner's MODEL_ENABLE approval via registry.enable bound to the exact config", async () => {
  const t = mk({ adapters: { "gpt-new": goodModel("GPT", 0.001) } }); try {
    t.evo.discoverFromCatalogue(CAT([CLOUD_CAND])); const id = "gpt-new@1.0.0";
    const bs = "bench:" + id + ":" + t.evo.get(id).configHash; await t.evo.runCompatibility(id, { approval: ap("MODEL_BENCHMARK", bs) });
    t.adapters["base-local"] = goodModel("BASE", 0.001);
    const b = await t.evo.benchmark(id, { baselineId: "base-local", judgeId: "judge-local" }); assert.equal(b.verdict, "RECOMMEND", JSON.stringify(b.benchmark.reasons));
    t.evo.setPolicy({ ...DEFAULT_POLICY, mode: "AUTO_FOR_FREE_LOCAL" }, { approval: ap("MODEL_EVOLUTION_POLICY", policySubject({ ...DEFAULT_POLICY, mode: "AUTO_FOR_FREE_LOCAL" })) });
    assert.equal(t.evo.approve(id, { auto: true }).reason, "PAID_OR_CLOUD_NEVER_AUTO_APPROVED");
    const m = t.reg.getModel("gpt-new"), es = t.reg.enableSubject(m);
    assert.equal(t.evo.approve(id).reason, "REGISTRY_ENABLE_REFUSED");
    assert.equal(t.evo.approve(id, { approval: ap("MODEL_ENABLE", "model:gpt-new@9.9.9:x") }).detail, "SUBJECT_MISMATCH");
    assert.equal(t.evo.approve(id, { approval: ap("MODEL_EVOLUTION_APPROVE", "evo:" + id + ":" + modelConfigHash(m)) }).reason, "REGISTRY_ENABLE_REFUSED", "the evolution approval cannot substitute for MODEL_ENABLE");
    assert.equal(t.evo.approve(id, { approval: ap("MODEL_ENABLE", es) }).ok, true); assert.equal(t.reg.getModel("gpt-new").enabled, true); assert.equal(t.evo.get(id).state, "APPROVED_FOR_ROLLOUT");
  } finally { t.done(); }
});

test("free local in MANUAL mode still needs the owner's MODEL_EVOLUTION_APPROVE; auto approval refused outside AUTO_FOR_FREE_LOCAL", async () => {
  const t = mk(); try {
    await toRecommended(t); const id = "cand-local@1.0.0", subj = "evo:" + id + ":" + t.evo.get(id).configHash;
    assert.equal(t.evo.approve(id, { auto: true }).reason, "AUTO_APPROVAL_NOT_ALLOWED_IN_MODE:MANUAL");
    assert.equal(t.evo.approve(id).reason, "OWNER_APPROVAL_REQUIRED");
    const a = ap("MODEL_EVOLUTION_APPROVE", subj); assert.equal(t.evo.approve(id, { approval: a }).ok, true); assert.equal(t.reg.getModel("cand-local").enabled, true);
  } finally { t.done(); }
});

test("policy: change needs a signed approval bound to the exact policy; replay refused; a hand-edited policy on disk falls back to MANUAL", async () => {
  const t = mk(); try {
    const p = { ...DEFAULT_POLICY, mode: "RECOMMEND_ONLY" };
    assert.equal(t.evo.setPolicy(p).reason, "OWNER_APPROVAL_REQUIRED");
    assert.equal(t.evo.setPolicy({ ...p, mode: "AUTO_EVERYTHING" }).reason, "MODE_INVALID");
    assert.equal(t.evo.setPolicy(p, { approval: ap("MODEL_EVOLUTION_POLICY", policySubject({ ...p, mode: "AUTO_FOR_FREE_LOCAL" })) }).detail, "SUBJECT_MISMATCH");
    const a = ap("MODEL_EVOLUTION_POLICY", policySubject(p)); assert.equal(t.evo.setPolicy(p, { approval: a }).ok, true); assert.equal(t.evo.setPolicy(p, { approval: a }).detail, "REPLAY_DETECTED");
    assert.equal(t.open().policy().mode, "RECOMMEND_ONLY");
    const f = path.join(t.dir, "evo", "model-evolution.json"), s = JSON.parse(fs.readFileSync(f, "utf8")); s.policy.mode = "AUTO_FOR_FREE_LOCAL"; fs.writeFileSync(f, JSON.stringify(s));
    assert.equal(t.open().policy().mode, "MANUAL");
    assert.equal(validatePolicy({ maxErrorRate: 5 }).error, "POLICY_VALUE_OUT_OF_BOUNDS"); assert.equal(validatePolicy({ sneaky: 1 }).error, "POLICY_FIELD_UNKNOWN");
  } finally { t.done(); }
});

test("autoCycle: MANUAL does nothing; AUTO_FOR_FREE_LOCAL rolls out a free local winner while a paid candidate stays untouched (no approval -> not even called)", async () => {
  let gptCalls = 0; const t = mk({ adapters: { "gpt-new": async p => { gptCalls++; return goodModel("GPT", 0.01)(p); } } }); try {
    t.evo.discoverFromCatalogue(CAT([LOCAL_CAND, CLOUD_CAND]));
    assert.equal((await t.evo.autoCycle({ baselineId: "base-local", judgeId: "judge-local" })).actions.length, 0);
    const pol = { ...DEFAULT_POLICY, mode: "AUTO_FOR_FREE_LOCAL" }; t.evo.setPolicy(pol, { approval: ap("MODEL_EVOLUTION_POLICY", policySubject(pol)) });
    const r = await t.evo.autoCycle({ baselineId: "base-local", judgeId: "judge-local", target: { role: "EXECUTION" } });
    assert.equal(t.evo.get("cand-local@1.0.0").state, "ROLLED_OUT"); assert.deepEqual(t.reg.roleDefaults().EXECUTION, ["cand-local", "base-local"]);
    assert.equal(t.evo.get("gpt-new@1.0.0").state, "DISCOVERED"); assert.equal(gptCalls, 0); assert.ok(JSON.stringify(r.actions).includes("OWNER_APPROVAL_REQUIRED_PER_RUN"));
  } finally { t.done(); }
});

test("rollout to named permanent agents records the previous assignment; revert restores it and disables the candidate (no approval needed: risk-reducing)", async () => {
  const t = mk(); try {
    t.reg.setAssignment("EXECUTION-4", { primary: "base-local", capability: "text" });
    await toRecommended(t); const id = "cand-local@1.0.0"; t.evo.approve(id, { approval: ap("MODEL_EVOLUTION_APPROVE", "evo:" + id + ":" + t.evo.get(id).configHash) });
    assert.equal(t.evo.rollout(id, { target: { agentIds: ["EXECUTION-4", "EXECUTION-31"] } }).reason, "NOT_ONE_OF_THE_30_PERMANENT_AGENTS");
    assert.equal(t.evo.rollout(id, { target: { agentIds: ["EXECUTION-4", "SEARCH-2"] } }).ok, true);
    assert.equal(t.reg.assignments()["EXECUTION-4"].primary, "cand-local"); assert.deepEqual(t.reg.assignments()["EXECUTION-4"].fallbacks, ["base-local"]);
    const rv = t.evo.revert(id, { reason: "owner request" }); assert.equal(rv.ok, true);
    assert.equal(t.reg.assignments()["EXECUTION-4"].primary, "base-local"); assert.equal(t.reg.assignments()["SEARCH-2"], undefined); assert.equal(t.reg.getModel("cand-local").enabled, false);
    assert.equal(t.evo.get(id).state, "ROLLED_BACK"); assert.equal(t.evo.reportHealth(id, { samples: 1, errors: 0 }).reason, "WRONG_STATE:ROLLED_BACK");
  } finally { t.done(); }
});

test("health monitor auto-reverts when the error rate exceeds the policy threshold after enough samples", async () => {
  const t = mk(); try {
    await toRecommended(t); const id = "cand-local@1.0.0"; t.evo.approve(id, { approval: ap("MODEL_EVOLUTION_APPROVE", "evo:" + id + ":" + t.evo.get(id).configHash) }); t.evo.rollout(id, { target: { role: "EXECUTION" } });
    assert.equal(t.evo.reportHealth(id, { samples: 10, errors: 9 }).autoReverted, false, "below minHealthSamples");
    assert.equal(t.evo.reportHealth(id, { samples: 5, errors: 6 }).reason, "HEALTH_INVALID");
    const r = t.evo.reportHealth(id, { samples: 10, errors: 1 }); assert.equal(r.autoReverted, true); assert.deepEqual(t.reg.roleDefaults().EXECUTION, ["base-local"]);
  } finally { t.done(); }
});

test("registry snapshot rollback needs the owner's MODEL_REGISTRY_ROLLBACK approval for the recorded pre-rollout revision", async () => {
  const t = mk(); try {
    await toRecommended(t); const id = "cand-local@1.0.0"; t.evo.approve(id, { approval: ap("MODEL_EVOLUTION_APPROVE", "evo:" + id + ":" + t.evo.get(id).configHash) }); t.evo.rollout(id, { target: { role: "EXECUTION" } });
    const rev = t.evo.get(id).rollout.preRevision, subj = t.reg.rollbackSubject(rev);
    assert.equal(t.evo.rollbackRegistry(id).reason, "REGISTRY_ROLLBACK_REFUSED");
    assert.equal(t.evo.rollbackRegistry(id, { approval: ap("MODEL_REGISTRY_ROLLBACK", subj, other) }).reason, "REGISTRY_ROLLBACK_REFUSED");
    assert.equal(t.evo.rollbackRegistry(id, { approval: ap("MODEL_REGISTRY_ROLLBACK", subj) }).ok, true);
    assert.deepEqual(t.reg.roleDefaults().EXECUTION, ["base-local"]); assert.equal(t.evo.get(id).state, "ROLLED_BACK"); assert.equal(t.evo.auditVerify().ok, true);
  } finally { t.done(); }
});

test("a model whose registry config changed after discovery cannot be benchmarked or approved on the old evidence", async () => {
  const t = mk(); try {
    await toRecommended(t); t.reg.editModel("cand-local", { capabilities: ["text", "code"] });
    assert.equal(t.evo.approve("cand-local@1.0.0", { approval: ap("MODEL_EVOLUTION_APPROVE", "evo:x") }).reason, "MODEL_CONFIG_CHANGED_SINCE_BENCHMARK");
  } finally { t.done(); }
});

test("deprecation tracking: in-use models retiring soon -> FIND_REPLACEMENT; retired and still assigned -> alert; evidence URL required", () => {
  const t = mk({ now: () => "2026-10-10T00:00:00.000Z" }); try {
    assert.equal(t.evo.recordDeprecation({ modelId: "base-local", retiresAt: "2026-10-20", sourceId: "fx-changelog" }).reason, "EVIDENCE_URL_REQUIRED");
    assert.equal(t.evo.recordDeprecation({ modelId: "base-local", retiresAt: "2026-10-20", evidenceUrl: "https://changelog.fixture-provider.org/deprecations", sourceId: "fx-changelog" }).ok, true);
    assert.equal(t.evo.recordDeprecation({ modelId: "judge-local", retiresAt: "2026-10-01", evidenceUrl: "https://changelog.fixture-provider.org/d2", sourceId: "fx-changelog" }).ok, true);
    t.evo.recordDeprecation({ modelId: "unused-model", retiresAt: "2026-10-12", evidenceUrl: "https://changelog.fixture-provider.org/d3", sourceId: "fx-changelog" });
    const r = t.evo.deprecationReport({ withinDays: 30 }).items;
    assert.deepEqual(r.map(x => x.type).sort(), ["FIND_REPLACEMENT", "RETIRED_STILL_IN_USE"]); assert.deepEqual(r.find(x => x.modelId === "base-local").roles, ["EXECUTION"]);
  } finally { t.done(); }
});

test("a leftover manual spend grant is never used by autoCycle, and editing the state file cannot create runs", async () => {
  let gptCalls = 0; const t = mk({ adapters: { "gpt-new": async p => { gptCalls++; return goodModel("GPT", 0.01)(p); } } }); try {
    t.evo.discoverFromCatalogue(CAT([CLOUD_CAND])); const id = "gpt-new@1.0.0", subj = "bench:" + id + ":" + t.evo.get(id).configHash;
    await t.evo.runCompatibility(id, { approval: ap("MODEL_BENCHMARK", subj) }); const before = gptCalls;
    const pol = { ...DEFAULT_POLICY, mode: "RECOMMEND_ONLY" }; t.evo.setPolicy(pol, { approval: ap("MODEL_EVOLUTION_POLICY", policySubject(pol)) });
    const r = await t.evo.autoCycle({ baselineId: "base-local", judgeId: "judge-local" }); assert.equal(gptCalls, before, JSON.stringify(r.actions));
    for (const f of fs.readdirSync(t.dir)) if (f.endsWith(".json")) { const p = path.join(t.dir, f); try { const j = JSON.parse(fs.readFileSync(p, "utf8")); const w = o => { if (o && typeof o === "object") for (const k of Object.keys(o)) { if (k === "runsLeft" || k === "benchGrant") o[k] = 999999; else w(o[k]); } }; w(j); fs.writeFileSync(p, JSON.stringify(j)); } catch { /* not state */ } }
    const t2 = t.open(); let refused = null; for (let i = 0; i < 6 && !refused; i++) { const x = await t2.runCompatibility(id); if (!x.ok) refused = x.reason; } assert.equal(refused, "OWNER_APPROVAL_REQUIRED_TO_CALL_PAID_OR_CLOUD_CANDIDATE");
  } finally { t.done(); }
});
