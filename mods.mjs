import {canonical} from './edits.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const check=(ok,message='Invalid mod data')=>{if(!ok)throw Error(message)};
const text=(value,max,required=false)=>typeof value==='string'&&value.length<=max&&(!required||value.trim().length>0);
export function validateMod(m){
  check(m&&Object.keys(m).sort().join(',')==='category,cover,date,id,installation,links,photos,review,slug,story,summary,tags,title,version');
  check(m.version===1&&UUID.test(m.id)&&SLUG.test(m.slug)&&m.slug.length<=80);
  for(const [key,max,required] of [['title',100,true],['summary',500,true],['category',80,true],['story',20000,false],['installation',20000,false],['review',20000,false]])check(text(m[key],max,required),`Check the mod ${key}`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(m.date)&&!Number.isNaN(Date.parse(m.date))&&new Date(m.date).toISOString().slice(0,10)===m.date);
  check(Array.isArray(m.tags)&&m.tags.length<=15&&m.tags.every(t=>text(t,30,true)));
  check(Array.isArray(m.links)&&m.links.length<=20);
  for(const link of m.links){check(link&&Object.keys(link).sort().join(',')==='label,url'&&text(link.label,100,true)&&text(link.url,2000,true));const u=new URL(link.url);check(u.protocol==='https:'&&!u.username&&!u.password,'Links must use HTTPS without credentials')}
  check(Array.isArray(m.photos)&&m.photos.length<=20);
  const seen=new Set();for(const p of m.photos){check(p&&Object.keys(p).sort().join(',')==='caption,id'&&HASH.test(p.id)&&!seen.has(p.id)&&text(p.caption,500));seen.add(p.id)}
  check(m.cover===''||seen.has(m.cover));return m;
}
async function current(db,id){
  const row=await db.prepare('SELECT m.id,m.slug,m.head revision,r.document FROM mods m JOIN mod_revisions r ON r.id=m.head WHERE m.id=?').bind(id).first();
  if(!row)return null;
  const {results}=await db.prepare('SELECT destination,desired,published,state,job,error,updated FROM mod_destinations WHERE mod=?').bind(id).all();
  return {...row,document:JSON.parse(row.document),destinations:results};
}
async function ready(db,revision){
  return !(await db.prepare('SELECT x.media FROM mod_revision_media x JOIN mod_media m ON m.id=x.media WHERE x.revision=? AND m.ready<>1 LIMIT 1').bind(revision).first());
}
export async function handleMods(req,env,parts,owner,h){
  const {json,bounded,sha,safeJpeg}=h;const [kind,id,action]=parts;
  if(!['mods','mod-media'].includes(kind))return null;
  const body=async max=>JSON.parse(new TextDecoder().decode(await bounded(req,max)));
  if(owner&&req.method!=='GET'&&env.MODS_READ_ONLY==='true')return json({error:'Mod changes are temporarily paused'},503);
  if(kind==='mod-media'&&parts.length===2&&HASH.test(id||'')){
    let row=await env.DB.prepare('SELECT * FROM mod_media WHERE id=?').bind(id).first();
    if(owner&&req.method==='POST'){
      const b=await body(1000);check(Number.isInteger(b.bytes)&&b.bytes>0&&b.bytes<=3000000&&Object.keys(b).join(',')==='bytes');
      if(row)check(row.bytes===b.bytes,'Image size mismatch');
      else await env.DB.prepare('INSERT OR IGNORE INTO mod_media(id,sha,bytes) VALUES(?,?,?)').bind(id,id,b.bytes).run();
      return json({id,ready:row?.ready===1});
    }
    if(!row)return json({error:'Image not found'},404);
    if(req.method==='GET'){
      if(!owner&&!await env.DB.prepare('SELECT m.id FROM mods m JOIN mod_revision_media x ON x.revision=m.published WHERE x.media=? LIMIT 1').bind(id).first())return json({error:'Image not found'},404);
      const object=row.ready===1?await env.PHOTOS.get('mods/'+id+'.jpg'):null;
      return object?new Response(object.body,{headers:{'content-type':'image/jpeg','cache-control':'no-store','x-content-type-options':'nosniff'}}):json({error:'Image unavailable'},404);
    }
    if(owner&&req.method==='PUT'){
      if(row.ready===1)return json({ok:true});
      const bytes=await bounded(req,row.bytes);check(bytes.length===row.bytes&&await sha(bytes)===id,'Image checksum mismatch');check(safeJpeg(bytes),'Upload a JPEG without EXIF metadata');
      const lock=await env.DB.prepare('UPDATE mod_media SET ready=2,lease=? WHERE id=? AND (ready=0 OR (ready=2 AND lease<?)) RETURNING id').bind(Date.now()+300000,id,Date.now()).first();
      if(!lock)return json({error:'Image upload in progress; retry shortly'},409);
      try{await env.PHOTOS.put('mods/'+id+'.jpg',bytes,{httpMetadata:{contentType:'image/jpeg'}});await env.DB.prepare('UPDATE mod_media SET ready=1,lease=0 WHERE id=?').bind(id).run()}
      catch(e){await env.DB.prepare('UPDATE mod_media SET ready=0,lease=0 WHERE id=?').bind(id).run();throw e}
      return json({ok:true});
    }
  }
  if(kind!=='mods')return json({error:'Not found'},404);
  if(req.method==='GET'&&parts.length===1){
    const {results}=await env.DB.prepare(`SELECT m.id,m.slug,m.head,m.published,r.id revision,r.document FROM mods m JOIN mod_revisions r ON r.id=m.${owner?'head':'published'} ORDER BY r.created DESC LIMIT 500`).all();
    const rows=[];for(const r of results)rows.push(owner?await current(env.DB,r.id):{id:r.id,slug:r.slug,revision:r.revision,document:JSON.parse(r.document)});
    return json({items:rows,publisherConfigured:owner?HASH.test(env.PUBLISHER_TOKEN_SHA256||''):undefined});
  }
  if(!id)return json({error:'Not found'},404);
  if(req.method==='GET'&&parts.length===2){
    if(owner){const r=UUID.test(id)?await current(env.DB,id):null;return r?json(r):json({error:'Mod not found'},404)}
    const r=await env.DB.prepare('SELECT m.id,m.slug,r.id revision,r.document FROM mods m JOIN mod_revisions r ON r.id=m.published WHERE m.slug=?').bind(id).first();
    return r?json({...r,document:JSON.parse(r.document)}):json({error:'Mod not found'},404);
  }
  if(!owner||!UUID.test(id))return json({error:'Not found'},404);
  if(req.method==='POST'&&parts.length===2){
    const b=await body(150000);check(b.base===null||HASH.test(b.base));const m=validateMod(b.document);check(m.id===id);
    const old=await current(env.DB,id);check(!old||old.slug===m.slug,'The public link stays fixed after the first save');
    const doc=canonical(m),revision=await sha(new TextEncoder().encode(doc));
    if(old?.revision===revision)return json(old);
    if((old?.revision||null)!==b.base)return json({error:'This draft changed. Reload before saving; your text remains here.'},409);
    for(const p of m.photos)check(await env.DB.prepare('SELECT id FROM mod_media WHERE id=? AND ready=1').bind(p.id).first(),'Finish uploading images before saving');
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO mods(id,slug) VALUES(?,?)').bind(id,m.slug),
      env.DB.prepare('INSERT OR IGNORE INTO mod_revisions(id,mod,document,created) VALUES(?,?,?,?)').bind(revision,id,doc,Date.now()),
      ...m.photos.map(p=>env.DB.prepare('INSERT OR IGNORE INTO mod_revision_media(revision,media) VALUES(?,?)').bind(revision,p.id)),
      env.DB.prepare('UPDATE mods SET head=? WHERE id=? AND head IS ?').bind(revision,id,b.base)
    ]);
    const result=await current(env.DB,id);return result?.revision===revision?json(result):json({error:'This draft changed. Reload before saving; your text remains here.'},409);
  }
  if(req.method==='POST'&&action==='publish'&&parts.length===3){
    const b=await body(2000);check(['dadrides','alaskageek'].includes(b.destination));check(b.revision===null||HASH.test(b.revision));check(b.base===null||UUID.test(b.base));
    const mod=await current(env.DB,id);check(mod,'Mod not found');
    if(b.revision){check(mod.revision===b.revision,'Preview the current saved draft before publishing');check(await ready(env.DB,b.revision),'Images are not ready')}
    if(b.destination==='alaskageek'&&!HASH.test(env.PUBLISHER_TOKEN_SHA256||''))return json({error:'The Alaska Geek publisher needs server setup before publishing'},503);
    const previous=mod.destinations.find(d=>d.destination===b.destination);
    if((previous?.job||null)!==b.base||previous?.state==='publishing')return json({error:'Publication changed or is in progress. Refresh its status.'},409);
    const job=crypto.randomUUID(),now=Date.now(),immediate=b.destination==='dadrides';
    const writes=[env.DB.prepare(`INSERT INTO mod_destinations(mod,destination,desired,published,state,job,updated) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(mod,destination) DO UPDATE SET desired=excluded.desired,published=CASE WHEN ? THEN excluded.desired ELSE mod_destinations.published END,state=excluded.state,job=excluded.job,error=NULL,claim=NULL,lease=0,updated=excluded.updated WHERE mod_destinations.job=? AND mod_destinations.state<>'publishing'`).bind(id,b.destination,b.revision,immediate?b.revision:null,immediate?(b.revision?'published':'unpublished'):'queued',job,now,immediate?1:0,b.base)];
    if(immediate)writes.push(env.DB.prepare('UPDATE mods SET published=(SELECT desired FROM mod_destinations WHERE mod=mods.id AND destination=?) WHERE id=? AND EXISTS(SELECT 1 FROM mod_destinations WHERE mod=? AND job=?)').bind('dadrides',id,id,job));
    await env.DB.batch(writes);
    const result=await current(env.DB,id);
    return result.destinations.some(d=>d.job===job)?json(result):json({error:'Publication changed. Refresh its status.'},409);
  }
  return json({error:'Not found'},404);
}

