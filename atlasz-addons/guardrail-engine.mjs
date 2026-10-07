import { ownerGranted } from "./owner-auth.mjs";
const HIGH_RISK=["SPEND_MONEY","BUY_CREDITS","PURCHASE","SUBSCRIBE","ACCEPT_CONTRACT","SIGN_CONTRACT","ACCEPT_BINDING_TERMS","SEND_PAYMENT","BANK_CHANGE","CREDENTIAL_CHANGE","ACCOUNT_SECURITY_CHANGE","CHANGE_SECRETS","PUBLISH_EXTERNAL","DELETE_DATA","DELETE_CLOUD_DATA","DEPLOY_BREAKING_CHANGE"];
const canonical=a=>String(a||"").trim().toUpperCase().replace(/-/g,"_");
export function guardAction({action,ownerApproved=false,truthful=true,hasRequiredCredential=true}={}){
 const reasons=[],a=canonical(action);if(!truthful)reasons.push("TRUTHFULNESS_REQUIRED");if(!hasRequiredCredential)reasons.push("MISSING_REQUIRED_CREDENTIAL");
 if(HIGH_RISK.includes(a)&&!ownerGranted(ownerApproved,a))reasons.push("OWNER_APPROVAL_REQUIRED");
 return {allowed:reasons.length===0,reasons,risk:HIGH_RISK.includes(a)?"HIGH":"NORMAL",action:a};
}
export function assertAllowed(input){const r=guardAction(input);if(!r.allowed)throw new Error("GUARDRAIL_BLOCK:"+r.reasons.join(","));return r;}
