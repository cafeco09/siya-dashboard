import {readFile} from 'node:fs/promises';
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {createDialogueMemory} from './evidence-dialogue.mjs';
import {frontierDialogue,frontierInfo} from './frontier-bridge.mjs';
import {presentTask} from './agent-presentation.mjs';

const MODES=new Set(['frontier','frontier-e0']);
export class AgentError extends Error{constructor(status,message){super(message);this.status=status}}

// Supplied entity vocabulary; it routes records, not an external AI provider.
const countryAliases={PAK:['Pakistan','Sindh','Pakistani'],JPN:['Japanese'],CAN:['Canadian'],IND:['Indian'],THA:['Thai'],NPL:['Nepali','Nepalese'],BGD:['Bangladeshi'],MNG:['Mongolian'],PSE:['Palestine','Palestinian'],VNM:['Vietnam','Vietnamese'],GBR:['UK','U.K.','Britain','British'],USA:['US','U.S.','USA','America','American'],KOR:['South Korea','Republic of Korea','South Korean'],IRN:['Iran','Iranian'],NZL:['NZ','New Zealander'],AFG:['Afghan'],ISR:['Israeli'],AUS:['Australian'],CHN:['Chinese'],KEN:['Kenyan'],EGY:['Egyptian'],MAR:['Moroccan'],NGA:['Nigerian'],SDN:['Sudanese'],ZAF:['South African'],ETH:['Ethiopian'],GHA:['Ghanaian'],RWA:['Rwandan']};
const regionCodes='AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
const regionNames=new Intl.DisplayNames(['en'],{type:'region'});
const escapePattern=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function questionEntity(prompt,countries,previous){
 const matches=[];
 for(const c of countries){
  const aliases=[c.name,c.name.replace(/\s*\([^)]*\)/g,''),c.iso3,...(countryAliases[c.iso3]||[])];
  for(const alias of new Set(aliases)){
   // Two/three-letter codes are case-sensitive: "us" is not a country.
   const flags=alias===alias.toUpperCase()?'g':'gi';
   // Accept a named country's possessive, including a missing apostrophe.
   // Never extend codes/demonyms by arbitrary fuzzy spelling matches.
   const possessive=alias===c.name||['South Korea','Republic of Korea'].includes(alias)?"(?:['’]s|s)?":'';
   for(const m of prompt.matchAll(new RegExp('(?<![\\w])'+escapePattern(alias)+possessive+'(?![\\w])',flags)))matches.push({...c,start:m.index,end:m.index+m[0].length});
  }
 }
 const named=[...new Map(matches.map(c=>[c.iso3,c])).values()];
 const unsupported=[];
 for(const code of regionCodes){const label=regionNames.of(code);if(new RegExp('(?<![\\w])'+escapePattern(label)+'(?![\\w])','i').test(prompt)&&!matches.some(m=>prompt.slice(m.start,m.end).toLowerCase().includes(label.toLowerCase())))unsupported.push(label)}
 const ambiguous=/\bKorea\b/i.test(prompt)&&!named.some(c=>c.iso3==='KOR');
 const stripped=matches.sort((a,b)=>b.start-a.start).reduce((text,m)=>text.slice(0,m.start)+' '.repeat(m.end-m.start)+text.slice(m.end),prompt).trim();
 if(unsupported.length||ambiguous)return {clarification:'Please name one of the 28 supported countries. '+(ambiguous?'“Korea” is ambiguous; use “South Korea” if that is what you mean.':unsupported.join(', ')+' is outside the dashboard’s country coverage.'),pending:null};
 if(named.length>2)return {clarification:'Choose up to two countries for one source-aware comparison.',pending:null};
 if(named.length===2)return {country:named.map(c=>c.iso3).sort().join('+'),stripped};
 const country=named[0]?.iso3||previous?.country||null;
 return country?{country,stripped}:{clarification:'Which country should I use? Add its name to your question, or reply with a country name such as India or Pakistan.',pending:prompt};
}

