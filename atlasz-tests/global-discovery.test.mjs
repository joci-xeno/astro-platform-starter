// Global discovery engine: catalogue honesty, parsers (fixtures are LABELLED fixtures), assessment, scam indicators, currency, and the owner-approved-host fetch path.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SOURCE_CATALOGUE, REGION_LIST, PARSERS, assessListing, scamIndicators, convertAmount, canonicalUrl, createDiscoveryEngine, toOpportunityInput, inferRequirements } from "../atlasz-addons/global-discovery.mjs";
import { createEgressPolicy, policySubject } from "../atlasz-addons/egress-policy.mjs";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { tmp, rm } from "./helpers.mjs";

const NOW = "2026-10-11T20:00:00.000Z";
const src = id => SOURCE_CATALOGUE.find(s => s.id === id);
test("catalogue: worldwide coverage across every region, honest access facts, nothing connected, blocked sources carry a reason", () => {
  const regions = new Set(SOURCE_CATALOGUE.flatMap(s => s.regions)); for (const r of ["North America", "South America", "Europe", "Asia", "Africa", "Middle East", "Oceania"]) assert.ok(regions.has(r), r);
  assert.ok(SOURCE_CATALOGUE.length >= 15); assert.ok(new Set(SOURCE_CATALOGUE.map(s => s.id)).size === SOURCE_CATALOGUE.length);
  for (const s of SOURCE_CATALOGUE) { assert.ok(Object.isFrozen(s)); if (s.access !== "PUBLIC") assert.ok(s.blockedReason && s.blockedReason.length > 20, s.id); for (const h of s.hosts) assert.match(h, /^[a-z0-9.-]+\.[a-z]+$/); if (s.format) assert.ok(Object.hasOwn(PARSERS, s.format), s.id); }
  assert.equal(src("upwork").access, "TERMS_FORBID_AUTOMATION"); assert.equal(src("linkedin").access, "TERMS_FORBID_AUTOMATION"); assert.equal(src("sam-gov").access, "KEY_REQUIRED");
  const d = tmp("gd-"); try { const e = createDiscoveryEngine({ dir: d }), v = e.sources(); assert.ok(v.every(s => s.genuinelyConnected === false)); assert.ok(v.every(s => s.state !== "READY_APPROVED_HOST")); assert.equal(v.find(s => s.id === "upwork").state, "BLOCKED_TERMS_FORBID_AUTOMATION");
    const cov = e.coverage(); for (const r of REGION_LIST) assert.ok(r in cov); assert.equal(Object.values(cov).reduce((a, c) => a + c.genuinelyConnected, 0), 0); assert.equal(v.find(s => s.id === "etenders-za").state, "NO_ADAPTER"); } finally { rm(d); }
});

