import http from "node:http";

const PORT = Number(process.env.PORT || 3000);
const AGENT_COUNT = 30;
const LOOP_MS = Number(process.env.ATLASZ_LOOP_MS || 180000);
const MAX_OPPS = 500;

const policy = {
  version: "atlasz-competition-v1",
  agents: 30,
  teams: 6,
  teamSize: 5,
  zeroSpend: true,
  revenueRule: "Only confirmed received money counts as revenue.",
  milestonesCad: [5000,10000,15000,50000,100000,1000000],
  prize: "Top agent/team may receive a humanoid robot/platform only if actual ATLASZ revenue supports it and owner explicitly approves."
};

const themes = [
  "AI automation","n8n","Make.com","workflow automation","AI agents",
  "web development","landing page","WordPress","Shopify","Webflow",
  "lead generation","CRM automation","sales ops","data enrichment","appointment setting",
  "market research","data analysis","QA testing","AI evaluation","AI training",
  "video editing","YouTube editor","localization","Hungarian translation","social media",
  "Google Sheets automation","dashboard automation","operations automation","no-code","API integration"
];

const agents = Array.from({length:AGENT_COUNT},(_,i)=>({
  id:i+1, team:Math.floor(i/5)+1, pod:i<10?"A":i<20?"B":"C",
  status:"STARTING", heartbeat:null, currentTask:null, nextTask:null,
  completed:0, found:0, lastError:null, lastRun:null
}));

const opportunities = [];
const seen = new Set();
let supervisor = {status:"STARTING", heartbeat:null, cycles:0, startedAt:new Date().toISOString()};

function normalizeJob(raw, source){
  return {
    source,
    title: raw.title || raw.position || raw.name || "",
    company: raw.company_name || raw.company || raw.organization || "",
    url: raw.url || raw.apply_url || raw.job_url || raw.absolute_url || "",
    description: raw.description || raw.description_text || raw.content || "",
    category: raw.category || raw.job_type || "",
    location: raw.location || raw.candidate_required_location || "",
    published: raw.publication_date || raw.created_at || raw.date || raw.created || ""
  };
}

async function fetchJson(url){
  const res = await fetch(url,{headers:{"User-Agent":"ATLASZ-30/1.0 opportunity-research"}});
  if(!res.ok) throw new Error(`${res.status} ${res.statusText} @ ${url}`);
  return res.json();
}

async function sourceRemotive(query){
  const j=await fetchJson("https://remotive.com/api/remote-jobs?limit=100");
  return (j.jobs||[]).map(x=>normalizeJob(x,"Remotive"));
}
async function sourceArbeitnow(query){
  const j=await fetchJson("https://www.arbeitnow.com/api/job-board-api");
  return (j.data||[]).map(x=>normalizeJob(x,"Arbeitnow"));
}
async function sourceRemoteOK(query){
  const j=await fetchJson("https://remoteok.com/api");
  return (Array.isArray(j)?j.slice(1):[]).map(x=>normalizeJob(x,"RemoteOK"));
}
async function sourceHN(query){
  const q=encodeURIComponent(query);
  const j=await fetchJson(`https://hn.algolia.com/api/v1/search_by_date?query=${q}&tags=story&hitsPerPage=50`);
  return (j.hits||[]).map(x=>normalizeJob({
    title:x.title||x.story_title,
    company:"",
    url:x.url||x.story_url||`https://news.ycombinator.com/item?id=${x.objectID}`,
    description:x.story_text||x.comment_text||"",
    date:x.created_at
  },"HackerNews"));
}
const sources=[sourceRemotive,sourceArbeitnow,sourceRemoteOK,sourceHN];

function extractEmails(text=""){
  return [...new Set((String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).map(x=>x.toLowerCase()))].slice(0,5);
}

function extractValue(text=""){
  const vals=[];
  for(const m of String(text).matchAll(/(?:USD\s*|CAD\s*|\$)\s*([0-9]{2,7})(?:,([0-9]{3}))?/gi)){
    const n=Number(String(m[1])+(m[2]||""));
    if(Number.isFinite(n)) vals.push(n);
  }
  return vals.length?Math.max(...vals):null;
}

function score(job, theme){
  const text=(job.title+" "+job.company+" "+job.description+" "+job.category+" "+job.location).toLowerCase();
  const words=theme.toLowerCase().split(/\s+/).filter(Boolean);
  let fit=0;
  for(const w of words) if(text.includes(w)) fit+=3;

  const buyerIntent=/hiring|looking for|needed|seeking|apply|contract|freelance|project/.test(text)?4:0;
  const remote=/remote|worldwide|anywhere|canada/.test(text)?2:0;
  const direct=/apply|email|contact|submit|proposal/.test(text)?3:0;
  const urgent=/urgent|asap|immediate|start now|this week|quick/.test(text)?2:0;
  const friction=/paid connect|membership fee|subscription required|identity verification/.test(text)?4:0;
  const estimatedValueUsd=extractValue(text);

  let valueScore=0;
  if(estimatedValueUsd!=null){
    if(estimatedValueUsd>=10000) valueScore=5;
    else if(estimatedValueUsd>=5000) valueScore=4;
    else if(estimatedValueUsd>=2000) valueScore=3;
    else if(estimatedValueUsd>=1000) valueScore=2;
    else if(estimatedValueUsd>=500) valueScore=1;
    else valueScore=-8;
  }

  const score=Math.max(0,fit+buyerIntent+remote+direct+urgent+valueScore-friction);
  const priorityClass=score>=12?"A":score>=7?"B":"C";
  return {score,fit,buyerIntent,remote,direct,urgent,friction,estimatedValueUsd,priorityClass};
}

