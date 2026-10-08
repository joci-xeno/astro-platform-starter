// Plugin installer with versioning and rollback (85-capability audit M05 Plugin/Skill installation; builds on plugin-manager.mjs, does not replace it).
//
// A package is a DIRECTORY holding plugin.json plus its files. The installer:
//   - inspects the package without running anything (no symlinks, no path escapes, size/file-count caps, manifest validated by the plugin manager's own validateManifest),
//   - computes a content hash over every file; the OWNER's signed approval is bound to "<id>@<version>#<hash>" (a changed byte = a different subject = approval useless),
//   - copies the files (never links) into a staging directory, re-hashes the COPY, and only then swaps it into the plugin root; the previous version is kept under stateDir for rollback,
//   - never enables anything: a freshly installed or upgraded plugin is DISABLED (and an upgrade disables the old enabled state) until the owner enables it through the existing PLUGIN_ENABLE approval,
//   - refuses while the kill switch / Safe Mode is active (fail closed), and writes a hash-chained audit record for every attempt.
// Nothing here runs plugin code. Installing is a state change that always needs the owner; there is no agent path to it.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateManifest } from "./plugin-manager.mjs";
import { parseVersion, compareVersions } from "./update-center.mjs";
import { createAuditChain } from "./audit-chain.mjs";

export const INSTALL_LIMITS = Object.freeze({ maxFiles: 200, maxFileBytes: 1024 * 1024, maxTotalBytes: 5 * 1024 * 1024, maxDepth: 6, maxKeptVersions: 5 });
const ID_RE = /^[a-z][a-z0-9-]{1,48}$/, NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/, ver = v => { const p = parseVersion(v); return p; };
const cmpV = compareVersions;
const sha = b => createHash("sha256").update(b).digest("hex");

/** Walk a package directory. Returns {ok, files:[{rel, abs, size}]} or {ok:false, problems}. lstat is used everywhere: a symlink or special file is a refusal, never followed. */
function walk(dir) {
  const problems = [], files = []; let total = 0;
  const visit = (d, depth) => {
    if (depth > INSTALL_LIMITS.maxDepth) { problems.push("TOO_DEEP"); return; }
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const abs = path.join(d, e.name), rel = path.relative(dir, abs).split(path.sep).join("/"), st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) { problems.push("SYMLINK_REFUSED:" + rel); continue; }
      if (st.isDirectory()) { if (e.name === "." || e.name === ".." || e.name.startsWith(".")) { problems.push("HIDDEN_ENTRY_REFUSED:" + rel); continue; } visit(abs, depth + 1); continue; }
      if (!st.isFile()) { problems.push("SPECIAL_FILE_REFUSED:" + rel); continue; }
      if (e.name.startsWith(".")) { problems.push("HIDDEN_ENTRY_REFUSED:" + rel); continue; }
      if (st.size > INSTALL_LIMITS.maxFileBytes) { problems.push("FILE_TOO_LARGE:" + rel); continue; }
      total += st.size; files.push({ rel, abs, size: st.size });
      if (files.length > INSTALL_LIMITS.maxFiles) { problems.push("TOO_MANY_FILES"); return; }
    }
  };
  visit(dir, 0);
  if (total > INSTALL_LIMITS.maxTotalBytes) problems.push("PACKAGE_TOO_LARGE");
  return problems.length ? { ok: false, problems } : { ok: true, files, total };
}
function hashFiles(files) {
  const h = createHash("sha256");
  for (const f of files) { const b = fs.readFileSync(f.abs); h.update(f.rel + "\0" + sha(b) + "\n"); }
  return h.digest("hex");
}

