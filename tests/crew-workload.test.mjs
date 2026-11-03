import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const frontend = readFileSync(new URL('../src/frontend/app.js', import.meta.url),'utf8');
const routing = readFileSync(new URL('../src/backend/03-routing.js', import.meta.url),'utf8');
function context() {
  const ctx=vm.createContext({document:{getElementById:()=>({addEventListener(){}})},fmt:d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')});
  vm.runInContext(frontend.slice(frontend.indexOf('// ── Daily crew workload')),ctx);
  return ctx;
}
const job=(extra={})=>({type:'install',num:'261170',title:'Sign install',start:'2026-11-03',end:'2026-11-04',crew:['Johnny','Jonathan'],truck_assignments:{Johnny:'crane',Jonathan:'crane'},...extra});
const calculate=(jobs,{from='2026-11-03',to='2026-11-04',types=['install'],crew=['Johnny','Jonathan'],estimates=new Map([['261170',20]])}={})=>context().buildWorkloadRows(jobs,from,to,types,crew,estimates);
test('20 job labor hours become 5 hours per person per day for two people over two days',()=>{
 const rows=calculate([job()]); assert.equal(rows.length,4); assert.ok(rows.every(row=>row.hours===5)); assert.equal(rows.reduce((sum,row)=>sum+row.hours,0),20);
});
test('duplicate calendar events never repeat the total estimate or the person/day job',()=>{
 const rows=calculate([job({event_id:'one'}),job({event_id:'two'})]);assert.equal(rows.reduce((sum,row)=>sum+row.hours,0),20);assert.ok(rows.every(row=>row.jobs.length===1));
});
test('date and crew filtering do not redistribute other people or days hours',()=>{
 const rows=calculate([job()],{to:'2026-11-03',crew:['Johnny']});assert.equal(rows.length,1);assert.equal(rows[0].hours,5);
});
test('missing estimates and service jobs remain unknown while actual zero stays zero',()=>{
 const rows=calculate([job({num:'261171'}),job({num:'261172',type:'service'}),job({num:'261173',estimated_install_hours:0})],{types:['install','service'],to:'2026-11-03'});
 assert.ok(rows.every(row=>row.unknown===2 && row.hours===0));assert.equal(rows[0].jobs[2].hours,0);
});
test('unassigned jobs stay visible and multiple daily truck assignments remain reviewable',()=>{
 const rows=calculate([job({crew:[]}),job({num:'261171',crew:['Johnny'],truck_assignments:{Johnny:'flatbed'}}),job({num:'261172',crew:['Johnny']})],{to:'2026-11-03'});
 assert.equal(rows.find(row=>row.name==='Unassigned').hours,10);
 assert.ok(rows.find(row=>row.name==='Johnny').trucks.has('flatbed'));
 const multiple=calculate([job(),job({num:'261171',truck_assignments:{Johnny:'flatbed'}})]);
 assert.equal(multiple.find(row=>row.name==='Johnny').trucks.size,2);
});
test('empty crew days show availability and date ranges cap at 31 days',()=>{
 assert.equal(calculate([],{from:'2026-11-01',to:'2026-12-31'}).length,62);
 assert.equal(calculate([])[0].hours,0);
});
function route(actor,fn) {
 const ctx=vm.createContext({console,resolveActor_:()=>actor,json:value=>value,UNAUTHORIZED:{error:'unauthorized'},squarecoilInstallHoursByJob_:fn});vm.runInContext(routing,ctx);return ctx;
}
test('workload estimate route requires a valid session before resolving job numbers',()=>{
 const ctx=route(null,()=>{throw new Error('must not call')});assert.equal(ctx.doGet({parameter:{action:'getWorkloadEstimates',nums:'261170'}}).error,'unauthorized');
});
test('workload estimates deduplicate, validate, and bound requests, and retain zero',()=>{
 let requested;const ctx=route({name:'Viewer'},nums=>{requested=[...nums];return new Map([['261170',0]]);});
 const result=ctx.doGet({parameter:{action:'getWorkloadEstimates',nums:['bad','261170','261170',...Array.from({length:100},(_,i)=>String(300000+i))].join(',')}});
 assert.equal(requested.length,60);assert.equal(requested[0],'261170');assert.equal(result.estimates['261170'],0);
});
test('integration errors leave the workload available with unknown estimates',()=>{
 const ctx=route({name:'Viewer'},()=>{throw new Error('offline')});const result=ctx.doGet({parameter:{action:'getWorkloadEstimates',nums:'261170'}});assert.equal(Object.keys(result.estimates).length,0);assert.match(result.warning,/unavailable/);
});
