// Static code review (85-capability audit P07 Code Review Assistant). Pure, deterministic, rule-based: no model, no execution, no network, nothing is fetched or run.
// Input is a list of files the caller supplies ({path, content}); output is findings with rule id, severity, file, line and a REDACTED snippet, plus test-presence facts.
// Honest limits: regex heuristics (no AST, no data-flow). They find common mistakes; they do not prove code safe. The verdict therefore never says "safe":
//   BLOCK = at least one HIGH finding, INCOMPLETE_REVIEW = no HIGH but some content was only partly scanned (very long lines / findings truncated), REVIEW = any other finding, NO_FINDINGS_BY_THESE_RULES otherwise. File content is untrusted: instruction-like text inside it is reported, never followed.
import { redactSecrets, INJECTION_PATTERNS } from "./text-compare.mjs";

export const LIMITS = Object.freeze({ maxFiles: 200, maxFileChars: 200000, maxTotalChars: 2000000, maxFindings: 500, maxPathChars: 200, maxSnippet: 160, maxLineChars: 2000 });
const SEV = Object.freeze({ HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 });
const SOURCE_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts|vue|svelte|html?|py|sh|bash|rb|go|java|php|cs)$/i, TEST_PATH = /(^|\/)(tests?|__tests__|spec)(\/|$)|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/i;
const JS = /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts|vue|svelte|html?)$/i, PY = /\.py$/i, SH = /\.(sh|bash)$/i;
// rule: [id, severity, languages regex|null, line regex, message]
const RULES = [
  ["SECRET_LITERAL", "HIGH", null, /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}\b|(?<![A-Za-z0-9])ghp_[A-Za-z0-9]{30,}|(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}|\bBearer\s+[A-Za-z0-9._~+\/=-]{20,}|(?<![A-Za-z0-9])sk_(?:live|test)_[0-9A-Za-z]{16,}|(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}|(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}|(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|\b[a-z][a-z0-9+.-]*:\/\/[^\s:\/@"']+:[^\s@\/"']{3,}@|hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/, "A credential-shaped literal is committed in source."],
  ["SECRET_ASSIGNMENT", "HIGH", null, /(?:password|passwd|secret|api[_-]?key|token|private[_-]?key)[A-Za-z0-9_]*["']?\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/i, "A secret-named variable is assigned a literal value."],
  ["SECRET_ASSIGNMENT", "HIGH", null, /^\s*(?:export\s+)?[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|API_?KEY|TOKEN|PRIVATE_?KEY)[A-Z0-9_]*\s*=\s*[^\s"'#$][^\s#]{7,}\s*$/, "A secret-named environment assignment holds a literal value (.env style)."],
  ["DYNAMIC_EVAL", "HIGH", JS, /\beval\s*\(|\bnew Function\s*\(|(?<![\w$.])Function\s*\(|\[\s*["'`](?:eval|Function)["'`]\s*\]|\bimport\s*\(\s*["'`]data:|\b(?:setTimeout|setInterval)\s*\(\s*["'`]|\bvm\.(?:runIn\w+|compileFunction)\s*\(|\bnew\s+vm\.Script\b/, "Dynamic code evaluation: input becoming code."],
  ["SHELL_INJECTION", "HIGH", JS, /\b(?:exec|execSync)\s*\(\s*(?:`[^`]*\$\{|[^)]*(?:["'`]\s*\+|\+\s*["'`]|\+\s*[A-Za-z_$])|[a-zA-Z_$][\w$]*\s*[,)])|\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*["'](?:\/(?:usr\/)?bin\/)?(?:sh|bash|zsh|dash|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh)["']\s*,\s*\[\s*["']\/?-{0,2}[A-Za-z]*[cC][A-Za-z]*["']|\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)\s*\([^;]*\bshell\s*:\s*(?:true|["'])/, "Shell command built from a variable or concatenation (use execFile with an argument array)."],
  ["INDIRECT_EVAL", "MEDIUM", JS, /(?<![\w$.])eval\b(?!\s*[(:])/, "eval is referenced without being called (aliasing, (0, eval), Reflect.apply): treat as dynamic code evaluation."],
  ["GLOBAL_DYNAMIC_ACCESS", "MEDIUM", JS, /\b(?:globalThis|window|self|global)\s*\[/, "A global-object property is read by computed name: this can reach eval/Function/process without naming them; review by hand."],
  ["CHILD_PROCESS_USE", "MEDIUM", JS, /\bchild_process\b/, "child_process is loaded: line rules cannot see every way of calling it (aliases, destructuring, bracket access); review each use by hand."],
  ["VM_MODULE_USE", "MEDIUM", JS, /["'`](?:node:)?vm["'`]/, "The vm module is loaded: it is not a security boundary; review each use by hand."],
  ["SHELL_INJECTION", "HIGH", PY, /\bos\.(?:system|popen)\s*\(|\bsubprocess\.\w+\([^\n]*\bshell\s*=\s*True|(?<![\w.])eval\s*\(|(?<![\w.])exec\s*\(|__import__\s*\(/, "Shell/dynamic execution in Python."],
  ["PIPE_TO_SHELL", "HIGH", /^(?!.*\.(?:sh|bash|md|txt|rst)$)/, /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/, "A download is piped straight into a shell."],
  ["INSTALL_SCRIPT", "MEDIUM", /(^|\/)package\.json$/, /"(?:pre|post)?install"\s*:/, "A package install hook runs code on installation: review it."],
  ["SHELL_INJECTION", "MEDIUM", SH, /\beval\b|\bsh\s+-c\b.*\$|\bcurl\b[^|]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/, "Dynamic evaluation or pipe-to-shell."],
  ["SQL_INJECTION", "HIGH", null, /["'`]\s*(?:SELECT|INSERT|UPDATE|DELETE)\b[^"'`]*["'`]\s*\+|`\s*(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{|\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^"']*["']\s*%\s*\(?|(?:execute|query)\(\s*f["']|["'`]\s*(?:SELECT|INSERT|UPDATE|DELETE)\b[^"'`]*["'`]\s*\.\s*concat\s*\(/i, "SQL text built from variables (use parameterised queries)."],
  ["TLS_VERIFY_DISABLED", "HIGH", null, /rejectUnauthorized\s*:\s*(?:false|0|!1)\b|NODE_TLS_REJECT_UNAUTHORIZED["'\]]*\s*=\s*["']?0|checkServerIdentity\s*:|verify\s*=\s*False|CURLOPT_SSL_VERIFYPEER\s*,\s*(?:false|0)|--insecure\b/, "TLS certificate verification is disabled."],
  ["WEAK_HASH", "MEDIUM", null, /createHash\(\s*["'](?:md5|sha1)["']|hashlib\.(?:md5|sha1)\(|\bmd5\s*\(/i, "MD5/SHA-1 are not collision resistant; do not use for security."],
  ["INSECURE_RANDOM", "MEDIUM", JS, /\bMath\.random\s*\(/, "Math.random is not cryptographically secure (use crypto.randomBytes / randomUUID for ids and tokens)."],
  ["INSECURE_RANDOM", "MEDIUM", PY, /\brandom\.(?:random|randint|choice|randrange)\s*\(/, "Python random is not cryptographically secure (use secrets)."],
  ["XSS_INNERHTML", "MEDIUM", JS, /\.(?:innerHTML|outerHTML)\s*\+?=\s*(?!\s*["'`][^"'`$]*["'`]\s*;?\s*$)|\[\s*["'](?:innerHTML|outerHTML)["']\s*\]\s*\+?=|\bdocument\.write(?:ln)?\s*\(|\binsertAdjacentHTML\s*\(|\bsetHTMLUnsafe\b|dangerouslySetInnerHTML|\bv-html\b/, "HTML assigned from a non-literal: XSS risk."],
  ["PATH_TRAVERSAL", "MEDIUM", JS, /\b(?:readFile|readFileSync|createReadStream|createWriteStream|writeFile|writeFileSync|appendFile|appendFileSync|readdir|readdirSync|sendFile|sendfile|download|unlink|rm|rmSync)\s*\([^)]*\b(?:req|request|params|query|body|input)\b/, "A file path appears to come from request data (validate and confine it)."],
  ["UNSAFE_DESERIALISATION", "HIGH", PY, /\b(?:pickle|cPickle|dill|marshal|shelve)\.(?:loads?|open)\(|\bfrom\s+(?:pickle|cPickle|dill|marshal)\s+import\b|\byaml\.(?:full_load|unsafe_load)\(|\byaml\.load\((?![^)]*Loader\s*=\s*(?:yaml\.)?SafeLoader)/, "Unsafe deserialisation of untrusted data."],
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
  const add = f => { if (typeof f.file === "string") f = { ...f, file: redactSecrets(f.file) }; counts[f.severity]++; if (kept[f.severity] >= KEEP / 4) { truncated = true; return; } kept[f.severity]++; findings.push(f); };
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
  // Statements that continue over several lines are invisible to the per-line rules: a logical-line pass joins a line with the following ones while brackets are open (or the next line starts with ( [ . ) and re-applies the same rules.
  for (const f of files) {
    if (!(JS.test(f.path) || PY.test(f.path)) || f.content.length > LIMITS.maxFileChars) continue;
    const lines = f.content.split("\n"), bal = t => { let d = 0, q = ""; for (const ch of t) { if (q) { if (ch === q) q = ""; continue; } if (ch === '"' || ch === "'" || ch === "`") q = ch; else if (ch === "(" || ch === "[" || ch === "{") d++; else if (ch === ")" || ch === "]" || ch === "}") d--; } return d; };
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > LIMITS.maxLineChars) continue; let buf = lines[i], j = i;
      while (j + 1 < lines.length && j - i < 12 && buf.length < LIMITS.maxLineChars && lines[j + 1].length <= LIMITS.maxLineChars && (bal(buf) > 0 || /^\s*[(\[.]/.test(lines[j + 1]))) { j++; buf += " " + lines[j].trim(); }
      if (j === i) continue;
      for (const [rule, severity, lang, re, message] of RULES) {
        if (lang && !lang.test(f.path)) continue;
        if (re.test(buf) && !findings.some(x => x.file === f.path && x.rule === rule && x.line >= i + 1 && x.line <= j + 1)) add({ rule, severity, file: f.path, line: i + 1, message: message + " (statement spans several lines)", snippet: redactSecrets(buf.trim()).slice(0, LIMITS.maxSnippet) });
      }
    }
  }
  // Statements that continue over several lines are invisible to the per-line rules: a second pass looks at each exec( call together with the text up to its closing statement.
  for (const f of files) {
    if (!JS.test(f.path) || f.content.length > LIMITS.maxFileChars) continue; let n = 0;
    for (const m of f.content.matchAll(/\b(?:exec|execSync)\s*\(/g)) {
      if (++n > 500) { truncated = true; break; }
      const stmt = f.content.slice(m.index, m.index + 600).split(/;\s*\n|;\s*$/)[0]; if (!stmt.includes("\n")) continue;       // single-line calls were already judged line by line
      const one = stmt.replace(/\s+/g, " ");
      if (/^(?:exec|execSync)\s*\(\s*(?:`[^`]*\$\{|[^)]*(?:["'`]\s*\+|\+\s*["'`]|\+\s*[A-Za-z_$])|[a-zA-Z_$][\w$]*\s*[,)])/.test(one)) {
        const line = f.content.slice(0, m.index).split("\n").length;
        if (!findings.some(x => x.file === f.path && x.line === line && x.rule === "SHELL_INJECTION")) add({ rule: "SHELL_INJECTION", severity: "HIGH", file: f.path, line, message: "Shell command built from a variable or concatenation across several lines (use execFile with an argument array).", snippet: redactSecrets(one).slice(0, LIMITS.maxSnippet) });
      }
    }
  }
  const SUPPORTED = /(^|\/)(?:\.env(?:\.[^/]*)?|[^/]*\.(?:js|mjs|cjs|jsx|ts|tsx|py|sh|bash|json|md|txt|rst|yml|yaml|html|htm|css|toml|ini|cfg|conf|xml|env|csv|lock))$/i;   // closed list of what has rules; every other extension is reported as NOT reviewed
  const UNSUPPORTED = { test: p => !SUPPORTED.test(p) }; let unsupported = 0;
  for (const f of files) if (UNSUPPORTED.test(f.path)) { unsupported++; add({ rule: "UNSUPPORTED_LANGUAGE", severity: "INFO", file: f.path, line: 0, message: "No rules exist for this language: the file was NOT reviewed.", snippet: "" }); }
  findings.sort((a, b) => SEV[b.severity] - SEV[a.severity] || (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  if (findings.length > LIMITS.maxFindings) { findings.length = LIMITS.maxFindings; truncated = true; }
  // test presence (a naming / import heuristic, NOT coverage): a source file counts as covered when some supplied test file with real test cases imports it (relative import / python module) or is named after it.
  const tests = files.filter(f => TEST_PATH.test(f.path)), sources = files.filter(f => SOURCE_EXT.test(f.path) && !TEST_PATH.test(f.path));
  const base = p => p.split("/").pop().replace(/\.[^.]+$/, "");
  const codeOf = c => {                                                           // linear comment stripper (// # and /* */); an unterminated block comment swallows the rest, so a test file holding only comments covers nothing
    let r = "", i = 0; const n = c.length;
    while (i < n) { const a = c.indexOf("/*", i); if (a < 0) { r += c.slice(i); break; } r += c.slice(i, a); const z = c.indexOf("*/", a + 2); if (z < 0) break; i = z + 2; }
    return r.split("\n").map(l => { const k = l.search(/(^|\s)(?:\/\/|#)/); return k < 0 ? l : l.slice(0, k); }).join("\n").trim();
  };
  const specs = code => {                                                         // module names imported by a test file, taken from import statements (linear, each line capped)
    const out = new Set(); let n = 0;
    for (const raw of code.split("\n")) { if (++n > 5000) break; const l = raw.slice(0, 2000); let m;
      if ((m = /^\s*(?:import|export|\})[^"'`]*?\bfrom\s*["']([^"']{1,300})["']/.exec(l)) || (m = /^\s*import\s*["']([^"']{1,300})["']/.exec(l))) out.add(m[1]);
      for (const r of l.matchAll(/\b(?:require|import)\s*\(\s*["']([^"']{1,300})["']\s*\)/g)) out.add(r[1]);
      if ((m = /^\s*from\s+([\w.]+)\s+import\b/.exec(l))) out.add("py:" + m[1]); else if ((m = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/.exec(l)) && !/["']/.test(l)) for (const x of m[1].split(",")) out.add("py:" + x.trim());
    }
    return out;
  };
  const info = new Map(tests.map(t => { const code = codeOf(t.content); return [t, { code, specs: specs(code), cases: /\b(?:test|it|describe|suite)\s*\(|\bdef\s+test_|\bfunc\s+Test|\bassert\s*[.(]|\bexpect\s*\(/.test(code) }]; }));
  const lastSeg = sp => sp.replace(/\/+$/, "").split("/").pop().replace(/\.(?:m?[jt]sx?|cjs|py)$/i, "");
  const covers = (t, b) => { const i = info.get(t); return i.code.length > 0 && i.cases && ([...i.specs].some(sp => sp.startsWith("py:") ? sp.slice(3).split(".").pop() === b : /^[./]/.test(sp) && lastSeg(sp) === b) || t.path.split("/").pop().replace(/\.(test|spec)\.[a-z]+$|^test_|_test\.[a-z]+$|\.[a-z]+$/gi, "") === b); };
  const untested = sources.filter(s => !tests.some(t => covers(t, base(s.path)))).map(s => s.path);
  const verdict = counts.HIGH ? "BLOCK" : truncated || longLines || unsupported ? "INCOMPLETE_REVIEW" : counts.MEDIUM || counts.LOW || counts.INFO ? "REVIEW" : "NO_FINDINGS_BY_THESE_RULES";
  return { ok: true, verdict, counts, findings, truncated, tests: { testFiles: tests.map(t => redactSecrets(t.path)), sourceFiles: sources.length, untested: untested.map(u => redactSecrets(u)) }, files: files.length,
    notes: ["Regex heuristics only: no data-flow or AST analysis. 'NO_FINDINGS_BY_THESE_RULES' is not a statement that the code is safe.", "File content was treated as untrusted data; nothing was executed."] };
}
