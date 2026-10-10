// Unified programme M4: coordination of the 30 permanent agents (5 SEARCH + 25 EXECUTION). The Master Coordinator is THIS orchestration logic; it is not an agent and creates no permanent agent.
//   * Identity: an agent only ever holds a handle made by connect(id). The sender of every message and the actor of every task step is the handle's own id, never a caller-supplied field.
//   * Messages: bound to a task; both ends must take part in that task NOW (current owner / pending handoff receiver / assigned verifier / the coordinator); SEARCH agents never message each other directly.
//   * Loops and runaways (per task, not just per thread): reply-depth cap, per-thread and per-task budgets (no single participant can use a task's whole budget), repeated-message and ping-pong detection that blocks the pair until the task makes progress, per-agent rate limit, mailbox caps, thread caps, delegation depth, no delegation back to an earlier owner, bounded rejections.
//   * Delegation: handoffs run through the existing handoff ledger (hash-fixed artifacts, receiver acceptance, independent verifier); this module adds the team/kind permission rule and the loop rules above. Unanswered handoffs and unattended verifications are recovered by the coordinator.
//   * Temporary sub-agents: bounded, isolated sessions of a parent (count, spawn rate, lifetime, message and step budgets, tool subset of the parent); they cannot spawn, delegate or touch the ledger; they die when the parent loses the task; they never count towards the 30; they do not survive a restart.
//   * Checkpoints: the task owner stores bounded, secret-free state; recover() after a crash re-opens the books (sub-agents expired, mail kept, tasks resumable, state pruned); stalled work is reassigned by the coordinator.
//   * Everything is persisted atomically (a malformed state file is set aside, never trusted) and every decision is written to a hash-chained audit log (tamper-evident, unkeyed). The kill switch / Safe Mode (isStopped) freezes every mutation except the safety moves (kill a sub-agent, close a thread).
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
  maxBody: 2000, mailbox: 100, coordinatorMailbox: 200, coordinatorPerSender: 20, coordinatorEscPerSender: 5, coordinatorTtlMs: 86_400_000, maxReassign: 3, verifierResets: 2, mailTtlMs: 3600_000, ratePerMin: 20, maxHop: 8, perThread: 40, perTask: 120, perTaskPerSender: 60, taskWindowMs: 3600_000, threadsPerTask: 20, threadTtlMs: 86_400_000,
  repeatWindow: 10, pingPong: 6, pairBlockMs: 600_000, maxHandoffs: 3, maxRejections: 3, maxCheckpoint: 20000, checkpointsKept: 5, handoffStaleMs: 600_000, verifyStaleMs: 900_000,
  subPerParent: 2, subGlobal: 10, subSpawnPerHour: 20, subTtlMs: 120_000, subMaxTtlMs: 600_000, subMessages: 10, subSteps: 20, subTools: 8, maxThreads: 2000, keepDoneMs: 86_400_000
});
export const MESSAGE_TYPES = Object.freeze(["TASK_NOTE", "QUESTION", "ANSWER", "REVIEW_REQUEST", "REVIEW_RESULT", "STATUS", "ESCALATION", "SUB_RESULT"]);
// Which team may own which kind of task (prefix of the ledger kind). An unknown prefix is refused: delegation fails closed.
export const KIND_ROLES = Object.freeze({ search: "SEARCH", discover: "SEARCH", lead: "SEARCH", screen: "EXECUTION", execute: "EXECUTION", build: "EXECUTION", qa: "EXECUTION", review: "EXECUTION", fix: "EXECUTION", deliver: "EXECUTION" });
const COORD = "COORDINATOR", TASK_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/, MSG_RE = /^m[0-9a-f]{16}$/, SUB_RE = /^SUB-(?:SEARCH-[1-5]|EXECUTION-(?:[1-9]|1\d|2[0-5]))-[0-9a-f]{8}$/, TOOL_RE = /^[a-z][a-z0-9._-]{0,39}$/;
const MAPS = ["mail", "msgs", "threads", "taskMsgs", "taskLoop", "checkpoints", "verifiers", "verifierTried", "beats", "subs", "rate", "spawns", "doneAt", "progress", "reassigns", "verifierResets"];
const sha = t => crypto.createHash("sha256").update(t).digest("hex");
const rosterOk = a => typeof a === "string" && AGENT_ID_RE.test(a);
const ROSTER = Object.freeze(Array.from({ length: 30 }, (_, i) => (i < 5 ? "SEARCH-" + (i + 1) : "EXECUTION-" + (i - 4))));
const kindRole = kind => { const p = String(kind).split(/[._-]/)[0]; return Object.hasOwn(KIND_ROLES, p) ? KIND_ROLES[p] : null; };
const defang = t => String(t).replace(/<{2,}|>{2,}/g, m => m.split("").join("​"));
const fenceMsg = m => "<<UNTRUSTED_AGENT_MESSAGE from=" + m.from + " type=" + m.type + ">>\n" + defang(m.body) + "\n<<END_UNTRUSTED_AGENT_MESSAGE>>";
const np = o => Object.assign(Object.create(null), o && typeof o === "object" && !Array.isArray(o) ? o : {});      // no prototype: an id like "constructor" can never read an inherited member
const plain = v => v !== null && typeof v === "object" && !Array.isArray(v);

