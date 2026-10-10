// Unified programme M1: secret vault completion + credential broker. Synthetic secrets and a fake fetch only; no network, no real credentials.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createSecretVault, generateVaultKey, checkBackupPassphrase } from "../atlasz-addons/secret-vault.mjs";
import { createCredentialBroker, normaliseGrant, grantSubject } from "../atlasz-addons/credential-broker.mjs";
import { tmp, rm } from "./helpers.mjs";

function owner() {
  const k = generateOwnerKeyPair(), auth = createOwnerAuth({ publicKeyB64: k.publicKeyB64 });
  return { auth, ap: (action, subject) => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action, subject }) };
}
const SECRET = "synthetic-credential-AAAA-1111-BBBB";
const PASS = "correct horse battery staple 42";
const nameDigest = names => "names:" + createHashHex([...names].sort().join("\n")).slice(0, 40);
import { createHash } from "node:crypto";
const createHashHex = t => createHash("sha256").update(t).digest("hex");
function mk(opts = {}) {
  const d = tmp(), o = owner(), key = generateVaultKey();
  const v = createSecretVault({ dir: d, keyB64: key, ownerAuth: o.auth, ...opts });
  return { d, o, key, v, ap: o.ap };
}

// ------------------------------- vault -------------------------------
test("vault: reserved names are refused and a store file carrying __proto__ is rejected", () => {
  const { d, v, ap } = mk();
  try {
    for (const n of ["__proto__", "constructor", "prototype", "__check__"]) assert.throws(() => v.set(n, SECRET, { ownerApproval: ap("VAULT_SET", n) }), /VAULT_INVALID_NAME/);
    assert.equal(v.has("__proto__"), false); assert.equal(({}).polluted, undefined);
    fs.writeFileSync(path.join(d, "vault.enc.json"), '{"version":"1","entries":{"__proto__":{"ct":"x"}}}');
    assert.throws(() => createSecretVault({ dir: d, keyB64: generateVaultKey() }), /VAULT_FILE_INVALID/);
    fs.writeFileSync(path.join(d, "vault.enc.json"), '{"version":"1","entries":[]}');
    assert.throws(() => createSecretVault({ dir: d, keyB64: generateVaultKey() }), /VAULT_FILE_INVALID/);
  } finally { rm(d); }
});

test("vault: lock, unlock with the right key only, throttling after repeated failures", () => {
  let t = 1000; const { d, o, key, v, ap } = mk({ nowFn: () => t, unlockMaxFailures: 3, unlockThrottleMs: 5000 });
  try {
    v.set("A", SECRET, { ownerApproval: ap("VAULT_SET", "A") });
    assert.equal(v.lock().state, "LOCKED"); assert.equal(v.status().state, "LOCKED");
    assert.throws(() => v.get("A", { purpose: "t" }), /VAULT_LOCKED_NO_KEY/);
    for (let i = 0; i < 3; i++) assert.throws(() => v.unlock(generateVaultKey()), /VAULT_WRONG_KEY/);
    assert.throws(() => v.unlock(key), /VAULT_UNLOCK_THROTTLED/, "even the right key is refused while throttled");
    t += 5001;
    assert.throws(() => v.unlock("not-base64-32-bytes"), /VAULT_WRONG_KEY/);
    assert.equal(v.unlock(key).state, "UNLOCKED");
    assert.equal(v.get("A", { purpose: "t" }), SECRET);
    assert.ok(v.auditEntries().some(e => e.event === "VAULT_UNLOCK_FAILED"));
  } finally { rm(d); }
});

test("vault: idle auto-lock (opt-in) zeroes access; default stays unlimited for existing callers", () => {
  let t = 0; const a = mk({ nowFn: () => t, idleLockMs: 1000 });
  try {
    a.v.set("A", SECRET, { ownerApproval: a.ap("VAULT_SET", "A") });
    t = 900; assert.equal(a.v.get("A", { purpose: "t" }), SECRET);      // activity resets the idle clock
    t = 1800; assert.equal(a.v.get("A", { purpose: "t" }), SECRET);
    t = 3000; assert.equal(a.v.status().state, "LOCKED");
    assert.throws(() => a.v.get("A", { purpose: "t" }), /VAULT_LOCKED_NO_KEY/);
    assert.equal(a.v.redact("x " + SECRET), "x " + SECRET, "a locked vault cannot redact (documented)");
    a.v.unlock(a.key); assert.equal(a.v.get("A", { purpose: "t" }), SECRET);
    assert.ok(a.v.auditEntries().some(e => e.event === "VAULT_LOCKED"));
  } finally { rm(a.d); }
  const b = mk({ nowFn: () => 1e12 });
  try { b.v.set("A", SECRET, { ownerApproval: b.ap("VAULT_SET", "A") }); assert.equal(b.v.status().state, "UNLOCKED"); assert.equal(b.v.status().idleLockMs, 0); } finally { rm(b.d); }
  assert.throws(() => createSecretVault({ dir: tmp(), keyB64: generateVaultKey(), idleLockMs: -1 }), /VAULT_IDLE_LOCK_INVALID/);
});

test("vault: revoke needs the exact owner approval, leaves a tombstone, and the name can be re-created", () => {
  const { d, v, ap } = mk();
  try {
    v.set("A", SECRET, { ownerApproval: ap("VAULT_SET", "A") }); v.set("A", SECRET + "2", { ownerApproval: ap("VAULT_SET", "A") });
    assert.equal(v.meta("A").rotations, 1);
    assert.throws(() => v.revoke("A"), /OWNER_APPROVAL_REQUIRED/);
    assert.throws(() => v.revoke("A", { ownerApproval: ap("VAULT_REVOKE", "B") }), /OWNER_APPROVAL_REQUIRED/);
    assert.equal(v.revoke("A", { ownerApproval: ap("VAULT_REVOKE", "A"), reason: "leaked in test" }), true);
    assert.equal(v.has("A"), false); assert.deepEqual(v.list(), []);
    assert.throws(() => v.get("A", { purpose: "t" }), /VAULT_CREDENTIAL_REVOKED/);
    assert.equal(v.meta("A").active, false); assert.equal(v.status().revoked, 1);
    assert.equal(v.redact(SECRET + "2"), SECRET + "2", "a destroyed value is no longer known");
    const disk = JSON.parse(fs.readFileSync(path.join(d, "vault.enc.json"), "utf8")); assert.equal(disk.entries.A.ct, undefined); assert.equal(typeof disk.entries.A.revokedAt, "string");
    assert.equal(v.revoke("A", { ownerApproval: ap("VAULT_REVOKE", "A") }), false, "already revoked");
    v.set("A", "fresh-value-123456", { ownerApproval: ap("VAULT_SET", "A") }); assert.equal(v.get("A", { purpose: "t" }), "fresh-value-123456"); assert.equal(v.meta("A").revokedAt, null);
  } finally { rm(d); }
});

