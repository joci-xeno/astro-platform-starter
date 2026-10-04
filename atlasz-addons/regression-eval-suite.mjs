export async function runEvalSuite(tests=[]){
 if(!Array.isArray(tests)||tests.some(t=>!t?.id||typeof t.run!=="function"||typeof t.assert!=="function"))throw new Error("VALID_EVAL_TESTS_REQUIRED");if(new Set(tests.map(t=>t.id)).size!==tests.length)throw new Error("DUPLICATE_EVAL_ID");
 const results=[];for(const t of tests){const start=Date.now();try{const out=await t.run();const passed=await t.assert(out);results.push({id:t.id,passed:Boolean(passed),durationMs:Date.now()-start});}catch(e){results.push({id:t.id,passed:false,error:String(e?.message||e),durationMs:Date.now()-start});}}
 return {status:results.every(x=>x.passed)?"PASS":"FAIL",passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,results,at:new Date().toISOString()};
}
export function requireNoRegression(current,baseline){return {passed:current.failed<=baseline.failed&&current.passed>=baseline.passed,current,baseline};}