export function createCoordinator({ dir, tenantId = "JOCI", ledger = null, isStopped = () => false, nowFn = () => Date.now(), limits = {}, ledgerLimits = {}, toolsOf = () => [], rng = () => crypto.randomBytes(8).toString("hex") } = {}) {
  if (!dir) throw new Error("COORDINATION_DIR_REQUIRED");
  if (typeof tenantId !== "string" || !okName(/^[A-Za-z0-9._-]{1,64}$/, tenantId)) throw new Error("TENANT_INVALID");
  const L = { ...LIMITS, ...limits };
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const led = ledger ?? createHandoffLedger({ file: path.join(dir, "ledger.json"), isStopped, now: nowFn, limits: ledgerLimits });
  const audit = createAuditChain({ filePath: path.join(dir, "coordination-audit.jsonl") });
  const stateFile = path.join(dir, "coordinator.json");
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };
  const log = (event, data = {}) => { try { audit.append(event, { tenantId, ...data }); } catch { /* a broken chain is reported by summary() */ } };

  // ------------------------------------------------------------------ persistent state
  const fresh = () => { const s = { v: 2, counters: { sent: 0, refused: 0, loops: 0, reassigned: 0, recovered: 0, uncoordinated: 0, abandoned: 0, rescinded: 0, verifierChanged: 0, gc: 0 }, saves: 0 }; for (const k of MAPS) s[k] = np(); return s; };
  let S = fresh();
  const save = () => { if (++S.saves % 50 === 0) gc(); const body = JSON.stringify(S), t = stateFile + "." + crypto.randomBytes(4).toString("hex") + ".tmp"; fs.writeFileSync(t, JSON.stringify({ sha: sha(body), body }), { mode: 0o600 }); fs.renameSync(t, stateFile); };
  let loadedFrom = "FRESH";
  if (fs.existsSync(stateFile)) {
    try {
      const w = JSON.parse(fs.readFileSync(stateFile, "utf8")); if (w.sha !== sha(w.body)) throw new Error("hash"); const s = JSON.parse(w.body);
      if (!plain(s) || s.v !== 2 || !plain(s.counters) || !MAPS.every(k => s[k] === undefined || plain(s[k]))) throw new Error("shape");
      const arr = (o, f) => { for (const v of Object.values(o ?? {})) if (!Array.isArray(v) || !v.every(f)) throw new Error("shape-array"); };
      arr(s.mail, x => typeof x === "string"); arr(s.rate, x => Number.isFinite(x)); arr(s.spawns, x => Number.isFinite(x)); arr(s.verifierTried, x => typeof x === "string");
      arr(s.checkpoints, x => plain(x) && typeof x.text === "string" && typeof x.sha === "string" && Number.isInteger(x.n));
      for (const m of Object.values(s.msgs ?? {})) if (!plain(m) || typeof m.to !== "string" || typeof m.from !== "string" || typeof m.task !== "string" || typeof m.body !== "string" || !Number.isFinite(m.at) || !Number.isInteger(m.hop)) throw new Error("shape-msg");
      for (const th of Object.values(s.threads ?? {})) if (!plain(th) || typeof th.task !== "string") throw new Error("shape-th");
      for (const tl of Object.values(s.taskLoop ?? {})) if (!plain(tl) || !Array.isArray(tl.recent) || !tl.recent.every(r => plain(r) && typeof r.fp === "string" && typeof r.from === "string" && typeof r.to === "string") || !plain(tl.blocks)) throw new Error("shape-tl");
      for (const tm of Object.values(s.taskMsgs ?? {})) if (!plain(tm) || !plain(tm.by) || !Number.isFinite(tm.since)) throw new Error("shape-tm");
      for (const sb of Object.values(s.subs ?? {})) if (!plain(sb) || typeof sb.parent !== "string" || typeof sb.task !== "string" || typeof sb.status !== "string" || !plain(sb.budget) || !Number.isInteger(sb.budget.messages) || !Number.isInteger(sb.budget.steps) || sb.budget.messages < 0 || sb.budget.steps < 0 || !Number.isFinite(sb.expiresAt)) throw new Error("shape-sub");
      for (const v of Object.values(s.verifiers ?? {})) if (typeof v !== "string") throw new Error("shape-ver");
      const base = fresh(); S = { ...base, ...s, counters: { ...base.counters, ...s.counters } }; for (const k of MAPS) S[k] = np(s[k]); delete S.escalations; loadedFrom = "FILE";
    } catch { try { fs.renameSync(stateFile, stateFile + ".corrupt-" + Date.now()); } catch { /* ignore */ } S = fresh(); loadedFrom = "CORRUPT_STARTED_EMPTY"; log("COORDINATION_STATE_CORRUPT"); }
  }

  // ------------------------------------------------------------------ helpers
  const task = id => { if (typeof id !== "string" || !TASK_RE.test(id) || !okName(TASK_RE, id)) return null; const r = led.get(tenantId, id); return r.ok ? r.task : null; };
  const own = (m, k) => (typeof k === "string" && Object.hasOwn(m, k) ? m[k] : undefined);
  const subOf = id => (typeof id === "string" && SUB_RE.test(id) ? own(S.subs, id) ?? null : null);
  const participants = k => { const set = new Set([k.owner]); const h = k.handoffs?.find(x => x.n === k.handoff && x.status === "PENDING"); if (h) set.add(h.to); const v = own(S.verifiers, k.id); if (v) set.add(v); return set; };
  const ledgerProgress = taskId => own(S.progress, taskId) ?? 0, bump = id => { S.progress[id] = (own(S.progress, id) ?? 0) + 1; };
  const perAgentLoad = () => { const per = { ...(led.load(tenantId).perAgent ?? {}) }; for (const v of Object.values(S.verifiers)) per[v] = (per[v] ?? 0) + 1; return per; };      // duty = owned open tasks + checks assigned
  function reapSubs() {
    const t = nowFn(); let n = 0;
    for (const s of Object.values(S.subs)) {
      if (s.status !== "ACTIVE") continue; const k = task(s.task);
      if (t >= s.expiresAt || !k || k.owner !== s.parent || k.status !== "IN_PROGRESS") { s.status = t >= s.expiresAt ? "EXPIRED" : "ORPHANED"; delete S.mail[s.id]; n++; log("SUB_" + s.status, { sub: s.id, parent: s.parent }); }
    }
    return n;
  }
  const rate = who => { const t = nowFn(), w = (own(S.rate, who) ?? []).filter(x => t - x < 60_000); if (w.length >= L.ratePerMin) { S.rate[who] = w; return false; } w.push(t); S.rate[who] = w; return true; };
  const refuse = (reason, extra) => { S.counters.refused++; return fail(reason, extra); };
  function dropOldMail(who) { const t = nowFn(), box = own(S.mail, who) ?? []; const keep = box.filter(id => own(S.msgs, id) && t - S.msgs[id].at < L.mailTtlMs); for (const id of box) if (!keep.includes(id)) delete S.msgs[id]; S.mail[who] = keep; return keep; }
  function gc() {
    const t = nowFn(); let n = 0;
    for (const [id, th] of Object.entries(S.threads)) if (t - (th.at ?? 0) > L.threadTtlMs || !task(th.task)) { delete S.threads[id]; n++; }
    for (const k of ["taskMsgs", "taskLoop", "checkpoints", "verifiers", "verifierTried", "progress", "reassigns", "verifierResets"]) for (const id of Object.keys(S[k])) { const tk = task(id); if (!tk) { delete S[k][id]; n++; } else if (["DONE", "FAILED", "CANCELLED"].includes(tk.status)) { S.doneAt[id] ??= t; if (t - S.doneAt[id] > L.keepDoneMs) { delete S[k][id]; n++; } } }
    for (const id of Object.keys(S.doneAt)) if (!task(id)) delete S.doneAt[id];
    for (const [id, w] of Object.entries(S.rate)) if (!w.length || t - w[w.length - 1] > 60_000) { delete S.rate[id]; n++; }
    for (const [id, s] of Object.entries(S.subs)) if (s.status !== "ACTIVE" && t - (s.expiresAt ?? 0) > 3600_000) { delete S.subs[id]; delete S.rate[id]; n++; }
    for (const id of Object.keys(S.spawns)) { S.spawns[id] = S.spawns[id].filter(x => t - x < 3600_000); if (!S.spawns[id].length) delete S.spawns[id]; }
    for (const id of Object.keys(S.mail)) if (!rosterOk(id) && id !== COORD && !own(S.subs, id)) { for (const m of S.mail[id]) delete S.msgs[m]; delete S.mail[id]; n++; }
    S.counters.gc += n; return n;
  }

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
    const toSub = subOf(to);
    if (!(rosterOk(to) || to === COORD || toSub)) return refuse("RECIPIENT_UNKNOWN");
    if (to === from) return refuse("MESSAGE_TO_SELF");
    if (toSub && toSub.status !== "ACTIVE") return refuse("RECIPIENT_NOT_ACTIVE");
    const parts = participants(k);
    if (sub) {                                                                              // a sub-agent talks to its parent about the parent's task, nothing else
      if (to !== sub.parent || taskId !== sub.task) return refuse("SUB_MAY_ONLY_REPORT_TO_PARENT");
      if (type !== "SUB_RESULT" && type !== "STATUS" && type !== "QUESTION") return refuse("SUB_TYPE_NOT_ALLOWED");
      if (sub.sent >= sub.budget.messages) return refuse("SUB_MESSAGE_BUDGET_EXHAUSTED");
    } else {
      if (type === "SUB_RESULT") return refuse("TYPE_RESERVED_FOR_SUB_AGENTS");
      if (from !== COORD && !parts.has(from)) return refuse("SENDER_NOT_A_PARTICIPANT");
      if (to !== COORD && !parts.has(to) && !toSub) return refuse("RECIPIENT_NOT_A_PARTICIPANT");
      if (roleOf(from) === "SEARCH" && roleOf(to) === "SEARCH") return refuse("SEARCH_TO_SEARCH_VIA_COORDINATOR_ONLY");
      if (toSub && toSub.parent !== from) return refuse("NOT_THE_PARENT");
    }
    // per-task state (survives new threads): window budget, per-sender share, pair blocks
    const t = nowFn(), tm = (S.taskMsgs[taskId] = own(S.taskMsgs, taskId) && t - S.taskMsgs[taskId].since < L.taskWindowMs ? S.taskMsgs[taskId] : { n: 0, since: t, by: {} });
    const prog = ledgerProgress(taskId), tl = (S.taskLoop[taskId] ??= { recent: [], alt: 0, progress: prog, blocks: {} });
    if (tl.progress !== prog) { tl.progress = prog; tl.alt = 0; tl.blocks = {}; }
    const who = sub ? sub.parent : from, pair = from + ">" + to; if ((own(tl.blocks, pair) ?? 0) > t) return refuse("LOOP_PAIR_BLOCKED");      // directional: only the sender that looped is blocked, the other side can always answer
    if (tm.n >= L.perTask || (tm.by[who] ?? 0) >= L.perTaskPerSender) { S.counters.loops++; log("MESSAGE_BUDGET_EXHAUSTED", { task: taskId, from }); save(); return refuse("MESSAGE_BUDGET_EXHAUSTED"); }
    if (!rate(from)) { S.counters.loops++; log("MESSAGE_RATE_LIMITED", { from }); return refuse("RATE_LIMITED"); }
    let hop = 0, thread, isNew = false;
    if (replyTo !== null) {
      const p = typeof replyTo === "string" && MSG_RE.test(replyTo) ? own(S.msgs, replyTo) : undefined; if (!p) return refuse("REPLY_TO_UNKNOWN");
      if (p.task !== taskId) return refuse("REPLY_TO_OTHER_TASK"); if (p.to !== from && p.from !== from) return refuse("REPLY_TO_NOT_YOURS");
      hop = p.hop + 1; thread = p.thread;
    } else { thread = "t" + rng().slice(0, 12); isNew = true; }
    let th = own(S.threads, thread);
    if (isNew || !th) {
      th = { task: taskId, n: 0, frozen: false, at: t, by: who };
      const mine = Object.values(S.threads).filter(x => x.task === taskId && x.by === who).length;
      if (mine >= L.threadsPerTask) { const old = Object.entries(S.threads).filter(([, x]) => x.task === taskId && x.by === who).sort((a, b) => a[1].at - b[1].at)[0]; if (old && (old[1].frozen || t - old[1].at > 60_000)) delete S.threads[old[0]]; else return refuse("TOO_MANY_THREADS_ON_TASK"); }
      if (Object.keys(S.threads).length >= L.maxThreads) { gc(); if (Object.keys(S.threads).length >= L.maxThreads) return refuse("TOO_MANY_THREADS"); }
    }
    if (th.frozen) return refuse("THREAD_FROZEN");
    if (hop > L.maxHop) { th.frozen = true; S.threads[thread] = th; S.counters.loops++; log("LOOP_HOP_LIMIT", { thread, task: taskId }); save(); return refuse("LOOP_HOP_LIMIT"); }
    if (th.n >= L.perThread) { th.frozen = true; S.threads[thread] = th; S.counters.loops++; log("MESSAGE_BUDGET_EXHAUSTED", { thread, task: taskId }); save(); return refuse("MESSAGE_BUDGET_EXHAUSTED"); }
    const fp = sha([from, to, type, body.trim().toLowerCase().replace(/\s+/g, " ")].join("\0"));
    const block = reason => { tl.blocks[pair] = t + L.pairBlockMs; S.counters.loops++; log(reason, { thread, from, to, task: taskId }); save(); return refuse(reason); };
    if (tl.recent.slice(-L.repeatWindow).filter(x => x.fp === fp).length >= 2) return block("LOOP_REPEATED_MESSAGE");
    const last = tl.recent[tl.recent.length - 1];
    tl.alt = last && last.from === to && last.to === from ? tl.alt + 1 : 0;      // strict A->B, B->A, A->B ... on the task with no ledger progress in between (any thread)
    if (tl.alt >= L.pingPong) { tl.alt = 0; return block("LOOP_PING_PONG"); }
    const box = to === COORD ? (own(S.mail, COORD) ?? []) : dropOldMail(to);
    if (to === COORD) {
      const t0 = t; for (const m of box.slice()) { const mm = own(S.msgs, m); if (!mm || t0 - mm.at > L.coordinatorTtlMs) { box.splice(box.indexOf(m), 1); delete S.msgs[m]; } }
      const mine = box.filter(m => own(S.msgs, m)?.from === from), esc = mine.filter(m => own(S.msgs, m)?.type === "ESCALATION").length;
      if (type === "ESCALATION" ? esc >= L.coordinatorEscPerSender : mine.length - esc >= L.coordinatorPerSender) return refuse("COORDINATOR_MAILBOX_SENDER_LIMIT");      // routine notes can never use up the slots reserved for escalations
      if (box.length >= L.coordinatorMailbox) { const victim = box.find(m => own(S.msgs, m)?.type !== "ESCALATION") ?? null; if (victim === null) return refuse("COORDINATOR_MAILBOX_FULL"); box.splice(box.indexOf(victim), 1); delete S.msgs[victim]; }
    } else if (box.length >= L.mailbox) return refuse("MAILBOX_FULL");
    const id = "m" + rng().slice(0, 16).padEnd(16, "0");
    S.msgs[id] = { id, thread, task: taskId, from, to, type, body, hop, replyTo, at: t, fp: fp.slice(0, 16), acked: false };
    S.mail[to] = [...box, id]; th.n++; th.at = t; S.threads[thread] = th; tl.recent.push({ fp, from, to }); if (tl.recent.length > L.repeatWindow * 2) tl.recent.shift();
    tm.n++; tm.by[who] = (tm.by[who] ?? 0) + 1; S.counters.sent++; if (sub) sub.sent++;
    log("MESSAGE", { id, from, to, task: taskId, type, hop, bodySha: sha(body).slice(0, 16) }); save();
    return { ok: true, id, thread, hop };
  }
  function inbox(who, { limit = 20 } = {}) {
    reapSubs(); const sub = subOf(who); if (sub && sub.status !== "ACTIVE") return fail("SUB_NOT_ACTIVE");
    const n = Math.max(1, Math.min(50, Number.isInteger(limit) ? limit : 20));
    return { ok: true, untrusted: true, messages: dropOldMail(who).map(id => own(S.msgs, id)).filter(m => m && !m.acked).slice(0, n).map(m => ({ id: m.id, thread: m.thread, task: m.task, from: m.from, type: m.type, hop: m.hop, at: m.at, text: fenceMsg(m) })) };
  }
  function ack(who, id) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    const m = typeof id === "string" && MSG_RE.test(id) ? own(S.msgs, id) : undefined; if (!m || m.to !== who) return fail("MESSAGE_UNKNOWN");      // somebody else's mail looks like missing mail
    m.acked = true; S.mail[who] = (own(S.mail, who) ?? []).filter(x => x !== id); delete S.msgs[id]; save(); return { ok: true };
  }
  /** The coordinator's own mailbox (escalations and questions addressed to it). Owner/orchestrator side only: handles do not expose it. */
  const coordinatorInbox = ({ limit = 50 } = {}) => ({ ok: true, untrusted: true, messages: (own(S.mail, COORD) ?? []).map(id => own(S.msgs, id)).filter(Boolean).slice(0, Math.max(1, Math.min(100, limit))).map(m => ({ id: m.id, task: m.task, from: m.from, type: m.type, at: m.at, text: fenceMsg(m) })) });
  function coordinatorAck(id) { const m = typeof id === "string" && MSG_RE.test(id) ? own(S.msgs, id) : undefined; if (!m || m.to !== COORD) return fail("MESSAGE_UNKNOWN"); S.mail[COORD] = (own(S.mail, COORD) ?? []).filter(x => x !== id); delete S.msgs[id]; save(); return { ok: true }; }

  // ------------------------------------------------------------------ tasks, delegation, verification
  const heartbeat = who => { S.beats[who] = nowFn(); S.lastAliveAt = nowFn(); };      // lastAliveAt = the last time ANY agent was active: the measure of real downtime at the next start
  function register(from, { id, kind, payload = null, dependsOn = [] } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); if (!rosterOk(from)) return refuse("ONLY_ROSTER_AGENTS_REGISTER_TASKS");
    if (typeof id !== "string" || !TASK_RE.test(id) || !okName(TASK_RE, id)) return refuse("TASK_ID_INVALID");
    const need = kindRole(kind); if (!need) return refuse("KIND_NOT_PERMITTED"); if (need !== roleOf(from)) return refuse("KIND_NOT_FOR_THIS_TEAM");
    const r = led.register(tenantId, { id, kind, payload, owner: from, dependsOn }); if (r.ok) { bump(id); heartbeat(from); log("TASK_REGISTERED", { id, kind, owner: from }); save(); } return r;
  }
  function start(from, id) { if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const r = led.start(tenantId, id, { agent: from }); if (r.ok) { bump(id); heartbeat(from); log("TASK_STARTED", { id, by: from }); save(); } return r; }
  function delegate(from, id, { to, artifacts, summary = "" } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const k = task(id); if (!k) return refuse("TASK_NOT_FOUND"); if (!rosterOk(to)) return refuse("RECIPIENT_NOT_IN_ROSTER");
    if (k.owner !== from) return refuse("NOT_THE_OWNER");
    const need = kindRole(k.kind); if (!need || roleOf(to) !== need) return refuse("RECIPIENT_TEAM_NOT_PERMITTED_FOR_KIND");
    if (k.owners.includes(to)) { S.counters.loops++; log("DELEGATION_CYCLE_REFUSED", { id, from, to }); return refuse("DELEGATION_CYCLE"); }
    if (k.handoffs.length >= L.maxHandoffs) { S.counters.loops++; log("DELEGATION_DEPTH_LIMIT", { id }); return refuse("DELEGATION_DEPTH_LIMIT"); }
    if (k.rejections >= L.maxRejections) return refuse("TOO_MANY_REJECTIONS_ESCALATE");
    const r = led.handoff(tenantId, id, { from, to, artifacts, summary }); if (r.ok) { bump(id); log("TASK_DELEGATED", { id, from, to, contract: r.contract }); save(); } return r;
  }
  function withdrawDelegation(who, id, reason = "") { if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const r = led.rescind(tenantId, id, { by: who, reason }); if (r.ok) { bump(id); S.counters.rescinded++; log("DELEGATION_WITHDRAWN", { id, by: who }); save(); } return r; }
  function accept(who, id, received) { if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const r = led.accept(tenantId, id, { agent: who, received }); if (r.ok) { bump(id); heartbeat(who); log("TASK_ACCEPTED", { id, by: who }); save(); } return r; }
  function reject(who, id, reason) { if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const r = led.rejectHandoff(tenantId, id, { agent: who, reason }); if (r.ok) { bump(id); log("HANDOFF_REJECTED", { id, by: who }); save(); } return r; }
  /** Heartbeat times must be real numbers and never later than "now" (a clock that jumped backwards or a damaged state file must not blind stall detection). */
  function sanitiseBeats(now) { for (const k of Object.keys(S.beats)) { const v = S.beats[k]; if (!Number.isFinite(v)) delete S.beats[k]; else if (v > now) S.beats[k] = now; } if (S.lastAliveAt !== undefined && S.lastAliveAt !== null && !Number.isFinite(S.lastAliveAt)) S.lastAliveAt = null; else if (S.lastAliveAt > now) S.lastAliveAt = now; }
  function complete(who, id, resultSha256) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const r = led.complete(tenantId, id, { agent: who, resultSha256 }); if (!r.ok) return r;
    bump(id); log("TASK_SUBMITTED", { id, by: who, resultSha256 }); assignVerifier(id); heartbeat(who); save();
    const now = task(id); if (now && now.status === "FAILED") return fail("NO_CHECKER_AVAILABLE", { abandoned: true }); return r;      // the submission stands in the ledger but the maker is told the task could not be checked
  }
  /** The coordinator (not the maker) picks the checker: a roster agent of the right team that never owned the task, never already failed to check it, and carries the least duty (owned tasks + checks assigned). */
  function assignVerifier(id) {
    const k = task(id); if (!k || k.status !== "VERIFYING") return null; if (own(S.verifiers, id)) return S.verifiers[id];
    const need = kindRole(k.kind), per = perAgentLoad(), tried = own(S.verifierTried, id) ?? [];
    const pool = ROSTER.filter(a => !k.owners.includes(a) && !tried.includes(a) && roleOf(a) === need).sort((a, b) => (per[a] ?? 0) - (per[b] ?? 0) || (a < b ? -1 : 1));
    if (!pool.length) {
      if (tried.length && (own(S.verifierResets, id) ?? 0) < L.verifierResets) { S.verifierResets[id] = (own(S.verifierResets, id) ?? 0) + 1; S.verifierTried[id] = []; log("VERIFIER_POOL_RECYCLED", { id }); return assignVerifier(id); }
      log("NO_INDEPENDENT_VERIFIER_AVAILABLE", { id }); abandon(id, "NO_CHECKER_AVAILABLE"); return null;      // also when nobody on the team is outside the owners: a task that can never be checked must not wait forever
    }
    S.verifiers[id] = pool[0]; S.verifierTried[id] = [...tried, pool[0]]; S.beats["verify:" + id] = nowFn(); log("VERIFIER_ASSIGNED", { id, verifier: pool[0] }); return pool[0];
  }
  function verify(who, id, { decision, resultSha256 } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); if (own(S.verifiers, id) !== who) return refuse("NOT_THE_ASSIGNED_VERIFIER");
    const r = led.verify(tenantId, id, { verifier: who, decision, resultSha256 });
    if (r.ok) { bump(id); log("TASK_VERIFIED", { id, verifier: who, decision, status: r.status }); delete S.verifiers[id]; delete S.verifierTried[id]; if (r.status === "DONE") { S.doneAt[id] = nowFn(); try { onVerified?.({ id, verifier: who }); } catch { /* a hook failure never undoes a verification */ } } heartbeat(who); save(); }
    return r;
  }
  let onVerified = null;
  const setOnVerified = fn => { onVerified = typeof fn === "function" ? fn : null; };
  /** Next task this agent has been asked to check (assigns one if an eligible task is waiting without a checker). `prefix` limits it to a kind prefix the caller can actually check. */
  function nextToVerify(who, { prefix = null } = {}) {
    if (!rosterOk(who)) return null;
    for (const t of led.list(tenantId, { status: "VERIFYING" })) {
      if (prefix && !String(t.kind).startsWith(prefix)) continue;
      const k = task(t.id); if (!k) continue; const view = () => ({ id: k.id, kind: k.kind, resultSha256: k.resultHash, owner: k.owner });
      if (own(S.verifiers, k.id) === who) return view();
      if (!own(S.verifiers, k.id) && !stopped() && !k.owners.includes(who) && !(own(S.verifierTried, k.id) ?? []).includes(who) && roleOf(who) === kindRole(k.kind)) { S.verifiers[k.id] = who; S.verifierTried[k.id] = [...(own(S.verifierTried, k.id) ?? []), who]; S.beats["verify:" + k.id] = nowFn(); log("VERIFIER_ASSIGNED", { id: k.id, verifier: who }); save(); return view(); }
    }
    return null;
  }
  /** Coordinator decision for work that cannot be completed (a rejected result nobody can rework, a task with too many rejections): mark it FAILED so its owner's slot is freed, and tell the owner side. */
  function abandon(id, reason = "") {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const k = task(id); if (!k) return fail("TASK_NOT_FOUND");
    const r = led.close(tenantId, id, { agent: k.owner, status: "FAILED", reason: "COORDINATOR:" + scrub(String(reason)).slice(0, 80) }); if (r.ok) { bump(id); S.counters.abandoned++; delete S.verifiers[id]; log("TASK_ABANDONED", { id, owner: k.owner, reason: scrub(String(reason)).slice(0, 80) }); save(); } return r;
  }

  // ------------------------------------------------------------------ checkpoints
  function checkpoint(who, id, state) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const k = task(id); if (!k) return refuse("TASK_NOT_FOUND"); if (k.owner !== who) return refuse("NOT_THE_OWNER");
    if (k.status !== "IN_PROGRESS" && k.status !== "ASSIGNED") return refuse("BAD_STATE:" + k.status);
    let text; try { text = JSON.stringify(state); } catch { return refuse("STATE_NOT_SERIALISABLE"); } if (typeof text !== "string") return refuse("STATE_NOT_SERIALISABLE");
    if (text.length > L.maxCheckpoint) return refuse("CHECKPOINT_TOO_LARGE"); if (containsSecret(text) || scrub(text) !== text) return refuse("SECRET_IN_CHECKPOINT");
    const list = (S.checkpoints[id] = own(S.checkpoints, id) ?? []), n = (list.at(-1)?.n ?? 0) + 1;
    list.push({ n, by: who, at: nowFn(), sha: sha(text), text }); if (list.length > L.checkpointsKept) list.splice(0, list.length - L.checkpointsKept);
    heartbeat(who); log("CHECKPOINT", { id, by: who, n, sha: sha(text).slice(0, 16) }); save(); return { ok: true, n };
  }
  function resume(who, id) {
    const k = task(id); if (!k) return refuse("TASK_NOT_FOUND"); if (k.owner !== who) return refuse("NOT_THE_OWNER");
    const list = own(S.checkpoints, id) ?? [];
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
    const t = nowFn(), recent = (own(S.spawns, parent) ?? []).filter(x => t - x < 3600_000); if (recent.length >= L.subSpawnPerHour) return refuse("SUB_SPAWN_RATE");
    if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > L.subMaxTtlMs) return refuse("SUB_TTL_INVALID");
    if (!Array.isArray(tools) || tools.length > L.subTools || !tools.every(x => typeof x === "string" && TOOL_RE.test(x))) return refuse("SUB_TOOLS_INVALID");
    const allowed = new Set(toolsOf(parent) ?? []); if (!tools.every(x => allowed.has(x))) return refuse("SUB_TOOLS_EXCEED_PARENT");
    if (typeof purpose !== "string" || purpose.length > 200 || containsSecret(purpose)) return refuse("PURPOSE_INVALID");
    const id = "SUB-" + parent + "-" + rng().slice(0, 8).padEnd(8, "0"); S.spawns[parent] = [...recent, t];
    S.subs[id] = { id, parent, task: taskId, tools: [...new Set(tools)], status: "ACTIVE", startedAt: t, expiresAt: t + ttlMs, sent: 0, steps: 0, budget: { messages: L.subMessages, steps: L.subSteps }, purpose: scrub(purpose), scratch: null };
    log("SUB_SPAWNED", { sub: id, parent, task: taskId, tools: S.subs[id].tools, ttlMs }); save(); return { ok: true, sub: id, expiresAt: S.subs[id].expiresAt };
  }
  function subStep(subId, note) {          // every sub-agent action is one counted step; scratch state lives only inside the session
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); reapSubs(); const s = subOf(subId); if (!s || s.status !== "ACTIVE") return refuse("SUB_NOT_ACTIVE");
    if (s.steps >= s.budget.steps) { s.status = "EXHAUSTED"; delete S.mail[subId]; log("SUB_BUDGET_EXHAUSTED", { sub: subId }); save(); return refuse("SUB_STEP_BUDGET_EXHAUSTED"); }
    if (typeof note !== "string" || note.length > 500 || containsSecret(note)) return refuse("SUB_NOTE_INVALID");
    s.steps++; s.scratch = scrub(note); save(); return { ok: true, steps: s.steps };
  }
  function finishSub(subId, result) {
    const s = subOf(subId); if (!s || s.status !== "ACTIVE") return refuse("SUB_NOT_ACTIVE");
    const r = send(subId, { to: s.parent, task: s.task, type: "SUB_RESULT", body: String(result ?? "") }); if (!r.ok) return r;
    s.status = "FINISHED"; delete S.mail[subId]; log("SUB_FINISHED", { sub: subId, parent: s.parent }); save(); return { ok: true, message: r.id };
  }
  function killSub(by, subId) { const s = subOf(subId); if (!s || s.status !== "ACTIVE") return refuse("SUB_NOT_ACTIVE"); if (by !== s.parent && by !== COORD) return refuse("NOT_THE_PARENT"); s.status = "KILLED"; delete S.mail[subId]; log("SUB_KILLED", { sub: subId, by }); save(); return { ok: true }; }      // a safety move: allowed while stopped

  // ------------------------------------------------------------------ recovery and stalled work (coordinator only)
  function recover() {
    let subs = 0; for (const s of Object.values(S.subs)) if (s.status === "ACTIVE") { s.status = "RECOVERED_EXPIRED"; delete S.mail[s.id]; subs++; }
    const pruned = gc(), rows = led.list(tenantId, {}); { const now = nowFn(); sanitiseBeats(now); const down = Number.isFinite(S.lastAliveAt) ? Math.max(0, now - S.lastAliveAt) : null; for (const k of Object.keys(S.beats)) S.beats[k] = down === null ? now : Math.min(now, S.beats[k] + down); S.lastAliveAt = now; }      // the time nobody could run is credited back (real downtime must not look like a stall); time the process was up and an owner stayed silent still counts, so frequent restarts cannot hide a stall. A state without lastAliveAt (older file) gets a full reset once
    const resumable = rows.filter(x => x.status === "IN_PROGRESS" || x.status === "ASSIGNED").map(x => ({ id: x.id, owner: x.owner, checkpoint: (own(S.checkpoints, x.id) ?? []).at(-1)?.n ?? null }));
    S.counters.recovered++; log("COORDINATION_RECOVERED", { subsExpired: subs, resumable: resumable.length, pruned, loadedFrom }); save();
    return { ok: true, loadedFrom, subsExpired: subs, pruned, resumable, pendingVerification: rows.filter(x => x.status === "VERIFYING").map(x => x.id) };
  }
  /** Coordinator sweep: work whose owner went quiet is reassigned; a handoff nobody answers is withdrawn; a check nobody performs moves to another checker. */
  function reclaimStalled({ olderThanMs = 600_000 } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const t = nowFn(), out = { reassigned: [], rescinded: [], reverifier: [], abandoned: [] }; sanitiseBeats(t); S.lastAliveAt = t;
    for (const x of led.list(tenantId, {})) {
      const k = task(x.id); if (!k) continue;
      if (x.status === "IN_PROGRESS" || x.status === "ASSIGNED") {
        if (t - (own(S.beats, x.owner) ?? 0) < olderThanMs) continue;
        if ((own(S.reassigns, x.id) ?? 0) >= L.maxReassign) { const a = abandon(x.id, "STALLED_AFTER_" + L.maxReassign + "_REASSIGNMENTS"); if (a.ok) out.abandoned.push(x.id); continue; }
        const need = kindRole(k.kind), per = perAgentLoad(), pool = ROSTER.filter(a => roleOf(a) === need && !k.owners.includes(a)).sort((a, b) => (per[a] ?? 0) - (per[b] ?? 0) || (a < b ? -1 : 1));
        let moved = false; for (const to of pool) { const r = led.reassign(tenantId, x.id, { to, reason: "STALLED_" + k.owner }); if (r.ok) { bump(x.id); S.reassigns[x.id] = (own(S.reassigns, x.id) ?? 0) + 1; S.beats[to] = t; S.counters.reassigned++; log("TASK_RECLAIMED", { id: x.id, from: k.owner, to }); out.reassigned.push({ id: x.id, from: k.owner, to, checkpoint: (own(S.checkpoints, x.id) ?? []).at(-1)?.n ?? null }); moved = true; break; } }
        if (!moved) log("TASK_STALLED_NO_TAKER", { id: x.id, owner: k.owner });
      } else if (x.status === "HANDOFF_PENDING") {
        const h = k.handoffs.find(y => y.n === k.handoff && y.status === "PENDING"); if (!h || t - Date.parse(h.at) < Math.min(olderThanMs, L.handoffStaleMs)) continue;
        const r = led.rescind(tenantId, x.id, { by: COORD, reason: "UNANSWERED_" + h.to }); if (r.ok) { bump(x.id); S.counters.rescinded++; log("HANDOFF_RESCINDED_UNANSWERED", { id: x.id, to: h.to }); out.rescinded.push({ id: x.id, to: h.to }); }
      } else if (x.status === "VERIFYING") {
        const v = own(S.verifiers, x.id); if (v && t - (own(S.beats, "verify:" + x.id) ?? 0) < Math.min(olderThanMs, L.verifyStaleMs)) continue;
        if (v) { delete S.verifiers[x.id]; S.counters.verifierChanged++; } const n = assignVerifier(x.id); if (n && n !== v) { log("VERIFIER_REPLACED", { id: x.id, from: v ?? null, to: n }); out.reverifier.push({ id: x.id, from: v ?? null, to: n }); }
      }
    }
    if (out.reassigned.length || out.rescinded.length || out.reverifier.length || out.abandoned.length) save(); return { ok: true, ...out };
  }
  function closeThread(thread) { const th = own(S.threads, thread); if (!th) return fail("THREAD_UNKNOWN"); th.frozen = true; log("THREAD_CLOSED", { thread }); save(); return { ok: true }; }      // a safety move: allowed while stopped
  const noteUncoordinated = (agent, reason) => { S.counters.uncoordinated++; log("UNCOORDINATED", { agent, reason: String(reason).slice(0, 60) }); };

  // ------------------------------------------------------------------ views
  function summary() {
    reapSubs(); const tasks = led.list(tenantId, {}), by = {}; for (const x of tasks) by[x.status] = (by[x.status] ?? 0) + 1;
    return { tenantId, loadedFrom, permanentAgents: 30, searchAgents: 5, executionAgents: 25, masterCoordinator: "ORCHESTRATION_LOGIC_NOT_AN_AGENT", tasks: by, activeSubAgents: Object.values(S.subs).filter(s => s.status === "ACTIVE").length, frozenThreads: Object.values(S.threads).filter(t => t.frozen).length, pendingMessages: Object.values(S.mail).reduce((a, b) => a + b.length, 0), escalationsWaiting: (own(S.mail, COORD) ?? []).length, counters: { ...S.counters }, auditOk: audit.verify().ok, stopped: stopped() };
  }
  const isParticipant = (taskId, agentId) => { const k = task(taskId); return Boolean(k) && participants(k).has(agentId); };

  // ------------------------------------------------------------------ identity-bound handles
  const handles = new Map();
  function connect(agentId) {
    if (!rosterOk(agentId)) return null;
    if (handles.has(agentId)) return handles.get(agentId);
    const h = Object.freeze({
      id: agentId,
      send: m => send(agentId, m ?? {}), inbox: o => inbox(agentId, o), ack: id => ack(agentId, id),
      register: o => register(agentId, o ?? {}), start: id => start(agentId, id), delegate: (id, o) => delegate(agentId, id, o ?? {}), withdrawDelegation: (id, why) => withdrawDelegation(agentId, id, why), accept: (id, rec) => accept(agentId, id, rec), reject: (id, why) => reject(agentId, id, why),
      complete: (id, hash) => complete(agentId, id, hash), verify: (id, o) => verify(agentId, id, o ?? {}), nextToVerify: o => nextToVerify(agentId, o ?? {}),
      checkpoint: (id, st) => checkpoint(agentId, id, st), resume: id => resume(agentId, id), heartbeat: () => { if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); heartbeat(agentId); return { ok: true }; },
      spawnSub: o => spawnSub(agentId, o ?? {}), killSub: id => killSub(agentId, id),
      subHandle: subId => { const s = subOf(subId); if (!s || s.parent !== agentId) return null; return Object.freeze({ id: subId, send: m => send(subId, m ?? {}), inbox: o => inbox(subId, o), step: n => subStep(subId, n), finish: r => finishSub(subId, r) }); }
    });
    handles.set(agentId, h); return h;
  }
  return { connect, recover, reclaimStalled, closeThread, abandon, coordinatorInbox, coordinatorAck, assignVerifier, noteUncoordinated, isParticipant, summary, setOnVerified, verifierOf: id => own(S.verifiers, id) ?? null, auditVerify: () => audit.verify(), auditEntries: () => audit.entries(), ledger: led, limits: L };
}
