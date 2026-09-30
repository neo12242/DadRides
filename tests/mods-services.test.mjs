import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handle as sourceHandle,sha} from '../worker.mjs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {serviceSummary} from '../site/services.js';
const handle=process.env.DADRIDES_TEST_WORKER?(await import(pathToFileURL(resolve(process.env.DADRIDES_TEST_WORKER)))).default.fetch:sourceHandle;

async function fixture(){
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  const statement=(sql,args=[])=>({bind(...v){return statement(sql,v)},first(){return db.prepare(sql).get(...args)??null},all(){return {results:db.prepare(sql).all(...args)}},run(){return db.prepare(sql).run(...args)}});
  const calls={get:0,put:0,delete:0},objects=new Map(),key=randomUUID()+randomUUID(),publisher=randomUUID()+randomUUID();
  const env={OWNER_TOKEN_SHA256:await sha(new TextEncoder().encode(key)),PUBLISHER_TOKEN_SHA256:await sha(new TextEncoder().encode(publisher)),DB:{prepare:statement,batch(items){db.exec('BEGIN');try{const r=items.map(s=>s.run());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}},PHOTOS:{get(k){calls.get++;return objects.has(k)?{body:objects.get(k)}:null},put(k,b){calls.put++;objects.set(k,b)},delete(k){calls.delete++;objects.delete(k)}}};
  const request=async(path,method='GET',body,auth='owner',extra={})=>{
    const headers={...(auth?{Authorization:'Bearer '+(auth==='publisher'?publisher:key)}:{}),'content-type':'application/json',...extra};
    const r=await handle(new Request('https://test.invalid/api/'+path,{method,headers,...(body===undefined?{}:{body:body instanceof Uint8Array?body:JSON.stringify(body)})}),env);
    return {status:r.status,data:r.headers.get('content-type')?.startsWith('image/')?new Uint8Array(await r.arrayBuffer()):await r.json()};
  };
  return {db,env,request,calls};
}
const sample=()=>({version:1,id:randomUUID(),slug:'test-mod',title:'A practical mod',summary:'What changed',category:'Ryker',date:'2026-09-24',story:'My work',installation:'Install notes',review:'My review',links:[{label:'Parts',url:'https://example.com/parts'}],tags:['comfort'],photos:[],cover:''});

test('services remain private, reject hidden fields, retain deletions and use zero R2 calls',async()=>{
  const f=await fixture(),key='software/maintenance/entry',node=randomUUID();
  const value={id:'entry',serviceId:'oil',name:'Oil',time:Date.parse('2026-09-22'),odometerKm:1.609344};
  const sync=branches=>f.request('owner/services/sync','POST',{version:1,records:{[key]:branches}});
  const stale=[{value,clock:{[node]:1}}];assert.equal((await sync(stale)).status,200);
  assert.equal((await f.request('owner/services','GET',undefined,null)).status,401);
  assert.equal((await f.request('services','GET',undefined,null)).status,404);
  assert.equal((await f.request('owner/services','GET',undefined,'publisher')).status,401);
  assert.equal((await sync([{value:{...value,receipt:'secret'},clock:{[node]:2}}])).status,400);
  await sync([{value:null,clock:{[node]:2}}]);await sync(stale);
  assert.equal((await f.request('owner/services')).data.maintenance.length,0);
  const other=randomUUID();await sync([{value:{...value,notes:'Concurrent'},clock:{[other]:1}}]);
  assert.equal((await f.request('owner/services')).data.conflicts.length,1);
  await sync([{value,clock:{[other]:2,[node]:2}}]);
  const data=(await f.request('owner/services')).data;assert.equal(data.conflicts.length,0);assert.equal(data.maintenance.length,1);
  assert.deepEqual(f.calls,{get:0,put:0,delete:0});f.db.close();
});
test('only a completed service batch advances the last successful sync time',async()=>{
  const f=await fixture();assert.equal((await f.request('owner/services')).data.lastSync,null);
  await f.request('owner/services/sync','POST',{version:1,records:{},complete:false});
  assert.equal((await f.request('owner/services')).data.lastSync,null);
  await f.request('owner/services/sync','POST',{version:1,records:{},complete:true});
  assert.ok((await f.request('owner/services')).data.lastSync>0);assert.deepEqual(f.calls,{get:0,put:0,delete:0});f.db.close();
});
test('service calculations use entered odometer, retain missing baselines and withhold conflicts',()=>{
  const data={serviceTypes:[{id:'oil',name:'Oil',enabled:true,configured:true,intervalKm:10,intervalDays:10},{id:'belt',enabled:true,configured:true,intervalKm:100,intervalDays:0}],maintenance:[{id:'one',serviceId:'oil',time:1000,odometerKm:1}],fuel:[{id:'fuel',odometerKm:15}],conflicts:[]};
  let s=serviceSummary(data,2000);assert.equal(s.odometer,15);assert.equal(s.items[0].remaining,-4);assert.equal(s.items[0].status,'Due');assert.equal(s.items[1].status,'No service baseline');
  data.conflicts=['software/maintenance/other'];s=serviceSummary(data,2000);assert.equal(s.items[0].status,'Resolve app conflicts');
});
test('new-bike baselines remain private and causal without adding completed history',async()=>{
  const f=await fixture(),node=randomUUID(),key='software/serviceBaselines/oil';
  const value={id:'oil',date:'2026-09-22',odometerKm:1.609344,enabled:true};
  const sync=(v,n)=>f.request('owner/services/sync','POST',{version:1,complete:true,records:{[key]:[{value:v,clock:{[node]:n}}]}});
  assert.equal((await sync(value,1)).status,200);
  let data=(await f.request('owner/services')).data;
  assert.deepEqual(data.serviceBaselines,[value]);assert.equal(data.maintenance.length,0);
  assert.equal((await f.request('owner/services','GET',undefined,null)).status,401);
  for(const bad of [{...value,date:'2026-02-30'},{...value,odometerKm:-1},{...value,receipt:'private'}])assert.equal((await sync(bad,2)).status,400);
  await sync({...value,enabled:false},2);await sync(value,1);
  data=(await f.request('owner/services')).data;assert.equal(data.serviceBaselines[0].enabled,false);
  await sync(null,3);await sync(value,1);assert.equal((await f.request('owner/services')).data.serviceBaselines.length,0);
  assert.deepEqual(f.calls,{get:0,put:0,delete:0});f.db.close();
});
test('baseline starts at one mile, completed service wins, and disabled baselines stop tracking',()=>{
  const mile=1.609344,data={serviceTypes:[{id:'oil',name:'Oil',enabled:true,configured:true,intervalKm:1000*mile,intervalDays:60}],maintenance:[],fuel:[],conflicts:[],serviceBaselines:[{id:'oil',date:'2026-09-22',odometerKm:mile,enabled:true}]};
  let s=serviceSummary(data,new Date(2026,8,22).getTime());
  assert.equal(s.odometer,mile);assert.equal(s.items[0].remaining,1000*mile);assert.equal(s.items[0].last,null);
  const date=new Date(s.items[0].due);assert.deepEqual([date.getFullYear(),date.getMonth(),date.getDate(),date.getHours()],[2026,10,21,0]);
  data.fuel=[{id:'reading',odometerKm:600*mile}];
  data.maintenance=[{id:'actual',serviceId:'oil',odometerKm:500*mile,time:new Date(2026,8,25).getTime()}];
  s=serviceSummary(data);assert.ok(Math.abs(s.items[0].remaining-900*mile)<1e-8);assert.equal(s.items[0].newBike,null);assert.equal(s.items[0].last.id,'actual');
  data.serviceBaselines[0].enabled=false;assert.equal(serviceSummary(data).items[0].last.id,'actual');
  data.maintenance=[];assert.equal(serviceSummary(data).items[0].status,'No service baseline');
});
test('one mod survives draft edits, independent publication and idempotent save retries',async()=>{
  const f=await fixture(),m=sample();const save=async(doc,base=null)=>f.request('owner/mods/'+m.id,'POST',{base,document:doc});
  let r=(await save(m)).data;const first=r.revision;assert.equal((await save(m)).data.revision,first);
  assert.equal((await f.request('mods','GET',undefined,null)).data.items.length,0);
  let published=(await f.request('owner/mods/'+m.id+'/publish','POST',{base:null,destination:'dadrides',revision:first})).data;
  r=(await save({...m,title:'Changed draft'},first)).data;
  assert.equal((await f.request('mods/test-mod','GET',undefined,null)).data.document.title,m.title);
  assert.equal((await f.request('owner/mods')).data.items.length,1);
  assert.equal((await save({...m,title:'Stale edit'},first)).status,409);
  assert.equal((await save({...m,slug:'changed-link'},r.revision)).status,400);
  const d=published.destinations[0];await f.request('owner/mods/'+m.id+'/publish','POST',{base:d.job,destination:'dadrides',revision:r.revision});
  assert.equal((await f.request('mods','GET',undefined,null)).data.items.length,1);
  assert.equal((await f.request('mods/test-mod','GET',undefined,null)).data.document.title,'Changed draft');
  assert.deepEqual(f.calls,{get:0,put:0,delete:0});f.db.close();
});
test('mod media is deduplicated, EXIF rejected, quota enforced and unpublished photos inaccessible',async()=>{
  const f=await fixture(),m=sample(),bytes=new Uint8Array([255,216,255,218,0,2,0,255,217]),hash=await sha(bytes);
  await f.request('owner/mod-media/'+hash,'POST',{bytes:bytes.length});assert.equal((await f.request('owner/mod-media/'+hash,'PUT',bytes)).status,200);await f.request('owner/mod-media/'+hash,'PUT',bytes);assert.equal(f.calls.put,1);
  m.photos=[{id:hash,caption:'Image'}];m.cover=hash;const r=(await f.request('owner/mods/'+m.id,'POST',{base:null,document:m})).data;
  assert.equal((await f.request('mod-media/'+hash,'GET',undefined,null)).status,404);assert.equal(f.calls.get,0);
  let d=(await f.request('owner/mods/'+m.id+'/publish','POST',{base:null,destination:'dadrides',revision:r.revision})).data.destinations[0];
  assert.equal((await f.request('mod-media/'+hash,'GET',undefined,null)).status,200);
  await f.request('owner/mods/'+m.id+'/publish','POST',{base:d.job,destination:'dadrides',revision:null});
  assert.equal((await f.request('mod-media/'+hash,'GET',undefined,null)).status,404);
  const exif=new Uint8Array([255,216,255,225,0,2,255,218,0,2]),bad=await sha(exif);await f.request('owner/mod-media/'+bad,'POST',{bytes:exif.length});assert.equal((await f.request('owner/mod-media/'+bad,'PUT',exif)).status,400);
  f.db.prepare('UPDATE limits SET quota=1').run();assert.equal((await f.request('owner/mod-media/'+'a'.repeat(64),'POST',{bytes:20})).status,400);f.db.close();
});
test('publisher leases scope access, refuse stale completion and keep failures independent',async()=>{
  const f=await fixture(),m=sample();const r=(await f.request('owner/mods/'+m.id,'POST',{base:null,document:m})).data;
  await f.request('owner/mods/'+m.id+'/publish','POST',{base:null,destination:'dadrides',revision:r.revision});
  await f.request('owner/mods/'+m.id+'/publish','POST',{base:null,destination:'alaskageek',revision:r.revision});
  assert.equal((await f.request('publisher/claim','POST',{},'owner')).status,401);
  let claim=(await f.request('publisher/claim','POST',{},'publisher')).data;assert.equal(claim.document.id,m.id);
  assert.equal((await f.request('publisher/claim','POST',{},'publisher')).data.job,null);
  assert.equal((await f.request('publisher/'+claim.job+'/media/'+'a'.repeat(64),'GET',undefined,'publisher',{'x-publisher-claim':claim.claim})).status,404);assert.equal(f.calls.get,0);
  assert.equal((await f.request('publisher/'+claim.job+'/complete','POST',{state:'published'},'publisher',{'x-publisher-claim':randomUUID()})).status,409);
  f.db.prepare('UPDATE mod_destinations SET lease=0 WHERE job=?').run(claim.job);
  const replacement=(await f.request('publisher/claim','POST',{},'publisher')).data;assert.equal(replacement.job,claim.job);assert.notEqual(replacement.claim,claim.claim);
  assert.equal((await f.request('publisher/'+claim.job+'/complete','POST',{state:'published'},'publisher',{'x-publisher-claim':claim.claim})).status,409);
  await f.request('publisher/'+replacement.job+'/complete','POST',{state:'failed',error:'build'},'publisher',{'x-publisher-claim':replacement.claim});
  let owner=(await f.request('owner/mods/'+m.id)).data;assert.equal(owner.destinations.find(d=>d.destination==='alaskageek').state,'failed');assert.equal((await f.request('mods/test-mod','GET',undefined,null)).status,200);
  const dest=owner.destinations.find(d=>d.destination==='alaskageek');await f.request('owner/mods/'+m.id+'/publish','POST',{base:dest.job,destination:'alaskageek',revision:r.revision});
  claim=(await f.request('publisher/claim','POST',{},'publisher')).data;
  await f.request('publisher/'+claim.job+'/complete','POST',{state:'published'},'publisher',{'x-publisher-claim':claim.claim});
  owner=(await f.request('owner/mods/'+m.id)).data;assert.equal(owner.destinations.find(d=>d.destination==='alaskageek').published,r.revision);
  assert.equal(f.db.prepare('SELECT count(*) n FROM mods').get().n,1);f.db.close();
});
test('migration repeats safely and pause switches retain reads',async()=>{
  const f=await fixture(),m=sample();await f.request('owner/mods/'+m.id,'POST',{base:null,document:m});
  const sql=readFileSync(new URL('../migrations/0002_mods_services.sql',import.meta.url),'utf8');f.db.exec(sql);f.db.exec(sql);
  f.env.MODS_READ_ONLY='true';f.env.SERVICES_READ_ONLY='true';assert.equal((await f.request('owner/mods')).data.items.length,1);
  assert.equal((await f.request('owner/mods/'+m.id,'POST',{base:null,document:m})).status,503);
  assert.equal((await f.request('owner/services/sync','POST',{version:1,records:{}})).status,503);f.db.close();
});
