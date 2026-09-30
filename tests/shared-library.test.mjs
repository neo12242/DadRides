import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handle as sourceHandle,sha} from '../worker.mjs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const handle=process.env.DADRIDES_TEST_WORKER?(await import(pathToFileURL(resolve(process.env.DADRIDES_TEST_WORKER)))).default.fetch:sourceHandle;
import {canonical,routeSubset} from '../edits.mjs';

async function fixture({pauses=false}={}) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  const objects = new Map(), calls = {get:0,put:0,delete:0};
  const statement = (sql,args=[]) => ({
    bind(...values){return statement(sql,values)},
    first(){return db.prepare(sql).get(...args)??null},
    all(){return {results:db.prepare(sql).all(...args)}},
    run(){return db.prepare(sql).run(...args)}
  });
  const key = randomUUID() + randomUUID();
  const env = {OWNER_TOKEN_SHA256:await sha(new TextEncoder().encode(key)),DB:{prepare:statement,batch(list){
    db.exec('BEGIN IMMEDIATE');try{const result=list.map(s=>s.run());db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}
  }},PHOTOS:{get(k){calls.get++;return objects.has(k)?{body:objects.get(k)}:null},put(k,b){calls.put++;objects.set(k,b)},delete(k){calls.delete++;objects.delete(k)}}};
  async function request(path,method='GET',body,owner=true) {
    const r=await handle(new Request('https://test.invalid/api/'+(owner?'owner/':'')+path,{method,headers:{...(owner?{Authorization:'Bearer '+key}:{}),'content-type':'application/json'},
      ...(body===undefined?{}:{body:body instanceof Uint8Array?body:JSON.stringify(body)})}),env);
    return {status:r.status,data:r.headers.get('content-type')?.startsWith('image/')?new Uint8Array(await r.arrayBuffer()):await r.json()};
  }
  const id=randomUUID(),photo=randomUUID(),bytes=new Uint8Array([255,216,255,218,0,2,0,255,217]);
  const digest=await sha(bytes);
  const m={version:1,id,title:'Synthetic ride',story:'Test',date:'2026-09-24',tags:[],cover:photo,photos:[{id:photo,caption:'Original caption',sha:digest,size:bytes.length,thumbSha:digest,thumbSize:bytes.length}],
    route:[[[1,1],[1.01,1.01],[1.02,1.02]]],stats:{meters:1000,elapsedMs:600000,movingMs:400000,stoppedMs:100000,unknownMs:100000,averageMps:2.5},privacy:{trimMeters:500,statsIncluded:true}};
  if(pauses){m.stats.pausedMs=100000;m.stats.unknownMs=0;m.stops=[{point:[1.02,1.02],durationMs:100000}]}
  const original=await sha(new TextEncoder().encode(JSON.stringify(m)));
  assert.equal((await request(`rides/${id}/revisions/${original}`,'PUT',m)).status,201);
  for(const suffix of ['jpg','thumb.jpg'])assert.equal((await request(`assets/${original}/${photo}.${suffix}`,'PUT',bytes)).status,200);
  assert.equal((await request(`rides/${id}/finish/${original}`,'POST')).status,200);
  return {db,request,calls,m,id,photo,original,bytes,env};
}

test('pause metadata sync, editing and route privacy removal use zero R2 calls',async()=>{
  const {db,request,calls,m,id,original}=await fixture({pauses:true});const before={...calls};
  const sync=await request('sync?after=0');assert.equal(sync.data.changes[0].manifest.stats.pausedMs,100000);
  const edited=structuredClone(m);edited.title='Reviewed break';edited.route[0].pop();
  const saved=await request(`rides/${id}/edit`,'POST',{base:original,manifest:edited});
  assert.equal(saved.status,200);assert.deepEqual(saved.data.manifest.stops,[]);
  const changed=await request('sync?after='+sync.data.cursor);assert.equal(changed.data.changes[0].manifest.stats.pausedMs,100000);
  assert.equal((await request(`rides/${id}/publish`,'POST',{base:null,revision:saved.data.revision})).status,200);
  assert.deepEqual(calls,before);db.close();
});

