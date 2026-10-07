// Governed Artifact Registry (package §9). CREATED != VERIFIED != DELIVERED — three independent, evidence-backed statuses.
// Content is stored content-addressed (sha256); integrity can be re-checked at any time; a new version resets QA, verification and delivery status.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createStore, needEvidence, clone } from "./store.mjs";

export const ARTIFACT_TYPES = Object.freeze(["DOCUMENT", "CODE", "DATA", "REPORT", "SPREADSHEET", "IMAGE", "MEDIA_REFERENCE", "ARCHIVE", "CUSTOMER_DELIVERABLE", "OTHER"]);
export const QA_STATUSES = Object.freeze(["NOT_RUN", "PASS", "FAIL", "NEEDS_REPAIR", "BLOCKED", "UNKNOWN"]);
const sha = b => crypto.createHash("sha256").update(b).digest("hex");

export function createArtifactRegistry({ dir = null, environment = "SANDBOX", now = () => new Date().toISOString(), blackBox = null } = {}) {
  const S = createStore({ file: dir ? path.join(dir, "artifacts.json") : null, init: () => ({ artifacts: {}, seq: 0 }) });
  const mem = new Map();                                     // content for dir-less (in-memory) registries
  const rec = (kind, a, extra = {}) => { try { blackBox?.record({ kind, jobId: a.jobId, resource: a.id, ...extra }); } catch { /* ignore */ } };
  const must = id => { const a = S.data.artifacts[id]; if (!a) throw new Error("UNKNOWN_ARTIFACT"); return a; };
  const blobPath = h => path.join(dir, "blobs", h);
  const putBlob = buf => { const h = sha(buf); if (dir) { fs.mkdirSync(path.join(dir, "blobs"), { recursive: true }); if (!fs.existsSync(blobPath(h))) fs.writeFileSync(blobPath(h), buf); } else mem.set(h, buf); return h; };
  const getBlob = h => (dir ? (fs.existsSync(blobPath(h)) ? fs.readFileSync(blobPath(h)) : null) : mem.get(h) ?? null);
  const fresh = () => ({ qaStatus: "NOT_RUN", qa: null, verificationStatus: "NOT_VERIFIED", verification: null, deliveryStatus: "NOT_DELIVERED", delivery: null });

  function create({ jobId, creator, type, name, content, location = null, mime = "text/plain" } = {}) {
    if (!jobId || !creator || !name) throw new Error("JOB_CREATOR_NAME_REQUIRED");
    if (!ARTIFACT_TYPES.includes(type)) throw new Error("BAD_ARTIFACT_TYPE");
    if (content === undefined || content === null) throw new Error("CONTENT_REQUIRED");
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content)), hash = putBlob(buf), id = "art-" + String(++S.data.seq).padStart(5, "0");
    const a = { id, jobId, name, type, mime, creator, location, version: 1, hash, bytes: buf.length, createdAt: now(), versions: [{ version: 1, hash, at: now(), creator }], ...fresh(), evidence: [], environment };
    S.data.artifacts[id] = a; S.save(); rec("ARTIFACT_CREATED", a, { agentId: creator, decision: "CREATED" }); return clone(a);
  }
  function addVersion(id, { creator, content } = {}) {
    const a = must(id); if (!creator || content === undefined) throw new Error("CREATOR_AND_CONTENT_REQUIRED");
    if (a.deliveryStatus === "DELIVERED" || a.deliveryStatus === "DELIVERY_VERIFIED") throw new Error("DELIVERED_ARTIFACT_IS_IMMUTABLE");
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content)), hash = putBlob(buf);
    a.version++; a.hash = hash; a.bytes = buf.length; a.versions.push({ version: a.version, hash, at: now(), creator }); Object.assign(a, fresh());   // new content => must be re-checked
    S.save(); rec("ARTIFACT_VERSION", a, { agentId: creator, decision: "NEW_VERSION_RESETS_QA_VERIFICATION_DELIVERY" }); return clone(a);
  }
  const read = id => getBlob(must(id).hash);
  function integrity(id) { const a = must(id), b = getBlob(a.hash); if (!b) return { ok: false, reason: "CONTENT_MISSING" }; return sha(b) === a.hash ? { ok: true } : { ok: false, reason: "HASH_MISMATCH" }; }
  function recordQa(id, result = {}) {
    const a = must(id); if (!QA_STATUSES.includes(result.status) || result.status === "NOT_RUN") throw new Error("BAD_QA_STATUS");
    if (result.artifactHash && result.artifactHash !== a.hash) throw new Error("QA_RESULT_IS_FOR_A_DIFFERENT_VERSION");
    a.qaStatus = result.status; a.qa = { status: result.status, at: now(), checks: result.checks ?? [], hash: a.hash }; S.save(); rec("ARTIFACT_QA", a, { decision: result.status }); return clone(a);
  }
  /** Verification needs: QA PASS on THIS version, an intact blob, and an ACCEPT from an INDEPENDENT verifier that is not the creator. */
  function verify(id, verification = {}) {
    const a = must(id);
    if (a.qaStatus !== "PASS" || a.qa?.hash !== a.hash) throw new Error("QA_PASS_ON_CURRENT_VERSION_REQUIRED");
    if (!integrity(id).ok) { a.verificationStatus = "FAILED_VERIFICATION"; a.verification = { reason: "INTEGRITY_FAILED", at: now() }; S.save(); throw new Error("ARTIFACT_INTEGRITY_FAILED"); }
    if (verification.verdict !== "ACCEPT" || verification.independent !== true) throw new Error("INDEPENDENT_ACCEPT_REQUIRED");
    if (verification.verifierId && verification.verifierId === a.creator) throw new Error("CREATOR_CANNOT_VERIFY_OWN_ARTIFACT");
    a.verificationStatus = "VERIFIED"; a.verification = { verdict: "ACCEPT", independent: true, verifierId: verification.verifierId ?? null, at: now(), hash: a.hash }; S.save(); rec("ARTIFACT_VERIFIED", a, { decision: "VERIFIED" }); return clone(a);
  }
  function failVerification(id, reason) { const a = must(id); a.verificationStatus = "FAILED_VERIFICATION"; a.verification = { reason, at: now() }; S.save(); return clone(a); }
  /** Delivery needs a VERIFIED current version and a delivery reference with evidence. Creating or verifying never marks delivery. */
  function markDelivered(id, { deliveryId, evidence } = {}) {
    const a = must(id);
    if (a.verificationStatus !== "VERIFIED" || a.verification?.hash !== a.hash) throw new Error("VERIFIED_CURRENT_VERSION_REQUIRED_FOR_DELIVERY");
    if (!deliveryId) throw new Error("DELIVERY_ID_REQUIRED"); needEvidence(evidence, environment);
    a.deliveryStatus = "DELIVERED"; a.delivery = { deliveryId, at: now() }; a.evidence.push(clone(evidence)); S.save(); rec("ARTIFACT_DELIVERED", a, { decision: "DELIVERED" }); return clone(a);
  }
  const get = id => (S.data.artifacts[id] ? clone(S.data.artifacts[id]) : null);
  const list = (f = {}) => Object.values(S.data.artifacts).filter(a => Object.entries(f).every(([k, v]) => a[k] === v)).map(clone);
  const summary = () => { const l = Object.values(S.data.artifacts); const c = k => l.filter(a => a[k.f] === k.v).length; return { total: l.length, verified: c({ f: "verificationStatus", v: "VERIFIED" }), delivered: c({ f: "deliveryStatus", v: "DELIVERED" }), qaPass: c({ f: "qaStatus", v: "PASS" }), environment }; };
  return { create, addVersion, read, integrity, recordQa, verify, failVerification, markDelivered, get, list, summary, environment };
}
