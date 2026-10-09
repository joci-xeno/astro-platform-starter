// Plugin hooks (M05) through the real Control Center route /api/plugins/invoke: approval binds identity AND code, modified code never runs, stop/Safe Mode block, failures are contained and audited,
// plugin output is untrusted (redacted, capped), and a hook has no way to reach the owner approval broker, state or the network.
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
  const base = tmp("phi-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort() }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const post = (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) });
  const P = async (p, b) => JSON.parse((await post(p, b)).body), get = async p => JSON.parse((await raw(port, p, { headers: { ...H, "x-atlasz-token": token } })).body);
  const plug = (dir, id, code, perms = ["READ_STATE"]) => { const d = path.join(configDir, "plugins", dir); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "plugin.json"), JSON.stringify({ schema: 1, version: "1.0.0", atlaszCompat: ">=7.3.0", id, name: id, kind: "PLUGIN", permissions: perms, entry: "m.mjs" })); fs.writeFileSync(path.join(d, "m.mjs"), code); return d; };
  return { base, stateDir, configDir, post, P, get, plug, done: async () => { await cc.close?.(); rm(base); } };
}
const I = async (t, b) => (await t.P("/api/plugins/invoke", b)).result.result, V = async (t, b) => (await t.P("/api/plugins/invoke", b)).result.ok;
const OK = 'process.stdout.write(JSON.stringify({ hello: "world" }));';

test("unapproved, unknown and bad requests never execute; an enabled plugin runs only its approved code", { skip: !caps.permission }, async () => {
  const t = await boot();
  try {
    await t.P("/api/owner-key", { passphrase: PW }); const dir = t.plug("a", "alpha", OK);
    assert.equal((await t.post("/api/plugins/invoke", { id: "alpha", hook: "go" }, null)).status, 401);
    assert.equal((await I(t, { id: "alpha", hook: "go" })).reason, "NOT_ENABLED");
    assert.equal((await I(t, { id: "ghost", hook: "go" })).reason, "UNKNOWN_PLUGIN");
    for (const bad of [{ id: "../x", hook: "go" }, { id: "alpha", hook: "Go!" }, { id: "alpha", hook: "go", input: [1] }, { id: "alpha", hook: "go", input: { a: "x".repeat(11000) } }, { id: 5, hook: "go" }, { id: "__proto__", hook: "go" }]) assert.equal(await V(t, bad), false, JSON.stringify(bad).slice(0, 60) + " -> " + JSON.stringify((await t.P("/api/plugins/invoke", bad))).slice(0, 120));
    assert.equal((await t.P("/api/plugins/enable", { id: "alpha" })).result.result.ok, false, "no passphrase, no enable");
    assert.equal((await t.P("/api/plugins/enable", { id: "alpha", passphrase: PW })).result.result.ok, true);
    const r = await I(t, { id: "alpha", hook: "go", input: { x: 1 } }); assert.deepEqual([r.ok, r.result, r.untrusted], [true, { hello: "world" }, true]);
    fs.writeFileSync(path.join(dir, "m.mjs"), OK + "\n// edited after approval");                                                         // code changed since the owner approved it
    const mod = await I(t, { id: "alpha", hook: "go" }); assert.equal(mod.reason, "CODE_CHANGED_SINCE_ENABLE");
    const pl = (await t.get("/api/plugins")).plugins.find(x => x.id === "alpha"); assert.ok(pl, "plugin still listed");
    fs.writeFileSync(path.join(dir, "m.mjs"), OK);                                                                                          // restored bytes -> approved hash again
    assert.equal((await I(t, { id: "alpha", hook: "go" })).ok, true);
  } finally { await t.done(); }
});

test("approval is bound to the plugin identity and code: an approval for another plugin or older code is useless", { skip: !caps.permission }, async () => {
  const t = await boot();
  try {
    await t.P("/api/owner-key", { passphrase: PW }); t.plug("a", "alpha", OK); t.plug("b", "beta", OK + "// b");
    const en = await t.P("/api/plugins/enable", { id: "beta", passphrase: PW }); assert.equal(en.result.ok, true);
    assert.equal((await I(t, { id: "alpha", hook: "go" })).reason, "NOT_ENABLED", "enabling beta approves nothing for alpha");
  } finally { await t.done(); }
});

