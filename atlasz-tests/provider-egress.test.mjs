// Bridge model-registry -> egress-policy. Real registry + real egress engine + real owner-auth; synthetic hosts and addresses; nothing connects anywhere.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createProviderEgress, DEFAULT_CLOUD_ROUTE } from "../atlasz-addons/provider-egress.mjs";
import { createModelRegistry } from "../atlasz-addons/model-registry.mjs";
import { createEgressPolicy, policySubject, removeSubject } from "../atlasz-addons/egress-policy.mjs";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { tmp, rm } from "./helpers.mjs";

const kp = generateOwnerKeyPair(), other = generateOwnerKeyPair();
const ap = (action, subject, k = kp) => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action, subject });
const PUB = ["93.184.216.34"];
function mk({ stopped = false, gate = () => ({ allowed: true }), routes = {} } = {}) {
  const dir = tmp("pegress-"), auth = createOwnerAuth({ publicKeyB64: kp.publicKeyB64 });
  const reg = createModelRegistry({ dir: path.join(dir, "reg"), ownerAuth: auth, gate: () => ({ allowed: true }) });
  reg.addProvider({ id: "synth-ai", displayName: "Synthetic AI", kind: "CLOUD", egressHosts: ["api.synth-ai.com", "upload.synth-ai.com"], credentialRef: "SYNTH_KEY" });
  reg.addProvider({ id: "other-ai", displayName: "Other AI", kind: "CLOUD", egressHosts: ["api.other-ai.net"], credentialRef: "OTHER_KEY" });
  reg.addProvider({ id: "reserved-ai", displayName: "Reserved", kind: "CLOUD", egressHosts: ["api.merlin.example"], credentialRef: "R_KEY" });
  reg.addProvider({ id: "ollama-local", displayName: "Ollama", kind: "LOCAL", egressHosts: ["127.0.0.1"], credentialRef: null });
  reg.addModel({ id: "synth-1", providerId: "synth-ai", version: "1.0.0", costClass: "PAID", costPer1kTokensUsd: 0.01, capabilities: ["text"] });
  reg.addModel({ id: "other-1", providerId: "other-ai", version: "1.0.0", costClass: "PAID", costPer1kTokensUsd: 0.01, capabilities: ["text"] });
  reg.addModel({ id: "res-1", providerId: "reserved-ai", version: "1.0.0", costClass: "PAID", costPer1kTokensUsd: 0.01, capabilities: ["text"] });
  reg.addModel({ id: "llama-local", providerId: "ollama-local", version: "1.0.0", costClass: "FREE", capabilities: ["text"] });
  const egress = createEgressPolicy({ ownerAuth: auth, stateDir: path.join(dir, "egress"), isStopped: () => stopped });
  const bridge = createProviderEgress({ registry: reg, egress, gate, routes, dir: path.join(dir, "bridge") });
  const enable = id => reg.enable(id, { approval: ap("MODEL_ENABLE", reg.enableSubject(reg.getModel(id))) });
  const apply = id => { const p = bridge.proposals().find(x => x.providerId === id); return bridge.applyProposal(id, { ownerApproval: ap(p.action, p.subject) }); };
  return { dir, reg, egress, bridge, auth, enable, apply, done: () => rm(dir) };
}
const req = (o = {}) => ({ modelId: "synth-1", url: "https://api.synth-ai.com/v1/chat", method: "POST", bodyBytes: 100, resolvedAddresses: PUB, ...o });

test("no enabled model -> no proposal; everything is denied by default", () => {
  const t = mk(); try {
    assert.deepEqual(t.bridge.proposals(), []);
    const d = t.bridge.checkModelRequest(req()); assert.equal(d.allowed, false); assert.equal(d.reason, "MODEL_DISABLED");
  } finally { t.done(); }
});

test("proposals are built from ENABLED models' provider hosts only (exact, no wildcard) with the exact egress subject", () => {
  const t = mk(); try {
    t.enable("synth-1"); t.reg.enable("llama-local");
    const ps = t.bridge.proposals(); assert.deepEqual(ps.map(p => p.providerId), ["ollama-local", "synth-ai"]);
    const s = ps.find(p => p.providerId === "synth-ai");
    assert.deepEqual(s.policy.hosts, ["api.synth-ai.com", "upload.synth-ai.com"]); assert.equal(s.action, "EGRESS_POLICY_SET"); assert.equal(s.state, "NO_POLICY");
    assert.equal(s.subject, policySubject(s.policy)); assert.deepEqual(s.policy.methods, DEFAULT_CLOUD_ROUTE.methods); assert.deepEqual(s.models, ["synth-1"]);
    const l = ps.find(p => p.providerId === "ollama-local"); assert.equal(l.policy.loopback, true); assert.deepEqual(l.policy.hosts, ["127.0.0.1"]); assert.deepEqual(l.policy.ports, [11434]);
    assert.ok(!JSON.stringify(ps).includes("*"));
  } finally { t.done(); }
});

