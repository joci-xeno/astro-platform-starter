import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createCodeSandbox, LIMITS } from "../atlasz-addons/code-sandbox.mjs";
import { tmp, rm } from "./helpers.mjs";

const mk = (o = {}) => { const base = tmp("sbx-"); const sb = createCodeSandbox({ allowPython: true, baseDir: path.join(base, "runs"), auditFile: path.join(base, "audit.jsonl"), ...o }); return { base, sb, caps: sb.capabilities(), done: () => rm(base) }; };
const needPy = c => !c.python && "python not installed on this host";

test("capabilities are detected, not assumed; every result carries the isolation actually used and an untrusted flag", async () => {
  const w = mk();
  try {
    const c = w.caps; assert.ok(["NAMESPACE", "PROCESS_ONLY"].includes(c.level)); assert.equal(c.level === "NAMESPACE", c.namespace); assert.ok(c.languages.includes("javascript"));
    const r = await w.sb.run({ language: "javascript", code: "console.log(6*7)" }, { allowProcessOnly: true });
    assert.equal(r.status, "OK"); assert.equal(r.stdout.trim(), "42"); assert.equal(r.untrusted, true); assert.equal(r.isolation.level, c.level); assert.equal(r.isolation.notAContainerOrVm, true);
    assert.equal(r.isolation.network, c.level === "NAMESPACE" ? "BLOCKED_BY_NET_NAMESPACE" : "NOT_BLOCKED"); assert.equal(w.sb.summary().label, "Separate-process sandbox; not a container or VM.");
    const forced = createCodeSandbox({ baseDir: path.join(w.base, "f"), forceLevel: "PROCESS_ONLY" }); assert.equal(forced.capabilities().level, "PROCESS_ONLY");
  } finally { w.done(); }
});

test("process-only isolation is refused without an owner-approved override and is labelled NOT_BLOCKED network when allowed", async () => {
  const w = mk({ forceLevel: "PROCESS_ONLY" });
  try {
    const refused = await w.sb.run({ language: "javascript", code: "console.log('ran')" });
    assert.equal(refused.status, "ISOLATION_NOT_AVAILABLE_NEEDS_OWNER_APPROVAL"); assert.equal(refused.stdout, undefined); assert.equal(refused.isolation.level, "PROCESS_ONLY");
    const ok = await w.sb.run({ language: "javascript", code: "console.log('ran')" }, { allowProcessOnly: true });
    assert.equal(ok.status, "OK"); assert.equal(ok.isolation.network, "NOT_BLOCKED");
  } finally { w.done(); }
});

test("JavaScript: stdin, input files, output files with hashes; python parity", async (t) => {
  const w = mk();
  try {
    const code = `const fs=require('fs');const inp=fs.readFileSync(0,'utf8');const d=fs.readFileSync('data.txt','utf8');fs.writeFileSync('out/result.txt',(inp+d).toUpperCase());console.log('done')`;
    const r = await w.sb.run({ language: "javascript", code, stdin: "abc-", files: [{ name: "data.txt", content: "xyz" }] }, { allowProcessOnly: true });
    assert.equal(r.status, "OK", r.stderr); assert.equal(r.outputs[0].content, "ABC-XYZ"); assert.equal(r.outputs[0].sha256.length, 64); assert.equal(r.outputs[0].name, "result.txt");
    if (needPy(w.caps)) return t.skip(needPy(w.caps));
    const p = await w.sb.run({ language: "python", code: "import sys\nd=open('data.txt').read()\nopen('out/r.txt','w').write(sys.stdin.read()+d)\nprint(sum(range(10)))", stdin: "q", files: [{ name: "data.txt", content: "z" }] }, { allowProcessOnly: true });
    assert.equal(p.status, "OK", p.stderr); assert.equal(p.stdout.trim(), "45"); assert.equal(p.outputs[0].content, "qz");
  } finally { w.done(); }
});

