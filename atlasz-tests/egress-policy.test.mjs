// 23-point item 3: per-provider egress allowlist (deny by default, exact host, DNS-rebinding style checks, owner-approved changes) and the commit leak gate.
// Decision engine only: nothing here opens a connection. Synthetic hosts, addresses and credentials.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createAuditChain } from "../atlasz-addons/audit-chain.mjs";
import { createEgressPolicy, normaliseEgressPolicy, policySubject, removeSubject, classifyIp, isPublicAddress, commitLeakGate } from "../atlasz-addons/egress-policy.mjs";
import { tmp, rm } from "./helpers.mjs";

const kp = generateOwnerKeyPair();
const auth = () => createOwnerAuth({ publicKeyB64: kp.publicKeyB64 });
const ap = (action, subject, k = kp) => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action, subject });
const PUB = ["93.184.216.34"];
const P = { providerId: "synthetic-ai", hosts: ["api.example-ai.com"], pathPrefixes: ["/v1"], methods: ["GET", "POST"], maxBodyBytes: 1000 };
const OLLAMA = { providerId: "ollama", loopback: true, hosts: ["127.0.0.1"], ports: [11434], pathPrefixes: ["/api"], methods: ["POST", "GET"], maxBodyBytes: 100000 };
const approveSet = p => ap("EGRESS_POLICY_SET", policySubject(normaliseEgressPolicy(p).policy));
function mk(opts = {}, ...pols) {
  const e = createEgressPolicy({ ownerAuth: opts.ownerAuth ?? auth(), ...opts });
  for (const p of pols) e.setPolicy(p, { ownerApproval: approveSet(p) });
  return e;
}
const ok = (e, url, extra = {}) => e.check({ providerId: "synthetic-ai", url, resolvedAddresses: PUB, ...extra });

// ---------------------------------------------------------------- policy validation
test("policy normalisation refuses wildcards, suffix patterns, IPs, internal names and bad fields", () => {
  assert.ok(normaliseEgressPolicy(P).policy);
  const bad = (patch, re) => assert.match(normaliseEgressPolicy({ ...P, ...patch }).error ?? "OK", re, JSON.stringify(patch));
  bad({ hosts: ["*.example-ai.com"] }, /HOST_INVALID/); bad({ hosts: [".example-ai.com"] }, /HOST_INVALID/); bad({ hosts: ["API.example-ai.com"] }, /HOST_INVALID/);
  bad({ hosts: ["api.example-ai.com."] }, /HOST_INVALID/); bad({ hosts: ["8.8.8.8"] }, /HOST_INVALID|IP_LITERAL/); bad({ hosts: ["localhost"] }, /HOST_INVALID/);
  bad({ hosts: ["db.internal"] }, /HOST_NOT_PUBLIC/); bad({ hosts: ["router.local"] }, /HOST_NOT_PUBLIC/); bad({ hosts: ["https://api.example-ai.com"] }, /HOST_INVALID/);
  bad({ hosts: ["api.exämple.com"] }, /HOST_INVALID/); bad({ hosts: [] }, /HOSTS_REQUIRED/); bad({ hosts: "api.example-ai.com" }, /HOSTS_REQUIRED/);
  bad({ providerId: "Bad Id" }, /PROVIDER_ID_INVALID/); bad({ providerId: "__proto__" }, /PROVIDER_ID_INVALID/);
  bad({ methods: ["CONNECT"] }, /METHODS_INVALID/); bad({ methods: ["get"] }, /METHODS_INVALID/); bad({ methods: [] }, /METHODS_INVALID/);
  bad({ pathPrefixes: ["v1"] }, /PATH_PREFIX/); bad({ pathPrefixes: ["/v1/../admin"] }, /PATH_PREFIX/); bad({ pathPrefixes: ["/v1%2f"] }, /PATH_PREFIX/); bad({ pathPrefixes: ["/a?b"] }, /PATH_PREFIX/); bad({ pathPrefixes: ["//x"] }, /PATH_PREFIX/);
  bad({ maxBodyBytes: -1 }, /MAX_BODY/); bad({ maxBodyBytes: 1.5 }, /MAX_BODY/); bad({ maxBodyBytes: 1e9 }, /MAX_BODY/); bad({ ports: [0] }, /PORTS/); bad({ ports: [70000] }, /PORTS/);
  assert.equal(normaliseEgressPolicy(null).error, "POLICY_OBJECT_REQUIRED"); assert.equal(normaliseEgressPolicy([]).error, "POLICY_OBJECT_REQUIRED");
  assert.equal(normaliseEgressPolicy({ ...P, hosts: ["xn--bcher-kva.example"] }).error, "HOST_NOT_PUBLIC:xn--bcher-kva.example");
  assert.ok(normaliseEgressPolicy({ ...P, hosts: ["xn--bcher-kva.com"] }).policy, "punycode is allowed when listed exactly");
});

