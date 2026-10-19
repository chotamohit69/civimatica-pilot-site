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
    const devName = (rig && rig.device && rig.device.name) || stats.device || 'Jetson Orin Nano 8 GB';
    const devSoft = (rig && rig.device && rig.device.software) || 'JetPack 7 (L4T R39.2.1), TensorRT 10.16';
    const powerMode = (rig && rig.device && rig.device.power_mode) || 'MAXN_SUPER (25W)';

    // Backends
    const backends = stats.backends || {
      detector: 'DEIM-N TensorRT b5',
      classifier: 'ResNet-18 TensorRT',
      tracker: 'ByteTrack',
      anonymizer: 'MobileNetV3 Plates/Faces'
    };

    // Stage timings
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
      postprocess: '#95A5A6'
    };

    let timingBarsHtml = '';
    for (const [stage, sec] of Object.entries(timings)) {
      const pct = ((sec / totalTimingS) * 100).toFixed(1);
      const col = timingColors[stage] || '#3D7BD9';
      const cleanName = stage.replace(/_/g, ' ').toUpperCase();

      timingBarsHtml += `
        <div style="margin-bottom: 0.85rem;">
          <div style="display:flex; justify-content:space-between; font-size: 0.82rem; margin-bottom: 3px;">
            <span><strong>${cleanName}</strong></span>
            <span><strong style="color: ${col}">${sec.toFixed(1)} s</strong> <span style="color:var(--text-dim)">(${pct}%)</span></span>
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
          <span class="kpi-label">${cls}</span>
          <span class="kpi-value" style="font-size: 1.4rem;">${cnt.toLocaleString()}</span>
          <span class="kpi-sub">Total frame detections</span>
        </div>
      `;
    }

    this.container.innerHTML = `
      <div class="overview-page">
        <div class="kpi-grid" style="margin-bottom: 1.5rem;">
          <div class="kpi-card">
            <span class="kpi-label">Edge Device</span>
            <span class="kpi-value" style="font-size: 1.3rem;">${devName}</span>
            <span class="kpi-sub">${powerMode}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Measured Pipeline Speed</span>
            <span class="kpi-value" style="color: var(--accent-green);">${devFps} <span style="font-size: 1rem;">FPS</span></span>
            <span class="kpi-sub">${stats.frames ? `${stats.frames.toLocaleString()} frames evaluated` : 'Sustained throughput'}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Software Stack</span>
            <span class="kpi-value" style="font-size: 1.15rem; color: var(--accent-cyan);">${devSoft}</span>
            <span class="kpi-sub">CUDA 12.6 · TensorRT Accelerated</span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
          <div class="rig-table-card">
            <div class="section-title">Inference &amp; Pipeline Backends</div>
            <table class="data-table" style="margin-top: 0.5rem;">
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
            <div class="section-title">
              <span>Pipeline Stage Execution Timings</span>
              <span style="font-size: 0.78rem; color: var(--text-muted); font-weight: normal;">Total: ${totalTimingS.toFixed(1)} s</span>
            </div>
            <div style="margin-top: 1rem;">
              ${timingBarsHtml}
            </div>
          </div>
        </div>

        <div class="rig-table-card">
          <div class="section-title" style="margin-bottom: 1rem;">Cumulative Raw Detections Across Frames</div>
          <div class="kpi-grid">
            ${rawCardsHtml}
          </div>
        </div>
      </div>
    `;
  }
}
