import {
  CATEGORY_LIST,
  CATEGORY_META,
  DAY_ROUTE_COLORS,
  isTransportOrAirport
} from './config.js';
import { state, hooks, persistState, showToast } from './state.js';
import {
  normalizeAdministrativeDistrict,
  computeWalkingMinutes,
  formatDistanceLabel,
  getTransitModeDisplay,
  resolveLegModeAndEstimate,
  fetchRealRoadPath,
  buildMultiModalTransitSegments,
  buildCurvedFlightArc
} from './geo.js';
import { getFormattedDateInfo } from './ui-board.js';

let mapInstance = null;
let mapMarkersLayer = null;
let mapRouteLayer = null;
let markerLookup = {};
// 非同步渲染版本鎖，避免快速切換日期時舊日期的查詢結果覆蓋新日期
let currentRenderToken = 0;

export function getMapInstance() {
  return mapInstance;
}

export function invalidateMapSize() {
  if (mapInstance) mapInstance.invalidateSize();
}

export function initLeafletMap() {
  mapInstance = L.map('mapContainer', { zoomControl: true }).setView([26.2124, 127.6809], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(mapInstance);

  mapMarkersLayer = L.layerGroup().addTo(mapInstance);
  mapRouteLayer = L.layerGroup().addTo(mapInstance);
}

function hasValidCoords(card) {
  if (!card) return false;
  const lat = Number(card.lat);
  const lng = Number(card.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
}

function createColoredPinIcon(color, labelText, isGhost = false, isWideBadge = false) {
  const opacityStyle = isGhost ? 'opacity:0.78;border-style:dashed;' : '';
  const sizeStyle = isWideBadge ? 'min-width:30px;height:24px;padding:0 5px;font-size:10px;' : 'width:26px;height:26px;font-size:11px;';
  return L.divIcon({
    className: 'custom-map-pin',
    html: `<div style="background:${color};color:#fff;${sizeStyle}border-radius:9999px;border:2.5px solid #fff;${opacityStyle}box-shadow:0 2px 6px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;font-weight:800;white-space:nowrap;">${labelText}</div>`,
    iconSize: isWideBadge ? [32, 24] : [26, 26],
    iconAnchor: isWideBadge ? [16, 12] : [13, 13],
    popupAnchor: [0, -14]
  });
}

function createStopMiniMarker(lat, lng, stopName, isMonorail = false) {
  return L.circleMarker([lat, lng], {
    radius: isMonorail ? 5.5 : 4.5,
    fillColor: '#ffffff',
    color: isMonorail ? '#dc2626' : '#7c3aed',
    weight: 2.5,
    fillOpacity: 1
  }).bindTooltip(`${isMonorail ? '🚝' : '🚏'} ${stopName}`, {
    direction: 'top',
    offset: [0, -4],
    className: 'spot-hover-tooltip'
  });
}

export function renderMapCategoryToggles() {
  const container = document.getElementById('mapCategoryToggleContainer');
  if (!container) return;

  container.innerHTML = CATEGORY_LIST.map(cat => {
    const meta = CATEGORY_META[cat];
    const isVisible = state.mapVisibleCategories[cat] !== false;
    return `
      <button type="button" onclick="toggleMapCategoryLayer('${cat}')"
        class="px-2 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1 border transition ${isVisible ? 'bg-white border-slate-300 text-slate-800 shadow-2xs' : 'bg-slate-100 border-slate-200 text-slate-400 line-through opacity-65'}">
        <span class="w-2 h-2 rounded-full inline-block" style="background-color:${isVisible ? meta.color : '#cbd5e1'}"></span>
        <span>${cat}</span>
      </button>
    `;
  }).join('');
}

export function toggleMapCategoryLayer(cat) {
  state.mapVisibleCategories[cat] = !state.mapVisibleCategories[cat];
  renderMapCategoryToggles();
  renderMapMarkers();
}

export function setOnlyAttractionsLayer() {
  CATEGORY_LIST.forEach(cat => {
    state.mapVisibleCategories[cat] = (cat === '景點' || cat === '機場' || cat === '住宿');
  });
  renderMapCategoryToggles();
  renderMapMarkers();
  showToast('已切換為第一層路線圖層（僅顯示景點、住宿、機場）', 'emerald');
}

export function setAllMapLayersVisible(visible) {
  CATEGORY_LIST.forEach(cat => {
    state.mapVisibleCategories[cat] = visible;
  });
  renderMapCategoryToggles();
  renderMapMarkers();
}

export function toggleOverlayPocketOnPlanMap() {
  state.overlayPocketOnPlan = !state.overlayPocketOnPlan;
  const btn = document.getElementById('btnOverlayPocket');
  const txt = document.getElementById('overlayPocketStatusText');
  if (state.overlayPocketOnPlan) {
    btn.className = 'px-2 py-1 rounded-lg border border-blue-600 bg-blue-600 text-white text-[11px] font-bold flex items-center gap-1 transition';
    txt.textContent = '疊加中';
  } else {
    btn.className = 'px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-blue-50 text-slate-700 text-[11px] font-semibold flex items-center gap-1 transition';
    txt.textContent = '疊加口袋';
  }
  renderMapMarkers();
}

async function drawAndComputeLegRoute(cardA, cardB, item, dayColorOverride, renderToken) {
  const est = resolveLegModeAndEstimate(cardA, cardB, item.transitMode || 'auto');
  const activeMode = est.mode;
  const isHotelTransfer = est.isHotelTransfer;
  let legMin = est.min;
  let legKm = est.km;
  let transitDetailLabel = '';

  const hasCoordsA = hasValidCoords(cardA);
  const hasCoordsB = hasValidCoords(cardB);

  if (hasCoordsA && hasCoordsB) {
    if (activeMode === 'flight') {
      if (renderToken !== currentRenderToken) return null;
      const arcPts = buildCurvedFlightArc(cardA.lat, cardA.lng, cardB.lat, cardB.lng);
      L.polyline(arcPts, { color: dayColorOverride || '#0284c7', weight: 3, opacity: 0.78, dashArray: '8, 8' }).addTo(mapRouteLayer);
    } else if (activeMode === 'walk') {
      const walkData = await fetchRealRoadPath(cardA.lat, cardA.lng, cardB.lat, cardB.lng, 'walk');
      if (renderToken !== currentRenderToken) return null;
      legKm = walkData.distanceKm || legKm;
      legMin = computeWalkingMinutes(legKm, isHotelTransfer);
      L.polyline(walkData.latLngs, {
        color: dayColorOverride || '#10b981',
        weight: 4.5,
        opacity: 0.9,
        dashArray: '5, 7'
      }).addTo(mapRouteLayer);
    } else if (activeMode === 'transit') {
      const multiSeg = await buildMultiModalTransitSegments(cardA, cardB, isHotelTransfer);
      if (renderToken !== currentRenderToken) return null;
      transitDetailLabel = multiSeg.transitDetailLabel;
      legKm = multiSeg.totalKm || legKm;
      if (multiSeg.totalMin) {
        legMin = multiSeg.totalMin;
      }

      if (multiSeg.hasStopSplit) {
        L.polyline(multiSeg.walk1Path, { color: '#10b981', weight: 4, opacity: 0.9, dashArray: '4, 6' }).addTo(mapRouteLayer);
        const rideColor = dayColorOverride || (multiSeg.isMonorail ? '#dc2626' : '#7c3aed');
        L.polyline(multiSeg.ridePath, { color: rideColor, weight: 4.5, opacity: 0.92 }).addTo(mapRouteLayer);
        L.polyline(multiSeg.walk2Path, { color: '#10b981', weight: 4, opacity: 0.9, dashArray: '4, 6' }).addTo(mapRouteLayer);

        createStopMiniMarker(multiSeg.stopA.lat, multiSeg.stopA.lng, `上車：${multiSeg.stopA.name}`, multiSeg.isMonorail).addTo(mapRouteLayer);
        createStopMiniMarker(multiSeg.stopB.lat, multiSeg.stopB.lng, `下車：${multiSeg.stopB.name}`, multiSeg.isMonorail).addTo(mapRouteLayer);
      } else {
        L.polyline(multiSeg.ridePath, { color: dayColorOverride || '#7c3aed', weight: 4.5, opacity: 0.85 }).addTo(mapRouteLayer);
      }
    } else {
      const driveData = await fetchRealRoadPath(cardA.lat, cardA.lng, cardB.lat, cardB.lng, 'drive');
      if (renderToken !== currentRenderToken) return null;
      legKm = driveData.distanceKm || legKm;
      if (driveData.durationMin) {
        legMin = activeMode === 'taxi'
          ? Math.max(4, driveData.durationMin + 2)
          : Math.max(8, driveData.durationMin + 6);
      }
      const roadColor = dayColorOverride || (activeMode === 'taxi' ? '#d97706' : '#2563eb');
      L.polyline(driveData.latLngs, { color: roadColor, weight: 4.5, opacity: 0.85 }).addTo(mapRouteLayer);
    }
  }

  if (renderToken !== currentRenderToken) return null;

  const hasCustomLock = Number(item.transitMin) > 0;
  if (hasCustomLock) {
    legMin = Number(item.transitMin);
  }

  const transferTag = isHotelTransfer ? '🧳 換宿移動・' : '';
  const baseModeLabel = item.customTransitNote
    ? `📌 ${item.customTransitNote}`
    : getTransitModeDisplay(activeMode, transitDetailLabel);
  const modeLabel = `${transferTag}${baseModeLabel}`;
  const distText = formatDistanceLabel(legKm);
  const lockBadge = hasCustomLock ? ' 🔒' : '';
  const missingCoordTag = (!hasCoordsA || !hasCoordsB) ? '⚠️ 缺座標・' : '';
  const summaryText = distText
    ? `${missingCoordTag}${modeLabel}｜約 ${distText}・${legMin} 分${lockBadge}`
    : `${missingCoordTag}${modeLabel}｜約 ${legMin} 分${lockBadge}`;

  const cacheKey = `${cardA.id}_${cardB.id}_${item.transitMode || 'auto'}_${item.transitMin || 0}_${item.customTransitNote || ''}_${document.getElementById('transitProfileSelect')?.value || 'smart'}`;
  const prevCached = state.routeMetricsCache[cacheKey];
  state.routeMetricsCache[cacheKey] = {
    mode: activeMode,
    transitDetailLabel,
    isHotelTransfer,
    km: legKm,
    min: legMin,
    summaryText
  };

  return {
    activeMode,
    isHotelTransfer,
    legKm,
    legMin,
    summaryText,
    hasMissingCoords: !hasCoordsA || !hasCoordsB,
    changed: !prevCached || prevCached.summaryText !== summaryText
  };
}

function buildPreciseGoogleMapsDirUrl(cardA, cardB, activeMode) {
  const gdirMode = activeMode === 'walk' ? 'walking' : ((activeMode === 'drive' || activeMode === 'taxi') ? 'driving' : 'transit');
  const originParam = hasValidCoords(cardA) ? `${cardA.lat},${cardA.lng}` : encodeURIComponent(cardA.title);
  const destParam = hasValidCoords(cardB) ? `${cardB.lat},${cardB.lng}` : encodeURIComponent(cardB.title);
  return `https://www.google.com/maps/dir/?api=1&origin=${originParam}&destination=${destParam}&travelmode=${gdirMode}`;
}

export async function renderMapMarkers(filteredCardsProvider = null) {
  if (!mapInstance) return;
  const renderToken = ++currentRenderToken;

  mapMarkersLayer.clearLayers();
  mapRouteLayer.clearLayers();
  markerLookup = {};

  const legendBox = document.getElementById('multiDayLegendBox');
  const drawerTitle = document.getElementById('routeLegsDrawerTitle');

  if (state.mode === 'collect') {
    if (legendBox) legendBox.classList.add('hidden');
    const rawList = typeof filteredCardsProvider === 'function' ? filteredCardsProvider() : state.cards;
    const cards = rawList.filter(c =>
      hasValidCoords(c) &&
      state.mapVisibleCategories[c.category] !== false
    );
    document.getElementById('mapPinCounter').textContent = `${cards.length} 釘`;

    const bounds = [];
    cards.forEach(card => {
      const meta = CATEGORY_META[card.category] || CATEGORY_META['景點'];
      const cleanDist = normalizeAdministrativeDistrict(card.district, card.country);
      const gmapsUrl = card.mapUrl || `https://www.google.com/maps/search/?api=1&query=${card.lat},${card.lng}`;
      const marker = L.marker([card.lat, card.lng], {
        icon: createColoredPinIcon(meta.color, meta.pinChar || card.category[0])
      });

      marker.bindTooltip(`${meta.emoji} ${card.title}`, {
        direction: 'top',
        offset: [0, -14],
        className: 'spot-hover-tooltip'
      });

      marker.bindPopup(`
        <div class="text-xs space-y-1.5 min-w-[175px]">
          <div class="font-bold text-slate-800 leading-snug">${card.title}</div>
          <div class="text-[11px] text-slate-500">${cleanDist}・${card.category}</div>
          <div class="pt-1 flex items-center gap-1.5">
            <a href="${gmapsUrl}" target="_blank" rel="noopener" title="開啟 Google Maps 導航"
              style="color:#ffffff !important;"
              class="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs inline-flex items-center gap-1 shadow-2xs transition">
              <i class="fa-solid fa-diamond-turn-right"></i>
              <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
            </a>
            <button onclick="openCardModal('${card.id}')" title="編輯卡片"
              class="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-amber-50 hover:text-amber-600 text-slate-700 text-xs inline-flex items-center justify-center transition">
              <i class="fa-solid fa-pen"></i>
            </button>
          </div>
        </div>
      `);

      marker.on('click', () => highlightDatabaseCard(card.id));
      marker.addTo(mapMarkersLayer);
      markerLookup[card.id] = marker;
      bounds.push([card.lat, card.lng]);
    });

    if (bounds.length > 0 && !state.highlightedCardId) {
      mapInstance.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
    }
    return;
  }

  // ==================== 模式 2：多日同時分色總覽模式 ====================
  if (state.mapOverviewAllDays) {
    const totalDays = Number(state.settings.totalDays) || 6;
    const allCoords = [];
    const localDestinationCoords = [];
    const legsHtml = [];
    const legendPills = [];
    let grandTotalMin = 0;
    let grandTotalKm = 0;
    let visiblePinCount = 0;

    for (let d = 1; d <= totalDays; d++) {
      if (renderToken !== currentRenderToken) return;
      const items = state.itinerary[d]?.items || [];
      if (items.length === 0) continue;

      const dayColor = DAY_ROUTE_COLORS[(d - 1) % DAY_ROUTE_COLORS.length];
      const info = getFormattedDateInfo(d);
      legendPills.push(`
        <button type="button" onclick="selectDayFocus(${d})"
          class="px-2 py-0.5 rounded-full text-[10px] font-bold text-white flex items-center gap-1 shadow-2xs hover:opacity-90 transition"
          style="background-color:${dayColor}">
          <span>Day ${d} (${info.md})</span>
          <span class="bg-white/25 px-1 rounded-full">${items.length}</span>
        </button>
      `);

      let stopIndex = 0;
      for (let idx = 0; idx < items.length; idx++) {
        if (renderToken !== currentRenderToken) return;
        const item = items[idx];
        const card = state.cards.find(c => c.id === item.cardId);
        if (!card) continue;
        const cardHasCoords = hasValidCoords(card);
        const isLayerVisible = state.mapVisibleCategories[card.category] !== false;
        const cleanDist = normalizeAdministrativeDistrict(card.district, card.country);
        const gmapsUrl = card.mapUrl || `https://www.google.com/maps/search/?api=1&query=${card.lat},${card.lng}`;

        if (card.category !== '住宿' && !isTransportOrAirport(card.category)) stopIndex++;
        const hotelTag = item.isCheckout ? `D${d}退` : `D${d}宿`;
        const shortTag = card.category === '住宿' ? hotelTag : (card.category === '機場' ? `D${d}機` : `${d}-${stopIndex}`);

        if (cardHasCoords) {
          allCoords.push([card.lat, card.lng]);
          const isTaiwanOriginAirport = card.category === '機場' && ((card.country || '').includes('台') || (card.country || '').includes('臺'));
          if (!isTaiwanOriginAirport) {
            localDestinationCoords.push([card.lat, card.lng]);
          }

          if (isLayerVisible) {
            visiblePinCount++;
            const marker = L.marker([card.lat, card.lng], {
              icon: createColoredPinIcon(dayColor, shortTag, false, true)
            });

            marker.bindTooltip(`[Day ${d}] ${item.isCheckout ? '(退房) ' : ''}${card.title}`, {
              direction: 'top',
              offset: [0, -14],
              className: 'spot-hover-tooltip'
            });

            marker.bindPopup(`
              <div class="text-xs space-y-1.5 min-w-[170px]">
                <div class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style="background:${dayColor}">Day ${d} (${info.md})</div>
                <div class="font-bold text-slate-800">${card.title}</div>
                <div class="text-[11px] text-slate-500">${cleanDist}・${card.category}</div>
                <div class="pt-0.5 flex items-center gap-1.5">
                  <a href="${gmapsUrl}" target="_blank" rel="noopener" title="開啟 Google Maps"
                    style="color:#ffffff !important;"
                    class="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs inline-flex items-center gap-1">
                    <i class="fa-solid fa-diamond-turn-right"></i>
                  </a>
                  <button onclick="selectDayFocus(${d})" title="切換檢視 Day ${d}"
                    class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold">
                    檢視 Day ${d}
                  </button>
                </div>
              </div>
            `);

            marker.addTo(mapMarkersLayer);
            markerLookup[card.id] = marker;
          }
        }

        const nextItem = items[idx + 1];
        const nextCard = nextItem ? state.cards.find(c => c.id === nextItem.cardId) : null;
        if (nextCard) {
          const legRes = await drawAndComputeLegRoute(card, nextCard, item, dayColor, renderToken);
          if (!legRes || renderToken !== currentRenderToken) return;
          grandTotalMin += legRes.legMin;
          grandTotalKm += legRes.legKm;

          legsHtml.push(`
            <div class="flex items-center justify-between bg-slate-50 px-2 py-1 rounded border border-slate-100 gap-1">
              <span class="px-1.5 py-0.2 rounded text-[10px] font-bold text-white shrink-0" style="background:${dayColor}">D${d}</span>
              <span class="truncate flex-1">${card.title} → ${nextCard.title}</span>
              <span class="font-bold text-slate-700 shrink-0">${legRes.summaryText}</span>
            </div>
          `);
        }
      }
    }

    if (renderToken !== currentRenderToken) return;

    if (legendBox) {
      legendBox.classList.remove('hidden');
      legendBox.classList.add('flex');
      legendBox.innerHTML = `<span class="text-[10px] font-bold text-slate-500">每日顏色：</span>` + legendPills.join('');
    }
    if (drawerTitle) {
      drawerTitle.innerHTML = `<i class="fa-solid fa-route text-blue-600 mr-1"></i>多日全部行程移動明細`;
    }

    const includeFlightInZoom = document.getElementById('chkIncludeCrossSeaFlight')?.checked;
    const zoomTargetCoords = (!includeFlightInZoom && localDestinationCoords.length > 0)
      ? localDestinationCoords
      : allCoords;

    if (zoomTargetCoords.length > 0) {
      mapInstance.fitBounds(zoomTargetCoords, { padding: [45, 45], maxZoom: 14 });
    }

    document.getElementById('mapPinCounter').textContent = `${visiblePinCount} 釘`;
    document.getElementById('dailyTransitBadge').textContent = `全行程 ${grandTotalMin} 分 (${grandTotalKm.toFixed(1)} km)`;
    document.getElementById('dailyTransitLegsList').innerHTML = legsHtml.length > 0
      ? legsHtml.join('')
      : `<div class="text-slate-400 text-center py-1">目前尚無已排入的移動路段</div>`;
    return;
  }

  // ==================== 模式 2：單日聚焦路線檢核模式 ====================
  const d = state.selectedMapDay;
  if (legendBox) legendBox.classList.add('hidden');
  if (drawerTitle) {
    drawerTitle.innerHTML = `<i class="fa-solid fa-route text-blue-600 mr-1"></i>Day ${d} 路線分段明細`;
  }

  const items = state.itinerary[d]?.items || [];
  const dayCardIds = new Set(items.map(it => it.cardId));
  const allCoords = [];
  const localDestinationCoords = [];
  const legsHtml = [];
  const hiddenLayerStops = [];
  const missingCoordStops = [];
  let totalMin = 0;
  let totalKm = 0;
  let stopIndex = 0;
  let visiblePinCount = 0;
  let anyMetricUpdated = false;

  for (let idx = 0; idx < items.length; idx++) {
    if (renderToken !== currentRenderToken) return;
    const item = items[idx];
    const card = state.cards.find(c => c.id === item.cardId);
    if (!card) continue;
    const cardHasCoords = hasValidCoords(card);
    const meta = CATEGORY_META[card.category] || CATEGORY_META['景點'];
    const isLayerVisible = state.mapVisibleCategories[card.category] !== false;
    const cleanDist = normalizeAdministrativeDistrict(card.district, card.country);
    const gmapsUrl = card.mapUrl || `https://www.google.com/maps/search/?api=1&query=${card.lat},${card.lng}`;

    if (card.category !== '住宿' && !isTransportOrAirport(card.category)) stopIndex++;
    const label = card.category === '住宿'
      ? (item.isCheckout ? '退' : '宿')
      : (card.category === '機場' ? '機' : (card.category === '交通' ? '行' : stopIndex));

    if (!cardHasCoords) {
      missingCoordStops.push({ card, label });
    } else {
      allCoords.push([card.lat, card.lng]);
      const isTaiwanOriginAirport = card.category === '機場' && ((card.country || '').includes('台') || (card.country || '').includes('臺'));
      if (!isTaiwanOriginAirport) {
        localDestinationCoords.push([card.lat, card.lng]);
      }

      if (!isLayerVisible) {
        hiddenLayerStops.push({ card, label });
      } else {
        visiblePinCount++;
        const pinBgColor = (card.category === '住宿' && item.isCheckout) ? '#6b21a8' : meta.color;
        const marker = L.marker([card.lat, card.lng], {
          icon: createColoredPinIcon(pinBgColor, label)
        });

        marker.bindTooltip(`${label}. ${card.title}`, {
          direction: 'top',
          offset: [0, -14],
          className: 'spot-hover-tooltip'
        });

        marker.bindPopup(`
          <div class="text-xs space-y-1.5 min-w-[165px]">
            <div class="font-bold text-slate-800">${label}. ${card.title}</div>
            <div class="text-[11px] text-slate-500">${cleanDist}</div>
            <div class="pt-0.5 flex items-center gap-1.5">
              <a href="${gmapsUrl}" target="_blank" rel="noopener" title="開啟 Google Maps"
                style="color:#ffffff !important;"
                class="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs inline-flex items-center gap-1">
                <i class="fa-solid fa-diamond-turn-right"></i>
              </a>
              <button onclick="openCardModal('${card.id}')" title="編輯卡片"
                class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs">
                <i class="fa-solid fa-pen"></i>
              </button>
            </div>
          </div>
        `);

        marker.addTo(mapMarkersLayer);
        markerLookup[card.id] = marker;
      }
    }

    const nextItem = items[idx + 1];
    const nextCard = nextItem ? state.cards.find(c => c.id === nextItem.cardId) : null;
    if (nextCard) {
      const legRes = await drawAndComputeLegRoute(card, nextCard, item, null, renderToken);
      if (!legRes || renderToken !== currentRenderToken) return;
      if (legRes.changed) anyMetricUpdated = true;

      totalMin += legRes.legMin;
      totalKm += legRes.legKm;

      const gdir = buildPreciseGoogleMapsDirUrl(card, nextCard, legRes.activeMode);
      const badgeTextColor = legRes.hasMissingCoords
        ? 'text-rose-600'
        : (legRes.isHotelTransfer
          ? 'text-purple-700'
          : (legRes.activeMode === 'walk'
            ? 'text-emerald-700'
            : (legRes.activeMode === 'taxi' ? 'text-amber-700' : 'text-blue-700')));

      legsHtml.push(`
        <div class="flex items-center justify-between ${legRes.hasMissingCoords ? 'bg-rose-50/80 border-rose-200' : (legRes.isHotelTransfer ? 'bg-purple-50/70 border-purple-200' : 'bg-slate-50 border-slate-100')} px-2 py-1 rounded border gap-1.5">
          <span class="truncate flex-1 font-medium text-slate-700">${idx + 1}→${idx + 2} ${nextCard.title}</span>
          <span class="font-bold ${badgeTextColor} shrink-0">${legRes.summaryText}</span>
          ${!hasValidCoords(nextCard) ? `<button onclick="openCardModal('${nextCard.id}')" title="補齊經緯度座標" class="px-1.5 py-0.2 rounded bg-rose-600 text-white text-[10px] font-bold shrink-0">補座標</button>` : ''}
          <a href="${gdir}" target="_blank" title="以精確經緯度開啟 Google Maps 路線比對" class="text-blue-600 hover:text-blue-800 shrink-0"><i class="fa-solid fa-diamond-turn-right"></i></a>
        </div>
      `);
    }
  }

  if (renderToken !== currentRenderToken) return;

  if (state.overlayPocketOnPlan) {
    state.cards.forEach(c => {
      if (dayCardIds.has(c.id)) return;
      if (state.mapVisibleCategories[c.category] === false) return;
      if (!hasValidCoords(c)) return;

      visiblePinCount++;
      const meta = CATEGORY_META[c.category] || CATEGORY_META['景點'];
      const cleanDist = normalizeAdministrativeDistrict(c.district, c.country);
      const pocketMarker = L.marker([c.lat, c.lng], {
        icon: createColoredPinIcon(meta.color, meta.pinChar || c.category[0], true)
      });

      pocketMarker.bindTooltip(`${meta.emoji} ${c.title}`, {
        direction: 'top',
        offset: [0, -14],
        className: 'spot-hover-tooltip'
      });

      pocketMarker.bindPopup(`
        <div class="text-xs space-y-1.5 min-w-[170px]">
          <div class="font-bold text-slate-800">${c.title}</div>
          <div class="text-[11px] text-slate-500">${cleanDist}・${c.category}</div>
          <button onclick="addCardToDay('${c.id}', ${d})"
            class="w-full mt-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold">
            + Day ${d}
          </button>
        </div>
      `);

      pocketMarker.addTo(mapMarkersLayer);
    });
  }

  const includeFlightInZoom = document.getElementById('chkIncludeCrossSeaFlight')?.checked;
  const zoomTargetCoords = (!includeFlightInZoom && localDestinationCoords.length > 0)
    ? localDestinationCoords
    : allCoords;

  if (zoomTargetCoords.length > 0) {
    mapInstance.fitBounds(zoomTargetCoords, { padding: [50, 50], maxZoom: 14 });
  }

  const noticesHtml = [];
  if (missingCoordStops.length > 0) {
    const names = missingCoordStops.map(s => `<button onclick="openCardModal('${s.card.id}')" class="underline font-bold hover:text-rose-900">${s.label}. ${s.card.title}</button>`).join('、');
    noticesHtml.push(`<div class="px-2 py-1 rounded bg-rose-50 border border-rose-200 text-rose-700 text-[10px]">⚠️ 尚未設定座標（無法顯示釘子）：${names}</div>`);
  }
  if (hiddenLayerStops.length > 0) {
    noticesHtml.push(`<div class="px-2 py-1 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[10px] flex items-center justify-between"><span>👁️ 有 ${hiddenLayerStops.length} 個當日點位因上方「分類圖層」關閉而隱藏</span><button onclick="setAllMapLayersVisible(true)" class="px-1.5 py-0.2 rounded bg-amber-600 text-white font-bold">全部顯示</button></div>`);
  }

  document.getElementById('mapPinCounter').textContent = `${visiblePinCount} 釘`;
  document.getElementById('dailyTransitBadge').textContent = `${totalMin} 分 (${totalKm.toFixed(1)} km)`;
  document.getElementById('dailyTransitLegsList').innerHTML = noticesHtml.join('') + (legsHtml.length > 0
    ? legsHtml.join('')
    : `<div class="text-slate-400 text-center py-1">當日尚無跨點移動段次</div>`);

  if (anyMetricUpdated && state.mode === 'plan') {
    hooks.renderKanbanBoard();
  }
}

export function fitMapToFilteredCards() {
  state.highlightedCardId = null;
  hooks.renderDatabaseCards();
  hooks.renderMapMarkers();
}

export function focusCardOnMap(cardId, warnIfMissing = true) {
  const card = state.cards.find(c => c.id === cardId);
  if (!card) return;
  state.highlightedCardId = cardId;
  if (card.isNew) {
    card.isNew = false;
    persistState(false);
  }
  hooks.renderDatabaseCards();

  if (hasValidCoords(card) && mapInstance) {
    if (state.mapVisibleCategories[card.category] === false) {
      state.mapVisibleCategories[card.category] = true;
      renderMapCategoryToggles();
      hooks.renderMapMarkers();
    }
    mapInstance.setView([card.lat, card.lng], 15, { animate: true });
  } else if (warnIfMissing) {
    showToast('此卡片尚未設定座標，請在編輯視窗填入經緯度', 'amber');
  }
}

export function highlightDatabaseCard(cardId) {
  state.highlightedCardId = cardId;
  hooks.renderDatabaseCards();
  const el = document.getElementById(`db-card-${cardId}`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
