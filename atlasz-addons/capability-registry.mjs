const registry=new Map();
export function registerCapability(agentId,{capabilities=[],tools=[],limits=[],costClass="UNKNOWN"}={}){
 if(!agentId) throw new Error("AGENT_ID_REQUIRED");if(!Array.isArray(capabilities)||!Array.isArray(tools)||!Array.isArray(limits))throw new Error("CAPABILITY_ARRAYS_REQUIRED");const v={agentId,capabilities:[...new Set(capabilities)],tools:[...new Set(tools)],limits,costClass,updatedAt:new Date().toISOString()};registry.set(agentId,v);return v;
}
export function matchAgents(required=[]){return [...registry.values()].filter(a=>required.every(r=>a.capabilities.includes(r))).sort((a,b)=>a.capabilities.length-b.capabilities.length);}
export function listCapabilities(){return [...registry.values()];}
