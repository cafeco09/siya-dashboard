import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAgentService,AgentError} from './agent.mjs';
import {portalAccess} from './portal-access.mjs';
import {createQuestionSessions} from './question-sessions.mjs';
import {createOutreachService} from './outreach.mjs';

const root=fileURLToPath(new URL('./public/',import.meta.url));
const agent=createAgentService({dataPath:path.join(root,'data.json')});
const outreach=createOutreachService();
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
const loginAttempts=new Map(),questionSessions=createQuestionSessions();
async function requestJson(req){
 if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new AgentError(415,'Use a JSON request.');
 const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>(req.url.startsWith('/api/agent/outreach/')?64000:20000))throw new AgentError(413,'The request is too large.');chunks.push(chunk)}const text=Buffer.concat(chunks).toString('utf8');
 try{const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return body}catch{throw new AgentError(400,'The request must contain valid JSON.')}
}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.csv':'text/csv; charset=utf-8','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  let pathname;
  try {pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}
  catch {res.writeHead(400);return res.end('Invalid request');}
  if(pathname.startsWith('/api/agent/')){
    try{
      const portal=portalAccess(req,res,pathname);
      if(req.method==='OPTIONS'){if(!portal)throw new AgentError(403,'Dashboard origin not allowed.');res.writeHead(204);return res.end()}
      if(pathname==='/api/agent/session'&&req.method==='POST'){if(!portal)throw new AgentError(403,'This session endpoint is for the public dashboard.');await requestJson(req);return json(res,201,{session:questionSessions.resolve(req,res,{create:true})})}
      if(pathname==='/api/agent/status'&&req.method==='GET')return json(res,200,agent.status(req));
      if(pathname==='/api/agent/outreach/status'&&req.method==='GET')return json(res,200,await outreach.status(agent.authenticated(req)));
      if(pathname==='/api/agent/outreach/mail/callback')return json(res,410,{error:'Gmail authorisation is no longer used. Open the admin workspace for the proxy mailbox.'});
      if(req.method==='POST'){
        let origin;try{origin=new URL(req.headers.origin)}catch{throw new AgentError(403,'Open the agent from this dashboard.')}
        if((origin.host!==req.headers.host&&!portal)||!['https:','http:'].includes(origin.protocol))throw new AgentError(403,'Open the agent from this dashboard.');
      }
      if(pathname==='/api/agent/outreach/invitation'&&req.method==='GET')return json(res,200,await outreach.invitationInfo(String(req.headers.authorization||'').replace(/^Bearer /,'')));
      if(pathname==='/api/agent/outreach/submissions'&&req.method==='POST')return json(res,201,await outreach.submit(String(req.headers.authorization||'').replace(/^Bearer /,''),await requestJson(req)));
      if(pathname==='/api/agent/outreach/questions'&&req.method==='GET')return json(res,200,await outreach.questions());
      if(pathname==='/api/agent/outreach/authorities'&&req.method==='GET')return json(res,200,outreach.directory());
      if(pathname==='/api/agent/outreach/questions'&&req.method==='POST'){const session=questionSessions.resolve(req,res,{create:true});return json(res,201,await outreach.submitQuestion(await requestJson(req),session))}
      if(pathname==='/api/agent/dialogue'||pathname.startsWith('/api/agent/dialogue/'))return json(res,410,{error:'International Dialogue is a proposed safety line, not a public discussion board. This dashboard does not accept incident reports.'});
      if(pathname==='/api/agent/unlock'&&req.method==='POST'){
        const ip=req.socket.remoteAddress||'unknown',now=Date.now(),old=loginAttempts.get(ip);
        if(old&&now-old.start<600000&&old.count>=10)throw new AgentError(429,'Too many unlock attempts. Try again in ten minutes.');
        if(!old||now-old.start>=600000)loginAttempts.set(ip,{start:now,count:1});else old.count++;
        if(loginAttempts.size>1000)for(const [key,v] of loginAttempts)if(now-v.start>600000)loginAttempts.delete(key);
        const {code}=await requestJson(req);res.setHeader('Set-Cookie',agent.cookieFor(req,code));return json(res,200,{authenticated:true});
      }
      if(pathname.startsWith('/api/agent/outreach/')){
        if(!agent.authenticated(req))throw new AgentError(401,'Unlock the private mail workspace first.');
        if(pathname==='/api/agent/outreach/authority-directory'&&req.method==='GET')return json(res,200,outreach.directory(true));
        if(pathname==='/api/agent/outreach/drafts'&&req.method==='GET')return json(res,200,await outreach.list());
        if(pathname==='/api/agent/outreach/drafts'&&req.method==='POST')return json(res,201,await outreach.save(await requestJson(req)));
        if(pathname==='/api/agent/outreach/invitations'&&req.method==='POST')return json(res,201,await outreach.invitation(await requestJson(req)));
        if(pathname==='/api/agent/outreach/mail/connect'&&req.method==='POST'){await requestJson(req);return json(res,200,await outreach.connect())}
        if(pathname==='/api/agent/outreach/mail/disconnect'&&req.method==='POST')return json(res,200,await outreach.disconnect());
        const item=pathname.match(/^\/api\/agent\/outreach\/drafts\/([a-f0-9-]{36})\/(edit|approve|reject|send|refresh|close)$/);
        if(item&&req.method==='POST'){const p=await requestJson(req);return json(res,200,await outreach[item[2]==='close'?'closeQuestion':item[2]](item[1],p))}
        const invite=pathname.match(/^\/api\/agent\/outreach\/invitations\/([a-f0-9-]{36})\/revoke$/);
        if(invite&&req.method==='POST')return json(res,200,await outreach.revoke(invite[1]));
        return json(res,404,{error:'Outreach route not found.'});
      }
      if(pathname==='/api/agent/lock'&&req.method==='POST'){res.setHeader('Set-Cookie','heic_agent=; Path=/api/agent; HttpOnly; SameSite=Strict; Secure; Max-Age=0');return json(res,200,{authenticated:false})}
      if(pathname==='/api/agent/tasks'&&req.method==='POST'){const session=questionSessions.resolve(req,res,{create:true});return json(res,202,await agent.present(await agent.start(await requestJson(req),{session}),{admin:agent.authenticated(req)}))}
      const conversation=pathname.match(/^\/api\/agent\/conversations\/([a-f0-9-]{36})\/forget$/);
      if(conversation&&req.method==='POST'){await requestJson(req);return json(res,200,agent.forgetConversation(conversation[1],questionSessions.resolve(req,res)))}
      const task=pathname.match(/^\/api\/agent\/tasks\/([a-f0-9-]{36})(\/cancel)?$/);
      if(task&&req.method==='GET'&&!task[2])return json(res,200,await agent.present(agent.get(task[1],questionSessions.resolve(req,res)),{admin:agent.authenticated(req)}));
      if(task&&req.method==='POST'&&task[2])return json(res,200,await agent.present(await agent.cancel(task[1],questionSessions.resolve(req,res)),{admin:agent.authenticated(req)}));
      if(pathname==='/api/agent/tasks')throw new AgentError(401,'Task listing is not available.');
      return json(res,404,{error:'Agent route not found.'});
    }catch(error){return json(res,error instanceof AgentError?error.status:500,{error:error instanceof AgentError?error.message:'The agent request could not be completed.'})}
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});return res.end()}
  if(pathname==='/api/health'){
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    return res.end(req.method==='HEAD'?undefined:JSON.stringify({status:'ok',application:'Her Education, In Context'}));
  }
  if(pathname.startsWith('/api/')){res.writeHead(404);return res.end('API route not configured');}
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':['/admin','/admin/'].includes(pathname)?'/admin.html':pathname));
  const relative=path.relative(root,file);
  if(relative.startsWith('..')||path.isAbsolute(relative)||relative.split(path.sep).some(part=>part.startsWith('.'))){
    res.writeHead(403);return res.end('Forbidden');
  }
  try {
    const data=await readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
    res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log(`Dashboard server ready on port ${server.address().port}`));
process.on('SIGTERM',()=>{server.close();void agent.close();void outreach.close()});
