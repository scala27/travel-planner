import { CATEGORY_META, DAY_ROUTE_COLORS, isTransportOrAirport } from './config.js';
import {
  state,
  hooks,
  persistState,
  ensureItineraryDays,
  showToast
} from './state.js';
import {
  normalizeAdministrativeDistrict,
  haversineKm,
  isFlightLeg,
  resolveLegModeAndEstimate,
  formatDistanceLabel,
  getTransitModeDisplay
} from './geo.js';

let dragPayload = null;
let multiDayCompactMode = true;
let multiDayShowMap = false;
let savedThreeColLayout = null;
let collectTabGuardBound = false;

// 日期互換選擇列狀態
let daySwapBarOpen = false;
let swapFromDay = 2;
let swapToDay = 4;

function bindCollectTabRestoreGuard() {
  if (collectTabGuardBound) return;
  const collectBtn = document.getElementById('tabModeCollect');
  if (!collectBtn) return;
  collectTabGuardBound = true;
  collectBtn.addEventListener('click', () => {
    if (state.boardMultiDayMode) {
      state.boardMultiDayMode = false;
      multiDayShowMap = false;
      const label = document.getElementById('boardModeLabel');
      if (label) label.textContent = '多日並列';
      applyMultiDayWorkspaceLayout(false);
    }
  }, true);
}

function applyMultiDayWorkspaceLayout(isMultiDay) {
  bindCollectTabRestoreGuard();

  const dbPanel = document.getElementById('databasePanel');
  const resizerLeft = document.getElementById('resizerLeft');
  const btnExpandPocket = document.getElementById('btnExpandPocket');
  const boardSection = document.getElementById('itineraryBoardSection');
  const resizerRight = document.getElementById('resizerRight');
  const mapPanel = document.getElementById('mapPanel');

  if (!dbPanel || !boardSection || !mapPanel) return;

  if (isMultiDay) {
    if (!savedThreeColLayout) {
      savedThreeColLayout = {
        dbWidth: dbPanel.style.width || '22%',
        dbHidden: dbPanel.classList.contains('hidden'),
        expandBtnHidden: btnExpandPocket ? btnExpandPocket.classList.contains('hidden') : true,
        boardWidth: boardSection.style.width || '34%'
      };
    }

    dbPanel.classList.add('hidden');
    if (resizerLeft) resizerLeft.classList.add('hidden');
    if (btnExpandPocket) {
      btnExpandPocket.classList.add('hidden');
      btnExpandPocket.classList.remove('flex');
    }

    if (multiDayShowMap) {
      boardSection.style.width = '64%';
      boardSection.style.flex = '0 0 64%';
      if (resizerRight) resizerRight.classList.remove('hidden');
      mapPanel.classList.remove('hidden');
      mapPanel.classList.add('flex');
      state.mapOverviewAllDays = true;
      const mapDaySel = document.getElementById('mapDaySelect');
      if (mapDaySel) mapDaySel.value = 'all';
      setTimeout(() => {
        if (typeof hooks.invalidateMapSize === 'function') hooks.invalidateMapSize();
        if (typeof hooks.renderMapMarkers === 'function') hooks.renderMapMarkers();
      }, 60);
    } else {
      boardSection.style.width = '100%';
      boardSection.style.flex = '1 1 100%';
      if (resizerRight) resizerRight.classList.add('hidden');
      mapPanel.classList.add('hidden');
      mapPanel.classList.remove('flex');
    }
  } else {
    if (savedThreeColLayout) {
      dbPanel.style.width = savedThreeColLayout.dbWidth;
      if (savedThreeColLayout.dbHidden) {
        dbPanel.classList.add('hidden');
        if (resizerLeft) resizerLeft.classList.add('hidden');
        if (btnExpandPocket && !savedThreeColLayout.expandBtnHidden) {
          btnExpandPocket.classList.remove('hidden');
          btnExpandPocket.classList.add('flex');
        }
      } else {
        dbPanel.classList.remove('hidden');
        if (resizerLeft) resizerLeft.classList.remove('hidden');
        if (btnExpandPocket) {
          btnExpandPocket.classList.add('hidden');
          btnExpandPocket.classList.remove('flex');
        }
      }
      boardSection.style.width = savedThreeColLayout.boardWidth;
      boardSection.style.flex = '';
      savedThreeColLayout = null;
    } else {
      boardSection.style.flex = '';
    }

    if (state.mode === 'plan' && resizerRight) {
      resizerRight.classList.remove('hidden');
    }
    mapPanel.classList.remove('hidden');
    mapPanel.classList.add('flex');
    setTimeout(() => {
      if (typeof hooks.invalidateMapSize === 'function') hooks.invalidateMapSize();
    }, 60);
  }
}

export function toggleMultiDayCompactCards() {
  multiDayCompactMode = !multiDayCompactMode;
  renderKanbanBoard();
}

export function toggleMultiDayShowMap() {
  multiDayShowMap = !multiDayShowMap;
  applyMultiDayWorkspaceLayout(true);
  renderKanbanBoard();
}

export function toggleDaySwapBar() {
  daySwapBarOpen = !daySwapBarOpen;
  if (daySwapBarOpen) {
    const totalDays = Number(state.settings.totalDays) || 6;
    const current = Number(state.selectedMapDay) || 1;
    swapFromDay = current;
    if (swapToDay === swapFromDay || swapToDay > totalDays || swapToDay < 1) {
      swapToDay = current < totalDays ? current + 1 : Math.max(1, current - 1);
    }
  }
  renderKanbanBoard();
}

export function updateSwapDaySelection(which, val) {
  const dayNum = parseInt(val, 10) || 1;
  if (which === 'from') {
    swapFromDay = dayNum;
  } else {
    swapToDay = dayNum;
  }
}

