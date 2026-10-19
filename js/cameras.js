import * as THREE from 'three';
import { state } from './state.js';
import { formatTime } from './data.js';
import * as streetModule from './street.js';

export class CamerasSection {
  constructor(container, streetSection) {
    this.container = container;
    this.street = streetSection;
    this.camViews = [];
    this.animId = null;

    state.on('dataLoaded', () => this.render());
    state.on('timeUpdate', () => {
      if (state.activeSection === 'cameras') {
        this.renderFrame();
        this.updateOverlays();
      }
    });
    state.on('sectionChange', (sec) => {
      if (sec === 'cameras') {
        requestAnimationFrame(() => {
          this.initRenderers();
          this.startLoop();
        });
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

    const cameras = (rig && rig.cameras) ? rig.cameras : (drive.cameras || [
      { id: 'c3', name: 'Left 5 MP global shutter', yaw_deg: 70, hfov_deg: 64.8, vfov_deg: 52.0 },
      { id: 'c0', name: 'Front stereo (binocular)', yaw_deg: 0, hfov_deg: 110.7, vfov_deg: 96.5 },
      { id: 'c1', name: 'Front 12 MP', yaw_deg: 0, hfov_deg: 95.9, vfov_deg: 78.8 },
      { id: 'c2', name: 'Right 5 MP global shutter', yaw_deg: -70, hfov_deg: 68.6, vfov_deg: 54.1 }
    ]);

    const camMap = {};
    for (const c of cameras) camMap[c.id] = c;

    const renderCamCard = (camId) => {
      const cam = camMap[camId] || { id: camId, name: camId, yaw_deg: 0, hfov_deg: 80 };
      const isLive = cam.id === 'c1';
      return `
        <div class="camera-card" id="card-cam-${cam.id}">
          <div class="camera-card-header">
            <span class="camera-title">
              <strong>${cam.id.toUpperCase()}</strong> · ${cam.name}
            </span>
            ${isLive ?
              `<span class="cam-live-badge">● Pipeline source (drive video)</span>` :
              `<span class="cam-sim-badge">Simulated OSM view</span>`
            }
          </div>
          <div class="cam-viewport-wrap" id="wrap-cam-${cam.id}">
            <canvas id="canvas-cam-${cam.id}"></canvas>
            <canvas id="schematic-cam-${cam.id}" style="display:none; position:absolute; top:0; left:0; width:100%; height:100%;"></canvas>
            ${isLive ? `<div class="cam-bbox-overlay" id="bbox-cam-${cam.id}"></div>` : ''}
            ${!isLive ? `
              <div class="cam-sim-watermark">
                Simulated view from OSM model — no footage from this camera in this run
              </div>
            ` : ''}
          </div>
        </div>
      `;
    };

    // Rig table rows
    let rigRowsHtml = '';
    for (const rc of cameras) {
      const isSide = rc.id === 'c2' || rc.id === 'c3';
      const mountText = isSide ? `${rc.mount} <em style="color:var(--accent-yellow); font-size:0.75rem;">(side yaw estimated)</em>` : (rc.mount || 'Front rig');
      const taskFpsText = rc.task_fps !== null && rc.task_fps !== undefined ? `${rc.task_fps} fps` : '<span style="color: var(--accent-yellow); font-style: italic;">benchmark in progress</span>';
      const baselineText = rc.stereo && rc.stereo.baseline_mm ? `<br><span style="color: var(--accent-cyan); font-size: 0.72rem;">Baseline: ${rc.stereo.baseline_mm} mm (RMS: ${rc.stereo.rms_px} px)</span>` : '';
      const calibViews = rc.calib_views ? ` (${rc.calib_views} views)` : '';

      rigRowsHtml += `
        <tr>
          <td><strong style="color: var(--accent-cyan)">${rc.id.toUpperCase()}</strong></td>
          <td><strong>${rc.name}</strong><br><span style="color: var(--text-dim); font-size: 0.72rem">${rc.model || 'OEM'} ${rc.note ? `· ${rc.note}` : ''}</span></td>
          <td>${mountText}</td>
          <td>${rc.resolution ? `${rc.resolution[0]}×${rc.resolution[1]}` : 'N/A'}</td>
          <td>${rc.capture_fps ? `${rc.capture_fps} fps` : '30 fps'}</td>
          <td>${rc.hfov_deg ? `${rc.hfov_deg}° H / ${rc.vfov_deg || '-'}° V` : '-'}</td>
          <td>${rc.calib_rms_px ? `${rc.calib_rms_px} px${calibViews}` : 'Calibrated'}</td>
          <td>
            ${rc.task || 'Perception'}${baselineText}<br>
            <span style="color: var(--accent-green); font-size: 0.75rem;">${taskFpsText}</span>
          </td>
        </tr>
      `;
    }

    // Radar row
    if (rig && rig.sensors) {
      for (const s of rig.sensors) {
        rigRowsHtml += `
          <tr style="background: rgba(43, 179, 163, 0.05);">
            <td><strong style="color: var(--accent-amber)">${s.id ? s.id.toUpperCase() : 'RADAR'}</strong></td>
            <td><strong>${s.name}</strong></td>
            <td>${s.mount || 'Rig mount'}</td>
            <td>60 GHz Radar</td>
            <td>10 Hz</td>
            <td>N/A</td>
            <td>Pending radar calib</td>
            <td><span style="color: var(--accent-yellow); font-size: 0.75rem;">${s.status}</span></td>
          </tr>
        `;
      }
    }

    const devInfo = rig && rig.device ? rig.device : {};
    const devLine = `${devInfo.name || 'Jetson Orin Nano 8 GB'} · ${devInfo.software || 'JetPack 7, TensorRT'} · Power: ${devInfo.power_mode || 'MAXN_SUPER'}`;

    this.container.innerHTML = `
      <div class="cameras-page">
        <div class="section-title">
          <span>Multi-Camera Rig Viewports</span>
          <span style="font-size: 0.8rem; color: var(--text-muted)">Synchronized to survey time <code>t</code></span>
        </div>

        <!-- 3-Column Rig Layout: Left c3 | Center c0 + c1 | Right c2 -->
        <div class="rig-camera-layout">
          <div class="rig-col-side" id="col-c3">
            <div class="rig-col-label">LEFT CAMERA (YAW +70°)</div>
            ${renderCamCard('c3')}
          </div>
          <div class="rig-col-center" id="col-front">
            <div class="rig-col-label">FRONT CAMERAS (CENTRE YAW 0°)</div>
            ${renderCamCard('c0')}
            ${renderCamCard('c1')}
          </div>
          <div class="rig-col-side" id="col-c2">
            <div class="rig-col-label">RIGHT CAMERA (YAW -70°)</div>
            ${renderCamCard('c2')}
          </div>
        </div>

        <div class="rig-table-card">
          <div class="section-title" style="margin-bottom: 0.75rem;">
            <span>Hardware Rig &amp; Calibration Specifications</span>
            <span style="font-size: 0.82rem; color: var(--accent-yellow);">
              ${devLine}
            </span>
          </div>

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Sensor</th>
                  <th>Model &amp; Details</th>
                  <th>Mount Location</th>
                  <th>Resolution</th>
                  <th>Capture Rate</th>
                  <th>FOV (H / V)</th>
                  <th>Calib RMS</th>
                  <th>Pipeline Task &amp; Speed</th>
                </tr>
              </thead>
              <tbody>
                ${rigRowsHtml}
              </tbody>
            </table>
          </div>

          ${rig ? `
            <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle); font-size: 0.78rem; color: var(--text-muted); line-height: 1.6;">
              ${rig.measured ? `<div><strong>Rig Calibration:</strong> ${rig.measured}</div>` : ''}
              ${rig.pipeline_run ? `<div><strong>Pipeline Benchmark Run:</strong> ${rig.pipeline_run}</div>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `;

    this.initRenderers();
  }

  initRenderers() {
    const drive = state.drive;
    const rig = state.rig;
    if (!drive) return;

    const cameras = (rig && rig.cameras) ? rig.cameras : (drive.cameras || []);
    this.camViews = [];

    for (const cam of cameras) {
      const canvas = document.getElementById(`canvas-cam-${cam.id}`);
      const wrap = document.getElementById(`wrap-cam-${cam.id}`);
      if (!canvas || !wrap) continue;

      const w = wrap.clientWidth || 400;
      const h = wrap.clientHeight || 225;
      const aspect = w / Math.max(1, h);

      const hfovRad = ((cam.hfov_deg || 80) * Math.PI) / 180;
      const vfovDeg = (2 * Math.atan(Math.tan(hfovRad / 2) / aspect) * 180) / Math.PI;

      let renderer = null;
      try {
        renderer = new THREE.WebGLRenderer({
          canvas: canvas,
          antialias: false,
          powerPreference: 'low-power'
        });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      } catch (err) {
        console.warn(`WebGL not available for camera ${cam.id}, will use 2D schematic FOV:`, err);
      }

      const threeCam = new THREE.PerspectiveCamera(vfovDeg, aspect, 0.2, 450);

      this.camViews.push({
        id: cam.id,
        camInfo: cam,
        yawDeg: cam.yaw_deg || (cam.id === 'c3' ? 70 : cam.id === 'c2' ? -70 : 0),
        hfovDeg: cam.hfov_deg || 80,
        threeCam,
        renderer,
        canvas,
        schematicCanvas: document.getElementById(`schematic-cam-${cam.id}`),
        wrap
      });
    }

    this.renderFrame();
    this.updateOverlays();
  }

  renderFrame() {
    const t = state.t;
    const ego = state.getEgoAt(t);

    for (const cv of this.camViews) {
      const w = cv.wrap.clientWidth || 400;
      const h = cv.wrap.clientHeight || 225;

      // 1. Try external renderCameraView from streetModule or streetSection
      let rendered = false;
      if (streetModule && typeof streetModule.renderCameraView === 'function') {
        try {
          streetModule.renderCameraView(cv.renderer, cv.id, t, w, h);
          rendered = true;
        } catch (e) {
          rendered = false;
        }
      }

      if (!rendered && this.street && typeof this.street.renderCameraView === 'function') {
        try {
          this.street.renderCameraView(cv.renderer, cv.id, t, w, h);
          rendered = true;
        } catch (e) {
          rendered = false;
        }
      }

      // 2. If not rendered, try direct scene render with THREE perspective camera
      if (!rendered && cv.renderer && this.street && this.street.scene) {
        try {
          const yawRad = (cv.yawDeg * Math.PI) / 180;
          const totalHeading = ego.h + yawRad;
          cv.threeCam.position.set(ego.x, 1.62, -ego.y);
          cv.threeCam.lookAt(
            ego.x + Math.cos(totalHeading) * 25.0,
            1.5,
            -ego.y - Math.sin(totalHeading) * 25.0
          );
          cv.renderer.render(this.street.scene, cv.threeCam);
          rendered = true;
        } catch (e) {
          rendered = false;
        }
      }

      if (rendered) {
        cv.canvas.style.display = 'block';
        if (cv.schematicCanvas) cv.schematicCanvas.style.display = 'none';
      } else {
        cv.canvas.style.display = 'none';
        if (cv.schematicCanvas) {
          cv.schematicCanvas.style.display = 'block';
          this.drawSchematicFOV(cv, ego, w, h);
        }
      }
    }
  }

  drawSchematicFOV(cv, ego, width, height) {
    const canvas = cv.schematicCanvas || cv.canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.resetTransform();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#121417';
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 20; x < width; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 20; y < height; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Vehicle top-down center
    const cx = width / 2;
    const cy = height * 0.72;

    // Ego vehicle body
    ctx.fillStyle = '#2D323B';
    ctx.strokeStyle = '#3D7BD9';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cx - 16, cy - 25, 32, 50, 4);
    ctx.fill();
    ctx.stroke();

    // Windshield
    ctx.fillStyle = '#1B1E23';
    ctx.fillRect(cx - 12, cy - 18, 24, 12);

    // FOV cone
    const yawDeg = cv.yawDeg || 0;
    const hfov = cv.hfovDeg || 80;
    // 0 deg points UP (-PI/2)
    const baseAngle = -Math.PI / 2 + (yawDeg * Math.PI) / 180;
    const halfFov = (hfov * Math.PI) / 360;
    const coneRadius = Math.min(width, height) * 0.65;

    ctx.beginPath();
    ctx.moveTo(cx, cy - 5);
    ctx.arc(cx, cy - 5, coneRadius, baseAngle - halfFov, baseAngle + halfFov);
    ctx.closePath();
    ctx.fillStyle = cv.id === 'c1' ? 'rgba(43, 179, 163, 0.18)' : 'rgba(61, 123, 217, 0.15)';
    ctx.fill();
    ctx.strokeStyle = cv.id === 'c1' ? '#2BB3A3' : '#3D7BD9';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Camera origin dot
    ctx.fillStyle = cv.id === 'c1' ? '#2BB3A3' : '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx, cy - 5, 4, 0, Math.PI * 2);
    ctx.fill();

    // Labels
    ctx.fillStyle = '#E2E8F0';
    ctx.font = 'bold 12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${cv.id.toUpperCase()} · ${cv.camInfo.name || ''}`, cx, 24);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillText(`FOV: ${hfov.toFixed(1)}° · Yaw: ${yawDeg > 0 ? '+' : ''}${yawDeg}°`, cx, 40);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.fillText(`Top-Down Rig Schematic (t = ${formatTime(state.t)})`, cx, height - 12);
  }

  updateOverlays() {
    if (!this.c1BoxTracks) return;
    const overlay = document.getElementById('bbox-cam-c1');
    if (!overlay) return;

    const t = state.t;
    let boxesHtml = '';

    for (let i = 0; i < this.c1BoxTracks.length; i++) {
      const trk = this.c1BoxTracks[i];
      if (t < trk.t0 || t > trk.t1) continue;

      let bestBox = null, minDist = 0.35;
      for (const b of trk.box) {
        const dist = Math.abs(b[0] - t);
        if (dist < minDist) {
          minDist = dist;
          bestBox = b;
        }
      }

      if (bestBox) {
        const [, x1, y1, x2, y2] = bestBox;
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