test("loopback policies: only 127.0.0.1, explicit ports, never 'localhost' or ::1", () => {
  assert.ok(normaliseEgressPolicy(OLLAMA).policy);
  for (const hosts of [["localhost"], ["127.0.0.2"], ["::1"], ["127.0.0.1", "api.example-ai.com"], ["0.0.0.0"]]) assert.match(normaliseEgressPolicy({ ...OLLAMA, hosts }).error, /LOOPBACK_POLICY_HOST_MUST_BE_127_0_0_1_ONLY/, hosts.join(","));
  assert.match(normaliseEgressPolicy({ ...OLLAMA, ports: undefined }).error, /LOOPBACK_POLICY_NEEDS_EXPLICIT_PORTS/);
  assert.match(normaliseEgressPolicy({ ...P, hosts: ["127.0.0.1"] }).error, /HOST_INVALID|IP_LITERAL/, "a normal policy cannot name loopback");
});

// ---------------------------------------------------------------- owner approvals
test("deny by default: an empty engine refuses everything", () => {
  const e = mk();
  assert.equal(ok(e, "https://api.example-ai.com/v1/x").reason, "NO_POLICY_FOR_PROVIDER");
  assert.equal(e.check({ url: "https://api.example-ai.com/v1/x" }).reason, "PROVIDER_ID_INVALID");
  assert.equal(e.check(null).allowed, false); assert.equal(e.check("https://x.com").allowed, false);
  assert.equal(e.listPolicies().length, 0);
});

test("policy changes need a signed owner approval bound to the exact content; approvals are single use", () => {
  const e = mk();
  assert.throws(() => e.setPolicy(P), /OWNER_APPROVAL_REQUIRED/);
  assert.throws(() => e.setPolicy(P, { ownerApproval: true }), /BARE_BOOLEAN_REJECTED/);
  const a = approveSet(P);
  assert.throws(() => e.setPolicy({ ...P, hosts: ["api.example-ai.com", "evil.example-ai.com"] }, { ownerApproval: a }), /SUBJECT_MISMATCH/, "approval does not cover widened hosts");
  assert.throws(() => e.setPolicy({ ...P, maxBodyBytes: 999999 }, { ownerApproval: approveSet(P) }), /SUBJECT_MISMATCH/, "approval does not cover a bigger body");
  assert.throws(() => e.setPolicy(P, { ownerApproval: ap("EGRESS_POLICY_SET", policySubject(normaliseEgressPolicy(P).policy), generateOwnerKeyPair()) }), /SIGNATURE_INVALID/, "a non-owner key cannot sign");
  e.setPolicy(P, { ownerApproval: a });
  assert.throws(() => e.setPolicy(P, { ownerApproval: a }), /REPLAY_DETECTED/);
  assert.equal(ok(e, "https://api.example-ai.com/v1/x").allowed, true);
  assert.ok(e.policyAudit().some(x => x.event === "EGRESS_POLICY_CHANGE_DENIED"));
  assert.throws(() => mk({ ownerAuth: createOwnerAuth({}) }).setPolicy(P, { ownerApproval: approveSet(P) }), /OWNER_AUTH_NOT_CONFIGURED/);
  assert.throws(() => createEgressPolicy({}), /OWNER_AUTH_REQUIRED/);
});

