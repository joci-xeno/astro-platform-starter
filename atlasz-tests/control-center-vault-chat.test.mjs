// Control Center API Key Vault + Chat Providers panels (23-point items 1, 7, 20): real HTTP, signed owner approvals. Secret values never come back; nothing is connected or LIVE.
process.env.ATLASZ_TEST_MODE = "1";
import { generateVaultKey } from "../atlasz-addons/secret-vault.mjs";
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
const mk = async (withKey = true) => {
  const base = tmp("ccvault-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  if (withKey) process.env.ATLASZ_VAULT_KEY = generateVaultKey(); else delete process.env.ATLASZ_VAULT_KEY;
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort() }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const c = { stateDir, get: async p => raw(port, p, { headers: { ...H, "x-atlasz-token": token } }), post: (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) }), close: async () => { await cc.close?.(); rm(base); delete process.env.ATLASZ_VAULT_KEY; } };
  c.j = async p => JSON.parse((await c.get(p)).body); c.vault = async b => { const r = await c.post("/api/vault/action", b); return { status: r.status, ...JSON.parse(r.body) }; }; c.chat = async b => { const r = await c.post("/api/chat-providers/action", b); return { status: r.status, ...JSON.parse(r.body) }; };
  return c;
};
const SECRET = "sk-test-SYNTHETIC-0123456789abcdefghijklmnop";
test("vault panel: store/rotate/revoke need the owner passphrase and bind to the name; values never come back; audit stays intact", async () => {
  const c = await mk();
  try {
    assert.equal((await c.post("/api/vault/action", { op: "lock" }, null)).status, 401);
    let v = await c.j("/api/vault"); assert.equal(v.state, "CONNECTED"); assert.equal(v.hostKey, "PRESENT"); assert.equal(v.entries.length, 0); assert.ok(v.expected.some(e => e.ref === "VERCEL_AI_GATEWAY_KEY" && !e.stored));
    { const r0 = await c.vault({ op: "set", name: "OPENAI_API_KEY", value: SECRET, passphrase: PW }); assert.ok(r0.status === 400 || r0.result?.ok === false, "no owner key yet"); assert.equal(JSON.stringify(r0).includes(SECRET), false); }
    assert.equal((await c.post("/api/owner-key", { passphrase: PW })).status, 200);
    { const r1 = await c.vault({ op: "set", name: "OPENAI_API_KEY", value: SECRET, passphrase: "wrong passphrase" }); assert.ok(r1.status === 400 || r1.result?.ok === false); assert.equal(JSON.stringify(r1).includes(SECRET), false); assert.equal((await c.j("/api/vault")).entries.length, 0); }
    const r = await c.vault({ op: "set", name: "OPENAI_API_KEY", value: SECRET, passphrase: PW }); assert.equal(r.result.ok, true, JSON.stringify(r)); assert.equal(JSON.stringify(r).includes(SECRET), false);
    const bad = await c.vault({ op: "set", name: "bad name!", value: SECRET, passphrase: PW }); assert.equal(JSON.stringify(bad).includes(SECRET), false);
    v = await c.j("/api/vault"); assert.equal(v.entries.length, 1); assert.equal(v.entries[0].name, "OPENAI_API_KEY"); assert.equal(JSON.stringify(v).includes(SECRET), false); assert.equal(v.expected.find(e => e.ref === "OPENAI_API_KEY").stored, true); assert.equal(v.vault.auditOk, true);
    const rot = await c.vault({ op: "set", name: "OPENAI_API_KEY", value: SECRET + "2", passphrase: PW }); assert.equal(rot.result.rotated, true);
    assert.equal((await c.vault({ op: "revoke", name: "OPENAI_API_KEY", passphrase: PW })).result.revoked, true);
    v = await c.j("/api/vault"); assert.equal(v.entries.length, 0); assert.equal(v.vault.revoked, 1); assert.equal(v.vault.auditOk, true);
    const disk = fs.readdirSync(path.join(c.stateDir, "vault")).map(f => fs.readFileSync(path.join(c.stateDir, "vault", f), "utf8")).join("\n"); assert.equal(disk.includes(SECRET), false, "no plaintext on disk");
    assert.equal((await c.vault({ op: "nope" })).status, 400);
  } finally { await c.close(); }
});
test("vault panel without a host key: LOCKED and says so; nothing can be stored", async () => {
  const c = await mk(false);
  try { const v = await c.j("/api/vault"); assert.equal(v.hostKey, "ABSENT"); assert.equal(v.vault.state, "LOCKED"); assert.match(v.note, /LOCKED/); await c.post("/api/owner-key", { passphrase: PW }); const r = await c.vault({ op: "set", name: "OPENAI_API_KEY", value: SECRET, passphrase: PW }); assert.ok(r.status === 400 || r.result?.ok === false); assert.equal(JSON.stringify(r).includes(SECRET), false); assert.equal((await c.j("/api/vault")).entries.length, 0); }
  finally { await c.close(); }
});
test("chat providers panel: all of the owner's 15 platforms listed; unofficial-only ones UNAVAILABLE; an account is only recorded (CONFIGURED), persisted, never connected or LIVE", async () => {
  const c = await mk();
  try {
    let v = await c.j("/api/chat-providers"); assert.equal(v.state, "CONNECTED"); assert.equal(v.summary.live, 0); assert.equal(v.summary.connected, 0); assert.equal(v.adapters, "NO_ADAPTER_INSTALLED");
    for (const id of ["whatsapp-business", "telegram", "discord", "slack", "signal", "apple-messages", "sms-gateway", "microsoft-teams", "nextcloud-talk", "matrix", "nostr", "tor-messenger", "zalo", "zalo-personal", "wechat"]) assert.ok(v.providers.some(p => p.id === id), id);
    for (const id of ["signal", "tor-messenger", "zalo-personal"]) { const p = v.providers.find(x => x.id === id); assert.equal(p.state, "UNAVAILABLE"); assert.ok(p.unavailableReason.length > 20); }
    assert.equal((await c.chat({ op: "configure", providerId: "signal", accountId: "a1" })).result.ok, false);
    assert.equal((await c.chat({ op: "configure", providerId: "slack", accountId: "ws1", credentialRef: "sk-live-notaname" })).result.ok, false, "a value is not a name");
    assert.equal((await c.chat({ op: "configure", providerId: "nextcloud-talk", accountId: "n1" })).result.ok, false, "host names required");
    const r = await c.chat({ op: "configure", providerId: "slack", accountId: "ws1", credentialRef: "SLACK_BOT_TOKEN" }); assert.equal(r.result.ok, true, JSON.stringify(r)); assert.equal(r.result.state, "CONFIGURED");
    v = await c.j("/api/chat-providers"); const s = v.providers.find(p => p.id === "slack"); assert.equal(s.accounts[0].live, false); assert.equal(s.accounts[0].connected, false); assert.equal(s.accounts[0].credentialStored, false); assert.equal(s.state, "CONFIGURED");
    assert.ok(fs.existsSync(path.join(c.stateDir, "chat-providers", "accounts.json")));
    assert.equal((await c.chat({ op: "unconfigure", providerId: "slack", accountId: "ws1" })).result.ok, true);
    assert.equal((await c.j("/api/chat-providers")).providers.find(p => p.id === "slack").accounts.length, 0);
  } finally { await c.close(); }
});
