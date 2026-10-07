import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createGovernance, BRAIN_FORBIDDEN } from "../atlasz-addons/brain/governance.mjs";
import { createBlackBox, redactSecrets } from "../atlasz-addons/brain/black-box.mjs";
import { createCapabilityGraph } from "../atlasz-addons/brain/capability-graph.mjs";
import { createPlanningBrain } from "../atlasz-addons/brain/planning-brain.mjs";
import { tmp, rm } from "./helpers.mjs";

function owner() { const k = generateOwnerKeyPair(); return { auth: createOwnerAuth({ publicKeyB64: k.publicKeyB64 }), ap: (action, subject) => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action, subject }) }; }
const allow = () => ({ allowed: true }), stop = () => ({ allowed: false, reason: "STOP" });

// ---------- governance ----------
test("governance: forbidden actions are denied even with a valid owner approval; brains cannot self-approve", () => {
  const { auth, ap } = owner(), g = createGovernance({ gate: allow, ownerAuth: auth });
  for (const a of BRAIN_FORBIDDEN) assert.equal(g.authorize({ brain: "SECURITY", action: a, ownerApproval: ap("BRAIN_" + a, a) }).decision, "DENY", a);
  assert.equal(typeof g.issueApproval, "undefined"); assert.equal(typeof g.sign, "undefined");
});
test("governance: kill switch stops external actions; spend and publish need a bound owner approval", () => {
  const { auth, ap } = owner();
  let open = true; const g = createGovernance({ gate: o => (open || !o.external ? { allowed: true } : stop()), ownerAuth: auth });
  assert.equal(g.authorize({ action: "READ_STATE" }).decision, "ALLOW");
  assert.equal(g.authorize({ action: "PUBLISH", subject: "site1" }).decision, "NEEDS_APPROVAL");
  assert.equal(g.authorize({ action: "PUBLISH", subject: "site1", ownerApproval: ap("BRAIN_PUBLISH", "other") }).decision, "NEEDS_APPROVAL");
  assert.equal(g.authorize({ action: "PUBLISH", subject: "site1", ownerApproval: ap("BRAIN_PUBLISH", "site1") }).decision, "ALLOW");
  assert.equal(g.authorize({ action: "BUY_TOOL", spendUsd: 5, subject: "t" }).decision, "NEEDS_APPROVAL");
  assert.equal(g.authorize({ action: "BUY_TOOL", spendUsd: -1 }).decision, "DENY");
  assert.equal(g.authorize({ action: "BUY_TOOL", spendUsd: 5, subject: "t", ownerApproval: ap("BRAIN_SPEND", "t") }).decision, "ALLOW");
  open = false;
  assert.equal(g.authorize({ action: "SEND_EXTERNAL", subject: "m", ownerApproval: ap("BRAIN_SEND_EXTERNAL", "m") }).reason, "OWNER_STOP");   // approval does not beat the kill switch
  assert.equal(g.authorize({ action: "READ_STATE" }).decision, "ALLOW");
  assert.equal(g.audit.verify().ok, true); assert.ok(g.audit.entries().length >= 9);
});
test("governance: approval cannot be replayed", () => {
  const { auth, ap } = owner(), g = createGovernance({ gate: allow, ownerAuth: auth }), a = ap("BRAIN_DEPLOY", "x");
  assert.equal(g.authorize({ action: "DEPLOY", subject: "x", ownerApproval: a }).decision, "ALLOW");
  assert.equal(g.authorize({ action: "DEPLOY", subject: "x", ownerApproval: a }).decision, "NEEDS_APPROVAL");
});

// ---------- black box ----------
test("black box: correlation timeline, hash chain, secrets never written", () => {
  const d = tmp(), f = path.join(d, "bb.jsonl");
  try {
    const bb = createBlackBox({ filePath: f }), c = bb.newCorrelationId();
    bb.record({ kind: "TASK_START", correlationId: c, jobId: "j1", taskId: "t1", agentId: "A1", reason: "token=abcdef123456 used", costUsd: 0.5, inputRef: "sk" + "-abcdefghijklmnopqrstuv" });
    bb.record({ kind: "TASK_END", correlationId: c, jobId: "j1", agentId: "A1", result: "OK", durationMs: 40 });
    bb.record({ kind: "ERROR", jobId: "j2", error: "boom", retry: 1 });
    assert.equal(bb.timeline(c).length, 2); assert.equal(bb.query({ jobId: "j2" }).length, 1);
    const raw = JSON.stringify(bb.all()); assert.equal(/abcdef123456|sk-abcdefghijkl/.test(raw), false);
    assert.equal(bb.stats().errors, 1); assert.equal(bb.stats().costUsd, 0.5);
    assert.equal(createBlackBox({ filePath: f }).verify().ok, true);                               // reload + verify
    assert.equal(redactSecrets({ apiKey: "x1234567", n: { password: "pw" } }).apiKey, "[REDACTED]");
    assert.throws(() => bb.record({}), /KIND_REQUIRED/);
  } finally { rm(d); }
});
test("black box: tampering with the file is detected on load", async () => {
  const d = tmp(), f = path.join(d, "bb.jsonl"), fs = await import("node:fs");
  try {
    const bb = createBlackBox({ filePath: f }); bb.record({ kind: "A", jobId: "j" }); bb.record({ kind: "B", jobId: "j" });
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"j"', '"x"'));
    assert.throws(() => createBlackBox({ filePath: f }), /AUDIT_CHAIN_TAMPERED/);
  } finally { rm(d); }
});

