// Isolated writable local review server. Never opens the production database or bindings.
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {handle,sha} from '../worker.mjs';
const directory=process.env.DADRIDES_OWNERSHIP_PREVIEW_DIR;
if(!directory)throw Error('Set DADRIDES_OWNERSHIP_PREVIEW_DIR to a dedicated local test directory.');
mkdirSync(directory,{recursive:true});const db=new DatabaseSync(resolve(directory,'ownership-review.sqlite'));
db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
const keyFile=resolve(directory,'owner-key.txt');if(!existsSync(keyFile))writeFileSync(keyFile,randomBytes(32).toString('hex'));
const key=readFileSync(keyFile,'utf8').trim();
const statement=(sql,args=[])=>({bind(...v){return statement(sql,v)},first(){return db.prepare(sql).get(...args)??null},all(){return {results:db.prepare(sql).all(...args)}},run(){return db.prepare(sql).run(...args)}});
const env={OWNER_TOKEN_SHA256:await sha(new TextEncoder().encode(key)),DB:{prepare:statement,batch(items){db.exec('BEGIN');try{const out=items.map(s=>s.run());db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}}},PHOTOS:{async get(k){const p=resolve(directory,'media',k);if(!p.startsWith(resolve(directory,'media')+sep))throw Error('Invalid media path');return existsSync(p)?{body:readFileSync(p)}:null},async put(k,b){const p=resolve(directory,'media',k);if(!p.startsWith(resolve(directory,'media')+sep))throw Error('Invalid media path');mkdirSync(resolve(p,'..'),{recursive:true});writeFileSync(p,Buffer.from(b))},async delete(){throw Error('Media deletion is disabled in local ownership review')}}};
const site=resolve('site'),types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1:8893');if(req.headers.host!=='127.0.0.1:8893'&&req.headers.host!=='localhost:8893'){res.writeHead(403);res.end();return}
  if(url.pathname.startsWith('/api/')){const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>5000000)throw Error('Request too large');chunks.push(b)}const body=Buffer.concat(chunks);const r=await handle(new Request(url,{method:req.method,headers:req.headers,...(body.length?{body}: {})}),env);res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return}
  const path=resolve(site,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!path.startsWith(site+sep)){res.writeHead(403);res.end();return}
  const content=readFileSync(path);res.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'});res.end(content);
}catch{if(!res.headersSent)res.writeHead(404);res.end('Local preview request unavailable')}}).listen(8893,'127.0.0.1',()=>console.log('Isolated ownership preview: http://127.0.0.1:8893'));
