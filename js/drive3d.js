/* Civimatica Milan Pilot — 3D Clay Drive-Through
   - Three.js 0.169.0 modular engine
   - Warm matte clay material world matching visual reference
   - Procedural clay city (merged buildings, roads, areas)
   - Procedural clay vehicles (sedan, bus, truck, motorcycle, bicycle)
   - Follow chase camera with OrbitControls + Overview + Fullscreen
   - Station-order timeline scrubber with play/pause and speeds (1x, 4x, 16x, 64x)
   - Scorecard ("Seen So Far") and Inspector with parking dwell demo data
   - Hover-to-lift and click-to-inspect interaction
*/

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { dwellMinutes, formatDwell } from './dwell.js';

const intFmt = new Intl.NumberFormat('en-US');

export function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function formatClsLabel(cls) {
  if (!cls) return '';
  return cls.replace(/_sign$/, '')
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Global 3D State
let appState = null;

export async function initDrive3D(container, drive, sceneData, initialT = null) {
  if (appState) {
    resumeDrive3D(initialT);
    return;
  }

  // Create UI Structure
  container.innerHTML = `
    <div class="drive-layout">
      <!-- 3D Canvas Area (Cols 1–8, Row 1) -->
      <div class="drive-canvas-col">
        <div class="drive-canvas-wrap" id="drive-canvas-wrap">
          <canvas id="drive-canvas" class="drive-canvas"></canvas>

          <div class="drive-cam-buttons">
            <button type="button" class="btn-cam-mode is-active" id="btn-cam-follow" data-mode="follow">Follow</button>
            <button type="button" class="btn-cam-mode" id="btn-cam-overview" data-mode="overview">Overview</button>
            <button type="button" class="btn-cam-mode" id="btn-cam-fs" aria-label="Toggle Fullscreen">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M2 5V2H5M9 2H12V5M12 9V12H9M5 12H2V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>

          <div class="drive-hint-pill" aria-hidden="true">
            Drag to orbit · Scroll to zoom · Hover to lift · Click to inspect
          </div>

          <div id="drive-hover-tooltip" class="drive-hover-tooltip" hidden></div>
        </div>
      </div>

      <!-- Timeline & Scrubber (Cols 1–8, Row 2) -->
      <div class="drive-timeline-col">
        <section class="drive-timeline-card" aria-label="Drive Timeline">
          <div class="drive-timeline-header">
            <div class="drive-timeline-left">
              <button type="button" class="btn-play-pause" id="drive-play-pause">Play</button>
              <div class="speed-selector" role="radiogroup" aria-label="Playback speed">
                <button type="button" class="btn-speed" data-speed="1">1×</button>
                <button type="button" class="btn-speed" data-speed="4">4×</button>
                <button type="button" class="btn-speed is-active" data-speed="16">16×</button>
                <button type="button" class="btn-speed" data-speed="64">64×</button>
              </div>
            </div>
            <span id="drive-street-name" class="drive-current-street">Viale Nazario Sauro</span>
            <span id="drive-time-display" class="drive-time tnum">00:00 / 36:23</span>
          </div>

          <div class="drive-scrubber-wrap" id="drive-scrubber-wrap">
            <div class="drive-scrubber-track" id="drive-scrubber-track" role="slider" aria-label="Timeline seek" aria-valuemin="0" aria-valuemax="2183" aria-valuenow="0"></div>
            <div class="drive-playhead" id="drive-playhead" style="left: 0%;"></div>
          </div>
        </section>
      </div>

      <!-- Sidebar: Seen So Far, Inspector, Cameras (Cols 9–12) -->
      <div class="drive-sidebar-col">
        <!-- Seen So Far Card -->
        <section class="legend-box" aria-labelledby="seen-heading">
          <h2 id="seen-heading" class="legend-h2">Seen So Far</h2>
          <div class="legend-entries">
            <button type="button" class="legend-entry" data-layer-toggle="signs" aria-pressed="true">
              <div class="legend-row-top">
                <div class="legend-left-group">
                  <span class="legend-num">1.</span>
                  <span class="swatch-mark"><span class="swatch-circle"></span></span>
                  <span class="legend-obj-name">Road signage</span>
                </div>
                <span class="legend-fig tnum"><span id="seen-signs-count">0</span> / 2,148</span>
              </div>
              <div class="legend-line">vertical signs · 30 types on 25 streets</div>
              <div class="legend-gap">
                <span class="mini-hatch" aria-hidden="true"></span>
                <span>Horizontal markings: not detected yet</span>
              </div>
            </button>

            <button type="button" class="legend-entry" data-layer-toggle="parked" aria-pressed="true">
              <div class="legend-row-top">
                <div class="legend-left-group">
                  <span class="legend-num">2.</span>
                  <span class="swatch-mark"><span class="swatch-square"></span></span>
                  <span class="legend-obj-name">Parked vehicles</span>
                </div>
                <span class="legend-fig tnum"><span id="seen-parked-count">0</span> / 231</span>
              </div>
              <div class="legend-line">parked cars · 197 on named streets · 34 unread</div>
              <div class="legend-gap">
                <span class="mini-hatch" aria-hidden="true"></span>
                <span>Inside vs outside marked bays: unmeasured</span>
              </div>
            </button>

            <div class="legend-entry legend-static">
              <div class="legend-row-top">
                <div class="legend-left-group">
                  <span class="legend-num">3.</span>
                  <span class="swatch-mark"><span class="swatch-hatch"></span></span>
                  <span class="legend-obj-name">Plates of parked vehicles</span>
                </div>
                <span class="legend-fig tnum">4,090</span>
              </div>
              <div class="legend-line">plate reads kept · text stays on vehicle</div>
              <div class="legend-gap">
                <span class="mini-hatch" aria-hidden="true"></span>
                <span>per-car plate times are not exported</span>
              </div>
            </div>

            <button type="button" class="legend-entry" data-layer-toggle="objects" aria-pressed="true">
              <div class="legend-row-top">
                <div class="legend-left-group">
                  <span class="legend-num">4.</span>
                  <span class="swatch-mark"><span class="swatch-diamond"></span></span>
                  <span class="legend-obj-name">Other objects</span>
                </div>
                <span class="legend-fig tnum"><span id="seen-objects-count">0</span> / 838</span>
              </div>
              <div class="legend-line">172 bikes · 374 motos · 135 buses · 157 trucks</div>
              <div class="legend-gap">
                <span class="mini-hatch" aria-hidden="true"></span>
                <span>side cameras did not run on this drive</span>
              </div>
            </button>
          </div>
        </section>

        <!-- Inspector Card -->
        <section class="title-block" aria-labelledby="insp-heading">
          <h2 id="insp-heading" class="legend-h2" style="font-size:14px;border-bottom:1px solid var(--hairline);padding-bottom:4px;margin-bottom:6px;">Inspector</h2>
          <div id="inspector-body">
            <p class="inspector-empty">Click a sign or vehicle to inspect it</p>
          </div>
        </section>

        <!-- Cameras Card -->
        <section class="title-block" aria-labelledby="cams-heading">
          <h2 id="cams-heading" class="legend-h2" style="font-size:14px;border-bottom:1px solid var(--hairline);padding-bottom:4px;margin-bottom:6px;">Cameras</h2>
          <dl class="title-block-grid" style="row-gap:5px;">
            <dt>c1</dt>
            <dd>Front camera: the only camera in this drive</dd>
            <dt>c0</dt>
            <dd class="desc">Front stereo: not in this drive</dd>
            <dt>c2</dt>
            <dd class="desc">Right 5 MP: not in this drive</dd>
            <dt>c3</dt>
            <dd class="desc">Left 5 MP: not in this drive</dd>
          </dl>
        </section>
      </div>
    </div>
  `;

  const canvas = document.getElementById('drive-canvas');
  const canvasWrap = document.getElementById('drive-canvas-wrap');

  // Three.js Core Setup
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvasWrap.clientWidth, canvasWrap.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18; // Crisp, high-contrast exposure

  const scene = new THREE.Scene();
  const clayBgColor = 0x8a837a; // Warm taupe ground background
  scene.background = new THREE.Color(clayBgColor);
  scene.fog = new THREE.Fog(clayBgColor, 160, 650);

  const camera = new THREE.PerspectiveCamera(50, canvasWrap.clientWidth / canvasWrap.clientHeight, 0.5, 12000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;

  // Lighting: strong key sun at lower angle for long soft shadows + subtle fill
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x6a645c, 0.65);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xfff2dc, 1.5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.near = 10;
  dirLight.shadow.camera.far = 380;
  dirLight.shadow.camera.left = -110;
  dirLight.shadow.camera.right = 110;
  dirLight.shadow.camera.top = 110;
  dirLight.shadow.camera.bottom = -110;
  dirLight.shadow.bias = -0.0003;
  dirLight.shadow.radius = 2.5;
  scene.add(dirLight);
  scene.add(dirLight.target);

  // Selection Ring on ground (violet action)
  const ringGeo = new THREE.RingGeometry(2.4, 2.7, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x5b3fa6, side: THREE.DoubleSide });
  const selectionRing = new THREE.Mesh(ringGeo, ringMat);
  selectionRing.position.y = 0.045;
  selectionRing.visible = false;
  scene.add(selectionRing);

  // High-contrast clay materials
  const buildingMat = new THREE.MeshStandardMaterial({ color: 0xded9d0, roughness: 0.95, metalness: 0.02 });
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x7d7770, roughness: 0.96, metalness: 0.02 });
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x8a837a, roughness: 0.98, metalness: 0.02 });
  const greenMat = new THREE.MeshStandardMaterial({ color: 0x76826e, roughness: 0.95 });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x6e7e8c, roughness: 0.95 });

  // 1. Ground Plane
  const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), groundMat);
  groundPlane.rotateX(-Math.PI / 2);
  groundPlane.position.y = -0.05;
  groundPlane.receiveShadow = true;
  scene.add(groundPlane);

  // 2. Build Static City Geometry (merged)
  buildCity(scene, sceneData, { buildingMat, roadMat, greenMat, waterMat });

  // 3. Build Route Ribbons (0.6m driven ink ribbon + faint ahead ribbon, NO white band)
  const routeMeshes = buildRouteRibbons(scene, drive.route);

  // 4. Procedural Models & Instances
  const instances = buildInstances(scene, drive.tracks, drive.route);

  // 5. Ego Vehicle & Camera Wedges
  const ego = buildEgoVehicle(scene, drive.cameras);

  // Create App State
  appState = {
    container,
    canvas,
    canvasWrap,
    renderer,
    scene,
    camera,
    controls,
    dirLight,
    selectionRing,
    routeMeshes,
    instances,
    ego,
    drive,
    sceneData,
    currentTime: initialT != null ? initialT : 0.0,
    isPlaying: false,
    playbackSpeed: 16.0,
    cameraMode: 'follow',
    selectedTrack: null,
    hoveredItem: null,
    layerVisibility: { signs: true, parked: true, objects: true },
    totalDuration: drive.duration_s || 2183.35,
    lastFrameTime: performance.now(),
    fps: 60.0,
    fpsFrames: 0,
    fpsLastTime: performance.now(),
    raycaster: new THREE.Raycaster(),
    mouse: new THREE.Vector2(-999, -999)
  };

  // Wire up Scrubber, Timeline & Listeners
  initScrubber(appState);
  initControls(appState);
  initInteractions(appState);

  // Set Initial State
  seekTo(appState, appState.currentTime, false);

  // Start Animation Loop
  startAnimationLoop(appState);
}

