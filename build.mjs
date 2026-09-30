import {mkdir,copyFile} from 'node:fs/promises';
import {build} from 'esbuild';
await mkdir('site/vendor',{recursive:true});
for(const file of ['maplibre-gl.mjs','maplibre-gl-shared.mjs','maplibre-gl-worker.mjs','maplibre-gl.css'])await copyFile('node_modules/maplibre-gl/dist/'+file,'site/vendor/'+file);
await build({entryPoints:['entry.mjs'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'site/_worker.js'});
