// Survey panel — Valletta visual style
import { formatClock, formatDuration } from './data.js';
import { DWELL_BINS } from './dwell.js';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 14 px line icons for the colour tiles (colour emoji render differently on every OS).
const svg = d => `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICON = {
  sign: svg('<path d="M8 2.5 14 13H2z"/><path d="M8 6.8v2.6M8 11.3v.1"/>'),
  parkingSign: svg('<circle cx="8" cy="8" r="5.6"/><path d="M4 12 12 4"/>'),
  object: svg('<circle cx="4" cy="11" r="2.4"/><circle cx="12" cy="11" r="2.4"/><path d="M4 11 6.5 5.5h3.5L12 11M6.5 5.5 8.5 11"/>'),
  camera: svg('<rect x="1.5" y="4.5" width="13" height="9" rx="2"/><circle cx="8" cy="9" r="2.4"/><path d="M5.5 4.5 6.5 2.5h3l1 2"/>'),
  street: svg('<path d="M3.5 14 6 2M12.5 14 10 2M8 3.5v1.5M8 7.5V9M8 11.5V13"/>')
};

export function createPanel(el, model, handlers) {
  let activeTab = 'survey'; // 'survey' | 'streets' | 'drive' | 'rig'
  let activeKinds = new Set(['parked', 'parking-sign', 'sign', 'object']);
  let activeChip = 'all'; // 'all' | 'parked' | 'parking-signs' | 'signs' | 'objects'
  let searchQuery = '';
  let selectedId = null;
  let focusedStreet = null;

  // Section lazy-loading expansion flags
  const expandedSections = {
    parked: false,
    parkingSigns: false,
    trafficSigns: false,
    objects: false
  };

  // Cached lists
  const allParked = model.items.filter(it => it.kind === 'parked')
    .sort((a, b) => (b.dwellMin || 0) - (a.dwellMin || 0));
  const allParkingSigns = model.items.filter(it => it.kind === 'parking-sign');
  const allTrafficSigns = model.items.filter(it => it.kind === 'sign');
  const allObjects = model.items.filter(it => it.kind === 'object');

  // Pre-calculate street lookup
  const streetByName = new Map(model.streets.map(s => [s.name, s]));

  // Build root markup
  el.innerHTML = `
    <header class="panel-top">
      <div class="panel-brand">
        <span class="mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <div>
          <h1>Milan</h1>
          <p>Civimatica · Pilot</p>
        </div>
      </div>
      <div class="panel-live" aria-label="Survey time">
        <i aria-hidden="true"></i>
        <time id="panel-clock">14:08</time>
      </div>
    </header>

    <div class="search">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input type="text" id="panel-search-input" placeholder="Street or sign" aria-label="Search street or sign" autocomplete="off" spellcheck="false">
      <button type="button" class="clear-x" id="panel-search-clear" aria-label="Clear search" hidden>×</button>
    </div>

    <div class="stats" role="group" aria-label="Key performance indicators">
      <button type="button" class="stat" id="kpi-signs" title="Filter to signs">
        <b>${model.kpis.signs.toLocaleString()}</b>
        <span>Signs</span>
        <i></i>
      </button>
      <button type="button" class="stat" id="kpi-parked" title="Filter to parked cars">
        <b>${model.kpis.parked.toLocaleString()}</b>
        <span>Parked</span>
        <i></i>
      </button>
      <div class="stat" id="kpi-dwell" title="Median dwell time (demonstration only)">
        <b>${formatDuration(model.kpis.medianDwellMin)}</b>
        <span>Dwell <span class="demo-tag">Demo</span></span>
      </div>
      <div class="stat" id="kpi-route" title="Total route distance">
        <b>${model.kpis.routeKm.toFixed(1)} km</b>
        <span>Route</span>
      </div>
    </div>

    <nav class="modes" role="tablist" aria-label="Panel tabs">
      <button type="button" class="mode on" role="tab" id="tab-survey" aria-selected="true" aria-controls="pane-survey" data-tab="survey">Survey</button>
      <button type="button" class="mode" role="tab" id="tab-streets" aria-selected="false" aria-controls="pane-streets" data-tab="streets">Streets</button>
      <button type="button" class="mode" role="tab" id="tab-drive" aria-selected="false" aria-controls="pane-drive" data-tab="drive">Drive</button>
      <button type="button" class="mode" role="tab" id="tab-rig" aria-selected="false" aria-controls="pane-rig" data-tab="rig">Rig</button>
    </nav>

    <div class="panel-body">
      <div class="tab-pane" id="pane-survey" role="tabpanel" aria-labelledby="tab-survey">
        <div class="chips-row" role="group" aria-label="Filter detections">
          <button type="button" class="chip on" data-chip="all">All <small>${model.items.length.toLocaleString()}</small></button>
          <button type="button" class="chip" data-chip="parked">Parked <small>${allParked.length.toLocaleString()}</small></button>
          <button type="button" class="chip" data-chip="parking-signs">Parking signs <small>${allParkingSigns.length.toLocaleString()}</small></button>
          <button type="button" class="chip" data-chip="signs">Traffic signs <small>${allTrafficSigns.length.toLocaleString()}</small></button>
          <button type="button" class="chip" data-chip="objects">Objects <small>${allObjects.length.toLocaleString()}</small></button>
        </div>
        <div class="listhead">
          <span class="listhead-title">Detections</span>
          <span class="listhead-count" id="survey-count">0 items</span>
        </div>
        <div class="list-note">Positions estimated from one camera</div>
        <div class="list" id="survey-list"></div>
      </div>

      <div class="tab-pane" id="pane-streets" role="tabpanel" aria-labelledby="tab-streets" hidden>
        <div class="streets-list" id="streets-list"></div>
        <div class="street-detail" id="street-detail" hidden></div>
      </div>

      <div class="tab-pane" id="pane-drive" role="tabpanel" aria-labelledby="tab-drive" hidden>
        <div class="drive-pane">
          <button type="button" class="drive-play-btn" id="drive-play-btn">
            <span class="play-icon" aria-hidden="true">▶</span>
            <span class="play-label">Play</span>
          </button>

          <div class="drive-scrubber-wrap">
            <input type="range" class="drive-scrubber" id="drive-scrubber" min="0" max="${model.durationS}" step="0.25" value="0" aria-label="Drive timeline scrubber">
            <div class="drive-time">
              <time id="drive-time-cur">0:00</time>
              <time id="drive-time-total">${formatClock(model.durationS)}</time>
            </div>
          </div>

          <div class="drive-controls-row">
            <div class="drive-speeds" role="group" aria-label="Playback speed">
              <button type="button" class="drive-speed-btn on" data-speed="1">1×</button>
              <button type="button" class="drive-speed-btn" data-speed="4">4×</button>
              <button type="button" class="drive-speed-btn" data-speed="16">16×</button>
            </div>
            <label class="drive-follow-toggle">
              <input type="checkbox" id="drive-follow-cb" checked>
              <span>Follow car</span>
            </label>
          </div>

          <div class="drive-telemetry">
            <div>
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 700;">Street</div>
              <strong id="drive-cur-street">Via Dante</strong>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 700;">Speed</div>
              <span id="drive-cur-speed">0 km/h</span>
            </div>
          </div>

          <div class="drive-gathered">
            <div class="drive-gathered-title">Gathered so far</div>
            <div class="drive-gathered-grid">
              <div class="drive-kpi">
                <b id="gathered-signs">0</b>
                <span>Signs</span>
              </div>
              <div class="drive-kpi">
                <b id="gathered-parking-signs">0</b>
                <span>Parking</span>
              </div>
              <div class="drive-kpi">
                <b id="gathered-parked">0</b>
                <span>Parked</span>
              </div>
              <div class="drive-kpi">
                <b id="gathered-objects">0</b>
                <span>Objects</span>
              </div>
            </div>
          </div>

          <div class="drive-recent">
            <div class="drive-recent-title">Recent detections</div>
            <div id="drive-recent-list"></div>
          </div>
        </div>
      </div>

      <div class="tab-pane" id="pane-rig" role="tabpanel" aria-labelledby="tab-rig" hidden>
        <div class="rig-pane">
          <div>
            <div class="rig-sec-title">Cameras</div>
            <div class="rig-card-list" id="rig-cameras-list"></div>
          </div>

          <div>
            <div class="rig-sec-title">On-device privacy</div>
            <div class="privacy-card" id="rig-privacy-card"></div>
          </div>

          <div>
            <div class="rig-sec-title">Not on this drive</div>
            <div class="rig-card-list" id="rig-missing-list"></div>
          </div>
        </div>
      </div>
    </div>

    <footer class="foot">
      <label class="zones-toggle-label">
        <input type="checkbox" id="zones-toggle" checked>
        <span>Zones</span>
      </label>
      <span>Faces &amp; plates blurred on device</span>
      <button type="button" class="reset-btn" id="panel-reset-btn">Reset</button>
    </footer>
  `;

  // Live clock
  const clockEl = el.querySelector('#panel-clock');
  function updateClock() {
    const d = new Date();
    clockEl.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  updateClock();
  const clockInterval = setInterval(updateClock, 30000);

  // Search DOM
  const searchInput = el.querySelector('#panel-search-input');
  const searchClear = el.querySelector('#panel-search-clear');

  searchInput.addEventListener('input', e => {
    searchQuery = e.target.value.trim().toLowerCase();
    searchClear.hidden = !searchQuery;
    renderSurveyList();
    if (activeTab === 'streets' && !focusedStreet) {
      renderStreetsList();
    }
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClear.hidden = true;
    searchInput.focus();
    renderSurveyList();
    if (activeTab === 'streets' && !focusedStreet) {
      renderStreetsList();
    }
  });

  // KPI buttons
  const kpiSignsBtn = el.querySelector('#kpi-signs');
  const kpiParkedBtn = el.querySelector('#kpi-parked');

  function updateKpiUnderlines() {
    kpiSignsBtn.classList.toggle('on', activeChip === 'signs' || activeChip === 'parking-signs');
    kpiParkedBtn.classList.toggle('on', activeChip === 'parked');
  }

  kpiSignsBtn.addEventListener('click', () => {
    switchTab('survey');
    setChipFilter('signs');
  });

  kpiParkedBtn.addEventListener('click', () => {
    switchTab('survey');
    setChipFilter('parked');
  });

  // Tab switching
  const tabs = el.querySelectorAll('.mode');
  const panes = el.querySelectorAll('.tab-pane');

  function switchTab(tabId) {
    if (tabId === activeTab) return;
    const oldTab = activeTab;
    activeTab = tabId;

    tabs.forEach(t => {
      const isCurrent = t.dataset.tab === tabId;
      t.classList.toggle('on', isCurrent);
      t.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
    });

    panes.forEach(p => {
      p.hidden = p.id !== `pane-${tabId}`;
    });

    if (oldTab === 'drive' && tabId !== 'drive') {
      handlers.onDriveExit?.();
    } else if (tabId === 'drive') {
      const scrubVal = parseFloat(el.querySelector('#drive-scrubber').value) || 0;
      handlers.onDriveStart?.(scrubVal);
    }

    if (tabId === 'survey') {
      renderSurveyList();
    } else if (tabId === 'streets') {
      if (!focusedStreet) renderStreetsList();
    }
  }

  tabs.forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  // Chips in Survey tab
  const chipButtons = el.querySelectorAll('.chip');
  function setChipFilter(chipKey) {
    activeChip = chipKey;
    chipButtons.forEach(b => b.classList.toggle('on', b.dataset.chip === chipKey));

    if (chipKey === 'all') {
      activeKinds = new Set(['parked', 'parking-sign', 'sign', 'object']);
    } else if (chipKey === 'parked') {
      activeKinds = new Set(['parked']);
    } else if (chipKey === 'parking-signs') {
      activeKinds = new Set(['parking-sign']);
    } else if (chipKey === 'signs') {
      activeKinds = new Set(['sign']);
    } else if (chipKey === 'objects') {
      activeKinds = new Set(['object']);
    }

    updateKpiUnderlines();
    handlers.onFilter?.(new Set(activeKinds));
    renderSurveyList();
  }

  chipButtons.forEach(b => {
    b.addEventListener('click', () => setChipFilter(b.dataset.chip));
  });

  // Filter helper
  function matchItem(item) {
    if (!activeKinds.has(item.kind)) return false;
    if (!searchQuery) return true;
    const l = (item.label || '').toLowerCase();
    const st = (item.street || '').toLowerCase();
    return l.includes(searchQuery) || st.includes(searchQuery);
  }

  // Render Survey list
  const surveyListEl = el.querySelector('#survey-list');
  const surveyCountEl = el.querySelector('#survey-count');

  function renderSurveyList() {
    const parked = activeKinds.has('parked') ? allParked.filter(matchItem) : [];
    const parkingSigns = activeKinds.has('parking-sign') ? allParkingSigns.filter(matchItem) : [];
    const trafficSigns = activeKinds.has('sign') ? allTrafficSigns.filter(matchItem) : [];
    const objects = activeKinds.has('object') ? allObjects.filter(matchItem) : [];

    const totalVisible = parked.length + parkingSigns.length + trafficSigns.length + objects.length;
    surveyCountEl.textContent = `${totalVisible.toLocaleString()} items`;

    if (totalVisible === 0) {
      surveyListEl.innerHTML = `<div class="empty">No matching detections found</div>`;
      return;
    }

    let html = '';

    // 1. PARKED
    if (parked.length > 0) {
      html += `<h3 class="sec">Parked (${parked.length.toLocaleString()}) · demo dwell</h3>`;
      const limit = expandedSections.parked ? parked.length : Math.min(parked.length, 40);
      for (let i = 0; i < limit; i++) {
        const item = parked[i];
        const isSel = item.id === selectedId;
        const dwell = item.dwellMin || 0;
        const metricClass = dwell >= 240 ? 'attention' : dwell >= 120 ? 'watch' : 'amber';
        html += `
          <button type="button" class="row ${isSel ? 'on is-selected' : ''}" data-id="${escapeHtml(item.id)}">
            <span class="ico domain-parking" aria-hidden="true">P</span>
            <span class="copy">
              <strong>${escapeHtml(item.street || 'Unnamed street')}</strong>
              <em>Car · seen ${formatClock(item.t0)} into drive</em>
            </span>
            <b class="metric ${metricClass}">${formatDuration(item.dwellMin)}</b>
          </button>
        `;
      }
      if (parked.length > limit) {
        html += `<button type="button" class="more-btn" data-expand="parked">Show all ${parked.length} parked cars</button>`;
      }
    }

    // 2. PARKING SIGNS
    if (parkingSigns.length > 0) {
      html += `<h3 class="sec">Parking Signs (${parkingSigns.length.toLocaleString()})</h3>`;
      const limit = expandedSections.parkingSigns ? parkingSigns.length : Math.min(parkingSigns.length, 40);
      for (let i = 0; i < limit; i++) {
        const item = parkingSigns[i];
        const isSel = item.id === selectedId;
        html += `
          <button type="button" class="row ${isSel ? 'on is-selected' : ''}" data-id="${escapeHtml(item.id)}">
            <span class="ico domain-waste" aria-hidden="true">${ICON.parkingSign}</span>
            <span class="copy">
              <strong>${escapeHtml(item.label)}</strong>
              <em>${escapeHtml(item.street || 'Street not read')}</em>
            </span>
            <b class="metric muted">${formatClock(item.t0)}</b>
          </button>
        `;
      }
      if (parkingSigns.length > limit) {
        html += `<button type="button" class="more-btn" data-expand="parkingSigns">Show all ${parkingSigns.length} parking signs</button>`;
      }
    }

    // 3. TRAFFIC SIGNS
    if (trafficSigns.length > 0) {
      html += `<h3 class="sec">Traffic Signs (${trafficSigns.length.toLocaleString()})</h3>`;
      const limit = expandedSections.trafficSigns ? trafficSigns.length : Math.min(trafficSigns.length, 40);
      for (let i = 0; i < limit; i++) {
        const item = trafficSigns[i];
        const isSel = item.id === selectedId;
        html += `
          <button type="button" class="row ${isSel ? 'on is-selected' : ''}" data-id="${escapeHtml(item.id)}">
            <span class="ico domain-access" aria-hidden="true">${ICON.sign}</span>
            <span class="copy">
              <strong>${escapeHtml(item.label)}</strong>
              <em>${escapeHtml(item.street || 'Street not read')}</em>
            </span>
            <b class="metric muted">${formatClock(item.t0)}</b>
          </button>
        `;
      }
      if (trafficSigns.length > limit) {
        html += `<button type="button" class="more-btn" data-expand="trafficSigns">Show all ${trafficSigns.length} traffic signs</button>`;
      }
    }

    // 4. OTHER OBJECTS
    if (objects.length > 0) {
      html += `<h3 class="sec">Other Objects (${objects.length.toLocaleString()})</h3>`;
      const limit = expandedSections.objects ? objects.length : Math.min(objects.length, 40);
      for (let i = 0; i < limit; i++) {
        const item = objects[i];
        const isSel = item.id === selectedId;
        const sub = `${item.state === 'moving' ? 'Moving' : 'Unknown motion'} · ${item.street || 'Street not read'}`;
        html += `
          <button type="button" class="row ${isSel ? 'on is-selected' : ''}" data-id="${escapeHtml(item.id)}">
            <span class="ico domain-object" aria-hidden="true">${ICON.object}</span>
            <span class="copy">
              <strong>${escapeHtml(item.label)}</strong>
              <em>${escapeHtml(sub)}</em>
            </span>
            <b class="metric muted">${formatClock(item.t0)}</b>
          </button>
        `;
      }
      if (objects.length > limit) {
        html += `<button type="button" class="more-btn" data-expand="objects">Show all ${objects.length} objects</button>`;
      }
    }

    surveyListEl.innerHTML = html;
  }

  // Survey list click delegation
  surveyListEl.addEventListener('click', e => {
    const expandBtn = e.target.closest('.more-btn');
    if (expandBtn) {
      const secKey = expandBtn.dataset.expand;
      if (secKey && expandedSections[secKey] !== undefined) {
        expandedSections[secKey] = true;
        renderSurveyList();
      }
      return;
    }

    const row = e.target.closest('.row');
    if (row && row.dataset.id) {
      handlers.onSelect?.(row.dataset.id);
    }
  });

  // Render Streets list
  const streetsListEl = el.querySelector('#streets-list');
  const streetDetailEl = el.querySelector('#street-detail');

  function renderStreetsList() {
    streetsListEl.hidden = false;
    streetDetailEl.hidden = true;

    let streets = model.streets;
    if (searchQuery) {
      streets = streets.filter(s => s.name.toLowerCase().includes(searchQuery));
    }

    if (streets.length === 0) {
      streetsListEl.innerHTML = `<div class="empty">No matching streets found</div>`;
      return;
    }

    let html = '';
    for (const s of streets) {
      const lenM = Math.round(s.lengthM);
      const dwellPart = s.parked > 0
        ? `<span>Median dwell ${formatDuration(s.medianDwellMin)} · <span class="demo-tag">Demo</span></span>`
        : '';
      html += `
        <button type="button" class="street" data-street="${escapeHtml(s.name)}">
          <strong>
            <span>${escapeHtml(s.name)}</span>
            <em>${lenM} m</em>
          </strong>
          <span>${s.signs} signs · ${s.parked} parked · ${s.objects || 0} objects</span>
          ${dwellPart}
        </button>
      `;
    }
    streetsListEl.innerHTML = html;
  }

  // Streets list click delegation
  streetsListEl.addEventListener('click', e => {
    const btn = e.target.closest('.street');
    if (btn && btn.dataset.street) {
      handlers.onStreet?.(btn.dataset.street);
    }
  });

  // Render Street detail
  function renderStreetDetail(name) {
    const s = streetByName.get(name);
    if (!s) return;

    focusedStreet = name;
    streetsListEl.hidden = true;
    streetDetailEl.hidden = false;

    const parkedOnStreet = allParked.filter(it => it.street === name);
    const dwellMins = parkedOnStreet.map(p => p.dwellMin || 0);

    // Compute histogram bins
    const bins = DWELL_BINS.map(b => {
      const count = dwellMins.filter(m => m >= b.lo && m < b.hi).length;
      return { label: b.label, count };
    });
    const maxBinCount = Math.max(1, ...bins.map(b => b.count));

    let histoRowsHtml = '';
    for (const b of bins) {
      const pct = Math.round((b.count / maxBinCount) * 100);
      histoRowsHtml += `
        <div class="histo-row">
          <span class="histo-label">${b.label}</span>
          <div class="histo-track">
            <div class="histo-fill" style="width: ${pct}%;"></div>
          </div>
          <span class="histo-count">${b.count}</span>
        </div>
      `;
    }

    let parkedListHtml = '';
    if (parkedOnStreet.length > 0) {
      parkedListHtml = `<div class="rig-sec-title" style="margin-top: 12px;">Parked Cars (${parkedOnStreet.length}) · demo dwell</div>`;
      for (const item of parkedOnStreet) {
        const isSel = item.id === selectedId;
        const dwell = item.dwellMin || 0;
        const metricClass = dwell >= 240 ? 'attention' : dwell >= 120 ? 'watch' : 'amber';
        parkedListHtml += `
          <button type="button" class="row ${isSel ? 'on is-selected' : ''}" data-id="${escapeHtml(item.id)}" style="background: #ffffff; border: 1px solid var(--line); margin-bottom: 4px;">
            <span class="ico domain-parking" aria-hidden="true">P</span>
            <span class="copy">
              <strong>${escapeHtml(item.street || 'Unnamed street')}</strong>
              <em>seen ${formatClock(item.t0)}</em>
            </span>
            <b class="metric ${metricClass}">${formatDuration(item.dwellMin)}</b>
          </button>
        `;
      }
    }

    streetDetailEl.innerHTML = `
      <button type="button" class="back" id="street-back-btn">All streets</button>
      <h2>${escapeHtml(s.name)}</h2>

      <div class="kpi-grid">
        <div class="kpi">
          <b>${s.signs}</b>
          <span>Signs</span>
        </div>
        <div class="kpi">
          <b>${s.parked}</b>
          <span>Parked</span>
        </div>
        <div class="kpi">
          <b>${Math.round(s.lengthM)} m</b>
          <span>Length</span>
        </div>
        <div class="kpi">
          <b>${formatDuration(s.medianDwellMin)}</b>
          <span>Dwell <small class="demo-tag">Demo</small></span>
        </div>
      </div>

      <div class="dwell-histo">
        <div class="dwell-histo-title">
          <span>Dwell distribution</span>
          <span class="demo-tag">Demo</span>
        </div>
        <div class="histo-bars">
          ${histoRowsHtml}
        </div>
      </div>

      <div class="street-parked-list" id="street-parked-list">
        ${parkedListHtml}
      </div>
    `;

    streetDetailEl.querySelector('#street-back-btn').addEventListener('click', () => {
      handlers.onStreet?.(null);
    });

    streetDetailEl.querySelector('#street-parked-list')?.addEventListener('click', e => {
      const row = e.target.closest('.row');
      if (row && row.dataset.id) {
        handlers.onSelect?.(row.dataset.id);
      }
    });
  }

  // Drive Tab DOM
  const playBtn = el.querySelector('#drive-play-btn');
  const playIcon = playBtn.querySelector('.play-icon');
  const playLabel = playBtn.querySelector('.play-label');
  const scrubber = el.querySelector('#drive-scrubber');
  const curTimeEl = el.querySelector('#drive-time-cur');
  const curStreetEl = el.querySelector('#drive-cur-street');
  const curSpeedEl = el.querySelector('#drive-cur-speed');
  const followCb = el.querySelector('#drive-follow-cb');
  const speedBtns = el.querySelectorAll('.drive-speed-btn');

  const gSigns = el.querySelector('#gathered-signs');
  const gParkingSigns = el.querySelector('#gathered-parking-signs');
  const gParked = el.querySelector('#gathered-parked');
  const gObjects = el.querySelector('#gathered-objects');
  const recentListEl = el.querySelector('#drive-recent-list');

  playBtn.addEventListener('click', () => {
    handlers.onDriveToggle?.();
  });

  scrubber.addEventListener('input', e => {
    const t = parseFloat(e.target.value);
    curTimeEl.textContent = formatClock(t);
    handlers.onDriveSeek?.(t);
  });

  speedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      speedBtns.forEach(b => b.classList.toggle('on', b === btn));
      handlers.onDriveSpeed?.(parseFloat(btn.dataset.speed));
    });
  });

  followCb.addEventListener('change', e => {
    handlers.onFollow?.(e.target.checked);
  });

  recentListEl.addEventListener('click', e => {
    const row = e.target.closest('.row');
    if (row && row.dataset.id) {
      handlers.onSelect?.(row.dataset.id);
    }
  });

  // Rig Tab setup
  const rigCamerasList = el.querySelector('#rig-cameras-list');
  const rigPrivacyCard = el.querySelector('#rig-privacy-card');
  const rigMissingList = el.querySelector('#rig-missing-list');

  // Populate cameras
  let camerasHtml = '';
  for (const c of (model.cameras || [])) {
    const yawLabel = c.yaw_deg === 0 ? 'Front' : c.yaw_deg < 0 ? 'Right' : 'Left';
    const inRunText = c.in_run ? 'On this drive' : 'Not on this drive';
    const tagClass = c.in_run ? 'live-tag' : 'muted-tag';
    camerasHtml += `
      <div class="rig-row ${c.in_run ? '' : 'muted-row'}">
        <span class="ico domain-camera" aria-hidden="true">${ICON.camera}</span>
        <span class="copy">
          <strong>${escapeHtml(c.name)}</strong>
          <em>${c.id} · ${yawLabel} · ${c.hfov_deg}° HFOV</em>
        </span>
        <span class="rig-status ${tagClass}">${inRunText}</span>
      </div>
    `;
  }
  rigCamerasList.innerHTML = camerasHtml;

  // Populate privacy
  const p = model.privacy || {};
  rigPrivacyCard.innerHTML = `
    <div class="privacy-item">
      <strong>Plates blurred on device</strong>
      <b>${(p.plates_blurred || 699330).toLocaleString()}</b>
    </div>
    <div class="privacy-item">
      <strong>Heads blurred on device</strong>
      <b>${(p.heads_blurred || 691766).toLocaleString()}</b>
    </div>
    <div class="privacy-item">
      <strong>Faces blurred on device</strong>
      <b>${(p.faces_blurred || 2768).toLocaleString()}</b>
    </div>
    <div class="privacy-item">
      <strong>Plate reads on parked cars</strong>
      <b>${(model.platesKeptParked || 4090).toLocaleString()} · text not exported</b>
    </div>
    <div class="privacy-item">
      <strong>Footage exported</strong>
      <b>No</b>
    </div>
  `;

  // Populate missing capabilities
  const missingItems = [
    { title: 'Bay markings · inside vs outside bays', sub: 'Needs horizontal-marking detector' },
    { title: 'Legal vs illegal parking', sub: 'Needs bay markings + parking rules' },
    { title: 'Measured dwell & turnover', sub: 'Needs repeat passes; dwell shown is demo' },
    { title: 'E-scooters, parking meters, bus stops', sub: 'Side-camera detector did not run' },
    { title: 'Side & stereo cameras', sub: 'Only the front 12 MP camera ran on this drive' }
  ];

  let missingHtml = '';
  for (const item of missingItems) {
    missingHtml += `
      <div class="rig-row muted-row">
        <span class="ico" style="background: var(--line); color: var(--muted);" aria-hidden="true">✕</span>
        <span class="copy">
          <strong>${escapeHtml(item.title)}</strong>
          <em>${escapeHtml(item.sub)}</em>
        </span>
        <span class="rig-status muted-tag">Not yet</span>
      </div>
    `;
  }
  rigMissingList.innerHTML = missingHtml;

  // Footer Reset button
  el.querySelector('#panel-reset-btn').addEventListener('click', () => {
    handlers.onReset?.();
  });

  // Zones checkbox
  const zonesCb = el.querySelector('#zones-toggle');
  zonesCb.addEventListener('change', e => {
    document.querySelectorAll('.zone-pill').forEach(pill => {
      pill.style.display = e.target.checked ? '' : 'none';
    });
  });

  // Initial render of Survey tab
  renderSurveyList();

  // Return public panel API
  return {
    select(id) {
      selectedId = id;
      el.querySelectorAll('.row').forEach(row => {
        const matches = row.dataset.id === id;
        row.classList.toggle('on', matches);
        row.classList.toggle('is-selected', matches);
      });
    },

    setStreet(name) {
      focusedStreet = name;
      if (name) {
        if (activeTab !== 'streets') {
          switchTab('streets');
        }
        renderStreetDetail(name);
      } else {
        focusedStreet = null;
        if (activeTab === 'streets') {
          renderStreetsList();
        }
      }
    },

    setDrive(state) {
      if (!state) {
        playIcon.textContent = '▶';
        playLabel.textContent = 'Play';
        scrubber.value = '0';
        curTimeEl.textContent = '0:00';
        curSpeedEl.textContent = '0 km/h';
        return;
      }

      // Timeline & controls
      scrubber.value = String(state.t);
      curTimeEl.textContent = formatClock(state.t);
      playIcon.textContent = state.playing ? '❚❚' : '▶';
      playLabel.textContent = state.playing ? 'Pause' : 'Play';
      followCb.checked = !!state.follow;

      speedBtns.forEach(btn => {
        btn.classList.toggle('on', parseFloat(btn.dataset.speed) === state.speed);
      });

      // Telemetry
      curStreetEl.textContent = state.street || 'Between streets';
      curSpeedEl.textContent = `${state.speedKmh || 0} km/h`;

      // Counters
      if (state.seen) {
        gSigns.textContent = (state.seen.signs || 0).toLocaleString();
        gParkingSigns.textContent = (state.seen.parkingSigns || 0).toLocaleString();
        gParked.textContent = (state.seen.parked || 0).toLocaleString();
        gObjects.textContent = (state.seen.objects || 0).toLocaleString();
      }

      // Recent feed
      if (state.recent && state.recent.length > 0) {
        let feedHtml = '';
        for (const item of state.recent) {
          const isSel = item.id === selectedId;
          let icoClass = 'domain-access';
          let icoGlyph = ICON.sign;
          let title = item.label || 'Sign';
          let sub = item.street || 'Street not read';
          let metric = formatClock(item.t0);
          let metricClass = 'muted';

          if (item.kind === 'parked') {
            icoClass = 'domain-parking';
            icoGlyph = 'P';
            title = item.street || 'Unnamed street';
            sub = 'Parked car · demo dwell';
            metric = formatDuration(item.dwellMin);
            const dwell = item.dwellMin || 0;
            metricClass = dwell >= 240 ? 'attention' : dwell >= 120 ? 'watch' : 'amber';
          } else if (item.kind === 'parking-sign') {
            icoClass = 'domain-waste';
            icoGlyph = ICON.parkingSign;
          } else if (item.kind === 'object') {
            icoClass = 'domain-object';
            icoGlyph = ICON.object;
            sub = item.state === 'moving' ? 'Moving' : 'Unknown motion';
          }

          feedHtml += `
            <button type="button" class="row ${isSel ? 'on is-selected' : ''}" data-id="${escapeHtml(item.id)}" style="background: #ffffff; border: 1px solid var(--line); margin-bottom: 4px;">
              <span class="ico ${icoClass}" aria-hidden="true">${icoGlyph}</span>
              <span class="copy">
                <strong>${escapeHtml(title)}</strong>
                <em>${escapeHtml(sub)}</em>
              </span>
              <b class="metric ${metricClass}">${metric}</b>
            </button>
          `;
        }
        recentListEl.innerHTML = feedHtml;
      } else {
        recentListEl.innerHTML = `<div class="empty" style="padding: 12px 0;">No detections yet</div>`;
      }
    },

    destroy() {
      clearInterval(clockInterval);
    }
  };
}
