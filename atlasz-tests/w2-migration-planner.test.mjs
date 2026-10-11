import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { planMigration, runMigrationInCopy, applyMigration, ACTION, STATUS } from "../atlasz-addons/migration-planner.mjs";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { tmp, rm } from "./helpers.mjs";

const write = (root, files) => { for (const [rel, c] of Object.entries(files)) { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof c === "string" ? c : JSON.stringify(c)); } return root; };
const treeHash = root => { const out = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(p + ":" + fs.readFileSync(p, "base64")); } }; walk(root); return out.join("\n"); };
const KEY = generateOwnerKeyPair(), auth = () => createOwnerAuth({ publicKeyB64: KEY.publicKeyB64 });
const sign = (subject, action = ACTION) => issueOwnerApproval({ privateKeyPem: KEY.privateKeyPem, action, subject });
const SRC = { version: "1", key: "id", fields: { id: { type: "string", required: true }, name: { type: "string" }, amount: { type: "string" }, legacy: { type: "string" } } };
const TGT = { version: "2", key: "id", fields: { id: { type: "string", required: true }, fullName: { type: "string" }, amount: { type: "number" }, currency: { type: "string", required: true } } };
const MAP = { renames: { name: "fullName" }, transforms: { amount: "toNumber" }, defaults: { currency: "CAD" } };
const DATA = [{ id: "a", name: "Ann", amount: "10.5", legacy: "x" }, { id: "b", name: "Bob", amount: "3", legacy: "y" }];
const world = () => { const src = write(tmp("mg-src-"), { "store/customers.json": DATA, "store/events.jsonl": DATA.map(d => JSON.stringify(d)).join("\n") + "\n" }), work = tmp("mg-work-"), backup = tmp("mg-bak-"); return { src, work, backup, done: () => { rm(src); rm(work); rm(backup); } }; };
const plan0 = w => planMigration({ sourceRoot: w.src, files: ["store/customers.json", "store/events.jsonl"], source: SRC, target: TGT, mapping: MAP });

test("planMigration: operations with reversible flags, steps, rollback, risks, expected checksums; planning writes nothing", () => {
  const w = world(); try {
    const before = treeHash(w.src), p = plan0(w);
    assert.equal(p.ok, true); assert.equal(p.status, "READY_FOR_TRIAL"); assert.equal(p.dryRun, true);
    assert.deepEqual(p.operations.map(o => o.op + ":" + (o.field ?? o.from) + ":" + o.reversible), ["DROP_FIELD:legacy:false", "RENAME_FIELD:name:true", "ADD_FIELD:currency:true", "TRANSFORM_FIELD:amount:true"].sort((a, b) => p.operations.findIndex(o => a.startsWith(o.op)) - p.operations.findIndex(o => b.startsWith(o.op))));
    assert.ok(p.risks.some(r => r.code === "DATA_LOSS_DROP_FIELD" && r.field === "legacy")); assert.equal(p.reversible, false);
    assert.deepEqual(p.steps.map(s => s.name), ["PRECHECK", "BACKUP", "TRANSFORM_IN_COPY", "VERIFY", "APPLY", "POST_VERIFY"]);
    assert.match(p.rollback.detail, /backup is the only way back/);
    assert.equal(p.files.length, 2); assert.ok(p.files.every(f => /^[0-9a-f]{64}$/.test(f.expectedOutputSha256) && f.records === 2));
    assert.match(p.planSha256, /^[0-9a-f]{64}$/); assert.equal(plan0(w).planSha256, p.planSha256, "deterministic");
    assert.equal(treeHash(w.src), before);
  } finally { w.done(); }
});

test("planMigration blockers: required field without default, type change without transform, conversion failures, duplicate keys", () => {
  const w = world(); try {
    write(w.src, { "store/bad.json": [{ id: "a", name: "A", amount: "12abc" }, { id: "a", name: "B", amount: "1" }] });
    const p = planMigration({ sourceRoot: w.src, files: ["store/bad.json"], source: SRC, target: TGT, mapping: { renames: { name: "fullName" }, transforms: { amount: "toNumber" } } });
    const codes = p.blockers.map(b => b.code).sort();
    assert.deepEqual(codes, ["CONVERSION_FAILURES", "DUPLICATE_KEYS_AFTER_MIGRATION", "REQUIRED_FIELD_WITHOUT_DEFAULT", "TARGET_SCHEMA_VIOLATIONS"]);
    assert.deepEqual(p.blockers.find(b => b.code === "CONVERSION_FAILURES").examples[0], { row: 0, field: "amount", reason: "CONVERSION_FAILED:toNumber" });
    assert.equal(p.status, "BLOCKED");
    const p2 = planMigration({ sourceRoot: w.src, files: ["store/customers.json"], source: SRC, target: TGT, mapping: { renames: { name: "fullName" }, defaults: { currency: "CAD" } } });
    assert.deepEqual(p2.blockers.map(b => b.code), ["TYPE_CHANGE_WITHOUT_TRANSFORM", "TARGET_SCHEMA_VIOLATIONS"]);
  } finally { w.done(); }
});

