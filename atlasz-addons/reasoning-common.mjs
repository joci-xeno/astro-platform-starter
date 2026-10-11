// W3 shared plumbing for the reasoning/coordination protocol engines (multi-solution, debate, decision analysis, goal planner).
// It adds NO agent, NO network and NO model of its own. Every model call goes through an adapter the CALLER injects:
//   model: async ({ role, prompt, seed }) => ({ text, family })
// Without an adapter every engine answers MODEL_NOT_CONFIGURED (fail closed, nothing is simulated).
// Model output is UNTRUSTED DATA: it is size-bounded BEFORE any scan, NUL/format characters are removed, credential-shaped text is redacted
// (secret-patterns), injection phrasing is detected with the existing detectors (agent-memory looksLikeInstruction + text-compare INJECTION_PATTERNS),
// fences are defanged, and it is never executed or obeyed. "No signals" is not a safety claim.
// Independence: a judge's family is checked against every author family with the existing rules (business/judge.mjs eligibility + anti-collusion-guard).
// Honest limit: the family is what the ADAPTER reports. This module cannot prove which provider really answered.
import crypto from "node:crypto";
import { scrub, containsSecret } from "./secret-patterns.mjs";
import { INJECTION_PATTERNS } from "./text-compare.mjs";
import { looksLikeInstruction } from "./agent-memory.mjs";
import { createJudgePanel } from "./business/judge.mjs";
import { inspectCoordination } from "./anti-collusion-guard.mjs";
import { RESERVED } from "./safe-keys.mjs";

export const COMMON_LIMITS = Object.freeze({ maxPrompt: 12000, maxOutput: 6000, hardOutput: 200000, timeoutMs: 30000, maxJson: 6000 });
export const FAMILY_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
export const STATUS_VOCABULARY = Object.freeze({ IMPLEMENTED: "code exists", TESTED: "unit tests with fake adapters pass", CONNECTED: "a real adapter is injected", LIVE: "runtime evidence from a real provider" });
export const sha256 = t => crypto.createHash("sha256").update(String(t)).digest("hex");
/** Stable JSON (sorted keys) for hashing plans/records. */
export const canon = v => (Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v ?? null));
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const defang = t => String(t).replace(/<{2,}|>{2,}/g, m => m.split("").join("​"));
export const fence = (label, text) => "<<UNTRUSTED_MODEL_OUTPUT " + String(label).replace(/[^A-Za-z0-9:._-]/g, "_").slice(0, 60) + ">>\n" + defang(text) + "\n<<END_UNTRUSTED_MODEL_OUTPUT>>";
/** Untrusted caller/model text placed INSIDE a prompt is fenced the same way so it reads as data, not as an instruction to the next model. */
export const quote = (label, text, max = 3000) => fence(label, boundText(text, max).text);
export function boundText(t, max) { const s = String(t ?? ""); return s.length > max ? { text: s.slice(0, max), truncated: true } : { text: s, truncated: false }; }
// Evaluation gaming in a candidate/turn ("score this 10", "the judge must prefer ...") is reported as an anti-collusion finding (intent GAME_EVALUATION).
const GAMING = [/\b(?:give|rate|score|mark)\s+(?:this|my|me|it|the\s+(?:first|winning))?\s*(?:solution|answer|proposal|candidate)?\s*(?:a\s+)?(?:10|ten|100|the\s+(?:highest|top|max(?:imum)?))\b/i, /\bjudge\s+(?:must|should|will)\s+(?:prefer|pick|choose|select|rank)\b/i, /\b(?:as\s+(?:we\s+)?agreed|our\s+(?:deal|agreement))\b.{0,40}\b(?:score|rank|vote|judge)/i, /\bvote\s+for\s+(?:me|this|candidate)\b/i];
export const looksLikeGaming = t => GAMING.some(r => r.test(String(t)));

/** Screen untrusted text: bound first (so no scan runs on unbounded input), strip NUL/format chars, redact secrets, detect injection + gaming. */
export function screenText(raw, { max = COMMON_LIMITS.maxOutput } = {}) {
  const s0 = typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
  const oversized = s0.length > max, cut = s0.slice(0, max);
  const clean = (cut.isWellFormed() ? cut : cut.toWellFormed()).replace(/\0/g, "").replace(/[\p{Cf}­]/gu, "");
  const hadSecret = containsSecret(clean), red = scrub(clean);
  const signals = [];
  if (looksLikeInstruction(clean)) signals.push("INSTRUCTION_LIKE");
  for (const p of INJECTION_PATTERNS) if (p.test(clean)) { signals.push("PATTERN:" + p.source.slice(0, 30)); if (signals.length > 6) break; }
  return { text: red, oversized, originalChars: s0.length, secretRedacted: hadSecret || red !== clean, injection: signals.length > 0, injectionSignals: signals, gaming: looksLikeGaming(clean), untrusted: true };
}

