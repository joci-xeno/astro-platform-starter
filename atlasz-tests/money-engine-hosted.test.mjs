// The Money Engine is hosted by the runtime: LIVE environment, NO provider adapters, no owner key => nothing external can happen or be faked.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmp, rm } from "./helpers.mjs";
import { createMoneyViews } from "../atlasz-control-center/money-views.mjs";
const { createRuntime } = await import("../atlasz-runtime/supervisor-safe.mjs");

const GOOD = "We are looking for a developer for a freelance project: need help with a website, remote, budget $2,000. Contact jobs@example.com";
test("hosted engine: discovery works, outreach cannot be sent without adapter+owner approval, revenue/profit stay unknown/zero, dashboard and Control Center view agree", async () => {
  const dir = tmp("me-");
  try {
    const rt = createRuntime({ dataDir: dir, retryBaseMs: 0, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" }) });
    const m = rt.moneyEngine; assert.equal(m.environment, "LIVE");
    const d = m.discover({ id: "h1", source: "hn", url: "https://news.ycombinator.com/item?id=1", title: "Ask HN: Freelancer?", text: GOOD, published: new Date(Date.now() - 86400000).toISOString() }, { agentId: "S1" });
    assert.equal(d.stage, "FEASIBLE", JSON.stringify(d));
    const p = m.prepareOutreach(d.dealId, { buyerRef: "c1", to: "x@example.invalid", subject: "s", body: "b" });
    await assert.rejects(() => m.sendOutreach(d.dealId, { forged: true }));                       // no signed owner approval
    assert.notEqual(m.engines.deals.get(d.dealId).status, "SENT"); assert.equal(m.engines.comms.get(p.communicationId).state === "SENT", false);
    const pn = m.panel(); assert.equal(pn.money.verifiedRevenueUsd, 0); assert.equal(pn.money.verifiedNetProfitUsd ?? 0, 0);
    const dash = rt.dashboard(); assert.equal(dash.moneyEngine.environment, "LIVE"); assert.equal(rt.state.agents.length, 30);
    const v = createMoneyViews({ stateDir: dir }).money(); assert.equal(v.live.verifiedReceivedUsd, 0); assert.equal(v.live.outreachSent, 0); assert.equal(v.live.payments.VERIFIED ?? 0, 0);
  } finally { rm(dir); }
});
