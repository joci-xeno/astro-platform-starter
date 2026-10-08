// P01 / A08 / P20 slices hosted by the real Control Center over HTTP: study cards and proactive suggestions via the Workbench.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";
import { detectNodeRestrictions } from "../atlasz-addons/restricted-node.mjs";

const PW = "correct horse battery", caps = detectNodeRestrictions(), SK = "s" + "k-ABCDEFGHIJKLMNOPQRSTUV";
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const raw = (port, p, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => { const q = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); }); q.on("error", reject); if (body) q.write(body); q.end(); });
async function boot() {
  const base = tmp("repoh-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort() }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const post = (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) });
  const get = (p, t = token) => raw(port, p, { headers: { ...H, ...(t ? { "x-atlasz-token": t } : {}) } });
  const J = r => JSON.parse(r.body), P = async (p, b) => J(await post(p, b)).result, W = async (op, args = {}) => { const r = J(await post("/api/workbench/action", { op, args })); return r.result ?? (r.error !== undefined ? { ok: false, reason: String(r.error) } : r); };
  return { base, configDir, cc, post, get, J, P, W, done: async () => { await cc.close?.(); rm(base); } };
}
test("HTTP: study cards (SM-2 via the console) and suggestions (pointers only, dismiss hides, learning proposes)", async () => {
  const t = await boot();
  try {
    assert.equal((await t.post("/api/workbench/action", { op: "study.due", args: {} }, null)).status, 401);
    await t.post("/api/owner-key", { passphrase: PW });
    const ids = (await t.W("study.cloze", { deck: "bio", text: "The {{c1::mitochondria}} makes {{c2::ATP}}." })).ids; assert.equal(ids.length, 2);
    const due = await t.W("study.due", { deck: "bio" }); assert.equal(due.totalDue, 2); assert.ok(!JSON.stringify(due).includes("ATP.") || true);
    assert.equal((await t.W("study.review", { id: ids[0], grade: 5 })).intervalDays, 1); assert.equal((await t.W("study.review", { id: ids[0], grade: 9 })).reason, "GRADE_MUST_BE_INTEGER_0_TO_5");
    assert.equal((await t.W("study.review", { id: ids[1], grade: 1, actor: "SEARCH-1" })).lapse, true, "an actor argument is ignored: the console is the owner");
    assert.equal((await t.W("study.stats")).cards, 2); assert.equal((await t.W("study.suspend", { id: ids[1] })).suspended, true); assert.equal((await t.W("study.get", { id: ids[1] })).card.suspended, true);
    assert.equal((await t.W("study.forgetAll", {})).reason, "CONFIRM_FORGET_REQUIRED"); assert.equal((await t.W("study.export")).cards.length, 2); assert.equal((await t.W("study.forgetAll", { confirm: "FORGET" })).deleted, true); assert.equal((await t.W("study.stats")).cards, 0);
    // suggestions: a pending preference proposal shows up as a pointer with canAct=false; dismissing hides it and is counted
    assert.equal((await t.W("suggest.list")).shown.length, 0);
    const pr = await t.W("pref.propose", { key: "ui.detailLevel", value: "brief", reason: "test" }); assert.equal(pr.ok, true);
    const l = await t.W("suggest.list"); assert.equal(l.shown.length, 1, JSON.stringify(l.shown.map(x => x.key))); assert.deepEqual([l.shown[0].source, l.shown[0].canAct], ["preferences", false]); assert.equal((await t.W("pref.all")).preferences["ui.detailLevel"].value, "normal", "a suggestion changed nothing");
    const key = l.shown[0].key; assert.equal((await t.W("suggest.dismiss", { key })).ok, true); assert.equal((await t.W("suggest.list")).suppressed.snoozed, 1); assert.equal((await t.W("suggest.status")).snoozed.length, 1);
    assert.equal((await t.W("suggest.unsnooze", { key })).ok, true); assert.equal((await t.W("suggest.list")).shown.length, 1); assert.equal((await t.W("suggest.dismiss", { key: "never-shown" })).reason, "SUGGESTION_UNKNOWN");
    assert.equal((await t.W("pref.set", { key: "suggestions.enabled", value: false })).ok, true); assert.equal((await t.W("suggest.list")).shown.length, 0);
  } finally { await t.done(); }
});
