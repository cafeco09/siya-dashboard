import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

// Keep the existing Render build command usable when a fresh build has no node_modules.
const require=createRequire(import.meta.url),pkg=JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8'));
let install=false;try{install=require('pg/package.json').version!==pkg.dependencies.pg}catch{install=true}
if(install){const r=spawnSync('npm',['ci','--ignore-scripts'],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1)}
for(const file of ['server.mjs','portal-access.mjs','question-sessions.mjs','agent.mjs','evidence-dialogue.mjs','frontier-bridge.mjs','agent-presentation.mjs','authorities.mjs','outreach.mjs','proxy-mail.mjs','outreach-store.mjs','public/agent-ui.js','public/outreach-ui.js','public/dialogue-ui.js','public/submit-draft.js','public/admin.js','public/app.js']){
 const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
}
// Frontier is stdlib-only. A missing interpreter or altered original source
// must fail the build instead of becoming an untested production dependency.
const frontier=spawnSync('python3',['-B','frontier/runtime_cli.py','--self-check'],{stdio:'inherit'});
if(frontier.status!==0)process.exit(frontier.status||1);

const checks=spawnSync('python3',['-B','-m','unittest','discover','-s','frontier','-p','test_*.py'],{stdio:'inherit'});
if(checks.status!==0)process.exit(checks.status||1);

// Exercise the production bridge with its restricted environment on the host,
// without owner credentials, private records, network calls or mail access.
const {frontierDialogue}=await import('./frontier-bridge.mjs');
const sample={country:{iso3:'TEST',name:'Synthetic build fixture'},selectedYear:2023,sourceTables:{'Family background MICS':[
 ['Population','Sex coverage','Subject','Survey year','Poorest (%)','Richest (%)'],
 ['Children aged 7–14','Girls and boys combined','Reading','2019',10,25]
]}};
const result=await frontierDialogue(sample,'Compare reading between richest and poorest households',{turns:[],dropped:0});
if(result.frontier.claim?.value!=='15'||!result.frontier.original_components_used.includes('apply_operator'))throw Error('Frontier Node/Python bridge check failed');
console.log('Frontier Node/Python bridge passed: original executor, source integrity and evidence references. No AI API request.');

// Exercise the unchanged locked V4 release from its own import root.
const v4=spawnSync('python3',['-B','-m','unittest','discover','-s','tests'],{cwd:new URL('./frontier/vendor/v4_general7/',import.meta.url),stdio:'inherit'});
if(v4.status!==0)process.exit(v4.status||1);
