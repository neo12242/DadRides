import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {validate,sha,safeJpeg} from '../worker.mjs';
import {execFileSync} from 'node:child_process';
const origin=process.env.DADRIDES_TEST_ORIGIN||'http://127.0.0.1:8890';const token=(await readFile(new URL('../owner-local.txt',import.meta.url),'utf8')).trim();
const request=async(path,method='GET',body,owner=true)=>{const r=await fetch(origin+'/api/'+path,{method,headers:{...(owner?{Authorization:'Bearer '+token}:{}),'content-type':'application/json'},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});return {status:r.status,data:await r.json()}};
const manifest=id=>({version:1,id,title:'TEST — local only',story:'No personal ride data.',date:'2026-09-14',tags:['test'],cover:'',photos:[],route:[[[0,0],[0.01,0.01]]],stats:{meters:1000,elapsedMs:600000},privacy:{trimMeters:500,statsIncluded:true}});
test('private schema rejects extra fields and excessive coordinates',()=>{assert.throws(()=>validate({...manifest(randomUUID()),parking:{lat:1}}));assert.throws(()=>validate({...manifest(randomUUID()),route:[[[999,1]]]}));assert.throws(()=>validate({...manifest(randomUUID()),photos:[{id:randomUUID(),caption:'x',sha:'bad'}]}))});
test('JPEG metadata guard rejects EXIF and non-JPEG',()=>{assert.equal(safeJpeg(new Uint8Array([255,216,255,225,0,2,255,218,0,2])),false);assert.equal(safeJpeg(new TextEncoder().encode('not an image')),false)});
test('anonymous visitors cannot upload or read owner metadata',async()=>{assert.equal((await request('owner/status','GET',undefined,false)).status,401);assert.equal((await request('rides/'+randomUUID(),'POST',{},false)).status,405)});
test('draft/retry/publish/revision conflict/unpublish lifecycle',async()=>{
 const id=randomUUID();const text=JSON.stringify(manifest(id));const rev=await sha(new TextEncoder().encode(text));
 try{
  const before=await request('owner/status');assert.equal(before.status,200);
  assert.equal((await request(`owner/rides/${id}/revisions/${rev}`,'PUT',text)).status,201);
  assert.equal((await request(`owner/rides/${id}/revisions/${rev}`,'PUT',text)).status,200);
  assert.equal((await request(`rides/${id}`,'GET',undefined,false)).status,404);
  assert.equal((await request(`owner/rides/${id}/publish`,'POST',{base:null,revision:rev})).status,400);
  assert.equal((await request(`owner/rides/${id}/finish/${rev}`,'POST',{})).status,200);
  assert.equal((await request(`owner/rides/${id}/publish`,'POST',{base:null,revision:rev})).status,200);
  const publicRide=await request(`rides/${id}`,'GET',undefined,false);assert.equal(publicRide.status,200);assert.equal(publicRide.data.manifest.title,'TEST — local only');
  assert.equal((await request(`owner/rides/${id}/publish`,'POST',{base:null,revision:rev})).status,409);
  assert.equal((await request(`owner/rides/${id}/revisions/${rev}`,'DELETE')).status,400);
  assert.equal((await request(`owner/rides/${id}/unpublish`,'POST',{base:rev})).status,200);
  assert.equal((await request(`rides/${id}`,'GET',undefined,false)).status,404);
 }finally{await request(`owner/rides/${id}/unpublish`,'POST',{base:rev});await request(`owner/rides/${id}/revisions/${rev}`,'DELETE')}
});
test('photo upload resumes after checksum failure and private media stays private',async()=>{
 const id=randomUUID(),pid=randomUUID();const bytes=await readFile(new URL('fixtures/landscape-0.jpg',import.meta.url));const hash=await sha(bytes);
 const m=manifest(id);m.cover=pid;m.photos=[{id:pid,caption:'Test photo',sha:hash,size:bytes.length,thumbSha:hash,thumbSize:bytes.length}];const text=JSON.stringify(m),rev=await sha(new TextEncoder().encode(text));
 const asset=async(suffix,body)=>fetch(origin+`/api/owner/assets/${rev}/${pid}.${suffix}`,{method:'PUT',headers:{Authorization:'Bearer '+token},body});
 try{
  assert.equal((await request(`owner/rides/${id}/revisions/${rev}`,'PUT',text)).status,201);
  assert.equal((await request(`owner/rides/${id}/finish/${rev}`,'POST',{})).status,400);
  assert.equal((await asset('jpg',bytes.slice(0,20))).status,400);
  assert.equal((await asset('jpg',bytes)).status,200);assert.equal((await asset('jpg',bytes)).status,200);
  assert.equal((await fetch(origin+`/api/assets/${rev}/${pid}.jpg`)).status,404);
  assert.equal((await request(`owner/rides/${id}/finish/${rev}`,'POST',{})).status,400);
  assert.equal((await asset('thumb.jpg',bytes)).status,200);
  assert.equal((await request(`owner/rides/${id}/finish/${rev}`,'POST',{})).status,200);
 }finally{await request(`owner/rides/${id}/revisions/${rev}`,'DELETE')}
});
test('concurrent draft reservations cannot exceed the configured quota',async()=>{
 const originals=await request('owner/status');const originalsQuota=originals.data.quota;
 const manifests=[manifest(randomUUID()),manifest(randomUUID())];const payloads=await Promise.all(manifests.map(async m=>({m,text:JSON.stringify(m),rev:await sha(new TextEncoder().encode(JSON.stringify(m)))})));
  const run=sql=>execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local',...(process.env.DADRIDES_TEST_PERSIST_TO?['--persist-to',process.env.DADRIDES_TEST_PERSIST_TO]:[]),'--command',sql],{stdio:'pipe'});
 try{
  run(`UPDATE limits SET quota=${originals.data.used+Buffer.byteLength(payloads[0].text)+10} WHERE id=1`);
  const results=await Promise.all(payloads.map(p=>request(`owner/rides/${p.m.id}/revisions/${p.rev}`,'PUT',p.text)));
  assert.equal(results.filter(r=>r.status===201).length,1);assert.equal(results.filter(r=>r.data.error==='Storage quota reached').length,1);
 }finally{run(`UPDATE limits SET quota=${originalsQuota} WHERE id=1`);for(const p of payloads)await request(`owner/rides/${p.m.id}/revisions/${p.rev}`,'DELETE')}
});
