import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createOutreachService} from './outreach.mjs';
import {createProxyMail} from './proxy-mail.mjs';

const env={DATABASE_URL:'unused-by-test-store',AGENTMAIL_API_KEY:'synthetic-mail-key',OUTREACH_OWNER_EMAIL:'owner@example.org',AGENT_ACCESS_CODE:'synthetic-owner-access',PUBLIC_ORIGIN:'https://dashboard.example.org'};
const inbox={inbox_id:'dashboard@agentmail.to',email:'dashboard@agentmail.to'};
const testAuthorities=[{id:'ind-education',country:'IND',countryName:'India',name:'Education authority',category:'Education',email:'private-authority@example.org',source:'https://education.example.org/contact',sourceCheckedAt:'2026-10-20'},{id:'jpn-education',country:'JPN',countryName:'Japan',name:'Japanese education authority',category:'Education',email:'private-japan@example.org',source:'https://education.example.org/japan',sourceCheckedAt:'2026-10-20'}];
const recipient={country:'IND',authorityId:'ind-education'};
const draft={to:'researcher@example.org',subject:'Learning evidence request',body:'Please share the source year and population for this measure.',country:'IND',year:2023};
function memoryStore(){
 let records=new Map(),queue=Promise.resolve();
 const view=map=>({get:async id=>structuredClone(map.get(id)||null),put:async(id,kind,data)=>map.set(id,{...structuredClone(data),__kind:kind}),remove:async id=>map.delete(id),list:async kind=>[...map.values()].filter(v=>v.__kind===kind).map(v=>{const c=structuredClone(v);delete c.__kind;return c})});
 return {read:fn=>fn(view(records)),transaction(fn){const result=queue.then(async()=>{const snapshot=structuredClone(records),value=await fn(view(snapshot));records=snapshot;return value});queue=result.catch(()=>{});return result},close:async()=>{}};
}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
function setup({route,clock=()=>Date.now(),store=memoryStore(),settings={...env}}={}){
 const calls=[];const service=createOutreachService({env:settings,store,now:clock,authorities:testAuthorities,fetchImpl:async(url,init)=>{
  calls.push({url,init});if(route){const r=await route(url,init);if(r)return r}
  if(url.endsWith('/messages/send'))return json({message_id:'<outgoing@agentmail.to>',thread_id:'thread_1'});
  if(new URL(url).pathname.endsWith('/messages'))return json({messages:[]});
  if(url.endsWith('/inboxes')||url.endsWith('/inboxes/'+encodeURIComponent(inbox.inbox_id)))return json(inbox);
  throw Error('Unexpected provider endpoint');
 }});return {service,calls,store};
}
async function connect(service){return service.connect()}
async function contributed(service){const i=await service.invitation({name:'Contributor',email:'contributor@example.org'});return service.submit(new URL(i.url).hash.slice(1),{...draft,author:{kind:'owner'}})}
async function get(service,id){return (await service.list()).drafts.find(d=>d.id===id)}

test('public authority directory contains names and IDs only; submissions resolve recipients privately',async()=>{
 const {service}=setup();const published=service.directory();
 assert.deepEqual(Object.keys(published).sort(),['authorities','countries']);assert.doesNotMatch(JSON.stringify(published),/@|source|email/);
 assert.equal(service.directory(true).authorities[0].email,'private-authority@example.org');
 for(const p of [{},{country:'JPN',authorityId:'ind-education'},{country:'IND',authorityId:'unknown'}])await assert.rejects(service.submitQuestion({question:'Question',...p},'visitor'),/Select a country/);
 await service.submitQuestion({question:'Question',...recipient,to:'attacker@example.org'},'visitor');
 const d=(await service.list()).drafts[0];assert.equal(d.to,'private-authority@example.org');assert.equal(d.country,'IND');assert.equal(d.authority.id,'ind-education');assert.equal(d.status,'pending_approval');
 assert.deepEqual(await service.questions(),{questions:[{question:'Question',stage:'Awaiting approval'}]});
});

