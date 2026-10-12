// ATLASZ portable encrypted backup (USB / external SSD / SD card). One self-contained file: <destination>/atlasz-backup-<ts>-<label>.atlbak
// Format:  MAGIC "ATLBAK1\n" | 4-byte BE header length | header JSON (kdf params, iv, salt, plaintext length) | AES-256-GCM ciphertext | 16-byte tag | 32-byte SHA-256 trailer over everything before it.
// Plaintext payload = gzip(JSON{manifest, files[{path, mode, b64}]}). The key is derived with scrypt from an owner passphrase that is supplied per call and NEVER stored or logged.
// Guarantees:
//  - nothing is written in plaintext to the destination (the payload including state, config, vault ciphertext and the passphrase-encrypted owner key is encrypted);
//  - the file is written as *.partial, fsynced and renamed only when complete -> an interrupted copy is detected (no final name / trailer mismatch);
//  - wrong passphrase or any modified byte fails closed (GCM tag + trailer + per-file SHA-256 in the manifest);
//  - restore never overwrites a non-empty target (it must be empty or absent); restored file modes are preserved where the platform supports them;
//  - temporary/derived files (*.tmp, *.partial, node_modules, .git objects) are excluded from the data sets; symlinks are never followed.
// Honest limit: restoring this file does not restore external accounts (AI providers, GitHub, Stripe...); those need renewed authentication.
import fs from "node:fs"; import path from "node:path";
import zlib from "node:zlib";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const MAGIC = Buffer.from("ATLBAK1\n"), TAG = 16, SHA = 32;
export const PB_LIMITS = Object.freeze({ minPassphrase: 12, maxFiles: 50000, maxBytes: 1024 * 1024 * 1024 });
const sha = b => createHash("sha256").update(b).digest("hex");
const EXCLUDE = /(^|\/)(node_modules|\.git)(\/|$)|\.(tmp|partial|lock)$|(^|\/)\.DS_Store$/;
const KDF = { N: 1 << 15, r: 8, p: 1, keylen: 32 };

function walk(root, base = root, out = []) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walk(full, base, out);
    else if (e.isFile()) { const rel = path.relative(base, full).split(path.sep).join("/"); if (!EXCLUDE.test(rel)) out.push(rel); }
  }
  return out.sort();
}
const keyFor = (pass, salt, kdf) => scryptSync(pass, salt, kdf.keylen, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 });
const needPass = p => { if (typeof p !== "string" || p.length < PB_LIMITS.minPassphrase) throw new Error("PASSPHRASE_TOO_SHORT:min" + PB_LIMITS.minPassphrase); };

/** Destination check: must be an existing directory chosen by the owner (e.g. the USB mount), writable, and not inside any source tree. */
export function checkDestination(dest, sources = []) {
  if (!dest || typeof dest !== "string") return { ok: false, reason: "DESTINATION_REQUIRED" };
  const d = path.resolve(dest);
  if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) return { ok: false, reason: "DESTINATION_NOT_A_DIRECTORY" };
  for (const s of sources) { const a = path.resolve(s); if (d === a || d.startsWith(a + path.sep)) return { ok: false, reason: "DESTINATION_INSIDE_SOURCE" }; }
  try { fs.accessSync(d, fs.constants.W_OK); } catch { return { ok: false, reason: "DESTINATION_NOT_WRITABLE" }; }
  return { ok: true, dir: d };
}

