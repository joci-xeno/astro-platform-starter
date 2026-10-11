// 23-point item 22: the named security E2E gate suite. Runs all 12 gates against the real modules (synthetic data, no network) and checks the report contract.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runSecurityGates, runGates, GATE_IDS, GATE_NAMES, SUITE } from "../atlasz-addons/security-gates.mjs";
import { tmp, rm } from "./helpers.mjs";

const EXPECTED = { G01: /secrets never reach agents/, G02: /deny-by-default tool policy/, G03: /kill switch blocks everything/, G04: /approvals single-use/, G05: /audit chain tamper detected/, G06: /egress deny-by-default/,
  G07: /quarantine never executes/, G08: /memory classification isolation/, G09: /unsigned update refused/, G10: /simulated money never counted as revenue/, G11: /exactly 30 agents/, G12: /bind address stays loopback/ };

test("the suite has exactly the 12 named gates G01..G12", () => {
  assert.deepEqual([...GATE_IDS], Object.keys(EXPECTED));
  for (const [id, re] of Object.entries(EXPECTED)) assert.match(GATE_NAMES[id], re, id);
});

test("all 12 gates PASS against the real modules, each with executed evidence; exit code 0", async () => {
  const work = tmp("gates-");
  try {
    const r = await runSecurityGates({ workRoot: work });
    const failed = r.gates.filter(g => g.status !== "PASS").map(g => g.id + ": " + (g.error ?? g.failedChecks.join("; ")));
    assert.deepEqual(failed, [], failed.join("\n"));
    assert.equal(r.suite, SUITE); assert.equal(r.total, 12); assert.equal(r.passed, 12); assert.equal(r.failed, 0); assert.equal(r.exitCode, 0);
    for (const g of r.gates) { assert.ok(g.checks >= 3, g.id + " ran real checks"); assert.ok(g.evidence.every(e => e.ok === true && typeof e.check === "string" && e.check.length > 10)); assert.equal(g.error, null); }
    assert.ok(r.gates.find(g => g.id === "G06").checks >= 15);
    assert.match(r.gates.find(g => g.id === "G12").notes.join(" "), /0\.0\.0\.0/, "G12 states honestly that the cloud runtime binds 0.0.0.0 and is out of its scope");
    assert.deepEqual(fs.readdirSync(work), [], "every gate cleaned up its temporary folder");
  } finally { rm(work); }
});

test("the report never claims LIVE or VERIFIED_WORKING", async () => {
  const r = await runSecurityGates({ only: ["G02", "G04"] });
  const txt = JSON.stringify(r);
  assert.ok(!/VERIFIED_WORKING/.test(txt)); assert.match(r.meaning, /not LIVE/); assert.match(r.meaning, /not proof of wiring/);
});

test("`only` runs the selected gates; an empty selection proves nothing and exits 1", async () => {
  const r = await runSecurityGates({ only: ["G05"] });
  assert.deepEqual(r.gates.map(g => g.id), ["G05"]); assert.equal(r.exitCode, 0);
  const none = await runSecurityGates({ only: ["G99"] });
  assert.equal(none.total, 0); assert.equal(none.exitCode, 1);
});

test("runner fail paths: a failing check, a thrown error, a gate with no checks and a truthy-but-not-true check are all FAIL with exit code 1", async () => {
  const r = await runGates([
    { id: "X1", name: "failing check", run: t => { t.check(true, "first check holds"); t.check(false, "second check fails"); } },
    { id: "X2", name: "throws", run: () => { throw new Error("boom"); } },
    { id: "X3", name: "no checks", run: () => {} },
    { id: "X4", name: "truthy", run: t => { t.check(1, "a number is not a pass"); } },
    { id: "X5", name: "passes", run: async t => { t.check(true, "holds"); } }]);
  assert.deepEqual(r.gates.map(g => g.status), ["FAIL", "FAIL", "FAIL", "FAIL", "PASS"]);
  assert.deepEqual(r.gates[0].failedChecks, ["second check fails"]); assert.match(r.gates[1].error, /boom/);
  assert.equal(r.failed, 4); assert.equal(r.exitCode, 1);
});

test("an unusable work folder fails the gate instead of throwing", async () => {
  const r = await runSecurityGates({ only: ["G02"], workRoot: "/nonexistent-atlasz-gate-root/x" });
  assert.equal(r.gates[0].status, "FAIL"); assert.match(r.gates[0].error, /ENOENT/); assert.equal(r.exitCode, 1);
});
