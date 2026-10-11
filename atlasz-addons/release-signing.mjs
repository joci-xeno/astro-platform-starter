// ATLASZ release (source bundle) signing for safe self-maintenance (23-point item 23). Local only: no network, no download, no install.
//
//   publisher side   buildManifest(rootDir) hashes every regular file of an update bundle (sha256 + size; symlinks and special files are refused), adds component, semver
//                    version, createdAt and a random nonce; signManifest() signs the CANONICAL manifest with an Ed25519 publisher private key.
//   verifier side    createReleaseVerifier holds EXPLICIT trust anchors (publisher public keys). Adding or removing an anchor needs a signed owner approval (owner-auth.mjs)
//                    bound to the key id + key bytes; anchor records are re-verified against the owner signature on every read, so an edited anchor file trusts nothing.
//                    verify(signed, {bundleDir}) refuses: unknown key, key not scoped to the component, bad signature, malformed / extra manifest fields, unsafe paths,
//                    altered files, missing files, extra files (including symlinks / special files in the bundle), a downgrade or same-version re-issue against the
//                    last accepted version, and a REPLAY of an already accepted manifest (by digest or nonce). accept() = verify + record as accepted.
//                    A deliberate downgrade (rollback) needs its own owner approval bound to the manifest digest.
//
// This module does NOT modify or call update-center.mjs (it only reuses its semver helpers). It does not install anything: a caller must use the verdict.
// Status honesty: IMPLEMENTED + unit TESTED locally; NOT CONNECTED to update-center or any installer yet; not LIVE. No real publisher key exists (BLOCKED on the owner
// generating one offline). "SIGNATURE_VALID_CONTENT_MATCHES" means the bytes on disk match what the key holder signed - not that the code is correct or safe.
// Limits: the accepted-release history is tamper-EVIDENT (hash chain) not tamper-proof - someone who can rewrite the whole state folder consistently can erase history and
// re-enable a replay/downgrade; a stolen publisher private key signs anything (rotate it by removing the anchor with an owner approval).
import fs from "node:fs";
import path from "node:path";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, randomBytes } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { parseVersion, compareVersions } from "./update-center.mjs";

export const MANIFEST_FORMAT = "atlasz-release-manifest/v1";
const SIG_DOMAIN = "ATLASZ-RELEASE-MANIFEST/v1\n";
const sha = b => createHash("sha256").update(b).digest("hex");
const COMPONENT_RE = /^[a-z][a-z0-9-]{1,40}$/, SHA_RE = /^[0-9a-f]{64}$/, NONCE_RE = /^[0-9a-f]{32}$/, KEYID_RE = /^ed25519:[0-9a-f]{16}$/;
const MANIFEST_KEYS = ["component", "createdAt", "files", "format", "nonce", "version"];
export const LIMITS = Object.freeze({ maxFiles: 5000, maxFileBytes: 64 * 1024 * 1024, maxTotalBytes: 512 * 1024 * 1024, maxPath: 240, clockSkewMs: 5 * 60 * 1000 });

/** key id = first 16 hex of sha256(SPKI DER). Derived, so a record cannot pair one id with another key. */
export const keyIdOf = publicKeyB64 => "ed25519:" + sha(Buffer.from(String(publicKeyB64), "base64")).slice(0, 16);
export function generatePublisherKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return { publicKeyB64, privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }), keyId: keyIdOf(publicKeyB64) };
}

/** Relative POSIX path inside a bundle; no traversal, absolute, backslash, NUL, control chars, empty or dot segments. Returns the path or null. */
export function cleanBundlePath(p) {
  if (typeof p !== "string" || !p || p.length > LIMITS.maxPath || !p.isWellFormed()) return null;
  if (/[\0\\\u0000-\u001f\u007f\p{Cf}]/u.test(p) || p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.endsWith("/")) return null;
  if (p.split("/").some(s => !s || s === "." || s === "..")) return null;
  return p;
}

