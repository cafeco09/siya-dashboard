import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {AgentError} from './agent.mjs';
import {postgresStore} from './outreach-store.mjs';
import {createProxyMail} from './proxy-mail.mjs';
import {authorityDirectory,publicAuthorities} from './authorities.mjs';

const hash=v=>createHash('sha256').update(v).digest('hex');
const clone=v=>structuredClone(v);
const email=v=>typeof v==='string'&&v.length<=254&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(v);
const address=v=>String(v||'').trim().toLowerCase();
const locked=new Set(['sending','sent','replied','needs_attention','closed']);
export const contentHash=d=>hash(JSON.stringify([d.to,d.subject,d.body,d.country,d.year]));

export function createOutreachService({env=process.env,store,fetchImpl=fetch,now=Date.now,authorities=authorityDirectory}={}){
 const db=store||(env.DATABASE_URL?postgresStore(env.DATABASE_URL):null),mailClient=createProxyMail({env,fetchImpl});
 let storageProbe={at:0,connected:false};
 const publicSubmissions=new Map();let publicHour=0,publicCount=0;
 const owner=()=>address(env.OUTREACH_OWNER_EMAIL);
 const origin=()=>{
  const u=new URL(env.PUBLIC_ORIGIN||env.RENDER_EXTERNAL_URL||'http://localhost:3000');
  if(u.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(u.hostname))throw new AgentError(503,'The dashboard needs a secure public origin.');
  return u.origin;
 };
 const keyHash=()=>hash(env.AGENTMAIL_API_KEY?.trim()||'');
 const mailSetup=()=>({apiKey:mailClient.configured(),ownerEmail:email(owner()),storage:Boolean(db)});
 const config=()=>{const s=mailSetup();return {provider:'agentmail',storageConfigured:s.storage,mailConfigured:s.apiKey&&s.ownerEmail,ownerAccessConfigured:(env.AGENT_ACCESS_CODE||'').length>=16}};
 const mailReady=mail=>Boolean(mail&&mail.provider==='agentmail'&&!mail.paused&&mail.keyHash===keyHash()&&config().mailConfigured);
 const requireDB=()=>{if(!db)throw new AgentError(503,'Connect persistent outreach storage before saving drafts or tracking mail.')};
 async function storage(fn,write=false){requireDB();try{return await db[write?'transaction':'read'](fn)}catch(e){if(e instanceof AgentError)throw e;throw new AgentError(503,'Outreach storage is unavailable. No sending action has been retried.')}}
 const audit=(d,action,actor,detail='')=>{d.updatedAt=now();d.history.push({action,actor,at:now(),revision:d.revision,detail});d.history=d.history.slice(-100)};
 const draftKeys=['id','to','subject','body','country','year','author','revision','status','createdAt','updatedAt','approval','history','sentAt','repliedAt','lastCheckedAt','messageId','threadId','error','provider','sender','inboxId','rfcMessageId','replyId','trackingLimited','sendAttempt','publicQuestion','closedAt','authority'];
 const publicDraft=d=>Object.fromEntries(draftKeys.filter(k=>k in d).map(k=>[k,clone(d[k])]));
 const checked=(d,revision)=>{if(!d)throw new AgentError(404,'Draft not found.');if(d.revision!==Number(revision))throw new AgentError(409,'This draft changed. Refresh and review its current version.');return d};
 function fields(p,{unaddressed=false}={}){
  const to=address(p.to),subject=String(p.subject||'').trim(),body=String(p.body||'').trim(),country=p.country==null?null:String(p.country),year=p.year==null?null:Number(p.year);
  if(!email(to)&&!(unaddressed&&to===''))throw new AgentError(400,'Enter one complete recipient email address.');
  if(!subject||subject.length>180||/[\r\n\x00-\x1f]/.test(subject))throw new AgentError(400,'Use a subject of 1–180 characters on one line.');
  if(!body||body.length>15000||body.includes('\0'))throw new AgentError(400,'Use a message of 1–15,000 characters.');
  if((country!==null&&!/^[A-Z]{3}$/.test(country))||(year!==null&&(!Number.isInteger(year)||year<2018||year>2025)))throw new AgentError(400,'Choose a dashboard country and year.');
  if(/sk-(?:proj-)?[\w-]{12,}/i.test(subject+' '+body))throw new AgentError(400,'Remove API keys from the draft.');
  return {to,subject,body,country,year};
 }
 async function status(privateView=false){
  const s=config();if(!privateView){
   if(db&&(!storageProbe.at||now()-storageProbe.at>30000)){
    try{await storage(tx=>tx.get('verification:setup'));storageProbe={at:now(),connected:true}}
    catch{storageProbe={at:now(),connected:false}}
   }
   return {...s,storageConnected:Boolean(db&&storageProbe.connected)};
  }
  const mail=db?await storage(tx=>tx.get('mail:proxy')):null;
  return {...s,setup:mailSetup(),storageConnected:Boolean(db),mailConnected:mailReady(mail),mailbox:mail?.email||null,hasMailbox:Boolean(mail?.inboxId||env.AGENTMAIL_INBOX_ID),mailPaused:Boolean(mail?.paused),connectedAt:mail?.connectedAt||null,ownerEmail:owner()||null};
 }
 async function list(){return storage(async tx=>({drafts:(await tx.list('draft')).map(publicDraft),invitations:(await tx.list('invite')).map(({tokenHash,...v})=>v)}))}
 async function create(p,author={kind:'owner',name:'Owner',email:owner()},options){
  const f=fields(p,options),d={id:randomUUID(),...f,author,revision:1,status:author.kind==='owner'?'draft':'pending_approval',createdAt:now(),updatedAt:now(),approval:null,history:[],sentAt:null,repliedAt:null,lastCheckedAt:null,messageId:null,threadId:null,error:null};
  audit(d,author.kind==='owner'?'draft_created':'submitted_for_approval',author.name);return d;
 }
 async function save(p){const d=await create(p);return storage(async tx=>{await tx.put('draft:'+d.id,'draft',d);return publicDraft(d)},true)}
 const publicStages={pending_approval:'Awaiting approval',approved:'Approved',sending:'Sending',sent:'Sent',replied:'Reply received',closed:'Closed',rejected:'Rejected',failed:'Needs admin attention',needs_attention:'Needs admin attention'};
 async function questions(){return storage(async tx=>({questions:(await tx.list('draft')).filter(d=>typeof d.publicQuestion==='string'&&publicStages[d.status]).map(d=>({question:d.publicQuestion,stage:publicStages[d.status]}))}))}
 const directory=(privateView=false)=>privateView?{authorities:clone(authorities)}:publicAuthorities(authorities);
 async function submitQuestion(p,session){
  const question=typeof p.question==='string'?p.question.trim():'';
  if(!question||question.length>3000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(question))throw new AgentError(400,'Enter a question of 1–3,000 characters.');
  if(/(?:sk-(?:proj-)?|gsk_)[\w-]{12,}/i.test(question))throw new AgentError(400,'Remove credentials from the public question.');
  const authority=authorities.find(a=>a.id===p.authorityId&&a.country===p.country);
  if(!authority||!email(authority.email))throw new AgentError(400,'Select a country and a listed authority for this question.');
  if(!session)throw new AgentError(400,'Open the question form in this dashboard.');
  const time=now(),hour=Math.floor(time/3600000);if(hour!==publicHour){publicHour=hour;publicCount=0}
  for(const [id,value]of publicSubmissions)if(time-value.start>=600000)publicSubmissions.delete(id);
  const budget=publicSubmissions.get(session)||{start:time,count:0};
  if(budget.count>=3||publicCount>=60)throw new AgentError(429,'The submission limit has been reached. Please try again later.');
  budget.count++;publicCount++;publicSubmissions.set(session,budget);
  const d=await create({to:authority.email,subject:question.replace(/\s+/g,' ').slice(0,180),body:question,country:authority.country},{kind:'contributor',name:'Dashboard visitor',email:'',identity:'Public dashboard submission; identity not verified'});
  d.publicQuestion=question;d.authority={id:authority.id,name:authority.name,country:authority.country,source:authority.source,sourceCheckedAt:authority.sourceCheckedAt,contactStatus:authority.contactStatus};
  await storage(tx=>tx.put('draft:'+d.id,'draft',d),true);
  return {submitted:true,stage:'Awaiting approval'};
 }
 async function edit(id,p){
  const f=fields(p);return storage(async tx=>{const d=checked(await tx.get('draft:'+id),p.revision);if(locked.has(d.status))throw new AgentError(409,'This message cannot be edited after sending starts.');Object.assign(d,f,{revision:d.revision+1,approval:null,status:d.author.kind==='owner'?'draft':'pending_approval',error:null});audit(d,'draft_edited',owner(),'Previous approval cleared.');await tx.put('draft:'+id,'draft',d);return publicDraft(d)},true);
 }
 async function approve(id,p){return storage(async tx=>{
  const d=checked(await tx.get('draft:'+id),p.revision);if(locked.has(d.status)||d.status==='rejected')throw new AgentError(409,'This draft cannot be approved in its current state.');
  if(p.recipientConfirmed!==true)throw new AgentError(400,'Verify the recipient and exact draft before approving.');
  fields(d);
  d.approval={by:owner(),at:now(),revision:d.revision,hash:contentHash(d)};d.status='approved';audit(d,'approved',owner());await tx.put('draft:'+id,'draft',d);return publicDraft(d);
 },true)}
 async function reject(id,p){return storage(async tx=>{
  const d=checked(await tx.get('draft:'+id),p.revision);if(locked.has(d.status))throw new AgentError(409,'Sending has already started.');
  d.status='rejected';d.approval=null;audit(d,'rejected',owner(),String(p.reason||'').slice(0,500));await tx.put('draft:'+id,'draft',d);return publicDraft(d);
 },true)}
 async function invitation(p){
  if(!p.name||String(p.name).length>100||!email(address(p.email)))throw new AgentError(400,'Enter the contributor’s name and email address.');
  const token=randomBytes(32).toString('base64url'),id=randomUUID();const invite={id,name:String(p.name).trim(),email:address(p.email),tokenHash:hash(token),createdAt:now(),expiresAt:now()+7*86400000,usedAt:null,revokedAt:null};
  await storage(tx=>tx.put('invite:'+invite.tokenHash,'invite',invite),true);
  return {id,name:invite.name,email:invite.email,expiresAt:invite.expiresAt,url:origin()+'/submit-draft.html#'+token};
 }
 const validInvite=async(tx,token)=>{if(!/^[\w-]{43}$/.test(token||''))throw new AgentError(403,'This invitation is not valid.');const i=await tx.get('invite:'+hash(token));if(!i||i.revokedAt||i.usedAt||i.expiresAt<now())throw new AgentError(403,'This invitation has expired, been used or been revoked.');return i};
 async function invitationInfo(token){return storage(async tx=>{const i=await validInvite(tx,token);return {name:i.name,expiresAt:i.expiresAt}})}
 async function submit(token,p){const f=fields(p);return storage(async tx=>{
  const i=await validInvite(tx,token);const d=await create(f,{kind:'contributor',name:i.name,email:i.email,identity:'Invitation holder; email not independently verified'});await tx.put('draft:'+d.id,'draft',d);i.usedAt=now();await tx.put('invite:'+i.tokenHash,'invite',i);return {id:d.id,status:d.status};
 },true)}
 async function revoke(id){return storage(async tx=>{const i=(await tx.list('invite')).find(v=>v.id===id);if(!i)throw new AgentError(404,'Invitation not found.');i.revokedAt=now();await tx.put('invite:'+i.tokenHash,'invite',i);return {revoked:true}},true)}
 async function closeQuestion(id,p){return storage(async tx=>{const d=checked(await tx.get('draft:'+id),p.revision);if(!['sent','replied'].includes(d.status))throw new AgentError(409,'Only a sent question or a received reply can be closed.');d.status='closed';d.closedAt=now();audit(d,'closed',owner());await tx.put('draft:'+id,'draft',d);return publicDraft(d)},true)}
 async function connect(){
  requireDB();if(!config().mailConfigured)throw new AgentError(503,'Configure the proxy mailbox API key and admin identity before connecting.');
  return storage(async tx=>{
   const existing=await tx.get('mail:proxy'),inboxId=env.AGENTMAIL_INBOX_ID?.trim()||existing?.inboxId;
   const verified=inboxId?await mailClient.getInbox(inboxId):await mailClient.createInbox('her-education-'+hash(origin()).slice(0,32));
   const mail={...verified,provider:'agentmail',keyHash:keyHash(),connectedAt:now(),paused:false};await tx.put('mail:proxy','mail',mail);
   return {connected:true,mailbox:mail.email};
  },true);
 }
 async function connectedMail(){const mail=await storage(tx=>tx.get('mail:proxy'));if(!mailReady(mail))throw new AgentError(503,'Connect the dedicated dashboard mailbox in admin settings before sending or checking replies.');return mail}
 async function send(id,p){
  if(p.recipientConfirmed!==true)throw new AgentError(400,'Confirm the recipient and message before sending.');
  let claim=await storage(async tx=>{
   const d=checked(await tx.get('draft:'+id),p.revision);
   if(locked.has(d.status))return {claimed:false,d};
   if(d.status==='rejected')throw new AgentError(409,'A rejected draft cannot be sent.');
   if(d.author.kind!=='owner'&&(!d.approval||d.approval.by!==owner()||d.approval.hash!==contentHash(d)||d.approval.revision!==d.revision||!['approved','failed'].includes(d.status)))throw new AgentError(403,'You must approve this contributor’s current draft before it can be sent.');
   const mail=await tx.get('mail:proxy');if(!mailReady(mail))throw new AgentError(503,'Connect the dedicated dashboard mailbox before sending.');
   if(d.author.kind==='owner')d.approval={by:owner(),at:now(),revision:d.revision,hash:contentHash(d)};
   d.status='sending';d.provider='agentmail';d.sender=mail.email;d.inboxId=mail.inboxId;d.error=null;d.sendAttempt={id:randomUUID(),at:now()};audit(d,'send_requested',owner());await tx.put('draft:'+id,'draft',d);return {claimed:true,d};
  },true);
  if(!claim.claimed)return publicDraft(claim.d);
  let result,error,submitted=false;
  try{const mail=await connectedMail();if(mail.inboxId!==claim.d.inboxId)throw new AgentError(409,'The sending mailbox changed. Refresh the draft before trying again.');await mailClient.getInbox(mail.inboxId);submitted=true;result=await mailClient.send(mail.inboxId,claim.d,claim.d.sendAttempt.id)}
  catch(e){error=e}
  return storage(async tx=>{
   const d=await tx.get('draft:'+id);if(d.sendAttempt?.id!==claim.d.sendAttempt.id)throw new AgentError(409,'The sending record changed. Refresh its status.');
   if(error){d.status=submitted&&(!(error instanceof AgentError)||error.uncertain)?'needs_attention':'failed';d.error=error instanceof AgentError?error.message:'Proxy mail access failed. Check admin mail settings.';audit(d,d.status,owner(),d.status==='needs_attention'?'Sending outcome uncertain. Automatic resend blocked.':'The mail provider did not confirm sending.');}
   else{d.status='sent';d.sentAt=now();d.messageId=result.messageId;d.rfcMessageId=result.messageId;d.threadId=result.threadId;audit(d,'sent',owner(),'The proxy mail provider accepted the message.');}
   await tx.put('draft:'+id,'draft',d);return publicDraft(d);
  },true);
 }
 async function refresh(id){
  const d=await storage(tx=>tx.get('draft:'+id));if(!d)throw new AgentError(404,'Draft not found.');
  if(d.status==='sending'&&now()-(d.sendAttempt?.at||d.updatedAt)>120000)return storage(async tx=>{const current=await tx.get('draft:'+id);if(current.status==='sending'){current.status='needs_attention';current.error='Sending was interrupted. Check the provider mailbox using the recipient, subject and attempt time; automatic resend is blocked.';audit(current,'needs_attention',owner());await tx.put('draft:'+id,'draft',current)}return publicDraft(current)},true);
  if(!d.threadId||!['sent','replied'].includes(d.status))return publicDraft(d);
  if(d.provider!=='agentmail'||!d.inboxId)throw new AgentError(409,'This legacy mail record remains in history. Its old provider connection is not used by the proxy mailbox.');
  await connectedMail();
  const metadata=await mailClient.replyMetadata(d.inboxId,d),reply=metadata.messages.find(m=>m.id!==d.messageId&&m.from===d.to&&!m.sent&&!m.automatic&&!m.authenticationFailed&&m.at>=(d.sentAt||0)-300000&&(m.inReplyTo===d.messageId||m.references.includes(d.messageId)));
  return storage(async tx=>{const current=await tx.get('draft:'+id);current.lastCheckedAt=now();current.trackingLimited=metadata.limited;if(reply&&current.status==='sent'){current.status='replied';current.repliedAt=reply.at||now();current.replyId=reply.id;audit(current,'reply_detected',owner(),'Reply received; content is not stored in the dashboard.')}await tx.put('draft:'+id,'draft',current);return publicDraft(current)},true);
 }
 async function disconnect(){return storage(async tx=>{const mail=await tx.get('mail:proxy');if(mail){mail.paused=true;await tx.put('mail:proxy','mail',mail)}return {disconnected:true,paused:true}},true)}
 return {status,list,directory,questions,submitQuestion,closeQuestion,save,edit,approve,reject,invitation,invitationInfo,submit,revoke,connect,send,refresh,disconnect,close:()=>db?.close()};
}
