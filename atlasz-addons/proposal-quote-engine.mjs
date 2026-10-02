export const PROPOSAL_ENGINE_VERSION="1.0.0";
export function buildProposal({dealId,client,scope,deliverables=[],priceUsd,deadline,assumptions=[],exclusions=[],evidence=[]}={}){
 if(!dealId||!scope||!Number.isFinite(Number(priceUsd))||Number(priceUsd)<=0) throw new Error("PROPOSAL_MISSING_REQUIRED_FIELDS");
 return {dealId,client:client||null,scope,deliverables,priceUsd:Number(priceUsd),deadline:deadline||null,
  assumptions,exclusions,evidence,status:"DRAFT",binding:false,createdAt:new Date().toISOString()};
}
export function validateProposal(p){
 const errors=[];
 if(!p.scope) errors.push("MISSING_SCOPE");
 if(!p.deliverables?.length) errors.push("MISSING_DELIVERABLES");
 if(!(p.priceUsd>0)) errors.push("INVALID_PRICE");
 if(!p.evidence?.length) errors.push("NO_SOURCE_EVIDENCE");
 return {passed:errors.length===0,errors};
}
export function approveProposal(p,{ownerApproved=false}={}){
 if(!ownerApproved) throw new Error("OWNER_APPROVAL_REQUIRED");
 const v=validateProposal(p); if(!v.passed) throw new Error("PROPOSAL_VALIDATION_FAILED:"+v.errors.join(","));
 return {...p,status:"APPROVED_TO_SEND",approvedAt:new Date().toISOString()};
}
