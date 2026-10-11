// 23-point item 23: signed update bundles for safe self-maintenance. Synthetic publisher and owner keys, temporary bundle folders; nothing is installed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateKeyPairSync, createHash } from "node:crypto";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createAuditChain } from "../atlasz-addons/audit-chain.mjs";
import { createReleaseVerifier, generatePublisherKeyPair, keyIdOf, cleanBundlePath, hashBundle, buildManifest, canonicalManifest, manifestDigest, signManifest,
  anchorAddSubject, anchorRemoveSubject, downgradeSubject, MANIFEST_FORMAT } from "../atlasz-addons/release-signing.mjs";
import { tmp, rm } from "./helpers.mjs";

const okp = generateOwnerKeyPair();
const auth = () => createOwnerAuth({ publicKeyB64: okp.publicKeyB64 });
const ap = (action, subject, k = okp) => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action, subject });
const PUB = generatePublisherKeyPair();
const COMP = "atlasz-core";

function rig({ components = [COMP], files = { "index.mjs": "export const v = 1;\n", "lib/util.mjs": "export const u = 2;\n" }, opts = {} } = {}) {
  const d = tmp("rel-"), bundle = path.join(d, "bundle");
  for (const [p, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(bundle, p)), { recursive: true }); fs.writeFileSync(path.join(bundle, p), c); }
  const rv = createReleaseVerifier({ ownerAuth: auth(), stateDir: path.join(d, "state"), ...opts });
  if (components) rv.addTrustAnchor({ publicKeyB64: PUB.publicKeyB64, components }, { ownerApproval: ap("RELEASE_TRUST_ANCHOR_ADD", anchorAddSubject(PUB.keyId, PUB.publicKeyB64, components)) });
  const make = (version, key = PUB) => signManifest(buildManifest({ rootDir: bundle, component: COMP, version }), { privateKeyPem: key.privateKeyPem });
  return { d, bundle, rv, make };
}

// ---------------------------------------------------------------- building blocks
test("key ids are derived from the key bytes", () => {
  const k = generatePublisherKeyPair();
  assert.match(k.keyId, /^ed25519:[0-9a-f]{16}$/); assert.equal(keyIdOf(k.publicKeyB64), k.keyId); assert.notEqual(keyIdOf(PUB.publicKeyB64), k.keyId);
});

test("bundle paths: relative, no traversal, no absolute, no backslash, no control or format characters", () => {
  for (const p of ["a.mjs", "lib/x/y.json", "a..b"]) assert.equal(cleanBundlePath(p), p);
  for (const p of ["", "/etc/x", "../x", "a/../b", "a/./b", "a//b", "a\\b", "C:/x", "a\0b", "a\u202eb", "dir/", "x".repeat(300), null, 5]) assert.equal(cleanBundlePath(p), null, String(p));
});

test("hashBundle hashes regular files in sorted order and reports links / unsafe names", () => {
  const d = tmp("rel-");
  try {
    fs.mkdirSync(path.join(d, "b", "z"), { recursive: true }); fs.writeFileSync(path.join(d, "b", "z", "2.txt"), "2"); fs.writeFileSync(path.join(d, "b", "1.txt"), "1");
    const h = hashBundle(path.join(d, "b"));
    assert.deepEqual(h.files.map(f => f.path), ["1.txt", "z/2.txt"]); assert.equal(h.problems.length, 0); assert.equal(h.files[0].size, 1);
    assert.equal(h.files[0].sha256, createHash("sha256").update("1").digest("hex"));
    if (process.platform !== "win32") { fs.symlinkSync("/etc/hostname", path.join(d, "b", "link")); assert.ok(hashBundle(path.join(d, "b")).problems.some(p => p.code === "SYMLINK_IN_BUNDLE")); }
    assert.equal(hashBundle(path.join(d, "missing")).problems[0].code, "BUNDLE_DIR_MISSING");
  } finally { rm(d); }
});

