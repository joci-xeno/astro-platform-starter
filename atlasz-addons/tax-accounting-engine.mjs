/**
 * ATLASZ Universal Tax & Accounting Engine
 * Additive starter module. No filing, payment, bank action, or secret handling.
 * Deterministic/versioned rules are required before any jurisdiction is production-ready.
 */

export const TAX_CAPABILITY = Object.freeze({
  id: "tax-accounting",
  version: "0.1.0",
  modes: ["prepare","calculate","reconcile","validate","review"],
  jurisdictions: ["CA","CA-BC"],
  requiresOwnerApproval: ["file-return","submit-return","tax-payment","bank-payment","account-change","legal-certification"],
});

export const TAX_STATES = Object.freeze({
  READY_FOR_OWNER_REVIEW: "READY_FOR_OWNER_REVIEW",
  OWNER_APPROVAL_REQUIRED: "OWNER_APPROVAL_REQUIRED",
  BLOCKED_TAX_RULE_UNVERIFIED: "BLOCKED_TAX_RULE_UNVERIFIED",
  BLOCKED_MISSING_TAX_JURISDICTION: "BLOCKED_MISSING_TAX_JURISDICTION",
  BLOCKED_MISSING_DOCUMENTS: "BLOCKED_MISSING_DOCUMENTS",
});

const CANADA_WORKFLOWS = Object.freeze({
  T1: ["ingest","classify","reconcile","calculate","validate","qa","owner-review"],
  T2: ["ingest","corporate-reconcile","calculate","validate","qa","owner-review"],
  GST_HST: ["ingest","sales-tax-reconcile","itc-reconcile","calculate","validate","qa","owner-review"],
  BC_PST: ["ingest","bc-pst-reconcile","calculate","validate","qa","owner-review"],
  PAYROLL: ["ingest","payroll-reconcile","cpp-ei-deductions","validate","qa","owner-review"],
  T4: ["ingest","payroll-reconcile","prepare-slip-data","validate","qa","owner-review"],
  T4A: ["ingest","classify-payments","prepare-slip-data","validate","qa","owner-review"],
  T5: ["ingest","investment-income-reconcile","prepare-slip-data","validate","qa","owner-review"],
});

export class TaxAccountingEngine {
  constructor({ ruleStore, sourceVerifier, calculator, qa, audit, now = () => new Date().toISOString() } = {}) {
    this.ruleStore = ruleStore;
    this.sourceVerifier = sourceVerifier;
    this.calculator = calculator;
    this.qa = qa;
    this.audit = audit;
    this.now = now;
  }

  capability() { return TAX_CAPABILITY; }

  async plan({ country, region, taxType, taxYear }) {
    const jurisdiction = region ? `${country}-${region}` : country;
    if (!["CA","CA-BC"].includes(jurisdiction)) {
      return { status: TAX_STATES.BLOCKED_MISSING_TAX_JURISDICTION, jurisdiction, taxType, taxYear };
    }
    const workflow = CANADA_WORKFLOWS[taxType];
    if (!workflow) return { status: TAX_STATES.BLOCKED_MISSING_TAX_JURISDICTION, jurisdiction, taxType, taxYear };

    const rules = await this.ruleStore?.get?.({ jurisdiction, taxType, taxYear });
    const verified = rules && await this.sourceVerifier?.verify?.(rules);
    if (!verified) {
      return { status: TAX_STATES.BLOCKED_TAX_RULE_UNVERIFIED, jurisdiction, taxType, taxYear,
        requiredAuthority: jurisdiction === "CA-BC" ? ["CRA/Canada.ca","Government of British Columbia"] : ["CRA/Canada.ca"] };
    }
    return { status: "PLANNED", jurisdiction, taxType, taxYear, workflow, rulesVersion: rules.version };
  }

  async prepare(input) {
    const plan = await this.plan(input);
    if (plan.status !== "PLANNED") return plan;
    const records = input.records ?? [];
    if (!records.length) return { ...plan, status: TAX_STATES.BLOCKED_MISSING_DOCUMENTS };

    // Arithmetic must be deterministic. An LLM must not invent tax totals.
    if (!this.calculator?.calculate) throw new Error("Deterministic tax calculator is not configured");
    const calculation = await this.calculator.calculate({ plan, records });
    const qaResult = await this.qa?.review?.({ plan, records, calculation });
    await this.audit?.append?.({ at: this.now(), event: "TAX_PACKAGE_PREPARED", jurisdiction: plan.jurisdiction,
      taxType: plan.taxType, taxYear: plan.taxYear, rulesVersion: plan.rulesVersion });

    return { ...plan, status: TAX_STATES.READY_FOR_OWNER_REVIEW, calculation, qa: qaResult ?? null };
  }

  authorizeExternalAction(action, ownerApproved = false) {
    if (TAX_CAPABILITY.requiresOwnerApproval.includes(action) && !ownerApproved) {
      return { status: TAX_STATES.OWNER_APPROVAL_REQUIRED, action };
    }
    return { status: "AUTHORIZED", action };
  }
}

export function taxIntentHint(text = "") {
  const s = String(text).toLowerCase();
  return /\b(tax|adó|gst|hst|pst|t1|t2|t4|t4a|t5|payroll|cpp|ei|cra)\b/.test(s);
}
