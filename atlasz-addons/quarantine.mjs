// ATLASZ file / archive quarantine + ransomware canary monitor (23-point item 2: malware / ransomware defence). Local only: no network, no model, no download.
//
//   inspect   pure functions over a Buffer: file type by MAGIC BYTES (not by name), executable / script / macro-capable detection, double extensions and bidi tricks in names,
//             and a self-written ZIP (central directory + local headers, ZIP64) and TAR (ustar / pax / GNU long names) parser that reports archive bombs (entry count,
//             total declared size, compression ratio, nesting depth), zip-slip (absolute or '..' paths, drive letters, backslashes), links (symlink / hardlink entries),
//             special files, encrypted entries, duplicate names, overlapping ZIP entries and central/local header disagreement. Nested archives are inspected recursively;
//             compressed nested data is inflated only with a hard output cap (zlib maxOutputLength), never written to disk.
//   store     quarantineFile / quarantineBuffer copy the bytes into <dir>/files/<sha256>.bin with mode 0400 (read-only, never an exec bit), remove the source (move semantics),
//             and record {sha256, sanitised original name, reason, time, size, type, findings, scan} in a hash-chained audit log. The audit log IS the manifest: state is rebuilt
//             from it on every read; manifest.json is a human-readable export and is never trusted. Nothing in this module executes, opens with a viewer, or imports
//             child_process: quarantined bytes are only ever read for hashing / parsing.
//   scanner   optional pluggable `scanner.scan(path) -> {verdict}`. Default is NONE and the record says "NO_SCANNER_CONFIGURED". A scanner that finds nothing yields
//             "SCANNER_NO_DETECTION" - this module NEVER reports a file as clean or safe.
//   release / delete   only with a signed owner approval (owner-auth.mjs, Ed25519, single use) bound to the file's sha256 (and, for release, to the destination path).
//             The stored bytes are re-hashed first; a tampered store file is refused. Release writes with O_EXCL (never through an existing file or symlink) and mode 0600.
//             Kill switch (isStopped) blocks release and delete; intake into quarantine stays possible because it is containment, not action.
//   canary    createCanaryMonitor plants canary files in a watched folder and compares snapshots: canary modified / deleted / renamed, mass rename, mass entropy jump,
//             ransom-note names and ransomware extensions. It returns an ALERT OBJECT (and calls onAlert). It never kills, signals or suspends any process.
//
// Status honesty: IMPLEMENTED + unit TESTED locally. Not CONNECTED to any runtime intake path (email/download/inbox) yet and not LIVE. Without a configured scanner there is
// no signature/heuristic malware detection at all - only structural checks. Limits: formats other than ZIP / TAR / GZIP-wrapped TAR (7z, RAR, XZ, BZIP2, CAB, ISO, ...) are
// reported UNINSPECTABLE (held, never called safe); the canary monitor samples the first 64 KiB of each file and is polling-based (a fast attacker acts between polls);
// a local attacker with write access to the quarantine folder can delete it (tamper-evident, not tamper-proof).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash, randomBytes } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";

export const LIMITS = Object.freeze({
  maxFileBytes: 256 * 1024 * 1024,      // biggest file accepted into quarantine
  maxInspectBytes: 64 * 1024 * 1024,    // archive inspection works on at most this many bytes
  maxEntries: 10000,                    // archive entries (all nesting levels together)
  maxTotalUncompressed: 1024 * 1024 * 1024,
  maxRatio: 100,                        // uncompressed / compressed, per entry and overall
  maxNestingDepth: 3,                   // archive inside archive inside archive ...
  maxPathDepth: 32, maxNameLength: 255,
  maxNestedInflate: 32 * 1024 * 1024,   // a nested compressed archive is inflated in memory only up to this size
  sanitisedNameLength: 120
});
const sha = b => createHash("sha256").update(b).digest("hex");
const SHA_RE = /^[0-9a-f]{64}$/;

// ------------------------------------------------------------------ type detection (magic bytes)
const EXEC_EXT = new Set(["exe", "dll", "scr", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "msp", "lnk", "hta", "jar", "sh", "bash", "zsh",
  "app", "cpl", "pif", "reg", "scf", "apk", "elf", "so", "dylib", "docm", "xlsm", "pptm", "dotm", "xlam", "ppam", "sys", "drv", "ocx", "gadget", "msc", "inf", "url", "iqy", "chm", "py", "pyw", "pl", "rb", "php", "appimage", "deb", "rpm", "pkg", "dmg"]);
const DOC_EXT = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "jpg", "jpeg", "png", "gif", "bmp", "mp3", "mp4", "avi", "mov", "csv", "odt", "zip", "html", "htm"]);
const ARCHIVE_EXT = new Set(["zip", "jar", "apk", "tar", "tgz", "gz", "7z", "rar", "xz", "bz2", "cab", "iso", "img", "vhd", "vhdx", "arj", "lzh", "z", "zst", "docx", "xlsx", "pptx", "docm", "xlsm", "pptm", "odt", "ods", "odp", "epub"]);

