// Direct tests for modules the Unified Master Gap Register flagged as having no test that references them by name.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createAuditChain, verifyChain, readAuditFile, GENESIS } from "../atlasz-addons/audit-chain.mjs";
import { priorityScore, rankNextActions, chooseNextAction } from "../atlasz-addons/money-supervisor.mjs";
import { createClaimTracker, DISTINCTIONS } from "../atlasz-addons/owner-control/claim-distinctions.mjs";
import { createModuleIsolation, SAFE_MODE_ALLOWED, safeModeBanner } from "../atlasz-addons/owner-control/safe-mode-scope.mjs";
import { buildProposal, validateProposal, approveProposal } from "../atlasz-addons/proposal-quote-engine.mjs";
import { createToolBridge } from "../atlasz-addons/tool-bridge.mjs";
import { sign } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

test("audit chain: append-only hash chain; any edit, reorder, deletion or corrupt middle line is detected; torn last line tolerated; tamper at load fails closed", () => {
  const d = tmp("ac-"); try {
    const f = path.join(d, "a.jsonl"), c = createAuditChain({ filePath: f }); c.append("A", { x: 1 }); c.append("B", { y: 2 }); c.append("C", {});
    assert.equal(c.verify().ok, true); assert.equal(c.length(), 3); assert.equal(c.entries()[0].prevHash, GENESIS); assert.equal(c.verifyFile().ok, true);
    assert.throws(() => c.append(""), /AUDIT_EVENT_REQUIRED/);
    const lines = fs.readFileSync(f, "utf8").trim().split("\n").map(JSON.parse);
    const edited = structuredClone(lines); edited[1].data.y = 3; assert.equal(verifyChain(edited).reason, "ENTRY_HASH_MISMATCH");
    assert.equal(verifyChain([lines[1], lines[0], lines[2]]).reason, "SEQUENCE_GAP_OR_REORDER");
    assert.equal(verifyChain([lines[0], lines[2]]).ok, false);                                       // deleted entry
    const relinked = structuredClone(lines); relinked[1].prevHash = "f".repeat(64); assert.equal(verifyChain(relinked).reason, "PREV_HASH_MISMATCH");
    const e = c.entries(); e[0].data.x = 99; assert.equal(c.verify().ok, true);                      // entries() returns copies: callers cannot mutate the chain
    fs.appendFileSync(f, '{"seq":4,"torn'); assert.equal(readAuditFile(f).length, 3);                // torn final line (crash mid-append) tolerated
    assert.equal(createAuditChain({ filePath: f }).length(), 3);
    const raw = fs.readFileSync(f, "utf8").split("\n"); raw[1] = raw[1].replace('"y":2', '"y":9'); fs.writeFileSync(f, raw.join("\n"));
    assert.throws(() => createAuditChain({ filePath: f }), /AUDIT_CHAIN_TAMPERED:ENTRY_HASH_MISMATCH@2/);
    raw[1] = "{garbage"; fs.writeFileSync(f, raw.join("\n")); assert.throws(() => readAuditFile(f), /AUDIT_FILE_CORRUPT_AT_LINE_2/);
  } finally { rm(d); }
});

test("money priority: value x probability / time-to-cash minus friction; recurring value counts; blocked/paid/lost never chosen; invalid numbers refused", () => {
  assert.equal(priorityScore({ netValueUsd: 1000, winProbability: 0.5, hoursToCash: 10 }), 50);
  assert.ok(priorityScore({ netValueUsd: 1000, winProbability: 0.5, hoursToCash: 10, recurringMonthlyUsd: 100 }) > 50);
  assert.equal(priorityScore({ netValueUsd: 1000, winProbability: 5, hoursToCash: 1 }), 1000);       // probability clamped to 1
  assert.equal(priorityScore({ netValueUsd: 100, winProbability: 1, hoursToCash: 0 }), 100);          // hours floor of 1, no divide-by-zero
  assert.equal(priorityScore({ netValueUsd: 100, winProbability: 1, hoursToCash: 1, frictionPenalty: 30 }), 70);
  for (const bad of [{ netValueUsd: -1 }, { winProbability: -0.1 }, { netValueUsd: NaN }, { frictionPenalty: "x" }]) assert.throws(() => priorityScore(bad), /INVALID_/);
  const items = [{ id: "a", netValueUsd: 100, winProbability: 1, hoursToCash: 10 }, { id: "b", netValueUsd: 1000, winProbability: 1, hoursToCash: 10, status: "BLOCKED" }, { id: "c", netValueUsd: 500, winProbability: 1, hoursToCash: 10, status: "PAID" }, { id: "d", netValueUsd: 50, winProbability: 1, hoursToCash: 1 }];
  assert.deepEqual(rankNextActions(items).map(x => x.id), ["b", "c", "d", "a"]); assert.equal(chooseNextAction(items).id, "d"); assert.equal(chooseNextAction([{ status: "LOST", netValueUsd: 1 }]), null); assert.equal(chooseNextAction([]), null);
});

