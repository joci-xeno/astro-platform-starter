// P04 prototype builder hosted by the real Control Center over HTTP.
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
  const base = tmp("protoh-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort() }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const post = (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) });
  const get = (p, t = token) => raw(port, p, { headers: { ...H, ...(t ? { "x-atlasz-token": t } : {}) } });
  const J = r => JSON.parse(r.body), P = async (p, b) => J(await post(p, b)).result, W = async (op, args = {}) => { const r = J(await post("/api/workbench/action", { op, args })); return r.result ?? (r.error !== undefined ? { ok: false, reason: String(r.error) } : r); };
  return { base, configDir, cc, post, get, J, P, W, done: async () => { await cc.close?.(); rm(base); } };
}
test("HTTP: prototypes - preview writes nothing, generate is owner-only via the console, tests need the signed approval, stopped/safe-mode refuses, status follows edits", { skip: !(caps.permission && caps.namespace) && "restricted launcher not available" }, async () => {
  const t = await boot();
  try {
    const A = (op, args) => t.post("/api/prototypes/action", { op, args }).then(r => t.J(r));
    assert.equal((await t.post("/api/prototypes/action", { op: "preview", args: {} }, null)).status, 401); assert.equal((await t.get("/api/prototypes", null)).status, 401);
    await t.post("/api/owner-key", { passphrase: PW });
    const v = t.J(await t.get("/api/prototypes")); assert.equal(v.state, "CONNECTED"); assert.equal(v.templates.length, 4); assert.deepEqual(v.prototypes, []);
    const spec = { template: "http-handler", name: "hello-api", idea: "demo " + SK, params: { routes: [{ path: "/", body: "hi" }] } };
    const pv = await A("preview", spec); assert.equal(pv.result.result.ok, true); assert.deepEqual(t.J(await t.get("/api/prototypes")).prototypes, [], "preview wrote nothing");
    assert.equal((await A("nope", {})).ok, false); assert.match((await A("nope", {})).error, /PROTOTYPE_OP_UNKNOWN/); assert.match((await A("__proto__", {})).error, /PROTOTYPE_OP_UNKNOWN/); assert.match((await A("constructor", {})).error, /PROTOTYPE_OP_UNKNOWN/);
    const g = await A("generate", { ...spec, actor: "SEARCH-1" }); assert.equal(g.result.result.ok, true, JSON.stringify(g)); assert.equal(g.result.result.status, "GENERATED_UNTESTED");
    assert.equal(JSON.stringify(t.J(await t.get("/api/prototypes"))).includes(SK), false);
    assert.equal((await A("generate", spec)).result.result.reason, "PROTOTYPE_EXISTS");
    assert.equal((await A("previewPage", { name: "hello-api" })).result.result.reason, "PREVIEW_ONLY_FOR_STATIC_PAGES");
    await A("generate", { template: "static-page", name: "landing", params: { title: "T", heading: "H", text: "Hello" } }); const pp = (await A("previewPage", { name: "landing" })).result.result; assert.equal(pp.ok, true); assert.equal(pp.sandbox, ""); assert.match(pp.srcdoc, /<h1>H<\/h1>/);
    const noPass = await A("test", { name: "hello-api" }); assert.match(noPass.result.result.reason, /^OWNER_APPROVAL_REQUIRED/); assert.equal((await A("status", { name: "hello-api" })).result.result.status, "GENERATED_UNTESTED");
    const bad = await A("test", { name: "hello-api", passphrase: "wrong wrong wrong" }); assert.equal(bad.ok === false || /OWNER_APPROVAL_REQUIRED|PASSPHRASE|DECRYPT|AUTH/i.test(JSON.stringify(bad)), true, JSON.stringify(bad).slice(0, 200));
    assert.equal((await A("status", { name: "hello-api" })).result.result.status, "GENERATED_UNTESTED", "a wrong passphrase ran nothing");
    assert.match((await A("test", { name: "../x", passphrase: PW })).result.result.reason, /REPO_NAME_INVALID/);
    const ok = await A("test", { name: "hello-api", passphrase: PW }); const r = ok.result.result; assert.equal(r.ok, true, JSON.stringify(ok).slice(0, 600)); assert.equal(r.failed, 0); assert.equal(r.status, "TESTS_PASSED_IN_SANDBOX");
    const list = t.J(await t.get("/api/prototypes")); assert.deepEqual(list.prototypes, [{ name: "hello-api", template: "http-handler", status: "TESTS_PASSED_IN_SANDBOX" }, { name: "landing", template: "static-page", status: "GENERATED_UNTESTED" }]);
    fs.appendFileSync(path.join(t.configDir, "repos", "hello-api", "src", "index.mjs"), "// changed\n"); assert.equal((await A("status", { name: "hello-api" })).result.result.status, "MODIFIED_AFTER_TEST");
    assert.equal(t.J(await t.post("/api/emergency", { mode: "PAUSE_ALL", passphrase: PW })).ok, true);
    assert.equal((await A("test", { name: "hello-api", passphrase: PW })).result.result.reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE", "the kill switch stops prototype test runs");
  } finally { await t.done(); }
});
