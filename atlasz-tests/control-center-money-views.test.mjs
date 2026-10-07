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
