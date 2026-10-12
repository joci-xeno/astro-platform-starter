// Batch 7A: the canonical runtime keeps failed work across a restart, initialises Master/Brain/managers/agents from persisted state, and an emergency stop survives it.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path";
import { tmp, rm } from "./helpers.mjs";
const { createRuntime } = await import("../atlasz-runtime/supervisor-safe.mjs");
const noNet = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" });

test("runtime: a dead letter written by one process is visible to the restarted process; status reports the durable store; 30 agents re-initialise", () => {
  const d = tmp("rr-"); try {
    const rt = createRuntime({ dataDir: d, retryBaseMs: 0, fetchImpl: noNet });
    const r = rt.deadLetters.deadLetter({ item: { id: "job-9" }, error: "executor crashed", attempts: 3 }); rt.stop();
    const rt2 = createRuntime({ dataDir: d, retryBaseMs: 0, fetchImpl: noNet });
    assert.equal(rt2.deadLetters.get(r.id).taskId, "job-9"); const st = rt2.dashboard?.() ?? null;
    assert.equal(rt2.state.agents.length, 30); assert.equal(rt2.deadLetters.status().open, 1);
    if (st) assert.equal(st.deadLetters.open, 1);
    rt2.stop();
  } finally { rm(d); }
});
test("runtime: a damaged dead-letter chain does not stop the runtime from starting - it reports CORRUPT and keeps accepting failures in the overflow", () => {
  const d = tmp("rr-"); try {
    const rt = createRuntime({ dataDir: d, retryBaseMs: 0, fetchImpl: noNet }); rt.deadLetters.deadLetter({ item: { id: "a" }, error: "x", attempts: 1 }); rt.stop();
    const f = path.join(d, "dead-letters", "dead-letters.jsonl"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"attempts":1', '"attempts":9'));
    const rt2 = createRuntime({ dataDir: d, retryBaseMs: 0, fetchImpl: noNet }); assert.equal(rt2.deadLetters.status().state, "CORRUPT"); assert.equal(rt2.state.agents.length, 30);
    assert.equal(rt2.deadLetters.deadLetter({ item: { id: "b" }, error: "y", attempts: 1 }).storedIn, "OVERFLOW_STORE_CORRUPT"); rt2.stop();
  } finally { rm(d); }
});
