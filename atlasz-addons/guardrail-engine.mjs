const HIGH_RISK=["SPEND_MONEY","BUY_CREDITS","SIGN_CONTRACT","ACCEPT_BINDING_TERMS","SEND_PAYMENT","CHANGE_SECRETS","DELETE_DATA","DEPLOY_BREAKING_CHANGE"];
export function guardAction({action,ownerApproved=false,truthful=true,hasRequiredCredential=true}={}){
 const reasons=[];if(!truthful)reasons.push("TRUTHFULNESS_REQUIRED");if(!hasRequiredCredential)reasons.push("MISSING_REQUIRED_CREDENTIAL");
 if(HIGH_RISK.includes(action)&&!ownerApproved)reasons.push("OWNER_APPROVAL_REQUIRED");
 return {allowed:reasons.length===0,reasons,risk:HIGH_RISK.includes(action)?"HIGH":"NORMAL"};
}
export function assertAllowed(input){const r=guardAction(input);if(!r.allowed)throw new Error("GUARDRAIL_BLOCK:"+r.reasons.join(","));return r;}
