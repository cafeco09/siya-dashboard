import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createQuestionSessions} from './question-sessions.mjs';

function response(){return {headers:{},setHeader(key,value){this.headers[key]=value}}}

test('anonymous question cookies are HttpOnly, isolated from owner login and expire',()=>{
 let clock=0;const sessions=createQuestionSessions({now:()=>clock,ttlMs:1000,maxSessions:2});
 const req={headers:{host:'example.test'}},res=response();
 assert.throws(()=>sessions.resolve(req,res),e=>e.status===401);
 const id=sessions.resolve(req,res,{create:true}),cookie=res.headers['Set-Cookie'];
 assert.match(cookie,/HttpOnly; SameSite=Strict; Max-Age=1; Secure/);assert(!cookie.includes('heic_agent='));
 assert.equal(sessions.resolve({headers:{...req.headers,cookie:cookie.split(';')[0]}},response()),id);
 assert.throws(()=>sessions.resolve({headers:{...req.headers,cookie:'heic_agent='+id}},response()),e=>e.status===401);
 sessions.resolve(req,response(),{create:true});assert.throws(()=>sessions.resolve(req,response(),{create:true}),e=>e.status===429);
 clock=1001;assert.throws(()=>sessions.resolve({headers:{...req.headers,cookie:cookie.split(';')[0]}},response()),e=>e.status===401);
 assert(sessions.resolve(req,response(),{create:true}));
});

test('code-free HTTP questions are session-isolated and never authorise mail controls',async()=>{
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:'0',OPENAI_API_KEY:'',GROQ_API_KEY:'',AGENT_ACCESS_CODE:'',DATABASE_URL:''},stdio:['ignore','pipe','pipe']});
 try{
  const [output]=await once(child.stdout,'data');const port=String(output).match(/port (\d+)/)?.[1];assert(port);const origin='http://127.0.0.1:'+port;
  const status=await(await fetch(origin+'/api/agent/status')).json();assert.equal(status.publicQuestions,true);assert.equal(status.authenticated,false);assert.equal(status.accessConfigured,false);
  const post=(body,cookie,override={})=>({method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...override},body:JSON.stringify(body)});
  const payload={mode:'frontier',scope:'question',prompt:'Show reading for girls in Pakistan'};
  async function ask(body=payload,cookie){
   const start=await fetch(origin+'/api/agent/tasks',post(body,cookie));assert.equal(start.status,202);
   const ownCookie=start.headers.get('set-cookie').split(';')[0];let task=await start.json();
   assert(!JSON.stringify(task).includes(ownCookie.slice(10)));
   for(let i=0;i<500&&['queued','running'].includes(task.status);i++){
    await new Promise(r=>setTimeout(r,10));const res=await fetch(origin+'/api/agent/tasks/'+task.id,{headers:{Cookie:ownCookie}});assert.equal(res.status,200);task=await res.json();
   }
   assert.equal(task.status,'completed');return {task,cookie:ownCookie};
  }
  const a=await ask();assert.match(a.task.output,/foundational reading criteria/);
  const b=await ask({...payload,prompt:'Show numeracy for girls in Pakistan'});
  assert.notEqual(a.cookie,b.cookie);
  assert.equal((await fetch(origin+'/api/agent/tasks/'+a.task.id)).status,401);
  assert.equal((await fetch(origin+'/api/agent/tasks/'+a.task.id,{headers:{Cookie:b.cookie}})).status,404);
  assert.equal((await fetch(origin+'/api/agent/tasks/'+a.task.id+'/cancel',post({},b.cookie))).status,404);
  assert.equal((await fetch(origin+'/api/agent/tasks',post({...payload,conversationId:a.task.conversationId},b.cookie))).status,404);
  assert.equal((await fetch(origin+'/api/agent/conversations/'+a.task.conversationId+'/forget',post({},b.cookie))).status,404);
  assert.equal((await fetch(origin+'/api/agent/tasks',post(payload,a.cookie,{Origin:'https://example.test'}))).status,403);
  for(const route of ['/api/agent/outreach/drafts','/api/agent/outreach/invitations','/api/agent/outreach/mail/connect']){
   const res=await fetch(origin+route,route.endsWith('/drafts')?{headers:{Cookie:a.cookie}}:post({},a.cookie));assert.equal(res.status,401);
  }
  const privateStatus=await(await fetch(origin+'/api/agent/outreach/status',{headers:{Cookie:a.cookie}})).json();assert(!('mailbox' in privateStatus));assert(!('ownerEmail' in privateStatus));
  const next=await ask({mode:'frontier',scope:'question',prompt:'sources',conversationId:a.task.conversationId},a.cookie);assert.equal(next.task.conversationId,a.task.conversationId);
  const forgotten=await fetch(origin+'/api/agent/conversations/'+a.task.conversationId+'/forget',post({},a.cookie));assert.equal(forgotten.status,200);
  assert.equal((await fetch(origin+'/api/agent/tasks/'+a.task.id,{headers:{Cookie:a.cookie}})).status,404);
 }finally{child.kill('SIGTERM');await once(child,'exit')}
});

