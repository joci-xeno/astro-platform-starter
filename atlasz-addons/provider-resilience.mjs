// V7.3 §13/§20 + runtime circuit breakers: provider health monitor, circuit breaker, no-spend cost router with fallback, independent judge, token/cost ledger hook.
// A provider is usable ONLY if this module itself recorded a passing probe (LIVE is derived from our own evidence, never from a caller flag).
// Without real credentials nothing is registered, so nothing is LIVE. Tests inject fakes; they are never shipped as providers.
import { emergencyGate } from "./emergency-stop.mjs";

export const BREAKER_STATES = Object.freeze(["CLOSED", "OPEN", "HALF_OPEN"]);
const COST_RANK = { FREE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

export function createCircuitBreaker({ failureThreshold = 3, cooldownMs = 30000, clock = () => Date.now() } = {}) {
  let state = "CLOSED", failures = 0, openedAt = 0;
  const current = () => { if (state === "OPEN" && clock() - openedAt >= cooldownMs) state = "HALF_OPEN"; return state; };
  return {
    state: current,
    allow: () => current() !== "OPEN",
    success: () => { failures = 0; state = "CLOSED"; },
    failure: () => { failures++; if (current() === "HALF_OPEN" || failures >= failureThreshold) { state = "OPEN"; openedAt = clock(); } },
    snapshot: () => ({ state: current(), failures, openedAt: state === "OPEN" ? openedAt : null })
  };
}
const withTimeout = (p, ms, label) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(label + "_TIMEOUT")), ms); Promise.resolve(p).then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });

