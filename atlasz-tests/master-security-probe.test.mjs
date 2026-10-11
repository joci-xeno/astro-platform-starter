// Independent security probe of the Master capability: an agent handle, a manager or any other caller of the workforce must not be able to act as the Master.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createAgentRegistry } from "../atlasz-addons/agent-registry.mjs";
import { createWorkforce } from "../atlasz-addons/agent-workforce.mjs";
import { BUILTIN_EXECUTORS } from "../atlasz-addons/agent-executors.mjs";
import { createMasterCoordinator } from "../atlasz-addons/master-coordinator.mjs";
import { createAuditChain } from "../atlasz-addons/audit-chain.mjs";
import { tmp, rm } from "./helpers.mjs";

const NOW = "2026-10-11T20:00:00Z"; let stop = false;
const mkWf = d => createWorkforce({ dir: path.join(d, "wf"), registry: createAgentRegistry({ dir: path.join(d, "registry") }), sleep: async () => {}, now: () => NOW, isStopped: () => stop, executors: { ...BUILTIN_EXECUTORS } });

test("probe: without the one-shot Master token nobody can dispatch, suspend, unsuspend or reassign; PLAN_STEP/OWNER_DIRECTED cannot be forged through via=MASTER", async () => {
  stop = false; const d = tmp("msp-"); try {
    const wf = mkWf(d); const m = createMasterCoordinator({ dir: path.join(d, "master"), workforce: wf, isStopped: () => stop, now: () => NOW, clock: () => Date.parse(NOW) });
    const forged = [null, undefined, "", "MASTER", {}, Symbol("x"), 1, [], { toString: () => "x" }, Object.create(null)];
    for (const tok of forged) {
      const ex = await wf.executeTask("EXECUTION-1", { executor: "csv_to_json", input: { csv: "a\n1\n" }, authorization: { type: "PLAN_STEP", planId: "p", stepId: "s" }, via: "MASTER", masterToken: tok });
      assert.equal(ex.ok, false); assert.equal(ex.reason, "PLAN_STEP_ONLY_FROM_OWNER_PANEL");
      const od = await wf.executeTask("EXECUTION-1", { executor: "csv_to_json", input: { csv: "a\n1\n" }, authorization: { type: "OWNER_DIRECTED" }, via: "MASTER", masterToken: tok });
      assert.equal(od.ok, false); assert.equal(od.reason, "OWNER_DIRECTED_ONLY_FROM_OWNER_PANEL");
      assert.equal(wf.suspendTask("x", { masterToken: tok }).reason, "MASTER_CAPABILITY_REQUIRED"); assert.equal(wf.unsuspendTask("x", { masterToken: tok }).reason, "MASTER_CAPABILITY_REQUIRED");
      assert.equal((await wf.reassignTask("x", "EXECUTION-2", { masterToken: tok, ownerPanel: true })).reason, "MASTER_CAPABILITY_REQUIRED");
    }
    assert.throws(() => createMasterCoordinator({ dir: path.join(d, "master2"), workforce: wf, isStopped: () => false }), /MASTER_ALREADY_BOUND/);
    // an agent handle exposes no master/suspend/reassign surface
    const h = wf.coordinator.connect ? Object.keys(wf.coordinator.connect("EXECUTION-1")) : []; assert.ok(!h.some(k => /master|suspend|reassign/i.test(k)), h.join());
  } finally { rm(d); }
});

test("probe: dispatch under owner stop does nothing; Master state tamper is set aside, never trusted; audit chain tamper is detected; priority/note inputs are bounded", async () => {
  stop = false; const d = tmp("msp2-"); try {
    const wf = mkWf(d); let m = createMasterCoordinator({ dir: path.join(d, "master"), workforce: wf, isStopped: () => stop, now: () => NOW, clock: () => Date.parse(NOW) });
    assert.equal(m.enqueue({ planId: "../../etc", stepId: "x", priority: 99 }).ok, false); assert.equal(m.enqueue({ planId: "p", stepId: "x", priority: -1 }).ok, false); assert.equal(m.enqueue({ planId: "__proto__", stepId: "constructor" }).ok, false);
    assert.equal(m.enqueue({ planId: {}, stepId: [] }).ok, false);
    stop = true; const dd = await m.dispatch({ max: 5 }); assert.ok(!dd.dispatched || dd.dispatched.length === 0); stop = false;
    assert.equal(m.verify().ok, true);
    const f = path.join(d, "master", "master-audit.jsonl"); const lines = fs.readFileSync(f, "utf8").trim().split("\n"); assert.ok(lines.length >= 1);
    lines[0] = lines[0].replace(/"event":"[A-Z_]+"/, '"event":"FORGED"'); fs.writeFileSync(f, lines.join("\n") + "\n"); assert.throws(() => createAuditChain({ filePath: f, headPinFile: path.join(d, "master", "master-audit.headpin.json"), now: () => NOW }), /AUDIT_CHAIN_TAMPERED/, "a tampered Master audit log is refused on restart (fail closed)");
    fs.writeFileSync(path.join(d, "master", "master.json"), '{"jobs":{"j1":{"state":"DISPATCHED","taskId":"t"}}}');
  } finally { rm(d); }
  // restart on a tampered state file: set aside, empty queue
  const d2 = tmp("msp3-"); try {
    const wf = mkWf(d2); let m = createMasterCoordinator({ dir: path.join(d2, "master"), workforce: wf, isStopped: () => false, now: () => NOW, clock: () => Date.parse(NOW) }); await m.supervise();
    const sf = path.join(d2, "master", "master.json"); fs.writeFileSync(sf, fs.readFileSync(sf, "utf8").replace(/"supervisions":\d+/, '"supervisions":99'));
    const wf2 = mkWf(d2); // new process view; the first Master's token binding is per workforce instance
    const m2 = createMasterCoordinator({ dir: path.join(d2, "master"), workforce: wf2, isStopped: () => false, now: () => NOW, clock: () => Date.parse(NOW) });
    assert.equal((await m2.status()).supervisions, 0, "tampered state is not trusted"); assert.ok(fs.readdirSync(path.join(d2, "master")).some(n => n.startsWith("master.json.damaged")), "set aside");
  } finally { rm(d2); }
});
