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
const MIN_RECURRING_MONTHLY = Number(process.env.ATLASZ_MIN_RECURRING_MONTHLY || 100);

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
  model: GEMINI_MODEL,
  business: { opportunitiesFound:0, qualifiedOpportunities:0, outreachPrepared:0, outreachSent:0, repliesReceived:0, proposalsSent:0, proposalValueUsd:0, contractsWon:0, verifiedRevenueUsd:0, lastOpportunity:null, lastOutreachAt:null, lastReplyAt:null, nextAction:null }
};

const businessProblems = [
  "weak paid ads and ad creative","poor landing-page conversion","slow lead follow-up","missed calls and lost inquiries","weak review and reputation flow",
  "manual quoting and appointment booking","weak local search visibility","poor website conversion","repetitive customer support","manual CRM and admin work",
  "weak email or SMS follow-up","content production bottleneck","proposal and estimate bottleneck","lead qualification bottleneck","customer reactivation opportunity"
];

const businessSectors = [
  "home services","construction trades","professional services","automotive services","health and wellness","beauty and personal care","hospitality and food service",
  "real estate and property services","retail and ecommerce","education and training","business-to-business services","local consumer services","specialty contractors","travel and accommodation","technology-enabled small business"
];

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
  const problem=businessProblems[(id-1+Math.floor(Date.now()/LOOP_MS))%businessProblems.length];\n  const sector=businessSectors[(id-1+Math.floor(Date.now()/LOOP_MS))%businessSectors.length];\n  const system = `You are ATLASZ independent AI Agent ${id}, Team ${team}. You operate TWO revenue lanes in parallel: (A) find lawful, realistic, zero-upfront-cost paid work worldwide, and (B) discover small/medium businesses with a concrete commercially valuable problem that ATLASZ can solve digitally or with AI. Current business-discovery sector: ${sector}. Current problem lens: ${problem}. Do not restrict yourself permanently to this sector; rotate and explore broadly. For business-discovery opportunities, require evidence from the supplied source and never invent a company, problem, contact, performance claim, or expected improvement. Propose a specific sample/deliverable ATLASZ could actually create, such as improved ad copy/creative concept, landing-page draft, follow-up workflow, automation design, lead-generation asset, website improvement, content system, or another lawful digital deliverable. Find lawful, realistic, zero-upfront-cost paid opportunities worldwide. Optimize for attainability, speed to cash, realistic value and low friction. HARD RULE: for one-time projects, do not pursue anything explicitly worth less than USD $500. EXCEPTION: recurring subscriptions, retainers, maintenance, monitoring, support, SaaS or other monthly recurring revenue may be pursued below $500/month when legitimate and commercially worthwhile. Prefer higher annualized value, renewal potential and low churn. For one-time work prefer $10k+, then $5k+, $3k+, $1.5k+, $1k+, then $500+. Never fabricate qualifications or results. Never spend money or legally bind the owner. Only actually received money counts as revenue.`;
  const prompt = system+"

Current market theme: "+theme+"

Candidates:
"+JSON.stringify(compact)+"

Return JSON only: {bestIndexes:[up to 5 integers], rationale:string, nextTheme:string, outreachAngle:string, businessOpportunities:[{index:integer,company:string,problem:string,evidence:string,proposedSolution:string,sampleDeliverable:string,estimatedValueUsd:number|null,recurringMonthlyUsd:number|null,nextStep:string}], outreachTasks:[{index:integer,to:string,subject:string,body:string,estimatedValueUsd:number|null}]}. For one-time work, select only opportunities explicitly or plausibly worth at least USD $500. Also allow recurring subscription/retainer/maintenance opportunities below $500/month when they are genuine recurring revenue. Rank by realistic annualized value, attainability, renewal potential and speed to cash. Create an outreachTask ONLY when the selected candidate contains an explicit email address in its emails field. Use that exact address; never invent an address. Keep outreach factual, concise, professional, and do not fabricate qualifications, portfolio items, results, or client history.";
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

function extractMoney(text){
  const vals=[];
  for(const m of String(text||"").matchAll(/(?:USD\s*|CAD\s*|\$)\s*([0-9]{2,7})(?:,([0-9]{3}))?/gi)){
    const n=Number(String(m[1])+(m[2]||""));
    if(Number.isFinite(n)) vals.push(n);
  }
  return vals.length?Math.max(...vals):null;
}

