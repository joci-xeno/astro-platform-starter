// 23-point 4/5/6/18 + owner expandability: model & provider registry (config only; LIVE comes from gateway evidence, never from this file).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createModelRegistry, SEED_PROVIDERS, modelConfigHash, needsApproval } from "../atlasz-addons/model-registry.mjs";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { ROSTER } from "../atlasz-addons/agent-activity.mjs";
import { tmp, rm } from "./helpers.mjs";

const kp = generateOwnerKeyPair(), ap = (action, subject) => issueOwnerApproval({ privateKeyPem: kp.privateKeyPem, action, subject });
function mk(over = {}) {
  const dir = tmp("mreg-"), live = new Set(), creds = new Set(), auth = createOwnerAuth({ publicKeyB64: kp.publicKeyB64 });
  const open = (o = {}) => createModelRegistry({ dir, ownerAuth: auth, liveStatus: id => live.has(id), hasCredential: r => creds.has(r), gate: () => ({ allowed: true }), ...over, ...o });
  const reg = open(); reg.seedDefaults();
  reg.addModel({ id: "gpt-x", providerId: "openai", version: "1.0.0", costClass: "PAID", costPer1kTokensUsd: 0.01, capabilities: ["text", "code"] });
  reg.addModel({ id: "llama-local", providerId: "ollama-local", version: "1.0.0", costClass: "FREE", capabilities: ["text"] });
  return { reg, dir, live, creds, auth, open, done: () => rm(dir) };
}

test("seeded providers are data only; models start DISABLED and never LIVE from configuration", () => {
  const t = mk(); try {
    assert.equal(t.reg.listProviders().length, SEED_PROVIDERS.length); const m = t.reg.getModel("gpt-x");
    assert.equal(m.enabled, false); assert.equal(m.status, "DISABLED"); assert.equal(m.live, false); assert.equal(m.usable, false); assert.equal(t.reg.status().live, 0);
    assert.equal(t.reg.status().agents, 30);
  } finally { t.done(); }
});

test("provider and model input validation: wildcard/userinfo/port hosts, secrets in names, credential values, cloud FREE claims", () => {
  const t = mk(); try {
    const P = (o) => t.reg.addProvider({ id: "p1", displayName: "P", kind: "CLOUD", egressHosts: ["api.example.com"], ...o });
    for (const h of ["*.example.com", "user@api.example.com", "api.example.com:8443", "127.0.0.1", "localhost", "http://api.example.com", "10.0.0.5", "a_b.example.com"]) assert.equal(P({ egressHosts: [h] }).ok, false, h);
    assert.equal(P({ displayName: "key sk-" + "a1b2c3d4e5f6g7h8i9j0k1l2" }).ok, false);
    assert.equal(P({ credentialRef: "sk-" + "a1b2c3d4e5f6g7h8i9j0k1l2" }).reason, "CREDENTIAL_REF_MUST_BE_A_NAME");
    assert.equal(P({ kind: "LOCAL", egressHosts: ["api.example.com"] }).reason, "LOCAL_PROVIDER_MUST_BE_LOOPBACK");
    assert.equal(P({ id: "../x" }).reason, "PROVIDER_ID_INVALID"); assert.equal(P({ egressHosts: [] }).reason, "EGRESS_HOSTS_INVALID");
    assert.equal(P({ credentialRef: "OK_KEY" }).ok, true); assert.equal(P().reason, "PROVIDER_EXISTS");
    const M = o => t.reg.addModel({ id: "m1", providerId: "p1", version: "1.0.0", capabilities: ["text"], costClass: "PAID", costPer1kTokensUsd: 0.1, ...o });
    assert.equal(M({ costClass: "FREE" }).reason, "CLOUD_MODEL_CANNOT_BE_DECLARED_FREE_WITHOUT_EVIDENCE"); assert.equal(M({ version: "latest" }).reason, "VERSION_MUST_BE_SEMVER");
    assert.equal(M({ providerId: "nope" }).reason, "UNKNOWN_PROVIDER"); assert.equal(M({ capabilities: [] }).reason, "CAPABILITIES_INVALID"); assert.equal(M({ capabilities: ["Bad Cap!"] }).reason, "CAPABILITIES_INVALID");
    assert.equal(M({ costPer1kTokensUsd: -1 }).reason, "COST_INVALID"); assert.equal(M().ok, true);
  } finally { t.done(); }
});

