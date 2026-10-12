// Fails when a source file gains a network / child-process primitive that is not classified in docs/audit/enforcement_coverage.json - so the boundary's reach is never silently assumed.
import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cov = JSON.parse(fs.readFileSync(path.join(root, "docs/audit/enforcement_coverage.json"), "utf8"));
const PRIM = /(^|[^.\w])fetch\(|fetchImpl\(|\bhttps?\.(request|get)\(|net\.(connect|createConnection)|node:child_process|new WebSocket\(|node:dgram|node:dns|node:tls/;
function walk(d, out = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== "public" && e.name !== "node_modules") walk(p, out); } else if (/\.(mjs|js)$/.test(e.name)) out.push(p); } return out; }
const found = ["atlasz-addons", "atlasz-control-center", "atlasz-runtime"].flatMap(d => walk(path.join(root, d))).map(p => path.relative(root, p).split(path.sep).join("/")).filter(f => PRIM.test(fs.readFileSync(path.join(root, f), "utf8")));
test("every file with a network or child-process primitive is classified; classes are valid; nothing is silently assumed covered", () => {
  const missing = found.filter(f => !cov.files[f]); assert.deepEqual(missing, [], "classify these in docs/audit/enforcement_coverage.json: " + missing.join(", "));
  for (const [f, c] of Object.entries(cov.files)) { assert.ok(cov.classes[c], f + " has unknown class " + c); assert.ok(fs.existsSync(path.join(root, f)), f + " listed but missing"); }
});
test("files classified BOUNDARY_WIRED really call the boundary", () => {
  for (const [f, c] of Object.entries(cov.files)) if (c === "BOUNDARY_WIRED") assert.match(fs.readFileSync(path.join(root, f), "utf8"), /boundary(\?)?\.check\(|executionBoundary\.check\(/, f);
});
test("legacy runtime files stay quarantined: no import of them from live code", () => {
  for (const f of walk(path.join(root, "atlasz-addons")).concat(walk(path.join(root, "atlasz-control-center")))) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /from\s+["'][^"']*(\/supervisor\.js|\/worker\.js|\/agent-child\.js)["']/, f);
});