test("a provider whose host egress-policy refuses (.example) is NOT_REPRESENTABLE, never forced in", () => {
  const t = mk(); try {
    t.enable("res-1"); const p = t.bridge.proposals().find(x => x.providerId === "reserved-ai");
    assert.equal(p.state, "NOT_REPRESENTABLE"); assert.match(p.reason, /HOST_NOT_PUBLIC/); assert.equal(p.action, "NONE");
    assert.equal(t.bridge.applyProposal("reserved-ai", { ownerApproval: ap("EGRESS_POLICY_SET", "x") }).ok, false);
    assert.equal(t.bridge.checkModelRequest(req({ modelId: "res-1", url: "https://api.merlin.example/v1" })).reason, "EGRESS_NO_POLICY_FOR_PROVIDER");
  } finally { t.done(); }
});

test("applying needs the signed approval egress-policy requires: none, bare boolean, wrong subject, wrong action, wrong key, replay all refused", () => {
  const t = mk(); try {
    t.enable("synth-1"); const p = t.bridge.proposals()[0];
    assert.match(t.bridge.applyProposal("synth-ai").reason, /OWNER_APPROVAL_REQUIRED/);
    assert.match(t.bridge.applyProposal("synth-ai", { ownerApproval: true }).reason, /BARE_BOOLEAN_REJECTED/);
    assert.match(t.bridge.applyProposal("synth-ai", { ownerApproval: ap("EGRESS_POLICY_SET", "egress:synth-ai:000000000000000000000000") }).reason, /SUBJECT_MISMATCH/);
    assert.match(t.bridge.applyProposal("synth-ai", { ownerApproval: ap("EGRESS_POLICY_REMOVE", p.subject) }).reason, /ACTION_MISMATCH/);
    assert.match(t.bridge.applyProposal("synth-ai", { ownerApproval: ap("EGRESS_POLICY_SET", p.subject, other) }).reason, /SIGNATURE_INVALID/);
    const a = ap("EGRESS_POLICY_SET", p.subject);
    assert.equal(t.bridge.applyProposal("synth-ai", { ownerApproval: a }).ok, true);
    assert.equal(t.bridge.proposals()[0].state, "APPLIED");
    assert.equal(t.bridge.applyProposal("synth-ai", { ownerApproval: a }).ok, false, "nothing left to apply");
    t.reg.disable("synth-1"); t.enable("synth-1");      // same config: still APPLIED, but a replayed approval for a removal must fail
    t.reg.disable("synth-1"); const r = t.bridge.proposals()[0]; assert.equal(r.action, "EGRESS_POLICY_REMOVE");
    assert.match(t.bridge.applyProposal("synth-ai", { ownerApproval: a }).reason, /ACTION_MISMATCH|SUBJECT_MISMATCH|REPLAY/);
    assert.equal(t.bridge.applyProposal("synth-ai", { ownerApproval: ap("EGRESS_POLICY_REMOVE", removeSubject("synth-ai")) }).ok, true);
    assert.equal(t.egress.listPolicies().length, 0);
  } finally { t.done(); }
});

