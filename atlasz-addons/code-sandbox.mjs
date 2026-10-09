// Secure Code Sandbox (85-capability audit: M06, G05, GE07, M07, C01, P04, P07). Runs UNTRUSTED JavaScript or Python in a separate OS process; code is never evaluated
// inside the ATLASZ runtime. The isolation level is DETECTED at run time and reported truthfully on every result - it is never assumed:
//
//   NAMESPACE     Linux user+pid+net+ipc+uts namespaces via `unshare` (no network at all, own PID space, descendants killed with the run)
//   PROCESS_ONLY  everything else (e.g. Windows, or a host that forbids unprivileged namespaces): separate process + the controls below, but the network is
//                 NOT blocked for JavaScript. A PROCESS_ONLY run is refused unless the caller passes allowProcessOnly, which the runtime exposes only behind a
//                 signed, argument-bound OWNER approval (tool sandbox.run_process_only, operation HIGH_RISK_CHANGE).
//
// Controls applied in every level: scrubbed environment (no secrets inherited), fresh private working directory removed afterwards, inputs passed inline (no host
// mounts), wall-clock timeout with process-group kill, stdout/stderr caps, input/output file caps, concurrency cap, secret-looking code refused, tamper-evident
// hash-chained audit log (code is recorded by SHA-256, not stored).
// Filesystem restriction: JavaScript uses Node's permission model (ENFORCED by the runtime); Python uses an audit hook (BEST EFFORT - a determined program can
// bypass an in-process hook, which is why Python without a namespace is not treated as contained). POSIX rlimits (CPU, file size, open files, address space for
// Python) are applied where `sh`/`ulimit` exist; on Windows only the timeout and output caps apply. This is NOT a container or VM and is labelled as such.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const LANGUAGES = Object.freeze(["javascript", "python"]);
export const ISOLATION = Object.freeze(["NAMESPACE", "PROCESS_ONLY"]);
export const LIMITS = Object.freeze({ timeoutMs: 5000, maxTimeoutMs: 30000, maxOutputBytes: 65536, maxCodeBytes: 100000, maxStdinBytes: 100000, maxInputFiles: 10, maxInputFileBytes: 100000, maxOutputFiles: 10, maxOutputFileBytes: 262144, memoryMb: 256, maxConcurrent: 2, cpuSeconds: 10, openFiles: 64 });
const SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?<![A-Za-z0-9])sk-[A-Za-z0-9]{20,}|(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}\b|(?<![A-Za-z0-9])ghp_[A-Za-z0-9]{30,}/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const IS_WIN = process.platform === "win32";

