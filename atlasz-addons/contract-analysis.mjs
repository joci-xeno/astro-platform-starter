// Contract clause analysis (PKG150 OP09 complex contract analysis, O510 multi-document contract analysis; capability G07).
// DETERMINISTIC pattern baseline over supplied text (or a DOCX/PDF/ODT/RTF buffer through doc-extractors). No model, no network, nothing executed.
// Every result carries LEGAL_REVIEW_REQUIRED. This module never states that a contract, clause or document is acceptable or risk-free: a missing flag means
// only that a pattern did not match. Every flag that points at text carries the exact quoted span and its character offsets in the ORIGINAL text.
// Honest limits: English + some Hungarian keywords; numbered/paragraph clause splitting; no understanding of definitions, cross-references, schedules,
// amendments or jurisdiction-specific enforceability. Tables and scanned documents are not read.
import { extractBuffer } from "./doc-extractors.mjs";

export const LEGAL_REVIEW_REQUIRED = "LEGAL_REVIEW_REQUIRED";
export const BANNER = "LEGAL_REVIEW_REQUIRED - automated pattern detection only, NOT legal advice. A missing flag does not mean a clause is acceptable or that the document is free of risk. A qualified lawyer must review the full documents before anything is signed or relied on.";
export const LIMITS = Object.freeze({ maxChars: 500000, maxDocs: 10, maxClauses: 5000, maxClauseChars: 20000, maxQuoteChars: 400, maxFlags: 500 });
export const CATEGORIES = Object.freeze(["PAYMENT_TERMS", "TERMINATION", "LIABILITY_CAP", "INDEMNITY", "IP_ASSIGNMENT", "CONFIDENTIALITY", "GOVERNING_LAW", "AUTO_RENEWAL", "NON_COMPETE", "PENALTIES"]);

// Bounded gaps ([^.\n]{0,N}) keep every pattern linear per start position; no nested quantifiers.
const RULES = {
  PAYMENT_TERMS: /\b(?:payments?|invoices?|fees?|amounts? due)\b[^.\n]{0,120}?\b(?:within|net)\s*\d{1,3}\b|\bnet\s*\d{1,3}\b|\bpayment terms?\b|fizetési határid|\d{1,3}\s*napon belül[^.\n]{0,40}fizet/i,
  TERMINATION: /\bterminat(?:e|es|ed|ion)\b|\bfelmond|\bmegszűn/i,
  LIABILITY_CAP: /\blimitation of liability\b|\b(?:aggregate|total|maximum)\s+liability\b|\bliability\b[^.\n]{0,80}?\b(?:shall not exceed|limited to|capped at|unlimited)\b|\bin no event\b[^.\n]{0,80}?\bliab|\bunlimited liability\b|felelősség[^.\n]{0,60}?(?:korlátoz|nem haladhatja meg)/i,
  INDEMNITY: /\bindemnif(?:y|ies|ied|ication)\b|\bhold harmless\b|kártalanít|helytállni köteles/i,
  IP_ASSIGNMENT: /\b(?:assigns?|assignment|transfers?|vests?)\b[^.\n]{0,100}?\b(?:intellectual property|copyrights?|patents?|IP rights|work product|deliverables|inventions)\b|\bwork(?:s)? made for hire\b|szellemi tulajdon|vagyoni jog[^.\n]{0,40}átszáll/i,
  CONFIDENTIALITY: /\bconfidential(?:ity)?\b|\bnon-disclosure\b|\btitoktartás|\bbizalmas/i,
  GOVERNING_LAW: /\bgoverned by\b[^.\n]{0,40}?\blaws? of\b|\bgoverning law\b|\birányadó jog/i,
  AUTO_RENEWAL: /\bautomatically renew|\bauto-?renew|\brenew(?:s|ed)? automatically\b|\bsuccessive (?:renewal )?(?:terms|periods)\b|\bevergreen\b|automatikusan meghosszabbod/i,
  NON_COMPETE: /\bnon-?compet(?:e|ition)\b|\bnot\s+(?:to\s+)?(?:directly or indirectly\s+)?(?:compete|engage in any (?:competing|competitive))|\bversenytilal/i,
  PENALTIES: /\bliquidated damages\b|\bpenalt(?:y|ies)\b|\blate (?:payment )?(?:fee|charge|interest)s?\b|\blate payments?\b[^.\n]{0,40}?\b(?:interest|fee|charge)|\bkötbér|\bkésedelmi kamat/i
};
const PRECEDENCE = /\border of precedence\b|\bshall (?:prevail|control|govern) (?:over|in the event of)|\btakes? precedence\b|\belsőbbség/i;