test('metadata edit, incremental sync, publication and retry perform no R2 operations',async()=>{
  const f=await fixture();const {request,m,id,calls,original}=f;
  const baseline={...calls};
  const initial=await request('sync?after=0');assert.equal(initial.data.changes.length,1);
  const edited=structuredClone(m);edited.title='Edited on the website';edited.photos[0].caption='New caption';edited.stats.meters=1600;
  const saved=await request(`rides/${id}/edit`,'POST',{base:original,manifest:edited});assert.equal(saved.status,200);assert.equal(saved.data.manifest.stats.averageMps,4);
  const retry=await request(`rides/${id}/edit`,'POST',{base:original,manifest:edited});assert.equal(retry.status,200);assert.equal(retry.data.revision,saved.data.revision);
  const changed=await request('sync?after='+initial.data.cursor);assert.equal(changed.data.changes.length,1);assert.equal(changed.data.changes[0].manifest.title,edited.title);
  assert.equal((await request(`rides/${id}/publish`,'POST',{base:null,revision:saved.data.revision})).status,200);
  const published=await request(`rides/${id}`,'GET',undefined,false);assert.equal(published.data.manifest.title,edited.title);
  const empty=await request('sync?after='+(await request('sync?after=0')).data.cursor);assert.equal(empty.data.changes.length,0);
  assert.deepEqual(calls,baseline);
  const picture=await request(`assets/${saved.data.revision}/${f.photo}.jpg`,'GET',undefined,false);assert.equal(picture.status,200);assert.deepEqual(picture.data,f.bytes);
  assert.equal(calls.get,baseline.get+1);assert.equal(calls.put,baseline.put);
  f.db.close();
});

test('Owner shows one current ride after repeated edits while history and publication remain separate',async()=>{
  const f=await fixture();const before={...f.calls};
  await f.request(`rides/${f.id}/publish`,'POST',{base:null,revision:f.original});
  let revision=f.original;
  for(const title of ['Edited once','Edited twice']){
    const saved=await f.request(`rides/${f.id}/edit`,'POST',{base:revision,manifest:{...f.m,title}});
    assert.equal(saved.status,200);revision=saved.data.revision;
  }
  // An independently uploaded version must not hide the current editorial head.
  const upload={...f.m,title:'Unselected upload',photos:[],cover:''};const hash=await sha(new TextEncoder().encode(JSON.stringify(upload)));
  await f.request(`rides/${f.id}/revisions/${hash}`,'PUT',upload);
  const owner=(await f.request('rides')).data;
  assert.equal(owner.length,1);assert.equal(owner[0].id,f.id);assert.equal(owner[0].revision,revision);
  assert.equal(owner[0].manifest.title,'Edited twice');assert.equal(owner[0].versionCount,4);
  assert.equal((await f.request('rides','GET',undefined,false)).data[0].manifest.title,f.m.title);
  const history=(await f.request(`rides/${f.id}/revisions`)).data;
  assert.equal(history.length,4);assert.ok(history.some(r=>r.revision===f.original&&r.published===f.original));
  assert.equal(history.filter(r=>r.current===r.revision).length,1);
  assert.equal((await f.request(`rides/${f.id}/edit`)).data.revision,revision);
  assert.deepEqual(f.calls,before);
  await f.request(`rides/${f.id}/publish`,'POST',{base:f.original,revision});
  assert.equal((await f.request('rides','GET',undefined,false)).data.length,1);
  assert.equal((await f.request('rides')).data.length,1);
  f.db.close();
});

