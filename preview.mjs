import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile, readdir, realpath} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {handle} from './worker.mjs';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

async function openDatabase(directory, requiredTable) {
  const files = (await readdir(directory)).filter(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
  if (files.length !== 1) throw new Error(`Expected one existing ${requiredTable} database. Start the standard local setup first; multiple databases need explicit review.`);
  const db = new DatabaseSync(path.join(directory, files[0]), {readOnly: true});
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(requiredTable)) {
    db.close();
    throw new Error(`Existing local database is missing ${requiredTable}.`);
  }
  db.exec('PRAGMA query_only = ON');
  return db;
}

function readOnlyD1(db) {
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      function bound(values = []) {
        return {
          bind: (...args) => bound(args),
          first: async () => statement.get(...values) ?? null,
          all: async () => ({results: statement.all(...values)}),
        };
      }
      return bound();
    },
  };
}

function jsonError(message, status) {
  return new Response(JSON.stringify({error: message}), {
    status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'},
  });
}

export async function createPreview({root = projectRoot, port = 8891} = {}) {
  const state = path.join(root, '.wrangler/state/v3');
  const site = await realpath(path.join(root, 'site'));
  const variables = await readFile(path.join(root, '.dev.vars'), 'utf8');
  const digest = variables.match(/^\s*OWNER_TOKEN_SHA256\s*=\s*["']?([a-f0-9]{64})["']?\s*(?:#.*)?$/m)?.[1];
  if (!digest) throw new Error('Configure OWNER_TOKEN_SHA256 in .dev.vars before starting the preview.');

  const rides = await openDatabase(path.join(state, 'd1/miniflare-D1DatabaseObject'), 'rides');
  let objects;
  try {
    objects = await openDatabase(path.join(state, 'r2/miniflare-R2BucketObject'), '_mf_objects');
  } catch (error) {
    rides.close();
    throw error;
  }
  const env = {
    OWNER_TOKEN_SHA256: digest,
    DB: readOnlyD1(rides),
    PHOTOS: {
      async get(key) {
        const object = objects.prepare('SELECT blob_id FROM _mf_objects WHERE key=?').get(key);
        if (!object?.blob_id || !/^[a-f0-9]+$/.test(object.blob_id)) return null;
        try {
          return {body: await readFile(path.join(state, 'r2/dadrides-local/blobs', object.blob_id))};
        } catch (error) {
          if (error.code === 'ENOENT') return null;
          throw error;
        }
      },
    },
  };

  async function respond(request) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) {
      return jsonError('This local preview is read-only. Publishing, uploads and deletion are disabled.', 405);
    }
    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET') return jsonError('Only GET is supported for preview API requests.', 405);
      return handle(request, env);
    }
    let relative;
    try { relative = decodeURIComponent(url.pathname); }
    catch { return jsonError('Invalid path.', 400); }
    if (relative.includes('\\') || relative.includes('\0')) return jsonError('Invalid path.', 400);
    const requested = path.resolve(site, '.' + (relative === '/' ? '/index.html' : relative));
    if (!requested.startsWith(site + path.sep)) return jsonError('Not found.', 404);
    try {
      const actual = await realpath(requested);
      if (!actual.startsWith(site + path.sep)) return jsonError('Not found.', 404);
      let body = await readFile(actual);
      if (actual === path.join(site, 'index.html')) {
        body = Buffer.from(body.toString('utf8')
          .replace('</head>', '<meta name="dadrides-preview" content="read-only"></head>')
          .replace('<main', '<aside role="note" style="padding:12px 24px;text-align:center;background:#273c30;color:#fff">Local preview · Read-only. Existing local data; nothing here is published to the internet.</aside><main'));
      }
      return new Response(body, {headers: {'content-type': mimeTypes[path.extname(actual)] || 'application/octet-stream'}});
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) return jsonError('Not found.', 404);
      throw error;
    }
  }

  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const host = incoming.headers.host;
      const activePort = server.address().port;
      if (![ `127.0.0.1:${activePort}`, `localhost:${activePort}` ].includes(host)) {
        outgoing.writeHead(403); outgoing.end('Local preview host required.'); return;
      }
      const url = new URL(incoming.url, `http://${host}`);
      if (url.origin !== `http://${host}`) {
        outgoing.writeHead(403); outgoing.end('Local preview host required.'); return;
      }
      const request = new Request(url, {method: incoming.method, headers: incoming.headers});
      const response = await respond(request);
      const headers = Object.fromEntries(response.headers);
      Object.assign(headers, {'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer'});
      outgoing.writeHead(response.status, headers);
      outgoing.end(incoming.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error('Local preview request failed:', error.code || error.name);
      if (!outgoing.headersSent) outgoing.writeHead(500, {'content-type': 'application/json'});
      outgoing.end(JSON.stringify({error: 'Local preview request failed. See the local server log.'}));
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch (error) {
    rides.close(); objects.close(); throw error;
  }
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      rides.close(); objects.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const preview = await createPreview();
    console.log(`DadRides read-only preview: ${preview.url}`);
    console.log('Owner key: owner-local.txt (local preview only).');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => preview.close().then(() => process.exit(0)));
  } catch (error) {
    console.error('Preview could not start:', error.message);
    process.exitCode = 1;
  }
}
