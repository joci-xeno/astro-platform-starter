const memory=[];
export function remember({entityType,entityId,category,text,importance=0.5,source=null,expiresAt=null}={}){
 if(!entityType||!entityId||!text)throw new Error("MEMORY_FIELDS_REQUIRED");const weight=Number(importance);if(!Number.isFinite(weight)||weight<0||weight>1)throw new Error("MEMORY_IMPORTANCE_MUST_BE_0_TO_1");if(expiresAt&&!Number.isFinite(Date.parse(expiresAt)))throw new Error("INVALID_MEMORY_EXPIRY");const m={id:crypto.randomUUID(),entityType,entityId,category:category||"GENERAL",text,importance:weight,source,expiresAt,createdAt:new Date().toISOString()};memory.push(m);return m;
}
export function recall({entityType,entityId,category,limit=20}={}){const now=Date.now();return memory.filter(m=>(!entityType||m.entityType===entityType)&&(!entityId||m.entityId===entityId)&&(!category||m.category===category)&&(!m.expiresAt||Date.parse(m.expiresAt)>now)).sort((a,b)=>b.importance-a.importance).slice(0,limit);}