test("checkModelRequest allows only an enabled model, on an applied policy, to an exact registry host", () => {
  const t = mk(); try {
    t.enable("synth-1"); assert.equal(t.bridge.checkModelRequest(req()).reason, "EGRESS_NO_POLICY_FOR_PROVIDER", "enabled but policy not yet approved");
    t.apply("synth-ai");
    const ok = t.bridge.checkModelRequest(req()); assert.equal(ok.allowed, true); assert.deepEqual(ok.pinTo, PUB); assert.equal(ok.providerId, "synth-ai");
    assert.equal(t.bridge.checkModelRequest(req({ url: "https://upload.synth-ai.com/v1/files" })).allowed, true);
    for (const [url, re] of [["https://evil.com/v1", /HOST_NOT_IN_REGISTRY/], ["https://api.synth-ai.com.evil.net/v1", /HOST_NOT_IN_REGISTRY/], ["https://evil-api.synth-ai.com/v1", /HOST_NOT_IN_REGISTRY/],
      ["https://api.other-ai.net/v1", /HOST_NOT_IN_REGISTRY/], ["https://user@api.synth-ai.com/v1", /URL_INVALID/], ["http://api.synth-ai.com/v1", /EGRESS_SCHEME_NOT_ALLOWED/], ["https://api.synth-ai.com:8443/v1", /EGRESS_PORT_NOT_IN_POLICY/],
      ["https://api.synth-ai.com/v1/../admin", /EGRESS_PATH_TRAVERSAL/], ["https://api.synth-ai.com./v1", /HOST_NOT_IN_REGISTRY|TRAILING_DOT/], ["https://api.synth-ai.com%2eevil.net/v1", /HOST_NOT_IN_REGISTRY/],["not a url", /URL_INVALID/], [null, /URL_INVALID/], ["https://" + "a".repeat(5000), /URL_INVALID/]])
      assert.match(t.bridge.checkModelRequest(req({ url })).reason ?? "ALLOWED", re, String(url).slice(0, 60));
    assert.equal(t.bridge.checkModelRequest(req({ url: "https://API.SYNTH-AI.COM/v1" })).allowed, true, "DNS names are case-insensitive; both layers compare lowercase");
    assert.match(t.bridge.checkModelRequest(req({ method: "DELETE" })).reason, /EGRESS_METHOD_NOT_IN_POLICY/);
    assert.match(t.bridge.checkModelRequest(req({ bodyBytes: DEFAULT_CLOUD_ROUTE.maxBodyBytes + 1 })).reason, /EGRESS_BODY_TOO_LARGE/);
    assert.match(t.bridge.checkModelRequest(req({ resolvedAddresses: ["10.0.0.5"] })).reason, /RESOLVED_TO_NON_PUBLIC/);
    assert.match(t.bridge.checkModelRequest(req({ resolvedAddresses: undefined })).reason, /RESOLVED_ADDRESSES_REQUIRED/);
  } finally { t.done(); }
});

test("unknown / disabled / malformed model ids are denied; another provider's policy never covers a model", () => {
  const t = mk(); try {
    t.enable("synth-1"); t.apply("synth-ai");
    assert.equal(t.bridge.checkModelRequest(req({ modelId: "nope" })).reason, "UNKNOWN_MODEL");
    assert.equal(t.bridge.checkModelRequest(req({ modelId: "__proto__" })).reason, "MODEL_ID_INVALID");
    assert.equal(t.bridge.checkModelRequest(req({ modelId: "../x" })).reason, "MODEL_ID_INVALID");
    assert.equal(t.bridge.checkModelRequest(null).reason, "MODEL_ID_INVALID");
    assert.equal(t.bridge.checkModelRequest(req({ modelId: "other-1", url: "https://api.synth-ai.com/v1" })).reason, "MODEL_DISABLED");
    t.enable("other-1");
    assert.equal(t.bridge.checkModelRequest(req({ modelId: "other-1", url: "https://api.synth-ai.com/v1" })).reason, "HOST_NOT_IN_REGISTRY");
    assert.equal(t.bridge.checkModelRequest(req({ modelId: "other-1", url: "https://api.other-ai.net/v1" })).reason, "EGRESS_NO_POLICY_FOR_PROVIDER");
    t.reg.disable("synth-1"); assert.equal(t.bridge.checkModelRequest(req()).reason, "MODEL_DISABLED", "disabling the model closes egress even though the policy is still in force");
    assert.equal(t.bridge.proposals().find(p => p.providerId === "synth-ai").action, "EGRESS_POLICY_REMOVE");
  } finally { t.done(); }
});

test("loopback local model: only http://127.0.0.1 on the policy port; localhost and other loopback spellings refused", () => {
  const t = mk(); try {
    t.reg.enable("llama-local"); t.apply("ollama-local");
    const L = url => t.bridge.checkModelRequest({ modelId: "llama-local", url, method: "POST", bodyBytes: 10 });
    assert.equal(L("http://127.0.0.1:11434/api/chat").allowed, true);
    for (const u of ["http://localhost:11434/api/chat", "http://127.1:11434/api/chat", "http://0x7f.0.0.1:11434/api/chat", "http://[::1]:11434/api/chat", "http://127.0.0.1:8080/api/chat", "http://127.0.0.1:11434/admin", "http://2130706433:11434/api/chat"])
      assert.equal(L(u).allowed, false, u);
  } finally { t.done(); }
});

