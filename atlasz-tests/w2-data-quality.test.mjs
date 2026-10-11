import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadStore, parseCsv, checkStore, baselineFrom, checkAuditChain, runQualityMonitor, registerQualityJobs, checkSyncConsistency, STATUS } from "../atlasz-addons/data-quality.mjs";
import { createAuditChain } from "../atlasz-addons/audit-chain.mjs";
import { createScheduler } from "../atlasz-addons/scheduler.mjs";
import { createToolRegistry } from "../atlasz-addons/typed-tools.mjs";
import { rig } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

const write = (root, files) => { for (const [rel, c] of Object.entries(files)) { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof c === "string" || Buffer.isBuffer(c) ? c : JSON.stringify(c)); } return root; };
const treeHash = root => { const out = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(p + ":" + fs.readFileSync(p, "base64")); } }; walk(root); return out.join("\n"); };
const rows = n => Array.from({ length: n }, (_, i) => ({ id: "c" + i, amount: 100 + (i % 7), email: i % 10 === 0 ? null : `u${i}@example.test`, updatedAt: "2026-10-01T00:00:00Z" }));

test("CSV parser: quotes, doubled quotes, embedded newlines, CRLF, unterminated quote", () => {
  const p = parseCsv('a,b\r\n"x, y","he said ""hi"""\n"multi\nline",2\n');
  assert.deepEqual(p.rows, [["a", "b"], ["x, y", 'he said "hi"'], ["multi\nline", "2"]]); assert.deepEqual(p.lines, [1, 2, 3]);
  assert.equal(parseCsv('a\n"open').unterminated, true);
});

test("loadStore: JSON shapes, JSONL malformed lines with line numbers, CSV ragged rows and duplicate headers", () => {
  const root = write(tmp("dq-"), { "a.json": [{ id: 1 }, 5, { id: 2 }], "b.json": { records: [{ id: 1 }] }, "c.json": { k1: { v: 1 }, k2: { v: 2 } }, "d.json": { x: 1 }, "e.jsonl": '{"id":1}\n{broken\n[1]\n\n{"id":2}\n', "f.csv": "id,name,name\n1,a,b\n2,c\n", "g.txt": "x" }); try {
    const a = loadStore({ root, file: "a.json" }); assert.equal(a.records.length, 2); assert.deepEqual(a.malformed, [{ row: 1, reason: "NOT_AN_OBJECT" }]);
    assert.equal(loadStore({ root, file: "b.json" }).records.length, 1);
    assert.deepEqual(loadStore({ root, file: "c.json" }).records, [{ _key: "k1", v: 1 }, { _key: "k2", v: 2 }]);
    assert.equal(loadStore({ root, file: "d.json" }).reason, "JSON_SHAPE_UNSUPPORTED");
    assert.deepEqual(loadStore({ root, file: "e.jsonl" }).malformed, [{ line: 2, reason: "JSON_INVALID" }, { line: 3, reason: "NOT_AN_OBJECT" }]);
    const f = loadStore({ root, file: "f.csv" }); assert.deepEqual(f.issues, [{ kind: "DUPLICATE_HEADER", fields: ["name"] }]); assert.equal(f.malformed[0].line, 3);
    assert.equal(loadStore({ root, file: "g.txt" }).reason, "UNSUPPORTED_STORE_FORMAT");
  } finally { rm(root); }
});

test("loadStore adversarial: traversal, absolute path, symlink, huge file, malformed JSON, binary", () => {
  const root = write(tmp("dq-"), { "ok.json": "[]", "bad.json": "{\"a\": [1, 2", "big.json": "[" + "1,".repeat(200000) + "1]", "bin.json": Buffer.from([0, 1, 2]) }), out = write(tmp("dq-out-"), { "s.json": "[]" }); try {
    assert.equal(loadStore({ root, file: "../x.json" }).reason, "PATH_TRAVERSAL_REFUSED");
    assert.equal(loadStore({ root, file: "/etc/passwd" }).reason, "PATH_INVALID");
    fs.symlinkSync(path.join(out, "s.json"), path.join(root, "link.json"));
    assert.equal(loadStore({ root, file: "link.json" }).reason, "SYMLINK_REFUSED");
    assert.equal(loadStore({ root, file: "big.json", maxBytes: 1000 }).reason, "FILE_TOO_LARGE");
    assert.equal(loadStore({ root, file: "big.json", maxBytes: 10 ** 12 }).ok, true, "caller cannot raise the cap above LIMITS, but 400KB is under it");
    const bad = loadStore({ root, file: "bad.json" }); assert.equal(bad.reason, "JSON_INVALID"); assert.ok(bad.detail);
    assert.equal(loadStore({ root, file: "bin.json" }).reason, "BINARY_FILE_REFUSED");
  } finally { rm(root); rm(out); }
});

