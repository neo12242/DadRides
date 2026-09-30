import * as maplibregl from '/vendor/maplibre-gl.mjs';
import {editRide} from '/editor.js';
import {filterRoutes,connectRoutes} from '/route-map.js';
import {modsPage,modEditor,modArticle,studioTabs} from '/mods.js?v=20260926-links';
import {ownershipPage} from '/ownership.js';
import {servicesPage} from '/services.js?v=20260926-countdowns';
const app=document.querySelector('#app');let token='';let maps=[];let objectUrls=[];let editorCleanup=()=>{};
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
const authHeaders=(value=token)=>value&&value!=='cookie-session'?{Authorization:'Bearer '+value}:{};
const button=(text,fn,cls)=>{const b=el('button',text,cls);b.onclick=fn;return b};
async function api(path,options={}){const auth=token;const r=await fetch('/api/'+path,{...options,headers:{...authHeaders(auth),'content-type':'application/json',...options.headers}});const j=await r.json();if(auth!==token)throw Error('Your sign-in changed. Reload this page.');if(!r.ok){const e=Error(j.error||'Request failed');e.status=r.status;e.data=j;throw e;}return j}
function clear(){editorCleanup();editorCleanup=()=>{};for(const m of maps)m.remove();maps=[];for(const u of objectUrls)URL.revokeObjectURL(u);objectUrls=[];app.replaceChildren()}
function notice(message){app.append(el('p',message,'notice'))}
function distance(m){return (m/1609.344).toFixed(1)+' mi'}function duration(ms){const min=Math.round(ms/60000);return Math.floor(min/60)+'h '+min%60+'m'}
async function photo(rev,id,thumb=false,owner=false){const path='/api/'+(owner?'owner/':'')+'assets/'+rev+'/'+id+(thumb?'.thumb.jpg':'.jpg');if(!owner)return path;const r=await fetch(path,{headers:authHeaders()});if(!r.ok)return '/photo-unavailable.svg';const u=URL.createObjectURL(await r.blob());objectUrls.push(u);return u}
async function addMap(parent,rides){
 const div=el('div',undefined,'map');div.setAttribute('aria-label','Published ride routes');parent.append(div);
 try{
  const map=new maplibregl.Map({container:div,style:'https://tiles.openfreemap.org/styles/liberty',center:[-149.9,61.2],zoom:9});maps.push(map);
  map.addControl(new maplibregl.NavigationControl());
  map.on('error',()=>{if(!div.dataset.failed){div.dataset.failed='1';parent.append(el('p','Map background unavailable. Your ride details are still shown.','notice'))}});
  return connectRoutes(map,maplibregl.LngLatBounds,rides);
 }catch{div.textContent='Map unavailable';return ()=>{}}
}
async function mapJournal(rides){
 const section=el('section',undefined,'section'),bar=el('div',undefined,'toolbar');
 bar.append(el('h2','Where the roads took me'));
 const filters=el('div',undefined,'filters'),year=el('select'),month=el('select');
 year.setAttribute('aria-label','Map year');month.setAttribute('aria-label','Map month');
 const years=[...new Set(rides.map(r=>r.date.slice(0,4)))].sort().reverse();
 const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
 for(const [select,label,options] of [[year,'All years',years.map(y=>[y,y])],[month,'All months',months.map((m,i)=>[String(i+1).padStart(2,'0'),m])]]){
  const all=el('option',label);all.value='';select.append(all);
  for(const [value,label] of options){const option=el('option',label);option.value=value;select.append(option)}
 }
 filters.append(year,month);bar.append(filters);section.append(bar);
 const status=el('p',undefined,'map-status');status.setAttribute('role','status');section.append(status);app.append(section);
 const update=await addMap(section,rides);
 const render=()=>{
  const matches=filterRoutes(rides,year.value,month.value),mapped=matches.filter(r=>r.route.some(line=>line.length>1));
  update(matches);
  status.textContent=!matches.length?'No published rides for this year and month.':!mapped.length?'No public routes for this selection.':`${mapped.length} ${mapped.length===1?'ride':'rides'} shown on the map`;
 };
 year.onchange=month.onchange=render;render();
}
function hero(items){const wrap=el('section',undefined,'hero'),left=el('div');left.append(el('div','MILES WORTH REMEMBERING','eyebrow'));const title=el('h1');title.append(document.createTextNode('Good roads.\n'),el('em','Better memories.'));left.append(title,el('p','A personal collection of rides, roadside discoveries, and moments worth taking the long way home for.','intro'));const stats=el('div',undefined,'stats');for(const [value,label]of [[items.length,'published rides'],[distance(items.reduce((n,r)=>n+(r.manifest.stats.meters||0),0)),'recorded miles']]){const x=el('div');x.append(el('b',value),el('small',label));stats.append(x)}left.append(stats);const art=el('div',undefined,'hero-art');art.innerHTML='<svg viewBox="0 0 500 400" aria-hidden="true"><g fill="none" stroke="#94b7a2" stroke-width="1"><path d="M-30 290 Q90 20 210 190 T560 100"/><path d="M-30 315 Q90 45 210 215 T560 125"/><path d="M-30 340 Q90 70 210 240 T560 150"/><path d="M-30 365 Q90 95 210 265 T560 175"/><path d="M-30 390 Q90 120 210 290 T560 200"/></g><path d="M80 355 C180 300 50 210 200 210 S430 160 390 55" fill="none" stroke="#cbec59" stroke-width="4" stroke-dasharray="10 7"/><circle cx="390" cy="55" r="9" fill="#cbec59"/></svg><b>GO SOMEWHERE. REMEMBER IT.</b>';wrap.append(left,art);app.append(wrap)}
function ownerDownloads(){const card=el('section',undefined,'notice');card.append(el('h2','RykerConnect Phone for Android'),el('p','Start and stop rides with your phone before your ESP is ready. Download the phone edition and follow the setup instructions supplied with its release.'));const link=el('a','Download phone app & setup →');link.href='https://github.com/neo12242/RykerConnect/releases';link.target='_blank';link.rel='noopener noreferrer';card.append(link);const other=el('p');const full=el('a','Full ESP companion edition →');full.href='https://github.com/neo12242/RykerConnect/releases';full.target='_blank';full.rel='noopener noreferrer';other.append(full);card.append(other);app.append(card)}
async function list(owner=false){clear();let data=await api((owner?'owner/':'')+'rides');if(owner){const s=await api('owner/status');app.append(el('h1','Publishing Studio'),studioTabs(el,'rides'));ownerDownloads();notice(`${(s.used/1e9).toFixed(2)} GB reserved of ${(s.quota/1e9).toFixed(1)} GB upload quota. Drafts are private. Storage limits do not guarantee a zero Cloudflare bill.`)}else hero(data);
 const bar=el('div',undefined,'toolbar');bar.append(el('h2',owner?'My rides':'The ride journal'));const filters=el('div',undefined,'filters'),year=el('select'),tag=el('select');year.setAttribute('aria-label','Filter by year');tag.setAttribute('aria-label','Filter by tag');for(const [select,values,label]of [[year,[...new Set(data.map(r=>r.manifest.date.slice(0,4)))].sort().reverse(),'All years'],[tag,[...new Set(data.flatMap(r=>r.manifest.tags))].sort(),'All tags']]){const o=el('option',label);o.value='';select.append(o);for(const value of values){const option=el('option',value);option.value=value;select.append(option)}}filters.append(year,tag);bar.append(filters);app.append(bar);const grid=el('div',undefined,'grid');app.append(grid);
 const render=async()=>{grid.replaceChildren();const rows=data.filter(r=>(!year.value||r.manifest.date.startsWith(year.value))&&(!tag.value||r.manifest.tags.includes(tag.value)));if(!rows.length)grid.append(el('div',owner?'No uploads yet. Prepare a ride in the app to create your first private draft.':'The next adventure is on its way. Published rides will appear here.','empty'));for(const r of rows){const m=r.manifest,rev=r.revision||r.published;const a=el('a',undefined,'ride-card');a.href=owner?`#draft/${r.id}/${rev}`:`#ride/${r.id}`;if(m.cover){const img=el('img');img.alt=m.title;img.loading='lazy';img.src=await photo(rev,m.cover,true,owner);a.append(img)}else {const img=el('img');img.alt='Illustrated winding road through the mountains';img.loading='lazy';img.src='/assets/ride-default-v2.png';a.append(img)}const body=el('div',undefined,'card-content');body.append(el('div',m.date,'eyebrow'),el('h3',m.title));const meta=el('div',undefined,'meta');meta.append(el('span',m.stats.meters===undefined?'Distance private':distance(m.stats.meters)),el('span',m.stats.elapsedMs===undefined?'':duration(m.stats.elapsedMs)));body.append(meta);if(owner)body.append(el('p',r.published===rev?'Published':r.ready===-1?'Deletion pending':r.ready===1?(r.published?'Unpublished changes':'Private draft'):'Uploading'));for(const t of m.tags)body.append(el('span',t,'tag'));a.append(body);grid.append(a)}};year.onchange=tag.onchange=()=>render().catch(e=>notice(e.message));await render();if(!owner&&data.length)await mapJournal(data.map(r=>r.manifest))}
