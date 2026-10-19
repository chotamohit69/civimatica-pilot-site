/* Civimatica Milan Pilot — Leaflet Cadastral Map
   - NO tile layer, base drawn from scene.json
   - Metric scale bar, authored north arrow, attribution
   - Route polyline with dashed unread segments and start/end markers
   - Canvas markers: signs (red circle), parked cars (blue square), objects (green diamond)
   - Dimming of marks not on selected street (~30% opacity)
*/

// Extend Leaflet Canvas to draw square and diamond markers
if (typeof L !== 'undefined' && L.Canvas) {
  L.Canvas.include({
    _updateSquare(layer) {
      if (!this._ctx || layer._empty()) return;
      const p = layer._point;
      const s = layer.options.size || 7;
      const half = s / 2;
      const ctx = this._ctx;
      ctx.beginPath();
      ctx.rect(p.x - half, p.y - half, s, s);
      this._fillStroke(ctx, layer);
    },
    _updateDiamond(layer) {
      if (!this._ctx || layer._empty()) return;
      const p = layer._point;
      const s = layer.options.size || 7;
      const half = s / 2;
      const ctx = this._ctx;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - half);
      ctx.lineTo(p.x + half, p.y);
      ctx.lineTo(p.x, p.y + half);
      ctx.lineTo(p.x - half, p.y);
      ctx.closePath();
      this._fillStroke(ctx, layer);
    }
  });
}

export const SquareMarker = (typeof L !== 'undefined' && L.CircleMarker) ? L.CircleMarker.extend({
  _updatePath() {
    if (this._renderer && this._renderer._updateSquare) {
      this._renderer._updateSquare(this);
    } else {
      L.CircleMarker.prototype._updatePath.call(this);
    }
  }
}) : null;

export const DiamondMarker = (typeof L !== 'undefined' && L.CircleMarker) ? L.CircleMarker.extend({
  _updatePath() {
    if (this._renderer && this._renderer._updateDiamond) {
      this._renderer._updateDiamond(this);
    } else {
      L.CircleMarker.prototype._updatePath.call(this);
    }
  }
}) : null;

export function xyToLatLng(origin, x, y) {
  const lat = origin.lat + y / 110540;
  const lon = origin.lon + x / (111320 * Math.cos(origin.lat * Math.PI / 180));
  return [lat, lon];
}

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

export class CadastralMap {
  constructor(elementId, sceneData, driveData, onStreetSelect, onCarSelect) {
    this.elementId = elementId;
    this.scene = sceneData;
    this.drive = driveData;
    this.origin = sceneData.origin;
    this.onStreetSelect = onStreetSelect;
    this.onCarSelect = onCarSelect;
    this.map = null;
    this.routeBounds = null;
    this.streetSegments = []; // { name, t0, t1, latlngs, polyline }
    this.allMarkers = []; // { track, marker, type }
    this.layers = {
      signs: null,
      parked: null,
      objects: null
    };
    this.layerVisibility = {
      signs: true,
      parked: true,
      objects: true
    };
    this.currentSignFilter = null;
    this.selectedStreet = null;
    this.selectedCar = null;
    this.selectedCarRing = null;
    this.selectedRouteLines = [];

    this.init();
  }

  init() {
    const mapEl = document.getElementById(this.elementId);
    if (!mapEl) return;

    this.map = L.map(this.elementId, {
      preferCanvas: true,
      attributionControl: false,
      zoomControl: true,
      boxZoom: false,
      zoomSnap: 0.1,
      zoomDelta: 0.5
    });

    window.addEventListener('resize', () => {
      if (this.map) {
        this.map.invalidateSize();
        if (this.routeBounds && this.routeBounds.isValid() && !this.selectedStreet) {
          const sz = this.map.getSize();
          if (sz && sz.x > 0 && sz.y > 0) {
            this.map.fitBounds(this.routeBounds, { padding: [16, 16] });
          }
        }
      }
    });

    this.map.on('zoomend', () => {
      this.updateMarkerSizes();
    });

    // Custom attribution (without the flag) and scale
    L.control.attribution({ position: 'bottomright', prefix: '<a href="https://leafletjs.com">Leaflet</a>' })
      .addTo(this.map)
      .addAttribution(this.scene.attribution || '© OpenStreetMap contributors, ODbL');

    L.control.scale({ imperial: false, position: 'bottomleft' })
      .addTo(this.map);

    this.renderBase();
    this.renderRoute();
    this.renderTracks();

    // Fit map tightly to route with small padding
    if (this.routeBounds) {
      this.map.fitBounds(this.routeBounds, { padding: [16, 16] });
    }
    this.updateMarkerSizes();
  }

