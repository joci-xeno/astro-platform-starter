// Revenue Persistence Engine (integration report §5; Global Business package "daily revenue persistence"). It PLANS and REPORTS; it never sends, bids, accepts,
// spends, or contacts anyone. Every external effect it suggests is a PROPOSAL with status PENDING_OWNER_APPROVAL.
//
//   replenishment   policy.minOpenQualifiedPerSearchAgent: for each of SEARCH-1..5 the number of OPEN_QUALIFIED opportunities it owns; a deficit becomes a SEARCH_MORE proposal.
//   failover        an IN_PROGRESS opportunity without progress for policy.stallHours is marked STALLED (internal bookkeeping) and a REASSIGN proposal names the next best
//                   OPEN_QUALIFIED opportunity for the same EXECUTION agent. WAITING_ON_CUSTOMER is not a stall until policy.waitingTimeoutHours (parallel work continues).
//   carry-over      unfinished AUTHORIZED workflows persist on disk; carryOver(day) proposes RESUME for those whose owner authorization (verified with owner-auth
//                   verifyRecorded, action WORKFLOW_AUTHORIZE, subject "workflow:<id>") is younger than policy.maxCarryOverDays, and NEEDS_REAUTHORIZATION otherwise.
//   daily ledger    targets (USD 500 minimum, USD 1,000,000 aspirational) are TARGETS ONLY - never caps, forecasts or income. dailyReport() compares the target with
//                   VERIFIED COLLECTED = profit-ledger PAID entries with confirmedReceived AND externalEvidence (recordMoney/summarize), in USD only (no FX invented).
//                   Estimated (LEAD_VALUE/PROPOSED), agreed, invoiced and unverified amounts are listed SEPARATELY and never added to collected. Simulated trading P&L and any
//                   entry marked simulated / estimate is excluded and counted. With no ledger data at all, verified collected is null (UNKNOWN), not 0.
//   outreach caps   proposeOutreach() is bounded per day (global and per agent); a duplicate (same opportunity + kind + day) is refused. Proposals only.
//   agents          exactly the 30 permanent agents (ROSTER from agent-activity.mjs); an unknown agent id is refused; nothing here can add an agent.
//
// Status honesty: IMPLEMENTED + unit TESTED with synthetic data. Not CONNECTED to the runtime supervisor/scheduler, not LIVE. No real money figure exists here.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { recordMoney, summarize, MONEY_STAGES } from "./profit-ledger.mjs";
import { ROSTER } from "./agent-activity.mjs";

export const TARGETS = Object.freeze({ minimumDailyUsd: 500, aspirationalDailyUsd: 1000000, kind: "TARGET_ONLY_NOT_A_FORECAST_NOT_INCOME" });
export const OPP_STATUSES = Object.freeze(["OPEN_QUALIFIED", "IN_PROGRESS", "WAITING_ON_CUSTOMER", "STALLED", "WON", "LOST", "DONE"]);
export const DEFAULT_POLICY = Object.freeze({ minOpenQualifiedPerSearchAgent: 3, stallHours: 48, waitingTimeoutHours: 168, maxCarryOverDays: 7, outreachDailyCap: 20, outreachPerAgentDailyCap: 5 });
export const LIMITS = Object.freeze({ maxOpportunities: 5000, maxWorkflows: 2000, maxDays: 400, maxProposalsPerDay: 500, maxEntries: 10000 });
const POLICY_BOUNDS = { minOpenQualifiedPerSearchAgent: [0, 50], stallHours: [1, 24 * 30], waitingTimeoutHours: [1, 24 * 90], maxCarryOverDays: [1, 30], outreachDailyCap: [0, 200], outreachPerAgentDailyCap: [0, 50] };
const OUTREACH_KINDS = ["SEND", "BID", "ACCEPT", "FOLLOW_UP"];
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/, DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SIM_SOURCES = new Set(["SIMULATED", "SIMULATION", "TRADING_SIM", "PAPER_TRADING", "BACKTEST", "ESTIMATE", "FORECAST"]);

