// 23-point item 2: quarantine store, archive inspector (self-parsed ZIP / TAR), type detection, canary monitor. Synthetic bytes only: no real malware, no network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { randomBytes } from "node:crypto";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { sniffType, nameFindings, typeFindings, sanitiseName, shannonEntropy, entryPathFindings, inspectArchive, createQuarantine, releaseSubject, deleteSubject, createCanaryMonitor } from "../atlasz-addons/quarantine.mjs";
import { tmp, rm } from "./helpers.mjs";

const kp = generateOwnerKeyPair();
const auth = () => createOwnerAuth({ publicKeyB64: kp.publicKeyB64 });
const ap = (action, subject) => issueOwnerApproval({ privateKeyPem: kp.privateKeyPem, action, subject });

// ---------------------------------------------------------------- synthetic fixture builders
/** ZIP writer: method 0 (stored) or 8 (deflate); every header field can be overridden to build hostile archives. */
function zip(entries, { eocdCount = null } = {}) {
  const locals = [], centrals = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8"), raw = Buffer.from(e.data ?? ""), method = e.method ?? 0;
    const data = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const lname = Buffer.from(e.localName ?? e.name, "utf8");
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800 | (e.encrypted ? 1 : 0), 6); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(lname.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(((e.unix ? 3 : 0) << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800 | (e.encrypted ? 1 : 0), 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(e.csize ?? data.length, 20); ch.writeUInt32LE(e.usize ?? raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(((e.mode ?? 0) << 16) >>> 0, 38); ch.writeUInt32LE(e.offset ?? off, 42);
    locals.push(lh, lname, data); centrals.push(ch, name); off += 30 + lname.length + data.length;
  }
  const cd = Buffer.concat(centrals), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(eocdCount ?? entries.length, 8); eocd.writeUInt16LE(eocdCount ?? entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
const oct = (h, off, len, v) => h.write(v.toString(8).padStart(len - 1, "0") + "\0", off, len, "latin1");
function tarHeader({ name, size = 0, type = "0", link = "", mode = 0o644, prefix = "" }) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8"); oct(h, 100, 8, mode); oct(h, 108, 8, 0); oct(h, 116, 8, 0); oct(h, 124, 12, size); oct(h, 136, 12, 0);
  h.write(type, 156, 1, "latin1"); h.write(link, 157, 100, "utf8"); h.write("ustar\0", 257, "latin1"); h.write("00", 263, "latin1"); h.write(prefix, 345, 155, "utf8");
  h.fill(32, 148, 156); let s = 0; for (const b of h) s += b; h.write(s.toString(8).padStart(6, "0") + "\0 ", 148, 8, "latin1");
  return h;
}
function tar(entries) {
  const parts = [];
  for (const e of entries) {
    const data = Buffer.from(e.data ?? "");
    parts.push(tarHeader({ ...e, size: e.size ?? data.length }));
    if (data.length) parts.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
const codes = r => r.findings.map(f => f.code);
const FAKE_PE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100, 0x90)]);       // magic bytes only; not a program

// ---------------------------------------------------------------- detection
test("sniffType identifies executables, scripts and archives by magic bytes, not by name", () => {
  const cases = [[FAKE_PE, "PE_WINDOWS_EXECUTABLE", true], [Buffer.from("\x7fELF\x02\x01\x01", "latin1"), "ELF_EXECUTABLE", true], [Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 7]), "MACHO_EXECUTABLE", true],
    [Buffer.from("#!/bin/sh\necho hi\n"), "SCRIPT_SHEBANG", true], [Buffer.from([0, 0x61, 0x73, 0x6d, 1]), "WASM_MODULE", true], [zip([{ name: "a.txt", data: "x" }]), "ZIP_ARCHIVE", false],
    [zlib.gzipSync(Buffer.from("x")), "GZIP", false], [tar([{ name: "a.txt", data: "x" }]), "TAR_ARCHIVE", false], [Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]), "7Z_ARCHIVE", false],
    [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "OLE_COMPOUND_DOCUMENT", false], [Buffer.from("%PDF-1.7"), "PDF", false], [Buffer.from("hello"), "UNKNOWN", false], [Buffer.alloc(0), "UNKNOWN", false]];
  for (const [b, type, exec] of cases) { const t = sniffType(b); assert.equal(t.type, type); assert.equal(t.executable, exec, type); }
  assert.equal(sniffType(zip([{ name: "a", data: "x" }])).archive, true);
});

test("name findings: double extension, bidi override, padding and trailing dots", () => {
  assert.ok(nameFindings("invoice.pdf.exe").some(f => f.code === "DOUBLE_EXTENSION:pdf.exe" && f.severity === "BLOCK"));
  assert.ok(nameFindings("photo.JPG.scr").some(f => f.code === "DOUBLE_EXTENSION:jpg.scr"));
  assert.ok(nameFindings("invoice\u202Efdp.exe").some(f => f.code === "BIDI_CONTROL_IN_NAME" && f.severity === "BLOCK"));
  assert.ok(nameFindings("report.pdf" + " ".repeat(20) + ".exe").some(f => f.code === "WHITESPACE_PADDING_IN_NAME"));
  assert.ok(nameFindings("setup.exe.").some(f => f.code === "TRAILING_DOT_OR_SPACE_IN_NAME"));
  assert.ok(nameFindings("setup.exe.").some(f => f.code === "EXECUTABLE_EXTENSION:exe"), "a trailing dot does not hide the real extension");
  assert.deepEqual(nameFindings("quarterly-report.pdf"), []);
  assert.deepEqual(nameFindings("archive.tar.gz"), []);
});