// Python bootstrap: set rlimits, install an audit hook that denies network, subprocesses, ctypes and file access outside the work dir, then run main.py.
const PY_BOOT = String.raw`
import sys, os
W = os.path.realpath(sys.argv[1]); MEM = int(sys.argv[2]) * 1024 * 1024
try:
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (MEM, MEM))
except Exception:
    pass
READ_OK = tuple(os.path.realpath(p) for p in {sys.prefix, sys.base_prefix, sys.exec_prefix, sys.base_exec_prefix, os.path.dirname(os.__file__)} if p)
def _inside(p, roots):
    p = os.path.realpath(p)
    return any(p == r or p.startswith(r + os.sep) for r in roots)
WRITE = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC
DENY = ("socket.", "subprocess.", "os.system", "os.exec", "os.spawn", "os.posix_spawn", "os.fork", "os.forkpty", "os.kill", "ctypes.", "os.chmod", "os.chown", "os.symlink", "os.link", "os.chroot", "os.setuid", "os.setgid", "shutil.", "webbrowser", "urllib.", "http.", "ftplib.", "smtplib.", "telnetlib.", "msvcrt.", "winreg.", "_posixsubprocess.")
def hook(event, args):
    if event == "open":
        p = args[0]
        if isinstance(p, int) or p is None:
            return
        if isinstance(p, bytes):
            p = os.fsdecode(p)
        flags = args[2] if len(args) > 2 and isinstance(args[2], int) else 0
        mode = args[1] if len(args) > 1 and isinstance(args[1], str) else ""
        writing = bool(flags & WRITE) or any(c in mode for c in "wax+")
        if writing:
            if not _inside(p, (W,)):
                raise PermissionError("sandbox: write outside work dir denied")
        elif not _inside(p, (W,) + READ_OK):
            raise PermissionError("sandbox: read outside work dir denied")
        return
    if event == "import" and args and args[0] in ("ctypes", "_ctypes", "cffi", "_cffi_backend"):
        raise PermissionError("sandbox: import of " + args[0] + " denied")
    for d in DENY:
        if event.startswith(d):
            raise PermissionError("sandbox: " + event + " denied")
    if event in ("os.listdir", "os.scandir", "os.mkdir", "os.rmdir", "os.remove", "os.rename", "os.truncate"):
        a = args[0] if args else None
        if isinstance(a, (str, bytes)) and not _inside(os.fsdecode(a), (W,) + (READ_OK if event in ("os.listdir", "os.scandir") else ())):
            raise PermissionError("sandbox: " + event + " outside work dir denied")
sys.addaudithook(hook)
os.chdir(W)
sys.argv = ["main.py"]
sys.path.insert(0, W)
import runpy
runpy.run_path(os.path.join(W, "main.py"), run_name="__main__")
`;

