// Static code review (85-capability audit P07 Code Review Assistant). Pure, deterministic, rule-based: no model, no execution, no network, nothing is fetched or run.
// Input is a list of files the caller supplies ({path, content}); output is findings with rule id, severity, file, line and a REDACTED snippet, plus test-presence facts.
// Honest limits: regex heuristics (no AST, no data-flow). They find common mistakes; they do not prove code safe. The verdict therefore never says "safe":
//   BLOCK = at least one HIGH finding, INCOMPLETE_REVIEW = no HIGH but some content was only partly scanned (very long lines / findings truncated), REVIEW = any other finding, NO_FINDINGS_BY_THESE_RULES otherwise. File content is untrusted: instruction-like text inside it is reported, never followed.
import { redactSecrets, INJECTION_PATTERNS } from "./text-compare.mjs";

export const LIMITS = Object.freeze({ maxFiles: 200, maxFileChars: 200000, maxTotalChars: 2000000, maxFindings: 500, maxPathChars: 200, maxSnippet: 160, maxLineChars: 2000 });
const SEV = Object.freeze({ HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 });
const SOURCE_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|py|sh|bash|rb|go|java|php|cs)$/i, TEST_PATH = /(^|\/)(tests?|__tests__|spec)(\/|$)|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/i;
const JS = /\.(mjs|cjs|js|jsx|ts|tsx)$/i, PY = /\.py$/i, SH = /\.(sh|bash)$/i;
// rule: [id, severity, languages regex|null, line regex, message]
const RULES = [
  ["SECRET_LITERAL", "HIGH", null, /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}\b|(?<![A-Za-z0-9])ghp_[A-Za-z0-9]{30,}|(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/, "A credential-shaped literal is committed in source."],
  ["SECRET_ASSIGNMENT", "HIGH", null, /\b(?:password|passwd|secret|api[_-]?key|token|private[_-]?key)\b\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/i, "A secret-named variable is assigned a literal value."],
  ["DYNAMIC_EVAL", "HIGH", JS, /\beval\s*\(|\bnew Function\s*\(|\bsetTimeout\s*\(\s*["'`]/, "Dynamic code evaluation: input becoming code."],
  ["SHELL_INJECTION", "HIGH", JS, /\b(?:exec|execSync)\s*\(\s*(?:`[^`]*\$\{|[^)]*["']\s*\+|[a-zA-Z_$][\w$]*\s*[,)])/, "Shell command built from a variable or concatenation (use execFile with an argument array)."],
  ["SHELL_INJECTION", "HIGH", PY, /\bos\.system\s*\(|\bsubprocess\.[a-z_]+\([^)]*shell\s*=\s*True|\beval\s*\(|\bexec\s*\(/, "Shell/dynamic execution in Python."],
  ["SHELL_INJECTION", "MEDIUM", SH, /\beval\b|\bsh\s+-c\b.*\$|\bcurl\b[^|]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/, "Dynamic evaluation or pipe-to-shell."],
  ["SQL_INJECTION", "HIGH", null, /["'`]\s*(?:SELECT|INSERT|UPDATE|DELETE)\b[^"'`]*["'`]\s*\+|`\s*(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{|\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^"']*["']\s*%\s*\(?|(?:execute|query)\(\s*f["']/i, "SQL text built from variables (use parameterised queries)."],
  ["TLS_VERIFY_DISABLED", "HIGH", null, /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|verify\s*=\s*False|CURLOPT_SSL_VERIFYPEER\s*,\s*(?:false|0)|--insecure\b/, "TLS certificate verification is disabled."],
  ["WEAK_HASH", "MEDIUM", null, /createHash\(\s*["'](?:md5|sha1)["']|hashlib\.(?:md5|sha1)\(|\bmd5\s*\(/i, "MD5/SHA-1 are not collision resistant; do not use for security."],
  ["INSECURE_RANDOM", "MEDIUM", JS, /\bMath\.random\s*\(/, "Math.random is not cryptographically secure (use crypto.randomBytes / randomUUID for ids and tokens)."],
  ["INSECURE_RANDOM", "MEDIUM", PY, /\brandom\.(?:random|randint|choice|randrange)\s*\(/, "Python random is not cryptographically secure (use secrets)."],
  ["XSS_INNERHTML", "MEDIUM", JS, /\.(?:innerHTML|outerHTML)\s*=\s*(?!\s*["'`][^"'`$]*["'`]\s*;?\s*$)|\bdocument\.write\s*\(|dangerouslySetInnerHTML/, "HTML assigned from a non-literal: XSS risk."],
  ["PATH_TRAVERSAL", "MEDIUM", JS, /\b(?:readFile|readFileSync|createReadStream|writeFile|writeFileSync|unlink|rm|rmSync)\s*\([^)]*\b(?:req|request|params|query|body|input)\b/, "A file path appears to come from request data (validate and confine it)."],
  ["UNSAFE_DESERIALISATION", "HIGH", PY, /\bpickle\.loads?\(|\byaml\.load\((?![^)]*Loader\s*=\s*(?:yaml\.)?SafeLoader)/, "Unsafe deserialisation of untrusted data."],
  ["EMPTY_CATCH", "LOW", JS, /catch\s*(?:\([^)]*\))?\s*\{\s*\}/, "Errors are swallowed silently."],
  ["DEBUG_LEFTOVER", "LOW", JS, /\bdebugger\s*;|console\.log\([^)]*(?:password|secret|token|apikey)/i, "Debug statement that may leak data."],
  ["TODO_SECURITY", "LOW", null, /\b(?:TODO|FIXME|HACK|XXX)\b[^\n]*\b(?:security|auth|password|encrypt|validate|sanitize)/i, "Open security-related TODO."],
];
const cleanPath = p => typeof p === "string" && p.length > 0 && p.length <= LIMITS.maxPathChars && !p.startsWith("/") && !/(^|\/)\.\.(\/|$)/.test(p) && !/[\0\\]/.test(p) && !/^[A-Za-z]:/.test(p);

/** @returns {{ok:true, verdict, counts, findings, tests, files, notes}|{ok:false, reason}} */
export function reviewCode(input) {
  const files = input?.files;
  if (!Array.isArray(files) || !files.length) return { ok: false, reason: "FILES_REQUIRED" };
  if (files.length > LIMITS.maxFiles) return { ok: false, reason: "TOO_MANY_FILES" };
  let total = 0; const seen = new Set();
  for (const f of files) {
    if (!f || !cleanPath(f.path)) return { ok: false, reason: "PATH_INVALID" };
    if (typeof f.content !== "string") return { ok: false, reason: "CONTENT_REQUIRED:" + f.path };
    if (f.content.length > LIMITS.maxFileChars) return { ok: false, reason: "FILE_TOO_LARGE:" + f.path };
    if (seen.has(f.path)) return { ok: false, reason: "DUPLICATE_PATH:" + f.path }; seen.add(f.path);
    total += f.content.length;
  }
  if (total > LIMITS.maxTotalChars) return { ok: false, reason: "TOTAL_TOO_LARGE" };
  const findings = [], counts = { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }; let truncated = false, longLines = 0;
  const KEEP = 20000;                                                           // everything is COUNTED (so the verdict is right); only the most severe 500 are returned
  const kept = { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };                        // the cap is per severity: a flood of LOW findings can never push a HIGH one out of the returned list
  const add = f => { counts[f.severity]++; if (kept[f.severity] >= KEEP / 4) { truncated = true; return; } kept[f.severity]++; findings.push(f); };
  for (const f of files) {
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.length > LIMITS.maxLineChars) {                                   // minified/generated line: only the secret rules run, window by window
        longLines++; add({ rule: "LINE_TOO_LONG", severity: "INFO", file: f.path, line: i + 1, message: "Line over " + LIMITS.maxLineChars + " chars: only secret rules were applied (minified or generated?)", snippet: "" });
        const seenRule = new Set();
        for (let at = 0; at < raw.length; at += LIMITS.maxLineChars - 200) {
          const win = raw.slice(at, at + LIMITS.maxLineChars);
          for (const [rule, severity, lang, re, message] of RULES) { if (!rule.startsWith("SECRET") || seenRule.has(rule) || (lang && !lang.test(f.path))) continue; if (re.test(win)) { seenRule.add(rule); add({ rule, severity, file: f.path, line: i + 1, message, snippet: redactSecrets(win.trim()).slice(0, LIMITS.maxSnippet) }); } }
        }
        continue;
      }
      for (const [rule, severity, lang, re, message] of RULES) {
        if (lang && !lang.test(f.path)) continue;                         // rules with the same id have mutually exclusive language filters, so one line yields at most one finding per rule
        if (re.test(raw)) { add({ rule, severity, file: f.path, line: i + 1, message, snippet: redactSecrets(raw.trim()).slice(0, LIMITS.maxSnippet) }); }
      }
      if (INJECTION_PATTERNS.some(p => p.test(raw))) add({ rule: "INSTRUCTION_IN_CONTENT", severity: "INFO", file: f.path, line: i + 1, message: "The file contains text that tries to instruct a reader/model. Reported only; never followed.", snippet: redactSecrets(raw.trim()).slice(0, LIMITS.maxSnippet) });
    }
  }
  findings.sort((a, b) => SEV[b.severity] - SEV[a.severity] || (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  if (findings.length > LIMITS.maxFindings) { findings.length = LIMITS.maxFindings; truncated = true; }
  // test presence: a source file counts as covered when some supplied test file mentions its base name
  const tests = files.filter(f => TEST_PATH.test(f.path)), sources = files.filter(f => SOURCE_EXT.test(f.path) && !TEST_PATH.test(f.path));
  const base = p => p.split("/").pop().replace(/\.[^.]+$/, "");
  const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importText = new Map(tests.map(t => [t, t.content.split("\n").filter(l => /from|require|import/.test(l)).slice(0, 5000).map(l => l.slice(0, 2000)).join("\n")]));   // only import-looking lines, each capped: the matching below is linear in what it is given
  const covers = (t, b) => t.content.trim().length > 0 && (new RegExp("(?:from|require|import)[^\\n]*(?<![A-Za-z0-9_])" + esc(b) + "(?![A-Za-z0-9_])").test(importText.get(t)) || t.path.split("/").pop().replace(/\.(test|spec)\.[a-z]+$|^test_|_test\.[a-z]+$|\.[a-z]+$/gi, "") === b);
  const untested = sources.filter(s => !tests.some(t => covers(t, base(s.path)))).map(s => s.path);
  const verdict = counts.HIGH ? "BLOCK" : truncated || longLines ? "INCOMPLETE_REVIEW" : counts.MEDIUM || counts.LOW || counts.INFO ? "REVIEW" : "NO_FINDINGS_BY_THESE_RULES";
  return { ok: true, verdict, counts, findings, truncated, tests: { testFiles: tests.map(t => t.path), sourceFiles: sources.length, untested }, files: files.length,
    notes: ["Regex heuristics only: no data-flow or AST analysis. 'NO_FINDINGS_BY_THESE_RULES' is not a statement that the code is safe.", "File content was treated as untrusted data; nothing was executed."] };
}
