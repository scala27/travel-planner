import {
  PRESET_DISTRICTS,
  CATEGORY_LIST,
  CATEGORY_META,
  isTransportOrAirport
} from './config.js';
import {
  state,
  hooks,
  persistState,
  getCardScheduledDays,
  showToast
} from './state.js';
import {
  normalizeAdministrativeDistrict,
  geocodePlaceName,
  reverseGeocodeCoords,
  extractCoordsFromText,
  extractTitleFromInputLine,
  haversineKm,
  formatDistanceLabel
} from './geo.js';
import { pushAllToGoogleSheets } from './api.js';
import { getHotelActualStayNights } from './ui-board.js';

export function updateMiniCardButtonUi() {
  const btn = document.getElementById('btnMiniCardToggle');
  const label = document.getElementById('miniCardBtnLabel');
  if (!btn || !label) return;
  if (state.miniCardView) {
    btn.className = 'px-2.5 py-1 rounded-lg border border-blue-600 bg-blue-600 text-white text-xs font-bold flex items-center gap-1 shadow-2xs transition';
    label.textContent = '完整卡片';
  } else {
    btn.className = 'px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1 transition';
    label.textContent = '迷你卡片';
  }
}

export function toggleMiniCardMode() {
  state.miniCardView = !state.miniCardView;
  updateMiniCardButtonUi();
  renderDatabaseCards();
}

export function toggleBatchImportBox() {
  document.getElementById('batchImportBox').classList.toggle('hidden');
}

export function setPlanQuickFilter(val) {
  state.planQuickFilter = val;
  document.querySelectorAll('.plan-q-btn').forEach(btn => {
    const active = btn.dataset.planQ === val;
    btn.className = active
      ? 'plan-q-btn px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-600 text-white'
      : 'plan-q-btn px-2 py-0.5 rounded-md text-[11px] font-medium bg-white border border-slate-200 text-slate-600';
  });
  renderDatabaseCards();
  if (state.mode === 'plan' && state.overlayPocketOnPlan) {
    hooks.renderMapMarkers();
  }
}

export function togglePlanProximitySort() {
  state.planSortByProximity = !state.planSortByProximity;
  renderDatabaseCards();
}

export function getCardProximityToSelectedDay(card) {
  const lat = Number(card?.lat);
  const lng = Number(card?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) {
    return null;
  }

  const dayNum = state.selectedMapDay;
  const dayItems = state.itinerary[dayNum]?.items || [];
  let minKm = Infinity;
  let nearestAnchorName = '';

  dayItems.forEach(it => {
    if (it.cardId === card.id) return;
    const anchor = state.cards.find(c => c.id === it.cardId);
    if (!anchor) return;
    const aLat = Number(anchor.lat);
    const aLng = Number(anchor.lng);
    if (!Number.isFinite(aLat) || !Number.isFinite(aLng) || aLat === 0 || aLng === 0) return;

    const d = haversineKm(lat, lng, aLat, aLng);
    if (d < minKm) {
      minKm = d;
      nearestAnchorName = anchor.title;
    }
  });

  if (!Number.isFinite(minKm)) return null;
  return {
    km: minKm,
    anchorName: nearestAnchorName,
    shortAnchor: nearestAnchorName.length > 7 ? nearestAnchorName.slice(0, 7) + '…' : nearestAnchorName,
    label: formatDistanceLabel(minKm),
    isVeryClose: minKm <= 0.6,
    isNearby: minKm <= 1.8
  };
}

export function setFilter(type, value, shouldRender = true) {
  state.filters[type] = value;

  if (type === 'scope') {
    document.querySelectorAll('.scope-btn').forEach(btn => {
      const active = btn.dataset.filterScope === value;
      btn.className = active
        ? 'scope-btn px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-800 text-white'
        : 'scope-btn px-2 py-0.5 rounded-md text-[11px] font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50';
    });
  } else if (type === 'category') {
    document.querySelectorAll('.cat-btn').forEach(btn => {
      const active = btn.dataset.filterCat === value;
      btn.className = active
        ? 'cat-btn px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-600 text-white'
        : 'cat-btn px-2 py-0.5 rounded-md text-[11px] font-medium bg-white border border-slate-200 text-slate-600';
    });
  } else if (type === 'status') {
    document.querySelectorAll('.status-btn').forEach(btn => {
      const active = btn.dataset.filterStatus === value;
      btn.className = active
        ? 'status-btn px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-700 text-white'
        : 'status-btn px-2 py-0.5 rounded-md text-[11px] font-medium bg-white border border-slate-200 text-slate-600';
    });
  }

  if (shouldRender) {
    renderDatabaseCards();
    if (state.mode === 'collect') hooks.renderMapMarkers();
  }
}

export function clearSearch() {
  document.getElementById('searchInput').value = '';
  renderDatabaseCards();
  hooks.renderMapMarkers();
}

