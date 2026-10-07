// Control Center money/jobs/agents panels: read-only, recorded state only, SANDBOX never counted as LIVE, unlabelled records never counted as LIVE, corrupt files reported.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmp, rm } from "./helpers.mjs";
import { createMoneyViews } from "../atlasz-control-center/money-views.mjs";

const w = (dir, rel, o) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), typeof o === "string" ? o : JSON.stringify(o)); };

test("no Money Engine state => NOT_CONNECTED, never zero-revenue claims", () => {
  const d = tmp(); try { const v = createMoneyViews({ stateDir: d }); const m = v.money(); assert.equal(m.state, "NOT_CONNECTED"); assert.equal(m.live, null); assert.equal(v.jobs().state, "NOT_CONNECTED"); assert.equal(v.agents().state, "NOT_CONNECTED"); } finally { rm(d); }
});

test("LIVE and SANDBOX are separated; claimed payments are not verified; unlabelled records are not LIVE; costs unknown are counted", () => {
  const d = tmp(); try {
    w(d, "money/payments.json", { seq: 4, payments: {
      a: { id: "a", amount: 500, status: "VERIFIED", environment: "SANDBOX" }, b: { id: "b", amount: 100, status: "CLAIMED", environment: "LIVE" },
      c: { id: "c", amount: 70, status: "VERIFIED", environment: "LIVE" }, d: { id: "d", amount: 9999, status: "VERIFIED" } } });
    w(d, "money/jobs-universal.json", { jobs: { j1: { id: "j1", goal: "g", status: "CLOSED", environment: "LIVE", costs: [{ class: "ACTUAL", amountUsd: 20 }, { class: "ESTIMATE", amountUsd: 999 }, { class: "ACTUAL", amountUsd: null }], assignedAgents: ["E1"], artifacts: [] },
      j2: { id: "j2", status: "CLOSED", environment: "SANDBOX", costs: [{ class: "ACTUAL", amountUsd: 5 }] } } });
    w(d, "money/comms.json", { msgs: { m1: { state: "SENT", environment: "LIVE" }, m2: { state: "QUEUED", environment: "LIVE" }, m3: { state: "SENT", environment: "SANDBOX" } } });
    const m = createMoneyViews({ stateDir: d }).money();
    assert.equal(m.live.verifiedReceivedUsd, 70); assert.equal(m.live.claimedNotVerifiedUsd, 100); assert.equal(m.sandbox.verifiedReceivedUsd, 500);
    assert.equal(m.live.actualCostUsd, 20); assert.equal(m.live.unknownCostEntries, 1); assert.equal(m.live.verifiedNetProfitUsd, 50);
    assert.equal(m.live.outreachSent, 1, "QUEUED is not SENT"); assert.equal(m.sandbox.outreachSent, 1);
    assert.match(m.sandbox.note, /Never counted/);
  } finally { rm(d); }
});

test("no verified payment => no profit claim; a corrupt file is reported, not hidden", () => {
  const d = tmp(); try {
    w(d, "money/payments.json", { payments: { b: { id: "b", amount: 100, status: "CLAIMED", environment: "LIVE" } } });
    w(d, "money/deals.json", "{broken");
    const m = createMoneyViews({ stateDir: d }).money();
    assert.equal(m.state, "PARTIAL_UNREADABLE"); assert.deepEqual(m.unreadable, ["deals"]); assert.match(m.live.profitNote, /no verified revenue/); assert.equal(m.live.verifiedReceivedUsd, 0);
  } finally { rm(d); }
});

test("agents view reports topology from the capability graph and flags a count other than 30", () => {
  const d = tmp(); try {
    const g = {}; for (let i = 1; i <= 29; i++) g["A" + i] = { id: "A" + i, type: "AGENT", health: "UNKNOWN", stats: { runs: 0, ok: 0 } }; g.T = { id: "T", type: "TOOL" };
    w(d, "brain/capability-graph.json", g); let a = createMoneyViews({ stateDir: d }).agents(); assert.equal(a.count, 29); assert.equal(a.topologyOk, false);
    g.A30 = { id: "A30", type: "AGENT", stats: {} }; w(d, "brain/capability-graph.json", g); a = createMoneyViews({ stateDir: d }).agents(); assert.equal(a.topologyOk, true); assert.equal(a.items.find(x => x.id === "A30").health, "UNKNOWN");
  } finally { rm(d); }
});

import net from "node:net";
import http from "node:http";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const get = (port, p, headers) => new Promise((res, rej) => { http.get({ host: "127.0.0.1", port, path: p, headers }, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => res({ status: r.statusCode, body: d })); }).on("error", rej); });

test("HTTP: money-engine / money-jobs / money-agents are token-protected and report NOT_CONNECTED on an empty state", async () => {
  const base = tmp("ccm-"), cc = createControlCenterServer({ stateDir: path.join(base, "s"), configDir: path.join(base, "c"), port: await freePort() });
  const { port, token } = await cc.listen();
  try {
    const H = { host: "127.0.0.1:" + port };
    for (const p of ["/api/money-engine", "/api/money-jobs", "/api/money-agents"]) {
      assert.equal((await get(port, p, H)).status, 401, p);
      const r = await get(port, p, { ...H, "x-atlasz-token": token }); assert.equal(r.status, 200); assert.equal(JSON.parse(r.body).state, "NOT_CONNECTED");
    }
  } finally { await cc.close?.(); rm(base); }
});