test("type vs name: an executable disguised as a document is BLOCK; a macro container is flagged", () => {
  const t = typeFindings(FAKE_PE, "contract.pdf");
  assert.ok(t.findings.some(f => f.code === "EXECUTABLE_DISGUISED_AS:pdf" && f.severity === "BLOCK"));
  assert.ok(!typeFindings(FAKE_PE, "tool.exe").findings.some(f => f.severity === "BLOCK"), "an honest .exe is flagged WARN, not BLOCK");
  assert.ok(typeFindings(Buffer.from("#!/bin/bash\nrm -rf /tmp/x"), "notes.txt").findings.some(f => f.code === "EXECUTABLE_DISGUISED_AS:txt"));
  assert.ok(typeFindings(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "budget.xls").findings.some(f => f.code === "MACRO_CAPABLE_CONTAINER"));
});

test("sanitiseName strips paths, hidden and control characters and never returns an empty or hidden name", () => {
  assert.equal(sanitiseName("../../etc/passwd"), "passwd");
  assert.equal(sanitiseName("C:\\Windows\\system32\\evil.dll"), "evil.dll");
  assert.equal(sanitiseName("invoice\u202Efdp.exe"), "invoicefdp.exe");
  assert.equal(sanitiseName(".bashrc"), "bashrc");
  assert.equal(sanitiseName(""), "unnamed"); assert.equal(sanitiseName(null), "unnamed"); assert.equal(sanitiseName("..."), "unnamed");
  assert.equal(sanitiseName("a b<c>|d?.txt"), "a_b_c_d_.txt");
  const long = sanitiseName("x".repeat(500) + ".pdf"); assert.ok(long.length <= 120 && long.endsWith(".pdf"));
});

test("entropy: text is low, random bytes are close to 8", () => {
  assert.ok(shannonEntropy(Buffer.from("hello hello hello hello")) < 4);
  assert.ok(shannonEntropy(randomBytes(65536)) > 7.9);
  assert.equal(shannonEntropy(Buffer.alloc(0)), 0);
});

test("entry path findings: traversal, absolute, drive letter, backslash, NUL, depth", () => {
  assert.ok(entryPathFindings("../x").includes("PATH_TRAVERSAL_DOTDOT"));
  assert.ok(entryPathFindings("a/../../x").includes("PATH_TRAVERSAL_DOTDOT"));
  assert.ok(entryPathFindings("/etc/cron.d/x").includes("ABSOLUTE_ENTRY_PATH"));
  assert.ok(entryPathFindings("C:/Windows/x").includes("ABSOLUTE_ENTRY_PATH"));
  assert.ok(entryPathFindings("..\\..\\x").includes("PATH_TRAVERSAL_DOTDOT") && entryPathFindings("..\\..\\x").includes("BACKSLASH_IN_ENTRY_NAME"));
  assert.ok(entryPathFindings("a\0.txt").includes("NUL_IN_ENTRY_NAME"));
  assert.ok(entryPathFindings(Array(40).fill("d").join("/")).includes("PATH_TOO_DEEP"));
  assert.deepEqual(entryPathFindings("docs/readme.txt"), []);
  assert.deepEqual(entryPathFindings("a..b/c"), [], "dots inside a name are not traversal");
});

// ---------------------------------------------------------------- ZIP
test("zip: a benign archive has no findings and is never called clean", () => {
  const r = inspectArchive(zip([{ name: "docs/", data: "" }, { name: "docs/a.txt", data: "hello" }, { name: "b.txt", data: "world", method: 8 }]));
  assert.equal(r.verdict, "NO_STRUCTURAL_FINDINGS"); assert.equal(r.entries, 3); assert.equal(r.format, "ZIP_ARCHIVE");
  assert.ok(!JSON.stringify(r).includes("CLEAN"));
  assert.equal(inspectArchive(Buffer.from("just text")).verdict, "NOT_AN_ARCHIVE");
});

test("zip-slip: '..', absolute, drive-letter and backslash entries are BLOCK", () => {
  for (const name of ["../../home/user/.bashrc", "/etc/passwd", "C:/Users/x/startup.bat", "..\\..\\evil.dll"]) {
    const r = inspectArchive(zip([{ name, data: "x" }]));
    assert.equal(r.verdict, "BLOCK", name);
    assert.ok(codes(r).some(c => ["PATH_TRAVERSAL_DOTDOT", "ABSOLUTE_ENTRY_PATH"].includes(c)), name);
  }
});

