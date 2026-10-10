// C01 code-edit / repair workflow (unified programme M2). Deterministic and local: no model, no network, no git, no push.
//
//   propose  an agent submits a change set (create / replace / overwrite / delete) for ONE project folder. Nothing is written to the project. The change is validated, hashed and a diff is produced.
//   review   a DIFFERENT agent (maker != checker) runs the static code review over the resulting files. A FAIL verdict blocks the change.
//   apply    needs a signed owner approval bound to this exact change (CODE_EDIT_APPLY, subject edit:<id>:<digest>). Under a project lock: status and base hashes are re-checked, a snapshot
//            (raw bytes + modes) is taken, THEN the approval is spent, then files are written tmp+rename and re-hashed. Any failure restores the snapshot.
//            Tests then run in the restricted launcher (the existing REPO_TEST_RUN gate, which needs its own content-bound approval). Failing tests restore the snapshot - but only for files that
//            still hold what this change wrote; anything edited by someone else in the meantime is left alone and reported (APPLIED_TESTS_FAILED, owner decides).
//   rollback owner-approved (CODE_EDIT_ROLLBACK) restore from the snapshot, only while the files still hold exactly what this change wrote. Safe to retry after a failed restore.
//   recover  finish or undo an apply that was interrupted (status APPLYING) without any new approval: complete exactly the approved change, or restore the pre-change snapshot.
//   withdraw the author (or owner) cancels a change that is still PROPOSED/REVIEWED; open changes also expire.
//   repair   a rolled-back change may be followed by a new proposal that names it as parent; at most MAX_ATTEMPTS per chain. Each attempt is reviewed and approved like any other change.
//
// Truth lives in a hash-chained audit log, not in the per-change record files: a record file that is edited to say "reviewed" is ignored, and a record whose content (paths, base/after hashes,
// author, project, summary) no longer hashes to the digest the chain recorded is refused. Snapshot manifests are pinned in the chain too, and restore paths come from the verified record.
// Statuses: PROPOSED, REVIEWED, APPLYING, APPLIED_UNTESTED, APPLIED_TESTS_PASSED_IN_SANDBOX, APPLIED_TESTS_FAILED, ROLLED_BACK_TESTS_FAILED, ROLLED_BACK_APPLY_FAILED, ROLLED_BACK_BY_OWNER, ROLLBACK_FAILED, WITHDRAWN, EXPIRED.
// "Tests passed in sandbox" means the project's own test files exited 0 in the restricted launcher; it is not proof of correctness and nothing here is ever deployed, committed or pushed.
// Honest limits: identities (authorId / reviewerId) are asserted by the caller - whoever wires this to agents must bind them to the authenticated agent; the audit chain is tamper-evident, not
// tamper-proof (someone with write access to the state folder can drop tail entries); files that are not valid UTF-8 are refused rather than edited; a local attacker racing the project folder
// between a path check and a rename is not defended against beyond the checks below.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { withFileLock } from "./file-lock.mjs";
import { reviewCode } from "./code-review.mjs";
import { analyzeRepo, walkRepo, runRepoTests } from "./repo-analyzer.mjs";

export const LIMITS = Object.freeze({ maxFiles: 20, maxFileChars: 200000, maxTotalChars: 1000000, maxExistingBytes: 524288, maxOpen: 50, maxOpenPerAuthor: 10, maxAttempts: 3, maxSummary: 300, maxPath: 200, diffLines: 1500, diffOutChars: 60000, expiryMs: 7 * 86400000 });
const NAME_RE = /^[a-z][a-z0-9-]{1,40}$/, AGENT_RE = /^[A-Za-z0-9_.:-]{1,40}$/, ID_RE = /^[0-9a-f]{16}$/;
const OPS = new Set(["create", "replace", "overwrite", "delete"]);
const RESERVED_WIN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
const CANON = c => JSON.stringify({ project: c.project, parent: c.parentId ?? null, author: c.authorId, summary: c.summary ?? "", files: c.files.map(f => [f.path, f.op, f.baseHash, f.afterHash]) });
export const editSubject = (id, digest) => "edit:" + id + ":" + digest.slice(0, 24);