test("vault: emergency shutdown survives a restart (even with the env key) until an owner-approved resume", () => {
  const { d, o, key, v, ap } = mk();
  try {
    v.set("A", SECRET, { ownerApproval: ap("VAULT_SET", "A") });
    assert.throws(() => v.emergencyShutdown({}), /OWNER_APPROVAL_REQUIRED/);
    assert.throws(() => v.emergencyShutdown({ ownerApproval: ap("VAULT_EMERGENCY_SHUTDOWN", "SOMETHING") }), /OWNER_APPROVAL_REQUIRED/);
    assert.deepEqual(v.emergencyShutdown({ ownerApproval: ap("VAULT_EMERGENCY_SHUTDOWN", "ALL"), reason: "drill" }), { state: "LOCKED", shutdown: true });
    const v2 = createSecretVault({ dir: d, keyB64: key, ownerAuth: o.auth });
    assert.equal(v2.status().state, "LOCKED"); assert.equal(v2.status().shutdown, true);
    assert.throws(() => v2.get("A", { purpose: "t" }), /VAULT_LOCKED_NO_KEY/);
    assert.throws(() => v2.unlock(key), /OWNER_APPROVAL_REQUIRED:VAULT_RESUME/, "key alone does not resume");
    const ra = ap("VAULT_RESUME", "ALL");
    assert.throws(() => v2.unlock(generateVaultKey(), { ownerApproval: ra }), /VAULT_WRONG_KEY/);
    v2.unlock(key, { ownerApproval: ra });      // the approval was not burnt by the wrong-key attempt
    assert.equal(v2.get("A", { purpose: "t" }), SECRET); assert.equal(v2.status().shutdown, false);
    const v3 = createSecretVault({ dir: d, keyB64: key, ownerAuth: o.auth }); assert.equal(v3.status().state, "UNLOCKED");
  } finally { rm(d); }
});

test("vault: passphrase policy", () => {
  assert.equal(checkBackupPassphrase(PASS), null);
  for (const [p, r] of [["short", "PASSPHRASE_TOO_SHORT"], ["aaaaaaaaaaaaaaaaaaaaaa", "PASSPHRASE_TOO_REPETITIVE"], [undefined, "PASSPHRASE_TOO_SHORT"], ["x".repeat(300) + "yz", "PASSPHRASE_TOO_LONG"]]) assert.equal(checkBackupPassphrase(p), r);
  const k = generateVaultKey(); assert.equal(checkBackupPassphrase(k, k), "PASSPHRASE_MUST_DIFFER_FROM_VAULT_KEY");
});

test("vault backup: owner approval bound to the chosen names; package is opaque; verify/restore work on another vault", () => {
  const a = mk(), b = mk();
  try {
    a.v.set("ONE", SECRET, { ownerApproval: a.ap("VAULT_SET", "ONE") }); a.v.set("TWO", "second-secret-ZZZ-999", { ownerApproval: a.ap("VAULT_SET", "TWO") }); a.v.set("THREE", "third", { ownerApproval: a.ap("VAULT_SET", "THREE") });
    assert.throws(() => a.v.exportBackup({ names: ["ONE", "TWO"], passphrase: PASS }), /OWNER_APPROVAL_REQUIRED/);
    assert.throws(() => a.v.exportBackup({ names: ["ONE", "TWO"], passphrase: PASS, ownerApproval: a.ap("VAULT_EXPORT", nameDigest(["ONE"])) }), /OWNER_APPROVAL_REQUIRED/, "approval for a different selection");
    assert.throws(() => a.v.exportBackup({ names: ["ONE", "TWO"], passphrase: "short", ownerApproval: a.ap("VAULT_EXPORT", nameDigest(["ONE", "TWO"])) }), /PASSPHRASE_TOO_SHORT/);
    assert.throws(() => a.v.exportBackup({ names: ["ONE", "NOPE"], passphrase: PASS, ownerApproval: a.ap("VAULT_EXPORT", nameDigest(["ONE", "NOPE"])) }), /UNKNOWN_OR_REVOKED/);
    const ex = a.v.exportBackup({ names: ["TWO", "ONE"], passphrase: PASS, ownerApproval: a.ap("VAULT_EXPORT", nameDigest(["ONE", "TWO"])) });
    assert.equal(ex.count, 2);
    for (const bad of [SECRET, "second-secret-ZZZ-999", "ONE", "TWO", a.key]) assert.equal(ex.package.includes(bad), false, "package must not leak " + bad.slice(0, 6));
    assert.deepEqual(a.v.verifyBackup(ex.package, PASS).names, ["ONE", "TWO"]);
    assert.throws(() => a.v.verifyBackup(ex.package, PASS + "x"), /WRONG_PASSPHRASE_OR_TAMPERED/);
    assert.throws(() => a.v.verifyBackup(ex.package, ""), /PASSPHRASE_REQUIRED/);
    const auditText = JSON.stringify(a.v.auditEntries()); assert.equal(auditText.includes(SECRET), false); assert.equal(auditText.includes(PASS), false);
    // restore into a different vault with its own key; approval is bound to the package id
    assert.throws(() => b.v.restoreBackup(ex.package, PASS), /OWNER_APPROVAL_REQUIRED/);
    assert.throws(() => b.v.restoreBackup(ex.package, PASS, { ownerApproval: b.ap("VAULT_RESTORE", "backup:other") }), /OWNER_APPROVAL_REQUIRED/);
    const r = b.v.restoreBackup(ex.package, PASS, { ownerApproval: b.ap("VAULT_RESTORE", ex.restoreSubject) });
    assert.deepEqual(r.restored, ["ONE", "TWO"]); assert.equal(b.v.get("ONE", { purpose: "t" }), SECRET); assert.equal(b.v.get("TWO", { purpose: "t" }), "second-secret-ZZZ-999");
    assert.equal(b.v.has("THREE"), false);
    // conflict: refuses without overwrite and changes nothing; overwrite needs its own approval subject
    b.v.set("ONE", "local-changed-value", { ownerApproval: b.ap("VAULT_SET", "ONE") });
    assert.throws(() => b.v.restoreBackup(ex.package, PASS, { ownerApproval: b.ap("VAULT_RESTORE", ex.restoreSubject) }), /VAULT_RESTORE_CONFLICT:ONE,TWO/);
    assert.equal(b.v.get("ONE", { purpose: "t" }), "local-changed-value");
    assert.throws(() => b.v.restoreBackup(ex.package, PASS, { overwrite: true, ownerApproval: b.ap("VAULT_RESTORE", ex.restoreSubject) }), /OWNER_APPROVAL_REQUIRED/);
    const ow = b.v.restoreBackup(ex.package, PASS, { overwrite: true, ownerApproval: b.ap("VAULT_RESTORE", ex.restoreSubject + ":overwrite") });
    assert.deepEqual(ow.overwritten, ["ONE", "TWO"]); assert.equal(b.v.get("ONE", { purpose: "t" }), SECRET);
  } finally { rm(a.d); rm(b.d); }
});

test("vault backup: any tampering, parameter swap or locked target is rejected and leaves the store untouched", () => {
  const a = mk(), b = mk();
  try {
    a.v.set("ONE", SECRET, { ownerApproval: a.ap("VAULT_SET", "ONE") });
    const ex = a.v.exportBackup({ names: ["ONE"], passphrase: PASS, ownerApproval: a.ap("VAULT_EXPORT", nameDigest(["ONE"])) });
    const pkg = JSON.parse(ex.package);
    const flip = s => s.slice(0, 2) + (s[2] === "A" ? "B" : "A") + s.slice(3);
    for (const [label, mut] of [["ct", p => ({ ...p, ct: flip(p.ct) })], ["tag", p => ({ ...p, tag: flip(p.tag) })], ["iv", p => ({ ...p, iv: flip(p.iv) })], ["id (AAD)", p => ({ ...p, id: "0".repeat(24) })], ["salt (AAD)", p => ({ ...p, kdf: { ...p.kdf, salt: flip(p.kdf.salt) } })]])
      assert.throws(() => a.v.verifyBackup(JSON.stringify(mut(pkg)), PASS), /WRONG_PASSPHRASE_OR_TAMPERED/, label);
    for (const kdf of [{ ...pkg.kdf, N: 2 }, { ...pkg.kdf, r: 1 }, { ...pkg.kdf, N: 2 ** 24 }]) assert.throws(() => a.v.verifyBackup(JSON.stringify({ ...pkg, kdf }), PASS), /KDF_UNSUPPORTED/);
    for (const junk of ["", "{}", "[]", "null", "not json", JSON.stringify({ ...pkg, format: "X" }), JSON.stringify({ ...pkg, v: 2 })]) assert.throws(() => a.v.verifyBackup(junk, PASS), /VAULT_BACKUP_(UNREADABLE|INVALID)/);
    b.v.lock(); assert.throws(() => b.v.restoreBackup(ex.package, PASS, { ownerApproval: b.ap("VAULT_RESTORE", ex.restoreSubject) }), /VAULT_LOCKED_NO_KEY/);
    assert.deepEqual(b.v.list(), []);
    const rejected = a.v.auditEntries().filter(e => e.event === "VAULT_BACKUP_REJECTED").length; assert.ok(rejected >= 5);
    a.v.revoke("ONE", { ownerApproval: a.ap("VAULT_REVOKE", "ONE") });
    assert.throws(() => a.v.exportBackup({ names: ["ONE"], passphrase: PASS, ownerApproval: a.ap("VAULT_EXPORT", nameDigest(["ONE"])) }), /UNKNOWN_OR_REVOKED/);
  } finally { rm(a.d); rm(b.d); }
});