test("checkStore: duplicate keys, missing keys and outliers with row evidence", () => {
  const data = rows(30); data[5].amount = 99999; data.push({ id: "c3", amount: 101 }); data.push({ id: null, amount: 102 });
  const root = write(tmp("dq-"), { "s/customers.json": data }); try {
    const r = checkStore({ root, file: "s/customers.json", key: "id" });
    const by = k => r.findings.find(f => f.kind === k);
    assert.deepEqual(by("DUPLICATE_KEY").examples, [{ value: "c3", rows: [3, 30] }]);
    assert.deepEqual(by("MISSING_KEY").rows, [31]);
    const o = by("NUMERIC_OUTLIERS"); assert.equal(o.field, "amount"); assert.deepEqual(o.outliers.map(x => [x.row, x.value]), [[5, 99999]]);
  } finally { rm(root); }
});

test("checkStore against a baseline: null spike, field added/removed, type changed; baselineFrom round trip", () => {
  const root = write(tmp("dq-"), { "s.json": rows(20) }); try {
    const base = baselineFrom(checkStore({ root, file: "s.json", key: "id" }), { at: "2026-10-01T00:00:00Z" });
    assert.equal(base.ok, true); assert.equal(base.fields.amount.dominantType, "number");
    const changed = rows(20).map((r, i) => ({ id: r.id, amount: String(r.amount), email: i < 15 ? null : r.email, newField: 1 }));
    write(root, { "s.json": changed });
    const r = checkStore({ root, file: "s.json", key: "id", baseline: base }), kinds = r.findings.map(f => f.kind + ":" + (f.field ?? ""));
    assert.ok(kinds.includes("NULL_SPIKE:email")); assert.ok(kinds.includes("SCHEMA_TYPE_CHANGED:amount")); assert.ok(kinds.includes("SCHEMA_FIELD_ADDED:newField")); assert.ok(kinds.includes("SCHEMA_FIELD_REMOVED:updatedAt"));
    assert.equal(baselineFrom({ ok: false }).reason, "CHECK_RESULT_REQUIRED");
  } finally { rm(root); }
});

test("checkStore: mixed types, high null rate without baseline, stale file; clean data has no findings", () => {
  const root = write(tmp("dq-"), { "m.jsonl": ['{"id":1,"v":1,"n":null}', '{"id":2,"v":"two","n":null}', '{"id":3,"v":3,"n":null}', '{"id":4,"v":4,"n":1}'].join("\n"), "clean.json": rows(12).map(r => ({ ...r, email: "x@example.test" })) }); try {
    const r = checkStore({ root, file: "m.jsonl", key: "id", staleAfterMs: 1000, now: Date.now() + 3600000 });
    const k = r.findings.map(f => f.kind); assert.ok(k.includes("MIXED_TYPES")); assert.ok(k.includes("HIGH_NULL_RATE")); assert.ok(k.includes("STALE_FILE"));
    assert.deepEqual(checkStore({ root, file: "clean.json", key: "id" }).findings, []);
    assert.equal(checkStore({ root, file: "clean.json", key: "" }).reason, "KEY_INVALID");
  } finally { rm(root); }
});

