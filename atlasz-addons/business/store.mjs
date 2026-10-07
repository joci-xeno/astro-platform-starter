// Small durable JSON store shared by the business engines. Atomic writes; a corrupt file is NEVER silently replaced (fail closed).
import fs from "node:fs";
import path from "node:path";

export function createStore({ file = null, init = () => ({}) } = {}) {
  let data = init();
  if (file && fs.existsSync(file)) { try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("STORE_UNREADABLE:" + path.basename(file)); } }
  const save = () => { if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); const t = file + ".tmp"; fs.writeFileSync(t, JSON.stringify(data)); fs.renameSync(t, file); };
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