test("parsers (FIXTURE data, not live): OCDS, RemoteOK, RSS, HN; hostile XML refused; text stays original", () => {
  const ocds = JSON.stringify({ releases: [{ ocid: "ocds-h6vhtk-0abc12", date: "2026-10-09T10:00:00Z", language: "en", buyer: { name: "Fixture Council" }, tender: { title: "Data migration", description: "The supplier shall migrate CSV records to a new system.", value: { amount: 12000, currency: "GBP" }, tenderPeriod: { endDate: "2026-11-30T12:00:00Z" } } }, { junk: 1 }] });
  const o = PARSERS.OCDS_JSON(src("find-a-tender-uk"), ocds); assert.equal(o.ok, true); assert.equal(o.items.length, 1); assert.equal(o.items[0].currency, "GBP"); assert.equal(o.items[0].valueKind, "BUYER_PUBLISHED_ESTIMATE"); assert.equal(o.items[0].jurisdiction, "GB"); assert.ok(o.items[0].url.startsWith("https://www.find-tender.service.gov.uk/Notice/"));
  const r = PARSERS.REMOTEOK_JSON(src("remoteok"), JSON.stringify([{ legal: "x" }, { id: "1", url: "https://remoteok.com/remote-jobs/a-1", position: "Dev", company: "Acme", tags: ["dev"], date: "2026-10-01T00:00:00Z", salary_min: 1, salary_max: 90000, description: "<p>Build <b>things</b></p>" }])); assert.equal(r.items.length, 1); assert.equal(r.items[0].description, "Build things"); assert.equal(r.items[0].valueKind, "SALARY_RANGE_NOT_PROJECT_VALUE"); assert.equal(r.currencyBasis, "SOURCE_CONVENTION_UNVERIFIED");
  const rss = PARSERS.RSS(src("weworkremotely"), "<rss><channel><item><title>Contract dev</title><link>https://weworkremotely.com/jobs/1</link><description><![CDATA[<p>Freelance <b>API</b> work</p>]]></description><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>"); assert.equal(rss.items[0].description, "Freelance API work");
  assert.equal(PARSERS.RSS(src("weworkremotely"), '<!DOCTYPE x [<!ENTITY a "b">]><rss/>').reason, "XML_DTD_REFUSED"); assert.equal(PARSERS.OCDS_JSON(src("find-a-tender-uk"), "{bad").reason, "PARSE_ERROR");
  assert.equal(PARSERS.ALGOLIA_HN_JSON(src("hn-algolia"), JSON.stringify({ hits: [{ objectID: "123", title: "Freelancer?", created_at: "2026-10-01T00:00:00Z" }] })).items[0].url, "https://news.ycombinator.com/item?id=123");
});

test("assessment: employment and talent networks are not work packages; on-site, expired and scam listings are blocked; geography is never assumed; requirements are keyword-based and say so", () => {
  const a = (o) => assessListing({ title: "", description: "", tags: [], kindHint: "JOB_BOARD", ...o }, NOW);
  assert.ok(a({ title: "Senior Engineer", description: "Full-time role with benefits and 401k" }).hardBlockers.some(b => b.includes("EMPLOYMENT")));
  assert.ok(a({ description: "A marketplace that matches senior developers with startups" }).hardBlockers.some(b => b.includes("TALENT_NETWORK")));
  assert.equal(a({ title: "Freelance API integration", description: "Fixed-price contract to build a REST API integration. Deliverables: code and docs." }).listingKind, "PROJECT_CONTRACT");
  assert.ok(a({ kindHint: "TENDER", title: "Office refit", description: "Construction works on site" }).hardBlockers.includes("PHYSICAL_PRESENCE_INDICATED"));
  assert.ok(a({ kindHint: "TENDER", title: "x tender", description: "Deliver a report", deadline: "2026-10-01T00:00:00Z" }).hardBlockers.includes("DEADLINE_PASSED"));
  const open = a({ kindHint: "TENDER", title: "Data tender", description: "Open to suppliers registered in Sweden. Provide data processing.", deadline: "2026-11-01T00:00:00Z" }); assert.equal(open.deadlineState, "OPEN"); assert.equal(open.internationalEligibility, "UNKNOWN_NOT_ASSUMED"); assert.ok(open.geoRestrictions.length >= 1);
  const scam = scamIndicators("Great freelance job! Pay a small registration fee before you start. We pay with gift cards. Contact me only on WhatsApp."); assert.equal(scam.level, "HIGH"); assert.ok(scam.indicators.includes("UPFRONT_FEE") && scam.indicators.includes("GIFT_CARD_OR_PREPAID"));
  assert.ok(a({ kindHint: "TENDER", title: "t", description: "we pay with gift cards" }).hardBlockers.includes("SCAM_INDICATORS_HIGH")); assert.equal(scamIndicators("Build a website for our bakery.").level, "NONE");
  const req = inferRequirements("Develop a Python API integration and convert CSV data"); assert.deepEqual(req.skills.sort(), ["code.module_with_tests", "data.csv_to_json"]); assert.match(req.basis, /KEYWORD_MATCH/);
});

