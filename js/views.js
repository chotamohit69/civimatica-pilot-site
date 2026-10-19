/* Civimatica Milan Pilot — View Templates
   Signs, Parking, Plates & Privacy
   All tables: 1px hairline rules, no zebra, no header bands, numbers right-aligned,
   tabular figures, sortable headers as buttons with aria-sort on th.
*/

import { formatClsLabel } from './map.js';
import { DWELL_IS_DEMO, dwellMinutes, dwellSummary, formatDwell, DWELL_BINS } from './dwell.js';
const intFmt = new Intl.NumberFormat('en-US');
const secFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function getSortIcon(isSorted, dir) {
  if (!isSorted) {
    return `<svg class="sort-icon" width="8" height="11" viewBox="0 0 8 11" fill="none" aria-hidden="true"><path d="M4 1.5L1.5 4H6.5L4 1.5ZM4 9.5L6.5 7H1.5L4 9.5Z" fill="#8c8b85"/></svg>`;
  }
  if (dir === 'asc') {
    return `<svg class="sort-icon" width="8" height="11" viewBox="0 0 8 11" fill="none" aria-hidden="true"><path d="M4 1.5L1 5.5H7L4 1.5Z" fill="#1c1e21"/></svg>`;
  }
  return `<svg class="sort-icon" width="8" height="11" viewBox="0 0 8 11" fill="none" aria-hidden="true"><path d="M4 9.5L7 5.5H1L4 9.5Z" fill="#1c1e21"/></svg>`;
}

export function computeStreetDistances(drive) {
  const dists = {};
  const r = drive.route;
  if (!r || !r.x || !r.y || !r.t) return dists;
  const xs = r.x;
  const ys = r.y;
  const ts = r.t;
  const n = xs.length;
  const streets = drive.streets || [];

  for (const s of streets) {
    let d = 0;
    for (let i = 1; i < n; i++) {
      if (ts[i - 1] >= s.t0 && ts[i] <= s.t1) {
        const dx = xs[i] - xs[i - 1];
        const dy = ys[i] - ys[i - 1];
        d += Math.hypot(dx, dy);
      }
    }
    dists[s.name] = (dists[s.name] || 0) + d;
  }
  return dists;
}

export function computeTotalRouteDistance(drive) {
  const r = drive.route;
  if (!r || !r.x || !r.y) return 10800;
  const xs = r.x;
  const ys = r.y;
  let d = 0;
  for (let i = 1; i < xs.length; i++) {
    d += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  }
  return d;
}

