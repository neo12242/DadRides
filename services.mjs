// This module deliberately receives only DB, never the R2 binding.
import {canonical} from './edits.mjs';
const ID=/^[A-Za-z0-9_.-]{1,100}$/;
const NODE=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fields={serviceTypes:['id','name','enabled','configured','intervalKm','intervalDays'],maintenance:['id','name','serviceId','time','odometerKm','intervalKm','intervalDays','notes','parts','cost'],fuel:['id','time','odometerKm'],serviceBaselines:['id','date','odometerKm','enabled']};
function check(ok,message='Invalid service data'){if(!ok)throw Error(message)}
export function validateService(key,branches){
  const [prefix,kind,id,...rest]=key.split('/');
  check(prefix==='software'&&fields[kind]&&ID.test(id)&&!rest.length);
  check(Array.isArray(branches)&&branches.length>0&&branches.length<=100);
  for(const branch of branches){
    check(branch&&Object.keys(branch).sort().join(',')==='clock,value');
    const clock=branch.clock;check(clock&&typeof clock==='object'&&!Array.isArray(clock)&&Object.keys(clock).length>0&&Object.keys(clock).length<=100);
    for(const [node,n] of Object.entries(clock))check(NODE.test(node)&&Number.isSafeInteger(n)&&n>0);
    const v=branch.value;if(v===null)continue;
    check(v&&typeof v==='object'&&!Array.isArray(v)&&v.id===id&&Object.keys(v).every(k=>fields[kind].includes(k)),'Unexpected private service fields');
    if(kind==='serviceTypes'){
      check(typeof v.name==='string'&&v.name.length>0&&v.name.length<=100&&typeof v.enabled==='boolean'&&typeof v.configured==='boolean');
      check(Number.isFinite(v.intervalKm)&&v.intervalKm>=0&&v.intervalKm<=200000&&Number.isInteger(v.intervalDays)&&v.intervalDays>=0&&v.intervalDays<=3650);
    }else if(kind==='serviceBaselines'){
      check(id!=='mileage-record'&&Object.keys(v).length===4&&typeof v.enabled==='boolean');
      check(typeof v.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v.date)&&v.date>='1900-01-01'&&Number.isFinite(Date.parse(v.date))&&new Date(v.date).toISOString().slice(0,10)===v.date);
      check(Number.isFinite(v.odometerKm)&&v.odometerKm>=0&&v.odometerKm<=2000000);
    }else{
      check(Number.isSafeInteger(v.time)&&v.time>=0&&v.time<=8640000000000000&&Number.isFinite(v.odometerKm)&&v.odometerKm>=0&&v.odometerKm<=2000000);
      if(kind==='maintenance'){
        check(typeof v.name==='string'&&v.name.length>0&&v.name.length<=100&&typeof v.serviceId==='string'&&ID.test(v.serviceId));
        for(const k of ['notes','parts'])if(k in v)check(typeof v[k]==='string'&&v[k].length<=20000);
        for(const k of ['cost','intervalKm','intervalDays'])if(k in v)check(Number.isFinite(v[k])&&v[k]>=0&&v[k]<=1000000000);
      }
    }
  }
}
const dominates=(a,b)=>Object.keys(b).every(k=>(a[k]||0)>=b[k]);
export function mergeBranches(input){
  const same=new Map();
  for(const b of input){const key=canonical(b.value);const existing=same.get(key)||{value:b.value,clock:{}};for(const [k,n] of Object.entries(b.clock))existing.clock[k]=Math.max(existing.clock[k]||0,n);same.set(key,existing)}
  const all=[...same.values()];
  return all.filter((b,i)=>!all.some((a,j)=>i!==j&&dominates(a.clock,b.clock)&&!dominates(b.clock,a.clock))).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
}
export async function handleServices(req,db,parts,{json,bounded},readOnly=false){
  if(parts[0]!=='services')return null;
  if(req.method==='GET'&&parts.length===1){
    const {results}=await db.prepare('SELECT key,branches FROM service_mirror ORDER BY key').all();
    const records={serviceTypes:[],maintenance:[],fuel:[],serviceBaselines:[]},conflicts=[];
    for(const r of results){const branches=JSON.parse(r.branches);if(branches.length!==1){conflicts.push(r.key);continue}if(branches[0].value!==null)records[r.key.split('/')[1]].push(branches[0].value)}
    const contact=await db.prepare('SELECT received FROM service_contact WHERE id=1').first();
    return json({...records,conflicts,lastSync:contact?.received||null});
  }
  if(req.method!=='POST'||parts.join('/')!=='services/sync')return json({error:'Service records are edited in the apps'},405);
  if(readOnly)return json({error:'Service sync is temporarily paused'},503);
  const body=JSON.parse(new TextDecoder().decode(await bounded(req,2000000)));
  check(body.version===1&&body.records&&Object.keys(body).every(k=>['version','records','complete'].includes(k)));
  const entries=Object.entries(body.records);check(entries.length<=100);
  entries.forEach(([key,branches])=>validateService(key,branches));
  // CAS protects against overlapping Phone and ESP requests. Retrying partially applied batches is safe.
  for(const [key,incoming] of entries){
    let saved=false;
    for(let attempt=0;attempt<5&&!saved;attempt++){
      const old=await db.prepare('SELECT branches,version FROM service_mirror WHERE key=?').bind(key).first();
      const next=canonical(mergeBranches([...(old?JSON.parse(old.branches):[]),...incoming]));
      check(new TextEncoder().encode(next).length<=250000,'Resolve service conflicts in the apps before syncing');
      if(old?.branches===next){saved=true;break}
      const row=old?await db.prepare('UPDATE service_mirror SET branches=?,version=version+1 WHERE key=? AND version=? RETURNING key').bind(next,key,old.version).first():
        await db.prepare('INSERT OR IGNORE INTO service_mirror(key,branches) VALUES(?,?) RETURNING key').bind(key,next).first();
      saved=!!row;
    }
    if(!saved)return json({error:'Service sync is busy; retry safely'},409);
  }
  const received=Date.now();if(body.complete===true)await db.prepare('INSERT INTO service_contact(id,received) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET received=excluded.received').bind(received).run();
  return json({ok:true,received});
}
