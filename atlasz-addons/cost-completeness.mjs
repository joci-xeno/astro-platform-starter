// Cost completeness for the verified-net-profit figure. A cost that nobody recorded is UNKNOWN, not zero: the daily net is only a number when, for every cost category and
// every day it covers, the OWNER has attested (signed, hash-chained, revocable) that all costs of that category in that period are entered in the cost ledger.
// This module never records or creates a cost and never moves money; it only says which category/day combinations the owner has vouched for.
import path from "node:path";
import { createHash } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";

export const COST_CATEGORIES = Object.freeze(["AI_USAGE", "HOSTING_INFRA", "CURRENCY_CONVERSION", "OTHER_ATTRIBUTABLE"]);
export const ATTESTATION_STATEMENT = "All costs of the listed categories incurred in the period are recorded in the cost ledger; a category with no recorded cost had none.";
const MAP = [[/^(MODEL|API|AI|LLM|TOKEN|INFERENCE|PROVIDER)/, "AI_USAGE"], [/^(HOST|INFRA|SERVER|CLOUD|DOMAIN|STORAGE|BANDWIDTH|VPS|COMPUTE)/, "HOSTING_INFRA"], [/^(FX|CONVERSION|CURRENCY|EXCHANGE)/, "CURRENCY_CONVERSION"]];
/** Map any free-text ledger category to a canonical one. Unrecognised text is OTHER_ATTRIBUTABLE, never dropped. */
export const canonicalCostCategory = raw => { const s = String(raw ?? "").trim().toUpperCase().replace(/[^A-Z]+/g, "_"); if (COST_CATEGORIES.includes(s)) return s; for (const [re, c] of MAP) if (re.test(s)) return c; return "OTHER_ATTRIBUTABLE"; };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const subjectOf = ({ categories, fromDay, toDay }) => createHash("sha256").update(JSON.stringify([[...categories].sort(), fromDay, toDay ?? null])).digest("hex");
export const attestationSubject = subjectOf;

/** createCostCompleteness({dir, verifyApproval, now, dayOf}) -> {attest, revoke, covers, missing, list, verify}. verifyApproval(approval,{action,subject}) -> {allowed}. */
export function createCostCompleteness({ dir, verifyApproval, now = () => new Date().toISOString(), dayOf } = {}) {
  if (!dir) throw new Error("DIR_REQUIRED"); if (typeof verifyApproval !== "function") throw new Error("OWNER_VERIFIER_REQUIRED"); if (typeof dayOf !== "function") throw new Error("DAY_FUNCTION_REQUIRED");
  const chain = createAuditChain({ filePath: path.join(dir, "cost-attestations.jsonl"), now });
  const state = () => { chain.reload?.(); const att = new Map(); for (const e of chain.entries()) { const d = e.data ?? {}; if (e.event === "COST_ATTESTED") att.set(d.id, { ...d, revokedFromDay: null }); else if (e.event === "COST_ATTESTATION_REVOKED" && att.has(d.id)) att.get(d.id).revokedFromDay = d.revokedFromDay; } return [...att.values()]; };
  const ok = (action, approval, subject) => { try { return verifyApproval(approval, { action, subject })?.allowed === true; } catch { return false; } };
  function attest({ approval, categories, fromDay, toDay = null } = {}) {
    if (!Array.isArray(categories) || !categories.length || !categories.every(c => COST_CATEGORIES.includes(c))) return { ok: false, reason: "CATEGORIES_INVALID" };
    if (!DAY.test(fromDay ?? "") || (toDay !== null && (!DAY.test(toDay) || toDay < fromDay))) return { ok: false, reason: "PERIOD_INVALID" };
    const cats = [...new Set(categories)].sort(), subject = subjectOf({ categories: cats, fromDay, toDay });
    if (!ok("COST_ATTESTATION", approval, subject)) return { ok: false, reason: "OWNER_APPROVAL_REQUIRED" };
    if (state().some(a => a.subject === subject && a.revokedFromDay === null)) return { ok: true, duplicate: true, subject };
    const e = chain.append("COST_ATTESTED", { id: "ca-" + subject.slice(0, 12), subject, categories: cats, fromDay, toDay, statement: ATTESTATION_STATEMENT }); return { ok: true, id: "ca-" + subject.slice(0, 12), subject, seq: e?.seq ?? null };
  }
  /** Revocation applies from the day it is made: earlier days stay vouched for, later days become unknown again. */
  function revoke({ approval, id } = {}) {
    const a = state().find(x => x.id === id); if (!a) return { ok: false, reason: "UNKNOWN_ATTESTATION" };
    if (a.revokedFromDay) return { ok: true, duplicate: true };
    if (!ok("COST_ATTESTATION_REVOKE", approval, id)) return { ok: false, reason: "OWNER_APPROVAL_REQUIRED" };
    const from = dayOf(now()); chain.append("COST_ATTESTATION_REVOKED", { id, revokedFromDay: from }); return { ok: true, revokedFromDay: from };
  }
  const covers = (category, day) => state().some(a => a.categories.includes(category) && day >= a.fromDay && (a.toDay === null || day <= a.toDay) && (a.revokedFromDay === null || day < a.revokedFromDay));
  const missing = (day, categories = COST_CATEGORIES) => categories.filter(c => !covers(c, day));
  return { attest, revoke, covers, missing, list: state, verify: () => { chain.reload?.(); return chain.verify(); } };
}
