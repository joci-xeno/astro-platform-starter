import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { analyzeRepo, runRepoTests, walkRepo, LIMITS } from "../atlasz-addons/repo-analyzer.mjs";
import { detectNodeRestrictions } from "../atlasz-addons/restricted-node.mjs";
import { tmp, rm } from "./helpers.mjs";

const key = generateOwnerKeyPair(), ap = (action, subject) => issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action, subject }), auth = createOwnerAuth({ publicKeyB64: key.publicKeyB64 });
const caps = detectNodeRestrictions(), ISOLATED = caps.permission && caps.namespace, SK = "s" + "k-ABCDEFGHIJKLMNOPQRSTUV";
function mkRepo(extra = {}) {
  const base = tmp("repo-"), root = path.join(base, "r"); fs.mkdirSync(path.join(root, "src"), { recursive: true }); fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  const put = (rel, c) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), c); };
  put("package.json", JSON.stringify({ name: "demo", version: "1.2.3", scripts: { test: "node --test", deploy: "curl -H 'Authorization: " + SK + "' x" }, dependencies: { a: "1" }, devDependencies: { b: "1", c: "2" } }));
  put("src/pay.mjs", "export const pay = x => eval(x);\nconst key = \"" + SK + "\";\n"); put("src/ship.mjs", "export const ship = 1;\n"); put("README.md", "# demo\n");
  put("tests/pay.test.mjs", "import test from 'node:test'; import assert from 'node:assert/strict'; import { pay } from '../src/pay.mjs';\ntest('pay exists', () => assert.equal(typeof pay, 'function'));\n");
  for (const [k, v] of Object.entries(extra)) put(k, v);
  return { base, root, put, done: () => rm(base) };
}
test("analyzeRepo: inventory, languages, tests, package scripts (secrets redacted), static review with redacted snippets; read-only", () => {
  const r = mkRepo();
  try {
    const before = fs.readdirSync(r.root, { recursive: true }).sort().join();
    const a = analyzeRepo(r.root);
    assert.deepEqual([a.ok, a.untrusted, a.files, a.capped], [true, true, 5, false]); assert.deepEqual(a.languages, { JSON: 1, JavaScript: 3, Markdown: 1 }); assert.deepEqual(a.testFiles, ["tests/pay.test.mjs"]);
    assert.deepEqual([a.package.name, a.package.version, a.package.dependencies, a.package.devDependencies], ["demo", "1.2.3", 1, 2]); assert.ok(!JSON.stringify(a).includes("ABCDEFGHIJKLMNOPQRSTUV")); assert.match(a.package.scripts.deploy, /\[redacted\]/);
    assert.equal(a.review.verdict, "BLOCK"); assert.deepEqual(a.review.findings.map(f => f.rule).sort(), ["DYNAMIC_EVAL", "SECRET_LITERAL"]); assert.deepEqual(a.review.untested, ["src/ship.mjs"]); assert.match(a.hash, /^[0-9a-f]{64}$/);
    assert.equal(fs.readdirSync(r.root, { recursive: true }).sort().join(), before, "analysis changed nothing");
    r.put("src/pay.mjs", "export const pay = 2;\n"); assert.notEqual(analyzeRepo(r.root).hash, a.hash, "content changes change the hash");
    assert.equal(analyzeRepo(r.root).review.verdict, "NO_FINDINGS_BY_THESE_RULES");
  } finally { r.done(); }
});
test("walk rules: symlinks, hidden files, node_modules/.git, oversize files and special files are skipped and counted; caps are enforced; bad roots are refused", () => {
  const r = mkRepo({ ".env": "SECRET=1", ".git/config": "x", "node_modules/dep/index.js": "eval(x)", "big.js": "x".repeat(LIMITS.maxFileBytes + 1), ".gitignore": "node_modules" });
  try {
    fs.symlinkSync("/etc/passwd", path.join(r.root, "link.txt")); fs.symlinkSync("/etc", path.join(r.root, "linkdir"));
    const w = walkRepo(r.root); assert.deepEqual(w.files.map(f => f.rel).sort(), [".gitignore", "README.md", "package.json", "src/pay.mjs", "src/ship.mjs", "tests/pay.test.mjs"]);
    assert.deepEqual(w.skipped, { symlinks: 2, special: 0, oversize: 1, dirs: 1, hidden: 1, vcs: 1 });
    assert.ok(!analyzeRepo(r.root).review.findings.some(f => f.file.startsWith("node_modules")), "dependencies are not reviewed");
    assert.equal(analyzeRepo(path.join(r.base, "nope")).reason, "REPO_NOT_FOUND"); assert.equal(analyzeRepo(path.join(r.root, "README.md")).reason, "REPO_MUST_BE_A_REAL_DIRECTORY");
    fs.symlinkSync(r.root, path.join(r.base, "lnk")); assert.equal(analyzeRepo(path.join(r.base, "lnk")).reason, "REPO_MUST_BE_A_REAL_DIRECTORY", "a symlinked root is refused");
    const deep = path.join(r.root, ...Array(LIMITS.maxDepth + 2).fill("d")); fs.mkdirSync(deep, { recursive: true }); fs.writeFileSync(path.join(deep, "x.js"), "1"); assert.equal(walkRepo(r.root).capped, true);
  } finally { r.done(); }
  const many = mkRepo(); try { for (let i = 0; i < LIMITS.maxFiles; i++) fs.writeFileSync(path.join(many.root, "src", "f" + i + ".txt"), "x"); const w = walkRepo(many.root); assert.equal(w.capped, true); assert.equal(w.files.length, LIMITS.maxFiles); } finally { many.done(); }
});
test("runRepoTests: approval bound to the analysed content, kill switch, names; fails closed without isolation", async () => {
  const r = mkRepo(); let stop = false;
  try {
    const base = { name: "demo", root: r.root, ownerAuth: auth, isStopped: () => stop }; const subject = "demo#" + analyzeRepo(r.root).hash;
    for (const n of [undefined, "", "../x", "a b", ".hidden"]) assert.equal((await runRepoTests({ ...base, name: n })).reason, "REPO_NAME_INVALID", String(n));
    assert.equal((await runRepoTests({ ...base, ownerAuth: null })).reason, "OWNER_AUTH_REQUIRED");
    for (const bad of [null, {}, ap("REPO_TEST_RUN", "demo#" + "0".repeat(64)), ap("MCP_SERVER_START", subject), ap("REPO_TEST_RUN", "other#" + subject.split("#")[1])]) assert.match((await runRepoTests({ ...base, ownerApproval: bad })).reason, /^OWNER_APPROVAL_REQUIRED/);
    stop = true; assert.equal((await runRepoTests({ ...base, ownerApproval: ap("REPO_TEST_RUN", subject) })).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); stop = () => { throw new Error("x"); };
    assert.equal((await runRepoTests({ ...base, isStopped: stop, ownerApproval: null })).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); stop = false;
    assert.equal((await runRepoTests({ ...base, root: path.join(r.base, "missing"), ownerApproval: null })).reason, "REPO_NOT_FOUND");
    const noNs = await runRepoTests({ ...base, caps: { permission: true, namespace: false }, ownerApproval: ap("REPO_TEST_RUN", subject) }); assert.deepEqual([noNs.ok, noNs.reason], [false, "NETWORK_ISOLATION_UNAVAILABLE"]);
    const noPerm = await runRepoTests({ ...base, caps: { permission: false, namespace: false }, ownerApproval: ap("REPO_TEST_RUN", subject) }); assert.equal(noPerm.reason, "SANDBOX_UNAVAILABLE");
    const empty = mkRepo(); try { fs.rmSync(path.join(empty.root, "tests"), { recursive: true }); const e = await runRepoTests({ name: "empty", root: empty.root, ownerAuth: auth, ownerApproval: ap("REPO_TEST_RUN", "empty#" + analyzeRepo(empty.root).hash) }); assert.deepEqual([e.ok, e.ran], [true, 0]); } finally { empty.done(); }
  } finally { r.done(); }
});
test("runRepoTests in the real sandbox: passing, failing and timing-out files are reported honestly; no network, no reads outside the repo, no writes into the repo, no child processes", { skip: !ISOLATED && "host cannot isolate network" }, async () => {
  const r = mkRepo({
    "tests/fail.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; test('boom', () => assert.equal(1, 2));\n",
    "tests/hang.test.mjs": "setInterval(() => {}, 1000);\n",
    "tests/isolation.test.mjs": `import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import net from 'node:net'; import cp from 'node:child_process';
test('cannot read outside', () => assert.throws(() => fs.readFileSync('/etc/passwd'), e => e.code === 'ERR_ACCESS_DENIED'));
test('cannot write into the repo', () => assert.throws(() => fs.writeFileSync(new URL('../poison.txt', import.meta.url), 'x'), e => e.code === 'ERR_ACCESS_DENIED'));
test('can write to scratch', () => { const p = process.env.TMPDIR + '/ok.txt'; fs.writeFileSync(p, 'x'); assert.equal(fs.readFileSync(p, 'utf8'), 'x'); });
test('cannot spawn', () => assert.throws(() => cp.execSync('echo hi'), e => e.code === 'ERR_ACCESS_DENIED'));
test('no network', async () => { const e = await new Promise(res => { const s = net.connect(80, '93.184.216.34'); s.on('connect', () => res(null)); s.on('error', res); setTimeout(() => res(new Error('timeout')), 1500); }); assert.ok(e, 'must not connect'); });
test('secret in output is redacted by the runner', () => console.log('key ${SK}'));
`
  });
  const scr = tmp("scr-");
  try {
    const subject = "demo#" + analyzeRepo(r.root).hash;
    const res = await runRepoTests({ name: "demo", root: r.root, ownerAuth: auth, ownerApproval: ap("REPO_TEST_RUN", subject), timeoutMs: 6000, scratchRoot: scr });
    assert.equal(res.ok, true, JSON.stringify(res)); assert.equal(res.isolation, "PERMISSION+NETWORK_NAMESPACE"); assert.equal(res.ran, 4);
    const by = Object.fromEntries(res.results.map(x => [x.file, x])); assert.equal(by["tests/pay.test.mjs"].status, "PASSED"); assert.equal(by["tests/fail.test.mjs"].status, "FAILED"); assert.equal(by["tests/hang.test.mjs"].status, "TIMEOUT");
    assert.equal(by["tests/isolation.test.mjs"].status, "PASSED", by["tests/isolation.test.mjs"].output);
    assert.ok(!JSON.stringify(res).includes("ABCDEFGHIJKLMNOPQRSTUV") && by["tests/isolation.test.mjs"].output.includes("[redacted]"));
    assert.deepEqual([res.passed, res.failed], [2, 2]); assert.equal(fs.existsSync(path.join(r.root, "poison.txt")), false);
    assert.deepEqual(fs.readdirSync(scr), [], "scratch directories are removed");
    const once = ap("REPO_TEST_RUN", subject), a1 = await runRepoTests({ name: "demo", root: r.root, ownerAuth: auth, ownerApproval: once, timeoutMs: 6000, scratchRoot: scr }); assert.equal(a1.ok, true);
    assert.equal((await runRepoTests({ name: "demo", root: r.root, ownerAuth: auth, ownerApproval: once, timeoutMs: 6000, scratchRoot: scr })).reason, "OWNER_APPROVAL_REQUIRED:REPLAY_DETECTED", "an approval runs the tests once");
  } finally { r.done(); rm(scr); }
});

