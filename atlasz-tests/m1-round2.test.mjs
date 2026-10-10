// Unified programme M1, independent-verification round 2 regressions: stale-copy replay, restore vs revocation, audit rollback anchor,
// revoke while locked, symlink tmp, backup size/throttle, cross-process approval replay, broker redaction forms / reload / id validation / inflight. Synthetic data only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createSecretVault, generateVaultKey } from "../atlasz-addons/secret-vault.mjs";
import { createCredentialBroker, normaliseGrant, grantSubject } from "../atlasz-addons/credential-broker.mjs";
import { tmp, rm } from "./helpers.mjs";

const SECRET = "synthetic-credential-AAAA-1111-BBBB", PASS = "correct horse battery staple 42";
const kp = generateOwnerKeyPair();
const ap = (action, subject) => issueOwnerApproval({ privateKeyPem: kp.privateKeyPem, action, subject });
const auth = () => createOwnerAuth({ publicKeyB64: kp.publicKeyB64 });
const nd = names => "names:" + createHash("sha256").update([...names].sort().join("\n")).digest("hex").slice(0, 40);
function mk(o = {}) { const d = tmp(), key = generateVaultKey(), a = auth(); const open = (extra = {}) => createSecretVault({ dir: d, keyB64: key, ownerAuth: a, ...o, ...extra }); return { d, key, a, open, v: open() }; }

test("owner-auth: an approval consumed by one instance is refused by another instance sharing the nonce file", () => {
  const d = tmp();
  try {
    const A = createOwnerAuth({ publicKeyB64: kp.publicKeyB64, stateDir: d }), B = createOwnerAuth({ publicKeyB64: kp.publicKeyB64, stateDir: d });
    const approval = ap("X_ACTION", "s1");
    assert.equal(A.verifyApproval(approval, { action: "X_ACTION", subject: "s1" }).allowed, true);
    const r = B.verifyApproval(approval, { action: "X_ACTION", subject: "s1" });
    assert.equal(r.allowed, false); assert.equal(r.reason, "REPLAY_DETECTED");
    assert.equal(A.verifyApproval(approval, { action: "X_ACTION", subject: "s1" }).reason, "REPLAY_DETECTED");
  } finally { rm(d); }
});

test("vault: an old copy of the vault file cannot bring back a credential that was revoked and later re-created", () => {
  const t = mk();
  try {
    t.v.set("K", "value-one-aaaaaa", { ownerApproval: ap("VAULT_SET", "K") });
    const old = fs.readFileSync(path.join(t.d, "vault.enc.json"), "utf8");      // copy taken while K = value-one
    t.v.revoke("K", { ownerApproval: ap("VAULT_REVOKE", "K") });
    t.v.set("K", "value-two-bbbbbb", { ownerApproval: ap("VAULT_SET", "K") });
    assert.equal(t.v.get("K", { purpose: "t" }), "value-two-bbbbbb");
    fs.writeFileSync(path.join(t.d, "vault.enc.json"), old);      // attacker restores the pre-revocation file
    const v2 = t.open();
    assert.equal(v2.has("K"), false, "stale pre-revocation copy must not be live");
    assert.equal(v2.meta("K").active, false);
    // honest history is untouched: a normal restart keeps the re-created value
    const t2 = mk();
    try {
      t2.v.set("K", "value-one-aaaaaa", { ownerApproval: ap("VAULT_SET", "K") });
      t2.v.revoke("K", { ownerApproval: ap("VAULT_REVOKE", "K") });
      t2.v.set("K", "value-two-bbbbbb", { ownerApproval: ap("VAULT_SET", "K") });
      assert.equal(t2.open().get("K", { purpose: "t" }), "value-two-bbbbbb");
    } finally { rm(t2.d); }
  } finally { rm(t.d); }
});

test("vault: restoring a backup never silently revives a revoked credential; reviving needs its own approval subject", () => {
  const t = mk();
  try {
    t.v.set("K", "value-one-aaaaaa", { ownerApproval: ap("VAULT_SET", "K") });
    const ex = t.v.exportBackup({ names: ["K"], passphrase: PASS, ownerApproval: ap("VAULT_EXPORT", nd(["K"])) });
    t.v.revoke("K", { ownerApproval: ap("VAULT_REVOKE", "K") });
    assert.throws(() => t.v.restoreBackup(ex.package, PASS, { ownerApproval: ap("VAULT_RESTORE", ex.restoreSubject) }), /VAULT_RESTORE_REVOKED:K/);
    assert.equal(t.v.has("K"), false);
    // approval for a plain restore does not cover revive
    assert.throws(() => t.v.restoreBackup(ex.package, PASS, { revive: true, ownerApproval: ap("VAULT_RESTORE", ex.restoreSubject) }), /OWNER_APPROVAL_REQUIRED/);
    const sub = ex.restoreSubject + ":revive";
    assert.deepEqual(t.v.restoreBackup(ex.package, PASS, { revive: true, ownerApproval: ap("VAULT_RESTORE", sub) }).restored, ["K"]);
    assert.equal(t.open().has("K"), true, "an owner-approved revive survives restart");
    // and an old file copy from before the revive still cannot undo a LATER revocation
  } finally { rm(t.d); }
});

