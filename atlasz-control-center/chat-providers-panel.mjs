// Owner-facing Chat Providers center (23-point item 7/20). Lists every platform with its honest availability, lets the owner record an account (a credential REFERENCE name, never a value) and remove it.
// Nothing here connects, listens or sends: no connector adapter ships in this repository, so every account stays CONFIGURED at most and the panel says "NO_ADAPTER_INSTALLED".
// Configured accounts are persisted (data only) and re-applied on start; anything that no longer validates is dropped with a note. Disconnecting never needs approval.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createChatProviders } from "../atlasz-addons/chat-providers.mjs";

export function createChatProvidersPanel({ stateDir, inbox, vaultHas = () => false, isStopped = () => false } = {}) {
  const dir = path.join(stateDir, "chat-providers"), file = path.join(dir, "accounts.json");
  let cp = null, dropped = [];
  const readSaved = () => { try { const w = JSON.parse(fs.readFileSync(file, "utf8")); if (w.sha !== crypto.createHash("sha256").update(w.body).digest("hex")) throw new Error("sha"); const b = JSON.parse(w.body); return Array.isArray(b.accounts) ? b.accounts : []; } catch (e) { if (fs.existsSync(file)) dropped.push({ reason: "ACCOUNT_FILE_UNREADABLE" }); return []; } };
  const save = list => { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); const body = JSON.stringify({ accounts: list }), t = file + ".tmp"; fs.writeFileSync(t, JSON.stringify({ sha: crypto.createHash("sha256").update(body).digest("hex"), body }), { mode: 0o600 }); fs.renameSync(t, file); };
  const open = () => {
    if (cp) return cp;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    cp = createChatProviders({ inbox, dir: path.join(dir, "audit") });
    for (const a of readSaved()) { const r = cp.configure(a.providerId, { accountId: a.accountId, credentialRef: a.credentialRef ?? null, hosts: a.hosts ?? null }); if (!r.ok) dropped.push({ providerId: a.providerId, accountId: a.accountId, reason: r.reason }); }
    return cp;
  };
  const accountsNow = () => open().catalogue().flatMap(p => p.accounts ?? []).map(a => ({ providerId: a.providerId, accountId: a.accountId, credentialRef: a.credentialRef, hosts: a.hosts }));
  function view() {
    const c = open(), cat = c.catalogue(), sum = c.summary();
    return { state: "CONNECTED", summary: sum, audit: c.auditVerify(), dropped,
      providers: cat.map(p => ({ id: p.id, name: p.displayName, officialApi: p.officialApi, state: p.state ?? p.accounts?.[0]?.state ?? "UNCONFIGURED", available: p.available, apiName: p.apiName, accountScope: p.accountScope, hosts: p.egressHosts, hostsRequired: Boolean(p.hostsRequiredAtConfigure), sendCost: p.sendCost, refused: p.refusedRoutes, unavailableReason: p.unavailableReason ?? null, notes: p.notes ?? "",
        accounts: (p.accounts ?? []).map(a => ({ accountId: a.accountId, state: a.state, credentialRef: a.credentialRef, credentialStored: a.credentialRef ? Boolean(vaultHas(a.credentialRef)) : null, hosts: a.hosts, connected: a.connected, live: false })) })),
      adapters: "NO_ADAPTER_INSTALLED", evidence: cat[0]?.evidence ?? null,
      note: "Nothing is connected, listening or sending: no connector adapter exists in this repository, and nothing is LIVE. Recording an account only stores which vault entry it would use. Platforms with only unofficial automation stay UNAVAILABLE. Incoming text would be treated as untrusted data; sending would need your signed approval per draft." };
  }
  function action(a) {
    const c = open(); if (isStopped() && a.op !== "unconfigure") return { ok: false, reason: "OWNER_STOP_OR_SAFE_MODE_ACTIVE" };
    switch (a.op) {
      case "configure": {
        const r = c.configure(String(a.providerId ?? ""), { accountId: a.accountId, credentialRef: a.credentialRef || null, hosts: a.hosts ? String(a.hosts).split(",").map(x => x.trim()).filter(Boolean) : null }); if (!r.ok) return r;
        save(accountsNow()); return { ok: true, state: r.state, note: "Recorded only; nothing connects until an adapter is installed and you approve it." };
      }
      case "unconfigure": { const r = c.unconfigure(String(a.providerId ?? ""), String(a.accountId ?? "")); save(accountsNow()); return r; }
      default: throw new Error("UNKNOWN_CHAT_OP");
    }
  }
  return { view, action };
}
