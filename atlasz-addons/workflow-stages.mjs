// Business workflow stage criteria (directive section 8): DISCOVER > VERIFY > QUALIFY > ESTIMATE > PLAN > OWNER APPROVAL > EXECUTE > QUALITY ASSURANCE > DELIVERY APPROVAL > DELIVER > INVOICE
// > PAYMENT VERIFICATION > RECONCILIATION > NET PROFIT. Each stage has explicit entry criteria expressed as REQUIRED EVIDENCE. Evidence that asserts something about the outside world
// (an owner approval, a delivery, a payment) is only accepted when an injected authority verifies it; with no authority the stage is refused (fail closed). Nothing is "won" or "paid" by a field value.
export const STAGES = Object.freeze({
  DISCOVER: { entry: [], exit: ["source record with provenance"] },
  VERIFY: { entry: [{ kind: "handoff", fields: ["taskId"], authority: false }], exit: ["Master intake checks passed"] },
  QUALIFY: { entry: [{ kind: "qualification", fields: ["legitimacy", "feasibility", "skillFit", "risk"], authority: false }], exit: ["qualification dimensions assessed"] },
  ESTIMATE: { entry: [{ kind: "qualification", fields: ["verdict"], authority: false, equals: { verdict: "QUALIFIED" } }], exit: ["costs and effort estimated"] },
  PLAN: { entry: [{ kind: "estimate", fields: ["costs", "effort"], authority: false }], exit: ["execution plan with owner gates"] },
  OWNER_APPROVAL: { entry: [{ kind: "plan", fields: ["planId"], authority: false }], exit: ["signed owner approval for the exact planned action"] },
  EXECUTE: { entry: [{ kind: "ownerApproval", fields: ["approvalId"], authority: "OWNER_APPROVAL" }], exit: ["artifacts produced"] },
  QUALITY_ASSURANCE: { entry: [{ kind: "execution", fields: ["taskIds", "artifactSha256"], authority: false }], exit: ["independent checker accepted"] },
  DELIVERY_APPROVAL: { entry: [{ kind: "qa", fields: ["taskId", "decision", "checker"], authority: "QA_ACCEPT" }], exit: ["owner approved delivery"] },
  DELIVER: { entry: [{ kind: "deliveryApproval", fields: ["approvalId"], authority: "OWNER_APPROVAL" }], exit: ["delivery recorded with evidence"] },
  INVOICE: { entry: [{ kind: "delivery", fields: ["deliveryId"], authority: "DELIVERY_RECORD" }], exit: ["invoice issued"] },
  PAYMENT_VERIFICATION: { entry: [{ kind: "invoice", fields: ["invoiceId"], authority: "INVOICE_RECORD" }], exit: ["payment verified by processor evidence"] },
  RECONCILIATION: { entry: [{ kind: "payment", fields: ["eventId", "invoiceId", "amount", "currency"], authority: "PAYMENT_VERIFIED" }], exit: ["fees and refunds reconciled"] },
  NET_PROFIT: { entry: [{ kind: "reconciliation", fields: ["reconciled", "costsRecorded"], authority: false, equals: { reconciled: true, costsRecorded: true } }], exit: ["verified net profit computed"] }
});
const filled = v => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length);

/** evaluateStageEntry(stage, evidence, {verify}) -> {ok, missing[]}. `verify(authorityName, evidenceObject)` must return true only for a real, matching, unused record. */
export function evaluateStageEntry(stage, evidence = {}, { verify = null } = {}) {
  const def = STAGES[stage]; if (!def) return { ok: false, missing: ["UNKNOWN_STAGE"] };
  const missing = [];
  for (const c of def.entry) {
    const e = evidence?.[c.kind];
    if (!e || typeof e !== "object") { missing.push(c.kind); continue; }
    for (const f of c.fields) if (!filled(e[f])) missing.push(c.kind + "." + f);
    for (const [k, v] of Object.entries(c.equals ?? {})) if (e[k] !== v) missing.push(c.kind + "." + k + "!=" + v);
    if (c.authority) {
      let ok = false; try { ok = typeof verify === "function" && verify(c.authority, e) === true; } catch { ok = false; }
      if (!ok) missing.push(c.kind + ":UNVERIFIED_BY_" + c.authority);
    }
  }
  return { ok: missing.length === 0, missing };
}
export const stageList = () => Object.keys(STAGES);