/** A relative POSIX path that cannot leave the project, hit hidden/VCS/dependency folders, name a key/secret file or a Windows device. Returns the clean path or null. */
export function cleanEditPath(p) {
  if (typeof p !== "string" || !p || p.length > LIMITS.maxPath || !p.isWellFormed()) return null;
  if (/[\0\\:*?"<>|\u0000-\u001f\u007f\p{Cf}]/u.test(p) || p.startsWith("/") || p.endsWith("/") || p.includes("//")) return null;
  const segs = p.split("/");
  if (segs.some(s => !s || s === "." || s === ".." || s.startsWith(".") || s.endsWith(" ") || s.endsWith(".") || /^node_modules$/i.test(s) || /~\d/.test(s) || RESERVED_WIN.test(s))) return null;
  if (/\.(pem|key|p12|pfx|jks|kdbx|ppk|gpg|asc|crt|cer|env)$/i.test(p) || /(^|\/)(id_(rsa|dsa|ecdsa|ed25519)[^/]*|(secrets?|credentials?)\.(json|ya?ml|toml|ini|txt|conf|cfg|properties|xml))$/i.test(p)) return null;
  return p;
}

/** Compact line diff (LCS, capped). A human-readable preview; the binding is through the file hashes. */
function lineDiff(a, b) {
  const A = a === null ? [] : a.split("\n"), B = b === null ? [] : b.split("\n");
  if (A.length > LIMITS.diffLines || B.length > LIMITS.diffLines) return "(diff too large to preview: " + A.length + " -> " + B.length + " lines; compare the hashes)";
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push("-" + A[i++]); else out.push("+" + B[j++]); }
  while (i < n) out.push("-" + A[i++]); while (j < m) out.push("+" + B[j++]);
  return out.join("\n");
}

export function createCodeEditWorkflow({ projectsRoot, stateDir, ownerAuth, isStopped = () => false, isKnownAgent = null, allowOwnerIdentity = false, testRunner = null, scratchRoot = os.tmpdir(), nowFn = () => Date.now(), onWrite = null } = {}) {      // onWrite(path, index): a test seam called before each file write; a throw simulates a disk error

  if (!projectsRoot || !stateDir) throw new Error("PROJECTS_ROOT_AND_STATE_DIR_REQUIRED");
  if (!ownerAuth || typeof ownerAuth.verifyApproval !== "function") throw new Error("OWNER_AUTH_REQUIRED");
  fs.mkdirSync(projectsRoot, { recursive: true }); fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const changesDir = path.join(stateDir, "changes"), snapDir = path.join(stateDir, "snapshots");
  fs.mkdirSync(changesDir, { recursive: true, mode: 0o700 }); fs.mkdirSync(snapDir, { recursive: true, mode: 0o700 });
  const audit = createAuditChain({ filePath: path.join(stateDir, "code-edit-audit.jsonl") });
  const rootReal = fs.realpathSync(projectsRoot);
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  let dWin = { t: 0, n: 0 };
  const auditDenied = (event, data) => { const t = nowFn(); if (t - dWin.t >= 60000) dWin = { t, n: 0 }; if (dWin.n++ < 30) { try { audit.append(event, data); } catch { /* the refusal is returned anyway */ } } };      // a flood of bad approvals cannot grow the log without bound
  const recFile = id => path.join(changesDir, id + ".json");
  const identityOk = id => typeof id === "string" && AGENT_RE.test(id) && (id === "OWNER" ? allowOwnerIdentity : !isKnownAgent || Boolean(isKnownAgent(id)));
  const writeAtomic = (file, data, mode = 0o600) => {
    const t = file + "." + crypto.randomBytes(4).toString("hex") + ".tmp"; let fd;
    try { fd = fs.openSync(t, "wx", mode); fs.writeSync(fd, data); fs.fsyncSync(fd); fs.closeSync(fd); fd = null; fs.renameSync(t, file); fs.chmodSync(file, mode); }
    catch (e) { if (fd !== undefined && fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } } try { fs.unlinkSync(t); } catch { /* none */ } throw e; }
  };

  // ---- status comes from the audit chain (one pass for every change) ----
  function allStates() {
    audit.reload();
    const m = new Map();
    for (const e of audit.entries()) {
      const d = e.data ?? {}, id = d.id; if (typeof id !== "string") continue;
      let st = m.get(id) ?? null;
      switch (e.event) {
        case "CHANGE_PROPOSED": st = { status: "PROPOSED", digest: d.digest, project: d.project, authorId: d.authorId, parentId: d.parentId ?? null, attempt: d.attempt ?? 1, proposedAt: d.at ?? e.at }; break;
        case "CHANGE_REVIEWED": if (st && st.status === "PROPOSED" && d.digest === st.digest) st = { ...st, status: "REVIEWED", verdict: d.verdict, reviewerId: d.reviewerId, testSubject: d.testSubject ?? null }; break;
        case "CHANGE_WITHDRAWN": if (st && (st.status === "PROPOSED" || st.status === "REVIEWED")) st = { ...st, status: "WITHDRAWN" }; break;
        case "CHANGE_APPLY_STARTED": if (st && st.status === "REVIEWED") st = { ...st, status: "APPLYING", manifestSha: d.manifestSha ?? null, approved: false }; break;
        case "CHANGE_APPLY_APPROVED": if (st && st.status === "APPLYING") st = { ...st, approved: true, nonce: d.nonce ?? null }; break;
        case "CHANGE_APPLY_ABORTED": if (st && st.status === "APPLYING") { const { manifestSha, nonce, approved, ...rest } = st; st = { ...rest, status: "REVIEWED" }; } break;
        case "CHANGE_APPLIED": if (st && st.status === "APPLYING" && st.approved) st = { ...st, status: "APPLIED_UNTESTED" }; break;
        case "CHANGE_TESTS_PASSED": if (st && st.status === "APPLIED_UNTESTED") st = { ...st, status: "APPLIED_TESTS_PASSED_IN_SANDBOX", tests: d.summary ?? null }; break;
        case "CHANGE_TESTS_FAILED": if (st && st.status === "APPLIED_UNTESTED") st = { ...st, status: "APPLIED_TESTS_FAILED", tests: d.summary ?? null }; break;
        case "CHANGE_TESTS_NOT_RUN": if (st && st.status === "APPLIED_UNTESTED") st = { ...st, tests: d.summary ?? null }; break;
        case "CHANGE_ROLLBACK_FAILED": if (st && (st.status.startsWith("APPLIED") || st.status === "APPLYING" || st.status === "ROLLBACK_FAILED")) st = { ...st, status: "ROLLBACK_FAILED" }; break;
        case "CHANGE_ROLLED_BACK":
          if (st && (st.status.startsWith("APPLIED") || st.status === "APPLYING" || st.status === "ROLLBACK_FAILED")) st = { ...st, status: d.reason === "TESTS_FAILED" ? "ROLLED_BACK_TESTS_FAILED" : d.reason === "APPLY_FAILED" ? "ROLLED_BACK_APPLY_FAILED" : "ROLLED_BACK_BY_OWNER" };
          break;
        default: break;
      }
      if (st) m.set(id, st);
    }
    return m;
  }
  const chainState = id => allStates().get(id) ?? null;
  const expired = st => (st.status === "PROPOSED" || st.status === "REVIEWED") && nowFn() - Date.parse(st.proposedAt) > LIMITS.expiryMs;
  const load = id => {
    if (typeof id !== "string" || !ID_RE.test(id)) return null;
    let rec; try { rec = JSON.parse(fs.readFileSync(recFile(id), "utf8")); } catch { return null; }
    if (!rec || rec.id !== id || !Array.isArray(rec.files)) return null;
    return rec;
  };
  /** The record must still hash to the digest the chain recorded, and every stored 'after' must hash to its afterHash. */
  function recordIntact(rec, st) {
    try {
      if (!st || sha(CANON(rec)) !== st.digest || rec.project !== st.project || rec.authorId !== st.authorId) return false;
      for (const f of rec.files) {
        if (cleanEditPath(f.path) !== f.path) return false;
        if (f.op !== "delete" && sha(Buffer.from(f.after, "utf8")) !== f.afterHash) return false;
        if (f.op === "delete" && (f.afterHash !== null || f.after !== null)) return false;
      }
      return true;
    } catch { return false; }
  }

  function projectRoot(name) {
    if (typeof name !== "string" || !NAME_RE.test(name)) return fail("PROJECT_NAME_INVALID");
    const root = path.join(projectsRoot, name); let st;
    try { st = fs.lstatSync(root); } catch { return fail("PROJECT_NOT_FOUND"); }
    if (!st.isDirectory() || st.isSymbolicLink()) return fail("PROJECT_MUST_BE_A_REAL_DIRECTORY");
    let real; try { real = fs.realpathSync(root); } catch { return fail("PROJECT_NOT_FOUND"); }
    if (path.dirname(real) !== rootReal) return fail("PROJECT_OUTSIDE_ROOT");
    return { ok: true, root, real };
  }
  /** Absolute path for a project-relative edit path (must already be clean); refuses any symlink or non-file/dir in the existing part of the chain. */
  function resolveTarget(root, rel) {
    if (cleanEditPath(rel) !== rel) return null;
    const segs = rel.split("/"); let cur = root;
    for (let i = 0; i < segs.length; i++) {
      cur = path.join(cur, segs[i]); let st = null; try { st = fs.lstatSync(cur); } catch { st = null; }
      if (!st) break;
      if (st.isSymbolicLink()) return null;
      if (i < segs.length - 1 && !st.isDirectory()) return null;
      if (i === segs.length - 1 && !st.isFile()) return null;
    }
    return path.join(root, ...segs);
  }
  /** Raw bytes + hash of the BYTES (a file that is not valid UTF-8 is refused: it could not be restored faithfully through a string). */
  function readExisting(abs) {
    try {
      const st = fs.lstatSync(abs); if (!st.isFile() || st.isSymbolicLink() || st.size > LIMITS.maxExistingBytes) return { ok: false };
      const buf = fs.readFileSync(abs); if (buf.subarray(0, 8192).includes(0)) return { ok: false };
      let text; try { text = strictUtf8.decode(buf); } catch { return { ok: false }; }
      return { ok: true, buf, text, hash: sha(buf), mode: st.mode & 0o777 };
    } catch (e) { return e?.code === "ENOENT" ? { ok: true, buf: null, text: null, hash: null, mode: null } : { ok: false }; }
  }

  // ---------------------------------------------------------------- propose
  function propose({ project, authorId, summary = "", edits, parentId = null } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    if (typeof authorId !== "string" || !AGENT_RE.test(authorId)) return fail("AUTHOR_INVALID");
    if (!identityOk(authorId)) return fail("UNKNOWN_AGENT");
    const pr = projectRoot(project); if (!pr.ok) return pr;
    if (typeof summary !== "string" || summary.length > LIMITS.maxSummary || !summary.isWellFormed() || /[\u0000-\u0008\u000b-\u001f\u007f\p{Cf}]/u.test(summary)) return fail("SUMMARY_INVALID");
    if (!Array.isArray(edits) || !edits.length || edits.length > LIMITS.maxFiles) return fail("EDITS_REQUIRED_1_TO_" + LIMITS.maxFiles);
    const states = allStates();
    let attempt = 1, parentFailure = null;
    if (parentId !== null) {
      if (typeof parentId !== "string" || !ID_RE.test(parentId)) return fail("PARENT_INVALID");
      const ps = states.get(parentId);
      if (!ps || ps.project !== project) return fail("PARENT_NOT_FOUND");
      if (!ps.status.startsWith("ROLLED_BACK")) return fail("PARENT_NOT_A_FAILED_CHANGE:" + ps.status);
      attempt = (ps.attempt ?? 1) + 1; if (attempt > LIMITS.maxAttempts) return fail("REPAIR_ATTEMPT_LIMIT");
      parentFailure = ps.tests ?? null;      // from the chain, not from a record file
    }
    let open = 0, mine = 0;
    for (const s of states.values()) if ((s.status === "PROPOSED" || s.status === "REVIEWED") && !expired(s)) { open++; if (s.authorId === authorId) mine++; }
    if (mine >= LIMITS.maxOpenPerAuthor) return fail("TOO_MANY_OPEN_CHANGES_FOR_AUTHOR");
    if (open >= LIMITS.maxOpen) return fail("TOO_MANY_OPEN_CHANGES");
    const files = [], seen = new Set(); let total = 0;
    for (const e of edits) {
      if (!e || typeof e !== "object" || !OPS.has(e.op)) return fail("EDIT_OP_INVALID");
      const p = cleanEditPath(e.path); if (!p) return fail("EDIT_PATH_INVALID");
      if (seen.has(p.toLowerCase())) return fail("EDIT_PATH_DUPLICATE:" + p); seen.add(p.toLowerCase());
      const abs = resolveTarget(pr.root, p); if (!abs) return fail("EDIT_PATH_UNSAFE:" + p);
      const cur = readExisting(abs); if (!cur.ok) return fail("EDIT_TARGET_UNREADABLE:" + p);
      let after;
      if (e.op === "create") { if (cur.text !== null) return fail("CREATE_TARGET_EXISTS:" + p); if (typeof e.content !== "string") return fail("CONTENT_REQUIRED:" + p); after = e.content; }
      else if (e.op === "overwrite") { if (cur.text === null) return fail("TARGET_MISSING:" + p); if (typeof e.content !== "string") return fail("CONTENT_REQUIRED:" + p); after = e.content; }
      else if (e.op === "delete") { if (cur.text === null) return fail("TARGET_MISSING:" + p); after = null; }
      else {
        if (cur.text === null) return fail("TARGET_MISSING:" + p);
        if (typeof e.find !== "string" || !e.find || typeof e.replace !== "string") return fail("FIND_REPLACE_REQUIRED:" + p);
        const want = e.expectCount === undefined ? 1 : e.expectCount;
        if (!Number.isInteger(want) || want < 1 || want > 50) return fail("EXPECT_COUNT_INVALID:" + p);
        const parts = cur.text.split(e.find);
        if (parts.length - 1 !== want) return fail("FIND_MISMATCH:" + p + ":found " + (parts.length - 1) + " expected " + want);
        after = parts.join(e.replace);
      }
      if (after !== null) {
        if (after.length > LIMITS.maxFileChars) return fail("FILE_TOO_LARGE:" + p);
        if (after.includes("\0") || !after.isWellFormed()) return fail("CONTENT_NOT_TEXT:" + p);
        total += after.length;
      }
      files.push({ path: p, op: e.op, baseHash: cur.hash, afterHash: after === null ? null : sha(Buffer.from(after, "utf8")), before: cur.text, after });
    }
    if (total > LIMITS.maxTotalChars) return fail("CHANGE_TOO_LARGE");
    const id = crypto.randomBytes(8).toString("hex");
    const rec = { id, project, parentId, attempt, authorId, summary, files: files.map(f => ({ path: f.path, op: f.op, baseHash: f.baseHash, afterHash: f.afterHash, after: f.after })) };
    const digest = sha(CANON(rec));
    const diff = files.map(f => "--- " + f.path + " (" + f.op + ")\n" + lineDiff(f.before, f.after)).join("\n").slice(0, LIMITS.diffOutChars);
    rec.digest = digest; rec.createdAt = new Date(nowFn()).toISOString();
    writeAtomic(recFile(id), JSON.stringify(rec));
    audit.append("CHANGE_PROPOSED", { id, project, authorId, parentId, attempt, digest, at: rec.createdAt, files: files.map(f => ({ path: f.path, op: f.op, afterHash: f.afterHash })), summary });
    return { ok: true, id, digest, attempt, subject: editSubject(id, digest), parentFailure, files: files.map(f => ({ path: f.path, op: f.op, baseHash: f.baseHash, afterHash: f.afterHash })), diff };
  }

  // ---------------------------------------------------------------- review (checker)
  function review(id, { reviewerId } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    const st = chainState(id); if (!st) return fail("CHANGE_NOT_FOUND");
    if (st.status !== "PROPOSED") return fail("CHANGE_NOT_IN_PROPOSED_STATE:" + st.status);
    if (expired(st)) return fail("CHANGE_EXPIRED");
    if (typeof reviewerId !== "string" || !AGENT_RE.test(reviewerId)) return fail("REVIEWER_INVALID");
    if (reviewerId === st.authorId) return fail("REVIEWER_MUST_DIFFER_FROM_AUTHOR");
    if (!identityOk(reviewerId)) return fail("UNKNOWN_AGENT");
    const rec = load(id); if (!rec || !recordIntact(rec, st)) { audit.append("CHANGE_RECORD_TAMPERED", { id }); return fail("CHANGE_RECORD_TAMPERED"); }
    const pr = projectRoot(rec.project); if (!pr.ok) return pr;
    const subjectFiles = rec.files.filter(f => f.after !== null).map(f => ({ path: f.path, content: f.after }));
    const rv = subjectFiles.length ? reviewCode({ files: subjectFiles }) : { ok: true, verdict: "NO_FINDINGS_BY_THESE_RULES", counts: { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }, findings: [] };
    let verdict, counts = rv.counts ?? {}, findings = [];
    if (!rv.ok) { verdict = "FAIL"; findings = [{ rule: "REVIEW_ERROR", detail: String(rv.reason) }]; }
    else {
      findings = (rv.findings ?? []).slice(0, 30).map(f => ({ severity: f.severity, rule: f.rule ?? f.id ?? null, file: f.file, line: f.line ?? null }));
      verdict = rv.verdict === "BLOCK" || (counts.HIGH ?? 0) > 0 ? "FAIL" : rv.verdict === "INCOMPLETE_REVIEW" ? "INCOMPLETE" : (counts.MEDIUM ?? 0) > 0 ? "PASS_WITH_WARNINGS" : "PASS";
    }
    let testSubject = null;      // the hash a test run will be approved against: the project as it will look after the change
    try { testSubject = plannedTestSubject(rec, pr.root); } catch { testSubject = null; }
    audit.append("CHANGE_REVIEWED", { id, digest: st.digest, reviewerId, verdict, counts, findings: findings.length, testSubject });
    return { ok: true, id, verdict, counts, findings, reviewerId, testSubject, approvable: verdict !== "FAIL", needsOwnerAttention: verdict === "INCOMPLETE" || verdict === "PASS_WITH_WARNINGS" };
  }
  function plannedTestSubject(rec, root) {
    const w = walkRepo(root); if (!w.ok) return null;
    const tmp = fs.mkdtempSync(path.join(scratchRoot, "edit-plan-"));
    try {
      for (const f of w.files) { const dst = path.join(tmp, ...f.rel.split("/")); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(f.abs, dst); }
      for (const f of rec.files) { const dst = path.join(tmp, ...f.path.split("/")); if (f.after === null) { try { fs.unlinkSync(dst); } catch { /* absent */ } } else { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, f.after); } }
      const a = analyzeRepo(tmp); return a.ok ? rec.project + "#" + a.hash : null;
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // ---------------------------------------------------------------- snapshot / restore (bytes, modes, created folders)
  /** Folders this change will have to create (computed BEFORE any write, then pinned in the chain together with the file list). */
  const plannedDirs = (rec, root) => {
    const set = new Set();
    for (const f of rec.files) { if (f.op === "delete") continue; const segs = f.path.split("/").slice(0, -1); let cur = root; for (const sg of segs) { cur = path.join(cur, sg); if (!fs.existsSync(cur)) set.add(path.relative(root, cur).split(path.sep).join("/")); } }
    return [...set].sort();
  };
  const manifestDigest = m => sha(JSON.stringify({ files: m.files, createdDirs: m.createdDirs }));
  function takeSnapshot(rec, root) {
    const dir = path.join(snapDir, rec.id); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const files = rec.files.map((f, i) => {
      const cur = readExisting(resolveTarget(root, f.path) ?? "/nonexistent");
      if (!cur.ok) throw new Error("SNAPSHOT_UNREADABLE:" + f.path);
      if (cur.buf !== null) writeAtomic(path.join(dir, i + ".bak"), cur.buf);
      return { path: f.path, existed: cur.buf !== null, hash: cur.hash, mode: cur.mode };
    });
    const manifest = { id: rec.id, files, createdDirs: plannedDirs(rec, root) };
    writeAtomic(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    return { manifest, manifestSha: manifestDigest(manifest) };
  }
  const readManifest = (rec, st) => {
    const man = JSON.parse(fs.readFileSync(path.join(snapDir, rec.id, "manifest.json"), "utf8"));
    if (!Array.isArray(man.files) || man.files.length !== rec.files.length || !Array.isArray(man.createdDirs)) throw new Error("MANIFEST_SHAPE");
    if (!st?.manifestSha || manifestDigest(man) !== st.manifestSha) throw new Error("MANIFEST_NOT_PINNED");      // the chain pinned the manifest (files AND created folders) when the apply started
    man.files.forEach((m, i) => { if (m.path !== rec.files[i].path) throw new Error("MANIFEST_PATH_MISMATCH"); });      // restore paths always come from the verified record
    const prefixes = new Set(); for (const f of rec.files) { const segs = f.path.split("/").slice(0, -1); for (let i = 1; i <= segs.length; i++) prefixes.add(segs.slice(0, i).join("/")); }
    if (!man.createdDirs.every(d => typeof d === "string" && prefixes.has(d))) throw new Error("MANIFEST_DIRS");      // only folders on the way to a changed file can ever be removed
    return man;
  };
  /** rmdir for a folder only if every component is a real folder (no symlink) inside the project and it is empty. */
  const safeRmdir = (root, rel) => {
    let cur = root; for (const sg of rel.split("/")) { cur = path.join(cur, sg); let st; try { st = fs.lstatSync(cur); } catch { return; } if (st.isSymbolicLink() || !st.isDirectory()) return; }
    try { fs.rmdirSync(cur); } catch { /* not empty: left alone */ }
  };
  /** Remove leftovers of interrupted atomic writes of THIS change's files (name.<8 hex>.tmp). */
  const cleanTmp = (rec, root) => {
    for (const f of rec.files) { const abs = path.join(root, ...f.path.split("/")), dir = path.dirname(abs), base = path.basename(abs); let names = []; try { names = fs.readdirSync(dir); } catch { continue; }
      for (const n of names) if (n.startsWith(base + ".") && /\.[0-9a-f]{8}\.tmp$/.test(n) && n.length === base.length + 13) { try { const st = fs.lstatSync(path.join(dir, n)); if (st.isFile()) fs.unlinkSync(path.join(dir, n)); } catch { /* gone */ } } }
  };
  /** Restore only files that still hold exactly what the change wrote (or are already back at their base). Returns {errors, conflicts}. */
  function restoreSnapshot(rec, root, st, { force = false, partial = false } = {}) {
    const errors = [], conflicts = [], dir = path.join(snapDir, rec.id);
    let man; try { man = readManifest(rec, st); } catch (e) { return { errors: ["MANIFEST:" + String(e?.message ?? e).slice(0, 40)], conflicts }; }
    const plan = [];
    rec.files.forEach((f, i) => {
      const m = man.files[i], abs = resolveTarget(root, f.path);
      if (!abs) { errors.push(f.path + ":UNSAFE"); return; }
      const cur = readExisting(abs);
      if (!cur.ok) { errors.push(f.path + ":UNREADABLE"); return; }
      const atBase = m.existed ? cur.hash === m.hash : cur.buf === null;
      if (atBase) return;      // nothing to do
      const atAfter = f.op === "delete" ? cur.buf === null : cur.hash === f.afterHash;
      if (!atAfter && !force) { conflicts.push(f.path); return; }      // someone else changed it: never overwritten (partial mode leaves it and restores the rest)
      plan.push({ f, m, abs, i });
    });
    if (errors.length || (conflicts.length && !partial)) return { errors, conflicts };      // all-or-nothing unless the owner explicitly accepted a partial restore
    for (const { f, m, abs, i } of plan) {
      try {
        if (m.existed) {
          const buf = fs.readFileSync(path.join(dir, i + ".bak")); if (sha(buf) !== m.hash) throw new Error("SNAPSHOT_CORRUPT");
          fs.mkdirSync(path.dirname(abs), { recursive: true }); writeAtomic(abs, buf, m.mode ?? 0o644);
        } else { try { fs.unlinkSync(abs); } catch (e) { if (e?.code !== "ENOENT") throw e; } }
      } catch (e) { errors.push(f.path + ":" + String(e?.message ?? e).slice(0, 60)); }
    }
    for (const rel of [...man.createdDirs].sort((a, b) => b.length - a.length)) safeRmdir(root, rel);
    cleanTmp(rec, root);
    return { errors, conflicts };
  }
  const lockOf = project => path.join(stateDir, "project-" + project);

  // ---------------------------------------------------------------- apply
  async function apply(id, { ownerApproval = null, testApproval = null } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    let st = chainState(id); if (!st) return fail("CHANGE_NOT_FOUND");
    if (st.status !== "REVIEWED") return fail("CHANGE_NOT_REVIEWED:" + st.status);
    if (expired(st)) return fail("CHANGE_EXPIRED");
    if (st.verdict === "FAIL") return fail("REVIEW_VERDICT_FAIL");
    const rec = load(id); if (!rec || !recordIntact(rec, st)) { audit.append("CHANGE_RECORD_TAMPERED", { id }); return fail("CHANGE_RECORD_TAMPERED"); }
    const pr = projectRoot(rec.project); if (!pr.ok) return pr;
    const preflight = () => { for (const f of rec.files) { const abs = resolveTarget(pr.root, f.path); if (!abs) return fail("EDIT_PATH_UNSAFE:" + f.path); const cur = readExisting(abs); if (!cur.ok) return fail("EDIT_TARGET_UNREADABLE:" + f.path); if (cur.hash !== f.baseHash) return fail("CONFLICT:" + f.path); } return null; };
    { const pf = preflight(); if (pf) return pf; }
    let locked;
    try {
      locked = withFileLock(lockOf(rec.project), () => {
        st = chainState(id); if (!st || st.status !== "REVIEWED") return fail("CHANGE_NOT_REVIEWED:" + (st?.status ?? "GONE"));      // re-checked under the lock: two appliers cannot both pass
        const pf = preflight(); if (pf) return pf;
        const subj = editSubject(id, st.digest);
        // a forged, mis-bound or malformed approval is refused before any snapshot or log growth (signature, action and subject only; nothing is consumed here)
        if (typeof ownerAuth.verifyRecorded === "function" && !ownerAuth.verifyRecorded(ownerApproval, { action: "CODE_EDIT_APPLY", subject: subj })) { auditDenied("CHANGE_APPLY_DENIED", { id, reason: "APPROVAL_INVALID_OR_NOT_BOUND" }); return fail("OWNER_APPROVAL_REQUIRED:APPROVAL_INVALID_OR_NOT_BOUND", { subject: subj }); }
        let snap; try { snap = takeSnapshot(rec, pr.root); } catch { return fail("SNAPSHOT_FAILED"); }
        // the intent is recorded BEFORE the approval is spent: an approval can never vanish without a trace in the chain
        audit.append("CHANGE_APPLY_STARTED", { id, digest: st.digest, manifestSha: snap.manifestSha });
        const v = ownerAuth.verifyApproval(ownerApproval, { action: "CODE_EDIT_APPLY", subject: subj });
        if (!v.allowed) { audit.append("CHANGE_APPLY_ABORTED", { id, reason: v.reason }); return fail("OWNER_APPROVAL_REQUIRED:" + v.reason, { subject: subj }); }
        audit.append("CHANGE_APPLY_APPROVED", { id, nonce: v.nonce });
        const stNow = { ...st, manifestSha: snap.manifestSha, approved: true };
        try {
          for (const f of rec.files) {
            const abs = resolveTarget(pr.root, f.path); if (!abs) throw new Error("UNSAFE");
            if (onWrite) onWrite(f.path, rec.files.indexOf(f));
            if (f.op === "delete") fs.unlinkSync(abs);
            else { const cur = readExisting(abs); fs.mkdirSync(path.dirname(abs), { recursive: true }); writeAtomic(abs, f.after, cur.mode ?? 0o644); }
          }
          for (const f of rec.files) { const cur = readExisting(path.join(pr.root, ...f.path.split("/"))); const ok = f.op === "delete" ? cur.ok && cur.buf === null : cur.ok && cur.hash === f.afterHash; if (!ok) throw new Error("POST_HASH_MISMATCH"); }
          audit.append("CHANGE_APPLIED", { id, digest: st.digest, files: rec.files.map(f => f.path) });
        } catch (e) {
          const r = restoreSnapshot(rec, pr.root, stNow, { force: true });      // our own half-finished write: restoring is unconditional
          const clean = !r.errors.length && !r.conflicts.length;
          try { audit.append(clean ? "CHANGE_ROLLED_BACK" : "CHANGE_ROLLBACK_FAILED", { id, reason: "APPLY_FAILED", error: String(e?.message ?? e).slice(0, 80), restoreErrors: r.errors.length }); } catch { /* the failure is returned below */ }
          return fail(clean ? "APPLY_FAILED_ROLLED_BACK" : "APPLY_FAILED_ROLLBACK_INCOMPLETE", { restoreErrors: r.errors });
        }
        return { ok: true };
      });
    } catch (e) { return fail(e?.message === "LOCK_TIMEOUT" ? "PROJECT_BUSY" : "APPLY_ERROR"); }
    if (!locked.ok) return locked;
    // ---- tests (restricted launcher, content-bound approval) ----
    let t;
    try {
      const run = testRunner ?? (({ name, root, testApproval: ta }) => runRepoTests({ name, root, ownerAuth, ownerApproval: ta, isStopped, scratchRoot }));
      t = await run({ name: rec.project, root: pr.root, testApproval });
    } catch { t = { ok: false, reason: "TEST_RUNNER_ERROR" }; }
    const summary = { ran: t?.ran ?? 0, passed: t?.passed ?? 0, failed: t?.failed ?? 0, complete: t?.complete ?? false, reason: t?.ok ? null : String(t?.reason ?? "UNKNOWN").slice(0, 80), failures: (t?.results ?? []).filter(r => r.status !== "PASSED").slice(0, 5).map(r => ({ file: String(r.file ?? "").slice(0, 120), status: String(r.status ?? "").slice(0, 20), output: String(r.output ?? "").slice(-600) })) };
    const stillApplied = () => chainState(id)?.status === "APPLIED_UNTESTED";      // the owner may have rolled the change back while the tests ran
    if (t?.ok && t.ran > 0 && t.failed === 0 && t.complete && t.contentUnchanged !== false) {
      if (!stillApplied()) return { ok: false, id, status: chainState(id)?.status ?? null, reason: "STATE_CHANGED_DURING_TESTS", tests: summary };
      audit.append("CHANGE_TESTS_PASSED", { id, ran: t.ran, isolation: t.isolation ?? null, summary });
      return { ok: true, id, status: "APPLIED_TESTS_PASSED_IN_SANDBOX", tests: summary, note: "Test files exited 0 in the restricted launcher. This is not proof of correctness; nothing was committed or deployed." };
    }
    if (t?.ok && (t.failed > 0 || t.contentUnchanged === false)) {
      if (!stillApplied()) return { ok: false, id, status: chainState(id)?.status ?? null, reason: "STATE_CHANGED_DURING_TESTS", tests: summary };
      audit.append("CHANGE_TESTS_FAILED", { id, failed: t.failed, summary });
      const r = withFileLock(lockOf(rec.project), () => restoreSnapshot(rec, pr.root, chainState(id)));
      if (!r.errors.length && !r.conflicts.length) {
        audit.append("CHANGE_ROLLED_BACK", { id, reason: "TESTS_FAILED" });
        return { ok: false, id, status: "ROLLED_BACK_TESTS_FAILED", reason: "TESTS_FAILED_ROLLED_BACK", tests: summary, repair: "propose a new change with parentId=" + id };
      }
      if (r.errors.length) audit.append("CHANGE_ROLLBACK_FAILED", { id, reason: "TESTS_FAILED", restoreErrors: r.errors.length });
      return { ok: false, id, status: chainState(id)?.status ?? "APPLIED_TESTS_FAILED", reason: r.conflicts.length ? "TESTS_FAILED_ROLLBACK_BLOCKED_BY_OTHER_EDITS" : "TESTS_FAILED_ROLLBACK_INCOMPLETE", conflicts: r.conflicts, restoreErrors: r.errors, tests: summary, note: "Files edited since this change were left untouched. The owner can resolve this with rollback()." };
    }
    audit.append("CHANGE_TESTS_NOT_RUN", { id, reason: summary.reason ?? (t?.ran === 0 ? "NO_TEST_FILES" : "INCOMPLETE"), summary });
    return { ok: true, id, status: "APPLIED_UNTESTED", tests: summary, note: "The change is applied but NOT tested (" + (summary.reason ?? "no complete passing test run") + "). Do not treat it as verified." };
  }

  // ---------------------------------------------------------------- owner rollback
  /** partial:true = the owner accepts that files edited by someone else since stay as they are; everything still at this change's after-state is restored (subject edit:<id>:partial). */
  function rollback(id, { ownerApproval = null, partial = false } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    const st = chainState(id); if (!st) return fail("CHANGE_NOT_FOUND");
    if (!(st.status.startsWith("APPLIED") || st.status === "ROLLBACK_FAILED")) return fail("CHANGE_NOT_APPLIED:" + st.status);
    const rec = load(id); if (!rec || !recordIntact(rec, st)) return fail("CHANGE_RECORD_TAMPERED");
    const pr = projectRoot(rec.project); if (!pr.ok) return pr;
    const subject = "edit:" + id + (partial ? ":partial" : "");
    let out;
    try {
      out = withFileLock(lockOf(rec.project), () => {
        const cur0 = chainState(id); if (!cur0 || !(cur0.status.startsWith("APPLIED") || cur0.status === "ROLLBACK_FAILED")) return fail("CHANGE_NOT_APPLIED:" + (cur0?.status ?? "GONE"));
        let man; try { man = readManifest(rec, cur0); } catch { return fail("SNAPSHOT_UNUSABLE"); }
        if (!partial) for (const [i, f] of rec.files.entries()) { const cur = readExisting(resolveTarget(pr.root, f.path) ?? "/nonexistent"); const m = man.files[i]; const atBase = cur.ok && (m.existed ? cur.hash === m.hash : cur.buf === null); const atAfter = cur.ok && (f.op === "delete" ? cur.buf === null : cur.hash === f.afterHash); if (!atAfter && !atBase) return fail("CONFLICT_MODIFIED_SINCE:" + f.path); }
        const v = ownerAuth.verifyApproval(ownerApproval, { action: "CODE_EDIT_ROLLBACK", subject });
        if (!v.allowed) { auditDenied("CHANGE_ROLLBACK_DENIED", { id, reason: v.reason }); return fail("OWNER_APPROVAL_REQUIRED:" + v.reason); }
        const r = restoreSnapshot(rec, pr.root, cur0, { partial });
        if (r.errors.length || (r.conflicts.length && !partial)) { audit.append("CHANGE_ROLLBACK_FAILED", { id, reason: "OWNER", restoreErrors: r.errors.length, conflicts: r.conflicts.length, nonce: v.nonce }); return fail("ROLLBACK_INCOMPLETE", { restoreErrors: r.errors, conflicts: r.conflicts }); }
        audit.append("CHANGE_ROLLED_BACK", { id, reason: "OWNER", partial, leftAlone: r.conflicts.length, nonce: v.nonce });
        return { ok: true, id, status: "ROLLED_BACK_BY_OWNER", partial, leftAlone: r.conflicts };
      });
    } catch (e) { return fail(e?.message === "LOCK_TIMEOUT" ? "PROJECT_BUSY" : "ROLLBACK_ERROR"); }
    return out;
  }

  // ---------------------------------------------------------------- crash recovery (no new approval: it only completes or undoes what was already approved)
  function recover(id) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    const st0 = chainState(id); if (!st0) return fail("CHANGE_NOT_FOUND");
    if (st0.status !== "APPLYING") return fail("CHANGE_NOT_INTERRUPTED:" + st0.status);
    const rec = load(id); if (!rec || !recordIntact(rec, st0)) return fail("CHANGE_RECORD_TAMPERED");
    const pr = projectRoot(rec.project); if (!pr.ok) return pr;
    try {
      return withFileLock(lockOf(rec.project), () => {
        const st = chainState(id); if (!st || st.status !== "APPLYING") return fail("CHANGE_NOT_INTERRUPTED:" + (st?.status ?? "GONE"));      // a live apply that held the lock may have finished meanwhile
        if (!st.approved) { audit.append("CHANGE_APPLY_ABORTED", { id, reason: "NO_APPROVAL_RECORDED", recovered: true }); cleanTmp(rec, pr.root); return { ok: true, id, status: "REVIEWED", recovered: "NEVER_APPROVED" }; }      // nothing was written: the change is simply open again
        const allAfter = rec.files.every(f => { const cur = readExisting(resolveTarget(pr.root, f.path) ?? "/nonexistent"); return f.op === "delete" ? cur.ok && cur.buf === null : cur.ok && cur.hash === f.afterHash; });
        if (allAfter) { audit.append("CHANGE_APPLIED", { id, digest: st.digest, files: rec.files.map(f => f.path), recovered: true }); return { ok: true, id, status: "APPLIED_UNTESTED", recovered: "COMPLETED" }; }
        const r = restoreSnapshot(rec, pr.root, st, { force: false });
        if (r.errors.length || r.conflicts.length) { audit.append("CHANGE_ROLLBACK_FAILED", { id, reason: "RECOVERY", restoreErrors: r.errors.length, conflicts: r.conflicts.length }); return fail("RECOVERY_INCOMPLETE", { restoreErrors: r.errors, conflicts: r.conflicts, next: "owner rollback with partial:true restores what is still ours" }); }
        audit.append("CHANGE_ROLLED_BACK", { id, reason: "APPLY_FAILED", recovered: true });
        return { ok: true, id, status: "ROLLED_BACK_APPLY_FAILED", recovered: "UNDONE" };
      });
    } catch (e) { return fail(e?.message === "LOCK_TIMEOUT" ? "PROJECT_BUSY" : "RECOVERY_ERROR"); }
  }

  function withdraw(id, { actorId } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    const st0 = chainState(id); if (!st0) return fail("CHANGE_NOT_FOUND");
    try {
      return withFileLock(lockOf(st0.project), () => {      // same lock as apply: a change cannot be withdrawn while it is being applied
        const st = chainState(id); if (!st) return fail("CHANGE_NOT_FOUND");
        if (st.status !== "PROPOSED" && st.status !== "REVIEWED") return fail("CHANGE_NOT_OPEN:" + st.status);
        if (typeof actorId !== "string" || !(actorId === st.authorId || (actorId === "OWNER" && allowOwnerIdentity))) return fail("ONLY_THE_AUTHOR_OR_OWNER_MAY_WITHDRAW");
        audit.append("CHANGE_WITHDRAWN", { id, actorId });
        return { ok: true, id, status: "WITHDRAWN" };
      });
    } catch (e) { return fail(e?.message === "LOCK_TIMEOUT" ? "PROJECT_BUSY" : "WITHDRAW_ERROR"); }
  }

  const view = s => (expired(s) ? { ...s, status: "EXPIRED" } : s);
  const status = id => { const s = chainState(id); return s ? { id, ...view(s) } : null; };
  function evidence(id) {
    const s = chainState(id); if (!s) return null;
    const v = view(s);
    return { id, status: v.status, project: s.project, authorId: s.authorId, reviewerId: s.reviewerId ?? null, verdict: s.verdict ?? null, attempt: s.attempt, parentId: s.parentId, digest: s.digest, events: audit.entries().filter(e => e.data?.id === id).map(e => ({ seq: e.seq, at: e.at, event: e.event })), auditHead: audit.head() };
  }
  const list = () => [...allStates().entries()].map(([id, s]) => ({ id, ...view(s) }));
  // a broken audit chain, unreadable state or any unexpected error is a refusal, never an exception and never a silent success
  const safe = fn => (...a) => { try { const r = fn(...a); return r && typeof r.then === "function" ? r.catch(() => fail("WORKFLOW_ERROR")) : r; } catch { return fail("WORKFLOW_ERROR"); } };
  return {
    propose: safe(propose), review: safe(review), apply: safe(apply), rollback: safe(rollback), recover: safe(recover), withdraw: safe(withdraw),
    status: id => { try { return status(id); } catch { return null; } }, evidence: id => { try { return evidence(id); } catch { return null; } }, list: () => { try { return list(); } catch { return []; } },
    auditVerify: () => audit.verify(), auditEntries: () => audit.entries(),
    summary: () => { try { const l = list(), by = {}; for (const x of l) by[x.status] = (by[x.status] ?? 0) + 1; return { changes: l.length, byStatus: by, auditHead: audit.head() }; } catch { return { changes: 0, byStatus: {}, error: "AUDIT_UNAVAILABLE" }; } }
  };
}
