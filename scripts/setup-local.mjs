import {randomBytes, createHash} from 'node:crypto';
import {existsSync, writeFileSync} from 'node:fs';
const vars = new URL('../.dev.vars', import.meta.url);
const keyFile = new URL('../owner-local.txt', import.meta.url);
if (existsSync(vars) || existsSync(keyFile)) {
  throw new Error('Local credentials already exist. Keep them; this setup never overwrites keys.');
}
const key = randomBytes(32).toString('hex');
const digest = createHash('sha256').update(key).digest('hex');
writeFileSync(keyFile, key + '\n', {flag: 'wx', mode: 0o600});
writeFileSync(vars, `OWNER_TOKEN_SHA256=${digest}\n`, {flag: 'wx', mode: 0o600});
console.log('Created ignored local credentials. Use owner-local.txt only for your localhost preview.');
