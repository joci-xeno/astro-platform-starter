// Cloud model-provider adapters (Phase 4). One small, strict HTTP framework with three wire styles:
//   openai-compat  POST {chat}  {model, messages}  -> choices[0].message.content   (OpenAI, DeepSeek, xAI, Mistral, OpenRouter, MiniMax, GLM, Perplexity, Hugging Face router)
//   anthropic      POST /v1/messages  (x-api-key, anthropic-version)              -> content[].text
//   gemini         POST /v1beta/models/{model}:generateContent  (x-goog-api-key)  -> candidates[0].content.parts[].text
// Contract (same as model-routing-bridge adapters): endpoint(model), endpointFor(path), invoke({model, prompt, signal, maxTokens}), probe(), discover(), resolveAddresses?.
// Safety properties:
//   * The base URL is fixed in the profile (https, exact host, no userinfo/port); the adapter can only ever talk to that host. The bridge ALSO checks every request against the owner-signed
//     egress policy and the kill switch before it gets here, so an adapter alone never authorises traffic.
//   * The credential is fetched from the injected resolver at call time, validated (charset/length), put into ONE header and never returned, logged or placed in an error message.
//     No resolver / no credential -> NO_CREDENTIAL (fail closed, no request is made).
//   * redirect:"error", response size cap, JSON shape checks, abort + timeout. Cost is computed only from usage the provider reports and a registry price; otherwise costUsd is null (unknown, never 0).
//   * probe/discover use the provider's model-list endpoint (no tokens, no charge). Providers without one (Perplexity) report PROBE_UNSUPPORTED and therefore never become LIVE by probe alone.
// Status: IMPLEMENTED + TESTED with fake fetch. No provider has been contacted: whether any of these hosts/paths work with the owner's key is UNKNOWN until the owner supplies a credential and runs the probe.
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
const MAX_RESPONSE = 2 * 1024 * 1024;
const KEY_RE = /^[A-Za-z0-9._~+\/=:-]{8,512}$/;

export const PROVIDER_PROFILES = Object.freeze({
  openai: { style: "openai-compat", host: "api.openai.com", chat: "/v1/chat/completions", models: "/v1/models" },
  deepseek: { style: "openai-compat", host: "api.deepseek.com", chat: "/chat/completions", models: "/models" },
  xai: { style: "openai-compat", host: "api.x.ai", chat: "/v1/chat/completions", models: "/v1/models" },
  mistral: { style: "openai-compat", host: "api.mistral.ai", chat: "/v1/chat/completions", models: "/v1/models" },
  "vercel-ai-gateway": { style: "openai-compat", host: "ai-gateway.vercel.sh", chat: "/v1/chat/completions", models: "/v1/models" },
  openrouter: { style: "openai-compat", host: "openrouter.ai", chat: "/api/v1/chat/completions", models: "/api/v1/models" },
  minimax: { style: "openai-compat", host: "api.minimax.io", chat: "/v1/chat/completions", models: null },
  glm: { style: "openai-compat", host: "open.bigmodel.cn", chat: "/api/paas/v4/chat/completions", models: null },
  perplexity: { style: "openai-compat", host: "api.perplexity.ai", chat: "/chat/completions", models: null },
  huggingface: { style: "openai-compat", host: "router.huggingface.co", chat: "/v1/chat/completions", models: "/v1/models" },
  anthropic: { style: "anthropic", host: "api.anthropic.com", chat: "/v1/messages", models: "/v1/models" },
  google: { style: "gemini", host: "generativelanguage.googleapis.com", chat: "/v1beta/models/{model}:generateContent", models: "/v1beta/models" }
});

const withTimeout = (p, ms, label) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label + "_TIMEOUT")), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };
const num = v => (Number.isFinite(v) && v >= 0 ? v : null);

