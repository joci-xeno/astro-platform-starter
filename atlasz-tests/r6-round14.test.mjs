import test from "node:test";
import assert from "node:assert/strict";
import { restrictedNodeCommand } from "../atlasz-addons/restricted-node.mjs";

const caps = o => ({ permission: true, namespace: false, pidNamespace: false, timeoutCmd: false, ...o });
test("requireHostIsolation refuses plain PERMISSION", () => {
  if (process.platform === "win32") return;
  const r = restrictedNodeCommand({ script: "/x.mjs", caps: caps({}), requireHostIsolation: true, allowNetwork: true });
  assert.equal(r.ok, false); assert.equal(r.reason, "HOST_ISOLATION_UNAVAILABLE");
});
test("pid namespace is used for no-network callers when net namespace is missing and network isolation is not required", () => {
  const r = restrictedNodeCommand({ script: "/x.mjs", caps: caps({ pidNamespace: true }) });
  assert.equal(r.ok, true); assert.equal(r.level, "PERMISSION+PID_NAMESPACE"); assert.equal(r.hostIsolated, true); assert.equal(r.networkBlocked, false);
});
test("requireNoNetwork still refuses without a net namespace", () => {
  const r = restrictedNodeCommand({ script: "/x.mjs", caps: caps({ pidNamespace: true }), requireNoNetwork: true });
  assert.equal(r.reason, "NETWORK_ISOLATION_UNAVAILABLE");
});
test("full namespace reports hostIsolated and wraps with timeout inside the namespace", () => {
  const r = restrictedNodeCommand({ script: "/x.mjs", caps: caps({ namespace: true, timeoutCmd: true }), maxLifetimeSec: 7.2 });
  assert.equal(r.hostIsolated, true); assert.equal(r.lifetimeLimited, true);
  const i = r.args.indexOf("timeout"); assert.ok(i > 0); assert.deepEqual(r.args.slice(i, i + 4), ["timeout", "-s", "KILL", "8"]);
});
test("plain launch with lifetime uses timeout as the command; without timeout probe it is not claimed", () => {
  const a = restrictedNodeCommand({ script: "/x.mjs", caps: caps({ timeoutCmd: true }), maxLifetimeSec: 3 });
  assert.equal(a.cmd, "timeout"); assert.equal(a.hostIsolated, false); assert.equal(a.lifetimeLimited, true);
  const b = restrictedNodeCommand({ script: "/x.mjs", caps: caps({}), maxLifetimeSec: 3 });
  assert.equal(b.lifetimeLimited, false); assert.notEqual(b.cmd, "timeout");
});
test("invalid lifetimes are ignored", () => {
  for (const v of [NaN, -1, 0, "x"]) assert.equal(restrictedNodeCommand({ script: "/x.mjs", caps: caps({ timeoutCmd: true }), maxLifetimeSec: v }).lifetimeLimited, false);
});

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { detectNodeRestrictions } from "../atlasz-addons/restricted-node.mjs";
test("a lifetime-limited child dies on its own when its launcher is SIGKILLed", { skip: process.platform === "win32" || !detectNodeRestrictions().permission || !detectNodeRestrictions().timeoutCmd }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "r14-")); const sc = path.join(d, "s.mjs"); fs.writeFileSync(sc, "setInterval(()=>{},1000)");
  const rc = restrictedNodeCommand({ script: sc, readDirs: [d], maxLifetimeSec: 2 });
  assert.ok(rc.ok && rc.lifetimeLimited);
  const t0 = Date.now();
  const c = spawn(rc.cmd, rc.args, { env: rc.env, stdio: "ignore", detached: true });
  await new Promise(r => setTimeout(r, 500)); process.kill(c.pid, "SIGKILL");      // launcher dies; timeout inside the chain must still reap the node child
  await new Promise(r => setTimeout(r, 3000));
  const ps = spawnSync("pgrep", ["-f", sc], { encoding: "utf8" }).stdout.trim();
  assert.equal(ps, "", "orphaned hook still running"); assert.ok(Date.now() - t0 < 6000);
});