test("buildManifest validates component and version and refuses empty or linked bundles", () => {
  const r = rig({ components: null });
  try {
    const m = buildManifest({ rootDir: r.bundle, component: COMP, version: "1.0.0" });
    assert.equal(m.format, MANIFEST_FORMAT); assert.equal(m.files.length, 2); assert.match(m.nonce, /^[0-9a-f]{32}$/);
    assert.throws(() => buildManifest({ rootDir: r.bundle, component: "Bad Name", version: "1.0.0" }), /COMPONENT_INVALID/);
    for (const v of ["1.0", "v1.0.0", " 1.0.0", "1.0.0.0", ""]) assert.throws(() => buildManifest({ rootDir: r.bundle, component: COMP, version: v }), /VERSION_INVALID/, v);
    fs.mkdirSync(path.join(r.d, "empty")); assert.throws(() => buildManifest({ rootDir: path.join(r.d, "empty"), component: COMP, version: "1.0.0" }), /BUNDLE_EMPTY/);
    if (process.platform !== "win32") { fs.symlinkSync("/etc/hostname", path.join(r.bundle, "l")); assert.throws(() => buildManifest({ rootDir: r.bundle, component: COMP, version: "1.0.0" }), /SYMLINK_IN_BUNDLE/); }
    assert.throws(() => signManifest(m, {}), /PRIVATE_KEY_REQUIRED/);
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" });
    assert.throws(() => signManifest(m, { privateKeyPem: rsa }), /ED25519/);
  } finally { rm(r.d); }
});

test("canonical form is order-independent and the digest changes with any content change", () => {
  const r = rig({ components: null });
  try {
    const m = buildManifest({ rootDir: r.bundle, component: COMP, version: "1.0.0" });
    const shuffled = { files: [...m.files].reverse(), nonce: m.nonce, version: m.version, createdAt: m.createdAt, component: m.component, format: m.format };
    assert.equal(canonicalManifest(shuffled), canonicalManifest(m)); assert.equal(manifestDigest(shuffled), manifestDigest(m));
    assert.notEqual(manifestDigest({ ...m, version: "1.0.1" }), manifestDigest(m));
  } finally { rm(r.d); }
});

// ---------------------------------------------------------------- verification
test("a correctly signed, unmodified bundle verifies (signature + content), and the verdict claims nothing more", () => {
  const r = rig();
  try {
    const v = r.rv.verifyBundle(r.make("1.0.0"), { bundleDir: r.bundle });
    assert.equal(v.ok, true, v.reasons.join()); assert.equal(v.verdict, "SIGNATURE_VALID_CONTENT_MATCHES"); assert.equal(v.keyId, PUB.keyId);
    assert.ok(!JSON.stringify(v).includes("VERIFIED_WORKING") && !JSON.stringify(v).includes("LIVE"));
    assert.equal(r.rv.summary().state, "IMPLEMENTED_NOT_CONNECTED");
  } finally { rm(r.d); }
});

test("unsigned, malformed and envelope-padded inputs are refused", () => {
  const r = rig();
  try {
    const s = r.make("1.0.0");
    for (const x of [null, undefined, "x", 5, {}, { manifest: s.manifest }, { manifest: s.manifest, signature: null }, { manifest: s.manifest, signature: "sig" }]) assert.equal(r.rv.verifyBundle(x, { bundleDir: r.bundle }).ok, false);
    assert.equal(r.rv.verifyBundle({ manifest: s.manifest }, { bundleDir: r.bundle }).reasons[0], "UNSIGNED_OR_MALFORMED");
    assert.equal(r.rv.verifyBundle({ ...s, extra: 1 }, { bundleDir: r.bundle }).reasons[0], "ENVELOPE_FIELDS_INVALID");
    assert.equal(r.rv.verifyBundle({ ...s, manifest: { ...s.manifest, postInstall: "rm -rf /" } }, { bundleDir: r.bundle }).reasons[0], "MANIFEST_FIELDS_INVALID", "an unsigned field cannot ride along");
    assert.equal(r.rv.verifyBundle({ ...s, signature: { ...s.signature, alg: "none" } }, { bundleDir: r.bundle }).reasons[0], "SIGNATURE_FIELDS_INVALID");
    assert.equal(r.rv.verifyBundle({ ...s, manifest: { ...s.manifest, format: "v0" } }, { bundleDir: r.bundle }).reasons[0], "MANIFEST_FORMAT_UNSUPPORTED");
  } finally { rm(r.d); }
});

