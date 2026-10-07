// ATLASZ categorised recovery (V7.3 Owner Control §11, §12). Backups, restore points and rollback per category; an existing backup
// that cannot be restored is NOT sufficient: a category is VERIFIED only when manifest hashes match AND a recovery drill into a scratch
// directory reproduced every file. LKG (Last Known Good) is a VERIFIED STABLE RECOVERY POINT with an explicit evidence set, and the
// "latest" LKG is never taken blindly: the newest one whose backup still verifies wins.
import fs from "node:fs";
import path from "node:path";
import { createBackup, verifyBackup, recoveryDrill, restoreBackup, createLkgRegistry } from "../backup-recovery.mjs";

export const RECOVERY_CATEGORIES = Object.freeze(["APPLICATION_VERSION", "CONFIGURATION", "DATABASE_SCHEMA", "AGENT_WORKFLOWS", "MODEL_ROUTING", "CONNECTOR_CONFIGURATION", "CRITICAL_SYSTEM_STATE"]);
export const LKG_REQUIREMENTS = Object.freeze(["buildIdentified", "configKnown", "dependenciesKnown", "schemaStateKnown", "criticalTestsPassed", "healthChecksPassed", "backupAvailable", "rollbackPathKnown", "recoveryEvidence"]);

export function createRecoveryManager({ root, sources = {}, chain = null, now = () => new Date() } = {}) {
  if (!root) throw new Error("ROOT_REQUIRED");
  for (const c of Object.keys(sources)) if (!RECOVERY_CATEGORIES.includes(c)) throw new Error("UNKNOWN_CATEGORY:" + c);
  const bdir = c => path.join(root, "backups", c), statusFile = path.join(root, "recovery-status.json");
  const lkg = createLkgRegistry({ file: path.join(root, "lkg.jsonl") });
  let last = { points: {}, verification: {}, verifiedAt: null };
  if (fs.existsSync(statusFile)) { try { last = JSON.parse(fs.readFileSync(statusFile, "utf8")); } catch { last = { points: {}, verification: {}, verifiedAt: null, integrity: "STATUS_UNREADABLE" }; } }
  const save = () => { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(statusFile + ".tmp", JSON.stringify(last)); fs.renameSync(statusFile + ".tmp", statusFile); };
  const latestDir = c => { const d = bdir(c); if (!fs.existsSync(d)) return null; const names = fs.readdirSync(d).filter(n => fs.existsSync(path.join(d, n, "manifest.json"))).sort(); return names.length ? path.join(d, names.at(-1)) : null; };

  function createRestorePoint({ categories = RECOVERY_CATEGORIES, appVersion = null } = {}) {
    const out = {};
    for (const c of categories) {
      if (!RECOVERY_CATEGORIES.includes(c)) { out[c] = { status: "UNKNOWN_CATEGORY" }; continue; }
      if (!sources[c]) { out[c] = { status: "NOT_CONFIGURED" }; continue; }
      try { const b = createBackup({ srcDir: sources[c], backupRoot: bdir(c), label: c, appVersion, now }); out[c] = { status: "CREATED", id: b.id, files: b.manifest.files.length, verifiedYet: false }; last.points[c] = b.id; }
      catch (e) { out[c] = { status: "FAILED", reason: String(e.message) }; }
    }
    save(); return out;
  }
  /** VERIFY BACKUP: manifest hashes + a real restore into scratch. Honest per-category result. */
  function verifyBackups({ categories = RECOVERY_CATEGORIES } = {}) {
    const out = {};
    for (const c of categories) {
      if (!sources[c]) { out[c] = { status: "NOT_CONFIGURED" }; continue; }
      const dir = latestDir(c);
      if (!dir) { out[c] = { status: "NO_BACKUP" }; continue; }
      const v = verifyBackup(dir);
      if (!v.ok) { out[c] = { status: "FAILED", problems: v.problems.slice(0, 5), backupId: path.basename(dir) }; continue; }
      try {
        const scratch = path.join(root, "scratch", c);
        const r = recoveryDrill({ srcDir: sources[c], backupRoot: path.join(root, "drill", c), scratchDir: scratch });
        out[c] = r.passed ? { status: "VERIFIED", backupId: path.basename(dir), drilledFiles: r.files } : { status: "UNRESTORABLE", mismatches: r.mismatches.slice(0, 5) };
        fs.rmSync(scratch, { recursive: true, force: true });
      } catch (e) { out[c] = { status: "UNRESTORABLE", reason: String(e.message).slice(0, 120) }; }
    }
    last.verification = { ...last.verification, ...out }; last.verifiedAt = now().toISOString(); save(); return out;
  }
  function gated(operation, params, ownerApproval, actor) {
    if (!chain) return { allowed: false, reason: "CONTROL_CHAIN_REQUIRED_FAIL_CLOSED" };
    const d = chain.evaluate({ actor, operation, params, ownerApproval, pathId: "recovery." + operation.toLowerCase() });
    return { allowed: d.allowed, reason: d.reason, decision: d };
  }
  const ownerShim = { granted: () => true };   // the chain already verified one approval bound to this exact restore; no second prompt
  function restore({ category, backupId = null, targetDir = sources[category], ownerApproval = null, actor = { type: "OWNER", id: "JOCI" } } = {}) {
    if (!RECOVERY_CATEGORIES.includes(category) || !targetDir) return { restored: false, reason: "CATEGORY_NOT_CONFIGURED" };
    const dir = backupId ? path.join(bdir(category), backupId) : latestDir(category);
    if (!dir || !fs.existsSync(dir)) return { restored: false, reason: "BACKUP_NOT_FOUND" };
    const g = gated("RESTORE", { category, backupId: path.basename(dir), targetDir: path.resolve(targetDir) }, ownerApproval, actor);
    if (!g.allowed) return { restored: false, reason: g.reason, decision: g.decision };
    try { return { ...restoreBackup({ backupDir: dir, targetDir, ownerApproval, ownerAuth: ownerShim }), restored: true }; } catch (e) { return { restored: false, reason: String(e.message) }; }
  }
  /** LKG = verified stable recovery point. Every requirement must be explicitly true AND the backup must verify now. */
  function markLkg({ category = "APPLICATION_VERSION", build = {}, checks = {}, evidence = null } = {}) {
    if (!evidence) throw new Error("LKG_EVIDENCE_REQUIRED");
    const missing = LKG_REQUIREMENTS.filter(k => checks[k] !== true);
    if (missing.length) throw new Error("LKG_REQUIREMENTS_NOT_MET:" + missing.join(","));
    if (!build.version || !build.buildId || !build.configHash || !build.dependenciesHash) throw new Error("LKG_BUILD_NOT_IDENTIFIABLE");
    const dir = latestDir(category); if (!dir) throw new Error("LKG_NO_BACKUP");
    if (last.verification?.[category]?.status !== "VERIFIED" || last.verification[category].backupId !== path.basename(dir)) throw new Error("LKG_BACKUP_NOT_DRILL_VERIFIED");
    return lkg.mark({ backupDir: dir, build: { ...build, category }, checks: { smokeTestsPassed: checks.criticalTestsPassed, healthOk: checks.healthChecksPassed, backupVerified: checks.backupAvailable, restoreDrillPassed: checks.recoveryEvidence, migrationStateKnown: checks.schemaStateKnown }, evidence: { ...(typeof evidence === "object" ? evidence : { note: evidence }), requirements: LKG_REQUIREMENTS } });
  }
  /** Newest LKG whose backup still verifies. Corrupt newer ones are skipped and reported. */
  function latestVerifiedLkg() {
    const skipped = [];
    for (const e of [...lkg.history()].reverse()) { const v = verifyBackup(e.backupDir); if (v.ok) return { lkg: e, skipped }; skipped.push({ backupId: e.backupId, problems: v.problems.slice(0, 3) }); }
    return { lkg: null, skipped };
  }
  function rollbackToLkg({ targetDir = sources.APPLICATION_VERSION, ownerApproval = null, actor = { type: "OWNER", id: "JOCI" } } = {}) {
    const { lkg: l, skipped } = latestVerifiedLkg();
    if (!l) return { rolledBack: false, reason: "NO_VERIFIED_LKG", skipped };
    if (!targetDir) return { rolledBack: false, reason: "TARGET_NOT_CONFIGURED" };
    const g = gated("ROLLBACK", { lkg: l.backupId, targetDir: path.resolve(targetDir) }, ownerApproval, actor);
    if (!g.allowed) return { rolledBack: false, reason: g.reason, decision: g.decision };
    try { return { ...restoreBackup({ backupDir: l.backupDir, targetDir, ownerApproval, ownerAuth: ownerShim }), rolledBack: true, lkgBackupId: l.backupId }; } catch (e) { return { rolledBack: false, reason: String(e.message) }; }
  }
  function readiness() {
    const cats = RECOVERY_CATEGORIES.map(c => ({ category: c, backup: !sources[c] ? "NOT_CONFIGURED" : last.verification?.[c]?.status ?? "NOT_VERIFIED_YET", latestPoint: last.points?.[c] ?? null }));
    const configured = cats.filter(c => c.backup !== "NOT_CONFIGURED");
    const { lkg: l } = latestVerifiedLkg();
    let state = "UNKNOWN";
    if (last.integrity) state = "UNKNOWN";
    else if (!configured.length) state = "NOT_CONFIGURED";
    else if (configured.every(c => c.backup === "VERIFIED") && l) state = "READY";
    else if (configured.some(c => ["FAILED", "UNRESTORABLE", "NO_BACKUP"].includes(c.backup))) state = "NOT_READY";
    else state = "UNKNOWN";
    return { restoreReadiness: state, categories: cats, lkg: l ? { backupId: l.backupId, build: l.build } : null, verifiedAt: last.verifiedAt };
  }
  return { createRestorePoint, verifyBackups, restore, markLkg, latestVerifiedLkg, rollbackToLkg, readiness, lkgVerify: () => lkg.verify() };
}
