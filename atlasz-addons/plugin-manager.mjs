// V7.3 §22: plugins / extensions / themes / skins with manifests, permissions, versioning, enable/disable, health, failure isolation.
// Safety model (honest): plugin CODE never runs in the ATLASZ core process. Each hook call is a short-lived child process
// (stdin JSON -> stdout JSON, minimal env with NO secrets, timeout). A crash/timeout/garbage output is contained, counted,
// and after N consecutive failures the plugin is QUARANTINED. This is process isolation, not an OS sandbox.
// Themes/skins are DATA ONLY (whitelisted CSS variables), never code or raw CSS.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { satisfies, parseVersion } from "./update-center.mjs";
import { createAuditChain } from "./audit-chain.mjs";

export const PLUGIN_KINDS = Object.freeze(["PLUGIN", "EXTENSION", "MODULE", "THEME", "SKIN"]);
export const GRANTABLE_PERMISSIONS = Object.freeze(["READ_STATE", "WRITE_STATE", "NETWORK", "EXTERNAL_ACTION", "FILESYSTEM_PLUGIN_DIR", "UI_THEME"]);
export const FORBIDDEN_PERMISSIONS = Object.freeze(["SECRETS", "SPEND", "OWNER_AUTH", "AUDIT_WRITE", "KILL_SWITCH", "PAYMENTS", "BANKING"]);
const THEME_VAR = /^--[a-z][a-z0-9-]{0,40}$/, THEME_VALUE = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|[a-zA-Z]{3,20}|\d{1,3}(\.\d+)?(px|rem|em|%))$/;
const MAX_OUT = 256 * 1024;

export function validateManifest(m, { atlaszVersion = "7.3.0" } = {}) {
  const problems = [];
  if (!m || typeof m !== "object") return { ok: false, problems: ["MANIFEST_NOT_OBJECT"] };
  if (m.schema !== 1) problems.push("UNSUPPORTED_SCHEMA");
  if (typeof m.id !== "string" || !/^[a-z][a-z0-9-]{1,48}$/.test(m.id)) problems.push("BAD_ID");
  if (typeof m.name !== "string" || !m.name) problems.push("NAME_REQUIRED");
  if (!parseVersion(m.version)) problems.push("BAD_VERSION");
  if (!PLUGIN_KINDS.includes(m.kind)) problems.push("BAD_KIND");
  if (!Array.isArray(m.permissions)) problems.push("PERMISSIONS_DECLARATION_REQUIRED");
  else for (const p of m.permissions) { if (FORBIDDEN_PERMISSIONS.includes(p)) problems.push("FORBIDDEN_PERMISSION:" + p); else if (!GRANTABLE_PERMISSIONS.includes(p)) problems.push("UNKNOWN_PERMISSION:" + p); }
  if (typeof m.atlaszCompat !== "string" || !satisfies(atlaszVersion, m.atlaszCompat)) problems.push("INCOMPATIBLE_WITH_ATLASZ:" + atlaszVersion + " !~ " + m.atlaszCompat);
  const isTheme = m.kind === "THEME" || m.kind === "SKIN";
  if (isTheme) {
    if (m.entry) problems.push("THEMES_CANNOT_CONTAIN_CODE");
    if (!m.variables || typeof m.variables !== "object") problems.push("THEME_VARIABLES_REQUIRED");
    else for (const [k, v] of Object.entries(m.variables)) if (!THEME_VAR.test(k) || !THEME_VALUE.test(String(v))) problems.push("UNSAFE_THEME_VARIABLE:" + k);
    if ((m.permissions ?? []).some(p => p !== "UI_THEME")) problems.push("THEME_PERMISSIONS_MUST_BE_UI_THEME_ONLY");
  } else if (typeof m.entry !== "string" || !/^[\w./-]+\.(mjs|js|cjs)$/.test(m.entry) || m.entry.includes("..") || path.isAbsolute(m.entry)) problems.push("ENTRY_REQUIRED_RELATIVE_JS");
  return { ok: problems.length === 0, problems };
}

