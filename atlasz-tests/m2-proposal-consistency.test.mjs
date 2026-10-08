import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
process.env.ATLASZ_TEST_MODE = "1";
const { createRuntime } = await import("../atlasz-runtime/supervisor-safe.mjs");
import { tmp, rm } from "./helpers.mjs";

// The M2 permission table is a PROPOSAL awaiting owner approval. These tests only check that the proposal is consistent with the real tool registry and the safety rules;
// they do NOT wire anything: no runtime code reads docs/m2_tool_permissions_PROPOSED.json.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/m2_tool_permissions_PROPOSED.json"), "utf8"));
const rtWith = () => { const d = tmp("m2p-"); return { d, rt: createRuntime({ dataDir: d, retryBaseMs: 0, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" }) }) }; };

test("proposal covers exactly the registered tools (no unknown, none missing) and exactly the fixed 5+25 identities", () => {
  const { d, rt } = rtWith();
  try {
    const real = rt.tools.describe(), names = real.map(t => t.name).sort();
    assert.ok(names.length >= 31); assert.deepEqual(Object.keys(P.tools).sort(), names);
    assert.deepEqual(P.roles.SEARCH, rt.state.agents.filter(a => a.role === "SEARCH").map(a => a.id));
    assert.deepEqual(P.roles.EXECUTION, rt.state.agents.filter(a => a.role === "EXECUTION").map(a => a.id));
    for (const v of Object.values(P.tools)) { assert.ok(["ALLOW", "DENY", "APPROVAL"].includes(v.SEARCH) && ["ALLOW", "DENY", "APPROVAL"].includes(v.EXECUTION)); assert.ok(["LOW", "MEDIUM", "HIGH"].includes(v.dataRisk)); assert.ok(v.rationale.length > 10); }
  } finally { rt.stop?.(); rm(d); }
});
test("proposal is consistent with the control chain: HIGH_RISK tools are never plain ALLOW; tools the chain would deny/hold are never ALLOW", () => {
  const { d, rt } = rtWith();
  try {
    for (const t of rt.tools.describe()) {
      const p = P.tools[t.name];
      if (t.operation === "HIGH_RISK_CHANGE") for (const role of ["SEARCH", "EXECUTION"]) assert.notEqual(p[role], "ALLOW", t.name + " " + role);
      assert.ok(!/approve|spend|send|pay|speak|listen|transfer|deploy/i.test(t.name) || (p.SEARCH === "DENY" && p.EXECUTION === "DENY"), t.name);
    }
    assert.equal(P.tools["sandbox.run_process_only"].SEARCH, "DENY"); assert.equal(P.tools["sandbox.run_process_only"].EXECUTION, "APPROVAL");
  } finally { rt.stop?.(); rm(d); }
});
test("least privilege: personal-command-center tools and owner-only resolution are denied to every agent; counts match the package document", () => {
  for (const n of ["pcc.agenda", "pcc.add", "pcc.complete", "pcc.summary", "voice.status"]) assert.deepEqual([P.tools[n].SEARCH, P.tools[n].EXECUTION], ["DENY", "DENY"], n);
  const cnt = (role, v) => Object.values(P.tools).filter(x => x[role] === v).length;
  const S = ["ALLOW", "DENY", "APPROVAL"].map(v => cnt("SEARCH", v)), E = ["ALLOW", "DENY", "APPROVAL"].map(v => cnt("EXECUTION", v));
  assert.equal(S.reduce((a, b) => a + b), Object.keys(P.tools).length);
  const doc = fs.readFileSync(path.join(ROOT, "docs/M2_AUTHORIZATION_PACKAGE.md"), "utf8");
  assert.ok(doc.includes(`SEARCH: ${S[0]} ALLOW, ${S[1]} DENY, ${S[2]} APPROVAL`), "doc totals must match the JSON"); assert.ok(doc.includes(`EXECUTION: ${E[0]} ALLOW, ${E[1]} DENY, ${E[2]} APPROVAL`)); assert.match(doc, /NOT IMPLEMENTED/);
  // the 31 tools of package v1 keep their reviewed numbers; everything added later must be DENY/DENY until the owner approves
  const later = Object.entries(P.tools).filter(([, v]) => v.addedAfterPackageV1);
  for (const [n, v] of later) { assert.deepEqual([v.SEARCH, v.EXECUTION], ["DENY", "DENY"], n + " was added after the package: must be DENY until approved"); assert.ok(doc.includes("`" + n + "`"), n + " must be listed in the document"); }
  assert.equal(Object.keys(P.tools).length - later.length, 31);
});
test("nothing in production code consumes the proposal (M2 is not implemented)", () => {
  const hits = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (["node_modules", ".git", "atlasz-tests", "docs"].includes(e.name)) continue; const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(mjs|js)$/.test(e.name) && fs.readFileSync(f, "utf8").includes("m2_tool_permissions")) hits.push(f); } };
  walk(ROOT); assert.deepEqual(hits, []);
});
