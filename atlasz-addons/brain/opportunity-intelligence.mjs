// Opportunity Intelligence (V7.3 Brain §9): explainable scoring (unknown stays unknown, never invented) + guarded pipeline.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const STAGES = Object.freeze(["DISCOVER", "VERIFY", "SCORE", "QUALIFY", "FEASIBILITY", "PRIORITIZE", "OUTREACH", "NEGOTIATE", "WON", "LOST", "EXECUTION_HANDOFF"]);
const NEXT = { DISCOVER: ["VERIFY", "LOST"], VERIFY: ["SCORE", "LOST"], SCORE: ["QUALIFY", "LOST"], QUALIFY: ["FEASIBILITY", "LOST"], FEASIBILITY: ["PRIORITIZE", "LOST"], PRIORITIZE: ["OUTREACH", "LOST"], OUTREACH: ["NEGOTIATE", "LOST", "WON"], NEGOTIATE: ["WON", "LOST"], WON: ["EXECUTION_HANDOFF"], LOST: [], EXECUTION_HANDOFF: [] };
// factor -> weight. Each factor value is 0..1 where higher is better for ATLASZ (cost/risk/competition/complexity are inverted by the caller-facing names below).
export const FACTORS = Object.freeze({ legitimacy: 3, capabilityFit: 2.5, technicalFeasibility: 2, profitPotential: 2.5, paymentLikelihood: 2, timeFit: 1, lowRisk: 1.5, lowCompetition: 1, recurringPotential: 1, scalability: 0.75, lowDeliveryComplexity: 1.25, requiredHumanInvolvementLow: 1 });
const unit = v => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : null);

export function scoreOpportunity(o = {}) {
  const f = o.factors ?? {}, known = [], unknown = [];
  for (const [k, w] of Object.entries(FACTORS)) { const v = unit(f[k]); (v === null ? unknown : known).push(v === null ? k : { factor: k, value: v, weight: w, contribution: v * w }); }
  const totalW = Object.values(FACTORS).reduce((a, b) => a + b, 0), knownW = known.reduce((a, b) => a + b.weight, 0);
  const base = knownW ? known.reduce((a, b) => a + b.contribution, 0) / knownW : null;
  const coverage = knownW / totalW;
  const hardBlocks = [];
  if (o.legitimacy === "SUSPECT" || unit(f.legitimacy) === 0) hardBlocks.push("NOT_LEGITIMATE");
  if (o.lawful === false) hardBlocks.push("NOT_LAWFUL");
  const profit = Number.isFinite(Number(o.estRevenueUsd)) && Number.isFinite(Number(o.estCostUsd)) && o.estRevenueUsd !== null && o.estCostUsd !== null ? Number(o.estRevenueUsd) - Number(o.estCostUsd) : null;
  // confidence-weighted: unknown factors reduce the score instead of being filled in
  const score = hardBlocks.length || base === null ? 0 : Math.round(base * (0.5 + 0.5 * coverage) * 1000) / 10;
  return { score, coverage: Math.round(coverage * 100) / 100, hardBlocks, unknownFactors: unknown, factors: known.sort((a, b) => b.contribution - a.contribution), estProfitUsd: profit,
    explanation: hardBlocks.length ? "Excluded: " + hardBlocks.join(", ") : known.length ? "Score " + score + "/100 from " + known.length + " known factors (coverage " + Math.round(coverage * 100) + "%); " + unknown.length + " unknown factors lower confidence. Profit is not guaranteed." : "No known factors: cannot score.", guaranteeProfit: false };
}

