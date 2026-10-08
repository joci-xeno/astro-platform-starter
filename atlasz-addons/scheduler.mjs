// Durable scheduler (85-capability audit: C12 Scheduled and Recurring Tasks; shared by P06 workflows, P08 resume, P11 batch).
//
// A schedule is DATA (tool name + validated args + timing + retry policy), persisted atomically. It can only call REGISTERED typed tools, and each
// run goes through the typed-tool registry -> control chain with actor SCHEDULER, so a schedule can never grant authority: an external-effect tool
// stops at AWAITING_APPROVAL until Joci presents an approval bound to those exact arguments. Emergency stop / Safe Mode (gate) halts the whole tick.
//
// Delivery is AT-LEAST-ONCE: if the process dies mid-run, the run is recorded INTERRUPTED on restart and the job runs again, so scheduled tools
// should be idempotent. Missed slots are never replayed in a burst: one run, the rest counted in missedRuns.
import { createStore } from "./business/store.mjs";
import { validate } from "./typed-tools.mjs";
import crypto from "node:crypto";

export const KINDS = Object.freeze(["ONCE", "INTERVAL", "DAILY"]);
export const STATES = Object.freeze(["ACTIVE", "PAUSED", "PAUSED_BY_FAILURES", "AWAITING_APPROVAL", "DONE", "FAILED", "CANCELLED"]);
const MIN_INTERVAL_MS = 60000, NON_RETRYABLE = new Set(["INVALID_ARGUMENTS", "UNKNOWN_TOOL"]), TRANSIENT = new Set(["HANDLER_ERROR", "TIMEOUT", "OUTPUT_INVALID", "DENIED"]);
const iso = ms => new Date(ms).toISOString(), ms = s => Date.parse(s);

/** Next slot strictly after `fromMs` for a recurring spec; returns {nextMs, skipped} where skipped = slots that passed unrun between lastSlot and now. */
export function nextSlot(job, fromMs) {
  if (job.kind === "INTERVAL") { const e = job.spec.everyMs, base = ms(job.spec.anchor); const n = Math.floor((fromMs - base) / e) + 1; return base + Math.max(n, 1) * e; }
  if (job.kind === "DAILY") { const [h, m] = job.spec.time.split(":").map(Number); const d = new Date(fromMs); let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m); if (t <= fromMs) t += 86400000; return t; }
  return null;
}

