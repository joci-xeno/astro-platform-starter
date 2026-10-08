import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHandoffLedger, fingerprint, LIMITS } from "../atlasz-addons/handoff-ledger.mjs";
import { tmp, rm } from "./helpers.mjs";

const S = n => "SEARCH-" + n, E = n => "EXECUTION-" + n, H = c => c.repeat(64), BAD_IDS = ["SEARCH-6", "SEARCH-0", "EXECUTION-26", "EXECUTION-0", "search-1", "SEARCH-1 ", " SEARCH-1", "OWNER", "SYSTEM", "", null, undefined, ["SEARCH-1"], { id: "SEARCH-1" }, "SEARCH-01", "EXECUTION-025"];
const mk = (o = {}) => createHandoffLedger({ ...o });
const reg = (l, id, o = {}) => l.register("t", { id, kind: "research", payload: { id }, owner: E(1), ...o });
const A = [{ name: "notes", sha256: H("a") }, { name: "data", sha256: H("b") }];

test("fingerprints are stable for key order and differ by kind or payload", () => {
  assert.equal(fingerprint("k", { a: 1, b: [1, { c: 2, d: 3 }] }), fingerprint("k", { b: [1, { d: 3, c: 2 }], a: 1 })); assert.notEqual(fingerprint("k", { a: 1 }), fingerprint("k", { a: 2 })); assert.notEqual(fingerprint("k", { a: 1 }), fingerprint("j", { a: 1 })); assert.notEqual(fingerprint("k", [1, 2]), fingerprint("k", [2, 1]));
  assert.equal(fingerprint("k", undefined), fingerprint("k", null)); assert.notEqual(fingerprint("ab", "c"), fingerprint("a", "bc"), "kind and payload are separated");
  assert.match(fingerprint("k", 1), /^[0-9a-f]{64}$/);
});

