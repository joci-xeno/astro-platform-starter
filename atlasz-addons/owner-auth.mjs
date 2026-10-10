// ATLASZ Strong Owner Authentication (V7.3 §2, §14, §36).
//
// Model: Joci holds an Ed25519 PRIVATE key on his own device. The server only ever holds the PUBLIC key
// (env ATLASZ_OWNER_PUBLIC_KEY, base64 SPKI-DER; a public key is not a secret). A critical action is approved
// by a signed object bound to {ownerId, action, subject, nonce, issuedAt, expiresAt}. Because the server cannot
// sign, a compromised agent/plugin/server cannot forge an approval. Bare booleans are NEVER accepted.
//
// Status honesty (V7.3 §12):
//   PLACEHOLDER_UNCONNECTED  no owner public key configured          -> every critical action is denied
//   CONNECTED_UNTESTED       key configured, no real challenge proven
//   LIVE                     a real owner-signed challenge was verified in this process (proveChannel)
// Unit tests prove the MECHANISM only. LIVE for Joci requires Joci to provision his real public key (BLOCKED).
import fs from "node:fs";
import path from "node:path";
import { createPublicKey, createPrivateKey, generateKeyPairSync, sign, verify, randomBytes } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { withFileLock } from "./file-lock.mjs";

export const APPROVAL_VERSION = "v1";
export const MAX_TTL_MS = 5 * 60 * 1000;
export const CLOCK_SKEW_MS = 30 * 1000;
const canon = v => String(v ?? "").trim().toUpperCase().replace(/-/g, "_");
const messageOf = a => ["ATLASZ-OWNER-APPROVAL/" + APPROVAL_VERSION, a.ownerId, a.action, a.subject ?? "", a.nonce, a.issuedAt, a.expiresAt].join("\n");

// ---- owner-side (runs on Joci's device, never on the server) ----
export function generateOwnerKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyB64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" })
  };
}
export function issueOwnerApproval({ privateKeyPem, ownerId = "JOCI", action, subject = null, ttlMs = 60000, now = Date.now() } = {}) {
  if (!privateKeyPem || !action) throw new Error("PRIVATE_KEY_AND_ACTION_REQUIRED");
  if (!(ttlMs > 0 && ttlMs <= MAX_TTL_MS)) throw new Error("TTL_OUT_OF_RANGE");
  const a = { version: APPROVAL_VERSION, ownerId, action: canon(action), subject, nonce: randomBytes(16).toString("hex"),
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString() };
  a.signature = sign(null, Buffer.from(messageOf(a)), createPrivateKey(privateKeyPem)).toString("base64");
  return a;
}

