import {ensureArticle} from './ownership.mjs';
const HEX=/^[a-f0-9]{64}$/;
const secret=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
const cookieName='dadrides_session';
export async function browserAuthorized(req,env,sha){
  const value=req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if(!HEX.test(value||'')||!HEX.test(env.OWNER_TOKEN_SHA256||''))return false;
  if(req.method!=='GET'&&req.headers.get('origin')!==new URL(req.url).origin)return false;
  const row=await env.DB.prepare('SELECT expires,owner FROM browser_sessions WHERE hash=?').bind(await sha(new TextEncoder().encode(value))).first();
  return !!row&&row.expires>Date.now()&&row.owner===env.OWNER_TOKEN_SHA256;
}
export async function handleBrowserSession(req,env,parts,h){
  const {json,bounded,sha}=h,url=new URL(req.url);
  if(parts[0]!=='session')return null;
  if(req.method!=='POST'||req.headers.get('origin')!==url.origin)return json({error:'Origin rejected'},403);
  const secure=url.protocol==='https:'?'; Secure':'';
  if(!secure&&!['localhost','127.0.0.1','10.0.2.2'].includes(url.hostname))return json({error:'HTTPS required'},403);
  if(parts[1]==='logout'){
    const value=req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    if(HEX.test(value||''))await env.DB.prepare('DELETE FROM browser_sessions WHERE hash=?').bind(await sha(new TextEncoder().encode(value))).run();
    const r=json({ok:true});r.headers.set('set-cookie',`${cookieName}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);return r;
  }
  if(parts[1]!=='exchange')return json({error:'Not found'},404);
  const b=JSON.parse(new TextDecoder().decode(await bounded(req,1000)));
  if(!HEX.test(b.code||''))return json({error:'Sign-in link expired. Reopen it from the app.'},401);
  const row=await env.DB.prepare('DELETE FROM browser_handoffs WHERE hash=? AND expires>? AND owner=? RETURNING target').bind(await sha(new TextEncoder().encode(b.code)),Date.now(),env.OWNER_TOKEN_SHA256).first();
  if(!row)return json({error:'Sign-in link expired or already used. Reopen it from the app.'},401);
  const session=secret();await env.DB.prepare('INSERT INTO browser_sessions(hash,expires,owner) VALUES(?,?,?)').bind(await sha(new TextEncoder().encode(session)),Date.now()+1800000,env.OWNER_TOKEN_SHA256).run();
  const r=json({target:row.target});r.headers.set('set-cookie',`${cookieName}=${session}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=1800${secure}`);return r;
}
export async function createHandoff(req,env,h){
  const {json,bounded,sha}=h;
  const b=JSON.parse(new TextDecoder().decode(await bounded(req,1000)));
  if(!/^[a-f0-9-]{36}$/.test(b.modId||''))return json({error:'Invalid modification'},400);
  if(env.OWNERSHIP_READ_ONLY==='true')return json({error:'Modification changes are paused'},503);
  await ensureArticle(req,env,b.modId,h);
  await env.DB.prepare('DELETE FROM browser_handoffs WHERE expires<=?').bind(Date.now()).run();
  await env.DB.prepare('DELETE FROM browser_sessions WHERE expires<=?').bind(Date.now()).run();
  const active=await env.DB.prepare('SELECT COUNT(*) n FROM browser_handoffs').first();if(active.n>=20)return json({error:'Please wait a minute before opening another editor.'},429);
  const code=secret();await env.DB.prepare('INSERT INTO browser_handoffs(hash,expires,owner,target) VALUES(?,?,?,?)').bind(await sha(new TextEncoder().encode(code)),Date.now()+60000,env.OWNER_TOKEN_SHA256,'#mod-edit/'+b.modId).run();
  return json({code,expiresIn:60});
}
