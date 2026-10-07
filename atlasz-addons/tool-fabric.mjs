import {isTested} from "./probe-evidence.mjs";
// ATLASZ Tool Fabric v1.0
// Central capability catalogue. Entries are catalogued, NOT live, until a real adapter is connected and tested.
export const TOOL_FABRIC_CATALOG=Object.freeze([
{id:"web-search",category:"WEB",capabilities:["search","research","source-verify"]},
{id:"browser",category:"WEB",capabilities:["browse","navigate","download","upload"]},
{id:"computer-use",category:"COMPUTER",capabilities:["click","type","scroll","desktop-app","browser-ui"]},
{id:"files",category:"FILES",capabilities:["read-file","write-file","organize-files"]},
{id:"code",category:"CODE",capabilities:["create-code","edit-code","debug-code","run-code"]},
{id:"test",category:"TEST",capabilities:["test","qa","regression"]},
{id:"github",category:"CODE",capabilities:["repo-read","repo-write","issues","pull-request"]},
{id:"data-analysis",category:"DATA",capabilities:["analyze-data","transform-data","extract-data"]},
{id:"spreadsheet",category:"SPREADSHEET",capabilities:["xlsx","csv","formula","table"]},
{id:"document",category:"DOCUMENT",capabilities:["docx","pdf","text-document"]},
{id:"media",category:"MEDIA",capabilities:["image","video","audio"]},
{id:"email",category:"EMAIL",capabilities:["email-read","email-draft","email-send"]},
{id:"crm",category:"CRM",capabilities:["contact","lead","pipeline"]},
{id:"research",category:"RESEARCH",capabilities:["deep-research","company-research","market-research"]},
{id:"calendar",category:"PRODUCTIVITY",capabilities:["calendar-read","calendar-write","availability"]},
{id:"contacts",category:"PRODUCTIVITY",capabilities:["contact-read","contact-find"]},
{id:"cloud-drive",category:"FILES",capabilities:["cloud-read","cloud-write","cloud-search"]},
{id:"database",category:"DATA",capabilities:["database-read","database-write","records"]},
{id:"deploy",category:"DEVOPS",capabilities:["deploy","logs","runtime-status"]},
{id:"design",category:"DESIGN",capabilities:["design-create","design-edit","prototype"]},
{id:"voice-stt",category:"VOICE",capabilities:["speech-to-text"]},
{id:"voice-tts",category:"VOICE",capabilities:["text-to-speech"]},
{id:"invoice",category:"FINANCE",capabilities:["invoice-create","invoice-track"]},
{id:"payment-evidence",category:"FINANCE",capabilities:["payment-confirm"]},
{id:"accounting",category:"FINANCE",capabilities:["bookkeeping","tax-prep","gst","pst"]}
]);
const registry=new Map(TOOL_FABRIC_CATALOG.map(x=>[x.id,{...x,state:"PLACEHOLDER_UNCONNECTED",tested:false,live:false,adapter:null,costClass:"UNKNOWN"}]));
export function connectFabricTool({id,adapter=null,tested=false,probeEvidence=null,costClass="UNKNOWN"}={}){tested=isTested(tested,probeEvidence);
 const t=registry.get(id); if(!t)throw new Error("UNKNOWN_TOOL");
 if(!adapter)throw new Error("REAL_ADAPTER_REQUIRED");
 Object.assign(t,{adapter,costClass,tested:Boolean(tested),live:Boolean(tested),state:tested?"LIVE":"CONNECTED_UNTESTED"});
 return publicTool(t);
}
const publicTool=t=>{const {adapter,...x}=t;return {...x};};
export function toolFabricList(){return [...registry.values()].map(publicTool);}
export function toolFabricGet(id){const t=registry.get(id);return t?publicTool(t):null;}
export function toolFabricPlan(required=[]){
 const live=[...registry.values()].filter(x=>x.live);
 const selected=live.filter(t=>required.some(r=>t.capabilities.includes(r)));
 const covered=required.filter(r=>selected.some(t=>t.capabilities.includes(r)));
 return {required,selected:selected.map(x=>x.id),covered,missing:required.filter(r=>!covered.includes(r)),ready:covered.length===required.length};
}
export function toolFabricSummary(){const x=[...registry.values()];return {catalogued:x.length,live:x.filter(t=>t.live).length,connectedUntested:x.filter(t=>t.state==="CONNECTED_UNTESTED").length,placeholders:x.filter(t=>t.state==="PLACEHOLDER_UNCONNECTED").length};}
