// One shared definition of "looks like a credential", used by every redactor (stream, black box, notes, memory, conversations, code review snippets).
// Linear-time patterns only (no nested quantifiers). Format/zero-width characters are removed before matching so a hidden character cannot split a key.
// Honest limit: pattern-based. An unknown credential format, or a secret split over several fields, is not recognised.
const B = "(?<![A-Za-z0-9])";
const ALL = [
  /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  new RegExp(B + "sk-[A-Za-z0-9_-]{16,}", "g"), new RegExp(B + "[sr]k_(?:live|test)_[A-Za-z0-9]{10,}", "g"),
  new RegExp(B + "gh[pousr]_[A-Za-z0-9]{20,}", "g"), new RegExp(B + "github_pat_[A-Za-z0-9_]{20,}", "g"),
  new RegExp(B + "(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}(?![A-Za-z0-9])", "g"), new RegExp(B + "AIza[0-9A-Za-z_-]{30,}", "g"),
  new RegExp(B + "xox[baprs]-[A-Za-z0-9-]{10,}", "g"), new RegExp(B + "xapp-[A-Za-z0-9-]{10,}", "g"), /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9\/]{10,}/g,
  new RegExp(B + "npm_[A-Za-z0-9]{30,}", "g"), new RegExp(B + "SG\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}", "g"),
  new RegExp(B + "glpat-[A-Za-z0-9_-]{20,}", "g"), new RegExp(B + "ya29\\.[A-Za-z0-9_-]{20,}", "g"), new RegExp(B + "whsec_[A-Za-z0-9]{16,}", "g"), new RegExp(B + "hf_[A-Za-z0-9]{30,}", "g"),
  new RegExp(B + "pypi-[A-Za-z0-9_-]{30,}", "g"), new RegExp(B + "dckr_pat_[A-Za-z0-9_-]{20,}", "g"), new RegExp(B + "dop_v1_[a-f0-9]{40,}", "g"), new RegExp(B + "shp(?:at|ca|pa|ss)_[a-f0-9]{32}", "g"),
  new RegExp(B + "SK[0-9a-f]{32}(?![A-Za-z0-9])", "g"), new RegExp(B + "\\d{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])", "g"), /\bAccountKey=[A-Za-z0-9+\/=]{40,}/g,
  /(?:--password|--passwd|--token|--api-key|--secret)(?:[ =])\S{3,}/gi, /\bsshpass\s+-p\s*\S+/gi, /\s-u\s+[^\s:]+:\S+/g, /\b(?:set-)?cookie\s*:\s*[^\n]+/gi,
  /\bbearer\s+(?!(?:authentication|authorization|auth|tokens?|scheme|schemes|credentials?|headers?|format|access|style)\b)[A-Za-z0-9._~+\/=-]{8,}/gi, /\bbasic\s+(?:(?=[A-Za-z0-9+\/=]*[\d+\/=])[A-Za-z0-9+\/=]{12,}|[A-Za-z0-9+\/=]{28,})/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /(?<=:\/\/)[^\s\/:@]+:[^\s@]+(?=@)/g,                                                    // user:password@host (password may contain "/")
  // NAME=value / "name": "value" for credential-looking names (also inside JSON embedded in a string, and names like OPENAI_API_KEY)
  /(?<![A-Za-z0-9_.-])["']?[A-Za-z0-9_.-]*(?:password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credentials?|authorization|session[_-]?(?:id|key))["']?\s*[:=]\s*(?:"[^"\n]{4,}"|'[^'\n]{4,}'|[^\s"',;}]{4,})/gi,
  /(?<![A-Za-z0-9])["']?(?:pw|pwd|pass)["']?\s*[:=]\s*(?:"[^"\n]{3,}"|'[^'\n]{3,}'|[^\s"',;}]{3,})/gi,
];
export const SECRET_PATTERNS = Object.freeze(ALL), FORMAT_PATTERNS = Object.freeze(ALL.slice(0, -2));   // FORMAT = known credential shapes; the last two (NAME=value) patterns are redaction-only because it can match harmless prose
export const SECRET_KEY = /secret|passw|passphrase|api[_-]?key|private|credential|cookie|mnemonic|(?:^|[_-])(?:pwd|pin|auth|key|token)(?:$|[_-])|(?:access|auth|refresh|session|id)[_-]?token|authorization|x-api-key|bearer/i;
const HIDDEN = /[\p{Cf}­]/gu;
/** Replace credential-shaped substrings with the marker. */
export function scrub(s, marker = "[redacted]", { assign = true } = {}) {
  const orig = String(s ?? ""); let o = orig.normalize("NFKC").replace(HIDDEN, ""), hit = false;     // hidden characters are removed only when a credential is actually found (otherwise the text is returned untouched)
  for (const p of assign ? SECRET_PATTERNS : FORMAT_PATTERNS) { p.lastIndex = 0; const n = o.replace(p, marker); if (n !== o) { hit = true; o = n; } }
  return hit ? o : orig;
}
/** True when the text contains a known credential shape (used by modules that REFUSE to store such text). */
export function containsSecret(s) {
  const o = String(s ?? "").normalize("NFKC").replace(HIDDEN, "");
  for (const p of FORMAT_PATTERNS) { p.lastIndex = 0; if (p.test(o)) { p.lastIndex = 0; return true; } p.lastIndex = 0; }
  return false;
}
