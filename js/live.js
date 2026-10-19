/**
 * Civimatica Milan Pilot — Live Device Window (Jetson 2 Cam Rig)
 * Self-mounting ES module.
 */

const DEFAULT_URL = 'http://100.84.250.2:8090';
const DEFAULT_NAME = 'Jetson 2';
const RIG_ORDER = ['c0', 'c1', 'c3', 'c2'];

let configUrl = DEFAULT_URL;
let configName = DEFAULT_NAME;
let activeUrl = DEFAULT_URL;

let state = 'connecting'; // 'connecting' | 'offline' | 'live'
let isOpen = false;
let viewMode = 'grid'; // 'grid' | 'strip'
let expandedCid = null; // cid string or null
let lastChecked = null; // Date
let lastStatus = null; // status payload
let isMixedContent = false;

let pollTimer = null;
let probeAbort = null;
const streamRetryTimers = new Map();

// DOM references
let chipBtn = null;
let chipDot = null;
let chipText = null;
let windowEl = null;
let windowTitle = null;
let windowBody = null;
let closeBtn = null;
let viewSwitch = null;
let gridBtn = null;
let stripBtn = null;
let windowFooter = null;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatTime(d) {
  if (!d) return '--:--:--';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function checkMixedContent(url) {
  return window.location.protocol === 'https:' && /^http:\/\//i.test(url);
}

function getHost(url) {
  try {
    return new URL(url).host || url;
  } catch (_) {
    return url;
  }
}

function getActiveUrl() {
  const override = localStorage.getItem('civi.device.url');
  if (override && override.trim()) {
    return override.trim();
  }
  return configUrl || DEFAULT_URL;
}

function countOkCameras(cameras) {
  if (!Array.isArray(cameras)) return 0;
  let count = 0;
  for (const cid of ['c0', 'c1', 'c2', 'c3']) {
    const cam = cameras.find((c) => c && c.id === cid);
    if (cam && cam.ok) count++;
  }
  return count;
}

function isCameraOk(status, cid) {
  if (!status || !Array.isArray(status.cameras)) return false;
  const cam = status.cameras.find((c) => c && c.id === cid);
  return Boolean(cam && cam.ok);
}

function formatResolution(shape) {
  if (Array.isArray(shape) && shape.length >= 2) {
    const h = shape[0];
    const w = shape[1];
    return `${w}×${h}`;
  }
  return '—';
}

function teardownStreams(container) {
  for (const [cid, timer] of streamRetryTimers.entries()) {
    clearTimeout(timer);
  }
  streamRetryTimers.clear();

  const root = container || windowBody;
  if (!root) return;
  const imgs = root.querySelectorAll('img.live-stream-img');
  imgs.forEach((img) => {
    img.onerror = null;
    img.onload = null;
    img.src = '';
    img.remove();
  });
}

function updateChip() {
  if (!chipText || !chipDot) return;

  chipBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  chipDot.className = 'live-chip-dot';

  if (state === 'connecting') {
    chipDot.classList.add('is-connecting');
    chipText.textContent = `${configName} · Connecting…`;
  } else if (state === 'offline') {
    chipDot.classList.add('is-offline');
    chipText.textContent = `${configName} · Offline`;
  } else if (state === 'live') {
    chipDot.classList.add('is-live');
    const ok = countOkCameras(lastStatus ? lastStatus.cameras : []);
    chipText.textContent = `${configName} · Live ${ok}/4`;
  }
}

function setViewMode(mode) {
  if (viewMode === mode && expandedCid === null) return;
  teardownStreams(windowBody);
  viewMode = mode;
  expandedCid = null;
  if (gridBtn && stripBtn) {
    gridBtn.classList.toggle('is-active', viewMode === 'grid');
    gridBtn.setAttribute('aria-selected', viewMode === 'grid' ? 'true' : 'false');
    stripBtn.classList.toggle('is-active', viewMode === 'strip');
    stripBtn.setAttribute('aria-selected', viewMode === 'strip' ? 'true' : 'false');
  }
  renderBody();
}

function renderConnecting() {
  if (!windowBody) return;
  teardownStreams(windowBody);
  const host = getHost(activeUrl);
  windowBody.innerHTML = `
    <div class="live-connecting-panel">
      <div class="live-connecting-spinner" aria-hidden="true"></div>
      <p class="live-connecting-msg">Looking for ${escapeHtml(configName)} at <span class="tnum">${escapeHtml(host)}</span>…</p>
    </div>
  `;
}

function renderOffline() {
  if (!windowBody) return;
  teardownStreams(windowBody);

  const reasonHtml = isMixedContent
    ? `<p class="live-offline-reason">This page is HTTPS but the device address is HTTP; open the dashboard locally or use the device's HTTPS address.</p>`
    : `<p class="live-offline-reason">powered off, cam-rig stopped, or this browser isn't on the Civimatica tailnet; If your browser asks to access devices on your network, allow it.</p>`;

  windowBody.innerHTML = `
    <div class="live-offline-panel">
      <h3 class="live-offline-title">${escapeHtml(configName)} isn't reachable.</h3>
      ${reasonHtml}
      <div class="live-offline-actions">
        <button type="button" class="live-btn live-btn-retry" id="live-retry-btn">Retry</button>
        <span class="live-offline-checked">Last checked <span class="tnum" id="live-checked-time">${formatTime(lastChecked)}</span></span>
      </div>
      <form class="live-address-form" id="live-address-form">
        <label for="live-device-input" class="live-address-label">Device address</label>
        <div class="live-address-row">
          <input type="text" id="live-device-input" class="live-input" value="${escapeHtml(activeUrl)}" autocomplete="off" spellcheck="false" />
          <button type="submit" class="live-btn">Save</button>
          <button type="button" class="live-btn live-btn-reset" id="live-reset-btn">Reset</button>
        </div>
      </form>
    </div>
  `;

  const retryBtn = windowBody.querySelector('#live-retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      probeStatus();
    });
  }

  const form = windowBody.querySelector('#live-address-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('#live-device-input');
      const val = (input && input.value ? input.value.trim() : '') || DEFAULT_URL;
      localStorage.setItem('civi.device.url', val);
      activeUrl = val;
      state = 'connecting';
      updateChip();
      renderBody();
      probeStatus();
    });
  }

  const resetBtn = windowBody.querySelector('#live-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      localStorage.removeItem('civi.device.url');
      activeUrl = configUrl || DEFAULT_URL;
      const input = windowBody.querySelector('#live-device-input');
      if (input) input.value = activeUrl;
      state = 'connecting';
      updateChip();
      renderBody();
      probeStatus();
    });
  }
}

