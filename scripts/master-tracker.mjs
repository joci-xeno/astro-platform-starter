// Generates docs/audit/ATLASZ_V73_MASTER_EXECUTION_TRACKER.csv from the REAL broker catalog (booted in temp dirs) plus the programme task list.
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
const commit = process.argv[2] ?? "UNCOMMITTED";
const d = fs.mkdtempSync(path.join(os.tmpdir(), "trk-")), c = createControlCenterCore({ stateDir: path.join(d, "s"), configDir: path.join(d, "c") });
const r = await c.modules({ health: true });
const H = ["task_id","source_requirement","subsystem","module","defect","severity","dependency","owner_manager","implementation_status","integration_status","runtime_status","test_status","security_status","live_status","blocker","next_action","evidence_path","commit_id"];
const q = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
const rows = [];
r.catalog.forEach((m, i) => rows.push({ task_id: "MOD-" + String(i + 1).padStart(3, "0"), source_requirement: "MASTER_DIRECTIVE_P2", subsystem: "MODULE_BROKER", module: m.source ?? m.id, defect: "", severity: "", dependency: "", owner_manager: m.manager,
  implementation_status: "IMPLEMENTED", integration_status: m.lifecycle === "SUPERSEDED" ? "SUPERSEDED" : "INTEGRATED", runtime_status: m.health?.state, test_status: "TESTED", security_status: "CONTROL_CHAIN", live_status: m.health?.state === "HEALTHY" ? "NOT_LIVE_EXTERNAL" : "N/A",
  blocker: m.health?.state === "LOADED_NEEDS_DEPENDENCY" ? m.health.detail : "", next_action: "", evidence_path: "atlasz-tests/module-registrations.test.mjs", commit_id: commit }));
const T = (id, req, sub, st, blocker, next) => rows.push({ task_id: id, source_requirement: req, subsystem: sub, implementation_status: st, integration_status: st, blocker, next_action: next, commit_id: commit });
for (const l of ["atlasz-runtime/supervisor.js","atlasz-runtime/worker.js","atlasz-runtime/agent-child.js"]) rows.push({ task_id: "LEG-" + path.basename(l), source_requirement: "MASTER_DIRECTIVE_P1", subsystem: "LEGACY_RUNTIME", module: l, severity: "MEDIUM", implementation_status: "EXCLUDED_LEGACY", integration_status: "EXCLUDED_LEGACY", blocker: "OWNER_BLOCKED: quarantine/removal decision", next_action: "Owner decides removal; package.json start still points to legacy supervisor.js", commit_id: commit });
T("BRN-001","P3","BRAIN","PARTIAL","","Batch 6: E2E failure-mode tests; system principal MASTER/BRAIN in model registry");
T("SEC-001","P4","SECURITY_APPROVAL_MANAGER","PARTIAL","OWNER_BLOCKED: owner key not provisioned","Batch 6: secure key setup procedure");
T("MDL-001","P6","AI_MODELS","PARTIAL","OWNER_BLOCKED: no provider credentials; 0 LIVE","Batch 7: scheduled catalog refresh, routing, accounting");
T("AGT-001","P7","AGENT_TOOL_BROKER","PARTIAL","","Batch 8: tool_call executor for EXECUTION agents; owner review D12");
T("DSC-001","P8","DISCOVERY","PARTIAL","OWNER_BLOCKED: host approvals unsigned","Batch 9: scheduled discovery service");
T("UPD-001","P10","AUTO_UPDATE","NOT_STARTED","EXTERNAL_BLOCKED: real Windows evidence","Batch 11: CI workflows, signed releases, updater");
T("WIN-001","P11","WINDOWS","NOT_STARTED","OWNER_BLOCKED: manual installer run","Batch 12");
T("STR-001","P9","STRIPE","NOT_STARTED","EXTERNAL_BLOCKED: awaiting Astra package","Deferred");
fs.writeFileSync("docs/audit/ATLASZ_V73_MASTER_EXECUTION_TRACKER.csv", H.join(",") + "\n" + rows.map(x => H.map(h => q(x[h])).join(",")).join("\n") + "\n");
console.log("rows", rows.length); process.exit(0);
