// Unified programme M3: persistent Markdown memory with a SQLite FTS5 index and local hybrid retrieval.
//
//   TRUTH     Markdown files (one note per file, simple front matter) under <dir>/notes. A human can read and edit them; the index can always be rebuilt from them.
//   INDEX     <dir>/index.sqlite (node:sqlite, built into Node 22; FTS5 BM25) + a local similarity vector per note. If node:sqlite or FTS5 is unavailable, or the database is damaged,
//             the store falls back to / rebuilds an in-memory lexical index and says so (status().backend). Nothing is installed; nothing leaves the machine.
//   RETRIEVAL hybrid = BM25 (FTS5) fused with a local hashed n-gram similarity by reciprocal rank fusion. The similarity part is LEXICAL (character n-grams), NOT a neural embedding:
//             it catches word-form variants and typos, not paraphrases. A real embedding model would be a separate, owner-approved dependency.
//   SAFETY    SECRET-classified or secret-looking content is refused, never stored. Notes carry a classification (PUBLIC < PERSONAL < CONFIDENTIAL); a reader sees only notes at or below its
//             clearance, and hidden notes are invisible (no count, no score, no error that reveals them). Retrieved text is DATA: it is returned fenced and flagged untrusted, never as instructions.
//             Lowering a classification, forgetting a note and restoring need a signed owner approval. External edits to the Markdown files are detected (hash in the front matter) and recorded.
//   AUDIT     writes, updates, declassification, forgetting, external edits, quarantined files and index rebuilds go to a hash-chained log (tamper-evident, not tamper-proof).
// Limits: single tenant per store directory; the tenant id in a file must match or the file is quarantined. Not a vector database; not for secrets (use the vault).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { withFileLock } from "./file-lock.mjs";
import { containsSecret, scrub } from "./secret-patterns.mjs";
import { terms } from "./knowledge-projects.mjs";

export const CLASSES = Object.freeze(["PUBLIC", "PERSONAL", "CONFIDENTIAL"]);      // SECRET exists as a name only so it can be refused
const RANK = Object.freeze({ PUBLIC: 0, PERSONAL: 1, CONFIDENTIAL: 2 });
export const LIMITS = Object.freeze({ maxNotes: 5000, maxBody: 20000, maxTitle: 160, maxTags: 10, maxTag: 32, maxSource: 200, maxQuery: 300, maxResults: 20, passageChars: 400, maxFileBytes: 60000, dim: 256, versionsKept: 20 });
const ID_RE = /^[0-9a-f]{16}$/, AGENT_RE = /^[A-Za-z0-9_.:-]{1,40}$/, TENANT_RE = /^[A-Za-z0-9_.-]{1,40}$/, TAG_RE = /^[\p{L}\p{N}_.-]{1,32}$/u;
const KEYS = ["id", "title", "tags", "classification", "tenant", "author", "source", "createdAt", "updatedAt", "version", "bodySha"];
const sha = t => crypto.createHash("sha256").update(t).digest("hex");
const oneLine = (v, max) => typeof v === "string" && v.length <= max && v.isWellFormed() && !/[\u0000-\u001f\u007f\u2028\u2029\p{Cf}]/u.test(v);
const memorySubject = (id, bodySha, extra = "") => "memory:" + id + ":" + bodySha.slice(0, 16) + extra;
export { memorySubject };

// ---- local similarity vector: signed hashed word + character-trigram features, L2-normalised ----
function embed(text) {
  const v = new Float32Array(LIMITS.dim);
  const add = (feat, w) => { let h = 0x811c9dc5; for (let i = 0; i < feat.length; i++) { h ^= feat.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } v[h % LIMITS.dim] += ((h >>> 9) & 1 ? 1 : -1) * w; };
  for (const w of terms(text).slice(0, 2000)) { add("w:" + w, 1); const p = "^" + w + "$"; for (let i = 0; i + 3 <= p.length; i++) add("t:" + p.slice(i, i + 3), 0.5); }
  let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i]; n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}
const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const vecBuf = v => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const bufVec = b => { const c = Buffer.from(b); return new Float32Array(c.buffer, c.byteOffset, c.byteLength / 4); };

