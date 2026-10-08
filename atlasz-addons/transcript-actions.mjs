// Transcript -> index, summary and action steps (85-capability programme: P02 Video-to-Action Workflow, the part that needs no media provider).
// INPUT IS A TRANSCRIPT THE CALLER ALREADY HAS (pasted or from a captions file). Nothing is downloaded or transcribed here: no ASR/video provider exists in this workspace, so
// "video in, steps out" stays EXTERNAL. Supports WebVTT/SRT cues or plain text. Everything extracted is EXTRACTIVE (copied sentences with their timestamps), never invented, and
// the transcript is untrusted data: instruction-like content is reported as a signal and is never acted on.
export const LIMITS = Object.freeze({ maxChars: 400000, maxCues: 20000, maxSteps: 60 });
const SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)|\bsk-[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b|\bghp_[A-Za-z0-9]{30,}/g;
const TS = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})/;
const toSec = (h, m, s, ms) => Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
export const fmt = sec => { const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? String(h).padStart(2, "0") + ":" : "") + String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
/** Parse WebVTT/SRT into cues [{start,end,text}]; plain text becomes untimed cues (start=null) per paragraph. */
export function parseTranscript(raw) {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "TRANSCRIPT_REQUIRED" };
  if (raw.length > LIMITS.maxChars) return { ok: false, reason: "TRANSCRIPT_TOO_LARGE" };
  const text = raw.replace(/\r/g, "").replace(/^﻿/, ""), blocks = text.split(/\n{2,}/), cues = []; let timed = false;
  for (const b of blocks) {
    const lines = b.split("\n").map(l => l.trim()).filter(Boolean); if (!lines.length || /^WEBVTT/.test(lines[0]) && lines.length === 1) continue;
    const ti = lines.findIndex(l => TS.test(l));
    if (ti >= 0) { const m = TS.exec(lines[ti]); timed = true; const body = lines.slice(ti + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); if (body) cues.push({ start: toSec(m[1], m[2], m[3], m[4]), end: toSec(m[5], m[6], m[7], m[8]), text: body }); }
    else if (!/^(WEBVTT|NOTE|STYLE|Kind:|Language:)/.test(lines[0]) && !/^\d+$/.test(lines.join(" "))) cues.push({ start: null, end: null, text: lines.join(" ").replace(/\s+/g, " ") });
    if (cues.length > LIMITS.maxCues) return { ok: false, reason: "TOO_MANY_CUES" };
  }
  if (!cues.length) return { ok: false, reason: "NO_CUES_FOUND" };
  if (timed && cues.some((c, i) => c.start === null || (i && c.start < cues[i - 1].start - 0.001))) return { ok: false, reason: "CUES_OUT_OF_ORDER_OR_MIXED" };
  SECRET.lastIndex = 0; return { ok: true, timed, cues: cues.map(c => ({ ...c, text: c.text.replace(SECRET, "[redacted]") })) };
}
const SENT = /[^.!?]+[.!?]+|[^.!?]+$/g;
const STOPW = new Set("the and for with that this from are was were have has not you your our they them his her its into out all any can will would about more than then also but just like what when where which there their here very really some one now going gonna okay yeah right know get got let".split(" "));
const IMPERATIVE = /^(?:never|don't|do not|avoid|be careful|first|next|then|now|after that|finally|also|make sure(?: to)?|remember to|don't forget to|you (?:need|have|should|must) to|you(?:'ll| will) (?:need|want) to|we (?:need|have|should) to|go to|click|open|select|choose|type|enter|press|run|install|create|add|set|save|copy|paste|check|download|upload|write|build|use|connect|configure|start|stop|restart|remove|delete|update|add|import|export|name|pick|turn|enable|disable|log ?in|sign ?in)\b/i;
const NEG = /\b(?:don't (?!forget)|do not |never\b|avoid\b|careful\b|warning\b)/i;
const INJECTION = [/ignore (all |any )?(the )?(previous|prior|above) (instructions|rules)/i, /you are now\b/i, /reveal (your |the )?(system prompt|secrets?|api key)/i, /(wire|send|transfer) \$?\d[\d,.]* ?(usd|dollars|eur|huf)?/i];
/** Chapters: a new chapter starts at a gap > gapSec between cues (timed) or every `perChapter` cues (untimed); the label is the chapter's most distinctive terms. */
function chapters(cues, { gapSec = 20, perChapter = 12 } = {}) {
  const out = []; let cur = null;
  cues.forEach((c, i) => { const split = !cur || (c.start !== null ? c.start - cur.lastEnd > gapSec : cur.cues.length >= perChapter); if (split) { cur = { first: i, start: c.start, cues: [], lastEnd: c.end ?? 0 }; out.push(cur); } cur.cues.push(c); cur.lastEnd = c.end ?? cur.lastEnd; });
  const df = new Map(); for (const ch of out) for (const w of new Set(ch.cues.flatMap(c => c.text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []))) df.set(w, (df.get(w) ?? 0) + 1);
  return out.map((ch, k) => { const tf = new Map(); for (const w of ch.cues.flatMap(c => c.text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])) if (!STOPW.has(w)) tf.set(w, (tf.get(w) ?? 0) + 1);
    const terms = [...tf].map(([w, n]) => [w, n / (df.get(w) ?? 1)]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(x => x[0]);
    return { n: k + 1, start: ch.start, at: ch.start === null ? null : fmt(ch.start), cues: ch.cues.length, label: terms.join(", ") || "(no distinctive terms)" }; });
}
/** Extractive summary: top-scoring sentences by in-transcript term frequency, returned in original order with their timestamps. */
function summary(cues, n = 5) {
  const sents = []; cues.forEach((c, ci) => { for (const s of (c.text.match(SENT) ?? [])) { const t = s.trim(); if (t.split(/\s+/).length >= 6) sents.push({ t, ci, at: c.start }); } });
  const tf = new Map(); for (const s of sents) for (const w of s.t.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []) if (!STOPW.has(w)) tf.set(w, (tf.get(w) ?? 0) + 1);
  const scored = sents.map((s, i) => ({ ...s, i, score: (s.t.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter(w => !STOPW.has(w)).reduce((a, w) => a + (tf.get(w) ?? 0), 0) / Math.sqrt(s.t.split(/\s+/).length) }));
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, n).sort((a, b) => a.i - b.i).map(s => ({ text: s.t, at: s.at === null ? null : fmt(s.at) }));
}
function steps(cues) {
  const out = [];
  for (const c of cues) for (const s of (c.text.match(SENT) ?? [])) {
    const t = s.trim().replace(/^(?:so|and|okay|ok|alright|now then)[, ]+/i, ""); if (!IMPERATIVE.test(t) || t.split(/\s+/).length < 3) continue;
    out.push({ n: out.length + 1, step: t.replace(/[.!]+$/, ""), at: c.start === null ? null : fmt(c.start), kind: NEG.test(t) ? "WARNING" : "STEP" });
    if (out.length >= LIMITS.maxSteps) return out;
  }
  return out;
}
export function analyzeTranscript(raw, opts = {}) {
  const p = parseTranscript(raw); if (!p.ok) return p;
  const text = p.cues.map(c => c.text).join(" ");
  return { ok: true, untrusted: true, timed: p.timed, cues: p.cues.length, durationSec: p.timed ? Math.round(p.cues.at(-1).end) : null, chapters: chapters(p.cues, opts), summary: summary(p.cues, opts.summarySentences ?? 5), steps: steps(p.cues),
    injectionSignals: INJECTION.filter(r => r.test(text)).length, source: "SUPPLIED_TRANSCRIPT", note: "Extractive only. No video was fetched or transcribed; no step was executed." };
}