export function createProviderResilience({ gate = emergencyGate, ledger = null, clock = () => Date.now(), now = () => new Date().toISOString(), timeoutMs = 20000, breaker = {} } = {}) {
  const P = new Map();
  /** provider: {id, family, costClass, capabilities[], models[], invoke(request)->{output, costUsd?, tokensIn?, tokensOut?, providerRef?}, probe()->{ok}} */
  function register(provider) {
    for (const f of ["id", "invoke", "probe"]) if (!provider?.[f]) throw new Error("PROVIDER_FIELD_REQUIRED:" + f);
    if (typeof provider.invoke !== "function" || typeof provider.probe !== "function") throw new Error("REAL_ADAPTER_REQUIRED");
    P.set(provider.id, { ...provider, family: provider.family ?? provider.id, costClass: provider.costClass ?? "UNKNOWN", capabilities: provider.capabilities ?? [], breaker: createCircuitBreaker({ clock, ...breaker }), probeEvidence: null, lastError: null, latencies: [], calls: 0, failures: 0 });
    return { id: provider.id, state: "CONNECTED_UNTESTED" };
  }
  const stateOf = p => !p.probeEvidence ? "CONNECTED_UNTESTED" : p.breaker.state() === "OPEN" ? "DEGRADED_BREAKER_OPEN" : "LIVE";
  /** API health monitor: runs each provider's real probe; evidence is recorded only on a passing probe. Probes must not spend money. */
  /** Record the outcome of ONE real probe (made by the caller, e.g. the model gateway, which also measures latency). Evidence exists only for ok===true. */
  function recordProbe(id, ok, error = null) {
    const p = P.get(id); if (!p) throw new Error("UNKNOWN_PROVIDER");
    if (ok === true) { p.probeEvidence = { probeId: p.id + "@" + now(), outcome: "PASS", at: now(), target: p.id }; p.breaker.success(); p.lastError = null; return "PASS"; }
    p.probeEvidence = null; p.breaker.failure(); p.lastError = String(error ?? "PROBE_NOT_OK").slice(0, 120); return "FAIL";
  }
  async function probeAll() {
    const out = {};
    for (const p of P.values()) {
      try { const r = await withTimeout(p.probe(), timeoutMs, "PROBE"); out[p.id] = recordProbe(p.id, r?.ok === true, r?.ok === true ? null : "PROBE_NOT_OK"); }
      catch (e) { out[p.id] = recordProbe(p.id, false, e.message); }
    }
    return out;
  }
  const health = () => [...P.values()].map(p => ({ id: p.id, family: p.family, state: stateOf(p), breaker: p.breaker.snapshot(), costClass: p.costClass, calls: p.calls, failures: p.failures, lastError: p.lastError, medianLatencyMs: p.latencies.length ? [...p.latencies].sort((a, b) => a - b)[Math.floor(p.latencies.length / 2)] : null, probeEvidence: p.probeEvidence }));
  /** Cost + fallback router. No-spend by default: non-FREE providers are skipped unless budgetUsd > 0 AND estimateCostUsd fits. */
  async function invoke({ capability, request, budgetUsd = 0, estimateCostUsd = 0, exclude = [], jobId = null } = {}) {
    const stop = gate({ external: true }); if (!stop.allowed) throw new Error("DISPATCH_BLOCKED_BY_OWNER_STOP:" + stop.reason);
    const skipped = [];
    const candidates = [...P.values()].filter(p => {
      if (exclude.includes(p.id)) return false;
      if (stateOf(p) !== "LIVE" && stateOf(p) !== "DEGRADED_BREAKER_OPEN") { skipped.push({ id: p.id, why: "NOT_PROVEN_LIVE" }); return false; }
      if (capability && !p.capabilities.includes(capability)) return false;
      if (!p.breaker.allow()) { skipped.push({ id: p.id, why: "BREAKER_OPEN" }); return false; }
      if (p.costClass !== "FREE" && !(budgetUsd > 0 && estimateCostUsd <= budgetUsd)) { skipped.push({ id: p.id, why: "NEEDS_SPEND_APPROVAL" }); return false; }
      return true;
    }).sort((a, b) => (COST_RANK[a.costClass] ?? 9) - (COST_RANK[b.costClass] ?? 9));
    const attempts = [];
    for (const p of candidates) {
      const t0 = clock(); p.calls++;
      try {
        const r = await withTimeout(p.invoke(request), timeoutMs, "INVOKE"); p.breaker.success(); p.latencies.push(clock() - t0); if (p.latencies.length > 50) p.latencies.shift();
        const cost = Number(r?.costUsd ?? 0);
        let ledgerError = null; if (ledger) try { ledger.recordCost({ jobId, provider: p.id, category: "API", amountUsd: cost, tokensIn: r?.tokensIn ?? 0, tokensOut: r?.tokensOut ?? 0, evidence: cost > 0 ? { source: "PROVIDER_RESPONSE", reference: r.providerRef ?? "", verifiedAt: now() } : null }); } catch (le) { ledgerError = String(le.message).slice(0, 120); }   // a bookkeeping failure must NEVER look like a provider failure (it would trigger a second, possibly paid, call)
        return { ok: true, providerId: p.id, family: p.family, output: r?.output, costUsd: cost, attempts, skipped, ...(ledgerError ? { ledgerError } : {}) };
      } catch (e) { p.failures++; p.breaker.failure(); p.lastError = String(e.message).slice(0, 120); attempts.push({ id: p.id, error: p.lastError }); }
    }
    return { ok: false, reason: candidates.length ? "ALL_PROVIDERS_FAILED" : "NO_ELIGIBLE_PROVIDER", attempts, skipped };
  }
  /** Independent judge: a LIVE provider from a DIFFERENT family than the worker. If only one family exists we say so (no self-grading dressed up as independent). */
  async function judge({ workerProviderId, prompt, budgetUsd = 0 } = {}) {
    const worker = P.get(workerProviderId); if (!worker) throw new Error("UNKNOWN_WORKER_PROVIDER");
    const r = await invoke({ capability: "judge", request: prompt, exclude: [...P.values()].filter(p => p.family === worker.family).map(p => p.id), budgetUsd, estimateCostUsd: 0 });
    return r.ok ? { independent: true, judgeProvider: r.providerId, output: r.output } : { independent: false, reason: "INDEPENDENT_JUDGE_UNAVAILABLE:" + r.reason };
  }
  return { register, probeAll, recordProbe, invoke, judge, health, summary: () => { const h = health(); return { registered: h.length, live: h.filter(x => x.state === "LIVE").length, degraded: h.filter(x => x.state.startsWith("DEGRADED")).length, untested: h.filter(x => x.state === "CONNECTED_UNTESTED").length }; } };
}
