// Public presentation is derived from server-owned context; diagnostics never enter this projection.
const clone=value=>structuredClone(value);
const implementationLimit=/Experimental V1 extension|V4 controller with guarded|Uses the original V1|V4 uses bounded|original registered vocabulary|finite operator family/i;
function publicDialogue(result,conversation,catalog){
 if(!result)return null;
 const f=result.frontier||{};
 const references=(result.references||[]).map(r=>({title:r.table,sourceUrls:clone(r.sourceUrls||[])}));
 const view={publicDisplay:true,kind:result.kind,message:result.message,
  limitations:(result.limitations||[]).filter(s=>!implementationLimit.test(s)),references,
  suggestedReplies:dialogueSuggestions(conversation,catalog)};
 if(f.claim?.type==='descriptive_comparison'&&f.claim.comparison){
  const c=f.claim.comparison;
  view.comparison={mode:c.mode,subject:c.subject,rows:c.rows.map(r=>({group:r.group,value:r.value})),
   summary:c.summary,explanation:c.interpretation,gap_text:c.gap_text,
   context:{geography:c.context.geography,period:c.context.period,population:c.context.population,sex:c.context.sex},
   scope_note:c.scope_note,caveat:c.caveat};
 }
 if(f.clarification)view.clarification={question:f.clarification.question,
  options:f.clarification.options.map(({id,label,reply})=>({id,label,reply}))};
 if(f.regime==='examples_only')view.limitations.push('Results in this lab use your supplied examples; they are not independently verified real-world findings.');
 if(f.epistemic_status==='CONDITIONAL_MODEL')view.answerType='example_prediction';
 if(f.epistemic_status==='V4_USER_CALCULATION')view.answerType='calculation';
 return view;
}

export function presentTask(task,{admin=false,catalog=[]}={}){
 if(admin)return clone(task);
 const {id,status,mode,country,year,createdAt,updatedAt,output,conversationId}=task;
 const conversation=task.conversation?{id:task.conversation.id,country:task.conversation.country,
  year:task.conversation.year,engine:task.conversation.engine,turns:task.conversation.turns.map((turn,i)=>({
   prompt:turn.prompt,result:publicDialogue(turn.result,{...task.conversation,turns:task.conversation.turns.slice(0,i+1)},catalog)
  }))}:null;
 const dialogue=publicDialogue(task.dialogue,task.conversation,catalog);
 const progress={queued:'Waiting to start',running:'Preparing your answer',cancelling:'Stopping',cancelled:'Stopped',failed:'SIYA could not complete this request',completed:dialogue?.kind==='clarification'?'Your reply is needed':dialogue?.kind==='unresolved'?'Some evidence is missing':'Answer ready'}[status]||'Working';
 return {id,status,mode,country,year,createdAt,updatedAt,output,conversationId,conversation,dialogue,progress,
  cleanup:task.cleanup==='Pending'?'Pending':'Completed',provider:'frontier',
  error:task.error?'SIYA could not complete this request. Please try again or start a new conversation.':null};
}
const frontierReasoningExample=`Learn:
Anna boosts Bob from 2 to 3.
Anna boosts Bob from 4 to 5.
Predict:
Bob starts at 7.
Anna boosts Bob.`;

export function dialogueSuggestions(c,catalog=[]){
 const name=code=>catalog.find(r=>r[1]===code)?.[2]||code;
 const turn=c?.turns?.at(-1);if(!turn?.result)return [];
 const result=turn.result,f=result.frontier||{},frames=f.interpretation?.frames||[];
 if(result.kind==='clarification'&&f.clarification?.options?.length)return [];
 const blockedTask=(f.plan||[]).find(p=>['EVIDENCE_MISSING','VALUE_MISSING','POPULATION_MISMATCH','CAUSAL_EVIDENCE_MISSING','COMPARISON_REFERENCE_MISSING','SCOPE_UNRESOLVED','ACTION_NOT_AUTHORISED'].includes(p.status));
 const query=(blockedTask?frames.find(q=>q.task_id===blockedTask.task_id):null)||frames.find(q=>q.topic)||f.memory?.query||{};
 const status=blockedTask?.status||f.epistemic_status;
 const task=f.interpretation?.contract?.tasks?.find(t=>t.id===query.task_id);
 const prompt=String(turn.prompt||'');
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
