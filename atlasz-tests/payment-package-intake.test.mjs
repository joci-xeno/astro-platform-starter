// Stripe/KOHO handoff gate: a package with embedded credentials, bank data or ungated money movement is never acceptable for review.
import { execSync as _x } from "node:child_process"; const require_ = () => ({ execSync: _x });
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { reviewPackage } from "../atlasz-addons/payment-package-intake.mjs";
import { tmp, rm } from "./helpers.mjs";

const put = (d, rel, text) => { const f = path.join(d, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const GOOD = 'import { verifyApproval } from "./approval.mjs";\nexport async function charge(stripe, approval, amount) { if (!verifyApproval(approval, "STRIPE_CHARGE")) throw new Error("OWNER_APPROVAL_REQUIRED"); return stripe.paymentIntents.create({ amount, currency: "cad" }); }\n// https://api.stripe.com/v1\n';

test("a gated, tested, credential-free package is acceptable for review (still not merged)", () => {
  const d = tmp("pay-"); try { put(d, "src/pay.mjs", GOOD); put(d, "tests/pay.test.mjs", "// synthetic\n"); const r = reviewPackage(d); assert.equal(r.acceptableForReview, true, JSON.stringify(r.findings)); assert.match(r.note, /owner still approves/); } finally { rm(d); }
});
test("credentials, bank data, card numbers, env files and ungated money movement are BLOCKERS", () => {
  const d = tmp("pay-"); try {
    const fake = "sk_" + "live_" + "A".repeat(24);
    put(d, "src/pay.mjs", 'export const k = "' + fake + '";\nstripe.refunds.create({});\n'); put(d, "src/bank.txt", "IBAN GB82WEST12345698765432\n"); put(d, "src/card.txt", "card 4242 4242 4242 4242\n"); put(d, ".env", "X=1\n"); put(d, "src/transit.txt", "transit 12345-001-1234567\n");
    const r = reviewPackage(d), codes = r.findings.map(f => f.code); assert.equal(r.acceptableForReview, false);
    for (const c of ["EMBEDDED_CREDENTIAL:STRIPE_LIVE_SECRET", "BANK_DATA:IBAN", "BANK_DATA:CARD_NUMBER_LUHN", "CREDENTIAL_FILE_PRESENT", "MONEY_MOVING_CALL_WITHOUT_OWNER_APPROVAL_GATE", "NO_TESTS_IN_PACKAGE", "BANK_DATA:CA_TRANSIT_ACCOUNT"]) assert.ok(codes.includes(c), c + " in " + codes.join());
    assert.equal(JSON.stringify(r).includes(fake), false, "the report never echoes the secret");
  } finally { rm(d); }
});
test("symlinks, missing packages and foreign hosts are handled; the reviewer never runs package code", () => {
  const d = tmp("pay-"); try {
    put(d, "src/a.mjs", GOOD + 'fetch("https://evil.example.net/x");\nthrow new Error("must not run");\n'); put(d, "t.test.mjs", ""); fs.symlinkSync("/etc/passwd", path.join(d, "link"));
    const r = reviewPackage(d); assert.ok(r.findings.some(f => f.code === "SYMLINK_NOT_ALLOWED")); assert.ok(r.findings.some(f => f.code === "OTHER_HOSTS_REFERENCED_NEED_EGRESS_REVIEW" && f.detail.includes("evil.example.net")));
    assert.equal(reviewPackage(path.join(d, "nope")).acceptableForReview, false);
  } finally { rm(d); }
});

test("evasions are blocked: split / escaped / base64 keys, NUL-prefixed files, comment-only approval gates, bracket access, FIFOs, .git", () => {
  const d = tmp("pay-"); try {
    const k = "sk_" + "live_" + "B".repeat(24);
    put(d, "src/split.mjs", 'export const a = "sk_live_" + "' + "B".repeat(24) + '";\n'); put(d, "src/b64.mjs", 'export const b = "' + Buffer.from(k).toString("base64") + '";\n'); put(d, "src/esc.mjs", 'export const c = "\\x73k_live_' + "B".repeat(24) + '";\n');
    fs.writeFileSync(path.join(d, "src", "nul.mjs"), Buffer.concat([Buffer.from([0]), Buffer.from(k)])); put(d, "src/cm.mjs", '// ownerApproval verifyApproval\nstripe["refunds"]["create"]({});\n'); put(d, "tests/x.test.mjs", ""); put(d, ".git/config", "x");
    let fifo = false; try { require_("child_process").execSync("mkfifo " + JSON.stringify(path.join(d, "src", "ff"))); fifo = true; } catch { /* no mkfifo */ }
    const r = reviewPackage(d), by = f => r.findings.filter(x => x.file && x.file.endsWith(f)).map(x => x.code).join();
    assert.match(by("split.mjs"), /EMBEDDED_CREDENTIAL|STRIPE_KEY_PREFIX/); assert.match(by("b64.mjs"), /EMBEDDED_CREDENTIAL/); assert.match(by("esc.mjs"), /EMBEDDED_CREDENTIAL/); assert.match(by("nul.mjs"), /BINARY_OR_UTF16/);
    assert.match(by("cm.mjs"), /MONEY_MOVING_CALL_WITHOUT_OWNER_APPROVAL_GATE/); assert.ok(r.findings.some(f => /GIT_DIRECTORY/.test(f.code))); if (fifo) assert.match(by("ff"), /NOT_A_REGULAR_FILE/); assert.equal(r.acceptableForReview, false);
  } finally { rm(d); }
});