test("unknown keys and keys scoped to another component are refused; '*' scope covers all", () => {
  const r = rig();
  try {
    assert.equal(r.rv.verifyBundle(r.make("1.0.0", generatePublisherKeyPair()), { bundleDir: r.bundle }).reasons[0], "UNKNOWN_SIGNING_KEY");
    const s = r.make("1.0.0"); s.signature.keyId = generatePublisherKeyPair().keyId;
    assert.equal(r.rv.verifyBundle(s, { bundleDir: r.bundle }).reasons[0], "UNKNOWN_SIGNING_KEY", "relabelling the key id does not help");
    const scoped = rig({ components: ["atlasz-plugins"] });
    try { assert.equal(scoped.rv.verifyBundle(scoped.make("1.0.0"), { bundleDir: scoped.bundle }).reasons[0], "KEY_NOT_TRUSTED_FOR_COMPONENT"); } finally { rm(scoped.d); }
    const star = rig({ components: ["*"] });
    try { assert.equal(star.rv.verifyBundle(star.make("1.0.0"), { bundleDir: star.bundle }).ok, true); } finally { rm(star.d); }
  } finally { rm(r.d); }
});

test("any change to the signed manifest breaks the signature", () => {
  const r = rig();
  try {
    const s = r.make("1.0.0");
    const tamper = f => { const c = structuredClone(s); f(c.manifest); return r.rv.verifyBundle(c, { bundleDir: r.bundle }).reasons[0]; };
    assert.equal(tamper(m => { m.version = "9.9.9"; }), "SIGNATURE_INVALID");
    assert.equal(tamper(m => { m.files[0].sha256 = "0".repeat(64); }), "SIGNATURE_INVALID");
    assert.equal(tamper(m => { m.files.pop(); }), "SIGNATURE_INVALID");
    assert.equal(tamper(m => { m.nonce = "f".repeat(32); }), "SIGNATURE_INVALID");
    assert.equal(tamper(m => { m.createdAt = new Date(0).toISOString(); }), "SIGNATURE_INVALID");
    const flipped = structuredClone(s); flipped.signature.value = Buffer.from(Buffer.from(s.signature.value, "base64").map((b, i) => (i === 3 ? b ^ 1 : b))).toString("base64");
    assert.equal(r.rv.verifyBundle(flipped, { bundleDir: r.bundle }).reasons[0], "SIGNATURE_INVALID");
    const garbage = structuredClone(s); garbage.signature.value = "!!!";
    assert.equal(r.rv.verifyBundle(garbage, { bundleDir: r.bundle }).reasons[0], "SIGNATURE_INVALID");
  } finally { rm(r.d); }
});

test("altered, missing and extra files on disk are refused (including links and hidden extras)", () => {
  const r = rig();
  try {
    const s = r.make("1.0.0");
    fs.appendFileSync(path.join(r.bundle, "index.mjs"), "// injected\n");
    assert.ok(r.rv.verifyBundle(s, { bundleDir: r.bundle }).reasons.includes("FILE_ALTERED:index.mjs"));
    fs.writeFileSync(path.join(r.bundle, "index.mjs"), "export const v = 1;\n");
    fs.unlinkSync(path.join(r.bundle, "lib", "util.mjs"));
    assert.ok(r.rv.verifyBundle(s, { bundleDir: r.bundle }).reasons.includes("FILE_MISSING:lib/util.mjs"));
    fs.writeFileSync(path.join(r.bundle, "lib", "util.mjs"), "export const u = 2;\n");
    fs.writeFileSync(path.join(r.bundle, ".postinstall.sh"), "echo");
    assert.ok(r.rv.verifyBundle(s, { bundleDir: r.bundle }).reasons.includes("EXTRA_FILE:.postinstall.sh"));
    fs.unlinkSync(path.join(r.bundle, ".postinstall.sh"));
    if (process.platform !== "win32") { fs.symlinkSync("/etc/passwd", path.join(r.bundle, "lib", "p")); assert.ok(r.rv.verifyBundle(s, { bundleDir: r.bundle }).reasons.includes("SYMLINK_IN_BUNDLE:lib/p")); fs.unlinkSync(path.join(r.bundle, "lib", "p")); }
    assert.equal(r.rv.verifyBundle(s, { bundleDir: r.bundle }).ok, true, "restored bundle verifies again");
    assert.ok(r.rv.verifyBundle(s, {}).reasons.includes("BUNDLE_DIR_REQUIRED"));
    assert.ok(r.rv.verifyBundle(s, { bundleDir: path.join(r.d, "nope") }).reasons.includes("BUNDLE_DIR_MISSING:."));
  } finally { rm(r.d); }
});

