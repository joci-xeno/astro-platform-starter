// Unified programme M5: persisted vector index for neural semantic retrieval. Brute-force cosine over normalised Float32 vectors (the notes store is capped at a few thousand notes, so this is exact and simple).
//   * Keyed by the provider fingerprint (id+kind+model): vectors made by another model are never mixed in; a model change starts an empty index that is refilled by a controlled reindex.
//   * Each vector remembers the body hash it was made from; a changed or forgotten note is detected, never searched with a stale vector.
//   * The file carries an integrity hash and is written atomically; a damaged file is set aside and the index starts empty (it is rebuildable from the Markdown notes).
//   * Search only ever considers the ids the caller passes (the reader's visible notes): access control is applied before scoring, not after.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cosineSim } from "./embedding-provider.mjs";

const sha = t => crypto.createHash("sha256").update(t).digest("hex");
const b64 = v => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
const unb64 = s => { const b = Buffer.from(s, "base64"); if (b.length % 4) throw new Error("bad-vector"); const c = new Float32Array(b.length / 4); for (let i = 0; i < c.length; i++) c[i] = b.readFloatLE(i * 4); return c; };
const ID = /^[0-9a-f]{16}$/, HEX = /^[0-9a-f]{64}$/;

export function createSemanticIndex({ file, fingerprint, nowFn = () => Date.now() } = {}) {
  if (!file || typeof fingerprint !== "string" || !fingerprint) throw new Error("SEMANTIC_INDEX_ARGS");
  let entries = new Map(), dim = null, loadedFrom = "FRESH", staleModel = false, dirty = false, updatedAt = null;
  function load() {
    if (!fs.existsSync(file)) return;
    try {
      const w = JSON.parse(fs.readFileSync(file, "utf8")); if (!w || typeof w.body !== "string" || w.sha !== sha(w.body)) throw new Error("hash");
      const b = JSON.parse(w.body); if (b?.v !== 1 || typeof b.fingerprint !== "string" || typeof b.entries !== "object" || b.entries === null || Array.isArray(b.entries)) throw new Error("shape");
      if (b.fingerprint !== fingerprint) { staleModel = true; loadedFrom = "OTHER_MODEL_IGNORED"; return; }
      const m = new Map(); let d = null;
      for (const [id, e] of Object.entries(b.entries)) { if (!ID.test(id) || !e || typeof e.sha !== "string" || !HEX.test(e.sha) || typeof e.vec !== "string") throw new Error("entry"); const v = unb64(e.vec); if (v.length < 2 || (d !== null && v.length !== d)) throw new Error("dim"); for (const x of v) if (!Number.isFinite(x)) throw new Error("finite"); d = v.length; m.set(id, { sha: e.sha, vec: v }); }
      entries = m; dim = d; updatedAt = b.updatedAt ?? null; loadedFrom = "FILE";
    } catch { try { fs.renameSync(file, file + ".corrupt-" + Date.now()); } catch { /* ignore */ } entries = new Map(); dim = null; loadedFrom = "CORRUPT_STARTED_EMPTY"; }
  }
  load();
  function flush() {
    if (!dirty && fs.existsSync(file)) return { ok: true, written: false };
    const obj = {}; for (const [id, e] of entries) obj[id] = { sha: e.sha, vec: b64(e.vec) };
    const body = JSON.stringify({ v: 1, fingerprint, dim, updatedAt: new Date(nowFn()).toISOString(), entries: obj }), t = file + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(t, JSON.stringify({ sha: sha(body), body }), { mode: 0o600 }); fs.renameSync(t, file); dirty = false; return { ok: true, written: true };
  }
  const index = {
    has: (id, bodySha) => entries.get(id)?.sha === bodySha,
    set(id, bodySha, vec) { if (!ID.test(id) || !HEX.test(bodySha) || !(vec instanceof Float32Array) || vec.length < 2) throw new Error("SEMANTIC_ENTRY_INVALID"); if (dim !== null && vec.length !== dim) throw new Error("EMBEDDING_DIMENSION_CHANGED"); dim = vec.length; entries.set(id, { sha: bodySha, vec }); dirty = true; },
    remove(id) { if (entries.delete(id)) dirty = true; },
    /** Drop vectors of notes that no longer exist or whose body changed. Returns how many were dropped. */
    prune(current) { let n = 0; for (const [id, e] of [...entries]) if (current.get(id) !== e.sha) { entries.delete(id); n++; } if (n) dirty = true; return n; },
    search(qvec, allowed, k = 20) {
      const out = []; for (const id of allowed) { const e = entries.get(id); if (!e || e.vec.length !== qvec.length) continue; const c = cosineSim(qvec, e.vec); if (c > 0) out.push({ id, score: c }); }
      return out.sort((a, b) => b.score - a.score).slice(0, k);
    },
    flush, clear() { entries = new Map(); dim = null; dirty = true; },
    stats: () => ({ vectors: entries.size, dim, fingerprint, loadedFrom, staleModelFileIgnored: staleModel, updatedAt })
  };
  return index;
}