function addOpportunity(agent,theme,job,sc){
  const key=(job.url||job.title+"|"+job.company).toLowerCase();
  if(!key || seen.has(key)) return false;
  seen.add(key);

  const emails=extractEmails(job.description);
  const nextAction=emails.length
    ? "PREPARE_OUTREACH_FOR_APPROVAL"
    : job.url
      ? "REVIEW_APPLICATION_PAGE"
      : "FIND_VERIFIED_CONTACT";

  opportunities.push({
    id:`${Date.now()}-${agent.id}`,
    agentId:agent.id,
    team:agent.team,
    pod:agent.pod,
    theme,
    score:sc.score,
    priorityClass:sc.priorityClass,
    estimatedValueUsd:sc.estimatedValueUsd,
    emails,
    nextAction,
    foundAt:new Date().toISOString(),
    ...job
  });

  opportunities.sort((a,b)=>{
    const rank={A:3,B:2,C:1};
    return (rank[b.priorityClass]-rank[a.priorityClass]) || (b.score-a.score) || ((b.estimatedValueUsd||0)-(a.estimatedValueUsd||0));
  });
  if(opportunities.length>MAX_OPPS) opportunities.length=MAX_OPPS;
  return true;
}

async function runAgent(agent){
  const theme=themes[(agent.id-1+agent.completed)%themes.length];
  const nextTheme=themes[(agent.id+agent.completed)%themes.length];
  agent.status="RUNNING";
  agent.currentTask=`Search fresh paid opportunities: ${theme}`;
  agent.nextTask=`Search fresh paid opportunities: ${nextTheme}`;
  agent.heartbeat=new Date().toISOString();
  agent.lastError=null;
  try{
    const source=sources[(agent.id-1+agent.completed)%sources.length];
    const jobs=await source(theme);
    let added=0;
    for(const job of jobs){
      const sc=score(job,theme);
      if(sc.score>=1 && addOpportunity(agent,theme,job,sc)) added++;
    }
    agent.found+=added;
    agent.completed++;
    agent.lastRun=new Date().toISOString();
    agent.heartbeat=agent.lastRun;
    agent.status="QUEUED";
  }catch(e){
    agent.lastError=String(e?.message||e);
    agent.lastRun=new Date().toISOString();
    agent.heartbeat=agent.lastRun;
    agent.status="BLOCKED";
  }
}

async function workerLoop(agent){
  while(true){
    await runAgent(agent);
    const stagger=(agent.id%10)*1000;
    await new Promise(r=>setTimeout(r,Math.max(30000,LOOP_MS+stagger)));
  }
}

async function supervisorLoop(){
  supervisor.status="ACTIVE";
  while(true){
    supervisor.heartbeat=new Date().toISOString();
    supervisor.cycles++;
    const now=Date.now();
    for(const a of agents){
      if(a.heartbeat && now-Date.parse(a.heartbeat)>Math.max(LOOP_MS*3,600000) && a.status!=="RUNNING"){
        a.status="STALE";
      }
    }
    await new Promise(r=>setTimeout(r,60000));
  }
}

const server=http.createServer((req,res)=>{
  res.setHeader("content-type","application/json; charset=utf-8");
  if(req.url==="/health"){
    res.end(JSON.stringify({ok:true,supervisor:supervisor.status,agents:agents.length,heartbeat:supervisor.heartbeat}));
    return;
  }
  if(req.url==="/opportunities"){
    const countsByClass=opportunities.reduce((m,o)=>(m[o.priorityClass]=(m[o.priorityClass]||0)+1,m),{A:0,B:0,C:0});
    res.end(JSON.stringify({count:opportunities.length,countsByClass,opportunities:opportunities.slice(0,200)}));
    return;
  }
  if(req.url==="/actionable"){
    const actionable=opportunities
      .filter(o=>o.priorityClass==="A")
      .slice(0,50)
      .map(o=>({
        id:o.id,
        title:o.title,
        company:o.company,
        source:o.source,
        url:o.url,
        location:o.location,
        theme:o.theme,
        score:o.score,
        estimatedValueUsd:o.estimatedValueUsd,
        emails:o.emails,
        nextAction:o.nextAction,
        foundAt:o.foundAt
      }));
    res.end(JSON.stringify({
      rule:"A = strongest immediately actionable opportunities; B = good; C = weak",
      actionableCount:actionable.length,
      actionable
    }));
    return;
  }
  const counts=agents.reduce((m,a)=>(m[a.status]=(m[a.status]||0)+1,m),{});
  res.end(JSON.stringify({
    system:"ATLASZ-30",
    policy,
    supervisor,
    counts,
    agents,
    opportunities:opportunities.slice(0,50)
  }));
});
server.listen(PORT,()=>console.log(JSON.stringify({event:"server_started",port:PORT,agents:AGENT_COUNT,policy:policy.version})));

for(const a of agents) workerLoop(a);
supervisorLoop();

setInterval(()=>{
  const counts=agents.reduce((m,a)=>(m[a.status]=(m[a.status]||0)+1,m),{});
  const priority=opportunities.reduce((m,o)=>(m[o.priorityClass]=(m[o.priorityClass]||0)+1,m),{A:0,B:0,C:0});
  const actionable=opportunities.filter(o=>o.priorityClass==="A").slice(0,10).map(o=>({title:o.title,company:o.company,score:o.score,estimatedValueUsd:o.estimatedValueUsd,nextAction:o.nextAction,url:o.url}));
  console.log(JSON.stringify({event:"atlasz_status",at:new Date().toISOString(),counts,opportunities:opportunities.length,priority,completed:agents.reduce((s,a)=>s+a.completed,0),topActionable:actionable}));
},60000);