/** Walk a bundle folder (no links followed). Returns {files:[{path,sha256,size}], problems:[...]} sorted by path. */
export function hashBundle(rootDir, limits = LIMITS) {
  const files = [], problems = []; let total = 0;
  const walk = (dir, rel) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { problems.push({ code: "UNREADABLE_DIR", path: rel || "." }); return; }
    for (const e of ents) {
      const r = rel ? rel + "/" + e.name : e.name, full = path.join(dir, e.name);
      if (e.isSymbolicLink()) { problems.push({ code: "SYMLINK_IN_BUNDLE", path: r }); continue; }
      if (e.isDirectory()) { walk(full, r); continue; }
      if (!e.isFile()) { problems.push({ code: "SPECIAL_FILE_IN_BUNDLE", path: r }); continue; }
      if (!cleanBundlePath(r)) { problems.push({ code: "UNSAFE_PATH_IN_BUNDLE", path: r.slice(0, 120) }); continue; }
      if (files.length >= limits.maxFiles) { problems.push({ code: "TOO_MANY_FILES", path: r }); return; }
      const st = fs.lstatSync(full);
      if (st.size > limits.maxFileBytes || (total += st.size) > limits.maxTotalBytes) { problems.push({ code: "BUNDLE_TOO_LARGE", path: r }); return; }
      const buf = fs.readFileSync(full);
      files.push({ path: r, sha256: sha(buf), size: buf.length });
    }
  };
  if (!fs.existsSync(rootDir) || !fs.lstatSync(rootDir).isDirectory()) return { files: [], problems: [{ code: "BUNDLE_DIR_MISSING", path: "." }] };
  walk(rootDir, "");
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, problems };
}

export function buildManifest({ rootDir, component, version, nowMs = Date.now() } = {}) {
  if (typeof component !== "string" || !COMPONENT_RE.test(component)) throw new Error("COMPONENT_INVALID");
  if (typeof version !== "string" || !parseVersion(version) || version !== version.trim()) throw new Error("VERSION_INVALID");
  const h = hashBundle(rootDir);
  if (h.problems.length) throw new Error("BUNDLE_REFUSED:" + h.problems.map(p => p.code + ":" + p.path).slice(0, 5).join(","));
  if (!h.files.length) throw new Error("BUNDLE_EMPTY");
  return { format: MANIFEST_FORMAT, component, version, createdAt: new Date(nowMs).toISOString(), nonce: randomBytes(16).toString("hex"), files: h.files };
}

/** Canonical form: fixed key order, files sorted by path, numbers as integers. The signature covers exactly this string. */
export function canonicalManifest(m) {
  return JSON.stringify({ format: m.format, component: m.component, version: m.version, createdAt: m.createdAt, nonce: m.nonce,
    files: [...m.files].map(f => [f.path, f.sha256, f.size]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) });
}
export const manifestDigest = m => sha(canonicalManifest(m));

export function signManifest(manifest, { privateKeyPem } = {}) {
  if (!privateKeyPem) throw new Error("PRIVATE_KEY_REQUIRED");
  const v = validateManifest(manifest); if (v) throw new Error(v);
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("PUBLISHER_KEY_MUST_BE_ED25519");
  const publicKeyB64 = createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64");
  return { manifest: structuredClone(manifest), signature: { alg: "Ed25519", keyId: keyIdOf(publicKeyB64), value: sign(null, Buffer.from(SIG_DOMAIN + canonicalManifest(manifest)), key).toString("base64") } };
}