test("checkAuditChain: intact chain verifies; an edited entry, a deleted entry and a corrupt middle line are detected", () => {
  const root = tmp("dq-"); try {
    const file = path.join(root, "audit", "a.jsonl"), c = createAuditChain({ filePath: file });
    for (let i = 0; i < 5; i++) c.append("EVT", { i });
    const ok = checkAuditChain({ root, file: "audit/a.jsonl" }); assert.equal(ok.intact, true); assert.equal(ok.length, 5);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    const edited = lines.map((l, i) => i === 2 ? l.replace('"i":2', '"i":9') : l).join("\n") + "\n";
    write(root, { "audit/edit.jsonl": edited, "audit/del.jsonl": lines.filter((_, i) => i !== 1).join("\n") + "\n", "audit/corrupt.jsonl": [lines[0], "{oops", lines[2]].join("\n") + "\n", "audit/torn.jsonl": lines.join("\n") + "\n{\"seq\":6" });
    assert.deepEqual([checkAuditChain({ root, file: "audit/edit.jsonl" }).intact, checkAuditChain({ root, file: "audit/edit.jsonl" }).reason, checkAuditChain({ root, file: "audit/edit.jsonl" }).brokenAt], [false, "ENTRY_HASH_MISMATCH", 3]);
    assert.equal(checkAuditChain({ root, file: "audit/del.jsonl" }).reason, "SEQUENCE_GAP_OR_REORDER");
    assert.deepEqual([checkAuditChain({ root, file: "audit/corrupt.jsonl" }).reason, checkAuditChain({ root, file: "audit/corrupt.jsonl" }).line], ["CORRUPT_LINE", 2]);
    const torn = checkAuditChain({ root, file: "audit/torn.jsonl" }); assert.equal(torn.intact, true); assert.equal(torn.tornTail, true); assert.equal(torn.ok, true);
    assert.equal(checkAuditChain({ root, file: "../a.jsonl" }).reason, "PATH_TRAVERSAL_REFUSED");
  } finally { rm(root); }
});

test("runQualityMonitor aggregates severities, is read-only and reports unreadable stores as INCOMPLETE (never 'no issues')", () => {
  const root = write(tmp("dq-"), { "a.json": rows(12), "b.json": "{bad" }); try {
    const before = treeHash(root);
    const r = runQualityMonitor({ root, stores: [{ file: "a.json", key: "id" }, { file: "b.json" }], now: Date.UTC(2026, 9, 10) });
    assert.equal(r.verdict, "INCOMPLETE_SOME_STORES_UNREADABLE"); assert.equal(r.unreadable, 1); assert.equal(r.results[1].reason, "JSON_INVALID");
    assert.equal(runQualityMonitor({ root, stores: [{ file: "a.json", key: "id" }] }).verdict, "NO_ISSUES_BY_THESE_RULES");
    write(root, { "a.json": [...rows(12), { id: "c1" }] });
    const dup = runQualityMonitor({ root, stores: [{ file: "a.json", key: "id" }] }); assert.equal(dup.verdict, "ISSUES_FOUND"); assert.equal(dup.severity.HIGH, 1);
    write(root, { "a.json": rows(12) });
    assert.equal(treeHash(root), before);
    assert.equal(runQualityMonitor({ root, stores: "x" }).reason, "MONITOR_CONFIG_INVALID");
    assert.equal(runQualityMonitor({ root, stores: Array.from({ length: 101 }, () => ({ file: "a.json" })) }).reason, "MONITOR_CONFIG_INVALID");
  } finally { rm(root); }
});

test("registerQualityJobs: real scheduler + typed-tool registry run the monitor on an INTERVAL; store paths are not job arguments", async () => {
  const r = rig(), dir = tmp("dq-sch-"), data = write(tmp("dq-"), { "a.json": rows(12) }), clock = { t: Date.UTC(2026, 9, 10, 10) }, now = () => new Date(clock.t).toISOString(); try {
    const reg = createToolRegistry({ chain: r.sys.chain, blackBox: r.blackBox });
    const sch = createScheduler({ file: path.join(dir, "s.json"), tools: reg, gate: x => r.emergency.gate(x), now, blackBox: r.blackBox });
    const q = registerQualityJobs({ registry: reg, scheduler: sch, stores: { crm: { root: data, files: [{ file: "a.json", key: "id" }] } }, everyMs: 3600000, now: () => clock.t });
    assert.equal(q.ok, true); assert.equal(q.jobs.length, 1);
    clock.t += 3600000; const t = await sch.tick(); assert.equal(t.ran, 1); assert.equal(t.results[0].status, "OK");
    assert.equal(q.lastReport("crm").results[0].records, 12);
    const bad = await reg.invoke("data_quality.scan", { storeId: "../../etc" }); assert.equal(bad.status, "INVALID_ARGUMENTS");
    assert.equal(registerQualityJobs({ registry: reg, scheduler: sch, stores: { "Bad Id": {} } }).reason, "STORES_CONFIG_INVALID");
    assert.equal(registerQualityJobs({}).reason, "REGISTRY_AND_SCHEDULER_REQUIRED");
  } finally { rm(r.dir); rm(dir); rm(data); }
});

