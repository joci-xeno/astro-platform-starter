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
async function boot() {
  const base = tmp("ccm1-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort() }); const { port, token } = await cc.listen();
  const H = { host: "127.0.0.1:" + port };
  return { base, stateDir, port, token, get: (p, t = token) => raw(port, p, { headers: { ...H, ...(t ? { "x-atlasz-token": t } : {}) } }), post: (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) }), close: async () => { await cc.close?.(); rm(base); } };
}
// ATLASZ-T3-007: these routes had no handler-level tests.
test("GET /api/opportunities: needs the token; empty state => count 0; descriptions/assessment details are never exposed", async () => {
  const c = await boot();
  try {
    assert.equal((await c.get("/api/opportunities", null)).status, 401); assert.equal((await c.get("/api/opportunities", "x".repeat(c.token.length))).status, 401);
    const empty = await c.get("/api/opportunities"); assert.equal(empty.status, 200); assert.deepEqual(JSON.parse(empty.body), { count: 0, items: [] });
    fs.writeFileSync(path.join(c.stateDir, "atlasz-state.json"), JSON.stringify({ leads: [{ id: "L1", title: "T", description: "PRIVATE-DESC", assessment: { score: 8, checks: ["PRIVATE-CHECK"] } }] }));
    const r = await c.get("/api/opportunities"); assert.equal(r.status, 200);
    const j = JSON.parse(r.body); assert.equal(j.count, 1); assert.equal(j.items[0].score, 8); assert.ok(!/PRIVATE/.test(r.body));
  } finally { await c.close(); }
});
test("GET /api/money-recurring: needs the token and returns 200 with a body that reports no unverified money as real", async () => {
  const c = await boot();
  try {
    assert.equal((await c.get("/api/money-recurring", null)).status, 401);
    const r = await c.get("/api/money-recurring"); assert.equal(r.status, 200); JSON.parse(r.body);
    assert.ok(!/"verified"\s*:\s*true/i.test(r.body), "a fresh install must not show verified revenue");
  } finally { await c.close(); }
});
test("POST /api/backup: token + JSON required; creates a real backup with a manifest hash; GET /api/backups lists it", async () => {
  const c = await boot();
  try {
    fs.writeFileSync(path.join(c.stateDir, "marker.json"), "{}");
    assert.equal((await c.post("/api/backup", { label: "t" }, null)).status, 401);
    assert.equal((await raw(c.port, "/api/backup", { method: "POST", headers: { host: "127.0.0.1:" + c.port, "x-atlasz-token": c.token, "content-type": "text/plain" }, body: "x" })).status, 415);
    const r = await c.post("/api/backup", { label: "t" }); assert.equal(r.status, 200, r.body);
    const res = JSON.parse(r.body).result; assert.ok(res.id); assert.ok(res.files >= 1); assert.match(res.manifestHash, /^[0-9a-f]{16,}$/);
    const l = await c.get("/api/backups"); assert.equal(l.status, 200); assert.ok(l.body.includes(res.id));
  } finally { await c.close(); }
});
test("POST /api/updates/auto: token required; enabling automatic updates WITHOUT a valid owner passphrase/approval is refused and changes nothing (no owner key provisioned => OWNER_KEY_NOT_PROVISIONED)", async () => {
  const c = await boot();
  try {
    assert.equal((await c.post("/api/updates/auto", { enabled: true, passphrase: "x" }, null)).status, 401);
    const r = await c.post("/api/updates/auto", { enabled: true, passphrase: "wrong passphrase" });
    assert.ok(r.status >= 400 || JSON.parse(r.body).result?.ok === false, "must not succeed: " + r.body);
    assert.equal(JSON.parse(r.body).result.ok, false); assert.equal(JSON.parse(r.body).result.error, "OWNER_KEY_NOT_PROVISIONED");
    const st = await c.get("/api/updates"); assert.equal(st.status, 200); assert.ok(!/"auto(Update)?(Enabled)?"\s*:\s*true/.test(st.body), st.body.slice(0, 300));
  } finally { await c.close(); }
});
test("ATLASZ-T3-006: restore is reachable from the Owner Safety action (UI path) AND the direct route, and both refuse without a valid owner signature, leaving state untouched", async () => {
  const c = await boot();
  try {
    const f = path.join(c.stateDir, "important.json"); fs.writeFileSync(f, '{"v":1}');
    const b = JSON.parse((await c.post("/api/backup", { label: "pre" })).body).result;
    fs.writeFileSync(f, '{"v":2}');
    for (const [p, body] of [["/api/owner-safety/action", { action: "RESTORE", id: b.id, passphrase: "wrong passphrase" }], ["/api/restore/backup", { id: b.id, passphrase: "wrong passphrase" }]]) {
      const r = await c.post(p, body); const j = JSON.parse(r.body);
      assert.ok(r.status >= 400 || j.result?.ok === false || j.result?.restored === false, p + " must not restore: " + r.body.slice(0, 200));
      assert.equal(fs.readFileSync(f, "utf8"), '{"v":2}', p + " changed state without approval");
    }
    assert.equal((await c.post("/api/restore/backup", { id: b.id }, null)).status, 401);
  } finally { await c.close(); }
});
