// ATLASZ Money Engine state guard (V7.3 Owner Control §14). Wraps the EXISTING money-pipeline-controller: every transition is first
// checked by the control chain (kill switch / safe mode / security / firewall for external steps) and then needs TYPED evidence that an
// independent verifier ACCEPTs. WON/SENT/DELIVERED/INVOICED/PAID are never taken on a claim; "customer says paid" is recorded as a
// claim and can never create verified revenue or profit. Payment verification unavailable => NOT VERIFIED.
import { transitionMoneyPipeline, recordInvoice, recordVerifiedPayment } from "../money-pipeline-controller.mjs";

const EXTERNAL = new Set(["SENT", "DELIVERED", "INVOICED"]);
export function createMoneyStateGuard({ chain, verifier, firewall = null, blackBox = null } = {}) {
  if (!chain || !verifier) throw new Error("CHAIN_AND_VERIFIER_REQUIRED");
  const rec = (kind, p, decision, reason) => { try { blackBox?.record({ kind, workflow: "MONEY_ENGINE", decision, reason, jobId: p?.id }); } catch { /* chain already fail-closed */ } };
  const refuse = (p, next, reason) => { rec("MONEY_TRANSITION_REFUSED", p, "BLOCK", `${p.state}->${next}:${reason}`); return { ok: false, pipeline: p, reason }; };

  /** Required typed evidence per target state, verified independently. */
  function evidenceCheck(next, e = {}) {
    switch (next) {
      case "SENT": { const r = verifier.verify({ claimType: "SEND_STATE", claim: { ref: e.providerMessageId }, evidence: { providerMessageId: e.providerMessageId, state: e.state } }); return r; }
      case "WON": return e.customerAcceptanceRef && e.source === "CUSTOMER" ? { verdict: "ACCEPT", independent: true, reason: "CUSTOMER_ACCEPTANCE_REFERENCE" } : { verdict: "REJECT", reason: "WON_NEEDS_CUSTOMER_ACCEPTANCE_REFERENCE" };
      case "QA_PASSED": return e.qaReportRef && e.independentVerdict === "ACCEPT" && e.qaBy && e.qaBy !== e.executorId ? { verdict: "ACCEPT", independent: true, reason: "INDEPENDENT_QA" } : { verdict: "REJECT", reason: "QA_NEEDS_INDEPENDENT_ACCEPT" };
      case "DELIVERED": return verifier.verify({ claimType: "FILE_DELIVERY", claim: { path: e.artifactPath, sha256: e.sha256, ref: e.deliveryRef }, evidence: { deliveryRef: e.deliveryRef } });
      case "INVOICED": return verifier.verify({ claimType: "INVOICE", claim: { invoiceId: e.invoiceId, path: e.invoicePath }, evidence: {} });
      case "PAID_VERIFIED": return verifier.verify({ claimType: "PAYMENT", claim: { ref: e.paymentRef, amountUsd: e.amountUsd }, evidence: { paymentRef: e.paymentRef } });
      default: return { verdict: "ACCEPT", independent: true, reason: "NO_EVIDENCE_REQUIRED_FOR_STATE" };
    }
  }
  function advance(pipeline, next, { evidence = {}, ownerApproval = null, actor = { type: "MONEY_ENGINE", id: "MONEY_ENGINE" } } = {}) {
    const external = EXTERNAL.has(next);
    const d = chain.evaluate({ actor, operation: external ? "SEND_EXTERNAL" : "INTERNAL_COMPUTE", external, params: { pipeline: pipeline.id, to: next }, pathId: "money_engine.transition" }, { verifyApproval: false });
    if (d.verdict === "BLOCK") return refuse(pipeline, next, "CHAIN_BLOCK:" + d.reason);
    const v = evidenceCheck(next, evidence);
    if (v.verdict !== "ACCEPT" || v.independent !== true) return refuse(pipeline, next, "NOT_VERIFIED:" + v.verdict + ":" + v.reason);
    try {
      const out = transitionMoneyPipeline(pipeline, next, { evidence: { ...evidence, verification: { verdict: v.verdict, reason: v.reason } }, ownerApproved: ownerApproval });
      rec("MONEY_TRANSITION", pipeline, "ALLOW", `${pipeline.state}->${next}`);
      return { ok: true, pipeline: out, reason: v.reason };
    } catch (e) { return refuse(pipeline, next, String(e.message)); }
  }
  /** Customer message "I paid": recorded, never counted. */
  function recordCustomerPaymentClaim(pipeline, { note = "" } = {}) {
    rec("CUSTOMER_PAYMENT_CLAIM", pipeline, "NOT_VERIFIED", "CUSTOMER_SAYS_PAID_IS_NOT_VERIFIED_PAYMENT");
    return { ok: true, countsAsRevenue: false, state: pipeline.state, claim: { type: "CUSTOMER_SAYS_PAID", note: String(note).slice(0, 200) } };
  }
  /** Verified payment: needs the independent PAYMENT ACCEPT and a verified provider signature; only then revenue is recorded as VERIFIED. */
  function recordPayment(pipeline, { paymentRef, amountUsd, costUsd = 0, signatureVerified = false } = {}) {
    const v = verifier.verify({ claimType: "PAYMENT", claim: { ref: paymentRef, amountUsd }, evidence: { paymentRef } });
    if (v.verdict !== "ACCEPT" || v.independent !== true) return refuse(pipeline, "PAID_VERIFIED", "PAYMENT_NOT_VERIFIED:" + v.verdict + ":" + v.reason);
    if (signatureVerified !== true) return refuse(pipeline, "PAID_VERIFIED", "PROVIDER_SIGNATURE_NOT_VERIFIED");
    try {
      const out = recordVerifiedPayment(pipeline, { amount: amountUsd, cost: costUsd, evidence: { paymentRef, verification: v.reason }, providerConfirmed: true, signatureVerified: true });
      if (firewall) firewall.recordRevenue({ usd: amountUsd, status: "VERIFIED", ref: paymentRef, verification: v });
      rec("MONEY_PAYMENT_VERIFIED", pipeline, "ALLOW", paymentRef);
      return { ok: true, pipeline: out, reason: v.reason };
    } catch (e) { return refuse(pipeline, "PAID_VERIFIED", String(e.message)); }
  }
  return { advance, recordCustomerPaymentClaim, recordPayment, recordInvoice };
}