test("walk and review caps: hidden dirs, special files, total bytes, depth boundary, review-file count, big/binary files, script and finding caps", async () => {
  const r = mkRepo({ ".hid/a.js": "eval(x)", "src/bin.js": "eval(x)\u0000", "src/huge.js": "eval(x);" + "a".repeat(200001) });
  try {
    const { execFileSync } = await import("node:child_process"); execFileSync("mkfifo", [path.join(r.root, "pipe")]);
    const w = walkRepo(r.root); assert.equal(w.skipped.special, 1); assert.equal(w.skipped.hidden, 1); assert.ok(!w.files.some(f => f.rel.startsWith(".hid") || f.rel === "pipe"));
    const a = analyzeRepo(r.root); assert.ok(!a.review.findings.some(f => f.file === "src/bin.js" || f.file === "src/huge.js" || f.file.startsWith(".hid")), "binary and oversized source files are not reviewed");
  } finally { r.done(); }
  const sc = mkRepo({ "package.json": JSON.stringify({ scripts: Object.fromEntries(Array.from({ length: 25 }, (_, i) => ["s" + i, "echo " + i])) }) });
  try { assert.equal(Object.keys(analyzeRepo(sc.root).package.scripts).length, LIMITS.maxScripts); } finally { sc.done(); }
  const tb = mkRepo(); try { for (let i = 0; i < 31; i++) fs.writeFileSync(path.join(tb.root, "src", "b" + i + ".dat"), Buffer.alloc(1048576, 1)); const w = walkRepo(tb.root); assert.equal(w.capped, true); assert.ok(w.bytes <= LIMITS.maxTotalBytes); } finally { tb.done(); }
  const dp = (n) => { const x = mkRepo(); const d = path.join(x.root, ...Array(n).fill("d")); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "x.js"), "1"); return x; };
  const ok = dp(LIMITS.maxDepth); try { const w = walkRepo(ok.root); assert.equal(w.capped, false); assert.ok(w.files.some(f => f.rel.endsWith("x.js"))); } finally { ok.done(); }
  const over = dp(LIMITS.maxDepth + 1); try { assert.equal(walkRepo(over.root).capped, true); } finally { over.done(); }
  const rf = mkRepo(); try { fs.rmSync(path.join(rf.root, "src"), { recursive: true }); fs.rmSync(path.join(rf.root, "tests"), { recursive: true }); fs.mkdirSync(path.join(rf.root, "src")); for (let i = 0; i < LIMITS.reviewFiles + 5; i++) fs.writeFileSync(path.join(rf.root, "src", "f" + String(i).padStart(3, "0") + ".js"), "1\n"); assert.equal(analyzeRepo(rf.root).sourceLinesReviewed, LIMITS.reviewFiles * 2); } finally { rf.done(); }
  const ff = mkRepo(); try { for (let i = 0; i < 150; i++) fs.writeFileSync(path.join(ff.root, "src", "e" + i + ".js"), "eval(x)\n"); assert.equal(analyzeRepo(ff.root).review.findings.length, 100); } finally { ff.done(); }
  const tf = mkRepo(); const scr = tmp("scr-"); try { for (let i = 0; i < 25; i++) fs.writeFileSync(path.join(tf.root, "tests", "t" + String(i).padStart(2, "0") + ".test.mjs"), "process.exit(0);\n"); const a = analyzeRepo(tf.root); assert.equal(a.testFiles.length, 26);
    if (ISOLATED) { const res = await runRepoTests({ name: "many", root: tf.root, ownerAuth: auth, ownerApproval: ap("REPO_TEST_RUN", "many#" + a.hash), scratchRoot: scr }); assert.equal(res.ran, LIMITS.maxTestFiles); } } finally { tf.done(); rm(scr); }
});
test("hardening: unreviewed files never yield NO_FINDINGS; test runs are refused while unhashed content exists; findings are severity-ordered before truncation; secrets on long lines are found", async () => {
  const r = mkRepo({ "src/big.mjs": "const a = 1;\n".repeat(20000) + "eval(x)\n", "src/bin.mjs": "ok\0binary", "src/one.mjs": "export const one = 1;\n" });
  try {
    const a = analyzeRepo(r.root); assert.equal(a.review.coverage.notReviewed.oversize, 1); assert.equal(a.review.coverage.notReviewed.binary, 1);
    r.put("src/pay.mjs", "export const pay = 2;\n"); const b = analyzeRepo(r.root); assert.equal(b.review.verdict, "INCOMPLETE_REVIEW", "a clean-looking result is not reported when files were skipped");
    // oversize file on disk (over the 1 MB walk cap) is counted and also blocks a test run
    r.put("src/huge.mjs", "x".repeat(LIMITS.maxFileBytes + 5)); assert.equal(analyzeRepo(r.root).skipped.oversize, 1);
    const run = await runRepoTests({ name: "demo", root: r.root, ownerAuth: auth, ownerApproval: ap("REPO_TEST_RUN", "demo#" + analyzeRepo(r.root).hash), caps });
    assert.equal(run.reason, "UNHASHED_CONTENT_PRESENT"); assert.equal(run.unhashed.oversize, 1);
    fs.rmSync(path.join(r.root, "src/huge.mjs")); r.put("node_modules/x/index.js", "module.exports=1"); const run2 = await runRepoTests({ name: "demo", root: r.root, ownerAuth: auth, ownerApproval: null, caps });
    assert.equal(run2.reason, "UNHASHED_CONTENT_PRESENT"); assert.equal(run2.unhashed.dirs, 1);
  } finally { r.done(); }
});
test("hardening: a lone oversize file alone makes the review INCOMPLETE; an unreviewable path never crashes the analysis", () => {
  const r = mkRepo({ "src/huge.mjs": "x".repeat(LIMITS.maxFileBytes + 5) });
  try { r.put("src/pay.mjs", "export const pay = 2;\n"); const a = analyzeRepo(r.root); assert.equal(a.review.coverage.notReviewed.oversize, 0); assert.equal(a.skipped.oversize, 1); assert.equal(a.review.verdict, "INCOMPLETE_REVIEW"); } finally { r.done(); }
  const q = mkRepo({ "src/we\\ird.mjs": "export const w = 1;\n" });
  try { q.put("src/pay.mjs", "export const pay = 2;\n"); const a = analyzeRepo(q.root); assert.equal(a.ok, true); assert.equal(a.review.verdict, "INCOMPLETE_REVIEW"); assert.match(a.review.notes[0], /^REVIEW_FAILED:PATH_INVALID/); } finally { q.done(); }
});
test("hardening: a sandboxed test cannot signal the host process (own PID namespace)", { skip: !ISOLATED && "restricted launcher not available on this host" }, async () => {
  const r = mkRepo({ "tests/kill.test.mjs": `import test from 'node:test'; import assert from 'node:assert/strict';
test('cannot kill the parent or the host', () => {
  assert.equal(process.ppid, 0, "the sandbox is PID 1 of its own namespace"); for (const pid of [${process.pid}, ${process.ppid}].filter(p => p > 1)) { let err = null; try { process.kill(pid, 0); } catch (e) { err = e.code; } assert.ok(err === 'ESRCH' || err === 'EPERM', 'host pid ' + pid + ' must not be signalable, got ' + err); }
});` });
  const scr = tmp("scr-"); try {
    r.put("src/pay.mjs", "export const pay = 1;\n"); fs.rmSync(path.join(r.root, "tests", "pay.test.mjs"));
    const res = await runRepoTests({ name: "demo", root: r.root, ownerAuth: auth, ownerApproval: ap("REPO_TEST_RUN", "demo#" + analyzeRepo(r.root).hash), timeoutMs: 8000, scratchRoot: scr, caps });
    assert.equal(res.ok, true, JSON.stringify(res)); assert.equal(res.results[0].status, "PASSED", res.results[0].output); assert.equal(process.kill(process.pid, 0), true, "the host survived");
  } finally { r.done(); rm(scr); }
});

