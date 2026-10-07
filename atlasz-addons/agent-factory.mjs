import { ownerGranted } from "./owner-auth.mjs";
export const AGENT_FACTORY_VERSION="1.0.0";
const ROLES=new Set(["SEARCH","EXECUTION","REVIEWER","PLANNER","RESEARCH","SUPPORT","SPECIALIST"]);
const uid=()=>globalThis.crypto?.randomUUID?.()||("agent-"+Date.now()+"-"+Math.random().toString(16).slice(2));
export function createAgentBlueprint({name,role,goal,capabilities=[],tools=[],guardrails=[],modelPolicy="ROUTER",approvalPolicy="HUMAN_FOR_HIGH_RISK",metadata={}}={}){
 if(!name||!goal||!ROLES.has(role)) throw new Error("VALID_NAME_ROLE_GOAL_REQUIRED");
 if(!Array.isArray(capabilities)||!Array.isArray(tools)||!Array.isArray(guardrails))throw new Error("AGENT_FACTORY_ARRAYS_REQUIRED");return {schemaVersion:AGENT_FACTORY_VERSION,agentId:uid(),name,role,goal,capabilities:[...new Set(capabilities)],tools:[...new Set(tools)],guardrails:[...new Set(guardrails)],modelPolicy,approvalPolicy,metadata:{...metadata},status:"BLUEPRINT",createdAt:new Date().toISOString()};
}
export function validateBlueprint(a={}){
 const errors=[];
 if(!a.name)errors.push("NAME_REQUIRED"); if(!ROLES.has(a.role))errors.push("INVALID_ROLE"); if(!a.goal)errors.push("GOAL_REQUIRED");
 if(!Array.isArray(a.capabilities)||!Array.isArray(a.tools)||!Array.isArray(a.guardrails))errors.push("INVALID_ARRAY_FIELDS");
 if(!a.approvalPolicy)errors.push("APPROVAL_POLICY_REQUIRED");
 return {valid:errors.length===0,errors};
}
export function instantiateAgent(blueprint,{availableCapabilities=[],availableTools=[],ownerApproved=false}={}){
 const v=validateBlueprint(blueprint); if(!v.valid)throw new Error("INVALID_BLUEPRINT:"+v.errors.join(","));
 const missingCapabilities=blueprint.capabilities.filter(x=>!availableCapabilities.includes(x));
 const missingTools=blueprint.tools.filter(x=>!availableTools.includes(x));
 if(missingCapabilities.length||missingTools.length)return {...blueprint,status:"BLOCKED",blocker:{missingCapabilities,missingTools}};
 if(blueprint.approvalPolicy==="OWNER_BEFORE_CREATE"&&!ownerGranted(ownerApproved,"CREATE_AGENT")) return {...blueprint,status:"AWAITING_OWNER_APPROVAL"};
 return {...blueprint,status:"READY_FOR_RUNTIME",instantiatedAt:new Date().toISOString()};
}
export function cloneBlueprint(template,{name,goal,metadata={}}={}){
 return {...template,agentId:uid(),name:name||template.name,goal:goal||template.goal,metadata:{...template.metadata,...metadata},status:"BLUEPRINT",createdAt:new Date().toISOString()};
}
// Additive factory only. It creates validated definitions; Astra decides how/when to register them with the live supervisor.

/** Governed activation: the ONLY path by which a factory blueprint may become ACTIVE. Without a governor nothing is activated.
 *  The governor checks identity / role / topology / capabilities / permissions and the full control chain (Kill Switch, Safe Mode,
 *  Security Brain, Black Box). An unknown identity is a would-be 31st agent and is refused. */
export function activateAgentGoverned(blueprint, { governor, availableCapabilities = [], availableTools = [], ownerApproved = false } = {}) {
  if (!governor || typeof governor.admit !== "function") return { ...blueprint, status: "BLOCKED", blocker: { reason: "AGENT_GOVERNOR_REQUIRED" } };
  const inst = instantiateAgent(blueprint, { availableCapabilities, availableTools, ownerApproved });
  if (inst.status !== "READY_FOR_RUNTIME") return inst;
  const a = governor.admit(blueprint);
  return a.admitted ? { ...inst, status: "ACTIVE", admission: { checks: a.checks } } : { ...blueprint, status: "REFUSED_BY_GOVERNOR", blocker: { reason: a.reason, checks: a.checks } };
}
