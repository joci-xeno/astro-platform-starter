// V7.3 §47: build a SANITIZED copy of the source tree for a possible future customer distribution. Local only; publishes nothing.
// Excludes: git history, state/evidence/backups, owner keys, env files, private docs, the legacy competition worker, node_modules. Then scans the result for secrets.
import fs from "node:fs";
import path from "node:path";
const SKIP = [/^\.git(\/|$)/, /node_modules/, /^evidence(\/|$)/, /^data(\/|$)/, /^state(\/|$)/, /^backups?(\/|$)/, /^atlasz-astra\/BLOCKED-ASTRA/, /\.env(\.|$)/, /private-key/i, /owner-.*\.pem$/i, /^atlasz-runtime\/worker\.js$/, /^atlasz-runtime\/agent-child\.js$/, /^dist/];
const SECRET = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bsk-[A-Za-z0-9]{20,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bghp_[A-Za-z0-9]{30,}/, /\bxox[bp]-[A-Za-z0-9-]{20,}/];
export function buildSanitizedDist({ srcRoot, outDir }) {
  fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
  const copied = [], skipped = [], findings = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name), rel = path.relative(srcRoot, abs).split(path.sep).join("/");
      if (SKIP.some(r => r.test(rel))) { skipped.push(rel); continue; }
      if (abs.startsWith(path.resolve(outDir))) continue;
      if (e.isSymbolicLink()) { skipped.push(rel + " (symlink)"); continue; }
      if (e.isDirectory()) { walk(abs); continue; }
      const buf = fs.readFileSync(abs);
      if (buf.length < 2_000_000 && SECRET.some(r => r.test(buf.toString("utf8")))) { findings.push(rel); continue; }
      fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true }); fs.writeFileSync(path.join(outDir, rel), buf); copied.push(rel);
    }
  })(srcRoot);
  const manifest = { builtAt: new Date().toISOString(), kind: "SANITIZED_DISTRIBUTION", files: copied.length, skippedCount: skipped.length, secretFindingsExcluded: findings };
  fs.writeFileSync(path.join(outDir, "SANITIZED-MANIFEST.json"), JSON.stringify(manifest, null, 1));
  return { ...manifest, copied, skipped };
}
if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  const r = buildSanitizedDist({ srcRoot: process.cwd(), outDir: process.argv[2] ?? "dist-sanitized" });
  console.log(JSON.stringify({ files: r.files, skipped: r.skippedCount, secretFindingsExcluded: r.secretFindingsExcluded }));
}
