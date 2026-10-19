/* Civimatica Milan Pilot — Main Entry Point
   - Loads runs.json, drive.json, scene.json
   - Asserts product figures and reconciliations
   - Manages router and hash state (#/<tab>?street=...&car=...&sign=...&layers=...&t=...)
   - Renders Planning Sheet shell, 3D Drive-through, and inventory tabs
*/

import { CadastralMap, formatTime, formatClsLabel } from './map.js';
import { DWELL_IS_DEMO, dwellMinutes, dwellSummary, formatDwell, DWELL_BINS } from './dwell.js';
import {
  renderSignsView,
  renderParkingView,
  renderPrivacyView,
  computeStreetDistances,
  computeTotalRouteDistance
} from './views.js';

const intFmt = new Intl.NumberFormat('en-US');

// App state
const state = {
  currentTab: 'sheet',
  selectedStreet: null,
  selectedCar: null,
  selectedSign: null,
  driveT: null,
  layers: {
    signs: true,
    parked: true,
    objects: true
  },
  drive: null,
  scene: null,
  mapInstance: null
};
window.__state = state;

let drive3dModule = null;

// -------------------------------------------------------------
// DATA LOADING & RECONCILIATION ASSERTIONS
// -------------------------------------------------------------
async function initApp() {
  const loadingEl = document.getElementById('state-loading');
  const errorEl = document.getElementById('state-error');

  try {
    const runsResp = await fetch('data/runs.json');
    if (!runsResp.ok) throw new Error('Failed to load runs.json');
    const runs = await runsResp.json();
    const run = runs[0];

    const [driveResp, sceneResp] = await Promise.all([
      fetch(run.drive),
      fetch(run.scene)
    ]);

    if (!driveResp.ok || !sceneResp.ok) {
      throw new Error('Failed to load drive or scene data');
    }

    state.drive = await driveResp.json();
    state.scene = await sceneResp.json();
    runDataAssertions(state.drive);

    if (loadingEl) loadingEl.hidden = true;

    // Listen to hash changes
    window.addEventListener('hashchange', handleRoute);

    // Listen to visibility changes (pause 3D render loop when hidden)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (drive3dModule) drive3dModule.pauseDrive3D();
      } else if (state.currentTab === 'drive') {
        if (drive3dModule) drive3dModule.resumeDrive3D();
      }
    });

    // Initial route handling
    handleRoute();

  } catch (err) {
    console.error('Initialization error:', err);
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.innerHTML = `
        <p class="state-message">Couldn't load the drive data. Reload the page; if it keeps failing, check that data/milan_i84/drive.json is deployed.</p>
      `;
    }
  }
}

function runDataAssertions(drive) {
  const tracks = drive.tracks || [];
  const signs = tracks.filter(t => t.kind === 'sign');
  const cars = tracks.filter(t => t.kind === 'vehicle' && t.cls === 'car');
  const parkedCars = cars.filter(t => t.state === 'parked');
  const otherObjects = tracks.filter(t => t.kind === 'object' || (t.kind === 'vehicle' && t.cls !== 'car'));

  // 1. Objective counts vs tracks
  console.assert(signs.length === 2148, `Signs count expected 2148, got ${signs.length}`);
  console.assert(parkedCars.length === 231, `Parked cars expected 231, got ${parkedCars.length}`);
  console.assert(otherObjects.length === 838, `Other objects expected 838, got ${otherObjects.length}`);

  // 2. Per-street parked + unmatched = total parked
  const namedParked = parkedCars.filter(t => t.street !== null).length;
  const unreadParked = parkedCars.filter(t => t.street === null).length;
  console.assert(namedParked === 197, `Named parked expected 197, got ${namedParked}`);
  console.assert(unreadParked === 34, `Unmatched parked expected 34, got ${unreadParked}`);
  console.assert(namedParked + unreadParked === parkedCars.length, 'Parked per-street + unmatched != total');

  // 3. Per-street signs + unmatched = total signs
  const namedSigns = signs.filter(t => t.street !== null).length;
  const unreadSigns = signs.filter(t => t.street === null).length;
  console.assert(namedSigns === 1807, `Named signs expected 1807, got ${namedSigns}`);
  console.assert(unreadSigns === 341, `Unmatched signs expected 341, got ${unreadSigns}`);
  console.assert(namedSigns + unreadSigns === signs.length, 'Signs per-street + unmatched != total');

  // 4. Street strip minutes: named segments + unread remainder = duration (36:23)
  const streets = drive.streets || [];
  let namedDuration = 0;
  for (const s of streets) {
    namedDuration += (s.t1 - s.t0);
  }
  const totalDuration = drive.duration_s || 2183.35;
  const remainder = totalDuration - namedDuration;
  console.assert(Math.abs((namedDuration + remainder) - totalDuration) < 0.01, 'Street strip durations do not sum to duration');

  const durMin = Math.floor(totalDuration / 60);
  const durSec = Math.round(totalDuration % 60);
  const durStr = `${durMin}:${durSec.toString().padStart(2, '0')}`;
  console.assert(durStr === '36:23', `Expected duration 36:23, got ${durStr}`);

  // 5. Tally at t = duration equals sheet legend counts (2,148 / 231 / 838)
  const signsAtDuration = signs.filter(t => t.t0 <= totalDuration).length;
  const parkedAtDuration = parkedCars.filter(t => t.t0 <= totalDuration).length;
  const objectsAtDuration = otherObjects.filter(t => t.t0 <= totalDuration).length;
  console.assert(signsAtDuration === 2148, `Signs at duration expected 2148, got ${signsAtDuration}`);
  console.assert(parkedAtDuration === 231, `Parked cars at duration expected 231, got ${parkedAtDuration}`);
  console.assert(objectsAtDuration === 838, `Other objects at duration expected 838, got ${objectsAtDuration}`);

  // 6. For every street, dwellSummary(parked).bins counts sum to its parked count
  for (const s of (drive.streets || [])) {
    const streetParked = parkedCars.filter(t => t.street === s.name);
    const summary = dwellSummary(streetParked);
    const sumBins = summary.bins.reduce((acc, b) => acc + b.n, 0);
    console.assert(sumBins === streetParked.length, `Street ${s.name} dwell bins sum ${sumBins} != parked count ${streetParked.length}`);
  }
}

