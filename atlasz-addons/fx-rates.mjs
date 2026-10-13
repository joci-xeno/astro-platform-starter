// Documented exchange rates for the profit objective. A rate exists only when the OWNER signs it together with its source and timestamp (no network fetch, no invented rate).
// Rates are append-only (hash chain): a correction is a new rate, history stays. The objective uses a rate only if its timestamp is within 72 h of the event it converts.
import path from "node:path";
import { createHash } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";

export const rateSubject = ({ from, rate, asOf, source }) => createHash("sha256").update(JSON.stringify([String(from).toUpperCase(), rate, asOf, source])).digest("hex");

/** createRateBook({dir, verifyApproval, now}) -> {record, list, verify}. list() returns [{from, to:"USD", rate, asOf, source}]. */
export function createRateBook({ dir, verifyApproval, now = () => new Date().toISOString() } = {}) {
  if (!dir) throw new Error("DIR_REQUIRED"); if (typeof verifyApproval !== "function") throw new Error("OWNER_VERIFIER_REQUIRED");
  const chain = createAuditChain({ filePath: path.join(dir, "fx-rates.jsonl"), now });
  const list = () => { chain.reload?.(); return chain.entries().filter(e => e.event === "FX_RATE_RECORDED").map(e => ({ from: e.data.from, to: "USD", rate: e.data.rate, asOf: e.data.asOf, source: e.data.source, subject: e.data.subject })); };
  function record({ approval, from, rate, asOf, source } = {}) {
    const f = String(from ?? "").toUpperCase(); if (!/^[A-Z]{3,5}$/.test(f) || f === "USD") return { ok: false, reason: "CURRENCY_INVALID" };
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1e9) return { ok: false, reason: "RATE_INVALID" };
    const t = Date.parse(asOf); if (!Number.isFinite(t) || t > Date.parse(now()) + 300_000) return { ok: false, reason: "RATE_TIMESTAMP_INVALID_OR_FUTURE" };
    if (typeof source !== "string" || source.trim().length < 3) return { ok: false, reason: "RATE_SOURCE_REQUIRED" };
    const data = { from: f, rate, asOf: new Date(t).toISOString(), source: source.trim().slice(0, 120) }, subject = rateSubject(data);
    let v; try { v = verifyApproval(approval, { action: "FX_RATE_RECORD", subject }); } catch { v = null; } if (v?.allowed !== true) return { ok: false, reason: "OWNER_APPROVAL_REQUIRED" };
    if (list().some(r => r.subject === subject)) return { ok: true, duplicate: true };
    chain.append("FX_RATE_RECORDED", { ...data, subject }); return { ok: true, subject };
  }
  return { record, list, verify: () => { chain.reload?.(); return chain.verify(); } };
}
