// Model Gateway: ONE path from a caller (typed tool, agent, scheduler) to a language model, composing what already exists instead of adding a router:
//   provider-resilience   -> invocation, circuit breaker, no-spend cost router with fallback, independent judge, token/cost ledger hook
//   brain/model-intelligence -> the measured model graph (capabilities, family, cost class, latency from OUR probes)
// A provider is usable only after a real probe of ours passed (one probe feeds both registries; latency is measured here). Nothing is registered
// without a real adapter, so with no credentials every call honestly answers NO_ELIGIBLE_PROVIDER. Spending needs a separate owner-approved path:
// this gateway never raises a budget by itself. Model output is UNTRUSTED text: it is screened by the Security Brain before being returned and is
// labelled untrusted either way.
export function createModelGateway({ resilience, models, security = null, blackBox = null, clockMs = () => Date.now(), maxPromptChars = 20000, maxOutputChars = 50000 } = {}) {
  if (!resilience || typeof resilience.invoke !== "function") throw new Error("RESILIENCE_REQUIRED");
  if (!models || typeof models.register !== "function") throw new Error("MODEL_INTELLIGENCE_REQUIRED");
  const providers = new Map(), log = (kind, d) => { try { blackBox?.record({ kind, ...d }); } catch { /* audit must not change the result */ } };

  /** provider: {id, family, costClass, capabilities[], models[], invoke(request), probe()} - same contract as provider-resilience. */
  function register(provider) {
    const r = resilience.register(provider);
    models.register({ id: provider.id, family: provider.family ?? provider.id, costClass: provider.costClass ?? "UNKNOWN", capabilities: provider.capabilities ?? [], provider: provider.id });
    providers.set(provider.id, provider); log("MODEL_PROVIDER_REGISTERED", { id: provider.id, family: provider.family ?? provider.id, costClass: provider.costClass ?? "UNKNOWN" });
    return r;
  }
  /** One REAL probe per provider; both registries are updated from that single result. Probes must not spend money. */
  async function probe() {
    const out = {};
    for (const [id, p] of providers) {
      const r = await models.probe(id, () => p.probe());                      // measures latency, records evidence or DOWN
      out[id] = resilience.recordProbe(id, r.ok === true, r.error ?? null);
    }
    log("MODEL_PROBE", { results: out }); return out;
  }
  /** complete({capability, prompt, budgetUsd?}) -> never throws. budgetUsd defaults to 0 (no-spend); a non-FREE provider is skipped without it. */
  async function complete({ capability = "text", prompt, budgetUsd = 0, estimateCostUsd = 0, jobId = null } = {}) {
    if (typeof prompt !== "string" || !prompt.trim()) return { ok: false, reason: "PROMPT_REQUIRED", untrusted: true };
    if (prompt.length > maxPromptChars) return { ok: false, reason: "PROMPT_TOO_LONG", untrusted: true };
    let r; try { r = await resilience.invoke({ capability, request: prompt, budgetUsd, estimateCostUsd, jobId }); } catch (e) { log("MODEL_CALL", { ok: false, reason: String(e.message).slice(0, 80) }); return { ok: false, reason: String(e.message).slice(0, 120), untrusted: true }; }
    if (!r.ok) { log("MODEL_CALL", { ok: false, reason: r.reason }); return { ok: false, reason: r.reason, attempts: r.attempts, skipped: r.skipped, untrusted: true }; }
    let text = typeof r.output === "string" ? r.output : JSON.stringify(r.output ?? null); let truncated = false;
    if (text.length > maxOutputChars) { text = text.slice(0, maxOutputChars); truncated = true; }
    let screening = { decision: "NOT_SCREENED" };
    if (security) { const a = security.assess({ kind: "EXTERNAL_INSTRUCTION", agentId: null, source: "model:" + r.providerId, text }); screening = { decision: a.decision, reasons: a.reasons ?? [] };
      if (!a.allowed) { log("MODEL_CALL", { ok: true, provider: r.providerId, quarantined: true }); return { ok: true, providerId: r.providerId, family: r.family, output: null, quarantined: true, screening, costUsd: r.costUsd, untrusted: true }; } }
    log("MODEL_CALL", { ok: true, provider: r.providerId, costUsd: r.costUsd, truncated });
    return { ok: true, providerId: r.providerId, family: r.family, output: text, truncated, screening, costUsd: r.costUsd, attempts: r.attempts, untrusted: true };
  }
  /** Independent verification: a LIVE provider of a DIFFERENT family than the worker; if there is none, say so. */
  async function judge({ workerProviderId, prompt }) { return resilience.judge({ workerProviderId, prompt }); }
  const route = task => models.route(task);
  function summary() { const s = resilience.summary(); return { ...s, providersRegistered: providers.size, noSpendDefault: true, note: s.live === 0 ? "No provider is LIVE: model calls return NO_ELIGIBLE_PROVIDER. LIVE comes only from our own passing probe." : "LIVE providers listed passed our own probe." }; }
  return { register, probe, complete, judge, route, health: () => resilience.health(), summary };
}
