// Source ADAPTER framework for external opportunity discovery (Global Business package §2: procurement notices, grants, freelance listings).
// An adapter only DESCRIBES a source: {sourceId, kind, format, fetchPlan(query) -> {url}, parse(rawText) -> raw records}. It never fetches.
// ingest() is the only entry point that touches raw data, and it:
//   1. refuses anything not allowlisted (source-allowlist.check, deny by default; the allowlist is EMPTY unless the owner approved a source and its country);
//   2. calls an INJECTED fetch function (there is NO default: no global fetch, no network, no download); a final URL that differs from the planned one is treated as a
//      redirect and must pass allowlist.checkRedirect (other host -> refused);
//   3. caps raw size and record count, parses, validates every record against a strict schema, screens text for prompt-injection phrases;
//   4. attaches provenance {sourceId, url, fetchedAt, sha256, licenceNote} to every record;
//   5. records MISSING fields as unknown: the value is null and the field name is listed in `unknownFields`. A missing amount is NEVER defaulted to 0, and a value
//      found in a notice is an "estimatedValue" of the opportunity, never revenue.
// The three reference adapters parse synthetic fixture formats written for the tests (JSON procurement notices, RSS grants, HTML freelance listings). They are NOT
// adapters for any real portal: a real source needs its own adapter, the owner's allowlist approval, terms review and its own evidence (CONNECTED_UNTESTED at best).
//
// Status honesty: IMPLEMENTED + unit TESTED against synthetic fixtures. NOT CONNECTED to any real source, not LIVE.
import { createHash } from "node:crypto";
import { INJECTION_PATTERNS } from "./text-compare.mjs";
import { containsSecret, scrub } from "./secret-patterns.mjs";
import { defaultNormalize } from "./brain/search-pipeline.mjs";

