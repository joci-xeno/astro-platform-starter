// Brain System assembly: one coordinated set of Brain modules sharing governance, black box and capability graph, persisted under <dir>.
// The 30-agent topology is the existing 5 SEARCH + 25 EXECUTION roster; this assembly creates no agents.
import path from "node:path";
import { emergencyGate } from "../emergency-stop.mjs";
import { createGovernance } from "./governance.mjs";
import { createBlackBox } from "./black-box.mjs";
import { createCapabilityGraph } from "./capability-graph.mjs";
import { createPlanningBrain } from "./planning-brain.mjs";
import { createVerifier } from "./verifier.mjs";
import { createSecurityBrain } from "./security-brain.mjs";
import { createOrchestrator, validateRoster } from "./orchestrator.mjs";
import { createKnowledgeBrain } from "./knowledge-brain.mjs";
import { createOpportunityIntelligence } from "./opportunity-intelligence.mjs";
import { createBusinessFactory } from "./business-factory.mjs";
import { createDisasterRecovery } from "./disaster-recovery.mjs";
import { createOwnerCommandLayer } from "./owner-command.mjs";
import { createModelIntelligence } from "./model-intelligence.mjs";
import { createSimulationLab } from "./simulation-lab.mjs";
import { createCentralBrain, createBrainBus } from "./central-brain.mjs";
import { computeBrainHealth } from "./brain-health.mjs";
import { createGovernedDispatch } from "./governed-dispatch.mjs";
import { createMemoryFabric } from "./memory-fabric.mjs";
import * as businessMemory from "../business-memory.mjs";
import * as experienceLearning from "../experience-learning-engine.mjs";
import { createEntityGraph } from "../business/entity-graph.mjs";

export function createBrainSystem({ dir, ownerAuth, roster = [], gate = emergencyGate, safeMode = null, chain = null, lookups = {}, dispatchOptions = {}, executors = {}, commandHandlers = {}, drActions = {}, sources = {}, redact = s => s, now = () => new Date().toISOString() } = {}) {
  if (!dir || !ownerAuth) throw new Error("DIR_AND_OWNER_AUTH_REQUIRED");
  const blackBox = createBlackBox({ filePath: path.join(dir, "blackbox.jsonl"), redact, now });
  const governance = createGovernance({ gate, ownerAuth, chain, safeGate: safeMode ? o => safeMode.gate(o) : null, auditPath: path.join(dir, "governance-audit.jsonl"), now });
  const graph = createCapabilityGraph({ file: path.join(dir, "capability-graph.json"), now });
  const planner = createPlanningBrain({ file: path.join(dir, "plans.json"), now });
  const verifier = createVerifier({ lookups });
  const security = createSecurityBrain({ ownerAuth, safeMode, blackBox, now });
  const knowledge = createKnowledgeBrain({ file: path.join(dir, "knowledge.json"), ownerAuth, now });
  const entityGraph = createEntityGraph({ file: path.join(dir, "entity-graph.json"), now, blackBox });
  const memory = createMemoryFabric({ knowledge, businessMemory, experience: experienceLearning, entityGraph, blackBox, now });
  const opportunity = createOpportunityIntelligence({ file: path.join(dir, "opportunities.json"), governance, now });
  const factory = createBusinessFactory({ file: path.join(dir, "services.json"), governance, now });
  const models = createModelIntelligence({ graph, now });
  const lab = createSimulationLab({ now, file: path.join(dir, "simulations.json") });
  const dr = createDisasterRecovery({ actions: drActions, governance, blackBox, now });
  const commands = createOwnerCommandLayer({ ownerAuth, handlers: commandHandlers, auditPath: path.join(dir, "owner-command-audit.jsonl"), now });
  const bus = createBrainBus({ blackBox });
  const topology = validateRoster(roster);
  for (const a of roster) if (!graph.get(a.id)) graph.upsert({ id: a.id, type: "AGENT", capabilities: a.capabilities ?? (a.team === "SEARCH" ? ["research", "discover"] : ["screen", "qualify", "scope"]), supportedTasks: a.team === "SEARCH" ? ["DISCOVER_PROJECT_REQUESTS"] : ["QUALIFY_DISCOVERED_REQUEST"] });
  const orchestrator = topology.ok ? createOrchestrator({ roster, graph, planner, governance, verifier, blackBox, security, executors }) : null;
  const dispatch = orchestrator ? createGovernedDispatch({ file: path.join(dir, "jobs.json"), planner, graph, orchestrator, blackBox, executionAgentIds: roster.filter(a => a.team === "EXECUTION").map(a => a.id), learn: ({ job, outcome }) => { if (outcome !== "VERIFIED") return; memory.recordOutcome({ tenantId: job.tenantId ?? "ATLASZ", jobId: job.id, taskType: job.kind, agentId: job.assignments?.at(-1)?.agentId ?? null, action: "GOVERNED_DISPATCH", outcome: "DONE", verification: job.verification, evidenceRef: job.verification?.verifierId ? { source: "INDEPENDENT_VERIFIER", reference: job.verification.verifierId + ":" + job.id } : null }); }, ...dispatchOptions }) : null;
  const central = createCentralBrain({ graph, planner, governance, sources, bus });
  const health = () => computeBrainHealth({ blackBox, verifier, planner, graph });
  const summary = () => ({ topology, orchestrator: orchestrator ? "READY" : "BLOCKED_TOPOLOGY_INVALID", capabilityGraph: graph.summary(), plans: planner.list().length, opportunities: opportunity.list().length, knowledge: knowledge.summary(), services: factory.list().length,
    security: security.status(), simulations: lab.runs().length, blackBox: { ...blackBox.stats(), chain: blackBox.verify().ok }, governanceAudit: governance.audit.verify().ok, models: models.health(), health: health().metrics, incidents: dr.incidents().length });
  return { entityGraph, memory, dispatch, blackBox, governance, graph, planner, verifier, security, knowledge, opportunity, factory, models, lab, dr, commands, bus, orchestrator, central, health, summary, topology };
}
