import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// Recreate the rendered controls so handlers run against the same replacement
// behaviour as the dashboard's innerHTML renderer. All API responses are synthetic.
async function ui(fetchImpl,{admin=false,portal=false}={}){
 let elements=[],html='',renders=0,focused=null;
 const calls=[],document={getElementById:id=>elements.find(e=>e.id===id)||null,querySelectorAll:selector=>{const attr=selector.match(/^\[([^\]]+)\]$/)?.[1];return attr?elements.filter(e=>attr in e.attrs):[]}};
 const ctx=vm.createContext({...(typeof portal!=='undefined'&&portal?{location:{origin:"https://cafeco09.github.io"}}:{}),URL,AbortSignal,setTimeout,clearTimeout,document,console,navigator:{},fetch:async(path,init)=>{calls.push({path,init});return path==='/api/agent/outreach/authorities'?json({countries:[{code:'IND',name:'India'},{code:'JPN',name:'Japan'}],authorities:[{id:'ind-education',country:'IND',name:'Education authority',category:'Education'},{id:'jpn-education',country:'JPN',name:'Japanese education authority',category:'Education'}]}):fetchImpl(path,init)}});
 vm.runInContext(`let tab='agent',country='IND',year=2023;const $=id=>document.getElementById(id),name=()=> 'India',esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const options=(list,value)=>list.map(([v,l])=>'<option>'+esc(l)+'</option>').join('');`,ctx);
 for(const file of ['outreach-ui.js','dialogue-ui.js','agent-ui.js'])vm.runInContext(await readFile(new URL('./public/'+file,import.meta.url),'utf8'),ctx);
 const run=code=>vm.runInContext(code,ctx);
 ctx.render=()=>{
  if(++renders>50)throw Error('Repeated UI render loop');
  html=run(admin?'outreachAdminView()':'agentView()');elements=[];
  for(const match of html.matchAll(/<\w+\b([^>]*)>/g)){
   const attrs=Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]])),dataset={};
   for(const [key,value]of Object.entries(attrs))if(key.startsWith('data-'))dataset[key.slice(5).replace(/-([a-z])/g,(_,s)=>s.toUpperCase())]=value;
   elements.push({id:attrs.id,attrs,dataset,value:attrs.value||'',checked:false,focus(){focused=this.id},scrollIntoView(){}});
  }
  run(admin?'bindOutreachAdminUI()':'bindAgentUI()');
 };
 run("agentState.workspace='outreach';agentState.connection={configured:true,keyConfigured:true,accessConfigured:true,authenticated:true};agentState.checkedAt=Date.now();outreachState.loaded=true;outreachState.connection={storageConfigured:true,mailConfigured:false,mailConnected:false}");
 return {run,render:ctx.render,calls,get html(){return html},get renders(){return renders},get focused(){return focused},el:id=>document.getElementById(id),workspace:id=>elements.find(e=>e.dataset.agentWorkspace===id),choice:index=>elements.find(e=>e.dataset.agentChoice===String(index)),flush:async()=>{await new Promise(setImmediate);await new Promise(setImmediate)}};
}
const json=data=>({ok:true,json:async()=>data});
const status={storageConfigured:true,mailConfigured:false,mailConnected:false};
const owner={configured:true,keyConfigured:true,accessConfigured:true,authenticated:true};

test('country selection filters authorities and changing country clears the chosen authority',async()=>{
 const s=await ui(()=>json({questions:[]}));s.run('agentState.connection.authenticated=false');s.render();await s.flush();
 s.el('outreach-country').onchange({target:{value:'IND'}});
 assert.match(s.html,/Education authority · Education/);assert.doesNotMatch(s.html,/Japanese education authority/);
 s.el('outreach-authority').onchange({target:{value:'ind-education'}});
 s.el('outreach-country').onchange({target:{value:'JPN'}});
 assert.equal(s.run('outreachPublic.authorityId'),'');assert.match(s.html,/Japanese education authority/);
 assert.match(s.html,/Submit for admin approval/);assert.match(s.html,/recipient email is filled for admin review and kept private/);
 assert.doesNotMatch(s.html,/@|id="outreach-to"/);
});