test("signed manifests with unsafe, duplicate or case-colliding paths are refused even with a valid signature", () => {
  const r = rig();
  try {
    const base = buildManifest({ rootDir: r.bundle, component: COMP, version: "1.0.0" }), f = base.files[0];
    for (const [files, want] of [[[{ ...f, path: "../escape.mjs" }], "FILE_PATH_UNSAFE"], [[f, { ...f }], "FILE_PATH_DUPLICATE"], [[f, { ...f, path: f.path.toUpperCase() }], "FILE_PATH_DUPLICATE"], [[{ ...f, extra: 1 }], "FILE_ENTRY_INVALID"], [[{ ...f, size: -1 }], "FILE_ENTRY_INVALID"], [[], "FILES_INVALID"]]) {
      const m = { ...base, files };
      assert.throws(() => signManifest(m, { privateKeyPem: PUB.privateKeyPem }), new RegExp(want));
      assert.equal(r.rv.verifyBundle({ manifest: m, signature: { alg: "Ed25519", keyId: PUB.keyId, value: "AA==" } }, { bundleDir: r.bundle }).reasons[0], want);
    }
  } finally { rm(r.d); }
});

test("replay: an accepted manifest is refused afterwards (by digest and by nonce), also after a restart", () => {
  const r = rig();
  try {
    const s = r.make("1.0.0");
    const a = r.rv.accept(s, { bundleDir: r.bundle }); assert.equal(a.accepted, true); assert.match(a.note, /Nothing was installed/);
    assert.ok(r.rv.verifyBundle(s, { bundleDir: r.bundle }).reasons.includes("REPLAY_OF_ACCEPTED_MANIFEST"));
    assert.ok(r.rv.accept(s, { bundleDir: r.bundle }).reasons.includes("REPLAY_OF_ACCEPTED_MANIFEST"));
    const sameNonce = { ...structuredClone(s.manifest), version: "1.0.1" };
    assert.ok(r.rv.verifyBundle(signManifest(sameNonce, { privateKeyPem: PUB.privateKeyPem }), { bundleDir: r.bundle }).reasons.includes("REPLAY_OF_ACCEPTED_MANIFEST"), "a re-used nonce is a replay");
    const again = createReleaseVerifier({ ownerAuth: auth(), stateDir: path.join(r.d, "state") });
    assert.ok(again.verifyBundle(s, { bundleDir: r.bundle }).reasons.includes("REPLAY_OF_ACCEPTED_MANIFEST")); assert.equal(again.acceptedVersion(COMP), "1.0.0");
  } finally { rm(r.d); }
});

test("downgrade and same-version re-issue are refused; an owner-approved rollback is bound to the manifest digest", () => {
  const r = rig();
  try {
    assert.equal(r.rv.accept(r.make("2.0.0"), { bundleDir: r.bundle }).accepted, true);
    const old = r.make("1.9.9");
    assert.ok(r.rv.verifyBundle(old, { bundleDir: r.bundle }).reasons.includes("DOWNGRADE:2.0.0->1.9.9"));
    assert.ok(r.rv.verifyBundle(r.make("2.0.0"), { bundleDir: r.bundle }).reasons.includes("VERSION_ALREADY_ACCEPTED:2.0.0"));
    assert.ok(r.rv.verifyBundle(r.make("2.0.0-rc.1"), { bundleDir: r.bundle }).reasons.some(x => x.startsWith("DOWNGRADE")), "a pre-release of the same version is older");
    const other = r.make("1.9.8");
    assert.ok(r.rv.accept(old, { bundleDir: r.bundle, downgradeApproval: ap("RELEASE_ALLOW_DOWNGRADE", downgradeSubject(COMP, manifestDigest(other.manifest))) }).reasons.some(x => x.startsWith("DOWNGRADE_APPROVAL_INVALID")));
    assert.ok(r.rv.accept(old, { bundleDir: r.bundle, downgradeApproval: true }).reasons.some(x => x.startsWith("DOWNGRADE_APPROVAL_INVALID:BARE_BOOLEAN")));
    const ok = r.rv.accept(old, { bundleDir: r.bundle, downgradeApproval: ap("RELEASE_ALLOW_DOWNGRADE", downgradeSubject(COMP, manifestDigest(old.manifest))) });
    assert.equal(ok.accepted, true); assert.equal(ok.ownerApprovedDowngrade, true); assert.equal(r.rv.acceptedVersion(COMP), "1.9.9");
    const tampered = r.make("1.5.0"), next = r.make("3.0.0"); fs.appendFileSync(path.join(r.bundle, "index.mjs"), "x");
    assert.equal(r.rv.accept(tampered, { bundleDir: r.bundle, downgradeApproval: ap("RELEASE_ALLOW_DOWNGRADE", downgradeSubject(COMP, manifestDigest(tampered.manifest))) }).accepted, undefined, "an approval cannot excuse anything except the downgrade itself");
    assert.ok(r.rv.accept(next, { bundleDir: r.bundle }).reasons.includes("FILE_ALTERED:index.mjs"), "a newer signed version is still refused while the bundle is altered");
  } finally { rm(r.d); }
});

