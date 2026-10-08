// B1 capabilities as hosted by the Control Center: project memory (C07), notes/reading list/ideas (P03), workflows (GE11/P06/P08/P05/P11), page comparison (P13), transcript -> steps (P02).
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const raw = (port, p, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => { const q = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); }); q.on("error", reject); if (body) q.write(body); q.end(); });
async function boot(base0 = null) {
  const base = base0 ?? tmp("b1-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort() }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const post = (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) });
  const wb = async (op, args) => { const r = await post("/api/workbench/action", { op, args }); return { status: r.status, ...JSON.parse(r.body) }; };
  return { base, stateDir, port, token, post, wb, close: async () => { await cc.close?.(); } };
}
test("HTTP: project memory - owner decisions persist across a Control Center restart; hash chain verifies; secrets never reach the file", async () => {
  const base = tmp("b1a-"); let c = await boot(base);
  try {
    const p = (await c.wb("memory.createProject", { name: "Warehouse", goal: "Open Q1" })).result.project;
    const d1 = (await c.wb("memory.propose", { projectId: p.id, title: "Site", decision: "Lease A, key " + "s" + "k-ABCDEFGHIJKLMNOPQRSTUVWX", evidence: ["kp:1"] })).result.id;
    assert.equal((await c.wb("memory.adopt", { projectId: p.id, decisionId: d1 })).result.status, "ADOPTED");
    const d2 = (await c.wb("memory.propose", { projectId: p.id, title: "Site B", decision: "Lease B" })).result.id; await c.wb("memory.adopt", { projectId: p.id, decisionId: d2 });
    assert.equal((await c.wb("memory.supersede", { projectId: p.id, oldId: d1, newId: d2 })).status, 200);
    await c.close(); c = await boot(base);
    assert.equal((await c.wb("memory.projects", {})).result.projects.length, 1); const ds = (await c.wb("memory.decisions", { projectId: p.id })).result.decisions; assert.deepEqual(ds.map(x => x.status), ["SUPERSEDED", "ADOPTED"]);
    assert.equal((await c.wb("memory.verify", {})).result.ok, true); const ctx = (await c.wb("memory.context", { projectId: p.id })).result; assert.ok(ctx.items.some(i => /Lease B/.test(i.text)) && !ctx.items.some(i => /Lease A/.test(i.text)));
    assert.ok(!fs.readFileSync(path.join(c.stateDir, "workbench", "project-memory.json"), "utf8").includes("k-ABCDEFGH"));
    assert.equal((await c.wb("memory.adopt", { projectId: "nope", decisionId: "x" })).status, 400);
    assert.equal((await c.post("/api/workbench/action", { op: "memory.projects", args: {} }, null)).status, 401);
  } finally { await c.close(); rm(base); }
});
test("HTTP: notes, reading list and ideas end to end (tags, progress, links, search, export), durable across a restart", async () => {
  const base = tmp("b1b-"); let c = await boot(base);
  try {
    const n = (await c.wb("notes.addNote", { title: "Rent", text: "4200", tags: ["Finance"] })).result.id, b = (await c.wb("notes.addBook", { title: "Deep Work", totalPages: 200, tags: ["focus"] })).result.id;
    await c.wb("notes.setReading", { id: b, pagesRead: 50 }); await c.wb("notes.addIdea", { title: "Cold room", links: [n], tags: ["finance"] }); await c.wb("notes.tag", { id: n, add: ["q1"] });
    await c.close(); c = await boot(base);
    assert.equal((await c.wb("notes.search", { tags: ["finance"] })).result.total, 2); assert.deepEqual((await c.wb("notes.readingList", {})).result.progress, [{ id: b, title: "Deep Work", percent: 25 }]);
    assert.deepEqual((await c.wb("notes.cloud", {})).result.tags.map(t => t.tag), ["finance", "focus", "q1"]); assert.match((await c.wb("notes.export", {})).result.markdown, /Deep Work/);
    assert.equal((await c.wb("notes.addNote", { title: "x", tags: ["bad/tag"] })).status, 400); assert.equal((await c.wb("notes.setReading", { id: b, pagesRead: 999 })).status, 400);
  } finally { await c.close(); rm(base); }
});
test("HTTP: workflow end to end - template with real actions, run, per-step results; rewind refused past a side-effect step; resume after restart; kill switch stops runs", async () => {
  const base = tmp("b1c-"); let c = await boot(base);
  try {
    assert.ok((await c.wb("workflow.actions", {})).result.actions.includes("analyst.analyze"));
    const save = await c.wb("workflow.save", { id: "report", name: "CSV report", params: { csv: { type: "string", required: true }, title: { type: "string", default: "Weekly" } },
      steps: [{ id: "an", action: "analyst.analyze", args: { csv: "{{p.csv}}" } }, { id: "note", action: "notes.addNote", args: { title: "{{p.title}} report", text: "hash {{s.an.reportHash}}", tags: ["report"] } }] });
    assert.equal(save.status, 200); assert.equal((await c.wb("workflow.save", { id: "bad", name: "bad", steps: [{ id: "a", action: "shell.exec", args: { cmd: "rm -rf /" } }] })).status, 400);
    const id = (await c.wb("workflow.start", { templateId: "report", params: { csv: "a,b\n1,2\n3,4\n5,6\n" } })).result.id, run = await c.wb("workflow.run", { id }); assert.equal(run.result.status, "DONE");
    const inst = (await c.wb("workflow.instance", { id })).result.instance; assert.deepEqual(inst.steps.map(s => s.status), ["DONE", "DONE"]); assert.match(inst.steps[0].output.reportHash, /^[0-9a-f]{16,}$/);
    const found = (await c.wb("notes.search", { tags: ["report"] })).result.items[0]; assert.match(found.text, /^hash [0-9a-f]+$/);
    assert.equal((await c.wb("workflow.rewind", { id, toStepId: "an" })).status, 400, "the notes.addNote step has an external side effect: rewind refused");
    assert.equal((await c.wb("workflow.rewind", { id, toStepId: "note" })).status, 200);
    // restart: instance survives; batch with an invalid item starts nothing
    await c.close(); c = await boot(base);
    assert.equal((await c.wb("workflow.instance", { id })).result.instance.status, "DONE", "rewind to the last step was a no-op and changed nothing");
    const bad = await c.wb("workflow.batchCreate", { templateId: "report", items: [{ csv: "a\n1\n" }, { csv: 5 }] }); assert.equal(bad.status, 400); assert.match(bad.error, /ITEM_1_PARAMETER_INVALID:csv/);
    const b = (await c.wb("workflow.batchCreate", { templateId: "report", items: [{ csv: "a,b\n1,2\n" }, { csv: "a,b\n1\n" }, { csv: "a,b\n3,4\n" }], ratePerMinute: 100 })).result.id;
    const br = (await c.wb("workflow.batchRun", { id: b })).result; assert.deepEqual([br.status, br.DONE, br.FAILED], ["DONE_WITH_ERRORS", 2, 1]);
    // kill switch
    assert.equal((await c.post("/api/owner-key", { passphrase: "correct horse battery" })).status, 200);
    const id2 = (await c.wb("workflow.start", { templateId: "report", params: { csv: "a,b\n1,2\n" } })).result.id;
    assert.equal((await c.post("/api/emergency", { mode: "PAUSE_ALL", passphrase: "correct horse battery" })).status, 200);
    for (const op of ["workflow.run", "workflow.resume"]) { const r = await c.wb(op, { id: id2 }); assert.equal(r.status, 400); assert.match(r.error, /EMERGENCY_STOP_ACTIVE/, op); }
    assert.match((await c.wb("workflow.batchRun", { id: b })).error, /EMERGENCY_STOP_ACTIVE/); assert.match((await c.wb("workflow.tick", {})).error, /EMERGENCY_STOP_ACTIVE/);
  } finally { await c.close(); rm(base); }
});
test("HTTP: page comparison and transcript analysis work on supplied text only and return untrusted-labelled, validated output", async () => {
  const c = await boot();
  try {
    const r = (await c.wb("compare.pages", { pages: [{ label: "A", text: "<h1>Widget</h1><p>Price $49.99</p>" }, { label: "B", text: "<h1>Widget</h1><p>Price $59.99</p>" }] })).result;
    assert.equal(r.untrusted, true); assert.ok(r.pairs[0].numbersOnlyInB.some(x => x.includes("59.99")));
    assert.equal((await c.wb("compare.pages", { pages: [{ text: "only one" }] })).status, 400);
    const t = (await c.wb("transcript.analyze", { transcript: "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nFirst, open the settings page and click save.\n" })).result;
    assert.equal(t.source, "SUPPLIED_TRANSCRIPT"); assert.equal(t.steps[0].at, "00:01"); assert.equal((await c.wb("transcript.analyze", { transcript: "" })).status, 400);
    assert.equal((await c.wb("nope.op", {})).status, 400);
  } finally { await c.close(); }
});
test("HTTP: the optional scheduler runs a due scheduled workflow by itself, exactly once per period; off by default", async () => {
  const base = tmp("b1s-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const mk = async schedulerMs => { const cc = createControlCenterServer({ stateDir, configDir, port: await freePort(), schedulerMs }); const { port, token } = await cc.listen(); const wb = async (op, args) => JSON.parse((await raw(port, "/api/workbench/action", { method: "POST", headers: { host: "127.0.0.1:" + port, "content-type": "application/json", "x-atlasz-token": token }, body: JSON.stringify({ op, args }) })).body); return { cc, wb }; };
  let a = await mk(0);
  try {
    await a.wb("workflow.save", { id: "cron", name: "cron", steps: [{ id: "n", action: "notes.addNote", args: { title: "tick", text: "scheduled" } }], schedule: { everyMinutes: 60, params: {} } });
    await new Promise(r => setTimeout(r, 1300)); assert.equal((await a.wb("workflow.instances", {})).result.instances.length, 0, "scheduler off by default");
    await a.cc.close(); a = await mk(1000); await new Promise(r => setTimeout(r, 2600));
    const list = (await a.wb("workflow.instances", {})).result.instances; assert.equal(list.length, 1, "ran once, period consumed"); assert.equal(list[0].status, "DONE");
  } finally { await a.cc.close(); rm(base); }
});
