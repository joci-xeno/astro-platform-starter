export const CHECKPOINT_VERSION="1.0.0";
export function checkpoint(state,{workflowId,step,reason="PERIODIC"}={}){
 if(!workflowId) throw new Error("WORKFLOW_ID_REQUIRED");
 const snapshot=structuredClone(state);return {workflowId,step:step??null,reason,state:snapshot,createdAt:new Date().toISOString(),version:CHECKPOINT_VERSION};
}
export function resume(cp){if(!cp?.workflowId||cp.state===undefined) throw new Error("INVALID_CHECKPOINT");return {workflowId:cp.workflowId,step:cp.step,state:structuredClone(cp.state),resumedAt:new Date().toISOString()};}
