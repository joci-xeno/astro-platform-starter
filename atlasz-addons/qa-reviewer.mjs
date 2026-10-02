export function reviewResult({checks=[],evidence=[]}={}){
 const failed=checks.filter(x=>x.required!==false&&!x.passed);
 const missingEvidence=checks.filter(x=>x.required!==false&&x.passed&&!evidence.some(e=>e.checkId===x.id));
 return {status:failed.length||missingEvidence.length?"FAIL":"PASS",failed,missingEvidence,
   nextAction:failed.length||missingEvidence.length?"RETURN_TO_EXECUTOR":"REQUEST_DELIVERY_APPROVAL"};
}
