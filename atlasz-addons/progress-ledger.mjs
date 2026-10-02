export function progressEntry({taskId,metric,before,after,evidence=null,note=null}={}){
 const delta=Number(after||0)-Number(before||0);return {taskId,metric,before,after,delta,evidence,note,at:new Date().toISOString()};
}
export function summarizeProgress(entries=[]){return {entries:entries.length,positive:entries.filter(x=>x.delta>0).length,stalled:entries.filter(x=>x.delta===0).length,last:entries.at(-1)||null};}
