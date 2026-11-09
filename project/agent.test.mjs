import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createAgentService} from './agent.mjs';

const dataPath=new URL('./public/data.json',import.meta.url);
// Synthetic credentials; all agent and mail transport tests use mocked providers.
const env={GROQ_API_KEY:'synthetic-groq-credential',AGENT_ACCESS_CODE:'synthetic-owner-code-12345'};
const request={headers:{host:'localhost:3000'}};
const payload={mode:'explain',country:'PAK',year:2023,prompt:'Explain the learning evidence.'};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers});
const answer=(content='Evidence with original source years.',finish_reason='stop')=>({id:'chatcmpl_synthetic',choices:[{index:0,finish_reason,message:{role:'assistant',content,reasoning:'Private model reasoning must not be displayed.'}}]});
function setup(options={}){
 const calls=[];
 const service=createAgentService({dataPath,env,logFailure:()=>{},...options,fetchImpl:async(url,init)=>{
  calls.push({url,init,body:init.body?JSON.parse(init.body):undefined});
  return options.route?options.route(url,init):json(answer(),200,{'x-request-id':'req_synthetic'});
 }});return {service,calls};
}
async function settled(service,id){
 for(let i=0;i<600;i++){const t=service.get(id);if(['completed','failed','cancelled'].includes(t.status)&&t.cleanup!=='Pending')return t;await new Promise(r=>setTimeout(r,5))}
 throw Error('Mock agent did not settle');
}

test('configuration and signed owner cookie never expose credentials',()=>{
 let clock=100000;const service=createAgentService({dataPath,env,now:()=>clock});
 assert.equal(service.status(request).configured,true);
 assert.equal(service.status(request).authenticated,false);
 assert.throws(()=>service.cookieFor(request,'wrong'),/not accepted/);
 const cookie=service.cookieFor(request,env.AGENT_ACCESS_CODE);
 assert.match(cookie,/HttpOnly; SameSite=Strict/);
 const auth={headers:{...request.headers,cookie:cookie.split(';')[0]}};
 assert.equal(service.authenticated(auth),true);
 assert.equal(service.authenticated({headers:{cookie:auth.headers.cookie+'x'}}),false);
 clock+=9*3600000;assert.equal(service.authenticated(auth),false);
 assert(!JSON.stringify(service.status(request)).includes(env.GROQ_API_KEY));
 const missing=createAgentService({dataPath,env:{}});assert.equal(missing.status(request).configured,false);
 assert.throws(()=>missing.cookieFor(request,'anything'),/finish/);
});

test('country evidence preserves source periods, combined-sex family data and Sindh coverage',async()=>{
 const {service}=setup();const d=JSON.parse(await readFile(dataPath,'utf8'));
 const snapshot=await service.evidence('PAK',2023);assert.equal(snapshot.country.iso3,'PAK');
 assert(JSON.stringify(snapshot).includes('Sindh'));
 for(const [name,table] of Object.entries(snapshot.sourceTables)){
  assert.deepEqual(table[0],d[name][0]);
  for(const row of table.slice(1))assert(d[name].some(original=>JSON.stringify(original)===JSON.stringify(row)));
 }
 assert(snapshot.sourceTables['Workforce GDP'].slice(1).every(r=>r[3]===2023));
 const data=await readFile(dataPath);assert.equal(createHash('sha256').update(data).digest('hex'),'43fe38e237cff75b3d30ccd6f6902b1ace125129150f91f58be5f7d9cfcb813f');
});

test('frontend displays setup, private unlock and draft states and escapes agent output',async()=>{
 const d=JSON.parse(await readFile(dataPath,'utf8')),elements={};
 const ctx=vm.createContext({URL,console,setTimeout,clearTimeout,fetch:()=>new Promise(()=>{}),document:{getElementById:id=>elements[id]??={innerHTML:'',classList:{toggle(){}}},querySelectorAll:()=>[]}});
 vm.runInContext(await readFile(new URL('./public/outreach-ui.js',import.meta.url),'utf8'),ctx);
 vm.runInContext(await readFile(new URL('./public/agent-ui.js',import.meta.url),'utf8'),ctx);
 vm.runInContext(await readFile(new URL('./public/app.js',import.meta.url),'utf8'),ctx);ctx.input=d;vm.runInContext("D=input;tab='agent';agentState.workspace='ask';agentState.connection={configured:false,publicQuestions:true};render()",ctx);
 assert.match(elements.content.innerHTML,/no access code required/);assert.doesNotMatch(elements.content.innerHTML,/Workspace access code/);
 vm.runInContext('agentState.connection={configured:true,accessConfigured:true,authenticated:false,publicQuestions:true};render()',ctx);assert.match(elements.content.innerHTML,/no access code required/);
 vm.runInContext("agentState.connection={configured:true,accessConfigured:true,authenticated:true};agentState.mode='frontier';render()",ctx);assert.match(elements.content.innerHTML,/Ask SIYA/);assert.match(elements.content.innerHTML,/Your prompt/);assert.doesNotMatch(elements.content.innerHTML,/Groq/);
 const html=vm.runInContext('agentOutputHtml(\'<script>alert(1)</script> [bad](https://user:secret@example.com) [Source](https://unicef.org/report)\')',ctx);
 assert(!html.includes('<script>'));assert(!html.includes('href="https://user:'));assert(html.includes('href="https://unicef.org/report"'));
 vm.runInContext("group='Western comparison';tab='agent';countrySelect()",ctx);
 assert.equal((elements.country.innerHTML.match(/<option /g)||[]).length,d.Coverage.length-1);
 assert.equal(vm.runInContext('storySignpost()',ctx),'');assert.equal(vm.runInContext('storyNext()',ctx),'');
 vm.runInContext("tab='learning';countrySelect()",ctx);
 assert.equal((elements.country.innerHTML.match(/<option /g)||[]).length,d.Coverage.slice(1).filter(r=>r[0]==='Western comparison').length);
 assert.match(vm.runInContext('storySignpost()',ctx),/From support to learning/);

});

