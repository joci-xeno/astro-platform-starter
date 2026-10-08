// Skill registry (85-capability audit C05 Skills / reusable capability packages; sits beside the older in-memory skill-factory.mjs, which it does not replace).
//
// A skill is DECLARATIVE: typed parameters, ordered workflow steps and a list of tests. It contains no code. Steps can only call workflow ACTIONS the host registered, and only
// actions that are pure computations (idempotent AND rewindable); anything that writes elsewhere (notes, memory, ...) is refused in v1. Lifecycle of a version:
//   SUBMITTED -> (test gate) -> TESTED | TEST_FAILED -> (OWNER activates) -> ACTIVE -> SUPERSEDED | REVOKED
//  * Permission boundary  - the skill must DECLARE the actions it uses; declared == used, and every one must be a pure host action. Checked at submit AND again at activation and at every run.
//  * Test gate            - at least 2 tests incl. >= 1 NEGATIVE test (a case that must be refused/fail); all run for real in a throwaway engine with no persistent store. The result is tied to the content hash.
//  * Activation           - OWNER only (agents can submit drafts, never activate); only a version whose gate passed for exactly this hash. Editing = a new version; the active one keeps running until the owner switches.
//  * Rollback             - OWNER only, to an earlier version whose gate passed; the replaced version becomes SUPERSEDED, history is kept.
//  * Kill switch          - the engine's stop hook pauses a run; run() reports PAUSED/refused, never runs a step while stopped.
import crypto from "node:crypto";
import { createStore, clone } from "./business/store.mjs";
import { createWorkflowEngine } from "./workflow-engine.mjs";

export const LIMITS = Object.freeze({ maxSkills: 200, maxVersions: 20, maxTests: 20, maxTestSteps: 50, maxText: 2000, testTimeoutMs: 5000 });
const ID = /^[a-z][a-z0-9_-]{0,39}$/, SUBMITTER = /^(OWNER|SYSTEM|(?:SEARCH|EXECUTION)-\d{1,2})$/;
const canon = v => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v ?? null);
const hashOf = d => crypto.createHash("sha256").update(canon({ params: d.params ?? {}, steps: d.steps, permissions: [...d.permissions].sort(), tests: d.tests })).digest("hex");
const subset = (exp, got) => exp && typeof exp === "object" && !Array.isArray(exp) ? got && typeof got === "object" && Object.entries(exp).every(([k, v]) => Object.hasOwn(got, k) && subset(v, got[k])) : JSON.stringify(exp) === JSON.stringify(got);