// -------------------------------------------------------------
// CITY BUILDER (Merged Geometries for High FPS)
// -------------------------------------------------------------
function buildCity(scene, sceneData, materials) {
  // Buildings
  const buildingGeoms = [];
  const blds = sceneData.buildings || [];
  for (const b of blds) {
    if (!b.pts || b.pts.length < 3) continue;
    try {
      const shape = new THREE.Shape();
      shape.moveTo(b.pts[0][0], b.pts[0][1]);
      for (let i = 1; i < b.pts.length; i++) {
        shape.lineTo(b.pts[i][0], b.pts[i][1]);
      }
      shape.closePath();
      const depth = Math.max(2.5, (b.h || 12.0) - (b.min_h || 0));
      const geom = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      geom.rotateX(-Math.PI / 2);
      geom.translate(0, b.min_h || 0, 0);
      buildingGeoms.push(geom);
    } catch {}
  }

  if (buildingGeoms.length > 0) {
    const mergedBuildings = BufferGeometryUtils.mergeGeometries(buildingGeoms, false);
    if (mergedBuildings) {
      mergedBuildings.computeVertexNormals();
      const buildingsMesh = new THREE.Mesh(mergedBuildings, materials.buildingMat);
      buildingsMesh.castShadow = true;
      buildingsMesh.receiveShadow = true;
      scene.add(buildingsMesh);
    }
  }

  // Roads
  const roadGeoms = [];
  const roads = sceneData.roads || [];
  for (const r of roads) {
    if (!r.pts || r.pts.length < 2) continue;
    try {
      const hw = (r.width || 6.5) / 2;
      const g = buildPolylineRibbon(r.pts, hw, 0.02);
      if (g) roadGeoms.push(g);
    } catch {}
  }

  if (roadGeoms.length > 0) {
    const mergedRoads = BufferGeometryUtils.mergeGeometries(roadGeoms, false);
    if (mergedRoads) {
      const roadsMesh = new THREE.Mesh(mergedRoads, materials.roadMat);
      roadsMesh.receiveShadow = true;
      scene.add(roadsMesh);
    }
  }

  // Areas
  const greenGeoms = [];
  const waterGeoms = [];
  const greenKinds = new Set(['park', 'garden', 'grass', 'wood', 'pitch', 'playground', 'dog_park']);

  for (const a of (sceneData.areas || [])) {
    if (!a.pts || a.pts.length < 3) continue;
    try {
      const shape = new THREE.Shape();
      shape.moveTo(a.pts[0][0], a.pts[0][1]);
      for (let i = 1; i < a.pts.length; i++) {
        shape.lineTo(a.pts[i][0], a.pts[i][1]);
      }
      shape.closePath();
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0.01, 0);
      if (a.kind === 'water') {
        waterGeoms.push(g);
      } else if (greenKinds.has(a.kind)) {
        greenGeoms.push(g);
      }
    } catch {}
  }

  if (greenGeoms.length > 0) {
    const mg = BufferGeometryUtils.mergeGeometries(greenGeoms, false);
    if (mg) {
      const m = new THREE.Mesh(mg, materials.greenMat);
      m.receiveShadow = true;
      scene.add(m);
    }
  }
  if (waterGeoms.length > 0) {
    const mw = BufferGeometryUtils.mergeGeometries(waterGeoms, false);
    if (mw) {
      const m = new THREE.Mesh(mw, materials.waterMat);
      m.receiveShadow = true;
      scene.add(m);
    }
  }
}

