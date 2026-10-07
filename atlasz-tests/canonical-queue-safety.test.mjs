// V7.3 wiring tests: durable queue/checkpoint + Safe Mode + self-check + watchdog inside the REAL canonical runtime.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmp, rm } from "./helpers.mjs";

process.env.ATLASZ_TEST_MODE = "1";
const { createRuntime } = await import("../atlasz-runtime/supervisor-safe.mjs");
const hit = (id, text) => ({ objectID: id, created_at: new Date(Date.now() - 86400000).toISOString(), comment_text: text + " [ref " + id + "]", story_title: "Ask HN" });
const good = "We are looking for a developer for a freelance project: need help with a website, remote, budget $2,000. Contact jobs@example.com";
const fakeFetch = hits => async () => ({ ok: true, status: 200, json: async () => ({ hits }) });

test("every discovered candidate is journaled; screening acks only AFTER the checkpoint save", async () => {
  const d = tmp(); try {
    const rt = createRuntime({ dataDir: d, retryBaseMs: 0, fetchImpl: fakeFetch([hit("1", good), hit("2", good)]) });
    await rt.search(0);
    assert.equal(rt.queue.stats().ready, 2);
    await rt.execute(5);
    assert.equal(rt.queue.stats().done, 1); assert.equal(rt.queue.stats().ready, 1);
    const saved = JSON.parse(fs.readFileSync(path.join(d, "atlasz-state.json"), "utf8"));
    assert.equal(saved.candidates.filter(c => c.status !== "NEW").length, 1);
    assert.equal(rt.dashboard().queue.total, 2);
  } finally { rm(d); }
});

test("crash while a job is leased: after restart the lease is requeued, the candidate screened exactly once", async () => {
  const d = tmp(); try {
    const rt = createRuntime({ dataDir: d, fetchImpl: fakeFetch([hit("1", good)]) });
    await rt.search(0);
    const leased = rt.queue.lease({ worker: "EXECUTION-1" });            // worker dies right here (no save, no ack)
    assert.equal(leased.id, "hn-1");
    const rt2 = createRuntime({ dataDir: d, fetchImpl: fakeFetch([]) });  // restart
    assert.equal(rt2.recoveredQueue, 1);
    await rt2.execute(5); await rt2.execute(6);
    assert.equal(rt2.state.leads.length, 1);
    assert.equal(rt2.state.candidates.filter(c => c.status === "NEEDS_VERIFICATION").length, 1);
    assert.equal(rt2.queue.stats().done, 1); assert.equal(rt2.queue.stats().depth, 0);
  } finally { rm(d); }
});

test("crash between checkpoint save and ack: replay does not double-process", async () => {
  const d = tmp(); try {
    const rt = createRuntime({ dataDir: d, fetchImpl: fakeFetch([hit("1", good)]) });
    await rt.search(0);
    rt.queue.lease({ worker: "w" });
    const c = rt.state.candidates[0]; c.status = "NEEDS_VERIFICATION"; rt.save();   // saved, ack never happened
    const rt2 = createRuntime({ dataDir: d, fetchImpl: fakeFetch([]) });
    await rt2.execute(5);
    assert.equal(rt2.state.leads.length, 0);                                       // nothing re-screened
    assert.equal(rt2.queue.stats().done, 1);
  } finally { rm(d); }
});

test("a poisoned candidate retries then goes to the dead-letter state; it never blocks other work", async () => {
  const d = tmp(); try {
    const rt = createRuntime({ dataDir: d, retryBaseMs: 0, fetchImpl: fakeFetch([hit("1", good), hit("2", good)]) });
    await rt.search(0);
    rt.state.candidates[0].description = { toString() { throw new Error("poison"); } };   // clean() will throw
    for (let i = 0; i < 6; i++) await rt.execute(5 + (i % 3));
    const st = rt.queue.stats();
    assert.equal(st.dead, 1); assert.equal(rt.queue.deadLetters()[0].id, "hn-1");
    assert.equal(rt.state.candidates.find(c => c.id === "hn-1").status, "FAILED_DEAD_LETTER");
    assert.equal(rt.state.candidates.find(c => c.id === "hn-2").status, "NEEDS_VERIFICATION");
  } finally { rm(d); }
});

test("Safe Mode halts search dispatch AND screening, keeps queue intact, and survives restart", async () => {
  const d = tmp(); try {
    let calls = 0;
    const rt = createRuntime({ dataDir: d, fetchImpl: async () => { calls++; return { ok: true, status: 200, json: async () => ({ hits: [hit("1", good)] }) }; } });
    rt.safeMode.enter("TEST");
    await rt.search(0);
    assert.equal(calls, 0);
    assert.equal(rt.state.agents[0].status, "HALTED_BY_OWNER_STOP");
    rt.safeMode.exit; // (exit needs signed approval; covered in safety-modules tests)
    const rt2 = createRuntime({ dataDir: d, fetchImpl: async () => { calls++; return { ok: true, status: 200, json: async () => ({ hits: [hit("1", good)] }) }; } });
    assert.equal(rt2.dashboard().safeMode.mode, "SAFE_MODE");
    await rt2.search(1); assert.equal(calls, 0);
    rt2.queue.enqueue({ id: "manual", payload: {} });
    rt2.state.candidates.push({ id: "manual", title: "t", description: good, published: new Date().toISOString(), status: "NEW" });
    await rt2.execute(5);
    assert.equal(rt2.state.candidates.find(c => c.id === "manual").status, "NEW");
    assert.equal(rt2.queue.stats().ready, 1);
  } finally { rm(d); }
});

test("self-check FAIL at boot (corrupt queue journal) puts the runtime in Safe Mode instead of dispatching", () => {
  const d = tmp(); try {
    fs.mkdirSync(path.join(d, "queue"), { recursive: true });
    const line = JSON.stringify({ s: 1, op: "ENQ", id: "a", c: "badbadbadbadbadb" });
    fs.writeFileSync(path.join(d, "queue", "queue-journal.jsonl"), line + "\n" + line + "\n");
    assert.throws(() => createRuntime({ dataDir: d, fetchImpl: fakeFetch([]) }), /QUEUE_JOURNAL_CORRUPT/);
    const sm = JSON.parse(fs.readFileSync(path.join(d, "safe-mode.json"), "utf8"));
    assert.equal(sm.mode, "SAFE_MODE"); assert.equal(sm.reason, "SELF_CHECK_FAILED");
  } finally { rm(d); }
});

test("dashboard exposes self-check, watchdog, queue, vault and keeps the 5+25 topology", () => {
  const d = tmp(); try {
    const rt = createRuntime({ dataDir: d, fetchImpl: fakeFetch([]) });
    const dash = rt.dashboard();
    assert.equal(dash.search.configured, 5); assert.equal(dash.execution.configured, 25); assert.equal(dash.agents.length, 30);
    assert.ok(["OK", "DEGRADED"].includes(dash.selfCheck.level));
    assert.ok(dash.selfCheck.problems.some(p => p.id === "owner-auth"));          // honest: no owner key provisioned
    assert.equal(dash.vault.state, "LOCKED");
    assert.ok(dash.watchdog.components.some(c => c.id === "scheduler"));
  } finally { rm(d); }
});
