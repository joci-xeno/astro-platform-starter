// Regression tests for independent-verifier findings (budget validation, output-token budgeting, unpriced models, billing after a possibly-sent request).
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createModelRoutingBridge } from "../atlasz-addons/model-routing-bridge.mjs";
import { createModelRegistry } from "../atlasz-addons/model-registry.mjs";
import { createModelGateway } from "../atlasz-addons/model-gateway.mjs";
import { createProviderResilience } from "../atlasz-addons/provider-resilience.mjs";
import { createModelIntelligence } from "../atlasz-addons/brain/model-intelligence.mjs";
import { createCapabilityGraph } from "../atlasz-addons/brain/capability-graph.mjs";
import { createProviderEgress } from "../atlasz-addons/provider-egress.mjs";
import { createEgressPolicy } from "../atlasz-addons/egress-policy.mjs";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { ROSTER } from "../atlasz-addons/agent-activity.mjs";
const kp = generateOwnerKeyPair(), ap = (a, s) => issueOwnerApproval({ privateKeyPem: kp.privateKeyPem, action: a, subject: s });
async function rig({ price, invoke }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vp1-")), auth = createOwnerAuth({ publicKeyB64: kp.publicKeyB64 }), h = {};
  const reg = createModelRegistry({ dir: dir + "/reg", ownerAuth: auth, gate: () => ({ allowed: true }), liveStatus: id => h.b?.liveStatus(id) ?? false, hasCredential: () => true });
  reg.seedDefaults();
  reg.addProvider({ id: "synth-ai", displayName: "S", kind: "CLOUD", egressHosts: ["api.synth-ai.com"], credentialRef: "SYNTH_KEY" });
  reg.addModel({ id: "synth-1", providerId: "synth-ai", version: "1.0.0", costClass: "PAID", costPer1kTokensUsd: price, capabilities: ["text"] });
  reg.addModel({ id: "synth-2", providerId: "synth-ai", version: "1.0.0", costClass: "PAID", costPer1kTokensUsd: price, capabilities: ["text"] });
  const egress = createEgressPolicy({ ownerAuth: auth, stateDir: dir + "/eg", isStopped: () => false });
  const pe = createProviderEgress({ registry: reg, egress, gate: () => ({ allowed: true }), dir: dir + "/pe" });
  const gw = createModelGateway({ resilience: createProviderResilience({ gate: () => ({ allowed: true }), clock: () => Date.now(), timeoutMs: 2000 }), models: createModelIntelligence({ graph: createCapabilityGraph(), clockMs: () => Date.now() }) });
  const calls = { n: 0 };
  const ad = { endpoint: () => ({ url: "https://api.synth-ai.com/v1/chat", method: "POST" }), resolveAddresses: async () => ["93.184.216.34"], invoke: async x => { calls.n++; return invoke(x, calls); }, probe: async () => ({ ok: true }) };
  const b = createModelRoutingBridge({ registry: reg, gateway: gw, providerEgress: pe, adapters: { "synth-ai": ad } }); h.b = b;
  for (const id of ["synth-1", "synth-2"]) reg.enable(id, { approval: ap("MODEL_ENABLE", reg.enableSubject(reg.getModel(id))) });
  const p = pe.proposals().find(x => x.providerId === "synth-ai"); pe.applyProposal("synth-ai", { ownerApproval: ap(p.action, p.subject) });
  await b.probeAll(); return { b, reg, calls };
}
const A = ROSTER[0];
test("a NaN, Infinity or negative budget never reaches a paid model", async () => {
  for (const budget of [NaN, Infinity, -1, "x"]) {
    const t = await rig({ price: 5, invoke: async () => ({ output: "x", tokensIn: 10, tokensOut: 1000 }) });
    const r = await t.b.complete({ agentId: A, prompt: "hello world", maxCostUsd: budget });
    assert.equal(r.ok, false); assert.equal(t.calls.n, 0, "budget=" + budget);
  }
  const t = await rig({ price: 5, invoke: async () => ({ output: "x" }) }); assert.equal(t.reg.resolve({ agentId: A, maxCostUsd: NaN }).reason, "BUDGET_INVALID");
});
test("the budget covers the longest allowed answer: a tiny budget cannot be spent on output tokens", async () => {
  const t = await rig({ price: 5, invoke: async () => ({ output: "x", tokensIn: 3, tokensOut: 1024 }) });
  const r = await t.b.complete({ agentId: A, prompt: "hello world", maxCostUsd: 0.001 });
  assert.equal(r.ok, false); assert.equal(t.calls.n, 0);
  const ok = await t.b.complete({ agentId: A, prompt: "hello world", maxCostUsd: 100 }); assert.equal(ok.ok, true); assert.equal(ok.budgetExceeded, false);
});
test("an unpriced paid model is never called, even with a budget", async () => {
  const t = await rig({ price: null, invoke: async () => ({ output: "x" }) });
  const r = await t.b.complete({ agentId: A, prompt: "hello", maxCostUsd: 100, requestKey: "job:unknown-0001" });
  assert.equal(r.ok, false); assert.equal(t.calls.n, 0); assert.equal(t.reg.billing.status("job:unknown-0001"), null);
});
test("a paid request that may have reached the provider is booked at its estimate and blocks failover under the same key; a pre-send failure stays zero-cost", async () => {
  let t = await rig({ price: 1, invoke: async () => { throw new Error("PROVIDER_RESPONSE_SHAPE"); } });
  let r = await t.b.complete({ agentId: A, prompt: "hello", maxCostUsd: 100, requestKey: "job:fail-0001" });
  assert.equal(t.calls.n, 1, "exactly one paid call for one request key"); assert.equal(r.ok, false);
  const led = t.reg.billing.status("job:fail-0001"); assert.equal(led.state, "FAILED_BILLED"); assert.ok(led.costUsd > 0);
  t = await rig({ price: 1, invoke: async () => { throw new Error("NO_CREDENTIAL"); } });
  r = await t.b.complete({ agentId: A, prompt: "hello", maxCostUsd: 100, requestKey: "job:fail-0002" });
  assert.equal(t.calls.n, 2, "nothing was sent, so failover to the second model is allowed"); assert.equal(t.reg.billing.status("job:fail-0002").state, "FAILED_NO_COST");
});