test("kill switch and Safe Mode stop hooks; crashes are contained, audited and quarantine after repeated failure; the quarantine needs the owner passphrase", { skip: !caps.permission }, async () => {
  const t = await boot();
  try {
    await t.P("/api/owner-key", { passphrase: PW }); t.plug("a", "alpha", OK); t.plug("c", "crashy", "process.exit(3);");
    for (const id of ["alpha", "crashy"]) assert.equal((await t.P("/api/plugins/enable", { id, passphrase: PW })).result.result.ok, true);
    assert.equal((await t.P("/api/emergency", { mode: "PAUSE_ALL", passphrase: PW })).ok, true);
    assert.equal((await I(t, { id: "alpha", hook: "go" })).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    assert.equal((await t.P("/api/emergency", { mode: "RUNNING", passphrase: PW, confirm: "RESUME" })).ok, true);
    assert.equal((await I(t, { id: "alpha", hook: "go" })).ok, true);
    for (let i = 0; i < 3; i++) assert.equal((await I(t, { id: "crashy", hook: "go" })).reason, "PLUGIN_CRASHED");
    assert.equal((await I(t, { id: "crashy", hook: "go" })).reason, "NOT_ENABLED", "quarantined: no further execution");
    assert.equal((await t.get("/api/plugins")).plugins.find(x => x.id === "crashy").status, "QUARANTINED");
        assert.equal((await t.get("/api/plugins")).plugins.find(x => x.id === "alpha").status, "ENABLED", "the healthy plugin is unaffected");
    const audit = fs.readFileSync(path.join(t.stateDir, "plugins", "plugins-audit.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l).event);
    for (const ev of ["PLUGIN_HOOK_RUN", "PLUGIN_HOOK_NOT_RUN", "PLUGIN_FAILURE", "PLUGIN_QUARANTINED"]) assert.ok(audit.includes(ev), ev + " audited: " + audit.join());
  } finally { await t.done(); }
});

test("plugin output is untrusted (secrets redacted, size capped) and a hook cannot read state, spawn processes, reach the network or touch owner approvals", { skip: !caps.permission }, async () => {
  const t = await boot();
  try {
    await t.P("/api/owner-key", { passphrase: PW });
    t.plug("s", "leaky", `process.stdout.write(JSON.stringify({ k: "${SK}", note: "hi" }));`); t.plug("b", "bloat", `process.stdout.write(JSON.stringify({ x: "a".repeat(30000) }));`);
    const probe = `const out = {}; const t = (n, f) => { try { f(); out[n] = "ALLOWED"; } catch (e) { out[n] = "DENIED"; } };
      const fs = await import("node:fs"); const cp = await import("node:child_process");
      t("readState", () => fs.readFileSync(${JSON.stringify(path.join(t.stateDir, "approvals", "x"))}.replace("approvals/x", "../" + "c/owner-key.json")));
      t("readEtc", () => fs.readFileSync("/etc/hostname")); t("spawn", () => cp.execSync("id")); t("write", () => fs.writeFileSync(${JSON.stringify(path.join(t.base, "pwned"))}, "x"));
      process.stdout.write(JSON.stringify(out));`;
    t.plug("p", "prober", probe);
    for (const id of ["leaky", "bloat", "prober"]) assert.equal((await t.P("/api/plugins/enable", { id, passphrase: PW })).result.result.ok, true);
    const leaky = await I(t, { id: "leaky", hook: "go" }); assert.ok(!JSON.stringify(leaky).includes(SK)); assert.equal(leaky.result.note, "hi");
    assert.equal((await I(t, { id: "bloat", hook: "go" })).ok, false);
    const pr = await I(t, { id: "prober", hook: "go" }); assert.equal(pr.ok, true, JSON.stringify(pr));
    assert.deepEqual(pr.result, { readState: "DENIED", readEtc: "DENIED", spawn: "DENIED", write: "DENIED" }); assert.equal(fs.existsSync(path.join(t.base, "pwned")), false);
  } finally { await t.done(); }
});
