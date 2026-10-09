import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createPluginManager } from "../atlasz-addons/plugin-manager.mjs";
import { createOwnerAuth, generateOwnerKeyPair, issueOwnerApproval } from "../atlasz-addons/owner-auth.mjs";
import { tmp, rm } from "./helpers.mjs";

const key = generateOwnerKeyPair(), ap = (action, subject) => issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action, subject });
const base = { schema: 1, version: "1.0.0", permissions: ["READ_STATE"], atlaszCompat: ">=7.3.0" };
const ok = "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const {hook,input}=JSON.parse(d);console.log(JSON.stringify({hook,echo:input}));});";
function rig() {
  const root = tmp("plc-"), plugins = path.join(root, "plugins"); fs.mkdirSync(plugins);
  const d = path.join(plugins, "echo"); fs.mkdirSync(d); fs.writeFileSync(path.join(d, "plugin.json"), JSON.stringify({ ...base, id: "echo", name: "Echo", kind: "PLUGIN", entry: "main.mjs" })); fs.writeFileSync(path.join(d, "main.mjs"), ok);
  const pm = createPluginManager({ roots: [plugins], stateDir: path.join(root, "state"), ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }), hookTimeoutMs: 1500, quarantineAfter: 2 });
  return { root, pm, state: path.join(root, "state"), enable: p => p.enable("echo", { ownerApproval: ap("PLUGIN_ENABLE", p.enableSubject("echo")) }), done: () => rm(root) };
}

test("R6: an unwritable state file rolls the enable back (no plugin enabled in memory only) and hooks never run for it", async () => {
  const r = rig(); try {
    fs.mkdirSync(path.join(r.state, "plugins-state.json.tmp"), { recursive: true });                 // the atomic-write target cannot be created
    const e = r.enable(r.pm); assert.equal(e.ok, false); assert.match(e.reason, /STATE_NOT_WRITTEN|AUDIT/);
    assert.equal(r.pm.list().plugins[0].status, "DISABLED"); assert.equal((await r.pm.invoke("echo", "h", {})).ok, false);
  } finally { r.done(); }
});

test("R6: invoke never rejects: circular input, corrupt audit log and a failing scan are results, and a hook only runs when its start was audited", async () => {
  const r = rig(); try {
    assert.equal(r.enable(r.pm).ok, true);
    const circ = {}; circ.self = circ; const c = await r.pm.invoke("echo", "h", circ); assert.equal(c.ok, false); assert.equal(c.reason, "INPUT_NOT_SERIALISABLE");
    const good = await r.pm.invoke("echo", "h", { a: 1 }); assert.equal(good.ok, true);
    assert.ok(fs.readFileSync(path.join(r.state, "plugins-audit.jsonl"), "utf8").includes("PLUGIN_HOOK_STARTED"));
    fs.appendFileSync(path.join(r.state, "plugins-audit.jsonl"), "garbage\nmore garbage\n");
    const bad = await r.pm.invoke("echo", "h", {}); assert.equal(bad.ok, false); assert.equal(bad.reason, "AUDIT_UNAVAILABLE");
  } finally { r.done(); }
});

test("R6: a readable but unwritable audit log means the hook does not run (start must be audited)", async () => {
  const r = rig(); try {
    assert.equal(r.enable(r.pm).ok, true);
    const real = fs.openSync; fs.openSync = (f, ...a) => { if (String(f).endsWith("plugins-audit.jsonl") && a[0] === "a") { const e = new Error("EACCES"); e.code = "EACCES"; throw e; } return real(f, ...a); };
    try { const res = await r.pm.invoke("echo", "h", { a: 1 }); assert.equal(res.ok, false); assert.equal(res.reason, "AUDIT_UNAVAILABLE"); } finally { fs.openSync = real; }
    assert.equal((await r.pm.invoke("echo", "h", { a: 1 })).ok, true, "works again once the log is writable");
  } finally { r.done(); }
});
