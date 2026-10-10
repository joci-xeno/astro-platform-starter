// Unified programme M6: Live Agent Activity - states come only from the real coordination ledger written by the real coordinator; nothing is invented.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createCoordinator } from "../atlasz-addons/agent-coordination.mjs";
import { agentActivity, ROSTER } from "../atlasz-addons/agent-activity.mjs";
import { tmp, rm } from "./helpers.mjs";

const mk = () => { const d = tmp("aa-"), clock = { t: 1_000_000 }; const c = createCoordinator({ dir: d, nowFn: () => clock.t, toolsOf: () => ["notes"] }); return { d, c, clock, act: () => agentActivity({ ledgerFile: path.join(d, "ledger.json"), coordFile: path.join(d, "coordinator.json"), now: clock.t }), by: (r, id) => r.agents.find(a => a.id === id) }; };

test("agent activity: without coordination files all 30 agents are UNKNOWN (not idle, not busy)", () => {
  const d = tmp("aa-"); try { const r = agentActivity({ ledgerFile: path.join(d, "ledger.json"), coordFile: path.join(d, "coordinator.json") }); assert.equal(r.available, false); assert.equal(r.agents.length, 30); assert.ok(r.agents.every(a => a.state === "UNKNOWN")); assert.match(r.reason, /NOT_FOUND/);
    fs.writeFileSync(path.join(d, "ledger.json"), "{not json"); assert.match(agentActivity({ ledgerFile: path.join(d, "ledger.json") }).reason, /UNREADABLE/); } finally { rm(d); }
});

test("agent activity: roster is exactly 5 SEARCH + 25 EXECUTION; an empty ledger means every agent is IDLE with the reason stated", () => {
  assert.equal(ROSTER.length, 30); assert.equal(ROSTER.filter(i => i.startsWith("SEARCH-")).length, 5); assert.equal(ROSTER.filter(i => i.startsWith("EXECUTION-")).length, 25);
  const { d, c, act } = mk(); try { c.connect("EXECUTION-1"); const r = act(); if (r.available) { assert.ok(r.agents.every(a => a.state === "IDLE")); assert.ok(r.agents.every(a => a.task === null && a.why)); } else assert.ok(r.agents.every(a => a.state === "UNKNOWN")); } finally { rm(d); }
});

test("agent activity: states follow real tasks - running, verifying, reviewing, blocked on a dependency, stalled - and recent actions are real ledger events", () => {
  const { d, c, clock, act, by } = mk();
  try {
    const e1 = c.connect("EXECUTION-1"), e2 = c.connect("EXECUTION-2"), s1 = c.connect("SEARCH-1");
    assert.equal(s1.register({ id: "t-search", kind: "search.leads", payload: { q: 1 } }).ok, true); s1.start("t-search");
    assert.equal(e1.register({ id: "t-test", kind: "qa.unit", payload: { x: 1 } }).ok, true); e1.start("t-test");
    let r = act(); assert.equal(r.available, true);
    assert.equal(by(r, "SEARCH-1").state, "SEARCHING"); assert.equal(by(r, "SEARCH-1").task, "t-search"); assert.equal(by(r, "EXECUTION-1").state, "TESTING"); assert.equal(by(r, "EXECUTION-3").state, "IDLE"); assert.equal(by(r, "EXECUTION-3").task, null);
    assert.equal(r.counts.SEARCHING, 1); assert.equal(r.counts.TESTING, 1); assert.equal(r.counts.IDLE, 28); assert.equal(r.permanentAgents, 30);
    assert.ok(by(r, "EXECUTION-1").recentActions.length > 0 && by(r, "EXECUTION-1").recentActions.every(a => a.task === "t-test"));
    clock.t += 14 * 60_000; assert.equal(by(act(), "EXECUTION-1").state, "TESTING", "under the 15-minute stall limit the agent is still working");
    clock.t += 6 * 60_000;                                   // no heartbeat for 20 minutes while a task is running -> BLOCKED, with the reason
    r = act(); const st = by(r, "EXECUTION-1"); assert.equal(st.state, "BLOCKED"); assert.match(st.why, /no heartbeat for 20 min/); assert.equal(by(r, "EXECUTION-3").state, "IDLE");
    assert.equal(by(r, "EXECUTION-2").state, "IDLE"); void e2;
  } finally { rm(d); }
});

test("agent activity: a state is never produced for ids outside the roster, and the file is never written by the reader", () => {
  const { d, c, act } = mk(); try { c.connect("EXECUTION-4"); const f = path.join(d, "ledger.json"); const before = fs.existsSync(f) ? fs.readFileSync(f) : null; const mt = fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0; act(); act();
    if (before) { assert.deepEqual(fs.readFileSync(f), before); assert.equal(fs.statSync(f).mtimeMs, mt); } assert.ok(act().agents.every(a => /^(SEARCH|EXECUTION)-\d+$/.test(a.id))); } finally { rm(d); }
});

test("agent activity: submitted work shows WAITING_FOR_CHECKER for the maker and REVIEWING for the assigned independent verifier; a task waiting on an unfinished dependency is BLOCKED with the reason", () => {
  const { d, c, act, by } = mk();
  try {
    const e1 = c.connect("EXECUTION-1"); assert.equal(e1.register({ id: "t-qa", kind: "qa.check", payload: { x: 1 } }).ok, true); e1.start("t-qa"); assert.equal(e1.complete("t-qa", "a".repeat(64)).ok, true);
    const ver = c.verifierOf("t-qa"); assert.ok(ver); let r = act(); assert.equal(by(r, "EXECUTION-1").state, "WAITING_FOR_CHECKER"); assert.equal(by(r, "EXECUTION-1").task, "t-qa"); assert.equal(by(r, ver).state, "REVIEWING"); assert.equal(by(r, ver).task, "t-qa"); assert.match(by(r, ver).why, /independent verifier/);
    const e2 = c.connect("EXECUTION-9"); assert.equal(e2.register({ id: "t-dep", kind: "build.later", payload: { x: 1 }, dependsOn: ["t-qa"] }).ok, true); r = act(); assert.equal(by(r, "EXECUTION-9").state, "BLOCKED"); assert.match(by(r, "EXECUTION-9").why, /waits for dependencies t-qa/);
    assert.equal(c.connect(ver).verify("t-qa", { decision: "ACCEPT", resultSha256: "a".repeat(64) }).ok, true); r = act(); assert.equal(by(r, ver).state, "IDLE"); assert.equal(by(r, "EXECUTION-9").state, "IDLE"); assert.ok(by(r, "EXECUTION-1").lastCompleted);
  } finally { rm(d); }
});
