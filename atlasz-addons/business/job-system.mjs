// Universal Job object (package §7) — the common work container across ATLASZ.
// A Job carries: id, source, customer/entity, opportunity, contract ref, goal, scope, deliverables, milestones, tasks, dependencies, assigned agents,
// models, tools, connectors, approvals, costs, deadlines, status, artifacts, QA, verification, delivery, invoice, payment, profit, evidence.
// Status moves only along allowed edges and every consequential edge is guarded by a REAL record looked up in the owning engine
// (artifact verified, delivery recorded, invoice issued, payment VERIFIED). A job never claims what its engines do not hold.
import { createStore, needEvidence, clone } from "./store.mjs";

export const JOB_STATUSES = Object.freeze(["CREATED", "SCOPED", "PLANNED", "ASSIGNED", "IN_PROGRESS", "IN_QA", "VERIFIED", "READY_FOR_DELIVERY", "DELIVERED", "INVOICED", "PAYMENT_PENDING", "PAID_VERIFIED", "CLOSED", "BLOCKED", "FAILED", "CANCELLED"]);
const NEXT = Object.freeze({
  CREATED: ["SCOPED", "BLOCKED", "CANCELLED"], SCOPED: ["PLANNED", "BLOCKED", "CANCELLED"], PLANNED: ["ASSIGNED", "BLOCKED", "CANCELLED"], ASSIGNED: ["IN_PROGRESS", "BLOCKED", "CANCELLED"],
  IN_PROGRESS: ["IN_QA", "BLOCKED", "FAILED", "CANCELLED"], IN_QA: ["VERIFIED", "IN_PROGRESS", "BLOCKED", "FAILED"], VERIFIED: ["READY_FOR_DELIVERY", "IN_PROGRESS", "BLOCKED"],
  READY_FOR_DELIVERY: ["DELIVERED", "BLOCKED", "IN_PROGRESS"], DELIVERED: ["INVOICED", "BLOCKED"], INVOICED: ["PAYMENT_PENDING", "BLOCKED"], PAYMENT_PENDING: ["PAID_VERIFIED", "BLOCKED"],
  PAID_VERIFIED: ["CLOSED"], CLOSED: [], FAILED: ["PLANNED", "CANCELLED"], CANCELLED: [], BLOCKED: []     // BLOCKED returns only to the state it came from
});
export const COST_CLASSES = Object.freeze(["ESTIMATE", "ACTUAL"]);        // verified actuals live in the ledger; the job only references them
export const COST_CATEGORIES = Object.freeze(["MODEL", "TOOL", "PROVIDER", "LABOR", "OTHER"]);
const LIST_KINDS = Object.freeze({ artifacts: "artifacts", agents: "assignedAgents", models: "models", tools: "tools", connectors: "connectors", approvals: "approvals", evidence: "evidence", tasks: "tasks", dependencies: "dependencies", milestones: "milestones" });

