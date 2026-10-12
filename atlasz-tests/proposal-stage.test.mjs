// Phase E 8.1: ROUTED opportunity -> real EXECUTION agent drafts -> independent checker verifies -> DRAFT_NOT_SENT evidence. Records are FIXTURES and labelled so.
import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path";
import { normalizeOpportunity, createOpportunityRegistry, createMasterIntake } from "../atlasz-addons/opportunity-intake.mjs";
import { createProposalStage } from "../atlasz-addons/proposal-stage.mjs";
import { createAgentRegistry } from "../atlasz-addons/agent-registry.mjs";
import { createWorkforce } from "../atlasz-addons/agent-workforce.mjs";
import { tmp, rm } from "./helpers.mjs";

const NOW = "2026-10-12T10:00:00.000Z";
const item = (o = {}) => ({ sourceId: "fixture-src", externalId: "F-1", title: "Convert supplier CSV spreadsheet to JSON", description: "We need a data conversion of a CSV spreadsheet into JSON. The contractor must deliver a validated file. Remote work, fixed price contract.", buyerName: "Example Buyer Ltd", valueAmount: 800, currency: "EUR", url: "https://example.org/notice/1", remote: true, ...o });
const rig = () => {
  const d = tmp("ps-"), reg = createOpportunityRegistry({ dir: path.join(d, "reg") });
  const mi = createMasterIntake({ dir: path.join(d, "mi"), registry: reg, capabilities: ["data.csv_to_json", "doc.proposal_draft"] });
  const wf = createWorkforce({ dir: path.join(d, "wf"), registry: createAgentRegistry({ dir: path.join(d, "registry") }), sleep: async () => {}, now: () => NOW });
  const ps = createProposalStage({ dir: path.join(d, "ps"), registry: reg, workforce: wf, now: () => NOW });
  const route = (o = {}) => { const n = normalizeOpportunity(item(o), { retrieval: "FIXTURE", discoveredAt: NOW }).record; const r = mi.receive({ agentId: "SEARCH-2", record: n }); return r; };
  return { d, reg, mi, wf, ps, route };
};

test("a routed opportunity gets a checker-verified DRAFT that is not sent and is labelled as fixture", async () => {
  const x = rig(); try {
    const r = x.route(); assert.equal(r.state, "ROUTED", JSON.stringify(r));
    const p = await x.ps.draft(r.opportunityId); assert.equal(p.ok, true, JSON.stringify(p));
    assert.equal(p.status, "VERIFIED_DRAFT"); assert.equal(p.sent, false); assert.equal(p.deliveryStatus, "DRAFT_NOT_SENT"); assert.equal(p.fixtureOnly, true);
    assert.match(p.maker, /^EXECUTION-/); assert.match(p.checker, /^(EXECUTION|SEARCH)-/); assert.notEqual(p.maker, p.checker); assert.match(p.artifactSha256, /^[0-9a-f]{64}$/);
    const art = fs.readFileSync(path.join(x.d, "wf", "artifacts", p.taskId, "proposal_draft.md"), "utf8"); assert.match(art, /NOT SENT/); assert.match(art, /\[OWNER TO SET\]/); assert.match(art, /not a quote and not our income/);
    const again = await x.ps.draft(r.opportunityId); assert.equal(again.duplicate, true); assert.equal(again.taskId, p.taskId, "idempotent");
    assert.equal(x.ps.get(r.opportunityId).draftId, p.draftId);
  } finally { rm(x.d); }
});
test("refusals: unknown, unverified stage, fraud indicators, owner stop, corrupt state is not overwritten", async () => {
  const x = rig(); try {
    assert.equal((await x.ps.draft("opp-nope")).reason, "UNKNOWN_OPPORTUNITY");
    const rec = normalizeOpportunity(item({ externalId: "F-2", title: "Other CSV job", description: "Convert CSV to JSON, remote. Pay a registration fee upfront, guaranteed income, send your passport and bank details." }), { retrieval: "FIXTURE", discoveredAt: NOW }).record;
    const id = x.reg.upsert(rec).id; assert.equal((await x.ps.draft(id)).reason, "NOT_VERIFIED_BY_MASTER_INTAKE");
    x.reg.setStage(id, "VERIFY", "TEST", "t", { internal: true }); const f = await x.ps.draft(id);
    assert.ok(rec.riskFlags.some(k => k.startsWith("FRAUD_INDICATOR:"))); assert.equal(f.reason, "FRAUD_INDICATORS_PRESENT_NO_DRAFT");
    const stopped = createProposalStage({ dir: path.join(x.d, "ps2"), registry: x.reg, workforce: x.wf, isStopped: () => true }); assert.equal((await stopped.draft(id)).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    fs.mkdirSync(path.join(x.d, "ps3")); fs.writeFileSync(path.join(x.d, "ps3", "proposal-drafts.json"), "{broken"); assert.throws(() => createProposalStage({ dir: path.join(x.d, "ps3"), registry: x.reg, workforce: x.wf }), /CORRUPT_NOT_OVERWRITTEN/);
    assert.equal(fs.readFileSync(path.join(x.d, "ps3", "proposal-drafts.json"), "utf8"), "{broken");
  } finally { rm(x.d); }
});
test("durable across restart", async () => {
  const x = rig(); try {
    const r = x.route(); const p = await x.ps.draft(r.opportunityId); assert.equal(p.ok, true);
    const again = createProposalStage({ dir: path.join(x.d, "ps"), registry: x.reg, workforce: x.wf }); assert.equal(again.list().length, 1); assert.equal(again.get(r.opportunityId).artifactSha256, p.artifactSha256);
  } finally { rm(x.d); }
});
