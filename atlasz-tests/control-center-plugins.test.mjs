import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";

const PW = "correct horse battery";
test("Control Center plugin panel: theme applies without approval, code plugin needs the owner passphrase, broken plugin is contained", async () => {
  const base = tmp("ccp-"), configDir = path.join(base, "c"), stateDir = path.join(base, "s");
  const core = createControlCenterCore({ stateDir, configDir });
  try {
    await core.provisionOwnerKey({ passphrase: PW });
    const pdir = path.join(configDir, "plugins"); fs.mkdirSync(path.join(pdir, "t"), { recursive: true }); fs.mkdirSync(path.join(pdir, "p"), { recursive: true });
    const m = { schema: 1, version: "1.0.0", atlaszCompat: ">=7.3.0" };
    fs.writeFileSync(path.join(pdir, "t", "plugin.json"), JSON.stringify({ ...m, id: "night", name: "Night", kind: "THEME", permissions: ["UI_THEME"], variables: { "--bg": "#050a14" } }));
    fs.writeFileSync(path.join(pdir, "p", "plugin.json"), JSON.stringify({ ...m, id: "boom", name: "Boom", kind: "PLUGIN", permissions: ["READ_STATE"], entry: "m.mjs" }));
    fs.writeFileSync(path.join(pdir, "p", "m.mjs"), "process.exit(3);");
    assert.deepEqual(core.plugins().plugins.map(x => x.id).sort(), ["boom", "night"]);
    assert.equal((await core.pluginActions.setTheme({ id: "night" })).ok, true); assert.equal(core.theme().variables["--bg"], "#050a14");
    const noPass = await core.pluginActions.enable({ id: "boom" }); assert.equal(noPass.result.ok, false);
    const bad = await core.pluginActions.enable({ id: "boom", passphrase: "wrong wrong wrong" }); assert.equal(bad.ok, false);
    const good = await core.pluginActions.enable({ id: "boom", passphrase: PW }); assert.equal(good.result.ok, true);
    assert.equal(core.plugins().plugins.find(x => x.id === "boom").status, "ENABLED");
    assert.equal((await core.pluginActions.disable({ id: "boom" })).result.ok, true);
  } finally { rm(base); }
});
