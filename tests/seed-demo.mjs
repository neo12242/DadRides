import {readFile} from 'node:fs/promises';import {sha} from '../worker.mjs';
const token=(await readFile(new URL('../owner-local.txt',import.meta.url),'utf8')).trim();const origin='http://127.0.0.1:8890';
async function send(path,method='GET',body){const r=await fetch(origin+'/api/owner/'+path,{method,headers:{Authorization:'Bearer '+token},body});if(!r.ok)throw Error(await r.text());return r.json()}
for(let i=0;i<3;i++){
 const id=`00000000-0000-4000-a000-00000000000${i+1}`,photo=`00000000-0000-4000-b000-00000000000${i+1}`;const bytes=await readFile(new URL(`fixtures/landscape-${i}.jpg`,import.meta.url));const hash=await sha(bytes);
 const route=[Array.from({length:80},(_,n)=>[-149.98+n*.004,61.17+Math.sin(n/12)*.015-i*.02])];
 const m={version:1,id,title:['DEMO · A coastal afternoon','DEMO · The road to somewhere','DEMO · A little farther north'][i],story:'LOCAL DEMONSTRATION ONLY\n\nAn illustrated sample ride showing how your route, story and photos come together. This is synthetic data, not an actual recorded ride.',date:`2026-09-${12-i}`,tags:['Demo',['Coast','Scenic','Weekend'][i]],cover:photo,photos:[{id:photo,caption:'Illustrated demo artwork — no personal photos.',sha:hash,size:bytes.length,thumbSha:hash,thumbSize:bytes.length}],route,stats:{meters:24000+i*16000,elapsedMs:3600000+i*1200000,movingMs:3000000,stoppedMs:300000,unknownMs:300000},privacy:{trimMeters:500,statsIncluded:true}};
 // Keep synthetic demo covers on the reusable default illustration. Old revisions remain available.
 m.cover='';m.photos=[];
 const text=JSON.stringify(m);const rev=await sha(new TextEncoder().encode(text));await send(`rides/${id}/revisions/${rev}`,'PUT',text);await send(`rides/${id}/finish/${rev}`,'POST');
 const current=await send(`rides/${id}/revisions/${rev}`);await send(`rides/${id}/publish`,'POST',JSON.stringify({base:current.published||null,revision:rev}));
}
console.log('Three synthetic demonstration rides published to localhost only.');
