// Phase E 8.2: contract REVIEW. A deterministic, lexical screen of contract text that flags clauses the owner must read and decide on. It never accepts, signs, negotiates or sends anything,
// it is not legal advice, and the contract text is UNTRUSTED data (embedded instructions are ignored and flagged). A clause that is not found is reported as NOT_FOUND (unknown), never as "fine".
import { createHash } from "node:crypto";
import { INJECTION_PATTERNS } from "../text-compare.mjs";
import { containsSecret, scrub } from "../secret-patterns.mjs";

export const MAX_CONTRACT_CHARS = 200_000;
const RULES = [
  { id: "PAYMENT_TERMS", label: "Payment terms", find: /\b(net\s*\d{1,3}|payable within|due (?:within|upon)|payment (?:terms|schedule)|invoice[sd]? (?:will be )?paid|milestone payment|upfront|advance payment|retainer)\b/i, note: "Check amount, currency, due date and who bears fees." },
  { id: "PAYMENT_ON_ACCEPTANCE_ONLY", label: "Payment only after client acceptance", find: /\b(payment (?:is )?(?:conditional|contingent)|(?:paid|payable) (?:only )?(?:after|upon) (?:final )?(?:acceptance|approval|satisfaction)|sole discretion.{0,40}(?:accept|approv|pay))/i, level: "HIGH", note: "Payment may depend on the client's discretion." },
  { id: "UNPAID_WORK", label: "Unpaid trial / spec / exposure work", find: /\b(unpaid (?:trial|test|work|sample)|free (?:sample|trial|of charge)|work on spec|speculative work|exposure)\b/i, level: "HIGH", note: "ATLASZ does not do unpaid work without an owner decision." },
  { id: "IP_ASSIGNMENT", label: "Intellectual property assignment / work for hire", find: /\b(work[- ]made[- ]for[- ]hire|work for hire|assign(?:s|ment)? (?:all )?(?:right|title|intellectual)|intellectual property (?:rights )?(?:shall )?(?:belong|vest)|moral rights waiver)\b/i, level: "MEDIUM", note: "Who owns the deliverable and any reusable tooling or prior work?" },
  { id: "LIABILITY_UNLIMITED", label: "Unlimited or uncapped liability / indemnity", find: /\b(unlimited liability|without limit(?:ation)?|uncapped|indemnif(?:y|ies|ication)|hold harmless|consequential damages)\b/i, level: "HIGH", note: "Liability exposure must be capped and understood before any acceptance." },
  { id: "LIABILITY_CAP", label: "Liability cap present", find: /\b(liability (?:shall |is )?(?:be )?(?:limited|capped)|aggregate liability|cap on liability|limitation of liability)\b/i, level: "INFO", note: "A cap exists; verify its amount." },
  { id: "NON_COMPETE_EXCLUSIVITY", label: "Non-compete / exclusivity", find: /\b(non[- ]?compete|exclusiv(?:e|ity)|shall not (?:work|provide services) for (?:any )?(?:other|competing))\b/i, level: "HIGH", note: "Could restrict other work." },
  { id: "CONFIDENTIALITY", label: "Confidentiality / NDA", find: /\b(confidential(?:ity)?|non[- ]disclosure|NDA)\b/i, level: "INFO", note: "Check duration and carve-outs." },
  { id: "TERMINATION", label: "Termination", find: /\b(terminat(?:e|ion)|cancel(?:lation)? (?:of|the) (?:agreement|contract))\b/i, level: "INFO", note: "Check notice period and payment for work done." },
  { id: "PENALTIES", label: "Penalties / liquidated damages", find: /\b(penalt(?:y|ies)|liquidated damages|late (?:delivery )?fee|forfeit)\b/i, level: "HIGH", note: "Deadline failure may be costly." },
  { id: "DEADLINE", label: "Delivery deadline", find: /\b(deadline|due date|delivery date|no later than|within \d+ (?:days|weeks|business days))\b/i, level: "INFO", note: "Compare against realistic capacity." },
  { id: "ACCEPTANCE_CRITERIA", label: "Acceptance criteria", find: /\b(acceptance (?:criteria|test|period)|deemed accepted|specifications? (?:set out|attached))\b/i, level: "INFO", note: "Vague acceptance criteria make payment disputes likely." },
  { id: "GOVERNING_LAW", label: "Governing law / jurisdiction", find: /\b(governing law|governed by the laws|jurisdiction of|exclusive jurisdiction|arbitration|venue)\b/i, level: "MEDIUM", note: "Dispute location and law are legal matters for the owner / a professional." },
  { id: "AUTO_RENEWAL", label: "Automatic renewal", find: /\b(auto(?:matic(?:ally)?)?[- ]renew|renews? automatically|evergreen)\b/i, level: "MEDIUM", note: "Creates a continuing obligation." },
  { id: "PERSONAL_DATA", label: "Personal data processing", find: /\b(personal data|GDPR|data processing agreement|DPA|PIPEDA|CCPA)\b/i, level: "MEDIUM", note: "Compliance duties; needs a professional if applicable." },
  { id: "PHYSICAL_OR_LICENSED", label: "On-site presence or licensed profession", find: /\b(on[- ]site|in person|physical presence|licensed (?:professional|engineer|attorney|accountant)|security clearance)\b/i, level: "HIGH", note: "ATLASZ delivers remote digital work only." },
  { id: "CRYPTO_PAYMENT", label: "Payment in cryptocurrency / tokens", find: /\b(paid in (?:crypto|tokens?|usdt|usdc|btc|eth)|crypto(?:currency)? payment|stablecoin|token (?:grant|allocation)|equity (?:in lieu|instead))\b/i, level: "HIGH", note: "Compliance review required; token or equity payment is not verified revenue." },
  { id: "UPFRONT_FEE_FROM_US", label: "Fee payable by the contractor", find: /\b(registration fee|deposit (?:from|by) (?:the )?contractor|pay (?:a )?(?:fee|deposit) (?:to|before)|purchase (?:equipment|software) (?:from|through))\b/i, level: "HIGH", note: "Scam indicator or spending that needs owner approval." }
];
const LEVEL_RANK = { INFO: 0, MEDIUM: 1, HIGH: 2 };
const sentenceAround = (text, m) => { const a = Math.max(0, text.lastIndexOf(".", m.index) + 1), e = text.indexOf(".", m.index + m[0].length), b = e < 0 ? Math.min(text.length, m.index + 240) : e + 1; return text.slice(a, Math.min(b, a + 300)).replace(/\s+/g, " ").trim(); };

