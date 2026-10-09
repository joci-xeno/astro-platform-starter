import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createPreferences, validatePreference, SCHEMA, LIMITS } from "../atlasz-addons/preferences.mjs";
import { tmp, rm } from "./helpers.mjs";

const AGENTS = [...Array.from({ length: 5 }, (_, i) => "SEARCH-" + (i + 1)), ...Array.from({ length: 25 }, (_, i) => "EXECUTION-" + (i + 1))];
const SPOOF = ["owner", "Owner", "OWNER ", " OWNER", "OWNER\n", "OWNЕR", "ADMIN", "MASTER", "JOCI", "", null, undefined, {}, ["OWNER"], 1];
const clock = () => { let t = 1_700_000_000_000; const f = () => t; f.adv = ms => { t += ms; }; return f; };

test("schema: defaults, validation of every type, unknown keys, prototype keys", () => {
  const p = createPreferences();
  const a = p.all("t1"); assert.equal(Object.keys(a).length, Object.keys(SCHEMA).length); for (const v of Object.values(a)) assert.equal(v.isDefault, true);
  assert.deepEqual([a["ui.language"].value, a["suggestions.maxPerDay"].value, a["learning.confirmFirst"].value], ["hu", 5, true]);
  for (const [k, v, ok] of [["suggestions.enabled", false, true], ["suggestions.enabled", "yes", false], ["suggestions.maxPerDay", 0, true], ["suggestions.maxPerDay", 20, true], ["suggestions.maxPerDay", 21, false], ["suggestions.maxPerDay", -1, false], ["suggestions.maxPerDay", 1.5, false], ["suggestions.maxPerDay", "3", false],
    ["suggestions.snoozeDays", 1, true], ["suggestions.snoozeDays", 30, true], ["suggestions.snoozeDays", 0, false], ["suggestions.snoozeDays", 31, false], ["ui.detailLevel", "brief", true], ["ui.detailLevel", "huge", false], ["ui.language", "en", true], ["ui.language", "de", false]])
    assert.equal(validatePreference(k, v).ok, ok, k + "=" + JSON.stringify(v));
  for (const k of ["nope", "__proto__", "constructor", "toString", "hasOwnProperty", "", null, undefined, 5]) { assert.equal(validatePreference(k, 1).reason, "UNKNOWN_PREFERENCE"); assert.equal(p.get("t1", k).reason, "UNKNOWN_PREFERENCE"); }
  assert.deepEqual(validatePreference("suggestions.mutedSources", ["b", "a", "b"]), { ok: true, value: ["a", "b"] });
  for (const bad of ["a", [1], ["A"], ["a b"], ["../x"], [""], Array.from({ length: LIMITS.maxIdSet + 1 }, (_, i) => "s" + i), null]) assert.equal(validatePreference("suggestions.mutedSources", bad).reason, "VALUE_MUST_BE_A_LIST_OF_IDS");
  assert.equal(validatePreference("suggestions.mutedSources", Array.from({ length: LIMITS.maxIdSet }, (_, i) => "s" + i)).ok, true);
});

