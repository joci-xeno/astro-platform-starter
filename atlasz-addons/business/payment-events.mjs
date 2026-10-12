// Verified payment-event ledger (Stripe-compatible webhook scheme). It RECEIVES and RECORDS processor events; it can never move money: there is no function here that creates a charge, refund,
// transfer or payout and the module has no network or process access (asserted by tests). Initiating any of those stays behind the owner's signed approval elsewhere (and Stripe itself is deferred
// until the approved integration package exists: no webhook secret exists today, so every ingest is refused with SECRET_NOT_CONFIGURED - live use is BLOCKED, the mechanism is TESTED).
//   signature   t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>[,v1=...]; constant-time compare; timestamp tolerance; raw bytes only (a re-serialised body does not verify).
//   duplicates  every verified event id is stored (persistent, hash-chained audit); the same id again = DUPLICATE (not processed twice); the same id with DIFFERENT bytes = CONFLICT (security event).
//   ordering    state only moves forward by event time; a late "pending" never reverts a "succeeded".
//   separation  PAYMENT_INITIATED / PAYMENT_PENDING / PAYMENT_SUCCEEDED (processor-confirmed) / PAYMENT_FAILED / refunds / disputes / PAYOUT_INITIATED / PAYOUT_PAID_BY_PROCESSOR / PAYOUT_FAILED /
//               BANK_RECONCILED. A paid-out payout is NOT a bank receipt: BANK_RECONCILED needs owner-authorised bank evidence whose amount and currency match exactly.
//   money       integer minor units; an unknown fee stays null (net is then UNKNOWN, never computed with 0); test-mode events never count in a LIVE ledger.
import fs from "node:fs"; import path from "node:path";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { createAuditChain } from "../audit-chain.mjs";

