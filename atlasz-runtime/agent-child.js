import { parentPort, workerData } from "node:worker_threads";

const id = workerData.id;
const team = Math.floor((id-1)/5)+1;
const pod = id<=10?"A":id<=20?"B":"C";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const LOOP_MS = Number(process.env.ATLASZ_AGENT_LOOP_MS || 600000);
const START_STAGGER_MS = Number(process.env.ATLASZ_START_STAGGER_MS || 15000);
const RETRY_BASE_MS = Number(process.env.ATLASZ_RETRY_BASE_MS || 65000);
const MAX_RETRIES = Number(process.env.ATLASZ_MAX_RETRIES || 1);
const MIN_JOB_VALUE = Number(process.env.ATLASZ_MIN_JOB_VALUE || 500);

let state = {
  id, team, pod,
  status: GEMINI_API_KEY ? "STARTING" : "BLOCKED_NO_KEY",
  heartbeat: new Date().toISOString(),
  completed: 0,
  aiCalls: 0,
  currentTask: null,
  nextTask: null,
  lastDecision: null,
  lastError: GEMINI_API_KEY ? null : "GEMINI_API_KEY missing",
  memory: [],
  provider: "Google Gemini",
  model: GEMINI_MODEL
};

const themes = [
  "AI automation","software development","web development","no-code automation","data research",
  "lead generation","CRM and sales operations","video editing","translation localization","QA testing",
  "customer support","virtual assistance","ecommerce operations","SEO content operations","API integrations",
  "market research","tender RFP research","proposal support","spreadsheet reporting","digital services",
  "high-value freelance projects","recurring retainers","business process automation","documentation","AI evaluation",
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
  const compact = items.slice(0,15).map((x,i)=>{
    const raw=String(x.description||x.content||x.story_text||"").replace(/<[^>]*>/g," ");
    const emails=[...new Set((raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).map(v=>v.toLowerCase()))];
    return {
      i,
      title:x.title||x.position||x.name||"",
      company:x.company_name||x.company||"",
      url:x.url||x.apply_url||x.absolute_url||"",
      description:raw.slice(0,900),
      emails:emails.slice(0,5)
    };
  });
  const system = `You are ATLASZ independent AI Agent ${id}, Team ${team}. Find lawful, realistic, zero-upfront-cost paid opportunities worldwide. Optimize for attainability, speed to cash, realistic value and low friction. HARD RULE: do not pursue any opportunity explicitly worth less than USD $500. Prefer the highest realistic value first ($10k+, then $5k+, $3k+, $1.5k+, $1k+, then $500+). Never fabricate qualifications or results. Never spend money or legally bind the owner. Only actually received money counts as revenue.`;
  const prompt = system+"\n\nCurrent market theme: "+theme+"\n\nCandidates:\n"+JSON.stringify(compact)+"\n\nReturn JSON only: {bestIndexes:[up to 5 integers], rationale:string, nextTheme:string, outreachAngle:string, outreachTasks:[{index:integer,to:string,subject:string,body:string,estimatedValueUsd:number|null}]}. Select only opportunities that are explicitly or plausibly worth at least USD $500; rank higher-value realistic opportunities first. Create an outreachTask ONLY when the selected candidate contains an explicit email address in its emails field. Use that exact address; never invent an address. Keep outreach factual, concise, professional, and do not fabricate qualifications, portfolio items, results, or client history.";
  const url="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(GEMINI_MODEL)+":generateContent";
  const res = await fetch(url,{
    method:"POST",
    headers:{"x-goog-api-key":GEMINI_API_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({
      contents:[{parts:[{text:prompt}]}],
      generationConfig:{
        responseMimeType:"application/json",
        thinkingConfig:{thinkingLevel:"medium"}
      }
    })
  });
  if(!res.ok) throw new Error("Gemini "+res.status+": "+(await res.text()).slice(0,500));
  const data = await res.json();
  const txt = data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("") || "";
  let parsed;
  try { parsed=JSON.parse(txt); } catch { parsed={raw:txt}; }
  state.aiCalls++;
  return {parsed, compact};
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function parseRetryMs(message){
  const m=String(message||"").match(/retry in ([0-9.]+)s/i);
  return m ? Math.ceil(Number(m[1])*1000) : null;
}

async function cycle(){
  if(!GEMINI_API_KEY){
    state.status="BLOCKED_NO_KEY";
    state.heartbeat=new Date().toISOString();
    send("heartbeat");
    return;
  }
  state.status="RUNNING";
  // Global round keeps all 30 agents on 30 different lanes at the same time.
  const round=Math.floor(Date.now()/LOOP_MS);
  const theme=themes[(id-1+round)%themes.length];
  const nextTheme=themes[(id+round)%themes.length];
  state.currentTask="Independent AI evaluation: "+theme;
  state.nextTask="Independent AI evaluation: "+nextTheme;
  state.heartbeat=new Date().toISOString();
  send("heartbeat");
  try{
    const source=sources[(id-1+round)%sources.length];
    const items=await source(theme);

    let result=null;
    let lastErr=null;
    for(let attempt=1; attempt<=MAX_RETRIES; attempt++){
      try{
        state.status = attempt===1 ? "RUNNING" : "RETRY_WAIT";
        state.heartbeat=new Date().toISOString();
        send("heartbeat",{attempt});
        result=await askModel(theme,items);
        lastErr=null;
        break;
      }catch(e){
        lastErr=String(e?.message||e);
        state.lastError=lastErr;
        state.heartbeat=new Date().toISOString();

        const is429=/Gemini 429/.test(lastErr);
        const is503=/Gemini 503/.test(lastErr);
        if(!(is429||is503) || attempt===MAX_RETRIES) break;

        const serverRetry=parseRetryMs(lastErr);
        const jitter=(id%7)*1000;
        const waitMs=Math.max(serverRetry||0, RETRY_BASE_MS*Math.min(attempt,3)) + jitter;
        state.status="RETRY_WAIT";
        send("retry",{attempt,waitMs,error:lastErr.slice(0,300)});
        await sleep(waitMs);
      }
    }

    if(!result){
      state.status="RETRY_WAIT";
      state.lastError=lastErr||"Gemini call failed after retries";
      state.heartbeat=new Date().toISOString();
      send("error");
      return;
    }

    state.lastDecision=result.parsed;
    state.memory.push({at:new Date().toISOString(),theme,decision:result.parsed});
    if(state.memory.length>20) state.memory.shift();
    state.completed++;
    state.status="QUEUED";
    state.lastError=null;
    state.heartbeat=new Date().toISOString();
    send("decision",{theme,decision:result.parsed,candidates:result.compact});
  }catch(e){
    state.status="RETRY_WAIT";
    state.lastError=String(e?.message||e);
    state.heartbeat=new Date().toISOString();
    send("error");
  }
}

async function loop(){
  await sleep((id-1)*START_STAGGER_MS);
  while(true){
    await cycle();
    const waitMs=Math.max(60000,LOOP_MS+(id%10)*5000);
    await sleep(waitMs);
  }
}

send("started");
loop();
