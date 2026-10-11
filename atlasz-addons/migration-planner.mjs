// Secure data-migration planning (PKG150 OP11 / O507). Deterministic, offline; the source store is NEVER modified by planning or by the trial run.
//   planMigration       source + target schema descriptions and a declarative mapping (renames, named transforms, defaults - no code) -> a DRY-RUN plan: operations with a reversible flag,
//                       steps (precheck, backup, transform-in-copy, verify, owner-approved apply, post-verify), the expected output checksum of every file (computed in memory), a rollback
//                       description, a risk list and blockers (required field without default, type change without transform, conversion failures, duplicate keys after migration, ...).
//                       planSha256 = sha256 of the canonical plan; the owner approves exactly that hash.
//   runMigrationInCopy  copies the source files into a fresh folder under workDir (refused inside the source tree), migrates the COPY, verifies counts, key sets, target-schema validity,
//                       the planned output checksums and an inverse round trip for reversible operations, and re-hashes the source to prove it was not touched.
//   applyMigration      refused unless ownerAuth verifies a signed owner approval for action DATA_MIGRATION_APPLY with subject = planSha256. Re-runs the trial, writes a checksummed backup
//                       (outside source and target), writes the outputs tmp+rename, re-hashes them against the trial; any mismatch or error restores the originals from the backup.
// Honest limits: JSON-array and JSONL stores only (other shapes are a blocker, not guessed); one process at a time per store is assumed (no cross-process lock on the data folder); the
// approval proves the owner approved this plan hash, not that the plan is wise. Status after apply is APPLIED_HASHES_MATCH_TRIAL - it is not a claim that downstream systems work.
import fs from "node:fs";
import path from "node:path";
import { loadStore } from "./data-quality.mjs";
import { readConfined, safeRel, realRoot, canonical, sha256, clean, W2_STATUS } from "./dev-assist-common.mjs";

export const LIMITS = Object.freeze({ maxFields: 500, maxFiles: 50, maxRecords: 200000, maxEvidence: 20, largeDataset: 100000 });
export const ACTION = "DATA_MIGRATION_APPLY";
export const STATUS = Object.freeze({ ...W2_STATUS, apply: "OWNER_APPROVAL_GATED (DATA_MIGRATION_APPLY bound to planSha256)" });
const TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "any"]);
const TRANSFORMS = new Set(["toNumber", "toInteger", "toString", "toBoolean", "trim", "lowercase"]);
const FIELD = /^[A-Za-z_][\w-]{0,63}$/;
const typeOk = (t, v) => v === null || v === undefined || t === "any" || (t === "integer" ? Number.isInteger(v) : t === "array" ? Array.isArray(v) : t === "object" ? v && typeof v === "object" && !Array.isArray(v) : typeof v === t);
const relOk = r => typeof r === "string" && r.length > 0 && r.length <= 400 && !/[\0\\]/.test(r) && !r.startsWith("/") && !/^[A-Za-z]:/.test(r) && !path.posix.normalize(r).split("/").includes("..");

function validateSchema(s, name) {
  if (!s || typeof s !== "object" || !s.fields || typeof s.fields !== "object" || Array.isArray(s.fields)) return { ok: false, reason: name + "_SCHEMA_INVALID" };
  const f = Object.entries(s.fields); if (!f.length || f.length > LIMITS.maxFields) return { ok: false, reason: name + "_SCHEMA_FIELD_COUNT_INVALID" };
  for (const [k, d] of f) if (!FIELD.test(k) || !d || !TYPES.has(d.type)) return { ok: false, reason: name + "_SCHEMA_FIELD_INVALID:" + clean(k) };
  if (typeof s.key !== "string" || !s.fields[s.key]) return { ok: false, reason: name + "_SCHEMA_KEY_INVALID" };
  return { ok: true };
}

