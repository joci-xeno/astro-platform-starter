// Governed repository analysis + sandboxed test run (85-capability audit C01 Coding-agent workspace; the governed-read and sandboxed-run slice).
// What this is: a READ-ONLY look at a folder tree the caller points at (the Control Center only offers folders under <config>/repos/<name>), plus an optional run of its Node test files
// inside the restricted launcher. What it is NOT: it never edits the repo, never installs dependencies, never runs a package manager or shell, never reaches the network, and does not push or open
// pull requests (edits to a real repository remain owner-approved work outside this module; that part of C01 is NOT implemented).
//   * Walk rules: lstat everywhere, symlinks and special files are skipped (reported), .git/node_modules/hidden dirs are skipped, hard caps on files/bytes/depth.
//   * Review: the same deterministic rules as code-review.mjs on the source files (secrets are redacted in every output).
//   * Test run: each test file is executed as its own Node process under `--permission` (read-only repo, scratch dir for writes, NO child processes, NO network namespace-or-refuse).
//     Needs the OWNER's signed approval for REPO_TEST_RUN bound to "<name>#<content hash of the analysed files>"; a changed file needs a new approval. Results are untrusted text, size-capped and redacted.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { restrictedNodeCommand } from "./restricted-node.mjs";
import { reviewCode } from "./code-review.mjs";
import { redactSecrets } from "./text-compare.mjs";

export const LIMITS = Object.freeze({ maxFiles: 3000, maxDepth: 10, maxFileBytes: 1048576, maxTotalBytes: 30 * 1048576, reviewFiles: 200, reviewFileChars: 200000, maxTestFiles: 20, testTimeoutMs: 20000, outputChars: 4000, maxScripts: 20 });
const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", "coverage", "__pycache__", ".venv", "venv"]);
const LANG = { ".mjs": "JavaScript", ".cjs": "JavaScript", ".js": "JavaScript", ".jsx": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript", ".py": "Python", ".sh": "Shell", ".bash": "Shell", ".rb": "Ruby", ".go": "Go", ".java": "Java", ".php": "PHP", ".cs": "C#", ".json": "JSON", ".md": "Markdown", ".html": "HTML", ".css": "CSS", ".yml": "YAML", ".yaml": "YAML" };
const SOURCE = /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts|vue|svelte|py|sh|bash|rb|go|java|php|cs|json|ya?ml|toml|ini|cfg|conf|properties|xml|html?|txt|md|env|sql|tf)$/i, LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json)$/i, INERT = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|otf|map|pdf|zip|gz|mp3|mp4|wav)$/i, TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/.*\.(mjs|cjs|js)$|\.(test|spec)\.(mjs|cjs|js)$/i;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/** Walk a repo folder. Returns {ok, files:[{rel, abs, size}], skipped:{...}} or {ok:false, reason}. */
export function walkRepo(root) {
  let st; try { st = fs.lstatSync(root); } catch { return { ok: false, reason: "REPO_NOT_FOUND" }; }
  if (!st.isDirectory()) return { ok: false, reason: "REPO_MUST_BE_A_REAL_DIRECTORY" };
  const files = [], skipped = { symlinks: 0, special: 0, oversize: 0, dirs: 0, hidden: 0, vcs: 0, unreadable: 0 }; let total = 0, capped = false;
  const visit = (d, depth) => {
    if (depth > LIMITS.maxDepth) { capped = true; return; }
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)); } catch { skipped.unreadable++; return; }   // an unreadable folder is reported, never silently treated as empty
    for (const e of ents) {
      if (capped) return;
      const abs = path.join(d, e.name), rel = path.relative(root, abs).split(path.sep).join("/"); let s; try { s = fs.lstatSync(abs); } catch { continue; }
      if (s.isSymbolicLink()) { skipped.symlinks++; continue; }
      if (s.isDirectory()) { if (e.name === ".git" || e.name === ".hg" || e.name === ".svn") { skipped.vcs++; continue; } if (SKIP_DIRS.has(e.name)) { skipped.dirs++; continue; } if (e.name.startsWith(".")) { skipped.hidden++; continue; } visit(abs, depth + 1); continue; }
      if (!s.isFile()) { skipped.special++; continue; }
      if (e.name.startsWith(".") && e.name !== ".gitignore") { skipped.hidden++; continue; }
      if (s.size > LIMITS.maxFileBytes) { skipped.oversize++; continue; }
      if (files.length >= LIMITS.maxFiles || total + s.size > LIMITS.maxTotalBytes) { capped = true; return; }
      total += s.size; files.push({ rel, abs, size: s.size });
    }
  };
  visit(root, 0);
  return { ok: true, files, skipped, bytes: total, capped };
}
const contentHash = files => { const h = createHash("sha256"); for (const f of files) h.update(f.rel + "\0" + createHash("sha256").update(fs.readFileSync(f.abs)).digest("hex") + "\n"); return h.digest("hex"); };
const reviewable = p => typeof p === "string" && p.length > 0 && p.length <= 240 && !/[\0\\]/.test(p) && !/^[A-Za-z]:/.test(p) && !/(^|\/)\.\.(\/|$)/.test(p);   // what reviewCode accepts as a path; anything else is reported as notReviewed.badPath instead of aborting the whole review
const isText = buf => !buf.subarray(0, 4096).includes(0);