export function createAgentService({dataPath,env=process.env,now=()=>Date.now(),timeoutMs=10000}={}){
 const tasks=new Map(),conversationOwners=new Map(),dialogues=createDialogueMemory({now});let dataPromise,frontierVerifiedAt=null,lastHour=0,hourlyRuns=0;
 const prune=()=>{dialogues.prune();for(const [id,c] of conversationOwners)if(now()-c.updatedAt>=3600000)conversationOwners.delete(id);for(const [id,t]of tasks)if(now()-t.createdAt>=3600000&&t.cleanup!=='Pending')tasks.delete(id)};
 const expiryTimer=setInterval(prune,60000);expiryTimer.unref?.();
 const config=()=>({access:env.AGENT_ACCESS_CODE||''});
 const safeEqual=(a,b)=>timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
 function authenticated(req){
  const value=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('heic_agent='))?.slice(11);
  const c=config();if(!c.access||!value)return false;
  const [expiry,signature]=value.split('.');if(!/^\d+$/.test(expiry)||+expiry<now()||+expiry>now()+9*3600000||!signature)return false;
  return safeEqual(signature,createHmac('sha256',c.access).update(expiry).digest('base64url'));
 }
 function status(req){const c=config(),admin=authenticated(req);return {configured:c.access.length>=16,accessConfigured:c.access.length>=16,frontierConfigured:c.access.length>=16,...(admin?{frontierRuntime:frontierInfo.version,frontierVerifiedAt}:{}),frontierExternalAI:false,publicQuestions:true,externalAI:false,authenticated:admin,provider:'frontier',model:null,regimes:['evidence','examples_only']}}
 const cookieFor=(req,code)=>{
  const c=config();if(c.access.length<16)throw new AgentError(503,'The owner needs to finish the private workspace access setup.');
  if(typeof code!=='string'||code.length>256||!safeEqual(code,c.access))throw new AgentError(401,'The workspace access code was not accepted.');
  const expiry=String(now()+8*3600000),signature=createHmac('sha256',c.access).update(expiry).digest('base64url');
  const local=/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'');
  return `heic_agent=${expiry}.${signature}; Path=/api/agent; HttpOnly; SameSite=Strict; Max-Age=28800${local?'':'; Secure'}`;
 };
 async function evidence(iso,year){
  if(iso.includes('+')){
   const codes=iso.split('+');if(codes.length!==2||new Set(codes).size!==2)throw new AgentError(400,'Choose two distinct countries.');
   const snapshots=await Promise.all(codes.map(code=>evidence(code,year)));
   const sourceTables={};
   for(const s of snapshots)for(const [table,rows]of Object.entries(s.sourceTables)){
    if(!sourceTables[table])sourceTables[table]=[rows[0]];
    if(JSON.stringify(sourceTables[table][0])!==JSON.stringify(rows[0]))throw new AgentError(400,'Source schemas do not match.');
    sourceTables[table].push(...rows.slice(1));
   }
   return {country:{iso3:iso,name:snapshots.map(s=>s.country.name).join(' and ')},countries:snapshots.map(s=>s.country),availableCountries:snapshots[0].availableCountries,selectedYear:year,sourceTables};
  }
  const d=await (dataPromise??=readFile(dataPath,'utf8').then(JSON.parse));
  const c=d.Coverage.slice(1).find(r=>r[1]===iso);if(!c)throw new AgentError(400,'Choose a country in the dashboard.');
  const sourceTables={};
  for(const name of ['Coverage','Country alignment','MICS learning','PISA learning','Other assessments','Education pathways','Family background MICS','Family background PISA','Family background coverage','Learning conditions','Data audit','Violence data','Violence insecurity score','Workforce GDP','Female population','Literacy and access']){
   const table=d[name];if(!table)continue;
   const col=table[0].findIndex(h=>String(h).startsWith('ISO3'));if(col<0)continue;
   let records=table.slice(1).filter(r=>r[col]===iso);
   if(['Workforce GDP','Female population','Literacy and access'].includes(name))records=year===null?records:records.filter(r=>Number(r[3])===year);
   sourceTables[name]=[table[0],...records];
  }
  return {country:{iso3:iso,name:c[2],geographicLevel:c[3]},availableCountries:d.Coverage.slice(1).map(r=>({iso3:r[1],name:r[2],aliases:countryAliases[r[1]]||[]})),selectedYear:year,notes:'Original source periods are in each table. Missing records are not zero. New findings require review before integration.',sourceTables};
 }
 const publicTask=t=>({id:t.id,status:t.status,progress:t.progress,mode:t.mode,country:t.country,year:t.year,createdAt:t.createdAt,updatedAt:t.updatedAt,output:t.output,error:t.error,diagnostic:null,provider:'frontier',model:null,responseId:null,requestId:null,contextLimited:false,conversationId:t.conversationId||null,conversation:t.conversation||null,dialogue:t.dialogue||null,sessionId:null,turnId:null,cleanup:t.cleanup});
 async function executeFrontier(t,snapshot,prompt,conversation,displayPrompt=prompt){
  const controller=new AbortController();t.controller=controller;
  try{
   t.status='running';t.progress='Processing evidence with SIYA / Frontier V4';t.updatedAt=now();
   t.dialogue=await frontierDialogue(snapshot,prompt,conversation,{signal:controller.signal,timeoutMs:Math.min(timeoutMs,10000),regime:t.mode==='frontier-e0'?'examples_only':'evidence'});
   if(t.scopePending!==undefined&&t.dialogue.kind==='clarification'&&t.dialogue.frontier?.v4?.operator==='guarded_dashboard_adapter')t.dialogue.scopePending=t.scopePending;
   if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
   t.conversation=dialogues.append(conversation.id,displayPrompt,t.dialogue);conversationOwners.set(conversation.id,{session:t.session,updatedAt:now()});t.output=t.dialogue.message;
   t.status='completed';t.progress=t.dialogue.kind==='clarification'?'Clarification needed':t.dialogue.kind==='unresolved'?'Unresolved request or evidence gap':'SIYA / Frontier V4 result ready for review';frontierVerifiedAt=now();
  }catch(error){
   if(t.cancelRequested){t.status='cancelled';t.progress='Run cancelled'}
   else{t.status='failed';t.progress='Frontier needs attention';t.error=error.message||'The Frontier runtime failed. No provider fallback was attempted.'}
  }finally{t.cleanup=t.cancelRequested?'Frontier process stopped':'Frontier process completed';t.updatedAt=now();delete t.controller}
 }
 async function start(payload,{session='internal'}={}){
  if(!MODES.has(payload.mode))throw new AgentError(400,'Choose the V1 evidence agent or V1 mechanism lab. Previous provider modes are retired; refresh the page.');
  if(typeof payload.prompt!=='string'||!payload.prompt.trim()||payload.prompt.length>3000)throw new AgentError(400,'Enter a request of up to 3,000 characters.');
  if(/(?:sk-(?:proj-)?|gsk_)[\w-]{12,}/i.test(payload.prompt+' '+(payload.organisation||'')))throw new AgentError(400,'Remove API keys or credentials from the request.');
  if(payload.organisation!==undefined&&(typeof payload.organisation!=='string'||payload.organisation.length>200))throw new AgentError(400,'Keep the organisation name under 200 characters.');
  const automatic=payload.scope==='question';
  const year=automatic?null:Number(payload.year);if(!automatic&&(!Number.isInteger(year)||year<2018||year>2025))throw new AgentError(400,'Choose a dashboard year.');
  if([...tasks.values()].some(t=>t.cleanup==='Pending'||['queued','running','cancelling'].includes(t.status)))throw new AgentError(429,'An agent run is already active. Wait for it or stop it first.');
  const hour=Math.floor(now()/3600000);if(hour!==lastHour){lastHour=hour;hourlyRuns=0}if(hourlyRuns>=60)throw new AgentError(429,'The workspace has reached its hourly agent-run limit.');
  if(payload.conversationId!==undefined&&payload.conversationId!==null&&(typeof payload.conversationId!=='string'||!/^[a-f0-9-]{36}$/.test(payload.conversationId)))throw new AgentError(400,'Choose an existing conversation or start a new one.');
  if(payload.conversationId&&conversationOwners.get(payload.conversationId)?.session!==session)throw new AgentError(404,'Conversation not found in this browser session.');
  let previous;try{previous=payload.conversationId?dialogues.read(payload.conversationId):null}catch(error){throw new AgentError(409,error.message)}
  let country=payload.country,resolvedPrompt=payload.prompt.trim(),resolution;
  if(automatic){
   if(payload.mode==='frontier-e0')country='LAB';
   else{
    const d=await (dataPromise??=readFile(dataPath,'utf8').then(JSON.parse));
    resolution=questionEntity(resolvedPrompt,d.Coverage.slice(1).map(r=>({iso3:r[1],name:r[2],aliases:countryAliases[r[1]]||[]})),previous);
    const semanticPending=previous?.turns.at(-1)?.result?.frontier?.memory?.semantic_pending;
    if(semanticPending?.slot==='comparison_reference'&&resolution.country&&resolution.stripped.replace(/\b(?:in|for|please)\b/gi,'').trim()===''){
     resolvedPrompt=semanticPending.prompt+' compared with '+resolvedPrompt;
     resolution=questionEntity(resolvedPrompt,d.Coverage.slice(1).map(r=>({iso3:r[1],name:r[2],aliases:countryAliases[r[1]]||[]})),previous);
    }
    country=resolution.country||null;
    const pending=previous?.turns.at(-1)?.result?.scopePending;
    if(pending&&country&&resolution.stripped.replace(/\b(?:in|for|please)\b/gi,'').trim()==='')resolvedPrompt=pending+' '+resolvedPrompt;
   }
  }
  if(resolvedPrompt.length>3000)throw new AgentError(400,'The combined clarification exceeds 3,000 characters. Start a new question with its country.');
  let conversation;try{conversation=dialogues.open(payload.conversationId,country,year,payload.mode==='frontier-e0'?'v1-examples-only':'frontier-v1',{allowScopeChange:automatic})}catch(error){throw new AgentError(409,error.message)}
  conversationOwners.set(conversation.id,{session,updatedAt:now()});
  let snapshot=country==='LAB'?{country:{iso3:'LAB',name:'Example-only lab'},selectedYear:null,sourceTables:{}}:country?await evidence(country,year):null;
  hourlyRuns++;prune();
  const t={id:randomUUID(),session,status:'queued',progress:'Waiting to start',mode:payload.mode,country,year,createdAt:now(),updatedAt:now(),output:'',error:null,cleanup:'Pending',conversationId:conversation.id,conversation};tasks.set(t.id,t);
  if(resolution?.clarification){
   const d=await dataPromise;
   snapshot={country:{iso3:'UNRESOLVED',name:'Unresolved country'},availableCountries:d.Coverage.slice(1).map(r=>({iso3:r[1],name:r[2],aliases:countryAliases[r[1]]||[]})),routingIssue:resolution.clarification,selectedYear:null,sourceTables:{}};
   t.scopePending=resolution.pending;
  }
  void executeFrontier(t,snapshot,resolvedPrompt,conversation,payload.prompt.trim());
  return publicTask(t);
 }
 function get(id,session='internal'){prune();const t=tasks.get(id);if(!t||t.session!==session)throw new AgentError(404,'This run is no longer available on the server. Start a new run to continue.');return publicTask(t)}
 async function cancel(id,session='internal'){
  const t=tasks.get(id);if(!t||t.session!==session)throw new AgentError(404,'Run not found.');
  if(!['queued','running'].includes(t.status))return publicTask(t);
  t.cancelRequested=true;t.status='cancelling';t.progress='Stopping the agent';t.controller?.abort();return publicTask(t);
 }
 async function close(){clearInterval(expiryTimer);await Promise.allSettled([...tasks.values()].filter(t=>['queued','running','cancelling'].includes(t.status)).map(t=>cancel(t.id,t.session)))}
 function forgetConversation(id,session='internal'){
  if(conversationOwners.get(id)?.session!==session)throw new AgentError(404,'Conversation not found in this browser session.');
  if([...tasks.values()].some(t=>t.conversationId===id&&t.cleanup==='Pending'))throw new AgentError(409,'Stop the current run before starting a new conversation.');
  dialogues.forget(id);conversationOwners.delete(id);for(const [taskId,t]of tasks)if(t.conversationId===id)tasks.delete(taskId);return {forgotten:true};
 }
 async function present(task,{admin=false}={}){
  if(admin)return presentTask(task,{admin:true});
  const data=dataPromise?await dataPromise:null;
  return presentTask(task,{catalog:data?.Coverage?.slice(1)||[]});
 }
 return {status,cookieFor,authenticated,start,get,cancel,close,evidence,forgetConversation,present};
}
