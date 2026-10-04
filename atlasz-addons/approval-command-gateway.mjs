// ATLASZ Approval / Command Gateway v1.0
// Structural security boundary for consequential owner commands.
// A boolean such as ownerApproved=true is never accepted as strong authentication.
// LIVE requires a real, tested verifier adapter backed by an authenticated owner channel.

const CRITICAL=new Set([
 "SPEND_MONEY","BUY_CREDITS","PURCHASE","SUBSCRIBE","ACCEPT_CONTRACT","SIGN_CONTRACT",
 "ACCEPT_BINDING_TERMS","SEND_PAYMENT","BANK_CHANGE","CREDENTIAL_CHANGE",
 "ACCOUNT_SECURITY_CHANGE","CHANGE_SECRETS","PUBLISH_EXTERNAL","DELETE_DATA",
 "DELETE_CLOUD_DATA","DEPLOY_BREAKING_CHANGE","CHANGE_OWNER_AUTHORITY"
]);
const canonical=v=>String(v||"").trim().toUpperCase().replace(/-/g,"_");
const clone=v=>structuredClone(v);

export function createApprovalGateway({ownerId="JOCI",verifier=null,verifierTested=false}={}){
 const audit=[];
 const connected=typeof verifier==="function";
 const live=connected&&verifierTested===true;
 const status=()=>({
   state:live?"LIVE":connected?"CONNECTED_UNTESTED":"PLACEHOLDER_UNCONNECTED",
   ownerId,connected,verifierTested:live,
   rule:"CRITICAL_ACTIONS_REQUIRE_AUTHENTICATED_OWNER_APPROVAL"
 });
 async function verify({action,approval=null,context={}}={}){
   const a=canonical(action);
   if(!a)throw new Error("ACTION_REQUIRED");
   const critical=CRITICAL.has(a);
   if(!critical)return {allowed:true,action:a,critical:false,reason:null,evidence:null};
   if(!live){
     const out={allowed:false,action:a,critical:true,reason:"AUTHENTICATED_APPROVAL_PROVIDER_NOT_LIVE",evidence:null};
     audit.push({at:new Date().toISOString(),...out});return out;
   }
   if(!approval||typeof approval!=="object"){
     const out={allowed:false,action:a,critical:true,reason:"AUTHENTICATED_OWNER_APPROVAL_REQUIRED",evidence:null};
     audit.push({at:new Date().toISOString(),...out});return out;
   }
   const result=await verifier({ownerId,action:a,approval:clone(approval),context:clone(context)});
   const authenticated=result?.authenticated===true&&result?.ownerId===ownerId&&result?.action===a;
   const out={allowed:authenticated,action:a,critical:true,reason:authenticated?null:"OWNER_APPROVAL_VERIFICATION_FAILED",
     evidence:authenticated?{ownerId,resultId:result?.resultId||null,verifiedAt:result?.verifiedAt||new Date().toISOString()}:null};
   audit.push({at:new Date().toISOString(),...out});return out;
 }
 return {status,verify,audit:()=>clone(audit),criticalActions:()=>[...CRITICAL]};
}
