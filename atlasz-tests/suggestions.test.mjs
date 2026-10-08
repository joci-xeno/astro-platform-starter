import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createSuggestions, normalizeCandidate, SOURCES, collectCandidates, LIMITS } from "../atlasz-addons/suggestions.mjs";
import { createPreferences } from "../atlasz-addons/preferences.mjs";
import { tmp, rm } from "./helpers.mjs";

const AGENTS = [...Array.from({ length: 5 }, (_, i) => "SEARCH-" + (i + 1)), ...Array.from({ length: 25 }, (_, i) => "EXECUTION-" + (i + 1))], SPOOF = ["owner", "OWNER ", "SYSTEM", "", null, undefined, {}], DAY = 86400000, O = { actor: "OWNER" };
const clock = () => { let t = Date.UTC(2026, 0, 10, 12, 0, 0); const f = () => t; f.adv = ms => { t += ms; }; return f; };
const SK = "s" + "k-ABCDEFGHIJKLMNOPQRSTUV";
const cand = (key, o = {}) => ({ key, source: "approvals", title: "T " + key, priority: 3, ...o });
const mk = (o = {}) => { const now = o.now ?? clock(), prefs = createPreferences({ now }); return { now, prefs, s: createSuggestions({ prefs, now, file: o.file ?? null }) }; };

test("normalizeCandidate: valid shapes pass; malformed are dropped; text is sanitised and redacted", () => {
  const n = normalizeCandidate({ key: "a:1", source: "approvals", title: "  Hello\u0000\n\tworld  " + SK, detail: "d‮", priority: 9, where: "BAD" });
  assert.equal(n.title.includes("\u0000"), false); assert.ok(n.title.startsWith("Hello world")); assert.ok(!JSON.stringify(n).includes("ABCDEFGHIJKLMNOPQRSTUV")); assert.deepEqual([n.priority, n.where, n.detail], [3, null, "d"]);
  assert.equal(normalizeCandidate({ key: "a", source: "x", title: "t", priority: 5, where: "approvals" }).priority, 5); assert.equal(normalizeCandidate({ key: "a", source: "x", title: "t", priority: 1 }).priority, 1); assert.equal(normalizeCandidate({ key: "a", source: "x", title: "t", priority: 0 }).priority, 3);
  assert.equal(normalizeCandidate({ key: "a", source: "x", title: "t", where: "approvals" }).where, "approvals");
  assert.equal(normalizeCandidate({ key: "a", source: "x", title: "x".repeat(500), detail: "y".repeat(900) }).title.length, LIMITS.titleChars); assert.equal(normalizeCandidate({ key: "a", source: "x", title: "t", detail: "y".repeat(900) }).detail.length, LIMITS.detailChars);
  assert.equal(normalizeCandidate({ key: "a", source: "x", title: "t", priority: 3.5 }).priority, 3); assert.equal(normalizeCandidate({ key: "a", source: "x", title: "t", priority: "4" }).priority, 3); assert.equal(normalizeCandidate({ key: "a", source: "x", title: "t", detail: 5 }).detail, "");
  for (const bad of [{ key: ["a:1"], source: "x", title: "t" }, { key: "a", source: ["approvals"], title: "t" }, { key: { toString: () => "a" }, source: "x", title: "t" }]) assert.equal(normalizeCandidate(bad), null, "non-string key/source are refused even when they stringify to something valid");
  for (const bad of [null, undefined, "x", 5, [], {}, { key: "A", source: "x", title: "t" }, { key: "a b", source: "x", title: "t" }, { key: "a", source: "X", title: "t" }, { key: "a", source: "x" }, { key: "a", source: "x", title: 5 }, { key: "a", source: "x", title: " \u0000 " }, { key: "k".repeat(81), source: "x", title: "t" }, { key: "a", source: "s".repeat(41), title: "t" }, { key: 5, source: "x", title: "t" }, { key: "a", source: 5, title: "t" }])
    assert.equal(normalizeCandidate(bad), null, JSON.stringify(bad));
  assert.ok(normalizeCandidate({ key: "k".repeat(80), source: "s".repeat(40), title: "t" }));
});

