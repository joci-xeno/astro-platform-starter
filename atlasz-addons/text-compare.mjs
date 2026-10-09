// Multi-page comparison (85-capability programme: P13). Compares TEXTS THE CALLER SUPPLIES (already fetched by an authorised path) - it never fetches anything.
// Output is structured: per-page facts (title, headings, numbers/prices, links, size), then a pairwise diff (line-level LCS, added/removed/unchanged counts, changed numbers and
// headings) and an "only here / in all" term table. Page text is untrusted DATA: it is stripped of markup, scanned for injection signals (reported, never obeyed) and secrets are redacted.
import { scrub } from "./secret-patterns.mjs";
export const LIMITS = Object.freeze({ maxPages: 6, maxChars: 200000, maxLines: 2000, maxDiffLines: 200 });
const INJECTION = [/ignore (all |any )?(the )?(previous|prior|above) (instructions|rules)/i, /disregard (all |any )?(the |your )?(previous|prior|above|earlier|preceding)/i, /you are now\b/i, /reveal (your |the )?(system prompt|secrets?|api key)/i, /\bsystem prompt\b/i, /(wire|send|transfer) \$?\d[\d,.]* ?(usd|dollars|eur|huf)?/i, /do not tell (the )?(user|owner)/i,
  /ignore (all |any )?(of )?(the |your )?(previous|prior|above|earlier|preceding)\b/i, /forget (everything|all|what)\b.{0,30}\b(above|before|prior|earlier|told)/i, /\bnew (instructions?|rules?)\s*:/i, /\bact as (an? |the )?(admin|administrator|root|system|developer|owner)\b/i,
  /\b(bypass|circumvent|disable|override) (the |all |any )?(approvals?|safety|security|owner|kill ?switch|rules|polic(y|ies)|restrictions?)\b/i, /\bgrant (yourself |all |every |full )/i, /\bpretend (to be|you are|that you)\b/i,
  /\b(override|overrule|supersede|replace) (all |any |your |the |these )+(instructions|rules|guidelines|settings)\b/i, /\b(approve|authori[sz]e|pay|release) (all|every|any) (payments?|invoices?|transfers?|requests?)\b/i, /\bnever (ask|wait|check|require)\b.{0,40}\b(approval|permission|owner|confirm)/i, /\b(print|show|output|repeat|dump|display) (me )?(your|the) (system|hidden|initial|original) (prompt|instructions?|message)/i,
  /(hagyd|hagyja|hagyjátok) figyelmen kívül|felejtsd el (az |a )?(előző|korábbi|fenti)|(előző|korábbi|fenti) (utasításokat|szabályokat)|mostantól te vagy\b|(jóváhagyás|engedély) (nélkül|kérése nélkül)|(utald|fizesd ki|küldd el) .{0,20}(minden|összes)/i];