/** Read-only analysis: inventory, languages, tests, package scripts and a static review of the source files. */
export function analyzeRepo(root) {
  const w = walkRepo(root); if (!w.ok) return w;
  let hash; try { hash = contentHash(w.files); } catch { return { ok: false, reason: "FILE_UNREADABLE" }; }          // one unreadable file is a refusal, never an exception
  const langs = {}, tests = []; let lines = 0;
  const review = [], notReviewed = { oversize: 0, binary: 0, pastFileLimit: 0, pastTotalLimit: 0, unreadable: 0, unsupported: 0, badPath: 0 }; let reviewedChars = 0;
  for (const f of w.files) {
    const ext = path.extname(f.rel).toLowerCase(), lang = LANG[ext]; if (lang) langs[lang] = (langs[lang] ?? 0) + 1;
    if (TEST_FILE.test(f.rel)) tests.push(f.rel);
    if (!SOURCE.test(f.rel) || LOCKFILE.test(f.rel)) { if (!INERT.test(f.rel) && !LOCKFILE.test(f.rel) && !/(^|\/)(LICENSE|COPYING|NOTICE)[^/]*$/i.test(f.rel)) notReviewed.unsupported++; continue; }   // unknown file types are counted, not ignored
    if (!reviewable(f.rel)) { notReviewed.badPath++; continue; }
    if (review.length >= LIMITS.reviewFiles) { notReviewed.pastFileLimit++; continue; }
    if (f.size > LIMITS.reviewFileChars) { notReviewed.oversize++; continue; }
    if (reviewedChars + f.size > 1900000) { notReviewed.pastTotalLimit++; continue; }
    let b; try { b = fs.readFileSync(f.abs); } catch { notReviewed.unreadable++; continue; }
    if (!isText(b)) { notReviewed.binary++; continue; }
    const c = b.toString("utf8"); if (c.length > LIMITS.reviewFileChars) { notReviewed.oversize++; continue; }
    reviewedChars += c.length; lines += c.split("\n").length; review.push({ path: f.rel, content: c });
  }
  let pkg = null; const pj = w.files.find(f => f.rel === "package.json");
  if (pj) { try { const j = JSON.parse(fs.readFileSync(pj.abs, "utf8")); pkg = { name: typeof j.name === "string" ? redactSecrets(j.name).slice(0, 100) : null, version: typeof j.version === "string" ? redactSecrets(j.version).slice(0, 40) : null, scripts: Object.fromEntries(Object.entries(j.scripts ?? {}).slice(0, LIMITS.maxScripts).map(([k, v]) => [k.slice(0, 40), redactSecrets(String(v)).slice(0, 200)])), dependencies: Object.keys(j.dependencies ?? {}).length, devDependencies: Object.keys(j.devDependencies ?? {}).length }; } catch { pkg = { error: "PACKAGE_JSON_UNREADABLE" }; } }
  const rv0 = review.length ? reviewCode({ files: review }) : { ok: true, verdict: "NO_FINDINGS_BY_THESE_RULES", counts: { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }, findings: [], truncated: false, tests: { testFiles: [], sourceFiles: 0, untested: [] }, notes: [] };
  const rv = rv0.ok ? rv0 : { ...rv0, verdict: "INCOMPLETE_REVIEW", counts: { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }, findings: [], truncated: true, tests: { testFiles: [], sourceFiles: 0, untested: [] }, notes: ["REVIEW_FAILED:" + rv0.reason] };
  const skippedTotal = Object.values(notReviewed).reduce((x, y) => x + y, 0), sk0 = w.skipped, unseen = w.capped || skippedTotal > 0 || (sk0.oversize + sk0.symlinks + sk0.special + sk0.dirs + sk0.hidden + (sk0.vcs ?? 0) + (sk0.unreadable ?? 0)) > 0;   // hidden, linked, special and vendored parts were not looked at either
  if (!review.length && !unseen && rv.verdict === "NO_FINDINGS_BY_THESE_RULES") rv.verdict = "NOTHING_REVIEWED";             // an empty or non-source tree has no findings only because nothing was read
  if (unseen && !["BLOCK"].includes(rv.verdict)) rv.verdict = "INCOMPLETE_REVIEW";            // "no findings" must never be reported when part of the tree was not looked at
  return { ok: true, untrusted: true, files: w.files.length, bytes: w.bytes, capped: w.capped, skipped: w.skipped, languages: langs, sourceLinesReviewed: lines, notReviewed, testFiles: tests.map(t => redactSecrets(t)), package: pkg,
    hash, review: { verdict: rv.verdict, coverage: { reviewed: review.length, notReviewed, skippedOversizeFiles: w.skipped.oversize, treeCapped: w.capped }, counts: rv.counts, findings: rv.findings.slice(0, 100).map(f => ({ ...f, file: redactSecrets(f.file) })), untested: rv.tests.untested.slice(0, 100).map(u => redactSecrets(u)), truncated: rv.truncated, notes: rv.notes },
    note: "Read-only analysis of files as found. Nothing was executed, installed or modified. Repository content is untrusted data." };
}

