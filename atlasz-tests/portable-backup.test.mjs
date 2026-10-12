import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
import { createPortableBackup, verifyPortableBackup, restorePortableBackup, checkDestination } from "../atlasz-addons/portable-backup.mjs";
const T = p => fs.mkdtempSync(path.join(os.tmpdir(), p)), PASS = "correct horse battery staple";
const seed = () => { const d = T("pb-src-"); fs.mkdirSync(path.join(d, "x")); fs.writeFileSync(path.join(d, "x", "a.json"), '{"secretish":"SENTINEL_PLAINTEXT_MARKER"}'); fs.writeFileSync(path.join(d, "k.bin"), Buffer.from([1, 2, 3, 250]), { mode: 0o600 }); fs.writeFileSync(path.join(d, "skip.tmp"), "x"); return d; };

test("backup is a single encrypted file: no plaintext marker, temp files excluded, verify ok, wrong passphrase / tamper / truncation fail closed", () => {
  const src = seed(), usb = T("pb-usb-"), r = createPortableBackup({ sets: [{ name: "state", dir: src }], destination: usb, passphrase: PASS });
  assert.equal(fs.readdirSync(usb).length, 1); assert.ok(r.file.endsWith(".atlbak")); assert.equal(r.files, 2);
  const raw = fs.readFileSync(r.file); assert.ok(!raw.includes("SENTINEL_PLAINTEXT_MARKER")); assert.ok(!raw.includes(Buffer.from("SENTINEL_PLAINTEXT_MARKER").toString("base64")));
  assert.equal(verifyPortableBackup(r.file, PASS).ok, true);
  assert.equal(verifyPortableBackup(r.file, "a different long passphrase").ok, false);
  const bad = Buffer.from(raw); bad[bad.length - 60] ^= 1; const f2 = path.join(usb, "t.atlbak"); fs.writeFileSync(f2, bad); assert.match(verifyPortableBackup(f2, PASS).problems[0], /INCOMPLETE_OR_CORRUPT/);
  fs.writeFileSync(f2, raw.subarray(0, raw.length - 500)); assert.match(verifyPortableBackup(f2, PASS).problems[0], /INCOMPLETE_OR_CORRUPT|FORMAT/);
  assert.throws(() => createPortableBackup({ sets: [{ name: "state", dir: src }], destination: usb, passphrase: "short" }), /PASSPHRASE_TOO_SHORT/);
});
test("destination rules: owner-chosen existing writable dir, never inside a source tree; no .partial left behind", () => {
  const src = seed(); fs.mkdirSync(path.join(src, "inner"));
  assert.equal(checkDestination(path.join(src, "inner"), [src]).reason, "DESTINATION_INSIDE_SOURCE");
  assert.equal(checkDestination("/nonexistent-usb", [src]).reason, "DESTINATION_NOT_A_DIRECTORY");
  const usb = T("pb-usb-"); createPortableBackup({ sets: [{ name: "state", dir: src }], destination: usb, passphrase: PASS });
  assert.ok(!fs.readdirSync(usb).some(n => n.endsWith(".partial")));
});
test("restore: byte-identical, modes kept, refuses a non-empty target, never overwrites", () => {
  const src = seed(), usb = T("pb-usb-"), r = createPortableBackup({ sets: [{ name: "state", dir: src }], destination: usb, passphrase: PASS });
  const dst = path.join(T("pb-dst-"), "state"); const out = restorePortableBackup({ file: r.file, passphrase: PASS, targets: { state: dst } });
  assert.equal(out.restored, 2); assert.deepEqual(fs.readFileSync(path.join(dst, "k.bin")), Buffer.from([1, 2, 3, 250]));
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dst, "k.bin")).mode & 0o777, 0o600);
  assert.throws(() => restorePortableBackup({ file: r.file, passphrase: PASS, targets: { state: dst } }), /TARGET_NOT_EMPTY/);
  assert.throws(() => restorePortableBackup({ file: r.file, passphrase: "wrong wrong wrong wrong", targets: { state: path.join(T("pb-"), "n") } }), /WRONG_PASSPHRASE/);
});
test("DISASTER RECOVERY REHEARSAL: full Control Center state -> encrypted file -> isolated restore -> fresh Control Center boots and passes module health + startup check", async () => {
  const d = T("pb-cc-"), usb = T("pb-usb-"), c = createControlCenterCore({ stateDir: path.join(d, "s"), configDir: path.join(d, "c") });
  await c.runDueSchedules(); await c.modules({ health: true });
  const b = c.portableBackup({ destination: usb, passphrase: PASS, label: "rehearsal" });
  assert.ok(b.files > 10); const v = c.portableVerify({ file: b.file, passphrase: PASS }); assert.equal(v.ok, true); assert.ok(v.sets.includes("state") && v.sets.includes("config"));
  const rr = await c.portableRestoreRehearsal({ file: b.file, passphrase: PASS });
  assert.equal(rr.isolated, true); assert.deepEqual(rr.unhealthy, []); assert.equal(rr.passed, true); assert.ok(rr.modules >= 137); assert.equal(rr.gitBundlePresent, true);
  assert.match(rr.notice, /External accounts/);
  assert.ok(!fs.readdirSync(usb).some(n => !n.endsWith(".atlbak")));
});