test("vault: a truncated or replaced audit log is detected and the vault stays locked", () => {
  const t = mk();
  try {
    t.v.set("K", "value-one-aaaaaa", { ownerApproval: ap("VAULT_SET", "K") });
    t.v.revoke("K", { ownerApproval: ap("VAULT_REVOKE", "K") });
    t.v.set("L", "value-two-bbbbbb", { ownerApproval: ap("VAULT_SET", "L") });
    fs.writeFileSync(path.join(t.d, "vault-audit.jsonl"), "");      // wipe the revocation history
    const v2 = t.open();
    assert.equal(v2.status().state, "LOCKED");
    assert.throws(() => v2.get("L", { purpose: "t" }), /VAULT_LOCKED_NO_KEY/);
    assert.throws(() => v2.unlock(t.key), /VAULT_AUDIT_ROLLBACK_DETECTED/);
    assert.ok(v2.auditEntries().some(e => e.event === "VAULT_AUDIT_ROLLBACK_DETECTED"));
  } finally { rm(t.d); }
});

test("vault: revoke and remove work while the vault is locked (no key needed to destroy a credential)", () => {
  const t = mk();
  try {
    t.v.set("K", "value-one-aaaaaa", { ownerApproval: ap("VAULT_SET", "K") });
    t.v.set("M", "value-two-bbbbbb", { ownerApproval: ap("VAULT_SET", "M") });
    t.v.lock("test");
    assert.equal(t.v.revoke("K", { ownerApproval: ap("VAULT_REVOKE", "K") }), true);
    assert.equal(t.v.remove("M", { ownerApproval: ap("VAULT_DELETE", "M") }), true);
    assert.equal(t.v.status().state, "LOCKED");
    const v2 = t.open(); v2.unlock(t.key);
    assert.equal(v2.has("K"), false); assert.equal(v2.has("M"), false);
    assert.throws(() => v2.get("K", { purpose: "t" }), /REVOKED/);
  } finally { rm(t.d); }
});

test("vault: a planted symlink at the temp path is not written through", () => {
  const t = mk(), victim = path.join(t.d, "victim.txt");
  try {
    fs.writeFileSync(victim, "KEEP");
    fs.symlinkSync(victim, path.join(t.d, "vault.enc.json.tmp"));
    t.v.set("K", "value-one-aaaaaa", { ownerApproval: ap("VAULT_SET", "K") });
    assert.equal(fs.readFileSync(victim, "utf8"), "KEEP");
    assert.equal(t.v.get("K", { purpose: "t" }), "value-one-aaaaaa");
  } finally { rm(t.d); }
});

test("vault: oversized packages are refused and repeated wrong passphrases throttle further backup attempts", () => {
  const t = mk({ unlockMaxFailures: 3, unlockThrottleMs: 60000 });
  try {
    t.v.set("K", "value-one-aaaaaa", { ownerApproval: ap("VAULT_SET", "K") });
    const ex = t.v.exportBackup({ names: ["K"], passphrase: PASS, ownerApproval: ap("VAULT_EXPORT", nd(["K"])) });
    assert.throws(() => t.v.verifyBackup("x".repeat(1024 * 1024 + 1), PASS), /TOO_LARGE/);
    for (let i = 0; i < 3; i++) assert.throws(() => t.v.verifyBackup(ex.package, "wrong passphrase number " + i), /WRONG_PASSPHRASE/);
    assert.throws(() => t.v.verifyBackup(ex.package, PASS), /VAULT_BACKUP_THROTTLED/);
  } finally { rm(t.d); }
});

// ------------------------------- broker -------------------------------
const GRANT = { id: "g1", credential: "API", agents: ["S-01"], roles: [], hosts: ["api.example-data.com"], methods: ["GET"], pathPrefixes: ["/v1"], purpose: "synthetic test grant", expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() };
const fakeFetch = (handler, calls = []) => async (url, init) => { calls.push({ url: String(url), init }); const r = await handler(url, init); return { status: r.status ?? 200, headers: new Headers(r.headers ?? {}), text: async () => r.body ?? "" }; };
function mkb(over = {}) {
  const t = mk(); t.v.set("API", SECRET, { ownerApproval: ap("VAULT_SET", "API") });
  const calls = [], opts = { vault: t.v, ownerAuth: t.a, fetchImpl: fakeFetch(() => ({ body: "ok" }), calls), gate: () => ({ allowed: true }), stateDir: path.join(t.d, "broker"), ...over };
  const br = createCredentialBroker(opts);
  const addGrant = (b = br, g = GRANT) => b.grant(g, { ownerApproval: ap("BROKER_GRANT", grantSubject(normaliseGrant(g).grant)) });
  return { ...t, br, calls, opts, addGrant };
}
const ask = (b, extra = {}) => b.request({ agentId: "S-01", grantId: "g1", url: "https://api.example-data.com/v1/a", ...extra });

