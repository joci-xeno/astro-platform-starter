import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createWorkflowEngine, LIMITS } from "../atlasz-addons/workflow-engine.mjs";
import { tmp, rm } from "./helpers.mjs";

const T = { tenantId: "T" };
function mkActions(log = []) {
  return {
    upper: { run: async a => { log.push(["upper", a]); return { text: String(a.text).toUpperCase(), n: String(a.text).length }; }, idempotent: true, rewindable: true },
    count: { run: async a => { log.push(["count", a]); return { n: a.value }; }, idempotent: true, rewindable: true },
    save: { run: async a => { log.push(["save", a]); return { saved: a.text }; }, idempotent: false, rewindable: false },   // external side effect: not repeatable, not rewindable
    boom: { run: async () => { throw new Error("kaboom " + "s" + "k-ABCDEFGHIJKLMNOPQRSTUVWX"); } },
    flaky: (() => { let n = 0; return { run: async () => { if (++n < 3) throw new Error("try " + n); return { n }; }, idempotent: true, rewindable: true }; })(),
    hang: { run: () => new Promise(() => {}), idempotent: false },
  };
}
const tpl = (extra = {}) => ({ ...T, id: "greet", name: "Greeting", params: { who: { type: "string", required: true }, loud: { type: "boolean", default: false }, mode: { type: "enum", values: ["a", "b"], default: "a" } }, steps: [{ id: "s1", action: "upper", args: { text: "hello {{p.who}}" } }, { id: "s2", action: "count", args: { value: "{{s.s1.n}}" } }], ...extra });