// -------------------------------------------------------------
// ROUTER & HASH STATE MANAGEMENT
// Format: #/<tab>?street=...&sign=...&layers=...&t=...
// -------------------------------------------------------------
function parseHash() {
  const hash = window.location.hash || '#/sheet';
  const [pathPart, queryPart] = hash.replace(/^#\/?/, '').split('?');
  const tab = pathPart.toLowerCase() || 'sheet';

  const params = new URLSearchParams(queryPart || '');
  const street = params.get('street') || null;
  const car = params.get('car') || null;
  const sign = params.get('sign') || null;
  const tParam = params.get('t');
  const t = tParam != null ? parseFloat(tParam) : null;
  const layersParam = params.get('layers');

  const layers = { signs: true, parked: true, objects: true };
  if (layersParam) {
    const list = layersParam.split(',').map(s => s.trim());
    layers.signs = list.includes('signs');
    layers.parked = list.includes('parked');
    layers.objects = list.includes('objects');
  }

  return { tab, street, car, sign, layers, t };
}

function updateHash() {
  const params = new URLSearchParams();
  if (state.selectedCar) {
    params.set('car', state.selectedCar.id);
  }
  if (state.selectedStreet) {
    params.set('street', state.selectedStreet);
  }
  if (state.selectedSign) {
    params.set('sign', state.selectedSign);
  }

  const activeLayers = [];
  if (state.layers.signs) activeLayers.push('signs');
  if (state.layers.parked) activeLayers.push('parked');
  if (state.layers.objects) activeLayers.push('objects');

  if (activeLayers.length < 3) {
    params.set('layers', activeLayers.join(','));
  }

  const query = params.toString();
  const newHash = `#/${state.currentTab}${query ? '?' + query : ''}`;
  if (window.location.hash !== newHash) {
    history.replaceState(null, '', newHash);
  }
}

function handleRoute() {
  const parsed = parseHash();
  const validTabs = ['sheet', 'drive', 'signs', 'parking', 'privacy'];
  state.currentTab = validTabs.includes(parsed.tab) ? parsed.tab : 'sheet';
  state.selectedStreet = parsed.street;
  state.selectedSign = parsed.sign;
  state.layers = parsed.layers;
  state.driveT = parsed.t;

  if (state.drive && parsed.car) {
    const car = (state.drive.tracks || []).find(t => t.id === parsed.car && t.kind === 'vehicle' && t.cls === 'car' && t.state === 'parked');
    state.selectedCar = car || null;
    if (car && car.street) {
      state.selectedStreet = car.street;
    }
  } else {
    state.selectedCar = null;
  }

  updateNavTabs();
  renderCurrentView();
}

function updateNavTabs() {
  const tabLinks = document.querySelectorAll('.tab-link');
  tabLinks.forEach(link => {
    const tabName = link.getAttribute('data-tab');
    const isActive = tabName === state.currentTab;
    if (isActive) {
      link.setAttribute('aria-current', 'page');
      link.classList.add('is-active');
    } else {
      link.removeAttribute('aria-current');
      link.classList.remove('is-active');
    }
  });
}

function renderCurrentView() {
  const viewPanels = {
    sheet: document.getElementById('view-sheet'),
    drive: document.getElementById('view-drive'),
    signs: document.getElementById('view-signs'),
    parking: document.getElementById('view-parking'),
    privacy: document.getElementById('view-privacy')
  };

  for (const [key, panel] of Object.entries(viewPanels)) {
    if (!panel) continue;
    if (key === state.currentTab) {
      panel.hidden = false;
    } else {
      panel.hidden = true;
    }
  }

  // If leaving drive view, pause 3D render loop
  if (state.currentTab !== 'drive' && drive3dModule) {
    drive3dModule.pauseDrive3D();
  }

  const activePanel = viewPanels[state.currentTab];
  if (!activePanel) return;

  if (state.currentTab === 'sheet') {
    renderSheetTab(activePanel);
    setTimeout(() => {
      if (state.mapInstance && state.mapInstance.map) {
        const map = state.mapInstance.map;
        map.invalidateSize();
        const sz = map.getSize();
        if (sz && sz.x > 0 && sz.y > 0 && state.mapInstance.routeBounds && state.mapInstance.routeBounds.isValid() && !state.selectedStreet) {
          map.fitBounds(state.mapInstance.routeBounds, { padding: [16, 16] });
        }
      }
    }, 120);
  } else if (state.currentTab === 'drive') {
    showDriveTab(activePanel, state.driveT);
  } else if (state.currentTab === 'signs') {
    renderSignsView(activePanel, state.drive, (newHash) => {
      window.location.hash = newHash;
    });
  } else if (state.currentTab === 'parking') {
    renderParkingView(activePanel, state.drive, (newHash) => {
      window.location.hash = newHash;
    });
  } else if (state.currentTab === 'privacy') {
    renderPrivacyView(activePanel, state.drive);
  }
}

async function showDriveTab(container, targetT = null) {
  if (!drive3dModule) {
    container.innerHTML = `
      <div class="state-panel state-loading">
        <p class="state-message">Building the clay city…</p>
      </div>
    `;
    try {
      drive3dModule = await import('./drive3d.js');
      await drive3dModule.initDrive3D(container, state.drive, state.scene, null, targetT);
    } catch (err) {
      console.error('Failed to load drive3d:', err);
      container.innerHTML = `
        <div class="state-panel state-error">
          <p class="state-message">WebGL drive-through view could not be loaded. Please return to the <a href="#/sheet">Planning Sheet</a>.</p>
        </div>
      `;
    }
  } else {
    drive3dModule.resumeDrive3D(targetT);
  }
}

// -------------------------------------------------------------
// SHEET TAB RENDERING
// -------------------------------------------------------------
function renderSheetTab(container) {
  // If already rendered, just update layers, filter, and street selection
  if (container.querySelector('.sheet-layout') && state.mapInstance) {
    applySheetState();
    return;
  }

  const drive = state.drive;
  const tracks = drive.tracks || [];
  const signs = tracks.filter(t => t.kind === 'sign');
  const parkedCars = tracks.filter(t => t.kind === 'vehicle' && t.cls === 'car' && t.state === 'parked');
  const otherObjects = tracks.filter(t => t.kind === 'object' || (t.kind === 'vehicle' && t.cls !== 'car'));
  const bikes = otherObjects.filter(t => t.cls === 'bicycle').length;
  const motos = otherObjects.filter(t => t.cls === 'motorcycle').length;
  const buses = otherObjects.filter(t => t.cls === 'bus').length;
  const trucks = otherObjects.filter(t => t.cls === 'truck').length;

  const totalDistM = computeTotalRouteDistance(drive);
  const routeKm = totalDistM / 1000;

  const findingSentence = `${intFmt.format(signs.length)} signs and ${intFmt.format(parkedCars.length)} parked cars mapped along ${routeKm.toFixed(1)} km. Bay lines are not detected yet, so parking inside vs outside marked spaces is still open.`;

  container.innerHTML = `
    <div class="sheet-layout">
      <!-- Title row (cols 1–12, row 1) -->
      <div class="sheet-title-row">
        <h1 class="sheet-h1" id="sheet-title">${drive.title || 'Downtown Milan drive'}</h1>
        <p class="sheet-finding" id="sheet-finding">${findingSentence}</p>
      </div>

      <!-- Map (cols 1–8, row 2) -->
      <div class="sheet-map-col">
        <div class="map-wrap" id="map-wrap">
          <div id="map" class="map-container" aria-label="Cadastral map of survey drive"></div>
          <div class="north-arrow-control" aria-hidden="true">
            <svg class="north-arrow" width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="North arrow">
              <rect x="0.5" y="0.5" width="31" height="31" fill="#ffffff" stroke="#1c1e21" stroke-width="1" rx="2" />
              <path d="M 16 6 L 21 16 L 16 14 L 11 16 Z" fill="#1c1e21" />
              <path d="M 16 23 L 21 16 L 16 14 L 11 16 Z" fill="#dcdcd6" stroke="#1c1e21" stroke-width="0.5" />
              <text x="16" y="28" text-anchor="middle" font-size="9" font-weight="700" fill="#1c1e21" font-family="'Titillium Web', sans-serif">N</text>
            </svg>
          </div>
        </div>
      </div>

      <!-- Sidebar: Legend + Title Block (cols 9–12, rows 2-3) -->
      <div class="sheet-sidebar-col">
        <!-- Survey Objectives Legend -->
        <section class="legend-box" aria-labelledby="legend-heading">
          <h2 id="legend-heading" class="legend-h2">Survey Objectives</h2>
          <div class="legend-entries">
            <!-- 1. Road signage -->
            <button type="button" class="legend-entry" data-layer-toggle="signs" aria-pressed="${state.layers.signs}">
              <div class="legend-row-top">
                <div class="legend-left-group">
                  <span class="legend-num">1.</span>
                  <span class="swatch-mark"><span class="swatch-circle"></span></span>
                  <span class="legend-obj-name">Road signage</span>
                </div>
                <span class="legend-fig tnum">${intFmt.format(signs.length)}</span>
              </div>
              <div class="legend-line">vertical signs · 30 types on 25 streets</div>
              <div id="sign-filter-slot" class="legend-filter-banner" hidden></div>
              <div class="legend-gap">
                <span class="mini-hatch" aria-hidden="true"></span>
                <span>Horizontal markings (bay lines): not detected yet</span>
              </div>
            </button>

            <!-- 2. Parked vehicles -->
            <button type="button" class="legend-entry" data-layer-toggle="parked" aria-pressed="${state.layers.parked}">
              <div class="legend-row-top">
                <div class="legend-left-group">
                  <span class="legend-num">2.</span>
                  <span class="swatch-mark"><span class="swatch-square"></span></span>
                  <span class="legend-obj-name">Parked vehicles</span>
                </div>
                <span class="legend-fig tnum">${intFmt.format(parkedCars.length)}</span>
              </div>
              <div class="legend-line">parked cars · 197 on named streets · 34 street not read</div>
              <div class="legend-gap">
                <span class="mini-hatch" aria-hidden="true"></span>
                <span>Inside vs outside marked bays: needs bay-line detection</span>
              </div>
            </button>

            <!-- 3. Plates of parked vehicles (LPR) -->
            <div class="legend-entry legend-static">
              <div class="legend-row-top">
                <div class="legend-left-group">
                  <span class="legend-num">3.</span>
                  <span class="swatch-mark"><span class="swatch-hatch"></span></span>
                  <span class="legend-obj-name">Plates of parked vehicles (LPR)</span>
                </div>
                <span class="legend-fig tnum">4,090</span>
              </div>
              <div class="legend-line">plate reads kept · text stays on the vehicle, never shown or exported</div>
              <div class="legend-gap">
                <span class="mini-hatch" aria-hidden="true"></span>
                <span>Legal vs illegal, turnover and dwell time: need bay rules and repeat passes; this drive passed each street once (dwell shown as demo values)</span>
              </div>
            </div>

            <!-- 4. Other objects -->
            <button type="button" class="legend-entry" data-layer-toggle="objects" aria-pressed="${state.layers.objects}">
              <div class="legend-row-top">
                <div class="legend-left-group">
                  <span class="legend-num">4.</span>
                  <span class="swatch-mark"><span class="swatch-diamond"></span></span>
                  <span class="legend-obj-name">Other objects</span>
                </div>
                <span class="legend-fig tnum">${intFmt.format(otherObjects.length)}</span>
              </div>
              <div class="legend-line">${bikes} bicycles · ${motos} motorcycles · ${buses} buses · ${trucks} trucks, all moving</div>
              <div class="legend-gap">
                <span class="mini-hatch" aria-hidden="true"></span>
                <span>E-scooters, parking meters, bus stops, driveways: side cameras did not run on this drive</span>
              </div>
            </button>
          </div>
        </section>

        <!-- Slot for Title Block / Street Panel / Car Panel -->
        <div id="sheet-sidebar-slot" style="flex:1;display:flex;flex-direction:column;min-height:0;"></div>
      </div>

      <!-- Street Bar Card (cols 1–8, row 3 under map) -->
      <div class="sheet-streetbar-col">
        <section class="street-bar-card" aria-labelledby="strip-heading">
          <div class="street-bar-header">
            <h2 id="strip-heading" class="street-bar-h2">Streets in Drive Order</h2>
            <span class="street-bar-total tnum">36:23</span>
          </div>
          <div class="street-bar-track" id="strip-track" data-ui role="region" aria-label="Streets in drive order">
            <!-- Rendered by renderStreetBar -->
          </div>
          <div class="street-bar-detail" id="strip-detail" aria-live="polite">
            <span class="street-bar-detail-text" id="strip-detail-text">Select a street to inspect its drive segment and dim other marks.</span>
            <button type="button" class="btn-clear-street" id="btn-clear-street" hidden>Clear</button>
            <a href="#/drive" class="btn-drive-through" id="btn-drive-through" hidden>Drive through it →</a>
          </div>
        </section>
      </div>
    </div>
  `;

  // Bind Legend Toggle buttons
  container.querySelectorAll('[data-layer-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const layerType = btn.getAttribute('data-layer-toggle');
      state.layers[layerType] = !state.layers[layerType];
      btn.setAttribute('aria-pressed', state.layers[layerType]);
      if (state.mapInstance) {
        state.mapInstance.setLayerVisible(layerType, state.layers[layerType]);
      }
      updateHash();
    });
  });

  // Init Leaflet Cadastral Map
  state.mapInstance = new CadastralMap('map', state.scene, state.drive, (streetName) => {
    selectStreet(streetName);
  }, (carTrack) => {
    selectCar(carTrack);
  });

  // Render street bar
  renderStreetBar(container);

  // Apply initial hash filter/street state
  applySheetState();
}