test('seed authority directory covers dashboard countries without putting contacts in public assets',async()=>{
 const {authorityDirectory,publicAuthorities}=await import('./authorities.mjs');
 const dashboard=JSON.parse(await readFile(new URL('./public/data.json',import.meta.url),'utf8'));
 assert.deepEqual([...new Set(authorityDirectory.map(a=>a.country))].sort(),dashboard.Coverage.slice(1).map(r=>r[1]).sort());
 for(const a of authorityDirectory){assert.match(a.email,/^[^\s@]+@[^\s@]+\.[^\s@]+$/);assert.equal(new URL(a.source).protocol,'https:')}
 assert.doesNotMatch(JSON.stringify(publicAuthorities()),/@/);
});

test('public questions require admin addressing and approval; only question and stage are public through the cycle',async()=>{
 let messages=[];const {service,calls}=setup({route:url=>new URL(url).pathname.endsWith('/messages')?json({messages}):null});
 await service.save(draft);await contributed(service);assert.deepEqual(await service.questions(),{questions:[]});
 const question='Which education evidence is missing for girls?';
 await service.submitQuestion({...recipient,question,to:'attacker@example.org',status:'sent',body:'PRIVATE-OVERRIDE',author:{kind:'owner'}},'visitor');
 assert.equal(calls.length,0);
 let d=(await service.list()).drafts.find(d=>d.publicQuestion===question);assert.equal(d.to,'private-authority@example.org');assert.equal(d.author.kind,'contributor');assert.equal(d.body,question);
 const expectStage=async stage=>assert.deepEqual(await service.questions(),{questions:[{question,stage}]});
 await expectStage('Awaiting approval');await assert.rejects(service.approve(d.id,{revision:1}),/Verify the recipient/);
 await connect(service);await assert.rejects(service.send(d.id,{revision:1,recipientConfirmed:true}),/must approve/);
 d=await service.edit(d.id,{...draft,body:'PRIVATE-ADMIN-MESSAGE',revision:1});
 await service.approve(d.id,{revision:d.revision,recipientConfirmed:true});await expectStage('Approved');
 const sent=await service.send(d.id,{revision:d.revision,recipientConfirmed:true});await expectStage('Sent');
 messages=[{message_id:'<reply@example.org>',inbox_id:inbox.inbox_id,thread_id:sent.threadId,timestamp:new Date(sent.sentAt+1000).toISOString(),from:draft.to,references:[sent.messageId],headers:{'Auto-Submitted':'no'},authentication_results:{dmarc:'pass'},text:'PRIVATE-REPLY-CONTENT'}];
 await service.refresh(d.id);await expectStage('Reply received');await service.closeQuestion(d.id,{revision:d.revision});await expectStage('Closed');
 assert.equal(calls.filter(c=>c.url.endsWith('/messages/send')).length,1);
 assert.doesNotMatch(JSON.stringify(await service.questions()),/PRIVATE|example.org|thread|approval|messageId|owner/);
});

test('public submission rejects invalid questions, restricts repeated submissions and never auto-sends',async()=>{
 const {service,calls}=setup();
 for(const question of ['', 'x'.repeat(3001), 'sk-proj-abcdefghijklmnopqrst'])await assert.rejects(service.submitQuestion({question},'visitor'));
 for(let i=0;i<3;i++)await service.submitQuestion({...recipient,question:'Public question '+i},'visitor');
 await assert.rejects(service.submitQuestion({...recipient,question:'Fourth question'},'visitor'),/submission limit/);assert.equal(calls.length,0);
 const d=(await service.list()).drafts[0];await service.reject(d.id,{revision:1});assert.equal((await service.questions()).questions[0].stage,'Rejected');
});

test('no in-memory fallback when persistent storage is missing',async()=>{
 const service=createOutreachService({env:{}});assert.equal((await service.status()).storageConfigured,false);await assert.rejects(service.save(draft),/persistent outreach storage/);
 const publicStatus=await setup().service.status(false);assert(!('mailbox' in publicStatus));assert(!('ownerEmail' in publicStatus));
});