test("enable: a free local model needs no approval; a cloud/paid model needs a signed approval bound to id, version and configuration (single use)", () => {
  const t = mk(); try {
    assert.equal(t.reg.enable("llama-local").ok, true); assert.equal(needsApproval(t.reg.getModel("llama-local")), false);
    assert.equal(t.reg.enable("gpt-x").reason, "OWNER_APPROVAL_REQUIRED");
    assert.equal(t.reg.enable("gpt-x", { approval: ap("MODEL_ENABLE", "model:gpt-x@9.9.9:deadbeef") }).reason, "OWNER_APPROVAL_REQUIRED");
    assert.equal(t.reg.enable("gpt-x", { approval: ap("OTHER_ACTION", t.reg.enableSubject(t.reg.getModel("gpt-x"))) }).reason, "OWNER_APPROVAL_REQUIRED");
    const a = ap("MODEL_ENABLE", t.reg.enableSubject(t.reg.getModel("gpt-x")));
    assert.equal(t.reg.enable("gpt-x", { approval: a }).ok, true); t.reg.disable("gpt-x");
    assert.equal(t.reg.enable("gpt-x", { approval: a }).reason, "OWNER_APPROVAL_REQUIRED", "replay of a spent approval");
    assert.equal(t.reg.enable("nope").reason, "UNKNOWN_MODEL");
  } finally { t.done(); }
});

test("kill switch blocks enabling but never disabling; no owner auth configured fails closed", () => {
  const t = mk(); try {
    assert.equal(t.reg.enable("llama-local").ok, true);
    const r2 = t.open({ gate: () => ({ allowed: false, reason: "PAUSE_ALL" }) }); assert.match(r2.enable("gpt-x").reason, /EMERGENCY_STOP/); assert.equal(r2.disable("llama-local").ok, true);
    const r3 = t.open({ ownerAuth: null }); assert.equal(r3.enable("gpt-x", { approval: ap("MODEL_ENABLE", "x") }).detail, "OWNER_AUTH_NOT_CONFIGURED");
  } finally { t.done(); }
});

test("editing a risk field of an enabled paid model disables it again; non-editable fields are refused", () => {
  const t = mk(); try {
    t.reg.enable("gpt-x", { approval: ap("MODEL_ENABLE", t.reg.enableSubject(t.reg.getModel("gpt-x"))) }); assert.equal(t.reg.getModel("gpt-x").enabled, true);
    assert.equal(t.reg.editModel("gpt-x", { displayName: "GPT X renamed" }).ok, true); assert.equal(t.reg.getModel("gpt-x").enabled, true);
    const r = t.reg.editModel("gpt-x", { costPer1kTokensUsd: 5 }); assert.equal(r.disabledBecauseRiskChanged, true); assert.equal(t.reg.getModel("gpt-x").enabled, false);
    for (const f of ["providerId", "version", "egressHosts", "enabled", "id", "credentialRef"]) assert.equal(t.reg.editModel("gpt-x", { [f]: "x" }).reason, "FIELD_NOT_EDITABLE", f);
    assert.equal(t.reg.editModel("gpt-x", { costClass: "FREE" }).reason, "CLOUD_MODEL_CANNOT_BE_DECLARED_FREE_WITHOUT_EVIDENCE");
  } finally { t.done(); }
});

