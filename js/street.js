/**
 * Civimatica Milan Pilot · 3D Clay Model Street Perception View
 * 
 * Centrepiece matte warm clay 3D model of Milan streets (OpenStreetMap + Jetson detections).
 * 
 * EXPORTS FOR CAMERAS VIEW & RIG INSPECTOR (cameras.js):
 * 1. export function renderCameraView(renderer, camId, t, width, height)
 *    Renders the clay street scene from the specified camera rig pose (c0..c3) at time t.
 * 2. export function getEgoPose(t)
 *    Returns { x, y, h, speed, street } for the survey vehicle at time t.
 * 3. export function getScene()
 *    Returns the THREE.Scene instance.
 * 4. export class StreetSection
 *    Main section controller class.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { state } from './state.js';
import { getSignFamily, formatTime } from './data.js';

// Module-level references for stable export functions
let globalScene = null;
let globalEgoMesh = null;
let globalStreetInstance = null;
let cachedCam = null;
if (typeof window !== 'undefined') {
  window.state = state;
}
export function getScene() {
  return globalScene;
}

export function getEgoPose(t) {
  return state.getEgoAt(t !== undefined ? t : state.t);
}

/**
 * Render clay street scene from a specific rig camera perspective
 * Used by cameras.js to generate synchronized simulated views
 */
export function renderCameraView(renderer, camId, t, width, height) {
  if (!globalScene || !globalStreetInstance) return;
  const drive = state.drive;
  const rig = state.rig;

  const ego = getEgoPose(t !== undefined ? t : state.t);

  // Default camera specifications from rig.json / contract
  const rigSpecs = {
    c0: { yaw_deg: 0, hfov_deg: 110.7 },
    c1: { yaw_deg: 0, hfov_deg: 95.9 },
    c2: { yaw_deg: -70, hfov_deg: 68.6 },
    c3: { yaw_deg: 70, hfov_deg: 64.8 }
  };

  const camSpec = (drive && drive.cameras ? drive.cameras.find(c => c.id === camId) : null) || rigSpecs[camId] || rigSpecs.c1;
  const yawDeg = camSpec.yaw_deg || 0;
  const hfovDeg = camSpec.hfov_deg || 80;

  const w = width || 480;
  const h = height || 270;
  const aspect = w / h;

  // Convert HFOV to VFOV for Three.js PerspectiveCamera
  const hfovRad = (hfovDeg * Math.PI) / 180;
  const vfovDeg = (2 * Math.atan(Math.tan(hfovRad / 2) / aspect) * 180) / Math.PI;

  if (!cachedCam) {
    cachedCam = new THREE.PerspectiveCamera(vfovDeg, aspect, 0.2, 500);
  } else {
    cachedCam.fov = vfovDeg;
    cachedCam.aspect = aspect;
    cachedCam.updateProjectionMatrix();
  }

  // Camera sits on ego roof rig (elevation ~1.62m)
  const yawRad = (yawDeg * Math.PI) / 180;
  const heading = ego.h + yawRad;

  cachedCam.position.set(ego.x, 1.62, -ego.y);
  cachedCam.lookAt(
    ego.x + Math.cos(heading) * 25.0,
    1.5,
    -ego.y - Math.sin(heading) * 25.0
  );

  // Temporarily hide ego car mesh so it does not occlude the camera viewport
  const egoWasVisible = globalEgoMesh ? globalEgoMesh.visible : false;
  if (globalEgoMesh) globalEgoMesh.visible = false;

  renderer.render(globalScene, cachedCam);

  if (globalEgoMesh) globalEgoMesh.visible = egoWasVisible;
}

export class StreetSection {
  constructor(container) {
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    // Layer groups for clean toggle management
    this.groups = {
      buildings: new THREE.Group(),
      roads: new THREE.Group(),
      sidewalks: new THREE.Group(),
      rails: new THREE.Group(),
      areas: new THREE.Group(),
      foliage: new THREE.Group(),
      props: new THREE.Group(),
      parked: new THREE.Group(),
      moving: new THREE.Group(),
      signs: new THREE.Group()
    };
    this.fovGroup = new THREE.Group();

    this.egoMesh = null;
    this.dirLight = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Damped follow cam state
    this.followCamPos = new THREE.Vector3();
    this.followLookTarget = new THREE.Vector3();
    this.lastEgoSnap = { x: 0, y: 0, init: false };

    // Selection pulse indicator
    this.selectionRing = null;

    // FPS counter
    this.fpsCounter = { frames: 0, lastTime: performance.now(), fps: 60 };
    this.animId = null;

    // Static tracks spatial index (for distance culling and active updates)
    this.staticTracks = []; // { trk, mesh, isSign, isParked }
    this.staticSpatialGrid = new Map(); // key "gx_gy" -> [indices]
    this.cellSize = 80; // 80m spatial grid cells

    // Moving vehicle pool
    this.movingTracks = []; // sorted by t0
    this.movingPool = [];
    this.activeMovingCount = 0;

    // Map track ID -> track object for instant selection jump
    this.trackMap = new Map();

    globalStreetInstance = this;

    state.on('dataLoaded', () => this.buildScene());
    state.on('presetChange', (p) => this.applyCameraPreset(p));
    state.on('layerChange', ({ key, val }) => this.applyLayerToggle(key, val));
    state.on('selectionChange', (obj) => this.highlightObject(obj));
  }

  init() {
    this.container.innerHTML = `
      <div class="street-container" id="street-container">
        <div class="street-canvas-wrap" id="street-canvas-wrap"></div>
        
        <div class="street-hud">
          <div class="street-hud-panel">
            <button class="street-hud-btn active" id="btn-cam-follow">Follow Cam</button>
            <button class="street-hud-btn" id="btn-cam-orbit">Free Orbit</button>
            <button class="street-hud-btn" id="btn-cam-top">Top Down</button>
          </div>
          <div class="street-hud-panel">
            <span style="font-size: 0.72rem; color: var(--text-muted)">FPS:</span>
            <span class="street-fps-badge" id="street-fps-display">60</span>
          </div>
        </div>

        <div class="street-layer-panel">
          <span style="color: var(--text-muted); font-size: 0.72rem; margin-right: 4px;">Layers:</span>
          <button class="street-layer-btn active" data-layer="buildings">Buildings</button>
          <button class="street-layer-btn active" data-layer="roads">Roads</button>
          <button class="street-layer-btn active" data-layer="sidewalks">Sidewalks</button>
          <button class="street-layer-btn active" data-layer="foliage">Foliage</button>
          <button class="street-layer-btn active" data-layer="parked">Parked</button>
          <button class="street-layer-btn active" data-layer="moving">Moving</button>
          <button class="street-layer-btn active" data-layer="signs">Signs</button>
          <button class="street-layer-btn active" data-layer="fov">Camera FOVs</button>
        </div>

        <div class="street-inspector" id="street-inspector">
          <div class="street-inspector-header">
            <span class="street-inspector-title" id="street-insp-title">Class Name</span>
            <button class="street-inspector-close" id="street-insp-close" title="Close">×</button>
          </div>
          <div style="margin-bottom: 0.6rem;">
            <span class="street-inspector-badge" id="street-insp-badge">Family</span>
          </div>
          <table class="street-inspector-table">
            <tr><td>Track ID</td><td id="street-insp-id">s0:v1</td></tr>
            <tr><td>State</td><td id="street-insp-state">Parked</td></tr>
            <tr><td>Street</td><td id="street-insp-street">Via Melchiorre Gioia</td></tr>
            <tr><td>Detection Window</td><td id="street-insp-window">00:12 – 00:24</td></tr>
            <tr><td>Confidence</td><td id="street-insp-score">92.4%</td></tr>
            <tr id="street-insp-row-merged" style="display: none;"><td>Merged Tracks</td><td id="street-insp-merged">3</td></tr>
          </table>
          <div class="street-inspector-note">Position estimated from monocular camera · Civimatica Pilot</div>
        </div>
      </div>
    `;

    const wrap = document.getElementById('street-canvas-wrap');
    const width = wrap.clientWidth || window.innerWidth;
    const height = wrap.clientHeight || (window.innerHeight - 150);

    // Three.js Scene Setup
    this.scene = new THREE.Scene();
    globalScene = this.scene;

    // Warm clay mist background & subtle depth fog
    const clayBg = new THREE.Color(0xE8E5DE);
    this.scene.background = clayBg;
    this.scene.fog = new THREE.Fog(0xE8E5DE, 65, 340);

    // Main Camera
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.4, 600);
    this.camera.position.set(0, 25, 35);

