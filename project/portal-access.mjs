import {AgentError} from './agent.mjs';

const PORTAL_ORIGIN='https://cafeco09.github.io';
const publicRoute=p=>['/api/agent/status','/api/agent/session','/api/agent/outreach/status','/api/agent/outreach/questions','/api/agent/outreach/authorities','/api/agent/tasks'].includes(p)||/^\/api\/agent\/tasks\/[a-f0-9-]{36}(?:\/cancel)?$/.test(p)||/^\/api\/agent\/conversations\/[a-f0-9-]{36}\/forget$/.test(p);

// Only anonymous, public operations are available to the static dashboard.
// Admin cookies and invitation credentials never cross this boundary.
export function portalAccess(req,res,pathname){
 if(req.headers.origin!==PORTAL_ORIGIN)return false;
 if(!publicRoute(pathname))throw new AgentError(403,'This operation is available only in the private admin workspace.');
 if(!['GET','POST','OPTIONS'].includes(req.method))throw new AgentError(405,'Method not allowed.');
 const requested=String(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
 if(requested.some(h=>!['content-type','x-siya-session'].includes(h)))throw new AgentError(403,'Unsupported dashboard request header.');
 res.setHeader('Access-Control-Allow-Origin',PORTAL_ORIGIN);
 res.setHeader('Vary','Origin');
 res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
 res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Siya-Session');
 res.setHeader('Access-Control-Max-Age','600');
 req.siyaPortal=true;
 delete req.headers.cookie;
 delete req.headers.authorization;
 return true;
}
