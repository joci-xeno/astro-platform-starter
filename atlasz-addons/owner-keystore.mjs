// ATLASZ owner key store for JOCI's own device (used by the Windows Control Center; the CLI may use it too).
// The Ed25519 PRIVATE key is stored passphrase-encrypted (PKCS#8, aes-256-cbc, scrypt-free OpenSSL PBKDF2 inside Node).
// It never leaves the device, is never sent to the runtime and is never written unencrypted.
// Honest limit: this protects the key at rest (stolen file / backup). Malware running as Joci with a keylogger is out of scope.
import fs from "node:fs";
import path from "node:path";
import { generateKeyPairSync, createPrivateKey, createPublicKey } from "node:crypto";
import { issueOwnerApproval } from "./owner-auth.mjs";

export const MIN_PASSPHRASE = 10;
const keyFile = dir => path.join(dir, "owner-private-key.enc.pem");
const pubFile = dir => path.join(dir, "owner-public-key.b64");

export function keystoreStatus(dir) {
  return { provisioned: fs.existsSync(keyFile(dir)) && fs.existsSync(pubFile(dir)), publicKeyB64: fs.existsSync(pubFile(dir)) ? fs.readFileSync(pubFile(dir), "utf8").trim() : null };
}
export function createOwnerKeystore(dir, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE) throw new Error("PASSPHRASE_TOO_SHORT:min" + MIN_PASSPHRASE);
  if (fs.existsSync(keyFile(dir))) throw new Error("REFUSING_TO_OVERWRITE_EXISTING_KEY");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ format: "pem", type: "pkcs8", cipher: "aes-256-cbc", passphrase });
  const pub = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyFile(dir), pem, { mode: 0o600, flag: "wx" });
  fs.writeFileSync(pubFile(dir), pub, { mode: 0o644 });
  return { publicKeyB64: pub };
}
export function signWithKeystore(dir, passphrase, { action, subject = null, ttlMs = 60000, ownerId = "JOCI", now = Date.now() } = {}) {
  if (!fs.existsSync(keyFile(dir))) throw new Error("OWNER_KEY_NOT_PROVISIONED");
  let key;
  try { key = createPrivateKey({ key: fs.readFileSync(keyFile(dir), "utf8"), format: "pem", passphrase }); }
  catch { throw new Error("WRONG_PASSPHRASE"); }
  const privateKeyPem = key.export({ format: "pem", type: "pkcs8" });
  const approval = issueOwnerApproval({ privateKeyPem, ownerId, action, subject, ttlMs, now });
  // Sanity: the stored public key must match, otherwise the runtime would reject the signature anyway.
  const pub = createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64");
  if (pub !== keystoreStatus(dir).publicKeyB64) throw new Error("KEYSTORE_PUBLIC_KEY_MISMATCH");
  return approval;
}
