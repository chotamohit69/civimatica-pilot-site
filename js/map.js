import { state } from './state.js';
import { getSignFamily, formatTime } from './data.js';

const STREET_PALETTE = [
  '#3D7BD9', '#2BB3A3', '#E8A33D', '#9B59B6', '#3498DB',
  '#E67E22', '#1ABC9C', '#F1C40F', '#E74C3C', '#2ECC71'
];

export class MapSection {
  constructor(container) {
    this.container = container;
    this.map = null;
    this.egoMarker = null;
    this.markersLayer = null;
    this.bounds = null;

    state.on('dataLoaded', () => this.initMap());
    state.on('timeUpdate', () => this.updateEgoMarker());
    state.on('sectionChange', (sec) => {
      if (sec === 'map' && this.map) {
        requestAnimationFrame(() => {
          this.map.invalidateSize();
          if (this.bounds) this.map.fitBounds(this.bounds, { padding: [40, 40] });
        });
        setTimeout(() => {
          if (this.map) {
            this.map.invalidateSize();
          }
        }, 120);
      }
    });
  }

  xyToLatLon(x, y) {
    const origin = (state.scene && state.scene.origin) ? state.scene.origin : { lat: 45.478, lon: 9.176 };
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
        <div class="legend-item"><span class="legend-swatch" style="background: #2BB3A3; border: 2px solid #FFFFFF;"></span> Ego Vehicle</div>
        <div class="legend-item"><span class="legend-swatch" style="background: #3D7BD9;"></span> Route by Street</div>
        <div class="legend-item"><span class="legend-swatch" style="background: #E8A33D;"></span> Parked (Confirmed)</div>
        <div class="legend-item"><span class="legend-swatch" style="background: #D9483B;"></span> Prohibitory Signs</div>
        <div class="legend-item"><span class="legend-swatch" style="background: #2F6FDE;"></span> Mandatory Signs</div>
        <div class="legend-item"><span class="legend-swatch" style="background: #F2C14E;"></span> Warning Signs</div>
      </div>
    `;

    const scene = state.scene;
    const drive = state.drive;
    if (!scene || !drive) return;

    const origin = scene.origin || { lat: 45.4782, lon: 9.1764 };

    if (this.map) {
      this.map.remove();
    }

    this.map = L.map('leaflet-map', {
      center: [origin.lat, origin.lon],
      zoom: 15,
      zoomControl: true
    });

    // OSM Tiles with attribution
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, ODbL 1.0',
      maxZoom: 19
    }).addTo(this.map);

    this.markersLayer = L.layerGroup().addTo(this.map);

    // Build route coloured by street
    this.buildStreetRoutePolylines();

    // Build sign and vehicle markers (limited for smooth rendering)
    this.buildTrackMarkers();

    // Create ego vehicle marker
    const egoIcon = L.divIcon({
      className: 'ego-leaflet-icon',
      html: `<div style="width: 18px; height: 18px; background: #2BB3A3; border: 3px solid #FFFFFF; border-radius: 50%; box-shadow: 0 0 12px rgba(43, 179, 163, 1);"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    const initCoord = this.xyToLatLon(drive.route.x[0] || 0, drive.route.y[0] || 0);
    this.egoMarker = L.marker(initCoord, { icon: egoIcon, zIndexOffset: 1000 }).addTo(this.map);

    this.updateEgoMarker();
  }

  buildStreetRoutePolylines() {
    const drive = state.drive;
    if (!drive || !drive.route || !drive.route.x) return;

    const rx = drive.route.x;
    const ry = drive.route.y;
    const rt = drive.route.t;
    const allLatLngs = [];

    // Complete background glow line
    for (let i = 0; i < rx.length; i++) {
      allLatLngs.push(this.xyToLatLon(rx[i], ry[i]));
    }

    if (allLatLngs.length > 0) {
      this.bounds = L.latLngBounds(allLatLngs);
      this.map.fitBounds(this.bounds, { padding: [40, 40] });
    }

    L.polyline(allLatLngs, {
      color: '#1A202C',
      weight: 8,
      opacity: 0.6
    }).addTo(this.map);

    // If streets are defined, color route segments by street
    const streets = drive.streets || [];
    if (streets.length > 0) {
      streets.forEach((st, idx) => {
        const segLatLngs = [];
        const segTimes = [];
        const col = STREET_PALETTE[idx % STREET_PALETTE.length];

        for (let i = 0; i < rt.length; i++) {
          if (rt[i] >= st.t0 && rt[i] <= st.t1) {
            segLatLngs.push(allLatLngs[i]);
            segTimes.push(rt[i]);
          }
        }

        if (segLatLngs.length > 1) {
          const poly = L.polyline(segLatLngs, {
            color: col,
            weight: 5,
            opacity: 0.95
          }).addTo(this.map);

          poly.bindTooltip(st.name, { sticky: true });

          poly.on('click', (e) => {
            const clickLL = e.latlng;
            let closestIdx = 0, minDist = Infinity;
            for (let j = 0; j < segLatLngs.length; j++) {
              const d = clickLL.distanceTo(segLatLngs[j]);
              if (d < minDist) {
                minDist = d;
                closestIdx = j;
              }
            }
            if (segTimes[closestIdx] !== undefined) {
              state.setTime(segTimes[closestIdx]);
            }
          });
        }
      });
    } else {
      // Fallback single colored polyline
      const poly = L.polyline(allLatLngs, {
        color: '#3D7BD9',
        weight: 5,
        opacity: 0.9
      }).addTo(this.map);

      poly.on('click', (e) => {
        const clickLL = e.latlng;
        let closestIdx = 0, minDist = Infinity;
        for (let i = 0; i < allLatLngs.length; i++) {
          const d = clickLL.distanceTo(allLatLngs[i]);
          if (d < minDist) {
            minDist = d;
            closestIdx = i;
          }
        }
        if (rt[closestIdx] !== undefined) {
          state.setTime(rt[closestIdx]);
        }
      });
    }
  }

