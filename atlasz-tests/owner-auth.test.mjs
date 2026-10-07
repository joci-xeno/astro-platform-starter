import test from "node:test";
import assert from "node:assert/strict";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth, MAX_TTL_MS } from "../atlasz-addons/owner-auth.mjs";
import { tmp, rm } from "./helpers.mjs";

const mk = () => { const k = generateOwnerKeyPair(); return { k, auth: createOwnerAuth({ publicKeyB64: k.publicKeyB64 }) }; };
const sign = (k, o = {}) => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action: "SPEND_MONEY", ...o });

test("unconfigured owner auth denies everything (fail closed)", () => {
  const a = createOwnerAuth({});
  assert.equal(a.status().state, "PLACEHOLDER_UNCONNECTED");
  assert.equal(a.verifyApproval({}, { action: "X" }).reason, "OWNER_AUTH_NOT_CONFIGURED");
});
test("valid signed approval is accepted once", () => {
  const { k, auth } = mk(); const ap = sign(k);
  assert.equal(auth.verifyApproval(ap, { action: "SPEND_MONEY" }).allowed, true);
});
test("bare booleans and non-objects are rejected", () => {
  const { auth } = mk();
  assert.equal(auth.verifyApproval(true, { action: "SPEND_MONEY" }).reason, "BARE_BOOLEAN_REJECTED");
  assert.equal(auth.granted(true, "SPEND_MONEY"), false);
  assert.equal(auth.granted("yes", "SPEND_MONEY"), false);
  assert.equal(auth.granted(null, "SPEND_MONEY"), false);
});
test("replay of the same approval is rejected", () => {
  const { k, auth } = mk(); const ap = sign(k);
  assert.equal(auth.granted(ap, "SPEND_MONEY"), true);
  assert.equal(auth.verifyApproval(ap, { action: "SPEND_MONEY" }).reason, "REPLAY_DETECTED");
});
test("approval is bound to action and subject", () => {
  const { k, auth } = mk();
  assert.equal(auth.verifyApproval(sign(k, { subject: "INV-1" }), { action: "SEND_PAYMENT", subject: "INV-1" }).reason, "ACTION_MISMATCH");
  assert.equal(auth.verifyApproval(sign(k, { subject: "INV-1" }), { action: "SPEND_MONEY", subject: "INV-2" }).reason, "SUBJECT_MISMATCH");
});
test("expired, future-dated and over-long approvals are rejected", () => {
  const { k, auth } = mk();
  assert.equal(auth.verifyApproval(sign(k, { now: Date.now() - 120000, ttlMs: 60000 }), { action: "SPEND_MONEY" }).reason, "EXPIRED");
  assert.equal(auth.verifyApproval(sign(k, { now: Date.now() + 3600000 }), { action: "SPEND_MONEY" }).reason, "ISSUED_IN_FUTURE");
  assert.throws(() => sign(k, { ttlMs: MAX_TTL_MS + 1 }), /TTL_OUT_OF_RANGE/);
  const forged = sign(k); forged.expiresAt = new Date(Date.now() + 99 * 3600000).toISOString();
  assert.equal(auth.verifyApproval(forged, { action: "SPEND_MONEY" }).reason, "TTL_INVALID");
});
test("tampered fields or a different key's signature are rejected", () => {
  const { k, auth } = mk(); const other = generateOwnerKeyPair();
  const t = sign(k); t.subject = "EVIL";
  assert.equal(auth.verifyApproval(t, { action: "SPEND_MONEY" }).reason, "SIGNATURE_INVALID");
  assert.equal(auth.verifyApproval(sign(other), { action: "SPEND_MONEY" }).reason, "SIGNATURE_INVALID");
  assert.equal(auth.verifyApproval(sign(k, { ownerId: "AGENT-7" }), { action: "SPEND_MONEY" }).reason, "NOT_OWNER");
});
test("server holds no private key: auth object cannot mint approvals", () => {
  const { auth } = mk();
  assert.equal(typeof auth.issueApproval, "undefined");
  assert.equal(JSON.stringify(auth.status()).includes("PRIVATE"), false);
});
test("status is LIVE only after a real owner-signed challenge is proven", () => {
  const { k, auth } = mk();
  assert.equal(auth.status().state, "CONNECTED_UNTESTED");
  auth.issueChallenge();
  assert.equal(auth.proveChannel(sign(k, { action: "OWNER_CHANNEL_PROOF", subject: "wrong" })).proven, false);
  assert.equal(auth.status().state, "CONNECTED_UNTESTED");
  const ch2 = auth.issueChallenge();
  assert.equal(auth.proveChannel(sign(k, { action: ch2.action, subject: ch2.subject })).proven, true);
  assert.equal(auth.status().state, "LIVE");
});
test("nonce replay protection survives a restart (durable)", () => {
  const dir = tmp(); const k = generateOwnerKeyPair();
  try {
    const a1 = createOwnerAuth({ publicKeyB64: k.publicKeyB64, stateDir: dir }); const ap = sign(k);
    assert.equal(a1.granted(ap, "SPEND_MONEY"), true);
    const a2 = createOwnerAuth({ publicKeyB64: k.publicKeyB64, stateDir: dir });
    assert.equal(a2.verifyApproval(ap, { action: "SPEND_MONEY" }).reason, "REPLAY_DETECTED");
  } finally { rm(dir); }
});
test("audit chain records decisions and verifies; invalid key config rejected", () => {
  const { k, auth } = mk(); auth.granted(sign(k), "SPEND_MONEY"); auth.granted(true, "SPEND_MONEY");
  assert.equal(auth.auditVerify().ok, true);
  assert.ok(auth.audit().some(e => e.event === "APPROVAL_DENIED"));
  assert.throws(() => createOwnerAuth({ publicKeyB64: "not-a-key" }), /INVALID_OWNER_PUBLIC_KEY/);
});
