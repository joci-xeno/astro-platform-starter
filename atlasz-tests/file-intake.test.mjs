// Untrusted file intake with an ESTABLISHED scanner adapter. The engine here is a stub executable that behaves like clamscan (exit 0/1/2): it proves ATLASZ's handling of the engine's verdicts,
// NOT the detection quality of a real engine (no ClamAV / Defender exists in this test environment: BLOCKED for live proof, see docs/audit/SECURITY_PROTECTION_MATRIX.md).
import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path";
import { createFileIntake } from "../atlasz-addons/file-intake.mjs";
import { detectScanner, createScanner } from "../atlasz-addons/malware-scanner.mjs";
import { releaseSubject } from "../atlasz-addons/quarantine.mjs";
import { syntheticZip } from "../atlasz-addons/security-gates.mjs";
import { sign, ownerAuth } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
function stubEngine(dir, mode = "clam") {
  const bin = path.join(dir, "bin"); fs.mkdirSync(bin, { recursive: true }); const f = path.join(bin, "clamscan");
  fs.writeFileSync(f, `#!/bin/sh\nfor last; do :; done\nif [ "${mode}" = "error" ]; then echo "LibClamAV Error: cannot load database" >&2; exit 2; fi\nif [ "${mode}" = "hang" ]; then sleep 5; exit 0; fi\nif grep -q "EICAR-STANDARD" "$last"; then echo "$last: Win.Test.EICAR_HDB-1 FOUND"; exit 1; fi\necho "$last: OK"; exit 0\n`, { mode: 0o755 });
  return bin;
}
const mk = (d, mode, extra = {}) => { const bin = stubEngine(d, mode), scanner = detectScanner({ env: { PATH: bin }, platform: "linux", timeoutMs: mode === "hang" ? 500 : 20000 }), alerts = [], incidents = []; return { scanner, alerts, incidents, intake: createFileIntake({ dir: path.join(d, "q"), ownerAuth, scanner, alert: a => alerts.push(a), onIncident: i => incidents.push(i), ...extra }) }; };

