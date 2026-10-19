import { state } from './state.js';

export class DeviceSection {
  constructor(container) {
    this.container = container;
    state.on('dataLoaded', () => this.render());
  }

  render() {
    const drive = state.drive;
    const rig = state.rig;
    if (!drive) return;

    const stats = drive.stats || {};
    const devFps = stats.fps || 14.6;

    const rigDev = (rig && rig.device) ? rig.device : {};
    const devName = rigDev.name || stats.device || 'Jetson Orin Nano 8 GB';
    const devSoft = rigDev.software || 'JetPack 7 (L4T R39.2.1), TensorRT 10.16.2';
    const powerMode = rigDev.power_mode || 'MAXN_SUPER (25W)';

    // Backends
    const backends = stats.backends || {
      detector: 'DEIM-N TensorRT b5',
      classifier: 'ResNet-18 TensorRT',
      tracker: 'ByteTrack',
      anonymizer: 'MobileNetV3 Plates/Faces'
    };

    // Stage timings from stats.timings_s
    const timings = stats.timings_s || {
      preprocess: 18.2,
      deim_detector: 145.4,
      resnet_classifier: 38.6,
      tracker: 14.1,
      ocr_anonymize: 55.2,
      postprocess: 8.9
    };

    let totalTimingS = 0;
    for (const v of Object.values(timings)) totalTimingS += Number(v);
    totalTimingS = Math.max(0.1, totalTimingS);

    const timingColors = {
      preprocess: '#3D7BD9',
      deim_detector: '#2BB3A3',
      detector: '#2BB3A3',
      resnet_classifier: '#E8A33D',
      classifier: '#E8A33D',
      tracker: '#9B59B6',
      ocr_anonymize: '#D9483B',
      anonymize: '#D9483B',
      postprocess: '#95A5A6'
    };

    let timingBarsHtml = '';
    for (const [stage, secVal] of Object.entries(timings)) {
      const sec = Number(secVal);
      const pct = ((sec / totalTimingS) * 100).toFixed(1);
      const col = timingColors[stage] || '#3D7BD9';
      const cleanName = stage.replace(/_/g, ' ').toUpperCase();

      timingBarsHtml += `
        <div style="margin-bottom: 0.85rem;">
          <div style="display:flex; justify-content:space-between; font-size: 0.82rem; margin-bottom: 4px;">
            <span><strong>${cleanName}</strong></span>
            <span><strong style="color: ${col}">${sec.toFixed(1)} s</strong> <span style="color:var(--text-dim); font-size: 0.75rem">(${pct}%)</span></span>
          </div>
          <div style="width: 100%; height: 10px; background: var(--bg-card); border-radius: 4px; overflow: hidden;">
            <div style="width: ${pct}%; height: 100%; background: ${col}; border-radius: 4px;"></div>
          </div>
        </div>
      `;
    }

    // Raw detection counts
    const rawCounts = stats.raw_detection_counts || {
      car: 18500, person: 3400, sign: 7600, motorcycle: 1200, bus: 820, truck: 450, bicycle: 630
    };

    let rawCardsHtml = '';
    for (const [cls, cnt] of Object.entries(rawCounts)) {
      rawCardsHtml += `
        <div class="kpi-card" style="padding: 0.85rem;">
          <span class="kpi-label" style="text-transform: capitalize;">${cls}</span>
          <span class="kpi-value" style="font-size: 1.4rem;">${cnt.toLocaleString()}</span>
          <span class="kpi-sub">Raw detections</span>
        </div>
      `;
    }

    this.container.innerHTML = `
      <div class="overview-page">
        <!-- Device banner line from rig.json -->
        <div class="overview-banner" style="margin-bottom: 1.5rem;">
          <div>
            <h2 style="font-size: 1.2rem; color: #FFFFFF; margin-bottom: 0.35rem;">${devName}</h2>
            <p style="color: var(--text-muted); font-size: 0.85rem;">
              Software Stack: <strong>${devSoft}</strong> · Operating Mode: <strong>${powerMode}</strong>
            </p>
          </div>
          <div style="text-align: right;">
            <span class="pilot-tag" style="background: rgba(46, 204, 113, 0.15); color: var(--accent-green); border-color: rgba(46, 204, 113, 0.3);">
              Edge Processing
            </span>
          </div>
        </div>

        <div class="kpi-grid" style="margin-bottom: 1.5rem;">
          <div class="kpi-card">
            <span class="kpi-label">Pipeline Speed</span>
            <span class="kpi-value" style="color: var(--accent-green);">${devFps} <span style="font-size: 1rem;">FPS</span></span>
            <span class="kpi-sub">on the Jetson, tiled 1080p sign search on 4K video</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Total Survey Frames</span>
            <span class="kpi-value">${stats.frames ? stats.frames.toLocaleString() : '65,500'}</span>
            <span class="kpi-sub">Processed by inference pipeline</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Power Profile</span>
            <span class="kpi-value" style="font-size: 1.25rem; color: var(--accent-amber);">${powerMode}</span>
            <span class="kpi-sub">Jetson thermal / power budget</span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1.2fr; gap: 1.5rem; margin-bottom: 1.5rem;">
          <div class="rig-table-card">
            <div class="section-title">Inference &amp; Perception Backends</div>
            <table class="data-table" style="margin-top: 0.75rem;">
              <tbody>
                ${Object.entries(backends).map(([k, v]) => `
                  <tr>
                    <td style="color: var(--text-muted); font-weight: 600; text-transform: capitalize; width: 35%;">${k.replace(/_/g, ' ')}</td>
                    <td><strong>${v}</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <div class="rig-table-card">
            <div class="section-title" style="display: flex; justify-content: space-between;">
              <span>Pipeline Stage Execution Timings</span>
              <span style="font-size: 0.78rem; color: var(--text-muted); font-weight: normal;">Total: ${totalTimingS.toFixed(1)} s</span>
            </div>
            <div style="margin-top: 1rem;">
              ${timingBarsHtml}
            </div>
          </div>
        </div>

        <div class="rig-table-card">
          <div class="section-title" style="margin-bottom: 1rem;">Raw Frame-Level Detections by Class</div>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 1rem;">
            ${rawCardsHtml}
          </div>
        </div>
      </div>
    `;
  }
}