test("register: roster-only owners, ids, kinds, payload size, duplicate work, concurrency, limits", () => {
  const l = mk(); for (const o of BAD_IDS) assert.equal(reg(l, "x", { owner: o }).reason, "OWNER_NOT_IN_ROSTER", String(o));
  for (const id of ["", "-x", "a b", "../x", null, 5, "x".repeat(61)]) assert.equal(reg(l, id).reason, "TASK_ID_INVALID", String(id)); assert.equal(reg(l, "x".repeat(60)).ok, true);
  for (const kind of ["", "Research", "1x", null, "k".repeat(41)]) assert.equal(reg(l, "k1", { kind }).reason, "KIND_INVALID", String(kind));
  const big = { s: "x".repeat(LIMITS.maxPayloadChars) }; assert.equal(reg(l, "big", { payload: big }).reason, "PAYLOAD_TOO_LARGE"); const circ = {}; circ.me = circ; assert.equal(reg(l, "circ", { payload: circ }).reason, "PAYLOAD_INVALID");
  assert.equal(reg(l, "small", { payload: { s: "x".repeat(LIMITS.maxPayloadChars - 20) } }).ok, true);
  for (const deps of ["a", [5], ["a b"], Array.from({ length: LIMITS.maxDeps + 1 }, (_, i) => "d" + i)]) assert.equal(reg(l, "dd", { dependsOn: deps }).reason, "DEPENDENCIES_INVALID");
  assert.equal(reg(l, "dd", { dependsOn: ["dd"] }).reason, "DEPENDENCY_CYCLE"); assert.equal(reg(l, "dd", { dependsOn: ["ghost"] }).reason, "UNKNOWN_DEPENDENCY:ghost");
  assert.equal(reg(l, "small").reason, "TASK_ID_EXISTS"); assert.throws(() => l.register("a b", { id: "x", kind: "k", owner: E(1) }), /TENANT_INVALID/);
  // duplicate work: same kind+payload under another id/owner is refused while open or DONE, allowed after FAILED/CANCELLED
  const d = mk(); assert.equal(d.register("t", { id: "a", kind: "scan", payload: { site: "x" }, owner: S(1) }).ok, true); const dup = d.register("t", { id: "b", kind: "scan", payload: { site: "x" }, owner: S(2) }); assert.deepEqual([dup.reason, dup.existing, dup.existingStatus], ["DUPLICATE_WORK", "a", "ASSIGNED"]);
  assert.equal(d.register("t", { id: "b", kind: "scan", payload: { site: "y" }, owner: S(2) }).ok, true); assert.equal(d.register("t", { id: "c", kind: "other", payload: { site: "x" }, owner: S(2) }).ok, true); assert.equal(d.register("u", { id: "a", kind: "scan", payload: { site: "x" }, owner: S(1) }).ok, true, "another tenant");
  d.start("t", "a", { agent: S(1) }); assert.equal(d.register("t", { id: "e", kind: "scan", payload: { site: "x" }, owner: S(3) }).existingStatus, "IN_PROGRESS");
  assert.equal(d.close("t", "a", { agent: S(1), status: "FAILED" }).ok, true); assert.equal(d.register("t", { id: "retry", kind: "scan", payload: { site: "x" }, owner: S(3) }).ok, true, "a failed task can be retried"); assert.equal(d.close("t", "retry", { agent: S(3), status: "CANCELLED" }).ok, true); assert.equal(d.register("t", { id: "retry2", kind: "scan", payload: { site: "x" }, owner: S(3) }).ok, true);
  // concurrency per agent and total
  const c = mk(); for (let i = 0; i < LIMITS.perAgentOpen; i++) assert.equal(reg(c, "t" + i).ok, true); assert.equal(reg(c, "over").reason, "AGENT_AT_CONCURRENCY_LIMIT"); assert.equal(reg(c, "other", { owner: E(2) }).ok, true);
  const tot = mk({ limits: { maxOpen: 3 } }); for (let i = 0; i < 3; i++) tot.register("t", { id: "o" + i, kind: "k", payload: i, owner: E(i + 1) }); assert.equal(tot.register("t", { id: "o3", kind: "k", payload: 3, owner: E(9) }).reason, "TOO_MANY_OPEN_TASKS");
  const cap = mk({ limits: { maxTasks: 2, maxOpen: 10 } }); cap.register("t", { id: "a", kind: "k", payload: 1, owner: E(1) }); cap.register("t", { id: "b", kind: "k", payload: 2, owner: E(2) }); assert.equal(cap.register("t", { id: "c", kind: "k", payload: 3, owner: E(3) }).reason, "TOO_MANY_TASKS");
});

test("start: owner only, dependency order, state", () => {
  const l = mk(); reg(l, "a"); reg(l, "b", { owner: E(2), dependsOn: ["a"] });
  for (const o of [...BAD_IDS, E(2), S(1)]) assert.equal(l.start("t", "a", { agent: o }).reason, "NOT_THE_OWNER", String(o));
  const early = l.start("t", "b", { agent: E(2) }); assert.deepEqual([early.reason, early.waiting], ["DEPENDENCIES_NOT_DONE", ["a"]]);
  assert.equal(l.start("t", "a", { agent: E(1) }).ok, true); assert.equal(l.start("t", "a", { agent: E(1) }).reason, "BAD_STATE:IN_PROGRESS"); assert.equal(l.start("t", "ghost", { agent: E(1) }).reason, "TASK_NOT_FOUND"); assert.equal(l.start("t", "b", { agent: E(2) }).reason, "DEPENDENCIES_NOT_DONE", "in progress is not done");
  l.complete("t", "a", { agent: E(1), resultSha256: H("c") }); assert.equal(l.start("t", "b", { agent: E(2) }).reason, "DEPENDENCIES_NOT_DONE", "verifying is not done"); l.verify("t", "a", { verifier: S(1), decision: "ACCEPT", resultSha256: H("c") }); assert.equal(l.start("t", "b", { agent: E(2) }).ok, true);
  const f = mk(); reg(f, "a"); reg(f, "b", { owner: E(2), dependsOn: ["a"] }); f.start("t", "a", { agent: E(1) }); f.close("t", "a", { agent: E(1), status: "FAILED" }); assert.equal(f.start("t", "b", { agent: E(2) }).reason, "DEPENDENCIES_NOT_DONE", "a failed dependency never unblocks");
  assert.equal(l.start("nobody", "a", { agent: E(1) }).reason, "TASK_NOT_FOUND"); assert.equal(l.get("t", "__proto__").reason, "TASK_NOT_FOUND"); assert.equal(l.start("t", "constructor", { agent: E(1) }).reason, "TASK_NOT_FOUND");
});