export function createCodeSandbox({ allowPython = process.env.ATLASZ_ALLOW_UNCONTAINED_PYTHON === "1", baseDir = path.join(os.tmpdir(), "atlasz-sandbox"), auditFile = null, blackBox = null, now = () => new Date().toISOString(), nodePath = process.execPath, pythonPath = null, forceLevel = null, limits = {} } = {}) {
  const L = { ...LIMITS, ...limits }; let busy = 0, seq = 0, caps = null;
  const audit = { events: [], prev: "GENESIS" };
  if (auditFile && fs.existsSync(auditFile)) { try { audit.events = fs.readFileSync(auditFile, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)); audit.prev = audit.events.at(-1)?.hash ?? "GENESIS"; } catch { throw new Error("STORE_UNREADABLE:" + path.basename(auditFile)); } }
  seq = audit.events.length;
  const log = (kind, d) => { try { blackBox?.record({ kind, ...d }); } catch { /* audit must not change behaviour */ } };
  function record(d) {
    const e = { n: ++seq, at: now(), ...d, prev: audit.prev }; e.hash = sha(audit.prev + JSON.stringify({ ...e, hash: undefined })); audit.events.push(e); audit.prev = e.hash;
    if (auditFile) { fs.mkdirSync(path.dirname(auditFile), { recursive: true }); fs.appendFileSync(auditFile, JSON.stringify(e) + "\n"); }
    log("SANDBOX_" + d.status, { runId: d.runId, language: d.language, isolation: d.isolation, codeSha256: d.codeSha256 }); return e;
  }
  function verifyAudit() { let prev = "GENESIS"; for (const e of audit.events) { const { hash, ...rest } = e; if (e.prev !== prev || sha(prev + JSON.stringify({ ...rest, hash: undefined })) !== hash) return { ok: false, brokenAt: e.n }; prev = hash; } return { ok: true, events: audit.events.length }; }

  /** Detect (once) what this host can really enforce. Nothing is assumed. */
  function capabilities() {
    if (caps) return caps;
    const probe = (cmd, args) => { try { const r = spawnSync(cmd, args, { timeout: 4000, stdio: "ignore", windowsHide: true }); return r.status === 0; } catch { return false; } };
    const namespace = !IS_WIN && process.platform === "linux" && probe("unshare", ["--user", "--map-root-user", "--pid", "--fork", "--net", "--ipc", "--uts", "true"]);
    const killChild = namespace && probe("unshare", ["--user", "--map-root-user", "--pid", "--fork", "--kill-child", "--net", "true"]);
    const nodePermission = probe(nodePath, ["--permission", "-e", "0"]);
    const py = !allowPython ? null : pythonPath ?? ["python3", "python"].find(c => probe(c, ["-c", "import sys; assert sys.version_info >= (3, 8)"])) ?? null;
    const posixLimits = !IS_WIN && probe("sh", ["-c", "ulimit -t 5"]);
    caps = { platform: process.platform, namespace, killChild, nodePermission, python: py, posixLimits, level: forceLevel ?? (namespace ? "NAMESPACE" : "PROCESS_ONLY"), languages: ["javascript", ...(py ? ["python"] : [])] };
    return caps;
  }
  function describeIsolation(language, level, c) {
    const fsMode = language === "javascript" ? (c.nodePermission ? "ENFORCED_BY_NODE_PERMISSION_MODEL" : "NONE") : "BEST_EFFORT_PYTHON_AUDIT_HOOK";
    return { level, network: level === "NAMESPACE" ? "BLOCKED_BY_NET_NAMESPACE" : language === "python" ? "BEST_EFFORT_PYTHON_AUDIT_HOOK" : "NOT_BLOCKED", pids: level === "NAMESPACE" ? "OWN_PID_NAMESPACE" : "HOST_PIDS", filesystem: fsMode,
      limits: { timeout: true, outputCaps: true, ...(c.posixLimits ? { cpuSeconds: true, fileSize: true, openFiles: true } : {}), memory: language === "python" ? c.posixLimits : "NODE_HEAP_ONLY", processCount: false },
      notAContainerOrVm: true };
  }

  /**
   * run({language, code, files?, stdin?, timeoutMs?}, {actor?, allowProcessOnly?}) - never throws; always returns {status, ...}. status: OK | NONZERO_EXIT | TIMEOUT | OUTPUT_LIMIT |
   * REFUSED:<reason> | ISOLATION_NOT_AVAILABLE_NEEDS_OWNER_APPROVAL | LANGUAGE_UNAVAILABLE | BUSY | INVALID:<reason> | ERROR
   */
  async function run(req = {}, { actor = "UNKNOWN", allowProcessOnly = false } = {}) {
    const runId = "sbx-" + (seq + 1) + "-" + crypto.randomBytes(3).toString("hex"), t0 = Date.now(), c = capabilities();
    const language = req.language, code = typeof req.code === "string" ? req.code : "", codeSha256 = sha(code);
    const done = (status, extra = {}) => { const iso = extra.isolation ?? null; record({ runId, status, language: language ?? null, actor, codeSha256, isolation: iso?.level ?? null, durationMs: Date.now() - t0, outBytes: (extra.stdout?.length ?? 0) + (extra.stderr?.length ?? 0) }); return { runId, status, language: language ?? null, codeSha256, untrusted: true, durationMs: Date.now() - t0, ...extra }; };
    if (!LANGUAGES.includes(language)) return done("INVALID:LANGUAGE");
    if (!code.trim()) return done("INVALID:CODE_REQUIRED");
    if (Buffer.byteLength(code) > L.maxCodeBytes) return done("INVALID:CODE_TOO_LARGE");
    if (SECRET.test(code)) return done("REFUSED:SECRET_IN_CODE");
    if (typeof req.stdin === "string" && Buffer.byteLength(req.stdin) > L.maxStdinBytes) return done("INVALID:STDIN_TOO_LARGE");
    const files = req.files ?? []; if (!Array.isArray(files) || files.length > L.maxInputFiles) return done("INVALID:TOO_MANY_FILES");
    for (const f of files) { if (!f || !NAME.test(String(f.name)) || ["main.js", "main.py", "out"].includes(f.name)) return done("INVALID:FILE_NAME"); if (typeof f.content !== "string" || Buffer.byteLength(f.content) > L.maxInputFileBytes) return done("INVALID:FILE_CONTENT"); if (SECRET.test(f.content)) return done("REFUSED:SECRET_IN_FILE"); }
    if (language === "python" && !c.python) return done("LANGUAGE_UNAVAILABLE");
    const level = c.level, isolation = describeIsolation(language, level, c);
    if (level !== "NAMESPACE" && !allowProcessOnly) return done("ISOLATION_NOT_AVAILABLE_NEEDS_OWNER_APPROVAL", { isolation, reason: "No OS-level isolation is available on this host; a process-only run needs a signed owner approval bound to this exact code." });
    if (busy >= L.maxConcurrent) return done("BUSY", { isolation });
    const timeoutMs = Math.min(Math.max(Number(req.timeoutMs) || L.timeoutMs, 100), L.maxTimeoutMs);
    busy++; let dir = null;
    try {
      fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 }); dir = fs.mkdtempSync(path.join(baseDir, "run-")); const out = path.join(dir, "out"), tmpd = path.join(dir, "tmp"); fs.mkdirSync(out); fs.mkdirSync(tmpd);
      const main = language === "javascript" ? "main.js" : "main.py"; fs.writeFileSync(path.join(dir, main), code); for (const f of files) fs.writeFileSync(path.join(dir, f.name), f.content);
      const env = IS_WIN ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", TEMP: tmpd, TMP: tmpd } : { PATH: "/usr/bin:/bin", HOME: dir, TMPDIR: tmpd, LANG: "C.UTF-8" };
      env.PYTHONDONTWRITEBYTECODE = "1"; env.NODE_OPTIONS = "";
      let cmd, args;
      if (language === "javascript") { cmd = nodePath; args = [...(c.nodePermission ? ["--permission", "--allow-fs-read=" + dir, "--allow-fs-write=" + out, "--allow-fs-write=" + tmpd] : []), "--max-old-space-size=" + L.memoryMb, path.join(dir, main)]; }
      else { cmd = c.python; args = ["-I", "-S", "-c", PY_BOOT, dir, String(L.memoryMb)]; }
      if (c.posixLimits) { const pre = `ulimit -t ${L.cpuSeconds}; ulimit -f ${Math.ceil(L.maxOutputFileBytes * L.maxOutputFiles / 512)}; ulimit -n ${L.openFiles}; ulimit -c 0; exec "$@"`; args = ["-c", pre, "sh", cmd, ...args]; cmd = "sh"; }
      if (level === "NAMESPACE" && c.namespace) { args = ["--user", "--map-root-user", "--pid", "--fork", ...(c.killChild ? ["--kill-child"] : []), "--net", "--ipc", "--uts", cmd, ...args]; cmd = "unshare"; }
      const res = await new Promise(resolve => {
        const child = spawn(cmd, args, { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"], detached: !IS_WIN, windowsHide: true });
        let so = Buffer.alloc(0), se = Buffer.alloc(0), over = false, timedOut = false, settled = false;
        const kill = () => { try { if (!IS_WIN && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } } };
        const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
        const take = (buf, chunk) => { const room = L.maxOutputBytes - buf.length; if (chunk.length > room) { over = true; kill(); } return Buffer.concat([buf, chunk.subarray(0, Math.max(room, 0))]); };
        child.stdout.on("data", ch => { so = take(so, ch); }); child.stderr.on("data", ch => { se = take(se, ch); });
        child.stdin.on("error", () => {}); child.stdin.end(typeof req.stdin === "string" ? req.stdin : "");
        const fin = (code_, signal, err) => { if (settled) return; settled = true; clearTimeout(timer); kill(); resolve({ exitCode: code_, signal, so, se, over, timedOut, err }); };
        child.on("error", e => fin(null, null, e)); child.on("close", (code_, signal) => fin(code_, signal, null));
      });
      if (res.err) return done("ERROR", { isolation, error: String(res.err.code ?? res.err.message).slice(0, 100) });
      const outputs = []; let truncatedFiles = false;
      for (const name of fs.readdirSync(out).sort()) {
        if (outputs.length >= L.maxOutputFiles) { truncatedFiles = true; break; }
        const p = path.join(out, name), st = fs.lstatSync(p); if (!st.isFile() || !NAME.test(name)) continue;
        const buf = fs.readFileSync(p).subarray(0, L.maxOutputFileBytes); outputs.push({ name, bytes: st.size, truncated: st.size > L.maxOutputFileBytes, sha256: sha(buf), content: buf.toString("utf8") });
      }
      const status = res.timedOut ? "TIMEOUT" : res.over ? "OUTPUT_LIMIT" : res.exitCode === 0 ? "OK" : "NONZERO_EXIT";
      return done(status, { isolation, exitCode: res.exitCode, signal: res.signal, stdout: res.so.toString("utf8"), stderr: res.se.toString("utf8"), outputs, outputFilesTruncated: truncatedFiles, note: "Output is UNTRUSTED data produced by untrusted code." });
    } catch (e) { return done("ERROR", { isolation, error: String(e.message).slice(0, 120) }); }
    finally { busy--; if (dir) for (let i = 0; i < 5; i++) { try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise(r => setTimeout(r, 50 * (i + 1))); } } }
  }
  const history = ({ limit = 50 } = {}) => audit.events.slice(-Math.min(limit, 500)).map(e => ({ ...e }));
  const summary = () => { const c = capabilities(); const by = {}; for (const e of audit.events) by[e.status] = (by[e.status] ?? 0) + 1; return { level: c.level, namespace: c.namespace, nodePermission: c.nodePermission, languages: c.languages, runs: audit.events.length, byStatus: by, audit: verifyAudit(), limits: { ...L }, label: "Separate-process sandbox; not a container or VM." }; };
  return { run, capabilities, history, summary, verifyAudit };
}

