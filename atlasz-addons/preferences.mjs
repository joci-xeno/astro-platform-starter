// Preference and history store (85-capability audit A11 Personalisation / preference learning).
// A small typed preference schema, an append-only change history and a LEARNING path that can only PROPOSE:
//   * set / reset / forget  - OWNER only. Agents (SEARCH-n / EXECUTION-n) and SYSTEM can never change a preference.
//   * propose / confirm     - anyone may propose a value with a reason; only the OWNER's confirm applies it. Proposals expire and are capped.
//   * recordChoice          - counts the owner's own choices (e.g. which suggestion sources they dismiss) when privacy.rememberHistory is true; counters hold labels only, never content.
//   * learn                 - turns repeated choices into PROPOSALS (never into silent changes), so nothing is learned without the owner seeing and confirming it.
//   * export / forgetAll    - the owner can read everything stored about them and delete it.
// Unknown keys and out-of-range values are refused. Tenant-scoped. Texts are redacted for secrets.
import crypto from "node:crypto";
import { createStore, clone } from "./business/store.mjs";
import { redactSecrets } from "./text-compare.mjs";

export const SCHEMA = Object.freeze({
  "suggestions.enabled": { type: "boolean", default: true, doc: "Show proactive suggestions at all." },
  "suggestions.maxPerDay": { type: "integer", min: 0, max: 20, default: 5, doc: "Upper bound of suggestions shown per day." },
  "suggestions.snoozeDays": { type: "integer", min: 1, max: 30, default: 7, doc: "How long a dismissed suggestion stays hidden." },
  "suggestions.mutedSources": { type: "idSet", default: [], doc: "Suggestion sources that are never shown." },
  "ui.detailLevel": { type: "enum", values: ["brief", "normal", "detailed"], default: "normal", doc: "How much detail answers and reports carry." },
  "ui.language": { type: "enum", values: ["hu", "en"], default: "hu", doc: "Preferred language of owner-facing text." },
  "privacy.rememberHistory": { type: "boolean", default: true, doc: "Count the owner's choices so preferences can be proposed. Turning it off stops counting and clears counters." },
  "learning.confirmFirst": { type: "boolean", default: true, doc: "Learned changes are only ever proposals (cannot be turned off here: stays true)." },
});
export const LIMITS = Object.freeze({ maxProposals: 50, proposalTtlMs: 14 * 24 * 3600 * 1000, maxHistory: 1000, maxCounters: 200, maxIdSet: 20, learnThreshold: 3, maxReason: 300, maxLabel: 40 });
const ID = /^[a-z][a-z0-9._-]{0,39}$/, ACTOR = /^(OWNER|SYSTEM|(?:SEARCH|EXECUTION)-\d{1,2})$/, TENANT = /^[A-Za-z0-9._-]{1,64}$/;
const rid = p => p + crypto.randomBytes(5).toString("hex");

/** Validate a value for a key. Returns {ok, value} (normalised) or {ok:false, reason}. */
export function validatePreference(key, value) {
  const s = Object.hasOwn(SCHEMA, key) ? SCHEMA[key] : null; if (!s) return { ok: false, reason: "UNKNOWN_PREFERENCE" };
  if (s.type === "boolean") return typeof value === "boolean" ? { ok: true, value } : { ok: false, reason: "VALUE_MUST_BE_BOOLEAN" };
  if (s.type === "integer") return Number.isInteger(value) && value >= s.min && value <= s.max ? { ok: true, value } : { ok: false, reason: "VALUE_OUT_OF_RANGE" };
  if (s.type === "enum") return s.values.includes(value) ? { ok: true, value } : { ok: false, reason: "VALUE_NOT_ALLOWED" };
  if (s.type === "idSet") {
    if (!Array.isArray(value) || value.length > LIMITS.maxIdSet || !value.every(v => typeof v === "string" && ID.test(v))) return { ok: false, reason: "VALUE_MUST_BE_A_LIST_OF_IDS" };
    return { ok: true, value: [...new Set(value)].sort() };
  }
  return { ok: false, reason: "SCHEMA_ERROR" };
}