test("sync without ancestor: differing values become conflicts with last-writer PROPOSALS; ties, missing and future timestamps need the owner", () => {
  const A = [{ id: "1", v: "a", updatedAt: "2026-10-02T00:00:00Z" }, { id: "2", v: "same", updatedAt: "2026-10-01T00:00:00Z" }, { id: "3", v: "x", updatedAt: "2026-10-01T00:00:00Z" }, { id: "4", v: "p" }, { id: "5", v: "f", updatedAt: "2099-01-01T00:00:00Z" }, { id: "6", v: "onlyA" }];
  const B = [{ id: "1", v: "b", updatedAt: "2026-10-01T00:00:00Z" }, { id: "2", v: "same", updatedAt: "2026-10-01T00:00:00Z" }, { id: "3", v: "y", updatedAt: "2026-10-01T00:00:00Z" }, { id: "4", v: "q", updatedAt: "2026-10-01T00:00:00Z" }, { id: "5", v: "g", updatedAt: "2026-10-01T00:00:00Z" }];
  const ra = write(tmp("dq-a-"), { "s.json": A }), rb = write(tmp("dq-b-"), { "s.jsonl": B.map(x => JSON.stringify(x)).join("\n") }); try {
    const before = treeHash(ra) + treeHash(rb);
    const r = checkSyncConsistency({ a: { root: ra, file: "s.json" }, b: { root: rb, file: "s.jsonl" }, key: "id", now: Date.UTC(2026, 9, 10) });
    const by = Object.fromEntries(r.conflicts.map(c => [c.key, c]));
    assert.equal(by["1"].proposal.winner, "A"); assert.deepEqual(by["1"].fields, ["updatedAt", "v"]);
    assert.equal(by["3"].proposal.reason, "NEEDS_OWNER_DECISION:TIMESTAMP_TIE"); assert.equal(by["4"].proposal.reason, "NEEDS_OWNER_DECISION:TIMESTAMP_MISSING_OR_INVALID");
    assert.equal(by["5"].proposal.reason, "NEEDS_OWNER_DECISION:TIMESTAMP_IN_FUTURE"); assert.equal(by["6"].type, "ONLY_IN_A");
    assert.ok(r.conflicts.every(c => c.autoResolved === false)); assert.equal(r.resolutionApplied, false); assert.equal(r.consistent, false); assert.equal(r.counts.identical, 1);
    assert.equal(treeHash(ra) + treeHash(rb), before, "never writes either store");
  } finally { rm(ra); rm(rb); }
});

test("sync with a common ancestor: one-sided changes are propagations (create/update/delete), two-sided are conflicts", () => {
  const O = [{ id: 1, v: 1 }, { id: 2, v: 2 }, { id: 3, v: 3 }, { id: 4, v: 4 }];
  const A = [{ id: 1, v: 10 }, { id: 2, v: 2 }, { id: 3, v: 30 }, { id: 4, v: 4 }, { id: 5, v: 5 }];
  const B = [{ id: 1, v: 1 }, { id: 2, v: 20 }, { id: 3, v: 31 }];
  const root = write(tmp("dq-"), { "o.json": O, "a.json": A, "b.json": B }); try {
    const r = checkSyncConsistency({ a: { root, file: "a.json" }, b: { root, file: "b.json" }, base: { root, file: "o.json" }, key: "id" });
    assert.deepEqual(r.propagations.map(p => p.key + ":" + p.direction + ":" + p.change), ["1:A_TO_B:UPDATE", "2:B_TO_A:UPDATE", "4:B_TO_A:DELETE", "5:A_TO_B:CREATE"]);
    assert.deepEqual(r.conflicts.map(c => c.key + ":" + c.type), ["3:BOTH_CHANGED"]);
    const r2 = checkSyncConsistency({ a: { root, file: "a.json" }, b: { root, file: "b.json" }, base: { root, file: "o.json" }, key: "id", rule: "B_WINS" });
    assert.equal(r2.conflicts[0].proposal.winner, "B"); assert.equal(r2.resolutionApplied, false);
  } finally { rm(root); }
});

