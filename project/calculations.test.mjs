import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const data=JSON.parse(await readFile(new URL('./public/data.json',import.meta.url),'utf8'));
const world=JSON.parse(await readFile(new URL('./public/world-female-population.json',import.meta.url),'utf8'));
async function app(){const context=vm.createContext({fetch:()=>new Promise(()=>{}),document:{},console});vm.runInContext(await readFile(new URL('./public/app.js',import.meta.url),'utf8'),context);vm.runInContext('D='+JSON.stringify(data)+';W='+JSON.stringify(world),context);return code=>vm.runInContext(code,context)}

test('household gap ordering uses magnitude while ordinary country ordering remains signed',async()=>{
 const run=await app();run("const sample=[{iso:'IND',value:5},{iso:'PSE',value:-9},{iso:'MNG',value:0},{iso:'JPN',value:null}]");
 assert.deepEqual(Array.from(run("sortCountries(sample,'family-residence',true).map(r=>r.iso)")),['PSE','IND','MNG','JPN']);
 run("chartSorts['family-residence']='asc'");assert.deepEqual(Array.from(run("sortCountries(sample,'family-residence',true).map(r=>r.iso)")),['MNG','IND','PSE','JPN']);
 assert.deepEqual(Array.from(run("sortCountries(sample,'workforce').map(r=>r.iso)")),['IND','MNG','PSE','JPN']);
 run("chartSorts['family-residence']='az'");assert.deepEqual(Array.from(run("sortCountries(sample,'family-residence',true).map(r=>r.iso)")),['IND','JPN','MNG','PSE']);
});

test('actual Palestine rural-urban numeracy gap appears above smaller gaps and retains its sign',async()=>{
 const run=await app();run("familySubject='Numeracy'");const html=run("familyComparisons('residence')");
 const order=[...html.matchAll(/data-country="([A-Z]+)"/g)].map(m=>m[1]);assert.equal(order.indexOf('PSE'),3);assert(order.indexOf('PSE')<order.indexOf('THA'));
 assert.match(html,/Largest absolute gap first/);assert.match(html,/Smallest absolute gap first/);assert.match(html,/difference -9\.0 percentage points/);
});

test('missing Sudan labour observations stay null and are labelled as not calculated',()=>{
 const rows=data['Population contributions'].slice(1).filter(r=>r[1]==='SDN'&&['2023','2024','2025'].includes(r[4])&&['Female labour participation (% age 15+)','Female employment (% age 15+)'].includes(r[3]));
 assert.equal(rows.length,6);for(const r of rows){assert.equal(r[6],null);assert.equal(r[9],null);assert.equal(r[11],null);assert.equal(r[12],'No source observation; count not calculated')}
});

test('Morocco reported source values are preserved and the mismatch is shown as an unresolved diagnostic',async()=>{
 const audit=JSON.parse(await readFile(new URL('./public/calculation-audit.json',import.meta.url),'utf8'));
 assert.equal(audit.sourceRecords.length,24);for(const r of audit.sourceRecords){const y=Number(r.date),work=data['Workforce GDP'].slice(1).find(x=>x[1]==='MAR'&&x[3]===y),pop=data['Female population'].slice(1).find(x=>x[1]==='MAR'&&x[3]===y);assert.equal(r.value,r.indicator.id==='SP.POP.TOTL'?pop[5]:work[r.indicator.id==='NY.GDP.MKTP.CD'?7:8])}
 const run=await app(),r=run("gdpReconciliation('MAR',2023)");assert.equal(r.reported,3813.72607421875);assert(Math.abs(r.calculated-3872.351986874433)<1e-8);assert.equal(r.population,37712505);
 const html=run("gdpReconciliationHtml('MAR',2023)");assert.match(html,/US\$ 3,813\.73/);assert.match(html,/US\$ 3,872\.35/);assert.match(html,/covers Western Sahara/);assert.match(html,/matching denominator has not been verified/);assert.match(html,/not a replacement estimate/);assert.match(html,/calculation-audit.json/);
 assert.equal(run("gdpReconciliation('IND',2023)"),null);assert.equal(run("gdpReconciliation('XXX',2023)"),null);
 for(const y of [2018,2019,2020,2021,2022,2023,2024,2025])assert(run(`gdpReconciliation('MAR',${y})`));
 run("country='MAR';year=2023");assert.match(run('overview()'),/GDP and population source check/);assert.match(run('economy()'),/GDP and population source check/);assert.match(run('profile()'),/GDP and population source check/);
 run("D['Workforce GDP'].find(r=>r[1]==='MAR'&&r[3]===2023)[8]=null");assert.equal(run("gdpReconciliation('MAR',2023)"),null);
});