test("currency: no exchange rate is ever invented; a conversion needs a dated, sourced rate", () => {
  assert.equal(convertAmount(100, "GBP", "USD", []), null); assert.equal(convertAmount(100, "GBP", "USD", [{ from: "GBP", to: "USD", rate: 1.3 }]), null, "no date/source");
  const c = convertAmount(100, "GBP", "USD", [{ from: "GBP", to: "USD", rate: 1.25, asOf: "2026-10-10", source: "owner-supplied rate sheet" }]); assert.equal(c.amount, 125); assert.equal(c.asOf, "2026-10-10"); assert.equal(convertAmount(5, "USD", "USD").amount, 5);
  assert.equal(canonicalUrl("http://insecure.example.com/x"), null); assert.equal(canonicalUrl("https://A.Example.com/x/?utm_source=a&id=2#frag"), "https://a.example.com/x/?id=2");
});

const keys = generateOwnerKeyPair();
function setup() {
  const d = tmp("gd-"), auth = createOwnerAuth({ publicKeyB64: keys.publicKeyB64 }), egress = createEgressPolicy({ ownerAuth: auth, stateDir: path.join(d, "egress") });
  const calls = []; const body = JSON.stringify([{ legal: 1 }, { id: "9", url: "https://remoteok.com/remote-jobs/fixture-9", position: "Freelance API developer", company: "X", tags: ["contract"], date: "2026-10-10T00:00:00Z", description: "<p>Fixed-price contract</p>" }]);
  const transport = { resolveAddresses: async () => ["93.184.216.34"], fetch: async (url, init) => { calls.push({ url, pin: init.pinTo }); return { ok: true, status: 200, text: async () => body }; } };
  let t = 1000; const e = createDiscoveryEngine({ dir: path.join(d, "disc"), egress, transport, clock: () => t, now: () => NOW, minIntervalMs: 10_000 });
  const approve = id => { const p = e.proposedPolicy(src(id)); return egress.setPolicy(p, { ownerApproval: issueOwnerApproval({ privateKeyPem: keys.privateKeyPem, action: "EGRESS_POLICY_SET", subject: policySubject(normalised(p)) }) }); };
  return { d, egress, e, calls, tick: ms => { t += ms; }, approve, auth };
}
import { normaliseEgressPolicy } from "../atlasz-addons/egress-policy.mjs";
const normalised = p => normaliseEgressPolicy(p).policy;
test("fetch path: refused until the OWNER approves the exact host; then one pinned, rate-limited GET; connector counts only after a real run; failures are logged", async () => {
  const t = setup(); try {
    assert.equal(t.e.sourceState("remoteok").state, "NEEDS_OWNER_HOST_APPROVAL"); assert.equal((await t.e.run("remoteok")).reason, "NEEDS_OWNER_HOST_APPROVAL"); assert.equal(t.calls.length, 0, "no request before approval");
    assert.equal((await t.e.run("upwork")).reason, "BLOCKED_TERMS_FORBID_AUTOMATION"); assert.equal((await t.e.run("nope")).reason, "UNKNOWN_SOURCE");
    t.approve("remoteok"); assert.equal(t.e.sourceState("remoteok").state, "READY_APPROVED_HOST");
    assert.equal((await t.e.run("remoteok", { url: "https://evil.example.com/api" })).reason, "URL_NOT_ON_SOURCE_HOST");
    const r = await t.e.run("remoteok", { agentId: "SEARCH-1" }); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.retrieval, "CONNECTOR"); assert.equal(r.items.length, 1); assert.equal(t.calls.length, 1); assert.deepEqual(t.calls[0].pin, ["93.184.216.34"]);
    assert.equal((await t.e.run("remoteok")).reason, "RATE_LIMITED"); t.tick(10_001); assert.equal((await t.e.run("remoteok")).ok, true);
    const v = t.e.sources().find(s => s.id === "remoteok"); assert.equal(v.genuinelyConnected, true); assert.equal(v.runsOk, 2); assert.equal(t.e.sources().filter(s => s.genuinelyConnected).length, 1); assert.equal(t.e.verify().ok, true);
    assert.ok(fs.readdirSync(path.join(t.d, "disc", "captures")).length >= 1);
    const stop = createDiscoveryEngine({ dir: path.join(t.d, "d2"), egress: t.egress, transport: { resolveAddresses: async () => ["93.184.216.34"], fetch: async () => { throw new Error("boom"); } }, isStopped: () => true }); assert.equal((await stop.run("remoteok")).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
  } finally { rm(t.d); }
});
test("fixture parse and operator captures are labelled and never count as a connected source", () => {
  const t = setup(); try {
    const f = t.e.finishParse("remoteok", JSON.stringify([{ id: "1", url: "https://remoteok.com/remote-jobs/f-1", position: "P", tags: [] }]), { retrieval: "FIXTURE", agentId: "TEST", target: null }); assert.equal(f.ok, true); assert.equal(f.retrieval, "FIXTURE"); assert.equal(t.e.sources().find(s => s.id === "remoteok").genuinelyConnected, false);
    const c = t.e.importOperatorCapture({ sourceId: "remoteok", items: [{ url: "https://remoteok.com/remote-jobs/x-2", title: "T", description: "d" }], tool: "WebFetch", retrievedAt: "2026-10-11T19:00:00Z", note: "demo" }); assert.equal(c.retrieval, "OPERATOR_TOOL"); assert.equal(t.e.sources().find(s => s.id === "remoteok").genuinelyConnected, false);
    assert.equal(t.e.importOperatorCapture({ sourceId: "remoteok", items: [{ url: "https://other.example.com/x", title: "T" }], tool: "x", retrievedAt: "2026-10-11T19:00:00Z" }).reason, "URL_NOT_ON_SOURCE_HOST");
    assert.equal(t.e.importOperatorCapture({ sourceId: "remoteok", items: [{ url: "https://remoteok.com/a", title: "T" }], tool: "", retrievedAt: "bad" }).reason, "PROVENANCE_REQUIRED");
    assert.equal(toOpportunityInput({ sourceId: "remoteok", url: "http://x/a", title: "t" }, { retrieval: "FIXTURE" }).reason, "URL_INVALID_OR_NOT_HTTPS");
  } finally { rm(t.d); }
});

