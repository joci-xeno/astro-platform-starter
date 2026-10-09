import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
import { createOwnerKeystore, signWithKeystore, keystoreStatus } from "../atlasz-addons/owner-keystore.mjs";
import { createSafeMode } from "../atlasz-addons/safe-mode.mjs";

const PW = "correct horse battery";
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
function rig(extra = {}) {
  const base = tmp("cc-"), stateDir = path.join(base, "state"), configDir = path.join(base, "config");
  const core = createControlCenterCore({ stateDir, configDir, ...extra });
  return { base, stateDir, configDir, core, done: () => rm(base) };
}
const raw = (port, p, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d, headers: res.headers })); });
  r.on("error", reject); if (body) r.write(body); r.end();
});

test("keystore: private key is passphrase-encrypted on disk; wrong/short passphrase refused; no overwrite", () => {
  const d = tmp();
  try {
    assert.throws(() => createOwnerKeystore(d, "short"), /PASSPHRASE_TOO_SHORT/);
    const { publicKeyB64 } = createOwnerKeystore(d, PW);
    assert.equal(keystoreStatus(d).provisioned, true); assert.equal(keystoreStatus(d).publicKeyB64, publicKeyB64);
    const pem = fs.readFileSync(path.join(d, "owner-private-key.enc.pem"), "utf8");
    assert.match(pem, /BEGIN ENCRYPTED PRIVATE KEY/); assert.doesNotMatch(pem, /BEGIN PRIVATE KEY/);
    assert.throws(() => signWithKeystore(d, "wrong passphrase!", { action: "X" }), /WRONG_PASSPHRASE/);
    assert.equal(signWithKeystore(d, PW, { action: "emergency-stop", subject: "PAUSE_ALL" }).action, "EMERGENCY_STOP");
    assert.throws(() => createOwnerKeystore(d, PW), /REFUSING_TO_OVERWRITE/);
  } finally { rm(d); }
});

test("owner controls: no key => denied; with key => PAUSE needs passphrase; RESUME also needs typed confirmation", () => {
  const r = rig();
  try {
    assert.throws(() => r.core.setEmergency({ mode: "PAUSE_ALL", passphrase: PW }), /OWNER_KEY_NOT_PROVISIONED/);
    r.core.provisionOwnerKey({ passphrase: PW });
    assert.throws(() => r.core.setEmergency({ mode: "PAUSE_ALL", passphrase: "not the passphrase" }), /WRONG_PASSPHRASE/);
    assert.equal(r.core.setEmergency({ mode: "PAUSE_ALL", passphrase: PW }).mode, "PAUSE_ALL");
    assert.throws(() => r.core.setEmergency({ mode: "RUNNING", passphrase: PW }), /EXPLICIT_RESUME_CONFIRMATION_REQUIRED/);
    assert.equal(r.core.setEmergency({ mode: "RUNNING", passphrase: PW, confirm: "RESUME" }).mode, "RUNNING");
  } finally { r.done(); }
});

test("safe mode exit from the Control Center needs passphrase and a non-failing self-check", () => {
  const r = rig();
  try {
    r.core.provisionOwnerKey({ passphrase: PW });
    createSafeMode({ statePath: path.join(r.stateDir, "safe-mode.json"), auditPath: path.join(r.stateDir, "safe-mode-audit.jsonl") }).enter("TEST");
    assert.throws(() => r.core.exitSafeMode({ passphrase: "bad bad bad bad" }), /WRONG_PASSPHRASE/);
    fs.writeFileSync(path.join(r.stateDir, "atlasz-state.json"), "garbage");            // self-check FAIL
    assert.throws(() => r.core.exitSafeMode({ passphrase: PW }), /SELF_CHECK_NOT_PASSING/);
    fs.rmSync(path.join(r.stateDir, "atlasz-state.json"));
    assert.equal(r.core.exitSafeMode({ passphrase: PW }).safeMode.mode, "NORMAL");
  } finally { r.done(); }
});

test("backup / drill / LKG / restore through the Control Center", () => {
  const r = rig();
  try {
    r.core.provisionOwnerKey({ passphrase: PW });
    fs.writeFileSync(path.join(r.stateDir, "atlasz-state.json"), JSON.stringify({ leads: [], candidates: [], v: 1 }));
    assert.throws(() => r.core.markLastKnownGood({}), /LKG_EVIDENCE_REQUIRED/);
    assert.equal(r.core.drill().passed, true);
    const lkg = r.core.markLastKnownGood({ smokeEvidence: "npm test run 1" });
    assert.ok(lkg.backupId);
    fs.writeFileSync(path.join(r.stateDir, "atlasz-state.json"), JSON.stringify({ leads: [], candidates: [], v: 2 }));
    assert.throws(() => r.core.restoreLastKnownGood({ passphrase: "nope nope nope" }), /WRONG_PASSPHRASE/);
    r.core.restoreLastKnownGood({ passphrase: PW });
    assert.equal(JSON.parse(fs.readFileSync(path.join(r.stateDir, "atlasz-state.json"), "utf8")).v, 1);
    assert.ok(r.core.backups().items.every(b => b.ok));
    assert.throws(() => r.core.restoreFromBackup({ id: "../../etc", passphrase: PW }), /INVALID_BACKUP_ID/);
  } finally { r.done(); }
});