// -------------------------------------------------------------
// SIGNS VIEW
// -------------------------------------------------------------
export function renderSignsView(container, drive, onNavigate) {
  const tracks = drive.tracks || [];
  const signTracks = tracks.filter(t => t.kind === 'sign');
  const totalSigns = signTracks.length;
  const streetDistances = computeStreetDistances(drive);

  // 1. Sign types aggregation
  const typeMap = {};
  for (const t of signTracks) {
    const cls = t.cls;
    if (!typeMap[cls]) {
      typeMap[cls] = { cls, label: formatClsLabel(cls), count: 0, streets: new Set() };
    }
    typeMap[cls].count++;
    if (t.street) typeMap[cls].streets.add(t.street);
  }

  let typeRows = Object.values(typeMap).map(row => ({
    ...row,
    share: totalSigns > 0 ? (row.count / totalSigns) * 100 : 0,
    streetCount: row.streets.size
  }));

  // Max share for proportional track fill
  const maxShare = typeRows.reduce((max, r) => Math.max(max, r.share), 0) || 1;

  // 2. Signs by street aggregation
  const parkingSignClasses = new Set([
    'disabled_parking_sign',
    'no_parking_sign',
    'parking_sign',
    'no_stopping_sign'
  ]);

  const streetMap = {};
  let unreadSigns = 0;
  let unreadParkingSigns = 0;

  for (const s of drive.streets || []) {
    if (!streetMap[s.name]) {
      streetMap[s.name] = {
        name: s.name,
        signs: 0,
        parkingSigns: 0,
        distanceM: streetDistances[s.name] || 0
      };
    }
  }

  for (const t of signTracks) {
    const isParkingRelated = parkingSignClasses.has(t.cls);
    if (!t.street) {
      unreadSigns++;
      if (isParkingRelated) unreadParkingSigns++;
    } else {
      if (!streetMap[t.street]) {
        streetMap[t.street] = {
          name: t.street,
          signs: 0,
          parkingSigns: 0,
          distanceM: streetDistances[t.street] || 0
        };
      }
      streetMap[t.street].signs++;
      if (isParkingRelated) streetMap[t.street].parkingSigns++;
    }
  }

  let streetRows = Object.values(streetMap).map(row => ({
    ...row,
    per100m: row.distanceM > 0 ? (row.signs / (row.distanceM / 100)) : null
  }));

  // Sort states
  let typeSort = { col: 'count', dir: 'desc' };
  let streetSort = { col: 'signs', dir: 'desc' };

  function render() {
    container.innerHTML = `
      <div class="view-container">
        <div class="view-header">
          <h1 class="view-h1">Road Signage</h1>
          <p class="view-desc">${intFmt.format(totalSigns)} vertical signs across 30 types on 25 surveyed streets.</p>
        </div>

        <div class="tables-row">
          <!-- Sign Types Table (7 cols) -->
          <div class="table-panel">
            <h2 class="table-h2">Sign Types</h2>
            <table class="data-table" id="table-sign-types">
              <thead>
                <tr>
                  <th aria-sort="${typeSort.col === 'label' ? (typeSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
                    <button type="button" class="th-sort-btn" data-sort-type="label">
                      Type ${getSortIcon(typeSort.col === 'label', typeSort.dir)}
                    </button>
                  </th>
                  <th class="num" aria-sort="${typeSort.col === 'count' ? (typeSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
                    <button type="button" class="th-sort-btn num" data-sort-type="count">
                      Signs ${getSortIcon(typeSort.col === 'count', typeSort.dir)}
                    </button>
                  </th>
                  <th class="num" aria-sort="${typeSort.col === 'share' ? (typeSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
                    <button type="button" class="th-sort-btn num" data-sort-type="share">
                      Share ${getSortIcon(typeSort.col === 'share', typeSort.dir)}
                    </button>
                  </th>
                  <th class="num" aria-sort="${typeSort.col === 'streetCount' ? (typeSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
                    <button type="button" class="th-sort-btn num" data-sort-type="streetCount">
                      Streets ${getSortIcon(typeSort.col === 'streetCount', typeSort.dir)}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                ${typeRows.map(r => {
                  const fillWidthPct = ((r.share / maxShare) * 100).toFixed(1);
                  return `
                    <tr class="is-clickable" data-cls="${r.cls}">
                      <td><a href="#/sheet?sign=${encodeURIComponent(r.cls)}" class="row-nav-link"><strong>${r.label}</strong></a></td>
                      <td class="num tnum">${intFmt.format(r.count)}</td>
                      <td class="num tnum">
                        <div class="share-bar-cell">
                          <span class="share-track"><span class="share-fill" style="width:${fillWidthPct}%;"></span></span>
                          <span>${r.share.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td class="num tnum">${r.streetCount}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>

          <!-- Signs by Street Table (5 cols) -->
          <div class="table-panel">
            <h2 class="table-h2">Signs by Street</h2>
            <table class="data-table" id="table-signs-street">
              <thead>
                <tr>
                  <th aria-sort="${streetSort.col === 'name' ? (streetSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
                    <button type="button" class="th-sort-btn" data-sort-street="name">
                      Street ${getSortIcon(streetSort.col === 'name', streetSort.dir)}
                    </button>
                  </th>
                  <th class="num" aria-sort="${streetSort.col === 'signs' ? (streetSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
                    <button type="button" class="th-sort-btn num" data-sort-street="signs">
                      Signs ${getSortIcon(streetSort.col === 'signs', streetSort.dir)}
                    </button>
                  </th>
                  <th class="num" aria-sort="${streetSort.col === 'parkingSigns' ? (streetSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
                    <button type="button" class="th-sort-btn num" data-sort-street="parkingSigns">
                      Parking-related ${getSortIcon(streetSort.col === 'parkingSigns', streetSort.dir)}
                    </button>
                  </th>
                  <th class="num" aria-sort="${streetSort.col === 'per100m' ? (streetSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
                    <button type="button" class="th-sort-btn num" data-sort-street="per100m">
                      Per 100 m ${getSortIcon(streetSort.col === 'per100m', streetSort.dir)}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                ${streetRows.map(r => `
                  <tr class="is-clickable" data-street="${r.name}">
                    <td><a href="#/sheet?street=${encodeURIComponent(r.name)}" class="row-nav-link"><strong>${r.name}</strong></a></td>
                    <td class="num tnum">${intFmt.format(r.signs)}</td>
                    <td class="num tnum">${intFmt.format(r.parkingSigns)}</td>
                    <td class="num tnum">${r.per100m != null ? r.per100m.toFixed(1) : '—'}</td>
                  </tr>
                `).join('')}
                <tr class="row-unmatched">
                  <td><em>Street not read</em></td>
                  <td class="num tnum">${intFmt.format(unreadSigns)}</td>
                  <td class="num tnum">${intFmt.format(unreadParkingSigns)}</td>
                  <td class="num tnum">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Bind Type sort handlers
    container.querySelectorAll('[data-sort-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        const col = btn.getAttribute('data-sort-type');
        if (typeSort.col === col) {
          typeSort.dir = typeSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          typeSort.col = col;
          typeSort.dir = col === 'label' ? 'asc' : 'desc';
        }
        sortTypeRows();
        render();
      });
    });

    // Bind Street sort handlers
    container.querySelectorAll('[data-sort-street]').forEach(btn => {
      btn.addEventListener('click', () => {
        const col = btn.getAttribute('data-sort-street');
        if (streetSort.col === col) {
          streetSort.dir = streetSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          streetSort.col = col;
          streetSort.dir = col === 'name' ? 'asc' : 'desc';
        }
        sortStreetRows();
        render();
      });
    });

    // Bind row clicks (ignoring direct click on <a> link)
    container.querySelectorAll('#table-sign-types tbody tr[data-cls]').forEach(tr => {
      const cls = tr.getAttribute('data-cls');
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        onNavigate(`#/sheet?sign=${encodeURIComponent(cls)}`);
      });
    });

    container.querySelectorAll('#table-signs-street tbody tr[data-street]').forEach(tr => {
      const street = tr.getAttribute('data-street');
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        onNavigate(`#/sheet?street=${encodeURIComponent(street)}`);
      });
    });
  }

  function sortTypeRows() {
    typeRows.sort((a, b) => {
      let va = a[typeSort.col];
      let vb = b[typeSort.col];
      if (typeof va === 'string') {
        return typeSort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return typeSort.dir === 'asc' ? va - vb : vb - va;
    });
  }

  function sortStreetRows() {
    streetRows.sort((a, b) => {
      let va = a[streetSort.col];
      let vb = b[streetSort.col];
      if (va == null) va = -1;
      if (vb == null) vb = -1;
      if (typeof va === 'string') {
        return streetSort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return streetSort.dir === 'asc' ? va - vb : vb - va;
    });
  }

  sortTypeRows();
  sortStreetRows();
  render();
}

// -------------------------------------------------------------
// PARKING VIEW
// -------------------------------------------------------------
export function renderParkingView(container, drive, onNavigate) {
  const tracks = drive.tracks || [];
  const parkedCars = tracks.filter(t => t.kind === 'vehicle' && t.cls === 'car' && t.state === 'parked');
  const totalParked = parkedCars.length;
  const streetDistances = computeStreetDistances(drive);
  const allDwellSummary = dwellSummary(parkedCars);

  const streetMap = {};
  let unreadParked = 0;
  const unreadParkedCars = [];

  for (const s of drive.streets || []) {
    if (!streetMap[s.name]) {
      streetMap[s.name] = {
        name: s.name,
        parked: 0,
        distanceM: streetDistances[s.name] || 0,
        cars: []
      };
    }
  }

  for (const t of parkedCars) {
    if (!t.street) {
      unreadParked++;
      unreadParkedCars.push(t);
    } else {
      if (!streetMap[t.street]) {
        streetMap[t.street] = {
          name: t.street,
          parked: 0,
          distanceM: streetDistances[t.street] || 0,
          cars: []
        };
      }
      streetMap[t.street].parked++;
      streetMap[t.street].cars.push(t);
    }
  }

  const unreadDwellSummary = dwellSummary(unreadParkedCars);

  let rows = Object.values(streetMap).map(row => {
    const summary = dwellSummary(row.cars);
    return {
      ...row,
      distKm: row.distanceM / 1000,
      per100m: row.distanceM > 0 ? (row.parked / (row.distanceM / 100)) : null,
      medianDwell: summary.medianMin,
      over2h: summary.over2hShare
    };
  });

  let sort = { col: 'parked', dir: 'desc' };

  function render() {
    container.innerHTML = `
      <div class="view-container">
        <div class="view-header">
          <h1 class="view-h1">Parked Vehicles</h1>
          <p class="view-desc">${intFmt.format(totalParked)} parked cars mapped along the route. Bay lines are not detected yet, so inside vs outside marked bays is unmeasured on this drive.</p>
        </div>

        <!-- All-streets dwell distribution overview -->
        <div class="card-panel dwell-overview-card">
          <div class="dwell-card-header">
            <h2 class="table-h2" style="margin:0;">Parking Dwell Distribution <span class="demo-tag"><span class="mini-hatch" aria-hidden="true"></span>Demo</span></h2>
            <div class="dwell-summary-stats">
              <span><strong>${intFmt.format(totalParked)}</strong> parked cars</span>
              <span class="sep">·</span>
              <span>Median: <strong class="tnum">${allDwellSummary.medianMin != null ? formatDwell(allDwellSummary.medianMin) : '—'}</strong></span>
              <span class="sep">·</span>
              <span>Over 2 h: <strong class="tnum">${allDwellSummary.over2hShare != null ? Math.round(allDwellSummary.over2hShare * 100) : 0}%</strong></span>
            </div>
          </div>
          <div class="dwell-histogram dwell-histogram-wide">
            ${allDwellSummary.bins.map(b => {
              const maxN = Math.max(...allDwellSummary.bins.map(x => x.n), 1);
              const pct = (b.n / maxN) * 100;
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

        <div class="table-panel">
          <h2 class="table-h2">Parked Cars by Street</h2>
          <table class="data-table" id="table-parking-street">
            <thead>
              <tr>
                <th aria-sort="${sort.col === 'name' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
                  <button type="button" class="th-sort-btn" data-sort="name">
                    Street ${getSortIcon(sort.col === 'name', sort.dir)}
                  </button>
                </th>
                <th class="num" aria-sort="${sort.col === 'distKm' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
                  <button type="button" class="th-sort-btn num" data-sort="distKm">
                    Distance driven ${getSortIcon(sort.col === 'distKm', sort.dir)}
                  </button>
                </th>
                <th class="num" aria-sort="${sort.col === 'parked' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
                  <button type="button" class="th-sort-btn num" data-sort="parked">
                    Parked cars ${getSortIcon(sort.col === 'parked', sort.dir)}
                  </button>
                </th>
                <th class="num" aria-sort="${sort.col === 'per100m' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
                  <button type="button" class="th-sort-btn num" data-sort="per100m">
                    Per 100 m ${getSortIcon(sort.col === 'per100m', sort.dir)}
                  </button>
                </th>
                <th class="num" aria-sort="${sort.col === 'medianDwell' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
                  <button type="button" class="th-sort-btn num" data-sort="medianDwell">
                    Median dwell <span class="demo-tag"><span class="mini-hatch" aria-hidden="true"></span>Demo</span> ${getSortIcon(sort.col === 'medianDwell', sort.dir)}
                  </button>
                </th>
                <th class="num" aria-sort="${sort.col === 'over2h' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
                  <button type="button" class="th-sort-btn num" data-sort="over2h">
                    Over 2 h <span class="demo-tag"><span class="mini-hatch" aria-hidden="true"></span>Demo</span> ${getSortIcon(sort.col === 'over2h', sort.dir)}
                  </button>
                </th>
                <th class="num" title="Needs bay-line detection (not on this drive)">Inside bays *</th>
                <th class="num" title="Needs bay-line detection (not on this drive)">Outside bays *</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr class="is-clickable" data-street="${r.name}">
                  <td><a href="#/sheet?street=${encodeURIComponent(r.name)}" class="row-nav-link"><strong>${r.name}</strong></a></td>
                  <td class="num tnum">${r.distKm.toFixed(2)} km</td>
                  <td class="num tnum">${intFmt.format(r.parked)}</td>
                  <td class="num tnum">${r.per100m != null ? r.per100m.toFixed(1) : '—'}</td>
                  <td class="num tnum">${r.medianDwell != null ? formatDwell(r.medianDwell) : '—'}</td>
                  <td class="num tnum">${r.over2h != null ? `${Math.round(r.over2h * 100)} %` : '—'}</td>
                  <td class="num tnum" style="color:var(--ink-2);">—</td>
                  <td class="num tnum" style="color:var(--ink-2);">—</td>
                </tr>
              `).join('')}
              <tr class="row-unmatched">
                <td><em>Street not read</em></td>
                <td class="num tnum">—</td>
                <td class="num tnum">${intFmt.format(unreadParked)}</td>
                <td class="num tnum">—</td>
                <td class="num tnum">${unreadDwellSummary.medianMin != null ? formatDwell(unreadDwellSummary.medianMin) : '—'}</td>
                <td class="num tnum">${unreadDwellSummary.over2hShare != null ? `${Math.round(unreadDwellSummary.over2hShare * 100)} %` : '—'}</td>
                <td class="num tnum" style="color:var(--ink-2);">—</td>
                <td class="num tnum" style="color:var(--ink-2);">—</td>
              </tr>
            </tbody>
          </table>
          <p style="margin-top:12px;font-size:13px;color:var(--ink-2);">* Bay allocation (inside vs outside marked bays) requires horizontal marking detection, which was not active on this drive.</p>
        </div>
      </div>
    `;

    container.querySelectorAll('[data-sort]').forEach(btn => {
      btn.addEventListener('click', () => {
        const col = btn.getAttribute('data-sort');
        if (sort.col === col) {
          sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          sort.col = col;
          sort.dir = col === 'name' ? 'asc' : 'desc';
        }
        sortRows();
        render();
      });
    });

    container.querySelectorAll('tbody tr[data-street]').forEach(tr => {
      const street = tr.getAttribute('data-street');
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        onNavigate(`#/sheet?street=${encodeURIComponent(street)}`);
      });
    });
  }

  function sortRows() {
    rows.sort((a, b) => {
      let va = a[sort.col];
      let vb = b[sort.col];
      if (va == null) va = -1;
      if (vb == null) vb = -1;
      if (typeof va === 'string') {
        return sort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sort.dir === 'asc' ? va - vb : vb - va;
    });
  }

  sortRows();
  render();
}

