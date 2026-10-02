// ATLASZ internal add-on integration hub.
// Additive bridge only: no external sends, payments, deployments, secrets, or paid API calls.
import { priorityScore } from "./money-supervisor.mjs";
import { createCheckpoint } from "./checkpoint-engine.mjs";
import { createTaskLedger } from "./task-ledger.mjs";
import { addProgress } from "./progress-ledger.mjs";
import { detectStall } from "./stall-replanner.mjs";
import { registerCapability } from "./capability-registry.mjs";
import { publish } from "./event-bus.mjs";
import { remember } from "./business-memory.mjs";
import { chooseRoute } from "./cost-model-router.mjs";
import { deadLetter } from "./dead-letter-queue.mjs";
import { checkGuardrail } from "./guardrail-engine.mjs";
import { runEvalSuite } from "./regression-eval-suite.mjs";
import { trace } from "./observability-black-box.mjs";
import { recordAgentResult, rankAgents } from "./agent-portfolio-manager.mjs";
import { enqueue, next, configureLimit, acquire } from "./priority-queue-rate-limit-governor.mjs";
import { upsertEntity, linkEntities, entityView } from "./unified-entity-graph.mjs";
import { recordExperience, lessonsFor } from "./experience-learning-engine.mjs";
import { createClientDNA, getClientDNA } from "./client-dna-engine.mjs";
import { compileOutcome, validateOutcomePlan } from "./outcome-compiler.mjs";
import { registerAgentControl, authorize, controlPlaneStatus } from "./enterprise-control-plane.mjs";
import { setBudget, recordUsage, budgetStatus } from "./budget-consumption-governor.mjs";
import { reviewQA } from "./qa-reviewer.mjs";
import { summarizeProfit } from "./profit-ledger.mjs";

const safe=(fn,...args)=>{try{return {ok:true,value:fn(...args)}}catch(e){return {ok:false,error:String(e?.message||e)}}};
export function createInternalAddonHub({tenantId="ATLASZ-MAIN",dailyBudgetUsd=0}={}){
  configureLimit("internal-events",{capacity:500,refillPerSecond:50});
  setBudget({scopeId:tenantId,period:"DAILY",limitUsd:Number(dailyBudgetUsd),warnAt:.8});
  const local={events:0,errors:[],startedAt:new Date().toISOString()};
  function onAgentRegistered(agent){
    safe(registerAgentControl,{tenantId,agentId:agent.id,owner:"OWNER",permissions:["INTERNAL_STATE"],tools:[],risk:"NORMAL"});
    safe(registerCapability,{agentId:agent.id,capabilities:[agent.role==="SEARCH"?"DISCOVERY":"SCREENING"],tools:[],limits:["NO_EXTERNAL_SEND","NO_SPEND"]});
    safe(upsertEntity,{tenantId,type:"AGENT",id:agent.id,attributes:{role:agent.role,status:agent.status},source:"supervisor-safe"});
  }
  function onRuntimeEvent(type,details={}){
    const gate=acquire("internal-events",1); if(!gate.allowed)return {accepted:false,reason:"RATE_LIMIT"};
    local.events++;
    safe(publish,{type:type.toUpperCase(),payload:details,source:"supervisor-safe"});
    safe(trace,{agentId:details.agentId||null,workflow:"ATLASZ_SAFE_RUNTIME",event:type,status:details.error?"ERROR":"OK",details});
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
    return {enabled:true,mode:"INTERNAL_ONLY",externalSideEffects:false,eventsObserved:local.events,errors:local.errors,portfolio:safe(rankAgents).value||[],control:safe(controlPlaneStatus).value||null,budget:safe(budgetStatus,tenantId).value||null};
  }
  return {onAgentRegistered,onRuntimeEvent,onCandidate,onAgentResult,snapshot,
    adapters:{createCheckpoint,createTaskLedger,addProgress,detectStall,remember,chooseRoute,deadLetter,checkGuardrail,runEvalSuite,recordExperience,lessonsFor,createClientDNA,getClientDNA,compileOutcome,validateOutcomePlan,authorize,reviewQA,summarizeProfit,entityView,next,recordUsage}};
}
