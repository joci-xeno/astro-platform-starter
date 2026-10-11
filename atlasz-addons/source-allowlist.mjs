// Owner-approved SOURCE ALLOWLIST for external opportunity discovery (Global Business package §2; integration report §4 "source allowlist" + §5 conflict 2
// "owner approves sources country by country"). Decision engine only: it never opens a connection, never downloads, never fetches.
//
//   entry     {sourceId, hosts[] (exact, lowercase, no wildcard / IP / port / userinfo), country (ISO-3166 alpha-2), category, licenceNote (terms/licence note, required),
//             rateLimit {maxRequestsPerHour, minIntervalMs}, requiresCredentialRef (credential NAME or null; never a value), pathPrefixes[]}
//   EMPTY BY DEFAULT: with no approved entry every check() is denied, so no external discovery is possible.
//   allow     an entry becomes effective only when BOTH are recorded in the hash-chained log with a valid owner signature:
//               - SOURCE_ALLOW          subject = "source:<sourceId>:<entryHash>"   (bound to the exact normalised entry; any change needs a new approval)
//               - SOURCE_COUNTRY_ALLOW  subject = "source-country:<CC>"             (per-country approval)
//             Approvals are verified live through owner-auth (expiry, nonce, replay) when recorded, and every record's signature is re-checked
//             (verifyRecorded) each time the log is folded, so an edited / forged / unsigned record yields NO entry (fail closed). A nonce seen twice in the log is
//             ignored the second time (replayed approval copied into the log).
//   disable   disableSource / revokeCountry need no approval (they can only reduce what is reachable); re-enabling needs a fresh signed approval.
//   check     deny by default: not stopped, entry effective, country approved, https only, ASCII-only authority, no userinfo / percent / backslash / trailing dot,
//             no IP literals, WHATWG hostname == raw hostname, EXACT host match, port 443, path under a prefix, no traversal, credential reference resolvable, rate limit.
//   redirect  checkRedirect(sourceId, fromUrl, location): another host / scheme / port is refused; the target is then checked like a fresh request.
//
// Status honesty: IMPLEMENTED + unit TESTED with synthetic data. NOT CONNECTED (no runtime HTTP caller consults it yet), not LIVE. No source is approved in this repository.
// Limits: it cannot see the real TCP connection (DNS pinning is egress-policy's job); rate-limit counters are per process (in memory, bounded); terms/licence compliance is
// recorded as an owner-written note, not verified by this module.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { containsSecret } from "./secret-patterns.mjs";

export const CATEGORIES = Object.freeze(["PROCUREMENT", "GRANT", "FREELANCE", "NEWS", "MARKET", "CORPORATE_REGISTRY", "SOCIAL_PUBLIC"]);
export const LIMITS = Object.freeze({ maxEntries: 200, maxHosts: 10, maxPrefixes: 10, maxNote: 500, maxPerHour: 3600, maxIntervalMs: 24 * 3600 * 1000, recentDecisions: 300, urlChars: 2048 });
const sha = t => createHash("sha256").update(t).digest("hex");
const ID_RE = /^[a-z0-9][a-z0-9_.-]{1,47}$/;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const BAD_TLD = new Set(["local", "localhost", "internal", "lan", "home", "corp", "intranet", "localdomain", "arpa", "test", "invalid", "example", "onion"]);
const CC_RE = /^[A-Z]{2}$/, CRED_RE = /^[A-Z][A-Z0-9_]{2,63}$/;
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

const canonEntry = e => JSON.stringify({ sourceId: e.sourceId, hosts: [...e.hosts].sort(), country: e.country, category: e.category, licenceNote: e.licenceNote, rateLimit: { maxRequestsPerHour: e.rateLimit.maxRequestsPerHour, minIntervalMs: e.rateLimit.minIntervalMs }, requiresCredentialRef: e.requiresCredentialRef, pathPrefixes: [...e.pathPrefixes].sort() });
export const entryHash = e => sha(canonEntry(e)).slice(0, 32);
export const entrySubject = e => "source:" + e.sourceId + ":" + entryHash(e);
export const countrySubject = cc => "source-country:" + cc;