test("zip: symlink entries, special files, setuid bits and encrypted entries", () => {
  assert.ok(codes(inspectArchive(zip([{ name: "link", data: "/etc/shadow", unix: true, mode: 0o120777 }]))).includes("SYMLINK_ENTRY"));
  assert.ok(codes(inspectArchive(zip([{ name: "fifo", data: "", unix: true, mode: 0o010644 }]))).includes("SPECIAL_FILE_ENTRY"));
  const su = inspectArchive(zip([{ name: "tool", data: "x", unix: true, mode: 0o104755 }])); assert.ok(codes(su).includes("SETUID_OR_SETGID_BIT")); assert.equal(su.verdict, "REVIEW");
  assert.ok(codes(inspectArchive(zip([{ name: "secret.docx", data: "x", encrypted: true }]))).includes("ENCRYPTED_ENTRY_CANNOT_BE_INSPECTED"));
  assert.equal(inspectArchive(zip([{ name: "link", data: "x", unix: false, mode: 0o120777 }])).verdict, "NO_STRUCTURAL_FINDINGS", "mode bits are only interpreted for unix-made entries");
});

test("zip bombs: declared ratio, total size and entry count limits", () => {
  const ratio = inspectArchive(zip([{ name: "big.bin", data: "0123456789", usize: 900_000_000 }]));
  assert.ok(codes(ratio).includes("COMPRESSION_RATIO_EXCEEDS_LIMIT")); assert.equal(ratio.verdict, "BLOCK");
  const total = inspectArchive(zip([{ name: "a", data: "x".repeat(100), usize: 2000 }, { name: "b", data: "x".repeat(100), usize: 2000 }]), { limits: { maxTotalUncompressed: 3000 } });
  assert.ok(codes(total).includes("TOTAL_UNCOMPRESSED_SIZE_EXCEEDS_LIMIT"));
  const zero = inspectArchive(zip([{ name: "z", data: "", usize: 1000 }]));
  assert.ok(codes(zero).includes("COMPRESSION_RATIO_EXCEEDS_LIMIT"), "zero compressed bytes claiming content is an infinite ratio");
  const many = inspectArchive(zip(Array.from({ length: 6 }, (_, i) => ({ name: "f" + i, data: "x" }))), { limits: { maxEntries: 5 } });
  assert.ok(codes(many).includes("TOO_MANY_ENTRIES"));
  const real = zlib.deflateRawSync(Buffer.alloc(5_000_000));                                          // a genuinely highly compressible entry
  assert.ok(real.length < 10000);
  assert.ok(codes(inspectArchive(zip([{ name: "zeros.bin", data: Buffer.alloc(5_000_000), method: 8 }]))).includes("COMPRESSION_RATIO_EXCEEDS_LIMIT"));
});

test("zip parser confusion: duplicate names, local/central mismatch, count mismatch, foreign offsets", () => {
  assert.ok(codes(inspectArchive(zip([{ name: "a.txt", data: "1" }, { name: "a.txt", data: "2" }]))).includes("DUPLICATE_ENTRY_NAME"));
  assert.ok(codes(inspectArchive(zip([{ name: "A.txt", data: "1" }, { name: "a.txt", data: "2" }]))).includes("CASE_COLLIDING_ENTRY_NAME"));
  assert.ok(codes(inspectArchive(zip([{ name: "safe.txt", localName: "evil.exe", data: "1" }]))).includes("ZIP_LOCAL_HEADER_NAME_MISMATCH"));
  assert.ok(codes(inspectArchive(zip([{ name: "a.txt", data: "1" }], { eocdCount: 3 }))).includes("ZIP_ENTRY_COUNT_MISMATCH"));
  const shared = inspectArchive(zip([{ name: "a.txt", data: "1" }, { name: "b.txt", data: "2", offset: 0 }]));     // central entry pointing at another entry's local header
  assert.equal(shared.verdict, "BLOCK");
  assert.ok(codes(inspectArchive(zip([{ name: "a.txt", data: "1", offset: 999999 }]))).includes("ZIP_LOCAL_HEADER_MISSING"));
});

test("zip: nested archives are inspected recursively (stored and deflated, even when renamed)", () => {
  const inner = zip([{ name: "../../escape.sh", data: "#!/bin/sh" }]);
  const r = inspectArchive(zip([{ name: "inner.zip", data: inner }]));
  assert.ok(codes(r).includes("NESTED_ARCHIVE")); assert.ok(codes(r).includes("PATH_TRAVERSAL_DOTDOT")); assert.equal(r.nestingDepth, 1);
  assert.ok(r.findings.some(f => f.code === "PATH_TRAVERSAL_DOTDOT" && /inner\.zip/.test(f.where)), "the finding says where it was found");
  const renamed = inspectArchive(zip([{ name: "harmless.dat", data: inner, method: 8 }]));
  assert.ok(codes(renamed).includes("PATH_TRAVERSAL_DOTDOT"), "a deflated archive hidden under another name is still opened and inspected");
  const exeInside = inspectArchive(zip([{ name: "readme.txt", data: FAKE_PE }]));
  assert.ok(codes(exeInside).some(c => c.startsWith("EXECUTABLE_INSIDE_ARCHIVE")));
});

