// Registrations: the agent / tool layer (capability registry, toolbox, tool fabric, connectors, factories, ledgers). Everything here is about the FIXED 30 agents (5 SEARCH + 25 EXECUTION):
// nothing creates a 31st identity, nothing widens a tool permission and no external adapter is claimed. The Agent Tool Broker stays the only path from an agent to a tool.
import { ANY, str, num, int, bool, arr, obj, cap, POLICY } from "./_util.mjs";
import { ROSTER } from "../agent-registry.mjs";
import { permissionFor } from "../agent-tool-policy.mjs";
import { COMBINED_POLICY } from "../agent-tool-policy-ext.mjs";
import { registerCapability, matchAgents, listCapabilities } from "../capability-registry.mjs";
import { registerTool, toolsFor, executionPlan, listTools, TOOL_CATEGORIES } from "../executor-toolbox-registry.mjs";
import { TOOL_FABRIC_CATALOG, toolFabricList, toolFabricSummary, toolFabricPlan } from "../tool-fabric.mjs";
import { registerConnector, resolveConnector, connectorHealth } from "../universal-connector-layer.mjs";
import { createAgentBlueprint, validateBlueprint } from "../agent-factory.mjs";
import { createExecutionJob, assignExecution, advanceExecution, executionToolPlan, EXECUTION_STAGES } from "../execution-factory.mjs";
import { createTeamLeadWorkflow, teamLeadDispatch } from "../team-lead-workflows.mjs";
import { createSkillDefinition, skillGet, skillList } from "../skill-factory.mjs";
import { recordAgentResult, rankAgents } from "../agent-portfolio-manager.mjs";
import { recordExperience, lessonsFor } from "../experience-learning-engine.mjs";
import { compileOutcome, validateOutcomePlan, requestExecution } from "../outcome-compiler.mjs";
import { completionSummary, completionList, seedAtlaszCompletionRegistry, trackCompletion } from "../completion-registry.mjs";
import { remember, recall } from "../business-memory.mjs";

const plain = x => JSON.parse(JSON.stringify(x ?? null));
const slug = id => String(id).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const isAgent = id => ROSTER.includes(id);
const SAFE_OPS = new Set(["READ_STATUS", "INTERNAL_COMPUTE"]);
const CATEGORY_OF = { FINANCIAL_REVENUE_MANAGER: "FINANCE", CAMPAIGN_MANAGER: "CRM", MEMORY_KNOWLEDGE_MANAGER: "DATA", QUALITY_ASSURANCE: "TEST", RECOVERY_MAINTENANCE: "DEVOPS", TASK_SCHEDULER: "PRODUCTIVITY", WORKFORCE_MANAGER: "PRODUCTIVITY", SEARCH_AGENT_MANAGER: "RESEARCH", GLOBAL_BUSINESS_INTELLIGENCE: "RESEARCH", BRAIN_MANAGER: "RESEARCH", AI_MODEL_MANAGER: "RESEARCH", EXECUTION_AGENT_MANAGER: "CODE", RUNTIME_SUPERVISOR: "DEVOPS", SECURITY_APPROVAL_MANAGER: "DEVOPS", MASTER_COORDINATOR: "PRODUCTIVITY" };