test("future-dated manifests are refused", () => {
  const r = rig();
  try {
    const m = buildManifest({ rootDir: r.bundle, component: COMP, version: "1.0.0", nowMs: Date.now() + 3600_000 });
    assert.ok(r.rv.verifyBundle(signManifest(m, { privateKeyPem: PUB.privateKeyPem }), { bundleDir: r.bundle }).reasons.includes("CREATED_IN_FUTURE"));
  } finally { rm(r.d); }
});

// ---------------------------------------------------------------- trust anchors
test("trust anchors change only with an owner approval bound to the key and its scope", () => {
  const r = rig({ components: null });
  try {
    const k = generatePublisherKeyPair(), add = comps => ap("RELEASE_TRUST_ANCHOR_ADD", anchorAddSubject(k.keyId, k.publicKeyB64, comps));
    assert.throws(() => r.rv.addTrustAnchor({ publicKeyB64: k.publicKeyB64, components: [COMP] }), /OWNER_APPROVAL_REQUIRED/);
    assert.throws(() => r.rv.addTrustAnchor({ publicKeyB64: k.publicKeyB64, components: [COMP] }, { ownerApproval: true }), /BARE_BOOLEAN/);
    assert.throws(() => r.rv.addTrustAnchor({ publicKeyB64: k.publicKeyB64, components: ["*"] }, { ownerApproval: add([COMP]) }), /SUBJECT_MISMATCH/, "approval for one component cannot widen to '*'");
    assert.throws(() => r.rv.addTrustAnchor({ publicKeyB64: PUB.publicKeyB64, components: [COMP] }, { ownerApproval: add([COMP]) }), /SUBJECT_MISMATCH/, "approval for one key cannot add another");
    assert.throws(() => r.rv.addTrustAnchor({ publicKeyB64: k.publicKeyB64, components: [COMP] }, { ownerApproval: ap("RELEASE_TRUST_ANCHOR_ADD", anchorAddSubject(k.keyId, k.publicKeyB64, [COMP]), generateOwnerKeyPair()) }), /SIGNATURE_INVALID/);
    assert.throws(() => r.rv.addTrustAnchor({ publicKeyB64: k.publicKeyB64, components: [] }, { ownerApproval: add([]) }), /COMPONENTS_REQUIRED/);
    assert.throws(() => r.rv.addTrustAnchor({ publicKeyB64: "not-a-key", components: [COMP] }, { ownerApproval: add([COMP]) }), /PUBLIC_KEY_INVALID/);
    const rsaPub = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "der", type: "spki" }).toString("base64");
    assert.throws(() => r.rv.addTrustAnchor({ publicKeyB64: rsaPub, components: [COMP] }, { ownerApproval: add([COMP]) }), /MUST_BE_ED25519/);
    assert.equal(r.rv.addTrustAnchor({ publicKeyB64: k.publicKeyB64, components: [COMP] }, { ownerApproval: add([COMP]) }).keyId, k.keyId);
    assert.equal(r.rv.listTrustAnchors().length, 1);
    assert.throws(() => r.rv.removeTrustAnchor(k.keyId, { ownerApproval: add([COMP]) }), /OWNER_APPROVAL_REQUIRED/);
    assert.throws(() => r.rv.removeTrustAnchor("bad", {}), /KEY_ID_INVALID/);
    assert.equal(r.rv.removeTrustAnchor(k.keyId, { ownerApproval: ap("RELEASE_TRUST_ANCHOR_REMOVE", anchorRemoveSubject(k.keyId)) }), true);
    const s = signManifest(buildManifest({ rootDir: r.bundle, component: COMP, version: "1.0.0" }), { privateKeyPem: k.privateKeyPem });
    assert.equal(r.rv.verifyBundle(s, { bundleDir: r.bundle }).reasons[0], "UNKNOWN_SIGNING_KEY", "a removed (rotated) key is no longer trusted");
    assert.ok(r.rv.auditEntries().some(e => e.event === "TRUST_ANCHOR_CHANGE_DENIED"));
  } finally { rm(r.d); }
});

