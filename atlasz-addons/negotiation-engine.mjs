import { ownerGranted } from "./owner-auth.mjs";
export const NEGOTIATION_VERSION="1.0.0";
export function assessMessage({message,currentOffer,minAcceptableUsd,agreedScope}={}){
 const text=String(message||"");
 const money=[...text.matchAll(/(?:USD\s*|\$)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi)]
   .map(m=>Number(m[1].replaceAll(",",""))).filter(Number.isFinite);
 return {detectedAmountsUsd:money,hasQuestion:/\?/.test(text),
  scopeChange:/\b(add|extra|also|instead|change|remove|include)\b/i.test(text),
  belowFloor:money.length?Math.min(...money)<Number(minAcceptableUsd||0):false,
  requiresOwnerApproval:/\b(contract|agreement|sign|accept|binding|payment terms|refund|guarantee)\b/i.test(text),
  agreedScope:agreedScope||null};
}
export function negotiationNextAction(a){
 if(a.requiresOwnerApproval) return "OWNER_REVIEW";
 if(a.scopeChange) return "REPRICE_AND_CONFIRM_SCOPE";
 if(a.belowFloor) return "COUNTER_OR_DECLINE";
 if(a.hasQuestion) return "ANSWER_WITH_EVIDENCE";
 return "CONTINUE_NEGOTIATION";
}
export function markAgreement(terms,{ownerApproved=false}={}){
 if(!ownerGranted(ownerApproved,"MARK_AGREEMENT")) throw new Error("OWNER_APPROVAL_REQUIRED_FOR_AGREEMENT");
 return {...terms,status:"AGREED",agreedAt:new Date().toISOString()};
}
