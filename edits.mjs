// Editorial metadata never reads or writes the PHOTOS binding.
import {visibleStops} from './stops.mjs';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9-]{36}$/;
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function routeSubset(next, previous) {
  return next.every(line => previous.some(source => {
    let at = 0;
    return line.every(p => {
      while (at < source.length && (source[at][0] !== p[0] || source[at][1] !== p[1])) at++;
      return at++ < source.length;
    });
  }));
}
export function normalizeStatistics(stats) {
  if (!Object.keys(stats).length) return {};
  const keys = ['meters', 'elapsedMs', 'movingMs', 'stoppedMs', 'unknownMs'];
  for (const key of keys) {
    if (!Number.isFinite(stats[key]) || stats[key] < 0 || stats[key] > 1e12) throw Error('Enter valid distance and time totals');
    if (key !== 'meters' && !Number.isSafeInteger(stats[key])) throw Error('Times must be whole milliseconds');
  }
  const paused=stats.pausedMs??0;
  if(!Number.isSafeInteger(paused)||paused<0||paused>1e12)throw Error('Enter valid paused time');
  if (Math.abs(stats.elapsedMs - stats.movingMs - stats.stoppedMs - stats.unknownMs - paused) > 1) throw Error('Moving, stopped, paused and unknown time must add up to elapsed time');
  return {...Object.fromEntries(keys.map(k => [k, stats[k]])),...(stats.pausedMs!==undefined?{pausedMs:paused}:{}), averageMps: stats.movingMs ? stats.meters / (stats.movingMs / 1000) : null};
}
export async function seedHead(db, ride, revision) {
  await db.prepare('INSERT INTO edit_heads(ride,revision) SELECT ride,id FROM revisions WHERE ride=? AND id=? AND ready=1 ON CONFLICT(ride) DO UPDATE SET revision=excluded.revision WHERE edit_heads.revision IS NULL').bind(ride, revision).run();
}
export async function editorialHead(db, ride) {
  const row = await db.prepare(`SELECT h.ride id,h.revision,h.sequence,r.manifest,d.published,COALESCE(s.needs_review,0) needsReview
    FROM edit_heads h JOIN revisions r ON r.id=h.revision JOIN rides d ON d.id=h.ride
    LEFT JOIN edit_safety s ON s.revision=h.revision WHERE h.ride=?`).bind(ride).first();
  return row ? {...row, manifest: JSON.parse(row.manifest), needsReview: !!row.needsReview} : null;
}
export async function handleEdits(req, env, parts, h) {
  const {json, bounded, validate, sha} = h;
  const [resource, id, action] = parts;
  if (resource === 'sync' && req.method === 'GET') {
    const after = Number(new URL(req.url).searchParams.get('after') || 0);
    if (!Number.isSafeInteger(after) || after < 0) throw Error('Invalid sync cursor');
    const {value: ceiling} = await env.DB.prepare('SELECT value FROM sync_clock WHERE id=1').first();
    if (after > ceiling) return json({error:'Sync cursor was reset; request a fresh snapshot',reset:true},409);
    const {results} = await env.DB.prepare(`SELECT h.ride id,h.revision,h.sequence,r.manifest,d.published,COALESCE(s.needs_review,0) needsReview
      FROM edit_heads h LEFT JOIN revisions r ON r.id=h.revision JOIN rides d ON d.id=h.ride LEFT JOIN edit_safety s ON s.revision=h.revision
      WHERE h.sequence>? AND h.sequence<=? ORDER BY h.sequence LIMIT 6`).bind(after, ceiling).all();
    const rows=[];let bytes=0;
    for(const row of results){const size=new TextEncoder().encode(row.manifest||'').length;if(rows.length && bytes+size>3_500_000)break;rows.push(row);bytes+=size}
    const more = results.length===6 || rows.length<results.length;
    return json({version:1,changes:rows.map(r => ({...r,manifest:r.manifest?JSON.parse(r.manifest):null,deleted:!r.revision,needsReview:!!r.needsReview})),
      cursor:more ? rows.at(-1).sequence : ceiling,more});
  }
  if (resource !== 'rides' || !UUID.test(id || '') || !['edit','verify-route','adopt'].includes(action)) return null;
  if (env.EDITS_READ_ONLY === 'true' && req.method !== 'GET') return json({error:'Website editing is temporarily paused. Your saved versions are retained.'},503);
  const head = await editorialHead(env.DB, id);
  if (action === 'adopt' && req.method === 'POST') {
    const body=JSON.parse(new TextDecoder().decode(await bounded(req,2000)));
    if (!(body.base===null || HASH.test(body.base)) || !HASH.test(body.revision||'')) throw Error('Invalid revision selection');
    if (head?.revision===body.revision) return json(head);
    if ((head?.revision||null)!==body.base) return json({error:'The current draft changed. Review both versions before selecting a new draft.',current:head},409);
    if (!await env.DB.prepare('SELECT id FROM revisions WHERE id=? AND ride=? AND ready=1').bind(body.revision,id).first()) throw Error('Draft is not ready');
    await env.DB.prepare('INSERT INTO edit_heads(ride,revision) VALUES(?,?) ON CONFLICT(ride) DO UPDATE SET revision=excluded.revision WHERE edit_heads.revision IS ?').bind(id,body.revision,body.base).run();
    const current=await editorialHead(env.DB,id);
    return current.revision===body.revision?json(current):json({error:'The current draft changed. Refresh before trying again.',current},409);
  }
  if (!head) return json({error:'Finish uploading this ride before editing it'},404);
  if (req.method === 'GET' && action === 'edit') return json(head);
  if (req.method !== 'POST') return json({error:'Not allowed'},405);
  const body = JSON.parse(new TextDecoder().decode(await bounded(req,4_000_000)));
  if (!HASH.test(body.base || '')) throw Error('An edit base revision is required');
  const verify = action === 'verify-route';
  const candidate=verify ? {...head.manifest,route:body.route} : body.manifest;
  // Removing a route point also removes its marker; a privacy check never retains a hidden pin.
  if(candidate?.stops && Array.isArray(candidate.route) && candidate.route.every(Array.isArray))candidate.stops=visibleStops(candidate.stops,candidate.route);
  const m = validate(candidate);
  if (m.id !== id) throw Error('Ride identifier mismatch');
  const old = head.manifest;
  const media = photos => photos.map(({id,sha,size,thumbSha,thumbSize}) => ({id,sha,size,thumbSha,thumbSize})).sort((a,b) => a.id.localeCompare(b.id));
  if (canonical(media(m.photos)) !== canonical(media(old.photos))) throw Error('New or removed photos require a prepared upload in the app');
  if (canonical(m.privacy) !== canonical(old.privacy)) throw Error('Change upload privacy in the app');
  if (canonical(m.stats) !== canonical(old.stats)) m.stats = normalizeStatistics(m.stats);
  if (!m.privacy.statsIncluded && Object.keys(m.stats).length) throw Error('Statistics are excluded by this upload privacy setting');
  if (verify && !routeSubset(m.route, old.route)) throw Error('Privacy validation may only remove existing points');
  const text = canonical(m), revision = await sha(new TextEncoder().encode(text));
  if (head.revision === revision && (!verify || !head.needsReview)) return json(head);
  if (body.base !== head.revision) return json({error:'This ride changed elsewhere. Review both versions before saving.',current:head},409);
  const needsReview = verify ? 0 : Number(head.needsReview || (m.privacy.trimMeters > 0 && !routeSubset(m.route, old.route)));
  // Every mutation is conditional on the same base inside one atomic D1 batch.
  const condition = 'EXISTS(SELECT 1 FROM edit_heads WHERE ride=? AND revision=?)';
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO revisions(id,ride,manifest,bytes,ready,created) SELECT ?,?,?,?,1,? WHERE ${condition}`)
      .bind(revision,id,text,new TextEncoder().encode(text).length,Date.now(),id,body.base),
    env.DB.prepare(`INSERT OR IGNORE INTO revision_assets(revision,name,asset) SELECT ?,name,asset FROM revision_assets WHERE revision=? AND ${condition}`)
      .bind(revision,body.base,id,body.base),
    env.DB.prepare(`INSERT OR IGNORE INTO edit_safety(revision,needs_review) SELECT ?,? WHERE ${condition}`).bind(revision,needsReview,id,body.base),
    ...(verify ? [env.DB.prepare(`UPDATE edit_safety SET needs_review=0 WHERE revision=? AND ${condition}`).bind(revision,id,body.base)] : []),
    env.DB.prepare('UPDATE edit_heads SET revision=? WHERE ride=? AND revision=?').bind(revision,id,body.base)
  ]);
  const current = await editorialHead(env.DB,id);
  return current.revision === revision ? json(current) : json({error:'This ride changed elsewhere. Review both versions before saving.',current},409);
}
