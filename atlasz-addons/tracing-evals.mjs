import { createHash } from "node:crypto";
export const TRACE_EVAL_VERSION="1.0.0";
const redact=v=>String(v??"").replace(/(?:sk-|key-|token-)[A-Za-z0-9_.-]{8,}/g,"[REDACTED]");
export function traceEvent({traceId,agentId,dealId,jobId,type,tool,status,durationMs,costUsd=0,details={}}={}){
 const at=new Date().toISOString();
 const id=traceId||createHash("sha256").update(at+Math.random()).digest("hex").slice(0,16);
 const duration=Number(durationMs),cost=Number(costUsd);if(!Number.isFinite(duration)||duration<0)throw new Error("INVALID_TRACE_DURATION");if(!Number.isFinite(cost)||cost<0)throw new Error("INVALID_TRACE_COST");
 return {traceId:id,at,agentId:agentId||null,dealId:dealId||null,jobId:jobId||null,type:type||"EVENT",
  tool:tool||null,status:status||null,durationMs:duration,costUsd:cost,
  details:JSON.parse(redact(JSON.stringify(details)))};
}
export function evaluate({output,criteria=[],evidence=[]}={}){
 const results=criteria.map(c=>{
   let passed=false;
   if(c.type==="NONEMPTY") passed=Boolean(String(output??"").trim());
   else if(c.type==="CONTAINS") passed=String(output??"").includes(String(c.value??""));
   else if(c.type==="EVIDENCE") passed=evidence.some(e=>e.id===c.value||e.checkId===c.value);
   else if(c.type==="CUSTOM_BOOLEAN") passed=Boolean(c.value);
   return {id:c.id||c.type,type:c.type,passed,required:c.required!==false};
 });
 const failed=results.filter(r=>r.required&&!r.passed);
 return {status:failed.length?"FAIL":"PASS",results,failed};
}
export function aggregateTraces(events=[]){
 return {events:events.length,totalCostUsd:events.reduce((s,e)=>s+Number(e.costUsd||0),0),
  failures:events.filter(e=>e.status==="FAIL"||e.status==="ERROR").length,
  agents:[...new Set(events.map(e=>e.agentId).filter(Boolean))].length};
}
