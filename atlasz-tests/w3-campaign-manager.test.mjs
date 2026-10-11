// W3 O502/S501/SN01 long-running campaigns over the M4 coordinator. Local only: no network, no model, no spending.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createCampaignManager } from "../atlasz-addons/campaign-manager.mjs";
import { createCoordinator } from "../atlasz-addons/agent-coordination.mjs";
import { createOwnerAuth, generateOwnerKeyPair, issueOwnerApproval } from "../atlasz-addons/owner-auth.mjs";
import { tmp, rm } from "./helpers.mjs";

const H = t => crypto.createHash("sha256").update(t).digest("hex");
const KEYS = generateOwnerKeyPair();
function mk({ withAuth = true, stop = { v: false } } = {}) {
  const d = tmp("w3-camp-"), clock = { t: Date.parse("2026-10-10T08:00:00Z") };
  const coord = createCoordinator({ dir: path.join(d, "coord"), nowFn: () => clock.t, isStopped: () => stop.v });
  const auth = withAuth ? createOwnerAuth({ publicKeyB64: KEYS.publicKeyB64, stateDir: path.join(d, "auth"), nowFn: () => clock.t }) : null;
  const cm = createCampaignManager({ dir: path.join(d, "camp"), coordinator: coord, ownerAuth: auth, nowFn: () => clock.t, isStopped: () => stop.v });
  return { d, clock, coord, auth, cm, stop, approve: (subject, action = "CAMPAIGN_START") => issueOwnerApproval({ privateKeyPem: KEYS.privateKeyPem, action, subject, now: clock.t }) };
}
const spec = (o = {}) => ({ id: "c1", goal: "Ship the crash-safe state file", budget: { tokens: 10000, timeMs: 3_600_000 }, milestones: [
  { id: "m1", title: "Build", tasks: [{ id: "build", kind: "build.statefile", owner: "EXECUTION-1", payload: { v: 1 } }] },
  { id: "m2", title: "QA", tasks: [{ id: "qa", kind: "qa.statefile", owner: "EXECUTION-2", dependsOn: ["build"] }] }], ...o });
/** run one ledger task through maker -> independent checker */
function finishTask(coord, cm, cid, tid, owner) {
  const ledgerId = cid + "." + tid, h = coord.connect(owner); assert.equal(h.start(ledgerId).ok, true);
  const res = H(tid + "-result"), c = cm.claimDone(cid, tid, h, res); assert.equal(c.status, "SUBMITTED_FOR_INDEPENDENT_CHECK"); assert.notEqual(c.verifier, owner);
  assert.equal(coord.connect(c.verifier).verify(ledgerId, { decision: "ACCEPT", resultSha256: res }).ok, true); return c.verifier;
}

test("create validation fails closed: money budget, unknown keys, bad owner/kind, cycles, secrets, unsafe files", () => {
  const { d, cm } = mk(); try {
    assert.equal(cm.create(spec({ budget: { tokens: 10, timeMs: 10, usd: 5 } })).reason, "BUDGET_MONEY_NOT_ALLOWED");
    assert.equal(cm.create(spec({ budget: { tokens: 10, timeMs: 10, maxSpend: 1 } })).reason, "BUDGET_MONEY_NOT_ALLOWED");
    assert.equal(cm.create(spec({ budget: { tokens: 10, timeMs: 10, gpus: 1 } })).reason, "BUDGET_KEY_UNKNOWN:gpus");
    assert.equal(cm.create(spec({ budget: { tokens: 10 } })).reason, "BUDGET_OUT_OF_RANGE");
    const bad = (t) => spec({ milestones: [{ id: "m1", title: "x", tasks: [t] }] });
    assert.equal(cm.create(bad({ id: "a", kind: "build.x", owner: "EXECUTION-26" })).reason, "TASK_OWNER_NOT_IN_ROSTER:a");
    assert.equal(cm.create(bad({ id: "a", kind: "build.x", owner: "AGENT-31" })).reason, "TASK_OWNER_NOT_IN_ROSTER:a");
    assert.equal(cm.create(bad({ id: "a", kind: "search.x", owner: "EXECUTION-1" })).reason, "TASK_KIND_NOT_FOR_OWNER_TEAM:a");
    assert.equal(cm.create(bad({ id: "a", kind: "pay.vendor", owner: "EXECUTION-1" })).reason, "TASK_KIND_NOT_PERMITTED:a");
    assert.equal(cm.create(spec({ milestones: [{ id: "m1", title: "x", tasks: [{ id: "a", kind: "build.x", owner: "EXECUTION-1", dependsOn: ["b"] }, { id: "b", kind: "build.y", owner: "EXECUTION-1", dependsOn: ["a"] }] }] })).reason, "PLAN_CYCLIC_PLAN_DEPENDENCY");
    assert.equal(cm.create(spec({ goal: "use key AKIA" + "ABCDEFGHIJKLMNOP" })).reason, "GOAL_INVALID_OR_CONTAINS_SECRET");
    assert.equal(cm.create(spec({ files: ["../etc/passwd"] })).reason, "FILES_INVALID"); assert.equal(cm.create(spec({ files: ["/abs/x"] })).reason, "FILES_INVALID");
    assert.equal(cm.create(spec({ id: "__proto__" })).reason, "CAMPAIGN_ID_INVALID");
    assert.deepEqual(cm.list(), []);
  } finally { rm(d); }
});

