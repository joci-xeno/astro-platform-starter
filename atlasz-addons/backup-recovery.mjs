// ATLASZ Backup / Restore / Recovery / Last-Known-Good (V7.3 §37, §51, §52 #17 #20).
// - createBackup: copies a state dir into backupRoot/<id>/data with a sha256 manifest.
// - verifyBackup: recomputes every hash; reports missing, modified and unexpected files.
// - restoreBackup: verifies first; into a non-empty target it needs a verified OWNER approval (destructive),
//   moves the old data aside (never deletes), restores, re-verifies, and rolls back if verification fails.
// - recoveryDrill: backup -> restore into a scratch dir -> compare hashes. This is the evidence that restore works.
// - LKG: a build/state may be marked last-known-good only when ALL criteria are true; history is hash-chained.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { ownerGranted } from "./owner-auth.mjs";

const sha = buf => createHash("sha256").update(buf).digest("hex");
export const LKG_CRITERIA = Object.freeze(["smokeTestsPassed", "healthOk", "backupVerified", "restoreDrillPassed", "migrationStateKnown"]);

function walk(root, base = root, out = []) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, e.name);
    if (e.isSymbolicLink()) continue;                       // never follow links out of the tree
    if (e.isDirectory()) walk(full, base, out);
    else if (e.isFile() && !e.name.endsWith(".tmp")) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}
const manifestHash = m => sha(JSON.stringify({ ...m, manifestHash: undefined }));

export function createBackup({ srcDir, backupRoot, label = "manual", appVersion = null, schemaVersion = null, now = () => new Date() } = {}) {
  if (!srcDir || !backupRoot) throw new Error("BACKUP_PATHS_REQUIRED");
  if (!fs.existsSync(srcDir)) throw new Error("BACKUP_SOURCE_MISSING");
  const rootAbs = path.resolve(backupRoot), srcAbs = path.resolve(srcDir);
  if (rootAbs.startsWith(srcAbs + path.sep) || rootAbs === srcAbs) throw new Error("BACKUP_ROOT_INSIDE_SOURCE");
  const at = now();
  const id = at.toISOString().replace(/[:.]/g, "-") + "_" + String(label).replace(/[^A-Za-z0-9_-]/g, "_");
  const dir = path.join(rootAbs, id), data = path.join(dir, "data");
  fs.mkdirSync(data, { recursive: true });
  const files = [];
  for (const rel of walk(srcAbs)) {
    const buf = fs.readFileSync(path.join(srcAbs, rel));
    const dest = path.join(data, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf, { mode: 0o600 });
    files.push({ path: rel, size: buf.length, sha256: sha(buf) });
  }
  const m = { id, createdAt: at.toISOString(), label, appVersion, schemaVersion, files, totalBytes: files.reduce((s, f) => s + f.size, 0) };
  m.manifestHash = manifestHash(m);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m, null, 1), { mode: 0o600 });
  return { id, dir, manifest: m };
}

export function verifyBackup(dir) {
  const mp = path.join(dir, "manifest.json");
  if (!fs.existsSync(mp)) return { ok: false, problems: ["MANIFEST_MISSING"] };
  const m = JSON.parse(fs.readFileSync(mp, "utf8"));
  const problems = [];
  if (manifestHash(m) !== m.manifestHash) problems.push("MANIFEST_HASH_MISMATCH");
  const data = path.join(dir, "data");
  const listed = new Set(m.files.map(f => f.path));
  for (const f of m.files) {
    const p = path.join(data, f.path);
    if (!fs.existsSync(p)) { problems.push("MISSING:" + f.path); continue; }
    if (sha(fs.readFileSync(p)) !== f.sha256) problems.push("MODIFIED:" + f.path);
  }
  if (fs.existsSync(data)) for (const rel of walk(data)) if (!listed.has(rel)) problems.push("UNEXPECTED:" + rel);
  return { ok: problems.length === 0, problems, manifest: m };
}