test("offer: ordering, dedupe, invalid counting, canAct is always false, nothing executable in the output", () => {
  const { s } = mk(); const r = s.offer("t", [cand("b", { priority: 2 }), cand("c", { priority: 5 }), cand("a", { priority: 5 }), cand("a"), { nope: 1 }, null]);
  assert.deepEqual(r.shown.map(x => x.key), ["a", "c", "b"]); assert.deepEqual([r.suppressed.duplicate, r.suppressed.invalid, r.suppressed.overInput], [1, 2, 0]); assert.ok(r.shown.every(x => x.canAct === false));
  assert.ok(r.shown.every(x => Object.values(x).every(v => typeof v !== "function")));
  assert.deepEqual(s.offer("t", "not a list").shown, []); assert.deepEqual(s.offer("t", undefined).shown, []);
  const many = s.offer("u", Array.from({ length: LIMITS.maxCandidates + 7 }, (_, i) => cand("k" + i))); assert.equal(many.suppressed.overInput, 7); assert.equal(many.suppressed.dailyLimit, LIMITS.maxCandidates - 5, "only the first 100 candidates are looked at"); assert.equal(s.offer("v", Array.from({ length: LIMITS.maxCandidates }, (_, i) => cand("k" + i))).suppressed.overInput, 0);
  const wide = createSuggestions({ prefs: { get: (_t, k) => ({ value: k === "suggestions.maxPerDay" ? 50 : k === "suggestions.mutedSources" ? [] : true }), recordChoice: () => ({ ok: true }) }, now: clock() }); assert.equal(wide.offer("t", Array.from({ length: 40 }, (_, i) => cand("w" + i))).shown.length, LIMITS.maxShownHardCap, "a preference store cannot raise the cap above the hard limit"); assert.throws(() => s.offer("a b", []), /TENANT_INVALID/);
});

test("suppression rules: disabled, muted source, daily limit (new keys only), hard cap, snooze", () => {
  const { s, prefs, now } = mk();
  assert.equal(s.offer("t", [cand("a"), cand("b"), cand("c"), cand("d"), cand("e"), cand("f")]).shown.length, 5, "default cap is 5"); const again = s.offer("t", [cand("a"), cand("b"), cand("c"), cand("d"), cand("e"), cand("f")]);
  assert.deepEqual([again.shown.length, again.suppressed.dailyLimit], [5, 1], "already-shown keys are listed again without using the cap, the sixth stays out");
  assert.ok(again.shown.every(x => x.key !== "f"));
  now.adv(DAY); assert.equal(s.offer("t", [cand("f")]).shown.length, 1, "a new UTC day starts a new allowance");
  prefs.set("t", "suggestions.maxPerDay", 0, O); assert.deepEqual([s.offer("t", [cand("zz")]).shown.length, s.offer("t", [cand("zz")]).suppressed.dailyLimit], [0, 1]);
  prefs.set("t", "suggestions.maxPerDay", 20, O); assert.equal(s.offer("t", Array.from({ length: 30 }, (_, i) => cand("n" + i))).shown.length, 19, "20 per day in total, one slot was already used today by 'f'");
  now.adv(DAY); prefs.set("t", "suggestions.mutedSources", ["approvals"], O); const m = s.offer("t", [cand("a"), cand("x", { source: "skills" })]); assert.deepEqual([m.shown.map(x => x.key), m.suppressed.muted], [["x"], 1]);
  prefs.set("t", "suggestions.enabled", false, O); const off = s.offer("t", [cand("q"), cand("w")]); assert.deepEqual([off.shown, off.suppressed.disabled], [[], 2]); assert.match(off.note, /turned off/);
  prefs.reset("t", "suggestions.enabled", O); assert.equal(s.offer("t", [cand("x", { source: "skills" })]).shown.length, 1);
  const sn = mk(); sn.s.offer("t", [cand("a")]); const d = sn.s.dismiss("t", "a", O); assert.equal(d.ok, true); assert.equal(sn.s.offer("t", [cand("a"), cand("b")]).suppressed.snoozed, 1);
  sn.now.adv(7 * DAY - 1); assert.equal(sn.s.offer("t", [cand("a")]).suppressed.snoozed, 1, "still hidden 1ms before the end"); sn.now.adv(1); assert.equal(sn.s.offer("t", [cand("a")]).shown.length, 1, "visible again at the end of the snooze");
  assert.equal(sn.s.status("t").snoozed.length, 0);
});

