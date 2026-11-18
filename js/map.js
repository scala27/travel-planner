import { CATEGORY_STYLES, DAY_COLORS } from './config.js';
import { state, showToast } from './state.js';
import { estimateLegTransit } from './ui-board.js';

let mapInstance = null;
let markersLayerGroup = null;
let routesLayerGroup = null;
const markerByCardId = {};
const osrmRouteCache = {};

const YUI_RAIL_STATIONS = [
  { name: '那霸機場', lat: 26.2065, lng: 127.6523 },
  { name: '赤嶺', lat: 26.1932, lng: 127.6605 },
  { name: '小祿', lat: 26.1964, lng: 127.6670 },
  { name: '奧武山公園', lat: 26.2007, lng: 127.6752 },
  { name: '壺川', lat: 26.2059, lng: 127.6787 },
  { name: '旭橋', lat: 26.2121, lng: 127.6755 },
  { name: '縣廳前', lat: 26.2145, lng: 127.6793 },
  { name: '美榮橋', lat: 26.2192, lng: 127.6844 },
  { name: '牧志', lat: 26.2173, lng: 127.6924 },
  { name: '安里', lat: 26.2167, lng: 127.6958 },
  { name: '歌町', lat: 26.2229, lng: 127.6983 },
  { name: '古島', lat: 26.2308, lng: 127.7031 },
  { name: '市立病院前', lat: 26.2275, lng: 127.7101 },
  { name: '儀保', lat: 26.2246, lng: 127.7191 },
  { name: '首里', lat: 26.2191, lng: 127.7255 },
  { name: '石嶺', lat: 26.2266, lng: 127.7294 },
  { name: '經塚', lat: 26.2356, lng: 127.7281 },
  { name: '浦添前田', lat: 26.2442, lng: 127.7317 },
  { name: '日子浦西', lat: 26.2419, lng: 127.7418 }
];

// 精準貼合沖繩都市單軌（Yui Rail）高架轉彎與跨河軌道之高密度幾何座標 [lng, lat]
const YUI_RAIL_DENSE_COORDS = [
  [127.6523, 26.2065], [127.6524, 26.2045], [127.6528, 26.2022], [127.6536, 26.1998],
  [127.6551, 26.1972], [127.6572, 26.1948], [127.6591, 26.1936], [127.6605, 26.1932],
  [127.6626, 26.1939], [127.6649, 26.1951], [127.6670, 26.1964], [127.6695, 26.1977],
  [127.6724, 26.1991], [127.6752, 26.2007], [127.6774, 26.2024], [127.6786, 26.2041],
  [127.6787, 26.2059], [127.6776, 26.2078], [127.6761, 26.2098], [127.6755, 26.2121],
  [127.6766, 26.2134], [127.6781, 26.2140], [127.6793, 26.2145], [127.6808, 26.2158],
  [127.6825, 26.2175], [127.6844, 26.2192], [127.6866, 26.2194], [127.6894, 26.2185],
  [127.6924, 26.2173], [127.6943, 26.2168], [127.6958, 26.2167], [127.6968, 26.2188],
  [127.6976, 26.2209], [127.6983, 26.2229], [127.6998, 26.2261], [127.7016, 26.2289],
  [127.7031, 26.2308], [127.7056, 26.2301], [127.7081, 26.2288], [127.7101, 26.2275],
  [127.7134, 26.2263], [127.7165, 26.2254], [127.7191, 26.2246], [127.7215, 26.2226],
  [127.7236, 26.2207], [127.7255, 26.2191], [127.7271, 26.2224], [127.7284, 26.2248],
  [127.7294, 26.2266], [127.7290, 26.2312], [127.7281, 26.2356], [127.7296, 26.2401],
  [127.7317, 26.2442], [127.7365, 26.2433], [127.7418, 26.2419]
];

const YUI_TRACK_CACHE_KEY = 'echi_yui_rail_osm_geometry_v1';
let yuiRailTrackLine = null;
let yuiTrackLoadingPromise = null;

function buildFallbackTrackLine() {
  if (typeof turf === 'undefined') return null;
  return turf.lineString(YUI_RAIL_DENSE_COORDS);
}