test("campaign without files starts without approval; only dependency-free tasks are dispatched to the coordinator", () => {
  const { d, cm, coord } = mk(); try {
    const c = cm.create(spec()); assert.equal(c.needsOwnerApproval, false); assert.match(c.planSha256, /^[0-9a-f]{64}$/);
    const s = cm.start("c1"); assert.equal(s.status, "ACTIVE"); assert.deepEqual(s.dispatched, ["c1.build"]);
    assert.equal(coord.ledger.get("JOCI", "c1.build").task.owner, "EXECUTION-1"); assert.equal(coord.ledger.get("JOCI", "c1.qa").ok, false);
    assert.equal(coord.summary().permanentAgents, 30);
  } finally { rm(d); }
});

test("file-touching campaign: start needs a signed owner approval bound to the plan sha256 (no key / boolean / wrong subject / wrong action denied)", () => {
  const { d, cm, approve } = mk(); try {
    const c = cm.create(spec({ files: ["atlasz-addons/x.mjs"] })); assert.equal(c.needsOwnerApproval, true); assert.equal(c.approvalAction, "CAMPAIGN_START");
    assert.equal(cm.start("c1").detail, "APPROVAL_OBJECT_REQUIRED");
    assert.equal(cm.start("c1", true).detail, "BARE_BOOLEAN_REJECTED");
    assert.equal(cm.start("c1", approve("0".repeat(64))).detail, "SUBJECT_MISMATCH");
    assert.equal(cm.start("c1", approve(c.planSha256, "CAMPAIGN_BUDGET")).detail, "ACTION_MISMATCH");
    const forged = { ...approve(c.planSha256), signature: Buffer.alloc(64).toString("base64") }; assert.equal(cm.start("c1", forged).detail, "SIGNATURE_INVALID");
    assert.equal(cm.view("c1").campaign.status, "DRAFT");
    const ok = cm.start("c1", approve(c.planSha256)); assert.equal(ok.ok, true); assert.equal(cm.view("c1").campaign.approval.subject, c.planSha256);
  } finally { rm(d); }
  const n = mk({ withAuth: false }); try { n.cm.create(spec({ touchesFiles: true })); const r = n.cm.start("c1", { anything: 1 }); assert.equal(r.reason, "OWNER_APPROVAL_REQUIRED"); assert.equal(r.detail, "OWNER_AUTH_NOT_AVAILABLE"); } finally { rm(n.d); }
});

test("approval cannot be replayed onto a changed plan: a plan edited on disk (file hash recomputed) is refused", () => {
  const { d, cm, approve, coord } = mk(); try {
    const c = cm.create(spec({ touchesFiles: true })); const a = approve(c.planSha256);
    const f = path.join(d, "camp", "campaigns.json"), w = JSON.parse(fs.readFileSync(f, "utf8")), b = JSON.parse(w.body);
    b.campaigns.c1.tasks.build.payload = { v: 1, extra: "rm -rf" }; const body = JSON.stringify(b); fs.writeFileSync(f, JSON.stringify({ sha: H(body), body }));
    const cm2 = createCampaignManager({ dir: path.join(d, "camp"), coordinator: coord, ownerAuth: createOwnerAuth({ publicKeyB64: KEYS.publicKeyB64 }) });
    assert.equal(cm2.start("c1", a).reason, "PLAN_HASH_MISMATCH");
  } finally { rm(d); }
});

