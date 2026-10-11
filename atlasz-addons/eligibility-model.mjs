// Jurisdiction / eligibility evaluator for opportunities (Global Business package §2 + integration report §2 "no jurisdiction/eligibility model" and §5.4
// "work needing physical presence, licences or insurance is classified NOT_EXECUTABLE rather than attempted").
//
//   evaluateEligibility(opportunity, profile, {now}) -> {verdict: ELIGIBLE | NOT_ELIGIBLE | UNKNOWN_NEEDS_REVIEW, checks[], reasons[], flags[], executable}
//     criteria: physical presence, licences, insurance, registrations, languages, currency, minimum company age (+ deadline passed).
//     Each criterion is PASS / FAIL / UNKNOWN. Unknown requirement (null in the normalised record from source-adapters.mjs) or unknown profile fact -> UNKNOWN, never a guess.
//     Any FAIL -> NOT_ELIGIBLE; otherwise any UNKNOWN -> UNKNOWN_NEEDS_REVIEW; otherwise ELIGIBLE.
//     Cross-border (opportunity country unknown or different from the profile's home country, or a currency other than the home currency) -> flag LEGAL_REVIEW_REQUIRED
//     and executable=false, whatever the verdict. Insurance in another currency is UNKNOWN (no FX rate is invented).
//   capability profile   owner-maintained DATA. createCapabilityProfileStore() keeps it behind a signed owner approval
//     (action CAPABILITY_PROFILE_SET, subject "capability-profile:<hash>") in a hash-chained log; every record's signature is re-checked when read.
//
// Status honesty: IMPLEMENTED + unit TESTED. It is a rule evaluator over the facts it is given, NOT legal advice: ELIGIBLE means "no rule here failed", and every
// cross-border item still needs professional review (integration report §4). No real capability profile exists in the repository.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";

export const VERDICTS = Object.freeze(["ELIGIBLE", "NOT_ELIGIBLE", "UNKNOWN_NEEDS_REVIEW"]);
export const LIMITS = Object.freeze({ maxList: 50, maxItem: 80 });
const CC_RE = /^[A-Z]{2}$/, CUR_RE = /^[A-Z]{3}$/, LANG_RE = /^[a-z]{2}$/;
const sha = t => createHash("sha256").update(t).digest("hex");
const okStr = s => typeof s === "string" && s.length > 0 && s.length <= LIMITS.maxItem && !/[\u0000-\u001f\u007f]/.test(s);
const keyOf = s => String(s).trim().toLowerCase();
const dateOk = v => v === null || v === undefined || (typeof v === "string" && Number.isFinite(Date.parse(v)));
const sorted = o => Array.isArray(o) ? o.map(sorted) : o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort().map(k => [k, sorted(o[k])])) : o;

/** Validate + normalise an owner capability profile. Returns {profile} or {error}. */
export function validateProfile(p) {
  const E = error => ({ error });
  if (!p || typeof p !== "object" || Array.isArray(p)) return E("PROFILE_OBJECT_REQUIRED");
  if (!okStr(p.profileId)) return E("PROFILE_ID_REQUIRED");
  if (typeof p.homeCountry !== "string" || !CC_RE.test(p.homeCountry)) return E("HOME_COUNTRY_REQUIRED");
  if (typeof p.homeCurrency !== "string" || !CUR_RE.test(p.homeCurrency)) return E("HOME_CURRENCY_REQUIRED");
  const list = (v, test, name) => { if (v === undefined) return []; if (!Array.isArray(v) || v.length > LIMITS.maxList || !v.every(test)) throw new Error("PROFILE_FIELD_INVALID:" + name); return v; };
  try {
    const out = {
      profileId: p.profileId, homeCountry: p.homeCountry, homeCurrency: p.homeCurrency,
      presenceCountries: list(p.presenceCountries, x => typeof x === "string" && CC_RE.test(x), "presenceCountries"),
      remoteOnly: p.remoteOnly !== false,                                                               // default: remote only (no physical work is ever assumed possible)
      licences: list(p.licences, x => x && okStr(x.id) && typeof x.jurisdiction === "string" && CC_RE.test(x.jurisdiction) && dateOk(x.expiresAt), "licences").map(x => ({ id: keyOf(x.id), jurisdiction: x.jurisdiction, expiresAt: x.expiresAt ?? null })),
      insurance: list(p.insurance, x => x && okStr(x.type) && Number.isFinite(x.coverage) && x.coverage >= 0 && typeof x.currency === "string" && CUR_RE.test(x.currency) && dateOk(x.expiresAt), "insurance").map(x => ({ type: keyOf(x.type), coverage: x.coverage, currency: x.currency, expiresAt: x.expiresAt ?? null })),
      registrations: list(p.registrations, x => x && okStr(x.type) && typeof x.jurisdiction === "string" && CC_RE.test(x.jurisdiction), "registrations").map(x => ({ type: keyOf(x.type), jurisdiction: x.jurisdiction })),
      languages: list(p.languages, x => typeof x === "string" && LANG_RE.test(x), "languages"),
      currencies: list(p.currencies, x => typeof x === "string" && CUR_RE.test(x), "currencies"),
      companyFoundedAt: p.companyFoundedAt === undefined || p.companyFoundedAt === null ? null : dateOk(p.companyFoundedAt) ? new Date(Date.parse(p.companyFoundedAt)).toISOString().slice(0, 10) : (() => { throw new Error("PROFILE_FIELD_INVALID:companyFoundedAt"); })()
    };
    return { profile: out };
  } catch (e) { return E(e.message); }
}
export const profileHash = p => sha(JSON.stringify(sorted(p))).slice(0, 32);

