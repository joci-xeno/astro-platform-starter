// Company / organisation intelligence store (Global Business package §3; integration report §3 "Company/organization intelligence module").
// It STORES and RECONCILES what sources said; it never fetches, never scrapes and never contacts anyone (there is no network code in this module).
//
//   organisation   {orgId, fields: {<field>: [assertion...]}}; every assertion carries provenance {sourceId, url, observedAt} and a confidence 0..1 (required; never defaulted).
//                  view(): per field SINGLE_SOURCE / CORROBORATED / CONFLICT / UNKNOWN. Conflicting values are PRESERVED side by side (value=null, status=CONFLICT,
//                  candidates listed); nothing is silently merged or "majority-voted". A reviewer may record a resolution; the candidates stay.
//   sources        an assertion is accepted only from a source the injected `isSourceApproved(sourceId)` approves (wire it to source-allowlist.effective) or from the
//                  explicit manual source "manual" (owner/operator typed it; an evidence note is required). Default: nothing but "manual" is approved (fail closed).
//   organisation fields are BUSINESS data: e-mail addresses, phone numbers and credentials are refused there (personal data lives only in contact records).
//   decision makers  through buyer-decision-maker-finder.mjs (normalizeContact / rankContacts / contactReady / buildBuyerQuery). A contact needs businessContact=true,
//                  a source, a lawful-basis label, and is `verified` only with verification evidence. buildBuyerQuery output is a PLAN (executable:false): no connector exists.
//   personal data  GDPR-style exportSubject(key) and forgetSubject(key): forget deletes every contact record of that person and keeps only a salted hash on a suppression
//                  list so the same person is not re-added from a feed; the audit log stores hashes, never the personal data.
//
// Status honesty: IMPLEMENTED + unit TESTED with synthetic data. Not CONNECTED to any source, not LIVE. The lawful-basis label is recorded, not legally verified.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { containsSecret } from "./secret-patterns.mjs";
import { normalizeContact, rankContacts, contactReady, buildBuyerQuery } from "./buyer-decision-maker-finder.mjs";

export const ORG_FIELDS = Object.freeze(["legalName", "tradingName", "country", "registrationNumber", "website", "industry", "employeeRange", "foundedYear", "businessAddress", "description"]);
export const LAWFUL_BASES = Object.freeze(["LEGITIMATE_INTEREST_B2B", "CONSENT", "PUBLIC_BUSINESS_ROLE"]);
export const LIMITS = Object.freeze({ maxOrgs: 5000, maxAssertionsPerField: 20, maxContactsPerOrg: 50, maxValue: 500, maxSuppressed: 100000, maxNote: 300 });
const ORG_ID_RE = /^[a-z0-9][a-z0-9_.:-]{1,79}$/, SRC_RE = /^[a-z0-9][a-z0-9_.-]{1,47}$/;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, PHONE_RE = /(?:\+?\d[\s().-]?){9,}/;
const CTRL = /[\u0000-\u001f\u007f\u2028\u2029]/;
const sha = t => createHash("sha256").update(t).digest("hex");
const norm = v => String(v).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function provenanceOk(p) {
  if (!p || typeof p !== "object") return "PROVENANCE_REQUIRED";
  if (typeof p.sourceId !== "string" || !SRC_RE.test(p.sourceId)) return "PROVENANCE_SOURCE_INVALID";
  if (p.sourceId === "manual") { if (typeof p.evidenceNote !== "string" || p.evidenceNote.trim().length < 3 || p.evidenceNote.length > LIMITS.maxNote) return "MANUAL_SOURCE_NEEDS_EVIDENCE_NOTE"; }
  else { let u; try { u = new URL(p.url); } catch { return "PROVENANCE_URL_INVALID"; } if (u.protocol !== "https:" || u.username || u.password) return "PROVENANCE_URL_INVALID"; }
  if (typeof p.observedAt !== "string" || !Number.isFinite(Date.parse(p.observedAt))) return "PROVENANCE_OBSERVED_AT_INVALID";
  return null;
}

