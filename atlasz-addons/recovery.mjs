export function recoveryPlan(error,{attempt=0,maxRetries=2,alternateAvailable=false}={}){
 attempt=Number(attempt);maxRetries=Number(maxRetries);if(!Number.isInteger(attempt)||attempt<0||!Number.isInteger(maxRetries)||maxRetries<0)throw new Error("INVALID_RECOVERY_RETRY_POLICY");if(attempt<maxRetries) return {action:"RETRY",attempt:attempt+1};
 if(alternateAvailable) return {action:"ALTERNATE_TOOL_OR_MODEL",attempt:0};
 return {action:"BLOCKED",reason:String(error?.message||error||"UNKNOWN_ERROR"),requiresHuman:true};
}