test("removePolicy needs its own approval; after removal the provider is denied again", () => {
  const e = mk({}, P);
  assert.throws(() => e.removePolicy("synthetic-ai", { ownerApproval: approveSet(P) }), /OWNER_APPROVAL_REQUIRED/);
  assert.equal(e.removePolicy("synthetic-ai", { ownerApproval: ap("EGRESS_POLICY_REMOVE", removeSubject("synthetic-ai")) }), true);
  assert.equal(ok(e, "https://api.example-ai.com/v1/x").reason, "NO_POLICY_FOR_PROVIDER");
  assert.throws(() => e.removePolicy("Bad Id", {}), /PROVIDER_ID_INVALID/);
});

// ---------------------------------------------------------------- host checks
test("exact host match only: suffix, prefix, subdomain and look-alike hosts are refused", () => {
  const e = mk({}, P);
  assert.equal(ok(e, "https://api.example-ai.com/v1/chat").allowed, true);
  assert.equal(ok(e, "https://API.Example-AI.com/v1/chat").allowed, true, "hostnames are case-insensitive");
  for (const u of ["https://api.example-ai.com.evil.net/v1/x", "https://evil-api.example-ai.com/v1/x", "https://x.api.example-ai.com/v1/x", "https://example-ai.com/v1/x", "https://api.example-ai.co/v1/x", "https://api-example-ai.com/v1/x"])
    assert.equal(ok(e, u).reason, "HOST_NOT_IN_POLICY", u);
});

test("authority tricks: userinfo, percent-encoding, backslash, trailing dot, non-ASCII / IDN, whitespace", () => {
  const e = mk({}, P);
  const cases = { "https://api.example-ai.com@evil.net/v1/x": "USERINFO_REFUSED", "https://user:pw@api.example-ai.com/v1/x": "USERINFO_REFUSED", "https://evil.net\\@api.example-ai.com/v1/x": "USERINFO_REFUSED",
    "https://api.example-ai%2ecom/v1/x": "PERCENT_ENCODED_HOST_REFUSED", "https://api.example-ai.com./v1/x": "TRAILING_DOT_HOST_REFUSED", "https://аpi.example-ai.com/v1/x": "NON_ASCII_OR_WHITESPACE_IN_URL",
    "https://api.example-ai．com/v1/x": "NON_ASCII_OR_WHITESPACE_IN_URL", "https://api.example-ai.com/v1/x y": "NON_ASCII_OR_WHITESPACE_IN_URL", "https://api.example-ai.com​/v1/x": "NON_ASCII_OR_WHITESPACE_IN_URL",
    "//api.example-ai.com/v1/x": "URL_NOT_ABSOLUTE", "api.example-ai.com/v1/x": "URL_NOT_ABSOLUTE", "https:///v1/x": "HOST_MISSING", "https://[::1/v1": "HOST_INVALID" };
  for (const [u, want] of Object.entries(cases)) assert.equal(ok(e, u).reason, want, u);
  assert.equal(ok(e, "https://xn--pi-7ka.example-ai.com/v1/x").reason, "HOST_NOT_IN_POLICY", "a punycode look-alike is not the listed host");
});

test("numeric / shortened / hex / octal IPv4 forms and IP literals are refused for normal providers", () => {
  const e = mk({}, P);
  for (const u of ["https://2130706433/v1/x", "https://0x7f.0.0.1/v1/x", "https://127.1/v1/x", "https://0177.0.0.1/v1/x", "https://017700000001/v1/x"]) assert.equal(ok(e, u).reason, "HOST_NORMALISATION_MISMATCH", u);
  for (const u of ["https://127.0.0.1/v1/x", "https://93.184.216.34/v1/x", "https://[::1]/v1/x", "https://[::ffff:7f00:1]/v1/x"]) assert.equal(ok(e, u).reason, "IP_LITERAL_REFUSED", u);
});

