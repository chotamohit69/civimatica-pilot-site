import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { state } from './state.js';
import { getSignFamily, formatTime } from './data.js';

export class StreetSection {
  constructor(container) {
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    // Groups for layer toggling
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
      signs: new THREE.Group(),
      sideObjects: new THREE.Group(),
      fov: new THREE.Group()
    };

    this.egoMesh = null;
    this.dirLight = null;
    this.fovMeshes = {};
    this.trackMeshes = new Map(); // id -> { mesh, data, type }
    this.fixedTracks = [];
    this.movingTracks = [];
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.fpsCounter = { frames: 0, lastTime: performance.now(), fps: 60 };
    this.animId = null;

    state.on('dataLoaded', () => this.buildScene());
    state.on('presetChange', (p) => this.applyCameraPreset(p));
    state.on('layerChange', ({ key, val }) => this.applyLayerToggle(key, val));
    state.on('selectionChange', (obj) => this.highlightObject(obj));
  }

  init() {
    this.container.innerHTML = `
      <div class="three-canvas-wrap" id="street-canvas-wrap"></div>
      
      <div class="street-hud">
        <div class="hud-panel">
          <button class="hud-btn active" id="btn-cam-follow">Follow Cam</button>
          <button class="hud-btn" id="btn-cam-orbit">Free Orbit</button>
          <button class="hud-btn" id="btn-cam-top">Top Down</button>
        </div>
        <div class="hud-panel">
          <span style="font-size: 0.72rem; color: var(--text-muted)">FPS:</span>
          <span class="fps-badge" id="fps-display">60</span>
        </div>
      </div>

      <div class="layer-toggles-panel">
        <span style="color: var(--text-muted); font-size: 0.72rem; margin-right: 2px;">Layers:</span>
        <button class="layer-toggle-btn active" data-layer="buildings">Buildings</button>
        <button class="layer-toggle-btn active" data-layer="roads">Roads</button>
        <button class="layer-toggle-btn active" data-layer="foliage">Foliage</button>
        <button class="layer-toggle-btn active" data-layer="parked">Parked</button>
        <button class="layer-toggle-btn active" data-layer="moving">Moving</button>
        <button class="layer-toggle-btn active" data-layer="signs">Signs</button>
        <button class="layer-toggle-btn active" data-layer="fov">Camera FOVs</button>
      </div>

      <div class="inspector-card" id="object-inspector">
        <div class="inspector-header">
          <span class="inspector-title" id="insp-title">Class Name</span>
          <span class="inspector-badge" id="insp-badge">Family</span>
        </div>
        <table class="inspector-table">
          <tr><td>Track ID</td><td id="insp-id">s0:v1</td></tr>
          <tr><td>State</td><td id="insp-state">Parked</td></tr>
          <tr><td>Street</td><td id="insp-street">Viale Elvezia</td></tr>
          <tr><td>Detection Window</td><td id="insp-window">00:12 – 00:24</td></tr>
          <tr><td>Confidence</td><td id="insp-score">92.4%</td></tr>
        </table>
        <div class="inspector-note">Position estimated from monocular camera</div>
      </div>
    `;

    const wrap = document.getElementById('street-canvas-wrap');
    const width = wrap.clientWidth || window.innerWidth;
    const height = wrap.clientHeight || (window.innerHeight - 150);

    // Three.js Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xE6E4DE); // Warm clay mist background
    this.scene.fog = new THREE.Fog(0xE6E4DE, 50, 320);

    // Camera
    this.camera = new THREE.PerspectiveCamera(52, width / height, 0.5, 600);
    this.camera.position.set(0, 30, 40);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    wrap.appendChild(this.renderer.domElement);

    // Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't go below ground
    this.controls.minDistance = 3;
    this.controls.maxDistance = 220;

    // Add layer groups to scene
    for (const grp of Object.values(this.groups)) {
      this.scene.add(grp);
    }

    // Lights
    this.setupLighting();

    // Ground Plane
    const groundGeo = new THREE.PlaneGeometry(800, 800);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0xEAE8E1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Event listeners for HUD
    this.bindEvents();

    // Start render loop
    this.startLoop();
  }

  setupLighting() {
    // Ambient / Hemisphere light for soft clay feel
    const hemiLight = new THREE.HemisphereLight(0xFFFFFF, 0x8D8B84, 0.7);
    hemiLight.position.set(0, 100, 0);
    this.scene.add(hemiLight);

    const ambLight = new THREE.AmbientLight(0xFFFFFF, 0.35);
    this.scene.add(ambLight);

    // Key Directional Light with soft shadows
    this.dirLight = new THREE.DirectionalLight(0xFFF9ED, 1.1);
    this.dirLight.position.set(80, 120, 60);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 300;
    this.dirLight.shadow.camera.left = -60;
    this.dirLight.shadow.camera.right = 60;
    this.dirLight.shadow.camera.top = 60;
    this.dirLight.shadow.camera.bottom = -60;
    this.dirLight.shadow.bias = -0.0005;
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
    document.getElementById('btn-cam-follow').addEventListener('click', () => state.setCameraPreset('follow'));
    document.getElementById('btn-cam-orbit').addEventListener('click', () => state.setCameraPreset('orbit'));
    document.getElementById('btn-cam-top').addEventListener('click', () => state.setCameraPreset('top'));

    // Layer toggles
    document.querySelectorAll('.layer-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const layer = btn.getAttribute('data-layer');
        state.toggleLayer(layer);
        btn.classList.toggle('active', state.layers[layer]);
      });
    });

    // Raycast click on objects
    this.renderer.domElement.addEventListener('click', (e) => this.onCanvasClick(e));
  }

  buildScene() {
    const sceneData = state.scene;
    const driveData = state.drive;
    if (!sceneData) return;

    // Clear old meshes
    for (const grp of Object.values(this.groups)) {
      while (grp.children.length > 0) {
        const obj = grp.children[0];
        grp.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
      }
    }
    this.trackMeshes.clear();

    // 1. Buildings (Merged geometry)
    this.buildBuildings(sceneData.buildings || []);

    // 2. Road Ribbons & Sidewalks
    this.buildRoads(sceneData.roads || []);

    // 3. Rails
    this.buildRails(sceneData.rails || []);

    // 4. Areas (Parks, Grass, Water)
    this.buildAreas(sceneData.areas || []);

    // 5. Trees (InstancedMesh)
    this.buildTrees(sceneData.trees || []);

    // 6. Props (Street lamps, signals, crossings, benches)
    this.buildProps(sceneData.nodes || []);

    // 7. Ego Vehicle + Camera FOV cones
    this.buildEgoVehicle(driveData ? driveData.cameras : []);

    // 8. Detected tracks
    if (driveData && driveData.tracks) {
      this.buildTrackObjects(driveData.tracks);
    }
  }

  buildBuildings(buildings) {
    if (buildings.length === 0) return;
    const geos = [];
    const mat = new THREE.MeshLambertMaterial({
      color: 0xDDD9D1,
      reflectivity: 0.1
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

      const height = b.h || 14.0;
      const minH = b.min_h || 0;
      try {
        const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
          depth: Math.max(1, height - minH),
          bevelEnabled: false
        });
        // Rotate so +Z in shape becomes +Y in 3D, and Y in shape becomes -Z in 3D
        extrudeGeo.rotateX(-Math.PI / 2);
        if (minH > 0) extrudeGeo.translate(0, minH, 0);
        geos.push(extrudeGeo);
      } catch (err) {
        console.warn('Skipping building extrude error', err);
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

  buildRoads(roads) {
    if (roads.length === 0) return;
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x363A42 });
    const sidewalkMat = new THREE.MeshLambertMaterial({ color: 0xC8C5BD });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xE8E6DF });

    const roadGeos = [];
    const sidewalkGeos = [];
    const lineGeos = [];

    for (const r of roads) {
      const pts = r.pts;
      if (!pts || pts.length < 2) continue;
      const w = r.width || 12.0;
      const halfW = w / 2;
      const hasSidewalk = r.sidewalk === 'both' || r.sidewalk === 'left' || r.sidewalk === 'right' || !r.sidewalk;
      const swW = 1.8;

      // Triangulate ribbon along pts
      const roadVerts = [];
      const leftSwVerts = [];
      const rightSwVerts = [];
      const centerLineVerts = [];

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        let tx = 0, ty = 0;
        if (i < pts.length - 1) {
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

        // Road left and right
        const lx = p[0] + nx * halfW;
        const lz = -(p[1] + ny * halfW);
        const rx = p[0] - nx * halfW;
        const rz = -(p[1] - ny * halfW);

        // Center line
        const clx1 = p[0] + nx * 0.1;
        const clz1 = -(p[1] + ny * 0.1);
        const clx2 = p[0] - nx * 0.1;
        const clz2 = -(p[1] - ny * 0.1);

        // Sidewalks
        const slx = p[0] + nx * (halfW + swW);
        const slz = -(p[1] + ny * (halfW + swW));
        const srx = p[0] - nx * (halfW + swW);
        const srz = -(p[1] - ny * (halfW + swW));

        roadVerts.push([lx, 0.04, lz], [rx, 0.04, rz]);
        centerLineVerts.push([clx1, 0.06, clz1], [clx2, 0.06, clz2]);
        leftSwVerts.push([slx, 0.16, slz], [lx, 0.16, lz]);
        rightSwVerts.push([rx, 0.16, rz], [srx, 0.16, srz]);
      }

      const makeRibbonGeo = (verts) => {
        const positions = [];
        for (let i = 0; i < verts.length - 2; i += 2) {
          const v0 = verts[i];
          const v1 = verts[i + 1];
          const v2 = verts[i + 2];
          const v3 = verts[i + 3];
          positions.push(...v0, ...v1, ...v2);
          positions.push(...v1, ...v3, ...v2);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.computeVertexNormals();
        return geo;
      };

      roadGeos.push(makeRibbonGeo(roadVerts));
      lineGeos.push(makeRibbonGeo(centerLineVerts));
      if (hasSidewalk) {
        sidewalkGeos.push(makeRibbonGeo(leftSwVerts));
        sidewalkGeos.push(makeRibbonGeo(rightSwVerts));
      }
    }

    if (roadGeos.length > 0) {
      const mergedRoad = BufferGeometryUtils.mergeGeometries(roadGeos, false);
      const mesh = new THREE.Mesh(mergedRoad, roadMat);
      mesh.receiveShadow = true;
      this.groups.roads.add(mesh);
    }
    if (lineGeos.length > 0) {
      const mergedLines = BufferGeometryUtils.mergeGeometries(lineGeos, false);
      const lineMesh = new THREE.Mesh(mergedLines, lineMat);
      this.groups.roads.add(lineMesh);
    }
    if (sidewalkGeos.length > 0) {
      const mergedSw = BufferGeometryUtils.mergeGeometries(sidewalkGeos, false);
      const swMesh = new THREE.Mesh(mergedSw, sidewalkMat);
      swMesh.receiveShadow = true;
      this.groups.sidewalks.add(swMesh);
    }
  }

  buildRails(rails) {
    if (rails.length === 0) return;
    const railMat = new THREE.MeshLambertMaterial({ color: 0x646973 });
    for (const r of rails) {
      const pts = r.pts;
      if (!pts || pts.length < 2) continue;
      // standard gauge ~1.435m
      for (const offset of [-0.71, 0.71]) {
        const positions = [];
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          let tx = 0, ty = 0;
          if (i < pts.length - 1) {
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
          const rx = p[0] + nx * offset;
          const rz = -(p[1] + ny * offset);
          positions.push(rx, 0.05, rz);
        }
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const line = new THREE.Line(lineGeo, railMat);
        this.groups.rails.add(line);
      }
    }
  }

  buildAreas(areas) {
    if (areas.length === 0) return;
    for (const a of areas) {
      const pts = a.pts;
      if (!pts || pts.length < 3) continue;
      const shape = new THREE.Shape();
      shape.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
      shape.closePath();

      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);

      let col = 0x8DA882; // sage grass/park
      if (a.kind === 'water') col = 0x688E8F;
      else if (a.kind === 'parking' || a.kind === 'pedestrian') col = 0xD4D0C7;

      const mat = new THREE.MeshLambertMaterial({ color: col });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 0.01;
      mesh.receiveShadow = true;
      this.groups.areas.add(mesh);
    }
  }

  buildTrees(trees) {
    if (trees.length === 0) return;
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.28, 2.4, 6);
    trunkGeo.translate(0, 1.2, 0);
    const canopyGeo = new THREE.DodecahedronGeometry(1.6, 1);
    canopyGeo.translate(0, 3.2, 0);

    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5C4E42 });
    const canopyMat = new THREE.MeshLambertMaterial({ color: 0x5E8058 });

    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    const canopyMesh = new THREE.InstancedMesh(canopyGeo, canopyMat, trees.length);
    trunkMesh.castShadow = true;
    canopyMesh.castShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < trees.length; i++) {
      const [tx, ty] = trees[i];
      const scale = 0.85 + ((i % 5) * 0.08);
      dummy.position.set(tx, 0, -ty);
      dummy.scale.set(scale, scale, scale);
      dummy.rotation.y = (i * 0.7);
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
    if (nodes.length === 0) return;
    for (const n of nodes) {
      const x = n.x, z = -n.y;
      if (n.kind === 'crossing') {
        // Zebra crossing stripes
        const dir = n.dir || 0;
        const stripeGeo = new THREE.PlaneGeometry(0.6, 4.0);
        stripeGeo.rotateX(-Math.PI / 2);
        const stripeMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });
        const grp = new THREE.Group();
        grp.position.set(x, 0.05, z);
        grp.rotation.y = dir;
        for (let s = -3; s <= 3; s++) {
          const st = new THREE.Mesh(stripeGeo, stripeMat);
          st.position.x = s * 0.9;
          grp.add(st);
        }
        this.groups.props.add(grp);
      } else if (n.kind === 'street_lamp') {
        const lamp = new THREE.Group();
        lamp.position.set(x, 0, z);
        const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 5.5, 6);
        poleGeo.translate(0, 2.75, 0);
        const poleMat = new THREE.MeshLambertMaterial({ color: 0x4A4E57 });
        lamp.add(new THREE.Mesh(poleGeo, poleMat));
        const headGeo = new THREE.BoxGeometry(0.3, 0.15, 0.6);
        headGeo.translate(0, 5.4, 0.25);
        lamp.add(new THREE.Mesh(headGeo, poleMat));
        this.groups.props.add(lamp);
      } else if (n.kind === 'traffic_signals') {
        const sig = new THREE.Group();
        sig.position.set(x, 0, z);
        if (n.dir !== undefined) sig.rotation.y = n.dir;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 5.0, 6), new THREE.MeshLambertMaterial({ color: 0x33363D }));
        pole.position.y = 2.5;
        sig.add(pole);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.1, 0.35), new THREE.MeshLambertMaterial({ color: 0x1A1C20 }));
        box.position.set(0, 4.2, 0.2);
        sig.add(box);
        this.groups.props.add(sig);
      } else if (n.kind === 'bus_stop' || n.kind === 'tram_stop') {
        const shelter = new THREE.Group();
        shelter.position.set(x, 0, z);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.4, 1.5), new THREE.MeshLambertMaterial({ color: 0x9096A0, transparent: true, opacity: 0.5 }));
        frame.position.y = 1.2;
        shelter.add(frame);
        this.groups.props.add(shelter);
      } else if (n.kind === 'bench') {
        const bench = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.45, 0.6), new THREE.MeshLambertMaterial({ color: 0x8C7456 }));
        bench.position.set(x, 0.25, z);
        this.groups.props.add(bench);
      } else if (n.kind === 'bollard') {
        const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.8, 8), new THREE.MeshLambertMaterial({ color: 0x545862 }));
        bollard.position.set(x, 0.4, z);
        this.groups.props.add(bollard);
      }
    }
  }

  buildEgoVehicle(cameras) {
    if (this.egoMesh) {
      this.scene.remove(this.egoMesh);
    }

    this.egoMesh = new THREE.Group();

    // AV Car Body (Clay off-white)
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xF7F7F8, roughness: 0.4, metalness: 0.1 });
    const winMat = new THREE.MeshStandardMaterial({ color: 0x22262E, roughness: 0.2 });
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x2D3036 });

    // Lower chassis (length 4.5m, width 1.85m, height 0.8m)
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.75, 4.4), bodyMat);
    chassis.position.y = 0.55;
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    this.egoMesh.add(chassis);

    // Cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.65, 2.2), winMat);
    cabin.position.set(0, 1.15, -0.2);
    cabin.castShadow = true;
    this.egoMesh.add(cabin);

    // Roof Sensor Platform
    const roofRack = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 1.6), new THREE.MeshLambertMaterial({ color: 0x1C1E24 }));
    roofRack.position.set(0, 1.52, -0.2);
    this.egoMesh.add(roofRack);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const [wx, wz] of [[0.95, 1.3], [-0.95, 1.3], [0.95, -1.3], [-0.95, -1.3]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(wx, 0.35, wz);
      this.egoMesh.add(w);
    }

    // Camera Sensor Pods on Roof
    const podMat = new THREE.MeshLambertMaterial({ color: 0x00E5FF });
    // c0 / c1 front centre
    const frontPod = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.2), podMat);
    frontPod.position.set(0, 1.62, 0.45);
    this.egoMesh.add(frontPod);

    // c2 right pod
    const rightPod = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.2), podMat);
    rightPod.position.set(0.62, 1.60, -0.2);
    this.egoMesh.add(rightPod);

    // c3 left pod
    const leftPod = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.2), podMat);
    leftPod.position.set(-0.62, 1.60, -0.2);
    this.egoMesh.add(leftPod);

    // Camera FOV Cones / Wedges
    this.buildFovWedges(cameras);

    this.scene.add(this.egoMesh);
  }

  buildFovWedges(cameras) {
    // Clear old FOV wedges
    while (this.groups.fov.children.length > 0) {
      this.groups.fov.remove(this.groups.fov.children[0]);
    }
    this.fovMeshes = {};

    const cams = cameras && cameras.length > 0 ? cameras : [
      { id: 'c0', yaw_deg: 0, hfov_deg: 110.7 },
      { id: 'c1', yaw_deg: 0, hfov_deg: 95.9 },
      { id: 'c2', yaw_deg: -70, hfov_deg: 68.6 },
      { id: 'c3', yaw_deg: 70, hfov_deg: 64.8 }
    ];

    // FOV cone helper: Creates an extruded/radial wedge
    const makeWedge = (hfovDeg, length, colorHex, opacity) => {
      const halfAngle = (hfovDeg * Math.PI) / 360;
      const pts = [new THREE.Vector2(0, 0)];
      const segments = 24;
      for (let i = 0; i <= segments; i++) {
        const theta = -halfAngle + (i / segments) * 2 * halfAngle;
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

    for (const c of cams) {
      const yawRad = (c.yaw_deg * Math.PI) / 180;
      const hfov = c.hfov_deg || 80;
      const length = c.id === 'c1' ? 32 : (c.id === 'c0' ? 24 : 18);
      const color = c.id === 'c1' ? 0x2BB3A3 : (c.id === 'c0' ? 0x3D7BD9 : 0xF2C14E);
      const wedge = makeWedge(hfov, length, color, 0.16);
      wedge.position.set(0, 1.62, 0);
      wedge.rotation.y = yawRad;
      this.fovMeshes[c.id] = wedge;
      this.egoMesh.add(wedge);
    }
  }

  buildTrackObjects(tracks) {
    this.fixedTracks = [];
    this.movingTracks = [];
    const carGeo = new THREE.BoxGeometry(1.8, 1.4, 4.2);
    carGeo.translate(0, 0.7, 0);
    const signPoleGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.5, 8);
    signPoleGeo.translate(0, 1.25, 0);
    const signPoleMat = new THREE.MeshLambertMaterial({ color: 0x8A8E96 });

    for (const trk of tracks) {
      let item = null;
      if (trk.kind === 'sign') {
        const signGrp = new THREE.Group();
        signGrp.userData = trk;

        // Pole
        const pole = new THREE.Mesh(signPoleGeo, signPoleMat);
        signGrp.add(pole);

        // Plate
        const fam = getSignFamily(trk.cls);
        const plateMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(fam.color) });
        let plate;
        if (fam.family === 'prohibitory' || fam.family === 'mandatory') {
          plate = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.04, 16), plateMat);
          plate.rotation.x = Math.PI / 2;
          plate.position.y = 2.4;
        } else if (fam.family === 'warning') {
          plate = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.04, 3), plateMat);
          plate.position.y = 2.4;
        } else {
          plate = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.65, 0.04), plateMat);
          plate.position.y = 2.4;
        }
        signGrp.add(plate);

        if (trk.fixed) {
          signGrp.position.set(trk.fixed[0], 0, -trk.fixed[1]);
          if (trk.fixed[2] !== undefined) signGrp.rotation.y = trk.fixed[2];
        }

        signGrp.visible = false;
        this.groups.signs.add(signGrp);
        item = { mesh: signGrp, data: trk, type: 'sign', baseColor: fam.color, lifecycle: 'future', isFixed: true };
        this.trackMeshes.set(trk.id, item);
        this.fixedTracks.push(item);
        const isParked = trk.state === 'parked';
        const colorHex = isParked ? 0xE8A33D : (trk.state === 'moving' ? 0x2BB3A3 : 0x8A94A6);
        const vehMat = new THREE.MeshStandardMaterial({
          color: colorHex,
          roughness: 0.5,
          metalness: 0.1,
          transparent: true,
          opacity: 1.0
        });
        const vehMesh = new THREE.Mesh(carGeo, vehMat);
        vehMesh.userData = trk;
        vehMesh.castShadow = true;

        if (isParked && trk.fixed) {
          vehMesh.position.set(trk.fixed[0], 0, -trk.fixed[1]);
          if (trk.fixed[2] !== undefined) vehMesh.rotation.y = trk.fixed[2];
          vehMesh.visible = false;
          this.groups.parked.add(vehMesh);
        } else {
          vehMesh.visible = false;
          this.groups.moving.add(vehMesh);
        }

        item = { mesh: vehMesh, data: trk, type: isParked ? 'parked' : 'moving', baseColor: colorHex, lifecycle: 'future', isFixed: !!trk.fixed };
        this.trackMeshes.set(trk.id, item);
        if (trk.fixed) this.fixedTracks.push(item);
        else this.movingTracks.push(item);
        const objGrp = new THREE.Group();
        objGrp.userData = trk;
        const objMat = new THREE.MeshLambertMaterial({ color: 0xF2C14E });

        if (trk.cls === 'e_scooter') {
          const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 1.1), objMat);
          body.position.y = 0.15;
          const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.0), objMat);
          handle.position.set(0, 0.6, 0.4);
          objGrp.add(body, handle);
        } else if (trk.cls === 'parking_meter') {
          const meter = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.4, 0.3), objMat);
          meter.position.y = 0.7;
          objGrp.add(meter);
        } else {
          const general = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 0.8), objMat);
          general.position.y = 0.75;
          objGrp.add(general);
        }

        if (trk.fixed) {
          objGrp.position.set(trk.fixed[0], 0, -trk.fixed[1]);
          if (trk.fixed[2] !== undefined) objGrp.rotation.y = trk.fixed[2];
        }

        objGrp.visible = false;
        this.groups.sideObjects.add(objGrp);
        item = { mesh: objGrp, data: trk, type: 'object', baseColor: 0xF2C14E, lifecycle: 'future', isFixed: true };
        this.trackMeshes.set(trk.id, item);
        this.fixedTracks.push(item);
      }
    }
  }

  update(dt) {
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

    // Update Ego vehicle position and orientation
    if (this.egoMesh) {
      this.egoMesh.position.set(ego.x, 0, -ego.y);
      this.egoMesh.rotation.y = ego.h - Math.PI / 2; // Orient car along heading

      // Directional light shadow camera follows ego car
      if (this.dirLight) {
        this.dirLight.position.set(ego.x + 80, 120, -ego.y + 60);
        this.dirLight.target.position.set(ego.x, 0, -ego.y);
      }
    }

    // Update camera preset behavior
    if (state.cameraPreset === 'follow' && this.egoMesh) {
      // Position camera behind and above car, facing forward
      const camDist = 16.0;
      const camHeight = 7.5;
      const rearX = ego.x - Math.cos(ego.h) * camDist;
      const rearZ = -ego.y + Math.sin(ego.h) * camDist;

      this.camera.position.set(rearX, camHeight, rearZ);
      this.camera.lookAt(ego.x + Math.cos(ego.h) * 12.0, 1.5, -ego.y - Math.sin(ego.h) * 12.0);
      this.controls.target.set(ego.x, 1.5, -ego.y);
    } else if (state.cameraPreset === 'top' && this.egoMesh) {
      this.camera.position.set(ego.x, 90, -ego.y + 0.1);
      this.camera.lookAt(ego.x, 0, -ego.y);
      this.controls.target.set(ego.x, 0, -ego.y);
    } else if (this.controls) {
      this.controls.update();
    }

    // Update visibility and fade of detected tracks
    const egoX = ego.x, egoY = ego.y;
    const maxDistSq = 180 * 180;

    // 1. Static tracks: updated every 0.4s or on seek
    if (this.lastFixedCheckT === undefined || Math.abs(t - this.lastFixedCheckT) >= 0.4) {
      this.lastFixedCheckT = t;
      for (let i = 0; i < this.fixedTracks.length; i++) {
        const item = this.fixedTracks[i];
        const trk = item.data;
        const mesh = item.mesh;

        // Distance culling for static objects
        const fx = trk.fixed[0] - egoX;
        const fy = trk.fixed[1] - egoY;
        if (fx * fx + fy * fy > maxDistSq) {
          if (item.lifecycle !== 'far') {
            item.lifecycle = 'far';
            mesh.visible = false;
          }
          continue;
        }

        if (t < trk.t0) {
          if (item.lifecycle !== 'future') {
            item.lifecycle = 'future';
            mesh.visible = false;
          }
        } else if (t <= trk.t1) {
          if (item.lifecycle !== 'active') {
            item.lifecycle = 'active';
            mesh.visible = true;
            this.setMeshOpacity(mesh, 1.0);
          }
        } else {
          if (item.lifecycle !== 'past') {
            item.lifecycle = 'past';
            mesh.visible = true;
            this.setMeshOpacity(mesh, 0.32);
          }
        }
      }
    }

    // 2. Moving tracks: only active ones updated every frame
    for (let i = 0; i < this.movingTracks.length; i++) {
      const item = this.movingTracks[i];
      const trk = item.data;
      const mesh = item.mesh;

      if (t < trk.t0 || t > trk.t1) {
        if (item.lifecycle !== 'inactive') {
          item.lifecycle = 'inactive';
          mesh.visible = false;
        }
      } else {
        if (item.lifecycle !== 'active') {
          item.lifecycle = 'active';
          mesh.visible = true;
          this.setMeshOpacity(mesh, 1.0);
        }
        if (trk.pos && trk.pos.length > 0) {
          const pt = this.interpolatePos(trk.pos, t);
          if (pt) mesh.position.set(pt.x, 0, -pt.y);
        }
      }
    }
  }

  interpolatePos(posArr, t) {
    if (posArr.length === 1) return { x: posArr[0][1], y: posArr[0][2] };
    if (t <= posArr[0][0]) return { x: posArr[0][1], y: posArr[0][2] };
    if (t >= posArr[posArr.length - 1][0]) return { x: posArr[posArr.length - 1][1], y: posArr[posArr.length - 1][2] };

    for (let i = 0; i < posArr.length - 1; i++) {
      if (t >= posArr[i][0] && t <= posArr[i + 1][0]) {
        const dt = posArr[i + 1][0] - posArr[i][0];
        const frac = dt > 0.001 ? (t - posArr[i][0]) / dt : 0;
        return {
          x: posArr[i][1] + (posArr[i + 1][1] - posArr[i][1]) * frac,
          y: posArr[i][2] + (posArr[i + 1][2] - posArr[i][2]) * frac
        };
      }
    }
    return { x: posArr[0][1], y: posArr[0][2] };
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
    document.querySelectorAll('.hud-btn').forEach(btn => btn.classList.remove('active'));
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
    else if (key === 'roads') {
      this.groups.roads.visible = val;
      this.groups.sidewalks.visible = val;
      this.groups.rails.visible = val;
      this.groups.areas.visible = val;
    } else if (key === 'foliage') {
      this.groups.foliage.visible = val;
      this.groups.props.visible = val;
    } else if (key === 'parked') this.groups.parked.visible = val;
    else if (key === 'moving') this.groups.moving.visible = val;
    else if (key === 'signs') this.groups.signs.visible = val;
    else if (key === 'fov') this.groups.fov.visible = val;
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
      this.groups.moving,
      this.groups.sideObjects
    ], true);

    if (intersects.length > 0) {
      let topObj = intersects[0].object;
      while (topObj && !topObj.userData.id && topObj.parent) {
        topObj = topObj.parent;
      }
      if (topObj && topObj.userData.id) {
        state.selectObject(topObj.userData);
      }
    } else {
      state.selectObject(null);
    }
  }

  highlightObject(obj) {
    const card = document.getElementById('object-inspector');
    if (!card) return;

    if (!obj) {
      card.classList.remove('visible');
      return;
    }

    card.classList.add('visible');
    const fam = obj.kind === 'sign' ? getSignFamily(obj.cls) : { family: obj.state || obj.kind, color: '#2BB3A3', label: obj.kind };

    document.getElementById('insp-title').textContent = obj.cls.replace(/_/g, ' ').toUpperCase();
    const badge = document.getElementById('insp-badge');
    badge.textContent = fam.label;
    badge.style.background = fam.color;
    badge.style.color = '#000000';

    document.getElementById('insp-id').textContent = obj.id;
    document.getElementById('insp-state').textContent = obj.state ? (obj.confirmed ? `${obj.state} (confirmed)` : obj.state) : (obj.kind || 'detected');
    document.getElementById('insp-street').textContent = obj.street || 'Street network';
    document.getElementById('insp-window').textContent = `${formatTime(obj.t0)} – ${formatTime(obj.t1)}`;
    document.getElementById('insp-score').textContent = `${(obj.score * 100).toFixed(1)}%`;
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
        const fpsEl = document.getElementById('fps-display');
        if (fpsEl) fpsEl.textContent = this.fpsCounter.fps;
      }
    };
    frame();
  }
}