/** Identify a buffer by its leading bytes. Returns {type, executable, archive, macroCapable}. Unknown content is "UNKNOWN" (not "safe"). */
export function sniffType(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? []);
  const at = (off, bytes) => b.length >= off + bytes.length && bytes.every((x, i) => b[off + i] === x);
  const r = (type, o = {}) => ({ type, executable: Boolean(o.exec), archive: Boolean(o.arch), macroCapable: Boolean(o.macro) });
  if (at(0, [0x4d, 0x5a])) return r("PE_WINDOWS_EXECUTABLE", { exec: true });
  if (at(0, [0x7f, 0x45, 0x4c, 0x46])) return r("ELF_EXECUTABLE", { exec: true });
  if (at(0, [0xfe, 0xed, 0xfa, 0xce]) || at(0, [0xfe, 0xed, 0xfa, 0xcf]) || at(0, [0xce, 0xfa, 0xed, 0xfe]) || at(0, [0xcf, 0xfa, 0xed, 0xfe])) return r("MACHO_EXECUTABLE", { exec: true });
  if (at(0, [0xca, 0xfe, 0xba, 0xbe])) return r("MACHO_FAT_OR_JAVA_CLASS", { exec: true });
  if (at(0, [0x00, 0x61, 0x73, 0x6d])) return r("WASM_MODULE", { exec: true });
  if (at(0, [0x64, 0x65, 0x78, 0x0a])) return r("ANDROID_DEX", { exec: true });
  if (at(0, [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00])) return r("WINDOWS_SHORTCUT_LNK", { exec: true });
  if (at(0, [0x23, 0x21])) return r("SCRIPT_SHEBANG", { exec: true });
  if (at(0, [0x50, 0x4b, 0x03, 0x04]) || at(0, [0x50, 0x4b, 0x05, 0x06]) || at(0, [0x50, 0x4b, 0x07, 0x08])) return r("ZIP_ARCHIVE", { arch: true });
  if (at(0, [0x1f, 0x8b])) return r("GZIP", { arch: true });
  if (at(257, [0x75, 0x73, 0x74, 0x61, 0x72])) return r("TAR_ARCHIVE", { arch: true });
  if (at(0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return r("7Z_ARCHIVE", { arch: true });
  if (at(0, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return r("RAR_ARCHIVE", { arch: true });
  if (at(0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return r("XZ", { arch: true });
  if (at(0, [0x42, 0x5a, 0x68])) return r("BZIP2", { arch: true });
  if (at(0, [0x4d, 0x53, 0x43, 0x46])) return r("CAB_ARCHIVE", { arch: true });
  if (at(0x8001, [0x43, 0x44, 0x30, 0x30, 0x31])) return r("ISO9660_IMAGE", { arch: true });
  if (at(0, [0x28, 0xb5, 0x2f, 0xfd])) return r("ZSTD", { arch: true });
  if (at(0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return r("OLE_COMPOUND_DOCUMENT", { macro: true });      // .doc/.xls/.msi: may carry macros or installers
  if (at(0, [0x25, 0x50, 0x44, 0x46])) return r("PDF");
  if (at(0, [0x89, 0x50, 0x4e, 0x47])) return r("PNG");
  if (at(0, [0xff, 0xd8, 0xff])) return r("JPEG");
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return r("GIF");
  return r("UNKNOWN");
}

const BIDI = /[‪-‮⁦-⁩‎‏؜]/u;
const extOf = n => { const m = /\.([A-Za-z0-9]{1,12})$/.exec(n); return m ? m[1].toLowerCase() : ""; };

/** Findings about a NAME alone (double extension, executable extension, bidi override, trailing dots/spaces, very long padding). */
export function nameFindings(name) {
  const out = [], n = String(name ?? "");
  const base = n.split(/[\\/]/).pop() ?? "";
  if (BIDI.test(base)) out.push({ code: "BIDI_CONTROL_IN_NAME", severity: "BLOCK" });                       // "invoice‮fdp.exe" shows as invoiceexe.pdf
  if (/[ .]+$/.test(base) && base.trim() !== "") out.push({ code: "TRAILING_DOT_OR_SPACE_IN_NAME", severity: "WARN" });
  if (/\s{8,}/.test(base)) out.push({ code: "WHITESPACE_PADDING_IN_NAME", severity: "WARN" });            // "report.pdf            .exe"
  const clean = base.replace(/[ .]+$/, ""), parts = clean.split(".");
  const last = parts.length > 1 ? parts.at(-1).toLowerCase().trim() : "", prev = parts.length > 2 ? parts.at(-2).toLowerCase().trim() : "";
  if (last && EXEC_EXT.has(last)) out.push({ code: "EXECUTABLE_EXTENSION:" + last, severity: "WARN" });
  if (last && prev && EXEC_EXT.has(last) && DOC_EXT.has(prev)) out.push({ code: "DOUBLE_EXTENSION:" + prev + "." + last, severity: "BLOCK" });
  return out;
}

/** Content vs name: an executable or script that pretends to be a document. */
export function typeFindings(buf, name) {
  const t = sniffType(buf), ext = extOf(String(name ?? "").replace(/[ .]+$/, "")), out = [];
  if (t.executable) out.push({ code: "EXECUTABLE_CONTENT:" + t.type, severity: "WARN" });
  if (t.executable && ext && !EXEC_EXT.has(ext)) out.push({ code: "EXECUTABLE_DISGUISED_AS:" + ext, severity: "BLOCK" });
  if (t.macroCapable) out.push({ code: "MACRO_CAPABLE_CONTAINER", severity: "WARN" });
  return { type: t, findings: out };
}

/** A safe display/storage name: last path segment only, no control/bidi/format characters, conservative charset, bounded length, never empty, never hidden. */
export function sanitiseName(name) {
  let n = String(name ?? "").normalize("NFKC").split(/[\\/]/).pop() ?? "";
  n = n.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^[._]+/, "").replace(/[ .]+$/, "");
  if (n.length > LIMITS.sanitisedNameLength) { const e = extOf(n); n = n.slice(0, LIMITS.sanitisedNameLength - (e ? e.length + 1 : 0)) + (e ? "." + e : ""); }
  return n || "unnamed";
}

/** Shannon entropy in bits per byte (0..8). Encrypted / compressed data is close to 8. */
export function shannonEntropy(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? []); if (!b.length) return 0;
  const c = new Uint32Array(256); for (const x of b) c[x]++;
  let h = 0; for (const n of c) if (n) { const p = n / b.length; h -= p * Math.log2(p); }
  return h;
}

// ------------------------------------------------------------------ archive inspection (pure; parses headers itself)
/** Validate one archive member path. Returns finding codes (zip-slip, absolute, drive letter, NUL, depth, length). */
export function entryPathFindings(raw, limits = LIMITS) {
  const out = [], p = String(raw ?? "");
  if (!p) out.push("EMPTY_ENTRY_NAME");
  if (p.includes("\0")) out.push("NUL_IN_ENTRY_NAME");
  if (p.includes("\\")) out.push("BACKSLASH_IN_ENTRY_NAME");                                                   // Windows extractors treat it as a separator
  const s = p.replace(/\\/g, "/");
  if (s.startsWith("/") || /^[A-Za-z]:/.test(s) || s.startsWith("//")) out.push("ABSOLUTE_ENTRY_PATH");
  if (s.split("/").some(seg => seg === "..")) out.push("PATH_TRAVERSAL_DOTDOT");
  if (s.split("/").filter(Boolean).length > limits.maxPathDepth) out.push("PATH_TOO_DEEP");
  if (p.length > limits.maxNameLength * 4) out.push("ENTRY_NAME_TOO_LONG");
  if (BIDI.test(p)) out.push("BIDI_CONTROL_IN_ENTRY_NAME");
  return out;
}

function makeCtx(limits) { return { limits: { ...LIMITS, ...limits }, entries: [], findings: [], totalUncompressed: 0, totalCompressed: 0, maxDepthSeen: 0, count: 0 }; }
const add = (ctx, code, severity, where = null) => { if (ctx.findings.length < 500) ctx.findings.push({ code, severity, where }); };

function inspectInto(ctx, buf, depth, label) {
  ctx.maxDepthSeen = Math.max(ctx.maxDepthSeen, depth);
  if (depth > ctx.limits.maxNestingDepth) return add(ctx, "NESTING_TOO_DEEP", "BLOCK", label);
  const t = sniffType(buf);
  if (t.type === "ZIP_ARCHIVE") return inspectZip(ctx, buf, depth, label);
  if (t.type === "TAR_ARCHIVE" || looksLikeTar(buf)) return inspectTar(ctx, buf, depth, label);
  if (t.type === "GZIP") {
    let out;
    try { out = zlib.gunzipSync(buf, { maxOutputLength: ctx.limits.maxNestedInflate }); }
    catch (e) { return add(ctx, e?.code === "ERR_BUFFER_TOO_LARGE" || e instanceof RangeError ? "DECOMPRESSED_SIZE_EXCEEDS_LIMIT" : "GZIP_MALFORMED", "BLOCK", label); }
    if (buf.length && out.length / buf.length > ctx.limits.maxRatio) add(ctx, "COMPRESSION_RATIO_EXCEEDS_LIMIT", "BLOCK", label);
    ctx.totalUncompressed += out.length; ctx.totalCompressed += buf.length;
    if (sniffType(out).archive || looksLikeTar(out)) return inspectInto(ctx, out, depth + 1, label + "!gunzip");
    return;
  }
  if (t.archive) return add(ctx, "UNINSPECTABLE_ARCHIVE_FORMAT:" + t.type, "BLOCK", label);                  // we cannot see inside: never call it safe
}

// ---- ZIP
const u16 = (b, o) => b.readUInt16LE(o), u32 = (b, o) => b.readUInt32LE(o);
const u64 = (b, o) => { const v = b.readBigUInt64LE(o); return v > BigInt(Number.MAX_SAFE_INTEGER) ? Infinity : Number(v); };

function findEocd(b) {
  const min = Math.max(0, b.length - 22 - 0xffff);
  for (let i = b.length - 22; i >= min; i--) if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) return i;
  return -1;
}

function inspectZip(ctx, b, depth, label) {
  const L = ctx.limits, eocd = findEocd(b);
  if (eocd < 0) return add(ctx, "ZIP_NO_END_OF_CENTRAL_DIRECTORY", "BLOCK", label);
  if (u16(b, eocd + 4) !== 0 || u16(b, eocd + 6) !== 0) return add(ctx, "ZIP_MULTI_DISK_UNSUPPORTED", "BLOCK", label);
  let total = u16(b, eocd + 10), cdSize = u32(b, eocd + 12), cdOff = u32(b, eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {                                   // ZIP64: locator sits right before the EOCD
    const loc = eocd - 20;
    if (loc < 0 || u32(b, loc) !== 0x07064b50) return add(ctx, "ZIP64_LOCATOR_MISSING", "BLOCK", label);
    const rec = u64(b, loc + 8);
    if (!Number.isFinite(rec) || rec + 56 > b.length || u32(b, rec) !== 0x06064b50) return add(ctx, "ZIP64_RECORD_MALFORMED", "BLOCK", label);
    total = u64(b, rec + 32); cdSize = u64(b, rec + 40); cdOff = u64(b, rec + 48);
  }
  if (!Number.isFinite(total) || !Number.isFinite(cdSize) || !Number.isFinite(cdOff) || cdOff + cdSize > b.length) return add(ctx, "ZIP_CENTRAL_DIRECTORY_OUT_OF_BOUNDS", "BLOCK", label);
  if (ctx.count + total > L.maxEntries) return add(ctx, "TOO_MANY_ENTRIES", "BLOCK", label);
  const names = new Set(), lower = new Set(), ranges = [];
  let p = cdOff, parsed = 0;
  while (p < cdOff + cdSize) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) { add(ctx, "ZIP_CENTRAL_HEADER_MALFORMED", "BLOCK", label); break; }
    const madeBy = u16(b, p + 4), flags = u16(b, p + 8), method = u16(b, p + 10);
    let csize = u32(b, p + 20), usize = u32(b, p + 24);
    const nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32), ext = u32(b, p + 38);
    let lho = u32(b, p + 42);
    if (p + 46 + nlen + xlen + clen > b.length) { add(ctx, "ZIP_CENTRAL_HEADER_MALFORMED", "BLOCK", label); break; }
    const nameBuf = b.subarray(p + 46, p + 46 + nlen), name = nameBuf.toString((flags & 0x800) ? "utf8" : "latin1");
    // ZIP64 extended information extra field (id 0x0001): only the fields that are 0xFFFFFFFF in the fixed header are present, in this order
    let x = p + 46 + nlen; const xEnd = x + xlen;
    while (x + 4 <= xEnd) {
      const id = u16(b, x), sz = u16(b, x + 2); let q = x + 4;
      if (id === 0x0001) {
        if (usize === 0xffffffff && q + 8 <= x + 4 + sz) { usize = u64(b, q); q += 8; }
        if (csize === 0xffffffff && q + 8 <= x + 4 + sz) { csize = u64(b, q); q += 8; }
        if (lho === 0xffffffff && q + 8 <= x + 4 + sz) { lho = u64(b, q); q += 8; }
      }
      x += 4 + sz;
    }
    p += 46 + nlen + xlen + clen; parsed++; ctx.count++;
    const where = label + "/" + name.slice(0, 200);
    for (const c of entryPathFindings(name, L)) add(ctx, c, "BLOCK", where);
    const isDir = name.endsWith("/"), mode = (ext >>> 16) & 0o170000, unixHost = (madeBy >> 8) === 3;
    if (unixHost && mode === 0o120000) add(ctx, "SYMLINK_ENTRY", "BLOCK", where);
    else if (unixHost && mode && mode !== 0o100000 && mode !== 0o040000) add(ctx, "SPECIAL_FILE_ENTRY", "BLOCK", where);
    if (unixHost && ((ext >>> 16) & 0o6000)) add(ctx, "SETUID_OR_SETGID_BIT", "WARN", where);
    if (flags & 0x1) add(ctx, "ENCRYPTED_ENTRY_CANNOT_BE_INSPECTED", "BLOCK", where);
    if (names.has(name)) add(ctx, "DUPLICATE_ENTRY_NAME", "BLOCK", where); else if (lower.has(name.toLowerCase())) add(ctx, "CASE_COLLIDING_ENTRY_NAME", "WARN", where);
    names.add(name); lower.add(name.toLowerCase());
    if (!Number.isFinite(usize) || !Number.isFinite(csize)) { add(ctx, "ZIP_SIZE_OVERFLOW", "BLOCK", where); continue; }
    ctx.totalUncompressed += usize; ctx.totalCompressed += csize;
    if (usize > 0 && (csize === 0 ? true : usize / csize > L.maxRatio)) add(ctx, "COMPRESSION_RATIO_EXCEEDS_LIMIT", "BLOCK", where);
    if (!isDir) for (const f of nameFindings(name)) if (f.severity === "BLOCK" || f.code.startsWith("EXECUTABLE_EXTENSION")) add(ctx, f.code.startsWith("EXECUTABLE_EXTENSION") ? "EXECUTABLE_INSIDE_ARCHIVE:" + f.code.split(":")[1] : f.code, f.severity, where);
    // local header must exist and agree with the central directory (parser-confusion defence); its data range must not overlap another entry (overlap bombs)
    if (!Number.isFinite(lho) || lho + 30 > b.length || u32(b, lho) !== 0x04034b50) { add(ctx, "ZIP_LOCAL_HEADER_MISSING", "BLOCK", where); continue; }
    const lnlen = u16(b, lho + 26), lxlen = u16(b, lho + 28);
    if (lho + 30 + lnlen > b.length || !b.subarray(lho + 30, lho + 30 + lnlen).equals(nameBuf)) { add(ctx, "ZIP_LOCAL_HEADER_NAME_MISMATCH", "BLOCK", where); continue; }
    if (!(flags & 0x8)) { const lc = u32(b, lho + 18), lu = u32(b, lho + 22), lm = u16(b, lho + 8); if ((lc !== 0xffffffff && lc !== csize) || (lu !== 0xffffffff && lu !== usize) || lm !== method) { add(ctx, "ZIP_LOCAL_HEADER_DISAGREES_WITH_CENTRAL_DIRECTORY", "BLOCK", where); } }      // readers that trust the local header would extract different bytes
    const dStart = lho + 30 + lnlen + lxlen, dEnd = dStart + csize;
    if (dEnd > b.length) { add(ctx, "ZIP_ENTRY_DATA_OUT_OF_BOUNDS", "BLOCK", where); continue; }
    ranges.push([lho, dEnd, where, (flags & 0x8) ? 24 : 0]);
    // nested archive (whatever its name): stored data is inspected directly; deflated data is first sniffed from a small partial inflate, then inflated with a hard output cap
    if (!isDir && csize > 0) {
      let inner = null;
      if (method === 0) inner = b.subarray(dStart, dEnd);
      else if (method === 8) {
        let headOut = null;
        try { headOut = zlib.inflateRawSync(b.subarray(dStart, Math.min(dEnd, dStart + 4096)), { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: 1 << 20 }); } catch { headOut = null; }
        if ((headOut && (sniffType(headOut).archive || looksLikeTar(headOut))) || ARCHIVE_EXT.has(extOf(name))) {
          try { inner = zlib.inflateRawSync(b.subarray(dStart, dEnd), { maxOutputLength: Math.min(L.maxNestedInflate, Math.max(usize, 1)) }); }
          catch { add(ctx, "NESTED_ARCHIVE_INFLATE_REFUSED_OR_FAILED", "BLOCK", where); }
        }
      } else if (ARCHIVE_EXT.has(extOf(name))) add(ctx, "NESTED_ARCHIVE_METHOD_UNSUPPORTED:" + method, "BLOCK", where);
      if (inner && (sniffType(inner).archive || looksLikeTar(inner))) { add(ctx, "NESTED_ARCHIVE", "WARN", where); inspectInto(ctx, inner, depth + 1, where); }
      else if (inner && sniffType(inner).executable) add(ctx, "EXECUTABLE_INSIDE_ARCHIVE:" + sniffType(inner).type, "WARN", where);
    }
    if (ctx.totalUncompressed > L.maxTotalUncompressed) { add(ctx, "TOTAL_UNCOMPRESSED_SIZE_EXCEEDS_LIMIT", "BLOCK", label); break; }
  }
  if (parsed !== total) add(ctx, "ZIP_ENTRY_COUNT_MISMATCH", "BLOCK", label);
  ranges.sort((a, c) => a[0] - c[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) { add(ctx, "ZIP_OVERLAPPING_ENTRIES", "BLOCK", ranges[i][2]); break; }
  // Every byte before the central directory must belong to a listed entry (plus its data descriptor): a streaming extractor reads LOCAL headers in order and would also extract an entry the central directory never lists.
  { let pos = 0, slack = 0, bad = false; for (const r of ranges) { if (r[0] > pos + slack) { bad = true; break; } pos = Math.max(pos, r[1]); slack = r[3]; } if (!bad && cdOff > pos + slack) bad = true; if (bad) add(ctx, "ZIP_UNLISTED_BYTES_BEFORE_CENTRAL_DIRECTORY", "BLOCK", label); }
  if (ctx.totalCompressed > 0 && ctx.totalUncompressed / ctx.totalCompressed > L.maxRatio) add(ctx, "OVERALL_COMPRESSION_RATIO_EXCEEDS_LIMIT", "BLOCK", label);
}

// ---- TAR
const tarChecksumOk = h => {
  let s = 0; for (let i = 0; i < 512; i++) s += i >= 148 && i < 156 ? 32 : h[i];
  const stored = parseOctal(h.subarray(148, 156));
  return stored !== null && stored === s;
};
function parseOctal(f) {
  if (f[0] & 0x80) {                                                                                          // GNU base-256 for big values
    let v = 0n; for (let i = 1; i < f.length; i++) v = (v << 8n) | BigInt(f[i]);
    v |= BigInt(f[0] & 0x7f) << BigInt(8 * (f.length - 1));
    return v > BigInt(Number.MAX_SAFE_INTEGER) ? Infinity : Number(v);
  }
  const s = f.toString("latin1").replace(/\0.*$/s, "").trim();
  if (!s) return 0;
  if (!/^[0-7]+$/.test(s)) return null;
  return parseInt(s, 8);
}
function looksLikeTar(b) { return b.length >= 512 && !b.subarray(0, 512).every(x => x === 0) && tarChecksumOk(b.subarray(0, 512)); }
const cstr = f => f.toString("utf8").replace(/\0.*$/s, "");


/** Parse a pax extended header by its length prefixes. Returns {ok, rec}; any inconsistency is ok:false (the caller BLOCKs). */
function parsePax(data) {
  const rec = Object.create(null); let i = 0;
  while (i < data.length) {
    let j = i; while (j < data.length && data[j] >= 0x30 && data[j] <= 0x39 && j - i < 8) j++;
    if (j === i || data[j] !== 0x20) return { ok: false };
    const len = Number(data.subarray(i, j).toString("latin1")); if (!Number.isInteger(len) || len < j - i + 4 || i + len > data.length || data[i + len - 1] !== 0x0a) return { ok: false };
    const body = data.subarray(j + 1, i + len - 1).toString("utf8"), eq = body.indexOf("="); if (eq <= 0) return { ok: false };
    const k = body.slice(0, eq); if (k in rec) return { ok: false }; rec[k] = body.slice(eq + 1); i += len;
  }
  return { ok: true, rec };
}
function inspectTar(ctx, b, depth, label) {
  const L = ctx.limits; let off = 0, pending = {}, zeros = 0;
  const names = new Set();
  while (off + 512 <= b.length) {
    const h = b.subarray(off, off + 512);
    if (h.every(x => x === 0)) { if (++zeros >= 2) break; off += 512; continue; }
    zeros = 0;
    if (!tarChecksumOk(h)) { add(ctx, "TAR_HEADER_CHECKSUM_INVALID", "BLOCK", label + "@" + off); return; }
    const size = parseOctal(h.subarray(124, 136)), type = String.fromCharCode(h[156] || 0x30), mode = parseOctal(h.subarray(100, 108)) ?? 0;
    if (size === null || !Number.isFinite(size)) { add(ctx, "TAR_SIZE_INVALID", "BLOCK", label + "@" + off); return; }
    const dataStart = off + 512, dataEnd = dataStart + size, next = dataStart + Math.ceil(size / 512) * 512;
    if (dataEnd > b.length) { add(ctx, "TAR_ENTRY_DATA_OUT_OF_BOUNDS", "BLOCK", label + "@" + off); return; }
    const data = b.subarray(dataStart, dataEnd);
    // metadata records that modify the NEXT header. pax records are "<len> <key>=<value>\n" where <len> counts the whole record: parse by that length, never by lines
    // (a value may itself contain newlines; a line-based parser sees a different path than tar does).
    if (type === "x" || type === "g") {
      const px = parsePax(data); if (!px.ok) { add(ctx, "TAR_PAX_RECORD_MALFORMED", "BLOCK", label + "@" + off); return; }
      for (const k of Object.keys(px.rec)) {
        if (/^GNU\.sparse\./i.test(k)) { add(ctx, "TAR_PAX_SPARSE_OVERRIDE", "BLOCK", label + "@" + off); return; }       // sparse maps rename/resize members in GNU tar and Python; not supported, so not accepted
        if (!/^(?:mtime|atime|ctime|uid|gid|uname|gname|comment|charset|hdrcharset|path|linkpath|size|SCHILY\.[\w.-]+|LIBARCHIVE\.[\w.-]+)$/.test(k)) { add(ctx, "TAR_PAX_UNKNOWN_KEY", "BLOCK", label + "@" + off); return; }
      }
      if (type === "x" && (pending.name !== undefined || pending.link !== undefined)) { add(ctx, "TAR_MULTIPLE_EXTENDED_HEADERS", "BLOCK", label + "@" + off); return; }      // a GNU long-name/link header stacked with a pax header: implementations disagree which wins
      if (type === "x" && pending.xSeen) { add(ctx, "TAR_MULTIPLE_EXTENDED_HEADERS", "BLOCK", label + "@" + off); return; }      // tar implementations disagree on which of two stacked extended headers wins
      if (type === "x") pending.xSeen = true;
      if (type === "x") { if (px.rec.path !== undefined) pending.name = px.rec.path; if (px.rec.linkpath !== undefined) pending.link = px.rec.linkpath; if (px.rec.size !== undefined) { if (!/^\d{1,15}$/.test(px.rec.size)) { add(ctx, "TAR_PAX_SIZE_INVALID", "BLOCK", label + "@" + off); return; } pending.size = Number(px.rec.size); } }
      else { if (Object.keys(px.rec).some(k => ["path", "linkpath", "size"].includes(k))) add(ctx, "TAR_GLOBAL_PAX_OVERRIDE_IGNORED", "BLOCK", label + "@" + off); }      // a pending extended header is NOT cleared by a global one: real tools still apply it to the next entry          // global headers are not applied; an override in one is itself suspicious
      off = next; continue;
    }
    if ((type === "L" || type === "K") && (pending.name !== undefined || pending.link !== undefined || pending.xSeen)) { add(ctx, "TAR_MULTIPLE_EXTENDED_HEADERS", "BLOCK", label + "@" + off); return; }
    if (type === "L") { pending.name = cstr(data); off = next; continue; }
    if (type === "K") { pending.link = cstr(data); off = next; continue; }
    const prefix = h.subarray(257, 262).toString("latin1") === "ustar" ? cstr(h.subarray(345, 500)) : "";
    const name = pending.name ?? ((prefix ? prefix + "/" : "") + cstr(h.subarray(0, 100)));
    const link = pending.link ?? cstr(h.subarray(157, 257));
    const realSize = Number.isFinite(pending.size) ? pending.size : size;
    if (Number.isFinite(pending.size) && pending.size !== size) { add(ctx, "TAR_PAX_SIZE_DIFFERS_FROM_HEADER", "BLOCK", label + "/" + name.slice(0, 200)); return; }      // tar implementations disagree about which one wins: nothing after this point can be trusted
    if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(name.replace(/\0+$/, ""))) add(ctx, "CONTROL_CHARACTER_IN_ENTRY_NAME", "BLOCK", label + "/" + JSON.stringify(name).slice(0, 200));
    pending = {};
    ctx.count++;
    if (ctx.count > L.maxEntries) { add(ctx, "TOO_MANY_ENTRIES", "BLOCK", label); return; }
    const where = label + "/" + name.slice(0, 200);
    for (const c of entryPathFindings(name, L)) add(ctx, c, "BLOCK", where);
    if (type === "2") add(ctx, "SYMLINK_ENTRY", "BLOCK", where + " -> " + link.slice(0, 100));
    else if (type === "1") add(ctx, "HARDLINK_ENTRY", "BLOCK", where + " -> " + link.slice(0, 100));
    else if ("3467".includes(type)) add(ctx, "SPECIAL_FILE_ENTRY", "BLOCK", where);
    else if (!"05".includes(type) && type !== "\0") add(ctx, "UNKNOWN_TAR_ENTRY_TYPE:" + type.charCodeAt(0), "BLOCK", where);
    if (mode & 0o6000) add(ctx, "SETUID_OR_SETGID_BIT", "WARN", where);
    if (names.has(name)) add(ctx, "DUPLICATE_ENTRY_NAME", "BLOCK", where); names.add(name);
    ctx.totalUncompressed += realSize;
    if (ctx.totalUncompressed > L.maxTotalUncompressed) { add(ctx, "TOTAL_UNCOMPRESSED_SIZE_EXCEEDS_LIMIT", "BLOCK", label); return; }
    if (type !== "5") {
      for (const f of nameFindings(name)) if (f.severity === "BLOCK" || f.code.startsWith("EXECUTABLE_EXTENSION")) add(ctx, f.code.startsWith("EXECUTABLE_EXTENSION") ? "EXECUTABLE_INSIDE_ARCHIVE:" + f.code.split(":")[1] : f.code, f.severity, where);
      if (data.length && (sniffType(data).archive || looksLikeTar(data))) { add(ctx, "NESTED_ARCHIVE", "WARN", where); inspectInto(ctx, data, depth + 1, where); }
      else if (sniffType(data).executable) add(ctx, "EXECUTABLE_INSIDE_ARCHIVE:" + sniffType(data).type, "WARN", where);
    }
    off = next;
  }
}

/** Inspect an archive buffer. Pure: no file system, no network. verdict: BLOCK (a blocking finding), REVIEW (warnings only), NO_STRUCTURAL_FINDINGS (never "clean"), NOT_AN_ARCHIVE. */
export function inspectArchive(buf, { name = "archive", limits = {} } = {}) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? []), ctx = makeCtx(limits);
  if (b.length > ctx.limits.maxInspectBytes) return { verdict: "BLOCK", format: sniffType(b).type, findings: [{ code: "ARCHIVE_TOO_LARGE_TO_INSPECT", severity: "BLOCK", where: name }], entries: 0, totalUncompressed: 0, nestingDepth: 0 };
  const t = sniffType(b);
  if (!t.archive && !looksLikeTar(b)) return { verdict: "NOT_AN_ARCHIVE", format: t.type, findings: [], entries: 0, totalUncompressed: 0, nestingDepth: 0 };
  try { inspectInto(ctx, b, 0, sanitiseName(name)); }
  catch (e) { add(ctx, "ARCHIVE_PARSE_ERROR:" + String(e?.code ?? e?.name ?? "ERR").slice(0, 40), "BLOCK", name); }      // any parser surprise fails closed
  const verdict = ctx.findings.some(f => f.severity === "BLOCK") ? "BLOCK" : ctx.findings.length ? "REVIEW" : "NO_STRUCTURAL_FINDINGS";
  return { verdict, format: t.archive ? t.type : "TAR_ARCHIVE", findings: ctx.findings, entries: ctx.count, totalUncompressed: ctx.totalUncompressed, nestingDepth: ctx.maxDepthSeen };
}

