export function detectStall(history=[],threshold=3){
 const tail=history.slice(-threshold);return {stalled:tail.length===threshold&&tail.every(x=>Number(x.delta||0)<=0),observations:tail.length};
}
export function replan({goal,failedActions=[],availableCapabilities=[]}={}){
 return {goal,avoid:[...new Set(failedActions)],availableCapabilities,nextAction:"GENERATE_ALTERNATIVE_PLAN",requiresFreshEvidence:true,at:new Date().toISOString()};
}
