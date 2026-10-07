import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateOwnerKeyPair, issueOwnerApproval, configureOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createBackup, verifyBackup, restoreBackup, recoveryDrill, createLkgRegistry, rollbackToLastKnownGood, LKG_CRITERIA } from "../atlasz-addons/backup-recovery.mjs";
import { tmp, rm } from "./helpers.mjs";

const k = generateOwnerKeyPair(); configureOwnerAuth({ publicKeyB64: k.publicKeyB64 });
const sign = (action, subject) => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action, subject });
function seed() { const d = tmp(); fs.mkdirSync(path.join(d, "sub")); fs.writeFileSync(path.join(d, "a.json"), '{"v":1}'); fs.writeFileSync(path.join(d, "sub", "b.log"), "hello"); return d; }

test("backup + verify; detects modified, missing and unexpected files", () => {
  const src = seed(), root = tmp(); try {
    const b = createBackup({ srcDir: src, backupRoot: root }); assert.equal(verifyBackup(b.dir).ok, true);
    fs.writeFileSync(path.join(b.dir, "data", "a.json"), "tampered");
    assert.ok(verifyBackup(b.dir).problems.includes("MODIFIED:a.json"));
    fs.rmSync(path.join(b.dir, "data", "sub", "b.log")); assert.ok(verifyBackup(b.dir).problems.includes("MISSING:sub/b.log"));
    fs.writeFileSync(path.join(b.dir, "data", "evil.txt"), "x"); assert.ok(verifyBackup(b.dir).problems.includes("UNEXPECTED:evil.txt"));
  } finally { rm(src); rm(root); }
});
test("backup root inside the source is refused", () => {
  const src = seed(); try { assert.throws(() => createBackup({ srcDir: src, backupRoot: path.join(src, "bk") }), /BACKUP_ROOT_INSIDE_SOURCE/); } finally { rm(src); }
});
test("recovery drill proves restore reproduces identical bytes", () => {
  const src = seed(), root = tmp(), scratch = tmp(); try {
    const r = recoveryDrill({ srcDir: src, backupRoot: root, scratchDir: scratch });
    assert.equal(r.passed, true); assert.equal(r.files, 2); assert.deepEqual(r.mismatches, []);
    assert.equal(fs.readFileSync(path.join(scratch, "sub", "b.log"), "utf8"), "hello");
  } finally { rm(src); rm(root); rm(scratch); }
});
test("restore refuses a corrupted backup and never touches the target", () => {
  const src = seed(), root = tmp(), tgt = tmp(); try {
    const b = createBackup({ srcDir: src, backupRoot: root }); fs.writeFileSync(path.join(b.dir, "data", "a.json"), "bad");
    fs.writeFileSync(path.join(tgt, "keep.txt"), "precious");
    assert.throws(() => restoreBackup({ backupDir: b.dir, targetDir: tgt }), /RESTORE_ABORTED_BACKUP_INVALID/);
    assert.equal(fs.readFileSync(path.join(tgt, "keep.txt"), "utf8"), "precious");
  } finally { rm(src); rm(root); rm(tgt); }
});
test("restore over non-empty target needs signed owner approval and preserves old data aside", () => {
  const src = seed(), root = tmp(), parent = tmp(); const tgt = path.join(parent, "state"); try {
    const b = createBackup({ srcDir: src, backupRoot: root });
    fs.mkdirSync(tgt); fs.writeFileSync(path.join(tgt, "old.txt"), "old");
    assert.throws(() => restoreBackup({ backupDir: b.dir, targetDir: tgt, ownerApproval: true }), /OWNER_APPROVAL_REQUIRED/);
    const r = restoreBackup({ backupDir: b.dir, targetDir: tgt, ownerApproval: sign("RESTORE_OVERWRITE", "state") });
    assert.equal(r.verified, true); assert.equal(fs.existsSync(path.join(tgt, "old.txt")), false);
    assert.equal(fs.readFileSync(path.join(r.movedAside, "old.txt"), "utf8"), "old");   // never deleted
  } finally { rm(src); rm(root); rm(parent); }
});
test("LKG requires every criterion + evidence + valid backup; rollback restores it", () => {
  const src = seed(), root = tmp(), parent = tmp(), reg = path.join(tmp(), "lkg.jsonl"); const live = path.join(parent, "live"); try {
    const b = createBackup({ srcDir: src, backupRoot: root }); const lkg = createLkgRegistry({ file: reg });
    const all = Object.fromEntries(LKG_CRITERIA.map(c => [c, true]));
    assert.throws(() => lkg.mark({ backupDir: b.dir, checks: { ...all, restoreDrillPassed: false }, evidence: "e" }), /LKG_CRITERIA_NOT_MET:restoreDrillPassed/);
    assert.throws(() => lkg.mark({ backupDir: b.dir, checks: all }), /LKG_EVIDENCE_REQUIRED/);
    lkg.mark({ backupDir: b.dir, build: { v: "1.0" }, checks: all, evidence: "node --test 30/30" });
    assert.equal(lkg.verify().ok, true); assert.equal(lkg.latest().build.v, "1.0");
    fs.mkdirSync(live); fs.writeFileSync(path.join(live, "broken.txt"), "bad update");
    const r = rollbackToLastKnownGood({ registry: lkg, targetDir: live, ownerApproval: sign("RESTORE_OVERWRITE", "live") });
    assert.equal(r.verified, true); assert.equal(fs.readFileSync(path.join(live, "a.json"), "utf8"), '{"v":1}');
    assert.throws(() => rollbackToLastKnownGood({ registry: createLkgRegistry({ file: path.join(tmp(), "e.jsonl") }), targetDir: live }), /NO_LAST_KNOWN_GOOD/);
  } finally { rm(src); rm(root); rm(parent); }
});
