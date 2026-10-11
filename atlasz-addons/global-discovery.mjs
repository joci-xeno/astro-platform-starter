// Global opportunity discovery (owner priority directive, Oct 2026): worldwide, multilingual, multi-currency, no fixed industry.
// What this module IS: (1) a source catalogue with honest access facts; (2) pure parsers for public formats; (3) pure assessment (listing kind, scam indicators, hard blockers, deadline, geography,
// requirement inference); (4) a fetch engine that can only talk to a source whose host the OWNER approved in the egress policy, over a DNS-pinned HTTPS transport, rate-limited per source.
// What it is NOT: a scraper of anything that needs a login, a payment, an account, or that forbids automated access. Those sources are catalogued as BLOCKED with the reason and are never fetched.
// Honesty rules: nothing is "connected" until a run against that source succeeded and was logged; operator-retrieved captures (a person or tool outside the ATLASZ runtime) are labelled
// OPERATOR_TOOL and never counted as connector retrieval; source text and any translation are kept apart; no exchange rate is ever invented (a conversion needs a supplied, dated, sourced rate).
// Catalogue facts come from the author's offline knowledge and are UNVERIFIED: re-check each source's current terms, API shape and rate limits before approving its host.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";
import { containsSecret, scrub } from "./secret-patterns.mjs";

export const CATALOGUE_EVIDENCE = "AUTHOR_KNOWLEDGE_OFFLINE_UNVERIFIED: access, terms and API facts as known at build time; verify before approving a host.";
export const DISCOVERY_LIMITS = Object.freeze({ maxResponseBytes: 2 * 1024 * 1024, maxItems: 100, maxText: 4000, minIntervalMs: 10_000, timeoutMs: 20_000, maxCaptureItems: 200 });
const sha = t => crypto.createHash("sha256").update(t).digest("hex");
const R = (reason, extra = {}) => ({ ok: false, reason, ...extra });