// 從 OpenStreetMap Overpass API 取得真實單軌高架軌道幾何並快取於本機
async function getYuiRailTrackLine() {
  if (yuiRailTrackLine) return yuiRailTrackLine;
  if (typeof turf === 'undefined') return null;

  try {
    const cached = localStorage.getItem(YUI_TRACK_CACHE_KEY);
    if (cached) {
      const coords = JSON.parse(cached);
      if (Array.isArray(coords) && coords.length > 40) {
        yuiRailTrackLine = turf.lineString(coords);
        return yuiRailTrackLine;
      }
    }
  } catch (e) {}

  if (!yuiTrackLoadingPromise) {
    yuiTrackLoadingPromise = (async () => {
      try {
        const query = `[out:json][timeout:12];way["railway"="monorail"](26.185,127.645,26.252,127.752);out geom;`;
        const res = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: query
        });
        const data = await res.json();
        const ways = (data.elements || []).filter(el => el.type === 'way' && Array.isArray(el.geometry));
        if (ways.length > 0) {
          // 依東向順序串接所有單軌軌道節點
          const segments = ways.map(w => w.geometry.map(pt => [pt.lon, pt.lat]));
          segments.sort((a, b) => Math.min(a[0][0], a[a.length - 1][0]) - Math.min(b[0][0], b[b.length - 1][0]));
          const stitched = [];
          segments.forEach(seg => {
            const ordered = seg[0][0] <= seg[seg.length - 1][0] ? seg : [...seg].reverse();
            ordered.forEach(pt => {
              if (stitched.length === 0) {
                stitched.push(pt);
              } else {
                const prev = stitched[stitched.length - 1];
                const dist = Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
                if (dist > 0.00003 && dist < 0.015) {
                  stitched.push(pt);
                }
              }
            });
          });
          if (stitched.length > 40) {
            localStorage.setItem(YUI_TRACK_CACHE_KEY, JSON.stringify(stitched));
            yuiRailTrackLine = turf.lineString(stitched);
            return yuiRailTrackLine;
          }
        }
      } catch (e) {}
      yuiRailTrackLine = buildFallbackTrackLine();
      return yuiRailTrackLine;
    })();
  }

  return yuiTrackLoadingPromise;
}

export function initLeafletMap() {
  const container = document.getElementById('mapContainer');
  if (!container || typeof L === 'undefined') return;

  if (mapInstance) {
    mapInstance.remove();
  }

  mapInstance = L.map(container, {
    center: [26.2124, 127.6792],
    zoom: 11,
    zoomControl: true
  });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(mapInstance);

  routesLayerGroup = L.layerGroup().addTo(mapInstance);
  markersLayerGroup = L.layerGroup().addTo(mapInstance);
  getYuiRailTrackLine();
}

export function invalidateMapSize() {
  if (mapInstance) {
    mapInstance.invalidateSize();
  }
}

export function renderMapCategoryToggles() {
  const container = document.getElementById('mapCategoryToggleContainer');
  if (!container) return;

  container.innerHTML = Object.entries(CATEGORY_STYLES)
    .map(([cat, style]) => {
      const visible = state.visibleMapLayers[cat] !== false;
      return `
        <button type="button" onclick="toggleMapCategoryLayer('${cat}')"
          class="px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center gap-1 border transition ${
            visible
              ? 'bg-white border-slate-300 text-slate-800 shadow-2xs'
              : 'bg-slate-100 border-slate-200 text-slate-400 opacity-60'
          }">
          <span class="w-2 h-2 rounded-full" style="background:${visible ? style.hex : '#94a3b8'}"></span>
          <span>${cat}</span>
        </button>
      `;
    })
    .join('');
}

export function toggleMapCategoryLayer(category) {
  state.visibleMapLayers[category] = !(state.visibleMapLayers[category] !== false);
  renderMapCategoryToggles();
  renderMapMarkers();
}

export function setOnlyAttractionsLayer() {
  Object.keys(CATEGORY_STYLES).forEach(cat => {
    state.visibleMapLayers[cat] = cat === '景點';
  });
  renderMapCategoryToggles();
  renderMapMarkers();
}