export function validatePolicy(raw = {}) {
  const p = { ...DEFAULT_POLICY };
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (!(k in POLICY_BOUNDS)) return { error: "POLICY_FIELD_UNKNOWN:" + k };
    const [lo, hi] = POLICY_BOUNDS[k]; if (!Number.isInteger(v) || v < lo || v > hi) return { error: "POLICY_FIELD_OUT_OF_BOUNDS:" + k };
    p[k] = v;
  }
  return { policy: Object.freeze(p) };
}
export const workflowSubject = ({ workflowId, opportunityId = null, agentId, steps }) => "workflow:" + workflowId + ":" + createHash("sha256").update(JSON.stringify([workflowId, opportunityId, agentId, steps])).digest("hex").slice(0, 32);
const dayOf = iso => new Date(iso).toISOString().slice(0, 10);
const SIM_TOKEN = /^(sim|simul|paper|demo|mock|fake|dummy|sandbox|backtest|hypothet|dry|test|trading|pnl)/i;
const simTokens = v => String(v ?? "").split(/[^A-Za-z]+/).filter(Boolean);
const isSimulated = e => e?.simulated === true || e?.isEstimate === true || e?.paper === true || e?.sandbox === true || e?.demo === true || SIM_SOURCES.has(String(e?.source ?? "").toUpperCase()) || simTokens(e?.source).some(t => SIM_TOKEN.test(t)) || simTokens(e?.kind).some(t => SIM_TOKEN.test(t)) || String(e?.kind ?? "").toUpperCase().includes("TRADING_PNL");

/**
 * Pure: classify money entries for one day. entries: profit-ledger shaped {stage, amountUsd, costUsd, confirmedReceived?, externalEvidence?, currency?, at, ...}.
 * entries === null/undefined -> no data (verified collected UNKNOWN).
 */
export function dailyTargetReport(day, entries, { targets = TARGETS } = {}) {
  if (typeof day !== "string" || !DAY_RE.test(day)) throw new Error("DAY_INVALID");
  const base = { day, targets: { minimumDailyUsd: targets.minimumDailyUsd, aspirationalDailyUsd: targets.aspirationalDailyUsd, kind: TARGETS.kind } };
  if (entries === null || entries === undefined) return { ...base, status: "NO_LEDGER_DATA", verifiedCollectedUsd: null, gapToMinimumUsd: null, minimumMet: null, note: "No ledger data was supplied: collected revenue is UNKNOWN, not zero." };
  if (!Array.isArray(entries) || entries.length > LIMITS.maxEntries) throw new Error("ENTRIES_INVALID");
  const buckets = { estimated: [], agreed: [], invoiced: [], verifiedPaid: [], verifiedPaidOtherCurrency: [], excludedSimulated: [], rejected: [] };
  let dated = 0;
  for (const [i, e] of entries.entries()) {
    if (!e || typeof e !== "object") { buckets.rejected.push({ index: i, reason: "ENTRY_NOT_OBJECT" }); continue; }
    const at = e.at ?? e.paidAt ?? e.receivedAt ?? e.recordedAt; if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) { buckets.rejected.push({ index: i, reason: "ENTRY_DATE_REQUIRED" }); continue; }
    if (dayOf(at) !== day) continue; dated++;
    if (isSimulated(e)) { buckets.excludedSimulated.push({ index: i, kind: e.kind ?? e.source ?? "SIMULATED", amountUsd: Number(e.amountUsd) || null }); continue; }
    if (e.stage === "PAID" && (e.confirmedReceived !== true || !(typeof e.externalEvidence === "string" ? e.externalEvidence.trim().length >= 3 : e.externalEvidence && typeof e.externalEvidence === "object"))) { buckets.rejected.push({ index: i, stage: "PAID", reason: "PAID_NEEDS_CONFIRMED_RECEIPT_AND_EVIDENCE" }); continue; }
    let r; try { r = recordMoney({ ...e, costUsd: e.costUsd ?? 0 }); } catch (err) { buckets.rejected.push({ index: i, stage: e.stage ?? null, reason: err.message }); continue; }
    const item = { index: i, stage: r.stage, amount: r.amountUsd, currency: e.currency ?? "USD", ref: e.ref ?? e.id ?? null };
    if (r.stage === "PAID") (item.currency === "USD" ? buckets.verifiedPaid : buckets.verifiedPaidOtherCurrency).push({ ...item, evidence: typeof r.externalEvidence === "string" ? r.externalEvidence.slice(0, 120) : "PRESENT", _r: r });
    else if (r.stage === "INVOICED") buckets.invoiced.push(item);
    else if (r.stage === "AGREED") buckets.agreed.push(item);
    else buckets.estimated.push(item);
  }
  const s = summarize(buckets.verifiedPaid.map(x => x._r));
  const sum = l => l.filter(x => x.currency === "USD").reduce((n, x) => n + x.amount, 0);
  const verifiedCollectedUsd = s.confirmedPaidUsd;
  buckets.verifiedPaid = buckets.verifiedPaid.map(({ _r, ...x }) => x); buckets.verifiedPaidOtherCurrency = buckets.verifiedPaidOtherCurrency.map(({ _r, ...x }) => x);
  // Unknown is never zero: a day with no dated entries has UNKNOWN revenue, and rejected entries (undated, unreceipted PAID, malformed) make the figure a LOWER BOUND.
  if (dated === 0 && buckets.rejected.length === 0) return { ...base, status: "NO_LEDGER_DATA_FOR_DAY", verifiedCollectedUsd: null, verifiedNetUsd: null, gapToMinimumUsd: null, minimumMet: null, aspirationalProgress: null, separate: { estimatedUsd: 0, agreedUsd: 0, invoicedUsd: 0, notRevenue: true }, buckets, note: "No ledger entries exist for this day: collected revenue is UNKNOWN, not zero." };
  const lowerBound = buckets.rejected.length > 0 || buckets.verifiedPaidOtherCurrency.length > 0, met = verifiedCollectedUsd >= targets.minimumDailyUsd;
  return { ...base, status: met ? "MINIMUM_TARGET_MET_VERIFIED" : lowerBound ? "LOWER_BOUND_UNKNOWN_ENTRIES" : "MINIMUM_TARGET_NOT_MET", verifiedCollectedIsLowerBound: lowerBound,
    verifiedCollectedUsd, verifiedNetUsd: s.verifiedNetProfitUsd, gapToMinimumUsd: Math.max(0, targets.minimumDailyUsd - verifiedCollectedUsd), minimumMet: met ? true : lowerBound ? null : false,
    aspirationalProgress: verifiedCollectedUsd / targets.aspirationalDailyUsd,
    separate: { estimatedUsd: sum(buckets.estimated), agreedUsd: sum(buckets.agreed), invoicedUsd: sum(buckets.invoiced), notRevenue: true },
    buckets, note: "Targets are not forecasts or income. Only externally confirmed PAID entries with evidence count as collected; estimates, agreements and invoices are listed separately; simulated P&L is excluded." };
}

