import { CATEGORY_STYLES } from './config.js';
import { state, hooks, persistState, showToast } from './state.js';

const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

export function getFormattedDateInfo(dayNum) {
  const base = new Date((state.settings.startDate || '2027-02-17') + 'T00:00:00');
  if (isNaN(base.getTime())) {
    return { md: `Day ${dayNum}`, week: '', full: `Day ${dayNum}` };
  }
  const d = new Date(base.getTime() + (dayNum - 1) * 86400000);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const week = WEEKDAYS[d.getDay()];
  return {
    md: `${m}/${day}`,
    week,
    full: `${d.getFullYear()}-${m}-${day}`
  };
}

function calcDistanceKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => v === null || v === undefined || isNaN(Number(v)))) return 0;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function estimateLegTransit(cardA, cardB, itemB) {
  if (!cardA || !cardB) return { modeLabel: '移動', icon: 'fa-arrow-down', km: 0, min: 0 };
  const km = calcDistanceKm(cardA.lat, cardA.lng, cardB.lat, cardB.lng);

  if (km > 250) {
    const flightMin = itemB?.customTransitMin ?? Math.max(60, Math.round(km / 8.2));
    return { modeLabel: '航空飛航', icon: 'fa-plane', km: Number(km.toFixed(1)), min: flightMin };
  }

  const profile = document.getElementById('transitProfileSelect')?.value || 'smart';
  let min = 15;
  let modeLabel = '市區移動';
  let icon = 'fa-bus';

  if (km <= 0.8) {
    min = Math.max(5, Math.round(km * 14));
    modeLabel = '步行前往';
    icon = 'fa-person-walking';
  } else if (profile === 'walk') {
    min = Math.max(8, Math.round(km * 14));
    modeLabel = '步行路徑';
    icon = 'fa-person-walking';
  } else if (profile === 'drive' || profile === 'taxi') {
    min = Math.max(8, Math.round(km * 1.9 + 5));
    modeLabel = profile === 'taxi' ? '計程車' : '自駕道路';
    icon = 'fa-car';
  } else {
    min = Math.max(10, Math.round(km * 2.5 + 8));
    modeLabel = '大眾運輸 / 接駁';
    icon = 'fa-train-subway';
  }

  if (itemB && itemB.customTransitMin !== null && itemB.customTransitMin !== undefined && !isNaN(Number(itemB.customTransitMin))) {
    min = Number(itemB.customTransitMin);
  }

  return { modeLabel, icon, km: Number(km.toFixed(1)), min };
}

function parseMinutes(hhmm) {
  const [h, m] = (hhmm || '09:00').split(':').map(n => parseInt(n, 10) || 0);
  return h * 60 + m;
}

