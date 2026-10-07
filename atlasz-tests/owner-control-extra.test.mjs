import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createSystemDoctor, DOCTOR_COMPONENTS } from "../atlasz-addons/owner-control/system-doctor.mjs";
import { rig, ownerAuth } from "./owner-control-rig.mjs";
import { rm } from "./helpers.mjs";

test("doctor unit: no probes => NOT_CONFIGURED (never HEALTHY); throwing probe => FAILED; unusable answer => UNKNOWN; UNKNOWN never promoted", () => {
  assert.equal(createSystemDoctor({}).run().overall, "NOT_CONFIGURED");
  const probes = Object.fromEntries(DOCTOR_COMPONENTS.map(c => [c, () => ({ state: "HEALTHY" })]));
  assert.equal(createSystemDoctor({ probes }).run().overall, "HEALTHY");
  assert.equal(createSystemDoctor({ probes: { ...probes, queue: () => { throw new Error("x"); } } }).run().components.queue.state, "FAILED");
  for (const bad of [() => undefined, () => ({}), () => ({ state: "GREAT" }), () => null]) { const rep = createSystemDoctor({ probes: { ...probes, database: bad } }).run(); assert.equal(rep.components.database.state, "UNKNOWN"); assert.notEqual(rep.overall, "HEALTHY"); assert.equal(rep.normalOperation, false); }
  assert.equal(createSystemDoctor({ probes: { ...probes, models: () => ({ state: "DEGRADED" }) } }).run().overall, "DEGRADED");
  assert.equal(createSystemDoctor({ probes: { ...probes, models: () => ({ state: "BLOCKED" }), tools: () => ({ state: "FAILED" }) } }).run().overall, "FAILED");
});

test("restore: needs Joci's approval bound to category + backup + target; restores bytes; old data preserved; recovery verified afterwards", () => {
  const r = rig({ sources: { CONFIGURATION: { "cfg.json": '{"v":1}' } } }); const rec = r.sys.recovery; try {
    rec.createRestorePoint({ categories: ["CONFIGURATION"] }); rec.verifyBackups({ categories: ["CONFIGURATION"] });
    const target = r.sources.CONFIGURATION, bid = fs.readdirSync(path.join(r.dir, "oc", "recovery", "backups", "CONFIGURATION"))[0];
    fs.writeFileSync(path.join(target, "cfg.json"), '{"v":"broken"}');
    assert.equal(rec.restore({ category: "CONFIGURATION" }).restored, false);
    assert.equal(rec.restore({ category: "CONFIGURATION", ownerApproval: r.opApproval("RESTORE", { category: "MODEL_ROUTING", backupId: bid, targetDir: path.resolve(target) }) }).restored, false);
    const ap = r.opApproval("RESTORE", { category: "CONFIGURATION", backupId: bid, targetDir: path.resolve(target) });
    r.stop("PAUSE_ALL");                                                             // recovery is still possible during an emergency stop (owner-approved)
    const out = rec.restore({ category: "CONFIGURATION", ownerApproval: ap });
    assert.equal(out.restored, true); assert.equal(out.verified, true); assert.equal(fs.readFileSync(path.join(target, "cfg.json"), "utf8"), '{"v":1}');
    assert.ok(fs.existsSync(out.movedAside));                                        // nothing destroyed
    assert.equal(rec.restore({ category: "CONFIGURATION", ownerApproval: ap }).restored, false);   // replay
    assert.equal(rec.verifyBackups({ categories: ["CONFIGURATION"] }).CONFIGURATION.status, "VERIFIED");
  } finally { rm(r.dir); }
});

test("owner safety status exposes every required area with real values (nothing invented)", () => {
  const r = rig(); try {
    const s = r.sys.status();
    for (const k of ["ownerAuthority", "killSwitch", "approvals", "securityBrain", "financialFirewall", "blackBox", "safeMode", "recovery", "controlledPaths", "decisions"]) assert.ok(k in s, k);
    assert.equal(s.ownerAuthority.ownerId, "JOCI"); assert.equal(s.financialFirewall.mode, "NO_SPEND"); assert.equal(s.recovery.restoreReadiness, "NOT_CONFIGURED"); assert.equal(s.killSwitch.mode, "RUNNING");
    assert.equal(s.blackBox.chainIntact, true);
  } finally { rm(r.dir); }
});