test("sync: duplicate keys are ambiguous (excluded, reported); bad rule/key/paths fail closed; identical stores are consistent", () => {
  const root = write(tmp("dq-"), { "a.json": [{ id: 1, v: 1 }, { id: 1, v: 2 }, { id: 2, v: 2 }], "b.json": [{ id: 1, v: 1 }, { id: 2, v: 2 }], "c.json": [{ id: 2, v: 2 }, { id: 1, v: 1 }] }); try {
    const r = checkSyncConsistency({ a: { root, file: "a.json" }, b: { root, file: "b.json" }, key: "id" });
    assert.deepEqual(r.ambiguousKeys, ["1"]); assert.equal(r.consistent, false); assert.equal(r.counts.identical, 1);
    assert.equal(checkSyncConsistency({ a: { root, file: "b.json" }, b: { root, file: "c.json" }, key: "id" }).consistent, true);
    assert.equal(checkSyncConsistency({ a: { root, file: "b.json" }, b: { root, file: "c.json" }, key: "id", rule: "AUTO_MERGE" }).reason, "RULE_INVALID");
    assert.equal(checkSyncConsistency({ a: { root, file: "b.json" }, b: { root, file: "c.json" } }).reason, "KEY_REQUIRED");
    assert.equal(checkSyncConsistency({ a: { root, file: "../b.json" }, b: { root, file: "c.json" }, key: "id" }).reason, "A_PATH_TRAVERSAL_REFUSED");
    assert.equal(checkSyncConsistency({ a: { root, file: "b.json" }, b: { root, file: "c.json" }, base: { root, file: "nope.json" }, key: "id" }).reason, "BASE_FILE_NOT_FOUND");
  } finally { rm(root); }
});

test("sync with MANUAL rule never names a winner; report hash is deterministic", () => {
  const root = write(tmp("dq-"), { "a.json": [{ id: 1, v: 1, updatedAt: "2026-10-02" }], "b.json": [{ id: 1, v: 2, updatedAt: "2026-10-01" }] }); try {
    const args = { a: { root, file: "a.json" }, b: { root, file: "b.json" }, key: "id", rule: "MANUAL" };
    const r = checkSyncConsistency(args); assert.equal(r.conflicts[0].proposal.winner, null); assert.equal(r.counts.needsOwner, 1);
    assert.equal(checkSyncConsistency(args).reportSha256, r.reportSha256);
  } finally { rm(root); }
});

test("a broken audit chain in the monitor counts as HIGH; CSV numbers are typed, empty cells are null", () => {
  const root = tmp("dq-"); try {
    const c = createAuditChain({ filePath: path.join(root, "chain.jsonl") }); c.append("A", {}); c.append("B", {});
    const l = fs.readFileSync(path.join(root, "chain.jsonl"), "utf8").split("\n"); fs.writeFileSync(path.join(root, "chain.jsonl"), [l[1], l[0], ""].join("\n"));
    write(root, { "t.csv": "id,amount,note\n1,10.5,\n2,-3,hello\n" });
    const r = runQualityMonitor({ root, stores: [{ file: "t.csv", key: "id" }], auditChains: ["chain.jsonl"] });
    assert.equal(r.chains[0].intact, false); assert.equal(r.severity.HIGH, 1); assert.equal(r.verdict, "ISSUES_FOUND");
    assert.deepEqual(loadStore({ root, file: "t.csv" }).records, [{ id: 1, amount: 10.5, note: null }, { id: 2, amount: -3, note: "hello" }]);
  } finally { rm(root); }
});

test("large store stays bounded: 50k JSONL rows profile in reasonable time; status vocabulary honest", () => {
  const root = write(tmp("dq-"), { "big.jsonl": Array.from({ length: 50000 }, (_, i) => JSON.stringify({ id: i, x: i % 100 })).join("\n") }); try {
    const t0 = Date.now(), r = checkStore({ root, file: "big.jsonl", key: "id" });
    assert.equal(r.records, 50000); assert.ok(Date.now() - t0 < 15000);
    assert.equal(STATUS.live, "NOT_LIVE"); assert.ok(!JSON.stringify(STATUS).includes("VERIFIED_WORKING"));
  } finally { rm(root); }
});