export function registerAgents(broker, ctx) {
  // ---- the catalogue: capability registry + executor toolbox + connector layer, all fed from real, probed broker modules
  const sync = async () => {
    // capabilities per identity come from the owner-approved policy table (base + pending-review extension): an agent lists exactly the tools the Agent Tool Broker would allow it
    const tools = Object.keys(COMBINED_POLICY);
    let agents = 0;
    for (const id of ROSTER) {
      const role = id.startsWith("SEARCH") ? "SEARCH" : "EXECUTION";
      const allowed = tools.filter(t => permissionFor(role, t, COMBINED_POLICY) !== "DENY" && !COMBINED_POLICY[t].disabled);
      registerCapability(id, { capabilities: [role === "SEARCH" ? "opportunity.discovery" : "task.execution", ...allowed.map(t => "tool:" + t)], tools: allowed, limits: ["agent-tool-broker limits"], costClass: "FREE" }); agents++;
    }
    // toolbox: only modules whose health probe PASSED right now, recorded with real probe evidence. Internal modules are not "external tools": the adapter says so.
    const health = await broker.healthAll(); let tools_ = 0;
    for (const h of health) {
      if (h.state !== "HEALTHY") continue; const m = broker.get(h.id); if (!m || m.lifecycle === "SUPERSEDED") continue;
      const evidence = { probeId: "broker-health:" + h.id + ":" + h.at, outcome: "PASS", at: h.at, target: "module:" + h.id };
      const byCap = m.capabilities.filter(c => SAFE_OPS.has(c.operation));
      if (!byCap.length) continue;
      registerTool({ id: "module:" + h.id, category: CATEGORY_OF[m.manager] ?? "PRODUCTIVITY", capabilities: byCap.map(c => c.tool), available: true, requiresApproval: false, costClass: "FREE", adapter: { kind: "INTERNAL_MODULE_BROKER", module: h.id }, probeEvidence: evidence }); tools_++;
    }
    registerConnector({ id: "atlasz-module-broker", tenantId: "ATLASZ", capabilities: ["internal-modules"], permissions: ["control-chain"], status: "TESTED", adapter: { kind: "INTERNAL_MODULE_BROKER" }, probeEvidence: { probeId: "broker-summary:" + Date.now(), outcome: "PASS", at: new Date().toISOString(), target: "module-broker" } });
    return { agents, toolboxEntries: tools_, externalToolsLive: toolFabricSummary().live };
  };
  broker.register({ id: "agent-tool-catalog", source: "atlasz-addons/registrations/agents.mjs", manager: "WORKFORCE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Catalogue of what the 30 agents can do: capability registry per identity (derived from the Agent Tool Broker policy), executor toolbox (only modules with a PASSING health probe, evidence recorded), connector layer (internal broker connector only) and the Tool Fabric (external tools stay PLACEHOLDER_UNCONNECTED: no external adapter exists).",
    capabilities: [
      cap("sync", "INTERNAL_COMPUTE", async () => plain(await sync()), { description: "Rebuild the registries from the roster, the policy table and current module health.", timeoutMs: 60000 }),
      cap("match_agents", "READ_STATUS", a => ({ agents: plain(matchAgents(a.capabilities ?? []).map(x => ({ agentId: x.agentId, capabilities: x.capabilities.length }))) }), { input: obj({ capabilities: arr(str({ maxLength: 120 })) }) }),
      cap("plan", "READ_STATUS", a => plain({ toolbox: executionPlan(a.required ?? []), fabric: toolFabricPlan(a.required ?? []) }), { input: obj({ required: arr(str({ maxLength: 120 })) }) }),
      cap("summary", "READ_STATUS", () => plain({ agents: listCapabilities().length, toolbox: listTools().length, connectors: connectorHealth("ATLASZ"), fabric: toolFabricSummary(), categories: TOOL_CATEGORIES.length }))
    ],
    selfTest: { capability: "summary", expect: r => (r.fabric?.catalogued === TOOL_FABRIC_CATALOG.length ? true : "fabric catalogue") } });
  for (const [id, file, what] of [
    ["capability-registry", "capability-registry.mjs", "capability registry (agent > capabilities/tools/limits/cost class)"],
    ["executor-toolbox-registry", "executor-toolbox-registry.mjs", "executor toolbox (a tool may be 'available' only with a real adapter AND valid probe evidence)"],
    ["universal-connector-layer", "universal-connector-layer.mjs", "tenant-scoped connector layer (a connector is TESTED only with an adapter and valid probe evidence)"],
    ["tool-fabric", "tool-fabric.mjs", "Tool Fabric catalogue of external tool categories (every entry PLACEHOLDER_UNCONNECTED until a real adapter is connected and tested)"]
  ]) broker.register({ id, source: "atlasz-addons/" + file, manager: "WORKFORCE_MANAGER", lifecycle: "INTERNAL_LIBRARY", consumer: "agent-tool-catalog", policy: POLICY.low, purpose: "The " + what + "; hosted and fed by agent-tool-catalog." });
  broker.register({ id: "tool-bridge", source: "atlasz-addons/tool-bridge.mjs", manager: "WORKFORCE_MANAGER", lifecycle: "OFFLINE_ACTIVATED", policy: POLICY.external,
    activation: "Used only when an EXTERNAL adapter (a connected, authenticated tool) is attached after the owner approved its host and credential; it then synchronises connector, fabric and toolbox without marking an untested adapter LIVE. No external adapter exists today.",
    purpose: "Synchronises one real adapter across the connector layer, the Tool Fabric and the executor toolbox; never marks an untested adapter LIVE." });

  // ---- agent factory: definitions and the governor's admission check only; there is no activation path here (the roster is a fixed 30)
  broker.register({ id: "agent-factory", source: "atlasz-addons/agent-factory.mjs", manager: "WORKFORCE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.security,
    purpose: "Agent blueprints (validated definitions) and the governor's admission check. A blueprint for any identity outside the fixed roster (a would-be 31st agent) is refused; activation is NOT exposed (a topology change is a governed release, not a runtime action).",
    capabilities: [
      cap("blueprint", "INTERNAL_COMPUTE", a => plain(createAgentBlueprint(a)), { input: obj({ name: str({ maxLength: 80 }), role: str({ maxLength: 20 }), goal: str({ maxLength: 400 }), capabilities: arr(str({ maxLength: 120 })), tools: arr(str({ maxLength: 120 })), guardrails: arr(str({ maxLength: 120 })), modelPolicy: str({ maxLength: 40 }), approvalPolicy: str({ maxLength: 40 }) }, ["name", "role", "goal"]) }),
      cap("validate", "READ_STATUS", a => plain(validateBlueprint(a.blueprint)), { input: obj({ blueprint: ANY }, ["blueprint"]) }),
      cap("admission_check", "INTERNAL_COMPUTE", a => { const g = ctx.ownerControl().agents; const r = g.admit(a.blueprint); return plain({ admitted: r.admitted, reason: r.reason, checks: r.checks }); }, { input: obj({ blueprint: ANY }, ["blueprint"]), description: "Run the Agent Governor admission checks (identity, role, topology, capabilities, permissions, control chain) and report; nothing is activated." })
    ],
    selfTest: { capability: "admission_check", args: { blueprint: { agentId: "EXECUTION-31", role: "EXECUTION", name: "x", goal: "y", approvalPolicy: "HUMAN_FOR_HIGH_RISK", capabilities: [], tools: [] } }, expect: r => (r.admitted === false && /IDENTITY_KNOWN/.test(r.reason) ? true : "a 31st agent must be refused") } });
  broker.register({ id: "execution-factory", source: "atlasz-addons/execution-factory.mjs", manager: "EXECUTION_AGENT_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.draft,
    purpose: "Execution jobs PLAN > EXECUTE > TEST > QA > FIX > PACKAGE with a tool plan per work type. Moving to DELIVERY_APPROVAL needs a QA pass and READY_TO_DELIVER needs a signed owner approval: neither flag can be supplied through the broker, so those two stages are not reachable here.",
    capabilities: [
      cap("create", "INTERNAL_COMPUTE", a => plain(createExecutionJob(a)), { input: obj({ jobId: str({ maxLength: 120 }), dealId: str({ maxLength: 120 }), client: str({ maxLength: 200 }), scope: str({ maxLength: 4000 }), acceptanceCriteria: arr(str({ maxLength: 400 })), deadline: str({ maxLength: 40 }), toolProfile: str({ maxLength: 20 }) }, ["jobId", "dealId", "scope"]) }),
      cap("assign", "INTERNAL_COMPUTE", a => { if (!/^EXECUTION-/.test(a.agentId) || !isAgent(a.agentId)) throw new Error("EXECUTION_AGENT_REQUIRED"); return plain(assignExecution(a.job, a.agentId)); }, { input: obj({ job: ANY, agentId: str({ maxLength: 40 }) }, ["job", "agentId"]) }),
      cap("advance", "INTERNAL_COMPUTE", a => { if (["DELIVERY_APPROVAL", "READY_TO_DELIVER"].includes(a.next)) throw new Error("STAGE_REQUIRES_QA_PASS_OR_OWNER_APPROVAL_NOT_AVAILABLE_HERE"); return plain(advanceExecution(a.job, a.next, {})); }, { input: obj({ job: ANY, next: { type: "string", enum: [...EXECUTION_STAGES] } }, ["job", "next"]) }),
      cap("tool_plan", "READ_STATUS", a => ({ tools: executionToolPlan(a.type) }), { input: obj({ type: str({ maxLength: 20 }) }) })
    ],
    selfTest: { capability: "tool_plan", args: { type: "SOFTWARE" }, expect: r => (r.tools.includes("test_runner") ? true : "plan") } });
  broker.register({ id: "team-lead-workflows", source: "atlasz-addons/team-lead-workflows.mjs", manager: "WORKFORCE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Team-lead coordination inside the fixed 5+25 topology: a team's lead and members must be roster identities, and a lead cannot be its own member; dispatch only for tasks that belong to the Master workflow.",
    capabilities: [
      cap("create", "INTERNAL_COMPUTE", a => { for (const id of [a.leadAgentId, ...(a.memberAgentIds ?? [])]) if (!isAgent(id)) throw new Error("NOT_IN_FIXED_ROSTER:" + id); return plain(createTeamLeadWorkflow(a)); }, { input: obj({ teamId: str({ maxLength: 80 }), leadAgentId: str({ maxLength: 40 }), memberAgentIds: arr(str({ maxLength: 40 })), objective: str({ maxLength: 400 }), taskIds: arr(str({ maxLength: 120 })) }, ["teamId", "leadAgentId", "objective"]) }),
      cap("dispatch", "INTERNAL_COMPUTE", a => plain(teamLeadDispatch(a.workflow, { taskId: a.taskId, agentId: a.agentId })), { input: obj({ workflow: ANY, taskId: str({ maxLength: 120 }), agentId: str({ maxLength: 40 }) }, ["workflow", "taskId", "agentId"]) })
    ],
    selfTest: { capability: "create", args: { teamId: "t", leadAgentId: "EXECUTION-1", memberAgentIds: ["EXECUTION-2"], objective: "o", taskIds: ["x"] }, expect: r => (r.leadAgentId === "EXECUTION-1" ? true : "workflow") } });
  broker.register({ id: "skill-factory", source: "atlasz-addons/skill-factory.mjs", manager: "WORKFORCE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.draft,
    purpose: "Skill definitions in PLANNED state (process-local list). Attaching code and testing a skill needs a code body and a real test function, which are deliberately not accepted from a tool caller; a skill becomes TESTED only through a reviewed code change.",
    capabilities: [
      cap("plan", "INTERNAL_COMPUTE", a => plain(createSkillDefinition({ id: a.id, goal: a.goal, requiredCapabilities: a.requiredCapabilities ?? [], risk: a.risk })), { input: obj({ id: str({ maxLength: 80 }), goal: str({ maxLength: 400 }), requiredCapabilities: arr(str({ maxLength: 120 })), risk: str({ maxLength: 20 }) }, ["id", "goal"]) }),
      cap("get", "READ_STATUS", a => ({ skill: plain(skillGet(a.id)) }), { input: obj({ id: str({ maxLength: 80 }) }, ["id"]) }),
      cap("list", "READ_STATUS", () => ({ skills: plain(skillList()) }))
    ],
    selfTest: { capability: "list", expect: r => (Array.isArray(r.skills) ? true : "list") } });
  broker.register({ id: "agent-portfolio-manager", source: "atlasz-addons/agent-portfolio-manager.mjs", manager: "WORKFORCE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Per-agent results (runs, successes, QA passes, errors, duration, cost, value) and a ranking by net value; `rebuild` refills it from the workforce task ledger (VERIFIED = success) so the numbers come from recorded work, not narrative.",
    capabilities: [
      cap("record", "INTERNAL_COMPUTE", a => { if (!isAgent(a.agentId)) throw new Error("NOT_IN_FIXED_ROSTER"); return plain(recordAgentResult(a)); }, { input: obj({ agentId: str({ maxLength: 40 }), success: bool(), qaPassed: bool(), durationMs: num({ minimum: 0 }), costUsd: num({ minimum: 0 }), valueUsd: num({ minimum: 0 }), error: bool() }, ["agentId"]) }),
      cap("rank", "READ_STATUS", () => ({ ranking: plain(rankAgents()) })),
      cap("rebuild", "INTERNAL_COMPUTE", () => { const tasks = ctx.workforceTasks?.() ?? []; let n = 0; for (const t of tasks) if (isAgent(t.agentId) && ["VERIFIED", "DEAD_LETTER", "REJECTED_FINAL"].includes(t.status)) { recordAgentResult({ agentId: t.agentId, success: t.status === "VERIFIED", qaPassed: t.status === "VERIFIED", error: t.status !== "VERIFIED", costUsd: Number(t.costUsd) || 0 }); n++; } return { replayed: n, tasks: tasks.length }; })
    ],
    selfTest: { capability: "rank", expect: r => (Array.isArray(r.ranking) ? true : "ranking") } });
  broker.register({ id: "experience-learning-engine", source: "atlasz-addons/experience-learning-engine.mjs", manager: "MEMORY_KNOWLEDGE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.draft,
    purpose: "Records task experiences (action, outcome, evidence, reward, cost, lessons). A lesson is reusable ONLY after a signed owner approval; approval is not exposed here, so lessons_for returns approved lessons only.",
    capabilities: [
      cap("record", "INTERNAL_COMPUTE", a => plain(recordExperience(a)), { input: obj({ tenantId: str({ maxLength: 40 }), agentId: str({ maxLength: 40 }), taskType: str({ maxLength: 80 }), action: str({ maxLength: 200 }), outcome: str({ maxLength: 200 }), evidence: ANY, reward: num(), costUsd: num({ minimum: 0 }), lessons: arr(str({ maxLength: 400 })) }, ["tenantId", "taskType", "outcome"]) }),
      cap("lessons_for", "READ_STATUS", a => ({ lessons: plain(lessonsFor(a)) }), { input: obj({ tenantId: str({ maxLength: 40 }), taskType: str({ maxLength: 80 }) }, ["tenantId", "taskType"]) })
    ],
    selfTest: { capability: "lessons_for", args: { tenantId: "SELFTEST", taskType: "none" }, expect: r => (Array.isArray(r.lessons) && r.lessons.length === 0 ? true : "unapproved lessons must not be returned") } });
  broker.register({ id: "outcome-compiler", source: "atlasz-addons/outcome-compiler.mjs", manager: "BRAIN_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Turns an owner outcome plus constraints into a staged plan skeleton (DISCOVER > PLAN > EXECUTE > TEST > QA > APPROVAL > DELIVER), checks it against available capabilities/tools, and can only request execution (never approve it).",
    capabilities: [
      cap("compile", "INTERNAL_COMPUTE", a => plain(compileOutcome(a)), { input: obj({ outcome: str({ maxLength: 1000 }), constraints: arr(ANY), acceptanceCriteria: arr(ANY), availableCapabilities: arr(str({ maxLength: 120 })), availableTools: arr(str({ maxLength: 120 })) }, ["outcome"]) }),
      cap("validate", "READ_STATUS", a => plain(validateOutcomePlan(a.plan, { capabilityMatches: a.capabilityMatches ?? [], toolMatches: a.toolMatches ?? [] })), { input: obj({ plan: ANY, capabilityMatches: arr(str({ maxLength: 120 })), toolMatches: arr(str({ maxLength: 120 })) }, ["plan"]) }),
      cap("request_execution", "INTERNAL_COMPUTE", a => plain(requestExecution(a.plan, { ownerApprovalRequired: a.ownerApprovalRequired === true, ownerApproved: false })), { input: obj({ plan: ANY, ownerApprovalRequired: bool() }, ["plan"]) })
    ],
    selfTest: { capability: "compile", args: { outcome: "x" }, expect: r => (r.stages?.length === 7 ? true : "stages") } });
  broker.register({ id: "unified-entity-graph", source: "atlasz-addons/unified-entity-graph.mjs", manager: "MEMORY_KNOWLEDGE_MANAGER", lifecycle: "SUPERSEDED", supersededBy: "business/entity-graph", policy: POLICY.low,
    purpose: "Process-local entity/edge map.", rationale: "business/entity-graph is the tenant-isolated, evidence-linked entity graph that the CRM and Money Engine already run on; a second in-memory graph would hold divergent customer state." });
  broker.register({ id: "business-memory", source: "atlasz-addons/business-memory.mjs", manager: "MEMORY_KNOWLEDGE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Process-local business notes per entity (importance 0..1, optional expiry). Durable, access-controlled agent memory lives in the memory gateway; this store is a convenience for short-lived notes and is empty after a restart.",
    capabilities: [
      cap("remember", "INTERNAL_COMPUTE", a => plain(remember(a)), { input: obj({ entityType: str({ maxLength: 40 }), entityId: str({ maxLength: 120 }), category: str({ maxLength: 40 }), text: str({ maxLength: 1000 }), importance: num({ minimum: 0, maximum: 1 }), source: str({ maxLength: 120 }), expiresAt: str({ maxLength: 40 }) }, ["entityType", "entityId", "text"]) }),
      cap("recall", "READ_STATUS", a => ({ memories: plain(recall(a)) }), { input: obj({ entityType: str({ maxLength: 40 }), entityId: str({ maxLength: 120 }), category: str({ maxLength: 40 }), limit: int({ minimum: 1, maximum: 100 }) }) })
    ],
    selfTest: { capability: "recall", args: { entityType: "__selftest__" }, expect: r => (Array.isArray(r.memories) ? true : "recall") } });
  // completion-registry holds CLAIM states (PLANNED ... LIVE) typed by developers; the module reports them as claims and the self-test proves none is LIVE without evidence.
  broker.register({ id: "completion-registry", source: "atlasz-addons/completion-registry.mjs", manager: "MASTER_COORDINATOR", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Developer-declared requirement states (PLANNED ... BLOCKED). These are CLAIMS, not evidence: the registry never turns anything LIVE and the integration/defect registers are authoritative. Exposed read-only.",
    capabilities: [cap("summary", "READ_STATUS", () => { seedAtlaszCompletionRegistry(); return plain({ ...completionSummary(), kind: "CLAIMS_NOT_EVIDENCE" }); })],
    selfTest: { capability: "summary", expect: r => (r.byState.LIVE === 0 && r.kind === "CLAIMS_NOT_EVIDENCE" ? true : "no claim may be LIVE") } });
  broker.register({ id: "agent-tool-broker", source: "atlasz-addons/agent-tool-broker.mjs", manager: "WORKFORCE_MANAGER", lifecycle: "CONTINUOUS", policy: POLICY.security,
    purpose: "The only path from one of the 30 agents to a typed tool: fixed roster, kill switch, per-agent and per-job limits, role policy (deny by default, re-validated against the registered tool), control chain, result cap and audit. Hosted by the Control Center; this module reports its state and what each identity may call.",
    capabilities: [
      cap("stats", "READ_STATUS", () => plain(ctx.agentToolBroker().stats())),
      cap("describe_for", "READ_STATUS", a => { if (!isAgent(a.agentId)) throw new Error("NOT_IN_FIXED_ROSTER"); return { agentId: a.agentId, tools: plain(ctx.agentToolBroker().describeFor(a.agentId).map(t => t.name)) }; }, { input: obj({ agentId: str({ maxLength: 40 }) }, ["agentId"]) }),
      cap("policy_report", "READ_STATUS", () => { const p = ctx.agentToolBroker().policyReport(); return { tools: Object.keys(p).length, allowSearch: Object.values(p).filter(e => e.SEARCH === "ALLOW" && !e.disabled).length, allowExecution: Object.values(p).filter(e => e.EXECUTION === "ALLOW" && !e.disabled).length, disabled: Object.values(p).filter(e => e.disabled).map(e => e.tool) }; })
    ],
    selfTest: { capability: "stats", expect: r => (typeof r.calls === "number" ? true : "stats") } });
  return { sync };
}