function buildPolylineRibbon(pts, halfWidth, yOffset) {
  const n = pts.length;
  if (n < 2) return null;
  const positions = new Float32Array(n * 2 * 3);
  const indices = [];

  for (let i = 0; i < n; i++) {
    const p = pts[i];
    let dx = 0, dz = 0;
    if (i < n - 1) {
      dx += pts[i + 1][0] - p[0];
      dz += -pts[i + 1][1] - (-p[1]);
    }
    if (i > 0) {
      dx += p[0] - pts[i - 1][0];
      dz += -p[1] - (-pts[i - 1][1]);
    }
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;

    const xLeft = p[0] - nx * halfWidth;
    const zLeft = -p[1] - nz * halfWidth;
    const xRight = p[0] + nx * halfWidth;
    const zRight = -p[1] + nz * halfWidth;

    positions[i * 6 + 0] = xLeft;
    positions[i * 6 + 1] = yOffset;
    positions[i * 6 + 2] = zLeft;

    positions[i * 6 + 3] = xRight;
    positions[i * 6 + 4] = yOffset;
    positions[i * 6 + 5] = zRight;

    if (i < n - 1) {
      const v0 = i * 2;
      const v1 = i * 2 + 1;
      const v2 = (i + 1) * 2;
      const v3 = (i + 1) * 2 + 1;
      indices.push(v0, v1, v2, v1, v3, v2);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

// -------------------------------------------------------------
// ROUTE RIBBONS (Driven: 0.6m ink ribbon; Ahead: faint ribbon at 35% opacity)
// -------------------------------------------------------------
function buildRouteRibbons(scene, route) {
  const n = route.x.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push([route.x[i], route.y[i]]);
  }

  // Ahead route ribbon (thin 0.5m ribbon at 35% opacity, no white band)
  const faintGeom = buildPolylineRibbon(pts, 0.25, 0.035);
  const faintMat = new THREE.MeshBasicMaterial({ color: 0x1c1e21, transparent: true, opacity: 0.35, depthWrite: false });
  const faintMesh = new THREE.Mesh(faintGeom, faintMat);
  scene.add(faintMesh);

  // Driven route ribbon: ~0.6m wide ink ribbon (halfWidth = 0.3m), raised just above the road
  const drivenGeom = buildPolylineRibbon(pts, 0.3, 0.04);
  const drivenMat = new THREE.MeshBasicMaterial({ color: 0x1c1e21, depthWrite: false });
  const drivenMesh = new THREE.Mesh(drivenGeom, drivenMat);
  drivenMesh.geometry.setDrawRange(0, 0);
  scene.add(drivenMesh);

  return { faintMesh, drivenMesh, totalIndices: (n - 1) * 6, routeLength: n };
}

// -------------------------------------------------------------
// PROCEDURAL CLAY VEHICLES WITH REAL SILHOUETTES & WINDOWS
function prepGeom(g) {
  const nonIndexed = g.index ? g.toNonIndexed() : g;
  nonIndexed.clearGroups();
  return nonIndexed;
}

function createSedanGeometry() {
  // Real sedan profile (bumper, hood, windshield, roof, rear window, trunk)
  const shape = new THREE.Shape();
  shape.moveTo(-2.2, 0.22);
  shape.lineTo(-2.15, 0.65);
  shape.quadraticCurveTo(-1.8, 0.75, -0.9, 0.78);
  shape.quadraticCurveTo(-0.7, 0.95, -0.35, 1.35);
  shape.quadraticCurveTo(0.2, 1.38, 0.7, 1.35);
  shape.quadraticCurveTo(1.05, 1.1, 1.4, 0.82);
  shape.lineTo(2.1, 0.8);
  shape.lineTo(2.2, 0.22);
  shape.lineTo(1.8, 0.22);
  shape.absarc(1.4, 0.32, 0.42, 0, Math.PI, false);
  shape.lineTo(1.0, 0.22);
  shape.lineTo(-1.0, 0.22);
  shape.absarc(-1.4, 0.32, 0.42, 0, Math.PI, false);
  shape.lineTo(-1.8, 0.22);
  shape.closePath();

  const bodyGeom = new THREE.ExtrudeGeometry(shape, {
    depth: 1.8,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 2
  });
  bodyGeom.translate(0, 0, -0.9);
  bodyGeom.rotateY(-Math.PI / 2);

  const winGeom = new THREE.BoxGeometry(1.68, 0.45, 1.95);
  winGeom.translate(0, 1.05, -0.05);

  const wGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.24, 14);
  wGeo.rotateZ(Math.PI / 2);
  const w1 = wGeo.clone().translate(-0.86, 0.32, -1.4);
  const w2 = wGeo.clone().translate(0.86, 0.32, -1.4);
  const w3 = wGeo.clone().translate(-0.86, 0.32, 1.4);
  const w4 = wGeo.clone().translate(0.86, 0.32, 1.4);
  const wheelsGeom = BufferGeometryUtils.mergeGeometries([w1, w2, w3, w4], false);

  const merged = BufferGeometryUtils.mergeGeometries([prepGeom(bodyGeom), prepGeom(winGeom), prepGeom(wheelsGeom)], true);
  merged.computeVertexNormals();
  return merged;
}

function createBusGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-5.8, 0.3);
  shape.quadraticCurveTo(-5.8, 2.9, -5.5, 3.1);
  shape.lineTo(5.5, 3.1);
  shape.quadraticCurveTo(5.8, 2.9, 5.8, 0.3);
  shape.closePath();

  const bodyGeom = new THREE.ExtrudeGeometry(shape, {
    depth: 2.5,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 2
  });
  bodyGeom.translate(0, 0, -1.25);
  bodyGeom.rotateY(-Math.PI / 2);

  const winGeom = new THREE.BoxGeometry(2.38, 0.9, 10.6);
  winGeom.translate(0, 2.1, 0);

  const wGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.28, 12);
  wGeo.rotateZ(Math.PI / 2);
  const w1 = wGeo.clone().translate(-1.25, 0.45, -4.2);
  const w2 = wGeo.clone().translate(1.25, 0.45, -4.2);
  const w3 = wGeo.clone().translate(-1.25, 0.45, 4.2);
  const w4 = wGeo.clone().translate(1.25, 0.45, 4.2);
  const wheelsGeom = BufferGeometryUtils.mergeGeometries([w1, w2, w3, w4], false);

  const merged = BufferGeometryUtils.mergeGeometries([prepGeom(bodyGeom), prepGeom(winGeom), prepGeom(wheelsGeom)], true);
  merged.computeVertexNormals();
  return merged;
}

function createTruckGeometry() {
  // Cab
  const cabShape = new THREE.Shape();
  cabShape.moveTo(-1.2, 0.3);
  cabShape.lineTo(-1.2, 1.6);
  cabShape.quadraticCurveTo(-1.0, 2.7, -0.6, 2.9);
  cabShape.lineTo(1.1, 2.9);
  cabShape.lineTo(1.1, 0.3);
  cabShape.closePath();

  const cabGeom = new THREE.ExtrudeGeometry(cabShape, { depth: 2.4, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
  cabGeom.translate(0, 0, -1.2);
  cabGeom.rotateY(-Math.PI / 2);
  cabGeom.translate(0, 0, -2.6);

  // Cargo Box
  const bed = new THREE.BoxGeometry(2.45, 2.9, 5.6);
  bed.translate(0, 1.8, 1.3);

  // Wheels
  const wGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.28, 12);
  wGeo.rotateZ(Math.PI / 2);
  const w1 = wGeo.clone().translate(-1.2, 0.45, -2.4);
  const w2 = wGeo.clone().translate(1.2, 0.45, -2.4);
  const w3 = wGeo.clone().translate(-1.2, 0.45, 2.4);
  const w4 = wGeo.clone().translate(1.2, 0.45, 2.4);
  const wheelsGeom = BufferGeometryUtils.mergeGeometries([w1, w2, w3, w4], false);

  const merged = BufferGeometryUtils.mergeGeometries([prepGeom(cabGeom), prepGeom(bed), prepGeom(wheelsGeom)], true);
  merged.computeVertexNormals();
  return merged;
}

function createMotoGeometry() {
  const body = new THREE.BoxGeometry(0.5, 0.75, 1.9);
  body.translate(0, 0.65, 0);
  const wGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.12, 10);
  wGeo.rotateZ(Math.PI / 2);
  const w1 = wGeo.clone().translate(0, 0.3, 0.7);
  const w2 = wGeo.clone().translate(0, 0.3, -0.7);
  const merged = BufferGeometryUtils.mergeGeometries([body, w1, w2], false);
  merged.computeVertexNormals();
  return merged;
}

