// Observation & user-context memory (85-capability audit: A05 Multimodal Memory, P19 Personal Object and Information Recall, A09 Environmental Context, A08 Contextual Assistance
// input, C07 Project Memory, M09/M10 context). It complements the Memory Fabric (trusted facts/lessons) with what the Fabric deliberately lacks: CONSENT, RETENTION,
// CORRECTION and real DELETION for personal observations. It never stores raw media - only text descriptions and media-fabric metadata with a content hash.
//
// Rules: every record has tenant, scope, classification, source, consent, retention and provenance. SECRET content is refused, never stored. Image/audio/video/screen
// observations need explicit consent. Agents see only PUBLIC/PERSONAL records that the Security Brain screened ALLOW; CONFIDENTIAL is owner-only. Expired records are invisible
// and purged. Delete is a real delete (text and history removed; a content-free tombstone remains for the audit). Corrections create a new version; the old text stays only
// in owner-only history. Verified research findings are captured with their ledger reference and are labelled VERIFIED_AT_CAPTURE - memory never upgrades or refreshes that claim.
import { createStore } from "./business/store.mjs";
import { terms } from "./knowledge-projects.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import { okName, own } from "./safe-keys.mjs";

export const KINDS = Object.freeze(["OBSERVATION", "CONTEXT", "TASK_NOTE", "RESEARCH_FINDING", "MEDIA"]);
export const MODALITIES = Object.freeze(["text", "image", "audio", "video", "screen", "document"]);
export const CLASSES = Object.freeze(["PUBLIC", "PERSONAL", "CONFIDENTIAL", "SECRET"]);
export const SCOPES = Object.freeze(["PERSONAL", "BUSINESS", "CUSTOMER", "SYSTEM"]);
const NEEDS_CONSENT = new Set(["image", "audio", "video", "screen"]);
export const LIMITS = Object.freeze({ textChars: 4000, maxRetentionDays: 730, defaultRetention: { PUBLIC: 365, PERSONAL: 90, CONFIDENTIAL: 30 }, maxRecords: 20000, tags: 10 });
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
import { scrub, containsSecret } from "./secret-patterns.mjs";
const looksSecret = s => { const t = String(s ?? ""); return containsSecret(t) || scrub(t, "[r]") !== t; };
const RANK = { PUBLIC: 0, PERSONAL: 1, CONFIDENTIAL: 2, SECRET: 3 };

