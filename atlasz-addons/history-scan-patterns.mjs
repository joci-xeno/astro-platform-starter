// Patterns for the Git-history secret scan (scripts/secret-history-scan.mjs). Distinct from secret-patterns.mjs, which is the runtime REDACTOR.
export const PEM_HEADER = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/;
export const TOKEN_PATTERNS = Object.freeze([
  ["OPENAI_ANTHROPIC_STYLE_KEY", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/], ["AWS_ACCESS_KEY", /\bAKIA[0-9A-Z]{16}\b/], ["GITHUB_PAT", /\bghp_[A-Za-z0-9]{36,}/],
  ["GITHUB_FINE_PAT", /\bgithub_pat_[A-Za-z0-9_]{50,}/], ["SLACK_TOKEN", /\bxox[bp]-[0-9A-Za-z-]{24,}/], ["GOOGLE_API_KEY", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["STRIPE_WEBHOOK_SECRET", /\bwhsec_[A-Za-z0-9]{24,}/], ["STRIPE_LIVE_KEY", /\b[rs]k_live_[A-Za-z0-9]{20,}/]]);
export const SYNTHETIC = /(.)\1{7,}|SYNTHETIC|EXAMPLE|FAKE|DUMMY|0123456789|ABCDEFGH|sk-test-|sk-learn/i;
export const B64_BODY_LINE = /^[A-Za-z0-9+/=]{60,}$/;