function attachStream(tileEl, cid, streamUrl, name) {
  const container = tileEl.querySelector('.live-tile-viewport');
  if (!container) return;

  const interruptedBox = tileEl.querySelector('.live-tile-interrupted');
  const img = document.createElement('img');
  img.className = 'live-stream-img';
  img.alt = `Live view, ${name}`;

  img.onerror = () => {
    if (lastStatus && isCameraOk(lastStatus, cid)) {
      if (interruptedBox) interruptedBox.hidden = false;
      img.style.display = 'none';
      clearTimeout(streamRetryTimers.get(cid));
      const t = setTimeout(() => {
        if (isOpen && state === 'live' && !document.hidden && isCameraOk(lastStatus, cid)) {
          const sep = streamUrl.includes('?') ? '&' : '?';
          img.src = `${streamUrl}${sep}_t=${Date.now()}`;
          img.style.display = 'block';
          if (interruptedBox) interruptedBox.hidden = true;
        }
      }, 3000);
      streamRetryTimers.set(cid, t);
    }
  };

  img.onload = () => {
    if (interruptedBox) interruptedBox.hidden = true;
    img.style.display = 'block';
  };

  img.src = streamUrl;
  container.appendChild(img);
}

function renderLiveGrid() {
  if (!windowBody) return;
  teardownStreams(windowBody);

  const cameras = (lastStatus && Array.isArray(lastStatus.cameras)) ? lastStatus.cameras : [];
  const base = activeUrl.replace(/\/+$/, '');

  windowBody.innerHTML = `
    <div class="live-grid-container" id="live-grid"></div>
  `;

  const gridEl = windowBody.querySelector('#live-grid');

  for (const cid of RIG_ORDER) {
    const cam = cameras.find((c) => c && c.id === cid) || { id: cid, name: cid, ok: false, error: 'no_source', fps: 0, shape: [] };
    const tileEl = document.createElement('div');
    tileEl.className = 'live-tile';
    tileEl.dataset.cid = cid;

    if (cam.ok) {
      tileEl.classList.add('live-tile-ok');
      tileEl.setAttribute('role', 'button');
      tileEl.setAttribute('tabindex', '0');
      tileEl.setAttribute('aria-label', `Expand camera ${cam.name || cid}`);

      tileEl.innerHTML = `
        <div class="live-tile-viewport">
          <div class="live-tile-interrupted" hidden>Stream interrupted</div>
        </div>
        <div class="live-tile-caption">
          <span class="live-cam-ident"><strong>${escapeHtml(cam.id)}</strong> ${escapeHtml(cam.name || '')}</span>
          <span class="live-cam-metrics">
            <span class="live-cam-fps tnum">${(Number(cam.fps) || 0).toFixed(1)} fps</span> · 
            <span class="live-cam-res tnum">${formatResolution(cam.shape)}</span>
          </span>
        </div>
      `;

      tileEl.addEventListener('click', () => {
        expandedCid = cid;
        renderBody();
      });

      tileEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          expandedCid = cid;
          renderBody();
        }
      });

      if (isOpen && !document.hidden) {
        attachStream(tileEl, cid, `${base}/stream/${cid}?preview=1`, cam.name || cid);
      }
    } else {
      tileEl.classList.add('live-tile-nosignal');
      tileEl.innerHTML = `
        <div class="live-nosignal-viewport">
          <div class="live-nosignal-card">
            <div class="live-nosignal-badge">No signal</div>
            <div class="live-nosignal-err">${escapeHtml(cam.error || 'Signal lost')}</div>
          </div>
        </div>
        <div class="live-tile-caption">
          <span class="live-cam-ident"><strong>${escapeHtml(cam.id)}</strong> ${escapeHtml(cam.name || '')}</span>
          <span class="live-nosignal-tag">OFFLINE</span>
        </div>
      `;
    }

    gridEl.appendChild(tileEl);
  }
}

