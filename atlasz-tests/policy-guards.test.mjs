// Static policy guards (V7.3 §1, §36, §48): excluded projects, no 300-agent plan, no plaintext secrets in tracked files.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tracked = () => { try { return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean); } catch { return null; } };
const files = tracked();
const code = f => /\.(mjs|js|cjs|json|yml|yaml|cmd|html|css)$/.test(f);

test("no VIRENA / Green Mountain Painters integration in runtime code (only the accounting-firewall PLANNED label and policy docs)", { skip: !files }, () => {
  for (const f of files.filter(code).filter(f => /^(atlasz-runtime|atlasz-addons|atlasz-control-center)\//.test(f))) {
    const t = fs.readFileSync(path.join(ROOT, f), "utf8");
    const hits = t.split("\n").filter(l => /virena|green mountain|\bgmp\b/i.test(l));
    if (f === "atlasz-addons/completion-registry.mjs") assert.ok(hits.every(l => /accounting-entity-separation/.test(l)), f);
    else assert.equal(hits.length, 0, f + ": " + hits.join(" | "));
  }
});
test("no 300-agent topology in runtime code", { skip: !files }, () => {
  for (const f of files.filter(code).filter(f => /^(atlasz-runtime|atlasz-addons|atlasz-control-center)\//.test(f))) {
    const t = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.doesNotMatch(t, /length:\s*300\b|300[- ]agent/i, f);
  }
});
test("legacy 'atlasz-competition-v1' policy is confined to the legacy worker.js and is not reachable from start:canonical or the Control Center", { skip: !files }, () => {
  const carriers = files.filter(code).filter(f => /^(atlasz-runtime|atlasz-addons|atlasz-control-center)\//.test(f)).filter(f => /atlasz-competition/i.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
  assert.deepEqual(carriers, ["atlasz-runtime/worker.js"]);          // JOCI decision pending: quarantine or remove (EXCLUDED_LEGACY)
  for (const f of files.filter(code).filter(f => /^(atlasz-addons|atlasz-control-center)\/|supervisor-safe|owner-cli/.test(f)))
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8"), /worker\.js/, f);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "atlasz-runtime", "package.json"), "utf8"));
  assert.equal(pkg.scripts["start:canonical"], "node supervisor-safe.mjs");
});
test("no plaintext secrets in git-tracked files (common key formats)", { skip: !files }, () => {
  const patterns = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bsk-[A-Za-z0-9]{20,}\b/, /\bAKIA[0-9A-Z]{16}\b/, /\bghp_[A-Za-z0-9]{30,}\b/, /\bgithub_pat_[A-Za-z0-9_]{30,}\b/, /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, /\bAIza[0-9A-Za-z_-]{30,}\b/, /\bsk_live_[A-Za-z0-9]{10,}\b/];
  const bad = [];
  for (const f of files) {
    if (/\.(png|ico|exe|bundle)$/.test(f)) continue;
    let t; try { t = fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { continue; }
    for (const p of patterns) if (p.test(t)) bad.push(f + " ~ " + p);
  }
  assert.deepEqual(bad, []);
});

test("legacy competition worker is quarantined with a marker and is not imported by canonical code", () => {
  const marker = fs.readFileSync(path.join(ROOT, "atlasz-runtime", "LEGACY_EXCLUDED.md"), "utf8");
  assert.match(marker, /DO_NOT_MERGE/); assert.match(marker, /EXCLUDED/);
  for (const f of ["atlasz-runtime/supervisor-safe.mjs", "atlasz-control-center/core.mjs", "atlasz-control-center/server.mjs"]) {
    assert.ok(!/worker\.js|agent-child\.js|supervisor\.js/.test(fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\/.*$/gm, "")), f + " must not reference legacy runtime files");
  }
});
