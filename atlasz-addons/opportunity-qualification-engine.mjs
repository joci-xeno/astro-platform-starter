export const OPPORTUNITY_ENGINE_VERSION="1.0.0";
const n=v=>Number.isFinite(Number(v))?Number(v):0;
export function qualifyOpportunity(o={}){
 const blockers=[];
 if(!o.sourceUrl&&!o.sourceEvidence) blockers.push("NO_SOURCE_EVIDENCE");
 if(o.upfrontSpendRequired) blockers.push("UPFRONT_SPEND_REQUIRED");
 if(o.illegalOrDeceptive) blockers.push("ILLEGAL_OR_DECEPTIVE");
 if(o.requiresPhysicalPresence&&!o.remoteDeliverable) blockers.push("NOT_REMOTE_DELIVERABLE");
 if(o.requiresUnheldLicense) blockers.push("LICENSE_REQUIRED");
 const value=n(o.estimatedValueUsd), probability=Math.max(0,Math.min(1,n(o.winProbability)));
 const hours=Math.max(1,n(o.estimatedHours||24)), costs=Math.max(0,n(o.estimatedCostsUsd));
 const net=Math.max(0,value-costs), expectedNet=probability*net, velocity=expectedNet/hours;
 return {...o,qualification:{eligible:blockers.length===0,blockers,valueUsd:value,estimatedNetUsd:net,expectedNetUsd:expectedNet,expectedNetPerHour:velocity,
   recurring:Boolean(o.recurring),fastToCash:Boolean(o.daysToCash!=null&&n(o.daysToCash)<=14)}};
}
export function rankOpportunities(list=[]){return list.map(qualifyOpportunity).filter(x=>x.qualification.eligible).sort((a,b)=>b.qualification.expectedNetPerHour-a.qualification.expectedNetPerHour);}
export function dedupeOpportunities(list=[]){const seen=new Set();return list.filter(x=>{const k=String(x.url||x.sourceUrl||x.company+"|"+x.title).toLowerCase();if(seen.has(k))return false;seen.add(k);return true;});}
