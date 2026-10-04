// Verified cost/profit accounting. PAID revenue requires confirmed receipt.
export function buildProfitStatement({jobId,entries=[]}={}){
 if(!jobId)throw new Error("JOB_ID_REQUIRED");if(!Array.isArray(entries))throw new Error("MONEY_ENTRIES_ARRAY_REQUIRED");for(const e of entries){const v=validateMoneyEntry(e);if(!v.valid)throw new Error("INVALID_MONEY_ENTRY:"+v.errors.join(","));}
 const costs=entries.filter(e=>e.type==="COST").reduce((s,e)=>s+Number(e.amountUsd),0);
 const received=entries.filter(e=>e.type==="REVENUE"&&e.confirmedReceived===true).reduce((s,e)=>s+Number(e.amountUsd||0),0);
 const unconfirmed=entries.filter(e=>e.type==="REVENUE"&&e.confirmedReceived!==true).reduce((s,e)=>s+Number(e.amountUsd||0),0);
 return {jobId,verifiedReceivedUsd:received,unconfirmedRevenueUsd:unconfirmed,costUsd:costs,verifiedNetProfitUsd:received-costs,profitable:received-costs>0,generatedAt:new Date().toISOString()};
}
export function validateMoneyEntry(e={}){const errors=[],amount=Number(e.amountUsd);if(!["COST","REVENUE"].includes(e.type))errors.push("INVALID_TYPE");if(!Number.isFinite(amount)||amount<0)errors.push("INVALID_AMOUNT");if(e.type==="REVENUE"&&e.stage==="PAID"&&e.confirmedReceived!==true)errors.push("PAID_REQUIRES_CONFIRMED_RECEIPT");if(e.type==="REVENUE"&&e.stage==="PAID"&&!e.externalEvidence)errors.push("PAID_REQUIRES_EXTERNAL_EVIDENCE");return {valid:!errors.length,errors};}
