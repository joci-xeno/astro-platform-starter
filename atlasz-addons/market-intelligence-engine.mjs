// Evidence-first market intelligence. Forecasts are hypotheses until verified; it cannot fabricate market facts.
export function analyzeMarketSignals({signals=[]}={}){
 const valid=signals.filter(s=>s&&s.source&&s.observedAt&&Number.isFinite(Number(s.strength)));
 const grouped=new Map();for(const s of valid){const k=s.topic||"GENERAL";const a=grouped.get(k)||[];a.push(s);grouped.set(k,a);}
 const trends=[...grouped.entries()].map(([topic,a])=>({topic,signalCount:a.length,score:a.reduce((n,s)=>n+Number(s.strength),0)/a.length,sources:[...new Set(a.map(s=>s.source))]})).sort((a,b)=>b.score-a.score);
 return {status:valid.length?"EVIDENCE_AVAILABLE":"NO_EVIDENCE",trends,invalidSignals:signals.length-valid.length};
}
export function proposeSearchStrategy({analysis,currentStrategy={}}={}){if(!analysis?.trends?.length)return {change:false,reason:"NO_VERIFIED_SIGNALS"};const top=analysis.trends[0];return {change:true,hypothesis:`Prioritize ${top.topic} for validation`,evidenceSources:top.sources,proposedStrategy:{...currentStrategy,priorityTopic:top.topic},requiresOutcomeMeasurement:true};}