export function createPluginInstaller({ pluginRoot, stateDir, ownerAuth, atlaszVersion = "7.3.0", isStopped = () => false, pluginManager = null, now = () => new Date().toISOString() } = {}) {
  if (!pluginRoot || !stateDir || !ownerAuth) throw new Error("PLUGIN_ROOT_STATE_DIR_AND_OWNER_AUTH_REQUIRED");
  fs.mkdirSync(pluginRoot, { recursive: true }); fs.mkdirSync(stateDir, { recursive: true });
  const keptRoot = path.join(stateDir, "plugin-versions"), staging = path.join(stateDir, "plugin-staging");
  const audit = createAuditChain({ filePath: path.join(stateDir, "plugin-installer-audit.jsonl"), now });
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };
  const subjectOf = (m, hash) => m.id + "@" + m.version + "#" + hash;
  const rmrf = p => fs.rmSync(p, { recursive: true, force: true });

  /** Look at a package without changing anything. */
  function inspectPackage(dir) {
    if (typeof dir !== "string" || !dir) return { ok: false, problems: ["PACKAGE_DIR_REQUIRED"] };
    let st; try { st = fs.lstatSync(dir); } catch { return { ok: false, problems: ["PACKAGE_NOT_FOUND"] }; }
    if (!st.isDirectory()) return { ok: false, problems: ["PACKAGE_MUST_BE_A_REAL_DIRECTORY"] };
    const w = walk(dir); if (!w.ok) return w;
    const mf = w.files.find(f => f.rel === "plugin.json"); if (!mf) return { ok: false, problems: ["MANIFEST_MISSING"] };
    let m; try { m = JSON.parse(fs.readFileSync(mf.abs, "utf8")); } catch { return { ok: false, problems: ["MANIFEST_NOT_JSON"] }; }
    const v = validateManifest(m, { atlaszVersion }); if (!v.ok) return { ok: false, problems: v.problems, id: typeof m?.id === "string" ? m.id : null };
    if (m.entry && !w.files.some(f => f.rel === m.entry.replace(/^\.\//, ""))) return { ok: false, problems: ["ENTRY_FILE_MISSING"], id: m.id };
    const hash = hashFiles(w.files);
    return { ok: true, manifest: m, files: w.files.map(f => ({ rel: f.rel, size: f.size })), fileCount: w.files.length, bytes: w.total, hash, subject: subjectOf(m, hash), action: "PLUGIN_INSTALL" };
  }
  const installedDir = id => path.join(pluginRoot, id);
  function readInstalled(id) {
    try { const m = JSON.parse(fs.readFileSync(path.join(installedDir(id), "plugin.json"), "utf8")); const w = walk(installedDir(id)); return { manifest: m, hash: w.ok ? hashFiles(w.files) : null }; } catch { return null; }
  }
  const keptList = id => { const d = path.join(keptRoot, id); try { return fs.readdirSync(d).filter(n => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?__[0-9a-f]{12}$/.test(n)).sort((a, b) => cmpV(a.split("__")[0], b.split("__")[0]) || (a < b ? -1 : 1)); } catch { return []; } };

  /** Copy a verified file list into dest (regular files only, never links) and return the hash of the COPY. */
  function copyOut(files, dest) {
    rmrf(dest); fs.mkdirSync(dest, { recursive: true });
    for (const f of files) { const t = path.join(dest, ...f.rel.split("/")); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, fs.readFileSync(f.abs), { mode: 0o644 }); }
    const w = walk(dest); return w.ok ? hashFiles(w.files) : null;
  }
  function disableIfEnabled(id) { try { pluginManager?.disable?.(id); } catch { /* manager unavailable: the plugin is still new code that must be enabled by the owner */ } }
  function archiveCurrent(id) {
    const cur = readInstalled(id); if (!cur?.hash) return null;
    const name = cur.manifest.version + "__" + cur.hash.slice(0, 12), dest = path.join(keptRoot, id, name);
    fs.mkdirSync(path.join(keptRoot, id), { recursive: true }); rmrf(dest); fs.renameSync(installedDir(id), dest);
    const all = keptList(id); for (const old of all.slice(0, Math.max(0, all.length - INSTALL_LIMITS.maxKeptVersions))) rmrf(path.join(keptRoot, id, old));
    return name;
  }

  /**
   * Install or upgrade. Needs the OWNER's signed approval for action PLUGIN_INSTALL and subject "<id>@<version>#<hash>".
   * Same-or-lower version is refused (use rollback for going back): an install can never silently downgrade.
   */
  function install(dir, { ownerApproval = null } = {}) {
    const deny = (reason, extra = {}) => { audit.append("PLUGIN_INSTALL_REFUSED", { reason, ...extra }); return { ok: false, reason, ...extra }; };
    if (stopped()) return deny("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    const p = inspectPackage(dir); if (!p.ok) return deny("PACKAGE_REJECTED", { problems: p.problems.slice(0, 10), id: p.id ?? null });
    const m = p.manifest, cur = readInstalled(m.id);
    if (cur && cmpV(m.version, cur.manifest.version) <= 0) return deny("NOT_A_NEWER_VERSION", { id: m.id, installed: cur.manifest.version, offered: m.version });
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "PLUGIN_INSTALL", subject: p.subject });
    if (!v.allowed) return deny("OWNER_APPROVAL_REQUIRED:" + v.reason, { id: m.id, subject: p.subject });
    // approval is spent; from here on any failure leaves the previous version untouched or restored
    const stage = path.join(staging, m.id + "-" + Date.now().toString(36));
    try {
      const w = walk(dir); if (!w.ok || hashFiles(w.files) !== p.hash) { rmrf(stage); return deny("PACKAGE_CHANGED_DURING_INSTALL", { id: m.id }); }
      const copyHash = copyOut(w.files, stage); if (copyHash !== p.hash) { rmrf(stage); return deny("COPY_VERIFICATION_FAILED", { id: m.id }); }
      const archived = cur ? archiveCurrent(m.id) : null;
      try { fs.renameSync(stage, installedDir(m.id)); }
      catch (e) { if (archived) { try { fs.renameSync(path.join(keptRoot, m.id, archived), installedDir(m.id)); } catch { /* best effort restore */ } } rmrf(stage); return deny("SWAP_FAILED", { id: m.id }); }
    } catch (e) { rmrf(stage); return deny("INSTALL_ERROR", { id: m.id, error: String(e.message).slice(0, 100) }); }
    disableIfEnabled(m.id);
    audit.append("PLUGIN_INSTALLED", { id: m.id, version: m.version, hash: p.hash, previous: cur?.manifest.version ?? null, permissions: m.permissions });
    return { ok: true, id: m.id, version: m.version, hash: p.hash, previous: cur?.manifest.version ?? null, enabled: false, note: "Installed DISABLED. Enabling still needs the owner's PLUGIN_ENABLE approval." };
  }

  /** Versions kept for rollback (newest last). */
  function versions(id) {
    if (!ID_RE.test(String(id))) return { ok: false, reason: "BAD_ID" };
    const cur = readInstalled(id);
    return { ok: true, id, installed: cur ? { version: cur.manifest.version, hash: cur.hash } : null, kept: keptList(id).map(n => { const [version, h] = n.split("__"); return { version, hashPrefix: h }; }) };
  }
  /** Go back to a kept version. Needs PLUGIN_ROLLBACK approval for subject "<id>@<version>#<hash>" of the KEPT copy; the replaced version is itself archived (rollback is reversible). */
  function rollback(id, version, { ownerApproval = null } = {}) {
    const deny = (reason, extra = {}) => { audit.append("PLUGIN_ROLLBACK_REFUSED", { id: String(id).slice(0, 49), reason, ...extra }); return { ok: false, reason, ...extra }; };
    if (stopped()) return deny("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    if (!ID_RE.test(String(id)) || !ver(version)) return deny("BAD_ARGUMENTS");
    const name = keptList(id).filter(n => n.startsWith(version + "__")).pop(); if (!name) return deny("VERSION_NOT_KEPT", { version });
    const src = path.join(keptRoot, id, name), w = walk(src); if (!w.ok) return deny("KEPT_COPY_INVALID");
    const hash = hashFiles(w.files), mf = JSON.parse(fs.readFileSync(path.join(src, "plugin.json"), "utf8"));
    if (mf.id !== id || mf.version !== version || !validateManifest(mf, { atlaszVersion }).ok) return deny("KEPT_COPY_INVALID");
    if (name.split("__")[1] !== hash.slice(0, 12)) return deny("KEPT_COPY_TAMPERED");
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "PLUGIN_ROLLBACK", subject: subjectOf(mf, hash) });
    if (!v.allowed) return deny("OWNER_APPROVAL_REQUIRED:" + v.reason, { subject: subjectOf(mf, hash) });
    const stage = path.join(staging, id + "-rb-" + Date.now().toString(36));
    try {
      if (copyOut(w.files.map(f => ({ rel: f.rel, abs: f.abs })), stage) !== hash) { rmrf(stage); return deny("COPY_VERIFICATION_FAILED"); }
      const cur = readInstalled(id); if (cur?.hash && cur.hash === hash) { rmrf(stage); return deny("ALREADY_INSTALLED"); }
      const archived = cur ? archiveCurrent(id) : null;
      try { fs.renameSync(stage, installedDir(id)); } catch { if (archived) { try { fs.renameSync(path.join(keptRoot, id, archived), installedDir(id)); } catch { /* best effort */ } } rmrf(stage); return deny("SWAP_FAILED"); }
    } catch (e) { rmrf(stage); return deny("ROLLBACK_ERROR", { error: String(e.message).slice(0, 100) }); }
    rmrf(src);                                                                      // the restored copy now lives in the plugin root
    disableIfEnabled(id);
    audit.append("PLUGIN_ROLLED_BACK", { id, version, hash });
    return { ok: true, id, version, hash, enabled: false };
  }
  /** The exact subject the owner must sign to roll back to a kept version (so a UI can sign without guessing). */
  function rollbackSubject(id, version) {
    if (!ID_RE.test(String(id)) || !ver(version)) return null;
    const name = keptList(id).filter(n => n.startsWith(version + "__")).pop(); if (!name) return null;
    const src = path.join(keptRoot, id, name), w = walk(src); if (!w.ok) return null;
    try { return subjectOf(JSON.parse(fs.readFileSync(path.join(src, "plugin.json"), "utf8")), hashFiles(w.files)); } catch { return null; }
  }
  /** Remove a plugin (kept versions stay for a later rollback). */
  function uninstall(id, { ownerApproval = null } = {}) {
    const deny = (reason) => { audit.append("PLUGIN_UNINSTALL_REFUSED", { id: String(id).slice(0, 49), reason }); return { ok: false, reason }; };
    if (stopped()) return deny("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    if (!ID_RE.test(String(id))) return deny("BAD_ID");
    const cur = readInstalled(id); if (!cur) return deny("NOT_INSTALLED");
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "PLUGIN_UNINSTALL", subject: id });
    if (!v.allowed) return deny("OWNER_APPROVAL_REQUIRED:" + v.reason);
    disableIfEnabled(id); archiveCurrent(id);
    audit.append("PLUGIN_UNINSTALLED", { id, version: cur.manifest.version }); return { ok: true, id };
  }
  return { inspectPackage, install, versions, rollback, rollbackSubject, uninstall, audit: () => audit.entries?.() ?? [], auditVerify: () => audit.verify?.() ?? { ok: true }, limits: INSTALL_LIMITS, nameOk: n => NAME_OK.test(String(n)) };
}
