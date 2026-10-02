export const MONEY_STAGES=["LEAD_VALUE","PROPOSED","AGREED","INVOICED","PAID"];
export function recordMoney(entry){
 if(!MONEY_STAGES.includes(entry.stage)) throw new Error("INVALID_MONEY_STAGE");
 if(entry.stage==="PAID"&&!entry.confirmedReceived) throw new Error("PAID_REQUIRES_EXTERNAL_CONFIRMATION");
 return {...entry,amountUsd:Number(entry.amountUsd||0),costUsd:Number(entry.costUsd||0),recordedAt:new Date().toISOString()};
}
export function summarize(entries=[]){
 const paid=entries.filter(x=>x.stage==="PAID"&&x.confirmedReceived).reduce((s,x)=>s+Number(x.amountUsd||0),0);
 const costs=entries.reduce((s,x)=>s+Number(x.costUsd||0),0);
 return {confirmedPaidUsd:paid,costsUsd:costs,verifiedNetProfitUsd:paid-costs};
}