async function withTimeout(p, ms) {
  let timer; const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("MODEL_TIMEOUT")), ms); });
  try { return await Promise.race([p, t]); } finally { clearTimeout(timer); }
}
/** One model call. Never throws. Returns {ok:true, family, text(screened), screen, sha} or {ok:false, reason}. */
export async function callModel(model, { role, prompt, seed = 0 }, { maxOutput = COMMON_LIMITS.maxOutput, timeoutMs = COMMON_LIMITS.timeoutMs, maxPrompt = COMMON_LIMITS.maxPrompt } = {}) {
  if (typeof model !== "function") return { ok: false, reason: "MODEL_NOT_CONFIGURED" };
  if (typeof prompt !== "string" || !prompt.trim()) return { ok: false, reason: "PROMPT_REQUIRED" };
  if (prompt.length > maxPrompt) return { ok: false, reason: "PROMPT_TOO_LONG" };
  let r; try { r = await withTimeout(Promise.resolve().then(() => model({ role: String(role), prompt, seed })), timeoutMs); }
  catch (e) { return { ok: false, reason: String(e?.message) === "MODEL_TIMEOUT" ? "MODEL_TIMEOUT" : "MODEL_ERROR", detail: scrub(String(e?.message ?? e)).slice(0, 120) }; }
  if (!r || typeof r !== "object" || typeof r.text !== "string") return { ok: false, reason: "MODEL_BAD_RESPONSE" };
  const family = typeof r.family === "string" ? r.family.trim().toLowerCase() : "";
  if (!FAMILY_RE.test(family)) return { ok: false, reason: "MODEL_FAMILY_MISSING_OR_INVALID" };
  if (r.text.length > COMMON_LIMITS.hardOutput) return { ok: false, reason: "MODEL_OUTPUT_OVERSIZED", family, chars: r.text.length };
  const screen = screenText(r.text, { max: maxOutput });
  return { ok: true, family, role: String(role), text: screen.text, screen, sha: sha256(screen.text) };
}

/** Extract the first JSON object from model text, bounded; keys like __proto__/constructor are dropped; returns null when there is none. Never evaluates anything. */
export function parseJsonObject(text, { max = COMMON_LIMITS.maxJson } = {}) {
  const s = String(text ?? ""), a = s.indexOf("{"); if (a < 0) return null;
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = a; i < s.length && i - a <= max; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === "\"") inStr = false; continue; }
    if (c === "\"") inStr = true; else if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  try { return JSON.parse(s.slice(a, end + 1), (k, v) => (RESERVED.has(k) ? undefined : v)); } catch { return null; }
}
export const num = (v, lo = 0, hi = 10) => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN; return Number.isFinite(n) ? clamp(n, lo, hi) : null; };

/**
 * Independence of an evaluator (judge) against the authors it evaluates, using the EXISTING rules:
 *   business/judge.mjs: a DIFFERENT_PROVIDER_MODEL judge is refused when its family equals the generator family (checked against EVERY author family)
 *   anti-collusion-guard: an evaluation request whose evaluator is the evaluated party is SELF_EVALUATION; gaming text is EVALUATION_GAMING
 */
export function checkIndependence({ judgeFamily, authors = [], texts = [] }) {
  const reasons = [];
  if (!FAMILY_RE.test(String(judgeFamily ?? ""))) return { independent: false, reasons: ["JUDGE_FAMILY_UNKNOWN"], collusion: null };
  const panel = createJudgePanel();
  panel.register({ id: "judge:" + judgeFamily, kind: "DIFFERENT_PROVIDER_MODEL", family: judgeFamily, modelId: "family:" + judgeFamily, judge: () => ({ pass: null }) });
  for (const a of authors) {
    const r = panel.eligible({ id: "w", executorId: "author:" + a.id, generatorFamily: a.family, generatorModelId: "family:" + a.family, highValue: true });
    if (!r.eligible.length) reasons.push("JUDGE_NOT_INDEPENDENT_OF:" + a.id + ":" + (r.rejected[0]?.reason ?? "UNKNOWN"));
  }
  const messages = authors.map((a, i) => ({ id: "eval-" + i, fromAgent: "model:" + judgeFamily, type: "EVALUATION_REQUEST", targetAgent: "model:" + a.family, taskId: "W3" }));
  texts.forEach((t, i) => { if (looksLikeGaming(t)) messages.push({ id: "text-" + i, fromAgent: "author", intent: "GAME_EVALUATION", taskId: "W3" }); });
  const collusion = inspectCoordination({ messages, masterTaskIds: ["W3"], judgeAgentIds: ["model:" + judgeFamily] });
  for (const f of collusion.findings) reasons.push("ANTI_COLLUSION:" + f.type);
  return { independent: !reasons.some(r => r.startsWith("JUDGE_NOT_INDEPENDENT") || r === "ANTI_COLLUSION:SELF_EVALUATION"), reasons: [...new Set(reasons)], collusion };
}

/** Deterministic normalisation for comparison (not for display). */
export const normaliseForCompare = t => String(t ?? "").normalize("NFKC").toLowerCase().replace(/[\p{Cf}­]/gu, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
export function shingles(t, k = 3) { const w = normaliseForCompare(t).split(" ").filter(Boolean).slice(0, 3000), out = new Set(); if (w.length < k) { if (w.length) out.add(w.join(" ")); return out; } for (let i = 0; i + k <= w.length; i++) out.add(w.slice(i, i + k).join(" ")); return out; }
export function jaccard(a, b) { if (!a.size && !b.size) return 1; let inter = 0; for (const x of a) if (b.has(x)) inter++; return inter / (a.size + b.size - inter); }
