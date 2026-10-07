import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmp, rm } from "./helpers.mjs";
import { createBehaviorMonitor } from "../atlasz-addons/brain/behavior-monitor.mjs";
import { createBlackBox } from "../atlasz-addons/brain/black-box.mjs";

const t0 = Date.parse("2026-10-07T10:00:00Z"), at = s => new Date(t0 + s * 1000).toISOString();
const ev = (o, i) => ({ seq: i + 1, at: at(i), ...o });
const kinds = (m, events) => m.detect(events).map(f => f.kind);

test("LOOP: the same agent repeating the same action on the same input is flagged; spread-out or varied work is not", () => {
  const m = createBehaviorMonitor();
  assert.deepEqual(kinds(m, Array.from({ length: 5 }, (_, i) => ev({ kind: "TASK", agentId: "E1", inputRef: "x" }, i))), ["LOOP"]);
  assert.deepEqual(kinds(m, Array.from({ length: 5 }, (_, i) => ev({ kind: "TASK", agentId: "E1", inputRef: "x" }, i * 1000))), []);          // 16 min apart: outside the window
  assert.deepEqual(kinds(m, Array.from({ length: 5 }, (_, i) => ev({ kind: "TASK", agentId: "E1", inputRef: "x" + i }, i))), []);
});

test("COST_SPIKE: any unapproved cost under no-spend is HIGH; with budget a cost far above the median is flagged", () => {
  const m = createBehaviorMonitor(); const f = m.detect([ev({ kind: "MODEL_CALL", agentId: "E2", costUsd: 0.5 }, 0)]); assert.equal(f[0].kind, "COST_SPIKE"); assert.equal(f[0].severity, "HIGH");
  assert.deepEqual(kinds(m, [ev({ kind: "MODEL_CALL", agentId: "E2", costUsd: 0.5, approval: "ap-1" }, 0)]), []);                                  // approved spend is not an anomaly by itself
  const b = createBehaviorMonitor({ noSpend: false }), base = Array.from({ length: 6 }, (_, i) => ev({ kind: "MODEL_CALL", agentId: "E2", costUsd: 1 }, i));
  assert.deepEqual(kinds(b, [...base, ev({ kind: "MODEL_CALL", agentId: "E2", costUsd: 9 }, 7)]), ["COST_SPIKE"]); assert.deepEqual(kinds(b, [...base, ev({ kind: "MODEL_CALL", agentId: "E2", costUsd: 3 }, 7)]), []);
});

test("BYPASS_ATTEMPT: repeated refusals/approval-required from one agent are flagged HIGH with quarantine review", () => {
  const m = createBehaviorMonitor(); const e = Array.from({ length: 3 }, (_, i) => ev({ kind: "ACTION", agentId: "E4", decision: "BLOCK", reason: "OWNER_APPROVAL_REQUIRED" }, i));
  const f = m.detect(e); assert.equal(f[0].kind, "BYPASS_ATTEMPT"); assert.equal(f[0].recommendation, "QUARANTINE_REVIEW"); assert.deepEqual(kinds(m, e.slice(0, 2)), []);
});

test("OBJECTIVE_DRIFT: acting with a capability outside the declared set", () => {
  const m = createBehaviorMonitor({ capabilities: { E5: ["screen"] } });
  assert.deepEqual(kinds(m, [ev({ kind: "ACTION", agentId: "E5", capability: "send_email" }, 0)]), ["OBJECTIVE_DRIFT"]); assert.deepEqual(kinds(m, [ev({ kind: "ACTION", agentId: "E5", capability: "screen" }, 0)]), []);
  assert.deepEqual(kinds(m, [ev({ kind: "ACTION", agentId: "unknown", capability: "x" }, 0)]), []);                                              // no declared set => nothing to compare against (not guessed)
});