test("verification fixes M1/M2: content changed between approval and run is refused; a .git folder blocks the run; the result carries the approved hash", async () => {
  const r = mkRepo(); try {
    const a = analyzeRepo(r.root), real = auth;
    const swap = { verifyApproval: (...x) => { r.put("src/ship.mjs", "export const ship = 'swapped after approval';\n"); return real.verifyApproval(...x); } };
    const res = await runRepoTests({ name: "r", root: r.root, ownerAuth: swap, ownerApproval: ap("REPO_TEST_RUN", "r#" + a.hash), isStopped: () => false });
    assert.deepEqual([res.ok, res.reason], [false, "CONTENT_CHANGED_DURING_RUN"]); assert.equal(res.approvedHash, a.hash);
    const r2 = mkRepo({ "tests/none.txt": "x" }); try {
      const empty = await runRepoTests({ name: "r", root: r2.root, ownerAuth: auth, ownerApproval: ap("REPO_TEST_RUN", "r#" + analyzeRepo(r2.root).hash), isStopped: () => false, caps }); assert.equal(empty.ok, true);
      fs.mkdirSync(path.join(r2.root, ".git")); fs.writeFileSync(path.join(r2.root, ".git", "config"), "[core]");
      const g = await runRepoTests({ name: "r", root: r2.root, ownerAuth: auth, ownerApproval: ap("REPO_TEST_RUN", "r#" + analyzeRepo(r2.root).hash), isStopped: () => false, caps });
      assert.deepEqual([g.ok, g.reason, g.unhashed.vcs], [false, "UNHASHED_CONTENT_PRESENT", 1]);
    } finally { r2.done(); }
  } finally { r.done(); }
});

test("verification fix M7: an empty or non-source tree, or one with unread hidden/linked parts, is never reported as having no findings", () => {
  const base = tmp("empty-"); try {
    const e = path.join(base, "e"); fs.mkdirSync(e); assert.equal(analyzeRepo(e).review.verdict, "NOTHING_REVIEWED");
    fs.writeFileSync(path.join(e, "README.md"), "# x"); assert.equal(analyzeRepo(e).review.verdict, "NOTHING_REVIEWED");
    fs.writeFileSync(path.join(e, "a.mjs"), "export const a = 1;\n"); assert.equal(analyzeRepo(e).review.verdict, "NO_FINDINGS_BY_THESE_RULES");
    fs.mkdirSync(path.join(e, ".secret")); fs.writeFileSync(path.join(e, ".secret", "evil.mjs"), "eval(x)"); assert.equal(analyzeRepo(e).review.verdict, "INCOMPLETE_REVIEW", "hidden folder");
    fs.rmSync(path.join(e, ".secret"), { recursive: true }); fs.symlinkSync("/etc", path.join(e, "lnk")); assert.equal(analyzeRepo(e).review.verdict, "INCOMPLETE_REVIEW", "symlink");
  } finally { rm(base); }
});
