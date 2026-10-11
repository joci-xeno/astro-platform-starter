// Model routing bridge (23-point items 4/5/6/7/18/20): the ONE connection between the owner-managed model registry and the model gateway.
//
//   registry (which models exist, enabled, assigned to which of the 30 agents)  ->  bridge  ->  gateway/provider-resilience (probe = LIVE evidence, breaker, ledger)
//                                                                                          ->  provider-egress (+ egress-policy + kill switch) before any request
//                                                                                          ->  registry billing guard (a paid request key is billed once; failover only after a zero-cost failure)
//   Adapters are INJECTED per provider id: { endpoint(model) -> {url, method, bodyBytes?}, invoke({model, prompt, signal}) -> {output, costUsd?, tokensIn?, tokensOut?},
//   probe({model}) -> {ok}, resolveAddresses?(host) -> string[] }. Without an adapter a model is never registered, so with no adapters / credentials every call
//   answers NO_ELIGIBLE_MODEL - nothing is faked. A real Ollama adapter for the loopback server is provided (createOllamaAdapter); it only ever talks to 127.0.0.1.
//
//   syncGateway()            registers every ENABLED registry model that has an adapter as a gateway provider (idempotent); disabled models are blocked at call time.
//   probeAll()               gateway.probe(): LIVE exists only for a model whose real probe passed (liveStatus(modelId) feeds the registry).
//   complete({agentId, prompt, capability, maxCostUsd, requestKey})
//                            registry.resolve(agent assignment -> role defaults -> others; no-spend by default) -> for each candidate: billing.begin -> egress check -> adapter.invoke
//                            -> billing.settle. Failover happens only after a settled zero-cost failure. Output is UNTRUSTED text, screened by `security` when given.
//   Never throws. Status honesty: IMPLEMENTED + TESTED with fake adapters/fetch and the real registry, egress and billing engines; the Ollama adapter is TESTED
//   against a fake fetch. Whether a real Ollama answers on this PC is unknown until the owner runs the probe.
import { createHash } from "node:crypto";
import { assertLoopbackBaseUrl, DEFAULT_BASE_URL } from "./local-ai-manager.mjs";
import { needsApproval } from "./model-registry.mjs";

export const BRIDGE_LIMITS = Object.freeze({ maxPromptChars: 20000, maxOutputChars: 50000, timeoutMs: 60000, maxResponseBytes: 1024 * 1024, maxOutputTokens: 1024 });
const PRE_SEND = new Set(["NO_CREDENTIAL", "ADDRESS_NOT_PINNED", "HTTPS_HOST_ONLY", "URL_INVALID", "FETCH_UNAVAILABLE"]);      // failures that happen before any byte leaves: safe to treat as zero cost
const sha = t => createHash("sha256").update(t).digest("hex");
const R = (reason, extra = {}) => ({ ok: false, reason, untrusted: true, ...extra });
const withTimeout = (p, ms, label) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label + "_TIMEOUT")), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };

