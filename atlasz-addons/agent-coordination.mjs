// Unified programme M4: coordination of the 30 permanent agents (5 SEARCH + 25 EXECUTION). The Master Coordinator is THIS orchestration logic; it is not an agent and creates no permanent agent.
//   * Identity: an agent only ever holds a handle made by connect(id). The sender of every message and the actor of every task step is the handle's own id, never a caller-supplied field.
//   * Messages: bound to a task; both ends must take part in that task (owner / handoff receiver / assigned verifier / the coordinator); SEARCH agents never message each other directly.
//   * Loops and runaways: reply-depth cap, per-thread and per-task message budgets, repeated-message and ping-pong detection, per-agent rate limit, mailbox caps, delegation depth, no delegation back to an earlier owner, bounded rejections.
//   * Delegation: handoffs run through the existing handoff ledger (hash-fixed artifacts, receiver acceptance, independent verifier); this module adds the role/kind permission rule and the loop rules above.
//   * Temporary sub-agents: bounded, isolated sessions of a parent (count, lifetime, message and step budgets, tool subset of the parent); they cannot spawn, delegate or touch the ledger; they never count towards the 30; they do not survive a restart.
//   * Checkpoints: the task owner stores bounded, secret-free state; recover() after a crash re-opens the books (sub-agents expired, mail kept, tasks resumable); stalled tasks are reassigned by the coordinator.
//   * Everything is persisted atomically and every decision is written to a hash-chained audit log (tamper-evident, unkeyed). The kill switch / Safe Mode (isStopped) freezes every mutation.
//   Local only: no network, no model, no spending. Messages are DATA: they are returned fenced as untrusted and are never executed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";
import { createHandoffLedger } from "./handoff-ledger.mjs";
import { AGENT_ID_RE, roleOf } from "./agent-tool-policy.mjs";
import { containsSecret, scrub } from "./secret-patterns.mjs";
import { okName } from "./safe-keys.mjs";

export const LIMITS = Object.freeze({
  maxBody: 2000, mailbox: 100, mailTtlMs: 3600_000, ratePerMin: 20, maxHop: 8, perThread: 40, perTask: 120, repeatWindow: 10, pingPong: 6,
  maxHandoffs: 3, maxRejections: 3, maxCheckpoint: 20000, checkpointsKept: 5,
  subPerParent: 2, subGlobal: 10, subTtlMs: 120_000, subMaxTtlMs: 600_000, subMessages: 10, subSteps: 20, subTools: 8, maxThreads: 2000, stateEvents: 500
});
export const MESSAGE_TYPES = Object.freeze(["TASK_NOTE", "QUESTION", "ANSWER", "REVIEW_REQUEST", "REVIEW_RESULT", "STATUS", "ESCALATION", "SUB_RESULT"]);
// Which team may own which kind of task (prefix of the ledger kind). An unknown prefix is refused: delegation fails closed.
export const KIND_ROLES = Object.freeze({ search: "SEARCH", discover: "SEARCH", lead: "SEARCH", screen: "EXECUTION", execute: "EXECUTION", build: "EXECUTION", qa: "EXECUTION", review: "EXECUTION", fix: "EXECUTION", deliver: "EXECUTION" });
const COORD = "COORDINATOR", TASK_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/, MSG_RE = /^m[0-9a-f]{16}$/, SUB_RE = /^SUB-(?:SEARCH-[1-5]|EXECUTION-(?:[1-9]|1\d|2[0-5]))-[0-9a-f]{8}$/, HASH = /^[0-9a-f]{64}$/, TOOL_RE = /^[a-z][a-z0-9._-]{0,39}$/;
const sha = t => crypto.createHash("sha256").update(t).digest("hex");
const rosterOk = a => typeof a === "string" && AGENT_ID_RE.test(a);
const kindRole = kind => { const p = String(kind).split(/[._-]/)[0]; return Object.hasOwn(KIND_ROLES, p) ? KIND_ROLES[p] : null; };
const defang = t => String(t).replace(/<{2,}|>{2,}/g, m => m.split("").join("​"));
const fenceMsg = m => "<<UNTRUSTED_AGENT_MESSAGE from=" + m.from + " type=" + m.type + ">>\n" + defang(m.body) + "\n<<END_UNTRUSTED_AGENT_MESSAGE>>";