export const KINDS = Object.freeze(["PROCUREMENT", "GRANT", "FREELANCE"]);
export const FORMATS = Object.freeze(["JSON", "RSS", "HTML"]);
export const LIMITS = Object.freeze({ maxRawBytes: 2 * 1024 * 1024, maxRecords: 500, maxTitle: 300, maxDescription: 4000, maxName: 200, maxList: 20, maxItemChars: 80, maxRejections: 100, maxValue: 1e12, fetchTimeoutMs: 30000 });
export const UNKNOWN = null;
const sha = t => createHash("sha256").update(t).digest("hex");
const ID_RE = /^[a-z0-9][a-z0-9_.-]{1,47}$/, CC_RE = /^[A-Z]{2}$/, CUR_RE = /^[A-Z]{3}$/, LANG_RE = /^[a-z]{2}$/;
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g;
const text = (v, max) => typeof v === "string" ? v.replace(CTRL, "").replace(/\s+/g, " ").trim().slice(0, max) : null;
const decodeEntities = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
const stripTags = s => decodeEntities(String(s).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ").replace(/<[^>]*>/g, " "));

/** Requirement fields that eligibility-model.mjs evaluates. null = unknown (needs review), never "not required". */
const REQ_FIELDS = ["physicalPresence", "licences", "insurance", "registrations", "languages", "minCompanyAgeYears"];
const TOP_FIELDS = ["title", "description", "buyerName", "country", "currency", "estimatedValueMin", "estimatedValueMax", "deadline", "url"];

function httpUrl(u) {
  if (typeof u !== "string" || u.length > 2048) return null;
  let x; try { x = new URL(u); } catch { return null; }
  if (x.protocol !== "https:" && x.protocol !== "http:") return null;
  if (x.username || x.password) return null;
  return x.origin + x.pathname;                                                                     // query/fragment dropped (tracking tokens, session ids)
}
const num = v => { if (v === null || v === undefined || v === "") return null; const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+(?:\.\d+)?\s*$/.test(v) ? Number(v) : NaN; return Number.isFinite(n) && n >= 0 && n <= LIMITS.maxValue ? n : NaN; };
const isoDate = v => { if (v === null || v === undefined || v === "") return null; if (typeof v !== "string" || v.length > 40) return NaN; const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : NaN; };
const strList = (v, re = null) => { if (v === null || v === undefined) return null; if (!Array.isArray(v) || v.length > LIMITS.maxList) return NaN; const out = []; for (const x of v) { const s = text(x, LIMITS.maxItemChars); if (!s || (re && !re.test(s))) return NaN; out.push(s); } return [...new Set(out)]; };
const tri = v => v === true || v === false ? v : v === null || v === undefined ? null : NaN;

/**
 * Validate one raw record produced by an adapter's parse(). Returns {record} or {error}. Missing -> null + listed in unknownFields; malformed -> error (record rejected).
 * Accepted raw shape: {externalId, title, description?, buyerName?, country?, currency?, estimatedValueMin?, estimatedValueMax?, deadline?, url?, requirements?{...}}
 */
export function validateRecord(raw, { kind, sourceId } = {}) {
  const E = error => ({ error });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return E("RECORD_OBJECT_REQUIRED");
  const externalId = text(raw.externalId, 120); if (!externalId || !/^[\w.:\/-]{1,120}$/.test(externalId)) return E("EXTERNAL_ID_INVALID");
  const title = text(raw.title, LIMITS.maxTitle); if (!title) return E("TITLE_REQUIRED");
  const description = raw.description == null ? null : text(raw.description, LIMITS.maxDescription);
  const buyerName = raw.buyerName == null ? null : text(raw.buyerName, LIMITS.maxName);
  const country = raw.country == null || raw.country === "" ? null : typeof raw.country === "string" && CC_RE.test(raw.country.trim().toUpperCase()) ? raw.country.trim().toUpperCase() : NaN;
  if (Number.isNaN(country)) return E("COUNTRY_INVALID");
  const currency = raw.currency == null || raw.currency === "" ? null : typeof raw.currency === "string" && CUR_RE.test(raw.currency.trim().toUpperCase()) ? raw.currency.trim().toUpperCase() : NaN;
  if (Number.isNaN(currency)) return E("CURRENCY_INVALID");
  const vmin = num(raw.estimatedValueMin), vmax = num(raw.estimatedValueMax ?? raw.estimatedValueMin);
  if (Number.isNaN(vmin) || Number.isNaN(vmax)) return E("VALUE_INVALID");
  if (vmin !== null && vmax !== null && vmax < vmin) return E("VALUE_RANGE_INVERTED");
  if ((vmin !== null || vmax !== null) && currency === null) return E("VALUE_WITHOUT_CURRENCY");      // an amount without a currency is not a usable figure
  const deadline = isoDate(raw.deadline); if (Number.isNaN(deadline)) return E("DEADLINE_INVALID");
  const url = raw.url == null || raw.url === "" ? null : httpUrl(raw.url); if (raw.url != null && raw.url !== "" && url === null) return E("URL_INVALID");
  const r = raw.requirements == null ? {} : raw.requirements; if (typeof r !== "object" || Array.isArray(r)) return E("REQUIREMENTS_INVALID");
  const requirements = {
    physicalPresence: tri(r.physicalPresence),
    licences: strList(r.licences), registrations: strList(r.registrations), languages: strList(r.languages, LANG_RE),
    insurance: r.insurance == null ? null : Array.isArray(r.insurance) && r.insurance.length <= LIMITS.maxList ? r.insurance.map(i => ({ type: text(i?.type, LIMITS.maxItemChars), minCoverage: num(i?.minCoverage), currency: typeof i?.currency === "string" && CUR_RE.test(i.currency) ? i.currency : null })) : NaN,
    minCompanyAgeYears: r.minCompanyAgeYears == null ? null : Number.isInteger(r.minCompanyAgeYears) && r.minCompanyAgeYears >= 0 && r.minCompanyAgeYears <= 200 ? r.minCompanyAgeYears : NaN
  };
  for (const [k, v] of Object.entries(requirements)) if (Number.isNaN(v)) return E("REQUIREMENT_INVALID:" + k);
  if (Array.isArray(requirements.insurance) && requirements.insurance.some(i => !i.type || Number.isNaN(i.minCoverage))) return E("REQUIREMENT_INVALID:insurance");
  const all = [title, description, buyerName].filter(Boolean).join("\n");
  const injectionSignals = INJECTION_PATTERNS.filter(p => p.test(all)).length;
  const secretRedacted = containsSecret(all);
  const rec = { id: `${sourceId}:${externalId}`, externalId, kind, title: secretRedacted ? scrub(title) : title, description: description && secretRedacted ? scrub(description) : description, buyerName, country, currency,
    estimatedValueMin: vmin, estimatedValueMax: vmax, valueIsRevenue: false, deadline, url, requirements, untrusted: true, injectionSignals, secretRedacted };
  rec.unknownFields = [...TOP_FIELDS.filter(f => rec[f] === null), ...REQ_FIELDS.filter(f => requirements[f] === null).map(f => "requirements." + f)];
  return { record: rec };
}

/** Define an adapter. Throws on an invalid descriptor (programming error, not data). */
export function defineAdapter({ sourceId, kind, format, parse, fetchPlan } = {}) {
  if (typeof sourceId !== "string" || !ID_RE.test(sourceId)) throw new Error("ADAPTER_SOURCE_ID_INVALID");
  if (!KINDS.includes(kind)) throw new Error("ADAPTER_KIND_INVALID");
  if (!FORMATS.includes(format)) throw new Error("ADAPTER_FORMAT_INVALID");
  if (typeof parse !== "function" || typeof fetchPlan !== "function") throw new Error("ADAPTER_PARSE_AND_FETCHPLAN_REQUIRED");
  return Object.freeze({ sourceId, kind, format, parse, fetchPlan });
}

// ---------------------------------------------------------------- reference adapters (synthetic fixture formats)
const q = s => encodeURIComponent(String(s ?? "").slice(0, 100));
/** JSON procurement notices: {"notices":[{noticeId,title,summary,buyer:{name,country},estimatedValue:{amount,currency}|{min,max,currency},deadline,url,requirements}]} */
export function procurementJsonAdapter({ sourceId, baseUrl }) {
  return defineAdapter({ sourceId, kind: "PROCUREMENT", format: "JSON",
    fetchPlan: (query = {}) => ({ method: "GET", url: `${baseUrl}/notices?q=${q(query.keywords)}` }),
    parse(raw) {
      let j; try { j = JSON.parse(raw); } catch { throw new Error("FIXTURE_NOT_JSON"); }
      if (!j || !Array.isArray(j.notices)) throw new Error("FIXTURE_SCHEMA:notices[] required");
      return j.notices.map(n => n && typeof n === "object" ? ({ externalId: n.noticeId, title: n.title, description: n.summary, buyerName: n.buyer?.name, country: n.buyer?.country,
        currency: n.estimatedValue?.currency, estimatedValueMin: n.estimatedValue?.min ?? n.estimatedValue?.amount, estimatedValueMax: n.estimatedValue?.max ?? n.estimatedValue?.amount, deadline: n.deadline, url: n.url, requirements: n.requirements }) : n);
    } });
}
const tag = (block, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block); return m ? text(stripTags(m[1]), LIMITS.maxDescription) : null; };
const attr = (block, name, a) => { const m = new RegExp(`<${name}\\s[^>]*${a}="([^"]{0,40})"`, "i").exec(block); return m ? m[1] : null; };
/** RSS grants: <rss><channel><item><guid/><title/><link/><description/><grant:amount currency="EUR">50000</grant:amount><grant:deadline/><grant:country/><grant:languages>en,fr</grant:languages></item> */
export function grantRssAdapter({ sourceId, baseUrl }) {
  return defineAdapter({ sourceId, kind: "GRANT", format: "RSS",
    fetchPlan: (query = {}) => ({ method: "GET", url: `${baseUrl}/grants.rss?topic=${q(query.keywords)}` }),
    parse(raw) {
      if (!/^\s*(?:<\?xml[^>]*>\s*)?<rss[\s>]/i.test(raw)) throw new Error("FIXTURE_NOT_RSS");
      if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw new Error("FIXTURE_DTD_REFUSED");                  // no entity expansion tricks
      const items = [...raw.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]);
      return items.map(b => { const langs = tag(b, "grant:languages");
        return { externalId: tag(b, "guid"), title: tag(b, "title"), description: tag(b, "description"), buyerName: tag(b, "grant:funder"), country: tag(b, "grant:country"),
          currency: attr(b, "grant:amount", "currency"), estimatedValueMin: tag(b, "grant:amount"), estimatedValueMax: tag(b, "grant:amount"), deadline: tag(b, "grant:deadline"), url: tag(b, "link"),
          requirements: { languages: langs ? langs.split(",").map(s => s.trim()) : null, registrations: tag(b, "grant:registration") ? [tag(b, "grant:registration")] : null } }; });
    } });
}
/** HTML freelance listings: <article class="listing" data-id="..."><h2>title</h2><p class="desc">..</p><span class="budget" data-currency="USD">500</span><span class="client" data-country="CA">..</span><a href="..">..</a><span class="remote">yes|no</span></article> */
export function freelanceHtmlAdapter({ sourceId, baseUrl }) {
  return defineAdapter({ sourceId, kind: "FREELANCE", format: "HTML",
    fetchPlan: (query = {}) => ({ method: "GET", url: `${baseUrl}/jobs?q=${q(query.keywords)}` }),
    parse(raw) {
      if (!/<html[\s>]/i.test(raw)) throw new Error("FIXTURE_NOT_HTML");
      const blocks = [...raw.matchAll(/<article\s+class="listing"\s+data-id="([^"]{1,120})">([\s\S]*?)<\/article>/gi)];
      return blocks.map(([, id, b]) => {
        const budget = /<span class="budget" data-currency="([A-Z]{3})">([^<]{0,40})<\/span>/.exec(b), client = /<span class="client" data-country="([A-Za-z]{2})">([^<]{0,200})<\/span>/.exec(b);
        const href = /<a\s+href="([^"]{1,2048})"/.exec(b), remote = /<span class="remote">([^<]{0,10})<\/span>/.exec(b)?.[1]?.trim().toLowerCase() ?? null;
        return { externalId: id, title: tag(b, "h2"), description: /<p class="desc">([\s\S]*?)<\/p>/.exec(b) ? text(stripTags(/<p class="desc">([\s\S]*?)<\/p>/.exec(b)[1]), LIMITS.maxDescription) : null,
          buyerName: client ? text(client[2], LIMITS.maxName) : null, country: client ? client[1] : null, currency: budget ? budget[1] : null,
          estimatedValueMin: budget ? budget[2].trim() : null, estimatedValueMax: budget ? budget[2].trim() : null, url: href ? decodeEntities(href[1]) : null,
          requirements: { physicalPresence: remote === "yes" ? false : remote === "no" ? true : null } };
      });
    } });
}