/** Ollama (loopback) adapter. Talks to http://127.0.0.1[:port] ONLY (assertLoopbackBaseUrl). `fetchImpl` defaults to the global fetch and is injected in tests. */
export function createOllamaAdapter({ baseUrl = DEFAULT_BASE_URL, fetchImpl = null, timeoutMs = 60000 } = {}) {
  const base = assertLoopbackBaseUrl(baseUrl).origin;
  const f = () => { const x = fetchImpl ?? globalThis.fetch; if (typeof x !== "function") throw new Error("FETCH_UNAVAILABLE"); return x; };
  const readJson = async res => {
    if (!res || res.ok !== true) throw new Error("HTTP_" + (res?.status ?? "ERR"));
    const text = typeof res.text === "function" ? await res.text() : JSON.stringify(await res.json());
    if (text.length > BRIDGE_LIMITS.maxResponseBytes) throw new Error("RESPONSE_TOO_LARGE");
    return JSON.parse(text);
  };
  return {
    kind: "OLLAMA_LOOPBACK",
    endpoint: () => ({ url: base + "/api/chat", method: "POST" }),
    async invoke({ model, prompt, signal }) {
      const body = JSON.stringify({ model, messages: [{ role: "user", content: prompt }], stream: false });
      const j = await readJson(await withTimeout(f()(base + "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body, signal, redirect: "error" }), timeoutMs, "OLLAMA"));
      const out = j?.message?.content; if (typeof out !== "string") throw new Error("OLLAMA_RESPONSE_SHAPE");
      return { output: out, costUsd: 0, tokensIn: Number.isFinite(j.prompt_eval_count) ? j.prompt_eval_count : null, tokensOut: Number.isFinite(j.eval_count) ? j.eval_count : null };
    },
    async probe() { try { const j = await readJson(await withTimeout(f()(base + "/api/version", { method: "GET", redirect: "error" }), Math.min(timeoutMs, 5000), "OLLAMA_PROBE")); return { ok: typeof j?.version === "string" }; } catch { return { ok: false }; } },
    endpointFor: path => ({ url: base + path, method: path === "/api/version" ? "GET" : "POST" })
  };
}

export function createModelRoutingBridge({ registry, gateway, providerEgress, adapters = {}, security = null, clock = () => Date.now(), now = () => new Date().toISOString() } = {}) {
  if (!registry || typeof registry.resolve !== "function" || !registry.billing) throw new Error("REGISTRY_REQUIRED");
  if (!gateway || typeof gateway.register !== "function") throw new Error("GATEWAY_REQUIRED");
  if (!providerEgress || typeof providerEgress.checkModelRequest !== "function") throw new Error("PROVIDER_EGRESS_REQUIRED");
  const registered = new Map(), stats = { calls: 0, blocked: 0, billedBlocked: 0 };
  const adapterFor = m => { try { return typeof adapters === "function" ? (adapters(m.providerId) ?? null) : (Object.hasOwn(adapters, m.providerId) ? adapters[m.providerId] : null); } catch { return null; } };      // adapters: {providerId: adapter} or a resolver function
  const costClass = m => (m.costClass === "FREE" ? "FREE" : m.costClass === "PAID" ? "PAID" : "UNKNOWN");

  /** One guarded request: registry still enabled + egress policy + kill switch, then the adapter. */
  async function guarded(m, prompt) {
    const a = adapterFor(m); if (!a) return R("NO_ADAPTER", { notSent: true });
    const cur = registry.getModel(m.id); if (!cur || cur.enabled !== true) return R("MODEL_DISABLED", { notSent: true });
    let ra, ep;
    try { ep = a.endpoint(cur); ra = typeof a.resolveAddresses === "function" ? await a.resolveAddresses(new URL(ep.url).hostname) : (cur.kind === "LOCAL" ? ["127.0.0.1"] : []); } catch { return R("RESOLVE_FAILED", { notSent: true }); }
    const d = providerEgress.checkModelRequest({ modelId: cur.id, url: ep.url, method: ep.method, bodyBytes: Buffer.byteLength(prompt) + 512, resolvedAddresses: ra });
    if (!d.allowed) { stats.blocked++; return R("EGRESS_BLOCKED:" + d.reason, { notSent: true }); }
    const ac = new AbortController();
    try {
      const r = await withTimeout(a.invoke({ model: cur.providerModel ?? cur.id, prompt, signal: ac.signal, maxTokens: BRIDGE_LIMITS.maxOutputTokens, pin: ra }), BRIDGE_LIMITS.timeoutMs, "INVOKE");
      // cost: the adapter's own figure if it has one, else reported token usage x the registry price (owner-approved config); otherwise UNKNOWN (null), never 0
      if ((r.costUsd === null || r.costUsd === undefined) && Number.isFinite(r.tokensIn) && Number.isFinite(r.tokensOut) && Number.isFinite(cur.costPer1kTokensUsd)) r.costUsd = ((r.tokensIn + r.tokensOut) / 1000) * cur.costPer1kTokensUsd;
      return { ok: true, ...r };
    }
    catch (e) { ac.abort(); const msg = String(e?.message ?? e).slice(0, 100); return R("INVOKE_FAILED:" + msg, { notSent: PRE_SEND.has(msg) }); }
  }

  function syncGateway() {
    const out = [];
    for (const m of registry.listModels()) {
      if (!m.enabled || registered.has(m.id)) continue;
      const a = adapterFor(m); if (!a) { out.push({ id: m.id, registered: false, reason: "NO_ADAPTER_FOR_PROVIDER:" + m.providerId }); continue; }
      try {
        gateway.register({ id: m.id, family: m.family, costClass: costClass(m), capabilities: m.capabilities, models: [m.id],
          invoke: async prompt => { const r = await guarded(m, String(prompt)); if (!r.ok) throw new Error(r.reason); return r; },
          probe: async () => { const cur = registry.getModel(m.id); if (!cur?.enabled) return { ok: false }; const ep = typeof a.endpointFor === "function" ? a.endpointFor("/api/version") : a.endpoint(cur);
            let ra = []; try { ra = typeof a.resolveAddresses === "function" ? await a.resolveAddresses(new URL(ep.url).hostname) : (cur.kind === "LOCAL" ? ["127.0.0.1"] : []); } catch { return { ok: false }; }
            const d = providerEgress.checkModelRequest({ modelId: cur.id, url: ep.url, method: ep.method, bodyBytes: 0, resolvedAddresses: ra }); if (!d.allowed) return { ok: false };
            try { return { ok: (await a.probe({ model: cur.id, pin: ra }))?.ok === true }; } catch { return { ok: false }; } } });
        registered.set(m.id, true); out.push({ id: m.id, registered: true });
      } catch (e) { out.push({ id: m.id, registered: false, reason: String(e.message).slice(0, 80) }); }
    }
    return out;
  }
  async function probeAll() { syncGateway(); try { return await gateway.probe(); } catch (e) { return { error: String(e.message).slice(0, 80) }; } }
  /** LIVE only from the gateway's own passing probe (feeds model-registry's liveStatus). */
  const liveStatus = id => { try { return gateway.health().some(h => h.id === id && h.state === "LIVE"); } catch { return false; } };

  async function complete({ agentId, prompt, capability = "text", maxCostUsd = 0, requestKey = null } = {}) {
    if (typeof prompt !== "string" || !prompt.trim()) return R("PROMPT_REQUIRED");
    if (prompt.length > BRIDGE_LIMITS.maxPromptChars) return R("PROMPT_TOO_LONG");
    syncGateway();
    const rk = typeof requestKey === "string" && /^[\w:.-]{8,100}$/.test(requestKey) ? requestKey : "req:" + sha(prompt + "\0" + clock() + "\0" + stats.calls).slice(0, 32);
    if (!Number.isFinite(maxCostUsd) || maxCostUsd < 0) return R("BUDGET_INVALID");
    const plan = registry.resolve({ agentId, capability, maxCostUsd, estimateTokens: Math.ceil(prompt.length / 4) + BRIDGE_LIMITS.maxOutputTokens });      // the budget covers the longest answer we allow, not just the prompt
    if (!plan.ok) return R(plan.reason);
    stats.calls++;
    const tried = [];
    for (const c of plan.candidates) {
      const m = registry.getModel(c.id); if (!m) continue;
      const paid = needsApproval(m);
      if (paid) { const b = registry.billing.begin(rk, c.id, { estimateUsd: c.estimateUsd }); if (!b.ok) { stats.billedBlocked++; tried.push({ id: c.id, reason: b.reason }); if (b.reason === "DUPLICATE_BILLING_BLOCKED") return R("DUPLICATE_BILLING_BLOCKED", { requestKey: rk, tried }); continue; } }
      const r = await guarded(m, prompt);
      if (!r.ok) {
        // A paid request that may already have reached the provider is NOT a zero-cost failure: it is booked at its worst-case estimate and blocks failover under this key.
        if (paid) registry.billing.settle(rk, r.notSent ? { ok: false, costUsd: 0 } : { ok: false, costUsd: c.estimateUsd > 0 ? c.estimateUsd : Number.MIN_VALUE });
        tried.push({ id: c.id, reason: r.reason, billedAtEstimate: Boolean(paid && !r.notSent) }); continue;
      }
      const cost = Number.isFinite(r.costUsd) && r.costUsd >= 0 ? r.costUsd : null;
      if (paid) registry.billing.settle(rk, { ok: true, costUsd: cost ?? c.estimateUsd ?? 0 });      // unknown actual cost is booked at the estimate (an upper bound), never 0
      const budgetExceeded = paid && (cost ?? c.estimateUsd ?? 0) > maxCostUsd;
      let text = String(r.output ?? ""), truncated = false; if (text.length > BRIDGE_LIMITS.maxOutputChars) { text = text.slice(0, BRIDGE_LIMITS.maxOutputChars); truncated = true; }
      let screening = { decision: "NOT_SCREENED" };
      if (security) { const a = security.assess({ kind: "EXTERNAL_INSTRUCTION", agentId: agentId ?? null, source: "model:" + c.id, text }); screening = { decision: a.decision, reasons: a.reasons ?? [] }; if (!a.allowed) return { ok: true, modelId: c.id, providerId: c.providerId, output: null, quarantined: true, screening, costUsd: cost, costKnown: cost !== null, untrusted: true, requestKey: rk }; }
      return { ok: true, modelId: c.id, providerId: c.providerId, family: c.family, version: c.version, output: text, truncated, screening, costUsd: cost, costKnown: cost !== null, budgetExceeded, live: liveStatus(c.id), tried, requestKey: rk, untrusted: true, at: now() };
    }
    return R("NO_ELIGIBLE_MODEL", { skipped: plan.skipped, tried, note: plan.note ?? "nothing enabled, credentialed and LIVE within the budget has a working adapter" });
  }

  const status = () => ({ state: "CONNECTED_REGISTRY_TO_GATEWAY", adapters: typeof adapters === "function" ? registry.listModels().map(m => m.providerId).filter((x, i, a) => a.indexOf(x) === i && adapterFor({ providerId: x })) : Object.keys(adapters), registeredInGateway: [...registered.keys()], stats: { ...stats },
    live: registry.listModels().filter(m => liveStatus(m.id)).map(m => m.id), note: "LIVE means our own probe passed; nothing is LIVE until a real adapter answers its probe." });
  return { syncGateway, probeAll, complete, liveStatus, status };
}
