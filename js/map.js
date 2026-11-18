import { CATEGORY_STYLES, DAY_COLORS } from './config.js';
import { state, showToast } from './state.js';

let mapInstance = null;
let markersLayerGroup = null;
let routesLayerGroup = null;
const markerByCardId = {};

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

export function renderMapMarkers(getFilteredCardsFn = null) {
  if (!mapInstance || !markersLayerGroup || !routesLayerGroup) return;

  markersLayerGroup.clearLayers();
  routesLayerGroup.clearLayers();
  Object.keys(markerByCardId).forEach(k => delete markerByCardId[k]);

  const bounds = [];
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
      }).bindPopup(`
        <div class="text-xs space-y-1">
          <div class="font-bold text-slate-800">${card.title}</div>
          <div class="text-slate-500">${card.category}・${card.district || card.country || ''}</div>
        </div>
      `);

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

    daysToDraw.forEach(dayNum => {
      const dayColor = DAY_COLORS[(dayNum - 1) % DAY_COLORS.length];
      const items = state.itinerary[dayNum]?.items || [];
      const dayCoords = [];

      items.forEach((it, idx) => {
        scheduledIds.add(it.cardId);
        const card = state.cards.find(c => c.id === it.cardId);
        if (!card || card.lat === null || card.lng === null) return;

        const lat = Number(card.lat);
        const lng = Number(card.lng);
        if (isNaN(lat) || isNaN(lng)) return;

        dayCoords.push([lat, lng]);
        bounds.push([lat, lng]);
        pinCount++;

        const label = state.mapOverviewAllDays ? `D${dayNum}` : String(idx + 1);
        const marker = L.marker([lat, lng], {
          icon: createPinIcon(dayColor, label, true)
        }).bindPopup(`
          <div class="text-xs space-y-1">
            <div class="font-bold text-slate-800">Day ${dayNum} #${idx + 1}・${card.title}</div>
            <div class="text-slate-500">${card.category}・停留 ${card.duration || 60} 分</div>
          </div>
        `);
        marker.addTo(markersLayerGroup);
        markerByCardId[card.id] = marker;
      });

      if (dayCoords.length >= 2) {
        L.polyline(dayCoords, {
          color: dayColor,
          weight: 4,
          opacity: 0.85
        }).addTo(routesLayerGroup);
      }
    });

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
          opacity: 0.78
        }).bindPopup(`
          <div class="text-xs space-y-1">
            <div class="font-bold text-slate-800">${card.title}（未排入）</div>
            <div class="text-slate-500">${card.category}・${card.district || ''}</div>
          </div>
        `);
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
