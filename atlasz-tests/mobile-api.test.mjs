import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
import { signWithKeystore } from "../atlasz-addons/owner-keystore.mjs";
import { createApprovalRequests } from "../atlasz-addons/approval-requests.mjs";

const PW = "correct horse battery";
async function rig() {
  const base = tmp("mob-"), configDir = path.join(base, "c"), stateDir = path.join(base, "s"), core = createControlCenterCore({ stateDir, configDir });
  await core.provisionOwnerKey({ passphrase: PW });
  const sign = (action, subject) => signWithKeystore(configDir, PW, { action, subject, ttlMs: 60000 });
  return { base, core, stateDir, sign, done: () => rm(base) };
}
test("every read needs a fresh owner-signed approval bound to that endpoint; replay, wrong endpoint and bare booleans are refused", async () => {
  const r = await rig();
  try {
    assert.equal((await r.core.mobile({ endpoint: "STATUS" })).status, 401);
    assert.equal((await r.core.mobile({ endpoint: "STATUS", approval: true })).status, 401);
    const a = r.sign("MOBILE_READ", "STATUS");
    const ok = await r.core.mobile({ endpoint: "STATUS", approval: a }); assert.equal(ok.status, 200); assert.equal(ok.body.data.runtime, "NOT_RUNNING");
    assert.equal((await r.core.mobile({ endpoint: "STATUS", approval: a })).status, 401);                       // replay
    assert.equal((await r.core.mobile({ endpoint: "MONEY", approval: r.sign("MOBILE_READ", "STATUS") })).status, 401);   // bound to endpoint
    const m = await r.core.mobile({ endpoint: "MONEY", approval: r.sign("MOBILE_READ", "MONEY") }); assert.equal(m.body.data.verifiedRevenueUsd, 0);
    assert.equal((await r.core.mobile({ endpoint: "DROP_TABLES", approval: a })).status, 404);
  } finally { r.done(); }
});
test("PAUSE needs the emergency-stop signature; RESUME also needs typed confirmation; the stop is real", async () => {
  const r = await rig();
  try {
    assert.equal((await r.core.mobile({ endpoint: "PAUSE", approval: r.sign("MOBILE_READ", "PAUSE") })).status, 403);   // wrong action
    const p = await r.core.mobile({ endpoint: "PAUSE", approval: r.sign("EMERGENCY_STOP", "PAUSE_ALL") }); assert.equal(p.status, 200);
    assert.equal((await r.core.status()).emergency.mode, "PAUSE_ALL");
    assert.equal((await r.core.mobile({ endpoint: "RESUME", approval: r.sign("EMERGENCY_RESUME", "RUNNING") })).status, 400);
    const resume = r.sign("EMERGENCY_RESUME", "RUNNING");
    assert.equal((await r.core.mobile({ endpoint: "RESUME", approval: resume, body: { confirm: "RESUME" } })).status, 200);
    assert.equal((await r.core.status()).emergency.mode, "RUNNING");
    await r.core.mobile({ endpoint: "PAUSE", approval: r.sign("EMERGENCY_STOP", "PAUSE_ALL") });
    assert.equal((await r.core.mobile({ endpoint: "RESUME", approval: resume, body: { confirm: "RESUME" } })).status, 403);   // captured RESUME cannot be replayed
    assert.equal((await r.core.status()).emergency.mode, "PAUSE_ALL");
  } finally { r.done(); }
});
test("APPROVE authorises only that exact request; REJECT needs the owner too; decided requests cannot be re-decided", async () => {
  const r = await rig();
  try {
    const store = createApprovalRequests({ dir: path.join(r.stateDir, "approvals") });
    const mk = subject => store.request({ action: "SEND_QUOTE", subject, requestedBy: "S1", what: "Send quote " + subject, why: "won", costUsd: 0, risk: { level: "LOW", description: "x" }, externalEffect: "email", reversible: true, ifOwnerSaysNo: "nothing", noSpendAlternative: "draft" });
    const a = mk("q1"), b = mk("q2");
    const idA = a.id ?? a.request?.id, idB = b.id ?? b.request?.id;
    assert.equal((await r.core.mobile({ endpoint: "APPROVE", body: { id: idA }, approval: r.sign("SEND_QUOTE", "q2") })).status, 401);          // approval for a different request
    assert.equal((await r.core.mobile({ endpoint: "APPROVE", body: { id: idA }, approval: r.sign("SEND_QUOTE", "q1") })).status, 200);
    assert.equal((await r.core.mobile({ endpoint: "APPROVE", body: { id: idA }, approval: r.sign("SEND_QUOTE", "q1") })).status, 409);
    assert.equal((await r.core.mobile({ endpoint: "REJECT", body: { id: idB } })).status, 401);
    assert.equal((await r.core.mobile({ endpoint: "REJECT", body: { id: idB }, approval: r.sign("MOBILE_REJECT", idB) })).status, 200);
    assert.deepEqual(r.core.approvals().pending, []);
  } finally { r.done(); }
});
test("repeated failures lock the API (429) and every denial is audited in a verifiable chain", async () => {
  const r = await rig();
  try {
    for (let i = 0; i < 5; i++) assert.equal((await r.core.mobile({ endpoint: "STATUS", approval: { forged: i } })).status, 401);
    assert.equal((await r.core.mobile({ endpoint: "STATUS", approval: r.sign("MOBILE_READ", "STATUS") })).status, 429);   // locked even for a valid approval
    const { createMobileApi } = await import("../atlasz-addons/mobile-api.mjs");
    const api = createMobileApi({ ownerAuth: { verifyApproval: () => ({ allowed: false, reason: "BAD" }) }, auditDir: path.join(r.base, "m2") });
    for (let i = 0; i < 5; i++) await api.handle({ endpoint: "STATUS", approval: {} });
    assert.equal((await api.handle({ endpoint: "STATUS", approval: {} })).status, 429); assert.equal(api.auditVerify().ok, true);
  } finally { r.done(); }
});