export function createOrgIntelligence({ dir = null, isSourceApproved = () => false, now = () => new Date().toISOString(), salt = null } = {}) {
  const FILE = dir ? path.join(dir, "org-intelligence.json") : null;
  if (dir) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const audit = createAuditChain({ filePath: dir ? path.join(dir, "org-intelligence-audit.jsonl") : null, now });
  let st = { salt: salt ?? randomBytes(16).toString("hex"), orgs: {}, suppressed: [] };
  if (FILE && fs.existsSync(FILE)) { try { st = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { throw new Error("ORG_STORE_UNREADABLE"); } }
  const save = () => { if (!FILE) return; const t = FILE + ".tmp"; fs.writeFileSync(t, JSON.stringify(st), { mode: 0o600 }); fs.renameSync(t, FILE); };
  const subjectHash = key => sha(st.salt + ":" + norm(key)).slice(0, 32);
  const approved = id => { if (id === "manual") return true; try { return isSourceApproved(id) === true; } catch { return false; } };
  const R = (reason, extra = {}) => ({ ok: false, reason, ...extra });

  function upsertOrg(orgId) {
    if (typeof orgId !== "string" || !ORG_ID_RE.test(orgId) || ["__proto__", "constructor", "prototype"].includes(orgId)) return R("ORG_ID_INVALID");
    if (!Object.hasOwn(st.orgs, orgId)) { if (Object.keys(st.orgs).length >= LIMITS.maxOrgs) return R("ORG_LIMIT"); st.orgs[orgId] = { orgId, fields: {}, resolutions: {}, contacts: [], createdAt: now() }; }
    return { ok: true, org: st.orgs[orgId] };
  }
  /** assert(orgId, field, value, {provenance, confidence}) - one source's statement about one field. */
  function assertField(orgId, field, value, { provenance, confidence } = {}) {
    if (!ORG_FIELDS.includes(field)) return R("FIELD_NOT_ALLOWED");
    if (!(typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1)) return R("CONFIDENCE_REQUIRED_0_TO_1");
    const pe = provenanceOk(provenance); if (pe) return R(pe);
    if (!approved(provenance.sourceId)) return R("SOURCE_NOT_APPROVED");
    if (value === null || value === undefined || value === "") return R("VALUE_REQUIRED_USE_NO_ASSERTION_FOR_UNKNOWN");
    const v = typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" ? value.trim() : null;
    if (v === null || String(v).length > LIMITS.maxValue || CTRL.test(String(v))) return R("VALUE_INVALID");
    if (containsSecret(String(v))) return R("SECRET_REFUSED");
    if (EMAIL_RE.test(String(v)) || (field !== "registrationNumber" && field !== "foundedYear" && PHONE_RE.test(String(v)))) return R("PERSONAL_DATA_NOT_ALLOWED_IN_ORG_FIELD");
    const o = upsertOrg(orgId); if (!o.ok) return o;
    const list = o.org.fields[field] ??= [];
    const a = { value: v, key: norm(v), sourceId: provenance.sourceId, url: provenance.sourceId === "manual" ? null : String(provenance.url).slice(0, 500), evidenceNote: provenance.evidenceNote ?? null, observedAt: new Date(Date.parse(provenance.observedAt)).toISOString(), confidence, recordedAt: now() };
    const same = list.findIndex(x => x.sourceId === a.sourceId && x.key === a.key);
    if (same >= 0) list[same] = a; else { if (list.length >= LIMITS.maxAssertionsPerField) list.shift(); list.push(a); }
    save(); audit.append("ORG_FIELD_ASSERTED", { orgId, field, sourceId: a.sourceId, valueHash: sha(a.key).slice(0, 16) });
    return { ok: true };
  }
  function fieldView(org, field) {
    const list = org.fields[field] ?? [];
    if (!list.length) return { field, status: "UNKNOWN", value: null, confidence: null, candidates: [] };
    const groups = new Map(); for (const a of list) { const g = groups.get(a.key) ?? { value: a.value, sources: [], confidence: 0 }; g.sources.push({ sourceId: a.sourceId, url: a.url, observedAt: a.observedAt, confidence: a.confidence }); g.confidence = Math.max(g.confidence, a.confidence); groups.set(a.key, g); }
    const candidates = [...groups.values()].map(g => ({ value: g.value, confidence: g.confidence, sources: g.sources, independentSources: new Set(g.sources.map(s => s.sourceId)).size }));
    const res = org.resolutions[field];
    if (candidates.length > 1) {
      const chosen = res && candidates.find(c => norm(c.value) === res.key);
      return chosen ? { field, status: "CONFLICT_RESOLVED_BY_REVIEW", value: chosen.value, confidence: chosen.confidence, resolution: { reviewer: res.reviewer, note: res.note, at: res.at }, candidates }
        : { field, status: "CONFLICT", value: null, confidence: null, candidates };
    }
    const c = candidates[0];
    return { field, status: c.independentSources > 1 ? "CORROBORATED" : "SINGLE_SOURCE", value: c.value, confidence: c.confidence, candidates };
  }
  function view(orgId) {
    const org = Object.hasOwn(st.orgs, orgId) ? st.orgs[orgId] : null; if (!org) return null;
    const fields = Object.fromEntries(ORG_FIELDS.map(f => [f, fieldView(org, f)]));
    return { orgId, fields, conflicts: ORG_FIELDS.filter(f => fields[f].status === "CONFLICT"), unknown: ORG_FIELDS.filter(f => fields[f].status === "UNKNOWN"), contacts: org.contacts.length, untrusted: true };
  }
  function resolveConflict(orgId, field, chosenValue, { reviewer, note = null } = {}) {
    const org = Object.hasOwn(st.orgs, orgId) ? st.orgs[orgId] : null; if (!org) return R("UNKNOWN_ORG");
    if (typeof reviewer !== "string" || !/^[A-Za-z0-9_.-]{2,40}$/.test(reviewer)) return R("REVIEWER_REQUIRED");
    const fv = fieldView(org, field); if (fv.status !== "CONFLICT" && fv.status !== "CONFLICT_RESOLVED_BY_REVIEW") return R("NO_CONFLICT");
    if (!fv.candidates.some(c => norm(c.value) === norm(chosenValue))) return R("CHOICE_MUST_BE_AN_EXISTING_CANDIDATE");
    org.resolutions[field] = { key: norm(chosenValue), reviewer, note: note === null ? null : String(note).slice(0, LIMITS.maxNote), at: now() };
    save(); audit.append("ORG_CONFLICT_RESOLVED", { orgId, field, reviewer }); return { ok: true };
  }

  // ---------------------------------------------------------------- decision makers (personal data)
  function addContact(orgId, raw = {}, { provenance, lawfulBasis, verificationEvidence = null } = {}) {
    const pe = provenanceOk(provenance); if (pe) return R(pe);
    if (!approved(provenance.sourceId)) return R("SOURCE_NOT_APPROVED");
    if (!LAWFUL_BASES.includes(lawfulBasis)) return R("LAWFUL_BASIS_REQUIRED");
    if (!raw || typeof raw !== "object") return R("CONTACT_OBJECT_REQUIRED");
    for (const k of ["name", "title", "email"]) if (raw[k] != null && (typeof raw[k] !== "string" || raw[k].length > 200 || CTRL.test(raw[k]) || containsSecret(raw[k]))) return R("CONTACT_FIELD_INVALID:" + k);
    if (raw.email != null && !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(raw.email)) return R("CONTACT_EMAIL_INVALID");
    if (!raw.name && !raw.email) return R("CONTACT_NAME_OR_EMAIL_REQUIRED");
    if (raw.businessContact !== true) return R("BUSINESS_CONTACT_ONLY");
    const keys = [raw.email, raw.name].filter(Boolean).map(subjectHash);
    if (keys.some(k => st.suppressed.includes(k))) { audit.append("CONTACT_REFUSED_SUPPRESSED", { orgId }); return R("SUBJECT_SUPPRESSED_AFTER_FORGET"); }
    const o = upsertOrg(orgId); if (!o.ok) return o;
    if (o.org.contacts.length >= LIMITS.maxContactsPerOrg) return R("CONTACT_LIMIT");
    const ev = typeof verificationEvidence === "string" && verificationEvidence.trim().length >= 3 ? verificationEvidence.slice(0, LIMITS.maxNote) : null;
    const c = normalizeContact({ ...raw, company: o.org.orgId, source: provenance.sourceId, sourceUrl: provenance.url ?? null, verified: Boolean(ev) });
    const rec = { ...c, contactId: sha(o.org.orgId + ":" + keys.join(":")).slice(0, 16), subjectKeys: keys, lawfulBasis, verificationEvidence: ev, personalData: true, observedAt: provenance.observedAt, addedAt: now() };
    const i = o.org.contacts.findIndex(x => x.contactId === rec.contactId); if (i >= 0) o.org.contacts[i] = rec; else o.org.contacts.push(rec);
    save(); audit.append("CONTACT_ADDED", { orgId, contactId: rec.contactId, lawfulBasis }); return { ok: true, contactId: rec.contactId, ready: contactReady(rec) };
  }
  const strip = c => { const { subjectKeys, ...rest } = c; return { ...rest, ready: contactReady(c) }; };
  function decisionMakers(orgId) { const org = Object.hasOwn(st.orgs, orgId) ? st.orgs[orgId] : null; return org ? rankContacts(org.contacts).map(strip) : []; }
  /** Plan only: the existing buyer-finder query, built from non-conflicted fields. Nothing executes it (no connector). */
  function buyerQuery(orgId, { need = null, roles = [] } = {}) {
    const v = view(orgId); if (!v) return R("UNKNOWN_ORG");
    const company = v.fields.legalName.status === "CONFLICT" ? null : v.fields.legalName.value ?? v.fields.tradingName.value;
    let domain = null; const w = v.fields.website.status === "CONFLICT" ? null : v.fields.website.value; if (w) { try { domain = new URL(/^https?:\/\//.test(w) ? w : "https://" + w).hostname; } catch { domain = null; } }
    if (!company && !domain) return R("NEEDS_UNCONFLICTED_NAME_OR_WEBSITE", { conflicts: v.conflicts });
    return { ok: true, plan: buildBuyerQuery({ company, domain, need, roles }), executable: false, note: "PLAN_ONLY: no contact-finder connector is configured; listed sources are suggestions, not connected services" };
  }
  function exportSubject(key) {
    if (typeof key !== "string" || !key.trim()) return R("SUBJECT_KEY_REQUIRED");
    const h = subjectHash(key), out = [];
    for (const org of Object.values(st.orgs)) for (const c of org.contacts) if (c.subjectKeys.includes(h)) out.push({ orgId: org.orgId, ...strip(c) });
    audit.append("SUBJECT_EXPORTED", { subject: h, records: out.length });
    return { ok: true, subject: h, records: out, exportedAt: now() };
  }
  function forgetSubject(key, { requestRef = null } = {}) {
    if (typeof key !== "string" || !key.trim()) return R("SUBJECT_KEY_REQUIRED");
    const h = subjectHash(key); let removed = 0; const alsoSuppress = new Set([h]);
    for (const org of Object.values(st.orgs)) { const keep = []; for (const c of org.contacts) { if (c.subjectKeys.includes(h)) { removed++; c.subjectKeys.forEach(k => alsoSuppress.add(k)); } else keep.push(c); } org.contacts = keep; }
    for (const k of alsoSuppress) if (!st.suppressed.includes(k)) st.suppressed.push(k);
    while (st.suppressed.length > LIMITS.maxSuppressed) st.suppressed.shift();
    save(); audit.append("SUBJECT_FORGOTTEN", { subject: h, removed, requestRef: requestRef === null ? null : String(requestRef).slice(0, 80) });
    return { ok: true, removed, suppressed: true };
  }
  const summary = () => ({ state: "IMPLEMENTED_NOT_CONNECTED", orgs: Object.keys(st.orgs).length, contacts: Object.values(st.orgs).reduce((n, o) => n + o.contacts.length, 0), suppressedSubjects: st.suppressed.length, conflicts: Object.keys(st.orgs).reduce((n, id) => n + view(id).conflicts.length, 0), auditHead: audit.head() });
  return { assertField, view, resolveConflict, addContact, decisionMakers, buyerQuery, exportSubject, forgetSubject, summary, listOrgs: () => Object.keys(st.orgs), audit: () => audit.entries(), auditVerify: () => audit.verifyFile() };
}
