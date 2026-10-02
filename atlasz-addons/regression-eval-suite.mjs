export async function runEvalSuite(tests=[]){
 const results=[];for(const t of tests){const start=Date.now();try{const out=await t.run();const passed=await t.assert(out);results.push({id:t.id,passed:Boolean(passed),durationMs:Date.now()-start});}catch(e){results.push({id:t.id,passed:false,error:String(e?.message||e),durationMs:Date.now()-start});}}
 return {status:results.every(x=>x.passed)?"PASS":"FAIL",passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,results,at:new Date().toISOString()};
}
export function requireNoRegression(current,baseline){return {passed:current.failed<=baseline.failed&&current.passed>=baseline.passed,current,baseline};}