test("detectScanner finds an installed engine in PATH and returns null (never a fake) when none exists", () => {
  const d = tmp("fi-"); try { assert.equal(detectScanner({ env: { PATH: path.join(d, "none") }, platform: "linux" }), null); const bin = stubEngine(d); const s = detectScanner({ env: { PATH: bin }, platform: "linux" }); assert.equal(s.engine, "clamscan"); assert.equal(s.name, "ClamAV");
    assert.equal(detectScanner({ platform: "win32", env: { PATH: "", ProgramFiles: "C:\\PF" }, exists: p => /MpCmdRun\.exe$/.test(p) }).engine, "defender"); } finally { rm(d); }
});
test("detected malware -> BLOCKED_DETECTED, confirmed CRITICAL incident on the file hash, owner alerted, never released to agents", async () => {
  const d = tmp("fi-"); try { const { intake, alerts, incidents } = mk(d);
    const r = await intake.submit({ name: "invoice.txt", bytes: Buffer.from(EICAR), source: "email" });
    assert.equal(r.state, "BLOCKED_DETECTED"); assert.equal(r.scan.status, "SCANNER_DETECTED"); assert.equal(r.releasedToAgents, false);
    assert.equal(incidents.length, 1); assert.equal(incidents[0].confirmed, true); assert.equal(incidents[0].operation, "file:" + r.sha256); assert.equal(alerts.at(-1).level, "CRITICAL");
    assert.equal(fs.statSync(path.join(d, "q", "files", r.sha256 + ".bin")).mode & 0o111, 0, "no exec bit"); assert.equal(fs.statSync(path.join(d, "q", "files", r.sha256 + ".bin")).mode & 0o222, 0, "read-only");
    assert.equal(intake.verify().ok, true);
  } finally { rm(d); }
});
test("no detection is HELD, never 'clean'; scanner error / timeout / missing scanner all fail closed to HELD", async () => {
  const d = tmp("fi-"); try {
    const a = mk(d, "clam"), r = await a.intake.submit({ name: "notes.txt", bytes: Buffer.from("hello world") }); assert.equal(r.state, "HELD_NO_DETECTION_NOT_PROVEN_SAFE"); assert.equal(a.incidents.length, 0); assert.ok(!/clean|safe\b/i.test(r.state.replace("NOT_PROVEN_SAFE", "")));
    const d2 = tmp("fi-"); const b = mk(d2, "error"); assert.equal((await b.intake.submit({ name: "x.txt", bytes: Buffer.from("x") })).state, "HELD_SCANNER_ERROR"); rm(d2);
    const d3 = tmp("fi-"); const c = mk(d3, "hang"); assert.equal((await c.intake.submit({ name: "x.txt", bytes: Buffer.from("x") })).state, "HELD_SCANNER_ERROR"); rm(d3);
    const d4 = tmp("fi-"); const n = createFileIntake({ dir: path.join(d4, "q"), ownerAuth, scanner: null }); assert.equal((await n.submit({ name: "x.txt", bytes: Buffer.from("x") })).state, "HELD_SCANNER_UNAVAILABLE"); rm(d4);
  } finally { rm(d); }
});
test("structural attacks are blocked without extraction: zip-slip, executable disguised as a document; oversize is rejected before storage", async () => {
  const d = tmp("fi-"); try { const { intake, incidents } = mk(d);
    const z = await intake.submit({ name: "docs.zip", bytes: syntheticZip([{ name: "../../evil.sh", data: "x" }]) }); assert.equal(z.state, "BLOCKED_STRUCTURAL"); assert.ok(z.findings.some(f => /SLIP|TRAVERSAL|PATH/i.test(f.code)), JSON.stringify(z.findings.map(f => f.code)));
    const exe = await intake.submit({ name: "report.pdf", bytes: Buffer.concat([Buffer.from("MZ\x90\x00"), Buffer.alloc(200, 1)]) }); assert.ok(exe.executable === true || exe.findings.length > 0); assert.ok(exe.state.startsWith("BLOCKED") || exe.state.startsWith("HELD"));
    assert.equal(incidents.length >= 1, true);
    const big = createFileIntake({ dir: path.join(d, "q2"), ownerAuth, maxBytes: 100 }); const r = await big.submit({ name: "b.bin", bytes: Buffer.alloc(1000) }); assert.equal(r.reason, "FILE_TOO_LARGE"); assert.equal(big.list().length, 0);
  } finally { rm(d); }
});
test("release needs a signed single-use owner approval bound to the file hash AND destination; the kill switch blocks release; a name with shell metacharacters is harmless", async () => {
  const d = tmp("fi-"); try { let stopped = false; const { intake } = mk(d, "clam", { isStopped: () => stopped });
    const r = await intake.submit({ name: "a; rm -rf ~ $(touch pwned).txt", bytes: Buffer.from("plain text") }); assert.ok(!fs.existsSync(path.join(process.cwd(), "pwned")));
    const dest = path.join(d, "out", "a.txt"); fs.mkdirSync(path.dirname(dest));
    assert.equal(intake.release(r.sha256, { destPath: dest, ownerApproval: null }).ok, false);
    assert.equal(intake.release(r.sha256, { destPath: dest, ownerApproval: sign("QUARANTINE_RELEASE", releaseSubject(r.sha256, path.join(d, "elsewhere.txt"))) }).ok, false);
    stopped = true; assert.equal(intake.release(r.sha256, { destPath: dest, ownerApproval: sign("QUARANTINE_RELEASE", releaseSubject(r.sha256, dest)) }).ok, false); stopped = false;
    assert.equal(fs.existsSync(dest), false);
    const ok = intake.release(r.sha256, { destPath: dest, ownerApproval: sign("QUARANTINE_RELEASE", releaseSubject(r.sha256, dest)) }); assert.equal(ok.ok, true, JSON.stringify(ok)); assert.equal(fs.readFileSync(dest, "utf8"), "plain text");
  } finally { rm(d); }
});
test("scanner adapter: bad paths and unknown exit codes never become a clean verdict", async () => {
  const s = createScanner("clamscan", "/bin/true", { exec: async () => ({ code: 7, out: "", err: "boom sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }) });
  const f = path.join(tmp("fi-"), "f.txt"); fs.writeFileSync(f, "x");
  const r = await s.scan(f); assert.equal(r.verdict, "ERROR"); assert.ok(!r.detail.includes("AAAAAAAAAAAAAAAA"));
  assert.equal((await s.scan("relative/path")).verdict, "ERROR"); assert.equal((await s.scan(path.join(path.dirname(f), "missing"))).verdict, "ERROR");
  assert.throws(() => createScanner("homemade", "/x"), /UNKNOWN_ENGINE/);
});