// ---- front matter ----
function render(m, body) { return "---\n" + KEYS.map(k => k + ": " + String(m[k] ?? "")).join("\n") + "\n---\n" + body; }
function parse(text) {
  if (typeof text !== "string" || !text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4); if (end < 0) return null;
  const meta = Object.create(null);
  for (const line of text.slice(4, end).split("\n")) { const i = line.indexOf(": "); if (i < 1) { if (line === "") continue; return null; } const k = line.slice(0, i); if (!KEYS.includes(k) || k in meta) return null; meta[k] = line.slice(i + 2); }
  if (!KEYS.every(k => k in meta)) return null;
  return { meta, body: text.slice(end + 5) };
}
function validateMeta(m, tenant) {
  if (!ID_RE.test(m.id) || !oneLine(m.title, LIMITS.maxTitle) || !m.title.trim()) return "TITLE_OR_ID";
  if (!(m.classification in RANK)) return "CLASSIFICATION";
  if (m.tenant !== tenant) return "TENANT";
  if (!AGENT_RE.test(m.author) || !oneLine(m.source, LIMITS.maxSource)) return "AUTHOR_OR_SOURCE";
  const tags = m.tags === "" ? [] : m.tags.split(", ");
  if (tags.length > LIMITS.maxTags || !tags.every(t => TAG_RE.test(t))) return "TAGS";
  if (!Number.isFinite(Date.parse(m.createdAt)) || !Number.isFinite(Date.parse(m.updatedAt)) || !/^[1-9][0-9]{0,5}$/.test(m.version) || !/^[0-9a-f]{64}$/.test(m.bodySha)) return "FIELDS";
  return null;
}

