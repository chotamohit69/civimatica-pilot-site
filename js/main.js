import { state } from './state.js';
import { loadPilotData, formatTime } from './data.js';
import { OverviewSection } from './overview.js';
import { StreetSection } from './street.js';
import { MapSection } from './map.js';
import { CamerasSection } from './cameras.js';
import { SignsSection } from './signs.js';
import { ParkingSection } from './parking.js';
import { DeviceSection } from './device.js';
import { PrivacySection } from './privacy.js';

class App {
  constructor() {
    this.sections = {};
    this.isDraggingScrubber = false;
  }

  async init() {
    // 1. Initialize 3D Street Section first
    const streetContainer = document.getElementById('view-street');
    const streetSection = new StreetSection(streetContainer);
    streetSection.init();
    this.sections.street = streetSection;
    window.app = this;
    window.streetSection = streetSection;
    // 2. Initialize other sections
    this.sections.overview = new OverviewSection(document.getElementById('view-overview'));
    this.sections.map = new MapSection(document.getElementById('view-map'));
    this.sections.cameras = new CamerasSection(document.getElementById('view-cameras'), streetSection);
    this.sections.signs = new SignsSection(document.getElementById('view-signs'));
    this.sections.parking = new ParkingSection(document.getElementById('view-parking'));
    this.sections.device = new DeviceSection(document.getElementById('view-device'));
    this.sections.privacy = new PrivacySection(document.getElementById('view-privacy'));

    // 3. Bind UI Controls
    this.bindNavigation();
    this.bindPlaybackControls();
    this.bindScrubber();
    this.bindKeyboardShortcuts();

    // 4. Listen to state changes
    state.on('sectionChange', (sec) => this.onSectionChanged(sec));
    state.on('timeUpdate', (t) => this.onTimeUpdated(t));
    state.on('playStateChange', (isPlaying) => this.onPlayStateChanged(isPlaying));
    state.on('dataLoaded', () => this.onDataLoaded());

    // 5. Load pilot data
    try {
      const data = await loadPilotData();
      state.setData(data.runs, data.scene, data.drive, data.rig);
    } catch (err) {
      console.error('Fatal error loading pilot data:', err);
    }
  }

  bindNavigation() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const sec = tab.getAttribute('data-section');
        state.setSection(sec);
      });
    });
  }

  onSectionChanged(sec) {
    document.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-section') === sec);
    });

    document.querySelectorAll('.view-container').forEach(c => {
      c.classList.toggle('active', c.id === `view-${sec}`);
    });
  }

  bindPlaybackControls() {
    const btnPlay = document.getElementById('btn-play-toggle');
    btnPlay?.addEventListener('click', () => state.togglePlay());

    document.querySelectorAll('.speed-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const speed = parseFloat(pill.getAttribute('data-speed'));
        state.setSpeed(speed);
        document.querySelectorAll('.speed-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
      });
    });
  }

  onPlayStateChanged(isPlaying) {
    const btnPlay = document.getElementById('btn-play-toggle');
    if (btnPlay) {
      btnPlay.innerHTML = isPlaying ? `❚❚ Pause` : `► Play`;
      btnPlay.classList.toggle('btn-primary', isPlaying);
    }
  }

  bindScrubber() {
    const scrubberWrap = document.getElementById('scrubber-wrap');
    if (!scrubberWrap) return;

    const handleSeek = (e) => {
      const rect = scrubberWrap.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      state.setTime(frac * state.duration);
    };

    scrubberWrap.addEventListener('mousedown', (e) => {
      this.isDraggingScrubber = true;
      handleSeek(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDraggingScrubber) {
        handleSeek(e);
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDraggingScrubber = false;
    });
  }

  onDataLoaded() {
    const drive = state.drive;
    if (!drive) return;

    // Render street bands on scrubber
    const bandsContainer = document.getElementById('scrubber-bands');
    if (bandsContainer && drive.streets) {
      const dur = state.duration || 120;
      let html = '';
      drive.streets.forEach((s, idx) => {
        const pctWidth = (((s.t1 - s.t0) / dur) * 100).toFixed(2);
        const bg = idx % 2 === 0 ? 'rgba(255, 255, 255, 0.03)' : 'rgba(255, 255, 255, 0.07)';
        html += `
          <div class="scrubber-band" style="width: ${pctWidth}%; background: ${bg};" title="${s.name}">
            ${s.name}
          </div>
        `;
      });
      bandsContainer.innerHTML = html;
    }

    this.onTimeUpdated(state.t);
  }

  onTimeUpdated(t) {
    const dur = state.duration || 120;
    const pct = Math.max(0, Math.min(100, (t / dur) * 100));

    // Update scrubber playhead
    const playhead = document.getElementById('scrubber-playhead');
    const progress = document.getElementById('scrubber-progress');
    if (playhead) playhead.style.left = `${pct}%`;
    if (progress) progress.style.width = `${pct}%`;

    // Time text display
    const timeEl = document.getElementById('time-display');
    if (timeEl) {
      timeEl.textContent = `${formatTime(t)} / ${formatTime(dur)}`;
    }

    // Street text pill
    const streetPill = document.getElementById('street-pill');
    if (streetPill) {
      const street = state.getStreetAt(t);
      streetPill.textContent = street || 'Downtown Milan';
    }
  }

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Ignore if focus is in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        state.togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        state.setTime(state.t - 5);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        state.setTime(state.t + 5);
      } else if (e.key === '1') {
        state.setSpeed(1);
        this.updateSpeedUI(1);
      } else if (e.key === '2') {
        state.setSpeed(4);
        this.updateSpeedUI(4);
      } else if (e.key === '3') {
        state.setSpeed(16);
        this.updateSpeedUI(16);
      } else if (e.key === '4') {
        state.setSpeed(64);
        this.updateSpeedUI(64);
      }
    });
  }

  updateSpeedUI(speed) {
    document.querySelectorAll('.speed-pill').forEach(p => {
      p.classList.toggle('active', parseFloat(p.getAttribute('data-speed')) === speed);
    });
  }
}

// Bootstrap
const startApp = () => {
  const app = new App();
  app.init();
};

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
