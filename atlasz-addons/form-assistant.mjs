// Digital form completion assistant (PKG150 S06; capabilities P14 structured output, C02 computer-based task execution).
// Input: an HTML form (string) or a JSON form description, plus an OWNER-APPROVED profile record. Output: a DRY-RUN "fill plan" - for every field its
// detected type, the proposed value and the exact profile key it came from, and the validation result. NOTHING is filled, typed or submitted: there is no
// browser, DOM or network code in this module, and a request to submit is refused.
// Refused field families (never filled, even when the profile happens to contain a matching key): passwords/PINs, payment cards and bank accounts,
// government identifiers, one-time codes. Consent / terms checkboxes are never ticked (accepting terms is an owner decision). Hidden fields are skipped.
// The profile counts as approved only when an Ed25519 owner signature (owner-auth, action FORM_PROFILE_APPROVE) covers the sha256 of its exact fields.
import { createHash } from "node:crypto";
import { containsSecret } from "./secret-patterns.mjs";

export const LIMITS = Object.freeze({ maxHtmlBytes: 200000, maxFields: 200, maxLabelChars: 200, maxValueChars: 500, maxOptions: 500 });
export const REFUSED_TYPES = Object.freeze(["PASSWORD", "PAYMENT_CARD", "GOVERNMENT_ID", "OTP"]);
export const PROFILE_KEYS = Object.freeze({ GIVEN_NAME: "givenName", FAMILY_NAME: "familyName", FULL_NAME: "fullName", EMAIL: "email", PHONE: "phone", STREET: "street", CITY: "city", POSTAL_CODE: "postalCode", REGION: "region", COUNTRY: "country", ORGANIZATION: "organization", JOB_TITLE: "jobTitle", WEBSITE: "website", BIRTH_DATE: "birthDate" });
export const PROFILE_APPROVAL_ACTION = "FORM_PROFILE_APPROVE";

