// Owner directive: MINIMUM daily target of USD 500 in VERIFIED NET PROFIT. It is a floor, never a ceiling and never a stop signal: reaching it changes nothing about whether work continues.
// Honest accounting: only processor-confirmed payments (payment-events ledger, LIVE environment) count as receipts; refunds, lost chargebacks, fees and documented operating costs are subtracted;
// an unknown fee or non-USD receipt makes the net UNKNOWN (null), never 0 and never silently converted. Forecasts and invoices are reported separately and never added to results.
// Continuous discovery is driven by a bounded, persistent scheduler (interval + daily cap + backoff + owner stop); there is no unbounded loop and no paid call is made by this module.
import fs from "node:fs";
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";
import { convertAmount } from "./global-discovery.mjs";
import { isCryptoCurrency } from "./financial-guard.mjs";
import { COST_CATEGORIES, canonicalCostCategory } from "./cost-completeness.mjs";

export const DAILY_MINIMUM_NET_PROFIT_USD = 500;
export const BUSINESS_TIME_ZONE = "America/Vancouver";                                    // the day boundary of the objective; every record also keeps its UTC instant
export const OBJECTIVE = Object.freeze({ metric: "VERIFIED_NET_PROFIT_USD_PER_DAY", minimumUsd: DAILY_MINIMUM_NET_PROFIT_USD, kind: "MINIMUM_NOT_CEILING", ceilingUsd: null, stopsWorkWhenReached: false, timeZone: BUSINESS_TIME_ZONE, statuses: Object.freeze(["NOT_VERIFIABLE", "BELOW_MINIMUM", "MINIMUM_MET", "ABOVE_MINIMUM"]) });
export const MAX_RATE_AGE_MS = 72 * 3_600_000;                                          // a documented rate must be within 72 h of the event it converts
const ZERO_DECIMAL = new Set(["jpy", "krw", "vnd", "clp", "pyg", "ugx", "xaf", "xof", "bif", "djf", "gnf", "kmf", "rwf", "vuv", "xpf"]);
const dollars = cents => Math.round(cents) / 100;
const toCents = usdFloat => Math.round(usdFloat * 100);