function convert(op, v) {
  if (v === null || v === undefined) return { ok: true, v: v ?? null };
  switch (op) {
    case "toNumber": { if (typeof v === "number") return Number.isFinite(v) ? { ok: true, v } : { ok: false }; if (typeof v === "string" && /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(v.trim())) return { ok: true, v: Number(v) }; return { ok: false }; }
    case "toInteger": { const c = convert("toNumber", v); return c.ok && Number.isInteger(c.v) ? c : { ok: false }; }
    case "toString": return typeof v === "string" ? { ok: true, v } : typeof v === "number" || typeof v === "boolean" ? { ok: true, v: String(v) } : { ok: false };
    case "toBoolean": return typeof v === "boolean" ? { ok: true, v } : v === "true" || v === 1 || v === "1" ? { ok: true, v: true } : v === "false" || v === 0 || v === "0" ? { ok: true, v: false } : { ok: false };
    case "trim": return typeof v === "string" ? { ok: true, v: v.trim() } : { ok: false };
    case "lowercase": return typeof v === "string" ? { ok: true, v: v.toLowerCase() } : { ok: false };
  }
  return { ok: false };
}
const INVERSE = { toNumber: "toString", toInteger: "toString", toString: null, toBoolean: null, trim: null, lowercase: null };

function migrateRecord(rec, ops) {
  const out = Object.create(null), errors = [];      // null-prototype: a record key such as "__proto__" or "constructor" is plain data, never a prototype or inherited lookup
  for (const [k, v] of Object.entries(rec)) { if (ops.drop.has(k)) continue; out[ops.rename[k] ?? k] = v; }
  for (const [f, t] of Object.entries(ops.transforms)) if (f in out) { const c = convert(t, out[f]); if (c.ok) out[f] = c.v; else errors.push({ field: f, reason: "CONVERSION_FAILED:" + t }); }
  for (const [f, d] of Object.entries(ops.add)) if (!(f in out)) out[f] = structuredClone(d);
  return { out, errors };
}
function inverseRecord(out, ops, srcRec) {      // best-effort inverse used only to PROVE reversibility on the actual data
  const back = Object.create(null);
  const revName = Object.assign(Object.create(null), Object.fromEntries(Object.entries(ops.rename).map(([a, b]) => [b, a])));
  for (const [k, v] of Object.entries(out)) { const orig = revName[k] ?? k; if (k in ops.add && !Object.hasOwn(srcRec, orig)) continue; let val = v; const t = ops.transforms[k]; if (t && typeof (Object.hasOwn(srcRec, orig) ? srcRec[orig] : undefined) === "string") { const inv = INVERSE[t]; if (inv) { const c = convert(inv, v); val = c.ok ? c.v : v; } } back[orig] = val; }     // the inverse may use the source TYPE, never the source value
  return back;
}
const serialize = (format, records) => format === "jsonl" ? records.map(r => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "") : JSON.stringify(records, null, 2) + "\n";

