// Reusable workflows (85-capability programme: GE11 templates & stateful delegation, P06 reusable personal workflows, P08 interrupted-task continuation,
// P05 task state rewind, P11 batch processing). Everything here is workflow-owned state: instances, step results and batch records. The engine never touches financial,
// audit, approval or other modules' facts; steps can only call ACTIONS that the host registered, each declaring whether it is idempotent and whether it may be rewound.
//  * Template  - versioned, typed parameters, ordered steps; {{p.name}} / {{s.stepId.field}} substitution only (no code evaluation); unknown actions or parameters are refused when the template is saved.
//  * Instance  - durable; a checkpoint is persisted before AND after every step. After a crash a step left RUNNING is retried only if its action is idempotent, otherwise the instance is PAUSED for review.
//  * Rewind    - resets later steps to PENDING; refused (nothing changed) if any step to undo ran a non-rewindable action.
//  * Batch     - one instance per item, per-item checkpoint, rate limit, error isolation, resumable.
//  * Stop      - a host stop hook (kill switch / Safe Mode) pauses an instance before its next step.
import crypto from "node:crypto";
import { createStore, clone } from "./business/store.mjs";

export const LIMITS = Object.freeze({ maxTemplates: 200, maxSteps: 50, maxParams: 20, maxParamChars: 10000, maxInstances: 2000, maxBatchItems: 500, maxBatches: 100, stepTimeoutMs: 10000, maxRetries: 3, maxOutputChars: 20000 });
const SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)|(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}\b|(?<![A-Za-z0-9])ghp_[A-Za-z0-9]{30,}/g;
const redactStr = s => { SECRET.lastIndex = 0; return s.replace(SECRET, "[redacted]"); };
const redactDeep = v => typeof v === "string" ? redactStr(v) : Array.isArray(v) ? v.map(redactDeep) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x)])) : v;
const hasSecret = v => { if (typeof v === "string") { SECRET.lastIndex = 0; return SECRET.test(v); } if (Array.isArray(v)) return v.some(hasSecret); if (v && typeof v === "object") return Object.values(v).some(hasSecret); return false; };
const rid = p => p + crypto.randomBytes(6).toString("hex");
const ID = /^[a-z][a-z0-9_-]{0,39}$/, PARAM_TYPES = new Set(["string", "number", "boolean", "enum"]);
const PLACE = /\{\{\s*(p|s)\.([A-Za-z0-9_.-]+)\s*\}\}/g, ONLY = /^\{\{\s*(p|s)\.([A-Za-z0-9_.-]+)\s*\}\}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const sleepReal = ms => new Promise(r => setTimeout(r, ms));

