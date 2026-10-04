export function reviewResult({checks=[],evidence=[]}={}){
 if(!Array.isArray(checks)||!Array.isArray(evidence))throw new Error("QA_ARRAYS_REQUIRED");const ids=checks.map(x=>x?.id);if(ids.some(x=>!x)||new Set(ids).size!==ids.length)throw new Error("QA_CHECK_IDS_REQUIRED_UNIQUE");
 const failed=checks.filter(x=>x.required!==false&&!x.passed);
 const missingEvidence=checks.filter(x=>x.required!==false&&x.passed&&!evidence.some(e=>e.checkId===x.id));
 return {status:failed.length||missingEvidence.length?"FAIL":"PASS",failed,missingEvidence,
   nextAction:failed.length||missingEvidence.length?"RETURN_TO_EXECUTOR":"REQUEST_DELIVERY_APPROVAL"};
}