/** Dry-run plan. Reads the source store (read-only); writes nothing. */
export function planMigration({ sourceRoot, files, source, target, mapping = {} } = {}) {
  for (const [s, n] of [[source, "SOURCE"], [target, "TARGET"]]) { const v = validateSchema(s, n); if (!v.ok) return v; }
  if (!Array.isArray(files) || !files.length || files.length > LIMITS.maxFiles) return { ok: false, reason: "FILES_INVALID" };
  if (files.some(f => !relOk(f))) return { ok: false, reason: "PATH_TRAVERSAL_OR_INVALID_PATH_REFUSED" };
  if (new Set(files.map(f => path.posix.normalize(f))).size !== files.length) return { ok: false, reason: "DUPLICATE_FILE" };
  const np = o => Object.assign(Object.create(null), o ?? {});
  source = { ...source, fields: np(source.fields) }; target = { ...target, fields: np(target.fields) };      // own-property lookups only: a field named "constructor" is data
  const renames = np(mapping.renames), transforms = np(mapping.transforms), defaults = np(mapping.defaults);
  for (const [a, b] of Object.entries(renames)) if (!source.fields[a] || !target.fields[b]) return { ok: false, reason: "RENAME_INVALID:" + clean(a) + "->" + clean(b) };
  if (new Set(Object.values(renames)).size !== Object.keys(renames).length) return { ok: false, reason: "RENAME_TARGETS_NOT_UNIQUE" };
  for (const [f, t] of Object.entries(transforms)) if (!target.fields[f] || !TRANSFORMS.has(t)) return { ok: false, reason: "TRANSFORM_INVALID:" + clean(f) };
  for (const f of Object.keys(defaults)) if (!target.fields[f]) return { ok: false, reason: "DEFAULT_FOR_UNKNOWN_FIELD:" + clean(f) };
  const operations = [], blockers = [], risks = [], ops = { rename: Object.create(null), drop: new Set(), transforms: Object.create(null), add: Object.create(null) };
  const mappedFrom = new Map(), renameTargets = new Set(Object.values(renames));     // target field -> source field
  for (const sf of Object.keys(source.fields).sort()) {
    if (renames[sf]) { mappedFrom.set(renames[sf], sf); ops.rename[sf] = renames[sf]; operations.push({ op: "RENAME_FIELD", from: sf, to: renames[sf], reversible: true }); }
    else if (target.fields[sf] && !renameTargets.has(sf)) mappedFrom.set(sf, sf);
    else { ops.drop.add(sf); operations.push({ op: "DROP_FIELD", field: sf, reversible: false, note: "Values exist only in the backup afterwards." }); risks.push({ level: "HIGH", code: "DATA_LOSS_DROP_FIELD", field: sf }); }
  }
  for (const tf of Object.keys(target.fields).sort()) {
    const d = target.fields[tf], sf = mappedFrom.get(tf);
    if (sf === undefined) {
      const dv = tf in defaults ? defaults[tf] : null;
      if (d.required && dv === null) blockers.push({ code: "REQUIRED_FIELD_WITHOUT_DEFAULT", field: tf });
      else if (!typeOk(d.type, dv)) blockers.push({ code: "DEFAULT_TYPE_MISMATCH", field: tf });
      ops.add[tf] = dv; operations.push({ op: "ADD_FIELD", field: tf, default: dv, reversible: true });
      if (transforms[tf]) blockers.push({ code: "TRANSFORM_ON_NEW_FIELD", field: tf });
      continue;
    }
    const st = source.fields[sf].type, t = transforms[tf];
    if (t) { ops.transforms[tf] = t; operations.push({ op: "TRANSFORM_FIELD", field: tf, transform: t, fromType: st, toType: d.type, reversible: "CHECKED_ON_DATA" }); }
    else if (st !== d.type && d.type !== "any" && !(st === "integer" && d.type === "number")) blockers.push({ code: "TYPE_CHANGE_WITHOUT_TRANSFORM", field: tf, from: st, to: d.type });
    if (d.required && !source.fields[sf].required && !(tf in defaults)) risks.push({ level: "MEDIUM", code: "FIELD_BECOMES_REQUIRED", field: tf });
  }
  const tKey = target.key, sKey = Object.entries(renames).find(([, b]) => b === tKey)?.[0] ?? tKey;
  if (!source.fields[sKey]) blockers.push({ code: "TARGET_KEY_HAS_NO_SOURCE", field: tKey });
  // dry run, in memory
  const fileInfo = [];
  let lossy = 0;
  for (const f of files.map(x => path.posix.normalize(x))) {
    if (!/\.(json|jsonl|ndjson)$/i.test(f)) { blockers.push({ code: "UNSUPPORTED_STORE_FORMAT", file: f }); continue; }
    const raw = readConfined(sourceRoot, f, 16 * 1048576); if (!raw.ok) return { ok: false, reason: "SOURCE_" + raw.reason, file: clean(f) };
    const format = /\.json$/i.test(f) ? "json" : "jsonl";
    if (format === "json" && !raw.text.trimStart().startsWith("[")) { blockers.push({ code: "UNSUPPORTED_JSON_SHAPE_ARRAY_REQUIRED", file: f }); continue; }
    const st = loadStore({ root: sourceRoot, file: f }); if (!st.ok) return { ok: false, reason: "SOURCE_" + st.reason, file: f };
    if (st.malformed.length) blockers.push({ code: "SOURCE_HAS_MALFORMED_ROWS", file: f, count: st.malformed.length, examples: st.malformed.slice(0, LIMITS.maxEvidence) });
    if (st.truncated) blockers.push({ code: "SOURCE_TOO_MANY_RECORDS", file: f });
    const outRecs = [], convErr = [], schemaErr = [], keys = new Map(); let missingKey = 0, fileLossy = 0;
    st.records.forEach((r, i) => {
      const m = migrateRecord(r, ops); outRecs.push(m.out);
      for (const e of m.errors) if (convErr.length < LIMITS.maxEvidence) convErr.push({ row: i, ...e }); else convErr.push(null);
      for (const [tf, d] of Object.entries(target.fields)) { const v = m.out[tf]; if ((d.required && (v === null || v === undefined)) || !typeOk(d.type, v)) { if (schemaErr.length < LIMITS.maxEvidence) schemaErr.push({ row: i, field: tf, reason: d.required && (v === null || v === undefined) ? "REQUIRED_MISSING" : "TYPE_" + d.type }); else schemaErr.push(null); } }
      const k = m.out[tKey]; if (k === null || k === undefined || k === "") missingKey++; else { const s = String(k); keys.set(s, (keys.get(s) ?? 0) + 1); }
      if (canonical(inverseRecord(m.out, ops, r)) !== canonical(Object.fromEntries(Object.entries(r).filter(([x]) => !ops.drop.has(x))))) fileLossy++;
    });
    lossy += fileLossy;
    const dupKeys = [...keys].filter(([, n]) => n > 1).map(([k]) => clean(k));
    if (convErr.length) blockers.push({ code: "CONVERSION_FAILURES", file: f, count: convErr.length, examples: convErr.filter(Boolean) });
    if (schemaErr.length) blockers.push({ code: "TARGET_SCHEMA_VIOLATIONS", file: f, count: schemaErr.length, examples: schemaErr.filter(Boolean) });
    if (dupKeys.length) blockers.push({ code: "DUPLICATE_KEYS_AFTER_MIGRATION", file: f, keys: dupKeys.slice(0, LIMITS.maxEvidence) });
    if (missingKey) blockers.push({ code: "MISSING_KEY_AFTER_MIGRATION", file: f, count: missingKey });
    if (st.records.length > LIMITS.largeDataset) risks.push({ level: "MEDIUM", code: "LARGE_DATASET", file: f, records: st.records.length });
    if (fileLossy) risks.push({ level: "HIGH", code: "LOSSY_TRANSFORM_ON_DATA", file: f, records: fileLossy });
    fileInfo.push({ file: f, format, records: st.records.length, sourceSha256: raw.sha256, expectedOutputSha256: sha256(serialize(format, outRecs)), expectedOutputRecords: outRecs.length });
  }
  for (const o of operations) if (o.reversible === "CHECKED_ON_DATA") o.reversible = lossy === 0;
  const reversible = operations.every(o => o.reversible === true);
  const plan = {
    kind: "MIGRATION_PLAN", dryRun: true, sourceVersion: String(source.version ?? ""), targetVersion: String(target.version ?? ""), key: { source: sKey, target: tKey },
    mapping: { renames: { ...renames }, transforms: { ...transforms }, defaults: { ...defaults } }, files: fileInfo, operations, reversible,
    steps: [
      { step: 1, name: "PRECHECK", detail: "Re-hash every source file; refuse if any differs from sourceSha256 in this plan." },
      { step: 2, name: "BACKUP", detail: "Copy the source files to a backup folder outside source and target, write manifest.json with sha256 per file, re-hash the copies." },
      { step: 3, name: "TRANSFORM_IN_COPY", detail: "Copy source into a fresh work folder and migrate only the copy." },
      { step: 4, name: "VERIFY", detail: "Record counts equal, key sets equal, every record valid against the target schema, output sha256 equal to expectedOutputSha256, inverse round trip for reversible operations, source unchanged." },
      { step: 5, name: "APPLY", detail: "Only with a signed owner approval (" + ACTION + ", subject = planSha256): write outputs tmp+rename." },
      { step: 6, name: "POST_VERIFY", detail: "Re-hash the applied files against the trial output; on mismatch restore from the backup automatically." }
    ],
    rollback: { method: "RESTORE_FROM_CHECKSUMMED_BACKUP", detail: reversible ? "Restore the backup files (manifest sha256 verified) over the migrated files. Operations are also invertible on this data." : "Restore the backup files (manifest sha256 verified). Some operations are NOT invertible (dropped fields / lossy transforms): the backup is the only way back - keep it until the owner releases it." },
    risks, blockers, status: blockers.length ? "BLOCKED" : "READY_FOR_TRIAL"
  };
  return { ok: true, ...plan, planSha256: sha256(canonical(plan)) };
}

