import { CATEGORY_STYLES, DAY_COLORS } from './config.js';
import { state, showToast } from './state.js';
import { estimateLegTransit } from './ui-board.js';

let mapInstance = null;
let markersLayerGroup = null;
let routesLayerGroup = null;
const markerByCardId = {};
const osrmRouteCache = {};

// 沖繩都市單軌電車（Yui Rail）全線 19 站座標，供 Turf.js 軌道貼合切片使用
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

// 建立滑鼠懸停（Hover Tooltip）與點擊（Popup）的景點簡介卡片
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

// 計算跨海航班弧線座標
function buildCurvedFlightArc(lat1, lng1, lat2, lng2) {
  const points = [];
  const steps = 32;
  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  const offsetScale = 0.14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const arch = Math.sin(Math.PI * t) * offsetScale;
    const lat = lat1 + dLat * t - dLng * arch;
    const lng = lng1 + dLng * t + dLat * arch;
    points.push([lat, lng]);
  }
  return points;
}

// 尋找距離座標最近的單軌站點（公里）
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

// 透過 OSRM 取得實際道路貼合幾何座標（含快取與單軌幾何切片）
async function drawRoadSnappedLeg(cardA, cardB, legInfo, dayColor, targetLayerGroup) {
  const lat1 = Number(cardA.lat);
  const lng1 = Number(cardA.lng);
  const lat2 = Number(cardB.lat);
  const lng2 = Number(cardB.lng);

  // 1. 跨海飛航（>250 km）：繪製虛線弧線
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

  // 2. 若為大眾運輸／單軌模式且起迄點鄰近沖繩單軌站（1.2km 內），使用 Turf.js 切出單軌幾何線段＋步行接駁
  const profile = document.getElementById('transitProfileSelect')?.value || 'smart';
  if ((profile === 'transit' || profile === 'smart') && typeof turf !== 'undefined') {
    const stA = findNearestStation(lat1, lng1);
    const stB = findNearestStation(lat2, lng2);
    if (stA && stB && stA.idx !== stB.idx && stA.km <= 1.2 && stB.km <= 1.2) {
      const fullLine = turf.lineString(YUI_RAIL_STATIONS.map(s => [s.lng, s.lat]));
      const sliced = turf.lineSlice(turf.point([stA.lng, stA.lat]), turf.point([stB.lng, stB.lat]), fullLine);
      const railLatLngs = sliced.geometry.coordinates.map(c => [c[1], c[0]]);

      // 起點步行至單軌站（虛線）
      L.polyline([[lat1, lng1], [stA.lat, stA.lng]], {
        color: dayColor,
        weight: 3,
        opacity: 0.75,
        dashArray: '4, 6'
      }).addTo(targetLayerGroup);

      // 單軌主線（粗實線）
      L.polyline(railLatLngs, {
        color: dayColor,
        weight: 5,
        opacity: 0.92
      }).addTo(targetLayerGroup);

      // 單軌站步行至終點（虛線）
      L.polyline([[stB.lat, stB.lng], [lat2, lng2]], {
        color: dayColor,
        weight: 3,
        opacity: 0.75,
        dashArray: '4, 6'
      }).addTo(targetLayerGroup);
      return;
    }
  }

  // 3. 一般陸地移動：呼叫 OSRM 實際道路路徑（driving / foot）
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

  // 先畫一條淡色預覽直線，待 OSRM 回傳道路座標後立即替換為貼齊道路之路線
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
  } catch (e) {
    // 若網路無法連線 OSRM，保留直線顯示
  }
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

        // 檢查是否為跨海起點（例如台灣機場），若未勾選「視野含跨海航線」則不拉遠沖繩地圖視野
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

        // 繪製與下一站之道路貼合路線並累計交通時間
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

    // 更新上方移動時間／距離徽章與抽屜分段明細
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

    // 多日分色圖例
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

    // 疊加未排入之口袋景點（含滑鼠懸停簡介）
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