test("set/reset/forget/confirm/reject: OWNER only — no agent, spoofed or malformed actor can change anything", () => {
  const p = createPreferences(), r = p.propose("t1", "ui.language", "en", { actor: "SYSTEM" });
  for (const actor of [...AGENTS, "SYSTEM", ...SPOOF]) {
    assert.equal(p.set("t1", "ui.language", "en", { actor }).reason, "ONLY_OWNER_MAY_SET_PREFERENCES", String(actor));
    assert.equal(p.reset("t1", "ui.language", { actor }).reason, "ONLY_OWNER_MAY_RESET_PREFERENCES");
    assert.equal(p.confirm("t1", r.id, { actor }).reason, "ONLY_OWNER_MAY_DECIDE");
    assert.equal(p.rejectProposal("t1", r.id, { actor }).reason, "ONLY_OWNER_MAY_DECIDE");
    assert.equal(p.forgetAll("t1", { actor }).reason, "ONLY_OWNER_MAY_FORGET");
    assert.equal(p.recordChoice("t1", { kind: "dismissed", subject: "x", actor }).reason, "ONLY_OWNER_CHOICES_ARE_RECORDED");
  }
  assert.equal(p.set("t1", "ui.language", "en").reason, "ONLY_OWNER_MAY_SET_PREFERENCES"); assert.equal(p.set("t1", "ui.language", "en", null === 1 ? 0 : undefined).reason, "ONLY_OWNER_MAY_SET_PREFERENCES");
  assert.equal(p.get("t1", "ui.language").value, "hu"); assert.equal(p.proposals("t1", { status: "PENDING" }).length, 1);
  assert.deepEqual(p.set("t1", "ui.language", "en", { actor: "OWNER" }), { ok: true, key: "ui.language", value: "en" }); assert.equal(p.get("t1", "ui.language").isDefault, false);
  assert.equal(p.set("t1", "ui.language", "de", { actor: "OWNER" }).reason, "VALUE_NOT_ALLOWED"); assert.equal(p.set("t1", "zzz", 1, { actor: "OWNER" }).reason, "UNKNOWN_PREFERENCE");
  assert.deepEqual(p.reset("t1", "ui.language", { actor: "OWNER" }), { ok: true, key: "ui.language" }); assert.equal(p.get("t1", "ui.language").isDefault, true);
  assert.deepEqual(p.reset("t1", "ui.language", { actor: "OWNER" }), { ok: true, key: "ui.language", already: true }); assert.equal(p.reset("t1", "zzz", { actor: "OWNER" }).reason, "UNKNOWN_PREFERENCE");
});

test("learning.confirmFirst can never be turned off or proposed; invalid tenants are refused", () => {
  const p = createPreferences();
  assert.equal(p.set("t1", "learning.confirmFirst", false, { actor: "OWNER" }).reason, "LEARNING_ALWAYS_REQUIRES_CONFIRMATION"); assert.equal(p.set("t1", "learning.confirmFirst", true, { actor: "OWNER" }).ok, true);
  assert.equal(p.propose("t1", "learning.confirmFirst", false, { actor: "SYSTEM" }).reason, "NOT_PROPOSABLE"); assert.equal(p.get("t1", "learning.confirmFirst").value, true);
  for (const t of ["", "a b", "../x", "x".repeat(65), null, undefined, 5, "__proto__x/"]) { assert.throws(() => p.set(t, "ui.language", "en", { actor: "OWNER" }), /TENANT_INVALID/); assert.equal(p.get(t, "ui.language").value, "hu"); assert.equal(p.forgetAll(t, { actor: "OWNER" }).reason, "TENANT_INVALID"); assert.deepEqual(p.proposals(t), []); assert.deepEqual(p.history(t), []); }
});

