// Mapview: Mapbox GL JS v3 implementation for Milan Pilot
import { formatDuration } from './data.js';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function createMap(container, model, options = {}) {
  const mapboxgl = window.mapboxgl;
  mapboxgl.accessToken = options.token;

  const containerEl = typeof container === 'string' ? document.getElementById(container) : container;
  containerEl.classList.add('map');

  // Compute bounding box of whole route
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (let i = 0; i < model.route.lngLat.length; i++) {
    const [lng, lat] = model.route.lngLat[i];
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const routeBounds = [[minLng, minLat], [maxLng, maxLat]];

  const map = new mapboxgl.Map({
    container: containerEl,
    style: 'mapbox://styles/mapbox/standard',
    config: {
      basemap: {
        lightPreset: 'day',
        show3dObjects: true,
        showPointOfInterestLabels: false,
        showTransitLabels: false,
        showRoadLabels: true,
        showPlaceLabels: true,
        showPedestrianRoads: true
      }
    },
    bounds: routeBounds,
    fitBoundsOptions: {
      padding: { left: 400, top: 60, right: 60, bottom: 60 },
      pitch: 50,
      bearing: -17
    },
    pitch: 50,
    bearing: -17,
    antialias: true,
    attributionControl: false
  });

  map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');

  if (typeof window !== 'undefined') {
    window.__map = map;
  }

  // Pre-index items for fast lookups
  const itemById = new Map();
  for (let i = 0; i < model.items.length; i++) {
    itemById.set(model.items[i].id, model.items[i]);
  }

  // State
  let isLoaded = false;
  let activeKinds = new Set(['parked', 'parking-sign', 'sign', 'object']);
  let selectedId = null;
  let selectedPinEl = null;
  let focusedStreet = null;
  let currentDriveTime = null;
  let follow = true;
  let egoMarker = null;
  let lastFilterTime = 0;

  const parkedMarkers = [];
  const parkedMarkersById = new Map();
  const streetMarkers = [];

  // Reusable object for zero-allocation jumpTo in 60fps drive mode
  const jumpOptions = {
    center: [0, 0],
    bearing: 0,
    pitch: 62,
    zoom: 17.3,
    padding: { left: 380, bottom: 160 }
  };

  // Zoom classes toggle on container & zone pills
  const updateZoomClasses = () => {
    const z = map.getZoom();
    containerEl.classList.toggle('far', z < 16);
    containerEl.classList.toggle('very-far', z < 13.5);

    const showPills = z >= 15.2;
    for (let i = 0; i < streetMarkers.length; i++) {
      streetMarkers[i].getElement().style.display = showPills ? '' : 'none';
    }
  };
  map.on('zoom', updateZoomClasses);

  // Apply filters to circle layer and parked car pins
  function applyFilters(force = false) {
    if (!isLoaded) return;
    const now = performance.now();
    if (!force && currentDriveTime != null && (now - lastFilterTime < 200)) {
      return;
    }
    lastFilterTime = now;

    // 1. Circle layer filter (signs and objects)
    const activePointKinds = ['parking-sign', 'sign', 'object'].filter(k => activeKinds.has(k));
    let pointFilter;
    if (activePointKinds.length === 0) {
      pointFilter = ['==', ['get', 'id'], ''];
    } else if (activePointKinds.length === 3) {
      pointFilter = (currentDriveTime != null)
        ? ['<=', ['get', 't0'], currentDriveTime]
        : ['!=', ['get', 'id'], ''];
    } else {
      const kindExpr = activePointKinds.length === 1
        ? ['==', ['get', 'kind'], activePointKinds[0]]
        : ['in', ['get', 'kind'], ['literal', activePointKinds]];
      pointFilter = (currentDriveTime != null)
        ? ['all', kindExpr, ['<=', ['get', 't0'], currentDriveTime]]
        : kindExpr;
    }
    map.setFilter('signs-layer', pointFilter);

    // 2. Selected sign / object filter
    if (selectedId) {
      const it = itemById.get(selectedId);
      if (it && it.kind !== 'parked' && activeKinds.has(it.kind) && (currentDriveTime == null || it.t0 <= currentDriveTime)) {
        map.setFilter('signs-selected', ['==', ['get', 'id'], selectedId]);
      } else {
        map.setFilter('signs-selected', ['==', ['get', 'id'], '']);
      }
    } else {
      map.setFilter('signs-selected', ['==', ['get', 'id'], '']);
    }

    // 3. Parked markers visibility
    const showParked = activeKinds.has('parked');
    for (let i = 0; i < parkedMarkers.length; i++) {
      const pm = parkedMarkers[i];
      const visible = showParked && (currentDriveTime == null || pm.t0 <= currentDriveTime);
      pm.element.style.display = visible ? '' : 'none';
    }
  }

  function select(id) {
    selectedId = id;
    if (selectedPinEl) {
      selectedPinEl.classList.remove('is-selected', 'is-on');
      selectedPinEl = null;
    }

    if (!id) {
      if (isLoaded) {
        map.setFilter('signs-selected', ['==', ['get', 'id'], '']);
      }
      return;
    }

    const it = itemById.get(id);
    if (!it) return;

    if (it.kind === 'parked') {
      const pm = parkedMarkersById.get(id);
      if (pm) {
        pm.element.classList.add('is-selected', 'is-on');
        selectedPinEl = pm.element;
      }
      if (isLoaded) {
        map.setFilter('signs-selected', ['==', ['get', 'id'], '']);
      }
    } else {
      if (isLoaded) {
        map.setFilter('signs-selected', ['==', ['get', 'id'], id]);
      }
    }

    if (!(follow && currentDriveTime != null)) {
      const currentZoom = map.getZoom();
      map.easeTo({
        center: it.lngLat,
        zoom: Math.max(currentZoom, 17),
        duration: 600
      });
    }
  }

  function focusStreet(name) {
    focusedStreet = name;
    if (!isLoaded) return;

    if (!name) {
      map.getSource('route-focus').setData({
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates: [] }
      });
      map.setPaintProperty('route-line', 'line-opacity', 1);
      map.setPaintProperty('route-casing', 'line-opacity', 0.95);
      map.fitBounds(routeBounds, {
        padding: { left: 400, top: 60, right: 60, bottom: 60 },
        pitch: 50,
        bearing: -17,
        duration: 800
      });
      return;
    }

    const street = model.streets.find(s => s.name === name);
    if (!street) return;

    map.setPaintProperty('route-line', 'line-opacity', 0.35);
    map.setPaintProperty('route-casing', 'line-opacity', 0.35);

    const multiline = [];
    const routeT = model.route.t;
    const routeCoords = model.route.lngLat;
    const n = routeT.length;

    for (const [t0, t1] of street.segments) {
      const line = [];
      for (let i = 0; i < n; i++) {
        const t = routeT[i];
        if (t >= t0 && t <= t1) {
          line.push(routeCoords[i]);
        }
      }
      if (line.length >= 2) {
        multiline.push(line);
      } else if (line.length === 1) {
        multiline.push([line[0], line[0]]);
      }
    }

    map.getSource('route-focus').setData({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: multiline }
    });

    map.fitBounds(street.bounds, {
      padding: { left: 400, top: 80, right: 80, bottom: 80 },
      maxZoom: 17.5,
      duration: 800
    });
  }

  function setDrive(t) {
    if (t == null) {
      currentDriveTime = null;
      if (egoMarker) {
        egoMarker.remove();
        egoMarker = null;
      }
      if (isLoaded) {
        map.setPaintProperty('route-traveled', 'line-opacity', 0);
        applyFilters(true);
        map.fitBounds(routeBounds, {
          padding: { left: 400, top: 60, right: 60, bottom: 60 },
          pitch: 50,
          bearing: -17,
          duration: 800
        });
      }
      return;
    }

    currentDriveTime = t;
    const pos = model.posAt(t);

    if (!egoMarker) {
      const el = document.createElement('div');
      el.className = 'ego-puck';
      el.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3 L19 19 L12 15 L5 19 Z" fill="#ffffff"/></svg>';
      egoMarker = new mapboxgl.Marker({
        element: el,
        rotationAlignment: 'map',
        pitchAlignment: 'map'
      }).setLngLat(pos.lngLat).addTo(map);
    } else {
      egoMarker.setLngLat(pos.lngLat);
    }
    egoMarker.setRotation(pos.bearing);

    if (isLoaded) {
      const totalDist = model.route.dist[model.route.dist.length - 1];
      const f = Math.max(0, Math.min(1, model.distAt(t) / (totalDist || 1)));
      map.setPaintProperty('route-traveled', 'line-opacity', 1);
      map.setPaintProperty('route-traveled', 'line-gradient', [
        'step',
        ['line-progress'],
        '#2563c9',
        Math.max(0.0001, Math.min(1, f)),
        'rgba(37, 99, 201, 0)'
      ]);

      applyFilters(false);
    }

    if (follow) {
      jumpOptions.center = pos.lngLat;
      jumpOptions.bearing = pos.bearing;
      map.jumpTo(jumpOptions);
    }
  }

  function setFollow(bool) {
    follow = Boolean(bool);
    if (follow && currentDriveTime != null) {
      const pos = model.posAt(currentDriveTime);
      jumpOptions.center = pos.lngLat;
      jumpOptions.bearing = pos.bearing;
      map.jumpTo(jumpOptions);
    }
  }

  // Interruption listener: dragging/rotating turns follow off
  const handleUserInterruption = (e) => {
    if (e && e.originalEvent) {
      if (follow) {
        follow = false;
        options.onFollowChange?.(false);
      }
    }
  };
  map.on('dragstart', handleUserInterruption);
  map.on('rotatestart', handleUserInterruption);
  map.on('pitchstart', handleUserInterruption);

  function initLayers() {
    // 1. Route source & layers
    map.addSource('route', {
      type: 'geojson',
      lineMetrics: true,
      data: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: model.route.lngLat
        }
      }
    });

    map.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'route',
      slot: 'middle',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': 7,
        'line-opacity': 0.95
      }
    });

    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      slot: 'middle',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#1c1916',
        'line-width': 3.5,
        'line-opacity': 1
      }
    });

    map.addLayer({
      id: 'route-traveled',
      type: 'line',
      source: 'route',
      slot: 'middle',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': 3.5,
        'line-opacity': 0,
        'line-gradient': [
          'step',
          ['line-progress'],
          '#2563c9',
          0.0001,
          'rgba(37, 99, 201, 0)'
        ]
      }
    });

    // 2. Focused street segment source & layer
    map.addSource('route-focus', {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'MultiLineString',
          coordinates: []
        }
      }
    });

    map.addLayer({
      id: 'route-focus',
      type: 'line',
      source: 'route-focus',
      slot: 'middle',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#2563c9',
        'line-width': 6,
        'line-opacity': 1
      }
    });

    // 3. Signs & objects circle source and layers
    const pointFeatures = [];
    for (let i = 0; i < model.items.length; i++) {
      const it = model.items[i];
      if (it.kind !== 'parked') {
        pointFeatures.push({
          type: 'Feature',
          properties: {
            id: it.id,
            kind: it.kind,
            t0: it.t0
          },
          geometry: {
            type: 'Point',
            coordinates: it.lngLat
          }
        });
      }
    }

    map.addSource('signs', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: pointFeatures
      }
    });

    map.addLayer({
      id: 'signs-layer',
      type: 'circle',
      source: 'signs',
      slot: 'middle',
      paint: {
        // zoom must be the top-level interpolate input; the per-kind size goes in the stops
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          12, ['case', ['==', ['get', 'kind'], 'object'], 1.4, 2],
          16, ['case', ['==', ['get', 'kind'], 'object'], 3.2, 4.5],
          18, ['case', ['==', ['get', 'kind'], 'object'], 5.2, 7]
        ],
        'circle-color': [
          'match',
          ['get', 'kind'],
          'parking-sign', '#c56a1a',
          'object', '#2f8a4c',
          '#c2412d'
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
        'circle-emissive-strength': 1
      }
    });

    map.addLayer({
      id: 'signs-selected',
      type: 'circle',
      source: 'signs',
      slot: 'middle',
      filter: ['==', ['get', 'id'], ''],
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          12, 4,
          16, 7.5,
          18, 11
        ],
        'circle-color': [
          'match',
          ['get', 'kind'],
          'parking-sign', '#c56a1a',
          'object', '#2f8a4c',
          '#c2412d'
        ],
        'circle-stroke-color': '#1c1916',
        'circle-stroke-width': 2.5,
        'circle-emissive-strength': 1
      }
    });

    // 4. Parked cars (Valletta HTML pins)
    for (let i = 0; i < model.items.length; i++) {
      const it = model.items[i];
      if (it.kind === 'parked') {
        const dwellStr = formatDuration(it.dwellMin);
        const street = it.street || 'Unnamed street';
        const label = `Parked car, ${street}, demo dwell ${dwellStr}`;
        const btn = document.createElement('button');
        btn.className = 'pin';
        btn.type = 'button';
        btn.setAttribute('aria-label', label);
        btn.title = label;
        btn.innerHTML = `<span class="pin-body kind-parked"><span class="pin-ico">P</span><span class="pin-val">${dwellStr}</span></span>`;

        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          select(it.id);
          options.onSelect?.(it.id);
        });

        const marker = new mapboxgl.Marker({ element: btn, anchor: 'bottom' })
          .setLngLat(it.lngLat)
          .addTo(map);

        const record = { id: it.id, t0: it.t0, marker, element: btn };
        parkedMarkers.push(record);
        parkedMarkersById.set(it.id, record);
      }
    }

    // 5. Street name pills
    for (let i = 0; i < model.streets.length; i++) {
      const st = model.streets[i];
      const pill = document.createElement('button');
      pill.className = 'zone-pill';
      pill.type = 'button';
      pill.innerHTML = `<i></i><span>${escapeHtml(st.name)}</span>`;
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        options.onStreet?.(st.name);
      });
      const m = new mapboxgl.Marker({ element: pill, anchor: 'center' })
        .setLngLat(st.lngLat)
        .addTo(map);
      streetMarkers.push(m);
    }

    // Layer click listeners
    let layerClickHandled = false;
    map.on('click', 'signs-layer', (e) => {
      layerClickHandled = true;
      if (e.features && e.features.length > 0) {
        const id = e.features[0].properties.id;
        select(id);
        options.onSelect?.(id);
      }
    });

    map.on('mouseenter', 'signs-layer', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'signs-layer', () => {
      map.getCanvas().style.cursor = '';
    });

    map.on('click', () => {
      if (layerClickHandled) {
        layerClickHandled = false;
        return;
      }
      select(null);
      options.onSelect?.(null);
    });

    isLoaded = true;
    updateZoomClasses();
    applyFilters(true);

    if (selectedId) {
      select(selectedId);
    }
    if (focusedStreet) {
      focusStreet(focusedStreet);
    }
  }

  const api = {
    map,
    ready: new Promise((resolve) => map.once('load', () => { initLayers(); resolve(); })),
    setFilter(kinds) {
      activeKinds = new Set(kinds);
      applyFilters(true);
    },
    select,
    focusStreet,
    setDrive,
    setFollow
  };

  return api;
}
