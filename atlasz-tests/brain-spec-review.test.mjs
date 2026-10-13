// ATL-WRK-0785 automatic spec review: structure + traceability of docs/brain_spec. Docs-only; touches no runtime module.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const S = JSON.parse(fs.readFileSync(path.join(root, "docs/brain_spec/brain_api_schema.json"), "utf8"));
const MD = fs.readFileSync(path.join(root, "docs/brain_spec/BRAIN_SPEC.md"), "utf8");
const ledger = JSON.parse(fs.readFileSync(path.join(root, "docs/identity_registry/id_ledger.json"), "utf8"));
const ledgerText = JSON.stringify(ledger);
const idsIn = t => [...new Set(t.match(/ATL-[A-Z]{3}-\d{4}/g) ?? [])];

test("four operations, exactly consult/understand/plan/act", () => {
  assert.deepEqual(Object.keys(S.operations).sort(), ["act", "consult", "plan", "understand"]);
  for (const [k, o] of Object.entries(S.operations)) { assert.ok(o.purpose && o.input && o.result && o.side_effects, k); }
  assert.match(S.operations.act.result.executed, /false/);
  assert.equal(S.operations.consult.side_effects, "NONE");
});
test("permission matrix is complete and EXTERNAL_CONTENT is never allowed", () => {
  for (const op of Object.keys(S.operations)) {
    assert.deepEqual(Object.keys(S.permission_matrix[op]).sort(), [...S.caller_classes].sort(), op);
    assert.equal(S.permission_matrix[op].EXTERNAL_CONTENT, "DENY");
    for (const v of Object.values(S.permission_matrix[op])) assert.ok(["ALLOW", "APPROVAL", "DENY"].includes(v));
  }
  for (const c of S.caller_classes.filter(c => c !== "EXTERNAL_CONTENT")) assert.equal(S.permission_matrix.act[c], "APPROVAL", "act is never plain ALLOW");
});
test("principles P1..P9 present, P1 is model-not-authority", () => {
  assert.deepEqual(S.principles.map(p => p.id), ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"]);
  assert.equal(S.principles[0].name, "model_is_not_authority");
  for (const id of ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"]) assert.ok(MD.includes("| " + id + " |"), id + " in markdown");
});
test("error codes: unique, well-formed, markdown count matches, degraded triggers are known codes", () => {
  const codes = S.error_codes.map(e => e.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const e of S.error_codes) { assert.match(e.code, /^[A-Z][A-Z0-9_]+$/); assert.ok(Number.isInteger(e.http) && e.http >= 400 && e.http < 600); assert.equal(typeof e.retryable, "boolean"); assert.ok(["EXISTING", "NEW"].includes(e.origin)); assert.ok(e.when.length > 5); }
  const ex = codes.filter((_, i) => S.error_codes[i].origin === "EXISTING").length, nw = codes.length - ex;
  assert.ok(MD.includes(codes.length + " kód (" + ex + " meglévő"), "markdown counts: " + codes.length + "/" + ex + "/" + nw);
  assert.ok(MD.includes(nw + " új)"));
  for (const t of S.degraded_mode.trigger) assert.ok(codes.includes(t), t);
  for (const c of ["OWNER_APPROVAL_REQUIRED", "MODEL_NOT_CONFIGURED", "NO_ELIGIBLE_PROVIDER", "AUDIT_UNAVAILABLE", "INJECTION_SUSPECTED", "FALSE_INNER_LIFE_CLAIM", "BUDGET_EXCEEDED"]) assert.ok(codes.includes(c), c);
});
test("existing error code names really exist in the source (EXISTING ≠ invented)", () => {
  const src = ["reasoning-common.mjs", "guardrail-engine.mjs", "model-gateway.mjs", "budget-consumption-governor.mjs", "model-routing-bridge.mjs", "debate-protocol.mjs", "decision-analysis.mjs", "provider-adapters.mjs"].map(f => { try { return fs.readFileSync(path.join(root, "atlasz-addons", f), "utf8"); } catch { return ""; } }).join("\n");
  for (const e of S.error_codes.filter(e => e.origin === "EXISTING")) assert.ok(src.includes(e.code), "EXISTING code not found in source: " + e.code);
});
test("never-grantable list equals security-brain NEVER_GRANT and high-risk list equals guardrail HIGH_RISK", () => {
  const sb = fs.readFileSync(path.join(root, "atlasz-addons/brain/security-brain.mjs"), "utf8"), ge = fs.readFileSync(path.join(root, "atlasz-addons/guardrail-engine.mjs"), "utf8");
  const ng = JSON.parse(sb.match(/NEVER_GRANT = (\[[^\]]*\])/)[1]), hr = JSON.parse(ge.match(/HIGH_RISK=(\[[^\]]*\])/)[1]);
  assert.deepEqual([...S.never_grantable].sort(), [...ng].sort());
  assert.deepEqual([...S.high_risk_actions_require_owner].sort(), [...hr].sort());
});
test("every ATL id mentioned exists in the permanent ledger", () => {
  const ids = idsIn(JSON.stringify(S) + MD);
  assert.ok(ids.length >= 20);
  for (const id of ids) assert.ok(ledgerText.includes(id), "not in ledger: " + id);
});
test("audit and degraded-mode clauses; FIXTURE can never be LIVE", () => {
  assert.ok(S.audit.record_fields.includes("inputSha256") && S.audit.never_stored.length >= 2);
  assert.match(S.degraded_mode.forbidden, /FULL/); assert.match(S.degraded_mode.forbidden, /LIVE/);
  assert.match(S.status, /IMPLEMENTED ≠ CONNECTED ≠ TESTED ≠ LIVE/);
  assert.ok(S.envelope.response.fields.evidenceState.includes("FIXTURE"));
});
test("downstream work items listed in traceability exist", () => {
  for (const id of Object.keys(S.atl_traceability.downstream_work)) assert.ok(ledgerText.includes(id), id);
  for (const id of ["ATL-WRK-0786", "ATL-WRK-0789", "ATL-WRK-0790", "ATL-WRK-0791", "ATL-WRK-0792", "ATL-WRK-0793"]) assert.ok(MD.includes(id), id);
});