function createBikeGeometry() {
  const frame = new THREE.BoxGeometry(0.1, 0.6, 1.3);
  frame.translate(0, 0.6, 0);
  const wGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.06, 10);
  wGeo.rotateZ(Math.PI / 2);
  const w1 = wGeo.clone().translate(0, 0.32, 0.65);
  const w2 = wGeo.clone().translate(0, 0.32, -0.65);
  const merged = BufferGeometryUtils.mergeGeometries([frame, w1, w2], false);
  merged.computeVertexNormals();
  return merged;
}

function createSignPlateGeometry(kind) {
  if (kind === 'circle') {
    const g = new THREE.CylinderGeometry(0.35, 0.35, 0.02, 16);
    g.rotateX(Math.PI / 2);
    g.translate(0, 2.45, 0);
    return g;
  }
  if (kind === 'triangle') {
    const g = new THREE.CylinderGeometry(0.38, 0.38, 0.02, 3);
    g.rotateX(Math.PI / 2);
    g.translate(0, 2.45, 0);
    return g;
  }
  const g = new THREE.BoxGeometry(0.6, 0.6, 0.02);
  g.translate(0, 2.45, 0);
  return g;
}

// -------------------------------------------------------------
// INSTANCES SETUP & MANAGEMENT
// -------------------------------------------------------------
function buildInstances(scene, tracks, route) {
  const signTracks = tracks.filter(t => t.kind === 'sign');
  const parkedTracks = tracks.filter(t => t.kind === 'vehicle' && t.cls === 'car' && t.state === 'parked');
  const bikeTracks = tracks.filter(t => t.cls === 'bicycle');
  const motoTracks = tracks.filter(t => t.cls === 'motorcycle');
  const busTracks = tracks.filter(t => t.cls === 'bus');
  const truckTracks = tracks.filter(t => t.cls === 'truck');
  const movingCarTracks = tracks.filter(t => t.kind === 'vehicle' && t.cls === 'car' && t.state !== 'parked');

  // Multi-materials for realistic clay silhouettes
  const clayBodyMat = new THREE.MeshStandardMaterial({ color: 0xf5f2eb, roughness: 0.95 }); // Near-white clay
  const clayWinMat = new THREE.MeshStandardMaterial({ color: 0x8a847c, roughness: 0.9 }); // Darker clay window band
  const clayWheelMat = new THREE.MeshStandardMaterial({ color: 0x383531, roughness: 0.92 }); // Charcoal clay wheels

  const parkedBodyMat = new THREE.MeshStandardMaterial({ color: 0x1f5fbf, roughness: 0.9 }); // Parking blue
  const parkedWinMat = new THREE.MeshStandardMaterial({ color: 0x143c7a, roughness: 0.9 });

  const objGreenMat = new THREE.MeshStandardMaterial({ color: 0x2f8a4c, transparent: true, opacity: 0.55, roughness: 0.9 });
  const ghostCarMat = new THREE.MeshStandardMaterial({ color: 0xd6d1c8, transparent: true, opacity: 0.55, roughness: 0.95 });
  const signRedMat = new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.9 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xa8a49c, roughness: 0.9 });

  // Geometries
  const sedanGeo = createSedanGeometry();
  const busGeo = createBusGeometry();
  const truckGeo = createTruckGeometry();
  const motoGeo = createMotoGeometry();
  const bikeGeo = createBikeGeometry();

  const poleGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.5, 8);
  poleGeo.translate(0, 1.25, 0);

  // Classify signs by plate shape
  const circleSigns = [];
  const triangleSigns = [];
  const rectSigns = [];

  for (const st of signTracks) {
    const cls = st.cls || '';
    if (cls.includes('warning') || cls.includes('curve') || cls.includes('yield') || cls.includes('narrows')) {
      triangleSigns.push(st);
    } else if (cls.includes('parking') || cls.includes('info') || cls.includes('priority')) {
      rectSigns.push(st);
    } else {
      circleSigns.push(st);
    }
  }

  const getEgoFacingYaw = (tx, ty, t0) => {
    const pose = getPoseAt(route, t0);
    const ex = pose.x;
    const ez = -pose.y;
    const sx = tx;
    const sz = -ty;
    return Math.atan2(ex - sx, ez - sz);
  };

  // 1. Signs InstancedMeshes
  const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, signTracks.length);
  poleMesh.castShadow = true;
  scene.add(poleMesh);

  const signCircleMesh = new THREE.InstancedMesh(createSignPlateGeometry('circle'), signRedMat, circleSigns.length);
  signCircleMesh.castShadow = true;
  scene.add(signCircleMesh);

  const signTriangleMesh = new THREE.InstancedMesh(createSignPlateGeometry('triangle'), signRedMat, triangleSigns.length);
  signTriangleMesh.castShadow = true;
  scene.add(signTriangleMesh);

  const signRectMesh = new THREE.InstancedMesh(createSignPlateGeometry('square'), signRedMat, rectSigns.length);
  signRectMesh.castShadow = true;
  scene.add(signRectMesh);

  // 2. Parked Cars (multi-material: body, windows, wheels)
  const parkedMesh = new THREE.InstancedMesh(sedanGeo, [parkedBodyMat, parkedWinMat, clayWheelMat], parkedTracks.length);
  parkedMesh.castShadow = true;
  parkedMesh.receiveShadow = true;
  scene.add(parkedMesh);

  // 3. Other Objects
  const bikeMesh = new THREE.InstancedMesh(bikeGeo, objGreenMat, bikeTracks.length);
  const motoMesh = new THREE.InstancedMesh(motoGeo, objGreenMat, motoTracks.length);
  const busMesh = new THREE.InstancedMesh(busGeo, [objGreenMat, clayWinMat, clayWheelMat], busTracks.length);
  const truckMesh = new THREE.InstancedMesh(truckGeo, [objGreenMat, clayWinMat, clayWheelMat], truckTracks.length);
  scene.add(bikeMesh);
  scene.add(motoMesh);
  scene.add(busMesh);
  scene.add(truckMesh);

  // 4. Moving/Unknown Cars (active sweep pool up to 180)
  const MAX_ACTIVE_GHOSTS = 180;
  const ghostCarsMesh = new THREE.InstancedMesh(sedanGeo, [ghostCarMat, clayWinMat, clayWheelMat], MAX_ACTIVE_GHOSTS);
  scene.add(ghostCarsMesh);

  // Initialize all instance matrices to zero scale
  const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < signTracks.length; i++) poleMesh.setMatrixAt(i, zeroMatrix);
  for (let i = 0; i < circleSigns.length; i++) signCircleMesh.setMatrixAt(i, zeroMatrix);
  for (let i = 0; i < triangleSigns.length; i++) signTriangleMesh.setMatrixAt(i, zeroMatrix);
  for (let i = 0; i < rectSigns.length; i++) signRectMesh.setMatrixAt(i, zeroMatrix);
  for (let i = 0; i < parkedTracks.length; i++) parkedMesh.setMatrixAt(i, zeroMatrix);
  for (let i = 0; i < bikeTracks.length; i++) bikeMesh.setMatrixAt(i, zeroMatrix);
  for (let i = 0; i < motoTracks.length; i++) motoMesh.setMatrixAt(i, zeroMatrix);
  for (let i = 0; i < busTracks.length; i++) busMesh.setMatrixAt(i, zeroMatrix);
  for (let i = 0; i < truckTracks.length; i++) truckMesh.setMatrixAt(i, zeroMatrix);
  for (let i = 0; i < MAX_ACTIVE_GHOSTS; i++) ghostCarsMesh.setMatrixAt(i, zeroMatrix);

  poleMesh.instanceMatrix.needsUpdate = true;
  signCircleMesh.instanceMatrix.needsUpdate = true;
  signTriangleMesh.instanceMatrix.needsUpdate = true;
  signRectMesh.instanceMatrix.needsUpdate = true;
  parkedMesh.instanceMatrix.needsUpdate = true;
  bikeMesh.instanceMatrix.needsUpdate = true;
  motoMesh.instanceMatrix.needsUpdate = true;
  busMesh.instanceMatrix.needsUpdate = true;
  truckMesh.instanceMatrix.needsUpdate = true;
  ghostCarsMesh.instanceMatrix.needsUpdate = true;

  // Metadata mappings for raycasting
  const metaMap = new Map();

  const registerGroup = (mesh, groupTracks, type, customYawFn) => {
    mesh.userData = { type, items: [] };
    groupTracks.forEach((tr, idx) => {
      const yaw = customYawFn ? customYawFn(tr) : 0;
      const basePos = new THREE.Vector3(tr.xy[0], 0, -tr.xy[1]);
      const baseQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const item = { track: tr, idx, basePos, baseQuat, isLifted: false };
      mesh.userData.items.push(item);
      metaMap.set(`${mesh.id}_${idx}`, item);
    });
  };

  registerGroup(signCircleMesh, circleSigns, 'sign', tr => getEgoFacingYaw(tr.xy[0], tr.xy[1], tr.t0));
  registerGroup(signTriangleMesh, triangleSigns, 'sign', tr => getEgoFacingYaw(tr.xy[0], tr.xy[1], tr.t0));
  registerGroup(signRectMesh, rectSigns, 'sign', tr => getEgoFacingYaw(tr.xy[0], tr.xy[1], tr.t0));

  // Parked cars yaw parallel to ego heading at t0
  registerGroup(parkedMesh, parkedTracks, 'parked', tr => {
    const pose = getPoseAt(route, tr.t0);
    return Math.PI / 2 - pose.h;
  });

  registerGroup(bikeMesh, bikeTracks, 'object', tr => Math.PI / 2 - getPoseAt(route, tr.t0).h);
  registerGroup(motoMesh, motoTracks, 'object', tr => Math.PI / 2 - getPoseAt(route, tr.t0).h);
  registerGroup(busMesh, busTracks, 'object', tr => Math.PI / 2 - getPoseAt(route, tr.t0).h);
  registerGroup(truckMesh, truckTracks, 'object', tr => Math.PI / 2 - getPoseAt(route, tr.t0).h);

  const ret = {
    signTracks,
    circleSigns,
    triangleSigns,
    rectSigns,
    parkedTracks,
    bikeTracks,
    motoTracks,
    busTracks,
    truckTracks,
    movingCarTracks,
    poleMesh,
    signCircleMesh,
    signTriangleMesh,
    signRectMesh,
    parkedMesh,
    bikeMesh,
    motoMesh,
    busMesh,
    truckMesh,
    ghostCarsMesh,
    MAX_ACTIVE_GHOSTS,
    metaMap,
    interactiveMeshes: [
      signCircleMesh,
      signTriangleMesh,
      signRectMesh,
      parkedMesh,
      bikeMesh,
      motoMesh,
      busMesh,
      truckMesh
    ]
  };

  // Ensure raycaster tests instances across the full 10.8 km route
  ret.interactiveMeshes.forEach(m => {
    if (m.geometry) {
      m.geometry.computeBoundingSphere();
      if (m.geometry.boundingSphere) {
        m.geometry.boundingSphere.radius = 8000;
      }
    }
  });

  return ret;
}

