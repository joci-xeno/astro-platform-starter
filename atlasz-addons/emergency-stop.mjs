// ATLASZ owner emergency stop. In-memory state; durable control-plane persistence still requires runtime storage.
let state={mode:"RUNNING",changedAt:new Date().toISOString(),changedBy:"SYSTEM",reason:"BOOT"};
const VALID=new Set(["RUNNING","PAUSE_ALL","STOP_EXTERNAL_ACTIONS"]);
export function emergencyStatus(){return {...state};}
export function setEmergencyMode({mode,ownerAuthenticated=false,reason=""}={}){if(!VALID.has(mode))throw new Error("INVALID_EMERGENCY_MODE");if(!ownerAuthenticated)throw new Error("OWNER_AUTHENTICATION_REQUIRED");state={mode,changedAt:new Date().toISOString(),changedBy:"JOCI",reason};return {...state};}
export function emergencyGate({external=false}={}){if(state.mode==="PAUSE_ALL")return {allowed:false,reason:"PAUSE_ALL"};if(state.mode==="STOP_EXTERNAL_ACTIONS"&&external)return {allowed:false,reason:"EXTERNAL_ACTIONS_STOPPED"};return {allowed:true,reason:null};}
