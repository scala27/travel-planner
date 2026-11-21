import { CATEGORY_STYLES } from './config.js';
import { state, showToast } from './state.js';
import { estimateLegTransit, setOkinawaTransitData, getDayColor, addCardToDay } from './ui-board.js';

let mapInstance = null;
let markersLayerGroup = null;
let routesLayerGroup = null;
let focusedAdhocMarker = null;
const markerByCardId = {};
const inFlightRouteRequests = {};
let renderGeneration = 0;
let lastFittedScopeKey = null;
let lastCollectCardsGetter = null;

const ROUTE_CACHE_STORAGE_KEY = 'echi_route_geom_cache_v1';
let routeGeometryCache = {};
try {
  const savedCache = localStorage.getItem(ROUTE_CACHE_STORAGE_KEY);
  if (savedCache) routeGeometryCache = JSON.parse(savedCache) || {};
} catch (e) {
  routeGeometryCache = {};
}

function saveRouteGeometryToCache(key, pts) {
  routeGeometryCache[key] = pts;
  try {
    const keys = Object.keys(routeGeometryCache);
    if (keys.length > 220) {
      delete routeGeometryCache[keys[0]];
    }
    localStorage.setItem(ROUTE_CACHE_STORAGE_KEY, JSON.stringify(routeGeometryCache));
  } catch (e) {}
}

let transitJsonCache = null;
let transitLoadPromise = null;

// 輕量併發控制佇列與節流間隔，避免同時發出大量請求被公開 OSRM 伺服器限流
const MAX_CONCURRENT_OSRM = 2;
let activeOsrmCount = 0;
const osrmWaitQueue = [];

function acquireOsrmSlot() {
  if (activeOsrmCount < MAX_CONCURRENT_OSRM) {
    activeOsrmCount++;
    return Promise.resolve();
  }
  return new Promise(resolve => {
    osrmWaitQueue.push(resolve);
  });
}

function releaseOsrmSlot() {
  setTimeout(() => {
    activeOsrmCount = Math.max(0, activeOsrmCount - 1);
    if (osrmWaitQueue.length > 0 && activeOsrmCount < MAX_CONCURRENT_OSRM) {
      activeOsrmCount++;
      const next = osrmWaitQueue.shift();
      if (next) next();
    }
  }, 160);
}

const CATEGORY_SHORT_CHAR = {
  '景點': '景',
  '美食': '美',
  '購物': '購',
  '住宿': '宿',
  '機場': '機',
  '交通': '交',
  '體驗': '體'
};

export function addCardFromMapPopup(cardId, dayNum = null) {
  if (state.isReadOnly) return;
  const targetDay = Number(dayNum) || Number(state.selectedMapDay) || 1;
  addCardToDay(cardId, targetDay);
  if (mapInstance) {
    mapInstance.closePopup();
  }
}

export function toggleMapPopupDayPicker(event, pickerId) {
  if (event) event.stopPropagation();
  const el = document.getElementById(pickerId);
  if (!el) return;
  el.style.display = el.style.display === 'flex' ? 'none' : 'flex';
}

window.addCardFromMapPopup = addCardFromMapPopup;
window.toggleMapPopupDayPicker = toggleMapPopupDayPicker;

function ensureMapPopupTooltipStyle() {
  if (document.getElementById('echi-map-popup-tip-style')) return;
  const styleEl = document.createElement('style');
  styleEl.id = 'echi-map-popup-tip-style';
  styleEl.textContent = `
    .echi-pop-tip-btn {
      position: relative;
    }
    .echi-pop-tip-btn::after {
      content: attr(data-tip);
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%) translateY(2px);
      background: #0f172a;
      color: #ffffff;
      font-size: 10.5px;
      font-weight: 700;
      padding: 3px 7px;
      border-radius: 5px;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.14s ease, transform 0.14s ease;
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.25);
      z-index: 9999;
    }
    .echi-pop-tip-btn:hover::after {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  `;
  document.head.appendChild(styleEl);
}