/** Pure pre-scan used by intake paths (document ingest, inbox, downloads): { blocking, findings } from the name, the sniffed type and the archive structure. No I/O. */
export function prescan(buf, name = "unnamed", { limits = {} } = {}) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? []), L = { ...LIMITS, ...limits };
  const tf = typeFindings(b, name), arch = tf.type.archive || looksLikeTar(b) ? inspectArchive(b, { name, limits: L }) : null;
  // Intake paths (documents, update payloads) never legitimately carry native executables: binary executable content (PE/ELF/Mach-O), directly or inside an archive, blocks regardless of the file name.
  const findings = [...nameFindings(name), ...tf.findings, ...(arch?.findings ?? [])].slice(0, 200).map(f => (/^EXECUTABLE_CONTENT:|^EXECUTABLE_INSIDE_ARCHIVE:\w+_EXECUTABLE/.test(f.code) ? { ...f, severity: "BLOCK" } : f));
  return { blocking: findings.some(f => f.severity === "BLOCK"), findings, type: tf.type.type, archive: arch ? arch.verdict : null };
}

// ------------------------------------------------------------------ quarantine store
export const releaseSubject = (sha256, destPath) => "quarantine-release:" + sha256 + ":" + sha(path.resolve(String(destPath))).slice(0, 16);
export const deleteSubject = sha256 => "quarantine-delete:" + sha256;
const SCAN_STATES = new Set(["SCANNER_DETECTED", "SCANNER_NO_DETECTION", "SCANNER_ERROR"]);

