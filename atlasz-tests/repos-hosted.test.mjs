// C01 / P07 / A11 slices hosted by the real Control Center over HTTP: repo analysis + sandboxed tests, code review op, preference ops.
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
function mkRepo(configDir, name) {
  const root = path.join(configDir, "repos", name); fs.mkdirSync(path.join(root, "tests"), { recursive: true }); fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/a.mjs"), "export const a = 1;\nconst k = \"" + SK + "\";\n"); fs.writeFileSync(path.join(root, "tests/a.test.mjs"), "import test from 'node:test'; import assert from 'node:assert/strict'; import { a } from '../src/a.mjs';\ntest('a', () => assert.equal(a, 1));\n"); return root;
}
test("HTTP: repos - listing, read-only analysis, name/symlink refusal, test run needs the owner passphrase and is single-use per approval", { skip: !(caps.permission && caps.namespace) && "host cannot isolate network" }, async () => {
  const t = await boot();
  try {
    assert.equal((await t.get("/api/repos", null)).status, 401); assert.equal((await t.post("/api/repos/analyze", { name: "demo" }, null)).status, 401);
    await t.post("/api/owner-key", { passphrase: PW });
    assert.deepEqual(t.J(await t.get("/api/repos")).repos, []);
    const root = mkRepo(t.configDir, "demo"); fs.symlinkSync(root, path.join(t.configDir, "repos", "linked"));
    assert.deepEqual(t.J(await t.get("/api/repos")).repos, ["demo"], "a symlinked folder is not listed");
    const an = await t.P("/api/repos/analyze", { name: "demo" }); assert.equal(an.ok, true); assert.equal(an.result.ok, true); assert.equal(an.result.review.verdict, "BLOCK"); assert.ok(!JSON.stringify(an).includes("ABCDEFGHIJKLMNOPQRSTUV"));
    for (const name of ["../x", "a/b", "", null, 5, "nope", "linked", ".hid"]) assert.equal(Boolean((await t.P("/api/repos/analyze", { name })).result?.ok), false, String(name));
    for (const body of [{ name: "demo" }, { name: "demo", passphrase: "wrong wrong wrong" }]) { const r = await t.P("/api/repos/test", body); assert.equal(Boolean(r.result?.ok), false); }
    const run = await t.P("/api/repos/test", { name: "demo", passphrase: PW }); assert.equal(run.result.ok, true, JSON.stringify(run)); assert.deepEqual([run.result.ran, run.result.passed, run.result.failed], [1, 1, 0]); assert.equal(run.result.isolation, "PERMISSION+NETWORK_NAMESPACE");
    fs.writeFileSync(path.join(root, "src/a.mjs"), "export const a = 2;\n"); const after = await t.P("/api/repos/test", { name: "demo", passphrase: PW }); assert.equal(after.result.results[0].status, "FAILED", "a changed file is re-analysed and the failure is reported honestly");
    assert.equal(JSON.parse((await t.post("/api/emergency", { mode: "PAUSE_ALL", passphrase: PW })).body).ok, true);
    assert.equal((await t.P("/api/repos/test", { name: "demo", passphrase: PW })).result.reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
  } finally { await t.done(); }
});
test("HTTP: workbench code.review and pref.* ops - owner-only changes, learning only proposes, forget needs the confirm word", async () => {
  const t = await boot();
  try {
    await t.post("/api/owner-key", { passphrase: PW });
    const rv = await t.W("code.review", { files: [{ path: "a.js", content: "eval(x)\nconst k='" + SK + "';" }] }); assert.deepEqual([rv.ok, rv.verdict], [true, "BLOCK"]); assert.ok(!JSON.stringify(rv).includes("ABCDEFGHIJKLMNOPQRSTUV"));
    assert.equal((await t.W("code.review", { files: [] })).reason, "FILES_REQUIRED");
    assert.equal((await t.W("pref.all")).preferences["ui.language"].value, "hu");
    assert.equal((await t.W("pref.set", { key: "ui.language", value: "en" })).ok, true); assert.equal((await t.W("pref.set", { key: "ui.language", value: "xx" })).reason, "VALUE_NOT_ALLOWED"); assert.equal((await t.W("pref.set", { key: "learning.confirmFirst", value: false })).reason, "LEARNING_ALWAYS_REQUIRES_CONFIRMATION");
    assert.equal((await t.W("pref.set", { key: "ui.detailLevel", value: "brief", actor: "SEARCH-1" })).ok, true, "console is the owner; an 'actor' argument is ignored, never trusted");
    for (let i = 0; i < 3; i++) await t.W("pref.choice", { kind: "dismissed", subject: "news" });
    const l = await t.W("pref.learn"); assert.equal(l.proposed.length, 1); assert.deepEqual((await t.W("pref.all")).preferences["suggestions.mutedSources"].value, []);
    const pend = (await t.W("pref.all")).proposals; assert.equal(pend.length, 1); assert.equal((await t.W("pref.confirm", { id: pend[0].id })).ok, true); assert.deepEqual((await t.W("pref.all")).preferences["suggestions.mutedSources"].value, ["news"]);
    assert.ok((await t.W("pref.history")).history.length >= 3); assert.equal((await t.W("pref.export")).ok, true);
    assert.equal((await t.W("pref.forgetAll", {})).reason, "CONFIRM_FORGET_REQUIRED"); assert.equal((await t.W("pref.all")).preferences["ui.language"].value, "en");
    assert.equal((await t.W("pref.forgetAll", { confirm: "FORGET" })).deleted, true); assert.equal((await t.W("pref.all")).preferences["ui.language"].value, "hu");
  } finally { await t.done(); }
});
