// Batch 6: no private key, token or credential material may be tracked by Git; the owner key can only be provisioned outside the repository.
import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { execFileSync } from "node:child_process";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
let files = null; try { files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean); } catch { /* not a checkout */ }
const BIN = /\.(png|ico|jpg|jpeg|gif|woff2?|zip|bundle|sqlite|pdf|exe)$/i;
const PEM = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----\s*[A-Za-z0-9+/=\s]{80,}/;
const TOKENS = [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bghp_[A-Za-z0-9]{36,}/, /\bgithub_pat_[A-Za-z0-9_]{50,}/, /\bxox[bp]-[0-9A-Za-z-]{24,}/, /\bAIza[0-9A-Za-z_-]{35}\b/, /\bwhsec_[A-Za-z0-9]{24,}/, /\b[rs]k_live_[A-Za-z0-9]{20,}/];
// obviously synthetic fixtures (runs of one letter, SYNTHETIC/EXAMPLE/FAKE markers, sk-test-, sk-learn) are allowed in tests; anything else is treated as a leaked credential
const SYNTHETIC = /(.)\1{7,}|SYNTHETIC|EXAMPLE|FAKE|DUMMY|0123456789|sk-test-|sk-learn/i;
test("no tracked file contains private-key blocks or real-looking API tokens", { skip: !files }, () => {
  const hits = [];
  for (const f of files.filter(f => !BIN.test(f))) { let t; try { t = fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { continue; } if (PEM.test(t) || TOKENS.some(r => { const m = t.match(new RegExp(r.source, "g")) ?? []; return m.some(x => !SYNTHETIC.test(x)); })) hits.push(f); }
  assert.deepEqual(hits, []);
});
test("no key store, vault, .env or backup file is tracked", { skip: !files }, () => {
  assert.deepEqual(files.filter(f => /(^|\/)(\.env[^/]*|owner-private-key[^/]*|[^/]*\.enc\.pem|[^/]*\.atlbak|vault-key[^/]*)$/.test(f)), []);
});
test("owner key provisioning is refused inside the repository tree, accepted outside, stored passphrase-encrypted with owner-only permissions and never overwritten", () => {
  const inside = fs.mkdtempSync(path.join(ROOT, ".tmp-keytest-")); try {
    const c = createControlCenterCore({ stateDir: path.join(inside, "s"), configDir: path.join(inside, "c") });
    assert.throws(() => c.provisionOwnerKey({ passphrase: "a long enough passphrase" }), /KEY_DIR_INSIDE_REPOSITORY/);
  } finally { fs.rmSync(inside, { recursive: true, force: true }); }
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "key-")), c = createControlCenterCore({ stateDir: path.join(d, "s"), configDir: path.join(d, "c") });
  assert.throws(() => c.provisionOwnerKey({ passphrase: "short" }), /PASSPHRASE_TOO_SHORT/);
  const r = c.provisionOwnerKey({ passphrase: "a long enough passphrase" }); assert.ok(r.publicKeyB64);
  const pem = fs.readFileSync(path.join(d, "c", "owner-private-key.enc.pem"), "utf8"); assert.match(pem, /BEGIN ENCRYPTED PRIVATE KEY/); assert.doesNotMatch(pem, /BEGIN PRIVATE KEY/);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(d, "c", "owner-private-key.enc.pem")).mode & 0o077, 0);
  assert.throws(() => c.provisionOwnerKey({ passphrase: "another long passphrase" }), /REFUSING_TO_OVERWRITE/);
  assert.ok(!JSON.stringify(r).includes("PRIVATE"));
});