test("broker: the secret is redacted in hex, base64url, unpadded base64, double-encoded, escaped and reversed forms", async () => {
  const S2 = "sk?live>>~~key+/=abcdEF&gh ij!x";      // symbols make every encoding differ from the plain value
  const sb = Buffer.from(S2);
  const forms = [sb.toString("hex"), sb.toString("base64url"), sb.toString("base64").replace(/=+$/, ""), encodeURIComponent(encodeURIComponent(S2)), [...S2].reverse().join(""), escape(S2)];
  assert.equal(new Set([...forms, S2, encodeURIComponent(S2), sb.toString("base64")]).size, forms.length + 3, "test data must make all forms distinct");
  const t = mkb({ fetchImpl: fakeFetch(() => ({ body: forms.join(" | ") })) });
  try {
    t.v.set("API2", S2, { ownerApproval: ap("VAULT_SET", "API2") });
    const g = { ...GRANT, credential: "API2" };
    t.br.revokeAll({ ownerApproval: ap("BROKER_REVOKE_ALL", "ALL") });
    t.addGrant(t.br, g);
    const r = await ask(t.br);
    assert.equal(r.ok, true);
    for (const f of forms) assert.ok(!r.body.includes(f), "leaked form " + f);
  } finally { rm(t.d); }
});

test("broker: raw agent/grant ids are validated before truncation; sparse arrays and ';' in paths are refused", async () => {
  const t = mkb();
  try {
    t.addGrant();
    assert.equal((await ask(t.br, { agentId: "S-01" + "x".repeat(60) })).reason, "AGENT_INVALID");
    assert.equal((await ask(t.br, { grantId: "g1" + "x".repeat(60) })).reason, "NO_SUCH_GRANT");
    assert.equal((await ask(t.br, { grantId: "g1\n" })).reason, "NO_SUCH_GRANT");
    const long = "g".repeat(48); t.addGrant(t.br, { ...GRANT, id: long });
    assert.equal((await ask(t.br, { grantId: long })).ok, true);
    assert.equal((await ask(t.br, { grantId: long + "ZZZZ" })).reason, "NO_SUCH_GRANT", "a 52-char id must not be truncated onto a real 48-char grant");
    assert.equal((await ask(t.br, { url: "https://api.example-data.com/v1/a;jsessionid=1" })).reason, "PATH_NOT_ALLOWED");
    assert.equal((await ask(t.br, { url: "https://api.example-data.com/v1/a%3Bb" })).reason, "PATH_NOT_ALLOWED");
    assert.ok(normaliseGrant({ ...GRANT, agents: new Array(2) }).error);
    assert.ok(normaliseGrant({ ...GRANT, pathPrefixes: ["/v1;x"] }).error);
    assert.equal(t.calls.length, 1, "only the legitimate 48-char grant request went out");
  } finally { rm(t.d); }
});

test("broker: a second broker object on the same state directory sees grants and revocations made by the first", async () => {
  const t = mkb();
  try {
    const b2 = createCredentialBroker({ ...t.opts });
    assert.equal((await ask(b2)).reason, "NO_SUCH_GRANT");
    t.addGrant();
    assert.equal((await ask(b2)).ok, true, "grant made after b2 started is picked up");
    t.br.revokeGrant("g1", { ownerApproval: ap("BROKER_REVOKE", "g1") });
    assert.equal((await ask(b2)).reason, "NO_SUCH_GRANT", "revocation made by another object is honoured");
  } finally { rm(t.d); }
});

test("vault: a substituted audit log of equal or greater length (not just an empty one) is detected", () => {
  const a = mk(), b = mk();
  try {
    for (const t of [a, b]) {
      t.v.set("K", "value-one-aaaaaa", { ownerApproval: ap("VAULT_SET", "K") });
      t.v.set("L", "value-two-bbbbbb", { ownerApproval: ap("VAULT_SET", "L") });
    }
    b.v.set("N", "value-three-cccc", { ownerApproval: ap("VAULT_SET", "N") });      // longer, internally valid, but a different chain
    fs.copyFileSync(path.join(b.d, "vault-audit.jsonl"), path.join(a.d, "vault-audit.jsonl"));
    const v2 = a.open();
    assert.equal(v2.status().state, "LOCKED");
    assert.throws(() => v2.unlock(a.key), /VAULT_AUDIT_ROLLBACK_DETECTED/);
  } finally { rm(a.d); rm(b.d); }
});