/** @param actions {name: {run:async(args,ctx)=>any, idempotent?:bool, rewindable?:bool}} - the ONLY things a step can do. */
export function createWorkflowEngine({ file = null, actions = {}, now = () => new Date().toISOString(), clock = () => Date.now(), sleep = sleepReal, isStopped = () => false, limits = LIMITS } = {}) {
  const store = createStore({ file, init: () => ({ templates: {}, instances: {}, batches: {} }) }), d = store.data, L = limits, running = new Set();
  const act = n => (Object.hasOwn(actions, n) ? actions[n] : null);
  const save = () => store.save();

  // ---------------- templates
  function checkParams(params) {
    if (params === undefined) return { ok: true, params: {} };
    if (!params || typeof params !== "object" || Array.isArray(params) || Object.keys(params).length > L.maxParams) return { ok: false, reason: "PARAMS_INVALID" };
    for (const [k, p] of Object.entries(params)) {
      if (!ID.test(k) || FORBIDDEN_KEYS.has(k) || !p || !PARAM_TYPES.has(p.type)) return { ok: false, reason: "PARAM_DEFINITION_INVALID:" + k };
      if (p.type === "enum" && !(Array.isArray(p.values) && p.values.length && p.values.every(v => typeof v === "string"))) return { ok: false, reason: "PARAM_ENUM_INVALID:" + k };
      if (p.default !== undefined && !valueOk(p, p.default)) return { ok: false, reason: "PARAM_DEFAULT_INVALID:" + k };
      if (hasSecret(p)) return { ok: false, reason: "SECRET_IN_INPUT:param " + k };
    }
    return { ok: true, params };
  }
  const valueOk = (p, v) => p.type === "string" ? typeof v === "string" && v.length <= L.maxParamChars : p.type === "number" ? typeof v === "number" && Number.isFinite(v) : p.type === "boolean" ? typeof v === "boolean" : p.type === "enum" ? p.values.includes(v) : false;
  function refs(v, out = []) { if (typeof v === "string") { for (const m of v.matchAll(PLACE)) out.push({ kind: m[1], path: m[2] }); } else if (Array.isArray(v)) v.forEach(x => refs(x, out)); else if (v && typeof v === "object") Object.values(v).forEach(x => refs(x, out)); return out; }

  function saveTemplate({ tenantId, id, name, params, steps, schedule = null } = {}) {
    if (!tenantId || typeof tenantId !== "string") return { ok: false, reason: "TENANT_REQUIRED" };
    if (!ID.test(String(id))) return { ok: false, reason: "TEMPLATE_ID_INVALID" };
    if (typeof name !== "string" || !name.trim()) return { ok: false, reason: "NAME_REQUIRED" };
    const pc = checkParams(params); if (!pc.ok) return pc;
    if (!Array.isArray(steps) || !steps.length || steps.length > L.maxSteps) return { ok: false, reason: "STEPS_INVALID" };
    const seen = new Set(); let idx = 0;
    for (const s of steps) {
      if (!s || !ID.test(String(s.id)) || seen.has(s.id)) return { ok: false, reason: "STEP_ID_INVALID_OR_DUPLICATE" };
      if (!act(s.action)) return { ok: false, reason: "UNKNOWN_ACTION:" + s.action };
      if (s.args !== undefined && (typeof s.args !== "object" || s.args === null || Array.isArray(s.args))) return { ok: false, reason: "STEP_ARGS_INVALID:" + s.id };
      if (s.onError !== undefined && !["stop", "continue"].includes(s.onError)) return { ok: false, reason: "ON_ERROR_INVALID:" + s.id };
      if (s.retries !== undefined && !(Number.isInteger(s.retries) && s.retries >= 0 && s.retries <= L.maxRetries)) return { ok: false, reason: "RETRIES_INVALID:" + s.id };
      if (hasSecret(s.args ?? {})) return { ok: false, reason: "SECRET_IN_INPUT:step " + s.id };
      if ((s.retries ?? 0) > 0 && act(s.action).idempotent !== true) return { ok: false, reason: "RETRIES_NOT_ALLOWED_FOR_NON_IDEMPOTENT:" + s.id };       // an automatic retry could repeat a side effect
      for (const r of refs(s.args ?? {})) {
        if (r.kind === "p" && !Object.hasOwn(pc.params, r.path)) return { ok: false, reason: "UNKNOWN_PARAMETER:" + r.path };
        if (r.kind === "s") { const sid = r.path.split(".")[0]; if (!seen.has(sid)) return { ok: false, reason: "STEP_REFERENCE_NOT_EARLIER:" + sid }; }
        if (r.path.split(".").some(k => FORBIDDEN_KEYS.has(k))) return { ok: false, reason: "REFERENCE_FORBIDDEN" };
      }
      seen.add(s.id); idx++;
    }
    if (schedule !== null && !(schedule && Number.isInteger(schedule.everyMinutes) && schedule.everyMinutes >= 5 && schedule.everyMinutes <= 10080 && schedule.params && typeof schedule.params === "object" && !Array.isArray(schedule.params))) return { ok: false, reason: "SCHEDULE_INVALID" };
    if (schedule !== null) { if (hasSecret(schedule.params)) return { ok: false, reason: "SECRET_IN_INPUT:schedule" }; const sb = bindParams({ params: pc.params }, schedule.params); if (!sb.ok) return { ok: false, reason: "SCHEDULE_PARAMS_INVALID:" + sb.reason }; }       // a schedule that could never start is refused when it is saved
    const key = tenantId + ":" + id, prev = d.templates[key];
    if (!prev && Object.keys(d.templates).length >= L.maxTemplates) return { ok: false, reason: "TOO_MANY_TEMPLATES" };
    const t = { tenantId, id, name: redactStr(name).slice(0, 120), version: (prev?.version ?? 0) + 1, params: pc.params, steps: clone(steps.map(s => ({ id: s.id, action: s.action, args: s.args ?? {}, onError: s.onError ?? "stop", retries: s.retries ?? 0 }))), schedule: schedule ? { everyMinutes: schedule.everyMinutes, params: clone(schedule.params), lastRunAt: prev?.schedule?.lastRunAt ?? null } : null, updatedAt: now() };
    d.templates[key] = t; save(); return { ok: true, id, version: t.version };
  }
  const listTemplates = ({ tenantId } = {}) => Object.values(d.templates).filter(t => t.tenantId === tenantId).map(t => ({ id: t.id, name: t.name, version: t.version, steps: t.steps.length, params: Object.keys(t.params), scheduled: Boolean(t.schedule) }));
  const getTemplate = (id, { tenantId } = {}) => { const t = d.templates[tenantId + ":" + id]; return t ? { ok: true, template: clone(t) } : { ok: false, reason: "NOT_FOUND" }; };

  // ---------------- instances
  const inst = (id, tenantId) => { const i = d.instances[id]; return i && i.tenantId === tenantId ? i : null; };
  function bindParams(t, given) {
    const out = {};
    if (given !== undefined && (!given || typeof given !== "object" || Array.isArray(given))) return { ok: false, reason: "PARAMS_INVALID" };
    for (const k of Object.keys(given ?? {})) if (!Object.hasOwn(t.params, k)) return { ok: false, reason: "UNKNOWN_PARAMETER:" + k };
    if (hasSecret(given)) return { ok: false, reason: "SECRET_IN_INPUT" };
    for (const [k, p] of Object.entries(t.params)) {
      const v = given?.[k] !== undefined ? given[k] : p.default;
      if (v === undefined) { if (p.required) return { ok: false, reason: "PARAMETER_REQUIRED:" + k }; continue; }
      if (!valueOk(p, v)) return { ok: false, reason: "PARAMETER_INVALID:" + k };
      out[k] = v;
    }
    return { ok: true, params: out };
  }
  function start({ tenantId, templateId, params } = {}) {
    const t = d.templates[tenantId + ":" + templateId]; if (!t) return { ok: false, reason: "TEMPLATE_NOT_FOUND" };
    const b = bindParams(t, params); if (!b.ok) return b;
    if (Object.keys(d.instances).length >= L.maxInstances) return { ok: false, reason: "TOO_MANY_INSTANCES" };
    const i = { id: rid("wf_"), tenantId, templateId, templateVersion: t.version, params: b.params, status: "PENDING", reason: null, createdAt: now(), updatedAt: now(), checkpoints: 0,
      steps: t.steps.map(s => ({ id: s.id, action: s.action, args: clone(s.args), onError: s.onError, retries: s.retries, status: "PENDING", attempts: 0, output: null, error: null, startedAt: null, finishedAt: null })) };
    d.instances[i.id] = i; save(); return { ok: true, id: i.id };
  }
  function lookup(i, kind, path) {
    const parts = path.split("."); let cur;
    if (kind === "p") { cur = i.params; } else { const st = i.steps.find(s => s.id === parts[0]); if (!st || st.status !== "DONE") return { ok: false, reason: "STEP_NOT_DONE:" + parts[0] }; cur = st.output; parts.shift(); }
    if (kind === "p") { if (!Object.hasOwn(cur, parts[0]) || parts.length !== 1) return { ok: false, reason: "PARAMETER_UNSET:" + path }; return { ok: true, value: cur[parts[0]] }; }
    for (const k of parts) { if (FORBIDDEN_KEYS.has(k) || cur === null || typeof cur !== "object" || !Object.hasOwn(cur, k)) return { ok: false, reason: "OUTPUT_PATH_MISSING:" + path }; cur = cur[k]; }
    if (cur !== null && typeof cur === "object") return { ok: false, reason: "REFERENCE_NOT_SCALAR:" + path };
    return { ok: true, value: cur };
  }
  function resolve(i, v) {                                   // pure substitution, no evaluation
    if (typeof v === "string") {
      const only = ONLY.exec(v); if (only) return lookup(i, only[1], only[2]);
      let bad = null; const out = v.replace(PLACE, (_m, k, p) => { const r = lookup(i, k, p); if (!r.ok) { bad = r; return ""; } return String(r.value); });
      return bad ?? { ok: true, value: out };
    }
    if (Array.isArray(v)) { const o = []; for (const x of v) { const r = resolve(i, x); if (!r.ok) return r; o.push(r.value); } return { ok: true, value: o }; }
    if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) { const r = resolve(i, x); if (!r.ok) return r; o[k] = r.value; } return { ok: true, value: o }; }
    return { ok: true, value: v };
  }
  const touch = (i, status, reason = null) => { i.status = status; i.reason = reason; i.updatedAt = now(); i.checkpoints++; save(); };
  const withTimeout = (p, ms) => { let t; return Promise.race([Promise.resolve(p), new Promise((_, rej) => { t = setTimeout(() => rej(new Error("STEP_TIMEOUT")), ms); })]).finally(() => clearTimeout(t)); };

  /** Mark the instance RUNNING again unless it was cancelled while a step was in flight (a cancel must never be overwritten). */
  const keepRunning = i => { if (i.status === "CANCELLED") return false; touch(i, "RUNNING"); return true; };
  async function execute(id, { tenantId } = {}) {
    const i = inst(id, tenantId); if (!i) return { ok: false, reason: "NOT_FOUND" };
    if (running.has(id)) return { ok: false, reason: "ALREADY_RUNNING" };
    if (["DONE", "CANCELLED"].includes(i.status)) return { ok: false, reason: "NOT_RUNNABLE:" + i.status };
    // a step with side effects that FAILED may have done part of its work: only a human decision (review RETRY/SKIP) lets it run again
    let flagged = false; for (const s of i.steps) if (s.status === "FAILED" && s.onError === "stop" && act(s.action)?.idempotent !== true) { s.status = "NEEDS_REVIEW"; flagged = true; }
    if (flagged) { i.status = "PAUSED"; i.reason = "NEEDS_REVIEW"; i.updatedAt = now(); i.checkpoints++; save(); }
    if (i.steps.some(s => s.status === "NEEDS_REVIEW")) return { ok: false, reason: "NEEDS_REVIEW" };
    running.add(id);
    try {
      touch(i, "RUNNING");
      for (const s of i.steps) {
        if (["DONE", "SKIPPED"].includes(s.status) || (s.status === "FAILED" && s.onError === "continue")) continue;
        if (i.status === "CANCELLED") return { ok: true, status: "CANCELLED" };
        let stopped = false; try { stopped = Boolean(isStopped()); } catch { stopped = true; }
        if (stopped) { touch(i, "PAUSED", "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); return { ok: true, status: "PAUSED", reason: i.reason }; }
        const a = act(s.action);
        if (!a) { s.status = "FAILED"; s.error = "ACTION_NOT_AVAILABLE"; touch(i, "FAILED", "ACTION_NOT_AVAILABLE:" + s.id); return { ok: true, status: "FAILED", reason: i.reason }; }
        const args = resolve(i, s.args);
        if (!args.ok) { s.status = "FAILED"; s.error = args.reason; touch(i, "FAILED", args.reason); return { ok: true, status: "FAILED", reason: args.reason }; }
        s.status = "RUNNING"; s.startedAt = now(); s.args = args.value; if (!keepRunning(i)) return { ok: true, status: "CANCELLED" };                 // checkpoint BEFORE the step
        let lastErr = null, done = false, unknownOutcome = false; const safeToRepeat = a.idempotent === true, tries = safeToRepeat ? s.retries : 0;
        for (let att = 0; att <= tries && !done; att++) {
          s.attempts++;
          try {
            const out = await withTimeout(a.run(clone(args.value), { instanceId: id, stepId: s.id, tenantId }), L.stepTimeoutMs);
            const safe = redactDeep(out ?? null); if (JSON.stringify(safe ?? null).length > L.maxOutputChars) throw new Error("OUTPUT_TOO_LARGE");
            s.output = safe; s.status = "DONE"; s.error = null; s.finishedAt = now(); done = true;
          } catch (e) { lastErr = redactStr(String(e?.message ?? e)).slice(0, 300); if (!safeToRepeat && lastErr === "STEP_TIMEOUT") { unknownOutcome = true; break; } }       // a timed-out side-effecting step may still be running or may have finished: never guess
        }
        if (unknownOutcome) { s.status = "NEEDS_REVIEW"; s.error = "STEP_OUTCOME_UNKNOWN_AFTER_TIMEOUT"; s.finishedAt = now(); touch(i, "PAUSED", "NEEDS_REVIEW:" + s.id); return { ok: true, status: "PAUSED", reason: i.reason }; }
        if (!done) { s.status = "FAILED"; s.error = lastErr; s.finishedAt = now(); if (s.onError === "stop") { touch(i, "FAILED", "STEP_FAILED:" + s.id); return { ok: true, status: "FAILED", reason: i.reason }; } }
        if (!keepRunning(i)) return { ok: true, status: "CANCELLED" };                                       // checkpoint AFTER the step (and honour a cancel that arrived meanwhile)
      }
      touch(i, i.steps.some(s => s.status === "FAILED") ? "DONE_WITH_ERRORS" : "DONE"); return { ok: true, status: i.status };
    } finally { running.delete(id); }
  }
  function cancel(id, { tenantId } = {}) { const i = inst(id, tenantId); if (!i) return { ok: false, reason: "NOT_FOUND" }; if (["DONE", "DONE_WITH_ERRORS", "CANCELLED"].includes(i.status)) return { ok: false, reason: "NOT_CANCELLABLE:" + i.status }; touch(i, "CANCELLED", "CANCELLED_BY_USER"); return { ok: true }; }
  /** Task-level continuation: PAUSED / FAILED / interrupted instances continue from the first unfinished step. A FAILED step is retried; NEEDS_REVIEW must be cleared by review(). */
  async function resume(id, { tenantId } = {}) {
    const i = inst(id, tenantId); if (!i) return { ok: false, reason: "NOT_FOUND" };
    if (running.has(id)) return { ok: false, reason: "ALREADY_RUNNING" };
    if (!["PAUSED", "FAILED", "RUNNING", "PENDING"].includes(i.status)) return { ok: false, reason: "NOT_RESUMABLE:" + i.status };
    return execute(id, { tenantId });
  }
  function review(id, stepId, { tenantId, decision } = {}) {
    const i = inst(id, tenantId); if (!i) return { ok: false, reason: "NOT_FOUND" };
    const s = i.steps.find(x => x.id === stepId); if (!s || s.status !== "NEEDS_REVIEW") return { ok: false, reason: "NOT_AWAITING_REVIEW" };
    if (!["RETRY", "SKIP"].includes(decision)) return { ok: false, reason: "DECISION_INVALID" };
    s.status = decision === "RETRY" ? "PENDING" : "SKIPPED"; s.error = null; touch(i, "PAUSED", "REVIEWED"); return { ok: true };
  }
  /** Crash recovery, run once at construction: an instance left RUNNING had a step in flight. Idempotent action -> retry it; anything else -> a human decides. */
  function recover() {
    let n = 0;
    for (const i of Object.values(d.instances)) {
      if (i.status !== "RUNNING") continue;
      for (const s of i.steps) if (s.status === "RUNNING") { const a = act(s.action); if (a?.idempotent === true) { s.status = "PENDING"; s.error = null; } else { s.status = "NEEDS_REVIEW"; s.error = "INTERRUPTED_NON_IDEMPOTENT_STEP"; } }
      i.status = "PAUSED"; i.reason = i.steps.some(s => s.status === "NEEDS_REVIEW") ? "RECOVERED_NEEDS_REVIEW" : "RECOVERED"; i.updatedAt = now(); i.checkpoints++; n++;
    }
    if (n) save(); return n;
  }
  const recovered = recover();
  /** Rewind to just after `toStepId` (or to the start with toStepId=null). Only this instance's step results change. */
  function rewind(id, toStepId, { tenantId } = {}) {
    const i = inst(id, tenantId); if (!i) return { ok: false, reason: "NOT_FOUND" };
    if (running.has(id)) return { ok: false, reason: "ALREADY_RUNNING" };
    if (i.status === "CANCELLED") return { ok: false, reason: "NOT_REWINDABLE:CANCELLED" };
    const at = toStepId === null ? -1 : i.steps.findIndex(s => s.id === toStepId); if (toStepId !== null && at < 0) return { ok: false, reason: "STEP_NOT_FOUND" };
    const undo = i.steps.slice(at + 1).filter(s => s.status !== "PENDING");
    for (const s of undo) { if (act(s.action)?.rewindable !== true) return { ok: false, reason: "REWIND_BLOCKED:" + s.id }; }
    if (!undo.length) return { ok: true, reset: [] };                                          // nothing to undo: nothing changes
    for (const s of undo) { s.status = "PENDING"; s.output = null; s.error = null; s.attempts = 0; s.startedAt = null; s.finishedAt = null; }
    touch(i, "PAUSED", "REWOUND_TO:" + (toStepId ?? "START")); return { ok: true, reset: undo.map(s => s.id) };
  }
  const pubInst = i => { const { tenantId: _t, ...x } = i; return clone(x); };
  const getInstance = (id, { tenantId } = {}) => { const i = inst(id, tenantId); return i ? { ok: true, instance: pubInst(i) } : { ok: false, reason: "NOT_FOUND" }; };
  const listInstances = ({ tenantId, status = null } = {}) => Object.values(d.instances).filter(i => i.tenantId === tenantId && (!status || i.status === status)).map(i => ({ id: i.id, templateId: i.templateId, status: i.status, reason: i.reason, updatedAt: i.updatedAt, steps: i.steps.map(s => s.status) }));

  // ---------------- batches (P11)
  function createBatch({ tenantId, templateId, items, ratePerMinute = 30 } = {}) {
    const t = d.templates[tenantId + ":" + templateId]; if (!t) return { ok: false, reason: "TEMPLATE_NOT_FOUND" };
    if (!Array.isArray(items) || !items.length || items.length > L.maxBatchItems) return { ok: false, reason: "ITEMS_INVALID" };
    if (!(Number.isInteger(ratePerMinute) && ratePerMinute >= 1 && ratePerMinute <= 600)) return { ok: false, reason: "RATE_INVALID" };
    if (Object.keys(d.batches).length >= L.maxBatches) return { ok: false, reason: "TOO_MANY_BATCHES" };
    const bound = []; for (const [k, it] of items.entries()) { const b = bindParams(t, it); if (!b.ok) return { ok: false, reason: `ITEM_${k}_${b.reason}` }; bound.push(b.params); }   // validate ALL items before anything starts
    const b = { id: rid("bt_"), tenantId, templateId, ratePerMinute, status: "PENDING", createdAt: now(), items: bound.map((params, index) => ({ index, params, status: "PENDING", instanceId: null, error: null })) };
    d.batches[b.id] = b; save(); return { ok: true, id: b.id, items: b.items.length };
  }
  const bsum = b => { const c = { PENDING: 0, DONE: 0, FAILED: 0 }; for (const x of b.items) c[x.status] = (c[x.status] ?? 0) + 1; return { id: b.id, templateId: b.templateId, status: b.status, total: b.items.length, ...c, ratePerMinute: b.ratePerMinute }; };
  const stamps = [];
  async function runBatch(id, { tenantId } = {}) {
    const b = d.batches[id]; if (!b || b.tenantId !== tenantId) return { ok: false, reason: "NOT_FOUND" };
    if (running.has(id)) return { ok: false, reason: "ALREADY_RUNNING" };
    running.add(id); b.status = "RUNNING"; save();
    try {
      for (const it of b.items) {
        if (it.status === "DONE") continue;                                                       // per-item checkpoint: finished items are never re-run after a restart
        let stopped = false; try { stopped = Boolean(isStopped()); } catch { stopped = true; }
        if (stopped) { b.status = "PAUSED"; save(); return { ok: true, ...bsum(b), reason: "OWNER_STOP_OR_SAFE_MODE_ACTIVE" }; }
        for (;;) {                                                                                 // sliding-window rate limit
          const t = clock(); while (stamps.length && t - stamps[0] >= 60000) stamps.shift();
          if (stamps.length < b.ratePerMinute) { stamps.push(t); break; }
          await sleep(Math.max(1, 60000 - (t - stamps[0])));
        }
        try {
          const s = it.instanceId ? { ok: true, id: it.instanceId } : start({ tenantId, templateId: b.templateId, params: it.params });
          if (!s.ok) throw new Error(s.reason);
          it.instanceId = s.id; save();
          const cur = inst(it.instanceId, tenantId); if (!cur) throw new Error("INSTANCE_MISSING");
          const r = ["DONE", "DONE_WITH_ERRORS"].includes(cur.status) ? { ok: true, status: cur.status }   // crash window: the instance finished but the item was not saved - finalise, never re-execute
            : cur.status !== "PENDING" ? await resume(it.instanceId, { tenantId }) : await execute(it.instanceId, { tenantId });
          if (!r.ok) throw new Error(r.reason);
          if (r.status === "PAUSED" && r.reason === "OWNER_STOP_OR_SAFE_MODE_ACTIVE") { b.status = "PAUSED"; save(); return { ok: true, ...bsum(b), reason: r.reason }; }   // in-flight item stays PENDING
          if (r.status === "DONE" || r.status === "DONE_WITH_ERRORS") { it.status = r.status === "DONE" ? "DONE" : "FAILED"; it.error = r.status === "DONE" ? null : "STEP_ERRORS"; }
          else { it.status = "FAILED"; it.error = String(r.reason ?? r.status).slice(0, 200); }
        } catch (e) { it.status = "FAILED"; it.error = redactStr(String(e?.message ?? e)).slice(0, 200); }   // error isolation: the next item still runs
        save();
      }
      b.status = b.items.every(x => x.status === "DONE") ? "DONE" : "DONE_WITH_ERRORS"; save(); return { ok: true, ...bsum(b) };
    } finally { running.delete(id); }
  }
  /** Retry only the failed items of a finished batch. */
  function requeueFailed(id, { tenantId } = {}) { const b = d.batches[id]; if (!b || b.tenantId !== tenantId) return { ok: false, reason: "NOT_FOUND" }; let n = 0; for (const it of b.items) if (it.status === "FAILED") {
      const i = it.instanceId ? inst(it.instanceId, tenantId) : null;                           // keep the instance: finished steps are never executed twice
      if (i && ["DONE_WITH_ERRORS", "FAILED", "PAUSED"].includes(i.status)) { for (const st of i.steps) if (st.status === "FAILED") { st.status = act(st.action)?.idempotent === true ? "PENDING" : "NEEDS_REVIEW"; st.error = st.status === "PENDING" ? null : "REQUEUED_NEEDS_REVIEW"; } if (i.status !== "PAUSED") touch(i, "PAUSED", "REQUEUED"); }
      it.status = "PENDING"; it.error = null; n++; } if (n) { b.status = "PENDING"; save(); } return { ok: true, requeued: n }; }
  const getBatch = (id, { tenantId } = {}) => { const b = d.batches[id]; return b && b.tenantId === tenantId ? { ok: true, batch: { ...bsum(b), items: b.items.map(x => ({ index: x.index, status: x.status, instanceId: x.instanceId, error: x.error })) } } : { ok: false, reason: "NOT_FOUND" }; };

  // ---------------- schedulable templates (P06): the engine only says WHAT is due; the host decides when to call tick()
  function due({ tenantId } = {}) { const t0 = Date.parse(now()); return Object.values(d.templates).filter(t => t.tenantId === tenantId && t.schedule && (!t.schedule.lastRunAt || t0 - Date.parse(t.schedule.lastRunAt) >= t.schedule.everyMinutes * 60000)).map(t => t.id); }
  async function tick({ tenantId } = {}) {
    const out = []; let stopped = false; try { stopped = Boolean(isStopped()); } catch { stopped = true; }
    if (stopped) return out;                                                                      // while stopped nothing starts and no period is consumed
    for (const tid of due({ tenantId })) {
      const t = d.templates[tenantId + ":" + tid];
      const s = start({ tenantId, templateId: tid, params: t.schedule.params }); t.schedule.lastRunAt = now(); save();
      out.push({ templateId: tid, started: s.ok, ...(s.ok ? { instanceId: s.id, result: (await execute(s.id, { tenantId })).status } : { reason: s.reason }) });
    }
    return out;
  }
  return { saveTemplate, listTemplates, getTemplate, start, execute, resume, cancel, review, rewind, getInstance, listInstances, createBatch, runBatch, requeueFailed, getBatch, due, tick, recoveredOnStart: recovered, actionNames: () => Object.keys(actions) };
}
