import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentService} from './agent.mjs';
import {frontierDialogue,runFrontierProcess} from './frontier-bridge.mjs';

function service(){return createAgentService({dataPath:new URL('./public/data.json',import.meta.url),env:{},fetchImpl:async()=>{throw Error('No network permitted')}})}
async function ask(s,prompt,previous){
 let t=await s.start({mode:'frontier',scope:'question',prompt,...(previous?{conversationId:previous.conversationId}:{})});
 for(let i=0;i<1000&&!['completed','failed'].includes(t.status);i++){
  await new Promise(r=>setTimeout(r,5));t=s.get(t.id);
 }
 assert.equal(t.status,'completed',t.error);return t;
}

test('V4 handles arithmetic without a country or fabricated evidence and explains its own lineage',async()=>{
 const s=service();try{
  const t=await ask(s,'Calculate (12 + 8) / 4');
  assert.match(t.output,/= 5/);assert.equal(t.dialogue.kind,'answer');assert.equal(t.dialogue.references.length,0);
  assert.equal(t.dialogue.frontier.v4.operator,'v4_calculate');assert.equal(t.dialogue.frontier.v4.release_locked,true);
  assert.equal(t.dialogue.frontier.claim.source,'user_supplied_expression');
  const follow=await ask(s,'sources',t);assert.match(follow.output,/your numeric expression/);assert.equal(follow.dialogue.references.length,0);
  const country=await ask(s,'Japan',t);assert.doesNotMatch(country.output,/= 5/);
 }finally{await s.close()}
});

test('V4 contextual operators do not ask for a country or self-verify an inference',async()=>{
 const s=service();try{
  const t=await ask(s,'Help me decide');assert.match(t.output,/deciding between/);assert.equal(t.dialogue.scopePending,undefined);
  const first=await ask(s,'Compare reading in Japan and South Korea');
  const challenge=await ask(s,"That doesn't follow",first);
  assert.match(challenge.output,/not established/);assert.equal(challenge.dialogue.frontier.v4.selected_task,'challenge');
  const revise=await ask(s,'Make it shorter',first);assert.match(revise.output,/lineage/);assert.equal(revise.dialogue.kind,'clarification');
 }finally{await s.close()}
});

test('V4 admission precedes the guarded two-country adapter and never makes causal evidence from a question',async()=>{
 const s=service();try{
  const t=await ask(s,"Compare Japan's and South Koreas home based violence figures wrt workforce");
  const v=t.dialogue.frontier.v4;assert.equal(v.collection.packet_count,106);assert(v.collection.complete);
  assert.deepEqual(v.execution_order,['admit_supplied_evidence','infer_task','execute_operator','check_answer']);
  assert.equal(v.operator,'guarded_dashboard_adapter');assert.equal(t.dialogue.references.length,6);
  const why=await ask(s,'Why are girls in Japan performing better than girls in South Korea?');
  assert.notEqual(why.dialogue.kind,'answer');assert.equal(why.dialogue.frontier.v4.answer_quality.explanatory_coverage,'UNKNOWN');
  assert.equal(why.dialogue.frontier.v4.probability_of_correctness,null);assert.equal(why.dialogue.frontier.v4.web_enabled,false);
 }finally{await s.close()}
});

test('V4 invalid arithmetic and adapter metadata cannot bypass the response contract',async()=>{
 const s=service();try{const t=await ask(s,'Calculate 1 / 0');assert.equal(t.dialogue.kind,'clarification');assert.equal(t.dialogue.frontier.claim,null)}finally{await s.close()}
 const snapshot={country:{iso3:'TEST',name:'Test'},selectedYear:null,sourceTables:{}};
 await assert.rejects(frontierDialogue(snapshot,'hi',{turns:[],dropped:0},{runImpl:async()=>({frontier:{version:'siya-frontier-v4-general7-exp1',source_sha256:'e58b65e5e1abf435e98962a9cc2d5bcb81e2dc42c11720f42472257554e17132',payload_preserved:true,trace:[],original_components_used:[],memory:{},v4:{version:'fake'}}})}),/V4 controller contract/);
});

