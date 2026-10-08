import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createSkillRegistry, LIMITS } from "../atlasz-addons/skill-registry.mjs";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { tmp, rm } from "./helpers.mjs";

const KEY = generateOwnerKeyPair(), AUTH = createOwnerAuth({ publicKeyB64: KEY.publicKeyB64 });
const sign = (verb, subject) => issueOwnerApproval({ privateKeyPem: KEY.privateKeyPem, action: "SKILL_" + verb, subject });
/** A registry whose OWNER calls carry a freshly signed approval unless the test passes its own: lets the older tests keep their shape while the approval itself is tested separately below. */
function mk(o = {}) {
  const r = createSkillRegistry({ ownerAuth: AUTH, ...o });
  const withAp = (verb, f, argsOf) => (...a) => { const opts = a[a.length - 1]; if (opts && typeof opts === "object" && opts.actor === "OWNER" && opts.ownerApproval === undefined) { const sub = r.subject(verb, ...argsOf(a)); if (sub) a[a.length - 1] = { ...opts, ownerApproval: sign(verb, sub) }; } return f(...a); };
  return { ...r, activate: withAp("ACTIVATE", r.activate, a => [a[0], a[1], a[2]]), rollback: withAp("ROLLBACK", r.rollback, a => [a[0], a[1], a[2]]), deactivate: withAp("DEACTIVATE", r.deactivate, a => [a[0], a[1], null]) };
}

const T = "T";
function acts(log = []) {
  return {
    upper: { run: async a => { log.push(["upper", a]); if (typeof a.text !== "string") throw new Error("TEXT_REQUIRED"); return { text: a.text.toUpperCase(), n: a.text.length }; }, idempotent: true, rewindable: true },
    count: { run: async a => ({ n: a.value }), idempotent: true, rewindable: true },
    save: { run: async a => { log.push(["save", a]); return { saved: a.text }; }, idempotent: false, rewindable: false },
    half: { run: async a => ({ n: a.value }), idempotent: true },
    hang: { run: () => new Promise(() => {}), idempotent: true, rewindable: true },
    rwonly: { run: async a => ({ n: a.value }), rewindable: true },
  };
}
const good = (o = {}) => ({
  tenantId: T, id: "shout", name: "Shout", description: "Upper-case a text", params: { text: { type: "string", required: true } },
  steps: [{ id: "u", action: "upper", args: { text: "{{p.text}}" } }], permissions: ["upper"],
  tests: [{ name: "upper-cases", params: { text: "abc" }, expect: { outputs: { u: { text: "ABC", n: 3 } } } }, { name: "refuses a missing text", negative: true, params: {}, expect: { refused: "PARAMETER_REQUIRED" } }],
  submittedBy: "OWNER", ...o
});

