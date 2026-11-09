const agentState={connection:null,checkedAt:0,checking:false,statusError:'',workspace:'outreach',mode:'frontier',conversation:null,prompt:'',reply:'',organisation:'',task:null,busy:false,answerPending:false,activePrompt:'',error:'',unlockError:'',unlocking:false,pollTimer:null};
const agentModes={frontier:['SIYA · evidence agent','Questions, comparisons, evidence plans and outreach drafts.'], 'frontier-e0':['SIYA · mechanism lab','Learn from your examples in an isolated, example-only regime.']};
function agentCanAsk(){return Boolean(agentState.connection&&(agentState.connection.publicQuestions||agentState.connection.authenticated))}
function agentIsConversation(mode){return Object.hasOwn(agentModes,mode)}
function agentScopeChanged(){const c=agentState.conversation;return Boolean(c&&c.engine!==(agentState.mode==='frontier-e0'?'v1-examples-only':'frontier-v1'))}
const frontierReasoningExample=`Learn:
Anna boosts Bob from 2 to 3.
Anna boosts Bob from 4 to 5.
Predict:
Bob starts at 7.
Anna boosts Bob.`;
function agentExamples(){return agentState.mode==='frontier-e0'?[['frontier-e0',frontierReasoningExample,'Learn a mechanism from examples'],['frontier-e0','Predict:\nBob starts at 10.\nAnna boosts Bob.','Change the initial value']]:[['frontier','How well can girls aged 7 to 14 in Pakistan read?'],['frontier','Show reading and numeracy in Pakistan, then list the evidence gaps.'],['frontier','Compare reading between the richest and poorest households in Pakistan.'],['frontier','Plan research for missing girls’ dropout data in India.'],['frontier','Draft an evidence request for girls’ learning data in India.']]}
function agentOutputHtml(value){
 const s=String(value||'');let html='',start=0;
 for(const m of s.matchAll(/\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g)){
  html+=esc(s.slice(start,m.index));let safe=false;try{const u=new URL(m[2]);safe=u.protocol==='https:'&&!u.username&&!u.password}catch{}
  html+=safe?`<a href="${esc(m[2])}" target="_blank" rel="noopener noreferrer">${esc(m[1])}</a>`:esc(m[0]);start=m.index+m[0].length;
 }
 return html+esc(s.slice(start));
}
function agentAccessPanel({admin=false}={}){
 const c=agentState.connection;
 if(agentState.statusError)return `<div class="agent-setup"><h3>Workspace connection interrupted</h3><p class="agent-error" role="alert">${esc(agentState.statusError)}</p><button id="agent-refresh" ${agentState.checking?'disabled':''}>${agentState.checking?'Checking…':'Retry connection'}</button></div>`;
 if(!c)return `<div class="agent-connection"><span class="agent-status-dot" aria-hidden="true"></span><span>Checking the agent connection…</span></div>`;
 if(admin&&!c.accessConfigured)return `<div class="agent-setup"><h3>Admin access unavailable</h3><p>The site owner needs to configure private access in the hosting settings.</p><button id="agent-refresh" ${agentState.checking?'disabled':''}>Refresh connection status</button></div>`;
 if(!c.accessConfigured)return `<div class="agent-setup"><h3>Connect the private agent</h3><p>The tab is ready. The hosting service still needs the owner's private credentials before an agent can run.</p><details><summary>Owner connection setup</summary><p>In the hosting service's Environment settings, set a private <code>AGENT_ACCESS_CODE</code> of at least 16 characters. SIYA / Frontier V4 needs no AI key. Save and deploy, then refresh the connection status here.</p><p>${c.accessConfigured?'The private-access setting is present.':'The private-access setting is missing.'}</p><a href="https://dashboard.render.com/web/srv-db8hshvavr4c73amh360" target="_blank" rel="noopener noreferrer">Open hosting settings ↗</a></details><button id="agent-refresh" ${agentState.checking?'disabled':''}>${agentState.checking?'Checking…':'Refresh connection status'}</button></div>`;
 if(!c.authenticated)return `<div class="agent-setup"><h3>${admin?'Admin sign-in':'Unlock Agent outreach'}</h3><p>${admin?'Enter your admin workspace access code to manage the sending mailbox.':'Enter your owner code to manage email drafts, approvals and private tracking. Ask SIYA is open without a code.'}</p><form id="agent-unlock"><label>Workspace access code<input id="agent-access-code" type="password" autocomplete="off" maxlength="256" required></label><button type="submit" ${agentState.unlocking?'disabled':''}>${agentState.unlocking?'Unlocking…':'Unlock workspace'}</button></form><p class="subtle">${admin?'Mailbox controls appear after admin sign-in.':'This code protects mail controls. Ask SIYA needs no code.'}</p>${agentState.unlockError?`<p class="agent-error" role="alert">${esc(agentState.unlockError)}</p>`:''}</div>`;
 if(admin)return `<div class="agent-connection connected"><span class="agent-status-dot" aria-hidden="true"></span><span>Admin workspace unlocked</span><button id="agent-lock">Lock workspace</button></div>`;
 return `<div class="agent-connection connected"><span class="agent-status-dot" aria-hidden="true"></span><span>${c.frontierVerifiedAt?'SIYA runtime verified':'SIYA ready for a first run'} · no AI API</span><button id="agent-refresh">Refresh connection status</button><button id="agent-lock">Lock workspace</button></div>`;
}
function agentDialogueReferences(result){
 if(!result)return '';
 if(!agentState.connection?.authenticated||result.publicDisplay){
  const limitations=(result.limitations||[]).filter(s=>!/Experimental V1 extension|V4 controller with guarded|Uses the original V1|V4 uses bounded|original registered vocabulary|finite operator family/i.test(s));
  return `${limitations.length?`<p class="subtle">${limitations.map(esc).join(' ')}</p>`:''}${result.references?.length?`<div class="agent-public-sources"><p class="subtle">Sources: ${result.references.map(r=>esc(r.title||r.table||'Dashboard evidence')+(r.sourceUrls||[]).map(u=>' · '+agentOutputHtml('[Source]('+u+')')).join('')).join('; ')}.</p></div>`:''}`;
 }
 return `${result.frontier?agentFrontierDetails(result.frontier):''}<p class="subtle">${esc({answer:result.frontier?.epistemic_status==='CONDITIONAL_MODEL'?'Conditional model answer':result.frontier?.epistemic_status==='V4_USER_CALCULATION'?'Calculated from your expression':'Evidence-linked answer',clarification:'Clarification',unresolved:'Unresolved evidence gap',draft:'Draft for review'}[result.kind]||'Response')} · SIYA · experimental · no AI API; review source coverage.</p>${result.historyOmitted?`<p class="subtle">${esc(result.historyOmitted)} earlier turn(s) were outside the retained conversation context.</p>`:''}${result.coverage?.limited?`<details><summary>Evidence omitted from this request</summary><ul>${Object.entries(result.coverage.omittedRows).map(([table,count])=>`<li>${esc(table)}: ${esc(count)} record(s)</li>`).join('')}</ul></details>`:''}${result.limitations?.length?`<ul>${result.limitations.map(v=>`<li>${esc(v)}</li>`).join('')}</ul>`:''}${result.references?.length?`<details><summary>Supporting dashboard records (${result.references.length})</summary><p class="subtle">Original dashboard records used by this runtime. Source contents have not been rechecked.</p>${result.references.map(r=>`<details><summary>${esc(r.table)} · ${esc(r.id)}</summary><dl>${r.headers.map((header,i)=>`<dt>${esc(header)}</dt><dd>${esc(r.values[i]??'Missing')}</dd>`).join('')}</dl>${r.sourceUrls.map(u=>`<p>${agentOutputHtml('[Source]('+u+')')}</p>`).join('')}</details>`).join('')}</details>`:''}`;
}
function agentConversationHtml(){
 if(agentState.answerPending){
  if(!agentCanAsk())return '';
  return `<div class="agent-conversation" aria-label="Current answer"><article class="agent-dialogue-turn"><h3>You</h3><div class="agent-answer">${esc(agentState.activePrompt)}</div><h3>SIYA</h3><p role="status">${agentState.busy?'Preparing your new answer…':'No new answer was produced. You can edit and run your prompt again.'}</p></article></div>`;
 }
 const c=agentState.conversation;if(!c?.turns?.length)return '';
 const turn=c.turns.at(-1);
 return `<div class="agent-conversation" aria-label="Current answer"><article class="agent-dialogue-turn"><h3>You</h3><div class="agent-answer">${esc(turn.prompt)}</div><h3>SIYA</h3>${agentResponseHtml(turn.result)}${agentReplyHtml(turn.result)+agentNextQuestionsHtml()}${agentDialogueReferences(turn.result)}</article></div>`;
}
function resetAgentAnswerView(){agentState.answerPending=false;agentState.activePrompt=''}
function agentResponseHtml(result){
 const c=result.comparison||result.frontier?.claim?.comparison;
 if(!c||c.mode!=='profile'||!Array.isArray(c.rows)||c.rows.length!==2||!c.context||!c.rows.every(r=>typeof r.group==='string'&&typeof r.value==='string'&&r.value.trim()!==''&&Number.isFinite(Number(r.value))))return `<div class="agent-answer">${agentOutputHtml(result.message)}</div>`;
 return `<section class="agent-comparison" aria-label="${esc(c.subject)} comparison"><table><caption>${esc(c.subject)} · reported results</caption><thead><tr><th scope="col">Group</th><th scope="col">${esc(c.subject)} (%)</th></tr></thead><tbody>${c.rows.map(r=>`<tr><th scope="row">${esc(r.group)}</th><td>${esc(Number(r.value).toFixed(2))}%</td></tr>`).join('')}</tbody></table><p>${esc(c.summary)} ${esc(c.explanation||c.interpretation)}</p><p>${esc(c.gap_text)}</p><p class="subtle">Geography: ${esc(c.context.geography)}. Source period: ${esc(c.context.period)}.<br>Population: ${esc(c.context.population)}. Sex coverage: ${esc(c.context.sex)}.</p>${c.scope_note?`<p class="agent-comparison-scope">${esc(c.scope_note)}</p>`:''}<p class="subtle">${esc(c.caveat)}</p></section>`;
}
function agentReplyHtml(result){
 if(result.kind!=='clarification'||!agentState.conversation?.id)return '';
 const disabled=agentState.busy||!agentCanAsk()||agentScopeChanged();
 const clarification=result.clarification||result.frontier?.clarification,choices=clarification?.options||[];
 const options=choices.length?`<fieldset class="agent-clarification-options"><legend>${esc(clarification.question)}</legend><p class="subtle">Choose a suggested reply to edit below, or write your own.</p><div class="agent-suggestions">${choices.map((o,i)=>`<button type="button" data-agent-choice="${i}" ${disabled?'disabled':''}><strong>${esc(o.label)}</strong><span>${esc(o.reply)}</span></button>`).join('')}</div></fieldset>`:'';
 return `<form id="agent-reply-form" class="agent-reply" aria-label="Reply to SIYA">${options}<label class="agent-field" for="agent-reply">Your reply<textarea id="agent-reply" rows="3" maxlength="3000" required aria-describedby="agent-reply-help" placeholder="Answer SIYA’s question here…" ${disabled?'disabled':''}>${esc(agentState.reply)}</textarea></label><p id="agent-reply-help" class="subtle">Continues this conversation with your original question.</p><button type="submit" class="agent-run" ${disabled?'disabled':''}>Send reply</button></form>`;
}
async function submitAgentQuestion(prompt,{reply=false}={}){
 if(agentState.busy||!agentCanAsk()||!String(prompt||'').trim())return;
 if(reply&&agentState.conversation?.turns?.at(-1)?.result?.kind!=='clarification')return;
 if(agentScopeChanged()){agentState.error='Start a new conversation for this engine.';refreshAgentUi();return}
 const request={scope:'question',mode:agentState.mode,prompt:prompt.trim(),organisation:agentState.organisation,...(agentIsConversation(agentState.mode)&&agentState.conversation?{conversationId:agentState.conversation.id}:{})};
 agentState.busy=true;agentState.answerPending=true;agentState.activePrompt=request.prompt;agentState.error='';agentState.task=null;refreshAgentUi();
 try{const task=await agentRequest('/api/agent/tasks',request);if(!agentCanAsk())return;agentState.reply='';agentState.task=task;if(task.conversation)agentState.conversation=task.conversation;scheduleAgentPoll()}catch(error){agentState.error=error.message;agentState.busy=false;agentState.prompt=request.prompt}
 refreshAgentUi();
}
function agentNextQuestions(){
 const c=agentState.conversation,turn=c?.turns?.at(-1);if(!turn?.result)return [];
 const result=turn.result,f=result.frontier||{},frames=f.interpretation?.frames||[];
 if(result.publicDisplay)return result.suggestedReplies||[];
 if(result.kind==='clarification'&&f.clarification?.options?.length)return [];
 const blockedTask=(f.plan||[]).find(p=>['EVIDENCE_MISSING','VALUE_MISSING','POPULATION_MISMATCH','CAUSAL_EVIDENCE_MISSING','COMPARISON_REFERENCE_MISSING','SCOPE_UNRESOLVED','ACTION_NOT_AUTHORISED'].includes(p.status));
 const query=(blockedTask?frames.find(q=>q.task_id===blockedTask.task_id):null)||frames.find(q=>q.topic)||f.memory?.query||{};
 const status=blockedTask?.status||f.epistemic_status;
 const task=f.interpretation?.contract?.tasks?.find(t=>t.id===query.task_id);
 const prompt=String(turn.prompt||''),catalog=typeof D==='object'&&D?.Coverage?D.Coverage.slice(1):[];
 const escapePattern=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const named=catalog.filter(r=>[r[2],r[2].replace(/\s*\([^)]*\)/g,''),r[1],...({GBR:['UK','Britain'],USA:['US','USA'],PSE:['Palestine'],VNM:['Vietnam']}[r[1]]||[])].some(v=>new RegExp('(?<![\\w])'+escapePattern(v)+'(?![\\w])',v===v.toUpperCase()?'':'i').test(prompt)));
 const scoped=String(c.country||'').split('+'),scopeName=code=>catalog.find(r=>r[1]===code)?.[2]||name(code);
 const country=scoped.length===2?scoped.map(scopeName).join(' and '):named.length?named.map(r=>r[2]).join(' and '):c.country&&c.country!=='LAB'?scoped.map(scopeName).join(' and '):'[country name]';
 const semantic=blockedTask&&frames.indexOf(query)>0?{}:f.interpretation?.semantic||{};
 const subject=semantic.security_sense&&semantic.security_sense!=='personal safety'?semantic.security_sense:({labour_share:'women’s share of the total labour force',work_profile:'workforce participation and employment'}[query.metric]||query.metric)||({violence:'violence and safety',pathways:'enrolment',work:'workforce',family:'family background',access:'literacy',conditions:'learning conditions',population:'population'}[query.topic])||(/secur|safety|violence|crime/i.test(prompt)?'violence and safety':/drop\s*out/i.test(prompt)?'dropout':/numeracy|number skills/i.test(prompt)?'numeracy':/read/i.test(prompt)?'reading':/gdp|economic/i.test(prompt)?'GDP':/\b(?:work|working|jobs?|employ\w*|labou?r|workforce)\b/i.test(prompt)?'workforce participation and employment':/educat|learn|school|preschool|pisa|mics/i.test(prompt)?'learning':null);
 const requestedYears=query.source_years||[...new Set(prompt.match(/\b(?:19|20)\d{2}\b/g)||[])];
 const period=requestedYears.length===1?' in '+requestedYears[0]:'';
 const localPopulation=task?.source_text?.match(/\b(?:female citizens|male citizens|girls|boys|women|men|children)\b/i)?.[0];
 const population=localPopulation?' for '+localPopulation:semantic.population?.label?' for '+semantic.population.label:query.sex==='female'?' for girls and women':query.sex==='male'?' for boys and men':'';
 const evidence=`Show ${subject} evidence${population} in ${country}${period}.`;
 const plan=`Plan research for missing ${subject} evidence${population} in ${country}${period}.`;
 const blocked=['clarification','unresolved'].includes(result.kind);
 const meaning=frames.find(q=>q.unresolved_constraint==='word_meaning');
 if(meaning){const item=f.interpretation?.lexical_grounding?.find(x=>!x.known_external_sense);if(item)return item.candidates.slice(0,3).map(candidate=>({prompt:prompt.replace(new RegExp('\\b'+escapePattern(item.word)+'\\b','i'),candidate.term),label:'Did you mean “'+candidate.term+'”? Edit the question',mode:'frontier',rewrite:true}))}
 const earnings=frames.find(q=>['employment_entry_age','earnings_measure'].includes(q.unresolved_constraint));
 if(earnings)return [{prompt:`Plan research for ${earnings.unresolved_constraint==='employment_entry_age'?'the average age at first earnings from paid work':'earnings or pay'}${population} in ${country}${period}.`,mode:'frontier',rewrite:true}];

 const lab=c.engine==='v1-examples-only'||f.regime==='examples_only';
 if(lab&&status==='EXAMPLES_ONLY')return [{prompt:evidence,mode:'frontier',rewrite:true,newConversation:true}];
 if(status==='CONDITIONAL_MODEL')return [{prompt:'How was that calculated?',mode:lab?'frontier-e0':'frontier'}];
 if(lab){
  return [{prompt:frontierReasoningExample,mode:'frontier-e0',rewrite:true,newConversation:true}];
 }
 if(!subject)return [];
 if(query.related_dimensions?.length===2)return query.operation==='sources'?[]:[{prompt:'sources',label:'Show sources for both measures in '+country,mode:'frontier'}];
 if(status==='COMPARISON_UNRESOLVED')return [{prompt:`Compare ${query.metric||'reading'} between the richest and poorest households in ${country}${period}.`,mode:'frontier',rewrite:true}];
 if(status==='ACTION_NOT_AUTHORISED')return [{prompt:`Draft an evidence request for ${subject} in ${country}${period}.`,mode:'frontier',rewrite:true}];
 if(blocked)return [{prompt:['EVIDENCE_MISSING','POPULATION_MISMATCH','CAUSAL_EVIDENCE_MISSING','COMPARISON_REFERENCE_MISSING'].includes(status)||Boolean(semantic.security_sense&&semantic.security_sense!=='personal safety')?plan:evidence,mode:'frontier',rewrite:true}];
 if(f.claim?.type==='descriptive_comparison')return [{prompt:'sources',label:'What are the sources for this comparison?',mode:'frontier'}];
 if(f.claim?.type==='contrast'||status==='DERIVED_DESCRIPTIVE')return [{prompt:'How was that calculated?',mode:'frontier'}];
 if(result.references?.length&&!(f.plan||[]).some(p=>p.operation==='sources'))return [{prompt:'sources',label:'What are the sources for this answer?',mode:'frontier'}];
 return [{prompt:`What evidence is missing for ${subject} in ${country}${period}?`,mode:'frontier'}];
}
function agentNextQuestionsHtml(){
 const suggestions=agentNextQuestions();if(!suggestions.length)return '';
 const rewrite=suggestions.some(s=>s.rewrite),fresh=suggestions.some(s=>s.newConversation);
 return `<div class="agent-next-questions" aria-label="Suggested next question"><h4>${rewrite?'Would you like to ask this instead?':'Suggested next question'}</h4>${fresh?'<p class="subtle">'+(suggestions[0].mode==='frontier'?'Opens a new evidence conversation.':'Opens a new mechanism lab conversation.')+'</p>':''}<div class="agent-suggestions">${suggestions.map((s,i)=>`<button type="button" data-agent-followup="${i}" ${agentState.busy?'disabled':''}>${esc(s.label||s.prompt)}</button>`).join('')}</div><p class="subtle">Click to edit, then choose Run prompt.${suggestions.some(s=>s.prompt.includes('[country name]'))?' Replace [country name] with your chosen country.':''}</p></div>`;
}
function agentAskView(){
 const s=agentState,c=s.connection,task=s.task,unlocked=agentCanAsk(),scopeChanged=agentScopeChanged(),lab=s.mode==='frontier-e0';
 return `${agentWorkspaceHeader()}${agentWorkspaceNav()}<div class="agent-grid"><section class="panel"><h2>Explore with SIYA</h2><div class="agent-modes" role="group" aria-label="SIYA workspace">${Object.entries(agentModes).map(([id,[title,description]])=>`<button data-agent-mode="${id}" title="${esc(description)}" aria-description="${esc(description)}" aria-pressed="${id===s.mode}" class="${id===s.mode?'active':''}" ${s.busy?'disabled':''}><strong>${title}</strong><span>${description}</span></button>`).join('')}</div>${scopeChanged?'<p class="agent-error" role="alert">The conversation engine changed. Start a new conversation to use this workspace.</p>':''}<form id="agent-request"><label class="agent-field">Your prompt<textarea id="agent-prompt" rows="${lab?7:4}" maxlength="3000" required placeholder="${lab?'Try the learning example below, then change the initial value.':'For example: How well can girls in Pakistan read, and what evidence is missing?'}" ${s.busy?'disabled':''}>${esc(s.prompt)}</textarea></label><div class="agent-actions"><button type="submit" class="agent-run" ${!unlocked||s.busy||scopeChanged?'disabled':''}>${s.busy?'SIYA working…':'Run prompt'}</button>${s.busy?'<button id="agent-stop" type="button">Stop run</button>':''}<button id="agent-new-conversation" type="button" ${s.busy||!unlocked?'disabled':''}>New conversation</button></div></form><details class="agent-guidance"><summary>About this SIYA workspace</summary><p class="subtle">${lab?'Example-only lab: dashboard records and external knowledge are withheld. This is an E0-style control with supplied language grammar and a finite operator family.':'Name the country in your question, and include a source year if needed. Follow-ups keep the country; naming another switches it. If no year is requested, available source periods are used. SIYA can interpret related measures and multi-part requests. It shows the interpretation it used and asks for missing details. Research produces a plan; live web searching is not connected.'}</p></details><details><summary>Try a question</summary><div class="agent-suggestions">${agentExamples().map(([,v,label],i)=>`<button data-agent-example="${i}" ${s.busy?'disabled':''}>${esc(label||v)}</button>`).join('')}</div></details><p class="subtle">SIYA was created to help people explore how girls’ education connects with women’s work, safety and everyday lives. Built through Anshul Dixit’s Frontier research, it connects your questions with published dashboard evidence and makes gaps and limitations clear. Its purpose is to support informed questions and carefully reviewed outreach as part of <a href="https://cafeco09.github.io/ann-on-ally/" target="_blank" rel="noopener noreferrer">Ann-On-Ally</a>.</p></section><section class="panel agent-results" aria-label="Agent activity"><div class="topline"><h2>SIYA’s activity</h2>${task?.output?'<div class="agent-actions"><button id="agent-copy">Copy result</button>'+(task.status==='completed'?'<button id="agent-use-draft">Use as outreach question</button>':'')+'</div>':''}</div>${s.error?`<p class="agent-error" role="alert">${esc(s.error)}</p>`:''}${agentConversationHtml()}${task?`<div class="agent-run-status" role="status"><span class="agent-status-dot ${s.busy?'working':''}" aria-hidden="true"></span><span>${esc(task.progress)}<small>${task.country?esc(task.country==='LAB'?'Example-only lab':name(task.country)):task.dialogue?.frontier?.v4?.operator!=='guarded_dashboard_adapter'?'No country required':'Country needed'} · ${task.year||'source periods from question'} · ${esc(agentModes[task.mode]?.[0]||'SIYA run')}</small></span></div>${task.error?`<p class="agent-error" role="alert">${esc(task.error)}</p>`:''}`:'<div class="agent-empty"><span aria-hidden="true">↗</span><h3>Start with a question.</h3><p>Your answer, interpreted request and supporting records will appear here.</p></div>'}</section></div>`;
}
function agentWorkspaceNav(){return `<div class="agent-workspace-nav" role="group" aria-label="Agent workspace"><button data-agent-workspace="outreach" aria-pressed="${agentState.workspace==='outreach'}" class="${agentState.workspace==='outreach'?'active':''}">Agent Outreach</button><button data-agent-workspace="dialogue" aria-pressed="${agentState.workspace==='dialogue'}" class="international-dialogue-tab ${agentState.workspace==='dialogue'?'active':''}">International Dialogue</button><button data-agent-workspace="ask" aria-pressed="${agentState.workspace==='ask'}" class="${agentState.workspace==='ask'?'active':''}">Explore with SIYA</button></div>`}
function agentQuestionAccessPanel(){
 if(agentState.statusError)return `<div class="agent-setup"><p class="agent-error" role="alert">${esc(agentState.statusError)}</p><button id="agent-refresh">Retry connection</button></div>`;
 return `<div class="agent-connection ${agentCanAsk()?'connected':''}"><span class="agent-status-dot" aria-hidden="true"></span><span>${agentState.connection?'Ask SIYA · no access code required':'Connecting to SIYA…'}</span><button id="agent-refresh" ${agentState.checking?'disabled':''}>Refresh connection status</button></div>`;
}
function agentWorkspaceHeader(){
 const exploring=agentState.workspace==='ask',dialogue=agentState.workspace==='dialogue';
 return `<section class="agent-workspace-header" aria-label="Agent workspace overview"><div class="topline"><div><h1>${exploring?'Explore with SIYA':dialogue?'International Dialogue':'Agent Outreach'}</h1><p class="subtle">${exploring?'Play with dashboard data, compare countries and refine your questions.':dialogue?'A proposed international safety line, local emergency coordination and Frontier support.':'Choose an authority, submit an outreach question and track its progress.'}</p></div><span class="pill">${exploring?esc(agentState.conversation?.country?String(agentState.conversation.country).split('+').map(name).join(' and '):'Dashboard exploration'):dialogue?'Proposed service · awaiting activation':'Admin approval before sending'}</span></div>${exploring?agentQuestionAccessPanel():''}</section>`;
}
function agentView(){if(agentState.workspace==='ask')return agentAskView();return `${agentWorkspaceHeader()}${agentWorkspaceNav()}${agentState.workspace==='dialogue'?dialogueView():outreachView()}`}

