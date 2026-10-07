// ATLASZ Secret Vault (V7.3 §36). Encrypted-at-rest credential store.
// - AES-256-GCM, per-entry random IV, entry NAME bound as AAD (entries cannot be swapped between names).
// - The master key comes from the host (env ATLASZ_VAULT_KEY, base64 of 32 bytes) or a passed key. No key => LOCKED, fail closed.
// - Setting / deleting a credential is a credential change: it needs a signed owner approval (VAULT_SET / VAULT_DELETE).
// - Values are never written to logs/audit; list() returns names only; redact() scrubs known secrets from any text.
// Honest limits: the master key must be protected by the host (Windows DPAPI / OS keychain in the Control Center);
// this module does not claim hardware-backed protection.
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { getDefaultOwnerAuth } from "./owner-auth.mjs";

export const VAULT_VERSION = "1";
const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

export function generateVaultKey() { return randomBytes(32).toString("base64"); }

export function createSecretVault({ dir, keyB64 = process.env.ATLASZ_VAULT_KEY || null, ownerAuth = getDefaultOwnerAuth() } = {}) {
  if (!dir) throw new Error("VAULT_DIR_REQUIRED");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "vault.enc.json");
  const audit = createAuditChain({ filePath: path.join(dir, "vault-audit.jsonl") });
  let key = null;
  if (keyB64) { const k = Buffer.from(keyB64, "base64"); if (k.length === 32) key = k; }
  let store = { version: VAULT_VERSION, entries: {} };
  if (fs.existsSync(file)) {
    try { store = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("VAULT_FILE_UNREADABLE"); }
    if (store.version !== VAULT_VERSION || typeof store.entries !== "object") throw new Error("VAULT_FILE_INVALID");
  }
  const locked = () => !key;
  const need = () => { if (!key) throw new Error("VAULT_LOCKED_NO_KEY"); };
  const persist = () => {
    const tmp = file + ".tmp";
    const fd = fs.openSync(tmp, "w", 0o600);
    try { fs.writeSync(fd, JSON.stringify(store)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  };
  const enc = (name, value) => {
    const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key, iv);
    c.setAAD(Buffer.from(name));
    const ct = Buffer.concat([c.update(Buffer.from(String(value), "utf8")), c.final()]);
    return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64"), updatedAt: new Date().toISOString() };
  };
  const dec = (name, e) => {
    try {
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(e.iv, "base64"));
      d.setAAD(Buffer.from(name)); d.setAuthTag(Buffer.from(e.tag, "base64"));
      return Buffer.concat([d.update(Buffer.from(e.ct, "base64")), d.final()]).toString("utf8");
    } catch { audit.append("VAULT_TAMPER_OR_WRONG_KEY", { name }); throw new Error("VAULT_ENTRY_TAMPERED_OR_WRONG_KEY"); }
  };
  const checkName = n => { if (!NAME_RE.test(String(n))) throw new Error("VAULT_INVALID_NAME"); };

  function set(name, value, { ownerApproval = null } = {}) {
    need(); checkName(name);
    if (typeof value !== "string" || !value) throw new Error("VAULT_VALUE_REQUIRED");
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "VAULT_SET", subject: name });
    if (!v.allowed) { audit.append("VAULT_SET_DENIED", { name, reason: v.reason }); throw new Error("OWNER_APPROVAL_REQUIRED:VAULT_SET"); }
    const existed = Boolean(store.entries[name]);
    store.entries[name] = enc(name, value);
    persist();
    audit.append(existed ? "VAULT_ROTATED" : "VAULT_CREATED", { name, nonce: ownerApproval.nonce });
    return { name, rotated: existed };
  }
  function get(name, { purpose = "" } = {}) {
    need(); checkName(name);
    if (!purpose) throw new Error("VAULT_PURPOSE_REQUIRED");
    const e = store.entries[name];
    if (!e) { audit.append("VAULT_MISS", { name, purpose }); return null; }
    const v = dec(name, e);
    audit.append("VAULT_READ", { name, purpose });   // the value is never logged
    return v;
  }
  function remove(name, { ownerApproval = null } = {}) {
    need(); checkName(name);
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "VAULT_DELETE", subject: name });
    if (!v.allowed) { audit.append("VAULT_DELETE_DENIED", { name, reason: v.reason }); throw new Error("OWNER_APPROVAL_REQUIRED:VAULT_DELETE"); }
    if (!store.entries[name]) return false;
    delete store.entries[name]; persist(); audit.append("VAULT_DELETED", { name, nonce: ownerApproval.nonce });
    return true;
  }
  // Remove every known secret value from a piece of text (for logs, error messages, UI).
  function redact(text) {
    let out = String(text ?? "");
    if (!key) return out;
    for (const [n, e] of Object.entries(store.entries)) {
      let val; try { val = dec(n, e); } catch { continue; }
      if (val.length >= 6) out = out.split(val).join("[REDACTED:" + n + "]");
    }
    return out;
  }
  return {
    set, get, remove, redact,
    has: n => Boolean(store.entries[n]),
    list: () => Object.keys(store.entries).sort(),
    status: () => ({ state: locked() ? "LOCKED" : "UNLOCKED", entries: Object.keys(store.entries).length, auditHead: audit.head() }),
    auditVerify: () => audit.verify(), auditEntries: () => audit.entries()
  };
}
