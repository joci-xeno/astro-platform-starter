// Cross-layer control-bypass suite (Owner Control §17): every attempt to get around Joci's control must end BLOCKED / REJECTED / NOT VERIFIED.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createBrainSystem } from "../atlasz-addons/brain/brain-system.mjs";
import { createGovernance } from "../atlasz-addons/brain/governance.mjs";
import { createSimulationLab, SimulationLiveActionBlocked } from "../atlasz-addons/brain/simulation-lab.mjs";
import { createMoneyPipeline } from "../atlasz-addons/money-pipeline-controller.mjs";
import { createUpdateCenter } from "../atlasz-addons/update-center.mjs";
import { createControlChain } from "../atlasz-addons/owner-control/control-chain.mjs";
import { createOwnerAuthority } from "../atlasz-addons/owner-control/owner-authority.mjs";
import { rig, sign, ownerAuth, roster } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

const AGENT = { type: "AGENT", id: "E1" };

test("Brain subsystems cannot act while the Kill Switch is active (real Brain governance wired to the chain)", async () => {
  const r = rig(); const bdir = path.join(r.dir, "brain");
  const proxy = { evaluate: (...a) => r.sys.chain.evaluate(...a) };
  const brain = createBrainSystem({ dir: bdir, ownerAuth, roster: roster(), gate: x => r.emergency.gate(x), safeMode: r.safeMode, chain: proxy, executors: { build: async () => ({ ok: true }) } });
  try {
    const gov = brain.governance;
    assert.equal(gov.authorize({ brain: "ORCHESTRATOR", action: "EXECUTE_TASK", subject: "t" }).allowed, true);       // normal: internal work OK
    r.stop("PAUSE_ALL");
    for (const p of [{ brain: "ORCHESTRATOR", action: "EXECUTE_TASK" }, { brain: "PLANNING", action: "PLAN" }, { brain: "KNOWLEDGE", action: "WRITE" }, { brain: "OPPORTUNITY", action: "SEND_EXTERNAL", external: true }, { brain: "BUSINESS_FACTORY", action: "PUBLISH", external: true }, { brain: "RECOVERY", action: "ROLLBACK" }]) {
      const d = gov.authorize({ ...p, subject: "x", ownerApproval: sign("BRAIN_" + p.action, "x") });
      assert.equal(d.allowed, false, JSON.stringify(p)); assert.equal(d.decision, "DENY");
    }
    assert.equal((await brain.factory.requestExternal("svc", "PUBLISH", sign("BRAIN_PUBLISH", "svc")).catch(e => ({ done: false, reason: e.message }))).done, false);
    r.resume();
    // after resume: spending by a Brain is still blocked by the firewall even WITH Joci's Brain-spend approval (NO-SPEND default)
    const g = gov.authorize({ brain: "ORCHESTRATOR", action: "EXECUTE_TASK", spendUsd: 5, subject: "t", ownerApproval: sign("BRAIN_SPEND", "t") });
    assert.equal(g.allowed, false); assert.match(g.reason, /CHAIN:FINANCIAL_FIREWALL/);
  } finally { rm(r.dir); }
});

test("agent spending without Joci approval is BLOCKED; Planning Brain may RECOMMEND spend but execution is BLOCKED until approval", () => {
  const r = rig(); try {
    const a = r.sys.agents;
    assert.equal(a.act("E1", "SPEND", { spendUsd: 3 }).allowed, false);
    assert.equal(a.act("E1", "SPEND", { spendUsd: 3, ownerApproval: r.opApproval("SPEND", {}, 3) }).allowed, false);      // no-spend default still blocks
    assert.equal(a.act("E1", "RECOMMEND", { params: { suggestion: "buy API credits $20" } }).allowed, true);               // the recommendation itself is fine
    const exec = a.act("E1", "PURCHASE", { spendUsd: 20 }); assert.equal(exec.allowed, false); assert.equal(exec.layer, "FINANCIAL_FIREWALL");
    assert.equal(a.act("E1", "SUBSCRIBE", {}).verdict, "REQUIRE_APPROVAL"); assert.equal(a.act("E1", "SIGN_CONTRACT", {}).allowed, false);
    assert.equal(a.act("E1", "CONFIGURE_PAYMENT", {}).allowed, false);
  } finally { rm(r.dir); }
});