test("planMigration input validation fails closed: traversal, bad schemas, unknown transforms, non-array JSON, malformed rows", () => {
  const w = world(); try {
    write(w.src, { "store/map.json": { a: { id: "a" } }, "store/broken.jsonl": '{"id":"a"}\n{nope\n' });
    const P = o => planMigration({ sourceRoot: w.src, files: ["store/customers.json"], source: SRC, target: TGT, mapping: MAP, ...o });
    assert.equal(P({ files: ["../etc/passwd"] }).reason, "PATH_TRAVERSAL_OR_INVALID_PATH_REFUSED");
    assert.equal(P({ files: [] }).reason, "FILES_INVALID");
    assert.equal(P({ files: ["store/customers.json", "store/./customers.json"] }).reason, "DUPLICATE_FILE");
    assert.equal(P({ source: { key: "id", fields: { id: { type: "uuid" } } } }).reason, "SOURCE_SCHEMA_FIELD_INVALID:id");
    assert.equal(P({ target: { key: "nope", fields: { id: { type: "string" } } } }).reason, "TARGET_SCHEMA_KEY_INVALID");
    assert.equal(P({ mapping: { ...MAP, transforms: { amount: "eval" } } }).reason, "TRANSFORM_INVALID:amount");
    assert.equal(P({ mapping: { ...MAP, renames: { name: "nope" } } }).reason, "RENAME_INVALID:name->nope");
    assert.equal(P({ files: ["store/missing.json"] }).reason, "SOURCE_FILE_NOT_FOUND");
    assert.deepEqual(P({ files: ["store/map.json"] }).blockers.map(b => b.code), ["UNSUPPORTED_JSON_SHAPE_ARRAY_REQUIRED"]);
    assert.ok(P({ files: ["store/broken.jsonl"] }).blockers.some(b => b.code === "SOURCE_HAS_MALFORMED_ROWS"));
  } finally { w.done(); }
});

test("lossy transform is detected on the actual data and marks the plan irreversible", () => {
  const w = world(); try {
    write(w.src, { "store/z.json": [{ id: "a", amount: "007" }, { id: "b", amount: "5" }] });
    const S = { key: "id", fields: { id: { type: "string" }, amount: { type: "string" } } }, T = { key: "id", fields: { id: { type: "string" }, amount: { type: "number" } } };
    const p = planMigration({ sourceRoot: w.src, files: ["store/z.json"], source: S, target: T, mapping: { transforms: { amount: "toNumber" } } });
    assert.equal(p.operations[0].reversible, false); assert.ok(p.risks.some(r => r.code === "LOSSY_TRANSFORM_ON_DATA" && r.records === 1));
    write(w.src, { "store/z.json": [{ id: "a", amount: "7" }] });
    const p2 = planMigration({ sourceRoot: w.src, files: ["store/z.json"], source: S, target: T, mapping: { transforms: { amount: "toNumber" } } });
    assert.equal(p2.reversible, true); assert.match(p2.rollback.detail, /invertible/);
  } finally { w.done(); }
});

test("runMigrationInCopy migrates a COPY, verifies counts/keys/checksums, and proves the source untouched", () => {
  const w = world(); try {
    const before = treeHash(w.src), p = plan0(w), r = runMigrationInCopy({ plan: p, sourceRoot: w.src, workDir: w.work });
    assert.equal(r.status, "TRIAL_PASSED"); assert.equal(r.sourceUnchanged, true); assert.ok(r.files.every(f => f.matchesPlan && f.countsMatch && f.keysMatch));
    assert.ok(r.copyDir.startsWith(fs.realpathSync(w.work)));
    const out = JSON.parse(fs.readFileSync(path.join(r.outputDir, "store/customers.json"), "utf8"));
    assert.deepEqual(out[0], { id: "a", fullName: "Ann", amount: 10.5, currency: "CAD" });
    assert.equal(treeHash(w.src), before);
  } finally { w.done(); }
});