test("proposals: anyone valid proposes, only the owner confirms; dedupe, already-set, cap, TTL, redaction, one decision each", () => {
  const now = clock(), p = createPreferences({ now }), SK = "s" + "k-ABCDEFGHIJKLMNOPQRSTUV";
  for (const actor of ["x", "SEARCH-0x", "SEARCH-123", "EXECUTION-", null, undefined, "owner"]) assert.equal(p.propose("t1", "ui.language", "en", { actor }).reason, "ACTOR_INVALID", String(actor));
  assert.equal(p.propose("t1", "ui.language", "de", { actor: "SYSTEM" }).reason, "VALUE_NOT_ALLOWED"); assert.equal(p.propose("t1", "ui.language", "hu", { actor: "SYSTEM" }).reason, "ALREADY_SET");
  assert.equal(p.propose("t1", "ui.language", "en", { actor: "SYSTEM", reason: 5 }).reason, "REASON_INVALID"); assert.equal(p.propose("t1", "ui.language", "en", { actor: "SYSTEM", reason: "x".repeat(LIMITS.maxReason + 1) }).reason, "REASON_INVALID");
  const a = p.propose("t1", "ui.language", "en", { actor: "EXECUTION-7", reason: "key " + SK }); assert.equal(a.ok, true); const lst = p.proposals("t1"); assert.equal(lst.length, 1); assert.ok(!JSON.stringify(lst).includes("ABCDEFGHIJKLMNOPQRSTUV")); assert.equal(lst[0].by, "EXECUTION-7"); assert.equal("createdAtMs" in lst[0], false);
  assert.deepEqual(p.propose("t1", "ui.language", "en", { actor: "SEARCH-1" }), { ok: true, id: a.id, duplicate: true }); assert.equal(p.get("t1", "ui.language").value, "hu", "a proposal changes nothing");
  assert.equal(p.confirm("t1", "nope", { actor: "OWNER" }).reason, "PROPOSAL_NOT_FOUND");
  assert.deepEqual(p.confirm("t1", a.id, { actor: "OWNER" }), { ok: true, status: "ACCEPTED", key: "ui.language", value: "en" }); assert.equal(p.get("t1", "ui.language").value, "en");
  assert.equal(p.confirm("t1", a.id, { actor: "OWNER" }).reason, "NOT_PENDING:ACCEPTED"); assert.equal(p.rejectProposal("t1", a.id, { actor: "OWNER" }).reason, "NOT_PENDING:ACCEPTED");
  const b = p.propose("t1", "ui.detailLevel", "brief", { actor: "SYSTEM" }); assert.deepEqual(p.rejectProposal("t1", b.id, { actor: "OWNER" }), { ok: true, status: "REJECTED" }); assert.equal(p.get("t1", "ui.detailLevel").value, "normal"); assert.equal(p.confirm("t1", b.id, { actor: "OWNER" }).reason, "NOT_PENDING:REJECTED");
  // tenant isolation: a proposal id from another tenant is not found
  const c = p.propose("t2", "ui.detailLevel", "brief", { actor: "SYSTEM" }); assert.equal(p.confirm("t1", c.id, { actor: "OWNER" }).reason, "PROPOSAL_NOT_FOUND"); assert.equal(p.get("t1", "ui.detailLevel").value, "normal");
  // TTL: decide fails after expiry, and the status becomes EXPIRED; exactly at the TTL it is still valid
  const e = p.propose("t3", "ui.detailLevel", "detailed", { actor: "SYSTEM" }); now.adv(LIMITS.proposalTtlMs); assert.equal(p.confirm("t3", e.id, { actor: "OWNER" }).ok, true, "exactly at TTL still valid");
  const f = p.propose("t3", "suggestions.maxPerDay", 2, { actor: "SYSTEM" }); now.adv(LIMITS.proposalTtlMs + 1); assert.equal(p.confirm("t3", f.id, { actor: "OWNER" }).reason, "NOT_PENDING:EXPIRED"); assert.equal(p.proposals("t3", { status: "EXPIRED" }).length, 1);
  // expired duplicate does not block a fresh proposal; expiry is swept on propose
  const g = p.propose("t4", "suggestions.maxPerDay", 3, { actor: "SYSTEM" }); now.adv(LIMITS.proposalTtlMs + 1); const h = p.propose("t4", "suggestions.maxPerDay", 3, { actor: "SYSTEM" }); assert.ok(h.ok && !h.duplicate && h.id !== g.id); assert.equal(p.proposals("t4", { status: "EXPIRED" }).length, 1);
  // the sweep keeps a proposal that is exactly at the TTL
  const k1 = p.propose("t5", "ui.detailLevel", "brief", { actor: "SYSTEM" }); now.adv(LIMITS.proposalTtlMs); p.propose("t5", "ui.language", "en", { actor: "SYSTEM" }); assert.equal(p.proposals("t5", { status: "PENDING" }).length, 2); assert.equal(p.confirm("t5", k1.id, { actor: "OWNER" }).ok, true);
  // cap on pending proposals
  const q = createPreferences(); for (let i = 0; i < LIMITS.maxProposals; i++) assert.equal(q.propose("t", "suggestions.mutedSources", ["s" + i], { actor: "SYSTEM" }).ok, true);
  assert.equal(q.propose("t", "suggestions.mutedSources", ["zz"], { actor: "SYSTEM" }).reason, "TOO_MANY_PENDING_PROPOSALS");
});

