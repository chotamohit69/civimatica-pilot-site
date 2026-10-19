// Data loading and geometry/coordinate helpers

export function getSignFamily(cls) {
  if (!cls) return { family: 'other', color: '#9E9E9E', label: 'Other' };
  const c = cls.toLowerCase();
  if (c.includes('parking') || c.includes('paid') || c.includes('resident') || c.includes('disabled')) {
    return { family: 'parking', color: '#3D7BD9', label: 'Parking / Info' };
  }
  if (c.startsWith('no_') || c.startsWith('speed_limit') || c.startsWith('end_') || c.includes('prohibitory')) {
    return { family: 'prohibitory', color: '#D9483B', label: 'Prohibitory' };
  }
  if (c.startsWith('mandatory') || c.includes('roundabout') || c.includes('turn_right') || c.includes('turn_left')) {
    return { family: 'mandatory', color: '#2F6FDE', label: 'Mandatory' };
  }
  if (c.includes('curve') || c.includes('narrows') || c.includes('children') || c.includes('pedestrian') || c.includes('traffic_signals') || c.includes('give_way') || c.includes('warning') || c.includes('danger')) {
    return { family: 'warning', color: '#F2C14E', label: 'Warning' };
  }
  return { family: 'other', color: '#9E9E9E', label: 'Other / Info' };
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const remS = s % 60;
  return `${String(m).padStart(2, '0')}:${String(remS).padStart(2, '0')}`;
}

export async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return await res.json();
}

export async function loadPilotData() {
  const runs = await fetchJson('data/runs.json');
  const run = runs[0];
  const [scene, drive, rig] = await Promise.all([
    fetchJson(run.scene),
    fetchJson(run.drive),
    fetchJson('data/rig.json'),
  ]);
  return { runs, scene, drive, rig };
}