test("runMigrationInCopy refuses: tampered plan, plan with blockers, source changed since plan, work dir inside the source", () => {
  const w = world(); try {
    const p = plan0(w);
    assert.equal(runMigrationInCopy({ plan: { ...p, files: p.files.map(f => ({ ...f, expectedOutputSha256: "0".repeat(64) })) }, sourceRoot: w.src, workDir: w.work }).reason, "PLAN_TAMPERED_OR_INVALID");
    assert.equal(runMigrationInCopy({ plan: p, sourceRoot: w.src, workDir: path.join(w.src, "tmp") }).reason, "WORK_DIR_MUST_BE_OUTSIDE_DATA_FOLDERS");
    assert.equal(runMigrationInCopy({ plan: p, sourceRoot: w.src, workDir: "relative/dir" }).reason, "WORK_DIR_MUST_BE_ABSOLUTE");
    write(w.src, { "store/customers.json": [...DATA, { id: "c", name: "C", amount: "1" }] });
    assert.equal(runMigrationInCopy({ plan: p, sourceRoot: w.src, workDir: w.work }).reason, "SOURCE_CHANGED_SINCE_PLAN");
    write(w.src, { "store/bad.json": [{ id: "x", amount: "no" }] });
    const pb = planMigration({ sourceRoot: w.src, files: ["store/bad.json"], source: SRC, target: TGT, mapping: MAP });
    assert.equal(runMigrationInCopy({ plan: pb, sourceRoot: w.src, workDir: w.work }).reason, "PLAN_HAS_BLOCKERS");
  } finally { w.done(); }
});

test("applyMigration is refused without owner auth, without approval, with a bare boolean, wrong action or wrong subject - and nothing changes", async () => {
  const w = world(); try {
    const p = plan0(w), before = treeHash(w.src), A = { plan: p, sourceRoot: w.src, workDir: w.work, backupDir: w.backup };
    assert.equal(applyMigration({ ...A }).reason, "OWNER_AUTH_REQUIRED");
    assert.equal(applyMigration({ ...A, ownerAuth: auth() }).reason, "OWNER_APPROVAL_REQUIRED:APPROVAL_OBJECT_REQUIRED");
    assert.equal(applyMigration({ ...A, ownerAuth: auth(), ownerApproval: true }).reason, "OWNER_APPROVAL_REQUIRED:BARE_BOOLEAN_REJECTED");
    assert.equal(applyMigration({ ...A, ownerAuth: auth(), ownerApproval: sign(p.planSha256, "CODE_EDIT_APPLY") }).reason, "OWNER_APPROVAL_REQUIRED:ACTION_MISMATCH");
    assert.equal(applyMigration({ ...A, ownerAuth: auth(), ownerApproval: sign("f".repeat(64)) }).reason, "OWNER_APPROVAL_REQUIRED:SUBJECT_MISMATCH");
    const forged = { ...sign(p.planSha256), signature: Buffer.alloc(64).toString("base64") };
    assert.equal(applyMigration({ ...A, ownerAuth: auth(), ownerApproval: forged }).reason, "OWNER_APPROVAL_REQUIRED:SIGNATURE_INVALID");
    assert.equal(applyMigration({ ...A, ownerAuth: createOwnerAuth({}), ownerApproval: sign(p.planSha256) }).reason, "OWNER_APPROVAL_REQUIRED:OWNER_AUTH_NOT_CONFIGURED");
    assert.equal(treeHash(w.src), before); assert.deepEqual(fs.readdirSync(w.backup), []);
  } finally { w.done(); }
});

