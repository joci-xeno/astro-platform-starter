// MODULE BROKER - the controlled registration and invocation layer between the Master Coordinator, the managers and the individual modules (owner directive: "Phase 2").
// A module is NOT imported by the Master and never gets direct access to the Master's internals. It registers a SPEC and exposes capabilities as typed tools:
//   purpose, responsible manager, lifecycle, security policy, invocation interface (named capabilities with input/output schemas), a health self-test, owner-approval classification, audit.
// Every invocation goes: caller -> broker.invoke -> typed-tool registry -> unified control chain (owner authority, kill switch, safe mode, security brain, financial firewall, owner approval)
// -> handler -> output schema validation -> audit. The chain can only make a decision stricter; a module can never loosen it.
// Health is a REAL self-test: the module's own code is executed on a fixed input and the result compared; a module with no self-test is reported NO_PROBE, never HEALTHY.
// SUPERSEDED = a small legacy module whose function is fully covered by a registered, tested replacement (named in `supersededBy`, with the reason): it is deliberately NOT activated (no duplicate runtime, no second state), and the Master reports it as such.
// Lifecycles: ON_DEMAND (invoked through a capability), CONTINUOUS (a supervised service, health required), OFFLINE_ACTIVATED (only under documented conditions: the activation path is part of the spec),
// BUILD_ONLY (used at build/test time, never at runtime: documented), INTERNAL_LIBRARY (only consumed by another registered module: names its consumer).
const R = (reason, extra = {}) => ({ ok: false, reason, ...extra });
export const LIFECYCLES = Object.freeze(["ON_DEMAND", "CONTINUOUS", "OFFLINE_ACTIVATED", "BUILD_ONLY", "INTERNAL_LIBRARY", "SUPERSEDED"]);
export const BROKER_LIMITS = Object.freeze({ maxModules: 600, maxCapabilities: 24, healthTimeoutMs: 5000, maxHistory: 50 });
const slug = id => String(id).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export function createModuleBroker({ tools, managers = [], audit = () => {}, now = () => new Date().toISOString(), clock = () => Date.now(), limits = {} } = {}) {
  if (!tools || typeof tools.register !== "function" || typeof tools.invoke !== "function") throw new Error("TOOL_REGISTRY_REQUIRED");
  const L = { ...BROKER_LIMITS, ...limits }, mods = new Map(), managerSet = new Set(managers);
  const log = (e, d = {}) => { try { audit(e, d); } catch { /* an unwritable audit never changes a verdict: the chain has already decided */ } };

  function register(spec = {}) {
    const { id, purpose, manager, lifecycle, source, capabilities = [], health = null, selfTest = null, policy = {}, activation = null, consumer = null, supersededBy = null, rationale = null } = spec;
    if (!/^[a-z][a-z0-9_\-/.]{1,80}$/.test(String(id))) throw new Error("MODULE_ID_INVALID:" + id);
    if (mods.size >= L.maxModules) throw new Error("TOO_MANY_MODULES");
    if (mods.has(id)) throw new Error("MODULE_ALREADY_REGISTERED:" + id);
    if (typeof purpose !== "string" || purpose.length < 8) throw new Error("PURPOSE_REQUIRED:" + id);
    if (managerSet.size && !managerSet.has(manager)) throw new Error("UNKNOWN_MANAGER:" + manager);
    if (!LIFECYCLES.includes(lifecycle)) throw new Error("LIFECYCLE_INVALID:" + id);
    if (typeof source !== "string" || !source) throw new Error("SOURCE_REQUIRED:" + id);
    if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(policy.risk)) throw new Error("POLICY_RISK_REQUIRED:" + id);
    if (typeof policy.ownerApproval !== "string") throw new Error("POLICY_OWNER_APPROVAL_REQUIRED:" + id);
    if (capabilities.length > L.maxCapabilities) throw new Error("TOO_MANY_CAPABILITIES:" + id);
    if (["ON_DEMAND", "CONTINUOUS"].includes(lifecycle) && !capabilities.length) throw new Error("CAPABILITY_REQUIRED:" + id);
    if (["ON_DEMAND", "CONTINUOUS"].includes(lifecycle) && typeof health !== "function" && !selfTest) throw new Error("HEALTH_SELF_TEST_REQUIRED:" + id);
    if (selfTest && !capabilities.some(c => c.name === selfTest.capability)) throw new Error("SELF_TEST_CAPABILITY_UNKNOWN:" + id);
    if (lifecycle === "SUPERSEDED" && !(typeof supersededBy === "string" && mods.has(supersededBy) && typeof rationale === "string" && rationale.length >= 20)) throw new Error("SUPERSEDED_NEEDS_REGISTERED_REPLACEMENT_AND_RATIONALE:" + id);
    if (["OFFLINE_ACTIVATED", "BUILD_ONLY"].includes(lifecycle) && (typeof activation !== "string" || activation.length < 20)) throw new Error("ACTIVATION_PATH_REQUIRED:" + id);
    if (lifecycle === "INTERNAL_LIBRARY" && !(typeof consumer === "string" && mods.has(consumer))) throw new Error("CONSUMER_MUST_BE_A_REGISTERED_MODULE:" + id);
    const caps = new Map(), reg = [];
    for (const c of capabilities) {
      if (!/^[a-z][a-z0-9_]{1,40}$/.test(String(c.name))) throw new Error("CAPABILITY_NAME_INVALID:" + id + "." + c.name);
      if (caps.has(c.name)) throw new Error("CAPABILITY_DUPLICATE:" + id + "." + c.name);
      const tool = slug(id) + "." + c.name;
      tools.register({ name: tool, description: c.description ?? purpose, operation: c.operation, input: c.input ?? { type: "object", properties: {}, additionalProperties: false }, output: c.output ?? null, handler: c.handler, timeoutMs: c.timeoutMs ?? 10000, spendUsd: c.spendUsd ?? 0, version: c.version ?? "1.0.0" });
      caps.set(c.name, { name: c.name, tool, operation: c.operation, description: c.description ?? "" }); reg.push(tool);
    }
    mods.set(id, { id, purpose, manager, lifecycle, source, policy: { ...policy }, activation, consumer, supersededBy, rationale, selfTest, health, caps, registeredAt: now(), invocations: 0, failures: 0, lastInvocation: null, lastHealth: null, healthHistory: [] });
    log("MODULE_REGISTERED", { id, manager, lifecycle, source, tools: reg.length }); return { ok: true, id, tools: reg };
  }

  async function health(id) {
    const m = mods.get(id); if (!m) return R("UNKNOWN_MODULE");
    let h;
    if (m.selfTest) {
      // the self-test goes through the SAME path as every real call (typed tool -> control chain -> handler -> output schema), so it proves reachability, not just that the code runs
      const t0 = clock(); const r = await tools.invoke(slug(id) + "." + m.selfTest.capability, m.selfTest.args ?? {}, { actor: { type: "SYSTEM", id: "HEALTH_SELF_TEST" } });
      if (r.status === "OK") { let ok = true, why = "SELF_TEST_OK:" + m.selfTest.capability; try { if (typeof m.selfTest.expect === "function") { const e = m.selfTest.expect(r.result); if (e !== true) { ok = false; why = "SELF_TEST_RESULT_MISMATCH:" + String(e).slice(0, 80); } } } catch (e) { ok = false; why = "SELF_TEST_EXPECT_THREW:" + String(e?.message ?? e).slice(0, 80); } h = { state: ok ? "HEALTHY" : "FAILED", detail: why }; }
      else h = { state: ["DENIED", "REQUIRES_APPROVAL"].includes(r.status) ? "BLOCKED_BY_CONTROL_CHAIN" : "FAILED", detail: r.status + (r.reason ? ":" + r.reason : r.error ? ":" + r.error : "") };
      h.ms = clock() - t0;
    } else if (typeof m.health !== "function") h = { state: m.lifecycle === "OFFLINE_ACTIVATED" || m.lifecycle === "BUILD_ONLY" ? "OFFLINE_BY_DESIGN" : m.lifecycle === "INTERNAL_LIBRARY" ? "VIA_CONSUMER" : m.lifecycle === "SUPERSEDED" ? "SUPERSEDED" : "NO_PROBE", detail: m.activation ?? (m.consumer ? "consumed by " + m.consumer : m.supersededBy ? "superseded by " + m.supersededBy + ": " + m.rationale : "no self-test registered") };
    else {
      const t0 = clock(); let th;
      try {
        const r = await Promise.race([Promise.resolve().then(() => m.health()), new Promise((_, rej) => { th = setTimeout(() => rej(new Error("HEALTH_TIMEOUT")), L.healthTimeoutMs); th.unref?.(); })]);
        h = r?.ok === true ? { state: "HEALTHY", detail: String(r.detail ?? "SELF_TEST_OK").slice(0, 160) } : { state: "FAILED", detail: String(r?.detail ?? r?.reason ?? "SELF_TEST_FAILED").slice(0, 160) };
      } catch (e) { h = { state: "FAILED", detail: String(e?.message ?? e).slice(0, 160) }; } finally { clearTimeout(th); }
      h.ms = clock() - t0;
    }
    h.at = now(); m.lastHealth = h; m.healthHistory.push({ state: h.state, at: h.at }); if (m.healthHistory.length > L.maxHistory) m.healthHistory.shift();
    return { ok: true, id, ...h };
  }
  async function healthAll({ manager = null } = {}) { const out = []; for (const m of mods.values()) if (!manager || m.manager === manager) out.push(await health(m.id)); return out; }

  /** The only way to use a module. Never throws; every call is audited. */
  async function invoke(id, capability, args = {}, { actor = { type: "SYSTEM", id: "MASTER" }, ownerApproval = null } = {}) {
    const m = mods.get(id); if (!m) return { status: "UNKNOWN_MODULE", ok: false };
    const c = m.caps.get(capability); if (!c) return { status: "UNKNOWN_CAPABILITY", ok: false };
    const r = await tools.invoke(c.tool, args, { actor, ownerApproval });
    m.invocations++; if (r.status !== "OK") m.failures++; m.lastInvocation = { capability, status: r.status, at: now(), actor: actor?.id ?? null };
    log("MODULE_INVOKED", { id, capability, status: r.status, actor: actor?.id ?? null, manager: m.manager });
    return { ...r, ok: r.status === "OK", module: id, capability, manager: m.manager };
  }

  const view = m => ({ id: m.id, purpose: m.purpose, manager: m.manager, lifecycle: m.lifecycle, source: m.source, policy: m.policy, capabilities: [...m.caps.values()].map(c => ({ name: c.name, tool: c.tool, operation: c.operation })), activation: m.activation, consumer: m.consumer, supersededBy: m.supersededBy, rationale: m.rationale,
    health: m.lastHealth, invocations: m.invocations, failures: m.failures, lastInvocation: m.lastInvocation, registeredAt: m.registeredAt });
  const catalog = ({ manager = null } = {}) => [...mods.values()].filter(m => !manager || m.manager === manager).map(view);
  const summary = () => {
    const all = [...mods.values()], by = (k, f = x => x[k]) => all.reduce((o, m) => (o[f(m)] = (o[f(m)] ?? 0) + 1, o), {});
    return { modules: all.length, byManager: by("manager"), byLifecycle: by("lifecycle"), byHealth: by("h", m => m.lastHealth?.state ?? "NOT_CHECKED"), invoked: all.filter(m => m.invocations > 0).length, tools: tools.stats().tools };
  };
  return { register, health, healthAll, invoke, catalog, summary, get: id => (mods.has(id) ? view(mods.get(id)) : null), has: id => mods.has(id), ids: () => [...mods.keys()] };
}
