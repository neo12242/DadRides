export function serviceSummary(data,now=Date.now()){
  const starts=(data.serviceBaselines||[]).filter(b=>b.enabled);
  const readings=[...data.fuel,...data.maintenance,...starts];
  const odometer=readings.length?Math.max(...readings.map(r=>r.odometerKm)):null;
  const baseline=type=>data.maintenance.filter(r=>r.serviceId===type.id&&r.serviceId!=='mileage-record').sort((a,b)=>b.time-a.time||b.odometerKm-a.odometerKm||(a.id<b.id?1:a.id>b.id?-1:0))[0]||null;
  return {odometer,items:data.serviceTypes.filter(t=>t.id!=='mileage-record'&&t.enabled).map(type=>{
    const last=baseline(type),newBike=last?null:starts.find(b=>b.id===type.id)||null,start=last||newBike;
    const dueOdometer=start&&type.intervalKm>0?start.odometerKm+type.intervalKm:null;
    const remaining=dueOdometer!==null&&odometer!==null?dueOdometer-odometer:null;
    const due=start&&type.intervalDays>0?(newBike?calendarDate(newBike.date,type.intervalDays).getTime():last.time+type.intervalDays*86400000):null;
    const daysRemaining=due===null?null:calendarDay(due)-calendarDay(now);
    const status=data.conflicts.length?'Resolve app conflicts':!type.configured?'Not configured':!start?'No service baseline':remaining!==null&&remaining<=0||due!==null&&due<=now?'Due':remaining===null&&due===null?'No repeating interval':'On schedule';
    return {...type,last,newBike,remaining,due,dueOdometer,daysRemaining,status};
  })};
}
function calendarDate(value,days=0){const [y,m,d]=value.split('-').map(Number);return new Date(y,m-1,d+days)}
function calendarDay(value){const d=new Date(value);return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000}
export function serviceCountdown(item){
  const miles=item.remaining===null?null:Math.abs(item.remaining)/1.609344;
  const distance=miles!==null&&miles>0&&miles<0.05?'<0.1':miles?.toFixed(1);
  const days=item.daysRemaining===null?null:Math.abs(item.daysRemaining);
  return {
    mileage:item.intervalKm<=0?'Mileage interval not set':item.remaining===null?'Service baseline or odometer needed':Math.abs(item.remaining)<1e-8?'Due now':item.remaining<0?'Overdue by '+distance+' miles':distance+' miles remaining',
    time:item.intervalDays<=0?'Time interval not set':days===null?'Service baseline needed':days===0?'Due today':item.daysRemaining<0?'Overdue by '+days+(days===1?' day':' days'):days+(days===1?' day remaining':' days remaining')
  };
}
export async function servicesPage(ctx){
  const {app,el,button,api,active}=ctx;
  const data=await api('owner/services');if(!active())return;
  app.append(el('p','YOUR GARAGE','eyebrow'),el('h1','My Services'),el('p','Your service records, synced from RykerConnect. Make changes in the Phone or ESP app.','intro'));
  const sync=el('section',undefined,'notice');sync.append(el('strong',data.lastSync?'Last received '+new Date(data.lastSync).toLocaleString():'Waiting for your first service sync'));
  sync.append(el('p',data.lastSync?'Open either updated app and use Settings → Add-ons → Sync now to send changes.':'Update both apps, connect DadRides in Add-ons, and use Sync now.'));
  if(data.lastSync&&Date.now()-data.lastSync>86400000)sync.append(el('p','This copy is more than a day old. Counters use your last recorded odometer; new activity may not be included.'));
  if(data.conflicts.length)sync.append(el('p','Some records have conflicting app changes. Resolve them in Shared ride library and sync again. Due status is withheld until then.'));
  sync.append(button('Refresh website copy',ctx.reload,'quiet'));app.append(sync);
  const summary=serviceSummary(data),odo=el('div',undefined,'stats');odo.append(el('b',summary.odometer===null?'No recorded odometer':(summary.odometer/1.609344).toFixed(1)+' mi'),el('small','Latest entered odometer or new-bike baseline • not GPS ride totals'));app.append(odo);
  const grid=el('div',undefined,'grid service-grid');app.append(grid);
  if(!summary.items.length)grid.append(el('p','No enabled services received yet. Configure your services in the app.','empty'));
  for(const item of summary.items){
    const card=el('article',undefined,'service-card');card.append(el('span',item.status,item.status==='Due'?'status due':'status'),el('h2',item.name));
    card.append(el('p',[item.intervalKm>0?(item.intervalKm/1.609344).toFixed(0)+' miles':null,item.intervalDays>0?item.intervalDays+' days':null].filter(Boolean).join(' or ')||'No repeating interval'));
    if(item.last)card.append(el('p','Last service: '+new Date(item.last.time).toLocaleDateString()+' at '+(item.last.odometerKm/1.609344).toFixed(1)+' mi'));
    if(item.newBike)card.append(el('p','New-bike baseline: '+calendarDate(item.newBike.date).toLocaleDateString()+' at '+(item.newBike.odometerKm/1.609344).toFixed(1)+' mi · no completed service recorded'));
    if(!data.conflicts.length){
      const countdown=serviceCountdown(item);
      const mileage=el('p'),time=el('p');
      mileage.append(el('strong','Mileage: '+countdown.mileage));
      if(item.dueOdometer!==null)mileage.append(el('br'),el('span','Due at '+(item.dueOdometer/1.609344).toFixed(1)+' miles'));
      time.append(el('strong','Time: '+countdown.time));
      if(item.due!==null)time.append(el('br'),el('span','Due '+new Date(item.due).toLocaleDateString()));
      card.append(mileage,time);
      if(item.intervalKm>0&&item.intervalDays>0)card.append(el('p','Service is due when either limit is reached.'));
    }else card.append(el('p','Countdown unavailable until app conflicts are resolved.'));
    grid.append(card);
  }
  app.append(el('h2','Maintenance history','section'));
  const history=data.maintenance.filter(r=>r.serviceId!=='mileage-record').sort((a,b)=>b.time-a.time);
  if(!history.length)app.append(el('p','No maintenance history received.'));
  for(const r of history){const card=el('article',undefined,'notice');card.append(el('h3',r.name),el('p',new Date(r.time).toLocaleDateString()+' · '+(r.odometerKm/1.609344).toFixed(1)+' mi'));if(r.notes)card.append(el('p',r.notes,'story'));if(r.parts)card.append(el('p','Parts: '+r.parts));if(r.cost!==undefined)card.append(el('p','Cost: $'+r.cost.toFixed(2)));app.append(card)}
}