export function createSkillRegistry({ file = null, actions = {}, isStopped = () => false, now = () => new Date().toISOString() } = {}) {
  const store = createStore({ file, init: () => ({ skills: {} }) }), d = store.data;
  // recomputed on every use: if the host stops declaring an action pure, skills that use it stop validating and running
  const pure = () => Object.fromEntries(Object.entries(actions).filter(([, a]) => a && a.idempotent === true && a.rewindable === true && typeof a.run === "function"));
  const key = (t, id) => t + "\u0000" + id;
  const rec = (t, id) => d.skills[key(t, id)] ?? null;
  const T = "skills";
  const engine = () => createWorkflowEngine({ file: null, actions: pure(), isStopped });

  /** Static checks shared by submit, gate, activate and run. */
  function checkDefinition(def) {
    if (!def || typeof def !== "object") return { ok: false, reason: "DEFINITION_REQUIRED" };
    if (!Array.isArray(def.steps) || !def.steps.length) return { ok: false, reason: "STEPS_INVALID" };
    if (!Array.isArray(def.permissions) || def.permissions.some(p => typeof p !== "string")) return { ok: false, reason: "PERMISSIONS_DECLARATION_REQUIRED" };
    const used = [...new Set(def.steps.map(s => s?.action))].sort(), declared = [...new Set(def.permissions)].sort();
    for (const a of used) if (!Object.hasOwn(pure(), a)) return { ok: false, reason: Object.hasOwn(actions, a) ? "ACTION_NOT_PURE_COMPUTATION:" + a : "UNKNOWN_ACTION:" + a };
    for (const a of declared) if (!Object.hasOwn(pure(), a)) return { ok: false, reason: "PERMISSION_NOT_AVAILABLE:" + a };
    if (used.join() !== declared.join()) return { ok: false, reason: "DECLARED_PERMISSIONS_MUST_EQUAL_USED_ACTIONS" };
    const e = engine(), r = e.saveTemplate({ tenantId: T, id: "check", name: "check", params: def.params, steps: def.steps });
    return r.ok ? { ok: true } : { ok: false, reason: "TEMPLATE_" + r.reason };
  }
  const vis = (s, v) => ({ id: v.id, version: v.version, status: v.status, hash: v.hash, gate: v.gate ? { passed: v.gate.passed, ranAt: v.gate.ranAt, results: v.gate.results } : null });

  function submit({ tenantId, id, name, description = "", params, steps, permissions, tests, submittedBy = "OWNER" } = {}) {
    if (!tenantId || typeof tenantId !== "string") return { ok: false, reason: "TENANT_REQUIRED" };
    if (!ID.test(String(id))) return { ok: false, reason: "SKILL_ID_INVALID" };
    if (typeof name !== "string" || !name.trim() || name.length > 120) return { ok: false, reason: "NAME_REQUIRED" };
    if (typeof description !== "string" || description.length > LIMITS.maxText) return { ok: false, reason: "DESCRIPTION_INVALID" };
    if (!SUBMITTER.test(String(submittedBy))) return { ok: false, reason: "SUBMITTER_INVALID" };
    if (!Array.isArray(tests) || !tests.length || tests.length > LIMITS.maxTests) return { ok: false, reason: "TESTS_INVALID" };
    const c = checkDefinition({ params, steps, permissions }); if (!c.ok) return c;
    let s = rec(tenantId, id);
    if (!s) { if (Object.keys(d.skills).length >= LIMITS.maxSkills) return { ok: false, reason: "TOO_MANY_SKILLS" }; s = d.skills[key(tenantId, id)] = { tenantId, id, name: name.trim(), description, versions: [], active: null, createdAt: now() }; }
    if (s.versions.length >= LIMITS.maxVersions) return { ok: false, reason: "TOO_MANY_VERSIONS" };
    const def = clone({ params: params ?? {}, steps, permissions, tests }), hash = hashOf(def);
    if (s.versions.some(v => v.hash === hash)) return { ok: false, reason: "IDENTICAL_VERSION_EXISTS" };
    s.name = name.trim(); s.description = description;
    const v = { id, version: (s.versions.at(-1)?.version ?? 0) + 1, hash, definition: def, status: "SUBMITTED", submittedBy, submittedAt: now(), gate: null, history: [{ at: now(), status: "SUBMITTED", by: submittedBy }] };
    s.versions.push(v); store.save(); return { ok: true, id, version: v.version, hash, status: v.status };
  }

  /** Run every test for real (throwaway engine, no store). Needs >= 2 tests with >= 1 negative one. Result is bound to the content hash. */
  async function runGate(tenantId, id, version) {
    const s = rec(tenantId, id), v = s?.versions.find(x => x.version === version); if (!v) return { ok: false, reason: "VERSION_NOT_FOUND" };
    if (hashOf(v.definition) !== v.hash) return { ok: false, reason: "STORED_VERSION_TAMPERED" };
    const c = checkDefinition(v.definition); if (!c.ok) return c;
    const tests = v.definition.tests;
    if (!tests.some(t => t?.negative === true) || !tests.some(t => t?.negative !== true)) { v.status = "TEST_FAILED"; v.gate = { passed: false, hash: v.hash, ranAt: now(), results: [], reason: "NEEDS_POSITIVE_AND_NEGATIVE_TESTS" }; v.history.push({ at: now(), status: "TEST_FAILED", by: "GATE" }); store.save(); return { ok: true, passed: false, reason: v.gate.reason }; }
    const results = [];
    for (const [i, t] of tests.entries()) {
      const name = typeof t?.name === "string" ? t.name.slice(0, 80) : "test-" + (i + 1); let passed = false, why = "";
      try {
        const e = engine(); e.saveTemplate({ tenantId: T, id: "t", name: "t", params: v.definition.params, steps: v.definition.steps });
        const st = e.start({ tenantId: T, templateId: "t", params: t?.params ?? {} });
        if (!st.ok) { passed = t.negative === true && (t.expect?.refused === undefined || String(st.reason).startsWith(t.expect.refused)); why = passed ? "" : "START_REFUSED:" + st.reason; }
        else {
          const r = await Promise.race([e.execute(st.id, { tenantId: T }), new Promise(res => setTimeout(() => res({ status: "TIMEOUT" }), LIMITS.testTimeoutMs))]);
          const inst = e.getInstance(st.id, { tenantId: T }).instance, want = t.expect ?? {};
          if (t.negative === true) { passed = r.status !== "DONE" && (want.status === undefined || r.status === want.status); why = passed ? "" : "NEGATIVE_TEST_DID_NOT_FAIL:" + r.status; }
          else { const outputs = Object.fromEntries(inst.steps.map(s2 => [s2.id, s2.output])); passed = r.status === (want.status ?? "DONE") && subset(want.outputs ?? {}, outputs) && (want.outputs !== undefined || want.status !== undefined); why = passed ? "" : (want.outputs === undefined && want.status === undefined ? "EXPECTATION_REQUIRED" : "EXPECTATION_NOT_MET:" + r.status); }
        }
      } catch (err) { why = "THREW:" + String(err.message).slice(0, 80); }
      results.push({ name, negative: t?.negative === true, passed, ...(why ? { why } : {}) });
    }
    const passed = results.every(r => r.passed);
    v.gate = { passed, hash: v.hash, ranAt: now(), results }; v.status = passed ? "TESTED" : "TEST_FAILED"; v.history.push({ at: now(), status: v.status, by: "GATE" }); store.save();
    return { ok: true, passed, results };
  }

  function switchTo(tenantId, id, version, actor, verb) {
    if (actor !== "OWNER") return { ok: false, reason: "ONLY_OWNER_MAY_" + verb };
    const s = rec(tenantId, id), v = s?.versions.find(x => x.version === version); if (!v) return { ok: false, reason: "VERSION_NOT_FOUND" };
    if (v.status === "REVOKED") return { ok: false, reason: "VERSION_REVOKED" };
    if (!v.gate?.passed || v.gate.hash !== v.hash || hashOf(v.definition) !== v.hash) return { ok: false, reason: "TEST_GATE_NOT_PASSED_FOR_THIS_CONTENT" };
    const c = checkDefinition(v.definition); if (!c.ok) return c;
    if (s.active === version) return { ok: false, reason: "ALREADY_ACTIVE" };
    const prev = s.versions.find(x => x.version === s.active); if (prev) { prev.status = "SUPERSEDED"; prev.history.push({ at: now(), status: "SUPERSEDED", by: actor }); }
    s.active = version; v.status = "ACTIVE"; v.history.push({ at: now(), status: "ACTIVE", by: actor }); store.save(); return { ok: true, active: version };
  }
  const activate = (tenantId, id, version, { actor } = {}) => switchTo(tenantId, id, version, actor, "ACTIVATE");
  const rollback = (tenantId, id, version, { actor } = {}) => { const s = rec(tenantId, id); if (s && version >= (s.active ?? 0)) return actor === "OWNER" ? { ok: false, reason: "ROLLBACK_TARGET_MUST_BE_EARLIER" } : { ok: false, reason: "ONLY_OWNER_MAY_ROLLBACK" }; return switchTo(tenantId, id, version, actor, "ROLLBACK"); };
  function deactivate(tenantId, id, { actor } = {}) {
    if (actor !== "OWNER") return { ok: false, reason: "ONLY_OWNER_MAY_DEACTIVATE" };
    const s = rec(tenantId, id); if (!s || s.active === null) return { ok: false, reason: "NOT_ACTIVE" };
    const v = s.versions.find(x => x.version === s.active); v.status = "REVOKED"; v.history.push({ at: now(), status: "REVOKED", by: actor }); s.active = null; store.save(); return { ok: true };
  }
  /** Run the ACTIVE version. Re-checks the content hash and the permission boundary on every run. */
  async function run(tenantId, id, params = {}) {
    const s = rec(tenantId, id); if (!s || s.active === null) return { ok: false, reason: "SKILL_NOT_ACTIVE" };
    const v = s.versions.find(x => x.version === s.active);
    if (hashOf(v.definition) !== v.hash) return { ok: false, reason: "STORED_VERSION_TAMPERED" };
    const c = checkDefinition(v.definition); if (!c.ok) return c;
    let stopped = true; try { stopped = Boolean(isStopped()); } catch { /* fail closed */ }
    if (stopped) return { ok: false, reason: "OWNER_STOP_OR_SAFE_MODE_ACTIVE" };
    const e = engine(); e.saveTemplate({ tenantId: T, id: "run", name: s.name, params: v.definition.params, steps: v.definition.steps });
    const st = e.start({ tenantId: T, templateId: "run", params }); if (!st.ok) return { ok: false, reason: st.reason };
    const r = await e.execute(st.id, { tenantId: T }), inst = e.getInstance(st.id, { tenantId: T }).instance;
    return { ok: r.status === "DONE", status: r.status, version: v.version, outputs: Object.fromEntries(inst.steps.map(x => [x.id, x.output])), ...(r.reason ? { reason: r.reason } : {}) };
  }
  const list = tenantId => Object.values(d.skills).filter(s => s.tenantId === tenantId).map(s => ({ id: s.id, name: s.name, description: s.description, active: s.active, versions: s.versions.map(v => vis(s, v)) }));
  const get = (tenantId, id) => { const s = rec(tenantId, id); return s ? { ok: true, skill: { id: s.id, name: s.name, description: s.description, active: s.active, versions: s.versions.map(v => ({ ...vis(s, v), definition: clone(v.definition), history: clone(v.history) })) } } : { ok: false, reason: "NOT_FOUND" }; };
  return { submit, runGate, activate, rollback, deactivate, run, list, get, pureActions: () => Object.keys(pure()).sort(), limits: LIMITS };
}
