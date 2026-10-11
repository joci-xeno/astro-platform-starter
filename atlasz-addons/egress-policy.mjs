// ATLASZ per-provider egress allowlist (23-point item 3: controlled outbound traffic) + commit leak gate. Decision engine only: it never opens a connection itself.
//
//   policy   {providerId, hosts[], pathPrefixes[], methods[], maxBodyBytes, ports[], loopback?}. A policy is owner DATA: setPolicy / removePolicy need a signed owner approval
//            (owner-auth.mjs) bound to the exact normalised policy content. Policies live in a hash-chained audit log together with their approvals and are rebuilt from it;
//            every record's owner signature is re-checked on load (verifyRecorded), so an edited or forged record yields NO policy (fail closed).
//   check    deny by default. A request is allowed only if a policy exists for its providerId AND: https (http only for the loopback provider) / no userinfo@ / ASCII-only
//            authority (IDN and look-alike hosts must be listed in their exact punycode form and sent in that form) / no percent-encoding or backslash in the host / no trailing dot /
//            the WHATWG-parsed hostname equals the raw hostname (this refuses numeric, hex, octal and shortened IPv4 forms such as 2130706433, 0x7f.1, 127.1) / EXACT host match
//            (no suffix or wildcard matching: "api.example.com.evil.net" and "evil-api.example.com" never match "api.example.com") / port in policy / method in policy /
//            path under a policy prefix at a segment boundary with no dot-segments or encoded separators / body within maxBodyBytes / not stopped.
//   DNS      rebinding-style protection: for a non-loopback provider the caller passes the addresses its resolver returned (`resolvedAddresses`) and the connection must be
//            pinned to them; ANY private, loopback, link-local, CGNAT, multicast, unspecified, documentation or IPv4-mapped/NAT64-private address -> DENY. With the
//            default requireResolvedAddresses=true a request without resolved addresses is denied. IP literals are refused except for the one loopback provider whose
//            only host may be 127.0.0.1 (e.g. a local Ollama on 127.0.0.1:11434). "localhost" is never accepted (it is a name, and names can be re-pointed).
//   redirect checkRedirect(original, location): a redirect to another host, another scheme, or anything that fails check() is refused.
//   audit    every decision (allow and deny) is appended to a separate hash-chained decision log (host, method, path; never the query string or body).
//   commitLeakGate(diffText)  refuses a diff whose ADDED lines contain credential-shaped strings (secret-patterns.mjs) or add key/secret files; returns the offending lines REDACTED.
//
// Status honesty: IMPLEMENTED + unit TESTED locally. Not yet CONNECTED: no existing HTTP caller (credential broker, connectors, model gateway) consults it, so it enforces
// nothing at runtime until wired. Not LIVE. Limits: it cannot see the real TCP connection - if the caller resolves DNS again after the check, or does not pin the connection
// to the checked addresses, rebinding is still possible; TLS interception and a compromised resolver are out of scope; the leak gate is pattern-based (unknown credential
// formats or secrets split across lines are not recognised); the decision log grows with traffic (no rotation yet).
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { createHash } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { scrub, containsSecret } from "./secret-patterns.mjs";

const sha = t => createHash("sha256").update(t).digest("hex");
const PROVIDER_RE = /^[a-z0-9][a-z0-9_.-]{1,47}$/;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;      // lowercase LDH labels, at least one dot, no trailing dot
const BAD_TLD = new Set(["local", "localhost", "internal", "lan", "home", "corp", "intranet", "localdomain", "arpa", "test", "invalid", "example", "onion", "home-router"]);
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
export const LOOPBACK_HOST = "127.0.0.1";
export const MAX_BODY_CAP = 10 * 1024 * 1024;

