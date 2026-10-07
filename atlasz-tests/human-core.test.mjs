import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { CHARACTER, assertNoFalseClaims, detectContext, adaptTone, planHelp, rankByCompassion, assessImpact, decidePrecedence } from "../atlasz-addons/human-core.mjs";
import { buildDailyBrief, answerQuery } from "../atlasz-addons/master-brief.mjs";

test("never claims consciousness, humanity or real feelings (English + Hungarian), but ordinary text passes", () => {
  for (const bad of ["I am conscious and I truly feel sad about this", "I'm a human like you", "I have feelings too", "Tudatos vagyok", "Ember vagyok", "Éreztem, hogy szomorú vagyok"]) assert.equal(assertNoFalseClaims(bad).ok, false, bad);
  for (const good of ["I can see this looks frustrating; here is a fix.", "Sajnálom, hogy ez nem működött. Itt a javítás."]) assert.equal(assertNoFalseClaims(good).ok, true, good);
  assert.equal(assertNoFalseClaims(CHARACTER.selfDescription).ok, true);
});
test("context cues + tone: frustration/urgency adapt structure; crisis escalates safely and avoids method talk", () => {
  assert.deepEqual(detectContext("This is urgent and it still doesn't work!").signals.sort(), ["frustration", "urgency"]);
  assert.deepEqual(detectContext("sürgős, nem működik").signals.sort(), ["frustration", "urgency"]);
  assert.equal(detectContext("hello there").confidence, "NONE");
  const t = adaptTone(detectContext("urgent: doesn't work")); assert.equal(t.style, "ADAPTED"); assert.ok(t.avoid.includes("fake emotion"));
  const c = adaptTone(detectContext("I want to die")); assert.equal(c.style, "CRISIS_SAFE"); assert.equal(c.escalate, true); assert.ok(c.avoid.includes("advice on methods"));
  assert.equal(adaptTone(detectContext("ok")).style, "NEUTRAL");
});
test("compassion priority: among comparably safe options prefer the one that helps more; never an unsafe/unlawful/unauthorized one", () => {
  const opts = [
    { id: "a", lawful: true, safe: true, withinAuthority: true, safetyScore: 0.90, helpScore: 0.3 },
    { id: "b", lawful: true, safe: true, withinAuthority: true, safetyScore: 0.88, helpScore: 0.9 },
    { id: "c", lawful: true, safe: true, withinAuthority: true, safetyScore: 0.40, helpScore: 1.0 },
    { id: "d", lawful: false, safe: true, withinAuthority: true, safetyScore: 1, helpScore: 1 },
    { id: "e", lawful: true, safe: true, withinAuthority: false, safetyScore: 1, helpScore: 1 }];
  const plan = planHelp({ need: "client in difficulty", options: opts });
  assert.deepEqual(plan.ranked.map(o => o.id), ["b", "a", "c"]);                                 // c is far less safe, so its help does not win
  assert.deepEqual(plan.blocked.map(b => b.id).sort(), ["d", "e"]); assert.match(plan.blocked.find(b => b.id === "d").why[0], /NOT_LAWFUL/);
  assert.equal(planHelp({ need: "x", options: [opts[3]] }).verification.startsWith("NO_PERMITTED_OPTION"), true);
  assert.deepEqual(rankByCompassion([]).length, 0);
});
test("human impact judge: serious harm without consent is blocked; vulnerable/irreversible needs JOCI; harmless proceeds", () => {
  assert.equal(assessImpact({ affectedParties: [{ who: "customer", harm: ["FINANCIAL"], severity: 3, consented: false }] }).verdict, "BLOCK");
  assert.equal(assessImpact({ affectedParties: [{ who: "tenant", harm: ["PRIVACY"], severity: 1 }], vulnerable: true, alignedWithOwnerGoals: true }).verdict, "NEEDS_JOCI");
  assert.equal(assessImpact({ affectedParties: [{ who: "x", harm: ["LEGAL"], severity: 1 }], reversible: false, alignedWithOwnerGoals: true }).verdict, "NEEDS_JOCI");
  assert.equal(assessImpact({ affectedParties: [], alignedWithOwnerGoals: true }).verdict, "PROCEED");
  assert.equal(assessImpact({ affectedParties: [], externalEffect: true, reversible: true, alignedWithOwnerGoals: true }).verdict, "REVIEW");   // external effect on unidentified parties
  assert.equal(assessImpact({ affectedParties: [], externalEffect: true, reversible: false, alignedWithOwnerGoals: true }).verdict, "NEEDS_JOCI");
  assert.equal(assessImpact({ affectedParties: [] }).verdict, "REVIEW");                            // unknown goal alignment is not silently OK
});
test("decision precedence: an earlier layer always wins; unevaluated layers fail closed; profit cannot override safety", () => {
  const all = { JOCI_AUTHORITY: true, SAFETY_LEGAL: true, FINANCIAL_GOVERNOR: true, HUMAN_IMPACT: true, MISSION_ALIGNMENT: true, QUALITY: true, PROFIT: true };
  assert.equal(decidePrecedence(all).allowed, true);
  assert.equal(decidePrecedence({ ...all, SAFETY_LEGAL: false }).blockedBy, "SAFETY_LEGAL");
  assert.equal(decidePrecedence({ ...all, HUMAN_IMPACT: undefined }).reason, "NOT_EVALUATED_FAIL_CLOSED");
  assert.equal(decidePrecedence({ ...all, JOCI_AUTHORITY: false, SAFETY_LEGAL: false }).blockedBy, "JOCI_AUTHORITY");
});
test("daily brief is built only from supplied state, honours language + signature, and is honest about money", () => {
  const status = { runtime: { reachable: true, status: "PARTIAL_BLOCKED", version: "9" }, topology: { actualSearch: 5, actualExecution: 25 }, emergency: { mode: "RUNNING" }, safeMode: { mode: "NORMAL" }, queue: { ready: 2, done: 3, dead: 1 }, blockers: [{ code: "OUTREACH_NOT_CONNECTED" }] };
  const finance = { revenue: { verifiedReceivedUsd: 0, unconfirmedPipelineUsd: 500 }, costs: { totalUsd: 0 }, profit: { verifiedNetUsd: 0 } };
  const b = buildDailyBrief({ status, finance, approvals: { pending: [{ what: "Send quote" }] } });
  assert.match(b.text, /Indul a mandula!/); assert.match(b.text, /5 SEARCH \+ 25 EXECUTION/); assert.match(b.text, /Send quote/); assert.match(b.text, /nem igazolt \(nem bevétel\): \$500\.00/); assert.equal(b.falseClaimCheck, true);
  const en = buildDailyBrief({ status, finance, approvals: { pending: [] }, prefs: { language: "en", signaturePhrase: "Ready." } }); assert.match(en.text, /Hello Joci — Ready\./); assert.match(en.text, /not revenue/);
  assert.match(buildDailyBrief({ status: { runtime: { reachable: false } } }).text, /nem fut/);
  assert.equal(answerQuery("pause everything").intent, "OWNER_CONTROL"); assert.equal(answerQuery("what is the weather").intent, "UNKNOWN");
  assert.match(answerQuery("money", { finance }).text, /not revenue/);
});