export function createObservationMemory({ file = null, security = null, blackBox = null, now = () => new Date().toISOString(), maxRecords = LIMITS.maxRecords } = {}) {
  const store = createStore({ file, init: () => ({ items: {}, tombstones: {}, events: [], seq: 0 }) }), S = store.data;      // unreadable file => STORE_UNREADABLE, never replaced
  const reload = () => { if (!file) return; let d; try { d = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return; throw new Error("STORE_UNREADABLE:" + file.split(/[\\/]/).pop()); } const obj = x => x !== null && typeof x === "object" && !Array.isArray(x);
    if (!obj(d) || !obj(d.items ?? {}) || !obj(d.tombstones ?? {}) || !Array.isArray(d.events ?? []) || !Number.isInteger(d.seq ?? 0)) throw new Error("STORE_UNREADABLE:" + file.split(/[\\/]/).pop());   // same shape rules as at construction: a wrong-kind file is refused, never adopted and overwritten
    S.items = d.items ?? {}; S.tombstones = d.tombstones ?? {}; S.events = d.events ?? []; S.seq = d.seq ?? 0; };
  const log = (kind, d) => { try { blackBox?.record({ kind, ...d }); } catch { /* audit must not change behaviour */ } };
  function event(type, by, d) {
    const prev = S.events.length ? S.events.at(-1).hash : "GENESIS", e = { n: S.events.length + 1, at: now(), type, by, ...d, prev }; e.hash = sha(prev + JSON.stringify({ ...e, hash: undefined })); S.events.push(e); log("OBSERVATION_" + type, { by, ...d }); return e;
  }
  const verifyChain = () => { let prev = "GENESIS"; for (const e of S.events) { const { hash, ...rest } = e; if (e.prev !== prev || sha(prev + JSON.stringify({ ...rest, hash: undefined })) !== hash) return { ok: false, brokenAt: e.n }; prev = hash; } return { ok: true, events: S.events.length }; };
  const who = w => ({ tenantId: w?.tenantId, role: w?.role ?? "OWNER", forAgent: Boolean(w?.forAgent), actorId: w?.actorId ?? null });
  const need = w => { if (!w?.tenantId) throw new Error("TENANT_REQUIRED"); return who(w); };
  const isOwner = w => who(w).role === "OWNER" && !who(w).forAgent;
  const mine = (id, w) => { const i = own(S.items, id); return i && i.tenantId === w.tenantId ? i : null; };
  const expired = i => Date.parse(i.retentionUntil) <= Date.parse(now());
  const addDays = (iso, d) => new Date(Date.parse(iso) + d * 86400000).toISOString();
  const by = w => (w.forAgent ? "AGENT" + (w.actorId ? ":" + w.actorId : "") : "OWNER");
  const pub = (i, w, extra = {}) => ({ id: i.id, kind: i.kind, modality: i.modality, scope: i.scope, classification: i.classification, text: i.text, tags: i.tags, source: i.source, ref: i.ref, createdAt: i.createdAt, version: i.version, correctedAt: i.correctedAt ?? null, retentionUntil: i.retentionUntil,
    consent: i.consent, rawMediaStored: false, verification: i.verification, ageDays: Number(((Date.parse(now()) - Date.parse(i.createdAt)) / 86400000).toFixed(1)), ...extra });

  function observe(o = {}, w) {
    w = need(w); reload();
    const kind = o.kind ?? "OBSERVATION", modality = o.modality ?? "text", scope = o.scope ?? "PERSONAL"; let cls = o.classification ?? "PERSONAL";
    if (!KINDS.includes(kind)) throw new Error("KIND_INVALID"); if (!MODALITIES.includes(modality)) throw new Error("MODALITY_INVALID"); if (!SCOPES.includes(scope)) throw new Error("SCOPE_INVALID"); if (!CLASSES.includes(cls)) throw new Error("CLASSIFICATION_INVALID");
    const text = String(o.text ?? "").trim(); if (!text) throw new Error("TEXT_REQUIRED"); if (text.length > LIMITS.textChars) throw new Error("TEXT_TOO_LONG");
    if (cls === "SECRET" || looksSecret(text)) throw new Error("SECRET_NOT_STORED");
    if (NEEDS_CONSENT.has(modality) && !(o.consent?.granted === true && o.consent?.by === "OWNER" && o.consent?.purpose)) throw new Error("CONSENT_REQUIRED");
    if (o.privacyFlags?.exifGps || o.privacyFlags?.faces) cls = RANK[cls] < RANK.CONFIDENTIAL ? "CONFIDENTIAL" : cls;             // location/people raise the class automatically
    let screening = "NOT_SCREENED"; if (security) { const a = security.assess({ kind: "EXTERNAL_INSTRUCTION", agentId: null, source: "observation:" + kind, text }); screening = a.decision; if (a.allowed === false && w.forAgent) throw new Error("BLOCKED_BY_SECURITY"); if (a.allowed === false) screening = "BLOCK_OWNER_OVERRIDE_STORED_OWNER_ONLY"; }
    const rawTags = Array.isArray(o.tags) ? o.tags.slice(0, LIMITS.tags).map(t => String(t).slice(0, 80)) : [], tags = rawTags.map(t => t.toLowerCase().slice(0, 40));
    if (rawTags.some(looksSecret) || containsSecret(JSON.stringify(o.source?.ref ?? "")) || containsSecret(JSON.stringify(o.ref ?? ""))) throw new Error("SECRET_NOT_STORED");
    const days = Math.min(Number(o.retentionDays) || LIMITS.defaultRetention[cls], LIMITS.maxRetentionDays); if (!(days > 0)) throw new Error("RETENTION_INVALID");
    if (Object.values(S.items).filter(x => x.tenantId === w.tenantId).length >= maxRecords) throw new Error("MEMORY_FULL");
    const id = "ob-" + (++S.seq) + "-" + crypto.randomBytes(3).toString("hex"), t = now();
    const i = { id, tenantId: w.tenantId, kind, modality, scope, classification: cls, text, textSha256: sha(text), tags, source: { type: w.forAgent ? "AGENT" : (o.source?.type ?? "OWNER"), actor: w.actorId ?? null, ref: o.source?.ref ?? null }, ref: o.ref ?? null,
      consent: o.consent ? { granted: o.consent.granted === true, by: o.consent.by ?? null, purpose: o.consent.purpose ?? null, at: t } : { granted: false, by: null, purpose: null, at: null }, createdAt: t, retentionUntil: addDays(t, days), version: 1, history: [], screening, verification: o.verification ?? "UNVERIFIED", mediaSha256: o.mediaSha256 ?? null };
    S.items[id] = i; event("OBSERVED", by(w), { id, tenantId: w.tenantId, kind, modality, classification: cls }); store.save(); return pub(i, w);
  }
  /** A media-fabric analysis becomes a text observation: metadata only, hash reference, no raw media. Consent is required. GPS/location presence raises the class. */
  function observeMedia(analysis, { consent, scope = "PERSONAL", retentionDays, tags = [], note = "" } = {}, w) {
    if (!analysis || !["image", "audio", "video"].includes(analysis.kind)) throw new Error("MEDIA_ANALYSIS_REQUIRED");
    const m = analysis.metadata ?? {}, parts = [`${analysis.kind} (${analysis.format})`, m.width && m.height ? `${m.width}x${m.height}` : null, m.durationSec ? `${m.durationSec}s` : m.durationSecEstimate ? `~${m.durationSecEstimate}s` : null, m.exif?.dateTime ? `taken ${m.exif.dateTime}` : null, m.title ? `title "${m.title}"` : null, note || null].filter(Boolean);
    return observe({ kind: "MEDIA", modality: analysis.kind, text: "[metadata only - content not analysed] " + parts.join(", "), scope, consent, retentionDays, tags, mediaSha256: analysis.sha256, privacyFlags: analysis.privacy, source: { type: "MEDIA_FABRIC", ref: analysis.sha256 } }, w);
  }
  /** Capture VERIFIED findings from a Research Ledger report. They are labelled VERIFIED_AT_CAPTURE with the ledger reference; memory never refreshes that status. */
  function captureResearch(report, o = {}, w) {
    w = need(w); const out = [];
    for (const f of report?.verifiedFacts ?? []) {
      if (f.status !== "VERIFIED") continue;
      out.push(observe({ kind: "RESEARCH_FINDING", scope: o.scope ?? "BUSINESS", classification: o.classification ?? "PERSONAL", text: f.claim, ref: { type: "research_finding", id: f.id, questionId: f.questionId }, verification: "VERIFIED_AT_CAPTURE", tags: ["research", ...(o.tags ?? [])], retentionDays: o.retentionDays, source: { type: "RESEARCH_LEDGER", ref: f.id } }, w));
    }
    return out;
  }

  const visible = (i, w) => i.tenantId === w.tenantId && !expired(i) && (isOwner(w) || (RANK[i.classification] <= RANK.PERSONAL && i.screening === "ALLOW"));
  function score(i, q) { const tk = terms(i.text + " " + i.tags.join(" ")), set = new Set(q); let s = 0; for (const t of set) { const f = tk.filter(x => x === t).length; if (f) s += (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * tk.length / 40)); } return s; }
  function recall({ query = "", scopes = ["BUSINESS", "PERSONAL"], kinds = null, modalities = null, tag = null, limit = 10, minClassification = null } = {}, w) {
    w = need(w); reload(); const q = [...new Set(terms(query))], out = [];
    for (const i of Object.values(S.items)) {
      if (!visible(i, w) || !scopes.includes(i.scope) || (kinds && !kinds.includes(i.kind)) || (modalities && !modalities.includes(i.modality)) || (tag && !i.tags.includes(String(tag).toLowerCase()))) continue;
      const s = q.length ? score(i, q) : 0; if (q.length && s <= 0) continue; out.push({ i, s });
    }
    out.sort((a, b) => b.s - a.s || b.i.createdAt.localeCompare(a.i.createdAt));
    return { method: "KEYWORD_NOT_SEMANTIC", results: out.slice(0, Math.min(limit, 50)).map(({ i, s }) => pub(i, w, { score: Number(s.toFixed(3)) })), note: "Observations are recalled as recorded, with provenance. Nothing here is a verified fact unless its verification says so, and RESEARCH_FINDING entries are VERIFIED_AT_CAPTURE only." };
  }
  const canTouch = (i, w) => isOwner(w) || (w.forAgent && i.source.type === "AGENT");        // agents may only touch records agents created; the owner may touch any
  /** New version with the corrected text. Owner may correct any record; an agent only agent-created records. The previous text is kept in owner-only history. */
  function correct(id, { text, reason = "" } = {}, w) {
    w = need(w); reload(); const i = mine(id, w); if (!i || expired(i)) throw new Error("UNKNOWN_OBSERVATION"); if (!canTouch(i, w)) throw new Error("NOT_PERMITTED");
    const t = String(text ?? "").trim(); if (!t) throw new Error("TEXT_REQUIRED"); if (t.length > LIMITS.textChars) throw new Error("TEXT_TOO_LONG"); if (looksSecret(t)) throw new Error("SECRET_NOT_STORED");
    if (security && w.forAgent) { const a = security.assess({ kind: "EXTERNAL_INSTRUCTION", agentId: null, source: "observation:correct", text: t }); if (a.allowed === false) throw new Error("BLOCKED_BY_SECURITY"); i.screening = a.decision; }
    i.history.push({ version: i.version, text: i.text, textSha256: i.textSha256, replacedAt: now(), by: by(w), reason: String(reason).slice(0, 280) }); i.text = t; i.textSha256 = sha(t); i.version++; i.correctedAt = now(); if (i.verification !== "UNVERIFIED") i.verification = "UNVERIFIED_AFTER_CORRECTION";
    event("CORRECTED", by(w), { id, version: i.version }); store.save(); return pub(i, w);
  }
  /** Real deletion: text, tags and history are removed. A tombstone with no content (id, time, who, reason) stays for the audit. */
  function forget(id, { reason = "" } = {}, w) {
    w = need(w); reload(); const i = mine(id, w); if (!i) throw new Error("UNKNOWN_OBSERVATION"); if (!canTouch(i, w)) throw new Error("NOT_PERMITTED");
    S.tombstones[id] = { id, tenantId: w.tenantId, deletedAt: now(), by: by(w), reason: String(reason).slice(0, 280), kind: i.kind, modality: i.modality }; delete S.items[id];
    event("DELETED", by(w), { id, tenantId: w.tenantId }); store.save(); return { deleted: true, id };
  }
  /** Owner-only bulk deletion by filter. Returns the number removed. */
  function forgetWhere({ modality = null, kind = null, scope = null, sourceType = null, olderThanDays = null, tag = null } = {}, w) {
    w = need(w); if (!isOwner(w)) throw new Error("OWNER_ONLY"); reload();
    if (![modality, kind, scope, sourceType, olderThanDays, tag].some(v => v != null)) throw new Error("FILTER_REQUIRED");
    if (olderThanDays != null && !(typeof olderThanDays === "number" && Number.isFinite(olderThanDays) && olderThanDays >= 0)) throw new Error("OLDER_THAN_DAYS_INVALID");
    const cutoff = olderThanDays != null ? Date.parse(now()) - olderThanDays * 86400000 : null; let n = 0;
    for (const i of Object.values(S.items)) { if (i.tenantId !== w.tenantId) continue; if ((modality && i.modality !== modality) || (kind && i.kind !== kind) || (scope && i.scope !== scope) || (sourceType && i.source.type !== sourceType) || (tag && !i.tags.includes(tag)) || (cutoff != null && Date.parse(i.createdAt) > cutoff)) continue; S.tombstones[i.id] = { id: i.id, tenantId: i.tenantId, deletedAt: now(), by: "OWNER", reason: "BULK", kind: i.kind, modality: i.modality }; delete S.items[i.id]; n++; }
    event("BULK_DELETED", "OWNER", { tenantId: w.tenantId, count: n }); store.save(); return { deleted: n };
  }
  /** Owner-only: delete EVERYTHING for the tenant. Requires typing the tenant id as confirmation. */
  function forgetAll({ confirm } = {}, w) {
    w = need(w); if (!isOwner(w)) throw new Error("OWNER_ONLY"); if (confirm !== w.tenantId) throw new Error("CONFIRMATION_REQUIRED"); reload(); let n = 0;
    for (const i of Object.values(S.items)) if (i.tenantId === w.tenantId) { S.tombstones[i.id] = { id: i.id, tenantId: i.tenantId, deletedAt: now(), by: "OWNER", reason: "FORGET_ALL", kind: i.kind, modality: i.modality }; delete S.items[i.id]; n++; }
    event("FORGET_ALL", "OWNER", { tenantId: w.tenantId, count: n }); store.save(); return { deleted: n };
  }
  /** Physically remove expired records (retention). Tombstoned as RETENTION_EXPIRED. */
  function purgeExpired(w) {
    w = need(w); reload(); let n = 0;
    for (const i of Object.values(S.items)) if (i.tenantId === w.tenantId && expired(i)) { S.tombstones[i.id] = { id: i.id, tenantId: i.tenantId, deletedAt: now(), by: "SYSTEM", reason: "RETENTION_EXPIRED", kind: i.kind, modality: i.modality }; delete S.items[i.id]; n++; }
    if (n) { event("PURGED", "SYSTEM", { tenantId: w.tenantId, count: n }); store.save(); } return { purged: n };
  }
  const history = (id, w) => { w = need(w); reload(); if (!isOwner(w)) throw new Error("OWNER_ONLY"); const i = mine(id, w); if (!i) throw new Error("UNKNOWN_OBSERVATION"); return { id, version: i.version, previous: i.history.map(h => ({ ...h })) }; };
  const exportAll = w => { w = need(w); if (!isOwner(w)) throw new Error("OWNER_ONLY"); reload(); return { tenantId: w.tenantId, exportedAt: now(), items: Object.values(S.items).filter(i => i.tenantId === w.tenantId).map(i => ({ ...structuredClone(i) })), tombstones: Object.values(S.tombstones).filter(t => t.tenantId === w.tenantId) }; };
  function summary(w) { w = need(w); reload(); const l = Object.values(S.items).filter(i => i.tenantId === w.tenantId), c = (f) => l.reduce((a, i) => (a[f(i)] = (a[f(i)] ?? 0) + 1, a), {}); return { total: l.length, expired: l.filter(expired).length, byKind: c(i => i.kind), byModality: c(i => i.modality), byClassification: c(i => i.classification), deleted: Object.values(S.tombstones).filter(t => t.tenantId === w.tenantId).length, rawMediaStored: false, chain: verifyChain(), method: "KEYWORD_NOT_SEMANTIC" }; }
  const events = (w, { limit = 100 } = {}) => { w = need(w); if (!isOwner(w)) throw new Error("OWNER_ONLY"); reload(); return S.events.filter(e => !e.tenantId || e.tenantId === w.tenantId).slice(-Math.min(limit, 500)).map(e => ({ ...e })); };
  return { observe, observeMedia, captureResearch, recall, correct, forget, forgetWhere, forgetAll, purgeExpired, history, exportAll, summary, events, verifyChain: () => (reload(), verifyChain()) };
}

