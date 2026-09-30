import * as maplibregl from '/vendor/maplibre-gl.mjs';

const copy = value => structuredClone(value);
export const formatTime = ms => {
  const seconds = Math.floor(ms / 1000), fraction = ms % 1000;
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}${fraction ? '.' + String(fraction).padStart(3,'0') : ''}`;
};
export const parseTime = text => {
  const match = /^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (!match) throw Error('Enter times as hours:minutes:seconds, for example 1:25:00');
  return (Number(match[1])*3600+Number(match[2])*60+Number(match[3]))*1000+Number((match[4]||'').padEnd(3,'0'));
};
export function removeSection(route, segment, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= route[segment].length) throw Error('Select a valid section within this segment');
  const next = copy(route), line = next[segment];
  next.splice(segment,1,...[line.slice(0,from),line.slice(to+1)].filter(x => x.length));
  return next;
}

export async function editRide({id,api,app,el,button,maps,photo,reloadEditor}) {
  let head = await api(`owner/rides/${id}/edit`), manifest = copy(head.manifest), route = copy(manifest.route);
  let dirty = false, busy = false, selected = null, marker = null, map = null;
  const undo = [], controls = {}, routeControls = [];
  app.append(el('p','OWNER EDITOR','eyebrow'),el('h1','Edit your ride'));
  const status = el('p','Changes stay private until you update the published ride.','notice');status.setAttribute('role','status');app.append(status);
  const form=el('form',undefined,'ride-editor');form.onsubmit=e=>e.preventDefault();app.append(form);
  const section=title=>{const box=el('section',undefined,'editor-section');box.append(el('h2',title));form.append(box);return box};
  const field=(parent,label,value,{type='text',maxLength,multiline=false}={})=>{
    const wrap=el('label',label,'editor-field'),input=el(multiline?'textarea':'input');input.value=value??'';
    if(!multiline)input.type=type;if(maxLength)input.maxLength=maxLength;if(multiline)input.rows=5;
    input.oninput=()=>{dirty=true};wrap.append(input);parent.append(wrap);return input;
  };
  const details=section('Ride details');
  controls.title=field(details,'Title',manifest.title,{maxLength:100});controls.title.required=true;
  controls.date=field(details,'Ride date',manifest.date,{type:'date'});controls.date.required=true;
  controls.story=field(details,'Story',manifest.story,{maxLength:2000,multiline:true});
  controls.tags=field(details,'Tags, separated by commas',manifest.tags.join(', '),{maxLength:464});

  const photos=section('Photos and captions');
  photos.append(el('p','Choose a cover and edit captions. These changes reuse the photos already uploaded.'));
  const coverLabel=el('label','Cover photo','editor-field'),cover=el('select');cover.setAttribute('aria-label','Cover photo');coverLabel.append(cover);photos.append(coverLabel);
  const noCover=el('option','Default cover illustration');noCover.value='';cover.append(noCover);
  const captionInputs=new Map(),figures=new Map();
  manifest.photos.forEach((p,i)=>{
    const option=el('option',`Photo ${i+1}${p.caption?' · '+p.caption.slice(0,60):''}`);option.value=p.id;cover.append(option);
    const figure=el('div',undefined,'caption-row');photos.append(figure);figures.set(p.id,figure);
    captionInputs.set(p.id,field(figure,`Photo ${i+1} caption`,p.caption,{maxLength:500}));
  });
  cover.value=manifest.cover;cover.onchange=()=>{dirty=true};
  if(manifest.photos.length){const previews=button('Show photo previews',async()=>{
    previews.disabled=true;
    try { for(const p of manifest.photos){const img=el('img',undefined,'editor-thumbnail');img.alt=p.caption||'Ride photo';img.src=await photo(head.revision,p.id,true,true);figures.get(p.id).prepend(img)} }
    catch(e){status.textContent=e.message;previews.disabled=false}
  },'quiet');previews.type='button';photos.prepend(previews)}

  const statistics=section('Ride statistics');
  statistics.append(el('p','Your original GPS recording and measured statistics remain available in the apps.'));
  const includeStats=manifest.privacy.statsIncluded && Object.keys(manifest.stats).length>0;
  let initialDistance='';
  if(includeStats){
    const s=manifest.stats;initialDistance=(s.meters/1609.344).toFixed(3);
    controls.distance=field(statistics,'Distance (miles)',initialDistance,{type:'number'});controls.distance.min='0';controls.distance.step='any';controls.distance.required=true;
    const times=el('div',undefined,'editor-columns');statistics.append(times);
    controls.elapsedMs=field(times,'Elapsed time (h:mm:ss)',formatTime(s.elapsedMs||0));
    controls.movingMs=field(times,'Moving time (h:mm:ss)',formatTime(s.movingMs||0));
    controls.stoppedMs=field(times,'Stopped time (h:mm:ss)',formatTime(s.stoppedMs||0));
    controls.pausedMs=field(times,'Paused breaks (h:mm:ss)',formatTime(s.pausedMs||0));
    controls.unknownMs=field(times,'GPS unknown time (h:mm:ss)',formatTime(s.unknownMs??Math.max(0,(s.elapsedMs||0)-(s.movingMs||0)-(s.stoppedMs||0))));
    const average=el('p');statistics.append(average);
    const updateAverage=()=>{try{const moving=parseTime(controls.movingMs.value);average.textContent=moving?`Calculated moving average: ${(Number(controls.distance.value)/(moving/3600000)).toFixed(1)} mph`:'Moving average unavailable with zero moving time'}catch{average.textContent='Enter valid times to calculate average speed'}};
    for(const input of [controls.distance,controls.movingMs])input.addEventListener('input',updateAverage);updateAverage();
    statistics.append(el('p','Moving, stopped, paused and GPS unknown time must add up to elapsed time.','muted'));
  }else statistics.append(el('p','Statistics were excluded from this upload. Enable them in the app when preparing a new upload.'));

  const geometry=section('Route');
  const keepBreaks=el('input');keepBreaks.type='checkbox';keepBreaks.checked=true;
  if(manifest.stops?.length){const label=el('label');label.append(keepBreaks,document.createTextNode(` Include ${manifest.stops.length} recorded break markers. Removing or moving a route point removes its break marker.`));geometry.append(label)}
  geometry.append(el('p','Select a point on the map, or use the segment and point controls below. Drag the selected marker or change its coordinates.'));
  if(manifest.privacy.trimMeters>0)geometry.append(el('p',`The original upload hid points within ${manifest.privacy.trimMeters} m of its start and finish. Point corrections are checked against those hidden areas by your phone before publication. Hidden original points are never downloaded to this editor.`,'notice'));
  const mapContainer=el('div',undefined,'map editor-map');mapContainer.setAttribute('aria-label','Editable ride route');geometry.append(mapContainer);
  const selection=el('div',undefined,'editor-columns');geometry.append(selection);
  const segment=field(selection,'Segment number',1,{type:'number'}),point=field(selection,'Point number',1,{type:'number'});segment.min=point.min='1';segment.step=point.step='1';
  const coords=el('div',undefined,'editor-columns');geometry.append(coords);
  const latitude=field(coords,'Selected latitude','',{type:'number'}),longitude=field(coords,'Selected longitude','',{type:'number'});latitude.step=longitude.step='any';latitude.min='-90';latitude.max='90';longitude.min='-180';longitude.max='180';
  for(const input of [segment,point,latitude,longitude])input.oninput=null;
  const routeStatus=el('p');routeStatus.setAttribute('role','status');geometry.append(routeStatus);
  const actions=el('div',undefined,'actions');geometry.append(actions);
  function features(){return {type:'FeatureCollection',features:route.flatMap((line,s)=>[
    ...(line.length>1?[{type:'Feature',properties:{kind:'line'},geometry:{type:'LineString',coordinates:line}}]:[]),
    ...line.map((p,i)=>({type:'Feature',properties:{kind:'point',s,i},geometry:{type:'Point',coordinates:p}}))
  ])}}
  function renderRoute(){
    map?.getSource('editor-route')?.setData(features());
    routeStatus.textContent=`${route.length} segments · ${route.reduce((n,l)=>n+l.length,0)} points`;
    segment.disabled=point.disabled=!route.length;
    segment.max=String(route.length);segment.value=Math.max(1,Math.min(Number(segment.value),route.length));
    point.max=String(route[Number(segment.value)-1]?.length||0);point.value=Math.max(1,Math.min(Number(point.value),Number(point.max)));
    undoButton.disabled=!undo.length;
    if(selected && route[selected.s]?.[selected.i])select(selected.s,selected.i);else {selected=null;marker?.remove();marker=null;latitude.value=longitude.value=''}
  }
  function select(s,i){
    if(busy)return;const p=route[s]?.[i];if(!p)throw Error('Choose an existing segment and point');selected={s,i};segment.value=s+1;point.value=i+1;latitude.value=p[1];longitude.value=p[0];
    marker?.remove();marker=null;
    if(map){marker=new maplibregl.Marker({draggable:true,color:'#9e4925'}).setLngLat(p).addTo(map);marker.on('dragend',()=>{const ll=marker.getLngLat();change(next=>{next[s][i]=[((ll.lng+180)%360+360)%360-180,Math.max(-90,Math.min(90,ll.lat))];return next})})}
    routeStatus.textContent=`Segment ${s+1}, point ${i+1} selected · ${route.reduce((n,l)=>n+l.length,0)} total points`;
  }
  function change(update){if(busy)return;undo.push(copy(route));if(undo.length>30)undo.shift();try{route=update(copy(route));dirty=true;renderRoute()}catch(e){undo.pop();status.textContent=e.message}}
  function routeButton(label,fn){const b=button(label,()=>{try{fn()}catch(e){status.textContent=e.message}},'quiet');b.type='button';actions.append(b);routeControls.push(b);return b}
  routeButton('Select point',()=>select(Number(segment.value)-1,Number(point.value)-1));
  routeButton('Apply coordinates',()=>{
    if(!selected)throw Error('Select a point first');const lat=Number(latitude.value),lon=Number(longitude.value);
    if(!latitude.value||!longitude.value||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('Enter valid latitude and longitude');
    change(next=>{next[selected.s][selected.i]=[lon,lat];return next});
  });
  routeButton('Trim before point',()=>{if(!selected)throw Error('Select a point first');const{s,i}=selected;change(next=>[next[s].slice(i),...next.slice(s+1)]);selected=null;renderRoute()});
  routeButton('Trim after point',()=>{if(!selected)throw Error('Select a point first');const{s,i}=selected;change(next=>[...next.slice(0,s),next[s].slice(0,i+1)]);selected=null;renderRoute()});
  routeButton('Remove point',()=>{if(!selected)throw Error('Select a point first');const{s,i}=selected;change(next=>removeSection(next,s,i,i));selected=null;renderRoute()});
  const undoButton=routeButton('Undo route change',()=>{if(undo.length){route=undo.pop();selected=null;dirty=true;renderRoute()}});
  const removeRange=el('div',undefined,'editor-columns');geometry.append(removeRange);
  const from=field(removeRange,'Remove from point',1,{type:'number'}),to=field(removeRange,'Through point',1,{type:'number'});from.min=to.min='1';from.step=to.step='1';
  from.oninput=to.oninput=null;
  const remove=button('Remove section from selected segment',()=>{
    if(!selected){status.textContent='Select a segment and point first';return}
    const s=selected.s;change(next=>removeSection(next,s,Number(from.value)-1,Number(to.value)-1));selected=null;renderRoute();
  },'quiet');remove.type='button';geometry.append(remove);renderRoute();
  try{
    map=new maplibregl.Map({container:mapContainer,style:'https://tiles.openfreemap.org/styles/liberty',center:route.flat()[0]||[-149.9,61.2],zoom:10});maps.push(map);map.addControl(new maplibregl.NavigationControl());
    map.on('load',()=>{
      map.addSource('editor-route',{type:'geojson',data:features()});
      map.addLayer({id:'editor-line',type:'line',source:'editor-route',filter:['==','kind','line'],paint:{'line-color':'#be582d','line-width':4}});
      map.addLayer({id:'editor-points',type:'circle',source:'editor-route',filter:['==','kind','point'],paint:{'circle-radius':4,'circle-color':'#244b48','circle-stroke-color':'#fff','circle-stroke-width':1}});
      map.on('click','editor-points',e=>{const p=e.features?.[0]?.properties;if(p)select(Number(p.s),Number(p.i))});
      const points=route.flat();if(points.length){const bounds=new maplibregl.LngLatBounds(points[0],points[0]);points.forEach(p=>bounds.extend(p));map.fitBounds(bounds,{padding:45,maxZoom:16})}
    });
    map.on('error',()=>{routeStatus.textContent='Map background unavailable. Segment, point and coordinate controls still work.'});
  }catch{mapContainer.textContent='Map unavailable. Use the route controls below.'}

  function collect(){
    if(!form.reportValidity())throw Error('Check the highlighted fields');
    const m=copy(manifest);m.title=controls.title.value.trim();m.date=controls.date.value;m.story=controls.story.value;m.tags=[...new Set(controls.tags.value.split(',').map(t=>t.trim()).filter(Boolean))];
    if(m.tags.length>15||m.tags.some(t=>t.length>30))throw Error('Use up to 15 tags, each 30 characters or fewer');
    m.cover=cover.value;m.photos.forEach(p=>p.caption=captionInputs.get(p.id).value);m.route=copy(route);
    if(includeStats){
      const s={meters:controls.distance.value===initialDistance?manifest.stats.meters:Number(controls.distance.value)*1609.344};
      for(const key of ['elapsedMs','movingMs','stoppedMs','unknownMs','pausedMs'])s[key]=parseTime(controls[key].value);
      if(!Number.isFinite(s.meters)||s.meters<0)throw Error('Enter a valid distance');
      if(s.elapsedMs!==s.movingMs+s.stoppedMs+s.unknownMs+s.pausedMs)throw Error('Moving, stopped, paused and unknown time must add up to elapsed time');
      s.averageMps=s.movingMs?s.meters/(s.movingMs/1000):null;m.stats=s;
    }
    if(m.stops){const visible=new Set(m.route.flat().map(p=>JSON.stringify(p)));m.stops=keepBreaks.checked?m.stops.filter(s=>visible.has(JSON.stringify(s.point))):[];
      if(m.stops.reduce((n,s)=>n+s.durationMs,0)>(m.stats.pausedMs||0))throw Error('Paused time is shorter than the recorded breaks. Keep the recorded total or uncheck the break markers.');}
    return m;
  }
  const conflict=el('section',undefined,'notice');conflict.hidden=true;app.append(conflict);
  function showConflict(current,draft){
    conflict.replaceChildren(el('h2','This ride changed elsewhere'),el('p','Your unsaved edits are still in the form. Compare them before choosing which version to keep.'));
    const coverName=m=>m.cover?`Photo ${m.photos.findIndex(p=>p.id===m.cover)+1}`:'Default illustration';
    const table=el('table');const header=el('tr');['Field','Your edits','Website'].forEach(x=>header.append(el('th',x)));table.append(header);
    for(const[label,a,b]of [['Title',draft.title,current.manifest.title],['Story',draft.story,current.manifest.story],['Date',draft.date,current.manifest.date],['Tags',draft.tags.join(', '),current.manifest.tags.join(', ')],['Distance (miles)',draft.stats.meters==null?'Private':(draft.stats.meters/1609.344).toFixed(3),current.manifest.stats.meters==null?'Private':(current.manifest.stats.meters/1609.344).toFixed(3)],['Cover photo',coverName(draft),coverName(current.manifest)],...['elapsedMs','movingMs','stoppedMs','unknownMs'].map(key=>[({elapsedMs:'Elapsed time',movingMs:'Moving time',stoppedMs:'Stopped time',unknownMs:'GPS unknown time'})[key],formatTime(draft.stats[key]||0),formatTime(current.manifest.stats[key]||0)]),['Route',JSON.stringify(draft.route)===JSON.stringify(current.manifest.route)?'Matches website':`${draft.route.length} segments, ${draft.route.flat().length} points; coordinates differ`,`${current.manifest.route.length} segments, ${current.manifest.route.flat().length} points`],['Captions',draft.photos.map(p=>p.caption).join('; '),current.manifest.photos.map(p=>p.caption).join('; ')]]){
      const row=el('tr');[label,a,b].forEach(x=>row.append(el('td',String(x))));table.append(row)
    }
    if(JSON.stringify(draft.route)!==JSON.stringify(current.manifest.route)){
      const details=el('details');details.append(el('summary','Compare route coordinates'));
      for(const[label,value]of [['Your route',draft.route],['Website route',current.manifest.route]])details.append(el('h3',label),el('pre',JSON.stringify(value,null,2)));
      conflict.append(details);
    }
    conflict.append(table,button('Keep my edits as a new draft',()=>{head=current;conflict.hidden=true;save(false)},'quiet'),button('Load website version',()=>{dirty=false;reloadEditor()},'quiet'));
    conflict.hidden=false;conflict.scrollIntoView({behavior:'smooth',block:'center'});
  }
  const footer=el('div',undefined,'actions editor-save');form.append(footer);
  async function save(publish){
    if(busy)return;let draft;const disabledBefore=new Map();
    try{
      draft=collect();busy=true;form.querySelectorAll('input,textarea,select,button').forEach(input=>{disabledBefore.set(input,input.disabled);input.disabled=true});status.textContent='Saving ride details…';
      head=await api(`owner/rides/${id}/edit`,{method:'POST',body:JSON.stringify({base:head.revision,manifest:draft})});manifest=copy(head.manifest);dirty=false;
      if(includeStats)initialDistance=controls.distance.value;
      if(publish){
        if(head.needsReview){status.textContent='Draft saved. Open either updated app and tap Sync now to check route privacy, then return here to publish.';return}
        await api(`owner/rides/${id}/publish`,{method:'POST',body:JSON.stringify({base:head.published||null,revision:head.revision})});head.published=head.revision;
        status.textContent='Published ride updated. Both apps will receive the edit on their next sync.';
      }else status.textContent=head.needsReview?'Draft saved. Open either updated app to check route privacy before publishing.':'Private draft saved. Both apps will receive the edit on their next sync.';
    }catch(e){status.textContent=e.message;if(e.status===409&&e.data?.current&&draft)showConflict(e.data.current,draft)}
    finally{busy=false;for(const[input,disabled]of disabledBefore)input.disabled=disabled}
  }
  const saveDraft=button('Save draft',()=>save(false));saveDraft.type='button';
  const publishReview=el('div',undefined,'notice');publishReview.hidden=true;form.append(publishReview);
  publishReview.append(el('p','Publish the reviewed title, story, photos, route and statistics for everyone?'));
  const confirmPublish=button('Publish reviewed ride',async()=>{publishReview.hidden=true;await save(true)});confirmPublish.type='button';
  const cancelPublish=button('Keep private',()=>{publishReview.hidden=true},'quiet');cancelPublish.type='button';publishReview.append(confirmPublish,cancelPublish);
  const publishButton=button(head.published?'Update published ride':'Publish ride',()=>{publishReview.hidden=false;publishReview.scrollIntoView({behavior:'smooth',block:'center'})});publishButton.type='button';
  const refresh=button('Refresh sync / privacy status',async()=>{try{const latest=await api(`owner/rides/${id}/edit`);if(latest.revision!==head.revision){if(!dirty){await reloadEditor();return}status.textContent='The apps synchronized a newer version. Save your edits to review the conflict, or return to the studio and reopen this ride.'}else{head=latest;status.textContent=head.needsReview?'Waiting for a phone with the original recording to check route privacy.':'Route privacy check complete; this draft can be published.'}}catch(e){status.textContent=e.message}},'quiet');refresh.type='button';
  const back=button('Back to studio',()=>{if(!dirty||confirm('Leave without saving these edits?')){dirty=false;location.hash='owner'}},'quiet');back.type='button';
  footer.append(saveDraft,publishButton,refresh,back);
  if(head.needsReview)status.textContent='Draft route changes are waiting for a phone privacy check. Open either updated app and sync.';
  const unload=e=>{if(dirty){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',unload);
  return ()=>{window.removeEventListener('beforeunload',unload);marker?.remove()};
}
