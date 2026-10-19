import * as THREE from 'three';
import { state } from './state.js';
import { formatTime } from './data.js';

export class CamerasSection {
  constructor(container, streetSection) {
    this.container = container;
    this.street = streetSection;
    this.camViews = [];
    this.animId = null;

    state.on('dataLoaded', () => this.render());
    state.on('timeUpdate', () => this.updateOverlays());
    state.on('sectionChange', (sec) => {
      if (sec === 'cameras') {
        this.startLoop();
      } else {
        this.stopLoop();
      }
    });
  }

  render() {
    const drive = state.drive;
    const rig = state.rig;
    if (!drive) return;
    this.c1BoxTracks = (drive.tracks || []).filter(t => t.cam === 'c1' && t.box && t.box.length > 0);

    const cameras = drive.cameras || [
      { id: 'c0', name: 'Front stereo (binocular)', yaw_deg: 0, hfov_deg: 110.7, in_run: false },
      { id: 'c1', name: 'Front 12 MP', yaw_deg: 0, hfov_deg: 95.9, in_run: true },
      { id: 'c2', name: 'Right 5 MP global shutter', yaw_deg: -70, hfov_deg: 68.6, in_run: false },
      { id: 'c3', name: 'Left 5 MP global shutter', yaw_deg: 70, hfov_deg: 64.8, in_run: false }
    ];

    let gridHtml = '';
    for (const cam of cameras) {
      const isLive = cam.in_run;
      gridHtml += `
        <div class="camera-card">
          <div class="camera-card-header">
            <span class="camera-title">
              <strong>${cam.id.toUpperCase()}</strong> · ${cam.name}
            </span>
            ${isLive ?
              `<span class="cam-live-badge">● LIVE PIPELINE SOURCE</span>` :
              `<span class="cam-sim-badge">Simulated OSM view</span>`
            }
          </div>
          <div class="cam-viewport-wrap" id="wrap-cam-${cam.id}">
            <canvas id="canvas-cam-${cam.id}"></canvas>
            ${isLive ? `<div class="cam-bbox-overlay" id="bbox-cam-${cam.id}"></div>` : ''}
            ${!isLive ? `
              <div style="position: absolute; bottom: 8px; left: 10px; font-size: 0.7rem; background: rgba(0,0,0,0.7); padding: 3px 7px; border-radius: 4px; color: #A0AEC0;">
                Simulated view from OSM model — no footage from this camera in this run
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    // Rig table HTML
    let rigRowsHtml = '';
    const rigCams = (rig && rig.cameras) ? rig.cameras : cameras;
    for (const rc of rigCams) {
      rigRowsHtml += `
        <tr>
          <td><strong style="color: var(--accent-cyan)">${rc.id.toUpperCase()}</strong></td>
          <td><strong>${rc.name}</strong><br><span style="color: var(--text-dim); font-size: 0.72rem">${rc.model || 'OEM'}</span></td>
          <td>${rc.mount || 'Roof rig'}</td>
          <td>${rc.resolution ? `${rc.resolution[0]}×${rc.resolution[1]}` : 'N/A'}</td>
          <td>${rc.capture_fps ? `${rc.capture_fps} fps` : '30 fps'}</td>
          <td>${rc.hfov_deg ? `${rc.hfov_deg}° H / ${rc.vfov_deg || '-'}° V` : '-'}</td>
          <td>${rc.calib_rms_px ? `${rc.calib_rms_px} px` : 'Calibrated'}</td>
          <td>${rc.task || 'Perception'}<br><span style="color: var(--accent-green); font-size: 0.72rem">${rc.task_fps ? `${rc.task_fps} fps` : ''}</span></td>
        </tr>
      `;
    }

    this.container.innerHTML = `
      <div class="cameras-page">
        <div class="section-title">
          <span>Multi-Camera Rig Viewports</span>
          <span style="font-size: 0.8rem; color: var(--text-muted)">Synchronized to survey time <code>t</code></span>
        </div>

        <div class="cameras-grid">
          ${gridHtml}
        </div>

        <div class="rig-table-card">
          <div class="section-title" style="margin-bottom: 0.75rem;">
            <span>Hardware Rig &amp; Calibration Specifications</span>
            <span style="font-size: 0.78rem; color: var(--accent-yellow)">
              ${rig && rig.device ? `${rig.device.name} · ${rig.device.power_mode}` : 'Jetson Orin Nano 8 GB'}
            </span>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Cam</th>
                  <th>Sensor &amp; Model</th>
                  <th>Mount Location</th>
                  <th>Resolution</th>
                  <th>Capture Rate</th>
                  <th>FOV (H / V)</th>
                  <th>Calib RMS</th>
                  <th>Pipeline Task</th>
                </tr>
              </thead>
              <tbody>
                ${rigRowsHtml}
              </tbody>
            </table>
          </div>
          ${rig && rig.sensors ? `
            <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle); font-size: 0.78rem; color: var(--text-muted);">
              <strong>Additional Sensors:</strong> ${rig.sensors.map(s => `${s.name} (${s.mount}) — ${s.status}`).join('; ')}
            </div>
          ` : ''}
        </div>
      </div>
    `;

    this.setupViewports(cameras);
  }