test("handoff contract: owner-only offer, fixed artifact hashes, receiver-only accept with matching content, rejection returns ownership", () => {
  const l = mk(); reg(l, "a"); assert.equal(l.handoff("t", "a", { from: E(1), to: E(2), artifacts: A }).reason, "BAD_STATE:ASSIGNED"); l.start("t", "a", { agent: E(1) });
  for (const [from, to, why] of [[E(2), E(3), "NOT_THE_OWNER"], [E(1), E(1), "HANDOFF_TO_SELF"], ["SEARCH-6", E(2), "AGENT_NOT_IN_ROSTER"], [E(1), "EXECUTION-26", "AGENT_NOT_IN_ROSTER"], [E(1), null, "AGENT_NOT_IN_ROSTER"], [undefined, E(2), "AGENT_NOT_IN_ROSTER"]]) assert.equal(l.handoff("t", "a", { from, to, artifacts: A }).reason, why, String(from) + ">" + String(to));
  for (const art of [[], null, "x", Array.from({ length: LIMITS.maxArtifacts + 1 }, (_, i) => ({ name: "a" + i, sha256: H("a") })), [{ name: "n", sha256: "abc" }], [{ name: "n", sha256: H("A") }], [{ name: "bad name", sha256: H("a") }], [{ sha256: H("a") }], [null], [A[0], A[0]], [{ name: "n", sha256: 5 }]]) assert.equal(l.handoff("t", "a", { from: E(1), to: E(2), artifacts: art }).reason, "ARTIFACTS_INVALID", JSON.stringify(art).slice(0, 40));
  assert.equal(l.handoff("t", "a", { from: E(1), to: E(2), artifacts: A, summary: "s".repeat(LIMITS.maxSummary + 1) }).reason, "SUMMARY_INVALID"); assert.equal(l.handoff("t", "a", { from: E(1), to: E(2), artifacts: A, summary: 5 }).reason, "SUMMARY_INVALID");
  const offer = l.handoff("t", "a", { from: E(1), to: E(2), artifacts: A, summary: "ok" }); assert.equal(offer.ok, true); assert.match(offer.contract, /^[0-9a-f]{64}$/); assert.equal(l.get("t", "a").task.status, "HANDOFF_PENDING");
  assert.equal(l.handoff("t", "a", { from: E(1), to: E(3), artifacts: A }).reason, "BAD_STATE:HANDOFF_PENDING"); assert.equal(l.complete("t", "a", { agent: E(1), resultSha256: H("c") }).reason, "BAD_STATE:HANDOFF_PENDING"); assert.equal(l.close("t", "a", { agent: E(1), status: "CANCELLED" }).ok, true, "the owner can withdraw a pending handoff by closing the task"); assert.equal(l.get("t", "a").task.handoffs[0].status, "WITHDRAWN");
  const m = mk(); reg(m, "a"); m.start("t", "a", { agent: E(1) }); m.handoff("t", "a", { from: E(1), to: E(2), artifacts: A });
  for (const who of [...BAD_IDS, E(1), E(3), S(1)]) assert.equal(m.accept("t", "a", { agent: who, received: A }).reason, "NOT_THE_RECEIVER", String(who));
  const swapped = [{ name: "notes", sha256: H("a") }, { name: "data", sha256: H("c") }];
  for (const rec of [[], [A[0]], swapped, [...A, { name: "extra", sha256: H("d") }], [{ name: "notes", sha256: H("a") }, { name: "data", sha256: H("b") }, { name: "data", sha256: H("b") }], "x", null, [null, ...A], [{ name: "notes" }, A[1]]]) assert.equal(m.accept("t", "a", { agent: E(2), received: rec }).reason, "HANDOFF_CONTENT_MISMATCH", JSON.stringify(rec).slice(0, 50));
  assert.equal(m.get("t", "a").task.owner, E(1), "nothing moved on a mismatch");
  assert.deepEqual(m.accept("t", "a", { agent: E(2), received: [...A].reverse() }), { ok: true, id: "a", owner: E(2) }, "order of artifacts does not matter"); assert.equal(m.get("t", "a").task.status, "IN_PROGRESS"); assert.deepEqual(m.get("t", "a").task.owners, [E(1), E(2)]); assert.equal(m.accept("t", "a", { agent: E(2), received: A }).reason, "NO_PENDING_HANDOFF");
  assert.equal(m.start("t", "a", { agent: E(1) }).reason, "NOT_THE_OWNER", "the previous owner no longer controls the task");
  // rejection
  const r = mk(); reg(r, "a"); r.start("t", "a", { agent: E(1) }); r.handoff("t", "a", { from: E(1), to: E(2), artifacts: A }); assert.equal(r.rejectHandoff("t", "a", { agent: E(1) }).reason, "NOT_THE_RECEIVER"); assert.equal(r.rejectHandoff("t", "a", { agent: E(3) }).reason, "NOT_THE_RECEIVER");
  assert.deepEqual(r.rejectHandoff("t", "a", { agent: E(2), reason: "r".repeat(300) }), { ok: true, id: "a", owner: E(1) }); assert.equal(r.get("t", "a").task.status, "IN_PROGRESS"); assert.equal(r.get("t", "a").task.handoffs[0].status, "REJECTED"); assert.equal(r.rejectHandoff("t", "a", { agent: E(2) }).reason, "NO_PENDING_HANDOFF"); assert.ok(r.events("t").find(e => e.type === "HANDOFF_REJECTED").reason.length <= 100);
  assert.equal(r.handoff("t", "a", { from: E(1), to: E(3), artifacts: A }).handoff, 2, "handoff numbers keep counting");
  // receiver concurrency
  const c = mk(); for (let i = 0; i < LIMITS.perAgentOpen; i++) c.register("t", { id: "r" + i, kind: "k", payload: i, owner: E(2) }); reg(c, "a"); c.start("t", "a", { agent: E(1) }); assert.equal(c.handoff("t", "a", { from: E(1), to: E(2), artifacts: A }).reason, "RECEIVER_AT_CONCURRENCY_LIMIT");
  const c2 = mk(); reg(c2, "a"); c2.start("t", "a", { agent: E(1) }); assert.equal(c2.handoff("t", "a", { from: E(1), to: E(2), artifacts: A }).ok, true); for (let i = 0; i < LIMITS.perAgentOpen; i++) c2.register("t", { id: "r" + i, kind: "k", payload: i, owner: E(2) }); assert.equal(c2.accept("t", "a", { agent: E(2), received: A }).reason, "AGENT_AT_CONCURRENCY_LIMIT", "the receiver filled up after the offer");
});