const planIntegrity = plan => { if (!plan || plan.kind !== "MIGRATION_PLAN" || typeof plan.planSha256 !== "string") return false; const { ok, planSha256, ...rest } = plan; return sha256(canonical(rest)) === planSha256; };
const ops0 = plan => ({ rename: Object.assign(Object.create(null), plan.mapping.renames), drop: new Set(plan.operations.filter(o => o.op === "DROP_FIELD").map(o => o.field)), transforms: Object.assign(Object.create(null), plan.mapping.transforms), add: Object.assign(Object.create(null), Object.fromEntries(plan.operations.filter(o => o.op === "ADD_FIELD").map(o => [o.field, o.default]))) });
function outsideOf(dir, roots) {     // checked BEFORE the folder is created, so a refused folder is never made inside the data
  let real; try { let anc = path.resolve(dir), rest = []; for (let i = 0; i < 64 && !fs.existsSync(anc); i++) { rest.unshift(path.basename(anc)); anc = path.dirname(anc); } real = path.join(fs.realpathSync(anc), ...rest); } catch { return { ok: false, reason: "DIR_UNAVAILABLE" }; } for (const r of roots) { const rr = realRoot(r); if (rr.ok && (real === rr.real || real.startsWith(rr.real + path.sep) || rr.real.startsWith(real + path.sep))) return { ok: false, reason: "DIR_MUST_BE_OUTSIDE_DATA_FOLDERS" }; }
  try { fs.mkdirSync(real, { recursive: true }); if (fs.realpathSync(real) !== real) return { ok: false, reason: "DIR_UNAVAILABLE" }; } catch { return { ok: false, reason: "DIR_UNAVAILABLE" }; }
  return { ok: true, real }; }

