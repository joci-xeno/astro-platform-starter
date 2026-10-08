// Task ownership, dependency order, verified handoffs and duplicate-work detection across the fixed 30 agents (85-capability audit C03 Multi-Agent Coordination: the handoff-verification slice).
// It is a LEDGER used by the dispatcher/orchestrator; it creates no agents, runs nothing and has no network. Every rule fails closed:
//   * Only the 30 roster ids (SEARCH-1..5, EXECUTION-1..25) can own, hand off, accept or verify; any other spelling is refused.
//   * Duplicate work: the same {kind, payload} fingerprint cannot be registered again while an earlier task with it is open or DONE (FAILED / CANCELLED ones may be retried).
//   * Dependencies: a task cannot start before everything it depends on is DONE; unknown dependencies and cycles are refused.
//   * Handoff contract: the sender must own the task; the artifacts' hashes are fixed in the contract; only the named receiver may accept, and only by presenting exactly those hashes.
//   * Completion needs an independent verifier: a roster agent that is neither the owner nor any previous owner. Nothing becomes DONE without an ACCEPT from it.
//   * Concurrency: at most `perAgentOpen` open tasks per agent and `maxOpen` in total. The kill switch / Safe Mode (isStopped) freezes every mutation; a throwing check counts as stopped.
import crypto from "node:crypto";
import { createStore, clone } from "./business/store.mjs";
import { AGENT_ID_RE } from "./agent-tool-policy.mjs";
import { okName, own } from "./safe-keys.mjs";

export const LIMITS = Object.freeze({ perAgentOpen: 3, maxOpen: 200, maxTasks: 5000, maxDeps: 10, maxArtifacts: 10, maxSummary: 300, maxEvents: 2000, maxPayloadChars: 20000 });
const OPEN = new Set(["ASSIGNED", "IN_PROGRESS", "HANDOFF_PENDING", "VERIFYING"]), RETRYABLE = new Set(["FAILED", "CANCELLED"]);
const KIND = /^[a-z][a-z0-9._-]{0,39}$/, TASK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/, TENANT = /^[A-Za-z0-9._-]{1,64}$/, HASH = /^[0-9a-f]{64}$/;
const rosterOk = a => typeof a === "string" && AGENT_ID_RE.test(a);
const canon = v => (Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v));
// Duplicate detection compares MEANING, not spelling: strings are NFKC-normalised, trimmed, whitespace-collapsed and case-folded; undefined/NaN/Infinity fields count as absent/null; key order is irrelevant.
const norm = v => (typeof v === "string" ? v.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase() : typeof v === "number" ? (Number.isFinite(v) ? v : null) : Array.isArray(v) ? v.map(x => norm(x === undefined ? null : x)) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).filter(k => v[k] !== undefined).map(k => [k.normalize("NFKC").trim().toLowerCase(), norm(v[k])])) : v);
export const fingerprint = (kind, payload) => crypto.createHash("sha256").update(kind + "\0" + canon(norm(payload ?? null))).digest("hex");