test("completion needs an independent verifier and matching content; rejection returns the task; nothing is DONE otherwise", () => {
  const l = mk(); reg(l, "a"); assert.equal(l.complete("t", "a", { agent: E(1), resultSha256: H("c") }).reason, "BAD_STATE:ASSIGNED"); l.start("t", "a", { agent: E(1) });
  for (const who of [...BAD_IDS, E(2)]) assert.equal(l.complete("t", "a", { agent: who, resultSha256: H("c") }).reason, "NOT_THE_OWNER", String(who));
  for (const h of [undefined, "abc", H("C"), 5, null]) assert.equal(l.complete("t", "a", { agent: E(1), resultSha256: h }).reason, "RESULT_HASH_REQUIRED");
  assert.equal(l.verify("t", "a", { verifier: S(1), decision: "ACCEPT", resultSha256: H("c") }).reason, "BAD_STATE:IN_PROGRESS");
  assert.deepEqual(l.complete("t", "a", { agent: E(1), resultSha256: H("c") }), { ok: true, id: "a", status: "VERIFYING" });
  for (const v of BAD_IDS) assert.equal(l.verify("t", "a", { verifier: v, decision: "ACCEPT", resultSha256: H("c") }).reason, "VERIFIER_NOT_IN_ROSTER", String(v));
  assert.equal(l.verify("t", "a", { verifier: E(1), decision: "ACCEPT", resultSha256: H("c") }).reason, "VERIFIER_NOT_INDEPENDENT", "the owner cannot verify itself");
  for (const dec of ["accept", "OK", null, undefined, true]) assert.equal(l.verify("t", "a", { verifier: S(1), decision: dec, resultSha256: H("c") }).reason, "DECISION_INVALID", String(dec));
  assert.equal(l.verify("t", "a", { verifier: S(1), decision: "ACCEPT", resultSha256: H("d") }).reason, "VERIFIED_CONTENT_MISMATCH"); assert.equal(l.verify("t", "a", { verifier: S(1), decision: "ACCEPT" }).reason, "VERIFIED_CONTENT_MISMATCH");
  assert.equal(l.get("t", "a").task.status, "VERIFYING");
  assert.deepEqual(l.verify("t", "a", { verifier: S(1), decision: "REJECT", resultSha256: H("c") }), { ok: true, id: "a", status: "IN_PROGRESS" }); const t1 = l.get("t", "a").task; assert.deepEqual([t1.rejections, t1.resultHash], [1, null]);
  l.complete("t", "a", { agent: E(1), resultSha256: H("e") }); assert.deepEqual(l.verify("t", "a", { verifier: S(1), decision: "ACCEPT", resultSha256: H("e") }), { ok: true, id: "a", status: "DONE" }); assert.equal(l.verify("t", "a", { verifier: S(2), decision: "ACCEPT", resultSha256: H("e") }).reason, "BAD_STATE:DONE");
  assert.equal(l.close("t", "a", { agent: E(1), status: "FAILED" }).reason, "BAD_STATE:DONE", "a DONE task cannot be failed afterwards");
  // after a handoff, neither the original nor the new owner may verify
  const h = mk(); reg(h, "a"); h.start("t", "a", { agent: E(1) }); h.handoff("t", "a", { from: E(1), to: E(2), artifacts: A }); h.accept("t", "a", { agent: E(2), received: A }); h.complete("t", "a", { agent: E(2), resultSha256: H("c") });
  assert.equal(h.verify("t", "a", { verifier: E(1), decision: "ACCEPT", resultSha256: H("c") }).reason, "VERIFIER_NOT_INDEPENDENT", "a previous owner is not independent either"); assert.equal(h.verify("t", "a", { verifier: E(2), decision: "ACCEPT", resultSha256: H("c") }).reason, "VERIFIER_NOT_INDEPENDENT"); assert.equal(h.verify("t", "a", { verifier: E(3), decision: "ACCEPT", resultSha256: H("c") }).ok, true);
  assert.equal(l.verify("t", "ghost", { verifier: S(1), decision: "ACCEPT", resultSha256: H("c") }).reason, "TASK_NOT_FOUND");
});

