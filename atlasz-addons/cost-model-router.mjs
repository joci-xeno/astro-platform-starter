export function chooseRoute({task,routes=[],maxCostUsd=0,minimumQuality=0}={}){
 const eligible=routes.filter(r=>r.available!==false&&Number(r.estimatedCostUsd||0)<=Number(maxCostUsd||0)&&Number(r.qualityScore||0)>=Number(minimumQuality||0));
 eligible.sort((a,b)=>(Number(b.qualityScore||0)/(Number(b.estimatedCostUsd||0)+0.0001))-(Number(a.qualityScore||0)/(Number(a.estimatedCostUsd||0)+0.0001)));
 return {task,route:eligible[0]||null,requiresOwnerApproval:eligible.length===0};
}
export function actualCost(events=[]){return events.reduce((s,e)=>s+Number(e.costUsd||0),0);}