/** Structural validation; returns an error code or null. Unknown fields are refused (nothing unsigned may ride along). */
function validateManifest(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return "MANIFEST_OBJECT_REQUIRED";
  const keys = Object.keys(m).sort();
  if (keys.length !== MANIFEST_KEYS.length || keys.some((k, i) => k !== MANIFEST_KEYS[i])) return "MANIFEST_FIELDS_INVALID";
  if (m.format !== MANIFEST_FORMAT) return "MANIFEST_FORMAT_UNSUPPORTED";
  if (typeof m.component !== "string" || !COMPONENT_RE.test(m.component)) return "COMPONENT_INVALID";
  if (typeof m.version !== "string" || !parseVersion(m.version) || m.version !== m.version.trim()) return "VERSION_INVALID";
  if (typeof m.createdAt !== "string" || !Number.isFinite(Date.parse(m.createdAt))) return "CREATED_AT_INVALID";
  if (typeof m.nonce !== "string" || !NONCE_RE.test(m.nonce)) return "NONCE_INVALID";
  if (!Array.isArray(m.files) || !m.files.length || m.files.length > LIMITS.maxFiles) return "FILES_INVALID";
  const seen = new Set();
  for (const f of m.files) {
    if (!f || typeof f !== "object" || Object.keys(f).sort().join(",") !== "path,sha256,size") return "FILE_ENTRY_INVALID";
    if (!cleanBundlePath(f.path)) return "FILE_PATH_UNSAFE";
    if (typeof f.sha256 !== "string" || !SHA_RE.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0) return "FILE_ENTRY_INVALID";
    if (seen.has(f.path) || seen.has(f.path.toLowerCase() + "\0ci")) return "FILE_PATH_DUPLICATE";
    seen.add(f.path); seen.add(f.path.toLowerCase() + "\0ci");                                       // case-colliding names would overwrite each other on Windows/macOS
  }
  return null;
}

export const anchorAddSubject = (keyId, publicKeyB64, components) => "release-anchor-add:" + keyId + ":" + sha(String(publicKeyB64) + "|" + [...components].sort().join(",")).slice(0, 24);
export const anchorRemoveSubject = keyId => "release-anchor-remove:" + keyId;
export const downgradeSubject = (component, digest) => "release-downgrade:" + component + ":" + String(digest).slice(0, 24);