test("applyMigration with a valid signed approval: backup with manifest, in-place apply, hashes match the trial; replay is refused", () => {
  const w = world(); try {
    const p = plan0(w), oa = auth(), appr = sign(p.planSha256), orig = fs.readFileSync(path.join(w.src, "store/customers.json"));
    const r = applyMigration({ plan: p, sourceRoot: w.src, workDir: w.work, backupDir: w.backup, ownerAuth: oa, ownerApproval: appr });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.status, "APPLIED_HASHES_MATCH_TRIAL");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.src, "store/customers.json"), "utf8"))[1], { id: "b", fullName: "Bob", amount: 3, currency: "CAD" });
    assert.deepEqual(fs.readFileSync(path.join(r.backup.dir, "files/store/customers.json")), orig);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r.backup.dir, "manifest.json"), "utf8")).files.map(f => f.file), ["store/customers.json", "store/events.jsonl"]);
    assert.ok(!JSON.stringify(r).includes("VERIFIED_WORKING"));
    // the same approval cannot be used twice (and the source has changed anyway)
    const again = applyMigration({ plan: p, sourceRoot: w.src, workDir: w.work, backupDir: w.backup, ownerAuth: oa, ownerApproval: appr });
    assert.equal(again.ok, false); assert.equal(again.reason, "OWNER_APPROVAL_REQUIRED:REPLAY_DETECTED");
  } finally { w.done(); }
});

test("applyMigration to a separate target root writes only there; existing target files and backup dir inside data are refused", () => {
  const w = world(), tgt = tmp("mg-tgt-"); try {
    const p = plan0(w), before = treeHash(w.src);
    assert.equal(applyMigration({ plan: p, sourceRoot: w.src, targetRoot: tgt, workDir: w.work, backupDir: path.join(tgt, "bak"), ownerAuth: auth(), ownerApproval: sign(p.planSha256) }).reason, "BACKUP_DIR_MUST_BE_OUTSIDE_DATA_FOLDERS"); assert.equal(fs.existsSync(path.join(tgt, "bak")), false, "a refused backup folder is never created");
    const r = applyMigration({ plan: p, sourceRoot: w.src, targetRoot: tgt, workDir: w.work, backupDir: w.backup, ownerAuth: auth(), ownerApproval: sign(p.planSha256) });
    assert.equal(r.status, "APPLIED_HASHES_MATCH_TRIAL", JSON.stringify(r)); assert.equal(treeHash(w.src), before, "source untouched when the target is separate");
    assert.ok(fs.existsSync(path.join(tgt, "store/events.jsonl")));
    assert.equal(applyMigration({ plan: p, sourceRoot: w.src, targetRoot: tgt, workDir: w.work, backupDir: w.backup, ownerAuth: auth(), ownerApproval: sign(p.planSha256) }).reason, "TARGET_FILE_EXISTS");
  } finally { w.done(); rm(tgt); }
});

test("applyMigration refuses when the source changed after approval (approval not consumed); a tampered plan is refused before approval is checked", () => {
  const w = world(); try {
    const p = plan0(w), oa = auth(), appr = sign(p.planSha256);
    write(w.src, { "store/events.jsonl": "" });
    const r = applyMigration({ plan: p, sourceRoot: w.src, workDir: w.work, backupDir: w.backup, ownerAuth: oa, ownerApproval: appr });
    assert.equal(r.reason, "SOURCE_CHANGED_SINCE_PLAN");
    assert.equal(oa.verifyApproval(appr, { action: ACTION, subject: p.planSha256, consume: false }).allowed, true, "approval still unspent");
    const t = { ...p, operations: [] };
    assert.equal(applyMigration({ plan: t, sourceRoot: w.src, workDir: w.work, backupDir: w.backup, ownerAuth: oa, ownerApproval: sign(p.planSha256) }).reason, "PLAN_TAMPERED_OR_INVALID");
  } finally { w.done(); }
});

test("a failure after writing restores the originals from the backup (post-verify mismatch simulated)", () => {
  const w = world(); try {
    const p = plan0(w), orig = treeHash(w.src);
    // make the second target path a directory-blocker: replace store/events.jsonl's parent mid-way is hard; instead make the file read-only directory target
    const realRename = fs.renameSync; let n = 0;
    fs.renameSync = (a, b) => { if (String(a).includes(".migrate-") && ++n === 2) throw new Error("DISK_FULL_SIMULATED"); return realRename(a, b); };
    let r; try { r = applyMigration({ plan: p, sourceRoot: w.src, workDir: w.work, backupDir: w.backup, ownerAuth: auth(), ownerApproval: sign(p.planSha256) }); } finally { fs.renameSync = realRename; }
    assert.equal(r.ok, false); assert.equal(r.reason, "APPLY_FAILED_RESTORED"); assert.equal(r.status, "ROLLED_BACK");
    for (const f of fs.readdirSync(path.join(w.src, "store"))) if (f.includes(".migrate-")) fs.rmSync(path.join(w.src, "store", f));     // the failed tmp file (left by the simulated failure) is the only difference
    assert.equal(treeHash(w.src), orig);
  } finally { w.done(); }
});