test("close(): owner-only, FAILED/CANCELLED only; the kill switch freezes every mutation and a throwing check counts as stopped", () => {
  const l = mk(); reg(l, "a"); for (const who of [...BAD_IDS, E(2)]) assert.equal(l.close("t", "a", { agent: who, status: "FAILED" }).reason, "NOT_THE_OWNER"); for (const st of ["DONE", "done", null, "IN_PROGRESS"]) assert.equal(l.close("t", "a", { agent: E(1), status: st }).reason, "STATUS_INVALID"); assert.equal(l.close("t", "ghost", { agent: E(1), status: "FAILED" }).reason, "TASK_NOT_FOUND");
  assert.equal(l.close("t", "a", { agent: E(1), status: "FAILED" }).ok, true); assert.equal(l.close("t", "a", { agent: E(1), status: "FAILED" }).reason, "BAD_STATE:FAILED"); assert.equal(l.start("t", "a", { agent: E(1) }).reason, "BAD_STATE:FAILED");
  let stop = false; const s = createHandoffLedger({ isStopped: () => stop }); s.register("t", { id: "a", kind: "k", payload: 1, owner: E(1) }); s.start("t", "a", { agent: E(1) }); s.handoff("t", "a", { from: E(1), to: E(2), artifacts: A }); stop = true;
  const calls = [s.register("t", { id: "z", kind: "k", payload: 9, owner: E(1) }), s.start("t", "a", { agent: E(1) }), s.handoff("t", "a", { from: E(1), to: E(2), artifacts: A }), s.accept("t", "a", { agent: E(2), received: A }), s.rejectHandoff("t", "a", { agent: E(2) }), s.complete("t", "a", { agent: E(1), resultSha256: H("c") }), s.verify("t", "a", { verifier: S(1), decision: "ACCEPT", resultSha256: H("c") }), s.close("t", "a", { agent: E(1), status: "FAILED" })];
  for (const c of calls) assert.equal(c.reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); assert.equal(s.get("t", "a").task.status, "HANDOFF_PENDING", "nothing changed while stopped"); assert.equal(s.list("t").length, 1, "reads still work");
  stop = false; assert.equal(s.accept("t", "a", { agent: E(2), received: A }).ok, true);
  const th = createHandoffLedger({ isStopped: () => { throw new Error("x"); } }); assert.equal(th.register("t", { id: "a", kind: "k", payload: 1, owner: E(1) }).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); assert.equal(createHandoffLedger({ isStopped: () => "yes" }).register("t", { id: "a", kind: "k", payload: 1, owner: E(1) }).ok, false);
});

