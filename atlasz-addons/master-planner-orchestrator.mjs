// ATLASZ Universal MASTER Planner / Orchestrator v1.0
const uid=()=>globalThis.crypto?.randomUUID?.()||("plan-"+Date.now());
export function createMasterPlan({objective,constraints=[],doneDefinition=[],context={},steps=[]}={}){
 if(!objective)throw new Error("OBJECTIVE_REQUIRED");
 if(!Array.isArray(constraints)||!Array.isArray(doneDefinition)||!Array.isArray(steps))throw new Error("PLAN_ARRAYS_REQUIRED");
 const normalized=(steps.length?steps:[{title:objective,requires:[],dependsOn:[]}]).map((s,i)=>{if(!Array.isArray(s.requires||[])||!Array.isArray(s.dependsOn||[]))throw new Error("PLAN_STEP_ARRAYS_REQUIRED");return {id:s.id||`STEP-${i+1}`,title:s.title||`Step ${i+1}`,goal:s.goal||s.title||objective,requires:[...new Set(s.requires||[])],dependsOn:[...new Set(s.dependsOn||[])],role:s.role||null,status:"PLANNED"};});
 const ids=normalized.map(s=>s.id);if(new Set(ids).size!==ids.length)throw new Error("DUPLICATE_PLAN_STEP_ID");const known=new Set(ids);for(const s of normalized){if(s.dependsOn.includes(s.id)||s.dependsOn.some(d=>!known.has(d)))throw new Error("INVALID_PLAN_DEPENDENCY");}
 const visit=(id,trail=new Set())=>{if(trail.has(id))throw new Error("CYCLIC_PLAN_DEPENDENCY");const next=new Set(trail);next.add(id);for(const d of normalized.find(s=>s.id===id).dependsOn)visit(d,next);};ids.forEach(id=>visit(id));
 return {planId:uid(),objective,constraints:structuredClone(constraints),doneDefinition:structuredClone(doneDefinition),context:structuredClone(context),steps:normalized,status:"PLANNED",createdAt:new Date().toISOString()};
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