test("upgrade: version must rise, removed capabilities need acknowledgement and cannot orphan an assignment, approval is needed again for the new version", () => {
  const t = mk(); try {
    t.reg.enable("gpt-x", { approval: ap("MODEL_ENABLE", t.reg.enableSubject(t.reg.getModel("gpt-x"))) });
    assert.equal(t.reg.upgrade("gpt-x", { version: "1.0.0" }).reason, "NOT_AN_UPGRADE"); assert.equal(t.reg.upgrade("gpt-x", { version: "0.9.0" }).reason, "NOT_AN_UPGRADE"); assert.equal(t.reg.upgrade("gpt-x", { version: "v2" }).reason, "VERSION_MUST_BE_SEMVER");
    t.reg.setAssignment("EXECUTION-1", { primary: "gpt-x", capability: "code" });
    assert.equal(t.reg.upgrade("gpt-x", { version: "1.1.0", capabilities: ["text"] }).reason, "CAPABILITIES_REMOVED_NEEDS_ACK");
    assert.equal(t.reg.upgrade("gpt-x", { version: "1.1.0", capabilities: ["text"], acknowledgeRemovedCapabilities: true }).reason, "REMOVED_CAPABILITY_STILL_ASSIGNED");
    const r = t.reg.upgrade("gpt-x", { version: "1.2.0", capabilities: ["text", "code", "vision"] }); assert.equal(r.ok, true); assert.equal(r.requiresReapproval, true); assert.equal(r.previousVersion, "1.0.0");
    assert.equal(t.reg.getModel("gpt-x").enabled, false); assert.equal(t.reg.getModel("gpt-x").version, "1.2.0");
    assert.equal(t.reg.enable("gpt-x", { approval: ap("MODEL_ENABLE", "model:gpt-x@1.0.0:" + modelConfigHash({ ...t.reg.getModel("gpt-x"), version: "1.0.0" })) }).reason, "OWNER_APPROVAL_REQUIRED", "approval for the old version is useless");
    assert.equal(t.reg.enable("gpt-x", { approval: ap("MODEL_ENABLE", t.reg.enableSubject(t.reg.getModel("gpt-x"))) }).ok, true);
  } finally { t.done(); }
});

test("rollback needs a signed approval for that exact snapshot and brings approval-gated models back DISABLED", () => {
  const t = mk(); try {
    t.reg.enable("llama-local"); const snap = t.reg.snapshots().at(-1);
    t.reg.enable("gpt-x", { approval: ap("MODEL_ENABLE", t.reg.enableSubject(t.reg.getModel("gpt-x"))) }); t.reg.editModel("llama-local", { displayName: "changed" });
    assert.equal(t.reg.rollback(snap.revision).reason, "OWNER_APPROVAL_REQUIRED"); assert.equal(t.reg.rollback(snap.revision, { approval: ap("MODEL_REGISTRY_ROLLBACK", "registry:1:00") }).reason, "OWNER_APPROVAL_REQUIRED");
    assert.equal(t.reg.rollback(9999, {}).reason, "SNAPSHOT_NOT_FOUND");
    const later = t.reg.snapshots().at(-1); const r = t.reg.rollback(later.revision, { approval: ap("MODEL_REGISTRY_ROLLBACK", later.subject) }); assert.equal(r.ok, true);
    assert.equal(t.reg.getModel("gpt-x").enabled, false, "an old spend approval is never resurrected"); assert.equal(t.reg.getModel("llama-local").enabled, true);
    assert.ok(t.reg.status().revision > later.revision, "rollback is a new revision, not a rewrite of history");
  } finally { t.done(); }
});

