// Breaks contain only reviewed route coordinates and durations, never raw timestamps.
export function visibleStops(stops = [], route = []) {
  const visible = new Set(route.flat().map(p => JSON.stringify(p)));
  return stops.filter(s => visible.has(JSON.stringify(s.point)));
}
export function validateStops(m) {
  if (m.stops === undefined) return;
  if (!Array.isArray(m.stops) || m.stops.length > 1000) throw Error('Too many break markers');
  let duration = 0;
  for (const s of m.stops) {
    if (!s || Object.keys(s).some(k => !['point','durationMs'].includes(k)) || !Array.isArray(s.point) || s.point.length !== 2
      || !Number.isSafeInteger(s.durationMs) || s.durationMs < 0 || s.durationMs > 1e12) throw Error('Invalid break marker');
    duration += s.durationMs;
  }
  if (m.stops.length && (!m.privacy.statsIncluded || !Number.isSafeInteger(m.stats.pausedMs)
      || duration > m.stats.pausedMs || visibleStops(m.stops, m.route).length !== m.stops.length)) {
    throw Error('Breaks must remain on the reviewed route and fit within paused time');
  }
}