export const SIG_TOLERANCE_SEC = 300;
const hex = /^[0-9a-f]{64}$/;
const sha = b => createHash("sha256").update(b).digest("hex");
export function verifyWebhookSignature({ rawBody, header, secret, toleranceSec = SIG_TOLERANCE_SEC, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  if (!secret || typeof secret !== "string") return { ok: false, reason: "SECRET_NOT_CONFIGURED" };
  if (!Buffer.isBuffer(rawBody) && typeof rawBody !== "string") return { ok: false, reason: "RAW_BODY_REQUIRED" };
  if (typeof header !== "string" || header.length > 600) return { ok: false, reason: "SIGNATURE_HEADER_MISSING" };
  const parts = header.split(",").map(x => x.trim().split("=")); const t = parts.find(p => p[0] === "t")?.[1], sigs = parts.filter(p => p[0] === "v1").map(p => p[1]).filter(v => hex.test(v ?? ""));
  if (!/^\d{1,12}$/.test(t ?? "") || !sigs.length) return { ok: false, reason: "SIGNATURE_HEADER_MALFORMED" };
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return { ok: false, reason: "TIMESTAMP_OUT_OF_TOLERANCE" };
  const expect = createHmac("sha256", secret).update(t + "." ).update(rawBody).digest();
  const good = sigs.some(s => { const b = Buffer.from(s, "hex"); return b.length === expect.length && timingSafeEqual(b, expect); });
  return good ? { ok: true, timestamp: Number(t) } : { ok: false, reason: "SIGNATURE_MISMATCH" };
}

const KIND = { "payment_intent.created": "PAYMENT_INITIATED", "payment_intent.processing": "PAYMENT_PENDING", "payment_intent.requires_action": "PAYMENT_PENDING", "payment_intent.succeeded": "PAYMENT_SUCCEEDED", "charge.succeeded": "PAYMENT_SUCCEEDED",
  "payment_intent.payment_failed": "PAYMENT_FAILED", "charge.failed": "PAYMENT_FAILED", "payment_intent.canceled": "PAYMENT_FAILED", "charge.refunded": "REFUND", "refund.created": "REFUND", "refund.updated": "REFUND",
  "charge.dispute.created": "DISPUTE_OPENED", "charge.dispute.closed": "DISPUTE_CLOSED", "payout.created": "PAYOUT_INITIATED", "payout.paid": "PAYOUT_PAID_BY_PROCESSOR", "payout.failed": "PAYOUT_FAILED", "payout.canceled": "PAYOUT_FAILED" };
const RANK = { PAYMENT_INITIATED: 1, PAYMENT_PENDING: 2, PAYMENT_FAILED: 3, PAYMENT_SUCCEEDED: 3 };      // failed/succeeded are terminal peers: a later conflicting terminal event is flagged, not applied
const intOrNull = v => (Number.isInteger(v) && v >= 0 ? v : null);

export function createPaymentEventLedger({ dir, environment = "LIVE", secretFor = () => null, now = () => new Date().toISOString(), onSecurityEvent = () => {} } = {}) {
  if (!dir) throw new Error("DIR_REQUIRED"); if (!["LIVE", "SANDBOX"].includes(environment)) throw new Error("ENVIRONMENT_INVALID");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const audit = createAuditChain({ filePath: path.join(dir, "payment-events-audit.jsonl"), headPinFile: path.join(dir, "payment-events-audit.headpin.json"), now });
  const FILE = path.join(dir, "payment-events.json"); let S = { events: {}, payments: {}, payouts: {}, other: {} };
  if (fs.existsSync(FILE)) { try { S = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { throw new Error("PAYMENT_EVENT_STORE_UNREADABLE"); } }
  const save = () => { const t = FILE + ".tmp"; fs.writeFileSync(t, JSON.stringify(S), { mode: 0o600 }); fs.renameSync(t, FILE); };
  const sec = (type, detail) => { try { onSecurityEvent({ at: now(), type, detail }); } catch { /* sink must not break ingestion */ } audit.append("SECURITY_" + type, detail); };

  function ingest({ provider = "stripe", rawBody, signatureHeader, nowSec } = {}) {
    if (provider !== "stripe") return { ok: false, status: "UNSUPPORTED_PROVIDER" };
    let secret = null; try { secret = secretFor(provider, environment); } catch { secret = null; }
    const v = verifyWebhookSignature({ rawBody, header: signatureHeader, secret, ...(nowSec !== undefined ? { nowSec } : {}) });
    if (!v.ok) { if (v.reason !== "SECRET_NOT_CONFIGURED") sec("WEBHOOK_REJECTED", { reason: v.reason }); return { ok: false, status: v.reason === "SECRET_NOT_CONFIGURED" ? "SECRET_NOT_CONFIGURED" : "REJECTED_SIGNATURE", reason: v.reason, processed: false }; }
    const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody), bodySha = sha(raw); let ev;
    try { ev = JSON.parse(raw.toString("utf8")); } catch { return { ok: false, status: "REJECTED_MALFORMED", processed: false }; }
    if (!ev || typeof ev.id !== "string" || !/^evt_[A-Za-z0-9_]{1,100}$/.test(ev.id) || typeof ev.type !== "string" || !ev.data?.object) return { ok: false, status: "REJECTED_MALFORMED", processed: false };
    const seen = S.events[ev.id];
    if (seen) { if (seen.bodySha !== bodySha) { sec("EVENT_ID_REPLAYED_WITH_DIFFERENT_BODY", { id: ev.id }); return { ok: false, status: "CONFLICT", processed: false }; } return { ok: true, status: "DUPLICATE", processed: false, id: ev.id }; }
    if ((ev.livemode === true) !== (environment === "LIVE")) { S.events[ev.id] = { bodySha, at: now(), ignored: "ENVIRONMENT_MISMATCH" }; save(); audit.append("EVENT_IGNORED_ENVIRONMENT", { id: ev.id, livemode: ev.livemode === true }); return { ok: true, status: "IGNORED_ENVIRONMENT_MISMATCH", processed: false, id: ev.id }; }
    const kind = KIND[ev.type]; const o = ev.data.object, at = Number.isFinite(ev.created) ? ev.created : Math.floor(Date.parse(now()) / 1000);
    S.events[ev.id] = { bodySha, at: now(), type: ev.type, kind: kind ?? "UNINTERPRETED" };
    if (!kind) { audit.append("EVENT_RECORDED_UNINTERPRETED", { id: ev.id, type: ev.type }); save(); return { ok: true, status: "RECORDED_UNINTERPRETED", processed: true, id: ev.id }; }
    const out = kind.startsWith("PAYOUT_") ? applyPayout(kind, o, at, ev.id) : applyPayment(kind, o, at, ev.id);
    audit.append("EVENT_PROCESSED", { id: ev.id, type: ev.type, kind, key: out.key, applied: out.applied }); save(); return { ok: true, status: "PROCESSED", processed: true, id: ev.id, kind, ...out };
  }
  function applyPayment(kind, o, at, evId) {
    const pi = typeof o.payment_intent === "string" ? o.payment_intent : (o.object === "payment_intent" ? o.id : (o.id ?? "unknown")), key = String(pi).slice(0, 100);
    const p = (S.payments[key] ??= { key, state: null, at: 0, amountMinor: null, currency: null, feeMinor: null, invoiceId: null, refundedMinor: 0, refundIds: [], dispute: null, events: [] });
    p.events.push({ id: evId, kind, at }); if (p.events.length > 50) p.events.shift();
    const amt = intOrNull(o.amount_received ?? o.amount ?? o.amount_captured), cur = typeof o.currency === "string" ? o.currency.toLowerCase().slice(0, 3) : null;
    if (amt !== null && p.amountMinor === null) p.amountMinor = amt; if (cur && !p.currency) p.currency = cur;
    const inv = o.metadata?.invoice_id; if (typeof inv === "string" && inv && !p.invoiceId) p.invoiceId = inv.slice(0, 80);
    if (Number.isInteger(o.application_fee_amount) && p.feeMinor === null) p.feeMinor = o.application_fee_amount;
    if (kind === "REFUND") { const rid = String(o.id ?? evId), ra = intOrNull(o.object === "refund" ? o.amount : o.amount_refunded); if (ra !== null && !p.refundIds.includes(rid)) { p.refundIds.push(rid); p.refundedMinor = o.object === "refund" ? p.refundedMinor + ra : Math.max(p.refundedMinor, ra); } return { key, applied: true, state: p.state }; }
    if (kind === "DISPUTE_OPENED" || kind === "DISPUTE_CLOSED") { p.dispute = { status: kind === "DISPUTE_OPENED" ? "OPEN" : String(o.status ?? "CLOSED").toUpperCase().slice(0, 30), at }; return { key, applied: true, state: p.state }; }
    if (p.state && RANK[p.state] === 3 && RANK[kind] === 3 && p.state !== kind) { sec("CONFLICTING_TERMINAL_PAYMENT_EVENTS", { key, have: p.state, got: kind }); return { key, applied: false, state: p.state }; }
    if (p.state && (RANK[kind] < RANK[p.state] || (RANK[kind] === RANK[p.state] && at < p.at))) return { key, applied: false, state: p.state, note: "OUT_OF_ORDER_IGNORED" };
    p.state = kind; p.at = at; return { key, applied: true, state: p.state };
  }
  function applyPayout(kind, o, at, evId) {
    const key = String(o.id ?? evId).slice(0, 100), po = (S.payouts[key] ??= { key, state: null, amountMinor: null, currency: null, at: 0, bankEvidence: null });
    const a = intOrNull(o.amount); if (a !== null && po.amountMinor === null) po.amountMinor = a; if (typeof o.currency === "string" && !po.currency) po.currency = o.currency.toLowerCase().slice(0, 3);
    if (po.state === "BANK_RECONCILED") return { key, applied: false, state: po.state };
    if (po.state === "PAYOUT_PAID_BY_PROCESSOR" && kind === "PAYOUT_INITIATED") return { key, applied: false, state: po.state, note: "OUT_OF_ORDER_IGNORED" };
    po.state = kind; po.at = at; return { key, applied: true, state: po.state };
  }
  /** Bank reconciliation: only with owner-authorised bank evidence (statement line / bank connector) whose amount AND currency equal the payout. The processor's "paid" is not enough. */
  function reconcileBank(payoutKey, { evidence = null, ownerApproved = false } = {}) {
    const po = S.payouts[payoutKey]; if (!po) return { ok: false, reason: "UNKNOWN_PAYOUT" };
    if (po.state !== "PAYOUT_PAID_BY_PROCESSOR") return { ok: false, reason: "PAYOUT_NOT_PAID_BY_PROCESSOR" };
    if (ownerApproved !== true) return { ok: false, reason: "OWNER_AUTHORISED_BANK_DATA_REQUIRED" };
    if (!evidence || typeof evidence.reference !== "string" || !evidence.reference || !Number.isInteger(evidence.amountMinor) || typeof evidence.currency !== "string" || !evidence.receivedAt || typeof evidence.source !== "string") return { ok: false, reason: "BANK_EVIDENCE_INCOMPLETE" };
    if (evidence.amountMinor !== po.amountMinor || evidence.currency.toLowerCase() !== po.currency) return { ok: false, reason: "BANK_EVIDENCE_AMOUNT_OR_CURRENCY_MISMATCH" };
    po.state = "BANK_RECONCILED"; po.bankEvidence = { reference: evidence.reference.slice(0, 100), source: evidence.source.slice(0, 60), receivedAt: evidence.receivedAt }; audit.append("PAYOUT_BANK_RECONCILED", { key: payoutKey, reference: po.bankEvidence.reference }); save(); return { ok: true, key: payoutKey, state: po.state };
  }
  const count = (o, f) => Object.values(o).filter(f).length, sumOf = (list, f) => list.reduce((s, x) => s + (f(x) ?? 0), 0);
  function summary() {
    const P = Object.values(S.payments), succ = P.filter(p => p.state === "PAYMENT_SUCCEEDED"), feesKnown = succ.every(p => p.feeMinor !== null), gross = sumOf(succ, p => p.amountMinor), refunds = sumOf(succ, p => p.refundedMinor), fees = sumOf(succ, p => p.feeMinor);
    return { environment, payments: { initiated: P.filter(p => p.state === "PAYMENT_INITIATED").length, pending: P.filter(p => p.state === "PAYMENT_PENDING").length, succeededProcessorConfirmed: succ.length, failed: P.filter(p => p.state === "PAYMENT_FAILED").length, disputesOpen: P.filter(p => p.dispute?.status === "OPEN").length, withRefunds: P.filter(p => p.refundedMinor > 0).length },
      payouts: { initiated: count(S.payouts, p => p.state === "PAYOUT_INITIATED"), paidByProcessorNotBankConfirmed: count(S.payouts, p => p.state === "PAYOUT_PAID_BY_PROCESSOR"), failed: count(S.payouts, p => p.state === "PAYOUT_FAILED"), bankReconciled: count(S.payouts, p => p.state === "BANK_RECONCILED") },
      money: { grossProcessorConfirmedMinor: succ.length ? gross : null, refundedMinor: refunds, feesMinor: feesKnown ? fees : null, netMinor: feesKnown && succ.length ? gross - refunds - fees : null, netNote: feesKnown ? "gross - refunds - fees (processor-confirmed, not bank receipt)" : "UNKNOWN: at least one succeeded payment has no recorded fee",
        bankReconciledMinor: sumOf(Object.values(S.payouts).filter(p => p.state === "BANK_RECONCILED"), p => p.amountMinor) }, eventsProcessed: Object.keys(S.events).length, auditOk: audit.verify().ok };
  }
  /** Authority for the payment-verification engine: VERIFIED only for a processor-confirmed succeeded payment carrying this invoice id with the exact amount and currency, not fully refunded, not under open dispute. */
  const authority = (id = "stripe-webhook-ledger") => ({ id, type: "PAYMENT_PROCESSOR", verify: async c => {
    const p = Object.values(S.payments).find(x => x.invoiceId === c.invoiceId && x.state === "PAYMENT_SUCCEEDED");
    if (!p) return { status: "UNKNOWN", reason: "NO_PROCESSOR_CONFIRMED_PAYMENT_FOR_INVOICE" };
    if (p.dispute?.status === "OPEN") return { status: "UNKNOWN", reason: "DISPUTE_OPEN" };
    if (p.amountMinor !== Math.round(Number(c.amount) * 100) || p.currency !== String(c.currency).toLowerCase()) return { status: "FAILED", reason: "AMOUNT_OR_CURRENCY_MISMATCH" };
    if (p.refundedMinor >= p.amountMinor) return { status: "FAILED", reason: "FULLY_REFUNDED" };
    return { status: "VERIFIED", amount: Number(c.amount), currency: String(c.currency).toUpperCase(), reference: p.key, environment, settledAt: new Date(p.at * 1000).toISOString() };
  } });
  return { ingest, reconcileBank, summary, authority, payment: k => (S.payments[k] ? structuredClone(S.payments[k]) : null), payout: k => (S.payouts[k] ? structuredClone(S.payouts[k]) : null), verify: () => audit.verify() };
}
