// ATLASZ Credential Broker (23-point #1/#3, unified programme M1). Agents NEVER receive a raw credential: they ask the broker to perform one HTTPS request
// under an owner-signed GRANT; the broker looks the secret up in the vault itself, adds it to the outgoing request and returns only a redacted, size-capped answer.
//
// A grant is owner DATA, signed once (BROKER_GRANT, bound to the exact grant content): credential name, which agents/roles may use it, exact hostnames, methods
// (read-only unless the grant says allowWrite), path prefixes, how the secret is attached, rate limits and an expiry. Everything else is refused:
//   kill switch -> vault unlocked -> grant live (not revoked/expired) -> agent allowed -> credential still active -> https + exact host + port 443 + path prefix + method ->
//   only accept/content-type headers from the agent -> body cap -> per-minute/per-day/in-flight limits -> request with redirect:"manual" (redirects are never followed) ->
//   response capped, secret forms redacted, only a few harmless headers returned.
// Persisted grants carry their owner signature and are re-verified on load: an edited or forged grant file yields no usable grant.
//
// Honest limits: the agent id is asserted by the caller (the trusted agent-tool-broker); this module does not authenticate agents itself. Hostnames are compared by name:
// DNS answers are not checked here (a hostile resolver or DNS rebinding for an allowed name is out of scope, as is TLS-level interception). A request within a grant's scope
// is real external action by design: read-only by default, writes need allowWrite in the signed grant, and spending still goes through the control chain of the caller.
// A file-write attacker can delete the grant file (denial of service) and can undo a revocation unless the audit chain survives (revocations are replayed from the chain).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { getDefaultOwnerAuth } from "./owner-auth.mjs";
import { emergencyGate } from "./emergency-stop.mjs";

const ID_RE = /^[A-Za-z0-9_.-]{1,48}$/;
const AGENT_RE = /^[A-Za-z0-9_.:-]{1,40}$/;
const CRED_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const BAD_TLD = new Set(["local", "localhost", "internal", "lan", "home", "corp", "intranet", "localdomain", "arpa", "test", "invalid", "example"]);
const READ = ["GET", "HEAD"], WRITE = ["POST", "PUT", "PATCH", "DELETE"];
const AGENT_HEADERS = new Set(["accept", "content-type"]);
const FORBIDDEN_AUTH_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection", "cookie", "set-cookie", "proxy-authorization", "upgrade", "te", "trailer", "expect"]);
const RESPONSE_HEADERS = ["content-type", "retry-after", "x-ratelimit-remaining", "x-ratelimit-reset"];
const MAX_DAYS = 90;
const sha = t => createHash("sha256").update(t).digest("hex");

const canon = g => JSON.stringify({ id: g.id, credential: g.credential, agents: [...g.agents].sort(), roles: [...g.roles].sort(), hosts: [...g.hosts].sort(), methods: [...g.methods].sort(), pathPrefixes: [...g.pathPrefixes].sort(), auth: g.auth, maxPerMinute: g.maxPerMinute, maxPerDay: g.maxPerDay, expiresAt: g.expiresAt, purpose: g.purpose, allowWrite: g.allowWrite });
export const grantSubject = g => "grant:" + g.id + ":" + sha(canon(g)).slice(0, 24);

