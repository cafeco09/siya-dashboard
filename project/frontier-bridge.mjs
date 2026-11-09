import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dialoguePacket,validateDialogue} from './evidence-dialogue.mjs';

const script=fileURLToPath(new URL('./frontier/runtime_cli.py',import.meta.url));
const version='siya-frontier-v4-general7-exp1';
const sourceHash='e58b65e5e1abf435e98962a9cc2d5bcb81e2dc42c11720f42472257554e17132';
export const frontierInfo={version,sourceHash,externalAI:false};

export function runFrontierProcess(request,{signal,timeoutMs=10000,spawnImpl=spawn}={}){
 const input=JSON.stringify(request);if(Buffer.byteLength(input)>262144)return Promise.reject(Error('The Frontier evidence context exceeds its supported size.'));
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new DOMException('Aborted','AbortError'));return}
  // No shell, user-chosen command, key, database URL or mail credentials enter
  // the child. The only input is the server-owned evidence and conversation.
  const child=spawnImpl('python3',['-B',script],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH||'/usr/bin:/bin',LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1'},windowsHide:true});
  let output='',size=0,done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value)};
  const abort=()=>{child.kill('SIGKILL');finish(new DOMException('Aborted','AbortError'))};
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('Frontier reached its processing time limit. Narrow the request.'))},timeoutMs);timer.unref?.();
  signal?.addEventListener('abort',abort,{once:true});
  child.on('error',()=>finish(Error('The Frontier Python runtime is unavailable. Check the deployment build.')));
  child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size>1000000){child.kill('SIGKILL');finish(Error('Frontier returned more data than supported.'));return}output+=chunk});
  child.on('close',code=>{if(done)return;if(code!==0){finish(Error('Frontier could not validate or process this input. No provider fallback was attempted.'));return}try{const result=JSON.parse(output);if(result?.error)throw Error();finish(null,result)}catch{finish(Error('Frontier returned an invalid result. No provider fallback was attempted.'))}});
  child.stdin.end(input);
 });
}