function formatMinutes(totalMin) {
  const wrapped = ((totalMin % 1440) + 1440) % 1440;
  const h = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const m = String(wrapped % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export function toggleBoardMultiDayMode() {
  state.boardMultiDayMode = !state.boardMultiDayMode;
  const label = document.getElementById('boardModeLabel');
  if (label) label.textContent = state.boardMultiDayMode ? '單日聚焦' : '多日並列';
  renderKanbanBoard();
}

export function selectDayFocus(dayNum) {
  state.selectedMapDay = Number(dayNum);
  state.mapOverviewAllDays = false;
  const mapSel = document.getElementById('mapDaySelect');
  if (mapSel) mapSel.value = String(dayNum);
  renderKanbanBoard();
  if (typeof hooks.renderMapMarkers === 'function') hooks.renderMapMarkers();
}

export function onMapDayChange() {
  const val = document.getElementById('mapDaySelect')?.value;
  if (val === 'all') {
    state.mapOverviewAllDays = true;
  } else {
    state.mapOverviewAllDays = false;
    state.selectedMapDay = Number(val) || 1;
  }
  renderKanbanBoard();
  if (typeof hooks.renderMapMarkers === 'function') hooks.renderMapMarkers();
}

export function recalculateAllDayTimes() {
  renderKanbanBoard();
  if (typeof hooks.renderMapMarkers === 'function') hooks.renderMapMarkers();
}

export function renderKanbanBoard() {
  const pillsBox = document.getElementById('dayNavPills');
  const boardContainer = document.getElementById('kanbanColumnsContainer');
  if (!pillsBox || !boardContainer) return;

  const totalDays = Math.max(1, Number(state.settings.totalDays) || 6);
  const activeDay = Math.min(totalDays, Math.max(1, Number(state.selectedMapDay) || 1));

  // Day 1 ~ Day N 快速切換膠囊
  const pillsHtml = [];
  for (let d = 1; d <= totalDays; d++) {
    const info = getFormattedDateInfo(d);
    const count = (state.itinerary[d]?.items || []).length;
    const isSelected = !state.boardMultiDayMode && d === activeDay;
    pillsHtml.push(`
      <button type="button" onclick="selectDayFocus(${d})"
        class="px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 shrink-0 transition ${
          isSelected
            ? 'bg-[#2C4D6E] text-white shadow-xs'
            : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
        }">
        <span class="w-2 h-2 rounded-full ${isSelected ? 'bg-amber-300' : 'bg-emerald-500'}"></span>
        <span>Day ${d}</span>
        <span class="opacity-80 font-medium">${info.md}</span>
        <span class="px-1.5 py-0.2 rounded-full text-[10px] ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}">${count}</span>
      </button>
    `);
  }
  pillsBox.innerHTML = pillsHtml.join('');

  // 決定要渲染哪些天數欄位
  const daysToRender = state.boardMultiDayMode
    ? Array.from({ length: totalDays }, (_, i) => i + 1)
    : [activeDay];

  const timeOptions = [];
  for (let h = 0; h < 24; h++) {
    for (const m of ['00', '30']) {
      const t = `${String(h).padStart(2, '0')}:${m}`;
      timeOptions.push(t);
    }
  }

  boardContainer.innerHTML = daysToRender
    .map(dayNum => {
      const dayData = state.itinerary[dayNum] || { startTime: '09:00', items: [] };
      const info = getFormattedDateInfo(dayNum);
      let cursorMin = parseMinutes(dayData.startTime || '09:00');
      let totalTransitMin = 0;

      const itemsHtml = dayData.items
        .map((item, idx) => {
          const card = state.cards.find(c => c.id === item.cardId);
          if (!card) return '';

          let legHtml = '';
          if (idx > 0) {
            const prevCard = state.cards.find(c => c.id === dayData.items[idx - 1].cardId);
            const leg = estimateLegTransit(prevCard, card, item);
            cursorMin += leg.min;
            totalTransitMin += leg.min;
            legHtml = `
              <div class="my-1.5 px-2.5 py-1.5 rounded-full bg-white border border-slate-200/90 flex items-center justify-between gap-2 text-[11px] text-slate-600 shadow-2xs">
                <div class="flex items-center gap-1.5 truncate">
                  <span class="text-slate-400">↓</span>
                  <i class="fa-solid ${leg.icon} text-[#2C4D6E]"></i>
                  <span class="truncate">${leg.modeLabel}｜約 ${leg.km} 公里・<strong>${leg.min} 分</strong></span>
                </div>
                <button type="button" onclick="editLegCustomTime(${dayNum}, ${idx})" title="自訂此段交通時間"
                  class="w-5 h-5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center shrink-0">
                  <i class="fa-solid fa-pen text-[10px]"></i>
                </button>
              </div>
            `;
          }

          const startStr = formatMinutes(cursorMin);
          const stayMin = Number(card.duration) || 60;
          cursorMin += stayMin;
          const endStr = formatMinutes(cursorMin);
          const style = CATEGORY_STYLES[card.category] || CATEGORY_STYLES['景點'];

          return `
            ${legHtml}
            <div draggable="true"
              ondragstart="onDragStartItineraryItem(event, ${dayNum}, ${idx})"
              class="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs hover:border-[#2C4D6E]/50 transition space-y-2">
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                  <div class="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 font-bold text-[11px] leading-tight shrink-0 text-center">
                    <div>${startStr}</div>
                    <div class="text-[10px] text-slate-400">~ ${endStr}</div>
                  </div>
                  <span class="px-2 py-0.5 rounded-md text-[11px] font-bold ${style.badge} shrink-0">${card.category}</span>
                </div>

                <div class="flex items-center gap-1 shrink-0">
                  <button type="button" onclick="focusCardOnMap('${card.id}')" title="在地圖定位"
                    class="w-6 h-6 rounded-md hover:bg-blue-50 text-[#2C4D6E] flex items-center justify-center text-xs">
                    <i class="fa-solid fa-diamond-turn-right"></i>
                  </button>
                  <button type="button" onclick="moveItineraryItem(${dayNum}, ${idx}, -1)" title="上移"
                    class="w-6 h-6 rounded-md hover:bg-slate-100 text-slate-500 flex items-center justify-center text-xs">
                    <i class="fa-solid fa-arrow-up"></i>
                  </button>
                  <button type="button" onclick="moveItineraryItem(${dayNum}, ${idx}, 1)" title="下移"
                    class="w-6 h-6 rounded-md hover:bg-slate-100 text-slate-500 flex items-center justify-center text-xs">
                    <i class="fa-solid fa-arrow-down"></i>
                  </button>
                  <button type="button" onclick="openCardModal('${card.id}')" title="編輯卡片"
                    class="w-6 h-6 rounded-md hover:bg-slate-100 text-slate-500 flex items-center justify-center text-xs">
                    <i class="fa-solid fa-pen"></i>
                  </button>
                  <button type="button" onclick="removeItineraryItem(${dayNum}, ${idx})" title="移出此日行程"
                    class="w-6 h-6 rounded-md hover:bg-rose-50 text-rose-500 flex items-center justify-center text-xs">
                    <i class="fa-solid fa-xmark"></i>
                  </button>
                </div>
              </div>

              <div class="flex items-start gap-2">
                <span class="w-5 h-5 rounded-full bg-[#2C4D6E] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  ${idx + 1}
                </span>
                <div class="min-w-0 flex-1">
                  <h4 class="font-bold text-sm text-slate-800 leading-snug break-words">${card.title}</h4>
                  <p class="text-[11px] text-slate-500 mt-0.5">
                    ${card.district ? `${card.district}・` : ''}停留 ${stayMin} 分
                  </p>
                </div>
              </div>
            </div>
          `;
        })
        .join('');

      const endDayStr = dayData.items.length > 0 ? formatMinutes(cursorMin) : dayData.startTime;
      const selectOpts = timeOptions
        .map(t => `<option value="${t}" ${t === (dayData.startTime || '09:00') ? 'selected' : ''}>${t}</option>`)
        .join('');

      return `
        <div ondragover="onDragOverColumn(event)" ondragleave="onDragLeaveColumn(event)" ondrop="onDropOnDay(event, ${dayNum})"
          class="${state.boardMultiDayMode ? 'w-80 shrink-0' : 'w-full'} bg-white rounded-2xl border border-slate-200 shadow-2xs flex flex-col overflow-hidden">
          <!-- 單日標頭（修正手機版出發時間不被裁切） -->
          <div class="p-3 border-b border-slate-100 bg-slate-50/60 space-y-1.5 shrink-0">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-baseline gap-1.5">
                <span class="text-base font-extrabold text-[#2C4D6E]">Day ${dayNum}</span>
                <span class="text-xs font-semibold text-slate-500">${info.md} (${info.week})</span>
              </div>

              <div class="flex items-center gap-1.5 shrink-0">
                <div class="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs">
                  <span class="text-slate-500 font-medium shrink-0">出發</span>
                  <select onchange="updateDayStartTime(${dayNum}, this.value)"
                    class="font-bold text-slate-800 bg-transparent focus:outline-none cursor-pointer min-w-[54px]">
                    ${selectOpts}
                  </select>
                </div>
                <button type="button" onclick="addReturnToHotel(${dayNum})"
                  class="px-2 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-700 shrink-0">
                  ↩ 回住宿
                </button>
              </div>
            </div>

            <div class="flex items-center justify-between text-[11px] text-slate-500">
              <span>共 ${dayData.items.length} 個行程點</span>
              <span class="font-bold text-[#2C4D6E]">移動 ${totalTransitMin} 分・約 ${endDayStr} 結束</span>
            </div>
          </div>

          <!-- 行程卡片列表 -->
          <div class="flex-1 overflow-y-auto p-2.5 space-y-1 bg-slate-50/30">
            ${
              itemsHtml ||
              `<div class="h-44 flex flex-col items-center justify-center text-center text-slate-400 text-xs p-4 border-2 border-dashed border-slate-200 rounded-xl">
                <i class="fa-regular fa-calendar-plus text-2xl mb-2 text-slate-300"></i>
                <p class="font-semibold text-slate-500">尚未排入任何景點</p>
                <p class="text-[11px] mt-1">請切換至「口袋清單」點擊「＋排入」加入行程</p>
              </div>`
            }
          </div>
        </div>
      `;
    })
    .join('');
}

export function addCardToDay(cardId, dayNum) {
  const d = Number(dayNum);
  if (!state.itinerary[d]) state.itinerary[d] = { startTime: '09:00', items: [] };
  state.itinerary[d].items.push({
    uid: `it_${cardId}_${d}_${Date.now()}`,
    cardId,
    order: state.itinerary[d].items.length + 1,
    transitMode: 'auto',
    customTransitMin: null
  });
  persistState(true);
  if (typeof hooks.renderAll === 'function') hooks.renderAll();
  showToast(`已排入 Day ${d}`, 'emerald');
}

export function quickAssignCardToDay(cardId, selectEl) {
  const val = selectEl.value;
  if (!val) return;
  addCardToDay(cardId, Number(val));
  selectEl.value = '';
}

export function removeItineraryItem(dayNum, idx) {
  const list = state.itinerary[dayNum]?.items;
  if (!list) return;
  list.splice(idx, 1);
  persistState(true);
  if (typeof hooks.renderAll === 'function') hooks.renderAll();
  showToast('已從當日行程移除', 'slate');
}

export function moveItineraryItem(dayNum, idx, delta) {
  const list = state.itinerary[dayNum]?.items;
  if (!list) return;
  const target = idx + delta;
  if (target < 0 || target >= list.length) return;
  const [moved] = list.splice(idx, 1);
  list.splice(target, 0, moved);
  persistState(true);
  if (typeof hooks.renderAll === 'function') hooks.renderAll();
}

export function updateDayStartTime(dayNum, newTime) {
  if (!state.itinerary[dayNum]) state.itinerary[dayNum] = { startTime: newTime, items: [] };
  state.itinerary[dayNum].startTime = newTime;
  persistState(true);
  renderKanbanBoard();
}

export function editLegCustomTime(dayNum, idx) {
  const item = state.itinerary[dayNum]?.items?.[idx];
  if (!item) return;
  const current = item.customTransitMin ?? '';
  const input = prompt('請輸入此段交通移動時間（分鐘，留空則恢復自動估算）：', String(current));
  if (input === null) return;
  const trimmed = input.trim();
  item.customTransitMin = trimmed === '' ? null : Math.max(0, parseInt(trimmed, 10) || 0);
  persistState(true);
  renderKanbanBoard();
}

export function addReturnToHotel(dayNum) {
  const hotelCard = state.cards.find(c => c.category === '住宿');
  if (!hotelCard) {
    showToast('口袋清單中尚無「住宿」類別卡片', 'amber');
    return;
  }
  addCardToDay(hotelCard.id, dayNum);
}

export function cycleTransitMode() {}
export function editItemFlightSchedule() {}
export function extendHotelToNextDay() {}

let dragPayload = null;

export function onDragStartCard(event, cardId) {
  dragPayload = { type: 'card', cardId };
}

export function onDragStartItineraryItem(event, fromDay, fromIdx) {
  dragPayload = { type: 'item', fromDay, fromIdx };
}

export function onDragOverColumn(event) {
  event.preventDefault();
}

export function onDragLeaveColumn() {}

export function onDropOnDay(event, targetDay) {
  event.preventDefault();
  if (!dragPayload) return;
  if (dragPayload.type === 'card') {
    addCardToDay(dragPayload.cardId, targetDay);
  } else if (dragPayload.type === 'item') {
    const { fromDay, fromIdx } = dragPayload;
    const srcList = state.itinerary[fromDay]?.items;
    if (srcList && srcList[fromIdx]) {
      const [moved] = srcList.splice(fromIdx, 1);
      if (!state.itinerary[targetDay]) state.itinerary[targetDay] = { startTime: '09:00', items: [] };
      state.itinerary[targetDay].items.push(moved);
      persistState(true);
      if (typeof hooks.renderAll === 'function') hooks.renderAll();
    }
  }
  dragPayload = null;
}