/**
 * ingest({adapter, allowlist, fetch, query, now}) -> {ok, records[], rejected[], provenance, unknownFieldCounts, dataOrigin} | {ok:false, reason}
 * fetch(plan) is INJECTED and must resolve to {status, url, body:string}. Nothing here performs network I/O.
 */
export async function ingest({ adapter, allowlist, fetch: doFetch, query = {}, now = () => new Date().toISOString(), maxRawBytes = LIMITS.maxRawBytes, maxRecords = LIMITS.maxRecords } = {}) {
  const R = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  if (!adapter || !Object.isFrozen(adapter) || !ID_RE.test(adapter.sourceId ?? "")) return R("ADAPTER_INVALID");
  if (!allowlist || typeof allowlist.check !== "function" || typeof allowlist.checkRedirect !== "function") return R("ALLOWLIST_REQUIRED");
  if (typeof doFetch !== "function") return R("FETCH_NOT_INJECTED");
  if (!Number.isInteger(maxRawBytes) || maxRawBytes < 1 || maxRawBytes > LIMITS.maxRawBytes || !Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > LIMITS.maxRecords) return R("LIMITS_INVALID");
  let plan; try { plan = adapter.fetchPlan(query); } catch { return R("FETCH_PLAN_FAILED"); }
  if (!plan || typeof plan.url !== "string" || (plan.method ?? "GET") !== "GET") return R("FETCH_PLAN_INVALID");
  const pre = allowlist.check(adapter.sourceId, plan.url);
  if (!pre.allowed) return R("NOT_ALLOWLISTED", { detail: pre.reason });
  let res; try {
    let timer; res = await Promise.race([Promise.resolve().then(() => doFetch({ method: "GET", url: plan.url, sourceId: adapter.sourceId, maxBytes: maxRawBytes })), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("FETCH_TIMEOUT")), LIMITS.fetchTimeoutMs); })]).finally(() => clearTimeout(timer));
  } catch (e) { return R(e?.message === "FETCH_TIMEOUT" ? "FETCH_TIMEOUT" : "FETCH_FAILED"); }
  if (!res || typeof res !== "object") return R("FETCH_RESPONSE_INVALID");
  if (res.status !== 200) return R("FETCH_STATUS_" + (Number.isInteger(res.status) ? res.status : "INVALID"));
  const finalUrl = typeof res.url === "string" && res.url ? res.url : plan.url;
  if (finalUrl !== plan.url) { const rd = allowlist.checkRedirect(adapter.sourceId, plan.url, finalUrl); if (!rd.allowed) return R("REDIRECT_REFUSED", { detail: rd.reason }); }
  if (typeof res.body !== "string") return R("BODY_NOT_TEXT");
  const bytes = Buffer.byteLength(res.body); if (bytes > maxRawBytes) return R("RAW_TOO_LARGE", { bytes, maxRawBytes });
  let raws; try { raws = adapter.parse(res.body); } catch (e) { return R("PARSE_FAILED", { detail: String(e?.message ?? e).slice(0, 120) }); }
  if (!Array.isArray(raws)) return R("PARSE_RESULT_NOT_ARRAY");
  const truncated = raws.length > maxRecords;
  const fetchedAt = now(), provenance = { sourceId: adapter.sourceId, url: httpUrl(finalUrl), fetchedAt, sha256: sha(res.body), licenceNote: pre.licenceNote ?? null, bytes, dataOrigin: "INJECTED_FETCH" };
  const records = [], rejected = [], seen = new Set(), unknownFieldCounts = {};
  for (const [i, raw] of raws.slice(0, maxRecords).entries()) {
    const v = validateRecord(raw, { kind: adapter.kind, sourceId: adapter.sourceId });
    if (v.error) { if (rejected.length < LIMITS.maxRejections) rejected.push({ index: i, reason: v.error }); continue; }
    if (seen.has(v.record.id)) { if (rejected.length < LIMITS.maxRejections) rejected.push({ index: i, reason: "DUPLICATE_IN_FEED" }); continue; }
    seen.add(v.record.id);
    for (const f of v.record.unknownFields) unknownFieldCounts[f] = (unknownFieldCounts[f] ?? 0) + 1;
    records.push({ ...v.record, provenance: { ...provenance } });
  }
  return { ok: true, sourceId: adapter.sourceId, kind: adapter.kind, records, rejected, rejectedCount: raws.slice(0, maxRecords).length - records.length, truncated, provenance, unknownFieldCounts,
    note: "Parsed from an injected fetch. Values are notice estimates of the opportunity, not revenue. Unknown fields are null and listed, never defaulted." };
}

/** Bridge to brain/search-pipeline.mjs process(): returns its raw input shape. Value is NOT passed (the pipeline invents nothing). */
export function toSearchCandidate(record, { sourceKey = record?.provenance?.sourceId } = {}) {
  const n = defaultNormalize({ id: record.id, title: record.title, text: [record.description, record.buyerName].filter(Boolean).join(" — "), url: record.url ?? record.provenance?.url ?? "", published: record.provenance?.fetchedAt ?? null, source: sourceKey });
  return { ...n, provenance: record.provenance, unknownFields: [...record.unknownFields] };
}
