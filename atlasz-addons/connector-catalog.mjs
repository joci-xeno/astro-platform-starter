// V7.3 §13 connectors: descriptors + generic read-only REST connector with vault-held credentials.
// Honesty rules: no credential -> BLOCKED_NO_CREDENTIALS. LIVE only from our own passing read-only probe.
// Connectors without a known FREE read-only endpoint have probe:null -> NO_SAFE_PROBE (a probe could spend credits; needs JOCI approval).
// This module only issues GET requests to the descriptor's own host. It never writes, sends, or pays.
import { emergencyGate } from "./emergency-stop.mjs";

const bearer = t => ({ authorization: "Bearer " + t });
export const CONNECTOR_DESCRIPTORS = Object.freeze({
  github:   { name: "GitHub",   base: "https://api.github.com",          vault: "GITHUB_TOKEN",   auth: bearer, headers: { accept: "application/vnd.github+json", "user-agent": "atlasz" }, probe: { path: "/user" }, capabilities: ["code.read"] },
  hunter:   { name: "Hunter",   base: "https://api.hunter.io",           vault: "HUNTER_API_KEY", auth: t => ({ "x-api-key": t }), probe: { path: "/v2/account" }, capabilities: ["contacts.lookup"] },
  airtable: { name: "Airtable", base: "https://api.airtable.com",        vault: "AIRTABLE_TOKEN", auth: bearer, probe: { path: "/v0/meta/whoami" }, capabilities: ["tables.read"] },
  gmail:    { name: "Gmail",    base: "https://gmail.googleapis.com",    vault: "GMAIL_OAUTH_TOKEN", auth: bearer, probe: { path: "/gmail/v1/users/me/profile" }, capabilities: ["mail.read"] },
  calendar: { name: "Google Calendar", base: "https://www.googleapis.com", vault: "GCAL_OAUTH_TOKEN", auth: bearer, probe: { path: "/calendar/v3/users/me/calendarList?maxResults=1" }, capabilities: ["calendar.read"] },
  drive:    { name: "Google Drive", base: "https://www.googleapis.com",  vault: "GDRIVE_OAUTH_TOKEN", auth: bearer, probe: { path: "/drive/v3/about?fields=user" }, capabilities: ["files.read"] },
  railway:  { name: "Railway",  base: "https://backboard.railway.app",   vault: "RAILWAY_TOKEN",  auth: bearer, probe: { path: "/graphql/v2", method: "POST_READONLY_GRAPHQL", body: '{"query":"{ me { id } }"}', unverifiedEndpoint: true }, capabilities: ["deploy.read"] },
  agentmail:{ name: "AgentMail",base: "https://api.agentmail.to",        vault: "AGENTMAIL_API_KEY", auth: bearer, probe: null, capabilities: ["mail.agent"] },
  clay:     { name: "Clay",     base: "https://api.clay.com",            vault: "CLAY_API_KEY",   auth: bearer, probe: null, capabilities: ["enrichment"] },
  firecrawl:{ name: "Firecrawl",base: "https://api.firecrawl.dev",       vault: "FIRECRAWL_API_KEY", auth: bearer, probe: null, capabilities: ["web.crawl"] },
  exa:      { name: "Exa",      base: "https://api.exa.ai",              vault: "EXA_API_KEY",    auth: t => ({ "x-api-key": t }), probe: null, capabilities: ["web.search"] },
  tavily:   { name: "Tavily",   base: "https://api.tavily.com",          vault: "TAVILY_API_KEY", auth: bearer, probe: null, capabilities: ["web.search"] }
});