/** Validate + normalise. Returns {entry} or {error}; never throws. */
export function normaliseSourceEntry(raw) {
  const e = error => ({ error });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return e("ENTRY_OBJECT_REQUIRED");
  if (typeof raw.sourceId !== "string" || !ID_RE.test(raw.sourceId) || RESERVED.has(raw.sourceId)) return e("SOURCE_ID_INVALID");
  if (!Array.isArray(raw.hosts) || !raw.hosts.length || raw.hosts.length > LIMITS.maxHosts) return e("HOSTS_REQUIRED");
  for (const h of raw.hosts) {
    if (typeof h !== "string" || h !== h.toLowerCase() || !HOST_RE.test(h)) return e("HOST_INVALID:" + String(h).slice(0, 60));
    if (BAD_TLD.has(h.split(".").at(-1))) return e("HOST_NOT_PUBLIC:" + h);
  }
  if (typeof raw.country !== "string" || !CC_RE.test(raw.country)) return e("COUNTRY_MUST_BE_ISO_ALPHA2");
  if (!CATEGORIES.includes(raw.category)) return e("CATEGORY_INVALID");
  if (typeof raw.licenceNote !== "string" || raw.licenceNote.trim().length < 3 || raw.licenceNote.length > LIMITS.maxNote || /[\u0000-\u001f\u007f]/.test(raw.licenceNote)) return e("LICENCE_NOTE_REQUIRED");
  if (containsSecret(raw.licenceNote)) return e("SECRET_IN_ENTRY_REFUSED");
  const rl = raw.rateLimit;
  if (!rl || typeof rl !== "object" || !Number.isInteger(rl.maxRequestsPerHour) || rl.maxRequestsPerHour < 1 || rl.maxRequestsPerHour > LIMITS.maxPerHour) return e("RATE_LIMIT_INVALID");
  const minIntervalMs = rl.minIntervalMs ?? 0;
  if (!Number.isInteger(minIntervalMs) || minIntervalMs < 0 || minIntervalMs > LIMITS.maxIntervalMs) return e("RATE_LIMIT_INVALID");
  const cred = raw.requiresCredentialRef ?? null;
  if (cred !== null && (typeof cred !== "string" || !CRED_RE.test(cred) || containsSecret(cred))) return e("CREDENTIAL_REF_MUST_BE_A_NAME");
  const prefixes = raw.pathPrefixes ?? ["/"];
  if (!Array.isArray(prefixes) || !prefixes.length || prefixes.length > LIMITS.maxPrefixes || !prefixes.every(p => typeof p === "string" && p.startsWith("/") && p.length <= 200 && !/[?#\\%;\s]|\/\.\.?(?:\/|$)|\/\//.test(p))) return e("PATH_PREFIX_INVALID");
  return { entry: { sourceId: raw.sourceId, hosts: [...new Set(raw.hosts)], country: raw.country, category: raw.category, licenceNote: raw.licenceNote.trim(), rateLimit: { maxRequestsPerHour: rl.maxRequestsPerHour, minIntervalMs }, requiresCredentialRef: cred, pathPrefixes: [...new Set(prefixes)] } };
}

const RAW_URL = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/;
/** Strict URL dissection: raw parse and WHATWG parse must agree. Returns {scheme, host, port, path} or {error}. */
export function dissectUrl(url) {
  if (typeof url !== "string" || !url || url.length > LIMITS.urlChars) return { error: "URL_INVALID" };
  if (/[^\x21-\x7e]/.test(url)) return { error: "NON_ASCII_OR_WHITESPACE_IN_URL" };
  const m = RAW_URL.exec(url); if (!m) return { error: "URL_NOT_ABSOLUTE" };
  const scheme = m[1].toLowerCase(), authority = m[2], rawPath = m[3] || "/";
  if (scheme !== "https") return { error: "SCHEME_NOT_ALLOWED" };
  if (authority.includes("@")) return { error: "USERINFO_REFUSED" };
  if (authority.includes("%") || authority.includes("\\")) return { error: "ENCODED_OR_BACKSLASH_HOST_REFUSED" };
  if (authority.startsWith("[")) return { error: "IP_LITERAL_REFUSED" };
  const k = authority.lastIndexOf(":"); const host = (k >= 0 ? authority.slice(0, k) : authority).toLowerCase(), portStr = k >= 0 ? authority.slice(k + 1) : null;
  if (!host) return { error: "HOST_MISSING" };
  if (host.endsWith(".")) return { error: "TRAILING_DOT_HOST_REFUSED" };
  if (/^[0-9.]+$/.test(host) || /^0x/i.test(host)) return { error: "IP_LITERAL_REFUSED" };
  if (portStr !== null && (!/^[1-9]\d{0,4}$/.test(portStr) || Number(portStr) > 65535)) return { error: "PORT_INVALID" };
  let u; try { u = new URL(url); } catch { return { error: "URL_INVALID" }; }
  if (u.hostname !== host) return { error: "HOST_NORMALISATION_MISMATCH" };
  if (/%(?:2e|2f|5c|00)/i.test(rawPath) || rawPath.includes("\\") || rawPath.split("/").some(s => s === "." || s === "..") || rawPath.includes("//")) return { error: "PATH_TRAVERSAL_OR_ENCODED_SEPARATOR" };
  if (u.pathname !== rawPath) return { error: "PATH_NORMALISATION_MISMATCH" };
  return { scheme, host, port: portStr !== null ? Number(portStr) : 443, path: rawPath };
}
const underPrefix = (p, prefix) => prefix === "/" || p === prefix || p.startsWith(prefix.endsWith("/") ? prefix : prefix + "/");

export function createSourceAllowlist({ ownerAuth, stateDir = null, isStopped = () => false, hasCredential = () => false, nowFn = () => Date.now() } = {}) {
  if (!ownerAuth || typeof ownerAuth.verifyApproval !== "function" || typeof ownerAuth.verifyRecorded !== "function") throw new Error("OWNER_AUTH_REQUIRED");
  if (stateDir) fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const now = () => new Date(nowFn()).toISOString();
  const log = createAuditChain({ filePath: stateDir ? path.join(stateDir, "source-allowlist-audit.jsonl") : null, now, headPinFile: stateDir ? path.join(stateDir, "source-allowlist-audit.headpin.json") : null });
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };
  const rate = new Map(), recent = [], stats = { allowed: 0, denied: 0 };
  let integrity = "OK";

  /** Fold the verified log into {entries: Map, countries: Set}. Tampered log -> nothing is allowed. */
  function fold() {
    try { log.reload(); } catch { integrity = "ALLOWLIST_LOG_TAMPERED"; return { entries: new Map(), countries: new Set() }; }
    const entries = new Map(), countries = new Set(), nonces = new Set(); let bad = 0;
    const freshNonce = a => { const n = a && typeof a.nonce === "string" ? a.nonce : null; if (!n || nonces.has(n)) return false; nonces.add(n); return true; };
    for (const ev of log.entries()) {
      const d = ev.data ?? {};
      if (ev.event === "SOURCE_ALLOWED") {
        const n = normaliseSourceEntry(d.entry);
        if (n.error || entrySubject(n.entry) !== d.subject || !freshNonce(d.approval) || !ownerAuth.verifyRecorded(d.approval, { action: "SOURCE_ALLOW", subject: d.subject })) { bad++; continue; }
        entries.set(n.entry.sourceId, n.entry);
      } else if (ev.event === "SOURCE_COUNTRY_ALLOWED") {
        if (typeof d.country !== "string" || !CC_RE.test(d.country) || !freshNonce(d.approval) || !ownerAuth.verifyRecorded(d.approval, { action: "SOURCE_COUNTRY_ALLOW", subject: countrySubject(d.country) })) { bad++; continue; }
        countries.add(d.country);
      } else if (ev.event === "SOURCE_DISABLED") entries.delete(d.sourceId);
      else if (ev.event === "SOURCE_COUNTRY_REVOKED") countries.delete(d.country);
    }
    integrity = bad ? "UNVERIFIED_RECORDS_IGNORED:" + bad : "OK";
    return { entries, countries };
  }

  function allowSource(raw, { approval = null } = {}) {
    const n = normaliseSourceEntry(raw); if (n.error) return { ok: false, reason: n.error };
    const st = fold(); if (!st.entries.has(n.entry.sourceId) && st.entries.size >= LIMITS.maxEntries) return { ok: false, reason: "ALLOWLIST_FULL" };
    const subject = entrySubject(n.entry);
    const v = ownerAuth.verifyApproval(approval, { action: "SOURCE_ALLOW", subject });
    if (!v.allowed) { log.append("SOURCE_ALLOW_DENIED", { sourceId: n.entry.sourceId, reason: v.reason }); return { ok: false, reason: "OWNER_APPROVAL_REQUIRED", detail: v.reason, subject }; }
    log.append("SOURCE_ALLOWED", { entry: n.entry, subject, approval });
    return { ok: true, sourceId: n.entry.sourceId, subject, countryApproved: st.countries.has(n.entry.country) };
  }
  function approveCountry(country, { approval = null } = {}) {
    if (typeof country !== "string" || !CC_RE.test(country)) return { ok: false, reason: "COUNTRY_MUST_BE_ISO_ALPHA2" };
    const v = ownerAuth.verifyApproval(approval, { action: "SOURCE_COUNTRY_ALLOW", subject: countrySubject(country) });
    if (!v.allowed) { log.append("SOURCE_COUNTRY_DENIED", { country, reason: v.reason }); return { ok: false, reason: "OWNER_APPROVAL_REQUIRED", detail: v.reason, subject: countrySubject(country) }; }
    log.append("SOURCE_COUNTRY_ALLOWED", { country, approval });
    return { ok: true, country };
  }
  function disableSource(sourceId, { reason = null } = {}) {
    if (typeof sourceId !== "string" || !ID_RE.test(sourceId)) return { ok: false, reason: "SOURCE_ID_INVALID" };
    log.append("SOURCE_DISABLED", { sourceId, reason: String(reason ?? "").slice(0, 200) }); rate.delete(sourceId); return { ok: true };
  }
  function revokeCountry(country) {
    if (typeof country !== "string" || !CC_RE.test(country)) return { ok: false, reason: "COUNTRY_MUST_BE_ISO_ALPHA2" };
    log.append("SOURCE_COUNTRY_REVOKED", { country }); return { ok: true };
  }

  function decide(allowed, reason, info) {
    const d = { allowed, reason, sourceId: info.sourceId ?? null, host: info.host ?? null, path: info.path ?? null, at: now() };
    allowed ? stats.allowed++ : stats.denied++; recent.push(d); if (recent.length > LIMITS.recentDecisions) recent.shift();
    return d;
  }
  /** Effective entry (approved AND its country approved) or null. */
  function effective(sourceId) { const st = fold(); const e = st.entries.get(sourceId); return e && st.countries.has(e.country) ? structuredClone(e) : null; }

  /** check(sourceId, url, {consume=true}) -> {allowed, reason, ...}. Never throws. consume=false is a dry run (no rate-limit slot used). */
  function check(sourceId, url, { consume = true } = {}) {
    const info = { sourceId: typeof sourceId === "string" ? sourceId.slice(0, 48) : null };
    const D = r => decide(false, r, info);
    if (stopped()) return D("OWNER_STOP");
    if (typeof sourceId !== "string" || !ID_RE.test(sourceId) || RESERVED.has(sourceId)) return D("SOURCE_ID_INVALID");
    const st = fold(), e = st.entries.get(sourceId);
    if (!e) return D("SOURCE_NOT_ALLOWLISTED");
    if (!st.countries.has(e.country)) return D("COUNTRY_NOT_APPROVED:" + e.country);
    const u = dissectUrl(url); if (u.error) return D(u.error);
    Object.assign(info, { host: u.host, path: u.path });
    if (!e.hosts.includes(u.host)) return D("HOST_NOT_ALLOWLISTED");
    if (u.port !== 443) return D("PORT_NOT_ALLOWED");
    if (!e.pathPrefixes.some(p => underPrefix(u.path, p))) return D("PATH_NOT_ALLOWLISTED");
    if (e.requiresCredentialRef) { let has = false; try { has = Boolean(hasCredential(e.requiresCredentialRef)); } catch { has = false; } if (!has) return D("CREDENTIAL_NOT_CONFIGURED:" + e.requiresCredentialRef); }
    const t = nowFn(), r = rate.get(sourceId) ?? { hits: [] };
    r.hits = r.hits.filter(x => t - x < 3600 * 1000);
    if (r.hits.length >= e.rateLimit.maxRequestsPerHour) return D("RATE_LIMIT_HOURLY");
    if (r.hits.length && t - r.hits.at(-1) < e.rateLimit.minIntervalMs) return D("RATE_LIMIT_INTERVAL");
    if (consume) { r.hits.push(t); if (r.hits.length > LIMITS.maxPerHour) r.hits.shift(); rate.set(sourceId, r); }
    return { ...decide(true, null, info), licenceNote: e.licenceNote, category: e.category, country: e.country };
  }
  /** A redirect must stay on the same host and scheme, then passes check() as a fresh request. */
  function checkRedirect(sourceId, fromUrl, location) {
    const info = { sourceId: typeof sourceId === "string" ? sourceId.slice(0, 48) : null };
    const from = dissectUrl(fromUrl); if (from.error) return decide(false, "REDIRECT_FROM_INVALID_URL", info);
    if (typeof location !== "string" || !location || location.length > LIMITS.urlChars) return decide(false, "REDIRECT_LOCATION_INVALID", info);
    let target;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(location)) target = location;
    else if (location.startsWith("//")) target = "https:" + location;
    else if (location.startsWith("/")) target = "https://" + from.host + (from.port === 443 ? "" : ":" + from.port) + location;
    else return decide(false, "REDIRECT_RELATIVE_PATH_REFUSED", info);
    const to = dissectUrl(target); if (to.error) return decide(false, "REDIRECT_" + to.error, { ...info, host: from.host });
    if (to.host !== from.host) return decide(false, "REDIRECT_TO_OTHER_HOST", { ...info, host: to.host });
    if (to.port !== from.port) return decide(false, "REDIRECT_PORT_CHANGE", { ...info, host: to.host });
    return check(sourceId, target);
  }

  const list = () => { const st = fold(); return [...st.entries.values()].map(e => ({ ...structuredClone(e), entryHash: entryHash(e), countryApproved: st.countries.has(e.country), effective: st.countries.has(e.country) })); };
  const countries = () => [...fold().countries].sort();
  const summary = () => { const st = fold(); return { state: "IMPLEMENTED_NOT_CONNECTED", entries: st.entries.size, effective: [...st.entries.values()].filter(e => st.countries.has(e.country)).length, approvedCountries: st.countries.size, integrity, ...stats, auditHead: log.head(), note: st.entries.size ? null : "EMPTY: no source is approved, so no external discovery is possible" }; };
  return { allowSource, approveCountry, disableSource, revokeCountry, check, checkRedirect, effective, list, countries, summary, recentDecisions: () => structuredClone(recent), audit: () => log.entries(), auditVerify: () => log.verifyFile() };
}
