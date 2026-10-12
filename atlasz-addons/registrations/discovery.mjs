// Registrations: global discovery building blocks. The hosted source allowlist is DENY BY DEFAULT (empty until the owner signs a source and its country); the adapters in this repository are
// reference/fixture formats, so nothing here fetches from the network or reports a real portal as connected. Network access is a separate, owner-approved step (host approvals).
import { ANY, str, num, int, bool, arr, obj, cap, POLICY } from "./_util.mjs";
import { analyzeMarketSignals, proposeSearchStrategy } from "../market-intelligence-engine.mjs";
import { buildBuyerQuery, normalizeContact, rankContacts, contactReady } from "../buyer-decision-maker-finder.mjs";
import { evaluateEligibility, VERDICTS } from "../eligibility-model.mjs";
import { defineAdapter, procurementJsonAdapter, grantRssAdapter, freelanceHtmlAdapter, validateRecord, toSearchCandidate, KINDS } from "../source-adapters.mjs";

const plain = x => JSON.parse(JSON.stringify(x ?? null));
const ADAPTERS = { "procurement-json": procurementJsonAdapter, "grant-rss": grantRssAdapter, "freelance-html": freelanceHtmlAdapter };

export function registerDiscovery(broker, ctx) {
  broker.register({ id: "source-allowlist", source: "atlasz-addons/source-allowlist.mjs", manager: "SEARCH_AGENT_MANAGER", lifecycle: "CONTINUOUS", policy: POLICY.external,
    purpose: "Deny-by-default allowlist of external discovery sources (host, path prefix, port 443, country, rate limit, credential reference), changed only by signed owner approvals recorded in a hash-chained log. Exposed read-only plus a dry-run URL check; allowing a source or country is an owner action and is NOT exposed.",
    capabilities: [
      cap("summary", "READ_STATUS", () => plain(ctx.sourceAllowlist().summary())),
      cap("list", "READ_STATUS", () => ({ sources: plain(ctx.sourceAllowlist().list().map(e => ({ sourceId: e.sourceId, hosts: e.hosts, country: e.country, category: e.category, effective: e.effective }))), countries: ctx.sourceAllowlist().countries() })),
      cap("dry_check", "READ_STATUS", a => plain(ctx.sourceAllowlist().check(a.sourceId, a.url, { consume: false })), { input: obj({ sourceId: str({ maxLength: 48 }), url: str({ maxLength: 2048 }) }, ["sourceId", "url"]), description: "Would this fetch be allowed? No rate-limit slot is used." })
    ],
    selfTest: { capability: "dry_check", args: { sourceId: "selftest-unlisted", url: "https://example.invalid/x" }, expect: r => (r.allowed === false ? true : "an unlisted source must be denied") } });
  broker.register({ id: "source-adapters", source: "atlasz-addons/source-adapters.mjs", manager: "SEARCH_AGENT_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Source adapter framework: parses raw notices/feeds/listings into strictly validated records with provenance and explicit unknown fields (a missing amount is never 0). `normalize` is pure; the network `ingest` path takes an injected fetch and the allowlist and is used by the discovery service, never by a tool caller. The reference adapters parse synthetic fixture formats, not real portals.",
    capabilities: [
      cap("normalize", "INTERNAL_COMPUTE", a => { const mk = ADAPTERS[a.format]; if (!mk) throw new Error("UNKNOWN_FORMAT"); const ad = mk({ sourceId: a.sourceId, baseUrl: "https://invalid.example" }); const rawRecords = ad.parse(a.raw); const out = [], rejected = [];
        for (const r of rawRecords.slice(0, 500)) { const v = validateRecord(r, { kind: ad.kind, sourceId: a.sourceId }); if (v.ok === false || v.error) rejected.push(v.reason ?? v.error ?? "INVALID"); else out.push(v.record ?? v); }
        return plain({ kind: ad.kind, accepted: out.length, rejected: rejected.length, records: out.slice(0, 50), dataOrigin: "FIXTURE_FORMAT_NOT_A_REAL_SOURCE" }); },
        { input: obj({ format: { type: "string", enum: Object.keys(ADAPTERS) }, sourceId: str({ maxLength: 48 }), raw: str({ maxLength: 2000000 }) }, ["format", "sourceId", "raw"]) }),
      cap("kinds", "READ_STATUS", () => ({ kinds: [...KINDS], formats: Object.keys(ADAPTERS) }))
    ],
    selfTest: { capability: "kinds", expect: r => (r.kinds.length === 3 ? true : "kinds") } });
  broker.register({ id: "eligibility-model", source: "atlasz-addons/eligibility-model.mjs", manager: "GLOBAL_BUSINESS_INTELLIGENCE", lifecycle: "ON_DEMAND", policy: POLICY.draft,
    purpose: "Eligibility evaluator (presence, licences, insurance, registrations, languages, currency, company age, deadline; unknown stays UNKNOWN; cross-border = legal review). `evaluate` uses ONLY the owner-approved capability profile (none exists yet, so the verdict is UNKNOWN_NEEDS_REVIEW). `evaluate_with_profile` is for the owner/Brain with an explicit profile and is not agent-callable.",
    capabilities: [
      cap("evaluate", "INTERNAL_COMPUTE", a => plain(ctx.capabilityProfiles().evaluate(a.opportunity)), { input: obj({ opportunity: ANY }, ["opportunity"]) }),
      cap("evaluate_with_profile", "INTERNAL_COMPUTE", a => plain(evaluateEligibility(a.opportunity, a.profile)), { input: obj({ opportunity: ANY, profile: ANY }, ["opportunity", "profile"]) }),
      cap("profile_state", "READ_STATUS", () => { const c = ctx.capabilityProfiles().current(); return { hasProfile: !!c.profile, integrity: c.integrity }; })
    ],
    selfTest: { capability: "evaluate", args: { opportunity: { title: "x" } }, expect: r => (VERDICTS.includes(r.verdict) && r.verdict !== "ELIGIBLE" ? true : "without an owner-approved profile the verdict must not be ELIGIBLE") } });
  broker.register({ id: "market-intelligence-engine", source: "atlasz-addons/market-intelligence-engine.mjs", manager: "GLOBAL_BUSINESS_INTELLIGENCE", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Evidence-first market signal analysis: only signals with source, observation time and strength count; with none, the result is NO_EVIDENCE and no strategy change is proposed. Forecasts are hypotheses.",
    capabilities: [
      cap("analyze", "INTERNAL_COMPUTE", a => plain(analyzeMarketSignals({ signals: a.signals })), { input: obj({ signals: arr(obj({ source: str({ maxLength: 120 }), observedAt: str({ maxLength: 40 }), strength: num(), topic: str({ maxLength: 80 }) }, [], true)) }, ["signals"]) }),
      cap("propose_strategy", "INTERNAL_COMPUTE", a => plain(proposeSearchStrategy({ analysis: a.analysis, currentStrategy: a.currentStrategy ?? {} })), { input: obj({ analysis: ANY, currentStrategy: ANY }, ["analysis"]) })
    ],
    selfTest: { capability: "analyze", args: { signals: [] }, expect: r => (r.status === "NO_EVIDENCE" ? true : "no signals = no evidence") } });
  broker.register({ id: "buyer-decision-maker-finder", source: "atlasz-addons/buyer-decision-maker-finder.mjs", manager: "GLOBAL_BUSINESS_INTELLIGENCE", lifecycle: "ON_DEMAND", policy: POLICY.draft,
    purpose: "Builds buyer-lookup queries and ranks supplied business contacts (business contact + named source required; verified first; ready only at confidence >= 0.6 with an email). It performs no lookup and contacts no one.",
    capabilities: [
      cap("build_query", "INTERNAL_COMPUTE", a => plain(buildBuyerQuery(a)), { input: obj({ company: str({ maxLength: 200 }), domain: str({ maxLength: 200 }), need: str({ maxLength: 400 }), roles: arr(str({ maxLength: 60 })) }) }),
      cap("rank", "INTERNAL_COMPUTE", a => ({ contacts: plain(rankContacts(a.contacts.map(normalizeContact)).map(c => ({ ...c, ready: contactReady(c) }))) }), { input: obj({ contacts: arr(ANY) }, ["contacts"]) })
    ],
    selfTest: { capability: "rank", args: { contacts: [{ name: "n", email: "a@b.c", source: "s", businessContact: true, confidence: 0.9 }, { name: "x", email: "x@y.z", businessContact: false, source: "s" }] }, expect: r => (r.contacts.length === 1 && r.contacts[0].ready === true ? true : "only the business contact is ranked") } });
}