function localFallback(theme,items){
  const compact=items.slice(0,25).map((x,i)=>{
    const raw=String(x.description||x.content||x.story_text||"").replace(/<[^>]*>/g," ");
    const title=x.title||x.position||x.name||"";
    const company=x.company_name||x.company||"";
    const url=x.url||x.apply_url||x.absolute_url||"";
    const emails=[...new Set((raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).map(v=>v.toLowerCase()))];
    const hay=(title+" "+company+" "+raw).toLowerCase();
    const value=extractMoney(hay);
    const themeWords=theme.toLowerCase().split(/\s+/).filter(Boolean);
    let score=0;
    for(const w of themeWords) if(hay.includes(w)) score+=3;
    if(/remote|worldwide|anywhere|canada/.test(hay)) score+=2;
    if(/freelance|contract|project|hiring|seeking|looking for|apply/.test(hay)) score+=3;
    if(/urgent|asap|immediate|start now|this week/.test(hay)) score+=2;
    if(emails.length) score+=3;
    if(value!=null){
      if(value>=10000) score+=6;
      else if(value>=5000) score+=5;
      else if(value>=3000) score+=4;
      else if(value>=1500) score+=3;
      else if(value>=1000) score+=2;
      else if(value>=500) score+=1;
      else score-=10;
    }
    return {i,title,company,url,description:raw.slice(0,900),emails:emails.slice(0,5),estimatedValueUsd:value,score};
  });

  const ranked=compact
    .filter(x=>x.estimatedValueUsd==null || x.estimatedValueUsd>=MIN_JOB_VALUE)
    .sort((a,b)=>b.score-a.score || (b.estimatedValueUsd||0)-(a.estimatedValueUsd||0))
    .slice(0,5);

  const outreachTasks=ranked
    .filter(x=>x.emails.length)
    .map(x=>({
      index:x.i,
      to:x.emails[0],
      subject:`Regarding ${x.title || "your project"}`,
      body:`Hello, I found your posting for ${x.title || "this project"}. We are interested in discussing the work and can review the scope, timeline, and deliverables with you. We do not want to overstate experience or make assumptions, so please send any requirements or documents you would like us to review. Best regards, ATLASZ Project Team`,
      estimatedValueUsd:x.estimatedValueUsd
    }));

  return {
    parsed:{
      bestIndexes:ranked.map(x=>x.i),
      rationale:"Local fallback ranking used because the Gemini API was unavailable or rate-limited. Ranked for relevance, buyer intent, contactability and value; explicit values below the $500 floor were excluded.",
      nextTheme:theme,
      outreachAngle:"Direct, factual project inquiry with no fabricated qualifications.",
      outreachTasks
    },
    compact
  };
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
      result=localFallback(theme,items);
      state.lastError=lastErr||"Gemini unavailable; local fallback used";
      state.status="FALLBACK_ACTIVE";
      state.heartbeat=new Date().toISOString();
      send("fallback",{theme,error:String(state.lastError).slice(0,300),decision:result.parsed,candidates:result.compact});
    }

    state.lastDecision=result.parsed;
    const chosen=(result.parsed?.bestIndexes||[]).map(i=>result.compact?.[i]).filter(Boolean);
    const outreach=Array.isArray(result.parsed?.outreachTasks)?result.parsed.outreachTasks:[];
    const bizOpps=Array.isArray(result.parsed?.businessOpportunities)?result.parsed.businessOpportunities:[];
    state.business.opportunitiesFound += chosen.length + bizOpps.length;
    state.business.qualifiedOpportunities += chosen.length + bizOpps.length;
    state.business.outreachPrepared += outreach.length;
    state.business.lastOpportunity = bizOpps[0] ? {...bizOpps[0],foundAt:new Date().toISOString(),lane:"BUSINESS_PROBLEM"} : (chosen[0] ? {title:chosen[0].title||null,company:chosen[0].company||null,url:chosen[0].url||null,estimatedValueUsd:chosen[0].estimatedValueUsd??null,foundAt:new Date().toISOString(),lane:"PAID_WORK"} : state.business.lastOpportunity);
    state.business.nextAction = outreach.length ? "USER_APPROVAL_OR_AUTHORIZED_SEND_REQUIRED" : ((chosen.length||bizOpps.length) ? "FIND_VERIFIED_CONTACT_OR_APPLICATION_PATH" : "CONTINUE_SEARCH");
    state.memory.push({at:new Date().toISOString(),theme,decision:result.parsed});
    if(state.memory.length>20) state.memory.shift();
    state.completed++;
    state.status="QUEUED";
    if(!String(state.lastError||"").includes("Gemini")) state.lastError=null;
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