test("dismiss / acknowledge: owner only, only for suggestions that were shown, snooze length follows the preference, choices are counted for learning", () => {
  const { s, prefs, now } = mk(); s.offer("t", [cand("a"), cand("b", { source: "skills" })]);
  for (const actor of [...AGENTS, ...SPOOF]) { assert.equal(s.dismiss("t", "a", { actor }).reason, "ONLY_OWNER_MAY_DISMISSED", String(actor)); assert.equal(s.acknowledge("t", "a", { actor }).reason, "ONLY_OWNER_MAY_ACKNOWLEDGED"); assert.equal(s.unsnooze("t", "a", { actor }).reason, "ONLY_OWNER_MAY_UNSNOOZE"); }
  assert.equal(s.dismiss("t", "a").reason, "ONLY_OWNER_MAY_DISMISSED"); assert.equal(s.dismiss("t", "a", undefined).reason, "ONLY_OWNER_MAY_DISMISSED"); assert.equal(s.status("t").snoozed.length, 0);
  for (const k of ["A", "a b", "", null, 5, "../x"]) assert.equal(s.dismiss("t", k, O).reason, "KEY_INVALID", String(k)); assert.equal(s.dismiss("t", "never-seen", O).reason, "SUGGESTION_UNKNOWN"); assert.equal(s.dismiss("other", "a", O).reason, "SUGGESTION_UNKNOWN", "tenant isolation");
  prefs.set("t", "suggestions.snoozeDays", 3, O); const r = s.dismiss("t", "a", O); assert.deepEqual([r.ok, r.counted, r.hiddenUntil], [true, true, new Date(now() + 3 * DAY).toISOString()]);
  const a = s.acknowledge("t", "b", O); assert.equal(a.ok, true); assert.equal(prefs.exportAll("t").counters["dismissed:approvals"], 1); assert.equal(prefs.exportAll("t").counters["acknowledged:skills"], 1);
  prefs.set("t", "privacy.rememberHistory", false, O); s.offer("t", [cand("c")]); assert.equal(s.dismiss("t", "c", O).counted, false, "history off: still hidden, but not counted"); assert.equal(s.status("t").snoozed.length, 3);
  assert.deepEqual(s.unsnooze("t", "a", O), { ok: true, key: "a" }); assert.equal(s.unsnooze("t", "a", O).reason, "NOT_SNOOZED");
  // three dismissals of one source lead to a PROPOSAL (never a silent mute)
  const L = mk(); for (let i = 0; i < 3; i++) { L.s.offer("t", [cand("k" + i)]); L.s.dismiss("t", "k" + i, O); } const lr = L.prefs.learn("t"); assert.equal(lr.proposed.length, 1); assert.deepEqual(L.prefs.get("t", "suggestions.mutedSources").value, []); assert.equal(L.s.offer("t", [cand("zz")]).shown.length, 1, "still shown until the owner confirms");
});

test("bookkeeping stays bounded; durability and corrupt-file handling", () => {
  const now = clock(), { s } = mk({ now }); for (let i = 0; i < LIMITS.maxKnown + 50; i++) { s.offer("t", [cand("k" + i)]); now.adv(DAY); } assert.equal(s.dismiss("t", "k0", O).reason, "SUGGESTION_UNKNOWN", "oldest known keys are forgotten first"); assert.equal(s.dismiss("t", "k" + (LIMITS.maxKnown + 49), O).ok, true);
  const now2 = clock(), p = mk({ now: now2 }); for (let i = 0; i < LIMITS.keepDays + 3; i++) { p.s.offer("t", [cand("d" + i)]); now2.adv(DAY); } assert.equal(p.s.status("t").shownToday, 0); p.s.offer("t", [cand("x1"), cand("x2")]); assert.equal(p.s.status("t").shownToday, 2);
  const f2 = tmp("sug2-"); try { const n4 = clock(), q = mk({ now: n4, file: path.join(f2, "s.json") }); for (let i = 0; i < LIMITS.maxKnown + 50; i++) { q.s.offer("t", [cand("m" + i)]); n4.adv(DAY); if (i >= 10) { const st = JSON.parse(fs.readFileSync(path.join(f2, "s.json"), "utf8")).tenants.t; assert.equal(Object.keys(st.days).length, LIMITS.keepDays, "day log is pruned to exactly the last " + LIMITS.keepDays + " days"); if (i >= LIMITS.maxKnown) assert.equal(Object.keys(st.known).length, LIMITS.maxKnown + 1, "known keys are trimmed to the cap before each new one is added"); } } } finally { rm(f2); }
  assert.throws(() => createSuggestions({ prefs: null }), /PREFERENCES_REQUIRED/); assert.throws(() => createSuggestions({ prefs: {} }), /PREFERENCES_REQUIRED/);
  const dir = tmp("sug-"), file = path.join(dir, "s.json");
  try {
    const n3 = clock(), a = mk({ now: n3, file }); a.s.offer("t", [cand("a"), cand("b")]); a.s.dismiss("t", "a", O);
    const b = createSuggestions({ file, prefs: a.prefs, now: n3 }); assert.equal(b.status("t").snoozed.length, 1); assert.equal(b.offer("t", [cand("a"), cand("b")]).shown.map(x => x.key).join(), "b"); if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o077, 0);
    fs.writeFileSync(file + ".bad", "{x"); assert.throws(() => createSuggestions({ file: file + ".bad", prefs: a.prefs }), /STORE_UNREADABLE/);
  } finally { rm(dir); }
});