test('all same-year population denominators and insecurity totals remain consistent',()=>{
 const rs=data['Population reference'].slice(1);for(let y=2018;y<=2025;y++){const group=rs.filter(r=>r[3]===y);assert.equal(group.length,28);const total=group.reduce((s,r)=>s+r[4],0),female=group.reduce((s,r)=>s+r[5],0);for(const r of group){assert.equal(r[7],total);assert.equal(r[8],female)}assert(Math.abs(group.reduce((s,r)=>s+r[9],0)-100)<1e-10)}
 for(const r of data['Violence insecurity score'].slice(1)){const expected=(2*r[4]+100-r[5]+100*(1-(1-Math.cbrt(r[6]/1.5))**3)+r[7])/4;assert(Math.abs(expected-r[12])<1e-10)}
});


test('world female shares use same-year global counts and never the selected-country sum',async()=>{
 const run=await app();
 for(let y=2018;y<=2025;y++){
  const source=world.sourceResponse[1].find(r=>r.date===String(y));
  assert.equal(source.countryiso3code,'WLD');assert.equal(source.indicator.id,'SP.POP.TOTL.FE.IN');
  assert.equal(run(`worldFemalePopulation(${y})`),source.value);
  const records=data['Population reference'].slice(1).filter(r=>r[3]===y);
  for(const r of records)assert.equal(run(`worldFemaleShare(${r[5]},${y})`),100*r[5]/source.value);
  const sum=records.reduce((s,r)=>s+100*r[5]/source.value,0);assert(sum>0&&sum<100);
 }
 run("year=2023;country='IND';group='all'");const before=run("worldFemaleShare(populationRow('IND')[4],year)");
 const html=run('populationView()');assert.match(html,/Mongolia: 0\.0435%/);assert.match(html,/Pakistan: 3\.0382%/);assert.match(html,/Share of the world’s female population/);assert.match(html,/4,008,126,120/);assert.doesNotMatch(html,/Female contribution to combined total \(%\)<\/option>/);
 run("group='Primary'");assert.equal(run("worldFemaleShare(populationRow('IND')[4],year)"),before);
 assert.equal(run('worldFemaleShare(50000000,2023)'),100*50000000/4008126120);
 assert.equal(run('worldFemaleShare(0,2023)'),0);
 for(const expression of ['worldFemaleShare(null,2023)','worldFemaleShare(-1,2023)','worldFemaleShare(Infinity,2023)','worldFemaleShare(50000000,2030)','worldFemaleShare(5000000000,2023)'])assert.equal(run(expression),null);
 run("W.observations['2023']=0");assert.equal(run('worldFemaleShare(50000000,2023)'),null);assert.match(run('populationView()'),/No worldwide female population observation/);
});


test('workforce charts and GDP comparison use women as a share of both-sex labour force',async()=>{
 const run=await app(),r=data['Workforce GDP'].find(r=>r[1]==='NGA'&&r[3]===2023);
 run("country='NGA';year=2023");
 assert.equal(run("metrics.labourShare[1]('NGA')"),r[6]);assert.notEqual(r[4],r[6]);
 assert.equal(run('ymetric'),'labourShare');
 const html=run('economy()');assert.match(html,/women and men in the labour force/);assert.match(html,/SL.TLF.TOTL.FE.ZS/);assert.match(html,new RegExp('Nigeria: '+r[6].toFixed(1)+'%'));
 assert.match(run('overview()'),/Women’s share of the total labour force/);assert.match(run('profile()'),/Women’s share of the total labour force/);
 run("country='SDN';year=2025");assert.equal(run("metrics.labourShare[1]('SDN')"),null);
});
