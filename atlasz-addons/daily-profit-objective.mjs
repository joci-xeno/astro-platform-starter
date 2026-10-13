// Owner directive: MINIMUM daily target of USD 500 in VERIFIED NET PROFIT. It is a floor, never a ceiling and never a stop signal: reaching it changes nothing about whether work continues.
// Honest accounting: only processor-confirmed payments (payment-events ledger, LIVE environment) count as receipts; refunds, lost chargebacks, fees and documented operating costs are subtracted;
// an unknown fee or non-USD receipt makes the net UNKNOWN (null), never 0 and never silently converted. Forecasts and invoices are reported separately and never added to results.
// Continuous discovery is driven by a bounded, persistent scheduler (interval + daily cap + backoff + owner stop); there is no unbounded loop and no paid call is made by this module.
import fs from "node:fs";
import path from "node:path";

export const DAILY_MINIMUM_NET_PROFIT_USD = 500;
export const OBJECTIVE = Object.freeze({ metric: "VERIFIED_NET_PROFIT_USD_PER_DAY", minimumUsd: DAILY_MINIMUM_NET_PROFIT_USD, kind: "MINIMUM_NOT_CEILING", ceilingUsd: null, stopsWorkWhenReached: false });
const usd = minor => Math.round(minor) / 100;

/** dayOf(iso, timeZone) -> YYYY-MM-DD in the given IANA zone (default UTC; the zone used is always reported). */
export const dayOf = (iso, timeZone = "UTC") => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** createProfitObjective({payments, costs, now, timeZone}) -> {daily, cumulative, status}. `payments()` returns payment-ledger records; `costs()` returns documented cost rows [{at, amountUsd}] ; `pipeline()` optional forecast numbers. */
export function createProfitObjective({ payments, costs = () => [], pipeline = () => null, environment = "LIVE", now = () => new Date().toISOString(), timeZone = "UTC" } = {}) {
  if (typeof payments !== "function") throw new Error("PAYMENT_SOURCE_REQUIRED");
  const compute = rows => {
    const live = environment === "LIVE", out = { counted: 0, grossMinor: 0, refundsMinor: 0, lostChargebacksMinor: 0, feesMinor: 0, feesUnknown: 0, nonUsd: [], heldDisputes: 0, pendingMinor: 0, pendingCount: 0 };
    for (const p of rows) {
      if (p.state === "PAYMENT_PENDING" || p.state === "PAYMENT_INITIATED") { if (p.currency === "usd" && Number.isInteger(p.amountMinor)) { out.pendingMinor += p.amountMinor; } out.pendingCount++; continue; }
      if (p.state !== "PAYMENT_SUCCEEDED") continue;
      if (p.currency !== "usd") { out.nonUsd.push({ key: p.key, currency: p.currency ?? null }); continue; }
      const st = p.dispute?.status ?? null; if (st && st !== "WON") { if (st === "LOST") { out.counted++; out.grossMinor += p.amountMinor; out.lostChargebacksMinor += p.amountMinor - Math.min(p.refundedMinor, p.amountMinor); out.refundsMinor += Math.min(p.refundedMinor, p.amountMinor); if (p.feeMinor === null) out.feesUnknown++; else out.feesMinor += p.feeMinor; } else out.heldDisputes++; continue; }
      out.counted++; out.grossMinor += p.amountMinor; out.refundsMinor += Math.min(p.refundedMinor, p.amountMinor); if (p.feeMinor === null) out.feesUnknown++; else out.feesMinor += p.feeMinor;
    }
    return out;
  };
  const sumCosts = pred => { let list = []; try { list = costs() ?? []; } catch { return null; } return list.filter(pred).reduce((s, c) => s + (Number(c.amountUsd) || 0), 0); };
  function figures(c, costsUsd) {
    const gross = usd(c.grossMinor), refunds = usd(c.refundsMinor), lost = usd(c.lostChargebacksMinor), fees = c.feesUnknown ? null : usd(c.feesMinor);
    const blockers = [...(!environment || environment !== "LIVE" ? ["ENVIRONMENT_NOT_LIVE_NEVER_REVENUE"] : []), ...(c.feesUnknown ? ["PROCESSING_FEE_UNKNOWN_FOR_" + c.feesUnknown + "_PAYMENT(S)"] : []), ...(c.nonUsd.length ? ["NON_USD_RECEIPTS_NOT_CONVERTED_" + c.nonUsd.length] : []), ...(costsUsd === null ? ["OPERATING_COSTS_UNREADABLE"] : [])];
    const net = environment === "LIVE" && fees !== null && costsUsd !== null && !c.nonUsd.length ? Math.round((gross - refunds - lost - fees - costsUsd) * 100) / 100 : null;
    return { verifiedGrossReceiptsUsd: environment === "LIVE" ? gross : null, refundsUsd: refunds, chargebacksLostUsd: lost, processingFeesUsd: fees, operatingCostsUsd: costsUsd, verifiedNetProfitUsd: net, paymentsCounted: c.counted, disputesHeldNotCounted: c.heldDisputes, pendingUncollected: { usd: usd(c.pendingMinor), count: c.pendingCount, kind: "PROCESSOR_PENDING_NOT_EARNED" }, unresolved: blockers };
  }
  function daily(date = null) {
    const t = now(), day = date ?? dayOf(t, timeZone), inDay = iso => { try { return dayOf(iso, timeZone) === day; } catch { return false; } };
    const rows = payments().filter(p => Number.isFinite(p.at) && inDay(new Date(p.at * 1000).toISOString()));
    const f = figures(compute(rows), sumCosts(c => inDay(c.at)));
    const net = f.verifiedNetProfitUsd, min = OBJECTIVE.minimumUsd;
    const status = net === null ? "NOT_VERIFIABLE" : net >= min ? "MINIMUM_MET" : "BELOW_MINIMUM";
    return { day, timeZone, objective: OBJECTIVE, ...f, status, remainingToMinimumUsd: net === null ? null : Math.max(0, Math.round((min - net) * 100) / 100), excessOverMinimumUsd: net !== null && net > min ? Math.round((net - min) * 100) / 100 : 0, continueWork: true, continueReason: status === "MINIMUM_MET" ? "MINIMUM_IS_A_FLOOR_NOT_A_STOPPING_POINT" : "TARGET_NOT_YET_VERIFIED",
      forecast: { value: pipeline(), kind: "FORECAST_NOT_RESULT", addedToResults: false }, basis: "PROCESSOR_CONFIRMED_PAYMENTS_MINUS_REFUNDS_LOST_CHARGEBACKS_FEES_AND_DOCUMENTED_COSTS (not bank receipt)", at: t };
  }
  function cumulative() { const f = figures(compute(payments()), sumCosts(() => true)); return { ...f, objective: OBJECTIVE, basis: "ALL_TIME_VERIFIED", at: now() }; }
  return { daily, cumulative, objective: OBJECTIVE };
}

/** Persistent, bounded discovery scheduler. The caller drives tick(); each tick runs at most once per interval and at most maxPerDay times per day, backs off after failure and honours the owner stop. */
export function createDiscoveryScheduler({ dir, run = null, ready = null, isStopped = () => false, now = () => new Date().toISOString(), minIntervalMs = 15 * 60_000, maxPerDay = 96, backoffMs = 10 * 60_000, maxBackoffMs = 6 * 3_600_000, timeZone = "UTC" } = {}) {
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