test("Business Factory publication, Computer Use consequential action, and Simulation LIVE execution are all BLOCKED", () => {
  const r = rig(); try {
    const c = r.sys.chain;
    assert.equal(c.run("business_factory.external", {}, () => "published").executed, false);
    assert.equal(c.run("computer_use", {}, () => "clicked-buy").executed, false);
    assert.equal(c.run("computer_use", { ownerApproval: r.opApproval("COMPUTER_USE_CONSEQUENTIAL", {}) }, () => "ok").executed, true);   // exact approval -> allowed
    const sim = c.evaluate({ actor: { type: "SIMULATION", id: "lab" }, operation: "SEND_EXTERNAL", external: true, ownerApproval: r.opApproval("SEND_EXTERNAL", {}) });
    assert.equal(sim.verdict, "BLOCK"); assert.match(sim.reason, /SIMULATION_NEVER_EXECUTES_LIVE/);
    assert.equal(c.evaluate({ actor: { type: "SIMULATION", id: "lab" }, operation: "SPEND", spendUsd: 1 }).verdict, "BLOCK");
    const lab = createSimulationLab(), res = lab.run({ name: "live-attempt", kind: "TEST", scenario: w => { w.live.sendEmail("customer@example.com"); return {}; } });
    assert.ok(JSON.stringify(res).includes("SIMULATION_LIVE_ACTION_BLOCKED:sendEmail")); assert.notEqual(res.passed, true);
  } finally { rm(r.dir); }
});

test("Security Brain: privilege escalation / forbidden grants are BLOCKED and it cannot grant authority; quarantined agents are stopped everywhere", () => {
  const r = rig(); try {
    const c = r.sys.chain;
    const e = c.evaluate({ actor: AGENT, operation: "PUBLISH", params: {}, securityEvent: { kind: "PRIVILEGE_REQUEST", permission: "KILL_SWITCH", agentId: "E1" }, ownerApproval: r.opApproval("PUBLISH", {}) });
    assert.equal(e.verdict, "BLOCK"); assert.equal(e.layer, "SECURITY_BRAIN");
    assert.equal(r.security.isQuarantined("E1"), true);
    assert.equal(r.sys.agents.act("E1", "INTERNAL_COMPUTE").allowed, true);   // internal low-risk work is not security-gated by the chain...
    assert.equal(r.sys.agents.act("E1", "SEND_EXTERNAL", { ownerApproval: r.opApproval("SEND_EXTERNAL", {}) }).allowed, false);   // ...but any external/risky action is
    for (const f of ["GRANT_PERMISSION", "SELF_APPROVE", "DISABLE_KILL_SWITCH", "CHANGE_OWNER_AUTHORITY", "DISABLE_SECURITY_BRAIN", "BYPASS_CONTROL"]) assert.equal(c.evaluate({ actor: { type: "BRAIN", id: "B" }, operation: f }).verdict, "BLOCK", f);
    assert.equal(c.evaluate({ actor: { type: "AGENT", id: "E2" }, operation: "CHANGE_OWNER_PERMISSION", ownerApproval: r.opApproval("CHANGE_OWNER_PERMISSION", {}) }).verdict, "BLOCK");   // reserved for the owner
    assert.equal(r.security.release("E1", null).released, false);
  } finally { rm(r.dir); }
});