    // Renderer (capped at 1.5 DPR for smooth performance on laptop iGPUs)
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    wrap.appendChild(this.renderer.domElement);

    // Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 250;

    // Add layer groups to scene
    for (const grp of Object.values(this.groups)) {
      this.scene.add(grp);
    }

    // Ground plane in warm clay
    const groundGeo = new THREE.PlaneGeometry(16000, 16000);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0xE8E5DE, depthWrite: true });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.position.y = 0;
    groundMesh.receiveShadow = true;
    this.scene.add(groundMesh);

    // Selection highlight ring
    const ringGeo = new THREE.RingGeometry(1.6, 1.9, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00E5FF,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthTest: false
    });
    this.selectionRing = new THREE.Mesh(ringGeo, ringMat);
    this.selectionRing.position.y = 0.2;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    this.setupLighting();
    this.bindEvents();
    this.startLoop();
  }

  setupLighting() {
    // Hemisphere light for soft, uniform ambient clay bounce
    const hemiLight = new THREE.HemisphereLight(0xFFFFFF, 0x939088, 0.75);
    hemiLight.position.set(0, 120, 0);
    this.scene.add(hemiLight);

    const ambLight = new THREE.AmbientLight(0xFFFFFF, 0.3);
    this.scene.add(ambLight);

    // Key Directional Light with soft PCF shadow coverage
    this.dirLight = new THREE.DirectionalLight(0xFFF9ED, 1.15);
    this.dirLight.position.set(70, 120, 50);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 320;
    // Follow ego box: ~130m shadow coverage
    this.dirLight.shadow.camera.left = -65;
    this.dirLight.shadow.camera.right = 65;
    this.dirLight.shadow.camera.top = 65;
    this.dirLight.shadow.camera.bottom = -65;
    this.dirLight.shadow.bias = -0.0004;
    this.dirLight.shadow.normalBias = 0.02;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      const wrap = document.getElementById('street-canvas-wrap');
      if (!wrap || !this.renderer) return;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });

    // Preset buttons
    document.getElementById('btn-cam-follow')?.addEventListener('click', () => state.setCameraPreset('follow'));
    document.getElementById('btn-cam-orbit')?.addEventListener('click', () => state.setCameraPreset('orbit'));
    document.getElementById('btn-cam-top')?.addEventListener('click', () => state.setCameraPreset('top'));

    // Layer toggles
    document.querySelectorAll('.street-layer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const layer = btn.getAttribute('data-layer');
        state.toggleLayer(layer);
        btn.classList.toggle('active', state.layers[layer] !== false);
      });
    });

    // Inspector close button
    document.getElementById('street-insp-close')?.addEventListener('click', () => {
      state.selectObject(null);
    });

    // Canvas click to select detected objects
    this.renderer.domElement.addEventListener('click', (e) => this.onCanvasClick(e));
  }

  buildScene() {
    const sceneData = state.scene;
    const driveData = state.drive;
    const rigData = state.rig;
    if (!sceneData) return;

    // Clear old group meshes
    for (const grp of Object.values(this.groups)) {
      while (grp.children.length > 0) {
        const obj = grp.children[0];
        grp.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
      }
    }
    while (this.fovGroup.children.length > 0) {
      const obj = this.fovGroup.children[0];
      this.fovGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
    }

    this.staticTracks = [];
    this.staticSpatialGrid.clear();
    this.movingTracks = [];
    this.movingPool = [];
    this.trackMap.clear();

    // 1. Buildings (Extruded footprints merged into unified clay mesh)
    this.buildBuildings(sceneData.buildings || []);

    // 2. Roads, Raised Sidewalks with 3D Kerbs, and Subtle Lane Markings
    this.buildRoadsAndSidewalks(sceneData.roads || []);

    // 3. Zebra Crossings (Oriented to nearest road segment)
    this.buildCrossings(sceneData.nodes || [], sceneData.roads || []);

    // 4. Rails (Tram and railway lines)
    this.buildRails(sceneData.rails || []);

    // 5. Landcover Areas (Parks/grass sage, water pale blue-grey, squares paving)
    this.buildAreas(sceneData.areas || []);

    // 6. Instanced Trees (Rounded sage canopies + trunks)
    this.buildTrees(sceneData.trees || []);

    // 7. Small Props (Traffic signals, street lamps, shelters, benches, bollards, parking meters)
    this.buildProps(sceneData.nodes || []);

    // 8. Ego Vehicle + Roof Rig Pods + Subtle Camera FOV Wedges
    const cams = (rigData && rigData.cameras) ? rigData.cameras : (driveData ? driveData.cameras : []);
    this.buildEgoVehicle(cams);

    // 9. Detected Tracks (Parked vehicles, moving vehicles, signs)
    if (driveData && driveData.tracks) {
      this.buildTrackObjects(driveData.tracks);
    }
  }

  buildBuildings(buildings) {
    if (buildings.length === 0) return;
    const geos = [];
    const mat = new THREE.MeshLambertMaterial({
      color: 0xDCD7CE, // Warm off-white clay
      reflectivity: 0.08
    });

    for (const b of buildings) {
      const pts = b.pts;
      if (!pts || pts.length < 3) continue;

      const shape = new THREE.Shape();
      shape.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        shape.lineTo(pts[i][0], pts[i][1]);
      }
      shape.closePath();

      if (b.holes && b.holes.length > 0) {
        for (const h of b.holes) {
          if (h.length < 3) continue;
          const holePath = new THREE.Path();
          holePath.moveTo(h[0][0], h[0][1]);
          for (let j = 1; j < h.length; j++) holePath.lineTo(h[j][0], h[j][1]);
          holePath.closePath();
          shape.holes.push(holePath);
        }
      }

      const height = b.h || 15.0;
      const minH = b.min_h || 0.0;
      const extrudeDepth = Math.max(2.0, height - minH);

      try {
        const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
          depth: extrudeDepth,
          bevelEnabled: false
        });
        extrudeGeo.rotateX(-Math.PI / 2);
        if (minH > 0) extrudeGeo.translate(0, minH, 0);
        geos.push(extrudeGeo);
      } catch (err) {
        // Skip invalid/degenerate building footprints
      }
    }

    if (geos.length > 0) {
      const mergedGeo = BufferGeometryUtils.mergeGeometries(geos, false);
      mergedGeo.computeVertexNormals();
      const mesh = new THREE.Mesh(mergedGeo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.groups.buildings.add(mesh);
    }
  }

  buildRoadsAndSidewalks(roads) {
    if (roads.length === 0) return;

    const roadMat = new THREE.MeshLambertMaterial({ color: 0x484540 }); // Slightly darker warm clay road (no harsh black)
    const curbMat = new THREE.MeshLambertMaterial({ color: 0xB6B2A8 }); // Kerb stone face
    const sidewalkMat = new THREE.MeshLambertMaterial({ color: 0xC6C2B8 }); // Lighter warm clay sidewalk
    const markingMat = new THREE.MeshBasicMaterial({ color: 0xE8E5DE }); // Subtle light lane marking

    const roadPositions = [];
    const curbPositions = [];
    const sidewalkPositions = [];
    const markingPositions = [];

    for (const r of roads) {
      const pts = r.pts;
      if (!pts || pts.length < 2) continue;

      let w = r.width;
      if (!w) {
        if (r.kind === 'primary') w = 14.0;
        else if (r.kind === 'secondary') w = 11.0;
        else if (r.kind === 'tertiary') w = 9.0;
        else if (r.kind === 'residential') w = 7.0;
        else if (r.kind === 'pedestrian' || r.kind === 'living_street') w = 6.0;
        else w = 8.0;
      }
      const halfW = w / 2;
      const swW = 2.0;

      // Determine sidewalk sides
      let hasLeftSw = false, hasRightSw = false;
      if (r.sidewalk === 'both') {
        hasLeftSw = true; hasRightSw = true;
      } else if (r.sidewalk === 'left') {
        hasLeftSw = true;
      } else if (r.sidewalk === 'right') {
        hasRightSw = true;
      } else if (r.sidewalk === 'no' || r.sidewalk === 'none') {
        hasLeftSw = false; hasRightSw = false;
      } else {
        // Default both sides for urban road kinds
        const urbanKinds = ['primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified'];
        if (urbanKinds.includes(r.kind)) {
          hasLeftSw = true; hasRightSw = true;
        }
      }

      // Compute ribbon vertices along the road
      const nPts = pts.length;
      const lPts = new Float32Array(nPts * 3);
      const rPts = new Float32Array(nPts * 3);
      const cl1Pts = new Float32Array(nPts * 3);
      const cl2Pts = new Float32Array(nPts * 3);
      const lSwPts = new Float32Array(nPts * 3);
      const rSwPts = new Float32Array(nPts * 3);

      for (let i = 0; i < nPts; i++) {
        const p = pts[i];
        let tx = 0, ty = 0;
        if (i < nPts - 1) {
          tx += pts[i + 1][0] - p[0];
          ty += pts[i + 1][1] - p[1];
        }
        if (i > 0) {
          tx += p[0] - pts[i - 1][0];
          ty += p[1] - pts[i - 1][1];
        }
        const len = Math.hypot(tx, ty) || 1;
        const nx = -ty / len;
        const ny = tx / len;

        const idx = i * 3;
        // In 3D: X = x, Z = -y
        lPts[idx] = p[0] + nx * halfW;
        lPts[idx + 1] = 0.02;
        lPts[idx + 2] = -(p[1] + ny * halfW);

        rPts[idx] = p[0] - nx * halfW;
        rPts[idx + 1] = 0.02;
        rPts[idx + 2] = -(p[1] - ny * halfW);

        cl1Pts[idx] = p[0] + nx * 0.12;
        cl1Pts[idx + 1] = 0.035;
        cl1Pts[idx + 2] = -(p[1] + ny * 0.12);

        cl2Pts[idx] = p[0] - nx * 0.12;
        cl2Pts[idx + 1] = 0.035;
        cl2Pts[idx + 2] = -(p[1] - ny * 0.12);

        lSwPts[idx] = p[0] + nx * (halfW + swW);
        lSwPts[idx + 1] = 0.16;
        lSwPts[idx + 2] = -(p[1] + ny * (halfW + swW));

        rSwPts[idx] = p[0] - nx * (halfW + swW);
        rSwPts[idx + 1] = 0.16;
        rSwPts[idx + 2] = -(p[1] - ny * (halfW + swW));
      }

      // Triangulate road and sidewalks
      for (let i = 0; i < nPts - 1; i++) {
        const i0 = i * 3, i1 = (i + 1) * 3;

        // 1. Road surface
        roadPositions.push(
          lPts[i0], lPts[i0+1], lPts[i0+2],
          rPts[i0], rPts[i0+1], rPts[i0+2],
          lPts[i1], lPts[i1+1], lPts[i1+2],

          rPts[i0], rPts[i0+1], rPts[i0+2],
          rPts[i1], rPts[i1+1], rPts[i1+2],
          lPts[i1], lPts[i1+1], lPts[i1+2]
        );

        // 2. Centre lane line
        markingPositions.push(
          cl1Pts[i0], cl1Pts[i0+1], cl1Pts[i0+2],
          cl2Pts[i0], cl2Pts[i0+1], cl2Pts[i0+2],
          cl1Pts[i1], cl1Pts[i1+1], cl1Pts[i1+2],

          cl2Pts[i0], cl2Pts[i0+1], cl2Pts[i0+2],
          cl2Pts[i1], cl2Pts[i1+1], cl2Pts[i1+2],
          cl1Pts[i1], cl1Pts[i1+1], cl1Pts[i1+2]
        );

        // 3. Left raised sidewalk + kerb face
        if (hasLeftSw) {
          // Kerb vertical face (y=0.02 to y=0.16)
          curbPositions.push(
            lPts[i0], 0.02, lPts[i0+2],
            lPts[i0], 0.16, lPts[i0+2],
            lPts[i1], 0.02, lPts[i1+2],

            lPts[i0], 0.16, lPts[i0+2],
            lPts[i1], 0.16, lPts[i1+2],
            lPts[i1], 0.02, lPts[i1+2]
          );

          // Sidewalk top surface
          sidewalkPositions.push(
            lSwPts[i0], 0.16, lSwPts[i0+2],
            lPts[i0], 0.16, lPts[i0+2],
            lSwPts[i1], 0.16, lSwPts[i1+2],

            lPts[i0], 0.16, lPts[i0+2],
            lPts[i1], 0.16, lPts[i1+2],
            lSwPts[i1], 0.16, lSwPts[i1+2]
          );
        }

        // 4. Right raised sidewalk + kerb face
        if (hasRightSw) {
          // Kerb vertical face
          curbPositions.push(
            rPts[i0], 0.16, rPts[i0+2],
            rPts[i0], 0.02, rPts[i0+2],
            rPts[i1], 0.16, rPts[i1+2],

            rPts[i0], 0.02, rPts[i0+2],
            rPts[i1], 0.02, rPts[i1+2],
            rPts[i1], 0.16, rPts[i1+2]
          );

          // Sidewalk top surface
          sidewalkPositions.push(
            rPts[i0], 0.16, rPts[i0+2],
            rSwPts[i0], 0.16, rSwPts[i0+2],
            rPts[i1], 0.16, rPts[i1+2],

            rSwPts[i0], 0.16, rSwPts[i0+2],
            rSwPts[i1], 0.16, rSwPts[i1+2],
            rPts[i1], 0.16, rPts[i1+2]
          );
        }
      }
    }

    if (roadPositions.length > 0) {
      const roadGeo = new THREE.BufferGeometry();
      roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
      roadGeo.computeVertexNormals();
      const roadMesh = new THREE.Mesh(roadGeo, roadMat);
      roadMesh.receiveShadow = true;
      this.groups.roads.add(roadMesh);
    }

    if (markingPositions.length > 0) {
      const markGeo = new THREE.BufferGeometry();
      markGeo.setAttribute('position', new THREE.Float32BufferAttribute(markingPositions, 3));
      markGeo.computeVertexNormals();
      const markMesh = new THREE.Mesh(markGeo, markingMat);
      this.groups.roads.add(markMesh);
    }

    if (curbPositions.length > 0) {
      const curbGeo = new THREE.BufferGeometry();
      curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(curbPositions, 3));
      curbGeo.computeVertexNormals();
      const curbMesh = new THREE.Mesh(curbGeo, curbMat);
      this.groups.sidewalks.add(curbMesh);
    }

    if (sidewalkPositions.length > 0) {
      const swGeo = new THREE.BufferGeometry();
      swGeo.setAttribute('position', new THREE.Float32BufferAttribute(sidewalkPositions, 3));
      swGeo.computeVertexNormals();
      const swMesh = new THREE.Mesh(swGeo, sidewalkMat);
      swMesh.receiveShadow = true;
      this.groups.sidewalks.add(swMesh);
    }
  }

  buildCrossings(nodes, roads) {
    const crossings = nodes.filter(n => n.kind === 'crossing');
    if (crossings.length === 0) return;

    // Build spatial grid for fast road segment orientation
    const grid = new Map();
    const cSize = 40.0;
    for (const r of roads) {
      const pts = r.pts;
      if (!pts || pts.length < 2) continue;
      for (let i = 0; i < pts.length - 1; i++) {
        const seg = [pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]];
        const minGx = Math.floor(Math.min(seg[0], seg[2]) / cSize);
        const maxGx = Math.floor(Math.max(seg[0], seg[2]) / cSize);
        const minGy = Math.floor(Math.min(seg[1], seg[3]) / cSize);
        const maxGy = Math.floor(Math.max(seg[1], seg[3]) / cSize);
        for (let gx = minGx; gx <= maxGx; gx++) {
          for (let gy = minGy; gy <= maxGy; gy++) {
            const key = `${gx}_${gy}`;
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(seg);
          }
        }
      }
    }

    const distPtSegSq = (px, py, x1, y1, x2, y2) => {
      const dx = x2 - x1, dy = y2 - y1;
      const l2 = dx * dx + dy * dy;
      if (l2 === 0) return (px - x1) * (px - x1) + (py - y1) * (py - y1);
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
      const projX = x1 + t * dx, projY = y1 + t * dy;
      return (px - projX) * (px - projX) + (py - projY) * (py - projY);
    };

    const stripePositions = [];
    const stripeLen = 3.6; // Length along road
    const stripeW = 0.45;  // Width of white stripe
    const stripeSpacing = 0.82;

    for (const c of crossings) {
      const cx = c.x, cy = c.y;
      const cgx = Math.floor(cx / cSize);
      const cgy = Math.floor(cy / cSize);

      let bestSeg = null, bestDist = 1e9;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const segs = grid.get(`${cgx + dx}_${cgy + dy}`);
          if (!segs) continue;
          for (const s of segs) {
            const d = distPtSegSq(cx, cy, s[0], s[1], s[2], s[3]);
            if (d < bestDist) {
              bestDist = d;
              bestSeg = s;
            }
          }
        }
      }

      let rotY = 0;
      if (bestSeg) {
        const rdx = bestSeg[2] - bestSeg[0];
        const rdy = bestSeg[3] - bestSeg[1];
        // In 3D horizontal XZ plane (+X east, -Z north):
        rotY = Math.atan2(rdx, -rdy);
      }

      const cosR = Math.cos(rotY);
      const sinR = Math.sin(rotY);
      const halfL = stripeLen / 2;
      const halfSw = stripeW / 2;

      for (let s = -2; s <= 2; s++) {
        const offsetAcross = s * stripeSpacing;
        const xOffsets = [-halfSw, halfSw, halfSw, -halfSw];
        const zOffsets = [-halfL, -halfL, halfL, halfL];

        const p3d = [];
        for (let v = 0; v < 4; v++) {
          const lx = xOffsets[v] + offsetAcross;
          const lz = zOffsets[v];
          const wx = cx + (lx * cosR + lz * sinR);
          const wz = -cy + (-lx * sinR + lz * cosR);
          p3d.push([wx, 0.05, wz]);
        }

        stripePositions.push(
          p3d[0][0], p3d[0][1], p3d[0][2],
          p3d[1][0], p3d[1][1], p3d[1][2],
          p3d[2][0], p3d[2][1], p3d[2][2],

          p3d[0][0], p3d[0][1], p3d[0][2],
          p3d[2][0], p3d[2][1], p3d[2][2],
          p3d[3][0], p3d[3][1], p3d[3][2]
        );
      }
    }

    if (stripePositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(stripePositions, 3));
      geo.computeVertexNormals();
      const mat = new THREE.MeshBasicMaterial({ color: 0xF7F6F2 });
      const mesh = new THREE.Mesh(geo, mat);
      this.groups.roads.add(mesh);
    }
  }

  buildRails(rails) {
    if (rails.length === 0) return;
    const railMat = new THREE.MeshLambertMaterial({ color: 0x4E525C });
    const positions = [];
    const gaugeHalf = 0.718; // Milan tram standard gauge / 2

    for (const r of rails) {
      const pts = r.pts;
      if (!pts || pts.length < 2) continue;

      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i], p2 = pts[i + 1];
        const tx = p2[0] - p1[0], ty = p2[1] - p1[1];
        const len = Math.hypot(tx, ty) || 1;
        const nx = -ty / len, ny = tx / len;

        for (const sign of [-1, 1]) {
          const offset = sign * gaugeHalf;
          const lx1 = p1[0] + nx * offset, lz1 = -(p1[1] + ny * offset);
          const lx2 = p2[0] + nx * offset, lz2 = -(p2[1] + ny * offset);
          const rw = 0.04;
          const rnx = nx * rw, rny = ny * rw;

          positions.push(
            lx1 + rnx, 0.035, lz1 - rny,
            lx1 - rnx, 0.035, lz1 + rny,
            lx2 + rnx, 0.035, lz2 - rny,

            lx1 - rnx, 0.035, lz1 + rny,
            lx2 - rnx, 0.035, lz2 + rny,
            lx2 + rnx, 0.035, lz2 - rny
          );
        }
      }
    }

    if (positions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, railMat);
      this.groups.rails.add(mesh);
    }
  }

  buildAreas(areas) {
    if (areas.length === 0) return;

    const parkGeos = [];
    const waterGeos = [];
    const squareGeos = [];

    for (const a of areas) {
      const pts = a.pts;
      if (!pts || pts.length < 3) continue;

      const shape = new THREE.Shape();
      shape.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
      shape.closePath();

      try {
        const geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(-Math.PI / 2);
        const k = a.kind || '';

        if (k === 'water') {
          geo.translate(0, 0.008, 0);
          waterGeos.push(geo);
        } else if (k === 'pedestrian' || k === 'square' || k === 'parking') {
          geo.translate(0, 0.015, 0);
          squareGeos.push(geo);
        } else {
          // Park, grass, garden, playground, wood
          geo.translate(0, 0.012, 0);
          parkGeos.push(geo);
        }
      } catch (e) {
        // Skip degenerate shapes
      }
    }

    if (parkGeos.length > 0) {
      const mergedPark = BufferGeometryUtils.mergeGeometries(parkGeos, false);
      const mesh = new THREE.Mesh(mergedPark, new THREE.MeshLambertMaterial({ color: 0x8DA882 })); // Sage grass
      mesh.receiveShadow = true;
      this.groups.areas.add(mesh);
    }

    if (waterGeos.length > 0) {
      const mergedWater = BufferGeometryUtils.mergeGeometries(waterGeos, false);
      const mesh = new THREE.Mesh(mergedWater, new THREE.MeshLambertMaterial({ color: 0x6D8E9C })); // Pale blue-grey water
      this.groups.areas.add(mesh);
    }

    if (squareGeos.length > 0) {
      const mergedSquare = BufferGeometryUtils.mergeGeometries(squareGeos, false);
      const mesh = new THREE.Mesh(mergedSquare, new THREE.MeshLambertMaterial({ color: 0xD6D2C9 })); // Light paving
      mesh.receiveShadow = true;
      this.groups.areas.add(mesh);
    }
  }

  buildTrees(trees) {
    if (trees.length === 0) return;

    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 2.2, 5);
    trunkGeo.translate(0, 1.1, 0);
    const canopyGeo = new THREE.DodecahedronGeometry(1.5, 1);
    canopyGeo.translate(0, 3.2, 0);

    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x63574A });
    const canopyMat = new THREE.MeshLambertMaterial({ color: 0x5E8058 }); // Rounded sage canopy

    const count = trees.length;
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const canopyMesh = new THREE.InstancedMesh(canopyGeo, canopyMat, count);
    trunkMesh.castShadow = true;
    canopyMesh.castShadow = true;
    canopyMesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const [tx, ty] = trees[i];
      const scale = 0.85 + ((i % 7) * 0.05);
      dummy.position.set(tx, 0, -ty);
      dummy.scale.set(scale, scale, scale);
      dummy.rotation.y = (i * 0.77);
      dummy.updateMatrix();

      trunkMesh.setMatrixAt(i, dummy.matrix);
      canopyMesh.setMatrixAt(i, dummy.matrix);
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    canopyMesh.instanceMatrix.needsUpdate = true;

    this.groups.foliage.add(trunkMesh);
    this.groups.foliage.add(canopyMesh);
  }

  buildProps(nodes) {
    const propGroups = {
      traffic_signals: [],
      street_lamp: [],
      transit_shelter: [],
      bench: [],
      bollard: [],
      parking_meter: []
    };

    for (const n of nodes) {
      const k = n.kind;
      if (k === 'traffic_signals') propGroups.traffic_signals.push(n);
      else if (k === 'street_lamp') propGroups.street_lamp.push(n);
      else if (k === 'bus_stop' || k === 'tram_stop') propGroups.transit_shelter.push(n);
      else if (k === 'bench') propGroups.bench.push(n);
      else if (k === 'bollard') propGroups.bollard.push(n);
      else if (k === 'vending_parking' || k === 'parking_meter') propGroups.parking_meter.push(n);
    }

    const dummy = new THREE.Object3D();

    // 1. Traffic signals
    if (propGroups.traffic_signals.length > 0) {
      const poleGeo = new THREE.CylinderGeometry(0.08, 0.09, 5.2, 6);
      poleGeo.translate(0, 2.6, 0);
      const headGeo = new THREE.BoxGeometry(0.35, 1.1, 0.32);
      headGeo.translate(0, 4.3, 0.22);
      const sigGeo = BufferGeometryUtils.mergeGeometries([poleGeo, headGeo]);
      const sigMat = new THREE.MeshLambertMaterial({ color: 0x30343C });
      const sigMesh = new THREE.InstancedMesh(sigGeo, sigMat, propGroups.traffic_signals.length);
      sigMesh.castShadow = true;

      propGroups.traffic_signals.forEach((n, idx) => {
        dummy.position.set(n.x, 0, -n.y);
        dummy.rotation.set(0, n.dir !== undefined ? n.dir : 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        sigMesh.setMatrixAt(idx, dummy.matrix);
      });
      sigMesh.instanceMatrix.needsUpdate = true;
      this.groups.props.add(sigMesh);
    }

    // 2. Street lamps
    if (propGroups.street_lamp.length > 0) {
      const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 6.2, 6);
      poleGeo.translate(0, 3.1, 0);
      const headGeo = new THREE.BoxGeometry(0.28, 0.12, 0.65);
      headGeo.translate(0, 6.1, 0.28);
      const lampGeo = BufferGeometryUtils.mergeGeometries([poleGeo, headGeo]);
      const lampMat = new THREE.MeshLambertMaterial({ color: 0x464A54 });
      const lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, propGroups.street_lamp.length);
      lampMesh.castShadow = true;

      propGroups.street_lamp.forEach((n, idx) => {
        dummy.position.set(n.x, 0, -n.y);
        dummy.rotation.set(0, (idx * 1.5), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        lampMesh.setMatrixAt(idx, dummy.matrix);
      });
      lampMesh.instanceMatrix.needsUpdate = true;
      this.groups.props.add(lampMesh);
    }

    // 3. Transit shelters
    if (propGroups.transit_shelter.length > 0) {
      const shelterGeo = new THREE.BoxGeometry(3.2, 2.3, 1.4);
      shelterGeo.translate(0, 1.15, 0);
      const shelterMat = new THREE.MeshLambertMaterial({
        color: 0x8C929E,
        transparent: true,
        opacity: 0.65
      });
      const shelterMesh = new THREE.InstancedMesh(shelterGeo, shelterMat, propGroups.transit_shelter.length);

      propGroups.transit_shelter.forEach((n, idx) => {
        dummy.position.set(n.x, 0, -n.y);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        shelterMesh.setMatrixAt(idx, dummy.matrix);
      });
      shelterMesh.instanceMatrix.needsUpdate = true;
      this.groups.props.add(shelterMesh);
    }

    // 4. Benches
    if (propGroups.bench.length > 0) {
      const benchGeo = new THREE.BoxGeometry(1.6, 0.42, 0.55);
      benchGeo.translate(0, 0.21, 0);
      const benchMat = new THREE.MeshLambertMaterial({ color: 0x8C7456 });
      const benchMesh = new THREE.InstancedMesh(benchGeo, benchMat, propGroups.bench.length);

      propGroups.bench.forEach((n, idx) => {
        dummy.position.set(n.x, 0, -n.y);
        dummy.rotation.set(0, idx * 0.9, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        benchMesh.setMatrixAt(idx, dummy.matrix);
      });
      benchMesh.instanceMatrix.needsUpdate = true;
      this.groups.props.add(benchMesh);
    }

    // 5. Bollards
    if (propGroups.bollard.length > 0) {
      const bollardGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.85, 8);
      bollardGeo.translate(0, 0.42, 0);
      const bollardMat = new THREE.MeshLambertMaterial({ color: 0x50545C });
      const bollardMesh = new THREE.InstancedMesh(bollardGeo, bollardMat, propGroups.bollard.length);

      propGroups.bollard.forEach((n, idx) => {
        dummy.position.set(n.x, 0, -n.y);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        bollardMesh.setMatrixAt(idx, dummy.matrix);
      });
      bollardMesh.instanceMatrix.needsUpdate = true;
      this.groups.props.add(bollardMesh);
    }

    // 6. Parking meters
    if (propGroups.parking_meter.length > 0) {
      const meterGeo = new THREE.BoxGeometry(0.35, 1.4, 0.35);
      meterGeo.translate(0, 0.7, 0);
      const meterMat = new THREE.MeshLambertMaterial({ color: 0x48505C });
      const meterMesh = new THREE.InstancedMesh(meterGeo, meterMat, propGroups.parking_meter.length);

      propGroups.parking_meter.forEach((n, idx) => {
        dummy.position.set(n.x, 0, -n.y);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        meterMesh.setMatrixAt(idx, dummy.matrix);
      });
      meterMesh.instanceMatrix.needsUpdate = true;
      this.groups.props.add(meterMesh);
    }
  }

  buildEgoVehicle(cameras) {
    if (this.egoMesh) {
      this.scene.remove(this.egoMesh);
    }

    this.egoMesh = new THREE.Group();
    globalEgoMesh = this.egoMesh;

    // Clay Car Body (Warm off-white matte standard finish)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xF5F4F0,
      roughness: 0.35,
      metalness: 0.08
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x22262E,
      roughness: 0.22,
      metalness: 0.1
    });
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x26282E });
    const rackMat = new THREE.MeshLambertMaterial({ color: 0x1E2026 });

    // Lower chassis (4.4m length x 1.85m width x 0.65m height)
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.65, 4.4), bodyMat);
    chassis.position.y = 0.55;
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    this.egoMesh.add(chassis);

    // Aerodynamic greenhouse / cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.6, 2.3), glassMat);
    cabin.position.set(0, 1.12, -0.2);
    cabin.castShadow = true;
    this.egoMesh.add(cabin);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const [wx, wz] of [[0.94, 1.3], [-0.94, 1.3], [0.94, -1.3], [-0.94, -1.3]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(wx, 0.33, wz);
      this.egoMesh.add(w);
    }

    // Roof equipment rack platform
    const roofRack = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.08, 1.5), rackMat);
    roofRack.position.set(0, 1.46, -0.2);
    this.egoMesh.add(roofRack);

    // Multi-Camera Sensor Pods on Roof
    const podMat = new THREE.MeshLambertMaterial({ color: 0x323640 });
    const lensCyan = new THREE.MeshBasicMaterial({ color: 0x00E5FF });
    const lensAmber = new THREE.MeshBasicMaterial({ color: 0xE8A33D });

    // c0 / c1 front camera pod
    const frontPod = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.22), podMat);
    frontPod.position.set(0, 1.54, 0.45);
    const frontLens = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.02), lensCyan);
    frontLens.position.set(0, 0, 0.11);
    frontPod.add(frontLens);
    this.egoMesh.add(frontPod);

    // c2 right camera pod (angled -70 deg)
    const rightPod = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.2), podMat);
    rightPod.position.set(0.58, 1.52, -0.2);
    rightPod.rotation.y = (-70 * Math.PI) / 180;
    const rightLens = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.02), lensAmber);
    rightLens.position.set(0, 0, 0.1);
    rightPod.add(rightLens);
    this.egoMesh.add(rightPod);

    // c3 left camera pod (angled +70 deg)
    const leftPod = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.2), podMat);
    leftPod.position.set(-0.58, 1.52, -0.2);
    leftPod.rotation.y = (70 * Math.PI) / 180;
    const leftLens = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.02), lensAmber);
    leftLens.position.set(0, 0, 0.1);
    leftPod.add(leftLens);
    this.egoMesh.add(leftPod);

    // Rear / Radar sensor dome
    const radar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 12), podMat);
    radar.position.set(0, 1.54, -0.65);
    this.egoMesh.add(radar);

    // Add FOV wedges group to ego vehicle so wedges track car position and orientation
    this.egoMesh.add(this.fovGroup);
    this.buildFovWedges(cameras);

    this.scene.add(this.egoMesh);
  }

  buildFovWedges(cameras) {
    while (this.fovGroup.children.length > 0) {
      this.fovGroup.remove(this.fovGroup.children[0]);
    }

    // Default rig angles & HFOV from contract / rig.json
    const camSpecs = [
      { id: 'c0', yaw_deg: 0, hfov_deg: 110.7, length: 24, color: 0x3D7BD9, opacity: 0.12 },
      { id: 'c1', yaw_deg: 0, hfov_deg: 95.9, length: 28, color: 0x2BB3A3, opacity: 0.16 },
      { id: 'c2', yaw_deg: -70, hfov_deg: 68.6, length: 20, color: 0xF2C14E, opacity: 0.12 },
      { id: 'c3', yaw_deg: 70, hfov_deg: 64.8, length: 20, color: 0xF2C14E, opacity: 0.12 }
    ];

    if (cameras && cameras.length > 0) {
      for (const cs of camSpecs) {
        const found = cameras.find(c => c.id === cs.id);
        if (found) {
          if (found.yaw_deg !== undefined) cs.yaw_deg = found.yaw_deg;
          if (found.hfov_deg !== undefined) cs.hfov_deg = found.hfov_deg;
        }
      }
    }

    const makeWedge = (hfovDeg, length, colorHex, opacity) => {
      const halfAngle = (hfovDeg * Math.PI) / 360;
      const pts = [new THREE.Vector2(0, 0)];
      const segments = 24;
      for (let i = 0; i <= segments; i++) {
        const theta = -halfAngle + (i / segments) * 2 * halfAngle;
        // In car coordinates: forward is +Z, left is -X
        pts.push(new THREE.Vector2(Math.sin(theta) * length, Math.cos(theta) * length));
      }
      const shape = new THREE.Shape(pts);
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2); // Lay flat on XZ plane

      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      return new THREE.Mesh(geo, mat);
    };

    for (const cs of camSpecs) {
      const wedge = makeWedge(cs.hfov_deg, cs.length, cs.color, cs.opacity);
      wedge.position.set(0, 1.54, 0);
      wedge.rotation.y = (cs.yaw_deg * Math.PI) / 180;
      this.fovGroup.add(wedge);
    }
  }

  buildTrackObjects(tracks) {
    this.staticTracks = [];
    this.staticSpatialGrid.clear();
    this.movingTracks = [];
    this.movingPool = [];
    this.trackMap.clear();

    // Sculpted clay vehicle geometries (two-tier clay cars, trucks with cabs, buses)
    const carChassis = new THREE.BoxGeometry(1.82, 0.65, 4.25);
    carChassis.translate(0, 0.325, 0);
    const carCabin = new THREE.BoxGeometry(1.46, 0.62, 2.2);
    carCabin.translate(0, 0.96, -0.2);
    const carGeo = BufferGeometryUtils.mergeGeometries([carChassis, carCabin]);

    const busBody = new THREE.BoxGeometry(2.5, 3.0, 10.5);
    busBody.translate(0, 1.5, 0);

    const truckCab = new THREE.BoxGeometry(2.4, 2.8, 2.2);
    truckCab.translate(0, 1.4, 2.2);
    const truckBox = new THREE.BoxGeometry(2.45, 2.5, 4.8);
    truckBox.translate(0, 1.35, -1.3);
    const truckGeo = BufferGeometryUtils.mergeGeometries([truckCab, truckBox]);

    const motoBody = new THREE.BoxGeometry(0.7, 0.9, 1.9);
    motoBody.translate(0, 0.45, 0);

    const bikeBody = new THREE.BoxGeometry(0.45, 0.85, 1.5);
    bikeBody.translate(0, 0.425, 0);

    const vehGeos = {
      car: carGeo,
      bus: busBody,
      truck: truckGeo,
      motorcycle: motoBody,
      bicycle: bikeBody
    };

    // Shared sign pole geometry
    const signPoleGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.4, 8);
    signPoleGeo.translate(0, 1.2, 0);
    const signPoleMat = new THREE.MeshLambertMaterial({ color: 0x555860 });

    // Factory to build sign plate mesh according to family
    const createSignMesh = (cls) => {
      const signGrp = new THREE.Group();
      const pole = new THREE.Mesh(signPoleGeo, signPoleMat);
      signGrp.add(pole);

      const fam = getSignFamily(cls);

      let plate;
      if (fam.family === 'prohibitory') {
        // Round red-rim prohibitory sign (red outer disc + cream inner face)
        plate = new THREE.Group();
        const outer = new THREE.Mesh(
          new THREE.CylinderGeometry(0.34, 0.34, 0.03, 20),
          new THREE.MeshLambertMaterial({ color: 0xD9483B })
        );
        outer.rotation.x = Math.PI / 2;
        const inner = new THREE.Mesh(
          new THREE.CylinderGeometry(0.26, 0.26, 0.035, 20),
          new THREE.MeshLambertMaterial({ color: 0xF5F4F0 })
        );
        inner.rotation.x = Math.PI / 2;
        plate.add(outer, inner);
        plate.position.y = 2.25;
      } else if (fam.family === 'mandatory') {
        // Round blue mandatory sign
        plate = new THREE.Mesh(
          new THREE.CylinderGeometry(0.34, 0.34, 0.03, 20),
          new THREE.MeshLambertMaterial({ color: 0x2F6FDE })
        );
        plate.rotation.x = Math.PI / 2;
        plate.position.y = 2.25;
      } else if (fam.family === 'warning') {
        // Triangular warning sign (pointing UP, yellow/white clay)
        const triShape = new THREE.Shape();
        triShape.moveTo(-0.32, -0.22);
        triShape.lineTo(0.32, -0.22);
        triShape.lineTo(0, 0.34);
        triShape.closePath();
        plate = new THREE.Mesh(
          new THREE.ShapeGeometry(triShape),
          new THREE.MeshLambertMaterial({ color: 0xF2C14E, side: THREE.DoubleSide })
        );
        plate.position.y = 2.25;
      } else if (fam.family === 'parking') {
        // Square blue parking / info sign
        plate = new THREE.Mesh(
          new THREE.BoxGeometry(0.58, 0.58, 0.03),
          new THREE.MeshLambertMaterial({ color: 0x3D7BD9 })
        );
        plate.position.y = 2.25;
      } else {
        // Rectangular / square grey other sign
        plate = new THREE.Mesh(
          new THREE.BoxGeometry(0.58, 0.44, 0.03),
          new THREE.MeshLambertMaterial({ color: 0x8A909A })
        );
        plate.position.y = 2.25;
      }

      signGrp.add(plate);
      return signGrp;
    };

    // Separate tracks into static and moving
    for (const trk of tracks) {
      this.trackMap.set(trk.id, trk);

      if (trk.kind === 'sign') {
        if (!trk.fixed) continue;
        const mesh = createSignMesh(trk.cls);
        mesh.userData = trk;
        mesh.position.set(trk.fixed[0], 0, -trk.fixed[1]);
        if (trk.fixed[2] !== undefined) mesh.rotation.y = trk.fixed[2];
        mesh.visible = false;
        this.groups.signs.add(mesh);

        const item = { trk, mesh, isSign: true, isParked: false, state: 'hidden' };
        const idx = this.staticTracks.length;
        this.staticTracks.push(item);

        // Add to spatial grid
        const gx = Math.floor(trk.fixed[0] / this.cellSize);
        const gy = Math.floor(trk.fixed[1] / this.cellSize);
        const key = `${gx}_${gy}`;
        if (!this.staticSpatialGrid.has(key)) this.staticSpatialGrid.set(key, []);
        this.staticSpatialGrid.get(key).push(idx);

      } else if (trk.kind === 'vehicle') {
        const isParked = trk.state === 'parked' || !!trk.fixed;
        const cls = vehGeos[trk.cls] ? trk.cls : 'car';
        const geo = vehGeos[cls];

        if (isParked && trk.fixed) {
          // Amber clay car at fixed position
          const mat = new THREE.MeshStandardMaterial({
            color: 0xE8A33D, // Amber parked vehicle
            roughness: 0.45,
            metalness: 0.05,
            transparent: true,
            opacity: 1.0
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.userData = trk;
          mesh.position.set(trk.fixed[0], 0, -trk.fixed[1]);
          if (trk.fixed[2] !== undefined) mesh.rotation.y = trk.fixed[2] - Math.PI / 2;
          mesh.castShadow = true;
          mesh.visible = false;
          this.groups.parked.add(mesh);

          const item = { trk, mesh, isSign: false, isParked: true, state: 'hidden' };
          const idx = this.staticTracks.length;
          this.staticTracks.push(item);

          const gx = Math.floor(trk.fixed[0] / this.cellSize);
          const gy = Math.floor(trk.fixed[1] / this.cellSize);
          const key = `${gx}_${gy}`;
          if (!this.staticSpatialGrid.has(key)) this.staticSpatialGrid.set(key, []);
          this.staticSpatialGrid.get(key).push(idx);

        } else if (trk.pos && trk.pos.length > 0) {
          // Moving / unknown vehicle
          this.movingTracks.push(trk);
        }
      }
    }

    // Sort moving tracks by start time for fast binary search
    this.movingTracks.sort((a, b) => a.t0 - b.t0);

    // Initialize moving vehicle mesh pool (60 pre-created meshes)
    const poolSize = 60;
    for (let i = 0; i < poolSize; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2BB3A3, // Teal moving vehicle default
        roughness: 0.45,
        metalness: 0.05,
        transparent: true,
        opacity: 1.0
      });
      const mesh = new THREE.Mesh(vehGeos.car, mat);
      mesh.castShadow = true;
      mesh.visible = false;
      this.groups.moving.add(mesh);
      this.movingPool.push({ mesh, currentCls: 'car', mat, active: false });
    }
  }

  update(dt) {
    // Advance playback if playing
    if (state.isPlaying) {
      const newT = state.t + dt * state.playbackSpeed;
      if (newT > state.duration) {
        state.setTime(0);
      } else {
        state.setTime(newT);
      }
    }

    const t = state.t;
    const ego = state.getEgoAt(t);

    // 1. Update Ego vehicle pose
    if (this.egoMesh) {
      this.egoMesh.position.set(ego.x, 0, -ego.y);
      this.egoMesh.rotation.y = ego.h - Math.PI / 2;

      // Directional light shadow camera tracks ego car
      if (this.dirLight) {
        this.dirLight.position.set(ego.x + 70, 120, -ego.y + 50);
        this.dirLight.target.position.set(ego.x, 0, -ego.y);
      }
    }

    // 2. Camera Presets
    if (state.cameraPreset === 'follow' && this.egoMesh) {
      this.controls.enabled = false;
      const camDist = 16.0;
      const camHeight = 7.2;
      const lookDist = 13.0;

      const targetX = ego.x - Math.cos(ego.h) * camDist;
      const targetZ = -ego.y + Math.sin(ego.h) * camDist;
      const lookX = ego.x + Math.cos(ego.h) * lookDist;
      const lookZ = -ego.y - Math.sin(ego.h) * lookDist;

      if (!this.lastEgoSnap.init || Math.hypot(ego.x - this.lastEgoSnap.x, ego.y - this.lastEgoSnap.y) > 35) {
        // Fast snap on initial load or large seek
        this.followCamPos.set(targetX, camHeight, targetZ);
        this.followLookTarget.set(lookX, 1.6, lookZ);
        this.lastEgoSnap.init = true;
      } else {
        // Smooth exponential damping follow
        const factor = 1.0 - Math.exp(-dt * 6.5);
        this.followCamPos.lerp(new THREE.Vector3(targetX, camHeight, targetZ), factor);
        this.followLookTarget.lerp(new THREE.Vector3(lookX, 1.6, lookZ), factor);
      }
      this.lastEgoSnap.x = ego.x;
      this.lastEgoSnap.y = ego.y;

      this.camera.position.copy(this.followCamPos);
      this.camera.lookAt(this.followLookTarget);
      this.controls.target.copy(this.followLookTarget);

    } else if (state.cameraPreset === 'top' && this.egoMesh) {
      this.controls.enabled = false;
      this.camera.position.set(ego.x, 92, -ego.y + 0.1);
      this.camera.lookAt(ego.x, 0, -ego.y);
      this.controls.target.set(ego.x, 0, -ego.y);

    } else if (this.controls) {
      this.controls.enabled = true;
      this.controls.update();
    }

    // 3. Selection highlight ring pulse
    if (this.selectionRing && this.selectionRing.visible) {
      const scale = 1.0 + Math.sin(performance.now() * 0.005) * 0.08;
      this.selectionRing.scale.set(scale, scale, scale);
    }

    // 4. Update Static Tracks (Signs & Parked Cars) using spatial grid near ego
    this.updateStaticTracks(ego.x, ego.y, t);

    // 5. Update Moving Vehicles from pool
    this.updateMovingTracks(t);
  }

  updateStaticTracks(egoX, egoY, t) {
    const egoGx = Math.floor(egoX / this.cellSize);
    const egoGy = Math.floor(egoY / this.cellSize);
    const radiusCells = 2; // ~160m radius search
    const maxDistSq = 175 * 175;

    // Check cells within neighborhood
    const nearbyIndices = new Set();
    for (let gx = egoGx - radiusCells; gx <= egoGx + radiusCells; gx++) {
      for (let gy = egoGy - radiusCells; gy <= egoGy + radiusCells; gy++) {
        const cell = this.staticSpatialGrid.get(`${gx}_${gy}`);
        if (cell) {
          for (let i = 0; i < cell.length; i++) nearbyIndices.add(cell[i]);
        }
      }
    }

    // Update active state of nearby tracks
    nearbyIndices.forEach(idx => {
      const item = this.staticTracks[idx];
      const trk = item.trk;
      const mesh = item.mesh;

      const dx = trk.fixed[0] - egoX;
      const dy = trk.fixed[1] - egoY;
      if (dx * dx + dy * dy > maxDistSq) {
        if (item.state !== 'hidden') {
          item.state = 'hidden';
          mesh.visible = false;
        }
        return;
      }

      // Timing rules: visible from t0 - 2s; active until t1; past fades to 30%; future hidden
      if (t < trk.t0 - 2.0) {
        if (item.state !== 'future') {
          item.state = 'future';
          mesh.visible = false;
        }
      } else if (t <= trk.t1) {
        if (item.state !== 'active') {
          item.state = 'active';
          mesh.visible = true;
          this.setMeshOpacity(mesh, 1.0);
        }
      } else {
        if (item.state !== 'past') {
          item.state = 'past';
          mesh.visible = true;
          this.setMeshOpacity(mesh, 0.32);
        }
      }
    });

    // If an item was previously active or past but is now outside neighborhood, hide it
    if (this.lastNearbyIndices) {
      this.lastNearbyIndices.forEach(idx => {
        if (!nearbyIndices.has(idx)) {
          const item = this.staticTracks[idx];
          if (item && item.state !== 'hidden') {
            item.state = 'hidden';
            item.mesh.visible = false;
          }
        }
      });
    }
    this.lastNearbyIndices = nearbyIndices;
  }

  updateMovingTracks(t) {
    if (this.movingTracks.length === 0) return;

    // Find active moving tracks: t0 - 2s <= t <= t1
    const active = [];
    for (let i = 0; i < this.movingTracks.length; i++) {
      const trk = this.movingTracks[i];
      if (trk.t0 - 2.0 <= t && t <= trk.t1) {
        active.push(trk);
      }
    }

    let poolIdx = 0;
    const poolLen = this.movingPool.length;

    for (let i = 0; i < active.length && poolIdx < poolLen; i++) {
      const trk = active[i];
      const poolItem = this.movingPool[poolIdx++];
      const mesh = poolItem.mesh;

      const pt = this.interpolatePos(trk.pos, t);
      if (!pt) continue;

      mesh.position.set(pt.x, 0, -pt.y);
      mesh.rotation.y = pt.heading - Math.PI / 2;

      // Color: Teal for moving, Slate for unknown
      const isMoving = trk.state === 'moving';
      poolItem.mat.color.setHex(isMoving ? 0x2BB3A3 : 0x8A94A6);

      // Opacity: fade in from t0 - 2s
      let opacity = 1.0;
      if (t < trk.t0) {
        opacity = 0.3 + 0.7 * Math.max(0, (t - (trk.t0 - 2.0)) / 2.0);
      }
      poolItem.mat.opacity = opacity;

      mesh.userData = trk;
      mesh.visible = true;
      poolItem.active = true;
    }

    // Hide remaining unused pool meshes
    for (let i = poolIdx; i < poolLen; i++) {
      const poolItem = this.movingPool[i];
      if (poolItem.active) {
        poolItem.mesh.visible = false;
        poolItem.active = false;
      }
    }
  }

  interpolatePos(posArr, t) {
    if (!posArr || posArr.length === 0) return null;
    if (posArr.length === 1) return { x: posArr[0][1], y: posArr[0][2], heading: 0 };
    if (t <= posArr[0][0]) {
      const dx = posArr[1][1] - posArr[0][1];
      const dy = posArr[1][2] - posArr[0][2];
      return { x: posArr[0][1], y: posArr[0][2], heading: Math.atan2(dy, dx) };
    }
    if (t >= posArr[posArr.length - 1][0]) {
      const last = posArr[posArr.length - 1];
      const prev = posArr[posArr.length - 2];
      return { x: last[1], y: last[2], heading: Math.atan2(last[2] - prev[2], last[1] - prev[1]) };
    }

    for (let i = 0; i < posArr.length - 1; i++) {
      if (t >= posArr[i][0] && t <= posArr[i + 1][0]) {
        const dt = posArr[i + 1][0] - posArr[i][0];
        const frac = dt > 0.001 ? (t - posArr[i][0]) / dt : 0;
        const x = posArr[i][1] + (posArr[i + 1][1] - posArr[i][1]) * frac;
        const y = posArr[i][2] + (posArr[i + 1][2] - posArr[i][2]) * frac;
        const dx = posArr[i + 1][1] - posArr[i][1];
        const dy = posArr[i + 1][2] - posArr[i][2];
        return { x, y, heading: Math.atan2(dy, dx) };
      }
    }
    return { x: posArr[0][1], y: posArr[0][2], heading: 0 };
  }

  setMeshOpacity(mesh, opacity) {
    mesh.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.transparent = true;
        child.material.opacity = opacity;
      }
    });
  }

  applyCameraPreset(preset) {
    document.querySelectorAll('.street-hud-btn').forEach(btn => btn.classList.remove('active'));
    if (preset === 'follow') {
      document.getElementById('btn-cam-follow')?.classList.add('active');
    } else if (preset === 'orbit') {
      document.getElementById('btn-cam-orbit')?.classList.add('active');
    } else if (preset === 'top') {
      document.getElementById('btn-cam-top')?.classList.add('active');
    }
  }

  applyLayerToggle(key, val) {
    if (key === 'buildings') this.groups.buildings.visible = val;
    else if (key === 'roads') this.groups.roads.visible = val;
    else if (key === 'sidewalks') {
      this.groups.sidewalks.visible = val;
      this.groups.rails.visible = val;
      this.groups.areas.visible = val;
    } else if (key === 'foliage') {
      this.groups.foliage.visible = val;
      this.groups.props.visible = val;
    } else if (key === 'parked') this.groups.parked.visible = val;
    else if (key === 'moving') this.groups.moving.visible = val;
    else if (key === 'signs') this.groups.signs.visible = val;
    else if (key === 'fov') this.fovGroup.visible = val;
  }

  onCanvasClick(e) {
    const wrap = document.getElementById('street-canvas-wrap');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects([
      this.groups.signs,
      this.groups.parked,
      this.groups.moving
    ], true);

    if (intersects.length > 0) {
      let topObj = intersects[0].object;
      while (topObj && (!topObj.userData || !topObj.userData.id) && topObj.parent) {
        topObj = topObj.parent;
      }
      if (topObj && topObj.userData && topObj.userData.id) {
        state.selectObject(topObj.userData);
      }
    } else {
      state.selectObject(null);
    }
  }

  highlightObject(obj) {
    const card = document.getElementById('street-inspector');
    if (!card) return;

    if (!obj) {
      card.classList.remove('visible');
      if (this.selectionRing) this.selectionRing.visible = false;
      return;
    }

    card.classList.add('visible');

    const isSign = obj.kind === 'sign';
    const fam = isSign ? getSignFamily(obj.cls) : {
      family: obj.state || obj.kind,
      color: obj.state === 'parked' ? '#E8A33D' : (obj.state === 'moving' ? '#2BB3A3' : '#8A94A6'),
      label: (obj.state ? obj.state.toUpperCase() : (obj.kind || 'VEHICLE'))
    };

    const titleEl = document.getElementById('street-insp-title');
    if (titleEl) titleEl.textContent = (obj.cls || 'OBJECT').replace(/_/g, ' ').toUpperCase();

    const badge = document.getElementById('street-insp-badge');
    if (badge) {
      badge.textContent = fam.label;
      badge.style.background = fam.color;
      badge.style.color = fam.family === 'warning' ? '#000000' : '#FFFFFF';
    }

    const idEl = document.getElementById('street-insp-id');
    if (idEl) idEl.textContent = obj.id || 'N/A';

    const stateEl = document.getElementById('street-insp-state');
    if (stateEl) {
      stateEl.textContent = obj.state ?
        (obj.confirmed ? `${obj.state} (confirmed)` : obj.state) :
        (isSign ? 'Sign' : 'Detected');
    }

    const streetEl = document.getElementById('street-insp-street');
    if (streetEl) streetEl.textContent = obj.street || state.getStreetAt(obj.t0) || 'Milan Street Network';

    const windowEl = document.getElementById('street-insp-window');
    if (windowEl) windowEl.textContent = `${formatTime(obj.t0)} – ${formatTime(obj.t1)}`;

    const scoreEl = document.getElementById('street-insp-score');
    if (scoreEl) scoreEl.textContent = `${((obj.score || 0.9) * 100).toFixed(1)}%`;

    const mergedRow = document.getElementById('street-insp-row-merged');
    const mergedEl = document.getElementById('street-insp-merged');
    if (mergedRow && mergedEl) {
      if (obj.n_tracks && obj.n_tracks > 1) {
        mergedRow.style.display = 'table-row';
        mergedEl.textContent = `${obj.n_tracks} tracker tracks`;
      } else {
        mergedRow.style.display = 'none';
      }
    }

    // Position selection ring marker around object
    if (this.selectionRing) {
      let x = 0, y = 0;
      if (obj.fixed) {
        x = obj.fixed[0];
        y = obj.fixed[1];
      } else if (obj.pos && obj.pos.length > 0) {
        const pt = this.interpolatePos(obj.pos, state.t);
        if (pt) { x = pt.x; y = pt.y; }
      }
      this.selectionRing.position.set(x, 0.22, -y);
      this.selectionRing.visible = true;

      // Jump camera smoothly to inspect selected object
      if (obj.fixed) {
        state.setCameraPreset('orbit');
        this.controls.target.set(x, 1.5, -y);
        this.camera.position.set(x + 10.0, 5.5, -y + 10.0);
        this.controls.update();
      }
    }
  }

  startLoop() {
    let lastTime = performance.now();
    const frame = () => {
      this.animId = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      this.update(dt);
      this.renderer.render(this.scene, this.camera);

      // FPS Calculation
      this.fpsCounter.frames++;
      if (now - this.fpsCounter.lastTime >= 500) {
        this.fpsCounter.fps = Math.round((this.fpsCounter.frames * 1000) / (now - this.fpsCounter.lastTime));
        this.fpsCounter.frames = 0;
        this.fpsCounter.lastTime = now;
        const fpsEl = document.getElementById('street-fps-display');
        if (fpsEl) fpsEl.textContent = this.fpsCounter.fps;
      }
    };
    frame();
  }
}