test("ports, schemes, methods and paths", () => {
  const e = mk({}, P);
  assert.equal(ok(e, "https://api.example-ai.com:443/v1/x").allowed, true);
  assert.equal(ok(e, "https://api.example-ai.com:8443/v1/x").reason, "PORT_NOT_IN_POLICY");
  assert.equal(ok(e, "https://api.example-ai.com:0443/v1/x").reason, "PORT_INVALID");
  assert.equal(ok(e, "https://api.example-ai.com:99999/v1/x").reason, "PORT_INVALID");
  assert.equal(ok(e, "http://api.example-ai.com/v1/x").reason, "SCHEME_NOT_ALLOWED"); assert.equal(ok(e, "ftp://api.example-ai.com/v1/x").reason, "SCHEME_NOT_ALLOWED");
  assert.equal(ok(e, "https://api.example-ai.com/v1/x", { method: "post", body: "{}" }).allowed, true);
  assert.equal(ok(e, "https://api.example-ai.com/v1/x", { method: "DELETE" }).reason, "METHOD_NOT_IN_POLICY");
  assert.equal(ok(e, "https://api.example-ai.com/v1/x", { method: "G E T" }).reason, "METHOD_INVALID"); assert.equal(ok(e, "https://api.example-ai.com/v1/x", { method: 7 }).reason, "METHOD_INVALID");
  assert.equal(ok(e, "https://api.example-ai.com/v1").allowed, true); assert.equal(ok(e, "https://api.example-ai.com/v1?q=1#f").allowed, true);
  for (const [u, want] of [["https://api.example-ai.com/v1evil", "PATH_NOT_IN_POLICY"], ["https://api.example-ai.com/", "PATH_NOT_IN_POLICY"], ["https://api.example-ai.com/v1/../admin", "PATH_TRAVERSAL_OR_ENCODED_SEPARATOR"],
    ["https://api.example-ai.com/v1/%2e%2e/admin", "PATH_TRAVERSAL_OR_ENCODED_SEPARATOR"], ["https://api.example-ai.com/v1/..%2fadmin", "PATH_TRAVERSAL_OR_ENCODED_SEPARATOR"], ["https://api.example-ai.com/v1/./x", "PATH_TRAVERSAL_OR_ENCODED_SEPARATOR"],
    ["https://api.example-ai.com//v1/x", "PATH_TRAVERSAL_OR_ENCODED_SEPARATOR"], ["https://api.example-ai.com/v1/%5cadmin", "PATH_TRAVERSAL_OR_ENCODED_SEPARATOR"], ["https://api.example-ai.com/V1/x", "PATH_NOT_IN_POLICY"]])
    assert.equal(ok(e, u).reason, want, u);
});

test("body limits: size, GET with a body, unsupported body types", () => {
  const e = mk({}, P);
  assert.equal(ok(e, "https://api.example-ai.com/v1/x", { method: "POST", body: "x".repeat(1000) }).allowed, true);
  assert.equal(ok(e, "https://api.example-ai.com/v1/x", { method: "POST", body: "x".repeat(1001) }).reason, "BODY_TOO_LARGE");
  assert.equal(ok(e, "https://api.example-ai.com/v1/x", { method: "POST", body: "é".repeat(600) }).reason, "BODY_TOO_LARGE", "bytes, not characters");
  assert.equal(ok(e, "https://api.example-ai.com/v1/x", { method: "POST", body: new Uint8Array(1001) }).reason, "BODY_TOO_LARGE");
  assert.equal(ok(e, "https://api.example-ai.com/v1/x", { method: "POST", bodyBytes: 5000 }).reason, "BODY_TOO_LARGE");
  assert.equal(ok(e, "https://api.example-ai.com/v1/x", { method: "POST", bodyBytes: -1 }).reason, "BODY_SIZE_INVALID");
  assert.equal(ok(e, "https://api.example-ai.com/v1/x", { method: "POST", bodyBytes: "10" }).reason, "BODY_SIZE_INVALID");
  assert.equal(ok(e, "https://api.example-ai.com/v1/x", { method: "GET", body: "x" }).reason, "BODY_NOT_ALLOWED_FOR_METHOD");
  assert.equal(ok(e, "https://api.example-ai.com/v1/x", { method: "POST", body: { a: 1 } }).reason, "BODY_TYPE_UNSUPPORTED");
});