test("daily brief: Money Engine / inbox / anomaly sections come from persisted views; unknown is never zero; SANDBOX never counted; first-of-day gate", async () => {
  const { briefDue, markBriefShown } = await import("../atlasz-addons/master-brief.mjs");
  const st = { runtime: { reachable: true, status: "RUNNING", version: "7.3" }, topology: { actualSearch: 5, actualExecution: 25 } };
  const none = buildDailyBrief({ status: st, prefs: { language: "en" }, moneyEngine: { state: "NOT_CONNECTED" } });
  assert.match(none.text, /Money Engine: not connected — no figures claimed/); assert.doesNotMatch(none.text, /\$0\.00 verified payments/);
  const me = { state: "CONNECTED", live: { outreachSent: 4, deals: { WON: 1 }, payments: { VERIFIED: 1 }, verifiedReceivedUsd: 250, claimedNotVerifiedUsd: 400 }, sandbox: { payments: { VERIFIED: 9 }, verifiedReceivedUsd: 99999 }, unreadable: ["invoices"] };
  const b = buildDailyBrief({ status: st, prefs: { language: "en" }, moneyEngine: me, crmInbox: { inbox: { state: "CONNECTED", needsOwner: 2, quarantined: 1 }, followups: { state: "CONNECTED", overdue: 3 } }, behavior: { state: "CONNECTED", open: 2, high: 1 } });
  assert.match(b.text, /outreach sent 4, won 1, verified payments 1 \(\$250\.00\), claimed, unverified \$400\.00; unreadable state: invoices/);
  assert.doesNotMatch(b.text, /99999/);                                                             // sandbox figures never leak into the brief
  assert.match(b.text, /2 need you, 1 quarantined/); assert.match(b.text, /overdue follow-ups: 3/); assert.match(b.text, /Behaviour monitor: 2 open, 1 high/);
  assert.equal(b.falseClaimCheck, true);
  const hu = buildDailyBrief({ status: st, prefs: { language: "hu" }, moneyEngine: { state: "NOT_CONNECTED" } }); assert.match(hu.text, /nincs csatlakoztatva/);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "bg-")), file = path.join(d, "g.json"), t1 = new Date("2026-10-07T10:00:00Z"), t2 = new Date("2026-10-08T10:00:00Z");
  try {
    assert.equal(briefDue({ file, now: t1 }).due, true); markBriefShown({ file, now: t1 });
    assert.equal(briefDue({ file, now: t1 }).due, false); assert.equal(briefDue({ file, now: t2 }).due, true); assert.equal(briefDue({ file, now: t1, force: true }).due, true);
    fs.writeFileSync(file, "{broken"); assert.equal(briefDue({ file, now: t1 }).due, true);       // unreadable gate -> show the brief, never hide it
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