test("doctor reports honest findings and detects a tampered audit chain", async () => {
  const r = rig();
  try {
    const d1 = await r.core.doctor();
    assert.ok(["DEGRADED", "FAIL"].includes(d1.level));
    assert.ok(d1.findings.some(f => f.id === "owner-auth")); assert.ok(d1.findings.some(f => f.id === "backup"));
    r.core.provisionOwnerKey({ passphrase: PW });
    r.core.setEmergency({ mode: "PAUSE_ALL", passphrase: PW });
    const f = path.join(r.stateDir, "emergency-audit.jsonl");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("PAUSE_ALL", "RUNNING"));
    const d2 = await r.core.doctor();
    assert.equal(d2.level, "FAIL");
    assert.ok(d2.findings.some(x => x.id.startsWith("audit:emergency")));
  } finally { r.done(); }
});

test("update center in the GUI core fails closed without adapters and says so", async () => {
  const r = rig({ localUpdates: false });
  try {
    const u = r.core.updates();
    assert.match(u.notice, /BLOCKED/); assert.equal(u.adapters.detector, false);
    assert.ok(u.buttons.includes("Check for Updates"));
    const c = await r.core.updateActions.check();
    assert.equal(c.result.ok, false); assert.equal(c.result.reason, "DETECTOR_NOT_CONFIGURED"); assert.deepEqual(c.result.found, []);
  } finally { r.done(); }
});

test("HTTP: token, Host allow-list, Origin, content-type, traversal, secrets never echoed", async () => {
  const r = rig(); const cc = createControlCenterServer({ stateDir: r.stateDir, configDir: r.configDir, port: await freePort() });
  const { port, token } = await cc.listen();
  try {
    const H = { host: "127.0.0.1:" + port };
    assert.equal((await raw(port, "/api/status", { headers: H })).status, 401);
    assert.equal((await raw(port, "/api/status", { headers: { ...H, "x-atlasz-token": "x".repeat(token.length) } })).status, 401);
    assert.equal((await raw(port, "/api/status", { headers: { host: "evil.example:" + port, "x-atlasz-token": token } })).status, 403);
    const ok = await raw(port, "/api/status", { headers: { ...H, "x-atlasz-token": token } });
    assert.equal(ok.status, 200); assert.equal(JSON.parse(ok.body).runtime.status, "NOT_RUNNING");
    const post = (p, body, h = {}) => raw(port, p, { method: "POST", headers: { ...H, "x-atlasz-token": token, "content-type": "application/json", ...h }, body: JSON.stringify(body) });
    assert.equal((await post("/api/owner-key", { passphrase: PW }, { origin: "http://evil.example" })).status, 403);
    assert.equal((await raw(port, "/api/owner-key", { method: "POST", headers: { ...H, "x-atlasz-token": token, "content-type": "text/plain" }, body: "x" })).status, 415);
    { const J = { ...H, "x-atlasz-token": token, "content-type": "application/json" };
      const big = await raw(port, "/api/owner-key", { method: "POST", headers: J, body: JSON.stringify({ passphrase: "x".repeat(70000) }) }); assert.equal(big.status, 413, "an oversize body gets a 413, not a reset");
      const nul = await raw(port, "/api/owner-key", { method: "POST", headers: J, body: "null" }); assert.equal(nul.status, 400); assert.ok(!/destructure|intermediate value/.test(nul.body), "no internal message: " + nul.body);
      assert.equal((await raw(port, "/api/owner-key", { method: "POST", headers: J, body: "[1]" })).status, 400); }
    assert.equal((await post("/api/owner-key", { passphrase: PW })).status, 200);
    assert.equal((await post("/api/emergency", { mode: "PAUSE_ALL", passphrase: PW })).status, 200);
    const bad = await post("/api/emergency", { mode: "RUNNING", passphrase: "wrong wrong wrong" });
    assert.equal(bad.status, 400); assert.equal(bad.body.includes("wrong wrong wrong"), false);
    assert.equal(JSON.parse((await raw(port, "/api/status", { headers: { ...H, "x-atlasz-token": token } })).body).emergency.mode, "PAUSE_ALL");
    const page = await raw(port, "/", { headers: H });
    assert.equal(page.status, 200); assert.match(page.body, /ATLASZ Control Center/); assert.match(page.headers["content-security-policy"], /default-src 'self'/);
    assert.equal(page.body.includes(token), false);
    assert.equal((await raw(port, "/..%2fcore.mjs", { headers: H })).status, 404);
    assert.equal((await raw(port, "/../core.mjs", { headers: H })).status, 404);
    const sec = fs.readFileSync(path.join(r.configDir, "owner-private-key.enc.pem"), "utf8");
    assert.equal(ok.body.includes(sec.slice(40, 80)), false);
  } finally { await cc.close(); r.done(); }
});