test("independent verification: false PAID/SENT/DELIVERED claims are REJECTED, and weak states never become strong on a claim", () => {
  const r = rig({ lookups: { paymentConfirmed: ref => ({ confirmed: ref === "pay_real", amountUsd: 100 }), deliveryRecord: ref => ({ delivered: ref === "del_real" }) } }); try {
    const v = p => r.sys.chain.verifyOutcome(p);
    assert.equal(v({ claimType: "PAYMENT", claim: { ref: "pay_fake", amountUsd: 100 }, evidence: {}, executorId: "E1" }).verdict, "REJECT");
    assert.equal(v({ claimType: "PAYMENT", claim: { ref: "pay_real", amountUsd: 999 }, evidence: {}, executorId: "E1" }).verdict, "REJECT");
    assert.equal(v({ claimType: "PAYMENT", claim: { ref: "pay_real", amountUsd: 100 }, evidence: {}, executorId: "E1" }).verdict, "ACCEPT");
    const k = r.sys.claims;
    k.set("mail1", "QUEUED"); assert.equal(k.advance("mail1", { claim: {}, evidence: { state: "QUEUED" } }).advanced, false); assert.equal(k.get("mail1").state, "QUEUED");
    assert.equal(k.advance("mail1", { claim: { ref: "m" }, evidence: { providerMessageId: "pm_1", state: "ACCEPTED" } }).state, "SENT");
    k.set("inv1", "CUSTOMER_SAYS_PAID"); assert.equal(k.advance("inv1", { claim: { ref: "pay_fake" }, evidence: {} }).state, "CUSTOMER_SAYS_PAID");
    assert.equal(k.advance("inv1", { claim: { ref: "pay_real", amountUsd: 100 }, evidence: {} }).state, "VERIFIED_PAYMENT");
    k.set("conn", "CONNECTED"); assert.equal(k.advance("conn", { claim: {}, evidence: { ok: true, probeAt: new Date(Date.now() - 3600e3).toISOString() } }).state, "CONNECTED");   // stale probe
    assert.equal(k.advance("conn", { claim: {}, evidence: { ok: true, probeAt: new Date().toISOString() } }).state, "LIVE");
    k.set("sim", "SIMULATION"); assert.equal(k.advance("sim", { claim: {}, evidence: {} }).state, "SIMULATION");
    for (const [w] of [["REQUESTED"], ["DRAFT"], ["CREATED"], ["INVOICE"], ["CONFIGURED"]]) { k.set("x" + w, w); assert.equal(k.advance("x" + w, { claim: {}, evidence: {} }).advanced, false, w); }
    // FAIL CLOSED: verification layer absent => NOT VERIFIED
    const r2 = rig({ lookups: {} }); try { assert.equal(r2.sys.chain.verifyOutcome({ claimType: "PAYMENT", claim: { ref: "pay_real" }, evidence: {}, executorId: "E1" }).verdict, "ESCALATE"); } finally { rm(r2.dir); }
  } finally { rm(r.dir); }
});

