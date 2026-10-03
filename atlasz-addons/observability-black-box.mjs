const events=[];
const safe=v=>JSON.parse(JSON.stringify(v??null,(k,x)=>/secret|password|api.?key|token/i.test(k)?"[REDACTED]":x));
export function blackBoxRecord({traceId,agentId,workflowId,dealId,jobId,event,input,output,status,costUsd=0,durationMs=0}={}){
 const cost=Number(costUsd),duration=Number(durationMs);
 if(!Number.isFinite(cost)||cost<0)throw new Error("INVALID_AUDIT_COST");
 if(!Number.isFinite(duration)||duration<0)throw new Error("INVALID_AUDIT_DURATION");
 const r={at:new Date().toISOString(),traceId:traceId||null,agentId:agentId||null,workflowId:workflowId||null,dealId:dealId||null,jobId:jobId||null,event,status:status||null,input:safe(input),output:safe(output),costUsd:cost,durationMs:duration};events.push(r);return r;
}
export function queryBlackBox({traceId,agentId,workflowId,dealId,jobId}={}){return events.filter(e=>(!traceId||e.traceId===traceId)&&(!agentId||e.agentId===agentId)&&(!workflowId||e.workflowId===workflowId)&&(!dealId||e.dealId===dealId)&&(!jobId||e.jobId===jobId));}
export function blackBoxStats(){return {events:events.length,costUsd:events.reduce((s,e)=>s+e.costUsd,0),errors:events.filter(e=>e.status==="ERROR"||e.status==="FAIL").length};}