test("the environment is scrubbed: host secrets never reach the program", async () => {
  process.env.ATLASZ_TEST_SECRET_TOKEN = "hunter2-do-not-leak";
  const w = mk();
  try {
    const r = await w.sb.run({ language: "javascript", code: "console.log(JSON.stringify(process.env))" }, { allowProcessOnly: true });
    assert.equal(r.status, "OK"); assert.ok(!r.stdout.includes("hunter2")); assert.ok(!r.stdout.includes("ATLASZ_TEST_SECRET_TOKEN"));
    if (w.caps.python) { const p = await w.sb.run({ language: "python", code: "import os\nprint(dict(os.environ))" }, { allowProcessOnly: true }); assert.ok(!p.stdout.includes("hunter2")); }
  } finally { delete process.env.ATLASZ_TEST_SECRET_TOKEN; w.done(); }
});

test("timeouts kill the run, output is capped, runaway memory is stopped; the workdir is always removed", async () => {
  const w = mk({ limits: { maxOutputBytes: 2000 } });
  try {
    const t0 = Date.now(), r = await w.sb.run({ language: "javascript", code: "while(true){}", timeoutMs: 400 }, { allowProcessOnly: true });
    assert.equal(r.status, "TIMEOUT"); assert.ok(Date.now() - t0 < 6000);
    const o = await w.sb.run({ language: "javascript", code: "for(;;)process.stdout.write('x'.repeat(5000))" }, { allowProcessOnly: true });
    assert.equal(o.status, "OUTPUT_LIMIT"); assert.ok(o.stdout.length <= 2000);
    const m = await w.sb.run({ language: "javascript", code: "const a=[];for(;;)a.push(new Array(1e6).fill(1))", timeoutMs: 8000 }, { allowProcessOnly: true });
    assert.notEqual(m.status, "OK"); assert.ok(["NONZERO_EXIT", "TIMEOUT", "ERROR", "OUTPUT_LIMIT"].includes(m.status));
    assert.deepEqual(fs.existsSync(path.join(w.base, "runs")) ? fs.readdirSync(path.join(w.base, "runs")) : [], []);
  } finally { w.done(); }
});

test("filesystem restriction: a program cannot read host files outside its work dir (JS enforced by runtime permissions; Python best-effort hook)", async (t) => {
  const w = mk(), host = tmp("sbxhost-"), marker = "HOST-FILE-CONTENT-" + Math.random().toString(36).slice(2), f = path.join(host, "private.txt");
  fs.writeFileSync(f, marker);
  try {
    if (w.caps.nodePermission) {
      const r = await w.sb.run({ language: "javascript", code: `try{console.log(require('fs').readFileSync(${JSON.stringify(f)},'utf8'))}catch(e){console.log('DENIED '+e.code)}`, }, { allowProcessOnly: true });
      assert.ok(!r.stdout.includes(marker) && !r.stderr.includes(marker)); assert.match(r.stdout + r.stderr, /DENIED|ERR_ACCESS_DENIED|restricted/); assert.equal(r.isolation.filesystem, "ENFORCED_BY_NODE_PERMISSION_MODEL");
      const wr = await w.sb.run({ language: "javascript", code: `try{require('fs').writeFileSync(${JSON.stringify(path.join(host, "evil.txt"))},'x');console.log('WROTE')}catch(e){console.log('DENIED')}` }, { allowProcessOnly: true });
      assert.ok(!wr.stdout.includes("WROTE")); assert.equal(fs.existsSync(path.join(host, "evil.txt")), false);
      const cp = await w.sb.run({ language: "javascript", code: "try{require('child_process').execSync('echo pwned');console.log('SPAWNED')}catch(e){console.log('DENIED')}" }, { allowProcessOnly: true });
      assert.ok(!cp.stdout.includes("SPAWNED"));
    } else t.diagnostic("node permission model not available on this host: JS filesystem restriction cannot be claimed here");
    if (w.caps.python) {
      const r = await w.sb.run({ language: "python", code: `print(open(${JSON.stringify(f)}).read())` }, { allowProcessOnly: true });
      assert.ok(!r.stdout.includes(marker)); assert.equal(r.status, "NONZERO_EXIT"); assert.match(r.stderr, /sandbox: read outside work dir denied/);
      const wr = await w.sb.run({ language: "python", code: `open(${JSON.stringify(path.join(host, "evil2.txt"))},'w').write('x')` }, { allowProcessOnly: true });
      assert.equal(wr.status, "NONZERO_EXIT"); assert.equal(fs.existsSync(path.join(host, "evil2.txt")), false);
      const sp = await w.sb.run({ language: "python", code: "import subprocess\nsubprocess.run(['echo','pwned'])" }, { allowProcessOnly: true }); assert.equal(sp.status, "NONZERO_EXIT"); assert.match(sp.stderr, /subprocess\.Popen denied/);
      const so = await w.sb.run({ language: "python", code: "import socket\nsocket.socket().connect(('127.0.0.1',9))" }, { allowProcessOnly: true }); assert.equal(so.status, "NONZERO_EXIT"); assert.match(so.stderr, /sandbox: socket/);
      const ct = await w.sb.run({ language: "python", code: "import ctypes" }, { allowProcessOnly: true }); assert.equal(ct.status, "NONZERO_EXIT");
    }
  } finally { w.done(); rm(host); }
});