test('the maroon International Dialogue tab sits between outreach and exploration',async()=>{
 const s=await ui(path=>json(path==='/api/agent/dialogue'?{topics:[]}:{questions:[]}));
 s.run('agentState.connection.authenticated=false');s.render();await s.flush();
 assert(s.html.indexOf('data-agent-workspace="outreach"')<s.html.indexOf('data-agent-workspace="dialogue"'));
 assert(s.html.indexOf('data-agent-workspace="dialogue"')<s.html.indexOf('data-agent-workspace="ask"'));
 assert.match(s.workspace('dialogue').attrs.class,/international-dialogue-tab/);
 s.workspace('dialogue').onclick();await s.flush();assert.match(s.html,/Number awaiting activation/);assert.match(s.html,/Local emergency centre and local authority/);
 assert.equal(s.workspace('dialogue').attrs['aria-pressed'],'true');assert.doesNotMatch(s.html,/Hide discussion|Submit for admin approval/);
 assert.match(await readFile(new URL('./public/style.css',import.meta.url),'utf8'),/international-dialogue-tab\[aria-pressed\][^{]*\{[^}]*#501526/);
});

test('safety line remains an inactive proposal and collects no incident or location data',async()=>{
 const s=await ui(()=>{throw Error('The proposal must not make API calls')});
 s.run("agentState.workspace='dialogue';agentState.connection.authenticated=false");s.render();await s.flush();
 assert.equal(s.calls.length,0);assert.match(s.html,/not operational/);assert.match(s.html,/Frontier analyses the evidence/);assert.match(s.html,/Frontier tracks the response/);
 assert.match(s.html,/Emergency handover must not wait/);assert.match(s.html,/Each handover needs its own acknowledgement/);
 assert.match(s.html,/<input id="international-number"[^>]*disabled/);assert.match(s.html,/<button disabled>Calling not available/);
 assert.doesNotMatch(s.html,/<form|<textarea|href="tel:|Post publicly|Community discussions|data-dialogue-hide/);
});

test('consultation prepares an editable outreach question without sending, activating or making a report',async()=>{
 const s=await ui(()=>json({questions:[]}));s.run("agentState.workspace='dialogue';agentState.connection.authenticated=false;outreachPublic.loaded=true");s.render();
 s.el('dialogue-prepare-outreach').onclick();await s.flush();
 assert.equal(s.run('agentState.workspace'),'outreach');assert.match(s.run('outreachPublic.question'),/views on a proposed international safety reporting telephone line/);
 assert.match(s.run('outreachPublic.question'),/local emergency centre and local authority/);assert.match(s.run('outreachPublic.question'),/evidence analysis and track acknowledgements/);
 assert.equal(s.calls.filter(c=>c.init?.method==='POST').length,0);assert(!s.run('outreachPublic.authorityId'));assert.match(s.html,/Submit for admin approval/);
});

test('admin consultation preparation opens the outbox with an unsent editable draft',async()=>{
 const s=await ui(()=>{throw Error('No request expected')},{admin:true});s.run("outreachState.adminPage='dialogue'");s.render();
 s.el('dialogue-prepare-outreach').onclick();assert.equal(s.run('outreachState.adminPage'),'outbox');assert.equal(s.run('outreachState.compose.to'),'');
 assert.match(s.run('outreachState.compose.body'),/no telephone line or emergency routing is currently active/);assert.equal(s.calls.length,0);
});

test('public outreach shows only escaped questions and stages, with no private queue or mail controls',async()=>{
 const s=await ui(()=>json({questions:[{question:'<script>Which sources?</script>',stage:'Awaiting approval',to:'PRIVATE-ADDRESS',body:'PRIVATE-EMAIL',replyBody:'PRIVATE-REPLY'}]}));
 s.run('agentState.connection.authenticated=false');s.render();await s.flush();
 assert.match(s.html,/&lt;script&gt;Which sources\?&lt;\/script&gt;/);assert.match(s.html,/Awaiting approval/);
 assert.doesNotMatch(s.html,/<script>|PRIVATE-ADDRESS|PRIVATE-EMAIL|PRIVATE-REPLY/);
 assert(!s.el('outreach-send'));assert(!s.el('outreach-to'));assert(!s.el('agent-access-code'));
});

test('public question submission sends only the editable question and requires no owner sign-in',async()=>{
 let submitted=false;const s=await ui((path,init)=>{assert.equal(path,'/api/agent/outreach/questions');if(init?.method==='POST'){assert.deepEqual(JSON.parse(init.body),{question:'Which records are missing?',country:'IND',authorityId:'ind-education'});submitted=true;return json({submitted:true,stage:'Awaiting approval'})}return json({questions:submitted?[{question:'Which records are missing?',stage:'Awaiting approval'}]:[]})});
 s.run('agentState.connection.authenticated=false');s.render();await s.flush();
 s.el('outreach-country').onchange({target:{value:'IND'}});s.el('outreach-authority').onchange({target:{value:'ind-education'}});s.el('outreach-public-question').oninput({target:{value:'Which records are missing?'}});
 await s.el('outreach-public-submit').onsubmit({preventDefault(){}});assert(submitted);assert.match(s.html,/No email has been sent/);assert.match(s.html,/Awaiting approval/);assert.equal(s.run('outreachPublic.question'),'');
});

test('exploration can prepare a public outreach question without publishing an answer or sending an email',async()=>{
 const s=await ui(()=>json({questions:[]}));s.run(`agentState.connection.authenticated=false;agentState.workspace='ask';outreachPublic.loaded=true;agentState.conversation={id:'explore',engine:'frontier-v1',turns:[{prompt:'Which reading records are missing in Japan?',result:{kind:'answer',message:'Exploratory answer'}}]};agentState.task={status:'completed',output:'Exploratory answer'};`);
 s.render();s.el('agent-use-draft').onclick();assert.equal(s.run('agentState.workspace'),'outreach');assert.equal(s.run('outreachPublic.question'),'Which reading records are missing in Japan?');assert.equal(s.calls.filter(c=>c.init?.method==='POST').length,0);
 assert.doesNotMatch(s.html,/Exploratory answer/);assert.match(s.html,/Submit for admin approval/);
});

test('inline clarification reply posts in the same conversation and prevents duplicate sends',async()=>{
 const s=await ui(()=>json({id:'reply-run',conversation:{id:'same-conversation',engine:'frontier-v1',country:'JPN+KOR',turns:[]}}));
 s.run(`agentState.workspace='ask';agentState.conversation={id:'same-conversation',engine:'frontier-v1',country:'JPN+KOR',turns:[{prompt:'Compare education',result:{kind:'clarification',message:'Which outcome?'}},{prompt:'Which age?',result:{kind:'clarification',message:'Which population?'}}]}`);
 s.render();assert.equal((s.html.match(/id="agent-reply-form"/g)||[]).length,1);
 assert.match(s.html,/Your reply/);assert.match(s.html,/Send reply/);
 s.el('agent-reply').oninput({target:{value:'Reading for girls aged 15 in 2022'}});
 await s.el('agent-reply-form').onsubmit({preventDefault(){}});
 const request=JSON.parse(s.calls[0].init.body);assert.equal(request.conversationId,'same-conversation');assert.equal(request.prompt,'Reading for girls aged 15 in 2022');assert.equal(request.scope,'question');
 await s.run("submitAgentQuestion('duplicate',{reply:true})");assert.equal(s.calls.length,1);assert.equal(s.run('agentState.reply'),'');s.run('clearTimeout(agentState.pollTimer)');
});

test('new prompts immediately replace the visible answer while keeping follow-up context',async()=>{
 let resolvePost;
 const history={id:'kept-context',engine:'frontier-v1',country:'JPN',turns:[{prompt:'Old question',result:{kind:'answer',message:'Old answer',references:[]}},
  {prompt:'Previous question',result:{kind:'answer',message:'Previous answer',references:[]}}]};
 const completed={...history,turns:[...history.turns,{prompt:'New question',result:{kind:'answer',message:'New answer',references:[]}}]};
 const s=await ui(path=>path==='/api/agent/tasks'?new Promise(resolve=>{resolvePost=resolve}):json({id:'new-run',status:'completed',mode:'frontier',cleanup:'Frontier process completed',conversation:completed}));
 s.run(`agentState.workspace='ask';agentState.conversation=${JSON.stringify(history)}`);s.render();
 assert.match(s.html,/Previous answer/);assert.doesNotMatch(s.html,/Old answer|Old question/);
 const pending=s.run("submitAgentQuestion('New question')");
 assert.match(s.html,/Preparing your new answer/);assert.match(s.html,/New question/);assert.doesNotMatch(s.html,/Previous answer|Previous question|Old answer/);
 assert.equal(JSON.parse(s.calls[0].init.body).conversationId,'kept-context');assert.equal(s.run('agentState.conversation.turns.length'),2);
 resolvePost(json({id:'new-run',conversation:history}));await pending;
 assert.doesNotMatch(s.html,/Previous answer/);s.run('clearTimeout(agentState.pollTimer)');await s.run('pollAgentRun()');
 assert.match(s.html,/New answer/);assert.doesNotMatch(s.html,/Old answer|Previous answer|Preparing your new answer/);
 assert.equal((s.html.match(/class="agent-dialogue-turn"/g)||[]).length,1);assert.equal(s.run('agentState.conversation.turns.length'),3);
});

test('failed prompts and clarification replies do not restore an older answer',async()=>{
 const s=await ui(()=>({ok:false,status:503,json:async()=>({error:'Try again'})}));
 s.run(`agentState.workspace='ask';agentState.conversation={id:'reply-context',engine:'frontier-v1',country:'JPN',turns:[{prompt:'Previous question',result:{kind:'clarification',message:'Previous clarification'}}]}`);s.render();
 await s.run("submitAgentQuestion('New reply',{reply:true})");
 assert.match(s.html,/No new answer was produced/);assert.doesNotMatch(s.html,/Previous clarification|Previous question/);
 assert.equal(s.run('agentState.prompt'),'New reply');assert.equal(s.run('agentState.conversation.id'),'reply-context');
});

test('clarification options populate an editable reply without sending or losing the country pair',async()=>{
 const s=await ui(()=>json({id:'choice-run',conversation:{id:'same-conversation',engine:'frontier-v1',country:'JPN+KOR',turns:[]}}));
 s.run(`agentState.workspace='ask';agentState.conversation={id:'same-conversation',engine:'frontier-v1',country:'JPN+KOR',turns:[{prompt:'Compare violence alongside workforce. Include source years.',result:{kind:'clarification',message:'Which comparison?',frontier:{clarification:{kind:'comparison_selection',question:'Which comparison?',allow_free_text:true,options:[{id:'work',label:'Compare workforce participation',reply:'Compare workforce participation for women in Japan and South Korea in 2025.'},{id:'both',label:'Show both as separate country profiles',reply:'Compare intimate partner violence alongside workforce participation for women in Japan and South Korea.'}]}}}}]}`);
 s.render();assert.match(s.html,/Choose a suggested reply/);assert.match(s.html,/Show both as separate country profiles/);assert.doesNotMatch(s.html,/data-agent-followup/);
 s.choice(0).onclick();assert.equal(s.calls.length,0);assert.equal(s.focused,'agent-reply');assert.match(s.el('agent-reply').value||s.html,/Compare workforce participation/);
 assert.equal(s.run('agentState.conversation.id'),'same-conversation');
 s.el('agent-reply').oninput({target:{value:'Compare workforce participation for women in Japan and South Korea in 2023.'}});
 await s.el('agent-reply-form').onsubmit({preventDefault(){}});
 const request=JSON.parse(s.calls[0].init.body);assert.equal(request.conversationId,'same-conversation');assert.match(request.prompt,/2023/);s.run('clearTimeout(agentState.pollTimer)');
});

test('clarification options are escaped, disabled during a run, and absent after an answer',async()=>{
 const s=await ui(()=>json({}));
 s.run(`agentState.workspace='ask';agentState.conversation={id:'safe',engine:'frontier-v1',country:'JPN+KOR',turns:[{prompt:'Compare',result:{kind:'clarification',message:'Choose',frontier:{clarification:{question:'<script>choice</script>',options:[{id:'safe',label:'<img src=x>',reply:'<script>reply</script>'}]}}}}]}`);
 s.render();assert.match(s.html,/&lt;script&gt;choice/);assert.match(s.html,/&lt;img src=x&gt;/);assert.doesNotMatch(s.html,/<script>|<img/);
 s.run('agentState.busy=true');s.render();assert.match(s.html,/data-agent-choice="0" disabled/);s.choice(0).onclick();assert.equal(s.run('agentState.reply'),'');
 s.run("agentState.busy=false;agentState.conversation.turns[0].result.kind='answer'");s.render();assert(!s.choice(0));
});

test('inline reply retains an escaped draft on failure and disappears after an answer',async()=>{
 const s=await ui(()=>({ok:false,status:503,json:async()=>({error:'Temporarily unavailable'})}));
 s.run(`agentState.workspace='ask';agentState.conversation={id:'retry',engine:'frontier-v1',country:'JPN',turns:[{prompt:'Question',result:{kind:'clarification',message:'Which measure?'}}]};agentState.reply='<script>draft</script>'`);
 s.render();assert.match(s.html,/&lt;script&gt;draft&lt;\/script&gt;/);assert.doesNotMatch(s.html,/<script>/);
 await s.el('agent-reply-form').onsubmit({preventDefault(){}});assert.equal(s.run('agentState.reply'),'<script>draft</script>');assert.equal(s.run('agentState.busy'),false);
 s.run("agentState.conversation.turns[0].result.kind='answer'");s.render();assert(!s.el('agent-reply-form'));
});

test('contextual comparison display and follow-up preserve both measures and the resolved country pair',async()=>{
 const s=await ui(()=>json({}));
 s.run(`let D={Coverage:[[],['Primary','JPN','Japan'],['Primary','KOR','South Korea']]};agentState.workspace='ask';agentState.conversation={engine:'frontier-v1',country:'JPN+KOR',turns:[{prompt:"Compare Japan's and South Koreas home based violence figures wrt workforce",result:{kind:'unresolved',message:'Source profiles',frontier:{epistemic_status:'RELATED_PROFILES_PARTIAL',interpretation:{frames:[{operation:'contrast',topic:'violence',related_dimensions:[{label:'home based violence'},{label:'workforce'}]}]},original_components_used:[],new_interfaces:[]}}}]}`);
 assert.equal(s.run('agentNextQuestions()[0].prompt'),'sources');
 assert.match(s.run('agentNextQuestions()[0].label'),/both measures in Japan and South Korea/);
 s.render();assert.match(s.html,/home based violence alongside workforce/);
 s.run("agentState.conversation.turns[0].result.frontier.interpretation.frames[0].operation='sources'");
 assert.equal(s.run('agentNextQuestions().length'),0);
});

test('collection details distinguish incomplete evidence and escape child results',async()=>{
 const s=await ui(()=>json({}));
 const html=s.run(`agentCollectionHtml({version:'frontier-evidence-collection-1',complete:false,packet_count:3,conflict_count:1,tasks:[{id:'<child>',status:'invalid_evidence',packet_count:0}],quarantined_sources:['source']})`);
 assert.match(html,/Collection is incomplete/);assert.match(html,/3 source records were merged before interpreting/);
 assert.match(html,/Conflicting observation groups: 1/);assert.match(html,/&lt;child&gt;/);assert.doesNotMatch(html,/<child>/);
 assert.match(html,/same source identifier were excluded/);assert.match(html,/do not search the web/);
 assert.equal(s.run('agentCollectionHtml(null)'),'');
});

test('outreach is public and exploration remains a separate workspace',async()=>{
 const s=await ui(()=>json({questions:[]}));s.run('agentState.connection.authenticated=false');s.render();
 assert.match(s.html,/Submit for admin approval/);assert(!s.el('agent-access-code'));assert(!s.el('outreach-to'));
 s.workspace('ask').onclick();assert.match(s.html,/Explore with SIYA/);assert.equal(s.workspace('ask').attrs['aria-pressed'],'true');
 s.workspace('outreach').onclick();assert.match(s.html,/Questions &amp; tracking|Questions & tracking/);assert.equal(s.workspace('outreach').attrs['aria-pressed'],'true');await s.flush();
});

test('failed initial outbox load stops after one request and can be retried',async()=>{
 let fail=true;const s=await ui(path=>{if(fail)throw Error('offline');return json(path.endsWith('/status')?status:{drafts:[],invitations:[]})});
 s.run('outreachState.loaded=false;outreachState.connection=null');s.render();assert.match(s.html,/Loading your drafts/);await s.flush();
 assert.equal(s.calls.length,1);assert.match(s.html,/Could not reach the workspace/);assert.match(s.html,/Retry loading outbox/);
 const renders=s.renders;await s.flush();assert.equal(s.renders,renders);
 fail=false;await s.el('outreach-refresh').onclick();assert.equal(s.calls.length,3);assert.match(s.html,/Save my draft/);assert.equal(s.run('outreachState.loading'),false);
});

test('draft queue load failure preserves an explicit error without a refresh loop',async()=>{
 const s=await ui(path=>path.endsWith('/status')?json(status):Promise.reject(Error('database unavailable')));
 s.run('outreachState.loaded=false');s.render();await s.flush();assert.equal(s.calls.length,2);assert.match(s.html,/Could not reach the workspace/);
 s.workspace('ask').onclick();s.workspace('outreach').onclick();await s.flush();assert.equal(s.calls.length,2);assert.match(s.html,/Refresh outreach/);
});

test('initial workspace connection failure stays visible until the user retries',async()=>{
 let fail=true;const s=await ui(()=>{if(fail)throw Error('offline');return json({...owner,authenticated:false})},{admin:true});
 s.run('agentState.connection=null');s.render();await s.flush();assert.equal(s.calls.length,1);assert.match(s.html,/Workspace connection interrupted/);assert.doesNotMatch(s.html,/API-key setting is missing/);
 fail=false;await s.el('agent-refresh').onclick();assert.equal(s.calls.length,2);assert.match(s.html,/Admin sign-in/);
});

test('unlock immediately shows progress and prevents duplicate submissions',async()=>{
 let finish;const gate=new Promise(resolve=>{finish=resolve});
 const s=await ui(async path=>path.endsWith('/unlock')?(await gate,json({ok:true})):json(path==='/api/agent/status'?owner:path.endsWith('/status')?status:{drafts:[],invitations:[]}),{admin:true});
 s.run("outreachState.adminPage='outbox';agentState.connection.authenticated=false");s.render();s.el('agent-access-code').value='synthetic-private-code';
 const pending=s.el('agent-unlock').onsubmit({preventDefault(){}});assert.match(s.html,/Unlocking…/);
 await s.el('agent-unlock').onsubmit({preventDefault(){}});assert.equal(s.calls.length,1);
 finish();await pending;await s.flush();assert.match(s.html,/Save my draft/);assert.doesNotMatch(s.html,/Unlocking…/);
});

test('approval and send preserve the exact review across immediate busy rendering',async()=>{
 const calls=[];const s=await ui((path,init)=>{calls.push(path);return json(path.endsWith('/approve')?{status:'approved'}:path.endsWith('/send')?{status:'sent'}:path.endsWith('/status')?{...status,mailConnected:true}:{drafts:[],invitations:[]})});
 s.run(`outreachState.connection.mailConnected=true;outreachState.drafts=[{id:'synthetic',to:'person@example.org',subject:'Test request',body:'Test message',country:'IND',year:2023,revision:3,status:'pending_approval',author:{kind:'contributor',name:'Test contributor'},history:[]}];outreachState.selected='synthetic'`);s.render();
 await s.el('outreach-approve').onclick();assert.equal(calls.length,0);assert.match(s.html,/tick the review box/);
 s.el('outreach-confirm').checked=true;const pending=s.el('outreach-approve-send').onclick();assert.equal(s.run('outreachState.busy'),true);assert.match(s.html,/<button id="outreach-approve-send" disabled>/);
 await pending;assert.deepEqual(calls.slice(0,2),['/api/agent/outreach/drafts/synthetic/approve','/api/agent/outreach/drafts/synthetic/send']);
 for(const c of s.calls.filter(c=>/\/(approve|send)$/.test(c.path)))assert.deepEqual(JSON.parse(c.init.body),{revision:3,recipientConfirmed:true});
 assert.equal(s.run('outreachState.busy'),false);assert.match(s.html,/The mail provider accepted the message/);
});

test('request timeout gives an actionable error and never retries the action',async()=>{
 const s=await ui(()=>{throw Object.assign(Error('timeout'),{name:'TimeoutError'})});
 await assert.rejects(s.run("agentRequest('/api/agent/outreach/drafts/synthetic/send',{})"),/submitted action may still be processing/);assert.equal(s.calls.length,1);assert(s.calls[0].init.signal);
});

test('incomplete proxy setup opens instructions without making a provider request',async()=>{
 const s=await ui(()=>json({}),{admin:true});s.run('outreachState.connection.setup={apiKey:false,ownerEmail:true,storage:true}');s.render();
 assert(s.el('outreach-mail-setup'));assert.equal(s.el('outreach-connect'),null);assert.match(s.html,/Proxy mailbox setup is incomplete/);assert.match(s.html,/AgentMail API key/);assert.match(s.html,/Missing or invalid/);
 s.el('outreach-mail-setup').onclick();assert.match(s.html,/<details id="outreach-setup" class="outreach-setup" open>/);assert.equal(s.focused,'outreach-setup-title');assert.equal(s.calls.length,0);assert.match(s.html,/AGENTMAIL_API_KEY/);assert.doesNotMatch(s.html,/GOOGLE_CLIENT_SECRET|OAuth|Gmail/);
});

test('completed setup exposes create, reconnect and pause actions as appropriate',async()=>{
 const s=await ui(()=>json({}),{admin:true});s.run('outreachState.connection.mailConfigured=true');s.render();assert(s.el('outreach-connect'));assert.match(s.html,/Create dashboard mailbox/);assert.equal(s.el('outreach-mail-setup'),null);
 s.run('outreachState.connection.hasMailbox=true');s.render();assert.match(s.html,/Reconnect mailbox/);
 s.run("outreachState.connection.mailConnected=true;outreachState.connection.mailbox='dashboard@agentmail.to'");s.render();assert(s.el('outreach-disconnect'));assert.equal(s.el('outreach-connect'),null);assert.match(s.html,/dashboard@agentmail.to/);assert.match(s.html,/Pause mailbox/);
});

test('mailbox setup controls stay off the main dashboard; locked views contain no private metadata',async()=>{
 const s=await ui(()=>json({}));s.render();assert.equal(s.el('outreach-connect'),null);assert.equal(s.el('outreach-mail-setup'),null);assert.match(s.html,/href="\/admin"/);assert.doesNotMatch(s.html,/AGENTMAIL_API_KEY|Finish proxy mailbox setup/);
 s.run("outreachState.connection.mailConfigured=true;outreachState.connection.mailbox='private-mailbox@agentmail.to';outreachState.drafts=[{id:'test',to:'private-recipient@example.org',subject:'PRIVATE-SUBJECT',body:'PRIVATE-MESSAGE',author:{kind:'owner'},status:'replied'}]");s.render();assert.equal(s.el('outreach-connect'),null);assert.doesNotMatch(s.html,/private-mailbox/);
 s.run('agentState.connection.authenticated=false');s.render();assert.doesNotMatch(s.html,/href="\/admin"|private-recipient|private-mailbox|PRIVATE-SUBJECT|PRIVATE-MESSAGE|AGENTMAIL/);
});

test('admin mail controls stay hidden until the admin workspace is unlocked',async()=>{
 const s=await ui(()=>json({}),{admin:true});s.run('agentState.connection.authenticated=false');s.render();assert.match(s.html,/Admin sign-in/);assert.equal(s.el('outreach-connect'),null);assert.equal(s.el('outreach-mail-setup'),null);assert.doesNotMatch(s.html,/AGENTMAIL_API_KEY|Open AgentMail console/);
 s.run('agentState.connection.authenticated=true');s.render();assert.match(s.html,/Admin workspace unlocked/);assert(s.el('outreach-mail-setup'));
});

test('admin mailbox creation stays on the settings page and never loads the draft queue',async()=>{
 const s=await ui(path=>json(path.endsWith('/connect')?{connected:true,mailbox:'dashboard@agentmail.to'}:{...status,mailConfigured:true,mailConnected:true,mailbox:'dashboard@agentmail.to'}),{admin:true});s.run('outreachState.connection.mailConfigured=true');s.render();await s.el('outreach-connect').onclick();
 assert.deepEqual(s.calls.map(c=>c.path),['/api/agent/outreach/mail/connect','/api/agent/outreach/status']);assert.deepEqual(JSON.parse(s.calls[0].init.body),{});assert.match(s.html,/No email has been sent/);assert.match(s.html,/Pause mailbox/);assert.doesNotMatch(s.html,/accounts.google.com/);
});

test('reply tracking detail shows statuses and timestamps without rendering incoming payload fields',async()=>{
 const s=await ui(()=>json({}));s.run(`outreachState.drafts=[{id:'test',to:'recipient@example.org',subject:'Outgoing subject',body:'Outgoing message',country:'IND',year:2023,revision:1,status:'replied',author:{kind:'owner',name:'Owner'},history:[],repliedAt:100000,lastCheckedAt:100000,replyBody:'PRIVATE-REPLY-CANARY',preview:'PRIVATE-REPLY-CANARY',reply:{text:'PRIVATE-REPLY-CANARY'}}];outreachState.selected='test'`);s.render();assert.match(s.html,/Reply received/);assert.match(s.html,/Tracking shows statuses and timestamps only/);assert.doesNotMatch(s.html,/PRIVATE-REPLY-CANARY/);
});

test('admin sign-in loads only mailbox settings and locking removes them',async()=>{
 let authenticated=false;const s=await ui(path=>{if(path.endsWith('/unlock'))authenticated=true;if(path.endsWith('/lock'))authenticated=false;return json(path==='/api/agent/status'?{...owner,authenticated}:path.endsWith('/outreach/status')?status:{ok:true})},{admin:true});
 s.run('agentState.connection.authenticated=false;outreachState.connection=null;outreachState.loaded=false');s.render();s.el('agent-access-code').value='synthetic-admin-access';await s.el('agent-unlock').onsubmit({preventDefault(){}});await s.flush();
 assert(s.el('outreach-mail-setup'));assert.equal(s.calls.filter(c=>c.path==='/api/agent/outreach/status').length,1);assert(!s.calls.some(c=>c.path.endsWith('/drafts')));
 await s.el('agent-lock').onclick();assert.match(s.html,/Admin sign-in/);assert.equal(s.el('outreach-mail-setup'),null);assert.equal(s.run('outreachState.connection'),null);
});

test('standalone admin page boots without dashboard data or main-page bindings',async()=>{
 const content={innerHTML:''},calls=[];const ctx=vm.createContext({...(typeof portal!=='undefined'&&portal?{location:{origin:"https://cafeco09.github.io"}}:{}),URL,AbortSignal,setTimeout,clearTimeout,console,document:{getElementById:id=>id==='admin-content'?content:null,querySelectorAll:()=>[]},fetch:async path=>{calls.push(path);return json({...owner,authenticated:false})}});
 for(const file of ['outreach-ui.js','dialogue-ui.js','agent-ui.js','admin.js'])vm.runInContext(await readFile(new URL('./public/'+file,import.meta.url),'utf8'),ctx);
 await new Promise(setImmediate);assert.match(content.innerHTML,/Admin sign-in/);assert.deepEqual(calls,['/api/agent/status']);assert.doesNotMatch(content.innerHTML,/Set up proxy mailbox|Create dashboard mailbox/);
});

test('standalone unlocked outbox finishes loading and renders country-scoped drafts without app.js',async()=>{
 const content={innerHTML:''},calls=[];
 const draft={id:'example-draft',status:'pending_approval',subject:'<draft subject>',to:'authority@example.org',body:'Example question',country:'IRN',year:2023,revision:1,author:{kind:'contributor',name:'Example author'},history:[]};
 const ctx=vm.createContext({...(typeof portal!=='undefined'&&portal?{location:{origin:"https://cafeco09.github.io"}}:{}),URL,AbortSignal,setTimeout,clearTimeout,console,location:{hash:'#outbox'},document:{getElementById:id=>id==='admin-content'?content:null,querySelectorAll:()=>[]},fetch:async path=>{
  calls.push(path);return json(path==='/api/agent/status'?{...owner}:path==='/api/agent/outreach/status'?{storageConfigured:true,mailConnected:false}:{drafts:[draft],invitations:[]});
 }});
 for(const file of ['outreach-ui.js','dialogue-ui.js','agent-ui.js','admin.js'])vm.runInContext(await readFile(new URL('./public/'+file,import.meta.url),'utf8'),ctx);
 await new Promise(setImmediate);await new Promise(setImmediate);
 assert.deepEqual(calls,['/api/agent/status','/api/agent/outreach/status','/api/agent/outreach/drafts']);
 assert.match(content.innerHTML,/Drafts and approvals/);assert.match(content.innerHTML,/&lt;draft subject&gt;/);assert.match(content.innerHTML,/My drafts/);
 assert.doesNotMatch(content.innerHTML,/Loading your drafts|Admin view unavailable/);
 vm.runInContext("outreachState.selected='example-draft';render()",ctx);
 assert.match(content.innerHTML,/IRN/);assert.match(content.innerHTML,/Approve draft/);assert.doesNotMatch(content.innerHTML,/Admin view unavailable|<draft subject>/);
 assert.equal(vm.runInContext("options([['safe','<label>']],'safe')",ctx),'<option value="safe" selected>&lt;label&gt;</option>');
});

test('standalone outbox exposes load errors with a manual retry instead of staying on Loading',async()=>{
 const elements={'admin-content':{innerHTML:''},'outreach-refresh':{}},calls=[];
 const ctx=vm.createContext({...(typeof portal!=='undefined'&&portal?{location:{origin:"https://cafeco09.github.io"}}:{}),URL,AbortSignal,setTimeout,clearTimeout,console,location:{hash:'#outbox'},document:{getElementById:id=>elements[id]||null,querySelectorAll:()=>[]},fetch:async path=>{
  calls.push(path);return path==='/api/agent/status'?json({...owner}):{ok:false,status:503,json:async()=>({error:'Outreach storage is unavailable.'})};
 }});
 for(const file of ['outreach-ui.js','dialogue-ui.js','agent-ui.js','admin.js'])vm.runInContext(await readFile(new URL('./public/'+file,import.meta.url),'utf8'),ctx);
 await new Promise(setImmediate);await new Promise(setImmediate);
 assert.match(elements['admin-content'].innerHTML,/Outreach storage is unavailable/);assert.match(elements['admin-content'].innerHTML,/Retry loading outbox/);
 assert.doesNotMatch(elements['admin-content'].innerHTML,/Loading your drafts|>Loading…/);assert.equal(calls.length,2);
 await elements['outreach-refresh'].onclick();assert.equal(calls.length,3);
});

test('standalone admin rendering failures produce a reload control without retrying an action',async()=>{
 const elements={'admin-content':{innerHTML:''},'admin-reload':{}},calls=[];
 const ctx=vm.createContext({...(typeof portal!=='undefined'&&portal?{location:{origin:"https://cafeco09.github.io"}}:{}),URL,AbortSignal,setTimeout,clearTimeout,console,location:{hash:'#outbox',reload(){calls.push('reload')}},document:{getElementById:id=>elements[id]||null,querySelectorAll:()=>[]},fetch:async()=>json({...owner,authenticated:false})});
 for(const file of ['outreach-ui.js','dialogue-ui.js','agent-ui.js','admin.js'])vm.runInContext(await readFile(new URL('./public/'+file,import.meta.url),'utf8'),ctx);
 await new Promise(setImmediate);
 vm.runInContext("outreachAdminView=()=>{throw Error('example rendering failure')};render()",ctx);
 assert.match(elements['admin-content'].innerHTML,/Admin view unavailable/);assert.match(elements['admin-content'].innerHTML,/No action will be retried automatically/);assert.equal(calls.length,0);
 elements['admin-reload'].onclick();assert.deepEqual(calls,['reload']);
});

test('conversation displays escaped turns, evidence gaps and exact records for review',async()=>{
 const s=await ui(()=>json({}));s.run(`agentState.workspace='ask';agentState.mode='frontier';agentState.conversation={id:'test',country:'IND',year:2023,turns:[{prompt:'<script>question</script>',result:{kind:'unresolved',message:'<script>answer</script>',limitations:['Missing girls-only data'],coverage:{limited:true,omittedRows:{'PISA learning':2}},historyOmitted:1,references:[{id:'ev_test',table:'Coverage',headers:['Source'],values:['<img src=x>'],sourceUrls:['https://unicef.org/report']}]}}]}`);s.render();
 assert.match(s.html,/SIYA · evidence agent/);assert.match(s.html,/SIYA · experimental · no AI API/);assert.match(s.html,/Unresolved evidence gap/);assert.match(s.html,/Supporting dashboard records/);assert.match(s.html,/PISA learning: 2 record/);assert.match(s.html,/outside the retained conversation context/);assert.doesNotMatch(s.html,/<script>|<img src=x>/);assert.match(s.html,/href="https:\/\/unicef.org\/report"/);
});

test('new conversation deletes server history before clearing the local transcript',async()=>{
 const s=await ui(()=>json({forgotten:true}));s.run(`agentState.workspace='ask';agentState.mode='frontier';agentState.conversation={id:'synthetic-id',country:'IND',year:2023,turns:[]};agentState.prompt='Earlier question'`);s.render();await s.el('agent-new-conversation').onclick();
 assert.equal(s.calls[0].path,'/api/agent/conversations/synthetic-id/forget');assert.equal(s.run('agentState.conversation'),null);assert.equal(s.run('agentState.prompt'),'');assert.equal(s.run('agentState.busy'),false);
});

test('agent questions ignore hidden dashboard country and year filters',async()=>{
 const s=await ui(()=>json({id:'run',conversation:{id:'old',country:'PAK',year:null,engine:'frontier-v1',turns:[]}}));
 s.run("agentState.workspace='ask';agentState.conversation={id:'old',country:'PAK',year:null,engine:'frontier-v1',turns:[]};country='CAN';year=2020;agentState.prompt='What about India?'");s.render();
 assert.doesNotMatch(s.html,/conversation engine changed|evidence profile/);await s.el('agent-request').onsubmit({preventDefault(){}});
 const body=JSON.parse(s.calls[0].init.body);assert.equal(body.scope,'question');assert.equal(body.prompt,'What about India?');assert.equal(body.conversationId,'old');assert(!('country' in body));assert(!('year' in body));s.run('clearTimeout(agentState.pollTimer)');
});

test('locking the owner workspace clears private conversation results and prompts',async()=>{
 const s=await ui(path=>json(path.endsWith('/lock')?{}:{...owner,authenticated:false}));s.run(`agentState.workspace='outreach';agentState.mode='frontier';agentState.conversation={id:'private',country:'IND',year:2023,turns:[{prompt:'PRIVATE-QUESTION',result:{kind:'answer',message:'PRIVATE-ANSWER'}}]};agentState.task={id:'private',output:'PRIVATE-ANSWER'};agentState.prompt='PRIVATE-PROMPT'`);s.render();await s.el('agent-lock').onclick();assert.equal(s.run('agentState.conversation'),null);assert.equal(s.run('agentState.task'),null);assert.equal(s.run('agentState.prompt'),'');assert.doesNotMatch(s.html,/PRIVATE-QUESTION|PRIVATE-ANSWER|PRIVATE-PROMPT/);
});

test('an in-flight poll cannot restore private results after locking',async()=>{
 let finish;const response=new Promise(resolve=>{finish=resolve});const s=await ui(()=>response);
 s.run(`agentState.workspace='ask';agentState.busy=true;agentState.task={id:'private'}`);const pending=s.run('pollAgentRun()');
 s.run('agentState.connection.authenticated=false;agentState.task=null;agentState.conversation=null;agentState.busy=false');
 finish(json({id:'private',status:'completed',output:'PRIVATE-ANSWER',cleanup:'No hosted session',conversation:{turns:[{prompt:'PRIVATE-QUESTION',result:{message:'PRIVATE-ANSWER'}}]}}));await pending;
 assert.equal(s.run('agentState.task'),null);assert.equal(s.run('agentState.conversation'),null);
});

test('Frontier is the default and remains usable with no Groq configuration',async()=>{
 const s=await ui(()=>json({}));s.run("agentState.workspace='ask';agentState.connection.configured=false;agentState.connection.keyConfigured=false");s.render();assert.equal(s.run('agentState.mode'),'frontier');assert.match(s.html,/no access code required/);assert.match(s.html,/SIYA was created to help people/);assert.match(s.html,/href="https:\/\/cafeco09.github.io\/ann-on-ally\/"/);assert.doesNotMatch(s.html,/Groq setup pending/);assert.match(s.html,/How well can girls/);
});

test('Frontier result labels distinguish the experimental runtime from Groq',async()=>{
 const s=await ui(()=>json({}));s.run(`agentState.workspace='ask';agentState.conversation={id:'frontier-v1',engine:'frontier-v1',country:'IND',year:2023,turns:[{prompt:'Show learning evidence',result:{kind:'answer',externalAI:false,message:'Original evidence',references:[]}}]}`);s.render();assert.match(s.html,/SIYA · experimental · no AI API/);assert.doesNotMatch(s.html,/Groq|Model-generated/);
});

test('public answers hide diagnostics even for a cached full result, while admins retain them',async()=>{
 const s=await ui(()=>json({}));
 s.run(`agentState.workspace='ask';agentState.conversation={id:'display',engine:'frontier-v1',country:'IND',turns:[{prompt:'Question',result:{kind:'answer',message:'Readable answer',limitations:['V4 controller with guarded dashboard adapters','Aggregate differences do not identify causes.'],references:[{id:'ev_private',table:'Published evidence',headers:['Internal row'],values:['ROW_DATA'],sourceUrls:[]}],frontier:{version:'PRIVATE_RUNTIME',epistemic_status:'SOURCE_REPORTED',new_interfaces:[],original_components_used:[],v4:{operator:'lookup',selected_task:'lookup',collection:{packet_count:5,complete:true},version:'PRIVATE_VERSION'}}}}]}`);
 s.run('agentState.connection.authenticated=false;agentState.connection.publicQuestions=true');s.render();
 assert.match(s.html,/Readable answer/);assert.match(s.html,/Sources: Published evidence/);assert.match(s.html,/Aggregate differences do not identify causes/);
 assert.doesNotMatch(s.html,/V4 task and answer checks|PRIVATE_RUNTIME|PRIVATE_VERSION|About this experimental runtime|Claim status|ROW_DATA|ev_private|Evidence-linked answer/);
 s.run('agentState.connection.authenticated=true');s.render();assert.match(s.html,/V4 task and answer checks/);assert.match(s.html,/PRIVATE_RUNTIME|PRIVATE_VERSION/);assert.match(s.html,/Supporting dashboard records/);
});

test('public reply choices work without exposing the frontier diagnostic object',async()=>{
 const s=await ui(()=>json({}));s.run(`agentState.workspace='ask';agentState.connection.authenticated=false;agentState.connection.publicQuestions=true;agentState.conversation={id:'public-choice',engine:'frontier-v1',country:'JPN+KOR',turns:[{prompt:'Compare',result:{publicDisplay:true,kind:'clarification',message:'Choose',suggestedReplies:[],clarification:{question:'Which measure?',options:[{id:'reading',label:'Reading',reply:'Compare reading in Japan and South Korea.'}]}}}]}`);
 s.render();s.choice(0).onclick();assert.equal(s.run('agentState.reply'),'Compare reading in Japan and South Korea.');assert.equal(s.calls.length,0);
});

test('ending an admin session clears cached diagnostics while public questions remain available',async()=>{
 const s=await ui(()=>json({publicQuestions:true,authenticated:false,accessConfigured:true}));
 s.run(`agentState.workspace='ask';agentState.conversation={id:'admin-result',engine:'frontier-v1',turns:[{prompt:'Prior question',result:{kind:'answer',message:'Prior answer',frontier:{memory:{privateTrace:'PRIVATE_TRACE'}}}}]};agentState.task={id:'admin-result'};agentState.answerPending=true;agentState.activePrompt='Prior question'`);
 await s.run('refreshAgentStatus()');assert.equal(s.run('agentState.conversation'),null);assert.equal(s.run('agentState.task'),null);assert.equal(s.run('agentState.answerPending'),false);
 assert.doesNotMatch(s.html,/PRIVATE_TRACE|Prior answer/);assert.match(s.html,/no access code required/);
});

test('the SIYA introduction contains three sentences and the Ann-On-Ally link',async()=>{
 const s=await ui(()=>json({}));s.run("agentState.workspace='ask'");s.render();
 const paragraph=s.html.match(/<p class="subtle">SIYA was created[\s\S]*?<\/p>/)?.[0];assert(paragraph);
 const text=paragraph.replace(/<[^>]*>/g,'');assert.equal((text.match(/\.(?:\s|$)/g)||[]).length,3);
 assert.match(paragraph,/Anshul Dixit’s Frontier research/);assert.match(paragraph,/https:\/\/cafeco09.github.io\/ann-on-ally\//);assert.doesNotMatch(paragraph,/locked V4|runtime|AI-provider key/);
});

test('switching between evidence and example-only engines requires a new conversation',async()=>{
 const s=await ui(()=>json({}));s.run(`agentState.workspace='ask';agentState.mode='frontier-e0';agentState.conversation={id:'frontier-v1',engine:'frontier-v1',country:'IND',year:2023,turns:[]};agentState.prompt='Why?'`);s.render();assert.match(s.html,/conversation engine changed/);await s.el('agent-request').onsubmit({preventDefault(){}});assert.equal(s.calls.length,0);
});

test('SIYA workspaces contain no provider modes and keep the question above examples',async()=>{
 const s=await ui(()=>json({}));s.run("agentState.workspace='ask'");s.render();assert.doesNotMatch(s.html,/Groq|GROQ_API_KEY|Model-generated|OpenAI API/);assert.match(s.html,/SIYA · evidence agent/);assert.match(s.html,/SIYA · mechanism lab/);assert(s.html.indexOf('id="agent-prompt"')<s.html.indexOf('Try a question'));
 s.run("agentState.mode='frontier-e0'");s.render();assert.match(s.html,/dashboard records and external knowledge are withheld/);assert.match(s.html,/E0-style control/);
});

test('interpretation and plan details are escaped and show actual query constraints',async()=>{
 const s=await ui(()=>json({}));s.run(`agentState.workspace='ask';agentState.conversation={id:'v1',engine:'frontier-v1',country:'IND',year:2023,turns:[{prompt:'question',result:{kind:'answer',externalAI:false,message:'Evidence',frontier:{version:'test',epistemic_status:'MIXED_RESULTS',original_components_used:['State'],new_interfaces:[],interpretation:{inherited_context:true,excluded_metrics:['reading'],frames:[{operation:'lookup',metric:'numeracy',sex:'female',population:'<script>population</script>'}]},plan:[{operation:'lookup',status:'SOURCE_REPORTED'}]}}}]}`);s.render();assert.match(s.html,/What SIYA understood/);assert.match(s.html,/Excluded: reading/);assert.match(s.html,/lookup \(SOURCE_REPORTED\)/);assert.doesNotMatch(s.html,/<script>/);
});

test('a descriptive comparison renders both levels and scope as a table with comparison-specific wording',async()=>{
 const s=await ui(()=>json({}));s.run(`agentState.workspace='ask';agentState.conversation={id:'comparison',engine:'frontier-v1',country:'PAK',turns:[{prompt:'Compare reading',result:{kind:'answer',message:'Raw comparison text',frontier:{epistemic_status:'DERIVED_DESCRIPTIVE',original_components_used:['State','apply_operator'],new_interfaces:[],claim:{type:'descriptive_comparison',comparison:{mode:'profile',subject:'Reading',rows:[{group:'Poorest households',value:'4.6224799156188965'},{group:'Richest households',value:'41.35419464111328'}],summary:'The reported reading result is higher for richest households.',interpretation:'Relative wealth groups within this survey.',gap_text:'The gap is 36.73 percentage points.',context:{geography:'Pakistan (Sindh)',period:'2018-2019',population:'Children aged 7–14',sex:'Girls and boys combined'},scope_note:'This is not a national estimate.',caveat:'Descriptive outcomes.'}},interpretation:{frames:[{operation:'contrast',comparison_kind:'profile',groups:['Poorest (%)','Richest (%)']}]}}}}]}`);s.render();
 assert.match(s.html,/<table>/);assert.match(s.html,/<th scope="row">Poorest households<\/th><td>4\.62%/);assert.match(s.html,/<th scope="row">Richest households<\/th><td>41\.35%/);
 assert.match(s.html,/higher for richest households/);assert.match(s.html,/Pakistan \(Sindh\)/);assert.match(s.html,/not a national estimate/);assert.match(s.html,/Claim status: Descriptive comparison/);
 assert.match(s.html,/Poorest \(%\) versus Richest \(%\)/);assert.doesNotMatch(s.html,/Poorest \(%\) minus|Raw comparison text/);assert.match(s.html,/What are the sources for this comparison/);
});

test('comparison cells are escaped and malformed numeric rows use the escaped plain response',async()=>{
 const s=await ui(()=>json({}));
 const html=s.run(`agentResponseHtml({message:'safe fallback',frontier:{claim:{comparison:{mode:'profile',subject:'<script>x</script>',rows:[{group:'<img src=x onerror=x>',value:'4.5'},{group:'Richest',value:'41.25'}],context:{},summary:'<script>summary</script>'}}}})`);
 assert.doesNotMatch(html,/<script>|<img /);assert.match(html,/&lt;script&gt;/);
 const fallback=s.run(`agentResponseHtml({message:'<script>fallback</script>',frontier:{claim:{comparison:{mode:'profile',rows:[{group:'Poorest',value:'NaN'},{group:'Richest',value:'41'}],context:{}}}}})`);
 assert.doesNotMatch(fallback,/<table>|<script>/);assert.match(fallback,/&lt;script&gt;fallback/);
});

test('semantic interpretation displays roles, negation and missing baseline with escaped content',async()=>{
 const s=await ui(()=>json({}));s.run(`agentState.workspace='ask';agentState.conversation={id:'semantic',engine:'frontier-v1',country:'IND',turns:[{prompt:'Explain security',result:{kind:'clarification',message:'Clarify',frontier:{epistemic_status:'COMPARISON_REFERENCE_MISSING',original_components_used:[],new_interfaces:[],interpretation:{frames:[{operation:'causal',topic:'violence'}],semantic:{summary:'Laws affect <script>safety</script>',intent:'causal_explanation',population:{label:'women'},nodes:[{id:'n1',label:'laws'},{id:'n2',label:'women'}],edges:[{source:'n1',target:'n2',relation:'protects',polarity:'negative',status:'requested'}],unresolved:['comparison_reference','safety_measure']}}}}}]}`);s.render();
 assert.match(s.html,/does not protect/);assert.match(s.html,/Population: women/);assert.match(s.html,/comparison baseline; specific safety measure/);assert.match(s.html,/These relationships describe your question/);assert.doesNotMatch(s.html,/<script>/);
});

test('security rewrite suggestions preserve the intended meaning and population',async()=>{
 const s=await ui(()=>json({}));s.run(`agentState.workspace='ask';agentState.conversation={id:'semantic',engine:'frontier-v1',country:'IND',turns:[{prompt:'Explain job security',result:{kind:'clarification',message:'Clarify',frontier:{epistemic_status:'SCOPE_UNRESOLVED',original_components_used:[],new_interfaces:[],interpretation:{frames:[],semantic:{security_sense:'employment stability',population:{label:'women'},summary:'Employment stability',intent:'descriptive_evidence',nodes:[],edges:[],unresolved:[]}}}}}]}`);s.render();
 assert.match(s.html,/Plan research for missing employment stability evidence for women in India/);assert.doesNotMatch(s.html,/Show violence and safety evidence/);
});


test('a blocked Japan question offers an editable evidence reformulation and safely changes workspace',async()=>{
 const s=await ui(()=>json({}));s.run(`let D={Coverage:[[],['Primary','JPN','Japan']]};agentState.workspace='ask';agentState.mode='frontier-e0';agentState.conversation={id:'lab',engine:'v1-examples-only',country:'LAB',turns:[{prompt:'Explain the factors behind Japan showing a better system towards the security of female citizens.',result:{kind:'clarification',message:'Examples only',frontier:{regime:'examples_only',epistemic_status:'EXAMPLES_ONLY',original_components_used:[],new_interfaces:[]}}}]}`);s.render();
 assert.match(s.html,/Would you like to ask this instead\?/);assert.match(s.html,/Show violence and safety evidence in Japan\./);assert.match(s.html,/Opens a new evidence conversation/);assert.match(s.html,/Click to edit, then choose Run prompt/);
 s.run('document.querySelectorAll("[data-agent-followup]")[0].onclick()');assert.equal(s.run('agentState.mode'),'frontier');assert.equal(s.run('agentState.conversation'),null);assert.equal(s.run('agentState.prompt'),'Show violence and safety evidence in Japan.');assert.equal(s.focused,'agent-prompt');assert.equal(s.calls.length,0);
});

test('a normal follow-up retains the conversation and only the latest response has suggestions',async()=>{
 const s=await ui(()=>json({}));s.run(`agentState.workspace='ask';agentState.conversation={id:'evidence',engine:'frontier-v1',country:'IND',turns:[{prompt:'First question',result:{kind:'answer',message:'First answer'}},{prompt:'Show reading in India',result:{kind:'answer',message:'Second answer',references:[{table:'Reading',id:'ev_test',headers:[],values:[],sourceUrls:[]}]}}]}`);s.render();
 assert.equal((s.html.match(/data-agent-followup=/g)||[]).length,1);assert.match(s.html,/Suggested next question/);assert.match(s.html,/What are the sources for this answer/);
 s.run('document.querySelectorAll("[data-agent-followup]")[0].onclick()');assert.equal(s.run('agentState.conversation.id'),'evidence');assert.equal(s.run('agentState.prompt'),'sources');assert.equal(s.calls.length,0);
});

test('missing evidence offers a research plan and suggestions cannot interrupt an active run',async()=>{
 const s=await ui(()=>json({}));s.run(`agentState.workspace='ask';agentState.conversation={id:'evidence',engine:'frontier-v1',country:'IND',turns:[{prompt:'Show dropout data',result:{kind:'unresolved',message:'Missing data',frontier:{epistemic_status:'EVIDENCE_MISSING',original_components_used:[],new_interfaces:[],memory:{query:{topic:'pathways',metric:'dropout',sex:'female',source_years:['2022']}}}}}]}`);s.render();assert.match(s.html,/Plan research for missing dropout evidence for girls and women in India in 2022/);
 s.run("agentState.busy=true;agentState.prompt='Keep my active request'");s.run('document.querySelectorAll("[data-agent-followup]")[0].onclick()');assert.equal(s.run('agentState.prompt'),'Keep my active request');assert.equal(s.calls.length,0);
});

test('mixed-result suggestions target the unresolved task and retain its population',async()=>{
 const s=await ui(()=>json({}));
 const frontier={epistemic_status:'MIXED_RESULTS',plan:[{task_id:'T1',status:'SOURCE_REPORTED'},{task_id:'T2',status:'POPULATION_MISMATCH'}],interpretation:{frames:[{task_id:'T1',operation:'lookup',topic:'learning',metric:'reading',sex:'female'},{task_id:'T2',operation:'lookup',topic:'learning',metric:'numeracy',sex:'male'}],semantic:{population:{label:'girls'}},contract:{tasks:[{id:'T1',source_text:'show reading for girls'},{id:'T2',source_text:'numeracy for boys in India'}]}}};
 const conversation={engine:'frontier-v1',country:'IND',turns:[{prompt:'Show reading for girls and numeracy for boys in India',result:{kind:'unresolved',frontier}}]};
 s.run("agentState.workspace='ask';agentState.conversation="+JSON.stringify(conversation));
 const suggestions=JSON.parse(s.run('JSON.stringify(agentNextQuestions())'));
 assert.match(suggestions[0].prompt,/Plan research for missing numeracy evidence for boys in India/);
 assert.doesNotMatch(suggestions[0].prompt,/reading|girls/);
});

test('SIYA runs without an owner code and status refresh preserves its question',async()=>{
 const publicStatus={publicQuestions:true,authenticated:false,accessConfigured:false};
 const s=await ui(path=>json(path==='/api/agent/status'?publicStatus:{id:'public-run',conversation:{id:'anonymous',engine:'frontier-v1',turns:[]}}));
 s.run("agentState.workspace='ask';agentState.connection="+JSON.stringify(publicStatus)+";agentState.prompt='Show reading for girls in Pakistan'");s.render();
 assert.match(s.html,/no access code required/);assert(!s.el('agent-access-code'));assert.doesNotMatch(s.html,/type="submit" class="agent-run" disabled/);
 await s.run('refreshAgentStatus()');assert.equal(s.run('agentState.prompt'),'Show reading for girls in Pakistan');
 await s.el('agent-request').onsubmit({preventDefault(){}});assert(s.calls.some(c=>c.path==='/api/agent/tasks'));s.run('clearTimeout(agentState.pollTimer)');
 s.workspace('outreach').onclick();assert.match(s.html,/Submit for admin approval/);assert(!s.el('outreach-send'));
});

test('expired anonymous sessions stop polling and allow a fresh conversation',async()=>{
 const s=await ui(()=>({ok:false,status:401,json:async()=>({error:'Start a SIYA conversation in this browser first.'})}));
 s.run("agentState.workspace='ask';agentState.connection={publicQuestions:true,authenticated:false};agentState.busy=true;agentState.task={id:'expired'};agentState.conversation={id:'expired',engine:'frontier-v1',turns:[]};agentState.prompt='old question'");
 await s.run('pollAgentRun()');assert.equal(s.run('agentState.busy'),false);assert.equal(s.run('agentState.task'),null);assert.match(s.run('agentState.error'),/session expired/);
 s.render();await s.el('agent-new-conversation').onclick();assert.equal(s.run('agentState.conversation'),null);assert.equal(s.run('agentState.prompt'),'');
});

test('word candidates show spelling similarity separately from unavailable meaning probability',async()=>{
 const s=await ui(()=>json({}));
 const html=s.run(`agentWordMatchingHtml([{word:'<earning>',known_external_sense:'paid work or income',semantic_probability:null,candidates:[{term:'learning',surface_similarity:.875}]}])`);
 assert.match(html,/87\.5%/);assert.match(html,/Meaning probability: unavailable/);assert.match(html,/Original words are preserved/);assert.match(html,/&lt;earning&gt;/);assert.doesNotMatch(html,/<earning>/);
});

test('earnings follow-up suggestion preserves first-earnings age instead of offering learning',async()=>{
 const s=await ui(()=>json({}));
 s.run(`agentState.workspace='ask';agentState.conversation={id:'earning',engine:'frontier-v1',country:'JPN',turns:[{prompt:'At what age do Japanese women start earning on an average',result:{kind:'clarification',message:'No first earnings data',frontier:{epistemic_status:'SCOPE_UNRESOLVED',original_components_used:[],new_interfaces:[],interpretation:{frames:[{operation:'clarify',unresolved_constraint:'employment_entry_age'}],lexical_grounding:[{word:'earning',known_external_sense:'paid work or income',semantic_probability:null,candidates:[{term:'learning',surface_similarity:.875}]}],semantic:{outcome:{concept:'earnings'},population:{label:'women'},summary:'Earnings for women',intent:'descriptive_evidence',nodes:[],edges:[],unresolved:[]}}}}}]}`);
 const next=s.run('agentNextQuestions()');assert.equal(next.length,1);assert.match(next[0].prompt,/average age at first earnings from paid work for women/);assert.doesNotMatch(next[0].prompt,/learning|reading/);
});

test('work suggestions retain the topic even for an unresolved frame; unknown topics are not changed to learning',async()=>{
 const s=await ui(()=>json({}));
 s.run(`const D={Coverage:[['Group','ISO3','Country'],['Primary','IRN','Iran']]};agentState.workspace='ask';agentState.conversation={id:'work',engine:'frontier-v1',country:'IRN',turns:[{prompt:'Tell me more about working women of Iran',result:{kind:'clarification',frontier:{epistemic_status:'QUESTION_UNRESOLVED',interpretation:{frames:[{operation:'clarify',sex:'female'}],semantic:{population:{label:'women'}}}}}}]}`);
 let next=s.run('agentNextQuestions()');assert.match(next[0].prompt,/workforce participation and employment.*women.*Iran/);assert.doesNotMatch(next[0].prompt,/learning/);
 s.run(`agentState.conversation.turns[0].prompt='Tell me about volcanoes in Iran'`);
 next=s.run('agentNextQuestions()');assert.equal(next.length,0);
});


test('embedded GitHub SIYA uses one anonymous session and omits cross-site cookies',async()=>{
 let opened=0,fail=false;
 const s=await ui((path)=>path.endsWith('/session')?json({session:'portal-'+(++opened)}):fail?{ok:false,status:401,json:async()=>({error:'expired'})}:json({ok:true}),{portal:true});
 await s.run("Promise.all([agentRequest('/api/agent/status'),agentRequest('/api/agent/outreach/authorities')])");
 assert.equal(opened,1);for(const c of s.calls){assert(c.path.startsWith('https://her-education-dashboard.onrender.com/'));assert.equal(c.init.credentials,'omit');assert(!c.init.headers.Cookie);if(!c.path.endsWith('/session'))assert.equal(c.init.headers['X-Siya-Session'],'portal-1')}
 assert.equal(s.run('agentAdminUrl()'),'https://her-education-dashboard.onrender.com/admin');
 fail=true;await assert.rejects(s.run("agentRequest('/api/agent/status')"),/expired/);fail=false;await s.run("agentRequest('/api/agent/status')");assert.equal(opened,2);
});
