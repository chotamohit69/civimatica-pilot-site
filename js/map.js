import { state } from './state.js';
import { getSignFamily, formatTime } from './data.js';

export class MapSection {
  constructor(container) {
    this.container = container;
    this.map = null;
    this.egoMarker = null;
    this.routePolylines = [];
    this.markersLayer = null;

    state.on('dataLoaded', () => this.initMap());
    state.on('timeUpdate', () => this.updateEgoMarker());
    state.on('sectionChange', (sec) => {
      if (sec === 'map' && this.map) {
        setTimeout(() => {
          this.map.invalidateSize();
          if (this.bounds) this.map.fitBounds(this.bounds, { padding: [50, 50] });
        }, 100);
      }
    });
  }

  xyToLatLon(x, y) {
    const origin = state.scene && state.scene.origin ? state.scene.origin : { lat: 45.478, lon: 9.176 };
    const lat0 = origin.lat, lon0 = origin.lon;
    const lat = lat0 + y / 110540.0;
    const lon = lon0 + x / (111320.0 * Math.cos((lat0 * Math.PI) / 180.0));
    return [lat, lon];
  }

  initMap() {
    this.container.innerHTML = `
      <div id="leaflet-map" class="leaflet-map-wrap"></div>
      <div class="map-legend">
        <div style="font-weight: 700; margin-bottom: 0.5rem; color: #FFFFFF;">Map Legend</div>
        <div class="legend-item"><span class="legend-swatch" style="background: #FFFFFF; border: 2px solid #2BB3A3;"></span> Ego Vehicle</div>
        <div class="legend-item"><span class="legend-swatch" style="background: #3D7BD9;"></span> Reconstructed Route</div>
        <div class="legend-item"><span class="legend-swatch" style="background: #E8A33D;"></span> Parked Vehicles</div>
        <div class="legend-item"><span class="legend-swatch" style="background: #D9483B;"></span> Prohibitory Signs</div>
        <div class="legend-item"><span class="legend-swatch" style="background: #2F6FDE;"></span> Mandatory Signs</div>
        <div class="legend-item"><span class="legend-swatch" style="background: #F2C14E;"></span> Warning Signs</div>
      </div>
    `;

    const scene = state.scene;
    const drive = state.drive;
    if (!scene) return;

    const origin = scene.origin || { lat: 45.4782, lon: 9.1764 };

    // Initialize Leaflet
    if (this.map) {
      this.map.remove();
    }

    this.map = L.map('leaflet-map', {
      center: [origin.lat, origin.lon],
      zoom: 16,
      zoomControl: true
    });

    // Dark / Carto style or Standard OSM tiles with attribution
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ODbL 1.0',
      maxZoom: 19
    }).addTo(this.map);

    this.markersLayer = L.layerGroup().addTo(this.map);

    // Build route polyline
    this.buildRoutePolyline();

    // Build sign and vehicle markers
    this.buildTrackMarkers();

    // Create current ego marker
    const egoIcon = L.divIcon({
      className: 'ego-leaflet-icon',
      html: `<div style="width: 18px; height: 18px; background: #2BB3A3; border: 3px solid #FFFFFF; border-radius: 50%; box-shadow: 0 0 10px rgba(43, 179, 163, 0.9);"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    const initCoord = this.xyToLatLon(drive.route.x[0] || 0, drive.route.y[0] || 0);
    this.egoMarker = L.marker(initCoord, { icon: egoIcon, zIndexOffset: 1000 }).addTo(this.map);

    this.updateEgoMarker();
  }

  buildRoutePolyline() {
    const drive = state.drive;
    if (!drive || !drive.route || !drive.route.x) return;

    const rx = drive.route.x;
    const ry = drive.route.y;
    const rt = drive.route.t;
    const latlngs = [];

    for (let i = 0; i < rx.length; i++) {
      latlngs.push(this.xyToLatLon(rx[i], ry[i]));
    }

    // Outer glow
    L.polyline(latlngs, {
      color: '#2BB3A3',
      weight: 8,
      opacity: 0.3
    }).addTo(this.map);

    // Main line
    const mainLine = L.polyline(latlngs, {
      color: '#3D7BD9',
      weight: 4,
      opacity: 0.9
    }).addTo(this.map);

    // Click anywhere on polyline to seek to that location
    mainLine.on('click', (e) => {
      const clickLL = e.latlng;
      let closestIdx = 0, minDist = Infinity;
      for (let i = 0; i < latlngs.length; i++) {
        const d = clickLL.distanceTo(latlngs[i]);
        if (d < minDist) {
          minDist = d;
          closestIdx = i;
        }
      }
      if (rt && rt[closestIdx] !== undefined) {
        state.setTime(rt[closestIdx]);
      }
    });

    if (latlngs.length > 0) {
      this.bounds = L.latLngBounds(latlngs);
      this.map.fitBounds(this.bounds, { padding: [50, 50] });
    }
  }

  buildTrackMarkers() {
    const drive = state.drive;
    if (!drive || !drive.tracks) return;

    this.markersLayer.clearLayers();

    for (const trk of drive.tracks) {
      let x = 0, y = 0;
      if (trk.fixed) {
        x = trk.fixed[0];
        y = trk.fixed[1];
      } else if (trk.pos && trk.pos.length > 0) {
        x = trk.pos[0][1];
        y = trk.pos[0][2];
      } else {
        continue;
      }

      const coord = this.xyToLatLon(x, y);

      if (trk.kind === 'sign') {
        const fam = getSignFamily(trk.cls);
        const marker = L.circleMarker(coord, {
          radius: 6,
          fillColor: fam.color,
          color: '#FFFFFF',
          weight: 1.5,
          opacity: 1,
          fillOpacity: 0.85
        });

        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px; color: #111;">
            <strong style="color:${fam.color}; text-transform:uppercase;">${trk.cls.replace(/_/g, ' ')}</strong><br>
            <span>Family: ${fam.label}</span><br>
            <span>Street: ${trk.street || 'Street network'}</span><br>
            <span>Time seen: ${formatTime(trk.t0)}</span><br>
            <span>Confidence: ${(trk.score * 100).toFixed(1)}%</span><br>
            <button style="margin-top: 6px; padding: 4px 8px; background: #3D7BD9; color: #fff; border: none; border-radius: 4px; cursor: pointer;"
              onclick="window.civimaticaSeek(${trk.t0})">
              Jump to ${formatTime(trk.t0)}
            </button>
          </div>
        `);
        this.markersLayer.addLayer(marker);
      } else if (trk.kind === 'vehicle' && trk.state === 'parked') {
        const marker = L.circleMarker(coord, {
          radius: 5,
          fillColor: '#E8A33D',
          color: '#FFFFFF',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8
        });

        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px; color: #111;">
            <strong style="color:#E8A33D;">PARKED VEHICLE</strong><br>
            <span>Class: ${trk.cls}</span><br>
            <span>Confirmed: ${trk.confirmed ? 'Yes' : 'No'}</span><br>
            <span>Street: ${trk.street || 'Street network'}</span><br>
            <span>First seen: ${formatTime(trk.t0)}</span><br>
            <button style="margin-top: 6px; padding: 4px 8px; background: #E8A33D; color: #000; font-weight:600; border: none; border-radius: 4px; cursor: pointer;"
              onclick="window.civimaticaSeek(${trk.t0})">
              Jump to ${formatTime(trk.t0)}
            </button>
          </div>
        `);
        this.markersLayer.addLayer(marker);
      }
    }

    // Expose global seek helper for Leaflet popups
    window.civimaticaSeek = (t) => {
      state.setTime(t);
    };
  }

  updateEgoMarker() {
    if (!this.egoMarker) return;
    const ego = state.getEgoAt(state.t);
    const coord = this.xyToLatLon(ego.x, ego.y);
    this.egoMarker.setLatLng(coord);
  }
}