export function createPluginManager({ roots = [], stateDir, ownerAuth, atlaszVersion = "7.3.0", nodeBin = process.execPath, hookTimeoutMs = 5000, quarantineAfter = 3, now = () => new Date().toISOString() } = {}) {
  if (!stateDir || !ownerAuth) throw new Error("STATE_DIR_AND_OWNER_AUTH_REQUIRED");
  fs.mkdirSync(stateDir, { recursive: true });
  const stateFile = path.join(stateDir, "plugins-state.json");
  const audit = createAuditChain({ filePath: path.join(stateDir, "plugins-audit.jsonl"), now });
  let S = { enabled: {}, health: {}, theme: null };
  if (fs.existsSync(stateFile)) { try { S = { ...S, ...JSON.parse(fs.readFileSync(stateFile, "utf8")) }; } catch { /* unreadable state: everything starts disabled (fail closed) */ } }
  const save = () => { const t = stateFile + ".tmp"; fs.writeFileSync(t, JSON.stringify(S)); fs.renameSync(t, stateFile); };
  const approve = (ap, action, subject) => ownerAuth.verifyApproval(ap, { action, subject });

  function scan() {
    const found = new Map(), rejected = [];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const e of fs.readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory())) {
        const dir = path.join(root, e.name), mf = path.join(dir, "plugin.json");
        if (!fs.existsSync(mf)) continue;
        let m; try { m = JSON.parse(fs.readFileSync(mf, "utf8")); } catch { rejected.push({ dir, problems: ["MANIFEST_NOT_JSON"] }); continue; }
        const v = validateManifest(m, { atlaszVersion });
        if (!v.ok) { rejected.push({ dir, id: m?.id ?? null, problems: v.problems }); continue; }
        if (m.entry && !fs.existsSync(path.join(dir, m.entry))) { rejected.push({ dir, id: m.id, problems: ["ENTRY_FILE_MISSING"] }); continue; }
        if (found.has(m.id)) { rejected.push({ dir, id: m.id, problems: ["DUPLICATE_ID"] }); continue; }
        found.set(m.id, { manifest: m, dir });
      }
    }
    return { found, rejected };
  }
  function status(id, p) {
    const h = S.health[id] ?? { failures: 0 };
    if (h.quarantined) return "QUARANTINED";
    if (!S.enabled[id]) return "DISABLED";
    return h.failures > 0 ? "DEGRADED" : "ENABLED";
  }
  function list() {
    const { found, rejected } = scan();
    return { plugins: [...found.values()].map(({ manifest: m }) => ({ id: m.id, name: m.name, version: m.version, kind: m.kind, permissions: m.permissions, status: status(m.id), failures: S.health[m.id]?.failures ?? 0, lastError: S.health[m.id]?.lastError ?? null, activeTheme: S.theme === m.id })),
      rejected, activeTheme: S.theme, note: "Plugin code runs in isolated child processes with no secrets; themes are data only." };
  }
  function enable(id, { ownerApproval = null } = {}) {
    const p = scan().found.get(id); if (!p) return { ok: false, reason: "UNKNOWN_PLUGIN" };
    if (S.health[id]?.quarantined) return { ok: false, reason: "QUARANTINED_RESET_REQUIRES_OWNER_APPROVAL" };
    const codeLess = p.manifest.kind === "THEME" || p.manifest.kind === "SKIN";
    if (!codeLess) { const v = approve(ownerApproval, "PLUGIN_ENABLE", id); if (!v.allowed) return { ok: false, reason: "OWNER_APPROVAL_REQUIRED:" + v.reason }; }
    S.enabled[id] = { since: now(), version: p.manifest.version, permissions: p.manifest.permissions }; S.health[id] = { failures: 0 };
    audit.append("PLUGIN_ENABLED", { id, version: p.manifest.version, permissions: p.manifest.permissions }); save(); return { ok: true };
  }
  function disable(id) { if (!S.enabled[id]) return { ok: true, already: true }; delete S.enabled[id]; if (S.theme === id) S.theme = null; audit.append("PLUGIN_DISABLED", { id }); save(); return { ok: true }; }
  function resetQuarantine(id, { ownerApproval = null } = {}) {
    const v = approve(ownerApproval, "PLUGIN_RESET_QUARANTINE", id); if (!v.allowed) return { ok: false, reason: "OWNER_APPROVAL_REQUIRED:" + v.reason };
    S.health[id] = { failures: 0 }; audit.append("PLUGIN_QUARANTINE_RESET", { id }); save(); return { ok: true };
  }
  function fail(id, why) {
    const h = (S.health[id] ??= { failures: 0 }); h.failures++; h.lastError = String(why).slice(0, 200);
    if (h.failures >= quarantineAfter) { h.quarantined = true; delete S.enabled[id]; if (S.theme === id) S.theme = null; audit.append("PLUGIN_QUARANTINED", { id, why: h.lastError }); }
    else audit.append("PLUGIN_FAILURE", { id, why: h.lastError });
    save();
  }
  /** Invoke a hook inside an isolated child process. NEVER throws into the caller. */
  function invoke(id, hook, input = {}) {
    return new Promise(resolve => {
      const p = scan().found.get(id);
      if (!p || !S.enabled[id] || S.health[id]?.quarantined) return resolve({ ok: false, reason: !p ? "UNKNOWN_PLUGIN" : "NOT_ENABLED" });
      if (!p.manifest.entry) return resolve({ ok: false, reason: "NO_CODE_ENTRY" });
      let out = "", err = "", done = false;
      const finish = r => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
      let child;
      try { child = spawn(nodeBin, [path.join(p.dir, p.manifest.entry)], { cwd: p.dir, env: { PATH: process.env.PATH ?? "", ATLASZ_PLUGIN_ID: id, ATLASZ_PLUGIN_HOOK: String(hook) }, stdio: ["pipe", "pipe", "pipe"] }); }
      catch (e) { fail(id, "SPAWN_FAILED:" + e.message); return finish({ ok: false, reason: "SPAWN_FAILED" }); }
      const timer = setTimeout(() => { child.kill("SIGKILL"); fail(id, "TIMEOUT"); finish({ ok: false, reason: "TIMEOUT" }); }, hookTimeoutMs);
      child.stdout.on("data", d => { out += d; if (out.length > MAX_OUT) { child.kill("SIGKILL"); fail(id, "OUTPUT_TOO_LARGE"); finish({ ok: false, reason: "OUTPUT_TOO_LARGE" }); } });
      child.stderr.on("data", d => { if (err.length < 2000) err += d; });
      child.on("error", e => { fail(id, "PROCESS_ERROR:" + e.message); finish({ ok: false, reason: "PROCESS_ERROR" }); });
      child.on("close", code => {
        if (done) return;
        if (code !== 0) { fail(id, "EXIT_" + code + ":" + err.split("\n")[0]); return finish({ ok: false, reason: "PLUGIN_CRASHED", exit: code }); }
        try { const r = JSON.parse(out); if (S.health[id]) S.health[id].failures = 0; save(); finish({ ok: true, result: r }); }
        catch { fail(id, "INVALID_JSON_OUTPUT"); finish({ ok: false, reason: "INVALID_OUTPUT" }); }
      });
      child.stdin.on("error", () => {}); child.stdin.end(JSON.stringify({ hook, input }));
    });
  }
  function setTheme(id) {
    if (id === null) { S.theme = null; audit.append("THEME_CLEARED", {}); save(); return { ok: true }; }
    const p = scan().found.get(id); if (!p || !["THEME", "SKIN"].includes(p.manifest.kind)) return { ok: false, reason: "NOT_A_THEME" };
    S.theme = id; S.enabled[id] ??= { since: now(), version: p.manifest.version, permissions: ["UI_THEME"] }; audit.append("THEME_SET", { id }); save(); return { ok: true };
  }
  function activeTheme() { if (!S.theme) return { id: null, variables: {} }; const p = scan().found.get(S.theme); return p ? { id: S.theme, name: p.manifest.name, variables: p.manifest.variables } : { id: null, variables: {} }; }
  return { scan: () => { const s = scan(); return { found: [...s.found.keys()], rejected: s.rejected }; }, list, enable, disable, resetQuarantine, invoke, setTheme, activeTheme, auditVerify: () => audit.verify(), validateManifest };
}
