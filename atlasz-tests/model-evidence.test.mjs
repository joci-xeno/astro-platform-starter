// Batch 7B: the model evidence ladder. A model is LIVE_OPERATIONAL only after a REAL authenticated call; fixtures, failed probes, stale calls and unknown spend never qualify.
import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path";
import { createModelEvidenceLedger, deriveEvidence, EVIDENCE_STATES, FRESH_MS } from "../atlasz-addons/model-evidence.mjs";
import { tmp, rm } from "./helpers.mjs";
const M = { id: "gpt-x", providerId: "openai" }, T = 1_800_000_000_000;
const F = (o = {}) => ({ enabled: true, egressApproved: true, credentialNeeded: true, credentialPresent: true, adapter: true, transport: "REAL", breakerOpen: false, ...o });
const ev = (kind, ok, o = {}) => ({ kind, modelId: "gpt-x", ok, transport: "REAL", costUsd: 0.001, atMs: T - 1000, reason: null, ...o });
const D = (facts, events = [], nowMs = T) => deriveEvidence({ model: M, facts: F(facts), events, nowMs });

test("the six words exist and nothing is LIVE_OPERATIONAL by default", () => {
  assert.deepEqual([...EVIDENCE_STATES], ["REGISTERED", "CONFIGURED", "AUTHENTICATED", "CALL_VERIFIED", "LIVE_OPERATIONAL", "BLOCKED"]);
  const r = D({ enabled: false, egressApproved: false, credentialPresent: false, adapter: false }); assert.equal(r.state, "BLOCKED"); assert.equal(r.reached, "REGISTERED");
  assert.ok(r.blockers.includes("DISABLED_OR_NOT_YET_APPROVED_BY_OWNER") && r.blockers.includes("NO_CREDENTIAL_IN_VAULT") && r.blockers.includes("EGRESS_POLICY_NOT_APPROVED"));
});
test("ladder: CONFIGURED -> AUTHENTICATED (real probe) -> CALL_VERIFIED (real task call) -> LIVE_OPERATIONAL (recent, spend recorded)", () => {
  assert.deepEqual([D().state, D().reached], ["CONFIGURED", "CONFIGURED"]); assert.ok(D().blockers.includes("NOT_PROBED_YET"));
  assert.equal(D({}, [ev("PROBE", true)]).state, "AUTHENTICATED");
  assert.equal(D({}, [ev("PROBE", true), ev("CALL", true, { costUsd: null })]).state, "CALL_VERIFIED", "unknown spend is not LIVE_OPERATIONAL");
  const live = D({}, [ev("PROBE", true), ev("CALL", true)]); assert.equal(live.state, "LIVE_OPERATIONAL"); assert.equal(live.realCalls, 1); assert.deepEqual(live.blockers, []);
});
test("a CALL without an authenticated probe, a failed probe, a failed call and a stale call never reach LIVE_OPERATIONAL", () => {
  assert.notEqual(D({}, [ev("CALL", true)]).state, "LIVE_OPERATIONAL");
  const p = D({}, [ev("PROBE", false, { reason: "HTTP_401" })]); assert.equal(p.state, "BLOCKED"); assert.match(p.blockers.join(), /PROBE_FAILED:HTTP_401/);
  const c = D({}, [ev("PROBE", true), ev("CALL", false, { reason: "RATE_LIMITED" })]); assert.equal(c.state, "BLOCKED"); assert.match(c.blockers.join(), /CALL_FAILED:RATE_LIMITED/);
  const stale = D({}, [ev("PROBE", true), ev("CALL", true, { atMs: T - FRESH_MS - 1 })]); assert.equal(stale.state, "CALL_VERIFIED"); assert.ok(stale.blockers.includes("NO_RECENT_SUCCESSFUL_CALL"));
  assert.equal(D({}, [ev("PROBE", true), ev("CALL", true), ev("PROBE", false)]).state, "CALL_VERIFIED", "a later failing probe withdraws LIVE");
  assert.equal(D({ breakerOpen: true }, [ev("PROBE", true), ev("CALL", true)]).state, "CALL_VERIFIED");
});
test("fixture transports never count: even a perfect-looking history stays BLOCKED/CONFIGURED with FIXTURE_TRANSPORT_ONLY", () => {
  const fx = [ev("PROBE", true, { transport: "FIXTURE" }), ev("CALL", true, { transport: "FIXTURE" })];
  const r = D({ transport: "FIXTURE" }, fx); assert.equal(r.state, "BLOCKED"); assert.equal(r.reached, "CONFIGURED"); assert.ok(r.blockers.includes("FIXTURE_TRANSPORT_ONLY")); assert.equal(r.realCalls, 0);
  assert.equal(D({}, fx).state, "CONFIGURED", "fixture-tagged events are ignored even when the facts say REAL");
});
test("removing any prerequisite withdraws the state (disabled, credential removed, egress revoked, no adapter)", () => {
  const h = [ev("PROBE", true), ev("CALL", true)]; assert.equal(D({}, h).state, "LIVE_OPERATIONAL");
  for (const k of [{ enabled: false }, { credentialPresent: false }, { egressApproved: false }, { adapter: false }]) { const r = D(k, h); assert.notEqual(r.state, "LIVE_OPERATIONAL", JSON.stringify(k)); assert.equal(r.reached, "REGISTERED"); }
});
test("events of other models are ignored; a local model needs no credential", () => {
  assert.equal(D({}, [ev("PROBE", true, { modelId: "other" }), ev("CALL", true, { modelId: "other" })]).state, "CONFIGURED");
  assert.equal(D({ credentialNeeded: false, credentialPresent: false }, [ev("PROBE", true), ev("CALL", true, { costUsd: 0 })]).state, "LIVE_OPERATIONAL");
});
test("ledger: hash-chained, validated input, secrets in reasons redacted, persisted across restart, tampering detected", () => {
  const d = tmp("me-"); try {
    const l = createModelEvidenceLedger({ dir: d, now: () => T });
    l.record({ kind: "PROBE", modelId: "gpt-x", ok: true, transport: "REAL" }); l.record({ kind: "CALL", modelId: "gpt-x", ok: false, transport: "REAL", reason: "bad key sk-ant-" + "SYNTHETIC".repeat(5) + "abcdefgh12345678" });
    assert.throws(() => l.record({ kind: "WIN", modelId: "x" }), /EVIDENCE_RECORD_INVALID/); assert.throws(() => l.record({ kind: "CALL", modelId: "" }), /EVIDENCE_RECORD_INVALID/);
    assert.equal(l.record({ kind: "CALL", modelId: "gpt-x", ok: true, transport: "weird" }), undefined); assert.equal(l.events().at(-1).transport, "FIXTURE", "anything that is not exactly REAL is a fixture");
    const l2 = createModelEvidenceLedger({ dir: d, now: () => T }); assert.equal(l2.events().length, 3); assert.equal(l2.verify().ok, true);
    assert.equal(fs.readFileSync(path.join(d, "model-evidence.jsonl"), "utf8").includes("SYNTHETICSYNTHETIC"), false);
    const f = path.join(d, "model-evidence.jsonl"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"ok":true', '"ok":false')); assert.throws(() => createModelEvidenceLedger({ dir: d }), /TAMPERED|CHAIN/);
  } finally { rm(d); }
});