test("views: list/filter, event log order and bounds, load figures, tenant isolation", () => {
  const l = mk({ limits: { maxEvents: 5 } }); for (let i = 0; i < 4; i++) l.register("t", { id: "k" + i, kind: "k", payload: i, owner: i < 2 ? E(1) : E(2) }); l.register("u", { id: "other", kind: "k", payload: 0, owner: E(1) });
  l.start("t", "k0", { agent: E(1) }); assert.deepEqual(l.list("t", { status: "IN_PROGRESS" }).map(x => x.id), ["k0"]); assert.equal(l.list("t").length, 4); assert.equal(l.list("u").length, 1); assert.equal(l.list("nobody").length, 0); assert.equal(l.list("a b").length, 0);
  const evs = l.events("t"); assert.equal(evs.length, 5, "event log is bounded"); assert.ok(evs.every((e, i) => i === 0 || e.n === evs[i - 1].n + 1), "ordered and consecutive"); assert.equal(evs.at(-1).type, "STARTED"); assert.equal(l.events("t", 2).length, 2); assert.equal(l.events("t", 0).length, 1); assert.equal(l.events("t", -3).length, 1); assert.equal(l.events("t", 1e9).length, 5); assert.equal(l.events("t", "x").length, 5);
  assert.deepEqual(l.load("t"), { ok: true, open: 4, perAgent: { "EXECUTION-1": 2, "EXECUTION-2": 2 }, limits: { perAgentOpen: 3, maxOpen: 200 } }); assert.equal(l.get("u", "k0").reason, "TASK_NOT_FOUND"); const g = l.get("t", "k0").task; g.owner = "X"; assert.equal(l.get("t", "k0").task.owner, E(1), "reads are copies");
});

