import { state } from './state.js';
import { formatTime, getSignFamily } from './data.js';

export class OverviewSection {
  constructor(container) {
    this.container = container;
    this.canvas = null;
    this.ctx = null;

    state.on('dataLoaded', () => this.render());
    state.on('timeUpdate', () => this.updatePlayhead());
    // Canvas has no size while its tab is hidden; redraw when shown.
    state.on('sectionChange', (sec) => { if (sec === 'overview') this.drawSparkline(); });
  }

  render() {
    const drive = state.drive;
    const scene = state.scene;
    if (!drive) return;

    // Calculate km driven
    let totalMeters = 0;
    if (drive.route && drive.route.x && drive.route.x.length > 1) {
      for (let i = 1; i < drive.route.x.length; i++) {
        const dx = drive.route.x[i] - drive.route.x[i - 1];
        const dy = drive.route.y[i] - drive.route.y[i - 1];
        totalMeters += Math.hypot(dx, dy);
      }
    }
    const kmDriven = (totalMeters / 1000).toFixed(2);

    // Compute unique sign families
    const tracks = drive.tracks || [];
    const signs = tracks.filter(t => t.kind === 'sign');
    const familyCounts = { prohibitory: 0, mandatory: 0, warning: 0, parking: 0, other: 0 };
    for (const s of signs) {
      const fam = getSignFamily(s.cls).family;
      if (familyCounts[fam] !== undefined) familyCounts[fam]++;
      else familyCounts.other++;
    }

    const parkedConfirmed = tracks.filter(t => t.kind === 'vehicle' && t.confirmed).length;
    const totalParked = tracks.filter(t => t.kind === 'vehicle' && t.state === 'parked').length;
    const movingVehicles = tracks.filter(t => t.kind === 'vehicle' && t.state === 'moving').length;
    const sideObjects = tracks.filter(t => t.kind === 'object').length;
    const devFps = drive.stats && drive.stats.fps ? drive.stats.fps : 14.6;

    this.container.innerHTML = `
      <div class="overview-page">
        <div class="overview-banner">
          <div>
            <h1>Civimatica · Milan Pilot Survey</h1>
            <p>
              Street-survey pipeline run on a Milan drive video. Source: YouTube <code>i84Ak9XpUUs</code> (October 2025), processed as the front camera.<br>
              <strong style="color: var(--accent-yellow)">Note:</strong> This video has no GNSS, so the route is rebuilt from the street names shown in the video and OpenStreetMap. Object positions are estimated from one camera.
            </p>
          </div>
          <div style="text-align: right">
            <span class="pilot-tag">Video inference run</span>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem">
              Device: <strong>${drive.stats && drive.stats.device ? drive.stats.device : 'Jetson Orin Nano 8 GB'}</strong>
            </div>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">Survey Duration</span>
            <span class="kpi-value">${formatTime(state.duration)}</span>
            <span class="kpi-sub">${state.duration.toFixed(0)} seconds elapsed</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Reconstructed Route</span>
            <span class="kpi-value">${kmDriven} <span style="font-size: 1rem">km</span></span>
            <span class="kpi-sub">${drive.route && drive.route.t ? drive.route.t.length : 0} waypoints</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Sign tracks</span>
            <span class="kpi-value">${signs.length}</span>
            <span class="kpi-sub" style="display:flex; gap: 4px; font-size: 0.72rem; margin-top: 4px;">
              <span style="color:#D9483B">P:${familyCounts.prohibitory}</span> ·
              <span style="color:#2F6FDE">M:${familyCounts.mandatory}</span> ·
              <span style="color:#F2C14E">W:${familyCounts.warning}</span> ·
              <span style="color:#3D7BD9">Pk:${familyCounts.parking}</span>
            </span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Parked Confirmed</span>
            <span class="kpi-value" style="color: var(--accent-amber)">${parkedConfirmed}</span>
            <span class="kpi-sub">${totalParked} total parked detections</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Moving Vehicles</span>
            <span class="kpi-value" style="color: var(--accent-cyan)">${movingVehicles}</span>
            <span class="kpi-sub">Moving vehicle tracks</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Side Objects</span>
            <span class="kpi-value">${sideObjects}</span>
            <span class="kpi-sub">Meters, stops, e-scooters</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Pipeline speed</span>
            <span class="kpi-value" style="color: var(--accent-green)">${devFps} <span style="font-size: 1rem">FPS</span></span>
            <span class="kpi-sub">On the Jetson, tiled 1080p sign search on 4K video</span>
          </div>
        </div>

        <div class="sparkline-section">
          <div class="section-title">
            <span>Detection Density over Drive &amp; Street Segments</span>
            <span style="font-size: 0.78rem; font-weight: normal; color: var(--text-muted)">
              <span style="color: var(--accent-blue)">■</span> Signs &nbsp;
              <span style="color: var(--accent-cyan)">■</span> Vehicles &nbsp;
              <span style="color: var(--accent-amber)">■</span> Parked Confirmed
            </span>
          </div>
          <div class="sparkline-wrap" id="sparkline-container">
            <canvas id="overview-sparkline" class="sparkline-canvas"></canvas>
          </div>
        </div>
      </div>
    `;

    this.setupSparkline();
  }