// -------------------------------------------------------------
// EGO VEHICLE & CAMERA FOV WEDGES
// -------------------------------------------------------------
function buildEgoVehicle(scene, camerasData) {
  const egoGroup = new THREE.Group();

  // Sedan body in dark ink clay
  const sedanGeo = createSedanGeometry();
  const egoMat = new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.88 });
  const egoWinMat = new THREE.MeshStandardMaterial({ color: 0x101113, roughness: 0.85 });
  const egoWheelMat = new THREE.MeshStandardMaterial({ color: 0x101113, roughness: 0.9 });
  const egoCar = new THREE.Mesh(sedanGeo, [egoMat, egoWinMat, egoWheelMat]);
  egoCar.castShadow = true;
  egoGroup.add(egoCar);

  // Roof bar with 4 Camera Pods
  const barMat = new THREE.MeshStandardMaterial({ color: 0x2e2b26, roughness: 0.5 });
  const roofBar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.08), barMat);
  roofBar.position.set(0, 1.42, -0.1);
  egoGroup.add(roofBar);

  const podMat = new THREE.MeshStandardMaterial({ color: 0x3a3834, roughness: 0.5 });
  const c0Pod = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.12), podMat);
  c0Pod.position.set(0, 1.48, -0.4); // front stereo
  const c1Pod = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 12), podMat);
  c1Pod.position.set(0, 1.5, -0.1); // front camera
  const c2Pod = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.15), podMat);
  c2Pod.position.set(0.6, 1.48, -0.1); // right
  c2Pod.rotation.y = -70 * Math.PI / 180;
  const c3Pod = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.15), podMat);
  c3Pod.position.set(-0.6, 1.48, -0.1); // left
  c3Pod.rotation.y = 70 * Math.PI / 180;

  egoGroup.add(c0Pod, c1Pod, c2Pod, c3Pod);

  // Camera Wedges: strictly bounded to radius 25m, no stray lines
  const wedgesGroup = new THREE.Group();
  wedgesGroup.position.y = 0.038;

  // c1 Active Recording Wedge (80° HFOV, radius 25m, lightly filled)
  const c1Wedge = createSectorMesh(25, 0, 80 * Math.PI / 180, true);
  wedgesGroup.add(c1Wedge);

  // c0, c2, c3 Outline Wedges (dashed/low opacity, no stray lines)
  const c0Wedge = createSectorMesh(25, 0, 110.7 * Math.PI / 180, false);
  const c2Wedge = createSectorMesh(25, -70 * Math.PI / 180, 68.6 * Math.PI / 180, false);
  const c3Wedge = createSectorMesh(25, 70 * Math.PI / 180, 64.8 * Math.PI / 180, false);
  wedgesGroup.add(c0Wedge, c2Wedge, c3Wedge);

  egoGroup.add(wedgesGroup);
  scene.add(egoGroup);

  return { egoGroup, wedgesGroup };
}