/** The caller passes the exact IP addresses the egress policy checked (`pinTo`); the transport connects ONLY to one of them (no shared state, so concurrent requests cannot swap each other's address). TLS still verifies the certificate for the host name. */
export function createPinnedTransport({ lookup = (h => dns.promises.lookup(h, { all: true })) } = {}) {
  const resolveAddresses = async host => {
    const r = await lookup(host), addrs = (Array.isArray(r) ? r : [r]).filter(x => x && typeof x.address === "string" && net.isIP(x.address));
    if (!addrs.length) throw new Error("DNS_NO_ADDRESS");
    return addrs.map(a => a.address);
  };
  const fetchPinned = (url, init = {}) => new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch { return reject(new Error("URL_INVALID")); }
    if (u.protocol !== "https:" || u.username || u.password || u.port) return reject(new Error("HTTPS_HOST_ONLY"));
    const pin = Array.isArray(init.pinTo) ? init.pinTo.find(x => typeof x === "string" && net.isIP(x)) : null; if (!pin) return reject(new Error("ADDRESS_NOT_PINNED"));
    const fam = net.isIP(pin), req = https.request({ hostname: u.hostname, port: 443, path: u.pathname + u.search, method: init.method ?? "GET", headers: init.headers, signal: init.signal,
      lookup: (_h, o, cb) => (o && o.all ? cb(null, [{ address: pin, family: fam }]) : cb(null, pin, fam)) }, res => {
      const chunks = []; let n = 0;
      res.on("data", c => { n += c.length; if (n > MAX_RESPONSE) req.destroy(new Error("RESPONSE_TOO_LARGE")); else chunks.push(c); });
      res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: async () => Buffer.concat(chunks).toString("utf8") }));    // 3xx is never followed: ok=false
    });
    req.on("error", reject); if (init.body) req.write(init.body); req.end();
  });
  return { resolveAddresses, fetch: fetchPinned };
}