// A separate, scoped publisher credential cannot read services, rides, or arbitrary private images.
export async function handleModPublisher(req,env,parts,h){
  const {json,bounded}=h;
  if(env.MODS_READ_ONLY==='true')return json({error:'Publication dispatch is paused'},503);
  if(req.method==='POST'&&parts.join('/')==='claim'){
    const job=await env.DB.prepare("SELECT job FROM mod_destinations WHERE destination='alaskageek' AND (state='queued' OR (state='publishing' AND lease<?)) ORDER BY updated LIMIT 1").bind(Date.now()).first();
    if(!job)return json({job:null});
    const claim=crypto.randomUUID(),now=Date.now();
    const row=await env.DB.prepare("UPDATE mod_destinations SET state='publishing',claim=?,lease=?,updated=? WHERE job=? AND (state='queued' OR (state='publishing' AND lease<?)) RETURNING *").bind(claim,now+1200000,now,job.job,now).first();
    if(!row)return json({job:null});
    const mod=await env.DB.prepare('SELECT slug FROM mods WHERE id=?').bind(row.mod).first();
    const revision=row.desired?await env.DB.prepare('SELECT document FROM mod_revisions WHERE id=? AND mod=?').bind(row.desired,row.mod).first():null;
    return json({job:row.job,claim,mod:row.mod,slug:mod.slug,revision:row.desired,document:revision?JSON.parse(revision.document):null});
  }
  const [job,action,media]=parts;
  if(!UUID.test(job||''))return json({error:'Not found'},404);
  const row=await env.DB.prepare("SELECT * FROM mod_destinations WHERE job=? AND destination='alaskageek' AND state='publishing' AND claim=? AND lease>?").bind(job,req.headers.get('x-publisher-claim')||'',Date.now()).first();
  if(!row)return json({error:'Publication lease expired or changed'},409);
  if(req.method==='POST'&&action==='heartbeat'&&parts.length===2){await env.DB.prepare('UPDATE mod_destinations SET lease=? WHERE job=? AND claim=?').bind(Date.now()+1200000,job,row.claim).run();return json({active:true})}
  if(req.method==='GET'&&action==='media'&&parts.length===3&&HASH.test(media||'')){
    if(!row.desired||!await env.DB.prepare('SELECT media FROM mod_revision_media WHERE revision=? AND media=?').bind(row.desired,media).first())return json({error:'Image not in this publication'},404);
    const object=await env.PHOTOS.get('mods/'+media+'.jpg');return object?new Response(object.body,{headers:{'content-type':'image/jpeg','cache-control':'no-store'}}):json({error:'Image unavailable'},404);
  }
  if(req.method==='POST'&&action==='complete'&&parts.length===2){
    const b=JSON.parse(new TextDecoder().decode(await bounded(req,1000)));check(['published','failed'].includes(b.state));
    const state=b.state==='published'?(row.desired?'published':'unpublished'):'failed';
    // Only a verified deployed marker allows the worker to report success. Error codes, never raw logs.
    const code=b.state==='failed'&&['source_changed','build','transport','validation','verification'].includes(b.error)?b.error:null;
    await env.DB.prepare('UPDATE mod_destinations SET state=?,published=CASE WHEN ? THEN desired ELSE published END,error=?,claim=NULL,lease=0,updated=? WHERE job=? AND claim=?').bind(state,b.state==='published'?1:0,code,Date.now(),job,row.claim).run();return json({ok:true});
  }
  return json({error:'Not found'},404);
}
