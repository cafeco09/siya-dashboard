import {createHash,randomUUID} from 'node:crypto';

// Evidence contracts and server-owned conversation memory for the V1 agent.
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const urls=value=>[...new Set([...JSON.stringify(value).matchAll(/https:\/\/[^\s"<>\\]+/g)].map(m=>m[0].replace(/[),.;\]]+$/,'')))];
export const dialogueSchema={type:'object',properties:{kind:{type:'string',enum:['answer','clarification','unresolved','draft']},message:{type:'string'},evidence_refs:{type:'array',items:{type:'string'}},limitations:{type:'array',items:{type:'string'}}},required:['kind','message','evidence_refs','limitations'],additionalProperties:false};

export function dialoguePacket(context){
 const evidence=clone(context),referenceIndex=[];
 for(const [table,rows]of Object.entries(evidence.sourceTables))for(let row=1;row<rows.length;row++)referenceIndex.push({id:'ev_'+digest([evidence.country.iso3,evidence.selectedYear,table,rows[0],rows[row]]).slice(0,16),table,row});
 return {evidence,packetHash:digest(evidence),referenceIndex};
}
export function validateDialogue(text,packet){
 let proposal;try{proposal=JSON.parse(text)}catch{throw Error('The conversation returned invalid structured content. Try a narrower question.')}
 if(!proposal||Array.isArray(proposal)||Object.keys(proposal).sort().join(',')!=='evidence_refs,kind,limitations,message'||!dialogueSchema.properties.kind.enum.includes(proposal.kind)||typeof proposal.message!=='string'||!proposal.message.trim()||proposal.message.length>12000||!Array.isArray(proposal.evidence_refs)||proposal.evidence_refs.length>6||proposal.evidence_refs.some(r=>typeof r!=='string')||!Array.isArray(proposal.limitations)||proposal.limitations.length>4||proposal.limitations.some(s=>typeof s!=='string'||s.length>1200))throw Error('The conversation did not meet the response contract. No answer was accepted.');
 if(digest(packet.evidence)!==packet.packetHash)throw Error('The conversation evidence packet changed. No answer was accepted.');
 const references=[...new Set(proposal.evidence_refs)].map(id=>{
  const ref=packet.referenceIndex.find(r=>r.id===id);if(!ref)throw Error('The conversation cited an unknown evidence record. No answer was accepted.');
  const rows=packet.evidence.sourceTables[ref.table];return {id,table:ref.table,headers:rows[0],values:rows[ref.row],sourceUrls:urls(rows[ref.row])};
 });
 if(proposal.kind==='answer'&&!references.length)throw Error('The conversation answer had no supporting record references. No answer was accepted.');
 const allowed=new Set(references.flatMap(r=>r.sourceUrls));
 if(urls([proposal.message,proposal.limitations]).some(u=>!allowed.has(u))||/http:\/\//i.test(proposal.message+' '+proposal.limitations.join(' ')))throw Error('The conversation introduced a link outside its cited records. No answer was accepted.');
 return {kind:proposal.kind,message:proposal.message.trim(),limitations:proposal.limitations,references,packetHash:packet.packetHash,coverage:clone(packet.evidence.contextCoverage),reviewRequired:true};
}

export function createDialogueMemory({now=()=>Date.now(),ttlMs=3600000,maxConversations=20,maxTurns=3}={}){
 const conversations=new Map();
 const prune=()=>{for(const [id,c]of conversations)if(now()-c.updatedAt>=ttlMs)conversations.delete(id)};
 function read(id){prune();const c=conversations.get(id);if(!c)throw Error('This conversation expired. Start a new conversation.');return clone(c)}
 function open(id,country,year,engine='frontier-v1',{allowScopeChange=false}={}){
  prune();let c;
  let scopeChanged=false;
  if(id){c=conversations.get(id);if(!c)throw Error('This conversation expired. Start a new conversation.');if(c.engine!==engine)throw Error('Start a new conversation when switching conversation engines.');scopeChanged=c.country!==country||c.year!==year;if(scopeChanged&&!allowScopeChange)throw Error('Start a new conversation after changing the country or year.');c.country=country;c.year=year;}
  else{if(conversations.size>=maxConversations)conversations.delete(conversations.keys().next().value);c={id:randomUUID(),country,year,engine,updatedAt:now(),turns:[],dropped:0};conversations.set(c.id,c)}
  // Only server-owned history enters the next request, with an explicit limit.
  return {...clone(c),scopeChanged};
 }
 function append(id,prompt,result){const c=conversations.get(id);if(!c)throw Error('This conversation expired before the response completed. Start a new conversation.');c.turns.push({prompt,result:clone(result)});while(c.turns.length>maxTurns){c.turns.shift();c.dropped++}c.updatedAt=now();return clone(c)}
 function forget(id){conversations.delete(id)}
 return {open,read,append,forget,prune};
}