/** Typed tools. sandbox.run is INTERNAL_COMPUTE but only ever runs at NAMESPACE isolation (otherwise it refuses). sandbox.run_process_only is the SAME runner at process-only
 *  isolation and is classified HIGH_RISK_CHANGE: the control chain demands a signed owner approval bound to these exact arguments (code included) and consumes it once. */
export function registerSandboxTools(registry, sandbox) {
  const props = { language: { enum: [...LANGUAGES] }, code: { type: "string", minLength: 1, maxLength: LIMITS.maxCodeBytes }, stdin: { type: "string", maxLength: LIMITS.maxStdinBytes }, timeoutMs: { type: "integer", minimum: 100, maximum: LIMITS.maxTimeoutMs },
    files: { type: "array", maxItems: LIMITS.maxInputFiles, items: { type: "object", required: ["name", "content"], properties: { name: { type: "string", maxLength: 64 }, content: { type: "string", maxLength: LIMITS.maxInputFileBytes } } } } };
  const input = { type: "object", required: ["language", "code"], properties: props }, output = { type: "object", required: ["status", "untrusted"], additionalProperties: true, properties: { status: { type: "string" }, untrusted: { type: "boolean" } } };
  registry.register({ name: "sandbox.run", description: "Run untrusted JavaScript/Python in the isolated sandbox (no network, private work dir). Refuses when OS-level isolation is unavailable.", operation: "INTERNAL_COMPUTE", input, output, timeoutMs: 60000, handler: a => sandbox.run(a, { actor: "AGENT" }) });
  registry.register({ name: "sandbox.run_process_only", description: "Run code WITHOUT OS-level isolation (network not blocked for JavaScript). Requires a signed owner approval for these exact arguments.", operation: "HIGH_RISK_CHANGE", input, output, timeoutMs: 60000, handler: a => sandbox.run(a, { actor: "AGENT", allowProcessOnly: true }) });
  registry.register({ name: "sandbox.status", description: "Detected isolation level, languages, limits and run counts.", operation: "READ_STATUS", input: { type: "object", properties: {} }, output: { type: "object", additionalProperties: true, properties: {} }, handler: () => sandbox.summary() });
}
