import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('site/vendor',{recursive:true});
for(const file of ['maplibre-gl.mjs','maplibre-gl-shared.mjs','maplibre-gl-worker.mjs','maplibre-gl.css'])await copyFile('node_modules/maplibre-gl/dist/'+file,'site/vendor/'+file);