test("network: in the namespace level a program cannot reach even a local listener; without it the level says so", async (t) => {
  const w = mk(); if (w.caps.level !== "NAMESPACE") { w.done(); return t.skip("no namespace isolation on this host (network not blocked; reported as such)"); }
  const srv = net.createServer(s => s.end("HOST-LISTENER")); await new Promise(r => srv.listen(0, "127.0.0.1", r)); const port = srv.address().port;
  try {
    const r = await w.sb.run({ language: "javascript", code: `const s=require('net').connect(${port},'127.0.0.1');s.on('data',d=>console.log('GOT '+d));s.on('error',e=>console.log('ERR '+e.code))` });
    assert.equal(r.status, "OK"); assert.ok(!r.stdout.includes("GOT")); assert.match(r.stdout, /ERR/);
    const pid = await w.sb.run({ language: "javascript", code: "console.log(process.pid)" }); assert.ok(Number(pid.stdout) < 50, "own PID namespace: tiny pid");
  } finally { srv.close(); w.done(); }
});

test("input validation and refusals: secrets, bad names/paths, size limits, unknown language, concurrency", async () => {
  const w = mk({ limits: { maxConcurrent: 1 } }), A = { allowProcessOnly: true };
  try {
    const bad = async (req, re) => { const r = await w.sb.run(req, A); assert.match(r.status, re, String(JSON.stringify(req)).slice(0, 80)); assert.equal(r.stdout, undefined); };
    await bad({ language: "ruby", code: "puts 1" }, /INVALID:LANGUAGE/); await bad({ language: "javascript", code: "  " }, /INVALID:CODE_REQUIRED/); await bad({ language: "javascript" }, /INVALID:CODE_REQUIRED/);
    await bad({ language: "javascript", code: "x".repeat(LIMITS.maxCodeBytes + 1) }, /CODE_TOO_LARGE/);
    await bad({ language: "javascript", code: "const k='sk-" + "a".repeat(30) + "'" }, /REFUSED:SECRET_IN_CODE/);
    for (const name of ["../escape.txt", "a/b.txt", "main.js", "out", ".hidden", "", "x".repeat(65), "..\\win.txt"]) await bad({ language: "javascript", code: "1", files: [{ name, content: "x" }] }, /INVALID:FILE_NAME/);
    await bad({ language: "javascript", code: "1", files: [{ name: "a.txt", content: "x".repeat(LIMITS.maxInputFileBytes + 1) }] }, /INVALID:FILE_CONTENT/);
    await bad({ language: "javascript", code: "1", files: [{ name: "a.txt", content: 123 }] }, /INVALID:FILE_CONTENT/); await bad({ language: "javascript", code: "1", files: [null] }, /INVALID:FILE_NAME/); await bad({ language: "javascript", code: "1", files: "x" }, /TOO_MANY_FILES/);
    await bad({ language: "javascript", code: 42 }, /INVALID:CODE_REQUIRED/); await bad(undefined, /INVALID:LANGUAGE/);
    await bad({ language: "javascript", code: "1", files: [{ name: "a.txt", content: "ghp_" + "b".repeat(36) }] }, /REFUSED:SECRET_IN_FILE/);
    await bad({ language: "javascript", code: "1", files: Array.from({ length: 11 }, (_, i) => ({ name: "f" + i, content: "x" })) }, /TOO_MANY_FILES/);
    await bad({ language: "javascript", code: "1", stdin: "x".repeat(LIMITS.maxStdinBytes + 1) }, /STDIN_TOO_LARGE/);
    const [a, b] = await Promise.all([w.sb.run({ language: "javascript", code: "setTimeout(()=>{},700)" }, A), w.sb.run({ language: "javascript", code: "1" }, A)]);
    assert.deepEqual([a.status, b.status].sort(), ["BUSY", "OK"]);
  } finally { w.done(); }
});