export function createJobSystem({ file = null, environment = "SANDBOX", now = () => new Date().toISOString(), lookups = {}, blackBox = null } = {}) {
  const S = createStore({ file, init: () => ({ jobs: {} }) }), jobs = () => S.data.jobs;
  const rec = (kind, j, extra = {}) => { try { blackBox?.record({ kind, correlationId: j.correlationId, jobId: j.id, ...extra }); } catch { /* observability must not break the job */ } };
  const hist = (j, event, extra = {}) => { j.history.push({ at: now(), event, ...extra }); };
  const must = id => { const j = jobs()[id]; if (!j) throw new Error("UNKNOWN_JOB"); return j; };

  function create({ id, tenantId, entityId = null, source, opportunityId = null, dealId = null, contractRef = null, goal, scope = null, deliverables = [], milestones = [], deadlines = {}, correlationId = null } = {}) {
    if (!id || !tenantId || !source || !goal) throw new Error("JOB_ID_TENANT_SOURCE_GOAL_REQUIRED");
    if (jobs()[id]) return { ...clone(jobs()[id]), duplicate: true };
    const j = { id, tenantId, entityId, source, opportunityId, dealId, contractRef, goal, scope, deliverables: [...deliverables], milestones: [...milestones], tasks: [], dependencies: [], assignedAgents: [], models: [], tools: [], connectors: [], approvals: [], costs: [],
      deadlines: { ...deadlines }, status: "CREATED", artifacts: [], qa: null, verification: null, delivery: null, invoice: null, payment: null, profit: null, evidence: [], planId: null, blockedFrom: null, blockers: [], environment, correlationId, createdAt: now(), updatedAt: now(), history: [] };
    hist(j, "CREATED"); jobs()[id] = j; S.save(); rec("JOB_RECORD_CREATED", j, { decision: "CREATED" }); return { ...clone(j), duplicate: false };
  }
  function attach(id, kind, value) {
    const j = must(id), key = LIST_KINDS[kind];
    if (!key) throw new Error("UNKNOWN_ATTACHMENT:" + kind);
    if (!j[key].some(x => JSON.stringify(x) === JSON.stringify(value))) j[key].push(value);
    j.updatedAt = now(); hist(j, "ATTACHED:" + kind); S.save(); return clone(j);
  }
  /** cost: {amountUsd|null, class: ESTIMATE|ACTUAL, category, ref?}. UNKNOWN cost stays null — never invented. ACTUAL needs a ledger/evidence reference. */
  function addCost(id, c = {}) {
    const j = must(id);
    if (!COST_CLASSES.includes(c.class) || !COST_CATEGORIES.includes(c.category)) throw new Error("COST_CLASS_AND_CATEGORY_REQUIRED");
    const amount = c.amountUsd === null || c.amountUsd === undefined ? null : Number(c.amountUsd);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new Error("INVALID_COST_AMOUNT");
    if (c.class === "ACTUAL" && amount !== null && amount > 0 && !c.ref) throw new Error("ACTUAL_COST_NEEDS_LEDGER_REFERENCE");
    j.costs.push({ amountUsd: amount, class: c.class, category: c.category, ref: c.ref ?? null, at: now() }); j.updatedAt = now(); S.save(); return clone(j.costs);
  }
  function costSummary(id) {
    const j = must(id), by = cl => j.costs.filter(c => c.class === cl);
    const sum = l => l.reduce((s, c) => s + (c.amountUsd ?? 0), 0);
    return { estimateUsd: sum(by("ESTIMATE")), actualUsd: sum(by("ACTUAL")), unknownCostEntries: j.costs.filter(c => c.amountUsd === null).length, byCategory: Object.fromEntries(COST_CATEGORIES.map(k => [k, sum(by("ACTUAL").filter(c => c.category === k))])), note: "ESTIMATE and ACTUAL are never combined; unknown costs stay unknown" };
  }
  function setPlan(id, planId) { const j = must(id); j.planId = planId; hist(j, "PLANNED_WITH", { planId }); S.save(); }
  function block(id, reason) { const j = must(id); if (["BLOCKED", "CLOSED", "CANCELLED"].includes(j.status)) throw new Error("CANNOT_BLOCK_FROM_" + j.status); j.blockedFrom = j.status; j.status = "BLOCKED"; j.blockers.push({ reason, at: now(), open: true }); hist(j, "BLOCKED", { reason }); j.updatedAt = now(); S.save(); rec("JOB_RECORD_BLOCKED", j, { decision: "BLOCKED", reason }); return clone(j); }
  function unblock(id, { resolution } = {}) {
    const j = must(id); if (j.status !== "BLOCKED") throw new Error("JOB_NOT_BLOCKED");
    for (const b of j.blockers) if (b.open) { b.open = false; b.resolution = resolution ?? null; b.resolvedAt = now(); }
    j.status = j.blockedFrom; j.blockedFrom = null; hist(j, "UNBLOCKED"); j.updatedAt = now(); S.save(); return clone(j);
  }
  const need = (name, ok, reason) => { if (!ok) throw new Error(reason ?? name); };
  function transition(id, next, proof = {}) {
    const j = must(id);
    if (!JOB_STATUSES.includes(next)) throw new Error("UNKNOWN_JOB_STATUS");
    if (next === "BLOCKED") return block(id, proof.reason ?? "UNSPECIFIED");
    if (!(NEXT[j.status] ?? []).includes(next)) throw new Error(`INVALID_JOB_TRANSITION:${j.status}->${next}`);
    switch (next) {
      case "SCOPED": need("scope", j.scope && j.deliverables.length, "SCOPE_AND_DELIVERABLES_REQUIRED"); break;
      case "PLANNED": need("plan", proof.planId || j.planId, "PLAN_REQUIRED"); if (proof.planId) j.planId = proof.planId; break;
      case "ASSIGNED": need("agent", j.assignedAgents.length, "ASSIGNED_AGENT_REQUIRED"); break;
      case "IN_PROGRESS": need("agent", j.assignedAgents.length, "ASSIGNED_AGENT_REQUIRED"); break;
      case "IN_QA": need("artifact", j.artifacts.length, "ARTIFACT_REQUIRED_FOR_QA"); break;
      case "VERIFIED": {
        const v = proof.verification; need("verification", v?.verdict === "ACCEPT" && v?.independent === true, "INDEPENDENT_VERIFICATION_REQUIRED");
        need("qa", proof.qa?.status === "PASS", "QA_PASS_REQUIRED"); j.verification = clone(v); j.qa = clone(proof.qa); break;
      }
      case "READY_FOR_DELIVERY": {
        need("lookup", lookups.artifact, "ARTIFACT_REGISTRY_NOT_CONNECTED");
        const bad = j.artifacts.filter(a => lookups.artifact(a)?.verificationStatus !== "VERIFIED");
        need("verified", j.artifacts.length && !bad.length, "ALL_ARTIFACTS_MUST_BE_VERIFIED:" + bad.join(","));
        need("blockers", !j.blockers.some(b => b.open), "OPEN_BLOCKERS"); break;
      }
      case "DELIVERED": {
        need("lookup", lookups.delivery, "DELIVERY_SERVICE_NOT_CONNECTED"); const d = lookups.delivery(proof.deliveryId);
        need("delivery", d && ["DELIVERED", "DELIVERY_VERIFIED"].includes(d.status), "DELIVERY_RECORD_NOT_DELIVERED"); j.delivery = proof.deliveryId; break;
      }
      case "INVOICED": {
        need("lookup", lookups.invoice, "INVOICE_SERVICE_NOT_CONNECTED"); const v = lookups.invoice(proof.invoiceId);
        need("invoice", v && ["ISSUED", "SENT", "PARTIALLY_PAID", "PAID_CLAIMED", "PAYMENT_VERIFICATION_REQUIRED", "VERIFIED_PAID", "OVERDUE"].includes(v.status), "INVOICE_NOT_ISSUED"); j.invoice = proof.invoiceId; break;
      }
      case "PAYMENT_PENDING": need("invoice", j.invoice, "INVOICE_REQUIRED"); break;
      case "PAID_VERIFIED": {
        need("lookup", lookups.payment, "PAYMENT_VERIFICATION_NOT_CONNECTED"); const p = lookups.payment(proof.paymentId);
        need("payment", p?.status === "VERIFIED" && p.environment === environment, "PAYMENT_NOT_VERIFIED"); j.payment = proof.paymentId; break;
      }
      case "CLOSED": need("profit", proof.profit !== undefined, "PROFIT_RECORD_REQUIRED_TO_CLOSE"); j.profit = clone(proof.profit); break;
      case "FAILED": need("reason", proof.reason, "FAILURE_REASON_REQUIRED"); break;
      default: break;
    }
    if (proof.evidence) { needEvidence(proof.evidence, environment); j.evidence.push(clone(proof.evidence)); }
    const from = j.status; j.status = next; j.updatedAt = now(); hist(j, "STATUS", { from, to: next }); S.save();
    rec("JOB_RECORD_STATUS", j, { decision: next, reason: from + "->" + next }); return clone(j);
  }
  const get = id => (jobs()[id] ? clone(jobs()[id]) : null);
  const list = (f = {}) => Object.values(jobs()).filter(j => Object.entries(f).every(([k, v]) => j[k] === v)).map(clone);
  return { create, attach, addCost, costSummary, setPlan, block, unblock, transition, get, list, statuses: JOB_STATUSES, environment };
}