test("integrity: a hand-edited registry file opens READ-ONLY and only an owner-approved rollback recovers; a newer schema is never rewritten", () => {
  const t = mk(); try {
    t.reg.enable("llama-local"); const good = t.reg.snapshots().at(-1); const f = path.join(t.dir, "registry.json"), raw = JSON.parse(fs.readFileSync(f, "utf8"));
    raw.models["gpt-x"].enabled = true; fs.writeFileSync(f, JSON.stringify(raw, null, 1));
    const r2 = t.open(); assert.equal(r2.status().integrity, "MISMATCH"); assert.equal(r2.status().readOnly, true); assert.match(r2.disable("llama-local").reason, /REGISTRY_READ_ONLY/); assert.match(r2.addProvider({ id: "zz", displayName: "z", kind: "LOCAL", egressHosts: ["127.0.0.1"] }).reason, /READ_ONLY/);
    assert.equal(r2.rollback(good.revision).reason, "OWNER_APPROVAL_REQUIRED"); const ok = r2.rollback(good.revision, { approval: ap("MODEL_REGISTRY_ROLLBACK", good.subject) }); assert.equal(ok.ok, true);
    assert.equal(r2.status().readOnly, false); assert.equal(r2.getModel("gpt-x").enabled, false);
    raw.schemaVersion = 99; fs.writeFileSync(f, JSON.stringify(raw)); const r3 = t.open(); assert.equal(r3.status().integrity, "NEWER_SCHEMA"); assert.equal(r3.status().readOnly, true); assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).schemaVersion, 99);
    fs.writeFileSync(f, "{not json"); assert.equal(t.open().status().integrity, "UNREADABLE");
    fs.rmSync(f); assert.equal(t.open().status().integrity, "FILE_MISSING");
  } finally { t.done(); }
});

test("assignments: only the exact 30 permanent agents, models must carry the capability, removal of an assigned model is refused", () => {
  const t = mk(); try {
    assert.equal(ROSTER.length, 30); assert.equal(t.reg.agents().length, 30);
    for (const bad of ["EXECUTION-26", "SEARCH-0", "SEARCH-6", "JOCI", "__proto__", "execution-1", ""]) assert.equal(t.reg.setAssignment(bad, { primary: "gpt-x" }).reason, "NOT_ONE_OF_THE_30_PERMANENT_AGENTS", bad);
    assert.equal(t.reg.setAssignment("SEARCH-1", { primary: "llama-local", capability: "code" }).reason, "MODEL_LACKS_CAPABILITY"); assert.equal(t.reg.setAssignment("SEARCH-1", { primary: "ghost" }).reason, "UNKNOWN_MODEL");
    assert.equal(t.reg.setAssignment("SEARCH-1", { primary: "gpt-x", fallbacks: ["gpt-x"] }).reason, "FALLBACKS_INVALID");
    assert.equal(t.reg.setAssignment("SEARCH-1", { primary: "llama-local", fallbacks: ["gpt-x"] }).ok, true);
    assert.equal(t.reg.remove("llama-local").reason, "MODEL_STILL_ASSIGNED"); t.reg.clearAssignment("SEARCH-1"); assert.equal(t.reg.remove("llama-local").ok, true);
    assert.throws(() => createModelRegistry({ dir: tmp("x-"), roster: ROSTER.slice(0, 29) }), /EXACTLY_30/); assert.throws(() => createModelRegistry({ dir: tmp("x-"), roster: [...ROSTER, "EXECUTION-26"] }), /EXACTLY_30/);
  } finally { t.done(); }
});

test("resolve: no-spend by default, credential and LIVE evidence required, skipped models explain why", () => {
  const t = mk(); try {
    t.reg.setRoleDefault("SEARCH", ["llama-local", "gpt-x"]); t.reg.enable("llama-local"); t.reg.enable("gpt-x", { approval: ap("MODEL_ENABLE", t.reg.enableSubject(t.reg.getModel("gpt-x"))) });
    let r = t.reg.resolve({ agentId: "SEARCH-2" }); assert.deepEqual(r.candidates, []); assert.match(r.note, /NO_ELIGIBLE_MODEL/); assert.ok(r.skipped.some(s => s.id === "llama-local" && /NOT_LIVE/.test(s.reason)));
    t.live.add("llama-local"); r = t.reg.resolve({ agentId: "SEARCH-2" }); assert.deepEqual(r.candidates.map(c => c.id), ["llama-local"]);
    t.live.add("gpt-x"); r = t.reg.resolve({ agentId: "SEARCH-2" }); assert.deepEqual(r.candidates.map(c => c.id), ["llama-local"]); assert.ok(r.skipped.some(s => s.id === "gpt-x" && s.reason === "OVER_BUDGET"), "paid model is skipped in no-spend mode");
    r = t.reg.resolve({ agentId: "SEARCH-2", maxCostUsd: 1 }); assert.ok(!r.candidates.some(c => c.id === "gpt-x"), "no credential yet"); assert.ok(r.skipped.some(s => s.id === "gpt-x" && /NO_CREDENTIAL/.test(s.reason)));
    t.creds.add("OPENAI_API_KEY"); r = t.reg.resolve({ agentId: "SEARCH-2", maxCostUsd: 1 }); assert.deepEqual(r.candidates.map(c => c.id), ["llama-local", "gpt-x"]);
    t.reg.setAssignment("SEARCH-3", { primary: "gpt-x", capability: "code" }); assert.equal(t.reg.resolve({ agentId: "SEARCH-3", capability: "code", maxCostUsd: 1 }).candidates[0].id, "gpt-x");
    assert.equal(t.reg.resolve({ agentId: "NOBODY" }).reason, "NOT_ONE_OF_THE_30_PERMANENT_AGENTS"); assert.equal(t.reg.resolve({ agentId: "SEARCH-1", capability: "teleport" }).candidates.length, 0);
    assert.equal(t.reg.getModel("gpt-x").live, true); assert.equal(t.reg.status().live, 2);
  } finally { t.done(); }
});

