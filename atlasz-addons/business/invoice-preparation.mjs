// Phase E: invoice PREPARATION. Builds an invoice DRAFT through the existing Invoice Engine, from an AGREED price the owner supplies with a reference to the signed agreement.
// A published budget, an estimate, an opportunity value or a customer's claim is never an invoice amount. Issuing (and sending) stay behind the engine's signed owner approval; tax rules are not invented.
export function prepareInvoice({ invoices, job, agreement, customerId, taxes = [], dueDate = null } = {}) {
  if (!invoices?.create) return { ok: false, reason: "INVOICE_ENGINE_NOT_CONNECTED" };
  if (!job || typeof job !== "object" || !job.id) return { ok: false, reason: "JOB_REQUIRED" };
  const allowed = ["DELIVERED", "DELIVERY_VERIFIED", "READY_FOR_DELIVERY", "VERIFIED", "IN_QA", "COMPLETED", "CLOSED"];
  if (!allowed.includes(job.status)) return { ok: false, reason: "JOB_NOT_FAR_ENOUGH_FOR_INVOICE:" + job.status };
  if (!agreement || typeof agreement !== "object") return { ok: false, reason: "AGREEMENT_REQUIRED" };
  if (agreement.source !== "OWNER_SUPPLIED_SIGNED_AGREEMENT" || typeof agreement.reference !== "string" || agreement.reference.trim().length < 3) return { ok: false, reason: "AGREEMENT_REFERENCE_REQUIRED" };
  const amount = Number(agreement.amount); if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return { ok: false, reason: "AGREED_AMOUNT_INVALID" };
  if (!/^[A-Z]{3}$/.test(String(agreement.currency ?? ""))) return { ok: false, reason: "AGREED_CURRENCY_REQUIRED" };
  if (!customerId) return { ok: false, reason: "CUSTOMER_REQUIRED" };
  if (agreement.amountKind && agreement.amountKind !== "AGREED_PRICE") return { ok: false, reason: "ONLY_AN_AGREED_PRICE_CAN_BE_INVOICED:" + agreement.amountKind };
  try {
    const inv = invoices.create({ jobId: job.id, customerId, currency: agreement.currency, items: [{ description: String(agreement.description ?? "Agreed digital services").slice(0, 200) + " (agreement ref " + agreement.reference.slice(0, 60) + ")", quantity: 1, unitPrice: amount }], taxes, dueDate });
    return { ok: true, invoiceId: inv.id, status: inv.status, total: inv.total, currency: inv.currency, issued: false, sent: false, paid: false, taxRulesStatus: inv.taxes.length ? inv.taxes.map(t => t.rulesStatus) : "NO_TAX_LINES_SUPPLIED", next: "Owner signs the invoice approval to issue it; sending is a separate approved external action; payment counts only when verified." };
  } catch (e) { return { ok: false, reason: String(e.message).slice(0, 80) }; }
}