const siyaRemoteOrigin=typeof location!=='undefined'&&location.origin==='https://cafeco09.github.io'?'https://her-education-dashboard.onrender.com':'';
let siyaPortalSession=null,siyaPortalStarting=null;
function agentAdminUrl(path='/admin'){return siyaRemoteOrigin+path}
async function ensureSiyaPortalSession(){
 if(!siyaRemoteOrigin||siyaPortalSession)return;
 if(!siyaPortalStarting)siyaPortalStarting=(async()=>{
  const response=await fetch(siyaRemoteOrigin+'/api/agent/session',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',signal:AbortSignal.timeout(45000),body:'{}'});
  const data=await response.json();if(!response.ok||!data.session)throw Error(data.error||'Could not start a SIYA session.');siyaPortalSession=data.session;
 })().finally(()=>{siyaPortalStarting=null});
 await siyaPortalStarting;
}
async function agentRequest(path,body){
 let response;try{
  if(siyaRemoteOrigin)await ensureSiyaPortalSession();
  response=await fetch(siyaRemoteOrigin+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(siyaRemoteOrigin?{'X-Siya-Session':siyaPortalSession}:{})},credentials:siyaRemoteOrigin?'omit':'same-origin',signal:AbortSignal.timeout(45000),...(body===undefined?{}:{body:JSON.stringify(body)})});
 }catch(error){if(['TimeoutError','AbortError'].includes(error.name))throw Error('The service took too long to respond. Refresh the connection before trying again. A submitted action may still be processing.');throw Error('Could not reach the workspace. Check your connection and try again.')}
 let data;try{data=await response.json()}catch{throw Error('The agent service returned an unreadable response. Refresh its connection status.')}
 if(!response.ok){if(response.status===401&&siyaRemoteOrigin)siyaPortalSession=null;const error=Error(data.error||'The agent request failed.');error.status=response.status;throw error}return data;
}
function refreshAgentUi(){if(tab==='agent')render()}
async function refreshAgentStatus(){
 if(agentState.checking)return;const wasAdmin=agentState.connection?.authenticated===true;agentState.checking=true;agentState.checkedAt=Date.now();refreshAgentUi();
 try{agentState.connection=await agentRequest('/api/agent/status');agentState.statusError='';if(!agentState.connection.authenticated){if(wasAdmin||!agentState.connection.publicQuestions){clearTimeout(agentState.pollTimer);agentState.task=null;agentState.conversation=null;resetAgentAnswerView();agentState.prompt='';agentState.reply='';agentState.organisation='';agentState.busy=false;agentState.error=''}outreachState.connection=null;outreachState.drafts=[];outreachState.invitations=[];outreachState.invite=null;outreachState.selected=null;outreachState.editing=null;outreachState.compose={to:'',subject:'',body:''};outreachState.error='';outreachState.notice='';outreachState.loaded=false;outreachState.setupOpen=false}else if(!wasAdmin&&agentState.task?.id&&!agentState.busy){const task=await agentRequest('/api/agent/tasks/'+encodeURIComponent(agentState.task.id));if(agentState.connection?.authenticated){agentState.task=task;if(task.conversation)agentState.conversation=task.conversation}}}catch(error){agentState.statusError=error.message}
 finally{agentState.checking=false;refreshAgentUi()}
}
function scheduleAgentPoll(){clearTimeout(agentState.pollTimer);agentState.pollTimer=setTimeout(pollAgentRun,1800)}
async function pollAgentRun(){
 const id=agentState.task?.id;if(!id||!agentState.busy)return;
 try{
  const t=await agentRequest('/api/agent/tasks/'+encodeURIComponent(id));if(agentState.task?.id!==id||!agentCanAsk())return;agentState.task=t;
  const terminal=['completed','failed','cancelled'].includes(t.status)&&t.cleanup!=='Pending';agentState.busy=!terminal;
  if(t.conversation)agentState.conversation=t.conversation;
  if(t.status==='completed'&&agentState.connection){if(t.provider==='frontier')agentState.connection.frontierVerifiedAt=Date.now();if(agentIsConversation(t.mode))agentState.prompt='';agentState.reply='';resetAgentAnswerView()}
  else if(terminal&&agentState.answerPending)agentState.prompt=agentState.activePrompt;
  if(!terminal)scheduleAgentPoll();
 }catch(error){if([401,404].includes(error.status)){agentState.busy=false;agentState.task=null;agentState.error='This question session expired or the run is no longer available. Start a new conversation.'}else{agentState.error=error.message+' The run may still be active; checking its status again.';scheduleAgentPoll()}}
 refreshAgentUi();
}
function bindAgentUI(){
 document.querySelectorAll('[data-agent-workspace]').forEach(b=>b.onclick=()=>{agentState.workspace=b.dataset.agentWorkspace;render();});
 if(agentState.workspace==='dialogue')bindDialogueUI();
 if(agentState.workspace==='outreach'){if(agentState.connection?.authenticated)bindOutreachUI();else bindPublicOutreachUI()}
 if($('agent-use-draft'))$('agent-use-draft').onclick=()=>{outreachPublic.question=agentState.conversation?.turns?.at(-1)?.prompt||'';if(agentState.connection?.authenticated){outreachState.compose={to:'',subject:'',body:outreachPublic.question};outreachState.selected=null;outreachState.editing=null}agentState.workspace='outreach';render();$('outreach-public-question')?.focus?.()};
 document.querySelectorAll('[data-agent-mode]').forEach(b=>b.onclick=()=>{agentState.reply='';agentState.mode=b.dataset.agentMode;agentState.task=null;agentState.error='';render()});
 document.querySelectorAll('[data-agent-example]').forEach(b=>b.onclick=()=>{const i=+b.dataset.agentExample,[mode,prompt]=agentExamples()[i];agentState.reply='';agentState.mode=mode;agentState.prompt=prompt;agentState.task=null;render()});
 document.querySelectorAll('[data-agent-followup]').forEach(b=>b.onclick=()=>{
  if(agentState.busy||!agentCanAsk())return;
  const suggestion=agentNextQuestions()[Number(b.dataset.agentFollowup)];if(!suggestion)return;
  if(suggestion.newConversation||(agentState.conversation?.engine&&agentState.conversation.engine!==(suggestion.mode==='frontier-e0'?'v1-examples-only':'frontier-v1'))){agentState.conversation=null;resetAgentAnswerView()}
  agentState.reply='';agentState.mode=suggestion.mode;agentState.prompt=suggestion.prompt;agentState.task=null;agentState.error='';render();$('agent-prompt')?.focus?.();$('agent-prompt')?.scrollIntoView?.({behavior:'smooth',block:'center'});
 });
 if($('agent-prompt'))$('agent-prompt').oninput=e=>{agentState.prompt=e.target.value};
 if($('agent-organisation'))$('agent-organisation').oninput=e=>{agentState.organisation=e.target.value};
 if($('agent-request'))$('agent-request').onsubmit=async e=>{e.preventDefault();await submitAgentQuestion(agentState.prompt)};
 if($('agent-reply'))$('agent-reply').oninput=e=>{agentState.reply=e.target.value};
 document.querySelectorAll('[data-agent-choice]').forEach(b=>b.onclick=()=>{
  if(agentState.busy||!agentCanAsk()||agentScopeChanged())return;
  const result=agentState.conversation?.turns?.at(-1)?.result;
  if(result?.kind!=='clarification')return;
  const choice=(result.clarification||result.frontier?.clarification)?.options?.[Number(b.dataset.agentChoice)];if(!choice)return;
  agentState.reply=choice.reply;agentState.error='';refreshAgentUi();$('agent-reply')?.focus?.();
 });
 if($('agent-reply-form'))$('agent-reply-form').onsubmit=async e=>{e.preventDefault();await submitAgentQuestion(agentState.reply,{reply:true})};
 if($('agent-new-conversation'))$('agent-new-conversation').onclick=async()=>{
  if(agentState.busy||!agentCanAsk())return;agentState.busy=true;agentState.error='';refreshAgentUi();
  try{if(agentState.conversation?.id)await agentRequest('/api/agent/conversations/'+encodeURIComponent(agentState.conversation.id)+'/forget',{});agentState.conversation=null;resetAgentAnswerView();agentState.task=null;agentState.prompt='';agentState.reply=''}catch(error){if([401,404].includes(error.status)){agentState.conversation=null;resetAgentAnswerView();agentState.task=null;agentState.prompt='';agentState.reply=''}else agentState.error=error.message}
  finally{agentState.busy=false;refreshAgentUi()}
 };
 if($('agent-stop'))$('agent-stop').onclick=async()=>{if(!agentState.task?.id)return;try{agentState.task=await agentRequest('/api/agent/tasks/'+encodeURIComponent(agentState.task.id)+'/cancel',{});scheduleAgentPoll()}catch(error){agentState.error=error.message}refreshAgentUi()};
 if($('agent-copy'))$('agent-copy').onclick=async()=>{try{await navigator.clipboard.writeText(agentState.task.output);$('agent-copy').textContent='Copied'}catch{$('agent-copy').textContent='Select the result to copy'}};
 bindAgentAccessUI();
}
function focusAgentUnlock(){const input=$('agent-access-code');input?.scrollIntoView?.({behavior:'smooth',block:'center'});input?.focus?.({preventScroll:true})}


