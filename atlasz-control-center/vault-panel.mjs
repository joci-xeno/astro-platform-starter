// Owner-facing API Key Vault (23-point item 1/20). Shows NAMES and metadata only; a secret value is accepted exactly once (to be stored) and is never returned, echoed, logged or put in an error.
// Every change (store/rotate, revoke, delete) needs a signed single-use owner approval bound to that credential name. Agents never see values: they go through the credential broker.
// No host key (ATLASZ_VAULT_KEY) => the vault is LOCKED and storing is impossible; the panel says so instead of pretending.
import path from "node:path";
import { createSecretVault } from "../atlasz-addons/secret-vault.mjs";
import { SEED_PROVIDERS } from "../atlasz-addons/model-registry.mjs";
import { CHAT_PROVIDER_CATALOGUE } from "../atlasz-addons/chat-providers.mjs";

export const MAX_SECRET_CHARS = 4096;
export function createVaultPanel({ stateDir, ownerAuth, sign, isStopped = () => false, keyB64 = process.env.ATLASZ_VAULT_KEY || null } = {}) {
  const dir = path.join(stateDir, "vault");
  let v = null;
  const vault = () => (v ??= createSecretVault({ dir, keyB64, ownerAuth: { verifyApproval: (...a) => { try { return ownerAuth().verifyApproval(...a); } catch { return { allowed: false, reason: "NO_OWNER_KEY" }; } } } }));
  const need = (x, w) => { if (typeof x !== "string" || !x) throw new Error(w + "_REQUIRED"); return x; };
  const wanted = () => [...SEED_PROVIDERS.filter(p => p.credentialRef).map(p => ({ ref: p.credentialRef, usedBy: "model provider " + p.id }))];
  function view() {
    const vt = vault(), st = vt.status(), names = vt.list(), audit = vt.auditVerify();
    const entries = names.map(n => { const m = vt.meta(n); return { name: n, value: "stored (masked)", createdAt: m?.createdAt ?? null, updatedAt: m?.updatedAt ?? null, rotations: m?.rotations ?? 0 }; });
    const revoked = Object.keys(vt.auditEntries().reduce((a, e) => { if (e.event === "VAULT_REVOKED") a[e.data?.name] = 1; return a; }, {}));
    const want = wanted();
    return { state: "CONNECTED", vault: { state: st.state, entries: st.entries, revoked: st.revoked, shutdown: st.shutdown, auditOk: audit.ok === true }, hostKey: keyB64 ? "PRESENT" : "ABSENT",
      entries, revokedNames: revoked.slice(0, 50),
      expected: want.map(w => ({ ref: w.ref, usedBy: w.usedBy, stored: names.includes(w.ref) })),
      chatProviders: CHAT_PROVIDER_CATALOGUE.filter(p => p.available).length + " chat platforms can reference vault entries by name (no value is ever passed to them).",
      note: keyB64 ? "Values are encrypted at rest (AES-256-GCM). They are shown nowhere; store, rotate, revoke and delete each need your signed approval for that exact name." : "No host key is configured, so the vault is LOCKED and cannot store anything. Set ATLASZ_VAULT_KEY on this machine (a 32-byte base64 key, kept outside this folder) and restart. Nothing was stored." };
  }
  function action(a) {
    const vt = vault();
    if (isStopped() && a.op !== "lock") return { ok: false, reason: "OWNER_STOP_OR_SAFE_MODE_ACTIVE" };
    switch (a.op) {
      case "set": {
        const name = need(a.name, "NAME"), value = need(a.value, "VALUE"), pass = need(a.passphrase, "PASSPHRASE"); if (value.length > MAX_SECRET_CHARS) return { ok: false, reason: "VALUE_TOO_LONG" };
        try { const r = vt.set(name, value, { ownerApproval: sign(pass, "VAULT_SET", name) }); return { ok: true, name: r.name, rotated: r.rotated }; }
        catch (e) { return { ok: false, reason: String(e?.message ?? e).replace(value, "[value]").slice(0, 80) }; }
      }
      case "revoke": { const name = need(a.name, "NAME"), pass = need(a.passphrase, "PASSPHRASE"); return { ok: true, revoked: vt.revoke(name, { ownerApproval: sign(pass, "VAULT_REVOKE", name), reason: String(a.reason ?? "owner revoked").slice(0, 120) }) }; }
      case "delete": { const name = need(a.name, "NAME"), pass = need(a.passphrase, "PASSPHRASE"); return { ok: true, deleted: vt.remove(name, { ownerApproval: sign(pass, "VAULT_DELETE", name) }) }; }
      case "lock": return { ok: true, ...vt.lock("OWNER_PANEL") };
      case "verify": return { ok: true, audit: vt.auditVerify() };
      default: throw new Error("UNKNOWN_VAULT_OP");
    }
  }
  return { view, action, has: n => { try { return vault().has(n); } catch { return false; } } };
}
