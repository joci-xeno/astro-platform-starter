// V7.3 §10 / §40: REAL, locally testable Update Center adapters for offline update packages (no network, no spend).
// Package layout (a directory in the update inbox):
//   manifest.json  { schema:1, componentId, version, riskTags:[...], breaking?, requires?, minNode?, notes?, files:{ "rel/path": "<sha256>" }, remove?:["rel/path"] }
//   payload/...    exactly the files listed in manifest.files (no extras, no symlinks)
// The sandbox for update self-tests is PROCESS-LEVEL only (own cwd, minimal env, timeout); it is not an OS sandbox.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { restrictedNodeCommand } from "./restricted-node.mjs";
import { parseVersion } from "./update-center.mjs";

// Detector for the quarantined legacy policy marker. Built from parts so this scanner is not itself a carrier of the marker.
const LEGACY_MARKER = new RegExp("atlasz-" + "competition", "i");
export const INSTALL_MANIFEST = ".atlasz-install-manifest.json";
export const SELFTEST = "atlasz-update-selftest.mjs";
const MAX_FILE = 2 * 1024 * 1024, MAX_FILES = 2000;
const SECRET_PATTERNS = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /(?<![A-Za-z0-9])sk-[A-Za-z0-9]{20,}/, /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}\b/, /(?<![A-Za-z0-9])ghp_[A-Za-z0-9]{30,}/, /(?<![A-Za-z0-9])xox[bp]-[A-Za-z0-9-]{20,}/, /\bsk_live_[A-Za-z0-9]{8,}/];
const sha = buf => createHash("sha256").update(buf).digest("hex");
const safeRel = rel => typeof rel === "string" && rel.length > 0 && !path.isAbsolute(rel) && !rel.split(/[\\/]/).some(p => p === ".." || p === "") && !rel.includes("\0");
const inside = (root, p) => { const r = path.resolve(root), t = path.resolve(p); return t === r || t.startsWith(r + path.sep); };

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.name === "node_modules" || e.name === ".git") continue;
    if (e.isDirectory()) walk(p, base, out); else out.push({ rel: path.relative(base, p).split(path.sep).join("/"), abs: p, symlink: e.isSymbolicLink() });
  }
  return out;
}

/** Validate one package directory. Returns {ok, manifest, problems}. */
export function validatePackage(pkgDir) {
  const problems = [];
  const mf = path.join(pkgDir, "manifest.json");
  if (!fs.existsSync(mf)) return { ok: false, problems: ["MANIFEST_MISSING"] };
  let m; try { m = JSON.parse(fs.readFileSync(mf, "utf8")); } catch { return { ok: false, problems: ["MANIFEST_NOT_JSON"] }; }
  if (m.schema !== 1) problems.push("UNSUPPORTED_SCHEMA");
  if (typeof m.componentId !== "string" || !/^[\w.-]+$/.test(m.componentId)) problems.push("BAD_COMPONENT_ID");
  if (!parseVersion(m.version)) problems.push("BAD_VERSION");
  if (!Array.isArray(m.riskTags)) problems.push("RISK_TAGS_REQUIRED");             // unassessed risk is treated as HIGH by the Update Center
  if (!m.files || typeof m.files !== "object" || Array.isArray(m.files) || Object.keys(m.files).length === 0) problems.push("FILES_REQUIRED");
  if (m.remove !== undefined && (!Array.isArray(m.remove) || !m.remove.every(safeRel))) problems.push("BAD_REMOVE_LIST");
  if (problems.length) return { ok: false, manifest: m, problems };
  const payload = path.join(pkgDir, "payload");
  if (!fs.existsSync(payload)) return { ok: false, manifest: m, problems: ["PAYLOAD_MISSING"] };
  const present = walk(payload);
  if (present.length > MAX_FILES) problems.push("TOO_MANY_FILES");
  for (const f of present) if (f.symlink) problems.push("SYMLINK_NOT_ALLOWED:" + f.rel);
  const declared = new Set(Object.keys(m.files));
  for (const rel of declared) {
    if (!safeRel(rel)) { problems.push("UNSAFE_PATH:" + rel); continue; }
    const abs = path.join(payload, rel);
    if (!inside(payload, abs) || !fs.existsSync(abs)) { problems.push("FILE_MISSING:" + rel); continue; }
    const st = fs.statSync(abs); if (st.size > MAX_FILE) { problems.push("FILE_TOO_LARGE:" + rel); continue; }
    if (sha(fs.readFileSync(abs)) !== m.files[rel]) problems.push("HASH_MISMATCH:" + rel);
  }
  for (const f of present) if (!declared.has(f.rel)) problems.push("UNDECLARED_FILE:" + f.rel);
  return { ok: problems.length === 0, manifest: m, problems };
}

