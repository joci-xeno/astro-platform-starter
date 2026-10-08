// Sandbox tools through the control chain (owner approval bound to the exact code), as hosted by the runtime, and the Control Center view.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { createCodeSandbox, registerSandboxTools } from "../atlasz-addons/code-sandbox.mjs";
import { createToolRegistry } from "../atlasz-addons/typed-tools.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";
import { rig } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";
const { createRuntime } = await import("../atlasz-runtime/supervisor-safe.mjs");

const AGENT = { actor: { type: "AGENT", id: "E7" } };
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const call = (port, token, method, p, body) => new Promise((res, rej) => { const data = body ? JSON.stringify(body) : null; const q = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host: "127.0.0.1:" + port, "x-atlasz-token": token, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => { let j = null; try { j = JSON.parse(b); } catch { /* not json */ } res({ status: r.statusCode, body: j }); }); }); q.on("error", rej); if (data) q.write(data); q.end(); });

test("process-only execution needs a signed owner approval bound to the exact code; swapped code, replay and unapproved calls never run", async () => {
  const r = rig(), base = tmp("sbxh-");
  try {
    const sb = createCodeSandbox({ baseDir: path.join(base, "runs"), auditFile: path.join(base, "a.jsonl"), forceLevel: "PROCESS_ONLY", blackBox: r.blackBox });
    const reg = createToolRegistry({ chain: r.sys.chain, blackBox: r.blackBox }); registerSandboxTools(reg, sb);
    const args = { language: "javascript", code: "console.log('approved-run')" };
    const plain = await reg.invoke("sandbox.run", args, AGENT); assert.equal(plain.status, "OK"); assert.equal(plain.result.status, "ISOLATION_NOT_AVAILABLE_NEEDS_OWNER_APPROVAL"); assert.equal(plain.result.stdout, undefined);
    assert.equal((await reg.invoke("sandbox.run_process_only", args, AGENT)).status, "REQUIRES_APPROVAL");
    const ap = r.opApproval("HIGH_RISK_CHANGE", args);
    const swapped = await reg.invoke("sandbox.run_process_only", { ...args, code: "console.log('EVIL')" }, { ...AGENT, ownerApproval: ap }); assert.notEqual(swapped.status, "OK");
    const ok = await reg.invoke("sandbox.run_process_only", args, { ...AGENT, ownerApproval: r.opApproval("HIGH_RISK_CHANGE", args) }); assert.equal(ok.status, "OK"); assert.equal(ok.result.status, "OK"); assert.equal(ok.result.stdout.trim(), "approved-run"); assert.equal(ok.result.isolation.level, "PROCESS_ONLY");
    const spent = r.opApproval("HIGH_RISK_CHANGE", args); await reg.invoke("sandbox.run_process_only", args, { ...AGENT, ownerApproval: spent });
    assert.notEqual((await reg.invoke("sandbox.run_process_only", args, { ...AGENT, ownerApproval: spent })).status, "OK");                    // single use
    assert.equal((await reg.invoke("sandbox.run", { language: "javascript", code: "1", extra: true }, AGENT)).status, "INVALID_ARGUMENTS");
    r.stop(); assert.notEqual((await reg.invoke("sandbox.run_process_only", args, { ...AGENT, ownerApproval: r.opApproval("HIGH_RISK_CHANGE", args) })).status, "OK");      // kill switch beats approval
    r.resume(); assert.equal((await reg.invoke("sandbox.status", {}, AGENT)).result.level, "PROCESS_ONLY");
  } finally { rm(r.dir); rm(base); }
});

test("hosted: the runtime registers the sandbox tools, audits runs and reports the real isolation level on the dashboard", async () => {
  const dir = tmp("sbxr-");
  try {
    const rt = createRuntime({ dataDir: dir, retryBaseMs: 0, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" }) });
    const names = rt.tools.describe().map(t => t.name); for (const n of ["sandbox.run", "sandbox.run_process_only", "sandbox.status"]) assert.ok(names.includes(n), n);
    const lvl = rt.sandbox.capabilities().level, r = await rt.tools.invoke("sandbox.run", { language: "javascript", code: "console.log(21*2)" }, AGENT);
    assert.equal(r.status, "OK"); if (lvl === "NAMESPACE") { assert.equal(r.result.status, "OK"); assert.equal(r.result.stdout.trim(), "42"); } else assert.equal(r.result.status, "ISOLATION_NOT_AVAILABLE_NEEDS_OWNER_APPROVAL");
    assert.equal((await rt.tools.invoke("sandbox.run_process_only", { language: "javascript", code: "console.log(1)" }, AGENT)).status, "REQUIRES_APPROVAL");
    const d = rt.dashboard().sandbox; assert.equal(d.level, lvl); assert.equal(d.runs, 1); assert.equal(d.audit.ok, true); assert.match(d.label, /not a container or VM/);
    assert.ok(fs.existsSync(path.join(dir, "sandbox", "audit.jsonl")));
    rt.stop?.();
  } finally { rm(dir); }
});

test("Control Center: sandbox view and run are token-protected; owner runs report isolation; an unreadable audit log is reported and not replaced", async () => {
  const base = tmp("sbxc-"), cc = createControlCenterServer({ stateDir: path.join(base, "s"), configDir: path.join(base, "c"), port: await freePort() });
  const { port, token } = await cc.listen();
  try {
    assert.equal((await call(port, "wrong", "GET", "/api/sandbox")).status, 401); assert.equal((await call(port, "wrong", "POST", "/api/sandbox/run", { language: "javascript", code: "1" })).status, 401);
    const v0 = (await call(port, token, "GET", "/api/sandbox")).body; assert.equal(v0.state, "CONNECTED"); const lvl = v0.summary.level;
    const r = await call(port, token, "POST", "/api/sandbox/run", { language: "javascript", code: "console.log('from-owner')" }); assert.equal(r.status, 200);
    if (lvl === "NAMESPACE") { assert.equal(r.body.result.status, "OK"); assert.match(r.body.result.stdout, /from-owner/); } else assert.equal(r.body.result.status, "ISOLATION_NOT_AVAILABLE_NEEDS_OWNER_APPROVAL");
    assert.equal((await call(port, token, "POST", "/api/sandbox/run", { language: "cobol", code: "x" })).status, 400);
    const v = (await call(port, token, "GET", "/api/sandbox")).body; assert.equal(v.history[0].actor, "OWNER"); assert.equal(v.summary.audit.ok, true);
    const f = path.join(base, "s", "sandbox", "audit.jsonl"); fs.writeFileSync(f, "{x\n");
    assert.equal((await call(port, token, "GET", "/api/sandbox")).body.state, "UNREADABLE"); assert.equal(fs.readFileSync(f, "utf8"), "{x\n");
  } finally { await cc.close?.(); rm(base); }
});
