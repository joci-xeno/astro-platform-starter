// TICK LOOP WITH WATCHDOG - the process-level supervisor of a periodic service (used for the Master supervision tick and the other autonomous services).
// What a bare setInterval cannot do: notice a tick that never returns, bound the restarts, stop and ESCALATE when it keeps failing, and never run two ticks at once.
//   * one tick at a time; a tick running longer than stuckAfterMs is declared STUCK, its late result is ignored (generation counter) and the loop continues with a fresh tick;
//   * restarts are bounded (maxRestarts per windowMs); beyond that the loop stops itself in state ESCALATED and only an owner-driven reset() starts it again;
//   * consecutive tick errors back off and escalate the same way; nothing here weakens a security control: it only decides WHEN the supplied run() is called;
//   * every state change is reported to onEvent (the caller audits it); status() is what the Control Center shows.
export function createTickLoop({ run, intervalMs = 60_000, stuckAfterMs = null, maxRestarts = 5, windowMs = 3_600_000, maxConsecutiveErrors = 5, onEvent = () => {}, clock = () => Date.now(), timers = { setInterval, clearInterval } } = {}) {
  if (typeof run !== "function") throw new Error("RUN_REQUIRED");
  const stuck = stuckAfterMs ?? Math.max(30_000, intervalMs * 5);
  let timer = null, state = "STOPPED", gen = 0, running = null, restarts = [], errors = 0, ticks = 0, lastOkAt = null, lastErrorAt = null, lastError = null, startedAt = null, stuckEvents = 0;
  const ev = (type, data = {}) => { try { onEvent(type, { ...data, at: clock() }); } catch { /* the loop never dies because an observer threw */ } };
  async function tick() {
    if (state !== "RUNNING") return { skipped: state };
    if (running) {
      if (clock() - running.startedAt <= stuck) return { skipped: "TICK_IN_PROGRESS" };
      stuckEvents++; ev("TICK_STUCK", { runningForMs: clock() - running.startedAt, stuckAfterMs: stuck }); gen++; running = null;
      const cut = clock() - windowMs; restarts = restarts.filter(t => t > cut); restarts.push(clock());
      if (restarts.length > maxRestarts) { state = "ESCALATED"; ev("ESCALATED", { reason: "TOO_MANY_STUCK_TICKS", restartsInWindow: restarts.length }); return { escalated: true }; }
      ev("TICK_RESTARTED", { restartsInWindow: restarts.length });
    }
    const my = ++gen, rec = { startedAt: clock() }; running = rec; ticks++;
    try { await run(); if (my === gen) { errors = 0; lastOkAt = clock(); } }
    catch (e) {
      if (my === gen) { errors++; lastErrorAt = clock(); lastError = String(e?.message ?? e).slice(0, 120); ev("TICK_ERROR", { error: lastError, consecutive: errors }); if (errors >= maxConsecutiveErrors) { state = "ESCALATED"; ev("ESCALATED", { reason: "CONSECUTIVE_ERRORS", consecutive: errors }); } }
    } finally { if (running === rec) running = null; }
    return { ok: true };
  }
  function start() { if (state === "RUNNING") return status(); state = "RUNNING"; startedAt = clock(); timer = timers.setInterval(() => { tick(); }, intervalMs); timer.unref?.(); ev("STARTED", { intervalMs, stuckAfterMs: stuck }); return status(); }
  function stop() { if (timer) timers.clearInterval(timer); timer = null; if (state !== "ESCALATED") state = "STOPPED"; running = null; gen++; ev("STOPPED"); return status(); }
  /** Owner-driven: clears an ESCALATED loop (the caller must have checked the owner's authority). */
  function reset() { if (timer) timers.clearInterval(timer); timer = null; state = "STOPPED"; restarts = []; errors = 0; ev("RESET"); return start(); }
  function status() { return { state, intervalMs, stuckAfterMs: stuck, ticks, startedAt, lastOkAt, lastErrorAt, lastError, consecutiveErrors: errors, restartsInWindow: restarts.filter(t => t > clock() - windowMs).length, stuckEvents, tickRunning: Boolean(running), runningForMs: running ? clock() - running.startedAt : 0 }; }
  return { start, stop, tick, reset, status };
}