test("QA_GAMING: self-judging, identical content passing after a fail, trivially short 'passes'", () => {
  const m = createBehaviorMonitor();
  assert.deepEqual(kinds(m, [ev({ kind: "JUDGED", agentId: "E6", judgeId: "E6", result: "ACCEPT", outputRef: "a1" }, 0)]), ["QA_GAMING"]);
  assert.deepEqual(kinds(m, [ev({ kind: "JUDGED", agentId: "E6", judgeId: "J1", result: "FAIL", outputRef: "a1", hash: "h" }, 0), ev({ kind: "JUDGED", agentId: "E6", judgeId: "J1", result: "PASS", outputRef: "a1", hash: "h" }, 1)]), ["QA_GAMING"]);
  assert.deepEqual(kinds(m, [ev({ kind: "JUDGED", agentId: "E6", judgeId: "J1", result: "FAIL", outputRef: "a1", hash: "h" }, 0), ev({ kind: "JUDGED", agentId: "E6", judgeId: "J1", result: "PASS", outputRef: "a1", hash: "h2" }, 1)]), []);   // changed content: legitimate repair
  assert.deepEqual(kinds(m, [ev({ kind: "JUDGED", agentId: "E6", judgeId: "J1", result: "PASS", outputRef: "a2", contentLength: 5 }, 0)]), ["QA_GAMING"]);
});

test("MUTUAL_REINFORCEMENT: two agents repeatedly accepting each other's work", () => {
  const m = createBehaviorMonitor(), e = []; for (let i = 0; i < 4; i++) { e.push(ev({ kind: "JUDGED", agentId: "E7", judgeId: "E8", result: "ACCEPT" }, i * 2)); e.push(ev({ kind: "JUDGED", agentId: "E8", judgeId: "E7", result: "ACCEPT" }, i * 2 + 1)); }
  assert.deepEqual(kinds(m, e), ["MUTUAL_REINFORCEMENT"]); assert.deepEqual(kinds(m, e.slice(0, 6)), []); assert.deepEqual(kinds(m, e.filter(x => x.agentId === "E7")), []); assert.deepEqual(kinds(m, e.filter(x => x.agentId === "E8")), []);      // one-way acceptance (a normal judge) is not collusion
});

test("scan on the REAL tamper-evident Black Box: findings stored once, recorded back, hook called, resolve needs who+note; nothing is auto-quarantined", () => {
  const d = tmp(); try {
    const bb = createBlackBox({ filePath: path.join(d, "bb.jsonl") }), got = [], m = createBehaviorMonitor({ blackBox: bb, file: path.join(d, "bm.json"), onAnomaly: a => got.push(a) });
    for (let i = 0; i < 3; i++) bb.record({ kind: "ACTION", agentId: "E4", decision: "BLOCK", reason: "OWNER_APPROVAL_REQUIRED" });
    const s1 = m.scan(); assert.equal(s1.newFindings.length, 1); assert.equal(got.length, 1); assert.ok(bb.query({ kind: "BEHAVIOR_ANOMALY" }).length >= 1);
    const s2 = m.scan(); assert.equal(s2.newFindings.length, 0); assert.equal(m.list()[0].count >= 2, true);                                         // de-duplicated, but seen again
    assert.throws(() => m.resolve(m.list()[0].id, { by: "J" }), /BY_AND_NOTE_REQUIRED/); m.resolve(m.list()[0].id, { by: "JOCI", note: "reviewed" }); assert.equal(m.summary().open, 0);
    assert.equal(createBehaviorMonitor({ file: path.join(d, "bm.json") }).list().length, 1);                                                          // durable
    assert.match(m.summary().note, /no control is changed/); assert.equal(bb.verify().ok, true);
    const m2 = createBehaviorMonitor({ onAnomaly: () => { throw new Error("hook down"); } }); assert.equal(m2.scan(Array.from({ length: 3 }, (_, i) => ev({ kind: "A", agentId: "E4", decision: "BLOCK" }, i))).newFindings.length, 1);   // a failing hook never hides a finding
  } finally { rm(d); }
});