test("audit: every run (including refusals) is hash-chained, code is recorded by hash only, restart keeps history, tampering and corruption are detected", async () => {
  const w = mk(), A = { allowProcessOnly: true, actor: "AGENT:E3" };
  try {
    const SECRETISH = "console.log('unique-code-marker-12345')";
    await w.sb.run({ language: "javascript", code: SECRETISH }, A); await w.sb.run({ language: "ruby", code: "x" }, A); await w.sb.run({ language: "javascript", code: "const k='sk-" + "a".repeat(30) + "'" }, A);
    const file = path.join(w.base, "audit.jsonl"), raw = fs.readFileSync(file, "utf8");
    assert.ok(!raw.includes("unique-code-marker")); assert.equal(raw.trim().split("\n").length, 3); assert.equal(w.sb.verifyAudit().ok, true);
    const again = createCodeSandbox({ baseDir: path.join(w.base, "runs"), auditFile: file }); assert.equal(again.summary().runs, 3); assert.deepEqual(again.summary().byStatus, { OK: 1, "INVALID:LANGUAGE": 1, "REFUSED:SECRET_IN_CODE": 1 });
    assert.equal(again.history()[0].actor, "AGENT:E3"); assert.equal(again.history()[0].codeSha256.length, 64);
    const lines = raw.trim().split("\n"); const e = JSON.parse(lines[1]); e.actor = "OWNER"; lines[1] = JSON.stringify(e); fs.writeFileSync(file, lines.join("\n") + "\n");
    assert.deepEqual(createCodeSandbox({ baseDir: path.join(w.base, "runs"), auditFile: file }).verifyAudit(), { ok: false, brokenAt: 2 });
    fs.writeFileSync(file, "{broken\n"); assert.throws(() => createCodeSandbox({ baseDir: path.join(w.base, "runs"), auditFile: file }), /STORE_UNREADABLE/); assert.equal(fs.readFileSync(file, "utf8"), "{broken\n");
  } finally { w.done(); }
});

test("Python is OFF by default (no OS-level containment proven: a native module can escape the audit hook); only an explicit owner opt-in enables it", async () => {
  const w = mk({ allowPython: false });
  try {
    assert.ok(!w.sb.capabilities().languages.includes("python")); assert.equal(w.sb.capabilities().python, null);
    const r = await w.sb.run({ language: "python", code: "print(1)" }, { actor: "OWNER", allowProcessOnly: true }); assert.equal(r.status, "LANGUAGE_UNAVAILABLE");
    const off = createCodeSandbox({ baseDir: path.join(w.base, "d") }); const viaEnv = process.env.ATLASZ_ALLOW_UNCONTAINED_PYTHON === "1";
    assert.equal(off.capabilities().languages.includes("python"), viaEnv, "default follows the explicit owner switch only");
    assert.equal((await w.sb.run({ language: "javascript", code: "console.log('js still works')" }, { actor: "OWNER" })).status === "OK" || w.sb.capabilities().level !== "NAMESPACE", true);
  } finally { rm(w.base); }
});