// ---------------------------------------------------------------- DNS / IP classification
test("classifyIp covers loopback, private, link-local, CGNAT, multicast, mapped, NAT64, 6to4, ULA and documentation ranges", () => {
  const table = { "8.8.8.8": "PUBLIC", "93.184.216.34": "PUBLIC", "127.0.0.1": "LOOPBACK", "127.255.0.9": "LOOPBACK", "10.1.2.3": "PRIVATE", "172.16.0.1": "PRIVATE", "172.31.255.255": "PRIVATE", "172.32.0.1": "PUBLIC",
    "192.168.1.1": "PRIVATE", "169.254.169.254": "LINK_LOCAL", "100.64.0.1": "CGNAT", "100.128.0.1": "PUBLIC", "0.0.0.0": "UNSPECIFIED", "224.0.0.1": "MULTICAST", "255.255.255.255": "RESERVED", "192.0.2.1": "RESERVED", "198.18.0.1": "RESERVED",
    "::1": "LOOPBACK", "::": "UNSPECIFIED", "::ffff:127.0.0.1": "LOOPBACK", "::ffff:10.0.0.1": "PRIVATE", "::ffff:8.8.8.8": "PUBLIC", "64:ff9b::a9fe:a9fe": "LINK_LOCAL", "64:ff9b::808:808": "PUBLIC", "2002:a00:1::1": "PRIVATE",
    "fd00::1": "PRIVATE", "fc12::1": "PRIVATE", "fe80::1": "LINK_LOCAL", "fe80::1%eth0": "LINK_LOCAL", "ff02::1": "MULTICAST", "2001:db8::1": "RESERVED", "2606:4700:4700::1111": "PUBLIC", "[2606:4700:4700::1111]": "PUBLIC", "::127.0.0.1": "RESERVED" };
  for (const [ip, want] of Object.entries(table)) assert.equal(classifyIp(ip), want, ip);
  for (const notIp of ["localhost", "1.2.3", "01.2.3.4", "999.1.1.1", "", null, "1.2.3.4.5"]) assert.equal(classifyIp(notIp), null, String(notIp));
  assert.equal(isPublicAddress("8.8.8.8"), true); assert.equal(isPublicAddress("10.0.0.1"), false);
});

test("DNS-rebinding style protection: any non-public resolved address denies; missing answers deny by default", () => {
  const e = mk({}, P);
  for (const a of [["10.0.0.5"], ["127.0.0.1"], ["169.254.169.254"], ["::1"], ["::ffff:192.168.0.1"], ["fd00::5"], ["93.184.216.34", "10.0.0.5"], ["100.64.1.1"], ["0.0.0.0"]])
    assert.match(ok(e, "https://api.example-ai.com/v1/x", { resolvedAddresses: a }).reason, /^RESOLVED_TO_NON_PUBLIC_ADDRESS:/, a.join(","));
  assert.equal(ok(e, "https://api.example-ai.com/v1/x", { resolvedAddresses: [] }).reason, "RESOLVED_ADDRESSES_INVALID");
  assert.equal(ok(e, "https://api.example-ai.com/v1/x", { resolvedAddresses: "8.8.8.8" }).reason, "RESOLVED_ADDRESSES_INVALID");
  assert.equal(ok(e, "https://api.example-ai.com/v1/x", { resolvedAddresses: ["evil.net"] }).reason, "RESOLVED_ADDRESS_NOT_AN_IP");
  assert.equal(e.check({ providerId: "synthetic-ai", url: "https://api.example-ai.com/v1/x" }).reason, "RESOLVED_ADDRESSES_REQUIRED");
  const d = ok(e, "https://api.example-ai.com/v1/x", { resolvedAddresses: ["93.184.216.34", "2606:4700::1"] });
  assert.equal(d.allowed, true); assert.deepEqual(d.pinTo, ["93.184.216.34", "2606:4700::1"], "the decision tells the caller which addresses to pin");
  const lax = mk({ requireResolvedAddresses: false }, P);
  assert.equal(lax.check({ providerId: "synthetic-ai", url: "https://api.example-ai.com/v1/x" }).allowed, true, "only an explicit opt-out allows unchecked DNS");
  assert.equal(lax.summary().requireResolvedAddresses, false);
});