test("hardening: hostile markup is linear-time; malformed rows do not throw; userinfo/port URLs are refused; empty runs are not 'connected'; evidence hashes are looked up", async () => {
  const t0 = Date.now();
  const rss = PARSERS.RSS({ id: "x", languages: ["en"], kind: "TENDER", jurisdiction: "GLOBAL" }, "<item ".repeat(40000)); assert.ok(Date.now() - t0 < 1500, "RSS scan must be linear");
  assert.equal(rss.ok, true);
  const t1 = Date.now(); const ro = PARSERS.REMOTEOK_JSON({ id: "remoteok", languages: ["en"], kind: "JOB_BOARD", jurisdiction: "GLOBAL" }, JSON.stringify([{}, { position: "Dev", url: "https://remoteok.com/remote-jobs/1", description: "<script ".repeat(40000), tags: "x" }])); assert.ok(Date.now() - t1 < 1500, "tag stripping must be linear"); assert.equal(ro.ok, true);
  assert.equal(canonicalUrl("https://a@remoteok.com/x"), null); assert.equal(canonicalUrl("https://remoteok.com:9/x"), null);
  const d = (await import("../atlasz-tests/helpers.mjs")).tmp("gdh-"); try {
    const e = createDiscoveryEngine({ dir: d }); const c = e.importOperatorCapture({ sourceId: "remoteok", items: [{ url: "https://remoteok.com/remote-jobs/9", title: "Dev", description: "Build an API integration for a client project." }], tool: "t", retrievedAt: "2026-10-11T19:00:00Z" });
    assert.equal(c.ok, true); assert.equal(e.hasEvidence(c.evidenceSha256, "OPERATOR_TOOL"), true); assert.equal(e.hasEvidence(c.evidenceSha256, "CONNECTOR"), false); assert.equal(e.hasEvidence("a".repeat(64), "OPERATOR_TOOL"), false);
  } finally { (await import("../atlasz-tests/helpers.mjs")).rm(d); }
});
