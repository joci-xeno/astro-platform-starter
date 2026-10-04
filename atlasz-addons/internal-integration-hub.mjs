// ATLASZ internal add-on integration hub.
// Additive bridge only: no external sends, payments, deployments, secrets, or paid API calls.
import { priorityScore } from "./money-supervisor.mjs";
import { checkpoint as createCheckpoint } from "./checkpoint-engine.mjs";
import { createTaskLedger } from "./task-ledger.mjs";
import { progressEntry, summarizeProgress } from "./progress-ledger.mjs";
import { detectStall } from "./stall-replanner.mjs";
import { registerCapability } from "./capability-registry.mjs";
import { publish } from "./event-bus.mjs";
import { remember } from "./business-memory.mjs";
import { chooseRoute } from "./cost-model-router.mjs";
import { deadLetter } from "./dead-letter-queue.mjs";
import { guardAction, assertAllowed } from "./guardrail-engine.mjs";
import { runEvalSuite } from "./regression-eval-suite.mjs";
import { blackBoxRecord as trace } from "./observability-black-box.mjs";
import { recordAgentResult, rankAgents } from "./agent-portfolio-manager.mjs";
import { enqueue, next, configureLimit, acquire } from "./priority-queue-rate-limit-governor.mjs";
import { upsertEntity, linkEntities, entityView } from "./unified-entity-graph.mjs";
import { recordExperience, lessonsFor } from "./experience-learning-engine.mjs";
import { createClientDNA, getClientDNA } from "./client-dna-engine.mjs";
import { compileOutcome, validateOutcomePlan } from "./outcome-compiler.mjs";
import { registerAgentControl, authorize, controlPlaneStatus } from "./enterprise-control-plane.mjs";
import { setBudget, recordUsage, budgetStatus } from "./budget-consumption-governor.mjs";
import { reviewResult as reviewQA } from "./qa-reviewer.mjs";
import { summarize as summarizeProfit } from "./profit-ledger.mjs";
import { createAgentBlueprint, validateBlueprint, instantiateAgent, cloneBlueprint } from "./agent-factory.mjs";
import { buildBuyerQuery, normalizeContact, rankContacts, contactReady } from "./buyer-decision-maker-finder.mjs";
import { transition as transitionDeal } from "./deal-state.mjs";
import { createDelivery, requestDeliveryApproval, approveDelivery, markDelivered } from "./delivery-engine.mjs";
import { ingestKnowledge, retrieveKnowledge, buildGroundedContext, knowledgeHealth } from "./enterprise-knowledge-agentic-rag.mjs";
import { createExecutionJob, assignExecution, advanceExecution, executionToolPlan } from "./execution-factory.mjs";
import { registerTool, toolsFor, executionPlan, listTools } from "./executor-toolbox-registry.mjs";
import { nextFollowUp, stopOnReply } from "./follow-up-engine.mjs";
import { createInvoice, approveInvoice, markInvoiceSent } from "./invoice-engine.mjs";
import { assessMessage, negotiationNextAction, markAgreement } from "./negotiation-engine.mjs";
import { qualifyOpportunity, rankOpportunities, dedupeOpportunities } from "./opportunity-qualification-engine.mjs";
import { normalizePaymentEvent, confirmPaid } from "./payment-confirmation-adapter.mjs";
import { buildProposal, validateProposal, approveProposal } from "./proposal-quote-engine.mjs";
import { recoveryPlan } from "./recovery.mjs";
import { TaxAccountingEngine, taxIntentHint, TAX_CAPABILITY, TAX_STATES } from "./tax-accounting-engine.mjs";
import { traceEvent, evaluate, aggregateTraces } from "./tracing-evals.mjs";
import { registerConnector, resolveConnector, connectorHealth } from "./universal-connector-layer.mjs";
import { createGeneralCapabilityExtension, GENERAL_CAPABILITY_SLOTS } from "./general-intelligence-extensions.mjs";
import { createVoiceInterface, VOICE_CAPABILITY } from "./voice-interface.mjs";
import { TOOL_FABRIC_CATALOG, connectFabricTool, toolFabricList, toolFabricGet, toolFabricPlan, toolFabricSummary } from "./tool-fabric.mjs";
import { createComputerUseFabric, OWNER_AUTHORITY, COMPUTER_ACTION_LEVELS, classifyComputerAction } from "./computer-use-fabric.mjs";
import { seedAtlaszCompletionRegistry, trackCompletion, completionGet, completionList, completionSummary, COMPLETION_STATES } from "./completion-registry.mjs";
import { createToolBridge } from "./tool-bridge.mjs";
import { createMasterPlan, planReadySteps, routePlanStep, advanceMasterPlan, replanMasterPlan } from "./master-planner-orchestrator.mjs";
import { createProject, updateProject, projectGet, projectList, attachProjectEvidence } from "./shared-project-registry.mjs";
import { emergencyStatus, setEmergencyMode, emergencyGate } from "./emergency-stop.mjs";
import { buildProfitStatement, validateMoneyEntry } from "./profit-accounting-engine.mjs";
import { createSkillDefinition, testSkill, skillGet, skillList } from "./skill-factory.mjs";
import { selfHeal } from "./self-healing-loop.mjs";
import { inspectCoordination } from "./anti-collusion-guard.mjs";
import { registerModelProvider, modelProviderList, modelProviderHealth, selectModel, invokeModel, independentJudgePlan } from "./multi-model-brain.mjs";
import { analyzeMarketSignals, proposeSearchStrategy } from "./market-intelligence-engine.mjs";
import { createTeamLeadWorkflow, teamLeadDispatch } from "./team-lead-workflows.mjs";