export function createLocalUpdateAdapters({ inboxDir, nodeBin = process.execPath, selftestTimeoutMs = 60000 } = {}) {
  if (!inboxDir) throw new Error("INBOX_DIR_REQUIRED");
  let lastScan = { at: null, valid: [], rejected: [] };
  const scan = () => {
    const valid = [], rejected = [];
    if (fs.existsSync(inboxDir)) for (const e of fs.readdirSync(inboxDir, { withFileTypes: true }).filter(x => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const dir = path.join(inboxDir, e.name), v = validatePackage(dir);
      (v.ok ? valid : rejected).push(v.ok ? { dir, manifest: v.manifest } : { dir, problems: v.problems });
    }
    lastScan = { at: new Date().toISOString(), valid: valid.map(x => ({ dir: x.dir, componentId: x.manifest.componentId, version: x.manifest.version })), rejected };
    return valid;
  };
  const find = (componentId, version) => scan().find(p => p.manifest.componentId === componentId && p.manifest.version === version) ?? null;

  async function detector() {
    return scan().map(({ dir, manifest: m }) => ({ componentId: m.componentId, version: m.version, riskTags: m.riskTags, breaking: m.breaking === true, requires: m.requires ?? {}, minNode: m.minNode ?? null, notes: m.notes ?? null, source: "local:" + path.basename(dir) }));
  }
  async function stager({ update, stagingDir }) {
    const pkg = find(update.componentId, update.version);                       // re-validated (hashes) at staging time, not trusted from detection
    if (!pkg) return { ok: false, evidence: "PACKAGE_NOT_FOUND_OR_INVALID" };
    const payload = path.join(pkg.dir, "payload"), written = {};
    for (const rel of Object.keys(pkg.manifest.files)) {
      const dst = path.join(stagingDir, rel);
      if (!inside(stagingDir, dst)) return { ok: false, evidence: "PATH_ESCAPE:" + rel };
      fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(payload, rel), dst); written[rel] = pkg.manifest.files[rel];
    }
    let removed = 0;
    for (const rel of pkg.manifest.remove ?? []) { const dst = path.join(stagingDir, rel); if (inside(stagingDir, dst) && fs.existsSync(dst)) { fs.rmSync(dst); removed++; } }
    const all = {}; for (const f of walk(stagingDir)) if (f.rel !== INSTALL_MANIFEST) all[f.rel] = sha(fs.readFileSync(f.abs));
    fs.writeFileSync(path.join(stagingDir, INSTALL_MANIFEST), JSON.stringify({ componentId: update.componentId, version: update.version, files: all }, null, 1));
    return { ok: true, evidence: { files: Object.keys(written).length, removed, installManifest: true } };
  }
  function verifyInstallManifest(dir) {
    const f = path.join(dir, INSTALL_MANIFEST); if (!fs.existsSync(f)) return { ok: false, why: "NO_INSTALL_MANIFEST" };
    const m = JSON.parse(fs.readFileSync(f, "utf8")), bad = [];
    for (const [rel, h] of Object.entries(m.files)) { const p = path.join(dir, rel); if (!fs.existsSync(p) || sha(fs.readFileSync(p)) !== h) bad.push(rel); }
    return { ok: bad.length === 0, why: bad.length ? "MODIFIED_OR_MISSING:" + bad.join(",") : null, version: m.version };
  }
  async function tester({ dir, phase }) {
    const st = path.join(dir, SELFTEST);
    if (fs.existsSync(st)) {
      // Least privilege (ATLASZ-T3-002): the self-test is code from the update package, so it runs under Node's permission model - it may read its own package directory and
      // nothing else, cannot spawn processes, and (where the host supports it) has no network. If the host cannot restrict Node the test is NOT run unrestricted: it fails closed.
      const rc = restrictedNodeCommand({ nodeBin, script: st, readDirs: [dir], requireHostIsolation: true, maxLifetimeSec: Math.ceil(selftestTimeoutMs / 1000) + 5, env: { ATLASZ_UPDATE_PHASE: phase, NODE_ENV: "test" } });
      if (!rc.ok) return { passed: false, evidence: { phase, selftest: SELFTEST, error: rc.reason, note: "Self-test not run: the host cannot restrict the child process (fails closed)" } };
      const r = spawnSync(rc.cmd, rc.args, { cwd: dir, timeout: selftestTimeoutMs, encoding: "utf8", env: rc.env });   // no inherited secrets
      return { passed: r.status === 0, evidence: { phase, selftest: SELFTEST, isolation: { level: rc.level, networkBlocked: rc.networkBlocked, filesystemRestricted: rc.filesystemRestricted }, exit: r.status, signal: r.signal, stdout: (r.stdout ?? "").slice(-300), stderr: (r.stderr ?? "").slice(-300) } };
    }
    const iv = verifyInstallManifest(dir);                                       // no selftest: only an integrity check is possible, and it is labelled as such
    if (iv.ok) return { passed: true, evidence: { phase, kind: "INTEGRITY_ONLY", note: "No self-test shipped; only file hashes verified", version: iv.version } };
    return { passed: false, evidence: { phase, error: "NO_SELFTEST_AND_" + iv.why } };
  }
  async function securityHealth({ dir }) {
    const findings = [], files = walk(dir);
    for (const f of files) {
      if (f.symlink) { findings.push({ severity: "HIGH", code: "SYMLINK", file: f.rel }); continue; }
      const size = fs.statSync(f.abs).size; if (size > MAX_FILE) { findings.push({ severity: "MEDIUM", code: "LARGE_FILE", file: f.rel }); continue; }
      if (!/\.(mjs|js|cjs|json|md|txt|css|html|ya?ml)$/i.test(f.rel)) continue;
      const text = fs.readFileSync(f.abs, "utf8");
      for (const p of SECRET_PATTERNS) if (p.test(text)) findings.push({ severity: "HIGH", code: "SECRET_PATTERN", file: f.rel });
      if (LEGACY_MARKER.test(text)) findings.push({ severity: "HIGH", code: "EXCLUDED_LEGACY_MARKER", file: f.rel });
      if (f.rel.endsWith("package.json")) { try { const s = JSON.parse(text).scripts ?? {}; for (const k of ["preinstall", "install", "postinstall"]) if (s[k]) findings.push({ severity: "HIGH", code: "INSTALL_SCRIPT:" + k, file: f.rel }); } catch { findings.push({ severity: "HIGH", code: "JSON_INVALID", file: f.rel }); } }
      else if (f.rel.endsWith(".json")) { try { JSON.parse(text); } catch { findings.push({ severity: "HIGH", code: "JSON_INVALID", file: f.rel }); } }
      if (/\.(mjs|js|cjs)$/i.test(f.rel)) {                                      // real health check: the staged code must at least parse
        const r = spawnSync(nodeBin, ["--check", f.abs], { encoding: "utf8", timeout: 20000 });
        if (r.status !== 0) findings.push({ severity: "HIGH", code: "SYNTAX_ERROR", file: f.rel, detail: (r.stderr ?? "").split("\n")[0].slice(0, 160) });
      }
    }
    return { ok: !findings.some(x => x.severity === "HIGH"), findings, scanned: files.length };
  }
  return { adapters: { detector, stager, tester, securityHealth }, lastScan: () => lastScan, validatePackage, verifyInstallManifest };
}

/** Helper for authors/tests: build a package directory from an object of files. */
export function buildPackage(destDir, { componentId, version, riskTags = [], breaking = false, requires = {}, minNode = null, notes = null, files, remove = [] }) {
  fs.mkdirSync(path.join(destDir, "payload"), { recursive: true });
  const hashes = {};
  for (const [rel, content] of Object.entries(files)) { const p = path.join(destDir, "payload", rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); hashes[rel] = sha(Buffer.from(content)); }
  fs.writeFileSync(path.join(destDir, "manifest.json"), JSON.stringify({ schema: 1, componentId, version, riskTags, breaking, requires, minNode, notes, files: hashes, remove }, null, 1));
  return destDir;
}
