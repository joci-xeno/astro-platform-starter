// Proactive suggestions (85-capability audit A08 Proactive suggestions) and the cross-source adapters that feed them (P20).
// A suggestion is TEXT ABOUT SOMETHING THAT NEEDS THE OWNER'S ATTENTION. It carries no action, no callback and no payload that can be executed:
// this module cannot approve, send, install, activate or change anything. The owner can only dismiss (snooze) or acknowledge a suggestion; both just hide it.
//   * Suppression: suggestions.enabled=false hides everything; suggestions.mutedSources hides a source; a dismissed/acknowledged key is snoozed for suggestions.snoozeDays;
//     at most suggestions.maxPerDay NEW keys are shown per UTC day (a key already shown today may be listed again without using the cap).
//   * Dismissals and acknowledgements are counted through the preference store (labels only) so repeated dismissals can be PROPOSED as a mute (owner confirms).
//   * Candidates are untrusted text: control characters are stripped, secrets redacted, lengths capped, malformed candidates dropped.
import crypto from "node:crypto";
import { createStore } from "./business/store.mjs";
import { redactSecrets } from "./text-compare.mjs";
import { okName, own } from "./safe-keys.mjs";

export const LIMITS = Object.freeze({ maxCandidates: 100, maxInput: 1000, maxKnown: 200, keepDays: 7, keyChars: 80, titleChars: 120, detailChars: 300, maxShownHardCap: 20 });
const KEY = /^[a-z0-9][a-z0-9:._-]{0,79}$/, SOURCE = /^[a-z][a-z0-9._-]{0,39}$/, TENANT = /^[A-Za-z0-9._-]{1,64}$/, DAY = 86400000;
const clean = (v, n) => redactSecrets(String(v).replace(/[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu, "").replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim()).slice(0, n);
const dayOf = ms => new Date(ms).toISOString().slice(0, 10);

/** Validate and normalise one candidate; returns null when malformed. */
export function normalizeCandidate(c) {
  if (!c) return null;                                                 // non-objects and arrays have no usable .key and fail the checks below
  const long = typeof c.key === "string" && c.key.length > 80 && c.key.length <= 400 && /^[a-z0-9][a-z0-9:._-]*$/.test(c.key);      // a long id is shortened with a hash of the whole key (distinct ids stay distinct) instead of being dropped
  const key = long ? c.key.slice(0, 70) + ".h" + crypto.createHash("sha256").update(c.key).digest("hex").slice(0, 8) : c.key;
  if (typeof key !== "string" || !KEY.test(key) || typeof c.source !== "string" || !SOURCE.test(c.source) || typeof c.title !== "string") return null;
  const title = clean(c.title, LIMITS.titleChars); if (!title || !/[\p{L}\p{N}]/u.test(title.replace(/[\u2800\u3164\uffa0]/g, ""))) return null;
  const priority = Number.isInteger(c.priority) && c.priority >= 1 && c.priority <= 5 ? c.priority : 3;
  return { key, source: c.source, title, detail: typeof c.detail === "string" ? clean(c.detail, LIMITS.detailChars) : "", priority, where: typeof c.where === "string" && /^[a-z][a-z0-9-]{0,30}$/.test(c.where) ? c.where : null };
}

export function createSuggestions({ file = null, prefs, now = () => Date.now() } = {}) {
  if (!prefs || typeof prefs.get !== "function" || typeof prefs.recordChoice !== "function") throw new Error("PREFERENCES_REQUIRED");
  const store = createStore({ file, init: () => ({ tenants: {} }), mode: 0o600 }), d = store.data;
  const T = tenantId => { if (typeof tenantId !== "string" || !okName(TENANT, tenantId)) throw new Error("TENANT_INVALID"); return (d.tenants[tenantId] ??= { days: {}, snoozed: {}, known: {} }); };
  const pv = (tenantId, key) => prefs.get(tenantId, key).value;
  function prune(t, t0) {
    for (const [k, until] of Object.entries(t.snoozed)) if (until <= t0) delete t.snoozed[k];
    const keep = new Set(Array.from({ length: LIMITS.keepDays }, (_, i) => dayOf(t0 - i * DAY))); for (const k of Object.keys(t.days)) if (!keep.has(k)) delete t.days[k];
    const ks = Object.keys(t.known); if (ks.length > LIMITS.maxKnown) for (const k of ks.sort((a, b) => t.known[a].seenMs - t.known[b].seenMs).slice(0, ks.length - LIMITS.maxKnown)) delete t.known[k];
  }
  /** Decide which candidates are shown now. Pure with respect to the world: only this module's own bookkeeping changes. */
  function offer(tenantId, candidates) {
    const t = T(tenantId), t0 = now(); prune(t, t0);
    const sup = { invalid: 0, duplicate: 0, disabled: 0, muted: 0, snoozed: 0, dailyLimit: 0, overInput: 0 };
    const list = Array.isArray(candidates) ? candidates : []; sup.overInput = Math.max(0, list.length - LIMITS.maxInput);
    const byKey = new Map(); for (let i = 0; i < Math.min(list.length, LIMITS.maxInput); i++) {
      let c = null; try { c = normalizeCandidate(list[i]); } catch { c = null; }                 // a hostile candidate (throwing getter, odd prototype) is just invalid
      if (!c) { sup.invalid++; continue; }
      const prev = byKey.get(c.key); if (prev) { sup.duplicate++; if (c.priority > prev.priority) byKey.set(c.key, c); continue; }      // for duplicates the highest priority wins, not the first one
      byKey.set(c.key, c);
    }
    const ok = [...byKey.values()];
    if (!pv(tenantId, "suggestions.enabled")) { sup.disabled = ok.length; return { ok: true, shown: [], suppressed: sup, note: "Suggestions are turned off in the preferences." }; }
    const muted = new Set(pv(tenantId, "suggestions.mutedSources")), cap = Math.min(LIMITS.maxShownHardCap, pv(tenantId, "suggestions.maxPerDay")), today = (t.days[dayOf(t0)] ??= { shown: [] }), shownToday = new Set(today.shown);
    // Rank ALL valid candidates before anything is cut: priority first, then the items shown on fewer of the previous days (so a long tail rotates in instead of the same alphabetical few winning every day), then key.
    const prior = new Map(); for (const [day, v] of Object.entries(t.days)) if (day !== dayOf(t0)) for (const k of v?.shown ?? []) prior.set(k, (prior.get(k) ?? 0) + 1);
    ok.sort((a, b) => b.priority - a.priority || (prior.get(a.key) ?? 0) - (prior.get(b.key) ?? 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    today.urgent ??= []; today.urgent4 ??= []; const urgentToday = new Set(today.urgent), urgent4Today = new Set(today.urgent4);
    const shown = []; let newCount = shownToday.size - urgentToday.size - urgent4Today.size, urgentCount = urgentToday.size, urgent4Count = urgent4Today.size;     // priority 4-5 items (approvals, workflows needing review, quarantined plugins) (e.g. waiting approvals) have their own allowance and are never starved by lower priorities shown earlier in the day
    for (const c of ok) {
      if (muted.has(c.source)) { sup.muted++; continue; }
      if (Object.hasOwn(t.snoozed, c.key)) { sup.snoozed++; continue; }               // prune() above already removed every snooze that has ended
      if (!shownToday.has(c.key)) {
        if (c.priority >= 5) { if (urgentCount >= LIMITS.maxShownHardCap) { sup.dailyLimit++; continue; } urgentCount++; today.urgent.push(c.key); }
        else if (c.priority === 4) { if (urgent4Count >= LIMITS.maxShownHardCap) { sup.dailyLimit++; continue; } urgent4Count++; today.urgent4.push(c.key); }      // priority 4 has its own allowance too: a flood of priority 5 cannot starve it
        else { if (newCount >= cap) { sup.dailyLimit++; continue; } newCount++; }
        today.shown.push(c.key); shownToday.add(c.key);
      }
      t.known[c.key] = { source: c.source, seenMs: t0 }; shown.push({ ...c, canAct: false });
    }
    store.save(); return { ok: true, shown, suppressed: sup, note: "Suggestions only point at things that need you; none of them does anything by itself." };
  }
  function settle(tenantId, key, kind, actor) {
    if (actor !== "OWNER") return { ok: false, reason: "ONLY_OWNER_MAY_" + kind.toUpperCase() };
    if (typeof key !== "string" || !KEY.test(key)) return { ok: false, reason: "KEY_INVALID" };
    const t = T(tenantId), k = own(t.known, key); if (!k) return { ok: false, reason: "SUGGESTION_UNKNOWN" };
    const days = pv(tenantId, "suggestions.snoozeDays"), t0 = now(); t.snoozed[key] = t0 + days * DAY; store.save();
    const rc = prefs.recordChoice(tenantId, { kind, subject: k.source, actor: "OWNER" }); return { ok: true, key, hiddenUntil: new Date(t.snoozed[key]).toISOString(), counted: Boolean(rc.ok && rc.recorded) };
  }
  const dismiss = (tenantId, key, { actor } = {}) => settle(tenantId, key, "dismissed", actor), acknowledge = (tenantId, key, { actor } = {}) => settle(tenantId, key, "acknowledged", actor);
  function unsnooze(tenantId, key, { actor } = {}) { if (actor !== "OWNER") return { ok: false, reason: "ONLY_OWNER_MAY_UNSNOOZE" }; const t = T(tenantId); if (!Object.hasOwn(t.snoozed, key)) return { ok: false, reason: "NOT_SNOOZED" }; delete t.snoozed[key]; store.save(); return { ok: true, key }; }
  const status = tenantId => { const t = T(tenantId), t0 = now(); prune(t, t0); return { ok: true, snoozed: Object.entries(t.snoozed).map(([key, u]) => ({ key, until: new Date(u).toISOString() })), shownToday: (t.days[dayOf(t0)]?.shown ?? []).length }; };
  return { offer, dismiss, acknowledge, unsnooze, status, limits: LIMITS };
}

// ---------- P20 adapters: pure functions from a snapshot of another module's data to candidates. They read nothing themselves. ----------
const arr = (x, n = 50) => (Array.isArray(x) ? x.slice(0, n) : []);
const idOf = v => { if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/.test(v)) return null; const l = v.toLowerCase(); return l === v ? l : l + "." + crypto.createHash("sha256").update(v).digest("hex").slice(0, 6); };   // ids differing only by case stay distinct
const str = v => (typeof v === "string" ? v : "");
export const SOURCES = Object.freeze({
  approvals: list => arr(list).flatMap(a => { const id = idOf(a?.id); return id ? [{ key: "approval:" + id, source: "approvals", title: "Approval waiting: " + (str(a.action) || "unknown action"), detail: "Nothing happens until you decide.", priority: 5, where: "approvals" }] : []; }),
  decisions: list => arr(list).flatMap(x => { const p = idOf(x?.projectId), dd = idOf(x?.decisionId); return p && dd ? [{ key: `decision:${p}:${dd}`, source: "decisions", title: "Proposed project decision: " + (str(x.title) || dd), detail: "Proposed decisions are not binding until you adopt them.", priority: 3, where: "projects" }] : []; }),
  workflows: list => arr(list).flatMap(i => { const id = idOf(i?.id); const rv = Array.isArray(i?.steps) && i.steps.includes("NEEDS_REVIEW"); return id && (rv || i.status === "FAILED") ? [{ key: "workflow:" + id, source: "workflows", title: (rv ? "Workflow needs your review: " : "Workflow failed: ") + (str(i.templateId) || id), detail: rv ? "A step may have run before an interruption; check it before continuing." : str(i.reason), priority: rv ? 4 : 3, where: "projects" }] : []; }),
  skills: list => arr(list).flatMap(s => { const id = idOf(s?.id); const v = arr(s?.versions, 20).filter(x => x?.status === "TESTED"); return id && !s.active && v.length ? [{ key: "skill:" + id, source: "skills", title: "Tested skill not activated: " + (str(s.name) || id), detail: "Only you can activate it.", priority: 2, where: "projects" }] : []; }),
  plugins: list => arr(list).flatMap(p => { const id = idOf(p?.id); return id && (p.quarantined === true || p.state === "QUARANTINED" || p.status === "QUARANTINED") ? [{ key: "plugin:" + id, source: "plugins", title: "Plugin quarantined: " + id, detail: "It was stopped after misbehaving; reset needs your passphrase.", priority: 4, where: "plugins" }] : []; }),
  preferences: list => arr(list).flatMap(p => { const id = idOf(p?.id); return id ? [{ key: "pref:" + id, source: "preferences", title: "Preference change proposed: " + (str(p.key) || id), detail: str(p.reason), priority: 2, where: "projects" }] : []; }),
});
/** Collect candidates from several snapshots: {approvals, decisions, workflows, skills, plugins, preferences}. Unknown names are ignored. */
export const collectCandidates = snaps => Object.entries(SOURCES).flatMap(([name, f]) => { try { return f(snaps?.[name]); } catch { return []; } });
