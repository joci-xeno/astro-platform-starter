// Regression tests for M3 round 9: credential phrasings found by the verifier (proximity net, extended tokens, idempotent redaction).
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import { assignsSecret, redactAssignments } from "../atlasz-addons/memory-store.mjs";
import { scrub } from "../atlasz-addons/secret-patterns.mjs";

test("M3 round 9: natural phrasings with a credential-looking token near a password name are refused", () => {
  for (const t of ["The password has been changed to Xk9mQ2v8Zp", "password had been Xk9mQ2v8Zp", "the password must be Xk9mQ2v8Zp", "password: now Xk9mQ2v8Zp", "password: is Xk9mQ2v8Zp", "password, now Xk9mQ2v8Zp", "password=ab'cd1234Zq", "The password has been changed to Welcome2024", "password must be Summer2024!", "pw Password123", "password must be letmein2024", "password must be Liverpool1"])
    assert.equal(assignsSecret(t), true, t);
});
test("M3 round 9: ordinary prose with the same words is not flagged", () => {
  for (const t of ["Secret: Project-X7 launch plan", "Password manager: 1Password vs Bitwarden", "A secret agent007x joined the team", "pwd: C:\\Users\\bob", "The password policy requires rotation every quarter"])
    assert.equal(assignsSecret(t), false, t);
});
test("M3 round 9: redaction removes the token and is idempotent", () => {
  const r = redactAssignments("The password has been changed to Xk9mQ2v8Zp today");
  assert.ok(!r.includes("Xk9mQ2v8Zp"), r); assert.equal(redactAssignments(r), r); assert.equal(scrub(r), r);
});

test("M3 round 9: a quote inside the value does not end the credential (extended token), and short / word-like tokens near the name are not flagged by proximity", () => {
  assert.equal(assignsSecret("password=abcdefgh'1234Zq"), true);
  for (const t of ["the password reset link", "the password policy covers Ab1Cd2 only", "password policy for Passw0rdManager9 users", "Password policy review April2024 done", "password for Windows11 laptop reset", "Password reset ticket INC0012345 was closed", "the password to Q3Report2024.xlsx", "the password is documented in NIST800-63B", "Password rotation per NIST800-63B is not required", "password for Q3Report2024.xlsx is in the vault"]) assert.equal(assignsSecret(t), false, t);
});

test("M3 round 10: redaction removes the value behind a filler word and stays idempotent; capitalised-word passwords are refused", () => {
  for (const t of ["password: currently Xk9mQ2v8", "password= still Xk9mQ2v8", "password: temporary Xk9mQ2v8Zp"]) { const r = redactAssignments(t); assert.ok(!/Xk9mQ2v8|Welcome2024/.test(r), t + " -> " + r); assert.equal(redactAssignments(r), r); }
});