test("REAL PROCESS: Start ATLASZ from the Control Center boots start:canonical, owner PAUSE ALL halts it, Stop exits cleanly", async () => {
  const port = await freePort(), r = rig({ port });
  try {
    r.core.provisionOwnerKey({ passphrase: PW });
    const started = r.core.startRuntime();
    assert.equal(started.started, true); assert.match(started.topology, /5 SEARCH \+ 25 EXECUTION/);
    assert.equal(r.core.startRuntime().reason, "ALREADY_RUNNING");
    let s; for (let i = 0; i < 60; i++) { s = await r.core.status(); if (s.runtime.reachable) break; await new Promise(x => setTimeout(x, 250)); }
    assert.equal(s.runtime.reachable, true, "runtime did not come up");
    assert.equal(s.topology.actualSearch, 5); assert.equal(s.topology.actualExecution, 25);
    assert.equal(s.ownerKey.ownerAuthState, "CONNECTED_UNTESTED");
    r.core.setEmergency({ mode: "PAUSE_ALL", passphrase: PW });
    let halted = false; for (let i = 0; i < 40 && !halted; i++) { await new Promise(x => setTimeout(x, 250)); const d = await r.core.status(); halted = d.emergency.mode === "PAUSE_ALL" && d.agents.execution.every(a => a.status === "HALTED_BY_OWNER_STOP"); }
    assert.equal(halted, true);
    const stopped = await r.core.stopRuntime();
    assert.equal(stopped.stopped, true); if (process.platform !== "win32") assert.equal(stopped.code, 0);   // Windows has no graceful SIGTERM: the process is terminated
    assert.equal((await r.core.stopRuntime()).stopped, false, "a second Stop must return immediately (it used to hang forever when the child had been ended by a signal)");
  } finally { await r.core.stopRuntime(); r.done(); }
});

test("update center in the GUI core uses real local adapters: empty inbox finds nothing; a valid package is detected, a tampered one rejected", async () => {
  const { buildPackage } = await import("../atlasz-addons/local-update-adapters.mjs");
  const r = rig();
  try {
    assert.equal(r.core.updates().adapters.kind, "LOCAL_OFFLINE_PACKAGES"); assert.equal(r.core.updates().notice, null);
    assert.ok(r.core.updates().components.some(c => c.id === "atlasz-extension-pack"));
    assert.deepEqual((await r.core.updateActions.check()).result.found, []);
    const inbox = path.join(r.stateDir, "updates", "inbox");
    buildPackage(path.join(inbox, "p1"), { componentId: "atlasz-extension-pack", version: "1.0.1", files: { VERSION: "1.0.1\n" } });
    buildPackage(path.join(inbox, "p2"), { componentId: "atlasz-extension-pack", version: "1.0.2", files: { VERSION: "1.0.2\n" } });
    fs.writeFileSync(path.join(inbox, "p2", "payload", "VERSION"), "9.9.9\n");
    const c = await r.core.updateActions.check();
    assert.deepEqual(c.result.found, ["atlasz-extension-pack@1.0.1"]);
    assert.equal(r.core.updates().inbox.rejected.length, 1);
  } finally { r.done(); }
});

test("Stop is idempotent even when the runtime ends BY A SIGNAL (the Windows case): the second Stop returns immediately instead of hanging", async () => {
  const d = tmp("sig-"), entry = path.join(d, "fake-runtime.mjs"); fs.writeFileSync(entry, "setInterval(() => {}, 1000);");       // no SIGTERM handler => killed by signal, exitCode stays null
  const r = rig({ runtimeEntry: entry });
  try {
    assert.equal(r.core.startRuntime().started, true);
    const first = await r.core.stopRuntime(); assert.equal(first.stopped, true); assert.ok(first.signal === "SIGTERM" || first.code !== 0);
    const second = await Promise.race([r.core.stopRuntime(), new Promise(res => setTimeout(() => res("HUNG"), 3000))]);
    assert.notEqual(second, "HUNG"); assert.equal(second.stopped, false);
    assert.equal(r.core.startRuntime().started, true, "after a signal-ended child, Start must start a new one, not report ALREADY_RUNNING");
    await r.core.stopRuntime();
  } finally { await r.core.stopRuntime(); r.done(); rm(d); }
});
