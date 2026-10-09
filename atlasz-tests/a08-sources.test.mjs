// A08: all six suggestion sources (approvals, decisions, workflows, skills, plugins, preferences) driven from their REAL producers in the Control Center, then listed, deduplicated,
// snoozed and persisted; empty, malformed and hostile inputs; suggestions stay pointers (canAct:false) and never act.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
import { createApprovalRequests } from "../atlasz-addons/approval-requests.mjs";
import { SOURCES, collectCandidates, normalizeCandidate } from "../atlasz-addons/suggestions.mjs";

const SKILL = { id: "csv-rows", name: "CSV row count", description: "Counts the rows of a CSV", params: { csv: { type: "string", required: true } }, permissions: ["analyst.analyze"],
  steps: [{ id: "an", action: "analyst.analyze", args: { csv: "{{p.csv}}" } }],
  tests: [{ name: "analyses a small csv", params: { csv: "a,b\n1,2\n3,4\n" }, expect: { outputs: { an: { report: { rows: 2 } } } } }, { name: "refuses empty csv", negative: true, params: { csv: "" }, expect: { status: "FAILED" } }] };
const PW = "correct horse battery", SK = "s" + "k-ABCDEFGHIJKLMNOPQRSTUV";
const world = async () => {
  const base = tmp("a08-"), configDir = path.join(base, "c"), stateDir = path.join(base, "s"), core = createControlCenterCore({ stateDir, configDir }); await core.provisionOwnerKey({ passphrase: PW });
  const W = async (op, args = {}) => core.workbenchAction({ op, args });
  return { base, configDir, stateDir, core, W, reopen: () => createControlCenterCore({ stateDir, configDir }), done: () => rm(base) };
};
const keys = r => r.shown.map(x => x.key).sort();

test("all six sources are produced by their real owners and surface as pointer-only suggestions", async () => {
  const w = await world();
  try {
    assert.deepEqual((await w.W("suggest.list")).shown, [], "empty system: nothing to suggest");
    // 1 approvals: a pending request in the approval store
    createApprovalRequests({ dir: path.join(w.stateDir, "approvals") }).request({ action: "PLUGIN_ENABLE", subject: "x#1", what: "Enable plugin x", why: "test", externalEffect: "none", ifOwnerSaysNo: "stays off", noSpendAlternative: "none", requestedBy: "SYSTEM", costUsd: 0, risk: { level: "LOW", description: "d" }, reversible: true });
    // 2 decisions: a proposed project decision
    const pr = await w.W("memory.createProject", { name: "Warehouse" }); const pid = pr.id ?? pr.project?.id;
    assert.ok(pid, JSON.stringify(pr)); assert.equal((await w.W("memory.propose", { projectId: pid, title: "Use Maple Street", decision: "Rent Maple Street", rationale: "cheapest" })).ok, true);
    // 3 workflows: a failed instance (analyst with an empty csv throws)
    assert.equal((await w.W("workflow.save", { id: "bad", name: "Bad", steps: [{ id: "a", action: "analyst.analyze", args: { csv: "" } }] })).ok, true);
    await w.W("workflow.start", { templateId: "bad" }); await w.W("workflow.run", { id: (await w.W("workflow.instances", {})).instances?.[0]?.id });
    // 4 skills: submitted and gated but not activated
    const sk = await w.W("skill.submit", SKILL); assert.equal(sk.ok, true, JSON.stringify(sk)); const g = await w.W("skill.gate", { id: "csv-rows", version: sk.version }); assert.equal(g.ok, true, JSON.stringify(g));
    // 5 plugins: a hook that keeps crashing is quarantined by the manager
    const pdir = path.join(w.configDir, "plugins", "p"); fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, "plugin.json"), JSON.stringify({ schema: 1, version: "1.0.0", atlaszCompat: ">=7.3.0", id: "boom", name: "Boom", kind: "PLUGIN", permissions: ["READ_STATE"], entry: "m.mjs" })); fs.writeFileSync(path.join(pdir, "m.mjs"), "process.exit(3);");
    assert.equal((await w.core.pluginActions.enable({ id: "boom", passphrase: PW })).result.ok, true); for (let i = 0; i < 3; i++) assert.equal((await w.core.pluginActions.invoke({ id: "boom", hook: "x" })).result.ok, false);
    // 6 preferences: a pending proposal
    assert.equal((await w.W("pref.propose", { key: "ui.detailLevel", value: "brief", reason: "you chose it 3 times" })).ok, true);
    const l = await w.W("suggest.list"); const bySrc = Object.fromEntries(l.shown.map(x => [x.source, x]));
    const missing = ["approvals", "decisions", "workflows", "skills", "plugins", "preferences"].filter(s => !bySrc[s]); assert.deepEqual(missing, [], JSON.stringify(l.shown.map(x => x.source + ":" + x.key)));
    for (const x of l.shown) assert.equal(x.canAct, false, x.key);
    assert.ok(l.shown.every(x => x.key.length <= 80));
    // dedup: asking twice yields the same keys, not duplicates
    assert.deepEqual(keys(await w.W("suggest.list")), keys(l)); assert.equal(new Set(l.shown.map(x => x.key)).size, l.shown.length);
    assert.ok(bySrc.skills, "a TESTED, inactive skill is suggested"); assert.match(bySrc.skills.title, /CSV row count/);
    // dismissing one hides it, survives a restart, and changes nothing else
    const k = l.shown[0].key; assert.equal((await w.W("suggest.dismiss", { key: k })).ok, true);
    const w2 = { W: (op, args = {}) => w.reopen().workbenchAction({ op, args }) }; assert.ok(!keys(await w2.W("suggest.list")).includes(k), "snooze persisted across restart");
  } finally { w.done(); }
});