// ------------------------------------------------------------------ IP classification
function v4Class(o) {
  const [a, b, c] = o;
  if (a === 0) return "UNSPECIFIED";
  if (a === 127) return "LOOPBACK";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "PRIVATE";
  if (a === 169 && b === 254) return "LINK_LOCAL";
  if (a === 100 && b >= 64 && b <= 127) return "CGNAT";
  if (a >= 224 && a <= 239) return "MULTICAST";
  if (a >= 240) return "RESERVED";                                                                  // includes 255.255.255.255
  if ((a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 88 && c === 99)) return "RESERVED";
  return "PUBLIC";
}
function expand6(ip) {
  let s = ip.toLowerCase(); const z = s.indexOf("%"); if (z >= 0) s = s.slice(0, z);                // zone id ("fe80::1%eth0") is dropped for classification
  let tail = [];
  const m = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) { const o = m[1].split(".").map(Number); tail = [((o[0] << 8) | o[1]).toString(16), ((o[2] << 8) | o[3]).toString(16)]; s = s.slice(0, -m[1].length) + "x:x"; }
  const [h, t] = s.includes("::") ? s.split("::") : [s, null];
  const head = h ? h.split(":") : [], rest = t !== null ? (t ? t.split(":") : []) : [];
  const fill = t !== null ? Array(8 - head.length - rest.length).fill("0") : [];
  let parts = [...head, ...fill, ...rest];
  if (tail.length) parts = [...parts.slice(0, -2), ...tail];
  return parts.map(p => parseInt(p || "0", 16));
}
/** Classify an IP literal. Returns PUBLIC / LOOPBACK / PRIVATE / LINK_LOCAL / CGNAT / MULTICAST / UNSPECIFIED / RESERVED, or null for something that is not an IP. */
export function classifyIp(ip) {
  const s = String(ip ?? "").replace(/^\[|\]$/g, "");
  const kind = net.isIP(s.split("%")[0]);
  if (kind === 4) { if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(s)) return null; return v4Class(s.split(".").map(Number)); }
  if (kind !== 6) return null;
  const w = expand6(s);
  if (w.length !== 8 || w.some(x => !Number.isInteger(x) || x < 0 || x > 0xffff)) return "RESERVED";
  const v4 = () => [w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255];
  if (w.every(x => x === 0)) return "UNSPECIFIED";
  if (w.slice(0, 7).every(x => x === 0) && w[7] === 1) return "LOOPBACK";
  if (w.slice(0, 5).every(x => x === 0) && w[5] === 0xffff) return v4Class(v4());                    // ::ffff:a.b.c.d mapped
  if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every(x => x === 0)) { const c = v4Class(v4()); return c === "PUBLIC" ? "PUBLIC" : c; }      // NAT64 well-known prefix
  if (w.slice(0, 6).every(x => x === 0)) return "RESERVED";                                            // deprecated IPv4-compatible
  if ((w[0] & 0xfe00) === 0xfc00) return "PRIVATE";                                                    // fc00::/7 unique local
  if ((w[0] & 0xffc0) === 0xfe80) return "LINK_LOCAL";
  if ((w[0] & 0xff00) === 0xff00) return "MULTICAST";
  if (w[0] === 0x2001 && w[1] === 0x0db8) return "RESERVED";                                           // documentation
  if (w[0] === 0x2002) { const c = v4Class([w[1] >> 8, w[1] & 255, w[2] >> 8, w[2] & 255]); return c === "PUBLIC" ? "PUBLIC" : c; }      // 6to4 carries an IPv4
  if ((w[0] & 0xe000) === 0x2000) return "PUBLIC";
  return "RESERVED";
}
export const isPublicAddress = ip => classifyIp(ip) === "PUBLIC";

// ------------------------------------------------------------------ policy normalisation
const canon = p => JSON.stringify({ providerId: p.providerId, hosts: [...p.hosts].sort(), ports: [...p.ports].sort((a, b) => a - b), pathPrefixes: [...p.pathPrefixes].sort(), methods: [...p.methods].sort(), maxBodyBytes: p.maxBodyBytes, loopback: p.loopback, description: p.description });
export const policySubject = p => "egress:" + p.providerId + ":" + sha(canon(p)).slice(0, 24);
export const removeSubject = providerId => "egress-remove:" + providerId;