function renderLiveExpanded(cid) {
  if (!windowBody) return;
  teardownStreams(windowBody);

  const cameras = (lastStatus && Array.isArray(lastStatus.cameras)) ? lastStatus.cameras : [];
  const cam = cameras.find((c) => c && c.id === cid) || { id: cid, name: cid, ok: false, error: 'no_source', fps: 0, shape: [] };
  const base = activeUrl.replace(/\/+$/, '');

  windowBody.innerHTML = `
    <div class="live-expanded-container">
      <div class="live-expanded-bar">
        <button type="button" class="live-btn live-btn-back" id="live-back-btn">← Back to grid</button>
        <span class="live-expanded-title"><strong>${escapeHtml(cam.id)}</strong> ${escapeHtml(cam.name || '')}</span>
      </div>
      <div class="live-tile live-tile-expanded" data-cid="${escapeHtml(cid)}">
        <div class="live-tile-viewport">
          <div class="live-tile-interrupted" hidden>Stream interrupted</div>
        </div>
        <div class="live-tile-caption">
          <span class="live-cam-ident"><strong>${escapeHtml(cam.id)}</strong> ${escapeHtml(cam.name || '')}</span>
          <span class="live-cam-metrics">
            <span class="live-cam-fps tnum">${(Number(cam.fps) || 0).toFixed(1)} fps</span> · 
            <span class="live-cam-res tnum">${formatResolution(cam.shape)}</span>
          </span>
        </div>
      </div>
    </div>
  `;

  const backBtn = windowBody.querySelector('#live-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      expandedCid = null;
      renderBody();
    });
  }

  const tileEl = windowBody.querySelector('.live-tile-expanded');
  if (tileEl && cam.ok && isOpen && !document.hidden) {
    attachStream(tileEl, cid, `${base}/stream/${cid}?preview=1`, cam.name || cid);
  }
}