test("claim distinctions: a weak state advances only on an INDEPENDENT ACCEPT; no verifier, non-independent accept or reject keep it weak; unknown states refused", () => {
  const acc = (o = {}) => ({ verify: () => ({ verdict: "ACCEPT", independent: true, reason: "evidence ok", ...o }) });
  assert.equal(DISTINCTIONS.length, 9); for (const [w, s] of [["INVOICE", "PAID"], ["QUEUED", "SENT"], ["DRAFT", "SENT"], ["CONNECTED", "LIVE"], ["SIMULATION", "LIVE"], ["CUSTOMER_SAYS_PAID", "VERIFIED_PAYMENT"]]) assert.ok(DISTINCTIONS.some(d => d.weak === w && d.strong === s));
  const t0 = createClaimTracker(); t0.set("i1", "INVOICE"); const none = t0.advance("i1", { claim: { paid: true } }); assert.equal(none.advanced, false); assert.equal(none.reason, "NO_VERIFIER_NOT_VERIFIED"); assert.equal(t0.get("i1").state, "INVOICE");
  const t1 = createClaimTracker({ verifier: acc({ independent: false }) }); t1.set("i1", "INVOICE"); assert.equal(t1.advance("i1").advanced, false); assert.equal(t1.get("i1").state, "INVOICE");
  const t2 = createClaimTracker({ verifier: acc({ verdict: "REJECT", reason: "no receipt" }) }); t2.set("m", "QUEUED"); assert.equal(t2.advance("m").advanced, false); assert.equal(t2.get("m").state, "QUEUED");
  const t3 = createClaimTracker({ verifier: acc() }); t3.set("i1", "INVOICE"); const ok = t3.advance("i1"); assert.equal(ok.advanced, true); assert.equal(t3.get("i1").state, "PAID"); assert.equal(t3.get("i1").history.at(-1).verified, true);
  assert.equal(t3.advance("i1").reason, "ALREADY_AT_STRONG_OR_UNKNOWN_STATE");                         // no double-advance
  assert.throws(() => t3.set("x", "PAID"), /UNKNOWN_WEAK_STATE/); assert.throws(() => t3.advance("nope"), /UNKNOWN_ITEM/);
});

test("module isolation: isolated modules and the workflows they stop are blocked until released; the Safe Mode allow-list is read-only/recovery only; the banner never says normal while degraded", () => {
  const iso = createModuleIsolation(); assert.equal(iso.check({ moduleId: "m1" }).blocked, false);
  assert.deepEqual(iso.isolate("m1", { reason: "CRASH_LOOP", workflows: ["w1", "w2"], diagnostics: { n: 3 } }), { isolated: true, workflowsStopped: ["w1", "w2"] });
  assert.match(iso.check({ moduleId: "m1" }).reason, /MODULE_ISOLATED:m1/); assert.match(iso.check({ workflowId: "w2" }).reason, /WORKFLOW_STOPPED:w2/); assert.equal(iso.check({ moduleId: "m2", workflowId: "w9" }).blocked, false);
  assert.equal(iso.list().modules[0].diagnostics.n, 3); iso.release("m1"); assert.equal(iso.check({ moduleId: "m1" }).blocked, false); assert.equal(iso.check({ workflowId: "w1" }).blocked, false);
  for (const a of ["SEND_EXTERNAL", "SPEND", "DEPLOY", "EXIT_SAFE_MODE", "RESTORE"]) assert.equal(SAFE_MODE_ALLOWED.includes(a), false, a);
  assert.ok(Object.isFrozen(SAFE_MODE_ALLOWED)); assert.equal(safeModeBanner({ mode: "SAFE_MODE", reason: "r" }).normal, false); assert.match(safeModeBanner({ mode: "SAFE_MODE" }).banner, /SAFE MODE ACTIVE/);
  assert.equal(safeModeBanner({ mode: "NORMAL" }).normal, true); assert.equal(safeModeBanner(undefined).normal, false); assert.equal(safeModeBanner({ mode: "WEIRD" }).normal, false);   // unknown never reads as normal
});

