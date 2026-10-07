import {emergencyGate} from "./emergency-stop.mjs";
import {isTested} from "./probe-evidence.mjs";
// ATLASZ Multi-Model Brain registry/router. Providers are never LIVE without a real adapter and successful probe.
const providers=new Map();
export function registerModelProvider({id,label,adapter=null,models=[],tested=false,probeEvidence=null,costClass="UNKNOWN",capabilities=[]}={}){tested=isTested(tested,probeEvidence);
 if(!id||!label)throw new Error("PROVIDER_ID_LABEL_REQUIRED");if(!adapter||typeof adapter.invoke!=="function")throw new Error("REAL_ADAPTER_REQUIRED");if(!Array.isArray(models)||!Array.isArray(capabilities))throw new Error("PROVIDER_ARRAYS_REQUIRED");if(tested&&models.length===0)throw new Error("TESTED_PROVIDER_REQUIRES_MODEL");
 const p={id,label,models:[...new Set(models)],tested:Boolean(tested),state:tested?"LIVE":"CONNECTED_UNTESTED",costClass,capabilities:[...new Set(capabilities)],adapter,updatedAt:new Date().toISOString()};providers.set(id,p);return publicProvider(p);
}
const publicProvider=p=>{const {adapter,...x}=p;return {...x};};
export function modelProviderList(){return [...providers.values()].map(publicProvider);}
export function modelProviderHealth(){const p=[...providers.values()];return {registered:p.length,live:p.filter(x=>x.tested).length,connectedUntested:p.filter(x=>!x.tested).length,providers:p.map(publicProvider)};}
export function selectModel({requiredCapabilities=[],maxCostClass=null,excludeProviders=[]}={}){
 const rank={FREE:0,LOW:1,MEDIUM:2,HIGH:3,UNKNOWN:9};const max=maxCostClass?rank[maxCostClass]??9:9;
 const eligible=[...providers.values()].filter(p=>p.tested&&!excludeProviders.includes(p.id)&&(rank[p.costClass]??9)<=max&&requiredCapabilities.every(c=>p.capabilities.includes(c)));
 return eligible.length?publicProvider(eligible.sort((a,b)=>(rank[a.costClass]??9)-(rank[b.costClass]??9))[0]):null;
}
export async function invokeModel({providerId,request}={}){const stop=emergencyGate({external:true});if(!stop.allowed)throw new Error("DISPATCH_BLOCKED_BY_OWNER_STOP:"+stop.reason);const p=providers.get(providerId);if(!p)throw new Error("MODEL_PROVIDER_NOT_REGISTERED");if(!p.tested)throw new Error("MODEL_PROVIDER_UNTESTED");if(typeof p.adapter?.invoke!=="function")throw new Error("MODEL_INVOKE_ADAPTER_REQUIRED");return p.adapter.invoke(request);}
export function independentJudgePlan({workerProviderId}={}){const alt=[...providers.values()].find(p=>p.tested&&p.id!==workerProviderId);return alt?{ready:true,judgeProvider:alt.id}:{ready:false,reason:"INDEPENDENT_PROVIDER_UNAVAILABLE"};}