test("zip: nesting deeper than the limit is BLOCK", () => {
  let b = zip([{ name: "core.txt", data: "x" }]);
  for (let i = 0; i < 5; i++) b = zip([{ name: "level" + i + ".zip", data: b }]);
  const r = inspectArchive(b, { limits: { maxNestingDepth: 3 } });
  assert.ok(codes(r).includes("NESTING_TOO_DEEP")); assert.equal(r.verdict, "BLOCK");
  assert.equal(inspectArchive(b, { limits: { maxNestingDepth: 6 } }).verdict, "REVIEW", "within the limit it is only a warning");
});

test("zip: double extensions and executables inside an archive are reported", () => {
  const r = inspectArchive(zip([{ name: "docs/invoice.pdf.exe", data: "x" }, { name: "run.bat", data: "x" }]));
  assert.ok(codes(r).includes("DOUBLE_EXTENSION:pdf.exe")); assert.ok(codes(r).includes("EXECUTABLE_INSIDE_ARCHIVE:bat")); assert.equal(r.verdict, "BLOCK");
});

test("malformed / truncated / fuzzed archives never throw and never pass", () => {
  const good = zip([{ name: "a.txt", data: "hello" }, { name: "b.txt", data: "world" }]);
  for (let cut = 1; cut < good.length; cut += 7) { const r = inspectArchive(good.subarray(0, cut)); assert.ok(["BLOCK", "NOT_AN_ARCHIVE"].includes(r.verdict), "cut " + cut + " -> " + r.verdict); }
  const t = tar([{ name: "a.txt", data: "hello" }]);
  for (let i = 0; i < 300; i++) {
    const base = i % 2 ? Buffer.from(good) : Buffer.from(t);
    for (let k = 0; k < 4; k++) base[Math.floor(Math.random() * base.length)] = Math.floor(Math.random() * 256);
    const r = inspectArchive(base);
    assert.ok(["BLOCK", "REVIEW", "NO_STRUCTURAL_FINDINGS", "NOT_AN_ARCHIVE"].includes(r.verdict));
  }
  assert.equal(inspectArchive(Buffer.from([0x50, 0x4b, 0x03, 0x04])).verdict, "BLOCK");
});

// ---------------------------------------------------------------- TAR / GZIP / other
test("tar: benign archive passes structure checks; links, devices, traversal and bad checksums are BLOCK", () => {
  assert.equal(inspectArchive(tar([{ name: "dir/", type: "5" }, { name: "dir/a.txt", data: "hello" }])).verdict, "NO_STRUCTURAL_FINDINGS");
  assert.ok(codes(inspectArchive(tar([{ name: "lnk", type: "2", link: "/etc/passwd" }]))).includes("SYMLINK_ENTRY"));
  assert.ok(codes(inspectArchive(tar([{ name: "hard", type: "1", link: "../../x" }]))).includes("HARDLINK_ENTRY"));
  assert.ok(codes(inspectArchive(tar([{ name: "dev", type: "3" }]))).includes("SPECIAL_FILE_ENTRY"));
  assert.ok(codes(inspectArchive(tar([{ name: "../../.ssh/authorized_keys", data: "k" }]))).includes("PATH_TRAVERSAL_DOTDOT"));
  assert.ok(codes(inspectArchive(tar([{ name: "x", prefix: "../..", data: "k" }]))).includes("PATH_TRAVERSAL_DOTDOT"), "the ustar prefix field is part of the path");
  assert.ok(codes(inspectArchive(tar([{ name: "suid", data: "k", mode: 0o4755 }]))).includes("SETUID_OR_SETGID_BIT"));
  const bad = tar([{ name: "a.txt", data: "x" }]); bad[0] = 0x62;                                           // edit the name after the checksum was computed
  assert.ok(codes(inspectArchive(Buffer.concat([tar([{ name: "ok", data: "y" }]).subarray(0, 1024), bad]))).includes("TAR_HEADER_CHECKSUM_INVALID"));
});

test("tar: pax and GNU long-name records cannot hide a traversal path", () => {
  const rec = (k, v) => { const body = " " + k + "=" + v + "\n"; let n = body.length; n += String(n + String(n).length).length; return String(n) + body; };
  const paxData = rec("path", "../../evil.sh");
  const r = inspectArchive(tar([{ name: "PaxHeaders/x", type: "x", data: paxData }, { name: "innocent.txt", data: "x" }]));
  assert.ok(codes(r).includes("PATH_TRAVERSAL_DOTDOT"), JSON.stringify(r.findings));
  const g = inspectArchive(tar([{ name: "././@LongLink", type: "L", data: "../../../root/.profile\0" }, { name: "short", data: "x" }]));
  assert.ok(codes(g).includes("PATH_TRAVERSAL_DOTDOT"));
  const pl = inspectArchive(tar([{ name: "PaxHeaders/y", type: "x", data: rec("linkpath", "/etc/shadow") }, { name: "l", type: "2" }]));
  assert.ok(pl.findings.some(f => f.code === "SYMLINK_ENTRY" && f.where.includes("/etc/shadow")));
});

