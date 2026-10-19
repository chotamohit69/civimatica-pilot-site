import { state } from './state.js';
import { formatTime } from './data.js';

export class ParkingSection {
  constructor(container) {
    this.container = container;
    this.filterStatus = 'all'; // 'all' | 'confirmed' | 'unconfirmed'
    this.searchStreet = '';
    this.page = 1;
    this.pageSize = 25;
    this.timelineCanvas = null;
    this.timelineCtx = null;

    state.on('dataLoaded', () => this.render());
    state.on('timeUpdate', () => this.drawTimeline());
    state.on('sectionChange', (sec) => {
      if (sec === 'parking') {
        requestAnimationFrame(() => this.drawTimeline());
      }
    });
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
        <div style="margin-bottom: 0.75rem;">
          <div style="display:flex; justify-content:space-between; font-size: 0.8rem; margin-bottom: 3px;">
            <span><strong>${street}</strong></span>
            <span style="color: var(--accent-amber); font-weight: 600;">
              ${counts.confirmed} confirmed / ${counts.total} total
            </span>
          </div>
          <div style="width: 100%; height: 10px; background: var(--bg-card); border-radius: 4px; overflow: hidden; display: flex;">
            <div style="width: ${totalPct}%; height: 100%; background: rgba(232, 163, 61, 0.25); display: flex;">
              <div style="width: ${confPct}%; height: 100%; background: var(--accent-amber);"></div>
            </div>
          </div>
        </div>
      `;
    }

    this.container.innerHTML = `
      <div class="overview-page">
        <div class="kpi-grid" style="margin-bottom: 1.5rem;">
          <div class="kpi-card">
            <span class="kpi-label">Confirmed Parked Vehicles</span>
            <span class="kpi-value" style="color: var(--accent-amber)">${confirmedCount.toLocaleString()}</span>
            <span class="kpi-sub">Cross-validated by motion tracker</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Total Parked Detections</span>
            <span class="kpi-value">${tracks.length.toLocaleString()}</span>
            <span class="kpi-sub">Vehicles stationary along curbs</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Surveyed Corridors</span>
            <span class="kpi-value">${sortedStreets.length}</span>
            <span class="kpi-sub">Street segments with curbside parking</span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 1.5rem; margin-bottom: 1.5rem;">
          <div class="rig-table-card">
            <div class="section-title">Parked Vehicles per Street</div>
            <div style="margin-top: 1rem; max-height: 280px; overflow-y: auto;">
              ${streetBarsHtml || '<p style="color: var(--text-dim)">No parked vehicle records</p>'}
            </div>
          </div>

          <div class="rig-table-card">
            <div class="section-title">Timeline of Confirmations Across Drive</div>
            <p style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.75rem;">
              Amber marks indicate confirmed parked vehicles over survey timeline. Click timeline to seek:
            </p>
            <div style="position: relative; width: 100%; height: 60px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 6px; overflow: hidden;" id="parking-timeline-wrap">
              <canvas id="parking-timeline-canvas" style="width: 100%; height: 100%; display: block; cursor: pointer;"></canvas>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-dim); margin-top: 4px;">
              <span>00:00</span>
              <span>${formatTime(state.duration)}</span>
            </div>
          </div>
        </div>

        <div class="filter-bar">
          <input type="text" id="parking-street-search" class="search-input" placeholder="Search street name..." value="${this.searchStreet}">
          <div style="display: flex; gap: 0.4rem;">
            <button class="btn-ctrl ${this.filterStatus === 'all' ? 'btn-primary' : ''}" data-status="all">All Vehicles</button>
            <button class="btn-ctrl ${this.filterStatus === 'confirmed' ? 'btn-primary' : ''}" data-status="confirmed" style="border-left: 3px solid var(--accent-amber);">Confirmed Only</button>
            <button class="btn-ctrl ${this.filterStatus === 'unconfirmed' ? 'btn-primary' : ''}" data-status="unconfirmed">Unconfirmed</button>
          </div>
        </div>

