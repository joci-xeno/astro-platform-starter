import http from "node:http";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const PORT=Number(process.env.PORT||8080);
const AGENT_COUNT=30;
const states=new Map();
const events=[];
const workers=new Map();
const script=new URL("./agent-child.js", import.meta.url);

function spawn(id){
  const w=new Worker(script,{workerData:{id}});
  workers.set(id,w);
  w.on("message",msg=>{
    if(msg.state) states.set(id,msg.state);
    events.unshift({at:new Date().toISOString(),agent:id,type:msg.type,theme:msg.theme,decision:msg.decision});
    if(events.length>1000) events.length=1000;
  });
  w.on("error",err=>{
    states.set(id,{...(states.get(id)||{id}),status:"CRASHED",lastError:String(err),heartbeat:new Date().toISOString()});
  });
  w.on("exit",code=>{
    states.set(id,{...(states.get(id)||{id}),status:"RESTARTING",lastError:"worker exited "+code,heartbeat:new Date().toISOString()});
    setTimeout(()=>spawn(id),3000);
  });
}

for(let i=1;i<=AGENT_COUNT;i++) spawn(i);

setInterval(()=>{
  const now=Date.now();
  for(let i=1;i<=AGENT_COUNT;i++){
    const s=states.get(i);
    if(s?.heartbeat && now-Date.parse(s.heartbeat)>600000 && !["BLOCKED_NO_KEY","CRASHED","RESTARTING"].includes(s.status)){
      s.status="STALE";
    }
  }
},30000);

const server=http.createServer((req,res)=>{
  res.setHeader("content-type","application/json; charset=utf-8");
  const agents=Array.from({length:AGENT_COUNT},(_,i)=>states.get(i+1)||{id:i+1,status:"BOOTING"});
  const counts=agents.reduce((m,a)=>(m[a.status]=(m[a.status]||0)+1,m),{});
  if(req.url==="/health"){
    res.end(JSON.stringify({ok:true,agents:AGENT_COUNT,processes:workers.size,counts,aiKeyConfigured:Boolean(process.env.OPENAI_API_KEY),model:process.env.OPENAI_MODEL||"gpt-5-mini"}));
    return;
  }
  if(req.url==="/events"){
    res.end(JSON.stringify({events:events.slice(0,200)}));
    return;
  }
  res.end(JSON.stringify({
    system:"ATLASZ-30-INDEPENDENT",
    architecture:"30 independent Node worker_threads; each owns separate state, memory and model-call loop",
    aiKeyConfigured:Boolean(process.env.OPENAI_API_KEY),
    model:process.env.OPENAI_MODEL||"gpt-5-mini",
    processes:workers.size,
    counts,
    agents,
    recentEvents:events.slice(0,100)
  }));
});
server.listen(PORT,()=>console.log(JSON.stringify({event:"atlasz_independent_boot",agents:AGENT_COUNT,port:PORT,aiKeyConfigured:Boolean(process.env.OPENAI_API_KEY)})));


setInterval(()=>{
  const agents=Array.from({length:AGENT_COUNT},(_,i)=>states.get(i+1)||{id:i+1,status:"BOOTING",aiCalls:0});
  const withCalls=agents.filter(a=>(a.aiCalls||0)>0);
  const totalCalls=agents.reduce((s,a)=>s+(a.aiCalls||0),0);
  console.log(JSON.stringify({
    event:"atlasz_ai_summary",
    at:new Date().toISOString(),
    processes:workers.size,
    agentsWithSuccessfulModelCalls:withCalls.length,
    totalAiCalls:totalCalls,
    statuses:agents.reduce((m,a)=>(m[a.status]=(m[a.status]||0)+1,m),{}),
    perAgent:agents.map(a=>({id:a.id,status:a.status,aiCalls:a.aiCalls||0,completed:a.completed||0,currentTask:a.currentTask||null,lastError:a.lastError||null}))
  }));
},30000);
