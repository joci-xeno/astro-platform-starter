// Documentation synchronisation (PKG150 S508 / OP06) and the Hungarian-English interface verifier (S514). Deterministic, offline, READ-ONLY on the analysed project.
//   extractApi          exported API (name, kind, parsed signature) of every non-test JS module under root.
//   syncDocs            compares the API with markdown (README.md + a docs folder): UNDOCUMENTED (exported, never named in a code span / heading / code block), STALE_SIGNATURE (a documented
//                       name(params) whose parameter list no longer matches the source), REMOVED_OR_RENAMED (an API heading or reference-table entry naming something no longer exported),
//                       REFERENCE_OUT_OF_DATE (a generated reference block that differs from what generateReference produces today). Every item carries file:line evidence.
//   generateReference   deterministic markdown reference text (sorted; byte-identical for the same API) between ATLASZ-API-REFERENCE markers. Optional one-line descriptions come only from an
//                       injected `model` (draftDescriptions) and are labelled as unreviewed drafts; without a model the result says MODEL_NOT_CONFIGURED and the table has no description column.
//   checkDocs           CI mode: {pass, exitCode} - fails closed when docs could not be fully read.
//   verifyTranslations  hu/en string tables: missing keys, untranslated (identical) strings, placeholder mismatches ({name}, {{name}}, %s, %1$s, ${x}), length blow-ups, mojibake
//                       (UTF-8 read as Latin-1/Windows-1250, U+FFFD) and o-tilde / u-circumflex where Hungarian needs o/u double acute.
//   scanHardcodedStrings  user-visible string literals in a public/app.js style file that bypass the translation function (textContent/innerHTML/title/placeholder/alert/setAttribute/...).
// Honest limits: markdown is scanned with line rules, not a full CommonMark parser; "documented" means "named in code-ish markdown", not "explained well"; the UI-string scanner is heuristic.
import path from "node:path";
import { walkRepo } from "./repo-analyzer.mjs";
import { buildGraph, isTestFile, readConfined, realRoot, tokenize, clean, sha256, MODEL_NOT_CONFIGURED, W2_STATUS } from "./dev-assist-common.mjs";
import { scrub } from "./secret-patterns.mjs";

export const LIMITS = Object.freeze({ maxDocFiles: 500, maxDocBytes: 512 * 1024, maxFindings: 2000, maxKeys: 20000, maxDepth: 10, maxValueChars: 20000, maxDescChars: 200, modelTimeoutMs: 15000, maxScanFindings: 1000 });
export const STATUS = Object.freeze({ ...W2_STATUS, descriptionAuthoring: "NEEDS_INJECTED_MODEL_ADAPTER" });
export const START = "<!-- ATLASZ-API-REFERENCE:START -->", END = "<!-- ATLASZ-API-REFERENCE:END -->";
const IDENT = "[A-Za-z_$][\\w$]*";

