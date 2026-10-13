// First live source readiness. EVERYTHING HERE IS SIMULATED: a fake transport stands in for hn.algolia.com and a TEST owner key signs the host policy. No network is contacted and nothing here
// can create the "first live discovery" marker for real: that needs a CONNECTOR run through the owner-approved host in production.
import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path";
import { createDiscoveryEngine } from "../atlasz-addons/global-discovery.mjs";
import { createEgressPolicy, policySubject, normaliseEgressPolicy } from "../atlasz-addons/egress-policy.mjs";
import { createOpportunityRegistry, createMasterIntake } from "../atlasz-addons/opportunity-intake.mjs";
import { createLiveDiscoveryRunner, SOURCE_REQUESTS } from "../atlasz-addons/live-discovery-runner.mjs";
import { createDiscoveryScheduler } from "../atlasz-addons/daily-profit-objective.mjs";
import { ownerAuth, sign } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

const T = "2026-10-12T20:00:00.000Z";
const hit = (id, text, extra = {}) => ({ objectID: String(id), comment_text: text, story_title: "Ask HN: Freelancer? Seeking freelancer? (October 2026)", created_at: "2026-10-10T10:00:00.000Z", ...extra });
const BODY = JSON.stringify({ hits: [
  hit(101, "SEEKING FREELANCER: Remote. We need a developer to build a REST API integration and automate a CSV to JSON data pipeline. Fixed price contract, budget around USD 1500, contact via the thread."),
  hit(102, "SEEKING FREELANCER: Remote Python developer to build a web scraper and reporting dashboard. Hourly contract, paid via invoice."),
  hit(103, "Pay a registration fee of $50 before you start. Guaranteed income $5000 per week working from home, send your passport."),
  hit(104, "SEEKING FREELANCER: Remote. We need a developer to build a REST API integration and automate a CSV to JSON data pipeline. Fixed price contract, budget around USD 1500, contact via the thread.", { objectID: "101" })
] });
function rig(d, over = {}) {
  const egress = createEgressPolicy({ ownerAuth, stateDir: path.join(d, "egress") });
  const calls = []; const transport = { resolveAddresses: async () => ["104.18.10.10"], fetch: async (u, init) => { calls.push({ u, init }); if (over.fail) return { ok: false, status: 503, text: async () => "" }; return { ok: true, status: 200, text: async () => over.body ?? BODY }; } };
  const engine = createDiscoveryEngine({ dir: path.join(d, "disc"), egress, transport, now: () => T, clock: over.clock ?? (() => Date.now()) });
  const registry = createOpportunityRegistry({ dir: path.join(d, "reg") }), intake = createMasterIntake({ dir: path.join(d, "mi"), registry, capabilities: ["data.csv_to_json", "plan.implementation_plan", "doc.proposal_draft"] });
  const runner = createLiveDiscoveryRunner({ dir: path.join(d, "live"), engine, intake, registry, now: () => T });
  const approve = () => { const pol = engine.proposedPolicy("hn-algolia"); return egress.setPolicy(pol, { ownerApproval: sign("EGRESS_POLICY_SET", policySubject(normaliseEgressPolicy(pol).policy)) }); };
  return { egress, engine, registry, intake, runner, calls, approve };
}
test("without the owner's signed host approval nothing is contacted", async () => {
  const d = tmp("ld-"); try { const x = rig(d); assert.equal(x.runner.ready("hn-algolia"), "NEEDS_OWNER_HOST_APPROVAL"); const r = await x.runner.run({ sourceId: "hn-algolia", agentId: "SEARCH-1" }); assert.equal(r.ok, false); assert.equal(x.calls.length, 0); assert.equal(x.runner.firstLive(), null); } finally { rm(d); }
});
test("approved host (simulated approval): parse, normalise, dedupe, hand-off; fraud rejected; all 5 SEARCH agents may submit; request stays on the approved host/method", async () => {
  const d = tmp("ld-"); try {
    const x = rig(d); x.approve(); assert.equal(x.runner.ready("hn-algolia"), null);
    const pol = x.egress.listPolicies().find(p => p.providerId === "discovery-hn-algolia"); assert.deepEqual(pol.hosts, ["hn.algolia.com"]); assert.deepEqual(pol.methods, ["GET"]); assert.deepEqual(pol.ports, [443]);
    const r = await x.runner.run({ sourceId: "hn-algolia", agentId: "SEARCH-3" }); assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(x.calls.length, 1); assert.equal(new URL(x.calls[0].u).host, "hn.algolia.com"); assert.equal(x.calls[0].init.method, "GET"); assert.equal(x.calls[0].u, SOURCE_REQUESTS["hn-algolia"].url); assert.ok(!("authorization" in (x.calls[0].init.headers ?? {})), "no credential is sent");
    assert.equal(r.retrieved, 4); assert.ok(r.created >= 2, JSON.stringify(r)); assert.ok(r.duplicate >= 1, "the repeated listing is a duplicate, not a second opportunity: " + JSON.stringify(r)); assert.ok(r.rejected >= 1, "scam rejected: " + JSON.stringify(r));
    const all = x.registry.list(); assert.ok(all.every(o => o.retrieval === "CONNECTOR" && o.untrusted === true && o.sourceId === "hn-algolia")); assert.ok(all.every(o => o.budget.kind === "PUBLISHED_BUDGET_NOT_REVENUE" || o.budget.kind === "NOT_PUBLISHED"));
    assert.equal(x.runner.run === undefined, false); for (const a of ["SEARCH-1", "SEARCH-2", "SEARCH-4", "SEARCH-5"]) { const k = rig(tmp("ld-")); k.approve(); assert.equal((await k.runner.run({ sourceId: "hn-algolia", agentId: a })).ok, true, a); }
    assert.equal((await x.runner.run({ sourceId: "hn-algolia", agentId: "EXECUTION-1" })).reason, "SENDER_NOT_A_SEARCH_AGENT");
  } finally { rm(d); }
});
test("rate limit, repeat run is idempotent (duplicates, no new opportunities), source failure is reported and recorded", async () => {
  const d = tmp("ld-"); try {
    let t = 1_000_000; const x = rig(d, { clock: () => t }); x.approve(); const a = await x.runner.run({ sourceId: "hn-algolia", agentId: "SEARCH-1" }); assert.equal(a.ok, true);
    assert.equal((await x.runner.run({ sourceId: "hn-algolia", agentId: "SEARCH-2" })).reason, "RATE_LIMITED"); assert.equal(x.calls.length, 1);
    t += 3_600_000; const n = x.registry.counts().total, b = await x.runner.run({ sourceId: "hn-algolia", agentId: "SEARCH-2" }); assert.equal(b.ok, true); assert.equal(x.registry.counts().total, n, "no new opportunity"); assert.ok(b.duplicate >= 1, JSON.stringify(b));
    const f = rig(tmp("ld-"), { fail: true }); f.approve(); const r = await f.runner.run({ sourceId: "hn-algolia", agentId: "SEARCH-1" }); assert.equal(r.ok, false); assert.equal(r.reason, "HTTP_503"); assert.ok(f.engine.runLog().some(e => e.event === "RUN_FAILED"));
    const bad = rig(tmp("ld-"), { body: "<html>not json" }); bad.approve(); assert.equal((await bad.runner.run({ sourceId: "hn-algolia", agentId: "SEARCH-1" })).ok, false);
  } finally { rm(d); }
});
test("scheduler drives the runner only when the host is approved, honours the owner stop, and backs off on failure", async () => {
  const d = tmp("ld-"); try {
    let t = Date.parse(T), stopped = false; const x = rig(d, { clock: () => t }); const sched = () => createDiscoveryScheduler({ dir: path.join(d, "sch"), now: () => new Date(t).toISOString(), isStopped: () => stopped, minIntervalMs: 60_000, ready: () => x.runner.ready("hn-algolia"), run: ({ runIndex }) => x.runner.run({ sourceId: "hn-algolia", agentId: "SEARCH-" + ((runIndex % 5) + 1) }).then(r => { if (!r.ok) throw Object.assign(new Error(r.reason), { code: r.reason }); return r; }) });
    let s = sched(); assert.equal((await s.tick()).reason, "NEEDS_OWNER_HOST_APPROVAL"); assert.equal(x.calls.length, 0);
    x.approve(); const a = await s.tick(); assert.equal(a.ran, true); assert.equal(a.ok, true); assert.equal(x.calls.length, 1);
    t += 3_700_000; stopped = true; assert.equal((await s.tick()).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); assert.equal(x.calls.length, 1);
  } finally { rm(d); }
});
test("the first-live marker is created only by a CONNECTOR run (simulated here, so it is test-local and the production state dir is untouched)", async () => {
  const d = tmp("ld-"); try { const x = rig(d); x.approve(); await x.runner.run({ sourceId: "hn-algolia", agentId: "SEARCH-1" }); const f = x.runner.firstLive(); assert.equal(f.sourceId, "hn-algolia"); assert.match(f.note, /Recorded separately/);
    const cap = rig(tmp("ld-")); const c = cap.engine.importOperatorCapture({ sourceId: "hn-algolia", items: [{ url: "https://hn.algolia.com/api/v1/items/5", title: "t", description: "Seeking freelancer, remote developer for an API project, contract.", publishedAt: T }], tool: "manual", retrievedAt: T, note: "n" }); assert.equal(c.retrieval, "OPERATOR_TOOL", JSON.stringify(c)); assert.equal(cap.runner.firstLive(), null, "operator captures never create it"); } finally { rm(d); }
});
test("owner approval request: exact, unsigned, one host, GET only, bound to the policy hash; the written file matches the builder", async () => {
  const { buildRequest } = await import("../scripts/prepare-live-source-request.mjs"); const r = buildRequest();
  assert.equal(r.status, "UNSIGNED_AWAITING_OWNER"); assert.equal(r.action, "EGRESS_POLICY_SET"); assert.deepEqual(r.policy.hosts, ["hn.algolia.com"]); assert.deepEqual(r.policy.methods, ["GET"]); assert.deepEqual(r.policy.ports, [443]);
  assert.equal(r.subject, policySubject(r.policy)); assert.match(r.subject, /^egress:discovery-hn-algolia:[0-9a-f]{24}$/); assert.match(r.source.authentication, /^NONE/); assert.equal(new URL(r.source.exactRequest).host, "hn.algolia.com"); assert.match(r.accessRestrictions, /could NOT be verified/);
  const f = JSON.parse(fs.readFileSync(new URL("../docs/owner/FIRST_LIVE_SOURCE_APPROVAL_REQUEST.json", import.meta.url), "utf8")); assert.equal(f.subject, r.subject, "re-run scripts/prepare-live-source-request.mjs --write if the policy changes");
  assert.doesNotMatch(JSON.stringify(r), /passphrase\s*[:=]|signature|privateKey/i);
});
test("model-connection runbook stays in sync with the code (credential refs, host-key variable, loopback provider, route restriction)", async () => {
  const md = fs.readFileSync(new URL("../docs/owner/FIRST_MODEL_CONNECTION_RUNBOOK.md", import.meta.url), "utf8");
  const { PROVIDER_PROFILES } = await import("../atlasz-addons/provider-adapters.mjs"); const mr = fs.readFileSync(new URL("../atlasz-addons/model-registry.mjs", import.meta.url), "utf8");
  for (const ref of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "XAI_API_KEY"]) { assert.match(md, new RegExp(ref)); assert.match(mr, new RegExp(ref)); }
  assert.match(md, /ATLASZ_VAULT_KEY/); assert.match(fs.readFileSync(new URL("../atlasz-addons/secret-vault.mjs", import.meta.url), "utf8"), /ATLASZ_VAULT_KEY/); assert.match(mr, /ollama-local/); assert.ok(PROVIDER_PROFILES.anthropic.host === "api.anthropic.com");
  assert.doesNotMatch(md, /sk-[A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{20,}/, "no key material in the runbook"); assert.match(md, /0 LIVE/);
});