test("gzip: tar.gz is inspected after a capped decompression; gzip bombs and unknown formats are BLOCK", () => {
  const tgz = zlib.gzipSync(tar([{ name: "../x", data: "1" }]));
  assert.ok(codes(inspectArchive(tgz)).includes("PATH_TRAVERSAL_DOTDOT"));
  const bomb = zlib.gzipSync(Buffer.alloc(4_000_000));
  const r = inspectArchive(bomb, { limits: { maxNestedInflate: 1_000_000 } });
  assert.ok(codes(r).includes("DECOMPRESSED_SIZE_EXCEEDS_LIMIT")); assert.equal(r.verdict, "BLOCK");
  assert.ok(codes(inspectArchive(bomb)).includes("COMPRESSION_RATIO_EXCEEDS_LIMIT"));
  for (const magic of [[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0], [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0]]) {
    const u = inspectArchive(Buffer.concat([Buffer.from(magic), randomBytes(64)]));
    assert.equal(u.verdict, "BLOCK"); assert.ok(codes(u)[0].startsWith("UNINSPECTABLE_ARCHIVE_FORMAT"));
  }
  assert.equal(inspectArchive(Buffer.concat([zip([{ name: "a", data: "b" }]), Buffer.alloc(10)]), { limits: { maxInspectBytes: 50 } }).verdict, "BLOCK", "too large to inspect is BLOCK, never skipped");
});

// ---------------------------------------------------------------- store
test("quarantineFile moves the file into a read-only store with an honest record", async () => {
  const d = tmp("q-");
  try {
    const q = createQuarantine({ dir: path.join(d, "q"), ownerAuth: auth() });
    const src = path.join(d, "invoice.pdf.exe"); fs.writeFileSync(src, FAKE_PE, { mode: 0o755 });
    const r = await q.quarantineFile(src, { reason: "email attachment from unknown sender" });
    assert.equal(r.ok, true); assert.equal(r.sourceRemoved, true); assert.equal(fs.existsSync(src), false);
    const rec = r.record, stored = path.join(d, "q", "files", rec.sha256 + ".bin");
    assert.match(rec.sha256, /^[0-9a-f]{64}$/); assert.equal(rec.size, FAKE_PE.length); assert.equal(rec.originalName, "invoice.pdf.exe"); assert.equal(rec.reason, "email attachment from unknown sender");
    assert.ok(Number.isFinite(Date.parse(rec.quarantinedAt))); assert.equal(rec.type, "PE_WINDOWS_EXECUTABLE"); assert.equal(rec.executable, true);
    assert.equal(rec.assessment, "HIGH_RISK_HOLD"); assert.equal(rec.scan.status, "NO_SCANNER_CONFIGURED");
    if (process.platform !== "win32") assert.equal(fs.statSync(stored).mode & 0o777, 0o400, "read-only, no exec bit even though the source was 0755");
    assert.deepEqual(fs.readFileSync(stored), FAKE_PE);
    assert.equal(q.get(rec.sha256).status, "QUARANTINED"); assert.equal(q.get(rec.sha256).storedIntact, true);
    assert.equal(q.status().scanner, "NO_SCANNER_CONFIGURED"); assert.equal(q.status().executes, false);
    const v = q.verify(); assert.equal(v.ok, true); assert.equal(v.anyExecBit, false);
  } finally { rm(d); }
});

test("intake refuses symlinks, non-files, missing reasons and oversize files", async () => {
  const d = tmp("q-");
  try {
    const q = createQuarantine({ dir: path.join(d, "q"), ownerAuth: auth(), limits: { maxFileBytes: 100 } });
    fs.writeFileSync(path.join(d, "target.txt"), "x");
    if (process.platform !== "win32") { fs.symlinkSync(path.join(d, "target.txt"), path.join(d, "link.txt")); assert.equal((await q.quarantineFile(path.join(d, "link.txt"), { reason: "r" })).reason, "SOURCE_IS_SYMLINK_REFUSED"); assert.equal(fs.existsSync(path.join(d, "target.txt")), true, "the link target is untouched"); }
    assert.equal((await q.quarantineFile(d, { reason: "r" })).reason, "SOURCE_NOT_A_REGULAR_FILE");
    assert.equal((await q.quarantineFile(path.join(d, "nope"), { reason: "r" })).reason, "SOURCE_NOT_FOUND");
    assert.equal((await q.quarantineFile(path.join(d, "target.txt"), {})).reason, "REASON_REQUIRED");
    fs.writeFileSync(path.join(d, "big.bin"), Buffer.alloc(200));
    assert.equal((await q.quarantineFile(path.join(d, "big.bin"), { reason: "r" })).reason, "FILE_TOO_LARGE_FOR_QUARANTINE");
    assert.equal((await q.quarantineBuffer("not a buffer", { reason: "r" })).reason, "BUFFER_REQUIRED");
    assert.equal(q.list().length, 0);
  } finally { rm(d); }
});