test("Money Engine: every state needs typed verified evidence; customer-says-paid is never revenue; payment verification unavailable => NOT VERIFIED", () => {
  const art = path.join(tmp(), "deliverable.txt"); fs.writeFileSync(art, "result");
  const r = rig({ lookups: { paymentConfirmed: ref => ({ confirmed: ref === "pay_real", amountUsd: 100 }), deliveryRecord: ref => ({ delivered: ref === "del_real" }) } }); const g = r.sys.moneyGuard; try {
    let p = createMoneyPipeline({ id: "deal-1", sourceEvidence: "hn:1", estimatedValueUsd: 100 });
    const step = (to, evidence = {}, extra = {}) => { const o = g.advance(p, to, { evidence, ...extra }); if (o.ok) p = o.pipeline; return o; };
    assert.equal(step("QUALIFIED").ok, true); assert.equal(step("PROPOSAL_DRAFT").ok, true);
    assert.equal(step("APPROVED_TO_SEND").ok, false);                                       // owner approval missing
    assert.equal(step("APPROVED_TO_SEND", {}, { ownerApproval: sign("MONEY_APPROVED_TO_SEND", "deal-1") }).ok, true);
    assert.equal(step("SENT", { providerMessageId: "pm", state: "QUEUED" }).ok, false);     // QUEUED != SENT
    assert.equal(step("SENT", {}).ok, false);
    assert.equal(step("SENT", { providerMessageId: "pm_1", state: "ACCEPTED" }).ok, true);
    assert.equal(step("WON", { customerAcceptanceRef: "x" }).ok, false); assert.equal(step("WON", { customerAcceptanceRef: "mail-77", source: "CUSTOMER" }).ok, true);
    assert.equal(step("ASSIGNED").ok, true); assert.equal(step("EXECUTING").ok, true);
    assert.equal(step("QA_PASSED", { qaReportRef: "qa1", independentVerdict: "ACCEPT", qaBy: "E1", executorId: "E1" }).ok, false);   // executor may not QA itself
    assert.equal(step("QA_PASSED", { qaReportRef: "qa1", independentVerdict: "ACCEPT", qaBy: "E9", executorId: "E1" }).ok, true);
    assert.equal(step("DELIVERY_APPROVED", {}, { ownerApproval: sign("MONEY_DELIVERY_APPROVED", "deal-1") }).ok, true);
    assert.equal(step("DELIVERED", { artifactPath: art, deliveryRef: "del_fake" }).ok, false);                         // CREATED != DELIVERED
    assert.equal(step("DELIVERED", { artifactPath: art, deliveryRef: "del_real" }).ok, true);
    assert.equal(step("INVOICE_APPROVED", {}, { ownerApproval: sign("MONEY_INVOICE_APPROVED", "deal-1") }).ok, true);
    assert.equal(step("INVOICED", {}).ok, false); assert.equal(step("INVOICED", { invoiceId: "INV-1" }).ok, true);
    assert.equal(g.recordCustomerPaymentClaim(p, { note: "I paid yesterday" }).countsAsRevenue, false); assert.equal(p.state, "INVOICED");
    assert.equal(g.recordPayment(p, { paymentRef: "pay_fake", amountUsd: 100, signatureVerified: true }).ok, false);
    assert.equal(g.recordPayment(p, { paymentRef: "pay_real", amountUsd: 100, signatureVerified: false }).ok, false);
    assert.equal(r.sys.firewall.summary().verifiedRevenueUsd, 0);
    const paid = g.recordPayment(p, { paymentRef: "pay_real", amountUsd: 100, costUsd: 10, signatureVerified: true });
    assert.equal(paid.ok, true); assert.equal(paid.pipeline.state, "PAID_VERIFIED"); assert.equal(r.sys.firewall.summary().verifiedRevenueUsd, 100);
    // kill switch freezes external money steps
    let q = createMoneyPipeline({ id: "deal-2", sourceEvidence: "hn:2" });
    for (const to of ["QUALIFIED", "PROPOSAL_DRAFT"]) q = g.advance(q, to).pipeline;
    q = g.advance(q, "APPROVED_TO_SEND", { ownerApproval: sign("MONEY_APPROVED_TO_SEND", "deal-2") }).pipeline;
    r.stop("STOP_EXTERNAL_ACTIONS"); const blocked = g.advance(q, "SENT", { evidence: { providerMessageId: "pm", state: "ACCEPTED" } }); assert.equal(blocked.ok, false); assert.match(blocked.reason, /KILL_SWITCH|EMERGENCY/);
    // payment verification unavailable
    const r3 = rig({ lookups: {} }); try { const inv = { ...p, state: "INVOICED", money: { invoiced: 100, received: 0, cost: 0, netVerified: 0 } }; const o = r3.sys.moneyGuard.recordPayment(inv, { paymentRef: "pay_real", amountUsd: 100, signatureVerified: true }); assert.equal(o.ok, false); assert.match(o.reason, /NOT_VERIFIED|ESCALATE|NO_PAYMENT_EVIDENCE/); } finally { rm(r3.dir); }
  } finally { rm(r.dir); }
});