/** Validate and normalise a policy. Returns {policy} or {error}. Never throws. */
export function normaliseEgressPolicy(raw) {
  const e = error => ({ error });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return e("POLICY_OBJECT_REQUIRED");
  const arr = (v, min, max) => Array.isArray(v) && v.length >= min && v.length <= max ? [...v] : null;
  if (typeof raw.providerId !== "string" || !PROVIDER_RE.test(raw.providerId) || ["__proto__", "constructor", "prototype"].includes(raw.providerId)) return e("PROVIDER_ID_INVALID");
  const loopback = raw.loopback === true;
  const hosts = arr(raw.hosts, 1, 10);
  if (!hosts) return e("HOSTS_REQUIRED");
  if (loopback) { if (hosts.length !== 1 || hosts[0] !== LOOPBACK_HOST) return e("LOOPBACK_POLICY_HOST_MUST_BE_127_0_0_1_ONLY"); }
  else for (const h of hosts) {
    if (typeof h !== "string" || h !== h.toLowerCase() || h.includes("*") || h.endsWith(".") || !HOST_RE.test(h)) return e("HOST_INVALID:" + String(h).slice(0, 60));
    if (net.isIP(h)) return e("IP_LITERAL_HOST_REFUSED");
    if (BAD_TLD.has(h.split(".").at(-1))) return e("HOST_NOT_PUBLIC:" + h);
  }
  const ports = arr(raw.ports ?? (loopback ? null : [443]), 1, 5);
  if (!ports || !ports.every(p => Number.isInteger(p) && p >= 1 && p <= 65535)) return e(loopback ? "LOOPBACK_POLICY_NEEDS_EXPLICIT_PORTS" : "PORTS_INVALID");
  const methods = arr(raw.methods ?? ["GET"], 1, 6);
  if (!methods || !methods.every(m => METHODS.includes(m))) return e("METHODS_INVALID");
  const pathPrefixes = arr(raw.pathPrefixes ?? ["/"], 1, 20);
  if (!pathPrefixes || !pathPrefixes.every(p => typeof p === "string" && p.startsWith("/") && p.length <= 200 && !/[?#\\%;\s]|\/\.\.?(?:\/|$)|\/\//.test(p))) return e("PATH_PREFIX_INVALID");
  const maxBodyBytes = raw.maxBodyBytes ?? 0;
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 0 || maxBodyBytes > MAX_BODY_CAP) return e("MAX_BODY_BYTES_INVALID");
  const description = String(raw.description ?? "").slice(0, 200);
  return { policy: { providerId: raw.providerId, hosts: [...new Set(hosts)], ports: [...new Set(ports)], methods: [...new Set(methods)], pathPrefixes: [...new Set(pathPrefixes)], maxBodyBytes, loopback, description } };
}

// ------------------------------------------------------------------ URL dissection (raw string first, WHATWG second, and they must agree)
const RAW_URL = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/;
function dissect(url) {
  if (typeof url !== "string" || !url || url.length > 4096) return { error: "URL_INVALID" };
  if (/[^\x21-\x7e]/.test(url)) return { error: "NON_ASCII_OR_WHITESPACE_IN_URL" };                  // IDN / homoglyph / hidden characters: send the exact punycode form or nothing
  const m = RAW_URL.exec(url);
  if (!m) return { error: "URL_NOT_ABSOLUTE" };
  const scheme = m[1].toLowerCase(), authority = m[2], rawPath = m[3] || "/";
  if (scheme !== "https" && scheme !== "http") return { error: "SCHEME_NOT_ALLOWED" };
  if (authority.includes("@")) return { error: "USERINFO_REFUSED" };
  if (authority.includes("%")) return { error: "PERCENT_ENCODED_HOST_REFUSED" };
  if (authority.includes("\\")) return { error: "BACKSLASH_IN_HOST_REFUSED" };
  let host, portStr = null;
  if (authority.startsWith("[")) { const k = authority.indexOf("]"); if (k < 0) return { error: "HOST_INVALID" }; host = authority.slice(0, k + 1); const r = authority.slice(k + 1); if (r) { if (!r.startsWith(":")) return { error: "HOST_INVALID" }; portStr = r.slice(1); } }
  else { const k = authority.lastIndexOf(":"); if (k >= 0) { host = authority.slice(0, k); portStr = authority.slice(k + 1); } else host = authority; }
  if (!host) return { error: "HOST_MISSING" };
  if (host.endsWith(".")) return { error: "TRAILING_DOT_HOST_REFUSED" };
  if (portStr !== null && (!/^[1-9]\d{0,4}$/.test(portStr) || Number(portStr) > 65535)) return { error: "PORT_INVALID" };
  let u; try { u = new URL(url); } catch { return { error: "URL_INVALID" }; }
  if (u.hostname !== host.toLowerCase()) return { error: "HOST_NORMALISATION_MISMATCH" };          // 0x7f.1 -> 127.0.0.1, fullwidth dots, etc.
  if (/%(?:2e|2f|5c|00)/i.test(rawPath) || rawPath.includes("\\") || rawPath.split("/").some(s => s === "." || s === "..") || rawPath.includes("//")) return { error: "PATH_TRAVERSAL_OR_ENCODED_SEPARATOR" };
  if (u.pathname !== rawPath) return { error: "PATH_NORMALISATION_MISMATCH" };
  const port = portStr !== null ? Number(portStr) : scheme === "https" ? 443 : scheme === "http" ? 80 : null;
  if (port === null || port > 65535) return { error: "PORT_INVALID" };
  return { scheme, host: host.toLowerCase(), port, path: rawPath, hasQuery: Boolean(m[4]) };
}
const underPrefix = (p, prefix) => prefix === "/" || p === prefix || p.startsWith(prefix.endsWith("/") ? prefix : prefix + "/");

// ------------------------------------------------------------------ engine
export function createEgressPolicy({ ownerAuth, stateDir = null, isStopped = () => false, nowFn = () => Date.now(), requireResolvedAddresses = true } = {}) {
  if (!ownerAuth || typeof ownerAuth.verifyApproval !== "function" || typeof ownerAuth.verifyRecorded !== "function") throw new Error("OWNER_AUTH_REQUIRED");
  if (stateDir) fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const now = () => new Date(nowFn()).toISOString();
  const policyLog = createAuditChain({ filePath: stateDir ? path.join(stateDir, "egress-policy-audit.jsonl") : null, now });
  const decisionLog = createAuditChain({ filePath: stateDir ? path.join(stateDir, "egress-decisions.jsonl") : null, now, fastAppend: true });
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };
  const stats = { allowed: 0, denied: 0 };
  let integrity = "OK";

  /** Policies = the verified policy log, folded. A record whose owner signature or subject does not check out is ignored and flagged. */
  function policies() {
    try { policyLog.reload(); } catch { integrity = "POLICY_LOG_TAMPERED"; return new Map(); }       // tampered log: no policy at all (deny everything)
    const m = new Map(); let bad = 0;
    for (const e of policyLog.entries()) {
      const d = e.data ?? {};
      if (e.event === "EGRESS_POLICY_SET") {
        const n = normaliseEgressPolicy(d.policy);
        if (n.error || policySubject(n.policy) !== d.subject || !ownerAuth.verifyRecorded(d.approval, { action: "EGRESS_POLICY_SET", subject: d.subject })) { bad++; continue; }
        m.set(n.policy.providerId, n.policy);
      } else if (e.event === "EGRESS_POLICY_REMOVED") {
        if (!ownerAuth.verifyRecorded(d.approval, { action: "EGRESS_POLICY_REMOVE", subject: removeSubject(d.providerId) })) { bad++; continue; }
        m.delete(d.providerId);
      }
    }
    integrity = bad ? "UNVERIFIED_POLICY_RECORDS_IGNORED:" + bad : "OK";
    return m;
  }

  function setPolicy(raw, { ownerApproval = null } = {}) {
    const n = normaliseEgressPolicy(raw);
    if (n.error) throw new Error(n.error);
    const subject = policySubject(n.policy);
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "EGRESS_POLICY_SET", subject });
    if (!v.allowed) { policyLog.append("EGRESS_POLICY_CHANGE_DENIED", { providerId: n.policy.providerId, reason: v.reason }); throw new Error("OWNER_APPROVAL_REQUIRED:EGRESS_POLICY_SET:" + v.reason); }
    policyLog.append("EGRESS_POLICY_SET", { policy: n.policy, subject, approval: ownerApproval });
    return { providerId: n.policy.providerId, subject };
  }
  function removePolicy(providerId, { ownerApproval = null } = {}) {
    if (typeof providerId !== "string" || !PROVIDER_RE.test(providerId)) throw new Error("PROVIDER_ID_INVALID");
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "EGRESS_POLICY_REMOVE", subject: removeSubject(providerId) });
    if (!v.allowed) { policyLog.append("EGRESS_POLICY_CHANGE_DENIED", { providerId, reason: v.reason }); throw new Error("OWNER_APPROVAL_REQUIRED:EGRESS_POLICY_REMOVE:" + v.reason); }
    const had = policies().has(providerId);
    policyLog.append("EGRESS_POLICY_REMOVED", { providerId, approval: ownerApproval });
    return had;
  }

  function decide(allowed, reason, info) {
    const d = { allowed, reason, providerId: info.providerId ?? null, host: info.host ?? null, port: info.port ?? null, method: info.method ?? null, path: info.path ?? null };
    allowed ? stats.allowed++ : stats.denied++;
    try { const e = decisionLog.append(allowed ? "EGRESS_ALLOW" : "EGRESS_DENY", d); d.decisionSeq = e.seq; }
    catch { if (allowed) return { ...d, allowed: false, reason: "AUDIT_UNAVAILABLE" }; }              // no audit, no egress
    return d;
  }

  /** request: {providerId, url, method="GET", bodyBytes | body, resolvedAddresses?}. Returns a decision {allowed, reason, ...}. Never throws. */
  function check(request) {
    const r = request && typeof request === "object" ? request : {};
    const info = { providerId: typeof r.providerId === "string" ? r.providerId.slice(0, 48) : null };
    const D = reason => decide(false, reason, info);
    if (stopped()) return D("OWNER_STOP");
    if (typeof r.providerId !== "string" || !PROVIDER_RE.test(r.providerId)) return D("PROVIDER_ID_INVALID");
    const pol = policies().get(r.providerId);
    if (!pol) return D("NO_POLICY_FOR_PROVIDER");
    const u = dissect(r.url);
    if (u.error) return D(u.error);
    Object.assign(info, { host: u.host, port: u.port, path: u.path });
    const method = typeof r.method === "string" ? r.method.toUpperCase() : r.method === undefined ? "GET" : null;
    info.method = method;
    if (!method || !/^[A-Z]{1,10}$/.test(method)) return D("METHOD_INVALID");
    if (u.scheme !== "https" && !(pol.loopback && u.scheme === "http")) return D("SCHEME_NOT_ALLOWED");
    const ipKind = classifyIp(u.host);
    if (ipKind !== null) { if (!pol.loopback || u.host !== LOOPBACK_HOST) return D("IP_LITERAL_REFUSED"); }
    else if (pol.loopback) return D("LOOPBACK_PROVIDER_REQUIRES_127_0_0_1");
    if (!pol.hosts.includes(u.host)) return D("HOST_NOT_IN_POLICY");                                  // exact match only
    if (!pol.ports.includes(u.port)) return D("PORT_NOT_IN_POLICY");
    if (!pol.methods.includes(method)) return D("METHOD_NOT_IN_POLICY");
    if (!pol.pathPrefixes.some(p => underPrefix(u.path, p))) return D("PATH_NOT_IN_POLICY");
    let bytes = 0;
    if (r.bodyBytes !== undefined) bytes = r.bodyBytes;
    else if (typeof r.body === "string") bytes = Buffer.byteLength(r.body);
    else if (r.body instanceof Uint8Array) bytes = r.body.length;
    else if (r.body !== undefined && r.body !== null) return D("BODY_TYPE_UNSUPPORTED");
    if (!Number.isInteger(bytes) || bytes < 0) return D("BODY_SIZE_INVALID");
    if (bytes > 0 && (method === "GET" || method === "HEAD")) return D("BODY_NOT_ALLOWED_FOR_METHOD");
    if (bytes > pol.maxBodyBytes) return D("BODY_TOO_LARGE");
    if (!pol.loopback) {                                                                               // DNS rebinding / internal pivot protection
      const addrs = r.resolvedAddresses;
      if (addrs === undefined || addrs === null) { if (requireResolvedAddresses) return D("RESOLVED_ADDRESSES_REQUIRED"); }
      else {
        if (!Array.isArray(addrs) || !addrs.length || addrs.length > 32) return D("RESOLVED_ADDRESSES_INVALID");
        for (const a of addrs) { const k = classifyIp(a); if (k === null) return D("RESOLVED_ADDRESS_NOT_AN_IP"); if (k !== "PUBLIC") return D("RESOLVED_TO_NON_PUBLIC_ADDRESS:" + k); }
      }
    }
    const d = decide(true, null, info);
    if (d.allowed && !pol.loopback) d.pinTo = Array.isArray(r.resolvedAddresses) ? [...r.resolvedAddresses] : null;      // the caller must connect to exactly these
    return d;
  }

  /** A redirect is checked as a fresh request AND must stay on the same scheme + host + port. */
  function checkRedirect(original, location, { resolvedAddresses } = {}) {
    const o = original && typeof original === "object" ? original : {};
    const info = { providerId: typeof o.providerId === "string" ? o.providerId.slice(0, 48) : null };
    if (typeof location !== "string" || !location || location.length > 4096) return decide(false, "REDIRECT_LOCATION_INVALID", info);
    const from = dissect(o.url);
    if (from.error) return decide(false, "REDIRECT_FROM_INVALID_URL", info);
    let target;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(location) || location.startsWith("//")) target = location.startsWith("//") ? from.scheme + ":" + location : location;
    else if (location.startsWith("/")) target = from.scheme + "://" + (from.port === (from.scheme === "https" ? 443 : 80) ? from.host : from.host + ":" + from.port) + location;
    else return decide(false, "REDIRECT_RELATIVE_PATH_REFUSED", info);                                   // "../x" style: resolution would normalise away traversal
    const to = dissect(target);
    if (to.error) return decide(false, "REDIRECT_" + to.error, { ...info, host: from.host });
    if (to.host !== from.host) return decide(false, "REDIRECT_TO_OTHER_HOST", { ...info, host: to.host, path: to.path });
    if (to.scheme !== from.scheme) return decide(false, "REDIRECT_SCHEME_CHANGE", { ...info, host: to.host });
    if (to.port !== from.port) return decide(false, "REDIRECT_PORT_CHANGE", { ...info, host: to.host });
    return check({ ...o, url: target, method: o.method === "HEAD" ? "HEAD" : "GET", body: undefined, bodyBytes: 0, resolvedAddresses: resolvedAddresses ?? o.resolvedAddresses });
  }

  const listPolicies = () => [...policies().values()].map(p => structuredClone(p));
  const summary = () => { const n = policies().size; return { state: "IMPLEMENTED_NOT_CONNECTED", policies: n, integrity, ...stats, policyAuditHead: policyLog.head(), decisionAuditHead: decisionLog.head(), requireResolvedAddresses }; };
  return { setPolicy, removePolicy, listPolicies, check, checkRedirect, summary, decisions: () => decisionLog.entries(), policyAudit: () => policyLog.entries(), auditVerify: () => ({ policy: policyLog.verifyFile(), decisions: decisionLog.verifyFile() }) };
}

