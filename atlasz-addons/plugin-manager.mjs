// V7.3 §22: plugins / extensions / themes / skins with manifests, permissions, versioning, enable/disable, health, failure isolation.
// Safety model (honest): plugin CODE never runs in the ATLASZ core process. Each hook call is a short-lived child process
// (stdin JSON -> stdout JSON, minimal env with NO secrets, timeout). A crash/timeout/garbage output is contained, counted,
// and after N consecutive failures the plugin is QUARANTINED. This is process isolation, not an OS sandbox.
// Themes/skins are DATA ONLY (whitelisted CSS variables), never code or raw CSS.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { restrictedNodeCommand } from "./restricted-node.mjs";
import { satisfies, parseVersion } from "./update-center.mjs";
import { createAuditChain } from "./audit-chain.mjs";
import { okName, own } from "./safe-keys.mjs";
import { scrub } from "./secret-patterns.mjs";

export const PLUGIN_KINDS = Object.freeze(["PLUGIN", "EXTENSION", "MODULE", "THEME", "SKIN"]);
export const GRANTABLE_PERMISSIONS = Object.freeze(["READ_STATE", "WRITE_STATE", "NETWORK", "EXTERNAL_ACTION", "FILESYSTEM_PLUGIN_DIR", "UI_THEME"]);
export const FORBIDDEN_PERMISSIONS = Object.freeze(["SECRETS", "SPEND", "OWNER_AUTH", "AUDIT_WRITE", "KILL_SWITCH", "PAYMENTS", "BANKING"]);
const THEME_VAR = /^--[a-z][a-z0-9-]{0,40}$/, THEME_VALUE = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|[a-zA-Z]{3,20}|\d{1,3}(\.\d+)?(px|rem|em|%))$/;
const MAX_OUT = 256 * 1024;

export function validateManifest(m, { atlaszVersion = "7.3.0" } = {}) {
  const problems = [];
  if (!m || typeof m !== "object") return { ok: false, problems: ["MANIFEST_NOT_OBJECT"] };
  if (m.schema !== 1) problems.push("UNSUPPORTED_SCHEMA");
  if (typeof m.id !== "string" || !okName(/^[a-z][a-z0-9-]{1,48}$/, m.id)) problems.push("BAD_ID");
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
  return { ok: problems.length === 0, problems: problems.map(x => scrub(String(x)).slice(0, 200)) };      // problem texts quote manifest values: never a credential, never unbounded
}