test("30-agent governance: exactly the fixed roster; no silent/unregistered agent or tool; creation is refused even with approval", () => {
  const r = rig(); try {
    const a = r.sys.agents; assert.equal(a.report().topology.ok, true); assert.equal(a.report().agents, 30); assert.equal(a.report().allActionsViaChain, true);
    assert.equal(a.act("E25", "INTERNAL_COMPUTE").allowed, true);
    assert.equal(a.act("SHADOW_AGENT", "INTERNAL_COMPUTE").allowed, false); assert.equal(a.act("SHADOW_AGENT", "INTERNAL_COMPUTE").reason, "AGENT_NOT_IN_FIXED_ROSTER");
    assert.equal(a.act("E1", "INTERNAL_COMPUTE", { tool: "shell-unrestricted" }).reason, "TOOL_NOT_REGISTERED");
    assert.equal(a.createAgent({ name: "SHADOW" }, { requestedBy: AGENT }).created, false);
    assert.equal(a.createAgent({ name: "SHADOW" }, { requestedBy: { type: "OWNER", id: "JOCI" }, ownerApproval: r.opApproval("CREATE_AGENT", { name: "SHADOW" }) }).reason, "TOPOLOGY_FIXED_30_CHANGE_IS_A_GOVERNED_RELEASE_NOT_A_RUNTIME_ACTION");
    assert.equal(a.registerTool("rm-rf").registered, false); assert.equal(a.registerTool("calc", { ownerApproval: r.opApproval("HIGH_RISK_CHANGE", { tool: "calc" }) }).registered, true);
    assert.equal(a.act("E1", "INTERNAL_COMPUTE", { tool: "calc" }).allowed, true);
    assert.ok(r.blackBox.all().some(e => e.kind === "UNREGISTERED_AGENT_ACTION"));
    const bad = rig({ roster: roster().slice(0, 29) }); try { assert.equal(bad.sys.agents.act("E1", "INTERNAL_COMPUTE").reason, "TOPOLOGY_INVALID_FAIL_CLOSED"); assert.equal(bad.sys.doctor.run().components.agent_topology_30.state, "BLOCKED"); } finally { rm(bad.dir); }
  } finally { rm(r.dir); }
});

test("FAIL CLOSED: unknown kill-switch/safe-mode/security/black-box state, throwing layers, unknown actor => BLOCK", () => {
  const r = rig(); try {
    const mk = o => createControlChain({ authority: createOwnerAuthority({ ownerAuth }), gate: () => ({ allowed: true }), ...o });
    const ev = c => c.evaluate({ actor: AGENT, operation: "INTERNAL_COMPUTE" });
    assert.equal(ev(mk({ gate: () => undefined })).reason, "KILL_SWITCH_STATE_UNKNOWN");
    assert.match(ev(mk({ gate: () => { throw new Error("boom"); } })).reason, /LAYER_ERROR_FAIL_CLOSED/);
    assert.equal(ev(mk({ safeMode: { gate: () => undefined } })).reason, "SAFE_MODE_STATE_UNKNOWN");
    const ext = c => c.evaluate({ actor: AGENT, operation: "SEND_EXTERNAL", ownerApproval: r.opApproval("SEND_EXTERNAL", {}) });
    assert.equal(ext(mk({ safeMode: r.safeMode })).reason, "SECURITY_STATUS_UNKNOWN");                                   // no security brain => do not assume safe
    assert.equal(ext(mk({ safeMode: r.safeMode, security: r.security, blackBox: { record: () => { throw new Error("disk"); } } })).reason, "BLACK_BOX_UNAVAILABLE_FAIL_CLOSED");
    assert.equal(mk({}).evaluate({ operation: "INTERNAL_COMPUTE" }).reason, "UNKNOWN_ACTOR_FAIL_CLOSED");
    assert.throws(() => createControlChain({ authority: createOwnerAuthority({ ownerAuth }) }), /KILL_SWITCH_GATE_REQUIRED/);
    assert.equal(r.sys.chain.run("scheduler.external", {}, () => 1).executed, false);
  } finally { rm(r.dir); }
});