export function getFilteredAndSortedCards() {
  const kw = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();

  if (state.mode === 'plan') {
    const filtered = state.cards.filter(card => {
      const scheduledDays = getCardScheduledDays(card.id);
      if (state.planQuickFilter === 'unscheduled' && scheduledDays.length > 0) return false;
      if (CATEGORY_LIST.includes(state.planQuickFilter) && card.category !== state.planQuickFilter) return false;
      if (kw) {
        const hay = `${card.title} ${card.district} ${card.country} ${card.notes} ${card.category}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });

    if (state.planSortByProximity) {
      return [...filtered].sort((a, b) => {
        const pa = getCardProximityToSelectedDay(a);
        const pb = getCardProximityToSelectedDay(b);
        const da = pa ? pa.km : 99999;
        const db = pb ? pb.km : 99999;
        if (Math.abs(da - db) > 0.01) return da - db;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
    }
    return filtered;
  }

  const countryVal = document.getElementById('countryFilter')?.value || 'all';
  const cityVal = document.getElementById('cityFilter')?.value || 'all';
  const sortBy = document.getElementById('sortSelect')?.value || 'newest';

  let list = state.cards.filter(card => {
    const isDomestic = (card.country || '').includes('台') || (card.country || '').includes('臺');
    if (state.filters.scope === 'domestic' && !isDomestic) return false;
    if (state.filters.scope === 'international' && isDomestic) return false;

    if (countryVal !== 'all' && (card.country || '未分類') !== countryVal) return false;
    if (cityVal !== 'all' && (card.district || '未分類') !== cityVal) return false;
    if (state.filters.category !== 'all' && card.category !== state.filters.category) return false;

    const scheduledDays = getCardScheduledDays(card.id);
    if (state.filters.status === 'unscheduled' && scheduledDays.length > 0) return false;
    if (state.filters.status === 'scheduled' && scheduledDays.length === 0) return false;
    if (state.filters.status === 'starred' && !card.starred) return false;

    if (kw) {
      const hay = `${card.title} ${card.district} ${card.country} ${card.notes} ${card.mustBuy || ''} ${card.flightNo || ''} ${card.businessHours || ''} ${card.category}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });

  list = [...list];
  if (sortBy === 'newest') {
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else if (sortBy === 'unscheduled') {
    list.sort((a, b) => {
      const sa = getCardScheduledDays(a.id).length;
      const sb = getCardScheduledDays(b.id).length;
      if (sa !== sb) return sa - sb;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  } else if (sortBy === 'district') {
    list.sort((a, b) => (a.district || 'zzz').localeCompare(b.district || 'zzz', 'zh-Hant'));
  }
  return list;
}

export function toggleCardDetailExpand(cardId) {
  state.expandedCards[cardId] = !state.expandedCards[cardId];
  renderDatabaseCards();
}

function renderCategorySummaryHtml(card) {
  const blocks = [];

  if (isTransportOrAirport(card.category)) {
    const iconCls = card.category === '機場' ? 'fa-plane-departure text-sky-600' : 'fa-train-subway text-slate-600';
    if (card.departTime || card.arriveTime) {
      blocks.push(`
        <div class="text-[11px] font-bold text-slate-800 bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 flex items-center gap-1.5 flex-wrap">
          <i class="fa-solid ${iconCls}"></i>
          <span>${card.departTime ? '出境/起飛：' + card.departTime : ''}</span>
          ${card.arriveTime ? `<span class="text-blue-700">入境/抵達：${card.arriveTime}</span>` : ''}
        </div>
      `);
    } else if (card.businessHours) {
      blocks.push(`<div class="text-[11px] font-bold text-slate-700 bg-slate-100 rounded-lg px-2 py-1"><i class="fa-solid fa-clock text-blue-600 mr-1"></i>${card.businessHours}</div>`);
    }
    if (card.flightNo || card.mustBuy) {
      blocks.push(`<div class="text-[11px] text-blue-800 bg-blue-50/80 border border-blue-100 rounded-lg px-2 py-1"><i class="fa-solid fa-ticket mr-1"></i>班次/航廈：${card.flightNo || card.mustBuy}</div>`);
    }
  } else if (card.category === '住宿') {
    if (card.checkInOut || card.businessHours) {
      blocks.push(`<div class="text-[11px] font-semibold text-purple-800 bg-purple-50 border border-purple-100 rounded-lg px-2 py-1"><i class="fa-solid fa-key mr-1"></i>入退房：${card.checkInOut || card.businessHours}</div>`);
    }
    if (card.bookingRef || card.mustBuy) {
      blocks.push(`<div class="text-[11px] text-slate-700 bg-slate-100 rounded-lg px-2 py-1"><i class="fa-solid fa-receipt mr-1"></i>房型/代號：${card.bookingRef || card.mustBuy}</div>`);
    }
  } else {
    if (card.businessHours) {
      blocks.push(`<div class="text-[11px] text-blue-800 bg-blue-50/70 border border-blue-100 rounded-lg px-2 py-1"><i class="fa-regular fa-clock mr-1"></i>營業：${card.businessHours}</div>`);
    }
    if (card.mustBuy) {
      const label = card.category === '美食' ? '必吃' : (card.category === '購物' ? '必買' : '亮點');
      blocks.push(`<div class="text-[11px] text-amber-800 bg-amber-50/80 border border-amber-100 rounded-lg px-2 py-1"><i class="fa-solid fa-star text-amber-500 mr-1"></i>${label}：${card.mustBuy}</div>`);
    }
  }

  if (card.parkingInfo) {
    blocks.push(`<div class="text-[11px] text-slate-600 bg-slate-50 border border-slate-200/80 rounded-lg px-2 py-1"><i class="fa-solid fa-square-parking text-slate-500 mr-1"></i>${card.parkingInfo}</div>`);
  }

  if (card.notes) {
    blocks.push(`
      <div class="text-[11px] text-slate-700 bg-slate-50 border border-slate-200/70 rounded-lg px-2.5 py-1.5 leading-relaxed whitespace-pre-line break-words">
        ${card.notes}
      </div>
    `);
  }

  return blocks.join('');
}

function getDisplayDaysForCard(card) {
  if (card.category === '住宿') {
    const nights = getHotelActualStayNights(card.id);
    if (nights.length > 0) return nights;
  }
  return getCardScheduledDays(card.id);
}

export function renderDatabaseCards() {
  const container = document.getElementById('databaseCardsContainer');
  const cards = getFilteredAndSortedCards();
  updateCountersAndDropdowns();

  if (cards.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-10 text-center text-slate-400 px-3">
        <i class="fa-solid fa-folder-open text-2xl mb-2"></i>
        <p class="text-xs font-medium">目前無符合條件的卡片</p>
      </div>`;
    return;
  }

  const totalDays = Number(state.settings.totalDays) || 6;
  const dayOptionsHtml = Array.from({ length: totalDays }, (_, i) => `<option value="${i + 1}">+ Day ${i + 1}</option>`).join('');

  if (state.mode === 'plan') {
    const hasDayStops = (state.itinerary[state.selectedMapDay]?.items || []).length > 0;
    const sortHeaderHtml = hasDayStops ? `
      <div class="flex items-center justify-between px-1 pb-0.5 text-[10px] text-slate-500 shrink-0">
        <span>共 ${cards.length} 筆（點擊卡片可在地圖高亮）</span>
        <button type="button" onclick="togglePlanProximitySort()"
          class="px-1.5 py-0.5 rounded border transition font-bold flex items-center gap-1 ${state.planSortByProximity ? 'bg-teal-50 text-teal-800 border-teal-300' : 'bg-white text-slate-600 border-slate-200'}">
          <i class="fa-solid fa-location-crosshairs"></i>
          <span>${state.planSortByProximity ? `離 Day ${state.selectedMapDay} 最近` : '預設排序'}</span>
        </button>
      </div>
    ` : '';

    container.innerHTML = sortHeaderHtml + cards.map(card => {
      const meta = CATEGORY_META[card.category] || CATEGORY_META['景點'];
      const displayDays = getDisplayDaysForCard(card);
      const isScheduled = getCardScheduledDays(card.id).length > 0;
      const isHighlighted = state.highlightedCardId === card.id;
      const chipText = card.category === '住宿' && displayDays.length > 0
        ? `D${displayDays.join(',')} (${displayDays.length}晚)`
        : `D${displayDays.join(',')}`;
      const statusChip = isScheduled
        ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-600 text-white shrink-0">${chipText}</span>`
        : '';
      const cleanDist = normalizeAdministrativeDistrict(card.district, card.country).replace(/^沖繩縣・/, '');

      const prox = getCardProximityToSelectedDay(card);
      const proxBadgeHtml = prox
        ? `<div class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${prox.isVeryClose ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : (prox.isNearby ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-500')}">
             <i class="fa-solid fa-route text-[9px]"></i>
             <span>距${prox.shortAnchor} ${prox.label}</span>
           </div>`
        : '';

      return `
        <div id="db-card-${card.id}"
          draggable="true"
          ondragstart="onDragStartCard(event, '${card.id}')"
          onclick="focusCardOnMap('${card.id}')"
          class="shrink-0 bg-white rounded-xl border ${isHighlighted ? 'border-blue-500 ring-2 ring-blue-200' : (isScheduled ? 'border-emerald-200 bg-emerald-50/15' : 'border-slate-200')} hover:border-blue-400 p-2 shadow-2xs transition cursor-pointer space-y-1">
          
          <div class="flex items-start justify-between gap-1.5">
            <div class="flex items-start gap-1.5 min-w-0">
              <span class="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style="background-color:${meta.color}"></span>
              <h4 class="font-bold text-xs text-slate-800 leading-snug break-words">${card.title}</h4>
            </div>
            ${statusChip}
          </div>

          ${proxBadgeHtml ? `<div>${proxBadgeHtml}</div>` : ''}

          <div class="flex items-center justify-between gap-1 pt-0.5" onclick="event.stopPropagation()">
            <span class="text-[10px] text-slate-500 truncate">${cleanDist}・${card.duration || 60}分</span>
            <button onclick="addCardToDay('${card.id}', ${state.selectedMapDay})"
              class="px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white border border-blue-200 text-[10px] font-bold shrink-0 transition">
              + Day ${state.selectedMapDay}
            </button>
          </div>
        </div>
      `;
    }).join('');
    return;
  }

  if (state.miniCardView) {
    container.innerHTML = cards.map(card => {
      const meta = CATEGORY_META[card.category] || CATEGORY_META['景點'];
      const displayDays = getDisplayDaysForCard(card);
      const isScheduled = getCardScheduledDays(card.id).length > 0;
      const isHighlighted = state.highlightedCardId === card.id;
      const hasCoords = Number.isFinite(Number(card.lat)) && Number.isFinite(Number(card.lng)) && Number(card.lat) !== 0;
      const cleanDist = normalizeAdministrativeDistrict(card.district, card.country).replace(/^沖繩縣・/, '');

      return `
        <div id="db-card-${card.id}"
          draggable="true"
          ondragstart="onDragStartCard(event, '${card.id}')"
          onclick="focusCardOnMap('${card.id}')"
          class="bg-white rounded-xl border ${isScheduled ? 'border-emerald-200 bg-emerald-50/15' : 'border-slate-200'} hover:border-blue-400 p-2.5 shadow-2xs transition cursor-pointer flex flex-col justify-between gap-1.5 ${isHighlighted ? 'card-is-highlighted' : ''}">
          <div class="flex items-start justify-between gap-1.5">
            <div class="flex items-start gap-1.5 min-w-0">
              <span class="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style="background-color:${meta.color}"></span>
              <h4 class="font-bold text-xs text-slate-800 leading-snug line-clamp-2 break-words" title="${card.title}">${card.title}</h4>
            </div>
            <span class="px-1.5 py-0.5 rounded text-[9px] font-bold border shrink-0 ${meta.badgeBg}">${card.category}</span>
          </div>

          <div class="flex items-center justify-between gap-1 pt-1 border-t border-slate-100 text-[10px]" onclick="event.stopPropagation()">
            <div class="flex items-center gap-1 min-w-0">
              ${!hasCoords ? `<span class="text-rose-600 font-bold" title="待補座標">⚠</span>` : ''}
              <span class="text-slate-500 truncate">${cleanDist}</span>
              ${isScheduled ? `<span class="px-1 rounded bg-emerald-600 text-white font-bold shrink-0">D${displayDays.join(',')}</span>` : ''}
            </div>
            <div class="flex items-center gap-0.5 shrink-0">
              <button onclick="openCardModal('${card.id}')" title="編輯"
                class="w-5 h-5 rounded hover:bg-amber-50 text-slate-500 hover:text-amber-600 flex items-center justify-center">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button onclick="deleteCard('${card.id}')" title="刪除"
                class="w-5 h-5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 flex items-center justify-center">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
    return;
  }

  container.innerHTML = cards.map(card => {
    const meta = CATEGORY_META[card.category] || CATEGORY_META['景點'];
    const displayDays = getDisplayDaysForCard(card);
    const isScheduled = getCardScheduledDays(card.id).length > 0;
    const hasCoords = Number.isFinite(Number(card.lat)) && Number.isFinite(Number(card.lng)) && Number(card.lat) !== 0;
    const cleanDist = normalizeAdministrativeDistrict(card.district, card.country);
    const gmapsUrl = card.mapUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.title + ' ' + cleanDist)}`;

    let statusBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 shrink-0">未排入</span>`;
    if (isScheduled) {
      const dayLabel = card.category === '住宿' && displayDays.length > 0
        ? `Day ${displayDays.join(',')} (住${displayDays.length}晚)`
        : displayDays.map(d => `Day ${d}`).join(', ');
      statusBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 text-white shadow-2xs shrink-0"><i class="fa-solid fa-check mr-0.5"></i>${dayLabel}</span>`;
    }

    const newBadge = card.isNew
      ? `<span class="px-1.5 py-0.5 rounded bg-amber-500 text-white text-[10px] font-extrabold tracking-wide shadow-2xs shrink-0">NEW</span>`
      : '';

    const coordBadge = hasCoords
      ? `<span class="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded inline-flex items-center gap-1" title="${card.lat}, ${card.lng}"><i class="fa-solid fa-location-dot"></i>已定位</span>`
      : `<span class="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded inline-flex items-center gap-1"><i class="fa-solid fa-triangle-exclamation"></i>待補座標</span>`;

    const isHighlighted = state.highlightedCardId === card.id;
    const detailsHtml = renderCategorySummaryHtml(card);
    const hasDetails = Boolean(detailsHtml);
    const isExpanded = !!state.expandedCards[card.id];

    const detailToggleBtn = hasDetails
      ? `<button type="button" onclick="event.stopPropagation(); toggleCardDetailExpand('${card.id}')"
           class="text-[11px] font-semibold px-2 py-0.5 rounded border transition inline-flex items-center gap-1 ${isExpanded ? 'bg-blue-600 text-white border-blue-600' : 'bg-blue-50/80 hover:bg-blue-100 text-blue-700 border-blue-200'}">
           <i class="fa-regular fa-file-lines"></i>
           <span>${isExpanded ? '收合詳情' : '詳情'}</span>
           <i class="fa-solid fa-chevron-${isExpanded ? 'up' : 'down'} text-[9px]"></i>
         </button>`
      : `<span class="text-[11px] text-slate-400 px-1.5 py-0.5">無備註</span>`;

    return `
      <div id="db-card-${card.id}"
        draggable="true"
        ondragstart="onDragStartCard(event, '${card.id}')"
        onclick="handleCardClick('${card.id}')"
        class="h-full bg-white rounded-xl border border-slate-200 hover:border-blue-400 transition-all shadow-2xs flex flex-col justify-between cursor-pointer ${card.isNew ? 'card-is-new' : ''} ${isHighlighted ? 'card-is-highlighted' : ''}">
        
        <div class="p-3 flex-1 flex flex-col justify-between gap-2">
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-1.5">
              <div class="flex items-center gap-1 min-w-0">
                ${newBadge}
                <span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-600 truncate">${cleanDist}</span>
              </div>
              ${statusBadge}
            </div>

            <div class="flex items-start justify-between gap-2 min-h-[2.65rem]">
              <h4 class="font-bold text-[14px] text-slate-800 leading-snug line-clamp-2 break-words" title="${card.title}">${card.title}</h4>
              <div class="flex items-center gap-1.5 shrink-0 pt-0.5" onclick="event.stopPropagation()">
                <button onclick="toggleStarCard('${card.id}')" title="標記星號二訪"
                  class="text-sm ${card.starred ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'}">
                  <i class="fa-${card.starred ? 'solid' : 'regular'} fa-star"></i>
                </button>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold border ${meta.badgeBg}">${card.category}</span>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-between gap-1.5 pt-1 border-t border-slate-100/80">
            <div class="flex items-center gap-1.5 flex-wrap">
              ${coordBadge}
              <span class="text-[11px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                <i class="fa-regular fa-clock mr-0.5"></i>${card.duration || 60}分
              </span>
            </div>
            ${detailToggleBtn}
          </div>

          ${hasDetails && isExpanded ? `
            <div class="space-y-1.5 pt-1.5 border-t border-dashed border-slate-200" onclick="event.stopPropagation()">
              ${detailsHtml}
            </div>
          ` : ''}
        </div>

        <div class="px-3 py-2 bg-slate-50 border-t border-slate-100 rounded-b-xl flex items-center justify-between gap-1.5 shrink-0" onclick="event.stopPropagation()">
          <select onchange="quickAssignCardToDay('${card.id}', this.value); this.value='';"
            class="text-[11px] font-bold bg-white border border-slate-200 hover:border-blue-400 rounded-lg px-2 py-1 text-slate-700 cursor-pointer focus:outline-none">
            <option value="">+ 排入 ▾</option>
            ${dayOptionsHtml}
          </select>

          <div class="flex items-center gap-1">
            <button onclick="focusCardOnMap('${card.id}')" title="在地圖上檢核位置"
              class="px-2 h-7 rounded-lg bg-white border border-slate-200 hover:bg-blue-50 hover:text-blue-600 text-slate-600 text-xs flex items-center justify-center transition">
              <i class="fa-solid fa-location-dot"></i>
            </button>
            <a href="${gmapsUrl}" target="_blank" rel="noopener" title="開啟 Google Maps 核對"
              class="px-2 h-7 rounded-lg bg-white border border-slate-200 hover:bg-emerald-50 hover:text-emerald-600 text-slate-600 text-xs flex items-center justify-center transition">
              <i class="fa-solid fa-arrow-up-right-from-square"></i>
            </a>
            <button onclick="openCardModal('${card.id}')" title="編輯卡片資料"
              class="px-2 h-7 rounded-lg bg-white border border-slate-200 hover:bg-amber-50 hover:text-amber-600 text-slate-600 text-xs flex items-center justify-center gap-1 transition font-semibold">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button onclick="deleteCard('${card.id}')" title="刪除卡片"
              class="px-2 h-7 rounded-lg bg-rose-50 border border-rose-200 hover:bg-rose-600 text-rose-600 hover:text-white text-xs flex items-center justify-center gap-1 transition font-semibold">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

export function handleCardClick(cardId) {
  hooks.focusCardOnMap(cardId, false);
  openCardModal(cardId);
}

export function updateCountersAndDropdowns() {
  const total = state.cards.length;
  const domestic = state.cards.filter(c => (c.country || '').includes('台') || (c.country || '').includes('臺')).length;
  const intl = total - domestic;

  document.getElementById('badgeTotalCount').textContent = total;
  const scheduledUnique = new Set();
  Object.values(state.itinerary).forEach(day => (day.items || []).forEach(it => scheduledUnique.add(it.cardId)));
  document.getElementById('badgeScheduledCount').textContent = scheduledUnique.size;

  document.querySelector('[data-filter-scope="all"]').textContent = `全部 (${total})`;
  document.querySelector('[data-filter-scope="domestic"]').textContent = `TW 國內 (${domestic})`;
  document.querySelector('[data-filter-scope="international"]').textContent = `✈️ 國外 (${intl})`;
}

export function populateRegionDropdowns() {
  const countrySel = document.getElementById('countryFilter');
  const citySel = document.getElementById('cityFilter');
  const prevCountry = countrySel.value;
  const prevCity = citySel.value;

  const countries = [...new Set(state.cards.map(c => c.country || '未分類'))];
  countrySel.innerHTML = `<option value="all">全部國家 / 地區</option>` +
    countries.map(c => `<option value="${c}">${c}</option>`).join('');
  if (countries.includes(prevCountry)) countrySel.value = prevCountry;

  const filteredForCities = countrySel.value === 'all'
    ? state.cards
    : state.cards.filter(c => (c.country || '未分類') === countrySel.value);
  const cities = [...new Set(filteredForCities.map(c => normalizeAdministrativeDistrict(c.district, c.country)))];
  citySel.innerHTML = `<option value="all">全部城市 / 町村</option>` +
    cities.map(d => `<option value="${d}">${d}</option>`).join('');
  if (cities.includes(prevCity)) citySel.value = prevCity;

  const distDatalist = document.getElementById('districtSuggestions');
  if (distDatalist) {
    const allDist = [...new Set([...PRESET_DISTRICTS, ...state.cards.map(c => normalizeAdministrativeDistrict(c.district, c.country)).filter(d => d && !d.includes('待確認'))])];
    distDatalist.innerHTML = allDist.map(d => `<option value="${d}"></option>`).join('');
  }
}

export function onCountryFilterChange() {
  populateRegionDropdowns();
  renderDatabaseCards();
  if (state.mode === 'collect') hooks.renderMapMarkers();
}

export async function handleBatchImport() {
  const raw = document.getElementById('batchInputText').value;
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    showToast('請先輸入地點名稱或貼上 Google Maps 網址（一行一筆）', 'amber');
    return;
  }

  const btn = document.getElementById('btnBatchImport');
  const defaultCat = document.getElementById('batchDefaultCategory').value;
  const autoGeo = document.getElementById('batchAutoGeocode').checked;

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>定位入庫中 (${lines.length})...</span>`;

  let addedCount = 0;
  const nowBase = Date.now();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isUrl = line.startsWith('http');
    const urlCoords = extractCoordsFromText(line);
    const title = extractTitleFromInputLine(line);
    let geo = null;

    if (urlCoords) {
      const rev = await reverseGeocodeCoords(urlCoords.lat, urlCoords.lng);
      geo = {
        lat: urlCoords.lat,
        lng: urlCoords.lng,
        country: rev ? rev.country : '日本',
        district: rev ? rev.district : '沖繩縣・待確認行政區'
      };
    } else if (autoGeo && title && !title.startsWith('http')) {
      geo = await geocodePlaceName(title);
    }

    const newCard = {
      id: 'spot_' + (nowBase + i),
      title,
      category: defaultCat,
      country: geo ? geo.country : '日本',
      district: geo ? normalizeAdministrativeDistrict(geo.district, geo.country) : '沖繩縣・待確認行政區',
      duration: defaultCat === '購物' ? 90 : 60,
      lat: geo ? geo.lat : null,
      lng: geo ? geo.lng : null,
      mapUrl: isUrl ? line : '',
      notes: '',
      mustBuy: '',
      businessHours: '',
      parkingInfo: '',
      departTime: '',
      arriveTime: '',
      flightNo: '',
      checkInOut: '',
      bookingRef: '',
      starred: false,
      createdAt: nowBase + (lines.length - i),
      isNew: true
    };

    state.cards.unshift(newCard);
    addedCount++;
  }

  document.getElementById('batchInputText').value = '';
  document.getElementById('sortSelect').value = 'newest';
  persistState(true);
  populateRegionDropdowns();
  hooks.renderAll();
  document.getElementById('databaseCardsContainer').scrollTop = 0;

  btn.disabled = false;
  btn.innerHTML = `<i class="fa-solid fa-magnifying-glass-location"></i> <span>批次定位並置頂入庫</span>`;
  showToast(`已成功新增 ${addedCount} 筆卡片並自動同步至試算表！`, 'emerald');
}

export async function batchUpdateAllDistricts() {
  showToast('正在整理並統一所有卡片的行政區格式...', 'blue');
  for (const card of state.cards) {
    card.district = normalizeAdministrativeDistrict(card.district, card.country);
    if (!card.district || card.district.includes('待確認') || card.district === '未分類') {
      if (Number.isFinite(Number(card.lat)) && Number.isFinite(Number(card.lng)) && Number(card.lat) !== 0) {
        const rev = await reverseGeocodeCoords(card.lat, card.lng);
        if (rev) {
          card.country = rev.country;
          card.district = normalizeAdministrativeDistrict(rev.district, rev.country);
          continue;
        }
      }
      if (card.title) {
        const geo = await geocodePlaceName(card.title, card.country);
        if (geo) {
          card.lat = card.lat || geo.lat;
          card.lng = card.lng || geo.lng;
          card.country = geo.country;
          card.district = normalizeAdministrativeDistrict(geo.district, geo.country);
        }
      }
    }
  }
  persistState(true);
  populateRegionDropdowns();
  hooks.renderAll();
  showToast('全部行政區已統一為標準繁體中文格式，並同步寫入試算表！', 'emerald');
}

export function handleLatLngPaste(e) {
  const pasted = (e.clipboardData || window.clipboardData).getData('text');
  const coords = extractCoordsFromText(pasted);
  if (coords) {
    e.preventDefault();
    document.getElementById('fieldLat').value = coords.lat;
    document.getElementById('fieldLng').value = coords.lng;
    reverseGeocodeModalCoords(true);
  }
}

export async function extractCoordsFromMapUrlField() {
  const urlVal = document.getElementById('fieldMapUrl').value.trim();
  const coords = extractCoordsFromText(urlVal);
  if (coords) {
    document.getElementById('fieldLat').value = coords.lat;
    document.getElementById('fieldLng').value = coords.lng;
    await reverseGeocodeModalCoords(true);
  }
}

export async function reverseGeocodeModalCoords(silentIfEmpty = false) {
  const lat = parseFloat(document.getElementById('fieldLat').value);
  const lng = parseFloat(document.getElementById('fieldLng').value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (!silentIfEmpty) showToast('請先填入有效的緯度與經度', 'amber');
    return;
  }
  const rev = await reverseGeocodeCoords(lat, lng);
  if (rev) {
    const cleanDist = normalizeAdministrativeDistrict(rev.district, rev.country);
    document.getElementById('fieldCountry').value = rev.country;
    document.getElementById('fieldDistrict').value = cleanDist;
    showToast(`已自動帶入並統一格式：${rev.country}・${cleanDist}`, 'emerald');
  } else if (!silentIfEmpty) {
    showToast('無法反查此座標行政區，請手動從下拉選單選擇', 'amber');
  }
}

function renderCategoryDynamicFields(category, card = {}) {
  const box = document.getElementById('dynamicCategoryFieldsBox');

  if (category === '機場') {
    // 若先前誤把「抵達」填在 departTime，打開視窗時自動歸位到 arriveTime
    let depVal = card.departTime || '';
    let arrVal = card.arriveTime || '';
    if (depVal.includes('抵達') && !arrVal) {
      arrVal = depVal.replace(/抵達/g, '').trim();
      depVal = '';
    }

    box.innerHTML = `
      <div class="flex items-center justify-between text-sky-800 font-bold text-xs">
        <div class="flex items-center gap-1.5">
          <i class="fa-solid fa-plane-departure"></i>
          <span>機場航班與報到時刻資訊（去程／回程可分開填寫）</span>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">出境／回程報到或起飛時間</label>
          <input type="text" id="dynDepartTime" value="${depVal}" placeholder="例如：18:30 報到 / 20:30 起飛"
            class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">入境／去程抵達時間</label>
          <input type="text" id="dynArriveTime" value="${arrVal}" placeholder="例如：19:30"
            class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500" />
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">航空公司 / 航班代號 / 航廈</label>
          <input type="text" id="dynFlightNo" value="${card.flightNo || card.mustBuy || ''}" placeholder="例如：星宇航空 JX870 / 國際航廈"
            class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">聯外交通 / 單軌資訊</label>
          <input type="text" id="dynParking" value="${card.parkingInfo || ''}" placeholder="例如：搭乘單軌電車前往縣廳前站"
            class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500" />
        </div>
      </div>
    `;
  } else if (category === '交通') {
    box.innerHTML = `
      <div class="flex items-center gap-1.5 text-slate-800 font-bold text-xs">
        <i class="fa-solid fa-train-subway"></i>
        <span>單軌 / 巴士 / 租車接駁資訊</span>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">出發 / 取車時間</label>
          <input type="text" id="dynDepartTime" value="${card.departTime || ''}" placeholder="例如：09:30"
            class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">抵達 / 還車時間</label>
          <input type="text" id="dynArriveTime" value="${card.arriveTime || ''}" placeholder="例如：10:45"
            class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500" />
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">路線 / 車次 / 租車公司</label>
          <input type="text" id="dynFlightNo" value="${card.flightNo || card.mustBuy || ''}" placeholder="例如：Yui-Rail 一日券 / OTS 租車"
            class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">乘車處 / 站點備註</label>
          <input type="text" id="dynParking" value="${card.parkingInfo || ''}" placeholder="例如：縣廳前站北口乘車處"
            class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500" />
        </div>
      </div>
    `;
  } else if (category === '住宿') {
    box.innerHTML = `
      <div class="flex items-center gap-1.5 text-purple-800 font-bold text-xs">
        <i class="fa-solid fa-bed"></i>
        <span>住宿入退房與訂房資訊</span>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">入住 / 退房時間</label>
          <input type="text" id="dynCheckInOut" value="${card.checkInOut || card.businessHours || ''}" placeholder="例如：15:00 入住 / 11:00 退房"
            class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">訂房代號 / 房型</label>
          <input type="text" id="dynBookingRef" value="${card.bookingRef || card.mustBuy || ''}" placeholder="例如：Agoda #123456 雙床房"
            class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500" />
        </div>
      </div>
      <div>
        <label class="block font-bold text-slate-700 mb-1">車站距離 / 停車資訊</label>
        <input type="text" id="dynParking" value="${card.parkingInfo || ''}" placeholder="例如：縣廳前站步行 5 分鐘"
          class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500" />
      </div>
    `;
  } else {
    const itemLabel = category === '美食' ? '必吃招牌菜' : (category === '購物' ? '必買清單 / 退稅提醒' : (category === '體驗' ? '體驗項目 / 預約時段' : '必看亮點 / 門票資訊'));
    const itemPlaceholder = category === '美食' ? '例如：阿古豬排、苦瓜漢堡、海葡萄丼' : (category === '購物' ? '例如：滿 5,500 日圓免稅、限定伴手禮' : '例如：門票費用、預約代號、拍照重點');
    box.innerHTML = `
      <div class="flex items-center gap-1.5 text-slate-800 font-bold text-xs">
        <i class="fa-solid fa-circle-info text-blue-600"></i>
        <span>${category}專屬營業與推薦資訊</span>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">營業時間 / 公休日</label>
          <input type="text" id="dynHours" value="${card.businessHours || ''}" placeholder="例如：09:00-21:00（週三公休）"
            class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">停車 / 交通資訊</label>
          <input type="text" id="dynParking" value="${card.parkingInfo || ''}" placeholder="例如：附免費停車場 / 單軌牧志站"
            class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500" />
        </div>
      </div>
      <div>
        <label class="block font-bold text-slate-700 mb-1">${itemLabel}</label>
        <input type="text" id="dynMustBuy" value="${card.mustBuy || ''}" placeholder="${itemPlaceholder}"
          class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500" />
      </div>
    `;
  }
}

export function onModalCategoryChange() {
  const cat = document.getElementById('fieldCategory').value;
  const id = document.getElementById('editCardId').value;
  const existing = id ? (state.cards.find(c => c.id === id) || {}) : {};
  renderCategoryDynamicFields(cat, existing);
}

export async function openCardModal(cardId = null) {
  const modal = document.getElementById('cardModal');
  const titleEl = document.getElementById('cardModalTitle');
  const assignSel = document.getElementById('fieldAssignDay');
  const assignBox = document.getElementById('quickAssignOnSaveBox');

  populateRegionDropdowns();

  const totalDays = Number(state.settings.totalDays) || 6;
  assignSel.innerHTML = `<option value="">僅存入口袋資料庫</option>` +
    Array.from({ length: totalDays }, (_, i) => `<option value="${i + 1}">直接排入 Day ${i + 1}</option>`).join('');

  if (cardId) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;
    const cleanDist = normalizeAdministrativeDistrict(card.district, card.country);
    titleEl.textContent = '編輯卡片資料';
    document.getElementById('editCardId').value = card.id;
    document.getElementById('fieldTitle').value = card.title || '';
    document.getElementById('fieldCategory').value = CATEGORY_META[card.category] ? card.category : '景點';
    document.getElementById('fieldCountry').value = card.country || '日本';
    document.getElementById('fieldDistrict').value = cleanDist;
    document.getElementById('fieldDuration').value = card.duration || 60;
    document.getElementById('fieldLat').value = card.lat || '';
    document.getElementById('fieldLng').value = card.lng || '';
    document.getElementById('fieldMapUrl').value = card.mapUrl || '';
    document.getElementById('fieldImage').value = card.image || '';
    document.getElementById('fieldNotes').value = card.notes || '';
    document.getElementById('fieldStarred').checked = !!card.starred;
    renderCategoryDynamicFields(card.category || '景點', card);
    assignBox.classList.add('hidden');
    modal.classList.remove('hidden');

    if (card.lat && card.lng && (!cleanDist || cleanDist.includes('待確認'))) {
      reverseGeocodeModalCoords(true);
    }
  } else {
    titleEl.textContent = '新增口袋卡片（儲存後自動置頂並同步）';
    document.getElementById('editCardId').value = '';
    document.getElementById('fieldTitle').value = '';
    document.getElementById('fieldCategory').value = '景點';
    document.getElementById('fieldCountry').value = '日本';
    document.getElementById('fieldDistrict').value = '沖繩縣・那霸市';
    document.getElementById('fieldDuration').value = 60;
    document.getElementById('fieldLat').value = '';
    document.getElementById('fieldLng').value = '';
    document.getElementById('fieldMapUrl').value = '';
    document.getElementById('fieldImage').value = '';
    document.getElementById('fieldNotes').value = '';
    document.getElementById('fieldStarred').checked = false;
    renderCategoryDynamicFields('景點', {});
    assignBox.classList.remove('hidden');
    modal.classList.remove('hidden');
  }
}

export function closeCardModal() {
  document.getElementById('cardModal').classList.add('hidden');
}

export async function saveCardFromModal() {
  const id = document.getElementById('editCardId').value;
  const title = document.getElementById('fieldTitle').value.trim();
  if (!title) {
    showToast('地點名稱為必填項目', 'amber');
    return;
  }

  const category = document.getElementById('fieldCategory').value;
  let lat = parseFloat(document.getElementById('fieldLat').value);
  let lng = parseFloat(document.getElementById('fieldLng').value);
  let country = document.getElementById('fieldCountry').value.trim() || '日本';
  let district = normalizeAdministrativeDistrict(document.getElementById('fieldDistrict').value.trim(), country);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const geo = await geocodePlaceName(title, country);
    if (geo) {
      lat = geo.lat;
      lng = geo.lng;
      country = geo.country;
      if (!district || district.includes('待確認')) district = geo.district;
    }
  } else if (!district || district.includes('待確認')) {
    const rev = await reverseGeocodeCoords(lat, lng);
    if (rev) {
      country = rev.country;
      district = rev.district;
    }
  }

  let businessHours = '';
  let mustBuy = '';
  let parkingInfo = document.getElementById('dynParking')?.value.trim() || '';
  let departTime = '';
  let arriveTime = '';
  let flightNo = '';
  let checkInOut = '';
  let bookingRef = '';

  if (isTransportOrAirport(category)) {
    departTime = document.getElementById('dynDepartTime')?.value.trim() || '';
    arriveTime = document.getElementById('dynArriveTime')?.value.trim() || '';
    flightNo = document.getElementById('dynFlightNo')?.value.trim() || '';
    const prefix = category === '機場' ? '✈️ ' : '🚆 ';
    businessHours = (departTime || arriveTime) ? `${prefix}${departTime}${arriveTime ? ' ~ ' + arriveTime : ''}`.trim() : '';
    mustBuy = flightNo;
  } else if (category === '住宿') {
    checkInOut = document.getElementById('dynCheckInOut')?.value.trim() || '';
    bookingRef = document.getElementById('dynBookingRef')?.value.trim() || '';
    businessHours = checkInOut;
    mustBuy = bookingRef;
  } else {
    businessHours = document.getElementById('dynHours')?.value.trim() || '';
    mustBuy = document.getElementById('dynMustBuy')?.value.trim() || '';
  }

  const payload = {
    title,
    category,
    country,
    district: normalizeAdministrativeDistrict(district || '沖繩縣', country),
    duration: parseInt(document.getElementById('fieldDuration').value, 10) || 60,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    businessHours,
    parkingInfo,
    mustBuy,
    departTime,
    arriveTime,
    flightNo,
    checkInOut,
    bookingRef,
    mapUrl: document.getElementById('fieldMapUrl').value.trim(),
    image: document.getElementById('fieldImage').value.trim(),
    notes: document.getElementById('fieldNotes').value.trim(),
    starred: document.getElementById('fieldStarred').checked
  };

  if (id) {
    const idx = state.cards.findIndex(c => c.id === id);
    if (idx !== -1) state.cards[idx] = { ...state.cards[idx], ...payload };
    showToast('卡片資料已更新並統一行政區格式，正在寫入試算表...', 'emerald');
  } else {
    const newCard = {
      id: 'spot_' + Date.now(),
      ...payload,
      createdAt: Date.now(),
      isNew: true
    };
    state.cards.unshift(newCard);
    document.getElementById('sortSelect').value = 'newest';

    const assignDay = parseInt(document.getElementById('fieldAssignDay').value, 10);
    if (assignDay) hooks.addCardToDay(newCard.id, assignDay, false);
    showToast('已新增卡片並自動同步至試算表！', 'emerald');
  }

  closeCardModal();
  persistState(true);
  populateRegionDropdowns();
  hooks.renderAll();
  if (!id) {
    document.getElementById('databaseCardsContainer').scrollTop = 0;
    hooks.focusCardOnMap(state.cards[0].id);
  }
}

export function deleteCard(cardId) {
  const card = state.cards.find(c => c.id === cardId);
  if (!card) return;
  if (!confirm(`確定要刪除「${card.title}」並同步更新試算表嗎？`)) return;

  if (!state.deletedIds.includes(cardId)) {
    state.deletedIds.push(cardId);
  }
  state.cards = state.cards.filter(c => c.id !== cardId);
  Object.values(state.itinerary).forEach(day => {
    day.items = (day.items || []).filter(it => it.cardId !== cardId);
  });

  populateRegionDropdowns();
  hooks.renderAll();
  showToast(`已刪除「${card.title}」，正在同步覆蓋試算表...`, 'slate');
  pushAllToGoogleSheets(true, cardId);
}

export function toggleStarCard(cardId) {
  const card = state.cards.find(c => c.id === cardId);
  if (!card) return;
  card.starred = !card.starred;
  persistState(true);
  renderDatabaseCards();
}
