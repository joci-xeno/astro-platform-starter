// Business Factory (V7.3 Brain §10): turns a legitimate, repeatable opportunity into a DRAFT service package.
// It prepares; it never launches, publishes, sells, signs or spends. Those go through governance and need Joci's signed approval,
// and even then this module only calls an injected publisher - it has none of its own.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const OFFER_TYPES = Object.freeze(["ONE_TIME_SERVICE", "RECURRING_SERVICE", "SUBSCRIPTION", "LICENSE", "DIGITAL_PRODUCT", "AUTOMATION_SERVICE", "RESEARCH_DATA_SERVICE"]);
const INTERNAL_TERMS = [/atlasz/gi, /\b(search|execution)[- ]agents?\b/gi, /\b30[- ]agents?\b/gi, /\borchestrator\b/gi, /\bbrain\b/gi, /\bcapability graph\b/gi, /\bkill ?switch\b/gi, /\bsecret vault\b/gi, /\b[SE]\d{1,2}\b/g, /\bplanning brain\b/gi, /\bblack ?box\b/gi, /\bsafe ?mode\b/gi];
export const sanitizeForCustomer = text => INTERNAL_TERMS.reduce((t, p) => t.replace(p, "our team"), String(text));

export function createBusinessFactory({ file = null, governance = null, publisher = null, now = () => new Date().toISOString() } = {}) {
  let db = {}; if (file && fs.existsSync(file)) { try { db = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("FACTORY_STORE_UNREADABLE"); } }
  const save = () => { if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); const t = file + ".tmp"; fs.writeFileSync(t, JSON.stringify(db)); fs.renameSync(t, file); };
  const G = id => { const s = db[id]; if (!s) throw new Error("UNKNOWN_SERVICE"); return s; };
  /** spec: {name, offerType, description, customerProblem, deliverables[], requiredCapabilities[], steps[], estCostUsd?, estHours?, repeatable, legitimacyVerified} */
  function define(spec = {}) {
    if (!spec.name || !OFFER_TYPES.includes(spec.offerType)) throw new Error("NAME_AND_VALID_OFFER_TYPE_REQUIRED");
    if (spec.legitimacyVerified !== true) throw new Error("LEGITIMACY_MUST_BE_VERIFIED_FIRST");
    if (spec.repeatable !== true) throw new Error("NOT_REPEATABLE_USE_ONE_OFF_DELIVERY");
    const id = "svc-" + crypto.randomUUID().slice(0, 8), steps = spec.steps?.length ? spec.steps : ["Understand request", "Produce deliverable", "Quality review", "Deliver and confirm"];
    const known = x => (Number.isFinite(Number(x)) && x !== null && x !== undefined ? Number(x) : null);
    db[id] = { id, state: "DRAFT", createdAt: now(), name: spec.name, offerType: spec.offerType,
      serviceDefinition: { description: spec.description ?? null, customerProblem: spec.customerProblem ?? null, deliverables: spec.deliverables ?? [] },
      requiredCapabilities: spec.requiredCapabilities ?? [],
      deliveryWorkflow: steps.map((s, i) => ({ step: i + 1, title: s })),
      agentWorkflow: steps.map((s, i) => ({ id: "task-" + (i + 1), title: s, dependsOn: i ? ["task-" + i] : [], capabilities: i === steps.length - 2 ? ["qa"] : spec.requiredCapabilities ?? [] })),
      qaProcess: ["Independent verifier checks every deliverable against the written deliverable list", "No delivery on an unverified result", "Customer-visible issues are corrected before sending"],
      costModel: { estCostUsd: known(spec.estCostUsd), estHours: known(spec.estHours), unknown: [known(spec.estCostUsd) === null && "estCostUsd", known(spec.estHours) === null && "estHours"].filter(Boolean) },
      pricingInputs: { costFloorUsd: known(spec.estCostUsd), price: null, note: "Price is set by JOCI. This module never sets a price." },
      onboarding: ["Confirm scope in writing", "Collect required inputs", "Agree deliverables and timeline"], deliveryChecklist: ["Deliverables match scope", "Independent verification passed", "Customer receives files via approved channel"],
      supportWorkflow: ["Acknowledge request", "Reproduce/triage", "Fix or explain", "Confirm resolution"], metrics: ["on-time delivery rate", "verification pass rate", "cost per delivery", "customer-confirmed completion", "verified revenue"],
      automation: { repeatable: true, note: "Delivery workflow is reusable as a plan template." }, approvals: [] };
    save(); return structuredClone(db[id]);
  }
  const documentation = id => { const s = G(id); return "# " + s.name + "\n\n" + (s.serviceDefinition.description ?? "") + "\n\n## Deliverables\n" + s.serviceDefinition.deliverables.map(d => "- " + d).join("\n") + "\n\n## Process\n" + s.deliveryWorkflow.map(w => w.step + ". " + w.title).join("\n") + "\n"; };
  /** Customer-facing text never exposes internal architecture. */
  const customerFacingDoc = id => sanitizeForCustomer(documentation(id));
  const toPlanSpec = id => { const s = G(id); return { goal: "Deliver service: " + s.name, projects: [{ name: s.name, milestones: [{ name: "Delivery", tasks: s.agentWorkflow }] }] }; };
  /** action: LAUNCH_BUSINESS | PUBLISH | SELL | SIGN_CONTRACT. Returns the governance decision; calls the injected publisher only on ALLOW. */
  async function requestExternal(id, action, ownerApproval = null) {
    const s = G(id); if (!["LAUNCH_BUSINESS", "PUBLISH", "SELL", "SIGN_CONTRACT"].includes(action)) throw new Error("UNSUPPORTED_ACTION");
    if (!governance) return { done: false, decision: "DENY", reason: "GOVERNANCE_REQUIRED" };
    const g = governance.authorize({ brain: "BUSINESS_FACTORY", action, external: true, subject: id, ownerApproval });
    if (!g.allowed) return { done: false, decision: g.decision, reason: g.reason };
    if (typeof publisher !== "function") return { done: false, decision: "ALLOW", reason: "NO_PUBLISHER_CONFIGURED" };
    const r = await publisher({ action, service: id, customerDoc: customerFacingDoc(id) }); s.state = action === "LAUNCH_BUSINESS" ? "LAUNCHED_APPROVED" : s.state; s.approvals.push({ action, at: now() }); save();
    return { done: true, decision: "ALLOW", result: r };
  }
  return { define, documentation, customerFacingDoc, toPlanSpec, requestExternal, get: id => structuredClone(G(id)), list: () => Object.values(db).map(s => ({ id: s.id, name: s.name, state: s.state, offerType: s.offerType })) };
}
