#!/usr/bin/env node
// Development-speed helper: run only the tests that can be affected by what changed. NOT a release gate.
//   node scripts/test-impacted.mjs [--base <git-ref>] [--list] [--jobs N] [--all]
// Default base is the last commit (HEAD): working-tree changes plus staged ones. Use --base origin-ish refs (e.g. HEAD~3) for a larger window.
// How it works: static import graph (import/export ... from "...", import("...") with a literal path) over atlasz-*/ and atlasz-tests/;
// a test is impacted when it (transitively) imports a changed file, or when it is itself changed. Non-JS changes (docs, csv, md) impact nothing.
// Conservative fallbacks (run the WHOLE suite): a changed package.json / lockfile / helpers.mjs / this script, a changed file the graph cannot place, or --all.
// The full suite (`npm test --prefix atlasz-runtime`) remains the mandatory gate before every commit that is pushed or sent to a verifier.
import fs from "node:fs";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const BASE = opt("--base") ?? "HEAD", LIST = args.includes("--list"), ALL = args.includes("--all"), JOBS = Math.max(1, Number(opt("--jobs") ?? 1) | 0);
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
const SKIP = new Set(["node_modules", ".git", "dist-stage", "data"]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue; const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(mjs|js|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = p => path.relative(ROOT, p).split(path.sep).join("/");
const files = walk(ROOT), known = new Set(files);
const resolveImp = (from, spec) => {
  if (!spec.startsWith(".")) return null; const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, base + ".mjs", base + ".js", path.join(base, "index.mjs"), path.join(base, "index.js")]) if (known.has(c)) return c;
  return null;
};
const deps = new Map(); for (const f of files) { let src = ""; try { src = fs.readFileSync(f, "utf8"); } catch { } const s = new Set(); for (const m of src.matchAll(IMPORT_RE)) { const r = resolveImp(f, m[1]); if (r) s.add(r); } deps.set(f, s); }
const rdeps = new Map(); for (const [f, s] of deps) for (const d of s) { if (!rdeps.has(d)) rdeps.set(d, new Set()); rdeps.get(d).add(f); }

const git = a => spawnSync("git", a, { cwd: ROOT, encoding: "utf8" });
const changed = new Set(); for (const a of [["diff", "--name-only", BASE, "--"], ["ls-files", "--others", "--exclude-standard"]]) { const r = git(a); if (r.status === 0) for (const l of r.stdout.split("\n")) if (l.trim()) changed.add(l.trim()); }
const allTests = files.filter(f => /atlasz-tests\/[^/]+\.test\.mjs$/.test(rel(f))).sort();
const WHOLE = /(^|\/)package(-lock)?\.json$|atlasz-tests\/helpers\.mjs$|scripts\/test-impacted\.mjs$/;
let reason = null, impacted = new Set();
if (ALL) reason = "--all";
for (const c of changed) {
  if (WHOLE.test(c)) { reason = reason ?? "changed " + c; continue; }
  if (!/\.(mjs|js|cjs)$/.test(c)) continue;
  const abs = path.join(ROOT, c); if (!fs.existsSync(abs)) { reason = reason ?? "deleted " + c; continue; }
  if (!known.has(abs)) { reason = reason ?? "unplaced " + c; continue; }
  const seen = new Set([abs]), q = [abs]; while (q.length) { const x = q.pop(); for (const r of rdeps.get(x) ?? []) if (!seen.has(r)) { seen.add(r); q.push(r); } }
  for (const s of seen) if (allTests.includes(s)) impacted.add(s);
}
const chosen = reason ? allTests : allTests.filter(t => impacted.has(t));
console.log(`changed: ${changed.size} file(s) vs ${BASE}; tests: ${chosen.length}/${allTests.length}${reason ? "  (WHOLE SUITE: " + reason + ")" : ""}`);
if (LIST || !chosen.length) { for (const t of chosen) console.log("  " + rel(t)); if (!chosen.length) console.log("no JavaScript change reaches a test; nothing to run (docs-only change)."); process.exit(0); }

// run: node --test with N parallel files (each test file is its own process; files that share ports or folders are written with tmp dirs, but run with --jobs 1 if in doubt)
const t0 = Date.now(); let failed = 0;
const run = f => new Promise(res => { const c = spawn(process.execPath, ["--test", f], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } }); let out = ""; c.stdout.on("data", d => out += d); c.stderr.on("data", d => out += d); c.on("close", code => { if (code !== 0) { failed++; console.log("FAIL " + rel(f) + "\n" + out.split("\n").filter(l => /not ok|error:|expected|actual/.test(l)).slice(0, 12).join("\n")); } res(); }); });
const queue = [...chosen]; await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => { while (queue.length) await run(queue.shift()); }));
console.log(`${chosen.length - failed}/${chosen.length} test files passed in ${((Date.now() - t0) / 1000).toFixed(1)} s  (NOT the release gate - run the full suite before commit/push)`);
process.exit(failed ? 1 : 0);