function renderLiveStrip() {
  if (!windowBody) return;
  teardownStreams(windowBody);

  const cameras = (lastStatus && Array.isArray(lastStatus.cameras)) ? lastStatus.cameras : [];
  const panoCam = cameras.find((c) => c && c.id === 'pano') || { id: 'pano', name: 'Street strip', fps: 0, shape: [] };
  const base = activeUrl.replace(/\/+$/, '');

  windowBody.innerHTML = `
    <div class="live-strip-container">
      <div class="live-tile live-tile-strip" data-cid="pano">
        <div class="live-tile-viewport">
          <div class="live-tile-interrupted" hidden>Stream interrupted</div>
        </div>
        <div class="live-tile-caption">
          <span class="live-cam-ident"><strong>pano</strong> Street strip (c3 | c1 | c0 | c2)</span>
          <span class="live-cam-metrics">
            <span class="live-cam-fps tnum">${(Number(panoCam.fps) || 0).toFixed(1)} fps</span> · 
            <span class="live-cam-res tnum">${formatResolution(panoCam.shape)}</span>
          </span>
        </div>
      </div>
    </div>
  `;

  const tileEl = windowBody.querySelector('.live-tile-strip');
  if (tileEl && isOpen && !document.hidden) {
    attachStream(tileEl, 'pano', `${base}/stream/pano`, 'Street strip');
  }
}

function updateCaptionsOnly() {
  if (!windowBody || state !== 'live') return;
  const cameras = (lastStatus && Array.isArray(lastStatus.cameras)) ? lastStatus.cameras : [];

  if (viewMode === 'strip') {
    const panoCam = cameras.find((c) => c && c.id === 'pano') || { fps: 0, shape: [] };
    const fpsEl = windowBody.querySelector('.live-tile-strip .live-cam-fps');
    const resEl = windowBody.querySelector('.live-tile-strip .live-cam-res');
    if (fpsEl) fpsEl.textContent = `${(Number(panoCam.fps) || 0).toFixed(1)} fps`;
    if (resEl) resEl.textContent = formatResolution(panoCam.shape);
    return;
  }

  if (expandedCid) {
    const cam = cameras.find((c) => c && c.id === expandedCid);
    if (!cam || !cam.ok) {
      renderBody();
      return;
    }
    const fpsEl = windowBody.querySelector('.live-tile-expanded .live-cam-fps');
    const resEl = windowBody.querySelector('.live-tile-expanded .live-cam-res');
    if (fpsEl) fpsEl.textContent = `${(Number(cam.fps) || 0).toFixed(1)} fps`;
    if (resEl) resEl.textContent = formatResolution(cam.shape);
    return;
  }

  // Grid view
  for (const cid of RIG_ORDER) {
    const cam = cameras.find((c) => c && c.id === cid);
    const tile = windowBody.querySelector(`.live-tile[data-cid="${cid}"]`);
    if (!tile) continue;

    const wasOk = tile.classList.contains('live-tile-ok');
    const isOk = Boolean(cam && cam.ok);

    if (wasOk !== isOk) {
      // Structure changed for this camera, re-render
      renderLiveGrid();
      return;
    }

    if (isOk) {
      const fpsEl = tile.querySelector('.live-cam-fps');
      const resEl = tile.querySelector('.live-cam-res');
      if (fpsEl) fpsEl.textContent = `${(Number(cam.fps) || 0).toFixed(1)} fps`;
      if (resEl) resEl.textContent = formatResolution(cam.shape);
    }
  }
}