  renderBase() {
    const origin = this.origin;
    const canvasRenderer = L.canvas();

    // 1. Areas
    if (this.scene.areas && Array.isArray(this.scene.areas)) {
      const greenKinds = new Set(['park', 'garden', 'grass', 'wood', 'pitch', 'playground', 'dog_park']);
      for (const area of this.scene.areas) {
        if (!area.pts || area.pts.length < 3) continue;
        const latlngs = area.pts.map(p => xyToLatLng(origin, p[0], p[1]));
        const isGreen = greenKinds.has(area.kind);
        const isWater = area.kind === 'water';
        const fillColor = isGreen ? '#e4eadc' : isWater ? '#dde6ee' : '#efeee9';

        L.polygon(latlngs, {
          fillColor,
          fillOpacity: 1,
          stroke: false,
          interactive: false,
          renderer: canvasRenderer
        }).addTo(this.map);
      }
    }

    // 2. Buildings
    if (this.scene.buildings && Array.isArray(this.scene.buildings)) {
      for (const bld of this.scene.buildings) {
        if (!bld.pts || bld.pts.length < 3) continue;
        const latlngs = bld.pts.map(p => xyToLatLng(origin, p[0], p[1]));
        L.polygon(latlngs, {
          fillColor: '#ebeae5',
          fillOpacity: 1,
          color: '#d6d5cf',
          weight: 1,
          interactive: false,
          renderer: canvasRenderer
        }).addTo(this.map);
      }
    }

    // 3. Roads (casing + white inner)
    if (this.scene.roads && Array.isArray(this.scene.roads)) {
      for (const road of this.scene.roads) {
        if (!road.pts || road.pts.length < 2) continue;
        const latlngs = road.pts.map(p => xyToLatLng(origin, p[0], p[1]));
        // Casing
        L.polyline(latlngs, {
          color: '#d9d8d2',
          weight: 4.5,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
          renderer: canvasRenderer
        }).addTo(this.map);
        // Inner white
        L.polyline(latlngs, {
          color: '#ffffff',
          weight: 2.5,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
          renderer: canvasRenderer
        }).addTo(this.map);
      }
    }

    // 4. Rails (thin dashed)
    if (this.scene.rails && Array.isArray(this.scene.rails)) {
      for (const rail of this.scene.rails) {
        if (!rail.pts || rail.pts.length < 2) continue;
        const latlngs = rail.pts.map(p => xyToLatLng(origin, p[0], p[1]));
        L.polyline(latlngs, {
          color: '#c4c3bd',
          weight: 1,
          dashArray: '4, 4',
          interactive: false,
          renderer: canvasRenderer
        }).addTo(this.map);
      }
    }
  }

  renderRoute() {
    const origin = this.origin;
    const r = this.drive.route;
    if (!r || !r.x || !r.y || !r.t) return;

    const xs = r.x;
    const ys = r.y;
    const ts = r.t;
    const n = xs.length;
    if (n < 2) return;

    const fullLatLngs = [];
    for (let i = 0; i < n; i++) {
      fullLatLngs.push(xyToLatLng(origin, xs[i], ys[i]));
    }
    this.routeBounds = L.latLngBounds(fullLatLngs);

    const streets = this.drive.streets || [];
    // Helper to find street at time t
    const getStreetAtTime = (t) => {
      for (const s of streets) {
        if (t >= s.t0 && t <= s.t1) return s.name;
      }
      return null;
    };

    // Break route into continuous chunks (named vs unread)
    let currentChunk = [fullLatLngs[0]];
    let currentStreet = getStreetAtTime(ts[0]);

    for (let i = 1; i < n; i++) {
      const st = getStreetAtTime(ts[i]);
      if (st === currentStreet) {
        currentChunk.push(fullLatLngs[i]);
      } else {
        // flush previous chunk
        this._drawRouteChunk(currentChunk, currentStreet, origin);
        // start new chunk from boundary point
        currentChunk = [fullLatLngs[i - 1], fullLatLngs[i]];
        currentStreet = st;
      }
    }
    if (currentChunk.length >= 2) {
      this._drawRouteChunk(currentChunk, currentStreet, origin);
    }

    // Store street polyline latlngs for each street segment
    for (const s of streets) {
      const segLatLngs = [];
      for (let i = 0; i < n; i++) {
        if (ts[i] >= s.t0 && ts[i] <= s.t1) {
          segLatLngs.push(fullLatLngs[i]);
        }
      }
      if (segLatLngs.length >= 2) {
        this.streetSegments.push({
          name: s.name,
          t0: s.t0,
          t1: s.t1,
          latlngs: segLatLngs
        });
      }
    }

    // Start marker (open ink ring)
    const startPoint = fullLatLngs[0];
    const startMarker = L.circleMarker(startPoint, {
      radius: 5,
      color: '#1c1e21',
      weight: 2,
      fillColor: '#ffffff',
      fillOpacity: 1
    }).addTo(this.map);
    startMarker.bindTooltip('Start 00:00', { permanent: false, direction: 'top' });

    // End marker (filled ink square)
    const endPoint = fullLatLngs[n - 1];
    const endDuration = formatTime(this.drive.duration_s || ts[n - 1]);
    const endMarker = new SquareMarker(endPoint, {
      size: 9,
      color: '#1c1e21',
      weight: 1,
      fillColor: '#1c1e21',
      fillOpacity: 1
    }).addTo(this.map);
    endMarker.bindTooltip(`End ${endDuration}`, { permanent: false, direction: 'top' });
  }