/** dayOf(iso, timeZone) -> YYYY-MM-DD in the given IANA zone (default: the business zone America/Vancouver; DST-correct; the zone used is always reported). */
export const dayOf = (iso, timeZone = BUSINESS_TIME_ZONE) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
/** dayBounds(day, timeZone) -> {startUtc, endUtc, hours}: the real UTC span of a local day (23 h or 25 h on DST changes). */
export function dayBounds(day, timeZone = BUSINESS_TIME_ZONE) {
  const first = d => { const base = Date.parse(d + "T00:00:00Z"); let lo = base - 16 * 3_600_000, hi = base + 16 * 3_600_000; while (hi - lo > 1000) { const mid = Math.floor((lo + hi) / 2000) * 1000; if (dayOf(new Date(mid).toISOString(), timeZone) < d) lo = mid; else hi = mid; } return hi; };
  const next = new Date(Date.parse(day + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10), s = first(day), e = first(next); return { startUtc: new Date(s).toISOString(), endUtc: new Date(e).toISOString(), hours: (e - s) / 3_600_000 };
}

/** createProfitObjective({payments, costs, completeness, rates, invoices, settlement, pipeline, environment, now, timeZone}) -> {daily, cumulative}.
 * payments(): payment-events records (the ONLY source of receipts). costs(): cost-ledger rows. completeness: {missing(day, categories)} (owner-attested cost completeness; absent => costs are unknown).
 * rates(): documented USD rates [{from,to:"USD",rate,asOf,source}]. invoices(): [{id,amount,currency,status}] for the outstanding view. settlement(): payment-events summary for the bank-settlement view. */
export function createProfitObjective({ payments, costs = () => [], completeness = null, rates = () => [], invoices = null, settlement = null, pipeline = () => null, environment = "LIVE", now = () => new Date().toISOString(), timeZone = BUSINESS_TIME_ZONE } = {}) {
  if (typeof payments !== "function") throw new Error("PAYMENT_SOURCE_REQUIRED");
  const dayIso = iso => { try { return dayOf(iso, timeZone); } catch { return null; } };
  const dayOfSec = sec => (Number.isFinite(sec) ? dayIso(new Date(sec * 1000).toISOString()) : null);
  function conv(minor, currency, atSec, out) {                                         // -> cents of USD, or null (reason recorded in out.unverified)
    const cur = String(currency ?? "").toLowerCase(); if (cur === "usd") return minor;
    const CUR = cur.toUpperCase(), at = atSec * 1000; let list = []; try { list = rates() ?? []; } catch { list = []; }
    const cand = list.filter(x => x && String(x.from).toUpperCase() === CUR && String(x.to).toUpperCase() === "USD").map(x => ({ ...x, from: CUR, to: "USD" })), valid = cand.filter(x => convertAmount(1, CUR, "USD", [x]));
    if (!cand.length) { out.unverified.push({ currency: CUR, reason: "NO_DOCUMENTED_RATE" }); return null; }
    if (!valid.length) { out.unverified.push({ currency: CUR, reason: "EXCHANGE_RATE_INVALID" }); return null; }
    const best = valid.map(x => ({ x, d: Math.abs(Date.parse(x.asOf) - at) })).sort((a, b) => a.d - b.d)[0];
    if (best.d > MAX_RATE_AGE_MS) { out.unverified.push({ currency: CUR, reason: "RATE_NOT_WITHIN_72H_OF_EVENT" }); return null; }
    const major = minor / (ZERO_DECIMAL.has(cur) ? 1 : 100), usd = convertAmount(major, CUR, "USD", [best.x]).amount, c = toCents(usd);
    out.conversions.push({ currency: CUR, minor, rate: best.x.rate, asOf: best.x.asOf, source: best.x.source, usdCents: c, eventAt: new Date(at).toISOString() }); return c;
  }
  function compute(day) {                                                              // day === null => all time
    const live = environment === "LIVE", o = { counted: 0, grossC: 0, refundsC: 0, lostC: 0, feesC: 0, feesUnknown: 0, unverified: [], conversions: [], crypto: [], heldDisputes: 0, corruptPayments: 0, duplicatePayments: 0, pendingUsdC: 0, pendingCount: 0, pendingByCurrency: {}, openDisputes: [], multiPay: [], days: new Set(), catC: Object.fromEntries(COST_CATEGORIES.map(c => [c, 0])), corruptCosts: 0, costsReadable: true, conversionDays: new Set() };
    const inScope = d => d !== null && (day === null || d === day);
    let rows = []; try { rows = payments() ?? []; } catch { rows = []; o.corruptPayments++; }
    const seen = new Set(), byInvoice = new Map();
    for (const p of rows) {
      if (!p || typeof p.key !== "string") { o.corruptPayments++; continue; }
      if (seen.has(p.key)) { o.duplicatePayments++; continue; } seen.add(p.key);
      const cur = String(p.currency ?? "").toLowerCase();
      if (p.state === "PAYMENT_PENDING" || p.state === "PAYMENT_INITIATED") { o.pendingCount++; if (Number.isInteger(p.amountMinor) && cur) { o.pendingByCurrency[cur] = (o.pendingByCurrency[cur] ?? 0) + p.amountMinor; if (cur === "usd") o.pendingUsdC += p.amountMinor; } continue; }
      if (p.state !== "PAYMENT_SUCCEEDED") continue;
      if (!Number.isInteger(p.amountMinor) || p.amountMinor < 0 || !cur || !Number.isFinite(p.at)) { o.corruptPayments++; continue; }
      const st = p.dispute?.status ?? null, receiptDay = dayOfSec(p.at);
      if (st && st !== "WON" && st !== "LOST") { o.openDisputes.push({ key: p.key, amountMinor: p.amountMinor, currency: cur }); if (inScope(receiptDay)) o.heldDisputes++; continue; }
      if (p.invoiceId) byInvoice.set(p.invoiceId, (byInvoice.get(p.invoiceId) ?? 0) + 1);
      const refundLog = Array.isArray(p.refundLog) ? p.refundLog : (p.refundedMinor > 0 ? [{ id: "legacy", amountMinor: Math.min(p.refundedMinor, p.amountMinor), at: p.at }] : []);
      const crypto = isCryptoCurrency(cur);
      if (inScope(receiptDay)) {
        o.days.add(receiptDay);
        if (crypto) { o.crypto.push({ key: p.key, currency: cur }); }
        else { const g = conv(p.amountMinor, cur, p.at, o); if (g === null) { /* unverified, recorded */ } else { o.counted++; o.grossC += g; if (cur !== "usd") o.conversionDays.add(receiptDay); if (p.feeMinor === null || !Number.isInteger(p.feeMinor)) o.feesUnknown++; else { const f = conv(p.feeMinor, cur, p.at, o); if (f === null) o.feesUnknown++; else o.feesC += f; } } }
      }
      if (crypto) continue;
      for (const r of refundLog) { const d = dayOfSec(r.at); if (!inScope(d) || !Number.isInteger(r.amountMinor)) continue; o.days.add(d); const c = conv(r.amountMinor, cur, r.at, o); if (c !== null) { o.refundsC += c; if (cur !== "usd") o.conversionDays.add(d); } }
      if (st === "LOST") { const d = dayOfSec(p.dispute.at); if (inScope(d)) { o.days.add(d); const c = conv(p.amountMinor - Math.min(p.refundedMinor ?? 0, p.amountMinor), cur, p.dispute.at, o); if (c !== null) { o.lostC += c; if (cur !== "usd") o.conversionDays.add(d); } } }
    }
    for (const [inv, n] of byInvoice) if (n > 1) o.multiPay.push(inv);
    let cl = []; try { cl = costs() ?? []; } catch { o.costsReadable = false; }
    for (const c of cl) { const amt = Number(c?.amountUsd), d = dayIso(c?.evidence?.incurredAt ?? c?.at); if (!c || !Number.isFinite(amt) || amt < 0 || !d) { o.corruptCosts++; continue; } if (!inScope(d)) continue; o.days.add(d); o.catC[canonicalCostCategory(c.category)] += toCents(amt); }
    return o;
  }
  function figures(o, day, today) {
    const live = environment === "LIVE"; if (day === null) o.days.add(today);
    const days = day === null ? [...o.days].sort() : [day], unresolved = [];
    if (!live) unresolved.push("ENVIRONMENT_NOT_LIVE_NEVER_REVENUE");
    if (o.feesUnknown) unresolved.push("PROCESSING_FEE_UNKNOWN_FOR_" + o.feesUnknown + "_PAYMENT(S)");
    const nonUsd = [...new Map(o.unverified.map(u => [u.currency + u.reason, u])).values()]; if (o.unverified.length) unresolved.push("NON_USD_RECEIPTS_NOT_CONVERTED_" + o.unverified.length);
    if (o.crypto.length) unresolved.push("CRYPTO_RECEIPT_SETTLEMENT_NOT_VERIFIED_" + o.crypto.length);
    if (o.corruptPayments) unresolved.push("CORRUPT_PAYMENT_RECORDS_" + o.corruptPayments);
    if (o.corruptCosts) unresolved.push("CORRUPT_COST_RECORDS_" + o.corruptCosts);
    if (!o.costsReadable) unresolved.push("OPERATING_COSTS_UNREADABLE");
    const missing = {}; for (const d of days) { const req = ["AI_USAGE", "HOSTING_INFRA", "OTHER_ATTRIBUTABLE", ...(o.conversionDays.has(d) ? ["CURRENCY_CONVERSION"] : [])]; let m; try { m = completeness ? completeness.missing(d, req) : req; } catch { m = req; } for (const c of m) (missing[c] ??= []).push(d); }
    for (const [c, ds] of Object.entries(missing)) unresolved.push("COST_COMPLETENESS_NOT_ATTESTED:" + c + (day === null ? ":" + ds.length + "_DAY(S)" : ""));
    if (o.duplicatePayments) unresolved.push("DUPLICATE_PAYMENT_RECORDS_IGNORED_" + o.duplicatePayments);
    const costC = Object.values(o.catC).reduce((a, b) => a + b, 0), positiveUnknown = o.unverified.length > 0 || o.crypto.length > 0 || o.corruptPayments > 0;
    const known = o.grossC - o.refundsC - o.lostC - o.feesC - costC, hard = ["ENVIRONMENT_NOT_LIVE_NEVER_REVENUE", "DUPLICATE_PAYMENT_RECORDS_IGNORED_"];
    const blocking = unresolved.filter(u => !u.startsWith("DUPLICATE_PAYMENT_RECORDS_IGNORED_")), exact = live && !blocking.length;
    return { days: days.length, verifiedGrossReceiptsUsd: live ? dollars(o.grossC) : null, refundsUsd: dollars(o.refundsC), chargebacksLostUsd: dollars(o.lostC), processingFeesUsd: o.feesUnknown ? null : dollars(o.feesC), currencyConversionCostsUsd: dollars(o.catC.CURRENCY_CONVERSION), aiUsageCostsUsd: dollars(o.catC.AI_USAGE), hostingInfraCostsUsd: dollars(o.catC.HOSTING_INFRA), otherAttributableCostsUsd: dollars(o.catC.OTHER_ATTRIBUTABLE), operatingCostsUsd: o.costsReadable ? dollars(costC) : null,
      costsComplete: Object.keys(missing).length === 0 && o.costsReadable && !o.corruptCosts, verifiedNetProfitUsd: exact ? dollars(known) : null, netUpperBoundUsd: live && !positiveUnknown ? dollars(known) : null,
      paymentsCounted: o.counted, disputesHeldNotCounted: o.heldDisputes, pendingUncollected: { usd: dollars(o.pendingUsdC), count: o.pendingCount, byCurrencyMinor: o.pendingByCurrency, kind: "PROCESSOR_PENDING_NOT_EARNED" },
      openDisputes: { count: o.openDisputes.length, items: o.openDisputes.slice(0, 20), kind: "HELD_OUT_OF_RESULTS_UNTIL_RESOLVED" },
      currencyConversion: { converted: o.conversions.slice(0, 50), unverified: nonUsd, cryptoReceiptsNotCounted: o.crypto.slice(0, 20), rule: "A non-USD receipt counts only with a documented rate (source + timestamp within 72 h of the event); otherwise it is unverified and the net is unknown. Crypto receipts never count until settlement is verified." },
      anomalies: { multiplePaymentsForInvoice: o.multiPay.slice(0, 20), duplicatePaymentRecordsIgnored: o.duplicatePayments }, unresolved };
  }
  const statusOf = f => { const net = f.verifiedNetProfitUsd, min = OBJECTIVE.minimumUsd; if (net === null) return f.netUpperBoundUsd !== null && f.netUpperBoundUsd < min ? "BELOW_MINIMUM" : "NOT_VERIFIABLE"; return net > min ? "ABOVE_MINIMUM" : net === min ? "MINIMUM_MET" : "BELOW_MINIMUM"; };
  const outstanding = () => { if (typeof invoices !== "function") return { state: "NOT_CONNECTED", kind: "INVOICE_NOT_PAID" }; try { const list = (invoices() ?? []).filter(i => i && !["PAID", "VOID", "CANCELLED", "DRAFT"].includes(String(i.status).toUpperCase())), by = {}; for (const i of list) by[String(i.currency ?? "UNKNOWN").toUpperCase()] = Math.round(((by[String(i.currency ?? "UNKNOWN").toUpperCase()] ?? 0) + (Number(i.amount) || 0)) * 100) / 100; return { state: "OK", count: list.length, byCurrency: by, kind: "INVOICE_NOT_PAID" }; } catch { return { state: "UNREADABLE", kind: "INVOICE_NOT_PAID" }; } };
  const bank = () => { if (typeof settlement !== "function") return { state: "NOT_CONNECTED" }; try { const s = settlement(); return { state: "OK", processorPaidNotBankConfirmed: s.payouts.paidByProcessorNotBankConfirmed, bankReconciledPayouts: s.payouts.bankReconciled, bankReconciledMinor: s.money.bankReconciledMinor, note: "Processor-confirmed is not bank settlement; only owner-authorised bank evidence reconciles a payout." }; } catch { return { state: "UNREADABLE" }; } };
  function daily(date = null) {
    const t = now(), today = dayIso(t), day = date ?? today, f = figures(compute(day), day, today), net = f.verifiedNetProfitUsd, min = OBJECTIVE.minimumUsd, status = statusOf(f);
    let b = null; try { b = dayBounds(day, timeZone); } catch { b = null; }
    return { day, timeZone, bounds: b, finalised: day < today, objective: OBJECTIVE, ...f, status, statusBasis: net !== null ? "EXACT_VERIFIED_NET" : status === "BELOW_MINIMUM" ? "UPPER_BOUND_BELOW_MINIMUM_UNKNOWN_ITEMS_CAN_ONLY_LOWER_IT" : "UNRESOLVED_ITEMS", remainingToMinimumUsd: net === null ? null : Math.max(0, Math.round((min - net) * 100) / 100), excessOverMinimumUsd: net !== null && net > min ? Math.round((net - min) * 100) / 100 : 0,
      continueWork: true, continueReason: status === "MINIMUM_MET" || status === "ABOVE_MINIMUM" ? "MINIMUM_IS_A_FLOOR_NOT_A_STOPPING_POINT" : "TARGET_NOT_YET_VERIFIED", outstandingInvoices: outstanding(), bankSettlement: bank(),
      provisionalNote: day >= today ? "Day not finished: late refunds, disputes, fees or costs can still change this figure." : null,
      forecast: { value: pipeline(), kind: "FORECAST_NOT_RESULT", addedToResults: false }, basis: "PROCESSOR_CONFIRMED_PAYMENTS_MINUS_REFUNDS_LOST_CHARGEBACKS_FEES_AND_ATTESTED_COMPLETE_COSTS (not bank receipt)", at: t };
  }
  function cumulative() { const t = now(), f = figures(compute(null), null, dayIso(t)); return { ...f, status: statusOf(f), objective: OBJECTIVE, timeZone, outstandingInvoices: outstanding(), bankSettlement: bank(), basis: "ALL_TIME_VERIFIED", at: t }; }
  /** Stage-gate check for NET_PROFIT: this ONE payment is processor-confirmed, live, undisputed, has a known fee, is USD or converts with a documented rate, and the owner has attested complete costs for its day. */
  function paymentNetVerified(paymentKey) {
    if (environment !== "LIVE") return { ok: false, reason: "ENVIRONMENT_NOT_LIVE" };
    let list = []; try { list = payments() ?? []; } catch { return { ok: false, reason: "PAYMENTS_UNREADABLE" }; }
    const p = list.find(x => x?.key === paymentKey); if (!p) return { ok: false, reason: "UNKNOWN_PAYMENT" }; if (p.state !== "PAYMENT_SUCCEEDED") return { ok: false, reason: "NOT_PROCESSOR_CONFIRMED" };
    if (p.dispute && p.dispute.status !== "WON") return { ok: false, reason: "DISPUTE_NOT_RESOLVED_IN_OUR_FAVOUR" }; if (!Number.isInteger(p.feeMinor)) return { ok: false, reason: "PROCESSING_FEE_UNKNOWN" }; if (isCryptoCurrency(p.currency)) return { ok: false, reason: "CRYPTO_SETTLEMENT_NOT_VERIFIED" };
    const sink = { unverified: [], conversions: [] }; if (conv(p.amountMinor, p.currency, p.at, sink) === null) return { ok: false, reason: "NO_DOCUMENTED_RATE" };
    const day = dayOfSec(p.at), req = ["AI_USAGE", "HOSTING_INFRA", "OTHER_ATTRIBUTABLE", ...(String(p.currency).toLowerCase() === "usd" ? [] : ["CURRENCY_CONVERSION"])]; let m; try { m = completeness ? completeness.missing(day, req) : req; } catch { m = req; }
    return m.length ? { ok: false, reason: "COST_COMPLETENESS_NOT_ATTESTED:" + m.join(",") } : { ok: true, day, paymentKey };
  }
  return { daily, cumulative, paymentNetVerified, objective: OBJECTIVE, timeZone };
}

/** Receipt reconciliation: payment-events is the ONLY receipt authority. A cost-ledger PAID entry that no processor-confirmed payment backs is reported and never counted;
 * a processor-confirmed payment without a ledger entry is reported as unbooked. Amounts are compared in USD only; other currencies are listed as not comparable. */
export function reconcileReceipts({ payments = [], ledgerEntries = [] } = {}) {
  const byKey = new Map(payments.filter(p => p?.state === "PAYMENT_SUCCEEDED").map(p => [p.key, p])), byInv = new Map(payments.filter(p => p?.state === "PAYMENT_SUCCEEDED" && p.invoiceId).map(p => [p.invoiceId, p]));
  const paid = ledgerEntries.filter(r => r?.type === "REVENUE" && r.stage === "PAID"), matched = new Set(), res = { ledgerPaidWithoutProcessorEvent: [], amountMismatches: [], notComparable: [], processorPaymentsNotBooked: [], matched: 0 };
  for (const r of paid) { const ref = r.evidence?.reference, p = byKey.get(ref) ?? byInv.get(ref); if (!p) { res.ledgerPaidWithoutProcessorEvent.push({ jobId: r.jobId, reference: ref ?? null, amountUsd: r.amountUsd }); continue; } matched.add(p.key); if (p.currency !== "usd") { res.notComparable.push({ key: p.key, currency: p.currency }); continue; } if (Math.round(r.amountUsd * 100) !== p.amountMinor) res.amountMismatches.push({ key: p.key, ledgerUsd: r.amountUsd, processorUsd: p.amountMinor / 100 }); else res.matched++; }
  for (const p of byKey.values()) if (!matched.has(p.key)) res.processorPaymentsNotBooked.push({ key: p.key, amountMinor: p.amountMinor, currency: p.currency });
  return { ...res, authority: "PAYMENT_EVENTS_LEDGER_ONLY", clean: !res.ledgerPaidWithoutProcessorEvent.length && !res.amountMismatches.length, note: "Cost-ledger PAID entries without a processor-confirmed payment are not receipts and are never counted in the objective." };
}

/** Persistent, bounded discovery scheduler. The caller drives tick(); each tick runs at most once per interval and at most maxPerDay times per day, backs off after failure and honours the owner stop. */
export function createDiscoveryScheduler({ dir, run = null, ready = null, isStopped = () => false, now = () => new Date().toISOString(), minIntervalMs = 15 * 60_000, maxPerDay = 96, backoffMs = 10 * 60_000, maxBackoffMs = 6 * 3_600_000, timeZone = BUSINESS_TIME_ZONE } = {}) {
  if (!dir) throw new Error("DIR_REQUIRED"); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "discovery-scheduler.json"); let S = { lastRunAt: null, day: null, runsToday: 0, failures: 0, nextAllowedAt: null, last: null, queue: [] };
  if (fs.existsSync(file)) { try { S = { ...S, ...JSON.parse(fs.readFileSync(file, "utf8")) }; } catch { throw new Error("SCHEDULER_STATE_CORRUPT_NOT_OVERWRITTEN"); } }
  const save = () => { const t = file + ".tmp"; fs.writeFileSync(t, JSON.stringify(S), { mode: 0o600 }); fs.renameSync(t, file); };
  let busy = false;
  async function tick() {
    const t = now(), ms = Date.parse(t), day = dayOf(t, timeZone);
    if (isStopped()) return { ran: false, reason: "OWNER_STOP_OR_SAFE_MODE_ACTIVE" };
    if (typeof run !== "function") return { ran: false, reason: "NO_AUTHORISED_LIVE_SOURCE_CONNECTED" };       // honest: nothing to run until the owner approves a source
    if (typeof ready === "function") { let why = null; try { why = ready(); } catch { why = "READINESS_CHECK_FAILED"; } if (why) return { ran: false, reason: why }; }
    if (busy) return { ran: false, reason: "RUN_IN_PROGRESS" };
    if (S.day !== day) { S.day = day; S.runsToday = 0; }
    if (S.runsToday >= maxPerDay) return { ran: false, reason: "DAILY_RUN_CAP_REACHED" };
    const gate = Math.max(S.lastRunAt ? Date.parse(S.lastRunAt) + minIntervalMs : 0, S.nextAllowedAt ? Date.parse(S.nextAllowedAt) : 0);
    if (ms < gate) return { ran: false, reason: "NOT_DUE", dueAt: new Date(gate).toISOString() };
    busy = true; S.lastRunAt = t; S.runsToday++; S.last = { at: t, state: "STARTED" }; save();                  // checkpoint BEFORE the run: a crash is visible, not silent
    try { const r = await run({ at: t, runIndex: S.runsToday }); S.failures = 0; S.nextAllowedAt = null; S.last = { at: t, state: "OK", summary: typeof r === "object" && r ? Object.fromEntries(Object.entries(r).filter(([, v]) => ["number", "string", "boolean"].includes(typeof v)).slice(0, 10)) : null }; save(); return { ran: true, ok: true, ...S.last };
    } catch (e) { S.failures++; const wait = Math.min(maxBackoffMs, backoffMs * 2 ** (S.failures - 1)); S.nextAllowedAt = new Date(ms + wait).toISOString(); S.last = { at: t, state: "FAILED", code: String(e?.code ?? e?.message ?? "ERROR").slice(0, 60) }; save(); return { ran: true, ok: false, ...S.last, retryAt: S.nextAllowedAt };
    } finally { busy = false; }
  }
  return { tick, state: () => structuredClone(S), limits: { minIntervalMs, maxPerDay, backoffMs, maxBackoffMs } };
}

