export const BUYER_FINDER_VERSION="1.0.0";
export function buildBuyerQuery({company,domain,need,roles=[]}={}){
 if(!company&&!domain) throw new Error("COMPANY_OR_DOMAIN_REQUIRED");
 return {company:company||null,domain:domain||null,need:need||null,roles:roles.length?roles:["Owner","Founder","Operations","Procurement","Marketing","Engineering","IT"],sources:["Clay","Hunter","PublicCompanySite","OtherLawfulSource"]};
}
export function normalizeContact(c={}){
 const confidence=Number(c.confidence);return {name:c.name||null,title:c.title||null,company:c.company||null,email:c.email||null,source:c.source||null,sourceUrl:c.sourceUrl||null,verified:Boolean(c.verified),businessContact:Boolean(c.businessContact),confidence:Number.isFinite(confidence)?Math.max(0,Math.min(1,confidence)):0};
}
export function rankContacts(list=[]){return list.filter(x=>x.businessContact&&x.source).sort((a,b)=>(Number(b.verified)-Number(a.verified))||(b.confidence-a.confidence));}
export function contactReady(c){return Boolean(c?.email&&c.businessContact&&c.source&&c.confidence>=0.6);}