test("billing guard: one request key is billed by one attempt at a time; failover only after a settled zero-cost failure", () => {
  const t = mk(); try {
    const K = "req-20261010-0001"; assert.equal(t.reg.billing.begin(K, "gpt-x").ok, true);
    assert.equal(t.reg.billing.begin(K, "llama-local").reason, "DUPLICATE_BILLING_BLOCKED", "second provider while the first is open");
    assert.equal(t.reg.billing.settle(K, { ok: false, costUsd: 0.02 }).failoverAllowed, false); assert.equal(t.reg.billing.begin(K, "llama-local").reason, "DUPLICATE_BILLING_BLOCKED", "a billed failure is never retried elsewhere under the same key");
    const K2 = "req-20261010-0002"; t.reg.billing.begin(K2, "gpt-x"); assert.equal(t.reg.billing.settle(K2, { ok: false, costUsd: 0 }).failoverAllowed, true);
    assert.equal(t.reg.billing.begin(K2, "llama-local").attempt, 2); t.reg.billing.settle(K2, { ok: true, costUsd: 0 }); assert.equal(t.reg.billing.begin(K2, "gpt-x").reason, "DUPLICATE_BILLING_BLOCKED");
    assert.equal(t.reg.billing.begin("short", "gpt-x").reason, "REQUEST_KEY_INVALID"); assert.equal(t.reg.billing.begin("req-20261010-0003", "ghost").reason, "UNKNOWN_MODEL"); assert.equal(t.reg.billing.settle("req-never-opened", { ok: true }).reason, "NOT_OPEN");
    assert.equal(t.reg.billing.settle(K2, { ok: true, costUsd: -1 }).reason, "NOT_OPEN");
    const again = t.open(); assert.equal(again.billing.begin(K, "llama-local").reason, "DUPLICATE_BILLING_BLOCKED", "survives a restart");
  } finally { t.done(); }
});

test("everything persists across a reopen, and rejected changes leave no trace", () => {
  const t = mk(); try {
    t.reg.enable("llama-local"); t.reg.setAssignment("EXECUTION-3", { primary: "llama-local" }); const rev = t.reg.status().revision;
    t.reg.addModel({ id: "bad id", providerId: "openai", version: "1.0.0", capabilities: ["text"] }); t.reg.setAssignment("EXECUTION-99", { primary: "llama-local" }); assert.equal(t.reg.status().revision, rev);
    const r2 = t.open(); assert.equal(r2.status().integrity, "OK"); assert.equal(r2.getModel("llama-local").enabled, true); assert.equal(r2.assignments()["EXECUTION-3"].primary, "llama-local"); assert.equal(r2.status().revision, rev);
    assert.ok(fs.readFileSync(path.join(t.dir, "registry-audit.jsonl"), "utf8").includes("REGISTRY_REVISION"));
  } finally { t.done(); }
});