test("kill switch: external model egress stops under STOP_EXTERNAL_ACTIONS; egress engine stop also denies", () => {
  let mode = "RUNNING"; const gate = ({ external }) => (mode === "PAUSE_ALL" || (mode === "STOP_EXTERNAL_ACTIONS" && external) ? { allowed: false, reason: mode } : { allowed: true });
  const t = mk({ gate }); try {
    t.enable("synth-1"); t.apply("synth-ai"); t.reg.enable("llama-local"); t.apply("ollama-local");
    mode = "STOP_EXTERNAL_ACTIONS";
    assert.equal(t.bridge.checkModelRequest(req()).reason, "EMERGENCY_STOP:STOP_EXTERNAL_ACTIONS");
    assert.equal(t.bridge.checkModelRequest({ modelId: "llama-local", url: "http://127.0.0.1:11434/api/chat", method: "POST", bodyBytes: 1 }).allowed, true, "local stays allowed under external stop");
    mode = "PAUSE_ALL"; assert.equal(t.bridge.checkModelRequest({ modelId: "llama-local", url: "http://127.0.0.1:11434/api/chat", method: "POST", bodyBytes: 1 }).allowed, false);
  } finally { t.done(); }
  const s = mk({ stopped: true }); try { s.enable("synth-1"); s.apply("synth-ai"); assert.equal(s.bridge.checkModelRequest(req()).reason, "EGRESS_OWNER_STOP"); } finally { s.done(); }
});

test("a model upgrade/edit that disables the model closes egress; a stale policy is reported", () => {
  const t = mk(); try {
    t.enable("synth-1"); t.apply("synth-ai"); assert.equal(t.bridge.checkModelRequest(req()).allowed, true);
    t.reg.upgrade("synth-1", { version: "1.1.0" }); assert.equal(t.bridge.checkModelRequest(req()).reason, "MODEL_DISABLED");
    t.enable("synth-1"); assert.equal(t.bridge.checkModelRequest(req()).allowed, true);
  } finally { t.done(); }
  const r = mk({ routes: { "synth-ai": { methods: ["POST", "GET"] } } }); try {
    r.enable("synth-1"); assert.deepEqual(r.bridge.proposals()[0].policy.methods.sort(), ["GET", "POST"]);
  } finally { r.done(); }
});

test("a registry that reports a model with hosts differing from its provider is denied (no private host lists)", () => {
  const t = mk(); try {
    t.enable("synth-1"); t.apply("synth-ai");
    const fakeReg = { getModel: id => ({ ...t.reg.getModel(id), egressHosts: ["api.synth-ai.com", "exfil.synth-ai.com"] }), listModels: () => t.reg.listModels(), listProviders: () => t.reg.listProviders() };
    const b = createProviderEgress({ registry: fakeReg, egress: t.egress, gate: () => ({ allowed: true }) });
    assert.equal(b.checkModelRequest(req()).reason, "MODEL_HOSTS_DIFFER_FROM_PROVIDER");
    const throwing = createProviderEgress({ registry: { getModel: () => { throw new Error("x"); }, listModels: () => [], listProviders: () => [] }, egress: t.egress });
    assert.equal(throwing.checkModelRequest(req()).allowed, false);
  } finally { t.done(); }
  assert.throws(() => createProviderEgress({ registry: null, egress: {} }), /REGISTRY_REQUIRED/);
  assert.throws(() => createProviderEgress({ registry: { getModel() {}, listModels() {}, listProviders() {} }, egress: null }), /EGRESS_POLICY_REQUIRED/);
});

test("every decision is audited (allow and deny) without query strings or bodies; chain verifies; tampering is detected", () => {
  const t = mk(); try {
    t.enable("synth-1"); t.apply("synth-ai");
    t.bridge.checkModelRequest(req({ url: "https://api.synth-ai.com/v1/chat?key=sk-" + "a1b2c3d4e5f6g7h8i9j0k1l2" }));
    t.bridge.checkModelRequest(req({ modelId: "nope" }));
    const ev = t.bridge.audit().filter(e => e.event.startsWith("MODEL_EGRESS_"));
    assert.deepEqual(ev.map(e => e.event), ["MODEL_EGRESS_ALLOW", "MODEL_EGRESS_DENY"]);
    assert.equal(ev[0].data.path, "/v1/chat"); assert.ok(!JSON.stringify(t.bridge.audit()).includes("sk-a1b2"));
    assert.ok(t.bridge.audit().some(e => e.event === "PROPOSAL_APPLIED"));
    assert.equal(t.bridge.auditVerify().ok, true);
    const f = path.join(t.dir, "bridge", "provider-egress-audit.jsonl"), lines = fs.readFileSync(f, "utf8").split("\n");
    lines[1] = lines[1].replace("MODEL_EGRESS", "MODEL_EGRESX"); fs.writeFileSync(f, lines.join("\n"));
    assert.equal(t.bridge.auditVerify().ok, false);
    const s = t.bridge.summary(); assert.equal(s.state, "IMPLEMENTED_NOT_CONNECTED"); assert.equal(s.live, false);
  } finally { t.done(); }
});