test("confirming a proposal that was valid when made re-validates; rememberHistory=false clears counters", () => {
  const p = createPreferences(); for (let i = 0; i < 3; i++) p.recordChoice("t", { kind: "dismissed", subject: "news", actor: "OWNER" });
  assert.equal(p.exportAll("t").counters["dismissed:news"], 3);
  p.set("t", "privacy.rememberHistory", false, { actor: "OWNER" }); assert.deepEqual(p.exportAll("t").counters, {});
  assert.deepEqual(p.recordChoice("t", { kind: "dismissed", subject: "news", actor: "OWNER" }), { ok: true, recorded: false }); assert.deepEqual(p.exportAll("t").counters, {});
  assert.deepEqual(p.learn("t"), { ok: true, proposed: [], note: "History is off." });
  p.set("t", "privacy.rememberHistory", true, { actor: "OWNER" }); assert.equal(p.recordChoice("t", { kind: "dismissed", subject: "news", actor: "OWNER" }).count, 1);
});

test("recordChoice validation and counter cap; learn only proposes after the threshold and never changes a preference", () => {
  const p = createPreferences();
  for (const bad of [{ kind: "A", subject: "x" }, { kind: "k", subject: "X y" }, { kind: 1, subject: "x" }, { kind: "k" }, { subject: "x" }, { kind: "k".repeat(41), subject: "x" }, { kind: "k", subject: "../x" }]) assert.equal(p.recordChoice("t", { ...bad, actor: "OWNER" }).reason, "KIND_AND_SUBJECT_MUST_BE_IDS", JSON.stringify(bad));
  assert.equal(p.recordChoice("t", undefined).reason, "ONLY_OWNER_CHOICES_ARE_RECORDED");
  for (let i = 0; i < LIMITS.learnThreshold - 1; i++) p.recordChoice("t", { kind: "dismissed", subject: "news", actor: "OWNER" });
  assert.deepEqual(p.learn("t"), { ok: true, proposed: [] }); assert.deepEqual(p.learn("nobody"), { ok: true, proposed: [] });
  p.recordChoice("t", { kind: "dismissed", subject: "news", actor: "OWNER" }); p.recordChoice("t", { kind: "opened", subject: "news", actor: "OWNER" }); for (let i = 0; i < 9; i++) p.recordChoice("t", { kind: "opened", subject: "mail", actor: "OWNER" });
  const l = p.learn("t"); assert.equal(l.proposed.length, 1); assert.equal(l.proposed[0].source, "news"); const pr = p.proposals("t")[0]; assert.deepEqual([pr.key, pr.value, pr.by, pr.status], ["suggestions.mutedSources", ["news"], "SYSTEM", "PENDING"]); assert.match(pr.reason, /"news" suggestions 3 times/);
  assert.deepEqual(p.get("t", "suggestions.mutedSources").value, [], "learning never applies anything");
  assert.equal(p.learn("t").proposed.length, 1, "repeating learn re-reports the same pending proposal, creating no duplicate"); assert.equal(p.proposals("t").length, 1);
  p.confirm("t", pr.id, { actor: "OWNER" }); assert.deepEqual(p.get("t", "suggestions.mutedSources").value, ["news"]); assert.deepEqual(p.learn("t"), { ok: true, proposed: [] }, "already-muted sources are not proposed again");
  for (let i = 0; i < 3; i++) p.recordChoice("t", { kind: "dismissed", subject: "ads", actor: "OWNER" }); assert.deepEqual(p.proposals("t", { status: "PENDING" })[0] ?? null, null); const l2 = p.learn("t"); assert.deepEqual(p.proposals("t", { status: "PENDING" })[0].value, ["ads", "news"]); assert.equal(l2.proposed[0].source, "ads");
  const full = createPreferences(); for (let i = 0; i < LIMITS.maxProposals; i++) full.propose("t", "suggestions.mutedSources", ["s" + i], { actor: "SYSTEM" }); for (let i = 0; i < 3; i++) full.recordChoice("t", { kind: "dismissed", subject: "news", actor: "OWNER" });
  assert.deepEqual(full.learn("t"), { ok: true, proposed: [] }, "a proposal that could not be stored is not reported");
  const c = createPreferences(); for (let i = 0; i < LIMITS.maxCounters; i++) assert.equal(c.recordChoice("t", { kind: "opened", subject: "s" + i, actor: "OWNER" }).ok, true);
  assert.equal(c.recordChoice("t", { kind: "opened", subject: "extra", actor: "OWNER" }).reason, "TOO_MANY_COUNTERS"); assert.equal(c.recordChoice("t", { kind: "opened", subject: "s0", actor: "OWNER" }).count, 2, "existing counters still count at the cap");
});