const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
/** Linear-time markup removal: every search moves forward only, and an unclosed comment / script / tag consumes the rest instead of being rescanned from each opener. */
function stripMarkup(s) {
  const n = s.length, lowAll = s.toLowerCase(), low = lowAll.length === n ? lowAll : null, out = []; let i = 0, gt = -2;
  while (i < n) {
    const lt = s.indexOf("<", i); if (lt < 0) { out.push(s.slice(i)); break; }
    out.push(s.slice(i, lt));
    if (s.startsWith("<!--", lt)) { const e = s.indexOf("-->", lt + 4); out.push(" "); if (e < 0) break; i = e + 3; continue; }
    const m = /^<(script|style|noscript|template)\b/i.exec(s.slice(lt, lt + 12));
    if (m) { out.push(" "); const c = low ? low.indexOf("</" + m[1].toLowerCase(), lt) : -1; if (c < 0) break; const g = s.indexOf(">", c); if (g < 0) break; i = g + 1; continue; }
    if (gt !== -1 && gt < lt) gt = s.indexOf(">", lt);
    if (gt < 0) { out.push(s.slice(lt)); break; }                  // no '>' anywhere after this point: the rest is text (and is never searched again)
    const tag = s.slice(lt, gt + 1); i = gt + 1;
    if (/^<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/table|\/ul|\/ol)\b/i.test(tag.slice(0, 16))) out.push("\n");
    else { const h = /^<h([1-6])\b/i.exec(tag.slice(0, 5)); out.push(h ? "\n#" + h[1] + " " : " "); }
  }
  return out.join("");
}
/** HTML -> readable text: scripts/styles/comments dropped, block tags become line breaks, entities decoded (a fixed list - no numeric entity or markup survives). */
export function toPlainText(input) {
  let s = String(input ?? "");
  if (/<[a-z!\/]/i.test(s)) s = stripMarkup(s);
  s = s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, m => ENT[m]);
  return s.replace(/\r/g, "").split("\n").map(l => l.replace(/[ \t ]+/g, " ").trim()).filter(Boolean).join("\n");
}
const NUM = /(?:[$€£]|\bUSD |\bEUR |\bHUF )?\d[\d.,]*\d(?:\s?(?:%|USD|EUR|HUF|Ft|\$|€|£))?|\b\d\b/g;
const words = t => (t.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
const STOP = new Set("the and for with that this from are was were have has not you your our their they them his her its into out all any can will would about more than then them also but".split(" "));
export const redactSecrets = s => scrub(s, "[redacted]");
/** Normalise before matching: compatibility forms (full-width letters), zero-width / format characters and any run of whitespace (including newlines) cannot be used to split a phrase. One-entry memo: callers test many patterns against the same text. */
const HOMO = { "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0445": "x", "\u0456": "i", "\u0443": "y", "\u0455": "s", "\u03bf": "o", "\u03b1": "a", "\u0131": "i", "\u0475": "v", "\u03bd": "v", "\u0585": "o", "\u03b9": "i", "\u03c5": "u" };
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", "@": "a", $: "s" };   // Cyrillic/Greek look-alikes folded to Latin for MATCHING only
let memoIn = null, memoOut = "";
const squash = t => { const x = String(t); if (x === memoIn) return memoOut; memoIn = x; memoOut = x.normalize("NFKC").replace(/[\p{Cf}\u00ad]/gu, "").replace(/[\u0430\u0435\u043e\u0440\u0441\u0445\u0456\u0443\u0455\u03bf\u03b1\u0131\u0475\u03bd\u0585\u03b9\u03c5]/g, ch => HOMO[ch]).replace(/(?<=[a-z])[01345@\$](?=[a-z])/gi, ch => LEET[ch]).replace(/\s+/g, " "); return memoOut; };
export const INJECTION_PATTERNS = Object.freeze(INJECTION.map(r => Object.freeze({ source: r.source, test: t => r.test(squash(t)) })));
export { facts as pageFacts };
function facts(text, label) {
  const lines = text.split("\n"), headings = lines.filter(l => /^#[1-6] /.test(l)).map(l => l.replace(/^#[1-6] /, "")), links = [...new Set([...text.matchAll(/\bhttps?:\/\/[^\s<>"')]+/gi)].map(m => m[0].replace(/[.,;]+$/, "")))].slice(0, 50);
  const nums = [...new Set((text.match(NUM) ?? []).map(x => x.trim()))].slice(0, 100);
  return { label, chars: text.length, lines: lines.length, words: words(text).length, headings, numbers: nums, links, injectionSignals: INJECTION_PATTERNS.filter(r => r.test(text)).map(r => r.source.slice(0, 40)) };
}
function lcsDiff(a, b) {                                       // line-level longest-common-subsequence diff, O(n*m) with n,m <= maxLines
  const n = a.length, m = b.length, t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { ops.push({ op: "same" }); i++; j++; } else if (t[i + 1][j] >= t[i][j + 1]) ops.push({ op: "del", text: a[i++] }); else ops.push({ op: "add", text: b[j++] }); }
  while (i < n) ops.push({ op: "del", text: a[i++] }); while (j < m) ops.push({ op: "add", text: b[j++] });
  return ops;
}
/** @param pages [{label, text}] 2..6 pages */
export function comparePages(pages) {
  if (!Array.isArray(pages) || pages.length < 2 || pages.length > LIMITS.maxPages) return { ok: false, reason: "NEED_2_TO_" + LIMITS.maxPages + "_PAGES" };
  const clean = [];
  for (const [k, p] of pages.entries()) {
    if (!p || typeof p.text !== "string" || !p.text.trim()) return { ok: false, reason: "PAGE_" + k + "_TEXT_REQUIRED" };
    if (p.text.length > LIMITS.maxChars) return { ok: false, reason: "PAGE_" + k + "_TOO_LARGE" };
    const label = String(p.label ?? "page" + (k + 1)).slice(0, 80); if (clean.some(c => c.label === label)) return { ok: false, reason: "DUPLICATE_LABEL:" + label };
    const text = redactSecrets(toPlainText(p.text)), lines = text.split("\n");
    if (lines.length > LIMITS.maxLines) return { ok: false, reason: "PAGE_" + k + "_TOO_MANY_LINES" };
    clean.push({ label, text, lines });
  }
  const pf = clean.map(c => facts(c.text, c.label)), pairs = [];
  for (let x = 0; x < clean.length; x++) for (let y = x + 1; y < clean.length; y++) {
    const ops = lcsDiff(clean[x].lines, clean[y].lines), same = ops.filter(o => o.op === "same").length, add = ops.filter(o => o.op === "add"), del = ops.filter(o => o.op === "del");
    const nx = new Set(pf[x].numbers), ny = new Set(pf[y].numbers), hx = new Set(pf[x].headings), hy = new Set(pf[y].headings);
    pairs.push({ a: clean[x].label, b: clean[y].label, similarity: Number((same / Math.max(1, Math.max(clean[x].lines.length, clean[y].lines.length))).toFixed(3)), same, added: add.length, removed: del.length,
      numbersOnlyInA: [...nx].filter(v => !ny.has(v)).slice(0, 30), numbersOnlyInB: [...ny].filter(v => !nx.has(v)).slice(0, 30), headingsOnlyInA: [...hx].filter(v => !hy.has(v)), headingsOnlyInB: [...hy].filter(v => !hx.has(v)),
      changes: ops.filter(o => o.op !== "same").slice(0, LIMITS.maxDiffLines).map(o => ({ op: o.op, text: o.text.slice(0, 300) })), truncated: add.length + del.length > LIMITS.maxDiffLines });
  }
  const sets = clean.map(c => new Set(words(c.text).filter(w => !STOP.has(w)))), all = [...new Set(sets.flatMap(s => [...s]))];
  const inAll = all.filter(w => sets.every(s => s.has(w))).slice(0, 40), unique = Object.fromEntries(clean.map((c, i) => [c.label, all.filter(w => sets[i].has(w) && sets.every((s, j) => j === i || !s.has(w))).slice(0, 40)]));
  return { ok: true, untrusted: true, pages: pf, pairs, commonTerms: inAll, uniqueTerms: unique, note: "Compared the supplied texts only. Injection signals are reported, never followed." };
}
