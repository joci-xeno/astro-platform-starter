// ATLASZ Approval / Command Gateway v1.0
// Structural security boundary for consequential owner commands.
// A boolean such as ownerApproved=true is never accepted as strong authentication.
// LIVE requires a real, tested verifier adapter backed by an authenticated owner channel.

const CRITICAL=new Set([
 "SPEND_MONEY","BUY_CREDITS","PURCHASE","SUBSCRIBE","ACCEPT_CONTRACT","SIGN_CONTRACT",
 "ACCEPT_BINDING_TERMS","SEND_PAYMENT","BANK_CHANGE","CREDENTIAL_CHANGE",
 "ACCOUNT_SECURITY_CHANGE","CHANGE_SECRETS","PUBLISH_EXTERNAL","DELETE_DATA",
 "DELETE_CLOUD_DATA","DEPLOY_BREAKING_CHANGE","CHANGE_OWNER_AUTHORITY","TAKE_LOAN","OPEN_CREDIT","BANK_TRANSFER","BORROW"
]);
const canonical=v=>String(v||"").trim().toUpperCase().replace(/-/g,"_");
const clone=v=>structuredClone(v);

export function createApprovalGateway({ownerId="JOCI",verifier=null,verifierTested=false,ownerAuth=null}={}){
 const audit=[];
 // With ownerAuth the verifier is the real Ed25519 owner verifier and LIVE derives from a proven owner channel
 // (a real owner-signed challenge), never from a caller-asserted flag.
 if(ownerAuth&&!verifier)verifier=async({action,approval})=>{const r=ownerAuth.verifyApproval(approval,{action});return {authenticated:r.allowed,ownerId:r.allowed?ownerAuth.status().ownerId:null,action:canonical(action),resultId:r.nonce||null,verifiedAt:new Date().toISOString()};};
 const connected=()=>typeof verifier==="function"&&(!ownerAuth||ownerAuth.status().configured);
 const isLive=()=>connected()&&(ownerAuth?ownerAuth.status().channelProven===true:verifierTested===true);
 const status=()=>({
   state:isLive()?"LIVE":connected()?"CONNECTED_UNTESTED":"PLACEHOLDER_UNCONNECTED",
   ownerId,connected:connected(),verifierTested:isLive(),
   rule:"CRITICAL_ACTIONS_REQUIRE_AUTHENTICATED_OWNER_APPROVAL"
 });
 async function verify({action,approval=null,context={}}={}){
   const a=canonical(action);
   if(!a)throw new Error("ACTION_REQUIRED");
   const critical=CRITICAL.has(a);
   if(!critical)return {allowed:true,action:a,critical:false,reason:null,evidence:null};
   if(!isLive()){
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
