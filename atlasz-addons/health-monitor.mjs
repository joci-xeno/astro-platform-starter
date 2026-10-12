// ATLASZ Health Monitor: continuous module/component health with bounded retries, circuit breakers, alerts and an audit trail.
// It composes three existing libraries instead of re-implementing them: watchdog (hang/stale detection + escalation), self-healing-loop (bounded retry via recovery-plan), the module broker (the probes).
// Rules that are NOT negotiable:
//  - a probe blocked by the control chain (approval/kill switch/safe mode) is reported BLOCKED and is never retried or "healed" around (a failed approval check is not overridden);
//  - retries are bounded (maxRetries per probe), breakers open after `failureThreshold` consecutive failed sweeps, and an OPEN breaker is only re-probed after `openMs` (HALF_OPEN),
//    so there is no uncontrolled restart/retry loop; an optional restart hook runs at most `maxRestarts` times per `restartWindowMs` with exponential backoff;
//  - state is persisted (atomic write) so a restart does not reset breakers or hide an alert; alerts are bounded and never contain secrets (only ids, states and short details).
import fs from "node:fs"; import path from "node:path";
import { createWatchdog } from "./watchdog.mjs";
import { selfHeal } from "./self-healing-loop.mjs";

export const GOOD_STATES = Object.freeze(["HEALTHY", "LOADED_NEEDS_DEPENDENCY", "VIA_CONSUMER", "OFFLINE_BY_DESIGN", "SUPERSEDED"]);
export const HM_LIMITS = Object.freeze({ maxAlerts: 200, maxDetail: 200, maxModules: 1000 });
const write = (file, obj) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const t = file + "." + process.pid + ".tmp"; fs.writeFileSync(t, JSON.stringify(obj)); fs.renameSync(t, file); };

