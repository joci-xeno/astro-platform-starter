export const KNOWLEDGE_LAYER_VERSION="1.0.0";
const store=new Map();
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
// Durable mode (85-capability G07/GE09): configureKnowledgeStore({file}) loads items from a JSON file and persists every change atomically (tmp+rename, mode 0600).
// Default stays in-memory. A corrupt file is NEVER overwritten: configuration fails closed. Retrieval remains lexical and extractive (semantic/vector ranking and generation are external).
let storeFile=null;
const SHAPE=x=>x&&typeof x==="object"&&typeof x.id==="string"&&typeof x.tenantId==="string"&&typeof x.sourceId==="string"&&typeof x.text==="string"&&Array.isArray(x.allowedRoles)&&x.allowedRoles.length>0&&x.allowedRoles.every(r=>typeof r==="string");
function persist(){if(!storeFile)return;fs.mkdirSync(path.dirname(storeFile),{recursive:true});const t=storeFile+".tmp";fs.writeFileSync(t,JSON.stringify({version:1,items:[...store.values()]}),{mode:0o600});fs.renameSync(t,storeFile);}
export function configureKnowledgeStore({file=null}={}){
 if(file===null){storeFile=null;store.clear();return {items:0,skipped:0,durable:false};}
 if(typeof file!=="string"||!file)throw new Error("KNOWLEDGE_FILE_INVALID");
 const next=new Map();let skipped=0;
 if(fs.existsSync(file)){let doc;try{doc=JSON.parse(fs.readFileSync(file,"utf8"));}catch{throw new Error("KNOWLEDGE_STORE_UNREADABLE");}
  if(!doc||!Array.isArray(doc.items))throw new Error("KNOWLEDGE_STORE_UNREADABLE");
  for(const x of doc.items){if(SHAPE(x)&&!next.has(x.id))next.set(x.id,x);else skipped++;}}
 store.clear();for(const [k,v] of next)store.set(k,v);storeFile=file;return {items:store.size,skipped,durable:true};
}
export function removeKnowledge({id,tenantId}={}){
 const it=store.get(id);if(!it||it.tenantId!==tenantId)return {ok:false,reason:"NOT_FOUND"};
 store.delete(id);try{persist();}catch(e){store.set(id,it);throw e;}return {ok:true};
}
const uid=()=>randomUUID();
export function ingestKnowledge({id,tenantId,sourceId,sourceType="DOCUMENT",title,text,uri=null,classification="INTERNAL",allowedRoles=["*"],verified=false,freshnessAt=null,metadata={}}={}){
 if(!tenantId||!sourceId||!text)throw new Error("TENANT_SOURCE_TEXT_REQUIRED");if(!Array.isArray(allowedRoles)||allowedRoles.length===0)throw new Error("KNOWLEDGE_ALLOWED_ROLES_REQUIRED");if(freshnessAt&&!Number.isFinite(Date.parse(freshnessAt)))throw new Error("INVALID_KNOWLEDGE_FRESHNESS");
 const item={id:id||uid(),tenantId,sourceId,sourceType,title:title||sourceId,text,uri,classification,allowedRoles:[...new Set(allowedRoles)],verified:Boolean(verified),freshnessAt:freshnessAt||new Date().toISOString(),metadata,createdAt:new Date().toISOString()};
 const prev=store.get(item.id);if(prev&&prev.tenantId!==tenantId)throw new Error("KNOWLEDGE_ID_BELONGS_TO_ANOTHER_TENANT");
 store.set(item.id,item);try{persist();}catch(e){if(prev)store.set(item.id,prev);else store.delete(item.id);throw e;}return item;
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