function bindAgentAccessUI(){
 if($('agent-refresh'))$('agent-refresh').onclick=refreshAgentStatus;
 if($('agent-unlock'))$('agent-unlock').onsubmit=async e=>{
  e.preventDefault();if(agentState.unlocking)return;const input=$('agent-access-code'),code=input.value;input.value='';agentState.unlocking=true;agentState.unlockError='';refreshAgentUi();
  try{await agentRequest('/api/agent/unlock',{code});await refreshAgentStatus()}catch(error){agentState.unlockError=error.message}
  finally{agentState.unlocking=false;refreshAgentUi()}
 };
 if($('agent-lock'))$('agent-lock').onclick=async()=>{try{await agentRequest('/api/agent/lock',{});await refreshAgentStatus()}catch(error){agentState.statusError=error.message;refreshAgentUi()}};
 if(!agentState.checking&&!agentState.statusError&&(!agentState.connection||Date.now()-agentState.checkedAt>60000))void refreshAgentStatus();
}

function agentFrontierDetails(f){
 const status=f.claim?.type==='descriptive_comparison'?'Descriptive comparison':{SOURCE_REPORTED:'Source-reported observation',DERIVED_DESCRIPTIVE:'Descriptive calculation',CONDITIONAL_MODEL:'Conditional prediction from your examples',CAUSAL_EVIDENCE_MISSING:'Causal evidence missing',COMPARISON_REFERENCE_MISSING:'Comparison baseline missing',POPULATION_MISMATCH:'Population mismatch',DERIVATION_EXPLAINED:'Calculation explained'}[f.epistemic_status]||String(f.epistemic_status||'Unresolved').toLowerCase().replaceAll('_',' ');
 return `${f.v4?agentV4Html(f.v4):''}${f.interpretation?agentInterpretationHtml(f):''}${agentCollectionHtml(f.architecture?.collection)}<p class="subtle">Claim status: ${esc(status)}</p><details><summary>About this experimental runtime</summary><p>Uses the locked V4 general.7 task controller, guarded dashboard adapters and the isolated original V1 mechanism lab. These are bounded rules; no AI provider or live web search is used.</p><p>Runtime: ${esc(f.version)}<br>Original components used for this response: ${esc((f.original_components_used||[]).join(', ')||'None')}</p><p>New interfaces: ${esc((f.new_interfaces||[]).join('; '))}</p>${f.source_sha256?`<p>Original source SHA-256: <code>${esc(f.source_sha256)}</code></p>`:''}</details>`;
}

