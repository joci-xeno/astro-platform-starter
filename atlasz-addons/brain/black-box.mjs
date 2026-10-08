// Observability / Black Box (V7.3 Brain §11): hash-chained, correlation-ID based operation record. Secrets are redacted before they are written.
import crypto from "node:crypto";
import { createAuditChain } from "../audit-chain.mjs";

import { scrub, SECRET_KEY as SECRET_KEY_RE } from "../secret-patterns.mjs";
const SECRET_KEY = SECRET_KEY_RE, STRICT_SECRET_KEY = /^$/;
export function redactSecrets(v, extra = s => s) {
  const f = s => extra(scrub(s, "[REDACTED]"));
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
