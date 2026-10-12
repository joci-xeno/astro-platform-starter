// Lead qualification (shared): used by the runtime supervisor AND the Control Center-hosted Money Engine. Pure, deterministic, no network. Extracted from supervisor-safe.mjs unchanged.
const clean = x => String(x || "").replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const topics = ["website", "automation", "data", "translation", "video", "spreadsheet", "API", "research", "design", "testing"];
export function qualify(candidate) {
  const text = clean(candidate.title + " " + candidate.description);
  const age = Date.now() - Date.parse(candidate.published);
  const reject = [];
  if (!Number.isFinite(age) || age > 30 * 86400000 || age < -86400000) reject.push("STALE_OR_UNDATED");
  if (/\b(seeking work|available for hire|for hire|my portfolio)\b/i.test(text)) reject.push("SELLER_NOT_BUYER");
  if (/\b(full[- ]time|permanent role|salary|equity|employee benefits|on[- ]site|relocat|chief .*officer|head of)\b/i.test(text)) reject.push("EMPLOYMENT_OR_OFFLINE");
  const buyer = /\b(looking for|need(?:ed)?|seeking|hiring|request for|help wanted)\b/i.test(text);
  const project = /\b(project|freelance|contractor|deliverable|one[- ]off|fixed[- ]price|gig)\b/i.test(text);
  const skill = topics.find(t => new RegExp("\\b" + t + "\\b", "i").test(text)) || (/\b(developer|coding|programming)\b/i.test(text) ? "software" : null);
  if (!buyer || !project || !skill) reject.push("NO_CLEAR_DIGITAL_PROJECT_REQUEST");
  if (/pay to apply|membership fee|buy credits|upfront fee|crypto deposit|wire.*deposit/i.test(text)) reject.push("UPFRONT_COST_OR_SCAM_SIGNAL");
  const budget = text.match(/(?:USD\s*|\$)\s*(\d[\d,]*(?:\.\d{1,2})?)/i);
  const emails = [...new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])];
  const remote = /\b(remote|worldwide|anywhere|online)\b/i.test(text);
  return {
    reject, skill, emails,
    leadValue: budget ? { amount: Number(budget[1].replaceAll(",", "")), currency: /\bUSD\b/.test(text) ? "USD" : "UNSPECIFIED_DOLLAR", evidence: budget[0] } : null,
    checks: {
      digitallyRelevant: Boolean(skill), remoteExplicit: remote, requiredCredentials: "UNVERIFIED",
      offlineExcludedByText: !reject.includes("EMPLOYMENT_OR_OFFLINE"),
      noFalseReferencesRequired: "UNVERIFIED", noUpfrontCostSignal: !reject.includes("UPFRONT_COST_OR_SCAM_SIGNAL"),
      deliverable: "REQUIRES_BRIEF_REVIEW", paymentRoute: "UNVERIFIED",
      contactRoute: emails.length ? "PUBLISHED_EMAIL_REQUIRES_REVIEW" : "SOURCE_PAGE_REQUIRES_REVIEW",
      buyerAuthenticity: "UNVERIFIED"
    },
    score: reject.length ? 0 : 20 + (remote ? 10 : 0) + (emails.length ? 10 : 0) + (budget ? 10 : 0) + (/urgent|asap|this week/i.test(text) ? 5 : 0)
  };
}