test('diagnostics require a signed admin cookie and never enter anonymous task or history responses',async()=>{
 const access='synthetic-diagnostics-owner-key';
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:'0',AGENT_ACCESS_CODE:access,DATABASE_URL:''},stdio:['ignore','pipe','pipe']});
 try{
  const [output]=await once(child.stdout,'data'),port=String(output).match(/port (\d+)/)?.[1];assert(port);const origin='http://127.0.0.1:'+port;
  const post=(body,cookie)=>({method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  const start=await fetch(origin+'/api/agent/tasks',post({mode:'frontier',scope:'question',admin:true,prompt:'Compare reading between richest and poorest households in Pakistan.'}));
  const cookie=start.headers.get('set-cookie').split(';')[0];let task=await start.json();
  for(let i=0;i<500&&!['completed','failed'].includes(task.status);i++){await new Promise(r=>setTimeout(r,10));task=await(await fetch(origin+'/api/agent/tasks/'+task.id,{headers:{Cookie:cookie}})).json()}
  assert.equal(task.status,'completed');assert(task.dialogue.publicDisplay);assert.equal(task.dialogue.comparison.rows.length,2);assert(task.dialogue.suggestedReplies.length);
  const noDiagnostics=value=>{if(!value||typeof value!=='object')return;for(const [key,v]of Object.entries(value)){assert(!['frontier','memory','trace','source_sha256','interpretation','architecture','packetHash'].includes(key),key);noDiagnostics(v)}};
  noDiagnostics(task);assert(!JSON.stringify(task).includes('locked V4'));assert(!JSON.stringify(task).includes('source_sha256'));
  const unlocked=await fetch(origin+'/api/agent/unlock',post({code:access}));assert.equal(unlocked.status,200);const ownerCookie=unlocked.headers.get('set-cookie').split(';')[0];
  const privateTask=await(await fetch(origin+'/api/agent/tasks/'+task.id,{headers:{Cookie:cookie+'; '+ownerCookie}})).json();
  assert(privateTask.dialogue.frontier.memory);assert(privateTask.dialogue.frontier.v4);assert(privateTask.conversation.turns[0].result.frontier.interpretation);
  const publicAgain=await(await fetch(origin+'/api/agent/tasks/'+task.id+'?admin=true',{headers:{Cookie:cookie}})).json();noDiagnostics(publicAgain);
  const status=await(await fetch(origin+'/api/agent/status')).json();assert(!('frontierRuntime' in status));
  const adminStatus=await(await fetch(origin+'/api/agent/status',{headers:{Cookie:ownerCookie}})).json();assert(adminStatus.frontierRuntime);
  const nextStart=await fetch(origin+'/api/agent/tasks',post({mode:'frontier',scope:'question',conversationId:task.conversationId,prompt:'sources'},cookie));let next=await nextStart.json();
  for(let i=0;i<500&&!['completed','failed'].includes(next.status);i++){await new Promise(r=>setTimeout(r,10));next=await(await fetch(origin+'/api/agent/tasks/'+next.id,{headers:{Cookie:cookie}})).json()}
  assert.equal(next.status,'completed');assert(next.dialogue.references.length);assert.equal(next.conversationId,task.conversationId);noDiagnostics(next);
  const choicesStart=await fetch(origin+'/api/agent/tasks',post({mode:'frontier',scope:'question',prompt:'Compare Japan and South Korea’s intimate-partner violence alongside workforce participation. Show the sources for both countries.'},cookie));let choices=await choicesStart.json();
  for(let i=0;i<500&&!['completed','failed'].includes(choices.status);i++){await new Promise(r=>setTimeout(r,10));choices=await(await fetch(origin+'/api/agent/tasks/'+choices.id,{headers:{Cookie:cookie}})).json()}
  assert.equal(choices.dialogue.kind,'clarification');assert.equal(choices.dialogue.clarification.options.length,3);noDiagnostics(choices);
  const replyStart=await fetch(origin+'/api/agent/tasks',post({mode:'frontier',scope:'question',conversationId:choices.conversationId,prompt:choices.dialogue.clarification.options[2].reply},cookie));let reply=await replyStart.json();
  for(let i=0;i<500&&!['completed','failed'].includes(reply.status);i++){await new Promise(r=>setTimeout(r,10));reply=await(await fetch(origin+'/api/agent/tasks/'+reply.id,{headers:{Cookie:cookie}})).json()}
  assert.equal(reply.dialogue.kind,'answer');assert.equal(reply.conversationId,choices.conversationId);assert.equal(reply.dialogue.references.length,6);noDiagnostics(reply);
  const cancelled=await(await fetch(origin+'/api/agent/tasks/'+reply.id+'/cancel',post({},cookie))).json();noDiagnostics(cancelled);
 }finally{child.kill('SIGTERM');await once(child,'exit')}
});