test('public storage health verifies a read and hides database errors and private records',async()=>{
 const healthy=setup().service;const status=await healthy.status(false);assert.equal(status.storageConnected,true);assert(!('mailbox' in status));assert(!('drafts' in status));
 const broken=createOutreachService({env,store:{read:async()=>{throw Error('private database connection details')}}});const failed=await broken.status(false);assert.equal(failed.storageConfigured,true);assert.equal(failed.storageConnected,false);assert(!JSON.stringify(failed).includes('private database'));
});

test('contributor invitation is single-use, bounded and never grants owner privileges',async()=>{
 const {service}=setup();const invite=await service.invitation({name:'Contributor',email:'contributor@example.org'}),token=new URL(invite.url).hash.slice(1);
 assert.equal((await service.invitationInfo(token)).name,'Contributor');
 const receipt=await service.submit(token,{...draft,author:{kind:'owner',email:env.OUTREACH_OWNER_EMAIL}}),d=await get(service,receipt.id);
 assert.equal(d.author.kind,'contributor');assert.equal(d.author.email,'contributor@example.org');assert.equal(d.status,'pending_approval');assert.equal(d.approval,null);
 assert(!JSON.stringify(receipt).includes(draft.body));assert(!JSON.stringify(await service.list()).includes(token));
 await assert.rejects(service.submit(token,draft),/expired, been used or been revoked/);
 const next=await service.invitation({name:'Next',email:'next@example.org'});await service.revoke(next.id);await assert.rejects(service.invitationInfo(new URL(next.url).hash.slice(1)),/revoked/);
});

test('expired invitation fails without storing a draft',async()=>{
 let clock=100000;const {service}=setup({clock:()=>clock});const i=await service.invitation({name:'Person',email:'person@example.org'});clock+=8*86400000;await assert.rejects(service.submit(new URL(i.url).hash.slice(1),draft),/expired/);assert.equal((await service.list()).drafts.length,0);
});

test('owner approval is tied to exact content and revision; edits require a new review',async()=>{
 const {service,calls}=setup();await connect(service);const {id}=await contributed(service);
 await assert.rejects(service.send(id,{revision:1,recipientConfirmed:true}),/must approve/);assert(!calls.some(c=>c.url.endsWith('/messages/send')));
 await assert.rejects(service.approve(id,{revision:1}),/Verify the recipient/);
 let d=await service.approve(id,{revision:1,recipientConfirmed:true});assert.equal(d.approval.by,env.OUTREACH_OWNER_EMAIL);
 d=await service.edit(id,{...draft,body:'Revised request.',revision:1});assert.equal(d.revision,2);assert.equal(d.status,'pending_approval');assert.equal(d.approval,null);
 await assert.rejects(service.approve(id,{revision:1,recipientConfirmed:true}),/changed/);await assert.rejects(service.send(id,{revision:2,recipientConfirmed:true}),/must approve/);
 await service.approve(id,{revision:2,recipientConfirmed:true});d=await service.send(id,{revision:2,recipientConfirmed:true});assert.equal(d.status,'sent');assert.equal(d.history.filter(h=>h.action==='sent').length,1);
});

test('owner drafts send on explicit review without a second approval gate; duplicate sends are blocked',async()=>{
 const {service,calls}=setup();await connect(service);const d=await service.save({...draft,author:{kind:'contributor'}});
 assert.equal(d.author.kind,'owner');await assert.rejects(service.send(d.id,{revision:1}),/Confirm the recipient/);
 const results=await Promise.all([service.send(d.id,{revision:1,recipientConfirmed:true}),service.send(d.id,{revision:1,recipientConfirmed:true})]);
 assert.equal(calls.filter(c=>c.url.endsWith('/messages/send')).length,1);assert(results.some(d=>d.status==='sent'));
 const sent=await get(service,d.id);assert.equal(sent.approval.by,env.OUTREACH_OWNER_EMAIL);await service.send(d.id,{revision:1,recipientConfirmed:true});assert.equal(calls.filter(c=>c.url.endsWith('/messages/send')).length,1);
 const call=calls.find(c=>c.url.endsWith('/messages/send')),body=JSON.parse(call.init.body);assert.deepEqual(body.to,[draft.to]);assert.equal(body.subject,draft.subject);assert.equal(body.text,draft.body);assert.equal(body.track_opens,false);assert.equal(body.html,undefined);assert.equal(body.headers['X-Dashboard-Outreach-ID'],sent.sendAttempt.id);assert.equal(call.init.headers.Authorization,'Bearer '+env.AGENTMAIL_API_KEY);assert(!JSON.stringify(sent).includes(env.AGENTMAIL_API_KEY));
 await assert.rejects(service.edit(d.id,{...draft,revision:1}),/cannot be edited/);
});

