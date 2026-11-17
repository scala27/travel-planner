import { CATEGORY_LIST, CATEGORY_META, isTransportOrAirport } from './config.js';
import { state, hooks, persistState, showToast } from './state.js';
import {
  normalizeAdministrativeDistrict,
  estimateTransit,
  fetchRealRoadPath,
  buildCurvedFlightArc
} from './geo.js';

let mapInstance = null;
let mapMarkersLayer = null;
let mapRouteLayer = null;
let markerLookup = {};

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

function createColoredPinIcon(color, labelText, isGhost = false) {
  const opacityStyle = isGhost ? 'opacity:0.78;border-style:dashed;' : '';
  return L.divIcon({
    className: 'custom-map-pin',
    html: `<div style="background:${color};color:#fff;width:26px;height:26px;border-radius:9999px;border:2.5px solid #fff;${opacityStyle}box-shadow:0 2px 6px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;">${labelText}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14]
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

export async function renderMapMarkers(filteredCardsProvider = null) {
  if (!mapInstance) return;
  mapMarkersLayer.clearLayers();
  mapRouteLayer.clearLayers();
  markerLookup = {};

  if (state.mode === 'collect') {
    const rawList = typeof filteredCardsProvider === 'function' ? filteredCardsProvider() : state.cards;
    const cards = rawList.filter(c =>
      Number.isFinite(Number(c.lat)) &&
      Number.isFinite(Number(c.lng)) &&
      Number(c.lat) !== 0 &&
      state.mapVisibleCategories[c.category] !== false
    );
    document.getElementById('mapPinCounter').textContent = `${cards.length} 釘`;

    const bounds = [];
    cards.forEach(card => {
      const meta = CATEGORY_META[card.category] || CATEGORY_META['景點'];
      const cleanDist = normalizeAdministrativeDistrict(card.district, card.country);
      const gmapsUrl = card.mapUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.title)}`;
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
  } else {
    const d = state.selectedMapDay;
    const items = state.itinerary[d]?.items || [];
    const dayCardIds = new Set(items.map(it => it.cardId));
    const allCoords = [];
    const localDestinationCoords = [];
    const legsHtml = [];
    let totalMin = 0;
    let totalKm = 0;
    let stopIndex = 0;
    let visiblePinCount = 0;

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const card = state.cards.find(c => c.id === item.cardId);
      if (!card) continue;
      const hasCoords = Number.isFinite(Number(card.lat)) && Number.isFinite(Number(card.lng)) && Number(card.lat) !== 0;
      const meta = CATEGORY_META[card.category] || CATEGORY_META['景點'];
      const isLayerVisible = state.mapVisibleCategories[card.category] !== false;
      const cleanDist = normalizeAdministrativeDistrict(card.district, card.country);
      const gmapsUrl = card.mapUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.title)}`;

      if (card.category !== '住宿' && !isTransportOrAirport(card.category)) stopIndex++;
      const label = card.category === '住宿' ? '宿' : (card.category === '機場' ? '機' : (card.category === '交通' ? '行' : stopIndex));

      if (hasCoords) {
        allCoords.push([card.lat, card.lng]);
        const isTaiwanOriginAirport = card.category === '機場' && ((card.country || '').includes('台') || (card.country || '').includes('臺'));
        if (!isTaiwanOriginAirport) {
          localDestinationCoords.push([card.lat, card.lng]);
        }

        if (isLayerVisible) {
          visiblePinCount++;
          const marker = L.marker([card.lat, card.lng], {
            icon: createColoredPinIcon(meta.color, label)
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
        const est = estimateTransit(card, nextCard);
        const activeMode = est.mode === 'flight' ? 'flight' : (item.transitMode || est.mode);
        let legMin = est.mode === 'flight' ? est.min : (Number(item.transitMin) || est.min);
        let legKm = est.km;

        const nextHasCoords = Number.isFinite(Number(nextCard.lat)) && Number.isFinite(Number(nextCard.lng)) && Number(nextCard.lat) !== 0;

        if (hasCoords && nextHasCoords) {
          if (activeMode === 'flight') {
            const arcPts = buildCurvedFlightArc(card.lat, card.lng, nextCard.lat, nextCard.lng);
            L.polyline(arcPts, { color: '#0284c7', weight: 3, opacity: 0.75, dashArray: '8, 8' }).addTo(mapRouteLayer);
          } else {
            const roadData = await fetchRealRoadPath(card, nextCard, activeMode);
            legKm = roadData.distanceKm || legKm;
            if (!item.transitMin && roadData.durationMin) {
              legMin = activeMode === 'transit' ? Math.max(8, Math.round(roadData.durationMin * 1.25 + 5)) : roadData.durationMin;
            }

            const routeStyle = activeMode === 'walk'
              ? { color: '#10b981', weight: 4.5, opacity: 0.88, dashArray: '5, 7' }
              : (activeMode === 'drive'
                ? { color: '#2563eb', weight: 4.5, opacity: 0.85 }
                : { color: '#7c3aed', weight: 4.5, opacity: 0.85 });

            L.polyline(roadData.latLngs, routeStyle).addTo(mapRouteLayer);
          }
        }

        totalMin += legMin;
        totalKm += legKm;
        const iconPrefix = activeMode === 'flight' ? '✈️ ' : (activeMode === 'walk' ? '🚶 ' : (activeMode === 'drive' ? '🚗 ' : '🚆 '));
        const gdir = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(card.title)}&destination=${encodeURIComponent(nextCard.title)}&travelmode=${activeMode === 'walk' ? 'walking' : (activeMode === 'drive' ? 'driving' : 'transit')}`;
        legsHtml.push(`
          <div class="flex items-center justify-between bg-slate-50 px-2 py-1 rounded border border-slate-100">
            <span class="truncate flex-1 pr-1">${idx + 1}→${idx + 2} ${iconPrefix}${nextCard.title}</span>
            <span class="font-bold text-blue-700 shrink-0 mr-1.5">約 ${legMin} 分</span>
            <a href="${gdir}" target="_blank" title="開啟路線導航" class="text-blue-600 hover:text-blue-800 shrink-0"><i class="fa-solid fa-diamond-turn-right"></i></a>
          </div>
        `);
      }
    }

    if (state.overlayPocketOnPlan) {
      state.cards.forEach(c => {
        if (dayCardIds.has(c.id)) return;
        if (state.mapVisibleCategories[c.category] === false) return;
        const hasCoords = Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng)) && Number(c.lat) !== 0;
        if (!hasCoords) return;

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
      mapInstance.fitBounds(zoomTargetCoords, { padding: [45, 45], maxZoom: 14 });
    }

    document.getElementById('mapPinCounter').textContent = `${visiblePinCount} 釘`;
    document.getElementById('dailyTransitBadge').textContent = `${totalMin} 分 (${totalKm.toFixed(1)} km)`;
    document.getElementById('dailyTransitLegsList').innerHTML = legsHtml.length > 0
      ? legsHtml.join('')
      : `<div class="text-slate-400 text-center py-1">當日尚無跨點移動段次</div>`;
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

  if (Number.isFinite(Number(card.lat)) && Number.isFinite(Number(card.lng)) && Number(card.lat) !== 0 && mapInstance) {
    if (state.mapVisibleCategories[card.category] === false) {
      state.mapVisibleCategories[card.category] = true;
      renderMapCategoryToggles();
      hooks.renderMapMarkers();
    }
    mapInstance.setView([card.lat, card.lng], 15, { animate: true });
  } else if (warnIfMissing) {
    showToast('此卡片尚未設定座標，可點擊編輯填入經緯度', 'amber');
  }
}

export function highlightDatabaseCard(cardId) {
  state.highlightedCardId = cardId;
  hooks.renderDatabaseCards();
  const el = document.getElementById(`db-card-${cardId}`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