        <div class="rig-table-card">
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Vehicle Class</th>
                  <th>Parking State</th>
                  <th>Street</th>
                  <th>First Seen</th>
                  <th>Score</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody id="parking-table-body">
              </tbody>
            </table>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle); font-size: 0.8rem;">
            <div id="parking-page-info" style="color: var(--text-muted);"></div>
            <div style="display: flex; gap: 0.5rem;">
              <button class="btn-ctrl" id="btn-parking-prev">◄ Prev</button>
              <button class="btn-ctrl" id="btn-parking-next">Next ►</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.setupTimeline(tracks);
    this.bindEvents(tracks);
    this.renderTable(tracks);
  }

  setupTimeline(tracks) {
    this.timelineCanvas = document.getElementById('parking-timeline-canvas');
    if (!this.timelineCanvas) return;
    this.timelineCtx = this.timelineCanvas.getContext('2d');

    this.timelineCanvas.addEventListener('click', (e) => {
      const rect = this.timelineCanvas.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      state.setTime(frac * state.duration);
    });

    window.addEventListener('resize', () => this.drawTimeline());
    this.drawTimeline();
  }

  drawTimeline() {
    if (!this.timelineCanvas || !this.timelineCtx) return;
    const drive = state.drive;
    if (!drive) return;

    const wrap = this.timelineCanvas.parentElement;
    const width = wrap ? wrap.clientWidth : 0;
    const height = wrap ? wrap.clientHeight : 0;
    if (width <= 0 || height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    this.timelineCanvas.width = width * dpr;
    this.timelineCanvas.height = height * dpr;
    this.timelineCtx.resetTransform();
    this.timelineCtx.scale(dpr, dpr);

    const ctx = this.timelineCtx;
    ctx.clearRect(0, 0, width, height);

    const dur = state.duration || 120;
    const tracks = (drive.tracks || []).filter(t => t.kind === 'vehicle' && t.state === 'parked');

    // Draw street segment alternating backgrounds
    if (drive.streets) {
      drive.streets.forEach((s, idx) => {
        const x0 = (s.t0 / dur) * width;
        const x1 = (s.t1 / dur) * width;
        ctx.fillStyle = idx % 2 === 0 ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(x0, 0, Math.max(1, x1 - x0), height);
      });
    }

    // Draw confirmed parked marks
    ctx.fillStyle = '#E8A33D';
    for (const t of tracks) {
      if (!t.confirmed) continue;
      const x = (t.t0 / dur) * width;
      ctx.fillRect(x, 10, 1.5, height - 20);
    }

    // Draw playhead
    const px = (state.t / dur) * width;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(px - 1, 0, 2, height);
  }

  bindEvents(tracks) {
    const searchInput = document.getElementById('parking-street-search');
    searchInput?.addEventListener('input', (e) => {
      this.searchStreet = e.target.value.toLowerCase();
      this.page = 1;
      this.renderTable(tracks);
    });

    document.querySelectorAll('.filter-bar button[data-status]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filterStatus = btn.getAttribute('data-status');
        document.querySelectorAll('.filter-bar button[data-status]').forEach(b => b.classList.remove('btn-primary'));
        btn.classList.add('btn-primary');
        this.page = 1;
        this.renderTable(tracks);
      });
    });

    document.getElementById('btn-parking-prev')?.addEventListener('click', () => {
      if (this.page > 1) {
        this.page--;
        this.renderTable(tracks);
      }
    });

    document.getElementById('btn-parking-next')?.addEventListener('click', () => {
      this.page++;
      this.renderTable(tracks);
    });
  }

  renderTable(tracks) {
    const tbody = document.getElementById('parking-table-body');
    const pageInfo = document.getElementById('parking-page-info');
    const btnPrev = document.getElementById('btn-parking-prev');
    const btnNext = document.getElementById('btn-parking-next');
    if (!tbody) return;

    let filtered = tracks.filter(t => {
      if (this.filterStatus === 'confirmed' && !t.confirmed) return false;
      if (this.filterStatus === 'unconfirmed' && t.confirmed) return false;
      if (this.searchStreet) {
        const matchStreet = (t.street || '').toLowerCase().includes(this.searchStreet);
        const matchCls = t.cls.toLowerCase().includes(this.searchStreet);
        if (!matchStreet && !matchCls) return false;
      }
      return true;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
    if (this.page > totalPages) this.page = totalPages;
    if (this.page < 1) this.page = 1;

    if (pageInfo) {
      pageInfo.textContent = `Showing ${(filtered.length === 0 ? 0 : (this.page - 1) * this.pageSize + 1)}–${Math.min(filtered.length, this.page * this.pageSize)} of ${filtered.length.toLocaleString()} parked vehicles (Page ${this.page} of ${totalPages})`;
    }
    if (btnPrev) btnPrev.disabled = this.page <= 1;
    if (btnNext) btnNext.disabled = this.page >= totalPages;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted); padding: 2rem;">No matching parked vehicles</td></tr>`;
      return;
    }

    const startIdx = (this.page - 1) * this.pageSize;
    const pageItems = filtered.slice(startIdx, startIdx + this.pageSize);

    let rows = '';
    for (const t of pageItems) {
      rows += `
        <tr data-id="${t.id}" class="parked-row" style="cursor: pointer;">
          <td><strong style="text-transform: capitalize;">${t.cls}</strong></td>
          <td>
            ${t.confirmed ?
              `<span class="badge-family" style="background: rgba(232, 163, 61, 0.2); color: var(--accent-amber); border: 1px solid rgba(232, 163, 61, 0.4);">CONFIRMED PARKED</span>` :
              `<span class="badge-family" style="background: rgba(138, 148, 166, 0.15); color: #8A94A6; border: 1px solid #8A94A644;">UNCONFIRMED</span>`
            }
          </td>
          <td>${t.street || 'Street network'}</td>
          <td><code>${formatTime(t.t0)}</code></td>
          <td><strong style="color: var(--accent-cyan)">${(t.score * 100).toFixed(1)}%</strong></td>
          <td>
            <button class="btn-ctrl btn-jump" data-id="${t.id}" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;">
              View 3D ↗
            </button>
          </td>
        </tr>
      `;
    }
    tbody.innerHTML = rows;

    const jumpToTrack = (trackId) => {
      const trk = tracks.find(x => x.id === trackId);
      if (trk) {
        state.setTime(trk.t0);
        state.selectObject(trk);
        state.setSection('street');
      }
    };

    tbody.querySelectorAll('.parked-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-id');
        jumpToTrack(id);
      });
    });

    tbody.querySelectorAll('.btn-jump').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        jumpToTrack(id);
      });
    });
  }
}
