export const PAYMENT_ADAPTER_VERSION="1.0.0";
export function normalizePaymentEvent({provider,eventId,invoiceId,dealId,amount,currency,status,receivedAt,evidence}={}){
 if(!provider||!eventId||!amount||!status) throw new Error("PAYMENT_EVENT_REQUIRED_FIELDS");
 return {provider,eventId,invoiceId:invoiceId||null,dealId:dealId||null,amount:Number(amount),currency:currency||"USD",status:String(status).toUpperCase(),receivedAt:receivedAt||new Date().toISOString(),evidence:evidence||null};
}
export function confirmPaid(event,{signatureVerified=false,providerConfirmed=false}={}){
 if(!signatureVerified||!providerConfirmed) throw new Error("EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED");
 if(!["PAID","SUCCEEDED","SETTLED","COMPLETED"].includes(event.status)) throw new Error("PAYMENT_NOT_FINAL");
 return {...event,confirmedReceived:true,confirmedAt:new Date().toISOString()};
}
// Provider-specific webhook verification must be wired by Astra using the real provider SDK/secret.
