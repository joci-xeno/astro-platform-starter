const DAY=86400000;
export const DEFAULT_FOLLOWUPS=[2,5,10];
export function nextFollowUp(conversation,now=Date.now()){
 if(conversation.replyAt||["WON","LOST","BLOCKED","PAID"].includes(conversation.status)) return null;
 const sent=Date.parse(conversation.firstContactAt||"");
 if(!Number.isFinite(sent)) return null;
 const done=Number(conversation.followUpsSent||0);
 if(done>=DEFAULT_FOLLOWUPS.length) return null;
 const due=sent+DEFAULT_FOLLOWUPS[done]*DAY;
 return {number:done+1,dueAt:new Date(due).toISOString(),due:now>=due};
}
export function stopOnReply(conversation,replyAt=new Date().toISOString()){
 return {...conversation,replyAt,nextFollowUpAt:null,status:"REPLIED"};
}