test('ordinary Iran work questions bind the shared work concept and retain exact records through follow-ups',async()=>{
 const s=service();try{
  for(const prompt of ['Tell me more about working women of Iran','Tell me more about women in work of Iran']){
   const t=await ask(s,prompt);assert.equal(t.country,'IRN');assert.equal(t.dialogue.kind,'answer');
   const f=t.dialogue.frontier;assert.equal(f.interpretation.frames[0].metric,'work_profile');
   assert.equal(f.interpretation.frames[0].topic,'work');assert.equal(f.interpretation.frames[0].sex,'female');
   assert(f.interpretation.semantic.nodes.some(n=>n.concept==='work_profile'));
   assert.match(t.output,/Female labour participation/);assert.match(t.output,/Female employment/);
   assert.match(t.output,/not the same as employment/);assert.doesNotMatch(t.output,/The source reports GDP|QUESTION_UNRESOLVED|learning evidence/);
   assert(t.dialogue.references.length>0);assert(t.dialogue.references.every(r=>r.table==='Workforce GDP'&&r.values[r.headers.indexOf('ISO3')]==='IRN'));
   const sources=await ask(s,'sources',t);assert.deepEqual(sources.dialogue.references.map(r=>r.id),t.dialogue.references.map(r=>r.id));
   const next=await ask(s,'next records',t);assert.equal(next.dialogue.kind,'answer');assert.equal(next.dialogue.frontier.memory.query.metric,'work_profile');
   const switched=await ask(s,'What about Japan?',t);assert.equal(switched.country,'JPN');assert(switched.dialogue.references.every(r=>r.values[r.headers.indexOf('ISO3')]==='JPN'));
  }
 }finally{await s.close()}
});

test('a broad work profile does not replace a precise measure, invent earnings or relabel female rates as male',async()=>{
 const s=service();try{
  const exact=await ask(s,'Show female employment for working women in Iran in 2023');
  assert.equal(exact.dialogue.frontier.interpretation.frames.length,1);assert.equal(exact.dialogue.frontier.interpretation.frames[0].metric,'employment');
  assert.doesNotMatch(exact.output,/The source reports Female labour participation|The source reports GDP/);
  const age=await ask(s,'At what age do working women in Iran start earning?');assert.notEqual(age.dialogue.kind,'answer');assert.equal(age.dialogue.frontier.interpretation.frames[0].unresolved_constraint,'employment_entry_age');
  const men=await ask(s,'Tell me about working men in Iran');assert.notEqual(men.dialogue.kind,'answer');assert.match(men.output,/sex-specific/);
  const no=await ask(s,'Show working women in Iran, not employment');assert.doesNotMatch(no.output,/The source reports Female employment/);
 }finally{await s.close()}
});

test('an independent cross-tab source request retains clarification choices in the same conversation',async()=>{
 const s=service();try{
  const t=await ask(s,'Compare Japan and South Korea’s intimate-partner violence figures alongside women’s workforce participation. Show the sources for both countries.');
  assert.equal(t.dialogue.kind,'clarification');const c=t.dialogue.frontier.clarification;
  assert.equal(c.options.length,3);assert.equal(c.allow_free_text,true);assert.equal(new Set(c.options.map(o=>o.id)).size,3);
  assert.match(c.options[0].reply,/intimate partner violence/);assert.match(c.options[1].reply,/workforce participation.*\b20\d{2}\b/);assert.match(c.options[2].reply,/alongside/);
  for(const option of c.options){
   const selected=await ask(s,option.reply,t);assert.equal(selected.conversationId,t.conversationId);assert.equal(selected.country,'JPN+KOR');assert.equal(selected.dialogue.kind,'answer',option.reply);
   assert(selected.dialogue.references.length>0&&selected.dialogue.references.length<=6);assert.match(selected.output,/Japan:/);assert.match(selected.output,/South Korea:/);
  }
 }finally{await s.close()}
});


test('the bridge refuses malformed suggested-reply contracts',async()=>{
 const snapshot={country:{iso3:'TEST',name:'Test'},selectedYear:null,sourceTables:{}};
 await assert.rejects(frontierDialogue(snapshot,'hi',{turns:[],dropped:0},{runImpl:async request=>{
  const r=await runFrontierProcess(request);
  r.frontier.clarification={kind:'comparison_selection',question:'Choose',allow_free_text:true,options:[{id:'same',label:'One',reply:'One'},{id:'same',label:'Two',reply:'Two'}]};return r;
 }}),/invalid clarification options/);
});