export function createQuarantine({ dir, ownerAuth = null, scanner = null, isStopped = () => false, nowFn = () => Date.now(), limits = {}, scanTimeoutMs = 30000 } = {}) {
  if (!dir) throw new Error("QUARANTINE_DIR_REQUIRED");
  const L = { ...LIMITS, ...limits };
  const filesDir = path.join(dir, "files");
  fs.mkdirSync(filesDir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); fs.chmodSync(filesDir, 0o700); } catch { /* best effort on non-POSIX */ }
  const audit = createAuditChain({ filePath: path.join(dir, "quarantine-audit.jsonl"), now: () => new Date(nowFn()).toISOString() });
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };      // a broken stop check counts as stopped
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  const storePath = h => path.join(filesDir, h + ".bin");
  let dWin = { t: 0, n: 0 };
  const auditDenied = (event, data) => { const t = nowFn(); if (t - dWin.t >= 60000) dWin = { t, n: 0 }; if (dWin.n++ < 30) { try { audit.append(event, data); } catch { /* still refused */ } } };

  /** Current state, rebuilt from the verified audit chain only. */
  function state() {
    audit.reload();                                                                                           // throws AUDIT_CHAIN_TAMPERED on any edit
    const m = new Map();
    for (const e of audit.entries()) {
      const d = e.data ?? {};
      if (e.event === "QUARANTINE_ADDED" && SHA_RE.test(d.sha256 ?? "")) {
        const prev = m.get(d.sha256);
        m.set(d.sha256, { ...d, status: "QUARANTINED", occurrences: (prev?.status === "QUARANTINED" ? prev.occurrences : 0) + 1, firstAt: prev?.status === "QUARANTINED" ? prev.firstAt : e.at });
      } else if ((e.event === "QUARANTINE_RELEASED" || e.event === "QUARANTINE_DELETED") && m.has(d.sha256)) m.set(d.sha256, { ...m.get(d.sha256), status: e.event === "QUARANTINE_RELEASED" ? "RELEASED" : "DELETED", closedAt: e.at });
    }
    return m;
  }
  const exportManifest = () => {                                                                              // human-readable export; NEVER read back as truth
    try { const t = path.join(dir, "manifest.json." + randomBytes(4).toString("hex") + ".tmp"); fs.writeFileSync(t, JSON.stringify({ note: "export only; truth is quarantine-audit.jsonl", items: [...state().values()] }, null, 1), { mode: 0o600, flag: "wx" }); fs.renameSync(t, path.join(dir, "manifest.json")); } catch { /* export is optional */ }
  };

  async function runScanner(file) {
    if (!scanner) return { status: "NO_SCANNER_CONFIGURED", engine: null, detail: "No malware scanner is configured; only structural checks ran. This is NOT a clean result." };
    if (typeof scanner.scan !== "function") return { status: "SCANNER_ERROR", engine: null, detail: "scanner has no scan()" };
    let timer;
    try {
      const r = await Promise.race([Promise.resolve().then(() => scanner.scan(file)), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("SCAN_TIMEOUT")), scanTimeoutMs); })]);      // referenced on purpose: a hung scanner must still end in SCANNER_ERROR
      const v = String(r?.verdict ?? "").toUpperCase();
      const status = ["INFECTED", "DETECTED", "MALICIOUS", "SCANNER_DETECTED"].includes(v) ? "SCANNER_DETECTED" : ["NO_DETECTION", "NOT_DETECTED", "CLEAN", "OK", "SCANNER_NO_DETECTION"].includes(v) ? "SCANNER_NO_DETECTION" : "SCANNER_ERROR";
      return { status, engine: String(scanner.name ?? "custom").slice(0, 60), detail: status === "SCANNER_NO_DETECTION" ? "The configured scanner reported no detection. That is not proof the file is safe." : String(r?.detail ?? v).slice(0, 200) };
    } catch (e) { return { status: "SCANNER_ERROR", engine: String(scanner.name ?? "custom").slice(0, 60), detail: String(e?.message ?? e).slice(0, 120) }; }
    finally { clearTimeout(timer); }
  }

  /** Store bytes read-only under their hash. Returns the stored path. Writes through a fresh temp file opened with O_EXCL; never follows a pre-planted file. */
  function storeBytes(buf, h) {
    const dest = storePath(h);
    if (fs.existsSync(dest)) { if (sha(fs.readFileSync(dest)) === h) return dest; fs.chmodSync(dest, 0o600); fs.unlinkSync(dest); }      // a damaged copy is replaced by the real bytes
    const t = path.join(filesDir, h + "." + randomBytes(4).toString("hex") + ".tmp");
    const fd = fs.openSync(t, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o400);
    try { fs.writeSync(fd, buf); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.chmodSync(t, 0o400); fs.renameSync(t, dest);
    if (sha(fs.readFileSync(dest)) !== h) throw new Error("QUARANTINE_WRITE_VERIFY_FAILED");
    return dest;
  }

  async function intake(buf, { name, reason, source }) {
    if (typeof reason !== "string" || !reason.trim() || reason.length > 300) return fail("REASON_REQUIRED");
    if (buf.length > L.maxFileBytes) return fail("FILE_TOO_LARGE_FOR_QUARANTINE");
    const h = sha(buf);
    const nf = nameFindings(name), tf = typeFindings(buf, name);
    const arch = tf.type.archive || looksLikeTar(buf) ? inspectArchive(buf, { name, limits: L }) : null;      // too-large archives come back as BLOCK, never skipped
    const stored = storeBytes(buf, h);
    const scan = await runScanner(stored);
    const findings = [...nf, ...tf.findings, ...(arch?.findings ?? [])].slice(0, 200);
    const blocking = findings.some(f => f.severity === "BLOCK") || scan.status === "SCANNER_DETECTED";
    const rec = {
      sha256: h, size: buf.length, originalName: sanitiseName(name), reason: reason.trim().slice(0, 300), source: source ? String(source).slice(0, 120) : null,
      quarantinedAt: new Date(nowFn()).toISOString(), type: tf.type.type, executable: tf.type.executable, archive: arch ? { verdict: arch.verdict, format: arch.format, entries: arch.entries, totalUncompressed: arch.totalUncompressed, nestingDepth: arch.nestingDepth } : null,
      findings, scan, assessment: blocking ? "HIGH_RISK_HOLD" : findings.length ? "SUSPICIOUS_HOLD" : "HELD_NO_FINDINGS_NOT_PROVEN_SAFE"
    };
    audit.append("QUARANTINE_ADDED", rec); exportManifest();
    return { ok: true, record: rec };
  }

  /** Move a file into quarantine. The source must be a regular file (symlinks are refused, never followed). The source is removed after the stored copy is verified. */
  async function quarantineFile(srcPath, { reason, originalName = null, keepSource = false } = {}) {
    let st; try { st = fs.lstatSync(srcPath); } catch { return fail("SOURCE_NOT_FOUND"); }
    if (st.isSymbolicLink()) return fail("SOURCE_IS_SYMLINK_REFUSED");
    if (!st.isFile()) return fail("SOURCE_NOT_A_REGULAR_FILE");
    if (st.size > L.maxFileBytes) return fail("FILE_TOO_LARGE_FOR_QUARANTINE");
    let buf, fd;
    try { fd = fs.openSync(srcPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)); const fst = fs.fstatSync(fd); if (!fst.isFile() || fst.ino !== st.ino) return fail("SOURCE_CHANGED_DURING_INTAKE"); buf = fs.readFileSync(fd); }
    catch { return fail("SOURCE_UNREADABLE"); } finally { if (fd !== undefined) fs.closeSync(fd); }
    const r = await intake(buf, { name: originalName ?? path.basename(srcPath), reason, source: "file" });
    if (r.ok && !keepSource) { try { fs.unlinkSync(srcPath); r.sourceRemoved = true; } catch { r.sourceRemoved = false; } }
    return r;
  }
  /** Quarantine bytes that never touched the disk (attachment, download stream already in memory). */
  const quarantineBuffer = (buf, { name = "unnamed", reason, source = "buffer" } = {}) => {
    if (!Buffer.isBuffer(buf) && !(buf instanceof Uint8Array)) return Promise.resolve(fail("BUFFER_REQUIRED"));
    return intake(Buffer.from(buf), { name, reason, source });
  };

  function verifyStored(h) { try { return sha(fs.readFileSync(storePath(h))) === h; } catch { return false; } }

  function release(sha256, { destPath, ownerApproval = null } = {}) {
    if (stopped()) return fail("OWNER_STOP_ACTIVE");
    if (typeof sha256 !== "string" || !SHA_RE.test(sha256)) return fail("SHA256_INVALID");
    if (typeof destPath !== "string" || !destPath) return fail("DEST_REQUIRED");
    if (!ownerAuth || typeof ownerAuth.verifyApproval !== "function") return fail("OWNER_AUTH_NOT_CONFIGURED");
    const rec = state().get(sha256);
    if (!rec || rec.status !== "QUARANTINED") return fail("NOT_IN_QUARANTINE");
    if (!verifyStored(sha256)) { auditDenied("QUARANTINE_RELEASE_DENIED", { sha256, reason: "STORED_FILE_TAMPERED_OR_MISSING" }); return fail("STORED_FILE_TAMPERED_OR_MISSING"); }
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "QUARANTINE_RELEASE", subject: releaseSubject(sha256, destPath) });
    if (!v.allowed) { auditDenied("QUARANTINE_RELEASE_DENIED", { sha256, reason: v.reason }); return fail("OWNER_APPROVAL_REQUIRED", { detail: v.reason }); }
    const buf = fs.readFileSync(storePath(sha256));
    if (sha(buf) !== sha256) return fail("STORED_FILE_TAMPERED_OR_MISSING");
    let fd;
    try { fd = fs.openSync(path.resolve(destPath), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600); fs.writeSync(fd, buf); fs.fsyncSync(fd); }
    catch (e) { audit.append("QUARANTINE_RELEASE_FAILED", { sha256, reason: String(e?.code ?? "WRITE_FAILED") }); return fail("DEST_WRITE_FAILED", { detail: String(e?.code ?? "") }); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
    try { fs.chmodSync(path.resolve(destPath), 0o600); } catch { /* non-POSIX */ }
    try { fs.chmodSync(storePath(sha256), 0o600); fs.unlinkSync(storePath(sha256)); } catch { /* the record still says RELEASED */ }
    audit.append("QUARANTINE_RELEASED", { sha256, dest: sha(path.resolve(destPath)).slice(0, 16), nonce: ownerApproval.nonce, assessmentAtRelease: rec.assessment });
    exportManifest();
    return { ok: true, sha256, released: true, warning: rec.assessment !== "HELD_NO_FINDINGS_NOT_PROVEN_SAFE" ? "Released despite findings: " + rec.findings.map(f => f.code).slice(0, 5).join(", ") : "Released. No findings is not proof of safety." };
  }

  function remove(sha256, { ownerApproval = null } = {}) {
    if (stopped()) return fail("OWNER_STOP_ACTIVE");
    if (typeof sha256 !== "string" || !SHA_RE.test(sha256)) return fail("SHA256_INVALID");
    if (!ownerAuth || typeof ownerAuth.verifyApproval !== "function") return fail("OWNER_AUTH_NOT_CONFIGURED");
    const rec = state().get(sha256);
    if (!rec || rec.status !== "QUARANTINED") return fail("NOT_IN_QUARANTINE");
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "QUARANTINE_DELETE", subject: deleteSubject(sha256) });
    if (!v.allowed) { auditDenied("QUARANTINE_DELETE_DENIED", { sha256, reason: v.reason }); return fail("OWNER_APPROVAL_REQUIRED", { detail: v.reason }); }
    try { fs.chmodSync(storePath(sha256), 0o600); fs.unlinkSync(storePath(sha256)); } catch { /* already gone: the record is closed anyway */ }
    audit.append("QUARANTINE_DELETED", { sha256, nonce: ownerApproval.nonce }); exportManifest();
    return { ok: true, sha256, deleted: true };
  }

  const list = () => [...state().values()].map(r => ({ ...r, storedIntact: r.status === "QUARANTINED" ? verifyStored(r.sha256) : null }));
  const get = h => { const r = state().get(h); return r ? { ...r, storedIntact: r.status === "QUARANTINED" ? verifyStored(h) : null } : null; };
  function verify() {
    let chain; try { audit.reload(); chain = audit.verify(); } catch (e) { return { ok: false, reason: String(e.message) }; }
    const bad = [], loose = [];
    const s = state();
    for (const r of s.values()) if (r.status === "QUARANTINED" && !verifyStored(r.sha256)) bad.push(r.sha256);
    for (const f of fs.readdirSync(filesDir)) { const h = f.replace(/\.bin$/, ""); if (!s.has(h) || s.get(h).status !== "QUARANTINED") loose.push(f); }
    const modes = [...s.values()].filter(r => r.status === "QUARANTINED").map(r => { try { return fs.statSync(storePath(r.sha256)).mode & 0o777; } catch { return null; } });
    return { ok: chain.ok && !bad.length && !loose.length, chain, tampered: bad, unrecorded: loose, anyExecBit: modes.some(m => m !== null && (m & 0o111) !== 0) };
  }
  const status = () => ({ state: "IMPLEMENTED_LOCAL_NOT_CONNECTED", scanner: scanner ? "SCANNER_CONFIGURED_UNTESTED" : "NO_SCANNER_CONFIGURED", held: [...state().values()].filter(r => r.status === "QUARANTINED").length, auditHead: audit.head(), executes: false });
  return { quarantineFile, quarantineBuffer, release, remove, list, get, verify, status, auditEntries: () => audit.entries() };
}