function agentV4Html(v){
 const q=v.answer_quality||{},c=v.collection||{};
 return `<details class="agent-interpretation"><summary>V4 task and answer checks</summary><p>Task: ${esc(v.selected_task)} · Operator: ${esc(v.operator.replaceAll('_',' '))}</p><p>Requirements: ${esc((v.task_plan?.problem?.requirements||[]).join(', ')||'None')}</p><p>V4 admitted ${esc(c.packet_count??0)} supplied records before task inference. ${c.complete?'Admission completed.':'Admission incomplete.'}</p><p>Explanatory coverage: ${esc(q.explanatory_coverage||'UNASSESSED')}. Meaning completeness and independent truth remain unassessed.</p><p>Task rankings are not calibrated confidence scores. Dashboard-only evidence; live web search is disabled.</p><p>Locked source: ${esc(v.version)}</p></details>`;
}

function agentCollectionHtml(collection){
 if(!collection||collection.version!=='frontier-evidence-collection-1'||!Array.isArray(collection.tasks))return '';
 const count=Number.isSafeInteger(collection.packet_count)&&collection.packet_count>=0?collection.packet_count:'Unavailable';
 const conflicts=Number.isSafeInteger(collection.conflict_count)&&collection.conflict_count>=0?collection.conflict_count:'Unavailable';
 return `<details class="agent-collection"><summary>Evidence collection</summary><p>${collection.complete?'Collection completed.':'Collection is incomplete; some findings may be missing.'} ${esc(count)} source records were merged before interpreting the question.</p><p>Conflicting observation groups: ${esc(conflicts)}. Conflicting values stay separate; collection does not independently verify a source.</p><ul>${collection.tasks.slice(0,32).map(task=>`<li>${esc(task.id)}: ${esc(String(task.status||'unknown').replaceAll('_',' '))} · ${esc(task.packet_count)} records</li>`).join('')}</ul>${collection.quarantined_sources?.length?'<p>Incompatible versions using the same source identifier were excluded.</p>':''}<p class="subtle">These collectors read supplied dashboard evidence. They do not search the web.</p></details>`;
}