test("the explicit loopback provider (Ollama on 127.0.0.1) and nothing else reaches loopback", () => {
  const e = mk({}, P, OLLAMA);
  assert.equal(e.check({ providerId: "ollama", url: "http://127.0.0.1:11434/api/embed", method: "POST", body: "{}" }).allowed, true);
  assert.equal(e.check({ providerId: "ollama", url: "http://127.0.0.1:11434/api/tags" }).allowed, true);
  assert.equal(e.check({ providerId: "ollama", url: "http://127.0.0.1:8080/api/tags" }).reason, "PORT_NOT_IN_POLICY");
  assert.equal(e.check({ providerId: "ollama", url: "http://127.0.0.1/api/tags" }).reason, "PORT_NOT_IN_POLICY");
  assert.equal(e.check({ providerId: "ollama", url: "http://localhost:11434/api/tags" }).reason, "LOOPBACK_PROVIDER_REQUIRES_127_0_0_1");
  assert.equal(e.check({ providerId: "ollama", url: "http://127.0.0.2:11434/api/tags" }).reason, "IP_LITERAL_REFUSED");
  assert.equal(e.check({ providerId: "ollama", url: "http://[::1]:11434/api/tags" }).reason, "IP_LITERAL_REFUSED");
  assert.equal(e.check({ providerId: "ollama", url: "http://2130706433:11434/api/tags" }).reason, "HOST_NORMALISATION_MISMATCH");
  assert.equal(e.check({ providerId: "ollama", url: "http://127.0.0.1:11434/admin" }).reason, "PATH_NOT_IN_POLICY");
  assert.equal(ok(e, "https://127.0.0.1/v1/x").reason, "IP_LITERAL_REFUSED", "a normal provider still cannot reach loopback");
});

test("redirects: same host only, no scheme/port change, every target re-checked", () => {
  const e = mk({}, P), o = { providerId: "synthetic-ai", url: "https://api.example-ai.com/v1/a", resolvedAddresses: PUB };
  assert.equal(e.checkRedirect(o, "/v1/b").allowed, true);
  assert.equal(e.checkRedirect(o, "https://api.example-ai.com/v1/c").allowed, true);
  const cases = { "https://evil.net/v1/a": "REDIRECT_TO_OTHER_HOST", "//evil.net/v1/a": "REDIRECT_TO_OTHER_HOST", "http://api.example-ai.com/v1/a": "REDIRECT_SCHEME_CHANGE", "https://api.example-ai.com:8443/v1/a": "REDIRECT_PORT_CHANGE",
    "https://api.example-ai.com@evil.net/v1": "REDIRECT_USERINFO_REFUSED", "../admin": "REDIRECT_RELATIVE_PATH_REFUSED", "/admin": "PATH_NOT_IN_POLICY", "/v1/../admin": "REDIRECT_PATH_TRAVERSAL_OR_ENCODED_SEPARATOR", "https://169.254.169.254/latest": "REDIRECT_TO_OTHER_HOST", "": "REDIRECT_LOCATION_INVALID" };
  for (const [loc, want] of Object.entries(cases)) assert.equal(e.checkRedirect(o, loc).reason, want, loc);
  assert.match(e.checkRedirect(o, "/v1/b", { resolvedAddresses: ["10.0.0.1"] }).reason, /NON_PUBLIC/, "a redirect re-resolving to a private address is refused");
  assert.equal(e.checkRedirect({ ...o, url: "nonsense" }, "/v1/b").reason, "REDIRECT_FROM_INVALID_URL");
});