test("scanner interface: none / no detection / detection / error / timeout - never 'clean'", async () => {
  const d = tmp("q-");
  try {
    const mk = (scanner, extra = {}) => createQuarantine({ dir: path.join(d, "q" + Math.random().toString(16).slice(2)), ownerAuth: auth(), scanner, ...extra });
    const b = Buffer.from("plain synthetic text");
    assert.equal((await mk(null).quarantineBuffer(b, { name: "a.txt", reason: "r" })).record.scan.status, "NO_SCANNER_CONFIGURED");
    const seen = [];
    const nd = await mk({ name: "fake-av", scan: p => { seen.push(p); return { verdict: "CLEAN" }; } }).quarantineBuffer(b, { name: "a.txt", reason: "r" });
    assert.equal(nd.record.scan.status, "SCANNER_NO_DETECTION"); assert.match(nd.record.scan.detail, /not proof/i);
    assert.equal(nd.record.assessment, "HELD_NO_FINDINGS_NOT_PROVEN_SAFE"); assert.ok(seen[0].endsWith(".bin"), "the scanner gets the stored read-only copy");
    const det = await mk({ scan: async () => ({ verdict: "INFECTED", detail: "Synthetic.Test" }) }).quarantineBuffer(b, { name: "a.txt", reason: "r" });
    assert.equal(det.record.scan.status, "SCANNER_DETECTED"); assert.equal(det.record.assessment, "HIGH_RISK_HOLD");
    assert.equal((await mk({ scan: () => { throw new Error("engine crashed"); } }).quarantineBuffer(b, { name: "a.txt", reason: "r" })).record.scan.status, "SCANNER_ERROR");
    assert.equal((await mk({ scan: () => ({ verdict: "maybe" }) }).quarantineBuffer(b, { name: "a.txt", reason: "r" })).record.scan.status, "SCANNER_ERROR", "unknown verdicts are errors, not passes");
    const slow = await mk({ scan: () => new Promise(() => {}) }, { scanTimeoutMs: 50 }).quarantineBuffer(b, { name: "a.txt", reason: "r" });
    assert.equal(slow.record.scan.status, "SCANNER_ERROR"); assert.match(slow.record.scan.detail, /TIMEOUT/);
    assert.equal((await mk({ notAScanner: true }).quarantineBuffer(b, { name: "a.txt", reason: "r" })).record.scan.status, "SCANNER_ERROR");
  } finally { rm(d); }
});

test("release needs an owner approval bound to the sha256 and destination; single use; O_EXCL destination", async () => {
  const d = tmp("q-");
  try {
    const q = createQuarantine({ dir: path.join(d, "q"), ownerAuth: auth() });
    const a = (await q.quarantineBuffer(Buffer.from("payload A"), { name: "a.txt", reason: "r" })).record.sha256;
    const b = (await q.quarantineBuffer(Buffer.from("payload B"), { name: "b.txt", reason: "r" })).record.sha256;
    const dest = path.join(d, "out", "a.txt"); fs.mkdirSync(path.dirname(dest));
    assert.equal(q.release(a, { destPath: dest }).reason, "OWNER_APPROVAL_REQUIRED");
    assert.equal(q.release(a, { destPath: dest, ownerApproval: true }).detail, "BARE_BOOLEAN_REJECTED");
    assert.equal(q.release(a, { destPath: dest, ownerApproval: ap("QUARANTINE_RELEASE", releaseSubject(b, dest)) }).detail, "SUBJECT_MISMATCH", "approval for another file");
    assert.equal(q.release(a, { destPath: dest, ownerApproval: ap("QUARANTINE_RELEASE", releaseSubject(a, path.join(d, "elsewhere"))) }).detail, "SUBJECT_MISMATCH", "approval for another destination");
    assert.equal(q.release(a, { destPath: dest, ownerApproval: ap("QUARANTINE_DELETE", releaseSubject(a, dest)) }).detail, "ACTION_MISMATCH");
    fs.writeFileSync(dest, "pre-existing");
    assert.equal(q.release(a, { destPath: dest, ownerApproval: ap("QUARANTINE_RELEASE", releaseSubject(a, dest)) }).reason, "DEST_WRITE_FAILED", "never overwrites an existing file");
    fs.unlinkSync(dest);
    const good = ap("QUARANTINE_RELEASE", releaseSubject(a, dest));
    const r = q.release(a, { destPath: dest, ownerApproval: good });
    assert.equal(r.ok, true); assert.equal(fs.readFileSync(dest, "utf8"), "payload A");
    if (process.platform !== "win32") assert.equal(fs.statSync(dest).mode & 0o111, 0, "released without exec bits");
    assert.equal(q.get(a).status, "RELEASED"); assert.equal(q.release(a, { destPath: dest + "2", ownerApproval: good }).reason, "NOT_IN_QUARANTINE");
    assert.ok(q.auditEntries().some(e => e.event === "QUARANTINE_RELEASED" && e.data.sha256 === a));
    assert.equal(q.release("not-a-sha", { destPath: dest, ownerApproval: good }).reason, "SHA256_INVALID");
  } finally { rm(d); }
});