/** Content hash of a plugin folder (names + bytes). null = too large, unreadable or CONTAINS A SYMLINK: such a plugin is never approved or run. */
function dirHash(dir) {
  const h = crypto.createHash("sha256"); let files = 0, bytes = 0;
  const walkDir = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
    const abs = path.join(d, e.name), r = rel + "/" + e.name;
    if (e.isSymbolicLink()) throw new Error("SYMLINK_IN_PLUGIN");   // a link can point outside the folder and its target is not covered by the hash: such a plugin is never approved or run
    if (e.isDirectory()) { h.update("D:" + r + "\0"); walkDir(abs, r); continue; }
    if (!e.isFile()) { h.update("S:" + r + "\0"); continue; }
    if (++files > 500) throw new Error("TOO_MANY"); const b = fs.readFileSync(abs); bytes += b.length; if (bytes > 20 * 1024 * 1024) throw new Error("TOO_BIG");
    h.update("F:" + r + "\0" + b.length + "\0"); h.update(b);
  } };
  try { walkDir(dir, ""); return h.digest("hex"); } catch { return null; }
}
export function createPluginManager({ roots = [], stateDir, ownerAuth, atlaszVersion = "7.3.0", nodeBin = process.execPath, hookTimeoutMs = 5000, quarantineAfter = 3, isStopped = () => false, now = () => new Date().toISOString() } = {}) {
  if (!stateDir || !ownerAuth) throw new Error("STATE_DIR_AND_OWNER_AUTH_REQUIRED");
  fs.mkdirSync(stateDir, { recursive: true });
  const stateFile = path.join(stateDir, "plugins-state.json");
  const audit = createAuditChain({ filePath: path.join(stateDir, "plugins-audit.jsonl"), now });
  let S = { enabled: {}, health: {}, theme: null };
  let unreadable = false;                                                                             // a state file we cannot read is evidence to keep, never to overwrite: everything stays disabled and nothing is written
  const memQuarantine = new Set();                                                                  // plugins quarantined in memory whose state write failed: they stay quarantined across re-reads
  /** Re-read the state file (another manager on the same directory may have changed it). A missing file means nothing is enabled. */
  function load() {
    if (!fs.existsSync(stateFile)) { S = { enabled: {}, health: {}, theme: null }; unreadable = false; }
    else {
      try { const j = JSON.parse(fs.readFileSync(stateFile, "utf8")); if (j === null || typeof j !== "object" || Array.isArray(j) || (j.enabled !== undefined && (typeof j.enabled !== "object" || j.enabled === null || Array.isArray(j.enabled))) || (j.health !== undefined && (typeof j.health !== "object" || j.health === null || Array.isArray(j.health)))) throw new Error("SHAPE"); S = { enabled: {}, health: {}, theme: null, ...j }; for (const k of ["enabled", "health"]) for (const id of Object.keys(S[k])) if (S[k][id] === null || typeof S[k][id] !== "object" || Array.isArray(S[k][id])) { if (k === "health") S.health[id] = { failures: 0 }; else delete S.enabled[id]; } unreadable = false; }
      catch { unreadable = true; S = { enabled: {}, health: {}, theme: null }; }
    }
    for (const id of memQuarantine) { delete S.enabled[id]; if (S.theme === id) S.theme = null; S.health[id] = { ...(own(S.health, id) ?? {}), failures: (own(S.health, id)?.failures ?? 0), quarantined: true }; }
  }
  load();
  const STATE_BAD = { ok: false, reason: "STATE_UNREADABLE:plugins-state.json" };
  const save = () => { if (unreadable) return true; try { const t = stateFile + ".tmp"; fs.writeFileSync(t, JSON.stringify(S)); fs.renameSync(t, stateFile); memQuarantine.clear(); return true; } catch { return false; } };   // an unwritable state dir is reported (false), never thrown into a timer or child callback
  const approve = (ap, action, subject) => ownerAuth.verifyApproval(ap, { action, subject });

  function scan() {
    const found = new Map(), rejected = [];
    for (const root of roots) {
      let ents; try { if (!fs.existsSync(root)) continue; ents = fs.readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory()); } catch { rejected.push({ dir: String(root), problems: ["ROOT_UNREADABLE"] }); continue; }
      for (const e of ents) {
        const dir = path.join(root, e.name), mf = path.join(dir, "plugin.json");
        if (!fs.existsSync(mf)) continue;
        let m; try { m = JSON.parse(fs.readFileSync(mf, "utf8")); } catch { rejected.push({ dir, problems: ["MANIFEST_NOT_JSON"] }); continue; }
        const v = validateManifest(m, { atlaszVersion });
        if (!v.ok) { rejected.push({ dir, id: m?.id ?? null, problems: v.problems }); continue; }
        if (m.entry && !fs.existsSync(path.join(dir, m.entry))) { rejected.push({ dir, id: m.id, problems: ["ENTRY_FILE_MISSING"] }); continue; }
        if (found.has(m.id)) { rejected.push({ dir, id: m.id, problems: ["DUPLICATE_ID"] }); continue; }
        if (dirHash(dir) === null) { rejected.push({ dir, id: m.id, problems: ["UNHASHABLE_OR_SYMLINK_IN_FOLDER"] }); continue; }
        found.set(m.id, { manifest: m, dir });
      }
    }
    return { found, rejected };
  }
  function status(id, p) {
    const h = own(S.health, id) ?? { failures: 0 };
    if (h.quarantined) return "QUARANTINED";
    if (!own(S.enabled, id)) return "DISABLED";
    return h.failures > 0 ? "DEGRADED" : "ENABLED";
  }
  function list() {
    load();
    const { found, rejected } = scan();
    return { plugins: [...found.values()].map(({ manifest: m }) => ({ id: m.id, name: m.name, version: m.version, kind: m.kind, permissions: m.permissions, status: status(m.id), failures: S.health[m.id]?.failures ?? 0, lastError: S.health[m.id]?.lastError ?? null, activeTheme: S.theme === m.id })),
      rejected, activeTheme: S.theme, ...(unreadable ? { stateProblem: "STATE_UNREADABLE:plugins-state.json (kept as found; all plugins stay disabled until the owner repairs or removes the file)" } : {}), note: "Plugin code runs in isolated child processes with no secrets; themes are data only." };
  }
  function enable(id, { ownerApproval = null } = {}) {
    load();
    if (unreadable) return STATE_BAD;
    const p = scan().found.get(id); if (!p) return { ok: false, reason: "UNKNOWN_PLUGIN" };
    if (own(S.health, id)?.quarantined) return { ok: false, reason: "QUARANTINED_RESET_REQUIRES_OWNER_APPROVAL" };
    const codeLess = p.manifest.kind === "THEME" || p.manifest.kind === "SKIN";
    let stopped = true; try { stopped = Boolean(isStopped()); } catch { /* fail closed */ } if (stopped && !codeLess) return { ok: false, reason: "OWNER_STOP_OR_SAFE_MODE_ACTIVE" };
    const hash = codeLess ? null : dirHash(p.dir); if (!codeLess && !hash) return { ok: false, reason: "PLUGIN_FOLDER_UNHASHABLE" };
    if (!codeLess) { const v = approve(ownerApproval, "PLUGIN_ENABLE", id + "#" + hash); if (!v.allowed) return { ok: false, reason: "OWNER_APPROVAL_REQUIRED:" + v.reason, subject: id + "#" + hash }; }   // the owner approves these exact bytes, not just a name
    const snap = structuredClone(S); S.enabled[id] = { since: now(), version: p.manifest.version, permissions: p.manifest.permissions, ...(hash ? { hash } : {}) }; S.health[id] = { failures: 0 };
    return commit("PLUGIN_ENABLED", { id, version: p.manifest.version, permissions: p.manifest.permissions }, snap);
  }
  /** What the owner signs for PLUGIN_ENABLE: the plugin id and the content hash of its folder as it is now (a code-less theme needs no approval). */
  const enableSubject = id => { const p = scan().found.get(id); if (!p || p.manifest.kind === "THEME" || p.manifest.kind === "SKIN") return null; const h = dirHash(p.dir); return h ? id + "#" + h : null; };
  function disable(id) { load(); if (unreadable) return STATE_BAD; if (!own(S.enabled, id)) return { ok: true, already: true }; const snap = structuredClone(S); delete S.enabled[id]; if (S.theme === id) S.theme = null; return commit("PLUGIN_DISABLED", { id }, snap); }
  function resetQuarantine(id, { ownerApproval = null } = {}) {
    load();
    if (unreadable) return STATE_BAD;
    const v = approve(ownerApproval, "PLUGIN_RESET_QUARANTINE", id); if (!v.allowed) return { ok: false, reason: "OWNER_APPROVAL_REQUIRED:" + v.reason };
    const snap = structuredClone(S), wasMem = memQuarantine.delete(id); S.health[id] = { failures: 0 }; const rr = commit("PLUGIN_QUARANTINE_RESET", { id }, snap); if (!rr.ok && wasMem) { memQuarantine.add(id); load(); } return rr;
  }
  /** Audit write that cannot throw into timers/child callbacks: a failed audit (corrupt or unwritable log) is reported as false, never as an uncaught exception. */
  const rec = (e, d) => { try { audit.append(e, d); return true; } catch { return false; } };
  /** Persist a management change: audit first, then state; if either cannot be written the in-memory change is rolled back (never an enabled-in-memory plugin the disk does not know about). */
  const commit = (ev, data, snap) => { let ok = true; try { audit.append(ev, data); } catch { ok = false; } if (ok && !save()) ok = false; if (!ok) { S = snap; rec("PLUGIN_CHANGE_NOT_APPLIED", { event: ev, id: data?.id ?? null }); return { ok: false, reason: "STATE_NOT_WRITTEN_OR_AUDIT_UNAVAILABLE" }; } return { ok: true }; };
  function fail(id, why) {
    load();
    const h = (Object.hasOwn(S.health, id) ? S.health[id] : (S.health[id] = { failures: 0 })); h.failures++; h.lastError = scrub(String(why)).slice(0, 200);
    if (h.failures >= quarantineAfter) { h.quarantined = true; memQuarantine.add(id); delete S.enabled[id]; if (S.theme === id) S.theme = null; rec("PLUGIN_QUARANTINED", { id, why: h.lastError }); }
    else rec("PLUGIN_FAILURE", { id, why: h.lastError });
    save();
  }
  /** Invoke a hook inside an isolated child process. NEVER throws into the caller. */
  function invoke(id, hook, input = {}) {
    return new Promise(resolve => { try { run(resolve); } catch { resolve({ ok: false, reason: "INVOKE_FAILED" }); } });      // NEVER throws or rejects: any failure while starting is a result
    function run(resolve) {
      load();
      try { audit.reload(); } catch { return resolve({ ok: false, reason: "AUDIT_UNAVAILABLE" }); }       // no hook runs when its run cannot be audited
      const p = scan().found.get(id);
      if (!p || !own(S.enabled, id) || own(S.health, id)?.quarantined) return resolve({ ok: false, reason: !p ? "UNKNOWN_PLUGIN" : "NOT_ENABLED" });
      if (!p.manifest.entry) return resolve({ ok: false, reason: "NO_CODE_ENTRY" });
      { let st = true; try { st = Boolean(isStopped()); } catch { /* fail closed */ } if (st) { rec("PLUGIN_HOOK_NOT_RUN", { id, reason: "OWNER_STOP_OR_SAFE_MODE_ACTIVE" }); return resolve({ ok: false, reason: "OWNER_STOP_OR_SAFE_MODE_ACTIVE" }); } }
      { const en = own(S.enabled, id), now0 = dirHash(p.dir); if (!en?.hash || now0 !== en.hash) { rec("PLUGIN_HOOK_NOT_RUN", { id, reason: "CODE_CHANGED_SINCE_ENABLE" }); return resolve({ ok: false, reason: "CODE_CHANGED_SINCE_ENABLE" }); } }   // only the exact code the owner enabled ever runs
      let payload; try { payload = JSON.stringify({ hook, input }); } catch { return resolve({ ok: false, reason: "INPUT_NOT_SERIALISABLE" }); }
      if (!rec("PLUGIN_HOOK_STARTED", { id, hook: String(hook).slice(0, 40) })) return resolve({ ok: false, reason: "AUDIT_UNAVAILABLE" });      // a hook only runs when its start can be audited
      let out = "", err = "", done = false, timer = null;
      const finish = r => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
      let child;
      // Least privilege (ATLASZ-T3-002): read-only access to the plugin's own directory; write access only with the granted FILESYSTEM_PLUGIN_DIR permission; no network unless NETWORK
      // was granted at enable time; no child processes or workers (Node permission model). A host that cannot restrict Node does not run the hook at all (fails closed, no quarantine).
      const granted = own(S.enabled, id)?.permissions ?? [];
      const rc = restrictedNodeCommand({ nodeBin, script: path.join(p.dir, p.manifest.entry), readDirs: [p.dir], writeDirs: granted.includes("FILESYSTEM_PLUGIN_DIR") ? [p.dir] : [], allowNetwork: granted.includes("NETWORK"), requireNoNetwork: !granted.includes("NETWORK"), env: { ATLASZ_PLUGIN_ID: id, ATLASZ_PLUGIN_HOOK: String(hook) } });
      if (!rc.ok) { rec("PLUGIN_HOOK_NOT_RUN", { id, reason: rc.reason }); return finish({ ok: false, reason: rc.reason }); }
      try { child = spawn(rc.cmd, rc.args, { cwd: p.dir, env: rc.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true }); }
      catch (e) { fail(id, "SPAWN_FAILED:" + e.message); return finish({ ok: false, reason: "SPAWN_FAILED" }); }
      timer = setTimeout(() => { child.kill("SIGKILL"); fail(id, "TIMEOUT"); finish({ ok: false, reason: "TIMEOUT" }); }, hookTimeoutMs);
      child.stdout.on("data", d => { if (done) return; out += d; if (out.length > MAX_OUT) { child.kill("SIGKILL"); fail(id, "OUTPUT_TOO_LARGE"); finish({ ok: false, reason: "OUTPUT_TOO_LARGE" }); } });
      child.stderr.on("data", d => { if (err.length < 2000) err += d; });
      child.on("error", e => { fail(id, "PROCESS_ERROR:" + e.message); finish({ ok: false, reason: "PROCESS_ERROR" }); });
      child.on("close", code => {
        if (done) return;
        if (code !== 0) { fail(id, "EXIT_" + code + ":" + err.split("\n")[0]); return finish({ ok: false, reason: "PLUGIN_CRASHED", exit: code }); }
        try { const r = JSON.parse(out); load(); if (own(S.health, id) && !unreadable) S.health[id].failures = 0; rec("PLUGIN_HOOK_RUN", { id, hook: String(hook).slice(0, 40) }); save(); finish({ ok: true, result: r }); }
        catch { fail(id, "INVALID_JSON_OUTPUT"); finish({ ok: false, reason: "INVALID_OUTPUT" }); }
      });
      child.stdin.on("error", () => {}); child.stdin.end(payload);
    }
  }
  function setTheme(id) {
    load();
    if (unreadable) return STATE_BAD;
    if (id === null) { const snap = structuredClone(S); S.theme = null; return commit("THEME_CLEARED", {}, snap); }
    const p = scan().found.get(id); if (!p || !["THEME", "SKIN"].includes(p.manifest.kind)) return { ok: false, reason: "NOT_A_THEME" };
    const snap = structuredClone(S); S.theme = id; S.enabled[id] ??= { since: now(), version: p.manifest.version, permissions: ["UI_THEME"] }; return commit("THEME_SET", { id }, snap);
  }
  function activeTheme() { load(); if (!S.theme) return { id: null, variables: {} }; const p = scan().found.get(S.theme); return p ? { id: S.theme, name: p.manifest.name, variables: p.manifest.variables } : { id: null, variables: {} }; }
  return { scan: () => { const s = scan(); return { found: [...s.found.keys()], rejected: s.rejected }; }, list, enable, enableSubject, disable, resetQuarantine, invoke, setTheme, activeTheme, auditVerify: () => audit.verify(), validateManifest };
}