test('rejected drafts and changed approvals cannot be sent',async()=>{
 const {service,store}=setup();await connect(service);let {id}=await contributed(service);await service.reject(id,{revision:1});await assert.rejects(service.send(id,{revision:1,recipientConfirmed:true}),/rejected/);
 ({id}=await contributed(service));await service.approve(id,{revision:1,recipientConfirmed:true});await store.transaction(async tx=>{const d=await tx.get('draft:'+id);d.to='different@example.org';await tx.put('draft:'+id,'draft',d)});await assert.rejects(service.send(id,{revision:1,recipientConfirmed:true}),/must approve/);
});

test('one dedicated mailbox is created and reused; pause preserves history and blocks sending',async()=>{
 const {service,store,calls}=setup();await store.transaction(tx=>tx.put('mail:owner','mail',{tokens:'legacy-encrypted-token'}));
 await Promise.all([connect(service),connect(service)]);assert.equal(calls.filter(c=>c.url.endsWith('/inboxes')).length,1);
 const status=await service.status(true);assert.equal(status.mailbox,inbox.email);assert.equal(status.ownerEmail,env.OUTREACH_OWNER_EMAIL);assert.equal(status.mailConnected,true);
 const d=await service.save(draft);await service.disconnect();assert.equal((await service.status(true)).mailConnected,false);assert.equal((await service.status(true)).hasMailbox,true);await assert.rejects(service.send(d.id,{revision:1,recipientConfirmed:true}),/Connect the dedicated/);
 await connect(service);assert.equal((await service.status(true)).mailConnected,true);assert.equal(calls.filter(c=>c.url.endsWith('/inboxes')).length,1);assert.equal((await get(service,d.id)).status,'draft');assert.equal((await store.read(tx=>tx.get('mail:owner'))).tokens,'legacy-encrypted-token');
 assert(!JSON.stringify(status).includes('keyHash'));assert(!JSON.stringify(status).includes(env.AGENTMAIL_API_KEY));assert(!JSON.stringify(await service.status(false)).includes(inbox.email));
});

test('configured existing inbox is verified instead of creating another one; key rotation requires reconnect',async()=>{
 const settings={...env,AGENTMAIL_INBOX_ID:inbox.inbox_id};const {service,calls}=setup({settings});await connect(service);assert.equal(calls.filter(c=>c.url.endsWith('/inboxes')).length,0);
 settings.AGENTMAIL_API_KEY='synthetic-new-mail-key';assert.equal((await service.status(true)).mailConnected,false);const d=await service.save(draft);await assert.rejects(service.send(d.id,{revision:1,recipientConfirmed:true}),/Connect the dedicated/);await connect(service);assert.equal((await service.status(true)).mailConnected,true);
});

test('failed inbox persistence retries with the same provider creation client ID',async()=>{
 const base=memoryStore();let fail=true;const store={...base,transaction:fn=>base.transaction(async tx=>{const result=await fn(tx);if(fail){fail=false;throw Error('simulated database failure')}return result})};const {service,calls}=setup({store});
 await assert.rejects(connect(service),/storage is unavailable/);await connect(service);const creates=calls.filter(c=>c.url.endsWith('/inboxes'));assert.equal(creates.length,2);assert.equal(JSON.parse(creates[0].init.body).client_id,JSON.parse(creates[1].init.body).client_id);assert(!JSON.stringify(creates.map(c=>JSON.parse(c.init.body))).includes(env.AGENTMAIL_API_KEY));
});