test("a tampered stored copy is never released; delete needs its own approval bound to the sha256", async () => {
  const d = tmp("q-");
  try {
    const q = createQuarantine({ dir: path.join(d, "q"), ownerAuth: auth() });
    const h = (await q.quarantineBuffer(Buffer.from("original bytes"), { name: "a.txt", reason: "r" })).record.sha256;
    const stored = path.join(d, "q", "files", h + ".bin"); fs.chmodSync(stored, 0o600); fs.writeFileSync(stored, "swapped bytes");
    const dest = path.join(d, "out.txt");
    assert.equal(q.release(h, { destPath: dest, ownerApproval: ap("QUARANTINE_RELEASE", releaseSubject(h, dest)) }).reason, "STORED_FILE_TAMPERED_OR_MISSING");
    assert.equal(fs.existsSync(dest), false); assert.equal(q.verify().ok, false); assert.deepEqual(q.verify().tampered, [h]);
    assert.equal(q.remove(h, { ownerApproval: ap("QUARANTINE_DELETE", deleteSubject("0".repeat(64))) }).detail, "SUBJECT_MISMATCH");
    assert.equal(q.remove(h).reason, "OWNER_APPROVAL_REQUIRED");
    assert.equal(q.remove(h, { ownerApproval: ap("QUARANTINE_DELETE", deleteSubject(h)) }).ok, true);
    assert.equal(fs.existsSync(stored), false); assert.equal(q.get(h).status, "DELETED");
  } finally { rm(d); }
});

test("the audit log is the manifest: editing manifest.json changes nothing, editing the log is detected", async () => {
  const d = tmp("q-");
  try {
    const dir = path.join(d, "q"), q = createQuarantine({ dir, ownerAuth: auth() });
    const h = (await q.quarantineBuffer(Buffer.from("x1"), { name: "a.txt", reason: "r" })).record.sha256;
    const man = path.join(dir, "manifest.json"); assert.ok(fs.existsSync(man));
    fs.writeFileSync(man, JSON.stringify({ items: [{ sha256: h, status: "RELEASED", assessment: "CLEAN" }] }));
    assert.equal(q.get(h).status, "QUARANTINED");
    const log = path.join(dir, "quarantine-audit.jsonl"), txt = fs.readFileSync(log, "utf8").replace('"reason":"r"', '"reason":"z"'); fs.writeFileSync(log, txt);
    assert.throws(() => q.list(), /AUDIT_CHAIN_TAMPERED/); assert.equal(q.verify().ok, false);
    assert.throws(() => createQuarantine({ dir, ownerAuth: auth() }), /AUDIT_CHAIN_TAMPERED/);
  } finally { rm(d); }
});

test("kill switch blocks release and delete (a throwing stop check counts as stopped); unconfigured owner auth fails closed", async () => {
  const d = tmp("q-");
  try {
    let stop = false; const q = createQuarantine({ dir: path.join(d, "q"), ownerAuth: auth(), isStopped: () => { if (stop === "boom") throw new Error("x"); return stop; } });
    const h = (await q.quarantineBuffer(Buffer.from("x"), { name: "a", reason: "r" })).record.sha256, dest = path.join(d, "o");
    stop = true; assert.equal(q.release(h, { destPath: dest, ownerApproval: ap("QUARANTINE_RELEASE", releaseSubject(h, dest)) }).reason, "OWNER_STOP_ACTIVE");
    assert.equal(q.remove(h, { ownerApproval: ap("QUARANTINE_DELETE", deleteSubject(h)) }).reason, "OWNER_STOP_ACTIVE");
    stop = "boom"; assert.equal(q.release(h, { destPath: dest, ownerApproval: ap("QUARANTINE_RELEASE", releaseSubject(h, dest)) }).reason, "OWNER_STOP_ACTIVE");
    const noOwner = createQuarantine({ dir: path.join(d, "q2") });
    const h2 = (await noOwner.quarantineBuffer(Buffer.from("y"), { name: "a", reason: "r" })).record.sha256;
    assert.equal(noOwner.release(h2, { destPath: dest, ownerApproval: ap("QUARANTINE_RELEASE", releaseSubject(h2, dest)) }).reason, "OWNER_AUTH_NOT_CONFIGURED");
    assert.equal(createQuarantine({ dir: path.join(d, "q3"), ownerAuth: createOwnerAuth({}) }).release(h2, { destPath: dest, ownerApproval: ap("QUARANTINE_RELEASE", releaseSubject(h2, dest)) }).reason, "NOT_IN_QUARANTINE");
  } finally { rm(d); }
});

test("archives are inspected on intake and duplicates are counted, not stored twice", async () => {
  const d = tmp("q-");
  try {
    const q = createQuarantine({ dir: path.join(d, "q"), ownerAuth: auth() });
    const evil = zip([{ name: "../../startup/run.bat", data: "@echo off" }]);
    const r = await q.quarantineBuffer(evil, { name: "photos.zip", reason: "download" });
    assert.equal(r.record.archive.verdict, "BLOCK"); assert.equal(r.record.assessment, "HIGH_RISK_HOLD");
    assert.ok(r.record.findings.some(f => f.code === "PATH_TRAVERSAL_DOTDOT"));
    const again = await q.quarantineBuffer(evil, { name: "photos(1).zip", reason: "download again" });
    assert.equal(again.record.sha256, r.record.sha256); assert.equal(q.get(r.record.sha256).occurrences, 2);
    assert.equal(fs.readdirSync(path.join(d, "q", "files")).length, 1);
    assert.equal(q.verify().ok, true);
  } finally { rm(d); }
});

