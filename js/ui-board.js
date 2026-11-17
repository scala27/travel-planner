import { CATEGORY_META, isTransportOrAirport } from './config.js';
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

export function toggleBoardMultiDayMode() {
  state.boardMultiDayMode = !state.boardMultiDayMode;
  const label = document.getElementById('boardModeLabel');
  if (label) label.textContent = state.boardMultiDayMode ? '單日聚焦' : '多日並列';
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

  navPills.innerHTML = Array.from({ length: totalDays }, (_, i) => {
    const d = i + 1;
    const info = getFormattedDateInfo(d);
    const count = (state.itinerary[d]?.items || []).length;
    const active = state.selectedMapDay === d;
    return `
      <button onclick="selectDayFocus(${d})"
        class="px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 shrink-0 transition ${active ? 'bg-blue-600 text-white shadow-2xs' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">
        <span>Day ${d}</span>
        <span class="font-normal opacity-80">${info.md}</span>
        <span class="px-1.5 rounded-full text-[10px] ${active ? 'bg-white/25 text-white' : 'bg-white text-slate-600'}">${count}</span>
      </button>`;
  }).join('');

  const daysToRender = state.boardMultiDayMode
    ? Array.from({ length: totalDays }, (_, i) => i + 1)
    : [state.selectedMapDay];

  board.innerHTML = daysToRender.map(d => {
    const info = getFormattedDateInfo(d);
    const dayData = state.itinerary[d] || { startTime: '09:00', items: [] };
    const items = dayData.items || [];

    let initialStart = dayData.startTime;
    if (items.length > 0) {
      const firstCard = state.cards.find(c => c.id === items[0].cardId);
      if (firstCard && isTransportOrAirport(firstCard.category) && firstCard.departTime) {
        const depTimes = extractClockTimes(firstCard.departTime);
        if (depTimes.length > 0 && dayData.startTime === '09:00') {
          initialStart = depTimes[0];
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

      const depTimes = isTransportOrAirport(card.category) ? extractClockTimes(card.departTime) : [];
      if (depTimes.length > 0 && idx === 0) {
        cursorMin = timeToMinutes(depTimes[0]);
      }

      const startStr = minutesToTime(cursorMin);
      const endStr = minutesToTime(cursorMin + dur);
      cursorMin += dur;
      if (card.category !== '住宿' && !isTransportOrAirport(card.category)) totalActMin += dur;

      const nextItem = items[idx + 1];
      const nextCard = nextItem ? state.cards.find(c => c.id === nextItem.cardId) : null;

      let activeMode = 'transit';
      let isHotelTransfer = false;
      let transitMin = 0;
      let legPillText = '';

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

        const arrTimes = isTransportOrAirport(card.category) ? extractClockTimes(card.arriveTime) : [];
        totalTransitMin += transitMin;
        if (arrTimes.length > 0) {
          cursorMin = timeToMinutes(arrTimes[arrTimes.length - 1]);
        } else {
          cursorMin += transitMin;
        }

        const transferPrefix = isHotelTransfer ? '🧳 換宿移動・' : '';
        const baseModeLabel = item.customTransitNote
          ? `📌 ${item.customTransitNote}`
          : getTransitModeDisplay(activeMode, transitDetailLabel);
        const modeLabel = `${transferPrefix}${baseModeLabel}`;
        const distLabel = formatDistanceLabel(legKm);
        const lockBadge = hasCustomLock ? ' 🔒' : '';

        if (activeMode === 'flight' && arrTimes.length > 0) {
          legPillText = `${modeLabel}｜${depTimes[depTimes.length - 1] || endStr} 起飛 → ${arrTimes[arrTimes.length - 1]} 抵達・約 ${transitMin} 分`;
        } else if (distLabel) {
          legPillText = `${modeLabel}｜約 ${distLabel}・${transitMin} 分${lockBadge}`;
        } else {
          legPillText = `${modeLabel}｜約 ${transitMin} 分${lockBadge}`;
        }
      }

      if (card.category !== '住宿' && !isTransportOrAirport(card.category)) pinCounter++;
      const badgeNum = card.category === '住宿' ? (item.isCheckout ? '退' : '宿') : (card.category === '機場' ? '機' : (card.category === '交通' ? '行' : pinCounter));
      const pinBgColor = (card.category === '住宿' && item.isCheckout) ? '#6b21a8' : meta.color;

      let timePillText = `${startStr} ~ ${endStr}`;
      if (isTransportOrAirport(card.category) && (card.departTime || card.arriveTime)) {
        const arrTimes = extractClockTimes(card.arriveTime);
        if (depTimes.length >= 2) {
          timePillText = `${depTimes[0]} 報到 ~ ${depTimes[1]} 起飛`;
        } else if (card.departTime) {
          timePillText = card.departTime.replace(/：/g, ':');
        } else if (arrTimes.length > 0) {
          timePillText = `${arrTimes[0]} 抵達 ~ ${minutesToTime(timeToMinutes(arrTimes[0]) + dur)}`;
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

      const showExtendHotelBtn = card.category === '住宿' && !item.isCheckout && d < totalDays;

      return `
        <div draggable="true"
          ondragstart="onDragStartItineraryItem(event, ${d}, ${idx})"
          class="bg-white rounded-xl border border-slate-200 hover:border-blue-400 p-2.5 shadow-2xs transition">
          <div class="flex items-center justify-between gap-1 mb-1">
            <span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-blue-700">
              ${timePillText}
            </span>
            <div class="flex items-center gap-0.5">
              ${item.isCheckout ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 mr-0.5">退房出發</span>` : ''}
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
                ${cleanDist}・停留 ${dur} 分${card.flightNo ? '・' + card.flightNo : ''}
              </p>
            </div>
          </div>

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
            <button onclick="editLegCustomTime(${d}, ${idx})" title="校準此段精確分鐘數與路線備註（如：38 分・346號公車）"
              class="w-5 h-5 rounded-full bg-white border border-slate-200 hover:border-blue-400 text-slate-400 hover:text-blue-600 text-[9px] flex items-center justify-center shadow-2xs transition">
              <i class="fa-solid fa-pen"></i>
            </button>
          </div>
        ` : ''}
      `;
    }).join('');

    const endTimeStr = items.length > 0 ? minutesToTime(cursorMin) : initialStart;
    const colWidthClass = state.boardMultiDayMode ? 'w-[300px] shrink-0' : 'w-full';

    return `
      <div id="day-col-${d}"
        ondragover="onDragOverColumn(event)"
        ondragleave="onDragLeaveColumn(event)"
        ondrop="onDropOnDay(event, ${d})"
        class="${colWidthClass} bg-slate-50/95 rounded-2xl border border-slate-200 flex flex-col max-h-full overflow-hidden">
        
        <div class="p-3 bg-white border-b border-slate-200 space-y-1 shrink-0">
          <div class="flex items-center justify-between">
            <div class="flex items-baseline gap-1.5">
              <span class="font-extrabold text-sm text-blue-700">Day ${d}</span>
              <span class="text-xs font-semibold text-slate-500">${info.md} (${info.week})</span>
            </div>
            <div class="flex items-center gap-1.5">
              <label class="text-[11px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md flex items-center gap-1">
                <span>出發</span>
                <input type="time" value="${initialStart}" onchange="updateDayStartTime(${d}, this.value)"
                  class="bg-transparent font-bold text-slate-700 focus:outline-none w-14" />
              </label>
              <button onclick="addReturnToHotel(${d})" title="將當日新入住（或最新）飯店加入行程最後作為回程"
                class="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-semibold">
                ↩ 回住宿
              </button>
            </div>
          </div>
          <div class="flex items-center justify-between text-[11px] text-slate-500">
            <span>共 ${items.length} 項・活動 ${(totalActMin / 60).toFixed(1).replace('.0', '')}h</span>
            <span class="text-blue-600 font-semibold">移動 ${totalTransitMin} 分・約 ${endTimeStr} 結束</span>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-1">
          ${items.length > 0 ? cardsHtml : `
            <div class="h-36 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-slate-400 text-xs p-4 text-center">
              <i class="fa-solid fa-hand-pointer mb-1.5 text-base"></i>
              <span>從左側口袋拖曳卡片至此，或點擊「+ Day ${d}」排入</span>
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');
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
  showToast(`已鎖定此段移動時間為 ${parsedMin} 分`, 'emerald');
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
    customNote: '連住出發 / 退房',
    isCheckout: true,
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

  const nonCheckoutHotels = hotelItems.filter(it => !it.isCheckout);
  const targetHotel = nonCheckoutHotels.length > 0
    ? nonCheckoutHotels[nonCheckoutHotels.length - 1]
    : hotelItems[hotelItems.length - 1];

  addCardToDay(targetHotel.cardId, dayNum);
}

export function selectDayFocus(dayNum) {
  state.mapOverviewAllDays = false;
  state.selectedMapDay = dayNum;
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
      // 若該段有手動鎖定 🔒 的時間則保留，其餘重設為自動計算
      if (!it.customTransitNote) {
        it.transitMin = 0;
      }
    });
  });
  renderKanbanBoard();
  hooks.renderMapMarkers();
}