function createSectorMesh(radius, centerAngle, fov, filled) {
  // In car local space: forward is -Z, right is +X, left is -X
  const startAngle = centerAngle - fov / 2;
  const endAngle = centerAngle + fov / 2;
  const segments = 24;

  const positions = [0, 0, 0]; // center at (0, 0, 0)
  for (let i = 0; i <= segments; i++) {
    const a = startAngle + (endAngle - startAngle) * (i / segments);
    // x = -sin(a)*radius, z = -cos(a)*radius
    const x = -Math.sin(a) * radius;
    const z = -Math.cos(a) * radius;
    positions.push(x, 0, z);
  }

  const group = new THREE.Group();

  if (filled) {
    const indices = [];
    for (let i = 1; i <= segments; i++) {
      indices.push(0, i, i + 1);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1c1e21,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    group.add(new THREE.Mesh(geom, mat));
  }

  // Outline stopping strictly at radius 25m
  const linePositions = [];
  linePositions.push(0, 0, 0);
  for (let i = 0; i <= segments; i++) {
    const a = startAngle + (endAngle - startAngle) * (i / segments);
    const x = -Math.sin(a) * radius;
    const z = -Math.cos(a) * radius;
    linePositions.push(x, 0, z);
  }
  linePositions.push(0, 0, 0);

  const lineGeom = new THREE.BufferGeometry();
  lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  const lineMat = new THREE.LineBasicMaterial({
    color: filled ? 0x1c1e21 : 0x6e6860,
    transparent: true,
    opacity: filled ? 0.85 : 0.35
  });
  group.add(new THREE.Line(lineGeom, lineMat));

  return group;
}

// -------------------------------------------------------------
// POSE & ROUTE INTERPOLATION
// -------------------------------------------------------------
function getPoseAt(route, t) {
  const ts = route.t;
  const n = ts.length;
  if (t <= ts[0]) return { x: route.x[0], y: route.y[0], h: route.h[0], speed: route.speed[0], idx: 0 };
  if (t >= ts[n - 1]) return { x: route.x[n - 1], y: route.y[n - 1], h: route.h[n - 1], speed: route.speed[n - 1], idx: n - 1 };

  let low = 0, high = n - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (ts[mid] < t) low = mid + 1;
    else high = mid - 1;
  }
  const i0 = Math.max(0, low - 1);
  const i1 = Math.min(n - 1, low);
  const dt = ts[i1] - ts[i0];
  const alpha = dt > 0 ? (t - ts[i0]) / dt : 0;

  const x = route.x[i0] + (route.x[i1] - route.x[i0]) * alpha;
  const y = route.y[i0] + (route.y[i1] - route.y[i0]) * alpha;
  const speed = route.speed[i0] + (route.speed[i1] - route.speed[i0]) * alpha;

  let dh = (route.h[i1] - route.h[i0]) % (Math.PI * 2);
  if (dh > Math.PI) dh -= Math.PI * 2;
  if (dh < -Math.PI) dh += Math.PI * 2;
  const h = route.h[i0] + dh * alpha;

  return { x, y, h, speed, idx: i0 + alpha };
}

// -------------------------------------------------------------
// UPDATE PER FRAME
// -------------------------------------------------------------
function updateSceneAt(state, t) {
  const route = state.drive.route;
  const pose = getPoseAt(route, t);

  // 1. Ego Pose
  state.ego.egoGroup.position.set(pose.x, 0, -pose.y);
  state.ego.egoGroup.rotation.y = Math.PI / 2 - pose.h;

  // 2. Driven Route Ribbon
  const drivenIndices = Math.floor(pose.idx) * 6;
  state.routeMeshes.drivenMesh.geometry.setDrawRange(0, Math.min(drivenIndices, state.routeMeshes.totalIndices));

  // 3. Directional Light follows Ego
  state.dirLight.position.set(pose.x + 60, 50, -pose.y + 40);
  state.dirLight.target.position.set(pose.x, 0, -pose.y);

  // 4. Update Instances
  updateInstancesAt(state, t);

  // 5. Update Camera
  updateCamera(state, pose);

  // 6. Update Timeline DOM & Scorecard
  updateTimelineDOM(state, t, pose);
}

function updateInstancesAt(state, t) {
  const inst = state.instances;
  const matrix = new THREE.Matrix4();
  const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Stationary items (signs & parked cars appear at t0 and stay)
  const updatePersistentGroup = (mesh, groupTracks, isVisible) => {
    const items = mesh.userData.items;
    let modified = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const t0 = item.track.t0;
      if (isVisible && t >= t0) {
        let yPos = item.isLifted ? 0.6 : 0;
        if (!reducedMotion && t < t0 + 0.6) {
          const alpha = (t - t0) / 0.6;
          yPos -= (1 - alpha) * 1.5;
        }
        const pos = item.basePos.clone();
        pos.y += yPos;
        matrix.compose(pos, item.baseQuat, new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(i, matrix);
      } else {
        mesh.setMatrixAt(i, zeroMatrix);
      }
      modified = true;
    }
    if (modified) mesh.instanceMatrix.needsUpdate = true;
  };

  // Signs
  const showSigns = state.layerVisibility.signs;
  updatePersistentGroup(inst.signCircleMesh, inst.circleSigns, showSigns);
  updatePersistentGroup(inst.signTriangleMesh, inst.triangleSigns, showSigns);
  updatePersistentGroup(inst.signRectMesh, inst.rectSigns, showSigns);

  // Poles
  for (let i = 0; i < inst.signTracks.length; i++) {
    const tr = inst.signTracks[i];
    if (showSigns && t >= tr.t0) {
      matrix.makeTranslation(tr.xy[0], 0, -tr.xy[1]);
      inst.poleMesh.setMatrixAt(i, matrix);
    } else {
      inst.poleMesh.setMatrixAt(i, zeroMatrix);
    }
  }
  inst.poleMesh.instanceMatrix.needsUpdate = true;

  // Parked Cars
  const showParked = state.layerVisibility.parked;
  updatePersistentGroup(inst.parkedMesh, inst.parkedTracks, showParked);

  // Other Moving Objects (visible only within [t0, t1 + 1.0])
  const showObjects = state.layerVisibility.objects;
  const updateTransientGroup = (mesh, groupTracks) => {
    const items = mesh.userData.items;
    let modified = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const tr = item.track;
      if (showObjects && t >= tr.t0 && t <= (tr.t1 || tr.t0) + 1.0) {
        const yPos = item.isLifted ? 0.6 : 0;
        const pos = item.basePos.clone();
        pos.y += yPos;
        matrix.compose(pos, item.baseQuat, new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(i, matrix);
      } else {
        mesh.setMatrixAt(i, zeroMatrix);
      }
      modified = true;
    }
    if (modified) mesh.instanceMatrix.needsUpdate = true;
  };

  updateTransientGroup(inst.bikeMesh, inst.bikeTracks);
  updateTransientGroup(inst.motoMesh, inst.motoTracks);
  updateTransientGroup(inst.busMesh, inst.busTracks);
  updateTransientGroup(inst.truckMesh, inst.truckTracks);

  // Moving cars active pool sweep
  const activeMovingCars = [];
  for (const tr of inst.movingCarTracks) {
    if (t >= tr.t0 && t <= (tr.t1 || tr.t0) + 1.0) {
      activeMovingCars.push(tr);
      if (activeMovingCars.length >= inst.MAX_ACTIVE_GHOSTS) break;
    }
  }

  for (let i = 0; i < inst.MAX_ACTIVE_GHOSTS; i++) {
    if (i < activeMovingCars.length) {
      const tr = activeMovingCars[i];
      const pose = getPoseAt(state.drive.route, tr.t0);
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 - pose.h);
      matrix.compose(new THREE.Vector3(tr.xy[0], 0, -tr.xy[1]), quat, new THREE.Vector3(1, 1, 1));
      inst.ghostCarsMesh.setMatrixAt(i, matrix);
    } else {
      inst.ghostCarsMesh.setMatrixAt(i, zeroMatrix);
    }
  }
  inst.ghostCarsMesh.instanceMatrix.needsUpdate = true;
}

