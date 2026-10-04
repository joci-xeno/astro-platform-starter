export function createTaskLedger({taskId,goal,facts=[],unknowns=[],subtasks=[],doneDefinition=[]}={}){
 if(!taskId||!goal) throw new Error("TASK_ID_AND_GOAL_REQUIRED");
 if(!Array.isArray(facts)||!Array.isArray(unknowns)||!Array.isArray(subtasks)||!Array.isArray(doneDefinition))throw new Error("TASK_LEDGER_ARRAYS_REQUIRED");return {taskId,goal,facts:structuredClone(facts),unknowns:structuredClone(unknowns),subtasks:structuredClone(subtasks),doneDefinition:structuredClone(doneDefinition),status:"ACTIVE",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
export function updateTaskLedger(l,p={}){if(!l?.taskId)throw new Error("TASK_LEDGER_REQUIRED");const {taskId:_ignored,...safePatch}=p||{};return {...l,...safePatch,taskId:l.taskId,updatedAt:new Date().toISOString()};}
export function taskComplete(l){return l.doneDefinition.length>0&&l.doneDefinition.every(d=>d.passed===true);}
