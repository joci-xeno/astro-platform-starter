// ATLASZ bounded self-healing loop. No policy bypass, spending or secret changes.
import { recoveryPlan } from "./recovery.mjs";
export async function selfHeal({operation,verify,attempt=0,maxRetries=2,alternate=null}={}){
 if(typeof operation!=="function"||typeof verify!=="function")throw new Error("OPERATION_AND_VERIFY_REQUIRED");
 try{const result=await operation();const check=await verify(result);if(check?.passed)return {state:"RECOVERED",attempt,result,evidence:check};
   const p=recoveryPlan("VERIFY_FAILED",{attempt,maxRetries,alternateAvailable:Boolean(alternate)});
   if(p.action==="RETRY")return selfHeal({operation,verify,attempt:p.attempt,maxRetries,alternate});
   if(p.action==="ALTERNATE_TOOL_OR_MODEL"&&typeof alternate==="function"){const r=await alternate();const v=await verify(r);return {state:v?.passed?"RECOVERED":"BLOCKED",attempt,result:r,evidence:v};}
   return {state:"BLOCKED",reason:"VERIFICATION_FAILED",attempt};
 }catch(error){const p=recoveryPlan(error,{attempt,maxRetries,alternateAvailable:Boolean(alternate)});
   if(p.action==="RETRY")return selfHeal({operation,verify,attempt:p.attempt,maxRetries,alternate});
   if(p.action==="ALTERNATE_TOOL_OR_MODEL"&&typeof alternate==="function"){try{const r=await alternate();const v=await verify(r);return {state:v?.passed?"RECOVERED":"BLOCKED",result:r,evidence:v};}catch(e){return {state:"BLOCKED",reason:String(e?.message||e)};}}
   return {state:"BLOCKED",reason:p.reason,requiresHuman:true};
 }}