test("proposals: required fields enforced, validation needs scope/deliverables/price/evidence, approval needs a signed owner grant and never makes it binding", () => {
  assert.throws(() => buildProposal({ dealId: "d1", scope: "s", priceUsd: 0 }), /PROPOSAL_MISSING_REQUIRED_FIELDS/); assert.throws(() => buildProposal({ scope: "s", priceUsd: 5 }), /PROPOSAL_MISSING_REQUIRED_FIELDS/);
  assert.throws(() => buildProposal({ dealId: "d1", scope: "s", priceUsd: 5, deliverables: "x" }), /PROPOSAL_ARRAY_FIELDS_REQUIRED/); assert.throws(() => buildProposal({ dealId: "d1", scope: "s", priceUsd: 5, deadline: "soon" }), /INVALID_PROPOSAL_DEADLINE/);
  const thin = buildProposal({ dealId: "d1", scope: "Build a site", priceUsd: 500 }); assert.equal(thin.status, "DRAFT"); assert.equal(thin.binding, false);
  assert.deepEqual(validateProposal(thin).errors, ["MISSING_DELIVERABLES", "NO_SOURCE_EVIDENCE"]);
  const full = buildProposal({ dealId: "d1", scope: "Build a site", priceUsd: 500, deliverables: ["site"], evidence: [{ source: "listing", reference: "u" }] }); assert.equal(validateProposal(full).passed, true);
  assert.throws(() => approveProposal(full), /OWNER_APPROVAL_REQUIRED/); assert.throws(() => approveProposal(full, { ownerApproved: true }), /OWNER_APPROVAL_REQUIRED/);   // a bare boolean is not an approval
  assert.throws(() => approveProposal(thin, { ownerApproved: sign("APPROVE_PROPOSAL") }), /PROPOSAL_VALIDATION_FAILED/);
  const ok = approveProposal(full, { ownerApproved: sign("APPROVE_PROPOSAL") }); assert.equal(ok.status, "APPROVED_TO_SEND"); assert.equal(ok.binding, false);
});

test("tool bridge: one real adapter is registered in all three registries; an untested adapter is never available/LIVE; missing pieces are refused", () => {
  const seen = { c: null, f: null, t: null };
  const bridge = createToolBridge({ registerConnector: x => (seen.c = x, { status: x.status }), connectFabricTool: x => (seen.f = x, { state: x.tested ? "LIVE" : "CONNECTED_UNTESTED" }), registerTool: x => (seen.t = x, { available: x.available }) });
  const adapter = { run() {} };
  const untested = bridge.attach({ id: "t1", category: "FILES", capabilities: ["read-file"], adapter }); assert.equal(untested.live, false); assert.equal(untested.executorAvailable, false); assert.equal(seen.c.status, "UNTESTED"); assert.equal(seen.t.available, false);
  const bare = bridge.attach({ id: "t2", category: "FILES", adapter, tested: true }); assert.equal(bare.live, false);                  // a bare tested:true flag is not probe evidence
  const live = bridge.attach({ id: "t3", category: "FILES", adapter, tested: true, probeEvidence: { probeId: "p", outcome: "PASS", at: new Date().toISOString(), target: "t3" } }); assert.equal(live.live, true); assert.equal(live.executorAvailable, true);
  assert.throws(() => bridge.attach({ id: "t4", category: "FILES" }), /REAL_TOOL_ADAPTER_REQUIRED/); assert.throws(() => bridge.attach({ category: "FILES", adapter }), /REAL_TOOL_ADAPTER_REQUIRED/);
  assert.throws(() => createToolBridge({}), /TOOL_BRIDGE_REGISTRIES_REQUIRED/);
});