/** Migrate a COPY of the source and verify it. The source is read, hashed and never written. */
export function runMigrationInCopy({ plan, sourceRoot, workDir } = {}) {
  if (!planIntegrity(plan)) return { ok: false, reason: "PLAN_TAMPERED_OR_INVALID" };
  if (plan.blockers.length) return { ok: false, reason: "PLAN_HAS_BLOCKERS", blockers: plan.blockers.map(b => b.code) };
  if (typeof workDir !== "string" || !path.isAbsolute(workDir)) return { ok: false, reason: "WORK_DIR_MUST_BE_ABSOLUTE" };
  const w = outsideOf(workDir, [sourceRoot]); if (!w.ok) return { ok: false, reason: "WORK_" + w.reason };
  const copy = fs.mkdtempSync(path.join(w.real, "mig-" + plan.planSha256.slice(0, 12) + "-")), ops = ops0(plan), files = [];
  let pass = true;
  for (const fi of plan.files) {
    const src = readConfined(sourceRoot, fi.file, 16 * 1048576); if (!src.ok) return { ok: false, reason: "SOURCE_" + src.reason, file: fi.file, copyDir: copy };
    if (src.sha256 !== fi.sourceSha256) return { ok: false, reason: "SOURCE_CHANGED_SINCE_PLAN", file: fi.file, copyDir: copy };
    const cp = path.join(copy, "source", fi.file); fs.mkdirSync(path.dirname(cp), { recursive: true }); fs.writeFileSync(cp, fs.readFileSync(src.abs));
    const st = loadStore({ root: path.join(copy, "source"), file: fi.file }); if (!st.ok || st.sha256 !== fi.sourceSha256) return { ok: false, reason: "COPY_VERIFY_FAILED", file: fi.file, copyDir: copy };
    const out = [], errors = []; let roundTripFailures = 0;
    for (const r of st.records) { const m = migrateRecord(r, ops); out.push(m.out); errors.push(...m.errors); if (canonical(inverseRecord(m.out, ops, r)) !== canonical(Object.fromEntries(Object.entries(r).filter(([x]) => !ops.drop.has(x))))) roundTripFailures++; }
    const text = serialize(fi.format, out), op = path.join(copy, "output", fi.file); fs.mkdirSync(path.dirname(op), { recursive: true }); fs.writeFileSync(op, text);
    const outSha = sha256(fs.readFileSync(op)), keysIn = st.records.map(r => String(r[plan.key.source])).sort(), keysOut = out.map(r => String(r[plan.key.target])).sort();
    const r = { file: fi.file, inCount: st.records.length, outCount: out.length, countsMatch: st.records.length === out.length, keysMatch: canonical(keysIn) === canonical(keysOut), conversionErrors: errors.length, outputSha256: outSha, matchesPlan: outSha === fi.expectedOutputSha256, roundTripFailures, roundTripRequired: plan.reversible };
    r.passed = r.countsMatch && r.keysMatch && !r.conversionErrors && r.matchesPlan && (!plan.reversible || roundTripFailures === 0);
    if (!r.passed) pass = false; files.push(r);
  }
  const sourceUnchanged = plan.files.every(fi => readConfined(sourceRoot, fi.file, 16 * 1048576).sha256 === fi.sourceSha256);
  if (!sourceUnchanged) pass = false;
  return { ok: true, status: pass ? "TRIAL_PASSED" : "TRIAL_FAILED", planSha256: plan.planSha256, copyDir: copy, outputDir: path.join(copy, "output"), files, sourceUnchanged };
}