test("history: records who/what, is bounded, tenant isolated; export shows everything; forgetAll deletes only that tenant", () => {
  const p = createPreferences(); p.set("t1", "ui.language", "en", { actor: "OWNER" }); p.propose("t1", "ui.detailLevel", "brief", { actor: "SEARCH-2" }); p.reset("t1", "ui.language", { actor: "OWNER" }); p.set("t2", "ui.language", "en", { actor: "OWNER" });
  const h = p.history("t1"); assert.deepEqual(h.map(x => x.type), ["SET", "PROPOSED", "RESET"]); assert.deepEqual([h[0].from, h[0].to, h[0].by], ["hu", "en", "OWNER"]); assert.equal(h[1].by, "SEARCH-2"); assert.equal(p.history("t2").length, 1);
  assert.equal(p.history("t1", 2).length, 2); assert.equal(p.history("t1", 0).length, 1, "limit is clamped to at least 1"); assert.equal(p.history("t1", -5).length, 1); assert.equal(p.history("t1", 1e9).length, 3);
  const e = p.exportAll("t1"); assert.deepEqual([e.ok, e.history.length, e.proposals.length], [true, 3, 1]); e.history.length = 0; assert.equal(p.history("t1").length, 3, "export is a copy");
  assert.deepEqual(p.forgetAll("t1", { actor: "OWNER" }), { ok: true, deleted: true }); assert.deepEqual(p.history("t1"), []); assert.equal(p.get("t2", "ui.language").value, "en"); assert.deepEqual(p.forgetAll("t1", { actor: "OWNER" }), { ok: true, deleted: false });
  const big = createPreferences(); for (let i = 0; i < LIMITS.maxHistory + 10; i++) { big.set("t", "suggestions.maxPerDay", i % 2, { actor: "OWNER" }); if (i === LIMITS.maxHistory) assert.equal(big.exportAll("t").history.length, LIMITS.maxHistory, "trimmed as soon as the cap is exceeded"); }
  assert.equal(big.history("t", 200).length, 200); assert.equal(big.history("t", 1e9).length, 200, "history reads are capped at 200"); assert.equal(big.exportAll("t").history.length, LIMITS.maxHistory);
});

test("a stored proposal whose value no longer validates cannot be confirmed and stays pending", () => {
  const dir = tmp("pref-"), file = path.join(dir, "prefs.json");
  try {
    const a = createPreferences({ file }), pr = a.propose("t", "ui.language", "en", { actor: "SYSTEM" }); const j = JSON.parse(fs.readFileSync(file, "utf8")); j.tenants.t.proposals[0].value = "klingon"; fs.writeFileSync(file, JSON.stringify(j));
    const b = createPreferences({ file }); assert.equal(b.confirm("t", pr.id, { actor: "OWNER" }).reason, "VALUE_NOT_ALLOWED"); assert.equal(b.proposals("t")[0].status, "PENDING"); assert.equal(b.get("t", "ui.language").value, "hu");
  } finally { rm(dir); }
});
test("durability: values, proposals, counters and history survive a restart; a corrupt file is not silently overwritten", () => {
  const dir = tmp("pref-"), file = path.join(dir, "prefs.json");
  try {
    const a = createPreferences({ file }); a.set("t", "ui.language", "en", { actor: "OWNER" }); const pr = a.propose("t", "ui.detailLevel", "brief", { actor: "SYSTEM" }); a.recordChoice("t", { kind: "dismissed", subject: "news", actor: "OWNER" });
    const b = createPreferences({ file }); assert.equal(b.get("t", "ui.language").value, "en"); assert.equal(b.proposals("t")[0].id, pr.id); assert.equal(b.exportAll("t").counters["dismissed:news"], 1); assert.equal(b.confirm("t", pr.id, { actor: "OWNER" }).ok, true);
    assert.equal(createPreferences({ file }).get("t", "ui.detailLevel").value, "brief");
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o077, 0, "file is private");
    fs.writeFileSync(file + ".bad", "{not json"); assert.throws(() => createPreferences({ file: file + ".bad" }), /STORE_UNREADABLE/); assert.equal(fs.readFileSync(file + ".bad", "utf8"), "{not json");
    createPreferences({ file }).forgetAll("t", { actor: "OWNER" }); assert.equal(createPreferences({ file }).get("t", "ui.language").isDefault, true);
  } finally { rm(dir); }
});

