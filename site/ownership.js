const money=n=>n===null?'Not entered':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const empty=(id=crypto.randomUUID())=>({version:1,id,title:'',status:'Planned',estimateCents:null,installedDate:'',installedKm:null,notes:'',archived:false,expenses:[]});
function amount(value){if(value.trim()==='')return null;if(!/^\d+(\.\d{1,2})?$/.test(value))throw Error('Use a non-negative USD amount with up to two decimal places.');const cents=Math.round(Number(value)*100);if(cents>100000000)throw Error('Amount is too large.');return cents}
export async function ownershipPage(ctx,id){
  const {app,el,api,button,active,notice}=ctx;
  app.append(el('p','PRIVATE OWNERSHIP RECORDS','eyebrow'),el('h1',id?'Modification details':'My modifications'),el('p','Purchases count once on their purchase date. Estimates and installation do not add spending. Article and photo editing stays in Publishing Studio.','intro'));
  const data=await api('owner/ownership');if(!active())return;
  if(!id){
    app.append(button('Add modification',()=>{location.hash='ownership/new'}));
    const total=data.items.flatMap(r=>r.document.expenses).reduce((n,e)=>n+(e.amountCents??0),0);
    app.append(el('p','Recorded modification spending: '+money(total)));
    for(const r of data.items){const m=r.document,a=el('a',undefined,'notice');a.href='#ownership/'+m.id;a.append(el('h2',m.title),el('p',m.status+(m.archived?' · Archived':'')+' · '+money(m.expenses.reduce((n,e)=>n+(e.amountCents??0),0))+' recorded'));app.append(a)}
    if(!data.items.length)notice('Add a modification here or sync one from RykerConnect.');return;
  }
  let row=id==='new'?null:data.items.find(r=>r.id===id);if(id!=='new'&&!row)throw Error('Modification not found.');
  let m=structuredClone(row?.document||empty()),dirty=false,busy=false,fixedUrl=location.href;
  app.append(button('← All modifications',()=>{location.hash='ownership'},'quiet'));
  const form=el('form',undefined,'ride-editor'),message=el('p',undefined,'notice'),conflict=el('section');message.setAttribute('role','status');app.append(form,message,conflict);
  const field=(label,value,type='text')=>{const wrap=el('label',label,'editor-field'),input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.value=value;wrap.append(input);form.append(wrap);return input};
  const title=field('Modification name',m.title);title.required=true;title.maxLength=100;
  const statusLabel=el('label','Status','editor-field'),status=el('select');for(const s of ['Planned','Purchased','Installed']){const o=el('option',s);o.value=s;status.append(o)}status.value=m.status;statusLabel.append(status);form.append(statusLabel);
  const estimate=field('Estimated total (USD, optional)',m.estimateCents===null?'':(m.estimateCents/100).toFixed(2));estimate.inputMode='decimal';
  const installed=field('Installation date (optional)',m.installedDate,'date'),odo=field('Installation odometer (miles, optional)',m.installedKm===null?'':String(m.installedKm/1.609344));odo.inputMode='decimal';
  const notes=field('Private notes',m.notes,'textarea');notes.maxLength=2000;
  const archivedLabel=el('label',' Archived (expenses remain in totals)'),archived=el('input');archived.type='checkbox';archived.checked=m.archived;archivedLabel.prepend(archived);form.append(archivedLabel);
  form.append(el('h2','Actual purchases'),el('p','Leave amount blank when unknown; enter 0 for a known free item. Add parts, shipping or installation as separate expenses.'));
  const expenses=el('div'),expenseRows=[];form.append(expenses);
  const addExpense=(e={id:crypto.randomUUID(),date:today(),label:'',amountCents:null})=>{
    const section=el('fieldset'),legend=el('legend','Purchase');section.append(legend);
    const controls={};for(const [key,label,type,value] of [['date','Purchase date','date',e.date],['label','Description','text',e.label],['amount','Amount (USD, optional)','text',e.amountCents===null?'':(e.amountCents/100).toFixed(2)]]){const wrap=el('label',label,'editor-field'),input=el('input');input.type=type;input.value=value;input.required=key!=='amount';if(key==='label')input.maxLength=120;if(key==='amount')input.inputMode='decimal';wrap.append(input);section.append(wrap);controls[key]=input}
    const entry={id:e.id,controls,removed:false};expenseRows.push(entry);
    const remove=button('Remove purchase',()=>{if(confirm('Remove this expense from the saved modification and its spending totals?')){entry.removed=true;section.remove();dirty=true}},'quiet');remove.type='button';section.append(remove);expenses.append(section);
  };
  m.expenses.forEach(addExpense);const add=button('Add purchase',()=>{addExpense();dirty=true},'quiet');add.type='button';form.append(add);
  const save=el('button','Save private details');save.type='submit';form.append(save);
  async function persist(base){const result=await api('owner/ownership/'+m.id,{method:'POST',body:JSON.stringify({base,document:m})});if(!active())return;row=result;dirty=false;history.replaceState(null,'','#ownership/'+m.id);fixedUrl=location.href;message.textContent='Saved. The app will receive these details on its next sync.';conflict.replaceChildren();}
  form.oninput=()=>{dirty=true};form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;save.disabled=true;try{
    const km=odo.value.trim()===''?null:Number(odo.value)*1.609344;if(km!==null&&(!Number.isFinite(km)||km<0))throw Error('Enter valid installation mileage.');
    m={...m,title:title.value.trim(),status:status.value,estimateCents:amount(estimate.value),installedDate:installed.value,installedKm:km,notes:notes.value,archived:archived.checked,expenses:expenseRows.filter(r=>!r.removed).map(r=>({id:r.id,date:r.controls.date.value,label:r.controls.label.value.trim(),amountCents:amount(r.controls.amount.value)}))};
    await persist(row?.revision||null);
  }catch(e){message.textContent=e.message;if(e.status===409&&e.data.current){const remote=e.data.current;conflict.replaceChildren(el('h2','Both versions are available'),el('p','Website version (your unsaved changes remain above):'),el('pre',JSON.stringify(remote.document,null,2)));conflict.append(button('Use website version',()=>{if(confirm('Discard this unsaved form and use the website version?')){dirty=false;ctx.reload()}},'quiet'),button('Replace with my reviewed changes',async()=>{try{if(confirm('Replace the website version with the changes shown in this form?'))await persist(remote.revision)}catch(err){message.textContent=err.message}},'quiet'))}}finally{busy=false;save.disabled=false}};
  app.append(button('Edit article & photos',async()=>{try{if(dirty||!row?.revision)throw Error('Save the private details first.');await api('owner/ownership/'+m.id+'/article',{method:'POST',body:'{}'});location.hash='mod-edit/'+m.id}catch(e){message.textContent=e.message}},'quiet'));
  const before=e=>{if(dirty){e.preventDefault();e.returnValue=''}};const guard=e=>{if(dirty&&!confirm('Leave without saving private modification changes?')){e.stopImmediatePropagation();history.replaceState(null,'',fixedUrl)}};
  window.addEventListener('beforeunload',before);window.addEventListener('hashchange',guard,true);return()=>{window.removeEventListener('beforeunload',before);window.removeEventListener('hashchange',guard,true)};
}
