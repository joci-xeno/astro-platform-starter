// Control Center security panel (23-point 4/5/18 + expandability): real HTTP, real registry, signed owner approvals. Nothing may show LIVE without gateway evidence.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { tmp, rm } from "./helpers.mjs";
import { generatePublisherKeyPair, keyIdOf } from "../atlasz-addons/release-signing.mjs";
import { createQuarantine } from "../atlasz-addons/quarantine.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";

const PW = "correct horse battery";
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const raw = (port, p, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => { const q = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); }); q.on("error", reject); if (body) q.write(body); q.end(); });
async function boot(extra = {}) {
  const base = tmp("ccmem-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort(), ...extra }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const c = { base, stateDir, token, get: async (p, t = token) => raw(port, p, { headers: { ...H, ...(t ? { "x-atlasz-token": t } : {}) } }), post: (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) }), close: async () => { await cc.close?.(); rm(base); } };
  c.view = async () => JSON.parse((await c.get("/api/security")).body);
  c.act = async (b) => { const r = await c.post("/api/security/action", b); return { status: r.status, ...JSON.parse(r.body) }; };
  c.key = async () => { assert.equal((await c.post("/api/owner-key", { passphrase: PW })).status, 200); };
  return c;
}


test("security panel: token required; held file listed with honest wiring; release and delete need the owner passphrase and are bound to the exact file; destination is fixed", async () => {
  const c = await boot();
  try {
    assert.equal((await c.get("/api/security", null)).status, 401); assert.equal((await c.post("/api/security/action", { op: "verify" }, null)).status, 401);
    const q = createQuarantine({ dir: path.join(c.stateDir, "quarantine") });
    const a = await q.quarantineBuffer(Buffer.from("MZ" + "x".repeat(300)), { name: "invoice.pdf.exe", reason: "test" }), b = await q.quarantineBuffer(Buffer.from("second file bytes"), { name: "other.bin", reason: "test2" });
    assert.equal(a.ok, true); assert.equal(b.ok, true);
    const v = await c.view(); assert.equal(v.state, "CONNECTED"); assert.equal(v.status.held, 2); assert.equal(v.integrity.ok, true);
    assert.equal(v.wiring.find(w => w.name === "Malware scanner").state, "BLOCKED_NO_SCANNER_CHOSEN");
    assert.ok(v.items.every(i => i.status === "QUARANTINED"));
    assert.equal((await c.act({ op: "release", sha256: a.record.sha256, passphrase: PW })).status, 400, "no owner key yet -> refused");
    await c.key();
    assert.equal((await c.act({ op: "release", sha256: a.record.sha256, passphrase: "wrong passphrase" })).status, 400);
    assert.equal((await c.act({ op: "release", sha256: "z".repeat(64), passphrase: PW })).result.reason, "SHA256_INVALID");
    const r = await c.act({ op: "release", sha256: a.record.sha256, passphrase: PW }); assert.equal(r.result.ok, true, JSON.stringify(r));
    const out = fs.readdirSync(path.join(c.stateDir, "quarantine-released")); assert.equal(out.length, 1); assert.ok(out[0].startsWith(a.record.sha256.slice(0, 12)));
    assert.equal((await c.act({ op: "release", sha256: a.record.sha256, passphrase: PW })).result.reason, "NOT_IN_QUARANTINE", "a released file cannot be released twice");
    assert.equal((await c.act({ op: "delete", sha256: b.record.sha256, passphrase: PW })).result.ok, true);
    const v2 = await c.view(); assert.equal(v2.status.held, 0); assert.equal(v2.integrity.ok, true);
    assert.equal((await c.act({ op: "nope" })).status, 400);
  } finally { await c.close(); }
});

test("trust anchors: adding or removing a publisher key needs the owner passphrase and is bound to the exact key and components", async () => {
  const c = await boot();
  try {
    const pk = generatePublisherKeyPair(); await c.key();
    assert.equal((await c.act({ op: "anchorAdd", publicKeyB64: pk.publicKeyB64, components: "ext", passphrase: "wrong passphrase" })).status, 400);
    assert.equal((await c.view()).trustAnchors.list.length, 0);
    const r = await c.act({ op: "anchorAdd", publicKeyB64: pk.publicKeyB64, components: "ext, other", passphrase: PW }); assert.equal(r.result.ok, true, JSON.stringify(r)); assert.equal(r.result.keyId, keyIdOf(pk.publicKeyB64));
    const v = await c.view(); assert.deepEqual(v.trustAnchors.list.map(a => a.components), [["ext", "other"]]); assert.equal(v.wiring.find(w => w.name === "Update signature verification").state, "CONNECTED_TO_STAGING");
    assert.equal((await c.act({ op: "anchorAdd", publicKeyB64: "bm90IGEga2V5", components: "ext", passphrase: PW })).status, 400, "not an Ed25519 key");
    assert.equal((await c.act({ op: "anchorRemove", keyId: keyIdOf(pk.publicKeyB64), passphrase: PW })).result.removed, true);
    assert.equal((await c.view()).trustAnchors.list.length, 0);
  } finally { await c.close(); }
});
