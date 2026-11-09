import {randomUUID} from 'node:crypto';
import {AgentError} from './agent.mjs';

// Anonymous, HttpOnly browser sessions isolate question history. They confer
// no owner privileges. They can submit public outreach questions, but cannot
// approve, send, or read private outreach records.
export function createQuestionSessions({now=()=>Date.now(),ttlMs=3600000,maxSessions=200}={}){
 const sessions=new Map();
 function resolve(req,res,{create=false}={}){
  const time=now();for(const [id,seen] of sessions)if(time-seen>=ttlMs)sessions.delete(id);
  const cookie=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('heic_siya='))?.slice(10);
  const portalToken=req.siyaPortal?String(req.headers['x-siya-session']||''):null;
  if(portalToken&&!sessions.has(portalToken))throw new AgentError(401,'Your SIYA session has expired. Refresh the connection and start a new conversation.');
  let id=req.siyaPortal?(portalToken||null):(cookie&&sessions.has(cookie)?cookie:null);
  if(!id){
   if(!create)throw new AgentError(401,'Start a SIYA conversation in this browser first.');
   if(sessions.size>=maxSessions)throw new AgentError(429,'SIYA has reached its active conversation limit. Please try again later.');
   id=randomUUID();
  }
  sessions.set(id,time);
  const local=/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'');
  if(!req.siyaPortal)res.setHeader('Set-Cookie',`heic_siya=${id}; Path=/api/agent; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttlMs/1000)}${local?'':'; Secure'}`);
  return id;
 }
 return {resolve};
}