  _drawRouteChunk(latlngs, streetName, origin) {
    if (latlngs.length < 2) return;
    const isNamed = streetName !== null;

    // 1px paper-white casing around the 3px ink route line so it reads through
    L.polyline(latlngs, {
      color: '#fafaf7',
      weight: 5,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false
    }).addTo(this.map);

    const line = L.polyline(latlngs, {
      color: '#1c1e21',
      weight: 3,
      dashArray: isNamed ? null : '5, 5',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.map);

    // Hover tooltip: street name + clock time
    line.on('mouseover', (e) => {
      const label = isNamed ? streetName : 'Street not read';
      line.bindTooltip(label, { sticky: true }).openTooltip(e.latlng);
    });
    if (isNamed) {
      line.on('click', () => {
        if (this.onStreetSelect) {
          this.onStreetSelect(streetName);
        }
      });
    }
  }

  renderTracks() {
    const origin = this.origin;
    this.layers.signs = L.layerGroup().addTo(this.map);
    this.layers.parked = L.layerGroup().addTo(this.map);
    this.layers.objects = L.layerGroup().addTo(this.map);

    const tracks = this.drive.tracks || [];

    for (const tr of tracks) {
      if (!tr.xy || tr.xy.length < 2) continue;
      const latlng = xyToLatLng(origin, tr.xy[0], tr.xy[1]);
      const street = tr.street || 'street not read';
      const timeStr = formatTime(tr.t0);
      const timeRange = (tr.t1 != null && tr.t1 !== tr.t0)
        ? `${formatTime(tr.t0)}–${formatTime(tr.t1)}`
        : timeStr;
      const conf = (tr.score != null) ? tr.score.toFixed(2) : '—';
      const nDetections = tr.n_tracks || 1;

      if (tr.kind === 'sign') {
        const label = formatClsLabel(tr.cls);
        const marker = L.circleMarker(latlng, {
          radius: 2,
          fillColor: '#c8102e',
          fillOpacity: 1,
          color: '#ffffff',
          weight: 1
        });

        marker.bindPopup(`
          <div><strong>${label}</strong> · ${street}</div>
          <div style="color:#4a4d52;margin-top:2px;">seen ${timeRange} · confidence ${conf} · merged from ${nDetections} detections · position estimated</div>
        `);

        this.layers.signs.addLayer(marker);
        this.allMarkers.push({ track: tr, marker, type: 'signs', defaultColor: '#c8102e' });

      } else if (tr.kind === 'vehicle' && tr.cls === 'car' && tr.state === 'parked') {
        const marker = new SquareMarker(latlng, {
          size: 4,
          fillColor: '#1f5fbf',
          fillOpacity: 1,
          color: '#ffffff',
          weight: 1
        });

        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          if (this.onCarSelect) {
            this.onCarSelect(tr);
          }
        });

        this.layers.parked.addLayer(marker);
        this.allMarkers.push({ track: tr, marker, type: 'parked', defaultColor: '#1f5fbf' });
      } else if (tr.kind === 'object' || (tr.kind === 'vehicle' && tr.cls !== 'car')) {
        const objLabel = formatClsLabel(tr.cls);
        const marker = new DiamondMarker(latlng, {
          size: 4,
          fillColor: '#2f8a4c',
          fillOpacity: 1,
          color: '#ffffff',
          weight: 1
        });

        marker.bindPopup(`
          <div><strong>${objLabel}</strong> · moving · ${street}</div>
          <div style="color:#4a4d52;margin-top:2px;">seen ${timeStr} · position estimated</div>
        `);

        this.layers.objects.addLayer(marker);
        this.allMarkers.push({ track: tr, marker, type: 'objects', defaultColor: '#2f8a4c' });
      }
    }
  }

  updateMarkerSizes() {
    if (!this.map) return;
    const z = this.map.getZoom();
    const isStreetZoom = z >= 15;
    const signR = isStreetZoom ? 3.5 : (z <= 13 ? 2 : 2.5);
    const shapeSize = isStreetZoom ? 7 : (z <= 13 ? 4 : 5);

    for (const item of this.allMarkers) {
      if (item.type === 'signs') {
        item.marker.setRadius(signR);
      } else {
        item.marker.options.size = shapeSize;
        item.marker.redraw();
      }
    }

    if (this.selectedCarRing) {
      this.selectedCarRing.setRadius(isStreetZoom ? 9 : 7);
    }
  }

  setLayerVisible(type, visible) {
    this.layerVisibility[type] = visible;
    const group = this.layers[type];
    if (!group) return;
    if (visible) {
      if (!this.map.hasLayer(group)) this.map.addLayer(group);
    } else {
      if (this.map.hasLayer(group)) this.map.removeLayer(group);
    }
  }

  setSignFilter(filterCls) {
    this.currentSignFilter = filterCls;
    for (const item of this.allMarkers) {
      if (item.type !== 'signs') continue;
      const match = !filterCls || item.track.cls === filterCls;
      if (match) {
        if (!this.layers.signs.hasLayer(item.marker)) {
          this.layers.signs.addLayer(item.marker);
        }
      } else {
        if (this.layers.signs.hasLayer(item.marker)) {
          this.layers.signs.removeLayer(item.marker);
        }
      }
    }
  }

  selectStreet(streetName) {
    this.selectedStreet = streetName;

    // Clear previous violet route lines
    for (const line of this.selectedRouteLines) {
      this.map.removeLayer(line);
    }
    this.selectedRouteLines = [];

    if (!streetName) {
      // Restore all markers to full opacity
      for (const item of this.allMarkers) {
        item.marker.setStyle({
          fillOpacity: 1.0,
          opacity: 1.0
        });
      }
      if (this.routeBounds) {
        this.map.fitBounds(this.routeBounds, { padding: [16, 16] });
      }
      return;
    }

    // Highlight selected street's route sections in violet 5px
    const matchingSegs = this.streetSegments.filter(s => s.name === streetName);
    const bounds = L.latLngBounds();

    for (const seg of matchingSegs) {
      const vLine = L.polyline(seg.latlngs, {
        color: '#5b3fa6',
        weight: 5,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(this.map);
      this.selectedRouteLines.push(vLine);
      bounds.extend(vLine.getBounds());
    }

    // Dim marks on other streets to ~30% opacity
    for (const item of this.allMarkers) {
      const isOnStreet = item.track.street === streetName;
      const isSelectedCar = this.selectedCar && item.track.id === this.selectedCar.id;
      const fullOpacity = isOnStreet || isSelectedCar;
      item.marker.setStyle({
        fillOpacity: fullOpacity ? 1.0 : 0.3,
        opacity: fullOpacity ? 1.0 : 0.3
      });
    }

    if (bounds.isValid()) {
      this.map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
    }
  }

  selectCar(carTrack) {
    if (this.selectedCarRing) {
      this.map.removeLayer(this.selectedCarRing);
      this.selectedCarRing = null;
    }
    this.selectedCar = carTrack;
    if (!carTrack || !carTrack.xy) return;

    const latlng = xyToLatLng(this.origin, carTrack.xy[0], carTrack.xy[1]);
    const z = this.map ? this.map.getZoom() : 14;
    const r = (z >= 15) ? 9 : 7;
    this.selectedCarRing = L.circleMarker(latlng, {
      radius: r,
      color: '#5b3fa6',
      weight: 2.5,
      fillColor: 'transparent',
      fillOpacity: 0,
      interactive: false
    }).addTo(this.map);

    for (const item of this.allMarkers) {
      if (item.track && item.track.id === carTrack.id) {
        item.marker.setStyle({ fillOpacity: 1.0, opacity: 1.0 });
      }
    }
  }
}