/** Exported API of every non-test JS module (re-exports listed but marked). */
export function extractApi({ root } = {}) {
  const g = buildGraph(root); if (!g.ok) return g;
  const modules = [];
  for (const [rel, m] of [...g.files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (isTestFile(rel)) continue;
    const ex = [...new Map(m.exports.map(e => [e.name, e])).values()].map(e => ({ name: e.name, kind: e.kind, signature: clean(e.signature), params: e.params.map(clean), line: e.line, reexport: Boolean(e.from) })).sort((a, b) => (a.name < b.name ? -1 : 1));
    if (ex.length) modules.push({ file: rel, exports: ex });
  }
  return { ok: true, graphHash: g.hash, modules, incomplete: g.walk.capped || Object.values(g.notParsed).some(n => n > 0) };
}

const paramName = p => { const s = String(p).trim(); if (s.startsWith("{")) return "{}"; if (s.startsWith("[")) return "[]"; const m = s.match(new RegExp("^(\\.\\.\\.)?\\s*(" + IDENT + ")")); return m ? (m[1] ?? "") + m[2] : s; };
const splitParams = t => { const out = []; let d = 0, cur = ""; for (const ch of t) { if ("([{".includes(ch)) d++; if (")]}".includes(ch)) d--; if (ch === "," && d === 0) { out.push(cur); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur); return out.map(x => x.trim()).filter(Boolean); };

function readDocs(root, docsDir, readme) {
  const docs = [], skipped = { oversize: 0, unreadable: 0, pastLimit: 0 }, r = realRoot(root); if (!r.ok) return r;
  const names = [];
  if (readme) { const p = readConfined(r.real, readme, LIMITS.maxDocBytes); if (p.ok) docs.push({ rel: p.rel, text: p.text }); else if (p.reason === "FILE_TOO_LARGE") skipped.oversize++; else if (p.reason !== "FILE_NOT_FOUND") return { ok: false, reason: "README_" + p.reason }; }
  if (docsDir) {
    const d = readConfined(r.real, docsDir); if (d.reason === "PATH_TRAVERSAL_REFUSED" || d.reason === "PATH_INVALID" || d.reason === "SYMLINK_REFUSED") return { ok: false, reason: "DOCS_DIR_" + d.reason };
    const w = walkRepo(path.join(r.real, path.posix.normalize(docsDir)));
    if (w.ok) { for (const f of w.files) if (/\.(md|markdown)$/i.test(f.rel)) names.push(path.posix.join(path.posix.normalize(docsDir), f.rel)); skipped.oversize += w.skipped.oversize; if (w.capped) skipped.pastLimit++; }
  }
  for (const n of names.sort()) {
    if (docs.length >= LIMITS.maxDocFiles) { skipped.pastLimit++; continue; }
    const p = readConfined(r.real, n, LIMITS.maxDocBytes); if (p.ok) docs.push({ rel: p.rel, text: p.text }); else if (p.reason === "FILE_TOO_LARGE") skipped.oversize++; else skipped.unreadable++;
  }
  return { ok: true, docs, skipped };
}

/** Code-ish regions of a markdown file: inline code spans, headings, fenced blocks, plus the generated reference block. */
function scanMarkdown(rel, text) {
  const mentions = new Map(), claims = [], headings = [], refEntries = []; let fence = null, inRef = false, refStart = null, refBody = [], refMalformed = false;
  const mention = (name, line) => { if (!mentions.has(name)) mentions.set(name, { file: rel, line }); };
  const idsIn = (s, line) => { for (const m of s.matchAll(new RegExp("(?<![\\w$.])" + IDENT, "g"))) mention(m[0], line); };
  const claimsIn = (s, line, where) => { for (const m of s.matchAll(new RegExp("(?<![\\w$.])(" + IDENT + ")\\s*\\(([^()]*(?:\\([^()]*\\)[^()]*)*)\\)", "g"))) claims.push({ name: m[1], params: splitParams(m[2]), text: clean(m[0]), file: rel, line, where }); };
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i], line = i + 1;
    if (ln.trim() === START) { if (inRef) refMalformed = true; inRef = true; refStart = line; refBody = []; continue; }
    if (ln.trim() === END) { if (!inRef) refMalformed = true; else refEntries.push({ file: rel, startLine: refStart, body: refBody.join("\n") }); inRef = false; continue; }
    if (inRef) { refBody.push(ln); const row = ln.match(new RegExp("^\\|\\s*`(" + IDENT + ")`\\s*\\|")); if (row) headings.push({ name: row[1], file: rel, line, where: "reference" }); }
    const f = ln.match(/^\s*(```|~~~)/);
    if (f) { fence = fence ? (ln.trim().startsWith(fence) ? null : fence) : f[1]; continue; }
    if (fence) { idsIn(ln, line); continue; }
    const h = ln.match(/^#{1,6}\s+(.*)$/);
    if (h) { idsIn(h[1].replace(/`/g, ""), line); claimsIn(h[1].replace(/`/g, ""), line, "heading"); const hn = h[1].match(new RegExp("^`?(" + IDENT + ")(?:\\s*\\(|`)")); if (hn && (/\(/.test(h[1]) || /`/.test(h[1]))) headings.push({ name: hn[1], file: rel, line, where: "heading" }); continue; }
    for (const m of ln.matchAll(/`([^`\n]+)`/g)) { idsIn(m[1], line); claimsIn(m[1], line, "inline"); }
  }
  if (inRef) refMalformed = true;
  return { mentions, claims, headings, refEntries, refMalformed };
}

/** Deterministic reference markdown for an extractApi() result. */
export function generateReference(api, { descriptions = null, title = "API reference" } = {}) {
  if (!api?.ok || !Array.isArray(api.modules)) return { ok: false, reason: "API_RESULT_REQUIRED" };
  const esc = s => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ").replace(/`/g, "'");
  const L = ["", "## " + esc(title), "", "_Generated by ATLASZ doc-sync from source. Do not edit by hand; regenerate instead._"];
  for (const m of api.modules) {
    const own = m.exports.filter(e => !e.reexport); if (!own.length) continue;
    L.push("", "### `" + esc(m.file) + "`", "", descriptions ? "| Export | Kind | Signature | Description (model draft, unreviewed) |" : "| Export | Kind | Signature |", descriptions ? "|---|---|---|---|" : "|---|---|---|");
    for (const e of own) { const base = `| \`${esc(e.name)}\` | ${e.kind} | \`${esc(e.signature)}\` |`; L.push(descriptions ? base + ` ${esc(descriptions[m.file + "#" + e.name] ?? "")} |` : base); }
  }
  L.push("");
  const body = L.join("\n");
  return { ok: true, body, markdown: START + "\n" + body + "\n" + END + "\n", sha256: sha256(body), authoring: descriptions ? "MODEL_DRAFTS_UNREVIEWED" : MODEL_NOT_CONFIGURED };
}

/** Optional: one-line descriptions from an injected model adapter (untrusted text: scrubbed, single line, capped). */
export async function draftDescriptions(api, model) {
  if (!model || typeof model.describe !== "function") return { ok: false, reason: MODEL_NOT_CONFIGURED };
  const out = {}, rejected = [];
  for (const m of api.modules) for (const e of m.exports.filter(x => !x.reexport)) {
    let t; try { let tm; t = await Promise.race([Promise.resolve(model.describe({ file: m.file, name: e.name, kind: e.kind, signature: e.signature })), new Promise((_, rej) => { tm = setTimeout(() => rej(new Error("MODEL_TIMEOUT")), LIMITS.modelTimeoutMs); })]).finally(() => clearTimeout(tm)); } catch (err) { rejected.push({ name: m.file + "#" + e.name, reason: String(err?.message ?? "MODEL_ERROR").slice(0, 60) }); continue; }
    if (typeof t !== "string" || !t.trim()) { rejected.push({ name: m.file + "#" + e.name, reason: "EMPTY" }); continue; }
    out[m.file + "#" + e.name] = scrub(t).replace(/[\r\n]+/g, " ").replace(/<!--|-->/g, "").trim().slice(0, LIMITS.maxDescChars);
  }
  return { ok: true, descriptions: out, rejected, authoring: "MODEL_DRAFTS_UNREVIEWED" };
}

// a reference block regenerated WITH model descriptions is compared without its description column (descriptions are not derivable from source)
const normRef = body => !body.includes("| Description (model draft, unreviewed) |") ? body : body.split("\n").map(l => l === "| Export | Kind | Signature | Description (model draft, unreviewed) |" ? "| Export | Kind | Signature |" : l === "|---|---|---|---|" ? "|---|---|---|" : (l.match(/^(\| `[^`]*` \| \w+ \| `[^`]*` \|) .*\|$/)?.[1] ?? l)).join("\n");
const declLike = p => /^(\.\.\.)?\s*[A-Za-z_$\[{]/.test(String(p).trim());

/** Compare the exported API with the markdown docs. Read-only. */
export function syncDocs({ root, docsDir = "docs", readme = "README.md", title = "API reference", ignore = [] } = {}) {
  const api = extractApi({ root }); if (!api.ok) return api;
  const d = readDocs(root, docsDir, readme); if (!d.ok) return d;
  const ign = new Set(Array.isArray(ignore) ? ignore.map(String) : []);
  const scans = d.docs.map(x => scanMarkdown(x.rel, x.text)), mentions = new Map();
  for (const s of scans) for (const [k, v] of s.mentions) if (!mentions.has(k)) mentions.set(k, v);
  const exported = new Map(); for (const m of api.modules) for (const e of m.exports) { if (!exported.has(e.name)) exported.set(e.name, []); exported.get(e.name).push({ file: m.file, ...e }); }
  const findings = [], add = f => { if (findings.length < LIMITS.maxFindings) findings.push(f); };
  for (const m of api.modules) for (const e of m.exports) {
    if (e.reexport || e.name === "default" || ign.has(e.name)) continue;
    if (!mentions.has(e.name)) add({ kind: "UNDOCUMENTED", name: e.name, file: m.file, line: e.line, signature: e.signature });
  }
  const seenStale = new Set();
  for (const s of scans) for (const c of s.claims) {
    const defs = (exported.get(c.name) ?? []).filter(x => x.kind === "function" && !x.reexport); if (!defs.length || ign.has(c.name) || !c.params.every(declLike)) continue;     // add(1, "x") is a usage example, not a signature
    const doc = c.params.map(paramName);
    if (defs.some(x => JSON.stringify(x.params.map(paramName)) === JSON.stringify(doc))) continue;
    const k = c.file + ":" + c.line + ":" + c.name; if (seenStale.has(k)) continue; seenStale.add(k);
    add({ kind: "STALE_SIGNATURE", name: c.name, doc: { file: c.file, line: c.line, text: c.text }, actual: defs.map(x => ({ file: x.file, line: x.line, signature: x.signature })) });
  }
  for (const s of scans) for (const h of s.headings) if (!exported.has(h.name) && !ign.has(h.name)) add({ kind: "REMOVED_OR_RENAMED", name: h.name, doc: { file: h.file, line: h.line, where: h.where } });
  const ref = generateReference(api, { title });
  for (const s of scans) {
    if (s.refMalformed) add({ kind: "REFERENCE_BLOCK_MALFORMED", doc: { file: d.docs[scans.indexOf(s)].rel } });
    for (const r of s.refEntries) if (normRef(r.body) !== ref.body) add({ kind: "REFERENCE_OUT_OF_DATE", doc: { file: r.file, line: r.startLine }, expectedSha256: ref.sha256, foundSha256: sha256(r.body) });
  }
  const counts = {}; for (const f of findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  const incomplete = api.incomplete || d.skipped.oversize + d.skipped.unreadable + d.skipped.pastLimit > 0;
  return { ok: true, graphHash: api.graphHash, docsRead: d.docs.map(x => x.rel), docsSkipped: d.skipped, incomplete, counts, findings, reference: ref, readOnly: true };
}

/** CI mode. pass=false (exitCode 1) on any listed finding kind, too many undocumented items, or docs that could not be fully read. */
export function checkDocs({ root, docsDir = "docs", readme = "README.md", failOn = ["STALE_SIGNATURE", "REMOVED_OR_RENAMED", "REFERENCE_OUT_OF_DATE", "REFERENCE_BLOCK_MALFORMED"], maxUndocumented = null, ignore = [] } = {}) {
  const r = syncDocs({ root, docsDir, readme, ignore });
  if (!r.ok) return { pass: false, exitCode: 1, reasons: ["CHECK_FAILED_CLOSED:" + r.reason] };
  const reasons = [];
  for (const k of failOn) if (r.counts[k]) reasons.push(k + ":" + r.counts[k]);
  if (Number.isInteger(maxUndocumented) && (r.counts.UNDOCUMENTED ?? 0) > maxUndocumented) reasons.push("UNDOCUMENTED:" + r.counts.UNDOCUMENTED + ">" + maxUndocumented);
  if (r.incomplete) reasons.push("DOCS_OR_SOURCE_NOT_FULLY_READ");
  return { pass: reasons.length === 0, exitCode: reasons.length ? 1 : 0, reasons, counts: r.counts, findings: r.findings.slice(0, 200) };
}

// ---------------- S514 Hungarian-English interface verifier ----------------
const PLACEHOLDER = /\{\{\s*[\w.]+\s*\}\}|\{\s*[\w.]+\s*\}|\$\{\s*[\w.]+\s*\}|%(?:\d+\$)?[sdifj]|%\([\w.]+\)[sd]/g;
const MOJIBAKE = /[ÃÅÄ][\u0080-¿‘-„†-•…ŒœŠšŸŽž]|â€[\u0080-¿‘-„™œ\u009d"]?|�|Ã©|Ã¡|Å‘|Å±/;
const WRONG_HU = /[õûÕÛ]/;
function flatten(obj, prefix = "", out = new Map(), depth = 0, bad = []) {
  if (depth > LIMITS.maxDepth) { bad.push({ key: prefix, reason: "TOO_DEEP" }); return out; }
  for (const [k, v] of Object.entries(obj)) {
    if (out.size >= LIMITS.maxKeys) { bad.push({ key: prefix, reason: "TOO_MANY_KEYS" }); break; }
    const key = prefix ? prefix + "." + k : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out, depth + 1, bad); else out.set(key, v);
  }
  return out;
}
const asTable = (t, name) => { if (typeof t === "string") { if (t.length > 8 * 1048576) return { ok: false, reason: name + "_TOO_LARGE" }; try { t = JSON.parse(t); } catch { return { ok: false, reason: name + "_JSON_INVALID" }; } } if (!t || typeof t !== "object" || Array.isArray(t)) return { ok: false, reason: name + "_MUST_BE_OBJECT" }; const bad = []; const m = flatten(t, "", new Map(), 0, bad); return bad.length ? { ok: false, reason: name + "_" + bad[0].reason } : { ok: true, map: m }; };
const phs = s => (String(s).match(PLACEHOLDER) ?? []).map(x => x.replace(/\s+/g, "")).sort();
const letters = s => (String(s).match(/\p{L}/gu) ?? []).length;

/** Compare a Hungarian and an English string table. */
export function verifyTranslations({ hu, en, maxRatio = 2.0, minLenForRatio = 8, allowIdentical = [] } = {}) {
  const H = asTable(hu, "HU"); if (!H.ok) return H; const E = asTable(en, "EN"); if (!E.ok) return E;
  if (!(maxRatio > 1 && maxRatio <= 10)) return { ok: false, reason: "MAX_RATIO_INVALID" };
  const allow = new Set(Array.isArray(allowIdentical) ? allowIdentical.map(String) : []), findings = [], add = f => { if (findings.length < LIMITS.maxFindings) findings.push(f); };
  const ev = s => clean(String(s)).slice(0, 120);
  for (const k of [...E.map.keys()].sort()) if (!H.map.has(k)) add({ kind: "MISSING_IN_HU", key: k, en: ev(E.map.get(k)) });
  for (const k of [...H.map.keys()].sort()) if (!E.map.has(k)) add({ kind: "MISSING_IN_EN", key: k, hu: ev(H.map.get(k)) });
  for (const k of [...H.map.keys()].sort()) {
    const h = H.map.get(k), e = E.map.get(k);
    for (const [lang, v] of [["hu", h], ["en", e]]) { if (v === undefined) continue; if (typeof v !== "string") add({ kind: "NON_STRING_VALUE", key: k, lang }); else { if (!v.trim()) add({ kind: "EMPTY_VALUE", key: k, lang }); if (v.length > LIMITS.maxValueChars) add({ kind: "VALUE_TOO_LONG", key: k, lang }); if (MOJIBAKE.test(v)) add({ kind: "MOJIBAKE", key: k, lang, text: ev(v) }); } }
    if (typeof h === "string" && WRONG_HU.test(h)) add({ kind: "WRONG_HU_ACCENT", key: k, text: ev(h), hint: "õ/û are not Hungarian letters: probably ő/ű lost in a Latin-1 conversion" });
    if (typeof h !== "string" || typeof e !== "string") continue;
    if (h === e && letters(h) >= 3 && !allow.has(k) && !allow.has(h) && !/^https?:\/\//.test(h)) add({ kind: "UNTRANSLATED_IDENTICAL", key: k, text: ev(h) });
    const ph = phs(h), pe = phs(e); if (JSON.stringify(ph) !== JSON.stringify(pe)) add({ kind: "PLACEHOLDER_MISMATCH", key: k, hu: ph, en: pe });
    if (e.length >= minLenForRatio && h.length > e.length * maxRatio) add({ kind: "LENGTH_BLOWUP", key: k, huLength: h.length, enLength: e.length, ratio: +(h.length / e.length).toFixed(2) });
    else if (h.length >= minLenForRatio && e.length > h.length * maxRatio) add({ kind: "LENGTH_BLOWUP", key: k, huLength: h.length, enLength: e.length, ratio: +(h.length / e.length).toFixed(2) });
  }
  const counts = {}; for (const f of findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  return { ok: true, keys: { hu: H.map.size, en: E.map.size }, counts, findings, pass: findings.length === 0 };
}

const UI_PROPS = new Set(["textContent", "innerText", "innerHTML", "outerHTML", "title", "placeholder", "label", "alt", "ariaLabel"]);
const UI_CALLS = new Set(["alert", "confirm", "prompt", "createTextNode", "insertAdjacentText"]);
const UI_ATTRS = new Set(["title", "placeholder", "aria-label", "alt", "aria-description", "value"]);
const UI_KEYS = new Set(["text", "label", "title", "placeholder", "message", "tooltip", "caption", "heading", "description", "confirmText", "cancelText"]);
const looksUi = s => { const t = String(s).trim(); if (t.length < 2 || letters(t) < 2) return false; if (/^(https?:|\/|\.\/|#[\w-]+$|\.[\w-]+$|[\w-]+\.(js|css|png|svg|json)$)/.test(t)) return false; if (/^[a-z0-9_.:-]+$/.test(t)) return false; return /\s/.test(t) || /^\p{Lu}/u.test(t) || /[.!?:]$/.test(t); };

/** Find user-visible string literals that bypass the translation function. Read-only. */
export function scanHardcodedStrings({ root, file, i18nFunctions = ["t", "i18n", "tr", "__", "translate", "L"] } = {}) {
  const r = readConfined(root, file); if (!r.ok) return r;
  const tf = new Set(i18nFunctions.map(String)), { tokens: ts, truncated } = tokenize(r.text), findings = [];
  const inI18n = k => { for (let j = k - 1, d = 0; j >= 0 && k - j < 12; j--) { const t = ts[j]; if (t.t === "p" && t.v === ")") d++; if (t.t === "p" && t.v === "(") { if (d === 0) return ts[j - 1]?.t === "id" && (tf.has(ts[j - 1].v) || (ts[j - 2]?.v === "." && tf.has(ts[j - 1].v))); d--; } if (t.t === "p" && t.v === ";") return false; } return false; };
  const push = (k, text, context) => { if (findings.length < LIMITS.maxScanFindings && looksUi(text) && !inI18n(k)) findings.push({ line: ts[k].line, context, text: clean(text).slice(0, 120), suggestedKey: String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) }); };
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k]; if (t.t !== "str" && t.t !== "tpl") continue;
    const p1 = ts[k - 1], p2 = ts[k - 2], p3 = ts[k - 3];
    if (p1?.v === "=" && p2?.t === "id" && UI_PROPS.has(p2.v) && p3?.v === ".") { if (t.t === "tpl" || /</.test(t.v)) { for (const m of t.v.matchAll(/>([^<>$]{2,})</g)) push(k, m[1], "." + p2.v + " (markup)"); if (!/</.test(t.v)) push(k, t.v, "." + p2.v); } else push(k, t.v, "." + p2.v); continue; }
    if (p1?.v === "+=" || (p1?.v === "=" && p2?.v === "+")) continue;
    if (p1?.v === "(" && p2?.t === "id" && UI_CALLS.has(p2.v)) { push(k, t.v, p2.v + "()"); continue; }
    if (p1?.v === "," && p2?.t === "str" && UI_ATTRS.has(p2.v) && p3?.v === "(" && ts[k - 4]?.v === "setAttribute") { push(k, t.v, "setAttribute(" + p2.v + ")"); continue; }
    if (p1?.v === ":" && (p2?.t === "id" || p2?.t === "str") && UI_KEYS.has(p2.v)) { push(k, t.v, p2.v + ":"); continue; }
    if (t.t === "tpl" && /<[a-z][^>]*>/i.test(t.v)) for (const m of t.v.matchAll(/>([^<>$]{2,})</g)) push(k, m[1], "template markup");
  }
  return { ok: true, file: r.rel, findings, count: findings.length, truncated, note: "Heuristic: strings in UI positions that are not wrapped in one of " + [...tf].join("/") + "()." };
}
