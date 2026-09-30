const code=location.hash.slice(1);history.replaceState(null,'','/handoff.html');
try{
  const r=await fetch('/api/session/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Sign-in unavailable');
  if(!/^#mod-edit\/[a-f0-9-]{36}$/.test(data.target))throw Error('Invalid editor destination');
  location.replace('/'+data.target);
}catch(e){document.querySelector('#status').textContent=e.message}
