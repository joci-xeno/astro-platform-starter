export function detectStall(history=[],threshold=3){
 if(!Array.isArray(history))throw new Error("STALL_HISTORY_ARRAY_REQUIRED");threshold=Number(threshold);if(!Number.isInteger(threshold)||threshold<=0)throw new Error("INVALID_STALL_THRESHOLD");const tail=history.slice(-threshold);return {stalled:tail.length===threshold&&tail.every(x=>Number.isFinite(Number(x?.delta))&&Number(x.delta)<=0),observations:tail.length};
}
export function replan({goal,failedActions=[],availableCapabilities=[]}={}){
 return {goal,avoid:[...new Set(failedActions)],availableCapabilities,nextAction:"GENERATE_ALTERNATIVE_PLAN",requiresFreshEvidence:true,at:new Date().toISOString()};
}