test("vault: redact also removes URL-encoded, base64 and JSON-escaped forms", () => {
  const { d, v, ap } = mk();
  try {
    const sec = 'tok/en+with"odd chars=1';
    v.set("K", sec, { ownerApproval: ap("VAULT_SET", "K") });
    for (const form of [sec, encodeURIComponent(sec), Buffer.from(sec).toString("base64"), JSON.stringify(sec).slice(1, -1)]) assert.equal(v.redact("a " + form + " b"), "a [REDACTED:K] b");
  } finally { rm(d); }
});

// ------------------------------- broker -------------------------------
const fakeFetch = (handler, calls = []) => async (url, init) => {
  calls.push({ url: String(url), init });
  const r = await handler(url, init);
  const h = new Headers(r.headers ?? {});
  return { status: r.status ?? 200, headers: h, text: async () => r.body ?? "", body: r.stream };
};
const GRANT = { id: "g1", credential: "API", agents: ["S-01"], roles: [], hosts: ["api.example-data.com"], methods: ["GET"], pathPrefixes: ["/v1"], purpose: "synthetic test grant", expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() };
function mkb(over = {}, vopts = {}) {
  const base = mk(vopts); base.v.set("API", SECRET, { ownerApproval: base.ap("VAULT_SET", "API") });
  const calls = [];
  const opts = { vault: base.v, ownerAuth: base.o.auth, fetchImpl: fakeFetch(() => ({ status: 200, body: '{"ok":true}', headers: { "content-type": "application/json", "set-cookie": "x=1", location: "https://evil.example/" } }), calls), gate: () => ({ allowed: true }), stateDir: path.join(base.d, "broker"), ...over };
  const br = createCredentialBroker(opts);
  const addGrant = (g = GRANT) => { const n = normaliseGrant(g); return br.grant(g, { ownerApproval: base.ap("BROKER_GRANT", grantSubject(n.grant)) }); };
  return { ...base, br, calls, addGrant, opts };
}

test("broker: grant needs an owner approval bound to the exact grant content; bad definitions are refused", () => {
  const t = mkb();
  try {
    assert.throws(() => t.br.grant(GRANT), /OWNER_APPROVAL_REQUIRED/);
    const n = normaliseGrant(GRANT);
    assert.throws(() => t.br.grant({ ...GRANT, hosts: ["api.example-data.com", "evil.example-data.com"] }, { ownerApproval: t.ap("BROKER_GRANT", grantSubject(n.grant)) }), /OWNER_APPROVAL_REQUIRED/, "approval does not cover widened hosts");
    assert.throws(() => t.br.grant(GRANT, { ownerApproval: t.ap("BROKER_GRANT", "grant:g1:wrong") }), /OWNER_APPROVAL_REQUIRED/);
    assert.equal(t.addGrant().id, "g1");
    const bad = (patch, re) => assert.match(normaliseGrant({ ...GRANT, ...patch }).error ?? "OK", re);
    bad({ id: "bad id" }, /GRANT_ID_INVALID/); bad({ credential: "__proto__" }, /CREDENTIAL_INVALID/); bad({ agents: [], roles: [] }, /NEEDS_AGENTS_OR_ROLES/);
    bad({ hosts: [] }, /HOSTS_REQUIRED/); bad({ hosts: ["localhost"] }, /HOST_INVALID/); bad({ hosts: ["127.0.0.1"] }, /HOST_(INVALID|NOT_PUBLIC)/); bad({ hosts: ["10.0.0.1"] }, /HOST_(INVALID|NOT_PUBLIC)/);
    bad({ hosts: ["db.internal"] }, /NOT_PUBLIC/); bad({ hosts: ["Api.Example.com"] }, /HOST_INVALID/); bad({ hosts: ["a.b.c.d.e.f"] }, /OK|HOST/); bad({ hosts: ["intranet"] }, /HOST_INVALID/); bad({ hosts: ["https://x.com"] }, /HOST_INVALID/);
    bad({ methods: ["POST"] }, /NEED_allowWrite/); bad({ methods: ["GET", "TRACE"] }, /NEED_allowWrite|METHODS_INVALID/); bad({ allowWrite: true, methods: ["CONNECT"] }, /METHODS_INVALID/);
    bad({ pathPrefixes: ["v1"] }, /PATH_PREFIX/); bad({ pathPrefixes: ["/v1/../x"] }, /PATH_PREFIX/); bad({ pathPrefixes: ["/v1/%2e%2e/x"] }, /PATH_PREFIX/); bad({ pathPrefixes: ["/a?b"] }, /PATH_PREFIX/);
    bad({ auth: { style: "header", name: "Cookie" } }, /AUTH_HEADER_INVALID/); bad({ auth: { style: "header", name: "x y" } }, /AUTH_HEADER_INVALID/); bad({ auth: { style: "query" } }, /AUTH_INVALID/);
    bad({ maxPerMinute: 0 }, /LIMITS/); bad({ maxPerDay: 1e9 }, /LIMITS/); bad({ expiresAt: "2001-01-01T00:00:00Z" }, /EXPIRY/); bad({ expiresAt: new Date(Date.now() + 400 * 864e5).toISOString() }, /TOO_FAR/); bad({ expiresAt: "soon" }, /EXPIRY/); bad({ purpose: "" }, /PURPOSE/);
    assert.throws(() => t.br.grant({ ...GRANT, id: "g2", credential: "MISSING" }, { ownerApproval: t.ap("BROKER_GRANT", grantSubject(normaliseGrant({ ...GRANT, id: "g2", credential: "MISSING" }).grant)) }), /NOT_IN_VAULT/);
  } finally { rm(t.d); }
});

test("broker: happy path injects the credential, the agent only sees a redacted capped answer", async () => {
  const echo = fakeFetch((url, init) => ({ status: 200, headers: { "content-type": "text/plain", "x-ratelimit-remaining": "9", "set-cookie": "s=1", authorization: "leak" }, body: "echo " + init.headers.authorization + " / " + encodeURIComponent(SECRET) + " / " + Buffer.from(SECRET).toString("base64") }));
  const t = mkb({ fetchImpl: echo });
  try {
    t.addGrant();
    const r = await t.br.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/items?id=7", headers: { accept: "application/json" } });
    assert.equal(r.ok, true); assert.equal(r.status, 200);
    assert.equal(JSON.stringify(r).includes(SECRET), false); assert.equal(JSON.stringify(r).includes(encodeURIComponent(SECRET)), false);
    assert.ok(r.body.includes("[REDACTED"), r.body); assert.deepEqual(Object.keys(r.headers).sort(), ["content-type", "x-ratelimit-remaining"]);
    const all = JSON.stringify(t.br.auditEntries()) + JSON.stringify(t.br.summary()) + JSON.stringify(t.br.listGrants()) + fs.readFileSync(path.join(t.d, "broker", "broker-grants.json"), "utf8") + JSON.stringify(t.v.auditEntries());
    assert.equal(all.includes(SECRET), false, "secret must not appear in any audit/state/summary");
    assert.equal(all.includes("id=7"), false, "query strings are not logged");
    assert.ok(t.br.auditEntries().some(e => e.event === "BROKER_REQUEST" && e.data.path === "/v1/items" && e.data.status === 200));
    assert.ok(t.v.auditEntries().some(e => e.event === "VAULT_READ" && e.data.purpose === "broker:g1:S-01"));
  } finally { rm(t.d); }
});

