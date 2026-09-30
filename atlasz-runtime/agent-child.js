import { parentPort, workerData } from "node:worker_threads";

const id = workerData.id;
const team = Math.floor((id-1)/5)+1;
const pod = id<=10?"A":id<=20?"B":"C";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const LOOP_MS = Number(process.env.ATLASZ_AGENT_LOOP_MS || 180000);

let state = {
  id, team, pod,
  status: OPENAI_API_KEY ? "STARTING" : "BLOCKED_NO_KEY",
  heartbeat: new Date().toISOString(),
  completed: 0,
  aiCalls: 0,
  currentTask: null,
  nextTask: null,
  lastDecision: null,
  lastError: OPENAI_API_KEY ? null : "OPENAI_API_KEY missing",
  memory: []
};

const themes = [
  "AI automation","software development","web development","no-code automation","data research",
  "lead generation","CRM and sales operations","video editing","translation localization","QA testing",
  "customer support","virtual assistance","ecommerce operations","SEO content operations","API integrations",
  "market research","tender RFP research","proposal support","spreadsheet reporting","digital services",
  "micro freelance projects","recurring retainers","business process automation","documentation","AI evaluation",
  "design production","research assistance","workflow setup","content operations","global remote work"
];

const sources = [
  async q => (await (await fetch("https://remotive.com/api/remote-jobs?limit=100")).json()).jobs || [],
  async q => (await (await fetch("https://www.arbeitnow.com/api/job-board-api")).json()).data || [],
  async q => {
    const j = await (await fetch("https://remoteok.com/api",{headers:{"User-Agent":"ATLASZ-30"}})).json();
    return Array.isArray(j)?j.slice(1):[];
  },
  async q => {
    const j = await (await fetch("https://hn.algolia.com/api/v1/search_by_date?query="+encodeURIComponent(q)+"&tags=story&hitsPerPage=50")).json();
    return j.hits || [];
  }
];

function send(type, extra={}) {
  parentPort.postMessage({type, state:{...state, memory:undefined}, ...extra});
}

async function askModel(theme, items){
  const compact = items.slice(0,15).map((x,i)=>({
    i,
    title:x.title||x.position||x.name||"",
    company:x.company_name||x.company||"",
    url:x.url||x.apply_url||x.absolute_url||"",
    description:String(x.description||x.content||x.story_text||"").replace(/<[^>]*>/g," ").slice(0,700)
  }));
  const system = `You are ATLASZ independent AI Agent ${id}, Team ${team}. Find lawful, realistic, zero-upfront-cost paid opportunities worldwide. Optimize for attainability, speed to cash, realistic value and low friction. Small jobs count. Never fabricate qualifications or results. Never spend money or legally bind the owner. Only actually received money counts as revenue.`;
  const prompt = system+"\n\nCurrent market theme: "+theme+"\n\nCandidates:\n"+JSON.stringify(compact)+"\n\nReturn JSON only: {bestIndexes:[up to 5 integers], rationale:string, nextTheme:string, outreachAngle:string}.";
  const res = await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{"Authorization":"Bearer "+OPENAI_API_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({model:OPENAI_MODEL,input:prompt})
  });
  if(!res.ok) throw new Error("OpenAI "+res.status+": "+(await res.text()).slice(0,300));
  const data = await res.json();
  const txt = data.output_text || data.output?.flatMap(x=>x.content||[]).map(x=>x.text||"").join("") || "";
  let parsed;
  try { parsed=JSON.parse(txt); } catch { parsed={raw:txt}; }
  state.aiCalls++;
  return {parsed, compact};
}

async function cycle(){
  if(!OPENAI_API_KEY){
    state.status="BLOCKED_NO_KEY";
    state.heartbeat=new Date().toISOString();
    send("heartbeat");
    return;
  }
  state.status="RUNNING";
  const theme=themes[(id-1+state.completed)%themes.length];
  const nextTheme=themes[(id+state.completed)%themes.length];
  state.currentTask="Independent AI evaluation: "+theme;
  state.nextTask="Independent AI evaluation: "+nextTheme;
  state.heartbeat=new Date().toISOString();
  send("heartbeat");
  try{
    const source=sources[(id-1+state.completed)%sources.length];
    const items=await source(theme);
    const result=await askModel(theme,items);
    state.lastDecision=result.parsed;
    state.memory.push({at:new Date().toISOString(),theme,decision:result.parsed});
    if(state.memory.length>20) state.memory.shift();
    state.completed++;
    state.status="QUEUED";
    state.lastError=null;
    state.heartbeat=new Date().toISOString();
    send("decision",{theme,decision:result.parsed,candidates:result.compact});
  }catch(e){
    state.status="BLOCKED";
    state.lastError=String(e?.message||e);
    state.heartbeat=new Date().toISOString();
    send("error");
  }
}

async function loop(){
  while(true){
    await cycle();
    await new Promise(r=>setTimeout(r,Math.max(30000,LOOP_MS+(id%10)*1000)));
  }
}

send("started");
loop();