/** Shortfall analysis: when a (finished) day is below the minimum or unverifiable, record the gap and name the bottlenecks from REAL pipeline counts and blockers. Never invents a cause: an empty pipeline stage is reported as the first empty stage, nothing more. */
const STAGE_ORDER = [["discovered", "no opportunities discovered"], ["validated", "no opportunity passed validation"], ["qualified", "no qualified opportunity"], ["proposalsPrepared", "no proposal prepared"], ["proposalsSubmittedAuthorized", "no proposal submitted with owner authorisation"], ["contractsAccepted", "no contract accepted"], ["jobsCompleted", "no job completed"], ["invoicesIssued", "no invoice issued"], ["paymentsReceived", "no verified payment received"]];
export function analyseShortfall(day, { metrics = null, blockers = [] } = {}) {
  const base = { day: day.day, status: day.status, minimumUsd: day.objective.minimumUsd, verifiedNetProfitUsd: day.verifiedNetProfitUsd, shortfallUsd: (day.status === "MINIMUM_MET" || day.status === "ABOVE_MINIMUM") ? 0 : day.remainingToMinimumUsd };
  if ((day.status === "MINIMUM_MET" || day.status === "ABOVE_MINIMUM")) return { ...base, shortfall: false, bottlenecks: [], note: "Minimum met; work continues." };
  const bottlenecks = []; for (const u of day.unresolved ?? []) bottlenecks.push({ kind: "ACCOUNTING_UNRESOLVED", detail: u });
  for (const b of blockers) bottlenecks.push({ kind: "BLOCKER", detail: String(b).slice(0, 160) });
  if (metrics) { const first = STAGE_ORDER.find(([k]) => !metrics[k]); if (first) bottlenecks.push({ kind: "FIRST_EMPTY_STAGE", stage: first[0], detail: first[1] }); else bottlenecks.push({ kind: "THROUGHPUT_BELOW_TARGET", detail: "every stage has records but verified net profit is below the minimum" }); }
  else bottlenecks.push({ kind: "PIPELINE_COUNTS_UNKNOWN", detail: "pipeline metrics unavailable; cause not determined" });
  return { ...base, shortfall: true, bottlenecks, priorities: ["resolve accounting-unresolved items first", "remove owner-gated blockers listed above", "widen discovery only through owner-approved sources", "no speculative transaction, spend or bypass is ever a remedy"], note: "Shortfall recorded; nothing is invented to reach the target." };
}
export function createShortfallLog({ dir, now = () => new Date().toISOString() } = {}) {
  if (!dir) throw new Error("DIR_REQUIRED"); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const chain = createAuditChain({ filePath: path.join(dir, "daily-results.jsonl"), now });
  return { record(day, ctx) { chain.reload?.(); const a = analyseShortfall(day, ctx); const dup = chain.entries().find(e => e.data?.day === a.day); if (dup) return { ok: true, duplicate: true, entry: dup.data }; chain.append("DAY_CLOSED", a); return { ok: true, entry: a }; }, list: () => { chain.reload?.(); return chain.entries().map(e => e.data); }, verify: () => { chain.reload?.(); return chain.verify(); } };
}