// access: PUBLIC (no account) | KEY_REQUIRED (free key/registration = owner action) | LOGIN_REQUIRED | TERMS_FORBID_AUTOMATION | PAID.   fetchable only when access === "PUBLIC" and a parser exists.
const S = (id, name, kind, regions, languages, hosts, access, o = {}) => Object.freeze({ id, name, kind, regions: Object.freeze(regions), languages: Object.freeze(languages), hosts: Object.freeze(hosts), access, format: o.format ?? null, jurisdiction: o.jurisdiction ?? "GLOBAL", currencyHint: o.currencyHint ?? null, url: o.url ?? null, queryTemplate: o.queryTemplate ?? null, attribution: o.attribution ?? null, notes: o.notes ?? "", blockedReason: o.blockedReason ?? null });
export const SOURCE_CATALOGUE = Object.freeze([
  S("find-a-tender-uk", "Find a Tender (UK)", "TENDER", ["Europe"], ["en"], ["www.find-tender.service.gov.uk"], "PUBLIC", { jurisdiction: "GB", currencyHint: "GBP", format: "OCDS_JSON", url: "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages", notes: "Public procurement notices; bidding needs a supplier registration (owner action)." }),
  S("contracts-finder-uk", "Contracts Finder (UK)", "TENDER", ["Europe"], ["en"], ["www.contractsfinder.service.gov.uk"], "PUBLIC", { jurisdiction: "GB", currencyHint: "GBP", format: "OCDS_JSON", url: "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search", notes: "Lower-value public contracts." }),
  S("ted-eu", "TED - Tenders Electronic Daily (EU)", "TENDER", ["Europe"], ["en", "fr", "de", "es", "it", "pl", "nl", "pt", "el", "sv", "cs", "hu", "ro", "bg", "da", "fi", "sk", "hr", "lt", "lv", "sl", "et", "ga", "mt"], ["api.ted.europa.eu"], "PUBLIC", { jurisdiction: "EU", format: null, notes: "NO_ADAPTER: the TED v3 search API is a POST query; this engine is GET-only by owner policy (EGRESS methods [GET]). Needs a reviewed POST extension and a separate owner approval. Notices are published in the buyer's language; keep original text." }),
  S("canadabuys", "CanadaBuys (Canada)", "TENDER", ["North America"], ["en", "fr"], ["canadabuys.canada.ca"], "PUBLIC", { jurisdiction: "CA", currencyHint: "CAD", format: null, notes: "NO_ADAPTER: open-data CSV column layout not yet verified from a real file (the operator fetch tool returned binary); parser not written to avoid guessing." }),
  S("sam-gov", "SAM.gov (United States federal)", "TENDER", ["North America"], ["en"], ["api.sam.gov"], "KEY_REQUIRED", { jurisdiction: "US", currencyHint: "USD", blockedReason: "Needs a free API key tied to an account registration: owner action." }),
  S("austender", "AusTender (Australia)", "TENDER", ["Oceania"], ["en"], ["www.tenders.gov.au"], "PUBLIC", { jurisdiction: "AU", currencyHint: "AUD", format: "RSS", notes: "Federal approaches to market." }),
  S("nz-gets", "GETS (New Zealand)", "TENDER", ["Oceania"], ["en"], ["www.gets.govt.nz"], "PUBLIC", { jurisdiction: "NZ", currencyHint: "NZD", format: "RSS", notes: "Government electronic tenders service." }),
  S("world-bank-procurement", "World Bank procurement notices", "TENDER", ["Africa", "Asia", "South America", "Middle East", "Europe"], ["en", "fr", "es"], ["search.worldbank.org"], "PUBLIC", { jurisdiction: "GLOBAL", format: "WB_JSON", url: "https://search.worldbank.org/api/v2/procnotices?format=json&rows=50&srt=noticedate&order=desc", notes: "Only consulting (CS) and non-consulting (NC) notices are kept; goods and works are skipped. Notices for bank-financed projects in many countries; eligibility rules per notice." }),
  S("ungm", "UN Global Marketplace", "TENDER", ["Africa", "Asia", "South America", "Middle East", "Europe", "North America", "Oceania"], ["en", "fr", "es"], ["www.ungm.org"], "LOGIN_REQUIRED", { blockedReason: "Vendor registration is required for most notices: owner action." }),
  S("etenders-za", "eTenders (South Africa)", "TENDER", ["Africa"], ["en"], ["www.etenders.gov.za"], "PUBLIC", { jurisdiction: "ZA", currencyHint: "ZAR", format: null, notes: "No parser yet: NO_ADAPTER." }),
  S("etimad-sa", "Etimad (Saudi Arabia)", "TENDER", ["Middle East"], ["ar", "en"], ["tenders.etimad.sa"], "LOGIN_REQUIRED", { jurisdiction: "SA", currencyHint: "SAR", blockedReason: "Registration and local commercial registration are typically required: owner action." }),
  S("gem-in", "GeM (India)", "TENDER", ["Asia"], ["en", "hi"], ["gem.gov.in"], "LOGIN_REQUIRED", { jurisdiction: "IN", currencyHint: "INR", blockedReason: "Seller registration needed; local entity rules likely apply: owner action." }),
  S("mercado-publico-cl", "Mercado Publico (Chile)", "TENDER", ["South America"], ["es"], ["api.mercadopublico.cl"], "KEY_REQUIRED", { jurisdiction: "CL", currencyHint: "CLP", blockedReason: "API ticket requires registration: owner action." }),
  S("remoteok", "Remote OK", "JOB_BOARD", ["Global"], ["en"], ["remoteok.com"], "PUBLIC", { jurisdiction: "GLOBAL", currencyHint: "USD", format: "REMOTEOK_JSON", url: "https://remoteok.com/api", attribution: "Link back to Remote OK and mention it as the source when showing listings.", notes: "Mostly employment listings: the assessment filters those out; contract/part-time freelance may remain." }),
  S("weworkremotely", "We Work Remotely", "JOB_BOARD", ["Global"], ["en"], ["weworkremotely.com"], "PUBLIC", { jurisdiction: "GLOBAL", format: "RSS", url: "https://weworkremotely.com/remote-jobs.rss", notes: "RSS feed; mostly employment." }),
  S("hn-algolia", "Hacker News (Algolia search API)", "COMMUNITY_BOARD", ["Global"], ["en"], ["hn.algolia.com"], "PUBLIC", { jurisdiction: "GLOBAL", format: "ALGOLIA_HN_JSON", url: "https://hn.algolia.com/api/v1/search_by_date", notes: "Monthly 'Freelancer? Seeking freelancer?' threads; the comments are the opportunities." }),
  S("upwork", "Upwork", "FREELANCE_MARKETPLACE", ["Global"], ["en"], ["www.upwork.com"], "TERMS_FORBID_AUTOMATION", { blockedReason: "Account required; terms restrict automated access. Use only through an owner-created account and the official API after owner authorisation." }),
  S("freelancer-com", "Freelancer.com", "FREELANCE_MARKETPLACE", ["Global"], ["en"], ["www.freelancer.com"], "KEY_REQUIRED", { blockedReason: "Official API needs an account/app registration: owner action." }),
  S("linkedin", "LinkedIn", "PROFESSIONAL_NETWORK", ["Global"], ["en"], ["www.linkedin.com"], "TERMS_FORBID_AUTOMATION", { blockedReason: "Terms forbid scraping and automated access." })
]);
export const REGION_LIST = Object.freeze(["North America", "South America", "Europe", "Asia", "Africa", "Middle East", "Oceania", "Global"]);

