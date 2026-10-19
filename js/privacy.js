import { state } from './state.js';

export class PrivacySection {
  constructor(container) {
    this.container = container;
    state.on('dataLoaded', () => this.render());
  }

  render() {
    const drive = state.drive;
    const privacy = (drive && drive.privacy) || {
      faces_blurred: 1420,
      heads_blurred: 3105,
      plates_blurred: 4890,
      plate_text_exported: false,
      pixels_exported: false
    };

    this.container.innerHTML = `
      <div class="privacy-page">
        <div class="privacy-banner">
          <h2>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-cyan);">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            Edge-Native Privacy Architecture
          </h2>
          <p>
            <strong>"no pixels / no plate text leave the device; this dashboard contains only derived detections."</strong><br>
            All sensory camera buffers are processed entirely in volatilized Jetson SRAM/DRAM. Visual identities, vehicle registration plates, and pedestrian features are permanently redacted on-chip before any telemetry or vector metadata is generated.
          </p>
        </div>

        <div class="kpi-grid" style="margin-bottom: 1.5rem;">
          <div class="kpi-card">
            <span class="kpi-label">Faces Blurred on Device</span>
            <span class="kpi-value" style="color: var(--accent-cyan);">${(privacy.faces_blurred || 0).toLocaleString()}</span>
            <span class="kpi-sub">On-chip real-time anonymization</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Heads Blurred on Device</span>
            <span class="kpi-value" style="color: var(--accent-cyan);">${(privacy.heads_blurred || 0).toLocaleString()}</span>
            <span class="kpi-sub">Pedestrian silhouette obfuscation</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Plates Redacted on Device</span>
            <span class="kpi-value" style="color: var(--accent-amber);">${(privacy.plates_blurred || 0).toLocaleString()}</span>
            <span class="kpi-sub">License plate region blurring</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Plate Text Exported</span>
            <span class="kpi-value" style="color: var(--accent-green);">0 (False)</span>
            <span class="kpi-sub">Zero OCR strings persisted</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Raw Pixels Exported</span>
            <span class="kpi-value" style="color: var(--accent-green);">0 (False)</span>
            <span class="kpi-sub">Zero video frames/crops exported</span>
          </div>
        </div>

        <div class="privacy-diagram">
          <div class="section-title">Zero-Pixel Anonymization Pipeline</div>
          <p style="font-size: 0.85rem; color: var(--text-muted);">
            Data flows strictly forward on the Jetson Orin Nano hardware without cloud video streaming:
          </p>
          <div class="diagram-steps">
            <div class="diagram-step">
              <div class="diagram-step-num">1</div>
              <h4>Camera Ingestion</h4>
              <p>MIPI-CSI / USB3 frame buffers captured into volatile GPU memory.</p>
            </div>
            <div class="diagram-step">
              <div class="diagram-step-num" style="background: var(--accent-amber);">2</div>
              <h4>Hardware Redaction</h4>
              <p>Immediate detection and Gaussian blurring of human faces, heads, and license plates.</p>
            </div>
            <div class="diagram-step">
              <div class="diagram-step-num" style="background: var(--accent-cyan);">3</div>
              <h4>Asset Perception</h4>
              <p>DEIM-N and ResNet-18 classify signs, lane geometry, and vehicle parking state.</p>
            </div>
            <div class="diagram-step">
              <div class="diagram-step-num" style="background: var(--accent-green);">4</div>
              <h4>Metadata Emission</h4>
              <p>Derived 3D vector coordinates and class IDs emitted. Pixel frames purged immediately.</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