test('HTTP routes enforce origin and owner access while keeping public dashboard available',async()=>{
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:'0',GROQ_API_KEY:'',OPENAI_API_KEY:'',AGENT_ACCESS_CODE:'',DATABASE_URL:''},stdio:['ignore','pipe','pipe']});
 try{
  const [output]=await once(child.stdout,'data');const port=String(output).match(/port (\d+)/)?.[1];assert(port,'server reports assigned test port');
  const base='http://127.0.0.1:'+port;
  assert.equal((await fetch(base+'/api/health')).status,200);
  const status=await (await fetch(base+'/api/agent/status')).json();assert.equal(status.configured,false);
  assert.equal((await fetch(base+'/api/agent/tasks')).status,401);
  const forget='/api/agent/conversations/00000000-0000-4000-8000-000000000000/forget';
  assert.equal((await fetch(base+forget,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(base+forget,{method:'POST',headers:{Origin:'https://example.org','Content-Type':'application/json'},body:'{}'})).status,403);
  const outreachStatus=await (await fetch(base+'/api/agent/outreach/status')).json();assert.equal(outreachStatus.storageConfigured,false);assert(!('ownerEmail' in outreachStatus));
  assert.equal((await fetch(base+'/api/agent/outreach/drafts')).status,401);
  assert.equal((await fetch(base+'/api/agent/outreach/questions')).status,503);
  const directory=await (await fetch(base+'/api/agent/outreach/authorities')).json();assert.equal(directory.countries.length,28);assert.doesNotMatch(JSON.stringify(directory),/@|email|source/);
  assert.equal((await fetch(base+'/api/agent/outreach/authority-directory')).status,401);
  for(const route of ['/authority-directory.json','/authorities.mjs','/dialogue.mjs'])assert.equal((await fetch(base+route)).status,404);
  assert.equal((await fetch(base+'/api/agent/dialogue')).status,410);
  const retiredPost=await fetch(base+'/api/agent/dialogue',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({message:'Must not be collected',country:'IND'})});assert.equal(retiredPost.status,410);assert.match((await retiredPost.json()).error,/does not accept incident reports/);
  assert.equal((await fetch(base+'/api/agent/dialogue/00000000-0000-4000-8000-000000000000/hide',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'})).status,410);
  assert.equal((await fetch(base+'/api/agent/outreach/questions',{method:'POST',headers:{Origin:'https://elsewhere.example','Content-Type':'application/json'},body:JSON.stringify({question:'Question'})})).status,403);
  assert.equal((await fetch(base+'/api/agent/outreach/drafts/00000000-0000-4000-8000-000000000000/close',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(base+'/api/agent/outreach/invitations',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(base+'/api/agent/outreach/mail/connect',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(base+'/api/agent/outreach/mail/callback?state=bad&code=bad')).status,410);
  assert.equal((await fetch(base+'/submit-draft.html')).status,200);
  for(const route of ['/admin','/admin/']){const page=await fetch(base+route);assert.equal(page.status,200);const html=await page.text();assert.match(html,/Admin mail settings/);assert.match(html,/src="\/admin.js/);assert(!html.includes('src="app.js'));assert(!html.includes('Story chapters'))}
  assert.equal((await fetch(base+'/api/agent/unlock',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/agent/unlock',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'})).status,503);
  assert.equal((await fetch(base+'/agent-ui.js')).status,200);assert.equal((await fetch(base+'/agent.mjs')).status,404);
  assert.equal((await fetch(base+'/%2eenv')).status,403);
 }finally{child.kill('SIGTERM');await once(child,'exit')}
});