test("quarantine source contains no process-spawning, eval or kill code", () => {
  const src = fs.readFileSync(new URL("../atlasz-addons/quarantine.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /from\s+["'](?:node:)?(?:child_process|worker_threads|vm|cluster)["']/);
  assert.doesNotMatch(src, /process\.kill\s*\(|\bexecSync\b|\bexecFile\b|\bspawn\s*\(|\beval\s*\(|\bnew Function\b/);
});

// ---------------------------------------------------------------- canary monitor
function canaryRig(n = 10) {
  const d = tmp("canary-"), w = path.join(d, "watched"); fs.mkdirSync(w);
  for (let i = 0; i < n; i++) fs.writeFileSync(path.join(w, "doc" + i + ".txt"), ("Synthetic document number " + i + ". ").repeat(40));
  const alerts = []; const m = createCanaryMonitor({ watchDir: w, stateDir: path.join(d, "s"), onAlert: a => alerts.push(a) });
  const names = m.plant(); m.baseline();
  return { d, w, m, names, alerts };
}

test("canary: quiet folder -> no alert; a modified canary -> CRITICAL; the monitor never touches processes", () => {
  const r = canaryRig();
  try {
    const quiet = r.m.check(); assert.equal(quiet.alert, false); assert.equal(quiet.severity, "NONE"); assert.equal(quiet.processActions, "NONE");
    fs.writeFileSync(path.join(r.w, "doc3.txt"), "edited normally");                                     // ordinary edits of a non-canary file are not an alert
    assert.equal(r.m.check().alert, false);
    fs.appendFileSync(path.join(r.w, r.names[0]), "x");
    const a = r.m.check();
    assert.equal(a.alert, true); assert.equal(a.severity, "CRITICAL"); assert.ok(a.signals.some(s => s.code === "CANARY_MODIFIED"));
    assert.equal(a.processActions, "NONE"); assert.ok(a.recommendedActions.length > 0); assert.equal(r.alerts.length, 1);
    assert.ok(r.m.auditEntries().some(e => e.event === "CANARY_ALERT")); assert.equal(r.m.auditVerify().ok, true);
  } finally { rm(r.d); }
});

test("canary: deleted and renamed canaries are told apart", () => {
  const r = canaryRig();
  try {
    fs.unlinkSync(path.join(r.w, r.names[0]));
    fs.renameSync(path.join(r.w, r.names[1]), path.join(r.w, r.names[1] + ".locked"));
    const a = r.m.check();
    assert.ok(a.signals.some(s => s.code === "CANARY_DELETED" && s.file === r.names[0]));
    assert.ok(a.signals.some(s => s.code === "CANARY_RENAMED" && s.to === r.names[1] + ".locked"));
    assert.ok(a.signals.some(s => s.code === "RANSOMWARE_EXTENSION"));
    assert.equal(a.severity, "CRITICAL");
  } finally { rm(r.d); }
});

test("canary: mass encryption (entropy jump), mass rename, mass delete and ransom notes in the watched folder", () => {
  const r = canaryRig(12);
  try {
    for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(r.w, "doc" + i + ".txt"), randomBytes(1200));      // in-place "encryption" of 8 of 12 documents
    fs.writeFileSync(path.join(r.w, "HOW_TO_DECRYPT_FILES.txt"), "synthetic note");
    const a = r.m.check();
    assert.ok(a.signals.some(s => s.code === "MASS_ENTROPY_JUMP" && s.count >= 8), JSON.stringify(a.signals));
    assert.ok(a.signals.some(s => s.code === "RANSOM_NOTE_NAME"));
    const r2 = canaryRig(12);
    try { for (let i = 0; i < 10; i++) fs.renameSync(path.join(r2.w, "doc" + i + ".txt"), path.join(r2.w, "doc" + i + ".txt.enc")); assert.ok(r2.m.check().signals.some(s => s.code === "MASS_RENAME")); } finally { rm(r2.d); }
    const r3 = canaryRig(12);
    try { for (let i = 0; i < 10; i++) fs.unlinkSync(path.join(r3.w, "doc" + i + ".txt")); assert.ok(r3.m.check().signals.some(s => s.code === "MASS_DELETE")); } finally { rm(r3.d); }
  } finally { rm(r.d); }
});

test("canary: no baseline is a warning, start/stop are idempotent and the timer does not keep the process alive", () => {
  const d = tmp("canary-");
  try {
    const m = createCanaryMonitor({ watchDir: path.join(d, "w") });
    assert.equal(m.check().signals[0].code, "NO_BASELINE");
    assert.equal(m.start({ intervalMs: 60000 }), true); assert.equal(m.start(), false); m.stop(); m.stop();
    assert.throws(() => createCanaryMonitor({}), /WATCH_DIR_REQUIRED/);
    const src = fs.readFileSync(new URL("../atlasz-addons/quarantine.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(src, /process\.kill|process\.abort|\.kill\(/);
  } finally { rm(d); }
});