test('missing, mismatched or paused provider inbox cannot become connected',async()=>{
 for(const response of [{inbox_id:'wrong',email:inbox.email},{...inbox,status:'paused'},{inbox_id:inbox.inbox_id,email:'invalid'}]){const {service}=setup({settings:{...env,AGENTMAIL_INBOX_ID:inbox.inbox_id},route:()=>json(response)});await assert.rejects(connect(service),/could not be verified/);assert.equal((await service.status(true)).mailConnected,false)}
});

test('uncertain mail response records attention and never repeats a paid or sending operation',async()=>{
 const {service,calls}=setup({route:url=>{if(url.endsWith('/messages/send'))throw Error('network interruption')}});await connect(service);const d=await service.save(draft);const result=await service.send(d.id,{revision:1,recipientConfirmed:true});assert.equal(result.status,'needs_attention');assert.equal(result.messageId,null);assert(result.sendAttempt.id);assert.equal(result.rfcMessageId,undefined);assert.equal((await service.send(d.id,{revision:1,recipientConfirmed:true})).status,'needs_attention');assert.equal(calls.filter(c=>c.url.endsWith('/messages/send')).length,1);
});

test('definite provider refusal records failure and preserves approval for a manual retry',async()=>{
 const {service,calls}=setup({route:url=>url.endsWith('/messages/send')?json({error:{message:'secret raw error'}},403):null});await connect(service);const d=await service.save(draft),r=await service.send(d.id,{revision:1,recipientConfirmed:true});assert.equal(r.status,'failed');assert(r.approval);assert(!JSON.stringify(r).includes('secret raw error'));assert.equal(calls.filter(c=>c.url.endsWith('/messages/send')).length,1);
});

test('reply tracking matches correspondent, thread, time and original reference; content is discarded',async()=>{
 let messages=[];const {service,calls,store}=setup({route:url=>new URL(url).pathname.endsWith('/messages')?json({messages}):null});await connect(service);const d=await service.save(draft),sent=await service.send(d.id,{revision:1,recipientConfirmed:true});
 const canary='PRIVATE-INCOMING-CONTENT-DO-NOT-STORE';
 const reply=extra=>({message_id:'<reply@example.org>',inbox_id:inbox.inbox_id,thread_id:sent.threadId,timestamp:new Date(sent.sentAt+1000).toISOString(),from:'Researcher <'+draft.to+'>',references:[sent.messageId],headers:{'Auto-Submitted':'no'},authentication_results:{dmarc:'pass'},subject:canary,preview:canary,text:canary,html:canary,attachments:[{filename:canary}],...extra});
 for(const extra of [{from:'other@example.org'},{from:'Researcher <researcher@example.org>, Attacker <attacker@example.org>'},{references:['<unrelated>']},{thread_id:'other-thread'},{headers:{'Auto-Submitted':'auto-replied'}},{labels:['sent']},{authentication_results:{dmarc:'fail'}},{timestamp:'invalid'},{timestamp:new Date(sent.sentAt-600000).toISOString()},{message_id:null}]){messages=[reply(extra)];assert.equal((await service.refresh(d.id)).status,'sent')}
 messages=[reply({references:[],in_reply_to:sent.messageId})];const tracked=await service.refresh(d.id);assert.equal(tracked.status,'replied');assert.equal(tracked.replyId,'<reply@example.org>');assert.equal(tracked.repliedAt,sent.sentAt+1000);assert.equal(tracked.history.filter(h=>h.action==='reply_detected').length,1);
 await service.refresh(d.id);assert.equal((await get(service,d.id)).history.filter(h=>h.action==='reply_detected').length,1);
 for(const data of [tracked,await service.status(false),await service.list(),await store.read(tx=>tx.get('draft:'+d.id))])assert(!JSON.stringify(data).includes(canary));
 const requests=calls.filter(c=>new URL(c.url).pathname.endsWith('/messages'));assert(requests.length);for(const c of requests){const u=new URL(c.url);assert.equal(c.init.method,'GET');assert.equal(u.searchParams.get('from'),draft.to);assert.equal(u.searchParams.get('include_unauthenticated'),'false');assert.equal(u.searchParams.get('include_spam'),'false')}
 assert(!calls.some(c=>/\/threads\/|\/messages\/[^/]+$/.test(new URL(c.url).pathname)&&!c.url.endsWith('/messages/send')));
});