export async function frontierDialogue(snapshot,prompt,conversation,{signal,timeoutMs,regime='evidence',runImpl=runFrontierProcess}={}){
 const scoped=regime==='examples_only'?{country:{iso3:'LAB',name:'Example-only lab'},selectedYear:null,sourceTables:{}}:snapshot;
 const context={...scoped,regime,contextCoverage:{omittedRows:{},missingTables:Object.entries(scoped.sourceTables).filter(([,r])=>r.length<2).map(([name])=>name),limited:false}};
 const packet=dialoguePacket(context);
 const previous=conversation.turns.at(-1)?.result?.frontier?.memory||{};
 // A named-country switch may reuse the question's typed slots, never facts,
 // source references, pagination or a learned model from the previous country.
 const memory=conversation.scopeChanged?{...(previous.query?{query:previous.query}:{}),...(previous.semantic_context?{semantic_context:previous.semantic_context}:{})}:previous;
 const result=await runImpl({packet,prompt,memory},{signal,timeoutMs});
 const f=result?.frontier;
 if(!f||f.version!==version||f.source_sha256!==sourceHash||f.payload_preserved!==true||!Array.isArray(f.trace)||f.trace.length>20||!Array.isArray(f.original_components_used)||!f.memory||JSON.stringify(f.memory).length>60000)throw Error('Frontier returned an unsupported runtime contract.');
 if(f.v4?.version!=='4.0.0-general.7-locked'||f.v4.release_locked!==true||f.v4.web_enabled!==false||f.v4.probability_of_correctness!==null||!['revise','challenge','decide','compare','calculate','explain','lookup','converse','clarify'].includes(f.v4.selected_task))throw Error('Frontier returned an invalid V4 controller contract.');
 const graph=f.interpretation?.semantic;
 const clarification=f.clarification;
 if(clarification&&(result.kind!=='clarification'||clarification.kind!=='comparison_selection'||clarification.allow_free_text!==true||typeof clarification.question!=='string'||clarification.question.length>300||!Array.isArray(clarification.options)||clarification.options.length<1||clarification.options.length>4||new Set(clarification.options.map(o=>o.id)).size!==clarification.options.length||clarification.options.some(o=>typeof o.id!=='string'||!/^\w{1,40}$/.test(o.id)||typeof o.label!=='string'||!o.label.trim()||o.label.length>160||typeof o.reply!=='string'||!o.reply.trim()||o.reply.length>3000)))throw Error('Frontier returned invalid clarification options.');
 if(graph){
  const fail=()=>{throw Error('Frontier returned an invalid semantic graph.')};
  if(graph.version!=='siya-relations-1'||graph.method!=='supplied_rule_based_relation_grammar'||!['causal_explanation','derivation','descriptive_evidence','descriptive_comparison','arithmetic_difference'].includes(graph.intent)||typeof graph.text!=='string'||graph.text.length>4000||typeof graph.summary!=='string'||graph.summary.length>1200||!Array.isArray(graph.nodes)||graph.nodes.length>40||!Array.isArray(graph.edges)||graph.edges.length>40)fail();
  const ids=new Set();
  for(const n of graph.nodes){if(!/^n\d+$/.test(n.id)||ids.has(n.id)||n.origin!=='question'||typeof n.label!=='string'||n.label.length>300)fail();ids.add(n.id)}
  for(const e of graph.edges)if(!ids.has(e.source)||!ids.has(e.target)||!['positive','negative'].includes(e.polarity)||!['requested','presupposed_unverified'].includes(e.status))fail();
 }
 const lexical=f.interpretation?.lexical_grounding;
 if(lexical&&(!Array.isArray(lexical)||lexical.length>48||lexical.some(item=>typeof item.word!=='string'||item.word.length>300||item.semantic_probability!==null||item.calibration_status!=='not_calibrated'||item.action!=='preserve_original_word'||!Array.isArray(item.candidates)||item.candidates.length>4||item.candidates.some(c=>typeof c.term!=='string'||c.term.length>300||!Number.isFinite(c.surface_similarity)||c.surface_similarity<0||c.surface_similarity>1))))throw Error('Frontier returned invalid lexical grounding or an uncalibrated meaning probability.');
 const contract=f.interpretation?.contract;
 if(contract){
  const ids=f.interpretation.frames.map(q=>q.task_id),tasks=contract.tasks;
  if(contract.version!=='siya-task-plan-1'||!Array.isArray(tasks)||tasks.length<1||tasks.length>4||new Set(tasks.map(t=>t.id)).size!==tasks.length||(!['BLOCKED_BY_SCOPE'].includes(contract.status)&&JSON.stringify(ids)!==JSON.stringify(tasks.map(t=>t.id)))||tasks.some(t=>typeof t.source_text!=='string'||t.source_text.length>3000||typeof t.execution_status!=='string'||!Array.isArray(t.evidence_refs)))throw Error('Frontier returned an incomplete task contract.');
  const request=contract.request_structure;
  if(request&&(request.version!=='siya-whole-request-1'||request.method!=='whole_request_then_scoped_plan'||request.question_is_evidence!==false||typeof request.text!=='string'||request.text.length>4000||!['PLANNED','PENDING','FULFILLED','PARTIAL'].includes(request.status)||!Array.isArray(request.answer_requirements)||request.answer_requirements.length>16||request.answer_requirements.some(r=>!['group_levels','percentage_point_gaps','compare_gap_sizes','source_periods','coverage_limits','comparability_limits'].includes(r.kind)||!['PENDING','FULFILLED','PARTIAL','UNRESOLVED'].includes(r.status)||typeof r.source_text!=='string'||r.source_text.length>3000||!Array.isArray(r.depends_on)||r.depends_on.some(id=>!tasks.some(t=>t.id===id))||(r.evidence_refs||[]).some(id=>!packet.referenceIndex.some(p=>p.id===id)))))throw Error('Frontier returned an invalid whole-request structure.');
 }
 // A conditional prediction is based on user-asserted examples rather than
 // published dashboard rows. It has a distinct claim type, source and status;
 // every ordinary evidence answer still requires valid published references.
 const conditional=result.kind==='answer'&&f.epistemic_status==='CONDITIONAL_MODEL'&&f.claim?.type==='conditional_prediction'&&f.claim?.source==='user_asserted_examples'&&['learn_operators','apply_operator','parse_story'].every(c=>f.original_components_used.includes(c));
 const userCalculation=result.kind==='answer'&&f.v4.operator==='v4_calculate'&&f.epistemic_status==='V4_USER_CALCULATION'&&f.claim?.type==='user_expression_calculation'&&f.claim.source==='user_supplied_expression'&&Number.isFinite(f.claim.value)&&typeof f.claim.expression==='string'&&/^[\d\s.()+*/%^-]+$/.test(f.claim.expression)&&result.evidence_refs.length===0;
 const validated=validateDialogue(JSON.stringify({kind:conditional||userCalculation?'clarification':result.kind,message:result.message,evidence_refs:result.evidence_refs,limitations:result.limitations}),packet);
 return {...validated,kind:result.kind,method:'Frontier V4 controller with guarded dashboard adapters',externalAI:false,historyOmitted:conversation.dropped,frontier:f};
}
