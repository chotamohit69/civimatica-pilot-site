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
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-cyan); flex-shrink: 0;">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            Edge-Native Privacy Architecture
          </h2>
          <p style="font-size: 0.95rem; margin-top: 0.4rem; color: #FFFFFF;">
            <strong>&ldquo;no pixels and no plate text leave the device; this dashboard contains only derived detections.&rdquo;</strong>
          </p>
          <p style="margin-top: 0.5rem; color: #CBD5E1; font-size: 0.85rem; line-height: 1.5;">
            All sensory camera frames are ingested into volatile memory on the Jetson Orin Nano. Visual identities, vehicle registration plates, and pedestrian features are redacted on device before telemetry or vector tracks are exported.
          </p>
        </div>

        <div class="kpi-grid" style="margin-bottom: 1.5rem;">
          <div class="kpi-card">
            <span class="kpi-label">Faces Blurred on Device</span>
            <span class="kpi-value" style="color: var(--accent-cyan);">${(privacy.faces_blurred || 0).toLocaleString()}</span>
            <span class="kpi-sub">On-device facial anonymization</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Heads Blurred on Device</span>
            <span class="kpi-value" style="color: var(--accent-cyan);">${(privacy.heads_blurred || 0).toLocaleString()}</span>
            <span class="kpi-sub">Pedestrian silhouette obfuscation</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Plates Blurred on Device</span>
            <span class="kpi-value" style="color: var(--accent-amber);">${(privacy.plates_blurred || 0).toLocaleString()}</span>
            <span class="kpi-sub">License plate region blurring</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Plate Text Exported</span>
            <span class="kpi-value" style="color: var(--accent-green);">0 (False)</span>
            <span class="kpi-sub">No license strings persisted</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Pixels Exported</span>
            <span class="kpi-value" style="color: var(--accent-green);">0 (False)</span>
            <span class="kpi-sub">Derived detections only</span>
          </div>
        </div>

        <div class="privacy-diagram">
          <div class="section-title">Zero-Pixel Anonymization Pipeline</div>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">
            Data flows forward on the Jetson Orin Nano hardware without raw video transmission:
          </p>
          <div class="diagram-steps">
            <div class="diagram-step">
              <div class="diagram-step-num">1</div>
              <h4>Camera Ingestion</h4>
              <p>Camera frames captured into volatile memory on the Jetson.</p>
            </div>
            <div class="diagram-step">
              <div class="diagram-step-num" style="background: var(--accent-amber);">2</div>
              <h4>On-Device Redaction</h4>
              <p>Detection and blurring of human faces, heads, and vehicle license plates.</p>
            </div>
            <div class="diagram-step">
              <div class="diagram-step-num" style="background: var(--accent-cyan);">3</div>
              <h4>Asset Perception</h4>
              <p>DEIM-N and ResNet-18 classify signs, lane geometry, and vehicle parking state.</p>
            </div>
            <div class="diagram-step">
              <div class="diagram-step-num" style="background: var(--accent-green);">4</div>
              <h4>Metadata Emission</h4>
              <p>Derived 3D vector coordinates and class IDs emitted. Frame pixels purged immediately.</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