test("only pure computation actions are available to skills (idempotent AND rewindable); writes and half-declared actions are refused with a precise reason", () => {
  const r = mk({ actions: acts() });
  assert.deepEqual(r.pureActions(), ["count", "hang", "upper"]);
  assert.equal(r.submit(good({ steps: [{ id: "s", action: "rwonly", args: { value: 1 } }], permissions: ["rwonly"] })).reason, "ACTION_NOT_PURE_COMPUTATION:rwonly");
  assert.equal(r.submit(good({ steps: [{ id: "s", action: "save", args: { text: "x" } }], permissions: ["save"] })).reason, "ACTION_NOT_PURE_COMPUTATION:save");
  assert.equal(r.submit(good({ steps: [{ id: "s", action: "half", args: { value: 1 } }], permissions: ["half"] })).reason, "ACTION_NOT_PURE_COMPUTATION:half");
  assert.equal(r.submit(good({ steps: [{ id: "s", action: "rm_rf", args: {} }], permissions: ["rm_rf"] })).reason, "UNKNOWN_ACTION:rm_rf");
  assert.equal(r.submit(good({ permissions: ["upper", "count"] })).reason, "DECLARED_PERMISSIONS_MUST_EQUAL_USED_ACTIONS");
  assert.equal(r.submit(good({ permissions: [] })).reason, "DECLARED_PERMISSIONS_MUST_EQUAL_USED_ACTIONS");
  assert.equal(r.submit(good({ permissions: ["save", "upper"] })).reason, "PERMISSION_NOT_AVAILABLE:save");
  assert.equal(r.submit(good({ permissions: undefined })).reason, "PERMISSIONS_DECLARATION_REQUIRED");
  assert.equal(r.submit(good({ permissions: [5] })).reason, "PERMISSIONS_DECLARATION_REQUIRED");
  assert.match(r.submit(good({ steps: [{ id: "u", action: "upper", args: { text: "{{p.nope}}" } }] })).reason, /^TEMPLATE_UNKNOWN_PARAMETER/);
  for (const [patch, reason] of [[{ tenantId: undefined }, "TENANT_REQUIRED"], [{ id: "Bad Id" }, "SKILL_ID_INVALID"], [{ name: " " }, "NAME_REQUIRED"], [{ name: "x".repeat(121) }, "NAME_REQUIRED"], [{ description: "x".repeat(LIMITS.maxText + 1) }, "DESCRIPTION_INVALID"], [{ submittedBy: "SEARCH-6x" }, "SUBMITTER_INVALID"], [{ submittedBy: "owner" }, "SUBMITTER_INVALID"], [{ tests: [] }, "TESTS_INVALID"], [{ tests: undefined }, "TESTS_INVALID"], [{ steps: [] }, "STEPS_INVALID"], [{ steps: undefined }, "STEPS_INVALID"]]) assert.equal(r.submit(good(patch)).reason, reason, JSON.stringify(patch));
  assert.equal(r.list(T).length, 0, "nothing was stored by any refused submission");
});
test("test gate: needs a positive AND a negative test; a skill that cannot demonstrate a refusal never becomes TESTED; failing, hanging and unmet expectations fail the gate", async () => {
  const r = mk({ actions: acts() });
  const only = r.submit(good({ tests: [{ name: "a", params: { text: "a" }, expect: { outputs: { u: { text: "A" } } } }, { name: "b", params: { text: "b" }, expect: { outputs: { u: { text: "B" } } } }] }));
  assert.deepEqual(await r.runGate(T, "shout", only.version), { ok: true, passed: false, reason: "NEEDS_POSITIVE_AND_NEGATIVE_TESTS" });
  const neg = r.submit(good({ steps: [{ id: "u", action: "upper", args: { text: "{{p.text}}" } }, { id: "c", action: "count", args: { value: 1 } }], permissions: ["upper", "count"], tests: [{ negative: true, params: {} }, { negative: true, params: {} }] }));
  assert.equal((await r.runGate(T, "shout", neg.version)).passed, false);
  const wrong = r.submit(good({ steps: [{ id: "u", action: "upper", args: { text: "{{p.text}}" } }, { id: "c", action: "count", args: { value: 2 } }], permissions: ["upper", "count"], tests: [{ name: "wrong", params: { text: "a" }, expect: { outputs: { u: { text: "NOPE" } } } }, { name: "neg", negative: true, params: {}, expect: { refused: "PARAMETER_REQUIRED" } }] }));
  const w = await r.runGate(T, "shout", wrong.version); assert.deepEqual([w.passed, w.results[0].passed, w.results[0].why, w.results[1].passed], [false, false, "EXPECTATION_NOT_MET:DONE", true]);
  const noexp = r.submit(good({ steps: [{ id: "u", action: "upper", args: { text: "{{p.text}}" } }, { id: "c", action: "count", args: { value: 3 } }], permissions: ["upper", "count"], tests: [{ name: "no expectation", params: { text: "a" } }, { name: "concrete", params: { text: "a" }, expect: { outputs: { u: { text: "A" } } } }, { negative: true, params: {}, expect: { refused: "PARAMETER_REQUIRED" } }] }));
  assert.equal((await r.runGate(T, "shout", noexp.version)).results[0].why, "EXPECTATION_REQUIRED", "a test without any expectation proves nothing");
  const nf = r.submit(good({ steps: [{ id: "u", action: "upper", args: { text: "{{p.text}}" } }, { id: "c", action: "count", args: { value: 4 } }], permissions: ["upper", "count"], tests: [{ name: "pos", params: { text: "a" }, expect: { outputs: { u: { text: "A" } } } }, { name: "neg that succeeds", negative: true, params: { text: "a" }, expect: { status: "FAILED" } }] }));
  const n = await r.runGate(T, "shout", nf.version); assert.deepEqual([n.passed, n.results[1].why], [false, "NEGATIVE_TEST_DID_NOT_FAIL:DONE"]);
  const ok = r.submit(good({ steps: [{ id: "u", action: "upper", args: { text: "{{p.text}}" } }, { id: "c", action: "count", args: { value: 5 } }], permissions: ["upper", "count"] })), g = await r.runGate(T, "shout", ok.version);
  assert.deepEqual([g.passed, g.results.map(x => x.passed)], [true, [true, true]]); assert.equal(r.get(T, "shout").skill.versions.find(v => v.version === ok.version).status, "TESTED");
  assert.equal((await r.runGate(T, "shout", 99)).reason, "VERSION_NOT_FOUND"); assert.equal((await r.runGate(T, "nope", 1)).reason, "VERSION_NOT_FOUND");
});
test("a failing step inside a negative test counts as the demanded refusal; a throwing action in a positive test fails it (never propagates)", async () => {
  const r = mk({ actions: acts() });
  const s = r.submit(good({ tests: [{ name: "pos", params: { text: "ok" }, expect: { status: "DONE", outputs: { u: { text: "OK" } } } }, { name: "step fails", negative: true, params: { text: "x" }, expect: { status: "FAILED" } }], steps: [{ id: "u", action: "upper", args: { text: "{{p.text}}" } }] }));
  // upper never fails with a string, so the negative test must NOT pass
  assert.equal((await r.runGate(T, "shout", s.version)).passed, false);
  const bad = mk({ actions: { upper: { run: async () => { throw new Error("always"); }, idempotent: true, rewindable: true } } });
  const b = bad.submit(good({ tests: [{ name: "pos", params: { text: "ok" }, expect: { status: "DONE", outputs: { u: { text: "OK" } } } }, { name: "neg", negative: true, params: { text: "x" }, expect: { status: "FAILED" } }] })), gb = await bad.runGate(T, "shout", b.version);
  assert.deepEqual([gb.passed, gb.results.map(x => x.passed)], [false, [false, true]]);
});
test("activation: OWNER only, only after a passed gate for exactly this content; editing creates a new version and the active one keeps running; rollback and deactivate are OWNER only", async () => {
  const r = mk({ actions: acts() });
  const v1 = r.submit(good()); assert.deepEqual([v1.ok, v1.version, v1.status], [true, 1, "SUBMITTED"]);
  assert.equal(r.activate(T, "shout", 1, { actor: "OWNER" }).reason, "TEST_GATE_NOT_PASSED_FOR_THIS_CONTENT");
  assert.equal((await r.runGate(T, "shout", 1)).passed, true);
  for (const actor of ["EXECUTION-3", "SEARCH-1", "SYSTEM", "owner", "OWNER ", "JOCI", undefined, null]) assert.equal(r.activate(T, "shout", 1, { actor }).reason, "ONLY_OWNER_MAY_ACTIVATE", String(actor));
  assert.equal(r.activate(T, "shout", 7, { actor: "OWNER" }).reason, "VERSION_NOT_FOUND"); assert.equal(r.activate(T, "shout", 1).reason, "ONLY_OWNER_MAY_ACTIVATE");
  assert.deepEqual(r.activate(T, "shout", 1, { actor: "OWNER" }), { ok: true, active: 1 }); assert.equal(r.activate(T, "shout", 1, { actor: "OWNER" }).reason, "ALREADY_ACTIVE");
  const out = await r.run(T, "shout", { text: "hi" }); assert.deepEqual([out.ok, out.version, out.outputs.u.text], [true, 1, "HI"]);
  assert.equal((await r.run(T, "shout", {})).reason, "PARAMETER_REQUIRED:text"); assert.equal((await r.run(T, "nope", {})).reason, "SKILL_NOT_ACTIVE"); assert.equal((await r.run("OTHER", "shout", { text: "x" })).reason, "SKILL_NOT_ACTIVE");
  assert.equal(r.submit(good()).reason, "IDENTICAL_VERSION_EXISTS");
  const v2 = r.submit({ ...good(), steps: [{ id: "u", action: "upper", args: { text: "{{p.text}}!" } }], tests: [{ name: "bang", params: { text: "a" }, expect: { outputs: { u: { text: "A!" } } } }, { name: "neg", negative: true, params: {}, expect: { refused: "PARAMETER_REQUIRED" } }] });
  assert.equal(v2.version, 2); assert.equal((await r.run(T, "shout", { text: "a" })).outputs.u.text, "A", "the active version keeps running until the owner switches");
  assert.equal(r.activate(T, "shout", 2, { actor: "OWNER" }).reason, "TEST_GATE_NOT_PASSED_FOR_THIS_CONTENT"); await r.runGate(T, "shout", 2); assert.equal(r.activate(T, "shout", 2, { actor: "OWNER" }).ok, true);
  assert.equal((await r.run(T, "shout", { text: "a" })).outputs.u.text, "A!"); assert.equal(r.get(T, "shout").skill.versions[0].status, "SUPERSEDED");
  assert.equal(r.rollback(T, "shout", 1, { actor: "EXECUTION-1" }).reason, "ONLY_OWNER_MAY_ROLLBACK"); assert.equal(r.rollback(T, "shout", 2, { actor: "OWNER" }).reason, "ROLLBACK_TARGET_MUST_BE_EARLIER"); assert.equal(r.rollback(T, "shout", 3, { actor: "EXECUTION-1" }).reason, "ONLY_OWNER_MAY_ROLLBACK");
  assert.equal(r.rollback(T, "shout", 1, { actor: "OWNER" }).ok, true); assert.equal((await r.run(T, "shout", { text: "a" })).outputs.u.text, "A");
  assert.equal(r.deactivate(T, "shout", { actor: "SEARCH-2" }).reason, "ONLY_OWNER_MAY_DEACTIVATE"); assert.equal(r.deactivate(T, "shout", { actor: "OWNER" }).ok, true);
  assert.equal((await r.run(T, "shout", { text: "a" })).reason, "SKILL_NOT_ACTIVE"); assert.equal(r.deactivate(T, "shout", { actor: "OWNER" }).reason, "NOT_ACTIVE");
  assert.equal(r.activate(T, "shout", 1, { actor: "OWNER" }).reason, "VERSION_REVOKED", "a deactivated (revoked) version needs a new submission");
  assert.deepEqual(r.get(T, "shout").skill.versions[0].history.map(h => h.status), ["SUBMITTED", "TESTED", "ACTIVE", "SUPERSEDED", "ACTIVE", "REVOKED"]);
});
test("agents can submit drafts but nothing they submit can run or activate; tenants are isolated; stored content is re-hashed (tampering with the file is detected on run and activation)", async () => {
  const d = tmp("sk-"), f = path.join(d, "s.json");
  try {
    const r = mk({ file: f, actions: acts() });
    assert.equal(r.submit(good({ submittedBy: "EXECUTION-7" })).ok, true); assert.equal((await r.run(T, "shout", { text: "x" })).reason, "SKILL_NOT_ACTIVE");
    await r.runGate(T, "shout", 1); assert.equal(r.activate(T, "shout", 1, { actor: "EXECUTION-7" }).ok, false);
    assert.equal(r.list("OTHER").length, 0); assert.equal(r.get("OTHER", "shout").reason, "NOT_FOUND");
    r.activate(T, "shout", 1, { actor: "OWNER" });
    const r2 = mk({ file: f, actions: acts() }); assert.equal((await r2.run(T, "shout", { text: "z" })).outputs.u.text, "Z", "survives a restart");
    const fs = await import("node:fs"); const doc = JSON.parse(fs.readFileSync(f, "utf8")); const k = Object.keys(doc.skills)[0]; doc.skills[k].versions[0].definition.steps[0].args.text = "evil {{p.text}}"; fs.writeFileSync(f, JSON.stringify(doc));
    const r3 = mk({ file: f, actions: acts() }); assert.equal((await r3.run(T, "shout", { text: "z" })).reason, "STORED_VERSION_TAMPERED"); assert.equal((await r3.runGate(T, "shout", 1)).reason, "STORED_VERSION_TAMPERED");
    const doc2 = JSON.parse(fs.readFileSync(f, "utf8")); doc2.skills[k].versions[0].definition.steps[0].args.text = "{{p.text}}"; doc2.skills[k].versions[0].definition.steps[0].action = "save"; fs.writeFileSync(f, JSON.stringify(doc2));
    assert.equal((await mk({ file: f, actions: acts() }).run(T, "shout", { text: "z" })).reason, "STORED_VERSION_TAMPERED");
  } finally { rm(d); }
});
test("permission boundary is enforced again at run time: if the host stops offering a pure action, an ACTIVE skill that uses it stops running; kill switch stops runs; a throwing stop check fails closed", async () => {
  let stop = false; const a = acts(), r = mk({ file: null, actions: a, isStopped: () => { if (stop === "throw") throw new Error("x"); return stop; } });
  r.submit(good()); await r.runGate(T, "shout", 1); r.activate(T, "shout", 1, { actor: "OWNER" });
  assert.equal((await r.run(T, "shout", { text: "a" })).ok, true);
  stop = true; assert.equal((await r.run(T, "shout", { text: "a" })).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); stop = "throw"; assert.equal((await r.run(T, "shout", { text: "a" })).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
  stop = false; a.upper.rewindable = false; assert.equal((await r.run(T, "shout", { text: "a" })).reason, "ACTION_NOT_PURE_COMPUTATION:upper"); a.upper.rewindable = true; assert.equal((await r.run(T, "shout", { text: "a" })).ok, true); delete a.upper; assert.equal((await r.run(T, "shout", { text: "a" })).reason, "UNKNOWN_ACTION:upper");
});

test("limits: at most 20 tests per version, 20 versions per skill and 200 skills; the refused attempt stores nothing", () => {
  const r = mk({ actions: acts() });
  const many = n => Array.from({ length: n }, (_, i) => ({ name: "t" + i, negative: i === 0, params: {}, expect: {} }));
  assert.equal(r.submit(good({ tests: many(LIMITS.maxTests + 1) })).reason, "TESTS_INVALID"); assert.equal(r.submit(good({ tests: many(LIMITS.maxTests) })).ok, true);
  for (let i = 2; i <= LIMITS.maxVersions; i++) assert.equal(r.submit(good({ steps: [{ id: "u", action: "upper", args: { text: "{{p.text}}" + "!".repeat(i) } }] })).version, i);
  assert.equal(r.submit(good({ steps: [{ id: "u", action: "upper", args: { text: "{{p.text}}" + "?" } }] })).reason, "TOO_MANY_VERSIONS"); assert.equal(r.get(T, "shout").skill.versions.length, LIMITS.maxVersions);
  for (let i = 1; i < LIMITS.maxSkills; i++) assert.equal(r.submit(good({ id: "s" + i })).ok, true, "s" + i);
  assert.equal(r.submit(good({ id: "one-too-many" })).reason, "TOO_MANY_SKILLS"); assert.equal(r.list(T).length, LIMITS.maxSkills);
  assert.equal(r.submit(good({ id: "s1", steps: [{ id: "u", action: "upper", args: { text: "{{p.text}}#" } }] })).ok, true, "adding a version to an existing skill is not blocked by the skill cap");
});
test("negative-test expectations are checked: a refusal for the WRONG reason, or a failure with the wrong status, does not satisfy the test", async () => {
  const r = mk({ actions: acts() });
  const wrongReason = r.submit(good({ tests: [good().tests[0], { name: "neg", negative: true, params: {}, expect: { refused: "SOMETHING_ELSE" } }] }));
  const g1 = await r.runGate(T, "shout", wrongReason.version); assert.deepEqual([g1.passed, g1.results[1].why], [false, "START_REFUSED:PARAMETER_REQUIRED:text"]);
  const failing = mk({ actions: { upper: { run: async a => { if (a.text === "x") throw new Error("always"); return { text: a.text.toUpperCase() }; }, idempotent: true, rewindable: true } } });
  const wrongStatus = failing.submit(good({ tests: [{ name: "pos", params: { text: "a" }, expect: { status: "DONE", outputs: { u: { text: "A" } } } }, { name: "neg", negative: true, params: { text: "x" }, expect: { status: "PAUSED" } }] }));
  const g2 = await failing.runGate(T, "shout", wrongStatus.version); assert.deepEqual([g2.passed, g2.results.map(x => x.passed), g2.results[1].why], [false, [true, false], "NEGATIVE_TEST_DID_NOT_FAIL:FAILED"]);
});
test("activation re-verifies the stored gate: a doctored gate hash or a definition edited after the gate cannot be activated", async () => {
  const fs = await import("node:fs"), d = tmp("sk2-"), f = path.join(d, "s.json");
  try {
    const r = mk({ file: f, actions: acts() }); r.submit(good()); await r.runGate(T, "shout", 1);
    const doc = JSON.parse(fs.readFileSync(f, "utf8")), k = Object.keys(doc.skills)[0];
    doc.skills[k].versions[0].gate.hash = "0".repeat(64); fs.writeFileSync(f, JSON.stringify(doc));
    assert.equal(mk({ file: f, actions: acts() }).activate(T, "shout", 1, { actor: "OWNER" }).reason, "TEST_GATE_NOT_PASSED_FOR_THIS_CONTENT");
    const doc2 = JSON.parse(fs.readFileSync(f, "utf8")); doc2.skills[k].versions[0].gate.hash = doc2.skills[k].versions[0].hash; doc2.skills[k].versions[0].definition.steps[0].args.text = "x{{p.text}}"; fs.writeFileSync(f, JSON.stringify(doc2));
    assert.equal(mk({ file: f, actions: acts() }).activate(T, "shout", 1, { actor: "OWNER" }).reason, "TEST_GATE_NOT_PASSED_FOR_THIS_CONTENT");
  } finally { rm(d); }
});

test("owner approval: activate, rollback and deactivate each need a signed single-use approval bound to this exact skill version and content; a refused change never burns an approval", async () => {
  const r = createSkillRegistry({ actions: acts(), ownerAuth: AUTH }); r.submit(good()); await r.runGate(T, "shout", 1);
  const sub = r.subject("ACTIVATE", T, "shout", 1); assert.match(sub, /^T\/shout@1#[0-9a-f]{64}$/); assert.equal(r.subject("ACTIVATE", T, "shout", 9), null); assert.equal(r.subject("ACTIVATE", T, "nope", 1), null);
  const O = ap => ({ actor: "OWNER", ownerApproval: ap });
  assert.match(r.activate(T, "shout", 1, { actor: "OWNER" }).reason, /^OWNER_APPROVAL_REQUIRED/, "no approval at all");
  for (const bad of [true, "x", {}, sign("ROLLBACK", sub), sign("ACTIVATE", sub + "x"), sign("ACTIVATE", "T/shout@2#" + "0".repeat(64)), sign("DEACTIVATE", sub)]) assert.match(r.activate(T, "shout", 1, O(bad)).reason, /^OWNER_APPROVAL_REQUIRED/, JSON.stringify(bad).slice(0, 40));
  const other = generateOwnerKeyPair(); assert.match(r.activate(T, "shout", 1, O(issueOwnerApproval({ privateKeyPem: other.privateKeyPem, action: "SKILL_ACTIVATE", subject: sub }))).reason, /^OWNER_APPROVAL_REQUIRED/, "signed by another key");
  assert.equal(r.get(T, "shout").skill.active, null, "nothing changed");
  const good1 = sign("ACTIVATE", sub); assert.deepEqual(r.activate(T, "shout", 1, O(good1)), { ok: true, active: 1 });
  assert.match(r.deactivate(T, "shout", O(good1)).reason, /^OWNER_APPROVAL_REQUIRED/, "an approval for one action cannot be used for another"); assert.equal(r.get(T, "shout").skill.active, 1);
  // a refused change (wrong actor / not gated) does not consume the approval
  r.submit({ ...good(), steps: [{ id: "u", action: "upper", args: { text: "{{p.text}}!" } }], tests: [{ name: "bang", params: { text: "a" }, expect: { outputs: { u: { text: "A!" } } } }, { name: "neg", negative: true, params: {}, expect: { refused: "PARAMETER_REQUIRED" } }] });
  const s2 = r.subject("ACTIVATE", T, "shout", 2), ap2 = sign("ACTIVATE", s2);
  assert.equal(r.activate(T, "shout", 2, O(ap2)).reason, "TEST_GATE_NOT_PASSED_FOR_THIS_CONTENT"); assert.equal(r.activate(T, "shout", 2, { actor: "EXECUTION-1", ownerApproval: ap2 }).reason, "ONLY_OWNER_MAY_ACTIVATE");
  await r.runGate(T, "shout", 2); assert.equal(r.activate(T, "shout", 2, O(ap2)).ok, true, "the same approval still works after the earlier refusals");
  assert.match(r.activate(T, "shout", 2, O(ap2)).reason, /ALREADY_ACTIVE|OWNER_APPROVAL_REQUIRED/);
  const rb = sign("ROLLBACK", r.subject("ROLLBACK", T, "shout", 1)); assert.match(r.rollback(T, "shout", 1, O(sign("ACTIVATE", r.subject("ROLLBACK", T, "shout", 1)))).reason, /^OWNER_APPROVAL_REQUIRED/); assert.equal(r.rollback(T, "shout", 1, O(rb)).ok, true);
  assert.match(r.rollback(T, "shout", 1, O(rb)).reason, /ROLLBACK_TARGET_MUST_BE_EARLIER/);
  const dv = sign("DEACTIVATE", r.subject("DEACTIVATE", T, "shout")); assert.equal(r.deactivate(T, "shout", O(dv)).ok, true); assert.match(r.deactivate(T, "shout", O(dv)).reason, /NOT_ACTIVE/);
  assert.equal(createSkillRegistry({ actions: acts() }).activate(T, "shout", 1, { actor: "OWNER", ownerApproval: good1 }).reason, "VERSION_NOT_FOUND", "no owner key configured and nothing stored");
  const noauth = createSkillRegistry({ actions: acts() }); noauth.submit(good()); await noauth.runGate(T, "shout", 1); assert.equal(noauth.activate(T, "shout", 1, { actor: "OWNER", ownerApproval: good1 }).reason, "OWNER_AUTH_REQUIRED", "without an owner key nothing can be activated");
  const throwing = createSkillRegistry({ actions: acts(), ownerAuth: () => { throw new Error("x"); } }); throwing.submit(good()); await throwing.runGate(T, "shout", 1); assert.equal(throwing.activate(T, "shout", 1, { actor: "OWNER", ownerApproval: good1 }).reason, "OWNER_AUTH_REQUIRED");
  const lazy = createSkillRegistry({ actions: acts(), ownerAuth: () => AUTH }); lazy.submit(good()); await lazy.runGate(T, "shout", 1); assert.equal(lazy.activate(T, "shout", 1, O(sign("ACTIVATE", lazy.subject("ACTIVATE", T, "shout", 1)))).ok, true, "ownerAuth may be a function resolved at use");
});

test("the gate demands concrete expectations: a vacuous or constant-output skill cannot reach TESTED", async () => {
  const r = mk({ actions: { ...acts(), konst: { run: async () => ({ text: "WRONG" }), idempotent: true, rewindable: true } } });
  const vac = r.submit(good({ steps: [{ id: "u", action: "konst", args: {} }], permissions: ["konst"], params: { text: { type: "string", required: true } }, tests: [{ name: "p", params: { text: "a" }, expect: { outputs: {} } }, { name: "n", negative: true, params: {}, expect: { refused: "PARAMETER_REQUIRED" } }] }));
  const g = await r.runGate(T, "shout", vac.version); assert.deepEqual([g.passed, g.reason], [false, "TESTS_MUST_CHECK_CONCRETE_OUTPUTS_AND_A_NAMED_REFUSAL"]);
  const statusOnly = r.submit(good({ steps: [{ id: "u", action: "konst", args: {} }, { id: "k", action: "count", args: { value: 1 } }], permissions: ["konst", "count"], tests: [{ name: "p", params: { text: "a" }, expect: { status: "DONE" } }, { name: "n", negative: true, params: {}, expect: { refused: "PARAMETER_REQUIRED" } }] }));
  assert.equal((await r.runGate(T, "shout", statusOnly.version)).reason, "TESTS_MUST_CHECK_CONCRETE_OUTPUTS_AND_A_NAMED_REFUSAL");
  const nested = r.submit(good({ steps: [{ id: "u", action: "konst", args: {} }, { id: "k", action: "count", args: { value: 2 } }], permissions: ["konst", "count"], tests: [{ name: "p", params: { text: "a" }, expect: { outputs: { u: {} } } }, { name: "n", negative: true, params: {}, expect: { refused: "PARAMETER_REQUIRED" } }] }));
  assert.equal((await r.runGate(T, "shout", nested.version)).passed, false, "empty nested expectation is still vacuous");
  const anyNeg = r.submit(good({ steps: [{ id: "u", action: "upper", args: { text: "{{p.text}}" } }, { id: "k", action: "count", args: { value: 3 } }], permissions: ["upper", "count"], tests: [good().tests[0], { name: "n", negative: true, params: {} }] }));
  assert.equal((await r.runGate(T, "shout", anyNeg.version)).reason, "TESTS_MUST_CHECK_CONCRETE_OUTPUTS_AND_A_NAMED_REFUSAL", "a negative test must name its expected refusal or status");
  assert.equal(r.get(T, "shout").skill.versions.every(v => v.status === "TEST_FAILED"), true);
});

test("re-running the gate on the ACTIVE version keeps it ACTIVE; a failing re-run switches it off; a stopped system records nothing; run() requires the passed gate", async () => {
  const fs = await import("node:fs"), d = tmp("sk3-"), f = path.join(d, "s.json"); try {
    let stop = false, broken = false; const a = acts(); const r = mk({ file: f, actions: { ...a, upper: { ...a.upper, run: async x => (broken ? { text: "NOPE", n: 0 } : a.upper.run(x)) } }, isStopped: () => stop });
    r.submit(good()); await r.runGate(T, "shout", 1); assert.equal(r.activate(T, "shout", 1, { actor: "OWNER" }).ok, true);
    assert.equal((await r.runGate(T, "shout", 1)).passed, true); const v = () => r.get(T, "shout").skill.versions[0]; assert.equal(v().status, "ACTIVE", "a passing re-run does not demote the active version"); assert.equal(r.get(T, "shout").skill.active, 1);
    stop = true; const before = JSON.stringify(r.get(T, "shout")); assert.equal((await r.runGate(T, "shout", 1)).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); assert.equal(JSON.stringify(r.get(T, "shout")), before, "nothing recorded while stopped"); stop = false;
    broken = true; assert.equal((await r.runGate(T, "shout", 1)).passed, false); assert.equal(r.get(T, "shout").skill.active, null, "a failed re-test switches the skill off"); assert.equal(v().status, "TEST_FAILED"); assert.equal((await r.run(T, "shout", { text: "a" })).reason, "SKILL_NOT_ACTIVE");
    assert.equal(v().history.at(-1).note, "DEACTIVATED_REGATE_FAILED");
    // a hand-edited pointer to a version that never passed its gate does not run
    broken = false; const doc = JSON.parse(fs.readFileSync(f, "utf8")), k = Object.keys(doc.skills)[0]; doc.skills[k].active = 1; fs.writeFileSync(f, JSON.stringify(doc));
    const r2 = mk({ file: f, actions: acts() }); assert.equal((await r2.run(T, "shout", { text: "a" })).reason, "TEST_GATE_NOT_PASSED_FOR_THIS_CONTENT");
  } finally { rm(d); }
});

test("verification fixes M05-2/3/5: a stop during a re-gate records nothing; re-gating never un-revokes; ids must be strings", async () => {
  let stop = false; const r = mk({ actions: acts(), isStopped: () => stop });
  r.submit(good()); assert.equal((await r.runGate(T, "shout", 1)).passed, true); assert.equal(r.activate(T, "shout", 1, { actor: "OWNER" }).ok, true);
  const hist = () => r.get(T, "shout").skill.versions[0].history.length;
  // stop arrives while the tests are running: the active skill is neither deactivated nor annotated
  const slow = mk({ actions: { ...acts(), upper: { ...acts().upper, run: async a => { stop2 = true; return { text: String(a.text).toUpperCase(), n: 1 }; } } }, isStopped: () => stop2 }); let stop2 = false;
  slow.submit(good()); const g = await slow.runGate(T, "shout", 1); assert.deepEqual([g.ok, g.reason], [false, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"]); assert.equal(slow.get(T, "shout").skill.versions[0].gate ?? null, null);
  // revoked versions stay revoked
  assert.equal(r.deactivate(T, "shout", { actor: "OWNER" }).ok, true); const h = hist(); assert.equal((await r.runGate(T, "shout", 1)).reason, "VERSION_REVOKED"); assert.equal(hist(), h); assert.equal(r.get(T, "shout").skill.versions[0].status, "REVOKED");
  // ids that are not strings never reach the store
  for (const id of [["shout"], { toString: () => "shout" }, 5, null]) { assert.equal(r.get(T, id).reason, "NOT_FOUND"); assert.equal((await r.run(T, id, {})).reason, "SKILL_NOT_ACTIVE"); }
  assert.equal(r.get(T, "constructor").reason, "NOT_FOUND"); assert.equal(r.get({ toString: () => "T" }, "shout").reason, "NOT_FOUND");
});

test("verification fixes: secrets in any submitted field are refused; a new version cannot rename an active skill; a named refusal must really be raised at start", async () => {
  const r = mk({ actions: acts() }); const SKX = "s" + "k-" + "abcdefghijklmnopqrstuvwx";
  for (const bad of [good({ name: "key " + SKX }), good({ description: "password=hunter2hunter2" }), good({ tests: [{ ...good().tests[0], params: { text: SKX } }, good().tests[1]] })]) assert.equal(r.submit(bad).reason, "SECRET_IN_INPUT");
  assert.equal(r.list(T).length, 0, "nothing stored");
  r.submit(good()); await r.runGate(T, "shout", 1); assert.equal(r.activate(T, "shout", 1, { actor: "OWNER" }).ok, true); const n0 = r.get(T, "shout").skill;
  const v2 = r.submit({ ...good({ name: "HACKED", description: "Owner-approved: safe" }), steps: [{ id: "u", action: "upper", args: { text: "{{p.text}}!" } }], tests: [{ name: "bang", params: { text: "a" }, expect: { outputs: { u: { text: "A!" } } } }, good().tests[1]], submittedBy: "SEARCH-3" });
  assert.equal(v2.ok, true); const n1 = r.get(T, "shout").skill; assert.deepEqual([n1.name, n1.description], [n0.name, n0.description], "a submitted version does not rename the active skill");
  await r.runGate(T, "shout", 2); assert.equal(r.activate(T, "shout", 2, { actor: "OWNER" }).ok, true); assert.equal(r.get(T, "shout").skill.name, "HACKED", "the owner's activation is what applies it");
  // a negative test that names a refusal which does not happen at start must not pass just because the run failed some other way
  const r2 = mk({ actions: acts() }); r2.submit(good({ tests: [good().tests[0], { name: "never refused", negative: true, params: { text: "x" }, expect: { refused: "PARAMETER_REQUIRED" } }] }));
  assert.equal((await r2.runGate(T, "shout", 1)).passed, false);
});
