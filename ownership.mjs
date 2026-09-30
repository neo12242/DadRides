import {canonical} from './edits.mjs';
import {handleMods} from './mods.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const check=(ok,message)=>{if(!ok)throw Error(message)};
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const text=(s,n)=>typeof s==='string'&&s.length<=n;
const cents=n=>n===null||Number.isSafeInteger(n)&&n>=0&&n<=100000000;
export function blankOwnership(id,title){return {version:1,id,title,status:'Planned',estimateCents:null,installedDate:'',installedKm:null,notes:'',archived:false,expenses:[]}}
export function validateOwnership(m){
  check(m&&Object.keys(m).sort().join(',')==='archived,estimateCents,expenses,id,installedDate,installedKm,notes,status,title,version','Invalid modification fields');
  check(m.version===1&&UUID.test(m.id),'Invalid modification ID');
  check(text(m.title,100)&&m.title.trim().length>0&&text(m.notes,2000),'Check title and notes');
  check(['Planned','Purchased','Installed'].includes(m.status)&&typeof m.archived==='boolean','Invalid modification state');
  check(cents(m.estimateCents),'Invalid estimate');
  check(m.installedDate===''||date(m.installedDate),'Invalid installation date');
  check(m.installedKm===null||Number.isFinite(m.installedKm)&&m.installedKm>=0&&m.installedKm<=2000000,'Invalid installation mileage');
  check(Array.isArray(m.expenses)&&m.expenses.length<=100,'Too many expenses');
  const ids=new Set();for(const e of m.expenses){
    check(e&&Object.keys(e).sort().join(',')==='amountCents,date,id,label','Invalid expense fields');
    check(UUID.test(e.id)&&!ids.has(e.id),'Duplicate expense ID');ids.add(e.id);
    check(date(e.date)&&text(e.label,120)&&e.label.trim().length>0&&cents(e.amountCents),'Check expense date, description and amount');
  }
  return m;
}
async function current(db,id){const row=await db.prepare('SELECT id,revision,document FROM ownership_mods WHERE id=?').bind(id).first();return row?{...row,document:JSON.parse(row.document)}:null}
export async function ensureArticle(req,env,id,h){
  if(await env.DB.prepare('SELECT id FROM mods WHERE id=? AND head IS NOT NULL').bind(id).first())return;
  const record=await current(env.DB,id);check(record,'Save and sync this modification first');
  const document={version:1,id,slug:'mod-'+id,title:record.document.title,summary:'Draft — add your story before publishing.',category:'Ryker',date:new Date().toISOString().slice(0,10),story:'',installation:'',review:'',tags:[],links:[],photos:[],cover:''};
  const result=await handleMods(new Request(req.url,{method:'POST',body:JSON.stringify({base:null,document})}),env,['mods',id],true,h);
  check(result.ok,'Could not prepare the private article; retry after refreshing');
}
export async function handleOwnership(req,env,parts,h){
  if(parts[0]!=='ownership')return null;
  const {json,bounded,sha}=h,id=parts[1];
  if(req.method==='GET'&&!id){
    const {results}=await env.DB.prepare('SELECT id,revision,document FROM ownership_mods ORDER BY id LIMIT 1001').all();
    check(results.length<=1000,'Modification limit reached');
    const items=results.map(r=>({...r,document:JSON.parse(r.document)})),ids=new Set(items.map(r=>r.id));
    const articles=await env.DB.prepare('SELECT m.id,r.document FROM mods m JOIN mod_revisions r ON r.id=m.head LIMIT 1001').all();
    for(const r of articles.results)if(!ids.has(r.id))items.push({id:r.id,revision:null,document:blankOwnership(r.id,JSON.parse(r.document).title)});
    check(items.length<=1000,'Modification limit reached');return json({items});
  }
  check(UUID.test(id||''),'Invalid modification ID');
  if(req.method==='GET'&&parts.length===2){const row=await current(env.DB,id);return row?json(row):json({error:'Modification not found'},404)}
  if(env.OWNERSHIP_READ_ONLY==='true')return json({error:'Modification changes are paused'},503);
  if(req.method==='POST'&&parts[2]==='article'&&parts.length===3){await ensureArticle(req,env,id,h);return json({target:'#mod-edit/'+id})}
  if(req.method==='POST'&&parts.length===2){
    const b=JSON.parse(new TextDecoder().decode(await bounded(req,60000)));
    check(b.base===null||HASH.test(b.base),'Invalid base revision');
    const m=validateOwnership(b.document);check(m.id===id,'Modification ID mismatch');
    const document=canonical(m),revision=await sha(new TextEncoder().encode(document)),old=await current(env.DB,id);
    if(old?.revision===revision)return json(old);
    if((old?.revision||null)!==b.base)return json({error:'This modification changed elsewhere. Both versions are retained for review.',current:old},409);
    if(!old){const count=await env.DB.prepare('SELECT COUNT(*) n FROM ownership_mods').first();check(count.n<1000,'Modification limit reached')}
    await env.DB.prepare('INSERT INTO ownership_mods(id,revision,document) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,document=excluded.document WHERE ownership_mods.revision=?').bind(id,revision,document,b.base).run();
    const saved=await current(env.DB,id);return saved.revision===revision?json(saved):json({error:'Modification changed; review before retrying.',current:saved},409);
  }
  return json({error:'Not found'},404);
}
