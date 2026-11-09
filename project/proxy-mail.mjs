import {AgentError} from './agent.mjs';

const API='https://api.agentmail.to/v0';
const reference=v=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\x00-\x1f\x7f]/.test(v);
const address=v=>String(v||'').trim().toLowerCase();
const isEmail=v=>typeof v==='string'&&v.length<=254&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(v);
const senderAddress=v=>{if(typeof v!=='string')return '';const value=address(v.match(/^[^<>]*<([^<>\s]+)>\s*$/)?.[1]||v);return isEmail(value)?value:''};

export function createProxyMail({env=process.env,fetchImpl=fetch}={}){
 const key=()=>env.AGENTMAIL_API_KEY?.trim()||'';
 async function request(path,body,method=body===undefined?'GET':'POST'){
  if(!key())throw new AgentError(503,'Add the proxy mailbox API key in Render before connecting.');
  let response;
  try{response=await fetchImpl(API+path,{method,headers:{Authorization:'Bearer '+key(),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000),redirect:'error'})}
  catch{const e=new AgentError(502,'The mail provider connection was interrupted. Check the mailbox before another sending action.');e.uncertain=method==='POST';throw e}
  if(!response.ok){const e=new AgentError(502,response.status===401||response.status===403?'The mail provider did not accept this key or operation. Check the account, API permissions and sending limits.':response.status===429?'The mail provider rate limit was reached. Wait before trying manually.':response.status===404?'The configured proxy mailbox was not found. Reconnect it in admin settings.':'The mail provider could not complete this request.');e.uncertain=method==='POST'&&(response.status>=500||[408,409].includes(response.status));throw e}
  try{return await response.json()}catch{const e=new AgentError(502,'The mail provider returned an unreadable result. Check the mailbox before another sending action.');e.uncertain=method==='POST';throw e}
 }
 const inboxPath=id=>{if(!reference(id))throw new AgentError(503,'The proxy mailbox reference is invalid. Reconnect it in admin settings.');return '/inboxes/'+encodeURIComponent(id)};
 function inbox(value,expected){
  const id=value?.inbox_id,mailbox=address(value?.email||(isEmail(id)?id:''));
  if(!reference(id)||!isEmail(mailbox)||(expected&&id!==expected)||value.status==='paused')throw new AgentError(503,'The proxy mailbox could not be verified or is paused at the provider.');
  return {inboxId:id,email:mailbox};
 }
 async function getInbox(id){return inbox(await request(inboxPath(id)),id)}
 async function createInbox(clientId){return inbox(await request('/inboxes',{display_name:'Her Education Outreach',client_id:clientId}))}
 async function send(inboxId,draft,attemptId){
  const result=await request(inboxPath(inboxId)+'/messages/send',{to:[draft.to],subject:draft.subject,text:draft.body,headers:{'X-Dashboard-Outreach-ID':attemptId},track_opens:false});
  if(!reference(result?.message_id)||!reference(result?.thread_id)){const e=new AgentError(502,'The provider returned no sending reference. Check the mailbox; automatic resend is blocked.');e.uncertain=true;throw e}
  return {messageId:result.message_id,threadId:result.thread_id};
 }
 async function replyMetadata(inboxId,draft){
  const result=[];let pageToken='';
  for(let page=0;page<5;page++){
   const q=new URLSearchParams({limit:'100',from:draft.to,after:new Date((draft.sentAt||0)-300000).toISOString(),include_spam:'false',include_blocked:'false',include_unauthenticated:'false',include_trash:'false'});
   if(pageToken)q.set('page_token',pageToken);
   const data=await request(inboxPath(inboxId)+'/messages?'+q);
   if(!data||!Array.isArray(data.messages))throw new AgentError(502,'The mail provider returned no tracking list. Refresh manually later.');
   // Whitelist only tracking metadata. Discard subjects, previews, bodies and attachments.
   for(const m of data.messages){
    if(!m||!reference(m.message_id)||m.thread_id!==draft.threadId||!Number.isFinite(Date.parse(m.timestamp)))continue;
    const h=Object.fromEntries(Object.entries(m.headers||{}).filter(([k,v])=>['auto-submitted','in-reply-to','references'].includes(k.toLowerCase())&&typeof v==='string').map(([k,v])=>[k.toLowerCase(),v]));
    result.push({id:m.message_id,threadId:m.thread_id,from:senderAddress(m.from),at:Date.parse(m.timestamp),inReplyTo:typeof m.in_reply_to==='string'?m.in_reply_to:h['in-reply-to']||'',references:Array.isArray(m.references)?m.references.filter(v=>typeof v==='string'):String(h.references||'').match(/<[^>]+>/g)||[],automatic:Boolean(h['auto-submitted']&&h['auto-submitted'].trim().toLowerCase()!=='no'),sent:Array.isArray(m.labels)&&m.labels.includes('sent'),authenticationFailed:m.authentication_results?.dmarc==='fail'||m.authentication_results?.spf==='fail'&&m.authentication_results?.dkim==='fail'});
   }
   if(!data.next_page_token)return {messages:result,limited:false};
   pageToken=data.next_page_token;
  }
  return {messages:result,limited:true};
 }
 return {configured:()=>Boolean(key()),getInbox,createInbox,send,replyMetadata};
}
