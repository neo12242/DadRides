const destinations=[['dadrides','DadRides'],['alaskageek','The Alaska Geek']];
const slugify=s=>s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70).replace(/-$/,'');
export function studioTabs(el,selected='rides'){
  const nav=el('nav',undefined,'studio-tabs');nav.setAttribute('aria-label','Publishing sections');
  for(const [value,label,hash] of [['rides','My Rides','#owner'],['mods','My Mods','#my-mods'],['ownership','Ownership','#ownership']]){const a=el('a',label);a.href=hash;if(value===selected)a.setAttribute('aria-current','page');nav.append(a)}return nav;
}
function link(el,label,href){const a=el('a',label,'text-link');a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a}
export function isYouTubeLink(value){
  try{const host=new URL(value).hostname.toLowerCase();return host==='youtu.be'||host==='youtube.com'||host.endsWith('.youtube.com')}catch{return false}
}
export function readModLinks(rows){
  const links=[];
  for(const row of rows){
    const label=row.label.trim(),url=row.url.trim();if(!label&&!url)continue;
    if(!label||!url)throw Error('Give each link a label and a URL, or remove the empty row.');
    let parsed;try{parsed=new URL(url)}catch{throw Error('Enter a valid HTTPS link.')}
    if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('Links must use HTTPS without credentials.');
    if(row.youtube&&!isYouTubeLink(url))throw Error('Use a youtube.com or youtu.be URL for YouTube videos.');
    if(label.length>100||url.length>2000)throw Error('Link labels can have 100 characters and URLs 2,000 characters.');
    links.push({label,url});
  }
  if(links.length>20)throw Error('A mod can have up to 20 links.');return links;
}
async function image(ctx,id,alt,owner){const img=ctx.el('img');img.alt=alt;img.loading='lazy';img.src=await ctx.modPhoto(id,owner);return img}
export async function modArticle(ctx,row,owner=false){
  const {app,el,active}=ctx,m=row.document;
  app.append(el('p',m.category+' · '+m.date,'eyebrow'),el('h1',m.title),el('p',m.summary,'intro'));
  if(m.cover){const img=await image(ctx,m.cover,m.photos.find(p=>p.id===m.cover)?.caption||m.title,owner);if(!active())return;img.className='photo-full';app.append(img)}
  for(const tag of m.tags)app.append(el('span',tag,'tag'));
  for(const [key,title] of [['story','The mod'],['installation','Installation notes'],['review','Review & verdict']])if(m[key]){const section=el('section',undefined,'section mod-prose');section.append(el('h2',title),el('p',m[key],'story'));app.append(section)}
  for(const [youtube,title] of [[false,'Product & useful links'],[true,'YouTube videos']]){const links=m.links.filter(l=>isYouTubeLink(l.url)===youtube);if(!links.length)continue;const section=el('section',undefined,'section');section.append(el('h2',title));const list=el('ul');for(const l of links){const li=el('li');li.append(link(el,l.label,l.url));list.append(li)}section.append(list);app.append(section)}
  const gallery=el('div',undefined,'gallery section');app.append(gallery);
  for(const p of m.photos){const img=await image(ctx,p.id,p.caption||m.title,owner);if(!active())return;const fig=el('figure');fig.append(img,el('figcaption',p.caption));gallery.append(fig)}
}
export async function modsPage(ctx,owner=false){
  const {app,el,api,button,active}=ctx,data=await api((owner?'owner/':'')+'mods');if(!active())return;
  app.append(el('p',owner?'YOUR PUBLISHING DESK':'MADE FOR THE RIDE','eyebrow'),el('h1',owner?'Publishing Studio':'Mods'),el('p',owner?'Write, review and choose where each mod is published.':'What I changed, how it went, and what I would do differently.','intro'));
  if(owner){app.append(studioTabs(el,'mods'),button('Create a mod',()=>{location.hash='mod-edit/new'}));if(!data.publisherConfigured)app.append(el('p','Publishing to The Alaska Geek is awaiting server setup. You can prepare drafts and publish to DadRides.','notice'))}
  const filter=el('input');filter.type='search';filter.placeholder='Search mods';filter.setAttribute('aria-label','Search mods');app.append(filter);const grid=el('div',undefined,'grid');app.append(grid);
  let generation=0;
  const render=async()=>{const mine=++generation;grid.replaceChildren();const rows=data.items.filter(r=>[r.document.title,r.document.category,...r.document.tags].join(' ').toLowerCase().includes(filter.value.toLowerCase()));if(!rows.length)grid.append(el('p',owner?'No matching mods. Create a draft to get started.':'No published mods for this selection.','empty'));
    for(const r of rows){const m=r.document,card=el('a',undefined,'ride-card');card.href=owner?'#mod-edit/'+r.id:'#mod/'+r.slug;
      if(m.cover){const img=await image(ctx,m.cover,m.title,owner);if(!active()||mine!==generation)return;card.append(img)}else card.append(el('div','MOD','cover-placeholder'));
      const body=el('div',undefined,'card-content');body.append(el('p',m.category,'eyebrow'),el('h2',m.title),el('p',m.summary));
      if(owner)for(const [id,label] of destinations){const d=r.destinations.find(d=>d.destination===id);body.append(el('p',label+': '+(d?.state||'Private draft')+(d?.published&&d.published!==r.revision?' · draft changes':''),'meta'))}
      card.append(body);grid.append(card);
    }
  };filter.oninput=()=>render().catch(e=>ctx.notice(e.message));await render();
}
async function jpeg(file){
  if(file.size>25000000||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose a JPEG, PNG or WebP image smaller than 25 MB');
  const bitmap=await createImageBitmap(file);try{
    if(bitmap.width*bitmap.height>50000000)throw Error('Choose an image under 50 megapixels');
    const scale=Math.min(1,2000/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.84));if(!blob||blob.size>3000000)throw Error('Image is too large after resizing; choose a smaller image');return new Uint8Array(await blob.arrayBuffer());
  }finally{bitmap.close()}
}
export async function modEditor(ctx,id){
  const {app,el,api,button,active}=ctx;
  let row=id==='new'?null:await api('owner/mods/'+id);if(!active())return ()=>{};
  const m=structuredClone(row?.document||{version:1,id:crypto.randomUUID(),slug:'',title:'',summary:'',category:'Ryker mod',date:new Date().toLocaleDateString('en-CA'),tags:[],story:'',installation:'',review:'',links:[],photos:[],cover:''});
  let fixedUrl=location.href;let dirty=false,busy=false;
  const settings=await api('owner/status');if(!active())return ()=>{};
  app.append(el('p','MY MODS','eyebrow'),el('h1',row?'Edit mod':'Create a mod'));
  const back=el('a','← My Mods','text-link');back.href='#my-mods';app.append(back);
  const form=el('form',undefined,'ride-editor');app.append(form);const message=el('p',undefined,'notice');message.setAttribute('role','status');message.hidden=true;app.append(message);
  const say=s=>{message.hidden=false;message.textContent=s};
  const controls={};
  function field(key,label,multiline=false){const wrap=el('label',label,'editor-field'),input=el(multiline?'textarea':'input');input.value=m[key];if(multiline)input.rows=key==='summary'?3:8;input.maxLength=key==='title'?100:key==='summary'?500:key==='category'?80:key==='slug'?80:20000;input.required=['title','summary','category','date'].includes(key);if(key==='date')input.type='date';if(key==='slug'){input.pattern='[a-z0-9]+(-[a-z0-9]+)*';input.readOnly=!!row}wrap.append(input);form.append(wrap);controls[key]=input;return input}
  const title=field('title','Title');const slug=field('slug','Public link name (fixed after the first save)');title.addEventListener('input',()=>{if(!row)slug.value=slugify(title.value)});
  field('summary','Short summary',true);field('category','Category');field('date','Date');
  const tags=field('tags','Tags, separated by commas');tags.value=m.tags.join(', ');
  field('story','The mod',true);field('installation','Installation notes',true);field('review','Review & verdict',true);
  const linkRows=[];
  for(const [youtube,title] of [[false,'Product links'],[true,'YouTube videos']]){
    const section=el('section',undefined,'editor-section');section.append(el('h2',title),el('p',youtube?'Add your video or an installation video. Videos open on YouTube.':'Add product listings, manufacturer websites or other useful references.'));
    const list=el('div');section.append(list);form.append(section);
    const addRow=(value={label:'',url:''})=>{
      if(linkRows.length>=20){say('A mod can have up to 20 links.');return}
      const item=el('div',undefined,'editor-section'),label=el('input'),url=el('input');label.value=value.label;label.maxLength=100;url.value=value.url;url.type='url';url.maxLength=2000;url.placeholder=youtube?'https://www.youtube.com/watch?v=…':'https://…';
      const labelWrap=el('label','Link label','editor-field'),urlWrap=el('label',youtube?'YouTube URL':'Product or website URL','editor-field');labelWrap.append(label);urlWrap.append(url);
      const row={label,url,youtube};linkRows.push(row);
      const remove=button('Remove link',()=>{linkRows.splice(linkRows.indexOf(row),1);item.remove();dirty=true},'quiet');remove.type='button';item.append(labelWrap,urlWrap,remove);list.append(item);return label;
    };
    for(const value of m.links.filter(l=>isYouTubeLink(l.url)===youtube))addRow(value);
    const add=button(youtube?'Add YouTube video':'Add product link',()=>{const input=addRow();if(input){dirty=true;input.focus()}},'quiet');add.type='button';section.append(add);
  }
  const images=el('section',undefined,'editor-section');images.append(el('h2','Photos'),el('p','Images are resized and stripped of embedded location metadata before upload. Up to 20 images.'));
  const upload=el('input');upload.type='file';upload.accept='image/jpeg,image/png,image/webp';upload.multiple=true;upload.setAttribute('aria-label','Add mod photos');images.append(upload);const photoRows=el('div');images.append(photoRows);form.append(images);
  const coverLabel=el('label','Cover image','editor-field'),cover=el('select');coverLabel.append(cover);images.append(coverLabel);
  const drawPhotos=async()=>{photoRows.replaceChildren();cover.replaceChildren();const none=el('option','No cover');none.value='';cover.append(none);
    for(const p of m.photos){const option=el('option',p.caption||'Photo '+(m.photos.indexOf(p)+1));option.value=p.id;cover.append(option);const item=el('div',undefined,'caption-row');const img=await image(ctx,p.id,p.caption||'Mod photo',true);if(!active())return;img.className='editor-thumbnail';const label=el('label','Photo caption','editor-field'),caption=el('input');caption.maxLength=500;caption.value=p.caption;caption.oninput=()=>{p.caption=caption.value;dirty=true};label.append(caption);const remove=button('Remove from draft',()=>{m.photos=m.photos.filter(x=>x.id!==p.id);if(m.cover===p.id)m.cover='';dirty=true;drawPhotos().catch(e=>say(e.message))},'quiet');remove.type='button';item.append(img,label,remove);photoRows.append(item)}cover.value=m.cover;
  };
  cover.onchange=()=>{m.cover=cover.value;dirty=true};
  upload.onchange=async()=>{busy=true;save.disabled=true;upload.disabled=true;try{for(const file of upload.files){if(m.photos.length>=20)throw Error('A mod can have up to 20 images');say('Preparing '+file.name+'…');const bytes=await jpeg(file);const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');const reserved=await api('owner/mod-media/'+hash,{method:'POST',body:JSON.stringify({bytes:bytes.length})});if(!reserved.ready)await api('owner/mod-media/'+hash,{method:'PUT',body:bytes,headers:{'content-type':'image/jpeg'}});if(!active())return;if(!m.photos.some(p=>p.id===hash))m.photos.push({id:hash,caption:''});if(!m.cover)m.cover=hash;dirty=true}await drawPhotos();say('Photos ready. Save your draft to keep this selection.')}catch(e){say(e.message)}finally{busy=false;save.disabled=false;upload.disabled=false;upload.value=''}};
  const save=el('button','Save draft');save.type='submit';const saveBar=el('div',undefined,'editor-save');saveBar.append(save);form.append(saveBar);
  const publication=el('section',undefined,'section');app.append(publication);
  const publishControls=()=>{publication.replaceChildren();publication.append(el('h2','Preview & publishing'),el('p','Save your draft, preview it, then choose each destination. Each site keeps its last published version until you update it.'));
    if(!row)return;
    const preview=button('Preview saved draft',()=>{if(dirty){say('Save your changes before previewing.');return}location.hash='mod-preview/'+m.id},'quiet');publication.append(preview);
    for(const [dest,label] of destinations){const d=row.destinations.find(x=>x.destination===dest),card=el('article',undefined,'notice');card.append(el('h3',label),el('p','Status: '+(d?.state||'Private draft')+(d?.published&&d.published!==row.revision?' · unpublished changes':'')));if(d?.error)card.append(el('p','Publication needs attention: '+d.error));
      const send=async revision=>{if(dirty){say('Save your changes before publishing.');return}if(!confirm((revision?'Publish this saved version to ':'Unpublish this mod from ')+label+'?'))return;busy=true;try{row=await api('owner/mods/'+m.id+'/publish',{method:'POST',body:JSON.stringify({destination:dest,revision,base:d?.job||null})});publishControls();say(dest==='dadrides'?'DadRides publication updated.':'The Alaska Geek publication queued. Refresh status to check progress.')}catch(e){say(e.message)}finally{busy=false}};
      const publish=button(d?.published?'Update published version':'Publish',()=>send(row.revision));publish.disabled=dest==='alaskageek'&&!settings.publisherConfigured||d?.state==='publishing'||d?.state==='queued'||d?.published===row.revision&&d?.state==='published';card.append(publish);
      if(d?.published){const unpublish=button('Unpublish',()=>send(null),'quiet');unpublish.disabled=d.state==='publishing'||d.state==='queued';card.append(unpublish);card.append(link(el,'Open published page',dest==='dadrides'?location.origin+'/#mod/'+m.slug:'https://thealaskageek.com/articles/dadrides-'+m.slug+'/'))}
      if(dest==='alaskageek'&&!settings.publisherConfigured)card.append(el('p','Publishing destination is not configured. Your draft can still be saved.'));publication.append(card);
    }
    publication.append(button('Refresh publication status',async()=>{try{row=await api('owner/mods/'+m.id);publishControls()}catch(e){say(e.message)}},'quiet'));
  };
  form.oninput=()=>{dirty=true};
  form.onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;save.disabled=true;try{
    for(const key of ['title','slug','summary','category','date','story','installation','review'])m[key]=controls[key].value.trim();m.tags=tags.value.split(',').map(t=>t.trim()).filter(Boolean);
    m.links=readModLinks(linkRows.map(r=>({label:r.label.value,url:r.url.value,youtube:r.youtube})));m.cover=cover.value;
    row=await api('owner/mods/'+m.id,{method:'POST',body:JSON.stringify({base:row?.revision||null,document:m})});if(!active())return;dirty=false;slug.readOnly=true;history.replaceState(null,'','#mod-edit/'+m.id);fixedUrl=location.href;say('Draft saved. Preview before publishing.');publishControls();
  }catch(e){say(e.message)}finally{busy=false;save.disabled=false}};
  const beforeUnload=e=>{if(dirty||busy){e.preventDefault();e.returnValue=''}};
  const guard=e=>{if((dirty||busy)&&!confirm(busy?'An upload is in progress. Leave this page?':'Leave without saving your draft changes?')){e.stopImmediatePropagation();history.replaceState(null,'',fixedUrl)}};
  window.addEventListener('beforeunload',beforeUnload);window.addEventListener('hashchange',guard,true);
  await drawPhotos();publishControls();
  return ()=>{window.removeEventListener('beforeunload',beforeUnload);window.removeEventListener('hashchange',guard,true)};
}
