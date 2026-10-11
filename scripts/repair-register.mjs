// Generates the two owner-mandated registers from the computed integration matrix + curated overrides:
//   docs/audit/ATLASZ_V73_TOTAL_INTEGRATION_REPAIR.csv  (all audited modules + non-module gaps, nothing silently dropped)
//   docs/audit/ATLASZ_V73_DEFECT_REGISTER.csv
// Statuses that cannot be computed (repair_status, blocker, commit, verification) live in docs/audit/repair_overrides.json so re-generation never loses them.
// A module disappearing from the matrix would be reported as REMOVED_FROM_MATRIX (never deleted silently).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), A = p => path.join(root, "docs/audit", p);
const matrixFile = process.argv[2] ?? "integration_matrix_2026-10-11.json";
const M = JSON.parse(fs.readFileSync(A(matrixFile), "utf8"));
const O = fs.existsSync(A("repair_overrides.json")) ? JSON.parse(fs.readFileSync(A("repair_overrides.json"), "utf8")) : { modules: {}, defects: [], gaps: [] };
const csv = rows => { const cols = Object.keys(rows[0]); const q = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; return [cols.join(","), ...rows.map(r => cols.map(c => q(r[c])).join(","))].join("\n") + "\n"; };
// category rules: first match wins. [regex, category, responsible manager, phase, priority, securityRisk, ownerApproval]
const RULES = [
  [/owner-control\/|emergency-stop|safe-mode|approval-|owner-auth|owner-keystore|release-signing/, "SAFETY_APPROVAL", "SECURITY_APPROVAL_MANAGER", "PHASE5", "P1", "HIGH", "YES for any change of limits/keys"],
  [/financial-firewall|money-state|money-supervisor|budget-consumption|profit|invoice|payment|tax-accounting|financial-ledger|revenue|recurring|money-|finance|spend/, "FINANCE", "FINANCIAL_REVENUE_MANAGER", "PHASE9", "P1", "HIGH", "YES for every money movement"],
  [/credential-broker|secret|safe-keys|vault|api-key|egress|provider-egress|source-allowlist|security-gates|anti-collusion|guardrail|quarantine|browser-extension-guard|tenant-isolation|restricted-node|plugin-|malware/, "SECURITY", "SECURITY_APPROVAL_MANAGER", "PHASE5", "P1", "HIGH", "YES for credentials/network hosts"],
  [/scheduler|durable-queue|dead-letter|task-ledger|progress-ledger|stall-replanner|watchdog|startup-self-check|priority-queue|workflow-engine|checkpoint/, "SCHEDULING_RUNTIME", "TASK_SCHEDULER", "PHASE10", "P1", "MEDIUM", "NO (internal), YES for external effects"],
  [/recovery|backup|disaster|self-healing|system-doctor|recovery-points/, "RECOVERY", "RECOVERY_MAINTENANCE", "PHASE10", "P1", "MEDIUM", "YES for restore into non-empty target"],
  [/^atlasz-runtime\//, "RUNTIME_PROCESS", "RUNTIME_SUPERVISOR", "PHASE5", "P1", "MEDIUM", "NO"],
  [/agent-coordination|master-|handoff-ledger|agent-registry|agent-workforce|agent-executors|agent-factory|agent-portfolio|agent-activity|agent-child|agent-tool|executor-toolbox|execution-factory|tool-|team-lead|skill-|capability-registry|typed-tools/, "AGENTS_TOOLS", "WORKFORCE_MANAGER", "PHASE7", "P2", "MEDIUM", "YES for restricted tools"],
  [/brain\/|goal-planner|decision-analysis|debate-protocol|multi-solution|multi-model-brain|reasoning-common|digital-twin|org-intelligence|experience-learning|outcome-compiler|alt-solution|architecture-assessor|migration-planner|general-intelligence|human-core|orb-strategy|effort-allocation|analyst/, "BRAIN", "BRAIN_MANAGER", "PHASE4", "P2", "MEDIUM", "NO (advisory); YES for any action"],
  [/memory|knowledge|semantic-index|embedding|chunker|retrieval|project-memory|observation-memory|context-manager|doc-extractors|page-ingest|shared-project|research-ledger|unified-entity|business-memory|notes-organizer|spaced-repetition|tutor/, "MEMORY_KNOWLEDGE", "MEMORY_KNOWLEDGE_MANAGER", "PHASE10", "P2", "MEDIUM", "YES for embedding activation"],
  [/model-|provider-|local-ai|cost-model|ai-gateway|chat-providers|translation-feedback|tracing-evals|regression-eval/, "AI_MODELS", "AI_MODEL_MANAGER", "PHASE6", "P4", "HIGH", "YES for paid calls/downloads"],
  [/global-discovery|global-business|opportunity|eligibility|source-adapters|connector-catalog|universal-connector|buyer-decision|market-|campaign-manager|probe-evidence/, "DISCOVERY_BUSINESS_INTEL", "SEARCH_AGENT_MANAGER", "PHASE8", "P5", "MEDIUM", "YES for source hosts"],
  [/business\/|crm|deal-|negotiation|proposal-quote|follow-up|contract-analysis|client-dna|communication-center|delivery|social-drafts|inbox|claim-distinctions/, "BUSINESS", "FINANCIAL_REVENUE_MANAGER", "PHASE9", "P5", "HIGH", "YES for external communication/contracts"],
  [/update-center|local-update-adapters|release-signing|doc-sync/, "UPDATES", "RECOVERY_MAINTENANCE", "PHASE11", "P6", "HIGH", "YES for install"],
  [/^atlasz-control-center\//, "CONTROL_CENTER", "MASTER_COORDINATOR", "PHASE11", "P6", "MEDIUM", "NO"],
  [/computer-use|voice|mobile|a11y|modality|render|prototype|form-assistant|transcript|text-compare|detail-level|assistant-profiles|conversation|suggestions|preferences|master-brief|personal-command|tech-watch|document-center|mcp-client|code-|dev-assist|repo-analyzer|test-intelligence|sandbox|paper-trader|backtest|market-data|plugin/, "UX_DEV_TOOLS", "MASTER_COORDINATOR", "PHASE3", "P3", "LOW", "NO"]
];
const rule = f => RULES.find(r => r[0].test(f.replace("atlasz-addons/", "")) || r[0].test(f)) ?? [null, "GENERAL", "MASTER_COORDINATOR", "PHASE3", "P3", "LOW", "NO"];
const base = f => f.replace(/^atlasz-/, "").replace(/\.(mjs|js)$/, "");
const importsOf = f => { try { const s = fs.readFileSync(path.join(root, f), "utf8"); return [...new Set([...s.matchAll(/(?:from\s+|import\s*\(\s*)["'](\.[^"']+)["']/g)].map(m => path.basename(m[1]).replace(/\.(mjs|js)$/, "")))].slice(0, 8).join(";"); } catch { return ""; } };
const gate = O.gate ?? "gate not recorded";
const rows = M.rows.map(r => {
  const [, cat, mgr, phase, prio, risk, own] = rule(r.file), id = base(r.file), ov = O.modules[id] ?? {};
  const active = r.connectedToControlCenter || r.connectedToMaster || r.connectedToAgents;
  const status = ov.current_status ?? r.status;
  const isoDefect = !active ? "No runtime invocation path: nothing in the running Control Center, Master or agents imports/calls it." : "";
  const partial = r.whyNotVerified && active ? r.whyNotVerified : "";
  return {
    module_id: id, module_name: path.basename(id), source_path: r.file, category: cat, current_status: status,
    master_connection: r.connectedToMaster ? "STATIC_IMPORT" : ov.master_connection ?? "NONE", manager_connection: ov.manager_connection ?? (active ? "VIA_CONTROL_CENTER" : "NONE") + " (target " + mgr + ")",
    agent_connection: r.connectedToAgents ? "STATIC_IMPORT" : ov.agent_connection ?? "NONE", control_center_connection: r.connectedToControlCenter ? "STATIC_IMPORT" : ov.control_center_connection ?? "NONE",
    runtime_reachability: ov.runtime_reachability ?? (active ? "REACHABLE_STATIC" : "UNREACHABLE"), required_dependencies: importsOf(r.file),
    missing_functionality: ov.missing_functionality ?? (isoDefect || partial || ""), security_risk: risk + (!active && /SAFETY|FINANCE|SECURITY/.test(cat) ? " (protection not enforced at runtime)" : ""),
    defect_description: ov.defect_description ?? (isoDefect || partial), required_repair: ov.required_repair ?? (r.status === "VERIFIED_WORKING" && active ? "none" : active ? "add integration test through the owning manager" : "expose through " + mgr + " via the module broker; add authorized runtime invocation + integration test, or document legitimate offline activation"),
    integration_target: ov.integration_target ?? mgr, implementation_priority: ov.implementation_priority ?? prio, assigned_phase: ov.assigned_phase ?? phase,
    repair_status: ov.repair_status ?? (r.status === "VERIFIED_WORKING" && active ? "NO_REPAIR_NEEDED" : r.status === "EXTERNAL_BLOCKER" ? "EXTERNAL_BLOCKED" : "OPEN"),
    test_file: ov.test_file ?? r.testFiles.join(";"), test_result: ov.test_result ?? (r.unitOrIntegrationTests ? "PASS (" + gate + ")" : "NO_TEST"), runtime_evidence: ov.runtime_evidence ?? (r.connectedToControlCenter ? "loaded when Control Center boots (integration matrix)" : "none"),
    owner_approval_required: ov.owner_approval_required ?? own, blocker_reason: ov.blocker_reason ?? "", github_commit: ov.github_commit ?? ""
  };
});
// non-module gaps (components the audits name that do NOT exist as files) - never claimed to exist
const gaps = (O.gaps ?? []).map(g => ({ module_id: g.id, module_name: g.name, source_path: "NONE", category: g.category, current_status: g.status ?? "MISSING", master_connection: "NONE", manager_connection: "NONE (target " + g.manager + ")", agent_connection: "NONE", control_center_connection: "NONE", runtime_reachability: "NOT_IMPLEMENTED", required_dependencies: g.deps ?? "", missing_functionality: g.missing, security_risk: g.risk ?? "MEDIUM", defect_description: g.defect ?? g.missing, required_repair: g.repair, integration_target: g.manager, implementation_priority: g.priority ?? "P3", assigned_phase: g.phase, repair_status: g.repair_status ?? (/BLOCKED/.test(g.status ?? "") ? g.status : "OPEN"), test_file: g.test_file ?? "", test_result: g.test_result ?? "NO_TEST", runtime_evidence: g.runtime_evidence ?? "none", owner_approval_required: g.owner ?? "NO", blocker_reason: g.blocker ?? "", github_commit: g.github_commit ?? "" }));
const known = new Set(rows.map(r => r.module_id)); const removed = Object.keys(O.modules).filter(k => !known.has(k)).map(k => ({ module_id: k, module_name: k, source_path: "REMOVED_FROM_MATRIX", category: "REMOVED", current_status: "REMOVED_FROM_MATRIX", master_connection: "", manager_connection: "", agent_connection: "", control_center_connection: "", runtime_reachability: "", required_dependencies: "", missing_functionality: "module no longer present in the matrix", security_risk: "", defect_description: "", required_repair: "confirm intentional removal", integration_target: "", implementation_priority: "", assigned_phase: "", repair_status: "REVIEW", test_file: "", test_result: "", runtime_evidence: "", owner_approval_required: "", blocker_reason: "", github_commit: "" }));
const all = [...rows, ...gaps, ...removed];
fs.writeFileSync(A("ATLASZ_V73_TOTAL_INTEGRATION_REPAIR.csv"), csv(all));
const D = (O.defects ?? []); if (D.length) fs.writeFileSync(A("ATLASZ_V73_DEFECT_REGISTER.csv"), csv(D));
const tally = k => all.reduce((o, r) => (o[r[k]] = (o[r[k]] ?? 0) + 1, o), {});
console.log(JSON.stringify({ modules: rows.length, gaps: gaps.length, defects: D.length, unreachable: rows.filter(r => r.runtime_reachability === "UNREACHABLE").length, repair_status: tally("repair_status"), categories: tally("category") }));
