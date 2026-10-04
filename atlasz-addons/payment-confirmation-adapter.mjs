export const PAYMENT_ADAPTER_VERSION="1.0.0";
export function normalizePaymentEvent({provider,eventId,invoiceId,dealId,amount,currency,status,receivedAt,evidence}={}){
 if(!provider||!eventId||amount===undefined||amount===null||!status) throw new Error("PAYMENT_EVENT_REQUIRED_FIELDS");const value=Number(amount);if(!Number.isFinite(value)||value<=0)throw new Error("INVALID_PAYMENT_AMOUNT");const at=receivedAt||new Date().toISOString();if(!Number.isFinite(Date.parse(at)))throw new Error("INVALID_PAYMENT_RECEIVED_AT");
 return {provider,eventId,invoiceId:invoiceId||null,dealId:dealId||null,amount:value,currency:currency||"USD",status:String(status).toUpperCase(),receivedAt:at,evidence:evidence||null};
}
export function confirmPaid(event,{signatureVerified=false,providerConfirmed=false}={}){
 if(!signatureVerified||!providerConfirmed) throw new Error("EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED");if(!event?.evidence)throw new Error("PAYMENT_EVIDENCE_REQUIRED");
 if(!["PAID","SUCCEEDED","SETTLED","COMPLETED"].includes(event.status)) throw new Error("PAYMENT_NOT_FINAL");
 return {...event,confirmedReceived:true,confirmedAt:new Date().toISOString()};
}
// Provider-specific webhook verification must be wired by Astra using the real provider SDK/secret.
