const tools=new Map();
export const TOOL_CATEGORIES=["FILES","CODE","TEST","WEB","COMPUTER","DATA","SPREADSHEET","DOCUMENT","MEDIA","EMAIL","CRM","RESEARCH","DELIVERY","PRODUCTIVITY","DEVOPS","DESIGN","VOICE","FINANCE"];
export function registerTool({id,category,capabilities=[],available=false,requiresApproval=false,costClass="UNKNOWN",adapter=null}={}){
 if(!id||!TOOL_CATEGORIES.includes(category))throw new Error("VALID_TOOL_ID_CATEGORY_REQUIRED");
 const t={id,category,capabilities:[...new Set(capabilities)],available:Boolean(available),requiresApproval:Boolean(requiresApproval),costClass,adapter,updatedAt:new Date().toISOString()};tools.set(id,t);return t;
}
export function toolsFor(required=[]){return [...tools.values()].filter(t=>t.available&&required.every(r=>t.capabilities.includes(r)));}
export function executionPlan(required=[]){const matched=toolsFor(required);return {required,matched:matched.map(x=>x.id),ready:required.every(r=>matched.some(t=>t.capabilities.includes(r))),missing:required.filter(r=>!matched.some(t=>t.capabilities.includes(r)))};}
export function listTools(){return [...tools.values()];}
// Astra should register only tools that are actually connected and tested; never mark an unavailable integration as available.
