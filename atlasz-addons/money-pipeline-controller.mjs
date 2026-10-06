// ATLASZ Money Pipeline Controller
// Composes existing revenue modules into one auditable state machine.
// No external send, spend, contract acceptance, banking action, or payment claim happens here.

const STATES = Object.freeze([
  "DISCOVERED","QUALIFIED","PROPOSAL_DRAFT","APPROVED_TO_SEND","SENT",
  "WON","ASSIGNED","EXECUTING","QA_PASSED","DELIVERY_APPROVED","DELIVERED",
  "INVOICE_APPROVED","INVOICED","PAID_VERIFIED","LOST","BLOCKED"
]);

const ALLOWED = Object.freeze({
  DISCOVERED:["QUALIFIED","BLOCKED","LOST"],
  QUALIFIED:["PROPOSAL_DRAFT","BLOCKED","LOST"],
  PROPOSAL_DRAFT:["APPROVED_TO_SEND","BLOCKED","LOST"],
  APPROVED_TO_SEND:["SENT","BLOCKED","LOST"],
  SENT:["WON","BLOCKED","LOST"],
  WON:["ASSIGNED","BLOCKED"],
  ASSIGNED:["EXECUTING","BLOCKED"],
  EXECUTING:["QA_PASSED","BLOCKED"],
  QA_PASSED:["DELIVERY_APPROVED","BLOCKED"],
  DELIVERY_APPROVED:["DELIVERED","BLOCKED"],
  DELIVERED:["INVOICE_APPROVED","BLOCKED"],
  INVOICE_APPROVED:["INVOICED","BLOCKED"],
  INVOICED:["PAID_VERIFIED","BLOCKED"],
  PAID_VERIFIED:[],
  LOST:[],
  BLOCKED:["DISCOVERED","QUALIFIED","PROPOSAL_DRAFT","APPROVED_TO_SEND","SENT","WON","ASSIGNED","EXECUTING","QA_PASSED","DELIVERY_APPROVED","DELIVERED","INVOICE_APPROVED","INVOICED","LOST"]
});

const ownerGateStates=new Set(["APPROVED_TO_SEND","DELIVERY_APPROVED","INVOICE_APPROVED"]);
const evidenceStates=new Set(["SENT","WON","QA_PASSED","DELIVERED","INVOICED","PAID_VERIFIED"]);
const clone=x=>structuredClone(x);

export function createMoneyPipeline({id,sourceEvidence,estimatedValueUsd=0,currency="USD",title=null}={}){
  if(!id) throw new Error("MONEY_PIPELINE_ID_REQUIRED");
  if(!sourceEvidence) throw new Error("SOURCE_EVIDENCE_REQUIRED");
  const value=Number(estimatedValueUsd);
  if(!Number.isFinite(value)||value<0) throw new Error("INVALID_ESTIMATED_VALUE");
  const at=new Date().toISOString();
  return {id,title,sourceEvidence,estimatedValueUsd:value,currency,state:"DISCOVERED",createdAt:at,updatedAt:at,history:[{at,state:"DISCOVERED",evidence:sourceEvidence}],money:{invoiced:0,received:0,cost:0,netVerified:0}};
}

export function transitionMoneyPipeline(pipeline,next,{evidence=null,ownerApproved=false,note=null}={}){
  if(!pipeline||!STATES.includes(pipeline.state)) throw new Error("INVALID_MONEY_PIPELINE");
  if(!STATES.includes(next)) throw new Error("INVALID_MONEY_PIPELINE_STATE");
  if(!(ALLOWED[pipeline.state]||[]).includes(next)) throw new Error("INVALID_MONEY_PIPELINE_TRANSITION:"+pipeline.state+"->"+next);
  if(ownerGateStates.has(next)&&!ownerApproved) throw new Error("OWNER_APPROVAL_REQUIRED");
  if(evidenceStates.has(next)&&!evidence) throw new Error("EXTERNAL_OR_QA_EVIDENCE_REQUIRED:"+next);
  const at=new Date().toISOString();
  return {...clone(pipeline),state:next,updatedAt:at,history:[...(pipeline.history||[]),{at,state:next,evidence:evidence||null,note:note||null}]};
}

export function recordInvoice(pipeline,{amount,evidence}={}){
  if(pipeline?.state!=="INVOICED") throw new Error("PIPELINE_NOT_INVOICED");
  const n=Number(amount); if(!Number.isFinite(n)||n<=0) throw new Error("INVALID_INVOICE_AMOUNT");
  if(!evidence) throw new Error("INVOICE_EVIDENCE_REQUIRED");
  return {...clone(pipeline),money:{...pipeline.money,invoiced:n},updatedAt:new Date().toISOString()};
}

export function recordVerifiedPayment(pipeline,{amount,cost=0,evidence,providerConfirmed=false,signatureVerified=false}={}){
  if(pipeline?.state!=="INVOICED") throw new Error("PIPELINE_NOT_READY_FOR_PAYMENT");
  const received=Number(amount), actualCost=Number(cost);
  if(!Number.isFinite(received)||received<=0) throw new Error("INVALID_RECEIVED_AMOUNT");
  if(!Number.isFinite(actualCost)||actualCost<0) throw new Error("INVALID_COST_AMOUNT");
  if(!evidence||!providerConfirmed||!signatureVerified) throw new Error("AUTHORITATIVE_PAYMENT_EVIDENCE_REQUIRED");
  const paid=transitionMoneyPipeline(pipeline,"PAID_VERIFIED",{evidence});
  return {...paid,money:{...paid.money,received,cost:actualCost,netVerified:received-actualCost}};
}

export function moneyPipelineSummary(pipeline){
  if(!pipeline) return null;
  return {id:pipeline.id,state:pipeline.state,estimatedValueUsd:pipeline.estimatedValueUsd,currency:pipeline.currency,money:clone(pipeline.money),historyCount:pipeline.history?.length||0,verifiedRevenue:pipeline.state==="PAID_VERIFIED"?pipeline.money.received:0};
}

export const MONEY_PIPELINE_STATES=STATES;