export function createPreferences({ file = null, now = () => Date.now() } = {}) {
  const store = createStore({ file, init: () => ({ tenants: {} }), mode: 0o600 }), d = store.data;
  const T = tenantId => { if (typeof tenantId !== "string" || !TENANT.test(tenantId)) throw new Error("TENANT_INVALID"); return (d.tenants[tenantId] ??= { values: {}, history: [], proposals: [], counters: {} }); };
  const peek = tenantId => (typeof tenantId === "string" && TENANT.test(tenantId) ? d.tenants[tenantId] ?? null : null);
  const actorOk = a => typeof a === "string" && ACTOR.test(a);
  const log = (t, e) => { t.history.push({ at: new Date(now()).toISOString(), ...e }); if (t.history.length > LIMITS.maxHistory) t.history.splice(0, t.history.length - LIMITS.maxHistory); };

  const get = (tenantId, key) => { if (!Object.hasOwn(SCHEMA, key)) return { ok: false, reason: "UNKNOWN_PREFERENCE" }; const t = peek(tenantId); const set = t && Object.hasOwn(t.values, key); return { ok: true, key, value: clone(set ? t.values[key] : SCHEMA[key].default), isDefault: !set }; };
  const all = tenantId => Object.fromEntries(Object.keys(SCHEMA).map(k => { const g = get(tenantId, k); return [k, { value: g.value, isDefault: g.isDefault, doc: SCHEMA[k].doc }]; }));

  function applyValue(t, key, value, by, how) {
    const v = validatePreference(key, value); if (!v.ok) return v;
    if (key === "learning.confirmFirst" && v.value !== true) return { ok: false, reason: "LEARNING_ALWAYS_REQUIRES_CONFIRMATION" };
    const before = Object.hasOwn(t.values, key) ? t.values[key] : SCHEMA[key].default;
    t.values[key] = v.value; if (key === "privacy.rememberHistory" && v.value === false) t.counters = {};
    log(t, { type: how, key, from: before, to: v.value, by }); store.save(); return { ok: true, key, value: v.value };
  }
  function set(tenantId, key, value, { actor } = {}) {
    if (actor !== "OWNER") return { ok: false, reason: "ONLY_OWNER_MAY_SET_PREFERENCES" };
    return applyValue(T(tenantId), key, value, "OWNER", "SET");
  }
  function reset(tenantId, key, { actor } = {}) {
    if (actor !== "OWNER") return { ok: false, reason: "ONLY_OWNER_MAY_RESET_PREFERENCES" };
    if (!Object.hasOwn(SCHEMA, key)) return { ok: false, reason: "UNKNOWN_PREFERENCE" };
    const t = T(tenantId); if (!Object.hasOwn(t.values, key)) return { ok: true, key, already: true };
    const from = t.values[key]; delete t.values[key]; log(t, { type: "RESET", key, from, to: SCHEMA[key].default, by: "OWNER" }); store.save(); return { ok: true, key };
  }
  function propose(tenantId, key, value, { actor, reason = "" } = {}) {
    if (!actorOk(actor)) return { ok: false, reason: "ACTOR_INVALID" };
    const v = validatePreference(key, value); if (!v.ok) return v;
    if (key === "learning.confirmFirst") return { ok: false, reason: "NOT_PROPOSABLE" };
    if (typeof reason !== "string" || reason.length > LIMITS.maxReason) return { ok: false, reason: "REASON_INVALID" };
    const t = T(tenantId), t0 = now(); t.proposals = t.proposals.filter(p => p.status !== "PENDING" || t0 - p.createdAtMs <= LIMITS.proposalTtlMs || (p.status = "EXPIRED", true));
    const same = t.proposals.find(p => p.status === "PENDING" && p.key === key && JSON.stringify(p.value) === JSON.stringify(v.value)); if (same) return { ok: true, id: same.id, duplicate: true };
    const cur = get(tenantId, key).value; if (JSON.stringify(cur) === JSON.stringify(v.value)) return { ok: false, reason: "ALREADY_SET" };
    if (t.proposals.filter(p => p.status === "PENDING").length >= LIMITS.maxProposals) return { ok: false, reason: "TOO_MANY_PENDING_PROPOSALS" };
    const p = { id: rid("pp"), key, value: v.value, reason: redactSecrets(reason), by: actor, status: "PENDING", createdAtMs: t0, createdAt: new Date(t0).toISOString() };
    t.proposals.push(p); log(t, { type: "PROPOSED", key, to: v.value, by: actor }); store.save(); return { ok: true, id: p.id };
  }
  function decide(tenantId, id, actor, accept) {
    if (actor !== "OWNER") return { ok: false, reason: "ONLY_OWNER_MAY_DECIDE" };
    const t = T(tenantId), p = t.proposals.find(x => x.id === id); if (!p) return { ok: false, reason: "PROPOSAL_NOT_FOUND" };
    if (p.status !== "PENDING") return { ok: false, reason: "NOT_PENDING:" + p.status };
    if (now() - p.createdAtMs > LIMITS.proposalTtlMs) { p.status = "EXPIRED"; store.save(); return { ok: false, reason: "NOT_PENDING:EXPIRED" }; }
    if (!accept) { p.status = "REJECTED"; log(t, { type: "PROPOSAL_REJECTED", key: p.key, by: "OWNER" }); store.save(); return { ok: true, status: "REJECTED" }; }
    const r = applyValue(t, p.key, p.value, "OWNER", "CONFIRMED_PROPOSAL"); if (!r.ok) return r; p.status = "ACCEPTED"; store.save(); return { ok: true, status: "ACCEPTED", key: p.key, value: p.value };
  }
  const confirm = (tenantId, id, { actor } = {}) => decide(tenantId, id, actor, true), rejectProposal = (tenantId, id, { actor } = {}) => decide(tenantId, id, actor, false);
  const proposals = (tenantId, { status = null } = {}) => (peek(tenantId)?.proposals ?? []).filter(p => !status || p.status === status).map(({ createdAtMs, ...p }) => clone(p));

  /** Count one choice of the OWNER (labels only). Ignored when privacy.rememberHistory is off. */
  function recordChoice(tenantId, { kind, subject, actor } = {}) {
    if (actor !== "OWNER") return { ok: false, reason: "ONLY_OWNER_CHOICES_ARE_RECORDED" };
    if (typeof kind !== "string" || !ID.test(kind) || typeof subject !== "string" || !ID.test(subject)) return { ok: false, reason: "KIND_AND_SUBJECT_MUST_BE_IDS" };
    if (!get(tenantId, "privacy.rememberHistory").value) return { ok: true, recorded: false };
    const t = T(tenantId), k = kind + ":" + subject; if (!Object.hasOwn(t.counters, k) && Object.keys(t.counters).length >= LIMITS.maxCounters) return { ok: false, reason: "TOO_MANY_COUNTERS" };
    t.counters[k] = (t.counters[k] ?? 0) + 1; store.save(); return { ok: true, recorded: true, count: t.counters[k] };
  }
  /** Turn repeated choices into proposals. Currently: dismissed:<source> x threshold -> propose muting that source. Never changes a preference by itself. */
  function learn(tenantId) {
    if (!get(tenantId, "privacy.rememberHistory").value) return { ok: true, proposed: [], note: "History is off." };
    const t = peek(tenantId); if (!t) return { ok: true, proposed: [] };
    const muted = new Set(get(tenantId, "suggestions.mutedSources").value), out = [];
    for (const [k, n] of Object.entries(t.counters)) {
      if (!k.startsWith("dismissed:") || n < LIMITS.learnThreshold) continue; const src = k.slice("dismissed:".length);   // an already-muted source yields ALREADY_SET in propose()
      const r = propose(tenantId, "suggestions.mutedSources", [...muted, src].slice(0, LIMITS.maxIdSet), { actor: "SYSTEM", reason: `You dismissed "${src}" suggestions ${n} times.` });
      if (r.ok) out.push({ source: src, proposalId: r.id });
    }
    return { ok: true, proposed: out };
  }
  const history = (tenantId, limit = 50) => clone((peek(tenantId)?.history ?? []).slice(-Math.max(1, Math.min(200, limit))));
  const exportAll = tenantId => { const t = peek(tenantId); return { ok: true, preferences: all(tenantId), history: t ? clone(t.history) : [], counters: t ? clone(t.counters) : {}, proposals: proposals(tenantId) }; };
  function forgetAll(tenantId, { actor } = {}) {
    if (actor !== "OWNER") return { ok: false, reason: "ONLY_OWNER_MAY_FORGET" };
    if (typeof tenantId !== "string" || !TENANT.test(tenantId)) return { ok: false, reason: "TENANT_INVALID" };
    const had = Boolean(d.tenants[tenantId]); delete d.tenants[tenantId]; store.save(); return { ok: true, deleted: had };
  }
  return { get, all, set, reset, propose, confirm, rejectProposal, proposals, recordChoice, learn, history, exportAll, forgetAll, schema: SCHEMA, limits: LIMITS };
}