  buildTrackMarkers() {
    const drive = state.drive;
    if (!drive || !drive.tracks) return;

    this.markersLayer.clearLayers();

    // Filter and limit markers to keep map responsive
    const allSigns = drive.tracks.filter(t => t.kind === 'sign');
    const allParked = drive.tracks.filter(t => t.kind === 'vehicle' && t.state === 'parked' && t.confirmed);

    // Sample signs evenly if many
    const signStep = Math.max(1, Math.floor(allSigns.length / 250));
    const sampledSigns = [];
    for (let i = 0; i < allSigns.length; i += signStep) {
      sampledSigns.push(allSigns[i]);
    }

    // Sample parked cars
    const parkedStep = Math.max(1, Math.floor(allParked.length / 150));
    const sampledParked = [];
    for (let i = 0; i < allParked.length; i += parkedStep) {
      sampledParked.push(allParked[i]);
    }

    const markersToRender = [...sampledSigns, ...sampledParked];

    for (const trk of markersToRender) {
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
          radius: 5,
          fillColor: fam.color,
          color: '#FFFFFF',
          weight: 1.5,
          opacity: 1,
          fillOpacity: 0.85
        });

        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px; color: #111; line-height: 1.4;">
            <strong style="color:${fam.color}; text-transform:uppercase;">${trk.cls.replace(/_/g, ' ')}</strong><br>
            <span>Family: ${fam.label}</span><br>
            <span>Street: ${trk.street || 'Street network'}</span><br>
            <span>Time: ${formatTime(trk.t0)}</span><br>
            <span>Confidence: ${(trk.score * 100).toFixed(1)}%</span><br>
            <button style="margin-top: 6px; padding: 4px 8px; background: #3D7BD9; color: #fff; border: none; border-radius: 4px; cursor: pointer;"
              onclick="window.civimaticaMapJump('${trk.id}', ${trk.t0})">
              Seek to ${formatTime(trk.t0)} ↗
            </button>
          </div>
        `);
        this.markersLayer.addLayer(marker);
      } else if (trk.kind === 'vehicle' && trk.state === 'parked') {
        const marker = L.circleMarker(coord, {
          radius: 4.5,
          fillColor: '#E8A33D',
          color: '#FFFFFF',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.85
        });

        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px; color: #111; line-height: 1.4;">
            <strong style="color:#E8A33D;">CONFIRMED PARKED</strong><br>
            <span>Class: ${trk.cls}</span><br>
            <span>Street: ${trk.street || 'Street network'}</span><br>
            <span>Time: ${formatTime(trk.t0)}</span><br>
            <button style="margin-top: 6px; padding: 4px 8px; background: #E8A33D; color: #000; font-weight:600; border: none; border-radius: 4px; cursor: pointer;"
              onclick="window.civimaticaMapJump('${trk.id}', ${trk.t0})">
              Seek to ${formatTime(trk.t0)} ↗
            </button>
          </div>
        `);
        this.markersLayer.addLayer(marker);
      }
    }

    window.civimaticaMapJump = (trackId, t) => {
      state.setTime(t);
      const trk = drive.tracks.find(x => x.id === trackId);
      if (trk) {
        state.selectObject(trk);
      }
    };
  }

  updateEgoMarker() {
    if (!this.egoMarker) return;
    const ego = state.getEgoAt(state.t);
    const coord = this.xyToLatLon(ego.x, ego.y);
    this.egoMarker.setLatLng(coord);
  }
}