/** sets: [{ name:"state", dir }, { name:"config", dir }, { name:"docs", dir }, ...]; extra: small JSON-able facts (git commit, versions, dependency manifests). */
export function createPortableBackup({ sets, destination, passphrase, label = "manual", extra = {}, now = () => new Date() } = {}) {
  needPass(passphrase);
  if (!Array.isArray(sets) || !sets.length) throw new Error("BACKUP_SETS_REQUIRED");
  const live = sets.filter(s => s?.dir && fs.existsSync(s.dir));
  const dc = checkDestination(destination, live.map(s => s.dir)); if (!dc.ok) throw new Error(dc.reason);
  const files = [], manifestFiles = []; let total = 0;
  for (const s of live) {
    if (!/^[a-z0-9_-]{1,40}$/.test(s.name)) throw new Error("BAD_SET_NAME");
    for (const rel of walk(path.resolve(s.dir)).filter(r => !(s.exclude ?? []).some(x => r === x || r.startsWith(x + "/")))) {
      const abs = path.join(path.resolve(s.dir), rel), st = fs.statSync(abs), buf = fs.readFileSync(abs);
      total += buf.length; if (files.length >= PB_LIMITS.maxFiles || total > PB_LIMITS.maxBytes) throw new Error("BACKUP_TOO_LARGE");
      const p = s.name + "/" + rel; files.push({ path: p, mode: st.mode & 0o777, b64: buf.toString("base64") }); manifestFiles.push({ path: p, size: buf.length, sha256: sha(buf) });
    }
  }
  const at = now(), id = at.toISOString().replace(/[:.]/g, "-") + "_" + String(label).replace(/[^A-Za-z0-9_-]/g, "_");
  const manifest = { format: "ATLBAK1", id, createdAt: at.toISOString(), label, sets: live.map(s => s.name), files: manifestFiles, totalBytes: total, extra, notice: "External accounts (AI providers, GitHub, Stripe, ...) are NOT restored by this file and need renewed authentication." };
  manifest.manifestHash = sha(JSON.stringify({ ...manifest, manifestHash: undefined }));
  const plain = zlib.gzipSync(Buffer.from(JSON.stringify({ manifest, files })));
  const salt = randomBytes(16), iv = randomBytes(12), key = keyFor(passphrase, salt, KDF);
  const c = createCipheriv("aes-256-gcm", key, iv), ct = Buffer.concat([c.update(plain), c.final()]), tag = c.getAuthTag();
  const header = Buffer.from(JSON.stringify({ v: 1, kdf: { name: "scrypt", ...KDF }, salt: salt.toString("hex"), iv: iv.toString("hex"), ctLen: ct.length, id }));
  const hl = Buffer.alloc(4); hl.writeUInt32BE(header.length);
  const body = Buffer.concat([MAGIC, hl, header, ct, tag]), out = Buffer.concat([body, createHash("sha256").update(body).digest()]);
  const final = path.join(dc.dir, "atlasz-backup-" + id + ".atlbak"), part = final + ".partial";
  const fd = fs.openSync(part, "w", 0o600); try { fs.writeSync(fd, out); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(part, final);
  return { file: final, id, files: manifestFiles.length, bytes: out.length, manifestHash: manifest.manifestHash, encrypted: true };
}

function parse(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < MAGIC.length + 4 + TAG + SHA || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("BACKUP_FORMAT_INVALID");
  const body = buf.subarray(0, buf.length - SHA), trailer = buf.subarray(buf.length - SHA);
  if (!timingSafeEqual(createHash("sha256").update(body).digest(), trailer)) throw new Error("BACKUP_INCOMPLETE_OR_CORRUPT");
  const hl = body.readUInt32BE(MAGIC.length), h = JSON.parse(body.subarray(MAGIC.length + 4, MAGIC.length + 4 + hl).toString("utf8"));
  const off = MAGIC.length + 4 + hl, ct = body.subarray(off, off + h.ctLen), tag = body.subarray(off + h.ctLen);
  if (tag.length !== TAG) throw new Error("BACKUP_INCOMPLETE_OR_CORRUPT");
  return { h, ct, tag };
}
function open(file, passphrase) {
  needPass(passphrase); const { h, ct, tag } = parse(file);
  let plain; try { const d = createDecipheriv("aes-256-gcm", keyFor(passphrase, Buffer.from(h.salt, "hex"), h.kdf), Buffer.from(h.iv, "hex")); d.setAuthTag(tag); plain = Buffer.concat([d.update(ct), d.final()]); } catch { throw new Error("WRONG_PASSPHRASE_OR_TAMPERED"); }
  const j = JSON.parse(zlib.gunzipSync(plain).toString("utf8")), problems = [];
  if (sha(JSON.stringify({ ...j.manifest, manifestHash: undefined })) !== j.manifest.manifestHash) problems.push("MANIFEST_HASH_MISMATCH");
  const by = new Map(j.files.map(f => [f.path, f]));
  for (const m of j.manifest.files) { const f = by.get(m.path); if (!f) { problems.push("MISSING:" + m.path); continue; } if (sha(Buffer.from(f.b64, "base64")) !== m.sha256) problems.push("MODIFIED:" + m.path); }
  for (const f of j.files) if (!j.manifest.files.some(m => m.path === f.path)) problems.push("UNEXPECTED:" + f.path);
  return { ...j, problems };
}

/** Integrity check without writing anything. Never returns file contents. */
export function verifyPortableBackup(file, passphrase) {
  try { const r = open(file, passphrase); return { ok: r.problems.length === 0, problems: r.problems, id: r.manifest.id, files: r.manifest.files.length, sets: r.manifest.sets, createdAt: r.manifest.createdAt, extra: r.manifest.extra }; }
  catch (e) { return { ok: false, problems: [String(e.message)] }; }
}

/** targets: { <setName>: <empty-or-absent directory> }. Refuses a non-empty target; removes only what it wrote if anything fails. */
export function restorePortableBackup({ file, passphrase, targets } = {}) {
  const r = open(file, passphrase); if (r.problems.length) throw new Error("RESTORE_ABORTED_BACKUP_INVALID:" + r.problems.slice(0, 3).join(","));
  for (const s of r.manifest.sets) {
    if (!targets?.[s]) throw new Error("TARGET_MISSING:" + s);
    const t = path.resolve(targets[s]); if (fs.existsSync(t) && fs.readdirSync(t).length) throw new Error("TARGET_NOT_EMPTY:" + s);
  }
  const written = [];
  try {
    for (const f of r.files) {
      const [s, ...rest] = f.path.split("/"), rel = rest.join("/"), root = path.resolve(targets[s]), dest = path.resolve(root, rel);
      if (!dest.startsWith(root + path.sep)) throw new Error("PATH_ESCAPE:" + f.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true }); const buf = Buffer.from(f.b64, "base64");
      fs.writeFileSync(dest, buf, { mode: f.mode || 0o600 }); written.push(dest);
      const m = r.manifest.files.find(x => x.path === f.path); if (sha(fs.readFileSync(dest)) !== m.sha256) throw new Error("POST_RESTORE_HASH_MISMATCH:" + f.path);
    }
  } catch (e) { for (const w of written) { try { fs.rmSync(w, { force: true }); } catch { /* best effort cleanup of our own partial output */ } } throw new Error("RESTORE_FAILED_ROLLED_BACK:" + e.message); }
  return { restored: written.length, backupId: r.manifest.id, sets: r.manifest.sets, verified: true, extra: r.manifest.extra, notice: r.manifest.notice };
}
