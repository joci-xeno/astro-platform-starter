// Control Center model registry panel (23-point 4/5/18 + expandability): real HTTP, real registry, signed owner approvals. Nothing may show LIVE without gateway evidence.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";

const PW = "correct horse battery";
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const raw = (port, p, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => { const q = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); }); q.on("error", reject); if (body) q.write(body); q.end(); });
async function boot(extra = {}) {
  const base = tmp("ccmem-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort(), ...extra }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const c = { base, stateDir, token, get: async (p, t = token) => raw(port, p, { headers: { ...H, ...(t ? { "x-atlasz-token": t } : {}) } }), post: (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) }), close: async () => { await cc.close?.(); rm(base); } };
  c.view = async () => JSON.parse((await c.get("/api/model-registry")).body);
  c.act = async (b) => { const r = await c.post("/api/model-registry/action", b); return { status: r.status, ...JSON.parse(r.body) }; };
  c.key = async () => { assert.equal((await c.post("/api/owner-key", { passphrase: PW })).status, 200); };
  return c;
}

test("model registry panel: token required; starts empty and honest; seed adds data-only providers; local free model enables without signature, cloud/paid needs the owner passphrase; nothing is LIVE", async () => {
  const c = await boot();
  try {
    assert.equal((await c.get("/api/model-registry", null)).status, 401); assert.equal((await c.post("/api/model-registry/action", { op: "seed" }, null)).status, 401);
    let v = await c.view(); assert.equal(v.state, "CONNECTED"); assert.equal(v.status.models, 0); assert.equal(v.status.live, 0); assert.equal(v.agents.length, 30);
    assert.equal((await c.act({ op: "seed" })).result.ok, true); v = await c.view(); assert.ok(v.providers.length >= 6); assert.ok(v.providers.every(p => p.credentialConfigured === false || p.credentialConfigured === null));
    assert.equal((await c.act({ op: "addModel", model: { id: "llama-local", providerId: "ollama-local", version: "1.0.0", costClass: "FREE", capabilities: ["text"] } })).result.ok, true);
    assert.equal((await c.act({ op: "addModel", model: { id: "gpt-x", providerId: "openai", version: "1.0.0", costClass: "PAID", costPer1kTokensUsd: 0.01, capabilities: ["text"] } })).result.ok, true);
    assert.equal((await c.act({ op: "enable", id: "llama-local" })).result.ok, true);
    assert.equal((await c.act({ op: "enable", id: "gpt-x" })).status, 400, "cloud/paid enable without a passphrase is refused");
    await c.key(); assert.equal((await c.act({ op: "enable", id: "gpt-x", passphrase: "wrong passphrase" })).status, 400);
    const ok = await c.act({ op: "enable", id: "gpt-x", passphrase: PW }); assert.equal(ok.result.ok, true);
    v = await c.view(); assert.equal(v.status.enabled, 2); assert.equal(v.status.live, 0); assert.ok(v.models.every(m => m.live === false && m.status !== "LIVE"));
    assert.equal(v.models.find(m => m.id === "gpt-x").status, "NO_CREDENTIAL");
    assert.equal((await c.act({ op: "setAssignment", agentId: "EXECUTION-26", primary: "gpt-x" })).result.reason, "NOT_ONE_OF_THE_30_PERMANENT_AGENTS");
    assert.equal((await c.act({ op: "setAssignment", agentId: "EXECUTION-3", primary: "gpt-x" })).result.ok, true);
    const rs = (await c.act({ op: "resolve", agentId: "EXECUTION-3", maxCostUsd: 1 })).result; assert.deepEqual(rs.candidates, []); assert.ok(rs.skipped.length >= 1);
    const snap = v.snapshots[0]; assert.equal((await c.act({ op: "rollback", revision: snap.revision, passphrase: PW })).result.ok, true);
    v = await c.view(); assert.equal(v.models.find(m => m.id === "gpt-x")?.enabled ?? false, false, "a rollback never resurrects a spend approval");
    assert.equal((await c.act({ op: "nope" })).status, 400);
  } finally { await c.close(); }
});

test("connected chain over real HTTP: egress approval -> probe -> LIVE -> an agent question is answered by the loopback adapter; nothing leaves 127.0.0.1", async () => {
  const urls = []; const ollamaFetch = async (u, init) => { urls.push(u); return u.endsWith("/api/version") ? { ok: true, text: async () => '{"version":"0.5.1"}' } : { ok: true, text: async () => '{"message":{"content":"Szia from the local model"},"eval_count":5}' }; };
  const c = await boot({ ollamaFetch });
  try {
    await c.key(); await c.act({ op: "seed" });
    assert.equal((await c.act({ op: "addModel", model: { id: "llama-local", providerId: "ollama-local", version: "1.0.0", costClass: "FREE", capabilities: ["text"] } })).result.ok, true);
    assert.equal((await c.act({ op: "enable", id: "llama-local" })).result.ok, true);
    let a = await c.act({ op: "ask", agentId: "EXECUTION-3", prompt: "hello" }); assert.equal(a.result.reason, "NO_ELIGIBLE_MODEL", "no policy, no probe -> nothing is called"); assert.equal(urls.length, 0);
    assert.equal((await c.act({ op: "probe" })).result.results["llama-local"], "FAIL", "without an owner-approved egress policy even the probe is blocked");
    let v = await c.view(); assert.equal(v.egressProposals.find(p => p.providerId === "ollama-local").action, "EGRESS_POLICY_SET");
    assert.equal((await c.act({ op: "egressApply", providerId: "ollama-local", passphrase: "wrong passphrase" })).status, 400);
    assert.equal((await c.act({ op: "egressApply", providerId: "ollama-local", passphrase: PW })).result.ok, true);
    assert.equal((await c.act({ op: "probe" })).result.results["llama-local"], "PASS");
    v = await c.view(); assert.equal(v.status.live, 1); assert.equal(v.models.find(m => m.id === "llama-local").status, "LIVE");
    a = await c.act({ op: "ask", agentId: "EXECUTION-3", prompt: "hello" }); assert.equal(a.result.ok, true); assert.equal(a.result.output, "Szia from the local model"); assert.equal(a.result.untrusted, true);
    assert.ok(urls.every(u => u.startsWith("http://127.0.0.1:11434/")), urls.join());
    assert.equal((await c.act({ op: "disable", id: "llama-local" })).result.ok, true);
    assert.equal((await c.act({ op: "ask", agentId: "EXECUTION-3", prompt: "again" })).result.reason, "NO_ELIGIBLE_MODEL");
  } finally { await c.close?.(); rm(c.base); }
});
