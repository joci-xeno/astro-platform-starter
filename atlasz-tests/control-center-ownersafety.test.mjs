import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
import net from "node:net";
import http from "node:http";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const raw = (port, p, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => { const q = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); }); q.on("error", reject); if (body) q.write(body); q.end(); });
const PW = "correct horse battery";
const mk = () => { const base = tmp("ccos-"); return { base, core: createControlCenterCore({ stateDir: path.join(base, "s"), configDir: path.join(base, "c"), port: 1 }) }; };

test("Owner Safety panel: every required area is present with REAL status; nothing unknown is shown as healthy", async () => {
  const { base, core } = mk();
  try {
    const o = await core.ownerSafety();
    for (const k of ["ownerAuthority", "killSwitch", "approvals", "securityBrain", "financialFirewall", "blackBox", "safeMode", "currentVersion", "lastKnownGood", "latestBackup", "restoreReadiness", "recoveryStatus", "systemHealth", "controls"]) assert.ok(k in o, k);
    for (const c of ["EMERGENCY_STOP", "PAUSE_EXTERNAL_ACTIONS", "RESUME", "RUN_SYSTEM_DOCTOR", "CREATE_SAFE_RESTORE_POINT", "VERIFY_BACKUP", "ROLL_BACK_TO_LKG", "RESTORE", "VIEW_INCIDENTS", "VIEW_SECURITY_EVENTS", "VIEW_APPROVALS"]) assert.ok(o.controls.includes(c), c);
    assert.equal(o.ownerAuthority.provisioned, false); assert.equal(o.ownerAuthority.ownerId, "JOCI");
    assert.equal(o.killSwitch.mode, "RUNNING"); assert.equal(o.restoreReadiness, "NOT_CONFIGURED"); assert.equal(o.lastKnownGood, null);
    assert.match(String(o.currentVersion), /UNKNOWN/); assert.match(String(o.securityBrain), /UNKNOWN/);
    assert.equal(o.systemHealth.normalOperation, false); assert.notEqual(o.systemHealth.overall, "HEALTHY");
    const d = await core.doctorV2();
    for (const c of ["runtime", "agent_topology_30", "queue", "database", "brain_components", "models", "tools", "connectors", "secret_vault", "owner_authentication", "kill_switch", "approval_gateway", "security_brain", "financial_firewall", "black_box", "backup", "last_known_good", "recovery_readiness", "update_center"]) assert.ok(d.components[c], c);
    assert.equal(d.components.runtime.state, "UNKNOWN"); assert.equal(d.components.owner_authentication.state, "NOT_CONFIGURED"); assert.equal(d.components.backup.state, "NOT_CONFIGURED");
    assert.ok(Object.values(d.components).every(c => ["HEALTHY", "DEGRADED", "BLOCKED", "FAILED", "NOT_CONFIGURED", "UNKNOWN"].includes(c.state)));
  } finally { rm(base); }
});

test("Owner Safety controls: emergency stop / pause / resume need Joci's key; backup + drill verification are real; corrupt backup => NOT_READY, never HEALTHY", async () => {
  const { base, core } = mk();
  try {
    await assert.rejects(() => core.ownerSafetyAction({ action: "EMERGENCY_STOP", passphrase: PW }));            // no owner key yet => cannot stop with a fake approval
    core.provisionOwnerKey({ passphrase: PW });
    await assert.rejects(() => core.ownerSafetyAction({ action: "EMERGENCY_STOP", passphrase: "wrong passphrase!!" }));
    let o = await core.ownerSafetyAction({ action: "EMERGENCY_STOP", passphrase: PW }); assert.equal(o.mode, "PAUSE_ALL");
    assert.equal((await core.ownerSafety()).killSwitch.banner, "EMERGENCY STOP ACTIVE");
    assert.equal((await core.doctorV2()).components.kill_switch.state, "BLOCKED");
    await assert.rejects(() => core.ownerSafetyAction({ action: "RESUME", passphrase: PW }));                       // needs explicit RESUME confirmation
    o = await core.ownerSafetyAction({ action: "RESUME", passphrase: PW, confirm: "RESUME" }); assert.equal(o.mode, "RUNNING");
    o = await core.ownerSafetyAction({ action: "PAUSE_EXTERNAL_ACTIONS", passphrase: PW }); assert.equal(o.mode, "STOP_EXTERNAL_ACTIONS");
    await core.ownerSafetyAction({ action: "RESUME", passphrase: PW, confirm: "RESUME" });
    const bk = await core.ownerSafetyAction({ action: "CREATE_SAFE_RESTORE_POINT" }); assert.ok(bk.id);
    assert.equal((await core.ownerSafety()).restoreReadiness, "UNKNOWN");                                           // backup exists, no passing drill + no LKG yet
    const v = await core.ownerSafetyAction({ action: "VERIFY_BACKUP" }); assert.equal(v.drill.passed, true);
    assert.equal((await core.ownerSafety()).latestBackup.ok, true);
    assert.ok(Array.isArray((await core.ownerSafetyAction({ action: "VIEW_APPROVALS" })).gateway));
    const bdir = path.join(base, "c", "backups", bk.id, "data"); const victim = fs.readdirSync(bdir, { recursive: true }).find(f => fs.statSync(path.join(bdir, f)).isFile());
    fs.appendFileSync(path.join(bdir, victim), "TAMPER");                                                          // corrupt the backup
    const bad = await core.ownerSafety(); assert.equal(bad.restoreReadiness, "NOT_READY");
    const dd = await core.doctorV2(); assert.equal(dd.components.backup.state, "FAILED"); assert.equal(dd.components.recovery_readiness.state, "FAILED"); assert.equal(dd.overall, "FAILED");
    await assert.rejects(() => core.ownerSafetyAction({ action: "FORMAT_DISK" }), /UNKNOWN_OWNER_SAFETY_ACTION/);
  } finally { rm(base); }
});

test("Owner Safety over HTTP: token-protected, cross-origin refused, unsigned stop does nothing", async () => {
  const base = tmp("ccos-"), cc = createControlCenterServer({ stateDir: path.join(base, "s"), configDir: path.join(base, "c"), port: await freePort() });
  const { port, token } = await cc.listen();
  try {
    const H = { host: "127.0.0.1:" + port };
    assert.equal((await raw(port, "/api/owner-safety", { headers: H })).status, 401);
    const g = await raw(port, "/api/owner-safety", { headers: { ...H, "x-atlasz-token": token } }); assert.equal(g.status, 200); assert.ok(JSON.parse(g.body).controls.includes("EMERGENCY_STOP"));
    const post = (b, hdr = {}) => raw(port, "/api/owner-safety/action", { method: "POST", headers: { ...H, "x-atlasz-token": token, "content-type": "application/json", ...hdr }, body: JSON.stringify(b) });
    assert.equal((await post({ action: "EMERGENCY_STOP", passphrase: PW }, { origin: "http://evil.example" })).status, 403);
    assert.ok((await post({ action: "EMERGENCY_STOP", passphrase: PW })).status >= 400);                       // no owner key => refused, nothing changes
    assert.equal(JSON.parse((await raw(port, "/api/owner-safety", { headers: { ...H, "x-atlasz-token": token } })).body).killSwitch.mode, "RUNNING");
  } finally { await cc.close?.(); rm(base); }
});
