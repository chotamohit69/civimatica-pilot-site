import { state } from './state.js';
import { formatTime } from './data.js';

export class ParkingSection {
  constructor(container) {
    this.container = container;
    state.on('dataLoaded', () => this.render());
  }

  render() {
    const drive = state.drive;
    if (!drive) return;

    const tracks = (drive.tracks || []).filter(t => t.kind === 'vehicle' && t.state === 'parked');
    const confirmedCount = tracks.filter(t => t.confirmed).length;

    // Per-street aggregation
    const streetCounts = {};
    for (const t of tracks) {
      const s = t.street || 'Other streets';
      if (!streetCounts[s]) streetCounts[s] = { total: 0, confirmed: 0 };
      streetCounts[s].total++;
      if (t.confirmed) streetCounts[s].confirmed++;
    }

    let streetBarsHtml = '';
    const sortedStreets = Object.entries(streetCounts).sort((a, b) => b[1].total - a[1].total);
    const maxStreetTotal = sortedStreets[0] ? sortedStreets[0][1].total : 1;

    for (const [street, counts] of sortedStreets) {
      const totalPct = ((counts.total / maxStreetTotal) * 100).toFixed(0);
      const confPct = ((counts.confirmed / counts.total) * 100).toFixed(0);

      streetBarsHtml += `
        <div style="margin-bottom: 0.85rem;">
          <div style="display:flex; justify-content:space-between; font-size: 0.82rem; margin-bottom: 3px;">
            <span><strong>${street}</strong></span>
            <span style="color: var(--accent-amber); font-weight: 600;">
              ${counts.confirmed} confirmed / ${counts.total} total
            </span>
          </div>
          <div style="width: 100%; height: 12px; background: var(--bg-card); border-radius: 4px; overflow: hidden; display: flex;">
            <div style="width: ${totalPct}%; height: 100%; background: rgba(232, 163, 61, 0.3); display: flex;">
              <div style="width: ${confPct}%; height: 100%; background: var(--accent-amber);"></div>
            </div>
          </div>
        </div>
      `;
    }

    // Confirmation Timeline dots
    let timelineDotsHtml = '';
    const dur = state.duration || 120;
    for (const t of tracks) {
      const posPct = ((t.t0 / dur) * 100).toFixed(1);
      const col = t.confirmed ? 'var(--accent-amber)' : 'var(--border-strong)';
      timelineDotsHtml += `
        <div title="${t.cls} at ${formatTime(t.t0)} (${t.street})"
          style="position: absolute; left: ${posPct}%; top: 6px; width: 8px; height: 8px; border-radius: 50%; background: ${col}; cursor: pointer; transform: translateX(-50%);"
          onclick="window.civimaticaFocusParked('${t.id}')">
        </div>
      `;
    }

    // List of parked vehicles
    let listRowsHtml = '';
    for (const t of tracks) {
      listRowsHtml += `
        <tr>
          <td><code>${t.id}</code></td>
          <td><strong style="text-transform: capitalize;">${t.cls}</strong></td>
          <td>${t.street || 'Street network'}</td>
          <td>
            ${t.confirmed ?
              `<span class="badge-family" style="background: rgba(232, 163, 61, 0.2); color: var(--accent-amber); border: 1px solid rgba(232, 163, 61, 0.4);">CONFIRMED PARKED</span>` :
              `<span class="badge-family" style="background: rgba(138, 148, 166, 0.15); color: #8A94A6; border: 1px solid #8A94A644;">UNCONFIRMED</span>`
            }
          </td>
          <td><code>${formatTime(t.t0)}</code></td>
          <td><strong style="color: var(--accent-cyan)">${(t.score * 100).toFixed(1)}%</strong></td>
          <td>
            <button class="btn-ctrl" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="window.civimaticaFocusParked('${t.id}')">
              Jump to 3D ↗
            </button>
          </td>
        </tr>
      `;
    }

    this.container.innerHTML = `
      <div class="overview-page">
        <div class="kpi-grid" style="margin-bottom: 1.5rem;">
          <div class="kpi-card">
            <span class="kpi-label">Confirmed Parked Vehicles</span>
            <span class="kpi-value" style="color: var(--accent-amber)">${confirmedCount}</span>
            <span class="kpi-sub">Cross-validated by motion tracker</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Total Parked Detections</span>
            <span class="kpi-value">${tracks.length}</span>
            <span class="kpi-sub">Vehicles stationary along curbs</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Surveyed Corridors</span>
            <span class="kpi-value">${sortedStreets.length}</span>
            <span class="kpi-sub">Street segments with curbside parking</span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
          <div class="rig-table-card">
            <div class="section-title">Parked Vehicles per Street</div>
            <div style="margin-top: 1rem;">
              ${streetBarsHtml || '<p style="color: var(--text-dim)">No parked vehicle records</p>'}
            </div>
          </div>

          <div class="rig-table-card">
            <div class="section-title">Timeline of Confirmations Across Drive</div>
            <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 1rem;">
              Amber dots indicate confirmed parked vehicles over survey timeline:
            </p>
            <div style="position: relative; height: 32px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 4px; overflow: hidden; margin-top: 0.5rem;">
              ${timelineDotsHtml}
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.7rem; color:var(--text-dim); margin-top: 4px;">
              <span>00:00</span>
              <span>${formatTime(state.duration / 2)}</span>
              <span>${formatTime(state.duration)}</span>
            </div>
          </div>
        </div>

        <div class="rig-table-card">
          <div class="section-title">Parked Vehicles Inventory</div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Track ID</th>
                  <th>Vehicle Class</th>
                  <th>Street</th>
                  <th>Confirmation Status</th>
                  <th>First Seen (t)</th>
                  <th>Confidence</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${listRowsHtml || '<tr><td colspan="7" style="text-align:center; color: var(--text-muted);">No parked vehicles</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    window.civimaticaFocusParked = (id) => {
      const trk = tracks.find(x => x.id === id);
      if (trk) {
        state.setTime(trk.t0);
        state.selectObject(trk);
        state.setSection('street');
      }
    };
  }
}