const safe=(fn,...args)=>{try{return {ok:true,value:fn(...args)}}catch(e){return {ok:false,error:String(e?.message||e)}}};
export function createInternalAddonHub({tenantId="ATLASZ-MAIN",dailyBudgetUsd=0}={}){
  configureLimit("internal-events",{capacity:500,refillPerSecond:50});
  setBudget({scopeId:tenantId,period:"DAILY",limitUsd:Number(dailyBudgetUsd),warnAt:.8});
  const local={events:0,errors:[],startedAt:new Date().toISOString()};
  const generalCapabilities=createGeneralCapabilityExtension();
  const voice=createVoiceInterface();
  const computerUse=createComputerUseFabric();
  const toolBridge=createToolBridge({registerConnector,connectFabricTool,registerTool});
  seedAtlaszCompletionRegistry();
  function onAgentRegistered(agent){
    safe(registerAgentControl,{tenantId,agentId:agent.id,owner:"OWNER",permissions:["INTERNAL_STATE"],tools:[],risk:"NORMAL"});
    safe(registerCapability,agent.id,{capabilities:[agent.role==="SEARCH"?"DISCOVERY":"SCREENING"],tools:[],limits:["NO_EXTERNAL_SEND","NO_SPEND"]});
    safe(upsertEntity,{tenantId,type:"AGENT",id:agent.id,attributes:{role:agent.role,status:agent.status},source:"supervisor-safe"});
  }
  function onRuntimeEvent(type,details={}){
    const gate=acquire("internal-events",1); if(!gate.allowed)return {accepted:false,reason:"RATE_LIMIT"};
    local.events++;
    const eventType=String(type||"").toUpperCase();const published=safe(publish,eventType,{...details,source:"supervisor-safe"});if(!published.ok)local.errors.push({at:new Date().toISOString(),module:"event-bus",error:published.error,eventType});
    const traced=safe(trace,{agentId:details.agentId||null,workflowId:"ATLASZ_SAFE_RUNTIME",event:type,status:details.error?"ERROR":"OK",input:details});if(!traced.ok)local.errors.push({at:new Date().toISOString(),module:"black-box",error:traced.error,eventType});
    if(details.agentId) safe(upsertEntity,{tenantId,type:"AGENT",id:details.agentId,attributes:{lastEvent:type,lastEventAt:new Date().toISOString()},source:"runtime-event"});
    return {accepted:true};
  }
  function onCandidate(candidate,assessment){
    const score=safe(priorityScore,{value:assessment?.leadValue?.amount||0,probability:assessment?.score?Math.min(1,assessment.score/100):0,timeHours:1,friction:assessment?.reject?.length||0,recurring:false});
    safe(upsertEntity,{tenantId,type:"OPPORTUNITY",id:candidate.id,attributes:{status:candidate.status,score:score.value||0,source:candidate.source,url:candidate.url},source:"qualification"});
    if(candidate.foundBy)safe(linkEntities,{tenantId,fromType:"AGENT",fromId:candidate.foundBy,toType:"OPPORTUNITY",toId:candidate.id,relation:"FOUND",evidence:candidate.url});
    safe(enqueue,{id:candidate.id,type:"OPPORTUNITY"},{priority:Number(score.value||0),kind:"QUALIFICATION",dedupeKey:candidate.id});
    return score;
  }
  function onAgentResult({agentId,success=false,qaPassed=false,durationMs=0,error=false}){
    return safe(recordAgentResult,{agentId,success,qaPassed,durationMs,costUsd:0,valueUsd:0,error});
  }
  function snapshot(){
    return {enabled:true,mode:"INTERNAL_ONLY",externalSideEffects:false,eventsObserved:local.events,errors:local.errors,portfolio:safe(rankAgents).value||[],control:safe(controlPlaneStatus).value||null,budget:safe(budgetStatus,tenantId).value||null,generalCapabilities:generalCapabilities.summary(),voice:voice.status(),toolFabric:toolFabricSummary(),computerUse:computerUse.status(),completion:completionSummary(),emergency:emergencyStatus(),projects:{count:projectList().length},skills:{count:skillList().length},models:modelProviderHealth()};
  }
  return {onAgentRegistered,onRuntimeEvent,onCandidate,onAgentResult,snapshot,
    adapters:{
      createCheckpoint,createTaskLedger,progressEntry,summarizeProgress,detectStall,remember,chooseRoute,deadLetter,guardAction,assertAllowed,runEvalSuite,
      recordExperience,lessonsFor,createClientDNA,getClientDNA,compileOutcome,validateOutcomePlan,authorize,reviewQA,summarizeProfit,
      entityView,next,recordUsage,
      createAgentBlueprint,validateBlueprint,instantiateAgent,cloneBlueprint,
      buildBuyerQuery,normalizeContact,rankContacts,contactReady,
      transitionDeal,
      createDelivery,requestDeliveryApproval,approveDelivery,markDelivered,
      ingestKnowledge,retrieveKnowledge,buildGroundedContext,knowledgeHealth,
      createExecutionJob,assignExecution,advanceExecution,executionToolPlan,
      registerTool,toolsFor,executionPlan,listTools,
      nextFollowUp,stopOnReply,
      createInvoice,approveInvoice,markInvoiceSent,
      assessMessage,negotiationNextAction,markAgreement,
      qualifyOpportunity,rankOpportunities,dedupeOpportunities,
      normalizePaymentEvent,confirmPaid,
      buildProposal,validateProposal,approveProposal,
      recoveryPlan,
      TaxAccountingEngine,taxIntentHint,TAX_CAPABILITY,TAX_STATES,
      traceEvent,evaluate,aggregateTraces,
      registerConnector,resolveConnector,connectorHealth,
      GENERAL_CAPABILITY_SLOTS,generalCapabilityList:generalCapabilities.list,generalCapabilityGet:generalCapabilities.get,generalCapabilitySummary:generalCapabilities.summary,
      VOICE_CAPABILITY,voiceStatus:voice.status,voiceTranscribe:voice.transcribe,voiceSpeak:voice.speak,
      TOOL_FABRIC_CATALOG,connectFabricTool,toolFabricList,toolFabricGet,toolFabricPlan,toolFabricSummary,
      OWNER_AUTHORITY,COMPUTER_ACTION_LEVELS,classifyComputerAction,computerUseStatus:computerUse.status,computerUseAuthorize:computerUse.authorize,computerUseExecute:computerUse.execute,computerUseAudit:computerUse.audit,
      COMPLETION_STATES,trackCompletion,completionGet,completionList,completionSummary,toolBridgeAttach:toolBridge.attach,
      createMasterPlan,planReadySteps,routePlanStep,advanceMasterPlan,replanMasterPlan,
      createProject,updateProject,projectGet,projectList,attachProjectEvidence,
      emergencyStatus,setEmergencyMode,emergencyGate,
      buildProfitStatement,validateMoneyEntry,
      createSkillDefinition,testSkill,skillGet,skillList,
      selfHeal,inspectCoordination,
      registerModelProvider,modelProviderList,modelProviderHealth,selectModel,invokeModel,independentJudgePlan,
      analyzeMarketSignals,proposeSearchStrategy,
      createTeamLeadWorkflow,teamLeadDispatch
    }};
}
