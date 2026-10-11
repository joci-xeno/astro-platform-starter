// Control Center global discovery (Phase 5b): real HTTP, real registry/coordinator/ledger, real approvals store. Agents are never LIVE by registration; no revenue is invented.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";

const PW = "correct horse battery";
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const raw = (port, p, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => { const q = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); }); q.on("error", reject); if (body) q.write(body); q.end(); });
const mk = async (base, stateDir, configDir) => {
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort() }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const c = { token, get: async (p, t = token) => raw(port, p, { headers: { ...H, ...(t ? { "x-atlasz-token": t } : {}) } }), post: (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) }), stop: async () => { await cc.close?.(); } };
  c.view = async () => JSON.parse((await c.get("/api/agents30")).body);
  c.act = async b => { const r = await c.post("/api/agents30/action", b); return { status: r.status, ...JSON.parse(r.body) }; };
  return c;
};
const CAP = JSON.parse(fs.readFileSync(new URL("../docs/audit/live_capture_2026-10-11.json", import.meta.url), "utf8"));
test("global discovery over HTTP: nothing connected without owner host approval; labelled operator capture is verified by a different agent, planned, executed by an EXECUTION agent, checked, shown, and survives restart", async () => {
  const base = tmp("cc30d-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  let c = await mk(base, stateDir, configDir);
  try {
    let v = await c.view(); assert.equal(v.discovery.state, "CONNECTED"); assert.ok(v.discovery.sources.length >= 15); assert.ok(v.discovery.sources.every(s => s.genuinelyConnected === false));
    for (const r of ["Europe", "North America", "Oceania", "Africa", "Asia", "South America", "Middle East"]) assert.ok(r in v.discovery.coverage, r);
    assert.ok(v.discoveryBlockers.length > 0);
    const run = await c.act({ op: "discoverySourceRun", agentId: "SEARCH-1", sourceId: "remoteok" }); assert.equal(run.result.ok === true, false); assert.match(JSON.stringify(run.result), /NEEDS_OWNER_HOST_APPROVAL|BLOCKED/);
    const ap = await c.act({ op: "discoveryApproveHost", sourceId: "remoteok" }); assert.equal(ap.result?.needsSignature, true, JSON.stringify(ap)); assert.equal((await c.view()).discovery.sources.find(s => s.id === "remoteok").state, "NEEDS_OWNER_HOST_APPROVAL");
    const items = CAP.sources["find-a-tender-uk"], imp = await c.act({ op: "discoveryImportCapture", sourceId: "find-a-tender-uk", items, tool: CAP.tool, retrievedAt: CAP.retrievedAt, note: "http test" });
    assert.equal(imp.result.ok, true, JSON.stringify(imp)); assert.equal(imp.result.retrieval, "OPERATOR_TOOL"); assert.ok(imp.result.results.every(r => r.ok && r.checkedBy !== r.discoveredBy));
    v = await c.view(); assert.equal(v.discovery.sources.find(s => s.id === "find-a-tender-uk").genuinelyConnected, false); assert.equal(v.system.discoverySummary.connectorRetrieved, 0); assert.equal(v.system.discoverySummary.operatorToolRetrieved, items.length);
    const good = imp.result.results.find(r => r.eligible); assert.ok(good, JSON.stringify(imp.result.results.map(r => [r.eligible, r.blockers])));
    assert.equal((await c.act({ op: "plan", opportunityId: good.opportunityId })).result.needsOwnerInput, true);
    assert.equal((await c.act({ op: "ownerInput", opportunityId: good.opportunityId, requiredSkills: ["plan.implementation_plan"] })).result.ok, true);
    const pl = (await c.act({ op: "plan", opportunityId: good.opportunityId })).result; assert.equal(pl.ok, true, JSON.stringify(pl));
    const as = (await c.act({ op: "assignExecution", planId: pl.planId })).result; assert.equal(as.ok, true); const t = as.assignments.find(x => x.stepId === "TECHPLAN");
    const ex = (await c.act({ op: "executeStep", agentId: t.agentId, executor: "implementation_plan", planId: pl.planId, stepId: "TECHPLAN" })).result; assert.equal(ex.ok, true, JSON.stringify(ex));
    assert.equal((await c.act({ op: "check", taskId: ex.taskId })).result.decision, "ACCEPT");
    assert.equal((await c.act({ op: "advance", opportunityId: good.opportunityId, stage: "PROPOSED", evidence: { source: "x", reference: "y", verifiedAt: CAP.retrievedAt } })).result.ok, false);
    v = await c.view(); assert.equal(v.system.verifiedRevenue.verifiedReceivedUsd, 0); assert.ok(v.system.deliverables.some(x => x.status === "VERIFIED"));
    await c.stop(); c = await mk(base, stateDir, configDir);
    v = await c.view(); assert.equal(v.system.discoverySummary.operatorToolRetrieved, items.length); assert.ok(v.system.deliverables.some(x => x.status === "VERIFIED")); assert.equal(v.system.integrity.events, true); assert.equal(v.discovery.integrity.ok, true);
  } finally { await c.stop(); rm(base); }
});

test("the three first hosts: the request is shown exactly, a wrong passphrase or no owner key approves nothing, the owner's signature makes them READY (and still not 'connected')", async () => {
  const base = tmp("cc30h-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const c = await mk(base, stateDir, configDir);
  try {
    let v = await c.view(); assert.deepEqual(v.hostRequests.map(r => r.sourceId), ["remoteok", "find-a-tender-uk", "hn-algolia"]);
    assert.deepEqual(v.hostRequests.map(r => r.hosts[0]), ["remoteok.com", "www.find-tender.service.gov.uk", "hn.algolia.com"]);
    assert.ok(v.hostRequests.every(r => r.methods.join() === "GET" && r.ports.join() === "443" && r.state === "NEEDS_OWNER_HOST_APPROVAL"));
    const ids = v.hostRequests.map(r => r.sourceId);
    const noKey = await c.act({ op: "discoveryApproveHosts", sourceIds: ids, passphrase: PW }); assert.notEqual(noKey.result?.ok, true); assert.ok((await c.view()).hostRequests.every(r => r.state === "NEEDS_OWNER_HOST_APPROVAL"));
    assert.equal((await c.post("/api/owner-key", { passphrase: PW })).status, 200);
    const bad = await c.act({ op: "discoveryApproveHosts", sourceIds: ids, passphrase: "wrong wrong wrong" }); assert.notEqual(bad.result?.ok, true); assert.ok((await c.view()).hostRequests.every(r => r.state === "NEEDS_OWNER_HOST_APPROVAL"));
    const ok = await c.act({ op: "discoveryApproveHosts", sourceIds: ids, passphrase: PW }); assert.equal(ok.result?.ok, true, JSON.stringify(ok));
    v = await c.view(); assert.ok(v.hostRequests.every(r => r.state === "READY_APPROVED_HOST")); assert.ok(v.discovery.sources.every(s => s.genuinelyConnected === false));
  } finally { await c.stop(); rm(base); }
});