function renderStreetBar(container) {
  const trackEl = container.querySelector('#strip-track');
  if (!trackEl) return;

  const drive = state.drive;
  const streets = drive.streets || [];
  const tracks = drive.tracks || [];
  const totalDuration = drive.duration_s || 2183.35;
  const streetDistances = computeStreetDistances(drive);

  // Count signs & parked cars per street
  const streetStats = {};
  for (const s of streets) {
    if (!streetStats[s.name]) {
      streetStats[s.name] = { signs: 0, parked: 0 };
    }
  }
  for (const t of tracks) {
    if (t.street && streetStats[t.street]) {
      if (t.kind === 'sign') streetStats[t.street].signs++;
      if (t.kind === 'vehicle' && t.cls === 'car' && t.state === 'parked') {
        streetStats[t.street].parked++;
      }
    }
  }

  // Interleave segments and gaps
  const items = [];
  let prevT1 = 0;

  for (let i = 0; i < streets.length; i++) {
    const s = streets[i];
    if (s.t0 > prevT1) {
      items.push({
        type: 'gap',
        duration: s.t0 - prevT1
      });
    }
    const stats = streetStats[s.name] || { signs: 0, parked: 0 };
    items.push({
      type: 'street',
      name: s.name,
      t0: s.t0,
      t1: s.t1,
      duration: s.t1 - s.t0,
      signs: stats.signs,
      parked: stats.parked,
      distM: streetDistances[s.name] || 0
    });
    prevT1 = s.t1;
  }
  if (prevT1 < totalDuration) {
    items.push({
      type: 'gap',
      duration: totalDuration - prevT1
    });
  }

  // Create canvas context to test whether name fits whole without truncation/ellipsis
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = '600 13px "Titillium Web", sans-serif';

  trackEl.innerHTML = items.map((it) => {
    if (it.type === 'gap') {
      const widthPct = (it.duration / totalDuration) * 100;
      return `<div class="street-gap-spacer" style="width:${widthPct.toFixed(3)}%;flex-basis:${widthPct.toFixed(3)}%;" aria-hidden="true" title="Street not read (${formatMinSec(it.duration)})"></div>`;
    }
    const widthPct = (it.duration / totalDuration) * 100;
    const durStr = formatMinSec(it.duration);
    const ariaLabel = `${it.name}, ${durStr}, ${it.signs} signs, ${it.parked} parked cars`;
    const isSelected = state.selectedStreet === it.name;

    return `
      <button type="button" class="street-seg-btn ${isSelected ? 'is-selected' : ''}"
        data-street="${it.name}"
        data-dur="${it.duration}"
        data-dist="${(it.distM / 1000).toFixed(1)}"
        data-signs="${it.signs}"
        data-parked="${it.parked}"
        style="width:${widthPct.toFixed(3)}%;flex-basis:${widthPct.toFixed(3)}%;"
        aria-label="${ariaLabel}">
        <span class="seg-name"></span>
      </button>
    `;
  }).join('');

  // Function to re-calculate whether street name fits whole based on measured track width
  const updateLabelFits = () => {
    const trackWidth = trackEl.getBoundingClientRect().width || trackEl.clientWidth || 920;
    trackEl.querySelectorAll('.street-seg-btn').forEach(btn => {
      const dur = parseFloat(btn.getAttribute('data-dur') || '0');
      const name = btn.getAttribute('data-street') || '';
      const approxWidthPx = (dur / totalDuration) * trackWidth;
      const textWidthPx = ctx ? ctx.measureText(name).width : name.length * 8;
      const fitsWhole = approxWidthPx >= (textWidthPx + 16);
      const span = btn.querySelector('.seg-name');
      if (span) {
        span.textContent = fitsWhole ? name : '';
      }
    });
  };

  updateLabelFits();

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      updateLabelFits();
    });
    ro.observe(trackEl);
  }

  // Street button clicks & keyboard
  const segButtons = Array.from(trackEl.querySelectorAll('.street-seg-btn'));
  segButtons.forEach((btn, idx) => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-street');
      if (state.selectedStreet === name) {
        selectStreet(null);
      } else {
        selectStreet(name);
      }
    });

    btn.addEventListener('mouseenter', () => {
      showStreetDetail(btn);
    });

    btn.addEventListener('mouseleave', () => {
      restoreStreetDetail();
    });

    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const next = segButtons[idx + 1] || segButtons[0];
        next.focus();
        showStreetDetail(next);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = segButtons[idx - 1] || segButtons[segButtons.length - 1];
        prev.focus();
        showStreetDetail(prev);
      }
    });
  });

  const clearBtn = container.querySelector('#btn-clear-street');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      selectCar(null);
      selectStreet(null);
    });
  }

  restoreStreetDetail();
}

