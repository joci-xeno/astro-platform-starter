// Business analytics from RECORDS only. Actual figures (payments, costs, counts) and estimates (pipeline guesses) live under different keys and are never summed.
// A conversion rate is shown only when the denominator is large enough to mean something; otherwise it is null with the reason. Nothing here is a forecast of earnings.
export const MIN_SAMPLE = 10;
const rate = (num, den) => (Number.isFinite(num) && Number.isFinite(den) ? (den >= MIN_SAMPLE ? { value: Math.round((num / den) * 1000) / 10, unit: "PERCENT", numerator: num, denominator: den } : { value: null, reason: `INSUFFICIENT_SAMPLE_${den}_OF_${MIN_SAMPLE}`, numerator: num, denominator: den }) : { value: null, reason: "COUNTS_UNKNOWN" });
const cnt = v => (Number.isFinite(v) ? v : null);

/** computeAnalytics({metrics, proposalsDrafted, payments, costs, completedJobIds, net, estimates}) */
export function computeAnalytics({ metrics = null, proposalsDrafted = null, payments = [], costs = [], completedJobIds = [], net = null, grossUsd = null, costsComplete = false, estimates = null } = {}) {
  const m = metrics ?? {}, paid = payments.filter(p => p?.state === "PAYMENT_SUCCEEDED").length;
  const counts = { discovered: cnt(m.discovered), verified: cnt(m.validated), qualified: cnt(m.qualified), proposalsDrafted: cnt(proposalsDrafted ?? m.proposalsPrepared), proposalsApproved: cnt(m.proposalsSubmittedAuthorized), contractsAccepted: cnt(m.contractsAccepted), jobsCompleted: cnt(m.jobsCompleted), paymentsVerified: paid };
  const conversion = { verifiedOfDiscovered: rate(counts.verified, counts.discovered), qualifiedOfVerified: rate(counts.qualified, counts.verified), proposalsApprovedOfDrafted: rate(counts.proposalsApproved, counts.proposalsDrafted), contractsOfApprovedProposals: rate(counts.contractsAccepted, counts.proposalsApproved), completedOfContracts: rate(counts.jobsCompleted, counts.contractsAccepted), paidOfCompleted: rate(counts.paymentsVerified, counts.jobsCompleted) };
  const ids = new Set(completedJobIds), jobCost = costs.filter(c => c?.jobId && ids.has(c.jobId)).reduce((s, c) => s + (Number(c.amountUsd) || 0), 0);
  const avgCost = ids.size === 0 ? { value: null, reason: "NO_COMPLETED_JOBS" } : { value: Math.round((jobCost / ids.size) * 100) / 100, unit: "USD", basis: costsComplete ? "RECORDED_JOB_COSTS_OWNER_ATTESTED_COMPLETE" : "RECORDED_JOB_COSTS_ONLY_COMPLETENESS_NOT_ATTESTED", completedJobs: ids.size };
  const margin = net === null || !Number.isFinite(grossUsd) || grossUsd <= 0 ? { value: null, reason: net === null ? "NET_PROFIT_NOT_VERIFIED" : "NO_VERIFIED_RECEIPTS" } : { value: Math.round((net / grossUsd) * 1000) / 10, unit: "PERCENT_OF_GROSS" };
  return { actual: { counts, conversion, averageCostPerCompletedJob: avgCost, actualNetMargin: margin, kind: "ACTUAL_FROM_RECORDS" }, estimates: { value: estimates, kind: "ESTIMATE_NOT_ACTUAL", addedToActuals: false }, minSample: MIN_SAMPLE };
}