function agentWordMatchingHtml(items){
 if(!items?.length)return '';
 return `<div class="agent-word-matching"><p>Original words are preserved. Spelling similarity is not a probability of shared meaning.</p><ul>${items.map(item=>`<li><strong>${esc(item.word)}</strong>${item.known_external_sense?' · '+esc(item.known_external_sense):''}: ${(item.candidates||[]).map(c=>esc(c.term)+' (spelling similarity '+esc((100*c.surface_similarity).toFixed(1))+'%)').join('; ')}. Meaning probability: unavailable; calibration required.</li>`).join('')}</ul></div>`;
}

function agentWholeRequestHtml(r){
 if(!r?.answer_requirements?.length)return '';
 const labels={group_levels:'Report each group’s values',percentage_point_gaps:'Report gaps in percentage points',compare_gap_sizes:'Identify the larger gap',source_periods:'Retain source years',coverage_limits:'Explain geographic, sex and period coverage',comparability_limits:'Explain comparison limits'};
 return `<div class="agent-whole-request"><p><strong>One request, understood before execution planning.</strong> Answer requirements stay attached to your request.</p><ul>${r.answer_requirements.map(q=>`<li>${esc(labels[q.kind]||q.kind)} · ${esc(q.status.toLowerCase().replaceAll('_',' '))}</li>`).join('')}</ul></div>`;
}