export function executeSwapDays() {
  const totalDays = Number(state.settings.totalDays) || 6;
  const d1 = Number(swapFromDay);
  const d2 = Number(swapToDay);

  if (!d1 || !d2 || d1 < 1 || d1 > totalDays || d2 < 1 || d2 > totalDays) {
    showToast('請選擇有效的日期進行互換', 'amber');
    return;
  }
  if (d1 === d2) {
    showToast('請選擇兩個不同的日期進行互換', 'amber');
    return;
  }

  ensureItineraryDays();
  const data1 = state.itinerary[d1] || { startTime: '09:00', items: [] };
  const data2 = state.itinerary[d2] || { startTime: '09:00', items: [] };

  state.itinerary[d1] = {
    startTime: data2.startTime || '09:00',
    items: Array.isArray(data2.items) ? [...data2.items] : []
  };
  state.itinerary[d2] = {
    startTime: data1.startTime || '09:00',
    items: Array.isArray(data1.items) ? [...data1.items] : []
  };

  daySwapBarOpen = false;
  persistState(true);
  hooks.renderAll();
  showToast(`已將 Day ${d1} 與 Day ${d2} 的行程完整對調並同步至試算表！`, 'emerald');
}

window.toggleMultiDayCompactCards = toggleMultiDayCompactCards;
window.toggleMultiDayShowMap = toggleMultiDayShowMap;
window.toggleDaySwapBar = toggleDaySwapBar;
window.updateSwapDaySelection = updateSwapDaySelection;
window.executeSwapDays = executeSwapDays;

export function getFormattedDateInfo(dayNum) {
  const start = new Date(state.settings.startDate + 'T00:00:00');
  if (isNaN(start.getTime())) return { md: `Day ${dayNum}`, week: '' };
  const target = new Date(start.getTime() + (dayNum - 1) * 86400000);
  const mm = String(target.getMonth() + 1).padStart(2, '0');
  const dd = String(target.getDate()).padStart(2, '0');
  const weeks = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  return { md: `${mm}/${dd}`, week: weeks[target.getDay()] };
}

function timeToMinutes(hhmm) {
  const normalized = String(hhmm || '09:00').replace(/：/g, ':');
  const [h, m] = normalized.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(totalMins) {
  const mins = ((totalMins % 1440) + 1440) % 1440;
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function extractClockTimes(text) {
  if (!text) return [];
  const normalized = String(text).replace(/：/g, ':');
  const matches = normalized.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/g);
  return matches ? matches.map(t => t.padStart(5, '0')) : [];
}

function parseItemFlightSchedule(item) {
  const raw = String(item?.customNote || '').trim();
  if (!raw.startsWith('flight|')) return null;
  const parts = raw.split('|');
  return {
    depart: (parts[1] || '').trim(),
    arrive: (parts[2] || '').trim(),
    flightNo: (parts[3] || '').trim()
  };
}

function getAirportRoleInDay(items, idx) {
  const item = items[idx];
  const card = state.cards.find(c => c.id === item?.cardId);
  if (!card || !isTransportOrAirport(card.category)) return null;

  if (idx === 0) return 'departure';

  const prevCard = state.cards.find(c => c.id === items[idx - 1]?.cardId);
  if (prevCard) {
    const km = haversineKm(prevCard.lat, prevCard.lng, card.lat, card.lng);
    if (isFlightLeg(prevCard, card, km)) {
      return 'arrival';
    }
  }
  return 'departure';
}

export function resolveOvernightHotelIdForDay(dayNum) {
  const totalDays = Number(state.settings.totalDays) || 6;
  const items = state.itinerary[dayNum]?.items || [];
  if (items.length === 0) return null;

  const hotelEntries = items
    .map((it, idx) => ({ it, idx, card: state.cards.find(c => c.id === it.cardId) }))
    .filter(e => e.card && e.card.category === '住宿');

  if (hotelEntries.length === 0) return null;

  const eveningHotels = hotelEntries.filter(e => e.idx > 0);
  if (eveningHotels.length > 0) {
    return eveningHotels[eveningHotels.length - 1].card.id;
  }

  if (dayNum >= totalDays) return null;

  const morningHotelId = hotelEntries[0].card.id;
  const nextItems = state.itinerary[dayNum + 1]?.items || [];
  const nextFirstCard = nextItems.length > 0 ? state.cards.find(c => c.id === nextItems[0].cardId) : null;

  if (nextFirstCard && nextFirstCard.category === '住宿' && nextFirstCard.id === morningHotelId) {
    return morningHotelId;
  }

  return null;
}

export function getLodgingStatusForItem(dayNum, idx) {
  const items = state.itinerary[dayNum]?.items || [];
  const item = items[idx];
  if (!item) return null;
  const card = state.cards.find(c => c.id === item.cardId);
  if (!card || card.category !== '住宿') return null;

  if (idx > 0) {
    return {
      state: 'checkin',
      char: '住',
      label: '入住 / 返回',
      pinColor: '#9333ea',
      badgeClass: 'bg-purple-100 text-purple-800 border-purple-200'
    };
  }

  const tonightHotelId = resolveOvernightHotelIdForDay(dayNum);
  if (tonightHotelId && tonightHotelId === card.id) {
    return {
      state: 'stayover',
      char: '續',
      label: '連住出發',
      pinColor: '#0d9488',
      badgeClass: 'bg-teal-100 text-teal-800 border-teal-200'
    };
  }

  return {
    state: 'checkout',
    char: '退',
    label: '退房出發',
    pinColor: '#6b21a8',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-300'
  };
}

export function getHotelActualStayNights(cardId) {
  const totalDays = Number(state.settings.totalDays) || 6;
  const nights = [];
  for (let d = 1; d <= totalDays; d++) {
    if (resolveOvernightHotelIdForDay(d) === cardId) {
      nights.push(d);
    }
  }
  return nights;
}

export function toggleBoardMultiDayMode() {
  state.boardMultiDayMode = !state.boardMultiDayMode;
  if (state.boardMultiDayMode) {
    multiDayCompactMode = true;
    multiDayShowMap = false;
  }
  const label = document.getElementById('boardModeLabel');
  if (label) label.textContent = state.boardMultiDayMode ? '單日聚焦' : '多日並列';
  applyMultiDayWorkspaceLayout(state.boardMultiDayMode);
  renderKanbanBoard();
}

export function moveItineraryItem(dayNum, idx, delta) {
  const items = state.itinerary[dayNum]?.items;
  if (!items) return;
  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= items.length) return;
  const temp = items[idx];
  items[idx] = items[targetIdx];
  items[targetIdx] = temp;
  persistState(true);
  hooks.renderAll();
}