const REFUSE_RULES = [
  ["PASSWORD", /\bpass(?:word|wd|code|phrase)?\b|\bpwd\b|\bpin\b|jelsz[óo]|\bcurrent-password\b|\bnew-password\b/i],
  ["PAYMENT_CARD", /\bcc-|\bcard\s*(?:number|no|num|holder|verification)|\bcardnumber\b|\bccnum\b|\bcvv2?\b|\bcvc\b|\bcsc\b|\bsecurity code\b|\bexpir(?:y|ation)\b|\bexp-(?:month|year|date)\b|\biban\b|\bbic\b|\bswift\b|\b(?:bank\s*)?account\s*(?:number|no)\b|\brouting\b|\bsort code\b|bankszámla|kártyaszám|\bcredit card\b|\bdebit card\b/i],
  ["GOVERNMENT_ID", /\bssn\b|\bsocial security\b|\bsocial insurance\b|\bsin\b|\bpassport\b|\bnational[\s_-]*id\b|\btax[\s_-]*(?:id|number|no)\b|\btin\b|\bdriver'?s?[\s_-]*licen[cs]e\b|\bid[\s_-]*(?:number|card|no)\b|ad[óo]azonos[íi]t[óo]|\btaj\b|szem[ée]lyi|\bhealth card\b/i],
  ["OTP", /\bone-time-code\b|\botp\b|\bone[\s_-]*time\b|\bverification[\s_-]*code\b|\b2fa\b|\bmfa\b|\bauthenticat(?:or|ion) code\b|\bsms[\s_-]*code\b|ellenőrző kód|egyszer\s*használatos/i]
];
const AUTOCOMPLETE = { "given-name": "GIVEN_NAME", "family-name": "FAMILY_NAME", name: "FULL_NAME", email: "EMAIL", tel: "PHONE", "tel-national": "PHONE", "street-address": "STREET", "address-line1": "STREET", "address-level2": "CITY", "address-level1": "REGION", "postal-code": "POSTAL_CODE", country: "COUNTRY", "country-name": "COUNTRY", organization: "ORGANIZATION", "organization-title": "JOB_TITLE", url: "WEBSITE", bday: "BIRTH_DATE" };
const KEYWORDS = [
  ["GIVEN_NAME", /\bfirst[\s_-]*name\b|\bfirstname\b|\bfname\b|\bgiven[\s_-]*name\b|keresztn[ée]v|ut[óo]n[ée]v/i], ["FAMILY_NAME", /\blast[\s_-]*name\b|\blastname\b|\blname\b|\bsurname\b|\bfamily[\s_-]*name\b|vezet[ée]kn[ée]v|csal[áa]dn[ée]v/i],
  ["EMAIL", /e-?mail/i], ["PHONE", /\bphone\b|\btel(?:ephone)?\b|\bmobile\b|telefon/i], ["POSTAL_CODE", /\bzip\b|\bpost(?:al)?[\s_-]*code\b|\bpostcode\b|ir[áa]ny[íi]t[óo]sz[áa]m/i],
  ["CITY", /\bcity\b|\btown\b|v[áa]ros|telep[üu]l[ée]s/i], ["REGION", /\bstate\b|\bprovince\b|\bregion\b|megye/i], ["COUNTRY", /\bcountry\b|orsz[áa]g/i],
  ["STREET", /\baddress\b|\bstreet\b|\bc[íi]m\b|\butca\b/i], ["ORGANIZATION", /\bcompany\b|\borgani[sz]ation\b|\bemployer\b|\bc[ée]g\b/i], ["JOB_TITLE", /\bjob[\s_-]*title\b|\bposition\b|\brole\b|beoszt[áa]s/i],
  ["WEBSITE", /\bwebsite\b|\bhomepage\b|\burl\b|weboldal/i], ["BIRTH_DATE", /\bbirth|\bdob\b|\bbday\b|sz[üu]let[ée]si/i], ["FULL_NAME", /\bfull[\s_-]*name\b|\byour name\b|^name$|\bn[ée]v\b/i]
];
const CONSENT = /\bagree\b|\baccept\b|\bterms\b|\bconsent\b|\bnewsletter\b|\bprivacy\b|\bsubscribe\b|elfogad|hozz[áa]j[áa]rul|feliratkoz/i;
const sha = s => createHash("sha256").update(s).digest("hex");
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Canonical hash of the profile's fields (sorted keys, strings only). This is what the owner signs. */
export function profileHash(fields) {
  const keys = Object.keys(fields ?? {}).filter(k => typeof fields[k] === "string").sort();
  return sha(JSON.stringify(keys.map(k => [k, fields[k]])));
}
export const profileApprovalSubject = fields => "form-profile:" + profileHash(fields);

// ---------------------------------------------------------------- parsing ----------------------------------------------------------------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = s => String(s).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (m, e) => { if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; } return ENT[e.toLowerCase()] ?? m; });
function attrs(s) {
  const out = {}; const re = /([^\s=\/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g; let m, n = 0;
  while ((m = re.exec(s)) && n++ < 100) { const k = m[1].toLowerCase(); if (!(k in out) && k !== "__proto__") out[k] = decode(m[2] ?? m[3] ?? m[4] ?? ""); }
  return out;
}
const textOf = s => clip(decode(String(s).replace(/<[^>]*>/g, " ")), LIMITS.maxLabelChars);

/** Parse an HTML form (no DOM, no script execution). Returns {ok, fields, submits} or {ok:false, reason}. */
export function parseFormHtml(html) {
  if (typeof html !== "string") return { ok: false, reason: "HTML_REQUIRED" };
  if (Buffer.byteLength(html) > LIMITS.maxHtmlBytes) return { ok: false, reason: "HTML_TOO_LARGE" };
  const src = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const fields = [], submits = [], labelsFor = {}, re = /<(\/?)(form|input|select|option|textarea|label|button)\b([^>]*)>/gi;
  let m, label = null, select = null, opt = null, area = null, button = null;
  const add = f => { if (fields.length < LIMITS.maxFields) fields.push(f); };
  while ((m = re.exec(src))) {
    const close = m[1] === "/", tag = m[2].toLowerCase(), a = close ? {} : attrs(m[3]), after = re.lastIndex;
    if (tag === "label") { if (!close) label = { for: a.for ?? null, start: after, fields: [] }; else if (label) { const t = textOf(src.slice(label.start, m.index)); if (label.for) labelsFor[label.for] = t; for (const f of label.fields) if (!f.label) f.label = t; label = null; } continue; }
    if (tag === "option") { if (opt && select) { opt.label = textOf(src.slice(opt.start, m.index)); select.options.push(opt); opt = null; } if (!close && select && select.options.length < LIMITS.maxOptions) opt = { value: a.value, start: after }; continue; }
    if (tag === "select") { if (!close) { select = norm({ ...a, tag: "select", type: "select" }); select.options = []; if (label) label.fields.push(select); } else if (select) { if (opt) { opt.label = textOf(src.slice(opt.start, m.index)); select.options.push(opt); opt = null; } select.options = select.options.map(o => ({ value: o.value ?? o.label, label: o.label })); add(select); select = null; } continue; }
    if (tag === "textarea") { if (!close) { area = norm({ ...a, tag: "textarea", type: "textarea" }); if (label) label.fields.push(area); add(area); } else area = null; continue; }
    if (tag === "button") { if (!close) button = { type: (a.type ?? "submit").toLowerCase(), start: after, name: a.name ?? null }; else if (button) { if (button.type === "submit") submits.push({ tag: "button", text: textOf(src.slice(button.start, m.index)), name: button.name }); button = null; } continue; }
    if (tag === "input" && !close) {
      const type = (a.type ?? "text").toLowerCase();
      if (["submit", "image"].includes(type)) { submits.push({ tag: "input", text: clip(a.value ?? type, 80), name: a.name ?? null }); continue; }
      if (["reset", "button"].includes(type)) continue;
      const f = norm({ ...a, tag: "input", type }); if (label) { label.fields.push(f); if (!f.label) f.label = textOf(src.slice(label.start, m.index)); } add(f);
    }
  }
  for (const f of fields) if (!f.label && f.id && labelsFor[f.id]) f.label = labelsFor[f.id];
  return { ok: true, fields, submits, truncated: fields.length >= LIMITS.maxFields };
}
function norm(a) {
  const num = v => (v === undefined || v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  return { tag: a.tag ?? "input", type: String(a.type ?? "text").toLowerCase().slice(0, 30), name: a.name ? clip(a.name, 100) : null, id: a.id ? clip(a.id, 100) : null,
    label: a.label ? clip(a.label, LIMITS.maxLabelChars) : a["aria-label"] ? clip(a["aria-label"], LIMITS.maxLabelChars) : null, placeholder: a.placeholder ? clip(a.placeholder, 100) : null,
    autocomplete: a.autocomplete ? clip(a.autocomplete, 60).toLowerCase() : null, required: a.required !== undefined && a.required !== false && a.required !== "false",
    hidden: (a.hidden !== undefined && a.hidden !== false && a.hidden !== "false") || a["aria-hidden"] === "true" || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(String(a.style ?? "")),
    pattern: typeof a.pattern === "string" ? a.pattern.slice(0, 300) : null, maxLength: num(a.maxlength ?? a.maxLength), minLength: num(a.minlength ?? a.minLength),
    ...(Array.isArray(a.options) ? { options: a.options.slice(0, LIMITS.maxOptions).map(o => (typeof o === "object" && o ? { value: String(o.value ?? o.label ?? ""), label: clip(o.label ?? o.value, 100) } : { value: String(o), label: clip(o, 100) })) } : {}) };
}
/** JSON description: {fields:[{name,id,type,label,autocomplete,required,pattern,maxLength,minLength,options}], submits?:[...]} */
export function parseFormJson(desc) {
  if (!desc || typeof desc !== "object" || !Array.isArray(desc.fields)) return { ok: false, reason: "FIELDS_ARRAY_REQUIRED" };
  if (desc.fields.length > LIMITS.maxFields) return { ok: false, reason: "TOO_MANY_FIELDS" };
  const fields = [], submits = [];
  for (const f of desc.fields) {
    if (!f || typeof f !== "object" || Array.isArray(f)) return { ok: false, reason: "FIELD_INVALID" };
    const t = String(f.type ?? "text").toLowerCase();
    if (["submit", "image"].includes(t)) { submits.push({ tag: "json", text: clip(f.label ?? f.name ?? t, 80), name: f.name ?? null }); continue; }
    fields.push(norm({ ...f, tag: f.tag ?? (t === "select" ? "select" : t === "textarea" ? "textarea" : "input") }));
  }
  return { ok: true, fields, submits };
}

// ---------------------------------------------------------------- classification ----------------------------------------------------------------
/** Semantic type of one field. Refusal rules are checked FIRST and against every descriptive attribute. */
export function classifyField(f) {
  const ac = String(f.autocomplete ?? "").split(/\s+/).filter(t => !/^(?:section-|shipping|billing|home|work|mobile|fax|pager|on|off)/.test(t)).pop() ?? "";
  const words = [f.name, f.id, f.label, f.placeholder, f.autocomplete].filter(Boolean).map(String).join(" | ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  if (f.type === "password") return { semantic: "PASSWORD", refused: true };
  if (f.type === "hidden" || f.hidden === true) return { semantic: "HIDDEN", skip: true };      // includes honeypots hidden by attribute or inline style
  if (/^cc-/.test(ac)) return { semantic: "PAYMENT_CARD", refused: true };
  if (ac === "one-time-code") return { semantic: "OTP", refused: true };
  if (ac === "current-password" || ac === "new-password") return { semantic: "PASSWORD", refused: true };
  for (const [t, re] of REFUSE_RULES) if (re.test(words)) return { semantic: t, refused: true };
  if (f.type === "file") return { semantic: "FILE_UPLOAD", owner: true };
  if (f.type === "checkbox" || f.type === "radio") return CONSENT.test(words) ? { semantic: "CONSENT", owner: true } : { semantic: "CHOICE", owner: true };
  if (AUTOCOMPLETE[ac]) return { semantic: AUTOCOMPLETE[ac] };
  if (f.type === "email") return { semantic: "EMAIL" }; if (f.type === "tel") return { semantic: "PHONE" }; if (f.type === "url") return { semantic: "WEBSITE" };
  for (const [t, re] of KEYWORDS) if (re.test(words)) return { semantic: t };
  if (f.tag === "textarea") return { semantic: "FREE_TEXT", owner: true };
  return { semantic: "UNKNOWN", owner: true };
}

// ---------------------------------------------------------------- validation ----------------------------------------------------------------
const POSTAL = { HU: /^\d{4}$/, US: /^\d{5}(?:-\d{4})?$/, CA: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i, GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i, DE: /^\d{5}$/, AT: /^\d{4}$/ };
const COUNTRY_CODE = { hungary: "HU", "magyarország": "HU", "united states": "US", usa: "US", canada: "CA", "united kingdom": "GB", germany: "DE", austria: "AT" };
/** A form-supplied pattern is untrusted: evaluated only when short and free of nested quantifiers / backreferences (ReDoS guard). */
export function safePattern(p) {
  if (typeof p !== "string" || !p || p.length > 100) return null;
  if (/\\[1-9]|\\k</.test(p) || /\([^)]*[+*}][^)]*\)\s*[+*{]/.test(p) || /\)\s*\{\d*,\d*\}\s*[+*{]/.test(p)) return null;
  try { return new RegExp("^(?:" + p + ")$", "u"); } catch { return null; }
}
function validateValue(sem, value, f, profile) {
  const errors = [], warnings = [], v = String(value);
  if (/[\u0000-\u001f\u007f]/.test(v) && !(f.tag === "textarea" && !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(v))) errors.push("CONTROL_CHARACTERS");
  if (v.length > LIMITS.maxValueChars) errors.push("VALUE_TOO_LONG");
  if (f.maxLength !== null && f.maxLength >= 0 && v.length > f.maxLength) errors.push("EXCEEDS_MAXLENGTH:" + f.maxLength);
  if (f.minLength !== null && v.length < f.minLength) errors.push("BELOW_MINLENGTH:" + f.minLength);
  if (sem === "EMAIL" && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/.test(v)) errors.push("EMAIL_FORMAT");
  if (sem === "PHONE" && !/^\+?[0-9 ()./-]{6,20}$/.test(v)) errors.push("PHONE_FORMAT");
  if (sem === "WEBSITE" && !/^https?:\/\/[^\s/$.?#][^\s]{1,300}$/i.test(v)) errors.push("URL_FORMAT");
  if (sem === "BIRTH_DATE") { const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v), t = d && new Date(v + "T00:00:00Z"); if (!d || isNaN(t) || t.toISOString().slice(0, 10) !== v) errors.push("DATE_FORMAT_YYYY_MM_DD"); }
  if (sem === "POSTAL_CODE") { const cc = String(profile.countryCode ?? COUNTRY_CODE[String(profile.country ?? "").toLowerCase()] ?? "").toUpperCase(); if (POSTAL[cc] && !POSTAL[cc].test(v)) errors.push("POSTAL_CODE_FORMAT_" + cc); else if (!POSTAL[cc]) warnings.push("POSTAL_FORMAT_NOT_CHECKED"); }
  if (f.pattern) { const re = safePattern(f.pattern); if (!re) warnings.push("FORM_PATTERN_NOT_EVALUATED"); else if (!re.test(v)) errors.push("PATTERN_MISMATCH"); }
  if (containsSecret(v)) errors.push("VALUE_LOOKS_LIKE_A_CREDENTIAL");
  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------- plan ----------------------------------------------------------------
/**
 * buildFillPlan({form: html|{fields}, profile: {id, fields, approval}, ownerAuth, submit?}) -> dry-run plan. Never throws, never fills, never submits.
 * ownerAuth: owner-auth instance (verifyRecorded). Without it, or without a valid signature over this exact profile, the plan is refused.
 */
export function buildFillPlan({ form, profile, ownerAuth = null, submit = false } = {}) {
  const base = { status: "PLAN_ONLY", submitted: false, submitAllowed: false, filled: false, note: "Dry-run plan. Nothing was typed into or submitted to any form; a person must review and act." };
  try {
    if (submit) return { ok: false, reason: "SUBMIT_NOT_SUPPORTED", ...base };
    if (!profile || typeof profile !== "object" || !profile.fields || typeof profile.fields !== "object" || Array.isArray(profile.fields)) return { ok: false, reason: "PROFILE_REQUIRED", ...base };
    const subject = profileApprovalSubject(profile.fields);
    if (!ownerAuth || typeof ownerAuth.verifyRecorded !== "function") return { ok: false, reason: "PROFILE_APPROVAL_UNVERIFIABLE", ...base };
    if (!ownerAuth.verifyRecorded(profile.approval, { action: PROFILE_APPROVAL_ACTION, subject })) return { ok: false, reason: "PROFILE_NOT_OWNER_APPROVED", profileHash: subject.slice(13), ...base };
    const parsed = typeof form === "string" ? parseFormHtml(form) : parseFormJson(form);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, ...base };
    const P = profile.fields, plan = [];
    for (const f of parsed.fields) {
      const c = classifyField(f), field = { name: f.name, id: f.id, label: f.label, type: f.type };
      if (c.refused) { plan.push({ field, semantic: c.semantic, action: "REFUSED", reason: "SENSITIVE_FIELD_" + c.semantic, value: null }); continue; }
      if (c.skip) { plan.push({ field, semantic: c.semantic, action: "SKIP", reason: "HIDDEN_FIELD", value: null }); continue; }
      if (c.owner) { plan.push({ field, semantic: c.semantic, action: "NEEDS_OWNER_INPUT", reason: c.semantic === "CONSENT" ? "CONSENT_IS_AN_OWNER_DECISION" : "NO_PROFILE_MAPPING", value: null, required: f.required }); continue; }
      let key = PROFILE_KEYS[c.semantic], value = typeof P[key] === "string" ? P[key] : null;
      if (c.semantic === "FULL_NAME" && value === null && typeof P.givenName === "string" && typeof P.familyName === "string") { value = P.givenName + " " + P.familyName; key = "givenName+familyName"; }
      if (value === null || !value.trim()) { plan.push({ field, semantic: c.semantic, action: "NEEDS_OWNER_INPUT", reason: f.required ? "MISSING_REQUIRED_VALUE" : "NO_VALUE_IN_PROFILE", value: null, required: f.required }); continue; }
      if (Array.isArray(f.options)) {
        const o = f.options.find(x => x.value === value) ?? f.options.find(x => x.label.toLowerCase() === value.toLowerCase() || String(x.value).toLowerCase() === value.toLowerCase());
        if (!o) { plan.push({ field, semantic: c.semantic, action: "NEEDS_OWNER_INPUT", reason: "NO_MATCHING_OPTION", value: null, source: "profile." + key }); continue; }
        value = o.value;
      }
      const validation = validateValue(c.semantic, value, f, P);
      plan.push({ field, semantic: c.semantic, action: validation.ok ? "FILL" : "NEEDS_OWNER_INPUT", reason: validation.ok ? null : "VALIDATION_FAILED", value: validation.ok ? value : null, source: "profile." + key, validation });
    }
    const count = a => plan.filter(p => p.action === a).length;
    return { ok: true, ...base, profileId: profile.id ?? null, profileHash: subject.slice(13), plan, submitsDetected: parsed.submits.length, submitButtons: parsed.submits.map(s => s.text),
      summary: { fields: plan.length, fill: count("FILL"), refused: count("REFUSED"), needsOwner: count("NEEDS_OWNER_INPUT"), skipped: count("SKIP") }, truncated: parsed.truncated === true };
  } catch { return { ok: false, reason: "INPUT_INVALID", ...base }; }
}