test('Owner keeps unfinished uploads visible and falls back to the published ride if its current draft is deleted',async()=>{
  const f=await fixture();
  await f.request(`rides/${f.id}/publish`,'POST',{base:null,revision:f.original});
  const saved=await f.request(`rides/${f.id}/edit`,'POST',{base:f.original,manifest:{...f.m,title:'Discarded draft'}});
  assert.equal((await f.request(`rides/${f.id}/revisions/${saved.data.revision}`,'DELETE')).status,200);
  assert.equal((await f.request('rides')).data[0].revision,f.original);
  const id=randomUUID(),m={...f.m,id,photos:[],cover:''},revision=await sha(new TextEncoder().encode(JSON.stringify(m)));
  await f.request(`rides/${id}/revisions/${revision}`,'PUT',m);
  assert.equal((await f.request('rides')).data.find(r=>r.id===id).ready,0);
  f.db.close();
});

test('concurrent edits conflict, draft media stays private, and source photos cannot be deleted',async()=>{
  const f=await fixture();const {request,m,id,original,photo,calls}=f;
  const saved=await request(`rides/${id}/edit`,'POST',{base:original,manifest:{...m,title:'Winner'}});
  const conflict=await request(`rides/${id}/edit`,'POST',{base:original,manifest:{...m,title:'Concurrent'}});assert.equal(conflict.status,409);assert.equal(conflict.data.current.manifest.title,'Winner');
  assert.equal((await request(`assets/${saved.data.revision}/${photo}.jpg`,'GET',undefined,false)).status,404);
  assert.equal((await request(`rides/${id}/revisions/${original}`,'DELETE')).status,400);assert.equal(calls.delete,0);
  assert.equal((await request('sync?after=0','GET',undefined,false)).status,404);
  assert.equal((await request('sync?after=999999')).status,409);
  const bad=structuredClone(saved.data.manifest);bad.photos[0].sha='a'.repeat(64);
  assert.equal((await request(`rides/${id}/edit`,'POST',{base:saved.data.revision,manifest:bad})).status,400);
  const badStats={...saved.data.manifest,stats:{...m.stats,elapsedMs:1}};
  assert.equal((await request(`rides/${id}/edit`,'POST',{base:saved.data.revision,manifest:badStats})).status,400);
  f.db.close();
});

test('route corrections require phone privacy validation and preserve original geometry',async()=>{
  const f=await fixture();const {request,m,id,original,calls}=f;const before={...calls};
  const edited={...m,route:[[[1.5,1.5],[1.01,1.01],[1.02,1.02]]]};
  const saved=await request(`rides/${id}/edit`,'POST',{base:original,manifest:edited});assert.equal(saved.data.needsReview,true);
  assert.equal((await request(`rides/${id}/publish`,'POST',{base:null,revision:saved.data.revision})).status,400);
  const verified=await request(`rides/${id}/verify-route`,'POST',{base:saved.data.revision,route:[[[1.01,1.01],[1.02,1.02]]]});assert.equal(verified.data.needsReview,false);
  assert.equal((await request(`rides/${id}/publish`,'POST',{base:null,revision:verified.data.revision})).status,200);
  assert.deepEqual((await request(`rides/${id}/revisions/${original}`)).data.manifest.route,m.route);
  assert.deepEqual(calls,before);f.db.close();
});

