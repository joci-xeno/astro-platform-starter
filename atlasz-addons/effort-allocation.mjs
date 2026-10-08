// Adaptive reasoning allocation (85-capability programme: C10). Chooses HOW MUCH reasoning/verification a task gets from its complexity, risk and budget.
// Pure, deterministic policy: no model call, no spend, no randomness. It never raises a budget: when the chosen depth needs a paid model and the approved budget is 0,
// the answer is proceed:false + requiresSpend:true (the owner decides), not a silent downgrade of a risky task. Unknown or invalid risk is treated as HIGH (fail closed).
import { okName, own } from "./safe-keys.mjs";
export const RISKS = Object.freeze(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const LEVELS = Object.freeze(["LOW", "MEDIUM", "HIGH", "MAX"]);
const KIND_WEIGHT = Object.freeze({ LOOKUP: 0, SUMMARISE: 1, TRANSFORM: 1, DRAFT: 2, ANALYSE: 3, PLAN: 3, CODE: 3, DECIDE: 4, FINANCIAL: 4 });
export function complexityScore({ kind = "LOOKUP", inputTokens = 0, constraints = 0, requiresTools = false, steps = 1 } = {}) {
  const k = own(KIND_WEIGHT, kind); if (k === undefined) return { ok: false, reason: "KIND_UNKNOWN" };
  for (const v of [inputTokens, constraints, steps]) if (!Number.isFinite(v) || v < 0) return { ok: false, reason: "NUMBERS_INVALID" };
  if (steps < 1) return { ok: false, reason: "NUMBERS_INVALID" };                  // a task has at least one step; 0 must not lower the score
  const size = inputTokens > 50000 ? 3 : inputTokens > 8000 ? 2 : inputTokens > 1500 ? 1 : 0;
  const score = k + size + Math.min(3, Math.floor(constraints / 3)) + Math.min(3, Math.floor((steps - 1) / 2)) + (requiresTools ? 1 : 0);
  return { ok: true, score };
}
export function chooseEffort(task = {}, opts = {}) {
  const { budgetUsd = 0, freeOnly = true } = opts && typeof opts === "object" ? opts : {};
  if (!task || typeof task !== "object") return { ok: false, reason: "TASK_REQUIRED" };
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) return { ok: false, reason: "BUDGET_INVALID" };
  const c = complexityScore(task); if (!c.ok) return c;
  const risk = RISKS.includes(task.risk) ? task.risk : "HIGH", riskKnown = RISKS.includes(task.risk);
  let idx = c.score <= 1 ? 0 : c.score <= 4 ? 1 : c.score <= 7 ? 2 : 3;
  const floor = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }[risk]; idx = Math.max(idx, floor);
  if (task.externalEffect) idx = Math.max(idx, 2);                                   // anything with an external effect gets at least HIGH
  const level = LEVELS[idx];
  const reasoning = ["none", "brief", "stepwise", "stepwise+selfcheck"][idx];
  const verify = idx >= 2 || risk === "HIGH" || risk === "CRITICAL" || Boolean(task.externalEffect);   // independent verification for important conclusions
  const humanReview = risk === "CRITICAL" || Boolean(task.externalEffect);
  const needsPaid = idx >= 2 && freeOnly !== true;                                    // caller says free providers cannot carry this depth
  const requiresSpend = needsPaid && budgetUsd === 0;
  const maxOutputTokens = [400, 1200, 3000, 6000][idx];
  const reasons = [`complexity ${c.score}`, `risk ${risk}${riskKnown ? "" : " (unknown -> HIGH)"}`]; if (task.externalEffect) reasons.push("external effect"); if (requiresSpend) reasons.push("needs a paid model but approved budget is 0");
  return { ok: true, level, reasoning, verify, humanReview, maxOutputTokens, complexity: c.score, risk, proceed: !requiresSpend, requiresSpend, spendUsd: 0, reasons };
}