test("adapters: each source yields well-formed, bounded, untrusted-safe candidates; malformed snapshots yield nothing", () => {
  const c = collectCandidates({
    approvals: [{ id: "AP1", action: "PLUGIN_INSTALL" }, { id: "../x" }, null, { id: 5 }], decisions: [{ projectId: "P1", decisionId: "D1", title: "Use X" }, { projectId: "P1" }],
    workflows: [{ id: "w1", templateId: "t1", status: "PAUSED", steps: ["DONE", "NEEDS_REVIEW"] }, { id: "w2", templateId: "t2", status: "FAILED", reason: "boom", steps: ["FAILED"] }, { id: "w3", status: "DONE", steps: ["DONE"] }, { id: "w4", status: "PAUSED", steps: ["PENDING"] }],
    skills: [{ id: "s1", name: "N", active: false, versions: [{ status: "TESTED" }] }, { id: "s2", active: true, versions: [{ status: "TESTED" }] }, { id: "s3", active: false, versions: [{ status: "TEST_FAILED" }] }, { id: "s4", active: false }],
    plugins: [{ id: "pl1", quarantined: true }, { id: "pl2", state: "QUARANTINED" }, { id: "pl3", state: "ENABLED" }], preferences: [{ id: "pp1", key: "ui.language", reason: "r" }, {}], bogus: [1] });
  const keys = c.map(x => x.key).sort(); assert.deepEqual(keys, ["approval:ap1", "decision:p1:d1", "plugin:pl1", "plugin:pl2", "pref:pp1", "skill:s1", "workflow:w1", "workflow:w2"]);
  assert.ok(c.every(x => normalizeCandidate(x) !== null)); const by = Object.fromEntries(c.map(x => [x.key, x])); assert.equal(by["approval:ap1"].priority, 5); assert.equal(by["workflow:w1"].priority, 4); assert.equal(by["workflow:w2"].priority, 3); assert.match(by["workflow:w1"].title, /needs your review/); assert.match(by["workflow:w2"].title, /failed/);
  assert.equal(by["approval:ap1"].title, "Approval waiting: PLUGIN_INSTALL"); assert.equal(by["decision:p1:d1"].title, "Proposed project decision: Use X"); assert.equal(by["skill:s1"].title, "Tested skill not activated: N"); assert.equal(by["plugin:pl1"].title, "Plugin quarantined: pl1"); assert.equal(by["pref:pp1"].title, "Preference change proposed: ui.language");
  const hostile = { get id() { throw new Error("boom"); } }; const mixed = collectCandidates({ approvals: [hostile], skills: [{ id: "s1", name: "N", active: false, versions: [{ status: "TESTED" }] }] }); assert.deepEqual(mixed.map(x => x.key), ["skill:s1"], "one hostile snapshot cannot break the others");
  assert.deepEqual(collectCandidates(undefined), []); assert.deepEqual(collectCandidates({ approvals: "x", skills: 5, workflows: { a: 1 } }), []); assert.equal(Object.keys(SOURCES).length, 6);
  assert.equal(SOURCES.approvals(Array.from({ length: 80 }, (_, i) => ({ id: "a" + i }))).length, 50, "each adapter reads at most 50 items");
  assert.equal(SOURCES.approvals([{ id: "x".repeat(62) }]).length, 0); assert.equal(SOURCES.approvals([{ id: "x".repeat(61) }]).length, 1);
  assert.equal(SOURCES.workflows([{ id: "w", status: "FAILED", reason: SK, steps: [] }]).length, 1);
  const { s } = mk(); const shown = s.offer("t", SOURCES.workflows([{ id: "w", status: "FAILED", reason: "key " + SK, steps: [] }])).shown; assert.ok(!JSON.stringify(shown).includes("ABCDEFGHIJKLMNOPQRSTUV"));
});