// ---- server-side verifier ----
export function createOwnerAuth({ ownerId = "JOCI", publicKeyB64 = null, stateDir = null, nowFn = () => Date.now() } = {}) {
  let pub = null, configured = false, channelProven = false, pendingChallenge = null;
  const nonceFile = stateDir ? path.join(stateDir, "owner-auth-nonces.log") : null;
  const used = new Set();
  const audit = createAuditChain({ filePath: stateDir ? path.join(stateDir, "owner-auth-audit.jsonl") : null });
  if (nonceFile && fs.existsSync(nonceFile)) for (const l of fs.readFileSync(nonceFile, "utf8").split("\n")) if (l) used.add(l);

  const nonceSeenOnDisk = n => { try { return fs.existsSync(nonceFile) && fs.readFileSync(nonceFile, "utf8").split("\n").includes(n); } catch { return false; } };

  function configure({ publicKeyB64: k }) {
    try { pub = createPublicKey({ key: Buffer.from(k, "base64"), format: "der", type: "spki" }); configured = true; }
    catch { pub = null; configured = false; audit.append("OWNER_KEY_CONFIG_REJECTED", {}); throw new Error("INVALID_OWNER_PUBLIC_KEY"); }
    if (pub.asymmetricKeyType !== "ed25519") { pub = null; configured = false; throw new Error("OWNER_KEY_MUST_BE_ED25519"); }
    channelProven = false;
    audit.append("OWNER_KEY_CONFIGURED", { ownerId });
  }
  if (publicKeyB64) configure({ publicKeyB64 });

  const status = () => ({
    state: !configured ? "PLACEHOLDER_UNCONNECTED" : channelProven ? "LIVE" : "CONNECTED_UNTESTED",
    ownerId, configured, channelProven, noncesRemembered: used.size, auditHead: audit.head()
  });

  function verifyApproval(approval, { action, subject, consume = true } = {}) {
    const deny = reason => { audit.append("APPROVAL_DENIED", { action: canon(action), subject: subject ?? null, reason }); return { allowed: false, reason }; };
    if (!configured) return deny("OWNER_AUTH_NOT_CONFIGURED");
    if (!approval || typeof approval !== "object") return deny(typeof approval === "boolean" ? "BARE_BOOLEAN_REJECTED" : "APPROVAL_OBJECT_REQUIRED");
    for (const f of ["version", "ownerId", "action", "nonce", "issuedAt", "expiresAt", "signature"])
      if (typeof approval[f] !== "string" || !approval[f]) return deny("APPROVAL_FIELD_MISSING:" + f);
    if (approval.version !== APPROVAL_VERSION) return deny("UNSUPPORTED_VERSION");
    if (approval.ownerId !== ownerId) return deny("NOT_OWNER");
    if (canon(approval.action) !== canon(action)) return deny("ACTION_MISMATCH");
    if (subject !== undefined && (approval.subject ?? null) !== subject) return deny("SUBJECT_MISMATCH");
    const iss = Date.parse(approval.issuedAt), exp = Date.parse(approval.expiresAt), t = nowFn();
    if (!Number.isFinite(iss) || !Number.isFinite(exp)) return deny("INVALID_TIMESTAMP");
    if (exp <= iss || exp - iss > MAX_TTL_MS) return deny("TTL_INVALID");
    if (t > exp) return deny("EXPIRED");
    if (t < iss - CLOCK_SKEW_MS) return deny("ISSUED_IN_FUTURE");
    if (!/^[0-9a-f]{32}$/.test(approval.nonce)) return deny("NONCE_INVALID");
    if (used.has(approval.nonce)) return deny("REPLAY_DETECTED");
    if (consume && nonceFile && nonceSeenOnDisk(approval.nonce)) { used.add(approval.nonce); return deny("REPLAY_DETECTED"); }      // another process/instance already consumed it
    let ok = false;
    try { ok = verify(null, Buffer.from(messageOf(approval)), pub, Buffer.from(approval.signature, "base64")); } catch { ok = false; }
    if (!ok) return deny("SIGNATURE_INVALID");
    if (consume) {
      if (nonceFile) {
        // check-and-append atomically across processes: re-read the file under a lock so two instances cannot both accept one approval
        let dup = false;
        try { fs.mkdirSync(stateDir, { recursive: true }); withFileLock(nonceFile, () => { if (nonceSeenOnDisk(approval.nonce)) dup = true; else fs.appendFileSync(nonceFile, approval.nonce + "\n", { mode: 0o600 }); }); }
        catch { return deny("NONCE_STORE_UNAVAILABLE"); }
        if (dup) { used.add(approval.nonce); return deny("REPLAY_DETECTED"); }
      }
      used.add(approval.nonce);
    }
    audit.append("APPROVAL_VERIFIED", { action: canon(action), subject: subject ?? null, nonce: approval.nonce });
    return { allowed: true, reason: null, nonce: approval.nonce, ownerId };
  }

  function issueChallenge() {
    pendingChallenge = randomBytes(8).toString("hex");
    return { action: "OWNER_CHANNEL_PROOF", subject: pendingChallenge };
  }
  function proveChannel(approval) {
    if (!pendingChallenge) return { proven: false, reason: "NO_PENDING_CHALLENGE" };
    const r = verifyApproval(approval, { action: "OWNER_CHANNEL_PROOF", subject: pendingChallenge });
    if (r.allowed) { channelProven = true; pendingChallenge = null; audit.append("OWNER_CHANNEL_PROVEN", {}); }
    return { proven: r.allowed, reason: r.reason };
  }
  // Signature-only check of an ALREADY-USED approval (no expiry, no nonce consumption, no audit noise).
  // Used to prove that persisted state (e.g. emergency-stop file) was really produced by the owner.
  function verifyRecorded(approval, { action, subject } = {}) {
    if (!configured || !approval || typeof approval !== "object") return false;
    if (approval.ownerId !== ownerId || canon(approval.action) !== canon(action)) return false;
    if (subject !== undefined && (approval.subject ?? null) !== subject) return false;
    try { return verify(null, Buffer.from(messageOf(approval)), pub, Buffer.from(String(approval.signature), "base64")); } catch { return false; }
  }
  // Fail-closed convenience used by gated modules. Never throws; booleans are always rejected.
  const granted = (approval, action, subject) => verifyApproval(approval, { action, subject }).allowed;
  return { configure, status, verifyApproval, verifyRecorded, issueChallenge, proveChannel, granted, audit: () => audit.entries(), auditVerify: () => audit.verify() };
}

// Process-wide default instance, configured from the environment (public key only).
const defaultAuth = createOwnerAuth({
  ownerId: process.env.ATLASZ_OWNER_ID || "JOCI",
  publicKeyB64: process.env.ATLASZ_OWNER_PUBLIC_KEY || null,
  stateDir: process.env.ATLASZ_STATE_DIR || null
});
export const getDefaultOwnerAuth = () => defaultAuth;
export const configureOwnerAuth = opts => defaultAuth.configure(opts);
export const ownerAuthStatus = () => defaultAuth.status();
export const verifyOwnerApproval = (a, o) => defaultAuth.verifyApproval(a, o);
export const ownerGranted = (approval, action, subject) => defaultAuth.granted(approval, action, subject);