export function createScheduler({ file = null, tools, gate = null, blackBox = null, now = () => new Date().toISOString(), maxFailures = 5, historyCap = 20 } = {}) {
  if (!tools || typeof tools.invoke !== "function" || typeof tools.describe !== "function") throw new Error("TOOL_REGISTRY_REQUIRED");
  const store = createStore({ file, init: () => ({ jobs: {}, seq: 0 }) });   // an unreadable file throws STORE_UNREADABLE: never silently replaced
  const S = store.data, log = (kind, d) => { try { blackBox?.record({ kind, ...d }); } catch { /* audit must not change behaviour */ } };
  let ticking = false;
  // restart recovery: a job caught mid-run is interrupted, not lost and not assumed finished
  for (const j of Object.values(S.jobs)) if (j.runningSince) { j.history.push({ at: now(), status: "INTERRUPTED", runId: j.runId }); j.history = j.history.slice(-historyCap); j.runningSince = null; j.runId = null; j.interruptedRuns = (j.interruptedRuns ?? 0) + 1; if (j.state === "ACTIVE") j.nextRunAt = now(); }
  store.save();

  function create({ name, kind, spec, tool, args = {}, retry = {}, tenantId = "ATLASZ", createdBy = "OWNER" } = {}) {
    if (!KINDS.includes(kind)) throw new Error("KIND_INVALID");
    if (!String(name ?? "").trim()) throw new Error("NAME_REQUIRED");
    const def = tools.describe().find(t => t.name === tool); if (!def) throw new Error("UNKNOWN_TOOL:" + tool);
    const v = validate(def.parameters, args); if (!v.ok) throw new Error("INVALID_ARGUMENTS:" + v.errors.map(e => e.path + " " + e.code).join(","));
    const t0 = ms(now()); let sp, next;
    if (kind === "ONCE") { if (!Number.isFinite(ms(spec?.at))) throw new Error("SPEC_AT_INVALID"); sp = { at: iso(ms(spec.at)) }; next = ms(spec.at); }
    else if (kind === "INTERVAL") { if (!(spec?.everyMs >= MIN_INTERVAL_MS)) throw new Error("SPEC_EVERY_MS_MIN_" + MIN_INTERVAL_MS); sp = { everyMs: Math.floor(spec.everyMs), anchor: iso(t0) }; next = t0 + sp.everyMs; }
    else { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(spec?.time))) throw new Error("SPEC_TIME_INVALID"); sp = { time: spec.time }; next = nextSlot({ kind, spec: sp }, t0); }
    const r = { maxAttempts: Math.min(Math.max(Math.floor(retry.maxAttempts ?? 3), 1), 10), backoffMs: Math.min(Math.max(Math.floor(retry.backoffMs ?? 60000), 1000), 86400000) };
    const id = "sch-" + (++S.seq) + "-" + crypto.randomBytes(3).toString("hex");
    S.jobs[id] = { id, name: String(name).slice(0, 120), kind, spec: sp, tool, args: structuredClone(args), retry: r, tenantId, createdBy, createdAt: now(), state: "ACTIVE", nextRunAt: iso(next), attempt: 0, consecutiveFailures: 0, missedRuns: 0, interruptedRuns: 0, runningSince: null, runId: null, history: [], lastResult: null };
    store.save(); log("SCHEDULE_CREATED", { id, tool, kind }); return structuredClone(S.jobs[id]);
  }

  const setState = (id, to, from) => { const j = S.jobs[id]; if (!j) return null; if (!from.includes(j.state)) return { error: "INVALID_STATE:" + j.state }; j.state = to; store.save(); log("SCHEDULE_" + to, { id }); return structuredClone(j); };
  function pause(id) { return setState(id, "PAUSED", ["ACTIVE", "AWAITING_APPROVAL"]); }
  function cancel(id) { return setState(id, "CANCELLED", ["ACTIVE", "PAUSED", "PAUSED_BY_FAILURES", "AWAITING_APPROVAL"]); }
  function resume(id) { const j = S.jobs[id]; if (!j) return null; if (!["PAUSED", "PAUSED_BY_FAILURES"].includes(j.state)) return { error: "INVALID_STATE:" + j.state }; j.state = "ACTIVE"; j.consecutiveFailures = 0; j.attempt = 0; if (!j.nextRunAt || ms(j.nextRunAt) < ms(now())) j.nextRunAt = j.kind === "ONCE" ? now() : iso(nextSlot(j, ms(now()))); store.save(); log("SCHEDULE_RESUMED", { id }); return structuredClone(j); }

  function advance(j, tNow) {
    if (j.kind === "ONCE") { j.nextRunAt = null; return; }
    const due = ms(j.nextRunAt); let n = nextSlot(j, tNow), skipped = 0;
    // slots between the one that was due and the next future one were missed (e.g. process was down): counted, not replayed
    const step = j.kind === "INTERVAL" ? j.spec.everyMs : 86400000; skipped = Math.max(0, Math.round((n - due) / step) - 1);
    j.missedRuns += skipped; j.nextRunAt = iso(n);
  }

  async function execute(j, { ownerApproval = null } = {}) {
    const tNow = ms(now()), runId = crypto.randomBytes(4).toString("hex");
    j.runningSince = now(); j.runId = runId; store.save();                                   // persisted BEFORE the call: a crash leaves evidence
    const res = await tools.invoke(j.tool, structuredClone(j.args), { actor: { type: "SCHEDULER", id: "scheduler:" + j.id }, ownerApproval });
    j.runningSince = null; j.runId = null; j.lastResult = { status: res.status, at: res.at, ...(res.reason ? { reason: res.reason } : {}) };
    j.history.push({ at: res.at, status: res.status, runId, attempt: j.attempt + 1 }); j.history = j.history.slice(-historyCap);
    if (res.status === "OK") { j.attempt = 0; j.consecutiveFailures = 0; if (j.kind === "ONCE") { j.state = "DONE"; j.nextRunAt = null; } else advance(j, tNow); }
    else if (res.status === "REQUIRES_APPROVAL") { j.state = "AWAITING_APPROVAL"; j.nextRunAt = null; }
    else if (NON_RETRYABLE.has(res.status)) { j.state = "FAILED"; j.nextRunAt = null; }
    else if (TRANSIENT.has(res.status)) {
      j.attempt++;
      if (j.attempt < j.retry.maxAttempts) j.nextRunAt = iso(tNow + j.retry.backoffMs * 2 ** (j.attempt - 1));
      else { j.attempt = 0; j.consecutiveFailures++; if (j.kind === "ONCE") { j.state = "FAILED"; j.nextRunAt = null; } else if (j.consecutiveFailures >= maxFailures) { j.state = "PAUSED_BY_FAILURES"; j.nextRunAt = null; } else advance(j, tNow); }
    } else { j.state = "FAILED"; j.nextRunAt = null; }
    store.save(); log("SCHEDULE_RUN", { id: j.id, tool: j.tool, status: res.status, state: j.state });
    return { id: j.id, status: res.status, state: j.state };
  }

  /** Run everything that is due. Serialised (a second concurrent tick is a no-op). Emergency stop / Safe Mode halts before anything runs. */
  async function tick() {
    if (ticking) return { ran: 0, skipped: "TICK_IN_PROGRESS", results: [] };
    ticking = true;
    try {
      if (gate) { let g; try { g = gate({ external: false }); } catch { g = null; } if (!g || g.allowed !== true) return { ran: 0, halted: true, reason: g?.reason ?? "GATE_UNKNOWN_FAIL_CLOSED", results: [] }; }
      const t = ms(now()), due = Object.values(S.jobs).filter(j => j.state === "ACTIVE" && j.nextRunAt && ms(j.nextRunAt) <= t).sort((a, b) => ms(a.nextRunAt) - ms(b.nextRunAt));
      const results = []; for (const j of due) results.push(await execute(j));
      return { ran: results.length, results };
    } finally { ticking = false; }
  }

  /** Owner-triggered run of one job, optionally with the approval an AWAITING_APPROVAL job needs (bound to its exact args by the chain). */
  async function runNow(id, { ownerApproval = null } = {}) {
    const j = S.jobs[id]; if (!j) return { error: "NOT_FOUND" };
    if (!["ACTIVE", "AWAITING_APPROVAL", "PAUSED"].includes(j.state)) return { error: "INVALID_STATE:" + j.state };
    if (gate) { const g = gate({ external: false }); if (!g || g.allowed !== true) return { ran: false, halted: true, reason: g?.reason ?? "GATE_UNKNOWN_FAIL_CLOSED" }; }
    const wasPaused = j.state === "PAUSED"; if (j.state === "AWAITING_APPROVAL") j.state = "ACTIVE";
    const r = await execute(j, { ownerApproval }); if (wasPaused && j.state === "ACTIVE") j.state = "PAUSED"; store.save(); return r;
  }

  const get = id => S.jobs[id] ? structuredClone(S.jobs[id]) : null;
  const list = ({ state = null, tenantId = null } = {}) => Object.values(S.jobs).filter(j => (!state || j.state === state) && (!tenantId || j.tenantId === tenantId)).map(j => structuredClone(j));
  function summary() {
    const all = Object.values(S.jobs), by = {}; for (const j of all) by[j.state] = (by[j.state] ?? 0) + 1;
    const nxt = all.filter(j => j.state === "ACTIVE" && j.nextRunAt).sort((a, b) => ms(a.nextRunAt) - ms(b.nextRunAt))[0];
    return { total: all.length, byState: by, nextDue: nxt ? { id: nxt.id, name: nxt.name, at: nxt.nextRunAt } : null, awaitingApproval: all.filter(j => j.state === "AWAITING_APPROVAL").map(j => ({ id: j.id, name: j.name, tool: j.tool })), missedRuns: all.reduce((a, j) => a + j.missedRuns, 0), interruptedRuns: all.reduce((a, j) => a + (j.interruptedRuns ?? 0), 0), delivery: "AT_LEAST_ONCE" };
  }
  return { create, pause, resume, cancel, tick, runNow, get, list, summary };
}