export function createHandoffLedger({ file = null, isStopped = () => false, now = () => Date.now(), limits = {} } = {}) {
  const L = { ...LIMITS, ...limits }, store = createStore({ file, init: () => ({ tenants: {} }), mode: 0o600 }), d = store.data;
  const T = tenantId => { if (typeof tenantId !== "string" || !okName(TENANT, tenantId)) throw new Error("TENANT_INVALID"); return (d.tenants[tenantId] ??= { tasks: {}, events: [], seq: 0 }); };
  const peek = tenantId => (typeof tenantId === "string" && okName(TENANT, tenantId) ? own(d.tenants, tenantId) ?? null : null);
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };
  const ev = (t, task, type, by, extra = {}) => { t.events.push({ n: ++t.seq, at: new Date(now()).toISOString(), task, type, by, ...extra }); if (t.events.length > L.maxEvents) t.events.splice(0, t.events.length - L.maxEvents); };
  const guard = () => (stopped() ? { ok: false, reason: "OWNER_STOP_OR_SAFE_MODE_ACTIVE" } : null);
  const openOf = (t, agent) => Object.values(t.tasks).filter(x => x.owner === agent && OPEN.has(x.status)).length;
  const find = (tenantId, id) => { const t = peek(tenantId); return t && Object.hasOwn(t.tasks, id) ? t.tasks[id] : null; };

  function register(tenantId, { id, kind, payload = null, owner, dependsOn = [] } = {}) {
    const g = guard(); if (g) return g;
    if (typeof id !== "string" || !TASK.test(id)) return { ok: false, reason: "TASK_ID_INVALID" }; if (typeof kind !== "string" || !KIND.test(kind)) return { ok: false, reason: "KIND_INVALID" };
    if (!rosterOk(owner)) return { ok: false, reason: "OWNER_NOT_IN_ROSTER" };
    let size; try { size = canon(payload).length; } catch { return { ok: false, reason: "PAYLOAD_INVALID" } } if (size > L.maxPayloadChars) return { ok: false, reason: "PAYLOAD_TOO_LARGE" };
    if (!Array.isArray(dependsOn) || dependsOn.length > L.maxDeps || !dependsOn.every(x => typeof x === "string" && TASK.test(x))) return { ok: false, reason: "DEPENDENCIES_INVALID" };
    const t = T(tenantId); if (Object.hasOwn(t.tasks, id)) return { ok: false, reason: "TASK_ID_EXISTS" }; if (Object.keys(t.tasks).length >= L.maxTasks) {                       // make room by archiving the oldest VERIFIED-DONE tasks nothing depends on; open, failed and referenced tasks are never dropped
      const ref = new Set(Object.values(t.tasks).flatMap(x => x.dependsOn ?? [])), old = Object.values(t.tasks).filter(x => x.status === "DONE" && !ref.has(x.id)).sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1));
      for (const x of old.slice(0, Math.max(1, Math.ceil(L.maxTasks / 10)))) delete t.tasks[x.id];
      if (Object.keys(t.tasks).length >= L.maxTasks) return { ok: false, reason: "TOO_MANY_TASKS" };
    }
    const deps = [...new Set(dependsOn)]; if (deps.includes(id)) return { ok: false, reason: "DEPENDENCY_CYCLE" }; for (const x of deps) if (!Object.hasOwn(t.tasks, x)) return { ok: false, reason: "UNKNOWN_DEPENDENCY:" + x };
    const fp = fingerprint(kind, payload), dup = Object.values(t.tasks).find(x => x.fingerprint === fp && !RETRYABLE.has(x.status)); if (dup) return { ok: false, reason: "DUPLICATE_WORK", existing: dup.id, existingStatus: dup.status };
    if (Object.values(t.tasks).filter(x => OPEN.has(x.status)).length >= L.maxOpen) return { ok: false, reason: "TOO_MANY_OPEN_TASKS" }; if (openOf(t, owner) >= L.perAgentOpen) return { ok: false, reason: "AGENT_AT_CONCURRENCY_LIMIT" };
    t.tasks[id] = { id, kind, fingerprint: fp, owner, owners: [owner], dependsOn: deps, status: "ASSIGNED", handoff: null, handoffs: [], resultHash: null, rejections: 0, createdAt: new Date(now()).toISOString() };
    ev(t, id, "REGISTERED", owner, { kind }); store.save(); return { ok: true, id, fingerprint: fp };
  }
  function start(tenantId, id, { agent } = {}) {
    const g = guard(); if (g) return g; const k = find(tenantId, id); if (!k) return { ok: false, reason: "TASK_NOT_FOUND" };
    if (agent !== k.owner) return { ok: false, reason: "NOT_THE_OWNER" }; if (k.status !== "ASSIGNED") return { ok: false, reason: "BAD_STATE:" + k.status };
    const t = peek(tenantId), waiting = k.dependsOn.filter(x => t.tasks[x]?.status !== "DONE"); if (waiting.length) return { ok: false, reason: "DEPENDENCIES_NOT_DONE", waiting };
    k.status = "IN_PROGRESS"; ev(t, id, "STARTED", agent); store.save(); return { ok: true, id };
  }
  function handoff(tenantId, id, { from, to, artifacts = [], summary = "" } = {}) {
    const g = guard(); if (g) return g; const k = find(tenantId, id); if (!k) return { ok: false, reason: "TASK_NOT_FOUND" };
    if (!rosterOk(from) || !rosterOk(to)) return { ok: false, reason: "AGENT_NOT_IN_ROSTER" }; if (from !== k.owner) return { ok: false, reason: "NOT_THE_OWNER" }; if (from === to) return { ok: false, reason: "HANDOFF_TO_SELF" };
    if (k.status !== "IN_PROGRESS") return { ok: false, reason: "BAD_STATE:" + k.status };
    if (!Array.isArray(artifacts) || !artifacts.length || artifacts.length > L.maxArtifacts || !artifacts.every(a => a && typeof a.name === "string" && TASK.test(a.name) && typeof a.sha256 === "string" && HASH.test(a.sha256)) || new Set(artifacts.map(a => a.name)).size !== artifacts.length) return { ok: false, reason: "ARTIFACTS_INVALID" };
    if (typeof summary !== "string" || summary.length > L.maxSummary) return { ok: false, reason: "SUMMARY_INVALID" };
    const t = peek(tenantId); if (openOf(t, to) >= L.perAgentOpen) return { ok: false, reason: "RECEIVER_AT_CONCURRENCY_LIMIT" };
    const h = { n: k.handoffs.length + 1, from, to, artifacts: artifacts.map(a => ({ name: a.name, sha256: a.sha256 })).sort((a, b) => (a.name < b.name ? -1 : 1)), summary, at: new Date(now()).toISOString(), status: "PENDING" };
    h.contract = crypto.createHash("sha256").update(canon({ task: id, from, to, artifacts: h.artifacts })).digest("hex"); k.handoffs.push(h); k.handoff = h.n; k.status = "HANDOFF_PENDING";
    ev(t, id, "HANDOFF_OFFERED", from, { to, contract: h.contract }); store.save(); return { ok: true, id, handoff: h.n, contract: h.contract };
  }
  const pending = k => (k.status === "HANDOFF_PENDING" ? k.handoffs.find(x => x.n === k.handoff && x.status === "PENDING") : null);
  function accept(tenantId, id, { agent, received = [] } = {}) {
    const g = guard(); if (g) return g; const k = find(tenantId, id); if (!k) return { ok: false, reason: "TASK_NOT_FOUND" }; const h = pending(k); if (!h) return { ok: false, reason: "NO_PENDING_HANDOFF" };
    if (agent !== h.to) return { ok: false, reason: "NOT_THE_RECEIVER" }; const t = peek(tenantId);
    const got = Array.isArray(received) ? received.filter(a => a && typeof a.name === "string" && typeof a.sha256 === "string").map(a => a.name + ":" + a.sha256).sort() : [], want = h.artifacts.map(a => a.name + ":" + a.sha256).sort();
    if (!Array.isArray(received) || got.length !== received.length || got.join("|") !== want.join("|")) return { ok: false, reason: "HANDOFF_CONTENT_MISMATCH" };
    if (openOf(t, agent) >= L.perAgentOpen) return { ok: false, reason: "AGENT_AT_CONCURRENCY_LIMIT" };
    h.status = "ACCEPTED"; k.owner = agent; if (!k.owners.includes(agent)) k.owners.push(agent); k.status = "IN_PROGRESS"; k.handoff = null; ev(t, id, "HANDOFF_ACCEPTED", agent, { from: h.from, contract: h.contract }); store.save(); return { ok: true, id, owner: agent };
  }
  function rejectHandoff(tenantId, id, { agent, reason = "" } = {}) {
    const g = guard(); if (g) return g; const k = find(tenantId, id); if (!k) return { ok: false, reason: "TASK_NOT_FOUND" }; const h = pending(k); if (!h) return { ok: false, reason: "NO_PENDING_HANDOFF" };
    if (agent !== h.to) return { ok: false, reason: "NOT_THE_RECEIVER" }; h.status = "REJECTED"; k.status = "IN_PROGRESS"; k.handoff = null; ev(peek(tenantId), id, "HANDOFF_REJECTED", agent, { from: h.from, reason: String(reason).slice(0, 100) }); store.save(); return { ok: true, id, owner: k.owner };
  }
  function complete(tenantId, id, { agent, resultSha256 } = {}) {
    const g = guard(); if (g) return g; const k = find(tenantId, id); if (!k) return { ok: false, reason: "TASK_NOT_FOUND" }; if (agent !== k.owner) return { ok: false, reason: "NOT_THE_OWNER" };
    if (k.status !== "IN_PROGRESS") return { ok: false, reason: "BAD_STATE:" + k.status }; if (typeof resultSha256 !== "string" || !HASH.test(resultSha256)) return { ok: false, reason: "RESULT_HASH_REQUIRED" };
    k.resultHash = resultSha256; k.status = "VERIFYING"; ev(peek(tenantId), id, "SUBMITTED_FOR_VERIFICATION", agent, { resultSha256 }); store.save(); return { ok: true, id, status: "VERIFYING" };
  }
  function verify(tenantId, id, { verifier, decision, resultSha256 } = {}) {
    const g = guard(); if (g) return g; const k = find(tenantId, id); if (!k) return { ok: false, reason: "TASK_NOT_FOUND" }; if (k.status !== "VERIFYING") return { ok: false, reason: "BAD_STATE:" + k.status };
    if (!rosterOk(verifier)) return { ok: false, reason: "VERIFIER_NOT_IN_ROSTER" }; if (k.owners.includes(verifier)) return { ok: false, reason: "VERIFIER_NOT_INDEPENDENT" };
    if (decision !== "ACCEPT" && decision !== "REJECT") return { ok: false, reason: "DECISION_INVALID" }; if (resultSha256 !== k.resultHash) return { ok: false, reason: "VERIFIED_CONTENT_MISMATCH" };
    const t = peek(tenantId); if (decision === "ACCEPT") { k.status = "DONE"; ev(t, id, "VERIFIED_DONE", verifier); } else { k.status = "IN_PROGRESS"; k.rejections++; k.resultHash = null; ev(t, id, "VERIFICATION_REJECTED", verifier); }
    store.save(); return { ok: true, id, status: k.status };
  }
  function close(tenantId, id, { agent, status, reason = "" } = {}) {                     // the owner can mark an unfinished task FAILED or CANCELLED (frees its fingerprint for a retry)
    const g = guard(); if (g) return g; const k = find(tenantId, id); if (!k) return { ok: false, reason: "TASK_NOT_FOUND" }; if (agent !== k.owner) return { ok: false, reason: "NOT_THE_OWNER" };
    if (status !== "FAILED" && status !== "CANCELLED") return { ok: false, reason: "STATUS_INVALID" }; if (!OPEN.has(k.status)) return { ok: false, reason: "BAD_STATE:" + k.status };
    const h = pending(k); if (h) h.status = "WITHDRAWN"; k.status = status; k.handoff = null; ev(peek(tenantId), id, status, agent, { reason: String(reason).slice(0, 100) }); store.save(); return { ok: true, id, status };
  }
  const get = (tenantId, id) => { const k = find(tenantId, id); return k ? { ok: true, task: clone(k) } : { ok: false, reason: "TASK_NOT_FOUND" }; };
  const list = (tenantId, { status = null } = {}) => Object.values(peek(tenantId)?.tasks ?? {}).filter(k => !status || k.status === status).map(k => ({ id: k.id, kind: k.kind, owner: k.owner, status: k.status, dependsOn: [...k.dependsOn], handoffs: k.handoffs.length, rejections: k.rejections }));
  const events = (tenantId, limit = 100) => clone((peek(tenantId)?.events ?? []).slice(-Math.max(1, Math.min(500, Number.isInteger(limit) ? limit : 100))));
  const load = tenantId => { const t = peek(tenantId), perAgent = {}; for (const k of Object.values(t?.tasks ?? {})) if (OPEN.has(k.status)) perAgent[k.owner] = (perAgent[k.owner] ?? 0) + 1; return { ok: true, open: Object.values(perAgent).reduce((a, b) => a + b, 0), perAgent, limits: { perAgentOpen: L.perAgentOpen, maxOpen: L.maxOpen } }; };
  return { register, start, handoff, accept, rejectHandoff, complete, verify, close, get, list, events, load, limits: L };
}