test("recurring view: contracted MRR is labelled a claim; verified receipts need a VERIFIED_PAID LIVE invoice; sandbox subscriptions are separate", () => {
  const d = tmp(); try {
    w(d, "money/subscriptions.json", { subs: { a: { id: "a", status: "ACTIVE", interval: "MONTHLY", amount: 100, environment: "LIVE" }, b: { id: "b", status: "ACTIVE", interval: "ANNUAL", amount: 1200, environment: "LIVE" }, c: { id: "c", status: "ACTIVE", interval: "MONTHLY", amount: 999, environment: "SANDBOX" } },
      periods: { p1: { subscriptionId: "a", invoiceId: "i1", amount: 100 }, p2: { subscriptionId: "a", invoiceId: "i2", amount: 100 } } });
    w(d, "money/invoices.json", { invoices: { i1: { id: "i1", status: "VERIFIED_PAID", environment: "LIVE" }, i2: { id: "i2", status: "PAYMENT_VERIFICATION_REQUIRED", environment: "LIVE" } } });
    const r = createMoneyViews({ stateDir: d }).recurring();
    assert.equal(r.live.contractedMrrUsd, 200); assert.equal(r.live.verifiedReceivedUsd, 100); assert.match(r.live.note, /not revenue/); assert.equal(r.sandbox.subscriptions.ACTIVE, 1);
    assert.equal(createMoneyViews({ stateDir: tmp() }).recurring().state, "NOT_CONNECTED");
  } finally { rm(d); }
});

test("crm/inbox view: reads graph, follow-ups and pipeline files; counts dangling edges, overdue follow-ups, quarantined and needs-owner items; NOT_CONNECTED when absent", () => {
  const d = tmp(); try {
    assert.equal(createMoneyViews({ stateDir: d }).crmInbox().graph.state, "NOT_CONNECTED");
    w(d, "brain/entity-graph.json", { entities: { "T|customer|c1": { tenantId: "T", type: "customer", id: "c1", stub: false }, "T|deal|d1": { tenantId: "T", type: "deal", id: "d1", stub: true } }, edges: { e1: { tenantId: "T", from: { type: "customer", id: "c1" }, to: { type: "deal", id: "d1" } }, e2: { tenantId: "T", from: { type: "customer", id: "c1" }, to: { type: "job", id: "gone" } } } });
    w(d, "money/crm.json", { followups: { a: { status: "OPEN", dueAt: "2026-01-01" }, b: { status: "OPEN", dueAt: "2999-01-01" }, c: { status: "DONE", dueAt: "2026-01-01" } } });
    w(d, "inbox/pipeline.json", { items: { x: { id: "x", kind: "QUARANTINED", quarantined: true, routeStatus: "HELD_FOR_OWNER", receivedAt: "2026-10-07", links: { deals: [] }, entity: { status: "SKIPPED_QUARANTINED" } }, y: { id: "y", kind: "CUSTOMER_REPLY", routeStatus: "APPLIED", receivedAt: "2026-10-06", links: { deals: ["d1"] }, entity: { status: "LINKED" } } } });
    const r = createMoneyViews({ stateDir: d }).crmInbox("2026-10-07T00:00:00Z");
    assert.equal(r.graph.stubs, 1); assert.equal(r.graph.danglingEdges, 1); assert.equal(r.followups.overdue, 1); assert.equal(r.followups.open, 2); assert.equal(r.inbox.quarantined, 1); assert.equal(r.inbox.needsOwner, 1); assert.equal(r.inbox.recent[0].id, "x");
    assert.ok(!JSON.stringify(r).includes("body"));
  } finally { rm(d); }
});

import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
test("brain view: behaviour anomalies are NOT_CONNECTED when none persisted, and listed (open/high counts) when the monitor persisted findings", async () => {
  const base = tmp("ccbh-"), core = createControlCenterCore({ stateDir: path.join(base, "s"), configDir: path.join(base, "c") });
  try {
    assert.equal((await core.brain()).behavior.state, "NOT_CONNECTED");
    w(path.join(base, "s"), "brain/behavior-anomalies.json", { anomalies: { a: { id: "a", kind: "BYPASS_ATTEMPT", severity: "HIGH", subject: "E4", detail: "3 refused", recommendation: "QUARANTINE_REVIEW", status: "OPEN", count: 2, lastSeenAt: "2026-10-07" }, b: { id: "b", kind: "LOOP", severity: "MEDIUM", status: "RESOLVED", lastSeenAt: "2026-10-06" } } });
    const b = (await core.brain()).behavior; assert.equal(b.open, 1); assert.equal(b.high, 1); assert.equal(b.items[0].kind, "BYPASS_ATTEMPT"); assert.match(b.note, /Nothing is quarantined/);
  } finally { rm(base); }
});
