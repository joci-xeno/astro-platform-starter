import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path";
import { createIncidentResponse, CLEAR_ACTION, clearSubject } from "../atlasz-addons/incident-response.mjs";
import { createAgentRegistry } from "../atlasz-addons/agent-registry.mjs";
import { sign, ownerAuth } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";
const mk = (d, extra = {}) => { const registry = createAgentRegistry({ dir: path.join(d, "reg") }), alerts = [], susp = []; const ir = createIncidentResponse({ dir: path.join(d, "inc"), registry, ownerAuth, alert: a => alerts.push(a), suspendAgentTasks: (a, r) => { susp.push([a, r]); return 2; }, evidenceProvider: () => ({ blackBoxTail: ["e1", "key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA leaked"] }), ...extra }); return { ir, registry, alerts, susp }; };

test("confirmed serious incident: operation blocked, agent isolated, tasks suspended, evidence preserved read-only and redacted, owner alerted", () => {
  const d = tmp("ir-"); try {
    const { ir, registry, alerts, susp } = mk(d);
    const r = ir.declare({ kind: "SECRET_EXFILTRATION_ATTEMPT", severity: "CRITICAL", confirmed: true, agentId: "EXECUTION-3", tool: "web.fetch", detail: "key in outbound body" });
    assert.equal(r.state, "CONTAINED_AWAITING_OWNER"); assert.equal(r.containment.blocked, true); assert.equal(r.containment.agentIsolated, true); assert.equal(r.containment.tasksSuspended, 2);
    assert.ok(ir.isBlocked({ agentId: "EXECUTION-3", tool: "web.fetch" })); assert.equal(ir.isBlocked({ agentId: "EXECUTION-4", tool: "web.fetch" }), null, "other agents are not affected");
    assert.equal(registry.get("EXECUTION-3").state.paused, true); assert.match(registry.get("EXECUTION-3").state.pausedReason, /^INCIDENT:/);
    assert.equal(alerts.length, 1); assert.equal(susp.length, 1);
    const dir = ir.evidenceDir(r.id), files = fs.readdirSync(dir).sort(); assert.deepEqual(files, ["context.json", "incident.json", "manifest.json"]);
    assert.equal(fs.statSync(path.join(dir, "incident.json")).mode & 0o222, 0, "evidence is read-only");
    assert.ok(!fs.readFileSync(path.join(dir, "context.json"), "utf8").includes("AAAAAAAAAAAAAAAA"), "secrets are redacted in evidence");
    assert.equal(ir.verify().ok, true); assert.equal(ir.open().length, 1);
  } finally { rm(d); }
});
test("unconfirmed or low/medium incidents are recorded and alerted but never auto-contained", () => {
  const d = tmp("ir-"); try {
    const { ir, registry, alerts } = mk(d);
    const a = ir.declare({ kind: "ODD_PATTERN", severity: "CRITICAL", confirmed: false, agentId: "SEARCH-1" }), b = ir.declare({ kind: "MINOR", severity: "MEDIUM", confirmed: true, agentId: "SEARCH-2" });
    assert.equal(a.state, "RECORDED"); assert.equal(b.state, "RECORDED"); assert.equal(ir.isBlocked({ agentId: "SEARCH-1", tool: "x" }), null); assert.equal(alerts.length, 2);
    assert.notEqual(registry.get("SEARCH-1").state.paused, true);
    assert.throws(() => ir.declare({ kind: "x", severity: "SEVERE" }), /SEVERITY_INVALID/);
  } finally { rm(d); }
});
test("only a signed single-use owner approval bound to the incident releases containment; evidence is kept; state survives restart", () => {
  const d = tmp("ir-"); try {
    const { ir, registry } = mk(d); const r = ir.declare({ kind: "K", severity: "HIGH", confirmed: true, agentId: "EXECUTION-5", tool: "t.x" });
    for (const bad of [null, {}, sign(CLEAR_ACTION, "incident-clear:other"), sign("DELIVER", clearSubject(r.id))]) assert.equal(ir.clear(r.id, { ownerApproval: bad }).ok, false);
    assert.ok(ir.isBlocked({ agentId: "EXECUTION-5", tool: "t.x" }));
    assert.equal(registry.get("EXECUTION-5").state.paused, true);
    const { ir: ir2 } = mk(d); assert.ok(ir2.isBlocked({ agentId: "EXECUTION-5", tool: "t.x" }), "blocks survive restart");
    const ap = sign(CLEAR_ACTION, clearSubject(r.id)); assert.equal(ir2.clear(r.id, { ownerApproval: ap }).ok, true);
    assert.equal(ir2.isBlocked({ agentId: "EXECUTION-5", tool: "t.x" }), null); assert.notEqual(createAgentRegistry({ dir: path.join(d, "reg") }).get("EXECUTION-5").state.paused, true, "the agent is resumed on disk after the owner clears"); assert.ok(fs.existsSync(ir2.evidenceDir(r.id)));
    assert.equal(ir2.clear(r.id, { ownerApproval: ap }).ok, false);
  } finally { rm(d); }
});