async function detail(id,rev){clear();const owner=!!rev;const r=await api(owner?`owner/rides/${id}/revisions/${rev}`:`rides/${id}`);const m=r.manifest;rev=rev||r.id;app.append(button('← '+(owner?'Publishing studio':'All rides'),()=>{location.hash=owner?'owner':''},'quiet'));if(owner)app.append(button('Version history',()=>{location.hash='versions/'+id},'quiet'));if(owner)notice('PRIVATE PREVIEW — This is the exact public copy. Review the route, photos and statistics before publishing.');app.append(el('p',m.date,'eyebrow'),el('h1',m.title));if(m.cover){const cover=el('img',undefined,'photo-full');cover.alt=m.title;cover.src=await photo(rev,m.cover,false,owner);app.append(cover)}else {const cover=el('img',undefined,'photo-full');cover.alt='Default illustration — winding mountain road, not a photo of this ride';cover.src='/assets/ride-default-v2.png';app.append(cover)}const stats=el('div',undefined,'stats');for(const [key,label,format]of [['meters','whole-ride distance',distance],['elapsedMs','elapsed',duration],['movingMs','moving',duration],['pausedMs','paused breaks',duration],['unknownMs','GPS unknown',duration]])if(m.stats[key]!==undefined){const s=el('div');s.append(el('b',format(m.stats[key])),el('small',label));stats.append(s)}app.append(stats);if(m.privacy.trimMeters>0)notice(`Route endpoints hidden within ${m.privacy.trimMeters} m of the original start and finish. Displayed totals, if included, describe the whole ride.`);if(m.route.length)await addMap(app,[m]);else notice('No public route included.');if(m.stops?.length){const breaks=el('section',undefined,'section');breaks.append(el('h2','Breaks along the way'));m.stops.forEach((stop,i)=>breaks.append(el('p',String(i+1)+'. Paused for '+duration(stop.durationMs))));breaks.append(el('p','Amber markers show the reviewed break locations. GPS recording was paused.','muted'));app.append(breaks)}app.append(el('p',m.story,'story'));const gallery=el('div',undefined,'gallery section');app.append(gallery);for(const p of m.photos){const figure=el('figure'),img=el('img');img.alt=p.caption||'Ride photo';img.loading='lazy';img.src=await photo(rev,p.id,false,owner);figure.append(img,el('figcaption',p.caption));gallery.append(figure)}if(owner&&!document.querySelector('meta[name="dadrides-preview"]')){const actions=el('div',undefined,'actions');const run=async(fn)=>{try{await fn();location.hash='owner'}catch(e){notice(e.message)}};const publish=button(r.published===rev?'Published':'Publish this version',()=>{if(confirm('Publish this reviewed ride and its photos for everyone?'))run(()=>api(`owner/rides/${id}/publish`,{method:'POST',body:JSON.stringify({base:r.published||null,revision:rev})}))});publish.disabled=r.ready!==1||r.published===rev;actions.append(publish);if(r.ready===1){actions.append(button('Edit ride details',()=>{location.hash='edit/'+id},'quiet'));actions.append(button('Make this the current draft',async()=>{try{let current=null;try{current=await api(`owner/rides/${id}/edit`)}catch(e){if(e.status!==404)throw e}if(current?.revision===rev){location.hash='edit/'+id;return}if(confirm('Use this reviewed version as the current editable draft? Previous versions are retained.')){await api(`owner/rides/${id}/adopt`,{method:'POST',body:JSON.stringify({base:current?.revision||null,revision:rev})});location.hash='edit/'+id}}catch(e){notice(e.message)}},'quiet'))}if(r.published===rev)actions.append(button('Unpublish',()=>{if(confirm('Remove this ride from public view? Previously downloaded copies cannot be recalled.'))run(()=>api(`owner/rides/${id}/unpublish`,{method:'POST',body:JSON.stringify({base:rev})}))},'quiet'));else actions.append(button('Delete remote version',()=>{if(confirm('Delete this remote draft and its images? Your local ride stays on your phone.'))run(()=>api(`owner/rides/${id}/revisions/${rev}`,{method:'DELETE'}))},'danger'));app.append(actions)}}
async function versions(id){
 clear();const rows=await api('owner/rides/'+id+'/revisions');
 app.append(button('← Publishing studio',()=>{location.hash='owner'},'quiet'),el('h1','Version history'));
 notice('These are saved versions of one ride. The current draft is the version synchronized with your apps.');
 if(!rows.length)notice('No saved versions remain.');
 const list=el('div',undefined,'version-list');
 for(const r of rows){const item=el('article',undefined,'notice'),link=el('a',r.title);link.href='#draft/'+id+'/'+r.revision;
 item.append(link,el('p',[r.current===r.revision?'Current draft':'Previous version',r.published===r.revision?'Published':r.ready===1?'Private':r.ready<0?'Deletion pending':'Uploading',new Date(r.created).toLocaleString()].join(' · ')));list.append(item)}
 app.append(list);
}
let routeGeneration=0;
function navigation(){
 document.querySelectorAll('[data-owner-nav]').forEach(a=>{a.hidden=!token});
 const kind=location.hash.slice(1).split('/')[0];
 for(const a of document.querySelectorAll('header nav a')){
   const selected=a.hash==='#mods'?['mods','mod'].includes(kind):a.hash==='#services'?kind==='services':a.hash==='#owner'?['owner','draft','edit','versions','my-mods','mod-edit','mod-preview'].includes(kind):!kind||kind==='ride';
   if(selected)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
 }
}
async function route(){
 const generation=++routeGeneration;navigation();
 try{
  const [kind,id,rev]=location.hash.slice(1).split('/');
  const privatePage=['owner','draft','edit','versions','my-mods','mod-edit','mod-preview','services','ownership'].includes(kind);
  if(privatePage&&!token){clear();notice('Sign in to open this private page.');document.querySelector('#login').showModal();return}
  const ctx={app,el,button,api,notice,reload:route,active:()=>generation===routeGeneration,modPhoto:async(id,owner)=>{
    if(!owner)return '/api/mod-media/'+id;
    const auth=token,r=await fetch('/api/owner/mod-media/'+id,{headers:authHeaders(auth)});
    if(!r.ok||auth!==token||generation!==routeGeneration)throw Error('Image unavailable');
    const u=URL.createObjectURL(await r.blob());objectUrls.push(u);return u;
  }};
  if(['mods','my-mods','mod','mod-edit','mod-preview','services','ownership'].includes(kind)){
    clear();
    if(kind==='ownership'){const cleanup=await ownershipPage(ctx,id);if(ctx.active())editorCleanup=cleanup||(()=>{});else cleanup?.()}
    else if(kind==='services')await servicesPage(ctx);
    else if(kind==='mods'||kind==='my-mods')await modsPage(ctx,kind==='my-mods');
    else if(kind==='mod-edit'){const cleanup=await modEditor(ctx,id);if(ctx.active())editorCleanup=cleanup;else cleanup?.()}
    else{const owner=kind==='mod-preview',row=await api((owner?'owner/':'')+'mods/'+id);if(!ctx.active())return;
      if(owner){notice('PRIVATE PREVIEW — Review this saved version before publishing.');app.append(button('Back to mod editor',()=>{location.hash='mod-edit/'+id},'quiet'))}
      else{const back=el('a','← All Mods','text-link');back.href='#mods';app.append(back)}
      await modArticle(ctx,row,owner);
    }
  }else if(kind==='versions')await versions(id);
  else if(kind==='edit'){clear();editorCleanup=await editRide({id,api,app,el,button,maps,photo,reloadEditor:route})}
  else if(kind==='ride')await detail(id);
  else if(kind==='draft')await detail(id,rev);
  else await list(kind==='owner');
 }catch(e){if(generation!==routeGeneration)return;clear();app.append(el('h2','Could not load this page'));notice(e.message);app.append(button('Try again',route),button('Back to rides',()=>{location.hash=''},'quiet'))}
}
document.querySelector('#owner').onclick=async()=>{
 if(token){try{const r=await fetch('/api/session/logout',{method:'POST'});if(!r.ok)throw Error();}catch{notice('Could not sign out. Reconnect and try again.');return}clear();token='';routeGeneration++;document.querySelector('#owner').textContent='Sign in';navigation();if(location.hash)location.hash='';else route()}
 else document.querySelector('#login').showModal();
};
document.querySelector('#login').addEventListener('close',async e=>{
 if(e.target.returnValue==='login'){
  token=document.querySelector('#key').value;document.querySelector('#key').value='';
  try{await api('owner/status');document.querySelector('#owner').textContent='Sign out';navigation();
    const kind=location.hash.slice(1).split('/')[0];
    if(!['owner','draft','edit','versions','my-mods','mod-edit','mod-preview','services','ownership'].includes(kind))location.hash='owner';else await route();
  }catch{token='';navigation();notice('Publishing key rejected. Verify the configured site and owner key.')}
 }
});
window.addEventListener('hashchange',route);
try{const r=await fetch('/api/owner/status');if(r.ok){token='cookie-session';document.querySelector('#owner').textContent='Sign out'}}catch{}
route();
