// Model Intelligence / Brain Router (V7.3 Brain §15): routes by measured task suitability. A model is usable only with a real passing probe.
// Multi-model workflows require genuinely different model families (a model never judges its own output).
export function createModelIntelligence({ graph, now = () => new Date().toISOString() } = {}) {
  if (!graph) throw new Error("GRAPH_REQUIRED");
  const errors = new Map();
  /** m: {id, family, costClass, contextLimit, tools[], capabilities[], requiredCredentials[], provider} */
  function register(m = {}) {
    if (!m.id) throw new Error("MODEL_ID_REQUIRED");
    return graph.upsert({ id: m.id, type: "MODEL", provider: m.provider ?? null, family: m.family ?? m.id, capabilities: m.capabilities ?? [], costClass: m.costClass ?? "UNKNOWN", requiredCredentials: m.requiredCredentials ?? [], attrs: { contextLimit: m.contextLimit ?? null, tools: m.tools ?? [] } });
  }
  /** probeFn() must make a real, non-spending provider call and return {ok:true}. Latency is measured here, not claimed by the provider. */
  async function probe(id, probeFn, { timeoutMs = 15000 } = {}) {
    if (!graph.get(id)) throw new Error("UNKNOWN_MODEL");
    const t0 = Date.now();
    try {
      const r = await Promise.race([Promise.resolve().then(probeFn), new Promise((_, rej) => setTimeout(() => rej(new Error("PROBE_TIMEOUT")), timeoutMs))]);
      const ms = Date.now() - t0;
      if (r?.ok !== true) throw new Error("PROBE_NOT_OK");
      graph.setEvidence(id, { probeId: id + "@" + now(), outcome: "PASS", at: now(), target: graph.get(id).provider ?? id, latencyMs: ms }); graph.recordOutcome(id, { ok: true, ms }); return { id, ok: true, ms };
    } catch (e) { graph.setEvidence(id, null); graph.setHealth(id, "DOWN"); graph.recordOutcome(id, { ok: false, ms: Date.now() - t0 }); errors.set(id, (errors.get(id) ?? 0) + 1); return { id, ok: false, error: String(e.message).slice(0, 100) }; }
  }
  const usableModels = ({ allowCost = false, sandbox = false, exclude = [], preferFamilyNot = null } = {}) => graph.list().filter(n => n.type === "MODEL" && n.usable !== false)
    .filter(n => sandbox || n.evidence).filter(n => allowCost || n.costClass === "FREE").filter(n => !exclude.includes(n.id)).filter(n => !preferFamilyNot || n.family !== preferFamilyNot);
  /** task: {capabilities[], minContext?, needsTools[]?, complexity?, allowCost?, preferFamilyNot?, maxLatencyMs?} */
  function route(task = {}) {
    const need = task.capabilities ?? [], reasons = [];
    let c = usableModels(task).filter(n => need.every(k => n.capabilities.includes(k)));
    if (task.minContext) c = c.filter(n => (n.attrs?.contextLimit ?? 0) >= task.minContext);
    if (task.needsTools?.length) c = c.filter(n => task.needsTools.every(t => (n.attrs?.tools ?? []).includes(t)));
    if (task.maxLatencyMs) c = c.filter(n => n.avgMs !== null && n.avgMs <= task.maxLatencyMs);
    if (!c.length) return { modelId: null, reason: "NO_QUALIFIED_LIVE_MODEL", considered: graph.list().filter(n => n.type === "MODEL").map(n => ({ id: n.id, usable: n.usable, reasons: n.unusableReasons })) };
    const hi = task.complexity === "HIGH";
    const rank = n => (hi ? 2 * (n.quality ?? 0.5) + (n.reliability ?? 0.5) : (n.reliability ?? 0.5) + 1 / (1 + (n.avgMs ?? 1000) / 1000)) - (n.costClass === "FREE" ? 0 : 0.1);
    c.sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));
    return { modelId: c[0].id, family: c[0].family, alternatives: c.slice(1).map(n => n.id), reason: hi ? "quality-weighted" : "speed/reliability-weighted" };
  }
  /** kinds: GENERATE_CRITIQUE_VERIFY (A->B->C), FAST_TRIAGE_STRONG_QA (fast triage, strong reasoning, independent QA). Needs distinct live families. */
  function workflow(kind, task = {}) {
    const roles = { GENERATE_CRITIQUE_VERIFY: ["GENERATE", "CRITIQUE", "VERIFY"], FAST_TRIAGE_STRONG_QA: ["TRIAGE", "REASON", "QA"] }[kind];
    if (!roles) throw new Error("UNKNOWN_WORKFLOW");
    const used = new Set(), steps = [];
    for (const role of roles) {
      const pool = usableModels(task).filter(n => !used.has(n.family) && (task.capabilities ?? []).every(k => n.capabilities.includes(k)));
      const pick = pool.sort((a, b) => (role === "TRIAGE" ? (a.avgMs ?? 1e9) - (b.avgMs ?? 1e9) : (b.quality ?? 0.5) - (a.quality ?? 0.5)) || a.id.localeCompare(b.id))[0];
      if (!pick) return { blocked: true, reason: "NEED_" + roles.length + "_DISTINCT_LIVE_MODEL_FAMILIES", filled: steps, missingRole: role };
      used.add(pick.family); steps.push({ role, modelId: pick.id, family: pick.family });
    }
    return { blocked: false, kind, steps, independentFamilies: used.size };
  }
  return { register, probe, route, workflow, health: () => graph.list().filter(n => n.type === "MODEL").map(n => ({ id: n.id, family: n.family, state: n.evidence ? (n.health === "HEALTHY" ? "LIVE" : n.health) : n.health === "DOWN" ? "DOWN" : "NOT_PROBED", avgMs: n.avgMs, reliability: n.reliability, errors: errors.get(n.id) ?? 0, costClass: n.costClass, credentials: n.credentialsPresent })) };
}