function agentInterpretationHtml(f){
 return `<details class="agent-interpretation"><summary>What SIYA understood</summary>${agentWholeRequestHtml(f.interpretation.contract?.request_structure)}${agentSemanticHtml(f.interpretation.semantic)}${agentWordMatchingHtml(f.interpretation.lexical_grounding)}${f.regime==='examples_only'?'<p>Example-only regime: no dashboard grounding.</p>':''}${f.interpretation.inherited_context?'<p>Used the previous question or a pending clarification.</p>':''}<ol>${f.interpretation.frames.map(q=>`<li>${esc(q.operation)}${q.related_dimensions?.length?' · '+esc(q.related_dimensions.map(d=>d.label).join(' alongside ')):q.metric?' · '+esc(q.metric):q.topic?' · '+esc(q.topic):''}${q.sex?' · '+esc(q.sex):''}${q.population?' · '+esc(q.population):''}${q.source_years?' · '+esc(q.source_years.join(', ')):''}${q.groups?' · '+esc(q.comparison_kind==='difference'&&q.groups.length===2?q.groups[1]+' minus '+q.groups[0]:q.groups.join(' versus ')):''}</li>`).join('')}</ol>${f.interpretation.excluded_metrics?.length?`<p>Excluded: ${esc(f.interpretation.excluded_metrics.join(', '))}.</p>`:''}${f.plan?.length?`<p>Request results: ${esc(f.plan.map(p=>p.operation+' ('+p.status+')').join('; '))}.</p>`:''}</details>`;
}

