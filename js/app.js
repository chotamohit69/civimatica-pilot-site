// App entry point for Milan Pilot Dashboard
import { loadModel, formatClock, formatDuration } from './data.js';
import { createMap } from './mapview.js';
import { createPanel, ICON } from './panel.js';

const MAPBOX_TOKEN = 'pk.eyJ1IjoiaGFyc2gyMjMiLCJhIjoiY212MTExNGFlMDEwazJ4c2d2MGh0bDFnOCJ9.6UW5u88lDw-uW1T_9oV6jw';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function init() {
  const loadingEl = document.getElementById('state-loading');
  const errorEl = document.getElementById('state-error');
  const mapContainer = document.getElementById('map');
  const panelEl = document.getElementById('panel');
  const detailEl = document.getElementById('detail');

  let model;
  try {
    model = await loadModel();
  } catch (err) {
    console.error('Failed to load drive model:', err);
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) errorEl.hidden = false;
    return;
  }

  // Pre-index items and streets for fast lookup
  const itemById = new Map(model.items.map(it => [it.id, it]));
  const streetByName = new Map(model.streets.map(st => [st.name, st]));

  // App state
  let selectedId = null;
  let focusedStreet = null;

  // Drive state
  let driveActive = false;
  let drivePlaying = false;
  let driveT = 0;
  let driveSpeed = 1;
  let driveFollow = true;
  let lastFrameTime = null;
  let lastPanelUpdateMs = 0;

  // Incremental seen counters
  let seenIdx = 0;
  const seenCounters = { signs: 0, parkingSigns: 0, parked: 0, objects: 0 };

  function resetSeenCounters() {
    seenIdx = 0;
    seenCounters.signs = 0;
    seenCounters.parkingSigns = 0;
    seenCounters.parked = 0;
    seenCounters.objects = 0;
  }

  function advanceSeenCounters(targetT) {
    if (targetT < (seenIdx > 0 ? model.items[seenIdx - 1]?.t0 : 0)) {
      resetSeenCounters();
    }
    while (seenIdx < model.items.length && model.items[seenIdx].t0 <= targetT) {
      const it = model.items[seenIdx];
      if (it.kind === 'sign') seenCounters.signs++;
      else if (it.kind === 'parking-sign') seenCounters.parkingSigns++;
      else if (it.kind === 'parked') seenCounters.parked++;
      else if (it.kind === 'object') seenCounters.objects++;
      seenIdx++;
    }
  }

  function getStreetAt(t) {
    for (const s of model.streets) {
      for (const seg of (s.segments || [])) {
        if (t >= seg[0] && t <= seg[1]) return s.name;
      }
      if (t >= s.t0 && t <= s.t1) return s.name;
    }
    return null;
  }

  // Forward declarations
  let mapApi = null;
  let panelApi = null;

  function selectItem(id, updateHash = true) {
    selectedId = id;
    if (id) {
      focusedStreet = null;
      if (updateHash) {
        history.replaceState(null, '', `#item=${encodeURIComponent(id)}`);
      }
    } else {
      if (location.hash.startsWith('#item=')) {
        history.replaceState(null, '', location.pathname + location.search);
      }
    }

    mapApi?.select(id);
    panelApi?.select(id);
    renderDetailBar();
  }

  function focusStreet(name) {
    focusedStreet = name;
    selectedId = null;
    mapApi?.select(null);
    panelApi?.select(null);
    mapApi?.focusStreet(name);
    panelApi?.setStreet(name);
    renderDetailBar();
  }

  function startDriveAt(t) {
    // The tab switch calls onDriveStart(scrubber value); set the target time after it.
    document.getElementById('tab-drive')?.click();
    driveActive = true;
    drivePlaying = true;
    driveT = Math.max(0, Math.min(model.durationS, t));
    lastFrameTime = performance.now();
    mapApi?.setDrive(driveT);
    mapApi?.setFollow(driveFollow);
    pushDriveStateToPanel();
  }

  function renderDetailBar() {
    if (!selectedId && !focusedStreet) {
      detailEl.hidden = true;
      detailEl.innerHTML = '';
      return;
    }

    detailEl.hidden = false;

    // Case 1: An item is selected
    if (selectedId) {
      const item = itemById.get(selectedId);
      if (!item) {
        detailEl.hidden = true;
        return;
      }

      let icoClass = 'domain-access';
      let icoGlyph = ICON.sign;
      let title = item.label || 'Sign';
      let tagText = 'TRAFFIC SIGN';
      let tagClass = '';
      let subLine = `${item.street || 'Street not read'} · seen ${formatClock(item.t0)} · position estimated`;
      let valHtml = `${Math.round((item.score || 0.9) * 100)}%<small>confidence</small>`;

      if (item.kind === 'parked') {
        icoClass = 'domain-parking';
        icoGlyph = 'P';
        title = item.street || 'Unnamed street';
        tagText = 'DEMO DWELL';
        tagClass = 'watch';
        subLine = `Parked car · seen ${formatClock(item.t0)} into the drive · position estimated`;
        valHtml = `${formatDuration(item.dwellMin)}<small>Demo dwell</small>`;
      } else if (item.kind === 'parking-sign') {
        icoClass = 'domain-waste';
        icoGlyph = ICON.parkingSign;
        tagText = 'PARKING RULE';
        tagClass = 'attention';
        valHtml = `${Math.round((item.score || 0.9) * 100)}%<small>confidence</small>`;
      } else if (item.kind === 'object') {
        icoClass = 'domain-object';
        icoGlyph = ICON.object;
        tagText = item.state === 'moving' ? 'MOVING' : 'UNKNOWN STATE';
        tagClass = 'clear';
        valHtml = `${Math.round((item.score || 0.9) * 100)}%<small>confidence</small>`;
      }

      detailEl.innerHTML = `
        <span class="ico lg ${icoClass}" aria-hidden="true">${icoGlyph}</span>
        <div class="detail-copy">
          <strong>
            <span>${escapeHtml(title)}</span>
            <em class="${tagClass}">${tagText}</em>
          </strong>
          <span>${escapeHtml(subLine)}</span>
        </div>
        <div class="detail-val">${valHtml}</div>
        <button type="button" class="resolve" id="detail-drive-btn">Drive here</button>
        <button type="button" class="x" id="detail-close-btn" aria-label="Close detail">×</button>
      `;

      detailEl.querySelector('#detail-drive-btn').addEventListener('click', () => {
        startDriveAt(Math.max(0, item.t0 - 8));
      });
      detailEl.querySelector('#detail-close-btn').addEventListener('click', () => {
        selectItem(null);
      });
      return;
    }

    // Case 2: A street is focused
    if (focusedStreet) {
      const st = streetByName.get(focusedStreet);
      if (!st) {
        detailEl.hidden = true;
        return;
      }

      const subLine = `${st.signs} signs · ${st.parked} parked · ${Math.round(st.lengthM)} m`;
      const valHtml = st.parked > 0
        ? `${formatDuration(st.medianDwellMin)}<small>Demo median</small>`
        : `–<small>No parked cars</small>`;

      detailEl.innerHTML = `
        <span class="ico lg domain-parking" aria-hidden="true">${ICON.street}</span>
        <div class="detail-copy">
          <strong>
            <span>${escapeHtml(st.name)}</span>
            <em>STREET OVERVIEW</em>
          </strong>
          <span>${escapeHtml(subLine)}</span>
        </div>
        <div class="detail-val">${valHtml}</div>
        <button type="button" class="resolve" id="detail-drive-btn">Drive here</button>
        <button type="button" class="x" id="detail-close-btn" aria-label="Close detail">×</button>
      `;

      detailEl.querySelector('#detail-drive-btn').addEventListener('click', () => {
        startDriveAt(Math.max(0, st.t0 - 4));
      });
      detailEl.querySelector('#detail-close-btn').addEventListener('click', () => {
        focusStreet(null);
      });
    }
  }

  function pushDriveStateToPanel() {
    advanceSeenCounters(driveT);

    const pose = model.posAt(driveT);
    const speedKmh = Math.round(pose.speed * 3.6);
    const street = getStreetAt(driveT);

    // 6 most recent detections with t0 <= driveT
    const recent = model.items.slice(Math.max(0, seenIdx - 6), seenIdx).reverse();

    panelApi?.setDrive({
      t: driveT,
      playing: drivePlaying,
      speed: driveSpeed,
      follow: driveFollow,
      street,
      speedKmh,
      seen: { ...seenCounters },
      recent
    });
  }

  // Animation frame loop for drive playback
  function driveLoop(now) {
    if (lastFrameTime == null) lastFrameTime = now;
    const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;

    if (driveActive && drivePlaying) {
      driveT += dt * driveSpeed;
      if (driveT >= model.durationS) {
        driveT = model.durationS;
        drivePlaying = false;
      }

      mapApi?.setDrive(driveT);

      if (now - lastPanelUpdateMs > 150) {
        lastPanelUpdateMs = now;
        pushDriveStateToPanel();
      }
    }

    requestAnimationFrame(driveLoop);
  }
  requestAnimationFrame(driveLoop);

  // Keyboard controls
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (selectedId || focusedStreet) {
        selectItem(null);
        focusStreet(null);
      }
    } else if (e.code === 'Space') {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      if (driveActive) {
        e.preventDefault();
        drivePlaying = !drivePlaying;
        lastFrameTime = performance.now();
        pushDriveStateToPanel();
      }
    }
  });

  // Pause playback when tab is backgrounded
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && drivePlaying) {
      drivePlaying = false;
      pushDriveStateToPanel();
    }
  });

  // Handlers for Panel
  const panelHandlers = {
    onSelect(id) {
      selectItem(id);
    },
    onFilter(kindsSet) {
      mapApi?.setFilter(kindsSet);
    },
    onStreet(name) {
      focusStreet(name);
    },
    onDriveStart(t) {
      driveActive = true;
      driveT = t ?? driveT;
      mapApi?.setDrive(driveT);
      mapApi?.setFollow(driveFollow);
      pushDriveStateToPanel();
    },
    onDriveToggle() {
      drivePlaying = !drivePlaying;
      lastFrameTime = performance.now();
      pushDriveStateToPanel();
    },
    onDriveSeek(t) {
      driveT = t;
      mapApi?.setDrive(driveT);
      pushDriveStateToPanel();
    },
    onDriveSpeed(x) {
      driveSpeed = x;
      pushDriveStateToPanel();
    },
    onFollow(bool) {
      driveFollow = bool;
      mapApi?.setFollow(bool);
    },
    onDriveExit() {
      driveActive = false;
      drivePlaying = false;
      mapApi?.setDrive(null);
      panelApi?.setDrive(null);
    },
    onReset() {
      driveActive = false;
      drivePlaying = false;
      selectItem(null, false);
      focusStreet(null);
      mapApi?.setDrive(null);
      mapApi?.focusStreet(null);
      mapApi?.setFilter(new Set(['parked', 'parking-sign', 'sign', 'object']));
      panelApi?.setDrive(null);
      history.replaceState(null, '', location.pathname + location.search);
    }
  };

  // Handlers for Map
  const mapOptions = {
    token: MAPBOX_TOKEN,
    onSelect(id) {
      selectItem(id);
    },
    onStreet(name) {
      focusStreet(name);
    },
    onFollowChange(bool) {
      driveFollow = bool;
      pushDriveStateToPanel();
    }
  };

  // Initialize Map and Panel
  mapApi = createMap(mapContainer, model, mapOptions);
  panelApi = createPanel(panelEl, model, panelHandlers);

  // Await map style + layers load
  await mapApi.ready;

  // Hide loading overlay
  if (loadingEl) loadingEl.hidden = true;

  // Hash state navigation
  if (location.hash === '#drive') {
    const driveTabBtn = document.getElementById('tab-drive');
    driveTabBtn?.click();
  } else if (location.hash.startsWith('#item=')) {
    const rawId = decodeURIComponent(location.hash.slice(6));
    if (itemById.has(rawId)) {
      selectItem(rawId, false);
    }
  }
}

// Boot on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