test("symlinked store files and huge stores are refused at planning time", () => {
  const w = world(), out = write(tmp("mg-out-"), { "x.json": "[]" }); try {
    fs.symlinkSync(path.join(out, "x.json"), path.join(w.src, "store", "link.json"));
    assert.equal(planMigration({ sourceRoot: w.src, files: ["store/link.json"], source: SRC, target: TGT, mapping: MAP }).reason, "SOURCE_SYMLINK_REFUSED");
    const fd = fs.openSync(path.join(w.src, "store", "huge.json"), "w"); fs.ftruncateSync(fd, 17 * 1048576); fs.closeSync(fd);
    assert.equal(planMigration({ sourceRoot: w.src, files: ["store/huge.json"], source: SRC, target: TGT, mapping: MAP }).reason, "SOURCE_FILE_TOO_LARGE");
  } finally { w.done(); rm(out); }
});

test("JSONL output keeps JSONL format; the in-copy result equals the plan checksum exactly", () => {
  const w = world(); try {
    const p = plan0(w), r = runMigrationInCopy({ plan: p, sourceRoot: w.src, workDir: w.work });
    const txt = fs.readFileSync(path.join(r.outputDir, "store/events.jsonl"), "utf8");
    assert.equal(txt.split("\n").filter(Boolean).length, 2); assert.deepEqual(JSON.parse(txt.split("\n")[0]), { id: "a", fullName: "Ann", amount: 10.5, currency: "CAD" });
    assert.equal(r.files.find(f => f.file === "store/events.jsonl").outputSha256, p.files.find(f => f.file === "store/events.jsonl").expectedOutputSha256);
  } finally { w.done(); }
});

test("rename into an existing source field drops the old one (reported as data loss) and maps correctly", () => {
  const w = world(); try {
    write(w.src, { "store/r.json": [{ id: "1", a: "new", b: "old" }] });
    const S = { key: "id", fields: { id: { type: "string" }, a: { type: "string" }, b: { type: "string" } } }, T = { key: "id", fields: { id: { type: "string" }, b: { type: "string" } } };
    const p = planMigration({ sourceRoot: w.src, files: ["store/r.json"], source: S, target: T, mapping: { renames: { a: "b" } } });
    assert.ok(p.operations.some(o => o.op === "DROP_FIELD" && o.field === "b")); assert.ok(p.operations.some(o => o.op === "RENAME_FIELD" && o.from === "a"));
    const r = runMigrationInCopy({ plan: p, sourceRoot: w.src, workDir: w.work });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r.outputDir, "store/r.json"), "utf8")), [{ id: "1", b: "new" }]);
  } finally { w.done(); }
});

test("status vocabulary is honest and apply is described as owner-gated", () => {
  assert.equal(STATUS.completionState, "CODE_ADDED"); assert.equal(STATUS.live, "NOT_LIVE"); assert.match(STATUS.apply, /OWNER_APPROVAL_GATED/);
  assert.equal(ACTION, "DATA_MIGRATION_APPLY");
});

test("prototype-named fields are plain data: no [native code] renames, no prototype pollution, reversible flag stays honest", () => {
  const d = tmp("mig-proto-"); try {
    fs.writeFileSync(path.join(d, "a.jsonl"), [JSON.stringify({ id: "1", constructor: "x", name: "A" }), '{"id":"2","__proto__":{"polluted":true},"name":"B"}', JSON.stringify({ id: "3", toString: "t", name: "C" })].join("\n") + "\n");
    const S = { key: "id", fields: { id: { type: "string", required: true }, name: { type: "string" }, constructor: { type: "string" }, toString: { type: "string" } } };
    const p = planMigration({ sourceRoot: d, files: ["a.jsonl"], source: S, target: { key: "id", fields: { id: { type: "string", required: true }, name: { type: "string" } } }, mapping: {} });
    assert.equal(p.ok, true, JSON.stringify(p)); assert.equal(p.reversible, false, "dropping fields can never be reversible");
    assert.ok(p.operations.filter(o => o.op === "DROP_FIELD").length >= 2); assert.ok(!JSON.stringify(p).includes("native code")); assert.equal({}.polluted, undefined);
  } finally { rm(d); }
});