test("maker-checker: claimDone only submits; milestone/campaign done only after an independent ACCEPT in the ledger", () => {
  const { d, cm, coord } = mk(); try {
    cm.create(spec()); cm.start("c1");
    const e1 = coord.connect("EXECUTION-1"); e1.start("c1.build");
    const res = H("built"); const c = cm.claimDone("c1", "build", e1, res);
    assert.equal(c.status, "SUBMITTED_FOR_INDEPENDENT_CHECK"); assert.ok(c.verifier && c.verifier !== "EXECUTION-1");
    assert.equal(cm.sync("c1").progress.tasks.find(t => t.id === "build").status, "VERIFYING");
    assert.equal(cm.markMilestoneDone("c1", "m1").reason, "MAKER_CHECKER_REQUIRED");
    assert.equal(e1.verify("c1.build", { decision: "ACCEPT", resultSha256: res }).reason, "NOT_THE_ASSIGNED_VERIFIER");      // the maker cannot check itself
    assert.equal(coord.connect(c.verifier).verify("c1.build", { decision: "ACCEPT", resultSha256: res }).ok, true);
    const s = cm.sync("c1"); assert.equal(cm.markMilestoneDone("c1", "m1").basis, "LEDGER_DONE_WITH_INDEPENDENT_VERIFIER"); assert.deepEqual(s.dispatched, ["c1.qa"]);
    finishTask(coord, cm, "c1", "qa", "EXECUTION-2");
    assert.equal(cm.sync("c1").status, "COMPLETED");
  } finally { rm(d); }
});

test("claimDone refuses a handle that is not the maker's; checker REJECT keeps the task open", () => {
  const { d, cm, coord } = mk(); try {
    cm.create(spec()); cm.start("c1"); coord.connect("EXECUTION-1").start("c1.build");
    assert.equal(cm.claimDone("c1", "build", coord.connect("EXECUTION-3"), H("x")).reason, "NOT_THE_MAKER_HANDLE");
    assert.equal(cm.claimDone("c1", "build", { id: "EXECUTION-1", complete: () => ({ ok: true }) }, H("x")).reason, "NOT_THE_MAKER_HANDLE");
    const c = cm.claimDone("c1", "build", coord.connect("EXECUTION-1"), H("x"));
    coord.connect(c.verifier).verify("c1.build", { decision: "REJECT", resultSha256: H("x") });
    assert.equal(cm.sync("c1").progress.tasks[0].status, "IN_PROGRESS"); assert.equal(cm.markMilestoneDone("c1", "m1").ok, false);
  } finally { rm(d); }
});

test("token budget: exceeding pauses the campaign; money is never tracked; raising needs a signed owner approval", () => {
  const { d, cm, approve } = mk(); try {
    cm.create(spec()); cm.start("c1");
    assert.equal(cm.recordUsage("c1", { usd: 1 }).reason, "MONEY_NOT_TRACKED_HERE"); assert.equal(cm.recordUsage("c1", { tokens: -1 }).reason, "USAGE_INVALID");
    assert.equal(cm.recordUsage("c1", { tokens: 9000 }).status, "ACTIVE"); const p = cm.recordUsage("c1", { tokens: 2000 }); assert.equal(p.status, "PAUSED_BUDGET"); assert.equal(p.paused, "TOKENS");
    assert.equal(cm.raiseBudget("c1", { tokens: 20000, timeMs: 3_600_000 }, null).reason, "OWNER_APPROVAL_REQUIRED");
    assert.equal(cm.raiseBudget("c1", { tokens: 20000, timeMs: 3_600_000 }, approve("c1:20000:3600000", "CAMPAIGN_BUDGET")).status, "ACTIVE");
  } finally { rm(d); }
});

test("time budget counts active time only; exceeding pauses", () => {
  const { d, cm, clock } = mk(); try {
    cm.create(spec({ budget: { tokens: 100, timeMs: 60_000 } })); cm.start("c1");
    clock.t += 30_000; assert.equal(cm.sync("c1").status, "ACTIVE"); clock.t += 40_000; assert.equal(cm.sync("c1").status, "PAUSED_BUDGET");
    assert.equal(cm.view("c1").campaign.pausedReason, "BUDGET_EXCEEDED:TIME");
  } finally { rm(d); }
});

