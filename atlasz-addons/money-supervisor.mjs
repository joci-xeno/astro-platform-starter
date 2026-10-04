export const MONEY_SUPERVISOR_VERSION="1.0.0";
const finite=(v,name,{min=null}={})=>{const x=Number(v);if(!Number.isFinite(x)||(min!==null&&x<min))throw new Error("INVALID_"+name);return x;};
export function priorityScore(o={}){
  const value=finite(o.netValueUsd??o.estimatedValueUsd??0,"VALUE",{min:0});
  const probability=Math.max(0,Math.min(1,finite(o.winProbability??0,"WIN_PROBABILITY",{min:0})));
  const hours=Math.max(1,finite(o.hoursToCash??24,"HOURS_TO_CASH",{min:0}));
  const friction=finite(o.frictionPenalty??0,"FRICTION",{min:0});
  const recurring=finite(o.recurringMonthlyUsd??0,"RECURRING_VALUE",{min:0});
  return ((probability*(value+recurring*6))/hours)-friction;
}
export function rankNextActions(items=[]){
  return items.map(x=>({...x,moneyPriority:priorityScore(x)}))
    .sort((a,b)=>b.moneyPriority-a.moneyPriority);
}
export function chooseNextAction(items=[]){
  return rankNextActions(items).find(x=>!["BLOCKED","PAID","LOST"].includes(x.status))||null;
}