// ------------------------------------------------------------------ pure text helpers
const stripTags = h => {
  // linear scan (no backtracking regexes): drop <script>/<style> blocks and any tag; an unclosed "<" is kept as text
  let t = String(h ?? ""); if (t.length > 200000) t = t.slice(0, 200000); let out = "", i = 0; const low = t.toLowerCase();
  while (i < t.length) {
    const lt = t.indexOf("<", i); if (lt < 0) { out += t.slice(i); break; } out += t.slice(i, lt);
    const m = /^<(script|style)\b/.exec(low.slice(lt, lt + 8));
    if (m) { const end = low.indexOf("</" + m[1], lt); if (end < 0) { i = t.length; break; } const gt2 = t.indexOf(">", end); i = gt2 < 0 ? t.length : gt2 + 1; out += " "; continue; }
    const gt = t.indexOf(">", lt); if (gt < 0) { out += t.slice(lt); break; } out += " "; i = gt + 1;
  }
  return out.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
};
/** Linear block finder: all non-overlapping <tag ...> ... </tag> blocks, bounded. */
const blocks = (text, tag, max) => { const out = [], low = text.toLowerCase(), open = "<" + tag, close = "</" + tag + ">"; let i = 0; while (out.length < max) { const a = low.indexOf(open, i); if (a < 0) break; const nx = low[a + open.length]; if (nx !== undefined && !/[\s>\/]/.test(nx)) { i = a + open.length; continue; } const b = low.indexOf(close, a); if (b < 0) break; out.push(text.slice(a, b + close.length)); i = b + close.length; } return out; };
const inner = (block, tag) => { const low = block.toLowerCase(), a = low.indexOf("<" + tag); if (a < 0) return null; const nx = low[a + tag.length + 1]; if (nx !== undefined && !/[\s>\/]/.test(nx)) return null; const gt = low.indexOf(">", a); if (gt < 0) return null; const b = low.indexOf("</" + tag + ">", gt); return b < 0 ? null : block.slice(gt + 1, b); };
const clip = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, " ").trim().slice(0, n);
/** Canonical URL used for duplicate removal: https only, lower-case host, no fragment/query noise. */
export function canonicalUrl(u) { try { const x = new URL(String(u)); if (x.protocol !== "https:" || x.username || x.password || x.port) return null; x.hash = ""; for (const k of [...x.searchParams.keys()]) if (/^(utm_|origin|ref|p$)/i.test(k)) x.searchParams.delete(k); x.hostname = x.hostname.toLowerCase(); return x.toString().replace(/\/$/, ""); } catch { return null; } }
export const hostOf = u => { try { return new URL(String(u)).hostname.toLowerCase(); } catch { return null; } };

// ------------------------------------------------------------------ parsers (pure; input is untrusted data)
const base = (src, o) => ({ sourceId: src.id, url: canonicalUrl(o.url), title: clip(o.title, 300), description: clip(o.description, DISCOVERY_LIMITS.maxText), language: o.language ?? src.languages[0] ?? null, publishedAt: o.publishedAt ?? null, deadline: o.deadline ?? null,
  currency: o.currency ?? null, valueAmount: Number.isFinite(o.valueAmount) ? o.valueAmount : null, valueKind: o.valueKind ?? null, jurisdiction: o.jurisdiction ?? src.jurisdiction, buyer: o.buyer ? clip(o.buyer, 200) : null, tags: (Array.isArray(o.tags) ? o.tags : []).slice(0, 20).map(t => clip(t, 40)), kindHint: o.kindHint ?? src.kind, geoOpen: o.geoOpen ?? null });
