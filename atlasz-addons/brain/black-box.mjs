// Observability / Black Box (V7.3 Brain §11): hash-chained, correlation-ID based operation record. Secrets are redacted before they are written.
import crypto from "node:crypto";
import { createAuditChain } from "../audit-chain.mjs";

const SECRET_PATTERNS = [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}\b/g, /(?<![A-Za-z0-9])ghp_[A-Za-z0-9]{20,}\b/g, /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}\b/g, /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}\b/g,
  /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{30,}\b/g, /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}\b/g, /\b(?:bearer|token|password|passwd|secret|api[_-]?key)\s*[:=]\s*["']?[^\s"',;]{6,}/gi,
  /\bbearer\s+[A-Za-z0-9._~+\/=-]{8,}/gi, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, /(?<=:\/\/)[^\s\/:@]+:[^\s\/@]+(?=@)/g];
const SECRET_KEY = /secret|password|passwd|passphrase|apikey|api_key|private/i, STRICT_SECRET_KEY = /^(?:token|access_?token|auth_?token|refresh_?token|bearer|authorization|credentials?)$/i;
export function redactSecrets(v, extra = s => s) {
  const f = s => { let o = String(s); for (const p of SECRET_PATTERNS) o = o.replace(p, "[REDACTED]"); return extra(o); };
  if (v === null || v === undefined) return v;
  if (typeof v === "string") return f(v);
  if (Array.isArray(v)) return v.map(x => redactSecrets(x, extra));
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, (/secret|password|token|apikey|api_key|private/i.test(k) && typeof x === "string") || ((SECRET_KEY.test(k) || STRICT_SECRET_KEY.test(k)) && x !== null && x !== undefined) ? "[REDACTED]" : redactSecrets(x, extra)]));
  return v;
}
export const FIELDS = Object.freeze(["jobId", "taskId", "agentId", "team", "model", "tool", "connector", "workflow", "decision", "reason", "approval", "inputRef", "outputRef", "costUsd", "durationMs", "result", "verification", "error", "retry", "recovery", "evidenceRef", "kind"]);

export function createBlackBox({ filePath = null, now = () => new Date().toISOString(), redact = s => s } = {}) {
  const chain = createAuditChain({ filePath, now });
  const newCorrelationId = () => "corr-" + crypto.randomUUID();
  function record(ev = {}) {
    if (!ev.kind) throw new Error("KIND_REQUIRED");
    const clean = {}; for (const f of FIELDS) if (ev[f] !== undefined) clean[f] = redactSecrets(ev[f], redact);
    clean.correlationId = ev.correlationId ?? newCorrelationId();
    if (ev.parentCorrelationId) clean.parentCorrelationId = ev.parentCorrelationId;
    const e = chain.append("BB_" + ev.kind, clean);
    return { seq: e.seq, correlationId: clean.correlationId, hash: e.hash };
  }
  const all = () => chain.entries().map(e => ({ seq: e.seq, at: e.at, ...e.data, kind: e.event.slice(3) }));
  function query(f = {}) { return all().filter(e => Object.entries(f).every(([k, v]) => e[k] === v)); }
  const timeline = corr => all().filter(e => e.correlationId === corr || e.parentCorrelationId === corr);
  function stats() {
    const a = all(), by = k => a.reduce((m, e) => (e[k] ? (m[e[k]] = (m[e[k]] || 0) + 1, m) : m), {});
    return { events: a.length, errors: a.filter(e => e.error).length, retries: a.filter(e => e.retry).length, costUsd: a.reduce((s, e) => s + (Number(e.costUsd) || 0), 0), byKind: by("kind"), byAgent: by("agentId"), byModel: by("model"), byTool: by("tool") };
  }
  return { record, query, timeline, stats, all, newCorrelationId, verify: () => chain.verify(), verifyFile: () => chain.verifyFile(), head: () => chain.head() };
}
