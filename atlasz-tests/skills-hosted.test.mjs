// C05 skills as hosted by the Control Center (HTTP, real server): submit -> test gate -> OWNER activation -> run, restart persistence, kill switch, token required.
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
async function boot(base) {
  const stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort() }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const post = (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) });
  const wb = async (op, args) => { const r = await post("/api/workbench/action", { op, args }); return { status: r.status, ...JSON.parse(r.body) }; };
  return { post, wb, close: async () => { await cc.close?.(); } };
}
const skill = { id: "csv-rows", name: "CSV row count", description: "Counts the rows of a CSV", params: { csv: { type: "string", required: true } }, permissions: ["analyst.analyze"],
  steps: [{ id: "an", action: "analyst.analyze", args: { csv: "{{p.csv}}" } }],
  tests: [{ name: "analyses a small csv", params: { csv: "a,b\n1,2\n3,4\n" }, expect: { outputs: { an: { report: { rows: 2 } } } } }, { name: "refuses empty csv", negative: true, params: { csv: "" }, expect: { status: "FAILED" } }] };

test("HTTP: skill lifecycle through the real Control Center - drafts cannot run, the gate runs real tests, the owner activates, it survives a restart, the kill switch stops it", async () => {
  const base = tmp("skh-"); let c = await boot(base);
  try {
    assert.deepEqual((await c.wb("skill.actions", {})).result.actions.sort(), ["analyst.analyze", "chunk.plan", "effort.choose", "text.compare", "transcript.analyze"], "memory/notes writers are not available to skills");
    assert.equal((await c.post("/api/workbench/action", { op: "skill.list", args: {} }, null)).status, 401, "token required");
    await c.post("/api/owner-key", { passphrase: "correct horse battery" });
    const sub = (await c.wb("skill.submit", skill)).result; assert.deepEqual([sub.ok, sub.version, sub.status], [true, 1, "SUBMITTED"]);
    assert.equal((await c.wb("skill.run", { id: "csv-rows", params: { csv: "a\n1\n" } })).status >= 400, true, "a draft cannot run");
    assert.equal((await c.wb("skill.activate", { id: "csv-rows", version: 1 })).status >= 400, true, "not activatable before the gate");
    const g = (await c.wb("skill.gate", { id: "csv-rows", version: 1 })).result; assert.equal(g.passed, true, JSON.stringify(g));
    const noPass = await c.wb("skill.activate", { id: "csv-rows", version: 1 }); assert.equal(noPass.status >= 400, true); assert.equal(noPass.result, undefined, "activation needs the owner passphrase");
    const forged = await c.wb("skill.activate", { id: "csv-rows", version: 1, ownerApproval: { forged: true } }); assert.equal(forged.status >= 400, true, "an approval supplied by the request is ignored");
    const wrongPass = await c.wb("skill.activate", { id: "csv-rows", version: 1, passphrase: "not the passphrase" }); assert.equal(wrongPass.status >= 400, true); assert.equal((await c.wb("skill.list", {})).result.skills[0].active, null, "a wrong passphrase activates nothing");
    assert.equal((await c.wb("skill.activate", { id: "csv-rows", version: 1, passphrase: "correct horse battery" })).result.ok, true);
    const run = (await c.wb("skill.run", { id: "csv-rows", params: { csv: "a,b\n1,2\n3,4\n5,6\n" } })).result; assert.deepEqual([run.ok, run.outputs.an.report.rows], [true, 3]);
    await c.close(); c = await boot(base);
    assert.equal((await c.wb("skill.list", {})).result.skills[0].active, 1, "active version persisted");
    assert.equal((await c.wb("skill.run", { id: "csv-rows", params: { csv: "a\n1\n" } })).result.ok, true);
    // unknown / non-pure action in a submission
    assert.equal((await c.wb("skill.submit", { ...skill, id: "bad", steps: [{ id: "n", action: "notes.addNote", args: { title: "x" } }], permissions: ["notes.addNote"] })).status >= 400, true, "writers are refused");
    // kill switch
    assert.equal(JSON.parse((await c.post("/api/emergency", { mode: "PAUSE_ALL", passphrase: "correct horse battery" })).body).ok, true);
    const stopped = await c.wb("skill.run", { id: "csv-rows", params: { csv: "a\n1\n" } }); assert.equal(stopped.status >= 400, true); assert.match(JSON.stringify(stopped), /EMERGENCY_STOP_ACTIVE/);
  } finally { await c.close(); rm(base); }
});