export function createReleaseVerifier({ ownerAuth, stateDir = null, nowFn = () => Date.now(), isStopped = () => false } = {}) {
  if (!ownerAuth || typeof ownerAuth.verifyApproval !== "function" || typeof ownerAuth.verifyRecorded !== "function") throw new Error("OWNER_AUTH_REQUIRED");
  if (stateDir) fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const audit = createAuditChain({ filePath: stateDir ? path.join(stateDir, "release-signing-audit.jsonl") : null, now: () => new Date(nowFn()).toISOString(), headPinFile: stateDir ? path.join(stateDir, "release-signing-audit.headpin.json") : null });
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };
  let integrity = "OK";

  /** Anchors + accepted history, folded from the verified chain. Anchor records must carry a valid owner signature. */
  function state() {
    try { audit.reload(); } catch { integrity = "AUDIT_CHAIN_TAMPERED"; return { anchors: new Map(), accepted: [], tampered: true }; }
    const anchors = new Map(), accepted = []; let bad = 0;
    for (const e of audit.entries()) {
      const d = e.data ?? {};
      if (e.event === "TRUST_ANCHOR_ADDED") {
        const comps = Array.isArray(d.components) ? d.components : [];
        if (keyIdOf(d.publicKeyB64) !== d.keyId || !ownerAuth.verifyRecorded(d.approval, { action: "RELEASE_TRUST_ANCHOR_ADD", subject: anchorAddSubject(d.keyId, d.publicKeyB64, comps) })) { bad++; continue; }
        anchors.set(d.keyId, { keyId: d.keyId, publicKeyB64: d.publicKeyB64, components: comps, label: d.label ?? "" });
      } else if (e.event === "TRUST_ANCHOR_REMOVED") {
        if (!ownerAuth.verifyRecorded(d.approval, { action: "RELEASE_TRUST_ANCHOR_REMOVE", subject: anchorRemoveSubject(d.keyId) })) { bad++; continue; }
        anchors.delete(d.keyId);
      } else if (e.event === "RELEASE_ACCEPTED") accepted.push({ component: d.component, version: d.version, digest: d.digest, nonce: d.nonce, at: e.at });
    }
    integrity = bad ? "UNVERIFIED_ANCHOR_RECORDS_IGNORED:" + bad : "OK";
    return { anchors, accepted, tampered: false };
  }

  function addTrustAnchor({ publicKeyB64, components = [], label = "" } = {}, { ownerApproval = null } = {}) {
    let key; try { key = createPublicKey({ key: Buffer.from(String(publicKeyB64), "base64"), format: "der", type: "spki" }); } catch { throw new Error("PUBLIC_KEY_INVALID"); }
    if (key.asymmetricKeyType !== "ed25519") throw new Error("PUBLISHER_KEY_MUST_BE_ED25519");
    if (!Array.isArray(components) || !components.length || components.length > 20 || !components.every(c => c === "*" || (typeof c === "string" && COMPONENT_RE.test(c)))) throw new Error("COMPONENTS_REQUIRED");
    const keyId = keyIdOf(publicKeyB64), comps = [...new Set(components)].sort();
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "RELEASE_TRUST_ANCHOR_ADD", subject: anchorAddSubject(keyId, publicKeyB64, comps) });
    if (!v.allowed) { audit.append("TRUST_ANCHOR_CHANGE_DENIED", { keyId, reason: v.reason }); throw new Error("OWNER_APPROVAL_REQUIRED:RELEASE_TRUST_ANCHOR_ADD:" + v.reason); }
    audit.append("TRUST_ANCHOR_ADDED", { keyId, publicKeyB64, components: comps, label: String(label).slice(0, 80), approval: ownerApproval });
    return { keyId, components: comps };
  }
  function removeTrustAnchor(keyId, { ownerApproval = null } = {}) {
    if (typeof keyId !== "string" || !KEYID_RE.test(keyId)) throw new Error("KEY_ID_INVALID");
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "RELEASE_TRUST_ANCHOR_REMOVE", subject: anchorRemoveSubject(keyId) });
    if (!v.allowed) { audit.append("TRUST_ANCHOR_CHANGE_DENIED", { keyId, reason: v.reason }); throw new Error("OWNER_APPROVAL_REQUIRED:RELEASE_TRUST_ANCHOR_REMOVE:" + v.reason); }
    const had = state().anchors.has(keyId);
    audit.append("TRUST_ANCHOR_REMOVED", { keyId, approval: ownerApproval });
    return had;
  }

  /** Full check. Returns {ok, verdict, reasons[], component, version, digest}. Never throws, never installs. */
  function verifyBundle(signed, { bundleDir } = {}) {
    const reasons = [], out = extra => ({ ok: reasons.length === 0, verdict: reasons.length ? "REFUSED" : "SIGNATURE_VALID_CONTENT_MATCHES", reasons, ...extra });
    if (!signed || typeof signed !== "object" || !signed.signature || typeof signed.signature !== "object") { reasons.push("UNSIGNED_OR_MALFORMED"); return out({}); }
    if (Object.keys(signed).sort().join(",") !== "manifest,signature") { reasons.push("ENVELOPE_FIELDS_INVALID"); return out({}); }
    const m = signed.manifest, sg = signed.signature;
    const bad = validateManifest(m); if (bad) { reasons.push(bad); return out({}); }
    const digest = manifestDigest(m), info = { component: m.component, version: m.version, digest };
    const st = state();
    if (st.tampered) { reasons.push("AUDIT_CHAIN_TAMPERED"); return out(info); }
    if (sg.alg !== "Ed25519" || typeof sg.keyId !== "string" || typeof sg.value !== "string") { reasons.push("SIGNATURE_FIELDS_INVALID"); return out(info); }
    const anchor = st.anchors.get(sg.keyId);
    if (!anchor) { reasons.push("UNKNOWN_SIGNING_KEY"); return out(info); }
    if (!anchor.components.includes("*") && !anchor.components.includes(m.component)) { reasons.push("KEY_NOT_TRUSTED_FOR_COMPONENT"); return out(info); }
    let sigOk = false;
    try { sigOk = verify(null, Buffer.from(SIG_DOMAIN + canonicalManifest(m)), createPublicKey({ key: Buffer.from(anchor.publicKeyB64, "base64"), format: "der", type: "spki" }), Buffer.from(sg.value, "base64")); } catch { sigOk = false; }
    if (!sigOk) { reasons.push("SIGNATURE_INVALID"); return out(info); }
    if (Date.parse(m.createdAt) > nowFn() + LIMITS.clockSkewMs) reasons.push("CREATED_IN_FUTURE");
    // replay + downgrade against the accepted history of this component
    const hist = st.accepted.filter(a => a.component === m.component);
    if (st.accepted.some(a => a.digest === digest || a.nonce === m.nonce)) reasons.push("REPLAY_OF_ACCEPTED_MANIFEST");
    const last = hist.at(-1);
    if (last && !reasons.includes("REPLAY_OF_ACCEPTED_MANIFEST")) {
      let c; try { c = compareVersions(m.version, last.version); } catch { c = -1; }
      if (c < 0) reasons.push("DOWNGRADE:" + last.version + "->" + m.version);
      else if (c === 0) reasons.push("VERSION_ALREADY_ACCEPTED:" + m.version);
    }
    // the bytes on disk must be exactly the signed set
    if (typeof bundleDir !== "string" || !bundleDir) reasons.push("BUNDLE_DIR_REQUIRED");
    else {
      const h = hashBundle(bundleDir);
      for (const p of h.problems) reasons.push(p.code + ":" + p.path);
      const want = new Map(m.files.map(f => [f.path, f])), have = new Map(h.files.map(f => [f.path, f]));
      for (const [p, f] of want) { const g = have.get(p); if (!g) reasons.push("FILE_MISSING:" + p); else if (g.sha256 !== f.sha256 || g.size !== f.size) reasons.push("FILE_ALTERED:" + p); }
      for (const p of have.keys()) if (!want.has(p)) reasons.push("EXTRA_FILE:" + p);
    }
    return out({ ...info, keyId: sg.keyId });
  }

  /** verify + record as accepted (later replays / downgrades are refused). A downgrade needs downgradeApproval bound to this manifest's digest. */
  function accept(signed, { bundleDir, downgradeApproval = null } = {}) {
    if (stopped()) return { ok: false, verdict: "REFUSED", reasons: ["OWNER_STOP"] };
    const r = verifyBundle(signed, { bundleDir });
    if (!r.ok) {
      const onlyDowngrade = r.reasons.length === 1 && r.reasons[0].startsWith("DOWNGRADE:");
      if (!onlyDowngrade || !downgradeApproval) { try { audit.append("RELEASE_REFUSED", { component: r.component ?? null, version: r.version ?? null, digest: r.digest ?? null, reasons: r.reasons.slice(0, 10) }); } catch { /* still refused */ } return r; }
      const v = ownerAuth.verifyApproval(downgradeApproval, { action: "RELEASE_ALLOW_DOWNGRADE", subject: downgradeSubject(r.component, r.digest) });
      if (!v.allowed) { audit.append("RELEASE_REFUSED", { component: r.component, version: r.version, digest: r.digest, reasons: [...r.reasons, "DOWNGRADE_APPROVAL_INVALID:" + v.reason] }); return { ...r, reasons: [...r.reasons, "DOWNGRADE_APPROVAL_INVALID:" + v.reason] }; }
      r.ok = true; r.verdict = "SIGNATURE_VALID_CONTENT_MATCHES"; r.ownerApprovedDowngrade = true; r.reasons = [];
    }
    audit.append("RELEASE_ACCEPTED", { component: r.component, version: r.version, digest: r.digest, nonce: signed.manifest.nonce, keyId: r.keyId, ownerApprovedDowngrade: Boolean(r.ownerApprovedDowngrade) });
    return { ...r, accepted: true, note: "Accepted for install by the caller. Nothing was installed by this module." };
  }

  const listTrustAnchors = () => [...state().anchors.values()].map(a => ({ ...a }));
  const acceptedVersion = component => state().accepted.filter(a => a.component === component).at(-1)?.version ?? null;
  const summary = () => { const s = state(); return { state: "IMPLEMENTED_NOT_CONNECTED", anchors: s.anchors.size, accepted: s.accepted.length, integrity, auditHead: audit.head() }; };
  return { addTrustAnchor, removeTrustAnchor, listTrustAnchors, verifyBundle, accept, acceptedVersion, summary, auditEntries: () => audit.entries(), auditVerify: () => audit.verifyFile() };
}