// ------------------------------------------------------------------ commit leak gate
const SECRET_FILE_RE = /(?:^|\/)(?:\.env(?:\.[A-Za-z0-9_-]+)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.[a-z]+)?|[^/]*\.(?:pem|key|p12|pfx|jks|kdbx|ppk|keystore)|(?:secrets?|credentials?)\.(?:json|ya?ml|toml|ini|txt|conf|cfg|properties|xml)|\.npmrc|\.pypirc|\.netrc|\.git-credentials|owner-private-key[^/]*)$/i;
const QUOTED_ASSIGN = /[:=]\s*(?:"[^"\n]{4,}"|'[^'\n]{4,}'|`[^`\n]{4,}`)/;

/** Inspect a unified diff (or plain text). Refuses when an ADDED line carries a credential shape or a key/secret file is added. Offending lines come back redacted. */
export function commitLeakGate(diffText, { maxBytes = 5 * 1024 * 1024, maxFindings = 200 } = {}) {
  if (typeof diffText !== "string") return { ok: false, verdict: "REFUSED", reason: "DIFF_TEXT_REQUIRED", findings: [] };
  if (Buffer.byteLength(diffText) > maxBytes) return { ok: false, verdict: "REFUSED", reason: "DIFF_TOO_LARGE_TO_CHECK", findings: [] };      // unchecked = refused
  const lines = diffText.split(/\r?\n/), isDiff = /^(?:diff --git |--- |\+\+\+ |@@ )/m.test(diffText);
  const findings = []; let file = null;
  const redact = s => { let r = scrub(s, "[redacted]"); if (r === s || containsSecret(r)) r = "[line redacted: " + s.length + " chars]"; return r.slice(0, 300); };
  const push = f => { if (findings.length < maxFindings) findings.push(f); };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isDiff) {
      const g = /^diff --git a\/(.+?) b\/(.+)$/.exec(line); if (g) { file = g[2]; if (SECRET_FILE_RE.test(file)) push({ line: i + 1, file, kind: "SECRET_FILE_IN_DIFF", severity: "BLOCK", redacted: line.slice(0, 300) }); continue; }
      const p = /^\+\+\+ (?:b\/)?(.+)$/.exec(line); if (p) { const f = p[1].trim(); if (f !== "/dev/null") { file = f; if (SECRET_FILE_RE.test(f) && !findings.some(x => x.kind === "SECRET_FILE_IN_DIFF" && x.file === f)) push({ line: i + 1, file: f, kind: "SECRET_FILE_IN_DIFF", severity: "BLOCK", redacted: line.slice(0, 300) }); } continue; }
      if (!line.startsWith("+") || line.startsWith("+++")) continue;                                      // only what the commit ADDS
    }
    const content = isDiff ? line.slice(1) : line;
    if (!content.trim()) continue;
    if (containsSecret(content)) push({ line: i + 1, file, kind: "CREDENTIAL_PATTERN", severity: "BLOCK", redacted: redact(content) });
    else if (scrub(content, "[redacted]", { assign: true }) !== content) push({ line: i + 1, file, kind: QUOTED_ASSIGN.test(content) ? "HARDCODED_CREDENTIAL_ASSIGNMENT" : "CREDENTIAL_NAME_ASSIGNMENT", severity: QUOTED_ASSIGN.test(content) ? "BLOCK" : "WARN", redacted: redact(content) });
  }
  const blocked = findings.some(f => f.severity === "BLOCK");
  return { ok: !blocked, verdict: blocked ? "REFUSED" : findings.length ? "ALLOWED_WITH_WARNINGS" : "NO_KNOWN_CREDENTIAL_PATTERN", findings, note: "Pattern-based: an unknown credential format is not recognised. Not proof that the diff is secret-free." };
}
