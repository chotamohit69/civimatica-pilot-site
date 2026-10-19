// Shared Reactive State for Civimatica Pilot Dashboard

class DashboardState {
  constructor() {
    this.runs = [];
    this.currentRunId = null;
    this.scene = null;
    this.drive = null;
    this.rig = null;

    this.t = 0.0;
    this.duration = 1.0;
    this.isPlaying = false;
    this.playbackSpeed = 1;
    this.activeSection = 'street'; // Start on Street (centrepiece)
    this.cameraPreset = 'follow'; // 'follow' | 'orbit' | 'top'

    this.layers = {
      buildings: true,
      roads: true,
      foliage: true,
      parked: true,
      moving: true,
      signs: true,
      fov: true
    };

    this.selectedObject = null;
    this.listeners = {
      timeUpdate: [],
      sectionChange: [],
      dataLoaded: [],
      selectionChange: [],
      presetChange: [],
      layerChange: [],
      playStateChange: []
    };
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      for (const cb of this.listeners[event]) {
        try {
          cb(data);
        } catch (e) {
          console.error(`Error in event listener for ${event}:`, e && e.stack ? e.stack : e);
        }
      }
    }
  }

  setTime(t, notify = true) {
    const clamped = Math.max(0, Math.min(this.duration, t));
    this.t = clamped;
    if (notify) this.emit('timeUpdate', this.t);
  }

  setPlaying(val) {
    if (this.isPlaying !== val) {
      this.isPlaying = val;
      this.emit('playStateChange', this.isPlaying);
    }
  }

  togglePlay() {
    this.setPlaying(!this.isPlaying);
  }

  setSpeed(speed) {
    this.playbackSpeed = speed;
    this.emit('playStateChange', this.isPlaying);
  }

  setSection(sectionId) {
    if (this.activeSection !== sectionId) {
      this.activeSection = sectionId;
      this.emit('sectionChange', sectionId);
    }
  }

  setCameraPreset(preset) {
    this.cameraPreset = preset;
    this.emit('presetChange', preset);
  }

  toggleLayer(layerKey) {
    if (this.layers[layerKey] !== undefined) {
      this.layers[layerKey] = !this.layers[layerKey];
      this.emit('layerChange', { key: layerKey, val: this.layers[layerKey] });
    }
  }

  selectObject(obj) {
    this.selectedObject = obj;
    this.emit('selectionChange', obj);
  }

  setData(runs, scene, drive, rig) {
    this.runs = runs;
    this.scene = scene;
    this.drive = drive;
    this.rig = rig;
    if (drive && drive.duration_s) {
      this.duration = drive.duration_s;
    } else if (drive && drive.route && drive.route.t) {
      this.duration = drive.route.t[drive.route.t.length - 1] || 120.0;
    }
    this.emit('dataLoaded', { runs, scene, drive, rig });
  }

  // Interpolate ego pose [x, y, h, speed, streetName] at time t
  getEgoAt(t) {
    if (!this.drive || !this.drive.route || !this.drive.route.t) {
      return { x: 0, y: 0, h: 0, speed: 0, street: '' };
    }
    const r = this.drive.route;
    const ts = r.t;
    if (ts.length === 0) return { x: 0, y: 0, h: 0, speed: 0, street: '' };

    // Binary search for t in r.t
    let low = 0, high = ts.length - 1;
    if (t <= ts[0]) {
      const street = this.getStreetAt(ts[0]);
      return { x: r.x[0], y: r.y[0], h: r.h[0], speed: r.speed ? r.speed[0] : 0, street };
    }
    if (t >= ts[high]) {
      const street = this.getStreetAt(ts[high]);
      return { x: r.x[high], y: r.y[high], h: r.h[high], speed: r.speed ? r.speed[high] : 0, street };
    }

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (ts[mid] < t) low = mid + 1;
      else high = mid - 1;
    }
    const i0 = Math.max(0, low - 1);
    const i1 = Math.min(ts.length - 1, low);
    const dt = ts[i1] - ts[i0];
    const frac = dt > 0.0001 ? (t - ts[i0]) / dt : 0;

    const x = r.x[i0] + (r.x[i1] - r.x[i0]) * frac;
    const y = r.y[i0] + (r.y[i1] - r.y[i0]) * frac;

    // Angle interpolation (handle circular wrap around PI)
    let h0 = r.h[i0], h1 = r.h[i1];
    let dh = h1 - h0;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    const h = h0 + dh * frac;

    const spd0 = r.speed ? r.speed[i0] : 0;
    const spd1 = r.speed ? r.speed[i1] : 0;
    const speed = spd0 + (spd1 - spd0) * frac;

    const street = this.getStreetAt(t);
    return { x, y, h, speed, street };
  }

  getStreetAt(t) {
    if (!this.drive || !this.drive.streets) return '';
    for (const s of this.drive.streets) {
      if (t >= s.t0 && t <= s.t1) return s.name;
    }
    return this.drive.streets[0] ? this.drive.streets[0].name : '';
  }
}

export const state = new DashboardState();