export async function loadOkinawaTransitJson() {
  if (transitJsonCache) return transitJsonCache;
  if (!transitLoadPromise) {
    transitLoadPromise = (async () => {
      const candidatePaths = ['./data/okinawa_transit.json', './okinawa_transit.json'];
      for (const path of candidatePaths) {
        try {
          const res = await fetch(path + '?v=20261119a');
          if (res.ok) {
            const data = await res.json();
            if (data && data.yui_rail) {
              transitJsonCache = data;
              setOkinawaTransitData(data);
              return data;
            }
          }
        } catch (e) {}
      }
      return null;
    })();
  }
  return transitLoadPromise;
}

export function initLeafletMap() {
  const container = document.getElementById('mapContainer');
  if (!container || typeof L === 'undefined') return;

  ensureMapPopupTooltipStyle();
  lastFittedScopeKey = null;

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

  loadOkinawaTransitJson().then(data => {
    if (data && state.mode === 'plan') {
      renderMapMarkers();
    }
  });
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
      const btnCls = visible
        ? 'bg-white border-slate-300 text-slate-800 shadow-2xs'
        : 'bg-slate-100 border-slate-200 text-slate-400 opacity-60';
      const dotColor = visible ? style.hex : '#94a3b8';
      return (
        '<button type="button" onclick="toggleMapCategoryLayer(\'' + cat + '\')" ' +
        'class="px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center gap-1 border transition ' + btnCls + '">' +
        '<span class="w-2 h-2 rounded-full" style="background:' + dotColor + '"></span>' +
        '<span>' + cat + '</span>' +
        '</button>'
      );
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
  if (state.isReadOnly) return;
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
  const size = isScheduled ? 28 : 24;
  return L.divIcon({
    className: 'custom-map-pin',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html:
      '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:9999px;background:' + hexColor +
      ';color:#ffffff;border:2px solid #ffffff;box-shadow:0 2px 6px rgba(15,23,42,0.35);' +
      'display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;line-height:1;">' +
      labelText +
      '</div>'
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attachSpotTooltipAndPopup(marker, card) {
  const cleanTitle = escapeHtml(card.title);
  const style = CATEGORY_STYLES[card.category] || CATEGORY_STYLES['景點'];
  const fallbackMapUrl =
    card.mapUrl ||
    'https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent(card.title + ' ' + (card.lat || '') + ',' + (card.lng || ''));

  marker.bindTooltip(
    '<span style="font-size:12px;font-weight:700;color:#0f172a;">' + cleanTitle + '</span>',
    {
      direction: 'top',
      offset: [0, -10],
      opacity: 0.96
    }
  );

  const totalDays = Math.max(1, Number(state.settings.totalDays) || 6);
  const defaultDay = Math.min(totalDays, Math.max(1, Number(state.selectedMapDay) || 1));
  const btnColor = getDayColor(defaultDay);

  const scheduledDays = [];
  for (let d = 1; d <= totalDays; d++) {
    if ((state.itinerary[d]?.items || []).some(it => it.cardId === card.id)) {
      scheduledDays.push('Day ' + d);
    }
  }

  const subMeta = [card.district, '停留 ' + (Number(card.duration) || 60) + ' 分'].filter(Boolean).join(' · ');
  const scheduledBadgeHtml =
    scheduledDays.length > 0
      ? '<span style="padding:2px 6px;border-radius:9999px;font-size:10px;font-weight:700;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;">已排 ' +
        scheduledDays.join(', ') +
        '</span>'
      : '';

  let bottomActionsHtml = '';
  let hiddenDayPickerHtml = '';

  if (state.isReadOnly) {
    bottomActionsHtml =
      '<div style="display:flex;align-items:center;gap:6px;">' +
      '<a href="' + fallbackMapUrl + '" target="_blank" rel="noopener" title="在 Google 地圖開啟" ' +
      'style="flex:1;height:30px;padding:0 10px;border-radius:8px;background:#eff6ff;color:#2563eb;border:1px solid #dbeafe;display:inline-flex;align-items:center;justify-content:center;gap:5px;text-decoration:none;font-size:11.5px;font-weight:700;">' +
      '<i class="fa-solid fa-map-location-dot" style="font-size:12px;"></i>' +
      '<span>在 Google 地圖開啟</span>' +
      '</a>' +
      '</div>';
  } else {
    const pickerId = 'popup-day-pills-' + String(card.id).replace(/[^a-zA-Z0-9_-]/g, '_');
    const dayPillsHtml = Array.from({ length: totalDays }, (_, i) => {
      const d = i + 1;
      const dColor = getDayColor(d);
      const isCurrent = d === defaultDay;
      const bg = isCurrent ? dColor : '#ffffff';
      const fg = isCurrent ? '#ffffff' : dColor;
      return (
        '<button type="button" onclick="addCardFromMapPopup(\'' + card.id + '\', ' + d + ')" ' +
        'style="padding:3px 7px;border-radius:6px;font-size:10.5px;font-weight:700;cursor:pointer;border:1px solid ' +
        dColor + ';background:' + bg + ';color:' + fg + ';line-height:1.2;">' +
        'Day ' + d +
        '</button>'
      );
    }).join('');

    const dropdownArrowHtml =
      totalDays > 1
        ? '<button type="button" class="echi-pop-tip-btn" data-tip="選擇排入天數" onclick="toggleMapPopupDayPicker(event, \'' + pickerId + '\')" title="選擇排入天數" ' +
          'style="width:20px;height:30px;background:' + btnColor + ';color:#ffffff;border:none;border-left:1px solid rgba(255,255,255,0.28);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;border-top-right-radius:8px;border-bottom-right-radius:8px;">' +
          '<i class="fa-solid fa-chevron-down" style="font-size:9px;"></i>' +
          '</button>'
        : '';

    const addBtnRightRadius = totalDays > 1 ? '0' : '8px';

    bottomActionsHtml =
      '<div style="display:flex;align-items:center;gap:6px;">' +
      '<div style="display:inline-flex;align-items:stretch;border-radius:8px;box-shadow:0 1px 2px rgba(15,23,42,0.12);">' +
      '<button type="button" class="echi-pop-tip-btn" data-tip="排入 Day ' + defaultDay + '" onclick="addCardFromMapPopup(\'' + card.id + '\', ' + defaultDay + ')" title="排入 Day ' + defaultDay + '" ' +
      'style="width:30px;height:30px;background:' + btnColor + ';color:#ffffff;border:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;border-top-left-radius:8px;border-bottom-left-radius:8px;border-top-right-radius:' + addBtnRightRadius + ';border-bottom-right-radius:' + addBtnRightRadius + ';">' +
      '<i class="fa-solid fa-plus" style="font-size:12px;"></i>' +
      '</button>' +
      dropdownArrowHtml +
      '</div>' +
      '<button type="button" class="echi-pop-tip-btn" data-tip="編輯卡片" onclick="openCardModal(\'' + card.id + '\')" title="編輯卡片" ' +
      'style="width:30px;height:30px;border-radius:8px;background:#f8fafc;color:#475569;border:1px solid #e2e8f0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">' +
      '<i class="fa-regular fa-pen-to-square" style="font-size:13px;"></i>' +
      '</button>' +
      '<a href="' + fallbackMapUrl + '" target="_blank" rel="noopener" class="echi-pop-tip-btn" data-tip="Google 地圖" title="在 Google 地圖開啟" ' +
      'style="width:30px;height:30px;border-radius:8px;background:#eff6ff;color:#2563eb;border:1px solid #dbeafe;display:inline-flex;align-items:center;justify-content:center;text-decoration:none;flex-shrink:0;">' +
      '<i class="fa-solid fa-map-location-dot" style="font-size:13px;"></i>' +
      '</a>' +
      '</div>';

    hiddenDayPickerHtml =
      '<div id="' + pickerId + '" style="display:none;flex-wrap:wrap;gap:4px;margin-top:7px;padding-top:7px;border-top:1px dashed #e2e8f0;">' +
      dayPillsHtml +
      '</div>';
  }

  const popupHtml =
    '<div style="min-width:200px;max-width:255px;padding:2px 0;font-family:inherit;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:5px;">' +
    '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:6px;font-size:10px;font-weight:800;background:' + style.hex + '18;color:' + style.hex + ';">' +
    '<span style="width:6px;height:6px;border-radius:9999px;background:' + style.hex + ';"></span>' +
    escapeHtml(card.category || '景點') +
    '</span>' +
    scheduledBadgeHtml +
    '</div>' +
    '<div style="font-weight:800;font-size:13.5px;color:#0f172a;line-height:1.35;margin-bottom:3px;">' +
    cleanTitle +
    '</div>' +
    '<div style="font-size:11px;color:#64748b;margin-bottom:9px;">' +
    escapeHtml(subMeta) +
    '</div>' +
    bottomActionsHtml +
    hiddenDayPickerHtml +
    '</div>';

  marker.bindPopup(popupHtml, { maxWidth: 270 });
}

function buildGoogleMapsLegUrl(cardA, cardB, itemB) {
  const origin = Number(cardA.lat) + ',' + Number(cardA.lng);
  const dest = Number(cardB.lat) + ',' + Number(cardB.lng);
  const itemMode = itemB?.transitMode && itemB.transitMode !== 'auto' ? itemB.transitMode : null;
  const profile = itemMode || document.getElementById('transitProfileSelect')?.value || 'smart';

  let travelmode = 'transit';
  if (profile === 'drive' || profile === 'taxi') {
    travelmode = 'driving';
  } else if (profile === 'walk') {
    travelmode = 'walking';
  }

  return (
    'https://www.google.com/maps/dir/?api=1&origin=' +
    encodeURIComponent(origin) +
    '&destination=' +
    encodeURIComponent(dest) +
    '&travelmode=' +
    travelmode
  );
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

function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function polylineLengthKm(latLngs) {
  if (!Array.isArray(latLngs) || latLngs.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < latLngs.length; i++) {
    sum += haversineKm(latLngs[i - 1][0], latLngs[i - 1][1], latLngs[i][0], latLngs[i][1]);
  }
  return sum;
}

function findNearestStop(stops, lat, lng) {
  let best = null;
  let minKm = Infinity;
  (stops || []).forEach((st, idx) => {
    const km = haversineKm(lat, lng, st.lat, st.lng);
    if (km < minKm) {
      minKm = km;
      best = { ...st, idx, km };
    }
  });
  return best;
}

async function queryOsrmWithTimeout(url, timeoutMs = 8000) {
  await acquireOsrmSlot();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code === 'Ok' && data.routes && data.routes[0]?.geometry?.coordinates) {
      return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
    }
  } catch (e) {
  } finally {
    clearTimeout(timer);
    releaseOsrmSlot();
  }
  return null;
}

async function fetchWaypointsRoadCoords(latLngWaypoints, mode = 'car') {
  if (!Array.isArray(latLngWaypoints) || latLngWaypoints.length < 2) return null;
  const coordsStr = latLngWaypoints.map(pt => Number(pt[1]).toFixed(5) + ',' + Number(pt[0]).toFixed(5)).join(';');
  const cacheKey = mode + ':' + coordsStr;

  if (routeGeometryCache[cacheKey]) return routeGeometryCache[cacheKey];
  if (inFlightRouteRequests[cacheKey]) return inFlightRouteRequests[cacheKey];

  const task = (async () => {
    const candidateUrls =
      mode === 'foot'
        ? [
            'https://routing.openstreetmap.de/routed-foot/route/v1/foot/' + coordsStr + '?overview=full&geometries=geojson',
            'https://router.project-osrm.org/route/v1/driving/' + coordsStr + '?overview=full&geometries=geojson'
          ]
        : [
            'https://routing.openstreetmap.de/routed-car/route/v1/driving/' + coordsStr + '?overview=full&geometries=geojson',
            'https://router.project-osrm.org/route/v1/driving/' + coordsStr + '?overview=full&geometries=geojson'
          ];

    let pts = null;
    for (const url of candidateUrls) {
      pts = await queryOsrmWithTimeout(url, 8000);
      if (pts && pts.length >= 2) break;
    }

    if (!pts) {
      await new Promise(r => setTimeout(r, 500));
      pts = await queryOsrmWithTimeout(candidateUrls[candidateUrls.length - 1], 8500);
    }

    if (pts && pts.length >= 2) {
      if (latLngWaypoints.length === 2 && mode === 'car') {
        const directKm = haversineKm(latLngWaypoints[0][0], latLngWaypoints[0][1], latLngWaypoints[1][0], latLngWaypoints[1][1]);
        const pathKm = polylineLengthKm(pts);
        if (directKm < 5 && pathKm > directKm * 2.2 + 0.35) {
          const footFallback = await queryOsrmWithTimeout(
            'https://routing.openstreetmap.de/routed-foot/route/v1/foot/' + coordsStr + '?overview=full&geometries=geojson',
            6000
          );
          if (footFallback && polylineLengthKm(footFallback) < pathKm * 0.75) {
            pts = footFallback;
          }
        }
      }
      saveRouteGeometryToCache(cacheKey, pts);
      return pts;
    }

    return null;
  })();

  inFlightRouteRequests[cacheKey] = task;
  try {
    return await task;
  } finally {
    delete inFlightRouteRequests[cacheKey];
  }
}

async function fetchStreetAlignedCoords(lat1, lng1, lat2, lng2, mode = 'car') {
  return fetchWaypointsRoadCoords(
    [
      [lat1, lng1],
      [lat2, lng2]
    ],
    mode
  );
}

function createProvisionalLine(lat1, lng1, lat2, lng2, dayColor, targetLayerGroup, isWalk = false) {
  return L.polyline(
    [
      [lat1, lng1],
      [lat2, lng2]
    ],
    {
      color: dayColor,
      weight: isWalk ? 3.2 : 3.8,
      opacity: 0.65,
      dashArray: isWalk ? '5, 6' : '6, 5'
    }
  ).addTo(targetLayerGroup);
}

async function drawYuiRailSlicedRoute(lat1, lng1, lat2, lng2, stopA, stopB, shapeLatLngs, lineColor, targetLayerGroup, seq) {
  if (typeof turf === 'undefined' || !Array.isArray(shapeLatLngs) || shapeLatLngs.length < 10) return false;

  const lineCoords = shapeLatLngs.map(pt => [pt[1], pt[0]]);
  const fullLine = turf.lineString(lineCoords);
  const sliced = turf.lineSlice(turf.point([stopA.lng, stopA.lat]), turf.point([stopB.lng, stopB.lat]), fullLine);
  const slicedLatLngs = sliced.geometry.coordinates.map(c => [c[1], c[0]]);

  L.polyline(slicedLatLngs, {
    color: lineColor,
    weight: 5,
    opacity: 0.94
  }).addTo(targetLayerGroup);

  const provStart = stopA.km > 0.03 ? createProvisionalLine(lat1, lng1, stopA.lat, stopA.lng, lineColor, targetLayerGroup, true) : null;
  const provEnd = stopB.km > 0.03 ? createProvisionalLine(stopB.lat, stopB.lng, lat2, lng2, lineColor, targetLayerGroup, true) : null;

  const [walkStart, walkEnd] = await Promise.all([
    stopA.km > 0.03 ? fetchStreetAlignedCoords(lat1, lng1, stopA.lat, stopA.lng, 'foot') : Promise.resolve(null),
    stopB.km > 0.03 ? fetchStreetAlignedCoords(stopB.lat, stopB.lng, lat2, lng2, 'foot') : Promise.resolve(null)
  ]);

  if (seq !== renderGeneration) return true;

  if (walkStart && provStart) {
    targetLayerGroup.removeLayer(provStart);
    L.polyline(walkStart, { color: lineColor, weight: 3.5, opacity: 0.85, dashArray: '5, 6' }).addTo(targetLayerGroup);
  }
  if (walkEnd && provEnd) {
    targetLayerGroup.removeLayer(provEnd);
    L.polyline(walkEnd, { color: lineColor, weight: 3.5, opacity: 0.85, dashArray: '5, 6' }).addTo(targetLayerGroup);
  }

  return true;
}

async function drawRoadSnappedLeg(cardA, cardB, itemB, legInfo, dayColor, targetLayerGroup, seq) {
  const lat1 = Number(cardA.lat);
  const lng1 = Number(cardA.lng);
  const lat2 = Number(cardB.lat);
  const lng2 = Number(cardB.lng);
  const directKm = haversineKm(lat1, lng1, lat2, lng2);

  if (legInfo.km > 250 || directKm > 250) {
    const arcCoords = buildCurvedFlightArc(lat1, lng1, lat2, lng2);
    L.polyline(arcCoords, {
      color: dayColor,
      weight: 3,
      opacity: 0.75,
      dashArray: '8, 8'
    }).addTo(targetLayerGroup);
    return;
  }

  const itemMode = itemB?.transitMode && itemB.transitMode !== 'auto' ? itemB.transitMode : null;
  const profile = itemMode || document.getElementById('transitProfileSelect')?.value || 'smart';
  const isWalk = profile === 'walk' || (directKm <= 0.8 && !itemMode);

  const transitData = transitJsonCache || (await loadOkinawaTransitJson());
  if (seq !== renderGeneration) return;

  if (transitData && (profile === 'transit' || profile === 'smart') && directKm > 0.8) {
    const yui = transitData.yui_rail;
    if (yui && Array.isArray(yui.stations) && Array.isArray(yui.shape)) {
      const stA = findNearestStop(yui.stations, lat1, lng1);
      const stB = findNearestStop(yui.stations, lat2, lng2);
      if (stA && stB && stA.id !== stB.id && stA.km <= 1.2 && stB.km <= 1.2) {
        const ok = await drawYuiRailSlicedRoute(lat1, lng1, lat2, lng2, stA, stB, yui.shape, dayColor, targetLayerGroup, seq);
        if (ok) return;
      }
    }

    if (Array.isArray(transitData.buses) && directKm >= 1.2) {
      let bestBus = null;
      let bestWalkSum = Infinity;
      transitData.buses.forEach(bus => {
        const bA = findNearestStop(bus.stops, lat1, lng1);
        const bB = findNearestStop(bus.stops, lat2, lng2);
        if (bA && bB && bA.id !== bB.id && bA.km <= 1.2 && bB.km <= 1.2) {
          const walkSum = bA.km + bB.km;
          const busSpanKm = haversineKm(bA.lat, bA.lng, bB.lat, bB.lng);
          if (walkSum < directKm * 0.65 && busSpanKm >= 0.8 && walkSum < bestWalkSum) {
            bestWalkSum = walkSum;
            bestBus = { bus, bA, bB };
          }
        }
      });

      if (bestBus) {
        const { bA, bB } = bestBus;
        const waypoints = [
          [lat1, lng1],
          [bA.lat, bA.lng],
          [bB.lat, bB.lng],
          [lat2, lng2]
        ];
        const provLine = L.polyline(waypoints, {
          color: dayColor,
          weight: 3.8,
          opacity: 0.65,
          dashArray: '6, 5'
        }).addTo(targetLayerGroup);

        const combinedRoadCoords = await fetchWaypointsRoadCoords(waypoints, 'car');
        if (seq !== renderGeneration) return;

        if (combinedRoadCoords) {
          targetLayerGroup.removeLayer(provLine);
          L.polyline(combinedRoadCoords, {
            color: dayColor,
            weight: 4.5,
            opacity: 0.92
          }).addTo(targetLayerGroup);
        }
        return;
      }
    }
  }

  const modeStr = isWalk ? 'foot' : 'car';
  const cacheKey = modeStr + ':' + lng1.toFixed(5) + ',' + lat1.toFixed(5) + ';' + lng2.toFixed(5) + ',' + lat2.toFixed(5);
  if (routeGeometryCache[cacheKey]) {
    L.polyline(routeGeometryCache[cacheKey], {
      color: dayColor,
      weight: isWalk ? 3.8 : 4.5,
      opacity: 0.9,
      dashArray: isWalk ? '5, 6' : null
    }).addTo(targetLayerGroup);
    return;
  }

  const provisionalLine = createProvisionalLine(lat1, lng1, lat2, lng2, dayColor, targetLayerGroup, isWalk);
  const roadLatLngs = await fetchStreetAlignedCoords(lat1, lng1, lat2, lng2, modeStr);
  if (seq !== renderGeneration) return;

  if (roadLatLngs) {
    targetLayerGroup.removeLayer(provisionalLine);
    L.polyline(roadLatLngs, {
      color: dayColor,
      weight: isWalk ? 3.8 : 4.5,
      opacity: 0.9,
      dashArray: isWalk ? '5, 6' : null
    }).addTo(targetLayerGroup);
  }
}

function getCurrentMapScopeKey() {
  if (state.mode === 'collect' && !state.isReadOnly) {
    const scope = state.filters?.scope || 'all';
    const drillC = state.hierarchyViewMode ? (state.drillCountry || 'all') : (document.getElementById('countryFilter')?.value || 'all');
    const drillD = state.hierarchyViewMode ? (state.drillDistrict || 'all') : (document.getElementById('cityFilter')?.value || 'all');
    return 'collect:' + scope + ':' + drillC + ':' + drillD;
  }
  const tripKey = state.activeTripId || 'default';
  if (state.mapOverviewAllDays) {
    return 'plan:all:' + tripKey;
  }
  const dayNum = Math.min(Math.max(1, Number(state.settings.totalDays) || 6), Math.max(1, Number(state.selectedMapDay) || 1));
  return 'plan:day:' + tripKey + ':' + dayNum;
}

export function renderMapMarkers(getFilteredCardsFn = null, options = {}) {
  if (!mapInstance || !markersLayerGroup || !routesLayerGroup) return;

  if (typeof getFilteredCardsFn === 'function') {
    lastCollectCardsGetter = getFilteredCardsFn;
  }
  const activeGetter = typeof getFilteredCardsFn === 'function' ? getFilteredCardsFn : lastCollectCardsGetter;

  const seq = ++renderGeneration;
  markersLayerGroup.clearLayers();
  routesLayerGroup.clearLayers();
  focusedAdhocMarker = null;
  Object.keys(markerByCardId).forEach(k => delete markerByCardId[k]);

  const bounds = [];
  const includeFlightInBounds = Boolean(document.getElementById('chkIncludeCrossSeaFlight')?.checked);
  let pinCount = 0;

  if (state.mode === 'collect' && !state.isReadOnly) {
    const cards = typeof activeGetter === 'function' ? activeGetter() : state.cards;
    cards.forEach(card => {
      if (state.visibleMapLayers[card.category] === false) return;
      if (card.lat === null || card.lng === null || isNaN(Number(card.lat)) || isNaN(Number(card.lng))) return;

      const lat = Number(card.lat);
      const lng = Number(card.lng);
      const style = CATEGORY_STYLES[card.category] || CATEGORY_STYLES['景點'];
      const catChar = CATEGORY_SHORT_CHAR[card.category] || '景';
      const marker = L.marker([lat, lng], {
        icon: createPinIcon(style.hex, catChar, false)
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
      const dayColor = getDayColor(dayNum);
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
        const label = state.mapOverviewAllDays ? 'D' + dayNum : String(idx + 1);
        const marker = L.marker([lat, lng], {
          icon: createPinIcon(dayColor, label, true)
        });
        attachSpotTooltipAndPopup(marker, card);
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
              leg,
              gmapsUrl: buildGoogleMapsLegUrl(prevCard, card, it)
            });
            drawRoadSnappedLeg(prevCard, card, it, leg, dayColor, routesLayerGroup, seq);
          }
        }
      });
    });

    const badgeEl = document.getElementById('dailyTransitBadge');
    if (badgeEl) {
      badgeEl.textContent = totalMinSum + ' 分 (' + totalKmSum.toFixed(1) + ' km)';
    }

    const legsListEl = document.getElementById('dailyTransitLegsList');
    if (legsListEl) {
      legsListEl.innerHTML =
        legSummaryRows.length > 0
          ? legSummaryRows
              .map(
                r =>
                  '<div class="flex items-center justify-between gap-2 px-2 py-1 rounded bg-slate-50 border border-slate-100">' +
                  '<span class="truncate min-w-0">' +
                  '<span class="inline-block w-2 h-2 rounded-full mr-1" style="background:' + r.dayColor + '"></span>' +
                  escapeHtml(r.fromTitle) + ' → ' + escapeHtml(r.toTitle) +
                  '</span>' +
                  '<div class="flex items-center gap-1.5 shrink-0">' +
                  '<span class="font-bold text-[#2C4D6E]">' + r.leg.modeLabel + '・' + r.leg.km + 'km / ' + r.leg.min + '分</span>' +
                  '<a href="' + r.gmapsUrl + '" target="_blank" rel="noopener" title="開啟 Google Maps 查看即時公車與導航路線" ' +
                  'class="w-6 h-6 rounded-md bg-white hover:bg-blue-50 border border-slate-200 text-blue-600 flex items-center justify-center transition">' +
                  '<i class="fa-solid fa-diamond-turn-right text-xs"></i>' +
                  '</a>' +
                  '</div>' +
                  '</div>'
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
          const color = getDayColor(d);
          return (
            '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style="background:' + color + '">' +
            'Day ' + d +
            '</span>'
          );
        }).join('');
      } else {
        legendBox.classList.add('hidden');
        legendBox.classList.remove('flex');
      }
    }

    if (!state.isReadOnly && state.overlayPocketOnPlan) {
      state.cards.forEach(card => {
        if (scheduledIds.has(card.id)) return;
        if (state.visibleMapLayers[card.category] === false) return;
        if (card.lat === null || card.lng === null) return;

        const lat = Number(card.lat);
        const lng = Number(card.lng);
        if (isNaN(lat) || isNaN(lng)) return;

        const style = CATEGORY_STYLES[card.category] || CATEGORY_STYLES['景點'];
        const catChar = CATEGORY_SHORT_CHAR[card.category] || '景';
        const marker = L.marker([lat, lng], {
          icon: createPinIcon(style.hex, catChar, false),
          opacity: 0.9
        });
        attachSpotTooltipAndPopup(marker, card);
        marker.addTo(markersLayerGroup);
        if (!markerByCardId[card.id]) markerByCardId[card.id] = marker;
        pinCount++;
      });
    }
  }

  const counterEl = document.getElementById('mapPinCounter');
  if (counterEl) counterEl.textContent = pinCount + ' 釘';

  const currentScopeKey = getCurrentMapScopeKey();
  const shouldFitBounds = Boolean(options.forceFit) || lastFittedScopeKey !== currentScopeKey;

  if (bounds.length > 0 && shouldFitBounds) {
    mapInstance.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
    lastFittedScopeKey = currentScopeKey;
  }
}

