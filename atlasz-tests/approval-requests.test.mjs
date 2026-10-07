import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmp, rm } from "./helpers.mjs";
import { createApprovalRequests, validateRequest } from "../atlasz-addons/approval-requests.mjs";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
import { createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { keystoreStatus } from "../atlasz-addons/owner-keystore.mjs";

const good = () => ({ action: "subscribe", subject: "tool-x", what: "Subscribe to Tool X", why: "Needed for job 12", costUsd: 20, risk: { level: "MEDIUM", description: "recurring charge" },
  externalEffect: "Card is charged monthly", reversible: true, ifOwnerSaysNo: "Job 12 uses the free tool; slower", noSpendAlternative: "Free tier of Tool Y", requestedBy: "EXECUTION-3" });
const PW = "correct horse battery";

test("every one of the eight owner questions is mandatory; irreversible needs a note", () => {
  assert.equal(validateRequest(good()), true);
  for (const f of ["what", "why", "costUsd", "risk", "externalEffect", "reversible", "ifOwnerSaysNo", "noSpendAlternative", "action", "subject", "requestedBy"]) {
    const r = good(); delete r[f];
    assert.throws(() => validateRequest(r), new RegExp("INCOMPLETE:" + f), f);
  }
  assert.throws(() => validateRequest({ ...good(), risk: { level: "WHATEVER", description: "x" } }), /INCOMPLETE:risk/);
  assert.throws(() => validateRequest({ ...good(), costUsd: -1 }), /INCOMPLETE:costUsd/);
  assert.throws(() => validateRequest({ ...good(), reversible: false }), /irreversibleNote/);
});
test("request is idempotent while pending; reject needs no signature; approve needs a signed approval for THIS request", () => {
  const d = tmp();
  try {
    const s = createApprovalRequests({ dir: d });
    const a = s.request(good()), b = s.request(good());
    assert.equal(a.duplicate, false); assert.equal(b.duplicate, true); assert.equal(s.pending().length, 1);
    assert.throws(() => s.decide({ id: a.id, decision: "APPROVED", approval: { action: "PURCHASE", subject: "tool-x" } }), /SIGNED_APPROVAL_FOR_THIS_REQUEST_REQUIRED/);
    assert.throws(() => s.decide({ id: a.id, decision: "APPROVED" }), /SIGNED_APPROVAL/);
    s.decide({ id: a.id, decision: "REJECTED", reason: "no" });
    assert.equal(s.pending().length, 0); assert.equal(s.outcome(a.id).decision, "REJECTED"); assert.equal(s.outcome(a.id).approval, null);
    assert.throws(() => s.decide({ id: a.id, decision: "REJECTED" }), /ALREADY_DECIDED/);
  } finally { rm(d); }
});
test("requests expire; a torn last line is ignored", () => {
  const d = tmp(); let t = 1000;
  try {
    const s = createApprovalRequests({ dir: d, ttlMs: 500, now: () => t });
    const r = s.request(good()); t += 1000;
    assert.equal(s.list()[0].status, "EXPIRED");
    fs.appendFileSync(path.join(d, "requests.jsonl"), '{"id":"torn"');
    assert.equal(s.list().length, 1);
    assert.ok(r.id);
  } finally { rm(d); }
});
test("Control Center: pending card shows all fields; approve signs exactly this request (wrong passphrase refused); runtime side receives a verifiable approval", () => {
  const base = tmp("cc-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c");
  try {
    const core = createControlCenterCore({ stateDir, configDir });
    core.provisionOwnerKey({ passphrase: PW });
    const rt = createApprovalRequests({ dir: path.join(stateDir, "approvals") });      // the runtime's side
    const { id } = rt.request(good());
    const p = core.approvals().pending[0];
    assert.equal(p.what, "Subscribe to Tool X"); assert.equal(p.noSpendAlternative, "Free tier of Tool Y"); assert.equal(p.reversible, true);
    assert.throws(() => core.decideApproval({ id, decision: "APPROVED", passphrase: "bad bad bad bad" }), /WRONG_PASSPHRASE/);
    core.decideApproval({ id, decision: "APPROVED", passphrase: PW });
    const out = rt.outcome(id);
    assert.equal(out.decision, "APPROVED");
    const verifier = createOwnerAuth({ publicKeyB64: keystoreStatus(configDir).publicKeyB64 });
    assert.equal(verifier.verifyApproval(out.approval, { action: "SUBSCRIBE", subject: "tool-x" }).allowed, true);
    assert.equal(verifier.verifyApproval(out.approval, { action: "SUBSCRIBE", subject: "tool-x" }).reason, "REPLAY_DETECTED");
    assert.equal(core.approvals().pending.length, 0);
  } finally { rm(base); }
});
