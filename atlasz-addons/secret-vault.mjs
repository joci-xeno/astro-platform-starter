// ATLASZ Secret Vault (V7.3 §36). Encrypted-at-rest credential store.
// - AES-256-GCM, per-entry random IV, entry NAME bound as AAD (entries cannot be swapped between names).
// - The master key comes from the host (env ATLASZ_VAULT_KEY, base64 of 32 bytes) or a passed key. No key => LOCKED, fail closed.
// - Setting / deleting a credential is a credential change: it needs a signed owner approval (VAULT_SET / VAULT_DELETE).
// - Values are never written to logs/audit; list() returns names only; redact() scrubs known secrets from any text.
// - M1 (unified programme): lock()/unlock() with failure throttling, idle auto-lock (opt-in), revoke(), emergencyShutdown() that survives restart until an owner-approved resume,
//   encrypted backup package (separate passphrase, scrypt + AES-256-GCM, header bound as AAD) with verifyBackup()/restoreBackup() and per-entry metadata.
//   Raw values never reach agents: agents go through credential-broker.mjs.
// Honest limits: the master key must be protected by the host (Windows DPAPI / OS keychain in the Control Center);
// this module does not claim hardware-backed protection.
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { getDefaultOwnerAuth } from "./owner-auth.mjs";

export const VAULT_VERSION = "1";
const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const RESERVED = new Set(["__proto__", "prototype", "constructor", "__check__"]);
const CHECK_TEXT = "ATLASZ-VAULT-KEY-CHECK";
const BACKUP_FORMAT = "ATLASZ-VAULT-BACKUP";
const MAX_BACKUP_ENTRIES = 200;
const sha = t => createHash("sha256").update(t).digest("hex");

export function generateVaultKey() { return randomBytes(32).toString("base64"); }

/** Backup passphrase policy: long, not trivially repetitive, and never the vault key itself. */
export function checkBackupPassphrase(pass, keyB64 = null) {
  if (typeof pass !== "string" || pass.length < 16) return "PASSPHRASE_TOO_SHORT";
  if (pass.length > 256) return "PASSPHRASE_TOO_LONG";
  if (new Set(pass).size < 8) return "PASSPHRASE_TOO_REPETITIVE";
  if (keyB64 && pass === keyB64) return "PASSPHRASE_MUST_DIFFER_FROM_VAULT_KEY";
  return null;
}