test("durability: ledger survives a restart with a private file; a corrupt file fails closed", () => {
  const dir = tmp("hl-"), file = path.join(dir, "l.json");
  try {
    const a = mk({ file }); reg(a, "a"); a.start("t", "a", { agent: E(1) }); a.handoff("t", "a", { from: E(1), to: E(2), artifacts: A });
    const b = mk({ file }); assert.equal(b.get("t", "a").task.status, "HANDOFF_PENDING"); assert.equal(b.accept("t", "a", { agent: E(2), received: A }).ok, true); assert.equal(mk({ file }).get("t", "a").task.owner, E(2)); assert.equal(reg(mk({ file }), "dup", { payload: { id: "a" } }).reason, "DUPLICATE_WORK", "duplicate detection survives a restart");
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o077, 0);
    fs.writeFileSync(file + ".bad", "{x"); assert.throws(() => createHandoffLedger({ file: file + ".bad" }), /STORE_UNREADABLE/);
  } finally { rm(dir); }
});

test("exact limit boundaries are accepted and one over is refused", () => {
  const l = mk(); const pl = n => ({ s: "x".repeat(n) });   // canonical form {"s":"xxx"} is n + 8 characters
  assert.equal(reg(l, "p1", { payload: pl(LIMITS.maxPayloadChars - 8) }).ok, true); assert.equal(reg(l, "p2", { payload: pl(LIMITS.maxPayloadChars - 7) }).reason, "PAYLOAD_TOO_LARGE");
  const deps = n => Array.from({ length: n }, (_, i) => "dep" + i);
  assert.equal(reg(l, "d1", { dependsOn: deps(LIMITS.maxDeps) }).reason, "UNKNOWN_DEPENDENCY:dep0", "ten dependencies pass the shape check");
  assert.equal(reg(l, "d2", { dependsOn: deps(LIMITS.maxDeps + 1) }).reason, "DEPENDENCIES_INVALID");
  assert.equal(reg(l, "d3", { dependsOn: [] }).ok, true, "an empty dependency list is valid");
  const m = mk(); reg(m, "h", { owner: E(1) }); m.start("t", "h", { agent: E(1) });
  const arts = n => Array.from({ length: n }, (_, i) => ({ name: "a" + i, sha256: H("c") }));
  assert.equal(m.handoff("t", "h", { from: E(1), to: E(2), artifacts: arts(LIMITS.maxArtifacts + 1), summary: "s" }).reason, "ARTIFACTS_INVALID");
  assert.equal(m.handoff("t", "h", { from: E(1), to: E(2), artifacts: arts(1), summary: "x".repeat(LIMITS.maxSummary + 1) }).reason, "SUMMARY_INVALID");
  const ok = m.handoff("t", "h", { from: E(1), to: E(2), artifacts: arts(LIMITS.maxArtifacts), summary: "x".repeat(LIMITS.maxSummary) }); assert.equal(ok.ok, true, JSON.stringify(ok));
});
test("hardening: duplicate detection compares meaning (case, whitespace, undefined/NaN, unicode forms, key order)", () => {
  const l = mk(); assert.equal(l.register("t", { id: "a", kind: "research", payload: { q: "Find  the Report", n: 1 }, owner: E(1) }).ok, true);
  for (const [i, pl] of [{ n: 1, q: "find the report" }, { q: " FIND the\treport ", n: 1, extra: undefined }, { q: "Ｆind the report", n: 1 }].entries()) { const r = l.register("t", { id: "d" + i, kind: "research", payload: pl, owner: E(2) }); assert.equal(r.reason, "DUPLICATE_WORK", JSON.stringify(pl)); }
  assert.notEqual(fingerprint("k", { a: NaN }), fingerprint("k", { a: 0 })); assert.equal(fingerprint("k", { a: NaN }), fingerprint("k", { a: null })); assert.equal(fingerprint("k", [undefined]), fingerprint("k", [null]));
  assert.equal(l.register("t", { id: "ok", kind: "research", payload: { q: "different", n: 1 }, owner: E(2) }).ok, true);
  assert.equal(l.register("t", { id: "k2", kind: "other", payload: { q: "find the report", n: 1 }, owner: E(3) }).ok, true, "same payload, different kind is not a duplicate");
});
