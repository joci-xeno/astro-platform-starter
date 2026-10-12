// Revenue Operations dashboard: the 14 owner metrics computed ONLY from what the Money Engine, the Revenue Persistence store, the approval queue and the workforce really recorded.
// Rules: projected (forecast / estimate / claimed / contracted) and collected (VERIFIED payment) are separate sections and never added; with no recorded business at all the state is
// NO_BUSINESS_RECORDED and money figures are null (unknown), not zero revenue; nothing is derived from fixtures or defaults; ENVIRONMENT must be LIVE for a figure to be called collected.
const sum = (o, keys) => keys.reduce((s, k) => s + (Number.isFinite(o?.[k]) ? o[k] : 0), 0);
export const STAGE_DEFS = Object.freeze({
  discovered: "all deals ever recorded (any status)",
  validated: "deals that passed screening (SCREENED or later, not LOST/CANCELLED)",
  qualified: "deals QUALIFIED or later (FEASIBLE, outreach stages, SENT, REPLIED, NEGOTIATING, WON)",
  proposalsPrepared: "communications drafted or beyond (DRAFT .. SENT)",
  proposalsSubmittedAuthorized: "communications actually SENT / DELIVERED_IF_VERIFIABLE (after the approval gate)",
  contractsAccepted: "deals WON",
  jobsInProgress: "jobs ASSIGNED .. READY_FOR_DELIVERY",
  jobsCompleted: "jobs DELIVERED .. CLOSED",
  invoicesIssued: "invoices ISSUED or later (not DRAFT/READY/CANCELLED)",
  paymentsReceived: "payments with status VERIFIED (authoritative external evidence)",
  failedWorkflows: "jobs FAILED + communications FAILED + deliveries DELIVERY_FAILED + failed workforce tasks + open dead letters",
  ownerBlockedActions: "pending owner approvals + BLOCKED deals + BLOCKED jobs"
});
export function revenueOps({ money, pending = () => [], workforceTasks = () => [], deadLetters = () => 0, revenuePersistence = null, now = () => new Date().toISOString() } = {}) {
  const p = money.panel(), d = p.deals, j = p.jobs, inv = p.invoices, c = p.communications, pay = p.payments, m = p.money;
  const dealStages = Object.keys(d), idx = s => dealStages.indexOf(s);
  const afterOrAt = (s) => dealStages.filter(k => idx(k) >= idx(s) && !["LOST", "BLOCKED", "CANCELLED"].includes(k));
  const total = o => Object.values(o).reduce((a, b) => a + b, 0);
  let tasks = []; try { tasks = workforceTasks() ?? []; } catch { /* unknown */ }
  let tracked = null; try { tracked = revenuePersistence ? revenuePersistence.ranked().length : null; } catch { /* store unreadable -> unknown */ }
  let pend = 0; try { pend = pending().length; } catch { pend = null; }
  const recorded = total(d) + total(j) + total(inv) + total(pay) + total(c);
  const failedTasks = tasks.filter(t => /FAIL|REJECT|DEAD/i.test(String(t.status ?? t.state ?? ""))).length;
  const dl = Number(deadLetters()) || 0;
  const live = p.environment === "LIVE", verified = live && pay.VERIFIED > 0;
  const metrics = {
    discovered: total(d),
    validated: sum(d, afterOrAt("SCREENED")),
    qualified: sum(d, afterOrAt("QUALIFIED")),
    proposalsPrepared: sum(c, ["DRAFT", "APPROVAL_REQUIRED", "APPROVED", "QUEUED", "SENT", "DELIVERED_IF_VERIFIABLE", "FAILED"]),
    proposalsSubmittedAuthorized: sum(c, ["SENT", "DELIVERED_IF_VERIFIABLE"]),
    contractsAccepted: d.WON ?? 0,
    jobsInProgress: sum(j, ["ASSIGNED", "IN_PROGRESS", "IN_QA", "VERIFIED", "READY_FOR_DELIVERY"]),
    jobsCompleted: sum(j, ["DELIVERED", "INVOICED", "PAYMENT_PENDING", "PAID_VERIFIED", "CLOSED"]),
    invoicesIssued: sum(inv, ["ISSUED", "SENT", "PARTIALLY_PAID", "PAID_CLAIMED", "PAYMENT_VERIFICATION_REQUIRED", "VERIFIED_PAID", "OVERDUE"]),
    paymentsReceived: pay.VERIFIED ?? 0,
    failedWorkflows: (j.FAILED ?? 0) + (c.FAILED ?? 0) + (p.deliveries.DELIVERY_FAILED ?? 0) + failedTasks + dl,
    ownerBlockedActions: pend === null ? null : pend + (d.BLOCKED ?? 0) + (j.BLOCKED ?? 0)
  };
  const known = recorded > 0 || verified;
  return {
    at: now(), environment: p.environment, state: !live ? "NON_LIVE_ENVIRONMENT_NEVER_REVENUE" : known ? "BUSINESS_RECORDED" : "NO_BUSINESS_RECORDED",
    note: !live ? "Environment " + p.environment + ": these counts are a rehearsal and are NEVER revenue; money figures are withheld." : known ? "Counts come from the Money Engine records." : "Nothing has been discovered, sent, won, delivered, invoiced or paid in this installation. Money figures are UNKNOWN (null), not zero revenue.",
    metrics, trackedOpenQualifiedOpportunities: tracked,
    collected: { verifiedPaymentsUsd: verified ? m.verifiedRevenueUsd : null, verifiedCostUsd: verified ? m.verifiedCostUsd : null, verifiedNetProfitUsd: verified ? m.verifiedNetProfitUsd : null,
      operatingCostsRecordedUsd: live && known ? m.verifiedCostUsd + m.actualUnverifiedCostUsd : null, label: "COLLECTED: only VERIFIED payments with authoritative evidence in the LIVE environment count" },
    projected: { forecastUsd: live && known ? m.forecastUsd : null, estimateCostUsd: live && known ? m.estimateCostUsd : null, claimedNotVerifiedUsd: live && known ? m.claimedNotVerifiedUsd : null, contractedRecurringMrrUsd: live && known ? p.recurring.contracted.mrrUsd : null,
      label: "PROJECTED / CLAIMED: not revenue, never added to collected" },
    definitions: STAGE_DEFS, projectedAddedToCollected: false
  };
}
