export const MONEY_STAGES=["LEAD_VALUE","PROPOSED","AGREED","INVOICED","PAID"];
export function recordMoney(entry){
 if(!MONEY_STAGES.includes(entry.stage)) throw new Error("INVALID_MONEY_STAGE");
 if(entry.stage==="PAID"&&!entry.confirmedReceived) throw new Error("PAID_REQUIRES_EXTERNAL_CONFIRMATION");
 const amount=Number(entry.amountUsd),cost=Number(entry.costUsd);if(!Number.isFinite(amount)||amount<0||!Number.isFinite(cost)||cost<0)throw new Error("INVALID_MONEY_AMOUNT");if(entry.stage==="PAID"&&!entry.externalEvidence)throw new Error("PAID_REQUIRES_EXTERNAL_EVIDENCE");
 return {...entry,amountUsd:amount,costUsd:cost,recordedAt:new Date().toISOString()};
}
export function summarize(entries=[]){
 const paid=entries.filter(x=>x.stage==="PAID"&&x.confirmedReceived).reduce((s,x)=>s+Number(x.amountUsd||0),0);
 const costs=entries.reduce((s,x)=>s+Number(x.costUsd||0),0);
 return {confirmedPaidUsd:paid,costsUsd:costs,verifiedNetProfitUsd:paid-costs};
}