const num = s => Number(String(s).replace(/,/g, ""));
const ATTR = {
  PAYMENT_TERMS: q => { const m = /\b(?:net\s*|within\s+)(\d{1,3})\b/i.exec(q) ?? /(\d{1,3})\s*napon belül/i.exec(q); return m ? { paymentDays: num(m[1]) } : {}; },
  TERMINATION: q => { const m = /(\d{1,3})\s*(?:\(\w+\)\s*)?(?:calendar\s+|business\s+)?days?['’]?\s*(?:prior\s+)?(?:written\s+)?notice/i.exec(q) ?? /notice of (?:at least )?(\d{1,3})\s*days/i.exec(q) ?? /(\d{1,3})\s*napos felmond/i.exec(q);
    return { ...(m ? { noticeDays: num(m[1]) } : {}), ...(/\b(?:may|can)\s+terminate\b[^.\n]{0,100}?\b(?:at any time|for convenience|without cause|for any reason)/i.test(q) ? { forConvenience: true } : {}) }; },
  LIABILITY_CAP: q => { const unlimited = /\bunlimited liability\b|\bliability\b[^.\n]{0,40}?\b(?:is|shall be)\s+unlimited\b|\bwithout (?:any )?limit(?:ation)?\b/i.test(q);
    const a = /(?:exceed|limited to|capped at)\s*(?:the (?:lesser|greater) of\s*)?(?:(USD|EUR|HUF|CAD|GBP|[$€£])\s?)?([\d][\d,]*(?:\.\d+)?)\s*(USD|EUR|HUF|CAD|GBP|Ft)?/i.exec(q);
    const mult = /(\d+(?:\.\d+)?)\s*(?:x|times)\s*(?:the\s+)?(?:total\s+)?(?:fees|amounts?)/i.exec(q), months = /fees paid[^.\n]{0,40}?(?:preceding|prior|last)\s*(\d{1,2})\s*months/i.exec(q);
    return { ...(unlimited ? { unlimited: true } : {}), ...(a ? { capAmount: num(a[2]), capCurrency: (a[1] ?? a[3] ?? null) } : {}), ...(mult ? { capMultipleOfFees: Number(mult[1]) } : {}), ...(months ? { capFeesMonths: num(months[1]) } : {}) }; },
  INDEMNITY: q => (/\bnotwithstanding\b[^.\n]{0,80}?\blimit|\bunlimited\b|\bwithout (?:any )?limit|\bany and all\b/i.test(q) ? { uncapped: true } : {}),
  IP_ASSIGNMENT: q => (/\bpre-?existing\b|\bbackground (?:IP|technology|intellectual property)\b|\bwhether or not\b[^.\n]{0,40}?\b(?:related|during|working hours)|\ball (?:inventions|works|ideas)\b[^.\n]{0,80}?\b(?:conceived|created|developed)\b/i.test(q) ? { broad: true } : {}),
  CONFIDENTIALITY: q => { const p = /\bperpetu|\bindefinite(?:ly)?\b|\bin perpetuity\b|\bhatározatlan ideig/i.test(q); const y = /(\d{1,2})\s*(?:\(\w+\)\s*)?(?:years?|év)/i.exec(q); return { ...(p ? { perpetual: true } : {}), ...(y ? { years: num(y[1]) } : {}) }; },
  GOVERNING_LAW: q => { const m = /\blaws? of\s+(?:the\s+)?(?:State of\s+|Province of\s+|Commonwealth of\s+)?([A-Z][A-Za-z .'-]{1,60}?)(?=[,.;(\n]|\s+(?:and|without|excluding|including)\b|$)/.exec(q) ?? /irányadó jog\s*:?\s*(?:az?\s+)?([A-ZÁÉÍÓÖŐÚÜŰa-záéíóöőúüű ]{2,40}?)(?=[,.;\n]|$)/i.exec(q);
    return m ? { jurisdiction: m[1].trim().replace(/\s+/g, " ") } : {}; },
  AUTO_RENEWAL: q => { const m = /(\d{1,3})\s*days?\b[^.\n]{0,80}?\b(?:prior to|before)\b[^.\n]{0,60}?\b(?:renewal|end of the|expiration|expiry)/i.exec(q); return m ? { optOutNoticeDays: num(m[1]) } : {}; },
  NON_COMPETE: q => { const m = /(\d{1,2})\s*(?:\(\w+\)\s*)?(months?|years?|hónap|év)/i.exec(q); return m ? { months: num(m[1]) * (/^(?:year|év)/i.test(m[2]) ? 12 : 1) } : {}; },
  PENALTIES: q => { const p = /(\d{1,3}(?:\.\d+)?)\s*%\s*(per month|monthly|a month|per annum|per year|annually|havonta|évi)?/i.exec(q); return p ? { percent: Number(p[1]), period: p[2] ? (/month|havonta/i.test(p[2]) ? "MONTH" : "YEAR") : null } : {}; }
};

/** Split into clauses on numbered headings / blank lines. Offsets are into the ORIGINAL text. */
export function splitClauses(text) {
  const out = [], heading = /^\s{0,8}(?:(?:Section|Article|Clause|Cikk|Pont)\s+\d{1,3}|\d{1,3}(?:\.\d{1,3}){0,3}\.?|[IVXLC]{1,6}\.|\([a-z0-9]{1,3}\))\s+\S/i;
  let start = 0, pos = 0, prevBlank = true;
  const push = end => { if (out.length >= LIMITS.maxClauses) return; const seg = text.slice(start, end); if (!seg.trim()) return;
    for (let s = start; s < end && out.length < LIMITS.maxClauses; s += LIMITS.maxClauseChars) out.push({ index: out.length, start: s, end: Math.min(end, s + LIMITS.maxClauseChars) }); };
  while (pos <= text.length) {
    const nl = text.indexOf("\n", pos), lineEnd = nl < 0 ? text.length : nl, line = text.slice(pos, lineEnd);
    const blank = !line.trim();
    if (pos > start && ((heading.test(line) && !blank) || (prevBlank && !blank && pos > start))) { push(pos); start = pos; }
    prevBlank = blank; if (nl < 0) break; pos = nl + 1;
  }
  push(text.length);
  return out.map(c => ({ ...c, heading: text.slice(c.start, c.end).trim().split("\n")[0].slice(0, 80) }));
}
/** The sentence around [i, j) inside [lo, hi), capped. Returns absolute offsets; quote === text.slice(start, end). */
function sentence(text, lo, hi, i, j) {
  let s = i; while (s > lo && i - s < LIMITS.maxQuoteChars / 2 && !/[.;!?\n]/.test(text[s - 1])) s--;
  let e = j; while (e < hi && e - i < LIMITS.maxQuoteChars && !/[.;!?\n]/.test(text[e])) e++;
  if (e < hi && /[.;!?]/.test(text[e])) e++;
  while (s < e && /\s/.test(text[s])) s++; while (e > s && /\s/.test(text[e - 1])) e--;
  return { quote: text.slice(s, e), start: s, end: e };
}

/** First match whose sentence is more than a bare heading (e.g. "Non-Competition."); falls back to the first match. Max 8 tries. */
function bestMatch(re, text, lo, hi) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), body = text.slice(lo, hi); let firstEv = null, m, n = 0;
  while ((m = g.exec(body)) && n++ < 8) {
    const ev = sentence(text, lo, hi, lo + m.index, lo + m.index + m[0].length); firstEv ??= ev;
    if (ev.quote.length >= 25) return ev;
    if (m[0].length === 0) g.lastIndex++;
  }
  return firstEv;
}
function loadText(input) {
  if (typeof input === "string") return { ok: true, id: "doc-1", text: input };
  if (!input || typeof input !== "object") return { ok: false, reason: "INPUT_REQUIRED" };
  const id = String(input.id ?? "doc-1").slice(0, 80);
  if (typeof input.text === "string") return { ok: true, id, text: input.text };
  if (Buffer.isBuffer(input.buffer)) { const r = extractBuffer(input.buffer, input.ext ?? ""); return r.ok ? { ok: true, id, text: r.text, extracted: { ext: input.ext, truncated: r.truncated ?? false } } : { ok: false, id, reason: "EXTRACTION_FAILED:" + r.code }; }
  return { ok: false, id, reason: "TEXT_OR_BUFFER_REQUIRED" };
}
const wrap = o => ({ banner: BANNER, legalReviewRequired: true, notLegalAdvice: true, assessment: "NOT_A_RISK_CLEARANCE", method: "DETERMINISTIC_PATTERN_BASELINE", ...o });

/** analyzeContract("text" | {id, text} | {id, buffer, ext}) -> never throws. */
export function analyzeContract(input) {
  try { return analyze0(input); } catch { return wrap({ ok: false, docId: null, reason: "INPUT_INVALID" }); }
}
function analyze0(input) {
  const src = loadText(input);
  if (!src.ok) return wrap({ ok: false, docId: src.id ?? null, reason: src.reason });
  const text = src.text;
  if (text.length > LIMITS.maxChars) return wrap({ ok: false, docId: src.id, reason: "TOO_LARGE" });
  if (!text.trim()) return wrap({ ok: false, docId: src.id, reason: "EMPTY" });
  const clauses = splitClauses(text), detections = [], attributes = {}, flags = [];
  for (const c of clauses) {
    const body = text.slice(c.start, c.end);
    for (const cat of CATEGORIES) {
      const ev = bestMatch(RULES[cat], text, c.start, c.end); if (!ev) continue;
      const attrs = { ...ATTR[cat](body), ...ATTR[cat](ev.quote) };            // the matched sentence wins over the rest of the clause
      detections.push({ category: cat, clauseIndex: c.index, heading: c.heading, clause: { start: c.start, end: c.end }, evidence: ev, attributes: attrs });
      attributes[cat] ??= []; attributes[cat].push({ ...attrs, clauseIndex: c.index, evidence: ev });
    }
  }
  const flag = (code, severity, category, evidence, note) => { if (flags.length < LIMITS.maxFlags) flags.push({ code, severity, category, evidence: evidence ?? null, note }); };
  const found = cat => detections.filter(d => d.category === cat);
  const at = (d, re) => bestMatch(re, text, d.clause.start, d.clause.end) ?? d.evidence;      // quote the sentence that triggered the flag
  for (const d of found("LIABILITY_CAP")) if (d.attributes.unlimited) flag("UNLIMITED_LIABILITY", "HIGH", "LIABILITY_CAP", at(d, /unlimited|without (?:any )?limit/i), "Liability is stated as unlimited or without limit.");
  if (!found("LIABILITY_CAP").some(d => d.attributes.capAmount !== undefined || d.attributes.capMultipleOfFees !== undefined || d.attributes.capFeesMonths !== undefined)) flag("NO_LIABILITY_CAP_FOUND", "MEDIUM", "LIABILITY_CAP", null, "No liability cap amount was recognised (absence of a pattern, not proof that no cap exists).");
  for (const d of found("INDEMNITY")) if (d.attributes.uncapped) flag("UNCAPPED_INDEMNITY", "HIGH", "INDEMNITY", at(d, /notwithstanding|unlimited|without (?:any )?limit|any and all/i), "Indemnity appears to apply notwithstanding limits, or 'any and all' claims.");
  for (const d of found("PAYMENT_TERMS")) if (d.attributes.paymentDays > 60) flag("LONG_PAYMENT_TERMS", "MEDIUM", "PAYMENT_TERMS", at(d, new RegExp("\\b(?:net\\s*|within\\s+)" + d.attributes.paymentDays + "\\b|" + d.attributes.paymentDays + "\\s*napon", "i")), "Payment due later than 60 days (" + d.attributes.paymentDays + ").");
  for (const d of found("AUTO_RENEWAL")) { flag("AUTO_RENEWAL", "MEDIUM", "AUTO_RENEWAL", d.evidence, "The term renews automatically unless cancelled."); if (d.attributes.optOutNoticeDays >= 60) flag("AUTO_RENEWAL_LONG_OPT_OUT_NOTICE", "MEDIUM", "AUTO_RENEWAL", at(d, /\d{1,3}\s*days?\b[^.\n]{0,80}?\b(?:prior to|before)/i), "Cancellation notice of " + d.attributes.optOutNoticeDays + " days before renewal."); }
  for (const d of found("TERMINATION")) if (d.attributes.forConvenience) flag("TERMINATION_FOR_CONVENIENCE", "MEDIUM", "TERMINATION", at(d, /\b(?:may|can)\s+terminate\b[^.\n]{0,100}?\b(?:at any time|for convenience|without cause|for any reason)/i), "A party may terminate at any time / without cause; check whether this is one-sided.");
  if (!found("TERMINATION").length) flag("NO_TERMINATION_CLAUSE_FOUND", "MEDIUM", "TERMINATION", null, "No termination wording was recognised.");
  for (const d of found("IP_ASSIGNMENT")) if (d.attributes.broad) flag("BROAD_IP_ASSIGNMENT", "HIGH", "IP_ASSIGNMENT", at(d, /pre-?existing|background (?:IP|technology|intellectual property)|whether or not|all (?:inventions|works|ideas)/i), "Assignment may reach pre-existing/background IP or work outside the engagement.");
  for (const d of found("CONFIDENTIALITY")) if (d.attributes.perpetual) flag("PERPETUAL_CONFIDENTIALITY", "LOW", "CONFIDENTIALITY", at(d, /perpetu|indefinite|határozatlan ideig/i), "Confidentiality obligation without an end date.");
  for (const d of found("NON_COMPETE")) flag(d.attributes.months > 12 ? "NON_COMPETE_LONG" : "NON_COMPETE", d.attributes.months > 12 ? "HIGH" : "MEDIUM", "NON_COMPETE", at(d, /\d{1,2}\s*(?:\(\w+\)\s*)?(?:months?|years?|hónap|év)/i), d.attributes.months ? "Non-compete for " + d.attributes.months + " months." : "Non-compete restriction present; duration not recognised.");
  for (const d of found("PENALTIES")) { flag("PENALTY_OR_LIQUIDATED_DAMAGES", "MEDIUM", "PENALTIES", d.evidence, "Penalty, liquidated damages or late charge."); if (d.attributes.period === "MONTH" && d.attributes.percent > 1.5 || d.attributes.period === "YEAR" && d.attributes.percent > 18) flag("HIGH_LATE_CHARGE_RATE", "MEDIUM", "PENALTIES", at(d, /\d{1,3}(?:\.\d+)?\s*%/), d.attributes.percent + "% per " + d.attributes.period.toLowerCase() + "."); }
  if (!found("GOVERNING_LAW").length) flag("NO_GOVERNING_LAW_FOUND", "LOW", "GOVERNING_LAW", null, "No governing-law wording was recognised.");
  const am = bestMatch(/\b(?:may|can|reserves the right to)\s+(?:unilaterally\s+)?(?:amend|modify|change)\b[^.\n]{0,80}?\b(?:at any time|sole discretion|without notice)/i, text, 0, text.length);
  if (am) flag("UNILATERAL_AMENDMENT", "HIGH", null, am, "One party may change the terms on its own.");
  const pm = bestMatch(PRECEDENCE, text, 0, text.length);
  const coverage = Object.fromEntries(CATEGORIES.map(c => [c, found(c).length > 0]));
  return wrap({ ok: true, docId: src.id, chars: text.length, clauseCount: clauses.length, coverage, detections, attributes, flags,
    precedence: pm, ...(src.extracted ? { extracted: src.extracted } : {}),
    limits: "Pattern baseline (EN + some HU). Definitions, cross-references, schedules and enforceability are NOT analysed." });
}

const first = (a, k) => (a ?? []).find(x => x[k] !== undefined);
const ATTR_COMPARE = [["PAYMENT_TERMS", "paymentDays"], ["TERMINATION", "noticeDays"], ["LIABILITY_CAP", "capAmount"], ["LIABILITY_CAP", "capMultipleOfFees"], ["GOVERNING_LAW", "jurisdiction"], ["CONFIDENTIALITY", "years"], ["NON_COMPETE", "months"], ["AUTO_RENEWAL", "optOutNoticeDays"], ["PENALTIES", "percent"]];
/** compareContracts([doc, doc, ...]) - clause presence matrix, attribute differences, and CONFLICTS (two documents state different values for the same term). */
export function compareContracts(docs) {
  if (!Array.isArray(docs) || docs.length < 2) return wrap({ ok: false, reason: "AT_LEAST_TWO_DOCUMENTS_REQUIRED" });
  if (docs.length > LIMITS.maxDocs) return wrap({ ok: false, reason: "TOO_MANY_DOCUMENTS" });
  const results = docs.map((d, i) => analyzeContract(typeof d === "string" ? { id: "doc-" + (i + 1), text: d } : { id: "doc-" + (i + 1), ...d }));
  const failed = results.filter(r => !r.ok); if (failed.length) return wrap({ ok: false, reason: "DOCUMENT_FAILED", failures: failed.map(r => ({ docId: r.docId, reason: r.reason })) });
  const ids = results.map(r => r.docId); if (new Set(ids).size !== ids.length) return wrap({ ok: false, reason: "DUPLICATE_DOCUMENT_IDS" });
  const matrix = Object.fromEntries(CATEGORIES.map(c => [c, Object.fromEntries(results.map(r => [r.docId, r.coverage[c]]))]));
  const conflicts = [], onlyInSome = [];
  for (const c of CATEGORIES) { const have = results.filter(r => r.coverage[c]).map(r => r.docId); if (have.length && have.length < results.length) onlyInSome.push({ category: c, presentIn: have, absentFrom: ids.filter(i => !have.includes(i)) }); }
  for (const [cat, key] of ATTR_COMPARE) {
    const vals = results.map(r => { const a = first(r.attributes[cat], key); return a ? { docId: r.docId, value: a[key], evidence: a.evidence } : null; }).filter(Boolean);
    const norm = v => (typeof v === "string" ? v.toLowerCase() : v);
    if (new Set(vals.map(v => norm(v.value))).size > 1) conflicts.push({ code: "CONFLICT_" + cat + "_" + key.replace(/[A-Z]/g, ch => "_" + ch).toUpperCase(), category: cat, attribute: key, values: vals });
  }
  const precedence = results.filter(r => r.precedence).map(r => ({ docId: r.docId, evidence: r.precedence }));
  return wrap({ ok: true, documents: results.map(r => ({ docId: r.docId, clauseCount: r.clauseCount, flags: r.flags })), matrix, conflicts, onlyInSome, precedence,
    note: conflicts.length ? "Documents state different values for the same term. Which one governs depends on precedence wording and law - a lawyer must decide." : "No differing values were recognised for the compared attributes (pattern baseline only)." });
}
