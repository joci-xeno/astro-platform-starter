export const MONEY_SUPERVISOR_VERSION="1.0.0";
const n=v=>Number.isFinite(Number(v))?Number(v):0;
export function priorityScore(o={}){
  const value=n(o.netValueUsd||o.estimatedValueUsd);
  const probability=Math.max(0,Math.min(1,n(o.winProbability||0)));
  const hours=Math.max(1,n(o.hoursToCash||24));
  const friction=Math.max(0,n(o.frictionPenalty||0));
  const recurring=Math.max(0,n(o.recurringMonthlyUsd||0));
  return ((probability*(value+recurring*6))/hours)-friction;
}
export function rankNextActions(items=[]){
  return items.map(x=>({...x,moneyPriority:priorityScore(x)}))
    .sort((a,b)=>b.moneyPriority-a.moneyPriority);
}
export function chooseNextAction(items=[]){
  return rankNextActions(items).find(x=>!["BLOCKED","PAID","LOST"].includes(x.status))||null;
}
