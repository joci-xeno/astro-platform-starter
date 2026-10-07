// V7.3 §11/§27: durable Revenue / Cost / Token-API ledger + verified net profit.
// Truth rules: opportunity value is not revenue; invoice is not PAID; PAID needs authoritative external evidence;
// a cost > 0 needs evidence (never fabricated); each external payment reference counts once; entities never commingle.
// Storage: hash-chained fsynced JSONL (tamper-evident). With no entries, figures are reported as UNKNOWN/NOT_CONNECTED, not invented.
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";

export const ENTITIES = Object.freeze(["ATLASZ_EXTERNAL", "JOCI_PERSONAL", "OTHER_ENTITY_1", "OTHER_ENTITY_2"]);
export const REVENUE_STAGES = Object.freeze(["PROPOSED", "AGREED", "INVOICED", "PAID", "REVERSED"]);
const num = (v, code) => { const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(code); return n; };
const evOk = e => Boolean(e && typeof e === "object" && e.source && e.reference && Number.isFinite(Date.parse(e.verifiedAt)));

export function createFinancialLedger({ dir, now = () => new Date().toISOString() } = {}) {
  const chain = createAuditChain({ filePath: dir ? path.join(dir, "ledger.jsonl") : null, now });
  const rows = () => { chain.reload(); return chain.entries().map(e => ({ seq: e.seq, at: e.at, type: e.event, ...e.data })); };
  const entityOf = e => { const x = e || "ATLASZ_EXTERNAL"; if (!ENTITIES.includes(x)) throw new Error("UNKNOWN_ENTITY"); return x; };

  function recordCost({ entity, jobId = null, provider = "UNSPECIFIED", category = "OTHER", amountUsd, evidence = null, tokensIn = 0, tokensOut = 0, note = "" } = {}) {
    const amount = num(amountUsd, "INVALID_COST_AMOUNT");
    if (amount > 0 && !evOk(evidence)) throw new Error("COST_REQUIRES_EVIDENCE");      // an actual cost must be documented, never guessed
    return chain.append("COST", { entity: entityOf(entity), jobId, provider, category, amountUsd: amount, tokensIn: num(tokensIn, "INVALID_TOKENS"), tokensOut: num(tokensOut, "INVALID_TOKENS"), evidence, note });
  }
  function recordRevenue({ entity, jobId, amountUsd, stage, confirmedReceived = false, evidence = null, note = "" } = {}) {
    if (!jobId) throw new Error("JOB_ID_REQUIRED");
    if (!REVENUE_STAGES.includes(stage)) throw new Error("INVALID_REVENUE_STAGE");
    const amount = num(amountUsd, "INVALID_REVENUE_AMOUNT"), ent = entityOf(entity);
    if (stage === "PAID") {
      if (confirmedReceived !== true) throw new Error("PAID_REQUIRES_CONFIRMED_RECEIPT");
      if (!evOk(evidence)) throw new Error("PAID_REQUIRES_EXTERNAL_EVIDENCE");
      if (rows().some(r => r.type === "REVENUE" && r.stage === "PAID" && r.evidence?.source === evidence.source && r.evidence?.reference === evidence.reference)) throw new Error("DUPLICATE_PAYMENT_REFERENCE");
    }
    if (stage === "REVERSED" && !evOk(evidence)) throw new Error("REVERSAL_REQUIRES_EVIDENCE");
    return chain.append("REVENUE", { entity: ent, jobId, amountUsd: amount, stage, confirmedReceived: stage === "PAID", evidence, note });
  }
  function summary({ entity = "ATLASZ_EXTERNAL" } = {}) {
    const all = rows().filter(r => (r.entity || "ATLASZ_EXTERNAL") === entity);
    const costs = all.filter(r => r.type === "COST"), rev = all.filter(r => r.type === "REVENUE");
    const paid = rev.filter(r => r.stage === "PAID").reduce((s, r) => s + r.amountUsd, 0);
    const reversed = rev.filter(r => r.stage === "REVERSED").reduce((s, r) => s + r.amountUsd, 0);
    const latest = new Map(); for (const r of rev.filter(r => ["PROPOSED", "AGREED", "INVOICED"].includes(r.stage))) latest.set(r.jobId, r);
    const unconfirmed = [...latest.values()].filter(r => !rev.some(p => p.jobId === r.jobId && p.stage === "PAID")).reduce((s, r) => s + r.amountUsd, 0);
    const by = (k) => { const m = {}; for (const c of costs) m[c[k] ?? "UNATTRIBUTED"] = (m[c[k] ?? "UNATTRIBUTED"] ?? 0) + c.amountUsd; return m; };
    const totalCost = costs.reduce((s, c) => s + c.amountUsd, 0), verifiedReceived = paid - reversed;
    const jobs = {}; for (const r of all) { const j = r.jobId ?? "UNATTRIBUTED"; jobs[j] ??= { costUsd: 0, verifiedReceivedUsd: 0 };
      if (r.type === "COST") jobs[j].costUsd += r.amountUsd; else if (r.stage === "PAID") jobs[j].verifiedReceivedUsd += r.amountUsd; else if (r.stage === "REVERSED") jobs[j].verifiedReceivedUsd -= r.amountUsd; }
    for (const j of Object.values(jobs)) j.verifiedNetProfitUsd = j.verifiedReceivedUsd - j.costUsd;
    return {
      entity, entries: all.length, chain: chain.verify(),
      revenue: { verifiedReceivedUsd: verifiedReceived, unconfirmedPipelineUsd: unconfirmed, paymentRecords: rev.filter(r => r.stage === "PAID").length,
        source: rev.length ? "LEDGER_ENTRIES" : "NO_REVENUE_EVIDENCE_NOT_CONNECTED" },
      costs: { totalUsd: totalCost, byProvider: by("provider"), byJob: by("jobId"), byCategory: by("category"), tokensIn: costs.reduce((s, c) => s + c.tokensIn, 0), tokensOut: costs.reduce((s, c) => s + c.tokensOut, 0), records: costs.length },
      profit: { verifiedNetUsd: verifiedReceived - totalCost, basis: "VERIFIED_RECEIPTS_MINUS_DOCUMENTED_COSTS", byJob: jobs },
      note: "Opportunity value, invoices and customer claims are not revenue. Figures are 0 when no authoritative evidence has been recorded."
    };
  }
  return { recordCost, recordRevenue, summary, entries: rows, verify: () => { chain.reload(); return chain.verify(); } };
}