test("templates: saved with typed parameters and versioned; unknown actions, parameters, forward references and malformed definitions are refused at save time", () => {
  const e = createWorkflowEngine({ actions: mkActions() });
  assert.deepEqual(e.saveTemplate(tpl()), { ok: true, id: "greet", version: 1 }); assert.equal(e.saveTemplate(tpl()).version, 2);
  const bad = (patch, reason) => assert.match(String(e.saveTemplate({ ...tpl(), ...patch }).reason), reason);
  bad({ steps: [{ id: "a", action: "rm_rf", args: {} }] }, /^UNKNOWN_ACTION:rm_rf/); bad({ steps: [{ id: "a", action: "upper", args: { text: "{{p.nope}}" } }] }, /^UNKNOWN_PARAMETER:nope/);
  bad({ steps: [{ id: "a", action: "upper", args: { text: "{{s.b.x}}" } }, { id: "b", action: "count", args: {} }] }, /^STEP_REFERENCE_NOT_EARLIER:b/); bad({ steps: [{ id: "a", action: "upper" }, { id: "a", action: "upper" }] }, /STEP_ID_INVALID_OR_DUPLICATE/);
  bad({ steps: [] }, /STEPS_INVALID/); bad({ steps: Array.from({ length: 51 }, (_, i) => ({ id: "s" + i, action: "count" })) }, /STEPS_INVALID/); bad({ id: "Bad Id" }, /TEMPLATE_ID_INVALID/); bad({ name: " " }, /NAME_REQUIRED/);
  bad({ params: JSON.parse('{"__proto__":{"type":"string"}}') }, /PARAM_DEFINITION_INVALID/); bad({ params: { x: { type: "code" } } }, /PARAM_DEFINITION_INVALID:x/); bad({ params: { x: { type: "enum", values: [] } } }, /PARAM_ENUM_INVALID/); bad({ params: { x: { type: "number", default: "s" } } }, /PARAM_DEFAULT_INVALID/);
  bad({ steps: [{ id: "a", action: "upper", args: "x" }] }, /STEP_ARGS_INVALID/); bad({ steps: [{ id: "a", action: "upper", onError: "ignore" }] }, /ON_ERROR_INVALID/); bad({ steps: [{ id: "a", action: "upper", retries: 4 }] }, /RETRIES_INVALID/);
  bad({ steps: [{ id: "a", action: "upper", args: { text: "{{s.a.__proto__}}" } }] , params: {} }, /REFERENCE_FORBIDDEN|STEP_REFERENCE_NOT_EARLIER/); bad({ schedule: { everyMinutes: 1, params: {} } }, /SCHEDULE_INVALID/);
  assert.equal(e.saveTemplate({ id: "x" }).reason, "TENANT_REQUIRED"); assert.equal(e.listTemplates(T).length, 1); assert.equal(e.listTemplates({ tenantId: "O" }).length, 0); assert.equal(e.getTemplate("greet", { tenantId: "O" }).reason, "NOT_FOUND");
});
test("instance: parameters validated and substituted ({{p.x}}, {{s.step.field}}), whole-string placeholders keep their type, steps run in order and results are recorded", async () => {
  const log = [], e = createWorkflowEngine({ actions: mkActions(log) }); e.saveTemplate(tpl());
  assert.equal(e.start({ ...T, templateId: "greet", params: {} }).reason, "PARAMETER_REQUIRED:who");
  for (const [params, reason] of [[{ who: 5 }, "PARAMETER_INVALID:who"], [{ who: "a", mode: "z" }, "PARAMETER_INVALID:mode"], [{ who: "a", extra: 1 }, "UNKNOWN_PARAMETER:extra"], [[], "PARAMS_INVALID"], [{ who: "x".repeat(10001) }, "PARAMETER_INVALID:who"]]) assert.equal(e.start({ ...T, templateId: "greet", params }).reason, reason);
  assert.equal(e.start({ ...T, templateId: "nope" }).reason, "TEMPLATE_NOT_FOUND"); assert.equal(e.start({ tenantId: "O", templateId: "greet", params: { who: "a" } }).reason, "TEMPLATE_NOT_FOUND");
  const id = e.start({ ...T, templateId: "greet", params: { who: "world" } }).id, r = await e.execute(id, T);
  assert.deepEqual(r, { ok: true, status: "DONE" });
  const i = e.getInstance(id, T).instance; assert.deepEqual(i.steps.map(s => s.status), ["DONE", "DONE"]); assert.equal(i.steps[0].output.text, "HELLO WORLD"); assert.deepEqual(log[1], ["count", { value: 11 }]);   // 11 is a NUMBER, not "11"
  assert.equal(i.params.loud, false, "defaults applied"); assert.ok(!("tenantId" in i)); assert.ok(i.checkpoints >= 5);
  assert.equal((await e.execute(id, T)).reason, "NOT_RUNNABLE:DONE"); assert.equal((await e.execute(id, { tenantId: "O" })).reason, "NOT_FOUND");
});
test("failure handling: retries then FAILED with a redacted error; onError continue; resume retries the failed step; cancel; timeouts", async () => {
  const log = []; let now = 0; const e = createWorkflowEngine({ actions: mkActions(log), limits: { ...LIMITS, stepTimeoutMs: 60 } });
  e.saveTemplate({ ...T, id: "t", name: "t", steps: [{ id: "a", action: "flaky", retries: 2 }, { id: "b", action: "boom", onError: "continue" }, { id: "c", action: "count", args: { value: 1 } }] });
  const id = e.start({ ...T, templateId: "t" }).id, r = await e.execute(id, T); assert.equal(r.status, "DONE_WITH_ERRORS");
  const i = e.getInstance(id, T).instance; assert.deepEqual(i.steps.map(s => [s.status, s.attempts]), [["DONE", 3], ["FAILED", 1], ["DONE", 1]]); assert.ok(!JSON.stringify(i).includes("k-ABCDEFGH") && i.steps[1].error.includes("[redacted]"));
  e.saveTemplate({ ...T, id: "stop", name: "s", steps: [{ id: "x", action: "boom" }, { id: "y", action: "count", args: { value: 1 } }] });
  const j = e.start({ ...T, templateId: "stop" }).id, rj = await e.execute(j, T); assert.deepEqual([rj.status, rj.reason], ["FAILED", "STEP_FAILED:x"]); assert.equal(e.getInstance(j, T).instance.steps[1].status, "PENDING", "later steps did not run");
  e.saveTemplate({ ...T, id: "slow", name: "s", steps: [{ id: "h", action: "hang" }] }); const k = e.start({ ...T, templateId: "slow" }).id; const rk = await e.execute(k, T); assert.equal(rk.status, "PAUSED"); const sk = e.getInstance(k, T).instance.steps[0]; assert.equal(sk.status, "NEEDS_REVIEW"); assert.equal(sk.error, "STEP_OUTCOME_UNKNOWN_AFTER_TIMEOUT", "a timed-out non-idempotent step is never blindly retried");
  const c = e.start({ ...T, templateId: "stop" }).id; assert.equal(e.cancel(c, T).ok, true); assert.equal((await e.execute(c, T)).reason, "NOT_RUNNABLE:CANCELLED"); assert.equal(e.cancel(c, T).reason, "NOT_CANCELLABLE:CANCELLED"); assert.equal(e.cancel(c, { tenantId: "O" }).reason, "NOT_FOUND");
});
test("P08 continuation across a REAL restart: the checkpoint file lets a new engine continue after the last finished step; idempotent steps are retried, others need review", async () => {
  const d = tmp("wf-"), f = path.join(d, "wf.json");
  try {
    const log = [], e1 = createWorkflowEngine({ file: f, actions: mkActions(log) });
    e1.saveTemplate({ ...T, id: "p", name: "p", steps: [{ id: "one", action: "upper", args: { text: "x" } }, { id: "two", action: "hang" }, { id: "three", action: "count", args: { value: 3 } }] });
    const id = e1.start({ ...T, templateId: "p" }).id; e1.execute(id, T);                         // step two hangs "forever": the process dies here
    await new Promise(r => setTimeout(r, 40));
    const disk = JSON.parse(fs.readFileSync(f, "utf8")).instances[id]; assert.deepEqual(disk.steps.map(s => s.status), ["DONE", "RUNNING", "PENDING"]);
    const log2 = [], e2 = createWorkflowEngine({ file: f, actions: { ...mkActions(log2), hang: { run: async () => ({ ok: true }), idempotent: false } } });
    assert.equal(e2.recoveredOnStart, 1); const i = e2.getInstance(id, T).instance;
    assert.deepEqual([i.status, i.reason, i.steps.map(s => s.status)], ["PAUSED", "RECOVERED_NEEDS_REVIEW", ["DONE", "NEEDS_REVIEW", "PENDING"]]);
    assert.equal((await e2.resume(id, T)).reason, "NEEDS_REVIEW"); assert.equal(log2.length, 0, "nothing re-ran");
    assert.equal(e2.review(id, "two", { ...T, decision: "WAT" }).reason, "DECISION_INVALID"); assert.equal(e2.review(id, "one", { ...T, decision: "RETRY" }).reason, "NOT_AWAITING_REVIEW");
    assert.equal(e2.review(id, "two", { ...T, decision: "RETRY" }).ok, true); const r = await e2.resume(id, T); assert.equal(r.status, "DONE");
    assert.deepEqual(log2.map(x => x[0]), ["count"], "step one was NOT repeated after the restart"); assert.equal(createWorkflowEngine({ file: f, actions: mkActions() }).recoveredOnStart, 0);
    // idempotent in-flight step is simply retried
    const e3 = createWorkflowEngine({ file: path.join(d, "wf3.json"), actions: { idem: { run: () => new Promise(() => {}), idempotent: true }, count: mkActions().count } });
    e3.saveTemplate({ ...T, id: "q", name: "q", steps: [{ id: "a", action: "idem" }, { id: "b", action: "count", args: { value: 1 } }] }); const q = e3.start({ ...T, templateId: "q" }).id; e3.execute(q, T); await new Promise(r => setTimeout(r, 30));
    const e4 = createWorkflowEngine({ file: path.join(d, "wf3.json"), actions: { idem: { run: async () => ({ done: 1 }), idempotent: true }, count: mkActions().count } });
    assert.deepEqual([e4.getInstance(q, T).instance.reason, e4.getInstance(q, T).instance.steps[0].status], ["RECOVERED", "PENDING"]); assert.equal((await e4.resume(q, T)).status, "DONE");
  } finally { rm(d); }
});
test("P05 rewind: resets later steps of THIS instance only; refused (nothing changed) when an undone step had an external side effect; no rewind of a running instance", async () => {
  const e = createWorkflowEngine({ actions: mkActions() });
  e.saveTemplate({ ...T, id: "r", name: "r", steps: [{ id: "a", action: "upper", args: { text: "q" } }, { id: "b", action: "count", args: { value: 2 } }, { id: "c", action: "save", args: { text: "{{s.a.text}}" } }, { id: "d", action: "count", args: { value: 4 } }] });
  const id = e.start({ ...T, templateId: "r" }).id; await e.execute(id, T);
  const before = JSON.stringify(e.getInstance(id, T).instance);
  assert.deepEqual(e.rewind(id, "a", T), { ok: false, reason: "REWIND_BLOCKED:c" }); assert.deepEqual(e.rewind(id, "b", T), { ok: false, reason: "REWIND_BLOCKED:c" }); assert.equal(JSON.stringify(e.getInstance(id, T).instance), before, "a refused rewind changes nothing");
  assert.deepEqual(e.rewind(id, "c", T), { ok: true, reset: ["d"] }); const i = e.getInstance(id, T).instance; assert.deepEqual(i.steps.map(s => s.status), ["DONE", "DONE", "DONE", "PENDING"]); assert.equal(i.steps[3].output, null); assert.equal(i.status, "PAUSED");
  assert.equal((await e.resume(id, T)).status, "DONE");
  assert.equal(e.rewind(id, "zz", T).reason, "STEP_NOT_FOUND"); assert.equal(e.rewind(id, "a", { tenantId: "O" }).reason, "NOT_FOUND");
  e.saveTemplate({ ...T, id: "pure", name: "p", steps: [{ id: "a", action: "upper", args: { text: "q" } }, { id: "b", action: "count", args: { value: 2 } }] }); const p = e.start({ ...T, templateId: "pure" }).id; await e.execute(p, T);
  assert.deepEqual(e.rewind(p, null, T), { ok: true, reset: ["a", "b"] }); assert.deepEqual(e.getInstance(p, T).instance.steps.map(s => s.status), ["PENDING", "PENDING"]);
  // an action that does not declare rewindable is treated as NOT rewindable (deny by default)
  const e2 = createWorkflowEngine({ actions: { plain: { run: async () => ({}) } } }); e2.saveTemplate({ ...T, id: "x", name: "x", steps: [{ id: "a", action: "plain" }] }); const x = e2.start({ ...T, templateId: "x" }).id; await e2.execute(x, T); assert.equal(e2.rewind(x, null, T).reason, "REWIND_BLOCKED:a");
});
test("stop hook: a kill switch / Safe Mode pauses the instance before its next step; a failing stop check fails closed; resume continues afterwards", async () => {
  let stop = false; const log = [], e = createWorkflowEngine({ actions: mkActions(log), isStopped: () => stop });
  e.saveTemplate(tpl()); const id = e.start({ ...T, templateId: "greet", params: { who: "w" } }).id; stop = true;
  const r = await e.execute(id, T); assert.deepEqual([r.status, r.reason], ["PAUSED", "OWNER_STOP_OR_SAFE_MODE_ACTIVE"]); assert.equal(log.length, 0);
  stop = false; assert.equal((await e.resume(id, T)).status, "DONE");
  const e2 = createWorkflowEngine({ actions: mkActions(), isStopped: () => { throw new Error("x"); } }); e2.saveTemplate(tpl()); const j = e2.start({ ...T, templateId: "greet", params: { who: "w" } }).id; assert.equal((await e2.execute(j, T)).status, "PAUSED");
});
test("concurrency: the same instance cannot be executed twice at once", async () => {
  let release; const gate = new Promise(r => { release = r; }); const e = createWorkflowEngine({ actions: { slow: { run: () => gate } } });
  e.saveTemplate({ ...T, id: "s", name: "s", steps: [{ id: "a", action: "slow" }] }); const id = e.start({ ...T, templateId: "s" }).id; const first = e.execute(id, T);
  await new Promise(r => setTimeout(r, 10)); assert.equal((await e.execute(id, T)).reason, "ALREADY_RUNNING"); assert.equal((await e.resume(id, T)).reason, "ALREADY_RUNNING"); assert.equal(e.rewind(id, null, T).reason, "ALREADY_RUNNING");
  release({ ok: 1 }); assert.equal((await first).status, "DONE");
});
test("P11 batch: every item validated first, per-item checkpoint, error isolation, rate limit (sliding window), resume after a restart skips finished items, failed items can be requeued", async () => {
  const d = tmp("wfb-"), f = path.join(d, "wf.json");
  try {
    let t = 0; const sleeps = [], log = []; const mk = () => createWorkflowEngine({ file: f, actions: { work: { run: async a => { log.push(a.n); if (a.n === 3 && !globalThis.__fix) throw new Error("bad item"); return { n: a.n }; }, idempotent: true, rewindable: true } }, clock: () => t, sleep: async ms => { sleeps.push(ms); t += ms; } });
    const e = mk(); e.saveTemplate({ ...T, id: "w", name: "w", params: { n: { type: "number", required: true } }, steps: [{ id: "a", action: "work", args: { n: "{{p.n}}" } }] });
    assert.equal(e.createBatch({ ...T, templateId: "w", items: [{ n: 1 }, { n: "x" }] }).reason, "ITEM_1_PARAMETER_INVALID:n"); assert.equal(e.createBatch({ ...T, templateId: "w", items: [] }).reason, "ITEMS_INVALID"); assert.equal(e.createBatch({ ...T, templateId: "w", items: Array(501).fill({ n: 1 }) }).reason, "ITEMS_INVALID");
    assert.equal(e.createBatch({ ...T, templateId: "w", items: [{ n: 1 }], ratePerMinute: 0 }).reason, "RATE_INVALID"); assert.equal(e.createBatch({ ...T, templateId: "nope", items: [{}] }).reason, "TEMPLATE_NOT_FOUND"); assert.equal(Object.keys(JSON.parse(fs.readFileSync(f, "utf8")).batches).length, 0, "a rejected batch starts nothing");
    const b = e.createBatch({ ...T, templateId: "w", items: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }], ratePerMinute: 2 }).id;
    const r = await e.runBatch(b, T); assert.deepEqual([r.status, r.DONE, r.FAILED, r.total], ["DONE_WITH_ERRORS", 4, 1, 5]); assert.deepEqual(log, [1, 2, 3, 4, 5], "item 3 failing did not stop the others");
    assert.ok(sleeps.length >= 2 && sleeps.every(ms => ms > 0 && ms <= 60000), "rate limit waited: " + sleeps);
    assert.equal(e.getBatch(b, T).batch.items[2].error.length > 0, true); assert.equal(e.getBatch(b, { tenantId: "O" }).reason, "NOT_FOUND"); assert.equal((await e.runBatch(b, { tenantId: "O" })).reason, "NOT_FOUND");
    globalThis.__fix = true; log.length = 0; const e2 = mk(); assert.equal(e2.requeueFailed(b, T).requeued, 1); const r2 = await e2.runBatch(b, T); assert.deepEqual([r2.status, r2.DONE], ["DONE", 5]); assert.deepEqual(log, [3], "only the failed item re-ran");
    delete globalThis.__fix;
  } finally { rm(d); }
});
test("batch: stop hook pauses the batch between items; a restart continues from the first unfinished item", async () => {
  let stopAfter = 2, seen = 0; const log = [];
  const e = createWorkflowEngine({ actions: { work: { run: async a => { log.push(a.n); seen++; return {}; }, idempotent: true } }, isStopped: () => seen >= stopAfter });
  e.saveTemplate({ ...T, id: "w", name: "w", params: { n: { type: "number", required: true } }, steps: [{ id: "a", action: "work", args: { n: "{{p.n}}" } }] });
  const b = e.createBatch({ ...T, templateId: "w", items: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] }).id; const r = await e.runBatch(b, T);
  assert.deepEqual([r.status, r.reason, r.DONE, r.PENDING], ["PAUSED", "OWNER_STOP_OR_SAFE_MODE_ACTIVE", 2, 2]); stopAfter = 99; const r2 = await e.runBatch(b, T); assert.deepEqual([r2.status, r2.DONE], ["DONE", 4]); assert.deepEqual(log, [1, 2, 3, 4]);
});
test("schedule: due() reports templates whose interval passed; tick() runs each at most once per interval and marks the run first", async () => {
  let ms = Date.parse("2026-10-07T10:00:00Z"); const log = [], e = createWorkflowEngine({ actions: mkActions(log), now: () => new Date(ms).toISOString() });
  e.saveTemplate({ ...tpl(), schedule: { everyMinutes: 60, params: { who: "cron" } } }); e.saveTemplate({ ...T, id: "manual", name: "m", steps: [{ id: "a", action: "count", args: { value: 1 } }] });
  assert.deepEqual(e.due(T), ["greet"]); const r = await e.tick(T); assert.deepEqual(r.map(x => [x.templateId, x.started, x.result]), [["greet", true, "DONE"]]); assert.deepEqual(e.due(T), []);
  ms += 59 * 60000; assert.deepEqual(await e.tick(T), []); ms += 2 * 60000; assert.equal((await e.tick(T)).length, 1); assert.equal(e.listInstances({ ...T, status: "DONE" }).length, 2); assert.equal(e.due({ tenantId: "O" }).length, 0);
  assert.match(e.saveTemplate({ ...tpl(), schedule: { everyMinutes: 60, params: { who: 5 } } }).reason, /^SCHEDULE_PARAMS_INVALID/, "bad schedule params are refused at save time");
});
test("security: substitution never evaluates anything; a malicious parameter stays inert data; outputs are redacted and size-capped; prototype keys cannot be referenced", async () => {
  const log = [], e = createWorkflowEngine({ actions: { ...mkActions(log), big: { run: async () => ({ s: "x".repeat(30000) }) }, leak: { run: async () => ({ k: "s" + "k-ABCDEFGHIJKLMNOPQRSTUVWX" }) } } });
  e.saveTemplate({ ...T, id: "m", name: "m", params: { p: { type: "string", required: true } }, steps: [{ id: "a", action: "upper", args: { text: "{{p.p}}" } }] });
  const evil = "${process.exit(1)} {{p.p}} {{s.a.text}} `rm -rf /` <script>"; const id = e.start({ ...T, templateId: "m", params: { p: evil } }).id; await e.execute(id, T);
  assert.equal(log[0][1].text, evil, "the parameter reached the action verbatim, unexpanded");
  e.saveTemplate({ ...T, id: "b", name: "b", steps: [{ id: "a", action: "big" }] }); const b = e.start({ ...T, templateId: "b" }).id; await e.execute(b, T); assert.equal(e.getInstance(b, T).instance.steps[0].error, "OUTPUT_TOO_LARGE");
  e.saveTemplate({ ...T, id: "l", name: "l", steps: [{ id: "a", action: "leak" }] }); const l = e.start({ ...T, templateId: "l" }).id; await e.execute(l, T); assert.equal(e.getInstance(l, T).instance.steps[0].output.k, "[redacted]");
  e.saveTemplate({ ...T, id: "x", name: "x", steps: [{ id: "a", action: "leak" }, { id: "b", action: "upper", args: { text: "{{s.a.k.__proto__}}" } }] }).ok;
  e.saveTemplate({ ...T, id: "y", name: "y", steps: [{ id: "a", action: "leak" }, { id: "b", action: "upper", args: { text: "{{s.a.nope}}" } }] }); const y = e.start({ ...T, templateId: "y" }).id; const ry = await e.execute(y, T); assert.deepEqual([ry.status, ry.reason], ["FAILED", "OUTPUT_PATH_MISSING:a.nope"]);
  e.saveTemplate({ ...T, id: "z", name: "z", steps: [{ id: "a", action: "leak" }, { id: "b", action: "upper", args: { text: "{{s.a}}" } }] }); const z = e.start({ ...T, templateId: "z" }).id; assert.equal((await e.execute(z, T)).reason, "REFERENCE_NOT_SCALAR:a");
  assert.equal(Object.getPrototypeOf({}).polluted, undefined);
});
test("mutation-driven: forbidden references, failed-continue steps are not re-run, resume retries a failed stop step, rate waits are exact, batch isolates start failures, rate bounds", async () => {
  let fails = 1, boomRuns = 0; const log = [];
  const e = createWorkflowEngine({ actions: { ...mkActions(log), once: { run: async () => { if (fails-- > 0) throw new Error("first time fails"); return { ok: 1 }; }, idempotent: true, rewindable: true }, boom2: { run: async () => { boomRuns++; throw new Error("x"); } } } });
  assert.equal(e.saveTemplate({ ...T, id: "f", name: "f", steps: [{ id: "a", action: "count", args: { value: 1 } }, { id: "b", action: "upper", args: { text: "{{s.a.__proto__}}" } }] }).reason, "REFERENCE_FORBIDDEN");
  assert.equal(e.saveTemplate({ ...T, id: "f2", name: "f", steps: [{ id: "a", action: "count", args: { value: 1 } }, { id: "b", action: "upper", args: { text: "{{s.a.constructor}}" } }] }).reason, "REFERENCE_FORBIDDEN");
  e.saveTemplate({ ...T, id: "c", name: "c", steps: [{ id: "a", action: "boom2", onError: "continue" }, { id: "b", action: "count", args: { value: 1 } }] }); const c = e.start({ ...T, templateId: "c" }).id;
  assert.equal((await e.execute(c, T)).status, "DONE_WITH_ERRORS"); assert.equal((await e.execute(c, T)).status, "DONE_WITH_ERRORS"); assert.equal(boomRuns, 1, "a failed step with onError=continue is not retried by a later run");
  e.saveTemplate({ ...T, id: "o", name: "o", steps: [{ id: "a", action: "once" }, { id: "b", action: "count", args: { value: 2 } }] }); const o = e.start({ ...T, templateId: "o" }).id;
  assert.equal((await e.execute(o, T)).status, "FAILED"); const r = await e.resume(o, T); assert.equal(r.status, "DONE"); assert.deepEqual(e.getInstance(o, T).instance.steps.map(s => [s.status, s.attempts]), [["DONE", 2], ["DONE", 1]]);
  // batch: sleeps are exact; a start failure for one item (template changed after batch creation) is isolated
  let t = 0; const sleeps = []; const e2 = createWorkflowEngine({ actions: { work: { run: async a => ({ v: a.v }), idempotent: true } }, clock: () => t, sleep: async ms => { sleeps.push(ms); t += ms; } });
  e2.saveTemplate({ ...T, id: "w", name: "w", params: { v: { type: "enum", values: ["x", "y", "z"], required: true } }, steps: [{ id: "a", action: "work", args: { v: "{{p.v}}" } }] });
  assert.equal(e2.createBatch({ ...T, templateId: "w", items: [{ v: "x" }], ratePerMinute: 601 }).reason, "RATE_INVALID"); assert.equal(e2.createBatch({ ...T, templateId: "w", items: [{ v: "x" }], ratePerMinute: 600 }).ok, true);
  const b = e2.createBatch({ ...T, templateId: "w", items: [{ v: "x" }, { v: "y" }, { v: "z" }], ratePerMinute: 2 }).id;
  e2.saveTemplate({ ...T, id: "w", name: "w", params: { v: { type: "enum", values: ["x", "z"], required: true } }, steps: [{ id: "a", action: "work", args: { v: "{{p.v}}" } }] });   // "y" is no longer valid
  const br = await e2.runBatch(b, T); assert.deepEqual([br.status, br.DONE, br.FAILED], ["DONE_WITH_ERRORS", 2, 1]); assert.equal(e2.getBatch(b, T).batch.items[1].error, "PARAMETER_INVALID:v");
  assert.deepEqual(sleeps, [60000], "the third item waited for exactly the rest of the window");
});
test("hardening: batch finalises a finished instance without re-running, stop leaves the in-flight item PENDING, requeue recovers DONE_WITH_ERRORS without repeating done steps", async () => {
  let stop = false; const log = [];
  const acts = { ok: { run: async a => { log.push("ok" + a.n); return {}; }, idempotent: true, rewindable: true },
    fl: { run: async a => { log.push("fl" + a.n); if (!globalThis.__flOk) throw new Error("x"); return {}; }, idempotent: true, rewindable: true },
    sv: { run: async () => { log.push("sv"); if (!globalThis.__flOk) throw new Error("y"); return {}; }, idempotent: false } };
  const e = createWorkflowEngine({ actions: acts, isStopped: () => stop });
  e.saveTemplate({ ...T, id: "w", name: "w", params: { n: { type: "number", required: true } }, steps: [{ id: "a", action: "ok", args: { n: "{{p.n}}" } }, { id: "b", action: "fl", args: { n: "{{p.n}}" }, onError: "continue" }] });
  globalThis.__flOk = false; const b = e.createBatch({ ...T, templateId: "w", items: [{ n: 1 }] }).id; const r = await e.runBatch(b, T); assert.equal(r.status, "DONE_WITH_ERRORS");
  globalThis.__flOk = true; assert.equal(e.requeueFailed(b, T).requeued, 1); const r2 = await e.runBatch(b, T); assert.equal(r2.status, "DONE"); assert.deepEqual(log, ["ok1", "fl1", "fl1"], "step a was NOT repeated");
  // non-idempotent failed step becomes NEEDS_REVIEW after requeue, never silently re-executed
  e.saveTemplate({ ...T, id: "s", name: "s", steps: [{ id: "x", action: "sv", onError: "continue" }] }); globalThis.__flOk = false; const b2 = e.createBatch({ ...T, templateId: "s", items: [{}] }).id; await e.runBatch(b2, T);
  e.requeueFailed(b2, T); globalThis.__flOk = true; const r3 = await e.runBatch(b2, T); assert.equal(r3.status, "DONE_WITH_ERRORS"); assert.equal(log.filter(x => x === "sv").length, 1, "non-idempotent step not re-run without review");
  // crash window: instance DONE but the item was never saved (simulated by rewriting the file)
  { const d = tmp("wfb-"), f = path.join(d, "w.json"); try {
    const l2 = [], e1 = createWorkflowEngine({ file: f, actions: { ok: { run: async () => { l2.push(1); return {}; }, idempotent: true } } });
    e1.saveTemplate({ ...T, id: "q", name: "q", steps: [{ id: "a", action: "ok" }] }); const bid = e1.createBatch({ ...T, templateId: "q", items: [{}] }).id; await e1.runBatch(bid, T);
    const j = JSON.parse(fs.readFileSync(f, "utf8")); j.batches[bid].items[0].status = "PENDING"; j.batches[bid].status = "RUNNING"; fs.writeFileSync(f, JSON.stringify(j));
    const e2 = createWorkflowEngine({ file: f, actions: { ok: { run: async () => { l2.push(2); return {}; }, idempotent: true } } }); const rr = await e2.runBatch(bid, T);
    assert.equal(rr.status, "DONE"); assert.deepEqual(l2, [1], "the finished instance was finalised, not executed again");
  } finally { rm(d); } }
  globalThis.__flOk = true; const n0 = log.length;
  // stop mid-run: in-flight item stays PENDING and the batch PAUSED
  stop = true; const b4 = e.createBatch({ ...T, templateId: "w", items: [{ n: 8 }, { n: 9 }] }).id; const r4 = await e.runBatch(b4, T); assert.deepEqual([r4.status, r4.PENDING], ["PAUSED", 2]); stop = false; assert.equal(n0, log.length);
  delete globalThis.__flOk;
});
test("hardening: rewind blocks non-rewindable states, refuses CANCELLED, a no-op rewind changes nothing; tick during a stop consumes no period", async () => {
  let stop = false, ms = Date.parse("2026-10-07T10:00:00Z"); const log = [];
  const e = createWorkflowEngine({ actions: mkActions(log), isStopped: () => stop, now: () => new Date(ms).toISOString() });
  e.saveTemplate({ ...T, id: "r", name: "r", steps: [{ id: "a", action: "count", args: { value: 1 } }, { id: "h", action: "hang" }, { id: "c", action: "count", args: { value: 3 } }] });
  const id = e.start({ ...T, templateId: "r" }).id; await e.execute(id, T).catch(() => {});
  const c = e.start({ ...T, templateId: "r" }).id; e.cancel(c, T); assert.equal(e.rewind(c, null, T).reason, "NOT_REWINDABLE:CANCELLED");
  e.saveTemplate({ ...T, id: "p", name: "p", steps: [{ id: "a", action: "count", args: { value: 1 } }] }); const p = e.start({ ...T, templateId: "p" }).id; await e.execute(p, T);
  const before = JSON.stringify(e.getInstance(p, T).instance); assert.deepEqual(e.rewind(p, "a", T), { ok: true, reset: [] }); assert.equal(JSON.stringify(e.getInstance(p, T).instance), before, "no-op rewind leaves status and checkpoints untouched");
  e.saveTemplate({ ...tpl(), schedule: { everyMinutes: 60, params: { who: "cron" } } }); stop = true; assert.deepEqual(await e.tick(T), []); assert.deepEqual(e.due(T), ["greet"], "period not consumed while stopped"); stop = false; assert.equal((await e.tick(T)).length, 1);
});
test("hardening: a stop arriving DURING an item leaves it PENDING (batch PAUSED); rewinding over a FAILED non-rewindable step is blocked", async () => {
  let stop = false; const acts = { trip: { run: async () => { stop = true; return {}; }, idempotent: true, rewindable: true }, two: { run: async () => ({}), idempotent: true, rewindable: true }, bad: { run: async () => { throw new Error("no"); }, idempotent: true, rewindable: false } };
  const e = createWorkflowEngine({ actions: acts, isStopped: () => stop });
  e.saveTemplate({ ...T, id: "m", name: "m", steps: [{ id: "a", action: "trip" }, { id: "b", action: "two" }] });
  const b = e.createBatch({ ...T, templateId: "m", items: [{}, {}] }).id; const r = await e.runBatch(b, T);
  assert.deepEqual([r.status, r.reason, r.PENDING, r.FAILED], ["PAUSED", "OWNER_STOP_OR_SAFE_MODE_ACTIVE", 2, 0]);
  stop = false; e.saveTemplate({ ...T, id: "f", name: "f", steps: [{ id: "a", action: "two" }, { id: "x", action: "bad", onError: "continue" }] }); const id = e.start({ ...T, templateId: "f" }).id; await e.execute(id, T);
  assert.equal(e.getInstance(id, T).instance.steps[1].status, "FAILED"); assert.equal(e.rewind(id, "a", T).reason, "REWIND_BLOCKED:x");
});
test("verification fixes: cancel is never overwritten by a failing/timed-out step; review cannot revive a cancelled instance; rewind re-resolves arguments; split secrets are refused", async () => {
  let release; const acts = { gate: { run: () => new Promise((res, rej) => { release = () => rej(new Error("late failure")); }), idempotent: true }, val: { run: async () => ({ v: globalThis.__v ?? 1 }), idempotent: true, rewindable: true }, take: { run: async a => ({ got: a.x }), idempotent: true, rewindable: true }, up: mkActions().upper };
  const e = createWorkflowEngine({ actions: acts, limits: { ...LIMITS, stepTimeoutMs: 80 } });
  e.saveTemplate({ ...T, id: "c", name: "c", steps: [{ id: "a", action: "gate" }] }); const c = e.start({ ...T, templateId: "c" }).id; const run = e.execute(c, T); await new Promise(r => setTimeout(r, 10)); assert.equal(e.cancel(c, T).ok, true); release(); const rc = await run;
  assert.deepEqual([rc.status, e.getInstance(c, T).instance.status], ["CANCELLED", "CANCELLED"], "a step failing after a cancel does not overwrite it");
  const hang = createWorkflowEngine({ actions: { h: { run: () => new Promise(() => {}), idempotent: false } }, limits: { ...LIMITS, stepTimeoutMs: 60 } });
  hang.saveTemplate({ ...T, id: "h", name: "h", steps: [{ id: "a", action: "h" }, { id: "b", action: "h" }] }); const h = hang.start({ ...T, templateId: "h" }).id; const rh = hang.execute(h, T); await new Promise(r => setTimeout(r, 10)); hang.cancel(h, T); assert.equal((await rh).status, "CANCELLED");
  const h2 = hang.start({ ...T, templateId: "h" }).id; assert.equal((await hang.execute(h2, T)).status, "PAUSED"); hang.cancel(h2, T); assert.equal(hang.review(h2, "a", { ...T, decision: "SKIP" }).reason, "NOT_REVIEWABLE:CANCELLED"); assert.equal(hang.getInstance(h2, T).instance.status, "CANCELLED");
  e.saveTemplate({ ...T, id: "r", name: "r", steps: [{ id: "a", action: "val" }, { id: "b", action: "take", args: { x: "{{s.a.v}}" } }] }); const r = e.start({ ...T, templateId: "r" }).id; await e.execute(r, T);
  assert.equal(e.getInstance(r, T).instance.steps[1].output.got, 1); globalThis.__v = 2; assert.equal(e.rewind(r, null, T).ok, true); await e.resume(r, T); assert.equal(e.getInstance(r, T).instance.steps[1].output.got, 2, "downstream step saw the NEW upstream value"); delete globalThis.__v;
  assert.equal(e.getInstance(r, T).instance.steps[1].args.x, "{{s.a.v}}", "the template argument is kept");
  const SK = "s" + "k-ABCDEFGHIJKLMNOPQRSTUVWX";
  e.saveTemplate({ ...T, id: "sp", name: "sp", params: { a: { type: "string", required: true }, b: { type: "string", required: true } }, steps: [{ id: "x", action: "up", args: { text: "{{p.a}}{{p.b}}" } }] });
  const sp = e.start({ ...T, templateId: "sp", params: { a: SK.slice(0, 8), b: SK.slice(8) } }).id; const rs = await e.execute(sp, T); assert.deepEqual([rs.status, rs.reason], ["FAILED", "SECRET_IN_RESOLVED_ARGS:x"]); assert.ok(!JSON.stringify(e.getInstance(sp, T).instance).includes("ABCDEFGHIJKLMNOPQRSTUVWX"));
  assert.match(String(e.saveTemplate({ ...T, id: "k", name: "k", steps: [{ id: "x", action: "up", args: { [SK]: 1 } }] }).reason), /^SECRET_IN_INPUT/);
});
test("verification fixes: scheduler honours a stop mid-tick and concurrent ticks; rate windows are per tenant; finished instances are archived at the cap; own-key lookups; malformed state is refused", async () => {
  let ms = Date.parse("2026-10-07T10:00:00Z"), stop = false, hold; const runs = {};
  const acts = { a: { run: async () => { runs.a = (runs.a ?? 0) + 1; stop = true; return {}; }, idempotent: true }, b: { run: async () => { runs.b = (runs.b ?? 0) + 1; await new Promise(r => { hold = r; setTimeout(r, 30); }); return {}; }, idempotent: true } };
  const e = createWorkflowEngine({ actions: acts, isStopped: () => stop, now: () => new Date(ms).toISOString() });
  e.saveTemplate({ ...T, id: "ta", name: "a", steps: [{ id: "s", action: "a" }], schedule: { everyMinutes: 60, params: {} } }); e.saveTemplate({ ...T, id: "tb", name: "b", steps: [{ id: "s", action: "b" }], schedule: { everyMinutes: 60, params: {} } });
  const t1 = await e.tick(T); assert.deepEqual(t1.map(x => x.templateId), ["ta"], "stop landed during the first run: the second template was not started"); assert.deepEqual(e.due(T), ["tb"], "its period was NOT consumed");
  stop = false; const [x, y] = await Promise.all([e.tick(T), e.tick(T)]); assert.equal(runs.b, 1, "two concurrent ticks run a due template once"); assert.equal(x.length + y.length, 1);
  // per-tenant rate window
  let clk = 0; const sleeps = []; const e2 = createWorkflowEngine({ actions: { w: { run: async () => ({}), idempotent: true } }, clock: () => clk, sleep: async n => { sleeps.push(n); clk += n; } });
  for (const t of ["A", "B"]) e2.saveTemplate({ tenantId: t, id: "w", name: "w", steps: [{ id: "s", action: "w" }] });
  const ba = e2.createBatch({ tenantId: "A", templateId: "w", items: [{}, {}, {}], ratePerMinute: 3 }).id; await e2.runBatch(ba, { tenantId: "A" });
  const bb = e2.createBatch({ tenantId: "B", templateId: "w", items: [{}, {}, {}], ratePerMinute: 3 }).id; await e2.runBatch(bb, { tenantId: "B" }); assert.deepEqual(sleeps, [], "tenant B never waits for tenant A's window");
  // instance cap: archive finished, keep unfinished and batch-referenced
  const e3 = createWorkflowEngine({ actions: { w: { run: async () => ({}), idempotent: true } }, limits: { ...LIMITS, maxInstances: 10 } }); e3.saveTemplate({ ...T, id: "w", name: "w", steps: [{ id: "s", action: "w" }] });
  const ids = []; for (let i = 0; i < 10; i++) { const id = e3.start({ ...T, templateId: "w" }).id; ids.push(id); await e3.execute(id, T); }
  const pend = e3.start({ ...T, templateId: "w" }); assert.equal(pend.ok, true, "room was made by archiving the oldest finished instance"); assert.equal(e3.listInstances(T).length, 10); assert.equal(e3.getInstance(ids[0], T).ok, false); assert.equal(e3.getInstance(pend.id, T).ok, true);
  // own-key lookups: reserved ids are plain misses and pollute nothing
  for (const id of ["__proto__", "constructor", "toString"]) { assert.equal(e.cancel(id, {}).reason, "NOT_FOUND"); assert.equal(e.getBatch(id, {}).reason, "NOT_FOUND"); assert.equal((await e.runBatch(id, T)).reason, "NOT_FOUND"); } assert.equal({}.status, undefined);
  // malformed state files
  const d = tmp("wfs-"); try {
    const f = path.join(d, "w.json"); for (const bad of ['{"templates":{},"instances":{"x":{"id":"x","status":"RUNNING"}},"batches":{}}', '{"templates":{},"instances":{},"batches":{"b":{"items":5}}}', '{"templates":{"t":{}},"instances":{},"batches":{}}']) { fs.writeFileSync(f, bad); assert.throws(() => createWorkflowEngine({ file: f, actions: {} }), /STORE_UNREADABLE/); assert.equal(fs.readFileSync(f, "utf8"), bad, "file untouched"); }
  } finally { rm(d); }
  // a RUNNING step inside a non-RUNNING instance is not silently re-executed after a restart
  const d2 = tmp("wfr-"); try {
    const f = path.join(d2, "w.json"), log = []; const act = { save: { run: async a => { log.push(1); return {}; }, idempotent: false } };
    const e4 = createWorkflowEngine({ file: f, actions: act }); e4.saveTemplate({ ...T, id: "s", name: "s", steps: [{ id: "x", action: "save" }] }); const id = e4.start({ ...T, templateId: "s" }).id;
    const j = JSON.parse(fs.readFileSync(f, "utf8")); j.instances[id].status = "PAUSED"; j.instances[id].steps[0].status = "RUNNING"; fs.writeFileSync(f, JSON.stringify(j));
    const e5 = createWorkflowEngine({ file: f, actions: act }); assert.equal((await e5.resume(id, T)).reason, "NEEDS_REVIEW"); assert.equal(log.length, 0);
  } finally { rm(d2); }
});

