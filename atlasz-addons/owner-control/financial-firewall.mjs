// ATLASZ Financial Firewall (V7.3 Owner Control §8). NO-SPEND is the default: any spend > 0 is BLOCKED until Joci (signed, action-bound)
// sets a spend policy; even then every spend still needs its own approval. Tracks estimated / actual / provider / job cost and
// claimed vs VERIFIED revenue separately. Estimated numbers are never reported as verified; profit is computed only from verified
// revenue minus actual cost. Unknown/invalid input fails closed.
import fs from "node:fs";
import path from "node:path";
import { actionSubject, approvalActionName } from "./owner-authority.mjs";

export function createFinancialFirewall({ file = null, ownerAuth, budget = null, now = () => new Date().toISOString() } = {}) {
  if (!ownerAuth) throw new Error("OWNER_AUTH_REQUIRED");
  let st = { mode: "NO_SPEND", policy: null, costs: [], revenue: [], blocked: 0 };
  if (file && fs.existsSync(file)) { try { st = JSON.parse(fs.readFileSync(file, "utf8")); } catch { st = { mode: "NO_SPEND", policy: null, costs: [], revenue: [], blocked: 0, integrity: "STATE_UNREADABLE_FAILED_TO_NO_SPEND" }; } }
  const save = () => { if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); const t = file + ".tmp"; fs.writeFileSync(t, JSON.stringify(st), { mode: 0o600 }); fs.renameSync(t, file); };
  const sum = (arr, kind) => arr.filter(c => c.kind === kind).reduce((s, c) => s + c.usd, 0);
  const actualSpent = () => sum(st.costs, "ACTUAL") + sum(st.costs, "PROVIDER");

  /** Dry check. Returns {verdict: ALLOW|REQUIRE_APPROVAL|BLOCK, reason}. */
  function check({ spendUsd = 0, scopeId = null } = {}) {
    const n = Number(spendUsd);
    if (!Number.isFinite(n) || n < 0) return { verdict: "BLOCK", reason: "INVALID_SPEND" };
    if (n === 0) return { verdict: "ALLOW", reason: "NO_SPEND" };
    if (st.mode === "NO_SPEND" || !st.policy) { st.blocked++; save(); return { verdict: "BLOCK", reason: "NO_SPEND_DEFAULT" }; }
    const p = st.policy;
    if (n > p.maxPerActionUsd) return { verdict: "BLOCK", reason: "OVER_PER_ACTION_LIMIT" };
    if (actualSpent() + n > p.maxTotalUsd - p.capitalReserveUsd) return { verdict: "BLOCK", reason: "CAPITAL_PROTECTION_OR_TOTAL_LIMIT" };
    if (scopeId && budget) {
      const b = budget.status(scopeId);
      if (!b) return { verdict: "BLOCK", reason: "BUDGET_NOT_CONFIGURED" };
      if (b.remainingUsd < n) return { verdict: "BLOCK", reason: "BUDGET_CONSUMPTION_EXCEEDED" };
    }
    return { verdict: "REQUIRE_APPROVAL", reason: "SPEND_NEEDS_OWNER_APPROVAL" };
  }
  /** Only Joci can leave NO_SPEND, and only with an approval bound to these exact limits. */
  function setPolicy({ maxPerActionUsd, maxTotalUsd, capitalReserveUsd = 0, ownerApproval = null } = {}) {
    const p = { maxPerActionUsd: Number(maxPerActionUsd), maxTotalUsd: Number(maxTotalUsd), capitalReserveUsd: Number(capitalReserveUsd) };
    if (!Object.values(p).every(v => Number.isFinite(v) && v >= 0)) throw new Error("INVALID_SPEND_POLICY");
    const v = ownerAuth.verifyApproval(ownerApproval, { action: approvalActionName("SET_SPEND_POLICY"), subject: actionSubject("SET_SPEND_POLICY", p) });
    if (!v.allowed) throw new Error("OWNER_APPROVAL_REQUIRED:" + v.reason);
    st.policy = p; st.mode = "POLICY_SET"; save(); return { mode: st.mode, policy: p };
  }
  const costKinds = ["ESTIMATED", "ACTUAL", "PROVIDER", "JOB"];
  function recordCost({ kind, usd, jobId = null, provider = null, ref = null } = {}) {
    const n = Number(usd);
    if (!costKinds.includes(kind) || !Number.isFinite(n) || n < 0) throw new Error("INVALID_COST_RECORD");
    if (["ACTUAL", "PROVIDER"].includes(kind) && !ref) throw new Error("ACTUAL_COST_NEEDS_EVIDENCE_REF");
    st.costs.push({ at: now(), kind, usd: n, jobId, provider, ref }); save();
  }
  /** VERIFIED revenue needs an independent ACCEPT verdict; anything else is recorded as CLAIMED and never enters profit. */
  function recordRevenue({ usd, status = "CLAIMED", ref = null, verification = null } = {}) {
    const n = Number(usd);
    if (!Number.isFinite(n) || n <= 0) throw new Error("INVALID_REVENUE");
    let s = "CLAIMED";
    if (status === "VERIFIED") { if (verification?.verdict === "ACCEPT" && verification.independent === true && ref) s = "VERIFIED"; else throw new Error("VERIFIED_REVENUE_NEEDS_INDEPENDENT_ACCEPT"); }
    st.revenue.push({ at: now(), usd: n, status: s, ref }); save(); return { status: s };
  }
  function summary() {
    const claimed = st.revenue.filter(r => r.status === "CLAIMED").reduce((s, r) => s + r.usd, 0);
    const verified = st.revenue.filter(r => r.status === "VERIFIED").reduce((s, r) => s + r.usd, 0);
    const actual = actualSpent(), job = sum(st.costs, "JOB");
    return { mode: st.mode, policy: st.policy, blockedSpendAttempts: st.blocked, integrity: st.integrity ?? "OK",
      estimatedCostUsd: sum(st.costs, "ESTIMATED"), actualCostUsd: sum(st.costs, "ACTUAL"), providerCostUsd: sum(st.costs, "PROVIDER"), jobCostUsd: job,
      claimedRevenueUsd: claimed, verifiedRevenueUsd: verified, grossProfitUsd: verified - actual - job, netProfitUsd: verified - actual - job, profitBasis: "VERIFIED_REVENUE_MINUS_ACTUAL_COST_ONLY" };
  }
  return { check, setPolicy, recordCost, recordRevenue, summary, status: () => ({ mode: st.mode, integrity: st.integrity ?? "OK", policy: st.policy }) };
}