export function createCloudAdapter({ providerId, profile = PROVIDER_PROFILES[providerId], credentialRef = null, getCredential = () => null, fetchImpl = null, timeoutMs = 60000, pricePer1kUsd = () => null, resolveAddresses = null } = {}) {
  if (!profile || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(profile.host ?? "")) throw new Error("PROVIDER_PROFILE_INVALID");
  // production transport (no fetchImpl injected): DNS-pinned https; tests inject fetchImpl (+ resolveAddresses)
  const transport = fetchImpl ? null : createPinnedTransport(); if (transport && !resolveAddresses) resolveAddresses = transport.resolveAddresses;
  const base = "https://" + profile.host, f = () => { const x = fetchImpl ?? transport.fetch; if (typeof x !== "function") throw new Error("FETCH_UNAVAILABLE"); return x; };
  const mid = m => (m && typeof m === "object" ? (m.providerModel ?? m.id) : m);          // the bridge passes the registry record to endpoint(); a plain id also works
  const chatPath = model => profile.chat.replace("{model}", encodeURIComponent(String(mid(model))));
  const key = () => {
    let k = null; try { k = credentialRef ? getCredential(credentialRef) : null; } catch { k = null; }
    if (typeof k !== "string" || !KEY_RE.test(k)) throw new Error("NO_CREDENTIAL");
    return k;
  };
  /** Exact-value redaction: whatever a transport/library puts into an error, the credential itself never leaves this adapter (pattern scrubbing by the callers is a second layer). */
  const safeMsg = e => { let m = String(e?.message ?? e); try { const k = credentialRef ? getCredential(credentialRef) : null; if (typeof k === "string" && k.length >= 8) m = m.split(k).join("[redacted]"); } catch { /* no credential to hide */ } return m; };
  const headers = k => profile.style === "anthropic" ? { "x-api-key": k, "anthropic-version": "2023-06-01", "content-type": "application/json" }
    : profile.style === "gemini" ? { "x-goog-api-key": k, "content-type": "application/json" } : { authorization: "Bearer " + k, "content-type": "application/json" };
  const readJson = async res => {
    if (!res || res.ok !== true) throw new Error("HTTP_" + (res?.status ?? "ERR"));        // the body is not copied into the error: it could echo request data
    const text = typeof res.text === "function" ? await res.text() : JSON.stringify(await res.json());
    if (text.length > MAX_RESPONSE) throw new Error("RESPONSE_TOO_LARGE");
    return JSON.parse(text);
  };
  const body = (model, prompt, maxTokens) => profile.style === "anthropic" ? { model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }
    : profile.style === "gemini" ? { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } }
    : { model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, stream: false };
  const extract = j => {
    if (profile.style === "anthropic") return Array.isArray(j?.content) ? j.content.filter(c => c?.type === "text" && typeof c.text === "string").map(c => c.text).join("") || null : null;
    if (profile.style === "gemini") return Array.isArray(j?.candidates?.[0]?.content?.parts) ? j.candidates[0].content.parts.filter(p => typeof p?.text === "string").map(p => p.text).join("") || null : null;
    const c = j?.choices?.[0]?.message?.content; return typeof c === "string" ? c : null;
  };
  const usage = j => profile.style === "anthropic" ? [num(j?.usage?.input_tokens), num(j?.usage?.output_tokens)]
    : profile.style === "gemini" ? [num(j?.usageMetadata?.promptTokenCount), num(j?.usageMetadata?.candidatesTokenCount)] : [num(j?.usage?.prompt_tokens), num(j?.usage?.completion_tokens)];

  return {
    kind: "CLOUD_" + profile.style.toUpperCase().replace("-", "_"), providerId, host: profile.host, hasModelList: Boolean(profile.models),
    endpoint: model => ({ url: base + chatPath(model), method: "POST" }),
    endpointFor: p => ({ url: base + (profile.models ?? profile.chat.replace("{model}", "x")), method: profile.models ? "GET" : "POST" }),
    ...(resolveAddresses ? { resolveAddresses: host => resolveAddresses(host) } : {}),
    async invoke({ model, prompt, signal, maxTokens = 1024, pin = null }) {
      const k = key();                                                                 // throws NO_CREDENTIAL before any request
      let j; try { j = await readJson(await withTimeout(f()(base + chatPath(model), { method: "POST", headers: headers(k), body: JSON.stringify(body(model, prompt, maxTokens)), signal, redirect: "error", pinTo: pin }), timeoutMs, "PROVIDER")); } catch (e) { throw new Error(safeMsg(e)); }
      const out = extract(j); if (out === null) throw new Error("PROVIDER_RESPONSE_SHAPE");
      const [tin, tout] = usage(j), price = num(pricePer1kUsd(model));
      return { output: out, tokensIn: tin, tokensOut: tout, costUsd: price !== null && tin !== null && tout !== null ? ((tin + tout) / 1000) * price : null };
    },
    /** Free reachability + credential check via the model-list endpoint. Providers without one cannot be probed without spending, so they report PROBE_UNSUPPORTED (never LIVE by probe). */
    async probe({ pin = null } = {}) {
      if (!profile.models) return { ok: false, reason: "PROBE_UNSUPPORTED" };
      try { const k = key(); const j = await readJson(await withTimeout(f()(base + profile.models, { method: "GET", headers: headers(k), redirect: "error", pinTo: pin }), Math.min(timeoutMs, 10000), "PROBE")); return { ok: Array.isArray(j?.data) || Array.isArray(j?.models) }; }
      catch (e) { return { ok: false, reason: safeMsg(e).slice(0, 40) }; }
    },
    /** Model ids the provider reports (authoritative source for registry entries; never invented here). */
    async discover({ pin = null } = {}) {
      if (!profile.models) return { ok: false, reason: "DISCOVERY_UNSUPPORTED", models: [] };
      try {
        const k = key(), j = await readJson(await withTimeout(f()(base + profile.models, { method: "GET", headers: headers(k), redirect: "error", pinTo: pin }), Math.min(timeoutMs, 15000), "DISCOVER"));
        const arr = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
        return { ok: true, models: arr.map(m => String(m?.id ?? m?.name ?? "").replace(/^models\//, "")).filter(x => /^[A-Za-z0-9][A-Za-z0-9._:\/@+-]{0,119}$/.test(x)).slice(0, 500) };
      } catch (e) { return { ok: false, reason: safeMsg(e).slice(0, 40), models: [] }; }
    }
  };
}