export function fitMapToFilteredCards() {
  renderMapMarkers(null, { forceFit: true });
}

export function focusCardOnMap(cardId, warnIfMissing = true) {
  const card = state.cards.find(c => c.id === cardId);
  if (!card || card.lat === null || card.lng === null || isNaN(Number(card.lat)) || isNaN(Number(card.lng))) {
    if (warnIfMissing) showToast('此卡片尚未設定經緯度座標，請先編輯補齊座標', 'amber');
    return;
  }

  // 手機端（< 768px）自動切換至「路線地圖」分頁，確保地圖容器處於顯示狀態
  const isMobileViewport = window.innerWidth < 768;
  if (isMobileViewport && state.mobileTab !== 'map' && typeof window.switchMobileTab === 'function') {
    window.switchMobileTab('map');
  }

  // 若為桌機版行程規劃模式且右側地圖面板意外隱藏，確保展開
  const mapPanel = document.getElementById('mapPanel');
  if (mapPanel && mapPanel.classList.contains('hidden')) {
    mapPanel.classList.remove('hidden');
    mapPanel.classList.add('flex');
  }

  setTimeout(() => {
    if (!mapInstance) {
      initLeafletMap();
    }
    invalidateMapSize();
    if (!mapInstance) return;

    const lat = Number(card.lat);
    const lng = Number(card.lng);

    // 清除前一次未排入行程的臨時聚焦圖釘
    if (focusedAdhocMarker && markersLayerGroup) {
      try {
        markersLayerGroup.removeLayer(focusedAdhocMarker);
      } catch (e) {}
      focusedAdhocMarker = null;
    }

    let targetMarker = markerByCardId[cardId];
    // 若此口袋卡片尚未排入行程或目前不在圖層上，動態建立聚焦標記並彈出資訊卡
    if (!targetMarker && markersLayerGroup) {
      const style = CATEGORY_STYLES[card.category] || CATEGORY_STYLES['景點'];
      const catChar = CATEGORY_SHORT_CHAR[card.category] || '景';
      targetMarker = L.marker([lat, lng], {
        icon: createPinIcon(style.hex, catChar, true),
        zIndexOffset: 1000
      });
      attachSpotTooltipAndPopup(targetMarker, card);
      targetMarker.addTo(markersLayerGroup);
      focusedAdhocMarker = targetMarker;
    }

    mapInstance.setView([lat, lng], 16, { animate: true });
    if (targetMarker) {
      targetMarker.openPopup();
    }
  }, 180);
}

export function highlightDatabaseCard(cardId) {
  const el = document.getElementById('db-card-' + cardId);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('ring-2', 'ring-[#2C4D6E]');
  setTimeout(() => el.classList.remove('ring-2', 'ring-[#2C4D6E]'), 1600);
}
