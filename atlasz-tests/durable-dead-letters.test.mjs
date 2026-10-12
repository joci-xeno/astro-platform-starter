// Batch 7A: dead letters survive restarts and crashes; retries need a signed owner approval and never run twice; damage is detected, never trusted or silently reset.
import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path";
import { createDurableDeadLetters, RETRY_ACTION, retrySubject, RECOVER_ACTION, recoverSubject } from "../atlasz-addons/durable-dead-letters.mjs";
import { sign, ownerAuth } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";
const mk = (d, o = {}) => createDurableDeadLetters({ dir: d, ownerAuth, ...o });
const FAKE = "sk-ant-" + "SYNTHETIC".repeat(5) + "abcdefgh12345678";

test("a dead letter survives a restart with identity, reason and timestamps; secrets are redacted before they are written", () => {
  const d = tmp("dl-"); try {
    const a = mk(d), r = a.deadLetter({ item: { id: "task-42", note: "key " + FAKE }, error: new Error("boom " + FAKE), attempts: 3, traceId: "tr-1" });
    assert.equal(r.taskId, "task-42"); assert.equal(r.status, "OPEN"); assert.ok(r.createdAt);
    const b = mk(d), got = b.get(r.id); assert.equal(got.taskId, "task-42"); assert.equal(got.attempts, 3); assert.match(got.error, /^boom/); assert.equal(got.traceId, "tr-1");
    assert.equal(fs.readFileSync(path.join(d, "dead-letters.jsonl"), "utf8").includes("SYNTHETICSYNTHETIC"), false);
    assert.equal(b.verify().ok, true); assert.equal(b.status().durable, true);
  } finally { rm(d); }
});
test("the same task failing again is ONE record (occurrence counter), also across a restart: no duplicate record to retry twice", () => {
  const d = tmp("dl-"); try {
    const a = mk(d); const r1 = a.deadLetter({ item: { id: "T" }, error: "e1", attempts: 1 }); const r2 = mk(d).deadLetter({ item: { id: "T" }, error: "e2", attempts: 3 });
    assert.equal(r2.id, r1.id); assert.equal(r2.occurrences, 2); assert.equal(r2.lastError, "e2"); assert.equal(mk(d).list("OPEN").length, 1);
  } finally { rm(d); }
});
test("invalid input and oversized items are refused; nothing is written", () => {
  const d = tmp("dl-"); try { const a = mk(d);
    assert.throws(() => a.deadLetter({ item: 1, attempts: -1 }), /INVALID_DEAD_LETTER_ATTEMPTS/); assert.throws(() => a.deadLetter({ item: 1, attempts: 1.5 }), /INVALID/);
    assert.throws(() => a.deadLetter({ item: Object.fromEntries(Array.from({ length: 60 }, (_, i) => ["k" + i, "y".repeat(1900)])), attempts: 1 }), /DEAD_LETTER_ITEM_TOO_LARGE/); assert.equal(a.list(null).length, 0);
    assert.throws(() => a.resolve("nope"), /NOT_FOUND/);
  } finally { rm(d); }
});
test("retry: no approval / forged / wrong-subject / wrong-action approvals are refused; a valid one authorises exactly one run; success resolves, failure reopens", async () => {
  const d = tmp("dl-"); try {
    const a = mk(d), r = a.deadLetter({ item: { id: "T1" }, error: "x", attempts: 3 }); let runs = 0; const runner = async () => { runs++; return { ok: true }; };
    assert.equal((await a.retry(r.id, runner)).ok, false, "not authorised"); assert.equal(runs, 0);
    for (const bad of [null, {}, sign(RETRY_ACTION, retrySubject("other")), sign("DELIVER", retrySubject(r.id))]) assert.equal(a.authorizeRetry(r.id, { ownerApproval: bad }).ok, false);
    const ap = sign(RETRY_ACTION, retrySubject(r.id)); assert.equal(a.authorizeRetry(r.id, { ownerApproval: ap }).ok, true);
    assert.equal(a.authorizeRetry(r.id, { ownerApproval: ap }).ok, false, "approval is single use / already authorised");
    const out = await a.retry(r.id, runner); assert.deepEqual([out.ok, out.status], [true, "RESOLVED"]); assert.equal(runs, 1);
    assert.equal((await a.retry(r.id, runner)).ok, false); assert.equal(runs, 1, "a resolved record never runs again");
    const f = a.deadLetter({ item: { id: "T2" }, error: "x", attempts: 3 }); a.authorizeRetry(f.id, { ownerApproval: sign(RETRY_ACTION, retrySubject(f.id)) });
    const bad = await a.retry(f.id, async () => ({ ok: false, error: "still broken " + FAKE })); assert.equal(bad.ok, false); assert.equal(a.get(f.id).status, "OPEN"); assert.equal(JSON.stringify(a.get(f.id)).includes("SYNTHETICSYNTHETIC"), false);
    assert.equal((await a.retry(f.id, runner)).ok, false, "a failed retry needs a NEW authorisation");
  } finally { rm(d); }
});
test("a crash during a retry: after restart the record is OPEN again, flagged as interrupted, and is NOT re-run automatically", async () => {
  const d = tmp("dl-"); try {
    const a = mk(d), r = a.deadLetter({ item: { id: "T3" }, error: "x", attempts: 3 }); a.authorizeRetry(r.id, { ownerApproval: sign(RETRY_ACTION, retrySubject(r.id)) });
    let started = false; const hang = a.retry(r.id, () => new Promise(() => { started = true; })); await new Promise(res => setTimeout(res, 20)); assert.ok(started); assert.equal(a.get(r.id).status, "RETRYING");
    assert.throws(() => a.resolve(r.id, "x"), /RETRY_IN_FLIGHT/);
    void hang;      // the process "dies" here: a new store instance is the restarted process
    const b = mk(d), got = b.get(r.id); assert.equal(got.status, "OPEN"); assert.equal(got.interruptedRetry, true); assert.ok(got.history.some(h => h.event === "RETRY_INTERRUPTED"));
    assert.equal((await b.retry(r.id, async () => ({ ok: true }))).ok, false, "interrupted retry is never auto-run");
    assert.equal(b.verify().ok, true);
  } finally { rm(d); }
});
test("an authorisation that was granted but not yet used survives a restart (the owner is not asked twice)", async () => {
  const d = tmp("dl-"); try { const a = mk(d), r = a.deadLetter({ item: { id: "T4" }, error: "x", attempts: 3 }); a.authorizeRetry(r.id, { ownerApproval: sign(RETRY_ACTION, retrySubject(r.id)) });
    assert.equal(mk(d).get(r.id).status, "RETRY_AUTHORIZED"); assert.equal((await mk(d).retry(r.id, async () => ({ ok: true }))).ok, true); } finally { rm(d); }
});
test("resolve is audited and cannot be done for unknown ids; resolved records leave the OPEN list but stay in the history", () => {
  const d = tmp("dl-"); try { const a = mk(d), r = a.deadLetter({ item: { id: "T5" }, error: "x", attempts: 3 }); a.resolve(r.id, "fixed by hand");
    assert.equal(a.list("OPEN").length, 0); assert.equal(mk(d).get(r.id).resolution, "fixed by hand"); assert.ok(a.auditEntries().some(e => e.event === "DL_RESOLVED"));
    const again = a.deadLetter({ item: { id: "T5" }, error: "new failure", attempts: 1 }); assert.notEqual(again.id, r.id, "a RESOLVED task that fails again is a new record"); } finally { rm(d); }
});
test("tampered chain (edited line) -> store CORRUPT, fail closed; new failures are NOT lost (overflow file); only a signed owner approval archives the damage and restores the overflow", () => {
  const d = tmp("dl-"); try {
    const a = mk(d), r = a.deadLetter({ item: { id: "T6" }, error: "x", attempts: 3 }); const f = path.join(d, "dead-letters.jsonl");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"attempts":3', '"attempts":0'));
    const alerts = []; const b = mk(d, { alert: x => alerts.push(x) }); assert.equal(b.status().state, "CORRUPT"); assert.equal(b.verify().ok, false); assert.ok(alerts.length >= 1);
    const o = b.deadLetter({ item: { id: "T7" }, error: "while corrupt", attempts: 2 }); assert.equal(o.storedIn, "OVERFLOW_STORE_CORRUPT"); assert.ok(fs.readFileSync(path.join(d, "dead-letters-overflow.jsonl"), "utf8").includes("T7"));
    assert.throws(() => b.resolve(r.id, "x"), /CORRUPT/); assert.equal(b.authorizeRetry(r.id, { ownerApproval: sign(RETRY_ACTION, retrySubject(r.id)) }).reason, "DEAD_LETTER_STORE_CORRUPT");
    for (const bad of [null, sign(RECOVER_ACTION, "x"), sign("DELIVER", recoverSubject)]) assert.equal(b.recoverStore({ ownerApproval: bad }).ok, false);
    assert.equal(b.status().state, "CORRUPT");
    const rec = b.recoverStore({ ownerApproval: sign(RECOVER_ACTION, recoverSubject) }); assert.equal(rec.ok, true); assert.equal(rec.restoredFromOverflow, 1);
    assert.ok(fs.existsSync(path.join(rec.archivedTo, "dead-letters.jsonl")), "the damaged chain is archived, not deleted");
    assert.equal(b.status().state, "OK"); assert.equal(b.list("OPEN").some(x => x.taskId === "T7"), true); assert.equal(b.verify().ok, true); assert.equal(mk(d).list("OPEN").some(x => x.taskId === "T7"), true);
  } finally { rm(d); }
});
test("truncation (deleted tail) is detected through the head pin; a torn final line from a crash is healed without losing earlier records", () => {
  const d = tmp("dl-"); try {
    const a = mk(d); a.deadLetter({ item: { id: "A" }, error: "x", attempts: 1 }); a.deadLetter({ item: { id: "B" }, error: "x", attempts: 1 });
    const f = path.join(d, "dead-letters.jsonl"), lines = fs.readFileSync(f, "utf8").trim().split("\n"); fs.writeFileSync(f, lines.slice(0, 1).join("\n") + "\n");
    assert.equal(mk(d).status().state, "CORRUPT", "removing a record is detected");
  } finally { rm(d); }
  const e = tmp("dl-"); try { const a = mk(e); a.deadLetter({ item: { id: "A" }, error: "x", attempts: 1 }); fs.appendFileSync(path.join(e, "dead-letters.jsonl"), '{"seq":2,"at":"torn'); const b = mk(e); assert.equal(b.status().state, "OK"); assert.equal(b.list("OPEN").length, 1); b.deadLetter({ item: { id: "C" }, error: "x", attempts: 1 }); assert.equal(mk(e).list("OPEN").length, 2); } finally { rm(e); }
});
test("runtime start script launches the approved canonical runtime, not the quarantined supervisor.js; the three legacy files stay on disk and unreferenced", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../atlasz-runtime/package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.start, "node supervisor-safe.mjs"); assert.equal(pkg.scripts.start, pkg.scripts["start:canonical"]);
  for (const f of ["supervisor.js", "worker.js", "agent-child.js"]) assert.ok(fs.existsSync(new URL("../atlasz-runtime/" + f, import.meta.url)), f + " is preserved");
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /supervisor\.js|worker\.js|agent-child\.js/);
});
