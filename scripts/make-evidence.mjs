#!/usr/bin/env node
// Runs the real test suite and writes a structured evidence record to evidence/. Label defaults to SANDBOX (never PRODUCTION).
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvidenceRecord } from "../atlasz-addons/evidence-record.mjs";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = spawnSync("npm", ["test", "--prefix", "atlasz-runtime"], { cwd: root, encoding: "utf8" });
const out = run.stdout + run.stderr, num = k => Number((out.match(new RegExp("^# " + k + " (\\d+)", "m")) || [])[1] ?? NaN);
const commit = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { return null; } })();
const pass = run.status === 0 && num("fail") === 0;
const rec = buildEvidenceRecord({ component: "atlasz-v73-integration (all tests)", commit, environment: "sandbox (" + process.platform + ", node " + process.versions.node + ")",
  label: process.env.ATLASZ_EVIDENCE_LABEL || "SANDBOX", testType: "REGRESSION", result: pass ? "PASS" : "FAIL", error: pass ? null : "see details.tail",
  details: { tests: num("tests"), pass: num("pass"), fail: num("fail"), skipped: num("skipped"), tail: pass ? undefined : out.slice(-3000) } });
fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
const file = path.join(root, "evidence", "evidence-" + rec.at.replace(/[:.]/g, "-") + ".json");
fs.writeFileSync(file, JSON.stringify(rec, null, 1));
console.log(file + "\n" + JSON.stringify({ result: rec.result, ...rec.details, tail: undefined }));
process.exit(pass ? 0 : 1);