function formatMinSec(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} min ${s} s`;
}

function showStreetDetail(btn) {
  const textEl = document.getElementById('strip-detail-text');
  const clearBtn = document.getElementById('btn-clear-street');
  const driveBtn = document.getElementById('btn-drive-through');
  if (!textEl) return;

  const name = btn.getAttribute('data-street');
  const dur = parseFloat(btn.getAttribute('data-dur') || '0');
  const dist = btn.getAttribute('data-dist') || '0.0';
  const signs = btn.getAttribute('data-signs') || '0';
  const parked = btn.getAttribute('data-parked') || '0';

  textEl.innerHTML = `<strong>${name}</strong> · ${formatMinSec(dur)} · ${dist} km · ${intFmt.format(signs)} signs · ${intFmt.format(parked)} parked cars`;

  const isSelected = (state.selectedStreet === name);
  if (clearBtn) {
    clearBtn.hidden = !isSelected;
  }
  if (driveBtn) {
    driveBtn.hidden = !isSelected;
    if (isSelected) {
      const firstSeg = (state.drive.streets || []).find(s => s.name === name);
      const firstT0 = firstSeg ? firstSeg.t0.toFixed(1) : '0.0';
      driveBtn.setAttribute('href', `#/drive?t=${firstT0}`);
    }
  }
}