/** Real apply. Refused without a signed owner approval for DATA_MIGRATION_APPLY bound to planSha256. */
export function applyMigration({ plan, sourceRoot, targetRoot = null, workDir, backupDir, ownerAuth, ownerApproval = null } = {}) {
  if (!ownerAuth || typeof ownerAuth.verifyApproval !== "function") return { ok: false, reason: "OWNER_AUTH_REQUIRED" };
  if (!planIntegrity(plan)) return { ok: false, reason: "PLAN_TAMPERED_OR_INVALID" };
  const pre = ownerAuth.verifyApproval(ownerApproval, { action: ACTION, subject: plan.planSha256, consume: false });
  if (!pre.allowed) return { ok: false, reason: "OWNER_APPROVAL_REQUIRED:" + pre.reason, subject: plan.planSha256 };
  const tRoot = targetRoot ?? sourceRoot, tr = realRoot(tRoot), sr = realRoot(sourceRoot); if (!tr.ok || !sr.ok) return { ok: false, reason: "ROOT_INVALID" };
  if (typeof backupDir !== "string" || !path.isAbsolute(backupDir)) return { ok: false, reason: "BACKUP_DIR_MUST_BE_ABSOLUTE" };
  const b = outsideOf(backupDir, [sourceRoot, tRoot]); if (!b.ok) return { ok: false, reason: "BACKUP_" + b.reason };
  if (typeof workDir !== "string" || !path.isAbsolute(workDir)) return { ok: false, reason: "WORK_DIR_MUST_BE_ABSOLUTE" };
  const wk = outsideOf(workDir, [sourceRoot, tRoot]); if (!wk.ok) return { ok: false, reason: "WORK_" + wk.reason };
  for (const fi of plan.files) { const t = safeRel(tRoot, fi.file, { allowMissingParents: true }); if (!t.ok) return { ok: false, reason: "TARGET_" + t.reason }; if (tr.real !== sr.real && t.exists) return { ok: false, reason: "TARGET_FILE_EXISTS", file: fi.file }; }
  const trial = runMigrationInCopy({ plan, sourceRoot, workDir }); if (!trial.ok) return trial;
  if (trial.status !== "TRIAL_PASSED") return { ok: false, reason: "TRIAL_FAILED", trial };
  const spent = ownerAuth.verifyApproval(ownerApproval, { action: ACTION, subject: plan.planSha256 });         // the approval is consumed only now, right before anything is written
  if (!spent.allowed) return { ok: false, reason: "OWNER_APPROVAL_REQUIRED:" + spent.reason };
  // backup
  const bdir = fs.mkdtempSync(path.join(b.real, "backup-" + plan.planSha256.slice(0, 12) + "-")), manifest = { planSha256: plan.planSha256, files: [] };
  for (const fi of plan.files) { const src = readConfined(sourceRoot, fi.file, 16 * 1048576); if (!src.ok || src.sha256 !== fi.sourceSha256) return { ok: false, reason: "SOURCE_CHANGED_BEFORE_BACKUP", file: fi.file }; const dst = path.join(bdir, "files", fi.file); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, fs.readFileSync(src.abs)); if (sha256(fs.readFileSync(dst)) !== fi.sourceSha256) return { ok: false, reason: "BACKUP_VERIFY_FAILED", file: fi.file }; manifest.files.push({ file: fi.file, sha256: fi.sourceSha256 }); }
  fs.writeFileSync(path.join(bdir, "manifest.json"), JSON.stringify(manifest, null, 2));
  // apply (tmp + rename), then post-verify; any failure restores what was there before
  const written = [];
  const restore = () => { const errs = []; for (const w of written.reverse()) { try { if (w.hadOriginal) { const tmp = w.abs + ".restore-" + process.pid; fs.writeFileSync(tmp, fs.readFileSync(path.join(bdir, "files", w.file))); fs.renameSync(tmp, w.abs); } else fs.rmSync(w.abs, { force: true }); } catch (e) { errs.push({ file: w.file, error: String(e.message).slice(0, 80) }); } } return errs; };
  try {
    for (const fi of plan.files) {
      const t = safeRel(tRoot, fi.file, { allowMissingParents: true }); if (!t.ok) throw new Error("TARGET_" + t.reason);
      fs.mkdirSync(path.dirname(t.abs), { recursive: true });
      const tmp = t.abs + ".migrate-" + process.pid; fs.writeFileSync(tmp, fs.readFileSync(path.join(trial.outputDir, fi.file))); written.push({ file: fi.file, abs: t.abs, hadOriginal: t.exists }); fs.renameSync(tmp, t.abs);
    }
    for (const fi of plan.files) { const t = readConfined(tRoot, fi.file, 32 * 1048576); if (!t.ok || t.sha256 !== fi.expectedOutputSha256) throw new Error("POST_VERIFY_MISMATCH:" + fi.file); }
  } catch (e) {
    const errs = restore();
    return { ok: false, reason: "APPLY_FAILED_RESTORED", error: String(e.message).slice(0, 120), restoreErrors: errs, status: errs.length ? "RESTORE_INCOMPLETE_SEE_BACKUP" : "ROLLED_BACK", backupDir: bdir };
  }
  return { ok: true, status: "APPLIED_HASHES_MATCH_TRIAL", planSha256: plan.planSha256, targetRoot: tr.real, backup: { dir: bdir, manifest }, files: plan.files.map(f => ({ file: f.file, sha256: f.expectedOutputSha256 })), approvalNonce: spent.nonce,
    note: "Outputs match the verified trial byte for byte. This does not show that applications reading the store still work; keep the backup until the owner releases it." };
}
