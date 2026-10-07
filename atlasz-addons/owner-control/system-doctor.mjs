// ATLASZ System Doctor v2 (V7.3 Owner Control §16). Reports a state per component: HEALTHY | DEGRADED | BLOCKED | FAILED | NOT_CONFIGURED | UNKNOWN.
// A missing probe is NOT_CONFIGURED, a throwing probe is FAILED, a probe that answers nothing usable is UNKNOWN — UNKNOWN is never promoted
// to HEALTHY, and the overall verdict is HEALTHY only if every component is HEALTHY.
export const DOCTOR_STATES = Object.freeze(["HEALTHY", "DEGRADED", "BLOCKED", "FAILED", "NOT_CONFIGURED", "UNKNOWN"]);
export const DOCTOR_COMPONENTS = Object.freeze(["runtime", "agent_topology_30", "queue", "database", "brain_components", "models", "tools", "connectors", "secret_vault", "owner_authentication", "kill_switch", "approval_gateway", "security_brain", "financial_firewall", "black_box", "backup", "last_known_good", "recovery_readiness", "update_center"]);
const RANK = ["FAILED", "BLOCKED", "DEGRADED", "UNKNOWN", "NOT_CONFIGURED", "HEALTHY"];

export function createSystemDoctor({ probes = {}, blackBox = null, now = () => new Date().toISOString() } = {}) {
  function run() {
    const components = {};
    for (const name of DOCTOR_COMPONENTS) {
      const p = probes[name];
      if (typeof p !== "function") { components[name] = { state: "NOT_CONFIGURED", detail: "NO_PROBE" }; continue; }
      try { const r = p(); components[name] = r && DOCTOR_STATES.includes(r.state) ? { state: r.state, detail: r.detail ?? null } : { state: "UNKNOWN", detail: "PROBE_RETURNED_NOTHING_USABLE" }; }
      catch (e) { components[name] = { state: "FAILED", detail: "PROBE_THREW:" + String(e.message).slice(0, 100) }; }
    }
    const states = Object.values(components).map(c => c.state);
    const overall = RANK.find(s => states.includes(s)) ?? "UNKNOWN";
    const counts = Object.fromEntries(DOCTOR_STATES.map(s => [s, states.filter(x => x === s).length]));
    const report = { at: now(), overall, counts, components, normalOperation: overall === "HEALTHY" };
    try { blackBox?.record({ kind: "SYSTEM_DOCTOR_RUN", decision: overall, reason: JSON.stringify(counts) }); } catch { /* ignore */ }
    return report;
  }
  return { run };
}
