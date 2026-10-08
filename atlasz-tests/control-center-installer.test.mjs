import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";

const PW = "correct horse battery", MAIN = "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify({ok:1})));";
function pkg(inbox, name, version, extra = {}) {
  const d = path.join(inbox, name); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "plugin.json"), JSON.stringify({ schema: 1, id: "demo-plugin", name: "Demo", version, kind: "PLUGIN", entry: "main.mjs", permissions: ["READ_STATE"], atlaszCompat: ">=7.3.0", ...extra }));
  fs.writeFileSync(path.join(d, "main.mjs"), MAIN); return d;
}
test("Control Center installer: owner passphrase required, inbox-only paths, installs DISABLED, upgrade disables, rollback and uninstall are owner-signed, kill switch stops it", async () => {
  const base = tmp("cci-"), configDir = path.join(base, "c"), stateDir = path.join(base, "s"), inbox = path.join(configDir, "plugin-inbox");
  const core = createControlCenterCore({ stateDir, configDir });
  try {
    await core.provisionOwnerKey({ passphrase: PW });
    pkg(inbox, "demo-1", "1.0.0"); pkg(inbox, "bad", "1.0.0", { permissions: ["SECRETS"] });
    const v = core.plugins(); assert.deepEqual(v.inbox.map(x => [x.name, x.ok]), [["bad", false], ["demo-1", true]]); assert.match(v.inbox[0].problems.join(), /FORBIDDEN_PERMISSION/);
    // no passphrase / wrong passphrase / rejected package / path tricks
    assert.equal((await core.pluginActions.install({ name: "demo-1" })).result.ok, false);
    assert.equal((await core.pluginActions.install({ name: "demo-1", passphrase: "wrong wrong wrong" })).ok, false);
    assert.equal((await core.pluginActions.install({ name: "bad", passphrase: PW })).result.reason, "PACKAGE_REJECTED");
    for (const n of ["..", "../c", "a/b", "/etc", ".hidden", "", null, 5]) { const r = await core.pluginActions.install({ name: n, passphrase: PW }); assert.equal(Boolean(r.ok && r.result?.ok), false, String(n)); }
    assert.equal(core.plugins().plugins.length, 0, "nothing installed by any refused attempt");
    // install
    const i = await core.pluginActions.install({ name: "demo-1", passphrase: PW }); assert.deepEqual([i.ok, i.result.ok, i.result.enabled], [true, true, false]);
    assert.equal(core.plugins().plugins.find(x => x.id === "demo-plugin").status, "DISABLED");
    assert.equal((await core.pluginActions.enable({ id: "demo-plugin", passphrase: PW })).result.ok, true);
    // upgrade
    pkg(inbox, "demo-2", "1.1.0"); const u = await core.pluginActions.install({ name: "demo-2", passphrase: PW }); assert.equal(u.result.ok, true); assert.equal(u.result.previous, "1.0.0");
    assert.equal(core.plugins().plugins.find(x => x.id === "demo-plugin").status, "DISABLED", "upgrade needs a fresh enable");
    assert.deepEqual(core.plugins().installed.find(x => x.id === "demo-plugin").kept.map(k => k.version), ["1.0.0"]);
    // kill switch stops install/rollback/uninstall
    pkg(inbox, "demo-3", "1.2.0");
    await core.setEmergency({ mode: "PAUSE_ALL", passphrase: PW });
    for (const r of [await core.pluginActions.install({ name: "demo-3", passphrase: PW }), await core.pluginActions.rollback({ id: "demo-plugin", version: "1.0.0", passphrase: PW }), await core.pluginActions.uninstall({ id: "demo-plugin", passphrase: PW })]) assert.equal(r.result.reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    await core.setEmergency({ mode: "RUNNING", passphrase: PW, confirm: "RESUME" });
    // rollback / uninstall
    assert.equal((await core.pluginActions.rollback({ id: "demo-plugin", version: "1.0.0" })).result.ok, false, "no passphrase");
    assert.equal((await core.pluginActions.rollback({ id: "demo-plugin", version: "9.9.9", passphrase: PW })).result.reason, "VERSION_NOT_KEPT");
    const rb = await core.pluginActions.rollback({ id: "demo-plugin", version: "1.0.0", passphrase: PW }); assert.equal(rb.result.ok, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(configDir, "plugins", "demo-plugin", "plugin.json"), "utf8")).version, "1.0.0");
    assert.equal((await core.pluginActions.uninstall({ id: "demo-plugin" })).result.ok, false);
    assert.equal((await core.pluginActions.uninstall({ id: "demo-plugin", passphrase: PW })).result.ok, true); assert.equal(core.plugins().plugins.length, 0);
  } finally { rm(base); }
});