test('one complex Pakistan prompt retains its comparisons, ranking and coverage obligations',async()=>{
 const s=service();try{
  const t=await ask(s,'Compare reading and numeracy between the richest and poorest households in Pakistan. Show each group’s percentages and the gaps in percentage points, identify which gap is larger, and explain the limits of the evidence’s geographic, sex and source-year coverage.');
  assert.equal(t.dialogue.kind,'answer');const f=t.dialogue.frontier,c=f.interpretation.contract;
  assert.equal(c.tasks.length,2);assert.equal(c.request_structure.status,'FULFILLED');assert.equal(c.request_structure.answer_requirements.length,4);
  assert.match(t.output,/Reading: 36\.73 percentage points; Numeracy: 11\.00 percentage points/);assert.match(t.output,/largest absolute gap is for Reading/);
  assert.match(t.output,/not a national estimate/);assert.match(t.output,/does not establish girls-only/);assert.match(t.output,/2018-2019/);
  assert.equal(t.dialogue.references.length,2);assert.equal(f.v4.request_plan.method,'whole_request_then_scoped_plan');
  const next=await ask(s,'sources',t);assert.equal(next.dialogue.references.length,2);
 }finally{await s.close()}
});

test('cross-tab comparison keeps source-year and limitation instructions attached to one request',async()=>{
 const s=service();try{
  const t=await ask(s,'Compare Japan and South Korea’s intimate-partner violence figures alongside women’s workforce participation. Include the source years and explain any limits to the comparison.');
  assert.equal(t.dialogue.kind,'answer');const c=t.dialogue.frontier.interpretation.contract;
  assert.equal(c.tasks.length,1);assert.equal(c.request_structure.status,'FULFILLED');assert.equal(c.request_structure.answer_requirements.length,2);
  assert.match(t.output,/do not show violence rates among employed women/);assert.equal(t.dialogue.references.length,6);
 }finally{await s.close()}
});

test('the bridge refuses an answer obligation claiming an unknown source record',async()=>{
 const snapshot={country:{iso3:'TEST',name:'Test'},selectedYear:null,sourceTables:{'Family background MICS':[
  ['Population','Sex coverage','Subject','Survey year','Poorest (%)','Richest (%)'],['Children aged 7–14','Girls and boys combined','Reading',2019,10,25]
 ]}};
 await assert.rejects(frontierDialogue(snapshot,'Compare reading between richest and poorest households',{turns:[],dropped:0},{runImpl:async request=>{
  const r=await runFrontierProcess(request);r.frontier.interpretation.contract.request_structure.answer_requirements=[{id:'R1',kind:'source_periods',source_text:'Include source years',status:'FULFILLED',depends_on:['T1'],evidence_refs:['ev_fabricated']}];return r;
 }}),/invalid whole-request structure/);
});

test('C2 recovers a reported value past empty rows without crossing the country or population scope',async()=>{
 const countries=[{iso3:'IND',name:'India'},{iso3:'PAK',name:'Pakistan'}];
 const headers=['ISO3','Geography','Geographic level','Population','Sex','Survey year','Reading (%)'];
 const india=['IND','India','national','Children aged 7–14','Girls','2021'];
 const pakistan=['PAK','Pakistan','national','Children aged 7–14','Girls','2021'];
 const snapshot={country:{iso3:'IND+PAK',name:'India and Pakistan'},countries,
  availableCountries:countries,selectedYear:null,sourceTables:{'MICS learning':[
   headers,['IND','India','national','Children aged 7–14','Boys','2021',99],
   ...[2017,2018,2019,2020].map(year=>[...india.slice(0,-1),String(year),null]),
   [...india,0],[...pakistan,25],
  ]}};
 const prompt='Compare girls’ reading in India and Pakistan';
 const state={turns:[],dropped:0};
 const baseline=await frontierDialogue(snapshot,prompt,state);
 assert.equal(baseline.kind,'unresolved');
 assert.equal(baseline.frontier.claim.difference,null);
 const candidate=await frontierDialogue({...snapshot,c2Comparison:true},prompt,state);
 assert.equal(candidate.kind,'answer');
 assert.equal(candidate.frontier.claim.difference,'25');
 assert.equal(candidate.references.find(r=>r.values[0]==='IND').values.at(-1),0);
 assert.deepEqual(candidate.frontier.c2_comparison.gaps.map(g=>[g.country,g.status]),[['IND','RECOVERED']]);
});