  setupViewports(cameras) {
    this.camViews = [];

    for (const cam of cameras) {
      const canvas = document.getElementById(`canvas-cam-${cam.id}`);
      const wrap = document.getElementById(`wrap-cam-${cam.id}`);
      if (!canvas || !wrap) continue;

      const w = wrap.clientWidth || 480;
      const h = wrap.clientHeight || 270;
      const aspect = w / h;

      // Vertical FOV calculation from HFOV
      const hfovRad = ((cam.hfov_deg || 80) * Math.PI) / 180;
      const vfovDeg = (2 * Math.atan(Math.tan(hfovRad / 2) / aspect) * 180) / Math.PI;

      const threeCam = new THREE.PerspectiveCamera(vfovDeg, aspect, 0.2, 400);

      const renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: false,
        powerPreference: 'low-power'
      });
      renderer.setSize(w, h);
      renderer.setPixelRatio(1);

      this.camViews.push({
        id: cam.id,
        yawDeg: cam.yaw_deg || 0,
        threeCam,
        renderer,
        canvas,
        wrap
      });
    }

    if (state.activeSection === 'cameras') {
      this.startLoop();
    }
  }

  updateOverlays() {
    if (state.activeSection !== 'cameras') return;
    if (!this.c1BoxTracks) return;
    const overlay = document.getElementById('bbox-cam-c1');
    if (!overlay) return;

    const t = state.t;
    let boxesHtml = '';

    for (let i = 0; i < this.c1BoxTracks.length; i++) {
      const trk = this.c1BoxTracks[i];
      if (t < trk.t0 || t > trk.t1) continue;

      // Find closest box at time t
      let bestBox = null, minDist = 0.35;
      for (const b of trk.box) {
        const dist = Math.abs(b[0] - t);
        if (dist < minDist) {
          minDist = dist;
          bestBox = b;
        }
      }

      if (bestBox) {
        const [bt, x1, y1, x2, y2] = bestBox;
        const left = (x1 * 100).toFixed(1);
        const top = (y1 * 100).toFixed(1);
        const w = ((x2 - x1) * 100).toFixed(1);
        const h = ((y2 - y1) * 100).toFixed(1);
        const label = `${trk.cls.replace(/_/g, ' ')} ${(trk.score * 100).toFixed(0)}%`;

        boxesHtml += `
          <div class="bbox-rect" style="left: ${left}%; top: ${top}%; width: ${w}%; height: ${h}%;">
            <span class="bbox-label">${label}</span>
          </div>
        `;
      }
    }

    overlay.innerHTML = boxesHtml;
  }

  renderFrame() {
    if (!this.street || !this.street.scene) return;
    const ego = state.getEgoAt(state.t);

    for (const cv of this.camViews) {
      // Place camera on ego car roof rig
      const yawRad = (cv.yawDeg * Math.PI) / 180;
      const totalHeading = ego.h + yawRad;

      // Position on roof
      cv.threeCam.position.set(ego.x, 1.62, -ego.y);
      cv.threeCam.lookAt(
        ego.x + Math.cos(totalHeading) * 20.0,
        1.5,
        -ego.y - Math.sin(totalHeading) * 20.0
      );

      cv.renderer.render(this.street.scene, cv.threeCam);
    }
  }

  startLoop() {
    if (this.animId) return;
    const loop = () => {
      this.renderFrame();
      this.updateOverlays();
      this.animId = requestAnimationFrame(loop);
    };
    this.animId = requestAnimationFrame(loop);
  }

  stopLoop() {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }
}
