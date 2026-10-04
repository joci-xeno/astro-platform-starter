export function progressEntry({taskId,metric,before,after,evidence=null,note=null}={}){
 if(!taskId||!metric)throw new Error("PROGRESS_TASK_METRIC_REQUIRED");const b=Number(before),a=Number(after);if(!Number.isFinite(b)||!Number.isFinite(a))throw new Error("INVALID_PROGRESS_VALUES");const delta=a-b;return {taskId,metric,before:b,after:a,delta,evidence,note,at:new Date().toISOString()};
}
export function summarizeProgress(entries=[]){return {entries:entries.length,positive:entries.filter(x=>x.delta>0).length,stalled:entries.filter(x=>x.delta===0).length,last:entries.at(-1)||null};}