/** Agent tools: always role AGENT in the owner's tenant; an agent can correct/forget only agent-created records (never the owner's). No bulk deletion, no history, no export. */
export function registerObservationTools(registry, mem, { tenantId }) {
  const obj = { type: "object", additionalProperties: true, properties: {} }, ID = { type: "string", minLength: 1, maxLength: 80 }, agentW = ctx => ({ tenantId, role: "AGENT", forAgent: true, actorId: ctx?.actor ?? "agent" });
  registry.register({ name: "obs.observe", description: "Record a text observation or context note (never raw media, never secrets). Image/audio/video/screen observations need the owner's consent.", operation: "INTERNAL_COMPUTE",
    input: { type: "object", required: ["text"], properties: { text: { type: "string", minLength: 1, maxLength: LIMITS.textChars }, kind: { enum: [...KINDS] }, modality: { enum: [...MODALITIES] }, scope: { enum: [...SCOPES] }, classification: { enum: ["PUBLIC", "PERSONAL", "CONFIDENTIAL"] }, tags: { type: "array", maxItems: LIMITS.tags, items: { type: "string", maxLength: 40 } }, retentionDays: { type: "integer", minimum: 1, maximum: LIMITS.maxRetentionDays } } }, output: obj, handler: a => mem.observe(a, agentW({ actor: "AGENT" })) });
  registry.register({ name: "obs.recall", description: "Recall observations visible to agents (PUBLIC/PERSONAL, screened ALLOW, not expired) with provenance. Keyword search, not semantic.", operation: "READ_STATUS",
    input: { type: "object", properties: { query: { type: "string", maxLength: 500 }, scopes: { type: "array", maxItems: 4, items: { enum: [...SCOPES] } }, kinds: { type: "array", maxItems: 5, items: { enum: [...KINDS] } }, tag: { type: "string", maxLength: 40 }, limit: { type: "integer", minimum: 1, maximum: 50 } } }, output: obj, handler: a => mem.recall(a, agentW({})) });
  registry.register({ name: "obs.correct", description: "Correct an agent-created observation (new version; old text is owner-only history).", operation: "INTERNAL_COMPUTE", input: { type: "object", required: ["id", "text"], properties: { id: ID, text: { type: "string", minLength: 1, maxLength: LIMITS.textChars }, reason: { type: "string", maxLength: 280 } } }, output: obj, handler: a => mem.correct(a.id, a, agentW({ actor: "AGENT" })) });
  registry.register({ name: "obs.forget", description: "Delete an agent-created observation.", operation: "INTERNAL_COMPUTE", input: { type: "object", required: ["id"], properties: { id: ID, reason: { type: "string", maxLength: 280 } } }, output: obj, handler: a => mem.forget(a.id, a, agentW({ actor: "AGENT" })) });
  registry.register({ name: "obs.summary", description: "Counts only.", operation: "READ_STATUS", input: { type: "object", properties: {} }, output: obj, handler: () => mem.summary({ tenantId, role: "AGENT", forAgent: true }) });
}

/** Agent-side capture of VERIFIED research findings (re-read from the Research Ledger NOW, through agent permissions) into memory, labelled VERIFIED_AT_CAPTURE. */
export function registerResearchCapture(registry, mem, research, { tenantId }) {
  registry.register({ name: "obs.capture_research", description: "Store the currently VERIFIED findings of a research question as memory (labelled VERIFIED_AT_CAPTURE; memory never refreshes that status).", operation: "INTERNAL_COMPUTE",
    input: { type: "object", required: ["questionId"], properties: { questionId: { type: "string", minLength: 1, maxLength: 80 } } }, output: { type: "object", additionalProperties: true, properties: {} },
    handler: a => { const report = research.report(a.questionId, { tenantId, role: "AGENT", forAgent: true }); const saved = mem.captureResearch(report, { scope: "BUSINESS" }, { tenantId, role: "AGENT", forAgent: true, actorId: "AGENT" }); return { captured: saved.length, ids: saved.map(x => x.id), questionState: report.state }; } });
}