test('C2 keeps the reading measure on a residence follow-up and preserves scope limits in sources',async()=>{
 const s=service();try{
  const partial=await ask(s,'Compare girls’ reading outcomes in India and Pakistan.');
  assert.equal(partial.dialogue.frontier.epistemic_status,'PARTIAL_COUNTRY_COVERAGE');
  assert.deepEqual(partial.dialogue.frontier.claim.reported_countries,['PAK']);
  assert.equal(partial.dialogue.frontier.claim.difference,null);
  assert.match(partial.output,/Pakistan \(Sindh\)/);
  const rural=await ask(s,'What about rural girls?',partial);
  assert.equal(rural.country,'IND+PAK');
  assert.equal(rural.dialogue.kind,'unresolved');
  const frame=rural.dialogue.frontier.interpretation.frames[0];
  assert.equal(frame.metric,'reading');
  assert.equal(frame.sex,'female');
  assert.deepEqual(frame.groups,['Rural (%)']);
  assert.deepEqual(rural.dialogue.frontier.claim.reported_countries,[]);
  assert.match(rural.output,/reading \(girls, rural\)/);
  const sources=await ask(s,'sources',rural);
  assert.equal(sources.dialogue.kind,'unresolved');
  assert.match(sources.output,/document coverage limits/);
  assert.deepEqual(sources.dialogue.references.map(r=>r.id),rural.dialogue.references.map(r=>r.id));
 }finally{await s.close()}
});

test('C2 distinguishes an unmeasured explanatory factor from the observed violence outcome',async()=>{
 const s=service();try{
  const result=await ask(s,'Does patriarchy explain the violence pattern in Japan and South Korea?');
  assert.equal(result.dialogue.kind,'unresolved');
  assert.equal(result.dialogue.frontier.epistemic_status,'CAUSAL_EVIDENCE_MISSING');
  assert.match(result.output,/no dashboard indicator labelled for patriarchy/);
  assert.deepEqual(result.dialogue.references,[]);
  assert.deepEqual(result.dialogue.frontier.c2_comparison.gaps.map(g=>g.status),
   ['CAUSAL_DESIGN_REQUIRED','CAUSAL_DESIGN_REQUIRED']);
 }finally{await s.close()}
});

test('suggested follow-ups distinguish a calculated gap from missing country evidence',async()=>{
 const s=service();try{
  const partial=await ask(s,'Compare girls’ reading outcomes in India and Pakistan.');
  const {dialogue}=await s.present(partial);
  assert.equal(dialogue.suggestedReplies[0].prompt,'sources');
  const research=dialogue.suggestedReplies[1].prompt;
  assert.equal(research,'Plan research for missing reading evidence for girls in India.');
  const plan=await ask(s,research,partial);
  assert.equal(plan.dialogue.frontier.epistemic_status,'RESEARCH_PLAN');
  const view=await s.present(plan);
  assert.deepEqual(view.conversation.turns[0].result.suggestedReplies,[]);
  assert.match(view.dialogue.suggestedReplies[0].prompt,/^Draft an evidence request/);

  const compare=await ask(s,'Compare reading between the richest and poorest households in Pakistan.');
  const questions=(await s.present(compare)).dialogue.suggestedReplies;
  assert(questions.some(q=>q.prompt==='How was that calculated?'));
  const related=questions.find(q=>q.prompt==='What about numeracy?');
  assert(related);
  const next=await ask(s,related.prompt,compare);
  assert.equal(next.dialogue.frontier.claim.comparison.subject,'Numeracy');
  assert.deepEqual(next.dialogue.frontier.claim.comparison.rows.map(r=>r.group),['Poorest households','Richest households']);
  assert.deepEqual((await s.present(compare,{admin:true})).dialogue.suggestedReplies,questions);
 }finally{await s.close()}
});
