import {handleEdits,seedHead} from './edits.mjs';
import {handleServices} from './services.mjs';
import {handleMods,handleModPublisher} from './mods.mjs';
import {validateStops} from './stops.mjs';
import {handleOwnership} from './ownership.mjs';
import {browserAuthorized,handleBrowserSession,createHandoff} from './browser-session.mjs';
const UUID=/^[a-f0-9-]{36}$/;const HASH=/^[a-f0-9]{64}$/;
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
export const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
function check(ok,message='Invalid request'){if(!ok)throw new Error(message)}
export function validate(m){
 check(m && m.version===1 && UUID.test(m.id));
 const keys=['version','id','title','story','date','tags','cover','photos','route','stats','privacy','stops'];check(Object.keys(m).every(k=>keys.includes(k)),'Unexpected private data');
 check(typeof m.title==='string' && m.title.length>0 && m.title.length<=100);
 check(typeof m.story==='string' && m.story.length<=2000 && /^\d{4}-\d{2}-\d{2}$/.test(m.date));
 check(Array.isArray(m.tags)&&m.tags.length<=15&&m.tags.every(x=>typeof x==='string'&&x.length<=30));
 check(Array.isArray(m.route) && m.route.length<=20000);
 let count=0;for(const line of m.route){check(Array.isArray(line)&&line.length>=1);for(const p of line){check(Array.isArray(p)&&p.length===2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90);count++}}check(count<=20000);
 check(Array.isArray(m.photos)&&m.photos.length<=30);const ids=new Set();
 for(const p of m.photos){check(Object.keys(p).every(k=>['id','caption','sha','size','thumbSha','thumbSize'].includes(k)));check(UUID.test(p.id)&&!ids.has(p.id));ids.add(p.id);check(typeof p.caption==='string'&&p.caption.length<=500);check(HASH.test(p.sha)&&HASH.test(p.thumbSha));check(Number.isInteger(p.size)&&p.size>0&&p.size<=3000000&&Number.isInteger(p.thumbSize)&&p.thumbSize>0&&p.thumbSize<=500000)}
 check(m.cover===''||ids.has(m.cover));check(m.stats && Object.keys(m.stats).every(k=>['meters','elapsedMs','movingMs','stoppedMs','unknownMs','pausedMs','averageMps'].includes(k)));
 for(const n of Object.values(m.stats))check(n===null||Number.isFinite(n)&&n>=0&&n<=1e12);
 check(m.privacy && Object.keys(m.privacy).every(k=>['trimMeters','statsIncluded'].includes(k)));check(Number.isFinite(m.privacy.trimMeters)&&m.privacy.trimMeters>=0&&m.privacy.trimMeters<=10000 && typeof m.privacy.statsIncluded==='boolean');
 if(m.stats.pausedMs!==undefined){check(Number.isSafeInteger(m.stats.pausedMs));check(Math.abs(m.stats.elapsedMs-m.stats.movingMs-m.stats.stoppedMs-m.stats.unknownMs-m.stats.pausedMs)<=1,'Ride times must add up to elapsed time');}
 validateStops(m);
 return m;
}
async function bounded(request,max){const reader=request.body?.getReader();check(reader,'Empty body');let n=0;const chunks=[];while(true){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>max){await reader.cancel();throw new Error('Upload too large')}chunks.push(r.value)}const bytes=new Uint8Array(n);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length}return bytes}
export function safeJpeg(b){
 if(b.length<4||b[0]!==255||b[1]!==216)return false;
 let i=2;while(i+3<b.length){if(b[i++]!==255)return false;while(b[i]===255)i++;const marker=b[i++];if(marker===0xda)return true;if(marker===0xe1||marker===0xed||marker===0xfe)return false;if(marker===0xd9)return true;const length=b[i]*256+b[i+1];if(length<2||i+length>b.length)return false;i+=length}return false;
}
async function authorized(req,env){if(!HASH.test(env.OWNER_TOKEN_SHA256||''))return false;const token=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';if(token.length<32||token.length>256)return false;return await sha(new TextEncoder().encode(token))===env.OWNER_TOKEN_SHA256}
export async function handle(req,env){try{
  const url=new URL(req.url);const parts=url.pathname.split('/').filter(Boolean).slice(1);const owner=parts[0]==='owner';
  const helpers={json,bounded,sha,safeJpeg};
  if(parts[0]==='session')return await handleBrowserSession(req,env,parts,helpers);
 if(parts[0]==='publisher'){
   if(!await authorized(req,{OWNER_TOKEN_SHA256:env.PUBLISHER_TOKEN_SHA256}))return json({error:'Publisher authorization required'},401);
   if(req.headers.get('origin'))return json({error:'Publisher is server-only'},403);
   return await handleModPublisher(req,env,parts.slice(1),{json,bounded});
 }
  if(owner&&!(req.headers.has('authorization')?await authorized(req,env):await browserAuthorized(req,env,sha)))return json({error:'Owner authorization required'},401);
 if(req.method==='OPTIONS')return new Response(null,{status:405});
 if(req.method!=='GET'&&!owner)return json({error:'Not allowed'},405);
 if(owner&&req.headers.get('origin')&&req.headers.get('origin')!==url.origin)return json({error:'Origin rejected'},403);
 if(owner)parts.shift();
  const [resource,id,action,rev]=parts;
  if(owner&&resource==='browser-handoff'&&req.method==='POST')return await createHandoff(req,env,helpers);
  if(owner){const result=await handleOwnership(req,env,parts,helpers);if(result)return result;}
 if(owner){const result=await handleServices(req,env.DB,parts,{json,bounded},env.SERVICES_READ_ONLY==='true');if(result)return result;}
 {const result=await handleMods(req,env,parts,owner,{json,bounded,sha,safeJpeg});if(result)return result;}
 if(owner){const result=await handleEdits(req,env,parts,{json,bounded,validate,sha});if(result)return result;}
 if(resource==='status'&&owner&&req.method==='GET'){
   const used=await env.DB.prepare('SELECT (SELECT COALESCE(SUM(bytes),0) FROM revisions)+(SELECT COALESCE(SUM(bytes),0) FROM mod_media) used').first();const limit=await env.DB.prepare('SELECT quota FROM limits WHERE id=1').first();return json({...used,...limit,publisherConfigured:HASH.test(env.PUBLISHER_TOKEN_SHA256||'')});
 }
 if(resource==='rides'&&!id&&req.method==='GET'){
   const query=owner?`SELECT d.id,d.published,r.id revision,r.ready,r.manifest,
     (SELECT count(*) FROM revisions WHERE ride=d.id) versionCount
     FROM rides d LEFT JOIN edit_heads h ON h.ride=d.id
     JOIN revisions r ON r.id=COALESCE(h.revision,d.published,
       (SELECT id FROM revisions WHERE ride=d.id ORDER BY created DESC,id DESC LIMIT 1))
     ORDER BY json_extract(r.manifest,'$.date') DESC,d.id LIMIT 500`:'SELECT rides.id,rides.published,revisions.manifest FROM rides JOIN revisions ON revisions.id=rides.published WHERE revisions.ready>=0 ORDER BY json_extract(revisions.manifest,\'$.date\') DESC LIMIT 500';
   const {results}=await env.DB.prepare(query).all();return json(results.map(r=>({...r,manifest:JSON.parse(r.manifest)})));
 }
 if(resource==='rides'&&UUID.test(id||'')){
  if(req.method==='GET'){
    if(owner&&action==='revisions'&&!rev){
      const {results}=await env.DB.prepare(`SELECT r.id revision,r.ready,r.created,json_extract(r.manifest,'$.title') title,
        d.published,h.revision current FROM revisions r JOIN rides d ON d.id=r.ride
        LEFT JOIN edit_heads h ON h.ride=d.id WHERE r.ride=? ORDER BY r.created DESC,r.id DESC`).bind(id).all();
      return json(results);
    }
    const row=owner&&action==='revisions'&&HASH.test(rev||'')?await env.DB.prepare('SELECT *, (SELECT published FROM rides WHERE id=ride) published FROM revisions WHERE ride=? AND id=?').bind(id,rev).first():await env.DB.prepare('SELECT revisions.* FROM revisions JOIN rides ON rides.published=revisions.id WHERE rides.id=?').bind(id).first();
    return row?json({...row,manifest:JSON.parse(row.manifest)}):json({error:'Ride not found'},404);
  }
  if(owner&&req.method==='PUT'&&action==='revisions'&&HASH.test(rev||'')){
    const bytes=await bounded(req,4000000);check(await sha(bytes)===rev,'Revision hash mismatch');const text=new TextDecoder().decode(bytes);const m=validate(JSON.parse(text));check(m.id===id);
    const existing=await env.DB.prepare('SELECT id FROM revisions WHERE id=? AND ride=?').bind(rev,id).first();if(existing)return json({revision:rev});
    const total=bytes.length+m.photos.reduce((n,p)=>n+p.size+p.thumbSize,0);
    const statements=[env.DB.prepare('INSERT OR IGNORE INTO rides(id) VALUES(?)').bind(id),env.DB.prepare('INSERT INTO revisions(id,ride,manifest,bytes,created) VALUES(?,?,?,?,?)').bind(rev,id,text,total,Date.now())];
    for(const p of m.photos)for(const [suffix,hash,size]of [['jpg',p.sha,p.size],['thumb.jpg',p.thumbSha,p.thumbSize]])statements.push(env.DB.prepare('INSERT INTO assets(key,revision,sha,bytes) VALUES(?,?,?,?)').bind(`${rev}/${p.id}.${suffix}`,rev,hash,size));
    await env.DB.batch(statements);return json({revision:rev},201);
  }
  if(owner&&req.method==='POST'&&action==='finish'&&HASH.test(rev||'')){
    const missing=await env.DB.prepare('SELECT count(*) n FROM assets WHERE revision=? AND ready<>1').bind(rev).first();check(missing.n===0,'Photos are still uploading');const row=await env.DB.prepare('UPDATE revisions SET ready=1 WHERE id=? AND ride=? AND ready>=0 RETURNING id').bind(rev,id).first();check(row,'Draft not found');await seedHead(env.DB,id,rev);return json({ready:true});
  }
  if(owner&&req.method==='POST'&&['publish','unpublish'].includes(action)){
    const body=JSON.parse(new TextDecoder().decode(await bounded(req,2000)));check(body.base===null||HASH.test(body.base));
    if(action==='publish'){check(HASH.test(body.revision));check(await env.DB.prepare('SELECT id FROM revisions WHERE id=? AND ride=? AND ready=1').bind(body.revision,id).first(),'Draft is not ready');check(!await env.DB.prepare('SELECT revision FROM edit_safety WHERE revision=? AND needs_review=1').bind(body.revision).first(),'Open either app and sync to check the edited route privacy before publishing')}
    const result=await env.DB.prepare('UPDATE rides SET published=? WHERE id=? AND published IS ? AND (? IS NULL OR EXISTS(SELECT 1 FROM revisions WHERE id=? AND ride=? AND ready=1)) RETURNING id').bind(action==='publish'?body.revision:null,id,body.base,action==='publish'?body.revision:null,body.revision||null,id).first();return result?json({ok:true}):json({error:'Publication changed. Refresh before trying again.'},409);
  }
  if(owner&&req.method==='DELETE'&&action==='revisions'&&HASH.test(rev||'')){
    const r=await env.DB.prepare('SELECT * FROM revisions WHERE id=? AND ride=?').bind(rev,id).first();if(!r)return json({ok:true});check(!(await env.DB.prepare('SELECT id FROM rides WHERE published=?').bind(rev).first()),'Unpublish before deleting');
    check(!await env.DB.prepare('SELECT a.key FROM assets a JOIN revision_assets m ON m.asset=a.key WHERE a.revision=? AND m.revision<>? LIMIT 1').bind(rev,rev).first(),'Other edited versions still use these photos');
    const locked=await env.DB.prepare('UPDATE revisions SET ready=-1 WHERE id=? AND NOT EXISTS(SELECT 1 FROM rides WHERE published=?) AND NOT EXISTS(SELECT 1 FROM assets WHERE revision=? AND ready=2 AND lease>?) RETURNING id').bind(rev,rev,rev,Date.now()).first();check(locked,'Upload in progress; retry deletion later');
    // Keep reservation until all object removals succeed. Retrying a partial deletion is safe.
    const {results}=await env.DB.prepare('SELECT key FROM assets WHERE revision=?').bind(rev).all();for(const a of results)await env.PHOTOS.delete(a.key);
    await env.DB.batch([env.DB.prepare('UPDATE edit_heads SET revision=NULL WHERE revision=?').bind(rev),env.DB.prepare('DELETE FROM revision_assets WHERE revision=?').bind(rev),env.DB.prepare('DELETE FROM assets WHERE revision=?').bind(rev),env.DB.prepare('DELETE FROM revisions WHERE id=?').bind(rev)]);return json({ok:true});
  }
 }
 if(resource==='assets'&&HASH.test(id||'')&&/^[a-f0-9-]{36}\.(jpg|thumb.jpg)$/.test(action||'')){
   const mapped=req.method==='GET'?await env.DB.prepare('SELECT asset FROM revision_assets WHERE revision=? AND name=?').bind(id,action).first():null;
   const key=mapped?.asset||id+'/'+action;const row=await env.DB.prepare('SELECT * FROM assets WHERE key=?').bind(key).first();if(!row)return json({error:'Photo not found'},404);
   if(req.method==='GET'){
     if(!owner&&!await env.DB.prepare('SELECT id FROM rides WHERE published=?').bind(id).first())return json({error:'Photo not found'},404);
     const object=await env.PHOTOS.get(key);return object?new Response(object.body,{headers:{'content-type':'image/jpeg','cache-control':'no-store','x-content-type-options':'nosniff'}}):json({error:'Photo unavailable'},404);
   }
   if(owner&&req.method==='PUT'){
     if(row.ready===1)return json({ok:true});const bytes=await bounded(req,Math.min(row.bytes,3000000));check(bytes.length===row.bytes&&await sha(bytes)===row.sha,'Photo checksum mismatch');check(safeJpeg(bytes),'Upload a JPEG without EXIF metadata');
     const lock=await env.DB.prepare('UPDATE assets SET ready=2,lease=? WHERE key=? AND (ready=0 OR (ready=2 AND lease<?)) AND EXISTS(SELECT 1 FROM revisions WHERE id=? AND ready>=0) RETURNING key').bind(Date.now()+3600000,key,Date.now(),id).first();if(!lock)return json({error:'Upload already in progress or draft deleted; retry later'},409);
     try{await env.PHOTOS.put(key,bytes,{httpMetadata:{contentType:'image/jpeg'}});const saved=await env.DB.prepare('UPDATE assets SET ready=1,lease=0 WHERE key=? AND EXISTS(SELECT 1 FROM revisions WHERE id=? AND ready>=0) RETURNING key').bind(key,id).first();if(!saved){await env.PHOTOS.delete(key);throw Error('Draft deleted')}}catch(e){await env.DB.prepare('UPDATE assets SET ready=0,lease=0 WHERE key=?').bind(key).run();throw e}return json({ok:true});
   }
 }
 return json({error:'Not found'},404);
}catch(error){const message=String(error.message||'Request failed');console.error('DadRides request failed:',message.slice(0,160));return json({error:message.includes('quota')?'Storage quota reached':message.startsWith('D1')?'Database request failed':message.slice(0,160)},400)}}