export function renderKanbanBoard() {
  const totalDays = Number(state.settings.totalDays) || 6;
  const navPills = document.getElementById('dayNavPills');
  const board = document.getElementById('kanbanColumnsContainer');
  const globalProfile = document.getElementById('transitProfileSelect')?.value || 'smart';
  const isCompactMulti = state.boardMultiDayMode && multiDayCompactMode;

  const pillsHtml = Array.from({ length: totalDays }, (_, i) => {
    const d = i + 1;
    const info = getFormattedDateInfo(d);
    const count = (state.itinerary[d]?.items || []).length;
    const active = !state.boardMultiDayMode && state.selectedMapDay === d;
    const dayColor = DAY_ROUTE_COLORS[(d - 1) % DAY_ROUTE_COLORS.length];
    return `
      <button onclick="selectDayFocus(${d})"
        style="${active ? `background-color:${dayColor};border-color:${dayColor};` : ''}"
        class="px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 shrink-0 transition border ${active ? 'text-white shadow-2xs' : 'bg-slate-100 hover:bg-slate-200 border-transparent text-slate-700'}">
        <span class="w-2 h-2 rounded-full shrink-0" style="background-color:${active ? '#ffffff' : dayColor}"></span>
        <span>Day ${d}</span>
        <span class="font-normal opacity-85">${info.md}</span>
        <span class="px-1.5 rounded-full text-[10px] ${active ? 'bg-white/25 text-white' : 'bg-white text-slate-600'}">${count}</span>
      </button>`;
  }).join('');

  const swapTriggerBtn = totalDays >= 2 ? `
    <button type="button" onclick="toggleDaySwapBar()"
      class="px-2 py-1 rounded-lg border text-[11px] font-bold flex items-center gap-1 shrink-0 transition ${daySwapBarOpen ? 'bg-amber-600 border-amber-600 text-white shadow-2xs' : 'bg-amber-50/90 hover:bg-amber-100 border-amber-200 text-amber-800'}"
      title="將兩天的行程順序與出發時間完整互換（例如 D2 與 D4 對調）">
      <i class="fa-solid fa-right-left"></i>
      <span>日期互換</span>
    </button>
  ` : '';

  const multiDayExtraToolbar = state.boardMultiDayMode ? `
    <div class="flex items-center gap-1.5 pl-2 ml-1 border-l border-slate-200 shrink-0">
      <button type="button" onclick="toggleMultiDayCompactCards()"
        class="px-2 py-1 rounded-lg border text-[11px] font-bold flex items-center gap-1 transition ${multiDayCompactMode ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}"
        title="切換多日並列時的卡片精簡或完整細節顯示">
        <i class="fa-solid ${multiDayCompactMode ? 'fa-compress' : 'fa-expand'}"></i>
        <span>${multiDayCompactMode ? '精簡卡片' : '完整細節'}</span>
      </button>
      <button type="button" onclick="toggleMultiDayShowMap()"
        class="px-2 py-1 rounded-lg border text-[11px] font-bold flex items-center gap-1 transition ${multiDayShowMap ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}"
        title="在多日並列旁展開或收合分色總覽地圖">
        <i class="fa-solid fa-map-location-dot"></i>
        <span>${multiDayShowMap ? '全寬排程' : '顯示地圖'}</span>
      </button>
    </div>
  ` : '';

  navPills.innerHTML = pillsHtml + swapTriggerBtn + multiDayExtraToolbar;

  // 處理或更新日期互換選擇列（動態掛載於 navPills 所在標題列下方，無須更動 index.html）
  const boardHeader = navPills.parentElement;
  if (boardHeader && boardHeader.parentElement) {
    let swapBarEl = document.getElementById('daySwapInlineBar');
    if (daySwapBarOpen) {
      const dayOptionsFrom = Array.from({ length: totalDays }, (_, i) => {
        const d = i + 1;
        const info = getFormattedDateInfo(d);
        const cnt = (state.itinerary[d]?.items || []).length;
        return `<option value="${d}" ${d === swapFromDay ? 'selected' : ''}>Day ${d} (${info.md}・${cnt}項)</option>`;
      }).join('');

      const dayOptionsTo = Array.from({ length: totalDays }, (_, i) => {
        const d = i + 1;
        const info = getFormattedDateInfo(d);
        const cnt = (state.itinerary[d]?.items || []).length;
        return `<option value="${d}" ${d === swapToDay ? 'selected' : ''}>Day ${d} (${info.md}・${cnt}項)</option>`;
      }).join('');

      if (!swapBarEl) {
        swapBarEl = document.createElement('div');
        swapBarEl.id = 'daySwapInlineBar';
        boardHeader.parentElement.insertBefore(swapBarEl, board);
      }
      swapBarEl.className = 'px-3 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-2 flex-wrap shrink-0 text-xs';
      swapBarEl.innerHTML = `
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-bold text-amber-900 flex items-center gap-1">
            <i class="fa-solid fa-right-left text-amber-600"></i>
            <span>行程日期對調：</span>
          </span>
          <select onchange="updateSwapDaySelection('from', this.value)"
            class="px-2 py-1 rounded-lg bg-white border border-amber-300 font-bold text-slate-800 focus:outline-none focus:border-amber-500">
            ${dayOptionsFrom}
          </select>
          <span class="font-bold text-amber-700">⇄</span>
          <select onchange="updateSwapDaySelection('to', this.value)"
            class="px-2 py-1 rounded-lg bg-white border border-amber-300 font-bold text-slate-800 focus:outline-none focus:border-amber-500">
            ${dayOptionsTo}
          </select>
          <span class="text-[11px] text-amber-800">（將完整互換兩天的景點順序與出發時間）</span>
        </div>
        <div class="flex items-center gap-1.5">
          <button type="button" onclick="executeSwapDays()"
            class="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-2xs transition">
            確認互換
          </button>
          <button type="button" onclick="toggleDaySwapBar()"
            class="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 font-semibold transition">
            取消
          </button>
        </div>
      `;
    } else if (swapBarEl) {
      swapBarEl.remove();
    }
  }

  const daysToRender = state.boardMultiDayMode
    ? Array.from({ length: totalDays }, (_, i) => i + 1)
    : [state.selectedMapDay];

  board.className = state.boardMultiDayMode
    ? 'flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-2.5 flex gap-2 items-stretch'
    : 'flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-3 flex gap-3 items-stretch';

  board.innerHTML = daysToRender.map(d => {
    const info = getFormattedDateInfo(d);
    const dayColor = DAY_ROUTE_COLORS[(d - 1) % DAY_ROUTE_COLORS.length];
    const dayData = state.itinerary[d] || { startTime: '09:00', items: [] };
    const items = dayData.items || [];

    let initialStart = dayData.startTime;
    if (items.length > 0) {
      const firstCard = state.cards.find(c => c.id === items[0].cardId);
      const firstCustomFlight = parseItemFlightSchedule(items[0]);
      if (firstCard && isTransportOrAirport(firstCard.category)) {
        const rawFirstDep = firstCustomFlight?.depart || firstCard.departTime || '';
        if (rawFirstDep && !rawFirstDep.includes('抵達')) {
          const depTimes = extractClockTimes(rawFirstDep);
          if (depTimes.length > 0 && dayData.startTime === '09:00') {
            initialStart = depTimes[0];
          }
        }
      }
    }

    let cursorMin = timeToMinutes(initialStart);
    let totalActMin = 0;
    let totalTransitMin = 0;
    let pinCounter = 0;

    const cardsHtml = items.map((item, idx) => {
      const card = state.cards.find(c => c.id === item.cardId);
      if (!card) return '';
      const meta = CATEGORY_META[card.category] || CATEGORY_META['景點'];
      const dur = Number(card.duration) || 60;
      const cleanDist = normalizeAdministrativeDistrict(card.district, card.country).replace(/^沖繩縣・/, '');
      const lodgingInfo = card.category === '住宿' ? getLodgingStatusForItem(d, idx) : null;
      const airportRole = isTransportOrAirport(card.category) ? getAirportRoleInDay(items, idx) : null;
      const itemFlight = parseItemFlightSchedule(item);

      let effectiveDepartText = '';
      let effectiveArriveText = '';
      let effectiveFlightNo = itemFlight?.flightNo || card.flightNo || '';

      if (isTransportOrAirport(card.category)) {
        if (itemFlight && (itemFlight.depart || itemFlight.arrive)) {
          effectiveDepartText = itemFlight.depart;
          effectiveArriveText = itemFlight.arrive;
        } else if (airportRole === 'arrival') {
          effectiveArriveText = card.arriveTime || (String(card.departTime || '').includes('抵達') ? card.departTime : '');
        } else {
          effectiveDepartText = String(card.departTime || '').includes('抵達') ? '' : (card.departTime || '');
          effectiveArriveText = card.arriveTime || '';
        }
      }

      const depTimes = extractClockTimes(effectiveDepartText);
      const arrTimes = extractClockTimes(effectiveArriveText);

      if (depTimes.length > 0 && idx === 0) {
        cursorMin = timeToMinutes(depTimes[0]);
      } else if (airportRole === 'arrival' && arrTimes.length > 0) {
        cursorMin = timeToMinutes(arrTimes[arrTimes.length - 1]);
      }

      const startStr = minutesToTime(cursorMin);
      const endStr = minutesToTime(cursorMin + dur);

      if (airportRole === 'departure' && depTimes.length >= 2) {
        cursorMin = timeToMinutes(depTimes[depTimes.length - 1]);
      } else {
        cursorMin += dur;
      }

      if (card.category !== '住宿' && !isTransportOrAirport(card.category)) totalActMin += dur;

      const nextItem = items[idx + 1];
      const nextCard = nextItem ? state.cards.find(c => c.id === nextItem.cardId) : null;

      let activeMode = 'transit';
      let isHotelTransfer = false;
      let transitMin = 0;
      let legPillText = '';
      let compactLegText = '';

      if (nextCard) {
        const est = resolveLegModeAndEstimate(card, nextCard, item.transitMode || 'auto');
        const cacheKey = `${card.id}_${nextCard.id}_${item.transitMode || 'auto'}_${item.transitMin || 0}_${item.customTransitNote || ''}_${globalProfile}`;
        const cached = state.routeMetricsCache[cacheKey];

        activeMode = cached ? cached.mode : est.mode;
        isHotelTransfer = cached ? cached.isHotelTransfer : est.isHotelTransfer;
        const transitDetailLabel = cached ? cached.transitDetailLabel : '';
        const legKm = cached ? cached.km : est.km;
        const hasCustomLock = Number(item.transitMin) > 0;
        transitMin = hasCustomLock
          ? Number(item.transitMin)
          : (est.mode === 'flight' ? est.min : (cached ? cached.min : est.min));

        totalTransitMin += transitMin;
        cursorMin += transitMin;

        const transferPrefix = isHotelTransfer ? '🧳 換宿移動・' : '';
        const baseModeLabel = item.customTransitNote
          ? `📌 ${item.customTransitNote}`
          : getTransitModeDisplay(activeMode, transitDetailLabel);
        const modeLabel = `${transferPrefix}${baseModeLabel}`;
        const distLabel = formatDistanceLabel(legKm);
        const lockBadge = hasCustomLock ? ' 🔒' : '';

        const modeIcon = activeMode === 'flight'
          ? '✈️'
          : (activeMode === 'walk'
            ? '🚶'
            : (activeMode === 'taxi'
              ? '🚕'
              : (activeMode === 'drive' ? '🚗' : '🚝')));
        compactLegText = `${modeIcon} ${transitMin}分${lockBadge}`;

        if (activeMode === 'flight' && arrTimes.length > 0) {
          legPillText = `${modeLabel}｜${depTimes[depTimes.length - 1] || endStr} 起飛 → ${arrTimes[arrTimes.length - 1]} 抵達・約 ${transitMin} 分`;
        } else if (distLabel) {
          legPillText = `${modeLabel}｜約 ${distLabel}・${transitMin} 分${lockBadge}`;
        } else {
          legPillText = `${modeLabel}｜約 ${transitMin} 分${lockBadge}`;
        }
      }

      if (card.category !== '住宿' && !isTransportOrAirport(card.category)) pinCounter++;
      const badgeNum = lodgingInfo
        ? lodgingInfo.char
        : (card.category === '機場' ? '機' : (card.category === '交通' ? '行' : pinCounter));
      const pinBgColor = lodgingInfo ? lodgingInfo.pinColor : meta.color;

      let timePillText = `${startStr} ~ ${endStr}`;
      let compactStartTime = startStr;
      let roleBadgeHtml = '';

      if (isTransportOrAirport(card.category)) {
        if (airportRole === 'arrival') {
          roleBadgeHtml = `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold border mr-0.5 bg-sky-100 text-sky-800 border-sky-200">入境抵達</span>`;
          if (arrTimes.length > 0) {
            compactStartTime = arrTimes[0];
            timePillText = `${arrTimes[0]} 抵達 ~ ${minutesToTime(timeToMinutes(arrTimes[0]) + dur)}`;
          }
        } else {
          roleBadgeHtml = `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold border mr-0.5 bg-indigo-50 text-indigo-700 border-indigo-200">出境搭機</span>`;
          if (depTimes.length >= 2) {
            compactStartTime = depTimes[0];
            timePillText = `${depTimes[0]} 報到 ~ ${depTimes[1]} 起飛`;
          } else if (effectiveDepartText) {
            timePillText = effectiveDepartText.replace(/：/g, ':');
          } else {
            timePillText = `${startStr} 抵達機場 ~ ${endStr} 候機`;
          }
        }
      }

      const pillColorClass = isHotelTransfer
        ? 'bg-purple-50 border-purple-300 text-purple-800'
        : (activeMode === 'flight'
          ? 'bg-sky-50 border-sky-200 text-sky-800'
          : (activeMode === 'walk'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : (activeMode === 'taxi'
              ? 'bg-amber-50 border-amber-300 text-amber-800'
              : 'bg-white border-slate-200 text-slate-700')));

      // ==================== 方案 B：多日並列精簡總覽卡片 ====================
      if (isCompactMulti) {
        return `
          <div draggable="true"
            ondragstart="onDragStartItineraryItem(event, ${d}, ${idx})"
            title="${timePillText}｜${card.title}（${cleanDist}・停留 ${dur} 分）"
            class="group bg-white rounded-lg border border-slate-200 hover:border-blue-400 px-2 py-1.5 shadow-2xs transition">
            <div class="flex items-center justify-between gap-1 mb-0.5">
              <div class="flex items-center gap-1 min-w-0">
                <span class="text-[11px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded shrink-0">${compactStartTime}</span>
                ${lodgingInfo ? `<span class="px-1 py-0.2 rounded text-[9px] font-bold border shrink-0 ${lodgingInfo.badgeClass}">${lodgingInfo.char}</span>` : ''}
                <span class="text-[10px] text-slate-400 truncate">${dur}分</span>
              </div>
              <div class="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
                <button onclick="moveItineraryItem(${d}, ${idx}, -1)" ${idx === 0 ? 'disabled' : ''} title="上移"
                  class="w-4 h-4 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 disabled:opacity-25 text-[9px] flex items-center justify-center">
                  <i class="fa-solid fa-arrow-up"></i>
                </button>
                <button onclick="moveItineraryItem(${d}, ${idx}, 1)" ${idx === items.length - 1 ? 'disabled' : ''} title="下移"
                  class="w-4 h-4 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 disabled:opacity-25 text-[9px] flex items-center justify-center">
                  <i class="fa-solid fa-arrow-down"></i>
                </button>
                <button onclick="openCardModal('${card.id}')" title="編輯卡片"
                  class="w-4 h-4 rounded hover:bg-amber-50 text-slate-400 hover:text-amber-600 text-[9px] flex items-center justify-center">
                  <i class="fa-solid fa-pen"></i>
                </button>
                <button onclick="removeItineraryItem(${d}, ${idx})" title="移出"
                  class="w-4 h-4 rounded hover:bg-rose-50 text-slate-300 hover:text-rose-600 text-[9px] flex items-center justify-center">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            </div>

            <div class="flex items-start gap-1.5 cursor-pointer" onclick="openCardModal('${card.id}')">
              <span class="w-4 h-4 rounded-full text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5"
                style="background-color:${pinBgColor}">${badgeNum}</span>
              <div class="text-xs font-bold text-slate-800 leading-snug break-words flex-1">${card.title}</div>
            </div>
          </div>

          ${nextCard ? `
            <div class="my-0.5 flex items-center justify-center">
              <button onclick="cycleTransitMode(${d}, ${idx})" title="${legPillText}（點擊切換交通方式）"
                class="px-2 py-0.2 rounded-full ${pillColorClass} border hover:border-blue-400 text-[10px] font-semibold leading-tight transition">
                ↓ ${compactLegText}
              </button>
            </div>
          ` : ''}
        `;
      }

      // ==================== 標準完整細節卡片（單日聚焦 / 切換完整細節時） ====================
      const nextDayItems = d < totalDays ? (state.itinerary[d + 1]?.items || []) : [];
      const alreadyOnNextDay = nextDayItems.some(it => it.cardId === card.id);
      const showExtendHotelBtn = card.category === '住宿' && d < totalDays && !alreadyOnNextDay &&
        (!lodgingInfo || lodgingInfo.state !== 'checkout' || idx > 0);

      return `
        <div draggable="true"
          ondragstart="onDragStartItineraryItem(event, ${d}, ${idx})"
          class="bg-white rounded-xl border border-slate-200 hover:border-blue-400 p-2.5 shadow-2xs transition">
          <div class="flex items-center justify-between gap-1 mb-1">
            <span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-blue-700">
              ${timePillText}
            </span>
            <div class="flex items-center gap-0.5">
              ${lodgingInfo ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold border mr-0.5 ${lodgingInfo.badgeClass}">${lodgingInfo.label}</span>` : ''}
              ${roleBadgeHtml}
              <span class="px-1.5 py-0.5 rounded text-[10px] font-bold border mr-1 ${meta.badgeBg}">${card.category}</span>
              <button onclick="moveItineraryItem(${d}, ${idx}, -1)" ${idx === 0 ? 'disabled' : ''} title="往上移動"
                class="w-5 h-5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 disabled:opacity-25 text-[10px] flex items-center justify-center">
                <i class="fa-solid fa-arrow-up"></i>
              </button>
              <button onclick="moveItineraryItem(${d}, ${idx}, 1)" ${idx === items.length - 1 ? 'disabled' : ''} title="往下移動"
                class="w-5 h-5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 disabled:opacity-25 text-[10px] flex items-center justify-center">
                <i class="fa-solid fa-arrow-down"></i>
              </button>
              <button onclick="openCardModal('${card.id}')" title="編輯卡片"
                class="w-5 h-5 rounded hover:bg-amber-50 text-slate-400 hover:text-amber-600 text-[10px] flex items-center justify-center">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button onclick="removeItineraryItem(${d}, ${idx})" title="移出此日"
                class="w-5 h-5 rounded hover:bg-rose-50 text-slate-300 hover:text-rose-600 text-[10px] flex items-center justify-center">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          </div>

          <div class="flex items-start gap-2 cursor-pointer" onclick="focusCardOnMap('${card.id}')">
            <span class="w-5 h-5 rounded-full text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5"
              style="background-color:${pinBgColor}">${badgeNum}</span>
            <div class="min-w-0 flex-1">
              <h5 class="font-bold text-xs text-slate-800 break-words">${card.title}</h5>
              <p class="text-[11px] text-slate-500 mt-0.5">
                ${cleanDist}・停留 ${dur} 分${effectiveFlightNo ? '・' + effectiveFlightNo : ''}
              </p>
            </div>
          </div>

          ${isTransportOrAirport(card.category) ? `
            <div class="mt-1.5 pt-1.5 border-t border-slate-100 flex items-center gap-1.5">
              <button onclick="editItemFlightSchedule(${d}, ${idx})"
                class="px-2 py-0.5 rounded bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-[10px] font-bold">
                ✈️ 設定 Day ${d} 專屬航班時刻
              </button>
            </div>
          ` : ''}

          ${showExtendHotelBtn ? `
            <div class="mt-1.5 pt-1.5 border-t border-slate-100 flex items-center gap-1.5">
              <button onclick="extendHotelToNextDay(${d}, '${card.id}')"
                class="px-2 py-0.5 rounded bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-[10px] font-bold">
                🏨 延續至 Day ${d + 1}
              </button>
            </div>
          ` : ''}
        </div>

        ${nextCard ? `
          <div class="my-1 flex items-center justify-center gap-1">
            <button onclick="cycleTransitMode(${d}, ${idx})" title="點擊可循環切換：智慧自動 / 步行 / 單軌公車 / 計程車 / 自駕"
              class="px-2.5 py-0.5 rounded-full ${pillColorClass} border hover:border-blue-400 text-[10px] font-semibold shadow-2xs flex items-center gap-1 transition">
              <span>↓ ${legPillText}</span>
            </button>
            <button onclick="editLegCustomTime(${d}, ${idx})" title="校準此段精確分鐘數與路線備註"
              class="w-5 h-5 rounded-full bg-white border border-slate-200 hover:border-blue-400 text-slate-400 hover:text-blue-600 text-[9px] flex items-center justify-center shadow-2xs transition">
              <i class="fa-solid fa-pen"></i>
            </button>
          </div>
        ` : ''}
      `;
    }).join('');

    const endTimeStr = items.length > 0 ? minutesToTime(cursorMin) : initialStart;

    const colWidthClass = state.boardMultiDayMode
      ? (multiDayShowMap ? 'w-[260px] shrink-0' : 'flex-1 min-w-[205px]')
      : 'w-full';

    return `
      <div id="day-col-${d}"
        ondragover="onDragOverColumn(event)"
        ondragleave="onDragLeaveColumn(event)"
        ondrop="onDropOnDay(event, ${d})"
        class="${colWidthClass} bg-slate-50/95 rounded-2xl border border-slate-200 flex flex-col max-h-full overflow-hidden">
        
        <div class="${isCompactMulti ? 'px-2.5 py-2' : 'p-3'} bg-white border-b border-slate-200 space-y-1 shrink-0" style="border-top: 3px solid ${dayColor};">
          <div class="flex items-center justify-between gap-1">
            <div class="flex items-baseline gap-1 min-w-0">
              <span class="font-extrabold text-sm shrink-0" style="color:${dayColor}">Day ${d}</span>
              <span class="text-xs font-semibold text-slate-500 truncate">${info.md} (${info.week})</span>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <label class="text-[11px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
                ${isCompactMulti ? '' : '<span>出發</span>'}
                <input type="time" value="${initialStart}" onchange="updateDayStartTime(${d}, this.value)"
                  class="bg-transparent font-bold text-slate-700 focus:outline-none w-12" />
              </label>
              <button onclick="addReturnToHotel(${d})" title="將當晚住宿飯店加入行程最後作為回程"
                class="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-semibold">
                ${isCompactMulti ? '↩宿' : '↩ 回住宿'}
              </button>
            </div>
          </div>
          <div class="flex items-center justify-between text-[11px] text-slate-500">
            <span>${items.length}項・${(totalActMin / 60).toFixed(1).replace('.0', '')}h</span>
            <span class="text-blue-600 font-semibold">${isCompactMulti ? `~${endTimeStr}結束` : `移動 ${totalTransitMin} 分・約 ${endTimeStr} 結束`}</span>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto ${isCompactMulti ? 'p-2 space-y-1' : 'p-2.5 space-y-1'}">
          ${items.length > 0 ? cardsHtml : `
            <div class="h-32 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-slate-400 text-xs p-3 text-center">
              <i class="fa-solid fa-hand-pointer mb-1 text-base"></i>
              <span>可拖曳其他天行程至此</span>
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');
}

export function editItemFlightSchedule(dayNum, idx) {
  const item = state.itinerary[dayNum]?.items[idx];
  if (!item) return;
  const card = state.cards.find(c => c.id === item.cardId);
  if (!card) return;

  const existing = parseItemFlightSchedule(item) || { depart: '', arrive: '', flightNo: card.flightNo || '' };
  const role = getAirportRoleInDay(state.itinerary[dayNum].items, idx);

  if (role === 'arrival') {
    const arrInput = prompt(
      `設定 Day ${dayNum}「${card.title}」的入境抵達時間（例如：19:30，輸入空白可清除）：`,
      existing.arrive || (String(card.departTime || '').includes('抵達') ? card.departTime.replace(/抵達/g, '').trim() : '')
    );
    if (arrInput === null) return;
    const fltInput = prompt('航班代號／航廈備註（選填，例如：星宇 JX870）：', existing.flightNo || '');
    if (fltInput === null) return;

    item.customNote = arrInput.trim() || fltInput.trim()
      ? `flight||${arrInput.trim()}|${fltInput.trim()}`
      : '';
  } else {
    const depInput = prompt(
      `設定 Day ${dayNum}「${card.title}」的出境報到／起飛時間（例如：18:30 報到 / 20:30 起飛，輸入空白可清除）：`,
      existing.depart || ''
    );
    if (depInput === null) return;
    const fltInput = prompt('航班代號／航廈備註（選填，例如：星宇 JX871 國際航廈）：', existing.flightNo || '');
    if (fltInput === null) return;

    item.customNote = depInput.trim() || fltInput.trim()
      ? `flight|${depInput.trim()}||${fltInput.trim()}`
      : '';
  }

  persistState(true);
  renderKanbanBoard();
  showToast(`已更新 Day ${dayNum}「${card.title}」專屬航班時刻並同步至試算表`, 'emerald');
}

export function onDragStartCard(e, cardId) {
  dragPayload = { type: 'pocket', cardId };
  e.dataTransfer.effectAllowed = 'copyMove';
}

export function onDragStartItineraryItem(e, fromDay, fromIndex) {
  dragPayload = { type: 'itinerary', fromDay, fromIndex };
  e.dataTransfer.effectAllowed = 'move';
}

export function onDragOverColumn(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drop-zone-active');
}

export function onDragLeaveColumn(e) {
  e.currentTarget.classList.remove('drop-zone-active');
}

export function onDropOnDay(e, targetDay) {
  e.preventDefault();
  e.currentTarget.classList.remove('drop-zone-active');
  if (!dragPayload) return;

  if (dragPayload.type === 'pocket') {
    addCardToDay(dragPayload.cardId, targetDay);
  } else if (dragPayload.type === 'itinerary') {
    const { fromDay, fromIndex } = dragPayload;
    const [moved] = state.itinerary[fromDay].items.splice(fromIndex, 1);
    if (moved) state.itinerary[targetDay].items.push(moved);
    persistState(true);
    hooks.renderAll();
  }
  dragPayload = null;
}

export function quickAssignCardToDay(cardId, dayStr) {
  const day = parseInt(dayStr, 10);
  if (!day) return;
  addCardToDay(cardId, day);
}

export function addCardToDay(cardId, dayNum, shouldPersist = true) {
  ensureItineraryDays();
  const card = state.cards.find(c => c.id === cardId);
  if (!card) return;
  state.itinerary[dayNum].items.push({
    uid: 'it_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    cardId,
    customNote: '',
    transitMode: 'auto',
    transitMin: 0,
    customTransitNote: ''
  });
  state.mapOverviewAllDays = false;
  state.selectedMapDay = dayNum;
  document.getElementById('mapDaySelect').value = String(dayNum);
  if (shouldPersist) persistState(true);
  hooks.renderAll();
  showToast(`已將「${card.title}」排入 Day ${dayNum}`, 'emerald');
}

export function removeItineraryItem(dayNum, idx) {
  state.itinerary[dayNum].items.splice(idx, 1);
  persistState(true);
  hooks.renderAll();
}

export function updateDayStartTime(dayNum, val) {
  state.itinerary[dayNum].startTime = val || '09:00';
  persistState(true);
  renderKanbanBoard();
}

export function cycleTransitMode(dayNum, idx) {
  const item = state.itinerary[dayNum]?.items[idx];
  if (!item) return;
  const cardA = state.cards.find(c => c.id === item.cardId);
  const nextItem = state.itinerary[dayNum].items[idx + 1];
  const cardB = nextItem ? state.cards.find(c => c.id === nextItem.cardId) : null;
  const km = cardA && cardB ? haversineKm(cardA.lat, cardA.lng, cardB.lat, cardB.lng) : 2;

  if (isFlightLeg(cardA, cardB, km)) {
    showToast('跨海／機場航段已自動鎖定為「✈️ 航空飛航」', 'blue');
    return;
  }

  const modes = ['auto', 'walk', 'transit', 'taxi', 'drive'];
  const currentIdx = modes.indexOf(item.transitMode || 'auto');
  const next = modes[(currentIdx + 1) % modes.length];
  item.transitMode = next;
  item.transitMin = 0;
  item.customTransitNote = '';
  persistState(true);
  hooks.renderAll();
}

export function editLegCustomTime(dayNum, idx) {
  const item = state.itinerary[dayNum]?.items[idx];
  if (!item) return;
  const cardA = state.cards.find(c => c.id === item.cardId);
  const nextItem = state.itinerary[dayNum].items[idx + 1];
  const cardB = nextItem ? state.cards.find(c => c.id === nextItem.cardId) : null;
  if (!cardA || !cardB) return;

  const est = resolveLegModeAndEstimate(cardA, cardB, item.transitMode || 'auto');
  const currentMin = Number(item.transitMin) > 0 ? Number(item.transitMin) : est.min;

  const minInput = prompt(
    `校準「${cardA.title} → ${cardB.title}」的移動分鐘數（輸入 0 可恢復系統自動計算）：`,
    String(currentMin)
  );
  if (minInput === null) return;
  const parsedMin = Math.max(0, parseInt(minInput, 10) || 0);

  if (parsedMin === 0) {
    item.transitMin = 0;
    item.customTransitNote = '';
    persistState(true);
    hooks.renderAll();
    showToast('已恢復為系統自動計算時間', 'blue');
    return;
  }

  const noteInput = prompt(
    '可輸入具體搭乘班次或備註（例如：單軌旭橋→首里、346號公車，留空則維持原交通方式）：',
    item.customTransitNote || ''
  );
  if (noteInput === null) return;

  item.transitMin = parsedMin;
  item.customTransitNote = noteInput.trim();
  persistState(true);
  hooks.renderAll();
  showToast(`已鎖定此段移動時間為 ${parsedMin} 分並同步寫入試算表`, 'emerald');
}

export function extendHotelToNextDay(dayNum, cardId) {
  const nextDay = dayNum + 1;
  const totalDays = Number(state.settings.totalDays) || 6;
  if (nextDay > totalDays) return;
  ensureItineraryDays();
  const exists = state.itinerary[nextDay].items.some(it => it.cardId === cardId);
  if (exists) {
    showToast(`Day ${nextDay} 已有此住宿紀錄`, 'amber');
    return;
  }
  state.itinerary[nextDay].items.unshift({
    uid: 'hotel_' + Date.now(),
    cardId,
    customNote: '連住 / 退房出發',
    isCheckout: false,
    transitMode: 'auto',
    transitMin: 0,
    customTransitNote: ''
  });
  persistState(true);
  hooks.renderAll();
  showToast(`已將住宿延續至 Day ${nextDay}`, 'emerald');
}

export function addReturnToHotel(dayNum) {
  const items = state.itinerary[dayNum]?.items || [];
  const hotelItems = items.filter(it => {
    const c = state.cards.find(card => card.id === it.cardId);
    return c && c.category === '住宿';
  });

  if (hotelItems.length === 0) {
    showToast('當日尚未設定住宿卡片，請先排入住宿', 'amber');
    return;
  }

  const targetHotel = hotelItems[hotelItems.length - 1];
  addCardToDay(targetHotel.cardId, dayNum);
}

export function selectDayFocus(dayNum) {
  const wasMulti = state.boardMultiDayMode;
  state.boardMultiDayMode = false;
  state.mapOverviewAllDays = false;
  state.selectedMapDay = dayNum;
  const label = document.getElementById('boardModeLabel');
  if (label) label.textContent = '多日並列';
  if (wasMulti) {
    applyMultiDayWorkspaceLayout(false);
  }
  document.getElementById('mapDaySelect').value = String(dayNum);
  renderKanbanBoard();
  hooks.renderMapMarkers();
}

export function onMapDayChange() {
  const val = document.getElementById('mapDaySelect').value;
  if (val === 'all') {
    state.mapOverviewAllDays = true;
    hooks.renderMapMarkers();
    return;
  }
  state.mapOverviewAllDays = false;
  state.selectedMapDay = parseInt(val, 10) || 1;
  renderKanbanBoard();
  hooks.renderMapMarkers();
}

export function recalculateAllDayTimes() {
  Object.values(state.itinerary).forEach(day => {
    (day.items || []).forEach(it => {
      it.transitMode = 'auto';
      if (!(Number(it.transitMin) > 0)) {
        it.transitMin = 0;
      }
    });
  });
  persistState(true);
  renderKanbanBoard();
  hooks.renderMapMarkers();
}