test('GitHub portal sessions isolate public questions and cannot use admin cookies',async()=>{
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:'0',AGENT_ACCESS_CODE:'synthetic-portal-owner-access',DATABASE_URL:''},stdio:['ignore','pipe','pipe']});
 try{
  const [output]=await once(child.stdout,'data'),port=String(output).match(/port (\d+)/)?.[1],base='http://127.0.0.1:'+port,portal='https://cafeco09.github.io';assert(port);
  const request=(method='GET',session,body)=>({method,headers:{Origin:portal,...(session?{'X-Siya-Session':session}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const pre=await fetch(base+'/api/agent/tasks',{method:'OPTIONS',headers:{Origin:portal,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-siya-session'}});assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-origin'),portal);assert.equal(pre.headers.get('access-control-allow-credentials'),null);
  assert.equal((await fetch(base+'/api/agent/tasks',{method:'OPTIONS',headers:{Origin:'https://evil.test'}})).status,403);
  const open=async()=>{const r=await fetch(base+'/api/agent/session',request('POST',null,{}));assert.equal(r.status,201);assert.equal(r.headers.get('set-cookie'),null);return(await r.json()).session};
  const a=await open(),b=await open();assert.notEqual(a,b);
  const start=await fetch(base+'/api/agent/tasks',request('POST',a,{mode:'frontier',scope:'question',prompt:'Show women’s share of the total labour force in Nigeria in 2023'}));assert.equal(start.status,202);assert.equal(start.headers.get('set-cookie'),null);let task=await start.json();
  assert.equal((await fetch(base+'/api/agent/tasks/'+task.id,request('GET',b))).status,404);
  assert.equal((await fetch(base+'/api/agent/tasks/'+task.id,request('GET','fabricated'))).status,401);
  assert.equal((await fetch(base+'/api/agent/tasks/'+task.id)).status,401);
  for(let i=0;i<500&&['queued','running'].includes(task.status);i++){await new Promise(r=>setTimeout(r,10));task=await(await fetch(base+'/api/agent/tasks/'+task.id,request('GET',a))).json()}
  assert.equal(task.status,'completed');assert.match(task.output,/48.44/);assert(!JSON.stringify(task).includes('source_sha256'));assert(!task.dialogue.frontier);
  const next=await fetch(base+'/api/agent/tasks',request('POST',a,{mode:'frontier',scope:'question',prompt:'sources',conversationId:task.conversationId}));assert.equal(next.status,202);assert.equal((await next.json()).conversationId,task.conversationId);
  for(const path of ['/api/agent/unlock','/api/agent/outreach/drafts','/api/agent/outreach/authority-directory','/api/agent/outreach/mail/connect'])assert.equal((await fetch(base+path,request('POST',a,{}))).status,403);
  const login=await fetch(base+'/api/agent/unlock',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({code:'synthetic-portal-owner-access'})});const cookie=login.headers.get('set-cookie').split(';')[0];assert.equal(login.status,200);
  const status=await(await fetch(base+'/api/agent/status',{headers:{Origin:portal,Cookie:cookie}})).json();assert.equal(status.authenticated,false);assert(!status.frontierRuntime);
  const directory=await(await fetch(base+'/api/agent/outreach/authorities',request())).json();assert(!JSON.stringify(directory).includes('@'));
 }finally{child.kill('SIGTERM');await once(child,'exit')}
});

test('portal session tokens expire and do not turn into cookie sessions',()=>{
 let clock=0;const s=createQuestionSessions({now:()=>clock,ttlMs:1000});const req={siyaPortal:true,headers:{host:'example.test'}},res=response(),id=s.resolve(req,res,{create:true});assert(!res.headers['Set-Cookie']);
 assert.equal(s.resolve({...req,headers:{...req.headers,'x-siya-session':id}},response()),id);
 assert.throws(()=>s.resolve({headers:{host:'example.test','x-siya-session':id}},response()),e=>e.status===401);
 clock=1001;assert.throws(()=>s.resolve({...req,headers:{...req.headers,'x-siya-session':id}},response(),{create:true}),e=>e.status===401);
});