function updateCamera(state, pose) {
  const egoPos = new THREE.Vector3(pose.x, 0, -pose.y);

  if (state.cameraMode === 'follow') {
    const dist = 24.0;
    const height = 11.0;
    const targetCamX = pose.x - Math.cos(pose.h) * dist;
    const targetCamZ = -pose.y + Math.sin(pose.h) * dist;
    const targetCamY = height;

    if (!state.followInitialized) {
      state.camera.position.set(targetCamX, targetCamY, targetCamZ);
      state.controls.target.copy(egoPos);
      state.followInitialized = true;
    } else {
      const egoDelta = egoPos.clone().sub(state.controls.target);
      state.controls.target.add(egoDelta);
      state.camera.position.add(egoDelta);
    }
  }
  state.controls.update();
}

function updateTimelineDOM(state, t, pose) {
  // Time
  const timeEl = document.getElementById('drive-time-display');
  if (timeEl) {
    timeEl.textContent = `${formatTime(t)} / 36:23`;
  }

  // Playhead position
  const playhead = document.getElementById('drive-playhead');
  if (playhead) {
    const pct = Math.min(100, (t / state.totalDuration) * 100);
    playhead.style.left = `${pct.toFixed(2)}%`;
  }

  // Current street
  const streetEl = document.getElementById('drive-street-name');
  if (streetEl) {
    let streetName = 'Street not read';
    for (const s of (state.drive.streets || [])) {
      if (t >= s.t0 && t <= s.t1) {
        streetName = s.name;
        break;
      }
    }
    streetEl.textContent = streetName;
  }

  // "Seen So Far" Scorecard Counts
  const signsCount = state.instances.signTracks.filter(tr => tr.t0 <= t).length;
  const parkedCount = state.instances.parkedTracks.filter(tr => tr.t0 <= t).length;
  const objectsCount = (state.drive.tracks || []).filter(tr => tr.kind === 'object' || (tr.kind === 'vehicle' && tr.cls !== 'car')).filter(tr => tr.t0 <= t).length;

  const sCountEl = document.getElementById('seen-signs-count');
  if (sCountEl) sCountEl.textContent = intFmt.format(signsCount);
  const pCountEl = document.getElementById('seen-parked-count');
  if (pCountEl) pCountEl.textContent = intFmt.format(parkedCount);
  const oCountEl = document.getElementById('seen-objects-count');
  if (oCountEl) oCountEl.textContent = intFmt.format(objectsCount);
}

// -------------------------------------------------------------
// TIMELINE SCRUBBER
// -------------------------------------------------------------
function initScrubber(state) {
  const trackEl = document.getElementById('drive-scrubber-track');
  if (!trackEl) return;

  const streets = state.drive.streets || [];
  const totalDuration = state.totalDuration;

  const items = [];
  let prevT1 = 0;
  for (let i = 0; i < streets.length; i++) {
    const s = streets[i];
    if (s.t0 > prevT1) {
      items.push({ type: 'gap', duration: s.t0 - prevT1, t0: prevT1 });
    }
    items.push({ type: 'street', name: s.name, t0: s.t0, t1: s.t1, duration: s.t1 - s.t0 });
    prevT1 = s.t1;
  }
  if (prevT1 < totalDuration) {
    items.push({ type: 'gap', duration: totalDuration - prevT1, t0: prevT1 });
  }

  // Create canvas context for exact text measurement
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = '600 13px "Titillium Web", sans-serif';

  trackEl.innerHTML = items.map(it => {
    const widthPct = (it.duration / totalDuration) * 100;
    if (it.type === 'gap') {
      return `<div class="street-gap-spacer" style="width:${widthPct.toFixed(3)}%;flex-basis:${widthPct.toFixed(3)}%;" aria-hidden="true" title="Street not read"></div>`;
    }
    return `
      <div class="street-seg-btn" data-street="${it.name}" data-dur="${it.duration}" data-t0="${it.t0}" style="width:${widthPct.toFixed(3)}%;flex-basis:${widthPct.toFixed(3)}%;" title="${it.name}">
        <span class="seg-name"></span>
      </div>
    `;
  }).join('');

  // Re-run label fit dynamically based on measured track width (no clipped names)
  const updateLabelFits = () => {
    const trackWidth = trackEl.getBoundingClientRect().width || trackEl.clientWidth || 920;
    trackEl.querySelectorAll('.street-seg-btn').forEach(btn => {
      const dur = parseFloat(btn.getAttribute('data-dur') || '0');
      const name = btn.getAttribute('data-street') || '';
      const approxWidthPx = (dur / totalDuration) * trackWidth;
      const textWidthPx = ctx ? ctx.measureText(name).width : name.length * 8;
      const fitsWhole = approxWidthPx >= (textWidthPx + 16);
      const span = btn.querySelector('.seg-name');
      if (span) {
        span.textContent = fitsWhole ? name : '';
      }
    });
  };

  updateLabelFits();

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => updateLabelFits());
    ro.observe(trackEl);
  }

  // Seeking via Click & Drag
  let isDragging = false;

  const seekFromEvent = (e) => {
    const rect = trackEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const targetT = (x / rect.width) * totalDuration;
    seekTo(state, targetT, false);
  };

  trackEl.addEventListener('pointerdown', (e) => {
    isDragging = true;
    trackEl.setPointerCapture(e.pointerId);
    seekFromEvent(e);
  });

  trackEl.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    seekFromEvent(e);
  });

  const onPointerUp = () => {
    if (!isDragging) return;
    isDragging = false;
    writeTimeHash(state.currentTime);
  };

  trackEl.addEventListener('pointerup', onPointerUp);
  trackEl.addEventListener('pointercancel', onPointerUp);
}

// -------------------------------------------------------------
// CONTROLS & LISTENERS
// -------------------------------------------------------------
function initControls(state) {
  // Play / Pause
  const playBtn = document.getElementById('drive-play-pause');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      togglePlay(state);
    });
  }

  // Speeds (1x, 4x, 16x, 64x)
  document.querySelectorAll('.btn-speed').forEach(btn => {
    btn.addEventListener('click', () => {
      const spd = parseFloat(btn.getAttribute('data-speed'));
      state.playbackSpeed = spd;
      document.querySelectorAll('.btn-speed').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    });
  });

  // Camera Mode Buttons
  const followBtn = document.getElementById('btn-cam-follow');
  const overviewBtn = document.getElementById('btn-cam-overview');
  const fsBtn = document.getElementById('btn-cam-fs');

  if (followBtn) {
    followBtn.addEventListener('click', () => {
      setCameraMode('follow');
    });
  }

  if (overviewBtn) {
    overviewBtn.addEventListener('click', () => {
      setCameraMode('overview');
    });
  }

  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        state.canvasWrap.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    });
  }

  // Layer Toggles
  document.querySelectorAll('[data-layer-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const layer = btn.getAttribute('data-layer-toggle');
      state.layerVisibility[layer] = !state.layerVisibility[layer];
      btn.setAttribute('aria-pressed', state.layerVisibility[layer]);
      updateSceneAt(state, state.currentTime);
    });
  });

  // Keyboard Navigation: Space (play/pause), ArrowLeft/ArrowRight (+- 10s)
  window.addEventListener('keydown', (e) => {
    if (state.container.closest('[hidden]')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay(state);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seekTo(state, Math.max(0, state.currentTime - 10), true);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      seekTo(state, Math.min(state.totalDuration, state.currentTime + 10), true);
    }
  });

  // Resize handler
  window.addEventListener('resize', () => {
    if (!state.canvasWrap) return;
    const w = state.canvasWrap.clientWidth;
    const h = state.canvasWrap.clientHeight;
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(w, h);
  });
}

