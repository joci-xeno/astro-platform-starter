// Detect suspicious coordination/evaluation gaming. Collaboration is allowed only with task evidence.
export function inspectCoordination({messages=[],masterTaskIds=[],judgeAgentIds=[]}={}){
 const authorized=new Set(masterTaskIds);const judges=new Set(judgeAgentIds);const findings=[];
 for(const m of messages){if(m.taskId&&!authorized.has(m.taskId))findings.push({type:"UNAUTHORIZED_SHARED_GOAL",messageId:m.id||null});
   if(judges.has(m.fromAgent)&&m.type==="EVALUATION_REQUEST"&&m.targetAgent===m.fromAgent)findings.push({type:"SELF_EVALUATION",messageId:m.id||null});
   if(m.hiddenChannel===true)findings.push({type:"UNLOGGED_CHANNEL_CLAIM",messageId:m.id||null});
   if(m.intent==="GAME_EVALUATION"||m.intent==="SACRIFICE_AGENT_FOR_SCORE")findings.push({type:"EVALUATION_GAMING",messageId:m.id||null});}
 return {status:findings.length?"ISOLATE_AND_REVIEW":"PASS",findings,requiresMasterReview:findings.length>0};
}
