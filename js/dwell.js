// Parking dwell times for demonstration only. NOT measured: real dwell needs repeat passes
// (the same plate seen again later). Every UI that shows these values must label them "Demo".
// ponytail: deterministic fake derived from the track id; delete this module once the pipeline exports measured dwell.

// FNV-1a hash of the id -> [0, 1), so a car's demo dwell never changes between reloads or views.
function unit(id, salt) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

// Minutes the parked car has been there when the survey passed. Mix: 45 % short stays,
// 30 % 1-3 h, 25 % long stays (residents).
export function dwellMinutes(track) {
  const a = unit(track.id, 1);
  const b = unit(track.id, 2);
  if (a < 0.45) return Math.round(5 + b * 55);
  if (a < 0.75) return Math.round(60 + b * 120);
  return Math.round(180 + b * 420);
}

export const DWELL_BINS = [
  { lo: 0, hi: 30, label: '< 30 min' },
  { lo: 30, hi: 60, label: '30–60 min' },
  { lo: 60, hi: 120, label: '1–2 h' },
  { lo: 120, hi: 240, label: '2–4 h' },
  { lo: 240, hi: Infinity, label: '4 h +' }
];
