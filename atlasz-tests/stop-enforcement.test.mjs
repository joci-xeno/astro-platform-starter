// V7.3 §14: the kill switch must stop the real external-effect chokepoints, not only the runtime scheduler.
import test from "node:test";
import assert from "node:assert/strict";
import { createComputerUseFabric } from "../atlasz-addons/computer-use-fabric.mjs";
import { guardAction } from "../atlasz-addons/guardrail-engine.mjs";
import { createApprovalGateway } from "../atlasz-addons/approval-command-gateway.mjs";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createSafeMode } from "../atlasz-addons/safe-mode.mjs";
import { validProbeEvidence } from "../atlasz-addons/probe-evidence.mjs";

const evidence = { probeId: "p", outcome: "PASS", at: new Date().toISOString(), target: "t" };

test("computer-use: a stop gate blocks the provider call; allowed gate lets it through", async () => {
  let calls = 0;
  const provider = { name: "p", tested: true, probeEvidence: evidence, execute: async () => { calls++; return "ok"; } };
  const blocked = createComputerUseFabric({ provider, gate: () => ({ allowed: false, reason: "PAUSE_ALL" }) });
  const r = await blocked.execute({ agentId: "a", action: "click" });
  assert.equal(r.executed, false); assert.equal(r.level, "BLOCKED_BY_STOP"); assert.equal(calls, 0);
  const open = createComputerUseFabric({ provider, gate: () => ({ allowed: true }) });
  assert.equal((await open.execute({ agentId: "a", action: "click" })).executed, true); assert.equal(calls, 1);
});
test("computer-use honours Safe Mode as an external-action gate", async () => {
  const sm = createSafeMode({}); sm.enter("T");
  const f = createComputerUseFabric({ provider: { name: "p", tested: true, probeEvidence: evidence, execute: async () => "x" }, gate: o => sm.gate(o) });
  assert.equal((await f.execute({ agentId: "a", action: "click" })).executed, false);
});
test("loans, credit, bank transfers need owner approval (guardrail + gateway)", async () => {
  for (const a of ["take-loan", "open-credit", "bank-transfer", "borrow"]) {
    assert.equal(guardAction({ action: a, ownerApproved: true }).allowed, false, a);
    assert.equal(guardAction({ action: a }).risk, "HIGH");
  }
  const k = generateOwnerKeyPair(), auth = createOwnerAuth({ publicKeyB64: k.publicKeyB64 });
  const gw = createApprovalGateway({ ownerAuth: auth });
  assert.equal((await gw.verify({ action: "take-loan" })).allowed, false);                       // not LIVE yet
  const ch = auth.issueChallenge();
  auth.proveChannel(issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action: ch.action, subject: ch.subject }));
  assert.equal(gw.status().state, "LIVE");
  assert.equal((await gw.verify({ action: "take-loan" })).reason, "AUTHENTICATED_OWNER_APPROVAL_REQUIRED");
  const ok = await gw.verify({ action: "take-loan", approval: issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action: "TAKE_LOAN" }) });
  assert.equal(ok.allowed, true);
  const replay = await gw.verify({ action: "take-loan", approval: issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action: "BORROW" }) });
  assert.equal(replay.allowed, false);                                                            // wrong action for this approval
});
test("probe evidence validator is shared and strict", () => assert.equal(validProbeEvidence({ ...evidence, outcome: "PASS " }), false));

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmp, rm } from "./helpers.mjs";
test("model invocation is blocked by the default owner kill switch (real env-configured process)", () => {
  const d = tmp(), k = generateOwnerKeyPair(), here = path.dirname(fileURLToPath(import.meta.url));
  const script = `
    import { setEmergencyMode } from "${path.join(here, "../atlasz-addons/emergency-stop.mjs")}";
    import { issueOwnerApproval } from "${path.join(here, "../atlasz-addons/owner-auth.mjs")}";
    import { registerModelProvider, invokeModel } from "${path.join(here, "../atlasz-addons/multi-model-brain.mjs")}";
    const ev = { probeId: "p", outcome: "PASS", at: new Date().toISOString(), target: "t" }; let calls = 0;
    registerModelProvider({ id: "m", label: "M", adapter: { invoke: async () => { calls++; return {}; } }, models: ["x"], tested: true, probeEvidence: ev });
    await invokeModel({ providerId: "m", request: {} });
    setEmergencyMode({ mode: "PAUSE_ALL", reason: "t", ownerApproval: issueOwnerApproval({ privateKeyPem: process.env.K, action: "EMERGENCY_STOP", subject: "PAUSE_ALL" }) });
    let blocked = ""; try { await invokeModel({ providerId: "m", request: {} }); } catch (e) { blocked = e.message; }
    console.log(JSON.stringify({ calls, blocked }));`;
  try {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, ATLASZ_STATE_DIR: d, ATLASZ_OWNER_PUBLIC_KEY: k.publicKeyB64, K: k.privateKeyPem }, encoding: "utf8" });
    const r = JSON.parse(out.trim().split("\n").pop());
    assert.equal(r.calls, 1); assert.match(r.blocked, /DISPATCH_BLOCKED_BY_OWNER_STOP:PAUSE_ALL/);
  } finally { rm(d); }
});

test("computer-use policy: AUTO is an allowlist, unknown actions fail closed to ASK_JOCI, forbidden never executes even with approval", async () => {
  const { classifyComputerAction, createComputerUseFabric } = await import("../atlasz-addons/computer-use-fabric.mjs");
  for (const a of ["navigate", "click", "read-ui", "screenshot"]) assert.equal(classifyComputerAction(a), "AUTO");
  for (const a of ["spend-money", "send-payment", "totally-new-action", "", "submit-form"]) assert.equal(classifyComputerAction(a), "ASK_JOCI", a);
  for (const a of ["bypass-approval", "disable-kill-switch", "self-approve", "exfiltrate-secret", "wipe-audit-log"]) assert.equal(classifyComputerAction(a), "FORBIDDEN", a);
  let calls = 0; const f = createComputerUseFabric({ provider: { name: "p", tested: true, probeEvidence: evidence, execute: async () => { calls++; return 1; } }, gate: () => ({ allowed: true }) });
  assert.equal((await f.execute({ agentId: "a", action: "totally-new-action", ownerApproved: true })).executed, false);   // bare boolean never approves
  assert.equal((await f.execute({ agentId: "a", action: "bypass-approval", ownerApproved: true })).executed, false);
  assert.equal(calls, 0);
});