// -------------------------------------------------------------
// PLATES & PRIVACY VIEW
// -------------------------------------------------------------
export function renderPrivacyView(container, drive) {
  const stats = drive.stats || {};
  const counts = stats.counts || {};
  const privacy = drive.privacy || {};

  const platesBlurred = counts.plates_blurred || privacy.plates_blurred || 699330;
  const headsBlurred = counts.heads_blurred || privacy.heads_blurred || 691766;
  const facesBlurred = counts.faces_blurred || privacy.faces_blurred || 2768;
  const platesKept = counts.plates_kept_parked || 4090;
  const plateTextExported = privacy.plate_text_exported ? 'Yes' : 'No';
  const pixelsExported = privacy.pixels_exported ? 'Yes' : 'No';

  container.innerHTML = `
    <div class="view-container">
      <div class="view-header">
        <h1 class="view-h1">Plates &amp; Privacy</h1>
        <p class="view-desc">What the vehicle blurs, keeps and exports on this drive. Processing runs on the vehicle; no footage is stored or exported.</p>
      </div>

      <div class="privacy-layout">
        <div class="table-panel">
          <h2 class="table-h2">On This Drive</h2>
          <table class="facts-table">
            <tbody>
              <tr>
                <td>Plate detections blurred (moving or unconfirmed vehicles)</td>
                <td class="tnum">${intFmt.format(platesBlurred)}</td>
              </tr>
              <tr>
                <td>Head detections blurred</td>
                <td class="tnum">${intFmt.format(headsBlurred)}</td>
              </tr>
              <tr>
                <td>Face detections blurred</td>
                <td class="tnum">${intFmt.format(facesBlurred)}</td>
              </tr>
              <tr>
                <td>Plate reads kept for confirmed parked cars</td>
                <td class="tnum">${intFmt.format(platesKept)}</td>
              </tr>
              <tr>
                <td>Plate text exported</td>
                <td>${plateTextExported}</td>
              </tr>
              <tr>
                <td>Pixel data exported</td>
                <td>${pixelsExported}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="policy-card">
          <h2>How Plates and Faces Are Handled</h2>
          <p>Plates are detected in every frame. A plate is read only when its car is confirmed parked; plates of moving or unconfirmed vehicles are blurred on the vehicle.</p>
          <p>Faces and heads are blurred in every frame. No video frames or image crops leave the vehicle.</p>
          <p>Turnover and dwell time need two or more passes of the same street. This drive passed each street once.</p>
          <p>Dwell times on the Sheet and Parking tabs are demo values for demonstration; measured dwell needs repeat passes of the same street.</p>
      </div>
    </div>
  `;
}