test("a consistently re-hashed chain with a forged anchor trusts nothing; an edited chain is refused", () => {
  const d = tmp("rel-");
  try {
    const stateDir = path.join(d, "state"), evil = generatePublisherKeyPair();
    createAuditChain({ filePath: path.join(stateDir, "release-signing-audit.jsonl") }).append("TRUST_ANCHOR_ADDED", { keyId: evil.keyId, publicKeyB64: evil.publicKeyB64, components: ["*"], approval: ap("RELEASE_TRUST_ANCHOR_ADD", anchorAddSubject(evil.keyId, evil.publicKeyB64, ["*"]), generateOwnerKeyPair()) });
    const rv = createReleaseVerifier({ ownerAuth: auth(), stateDir });
    assert.equal(rv.listTrustAnchors().length, 0); assert.match(rv.summary().integrity, /UNVERIFIED_ANCHOR_RECORDS_IGNORED:1/);
    fs.mkdirSync(path.join(d, "b")); fs.writeFileSync(path.join(d, "b", "x"), "x");
    assert.equal(rv.verifyBundle(signManifest(buildManifest({ rootDir: path.join(d, "b"), component: COMP, version: "1.0.0" }), { privateKeyPem: evil.privateKeyPem }), { bundleDir: path.join(d, "b") }).reasons[0], "UNKNOWN_SIGNING_KEY");
    const f = path.join(stateDir, "release-signing-audit.jsonl"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"*"', '"atlasz-core"'));
    assert.throws(() => createReleaseVerifier({ ownerAuth: auth(), stateDir }), /AUDIT_CHAIN_TAMPERED/);
    assert.equal(rv.verifyBundle(signManifest(buildManifest({ rootDir: path.join(d, "b"), component: COMP, version: "1.0.0" }), { privateKeyPem: evil.privateKeyPem }), { bundleDir: path.join(d, "b") }).reasons[0], "AUDIT_CHAIN_TAMPERED", "a running verifier that sees tampering refuses everything");
  } finally { rm(d); }
});

test("deleting accepted history from the middle is detected; dropping the newest entry is the documented limit", () => {
  const r = rig();
  try {
    const v1 = r.make("1.0.0"), v2 = r.make("1.1.0");
    r.rv.accept(v1, { bundleDir: r.bundle }); r.rv.accept(v2, { bundleDir: r.bundle });
    const f = path.join(r.d, "state", "release-signing-audit.jsonl"), lines = fs.readFileSync(f, "utf8").trim().split("\n");
    assert.equal(lines.length, 3);
    fs.writeFileSync(f, [lines[0], lines[2]].join("\n") + "\n");
    assert.throws(() => createReleaseVerifier({ ownerAuth: auth(), stateDir: path.join(r.d, "state") }), /AUDIT_CHAIN_TAMPERED/, "dropping a middle entry is detected");
    fs.writeFileSync(f, [lines[0], lines[1]].join("\n") + "\n");
    const rv = createReleaseVerifier({ ownerAuth: auth(), stateDir: path.join(r.d, "state") });
    assert.equal(rv.acceptedVersion(COMP), "1.0.0", "dropping the TAIL entry keeps a valid chain: tamper-evident, not tamper-proof (documented weakness)");
    assert.ok(rv.verifyBundle(v1, { bundleDir: r.bundle }).reasons.includes("REPLAY_OF_ACCEPTED_MANIFEST"), "older accepted history still blocks replay");
  } finally { rm(r.d); }
});

test("kill switch blocks acceptance; constructor requires a real owner auth; unconfigured owner auth trusts no anchor", () => {
  let s = false; const r = rig({ opts: { isStopped: () => s } });
  try {
    s = true; assert.deepEqual(r.rv.accept(r.make("1.0.0"), { bundleDir: r.bundle }).reasons, ["OWNER_STOP"]);
    s = false; assert.equal(r.rv.accept(r.make("1.0.0"), { bundleDir: r.bundle }).accepted, true);
    assert.throws(() => createReleaseVerifier({}), /OWNER_AUTH_REQUIRED/);
    const blind = createReleaseVerifier({ ownerAuth: createOwnerAuth({}), stateDir: path.join(r.d, "state") });
    assert.equal(blind.listTrustAnchors().length, 0, "without the owner public key no anchor record can be verified");
    const thrower = rig({ opts: { isStopped: () => { throw new Error("x"); } } });
    try { assert.deepEqual(thrower.rv.accept(thrower.make("1.0.0"), { bundleDir: thrower.bundle }).reasons, ["OWNER_STOP"]); } finally { rm(thrower.d); }
  } finally { rm(r.d); }
});

test("garbage input never throws and never verifies", () => {
  const r = rig();
  try {
    const s = r.make("1.0.0");
    const variants = [{ manifest: null, signature: s.signature }, { manifest: [], signature: s.signature }, { manifest: { ...s.manifest, files: "x" }, signature: s.signature }, { manifest: { ...s.manifest, files: [null] }, signature: s.signature },
      { manifest: { ...s.manifest, version: 1 }, signature: s.signature }, { manifest: { ...s.manifest, createdAt: "soon" }, signature: s.signature }, { manifest: { ...s.manifest, nonce: "x" }, signature: s.signature }, { manifest: s.manifest, signature: { alg: "Ed25519", keyId: 5, value: [] } }];
    for (const v of variants) { let out; assert.doesNotThrow(() => { out = r.rv.verifyBundle(v, { bundleDir: r.bundle }); }); assert.equal(out.ok, false); }
  } finally { rm(r.d); }
});

test("verifyBundle is read-only: verifying many times records nothing and never blocks the later accept", () => {
  const r = rig();
  try {
    const s = r.make("1.0.0"), before = r.rv.auditEntries().length;
    for (let i = 0; i < 3; i++) assert.equal(r.rv.verifyBundle(s, { bundleDir: r.bundle }).ok, true);
    assert.equal(r.rv.auditEntries().length, before); assert.equal(r.rv.acceptedVersion(COMP), null);
    assert.equal(r.rv.accept(s, { bundleDir: r.bundle }).accepted, true);
    assert.equal(r.rv.auditVerify().ok, true);
  } finally { rm(r.d); }
});

test("a key scoped to several components is trusted for exactly those; history is tracked per component", () => {
  const r = rig({ components: ["atlasz-core", "atlasz-plugins"] });
  try {
    const sign = comp => signManifest(buildManifest({ rootDir: r.bundle, component: comp, version: "1.0.0" }), { privateKeyPem: PUB.privateKeyPem });
    assert.equal(r.rv.accept(sign("atlasz-core"), { bundleDir: r.bundle }).accepted, true);
    assert.equal(r.rv.accept(sign("atlasz-plugins"), { bundleDir: r.bundle }).accepted, true, "same version of another component is not a replay or downgrade");
    assert.equal(r.rv.verifyBundle(sign("atlasz-voice"), { bundleDir: r.bundle }).reasons[0], "KEY_NOT_TRUSTED_FOR_COMPONENT");
    assert.equal(r.rv.acceptedVersion("atlasz-plugins"), "1.0.0"); assert.equal(r.rv.acceptedVersion("atlasz-voice"), null);
  } finally { rm(r.d); }
});

test("update-center.mjs is reused read-only (semver helpers) and not modified by this module", () => {
  const src = fs.readFileSync(new URL("../atlasz-addons/release-signing.mjs", import.meta.url), "utf8");
  assert.match(src, /import \{ parseVersion, compareVersions \} from "\.\/update-center\.mjs"/);
  assert.doesNotMatch(src, /writeFileSync\([^)]*update-center/);
});