test("normal, empty, malformed and hostile snapshots: nothing throws, nothing is invented, secrets and markup never reach a title", () => {
  for (const [name, f] of Object.entries(SOURCES)) {
    for (const bad of [undefined, null, 0, "x", {}, [null], [undefined], [[]], [{}], [{ id: {} }], [{ id: "a".repeat(500) }], [{ id: "__proto__" }]]) assert.doesNotThrow(() => f(bad), name);
    assert.deepEqual(f(undefined), [], name); assert.deepEqual(f([]), [], name);
  }
  assert.deepEqual(collectCandidates(null), []); assert.deepEqual(collectCandidates({ approvals: "nope", plugins: 5 }), []);
  const hostile = collectCandidates({ approvals: [{ id: "ok1", action: "x\u0007‮ " + SK + " <script>alert(1)</script>" }], plugins: [{ id: "p1", status: "QUARANTINED" }, { id: "p2", status: "ENABLED" }, { id: "p3", quarantined: true }], workflows: [{ id: "w1", status: "FAILED", reason: SK }, { id: "w2", status: "DONE" }] });
  assert.deepEqual(hostile.filter(c => c.source === "plugins").map(c => c.key).sort(), ["plugin:p1", "plugin:p3"], "real plugin list entries use status; only quarantined ones are suggested");
  for (const c of hostile) { const n = normalizeCandidate(c); assert.ok(n === null || (!n.title.includes(SK) && !n.detail.includes(SK) && !/[‮\u0007]/.test(n.title))); }
  assert.equal(normalizeCandidate({ key: "A B", source: "approvals", title: "x" }), null); assert.equal(normalizeCandidate([]), null);
});

test("authorization: suggestions are read-only pointers; an agent cannot dismiss/unsnooze or mute a source, and the owner-only ops do not exist as agent tools", async () => {
  const { TOOL_POLICY } = await import("../atlasz-addons/agent-tool-policy.mjs");
  assert.ok(!Object.keys(TOOL_POLICY).some(t => /^suggest\./.test(t)), "no suggest.* typed tool is exposed to agents");
  const w = await world();
  try { for (const k of ["../../etc/passwd", "__proto__", "A B", "x".repeat(200), 5, null]) await assert.rejects(() => w.W("suggest.dismiss", { key: k }), /KEY_INVALID|KEY/, String(k)); } finally { w.done(); }
});
