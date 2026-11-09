import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentService} from './agent.mjs';
import {createDialogueMemory,dialoguePacket,validateDialogue} from './evidence-dialogue.mjs';
const dataPath=new URL('./public/data.json',import.meta.url);
const question={prompt:'Show learning evidence'};
const setup=()=>({service:createAgentService({dataPath})});
const modelEvidence=context=>({...context,contextCoverage:{omittedRows:{},missingTables:[],limited:false}});
const proposal=(packet,overrides={})=>({kind:'answer',message:'A source-reported observation.',evidence_refs:[packet.referenceIndex[0].id],limitations:[],...overrides});
test('dialogue packet retains exact headers, values, stable record IDs and coverage gaps',async()=>{
 const {service}=setup(),snapshot=await service.evidence('PAK',2023),before=JSON.stringify(snapshot);
 const context=modelEvidence(snapshot,question.prompt,6500),packet=dialoguePacket(context);
 assert.equal(JSON.stringify(snapshot),before);assert.deepEqual(packet.evidence,context);
 assert.deepEqual(dialoguePacket(context),packet);
 const result=validateDialogue(JSON.stringify(proposal(packet)),packet),ref=result.references[0];
 assert.deepEqual(ref.headers,context.sourceTables[ref.table][0]);
 assert(context.sourceTables[ref.table].some(row=>JSON.stringify(row)===JSON.stringify(ref.values)));
 assert.equal(result.reviewRequired,true);assert.deepEqual(result.coverage,context.contextCoverage);
 assert(!('confidence' in result));assert(!('verified' in result));
});

test('contract rejects fabricated references, links, action fields and changed evidence',async()=>{
 const {service}=setup(),context=modelEvidence(await service.evidence('PAK',2023),'learning',6500),packet=dialoguePacket(context);
 for(const invalid of [proposal(packet,{evidence_refs:['ev_invented']}),proposal(packet,{evidence_refs:[]}),proposal(packet,{message:'See https://example.org/fabricated'}),proposal(packet,{limitations:['Read http://example.org/unsafe']}),{...proposal(packet),action:'send_mail'},proposal(packet,{kind:'PASS'}),proposal(packet,{message:''}),proposal(packet,{limitations:['x'.repeat(1201)]})])assert.throws(()=>validateDialogue(JSON.stringify(invalid),packet));
 assert.throws(()=>validateDialogue('not JSON',packet));
 packet.evidence.country.name='Changed';assert.throws(()=>validateDialogue(JSON.stringify(proposal(packet)),packet),/packet changed/);
});

test('clarifications and unresolved gaps can remain reference-free without becoming evidence answers',async()=>{
 const {service}=setup(),packet=dialoguePacket(modelEvidence(await service.evidence('PAK',2023),'learning',6500));
 for(const kind of ['clarification','unresolved']){const result=validateDialogue(JSON.stringify(proposal(packet,{kind,message:'Which learning measure do you mean?',evidence_refs:[]})),packet);assert.equal(result.kind,kind);assert.deepEqual(result.references,[]);assert.equal(result.reviewRequired,true)}
});

test('memory caps conversation count and copies records instead of accepting caller mutation',()=>{
 let clock=0;const memory=createDialogueMemory({now:()=>clock,maxConversations:2,maxTurns:1,ttlMs:10});
 const a=memory.open(null,'PAK',2023);memory.append(a.id,'First',{message:'Answer'});const copy=memory.open(a.id,'PAK',2023);copy.turns[0].prompt='Changed';assert.equal(memory.open(a.id,'PAK',2023).turns[0].prompt,'First');
 memory.open(null,'IND',2023);memory.open(null,'CAN',2023);assert.throws(()=>memory.open(a.id,'PAK',2023),/expired/);
 clock=11;memory.prune();assert.throws(()=>memory.append(copy.id,'Again',{}),/expired/);
});
