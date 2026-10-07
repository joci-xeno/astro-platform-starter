import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createEmergencyStop } from "../atlasz-addons/emergency-stop.mjs";
import { tmp, rm } from "./helpers.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "atlasz-runtime", "owner-cli.mjs");
function rig(dir) {
  const k = generateOwnerKeyPair();
  const auth = createOwnerAuth({ publicKeyB64: k.publicKeyB64 });
  const make = () => createEmergencyStop({ statePath: dir && path.join(dir, "es.json"), auditPath: dir && path.join(dir, "es-audit.jsonl"), ownerAuth: auth });
  const ap = (mode, o = {}) => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action: mode === "RUNNING" ? "EMERGENCY_RESUME" : "EMERGENCY_STOP", subject: mode, ...o });
  return { k, auth, make, ap };
}

test("runs by default; gate allows", () => {
  const { make } = rig(null); const es = make();
  assert.equal(es.status().mode, "RUNNING"); assert.equal(es.gate({ external: true }).allowed, true);
});
test("bare boolean / missing / forged approval cannot stop or resume", () => {
  const { make, ap } = rig(null); const es = make();
  assert.throws(() => es.setMode({ mode: "PAUSE_ALL", ownerAuthenticated: true }), /BARE_BOOLEAN_REJECTED/);
  assert.throws(() => es.setMode({ mode: "PAUSE_ALL" }), /OWNER_AUTHENTICATION_REQUIRED/);
  const f = ap("PAUSE_ALL"); f.signature = Buffer.from("x".repeat(64)).toString("base64");
  assert.throws(() => es.setMode({ mode: "PAUSE_ALL", ownerApproval: f }), /SIGNATURE_INVALID/);
  assert.equal(es.status().mode, "RUNNING");
  assert.ok(es.auditEntries().some(e => e.event === "EMERGENCY_CHANGE_DENIED"));
});
test("owner stop blocks dispatch; STOP_EXTERNAL only blocks external", () => {
  const { make, ap } = rig(null); const es = make();
  es.setMode({ mode: "STOP_EXTERNAL_ACTIONS", ownerApproval: ap("STOP_EXTERNAL_ACTIONS") });
  assert.equal(es.gate({ external: true }).allowed, false); assert.equal(es.gate({ external: false }).allowed, true);
  es.setMode({ mode: "PAUSE_ALL", ownerApproval: ap("PAUSE_ALL"), reason: "test" });
  assert.equal(es.gate({ external: false }).allowed, false);
  assert.equal(es.status().banner, "EMERGENCY STOP ACTIVE");
});
test("approval for one mode cannot be replayed for another", () => {
  const { make, ap } = rig(null); const es = make();
  assert.throws(() => es.setMode({ mode: "PAUSE_ALL", ownerApproval: ap("STOP_EXTERNAL_ACTIONS") }), /SUBJECT_MISMATCH/);
});
test("resume needs owner approval AND explicit RESUME confirmation", () => {
  const { make, ap } = rig(null); const es = make();
  es.setMode({ mode: "PAUSE_ALL", ownerApproval: ap("PAUSE_ALL") });
  assert.throws(() => es.setMode({ mode: "RUNNING", ownerApproval: ap("RUNNING") }), /EXPLICIT_RESUME_CONFIRMATION_REQUIRED/);
  assert.throws(() => es.setMode({ mode: "RUNNING", ownerApproval: ap("PAUSE_ALL"), confirm: "RESUME" }), /ACTION_MISMATCH/);
  es.setMode({ mode: "RUNNING", ownerApproval: ap("RUNNING"), confirm: "RESUME" });
  assert.equal(es.gate({ external: true }).allowed, true);
});
test("stop survives restart and audit chain verifies", () => {
  const dir = tmp(); try {
    const { make, ap } = rig(dir); const es = make();
    es.setMode({ mode: "PAUSE_ALL", ownerApproval: ap("PAUSE_ALL"), reason: "durable" });
    const es2 = make();
    assert.equal(es2.status().mode, "PAUSE_ALL"); assert.equal(es2.gate({}).allowed, false);
    assert.equal(es2.auditVerify().ok, true);
  } finally { rm(dir); }
});
test("fail-safe: editing the state file to RUNNING does not resume", () => {
  const dir = tmp(); try {
    const { make, ap } = rig(dir); const es = make();
    es.setMode({ mode: "PAUSE_ALL", ownerApproval: ap("PAUSE_ALL") });
    const f = path.join(dir, "es.json"); const s = JSON.parse(fs.readFileSync(f, "utf8"));
    s.mode = "RUNNING"; s.approval = null; fs.writeFileSync(f, JSON.stringify(s));
    const es2 = make();
    assert.equal(es2.gate({}).allowed, false); assert.match(es2.status().integrity, /STATE_FILE/);
  } finally { rm(dir); }
});
test("fail-safe: deleting the state file after a stop does not resume", () => {
  const dir = tmp(); try {
    const { make, ap } = rig(dir); make().setMode({ mode: "PAUSE_ALL", ownerApproval: ap("PAUSE_ALL") });
    fs.rmSync(path.join(dir, "es.json"));
    const es2 = make();
    assert.equal(es2.gate({}).allowed, false); assert.equal(es2.status().integrity, "STATE_FILE_MISSING_AFTER_STOP");
  } finally { rm(dir); }
});
test("a tampered audit chain is refused at startup (no silent trust)", () => {
  const dir = tmp(); try {
    const { make, ap } = rig(dir); const es = make();
    es.setMode({ mode: "PAUSE_ALL", ownerApproval: ap("PAUSE_ALL"), reason: "a" });
    const f = path.join(dir, "es-audit.jsonl"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"PAUSE_ALL"', '"RUNNING"'));
    assert.throws(() => make(), /AUDIT_CHAIN_TAMPERED/);
  } finally { rm(dir); }
});
test("alternate path: owner CLI changes the durable state and the running instance obeys", () => {
  const dir = tmp(), keyDir = tmp(); try {
    const keyFile = path.join(keyDir, "owner.pem");
    const out = execFileSync("node", [CLI, "keygen", "--out", keyFile], { encoding: "utf8" });
    const auth = createOwnerAuth({ publicKeyB64: out.trim().split("\n").pop() });
    const es = createEmergencyStop({ statePath: path.join(dir, "emergency-stop.json"), auditPath: path.join(dir, "emergency-audit.jsonl"), ownerAuth: auth });
    assert.equal(es.gate({ external: true }).allowed, true);
    execFileSync("node", [CLI, "emergency", "--key", keyFile, "--state-dir", dir, "--mode", "PAUSE_ALL", "--reason", "cli test"]);
    assert.equal(es.gate({ external: true }).allowed, false, "running instance must pick up the CLI stop");
    execFileSync("node", [CLI, "emergency", "--key", keyFile, "--state-dir", dir, "--mode", "RUNNING", "--confirm", "RESUME"]);
    assert.equal(es.gate({ external: true }).allowed, true);
    assert.equal(es.auditVerify().ok, true);
    assert.throws(() => execFileSync("node", [CLI, "keygen", "--out", keyFile], { stdio: "pipe" }), /./);
  } finally { rm(dir); rm(keyDir); }
});