test("Safe Mode: external actions blocked, doctor/recovery/inspection stay available, modules and workflows can be isolated, never reported as normal", () => {
  const r = rig(); try {
    r.safeMode.enter("TEST_FAULT");
    const c = r.sys.chain;
    const ext = c.evaluate({ actor: AGENT, operation: "SEND_EXTERNAL", ownerApproval: r.opApproval("SEND_EXTERNAL", {}) });
    assert.equal(ext.verdict, "BLOCK"); assert.equal(ext.layer, "SAFE_MODE");
    assert.equal(c.evaluate({ actor: AGENT, operation: "INTERNAL_COMPUTE" }).verdict, "BLOCK");              // writes blocked too
    for (const op of ["READ_STATUS", "RUN_SYSTEM_DOCTOR", "VERIFY_BACKUP", "CREATE_RESTORE_POINT", "VIEW_INCIDENTS"]) assert.equal(c.evaluate({ actor: { type: "OWNER", id: "JOCI" }, operation: op }).verdict, "ALLOW", op);
    const rep = r.sys.doctor.run(); assert.equal(rep.normalOperation, false);
    assert.equal(r.sys.status().safeMode.normal, false); assert.match(r.sys.status().safeMode.banner, /SAFE MODE ACTIVE/);
    // exit requires owner approval + passing self check (existing control)
    assert.throws(() => r.safeMode.exit({ ownerApproval: null, selfCheck: { ok: true } }), /SAFE_MODE_EXIT_DENIED/);
    r.safeMode.exit({ ownerApproval: sign("SAFE_MODE_EXIT", "NORMAL"), selfCheck: { ok: true } });
    r.sys.isolation.isolate("connector-x", { reason: "ERRORS", workflows: ["wf-outreach"], diagnostics: { err: 7 } });
    assert.match(c.evaluate({ actor: AGENT, operation: "INTERNAL_COMPUTE", moduleId: "connector-x" }).reason, /MODULE_ISOLATED/);
    assert.match(c.evaluate({ actor: AGENT, operation: "INTERNAL_COMPUTE", workflowId: "wf-outreach" }).reason, /WORKFLOW_STOPPED/);
    assert.equal(c.evaluate({ actor: AGENT, operation: "INTERNAL_COMPUTE", moduleId: "healthy" }).verdict, "ALLOW");
    assert.equal(r.sys.isolation.list().modules[0].diagnostics.err, 7);
  } finally { rm(r.dir); }
});