export function createRevenuePersistence({ dir, ownerAuth = null, policy = {}, roster = ROSTER, now = () => new Date().toISOString() } = {}) {
  if (!dir) throw new Error("DIR_REQUIRED");
  const agents = new Set(roster); if (agents.size !== 30 || [...agents].filter(a => a.startsWith("SEARCH-")).length !== 5) throw new Error("ROSTER_MUST_BE_5_SEARCH_PLUS_25_EXECUTION");
  const vp = validatePolicy(policy); if (vp.error) throw new Error(vp.error); const P = vp.policy;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const FILE = path.join(dir, "revenue-persistence.json"), audit = createAuditChain({ filePath: path.join(dir, "revenue-persistence-audit.jsonl"), now });
  let st = { opportunities: {}, workflows: {}, outreach: {}, reports: {} };
  if (fs.existsSync(FILE)) { try { st = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { throw new Error("REVENUE_PERSISTENCE_STORE_UNREADABLE"); } }
  const save = () => { const t = FILE + ".tmp"; fs.writeFileSync(t, JSON.stringify(st), { mode: 0o600 }); fs.renameSync(t, FILE); };
  const R = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  const hrs = (a, b) => (Date.parse(b) - Date.parse(a)) / 3600000;
  const kn = v => v === null || v === undefined ? null : Number.isFinite(v) ? v : NaN;

  /** Track an opportunity. Unknown economics stay null (they sort after known ones; they are never treated as 0). */
  function track(o = {}) {
    if (typeof o.id !== "string" || !ID_RE.test(o.id) || ["__proto__", "constructor", "prototype"].includes(o.id)) return R("ID_INVALID");
    if (!agents.has(o.searchAgent) || !o.searchAgent.startsWith("SEARCH-")) return R("SEARCH_AGENT_MUST_BE_ONE_OF_SEARCH_1_5");
    if (o.executionAgent != null && (!agents.has(o.executionAgent) || !o.executionAgent.startsWith("EXECUTION-"))) return R("EXECUTION_AGENT_MUST_BE_ONE_OF_EXECUTION_1_25");
    if (!OPP_STATUSES.includes(o.status ?? "OPEN_QUALIFIED")) return R("STATUS_INVALID");
    if (o.eligibility && o.eligibility !== "ELIGIBLE" && (o.status ?? "OPEN_QUALIFIED") === "OPEN_QUALIFIED") return R("ONLY_ELIGIBLE_CAN_BE_OPEN_QUALIFIED");
    const econ = { expectedNetUsd: kn(o.expectedNetUsd), paymentProbability: kn(o.paymentProbability), feasibility: kn(o.feasibility), daysToRevenue: kn(o.daysToRevenue) };
    if (Object.values(econ).some(Number.isNaN) || (econ.paymentProbability !== null && (econ.paymentProbability < 0 || econ.paymentProbability > 1)) || (econ.feasibility !== null && (econ.feasibility < 0 || econ.feasibility > 1))) return R("ECONOMICS_INVALID");
    if (!Object.hasOwn(st.opportunities, o.id) && Object.keys(st.opportunities).length >= LIMITS.maxOpportunities) return R("OPPORTUNITY_LIMIT");
    const prev = st.opportunities[o.id];
    st.opportunities[o.id] = { id: o.id, searchAgent: o.searchAgent, executionAgent: o.executionAgent ?? null, status: o.status ?? "OPEN_QUALIFIED", ...econ, valueIsRevenue: false, lastProgressAt: o.lastProgressAt ?? now(), createdAt: prev?.createdAt ?? now() };
    save(); return { ok: true };
  }
  function progress(id, { status = null } = {}) {
    const o = Object.hasOwn(st.opportunities, id) ? st.opportunities[id] : null; if (!o) return R("UNKNOWN_OPPORTUNITY");
    if (status !== null && !OPP_STATUSES.includes(status)) return R("STATUS_INVALID");
    if (status) o.status = status; o.lastProgressAt = now(); save(); return { ok: true };
  }
  /** Priority: expected net (known first), payment probability, feasibility, time to revenue. Unknown sorts last, never as zero. */
  const cmpKnown = (a, b, desc = true) => a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : desc ? b - a : a - b;
  const rank = list => [...list].sort((a, b) => cmpKnown(a.expectedNetUsd, b.expectedNetUsd) || cmpKnown(a.paymentProbability, b.paymentProbability) || cmpKnown(a.feasibility, b.feasibility) || cmpKnown(a.daysToRevenue, b.daysToRevenue, false) || a.id.localeCompare(b.id));

  function replenishmentPlan() {
    const out = [];
    for (const a of [...agents].filter(x => x.startsWith("SEARCH-"))) {
      const open = Object.values(st.opportunities).filter(o => o.searchAgent === a && o.status === "OPEN_QUALIFIED").length;
      if (open < P.minOpenQualifiedPerSearchAgent) out.push({ type: "SEARCH_MORE", agentId: a, open, minimum: P.minOpenQualifiedPerSearchAgent, deficit: P.minOpenQualifiedPerSearchAgent - open, externalEffect: false, note: "search and preparation only; discovery runs only against owner-allowlisted sources" });
    }
    return { proposals: out, policy: { minOpenQualifiedPerSearchAgent: P.minOpenQualifiedPerSearchAgent } };
  }
  function failover() {
    const t = now(), proposals = [], stalled = [];
    for (const o of Object.values(st.opportunities)) {
      const age = hrs(o.lastProgressAt, t);
      if ((o.status === "IN_PROGRESS" && age >= P.stallHours) || (o.status === "WAITING_ON_CUSTOMER" && age >= P.waitingTimeoutHours)) { o.status = "STALLED"; o.stalledAt = t; stalled.push(o.id); }
    }
    const taken = new Set();
    for (const id of stalled) {
      const o = st.opportunities[id]; if (!o.executionAgent) continue;
      const next = rank(Object.values(st.opportunities).filter(x => x.status === "OPEN_QUALIFIED" && !x.executionAgent && !taken.has(x.id)))[0];
      if (next) { taken.add(next.id); proposals.push({ type: "REASSIGN", agentId: o.executionAgent, from: id, to: next.id, externalEffect: false }); }
      else proposals.push({ type: "NO_NEXT_OPPORTUNITY", agentId: o.executionAgent, from: id, followUp: "SEARCH_MORE" });
    }
    if (stalled.length) { save(); audit.append("STALLED", { ids: stalled.slice(0, 100) }); }
    return { stalled, proposals };
  }
  /** Apply an internal REASSIGN (no external effect). */
  function applyReassign(p) {
    if (!p || p.type !== "REASSIGN") return R("NOT_A_REASSIGN_PROPOSAL");
    const to = st.opportunities[p.to], from = st.opportunities[p.from];
    if (!to || !from || to.status !== "OPEN_QUALIFIED" || to.executionAgent || from.status !== "STALLED" || !agents.has(p.agentId) || !p.agentId.startsWith("EXECUTION-")) return R("REASSIGN_NO_LONGER_VALID");
    to.executionAgent = p.agentId; to.status = "IN_PROGRESS"; to.lastProgressAt = now(); from.executionAgent = null; save(); audit.append("REASSIGNED", { agentId: p.agentId, from: p.from, to: p.to }); return { ok: true };
  }

  // ---------------------------------------------------------------- multi-day carry-over of AUTHORIZED workflows
  function registerWorkflow({ workflowId, opportunityId = null, agentId, steps, completedSteps = 0, authorization } = {}) {
    if (typeof workflowId !== "string" || !ID_RE.test(workflowId) || ["__proto__", "constructor", "prototype"].includes(workflowId)) return R("WORKFLOW_ID_INVALID");
    if (!agents.has(agentId) || !agentId.startsWith("EXECUTION-")) return R("EXECUTION_AGENT_REQUIRED");
    if (!Array.isArray(steps) || !steps.length || steps.length > 100 || !steps.every(s => typeof s === "string" && s.length <= 120)) return R("STEPS_INVALID");
    if (!Number.isInteger(completedSteps) || completedSteps < 0 || completedSteps > steps.length) return R("COMPLETED_STEPS_INVALID");
    if (!ownerAuth || typeof ownerAuth.verifyRecorded !== "function") return R("OWNER_AUTH_NOT_CONFIGURED");
    const subject = workflowSubject({ workflowId, opportunityId, agentId, steps });      // bound to the exact ordered steps, agent and opportunity
    let va; try { va = ownerAuth.verifyApproval?.(authorization, { action: "WORKFLOW_AUTHORIZE", subject }); } catch { va = null; }      // live, single-use (nonce consumed, expiry enforced); the recorded copy is re-verified later
    if (!va || va.allowed !== true) return R("WORKFLOW_NOT_AUTHORIZED", { subject, detail: va?.reason ?? "OWNER_APPROVAL_INVALID" });
    if (!Object.hasOwn(st.workflows, workflowId) && Object.keys(st.workflows).length >= LIMITS.maxWorkflows) return R("WORKFLOW_LIMIT");
    st.workflows[workflowId] = { workflowId, opportunityId, agentId, steps: [...steps], completedSteps, authorizedAt: authorization.issuedAt, authorizationNonce: authorization.nonce, authorization, subject, registeredAt: now(), finished: completedSteps === steps.length };
    save(); audit.append("WORKFLOW_REGISTERED", { workflowId, agentId, nonce: authorization.nonce }); return { ok: true };
  }
  function stepDone(workflowId) { const w = Object.hasOwn(st.workflows, workflowId) ? st.workflows[workflowId] : null; if (!w) return R("UNKNOWN_WORKFLOW"); if (w.finished) return R("ALREADY_FINISHED"); w.completedSteps++; w.finished = w.completedSteps === w.steps.length; w.lastStepAt = now(); save(); return { ok: true, finished: w.finished }; }
  /** For the given day: unfinished authorized workflows -> RESUME (authorization still fresh) or NEEDS_REAUTHORIZATION. Re-verifies every recorded signature. */
  function carryOver(day = now().slice(0, 10)) {
    if (!DAY_RE.test(day)) return R("DAY_INVALID");
    const dayStart = Date.parse(day + "T00:00:00.000Z"), out = [];
    for (const w of Object.values(st.workflows)) {
      if (w.finished) continue;
      const subj = workflowSubject(w), sigOk = w.subject === subj && Boolean(ownerAuth?.verifyRecorded?.(w.authorization, { action: "WORKFLOW_AUTHORIZE", subject: subj }));      // the subject is RECOMPUTED from the stored steps/agent/opportunity: editing them voids the approval
      const ageDays = (dayStart - Date.parse(w.authorizedAt)) / 86400000;
      const action = !sigOk ? "BLOCKED_AUTHORIZATION_INVALID" : ageDays > P.maxCarryOverDays ? "NEEDS_REAUTHORIZATION" : "RESUME";
      out.push({ type: action, workflowId: w.workflowId, agentId: w.agentId, nextStep: w.steps[w.completedSteps], completedSteps: w.completedSteps, totalSteps: w.steps.length, authorizationAgeDays: Math.round(ageDays * 10) / 10 });
    }
    return { ok: true, day, proposals: out };
  }

  // ---------------------------------------------------------------- outreach proposals (never sent here)
  function proposeOutreach({ agentId, opportunityId, kind = "SEND", channel = "email", summary = "" } = {}) {
    if (!agents.has(agentId)) return R("NOT_ONE_OF_THE_30_PERMANENT_AGENTS");
    if (!OUTREACH_KINDS.includes(kind)) return R("KIND_INVALID");
    if (typeof opportunityId !== "string" || !Object.hasOwn(st.opportunities, opportunityId)) return R("UNKNOWN_OPPORTUNITY");
    const day = now().slice(0, 10), d = st.outreach[day] ??= [];
    if (d.length >= Math.min(P.outreachDailyCap, LIMITS.maxProposalsPerDay)) return R("OUTREACH_DAILY_CAP_REACHED", { cap: P.outreachDailyCap });
    if (d.filter(x => x.agentId === agentId).length >= P.outreachPerAgentDailyCap) return R("OUTREACH_AGENT_DAILY_CAP_REACHED", { cap: P.outreachPerAgentDailyCap });
    if (d.some(x => x.opportunityId === opportunityId && x.kind === kind)) return R("DUPLICATE_OUTREACH_SAME_DAY");
    const proposal = { proposalId: createHash("sha256").update(day + agentId + opportunityId + kind + d.length).digest("hex").slice(0, 16), day, agentId, opportunityId, kind, channel: String(channel).slice(0, 30), summary: String(summary).slice(0, 300),
      status: "PENDING_OWNER_APPROVAL", requiresOwnerApproval: true, approvalAction: kind === "ACCEPT" ? "CONTRACT_ACCEPT" : kind === "BID" ? "BID_SUBMIT" : "OUTREACH_SEND", sent: false, createdAt: now() };
    d.push(proposal); for (const k of Object.keys(st.outreach).sort().slice(0, -LIMITS.maxDays)) delete st.outreach[k];
    save(); audit.append("OUTREACH_PROPOSED", { proposalId: proposal.proposalId, agentId, kind }); return { ok: true, proposal };
  }
  /** Daily report persisted per day (bounded). */
  function dailyReport(day, entries) {
    const r = dailyTargetReport(day, entries);
    st.reports[day] = { day, status: r.status, verifiedCollectedUsd: r.verifiedCollectedUsd, separate: r.separate ?? null, excludedSimulated: r.buckets?.excludedSimulated.length ?? 0, at: now() };
    for (const k of Object.keys(st.reports).sort().slice(0, -LIMITS.maxDays)) delete st.reports[k];
    save(); audit.append("DAILY_REPORT", { day, status: r.status, verifiedCollectedUsd: r.verifiedCollectedUsd }); return r;
  }
  const status = () => ({ state: "IMPLEMENTED_NOT_CONNECTED", policy: P, targets: TARGETS, opportunities: Object.values(st.opportunities).reduce((m, o) => (m[o.status] = (m[o.status] ?? 0) + 1, m), {}), workflowsOpen: Object.values(st.workflows).filter(w => !w.finished).length, agents: agents.size, moneyStages: MONEY_STAGES });
  return { track, progress, replenishmentPlan, failover, applyReassign, registerWorkflow, stepDone, carryOver, proposeOutreach, dailyReport, ranked: () => rank(Object.values(st.opportunities).filter(o => o.status === "OPEN_QUALIFIED")).map(o => ({ ...o })), status, audit: () => audit.entries() };
}