  setupSparkline() {
    this.canvas = document.getElementById('overview-sparkline');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    // Handle clicks to jump time
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / rect.width;
      const targetT = frac * state.duration;
      state.setTime(targetT);
    });

    window.addEventListener('resize', () => this.drawSparkline());
    this.drawSparkline();
  }

  drawSparkline() {
    if (!this.canvas || !this.ctx) return;
    const drive = state.drive;
    if (!drive) return;

    const width = this.canvas.parentElement.clientWidth;
    const height = this.canvas.parentElement.clientHeight;
    this.canvas.width = width * window.devicePixelRatio;
    this.canvas.height = height * window.devicePixelRatio;
    this.ctx.resetTransform();
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);

    const dur = state.duration || 120.0;
    const streets = drive.streets || [];

    // Draw street bands
    streets.forEach((s, idx) => {
      const x0 = (s.t0 / dur) * width;
      const x1 = (s.t1 / dur) * width;
      const w = Math.max(1, x1 - x0);

      ctx.fillStyle = idx % 2 === 0 ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(x0, 0, w, height);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      ctx.moveTo(x1, 0);
      ctx.lineTo(x1, height);
      ctx.stroke();

      // Street label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.fillText(s.name, x0 + 8, 18);
    });

    // Draw density curves
    const density = drive.density;
    if (density && density.signs && density.vehicles) {
      const N = density.signs.length;
      let maxVal = 1;
      for (let i = 0; i < N; i++) {
        maxVal = Math.max(maxVal, density.signs[i] || 0, density.vehicles[i] || 0, (density.parked && density.parked[i]) || 0);
      }
      maxVal = Math.max(maxVal, 4);

      const drawCurve = (arr, color, fillColor) => {
        if (!arr || arr.length === 0) return;
        ctx.beginPath();
        for (let i = 0; i < arr.length; i++) {
          const x = (i / (arr.length - 1)) * width;
          const y = height - 10 - ((arr[i] || 0) / maxVal) * (height - 35);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.lineTo(width, height - 10);
        ctx.lineTo(0, height - 10);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
      };

      drawCurve(density.vehicles, '#2BB3A3', 'rgba(43, 179, 163, 0.12)');
      drawCurve(density.signs, '#3D7BD9', 'rgba(61, 123, 217, 0.15)');
      if (density.parked) {
        drawCurve(density.parked, '#E8A33D', 'rgba(232, 163, 61, 0.18)');
      }
    }

    // Draw playhead directly at the end of sparkline pass
    const headX = (state.t / dur) * width;
    ctx.save();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(headX, 0);
    ctx.lineTo(headX, height);
    ctx.stroke();

    // Playhead handle
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(headX, height - 6, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  updatePlayhead() {
    // Only redraw sparkline if Overview section is currently active
    if (state.activeSection === 'overview') {
      this.drawSparkline();
    }
  }
}