test("recovery: categorised restore points, drill-verified backups, tamper => FAILED, LKG criteria, never auto-newest, restore/rollback need exact owner approval", () => {
  const r = rig({ sources: { APPLICATION_VERSION: { "app.js": "v1" }, CONFIGURATION: { "cfg.json": "{}" } } }); const rec = r.sys.recovery; try {
    assert.equal(rec.readiness().restoreReadiness, "UNKNOWN");
    const pts = rec.createRestorePoint({ appVersion: "1.0.0" });
    assert.equal(pts.APPLICATION_VERSION.status, "CREATED"); assert.equal(pts.DATABASE_SCHEMA.status, "NOT_CONFIGURED");
    assert.equal(r.sys.doctor.run().components.backup.state, "UNKNOWN");                       // exists but not yet verified -> UNKNOWN, not HEALTHY
    const ver = rec.verifyBackups(); assert.equal(ver.APPLICATION_VERSION.status, "VERIFIED"); assert.equal(ver.CONFIGURATION.status, "VERIFIED"); assert.equal(ver.MODEL_ROUTING.status, "NOT_CONFIGURED");
    const good = { buildIdentified: true, configKnown: true, dependenciesKnown: true, schemaStateKnown: true, criticalTestsPassed: true, healthChecksPassed: true, backupAvailable: true, rollbackPathKnown: true, recoveryEvidence: true };
    const build = { version: "1.0.0", buildId: "b1", configHash: "c1", dependenciesHash: "d1" };
    for (const k of Object.keys(good)) assert.throws(() => rec.markLkg({ build, checks: { ...good, [k]: false }, evidence: "e" }), /LKG_REQUIREMENTS_NOT_MET/, k);
    assert.throws(() => rec.markLkg({ build: { version: "1" }, checks: good, evidence: "e" }), /NOT_IDENTIFIABLE/);
    assert.throws(() => rec.markLkg({ build, checks: good, evidence: null }), /EVIDENCE_REQUIRED/);
    const l1 = rec.markLkg({ build, checks: good, evidence: "drill+tests" }); assert.ok(l1.backupId);
    assert.equal(rec.readiness().restoreReadiness, "READY");
    // newer LKG whose backup was corrupted is skipped, the older verified one is used
    fs.writeFileSync(path.join(r.sources.APPLICATION_VERSION, "app.js"), "v2"); rec.createRestorePoint({ categories: ["APPLICATION_VERSION"] }); rec.verifyBackups({ categories: ["APPLICATION_VERSION"] });
    const l2 = rec.markLkg({ build: { ...build, version: "2.0.0", buildId: "b2" }, checks: good, evidence: "drill+tests" });
    const dir2 = l2.backupDir; fs.appendFileSync(path.join(dir2, "data", "app.js"), "TAMPER");
    const lv = rec.latestVerifiedLkg(); assert.equal(lv.lkg.backupId, l1.backupId); assert.equal(lv.skipped.length, 1);
    // rollback: owner approval bound to exact LKG + target
    fs.writeFileSync(path.join(r.sources.APPLICATION_VERSION, "app.js"), "BROKEN");
    assert.equal(rec.rollbackToLkg({}).rolledBack, false);
    assert.equal(rec.rollbackToLkg({ ownerApproval: r.opApproval("ROLLBACK", { lkg: "wrong", targetDir: path.resolve(r.sources.APPLICATION_VERSION) }) }).rolledBack, false);
    const ok = rec.rollbackToLkg({ ownerApproval: r.opApproval("ROLLBACK", { lkg: l1.backupId, targetDir: path.resolve(r.sources.APPLICATION_VERSION) }) });
    assert.equal(ok.rolledBack, true); assert.equal(fs.readFileSync(path.join(r.sources.APPLICATION_VERSION, "app.js"), "utf8"), "v1");
    // restore needs approval bound to category/backup/target
    assert.equal(rec.restore({ category: "CONFIGURATION" }).restored, false);
    // broken recovery: corrupt a configuration backup => FAILED, readiness NOT_READY, doctor never HEALTHY
    const cdir = fs.readdirSync(path.join(r.dir, "oc", "recovery", "backups", "CONFIGURATION")).sort().at(-1);
    fs.writeFileSync(path.join(r.dir, "oc", "recovery", "backups", "CONFIGURATION", cdir, "data", "cfg.json"), "corrupt");
    assert.equal(rec.verifyBackups().CONFIGURATION.status, "FAILED");
    assert.equal(rec.readiness().restoreReadiness, "NOT_READY");
    const rep = r.sys.doctor.run(); assert.equal(rep.components.recovery_readiness.state, "FAILED"); assert.equal(rep.overall, "FAILED"); assert.equal(rep.normalOperation, false);
  } finally { rm(r.dir); }
});

