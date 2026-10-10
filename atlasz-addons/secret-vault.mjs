// ATLASZ Secret Vault (V7.3 §36). Encrypted-at-rest credential store.
// - AES-256-GCM, per-entry random IV, entry NAME bound as AAD (entries cannot be swapped between names).
// - The master key comes from the host (env ATLASZ_VAULT_KEY, base64 of 32 bytes) or a passed key. No key => LOCKED, fail closed.
// - Setting / deleting a credential is a credential change: it needs a signed owner approval (VAULT_SET / VAULT_DELETE).
// - Values are never written to logs/audit; list() returns names only; redact() scrubs known secrets from any text.
// - M1 (unified programme): lock()/unlock() with failure throttling, idle auto-lock (opt-in), revoke(), emergencyShutdown() that survives restart until an owner-approved resume,
//   encrypted backup package (separate passphrase, scrypt + AES-256-GCM, header bound as AAD) with verifyBackup()/restoreBackup() and per-entry metadata.
//   Raw values never reach agents: agents go through credential-broker.mjs.
//   Several vault objects (or processes) may share one directory: every change runs under a file lock after re-reading the file, and revocations / emergency shutdowns are replayed from the
//   hash-chained audit log, so a stale instance or a restored old vault file cannot silently revive a revoked credential or clear a shutdown (deleting the whole audit file is not detected).
// Honest limits: the master key must be protected by the host (Windows DPAPI / OS keychain in the Control Center);
// this module does not claim hardware-backed protection.
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { getDefaultOwnerAuth } from "./owner-auth.mjs";
import { withFileLock } from "./file-lock.mjs";

export const VAULT_VERSION = "1";
const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const RESERVED = new Set(["__proto__", "prototype", "constructor", "__check__", "__anchor__"]);
const MAX_PACKAGE_BYTES = 1024 * 1024;
const CHECK_TEXT = "ATLASZ-VAULT-KEY-CHECK";
const BACKUP_FORMAT = "ATLASZ-VAULT-BACKUP";
const MAX_BACKUP_ENTRIES = 200;
const sha = t => createHash("sha256").update(t).digest("hex");
const ctHash = e => sha(String(e.iv) + "|" + String(e.tag) + "|" + String(e.ct)).slice(0, 32);      // identifies one exact ciphertext, so replay can tell a current entry from an old copy

export function generateVaultKey() { return randomBytes(32).toString("base64"); }

/** Backup passphrase policy (a minimum, not a strength guarantee): long, varied, not repetitive, and not derived from the vault key itself. */
export function checkBackupPassphrase(pass, keyB64 = null) {
  if (typeof pass !== "string" || pass.length < 16) return "PASSPHRASE_TOO_SHORT";
  if (pass.length > 256) return "PASSPHRASE_TOO_LONG";
  if (new Set(pass).size < 10) return "PASSPHRASE_TOO_REPETITIVE";
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(pass)).length;
  if (classes < 2) return "PASSPHRASE_NEEDS_MIXED_CHARACTERS";
  if (keyB64) {
    const raw = Buffer.from(keyB64, "base64"), forms = [keyB64, keyB64.replace(/=+$/, ""), raw.toString("hex")].filter(x => x.length >= 8);
    if (forms.some(f => pass.includes(f) || (pass.length >= 12 && f.includes(pass)))) return "PASSPHRASE_MUST_DIFFER_FROM_VAULT_KEY";
  }
  return null;
}