test("broker: the credential header is what the request carries (bearer and custom header), agents cannot override it", async () => {
  const seen = []; const t = mkb({ fetchImpl: fakeFetch((u, i) => { seen.push(i); return { body: "x" }; }) });
  try {
    t.addGrant(); t.addGrant({ ...GRANT, id: "g2", auth: { style: "header", name: "X-Api-Key" } });
    await t.br.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/a" });
    await t.br.request({ agentId: "S-01", grantId: "g2", url: "https://api.example-data.com/v1/a" });
    assert.equal(seen[0].headers.authorization, "Bearer " + SECRET); assert.equal(seen[1].headers["x-api-key"], SECRET); assert.equal(seen[1].headers.authorization, undefined);
    assert.equal(seen[0].redirect, "manual"); assert.equal(seen[0].method, "GET");
    for (const h of ["Authorization", "authorization", "AUTHORIZATION", "X-Api-Key", "Cookie", "Host", "x-forwarded-for", "content-length"]) {
      const r = await t.br.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/a", headers: { [h]: "attacker" } });
      assert.equal(r.reason, "HEADER_NOT_ALLOWED", h);
    }
    assert.equal((await t.br.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/a", headers: { accept: "a\r\nX-Evil: 1" } })).reason, "HEADER_NOT_ALLOWED");
    assert.equal(seen.length, 2, "refused requests never reach the network");
  } finally { rm(t.d); }
});

test("broker: destination, scheme, port, userinfo, path and method restrictions", async () => {
  const t = mkb(); const R = (url, extra = {}) => t.br.request({ agentId: "S-01", grantId: "g1", url, ...extra });
  try {
    t.addGrant();
    const cases = [["http://api.example-data.com/v1/a", "HTTPS_REQUIRED"], ["https://user:pw@api.example-data.com/v1/a", "URL_CREDENTIALS_FORBIDDEN"], ["https://api.example-data.com:8443/v1/a", "PORT_NOT_ALLOWED"],
      ["https://evil.example-data.com/v1/a", "HOST_NOT_ALLOWED"], ["https://api.example-data.com.evil.net/v1/a", "HOST_NOT_ALLOWED"], ["https://xapi.example-data.com/v1/a", "HOST_NOT_ALLOWED"], ["https://127.0.0.1/v1/a", "HOST_NOT_ALLOWED"],
      ["https://[::1]/v1/a", "HOST_NOT_ALLOWED"], ["https://api.example-data.com/v2/a", "PATH_NOT_ALLOWED"], ["https://api.example-data.com/v1/../admin", "PATH_NOT_ALLOWED"], ["https://api.example-data.com/v1/%2e%2e/admin", "PATH_NOT_ALLOWED"],
      ["https://api.example-data.com/v10/a", "PATH_NOT_ALLOWED"], ["https://api.example-data.com\\@evil.net/v1", "PATH_NOT_ALLOWED"], ["not a url", "URL_INVALID"], ["https://api.example-data.com/" + "a".repeat(2100), "URL_INVALID"]];
    for (const [u, why] of cases) assert.equal((await R(u)).reason, why, u.slice(0, 60));
    assert.equal((await R(undefined)).reason, "URL_INVALID"); assert.equal((await R({ toString: () => "https://api.example-data.com/v1/a" })).reason, "URL_INVALID");
    for (const m of ["POST", "PUT", "DELETE", "PATCH", "CONNECT", "TRACE", "get "]) assert.equal((await R("https://api.example-data.com/v1/a", { method: m })).reason, "METHOD_NOT_ALLOWED", m);
    assert.equal((await R("https://api.example-data.com/v1/a", { body: "x" })).reason, "BODY_NOT_ALLOWED_FOR_METHOD");
    assert.equal(t.calls.length, 0);
    assert.equal((await R("https://API.EXAMPLE-DATA.COM/v1/a")).ok, true, "host names are case-insensitive");
    assert.equal((await R("https://api.example-data.com:443/v1/a")).ok, true);
    assert.equal((await R("https://api.example-data.com/v1")).ok, true, "the prefix itself is allowed");
    assert.equal(t.calls.length, 3);
  } finally { rm(t.d); }
});

test("broker: write methods only with allowWrite, body size cap, json body", async () => {
  const t = mkb({ maxBodyBytes: 50 });
  try {
    t.addGrant({ ...GRANT, id: "w1", allowWrite: true, methods: ["GET", "POST"] });
    const R = o => t.br.request({ agentId: "S-01", grantId: "w1", url: "https://api.example-data.com/v1/a", ...o });
    const r = await R({ method: "post", body: { a: 1 } }); assert.equal(r.ok, true);
    assert.equal(t.calls[0].init.body, '{"a":1}'); assert.equal(t.calls[0].init.headers["content-type"], "application/json");
    assert.equal((await R({ method: "POST", body: "x".repeat(51) })).reason, "BODY_TOO_LARGE");
    const cyc = {}; cyc.c = cyc; assert.equal((await R({ method: "POST", body: cyc })).reason, "BODY_NOT_SERIALISABLE");
    assert.equal((await R({ method: "DELETE" })).reason, "METHOD_NOT_ALLOWED");
  } finally { rm(t.d); }
});

test("broker: agents, roles, roster, kill switch, locked vault, revoked credential, expiry", async () => {
  let stop = false, t0 = Date.now();
  const t = mkb({ gate: () => ({ allowed: !stop }), roleOf: a => (a === "E-07" ? "EXECUTION" : null), isKnownAgent: a => ["S-01", "E-07", "X-99"].includes(a), now: () => t0 });
  const R = (agentId, gid = "g1") => t.br.request({ agentId, grantId: gid, url: "https://api.example-data.com/v1/a" });
  try {
    t.addGrant(); t.addGrant({ ...GRANT, id: "r1", agents: [], roles: ["EXECUTION"] });
    assert.equal((await R("S-01")).ok, true);
    assert.equal((await R("E-07")).reason, "AGENT_NOT_ALLOWED"); assert.equal((await R("X-99")).reason, "AGENT_NOT_ALLOWED"); assert.equal((await R("ghost")).reason, "UNKNOWN_AGENT");
    assert.equal((await R("E-07", "r1")).ok, true, "role grant"); assert.equal((await R("S-01", "r1")).reason, "AGENT_NOT_ALLOWED");
    assert.equal((await R("S-01", "nope")).reason, "NO_SUCH_GRANT"); assert.equal((await R("bad agent!")).reason, "AGENT_INVALID"); assert.equal((await R("")).reason, "AGENT_INVALID");
    stop = true; assert.equal((await R("S-01")).reason, "OWNER_STOP"); stop = false;
    const throwing = mkb({ gate: () => { throw new Error("boom"); } }); try { throwing.addGrant(); assert.equal((await throwing.br.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/a" })).reason, "OWNER_STOP", "a failing gate stops (fail closed)"); } finally { rm(throwing.d); }
    t.v.lock(); assert.equal((await R("S-01")).reason, "VAULT_LOCKED"); t.v.unlock(t.key);
    t.v.revoke("API", { ownerApproval: t.ap("VAULT_REVOKE", "API") }); assert.equal((await R("S-01")).reason, "CREDENTIAL_UNAVAILABLE");
    t.v.set("API", SECRET, { ownerApproval: t.ap("VAULT_SET", "API") }); assert.equal((await R("S-01")).ok, true);
    t0 += 8 * 864e5; assert.equal((await R("S-01")).reason, "GRANT_EXPIRED");
    assert.equal(t.br.listGrants().find(g => g.id === "g1").expired, true);
  } finally { rm(t.d); }
});

test("broker: rate limits per minute and per day, in-flight cap", async () => {
  let t0 = Date.now(); let release; const gateP = new Promise(r => { release = r; });
  const t = mkb({ now: () => t0, maxInflight: 2, fetchImpl: fakeFetch(async (u) => { if (String(u).includes("slow")) await gateP; return { body: "ok" }; }) });
  const R = p => t.br.request({ agentId: "S-01", grantId: "lim", url: "https://api.example-data.com/v1/" + p });
  try {
    t.addGrant({ ...GRANT, id: "lim", maxPerMinute: 3, maxPerDay: 5, expiresAt: new Date(t0 + 864e5).toISOString() });
    for (let i = 0; i < 3; i++) assert.equal((await R("a")).ok, true);
    assert.equal((await R("a")).reason, "RATE_LIMITED_MINUTE");
    t0 += 61000; assert.equal((await R("a")).ok, true); assert.equal((await R("a")).ok, true);
    t0 += 61000; assert.equal((await R("a")).reason, "RATE_LIMITED_DAY");
    t0 += 86400000 - 122000 + 1000;
  } finally { rm(t.d); }
  const t2 = mkb({ maxInflight: 2, fetchImpl: fakeFetch(async (u) => { if (String(u).includes("slow")) await gateP; return { body: "ok" }; }) });
  try {
    t2.addGrant({ ...GRANT, maxPerMinute: 60 });
    const q = p => t2.br.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/" + p });
    const a = q("slow"), b = q("slow"); await new Promise(r => setImmediate(r));
    assert.equal((await q("fast")).reason, "BROKER_BUSY"); release(); assert.equal((await a).ok, true); assert.equal((await b).ok, true);
    assert.equal((await q("fast")).ok, true);
  } finally { rm(t2.d); }
});

test("broker: redirects are never followed, oversized and streamed bodies are capped, hangs time out, errors are redacted", async () => {
  const calls17 = [];
  const t = mkb({ maxResponseBytes: 10, timeoutMs: 60, fetchImpl: fakeFetch(async (u, init) => {
    const s = String(u);
    if (s.endsWith("/redir")) return { status: 302, headers: { location: "https://evil.example/steal" }, body: "moved" };
    if (s.endsWith("/big")) return { body: "0123456789ABCDEFGHIJ" };
    if (s.endsWith("/stream")) { const enc = new TextEncoder(); return { stream: new ReadableStream({ start(c) { c.enqueue(enc.encode("abcdefgh")); c.enqueue(enc.encode("ijklmnop")); c.close(); } }) }; }
    if (s.endsWith("/hang")) return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    if (s.endsWith("/boom")) throw new Error("connect failed using " + SECRET);
    return { body: "ok" };
  }, calls17) });
  const R = (p, m = "GET") => t.br.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/" + p, method: m });
  try {
    t.addGrant({ ...GRANT, methods: ["GET", "HEAD"] });
    const r = await R("redir"); assert.equal(r.ok, false); assert.equal(r.reason, "REDIRECT_NOT_FOLLOWED"); assert.equal(r.status, 302); assert.equal(r.body, undefined); assert.equal(JSON.stringify(r).includes("evil"), false);
    assert.equal(calls17.length, 1, "no second request was made");
    const b = await R("big"); assert.equal(b.body, "0123456789"); assert.equal(b.truncated, true);
    const s = await R("stream"); assert.equal(s.body.length <= 10, true); assert.equal(s.truncated, true);
    const h = await R("hang"); assert.equal(h.reason, "UPSTREAM_ERROR"); assert.equal(h.error, "TIMEOUT");
    const e = await R("boom"); assert.equal(e.reason, "UPSTREAM_ERROR"); assert.equal(JSON.stringify(e).includes(SECRET), false); assert.ok(e.error.includes("REDACTED"));
    assert.equal(JSON.stringify(t.br.auditEntries()).includes(SECRET), false);
    const hd = await R("ok", "HEAD"); assert.equal(hd.ok, true); assert.equal(hd.body, "");
    assert.ok(t.br.summary().upstreamErrors >= 2);
  } finally { rm(t.d); }
});

test("broker: persisted grants are re-verified on load; edited, forged and revoked grants do not come back", async () => {
  const t = mkb();
  try {
    t.addGrant(); t.addGrant({ ...GRANT, id: "g2" });
    const f = path.join(t.d, "broker", "broker-grants.json"), good = fs.readFileSync(f, "utf8");
    const reload = () => createCredentialBroker({ ...t.opts });
    assert.equal(reload().listGrants().length, 2);
    // widen hosts of g1 in the file
    const widened = JSON.parse(good); widened.grants[0].grant.hosts.push("evil.example-data.com"); fs.writeFileSync(f, JSON.stringify(widened));
    let b = reload(); assert.deepEqual(b.listGrants().map(g => g.id), ["g2"]); assert.match(b.summary().integrity, /ENTRIES_REJECTED:1/);
    // grant signed by another owner key
    const other = owner(); const forged = JSON.parse(good); const n = normaliseGrant({ ...GRANT, id: "g3" }); forged.grants.push({ grant: n.grant, approval: other.ap("BROKER_GRANT", grantSubject(n.grant)) });
    fs.writeFileSync(f, JSON.stringify(forged)); b = reload(); assert.deepEqual(b.listGrants().map(g => g.id).sort(), ["g1", "g2"]);
    // missing approval / wrong approval action
    const noap = JSON.parse(good); delete noap.grants[1].approval; fs.writeFileSync(f, JSON.stringify(noap)); assert.deepEqual(reload().listGrants().map(g => g.id), ["g1"]);
    // unreadable / invalid file
    fs.writeFileSync(f, "{{{"); assert.equal(reload().listGrants().length, 0); assert.equal(reload().summary().integrity, "GRANTS_FILE_UNREADABLE");
    fs.writeFileSync(f, '{"grants":5}'); assert.equal(reload().summary().integrity, "GRANTS_FILE_INVALID");
    // revocation: owner approval required, replayed from the audit chain even if the file is restored to the old content
    fs.writeFileSync(f, good);
    assert.throws(() => t.br.revokeGrant("g1"), /OWNER_APPROVAL_REQUIRED/); assert.throws(() => t.br.revokeGrant("g1", { ownerApproval: t.ap("BROKER_REVOKE", "g2") }), /OWNER_APPROVAL_REQUIRED/);
    const live = createCredentialBroker({ ...t.opts }); assert.equal(live.revokeGrant("g1", { ownerApproval: t.ap("BROKER_REVOKE", "g1") }), true); assert.equal(live.revokeGrant("g1", { ownerApproval: t.ap("BROKER_REVOKE", "g1") }), false);
    fs.writeFileSync(f, good);      // attacker restores the old file
    assert.deepEqual(reload().listGrants().map(g => g.id), ["g2"], "revocation is replayed from the audit chain");
    assert.equal((await live.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/a" })).reason, "NO_SUCH_GRANT");
  } finally { rm(t.d); }
});

test("broker: revokeAll needs the owner and empties every grant; audit chain stays valid", async () => {
  const t = mkb();
  try {
    t.addGrant(); t.addGrant({ ...GRANT, id: "g2" });
    assert.throws(() => t.br.revokeAll({}), /OWNER_APPROVAL_REQUIRED/); assert.throws(() => t.br.revokeAll({ ownerApproval: t.ap("BROKER_REVOKE_ALL", "x") }), /OWNER_APPROVAL_REQUIRED/);
    assert.equal(t.br.revokeAll({ ownerApproval: t.ap("BROKER_REVOKE_ALL", "ALL") }), 2);
    assert.equal((await t.br.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/a" })).reason, "NO_SUCH_GRANT");
    assert.equal(createCredentialBroker({ ...t.opts }).listGrants().length, 0);
    assert.equal(t.br.auditVerify().ok ?? true, true);
  } finally { rm(t.d); }
});

test("broker: construction needs a vault and works without a state dir (memory only)", async () => {
  assert.throws(() => createCredentialBroker({}), /VAULT_REQUIRED/);
  const b = mk(); b.v.set("API", SECRET, { ownerApproval: b.ap("VAULT_SET", "API") });
  const br = createCredentialBroker({ vault: b.v, ownerAuth: b.o.auth, fetchImpl: fakeFetch(() => ({ body: "m" })), gate: () => ({ allowed: true }) });
  try {
    const n = normaliseGrant(GRANT); br.grant(GRANT, { ownerApproval: b.ap("BROKER_GRANT", grantSubject(n.grant)) });
    assert.equal((await br.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/x" })).body, "m");
  } finally { rm(b.d); }
});

// ---------------- additional hardening tests (mutation survivors turned into tests) ----------------
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
function craft(payloadObj, pass = PASS, id = randomBytes(12).toString("hex")) {
  const salt = randomBytes(16).toString("base64"), h = { format: "ATLASZ-VAULT-BACKUP", v: 1, id, kdf: { N: 32768, r: 8, p: 1, salt } };
  const k = scryptSync(pass, Buffer.from(salt, "base64"), 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }), iv = randomBytes(12), c = createCipheriv("aes-256-gcm", k, iv);
  c.setAAD(Buffer.from(JSON.stringify([h.format, h.v, h.id, h.kdf.N, h.kdf.r, h.kdf.p, h.kdf.salt])));
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(payloadObj))), c.final()]);
  return { pkg: JSON.stringify({ ...h, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") }), id: h.id };
}
const manifest = e => createHash("sha256").update(JSON.stringify(Object.keys(e).sort().map(n => [n, e[n]]))).digest("hex");

test("vault backup: a correctly encrypted but inconsistent or hostile payload is still refused (defence in depth)", () => {
  const { d, v } = mk();
  try {
    const ok = { A: "value-one-123" };
    assert.equal(v.verifyBackup(craft({ createdAt: "x", entries: ok, count: 1, manifestSha: manifest(ok) }).pkg, PASS).count, 1, "control: a well-formed crafted package is accepted");
    for (const [label, payload] of [
      ["wrong manifest", { createdAt: "x", entries: ok, count: 1, manifestSha: "0".repeat(64) }],
      ["wrong count", { createdAt: "x", entries: ok, count: 2, manifestSha: manifest(ok) }],
      ["entries as array", { createdAt: "x", entries: ["a"], count: 1, manifestSha: "x" }],
      ["no entries", { createdAt: "x", count: 0 }],
      ["non-string value", { createdAt: "x", entries: { A: 5 }, count: 1, manifestSha: manifest({ A: 5 }) }],
      ["empty value", { createdAt: "x", entries: { A: "" }, count: 1, manifestSha: manifest({ A: "" }) }],
      ["bad name", { createdAt: "x", entries: { "bad name": "v" }, count: 1, manifestSha: manifest({ "bad name": "v" }) }],
      ["constructor name", { createdAt: "x", entries: { constructor: "v" }, count: 1, manifestSha: manifest({ constructor: "v" }) }],
    ]) assert.throws(() => v.verifyBackup(craft(payload).pkg, PASS), /VAULT_BACKUP_(MANIFEST_MISMATCH|CORRUPT)/, label);
    const proto = JSON.parse('{"createdAt":"x","entries":{"__proto__":"v"},"count":1,"manifestSha":"x"}');
    assert.throws(() => v.verifyBackup(craft(proto).pkg, PASS), /VAULT_BACKUP_(MANIFEST_MISMATCH|CORRUPT)/);
    assert.equal(({}).v, undefined);
  } finally { rm(d); }
});

test("vault backup: a failed write during restore leaves the vault exactly as it was", () => {
  const a = mk(), b = mk();
  try {
    a.v.set("ONE", SECRET, { ownerApproval: a.ap("VAULT_SET", "ONE") });
    const ex = a.v.exportBackup({ names: ["ONE"], passphrase: PASS, ownerApproval: a.ap("VAULT_EXPORT", nameDigest(["ONE"])) });
    b.v.set("KEEP", "keep-this-value", { ownerApproval: b.ap("VAULT_SET", "KEEP") });
    fs.mkdirSync(path.join(b.d, "vault.enc.json.tmp"));      // makes the atomic write fail
    assert.throws(() => b.v.restoreBackup(ex.package, PASS, { ownerApproval: b.ap("VAULT_RESTORE", ex.restoreSubject) }), /EISDIR|EPERM|EACCES/);
    assert.deepEqual(b.v.list(), ["KEEP"]); assert.equal(b.v.has("ONE"), false);
    fs.rmdirSync(path.join(b.d, "vault.enc.json.tmp"));
    assert.deepEqual(b.v.restoreBackup(ex.package, PASS, { ownerApproval: b.ap("VAULT_RESTORE", ex.restoreSubject) }).restored, ["ONE"], "the approval was not the problem: a new one works");
  } finally { rm(a.d); rm(b.d); }
});

test("broker: other vault secrets and very short secrets are redacted from responses and errors too", async () => {
  const short = "ab12";
  const t = mkb({ fetchImpl: fakeFetch((u) => { const s = String(u); if (s.endsWith("/boom")) throw new Error("fail " + short); return { body: "other=" + "second-credential-VALUE-77" + " short=" + short }; }) });
  try {
    t.v.set("OTHER", "second-credential-VALUE-77", { ownerApproval: t.ap("VAULT_SET", "OTHER") });
    t.v.set("SHORT", short, { ownerApproval: t.ap("VAULT_SET", "SHORT") });
    t.addGrant({ ...GRANT, credential: "SHORT" });
    const r = await t.br.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/a" });
    assert.equal(r.body.includes("second-credential-VALUE-77"), false, "a different vault secret echoed by the server is redacted");
    assert.equal(r.body.includes("ab12"), false, "the short credential in use is redacted by the broker itself (the vault skips values under 6 chars)");
    const e = await t.br.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/boom" });
    assert.equal(e.error.includes("ab12"), false);
  } finally { rm(t.d); }
});

test("broker: a revoked credential cannot be used even though the grant still exists (no network call)", async () => {
  const n = [];
  const t = mkb({ fetchImpl: fakeFetch(() => { n.push(1); return { body: "x" }; }) });
  try {
    t.addGrant(); t.v.revoke("API", { ownerApproval: t.ap("VAULT_REVOKE", "API") });
    assert.equal((await t.br.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/a" })).reason, "CREDENTIAL_UNAVAILABLE");
    assert.equal(n.length, 0);
    assert.ok(t.br.auditEntries().some(e => e.event === "BROKER_DENIED" && e.data.reason === "CREDENTIAL_UNAVAILABLE"));
  } finally { rm(t.d); }
});

// ---------------- round-1 independent verification findings: regression tests ----------------
test("vault: shutdown and revocation cannot be undone by a stale instance, an edited flag or an old file copy", () => {
  const a = mk();
  try {
    const open = () => createSecretVault({ dir: a.d, keyB64: a.key, ownerAuth: a.o.auth });
    a.v.set("API", SECRET, { ownerApproval: a.ap("VAULT_SET", "API") }); a.v.set("OTHER", "other-value-1234", { ownerApproval: a.ap("VAULT_SET", "OTHER") });
    const old = fs.readFileSync(path.join(a.d, "vault.enc.json"), "utf8");
    const stale = open();
    // revocation by one instance, write by a stale one, then an old file copy
    a.v.revoke("API", { ownerApproval: a.ap("VAULT_REVOKE", "API") });
    stale.set("THIRD", "third-value-1234", { ownerApproval: a.ap("VAULT_SET", "THIRD") });
    assert.equal(stale.has("API"), false, "the stale instance saw the revocation before writing");
    assert.equal(open().has("API"), false); assert.deepEqual(open().list(), ["OTHER", "THIRD"]);
    fs.writeFileSync(path.join(a.d, "vault.enc.json"), old);      // attacker restores an old copy that still has the secret
    const r = open(); assert.equal(r.has("API"), false); assert.throws(() => r.get("API", { purpose: "t" }), /REVOKED/);
    assert.equal(r.meta("API").reason, "REPLAYED_FROM_AUDIT");
    // re-creating a revoked name stays possible and sticks
    r.set("API", "new-api-value-9999", { ownerApproval: a.ap("VAULT_SET", "API") }); assert.equal(open().get("API", { purpose: "t" }), "new-api-value-9999");
    // shutdown: edited flag, stale writer
    const s2 = open();
    a.v.emergencyShutdown({ ownerApproval: a.ap("VAULT_EMERGENCY_SHUTDOWN", "ALL") });
    assert.equal(s2.status().state, "LOCKED", "the other instance locks as soon as it notices"); assert.throws(() => s2.set("X", "x-value-1234", { ownerApproval: a.ap("VAULT_SET", "X") }), /VAULT_LOCKED_NO_KEY/);
    const f = path.join(a.d, "vault.enc.json"), doc = JSON.parse(fs.readFileSync(f, "utf8")); assert.ok(doc.shutdown); delete doc.shutdown; fs.writeFileSync(f, JSON.stringify(doc));
    const t = open(); assert.equal(t.status().state, "LOCKED"); assert.equal(t.status().shutdown, true); assert.throws(() => t.get("OTHER", { purpose: "t" }), /VAULT_LOCKED_NO_KEY/);
    t.unlock(a.key, { ownerApproval: a.ap("VAULT_RESUME", "ALL") }); assert.equal(open().status().state, "UNLOCKED", "an approved resume really clears it, also for later instances");
  } finally { rm(a.d); }
});

test("vault: opening an existing vault with the wrong key means LOCKED, never a mixed-key file", () => {
  const a = mk();
  try {
    a.v.set("API", SECRET, { ownerApproval: a.ap("VAULT_SET", "API") });
    const before = fs.readFileSync(path.join(a.d, "vault.enc.json"), "utf8");
    const w = createSecretVault({ dir: a.d, keyB64: generateVaultKey(), ownerAuth: a.o.auth });
    assert.equal(w.status().state, "LOCKED"); assert.throws(() => w.set("NEW", "new-value-1234", { ownerApproval: a.ap("VAULT_SET", "NEW") }), /VAULT_LOCKED_NO_KEY/);
    assert.equal(fs.readFileSync(path.join(a.d, "vault.enc.json"), "utf8"), before);
    assert.ok(a.v.auditEntries().some(e => e.event === "VAULT_WRONG_KEY_DETECTED") || w.auditEntries().some(e => e.event === "VAULT_WRONG_KEY_DETECTED"));
  } finally { rm(a.d); }
});

test("vault backup: the restore approval is bound to the package content, not only its id", () => {
  const a = mk(), b = mk();
  try {
    a.v.set("API", SECRET, { ownerApproval: a.ap("VAULT_SET", "API") });
    const ex = a.v.exportBackup({ names: ["API"], passphrase: PASS, ownerApproval: a.ap("VAULT_EXPORT", nameDigest(["API"])) });
    const evil = { API: "ATTACKER-CHOSEN-VALUE" };
    const forged = craft({ createdAt: "x", entries: evil, count: 1, manifestSha: manifest(evil) }, "attacker passphrase 7777", ex.id);
    assert.equal(JSON.parse(forged.pkg).id, ex.id);
    assert.throws(() => b.v.restoreBackup(forged.pkg, "attacker passphrase 7777", { ownerApproval: b.ap("VAULT_RESTORE", ex.restoreSubject) }), /OWNER_APPROVAL_REQUIRED/);
    assert.equal(b.v.has("API"), false);
    assert.match(ex.restoreSubject, /^backup:[0-9a-f]{24}:[0-9a-f]{32}$/);
    assert.equal(b.v.verifyBackup(ex.package, PASS).restoreSubject, ex.restoreSubject);
  } finally { rm(a.d); rm(b.d); }
});

test("vault: backup passphrase policy rejects weak and key-derived phrases; truncated authentication tags are refused", () => {
  const key = generateVaultKey();
  for (const p of ["1234567890123456", "abcdefghabcdefgh", "passwordpassword1", key.replace(/=+$/, ""), Buffer.from(key, "base64").toString("hex"), key + " ", "my pass " + key, "ALLUPPERCASELETTERS"]) assert.notEqual(checkBackupPassphrase(p, key), null, p.slice(0, 20));
  assert.equal(checkBackupPassphrase("Tr0ub4dor&3 horse staple", key), null);
  const a = mk();
  try {
    a.v.set("API", SECRET, { ownerApproval: a.ap("VAULT_SET", "API") });
    const ex = a.v.exportBackup({ names: ["API"], passphrase: PASS, ownerApproval: a.ap("VAULT_EXPORT", nameDigest(["API"])) });
    const pkg = JSON.parse(ex.package); for (const n of [4, 8, 12]) assert.throws(() => a.v.verifyBackup(JSON.stringify({ ...pkg, tag: Buffer.from(pkg.tag, "base64").subarray(0, n).toString("base64") }), PASS), /VAULT_BACKUP_INVALID/);
    const f = path.join(a.d, "vault.enc.json"), doc = JSON.parse(fs.readFileSync(f, "utf8")); doc.entries.API.tag = Buffer.from(doc.entries.API.tag, "base64").subarray(0, 12).toString("base64"); fs.writeFileSync(f, JSON.stringify(doc));
    assert.throws(() => createSecretVault({ dir: a.d, keyB64: a.key, ownerAuth: a.o.auth }).get("API", { purpose: "t" }), /VAULT_LOCKED_NO_KEY|TAMPERED/);
  } finally { rm(a.d); }
});

test("broker: request() never throws, whatever the caller or the audit log does", async () => {
  const sent = []; const t = mkb({ fetchImpl: fakeFetch(() => { sent.push(1); return { body: "ok" }; }) });
  try {
    t.addGrant();
    const hostile = [null, undefined, 5, "str", [], () => {}, { agentId: { toString() { throw new Error("x"); } } }, { agentId: Object.create(null) }, { agentId: "S-01", grantId: "g1", method: { toString() { throw new Error("m"); } }, url: "https://api.example-data.com/v1/a" },
      { agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/a", headers: new Proxy({}, { ownKeys() { throw new Error("p"); } }) }, { agentId: "S-01", grantId: ["g1"], url: "https://api.example-data.com/v1/a" },
      new Proxy({}, { get() { throw new Error("g"); } })];
    for (const h of hostile) { const r = await t.br.request(h); assert.equal(r.ok, false); assert.equal(typeof r.reason, "string"); assert.equal(JSON.stringify(r).includes(SECRET), false); }
    assert.equal(sent.length, 0);
    fs.appendFileSync(path.join(t.d, "broker", "broker-audit.jsonl"), '{"seq":99,"junk":true}\n');      // audit log tampered: a request must not go out unaudited
    const r = await t.br.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/a" });
    assert.equal(r.ok, false); assert.match(r.reason, /AUDIT_UNAVAILABLE|BROKER_ERROR/); assert.equal(sent.length, 0, "no unaudited request left the building");
  } finally { rm(t.d); }
});

test("broker: denied requests are audited at a bounded rate and counted beyond it", async () => {
  let t0 = Date.now(); const t = mkb({ now: () => t0 });
  try {
    t.addGrant();
    for (let i = 0; i < 100; i++) await t.br.request({ agentId: "bad agent " + i, grantId: "g1", url: "x" });
    const denied = () => t.br.auditEntries().filter(e => e.event === "BROKER_DENIED").length;
    assert.equal(denied(), 30); assert.equal(t.br.summary().deniedNotAudited, 70); assert.equal(t.br.summary().denied, 100);
    t0 += 61000; await t.br.request({ agentId: "bad", grantId: "g1", url: "x" });
    assert.equal(t.br.auditEntries().find(e => e.event === "BROKER_DENIED_SUPPRESSED").data.count, 70);
    assert.ok(t.br.auditEntries().length < 40);
  } finally { rm(t.d); }
});

test("broker: encoded slashes/dots in the path are refused (the server could decode them out of the grant)", async () => {
  const t = mkb();
  try {
    t.addGrant();
    for (const u of ["https://api.example-data.com/v1/..%2fadmin", "https://api.example-data.com/v1/%2E%2E%2Fadmin", "https://api.example-data.com/v1/a%2Fb", "https://api.example-data.com/v1/a%5Cb", "https://api.example-data.com/v1/a%00b", "https://api.example-data.com/v1/a%2eb"])
      assert.equal((await t.br.request({ agentId: "S-01", grantId: "g1", url: u })).reason, "PATH_NOT_ALLOWED", u);
    assert.equal((await t.br.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/a%20b" })).ok, true, "ordinary encoding is fine");
  } finally { rm(t.d); }
});

test("broker: a secret straddling the response cap is redacted before truncating", async () => {
  const t = mkb({ maxResponseBytes: 15, fetchImpl: fakeFetch(() => ({ body: "XXXXXXXXXX" + SECRET + "tail" })) });
  try {
    t.addGrant();
    const r = await t.br.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/a" });
    assert.equal(r.body.length <= 15, true); assert.equal(r.truncated, true);
    for (let i = 4; i <= SECRET.length; i += 4) assert.equal(r.body.includes(SECRET.slice(0, i)), false, "no secret prefix of length " + i);
  } finally { rm(t.d); }
});

test("broker: a fetch that ignores the abort signal cannot wedge the broker", async () => {
  const t = mkb({ timeoutMs: 40, maxInflight: 2, fetchImpl: () => new Promise(() => {}) });
  try {
    t.addGrant({ ...GRANT, maxPerMinute: 60 });
    for (let i = 0; i < 4; i++) { const r = await t.br.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/a" }); assert.equal(r.reason, "UPSTREAM_ERROR"); assert.equal(r.error, "TIMEOUT"); }
    assert.equal(t.br.summary().inflight, 0);
  } finally { rm(t.d); }
});

test("broker: revocation holds even if the grants file cannot be written; re-granting a revoked id survives restart; old broader grants cannot be restored", async () => {
  const t = mkb();
  try {
    t.addGrant({ ...GRANT, allowWrite: true, methods: ["GET", "DELETE"], pathPrefixes: ["/"] });
    const f = path.join(t.d, "broker", "broker-grants.json"), broad = fs.readFileSync(f, "utf8");
    const reload = () => createCredentialBroker({ ...t.opts });
    const rq = (b, m = "GET") => b.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/a", method: m });
    // narrow the same id, then try to restore the broad file
    t.addGrant(); assert.equal((await rq(t.br, "DELETE")).reason, "METHOD_NOT_ALLOWED");
    fs.writeFileSync(f, broad); const r1 = reload(); assert.equal(r1.listGrants().length, 0); assert.match(r1.summary().integrity, /ENTRIES_REJECTED:1/); assert.equal((await rq(r1, "DELETE")).reason, "NO_SUCH_GRANT");
    // save failure during revoke: still revoked now and after restart
    const t2 = mkb(); try {
      t2.addGrant(); const f2 = path.join(t2.d, "broker", "broker-grants.json");
      fs.rmSync(f2); fs.mkdirSync(f2 + ".tmp");      // save() will fail
      assert.equal(t2.br.revokeGrant("g1", { ownerApproval: t2.ap("BROKER_REVOKE", "g1") }), true);
      assert.equal((await rq(t2.br)).reason, "NO_SUCH_GRANT"); assert.match(t2.br.summary().integrity, /NOT_UPDATED/);
      fs.rmdirSync(f2 + ".tmp");
    } finally { rm(t2.d); }
    // revoke then re-grant the same id: works now and after a restart
    const t3 = mkb(); try {
      t3.addGrant(); t3.br.revokeGrant("g1", { ownerApproval: t3.ap("BROKER_REVOKE", "g1") }); t3.addGrant();
      assert.equal((await rq(t3.br)).ok, true);
      const r3 = createCredentialBroker({ ...t3.opts }); assert.equal(r3.summary().integrity, "OK"); assert.equal((await rq(r3)).ok, true);
    } finally { rm(t3.d); }
  } finally { rm(t.d); }
});

test("broker: non-string agent ids are invalid; audit failures at grant/revoke time are handled safely", async () => {
  const sent = []; const t = mkb({ fetchImpl: fakeFetch(() => { sent.push(1); return { body: "ok" }; }) });
  try {
    t.addGrant();
    for (const agentId of [["S-01"], { toString: () => "S-01" }, 5]) assert.equal((await t.br.request({ agentId, grantId: "g1", url: "https://api.example-data.com/v1/a" })).reason, "AGENT_INVALID");
    assert.equal(sent.length, 0);
    const audit = path.join(t.d, "broker", "broker-audit.jsonl");
    // a revoke whose audit write fails is still effective right now and is flagged
    fs.appendFileSync(audit, '{"seq":99,"junk":true}\n');
    assert.equal(t.br.revokeGrant("g1", { ownerApproval: t.ap("BROKER_REVOKE", "g1") }), true);
    assert.equal(t.br.listGrants().length, 0); assert.equal(t.br.summary().integrity, "REVOCATION_NOT_RECORDED");
    // a grant that cannot be recorded does not exist; an existing one is left as it was
    const n2 = normaliseGrant({ ...GRANT, id: "g9" });
    assert.throws(() => t.br.grant({ ...GRANT, id: "g9" }, { ownerApproval: t.ap("BROKER_GRANT", grantSubject(n2.grant)) }), /./);
    assert.equal(t.br.listGrants().length, 0);
  } finally { rm(t.d); }
  const u = mkb();
  try {
    u.addGrant({ ...GRANT, id: "keep" });
    fs.appendFileSync(path.join(u.d, "broker", "broker-audit.jsonl"), '{"seq":99,"junk":true}\n');
    const changed = { ...GRANT, id: "keep", hosts: ["other.example-data.com"] }, n = normaliseGrant(changed);
    assert.throws(() => u.br.grant(changed, { ownerApproval: u.ap("BROKER_GRANT", grantSubject(n.grant)) }), /./);
    assert.deepEqual(u.br.listGrants().map(g => [g.id, g.hosts[0]]), [["keep", "api.example-data.com"]], "the previous grant is untouched");
  } finally { rm(u.d); }
});