/** Run each Node test file in the restricted launcher. Owner approval bound to the analysed content hash. */
export async function runRepoTests({ name, root, ownerAuth, ownerApproval = null, isStopped = () => false, nodeBin = process.execPath, caps = null, timeoutMs = LIMITS.testTimeoutMs, scratchRoot = os.tmpdir() } = {}) {
  if (typeof name !== "string" || !NAME.test(name)) return { ok: false, reason: "REPO_NAME_INVALID" };
  if (!ownerAuth) return { ok: false, reason: "OWNER_AUTH_REQUIRED" };
  let stopped = true; try { stopped = Boolean(isStopped()); } catch { /* fail closed */ }
  if (stopped) return { ok: false, reason: "OWNER_STOP_OR_SAFE_MODE_ACTIVE" };
  const a = analyzeRepo(root); if (!a.ok) return a;
  const sk = a.skipped, unhashed = { symlinks: sk.symlinks, special: sk.special, oversize: sk.oversize, dirs: sk.dirs, hidden: sk.hidden, vcs: sk.vcs ?? 0, unreadable: sk.unreadable ?? 0, capped: a.capped ? 1 : 0 };
  if (Object.values(unhashed).some(n => n > 0)) return { ok: false, reason: "UNHASHED_CONTENT_PRESENT", unhashed, note: "Part of the tree (symlinks, oversize or hidden files, node_modules/dist/build, a capped walk) is not covered by the content hash the owner approves, and the tests could read or run it. Remove it or test a clean copy." };
  const v = ownerAuth.verifyApproval(ownerApproval, { action: "REPO_TEST_RUN", subject: name + "#" + a.hash });
  if (!v.allowed) return { ok: false, reason: "OWNER_APPROVAL_REQUIRED:" + v.reason, subject: name + "#" + a.hash };
  const targets = a.testFiles.slice(0, LIMITS.maxTestFiles); if (!targets.length) return { ok: true, hash: a.hash, contentUnchanged: true, ran: 0, results: [], note: "No Node test files found (tests/ folder, *.test.mjs/js, *.spec.mjs/js)." };
  const results = []; let level = null;
  for (const rel of targets) {
    { const cur = analyzeRepo(root); if (!cur.ok || cur.hash !== a.hash) return { ok: false, reason: "CONTENT_CHANGED_DURING_RUN", results, approvedHash: a.hash }; }   // the approval covers exactly this content: re-verified before every file
    const scratch = fs.mkdtempSync(path.join(scratchRoot, "repo-test-"));
    const rc = restrictedNodeCommand({ nodeBin, script: path.join(root, rel), readDirs: [root, scratch], writeDirs: [scratch], allowNetwork: false, requireNoNetwork: true, caps, env: { TMPDIR: scratch, ATLASZ_REPO_TEST: "1" } });
    if (!rc.ok) { fs.rmSync(scratch, { recursive: true, force: true }); return { ok: false, reason: rc.reason, results }; }       // fail closed: never run unrestricted
    level = rc.level;
    results.push(await new Promise(resolve => {
      let out = "", done = false; const t0 = Date.now();
      const fin = r => { if (done) return; done = true; clearTimeout(timer); fs.rmSync(scratch, { recursive: true, force: true }); resolve({ file: rel, durationMs: Date.now() - t0, ...r }); };
      let child; try { child = spawn(rc.cmd, rc.args, { cwd: root, env: rc.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }); } catch { return fin({ status: "ERROR", exitCode: null, output: "SPAWN_FAILED" }); }
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } fin({ status: "TIMEOUT", exitCode: null, output: redactSecrets(out).slice(-LIMITS.outputChars) }); }, timeoutMs);
      const take = d => { if (out.length < LIMITS.outputChars * 4) out += d; };
      child.stdout.on("data", take); child.stderr.on("data", take);
      child.on("error", () => fin({ status: "ERROR", exitCode: null, output: "PROCESS_ERROR" }));
      child.on("close", code => fin({ status: code === 0 ? "PASSED" : "FAILED", exitCode: code, output: redactSecrets(out).slice(-LIMITS.outputChars) }));
    }));
  }
  const failed = results.filter(r => r.status !== "PASSED").length;
  const after = analyzeRepo(root), unchanged = after.ok && after.hash === a.hash;
  return { ok: true, untrusted: true, hash: a.hash, contentUnchanged: unchanged, ran: results.length, passed: results.length - failed, failed, results, isolation: level, note: "Each file ran alone in a read-only, no-child-process sandbox with no network (note: this does not cover unix sockets reachable through the filesystem, and there is no disk quota on the scratch folder). A pass means the file exited 0 here, not that the repo is correct." };
}