export function createSecretVault({ dir, keyB64 = process.env.ATLASZ_VAULT_KEY || null, ownerAuth = getDefaultOwnerAuth(), idleLockMs = 0, nowFn = () => Date.now(), unlockMaxFailures = 5, unlockThrottleMs = 60000 } = {}) {
  if (!dir) throw new Error("VAULT_DIR_REQUIRED");
  if (!Number.isFinite(idleLockMs) || idleLockMs < 0) throw new Error("VAULT_IDLE_LOCK_INVALID");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "vault.enc.json"), auditFile = path.join(dir, "vault-audit.jsonl");
  const audit = createAuditChain({ filePath: auditFile });
  let key = null;
  if (keyB64) { const k = Buffer.from(keyB64, "base64"); if (k.length === 32) key = k; }
  let store = { version: VAULT_VERSION, entries: Object.create(null) };
  let seen = "";
  const stamp = f => { try { const st = fs.statSync(f); return st.size + ":" + st.mtimeMs + ":" + st.ino; } catch { return "none"; } };
  const readStoreFile = () => {
    if (!fs.existsSync(file)) return { version: VAULT_VERSION, entries: Object.create(null) };
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("VAULT_FILE_UNREADABLE"); }
    if (!parsed || parsed.version !== VAULT_VERSION || !parsed.entries || typeof parsed.entries !== "object" || Array.isArray(parsed.entries)) throw new Error("VAULT_FILE_INVALID");
    if (Object.keys(parsed.entries).some(n => RESERVED.has(n) || !NAME_RE.test(n))) throw new Error("VAULT_FILE_INVALID");      // JSON.parse makes "__proto__" an own key: refuse such files
    return { ...parsed, entries: Object.assign(Object.create(null), parsed.entries) };
  };
  let lastUse = nowFn(), failures = 0, throttledUntil = 0, bkFailures = 0, bkThrottledUntil = 0, inLock = false;
  const lockInternal = reason => { if (key) { key.fill(0); key = null; audit.append("VAULT_LOCKED", { reason }); } };
  /** Facts that must survive a stale file: which credentials are revoked and whether an emergency shutdown is in force, replayed from the audit chain. */
  const replay = () => {
    const names = new Map(); let shut = null;
    const st = n => { if (!names.has(n)) names.set(n, { revoked: false, ever: false, live: null }); return names.get(n); };
    for (const e of audit.entries()) {
      const d = e.data ?? {};
      if (e.event === "VAULT_REVOKED") { const x = st(d.name); x.revoked = true; x.ever = true; x.live = null; }
      else if (e.event === "VAULT_CREATED" || e.event === "VAULT_ROTATED") { const x = st(d.name); x.revoked = false; x.live = typeof d.ct === "string" ? d.ct : null; }
      else if (e.event === "VAULT_DELETED") { const x = st(d.name); x.revoked = false; x.live = null; }
      else if (e.event === "VAULT_BACKUP_RESTORED") for (const n of d.names ?? []) { const x = st(n); x.revoked = false; x.live = typeof d.hashes?.[n] === "string" ? d.hashes[n] : null; }
      else if (e.event === "VAULT_EMERGENCY_SHUTDOWN") shut = { at: e.at, reason: d.reason ?? "" };
      else if (e.event === "VAULT_UNLOCKED" && d.resumedFromShutdown) shut = null;
    }
    return { names, shut };
  };
  const verifyKey = k => {
    if (store.check) { try { return decWith("__check__", store.check, k) === CHECK_TEXT; } catch { return false; } }
    const first = Object.entries(store.entries).find(([, e]) => e.ct);
    if (first) { try { decWith(first[0], first[1], k); return true; } catch { return false; } }
    return true;      // empty vault: nothing to check against yet
  };
  /** Re-read the file and the audit chain when either changed (or when forced), then re-apply replayed revocations / shutdown and the key check. */
  function sync(force = false) {
    const fp = stamp(file) + "|" + stamp(auditFile);
    if (!force && fp === seen) return;
    audit.reload();
    store = readStoreFile();
    const r = replay(); let dirty = false;
    for (const [n, x] of r.names) {
      const e = Object.hasOwn(store.entries, n) ? store.entries[n] : null;
      if (!e || !e.ct || e.revokedAt) continue;
      // revoked and never re-created: revoke. Revoked once and later re-created: an entry whose ciphertext is not the one the audit recorded is an OLD copy of the file - revoke it too.
      const stale = x.revoked || (x.ever && x.live && ctHash(e) !== x.live);
      if (stale) { store.entries[n] = { createdAt: e.createdAt ?? null, rotations: e.rotations ?? 0, revokedAt: new Date().toISOString(), reason: x.revoked ? "REPLAYED_FROM_AUDIT" : "STALE_COPY_REVOKED" }; dirty = true; }
    }
    if (r.shut && !store.shutdown) { store.shutdown = r.shut; dirty = true; }
    if (!r.shut && store.shutdown) { /* a shutdown flag with no matching audit event is kept: only an owner-approved resume clears it */ }
    if (key && !verifyKey(key)) { key.fill(0); key = null; audit.append("VAULT_WRONG_KEY_DETECTED", {}); }
    if (key && !anchorOk(key)) { key.fill(0); key = null; audit.append("VAULT_AUDIT_ROLLBACK_DETECTED", {}); }      // audit log shorter than / different from what the vault last saw: stay locked
    if (store.shutdown && key) { key.fill(0); key = null; }
    if (dirty && inLock) { try { persistRaw(); } catch { /* the in-memory view is already correct; the file is fixed by the next successful write */ } }
    seen = stamp(file) + "|" + stamp(auditFile);
  }
  const idle = () => { if (key && idleLockMs > 0 && nowFn() - lastUse > idleLockMs) lockInternal("IDLE_TIMEOUT"); };
  const view = () => { sync(); idle(); };
  const locked = () => { view(); return !key; };
  const need = () => { view(); if (!key) throw new Error("VAULT_LOCKED_NO_KEY"); lastUse = nowFn(); };
  const active = n => Object.hasOwn(store.entries, n) && !store.entries[n].revokedAt && Boolean(store.entries[n].ct);
  const persistRaw = () => {
    if (key && !store.check) store.check = encRaw("__check__", CHECK_TEXT);
    if (key) store.anchor = encRaw("__anchor__", JSON.stringify({ n: audit.length(), head: audit.head() }));      // encrypted audit position: a truncated / replaced audit file is noticed at unlock
    const tmp = file + ".tmp";
    try { fs.unlinkSync(tmp); } catch { /* none */ }      // never write through a pre-planted file or symlink
    const fd = fs.openSync(tmp, "wx", 0o600);
    try { fs.writeSync(fd, JSON.stringify(store)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  };
  const persist = () => { persistRaw(); };
  /** Run a change under the file lock on a freshly re-read store. */
  const mutate = fn => withFileLock(file, () => { const was = inLock; inLock = true; try { sync(true); idle(); return fn(); } finally { inLock = was; } });
  const encRaw = (name, value, k = key) => {
    const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", k, iv, { authTagLength: 16 });
    c.setAAD(Buffer.from(name));
    const ct = Buffer.concat([c.update(Buffer.from(String(value), "utf8")), c.final()]);
    return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") };
  };
  const enc = (name, value) => ({ ...encRaw(name, value), updatedAt: new Date().toISOString() });
  const decWith = (name, e, k) => {
    const tag = Buffer.from(e.tag, "base64"); if (tag.length !== 16) throw new Error("TAG_LENGTH");      // never accept a truncated authentication tag
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(e.iv, "base64"), { authTagLength: 16 });
    d.setAAD(Buffer.from(name)); d.setAuthTag(tag);
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
  sync(true);

  function set(name, value, { ownerApproval = null } = {}) {
    checkName(name);
    if (typeof value !== "string" || !value) throw new Error("VAULT_VALUE_REQUIRED");
    return mutate(() => {
      need();
      approve(ownerApproval, "VAULT_SET", name, "VAULT_SET_DENIED", { name });
      const prev = Object.hasOwn(store.entries, name) ? store.entries[name] : null;
      const existed = Boolean(prev && prev.ct && !prev.revokedAt);
      store.entries[name] = { ...enc(name, value), createdAt: prev?.createdAt ?? new Date().toISOString(), rotations: existed ? (prev.rotations ?? 0) + 1 : 0 };
      persist();
      audit.append(existed ? "VAULT_ROTATED" : "VAULT_CREATED", { name, ct: ctHash(store.entries[name]), nonce: ownerApproval.nonce });
      return { name, rotated: existed };
    });
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
    checkName(name);
    return mutate(() => {
      view();      // removing needs no key: a locked vault must still be able to get rid of a credential
      approve(ownerApproval, "VAULT_DELETE", name, "VAULT_DELETE_DENIED", { name });
      if (!Object.hasOwn(store.entries, name)) return false;
      delete store.entries[name]; persist(); audit.append("VAULT_DELETED", { name, nonce: ownerApproval.nonce });
      return true;
    });
  }
  /** Revocation destroys the value but keeps a tombstone (name, times, reason): readers get VAULT_CREDENTIAL_REVOKED instead of silently getting nothing. The audit event is what makes it stick against stale files. */
  function revoke(name, { ownerApproval = null, reason = "" } = {}) {
    checkName(name);
    return mutate(() => {
      view();      // revoking needs no key: it destroys the value and must work while locked or after a shutdown
      approve(ownerApproval, "VAULT_REVOKE", name, "VAULT_REVOKE_DENIED", { name });
      if (!active(name)) return false;
      const e = store.entries[name];
      store.entries[name] = { createdAt: e.createdAt ?? null, rotations: e.rotations ?? 0, revokedAt: new Date().toISOString(), reason: String(reason).slice(0, 120) };
      audit.append("VAULT_REVOKED", { name, reason: String(reason).slice(0, 120), nonce: ownerApproval.nonce });      // audit first: the replay protects the revocation even if the file write fails
      persist();
      return true;
    });
  }
  /** Every known secret value (and its URL-encoded / base64 / JSON-escaped forms) is removed from a piece of text. Fails open while the vault is locked (it cannot know the values then). */
  function redact(text) {
    let out = String(text ?? "");
    view();
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
  function lock(reason = "MANUAL") { sync(); lockInternal(String(reason).slice(0, 60)); return { state: "LOCKED" }; }
  /** Does the encrypted anchor in the vault file still match the audit chain (same length at least, same entry at the anchored position)? Needs the key. */
  function anchorOk(k) {
    if (!store.anchor) return true;      // vault written before anchors existed: nothing to compare
    try {
      const a = JSON.parse(decWith("__anchor__", store.anchor, k));
      if (!Number.isInteger(a.n) || a.n < 0) return false;
      if (a.n === 0) return true;
      const es = audit.entries();
      return es.length >= a.n && es[a.n - 1].hash === a.head;
    } catch { return false; }
  }
  function unlock(newKeyB64, { ownerApproval = null } = {}) {
    return withFileLock(file, () => {
      const was = inLock; inLock = true;
      try {
        sync(true);
        const t = nowFn();
        if (t < throttledUntil) { audit.append("VAULT_UNLOCK_THROTTLED", {}); throw new Error("VAULT_UNLOCK_THROTTLED"); }
        const k = typeof newKeyB64 === "string" ? Buffer.from(newKeyB64, "base64") : Buffer.alloc(0);
        if (k.length !== 32 || !verifyKey(k)) {
          failures++; if (failures >= unlockMaxFailures) { throttledUntil = t + unlockThrottleMs; failures = 0; }
          audit.append("VAULT_UNLOCK_FAILED", {}); throw new Error("VAULT_WRONG_KEY");
        }
        if (!anchorOk(k)) { audit.append("VAULT_AUDIT_ROLLBACK_DETECTED", {}); throw new Error("VAULT_AUDIT_ROLLBACK_DETECTED"); }      // the audit log was truncated or replaced: revocations / shutdown it held may be gone
        const wasShutdown = Boolean(store.shutdown);
        if (wasShutdown) approve(ownerApproval, "VAULT_RESUME", "ALL", "VAULT_RESUME_DENIED");      // checked after the key so a typo does not burn the single-use approval
        failures = 0; if (key) key.fill(0); key = k; lastUse = t;
        if (wasShutdown) { delete store.shutdown; persist(); }
        audit.append("VAULT_UNLOCKED", { resumedFromShutdown: wasShutdown });
        seen = "";
        return { state: "UNLOCKED" };
      } finally { inLock = was; }
    });
  }
  /** Lock now and stay locked across restarts until unlock(key, {ownerApproval: VAULT_RESUME}). Does not delete anything. The flag is also recorded in the audit chain, which a stale or edited vault file cannot undo. */
  function emergencyShutdown({ ownerApproval = null, reason = "" } = {}) {
    return mutate(() => {
      approve(ownerApproval, "VAULT_EMERGENCY_SHUTDOWN", "ALL", "VAULT_SHUTDOWN_DENIED");
      store.shutdown = { at: new Date().toISOString(), reason: String(reason).slice(0, 120) };
      audit.append("VAULT_EMERGENCY_SHUTDOWN", { reason: String(reason).slice(0, 120), nonce: ownerApproval.nonce });
      persist(); lockInternal("EMERGENCY_SHUTDOWN");
      return { state: "LOCKED", shutdown: true };
    });
  }
  // ---- encrypted backup package (separate passphrase) ----
  const kdfParams = { N: 32768, r: 8, p: 1 };
  const deriveBackupKey = (pass, saltB64, kdf) => scryptSync(pass, Buffer.from(saltB64, "base64"), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * 1024 * 1024 });
  const headerAad = h => Buffer.from(JSON.stringify([h.format, h.v, h.id, h.kdf.N, h.kdf.r, h.kdf.p, h.kdf.salt]));
  const namesDigest = names => sha([...names].sort().join("\n")).slice(0, 40);
  const canonEntries = ent => JSON.stringify(Object.keys(ent).sort().map(n => [n, ent[n]]));
  const restoreSubject = (id, pkgText, overwrite, revive = false) => "backup:" + id + ":" + sha(String(pkgText)).slice(0, 32) + (overwrite ? ":overwrite" : "") + (revive ? ":revive" : "");
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
    const bk = deriveBackupKey(passphrase, salt, h.kdf), iv = randomBytes(12), c = createCipheriv("aes-256-gcm", bk, iv, { authTagLength: 16 });
    c.setAAD(headerAad(h));
    const ct = Buffer.concat([c.update(Buffer.from(payload, "utf8")), c.final()]);
    bk.fill(0);
    const pkg = JSON.stringify({ ...h, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") });
    audit.append("VAULT_BACKUP_EXPORTED", { names: uniq, count: uniq.length, id: h.id, packageSha: sha(pkg), nonce: ownerApproval.nonce });
    return { package: pkg, id: h.id, count: uniq.length, sha256: sha(pkg), restoreSubject: restoreSubject(h.id, pkg, false) };
  }
  function openBackup(pkgText, passphrase) {
    let h;
    if (typeof pkgText !== "string" || pkgText.length > MAX_PACKAGE_BYTES) throw new Error("VAULT_BACKUP_TOO_LARGE_OR_INVALID");
    if (nowFn() < bkThrottledUntil) { audit.append("VAULT_BACKUP_THROTTLED", {}); throw new Error("VAULT_BACKUP_THROTTLED"); }
    try { h = JSON.parse(String(pkgText)); } catch { throw new Error("VAULT_BACKUP_UNREADABLE"); }
    if (!h || h.format !== BACKUP_FORMAT || h.v !== 1 || typeof h.id !== "string" || !h.kdf || typeof h.kdf.salt !== "string" || ![h.iv, h.tag, h.ct].every(x => typeof x === "string")) throw new Error("VAULT_BACKUP_INVALID");
    if (h.kdf.N !== kdfParams.N || h.kdf.r !== kdfParams.r || h.kdf.p !== kdfParams.p) throw new Error("VAULT_BACKUP_KDF_UNSUPPORTED");      // never let a package pick expensive/weak parameters
    if (typeof passphrase !== "string" || !passphrase) throw new Error("VAULT_BACKUP_PASSPHRASE_REQUIRED");
    const tag = Buffer.from(h.tag, "base64");
    if (tag.length !== 16) throw new Error("VAULT_BACKUP_INVALID");      // truncated authentication tags are never accepted
    let plain;
    const bk = deriveBackupKey(passphrase, h.kdf.salt, h.kdf);
    try {
      const d = createDecipheriv("aes-256-gcm", bk, Buffer.from(h.iv, "base64"), { authTagLength: 16 });
      d.setAAD(headerAad(h)); d.setAuthTag(tag);
      plain = Buffer.concat([d.update(Buffer.from(h.ct, "base64")), d.final()]).toString("utf8");
    } catch { bkFailures++; if (bkFailures >= unlockMaxFailures) { bkThrottledUntil = nowFn() + unlockThrottleMs; bkFailures = 0; } audit.append("VAULT_BACKUP_REJECTED", { id: String(h.id).slice(0, 24) }); throw new Error("VAULT_BACKUP_WRONG_PASSPHRASE_OR_TAMPERED"); }
    finally { bk.fill(0); }
    bkFailures = 0;
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
    return { ok: true, id: b.id, names: b.names, count: b.names.length, createdAt: b.createdAt, restoreSubject: restoreSubject(b.id, pkgText, false) };
  }
  /** The restore approval is bound to the package CONTENT hash (not just its id): a different package cannot ride on an approval given for another one. */
  function restoreBackup(pkgText, passphrase, { ownerApproval = null, overwrite = false, revive = false } = {}) {
    return mutate(() => {
      need();
      const b = openBackup(pkgText, passphrase);
      approve(ownerApproval, "VAULT_RESTORE", restoreSubject(b.id, pkgText, overwrite, revive), "VAULT_RESTORE_DENIED", { id: b.id });
      const dead = b.names.filter(n => Object.hasOwn(store.entries, n) && store.entries[n].revokedAt);
      if (dead.length && !revive) throw new Error("VAULT_RESTORE_REVOKED:" + dead.join(","));      // a backup taken before a revocation must not quietly bring the credential back
      const clash = b.names.filter(n => active(n));
      if (clash.length && !overwrite) throw new Error("VAULT_RESTORE_CONFLICT:" + clash.join(","));
      const before = store.entries, next = Object.assign(Object.create(null), before);
      for (const n of b.names) { const prev = Object.hasOwn(before, n) ? before[n] : null; next[n] = { ...enc(n, b.entries[n]), createdAt: prev?.createdAt ?? new Date().toISOString(), rotations: clash.includes(n) ? (prev.rotations ?? 0) + 1 : 0 }; }
      store.entries = next;
      try { persist(); } catch (e) { store.entries = before; throw e; }
      audit.append("VAULT_BACKUP_RESTORED", { id: b.id, names: b.names, hashes: Object.fromEntries(b.names.map(n => [n, ctHash(store.entries[n])])), overwritten: clash, revived: dead, nonce: ownerApproval.nonce });
      return { restored: b.names, overwritten: clash };
    });
  }
  const meta = n => { checkName(n); view(); if (!Object.hasOwn(store.entries, n)) return null; const e = store.entries[n]; return { name: n, active: active(n), createdAt: e.createdAt ?? null, updatedAt: e.updatedAt ?? null, rotations: e.rotations ?? 0, revokedAt: e.revokedAt ?? null, reason: e.reason ?? null }; };
  return {
    set, get, remove, revoke, redact, lock, unlock, emergencyShutdown, exportBackup, verifyBackup, restoreBackup, meta,
    has: n => { view(); return active(String(n)); },
    list: () => { view(); return Object.keys(store.entries).filter(active).sort(); },
    status: () => { const st = locked() ? "LOCKED" : "UNLOCKED"; return { state: st, entries: Object.keys(store.entries).filter(active).length, revoked: Object.keys(store.entries).filter(n => store.entries[n].revokedAt).length, shutdown: Boolean(store.shutdown), idleLockMs, auditHead: audit.head() }; },
    auditVerify: () => audit.verify(), auditEntries: () => audit.entries()
  };
}
