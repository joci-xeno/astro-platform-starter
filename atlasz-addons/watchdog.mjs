// ATLASZ Watchdog (V7.3 §17, §52 #10 hang detection). Components either push heartbeats or expose a probe.
// A stale heartbeat / failing or HANGING probe marks the component UNHEALTHY; N consecutive failures of a critical
// component escalate (e.g. into Safe Mode). Recovery is reported only after a real healthy observation.
export function createWatchdog({ now = () => Date.now(), probeTimeoutMs = 5000, onEscalate = () => {}, failuresToEscalate = 3 } = {}) {
  const comps = new Map();
  let timer = null;
  function register({ id, critical = false, heartbeatMaxAgeMs = null, probe = null }) {
    if (!id) throw new Error("WATCHDOG_ID_REQUIRED");
    if (heartbeatMaxAgeMs == null && !probe) throw new Error("WATCHDOG_NEEDS_HEARTBEAT_OR_PROBE");
    comps.set(id, { id, critical, heartbeatMaxAgeMs, probe, lastBeat: now(), state: "UNKNOWN", failures: 0, detail: null, escalated: false, since: now() });
  }
  const beat = id => { const c = comps.get(id); if (c) c.lastBeat = now(); };
  async function runProbe(c) {
    let t;
    const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error("PROBE_TIMEOUT")), probeTimeoutMs); });
    try { return await Promise.race([Promise.resolve().then(() => c.probe()), timeout]); } finally { clearTimeout(t); }
  }
  async function tick() {
    for (const c of comps.values()) {
      let ok = true, detail = null;
      if (c.heartbeatMaxAgeMs != null && now() - c.lastBeat > c.heartbeatMaxAgeMs) { ok = false; detail = "HEARTBEAT_STALE"; }
      if (ok && c.probe) {
        try { const r = await runProbe(c); if (!r || r.ok !== true) { ok = false; detail = (r && r.detail) || "PROBE_FAILED"; } }
        catch (e) { ok = false; detail = String(e.message || e); }
      }
      const prev = c.state;
      c.state = ok ? "HEALTHY" : "UNHEALTHY"; c.detail = detail;
      if (prev !== c.state) c.since = now();
      if (ok) { c.failures = 0; c.escalated = false; }
      else {
        c.failures++;
        if (c.critical && c.failures >= failuresToEscalate && !c.escalated) {
          c.escalated = true;
          try { onEscalate({ id: c.id, detail, failures: c.failures }); } catch { /* escalation must never kill the watchdog */ }
        }
      }
    }
    return status();
  }
  function status() {
    const list = [...comps.values()].map(({ probe, ...c }) => c);
    return { overall: list.some(c => c.state === "UNHEALTHY") ? "UNHEALTHY" : list.every(c => c.state === "HEALTHY") ? "HEALTHY" : "UNKNOWN", components: list };
  }
  function start(intervalMs = 15000) { if (timer) return; timer = setInterval(() => { void tick(); }, intervalMs); timer.unref?.(); }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { register, beat, tick, status, start, stop };
}