// ---------- capability graph ----------
function graph(file) {
  const g = createCapabilityGraph({ file });
  g.upsert({ id: "A-exec-1", type: "AGENT", capabilities: ["web.build", "docs.write"] });
  g.upsert({ id: "A-exec-2", type: "AGENT", capabilities: ["web.build"] });
  g.upsert({ id: "M-free", type: "MODEL", capabilities: ["text.generate"], costClass: "FREE", requiredCredentials: ["KEY"], family: "fam1" });
  g.upsert({ id: "M-paid", type: "MODEL", capabilities: ["text.generate"], costClass: "MEDIUM", requiredCredentials: ["KEY2"], family: "fam2" });
  g.upsert({ id: "T-lint", type: "TOOL", capabilities: ["code.lint"], costClass: "FREE" });
  return g;
}
test("capability graph: unprobed or credential-less models/tools are not usable; evidence + credentials make them usable; no spend by default", () => {
  const g = graph(null);
  let m = g.match({ capabilities: ["web.build", "text.generate"] });
  assert.equal(m.matched, false); assert.deepEqual(m.missingCapabilities, ["text.generate"]);
  assert.ok(m.excluded.find(e => e.id === "M-free").reasons.includes("NO_CREDENTIALS")); assert.ok(m.excluded.find(e => e.id === "M-free").reasons.includes("NOT_PROBED_LIVE"));
  g.setCredentials("M-free", true); g.setEvidence("M-free", { probeId: "p1", outcome: "PASS", at: new Date().toISOString(), target: "m" });
  g.setCredentials("M-paid", true); g.setEvidence("M-paid", { probeId: "p2", outcome: "PASS", at: new Date().toISOString(), target: "m2" });
  m = g.match({ capabilities: ["web.build", "text.generate"] });
  assert.equal(m.matched, true); assert.equal(m.combination.MODEL, "M-free");
  assert.ok(m.excluded.find(e => e.id === "M-paid").reasons.includes("NO_SPEND_DEFAULT"));
  const paid = g.match({ capabilities: ["text.generate"], allowCost: true, exclude: ["M-free"] });
  assert.equal(paid.combination.MODEL, "M-paid"); assert.deepEqual(paid.needsApproval, ["M-paid"]);
  assert.throws(() => g.setEvidence("nope", {}), /UNKNOWN_NODE/);
  g.setEvidence("M-free", { outcome: "PASS" });                                                  // malformed evidence clears it
  assert.equal(g.view("M-free").usable, false);
});
test("capability graph: measured reliability drives selection; independent-family constraint; durable across restart", () => {
  const d = tmp(), f = path.join(d, "g.json");
  try {
    const g = graph(f);
    for (let i = 0; i < 5; i++) { g.recordOutcome("A-exec-1", { ok: i < 2, ms: 10, quality: 0.3 }); g.recordOutcome("A-exec-2", { ok: true, ms: 10, quality: 0.9 }); }
    assert.equal(g.match({ capabilities: ["web.build"] }).combination.AGENT, "A-exec-2");
    assert.equal(createCapabilityGraph({ file: f }).view("A-exec-1").reliability, 0.4);           // restart
    g.setCredentials("M-free", true); g.setEvidence("M-free", { probeId: "p", outcome: "PASS", at: new Date().toISOString(), target: "t" });
    assert.ok(g.match({ capabilities: ["text.generate"], preferFamilyNot: "fam1" }).excluded.some(e => e.reasons.includes("SAME_FAMILY_AS_GENERATOR")));
    g.setHealth("A-exec-2", "DOWN"); assert.equal(g.match({ capabilities: ["web.build"] }).combination.AGENT, "A-exec-1");
    assert.throws(() => g.upsert({ id: "x", type: "BOGUS" }), /VALID_TYPE/);
  } finally { rm(d); }
});

// ---------- planning brain ----------
const spec = () => ({ goal: "Deliver website job", projects: [{ name: "Site", milestones: [{ name: "Build", tasks: [
  { id: "t1", title: "scaffold", priority: 1, estCostUsd: 0, risk: 0, subtasks: ["init", "lint"] },
  { id: "t2", title: "content", dependsOn: ["t1"], priority: 5, estCostUsd: 0 },
  { id: "t3", title: "deploy preview", dependsOn: ["t2"], external: true, risk: 2 },
  { id: "t4", title: "buy domain", dependsOn: ["t1"], estCostUsd: 12 }] }] }] });