// ---- index backends ----
function openSqlite(file) {
  const sqlite = typeof process.getBuiltinModule === "function" ? process.getBuiltinModule("node:sqlite") : null;      // synchronous and built in (Node >= 22.3); undefined where the runtime lacks it
  if (!sqlite?.DatabaseSync) throw new Error("NODE_SQLITE_UNAVAILABLE");
  const { DatabaseSync } = sqlite;
  const open = () => new DatabaseSync(file);
  let db = open();
  const check = d => { const r = d.prepare("PRAGMA quick_check").all(); return r.length === 1 && Object.values(r[0])[0] === "ok"; };
  let rebuiltFromDamage = false;
  try { if (!check(db)) throw new Error("damaged"); }
  catch { try { db.close(); } catch { /* closed */ } for (const x of ["", "-wal", "-shm", "-journal"]) { try { fs.unlinkSync(file + x); } catch { /* none */ } } db = open(); rebuiltFromDamage = true; }
  db.exec("CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, title TEXT, tags TEXT, classification TEXT, author TEXT, updated TEXT, body_sha TEXT, mtime REAL, size INTEGER, vec BLOB)");
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(id UNINDEXED, title, tags, body, tokenize='unicode61 remove_diacritics 2')");
  const q = {
    del: db.prepare("DELETE FROM notes WHERE id = ?"), delFts: db.prepare("DELETE FROM notes_fts WHERE id = ?"),
    ins: db.prepare("INSERT INTO notes(id,title,tags,classification,author,updated,body_sha,mtime,size,vec) VALUES(?,?,?,?,?,?,?,?,?,?)"), insFts: db.prepare("INSERT INTO notes_fts(id,title,tags,body) VALUES(?,?,?,?)"),
    all: db.prepare("SELECT id,title,tags,classification,author,updated,body_sha,mtime,size,vec FROM notes"),
    match: db.prepare("SELECT id, bm25(notes_fts, 0.0, 6.0, 3.0, 1.0) AS s FROM notes_fts WHERE notes_fts MATCH ? ORDER BY s LIMIT ?")
  };
  return {
    backend: "SQLITE_FTS5", rebuiltFromDamage,
    upsert(r) { db.exec("BEGIN"); try { q.del.run(r.id); q.delFts.run(r.id); q.ins.run(r.id, r.title, r.tags.join(" "), r.classification, r.author, r.updated, r.bodySha, r.mtime, r.size, vecBuf(r.vec)); q.insFts.run(r.id, r.title, r.tags.join(" "), r.body); db.exec("COMMIT"); } catch (e) { try { db.exec("ROLLBACK"); } catch { /* none */ } throw e; } },
    remove(id) { q.del.run(id); q.delFts.run(id); },
    clear() { db.exec("DELETE FROM notes; DELETE FROM notes_fts"); },
    rows() { return q.all.all().map(x => ({ id: x.id, title: x.title, tags: x.tags ? x.tags.split(" ") : [], classification: x.classification, author: x.author, updated: x.updated, bodySha: x.body_sha, mtime: x.mtime, size: x.size, vec: bufVec(x.vec) })); },
    lexical(qterms, limit) { const expr = qterms.map(t => '"' + t.replace(/"/g, '""') + '"').join(" OR "); try { return q.match.all(expr, limit).map(x => ({ id: x.id, score: -x.s })); } catch { return []; } },
    close() { try { db.close(); } catch { /* closed */ } }
  };
}
function openMemoryIndex() {
  const m = new Map();
  return {
    backend: "MEMORY_LEXICAL", rebuiltFromDamage: false,
    upsert(r) { m.set(r.id, { ...r, tokens: terms(r.title + " " + r.tags.join(" ") + " " + r.body) }); },
    remove(id) { m.delete(id); }, clear() { m.clear(); },
    rows() { return [...m.values()].map(({ tokens, body, ...x }) => x); },
    lexical(qterms, limit) {
      const N = m.size || 1, df = new Map(); for (const r of m.values()) for (const t of new Set(r.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
      const out = [];
      for (const r of m.values()) { let s = 0; const len = r.tokens.length || 1; for (const t of qterms) { const f = r.tokens.filter(x => x === t).length; if (!f) continue; const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5)); s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * len / 200)); } if (s > 0) out.push({ id: r.id, score: s }); }
      return out.sort((a, b) => b.score - a.score).slice(0, limit);
    },
    close() { /* nothing */ }
  };
}

export function createMemoryStore({ dir, tenantId = "JOCI", ownerAuth = null, forceBackend = null, maxNotes = LIMITS.maxNotes, isStopped = () => false, nowFn = () => new Date().toISOString() } = {}) {
  if (!dir) throw new Error("MEMORY_DIR_REQUIRED");
  if (!TENANT_RE.test(tenantId)) throw new Error("MEMORY_TENANT_INVALID");
  const notesDir = path.join(dir, "notes"), versionsDir = path.join(dir, "versions"), trashDir = path.join(dir, "trash"), quarDir = path.join(dir, "quarantine");
  for (const d of [dir, notesDir, versionsDir, trashDir, quarDir]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const audit = createAuditChain({ filePath: path.join(dir, "memory-audit.jsonl") });
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };
  const stats = { searches: 0, hidden: 0 };
  const writeAtomic = (file, data) => { const t = file + "." + crypto.randomBytes(4).toString("hex") + ".tmp"; let fd; try { fd = fs.openSync(t, "wx", 0o600); fs.writeSync(fd, data); fs.fsyncSync(fd); fs.closeSync(fd); fd = null; fs.renameSync(t, file); } catch (e) { if (fd != null) { try { fs.closeSync(fd); } catch { /* closed */ } } try { fs.unlinkSync(t); } catch { /* none */ } throw e; } };

  let index = null, vecs = new Map(), recs = new Map(), dirStamp = "";
  const openIndex = () => {
    if (forceBackend !== "memory") { try { return openSqlite(path.join(dir, "index.sqlite")); } catch { /* node:sqlite or FTS5 unavailable */ } }
    return openMemoryIndex();
  };
  index = openIndex();
  const stampOf = () => { try { const names = fs.readdirSync(notesDir).filter(n => n.endsWith(".md")); return names.length + ":" + fs.statSync(notesDir).mtimeMs + ":" + names.map(n => { const s = fs.statSync(path.join(notesDir, n)); return n + s.mtimeMs + s.size; }).join(""); } catch { return "x"; } };

  /** Parse one note file into a record, or null (quarantined). */
  function readNote(file) {
    let st, text;
    try { st = fs.lstatSync(file); if (!st.isFile() || st.isSymbolicLink() || st.size > LIMITS.maxFileBytes) return { bad: "FILE_KIND_OR_SIZE" }; text = fs.readFileSync(file, "utf8"); } catch { return { bad: "UNREADABLE" }; }
    const p = parse(text); if (!p) return { bad: "FRONT_MATTER" };
    const why = validateMeta(p.meta, tenantId); if (why) return { bad: why };
    if (path.basename(file) !== p.meta.id + ".md") return { bad: "NAME_MISMATCH" };
    if (p.body.length > LIMITS.maxBody) return { bad: "BODY_TOO_LARGE" };
    const m = p.meta, bodyOk = sha(p.body) === m.bodySha;
    return { rec: { id: m.id, title: m.title, tags: m.tags === "" ? [] : m.tags.split(", "), classification: m.classification, author: m.author, source: m.source, created: m.createdAt, updated: m.updatedAt, version: Number(m.version), bodySha: sha(p.body), body: p.body, mtime: st.mtimeMs, size: st.size, vec: embed(m.title + " " + m.tags + " " + p.body) }, edited: !bodyOk };
  }
  const quarantine = (file, why) => {
    const name = path.basename(file);
    try { fs.renameSync(file, path.join(quarDir, Date.now() + "-" + crypto.randomBytes(3).toString("hex") + "-" + name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60))); } catch { /* left in place; it stays out of the index */ }
    try { audit.append("MEMORY_QUARANTINED", { file: name.slice(0, 80), why }); } catch { /* reported by status */ }
  };
  const loadRecs = () => { recs = new Map(); vecs = new Map(); for (const r of index.rows()) { recs.set(r.id, r); vecs.set(r.id, r.vec); } };

  /** Bring the index in line with the files: new/changed files are (re)read, vanished ones removed, broken ones quarantined, hand edits recorded. */
  function sync(force = false) {
    const st = stampOf(); if (!force && st === dirStamp) return;
    const names = fs.readdirSync(notesDir).filter(n => n.endsWith(".md") && !n.includes(".tmp")), seen = new Set(); let changed = 0;
    for (const n of names) {
      const file = path.join(notesDir, n), id = n.slice(0, -3);
      let s; try { s = fs.statSync(file); } catch { continue; }
      const known = recs.get(id);
      if (!force && known && known.mtime === s.mtimeMs && known.size === s.size) { seen.add(id); continue; }
      const r = readNote(file);
      if (r.bad) { quarantine(file, r.bad); continue; }
      if (r.edited) { try { audit.append("MEMORY_EXTERNAL_EDIT", { id: r.rec.id, newBodySha: r.rec.bodySha }); } catch { /* ignore */ } }
      if (recs.size >= maxNotes && !known) { quarantine(file, "NOTE_LIMIT"); continue; }
      index.upsert(r.rec); seen.add(r.rec.id); changed++;
    }
    for (const id of [...recs.keys()]) if (!seen.has(id)) { index.remove(id); changed++; }
    loadRecs(); dirStamp = stampOf();
    return changed;
  }
  if (index.rebuiltFromDamage) { index.clear(); try { audit.append("MEMORY_INDEX_REBUILT", { reason: "DATABASE_DAMAGED" }); } catch { /* ignore */ } }
  sync(true);

  const readerOk = r => r && typeof r === "object" && typeof r.id === "string" && AGENT_RE.test(r.id) && typeof r.clearance === "string" && r.clearance in RANK;
  const canSee = (rec, reader) => RANK[rec.classification] <= RANK[reader.clearance];
  const lock = fn => withFileLock(path.join(dir, "memory"), fn);

  // ---------------------------------------------------------------- write
  function write({ authorId, title, body, tags = [], classification = "PERSONAL", source = "" } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    if (typeof authorId !== "string" || !AGENT_RE.test(authorId)) return fail("AUTHOR_INVALID");
    if (classification === "SECRET") return fail("SECRET_NOT_STORABLE_USE_THE_VAULT");
    if (!(classification in RANK)) return fail("CLASSIFICATION_INVALID");
    if (!oneLine(title, LIMITS.maxTitle) || !title.trim()) return fail("TITLE_INVALID");
    if (typeof body !== "string" || !body.trim() || body.length > LIMITS.maxBody || !body.isWellFormed() || body.includes("\0")) return fail("BODY_INVALID");
    if (!Array.isArray(tags) || tags.length > LIMITS.maxTags || !tags.every(t => typeof t === "string" && TAG_RE.test(t))) return fail("TAGS_INVALID");
    if (!oneLine(source, LIMITS.maxSource)) return fail("SOURCE_INVALID");
    if (containsSecret(title) || containsSecret(body) || containsSecret(source)) return fail("SECRET_DETECTED_NOT_STORED");
    try {
      return lock(() => {
        sync();
        if (recs.size >= maxNotes) return fail("MEMORY_FULL");
        const bodySha = sha(body);
        for (const r of recs.values()) if (r.bodySha === bodySha) return fail("DUPLICATE_OF:" + r.id);
        const id = crypto.randomBytes(8).toString("hex"), t = nowFn();
        const meta = { id, title: title.trim(), tags: [...new Set(tags)].join(", "), classification, tenant: tenantId, author: authorId, source, createdAt: t, updatedAt: t, version: "1", bodySha };
        const file = path.join(notesDir, id + ".md"); writeAtomic(file, render(meta, body));
        audit.append("MEMORY_WRITTEN", { id, authorId, classification, bodySha, title: meta.title.slice(0, 80) });
        sync(); return { ok: true, id, version: 1 };
      });
    } catch (e) { return fail(e?.message === "LOCK_TIMEOUT" ? "MEMORY_BUSY" : "WRITE_ERROR"); }
  }

  // ---------------------------------------------------------------- update (old version kept; lowering the classification needs the owner)
  function update(id, patch = {}, { ownerApproval = null } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    if (typeof id !== "string" || !ID_RE.test(id)) return fail("ID_INVALID");
    if (typeof patch.authorId !== "string" || !AGENT_RE.test(patch.authorId)) return fail("AUTHOR_INVALID");
    try {
      return lock(() => {
        sync(); const cur = recs.get(id); if (!cur) return fail("NOT_FOUND");
        const reader = { id: patch.authorId, clearance: patch.clearance };
        if (!readerOk(reader) || !canSee(cur, reader)) return fail("NOT_FOUND");      // an agent that cannot read a note cannot change it, and cannot tell it exists
        const parsed = readNote(path.join(notesDir, id + ".md")); if (parsed.bad) return fail("NOTE_UNREADABLE");
        const cls = patch.classification ?? cur.classification;
        if (cls === "SECRET") return fail("SECRET_NOT_STORABLE_USE_THE_VAULT");
        if (!(cls in RANK)) return fail("CLASSIFICATION_INVALID");
        const title = patch.title ?? cur.title, body = patch.body ?? parsed.rec.body, tags = patch.tags ?? cur.tags, source = patch.source ?? parsed.rec.source;
        if (!oneLine(title, LIMITS.maxTitle) || !title.trim()) return fail("TITLE_INVALID");
        if (typeof body !== "string" || !body.trim() || body.length > LIMITS.maxBody || !body.isWellFormed() || body.includes("\0")) return fail("BODY_INVALID");
        if (!Array.isArray(tags) || tags.length > LIMITS.maxTags || !tags.every(t => typeof t === "string" && TAG_RE.test(t))) return fail("TAGS_INVALID");
        if (!oneLine(source, LIMITS.maxSource)) return fail("SOURCE_INVALID");
        if (containsSecret(title) || containsSecret(body) || containsSecret(source)) return fail("SECRET_DETECTED_NOT_STORED");
        const bodySha = sha(body);
        if (RANK[cls] < RANK[cur.classification]) {
          if (!ownerAuth) return fail("OWNER_AUTH_REQUIRED");
          const v = ownerAuth.verifyApproval(ownerApproval, { action: "MEMORY_DECLASSIFY", subject: memorySubject(id, cur.bodySha, ":" + cur.classification + ">" + cls) });
          if (!v.allowed) return fail("OWNER_APPROVAL_REQUIRED:" + v.reason);
          audit.append("MEMORY_DECLASSIFIED", { id, from: cur.classification, to: cls, nonce: v.nonce });
        }
        const version = parsed.rec.version + 1, t = nowFn();
        fs.copyFileSync(path.join(notesDir, id + ".md"), path.join(versionsDir, id + ".v" + parsed.rec.version + ".md"));
        const old = fs.readdirSync(versionsDir).filter(n => n.startsWith(id + ".v")).sort((a, b) => Number(a.slice(id.length + 2, -3)) - Number(b.slice(id.length + 2, -3)));
        for (const n of old.slice(0, Math.max(0, old.length - LIMITS.versionsKept))) { try { fs.unlinkSync(path.join(versionsDir, n)); } catch { /* gone */ } }
        const meta = { id, title: title.trim(), tags: [...new Set(tags)].join(", "), classification: cls, tenant: tenantId, author: parsed.rec.author, source, createdAt: parsed.rec.created, updatedAt: t, version: String(version), bodySha };
        writeAtomic(path.join(notesDir, id + ".md"), render(meta, body));
        audit.append("MEMORY_UPDATED", { id, by: patch.authorId, version, classification: cls, bodySha });
        sync(); return { ok: true, id, version };
      });
    } catch (e) { return fail(e?.message === "LOCK_TIMEOUT" ? "MEMORY_BUSY" : "UPDATE_ERROR"); }
  }

  // ---------------------------------------------------------------- forget (owner only; the file goes to trash, it is not destroyed)
  function forget(id, { ownerApproval = null } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    if (typeof id !== "string" || !ID_RE.test(id)) return fail("ID_INVALID");
    if (!ownerAuth) return fail("OWNER_AUTH_REQUIRED");
    try {
      return lock(() => {
        sync(); const cur = recs.get(id); if (!cur) return fail("NOT_FOUND");
        const v = ownerAuth.verifyApproval(ownerApproval, { action: "MEMORY_FORGET", subject: memorySubject(id, cur.bodySha) });
        if (!v.allowed) return fail("OWNER_APPROVAL_REQUIRED:" + v.reason, { subject: memorySubject(id, cur.bodySha) });
        fs.renameSync(path.join(notesDir, id + ".md"), path.join(trashDir, id + "." + Date.now() + ".md"));
        audit.append("MEMORY_FORGOTTEN", { id, bodySha: cur.bodySha, nonce: v.nonce });
        sync(); return { ok: true, id, note: "moved to the trash folder; the owner can restore it by moving the file back" };
      });
    } catch (e) { return fail(e?.message === "LOCK_TIMEOUT" ? "MEMORY_BUSY" : "FORGET_ERROR"); }
  }

  // ---------------------------------------------------------------- read / list / search
  const fence = (rec, text) => "<<UNTRUSTED_MEMORY id=" + rec.id + " classification=" + rec.classification + " author=" + rec.author + ">>\n" + text + "\n<<END_UNTRUSTED_MEMORY>>";
  function get(id, reader) {
    if (!readerOk(reader)) return fail("READER_INVALID");
    if (typeof id !== "string" || !ID_RE.test(id)) return fail("NOT_FOUND");
    sync(); const rec = recs.get(id);
    if (!rec || !canSee(rec, reader)) { if (rec) stats.hidden++; return fail("NOT_FOUND"); }      // hidden and missing look identical
    const p = readNote(path.join(notesDir, id + ".md")); if (p.bad) return fail("NOT_FOUND");
    return { ok: true, untrusted: true, id, title: rec.title, tags: rec.tags, classification: rec.classification, author: rec.author, source: p.rec.source, version: p.rec.version, updated: rec.updated, text: fence(rec, scrub(p.rec.body)) };
  }
  function list(reader, { limit = 50 } = {}) {
    if (!readerOk(reader)) return fail("READER_INVALID");
    sync(); const n = Math.max(1, Math.min(200, Number.isInteger(limit) ? limit : 50));
    return { ok: true, notes: [...recs.values()].filter(r => canSee(r, reader)).sort((a, b) => (a.updated < b.updated ? 1 : -1)).slice(0, n).map(r => ({ id: r.id, title: r.title, tags: r.tags, classification: r.classification, updated: r.updated })) };
  }
  function search({ query, reader, limit = 5 } = {}) {
    if (!readerOk(reader)) return fail("READER_INVALID");
    if (typeof query !== "string" || !query.trim() || query.length > LIMITS.maxQuery || !query.isWellFormed()) return fail("QUERY_INVALID");
    const qterms = [...new Set(terms(query))].slice(0, 12); if (!qterms.length) return fail("QUERY_HAS_NO_SEARCHABLE_TERMS");
    sync(); stats.searches++;
    const visible = new Set([...recs.values()].filter(r => canSee(r, reader)).map(r => r.id));
    const n = Math.max(1, Math.min(LIMITS.maxResults, Number.isInteger(limit) ? limit : 5));
    const lex = index.lexical(qterms, 200).filter(x => visible.has(x.id)).slice(0, 50);
    const qv = embed(query), sem = [];
    for (const id of visible) { const c = cosine(qv, vecs.get(id)); if (c > 0.2) sem.push({ id, score: c }); }
    sem.sort((a, b) => b.score - a.score); sem.length = Math.min(sem.length, 50);
    const fused = new Map();
    const add = (list, key) => list.forEach((x, i) => { const e = fused.get(x.id) ?? { id: x.id, rrf: 0, lexical: null, similarity: null }; e.rrf += 1 / (60 + i + 1); e[key] = x.score; fused.set(x.id, e); });
    add(lex, "lexical"); add(sem, "similarity");
    const top = [...fused.values()].sort((a, b) => b.rrf - a.rrf).slice(0, n);
    const results = top.map(h => {
      const rec = recs.get(h.id), p = readNote(path.join(notesDir, h.id + ".md")); if (p.bad) return null;
      const body = scrub(p.rec.body), low = body.toLowerCase(); let at = -1; for (const t of qterms) { const i = low.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
      const start = Math.max(0, (at < 0 ? 0 : at) - 80), passage = body.slice(start, start + LIMITS.passageChars);
      return { id: rec.id, title: rec.title, classification: rec.classification, tags: rec.tags, score: Number(h.rrf.toFixed(5)), lexical: h.lexical, similarity: h.similarity === null ? null : Number(h.similarity.toFixed(3)), passage: fence(rec, passage), externallyEdited: p.edited === true };
    }).filter(Boolean);
    return { ok: true, untrusted: true, backend: index.backend, retrieval: "HYBRID_BM25_PLUS_LEXICAL_NGRAM_SIMILARITY (not neural embeddings)", results };
  }

  // ---------------------------------------------------------------- maintenance
  function rebuildIndex({ reason = "MANUAL" } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    try { return lock(() => { index.clear(); recs = new Map(); vecs = new Map(); dirStamp = ""; const changed = sync(true); audit.append("MEMORY_INDEX_REBUILT", { reason: String(reason).slice(0, 40), notes: recs.size }); return { ok: true, notes: recs.size, changed }; }); }
    catch { return fail("REBUILD_ERROR"); }
  }
  /** Compare every file with the index and the recorded hash. Read-only. */
  function verify() {
    sync(true);
    let edited = 0, bad = 0, files = 0;
    for (const n of fs.readdirSync(notesDir).filter(x => x.endsWith(".md"))) { files++; const r = readNote(path.join(notesDir, n)); if (r.bad) bad++; else if (r.edited) edited++; }
    return { ok: true, files, indexed: recs.size, externallyEdited: edited, unreadable: bad, consistent: files === recs.size && bad === 0, backend: index.backend, auditOk: audit.verify().ok };
  }
  const status = () => { sync(); const c = {}; for (const r of recs.values()) c[r.classification] = (c[r.classification] ?? 0) + 1; return { backend: index.backend, notes: recs.size, byClassification: c, searches: stats.searches, hiddenAttempts: stats.hidden, quarantined: fs.readdirSync(quarDir).length, trashed: fs.readdirSync(trashDir).length, auditHead: audit.head() }; };
  return { write, update, forget, get, list, search, rebuildIndex, verify, status, auditVerify: () => audit.verify(), auditEntries: () => audit.entries(), close: () => index.close() };
}
