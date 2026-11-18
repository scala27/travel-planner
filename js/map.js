import { CATEGORY_STYLES, DAY_COLORS } from './config.js';
import { state, showToast } from './state.js';
import { estimateLegTransit, setOkinawaTransitData } from './ui-board.js';

let mapInstance = null;
let markersLayerGroup = null;
let routesLayerGroup = null;
const markerByCardId = {};
const osrmRouteCache = {};

let transitJsonCache = null;
let transitLoadPromise = null;

const CATEGORY_SHORT_CHAR = {
  '景點': '景',
  '美食': '美',
  '購物': '購',
  '住宿': '宿',
  '機場': '機',
  '交通': '交',
  '體驗': '體'
};

// 自動從 ./data/okinawa_transit.json 或 ./okinawa_transit.json 載入 GTFS 路線資料
export async function loadOkinawaTransitJson() {
  if (transitJsonCache) return transitJsonCache;
  if (!transitLoadPromise) {
    transitLoadPromise = (async () => {
      const candidatePaths = ['./data/okinawa_transit.json', './okinawa_transit.json'];
      for (const path of candidatePaths) {
        try {
          const res = await fetch(`${path}?v=20261118i`);
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

  // 啟動時預先載入 okinawa_transit.json 並在載入後重繪精準路線
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
  const size = isScheduled ? 28 : 24;
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
        border:2px solid #ffffff;
        box-shadow:0 2px 6px rgba(15,23,42,0.35);
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:${isScheduled ? '11px' : '11px'};
        font-weight:800;
        line-height:1;
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

function attachSpotTooltipAndPopup(marker, card) {
  const cleanTitle = escapeHtml(card.title);
  const fallbackMapUrl =
    card.mapUrl ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${card.title} ${card.lat || ''},${card.lng || ''}`)}`;

  // 1. 懸浮提示僅顯示地點名稱（不含口袋等其他標籤）
  marker.bindTooltip(
    `<span style="font-size:12px;font-weight:700;color:#0f172a;">${cleanTitle}</span>`,
    {
      direction: 'top',
      offset: [0, -10],
      opacity: 0.96
    }
  );

  // 2. 點擊彈窗僅顯示地點名稱 + 編輯卡片與 Google Maps 純圖示按鈕
  const popupHtml = `
    <div style="min-width:150px;max-width:230px;padding:2px 0;">
      <div style="font-weight:800;font-size:13px;color:#0f172a;line-height:1.35;margin-bottom:8px;">
        ${cleanTitle}
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button type="button" onclick="openCardModal('${card.id}')" title="編輯卡片"
          style="width:32px;height:32px;border-radius:8px;background:#2C4D6E;color:#ffffff;border:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:13px;">
          <i class="fa-solid fa-pen"></i>
        </button>
        <a href="${fallbackMapUrl}" target="_blank" rel="noopener" title="在 Google Maps 開啟"
          style="width:32px;height:32px;border-radius:8px;background:#f8fafc;color:#1d4ed8;border:1px solid #cbd5e1;display:inline-flex;align-items:center;justify-content:center;font-size:14px;text-decoration:none;">
          <i class="fa-solid fa-map-location-dot"></i>
        </a>
      </div>
    </div>
  `;
  marker.bindPopup(popupHtml);
}

function buildGoogleMapsLegUrl(cardA, cardB, itemB) {
  const origin = `${Number(cardA.lat)},${Number(cardA.lng)}`;
  const dest = `${Number(cardB.lat)},${Number(cardB.lng)}`;
  const itemMode = itemB?.transitMode && itemB.transitMode !== 'auto' ? itemB.transitMode : null;
  const profile = itemMode || document.getElementById('transitProfileSelect')?.value || 'smart';

  let travelmode = 'transit';
  if (profile === 'drive' || profile === 'taxi') {
    travelmode = 'driving';
  } else if (profile === 'walk') {
    travelmode = 'walking';
  }

  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&travelmode=${travelmode}`;
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
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

function drawGtfsSlicedRoute(lat1, lng1, lat2, lng2, stopA, stopB, shapeLatLngs, lineColor, targetLayerGroup) {
  if (typeof turf === 'undefined' || !Array.isArray(shapeLatLngs) || shapeLatLngs.length < 2) return false;

  const lineCoords = shapeLatLngs.map(pt => [pt[1], pt[0]]);
  const fullLine = turf.lineString(lineCoords);
  const sliced = turf.lineSlice(turf.point([stopA.lng, stopA.lat]), turf.point([stopB.lng, stopB.lat]), fullLine);
  const slicedLatLngs = sliced.geometry.coordinates.map(c => [c[1], c[0]]);

  if (stopA.km > 0.03) {
    L.polyline(
      [
        [lat1, lng1],
        [stopA.lat, stopA.lng]
      ],
      {
        color: lineColor,
        weight: 3,
        opacity: 0.78,
        dashArray: '4, 6'
      }
    ).addTo(targetLayerGroup);
  }

  L.polyline(slicedLatLngs, {
    color: lineColor,
    weight: 5,
    opacity: 0.94
  }).addTo(targetLayerGroup);

  if (stopB.km > 0.03) {
    L.polyline(
      [
        [stopB.lat, stopB.lng],
        [lat2, lng2]
      ],
      {
        color: lineColor,
        weight: 3,
        opacity: 0.78,
        dashArray: '4, 6'
      }
    ).addTo(targetLayerGroup);
  }

  return true;
}

async function drawRoadSnappedLeg(cardA, cardB, legInfo, dayColor, targetLayerGroup) {
  const lat1 = Number(cardA.lat);
  const lng1 = Number(cardA.lng);
  const lat2 = Number(cardB.lat);
  const lng2 = Number(cardB.lng);

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

  const profile = document.getElementById('transitProfileSelect')?.value || 'smart';
  const transitData = await loadOkinawaTransitJson();

  if (transitData && (profile === 'transit' || profile === 'smart') && legInfo.km > 0.6) {
    const yui = transitData.yui_rail;
    if (yui && Array.isArray(yui.stations) && Array.isArray(yui.shape)) {
      const stA = findNearestStop(yui.stations, lat1, lng1);
      const stB = findNearestStop(yui.stations, lat2, lng2);
      if (stA && stB && stA.id !== stB.id && stA.km <= 1.2 && stB.km <= 1.2) {
        const ok = drawGtfsSlicedRoute(lat1, lng1, lat2, lng2, stA, stB, yui.shape, dayColor, targetLayerGroup);
        if (ok) return;
      }
    }

    if (Array.isArray(transitData.buses)) {
      let bestBus = null;
      let bestWalkSum = Infinity;
      transitData.buses.forEach(bus => {
        const bA = findNearestStop(bus.stops, lat1, lng1);
        const bB = findNearestStop(bus.stops, lat2, lng2);
        if (bA && bB && bA.id !== bB.id && bA.km <= 1.5 && bB.km <= 1.5) {
          if (bA.km + bB.km < bestWalkSum) {
            bestWalkSum = bA.km + bB.km;
            bestBus = { bus, bA, bB };
          }
        }
      });
      if (bestBus) {
        const ok = drawGtfsSlicedRoute(
          lat1,
          lng1,
          lat2,
          lng2,
          bestBus.bA,
          bestBus.bB,
          bestBus.bus.shape,
          dayColor,
          targetLayerGroup
        );
        if (ok) return;
      }
    }
  }

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
            drawRoadSnappedLeg(prevCard, card, leg, dayColor, routesLayerGroup);
          }
        }
      });
    });

    const badgeEl = document.getElementById('dailyTransitBadge');
    if (badgeEl) {
      badgeEl.textContent = `${totalMinSum} 分 (${totalKmSum.toFixed(1)} km)`;
    }

    // 4. 當日路線分段明細：加入可連結 Google Maps 路線與即時公車資訊的圖示按鈕
    const legsListEl = document.getElementById('dailyTransitLegsList');
    if (legsListEl) {
      legsListEl.innerHTML =
        legSummaryRows.length > 0
          ? legSummaryRows
              .map(
                r => `
              <div class="flex items-center justify-between gap-2 px-2 py-1 rounded bg-slate-50 border border-slate-100">
                <span class="truncate min-w-0">
                  <span class="inline-block w-2 h-2 rounded-full mr-1" style="background:${r.dayColor}"></span>
                  ${escapeHtml(r.fromTitle)} → ${escapeHtml(r.toTitle)}
                </span>
                <div class="flex items-center gap-1.5 shrink-0">
                  <span class="font-bold text-[#2C4D6E]">${r.leg.modeLabel}・${r.leg.km}km / ${r.leg.min}分</span>
                  <a href="${r.gmapsUrl}" target="_blank" rel="noopener"
                    title="開啟 Google Maps 查看即時公車與導航路線"
                    class="w-6 h-6 rounded-md bg-white hover:bg-blue-50 border border-slate-200 text-blue-600 flex items-center justify-center transition">
                    <i class="fa-solid fa-diamond-turn-right text-xs"></i>
                  </a>
                </div>
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

    // 3. 疊加口袋標示中央顯示分類單字（景/美/購/宿/機/交/體）
    if (state.overlayPocketOnPlan) {
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
