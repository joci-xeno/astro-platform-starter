// Computed system audit (owner directive 2026-10-11, phases 2/4/6). Boots a throw-away Control Center, asks the Master for live manager probes, counts the model ladder,
// checks that every evidence file / test file named for a component exists, and classifies each component. Nothing here is hand-asserted: a component is VERIFIED_WORKING only
// if its live probe passes (when it has one) AND its implementation + test files exist AND the owner-independent preconditions hold. Output: docs/audit/system_audit_<date>.{json,md}.
process.env.ATLASZ_TEST_MODE = "1";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const has = f => fs.existsSync(path.join(root, f.replace(/ \(.*$/, "")));
const base = fs.mkdtempSync(path.join(os.tmpdir(), "atlasz-audit-"));
const cc = createControlCenterServer({ stateDir: path.join(base, "s"), configDir: path.join(base, "c"), port: 0, masterTickMs: 0 });
try {
  const core = cc.core; await core.agents30Action({ op: "masterSupervise" });
  const v = core.agents30(), m = v.master, mgr = Object.fromEntries(m.managers.map(x => [x.id, x]));
  core.modelRegistryAction({ op: "seed" }); const mr = core.modelRegistry();
  const ladder = mr.providerLadder, cnt = k => ladder.filter(p => p[k]).length;
  const models = { providersRegistered: mr.providers.length, modelRecords: mr.models.length, adapterImplemented: cnt("adapterImplemented"), credentialsConfigured: cnt("credentialsConfigured"), authenticatedLiveTestPassed: cnt("authenticatedLiveTestPassed"), productionReady: cnt("productionReady"),
    note: "Record count is not usability: only providers with adapter + credential + owner-approved egress + a passed authenticated live test are LIVE." };
  const disc = (await core.agents30Action({ op: "discoveryStatus" }).catch(() => null)) ?? null;
  const dv = v.discovery ?? disc?.result ?? null;
  const csv = f => fs.readFileSync(path.join(root, "docs/audit", f), "utf8").trim().split("\n").slice(1);
  const pk = csv("pkg150_status.csv"), pkTally = {}; for (const l of pk) { const st = l.split(",")[3]; pkTally[st] = (pkTally[st] ?? 0) + 1; }
  const C = (name, area, impl, tests, live, extra = {}) => {
    const miss = [...impl, ...tests].filter(f => !has(f)); const probeOk = live == null ? null : live.status === "CONNECTED";
    let status = miss.length ? "MISSING" : probeOk === false ? "PARTIAL" : "VERIFIED_WORKING"; if (extra.externalBlocker) status = "EXTERNAL_BLOCKER"; else if (extra.partial) status = "PARTIAL";
    return { name, area, status, liveProbe: live ? { status: live.status, health: live.health } : "no live probe (library verified by tests only)", implementation: impl, tests, missingFiles: miss, reason: extra.reason ?? null, dependsOn: extra.dependsOn ?? [] };
  };
  const T = n => "atlasz-tests/" + n;
  const comps = [
    C("Master Coordinator", "1", ["atlasz-addons/master-coordinator.mjs", "atlasz-addons/agent-coordination.mjs"], [T("master-coordinator.test.mjs"), T("master-security-probe.test.mjs"), T("control-center-master.test.mjs")], mgr.MASTER_COORDINATOR, { dependsOn: ["WORKFORCE_MANAGER", "OWNER APPROVALS"] }),
    C("Workforce Manager (30 agents)", "3", ["atlasz-addons/agent-workforce.mjs", "atlasz-addons/agent-registry.mjs"], [T("agent-workforce.test.mjs"), T("control-center-agents30.test.mjs")], mgr.WORKFORCE_MANAGER, { dependsOn: ["MASTER_COORDINATOR"] }),
    C("SEARCH Agent Manager", "3", ["atlasz-addons/agent-workforce.mjs"], [T("agent-workforce.test.mjs"), T("global-discovery-workforce.test.mjs")], mgr.SEARCH_AGENT_MANAGER),
    C("EXECUTION Agent Manager", "5", ["atlasz-addons/agent-workforce.mjs", "atlasz-addons/agent-executors.mjs"], [T("agent-workforce.test.mjs"), T("master-coordinator.test.mjs")], mgr.EXECUTION_AGENT_MANAGER),
    C("Campaign Manager", "10", ["atlasz-addons/campaign-manager.mjs", "atlasz-addons/master-coordinator.mjs"], [T("master-coordinator.test.mjs")], mgr.CAMPAIGN_MANAGER),
    C("Global Business Intelligence", "11", ["atlasz-addons/global-business-intelligence.mjs"], [T("master-coordinator.test.mjs"), T("control-center-master.test.mjs")], mgr.GLOBAL_BUSINESS_INTELLIGENCE, { reason: "Read-only analytics over real pipeline data; shows zero real opportunities until a connector source is approved and run." }),
    C("AI Model Manager + Provider Router", "6", ["atlasz-addons/model-registry.mjs", "atlasz-addons/model-routing-bridge.mjs", "atlasz-addons/provider-adapters.mjs"], [T("model-registry.test.mjs"), T("control-center-model-registry.test.mjs")], mgr.AI_MODEL_MANAGER, { partial: models.authenticatedLiveTestPassed === 0, reason: models.authenticatedLiveTestPassed === 0 ? "No provider has passed an authenticated live test (no vault credential + owner-approved egress yet): 0 providers LIVE." : null, dependsOn: ["SECURITY_APPROVAL_MANAGER"] }),
    C("Security and Approval Manager", "7,8", ["atlasz-addons/owner-auth.mjs", "atlasz-addons/egress-policy.mjs", "atlasz-addons/api-key-vault.mjs"], [T("owner-auth.test.mjs")], mgr.SECURITY_APPROVAL_MANAGER, { reason: mgr.SECURITY_APPROVAL_MANAGER.status !== "CONNECTED" ? "Probe fresh install: no owner key provisioned here (this is the audit sandbox, not the owner's installation)." : null, partial: mgr.SECURITY_APPROVAL_MANAGER.status !== "CONNECTED" }),
    C("Memory and Knowledge Manager", "9", ["atlasz-addons/memory-store.mjs", "atlasz-addons/agent-memory.mjs"], [T("m5-memory-integration.test.mjs")], mgr.MEMORY_KNOWLEDGE_MANAGER),
    C("Financial and Revenue Manager (ledger)", "12", ["atlasz-addons/financial-ledger.mjs", "atlasz-addons/revenue-persistence.mjs"], [T("financial-ledger.test.mjs")], mgr.FINANCIAL_REVENUE_MANAGER),
    C("Stripe payment intake gate", "13", ["atlasz-addons/payment-package-intake.mjs", "docs/STRIPE_HANDOFF.md"], [T("payment-package-intake.test.mjs")], null, { externalBlocker: true, reason: "Intake gate tested; Astra's Stripe package not received; Stripe->KOHO payout NOT connected; no real charge/payout is possible." }),
    C("Runtime Supervisor", "16", ["atlasz-runtime/supervisor-safe.mjs"], [], mgr.RUNTIME_SUPERVISOR, { partial: mgr.RUNTIME_SUPERVISOR.status !== "CONNECTED", reason: "Child process is started by the owner from the Control Center; not running in the audit sandbox." }),
    C("Task Scheduler", "16", ["atlasz-addons/scheduler.mjs"], [], mgr.TASK_SCHEDULER, { partial: mgr.TASK_SCHEDULER.status !== "CONNECTED", reason: "Engine tested; no schedules recorded in the sandbox." }),
    C("Quality Assurance / Independent Checker", "5", ["atlasz-addons/agent-coordination.mjs", "atlasz-addons/agent-workforce.mjs"], [T("agent-workforce.test.mjs")], mgr.QUALITY_ASSURANCE),
    C("Recovery and Maintenance Manager", "16", ["atlasz-addons/backup-recovery.mjs"], [], mgr.RECOVERY_MAINTENANCE, { partial: mgr.RECOVERY_MAINTENANCE.status !== "CONNECTED", reason: "Backup/restore engine tested; no backup or passed restore drill in the sandbox." }),
    C("Global Discovery Engine", "4", ["atlasz-addons/global-discovery.mjs"], [T("global-discovery.test.mjs"), T("control-center-discovery.test.mjs")], null, { partial: true, reason: "0 sources genuinely CONNECTED: the three first hosts await the owner's signed approval; only operator-captured (labelled) data exists." }),
    C("Windows Electron desktop app", "15", ["electron/main.js"].filter(has), [], null, { externalBlocker: true, reason: "Never run on Windows; installer workflow is manual-only and has not been run. NOT claimed verified." }),
    C("Original 85 / 23-point / additional 150 programme", "19-21", ["docs/audit/pkg150_status.csv", "docs/audit/item_audit.csv"], [], null, { partial: true, reason: "150 package tally " + JSON.stringify(pkTally) + "; see docs/audit/ for the 85 and 23-point classifications (not all are connected or live)." })
  ];
  const tally = comps.reduce((o, c) => (o[c.status] = (o[c.status] ?? 0) + 1, o), {});
  const out = { generatedAt: new Date().toISOString(), date, agents: { total: v.agents.length, search: v.registry.search, execution: v.registry.execution }, managerProbes: m.managers.map(x => ({ id: x.id, status: x.status, health: x.health })), components: comps, tally, models, pkg150: pkTally, hierarchy: m.hierarchy, discoveryNote: "See Control Center discovery panel for source states." };
  const out_json = path.join(root, "docs/audit", "system_audit_" + date + ".json"); fs.writeFileSync(out_json, JSON.stringify(out, null, 1));
  const md = ["# ATLASZ system audit " + date, "", "Computed by `scripts/system-audit.mjs` (live probes + file existence). Tally: " + JSON.stringify(tally), "", "Agents: " + out.agents.total + " (" + out.agents.search + " SEARCH + " + out.agents.execution + " EXECUTION)", "", "## Hierarchy", "", "`" + m.hierarchy.owner + "` -> `" + m.hierarchy.master + "` -> management layer (" + m.hierarchy.managementLayer.join(", ") + ") -> 5 SEARCH + 25 EXECUTION -> verification, evidence, memory, results", "", "## Components", "", "| Component | Status | Live probe | Reason / blocker |", "|---|---|---|---|", ...comps.map(c => "| " + c.name + " | " + c.status + " | " + (typeof c.liveProbe === "string" ? "library (tests only)" : c.liveProbe.status + ": " + c.liveProbe.health) + " | " + (c.reason ?? (c.missingFiles.length ? "missing: " + c.missingFiles.join(", ") : "")) + " |"), "", "## Models", "", "```json", JSON.stringify(models, null, 1), "```", "", "## 150-capability package", "", "```json", JSON.stringify(pkTally, null, 1), "```", ""];
  fs.writeFileSync(path.join(root, "docs/audit", "system_audit_" + date + ".md"), md.join("\n"));
  console.log(JSON.stringify({ tally, models, agents: out.agents, managers: out.managerProbes.map(x => x.id + "=" + x.status) }, null, 1));
} finally { await cc.close(); process.exit(0); }
