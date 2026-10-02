const handlers=new Map();
export const ATLASZ_EVENTS=["LEAD_FOUND","LEAD_QUALIFIED","CONTACTED","CLIENT_REPLIED","DEAL_WON","JOB_STARTED","QA_FAILED","QA_PASSED","DELIVERY_APPROVED","INVOICED","PAYMENT_CONFIRMED","BLOCKED"];
export function subscribe(type,fn){if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn);return()=>handlers.get(type)?.delete(fn);}
export async function publish(type,payload={}){if(!ATLASZ_EVENTS.includes(type))throw new Error("UNKNOWN_EVENT");const event={type,payload,at:new Date().toISOString()};for(const fn of handlers.get(type)||[])await fn(event);return event;}