test("proposals() is pure: it changes no policy and writes no decision", () => {
  const t = mk(); try {
    t.enable("synth-1"); const before = t.egress.policyAudit().length, dec = t.egress.decisions().length, own = t.bridge.audit().length;
    for (let i = 0; i < 3; i++) t.bridge.proposals();
    assert.equal(t.egress.policyAudit().length, before); assert.equal(t.egress.decisions().length, dec); assert.equal(t.bridge.audit().length, own); assert.equal(t.egress.listPolicies().length, 0);
  } finally { t.done(); }
});

test("an approval signed for one provider's policy cannot apply another provider's policy", () => {
  const t = mk(); try {
    t.enable("synth-1"); t.enable("other-1");
    const synth = t.bridge.proposals().find(p => p.providerId === "synth-ai");
    const r = t.bridge.applyProposal("other-ai", { ownerApproval: ap("EGRESS_POLICY_SET", synth.subject) });
    assert.equal(r.ok, false); assert.match(r.reason, /SUBJECT_MISMATCH/);
    assert.equal(t.bridge.applyProposal("nope-provider", { ownerApproval: ap("EGRESS_POLICY_SET", synth.subject) }).reason, "NO_PROPOSAL");
    assert.equal(t.bridge.applyProposal("Bad Id").reason, "PROVIDER_ID_INVALID");
    assert.ok(t.bridge.audit().some(e => e.event === "PROPOSAL_REFUSED" && e.data.providerId === "other-ai"));
    assert.ok(t.bridge.audit().some(e => e.event === "PROPOSAL_NOT_APPLICABLE"));
  } finally { t.done(); }
});

test("route overrides cannot add hosts or wildcards; invalid overrides make the proposal NOT_REPRESENTABLE", () => {
  const routes = JSON.parse('{"synth-ai":{"hosts":["*","evil.com"],"methods":["POST"]},"other-ai":{"methods":["CONNECT"]},"__proto__":{"methods":["GET"]}}');
  const t = mk({ routes }); try {
    t.enable("synth-1"); t.enable("other-1");
    const ps = t.bridge.proposals(); const s = ps.find(p => p.providerId === "synth-ai"), o = ps.find(p => p.providerId === "other-ai");
    assert.deepEqual(s.policy.hosts, ["api.synth-ai.com", "upload.synth-ai.com"]); assert.equal(o.state, "NOT_REPRESENTABLE"); assert.equal(o.reason, "METHODS_INVALID");
  } finally { t.done(); }
  const fakeReg = { getModel: () => null, listModels: () => [{ id: "x", providerId: "loc", enabled: true }], listProviders: () => [{ id: "loc", kind: "LOCAL", egressHosts: ["10.0.0.5"] }] };
  const b = createProviderEgress({ registry: fakeReg, egress: createEgressPolicy({ ownerAuth: createOwnerAuth({ publicKeyB64: kp.publicKeyB64 }) }) });
  assert.equal(b.proposals()[0].reason, "LOCAL_PROVIDER_NOT_LOOPBACK");
});

test("each bridge decision links to the egress engine's own decision record", () => {
  const t = mk(); try {
    t.enable("synth-1"); t.apply("synth-ai");
    const d = t.bridge.checkModelRequest(req()); const e = t.egress.decisions().find(x => x.seq === d.egressDecisionSeq);
    assert.ok(e); assert.equal(e.event, "EGRESS_ALLOW"); assert.equal(e.data.host, "api.synth-ai.com");
    const denied = t.bridge.checkModelRequest(req({ method: "PUT" })); assert.equal(t.egress.decisions().find(x => x.seq === denied.egressDecisionSeq).event, "EGRESS_DENY");
    const early = t.bridge.checkModelRequest(req({ modelId: "nope" })); assert.equal(early.egressDecisionSeq, null, "registry-level denials never reach the engine");
  } finally { t.done(); }
});