test("verification fix: an actor must be a string (arrays and objects that stringify to an agent id are refused)", () => {
  const p = createPreferences();
  for (const actor of [["SEARCH-1"], { toString: () => "EXECUTION-2" }, 5, null]) { const r = p.propose("t1", "ui.language", "en", { actor }); assert.equal(r.ok, false, String(actor)); }
  assert.equal(p.propose("t1", "ui.language", "en", { actor: "SEARCH-1" }).ok !== undefined, true);
});

test("round-3 fixes: resolved proposals are kept bounded", () => {
  const p = createPreferences({ now: clock() });
  for (let i = 0; i < 260; i++) { const r = p.propose("t1", "suggestions.maxPerDay", 6 + (i % 10), { actor: "SYSTEM" }); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(p.rejectProposal("t1", r.id, { actor: "OWNER" }).ok, true); }
  assert.ok(p.proposals("t1").length <= 201, "history of decided proposals is capped: " + p.proposals("t1").length);
});

test("round-4 fixes: an out-of-date proposal is listed as EXPIRED even before the next write; a NaN/garbage history limit falls back to the default cap", () => {
  const now = clock(), p = createPreferences({ now }); const r = p.propose("t1", "ui.language", "en", { actor: "SYSTEM" }); assert.equal(r.ok, true);
  assert.equal(p.proposals("t1", { status: "PENDING" }).length, 1); now.adv(LIMITS.proposalTtlMs + 1000);
  assert.equal(p.proposals("t1", { status: "PENDING" }).length, 0); assert.equal(p.proposals("t1", { status: "EXPIRED" }).length, 1);
  for (let i = 0; i < 260; i++) p.set("t1", "suggestions.maxPerDay", i % 20, { actor: "OWNER" });
  assert.ok(p.history("t1", NaN).length <= 50); assert.ok(p.history("t1", "abc").length <= 50); assert.equal(p.history("t1", 5).length, 5); assert.ok(p.history("t1", 1e9).length <= 200);
});

test("round-4 fixes: hand-edited stored values that fail the schema are ignored (defaults apply)", () => {
  const d = tmp("pf-"), f = path.join(d, "p.json");
  try {
    const p = createPreferences({ file: f }); p.set("t1", "suggestions.maxPerDay", 3, { actor: "OWNER" });
    const j = JSON.parse(fs.readFileSync(f, "utf8")); j.tenants.t1.values["suggestions.maxPerDay"] = 1e9; j.tenants.t1.values["suggestions.snoozeDays"] = "abc"; fs.writeFileSync(f, JSON.stringify(j));
    const q = createPreferences({ file: f }); assert.equal(q.get("t1", "suggestions.maxPerDay").value, SCHEMA["suggestions.maxPerDay"].default); assert.equal(q.get("t1", "suggestions.snoozeDays").value, SCHEMA["suggestions.snoozeDays"].default); assert.equal(q.get("t1", "suggestions.snoozeDays").isDefault, true);
  } finally { rm(d); }
});