export function createCoordinator({ dir, tenantId = "JOCI", ledger = null, isStopped = () => false, nowFn = () => Date.now(), limits = {}, toolsOf = () => [], rng = () => crypto.randomBytes(8).toString("hex") } = {}) {
  if (!dir) throw new Error("COORDINATION_DIR_REQUIRED");
  if (typeof tenantId !== "string" || !okName(/^[A-Za-z0-9._-]{1,64}$/, tenantId)) throw new Error("TENANT_INVALID");
  const L = { ...LIMITS, ...limits };
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const led = ledger ?? createHandoffLedger({ file: path.join(dir, "ledger.json"), isStopped, now: nowFn });
  const audit = createAuditChain({ filePath: path.join(dir, "coordination-audit.jsonl") });
  const stateFile = path.join(dir, "coordinator.json");
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };
  const log = (event, data = {}) => { try { audit.append(event, { tenantId, ...data }); } catch { /* the audit is best effort for liveness; a broken chain is reported by summary() */ } };

  // ------------------------------------------------------------------ persistent state
  let S = { v: 1, mail: {}, msgs: {}, threads: {}, taskMsgs: {}, checkpoints: {}, verifiers: {}, beats: {}, subs: {}, rate: {}, counters: { sent: 0, refused: 0, loops: 0, reassigned: 0, recovered: 0 } };
  const save = () => { const body = JSON.stringify(S), t = stateFile + "." + crypto.randomBytes(4).toString("hex") + ".tmp"; fs.writeFileSync(t, JSON.stringify({ sha: sha(body), body }), { mode: 0o600 }); fs.renameSync(t, stateFile); };
  let loadedFrom = "FRESH";
  if (fs.existsSync(stateFile)) {
    try { const w = JSON.parse(fs.readFileSync(stateFile, "utf8")); if (w.sha !== sha(w.body)) throw new Error("hash"); const s = JSON.parse(w.body); if (s?.v !== 1) throw new Error("shape"); S = { ...S, ...s, counters: { ...S.counters, ...s.counters } }; loadedFrom = "FILE"; }
    catch { try { fs.renameSync(stateFile, stateFile + ".corrupt-" + Date.now()); } catch { /* ignore */ } loadedFrom = "CORRUPT_STARTED_EMPTY"; log("COORDINATION_STATE_CORRUPT"); }
  }

  // ------------------------------------------------------------------ helpers
  const task = id => { const r = led.get(tenantId, id); return r.ok ? r.task : null; };
  const participants = k => { const set = new Set(k.owners ?? []); const h = k.handoffs?.find(x => x.n === k.handoff && x.status === "PENDING"); if (h) set.add(h.to); const v = S.verifiers[k.id]; if (v) set.add(v); return set; };
  function reapSubs() { const t = nowFn(); let n = 0; for (const [id, s] of Object.entries(S.subs)) if (s.status === "ACTIVE" && t >= s.expiresAt) { s.status = "EXPIRED"; delete S.mail[id]; n++; log("SUB_EXPIRED", { sub: id, parent: s.parent }); } return n; }
  const subOf = id => (typeof id === "string" && SUB_RE.test(id) && Object.hasOwn(S.subs, id) ? S.subs[id] : null);
  const rate = (who) => { const t = nowFn(), w = (S.rate[who] ??= []).filter(x => t - x < 60_000); if (w.length >= L.ratePerMin) { S.rate[who] = w; return false; } w.push(t); S.rate[who] = w; return true; };
  const refuse = (reason, extra) => { S.counters.refused++; return fail(reason, extra); };
  function dropOldMail(who) { const t = nowFn(); const box = (S.mail[who] ??= []); const keep = box.filter(id => S.msgs[id] && t - S.msgs[id].at < L.mailTtlMs); for (const id of box) if (!keep.includes(id)) delete S.msgs[id]; S.mail[who] = keep; return keep; }

  // ------------------------------------------------------------------ messaging
  function send(from, { to, task: taskId, type, body, replyTo = null } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    reapSubs();
    const sub = subOf(from);
    if (!(rosterOk(from) || from === COORD || sub)) return refuse("SENDER_UNKNOWN");
    if (sub && sub.status !== "ACTIVE") return refuse("SUB_NOT_ACTIVE");
    if (!MESSAGE_TYPES.includes(type)) return refuse("TYPE_INVALID");
    if (typeof body !== "string" || !body.trim() || body.length > L.maxBody || !body.isWellFormed() || body.includes("\0")) return refuse("BODY_INVALID");
    if (containsSecret(body) || scrub(body) !== body) return refuse("SECRET_IN_MESSAGE");
    if (typeof taskId !== "string" || !TASK_RE.test(taskId)) return refuse("TASK_REQUIRED");
    const k = task(taskId); if (!k) return refuse("TASK_NOT_FOUND");
    const ok = rosterOk(to) || to === COORD || (typeof to === "string" && subOf(to));
    if (!ok) return refuse("RECIPIENT_UNKNOWN");
    if (to === from) return refuse("MESSAGE_TO_SELF");
    const parts = participants(k);
    if (sub) {                                                                              // a sub-agent talks to its parent about the parent's task, nothing else
      if (to !== sub.parent || taskId !== sub.task) return refuse("SUB_MAY_ONLY_REPORT_TO_PARENT");
      if (type !== "SUB_RESULT" && type !== "STATUS" && type !== "QUESTION") return refuse("SUB_TYPE_NOT_ALLOWED");
      if (sub.sent >= sub.budget.messages) return refuse("SUB_MESSAGE_BUDGET_EXHAUSTED");
    } else {
      if (type === "SUB_RESULT") return refuse("TYPE_RESERVED_FOR_SUB_AGENTS");
      if (from !== COORD && !parts.has(from)) return refuse("SENDER_NOT_A_PARTICIPANT");
      if (to !== COORD && !parts.has(to) && !subOf(to)) return refuse("RECIPIENT_NOT_A_PARTICIPANT");
      if (roleOf(from) === "SEARCH" && roleOf(to) === "SEARCH") return refuse("SEARCH_TO_SEARCH_VIA_COORDINATOR_ONLY");
      if (subOf(to) && subOf(to).parent !== from) return refuse("NOT_THE_PARENT");
    }
    if (!rate(from)) { S.counters.loops++; log("MESSAGE_RATE_LIMITED", { from }); return refuse("RATE_LIMITED"); }
    let hop = 0, thread;
    if (replyTo !== null) {
      if (typeof replyTo !== "string" || !MSG_RE.test(replyTo) || !Object.hasOwn(S.msgs, replyTo)) return refuse("REPLY_TO_UNKNOWN");
      const p = S.msgs[replyTo]; if (p.task !== taskId) return refuse("REPLY_TO_OTHER_TASK"); if (p.to !== from && p.from !== from) return refuse("REPLY_TO_NOT_YOURS");
      hop = p.hop + 1; thread = p.thread;
    } else thread = "t" + rng().slice(0, 12);
    const th = (S.threads[thread] ??= { task: taskId, n: 0, frozen: false, recent: [], progress: ledgerProgress(taskId), alt: 0 });
    if (Object.keys(S.threads).length > L.maxThreads) return refuse("TOO_MANY_THREADS");
    if (th.frozen) return refuse("THREAD_FROZEN");
    if (hop > L.maxHop) { th.frozen = true; S.counters.loops++; log("LOOP_HOP_LIMIT", { thread, task: taskId }); save(); return refuse("LOOP_HOP_LIMIT"); }
    const tm = (S.taskMsgs[taskId] ??= 0);
    if (th.n >= L.perThread || tm >= L.perTask) { th.frozen = true; S.counters.loops++; log("MESSAGE_BUDGET_EXHAUSTED", { thread, task: taskId }); save(); return refuse("MESSAGE_BUDGET_EXHAUSTED"); }
    const fp = sha([from, to, type, body.trim().toLowerCase().replace(/\s+/g, " ")].join("\0"));
    if (th.recent.slice(-L.repeatWindow).filter(x => x.fp === fp).length >= 2) { th.frozen = true; S.counters.loops++; log("LOOP_REPEATED_MESSAGE", { thread, from, to, task: taskId }); save(); return refuse("LOOP_REPEATED_MESSAGE"); }
    const last = th.recent[th.recent.length - 1];
    const prog = ledgerProgress(taskId); if (prog !== th.progress) { th.progress = prog; th.alt = 0; }
    th.alt = last && last.from === to && last.to === from ? th.alt + 1 : 0;      // strict A->B, B->A, A->B ... with no task progress in between
    if (th.alt >= L.pingPong) { th.frozen = true; S.counters.loops++; log("LOOP_PING_PONG", { thread, from, to, task: taskId }); save(); return refuse("LOOP_PING_PONG"); }
    const box = dropOldMail(to); if (box.length >= L.mailbox) return refuse("MAILBOX_FULL");
    const id = "m" + rng().slice(0, 16).padEnd(16, "0");
    S.msgs[id] = { id, thread, task: taskId, from, to, type, body, hop, replyTo, at: nowFn(), fp: fp.slice(0, 16), acked: false };
    S.mail[to] = [...box, id]; th.n++; th.recent.push({ fp, from, to }); if (th.recent.length > L.repeatWindow * 2) th.recent.shift(); S.taskMsgs[taskId] = tm + 1; S.counters.sent++;
    if (sub) sub.sent++;
    log("MESSAGE", { id, from, to, task: taskId, type, hop, bodySha: sha(body).slice(0, 16) }); save();
    return { ok: true, id, thread, hop };
  }
  const ledgerProgress = taskId => { const r = led.events(tenantId, 500); return Array.isArray(r) ? r.filter(e => e.task === taskId).length : 0; };
  function inbox(who, { limit = 20 } = {}) {
    reapSubs(); const sub = subOf(who); if (sub && sub.status !== "ACTIVE") return fail("SUB_NOT_ACTIVE");
    const n = Math.max(1, Math.min(50, Number.isInteger(limit) ? limit : 20));
    return { ok: true, untrusted: true, messages: dropOldMail(who).map(id => S.msgs[id]).filter(m => m && !m.acked).slice(0, n).map(m => ({ id: m.id, thread: m.thread, task: m.task, from: m.from, type: m.type, hop: m.hop, at: m.at, text: fenceMsg(m) })) };
  }
  function ack(who, id) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    if (typeof id !== "string" || !MSG_RE.test(id) || !Object.hasOwn(S.msgs, id)) return fail("MESSAGE_UNKNOWN");
    const m = S.msgs[id]; if (m.to !== who) return fail("MESSAGE_UNKNOWN");      // somebody else's mail looks like missing mail
    m.acked = true; S.mail[who] = (S.mail[who] ?? []).filter(x => x !== id); delete S.msgs[id]; save(); return { ok: true };
  }

  // ------------------------------------------------------------------ tasks, delegation, verification
  const heartbeat = who => { S.beats[who] = nowFn(); };
  function register(from, { id, kind, payload = null, dependsOn = [] } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); if (!rosterOk(from)) return refuse("ONLY_ROSTER_AGENTS_REGISTER_TASKS");
    const need = kindRole(kind); if (!need) return refuse("KIND_NOT_PERMITTED"); if (need !== roleOf(from)) return refuse("KIND_NOT_FOR_THIS_TEAM");
    const r = led.register(tenantId, { id, kind, payload, owner: from, dependsOn }); if (r.ok) { heartbeat(from); log("TASK_REGISTERED", { id, kind, owner: from }); save(); } return r;
  }
  function start(from, id) { const r = led.start(tenantId, id, { agent: from }); if (r.ok) { heartbeat(from); log("TASK_STARTED", { id, by: from }); save(); } return r; }
  function delegate(from, id, { to, artifacts, summary = "" } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const k = task(id); if (!k) return refuse("TASK_NOT_FOUND"); if (!rosterOk(to)) return refuse("RECIPIENT_NOT_IN_ROSTER");
    if (k.owner !== from) return refuse("NOT_THE_OWNER");
    const need = kindRole(k.kind); if (!need || roleOf(to) !== need) return refuse("RECIPIENT_TEAM_NOT_PERMITTED_FOR_KIND");
    if (k.owners.includes(to)) { S.counters.loops++; log("DELEGATION_CYCLE_REFUSED", { id, from, to }); return refuse("DELEGATION_CYCLE"); }
    if (k.handoffs.length >= L.maxHandoffs) { S.counters.loops++; log("DELEGATION_DEPTH_LIMIT", { id }); return refuse("DELEGATION_DEPTH_LIMIT"); }
    if (k.rejections >= L.maxRejections) return refuse("TOO_MANY_REJECTIONS_ESCALATE");
    const r = led.handoff(tenantId, id, { from, to, artifacts, summary }); if (r.ok) { log("TASK_DELEGATED", { id, from, to, contract: r.contract }); save(); } return r;
  }
  function accept(who, id, received) { const r = led.accept(tenantId, id, { agent: who, received }); if (r.ok) { heartbeat(who); log("TASK_ACCEPTED", { id, by: who }); save(); } return r; }
  function reject(who, id, reason) { const r = led.rejectHandoff(tenantId, id, { agent: who, reason }); if (r.ok) { log("HANDOFF_REJECTED", { id, by: who }); save(); } return r; }
  function complete(who, id, resultSha256) {
    const r = led.complete(tenantId, id, { agent: who, resultSha256 }); if (!r.ok) return r;
    log("TASK_SUBMITTED", { id, by: who, resultSha256 }); assignVerifier(id); save(); return r;
  }
  /** The coordinator (not the maker) picks the checker: a roster agent of the right team that never owned the task and has capacity. */
  function assignVerifier(id) {
    const k = task(id); if (!k || k.status !== "VERIFYING") return null; if (S.verifiers[id]) return S.verifiers[id];
    const need = kindRole(k.kind), load = led.load(tenantId);
    const pool = Array.from({ length: 30 }, (_, i) => (i < 5 ? "SEARCH-" + (i + 1) : "EXECUTION-" + (i - 4))).filter(a => !k.owners.includes(a) && roleOf(a) === need);
    const per = load.perAgent ?? {}; pool.sort((a, b) => (per[a] ?? 0) - (per[b] ?? 0) || (a < b ? -1 : 1));
    if (!pool.length) { log("NO_INDEPENDENT_VERIFIER_AVAILABLE", { id }); return null; }
    S.verifiers[id] = pool[0]; log("VERIFIER_ASSIGNED", { id, verifier: pool[0] }); return pool[0];
  }
  function verify(who, id, { decision, resultSha256 } = {}) {
    if (S.verifiers[id] !== who) return refuse("NOT_THE_ASSIGNED_VERIFIER");
    const r = led.verify(tenantId, id, { verifier: who, decision, resultSha256 });
    if (r.ok) { log("TASK_VERIFIED", { id, verifier: who, decision, status: r.status }); delete S.verifiers[id]; if (r.status === "DONE") onVerified?.({ id, verifier: who }); heartbeat(who); save(); }
    return r;
  }
  let onVerified = null;
  const setOnVerified = fn => { onVerified = typeof fn === "function" ? fn : null; };
  /** Next task this agent has been asked to check (assigns one if an eligible task is waiting without a checker). */
  function nextToVerify(who) {
    if (!rosterOk(who)) return null;
    for (const t of led.list(tenantId, { status: "VERIFYING" })) {
      const k = task(t.id); if (!k) continue;
      if (S.verifiers[k.id] === who) return { id: k.id, kind: k.kind, resultSha256: k.resultHash, owner: k.owner };
      if (!S.verifiers[k.id] && !k.owners.includes(who) && roleOf(who) === kindRole(k.kind)) { S.verifiers[k.id] = who; log("VERIFIER_ASSIGNED", { id: k.id, verifier: who }); save(); return { id: k.id, kind: k.kind, resultSha256: k.resultHash, owner: k.owner }; }
    }
    return null;
  }

  // ------------------------------------------------------------------ checkpoints
  function checkpoint(who, id, state) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const k = task(id); if (!k) return refuse("TASK_NOT_FOUND"); if (k.owner !== who) return refuse("NOT_THE_OWNER");
    if (k.status !== "IN_PROGRESS" && k.status !== "ASSIGNED") return refuse("BAD_STATE:" + k.status);
    let text; try { text = JSON.stringify(state); } catch { return refuse("STATE_NOT_SERIALISABLE"); } if (typeof text !== "string") return refuse("STATE_NOT_SERIALISABLE");
    if (text.length > L.maxCheckpoint) return refuse("CHECKPOINT_TOO_LARGE"); if (containsSecret(text) || scrub(text) !== text) return refuse("SECRET_IN_CHECKPOINT");
    const list = (S.checkpoints[id] ??= []), n = (list.at(-1)?.n ?? 0) + 1;
    list.push({ n, by: who, at: nowFn(), sha: sha(text), text }); if (list.length > L.checkpointsKept) list.splice(0, list.length - L.checkpointsKept);
    heartbeat(who); log("CHECKPOINT", { id, by: who, n, sha: sha(text).slice(0, 16) }); save(); return { ok: true, n };
  }
  function resume(who, id) {
    const k = task(id); if (!k) return refuse("TASK_NOT_FOUND"); if (k.owner !== who) return refuse("NOT_THE_OWNER");
    const list = S.checkpoints[id] ?? [];
    for (let i = list.length - 1; i >= 0; i--) { const c = list[i]; if (sha(c.text) === c.sha) { heartbeat(who); return { ok: true, n: c.n, by: c.by, at: c.at, state: JSON.parse(c.text), untrusted: true }; } }
    return list.length ? refuse("ALL_CHECKPOINTS_CORRUPT") : refuse("NO_CHECKPOINT");
  }

  // ------------------------------------------------------------------ bounded temporary sub-agents
  function spawnSub(parent, { task: taskId, tools = [], ttlMs = L.subTtlMs, purpose = "" } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); reapSubs();
    if (!rosterOk(parent)) return refuse("ONLY_PERMANENT_AGENTS_SPAWN");
    const k = task(taskId); if (!k || k.owner !== parent || k.status !== "IN_PROGRESS") return refuse("PARENT_MUST_OWN_AN_ACTIVE_TASK");
    const mine = Object.values(S.subs).filter(s => s.parent === parent && s.status === "ACTIVE").length, all = Object.values(S.subs).filter(s => s.status === "ACTIVE").length;
    if (mine >= L.subPerParent) return refuse("SUB_LIMIT_PER_PARENT"); if (all >= L.subGlobal) return refuse("SUB_LIMIT_GLOBAL");
    if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > L.subMaxTtlMs) return refuse("SUB_TTL_INVALID");
    if (!Array.isArray(tools) || tools.length > L.subTools || !tools.every(t => typeof t === "string" && TOOL_RE.test(t))) return refuse("SUB_TOOLS_INVALID");
    const allowed = new Set(toolsOf(parent) ?? []); if (!tools.every(t => allowed.has(t))) return refuse("SUB_TOOLS_EXCEED_PARENT");
    if (typeof purpose !== "string" || purpose.length > 200 || containsSecret(purpose)) return refuse("PURPOSE_INVALID");
    const id = "SUB-" + parent + "-" + rng().slice(0, 8).padEnd(8, "0");
    S.subs[id] = { id, parent, task: taskId, tools: [...new Set(tools)], status: "ACTIVE", startedAt: nowFn(), expiresAt: nowFn() + ttlMs, sent: 0, steps: 0, budget: { messages: L.subMessages, steps: L.subSteps }, purpose: scrub(purpose), scratch: null };
    log("SUB_SPAWNED", { sub: id, parent, task: taskId, tools: S.subs[id].tools, ttlMs }); save(); return { ok: true, sub: id, expiresAt: S.subs[id].expiresAt };
  }
  function subStep(subId, note) {          // every sub-agent action is one counted step; scratch state lives only inside the session
    reapSubs(); const s = subOf(subId); if (!s || s.status !== "ACTIVE") return refuse("SUB_NOT_ACTIVE");
    if (s.steps >= s.budget.steps) { s.status = "EXHAUSTED"; delete S.mail[subId]; log("SUB_BUDGET_EXHAUSTED", { sub: subId }); save(); return refuse("SUB_STEP_BUDGET_EXHAUSTED"); }
    if (typeof note !== "string" || note.length > 500 || containsSecret(note)) return refuse("SUB_NOTE_INVALID");
    s.steps++; s.scratch = scrub(note); save(); return { ok: true, steps: s.steps };
  }
  function finishSub(subId, result) {
    const s = subOf(subId); if (!s || s.status !== "ACTIVE") return refuse("SUB_NOT_ACTIVE");
    const r = send(subId, { to: s.parent, task: s.task, type: "SUB_RESULT", body: String(result ?? "") }); if (!r.ok) return r;
    s.status = "FINISHED"; delete S.mail[subId]; log("SUB_FINISHED", { sub: subId, parent: s.parent }); save(); return { ok: true, message: r.id };
  }
  function killSub(by, subId) { const s = subOf(subId); if (!s || s.status !== "ACTIVE") return refuse("SUB_NOT_ACTIVE"); if (by !== s.parent && by !== COORD) return refuse("NOT_THE_PARENT"); s.status = "KILLED"; delete S.mail[subId]; log("SUB_KILLED", { sub: subId, by }); save(); return { ok: true }; }

  // ------------------------------------------------------------------ recovery and stalled work (coordinator only)
  function recover() {
    let subs = 0; for (const s of Object.values(S.subs)) if (s.status === "ACTIVE") { s.status = "RECOVERED_EXPIRED"; delete S.mail[s.id]; subs++; }
    for (const th of Object.values(S.threads)) if (th.recent.length > L.repeatWindow * 2) th.recent.length = L.repeatWindow * 2;
    const rows = led.list(tenantId, {});
    const resumable = rows.filter(x => x.status === "IN_PROGRESS" || x.status === "ASSIGNED").map(x => ({ id: x.id, owner: x.owner, checkpoint: (S.checkpoints[x.id] ?? []).at(-1)?.n ?? null }));
    S.counters.recovered++; log("COORDINATION_RECOVERED", { subsExpired: subs, resumable: resumable.length, loadedFrom }); save();
    return { ok: true, loadedFrom, subsExpired: subs, resumable, pendingVerification: rows.filter(x => x.status === "VERIFYING").map(x => x.id) };
  }
  function reclaimStalled({ olderThanMs = 600_000 } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const t = nowFn(), out = [];
    for (const x of led.list(tenantId, {})) {
      if (x.status !== "IN_PROGRESS" && x.status !== "ASSIGNED") continue; if (t - (S.beats[x.owner] ?? 0) < olderThanMs) continue;
      const k = task(x.id); if (!k) continue; const need = kindRole(k.kind), per = led.load(tenantId).perAgent ?? {};
      const pool = Array.from({ length: 30 }, (_, i) => (i < 5 ? "SEARCH-" + (i + 1) : "EXECUTION-" + (i - 4))).filter(a => roleOf(a) === need && !k.owners.includes(a)).sort((a, b) => (per[a] ?? 0) - (per[b] ?? 0) || (a < b ? -1 : 1));
      let moved = false; for (const to of pool) { const r = led.reassign(tenantId, x.id, { to, reason: "STALLED_" + k.owner }); if (r.ok) { S.beats[to] = t; S.counters.reassigned++; log("TASK_RECLAIMED", { id: x.id, from: k.owner, to }); out.push({ id: x.id, from: k.owner, to, checkpoint: (S.checkpoints[x.id] ?? []).at(-1)?.n ?? null }); moved = true; break; } }
      if (!moved) log("TASK_STALLED_NO_TAKER", { id: x.id, owner: k.owner });
    }
    if (out.length) save(); return { ok: true, reassigned: out };
  }
  function closeThread(thread) { const th = S.threads[thread]; if (!th) return fail("THREAD_UNKNOWN"); th.frozen = true; log("THREAD_CLOSED", { thread }); save(); return { ok: true }; }

  // ------------------------------------------------------------------ views
  function summary() {
    reapSubs(); const tasks = led.list(tenantId, {}), by = {}; for (const x of tasks) by[x.status] = (by[x.status] ?? 0) + 1;
    return { tenantId, loadedFrom, permanentAgents: 30, searchAgents: 5, executionAgents: 25, masterCoordinator: "ORCHESTRATION_LOGIC_NOT_AN_AGENT", tasks: by, activeSubAgents: Object.values(S.subs).filter(s => s.status === "ACTIVE").length, frozenThreads: Object.values(S.threads).filter(t => t.frozen).length, pendingMessages: Object.values(S.mail).reduce((a, b) => a + b.length, 0), counters: { ...S.counters }, auditOk: audit.verify().ok, stopped: stopped() };
  }

  // ------------------------------------------------------------------ identity-bound handles
  const handles = new Map();
  function connect(agentId) {
    if (!rosterOk(agentId)) return null;
    if (handles.has(agentId)) return handles.get(agentId);
    const h = Object.freeze({
      id: agentId,
      send: m => send(agentId, m ?? {}), inbox: o => inbox(agentId, o), ack: id => ack(agentId, id),
      register: o => register(agentId, o ?? {}), start: id => start(agentId, id), delegate: (id, o) => delegate(agentId, id, o ?? {}), accept: (id, rec) => accept(agentId, id, rec), reject: (id, why) => reject(agentId, id, why),
      complete: (id, hash) => complete(agentId, id, hash), verify: (id, o) => verify(agentId, id, o ?? {}), nextToVerify: () => nextToVerify(agentId),
      checkpoint: (id, st) => checkpoint(agentId, id, st), resume: id => resume(agentId, id), heartbeat: () => { heartbeat(agentId); return { ok: true }; },
      spawnSub: o => spawnSub(agentId, o ?? {}), killSub: id => killSub(agentId, id),
      subHandle: subId => { const s = subOf(subId); if (!s || s.parent !== agentId) return null; return Object.freeze({ id: subId, send: m => send(subId, m ?? {}), inbox: o => inbox(subId, o), step: n => subStep(subId, n), finish: r => finishSub(subId, r) }); }
    });
    handles.set(agentId, h); return h;
  }
  return { connect, recover, reclaimStalled, closeThread, summary, setOnVerified, verifierOf: id => S.verifiers[id] ?? null, auditVerify: () => audit.verify(), auditEntries: () => audit.entries(), ledger: led, limits: L };
}
