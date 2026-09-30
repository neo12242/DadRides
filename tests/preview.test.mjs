import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {createHash, randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createPreview} from '../preview.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');

test('read-only preview preserves data and public/owner separation', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dadrides-preview-test-'));
  const d1Dir = path.join(tempRoot, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  const r2Dir = path.join(tempRoot, '.wrangler/state/v3/r2/miniflare-R2BucketObject');
  const blobs = path.join(tempRoot, '.wrangler/state/v3/r2/dadrides-local/blobs');
  const site = path.join(tempRoot, 'site');
  let preview;
  try {
    for (const dir of [d1Dir, r2Dir, blobs, path.join(site, 'vendor')]) await mkdir(dir, {recursive: true});
    const key = randomBytes(32).toString('hex');
    await writeFile(path.join(tempRoot, '.dev.vars'), `OWNER_TOKEN_SHA256="${hash(key)}"\n`);
    await writeFile(path.join(site, 'index.html'), '<html><head></head><body><main>Journal</main></body></html>');
    await writeFile(path.join(site, 'vendor/map.mjs'), 'export const test = true;');
    const d1File = path.join(d1Dir, 'fixture.sqlite');
    const r2File = path.join(r2Dir, 'fixture.sqlite');
    const d1 = new DatabaseSync(d1File);
    d1.exec(await readFile(new URL('../schema.sql', import.meta.url), 'utf8'));
    const r2 = new DatabaseSync(r2File);
    r2.exec('CREATE TABLE _mf_objects(key TEXT PRIMARY KEY, blob_id TEXT)');
    const image = Buffer.from([255, 216, 255, 217]);
    const ids = ['00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002'];
    const photo = '00000000-0000-4000-b000-000000000001';
    const revisions = ['a'.repeat(64), 'b'.repeat(64)];
    for (let i = 0; i < 2; i++) {
      const revision = revisions[i];
      const manifest = JSON.stringify({id: ids[i], title: i ? 'Private fixture' : 'Public fixture', date: '2026-09-12', cover: photo});
      d1.prepare('INSERT INTO rides(id,published) VALUES(?,?)').run(ids[i], i ? null : revision);
      d1.prepare('INSERT INTO revisions(id,ride,manifest,bytes,ready,created) VALUES(?,?,?,?,1,0)').run(revision, ids[i], manifest, 4);
      for (const suffix of ['jpg', 'thumb.jpg']) {
        const asset = `${revision}/${photo}.${suffix}`;
        d1.prepare('INSERT INTO assets(key,revision,sha,bytes,ready) VALUES(?,?,?,?,1)').run(asset, revision, hash(image), image.length);
        r2.prepare('INSERT INTO _mf_objects(key,blob_id) VALUES(?,?)').run(asset, revision);
      }
      await writeFile(path.join(blobs, revision), image);
    }
    d1.close(); r2.close();
    const originalHashes = await Promise.all([d1File, r2File].map(async file => hash(await readFile(file))));
    preview = await createPreview({root: tempRoot, port: 0});
    const owner = {headers: {Authorization: `Bearer ${key}`}};
    const get = (route, options) => fetch(preview.url + route, options);

    const index = await get('/');
    assert.equal(index.status, 200);
    const html = await index.text();
    assert.match(html, /name="dadrides-preview"/);
    assert.match(html, /Read-only/);
    const module = await get('/vendor/map.mjs');
    assert.equal(module.headers.get('content-type'), 'application/javascript');
    assert.equal(module.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await get('/.dev.vars')).status, 404);
    assert.equal((await get('/%2e%2e%2f.dev.vars')).status, 404);
    assert.equal((await get('/%zz')).status, 400);

    const publicRides = await (await get('/api/rides')).json();
    assert.deepEqual(publicRides.map(ride => ride.id), [ids[0]]);
    assert.equal((await get(`/api/rides/${ids[1]}`)).status, 404);
    assert.equal((await get('/api/owner/rides')).status, 401);
    assert.equal((await get('/api/owner/status', {headers: {Authorization: 'Bearer ' + 'x'.repeat(64)}})).status, 401);
    assert.equal((await get('/api/owner/status', owner)).status, 200);
    assert.equal((await (await get('/api/owner/rides', owner)).json()).length, 2);
    const detail = await get(`/api/owner/rides/${ids[1]}/revisions/${revisions[1]}`, owner);
    assert.equal((await detail.json()).manifest.title, 'Private fixture');
    for (const suffix of ['jpg', 'thumb.jpg']) {
      const asset = `${revisions[1]}/${photo}.${suffix}`;
      assert.equal((await get('/api/assets/' + asset)).status, 404);
      const privatePhoto = await get('/api/owner/assets/' + asset, owner);
      assert.equal(privatePhoto.status, 200);
      assert.deepEqual(Buffer.from(await privatePhoto.arrayBuffer()), image);
      assert.equal((await get(`/api/assets/${revisions[0]}/${photo}.${suffix}`)).status, 200);
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = await get(`/api/owner/rides/${ids[0]}/unpublish`, {...owner, method});
      assert.equal(response.status, 405);
      assert.match((await response.json()).error, /read-only/);
    }
    const hostStatus = await new Promise((resolve, reject) => {
      http.get(preview.url, {headers: {Host: 'untrusted.example'}}, response => {
        response.resume(); resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(hostStatus, 403);
    await preview.close(); preview = undefined;
    assert.deepEqual(await Promise.all([d1File, r2File].map(async file => hash(await readFile(file)))), originalHashes);
  } finally {
    if (preview) await preview.close();
    // Only remove the unique test directory created by this test under the OS temp directory.
    const resolved = path.resolve(tempRoot);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('dadrides-preview-test-'));
    await rm(resolved, {recursive: true, force: true});
  }
});
