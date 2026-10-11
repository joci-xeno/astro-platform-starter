// Review gate for an externally prepared payment (Stripe/KOHO) package BEFORE anything is merged. Read-only: it never runs the package's code and never contacts a network.
// A package is ACCEPTABLE_FOR_REVIEW only if no finding has severity BLOCKER. Passing this gate is necessary, not sufficient: the owner still approves the merge, and real charges,
// refunds, transfers and payout changes stay behind owner authorization.
import fs from "node:fs";
import path from "node:path";

export const INTAKE_LIMITS = Object.freeze({ maxFiles: 2000, maxFileBytes: 1_000_000, maxDepth: 12 });
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const SECRET_RES = [
  ["STRIPE_LIVE_SECRET", /\b(sk|rk)_live_[A-Za-z0-9]{10,}/], ["STRIPE_TEST_SECRET", /\b(sk|rk)_test_[A-Za-z0-9]{10,}/], ["STRIPE_WEBHOOK_SECRET", /\bwhsec_[A-Za-z0-9]{10,}/],
  ["STRIPE_PUBLISHABLE_LIVE", /\bpk_live_[A-Za-z0-9]{10,}/], ["PRIVATE_KEY_BLOCK", /-----BEGIN [A-Z ]*PRIVATE KEY-----/], ["AWS_KEY", /\bAKIA[0-9A-Z]{16}\b/],
  ["GENERIC_TOKEN_ASSIGNMENT", /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][A-Za-z0-9_\-\/+=]{20,}["']/i]];
const BANK_RES = [["IBAN", /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/], ["CA_TRANSIT_ACCOUNT", /\b\d{5}[- ]\d{3}[- ]\d{7,12}\b/], ["ROUTING_AND_ACCOUNT_PAIR", /\brouting\b[^\n]{0,40}\b\d{9}\b/i]];
/** Obvious evasions are folded before scanning: string concatenation, \x / \u escapes, and base64 runs that decode to text. */
const variants = text => {
  const out = [text, text.replace(/["'`]\s*\+\s*["'`]/g, "")];
  out.push(out[1].replace(/\\x([0-9a-fA-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))));
  for (const m of text.matchAll(/[A-Za-z0-9+\/]{24,}={0,2}/g)) { try { const t = Buffer.from(m[0], "base64").toString("utf8"); if (/^[\x20-\x7e]{12,}$/.test(t)) out.push(t); } catch { /* not base64 */ } }
  return out;
};
const PREFIX_LITERAL = /\b(sk|rk|pk)_(live|test)_|whsec_/;
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const luhn = d => { let s = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; } return s % 10 === 0; };
const MONEY_MOVING = /\b(paymentIntents|charges|refunds|transfers|payouts|subscriptions|invoices|checkout\.sessions|balance(Transactions)?)\.(create|confirm|capture|update|cancel)\b|\bstripe\.(charges|refunds|transfers|payouts)\b/;
const MONEY_BRACKET = /\[\s*["'`](paymentIntents|charges|refunds|transfers|payouts|subscriptions|invoices)["'`]\s*\]|\{[^}]{0,200}\b(paymentIntents|refunds|transfers|payouts)\b[^}]{0,200}\}\s*=\s*\w*stripe/i;
const ENV_FILE = /(^|\/)\.env(\.|$)|credentials\.json$|secrets?\.(json|ya?ml)$|\.pem$|\.p12$/i;

export function reviewPackage(root) {
  const findings = [], hosts = new Set(); let files = 0, hasTests = false, approvalGate = false, moneyMoving = false;
  const add = (severity, code, file, detail = null) => findings.push({ severity, code, file, detail });
  let st; try { st = fs.statSync(root); } catch { return { ok: false, acceptableForReview: false, findings: [{ severity: "BLOCKER", code: "PACKAGE_NOT_FOUND", file: null }] }; }
  if (!st.isDirectory()) return { ok: false, acceptableForReview: false, findings: [{ severity: "BLOCKER", code: "PACKAGE_NOT_A_DIRECTORY", file: null }] };
  const walk = (d, depth) => {
    if (depth > INTAKE_LIMITS.maxDepth) { add("BLOCKER", "TOO_DEEP", d); return; }
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name), rel = path.relative(root, f);
      if (e.isSymbolicLink()) { add("BLOCKER", "SYMLINK_NOT_ALLOWED", rel); continue; }
      if (e.isDirectory()) { if (SKIP_DIRS.has(e.name)) { add("BLOCKER", e.name === ".git" ? "GIT_DIRECTORY_NOT_REVIEWABLE_SUBMIT_A_CLEAN_EXPORT" : "NODE_MODULES_NOT_REVIEWED_SUBMIT_LOCKFILE_ONLY", rel); continue; } if (/^(tests?|__tests__)$/i.test(e.name)) hasTests = true; walk(f, depth + 1); continue; }
      if (!e.isFile()) { add("BLOCKER", "NOT_A_REGULAR_FILE", rel); continue; }
      if (++files > INTAKE_LIMITS.maxFiles) { add("BLOCKER", "TOO_MANY_FILES", rel); return; }
      if (ENV_FILE.test(rel.replace(/\\/g, "/"))) add("BLOCKER", "CREDENTIAL_FILE_PRESENT", rel);
      if (/\.test\.(m?js|ts)$/.test(e.name)) hasTests = true;
      let size = 0; try { size = fs.statSync(f).size; } catch { continue; } if (size > INTAKE_LIMITS.maxFileBytes) { add("BLOCKER", "FILE_TOO_LARGE_NOT_SCANNED", rel); continue; }
      let text; try { text = fs.readFileSync(f); } catch { continue; } if (text.includes(0)) { add("BLOCKER", "BINARY_OR_UTF16_FILE_NOT_SCANNED", rel); continue; } text = text.toString("utf8");
      const vs = variants(text); for (const [code, re] of SECRET_RES) if (vs.some(v => re.test(v))) add("BLOCKER", "EMBEDDED_CREDENTIAL:" + code, rel);
      if (!/\.test\./.test(e.name) && vs.some(v => PREFIX_LITERAL.test(v)) && !findings.some(f => f.file === rel && f.code.startsWith("EMBEDDED_CREDENTIAL"))) add("BLOCKER", "STRIPE_KEY_PREFIX_LITERAL_IN_SOURCE_REVIEW_BY_HAND", rel);
      for (const [code, re] of BANK_RES) if (re.test(text)) add("BLOCKER", "BANK_DATA:" + code, rel);
      for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) { const dg = m[0].replace(/[ -]/g, ""); if (dg.length >= 13 && dg.length <= 19 && luhn(dg) && !/^(\d)\1+$/.test(dg)) { add("BLOCKER", "BANK_DATA:CARD_NUMBER_LUHN", rel); break; } }
      for (const m of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) hosts.add(m[1].toLowerCase());
      if (/\.(m?js|ts)$/.test(e.name) && !/\.test\./.test(e.name)) { const code = stripComments(text), gated = /\b(ownerApproval|verifyApproval|verifyRecorded)\s*[(:,)]|throw[^;\n]*OWNER_APPROVAL/.test(code);
        if (MONEY_MOVING.test(code) || MONEY_BRACKET.test(code)) { moneyMoving = true; if (!gated) add("BLOCKER", "MONEY_MOVING_CALL_WITHOUT_OWNER_APPROVAL_GATE", rel); } if (gated) approvalGate = true; }
    }
  };
  walk(root, 0);
  if (!hasTests) add("BLOCKER", "NO_TESTS_IN_PACKAGE", null);
  if (moneyMoving && !approvalGate) add("BLOCKER", "NO_OWNER_APPROVAL_GATE_ANYWHERE", null);
  const foreign = [...hosts].filter(h => !/(^|\.)stripe\.com$|^(localhost|127\.0\.0\.1|example\.(com|org))$|(^|\.)w3\.org$|(^|\.)github\.com$|(^|\.)npmjs\.(org|com)$/.test(h));
  if (foreign.length) add("WARN", "OTHER_HOSTS_REFERENCED_NEED_EGRESS_REVIEW", null, foreign.slice(0, 20));
  const blockers = findings.filter(f => f.severity === "BLOCKER").length;
  return { ok: true, acceptableForReview: blockers === 0, blockers, warnings: findings.length - blockers, filesScanned: files, hosts: [...hosts].sort().slice(0, 50), findings: findings.slice(0, 200),
    note: "Necessary, not sufficient: the owner still approves the merge; compatibility with the vault, approvals, ledger and Control Center is tested separately; real charges/refunds/transfers/payout changes stay owner-authorised." };
}