/** reviewContract({text, title, opportunityId}) -> findings + overall level. Pure and deterministic. */
export function reviewContract({ text, title = null, opportunityId = null, now = () => new Date().toISOString() } = {}) {
  if (typeof text !== "string" || text.trim().length < 40) return { ok: false, reason: "CONTRACT_TEXT_REQUIRED" };
  if (text.length > MAX_CONTRACT_CHARS) return { ok: false, reason: "CONTRACT_TOO_LARGE" };
  const secret = containsSecret(text), body = secret ? scrub(text) : text;
  const injection = INJECTION_PATTERNS.some(p => p.test(body));
  const findings = [], notFound = [];
  for (const r of RULES) {
    const m = r.find.exec(body);
    if (!m) { notFound.push({ id: r.id, label: r.label, status: "NOT_FOUND_UNKNOWN", note: "Not detected by the lexical screen; absence is NOT confirmation that it is fine." }); continue; }
    findings.push({ id: r.id, label: r.label, level: r.level ?? "INFO", excerpt: sentenceAround(body, m), note: r.note });
  }
  if (injection) findings.push({ id: "EMBEDDED_INSTRUCTIONS_IGNORED", label: "Text addressed to an AI / instruction-like content", level: "HIGH", excerpt: null, note: "The document contains instruction-like text. It was treated as data and had no effect." });
  const top = findings.reduce((m, f) => Math.max(m, LEVEL_RANK[f.level]), 0), overall = ["INFO", "MEDIUM", "HIGH"][top];
  return { ok: true, review: {
    reviewId: "cr-" + createHash("sha256").update(body).digest("hex").slice(0, 16), opportunityId, title, at: now(), contractSha256: createHash("sha256").update(body).digest("hex"), chars: body.length,
    overallRisk: overall, findings, notDetected: notFound, secretLikeTextRedacted: secret,
    recommendation: overall === "HIGH" ? "DO_NOT_ACCEPT_WITHOUT_OWNER_AND_PROFESSIONAL_REVIEW" : "OWNER_MUST_READ_FULL_CONTRACT_BEFORE_ANY_ACCEPTANCE",
    ownerDecisionRequired: true, accepted: false, signed: false, sent: false,
    disclaimer: "Automated lexical screen only. Not legal advice. ATLASZ never accepts, signs or negotiates a contract; acceptance is a separate signed owner approval." } };
}