/** Validate and normalise a grant definition. Returns {grant} or {error}. Never throws. */
export function normaliseGrant(raw, { nowMs = Date.now(), checkExpiry = true } = {}) {
  const e = r => ({ error: r });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return e("GRANT_OBJECT_REQUIRED");
  const arr = (v, max) => Array.isArray(v) && v.length <= max ? v : null;
  if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) return e("GRANT_ID_INVALID");
  if (typeof raw.credential !== "string" || !CRED_RE.test(raw.credential) || ["__proto__", "constructor", "prototype", "__check__"].includes(raw.credential)) return e("GRANT_CREDENTIAL_INVALID");
  const agents = arr(raw.agents ?? [], 30), roles = arr(raw.roles ?? [], 10);
  if (!agents || !roles) return e("GRANT_AGENTS_INVALID");
  if (!agents.length && !roles.length) return e("GRANT_NEEDS_AGENTS_OR_ROLES");
  if (!agents.every(a => typeof a === "string" && AGENT_RE.test(a)) || !roles.every(a => typeof a === "string" && AGENT_RE.test(a))) return e("GRANT_AGENTS_INVALID");
  const hosts = arr(raw.hosts, 5);
  if (!hosts || !hosts.length) return e("GRANT_HOSTS_REQUIRED");
  for (const h of hosts) {
    if (typeof h !== "string" || h !== h.toLowerCase() || !HOST_RE.test(h)) return e("GRANT_HOST_INVALID");
    if (BAD_TLD.has(h.split(".").at(-1)) || /^\d+(\.\d+)*$/.test(h.split(".").at(-1) ?? "")) return e("GRANT_HOST_NOT_PUBLIC");
  }
  const allowWrite = raw.allowWrite === true;
  const methods = arr(raw.methods ?? ["GET"], 6);
  if (!methods || !methods.length || !methods.every(m => READ.includes(m) || (allowWrite && WRITE.includes(m)))) return e(allowWrite ? "GRANT_METHODS_INVALID" : "GRANT_WRITE_METHODS_NEED_allowWrite");
  const pathPrefixes = arr(raw.pathPrefixes ?? ["/"], 10);
  if (!pathPrefixes || !pathPrefixes.length || !pathPrefixes.every(p => typeof p === "string" && p.startsWith("/") && p.length <= 200 && !/[?#\\]|\.\.|%2e|%2f|%5c/i.test(p))) return e("GRANT_PATH_PREFIX_INVALID");
  const a = raw.auth ?? { style: "bearer" };
  if (!a || typeof a !== "object" || !["bearer", "header"].includes(a.style)) return e("GRANT_AUTH_INVALID");
  if (a.style === "header" && (typeof a.name !== "string" || !/^[A-Za-z0-9-]{1,40}$/.test(a.name) || FORBIDDEN_AUTH_HEADERS.has(a.name.toLowerCase()))) return e("GRANT_AUTH_HEADER_INVALID");
  const num = (v, d, lo, hi) => v === undefined ? d : (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const maxPerMinute = num(raw.maxPerMinute, 10, 1, 60), maxPerDay = num(raw.maxPerDay, 200, 1, 5000);
  if (maxPerMinute === null || maxPerDay === null) return e("GRANT_LIMITS_INVALID");
  const exp = Date.parse(raw.expiresAt);
  if (typeof raw.expiresAt !== "string" || !Number.isFinite(exp)) return e("GRANT_EXPIRY_REQUIRED_IN_FUTURE");
  if (checkExpiry && exp <= nowMs) return e("GRANT_EXPIRY_REQUIRED_IN_FUTURE");
  if (checkExpiry && exp - nowMs > MAX_DAYS * 86400000) return e("GRANT_EXPIRY_TOO_FAR");
  const purpose = typeof raw.purpose === "string" ? raw.purpose.slice(0, 160) : "";
  if (!purpose) return e("GRANT_PURPOSE_REQUIRED");
  return { grant: { id: raw.id, credential: raw.credential, agents: [...new Set(agents)], roles: [...new Set(roles)], hosts: [...new Set(hosts)], methods: [...new Set(methods)], pathPrefixes: [...new Set(pathPrefixes)], auth: a.style === "header" ? { style: "header", name: a.name } : { style: "bearer" }, maxPerMinute, maxPerDay, expiresAt: new Date(exp).toISOString(), purpose, allowWrite } };
}

export function createCredentialBroker({ vault, ownerAuth = getDefaultOwnerAuth(), fetchImpl = globalThis.fetch, gate = emergencyGate, stateDir = null, roleOf = () => null, isKnownAgent = null, now = () => Date.now(),
  timeoutMs = 10000, maxBodyBytes = 64 * 1024, maxResponseBytes = 256 * 1024, maxInflight = 4, maxGrants = 100 } = {}) {
  if (!vault || typeof vault.get !== "function" || typeof vault.has !== "function") throw new Error("VAULT_REQUIRED");
  const audit = createAuditChain({ filePath: stateDir ? path.join(stateDir, "broker-audit.jsonl") : null });
  const grantsFile = stateDir ? path.join(stateDir, "broker-grants.json") : null;
  if (stateDir) fs.mkdirSync(stateDir, { recursive: true });
  const grants = new Map(), win = new Map(), day = new Map();
  let inflight = 0, integrity = "OK";
  const stats = { requests: 0, ok: 0, denied: 0, upstreamErrors: 0, redactions: 0 };

  const save = () => {
    if (!grantsFile) return;
    const tmp = grantsFile + ".tmp", fd = fs.openSync(tmp, "w", 0o600);
    try { fs.writeSync(fd, JSON.stringify({ version: 1, grants: [...grants.values()].map(({ grant, approval }) => ({ grant, approval })) })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, grantsFile);
  };
  const revokedInChain = () => new Set(audit.entries().filter(x => x.event === "BROKER_GRANT_REVOKED").map(x => x.data?.id));
  (function load() {
    if (!grantsFile || !fs.existsSync(grantsFile)) return;
    let doc; try { doc = JSON.parse(fs.readFileSync(grantsFile, "utf8")); } catch { integrity = "GRANTS_FILE_UNREADABLE"; return; }
    if (!doc || !Array.isArray(doc.grants)) { integrity = "GRANTS_FILE_INVALID"; return; }
    const revoked = revokedInChain(); let dropped = 0;
    for (const r of doc.grants.slice(0, maxGrants)) {
      const n = normaliseGrant(r?.grant, { checkExpiry: false });      // expiry is enforced at request time; the stored form must already be the normalised form
      let same = false; try { same = !n.error && canon(n.grant) === canon(r.grant); } catch { same = false; }
      if (!same || !ownerAuth.verifyRecorded(r.approval, { action: "BROKER_GRANT", subject: grantSubject(n.grant) })) { dropped++; continue; }
      if (revoked.has(n.grant.id)) continue;
      grants.set(n.grant.id, { grant: n.grant, approval: r.approval });
    }
    if (dropped) { integrity = "GRANTS_FILE_ENTRIES_REJECTED:" + dropped; audit.append("BROKER_GRANTS_REJECTED_ON_LOAD", { dropped }); }
  })();

  function grant(def, { ownerApproval = null } = {}) {
    const n = normaliseGrant(def, { nowMs: now() });
    if (n.error) throw new Error(n.error);
    if (grants.size >= maxGrants && !grants.has(n.grant.id)) throw new Error("GRANT_LIMIT_REACHED");
    if (!vault.has(n.grant.credential)) throw new Error("GRANT_CREDENTIAL_NOT_IN_VAULT");
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "BROKER_GRANT", subject: grantSubject(n.grant) });
    if (!v.allowed) { audit.append("BROKER_GRANT_DENIED", { id: n.grant.id, reason: v.reason }); throw new Error("OWNER_APPROVAL_REQUIRED:BROKER_GRANT"); }
    grants.set(n.grant.id, { grant: n.grant, approval: ownerApproval }); save();
    audit.append("BROKER_GRANT_CREATED", { id: n.grant.id, credential: n.grant.credential, hosts: n.grant.hosts, methods: n.grant.methods, agents: n.grant.agents, roles: n.grant.roles, expiresAt: n.grant.expiresAt, nonce: ownerApproval.nonce });
    return { id: n.grant.id, expiresAt: n.grant.expiresAt };
  }
  function revokeGrant(id, { ownerApproval = null } = {}) {
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "BROKER_REVOKE", subject: String(id) });
    if (!v.allowed) { audit.append("BROKER_REVOKE_DENIED", { id: String(id).slice(0, 48), reason: v.reason }); throw new Error("OWNER_APPROVAL_REQUIRED:BROKER_REVOKE"); }
    if (!grants.has(id)) return false;
    grants.delete(id); save(); audit.append("BROKER_GRANT_REVOKED", { id, nonce: ownerApproval.nonce });
    return true;
  }
  /** Emergency: revoke every grant at once (owner-signed). */
  function revokeAll({ ownerApproval = null } = {}) {
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "BROKER_REVOKE_ALL", subject: "ALL" });
    if (!v.allowed) { audit.append("BROKER_REVOKE_ALL_DENIED", { reason: v.reason }); throw new Error("OWNER_APPROVAL_REQUIRED:BROKER_REVOKE_ALL"); }
    const ids = [...grants.keys()]; for (const id of ids) audit.append("BROKER_GRANT_REVOKED", { id, nonce: ownerApproval.nonce });
    grants.clear(); save(); audit.append("BROKER_REVOKED_ALL", { count: ids.length, nonce: ownerApproval.nonce });
    return ids.length;
  }

  const stamp = (m, key, span) => { const t = now(), a = (m.get(key) ?? []).filter(x => t - x < span); m.set(key, a); return a; };
  const deny = (reason, d = {}) => { stats.denied++; audit.append("BROKER_DENIED", { reason, ...d }); return { ok: false, reason }; };
  const allowedAgent = (g, agentId) => g.agents.includes(agentId) || (g.roles.length > 0 && g.roles.includes(roleOf(agentId)));
  const pathOk = (g, p) => g.pathPrefixes.some(x => x === "/" || p === x || p.startsWith(x.endsWith("/") ? x : x + "/"));

  async function readCapped(r) {
    const cap = maxResponseBytes;
    if (r.body && typeof r.body.getReader === "function") {
      const rd = r.body.getReader(), parts = []; let n = 0, truncated = false;
      for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > cap) { truncated = true; try { await rd.cancel(); } catch { /* ignore */ } parts.push(value.slice(0, value.length - (n - cap))); break; } parts.push(value); }
      return { text: Buffer.concat(parts.map(p => Buffer.from(p))).toString("utf8"), truncated };
    }
    const t = typeof r.text === "function" ? String(await r.text()) : "";
    return t.length > cap ? { text: t.slice(0, cap), truncated: true } : { text: t, truncated: false };
  }

  /** One brokered HTTPS request. Never throws; never returns or logs a credential. */
  async function request({ agentId, grantId, url, method = "GET", body = null, headers = {} } = {}) {
    stats.requests++;
    const who = String(agentId ?? "").slice(0, 40), gid = String(grantId ?? "").slice(0, 48);
    const D = (reason, extra = {}) => deny(reason, { agentId: who, grantId: gid, ...extra });
    try { const g0 = gate({ external: true }); if (!g0 || g0.allowed === false) return D("OWNER_STOP"); } catch { return D("OWNER_STOP"); }
    let vs; try { vs = vault.status(); } catch { return D("VAULT_UNAVAILABLE"); }
    if (vs.state !== "UNLOCKED") return D("VAULT_LOCKED");
    if (!AGENT_RE.test(who)) return D("AGENT_INVALID");
    if (isKnownAgent && !isKnownAgent(who)) return D("UNKNOWN_AGENT");
    const rec = grants.get(gid);
    if (!rec) return D("NO_SUCH_GRANT");
    const g = rec.grant;
    if (Date.parse(g.expiresAt) <= now()) return D("GRANT_EXPIRED");
    if (!allowedAgent(g, who)) return D("AGENT_NOT_ALLOWED");
    if (!vault.has(g.credential)) return D("CREDENTIAL_UNAVAILABLE");
    let u;
    try { if (typeof url !== "string" || url.length > 2048) throw new Error("x"); u = new URL(url); } catch { return D("URL_INVALID"); }
    if (u.protocol !== "https:") return D("HTTPS_REQUIRED");
    if (u.username || u.password) return D("URL_CREDENTIALS_FORBIDDEN");
    if (u.port && u.port !== "443") return D("PORT_NOT_ALLOWED");
    if (!g.hosts.includes(u.hostname)) return D("HOST_NOT_ALLOWED", { host: u.hostname.slice(0, 80) });
    if (!pathOk(g, u.pathname)) return D("PATH_NOT_ALLOWED", { host: u.hostname });
    const m = String(method).toUpperCase();
    if (!g.methods.includes(m)) return D("METHOD_NOT_ALLOWED", { method: m.slice(0, 8) });
    let payload;
    if (body !== null && body !== undefined) {
      if (READ.includes(m)) return D("BODY_NOT_ALLOWED_FOR_METHOD");
      try { payload = typeof body === "string" ? body : JSON.stringify(body); } catch { return D("BODY_NOT_SERIALISABLE"); }
      if (typeof payload !== "string" || Buffer.byteLength(payload) > maxBodyBytes) return D("BODY_TOO_LARGE");
    }
    const out = {};
    if (headers && typeof headers === "object") for (const [k, v] of Object.entries(headers)) {
      const lk = k.toLowerCase();
      if (!AGENT_HEADERS.has(lk) || typeof v !== "string" || v.length > 200 || /[\r\n\0]/.test(v)) return D("HEADER_NOT_ALLOWED", { header: lk.slice(0, 40) });
      out[lk] = v;
    }
    if (payload !== undefined && !out["content-type"]) out["content-type"] = "application/json";
    if (stamp(win, gid, 60000).length >= g.maxPerMinute) return D("RATE_LIMITED_MINUTE");
    if (stamp(day, gid, 86400000).length >= g.maxPerDay) return D("RATE_LIMITED_DAY");
    if (inflight >= maxInflight) return D("BROKER_BUSY");
    win.get(gid).push(now()); day.get(gid).push(now());
    let secret;
    try { secret = vault.get(g.credential, { purpose: "broker:" + g.id + ":" + who }); } catch { return D("CREDENTIAL_UNAVAILABLE"); }
    if (typeof secret !== "string" || !secret) return D("CREDENTIAL_UNAVAILABLE");
    if (g.auth.style === "bearer") out.authorization = "Bearer " + secret; else out[g.auth.name.toLowerCase()] = secret;
    const scrub = t => { let s = vault.redact(String(t ?? "")); for (const f of new Set([secret, encodeURIComponent(secret), Buffer.from(secret).toString("base64")])) if (f && s.includes(f)) { s = s.split(f).join("[REDACTED]"); stats.redactions++; } return s; };
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
    inflight++;
    try {
      const r = await fetchImpl(u, { method: m, headers: out, body: payload, redirect: "manual", signal: ctl.signal });
      const status = Number(r?.status) || 0;
      const hdr = {}; for (const h of RESPONSE_HEADERS) { const v = r?.headers?.get?.(h); if (v) hdr[h] = scrub(v).slice(0, 200); }
      let text = "", truncated = false;
      if (status >= 300 && status < 400) { stats.ok++; audit.append("BROKER_REQUEST", { agentId: who, grantId: g.id, host: u.hostname, method: m, path: u.pathname.slice(0, 200), status, redirectNotFollowed: true }); return { ok: false, reason: "REDIRECT_NOT_FOLLOWED", status, headers: hdr }; }
      if (m !== "HEAD") ({ text, truncated } = await readCapped(r));
      const bodyOut = scrub(text);
      stats.ok++;
      audit.append("BROKER_REQUEST", { agentId: who, grantId: g.id, host: u.hostname, method: m, path: u.pathname.slice(0, 200), status, bytes: Buffer.byteLength(text), truncated });
      return { ok: status >= 200 && status < 300, status, headers: hdr, body: bodyOut, truncated };
    } catch (e) {
      stats.upstreamErrors++;
      const msg = scrub(e?.name === "AbortError" ? "TIMEOUT" : e?.message).slice(0, 120);
      audit.append("BROKER_REQUEST_FAILED", { agentId: who, grantId: g.id, host: u.hostname, method: m, error: msg });
      return { ok: false, reason: "UPSTREAM_ERROR", error: msg };
    } finally { clearTimeout(timer); inflight--; secret = null; }
  }

  const listGrants = () => [...grants.values()].map(({ grant: g }) => ({ id: g.id, credential: g.credential, agents: g.agents, roles: g.roles, hosts: g.hosts, methods: g.methods, pathPrefixes: g.pathPrefixes, expiresAt: g.expiresAt, expired: Date.parse(g.expiresAt) <= now(), maxPerMinute: g.maxPerMinute, maxPerDay: g.maxPerDay, purpose: g.purpose }));
  return { grant, revokeGrant, revokeAll, request, listGrants, summary: () => ({ grants: grants.size, integrity, inflight, ...stats, auditHead: audit.head() }), auditVerify: () => audit.verify(), auditEntries: () => audit.entries() };
}
