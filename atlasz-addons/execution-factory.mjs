export const EXECUTION_FACTORY_VERSION="1.0.0";
export const EXECUTION_STAGES=["PLAN","EXECUTE","TEST","QA","FIX","PACKAGE","DELIVERY_APPROVAL","READY_TO_DELIVER"];

export function createExecutionJob({jobId,dealId,client,scope,acceptanceCriteria=[],deadline=null,toolProfile="GENERIC"}={}){
  if(!jobId||!dealId||!scope) throw new Error("EXECUTION_JOB_REQUIRES_JOB_DEAL_SCOPE");
  if(!Array.isArray(acceptanceCriteria))throw new Error("ACCEPTANCE_CRITERIA_ARRAY_REQUIRED");if(deadline&&!Number.isFinite(Date.parse(deadline)))throw new Error("INVALID_EXECUTION_DEADLINE");return {jobId,dealId,client:client||null,scope,acceptanceCriteria:[...acceptanceCriteria],deadline,toolProfile,
    stage:"PLAN",status:"QUEUED",attempt:0,artifacts:[],testResults:[],qa:null,
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
export function assignExecution(job,agentId){
  if(!job?.jobId)throw new Error("VALID_EXECUTION_JOB_REQUIRED");if(!agentId) throw new Error("EXECUTION_AGENT_REQUIRED");
  return {...job,executionAgent:agentId,status:"IN_PROGRESS",updatedAt:new Date().toISOString()};
}
export function advanceExecution(job,next,{qaPassed=false,ownerApproved=false}={}){
  if(!job?.jobId||!EXECUTION_STAGES.includes(job.stage))throw new Error("VALID_EXECUTION_JOB_REQUIRED");const i=EXECUTION_STAGES.indexOf(job.stage), n=EXECUTION_STAGES.indexOf(next);
  if(n<0) throw new Error("UNKNOWN_EXECUTION_STAGE");
  if(next==="READY_TO_DELIVER"&&!ownerApproved) throw new Error("OWNER_DELIVERY_APPROVAL_REQUIRED");
  if(next==="DELIVERY_APPROVAL"&&!qaPassed) throw new Error("QA_PASS_REQUIRED");
  if(next!=="FIX" && n!==i+1) throw new Error("INVALID_EXECUTION_TRANSITION");
  return {...job,stage:next,status:next==="READY_TO_DELIVER"?"READY":"IN_PROGRESS",updatedAt:new Date().toISOString()};
}
export function executionToolPlan(type){
 const profiles={
  SOFTWARE:["planner","code_workspace","test_runner","qa","packager"],
  RESEARCH:["research","extract","verify","report","qa"],
  DATA:["extract","transform","spreadsheet","verify","qa"],
  CONTENT:["planner","draft","asset_pipeline","qa","packager"],
  VIDEO:["script_assets","media_pipeline","subtitle_audio","render","qc"],
  GENERIC:["planner","workspace","verification","qa","packager"]
 };
 return profiles[String(type||"GENERIC").toUpperCase()]||profiles.GENERIC;
}