// ---------------------------------------------------------------- persistence, audit, kill switch
test("policies persist only through the owner-signed log; edits and forged records grant nothing", () => {
  const d = tmp("egress-");
  try {
    const e1 = mk({ stateDir: d }, P);
    const e2 = mk({ stateDir: d });
    assert.equal(ok(e2, "https://api.example-ai.com/v1/x").allowed, true, "a restarted engine reloads the signed policy");
    const forged = path.join(d, "forged"), n = normaliseEgressPolicy({ ...P, hosts: ["api.evil-ai.com"] }).policy;
    createAuditChain({ filePath: path.join(forged, "egress-policy-audit.jsonl") }).append("EGRESS_POLICY_SET", { policy: n, subject: policySubject(n), approval: ap("EGRESS_POLICY_SET", policySubject(n), generateOwnerKeyPair()) });
    const e3 = mk({ stateDir: forged });
    assert.equal(e3.listPolicies().length, 0); assert.match(e3.summary().integrity, /UNVERIFIED_POLICY_RECORDS_IGNORED:1/);
    const widened = path.join(d, "widened"), good = normaliseEgressPolicy(P).policy;
    createAuditChain({ filePath: path.join(widened, "egress-policy-audit.jsonl") }).append("EGRESS_POLICY_SET", { policy: { ...good, hosts: ["api.evil-ai.com"] }, subject: policySubject(good), approval: approveSet(P) });
    assert.equal(mk({ stateDir: widened }).listPolicies().length, 0, "a real approval re-used for different content is ignored");
    const f = path.join(d, "egress-policy-audit.jsonl"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("/v1", "/"));
    assert.throws(() => mk({ stateDir: d }), /AUDIT_CHAIN_TAMPERED/);
    assert.equal(ok(e1, "https://api.example-ai.com/v1/x").reason, "NO_POLICY_FOR_PROVIDER", "a running engine that sees a tampered log denies everything");
    assert.equal(e1.summary().integrity, "POLICY_LOG_TAMPERED");
  } finally { rm(d); }
});

test("every decision is audited in a hash chain; query strings and bodies are never logged", () => {
  const d = tmp("egress-");
  try {
    const e = mk({ stateDir: d }, P);
    ok(e, "https://api.example-ai.com/v1/x?api_key=SYNTHETIC-QUERY-TOKEN", { method: "POST", body: "SYNTHETIC-BODY" });
    ok(e, "https://evil.net/v1/x"); e.check({ providerId: "nobody", url: "https://x.com" });
    const ds = e.decisions();
    assert.equal(ds.length, 3); assert.deepEqual(ds.map(x => x.event), ["EGRESS_ALLOW", "EGRESS_DENY", "EGRESS_DENY"]);
    const txt = fs.readFileSync(path.join(d, "egress-decisions.jsonl"), "utf8");
    assert.ok(!txt.includes("SYNTHETIC-QUERY-TOKEN") && !txt.includes("SYNTHETIC-BODY"));
    assert.equal(e.auditVerify().decisions.ok, true); assert.equal(e.auditVerify().policy.ok, true);
    assert.equal(e.summary().allowed, 1); assert.equal(e.summary().denied, 2); assert.equal(e.summary().state, "IMPLEMENTED_NOT_CONNECTED");
  } finally { rm(d); }
});

test("kill switch denies everything; a throwing stop check counts as stopped", () => {
  let s = false; const e = mk({ isStopped: () => { if (s === "boom") throw new Error("x"); return s; } }, P);
  assert.equal(ok(e, "https://api.example-ai.com/v1/x").allowed, true);
  s = true; assert.equal(ok(e, "https://api.example-ai.com/v1/x").reason, "OWNER_STOP");
  s = "boom"; assert.equal(ok(e, "https://api.example-ai.com/v1/x").reason, "OWNER_STOP");
  assert.equal(e.checkRedirect({ providerId: "synthetic-ai", url: "https://api.example-ai.com/v1/a", resolvedAddresses: PUB }, "/v1/b").reason, "OWNER_STOP");
});

test("garbage input never throws and never allows", () => {
  const e = mk({}, P);
  const junk = [undefined, null, 0, "", [], {}, { providerId: "synthetic-ai" }, { providerId: "synthetic-ai", url: 5 }, { providerId: "synthetic-ai", url: "x".repeat(5000) }, { providerId: "synthetic-ai", url: "https://" },
    { providerId: "synthetic-ai", url: "https://api.example-ai.com:/v1" }, { providerId: "synthetic-ai", url: "https://[]/v1" }, { providerId: ["synthetic-ai"], url: "https://api.example-ai.com/v1" }, { providerId: "synthetic-ai", url: "javascript:alert(1)" }];
  for (const j of junk) { const r = e.check(j); assert.equal(r.allowed, false, JSON.stringify(j)?.slice(0, 80)); }
  for (let i = 0; i < 300; i++) { const u = "https://" + Array.from({ length: 30 }, () => String.fromCharCode(33 + Math.floor(Math.random() * 94))).join(""); assert.doesNotThrow(() => ok(e, u)); }
});

