// Registry -> gateway -> egress -> billing bridge. Real registry, gateway, resilience, egress engine and billing guard; fake adapters / fake fetch; nothing leaves the machine.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createModelRoutingBridge, createOllamaAdapter } from "../atlasz-addons/model-routing-bridge.mjs";
import { createModelRegistry } from "../atlasz-addons/model-registry.mjs";
import { createModelGateway } from "../atlasz-addons/model-gateway.mjs";
import { createProviderResilience } from "../atlasz-addons/provider-resilience.mjs";
import { createModelIntelligence } from "../atlasz-addons/brain/model-intelligence.mjs";
import { createCapabilityGraph } from "../atlasz-addons/brain/capability-graph.mjs";
import { createProviderEgress } from "../atlasz-addons/provider-egress.mjs";
import { createEgressPolicy } from "../atlasz-addons/egress-policy.mjs";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { ROSTER } from "../atlasz-addons/agent-activity.mjs";
import { tmp, rm } from "./helpers.mjs";

const kp = generateOwnerKeyPair(), ap = (action, subject) => issueOwnerApproval({ privateKeyPem: kp.privateKeyPem, action, subject });
function mk({ adapters = null, hasCred = true, stopped = false } = {}) {
  const dir = tmp("mrb-"), auth = createOwnerAuth({ publicKeyB64: kp.publicKeyB64 }), holder = { bridge: null };
  const reg = createModelRegistry({ dir: path.join(dir, "reg"), ownerAuth: auth, gate: () => ({ allowed: !stopped, reason: "STOP" }), liveStatus: id => holder.bridge?.liveStatus(id) ?? false, hasCredential: () => hasCred });
  reg.seedDefaults();
  reg.addModel({ id: "llama-local", providerId: "ollama-local", version: "1.0.0", costClass: "FREE", capabilities: ["text"] });
  reg.addProvider({ id: "synth-ai", displayName: "Synthetic AI", kind: "CLOUD", egressHosts: ["api.synth-ai.com"], credentialRef: "SYNTH_KEY" });
  reg.addModel({ id: "synth-1", providerId: "synth-ai", version: "1.0.0", costClass: "PAID", costPer1kTokensUsd: 0.01, capabilities: ["text"] });
  const egress = createEgressPolicy({ ownerAuth: auth, stateDir: path.join(dir, "egress"), isStopped: () => stopped });
  const pe = createProviderEgress({ registry: reg, egress, gate: () => ({ allowed: !stopped, reason: "STOP" }), dir: path.join(dir, "pe") });
  const res = createProviderResilience({ gate: () => ({ allowed: !stopped }), clock: () => Date.now(), timeoutMs: 2000 }), gw = createModelGateway({ resilience: res, models: createModelIntelligence({ graph: createCapabilityGraph(), clockMs: () => Date.now() }) });
  const calls = { fetch: [], synth: 0 };
  const fetchImpl = async (url, init) => { calls.fetch.push([url, init?.method]); if (url.endsWith("/api/version")) return { ok: true, status: 200, text: async () => JSON.stringify({ version: "0.5.0" }) }; return { ok: true, status: 200, text: async () => JSON.stringify({ message: { content: "hello from local" }, eval_count: 3, prompt_eval_count: 4 }) }; };
  const synth = { endpoint: () => ({ url: "https://api.synth-ai.com/v1/chat", method: "POST" }), resolveAddresses: async () => ["93.184.216.34"], invoke: async () => { calls.synth++; return { output: "paid answer", costUsd: 0.002 }; }, probe: async () => ({ ok: true }) };
  const bridge = createModelRoutingBridge({ registry: reg, gateway: gw, providerEgress: pe, adapters: adapters ?? { "ollama-local": createOllamaAdapter({ fetchImpl }), "synth-ai": synth } });
  holder.bridge = bridge;
  const apply = id => { const p = pe.proposals().find(x => x.providerId === id); return pe.applyProposal(id, { ownerApproval: ap(p.action, p.subject) }); };
  const enable = id => reg.enable(id, { approval: ap("MODEL_ENABLE", reg.enableSubject(reg.getModel(id))) });
  return { dir, reg, bridge, pe, calls, gw, enable, apply, synth, done: () => rm(dir) };
}

test("nothing enabled / no LIVE evidence -> NO_ELIGIBLE_MODEL (nothing is faked)", async () => {
  const t = mk(); try {
    const r = await t.bridge.complete({ agentId: ROSTER[0], prompt: "hi" }); assert.equal(r.ok, false); assert.equal(r.reason, "NO_ELIGIBLE_MODEL");
    t.reg.enable("llama-local"); t.apply("ollama-local");
    const r2 = await t.bridge.complete({ agentId: ROSTER[0], prompt: "hi" }); assert.equal(r2.reason, "NO_ELIGIBLE_MODEL", "enabled but never probed = not LIVE"); assert.equal(t.calls.fetch.length, 0, "no request leaves before a probe");
  } finally { t.done(); }
});

