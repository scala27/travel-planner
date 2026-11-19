import { CATEGORY_STYLES } from './config.js';
import { state, hooks, showToast } from './state.js';
import { estimateLegTransit, getDayColor, getFormattedDateInfo } from './ui-board.js';

let leafletMap = null;
let markerLayerGroup = null;
let routeLayerGroup = null;
const markerLookup = {};
const routeCache = {};
const MAX_CONCURRENT_OSRM = 2;
let activeOsrmCount = 0;
const osrmTaskQueue = [];

function enqueueOsrmTask(fn) {
  return new Promise(resolve => {
    const run = async () => {
      activeOsrmCount++;
      try {
        resolve(await fn());
      } catch (err) {
        resolve(null);
      } finally {
        activeOsrmCount--;
        if (osrmTaskQueue.length > 0) {
          const next = osrmTaskQueue.shift();
          next();
        }
      }
    };
    if (activeOsrmCount < MAX_CONCURRENT_OSRM) {
      run();
    } else {
      osrmTaskQueue.push(run);
    }
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isValidCoord(lat, lng) {
  if (lat === null || lng === null || lat === undefined || lng === undefined || lat === '' || lng === '') return false;
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (isNaN(nLat) || isNaN(nLng)) return false;
  if (Math.abs(nLat) < 0.0001 && Math.abs(nLng) < 0.0001) return false;
  return nLat >= -90 && nLat <= 90 && nLng >= -180 && nLng <= 180;
}

function buildDayQuickAssignPopupHtml(cardId) {
  if (state.isReadOnly) return '';
  const totalDays = Math.max(1, Number(state.settings.totalDays) || 6);
  const defaultDay = Math.min(totalDays, Math.max(1, Number(state.selectedMapDay) || 1));

  let optionsHtml = '';
  for (let d = 1; d <= totalDays; d++) {
    const info = getFormattedDateInfo(d);
    const selAttr = d === defaultDay ? ' selected' : '';
    optionsHtml += '<option value="' + d + '"' + selAttr + '>Day ' + d + ' (' + info.md + ')</option>';
  }

  return (
    '<div class="inline-flex items-stretch rounded-lg overflow-hidden shadow-2xs shrink-0">' +
      '<button type="button" data-card-id="' + escapeHtml(cardId) + '" ' +
        'onclick="const sel=this.nextElementSibling; addCardToDay(this.dataset.cardId, Number(sel ? sel.value : ' + defaultDay + '));" ' +
        'class="pl-2.5 pr-1.5 py-1.5 bg-[#2C4D6E] hover:bg-[#233E59] text-white text-[11px] font-bold flex items-center gap-1 transition cursor-pointer">' +
        '<span>＋ 排入</span>' +
      '</button>' +
      '<select aria-label="選擇排入天數" ' +
        'onchange="if(this.value){ addCardToDay(this.previousElementSibling.dataset.cardId, Number(this.value)); }" ' +
        'class="pl-1 pr-1.5 py-1.5 bg-[#233E59] hover:bg-[#1B3147] text-white text-[11px] font-bold border-l border-white/20 focus:outline-none cursor-pointer">' +
        optionsHtml +
      '</select>' +
    '</div>'
  );
}

function buildPopupHtml(card, orderBadgeText = '') {
  const style = CATEGORY_STYLES[card.category] || CATEGORY_STYLES['景點'];
  const googleMapsLink = card.mapUrl || 'https://www.google.com/maps/search/?api=1&query=' + card.lat + ',' + card.lng;
  const highlightText = String(card.must_buy || card.meta?.must_buy || '').trim();
  const detailText = String(card.notes || card.description || '').trim();

  const quickAssignHtml = buildDayQuickAssignPopupHtml(card.id);
  const editIconHtml = state.isReadOnly
    ? ''
    : '<button type="button" onclick="openCardModal(\'' + escapeHtml(card.id) + '\')" title="編輯卡片資料" ' +
      'class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center text-xs transition shrink-0">' +
      '<i class="fa-solid fa-pen"></i>' +
      '</button>';

  return (
    '<div class="w-[235px] max-w-[72vw] space-y-2 text-slate-800 font-sans">' +
      '<div class="flex items-center justify-between gap-1.5 flex-wrap">' +
        '<span class="px-2 py-0.5 rounded-md text-[11px] font-bold ' + style.badge + '">' + escapeHtml(card.category) + '</span>' +
        (orderBadgeText ? '<span class="px-2 py-0.5 rounded-md bg-slate-800 text-white text-[10px] font-bold">' + escapeHtml(orderBadgeText) + '</span>' : '') +
      '</div>' +
      '<div>' +
        '<h4 class="font-bold text-sm leading-snug text-slate-900 break-words">' + escapeHtml(card.title) + '</h4>' +
        '<p class="text-[11px] text-slate-500 mt-0.5">' + escapeHtml(card.district || card.country || '') + '・停留約 ' + (card.duration || 60) + ' 分</p>' +
      '</div>' +
      (highlightText ? '<div class="text-[11px] text-amber-700 bg-amber-50 px-2 py-1 rounded-md border border-amber-200/80 leading-snug">⭐ ' + escapeHtml(highlightText) + '</div>' : '') +
      (detailText ? '<p class="text-[11px] text-slate-600 line-clamp-3 leading-relaxed bg-slate-50 p-1.5 rounded-md border border-slate-100 break-words">' + escapeHtml(detailText) + '</p>' : '') +
      '<div class="pt-1.5 border-t border-slate-100 flex items-center justify-between gap-1.5">' +
        quickAssignHtml +
        '<div class="flex items-center gap-1 shrink-0 ml-auto">' +
          editIconHtml +
          '<a href="' + escapeHtml(googleMapsLink) + '" target="_blank" rel="noopener" title="在 Google 地圖開啟" ' +
            'class="w-7 h-7 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center justify-center text-xs transition shrink-0">' +
            '<i class="fa-solid fa-diamond-turn-right"></i>' +
          '</a>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

export function initLeafletMap() {
  const container = document.getElementById('mapContainer');
  if (!container || leafletMap) return;

  leafletMap = L.map('mapContainer', {
    zoomControl: true,
    attributionControl: true
  }).setView([26.2124, 127.6809], 11);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(leafletMap);

  markerLayerGroup = L.layerGroup().addTo(leafletMap);
  routeLayerGroup = L.layerGroup().addTo(leafletMap);
}

export function invalidateMapSize() {
  if (leafletMap) {
    leafletMap.invalidateSize();
  }
}

export function renderMapCategoryToggles() {
  const box = document.getElementById('mapCategoryToggleContainer');
  if (!box) return;
  const categories = Object.keys(CATEGORY_STYLES);
  box.innerHTML = categories
    .map(cat => {
      const style = CATEGORY_STYLES[cat];
      const active = state.visibleMapLayers[cat] !== false;
      return (
        '<button type="button" onclick="toggleMapCategoryLayer(\'' + cat + '\')" ' +
        'class="px-2 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1 border transition ' +
        (active
          ? 'bg-white border-slate-300 text-slate-800 shadow-2xs'
          : 'bg-slate-100 border-slate-200 text-slate-400 opacity-60') + '">' +
        '<span class="w-2 h-2 rounded-full" style="background:' + (active ? style.hex : '#94a3b8') + '"></span>' +
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
  Object.keys(state.visibleMapLayers).forEach(cat => {
    state.visibleMapLayers[cat] = cat === '景點';
  });
  renderMapCategoryToggles();
  renderMapMarkers();
}

export function setAllMapLayersVisible(visible) {
  Object.keys(state.visibleMapLayers).forEach(cat => {
    state.visibleMapLayers[cat] = Boolean(visible);
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

function createPinIcon(hexColor, labelText = '', isDimmed = false) {
  const size = labelText ? 26 : 20;
  const opacity = isDimmed ? 0.78 : 1;
  const html =
    '<div style="width:' + size + 'px;height:' + size + 'px;background:' + hexColor + ';opacity:' + opacity + ';" ' +
    'class="rounded-full border-2 border-white shadow-md flex items-center justify-center text-white font-extrabold text-[11px]">' +
    escapeHtml(labelText) +
    '</div>';

  return L.divIcon({
    className: 'echi-custom-pin',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
}

function calcDirectKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function detectRoutingProfile(cardA, cardB, itemB) {
  const itemMode = itemB?.transitMode && itemB.transitMode !== 'auto' ? itemB.transitMode : null;
  const globalMode = document.getElementById('transitProfileSelect')?.value || 'smart';
  const effective = itemMode || globalMode;
  const km = calcDirectKm(cardA.lat, cardA.lng, cardB.lat, cardB.lng);

  if (effective === 'walk') return 'foot';
  if (effective === 'drive' || effective === 'taxi' || effective === 'transit') return 'driving';
  return km <= 1.2 ? 'foot' : 'driving';
}

function isReasonableStreetRoute(routeCoords, directKm) {
  if (!Array.isArray(routeCoords) || routeCoords.length < 2) return false;
  let routeKm = 0;
  for (let i = 1; i < routeCoords.length; i++) {
    routeKm += calcDirectKm(
      routeCoords[i - 1][0],
      routeCoords[i - 1][1],
      routeCoords[i][0],
      routeCoords[i][1]
    );
  }
  if (directKm < 0.25 && routeKm > 1.2) return false;
  if (directKm >= 0.25 && directKm < 2.0 && routeKm > directKm * 3.8) return false;
  if (directKm >= 2.0 && routeKm > directKm * 2.8) return false;
  return true;
}

async function fetchStreetRouteCoords(cardA, cardB, itemB) {
  const profile = detectRoutingProfile(cardA, cardB, itemB);
  const directKm = calcDirectKm(cardA.lat, cardA.lng, cardB.lat, cardB.lng);
  const key =
    profile + ':' +
    Number(cardA.lat).toFixed(5) + ',' + Number(cardA.lng).toFixed(5) + '->' +
    Number(cardB.lat).toFixed(5) + ',' + Number(cardB.lng).toFixed(5);

  if (routeCache[key]) return routeCache[key];

  return enqueueOsrmTask(async () => {
    if (routeCache[key]) return routeCache[key];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const url =
        'https://router.project-osrm.org/route/v1/' + profile + '/' +
        cardA.lng + ',' + cardA.lat + ';' + cardB.lng + ',' + cardB.lat +
        '?overview=full&geometries=geojson';
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json();
      if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
        const coords = data.routes[0].geometry.coordinates.map(pt => [pt[1], pt[0]]);
        if (isReasonableStreetRoute(coords, directKm)) {
          routeCache[key] = coords;
          return coords;
        }
      }
    } catch (err) {}
    return null;
  });
}

let renderSessionToken = 0;

export async function renderMapMarkers(getFilteredCardsFn) {
  if (!leafletMap || !markerLayerGroup || !routeLayerGroup) return;

  const currentToken = ++renderSessionToken;
  markerLayerGroup.clearLayers();
  routeLayerGroup.clearLayers();
  Object.keys(markerLookup).forEach(k => delete markerLookup[k]);

  const boundsPoints = [];
  const includeFlight = Boolean(document.getElementById('chkIncludeCrossSeaFlight')?.checked);
  const legsSummaryBox = document.getElementById('dailyTransitLegsList');
  const transitBadge = document.getElementById('dailyTransitBadge');
  const multiDayLegendBox = document.getElementById('multiDayLegendBox');

  if (state.mode === 'collect' && !state.isReadOnly) {
    const cards = typeof getFilteredCardsFn === 'function' ? getFilteredCardsFn() : state.cards;
    let visibleCount = 0;

    cards.forEach(card => {
      if (state.visibleMapLayers[card.category] === false) return;
      if (!isValidCoord(card.lat, card.lng)) return;

      const style = CATEGORY_STYLES[card.category] || CATEGORY_STYLES['景點'];
      const marker = L.marker([Number(card.lat), Number(card.lng)], {
        icon: createPinIcon(style.hex)
      }).bindPopup(buildPopupHtml(card));

      marker.addTo(markerLayerGroup);
      markerLookup[card.id] = marker;
      boundsPoints.push([Number(card.lat), Number(card.lng)]);
      visibleCount++;
    });

    const counterEl = document.getElementById('mapPinCounter');
    if (counterEl) counterEl.textContent = visibleCount + ' 釘';

    if (boundsPoints.length > 0) {
      leafletMap.fitBounds(boundsPoints, { padding: [36, 36], maxZoom: 14 });
    }
    return;
  }

  const totalDays = Math.max(1, Number(state.settings.totalDays) || 6);
  const daysToDraw = state.mapOverviewAllDays
    ? Array.from({ length: totalDays }, (_, i) => i + 1)
    : [Math.min(totalDays, Math.max(1, Number(state.selectedMapDay) || 1))];

  if (multiDayLegendBox) {
    if (state.mapOverviewAllDays) {
      multiDayLegendBox.classList.remove('hidden');
      multiDayLegendBox.classList.add('flex');
      multiDayLegendBox.innerHTML = daysToDraw
        .map(d => {
          const c = getDayColor(d);
          return (
            '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-[10px] font-bold text-slate-700">' +
            '<span class="w-2 h-2 rounded-full" style="background:' + c + '"></span>Day ' + d +
            '</span>'
          );
        })
        .join('');
    } else {
      multiDayLegendBox.classList.add('hidden');
      multiDayLegendBox.classList.remove('flex');
    }
  }

  const scheduledCardIds = new Set();
  let totalMinAll = 0;
  let totalKmAll = 0;
  const legHtmlList = [];
  const pendingStreetTasks = [];

  for (const dayNum of daysToDraw) {
    const dayColor = getDayColor(dayNum);
    const items = state.itinerary[dayNum]?.items || [];
    const dayValidStops = [];

    items.forEach((item, idx) => {
      const card = state.cards.find(c => c.id === item.cardId);
      if (!card) return;
      scheduledCardIds.add(card.id);

      if (!isValidCoord(card.lat, card.lng)) return;
      dayValidStops.push({ card, item, seq: idx + 1 });

      const badgeText = state.mapOverviewAllDays ? 'D' + dayNum + '-' + (idx + 1) : 'Day ' + dayNum + ' 第 ' + (idx + 1) + ' 站';
      const marker = L.marker([Number(card.lat), Number(card.lng)], {
        icon: createPinIcon(dayColor, String(idx + 1), false),
        zIndexOffset: 500
      }).bindPopup(buildPopupHtml(card, badgeText));

      marker.addTo(markerLayerGroup);
      markerLookup[card.id] = marker;

      if (includeFlight || card.category !== '機場') {
        boundsPoints.push([Number(card.lat), Number(card.lng)]);
      }
    });

    for (let i = 1; i < dayValidStops.length; i++) {
      const prev = dayValidStops[i - 1];
      const curr = dayValidStops[i];
      const leg = estimateLegTransit(prev.card, curr.card, curr.item);
      totalMinAll += leg.min;
      totalKmAll += leg.km;

      legHtmlList.push(
        '<div class="flex items-center justify-between gap-2 px-2 py-1 rounded bg-slate-50 border border-slate-100">' +
        '<span class="truncate font-medium text-slate-700">' +
        '<strong style="color:' + dayColor + '">D' + dayNum + '</strong> ' +
        escapeHtml(prev.card.title) + ' → ' + escapeHtml(curr.card.title) +
        '</span>' +
        '<span class="shrink-0 text-slate-500">' + leg.km + 'km / ' + leg.min + '分</span>' +
        '</div>'
      );

      if (leg.km > 250) {
        if (includeFlight) {
          L.polyline(
            [
              [Number(prev.card.lat), Number(prev.card.lng)],
              [Number(curr.card.lat), Number(curr.card.lng)]
            ],
            { color: dayColor, weight: 2.5, dashArray: '6, 8', opacity: 0.7 }
          ).addTo(routeLayerGroup);
        }
      } else {
        const provisionalLine = L.polyline(
          [
            [Number(prev.card.lat), Number(prev.card.lng)],
            [Number(curr.card.lat), Number(curr.card.lng)]
          ],
          { color: dayColor, weight: 3, dashArray: '4, 6', opacity: 0.45 }
        ).addTo(routeLayerGroup);

        pendingStreetTasks.push({
          prevCard: prev.card,
          currCard: curr.card,
          currItem: curr.item,
          dayColor,
          provisionalLine
        });
      }
    }
  }

  let pocketPinCount = 0;
  if (!state.isReadOnly && state.overlayPocketOnPlan) {
    state.cards.forEach(card => {
      if (scheduledCardIds.has(card.id)) return;
      if (state.visibleMapLayers[card.category] === false) return;
      if (!isValidCoord(card.lat, card.lng)) return;

      const style = CATEGORY_STYLES[card.category] || CATEGORY_STYLES['景點'];
      const marker = L.marker([Number(card.lat), Number(card.lng)], {
        icon: createPinIcon(style.hex, '', true)
      }).bindPopup(buildPopupHtml(card, '尚未排入'));

      marker.addTo(markerLayerGroup);
      if (!markerLookup[card.id]) markerLookup[card.id] = marker;
      pocketPinCount++;
    });
  }

  if (transitBadge) {
    transitBadge.textContent = totalMinAll + ' 分 (' + totalKmAll.toFixed(1) + ' km)';
  }
  if (legsSummaryBox) {
    legsSummaryBox.innerHTML = legHtmlList.length > 0
      ? legHtmlList.join('')
      : '<p class="text-slate-400 italic py-1">此日尚無兩點以上的移動路線</p>';
  }
  const counterEl = document.getElementById('mapPinCounter');
  if (counterEl) {
    counterEl.textContent = scheduledCardIds.size + ' 已排' + (pocketPinCount > 0 ? ' + ' + pocketPinCount + ' 口袋' : '');
  }

  if (boundsPoints.length > 0) {
    leafletMap.fitBounds(boundsPoints, { padding: [42, 42], maxZoom: 14 });
  }

  for (const task of pendingStreetTasks) {
    fetchStreetRouteCoords(task.prevCard, task.currCard, task.currItem).then(streetCoords => {
      if (currentToken !== renderSessionToken) return;
      if (streetCoords && streetCoords.length > 1) {
        if (task.provisionalLine && routeLayerGroup.hasLayer(task.provisionalLine)) {
          routeLayerGroup.removeLayer(task.provisionalLine);
        }
        L.polyline(streetCoords, {
          color: task.dayColor,
          weight: 4,
          opacity: 0.88
        }).addTo(routeLayerGroup);
      } else if (task.provisionalLine) {
        task.provisionalLine.setStyle({ dashArray: null, opacity: 0.72, weight: 3.5 });
      }
    });
  }
}

export function fitMapToFilteredCards() {
  if (!leafletMap || !markerLayerGroup) return;
  const latLngs = [];
  markerLayerGroup.eachLayer(layer => {
    if (typeof layer.getLatLng === 'function') {
      latLngs.push(layer.getLatLng());
    }
  });
  if (latLngs.length > 0) {
    leafletMap.fitBounds(latLngs, { padding: [36, 36], maxZoom: 14 });
  }
}

export function focusCardOnMap(cardId, warnIfMissing = true) {
  const card = state.cards.find(c => c.id === cardId);
  if (!card) return;
  if (!isValidCoord(card.lat, card.lng)) {
    if (warnIfMissing) showToast('此景點尚未設定經緯度座標', 'amber');
    return;
  }

  if (leafletMap) {
    leafletMap.invalidateSize();
    leafletMap.setView([Number(card.lat), Number(card.lng)], 15, { animate: true });
    const marker = markerLookup[card.id];
    if (marker) {
      setTimeout(() => marker.openPopup(), 220);
    }
  }
}

export function highlightDatabaseCard(cardId) {
  const el = document.querySelector('[data-card-id="' + cardId + '"]');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-[#2C4D6E]');
    setTimeout(() => el.classList.remove('ring-2', 'ring-[#2C4D6E]'), 1600);
  }
}
