import { state } from './state.js';
import { getSignFamily, formatTime } from './data.js';

export class SignsSection {
  constructor(container) {
    this.container = container;
    this.searchTerm = '';
    this.familyFilter = 'all';
    this.sortCol = 'score';
    this.sortAsc = false;

    state.on('dataLoaded', () => this.render());
  }

  render() {
    const drive = state.drive;
    if (!drive) return;

    const tracks = (drive.tracks || []).filter(t => t.kind === 'sign');

    // Class frequency histogram counts
    const classCounts = {};
    for (const s of tracks) {
      classCounts[s.cls] = (classCounts[s.cls] || 0) + 1;
    }
    const sortedClasses = Object.entries(classCounts).sort((a, b) => b[1] - a[1]);
    const maxClassCount = sortedClasses[0] ? sortedClasses[0][1] : 1;

    let histBarsHtml = '';
    for (const [cls, cnt] of sortedClasses.slice(0, 8)) {
      const fam = getSignFamily(cls);
      const pct = ((cnt / maxClassCount) * 100).toFixed(0);
      histBarsHtml += `
        <div style="margin-bottom: 0.5rem;">
          <div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom: 2px;">
            <span>${cls.replace(/_/g, ' ')}</span>
            <span style="font-weight: 700; color: ${fam.color}">${cnt}</span>
          </div>
          <div style="width: 100%; height: 6px; background: var(--bg-card); border-radius: 3px; overflow: hidden;">
            <div style="width: ${pct}%; height: 100%; background: ${fam.color};"></div>
          </div>
        </div>
      `;
    }

    this.container.innerHTML = `
      <div class="overview-page">
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
          <div class="kpi-card">
            <span class="kpi-label">Sign Perception Summary</span>
            <span class="kpi-value">${tracks.length}</span>
            <span class="kpi-sub">Total unique traffic sign tracks identified</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Top Sign Classes (Histogram)</span>
            <div style="margin-top: 0.5rem;">
              ${histBarsHtml || '<span style="color:var(--text-dim)">No signs detected</span>'}
            </div>
          </div>
        </div>

        <div class="filter-bar">
          <input type="text" id="sign-search" class="search-input" placeholder="Search class or street name..." value="${this.searchTerm}">
          <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;" id="sign-family-filters">
            <button class="btn-ctrl ${this.familyFilter === 'all' ? 'btn-primary' : ''}" data-fam="all">All Families</button>
            <button class="btn-ctrl ${this.familyFilter === 'prohibitory' ? 'btn-primary' : ''}" data-fam="prohibitory" style="border-left: 3px solid #D9483B;">Prohibitory</button>
            <button class="btn-ctrl ${this.familyFilter === 'mandatory' ? 'btn-primary' : ''}" data-fam="mandatory" style="border-left: 3px solid #2F6FDE;">Mandatory</button>
            <button class="btn-ctrl ${this.familyFilter === 'warning' ? 'btn-primary' : ''}" data-fam="warning" style="border-left: 3px solid #F2C14E;">Warning</button>
            <button class="btn-ctrl ${this.familyFilter === 'parking' ? 'btn-primary' : ''}" data-fam="parking" style="border-left: 3px solid #3D7BD9;">Parking</button>
          </div>
        </div>

        <div class="rig-table-card">
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th data-sort="cls">Sign Class ↕</th>
                  <th>Family</th>
                  <th data-sort="street">Street ↕</th>
                  <th data-sort="t0">First Seen (t) ↕</th>
                  <th data-sort="score">Confidence Score ↕</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody id="signs-table-body">
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(tracks);
    this.renderTable(tracks);
  }

  bindEvents(tracks) {
    const searchInput = document.getElementById('sign-search');
    searchInput?.addEventListener('input', (e) => {
      this.searchTerm = e.target.value.toLowerCase();
      this.renderTable(tracks);
    });

    document.querySelectorAll('#sign-family-filters button').forEach(btn => {
      btn.addEventListener('click', () => {
        this.familyFilter = btn.getAttribute('data-fam');
        document.querySelectorAll('#sign-family-filters button').forEach(b => b.classList.remove('btn-primary'));
        btn.classList.add('btn-primary');
        this.renderTable(tracks);
      });
    });

    document.querySelectorAll('.data-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-sort');
        if (this.sortCol === col) {
          this.sortAsc = !this.sortAsc;
        } else {
          this.sortCol = col;
          this.sortAsc = col === 'cls' || col === 'street';
        }
        this.renderTable(tracks);
      });
    });
  }

  renderTable(tracks) {
    const tbody = document.getElementById('signs-table-body');
    if (!tbody) return;

    // Filter
    let filtered = tracks.filter(t => {
      const fam = getSignFamily(t.cls);
      if (this.familyFilter !== 'all' && fam.family !== this.familyFilter) return false;
      if (this.searchTerm) {
        const matchCls = t.cls.toLowerCase().includes(this.searchTerm);
        const matchStreet = (t.street || '').toLowerCase().includes(this.searchTerm);
        if (!matchCls && !matchStreet) return false;
      }
      return true;
    });

    // Sort
    filtered.sort((a, b) => {
      let va = a[this.sortCol];
      let vb = b[this.sortCol];
      if (va === undefined || va === null) va = '';
      if (vb === undefined || vb === null) vb = '';
      if (typeof va === 'string') {
        const res = va.localeCompare(vb);
        return this.sortAsc ? res : -res;
      }
      return this.sortAsc ? va - vb : vb - va;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted); padding: 2rem;">No matching signs found</td></tr>`;
      return;
    }

    let rows = '';
    for (const t of filtered) {
      const fam = getSignFamily(t.cls);
      rows += `
        <tr data-id="${t.id}">
          <td><strong>${t.cls.replace(/_/g, ' ')}</strong></td>
          <td><span class="badge-family" style="background: ${fam.color}22; color: ${fam.color}; border: 1px solid ${fam.color}44;">${fam.label}</span></td>
          <td>${t.street || 'Street network'}</td>
          <td><code>${formatTime(t.t0)}</code></td>
          <td><strong style="color: var(--accent-cyan)">${(t.score * 100).toFixed(1)}%</strong></td>
          <td>
            <button class="btn-ctrl" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="window.civimaticaFocusSign('${t.id}')">
              Focus 3D ↗
            </button>
          </td>
        </tr>
      `;
    }
    tbody.innerHTML = rows;

    window.civimaticaFocusSign = (id) => {
      const trk = tracks.find(x => x.id === id);
      if (trk) {
        state.setTime(trk.t0);
        state.selectObject(trk);
        state.setSection('street');
      }
    };
  }
}
