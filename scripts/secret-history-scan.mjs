#!/usr/bin/env node
// Scans the whole Git history (every ref, every added line, every commit message) for private-key blocks and real-looking API tokens.
// Output NEVER contains the matched secret: only commit, file, pattern name and a length. Exit 1 on any non-synthetic hit.
import { spawn } from "node:child_process";
import { TOKEN_PATTERNS, PEM_HEADER, SYNTHETIC, B64_BODY_LINE } from "../atlasz-addons/history-scan-patterns.mjs";
const root = process.argv[2] ?? process.cwd();
const p = spawn("git", ["log", "--all", "-p", "--no-color", "--format=@@COMMIT %H%n%B", "-U0"], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
let commit = "", file = "", buf = "", lines = 0, pemAt = null; const hits = [];
function line(l) {
  lines++;
  if (l.startsWith("@@COMMIT ")) { commit = l.slice(9); return; }
  if (l.startsWith("+++ ")) { file = l.slice(6); return; }
  if (!l.startsWith("+") && !(commit && !l.startsWith("-") && !l.startsWith("@@") && !l.startsWith("diff") && !l.startsWith("index") && l.length)) return;
  const t = l.startsWith("+") ? l.slice(1) : l;
  if (pemAt && B64_BODY_LINE.test(t.trim()) && !SYNTHETIC.test(t)) { hits.push({ commit, file, pattern: "PRIVATE_KEY_BLOCK", length: t.length }); pemAt = null; }
  else if (pemAt && !B64_BODY_LINE.test(t.trim())) pemAt = null;
  if (PEM_HEADER.test(t)) { pemAt = { commit, file }; const after = t.slice(t.search(PEM_HEADER) + 20).replace(/^[A-Z ]*PRIVATE KEY-----/, ""); if (/[A-Za-z0-9+\/=\\n]{80,}/.test(after) && !SYNTHETIC.test(after)) hits.push({ commit, file, pattern: "PRIVATE_KEY_BLOCK", length: t.length }); }
  for (const [name, r] of TOKEN_PATTERNS) for (const m of t.match(new RegExp(r.source, "g")) ?? []) if (!SYNTHETIC.test(m)) hits.push({ commit, file, pattern: name, length: m.length });
}
p.stdout.setEncoding("utf8");
p.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); } });
p.on("close", () => { if (buf) line(buf); const out = { scannedLines: lines, hits: hits.length, findings: hits.slice(0, 50), verdict: hits.length ? "SECRET_EXPOSURE_SUSPECTED: revoke and rotate per docs/SECURITY_LEAK_RESPONSE.md" : "NO_NON_SYNTHETIC_SECRET_FOUND_IN_HISTORY" };
  console.log(JSON.stringify(out, null, 2)); process.exit(hits.length ? 1 : 0); });