// -------------------------------------------------------------
// RAYCASTING & INTERACTION (Hover-to-lift & Click-to-inspect)
// -------------------------------------------------------------
function initInteractions(state) {
  const canvas = state.canvas;
  const tooltip = document.getElementById('drive-hover-tooltip');

  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    state.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    state.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    state.raycaster.setFromCamera(state.mouse, state.camera);
    const hits = state.raycaster.intersectObjects(state.instances.interactiveMeshes, false);

    if (hits.length > 0) {
      const hit = hits[0];
      const mesh = hit.object;
      const key = `${mesh.id}_${hit.instanceId}`;
      const item = state.instances.metaMap.get(key);

      if (item && item !== state.hoveredItem) {
        if (state.hoveredItem) {
          state.hoveredItem.isLifted = false;
        }
        item.isLifted = true;
        state.hoveredItem = item;
        canvas.style.cursor = 'pointer';

        if (tooltip) {
          tooltip.hidden = false;
          tooltip.style.left = `${e.clientX - rect.left}px`;
          tooltip.style.top = `${e.clientY - rect.top}px`;
          tooltip.textContent = `${formatClsLabel(item.track.cls)} · ${item.track.street || 'street not read'}`;
        }
      }
    } else {
      if (state.hoveredItem) {
        state.hoveredItem.isLifted = false;
        state.hoveredItem = null;
        canvas.style.cursor = 'default';
        if (tooltip) tooltip.hidden = true;
      }
    }
  });

  canvas.addEventListener('click', () => {
    if (state.hoveredItem) {
      selectTrack(state, state.hoveredItem.track);
    }
  });
}

function selectTrack(state, track) {
  state.selectedTrack = track;

  // Move selection ring
  state.selectionRing.visible = true;
  state.selectionRing.position.set(track.xy[0], 0.045, -track.xy[1]);

  // Populate Inspector
  const body = document.getElementById('inspector-body');
  if (body) {
    const isSign = track.kind === 'sign';
    const isParkedCar = (track.kind === 'vehicle' && track.cls === 'car' && track.state === 'parked');
    const clsLabel = formatClsLabel(track.cls);
    const seenStr = (track.t1 != null && track.t1 !== track.t0)
      ? `${formatTime(track.t0)} – ${formatTime(track.t1)}`
      : formatTime(track.t0);
    const sheetLink = isSign
      ? `#/sheet?sign=${encodeURIComponent(track.cls)}`
      : (track.street ? `#/sheet?street=${encodeURIComponent(track.street)}` : '#/sheet');

    // Dwell row for parked cars
    let dwellRow = '';
    if (isParkedCar) {
      dwellRow = `
        <dt>Dwell</dt>
        <dd>
          <span class="tnum">${formatDwell(dwellMinutes(track))}</span>
          <span class="tag-demo" title="Demo data: not measured on this drive"><span class="mini-hatch" aria-hidden="true"></span>Demo</span>
        </dd>
      `;
    }

    body.innerHTML = `
      <dl class="title-block-grid" style="row-gap:5px;">
        <dt>Type</dt>
        <dd><strong>${clsLabel}</strong></dd>
        <dt>State</dt>
        <dd>${track.state || (isSign ? 'stationary' : 'moving')}</dd>
        ${dwellRow}
        <dt>Confirmed</dt>
        <dd>${track.confirmed ? 'Yes' : 'No'}</dd>
        <dt>Street</dt>
        <dd>${track.street || 'Street not read'}</dd>
        <dt>Seen</dt>
        <dd class="tnum">${seenStr}</dd>
        <dt>Score</dt>
        <dd class="tnum">${track.score ? track.score.toFixed(2) : '—'}</dd>
        <dt>Notice</dt>
        <dd class="desc">Position estimated from one camera (c1)</dd>
        <dt>Action</dt>
        <dd><a href="${sheetLink}" class="btn-show-sheet">Show on sheet →</a></dd>
      </dl>
    `;
  }

  writeTimeHash(state.currentTime);
}

// -------------------------------------------------------------
// PLAYBACK & ANIMATION LOOP
// -------------------------------------------------------------
function togglePlay(state) {
  state.isPlaying = !state.isPlaying;
  const btn = document.getElementById('drive-play-pause');
  if (btn) btn.textContent = state.isPlaying ? 'Pause' : 'Play';

  if (!state.isPlaying) {
    writeTimeHash(state.currentTime);
  }
}

function seekTo(state, targetT, updateHash) {
  state.currentTime = Math.max(0, Math.min(state.totalDuration, targetT));
  updateSceneAt(state, state.currentTime);
  if (updateHash) {
    writeTimeHash(state.currentTime);
  }
}

function writeTimeHash(t) {
  const newHash = `#/drive?t=${t.toFixed(1)}`;
  if (window.location.hash !== newHash) {
    history.replaceState(null, '', newHash);
  }
}

function startAnimationLoop(state) {
  state.renderer.setAnimationLoop((time) => {
    const delta = (time - state.lastFrameTime) / 1000;
    state.lastFrameTime = time;

    // Track FPS
    state.fpsFrames++;
    if (time - state.fpsLastTime >= 1000) {
      state.fps = (state.fpsFrames * 1000) / (time - state.fpsLastTime);
      state.fpsFrames = 0;
      state.fpsLastTime = time;
    }

    if (state.isPlaying) {
      state.currentTime += delta * state.playbackSpeed;
      if (state.currentTime >= state.totalDuration) {
        state.currentTime = state.totalDuration;
        state.isPlaying = false;
        const btn = document.getElementById('drive-play-pause');
        if (btn) btn.textContent = 'Play';
        writeTimeHash(state.currentTime);
      }
      updateSceneAt(state, state.currentTime);
    } else {
      state.controls.update();
    }

    state.renderer.render(state.scene, state.camera);
  });
}

export function pauseDrive3D() {
  if (appState && appState.renderer) {
    appState.isPlaying = false;
    const btn = document.getElementById('drive-play-pause');
    if (btn) btn.textContent = 'Play';
    appState.renderer.setAnimationLoop(null);
  }
}

export function resumeDrive3D(targetT = null) {
  if (appState) {
    if (targetT != null) {
      seekTo(appState, targetT, false);
    }
    appState.lastFrameTime = performance.now();
    startAnimationLoop(appState);
    if (appState.canvasWrap) {
      const w = appState.canvasWrap.clientWidth;
      const h = appState.canvasWrap.clientHeight;
      appState.camera.aspect = w / h;
      appState.camera.updateProjectionMatrix();
      appState.renderer.setSize(w, h);
    }
  }
}

export function setCameraMode(mode) {
  if (!appState) return;
  const followBtn = document.getElementById('btn-cam-follow');
  const overviewBtn = document.getElementById('btn-cam-overview');

  if (mode === 'overview') {
    appState.cameraMode = 'overview';
    if (overviewBtn) overviewBtn.classList.add('is-active');
    if (followBtn) followBtn.classList.remove('is-active');
    appState.scene.fog.near = 1500;
    appState.scene.fog.far = 12000;
    appState.camera.far = 10000;
    appState.camera.updateProjectionMatrix();
    appState.controls.target.set(430, 0, -160);
    appState.camera.position.set(430, 3200, 1600);
    appState.controls.update();
  } else {
    appState.cameraMode = 'follow';
    appState.followInitialized = false;
    if (followBtn) followBtn.classList.add('is-active');
    if (overviewBtn) overviewBtn.classList.remove('is-active');
    appState.scene.fog.near = 160;
    appState.scene.fog.far = 650;
    updateSceneAt(appState, appState.currentTime);
  }
}

export function selectTrackById(id) {
  if (!appState) return;
  const tr = appState.drive.tracks.find(t => t.id === id);
  if (tr) {
    selectTrack(appState, tr);
  }
}

window.__drive3d = {
  setCameraMode,
  selectTrackById,
  getAppState: () => appState
};