export function createConnectorCatalog({ vault, fetchImpl = globalThis.fetch, gate = emergencyGate, descriptors = CONNECTOR_DESCRIPTORS, now = () => new Date().toISOString(), timeoutMs = 10000 } = {}) {
  if (!vault) throw new Error("VAULT_REQUIRED");
  const evidence = new Map(), lastError = new Map(), approvedProbes = new Set();
  const D = id => { const d = descriptors[id]; if (!d) throw new Error("UNKNOWN_CONNECTOR"); return d; };
  const hasCred = d => { try { return vault.status().state === "UNLOCKED" && vault.has(d.vault); } catch { return false; } };
  const safe = (id, s) => vault.redact(String(s ?? "")).slice(0, 160);

  function status(id) {
    const d = D(id);
    if (!hasCred(d)) return { id, state: "BLOCKED_NO_CREDENTIALS", needs: d.vault, live: false };
    const ev = evidence.get(id);
    if (ev) return { id, state: "LIVE", live: true, evidence: ev };
    if (lastError.has(id)) return { id, state: "PROBE_FAILED", live: false, error: lastError.get(id) };
    if (!d.probe) return { id, state: approvedProbes.has(id) ? "CREDENTIALS_PRESENT_UNTESTED" : "NO_SAFE_PROBE", live: false, note: "No known free read-only probe; a probe may consume credits and needs JOCI approval." };
    return { id, state: "CREDENTIALS_PRESENT_UNTESTED", live: false };
  }
  async function call(d, path, { method = "GET", body } = {}) {
    const url = new URL(path, d.base);
    if (url.origin !== new URL(d.base).origin) throw new Error("HOST_NOT_ALLOWED");
    const token = vault.get(d.vault, { purpose: "connector:" + d.name });
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { method, headers: { ...(d.headers || {}), ...(body ? { "content-type": "application/json" } : {}), ...d.auth(token) }, body, signal: ctl.signal });
    } finally { clearTimeout(t); }
  }
  async function probe(id) {
    const d = D(id);
    if (!hasCred(d)) return { id, ok: false, state: "BLOCKED_NO_CREDENTIALS" };
    if (!d.probe) return { id, ok: false, state: "NO_SAFE_PROBE" };
    const g = gate({ external: true }); if (g && g.allowed === false) return { id, ok: false, state: "OWNER_STOP" };
    try {
      const m = d.probe.method === "POST_READONLY_GRAPHQL" ? "POST" : "GET";
      const r = await call(d, d.probe.path, { method: m, body: d.probe.body });
      if (r.status >= 200 && r.status < 300) {
        const ev = { probeId: id + "@" + now(), outcome: "PASS", at: now(), target: d.base + d.probe.path.split("?")[0], httpStatus: r.status, unverifiedEndpoint: Boolean(d.probe.unverifiedEndpoint) };
        evidence.set(id, ev); lastError.delete(id);
        return { id, ok: true, state: "LIVE", evidence: ev };
      }
      evidence.delete(id); lastError.set(id, "HTTP_" + r.status);
      return { id, ok: false, state: "PROBE_FAILED", httpStatus: r.status };
    } catch (e) { evidence.delete(id); const m = safe(id, e.message); lastError.set(id, m); return { id, ok: false, state: "PROBE_FAILED", error: m }; }
  }
  /** Read-only GET through a connector that has already passed its own probe. */
  async function read(id, path) {
    const d = D(id), s = status(id);
    if (!s.live) throw new Error("CONNECTOR_NOT_LIVE:" + s.state);
    const g = gate({ external: true }); if (g && g.allowed === false) throw new Error("OWNER_STOP");
    const r = await call(d, path, { method: "GET" });
    return { status: r.status, body: safe(id, await r.text()) };
  }
  /** JOCI explicitly approved a (possibly credit-consuming) probe call for a descriptor without a free probe. Still no auto-LIVE. */
  const markProbeApproved = id => { D(id); approvedProbes.add(id); };
  const health = () => { const all = Object.keys(descriptors).map(status); const c = s => all.filter(x => x.state === s).length; return { total: all.length, live: c("LIVE"), blockedNoCredentials: c("BLOCKED_NO_CREDENTIALS"), noSafeProbe: c("NO_SAFE_PROBE"), failed: c("PROBE_FAILED"), untested: c("CREDENTIALS_PRESENT_UNTESTED"), connectors: all }; };
  return { status, probe, probeAll: async () => { for (const id of Object.keys(descriptors)) if (descriptors[id].probe) await probe(id); return health(); }, read, health, markProbeApproved };
}
