const memory=[];
export function remember({entityType,entityId,category,text,importance=0.5,source=null,expiresAt=null}={}){
 if(!entityType||!entityId||!text)throw new Error("MEMORY_FIELDS_REQUIRED");const m={id:crypto.randomUUID(),entityType,entityId,category:category||"GENERAL",text,importance:Number(importance),source,expiresAt,createdAt:new Date().toISOString()};memory.push(m);return m;
}
export function recall({entityType,entityId,category,limit=20}={}){const now=Date.now();return memory.filter(m=>(!entityType||m.entityType===entityType)&&(!entityId||m.entityId===entityId)&&(!category||m.category===category)&&(!m.expiresAt||Date.parse(m.expiresAt)>now)).sort((a,b)=>b.importance-a.importance).slice(0,limit);}
