import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceRecord } from "../atlasz-addons/evidence-record.mjs";
const ok = () => ({ component: "c", commit: "abc", environment: "sandbox", label: "SANDBOX", testType: "UNIT", result: "PASS" });
test("evidence record has every required field and a trace id", () => {
  const r = buildEvidenceRecord(ok());
  for (const k of ["at", "component", "commit", "environment", "label", "testType", "result", "traceId", "error", "blocker"]) assert.ok(k in r, k);
  assert.match(r.traceId, /^[0-9a-f-]{36}$/);
});
test("invalid or dishonest records are refused", () => {
  for (const bad of [{ component: null }, { commit: null }, { label: "LIVE" }, { label: undefined }, { testType: "VIBES" }, { result: "OK" }, { at: "yesterday" }, { result: "FAIL" }, { label: "PRODUCTION" }])
    assert.throws(() => buildEvidenceRecord({ ...ok(), ...bad }), /EVIDENCE_FIELD_INVALID/, JSON.stringify(bad));
  assert.equal(buildEvidenceRecord({ ...ok(), result: "BLOCKED", blocker: "no provider" }).blocker, "no provider");
});