test("stall detection (stall-replanner): no progress over 3 observations -> STALLED with a replan PROPOSAL only", () => {
  const { d, cm, clock } = mk(); try {
    cm.create(spec()); cm.start("c1");
    cm.sync("c1"); clock.t += 1000; cm.sync("c1"); clock.t += 1000; const s = cm.sync("c1");
    assert.equal(s.status, "STALLED"); assert.equal(s.stall.proposal.kind, "REPLAN_PROPOSAL_NOT_EXECUTED"); assert.equal(s.stall.proposal.nextAction, "GENERATE_ALTERNATIVE_PLAN"); assert.equal(s.stall.proposal.requiresMasterOrOwnerReview, true);
    assert.equal(cm.acknowledgeStall("c1").status, "ACTIVE");
  } finally { rm(d); }
});

test("resume after restart: records reload from disk, work continues, downtime not charged", () => {
  const { d, cm, clock, coord } = mk(); try {
    cm.create(spec()); cm.start("c1"); cm.checkpoint("c1", { step: "build started" });
    finishTask(coord, cm, "c1", "build", "EXECUTION-1");
    clock.t += 5 * 3_600_000;                                                  // process down for 5 hours (> time budget of 1h)
    const coord2 = createCoordinator({ dir: path.join(d, "coord"), nowFn: () => clock.t }); coord2.recover();
    const cm2 = createCampaignManager({ dir: path.join(d, "camp"), coordinator: coord2, nowFn: () => clock.t });
    assert.equal(cm2.loadedFrom(), "FILE");
    const r = cm2.resumeAll(); assert.deepEqual(r.resumed.map(x => [x.id, x.status, x.dispatched]), [["c1", "ACTIVE", ["c1.qa"]]]);
    assert.deepEqual(JSON.parse(cm2.lastCheckpoint("c1").text), { step: "build started" });
    assert.equal(cm2.auditVerify().ok, true);
  } finally { rm(d); }
});

test("a corrupt state file is set aside (never trusted, never silently overwritten)", () => {
  const { d, coord } = mk(); try {
    const dir = path.join(d, "camp"); fs.writeFileSync(path.join(dir, "campaigns.json"), "{\"sha\":\"bad\",\"body\":\"{}\"}");
    const cm = createCampaignManager({ dir, coordinator: coord }); assert.equal(cm.loadedFrom(), "CORRUPT_SET_ASIDE_STARTED_EMPTY");
    assert.ok(fs.readdirSync(dir).some(f => f.startsWith("campaigns.json.corrupt-")));
  } finally { rm(d); }
});

test("a tampered campaign audit log stops the manager from starting (fail closed)", () => {
  const { d, cm, coord } = mk(); try {
    cm.create(spec()); const f = path.join(d, "camp", "campaign-audit.jsonl"), l = fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
    const e = JSON.parse(l[0]); e.data.tasks = 99; l[0] = JSON.stringify(e); fs.writeFileSync(f, l.join("\n") + "\n");
    assert.throws(() => createCampaignManager({ dir: path.join(d, "camp"), coordinator: coord }), /AUDIT_CHAIN_TAMPERED/);
  } finally { rm(d); }
});