// ------------------------------------------------------------------ ransomware canary monitor
export const RANSOM_NOTE_RE = /^(?:readme|how|help|restore|recover|decrypt)[_ -]?(?:to[_ -]?)?(?:decrypt|restore|recover|files|instructions?)?.*\.(?:txt|html?|hta|url)$|^_?(?:readme|read_me|decrypt|ransom)[^/]*\.(?:txt|html?|hta)$/i;
export const RANSOM_EXT_RE = /\.(?:locked|encrypted|enc|crypt|crypted|cry|crypto|locky|zepto|cerber\d?|wncry|wnry|wcry|ryk|ryuk|conti|lockbit|abcd|djvu|stop|phobos|makop|dharma|aes256|pay2key|ransom)$/i;
const CANARY_MARK = "ATLASZ-CANARY-v1";

/** Watch one folder. plant() writes canary files, baseline() records the folder, check() compares and returns an alert object. Never touches processes. */
export function createCanaryMonitor({ watchDir, stateDir = null, canaryCount = 3, maxFiles = 5000, maxDepth = 2, sampleBytes = 65536, entropyJump = 1.5, highEntropy = 7.2, massFraction = 0.3, massMin = 3, onAlert = null, nowFn = () => Date.now() } = {}) {
  if (!watchDir) throw new Error("WATCH_DIR_REQUIRED");
  fs.mkdirSync(watchDir, { recursive: true });
  const audit = createAuditChain({ filePath: stateDir ? path.join(stateDir, "canary-audit.jsonl") : null, now: () => new Date(nowFn()).toISOString() });
  let canaries = [], base = null, timer = null;

  /** Walk without following links; sample the first bytes of each regular file. */
  function snapshot() {
    const files = new Map(); let truncated = false;
    const walk = (d, depth) => {
      let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (files.size >= maxFiles) { truncated = true; return; }
        const p = path.join(d, e.name), rel = path.relative(watchDir, p);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) { if (depth < maxDepth) walk(p, depth + 1); continue; }
        if (!e.isFile()) continue;
        let st, sample;
        try { st = fs.lstatSync(p); const fd = fs.openSync(p, "r"); try { sample = Buffer.alloc(Math.min(sampleBytes, st.size)); fs.readSync(fd, sample, 0, sample.length, 0); } finally { fs.closeSync(fd); } } catch { continue; }
        files.set(rel, { ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, sampleSha: sha(sample), entropy: shannonEntropy(sample) });
      }
    };
    walk(watchDir, 0);
    return { files, truncated, at: nowFn() };
  }

  /** Write canary files (low-entropy recognisable text; plausible names so a ransomware sweep hits them). */
  function plant({ names = null } = {}) {
    const wanted = names ?? Array.from({ length: canaryCount }, (_, i) => ["000-budget-", "aaa-contracts-", "zzz-backup-notes-"][i % 3] + randomBytes(3).toString("hex") + ".txt");
    canaries = [];
    for (const n of wanted) {
      const safe = sanitiseName(n), p = path.join(watchDir, safe);
      const body = CANARY_MARK + "\nThis is an ATLASZ ransomware canary file. Do not edit, move or delete it.\n" + "canary ".repeat(64) + "\n";
      fs.writeFileSync(p, body, { flag: "wx", mode: 0o600 });
      canaries.push({ name: safe, sha256: sha(Buffer.from(body)) });
    }
    audit.append("CANARIES_PLANTED", { count: canaries.length, names: canaries.map(c => c.name) });
    return canaries.map(c => c.name);
  }
  function baseline() { base = snapshot(); audit.append("CANARY_BASELINE", { files: base.files.size, truncated: base.truncated }); return { files: base.files.size, truncated: base.truncated }; }

  function check() {
    if (!base) return { alert: true, severity: "WARN", signals: [{ code: "NO_BASELINE" }], processActions: "NONE", at: new Date(nowFn()).toISOString() };
    const now = snapshot(), signals = [];
    const byIno = new Map([...now.files].map(([k, v]) => [v.ino, k]));
    for (const c of canaries) {
      const cur = now.files.get(c.name), was = base.files.get(c.name);
      if (!cur) {
        const moved = was ? byIno.get(was.ino) : undefined;
        signals.push(moved !== undefined ? { code: "CANARY_RENAMED", file: c.name, to: moved } : { code: "CANARY_DELETED", file: c.name });
        if (moved !== undefined && now.files.get(moved)?.sampleSha !== was.sampleSha) signals.push({ code: "CANARY_MODIFIED", file: moved });
      } else if (!was || cur.sampleSha !== was.sampleSha || cur.size !== was.size) signals.push({ code: "CANARY_MODIFIED", file: c.name });
    }
    // folder-wide behaviour
    let renamed = 0, jumped = 0, compared = 0, deleted = 0;
    for (const [rel, was] of base.files) {
      const cur = now.files.get(rel);
      if (!cur) { const to = byIno.get(was.ino); if (to !== undefined && to !== rel) renamed++; else deleted++; continue; }
      if (cur.size >= 64 || was.size >= 64) { compared++; if (cur.sampleSha !== was.sampleSha && cur.entropy - was.entropy >= entropyJump && cur.entropy >= highEntropy) jumped++; }
    }
    for (const [rel, cur] of now.files) {                                                                     // renamed-and-rewritten files show up as new names with high entropy
      if (base.files.has(rel)) continue;
      if (RANSOM_NOTE_RE.test(path.basename(rel))) signals.push({ code: "RANSOM_NOTE_NAME", file: rel });
      if (RANSOM_EXT_RE.test(rel)) signals.push({ code: "RANSOMWARE_EXTENSION", file: rel });
      // a file renamed AND rewritten keeps its inode: compare its entropy with the old name's sample
      const old = [...base.files.values()].find(v => v.ino === cur.ino);
      if (old && (cur.size >= 64 || old.size >= 64)) { compared++; if (cur.sampleSha !== old.sampleSha && cur.entropy - old.entropy >= entropyJump && cur.entropy >= highEntropy) jumped++; }
    }
    const n = base.files.size || 1;
    if (renamed >= massMin && renamed / n >= massFraction) signals.push({ code: "MASS_RENAME", count: renamed, of: base.files.size });
    if (deleted >= massMin && deleted / n >= massFraction) signals.push({ code: "MASS_DELETE", count: deleted, of: base.files.size });      // encrypt-to-new-file-then-delete pattern
    if (jumped >= massMin && jumped / Math.max(compared, 1) >= massFraction) signals.push({ code: "MASS_ENTROPY_JUMP", count: jumped, of: compared });
    const critical = signals.some(s => /^CANARY_|^MASS_|^RANSOMWARE_EXTENSION/.test(s.code));
    const alert = {
      alert: signals.length > 0, severity: critical ? "CRITICAL" : signals.length ? "WARN" : "NONE", signals: signals.slice(0, 100), watched: now.files.size, truncated: now.truncated,
      at: new Date(nowFn()).toISOString(),
      processActions: "NONE",                                                                                  // by design: this module never kills, suspends or signals any process
      recommendedActions: signals.length ? ["Owner review now", "Disconnect the machine from networks and shared drives if the alert is real", "Do not pay; restore from a verified offline backup", "Keep the evidence (this alert and the audit log)"] : []
    };
    if (alert.alert) { audit.append("CANARY_ALERT", { severity: alert.severity, signals: alert.signals.slice(0, 20) }); try { onAlert?.(alert); } catch { /* the alert is returned anyway */ } }
    return alert;
  }
  function start({ intervalMs = 60000 } = {}) { if (timer) return false; if (!base) baseline(); timer = setInterval(() => { try { check(); } catch { /* next tick */ } }, Math.max(1000, intervalMs)); timer.unref?.(); return true; }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { plant, baseline, check, start, stop, snapshot, canaries: () => canaries.map(c => c.name), auditEntries: () => audit.entries(), auditVerify: () => audit.verify() };
}
