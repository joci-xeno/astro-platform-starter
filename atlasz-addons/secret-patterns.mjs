// One shared definition of "looks like a credential", used by every redactor (stream, black box, notes, memory, conversations, code review snippets).
// Linear-time patterns only (no nested quantifiers). Format/zero-width characters are removed before matching so a hidden character cannot split a key.
// Honest limit: pattern-based. An unknown credential format, or a secret split over several fields, is not recognised.
const B = "(?<![A-Za-z0-9])";
const ALL = [
  /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  new RegExp(B + "sk-(?=[A-Za-z0-9_-]{0,200}[A-Za-z0-9_]{12})[A-Za-z0-9_-]{16,}", "g"), new RegExp(B + "[sr]k_(?:live|test)_[A-Za-z0-9]{10,}", "g"),
  new RegExp("gh[pousr]_[A-Za-z0-9]{20,}", "g"), new RegExp("github_pat_[A-Za-z0-9_]{20,}", "g"),
  new RegExp("(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}(?![A-Za-z0-9])", "g"), new RegExp("AIza[0-9A-Za-z_-]{30,}", "g"),
  new RegExp("xox[baprs]-[A-Za-z0-9-]{10,}", "g"), new RegExp("xapp-[A-Za-z0-9-]{10,}", "g"), /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9\/]{10,}/g,
  new RegExp("npm_[A-Za-z0-9]{30,}", "g"), new RegExp("SG\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}", "g"),
  new RegExp("glpat-[A-Za-z0-9_-]{20,}", "g"), new RegExp("ya29\\.[A-Za-z0-9_-]{20,}", "g"), new RegExp("whsec_[A-Za-z0-9]{16,}", "g"), new RegExp(B + "hf_[A-Za-z0-9]{30,}", "g"),
  new RegExp("pypi-[A-Za-z0-9_-]{30,}", "g"), new RegExp("dckr_pat_[A-Za-z0-9_-]{20,}", "g"), new RegExp("dop_v1_[a-f0-9]{40,}", "g"), new RegExp("shp(?:at|ca|pa|ss)_[a-f0-9]{32}", "g"),
  new RegExp(B + "SK[0-9a-f]{32}(?![A-Za-z0-9])", "g"), new RegExp(B + "\\d{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])", "g"), /\bAccountKey=[A-Za-z0-9+\/=]{40,}/g,
  new RegExp("gsk_[A-Za-z0-9]{30,}", "g"), new RegExp("xai-[A-Za-z0-9]{30,}", "g"), new RegExp(B + "(?:ntn_|secret_)[A-Za-z0-9]{30,}", "g"), new RegExp("lin_api_[A-Za-z0-9]{30,}", "g"), new RegExp(B + "dapi[a-f0-9]{30,}", "g"),
  new RegExp(B + "r8_[A-Za-z0-9]{30,}", "g"), new RegExp("pplx-[A-Za-z0-9]{30,}", "g"), new RegExp("HRKU-[A-Za-z0-9-]{30,}", "g"), new RegExp("hvs\\.[A-Za-z0-9_-]{20,}", "g"), new RegExp("GOCSPX-[A-Za-z0-9_-]{20,}", "g"),
  new RegExp("PMAK-[A-Za-z0-9-]{30,}", "g"), new RegExp(B + "key-[a-f0-9]{32}(?![A-Za-z0-9])", "g"), new RegExp("sq0(?:atp|csp)-[A-Za-z0-9_-]{20,}", "g"), new RegExp(B + "AAAA[A-Za-z0-9_-]{7}:APA91b[A-Za-z0-9_-]{100,}", "g"),
  /discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{20,}/gi, /(?<![a-z0-9.-])[a-z0-9.-]{1,100}\.webhook\.office\.com\/[^\s"']{20,}/gi, /outlook\.office\.com\/webhook\/[^\s"']{20,}/gi, /https?:\/\/[a-f0-9]{32}@[A-Za-z0-9.-]+/g,
  /(?:[?&;]|^|\s)(?:sig|X-Amz-Signature|X-Amz-Credential|X-Goog-Signature)=[A-Za-z0-9%+\/=_-]{20,}/gi, /(?:password|passwd|secret|token|api[_-]?key)%3[Dd][^\s&"']{4,}/gi,
  /--[a-z-]{0,30}(?:password|passwd|token|secret|api-key)=\S{3,}/gi, /--[a-z-]{0,30}(?:password|passwd|token|secret|api-key)\s+(?=\S*[0-9_@!#$%^&*])\S{4,}/gi, /\bsshpass\s+-p\s*\S+/gi,
  /\bcurl\b[^\n]{0,300}?\s(?:-u\s*|--user[ =])[^\s:]+:\S+/gi, /\b(?:mysql|mysqldump|psql|mariadb)\b[^\n]*?\s-p\S{3,}/gi, /\bdocker\s+login\b[^\n]*?\s(?:-p|--password)[ =]\S+/gi, /\b(?:set-)?cookie\s*:[^\n]*=[^\n]*/gi,
  /\bbearer\s+(?!(?:authentication|authorization|auth|tokens?|scheme|schemes|credentials?|headers?|format|access|style)\b)[A-Za-z0-9._~+\/=-]{8,}/gi, /\bbasic\s+(?:(?=[A-Za-z0-9+\/=]*[\d+\/=])[A-Za-z0-9+\/=]{12,}|[A-Za-z0-9+\/=]{28,})/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /(?<=:\/\/)[^\s\/:@]{0,100}:[^\s@]{1,300}(?=@)/g,                                                    // user:password@host (password may contain "/")
  // NAME=value / "name": "value" for credential-looking names (also inside JSON embedded in a string, and names like OPENAI_API_KEY)
  /(?<![A-Za-z0-9_.-])["']?[A-Za-z0-9_.-]*(?:password|passwd|passphrase|passwort|kennwort|jelsz[óo]|titkos[_ ]?kulcs|secret|token|api[_-]?key|access[_-]?key|auth[_-]?(?:key|token)|private[_-]?key|credentials?|authorization|session[_-]?(?:id|key))["']?\s*(?:=>|:=|[:=])\s*(?!\[redacted)(?:"[^"\n]{4,}"|'[^'\n]{4,}'|(?:(?:bearer|basic|token|apikey|api-key|digest|negotiate|hmac|aws4-hmac-sha256)\s+)?[^\s"',;}]{4,})/gi,
  /\b(?:(?:my|your|new|old|admin|root|wi-?fi|temp(?:orary)?|the|jelsz[óo]m?)\s{1,20})?(?:password|passwd|passphrase|pwd|jelsz[óo]|jelszavam|kennwort|passwort)\s{1,20}(?:(?:is|was|are)\s{0,20})?(?:[:=]\s{0,20})?(?=\S*[0-9_@!#$%^&*])\S{4,}/gi,
  /(?<![A-Za-z0-9])["']?(?:pw|pwd|pass)["']?\s*[:=]\s*(?:"[^"\n]{3,}"|'[^'\n]{3,}'|[^\s"',;}]{3,})/gi,
  /\b(?:seed|recovery|backup)\s+(?:phrase|words)\s*(?:is|are|:|=)\s*(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b|\bmnemonic\s*(?:is|:|=)\s*(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/gi,
];
export const SECRET_PATTERNS = Object.freeze(ALL), FORMAT_PATTERNS = Object.freeze(ALL.slice(0, -4));   // FORMAT = known credential shapes; the last four (NAME=value, prose, seed phrase) patterns are redaction-only because it can match harmless prose
export const SECRET_KEY = /secret|passw|passphrase|api[_-]?key|private|credential|cookie|mnemonic|(?:^|[_-])(?:pwd|pin|auth|key|token)(?:$|[_-])|(?:access|auth|refresh|session|id)[_-]?token|authorization|x-api-key|bearer/i;
const HIDDEN = /[\p{Cf}­]/gu;
const HOMO_FROM = "\u0430\u0435\u043e\u0440\u0441\u0445\u0456\u0443\u0455\u043a\u04bb\u0458\u0406\u0405\u0408\u0410\u0412\u0415\u041a\u041c\u041d\u041e\u0420\u0421\u0422\u0425\u03bf\u03b1\u03ba\u03c1\u03b9\u03bd\u03c5\u0391\u0392\u0395\u0396\u0397\u0399\u039a\u039c\u039d\u039f\u03a1\u03a4\u03a5\u03a7\u0131\u0475\u0585", HOMO_TO = "aeopcxiyskhjISJABEKMHOPCTXoakpivyABEZHIKMNOPTYXivo";
const HOMO = Object.fromEntries([...HOMO_FROM].map((c, i) => [c, HOMO_TO[i]]));
const fold = t => t.replace(new RegExp("[" + HOMO_FROM + "]", "g"), ch => HOMO[ch]);
export const foldLookalikes = fold;   // Cyrillic/Greek/Armenian look-alikes folded to Latin before matching
/** Replace credential-shaped substrings with the marker. */
export function scrub(s, marker = "[redacted]", { assign = true } = {}) {
  const orig = String(s ?? ""); let o = fold(orig.normalize("NFKC").replace(HIDDEN, "")), hit = false;     // hidden characters are removed only when a credential is actually found (otherwise the text is returned untouched)
  for (const p of assign ? SECRET_PATTERNS : FORMAT_PATTERNS) { p.lastIndex = 0; const n = o.replace(p, marker); if (n !== o) { hit = true; o = n; } }
  return hit ? o : orig;
}
/** True when the text contains a known credential shape (used by modules that REFUSE to store such text). */
export function containsSecret(s) {
  const o = fold(String(s ?? "").normalize("NFKC").replace(HIDDEN, ""));
  for (const p of FORMAT_PATTERNS) { p.lastIndex = 0; if (p.test(o)) { p.lastIndex = 0; return true; } p.lastIndex = 0; }
  return false;
}
