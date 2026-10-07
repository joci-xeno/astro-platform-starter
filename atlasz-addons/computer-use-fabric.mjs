import {emergencyGate} from "./emergency-stop.mjs";
import {isTested} from "./probe-evidence.mjs";
import { ownerGranted } from "./owner-auth.mjs";
// ATLASZ Computer Use Fabric v1.0
// Owner-first desktop/browser execution policy. No provider is LIVE until attached and tested.
export const OWNER_AUTHORITY=Object.freeze({ownerId:"JOCI",rank:1,masterRank:2,agentRank:3,immutable:true});
export const COMPUTER_ACTION_LEVELS=Object.freeze({AUTO:"AUTO",ASK_OWNER:"ASK_JOCI",FORBIDDEN:"FORBIDDEN"});
const ask=new Set(["spend-money","purchase","subscribe","accept-contract","sign-contract","send-payment","bank-change","credential-change","account-security-change","publish-external","delete-cloud-data"]);
const forbidden=new Set(["disable-owner-control","change-owner-authority","bypass-approval","exfiltrate-secret","disable-audit-log"]);
export function classifyComputerAction(action=""){
 const a=String(action).trim().toLowerCase();
 if(forbidden.has(a))return COMPUTER_ACTION_LEVELS.FORBIDDEN;
 if(ask.has(a))return COMPUTER_ACTION_LEVELS.ASK_OWNER;
 return COMPUTER_ACTION_LEVELS.AUTO;
}
export function createComputerUseFabric({provider=null,gate:extGate=null}={}){
 const provOk=isTested(provider?.tested,provider?.probeEvidence);
 const audit=[];
 const status=()=>({id:"computer-use-fabric",provider:provider?.name||null,state:provider?(provOk?"LIVE":"CONNECTED_UNTESTED"):"PLACEHOLDER_UNCONNECTED",tested:Boolean(provOk),live:Boolean(provOk),owner:OWNER_AUTHORITY.ownerId});
 function authorize({agentId,action,ownerApproved=false}={}){
   const level=classifyComputerAction(action);
   const decision=level==="FORBIDDEN"?"DENY":level==="ASK_JOCI"&&!ownerGranted(ownerApproved,"COMPUTER_"+String(action).trim().toUpperCase().replace(/-/g,"_"))?"WAIT_OWNER":"ALLOW";
   audit.push({at:new Date().toISOString(),agentId:agentId||null,action,level,decision});
   return {level,decision,ownerApprovalRequired:level==="ASK_JOCI"};
 }
 async function execute({agentId,action,input,ownerApproved=false}={}){
   const stop=(extGate||emergencyGate)({external:true});           // owner kill switch (and Safe Mode when the runtime passes its gate)
   if(!stop.allowed){audit.push({at:new Date().toISOString(),agentId:agentId||null,action,level:"BLOCKED_BY_STOP",decision:"DENY",reason:stop.reason});return {level:"BLOCKED_BY_STOP",decision:"DENY",reason:stop.reason,executed:false};}
   const gate=authorize({agentId,action,ownerApproved});
   if(gate.decision!=="ALLOW")return {...gate,executed:false};
   if(!provider?.execute)throw new Error("COMPUTER_USE_PROVIDER_UNAVAILABLE");
   if(!provOk)throw new Error("COMPUTER_USE_PROVIDER_UNTESTED");
   const result=await provider.execute({agentId,action,input});
   return {...gate,executed:true,result};
 }
 return {status,authorize,execute,audit:()=>audit.slice(-500)};
}
