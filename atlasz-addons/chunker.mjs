// Large-document strategy (85-capability programme: GE01 Long-Context Intelligence). Splits text into bounded chunks on paragraph/sentence/word boundaries with overlap,
// proves coverage (every character lands in at least one chunk), and plans a deterministic map-reduce over the chunks. This is NOT a long-context model: true
// long-context model use needs a provider and stays EXTERNAL; this is what makes large inputs processable under any context limit.
import { estimateTokens } from "./context-manager.mjs";

export const LIMITS = Object.freeze({ maxChars: 5_000_000, maxChunks: 5000, minTokens: 16 });
const BOUNDARIES = [/\n\s*\n/g, /(?<=[.!?])\s+/g, /\s+/g];            // paragraph, sentence, word

/** chunkText(text,{maxTokens,overlapTokens}) -> {ok, chunks:[{index,start,end,text,tokens}], coverage} */
export function chunkText(text, { maxTokens = 800, overlapTokens = 80 } = {}) {
  if (typeof text !== "string") return { ok: false, reason: "TEXT_REQUIRED" };
  if (text.length > LIMITS.maxChars) return { ok: false, reason: "TEXT_TOO_LARGE" };
  if (!Number.isInteger(maxTokens) || maxTokens < LIMITS.minTokens) return { ok: false, reason: "MAX_TOKENS_INVALID" };
  if (!Number.isInteger(overlapTokens) || overlapTokens < 0 || overlapTokens >= maxTokens / 2) return { ok: false, reason: "OVERLAP_INVALID" };
  if (!text.length) return { ok: true, chunks: [], coverage: { complete: true, uncovered: 0 } };
  const maxChars = maxTokens * 4, overlapChars = overlapTokens * 4, chunks = []; let pos = 0;
  while (pos < text.length) {
    let end = Math.min(text.length, pos + maxChars);
    if (end < text.length) {                                               // prefer the latest natural boundary in the back half of the window
      const lo = pos + Math.floor(maxChars / 2), win = text.slice(lo, end);
      for (const re of BOUNDARIES) { re.lastIndex = 0; let m, last = -1; while ((m = re.exec(win))) last = m.index + m[0].length; if (last > 0) { end = lo + last; break; } }
    }
    chunks.push({ index: chunks.length, start: pos, end, text: text.slice(pos, end), tokens: estimateTokens(text.slice(pos, end)) });
    if (chunks.length > LIMITS.maxChunks) return { ok: false, reason: "TOO_MANY_CHUNKS" };
    if (end >= text.length) break;
    pos = Math.max(end - overlapChars, pos + 1);                               // always advance
    if (pos < end) { const s = text.slice(pos, end).search(/\s/); if (s > 0 && s < overlapChars) pos += s + 1; }   // start the overlap on a word boundary
  }
  return { ok: true, chunks, coverage: verifyCoverage(text, chunks) };
}
/** Coverage proof: the union of [start,end) over the chunks must be the whole text, and each chunk's text must equal its slice. */
export function verifyCoverage(text, chunks) {
  let covered = 0, reach = 0, faithful = true;
  for (const c of chunks) { if (text.slice(c.start, c.end) !== c.text) faithful = false; if (c.start > reach) break; if (c.end > reach) { covered += c.end - Math.max(c.start, reach); reach = c.end; } }
  return { complete: faithful && reach === text.length && covered === text.length, uncovered: text.length - covered, faithful };
}
/** Deterministic map-reduce plan: map over every chunk, then reduce in groups of `fanIn` until one result remains. */
export function mapReducePlan(chunkCount, { fanIn = 8 } = {}) {
  if (!Number.isInteger(chunkCount) || chunkCount < 0) return { ok: false, reason: "COUNT_INVALID" };
  if (!Number.isInteger(fanIn) || fanIn < 2 || fanIn > 64) return { ok: false, reason: "FAN_IN_INVALID" };
  const stages = [{ stage: "MAP", tasks: chunkCount }]; let n = chunkCount;
  while (n > 1) { n = Math.ceil(n / fanIn); stages.push({ stage: "REDUCE", tasks: n }); }
  return { ok: true, stages, totalTasks: stages.reduce((a, s) => a + s.tasks, 0), levels: stages.length - 1, finalTasks: n };
}
