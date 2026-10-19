// Drive data -> the one model every view reads (map, panel, drive-through).
import { dwellMinutes } from './dwell.js';

export const PARKING_SIGNS = new Set(['parking_sign', 'no_parking_sign', 'no_stopping_sign', 'disabled_parking_sign']);

export function signLabel(cls) {
  if (!cls) return 'Sign';
  const s = cls.replace(/_sign$/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatDuration(min) {
  if (min == null) return '–';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

export function formatClock(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

const median = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), n = s.length;
  return (s[(n - 1) >> 1] + s[n >> 1]) / 2;
};

export async function loadModel() {
  const runs = await (await fetch('data/runs.json')).json();
  const r = await fetch(runs[0].drive);
  if (!r.ok) throw new Error(`Failed to load ${runs[0].drive}`);
  const drive = await r.json();
  const origin = drive.origin;
  const kx = 1 / (111320 * Math.cos(origin.lat * Math.PI / 180)), ky = 1 / 110540;
  const toLngLat = (x, y) => [origin.lon + x * kx, origin.lat + y * ky];

  // Route, with cumulative distance for street lengths and the drive-through.
  const R = drive.route, n = R.t.length, lngLat = new Array(n), dist = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lngLat[i] = toLngLat(R.x[i], R.y[i]);
    if (i) dist[i] = dist[i - 1] + Math.hypot(R.x[i] - R.x[i - 1], R.y[i] - R.y[i - 1]);
  }
  const indexAt = t => {  // last route sample with time <= t
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (R.t[mid] <= t) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const distAt = t => dist[indexAt(t)];

  // Ego pose at drive time t: position interpolated between samples, bearing (deg clockwise from
  // north) from the motion over the surrounding ~10 m so it does not jitter at walking speed.
  const posAt = t => {
    const i = indexAt(t), j = Math.min(n - 1, i + 1);
    const f = j > i ? Math.min(1, Math.max(0, (t - R.t[i]) / (R.t[j] - R.t[i] || 1))) : 0;
    const x = R.x[i] + (R.x[j] - R.x[i]) * f, y = R.y[i] + (R.y[j] - R.y[i]) * f;
    let a = i, b = i;
    while (a > 0 && dist[i] - dist[a] < 5) a--;
    while (b < n - 1 && dist[b] - dist[i] < 5) b++;
    const dx = R.x[b] - R.x[a], dy = R.y[b] - R.y[a];
    return { lngLat: toLngLat(x, y), bearing: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360, speed: R.speed ? R.speed[i] : null, index: i };
  };

  // Map items: every sign track, every parked car and every other road user (bicycle,
  // motorcycle, bus, truck; all moving or unknown). Positions are estimates from one camera.
  const items = [];
  for (const tr of drive.tracks) {
    if (!tr.xy) continue;
    if (tr.kind === 'sign') {
      items.push({
        id: tr.id, kind: PARKING_SIGNS.has(tr.cls) ? 'parking-sign' : 'sign', cls: tr.cls,
        label: signLabel(tr.cls), street: tr.street, t0: tr.t0, lngLat: toLngLat(tr.xy[0], tr.xy[1]), score: tr.score
      });
    } else if (tr.kind === 'vehicle' && tr.cls === 'car' && tr.state === 'parked') {
      items.push({
        id: tr.id, kind: 'parked', cls: tr.cls, label: tr.street || 'Unnamed street', street: tr.street,
        t0: tr.t0, lngLat: toLngLat(tr.xy[0], tr.xy[1]), dwellMin: dwellMinutes(tr), score: tr.score
      });
    } else if (tr.kind === 'vehicle' && tr.cls !== 'car') {
      items.push({
        id: tr.id, kind: 'object', cls: tr.cls, label: signLabel(tr.cls), street: tr.street,
        t0: tr.t0, lngLat: toLngLat(tr.xy[0], tr.xy[1]), state: tr.state, score: tr.score
      });
    }
  }
  items.sort((a, b) => a.t0 - b.t0);

  // Streets: drive segments merged by name (out-and-back drives pass a street twice).
  const byName = new Map();
  for (const s of drive.streets || []) {
    let st = byName.get(s.name);
    if (!st) byName.set(s.name, st = { name: s.name, t0: s.t0, t1: s.t1, segments: [], lengthM: 0 });
    st.segments.push([s.t0, s.t1]);
    st.t0 = Math.min(st.t0, s.t0); st.t1 = Math.max(st.t1, s.t1);
    st.lengthM += distAt(s.t1) - distAt(s.t0);
  }
  const streets = [...byName.values()].map(st => {
    const own = items.filter(it => it.street === st.name);
    const parked = own.filter(it => it.kind === 'parked');
    const mid = posAt((st.segments[0][0] + st.segments[0][1]) / 2).lngLat;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const [a, b] of st.segments) for (let i = indexAt(a), e = indexAt(b); i <= e; i++) {
      const [lng, lat] = lngLat[i];
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }
    return {
      ...st,
      signs: own.filter(it => it.kind === 'sign' || it.kind === 'parking-sign').length,
      parkingSigns: own.filter(it => it.kind === 'parking-sign').length,
      parked: parked.length,
      objects: own.filter(it => it.kind === 'object').length,
      medianDwellMin: median(parked.map(p => p.dwellMin)),
      lngLat: mid,
      bounds: [[minLng, minLat], [maxLng, maxLat]]
    };
  }).sort((a, b) => a.t0 - b.t0);

  const parked = items.filter(it => it.kind === 'parked');
  const objects = items.filter(it => it.kind === 'object').length;
  return {
    title: drive.title,
    city: 'Milan',
    durationS: drive.duration_s,
    origin,
    route: { lngLat, t: R.t, dist },
    posAt,
    distAt,
    streets,
    items,
    kpis: {
      signs: items.length - parked.length - objects,
      parked: parked.length,
      objects,
      medianDwellMin: median(parked.map(p => p.dwellMin)),
      routeKm: dist[n - 1] / 1000
    },
    cameras: drive.cameras,  // [{id, name, yaw_deg, hfov_deg, in_run}]
    platesKeptParked: drive.stats.counts.plates_kept_parked,
    privacy: drive.privacy,
    stats: drive.stats
  };
}