test('tracking follows pagination with a bounded limit and retains metadata only',async()=>{
 let count=0;const mail=createProxyMail({env,fetchImpl:async(url,init)=>{count++;assert.equal(init.redirect,'error');const q=new URL(url).searchParams;assert.equal(q.get('page_token'),count===1?null:'page-'+(count-1));return json({messages:[{message_id:'reply-'+count,thread_id:'thread',from:draft.to,timestamp:new Date().toISOString(),headers:{'In-Reply-To':'<original>','References':'<earlier> <original>'},preview:'private preview',html:'private body'}],next_page_token:'page-'+count})}});
 const result=await mail.replyMetadata(inbox.inbox_id,{...draft,threadId:'thread',sentAt:Date.now()});assert.equal(count,5);assert.equal(result.limited,true);assert.equal(result.messages.length,5);assert.equal(result.messages[0].inReplyTo,'<original>');assert.deepEqual(result.messages[0].references,['<earlier>','<original>']);assert(!JSON.stringify(result).includes('private'));
});

test('old Gmail history is preserved without calling the old provider',async()=>{
 const {service,store,calls}=setup();const d=await service.save(draft);await store.transaction(async tx=>{const r=await tx.get('draft:'+d.id);Object.assign(r,{status:'sent',threadId:'legacy-thread',sentAt:Date.now(),messageId:'legacy-id'});await tx.put('draft:'+d.id,'draft',r)});await assert.rejects(service.refresh(d.id),/legacy mail record/);assert.equal((await get(service,d.id)).messageId,'legacy-id');assert.equal(calls.length,0);
});

test('persisted approval and sending history survive service re-creation',async()=>{
 const store=memoryStore(),first=setup({store});await connect(first.service);const d=await first.service.save(draft);await first.service.send(d.id,{revision:1,recipientConfirmed:true});const next=setup({store});assert.equal((await get(next.service,d.id)).status,'sent');assert.equal((await next.service.status(true)).mailConnected,true);
});

test('header injection and ambiguous recipient lists never reach the provider',async()=>{
 const {service,calls}=setup();for(const p of [{...draft,to:'a@example.org,b@example.org'},{...draft,to:'a@example.org\r\nBcc: bad@example.org'},{...draft,subject:'Hi\r\nBcc: bad@example.org'},{...draft,body:'sk-proj-syntheticcredential123456789'}])await assert.rejects(service.save(p));assert.equal(calls.length,0);
});

test('outreach UI includes owner queue and escapes submitted content',async()=>{
 const elements={},ctx=vm.createContext({URL,console,setTimeout,clearTimeout,fetch:()=>new Promise(()=>{}),document:{getElementById:id=>elements[id]??={innerHTML:'',classList:{toggle(){}}},querySelectorAll:()=>[]}});
 for(const file of ['outreach-ui.js','agent-ui.js','app.js'])vm.runInContext(await readFile(new URL('./public/'+file,import.meta.url),'utf8'),ctx);
 ctx.input=JSON.parse(await readFile(new URL('./public/data.json',import.meta.url),'utf8'));vm.runInContext("D=input;tab='agent';agentState.workspace='outreach';agentState.connection={configured:true,keyConfigured:true,accessConfigured:true,authenticated:true};outreachState.loaded=true;outreachState.connection={storageConfigured:true,mailConfigured:true,mailConnected:true};render()",ctx);
 assert.match(elements.content.innerHTML,/Agent Outreach/);assert.match(elements.content.innerHTML,/Invite someone/);assert.match(elements.content.innerHTML,/Save my draft/);
 ctx.example={id:'test',...draft,subject:'<script>bad</script>',author:{kind:'contributor',name:'<img onerror=bad>'},revision:1,status:'pending_approval',history:[],body:'<svg onload=bad>'};
 const html=vm.runInContext('outreachDetail(example)',ctx);assert(!html.includes('<script>'));assert(!html.includes('<svg'));assert.match(html,/Approve & send with SIYA/);assert.match(html,/independently verified/);
});

