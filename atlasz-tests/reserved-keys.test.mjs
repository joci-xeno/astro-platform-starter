// Regression for the independent verification findings: prototype-chain names must never act as tenant / id / key / op names,
// and nothing may be written onto Object or Object.prototype.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { tmp, rm } from "./helpers.mjs";
import { RESERVED, okName, own } from "../atlasz-addons/safe-keys.mjs";
import { createProfiles } from "../atlasz-addons/assistant-profiles.mjs";
import { createPreferences } from "../atlasz-addons/preferences.mjs";
import { createSuggestions } from "../atlasz-addons/suggestions.mjs";
import { createStudy } from "../atlasz-addons/spaced-repetition.mjs";
import { createHandoffLedger } from "../atlasz-addons/handoff-ledger.mjs";
import { createProjectMemory } from "../atlasz-addons/project-memory.mjs";
import { createNotesOrganizer } from "../atlasz-addons/notes-organizer.mjs";
import { chooseEffort, complexityScore } from "../atlasz-addons/effort-allocation.mjs";
import { createWorkbench } from "../atlasz-addons/workbench.mjs";

const NAMES = ["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "__defineGetter__"];
const snapshot = () => JSON.stringify([Object.getOwnPropertyNames(Object.prototype).sort(), Object.getOwnPropertyNames(Object).sort(), ({}).polluted ?? null, Object.polluted ?? null, Object.values["ui.language"] ?? null]);

test("helpers: every Object.prototype name is reserved; own() reads only own properties", () => {
  for (const n of NAMES) { assert.equal(RESERVED.has(n), true, n); assert.equal(okName(/^[a-z_]+$/i, n), false, n); assert.equal(own({}, n), undefined, n); }
  assert.equal(own({ a: 1 }, "a"), 1); assert.equal(own(null, "a"), undefined); assert.equal(own({ a: 1 }, 5), undefined); assert.equal(okName(/^[a-z]+$/, "fine"), true); assert.equal(okName(/^[a-z]+$/, 5), false);
  assert.equal(own(Object.create(null, { k: { value: 2, enumerable: true } }), "k"), 2);
});

test("tenant names that live on Object.prototype are refused by every tenant-keyed store and nothing is polluted", () => {
  const before = snapshot();
  const mods = {
    profiles: t => createProfiles({}).create(t, { id: "p", name: "n", instructions: "do work", actor: "OWNER" }),
    prefs: t => createPreferences({}).set(t, "ui.language", "en", { actor: "OWNER" }),
    sugg: t => createSuggestions({ prefs: createPreferences({}) }).offer(t, []),
    study: t => createStudy({}).addCard(t, { deck: "d", front: "f", back: "b", actor: "OWNER" }),
    handoff: t => createHandoffLedger({}).register(t, { id: "a", kind: "k", owner: "EXECUTION-1" }),
  };
  for (const [m, f] of Object.entries(mods)) for (const n of NAMES) assert.throws(() => f(n), /TENANT_INVALID/, m + " " + n);
  assert.equal(snapshot(), before, "no global was written");
});

test("ids and keys with prototype names are refused or simply not found (never an inherited value)", () => {
  const pr = createProfiles({}); for (const n of NAMES) { assert.equal(pr.create("t", { id: n, name: "n", instructions: "do work", actor: "OWNER" }).reason, "PROFILE_ID_INVALID", n); assert.equal(pr.get("t", n).reason, "PROFILE_NOT_FOUND", n); assert.equal(pr.resolve("t", n, { role: "SEARCH" }).reason, "PROFILE_NOT_FOUND", n); }
  const sg = createSuggestions({ prefs: createPreferences({}) }); for (const n of NAMES) assert.equal(sg.dismiss("t", n).ok, false, "dismiss " + n);
  const st = createStudy({}); for (const n of NAMES) { assert.equal(st.get("t", n).ok, false, n); assert.equal(st.remove("t", n, { actor: "OWNER" }).reason, "CARD_NOT_FOUND", n); }
  const hl = createHandoffLedger({}); for (const n of NAMES) assert.equal(hl.get("t", n).ok, false, n);
  const pm = createProjectMemory({}); for (const n of NAMES) { const r = pm.decisions(n, { tenantId: "t" }); assert.equal(r.ok, false, "project " + n + JSON.stringify(r).slice(0, 80)); }
  const no = createNotesOrganizer({}); for (const n of NAMES) assert.equal(no.get(n, { tenantId: "t" }).ok, false, "note " + n);
});

test("effort allocation: a prototype name as the task kind is KIND_UNKNOWN, never MAX", () => {
  for (const n of NAMES) { assert.equal(complexityScore({ kind: n }).reason, "KIND_UNKNOWN", n); const r = chooseEffort({ kind: n, risk: "LOW" }, { budgetUsd: 0 }); assert.equal(r.ok, false, n + JSON.stringify(r)); assert.notEqual(r.level, "MAX"); }
  assert.equal(chooseEffort({ kind: "LOOKUP", risk: "LOW" }, { budgetUsd: 0 }).level, "LOW");
});

test("workbench: op names from Object.prototype are OP_UNKNOWN", async () => {
  const w = createWorkbench({}); for (const n of NAMES) { const r = await w.run(n, {}); assert.equal(r.reason ?? r.error, "OP_UNKNOWN", n); }
});
import { createStore } from "../atlasz-addons/business/store.mjs";
import fsx from "node:fs";
import pathx from "node:path";
import { tmp as tmpx, rm as rmx } from "./helpers.mjs";
test("store shape check: wrong-kind roots and collections are refused (never repaired); missing keys are filled", () => {
  const d = tmpx("shape-"); try {
    const f = pathx.join(d, "s.json"), mk = () => createStore({ file: f, init: () => ({ tenants: {}, seq: 0, log: [] }) });
    for (const bad of ["null", "[]", "5", '{"tenants":[]}', '{"tenants":{},"seq":"x"}', '{"tenants":{},"log":{}}', '{"tenants":null}']) { fsx.writeFileSync(f, bad); assert.throws(mk, /^Error: STORE_UNREADABLE:s\.json$/, bad); assert.equal(fsx.readFileSync(f, "utf8"), bad, "file untouched"); }
    fsx.writeFileSync(f, '{"tenants":{"a":{}}}'); const s = mk(); assert.deepEqual(s.data, { tenants: { a: {} }, seq: 0, log: [] });
    fsx.writeFileSync(f, "{}"); assert.deepEqual(createHandoffLedger({ file: f }).list("x"), []); fsx.writeFileSync(f, '{"tenants":[]}'); assert.throws(() => createHandoffLedger({ file: f }), /STORE_UNREADABLE/);
  } finally { rmx(d); }
});
