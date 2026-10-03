export const KNOWLEDGE_LAYER_VERSION="1.0.0";
const store=new Map();
const uid=()=>globalThis.crypto?.randomUUID?.()||("knowledge-"+Date.now()+"-"+Math.random().toString(16).slice(2));
export function ingestKnowledge({id,tenantId,sourceId,sourceType="DOCUMENT",title,text,uri=null,classification="INTERNAL",allowedRoles=["*"],verified=false,freshnessAt=null,metadata={}}={}){
 if(!tenantId||!sourceId||!text)throw new Error("TENANT_SOURCE_TEXT_REQUIRED");if(!Array.isArray(allowedRoles)||allowedRoles.length===0)throw new Error("KNOWLEDGE_ALLOWED_ROLES_REQUIRED");if(freshnessAt&&!Number.isFinite(Date.parse(freshnessAt)))throw new Error("INVALID_KNOWLEDGE_FRESHNESS");
 const item={id:id||uid(),tenantId,sourceId,sourceType,title:title||sourceId,text,uri,classification,allowedRoles:[...new Set(allowedRoles)],verified:Boolean(verified),freshnessAt:freshnessAt||new Date().toISOString(),metadata,createdAt:new Date().toISOString()};
 store.set(item.id,item); return item;
}
function permitted(item,{tenantId,role}={}){return item.tenantId===tenantId&&(item.allowedRoles.includes("*")||item.allowedRoles.includes(role));}
const tokens=s=>new Set(String(s||"").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>2));
function relevance(q,t){const a=tokens(q),b=tokens(t);let hit=0;for(const x of a)if(b.has(x))hit++;return a.size?hit/a.size:0;}
export function retrieveKnowledge({query,tenantId,role="EXECUTION",limit=8,verifiedOnly=false}={}){
 if(!query||!tenantId)throw new Error("QUERY_TENANT_REQUIRED");
 return [...store.values()].filter(x=>permitted(x,{tenantId,role})&&(!verifiedOnly||x.verified))
 .map(x=>({item:x,score:relevance(query,x.title+" "+x.text)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit)
 .map(({item,score})=>({id:item.id,sourceId:item.sourceId,title:item.title,text:item.text,uri:item.uri,verified:item.verified,freshnessAt:item.freshnessAt,classification:item.classification,score}));
}
export function buildGroundedContext({query,tenantId,role,limit=8,verifiedOnly=false}={}){
 const evidence=retrieveKnowledge({query,tenantId,role,limit,verifiedOnly});
 return {query,tenantId,evidence,groundingRequired:true,instruction:"Answer from supplied evidence when the task requires enterprise facts. Distinguish evidence from inference. Do not invent missing facts.",citations:evidence.map(x=>({sourceId:x.sourceId,uri:x.uri,title:x.title,verified:x.verified}))};
}
export function knowledgeHealth({tenantId}={}){
 const items=[...store.values()].filter(x=>!tenantId||x.tenantId===tenantId);
 return {items:items.length,verified:items.filter(x=>x.verified).length,unverified:items.filter(x=>!x.verified).length,tenants:[...new Set(items.map(x=>x.tenantId))]};
}
// Tenant isolation is mandatory: customer knowledge must never be retrieved across tenantId boundaries.
// Astra should replace the in-memory store with the approved persistent/vector retrieval layer and connect real source ACLs.
