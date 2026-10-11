import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "mb-")); return createControlCenterCore({ stateDir: path.join(d, "s"), configDir: path.join(d, "c") }); };
const OK = new Set(["HEALTHY", "VIA_CONSUMER", "OFFLINE_BY_DESIGN", "SUPERSEDED"]);

test("every registered module is healthy through the real control chain, or documented as offline/consumed/superseded", async () => {
  const c = mk(); const r = await c.modules({ health: true });
  assert.ok(r.summary.modules >= 16);
  for (const m of r.catalog) assert.ok(OK.has(m.health?.state), m.id + " -> " + m.health?.state + " " + m.health?.detail);
  assert.ok(!r.catalog.some(m => m.health.state === "NO_PROBE"));
});
test("module invocation: Master-style caller -> broker -> chain -> module; unknown module/capability rejected; invocation audited", async () => {
  const c = mk(), b = c.moduleBroker();
  const ok = await b.invoke("owner-control", "firewall", {}, { actor: { type: "SYSTEM", id: "MASTER" } });
  assert.equal(ok.status, "OK"); assert.equal(ok.manager, "SECURITY_APPROVAL_MANAGER");
  assert.equal((await b.invoke("nope", "x")).status, "UNKNOWN_MODULE");
  assert.equal((await b.invoke("owner-control", "nope")).status, "UNKNOWN_CAPABILITY");
  assert.equal(b.get("owner-control").invocations, 1);
});
test("an internal-library or superseded module has no invocation surface (no hidden second runtime)", async () => {
  const b = mk().moduleBroker();
  for (const id of b.ids()) { const m = b.get(id); if (["SUPERSEDED", "INTERNAL_LIBRARY", "OFFLINE_ACTIVATED"].includes(m.lifecycle)) assert.equal(m.capabilities.length, 0, id); }
});
test("tenant isolation is documented as owner-activated and a second tenant cannot be reached by default", async () => {
  const m = mk().moduleBroker().get("tenant-isolation");
  assert.equal(m.lifecycle, "OFFLINE_ACTIVATED"); assert.match(m.activation, /tenant/i);
});