export function createSecretVault({ dir, keyB64 = process.env.ATLASZ_VAULT_KEY || null, ownerAuth = getDefaultOwnerAuth(), idleLockMs = 0, nowFn = () => Date.now(), unlockMaxFailures = 5, unlockThrottleMs = 60000 } = {}) {
  if (!dir) throw new Error("VAULT_DIR_REQUIRED");
  if (!Number.isFinite(idleLockMs) || idleLockMs < 0) throw new Error("VAULT_IDLE_LOCK_INVALID");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "vault.enc.json");
  const audit = createAuditChain({ filePath: path.join(dir, "vault-audit.jsonl") });
  let key = null;
  if (keyB64) { const k = Buffer.from(keyB64, "base64"); if (k.length === 32) key = k; }
  let store = { version: VAULT_VERSION, entries: Object.create(null) };
  if (fs.existsSync(file)) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("VAULT_FILE_UNREADABLE"); }
    if (!parsed || parsed.version !== VAULT_VERSION || !parsed.entries || typeof parsed.entries !== "object" || Array.isArray(parsed.entries)) throw new Error("VAULT_FILE_INVALID");
    if (Object.keys(parsed.entries).some(n => RESERVED.has(n) || !NAME_RE.test(n))) throw new Error("VAULT_FILE_INVALID");      // JSON.parse makes "__proto__" an own key: refuse such files
    store = { ...parsed, entries: Object.assign(Object.create(null), parsed.entries) };
  }
  if (store.shutdown) { if (key) key.fill(0); key = null; }      // an emergency shutdown stays in force across restarts until an owner-approved resume
  let lastUse = nowFn(), failures = 0, throttledUntil = 0;
  const lockInternal = reason => { if (key) { key.fill(0); key = null; audit.append("VAULT_LOCKED", { reason }); } };
  const idle = () => { if (key && idleLockMs > 0 && nowFn() - lastUse > idleLockMs) lockInternal("IDLE_TIMEOUT"); };
  const locked = () => { idle(); return !key; };
  const need = () => { idle(); if (!key) throw new Error("VAULT_LOCKED_NO_KEY"); lastUse = nowFn(); };
  const active = n => Object.hasOwn(store.entries, n) && !store.entries[n].revokedAt && Boolean(store.entries[n].ct);
  const persist = () => {
    if (key && !store.check) store.check = encRaw("__check__", CHECK_TEXT);
    const tmp = file + ".tmp";
    const fd = fs.openSync(tmp, "w", 0o600);
    try { fs.writeSync(fd, JSON.stringify(store)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  };
  const encRaw = (name, value, k = key) => {
    const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", k, iv);
    c.setAAD(Buffer.from(name));
    const ct = Buffer.concat([c.update(Buffer.from(String(value), "utf8")), c.final()]);
    return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") };
  };
  const enc = (name, value) => ({ ...encRaw(name, value), updatedAt: new Date().toISOString() });
  const decWith = (name, e, k) => {
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(e.iv, "base64"));
    d.setAAD(Buffer.from(name)); d.setAuthTag(Buffer.from(e.tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(e.ct, "base64")), d.final()]).toString("utf8");
  };
  const dec = (name, e) => {
    try { return decWith(name, e, key); }
    catch { audit.append("VAULT_TAMPER_OR_WRONG_KEY", { name }); throw new Error("VAULT_ENTRY_TAMPERED_OR_WRONG_KEY"); }
  };
  const checkName = n => { if (!NAME_RE.test(String(n)) || RESERVED.has(String(n))) throw new Error("VAULT_INVALID_NAME"); };
  const approve = (ownerApproval, action, subject, deniedEvent, data = {}) => {
    const v = ownerAuth.verifyApproval(ownerApproval, { action, subject });
    if (!v.allowed) { audit.append(deniedEvent, { ...data, reason: v.reason }); throw new Error("OWNER_APPROVAL_REQUIRED:" + action); }
    return v;
  };
  const verifyKey = k => {
    if (store.check) { try { return decWith("__check__", store.check, k) === CHECK_TEXT; } catch { return false; } }
    const first = Object.entries(store.entries).find(([, e]) => e.ct);
    if (first) { try { decWith(first[0], first[1], k); return true; } catch { return false; } }
    return true;      // empty vault: nothing to check against yet
  };

  function set(name, value, { ownerApproval = null } = {}) {
    need(); checkName(name);
    if (typeof value !== "string" || !value) throw new Error("VAULT_VALUE_REQUIRED");
    approve(ownerApproval, "VAULT_SET", name, "VAULT_SET_DENIED", { name });
    const prev = Object.hasOwn(store.entries, name) ? store.entries[name] : null;
    const existed = Boolean(prev && prev.ct && !prev.revokedAt);
    store.entries[name] = { ...enc(name, value), createdAt: prev?.createdAt ?? new Date().toISOString(), rotations: existed ? (prev.rotations ?? 0) + 1 : 0 };
    persist();
    audit.append(existed ? "VAULT_ROTATED" : "VAULT_CREATED", { name, nonce: ownerApproval.nonce });
    return { name, rotated: existed };
  }
  function get(name, { purpose = "" } = {}) {
    need(); checkName(name);
    if (!purpose) throw new Error("VAULT_PURPOSE_REQUIRED");
    const e = Object.hasOwn(store.entries, name) ? store.entries[name] : null;
    if (!e) { audit.append("VAULT_MISS", { name, purpose }); return null; }
    if (e.revokedAt || !e.ct) { audit.append("VAULT_READ_REVOKED", { name, purpose }); throw new Error("VAULT_CREDENTIAL_REVOKED"); }
    const v = dec(name, e);
    audit.append("VAULT_READ", { name, purpose });   // the value is never logged
    return v;
  }
  function remove(name, { ownerApproval = null } = {}) {
    need(); checkName(name);
    approve(ownerApproval, "VAULT_DELETE", name, "VAULT_DELETE_DENIED", { name });
    if (!Object.hasOwn(store.entries, name)) return false;
    delete store.entries[name]; persist(); audit.append("VAULT_DELETED", { name, nonce: ownerApproval.nonce });
    return true;
  }
  /** Revocation destroys the value but keeps a tombstone (name, times, reason): readers get VAULT_CREDENTIAL_REVOKED instead of silently getting nothing. */
  function revoke(name, { ownerApproval = null, reason = "" } = {}) {
    need(); checkName(name);
    approve(ownerApproval, "VAULT_REVOKE", name, "VAULT_REVOKE_DENIED", { name });
    if (!active(name)) return false;
    const e = store.entries[name];
    store.entries[name] = { createdAt: e.createdAt ?? null, rotations: e.rotations ?? 0, revokedAt: new Date().toISOString(), reason: String(reason).slice(0, 120) };
    persist(); audit.append("VAULT_REVOKED", { name, reason: String(reason).slice(0, 120), nonce: ownerApproval.nonce });
    return true;
  }
  /** Every known secret value (and its URL-encoded / base64 forms) is removed from a piece of text (logs, errors, UI, API responses). */
  function redact(text) {
    let out = String(text ?? "");
    if (!key) return out;
    for (const [n, e] of Object.entries(store.entries)) {
      if (!e.ct) continue;
      let val; try { val = dec(n, e); } catch { continue; }
      if (val.length < 6) continue;
      for (const form of new Set([val, encodeURIComponent(val), Buffer.from(val, "utf8").toString("base64"), JSON.stringify(val).slice(1, -1)])) {
        if (form.length >= 6) out = out.split(form).join("[REDACTED:" + n + "]");
      }
    }
    return out;
  }
  // ---- lock / unlock / emergency shutdown ----
  function lock(reason = "MANUAL") { lockInternal(String(reason).slice(0, 60)); return { state: "LOCKED" }; }
  function unlock(newKeyB64, { ownerApproval = null } = {}) {
    const t = nowFn();
    if (t < throttledUntil) { audit.append("VAULT_UNLOCK_THROTTLED", {}); throw new Error("VAULT_UNLOCK_THROTTLED"); }
    const k = typeof newKeyB64 === "string" ? Buffer.from(newKeyB64, "base64") : Buffer.alloc(0);
    if (k.length !== 32 || !verifyKey(k)) {
      failures++; if (failures >= unlockMaxFailures) { throttledUntil = t + unlockThrottleMs; failures = 0; }
      audit.append("VAULT_UNLOCK_FAILED", {}); throw new Error("VAULT_WRONG_KEY");
    }
    if (store.shutdown) approve(ownerApproval, "VAULT_RESUME", "ALL", "VAULT_RESUME_DENIED");      // checked after the key so a typo does not burn the single-use approval
    failures = 0; if (key) key.fill(0); key = k; lastUse = t;
    if (store.shutdown) { delete store.shutdown; persist(); }
    audit.append("VAULT_UNLOCKED", { resumed: Boolean(ownerApproval) });
    return { state: "UNLOCKED" };
  }
  /** Lock now and stay locked across restarts until unlock(key, {ownerApproval: VAULT_RESUME}). Does not delete anything. */
  function emergencyShutdown({ ownerApproval = null, reason = "" } = {}) {
    approve(ownerApproval, "VAULT_EMERGENCY_SHUTDOWN", "ALL", "VAULT_SHUTDOWN_DENIED");
    store.shutdown = { at: new Date().toISOString(), reason: String(reason).slice(0, 120) };
    persist(); lockInternal("EMERGENCY_SHUTDOWN"); audit.append("VAULT_EMERGENCY_SHUTDOWN", { reason: String(reason).slice(0, 120), nonce: ownerApproval.nonce });
    return { state: "LOCKED", shutdown: true };
  }
  // ---- encrypted backup package (separate passphrase) ----
  const kdfParams = { N: 32768, r: 8, p: 1 };
  const deriveBackupKey = (pass, saltB64, kdf) => scryptSync(pass, Buffer.from(saltB64, "base64"), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * 1024 * 1024 });
  const headerAad = h => Buffer.from(JSON.stringify([h.format, h.v, h.id, h.kdf.N, h.kdf.r, h.kdf.p, h.kdf.salt]));
  const namesDigest = names => sha([...names].sort().join("\n")).slice(0, 40);
  const canonEntries = ent => JSON.stringify(Object.keys(ent).sort().map(n => [n, ent[n]]));
  function exportBackup({ names, passphrase, ownerApproval = null } = {}) {
    need();
    if (!Array.isArray(names) || !names.length || names.length > MAX_BACKUP_ENTRIES) throw new Error("VAULT_BACKUP_NAMES_REQUIRED");
    const uniq = [...new Set(names.map(String))]; uniq.forEach(checkName);
    const pe = checkBackupPassphrase(passphrase, key.toString("base64")); if (pe) throw new Error(pe);
    approve(ownerApproval, "VAULT_EXPORT", "names:" + namesDigest(uniq), "VAULT_EXPORT_DENIED", { count: uniq.length });
    const entries = {};
    for (const n of uniq) { if (!active(n)) throw new Error("VAULT_BACKUP_UNKNOWN_OR_REVOKED:" + n); entries[n] = dec(n, store.entries[n]); }
    const payload = JSON.stringify({ createdAt: new Date().toISOString(), entries, manifestSha: sha(canonEntries(entries)), count: uniq.length });
    const salt = randomBytes(16).toString("base64");
    const h = { format: BACKUP_FORMAT, v: 1, id: randomBytes(12).toString("hex"), kdf: { ...kdfParams, salt } };
    const bk = deriveBackupKey(passphrase, salt, h.kdf), iv = randomBytes(12), c = createCipheriv("aes-256-gcm", bk, iv);
    c.setAAD(headerAad(h));
    const ct = Buffer.concat([c.update(Buffer.from(payload, "utf8")), c.final()]);
    bk.fill(0);
    const pkg = JSON.stringify({ ...h, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") });
    audit.append("VAULT_BACKUP_EXPORTED", { names: uniq, count: uniq.length, id: h.id, packageSha: sha(pkg), nonce: ownerApproval.nonce });
    return { package: pkg, id: h.id, count: uniq.length, sha256: sha(pkg) };
  }
  function openBackup(pkgText, passphrase) {
    let h;
    try { h = JSON.parse(String(pkgText)); } catch { throw new Error("VAULT_BACKUP_UNREADABLE"); }
    if (!h || h.format !== BACKUP_FORMAT || h.v !== 1 || typeof h.id !== "string" || !h.kdf || typeof h.kdf.salt !== "string" || ![h.iv, h.tag, h.ct].every(x => typeof x === "string")) throw new Error("VAULT_BACKUP_INVALID");
    if (h.kdf.N !== kdfParams.N || h.kdf.r !== kdfParams.r || h.kdf.p !== kdfParams.p) throw new Error("VAULT_BACKUP_KDF_UNSUPPORTED");      // never let a package pick expensive/weak parameters
    if (typeof passphrase !== "string" || !passphrase) throw new Error("VAULT_BACKUP_PASSPHRASE_REQUIRED");
    let plain;
    const bk = deriveBackupKey(passphrase, h.kdf.salt, h.kdf);
    try {
      const d = createDecipheriv("aes-256-gcm", bk, Buffer.from(h.iv, "base64"));
      d.setAAD(headerAad(h)); d.setAuthTag(Buffer.from(h.tag, "base64"));
      plain = Buffer.concat([d.update(Buffer.from(h.ct, "base64")), d.final()]).toString("utf8");
    } catch { audit.append("VAULT_BACKUP_REJECTED", { id: String(h.id).slice(0, 24) }); throw new Error("VAULT_BACKUP_WRONG_PASSPHRASE_OR_TAMPERED"); }
    finally { bk.fill(0); }
    let p; try { p = JSON.parse(plain); } catch { throw new Error("VAULT_BACKUP_CORRUPT"); }
    if (!p || typeof p.entries !== "object" || Array.isArray(p.entries) || p.entries === null) throw new Error("VAULT_BACKUP_CORRUPT");
    const ents = Object.assign(Object.create(null), p.entries), names = Object.keys(ents);
    if (names.length !== p.count || names.length > MAX_BACKUP_ENTRIES || sha(canonEntries(ents)) !== p.manifestSha) throw new Error("VAULT_BACKUP_MANIFEST_MISMATCH");
    for (const n of names) { if (!NAME_RE.test(n) || RESERVED.has(n) || typeof ents[n] !== "string" || !ents[n]) throw new Error("VAULT_BACKUP_CORRUPT"); }
    return { id: h.id, entries: ents, names: names.sort(), createdAt: p.createdAt };
  }
  /** Integrity + passphrase check. Returns names only; no value leaves this function. */
  function verifyBackup(pkgText, passphrase) {
    const b = openBackup(pkgText, passphrase);
    audit.append("VAULT_BACKUP_VERIFIED", { id: b.id, count: b.names.length });
    return { ok: true, id: b.id, names: b.names, count: b.names.length, createdAt: b.createdAt };
  }
  function restoreBackup(pkgText, passphrase, { ownerApproval = null, overwrite = false } = {}) {
    need();
    const b = openBackup(pkgText, passphrase);
    approve(ownerApproval, "VAULT_RESTORE", "backup:" + b.id + (overwrite ? ":overwrite" : ""), "VAULT_RESTORE_DENIED", { id: b.id });
    const clash = b.names.filter(n => active(n));
    if (clash.length && !overwrite) throw new Error("VAULT_RESTORE_CONFLICT:" + clash.join(","));
    const before = store.entries, next = Object.assign(Object.create(null), before);
    for (const n of b.names) { const prev = Object.hasOwn(before, n) ? before[n] : null; next[n] = { ...enc(n, b.entries[n]), createdAt: prev?.createdAt ?? new Date().toISOString(), rotations: clash.includes(n) ? (prev.rotations ?? 0) + 1 : 0 }; }
    store.entries = next;
    try { persist(); } catch (e) { store.entries = before; throw e; }
    audit.append("VAULT_BACKUP_RESTORED", { id: b.id, names: b.names, overwritten: clash, nonce: ownerApproval.nonce });
    return { restored: b.names, overwritten: clash };
  }
  const meta = n => { checkName(n); if (!Object.hasOwn(store.entries, n)) return null; const e = store.entries[n]; return { name: n, active: active(n), createdAt: e.createdAt ?? null, updatedAt: e.updatedAt ?? null, rotations: e.rotations ?? 0, revokedAt: e.revokedAt ?? null, reason: e.reason ?? null }; };
  return {
    set, get, remove, revoke, redact, lock, unlock, emergencyShutdown, exportBackup, verifyBackup, restoreBackup, meta,
    has: n => active(String(n)),
    list: () => Object.keys(store.entries).filter(active).sort(),
    status: () => ({ state: locked() ? "LOCKED" : "UNLOCKED", entries: Object.keys(store.entries).filter(active).length, revoked: Object.keys(store.entries).filter(n => store.entries[n].revokedAt).length, shutdown: Boolean(store.shutdown), idleLockMs, auditHead: audit.head() }),
    auditVerify: () => audit.verify(), auditEntries: () => audit.entries()
  };
}