function renderBody() {
  if (!windowBody) return;

  if (viewSwitch) {
    viewSwitch.hidden = state !== 'live';
  }
  if (windowFooter) {
    windowFooter.hidden = state !== 'live';
  }

  if (state === 'connecting') {
    renderConnecting();
  } else if (state === 'offline') {
    renderOffline();
  } else if (state === 'live') {
    if (viewMode === 'strip') {
      renderLiveStrip();
    } else if (expandedCid) {
      renderLiveExpanded(expandedCid);
    } else {
      renderLiveGrid();
    }
  }
}

async function probeStatus() {
  if (document.hidden) return;

  activeUrl = getActiveUrl();
  isMixedContent = checkMixedContent(activeUrl);

  if (isMixedContent) {
    lastChecked = new Date();
    state = 'offline';
    updateChip();
    renderBody();
    scheduleNextProbe();
    return;
  }

  if (probeAbort) {
    try {
      probeAbort.abort();
    } catch (_) {}
  }
  probeAbort = new AbortController();
  const timer = setTimeout(() => {
    try {
      probeAbort.abort();
    } catch (_) {}
  }, 4000);

  const base = activeUrl.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/api/status`, {
      signal: probeAbort.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    lastChecked = new Date();
    lastStatus = data;

    const prevState = state;
    state = 'live';
    updateChip();

    if (isOpen) {
      if (prevState !== 'live') {
        renderBody();
      } else {
        updateCaptionsOnly();
      }
    }
  } catch (err) {
    clearTimeout(timer);
    lastChecked = new Date();
    const prevState = state;
    state = 'offline';
    updateChip();

    if (isOpen) {
      if (prevState !== 'offline') {
        renderBody();
      } else {
        const timeEl = windowBody ? windowBody.querySelector('#live-checked-time') : null;
        if (timeEl) timeEl.textContent = formatTime(lastChecked);
      }
    }
  }

  scheduleNextProbe();
}

function scheduleNextProbe() {
  clearTimeout(pollTimer);
  if (document.hidden) return;

  let delay = 30000; // closed probe
  if (isOpen) {
    if (state === 'live') {
      delay = 2000; // live poll
    } else {
      delay = 10000; // offline / connecting retry
    }
  }

  pollTimer = setTimeout(() => {
    probeStatus();
  }, delay);
}

function openWindow() {
  if (isOpen) return;
  isOpen = true;
  updateChip();
  if (windowEl) {
    windowEl.hidden = false;
  }
  renderBody();
  if (closeBtn) {
    closeBtn.focus();
  }
  probeStatus();
}

function closeWindow() {
  if (!isOpen) return;
  isOpen = false;
  updateChip();
  teardownStreams(windowBody);
  if (windowEl) {
    windowEl.hidden = true;
  }
  if (chipBtn) {
    chipBtn.focus();
  }
  scheduleNextProbe();
}

function setupDraggable(header, container) {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  header.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, a, [role="tab"]')) return;
    if (window.innerWidth <= 880) return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = container.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;

    container.style.left = `${startLeft}px`;
    container.style.top = `${startTop}px`;
    container.style.right = 'auto';
    container.style.bottom = 'auto';

    try {
      header.setPointerCapture(e.pointerId);
    } catch (_) {}
    header.classList.add('is-dragging');
  });

  header.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const rect = container.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);

    const newLeft = Math.min(Math.max(0, startLeft + dx), maxLeft);
    const newTop = Math.min(Math.max(0, startTop + dy), maxTop);

    container.style.left = `${newLeft}px`;
    container.style.top = `${newTop}px`;
  });

  const stop = (e) => {
    if (!isDragging) return;
    isDragging = false;
    header.classList.remove('is-dragging');
    try {
      header.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  header.addEventListener('pointerup', stop);
  header.addEventListener('pointercancel', stop);
}

function mountUI() {
  const topBar = document.querySelector('.top-bar');
  if (!topBar) return;

  // 1. Chip button
  chipBtn = document.createElement('button');
  chipBtn.type = 'button';
  chipBtn.className = 'live-chip';
  chipBtn.setAttribute('aria-expanded', 'false');
  chipBtn.setAttribute('aria-controls', 'live-device-window');
  chipBtn.setAttribute('aria-haspopup', 'dialog');

  chipDot = document.createElement('span');
  chipDot.className = 'live-chip-dot is-connecting';
  chipDot.setAttribute('aria-hidden', 'true');

  chipText = document.createElement('span');
  chipText.className = 'live-chip-text tnum';
  chipText.setAttribute('aria-live', 'polite');
  chipText.textContent = `${configName} · Connecting…`;

  chipBtn.appendChild(chipDot);
  chipBtn.appendChild(chipText);

  chipBtn.addEventListener('click', () => {
    if (isOpen) {
      closeWindow();
    } else {
      openWindow();
    }
  });

  topBar.appendChild(chipBtn);

  // 2. Floating Dialog Window
  windowEl = document.createElement('div');
  windowEl.id = 'live-device-window';
  windowEl.className = 'live-window';
  windowEl.setAttribute('role', 'dialog');
  windowEl.setAttribute('aria-modal', 'false');
  windowEl.setAttribute('aria-labelledby', 'live-window-title');
  windowEl.hidden = true;

  windowEl.innerHTML = `
    <div class="live-window-header">
      <div class="live-header-brand">
        <h2 id="live-window-title" class="live-window-title">${escapeHtml(configName)}</h2>
      </div>
      <div class="live-window-controls">
        <div class="live-view-switch" role="tablist" aria-label="Camera view mode" hidden>
          <button type="button" class="live-view-btn is-active" id="live-view-grid" role="tab" aria-selected="true">Grid</button>
          <button type="button" class="live-view-btn" id="live-view-strip" role="tab" aria-selected="false">Strip</button>
        </div>
        <button type="button" class="live-close-btn" id="live-close-btn" aria-label="Close device window">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="live-window-body" id="live-window-body"></div>
    <div class="live-window-footer">
      <p class="live-footer-note">Live preview straight from the device; not recorded by this dashboard. Visible only to devices on the Civimatica tailnet.</p>
    </div>
  `;

  document.body.appendChild(windowEl);

  windowTitle = windowEl.querySelector('#live-window-title');
  windowBody = windowEl.querySelector('#live-window-body');
  closeBtn = windowEl.querySelector('#live-close-btn');
  viewSwitch = windowEl.querySelector('.live-view-switch');
  gridBtn = windowEl.querySelector('#live-view-grid');
  stripBtn = windowEl.querySelector('#live-view-strip');
  windowFooter = windowEl.querySelector('.live-window-footer');
  const header = windowEl.querySelector('.live-window-header');
  setupDraggable(header, windowEl);

  closeBtn.addEventListener('click', () => {
    closeWindow();
  });

  windowEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeWindow();
    }
  });

  gridBtn.addEventListener('click', () => {
    setViewMode('grid');
  });

  stripBtn.addEventListener('click', () => {
    setViewMode('strip');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      teardownStreams(windowBody);
      clearTimeout(pollTimer);
    } else {
      probeStatus();
    }
  });
}

async function init() {
  activeUrl = getActiveUrl();

  try {
    const res = await fetch('data/device.json', { cache: 'no-cache' });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg && cfg.url) configUrl = cfg.url;
      if (cfg && cfg.name) configName = cfg.name;
    }
  } catch (_) {}

  activeUrl = getActiveUrl();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mountUI();
      renderBody();
      probeStatus();
    });
  } else {
    mountUI();
    renderBody();
    probeStatus();
  }
}

init();

// Exported for testing / debugging verification
export {
  checkMixedContent,
  countOkCameras,
  formatResolution,
  getActiveUrl,
  probeStatus,
  openWindow,
  closeWindow,
  setViewMode,
};
