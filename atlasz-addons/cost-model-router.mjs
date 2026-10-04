export function chooseRoute({task,routes=[],maxCostUsd=0,minimumQuality=0}={}){
 const max=Number(maxCostUsd),minQ=Number(minimumQuality);if(!Number.isFinite(max)||max<0||!Number.isFinite(minQ))throw new Error("INVALID_ROUTER_LIMITS");
 const eligible=routes.filter(r=>{const cost=Number(r.estimatedCostUsd),quality=Number(r.qualityScore);return r.available!==false&&Number.isFinite(cost)&&cost>=0&&Number.isFinite(quality)&&cost<=max&&quality>=minQ;});
 eligible.sort((a,b)=>(Number(b.qualityScore||0)/(Number(b.estimatedCostUsd||0)+0.0001))-(Number(a.qualityScore||0)/(Number(a.estimatedCostUsd||0)+0.0001)));
 return {task,route:eligible[0]||null,requiresOwnerApproval:eligible.length===0};
}
export function actualCost(events=[]){return events.reduce((s,e)=>{const c=Number(e.costUsd);if(!Number.isFinite(c)||c<0)throw new Error("INVALID_COST_EVENT");return s+c;},0);}
