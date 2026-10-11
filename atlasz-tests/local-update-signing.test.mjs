// Update package signature verification + structural pre-scan, wired into the real local update adapters (stager).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createReleaseVerifier, generatePublisherKeyPair, buildManifest, signManifest, anchorAddSubject, keyIdOf } from "../atlasz-addons/release-signing.mjs";
import { createLocalUpdateAdapters, buildPackage, SIGNATURE_FILE } from "../atlasz-addons/local-update-adapters.mjs";
import { tmp, rm } from "./helpers.mjs";

const owner = generateOwnerKeyPair(), pub = generatePublisherKeyPair();
function rig(opts = {}) {
  const root = tmp("lus-"), inbox = path.join(root, "inbox"); fs.mkdirSync(inbox);
  const ownerAuth = createOwnerAuth({ publicKeyB64: owner.publicKeyB64 });
  const verifier = createReleaseVerifier({ ownerAuth, stateDir: path.join(root, "rel") });
  const comps = ["ext"], kid = keyIdOf(pub.publicKeyB64);
  verifier.addTrustAnchor({ publicKeyB64: pub.publicKeyB64, components: comps }, { ownerApproval: issueOwnerApproval({ privateKeyPem: owner.privateKeyPem, action: "RELEASE_TRUST_ANCHOR_ADD", subject: anchorAddSubject(kid, pub.publicKeyB64, comps) }) });
  const la = createLocalUpdateAdapters({ inboxDir: inbox, releaseVerifier: verifier, ...opts });
  const mk = (name, version, files, { sign = true, tamper = false } = {}) => {
    buildPackage(path.join(inbox, name), { componentId: "ext", riskTags: [], version, files });
    if (sign) {
      const payload = path.join(inbox, name, "payload"), env = signManifest(buildManifest({ rootDir: payload, component: "ext", version }), { privateKeyPem: pub.privateKeyPem });
      fs.writeFileSync(path.join(inbox, name, SIGNATURE_FILE), JSON.stringify(env));
      if (tamper) fs.appendFileSync(path.join(payload, "code.mjs"), "// changed after signing\n");
    }
  };
  const stage = async version => { const dir = path.join(root, "stg-" + version); fs.mkdirSync(dir); return la.adapters.stager({ update: { componentId: "ext", version }, stagingDir: dir }); };
  return { root, mk, stage, done: () => rm(root) };
}
test("a correctly signed package stages with signature evidence; a tampered one, an unknown key, a wrong version are refused", async () => {
  const r = rig();
  try {
    r.mk("ok", "1.1.0", { VERSION: "1.1.0", "code.mjs": "export const v = 2;\n" });
    const s = await r.stage("1.1.0"); assert.equal(s.ok, true, JSON.stringify(s)); assert.equal(s.evidence.signature.state, "SIGNATURE_VALID_CONTENT_MATCHES");
    r.mk("bad", "1.2.0", { VERSION: "1.2.0", "code.mjs": "export const v = 3;\n" }); // signed over the payload, then payload changed but manifest hashes recomputed would differ: mutate payload + keep package manifest valid
    const payload = path.join(r.root, "inbox", "bad", "payload", "code.mjs"), mf = path.join(r.root, "inbox", "bad", "manifest.json");
    const m = JSON.parse(fs.readFileSync(mf, "utf8")); fs.appendFileSync(payload, "// evil\n"); m.files["code.mjs"] = (await import("node:crypto")).createHash("sha256").update(fs.readFileSync(payload)).digest("hex"); fs.writeFileSync(mf, JSON.stringify(m));
    const t = await r.stage("1.2.0"); assert.equal(t.ok, false); assert.match(t.evidence, /^SIGNATURE_REFUSED:.*FILE_ALTERED:code\.mjs/);
    // signature from a key that is not a trust anchor
    r.mk("rogue", "1.3.0", { VERSION: "1.3.0", "code.mjs": "export const v = 4;\n" }, { sign: false });
    const other = generatePublisherKeyPair(), pl = path.join(r.root, "inbox", "rogue", "payload");
    fs.writeFileSync(path.join(r.root, "inbox", "rogue", SIGNATURE_FILE), JSON.stringify(signManifest(buildManifest({ rootDir: pl, component: "ext", version: "1.3.0" }), { privateKeyPem: other.privateKeyPem })));
    const u = await r.stage("1.3.0"); assert.equal(u.ok, false); assert.match(u.evidence, /UNKNOWN_SIGNING_KEY/);
  } finally { r.done(); }
});
test("unsigned packages: allowed but labelled when not required, refused when required; a package that ships a disguised executable is refused by the pre-scan", async () => {
  let r = rig();
  try { r.mk("u", "1.1.0", { VERSION: "1.1.0", "code.mjs": "export const v = 2;\n" }, { sign: false }); const s = await r.stage("1.1.0"); assert.equal(s.ok, true); assert.equal(s.evidence.signature.state, "UNSIGNED_NOT_REQUIRED"); } finally { r.done(); }
  r = rig({ requireSignature: true });
  try { r.mk("u", "1.1.0", { VERSION: "1.1.0", "code.mjs": "export const v = 2;\n" }, { sign: false }); const s = await r.stage("1.1.0"); assert.equal(s.ok, false); assert.equal(s.evidence, "SIGNATURE_REQUIRED_BUT_MISSING"); } finally { r.done(); }
  r = rig();
  try { r.mk("x", "1.1.0", { VERSION: "1.1.0", "tool.pdf": "MZ" + "A".repeat(300) }); const s = await r.stage("1.1.0"); assert.equal(s.ok, false); assert.match(s.evidence, /^STRUCTURAL_PRESCAN_BLOCKED:tool\.pdf/); } finally { r.done(); }
});
test("a signature file with no verifier configured is refused, never ignored", async () => {
  const r = rig(); const root = r.root;
  try {
    r.mk("s", "1.1.0", { VERSION: "1.1.0", "code.mjs": "export const v = 2;\n" });
    const la = createLocalUpdateAdapters({ inboxDir: path.join(root, "inbox") }); const dir = path.join(root, "stg"); fs.mkdirSync(dir);
    const s = await la.adapters.stager({ update: { componentId: "ext", version: "1.1.0" }, stagingDir: dir }); assert.equal(s.ok, false); assert.equal(s.evidence, "SIGNATURE_PRESENT_BUT_NO_VERIFIER_CONFIGURED");
  } finally { r.done(); }
});