function agentSemanticHtml(graph){
 if(!graph)return '';
 const nodes=new Map(graph.nodes.map(n=>[n.id,n]));
 const labels={comparison_reference:'comparison baseline',safety_measure:'specific safety measure',security_meaning:'meaning of security',outcome:'affected outcome',unsupported_relation_target:'intended relationship direction'};
 return `<p>${esc(graph.summary)}</p><p>Goal: ${esc(graph.intent.replaceAll('_',' '))}${graph.population?' · Population: '+esc(graph.population.label):''}</p>${graph.edges.length?`<ul>${graph.edges.slice(0,6).map(e=>`<li>${esc(nodes.get(e.source)?.label||'Unknown')} → ${esc(e.polarity==='negative'?'does not '+({protects:'protect',affects:'affect',causes:'cause',contributes_to:'contribute to'}[e.relation]||e.relation.replaceAll('_',' ')):e.relation.replaceAll('_',' '))} → ${esc(nodes.get(e.target)?.label||'Unknown')}${e.status==='presupposed_unverified'?' (unverified assumption)':''}</li>`).join('')}</ul>`:''}${graph.unresolved.length?`<p>Missing details: ${esc(graph.unresolved.map(s=>labels[s]||s).join('; '))}.</p>`:''}<p class="subtle">These relationships describe your question. Establishing them requires evidence.</p>`;
}