test("kill switch freezes every mutation; sync reports frozen", () => {
  const { d, cm, stop } = mk(); try {
    cm.create(spec()); stop.v = true;
    assert.equal(cm.start("c1").reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); assert.equal(cm.create(spec({ id: "c2" })).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    assert.equal(cm.recordUsage("c1", { tokens: 1 }).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); assert.equal(cm.sync("c1").frozen, true);
  } finally { rm(d); }
});

test("checkpoints: bounded, secret-free, hash-checked", () => {
  const { d, cm } = mk(); try {
    cm.create(spec());
    assert.equal(cm.checkpoint("c1", "token: ghp_" + "b".repeat(30)).reason, "SECRET_IN_CHECKPOINT"); assert.equal(cm.checkpoint("c1", "x".repeat(5000)).reason, "CHECKPOINT_SIZE_INVALID");
    for (let i = 0; i < 25; i++) cm.checkpoint("c1", "note " + i);
    assert.equal(cm.view("c1").campaign.checkpoints.length, 20); assert.equal(cm.lastCheckpoint("c1").text, "note 24");
  } finally { rm(d); }
});

test("daily summary: per campaign status, milestones, tokens, approvals waiting", () => {
  const { d, cm, coord } = mk(); try {
    cm.create(spec()); cm.create(spec({ id: "c2", files: ["docs/x.md"] })); cm.start("c1"); finishTask(coord, cm, "c1", "build", "EXECUTION-1"); cm.sync("c1");
    const s = cm.dailySummary("2026-10-10"); assert.equal(s.campaigns.length, 2);
    const c1 = s.campaigns.find(x => x.id === "c1"), c2 = s.campaigns.find(x => x.id === "c2");
    assert.equal(c1.milestones, "1/2"); assert.equal(c1.doneToday, 1); assert.equal(c2.awaitingOwnerApproval, true);
    assert.match(s.text, /c2 \[DRAFT\].*awaiting owner approval/); assert.equal(cm.dailySummary("10/10/2026").reason, "DAY_INVALID");
  } finally { rm(d); }
});

test("concurrency limit of the ledger is respected: extra tasks wait as PENDING and are dispatched later", () => {
  const { d, cm, coord } = mk(); try {
    const tasks = ["a", "b", "c", "e"].map(id => ({ id, kind: "build.part-" + id, owner: "EXECUTION-5" }));
    cm.create(spec({ milestones: [{ id: "m1", title: "parts", tasks }] })); const s = cm.start("c1");
    assert.equal(s.dispatched.length, 3); assert.equal(cm.view("c1").campaign.tasks.e.lastError, "AGENT_AT_CONCURRENCY_LIMIT");
    finishTask(coord, cm, "c1", "a", "EXECUTION-5"); assert.deepEqual(cm.sync("c1").dispatched, ["c1.e"]);
  } finally { rm(d); }
});

// ---- verification round: campaigns.json is not an authority ----
function forge(d, fn) { const f = path.join(d, "camp", "campaigns.json"), w = JSON.parse(fs.readFileSync(f, "utf8")), b = JSON.parse(w.body); fn(b.campaigns.c1); const body = JSON.stringify(b); fs.writeFileSync(f, JSON.stringify({ sha: H(body), body })); }
test("hand-edited campaigns.json (DRAFT -> ACTIVE, touchesFiles false) never starts file work: forced to NEEDS_APPROVAL, nothing dispatched", () => {
  const { d, cm, coord } = mk(); try {
    cm.create(spec({ touchesFiles: true })); forge(d, c => { c.status = "ACTIVE"; c.touchesFiles = false; });
    const cm2 = createCampaignManager({ dir: path.join(d, "camp"), coordinator: coord, ownerAuth: createOwnerAuth({ publicKeyB64: KEYS.publicKeyB64 }) });
    assert.equal(cm2.list()[0].status, "NEEDS_APPROVAL"); const r = cm2.resumeAll(); assert.deepEqual(r.resumed.map(x => x.dispatched ?? []).flat(), []);
    assert.equal(coord.connect("EXECUTION-1").list?.().length ?? 0, 0);
  } finally { rm(d); }
});
test("a legitimately approved file campaign survives restart; without the owner key it falls back to NEEDS_APPROVAL", () => {
  const { d, cm, coord, approve } = mk(); try {
    const c = cm.create(spec({ touchesFiles: true })); assert.equal(cm.start("c1", approve(c.planSha256)).ok, true);
    const mkAuth = () => createOwnerAuth({ publicKeyB64: KEYS.publicKeyB64 });
    assert.equal(createCampaignManager({ dir: path.join(d, "camp"), coordinator: coord, ownerAuth: mkAuth() }).list()[0].status, "ACTIVE");
    assert.equal(createCampaignManager({ dir: path.join(d, "camp"), coordinator: coord, ownerAuth: null }).list()[0].status, "NEEDS_APPROVAL");
  } finally { rm(d); }
});
test("cutting the last lines of the campaign audit log is detected (head pin)", () => {
  const { d, cm, coord } = mk(); try {
    cm.create(spec()); cm.start("c1"); const lf = path.join(d, "camp", "campaign-audit.jsonl"), lines = fs.readFileSync(lf, "utf8").split("\n").filter(Boolean);
    fs.writeFileSync(lf, lines.slice(0, -1).join("\n") + "\n");
    assert.throws(() => createCampaignManager({ dir: path.join(d, "camp"), coordinator: coord }), /AUDIT_CHAIN_TRUNCATED/);
  } finally { rm(d); }
});
