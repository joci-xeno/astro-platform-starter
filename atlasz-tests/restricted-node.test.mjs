import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { restrictedNodeCommand, detectNodeRestrictions, baseEnv } from "../atlasz-addons/restricted-node.mjs";
import { tmp, rm } from "./helpers.mjs";

const caps = detectNodeRestrictions(process.execPath, { fresh: true });
const run = (rc) => spawnSync(rc.cmd, rc.args, { encoding: "utf8", timeout: 15000, env: rc.env });
const mkScript = (dir, body) => { const f = path.join(dir, "h.mjs"); fs.writeFileSync(f, body); return f; };
const skip = caps.permission ? false : "node --permission unavailable on this host";

test("fails closed: no permission model => {ok:false, SANDBOX_UNAVAILABLE}; never an unrestricted command", () => {
  const rc = restrictedNodeCommand({ script: "/x.mjs", caps: { permission: false, namespace: false } });
  assert.deepEqual(rc, { ok: false, reason: "SANDBOX_UNAVAILABLE" });
  assert.equal(restrictedNodeCommand({}).reason, "SCRIPT_REQUIRED");
  assert.equal(restrictedNodeCommand({ script: "/x.mjs", requireNoNetwork: true, caps: { permission: true, namespace: false } }).reason, "NETWORK_ISOLATION_UNAVAILABLE");
});
test("command line always carries --permission, only the listed dirs, and reports honest isolation levels", () => {
  const a = restrictedNodeCommand({ script: "/p/h.mjs", readDirs: ["/p"], caps: { permission: true, namespace: false } });
  assert.ok(a.args.includes("--permission") && a.args.includes("--allow-fs-read=/p") && !a.args.some(x => x.startsWith("--allow-fs-write")));
  assert.equal(a.networkBlocked, false); assert.equal(a.level, "PERMISSION");
  const b = restrictedNodeCommand({ script: "/p/h.mjs", readDirs: ["/p"], writeDirs: ["/p"], caps: { permission: true, namespace: true } });
  assert.equal(b.cmd, "unshare"); assert.equal(b.networkBlocked, true); assert.ok(b.args.includes("--allow-fs-write=/p"));
  const c = restrictedNodeCommand({ script: "/p/h.mjs", allowNetwork: true, caps: { permission: true, namespace: true } });
  assert.notEqual(c.cmd, "unshare"); assert.equal(c.networkBlocked, false);
});
test("environment is scrubbed: inherited secrets never reach the child", () => {
  process.env.ATLASZ_TEST_SECRET = "TOP-SECRET-VALUE";
  try { const e = baseEnv({ A: "1" }); assert.equal(e.ATLASZ_TEST_SECRET, undefined); assert.equal(e.A, "1"); assert.ok("PATH" in e); }
  finally { delete process.env.ATLASZ_TEST_SECRET; }
});
test("real child: reads inside its dir, cannot read outside, cannot write, cannot spawn, sees no inherited env", { skip }, () => {
  const d = tmp(), outside = tmp();
  try {
    fs.writeFileSync(path.join(outside, "secret.txt"), "OUTSIDE");
    process.env.ATLASZ_TEST_SECRET = "TOP-SECRET-VALUE";
    const f = mkScript(d, `import fs from "node:fs"; import cp from "node:child_process";
const t = (fn) => { try { fn(); return "ALLOWED"; } catch (e) { return "DENIED"; } };
console.log(JSON.stringify({ readIn: t(() => fs.readFileSync(${JSON.stringify(path.join(d, "h.mjs"))})), readOut: t(() => fs.readFileSync(${JSON.stringify(path.join(outside, "secret.txt"))})),
 write: t(() => fs.writeFileSync(${JSON.stringify(path.join(d, "w.txt"))}, "x")), spawn: t(() => cp.execSync("echo hi")), env: process.env.ATLASZ_TEST_SECRET ?? null }));`);
    const rc = restrictedNodeCommand({ script: f, readDirs: [d] }); assert.ok(rc.ok);
    const r = run(rc); assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout.trim().split("\n").pop());
    assert.deepEqual(o, { readIn: "ALLOWED", readOut: "DENIED", write: "DENIED", spawn: "DENIED", env: null });
    assert.ok(!fs.existsSync(path.join(d, "w.txt")));
  } finally { delete process.env.ATLASZ_TEST_SECRET; rm(d); rm(outside); }
});
test("write is possible only in the explicitly granted dir", { skip }, () => {
  const d = tmp(), other = tmp();
  try {
    const f = mkScript(d, `import fs from "node:fs"; const t=(fn)=>{try{fn();return "ALLOWED"}catch{return "DENIED"}}; console.log(JSON.stringify({ own: t(()=>fs.writeFileSync(${JSON.stringify(path.join(d, "w.txt"))},"x")), other: t(()=>fs.writeFileSync(${JSON.stringify(path.join(other, "w.txt"))},"x")) }));`);
    const r = run(restrictedNodeCommand({ script: f, readDirs: [d], writeDirs: [d] }));
    assert.deepEqual(JSON.parse(r.stdout.trim()), { own: "ALLOWED", other: "DENIED" });
  } finally { rm(d); rm(other); }
});
test("network: blocked when the namespace is available (and the result says so); allowNetwork lifts it", { skip: skip || (caps.namespace ? false : "no unshare namespace on this host") }, () => {
  const d = tmp();
  try {
    const f = mkScript(d, `import net from "node:net"; import os from "node:os";
const ifs = Object.entries(os.networkInterfaces()).flatMap(([k,v])=>v.map(x=>k+":"+x.address)).filter(x=>!x.startsWith("lo:"));
console.log(JSON.stringify({ nonLoopbackInterfaces: ifs.length }));`);
    const blocked = restrictedNodeCommand({ script: f, readDirs: [d] }); assert.equal(blocked.networkBlocked, true);
    assert.equal(JSON.parse(run(blocked).stdout.trim()).nonLoopbackInterfaces, 0);
    const open = restrictedNodeCommand({ script: f, readDirs: [d], allowNetwork: true }); assert.equal(open.networkBlocked, false);
  } finally { rm(d); }
});