/** opportunity: normalised record from source-adapters.mjs ({country, currency, deadline, requirements{...}}). */
export function evaluateEligibility(opportunity, profileIn, { now = Date.now() } = {}) {
  const vp = validateProfile(profileIn);
  if (vp.error) return { verdict: "UNKNOWN_NEEDS_REVIEW", checks: [], reasons: ["PROFILE_INVALID:" + vp.error], flags: ["PROFILE_INVALID"], executable: false };
  const p = vp.profile, o = opportunity && typeof opportunity === "object" ? opportunity : {};
  const req = o.requirements && typeof o.requirements === "object" ? o.requirements : {};
  const checks = [], add = (criterion, result, reason) => checks.push({ criterion, result, reason });
  const t = typeof now === "number" ? now : Date.parse(now);
  const alive = exp => exp === null || Date.parse(exp) > t;
  const country = typeof o.country === "string" && CC_RE.test(o.country) ? o.country : null;

  // physical presence
  if (req.physicalPresence === undefined || req.physicalPresence === null) add("physicalPresence", "UNKNOWN", "PHYSICAL_PRESENCE_REQUIREMENT_UNKNOWN");
  else if (req.physicalPresence === false) add("physicalPresence", "PASS", "REMOTE_DELIVERABLE");
  else if (p.remoteOnly) add("physicalPresence", "FAIL", "PHYSICAL_PRESENCE_REQUIRED_NOT_EXECUTABLE");
  else if (country === null) add("physicalPresence", "UNKNOWN", "PRESENCE_REQUIRED_COUNTRY_UNKNOWN");
  else add("physicalPresence", p.presenceCountries.includes(country) ? "PASS" : "FAIL", p.presenceCountries.includes(country) ? "PRESENCE_IN_" + country : "NO_PRESENCE_IN_" + country);

  // licences (jurisdiction = opportunity country)
  if (req.licences === undefined || req.licences === null) add("licences", "UNKNOWN", "LICENCE_REQUIREMENT_UNKNOWN");
  else if (!Array.isArray(req.licences)) add("licences", "UNKNOWN", "LICENCE_REQUIREMENT_MALFORMED");
  else if (!req.licences.length) add("licences", "PASS", "NO_LICENCE_REQUIRED");
  else if (country === null) add("licences", "UNKNOWN", "LICENCE_JURISDICTION_UNKNOWN");
  else { const miss = [], expired = []; for (const l of req.licences) { const held = p.licences.filter(h => h.id === keyOf(l) && h.jurisdiction === country); if (!held.length) miss.push(l); else if (!held.some(h => alive(h.expiresAt))) expired.push(l); }
    if (miss.length || expired.length) add("licences", "FAIL", [miss.length ? "LICENCE_NOT_HELD:" + miss.join(",") : null, expired.length ? "LICENCE_EXPIRED:" + expired.join(",") : null].filter(Boolean).join(";"));
    else add("licences", "PASS", "LICENCES_HELD"); }

  // insurance
  if (req.insurance === undefined || req.insurance === null) add("insurance", "UNKNOWN", "INSURANCE_REQUIREMENT_UNKNOWN");
  else if (!Array.isArray(req.insurance)) add("insurance", "UNKNOWN", "INSURANCE_REQUIREMENT_MALFORMED");
  else if (!req.insurance.length) add("insurance", "PASS", "NO_INSURANCE_REQUIRED");
  else { let res = "PASS"; const why = [];
    for (const r of req.insurance) {
      const held = p.insurance.filter(h => h.type === keyOf(r?.type ?? "") && alive(h.expiresAt));
      if (!held.length) { res = "FAIL"; why.push("INSURANCE_NOT_HELD:" + r?.type); continue; }
      if (r.minCoverage === null || r.minCoverage === undefined) continue;
      if (!r.currency) { if (res !== "FAIL") res = "UNKNOWN"; why.push("INSURANCE_CURRENCY_UNKNOWN:" + r.type); continue; }
      const same = held.filter(h => h.currency === r.currency);
      if (!same.length) { if (res !== "FAIL") res = "UNKNOWN"; why.push("INSURANCE_OTHER_CURRENCY_NO_FX:" + r.type); continue; }
      if (!same.some(h => h.coverage >= r.minCoverage)) { res = "FAIL"; why.push("INSURANCE_COVERAGE_TOO_LOW:" + r.type); }
    }
    add("insurance", res, why.join(";") || "INSURANCE_HELD"); }

  // registrations (jurisdiction = opportunity country)
  if (req.registrations === undefined || req.registrations === null) add("registrations", "UNKNOWN", "REGISTRATION_REQUIREMENT_UNKNOWN");
  else if (!Array.isArray(req.registrations)) add("registrations", "UNKNOWN", "REGISTRATION_REQUIREMENT_MALFORMED");
  else if (!req.registrations.length) add("registrations", "PASS", "NO_REGISTRATION_REQUIRED");
  else if (country === null) add("registrations", "UNKNOWN", "REGISTRATION_JURISDICTION_UNKNOWN");
  else { const miss = req.registrations.filter(r => !p.registrations.some(h => h.type === keyOf(r) && h.jurisdiction === country)); add("registrations", miss.length ? "FAIL" : "PASS", miss.length ? "REGISTRATION_MISSING:" + miss.join(",") : "REGISTRATIONS_HELD"); }

  // languages
  if (req.languages === undefined || req.languages === null) add("languages", "UNKNOWN", "LANGUAGE_REQUIREMENT_UNKNOWN");
  else if (!Array.isArray(req.languages)) add("languages", "UNKNOWN", "LANGUAGE_REQUIREMENT_MALFORMED");
  else { const miss = req.languages.filter(l => !p.languages.includes(String(l).toLowerCase())); add("languages", miss.length ? "FAIL" : "PASS", miss.length ? "LANGUAGE_NOT_COVERED:" + miss.join(",") : "LANGUAGES_COVERED"); }

  // currency
  if (typeof o.currency !== "string" || !CUR_RE.test(o.currency)) add("currency", "UNKNOWN", "CURRENCY_UNKNOWN");
  else add("currency", p.currencies.includes(o.currency) || o.currency === p.homeCurrency ? "PASS" : "FAIL", p.currencies.includes(o.currency) || o.currency === p.homeCurrency ? "CURRENCY_ACCEPTED" : "CURRENCY_NOT_ACCEPTED:" + o.currency);

  // minimum company age
  if (req.minCompanyAgeYears === undefined || req.minCompanyAgeYears === null) add("companyAge", "UNKNOWN", "COMPANY_AGE_REQUIREMENT_UNKNOWN");
  else if (!Number.isInteger(req.minCompanyAgeYears) || req.minCompanyAgeYears < 0) add("companyAge", "UNKNOWN", "COMPANY_AGE_REQUIREMENT_MALFORMED");
  else if (req.minCompanyAgeYears === 0) add("companyAge", "PASS", "NO_MINIMUM_AGE");
  else if (p.companyFoundedAt === null) add("companyAge", "UNKNOWN", "COMPANY_FOUNDING_DATE_UNKNOWN");
  else { const f = new Date(p.companyFoundedAt), n = new Date(t); let years = n.getUTCFullYear() - f.getUTCFullYear(); if (n.getUTCMonth() < f.getUTCMonth() || (n.getUTCMonth() === f.getUTCMonth() && n.getUTCDate() < f.getUTCDate())) years--;
    add("companyAge", years >= req.minCompanyAgeYears ? "PASS" : "FAIL", years >= req.minCompanyAgeYears ? "COMPANY_AGE_OK" : `COMPANY_TOO_YOUNG:${years}<${req.minCompanyAgeYears}`); }

  // deadline (only a known, passed deadline fails; unknown deadline is reported, not failed)
  if (typeof o.deadline === "string" && Number.isFinite(Date.parse(o.deadline)) && Date.parse(o.deadline) < t) add("deadline", "FAIL", "DEADLINE_PASSED");

  const flags = [];
  if (country === null) flags.push("COUNTRY_UNKNOWN");
  const crossBorder = country === null || country !== p.homeCountry || (typeof o.currency === "string" && o.currency !== p.homeCurrency);
  if (crossBorder) flags.push("LEGAL_REVIEW_REQUIRED");
  if (checks.some(c => c.reason === "PHYSICAL_PRESENCE_REQUIRED_NOT_EXECUTABLE")) flags.push("NOT_EXECUTABLE");
  const verdict = checks.some(c => c.result === "FAIL") ? "NOT_ELIGIBLE" : checks.some(c => c.result === "UNKNOWN") ? "UNKNOWN_NEEDS_REVIEW" : "ELIGIBLE";
  return { verdict, checks, reasons: checks.filter(c => c.result !== "PASS").map(c => c.criterion + ":" + c.reason), flags, crossBorder, legalReviewRequired: crossBorder,
    executable: verdict === "ELIGIBLE" && !crossBorder, profileId: p.profileId, profileHash: profileHash(p), note: "Rule evaluation over supplied facts; not legal advice." };
}