// ---------------------------------------------------------------- commit leak gate
const GH = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const AWS = "AKIA" + "QWERTYUIOPASDFGH";
test("commit leak gate refuses added credentials and returns only redacted lines", () => {
  const diff = ["diff --git a/src/a.js b/src/a.js", "--- a/src/a.js", "+++ b/src/a.js", "@@ -1,2 +1,4 @@", " const x = 1;", "+const gh = \"" + GH + "\";", "+aws_key = " + AWS, "+-----BEGIN RSA PRIV" + "ATE KEY-----", "-const removed = \"" + "ghp_" + "Z".repeat(36) + "\";"].join("\n");
  const r = commitLeakGate(diff);
  assert.equal(r.ok, false); assert.equal(r.verdict, "REFUSED");
  assert.deepEqual(r.findings.map(f => f.line), [6, 7, 8], "only ADDED lines are judged; removing a secret is fine");
  assert.ok(r.findings.every(f => f.file === "src/a.js" && f.severity === "BLOCK"));
  const out = JSON.stringify(r);
  assert.ok(!out.includes(GH) && !out.includes(AWS) && !out.includes("A1b2C3d4E5f6"), "no secret material in the result");
  assert.ok(r.findings[0].redacted.includes("[redacted]"));
});

test("commit leak gate: secret files, hardcoded vs computed assignments, clean diffs, plain text", () => {
  const env = commitLeakGate("diff --git a/.env b/.env\nnew file mode 100644\n--- /dev/null\n+++ b/.env\n@@ -0,0 +1 @@\n+DEBUG=1\n");
  assert.equal(env.ok, false); assert.ok(env.findings.some(f => f.kind === "SECRET_FILE_IN_DIFF" && f.file === ".env"));
  for (const f of ["config/id_rsa", "certs/server.pem", "deploy/credentials.json", ".npmrc", "keys/owner-private-key.enc.pem"]) assert.equal(commitLeakGate("diff --git a/" + f + " b/" + f + "\n+++ b/" + f + "\n+x\n").ok, false, f);
  const hard = commitLeakGate("+++ b/a.js\n+const password = \"correct-horse-staple\";\n");
  assert.equal(hard.ok, false); assert.equal(hard.findings[0].kind, "HARDCODED_CREDENTIAL_ASSIGNMENT"); assert.ok(!JSON.stringify(hard).includes("correct-horse-staple"));
  const soft = commitLeakGate("+++ b/a.js\n+const token = readTokenFromVault();\n");
  assert.equal(soft.ok, true); assert.equal(soft.verdict, "ALLOWED_WITH_WARNINGS"); assert.equal(soft.findings[0].severity, "WARN");
  const clean = commitLeakGate("diff --git a/a.js b/a.js\n+++ b/a.js\n+export const add = (a, b) => a + b;\n");
  assert.equal(clean.ok, true); assert.equal(clean.verdict, "NO_KNOWN_CREDENTIAL_PATTERN"); assert.match(clean.note, /not proof/i);
  assert.equal(commitLeakGate("notes\nkey " + AWS + "\n").ok, false, "plain text (not a diff) is checked line by line");
  assert.equal(commitLeakGate("diff --git a/x b/x\n+++ b/x\n+" + "ghp_" + "​" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8").ok, false, "a zero-width character cannot split a token");
});

test("commit leak gate fails closed on oversize or non-text input", () => {
  assert.equal(commitLeakGate(null).reason, "DIFF_TEXT_REQUIRED"); assert.equal(commitLeakGate(Buffer.from("x")).ok, false);
  assert.equal(commitLeakGate("x".repeat(100), { maxBytes: 50 }).reason, "DIFF_TOO_LARGE_TO_CHECK");
  const many = commitLeakGate(Array.from({ length: 500 }, () => "+k " + AWS).join("\n"), { maxFindings: 10 });
  assert.equal(many.ok, false); assert.equal(many.findings.length, 10);
});