export function setAllMapLayersVisible(visible = true) {
  Object.keys(CATEGORY_STYLES).forEach(cat => {
    state.visibleMapLayers[cat] = visible;
  });
  renderMapCategoryToggles();
  renderMapMarkers();
}

export function toggleOverlayPocketOnPlanMap() {
  state.overlayPocketOnPlan = !state.overlayPocketOnPlan;
  const btn = document.getElementById('btnOverlayPocket');
  const txt = document.getElementById('overlayPocketStatusText');
  if (btn && txt) {
    if (state.overlayPocketOnPlan) {
      btn.className = 'px-2 py-1 rounded-lg border border-[#2C4D6E] bg-[#2C4D6E] text-white text-[11px] font-bold flex items-center gap-1 transition';
      txt.textContent = '疊加中';
    } else {
      btn.className = 'px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-blue-50 text-slate-700 text-[11px] font-semibold flex items-center gap-1 transition';
      txt.textContent = '疊加口袋';
    }
  }
  renderMapMarkers();
}

function createPinIcon(hexColor, labelText = '', isScheduled = false) {
  const size = isScheduled ? 28 : 22;
  return L.divIcon({
    className: 'custom-map-pin',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `
      <div style="
        width:${size}px;
        height:${size}px;
        border-radius:9999px;
        background:${hexColor};
        color:#ffffff;
        border:2.5px solid #ffffff;
        box-shadow:0 2px 6px rgba(15,23,42,0.35);
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:${isScheduled ? '11px' : '9px'};
        font-weight:800;
      ">${labelText}</div>
    `
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function attachSpotTooltipAndPopup(marker, card, prefixTag = '') {
  const style = CATEGORY_STYLES[card.category] || CATEGORY_STYLES['景點'];
  const descRaw = (card.notes || '').trim();
  const shortDesc = descRaw.length > 95 ? `${descRaw.slice(0, 95)}...` : descRaw;

  const tooltipHtml = `
    <div style="min-width:190px;max-width:260px;white-space:normal;line-height:1.45;padding:2px 0;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:3px;">
        <strong style="font-size:12px;color:#0f172a;">${escapeHtml(prefixTag)}${escapeHtml(card.title)}</strong>
        <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px;background:${style.hex}18;color:${style.hex};flex-shrink:0;">
          ${escapeHtml(card.category)}
        </span>
      </div>
      <div style="font-size:11px;color:#64748b;margin-bottom:${shortDesc ? '4px' : '0'};">
        ${escapeHtml(card.district || card.country || '')}・⏱ 停留 ${card.duration || 60} 分
      </div>
      ${shortDesc ? `<div style="font-size:11px;color:#334155;border-top:1px solid #e2e8f0;padding-top:4px;">${escapeHtml(shortDesc)}</div>` : ''}
    </div>
  `;

  marker.bindTooltip(tooltipHtml, {
    direction: 'top',
    offset: [0, -10],
    opacity: 0.97
  });

  const popupHtml = `
    <div class="text-xs space-y-1.5" style="min-width:200px;max-width:270px;">
      <div class="font-bold text-slate-800 text-sm">${escapeHtml(prefixTag)}${escapeHtml(card.title)}</div>
      <div class="text-slate-500">${escapeHtml(card.category)}・${escapeHtml(card.district || card.country || '')}・停留 ${card.duration || 60} 分</div>
      ${descRaw ? `<p class="text-slate-600 leading-relaxed max-h-28 overflow-y-auto border-t border-slate-100 pt-1">${escapeHtml(descRaw)}</p>` : ''}
      <div class="pt-1 flex items-center gap-2">
        <button type="button" onclick="openCardModal('${card.id}')"
          class="px-2 py-1 rounded bg-[#2C4D6E] text-white text-[11px] font-bold">編輯卡片</button>
        ${card.mapUrl ? `<a href="${card.mapUrl}" target="_blank" rel="noopener" class="px-2 py-1 rounded border border-slate-200 text-slate-700 text-[11px] font-semibold">Google Maps</a>` : ''}
      </div>
    </div>
  `;
  marker.bindPopup(popupHtml);
}

function buildCurvedFlightArc(lat1, lng1, lat2, lng2) {
  const points = [];
  const steps = 32;
  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  const offsetScale = 0.14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const arch = Math.sin(Math.PI * t) * offsetScale;
    points.push([lat1 + dLat * t - dLng * arch, lng1 + dLng * t + dLat * arch]);
  }
  return points;
}

function findNearestStation(lat, lng) {
  let best = null;
  let minKm = Infinity;
  YUI_RAIL_STATIONS.forEach((st, idx) => {
    const dLat = ((st.lat - lat) * Math.PI) / 180;
    const dLng = ((st.lng - lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat * Math.PI) / 180) * Math.cos((st.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (km < minKm) {
      minKm = km;
      best = { ...st, idx, km };
    }
  });
  return best;
}

async function drawRoadSnappedLeg(cardA, cardB, legInfo, dayColor, targetLayerGroup) {
  const lat1 = Number(cardA.lat);
  const lng1 = Number(cardA.lng);
  const lat2 = Number(cardB.lat);
  const lng2 = Number(cardB.lng);

  // 1. 跨海飛航（>250 km）
  if (legInfo.km > 250) {
    const arcCoords = buildCurvedFlightArc(lat1, lng1, lat2, lng2);
    L.polyline(arcCoords, {
      color: dayColor,
      weight: 3,
      opacity: 0.75,
      dashArray: '8, 8'
    }).addTo(targetLayerGroup);
    return;
  }

  // 2. 沖繩單軌電車精準貼軌切片（使用真實 OSM 高架軌道幾何）
  const profile = document.getElementById('transitProfileSelect')?.value || 'smart';
  if ((profile === 'transit' || profile === 'smart') && typeof turf !== 'undefined') {
    const stA = findNearestStation(lat1, lng1);
    const stB = findNearestStation(lat2, lng2);
    if (stA && stB && stA.idx !== stB.idx && stA.km <= 1.2 && stB.km <= 1.2) {
      const trackLine = (await getYuiRailTrackLine()) || buildFallbackTrackLine();
      if (trackLine) {
        const sliced = turf.lineSlice(turf.point([stA.lng, stA.lat]), turf.point([stB.lng, stB.lat]), trackLine);
        const railLatLngs = sliced.geometry.coordinates.map(c => [c[1], c[0]]);

        L.polyline([[lat1, lng1], [stA.lat, stA.lng]], {
          color: dayColor,
          weight: 3,
          opacity: 0.78,
          dashArray: '4, 6'
        }).addTo(targetLayerGroup);

        L.polyline(railLatLngs, {
          color: dayColor,
          weight: 5,
          opacity: 0.94
        }).addTo(targetLayerGroup);

        L.polyline([[stB.lat, stB.lng], [lat2, lng2]], {
          color: dayColor,
          weight: 3,
          opacity: 0.78,
          dashArray: '4, 6'
        }).addTo(targetLayerGroup);
        return;
      }
    }
  }

  // 3. 一般陸地移動：OSRM 實際道路貼齊路徑
  const osrmMode = profile === 'walk' || legInfo.km <= 0.8 ? 'foot' : 'driving';
  const cacheKey = `${osrmMode}:${lng1.toFixed(5)},${lat1.toFixed(5)};${lng2.toFixed(5)},${lat2.toFixed(5)}`;

  if (osrmRouteCache[cacheKey]) {
    L.polyline(osrmRouteCache[cacheKey], {
      color: dayColor,
      weight: 4.5,
      opacity: 0.88,
      dashArray: osrmMode === 'foot' ? '5, 6' : null
    }).addTo(targetLayerGroup);
    return;
  }

  const tempLine = L.polyline(
    [
      [lat1, lng1],
      [lat2, lng2]
    ],
    {
      color: dayColor,
      weight: 3,
      opacity: 0.35,
      dashArray: '4, 4'
    }
  ).addTo(targetLayerGroup);

  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/${osrmMode}/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`
    );
    const data = await res.json();
    if (data.code === 'Ok' && data.routes && data.routes[0]?.geometry?.coordinates) {
      const roadLatLngs = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      osrmRouteCache[cacheKey] = roadLatLngs;
      if (targetLayerGroup.hasLayer(tempLine)) {
        targetLayerGroup.removeLayer(tempLine);
        L.polyline(roadLatLngs, {
          color: dayColor,
          weight: 4.5,
          opacity: 0.88,
          dashArray: osrmMode === 'foot' ? '5, 6' : null
        }).addTo(targetLayerGroup);
      }
    }
  } catch (e) {}
}

export function renderMapMarkers(getFilteredCardsFn = null) {
  if (!mapInstance || !markersLayerGroup || !routesLayerGroup) return;

  markersLayerGroup.clearLayers();
  routesLayerGroup.clearLayers();
  Object.keys(markerByCardId).forEach(k => delete markerByCardId[k]);

  const bounds = [];
  const includeFlightInBounds = Boolean(document.getElementById('chkIncludeCrossSeaFlight')?.checked);
  let pinCount = 0;

  if (state.mode === 'collect') {
    const cards = typeof getFilteredCardsFn === 'function' ? getFilteredCardsFn() : state.cards;
    cards.forEach(card => {
      if (state.visibleMapLayers[card.category] === false) return;
      if (card.lat === null || card.lng === null || isNaN(Number(card.lat)) || isNaN(Number(card.lng))) return;

      const lat = Number(card.lat);
      const lng = Number(card.lng);
      const style = CATEGORY_STYLES[card.category] || CATEGORY_STYLES['景點'];
      const marker = L.marker([lat, lng], {
        icon: createPinIcon(style.hex, '', false)
      });
      attachSpotTooltipAndPopup(marker, card);

      marker.addTo(markersLayerGroup);
      markerByCardId[card.id] = marker;
      bounds.push([lat, lng]);
      pinCount++;
    });
  } else {
    const totalDays = Math.max(1, Number(state.settings.totalDays) || 6);
    const daysToDraw = state.mapOverviewAllDays
      ? Array.from({ length: totalDays }, (_, i) => i + 1)
      : [Math.min(totalDays, Math.max(1, Number(state.selectedMapDay) || 1))];

    const scheduledIds = new Set();
    let totalMinSum = 0;
    let totalKmSum = 0;
    const legSummaryRows = [];

    daysToDraw.forEach(dayNum => {
      const dayColor = DAY_COLORS[(dayNum - 1) % DAY_COLORS.length];
      const items = state.itinerary[dayNum]?.items || [];

      items.forEach((it, idx) => {
        scheduledIds.add(it.cardId);
        const card = state.cards.find(c => c.id === it.cardId);
        if (!card || card.lat === null || card.lng === null) return;

        const lat = Number(card.lat);
        const lng = Number(card.lng);
        if (isNaN(lat) || isNaN(lng)) return;

        let isCrossSeaPoint = false;
        if (idx < items.length - 1) {
          const nextCard = state.cards.find(c => c.id === items[idx + 1].cardId);
          if (nextCard && nextCard.lat != null) {
            const legCheck = estimateLegTransit(card, nextCard, items[idx + 1]);
            if (legCheck.km > 250) isCrossSeaPoint = true;
          }
        }
        if (includeFlightInBounds || !isCrossSeaPoint) {
          bounds.push([lat, lng]);
        }

        pinCount++;
        const label = state.mapOverviewAllDays ? `D${dayNum}` : String(idx + 1);
        const prefixTag = state.mapOverviewAllDays ? `[Day ${dayNum} #${idx + 1}] ` : `#${idx + 1} `;
        const marker = L.marker([lat, lng], {
          icon: createPinIcon(dayColor, label, true)
        });
        attachSpotTooltipAndPopup(marker, card, prefixTag);
        marker.addTo(markersLayerGroup);
        markerByCardId[card.id] = marker;

        if (idx > 0) {
          const prevCard = state.cards.find(c => c.id === items[idx - 1].cardId);
          if (prevCard && prevCard.lat != null && prevCard.lng != null) {
            const leg = estimateLegTransit(prevCard, card, it);
            totalMinSum += leg.min;
            totalKmSum += leg.km;
            legSummaryRows.push({
              dayNum,
              dayColor,
              fromTitle: prevCard.title,
              toTitle: card.title,
              leg
            });
            drawRoadSnappedLeg(prevCard, card, leg, dayColor, routesLayerGroup);
          }
        }
      });
    });

    const badgeEl = document.getElementById('dailyTransitBadge');
    if (badgeEl) {
      badgeEl.textContent = `${totalMinSum} 分 (${totalKmSum.toFixed(1)} km)`;
    }

    const legsListEl = document.getElementById('dailyTransitLegsList');
    if (legsListEl) {
      legsListEl.innerHTML =
        legSummaryRows.length > 0
          ? legSummaryRows
              .map(
                r => `
              <div class="flex items-center justify-between gap-2 px-2 py-1 rounded bg-slate-50 border border-slate-100">
                <span class="truncate">
                  <span class="inline-block w-2 h-2 rounded-full mr-1" style="background:${r.dayColor}"></span>
                  ${escapeHtml(r.fromTitle)} → ${escapeHtml(r.toTitle)}
                </span>
                <span class="font-bold text-[#2C4D6E] shrink-0">${r.leg.modeLabel}・${r.leg.km}km / ${r.leg.min}分</span>
              </div>
            `
              )
              .join('')
          : '<div class="text-slate-400 py-1">當日尚無兩點以上移動路線</div>';
    }

    const legendBox = document.getElementById('multiDayLegendBox');
    if (legendBox) {
      if (state.mapOverviewAllDays) {
        legendBox.classList.remove('hidden');
        legendBox.classList.add('flex');
        legendBox.innerHTML = Array.from({ length: totalDays }, (_, i) => {
          const d = i + 1;
          const color = DAY_COLORS[i % DAY_COLORS.length];
          return `
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style="background:${color}">
              Day ${d}
            </span>
          `;
        }).join('');
      } else {
        legendBox.classList.add('hidden');
        legendBox.classList.remove('flex');
      }
    }

    if (state.overlayPocketOnPlan) {
      state.cards.forEach(card => {
        if (scheduledIds.has(card.id)) return;
        if (state.visibleMapLayers[card.category] === false) return;
        if (card.lat === null || card.lng === null) return;

        const lat = Number(card.lat);
        const lng = Number(card.lng);
        if (isNaN(lat) || isNaN(lng)) return;

        const style = CATEGORY_STYLES[card.category] || CATEGORY_STYLES['景點'];
        const marker = L.marker([lat, lng], {
          icon: createPinIcon(style.hex, '', false),
          opacity: 0.82
        });
        attachSpotTooltipAndPopup(marker, card, '【口袋】');
        marker.addTo(markersLayerGroup);
        if (!markerByCardId[card.id]) markerByCardId[card.id] = marker;
        pinCount++;
      });
    }
  }

  const counterEl = document.getElementById('mapPinCounter');
  if (counterEl) counterEl.textContent = `${pinCount} 釘`;

  if (bounds.length > 0) {
    mapInstance.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
  }
}

export function fitMapToFilteredCards() {
  renderMapMarkers();
}

export function focusCardOnMap(cardId, warnIfMissing = true) {
  const card = state.cards.find(c => c.id === cardId);
  if (!card || card.lat === null || card.lng === null || isNaN(Number(card.lat)) || isNaN(Number(card.lng))) {
    if (warnIfMissing) showToast('此卡片尚未設定經緯度座標', 'amber');
    return;
  }

  setTimeout(() => {
    invalidateMapSize();
    if (!mapInstance) return;
    const lat = Number(card.lat);
    const lng = Number(card.lng);
    mapInstance.setView([lat, lng], 15, { animate: true });
    if (markerByCardId[cardId]) {
      markerByCardId[cardId].openPopup();
    }
  }, 120);
}

export function highlightDatabaseCard(cardId) {
  const el = document.getElementById(`db-card-${cardId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('ring-2', 'ring-[#2C4D6E]');
  setTimeout(() => el.classList.remove('ring-2', 'ring-[#2C4D6E]'), 1600);
}
