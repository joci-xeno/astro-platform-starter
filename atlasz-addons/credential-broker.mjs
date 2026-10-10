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
// A grant is only honoured if the broker's hash-chained audit log says that exact grant content (its signed subject hash) is the LATEST version created for that id and was not revoked afterwards:
// restoring an old grants file, widening a grant, or re-adding a revoked one therefore does nothing. A file-write attacker can still delete the grant file (denial of service) or the whole audit file.
// Denied requests are audited at a bounded rate (the rest are only counted) so unauthenticated callers cannot grow the audit log without limit.
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
  const arr = (v, max) => Array.isArray(v) && v.length <= max ? [...v] : null;      // spread: holes in a sparse array become undefined and fail the element checks
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
  if (!pathPrefixes || !pathPrefixes.length || !pathPrefixes.every(p => typeof p === "string" && p.startsWith("/") && p.length <= 200 && !/[?#\\;]|\.\.|%2e|%2f|%5c|%3b/i.test(p))) return e("GRANT_PATH_PREFIX_INVALID");
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
  let integrity = "OK"; const flights = new Set();      // start times of fetches that have not really settled
  const liveFlights = () => { const t = now(); for (const f of [...flights]) if (t - f.t > 5 * timeoutMs) flights.delete(f); return flights.size; };      // a fetch that never settles stops counting after 5 timeouts, so it cannot block the broker forever
  const stats = { requests: 0, ok: 0, denied: 0, upstreamErrors: 0, redactions: 0, deniedNotAudited: 0 };
  const tryAudit = (event, data) => { try { audit.append(event, data); return true; } catch { return false; } };

  const save = () => {
    if (!grantsFile) return;
    const tmp = grantsFile + ".tmp"; try { fs.unlinkSync(tmp); } catch { /* none */ }
    const fd = fs.openSync(tmp, "wx", 0o600);      // never write through a pre-planted file or symlink
    try { fs.writeSync(fd, JSON.stringify({ version: 1, grants: [...grants.values()].map(({ grant, approval }) => ({ grant, approval })) })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, grantsFile); seenStamp = fstamp();
  };
  const latestInChain = () => { const m = new Map(); for (const x of audit.entries()) { if (x.event === "BROKER_GRANT_CREATED") m.set(x.data?.id, { type: "C", subject: x.data?.subject }); else if (x.event === "BROKER_GRANT_REVOKED") m.set(x.data?.id, { type: "R" }); } return m; };
  const fstamp = () => { try { const st = fs.statSync(grantsFile); return st.size + ":" + st.mtimeMs + ":" + st.ino; } catch { return "none"; } };
  let seenStamp = "";
  function load() {
    if (!grantsFile) return;
    seenStamp = fstamp();
    if (!fs.existsSync(grantsFile)) return;
    let doc; try { doc = JSON.parse(fs.readFileSync(grantsFile, "utf8")); } catch { integrity = "GRANTS_FILE_UNREADABLE"; return; }
    if (!doc || !Array.isArray(doc.grants)) { integrity = "GRANTS_FILE_INVALID"; return; }
    try { audit.reload(); } catch { integrity = "AUDIT_UNREADABLE"; grants.clear(); return; }
    const latest = latestInChain(); let dropped = 0;
    for (const r of doc.grants.slice(0, maxGrants)) {
      const n = normaliseGrant(r?.grant, { checkExpiry: false });      // expiry is enforced at request time; the stored form must already be the normalised form
      let same = false; try { same = !n.error && canon(n.grant) === canon(r.grant); } catch { same = false; }
      if (!same) { dropped++; continue; }
      const l = latest.get(n.grant.id);
      const subject = grantSubject(n.grant);
      if (!l || l.subject !== subject || !ownerAuth.verifyRecorded(r.approval, { action: "BROKER_GRANT", subject })) { dropped++; continue; }
      grants.set(n.grant.id, { grant: n.grant, approval: r.approval });
    }
    if (dropped) { integrity = "GRANTS_FILE_ENTRIES_REJECTED:" + dropped; tryAudit("BROKER_GRANTS_REJECTED_ON_LOAD", { dropped }); }
  }
  load();
  /** Another broker object / process may have granted or revoked since: re-read the grants file (and re-verify against the audit chain) when it changed. */
  const refresh = () => { if (grantsFile && fstamp() !== seenStamp) { grants.clear(); load(); } };

  function grant(def, { ownerApproval = null } = {}) {
    const n = normaliseGrant(def, { nowMs: now() });
    if (n.error) throw new Error(n.error);
    if (grants.size >= maxGrants && !grants.has(n.grant.id)) throw new Error("GRANT_LIMIT_REACHED");
    if (!vault.has(n.grant.credential)) throw new Error("GRANT_CREDENTIAL_NOT_IN_VAULT");
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "BROKER_GRANT", subject: grantSubject(n.grant) });
    if (!v.allowed) { audit.append("BROKER_GRANT_DENIED", { id: n.grant.id, reason: v.reason }); throw new Error("OWNER_APPROVAL_REQUIRED:BROKER_GRANT"); }
    const had = grants.get(n.grant.id);
    grants.set(n.grant.id, { grant: n.grant, approval: ownerApproval });
    try { audit.append("BROKER_GRANT_CREATED", { id: n.grant.id, subject: grantSubject(n.grant), credential: n.grant.credential, hosts: n.grant.hosts, methods: n.grant.methods, agents: n.grant.agents, roles: n.grant.roles, expiresAt: n.grant.expiresAt, nonce: ownerApproval.nonce }); save(); }
    catch (e) { if (had) grants.set(n.grant.id, had); else grants.delete(n.grant.id); throw e; }      // a grant that could not be recorded does not exist
    return { id: n.grant.id, expiresAt: n.grant.expiresAt };
  }
  function revokeGrant(id, { ownerApproval = null } = {}) {
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "BROKER_REVOKE", subject: String(id) });
    if (!v.allowed) { audit.append("BROKER_REVOKE_DENIED", { id: String(id).slice(0, 48), reason: v.reason }); throw new Error("OWNER_APPROVAL_REQUIRED:BROKER_REVOKE"); }
    if (!grants.has(id)) return false;
    grants.delete(id);      // effective immediately, whatever happens to the disk
    if (!tryAudit("BROKER_GRANT_REVOKED", { id, nonce: ownerApproval.nonce })) integrity = "REVOCATION_NOT_RECORDED";
    try { save(); } catch { if (integrity === "OK") integrity = "GRANTS_FILE_NOT_UPDATED"; }
    return true;
  }
  /** Emergency: revoke every grant at once (owner-signed). */
  function revokeAll({ ownerApproval = null } = {}) {
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "BROKER_REVOKE_ALL", subject: "ALL" });
    if (!v.allowed) { audit.append("BROKER_REVOKE_ALL_DENIED", { reason: v.reason }); throw new Error("OWNER_APPROVAL_REQUIRED:BROKER_REVOKE_ALL"); }
    const ids = [...grants.keys()]; grants.clear();
    let rec = true; for (const id of ids) rec = tryAudit("BROKER_GRANT_REVOKED", { id, nonce: ownerApproval.nonce }) && rec;
    tryAudit("BROKER_REVOKED_ALL", { count: ids.length, nonce: ownerApproval.nonce });
    if (!rec) integrity = "REVOCATION_NOT_RECORDED";
    try { save(); } catch { if (integrity === "OK") integrity = "GRANTS_FILE_NOT_UPDATED"; }
    return ids.length;
  }

  const stamp = (m, key, span) => { const t = now(), a = (m.get(key) ?? []).filter(x => t - x < span); m.set(key, a); return a; };
  let dWin = { t: 0, n: 0, suppressed: 0 };
  const DENY_AUDIT_PER_MIN = 30;
  const auditDenied = entry => {
    const t = now();
    if (t - dWin.t >= 60000) { if (dWin.suppressed) tryAudit("BROKER_DENIED_SUPPRESSED", { count: dWin.suppressed }); dWin = { t, n: 0, suppressed: 0 }; }
    if (dWin.n < DENY_AUDIT_PER_MIN) { dWin.n++; tryAudit("BROKER_DENIED", entry); } else { dWin.suppressed++; stats.deniedNotAudited++; }
  };
  const deny = (reason, d = {}) => { stats.denied++; auditDenied({ reason, ...d }); return { ok: false, reason }; };
  const safeStr = (v, n) => { try { return String(v ?? "").slice(0, n); } catch { return ""; } };
  const allowedAgent = (g, agentId) => g.agents.includes(agentId) || (g.roles.length > 0 && g.roles.includes(roleOf(agentId)));
  const pathOk = (g, p) => g.pathPrefixes.some(x => x === "/" || p === x || p.startsWith(x.endsWith("/") ? x : x + "/"));

  async function readCapped(r, limit) {
    if (r.body && typeof r.body.getReader === "function") {
      const rd = r.body.getReader(), parts = []; let n = 0, truncated = false;
      for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > limit) { truncated = true; try { await rd.cancel(); } catch { /* ignore */ } parts.push(value.slice(0, value.length - (n - limit))); break; } parts.push(value); }
      return { text: Buffer.concat(parts.map(p => Buffer.from(p))).toString("utf8"), truncated };
    }
    const t = typeof r.text === "function" ? String(await r.text()) : "";
    return t.length > limit ? { text: t.slice(0, limit), truncated: true } : { text: t, truncated: false };
  }

  /** One brokered HTTPS request. Never throws; never returns or logs a credential. */
  async function request(args) {
    stats.requests++;
    try { return await request0(args); }
    catch { stats.upstreamErrors++; return { ok: false, reason: "BROKER_ERROR" }; }      // e.g. hostile argument objects or an unusable audit log: no detail, nothing leaked
  }
  async function request0(args) {
    const a = args && typeof args === "object" ? args : {};
    const who = safeStr(a.agentId, 40), gid = safeStr(a.grantId, 48);
    const D = (reason, extra = {}) => deny(reason, { agentId: who, grantId: gid, ...extra });
    try { const g0 = gate({ external: true }); if (!g0 || g0.allowed === false) return D("OWNER_STOP"); } catch { return D("OWNER_STOP"); }
    let vs; try { vs = vault.status(); } catch { return D("VAULT_UNAVAILABLE"); }
    if (vs.state !== "UNLOCKED") return D("VAULT_LOCKED");
    if (typeof a.agentId !== "string" || !AGENT_RE.test(a.agentId)) return D("AGENT_INVALID");      // validated on the RAW value, not the truncated one
    if (isKnownAgent && !isKnownAgent(who)) return D("UNKNOWN_AGENT");
    refresh();
    const rec = typeof a.grantId === "string" && ID_RE.test(a.grantId) ? grants.get(a.grantId) : null;
    if (!rec) return D("NO_SUCH_GRANT");
    const g = rec.grant;
    if (Date.parse(g.expiresAt) <= now()) return D("GRANT_EXPIRED");
    if (!allowedAgent(g, who)) return D("AGENT_NOT_ALLOWED");
    if (!vault.has(g.credential)) return D("CREDENTIAL_UNAVAILABLE");
    let u;
    try { if (typeof a.url !== "string" || a.url.length > 2048) throw new Error("x"); u = new URL(a.url); } catch { return D("URL_INVALID"); }
    if (u.protocol !== "https:") return D("HTTPS_REQUIRED");
    if (u.username || u.password) return D("URL_CREDENTIALS_FORBIDDEN");
    if (u.port && u.port !== "443") return D("PORT_NOT_ALLOWED");
    if (!g.hosts.includes(u.hostname)) return D("HOST_NOT_ALLOWED", { host: u.hostname.slice(0, 80) });
    if (!pathOk(g, u.pathname) || /%2f|%5c|%2e|%00|%3b|;/i.test(u.pathname)) return D("PATH_NOT_ALLOWED", { host: u.hostname });      // encoded slashes/dots could be decoded by the server into a path outside the grant
    const m = safeStr(a.method ?? "GET", 12).toUpperCase();
    if (!g.methods.includes(m)) return D("METHOD_NOT_ALLOWED", { method: m.slice(0, 8) });
    let payload;
    if (a.body !== null && a.body !== undefined) {
      if (READ.includes(m)) return D("BODY_NOT_ALLOWED_FOR_METHOD");
      try { payload = typeof a.body === "string" ? a.body : JSON.stringify(a.body); } catch { return D("BODY_NOT_SERIALISABLE"); }
      if (typeof payload !== "string" || Buffer.byteLength(payload) > maxBodyBytes) return D("BODY_TOO_LARGE");
    }
    const out = {};
    if (a.headers && typeof a.headers === "object") for (const [k, v] of Object.entries(a.headers)) {
      const lk = k.toLowerCase();
      if (!AGENT_HEADERS.has(lk) || typeof v !== "string" || v.length > 200 || /[\r\n\0]/.test(v)) return D("HEADER_NOT_ALLOWED", { header: lk.slice(0, 40) });
      out[lk] = v;
    }
    if (payload !== undefined && !out["content-type"]) out["content-type"] = "application/json";
    if (stamp(win, gid, 60000).length >= g.maxPerMinute) return D("RATE_LIMITED_MINUTE");
    if (stamp(day, gid, 86400000).length >= g.maxPerDay) return D("RATE_LIMITED_DAY");
    if (liveFlights() >= maxInflight) return D("BROKER_BUSY");
    win.get(gid).push(now()); day.get(gid).push(now());
    if (!tryAudit("BROKER_REQUEST_START", { agentId: who, grantId: g.id, host: u.hostname, method: m, path: u.pathname.slice(0, 200) })) return D("AUDIT_UNAVAILABLE");      // a request only goes out when its start can be audited
    let secret;
    try { secret = vault.get(g.credential, { purpose: "broker:" + g.id + ":" + who }); } catch { return D("CREDENTIAL_UNAVAILABLE"); }
    if (typeof secret !== "string" || !secret) return D("CREDENTIAL_UNAVAILABLE");
    if (g.auth.style === "bearer") out.authorization = "Bearer " + secret; else out[g.auth.name.toLowerCase()] = secret;
    const sb = Buffer.from(secret, "utf8"), b64 = sb.toString("base64");
    const forms = [...new Set([secret, encodeURIComponent(secret), encodeURIComponent(encodeURIComponent(secret)), b64, b64.replace(/=+$/, ""), sb.toString("base64url"), sb.toString("hex"), sb.toString("hex").toUpperCase(), JSON.stringify(secret).slice(1, -1), escape(secret), [...secret].map(c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""), [...secret].reverse().join("")])].filter(f => f && f.length >= 4);
    const scrub = t => { let s = vault.redact(String(t ?? "")); for (const f of forms) if (s.includes(f)) { s = s.split(f).join("[REDACTED]"); stats.redactions++; } return s; };      // common encodings only: an upstream that transforms the secret arbitrarily cannot be fully covered
    const ctl = new AbortController();
    let timer; const deadline = new Promise((_, rej) => { timer = setTimeout(() => { ctl.abort(); rej(Object.assign(new Error("timeout"), { name: "AbortError" })); }, timeoutMs); });
    deadline.catch(() => {});
    const fl = { t: now() }; flights.add(fl);
    try {
      const pending = Promise.resolve().then(() => fetchImpl(u, { method: m, headers: out, body: payload, redirect: "manual", signal: ctl.signal })); pending.catch(() => {}); pending.finally(() => flights.delete(fl)).catch(() => {});      // the slot is released when the fetch truly settles, not when we stop waiting
      const r = await Promise.race([pending, deadline]);      // a fetch that ignores the abort signal still cannot hold the broker
      const status = Number(r?.status) || 0;
      const hdr = {}; for (const h of RESPONSE_HEADERS) { const v = r?.headers?.get?.(h); if (v) hdr[h] = scrub(v).slice(0, 200); }
      if (status >= 300 && status < 400) { stats.ok++; tryAudit("BROKER_REQUEST", { agentId: who, grantId: g.id, host: u.hostname, method: m, path: u.pathname.slice(0, 200), status, redirectNotFollowed: true }); return { ok: false, reason: "REDIRECT_NOT_FOLLOWED", status, headers: hdr }; }
      let text = "", rawTruncated = false;
      if (m !== "HEAD") ({ text, truncated: rawTruncated } = await Promise.race([readCapped(r, maxResponseBytes + 3 * secret.length + 256), deadline]));      // read a margin beyond the cap so a secret straddling the cap is still redacted whole
      let bodyOut = scrub(text), truncated = rawTruncated;
      if (bodyOut.length > maxResponseBytes) { bodyOut = bodyOut.slice(0, maxResponseBytes); truncated = true; }
      stats.ok++;
      tryAudit("BROKER_REQUEST", { agentId: who, grantId: g.id, host: u.hostname, method: m, path: u.pathname.slice(0, 200), status, bytes: Buffer.byteLength(bodyOut), truncated });
      return { ok: status >= 200 && status < 300, status, headers: hdr, body: bodyOut, truncated };
    } catch (e) {
      stats.upstreamErrors++;
      const msg = scrub(e?.name === "AbortError" ? "TIMEOUT" : e?.message).slice(0, 120);
      tryAudit("BROKER_REQUEST_FAILED", { agentId: who, grantId: g.id, host: u.hostname, method: m, error: msg });
      return { ok: false, reason: "UPSTREAM_ERROR", error: msg };
    } finally { clearTimeout(timer); secret = null; }
  }

  const listGrants = () => [...grants.values()].map(({ grant: g }) => ({ id: g.id, credential: g.credential, agents: g.agents, roles: g.roles, hosts: g.hosts, methods: g.methods, pathPrefixes: g.pathPrefixes, expiresAt: g.expiresAt, expired: Date.parse(g.expiresAt) <= now(), maxPerMinute: g.maxPerMinute, maxPerDay: g.maxPerDay, purpose: g.purpose }));
  return { grant, revokeGrant, revokeAll, request, listGrants, summary: () => ({ grants: grants.size, integrity, inflight: liveFlights(), ...stats, auditHead: audit.head() }), auditVerify: () => audit.verify(), auditEntries: () => audit.entries() };
}