test('owner setup reports key presence without exposing credentials or mailbox details publicly',async()=>{
 const service=createOutreachService({env:{...env,AGENTMAIL_API_KEY:'  '},store:memoryStore()});const status=await service.status(true);assert.equal(status.mailConfigured,false);assert.deepEqual(status.setup,{apiKey:false,ownerEmail:true,storage:true});assert.equal(status.callbackUrl,undefined);
 const publicStatus=await service.status(false);assert(!('setup' in publicStatus));assert(!('ownerEmail' in publicStatus));assert(!('mailbox' in publicStatus));for(const secret of [env.AGENTMAIL_API_KEY,env.AGENT_ACCESS_CODE])assert(!JSON.stringify(status).includes(secret));await assert.rejects(service.connect(),/Configure the proxy/);
 const ready=await setup().service.status(true);assert.equal(ready.mailConfigured,true);assert(Object.values(ready.setup).every(Boolean));assert(!JSON.stringify(ready).includes(env.AGENTMAIL_API_KEY));
});

test('provider errors cannot echo private response content and ambiguous send references block retries',async()=>{
 for(const response of [json({message_id:'missing-thread'}),json({error:'PRIVATE-REPLY-CONTENT'},500)]){const {service,calls}=setup({route:url=>url.endsWith('/messages/send')?response:null});await connect(service);const d=await service.save(draft);const result=await service.send(d.id,{revision:1,recipientConfirmed:true});assert.equal(result.status,'needs_attention');assert(!JSON.stringify(result).includes('PRIVATE-REPLY'));await service.send(d.id,{revision:1,recipientConfirmed:true});assert.equal(calls.filter(c=>c.url.endsWith('/messages/send')).length,1)}
});

test('provider acceptance followed by a database failure leaves the durable claim blocked',async()=>{
 const base=memoryStore();let writes=0,failAt=Infinity;const store={...base,transaction:fn=>base.transaction(async tx=>{const result=await fn(tx);if(++writes===failAt)throw Error('persistence failed');return result})};const {service,calls}=setup({store});await connect(service);const d=await service.save(draft);failAt=writes+2;
 await assert.rejects(service.send(d.id,{revision:1,recipientConfirmed:true}),/storage is unavailable/);assert.equal((await get(service,d.id)).status,'sending');await service.send(d.id,{revision:1,recipientConfirmed:true});assert.equal(calls.filter(c=>c.url.endsWith('/messages/send')).length,1);
});

test('stale send claims become attention records without dispatching again',async()=>{
 let clock=100000;const {service,store,calls}=setup({clock:()=>clock});const d=await service.save(draft);await store.transaction(async tx=>{const r=await tx.get('draft:'+d.id);Object.assign(r,{status:'sending',sendAttempt:{id:'attempt',at:clock}});await tx.put('draft:'+d.id,'draft',r)});clock+=121000;const result=await service.refresh(d.id);assert.equal(result.status,'needs_attention');assert.equal(calls.length,0);
});

test('unknown reply payload properties in stored records are excluded from owner API responses',async()=>{
 const {service,store}=setup();const d=await service.save(draft);await store.transaction(async tx=>{const r=await tx.get('draft:'+d.id);Object.assign(r,{replyBody:'PRIVATE-CANARY',preview:'PRIVATE-CANARY',reply:{text:'PRIVATE-CANARY'}});await tx.put('draft:'+d.id,'draft',r)});assert(!JSON.stringify(await service.list()).includes('PRIVATE-CANARY'));assert(!JSON.stringify(await service.refresh(d.id)).includes('PRIVATE-CANARY'));
});


test('unscoped drafts retain no arbitrary dashboard country or year',async()=>{
 const s=setup();const d=await s.service.save({to:draft.to,subject:draft.subject,body:draft.body});assert.equal(d.country,null);assert.equal(d.year,null);assert.equal(d.status,'draft');assert.equal(s.calls.length,0);
});
