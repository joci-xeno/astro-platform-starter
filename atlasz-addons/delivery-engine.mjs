import { ownerGranted } from "./owner-auth.mjs";
export const DELIVERY_VERSION="1.0.0";
export function createDelivery({deliveryId,jobId,dealId,artifacts=[],acceptanceEvidence=[],message=""}={}){
 if(!deliveryId||!jobId||!dealId||!artifacts.length) throw new Error("DELIVERY_REQUIRED_FIELDS");
 return {deliveryId,jobId,dealId,artifacts,acceptanceEvidence,message,status:"DRAFT",createdAt:new Date().toISOString()};
}
export function requestDeliveryApproval(d,{qaPassed=false}={}){if(!qaPassed)throw new Error("QA_PASS_REQUIRED");return {...d,status:"AWAITING_OWNER_APPROVAL"};}
export function approveDelivery(d,{ownerApproved=false}={}){if(!ownerGranted(ownerApproved,"APPROVE_DELIVERY",d?.deliveryId))throw new Error("OWNER_APPROVAL_REQUIRED");return {...d,status:"APPROVED_TO_DELIVER",approvedAt:new Date().toISOString()};}
export function markDelivered(d,{externalEvidence=null}={}){if(d.status!=="APPROVED_TO_DELIVER")throw new Error("DELIVERY_NOT_APPROVED");if(!externalEvidence)throw new Error("DELIVERY_EXTERNAL_EVIDENCE_REQUIRED");return {...d,status:"DELIVERED",externalEvidence,deliveredAt:new Date().toISOString()};}
