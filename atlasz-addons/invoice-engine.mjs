import { ownerGranted } from "./owner-auth.mjs";
export const INVOICE_VERSION="1.0.0";
export function createInvoice({invoiceId,dealId,client,items=[],currency="USD",dueAt=null,paymentMethod=null}={}){
 if(!invoiceId||!dealId||!client||!items.length) throw new Error("INVOICE_REQUIRED_FIELDS");
 const normalized=items.map(x=>({description:String(x.description||""),quantity:Number(x.quantity||1),unitPrice:Number(x.unitPrice||0)}));
 const subtotal=normalized.reduce((s,x)=>s+x.quantity*x.unitPrice,0);
 if(subtotal<=0) throw new Error("INVOICE_AMOUNT_INVALID");
 return {invoiceId,dealId,client,items:normalized,currency,subtotal,total:subtotal,dueAt,paymentMethod,status:"DRAFT",createdAt:new Date().toISOString()};
}
export function approveInvoice(inv,{ownerApproved=false}={}){if(!ownerGranted(ownerApproved,"APPROVE_INVOICE",inv?.invoiceId))throw new Error("OWNER_APPROVAL_REQUIRED");return {...inv,status:"APPROVED",approvedAt:new Date().toISOString()};}
export function markInvoiceSent(inv,{externalReference=null}={}){if(inv.status!=="APPROVED")throw new Error("INVOICE_NOT_APPROVED");if(!externalReference)throw new Error("INVOICE_SEND_EXTERNAL_EVIDENCE_REQUIRED");return {...inv,status:"SENT",externalReference,sentAt:new Date().toISOString()};}
