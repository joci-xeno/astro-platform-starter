// Cloud provider adapters with a fake fetch: wire shapes, credential handling, cost honesty, fail-closed behaviour. No provider is contacted.
import test from "node:test";
import assert from "node:assert/strict";
import { createCloudAdapter, createPinnedTransport, PROVIDER_PROFILES } from "../atlasz-addons/provider-adapters.mjs";

const KEY = "sk-test-" + "k".repeat(24);
const rec = (reply, ok = true) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return { ok, status: ok ? 200 : 401, text: async () => JSON.stringify(reply) }; }; f.calls = calls; return f; };
const mk = (id, fetchImpl, cred = KEY) => createCloudAdapter({ providerId: id, credentialRef: "REF", getCredential: ref => (ref === "REF" ? cred : null), fetchImpl });

test("openai-compatible wire: bearer header, exact host, usage-derived tokens, cost left UNKNOWN (null) for the bridge to price", async () => {
  for (const id of ["openai", "deepseek", "xai", "mistral", "openrouter", "vercel-ai-gateway", "minimax", "glm", "perplexity", "huggingface"]) {
    const f = rec({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), a = mk(id, f);
    const r = await a.invoke({ model: "vendor/m-1", prompt: "q" });
    assert.equal(r.output, "hi"); assert.equal(r.tokensIn, 10); assert.equal(r.tokensOut, 5); assert.equal(r.costUsd, null);
    const { url, init } = f.calls[0]; assert.equal(new URL(url).host, PROVIDER_PROFILES[id].host); assert.equal(new URL(url).protocol, "https:");
    assert.equal(init.headers.authorization, "Bearer " + KEY); assert.equal(init.redirect, "error"); assert.equal(JSON.parse(init.body).model, "vendor/m-1");
  }
});
test("anthropic and gemini wire shapes", async () => {
  let f = rec({ content: [{ type: "text", text: "A" }, { type: "text", text: "B" }], usage: { input_tokens: 3, output_tokens: 4 } }), r = await mk("anthropic", f).invoke({ model: "claude-x", prompt: "q" });
  assert.equal(r.output, "AB"); assert.equal(f.calls[0].init.headers["x-api-key"], KEY); assert.equal(f.calls[0].init.headers["anthropic-version"], "2023-06-01"); assert.equal(JSON.parse(f.calls[0].init.body).max_tokens, 1024);
  f = rec({ candidates: [{ content: { parts: [{ text: "G" }] } }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 6 } }); r = await mk("google", f).invoke({ model: "gemini-x", prompt: "q" });
  assert.equal(r.output, "G"); assert.equal(f.calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent"); assert.equal(f.calls[0].init.headers["x-goog-api-key"], KEY); assert.equal(r.tokensOut, 6);
});
test("no credential, malformed credential or a throwing resolver: NO_CREDENTIAL and NO request is made; the key never appears in an error", async () => {
  for (const cred of [null, "", "short", "has space in key value", "x".repeat(600)]) {
    const f = rec({}), a = mk("openai", f, cred);
    await assert.rejects(() => a.invoke({ model: "m", prompt: "q" }), e => e.message === "NO_CREDENTIAL"); assert.equal(f.calls.length, 0);
    assert.deepEqual(await a.probe(), { ok: false, reason: "NO_CREDENTIAL" });
  }
  const a = createCloudAdapter({ providerId: "openai", credentialRef: "REF", getCredential: () => { throw new Error("vault locked"); }, fetchImpl: rec({}) });
  await assert.rejects(() => a.invoke({ model: "m", prompt: "q" }), e => e.message === "NO_CREDENTIAL");
  const bad = createCloudAdapter({ providerId: "openai", credentialRef: "REF", getCredential: () => KEY, fetchImpl: async () => ({ ok: false, status: 401, text: async () => "echo " + KEY }) });
  await assert.rejects(() => bad.invoke({ model: "m", prompt: "q" }), e => e.message === "HTTP_401" && !e.message.includes(KEY));
});
test("response hardening: wrong shape, oversize, non-JSON all fail; probe/discover use the free model list; Perplexity cannot be probed", async () => {
  await assert.rejects(() => mk("openai", rec({ choices: [] })).invoke({ model: "m", prompt: "q" }), /PROVIDER_RESPONSE_SHAPE/);
  await assert.rejects(() => mk("openai", async () => ({ ok: true, text: async () => "x".repeat(3 * 1024 * 1024) })).invoke({ model: "m", prompt: "q" }), /RESPONSE_TOO_LARGE/);
  await assert.rejects(() => mk("openai", async () => ({ ok: true, text: async () => "<html>" })).invoke({ model: "m", prompt: "q" }));
  const f = rec({ data: [{ id: "gpt-a" }, { id: "../evil" }, { id: "gpt-b" }] }), a = mk("openai", f);
  assert.deepEqual(await a.probe(), { ok: true }); assert.equal(f.calls[0].init.method, "GET"); assert.equal(f.calls[0].url, "https://api.openai.com/v1/models");
  assert.deepEqual((await a.discover()).models, ["gpt-a", "gpt-b"], "unsafe ids are dropped");
  const g = mk("google", rec({ models: [{ name: "models/gemini-1" }] })); assert.deepEqual((await g.discover()).models, ["gemini-1"]);
  const p = mk("perplexity", rec({})); assert.deepEqual(await p.probe(), { ok: false, reason: "PROBE_UNSUPPORTED" }); assert.equal((await p.discover()).reason, "DISCOVERY_UNSUPPORTED");
  assert.deepEqual((await mk("openai", rec({ error: "x" }, false)).probe()).ok, false);
});
test("endpoint() accepts a registry record and uses its providerModel; profile host must be a plain https host", () => {
  assert.equal(mk("openrouter", rec({})).endpoint({ id: "slug", providerModel: "openai/gpt-4o" }).url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(mk("google", rec({})).endpoint({ id: "slug", providerModel: "gemini-1.5" }).url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5:generateContent");
  assert.throws(() => createCloudAdapter({ providerId: "x", profile: { style: "openai-compat", host: "evil.com/path?x", chat: "/c" } }), /PROVIDER_PROFILE_INVALID/);
  assert.throws(() => createCloudAdapter({ providerId: "nope" }), /PROVIDER_PROFILE_INVALID/);
});

test("pinned transport: only the addresses the caller passes (pinTo) are connectable; missing, invalid, non-https, userinfo and port URLs fail closed before any socket", async () => {
  const tr = createPinnedTransport({ lookup: async () => [{ address: "93.184.216.34", family: 4 }, { address: "nope" }] });
  assert.deepEqual(await tr.resolveAddresses("api.openai.com"), ["93.184.216.34"], "non-IP answers are dropped");
  await assert.rejects(() => tr.fetch("https://api.openai.com/v1/models"), /ADDRESS_NOT_PINNED/);
  await assert.rejects(() => tr.fetch("https://api.openai.com/v1/models", { pinTo: ["not-an-ip"] }), /ADDRESS_NOT_PINNED/);
  for (const u of ["http://api.openai.com/x", "https://user:pw@api.openai.com/x", "https://api.openai.com:8443/x", "not a url"]) await assert.rejects(() => tr.fetch(u, { pinTo: ["93.184.216.34"] }), /HTTPS_HOST_ONLY|URL_INVALID/);
  await assert.rejects(() => createPinnedTransport({ lookup: async () => [] }).resolveAddresses("a.example.com"), /DNS_NO_ADDRESS/);
  const a = createCloudAdapter({ providerId: "openai", credentialRef: "R", getCredential: () => KEY });          // no fetch injected: production transport
  assert.equal(typeof a.resolveAddresses, "function");
  await assert.rejects(() => a.invoke({ model: "m", prompt: "q" }), /ADDRESS_NOT_PINNED/, "without the checked addresses nothing is sent");
});

test("Batch 7B: whatever a transport puts into an error (even a key that no pattern recognises), the credential never leaves the adapter; invalid credentials surface as HTTP_401 only", async () => {
  const ODD = "plain-odd-credential-" + "z".repeat(20);
  const leaky = async () => { throw new Error("socket hang up while sending Authorization: Bearer " + ODD); };
  const a = mk("openai", leaky, ODD);
  await assert.rejects(a.invoke({ model: "m", prompt: "p", pin: ["93.184.216.34"] }), e => !String(e.message).includes(ODD) && /redacted/.test(e.message));
  const pr = await mk("openai", leaky, ODD).probe({ pin: ["93.184.216.34"] }); assert.equal(pr.ok, false); assert.ok(!JSON.stringify(pr).includes(ODD));
  const ds = await mk("openai", leaky, ODD).discover({ pin: ["93.184.216.34"] }); assert.ok(!JSON.stringify(ds).includes(ODD));
  const unauthorized = mk("openai", rec({ error: "invalid key " + ODD }, false), ODD);
  await assert.rejects(unauthorized.invoke({ model: "m", prompt: "p", pin: ["93.184.216.34"] }), e => e.message === "HTTP_401");
  const p401 = await unauthorized.probe({ pin: ["93.184.216.34"] }); assert.deepEqual([p401.ok, p401.reason], [false, "HTTP_401"]);
});
