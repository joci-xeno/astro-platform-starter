// ATLASZ Universal MASTER Planner / Orchestrator v1.0
const uid=()=>globalThis.crypto?.randomUUID?.()||("plan-"+Date.now());
export function createMasterPlan({objective,constraints=[],doneDefinition=[],context={},steps=[]}={}){
 if(!objective)throw new Error("OBJECTIVE_REQUIRED");
 const normalized=(steps.length?steps:[{title:objective,requires:[],dependsOn:[]}]).map((s,i)=>({id:s.id||`STEP-${i+1}`,title:s.title||`Step ${i+1}`,goal:s.goal||s.title||objective,requires:[...(s.requires||[])],dependsOn:[...(s.dependsOn||[])],role:s.role||null,status:"PLANNED"}));
 return {planId:uid(),objective,constraints:[...constraints],doneDefinition:[...doneDefinition],context,steps:normalized,status:"PLANNED",createdAt:new Date().toISOString()};
}
export function planReadySteps(plan){const done=new Set(plan.steps.filter(s=>s.status==="DONE").map(s=>s.id));return plan.steps.filter(s=>["PLANNED","RETRY"].includes(s.status)&&s.dependsOn.every(d=>done.has(d)));}
export function routePlanStep(step,{capabilityPlanner,agents=[]}={}){
 const toolPlan=capabilityPlanner?capabilityPlanner(step.requires||[]):{required:step.requires||[],selected:[],missing:step.requires||[],ready:(step.requires||[]).length===0};
 const candidates=agents.filter(a=>!step.role||a.role===step.role).filter(a=>!a.status||["READY","RUNNING","IDLE","READY_FOR_RUNTIME"].includes(a.status));
 return {stepId:step.id,toolPlan,agentId:candidates[0]?.id||null,ready:toolPlan.ready&&candidates.length>0,blockers:[...(toolPlan.missing||[]),...(candidates.length?[]:["NO_AGENT"])]};
}
export function advanceMasterPlan(plan,{stepId,result,qa}={}){
 if(!plan?.steps?.some(s=>s.id===stepId))throw new Error("PLAN_STEP_NOT_FOUND");if(!qa||!["PASS","FAIL"].includes(qa.status))throw new Error("VALID_QA_RESULT_REQUIRED");
 const steps=plan.steps.map(s=>s.id!==stepId?s:{...s,status:qa.status==="PASS"?"DONE":"RETRY",result:qa.status==="PASS"?result:null,lastQA:qa,updatedAt:new Date().toISOString()});
 const complete=steps.every(s=>s.status==="DONE");return {...plan,steps,status:complete?"DONE":"ACTIVE",updatedAt:new Date().toISOString()};
}
export function replanMasterPlan(plan,{reason,newSteps=[]}={}){return {...plan,status:"REPLANNED",replanReason:reason||"NEW_INFORMATION",steps:[...plan.steps,...newSteps.map((s,i)=>({id:s.id||`REPLAN-${Date.now()}-${i+1}`,...s,status:"PLANNED"}))],updatedAt:new Date().toISOString()};}