export function createOpportunityIntelligence({ file = null, governance = null, now = () => new Date().toISOString() } = {}) {
  let db = {}; if (file && fs.existsSync(file)) { try { db = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("OPPORTUNITY_STORE_UNREADABLE"); } }
  const save = () => { if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); const t = file + ".tmp"; fs.writeFileSync(t, JSON.stringify(db)); fs.renameSync(t, file); };
  const G = id => { const o = db[id]; if (!o) throw new Error("UNKNOWN_OPPORTUNITY"); return o; };
  function discover(o = {}) {
    if (!o.title || !o.source) throw new Error("TITLE_AND_SOURCE_REQUIRED");
    const dupe = Object.values(db).find(x => x.url && x.url === o.url); if (dupe) return { id: dupe.id, duplicate: true };
    const id = "opp-" + crypto.randomUUID().slice(0, 8); db[id] = { id, ...structuredClone(o), stage: "DISCOVER", history: [{ at: now(), stage: "DISCOVER" }], verification: null, scoring: null }; save(); return { id, duplicate: false };
  }
  function update(id, patch) { const o = G(id); Object.assign(o, structuredClone(patch)); if (patch.factors || patch.estRevenueUsd !== undefined || patch.estCostUsd !== undefined) o.scoring = scoreOpportunity(o); save(); return structuredClone(o); }
  /** evidence: how legitimacy was checked. Without it the opportunity cannot leave VERIFY. */
  function advance(id, to, { evidence = null, ownerApproval = null } = {}) {
    const o = G(id); if (!(NEXT[o.stage] ?? []).includes(to)) throw new Error("ILLEGAL_TRANSITION:" + o.stage + "->" + to);
    if (to === "SCORE") { if (!evidence?.legitimacyCheck) throw new Error("VERIFY_EVIDENCE_REQUIRED"); o.verification = { ...evidence, at: now() }; o.factors = { ...(o.factors ?? {}), legitimacy: evidence.legitimacyScore ?? o.factors?.legitimacy }; o.scoring = scoreOpportunity(o); }
    if (to === "QUALIFY") { o.scoring = scoreOpportunity(o); if (o.scoring.hardBlocks.length) throw new Error("BLOCKED:" + o.scoring.hardBlocks.join(",")); if (o.scoring.score <= 0) throw new Error("NOT_SCORABLE"); }
    if (to === "OUTREACH") {
      if (!governance) throw new Error("GOVERNANCE_REQUIRED");
      const g = governance.authorize({ brain: "OPPORTUNITY", action: "SEND_EXTERNAL", external: true, subject: id, ownerApproval });
      if (!g.allowed) return { id, stage: o.stage, moved: false, decision: g.decision, reason: g.reason };
    }
    if (to === "WON" && !evidence?.customerAcceptanceRef) throw new Error("WON_REQUIRES_CUSTOMER_ACCEPTANCE_EVIDENCE");
    o.stage = to; o.history.push({ at: now(), stage: to }); save(); return { id, stage: to, moved: true };
  }
  const prioritize = () => Object.values(db).filter(o => o.scoring && o.scoring.score > 0 && !["LOST", "EXECUTION_HANDOFF"].includes(o.stage)).sort((a, b) => b.scoring.score - a.scoring.score || a.id.localeCompare(b.id)).map(o => ({ id: o.id, title: o.title, stage: o.stage, score: o.scoring.score, coverage: o.scoring.coverage, estProfitUsd: o.scoring.estProfitUsd, explanation: o.scoring.explanation }));
  /** Only WON opportunities hand off. Produces a plan spec for the Planning Brain; nothing is executed or invoiced here. */
  function handoff(id) {
    const o = G(id); if (o.stage !== "WON") throw new Error("ONLY_WON_OPPORTUNITIES_HAND_OFF");
    o.stage = "EXECUTION_HANDOFF"; o.history.push({ at: now(), stage: "EXECUTION_HANDOFF" }); save();
    return { planSpec: { goal: "Deliver: " + o.title, projects: [{ name: o.title, milestones: [{ name: "Delivery", tasks: [{ id: id + "-scope", title: "Confirm scope with customer", requiresApproval: true, capabilities: ["analysis"] }, { id: id + "-deliver", title: "Deliver", dependsOn: [id + "-scope"], capabilities: o.requiredCapabilities ?? [] }, { id: id + "-qa", title: "Independent QA", dependsOn: [id + "-deliver"], capabilities: ["qa"] }] }] }] }, note: "Handoff only; revenue is NOT recognized until payment is verified." };
  }
  return { discover, update, advance, prioritize, handoff, get: id => structuredClone(G(id)), list: () => Object.values(db).map(o => ({ id: o.id, title: o.title, stage: o.stage, score: o.scoring?.score ?? null })) };
}
