// Observability / Black Box (V7.3 Brain §11): hash-chained, correlation-ID based operation record. Secrets are redacted before they are written.
import crypto from "node:crypto";
import { createAuditChain } from "../audit-chain.mjs";

import { scrub, SECRET_KEY as SECRET_KEY_RE } from "../secret-patterns.mjs";
const SECRET_KEY = SECRET_KEY_RE, STRICT_SECRET_KEY = /^$/;
const HIDDEN_K = /[\p{Cf}\u00ad]/gu;
export function redactSecrets(v, extra = s => s, depth = 0, seen = new WeakSet()) {
  const f = s => extra(scrub(s, "[REDACTED]"));
  if (v === null || v === undefined) return v;
  if (typeof v === "string") return f(v);
  if (typeof v !== "object") return v;
  if (depth > 20 || seen.has(v)) return "[TOO_DEEP_OR_CYCLIC]";
  if (Buffer.isBuffer(v) || ArrayBuffer.isView(v)) return "[binary " + v.byteLength + " bytes]";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  seen.add(v);
  try {
    if (typeof v.toJSON === "function") { let j; try { j = v.toJSON(); } catch { return "[UNSERIALISABLE]"; } return j === v ? "[UNSERIALISABLE]" : redactSecrets(j, extra, depth + 1, seen); }   // what JSON.stringify would emit is what gets screened
    if (Array.isArray(v)) return v.map(x => redactSecrets(x, extra, depth + 1, seen));
    return Object.fromEntries(Object.entries(v).map(([k0, x]) => {
      const k = k0.normalize("NFKC").replace(HIDDEN_K, "");                                         // zero-width characters in a key name do not hide it
      const secretKey = (/^(?:pass|pw|pwd|passwd)$/i.test(k) && (typeof x === "string" || typeof x === "number")) || (/secret|password|token|apikey|api_key|private/i.test(k) && typeof x === "string") || ((SECRET_KEY.test(k) || STRICT_SECRET_KEY.test(k)) && x !== null && x !== undefined);
      return [f(k0), secretKey ? "[REDACTED]" : redactSecrets(x, extra, depth + 1, seen)];
    }));
  } finally { seen.delete(v); }
}
export const FIELDS = Object.freeze(["jobId", "taskId", "agentId", "team", "model", "tool", "connector", "workflow", "decision", "reason", "approval", "inputRef", "outputRef", "costUsd", "durationMs", "result", "verification", "error", "retry", "recovery", "evidenceRef", "kind"]);

export function createBlackBox({ filePath = null, now = () => new Date().toISOString(), redact = s => s } = {}) {
  const chain = createAuditChain({ filePath, now });
  const newCorrelationId = () => "corr-" + crypto.randomUUID();
  function record(ev = {}) {
    if (!ev.kind) throw new Error("KIND_REQUIRED");
    if (typeof ev.kind !== "string" || !/^[A-Za-z0-9_.:-]{1,64}$/.test(ev.kind) || scrub(ev.kind) !== ev.kind) throw new Error("KIND_INVALID");        // the kind becomes the event name in the chain: a fixed shape, never free text
    const idOk = x => typeof x === "string" && /^[A-Za-z0-9_.:-]{1,100}$/.test(x) && scrub(x) !== "" && scrub(x) === x;
    const badCorr = ev.correlationId != null && !idOk(ev.correlationId), badParent = ev.parentCorrelationId != null && !idOk(ev.parentCorrelationId);      // an unusable id is replaced (and flagged), never allowed to drop the audit event or smuggle text into the chain
    const clean = {}; for (const f of FIELDS) if (ev[f] !== undefined) clean[f] = redactSecrets(ev[f], redact);
    clean.correlationId = ev.correlationId != null && !badCorr ? ev.correlationId : newCorrelationId(); if (badCorr) clean.correlationIdReplaced = true;
    if (ev.parentCorrelationId && !badParent) clean.parentCorrelationId = ev.parentCorrelationId; if (badParent) clean.parentCorrelationIdReplaced = true;
    const e = chain.append("BB_" + ev.kind, clean);
    return { seq: e.seq, correlationId: clean.correlationId, hash: e.hash };
  }
  const all = () => chain.entries().map(e => ({ seq: e.seq, at: e.at, ...e.data, kind: e.event.slice(3) }));
  function query(f = {}) { return all().filter(e => Object.entries(f).every(([k, v]) => e[k] === v)); }
  const timeline = corr => all().filter(e => e.correlationId === corr || e.parentCorrelationId === corr);
  function stats() {
    const a = all(), by = k => a.reduce((m, e) => (e[k] ? (m[e[k]] = (m[e[k]] || 0) + 1, m) : m), {});
    return { events: a.length, errors: a.filter(e => e.error).length, retries: a.filter(e => e.retry).length, costUsd: a.reduce((s, e) => s + (Number.isFinite(e.costUsd) && e.costUsd >= 0 ? e.costUsd : 0), 0), unknownCostEvents: a.filter(e => e.costUsd !== undefined && !(Number.isFinite(e.costUsd) && e.costUsd >= 0)).length, byKind: by("kind"), byAgent: by("agentId"), byModel: by("model"), byTool: by("tool") };
  }
  return { record, query, timeline, stats, all, newCorrelationId, verify: () => chain.verify(), verifyFile: () => chain.verifyFile(), head: () => chain.head() };
}