export function restoreBackup({ backupDir, targetDir, ownerApproval = null, now = () => Date.now() } = {}) {
  const v = verifyBackup(backupDir);
  if (!v.ok) throw new Error("RESTORE_ABORTED_BACKUP_INVALID:" + v.problems.slice(0, 3).join(","));
  const targetExists = fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0;
  let movedAside = null;
  if (targetExists) {
    if (!ownerGranted(ownerApproval, "RESTORE_OVERWRITE", path.basename(path.resolve(targetDir)))) throw new Error("OWNER_APPROVAL_REQUIRED:RESTORE_OVERWRITE");
    movedAside = path.resolve(targetDir) + ".pre-restore-" + now();
    fs.renameSync(targetDir, movedAside);                   // old data is preserved, never deleted
  }
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const f of v.manifest.files) {
      const dest = path.join(targetDir, f.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(backupDir, "data", f.path), dest);
    }
    for (const f of v.manifest.files) if (sha(fs.readFileSync(path.join(targetDir, f.path))) !== f.sha256) throw new Error("POST_RESTORE_HASH_MISMATCH:" + f.path);
  } catch (e) {
    fs.rmSync(targetDir, { recursive: true, force: true });  // remove only the partial restore we just wrote
    if (movedAside) fs.renameSync(movedAside, targetDir);    // put the original back
    throw new Error("RESTORE_FAILED_ROLLED_BACK:" + e.message);
  }
  return { restored: v.manifest.files.length, backupId: v.manifest.id, movedAside, verified: true };
}

export function recoveryDrill({ srcDir, backupRoot, scratchDir }) {
  const b = createBackup({ srcDir, backupRoot, label: "drill" });
  fs.rmSync(scratchDir, { recursive: true, force: true });
  const r = restoreBackup({ backupDir: b.dir, targetDir: scratchDir });
  const mismatches = [];
  for (const f of b.manifest.files) {
    const p = path.join(scratchDir, f.path);
    if (!fs.existsSync(p) || sha(fs.readFileSync(p)) !== f.sha256) mismatches.push(f.path);
  }
  return { passed: mismatches.length === 0 && r.verified, backupId: b.id, files: b.manifest.files.length, mismatches, manifestHash: b.manifest.manifestHash };
}

// ---- Last Known Good ----
export function createLkgRegistry({ file }) {
  const chain = createAuditChain({ filePath: file });
  const history = () => chain.entries().filter(e => e.event === "LKG_MARKED").map(e => e.data);
  function mark({ backupDir, build = {}, checks = {}, evidence = null }) {
    const missing = LKG_CRITERIA.filter(k => checks[k] !== true);
    if (missing.length) throw new Error("LKG_CRITERIA_NOT_MET:" + missing.join(","));
    const v = verifyBackup(backupDir);
    if (!v.ok) throw new Error("LKG_BACKUP_INVALID");
    if (!evidence) throw new Error("LKG_EVIDENCE_REQUIRED");
    chain.append("LKG_MARKED", { backupDir, backupId: v.manifest.id, manifestHash: v.manifest.manifestHash, build, checks, evidence });
    return history().at(-1);
  }
  return { mark, latest: () => history().at(-1) ?? null, history, verify: () => chain.verify() };
}

export function rollbackToLastKnownGood({ registry, targetDir, ownerApproval = null }) {
  const lkg = registry.latest();
  if (!lkg) throw new Error("NO_LAST_KNOWN_GOOD");
  const r = restoreBackup({ backupDir: lkg.backupDir, targetDir, ownerApproval });
  return { ...r, lkgBackupId: lkg.backupId, build: lkg.build, evidence: lkg.evidence, jociDecisionNeeded: false };
}

// Automatic rollback of a failed UPDATE (V7.3 update addendum). Unlike restoreBackup it needs no owner approval,
// because it only restores the exact pre-update snapshot the update itself took (hash-verified manifest), into an
// install directory that holds code, not live data. The failed build is moved aside as evidence, never deleted.
export function rollbackInstall({ backupDir, targetDir, now = () => Date.now() } = {}) {
  const v = verifyBackup(backupDir);
  if (!v.ok) throw new Error("ROLLBACK_ABORTED_BACKUP_INVALID:" + v.problems.slice(0, 3).join(","));
  let failedAside = null;
  if (fs.existsSync(targetDir)) { failedAside = path.resolve(targetDir) + ".failed-" + now(); fs.renameSync(targetDir, failedAside); }
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const f of v.manifest.files) {
      const dest = path.join(targetDir, f.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(backupDir, "data", f.path), dest);
    }
    for (const f of v.manifest.files) if (sha(fs.readFileSync(path.join(targetDir, f.path))) !== f.sha256) throw new Error("POST_ROLLBACK_HASH_MISMATCH:" + f.path);
  } catch (e) {
    fs.rmSync(targetDir, { recursive: true, force: true });  // only the partial restore we just wrote
    if (failedAside) fs.renameSync(failedAside, targetDir);
    throw new Error("ROLLBACK_FAILED:" + e.message);
  }
  return { restored: v.manifest.files.length, backupId: v.manifest.id, failedBuildPreservedAt: failedAside, hashVerified: true };
}
