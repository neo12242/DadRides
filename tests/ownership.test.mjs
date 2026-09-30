import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handle,sha} from '../worker.mjs';
import {blankOwnership,validateOwnership} from '../ownership.mjs';

async function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 const statement=(sql,args=[])=>({bind(...v){return statement(sql,v)},first(){return db.prepare(sql).get(...args)??null},all(){return {results:db.prepare(sql).all(...args)}},run(){return db.prepare(sql).run(...args)}});
 const key=randomUUID()+randomUUID();const env={OWNER_TOKEN_SHA256:await sha(new TextEncoder().encode(key)),DB:{prepare:statement,batch(items){db.exec('BEGIN');try{const result=items.map(s=>s.run());db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}},PHOTOS:{get(){throw Error('No image storage expected')},put(){throw Error('No image storage expected')}}};
 const request=async(path,method='GET',body,auth=true,headers={})=>{const r=await handle(new Request('https://test.invalid/api/'+path,{method,headers:{...(auth?{authorization:'Bearer '+key}:{}),'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')}};
 return {db,env,request};
}
test('private expenses distinguish missing prices, zero and estimates',()=>{
 const m=blankOwnership(randomUUID(),'Comfort seat');m.expenses=[{id:randomUUID(),date:'2026-09-29',label:'Part',amountCents:null},{id:randomUUID(),date:'2026-09-29',label:'Free installation',amountCents:0}];assert.doesNotThrow(()=>validateOwnership(m));
 for(const bad of [{...m,privateToken:'no'},{...m,estimateCents:-1},{...m,expenses:[{...m.expenses[0],date:'2026-02-30'}]},{...m,expenses:[{...m.expenses[0],amountCents:1.5}]},{...m,expenses:[m.expenses[0],m.expenses[0]]}])assert.throws(()=>validateOwnership(bad));
});
test('two-way revision writes are idempotent, preserve concurrent changes and stay private',async()=>{
 const f=await fixture();try{
  const m=blankOwnership(randomUUID(),'Test mod');m.estimateCents=80000;m.expenses=[{id:randomUUID(),date:'2026-09-29',label:'Part',amountCents:40000}];
  assert.equal((await f.request('owner/ownership','GET',undefined,false)).status,401);
  const saved=await f.request('owner/ownership/'+m.id,'POST',{base:null,document:m});assert.equal(saved.status,200);
  assert.equal((await f.request('owner/ownership/'+m.id,'POST',{base:null,document:m})).status,200);
  const changed={...m,notes:'Website edit'};const update=await f.request('owner/ownership/'+m.id,'POST',{base:saved.data.revision,document:changed});assert.equal(update.status,200);
  const conflict=await f.request('owner/ownership/'+m.id,'POST',{base:saved.data.revision,document:{...m,notes:'Offline phone edit'}});assert.equal(conflict.status,409);assert.deepEqual(conflict.data.current.document,changed);
  assert.equal((await f.request('ownership/'+m.id,'GET',undefined,false)).status,404);
  assert.equal((await f.request('owner/ownership/'+m.id+'/article','POST',{})).status,200);
  const article=(await f.request('owner/mods/'+m.id)).data;assert.equal('expenses' in article.document,false);assert.equal('notes' in article.document,false);
  assert.equal((await f.request('mods/'+article.slug,'GET',undefined,false)).status,404);
  await f.request('owner/mods/'+m.id+'/publish','POST',{destination:'dadrides',revision:article.revision,base:null});
  const publicCopy=await f.request('mods/'+article.slug,'GET',undefined,false);assert.equal(publicCopy.status,200);assert.equal(JSON.stringify(publicCopy.data).includes('amountCents'),false);assert.equal(JSON.stringify(publicCopy.data).includes('Website edit'),false);
 }finally{f.db.close()}
});
test('browser handoff is single-use, origin-checked, expiring and revoked on logout/key rotation',async()=>{
 const f=await fixture();try{
  const m=blankOwnership(randomUUID(),'Test browser edit');await f.request('owner/ownership/'+m.id,'POST',{base:null,document:m});
  const link=await f.request('owner/browser-handoff','POST',{modId:m.id});assert.equal(link.status,200);
  assert.equal((await f.request('session/exchange','POST',{code:link.data.code},false,{origin:'https://other.invalid'})).status,403);
  const session=await f.request('session/exchange','POST',{code:link.data.code},false,{origin:'https://test.invalid'});assert.equal(session.status,200);assert.equal(session.data.target,'#mod-edit/'+m.id);assert.match(session.cookie,/HttpOnly; SameSite=Strict; Max-Age=1800; Secure/);
  assert.equal((await f.request('session/exchange','POST',{code:link.data.code},false,{origin:'https://test.invalid'})).status,401);
  const cookie=session.cookie.split(';')[0];assert.equal((await f.request('owner/ownership','GET',undefined,false,{cookie})).status,200);
  assert.equal((await f.request('owner/ownership/'+m.id,'POST',{base:null,document:m},false,{cookie})).status,401);
  assert.equal((await f.request('owner/ownership/'+m.id,'POST',{base:null,document:m},false,{cookie,origin:'https://test.invalid'})).status,200);
  const old=f.env.OWNER_TOKEN_SHA256;f.env.OWNER_TOKEN_SHA256='0'.repeat(64);assert.equal((await f.request('owner/ownership','GET',undefined,false,{cookie})).status,401);f.env.OWNER_TOKEN_SHA256=old;
  await f.request('session/logout','POST',{},false,{cookie,origin:'https://test.invalid'});assert.equal((await f.request('owner/ownership','GET',undefined,false,{cookie})).status,401);
  const expired=await f.request('owner/browser-handoff','POST',{modId:m.id});f.db.exec('UPDATE browser_handoffs SET expires=0');assert.equal((await f.request('session/exchange','POST',{code:expired.data.code},false,{origin:'https://test.invalid'})).status,401);
 }finally{f.db.close()}
});
test('existing article drafts bootstrap private tracking without fabricated expenses',async()=>{
 const f=await fixture();try{const id=randomUUID();const article={version:1,id,slug:'existing',title:'Existing mod',summary:'Draft',category:'Ryker',date:'2026-09-29',story:'',installation:'',review:'',links:[],tags:[],photos:[],cover:''};
 await f.request('owner/mods/'+id,'POST',{base:null,document:article});const r=(await f.request('owner/ownership')).data.items[0];assert.equal(r.id,id);assert.equal(r.revision,null);assert.deepEqual(r.document.expenses,[]);assert.equal(r.document.estimateCents,null);
 }finally{f.db.close()}
});