export function createHealthMonitor({ broker, file = null, clock = () => Date.now(), now = () => new Date().toISOString(), failureThreshold = 3, openMs = 5 * 60 * 1000, maxRetries = 1,
  critical = [], restart = null, maxRestarts = 3, restartWindowMs = 60 * 60 * 1000, baseBackoffMs = 30000, audit = () => {}, onAlert = () => {} } = {}) {
  if (!broker || typeof broker.health !== "function") throw new Error("BROKER_REQUIRED");
  const log = (e, d) => { try { audit(e, d); } catch { /* audit failure never changes a verdict */ } };
  let st = { breakers: {}, alerts: [], sweeps: 0, lastSweepAt: null };
  if (file && fs.existsSync(file)) { try { const j = JSON.parse(fs.readFileSync(file, "utf8")); if (j && typeof j === "object" && j.breakers) st = { breakers: j.breakers, alerts: Array.isArray(j.alerts) ? j.alerts.slice(-HM_LIMITS.maxAlerts) : [], sweeps: j.sweeps | 0, lastSweepAt: j.lastSweepAt ?? null }; } catch { /* a corrupt state file starts clean; the alert history is advisory */ } }
  const save = () => { if (file) { try { write(file, st); } catch { /* unwritable state: monitoring continues in memory */ } } };
  const alert = (level, id, message) => { const a = { at: now(), level, id, message: String(message).slice(0, HM_LIMITS.maxDetail) }; st.alerts.push(a); if (st.alerts.length > HM_LIMITS.maxAlerts) st.alerts.shift(); log("HEALTH_ALERT", a); try { onAlert(a); } catch { /* alert sinks must not break the monitor */ } return a; };
  const B = id => (st.breakers[id] ??= { state: "CLOSED", failures: 0, openedAt: null, lastState: null, lastDetail: null, restarts: [], nextRestartAt: 0, blocked: false });
  const wd = createWatchdog({ now: clock, probeTimeoutMs: 8000, failuresToEscalate: failureThreshold, onEscalate: e => alert("CRITICAL", e.id, "ESCALATED after " + e.failures + " failed probes: " + e.detail) });
  const known = new Set();

  async function probe(id) {
    // bounded retry with the shared recovery policy; BLOCKED_BY_CONTROL_CHAIN is returned as-is (never retried)
    let last = null;
    const res = await selfHeal({ operation: async () => (last = await broker.health(id)), verify: h => ({ passed: GOOD_STATES.includes(h.state) || h.state === "BLOCKED_BY_CONTROL_CHAIN", h }), maxRetries });
    return res.result ?? last ?? { state: "FAILED", detail: res.reason ?? "PROBE_FAILED" };
  }
  function track(id) { if (known.has(id)) return; known.add(id); wd.register({ id, critical: critical.includes(id), probe: async () => { const h = B(id).lastProbe; return { ok: !h || GOOD_STATES.includes(h.state) || h.state === "BLOCKED_BY_CONTROL_CHAIN", detail: h ? h.state + ":" + (h.detail ?? "") : null }; } }); }

  async function sweep({ ids = null } = {}) {
    const t = clock(), list = (ids ?? broker.ids()).slice(0, HM_LIMITS.maxModules), out = [];
    for (const id of list) {
      if (!broker.has(id)) continue; track(id);
      const b = B(id);
      if (b.state === "OPEN" && t - b.openedAt < openMs) { out.push({ id, state: "CIRCUIT_OPEN", skipped: true, reopensInMs: openMs - (t - b.openedAt) }); continue; }
      if (b.state === "OPEN") b.state = "HALF_OPEN";
      const h = await probe(id); b.lastProbe = { state: h.state, detail: String(h.detail ?? "").slice(0, HM_LIMITS.maxDetail) }; b.lastState = h.state; b.lastDetail = b.lastProbe.detail;
      if (h.state === "BLOCKED_BY_CONTROL_CHAIN") { if (!b.blocked) alert("WARN", id, "probe blocked by the control chain (approval/kill switch/safe mode); not retried: " + b.lastDetail); b.blocked = true; out.push({ id, state: h.state, blocked: true }); continue; }
      b.blocked = false;
      if (GOOD_STATES.includes(h.state)) {
        if (b.state !== "CLOSED" || b.failures > 0) { if (b.state !== "CLOSED") alert("INFO", id, "recovered (" + h.state + ") after " + b.failures + " failed sweeps"); }
        b.state = "CLOSED"; b.failures = 0; b.openedAt = null; out.push({ id, state: h.state }); continue;
      }
      b.failures++;
      if (b.state === "HALF_OPEN" || b.failures >= failureThreshold) {
        if (b.state !== "OPEN") alert("ERROR", id, "circuit OPEN after " + b.failures + " failed sweeps: " + h.state + " " + b.lastDetail);
        b.state = "OPEN"; b.openedAt = t;
        // bounded restart: only when a hook exists, inside the per-window budget and after the exponential backoff; the hook is never given secrets and its result is audited
        if (typeof restart === "function") {
          b.restarts = b.restarts.filter(x => t - x < restartWindowMs);
          if (b.restarts.length >= maxRestarts) alert("CRITICAL", id, "restart budget exhausted (" + maxRestarts + " per window): needs the owner");
          else if (t >= b.nextRestartAt) { b.restarts.push(t); b.nextRestartAt = t + baseBackoffMs * 2 ** (b.restarts.length - 1); let r; try { r = await restart(id); } catch (e) { r = { ok: false, error: String(e?.message ?? e) }; } log("HEALTH_RESTART", { id, ok: r?.ok === true, attempt: b.restarts.length }); alert("WARN", id, "restart attempt " + b.restarts.length + "/" + maxRestarts + (r?.ok === true ? " issued" : " failed")); }
        }
      }
      out.push({ id, state: h.state, failures: b.failures, breaker: b.state });
    }
    await wd.tick();
    st.sweeps++; st.lastSweepAt = now(); save();
    return { at: st.lastSweepAt, checked: out.length, unhealthy: out.filter(o => !GOOD_STATES.includes(o.state) && !o.blocked && !o.skipped).length, blocked: out.filter(o => o.blocked).length, open: Object.values(st.breakers).filter(x => x.state === "OPEN").length, results: out };
  }
  const status = () => ({ sweeps: st.sweeps, lastSweepAt: st.lastSweepAt, breakers: Object.fromEntries(Object.entries(st.breakers).filter(([, b]) => b.state !== "CLOSED" || b.blocked).map(([id, b]) => [id, { state: b.state, failures: b.failures, blocked: b.blocked, lastState: b.lastState, lastDetail: b.lastDetail, restarts: b.restarts.length }])),
    open: Object.values(st.breakers).filter(b => b.state === "OPEN").length, watchdog: wd.status().overall, alerts: st.alerts.length });
  return { sweep, status, alerts: (n = 50) => st.alerts.slice(-Math.min(n, HM_LIMITS.maxAlerts)), reset: id => { delete st.breakers[id]; save(); } };
}
