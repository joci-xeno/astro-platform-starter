const queue=[];
export function deadLetter({item,error,attempts,traceId}={}){const e={id:crypto.randomUUID(),item,error:String(error?.message||error||"UNKNOWN"),attempts:Number(attempts||0),traceId:traceId||null,status:"OPEN",createdAt:new Date().toISOString()};queue.push(e);return e;}
export function listDeadLetters(status="OPEN"){return queue.filter(x=>!status||x.status===status);}
export function resolveDeadLetter(id,note){const x=queue.find(q=>q.id===id);if(!x)throw new Error("DEAD_LETTER_NOT_FOUND");x.status="RESOLVED";x.resolution=note;x.resolvedAt=new Date().toISOString();return x;}