/** Owner-maintained profile store: set needs a signed owner approval bound to the exact profile; reads re-verify the recorded signature. */
export function createCapabilityProfileStore({ ownerAuth, dir = null, now = () => new Date().toISOString() } = {}) {
  if (!ownerAuth || typeof ownerAuth.verifyApproval !== "function" || typeof ownerAuth.verifyRecorded !== "function") throw new Error("OWNER_AUTH_REQUIRED");
  const log = createAuditChain({ filePath: dir ? path.join(dir, "capability-profile-audit.jsonl") : null, now, headPinFile: dir ? path.join(dir, "capability-profile-audit.headpin.json") : null });
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const subjectOf = p => "capability-profile:" + profileHash(p);
  function set(raw, { approval = null } = {}) {
    const v = validateProfile(raw); if (v.error) return { ok: false, reason: v.error };
    const subject = subjectOf(v.profile), r = ownerAuth.verifyApproval(approval, { action: "CAPABILITY_PROFILE_SET", subject });
    if (!r.allowed) { log.append("PROFILE_SET_DENIED", { reason: r.reason }); return { ok: false, reason: "OWNER_APPROVAL_REQUIRED", detail: r.reason, subject }; }
    log.append("PROFILE_SET", { profile: v.profile, subject, approval }); return { ok: true, subject };
  }
  function current() {
    try { log.reload(); } catch { return { profile: null, integrity: "TAMPERED" }; }
    let cur = null, bad = 0; const nonces = new Set();
    for (const e of log.entries()) if (e.event === "PROFILE_SET") { const v = validateProfile(e.data?.profile); const nn = e.data?.approval?.nonce; if (typeof nn !== "string" || nonces.has(nn)) { bad++; continue; } nonces.add(nn); if (v.error || subjectOf(v.profile) !== e.data.subject || !ownerAuth.verifyRecorded(e.data.approval, { action: "CAPABILITY_PROFILE_SET", subject: e.data.subject })) { bad++; continue; } cur = v.profile; }
    return { profile: cur, integrity: bad ? "UNVERIFIED_RECORDS_IGNORED:" + bad : "OK" };
  }
  function evaluate(opportunity, opts) { const c = current(); if (!c.profile) return { verdict: "UNKNOWN_NEEDS_REVIEW", checks: [], reasons: ["NO_OWNER_APPROVED_PROFILE"], flags: ["PROFILE_MISSING"], executable: false }; return evaluateEligibility(opportunity, c.profile, opts); }
  return { set, current, evaluate, audit: () => log.entries() };
}
