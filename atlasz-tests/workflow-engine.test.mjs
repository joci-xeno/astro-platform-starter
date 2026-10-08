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
  e.saveTemplate({ ...T, id: "slow", name: "s", steps: [{ id: "h", action: "hang" }] }); const k = e.start({ ...T, templateId: "slow" }).id; const rk = await e.execute(k, T); assert.equal(rk.status, "FAILED"); assert.equal(e.getInstance(k, T).instance.steps[0].error, "STEP_TIMEOUT");
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
  e.saveTemplate({ ...tpl(), schedule: { everyMinutes: 60, params: { who: 5 } } }); ms += 3600000; const bad = await e.tick(T); assert.deepEqual([bad[0].started, bad[0].reason], [false, "PARAMETER_INVALID:who"]);
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