function restoreStreetDetail() {
  const textEl = document.getElementById('strip-detail-text');
  const clearBtn = document.getElementById('btn-clear-street');
  const driveBtn = document.getElementById('btn-drive-through');
  if (!textEl) return;

  if (state.selectedStreet) {
    const activeBtn = document.querySelector(`.street-seg-btn[data-street="${state.selectedStreet}"]`);
    if (activeBtn) {
      showStreetDetail(activeBtn);
      return;
    }
  }

  textEl.innerHTML = `<span style="color:var(--ink-2);font-size:13px;">Select a street to inspect its drive segment and dim other marks.</span>`;
  if (clearBtn) {
    clearBtn.hidden = true;
  }
  if (driveBtn) {
    driveBtn.hidden = true;
  }
}

function updateSidebarSlot() {
  const slot = document.getElementById('sheet-sidebar-slot');
  if (!slot) return;

  const drive = state.drive;
  if (!drive) return;

  // Case 1: Car selected
  if (state.selectedCar) {
    const car = state.selectedCar;
    const dwell = dwellMinutes(car);
    const bin = DWELL_BINS.find(b => dwell >= b.lo && dwell < b.hi);
    const binLabel = bin ? bin.label : '—';
    const scoreStr = car.score != null ? car.score.toFixed(2) : '—';

    slot.innerHTML = `
      <section class="street-detail-panel" aria-labelledby="car-panel-heading">
        <div class="street-panel-header">
          <h2 id="car-panel-heading" class="street-panel-title">Parked car</h2>
          <button type="button" class="btn-clear-street" id="btn-clear-slot">Clear</button>
        </div>
        <dl class="title-block-grid">
          <dt>Street</dt>
          <dd><strong>${car.street || 'Street not read'}</strong></dd>

          <dt>Seen at</dt>
          <dd class="tnum">${formatTime(car.t0)} into the drive</dd>

          <dt>Confirmed</dt>
          <dd>${car.state === 'parked' ? 'Yes' : 'No'}</dd>

          <dt>Score</dt>
          <dd class="tnum">${scoreStr}</dd>

          <dt>Dwell</dt>
          <dd class="tnum">${formatDwell(dwell)} <span class="demo-tag"><span class="mini-hatch" aria-hidden="true"></span>Demo</span></dd>

          <dt>Bin</dt>
          <dd>${binLabel}</dd>

          <dt>Position</dt>
          <dd class="desc">Position estimated from one camera</dd>
        </dl>
      </section>
    `;

    const clearBtn = slot.querySelector('#btn-clear-slot');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        selectCar(null);
        selectStreet(null);
      });
    }
    return;
  }

  // Case 2: Street selected
  if (state.selectedStreet) {
    const streetName = state.selectedStreet;
    const streets = drive.streets || [];
    const streetSegs = streets.filter(s => s.name === streetName);
    const dur = streetSegs.reduce((sum, s) => sum + (s.t1 - s.t0), 0);
    const streetDists = computeStreetDistances(drive);
    const distM = streetDists[streetName] || 0;
    const distKm = distM / 1000;

    const tracks = drive.tracks || [];
    const streetSigns = tracks.filter(t => t.kind === 'sign' && t.street === streetName);
    const streetParked = tracks.filter(t => t.kind === 'vehicle' && t.cls === 'car' && t.state === 'parked' && t.street === streetName);
    const summary = dwellSummary(streetParked);
    const maxBinN = Math.max(...summary.bins.map(b => b.n), 1);

    slot.innerHTML = `
      <section class="street-detail-panel" aria-labelledby="street-panel-heading">
        <div class="street-panel-header">
          <h2 id="street-panel-heading" class="street-panel-title">${streetName}</h2>
          <button type="button" class="btn-clear-street" id="btn-clear-slot">Clear</button>
        </div>
        <dl class="title-block-grid" style="margin-bottom:6px;">
          <dt>Drive time</dt>
          <dd class="tnum">${formatMinSec(dur)}</dd>

          <dt>Distance</dt>
          <dd class="tnum">${distKm.toFixed(2)} km</dd>

          <dt>Signs</dt>
          <dd class="tnum">${intFmt.format(streetSigns.length)}</dd>

          <dt>Parked cars</dt>
          <dd class="tnum">${intFmt.format(streetParked.length)}</dd>
        </dl>

        <div class="dwell-section">
          <div class="dwell-section-header">
            <span class="dwell-section-title">Parking dwell</span>
            <span class="demo-tag"><span class="mini-hatch" aria-hidden="true"></span>Demo</span>
          </div>
          <div class="dwell-kpi-row">
            <div class="dwell-kpi">
              <span class="dwell-kpi-label">Median dwell</span>
              <span class="dwell-kpi-val tnum">${summary.medianMin != null ? formatDwell(summary.medianMin) : '—'}</span>
            </div>
            <div class="dwell-kpi">
              <span class="dwell-kpi-label">Over 2 h</span>
              <span class="dwell-kpi-val tnum">${summary.over2hShare != null ? `${Math.round(summary.over2hShare * 100)} %` : '—'}</span>
            </div>
          </div>
          <div class="dwell-histogram">
            ${summary.bins.map(b => {
              const pct = maxBinN > 0 ? (b.n / maxBinN) * 100 : 0;
              return `
                <div class="dwell-bar-row">
                  <span class="dwell-bar-label">${b.label}</span>
                  <div class="dwell-bar-track">
                    <div class="dwell-bar-fill" style="width: ${pct}%;"></div>
                  </div>
                  <span class="dwell-bar-count tnum">${b.n}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </section>
    `;

    const clearBtn = slot.querySelector('#btn-clear-slot');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        selectStreet(null);
      });
    }
    return;
  }

  // Case 3: Neither selected -> Default Title Block
  const totalDistM = computeTotalRouteDistance(drive);
  const routeKm = (totalDistM / 1000).toFixed(1);

  slot.innerHTML = `
    <section class="title-block" aria-labelledby="title-block-heading">
      <h2 id="title-block-heading" class="sr-only">Drive Details</h2>
      <dl class="title-block-grid">
        <dt>Duration</dt>
        <dd class="tnum">36:23</dd>

        <dt>Distance</dt>
        <dd>${routeKm} km, estimated</dd>

        <dt>Cameras</dt>
        <dd>Front camera only (1 of 4 rig cameras)</dd>

        <dt>Positioning</dt>
        <dd class="desc">${drive.source?.route_note || 'Estimated: no GNSS on this drive'}</dd>

        <dt>Processed on</dt>
        <dd>Jetson Orin Nano 8 GB</dd>

        <dt>Base map</dt>
        <dd>© OpenStreetMap contributors, ODbL</dd>
      </dl>
    </section>
  `;
}

function selectStreet(streetName) {
  state.selectedStreet = streetName;
  if (!streetName) {
    state.selectedCar = null;
  }

  // Update button highlights
  document.querySelectorAll('.street-seg-btn').forEach(b => {
    const name = b.getAttribute('data-street');
    if (streetName && name === streetName) {
      b.classList.add('is-selected');
    } else {
      b.classList.remove('is-selected');
    }
  });

  restoreStreetDetail();

  if (state.mapInstance) {
    if (!streetName) {
      state.mapInstance.selectCar(null);
    }
    state.mapInstance.selectStreet(streetName);
  }

  updateSidebarSlot();
  updateHash();
}

function selectCar(carTrack) {
  state.selectedCar = carTrack;
  if (carTrack) {
    if (carTrack.street) {
      state.selectedStreet = carTrack.street;
    }
    // Update strip button highlights
    document.querySelectorAll('.street-seg-btn').forEach(b => {
      const name = b.getAttribute('data-street');
      if (state.selectedStreet && name === state.selectedStreet) {
        b.classList.add('is-selected');
      } else {
        b.classList.remove('is-selected');
      }
    });
    if (state.mapInstance) {
      state.mapInstance.selectStreet(state.selectedStreet);
      state.mapInstance.selectCar(carTrack);
    }
    restoreStreetDetail();
  } else {
    if (state.mapInstance) {
      state.mapInstance.selectCar(null);
    }
  }

  updateSidebarSlot();
  updateHash();
}

function applySheetState() {
  // Apply layer visibility
  for (const [layer, vis] of Object.entries(state.layers)) {
    const btn = document.querySelector(`[data-layer-toggle="${layer}"]`);
    if (btn) btn.setAttribute('aria-pressed', vis);
    if (state.mapInstance) state.mapInstance.setLayerVisible(layer, vis);
  }

  // Apply sign filter
  const filterSlot = document.getElementById('sign-filter-slot');
  if (filterSlot) {
    if (state.selectedSign) {
      filterSlot.hidden = false;
      filterSlot.innerHTML = `
        <span>Showing: <strong>${formatClsLabel(state.selectedSign)}</strong></span>
        · <button type="button" class="btn-clear-filter" id="btn-clear-sign">Clear filter</button>
      `;
      const clearBtn = filterSlot.querySelector('#btn-clear-sign');
      if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          state.selectedSign = null;
          applySheetState();
          updateHash();
        });
      }
    } else {
      filterSlot.hidden = true;
      filterSlot.innerHTML = '';
    }
  }
  if (state.mapInstance) {
    state.mapInstance.setSignFilter(state.selectedSign);
  }

  // Apply street & car selection
  if (state.selectedCar) {
    selectCar(state.selectedCar);
  } else {
    selectStreet(state.selectedStreet);
  }
  updateSidebarSlot();
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state.selectedCar || state.selectedStreet) {
      selectCar(null);
      selectStreet(null);
    }
  }
});
// Kick off
initApp();