test("schedule: concurrent ticks never start the same template twice; a failed start does not consume the period", async () => {
  let ms = Date.parse("2026-10-07T10:00:00Z"); const log = [], now = () => new Date(ms).toISOString();
  const e = createWorkflowEngine({ actions: mkActions(log), now });
  for (const id of ["a1", "b1"]) e.saveTemplate({ ...T, id, name: id, params: {}, steps: [{ id: "s", action: "count", args: { value: 1 } }], schedule: { everyMinutes: 60, params: {} } });
  const [r1, r2] = await Promise.all([e.tick(T), e.tick(T)]);
  assert.equal([...r1, ...r2].filter(x => x.started).length, 2, "each template started exactly once across both ticks"); assert.equal(e.listInstances(T).length, 2);
  // a start that fails (instance cap reached with unfinished work) must leave the template due
  const e2 = createWorkflowEngine({ actions: mkActions(), now, limits: { ...LIMITS, maxInstances: 1 } });
  e2.saveTemplate({ ...T, id: "m", name: "m", params: {}, steps: [{ id: "s", action: "count", args: { value: 1 } }] }); assert.equal(e2.start({ ...T, templateId: "m" }).ok, true);
  e2.saveTemplate({ ...T, id: "s2", name: "s2", params: {}, steps: [{ id: "s", action: "count", args: { value: 1 } }], schedule: { everyMinutes: 60, params: {} } });
  const r = await e2.tick(T); assert.deepEqual(r.map(x => [x.started, x.reason]), [[false, "TOO_MANY_INSTANCES"]]); assert.deepEqual(e2.due(T), ["s2"], "the period was not consumed");
});

test("instance cap: archiving never deletes instances a batch still points at", async () => {
  const e = createWorkflowEngine({ actions: mkActions(), limits: { ...LIMITS, maxInstances: 1 }, sleep: async () => {} });
  e.saveTemplate({ ...T, id: "w", name: "w", params: {}, steps: [{ id: "s", action: "count", args: { value: 1 } }] });
  const b = e.createBatch({ ...T, templateId: "w", items: [{}] }); assert.equal(b.ok, true); await e.runBatch(b.id, T);
  const item = e.getBatch(b.id, T).batch.items[0].instanceId; assert.ok(item && e.getInstance(item, T).ok);
  assert.equal(e.start({ ...T, templateId: "w" }).reason, "TOO_MANY_INSTANCES"); assert.ok(e.getInstance(item, T).ok, "batch-referenced instance survived");
});