test("System Doctor v2: per-component states; missing=NOT_CONFIGURED, throwing=FAILED, unusable=UNKNOWN; UNKNOWN is never HEALTHY", () => {
  const r = rig({ sources: {} }); try {
    const rep = r.sys.doctor.run();
    for (const c of ["runtime", "agent_topology_30", "queue", "database", "brain_components", "models", "tools", "connectors", "secret_vault", "owner_authentication", "kill_switch", "approval_gateway", "security_brain", "financial_firewall", "black_box", "backup", "last_known_good", "recovery_readiness", "update_center"]) assert.ok(c in rep.components, c);
    assert.equal(rep.components.queue.state, "NOT_CONFIGURED"); assert.equal(rep.components.black_box.state, "HEALTHY"); assert.equal(rep.components.kill_switch.state, "HEALTHY");
    assert.equal(rep.normalOperation, false); assert.notEqual(rep.overall, "HEALTHY");
    r.stop("PAUSE_ALL"); assert.equal(r.sys.doctor.run().components.kill_switch.state, "BLOCKED"); r.resume();
    fs.appendFileSync(path.join(r.dir, "bb.jsonl"), '{"tampered":true}\n'); assert.equal(r.sys.doctor.run().components.black_box.state, "FAILED");
  } finally { rm(r.dir); }
});

test("broken update => automatic ROLLBACK to the exact previous bytes and the install stays healthy (update centre + recovery)", async () => {
  const root = tmp(), installDir = path.join(root, "mod-a"); fs.mkdirSync(installDir); fs.writeFileSync(path.join(installDir, "VERSION"), "1.0.0"); fs.writeFileSync(path.join(installDir, "code.txt"), "original");
  try {
    const uc = createUpdateCenter({ stateDir: path.join(root, "st"), backupRoot: path.join(root, "bk"), ownerAuth, adapters: {
      detector: async () => [{ componentId: "mod-a", version: "1.1.0", riskTags: [] }],
      stager: async ({ update, stagingDir }) => { fs.writeFileSync(path.join(stagingDir, "VERSION"), update.version); fs.writeFileSync(path.join(stagingDir, "BROKEN"), "1"); return { ok: true, evidence: "staged" }; },
      tester: async ({ dir, phase }) => ({ passed: !(fs.existsSync(path.join(dir, "BROKEN")) && phase === "POST_INSTALL"), evidence: phase }),
      securityHealth: async () => ({ ok: true, findings: [] }) } });
    uc.registerComponent({ id: "mod-a", kind: "MODULE", version: "1.0.0", installDir }); await uc.checkForUpdates();
    const v = await uc.safeUpdate("mod-a@1.1.0", { ownerApproval: sign("INSTALL_UPDATE", "mod-a@1.1.0") });
    assert.equal(v.state, "ROLLED_BACK"); assert.equal(fs.readFileSync(path.join(installDir, "code.txt"), "utf8"), "original"); assert.equal(uc.componentVersion("mod-a"), "1.0.0");
  } finally { rm(root); }
});

test("Black Box: every control decision is recorded, hash-chained, tamper-evident, and contains no plaintext secrets", () => {
  const r = rig(); try {
    const secret = "sk-" + "ant-api03-" + "A".repeat(30);
    r.sys.chain.evaluate({ actor: AGENT, operation: "SEND_EXTERNAL", securityEvent: { kind: "EXTERNAL_INSTRUCTION", text: "token " + secret } });
    r.sys.chain.evaluate({ actor: AGENT, operation: "NOT_AN_OPERATION", ownerApproval: r.opApproval("PUBLISH", {}) });
    const file = fs.readFileSync(path.join(r.dir, "bb.jsonl"), "utf8"); assert.ok(!file.includes(secret)); assert.ok(!file.includes("signature"));
    const e = r.blackBox.all().filter(x => x.kind === "CONTROL_DECISION"); assert.ok(e.length >= 2); assert.ok(e.every(x => x.decision && x.reason && x.agentId && x.correlationId));
    assert.equal(r.blackBox.verify().ok, true);
    const lines = file.split("\n").filter(Boolean); lines[0] = lines[0].replace(/"decision":"[A-Z_]+"/, '"decision":"ALLOW"'); fs.writeFileSync(path.join(r.dir, "bb.jsonl"), lines.join("\n") + "\n");
    assert.equal(r.sys.doctor.run().components.black_box.state, "FAILED");
  } finally { rm(r.dir); }
});