test('migration is repeatable and never resets a later editorial head',async()=>{
  const f=await fixture();const edited=await f.request(`rides/${f.id}/edit`,'POST',{base:f.original,manifest:{...f.m,title:'Keep my edit'}});
  const migration=readFileSync(new URL('../migrations/0001_shared_library.sql',import.meta.url),'utf8');f.db.exec(migration);f.db.exec(migration);
  assert.equal((await f.request(`rides/${f.id}/edit`)).data.revision,edited.data.revision);f.db.close();
});
test('canonical serialization and privacy subset do not bridge separate original segments',()=>{
  assert.equal(canonical({b:1,a:{c:2}}),'{"a":{"c":2},"b":1}');
  assert.equal(routeSubset([[[1,1],[3,3]]],[[[1,1],[2,2]],[[3,3]]]),false);
});
test('deleting the current remote draft produces a sync tombstone and allows a new upload',async()=>{
  const f=await fixture();const before=(await f.request('sync?after=0')).data.cursor;
  assert.equal((await f.request(`rides/${f.id}/revisions/${f.original}`,'DELETE')).status,200);
  const changes=(await f.request('sync?after='+before)).data.changes;assert.equal(changes.length,1);assert.equal(changes[0].deleted,true);
  assert.equal((await f.request(`rides/${f.id}/edit`)).status,404);
  const m={...f.m,photos:[],cover:'',route:[],title:'New uploaded copy'};const revision=await sha(new TextEncoder().encode(JSON.stringify(m)));
  assert.equal((await f.request(`rides/${f.id}/revisions/${revision}`,'PUT',m)).status,201);
  assert.equal((await f.request(`rides/${f.id}/finish/${revision}`,'POST')).status,200);
  assert.equal((await f.request(`rides/${f.id}/edit`)).data.revision,revision);f.db.close();
});
test('a prepared upload cannot replace edits made after its preview without review',async()=>{
  const f=await fixture();const head=await f.request(`rides/${f.id}/edit`,'POST',{base:f.original,manifest:{...f.m,title:'Website changed'}});
  const m={...f.m,title:'Prepared in app'};const revision=await sha(new TextEncoder().encode(JSON.stringify(m)));
  assert.equal((await f.request(`rides/${f.id}/revisions/${revision}`,'PUT',m)).status,201);
  // This independent prepared version still needs its photos; selecting it early is rejected.
  assert.equal((await f.request(`rides/${f.id}/adopt`,'POST',{base:head.data.revision,revision})).status,400);
  f.db.prepare('UPDATE revisions SET ready=1 WHERE id=?').run(revision);
  assert.equal((await f.request(`rides/${f.id}/adopt`,'POST',{base:f.original,revision})).status,409);
  assert.equal((await f.request(`rides/${f.id}/adopt`,'POST',{base:head.data.revision,revision})).data.revision,revision);f.db.close();
});
test('incremental sync pages all changed rides without skipping a cursor boundary',async()=>{
  const f=await fixture();const baseline=(await f.request('sync?after=0')).data.cursor;
  for(let i=0;i<13;i++){
    const id=randomUUID(),m={...f.m,id,photos:[],cover:'',route:[]};const rev=await sha(new TextEncoder().encode(JSON.stringify(m)));
    await f.request(`rides/${id}/revisions/${rev}`,'PUT',m);await f.request(`rides/${id}/finish/${rev}`,'POST');
  }
  let cursor=baseline,more=true;const ids=[];let pages=0;
  while(more){const page=(await f.request('sync?after='+cursor)).data;ids.push(...page.changes.map(r=>r.id));cursor=page.cursor;more=page.more;pages++;assert.ok(pages<10)}
  assert.equal(ids.length,13);assert.equal(new Set(ids).size,13);assert.ok(pages>=3);f.db.close();
});


test('rollback mode pauses new edit writes while retaining reads and published media',async()=>{
  const f=await fixture();
  const saved=await f.request(`rides/${f.id}/edit`,'POST',{base:f.original,manifest:{...f.m,title:'Published edited version'}});
  await f.request(`rides/${f.id}/publish`,'POST',{base:null,revision:saved.data.revision});
  f.env.EDITS_READ_ONLY='true';const baseline={...f.calls};
  assert.equal((await f.request(`rides/${f.id}/edit`,'POST',{base:saved.data.revision,manifest:{...f.m,title:'Blocked'}})).status,503);
  assert.equal((await f.request(`rides/${f.id}/verify-route`,'POST',{})).status,503);
  assert.equal((await f.request(`rides/${f.id}/adopt`,'POST',{})).status,503);
  assert.equal((await f.request('sync?after=0')).data.changes[0].manifest.title,'Published edited version');
  assert.deepEqual(f.calls,baseline);
  assert.equal((await f.request(`assets/${saved.data.revision}/${f.photo}.jpg`,'GET',undefined,false)).status,200);
  f.db.close();
});