const isoOrNull = d => { const t = Date.parse(d); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
export const PARSERS = Object.freeze({
  OCDS_JSON(src, text) {
    let j; try { j = JSON.parse(text); } catch { return R("PARSE_ERROR"); }
    const rel = Array.isArray(j?.releases) ? j.releases : []; const items = [];
    for (const r of rel.slice(0, DISCOVERY_LIMITS.maxItems)) { const t = r?.tender; if (!t || typeof t.title !== "string") continue;
      const id = String(r.ocid ?? r.id ?? "").replace(/[^A-Za-z0-9._-]/g, ""); const url = r.url ?? (src.id === "find-a-tender-uk" && id ? "https://www.find-tender.service.gov.uk/Notice/" + id.replace(/^ocds-[a-z0-9]+-/i, "") : null); if (!url) continue;
      items.push(base(src, { url, title: t.title, description: t.description, language: r.language ?? "en", publishedAt: isoOrNull(r.date), deadline: isoOrNull(t.tenderPeriod?.endDate), currency: t.value?.currency ?? null, valueAmount: Number(t.value?.amount), valueKind: t.value?.amount != null ? "BUYER_PUBLISHED_ESTIMATE" : null, buyer: r.buyer?.name, kindHint: "TENDER" })); }
    return { ok: true, items };
  },
  REMOTEOK_JSON(src, text) {
    let j; try { j = JSON.parse(text); } catch { return R("PARSE_ERROR"); } if (!Array.isArray(j)) return R("PARSE_ERROR");
    const items = []; for (const r of j.slice(0, DISCOVERY_LIMITS.maxItems + 1)) { if (!r || typeof r !== "object" || !r.position || !r.url) continue;
      const lo = Number(r.salary_min), hi = Number(r.salary_max);
      items.push(base(src, { url: r.url, title: r.position + (r.company ? " - " + r.company : ""), description: stripTags(r.description), language: "en", publishedAt: isoOrNull(r.date), currency: hi > 0 ? "USD" : null, valueAmount: hi > 0 ? hi : lo > 0 ? lo : null, valueKind: hi > 0 || lo > 0 ? "SALARY_RANGE_NOT_PROJECT_VALUE" : null, buyer: r.company, tags: r.tags, kindHint: "JOB_BOARD" })); }
    return { ok: true, items, currencyBasis: "SOURCE_CONVENTION_UNVERIFIED" };
  },
  RSS(src, text) {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) return R("XML_DTD_REFUSED");
    const items = []; for (const blk of [...blocks(text, "item", DISCOVERY_LIMITS.maxItems), ...blocks(text, "entry", DISCOVERY_LIMITS.maxItems)].slice(0, DISCOVERY_LIMITS.maxItems)) { const m = [blk.slice(0, 20000)];
      const g = tag => { const x = inner(m[0], tag); return x === null ? null : stripTags(x.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")); };
      const link = g("link") ?? (m[0].match(/<link[^>\n]{0,400}?href="([^"]{1,500})"/i)?.[1] ?? null); if (!link || !g("title")) continue;
      items.push(base(src, { url: link, title: g("title"), description: g("description") ?? g("summary") ?? g("content"), publishedAt: isoOrNull(g("pubDate") ?? g("published") ?? g("updated")), kindHint: src.kind })); }
    return { ok: true, items };
  },
  WB_JSON(src, text) {
    let j; try { j = JSON.parse(text); } catch { return R("PARSE_ERROR"); } const list = Array.isArray(j?.procnotices) ? j.procnotices : []; if (!list.length && !Array.isArray(j?.procnotices)) return R("PARSE_ERROR");
    const items = []; let skipped = 0;
    for (const r of list.slice(0, DISCOVERY_LIMITS.maxItems)) {
      if (!r || typeof r !== "object" || !/^OP\d{5,12}$/.test(String(r.id ?? "")) || !r.bid_description) continue;
      if (!/invitation|request|expression|call for/i.test(String(r.notice_type ?? "")) || /award|amend|cancel|extension|addend/i.test(String(r.notice_type ?? "")) || !/^(CS|NC)$/.test(String(r.procurement_group ?? ""))) { skipped++; continue; }
      items.push(base(src, { url: "https://projects.worldbank.org/en/projects-operations/procurement-detail/" + r.id, title: r.bid_description, description: [r.project_name, r.notice_type, r.procurement_method_name, stripTags(r.notice_text)].filter(Boolean).join(" | "), language: /french/i.test(r.notice_lang_name ?? "") ? "fr" : /spanish/i.test(r.notice_lang_name ?? "") ? "es" : "en", publishedAt: isoOrNull(r.noticedate), deadline: isoOrNull(r.submission_deadline_date), jurisdiction: "WB", buyer: r.contact_organization ?? null, tags: [r.project_ctry_name, r.procurement_group].filter(Boolean), kindHint: "TENDER" }));
    }
    return { ok: true, items, skipped };
  },
  ALGOLIA_HN_JSON(src, text) {
    let j; try { j = JSON.parse(text); } catch { return R("PARSE_ERROR"); } const items = [];
    for (const h of (Array.isArray(j?.hits) ? j.hits : []).slice(0, DISCOVERY_LIMITS.maxItems)) { const id = String(h.objectID ?? "").replace(/\D/g, ""); if (!id) continue; items.push(base(src, { url: "https://news.ycombinator.com/item?id=" + id, title: h.title ?? h.story_title ?? ("HN item " + id), description: stripTags(h.comment_text ?? h.story_text), language: "en", publishedAt: isoOrNull(h.created_at), kindHint: "COMMUNITY_BOARD" })); }
    return { ok: true, items };
  }
});

// ------------------------------------------------------------------ pure assessment
const FRAUD = [
  ["UPFRONT_FEE", true, /\b(pay|send|deposit)\b[^.]{0,40}\b(fee|deposit|registration|training|kit|equipment)\b[^.]{0,40}\b(before|to (start|apply|begin|receive))/i],
  ["GIFT_CARD_OR_PREPAID", true, /\b(gift ?cards?|itunes card|prepaid card|western union|moneygram)\b/i],
  ["CHEQUE_OVERPAYMENT", true, /\b(overpay(ment)?|send back the (difference|balance)|cash(ier'?s)? cheque)\b/i],
  ["CRYPTO_TO_PERSONAL_WALLET", false, /\b(send|transfer|pay)\b[^.]{0,40}\b(btc|usdt|eth|bitcoin|crypto)\b[^.]{0,40}\b(wallet|address)\b/i],
  ["OFF_PLATFORM_CONTACT_ONLY", false, /\b(contact (me|us) (only )?(on|via|through) (whatsapp|telegram|signal)|text (me|us) on (whatsapp|telegram))\b/i],
  ["GUARANTEED_INCOME", false, /\b(guaranteed (income|returns?|profit|earnings)|risk[- ]free|earn \$?\d[\d,]* (per|a) (day|hour) (from home|with no experience))\b/i],
  ["PRESSURE_TACTICS", false, /\b(act now|limited slots|only \d+ (spots|positions) left|urgent!{2,}|immediate start no interview)\b/i]
];
export function scamIndicators(text) { const hits = FRAUD.filter(([, , re]) => re.test(text)).map(([id, strong]) => ({ id, strong })); const strong = hits.filter(h => h.strong).length, any = hits.length; return { indicators: hits.map(h => h.id), level: strong >= 1 || any >= 2 ? "HIGH" : any === 1 ? "MEDIUM" : "NONE" }; }
const EMPLOY = /\b(full[- ]time|salary|benefits|401k|paid time off|pto|permanent (position|role)|we are (hiring|looking for) (a|an) (senior|junior|lead)|years? of (commercial )?experience|apply (now )?to join|join (our|the) (team|network)|visa (assistance|sponsorship)|(senior|junior|lead|principal|staff) [a-z /-]{0,40}(engineer|developer|manager|representative|dean|analyst)|part[- ]time)\b/i;
const NETWORK = /\b(marketplace (that )?(matches|connects)|talent (network|marketplace)|join our (talent )?network|matches? (senior )?(developers|freelancers) (with|to))\b/i;
const CONTRACT = /\b(freelance|contractor|contract (work|role|basis)|fixed[- ]price|statement of work|request for (proposals?|quotations?|tenders?)|rfp|rfq|invitation to tender|tender|scope of (work|services)|deliverables?|supply of services|consultancy|project-based|one-off project)\b/i;
const ONSITE = /\b(on[- ]?site|in[- ]person|physical presence|site visit|must be (located|based) (in|at)|fit-?out|refit|construction works?|installation (at|on) site|laboratory work|fieldwork|field work)\b/i;
const LICENSE = /\b(licen[sc]ed (professional|engineer|architect|solicitor|attorney|physician)|chartered (engineer|surveyor|accountant)|registered (nurse|architect|engineer)|security clearance|clinical (practice|trial)|bar admission)\b/i;
const GEO = /\b((?:residen(?:ts?|cy)|citizens?|nationals?) (?:of|in|required)[^.;]{0,60}|must (?:be )?(?:a )?(?:resident|located|based|registered) (?:in|at|with)[^.;]{0,60}|(?:only )?open to (?:suppliers|applicants|bidders|companies) (?:from|in|established in|registered in)[^.;]{0,60}|work authori[sz]ation required[^.;]{0,40}|eligible (?:countries|bidders)[^.;]{0,60})/gi;
const SKILL_MAP = [["data.csv_to_json", /\b(csv|spreadsheet|data (conversion|cleaning|processing|migration|transformation)|etl|json|excel)\b/i], ["doc.extract_summary", /\b(summar(y|ise|ize|isation)|literature review|document (analysis|review)|evaluation|research (report|study)|reports?)\b/i], ["code.module_with_tests", /\b(software|develop(ment|er|ing)|api|integration|automation|scripts?|web ?(site|app)|applications?|smart contracts?|blockchain|python|javascript|typescript|node\.?js|react|golang|backend|full[- ]?stack|platform)\b/i]];
const UNSUPPORTED = [["PHYSICAL_OR_ONSITE_WORK", ONSITE], ["LICENSED_PROFESSION", LICENSE], ["SPECIALIST_SCIENTIFIC_FIELD", /\b(sediment|geomorph|ecolog|hydrolog|clinical|pharmac|surgical|metallurg|seismic)\w*/i]];
export function inferRequirements(text) { const t = String(text ?? ""); return { skills: SKILL_MAP.filter(([, re]) => re.test(t)).map(([id]) => id), unsupported: UNSUPPORTED.filter(([, re]) => re.test(t)).map(([id]) => id), basis: "KEYWORD_MATCH_ON_SOURCE_TEXT: coverage of anything not named here is UNASSESSED, not confirmed." }; }
/** kind: PROJECT_CONTRACT | TENDER | EMPLOYMENT | TALENT_NETWORK | UNCLASSIFIED */
export function assessListing(item, nowIso) {
  const text = [item.title, item.description, (item.tags ?? []).join(" ")].join(" . "), blockers = [];
  const kind = NETWORK.test(text) ? "TALENT_NETWORK" : item.kindHint === "TENDER" ? "TENDER" : EMPLOY.test(text) && !/\b(freelance|contractor|contract (work|role|basis))\b/i.test(text) ? "EMPLOYMENT" : CONTRACT.test(text) ? "PROJECT_CONTRACT" : item.kindHint === "JOB_BOARD" ? "EMPLOYMENT" : "UNCLASSIFIED";
  if (kind === "EMPLOYMENT" || kind === "TALENT_NETWORK") blockers.push("NOT_A_DELIVERABLE_WORK_PACKAGE:" + kind);
  if (kind === "UNCLASSIFIED") blockers.push("LISTING_KIND_UNCLEAR");
  const fraud = scamIndicators(text); if (fraud.level === "HIGH") blockers.push("SCAM_INDICATORS_HIGH");
  const physical = ONSITE.test(text), license = LICENSE.test(text); if (physical) blockers.push("PHYSICAL_PRESENCE_INDICATED"); if (license) blockers.push("LICENSE_INDICATED");
  const now = Date.parse(nowIso), dl = item.deadline ? Date.parse(item.deadline) : null; const deadlineState = dl === null ? "UNKNOWN" : dl < now ? "EXPIRED" : "OPEN"; if (deadlineState === "EXPIRED") blockers.push("DEADLINE_PASSED");
  const geo = [...new Set([...String(text).matchAll(GEO)].map(m => clip(m[0], 90)))].slice(0, 6);
  const req = inferRequirements(text);
  return { listingKind: kind, fraud, deadlineState, geoRestrictions: geo, internationalEligibility: item.geoOpen === true ? "SOURCE_STATES_OPEN" : "UNKNOWN_NOT_ASSUMED", hardBlockers: blockers, requirements: req, requiresPhysicalPresence: physical, requiresUnheldLicense: license };
}
/** A conversion needs a supplied rate with a date and a source. Otherwise null: no invented rates. */
export function convertAmount(amount, from, to, rates = []) { if (!Number.isFinite(amount) || !from || !to) return null; if (from === to) return { amount, rate: 1, asOf: null, source: "IDENTITY" };
  const r = rates.find(x => x && x.from === from && x.to === to && Number.isFinite(x.rate) && x.rate > 0 && Number.isFinite(Date.parse(x.asOf)) && typeof x.source === "string" && x.source.length > 2); return r ? { amount: amount * r.rate, rate: r.rate, asOf: r.asOf, source: r.source } : null; }
export function toOpportunityInput(item, { retrieval, runId = null, evidenceSha = null, now = null } = {}) {
  const url = canonicalUrl(item.url); if (!url) return R("URL_INVALID_OR_NOT_HTTPS");
  const excerpt = clip(item.description || item.title, 700); const a = assessListing(item, now ?? new Date().toISOString());
  return { ok: true, input: { title: clip(item.title, 200), sourceType: "PUBLIC_SOURCE", sourceRef: url, sourceExcerpt: excerpt.length >= 10 ? excerpt : clip(item.title + " (no description published)", 700),
    requiredSkills: a.requirements.skills, discovery: { sourceId: item.sourceId, retrieval, runId, evidenceSha256: evidenceSha, jurisdiction: item.jurisdiction, currency: item.currency, valueAmount: item.valueAmount, valueKind: item.valueKind, language: item.language, publishedAt: item.publishedAt, deadline: item.deadline, buyer: item.buyer, kindHint: item.kindHint, geoOpen: item.geoOpen, tags: (item.tags ?? []).slice(0, 20), originalText: clip(item.description, DISCOVERY_LIMITS.maxText), translatedSummary: null, translationNote: "No translation was performed: the original text is kept as published." } } };
}

// ------------------------------------------------------------------ the engine
export function createDiscoveryEngine({ dir, egress = null, transport = null, isStopped = () => false, now = () => new Date().toISOString(), clock = () => Date.now(), sources = SOURCE_CATALOGUE, minIntervalMs = DISCOVERY_LIMITS.minIntervalMs } = {}) {
  if (!dir) throw new Error("DIR_REQUIRED"); fs.mkdirSync(path.join(dir, "captures"), { recursive: true, mode: 0o700 });
  const runs = createAuditChain({ filePath: path.join(dir, "runs.jsonl"), headPinFile: path.join(dir, "runs.headpin.json"), now });
  const last = new Map(); const byId = id => (Object.hasOwn(Object.fromEntries(sources.map(s => [s.id, 1])), id) ? sources.find(s => s.id === id) : null);
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };
  const providerId = id => "discovery-" + id;
  /** Egress policy the owner would approve for a source (data only; nothing is applied here). */
  const proposedPolicy = src => ({ providerId: providerId(src.id), hosts: [...src.hosts], pathPrefixes: ["/"], methods: ["GET"], ports: [443], maxBodyBytes: 4096 });
  function sourceState(src) {
    if (src.access !== "PUBLIC") return { state: "BLOCKED_" + src.access, reason: src.blockedReason };
    if (!src.format || !Object.hasOwn(PARSERS, src.format)) return { state: "NO_ADAPTER", reason: "No parser for this source yet." };
    if (!egress) return { state: "BLOCKED_NO_EGRESS_POLICY", reason: "Network egress is not configured." };
    let approved = false; try { approved = egress.listPolicies().some(p => p.providerId === providerId(src.id)); } catch { approved = false; }
    return approved ? { state: "READY_APPROVED_HOST", reason: null } : { state: "NEEDS_OWNER_HOST_APPROVAL", reason: "Approve the exact host(s) in the egress policy (signed) before ATLASZ may contact this source." };
  }
  const runLog = () => { try { runs.reload(); } catch { return []; } return runs.entries(); };
  function sourceViews() {
    const log = runLog();
    return sources.map(s => { const st = sourceState(s), mine = log.filter(e => e.data?.sourceId === s.id), ok = mine.filter(e => e.event === "RUN_OK"), bad = mine.filter(e => e.event === "RUN_FAILED");
      return { id: s.id, name: s.name, kind: s.kind, regions: s.regions, languages: s.languages, jurisdiction: s.jurisdiction, hosts: s.hosts, access: s.access, format: s.format, attribution: s.attribution, notes: s.notes, state: st.state, blocker: st.reason,
        genuinelyConnected: ok.length > 0, runsOk: ok.length, runsFailed: bad.length, lastRunAt: mine.at(-1)?.at ?? null, lastItems: ok.at(-1)?.data?.items ?? null, lastError: bad.at(-1)?.data?.code ?? null, evidence: CATALOGUE_EVIDENCE }; });
  }
  function coverage() { const v = sourceViews(), out = {}; for (const r of REGION_LIST) { const inR = v.filter(s => s.regions.includes(r) || (r === "Global" && s.regions.includes("Global"))); out[r] = { catalogued: inR.length, readyOrConnected: inR.filter(s => s.state === "READY_APPROVED_HOST").length, genuinelyConnected: inR.filter(s => s.genuinelyConnected).length, blocked: inR.filter(s => /^BLOCKED|NEEDS_OWNER|NO_ADAPTER/.test(s.state)).length }; } return out; }
  /** One bounded GET to a source the owner approved. Never follows redirects; refuses anything that is not that source's own host. */
  async function run(sourceId, { url = null, agentId = "UNKNOWN" } = {}) {
    if (stopped()) return R("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); const src = byId(sourceId); if (!src) return R("UNKNOWN_SOURCE");
    const st = sourceState(src); if (st.state !== "READY_APPROVED_HOST") return R(st.state, { detail: st.reason }); if (!transport) return R("NO_TRANSPORT");
    const target = canonicalUrl(url ?? src.url); if (!target || !src.hosts.includes(hostOf(target))) return R("URL_NOT_ON_SOURCE_HOST");
    const t = clock(); if (last.has(src.id) && t - last.get(src.id) < minIntervalMs) return R("RATE_LIMITED", { retryAfterMs: minIntervalMs - (t - last.get(src.id)) }); last.set(src.id, t);
    let addrs; try { addrs = await transport.resolveAddresses(hostOf(target)); } catch (e) { runs.append("RUN_FAILED", { sourceId, agentId, code: "DNS_FAILED" }); return R("DNS_FAILED"); }
    const u = new URL(target), d = egress.check({ providerId: providerId(src.id), url: target, method: "GET", bodyBytes: 0, resolvedAddresses: addrs }); if (!d.allowed) { runs.append("RUN_FAILED", { sourceId, agentId, code: "EGRESS_DENIED" }); return R("EGRESS_DENIED", { detail: d.reason }); }
    let res, text; try { const ac = new AbortController(), tm = setTimeout(() => ac.abort(), DISCOVERY_LIMITS.timeoutMs); try { res = await transport.fetch(u.toString(), { method: "GET", pinTo: addrs, headers: { accept: "application/json, application/xml;q=0.9, text/csv;q=0.5", "user-agent": "ATLASZ-discovery/1 (owner-operated; respects rate limits)" }, signal: ac.signal }); text = await res.text(); } finally { clearTimeout(tm); } }
    catch (e) { runs.append("RUN_FAILED", { sourceId, agentId, code: String(e?.message ?? "FETCH_FAILED").slice(0, 40) }); return R("FETCH_FAILED"); }
    if (!res.ok) { runs.append("RUN_FAILED", { sourceId, agentId, code: "HTTP_" + res.status }); return R("HTTP_" + res.status); }
    if (Buffer.byteLength(text) > DISCOVERY_LIMITS.maxResponseBytes) { runs.append("RUN_FAILED", { sourceId, agentId, code: "TOO_LARGE" }); return R("RESPONSE_TOO_LARGE"); }
    return finishParse(src, text, { retrieval: "CONNECTOR", agentId, target });
  }
  function finishParse(src, text, { retrieval, agentId, target }) {
    let p; try { p = PARSERS[src.format](src, text); } catch { p = R("PARSER_FAILED"); } if (!p.ok) { runs.append("RUN_FAILED", { sourceId: src.id, agentId, code: p.reason }); return R(p.reason); }
    const evidenceSha = sha(text), runId = "run-" + evidenceSha.slice(0, 12); fs.writeFileSync(path.join(dir, "captures", evidenceSha + ".txt"), text.slice(0, DISCOVERY_LIMITS.maxResponseBytes), { mode: 0o600 });
    runs.append(retrieval === "CONNECTOR" ? (p.items.length ? "RUN_OK" : "RUN_EMPTY") : "FIXTURE_PARSE", { sourceId: src.id, agentId, retrieval, items: p.items.length, evidenceSha256: evidenceSha, url: target ? new URL(target).origin + new URL(target).pathname : null });
    return { ok: true, runId, retrieval, evidenceSha256: evidenceSha, items: p.items, currencyBasis: p.currencyBasis ?? null };
  }
  /** Items retrieved OUTSIDE the ATLASZ runtime (a person or a tool the operator used). Kept, labelled OPERATOR_TOOL, never counted as a connected source. */
  function importOperatorCapture({ sourceId, items, tool, retrievedAt, note }) {
    const src = byId(sourceId); if (!src) return R("UNKNOWN_SOURCE"); if (!Array.isArray(items) || !items.length || items.length > DISCOVERY_LIMITS.maxCaptureItems) return R("ITEMS_INVALID"); if (!tool || !Number.isFinite(Date.parse(retrievedAt))) return R("PROVENANCE_REQUIRED");
    const out = []; for (const it of items) { if (containsSecret(JSON.stringify(it)) || scrub(JSON.stringify(it)) !== JSON.stringify(it)) return R("SECRET_IN_CAPTURE"); const u = canonicalUrl(it.url); if (!u || !src.hosts.some(h => h.replace(/^www\./, "") === hostOf(u)?.replace(/^www\./, ""))) return R("URL_NOT_ON_SOURCE_HOST", { url: it.url }); out.push(base(src, { ...it, url: u })); }
    const evidenceSha = sha(JSON.stringify(out)); runs.append("OPERATOR_CAPTURE", { sourceId, tool: clip(tool, 60), retrievedAt, items: out.length, evidenceSha256: evidenceSha, note: clip(note, 200) });
    return { ok: true, retrieval: "OPERATOR_TOOL", items: out, evidenceSha256: evidenceSha };
  }
  /** True only when this exact evidence hash was logged by a real connector run (RUN_OK) or a labelled operator capture. */
  const hasEvidence = (hash, retrieval) => { if (!/^[0-9a-f]{64}$/.test(String(hash))) return false; const ev = retrieval === "CONNECTOR" ? "RUN_OK" : retrieval === "OPERATOR_TOOL" ? "OPERATOR_CAPTURE" : null; return ev ? runLog().some(e => e.event === ev && e.data?.evidenceSha256 === hash) : false; };
  return { hasEvidence, sources: sourceViews, coverage, run, importOperatorCapture, proposedPolicy: x => { const sr = typeof x === "string" ? byId(x) : x; return sr ? proposedPolicy(sr) : R("UNKNOWN_SOURCE"); }, sourceState: id => { const s = byId(id); return s ? sourceState(s) : null; }, runLog, verify: () => { try { runs.reload(); return runs.verify(); } catch (e) { return { ok: false, reason: String(e?.message ?? e).slice(0, 80) }; } }, catalogueEvidence: CATALOGUE_EVIDENCE, finishParse: (id, text, o) => { const s = byId(id); return s ? finishParse(s, text, o) : R("UNKNOWN_SOURCE"); } };
}