test("enabled local model + egress policy + passing probe -> LIVE -> a free call goes through the Ollama adapter (loopback only), screened as untrusted", async () => {
  const t = mk(); try {
    t.reg.enable("llama-local"); t.apply("ollama-local");
    const p = await t.bridge.probeAll(); assert.equal(p["llama-local"], "PASS"); assert.equal(t.bridge.liveStatus("llama-local"), true);
    const r = await t.bridge.complete({ agentId: ROSTER[0], prompt: "say hello" });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.modelId, "llama-local"); assert.equal(r.output, "hello from local"); assert.equal(r.untrusted, true); assert.equal(r.costUsd, 0);
    assert.ok(t.calls.fetch.every(([u]) => u.startsWith("http://127.0.0.1:11434/")), JSON.stringify(t.calls.fetch));
  } finally { t.done(); }
});

test("no egress policy -> the request is blocked before the adapter runs; kill switch blocks cloud and local", async () => {
  const t = mk(); try {
    t.reg.enable("llama-local");                                             // enabled, probe cannot pass without a policy
    const p = await t.bridge.probeAll(); assert.equal(p["llama-local"], "FAIL"); assert.equal(t.calls.fetch.length, 0);
  } finally { t.done(); }
  const s = mk({ stopped: true }); try { s.reg.enable("llama-local"); assert.equal((await s.bridge.complete({ agentId: ROSTER[0], prompt: "x" })).ok, false); assert.equal(s.calls.fetch.length, 0); } finally { s.done(); }
});

test("a paid model is used only with an explicit budget, only after owner enable + egress approval, and is billed once per request key", async () => {
  const t = mk(); try {
    t.reg.enable("llama-local"); t.apply("ollama-local"); t.enable("synth-1"); t.apply("synth-ai"); await t.bridge.probeAll();
    const free = await t.bridge.complete({ agentId: ROSTER[0], prompt: "free path" }); assert.equal(free.modelId, "llama-local"); assert.equal(t.calls.synth, 0);
    t.reg.setAssignment(ROSTER[0], { primary: "synth-1", fallbacks: ["llama-local"], capability: "text" });
    const noBudget = await t.bridge.complete({ agentId: ROSTER[0], prompt: "no budget" }); assert.equal(noBudget.modelId, "llama-local", "maxCostUsd=0 never selects a paid model"); assert.equal(t.calls.synth, 0);
    const paid = await t.bridge.complete({ agentId: ROSTER[0], prompt: "with budget", maxCostUsd: 1, requestKey: "job:paid-0001" }); assert.equal(paid.modelId, "synth-1"); assert.equal(paid.costUsd, 0.002); assert.equal(t.calls.synth, 1);
    const dup = await t.bridge.complete({ agentId: ROSTER[0], prompt: "with budget", maxCostUsd: 1, requestKey: "job:paid-0001" }); assert.equal(dup.reason, "DUPLICATE_BILLING_BLOCKED"); assert.equal(t.calls.synth, 1, "a settled request key is never billed twice");
  } finally { t.done(); }
});

test("a failing paid adapter fails over only after a settled zero-cost failure; no adapter -> model never registered", async () => {
  let n = 0; const adapters = { "ollama-local": createOllamaAdapter({ fetchImpl: async u => u.endsWith("/api/version") ? { ok: true, text: async () => '{"version":"1"}' } : { ok: true, text: async () => '{"message":{"content":"fallback ok"}}' } }) };
  const t = mk({ adapters }); try {
    t.reg.enable("llama-local"); t.apply("ollama-local"); t.enable("synth-1"); await t.bridge.probeAll();
    assert.deepEqual(t.bridge.status().registeredInGateway, ["llama-local"], "synth-1 has no adapter -> not registered");
    assert.equal((await t.bridge.complete({ agentId: ROSTER[0], prompt: "q" })).modelId, "llama-local");
  } finally { t.done(); }
  const bad = { "ollama-local": createOllamaAdapter({ fetchImpl: async u => { if (u.endsWith("/api/version")) return { ok: true, text: async () => '{"version":"1"}' }; n++; throw new Error("boom"); } }) };
  const u = mk({ adapters: bad }); try { u.reg.enable("llama-local"); u.apply("ollama-local"); await u.bridge.probeAll(); const r = await u.bridge.complete({ agentId: ROSTER[0], prompt: "q" }); assert.equal(r.ok, false); assert.equal(r.reason, "NO_ELIGIBLE_MODEL"); assert.ok(n >= 1); } finally { u.done(); }
});

test("the Ollama adapter refuses non-loopback base URLs and malformed or oversized answers", async () => {
  for (const b of ["http://localhost:11434", "http://10.0.0.5:11434", "https://127.0.0.1:11434", "http://127.0.0.1:11434/x", "http://2130706433:11434"]) assert.throws(() => createOllamaAdapter({ baseUrl: b }), /LOCAL_AI_BASE_URL/, b);
  const bad = createOllamaAdapter({ fetchImpl: async () => ({ ok: true, text: async () => '{"nope":1}' }) }); await assert.rejects(() => bad.invoke({ model: "m", prompt: "p" }), /OLLAMA_RESPONSE_SHAPE/);
  const big = createOllamaAdapter({ fetchImpl: async () => ({ ok: true, text: async () => "x".repeat(2 * 1024 * 1024) }) }); await assert.rejects(() => big.invoke({ model: "m", prompt: "p" }), /RESPONSE_TOO_LARGE/);
  const http500 = createOllamaAdapter({ fetchImpl: async () => ({ ok: false, status: 500 }) }); assert.deepEqual(await http500.probe(), { ok: false });
});
