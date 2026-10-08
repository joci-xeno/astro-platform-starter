// Small durable JSON store shared by the business engines. Atomic writes; a corrupt file is NEVER silently replaced (fail closed).
import fs from "node:fs";
import path from "node:path";

export function createStore({ file = null, init = () => ({}), mode = null } = {}) {
  let data = init();
  if (file && fs.existsSync(file)) {
    const bad = () => new Error("STORE_UNREADABLE:" + path.basename(file));
    let loaded; try { loaded = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw bad(); }
    // Shape check against the empty store: the root and every top-level collection must have the kind the engine expects ({} / [] / number), otherwise the file is refused, never "repaired".
    const kind = v => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v), tpl = data;
    if (kind(loaded) !== kind(tpl)) throw bad();
    if (kind(tpl) === "object") for (const k of Object.keys(tpl)) { if (k in loaded ? (kind(tpl[k]) !== "null" && kind(loaded[k]) !== kind(tpl[k])) : false) throw bad(); if (!(k in loaded)) loaded[k] = tpl[k]; }
    data = loaded;
  }
  const save = () => { if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); const t = file + ".tmp"; fs.rmSync(t, { force: true }); fs.writeFileSync(t, JSON.stringify(data), mode ? { mode, flag: "wx" } : undefined); if (mode) fs.chmodSync(t, mode); fs.renameSync(t, file); };   // a stale or pre-planted .tmp (any mode, even a symlink) is removed first so the new file really has the requested mode
  return { get data() { return data; }, save };
}

export const ENVIRONMENTS = Object.freeze(["SANDBOX", "STAGING", "LIVE"]);
/** Evidence the engines accept: an object naming its source, a reference and a verification time, labelled with the environment that produced it.
 *  SANDBOX evidence is only accepted by SANDBOX engines and LIVE evidence only by LIVE engines: the environments never mix. */
export function checkEvidence(e, environment) {
  if (!e || typeof e !== "object") return { ok: false, reason: "EVIDENCE_REQUIRED" };
  if (!e.source || !e.reference) return { ok: false, reason: "EVIDENCE_NEEDS_SOURCE_AND_REFERENCE" };
  if (!Number.isFinite(Date.parse(e.verifiedAt))) return { ok: false, reason: "EVIDENCE_NEEDS_VERIFIED_AT" };
  if ((e.environment ?? "LIVE") !== environment) return { ok: false, reason: `EVIDENCE_ENVIRONMENT_MISMATCH:${e.environment ?? "LIVE"}_IN_${environment}` };
  return { ok: true };
}
export const needEvidence = (e, environment) => { const r = checkEvidence(e, environment); if (!r.ok) throw new Error(r.reason); return e; };
export const clone = x => structuredClone(x);
