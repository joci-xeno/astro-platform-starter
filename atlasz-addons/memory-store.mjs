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
import { containsSecret, scrub, foldLookalikes } from "./secret-patterns.mjs";
import { terms } from "./knowledge-projects.mjs";
import { createSemanticIndex } from "./semantic-index.mjs";
import { providerFingerprint, isNeural } from "./embedding-provider.mjs";

export const CLASSES = Object.freeze(["PUBLIC", "PERSONAL", "CONFIDENTIAL"]);      // SECRET exists as a name only so it can be refused
const RANK = Object.freeze({ PUBLIC: 0, PERSONAL: 1, CONFIDENTIAL: 2 });
export const LIMITS = Object.freeze({ maxNotes: 5000, maxBody: 20000, maxTitle: 160, maxTags: 10, maxTag: 32, maxSource: 200, maxQuery: 300, maxResults: 20, passageChars: 400, maxFileBytes: 60000, dim: 256, versionsKept: 20 });
const ID_RE = /^[0-9a-f]{16}$/, AGENT_RE = /^[A-Za-z0-9_.:-]{1,40}$/, TENANT_RE = /^[A-Za-z0-9_.-]{1,40}$/, TAG_RE = /^[\p{L}\p{N}_.-]{1,32}$/u;
const KEYS = ["id", "title", "tags", "classification", "tenant", "author", "source", "createdAt", "updatedAt", "version", "bodySha"];
const isClass = c => typeof c === "string" && Object.hasOwn(RANK, c);
const bodyBad = b => typeof b !== "string" || !b.trim() || b.length > LIMITS.maxBody || Buffer.byteLength(b) > 50000 || !b.isWellFormed() || b.includes("\0");
// NAME = value detection. Names: password/passphrase/pwd/passwort/jelszo/kennwort, secret, token, credential, api key, access/secret/private/signing/encryption/auth/client/master key, short pw; with up to
// three short prefix segments (db_password, client_secret, AWS_SECRET_ACCESS_KEY). camelCase is split first (secretKey -> secret_Key). The prefix is bounded and needs a separator, so the scan is linear in the text
// and "bypass" / "compass" are not names.
const NAME_CORE = "(?:pass(?:word|wd|phrase|wort)?|pwd|secret|token|credential|api[_-]?key|apikey|(?:access|secret|private|signing|encryption|auth|client|master)[_-]key|kennwort|jelsz[o\\u00f3])s?";
const NAMES = "((?:[a-z0-9]{1,20}[_.-]){0,3}" + NAME_CORE + "(?![a-z])|pw(?![a-z]))";
const VAL = "(?:\"([^\"\\n]{6,120})\"|'([^'\\n]{6,120})'|([^\\s\"',;)}\\]]{6,120}))";
const ASSIGN_RE = new RegExp("(?<![A-Za-z0-9])" + NAMES + "[\"']?\\s*(?:(:)|(=>?|->)|\\s+(?:is|was)\\s+)\\s*" + VAL, "gi");
const hasSymbol = v => /[@#$%^&*_+=\[\]{}|\\<>\/~`]/.test(v);
/** Does the value after NAME look like a credential? "=" / "->" assignments are stricter than prose-like "name: value" and "name is value". */
const credLike = (name, assign, v, rest) => {
  if (hasSymbol(v)) return true;
  const hasDigit = /\d/.test(v), hasLetter = /\p{L}/u.test(v);
  if (hasDigit && hasLetter) return true;
  if (hasDigit) return assign || (/pass|pwd/i.test(name) && v.length >= 6 && /^\d+$/.test(v));
  if (!/\s/.test(v) && /^[A-Za-z]{10,}$/.test(v)) {
    if (assign) return true;
    return /pass|pwd|jelsz|kennwort/i.test(name) && !/^\s*\p{L}{2,}\b/u.test(rest);      // "Password: correcthorsebatterystaple" is a secret; "Password: requirements apply to all staff" is prose
  }
  return false;
};
/** NAME=value / "NAME": "value" where the value looks like a credential. Runs on normalised text (NFKC, look-alike letters folded, hidden characters removed), like containsSecret. */
const assignsSecret = raw => {
  if (typeof raw !== "string" && raw != null) raw = String(raw);
  const t = foldLookalikes(String(raw ?? "").normalize("NFKC").replace(/[\p{Cf}\u00ad]/gu, "")).replace(/([a-z0-9])([A-Z])/g, "$1_$2"); ASSIGN_RE.lastIndex = 0;
  for (const m of t.matchAll(ASSIGN_RE)) {
    const name = m[1] ?? "", bare = name.toLowerCase().replace(/^.*[_.-]/, ""), assign = Boolean(m[3]), v = m[4] ?? m[5] ?? m[6] ?? "";
    if (!assign && /^pass$/i.test(bare)) continue;      // "Boarding pass: 2024-01-15" is prose; password/pwd/passphrase are not
    if (credLike(name, assign, v, t.slice(m.index + m[0].length, m.index + m[0].length + 40))) return true;
  }
  return false;
};
const sensitive = t => containsSecret(t) || assignsSecret(t);
const sha = t => crypto.createHash("sha256").update(t).digest("hex");
const oneLine = (v, max) => typeof v === "string" && v.length <= max && v.isWellFormed() && !/[\u0000-\u001f\u007f\u2028\u2029\p{Cf}]/u.test(v);
const memorySubject = (id, bodySha, extra = "") => "memory:" + id + ":" + bodySha.slice(0, 16) + extra;
/** Subject of the owner approval for a retention sweep: bound to the exact set of notes, so an approval cannot be reused for a different set. */
export const retentionSubject = items => "retention:" + sha([...items].sort().join(",")).slice(0, 24) + ":" + items.length;      // items are "id:bodySha16" strings: an approval covers these exact texts
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
  if (!isClass(m.classification)) return "CLASSIFICATION";
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
  let rebuiltFromDamage = false, inBatch = false;
  try { if (!check(db)) throw new Error("damaged"); }
  catch (e) { if (/locked|busy/i.test(String(e?.message))) { try { db.close(); } catch { /* closed */ } throw e; }      // another process holds the index: that is not damage, never delete a live database
    try { db.close(); } catch { /* closed */ } for (const x of ["", "-wal", "-shm", "-journal"]) { try { fs.unlinkSync(file + x); } catch { /* none */ } } db = open(); rebuiltFromDamage = true; }
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
    batch(fn) { db.exec("BEGIN"); inBatch = true; try { fn(); db.exec("COMMIT"); } catch (e) { try { db.exec("ROLLBACK"); } catch { /* none */ } throw e; } finally { inBatch = false; } },
    upsert(r) { if (inBatch) { q.del.run(r.id); q.delFts.run(r.id); q.ins.run(r.id, r.title, r.tags.join(" "), r.classification, r.author, r.updated, r.bodySha, r.mtime, r.size, vecBuf(r.vec)); q.insFts.run(r.id, r.title, r.tags.join(" "), r.body); return; } db.exec("BEGIN"); try { q.del.run(r.id); q.delFts.run(r.id); q.ins.run(r.id, r.title, r.tags.join(" "), r.classification, r.author, r.updated, r.bodySha, r.mtime, r.size, vecBuf(r.vec)); q.insFts.run(r.id, r.title, r.tags.join(" "), r.body); db.exec("COMMIT"); } catch (e) { try { db.exec("ROLLBACK"); } catch { /* none */ } throw e; } },
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
    batch(fn) { fn(); },
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

export function createMemoryStore({ dir, tenantId = "JOCI", ownerAuth = null, forceBackend = null, semanticProvider = null, maxNotes = LIMITS.maxNotes, isStopped = () => false, nowFn = () => new Date().toISOString() } = {}) {
  if (!dir) throw new Error("MEMORY_DIR_REQUIRED");
  if (!TENANT_RE.test(tenantId)) throw new Error("MEMORY_TENANT_INVALID");
  const notesDir = path.join(dir, "notes"), versionsDir = path.join(dir, "versions"), trashDir = path.join(dir, "trash"), quarDir = path.join(dir, "quarantine");
  for (const d of [dir, notesDir, versionsDir, trashDir, quarDir]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const audit = createAuditChain({ filePath: path.join(dir, "memory-audit.jsonl") });
  // Last audited classification per note: a hand edit of the file can raise a class but never lower it (lowering needs the signed approval path).
  const floor = new Map(), flagged = new Map();
  const noteFloor = (id, cls) => { if (isClass(cls)) floor.set(id, cls); };
  // The floor follows the audit chain, which other processes (runtime / Control Center) also append to: re-read it whenever the index is brought up to date, so a signed declassify done elsewhere
  // lowers the floor here and a hand edit still cannot.
  let floorSeen = 0;
  const refreshFloor = () => { try { audit.reload(); } catch { /* a tampered chain is reported by verify(); keep the floor we have */ } if (audit.length() === floorSeen) return; const es = audit.entries(); for (let i = floorSeen; i < es.length; i++) { const e = es[i], d = e.data ?? {}; if ((e.event === "MEMORY_WRITTEN" || e.event === "MEMORY_UPDATED") && ID_RE.test(String(d.id))) noteFloor(d.id, d.classification); } floorSeen = es.length; };
  refreshFloor();
  const auditNow = () => { try { audit.reload(); } catch (e) { return { ok: false, reason: String(e?.message ?? e).slice(0, 80) }; } return audit.verify(); };
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
    refreshFloor();
    const names = fs.readdirSync(notesDir).filter(n => n.endsWith(".md") && !n.includes(".tmp")), seen = new Set(); let changed = 0, total = recs.size;
    index.batch(() => { for (const n of names) {
      const file = path.join(notesDir, n), id = n.slice(0, -3);
      let s; try { s = fs.statSync(file); } catch { continue; }
      const known = recs.get(id);
      if (!force && known && known.mtime === s.mtimeMs && known.size === s.size) { seen.add(id); continue; }
      const r = readNote(file);
      if (r.bad) { quarantine(file, r.bad); continue; }
      const flagKey = r.rec.mtime + ":" + r.rec.size, fl = floor.get(r.rec.id), fresh = flagged.get(r.rec.id) !== flagKey; flagged.set(r.rec.id, flagKey);
      if (fl && RANK[r.rec.classification] < RANK[fl]) { if (fresh) try { audit.append("MEMORY_EXTERNAL_DECLASSIFY_IGNORED", { id: r.rec.id, fileClass: r.rec.classification, keptClass: fl }); } catch { /* ignore */ } r.rec.classification = fl; r.rec.classMismatch = true; }
      if (r.edited && fresh) { try { audit.append("MEMORY_EXTERNAL_EDIT", { id: r.rec.id, newBodySha: r.rec.bodySha }); } catch { /* ignore */ } }
      if (total >= maxNotes && !known) { quarantine(file, "NOTE_LIMIT"); continue; }
      index.upsert(r.rec); seen.add(r.rec.id); changed++; if (!known) total++;
    } });
    for (const row of index.rows()) if (!seen.has(row.id)) { index.remove(row.id); changed++; }      // also rows left behind by files that vanished while the store was closed
    loadRecs(); dirStamp = stampOf();
    return changed;
  }
  if (index.rebuiltFromDamage) { index.clear(); try { audit.append("MEMORY_INDEX_REBUILT", { reason: "DATABASE_DAMAGED" }); } catch { /* ignore */ } }

  const readerOk = r => r && typeof r === "object" && typeof r.id === "string" && AGENT_RE.test(r.id) && typeof r.clearance === "string" && isClass(r.clearance) && (r.allow === undefined || typeof r.allow === "function");
  const syncRead = (force = false) => { if (!force && stampOf() === dirStamp) return; try { lock(() => sync(force)); } catch { /* another process holds the index: keep serving the last consistent view */ } };
  // Beyond the classification ceiling a reader may carry an `allow` predicate (agent-private / project scopes). It sees a frozen minimal view and can only NARROW access; an exception denies.
  const canSee = (rec, reader) => {
    if (!(RANK[rec.classification] <= RANK[reader.clearance])) return false;
    if (typeof reader.allow !== "function") return true;
    try { return reader.allow(Object.freeze({ id: rec.id, tags: Object.freeze([...rec.tags]), author: rec.author, classification: rec.classification })) === true; } catch { return false; }
  };
  const lock = fn => withFileLock(path.join(dir, "memory"), fn);
  try { lock(() => sync(true)); } catch { sync(true); }      // a busy store lock must not stop start-up

  // ---------------------------------------------------------------- write
  function write({ authorId, title, body, tags = [], classification = "PERSONAL", source = "", clearance = "PUBLIC", allow = undefined } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    if (typeof authorId !== "string" || !AGENT_RE.test(authorId)) return fail("AUTHOR_INVALID");
    if (classification === "SECRET") return fail("SECRET_NOT_STORABLE_USE_THE_VAULT");
    if (!isClass(classification)) return fail("CLASSIFICATION_INVALID");
    if (!oneLine(title, LIMITS.maxTitle) || !title.trim()) return fail("TITLE_INVALID");
    if (bodyBad(body)) return fail("BODY_INVALID");
    if (!Array.isArray(tags) || tags.length > LIMITS.maxTags || !tags.every(t => typeof t === "string" && TAG_RE.test(t))) return fail("TAGS_INVALID");
    if (!oneLine(source, LIMITS.maxSource)) return fail("SOURCE_INVALID");
    if (sensitive(title) || sensitive(body) || sensitive(source)) return fail("SECRET_DETECTED_NOT_STORED");
    try {
      return lock(() => {
        sync();
        if (recs.size >= maxNotes) return fail("MEMORY_FULL");
        const bodySha = sha(body);
        const wr = { id: authorId, clearance: isClass(clearance) ? clearance : "PUBLIC", allow: typeof allow === "function" ? allow : undefined };
        for (const r of recs.values()) if (r.bodySha === bodySha && canSee(r, wr)) return fail("DUPLICATE_OF:" + r.id);      // a hidden note is never revealed by a duplicate answer
        const id = crypto.randomBytes(8).toString("hex"), t = nowFn();
        const meta = { id, title: title.trim(), tags: [...new Set(tags)].join(", "), classification, tenant: tenantId, author: authorId, source, createdAt: t, updatedAt: t, version: "1", bodySha };
        const file = path.join(notesDir, id + ".md"); writeAtomic(file, render(meta, body));
        noteFloor(id, classification); audit.append("MEMORY_WRITTEN", { id, authorId, classification, bodySha, titleSha: sha(meta.title).slice(0, 16) });
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
        const reader = { id: patch.authorId, clearance: patch.clearance, allow: patch.allow };
        if (!readerOk(reader) || !canSee(cur, reader)) return fail("NOT_FOUND");      // an agent that cannot read a note cannot change it, and cannot tell it exists
        const parsed = readNote(path.join(notesDir, id + ".md")); if (parsed.bad) return fail("NOTE_UNREADABLE");
        const cls = patch.classification ?? cur.classification;
        if (cls === "SECRET") return fail("SECRET_NOT_STORABLE_USE_THE_VAULT");
        if (!isClass(cls)) return fail("CLASSIFICATION_INVALID");
        const title = patch.title ?? cur.title, body = patch.body ?? parsed.rec.body, tags = patch.tags ?? cur.tags, source = patch.source ?? parsed.rec.source;
        if (!oneLine(title, LIMITS.maxTitle) || !title.trim()) return fail("TITLE_INVALID");
        if (bodyBad(body)) return fail("BODY_INVALID");
        if (!Array.isArray(tags) || tags.length > LIMITS.maxTags || !tags.every(t => typeof t === "string" && TAG_RE.test(t))) return fail("TAGS_INVALID");
        if (!oneLine(source, LIMITS.maxSource)) return fail("SOURCE_INVALID");
        if (sensitive(title) || sensitive(body) || sensitive(source)) return fail("SECRET_DETECTED_NOT_STORED");
        const bodySha = sha(body);
        if (RANK[cls] > RANK[cur.classification] && patch.authorId !== cur.author) return fail("CLASSIFICATION_RAISE_AUTHOR_ONLY");      // another agent cannot raise a note's class and so lock its readers out (lowering already needs the owner)
        if (RANK[cls] < RANK[cur.classification]) {
          if (bodySha !== cur.bodySha) return fail("DECLASSIFY_AND_EDIT_SEPARATELY");      // the approval covers the body it was issued for
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
        noteFloor(id, cls); audit.append("MEMORY_UPDATED", { id, by: patch.authorId, version, classification: cls, bodySha });
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
        for (const n of fs.readdirSync(versionsDir).filter(x => x.startsWith(id + ".v"))) { try { fs.renameSync(path.join(versionsDir, n), path.join(trashDir, n + "." + Date.now() + ".old")); } catch { /* left */ } }
        audit.append("MEMORY_FORGOTTEN", { id, bodySha: cur.bodySha, nonce: v.nonce });
        sidx?.remove(id); try { sidx?.flush(); } catch { /* rebuilt by reindex */ }
        sync(); return { ok: true, id, note: "the note and its old versions were moved to the trash folder (still on disk until the owner deletes them); the owner can restore the note by moving the file back" };
      });
    } catch (e) { return fail(e?.message === "LOCK_TIMEOUT" ? "MEMORY_BUSY" : "FORGET_ERROR"); }
  }

  /** Subject an owner approval for forgetting this note must carry (owner tooling only; the store object is never handed to agents). */
  function forgetSubject(id) { if (typeof id !== "string" || !ID_RE.test(id)) return null; syncRead(); const r = recs.get(id); return r ? { action: "MEMORY_FORGET", subject: memorySubject(id, r.bodySha) } : null; }

  /** Subject for a retention sweep over these notes as they are now (owner tooling). Null if any id is unknown. */
  function retentionSubjectFor(ids) { if (!Array.isArray(ids) || !ids.length || !ids.every(i => typeof i === "string" && ID_RE.test(i))) return null; syncRead(); const items = []; for (const i of ids) { const r = recs.get(i); if (!r) return null; items.push(i + ":" + r.bodySha.slice(0, 16)); } return retentionSubject(items); }
  /** Subject the owner approval for LOWERING this note's class must carry. */
  function declassifySubject(id, to) { if (typeof id !== "string" || !ID_RE.test(id) || !isClass(to)) return null; syncRead(); const r = recs.get(id); return r && RANK[to] < RANK[r.classification] ? { action: "MEMORY_DECLASSIFY", subject: memorySubject(id, r.bodySha, ":" + r.classification + ">" + to) } : null; }

  // ---------------------------------------------------------------- retention sweep (owner approval bound to the exact set of notes)
  function retireBatch(ids, { ownerApproval = null } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every(i => typeof i === "string" && ID_RE.test(i)) || new Set(ids).size !== ids.length) return fail("IDS_INVALID");
    if (!ownerAuth) return fail("OWNER_AUTH_REQUIRED");
    try {
      return lock(() => {
        sync(); for (const id of ids) if (!recs.has(id)) return fail("NOT_FOUND");
        const subject = retentionSubject(ids.map(i => i + ":" + recs.get(i).bodySha.slice(0, 16))), v = ownerAuth.verifyApproval(ownerApproval, { action: "MEMORY_RETENTION_SWEEP", subject });
        if (!v.allowed) return fail("OWNER_APPROVAL_REQUIRED:" + v.reason, { subject });
        const stamp = Date.now(), moved = [];
        audit.append("MEMORY_RETENTION_STARTED", { count: ids.length, ids, subject, nonce: v.nonce });      // intent first: an interrupted sweep leaves a trace
        try { for (const id of ids) {
          fs.renameSync(path.join(notesDir, id + ".md"), path.join(trashDir, id + "." + stamp + ".md"));
          for (const n of fs.readdirSync(versionsDir).filter(x => x.startsWith(id + ".v"))) { try { fs.renameSync(path.join(versionsDir, n), path.join(trashDir, n + "." + stamp + ".old")); } catch { /* left */ } }
          sidx?.remove(id); moved.push(id);
        } } catch (e) { try { audit.append("MEMORY_RETENTION_PARTIAL", { moved, failedAt: ids[moved.length] }); } catch { /* ignore */ } sync(); return fail("RETIRE_PARTIAL", { moved }); }
        audit.append("MEMORY_RETENTION_SWEPT", { count: ids.length, ids, subject, nonce: v.nonce }); try { sidx?.flush(); } catch { /* rebuilt by reindex */ }
        sync(); return { ok: true, retired: ids, note: "moved to the trash folder; the owner can restore a file by moving it back" };
      });
    } catch (e) { return fail(e?.message === "LOCK_TIMEOUT" ? "MEMORY_BUSY" : "RETIRE_ERROR"); }
  }

  // ---------------------------------------------------------------- read / list / search
  const defang = t => String(t).replace(/<{2,}|>{2,}/g, m => m.split("").join("\u200b"));      // no run of < or > survives, so no marker can be written inside data
  const fence = (rec, text) => "<<UNTRUSTED_MEMORY id=" + rec.id + " classification=" + rec.classification + " author=" + rec.author + ">>\n" + defang(text) + "\n<<END_UNTRUSTED_MEMORY>>";
  function get(id, reader) {
    if (!readerOk(reader)) return fail("READER_INVALID");
    if (typeof id !== "string" || !ID_RE.test(id)) return fail("NOT_FOUND");
    syncRead(); const rec = recs.get(id);
    if (!rec || !canSee(rec, reader)) { if (rec) stats.hidden++; return fail("NOT_FOUND"); }      // hidden and missing look identical
    const p = readNote(path.join(notesDir, id + ".md")); if (p.bad) return fail("NOT_FOUND");
    return { ok: true, untrusted: true, id, title: defang(rec.title), tags: rec.tags.map(defang), classification: rec.classification, author: rec.author, source: defang(p.rec.source), version: p.rec.version, updated: rec.updated, text: fence(rec, scrub(p.rec.body)) };
  }
  function list(reader, { limit = 50, offset = 0 } = {}) {
    if (!readerOk(reader)) return fail("READER_INVALID");
    syncRead(); const n = Math.max(1, Math.min(200, Number.isInteger(limit) ? limit : 50));
    return { ok: true, notes: [...recs.values()].filter(r => canSee(r, reader)).sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.id < b.id ? -1 : 1)).slice(Number.isInteger(offset) && offset > 0 ? offset : 0, (Number.isInteger(offset) && offset > 0 ? offset : 0) + n).map(r => ({ id: r.id, title: defang(r.title), tags: r.tags.map(defang), classification: r.classification, updated: r.updated })) };
  }
  const search = args => searchImpl(args ?? {}, null, null);
  function searchImpl({ query, reader, limit = 5 } = {}, neuralList = null, semMeta = null) {
    if (!readerOk(reader)) return fail("READER_INVALID");
    if (typeof query !== "string" || !query.trim() || query.length > LIMITS.maxQuery || !query.isWellFormed()) return fail("QUERY_INVALID");
    const qterms = [...new Set(terms(query))].slice(0, 12); if (!qterms.length) return fail("QUERY_HAS_NO_SEARCHABLE_TERMS");
    syncRead(); stats.searches++;
    const visible = new Set([...recs.values()].filter(r => canSee(r, reader)).map(r => r.id));
    const n = Math.max(1, Math.min(LIMITS.maxResults, Number.isInteger(limit) ? limit : 5));
    const lex = index.lexical(qterms, 2000).filter(x => visible.has(x.id)).slice(0, 50);
    const qv = embed(query), sem = [];
    for (const id of visible) { const c = cosine(qv, vecs.get(id)); if (c > 0.2) sem.push({ id, score: c }); }
    sem.sort((a, b) => b.score - a.score); sem.length = Math.min(sem.length, 50);
    const fused = new Map();
    const add = (list, key) => list.forEach((x, i) => { const e = fused.get(x.id) ?? { id: x.id, rrf: 0, lexical: null, similarity: null, neural: null }; e.rrf += 1 / (60 + i + 1); e[key] = x.score; fused.set(x.id, e); });
    add(lex, "lexical"); add(sem, "similarity"); if (neuralList) add(neuralList, "neural");
    const top = [...fused.values()].sort((a, b) => b.rrf - a.rrf).slice(0, n);
    const results = top.map(h => {
      const rec = recs.get(h.id), p = readNote(path.join(notesDir, h.id + ".md")); if (p.bad) return null;
      const body = scrub(p.rec.body), low = body.toLowerCase(); let at = -1; for (const t of qterms) { const i = low.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
      const start = Math.max(0, (at < 0 ? 0 : at) - 80), passage = body.slice(start, start + LIMITS.passageChars);
      return { id: rec.id, title: defang(rec.title), classification: rec.classification, tags: rec.tags.map(defang), score: Number(h.rrf.toFixed(5)), lexical: h.lexical, similarity: h.similarity === null ? null : Number(h.similarity.toFixed(3)), neural: h.neural === null ? null : Number(h.neural.toFixed(3)), passage: fence(rec, passage), externallyEdited: p.edited === true };
    }).filter(Boolean);
    const label = !neuralList ? "HYBRID_BM25_PLUS_LEXICAL_NGRAM_SIMILARITY (not neural embeddings)" : semMeta?.neural ? "HYBRID_BM25_PLUS_NGRAM_PLUS_NEURAL_EMBEDDINGS(" + semMeta.model + ")" : "HYBRID_BM25_PLUS_NGRAM_PLUS_TEST_FIXTURE_EMBEDDINGS (NOT neural; plumbing test only)";
    return { ok: true, untrusted: true, backend: index.backend, retrieval: label, semantic: semMeta ?? { used: false, reason: "NO_SEMANTIC_PROVIDER_OR_SYNC_CALL", neural: false }, results };
  }

  // ---------------------------------------------------------------- semantic (embedding) retrieval: optional, provider-injected, never a hard dependency
  // Without a provider (the default) nothing here runs and search() is the lexical hybrid. A provider of kind NEURAL is labelled neural; the toy test fixture is labelled as such.
  let sidx = null, lastSemErr = null, lastReindex = null;
  if (semanticProvider) { const fp = providerFingerprint(semanticProvider); sidx = createSemanticIndex({ file: path.join(dir, "semantic", fp + ".json"), fingerprint: fp, nowFn: () => Date.parse(nowFn()) || Date.now() }); }
  const embedText = (title, body) => (title + "\n" + body).slice(0, 4000);
  const vkey = r => sha(r.title + "\u0000" + r.bodySha);      // a vector is fresh only for this exact title+body (a title-only edit makes it stale)
  function semanticStatus() {
    if (!semanticProvider) return { enabled: false, neural: false, reason: "NO_EMBEDDING_PROVIDER_CONFIGURED (lexical fallback in use)" };
    syncRead(); sidx.refresh(); const st = sidx.stats(); let fresh = 0; for (const r of recs.values()) if (sidx.has(r.id, vkey(r))) fresh++;
    return { enabled: true, neural: isNeural(semanticProvider), providerKind: semanticProvider.kind, model: semanticProvider.model, vectors: st.vectors, dim: st.dim, coverage: recs.size ? Number((fresh / recs.size).toFixed(3)) : 1, notesMissingVectors: recs.size - fresh, indexFile: st.loadedFrom, staleModelFileIgnored: st.staleModelFileIgnored, lastError: lastSemErr, lastReindex };
  }
  /** Controlled (re)indexing: only notes without a fresh vector are embedded, in small batches, at most maxNotes per call. Vectors of vanished or changed notes are dropped. */
  async function reindexSemantic({ maxNotes = 500, full = false } = {}) {
    if (!semanticProvider) return fail("NO_EMBEDDING_PROVIDER_CONFIGURED");
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    syncRead(true); const cap = Math.max(1, Math.min(LIMITS.maxNotes, Number.isInteger(maxNotes) ? maxNotes : 500));
    sidx.refresh(); const current = new Map([...recs.values()].map(r => [r.id, vkey(r)])); if (full) sidx.clear(); const pruned = sidx.prune(current);
    const todo = [...recs.values()].filter(r => !sidx.has(r.id, vkey(r))).slice(0, cap); let done = 0, failed = null;
    for (let i = 0; i < todo.length && !failed; i += 16) {
      if (stopped()) { failed = "OWNER_STOP_OR_SAFE_MODE_ACTIVE"; break; }
      const batch = todo.slice(i, i + 16), texts = [];
      for (const r of batch) { const p = readNote(path.join(notesDir, r.id + ".md")); texts.push(p.bad ? "" : embedText(r.title, scrub(p.rec.body))); }
      if (texts.some(t => !t.trim())) { failed = "NOTE_UNREADABLE"; break; }
      let vs; try { vs = await semanticProvider.embed(texts); } catch (e) { failed = String(e?.message ?? e).slice(0, 80); break; }
      if (!Array.isArray(vs) || vs.length !== batch.length) { failed = "EMBEDDING_COUNT_MISMATCH"; break; }
      syncRead();      // a note changed or forgotten while we were embedding must not get a stale vector
      batch.forEach((r, j) => { const now = recs.get(r.id); if (now && vkey(now) === vkey(r)) { try { sidx.set(r.id, vkey(r), vs[j]); done++; } catch (e) { failed = String(e?.message ?? e).slice(0, 80); } } });
    }
    try { sidx.flush(); } catch { failed ??= "INDEX_WRITE_FAILED"; }
    lastSemErr = failed; lastReindex = { at: nowFn(), embedded: done, pruned, pending: Math.max(0, todo.length - done), error: failed };
    try { audit.append("MEMORY_SEMANTIC_REINDEX", { model: semanticProvider.model, kind: semanticProvider.kind, embedded: done, pruned, error: failed }); } catch { /* ignore */ }
    return failed ? { ok: false, reason: failed, embedded: done, pruned } : { ok: true, embedded: done, pruned, pending: Math.max(0, recs.size - sidx.stats().vectors) };
  }
  /** Hybrid search with the embedding provider. Access control first (visible set), then scoring. Any provider problem degrades to the lexical hybrid and says so. */
  async function searchAsync(args = {}) {
    const { query, reader } = args;
    if (!semanticProvider) return search(args);
    if (!readerOk(reader)) return fail("READER_INVALID");
    if (typeof query !== "string" || !query.trim() || query.length > LIMITS.maxQuery || !query.isWellFormed()) return fail("QUERY_INVALID");
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    const degrade = reason => { lastSemErr = reason; return searchImpl(args, null, { used: false, reason, neural: false }); };
    let qv; try { [qv] = await semanticProvider.embed([query]); } catch (e) { return degrade("EMBEDDING_UNAVAILABLE:" + String(e?.message ?? e).slice(0, 60)); }
    if (!qv) return degrade("EMBEDDING_EMPTY");
    syncRead(); sidx.refresh(); const fresh = [];
    for (const r of recs.values()) if (canSee(r, reader) && sidx.has(r.id, vkey(r))) fresh.push(r.id);
    if (!fresh.length) return searchImpl(args, null, { used: false, reason: "NO_VECTORS_YET_RUN_REINDEX", neural: false });
    const hits = sidx.search(qv, fresh, 50).filter(h => h.score >= 0.2);
    return searchImpl(args, hits, { used: true, model: semanticProvider.model, neural: isNeural(semanticProvider), vectorsConsidered: fresh.length });
  }

  // ---------------------------------------------------------------- maintenance
  function rebuildIndex({ reason = "MANUAL" } = {}) {
    if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    try { return lock(() => { index.clear(); recs = new Map(); vecs = new Map(); dirStamp = ""; const changed = sync(true); audit.append("MEMORY_INDEX_REBUILT", { reason: String(reason).slice(0, 40), notes: recs.size }); return { ok: true, notes: recs.size, changed }; }); }
    catch { return fail("REBUILD_ERROR"); }
  }
  /** Compare every file with the index and the recorded hash. Read-only. */
  function verify() {
    syncRead(true);
    let edited = 0, bad = 0, files = 0, mismatched = 0;
    for (const n of fs.readdirSync(notesDir).filter(x => x.endsWith(".md"))) { files++; const r = readNote(path.join(notesDir, n)); if (r.bad) bad++; else { if (r.edited) edited++; const kept = recs.get(r.rec.id); if (kept && kept.classification !== r.rec.classification) mismatched++; } }
    return { ok: true, files, indexed: recs.size, externallyEdited: edited, unreadable: bad, classificationMismatch: mismatched, consistent: files === recs.size && bad === 0 && mismatched === 0, backend: index.backend, auditOk: auditNow().ok };
  }
  const status = () => { syncRead(); const c = {}; for (const r of recs.values()) c[r.classification] = (c[r.classification] ?? 0) + 1; return { backend: index.backend, notes: recs.size, byClassification: c, searches: stats.searches, hiddenAttempts: stats.hidden, quarantined: fs.readdirSync(quarDir).length, trashed: fs.readdirSync(trashDir).length, auditHead: audit.head(), semantic: semanticStatus() }; };
  return { write, update, forget, forgetSubject, declassifySubject, retentionSubjectFor, retireBatch, get, list, search, searchAsync, reindexSemantic, semanticStatus, rebuildIndex, verify, status, auditVerify: () => auditNow(), auditEntries: () => { try { audit.reload(); } catch { /* verify() reports it */ } return audit.entries(); }, close: () => index.close() };
}