test("planning brain: hierarchy, topological order, approval points, cost estimate never authorizes spend", () => {
  const pb = createPlanningBrain(), p = pb.createPlan(spec());
  assert.deepEqual(p.order.slice(0, 1), ["t1"]); assert.ok(p.order.indexOf("t2") < p.order.indexOf("t3"));
  assert.deepEqual(p.approvalPoints.map(a => a.taskId).sort(), ["t3", "t4"]);
  assert.equal(p.estCost.knownUsd, 12); assert.equal(p.estCost.authorized, false); assert.equal(p.estCost.unknownTasks, 1);
  assert.equal(p.tasks.t1.subtasks.length, 2); assert.deepEqual(p.risk.highRiskTasks, ["t3"]);
  assert.deepEqual(pb.nextTasks(p.id).map(t => t.id), ["t1"]);
});
test("planning brain: rejects cycles, unknown/duplicate ids; DONE needs independent ACCEPT; dependency order enforced", () => {
  const pb = createPlanningBrain(), mk = tasks => ({ goal: "g", projects: [{ milestones: [{ tasks }] }] });
  assert.throws(() => pb.createPlan(mk([{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }])), /DEPENDENCY_CYCLE/);
  assert.throws(() => pb.createPlan(mk([{ id: "a", dependsOn: ["zz"] }])), /UNKNOWN_DEPENDENCY/);
  assert.throws(() => pb.createPlan(mk([{ id: "a" }, { id: "a" }])), /DUPLICATE/);
  const p = pb.createPlan(spec());
  assert.throws(() => pb.markTask(p.id, "t2", "RUNNING"), /DEPENDENCIES_NOT_DONE/);
  pb.markTask(p.id, "t1", "RUNNING");
  assert.throws(() => pb.markTask(p.id, "t1", "DONE", { result: "I did it" }), /DONE_REQUIRES/);
  assert.throws(() => pb.markTask(p.id, "t1", "DONE", { verification: { verdict: "ACCEPT", independent: false } }), /DONE_REQUIRES/);
  pb.markTask(p.id, "t1", "DONE", { verification: { verdict: "ACCEPT", independent: true } });
  assert.deepEqual(pb.nextTasks(p.id).map(t => t.id).sort(), ["t2", "t4"]); assert.equal(pb.progress(p.id).done, 1);
});
test("planning brain: failure policy covers RETRY/CHANGE_*/FALLBACK/REPLAN/ASK_JOCI/STOP_SAFELY and never retries through a kill switch", () => {
  const pb = createPlanningBrain({ maxRetries: 2 }), p = pb.createPlan(spec());
  pb.markTask(p.id, "t1", "RUNNING");
  assert.equal(pb.decideOnFailure(p.id, "t1", { kind: "TRANSIENT" }).action, "RETRY");
  pb.markTask(p.id, "t1", "RUNNING"); pb.markTask(p.id, "t1", "RUNNING");
  assert.equal(pb.decideOnFailure(p.id, "t1", { kind: "TRANSIENT" }, { fallback: true }).action, "USE_FALLBACK");
  assert.equal(pb.decideOnFailure(p.id, "t1", { kind: "AGENT_FAILURE" }, { agents: ["A2"] }).action, "CHANGE_AGENT");
  assert.equal(pb.decideOnFailure(p.id, "t1", { kind: "MODEL_FAILURE" }, { models: ["m"] }).action, "CHANGE_MODEL");
  assert.equal(pb.decideOnFailure(p.id, "t1", { kind: "TOOL_FAILURE" }, { tools: ["t"] }).action, "CHANGE_TOOL");
  assert.equal(pb.decideOnFailure(p.id, "t1", { kind: "DEPENDENCY_FAILED" }).action, "REPLAN");
  assert.equal(pb.decideOnFailure(p.id, "t1", { kind: "APPROVAL_REQUIRED" }).action, "ASK_JOCI");
  const s = pb.decideOnFailure(p.id, "t1", { kind: "OWNER_STOP" }); assert.equal(s.action, "STOP_SAFELY"); assert.equal(s.taskStatus, "BLOCKED");
  assert.equal(pb.decideOnFailure(p.id, "t1", { kind: "WEIRD" }).action, "ESCALATE");
});
test("planning brain: replan keeps DONE work, revalidates graph; plans survive restart", () => {
  const d = tmp(), f = path.join(d, "plans.json");
  try {
    const pb = createPlanningBrain({ file: f }), p = pb.createPlan(spec());
    pb.markTask(p.id, "t1", "RUNNING"); pb.markTask(p.id, "t1", "DONE", { verification: { verdict: "ACCEPT", independent: true } });
    assert.throws(() => pb.replan(p.id, { cancel: ["t1"] }), /CANNOT_CANCEL_DONE/);
    assert.throws(() => pb.replan(p.id, { cancel: ["t2"] }), /DEPENDS_ON_CANCELLED/);          // t3 depends on t2
    const r = pb.replan(p.id, { cancel: ["t3", "t2"], add: [{ id: "t5", title: "alt", dependsOn: ["t1"] }] });
    assert.equal(r.version, 2); assert.ok(r.order.includes("t5") && !r.order.includes("t3"));
    const again = createPlanningBrain({ file: f }); assert.equal(again.progress(p.id).done, 1); assert.equal(again.get(p.id).version, 2);
  } finally { rm(d); }
});
