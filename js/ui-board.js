import { CATEGORY_STYLES, DAY_COLORS } from './config.js';
import { state, hooks, persistState, showToast } from './state.js';

const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
let okinawaTransitData = null;
const expandedNoteKeys = new Set();

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toggleItineraryNoteExpand(event, noteKey) {
  if (event) event.stopPropagation();
  if (expandedNoteKeys.has(noteKey)) {
    expandedNoteKeys.delete(noteKey);
  } else {
    expandedNoteKeys.add(noteKey);
  }
  renderKanbanBoard();
}

window.toggleItineraryNoteExpand = toggleItineraryNoteExpand;

export function setOkinawaTransitData(data) {
  okinawaTransitData = data;
}

export function getDayColor(dayNum) {
  const idx = (Number(dayNum) - 1) % DAY_COLORS.length;
  const customMap = state.settings?.dayColors || {};
  return customMap[dayNum] || customMap[String(dayNum)] || DAY_COLORS[idx] || '#2C4D6E';
}

export function updateDayColor(dayNum, hexColor) {
  if (!hexColor) return;
  if (!state.settings.dayColors) state.settings.dayColors = {};
  state.settings.dayColors[dayNum] = hexColor;
  persistState(true);
  renderKanbanBoard();
  if (typeof hooks.renderMapMarkers === 'function') hooks.renderMapMarkers();
  showToast('已將 Day ' + dayNum + ' 路線代表色更新為 ' + hexColor, 'emerald');
}

window.updateDayColor = updateDayColor;

export function getFormattedDateInfo(dayNum) {
  const base = new Date((state.settings.startDate || '2027-02-17') + 'T00:00:00');
  if (isNaN(base.getTime())) {
    return { md: 'Day ' + dayNum, week: '', full: 'Day ' + dayNum };
  }
  const d = new Date(base.getTime() + (dayNum - 1) * 86400000);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const week = WEEKDAYS[d.getDay()];
  return {
    md: m + '/' + day,
    week,
    full: d.getFullYear() + '-' + m + '-' + day
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

function findNearestTransitStop(stops, lat, lng) {
  let best = null;
  let minKm = Infinity;
  (stops || []).forEach(st => {
    const km = calcDistanceKm(lat, lng, st.lat, st.lng);
    if (km < minKm) {
      minKm = km;
      best = { ...st, km };
    }
  });
  return best;
}

export function estimateLegTransit(cardA, cardB, itemB) {
  if (!cardA || !cardB) return { modeLabel: '移動', icon: 'fa-arrow-down', km: 0, min: 0 };
  const km = calcDistanceKm(cardA.lat, cardA.lng, cardB.lat, cardB.lng);

  if (km > 250) {
    const flightMin = itemB?.customTransitMin ?? Math.max(60, Math.round(km / 8.2));
    return { modeLabel: '航空飛航', icon: 'fa-plane', km: Number(km.toFixed(1)), min: flightMin };
  }

  const itemMode = itemB?.transitMode && itemB.transitMode !== 'auto' ? itemB.transitMode : null;
  const profile = itemMode || document.getElementById('transitProfileSelect')?.value || 'smart';
  let min = 15;
  let modeLabel = '市區移動';
  let icon = 'fa-bus';

  if (km <= 0.6 && !itemMode) {
    min = Math.max(4, Math.round(km * 14));
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
    let matchedGtfs = false;
    if (okinawaTransitData && cardA.lat != null && cardB.lat != null) {
      const yui = okinawaTransitData.yui_rail;
      if (yui && Array.isArray(yui.stations)) {
        const stA = findNearestTransitStop(yui.stations, cardA.lat, cardA.lng);
        const stB = findNearestTransitStop(yui.stations, cardB.lat, cardB.lng);
        if (stA && stB && stA.id !== stB.id && stA.km <= 1.2 && stB.km <= 1.2) {
          const rideMin = Math.abs((stB.cumMin || 0) - (stA.cumMin || 0));
          const walkMin = Math.round((stA.km + stB.km) * 14);
          min = rideMin + (yui.waitMin || 3) + walkMin;
          modeLabel = '單軌電車（' + stA.name.replace('站', '') + '→' + stB.name.replace('站', '') + '）';
          icon = 'fa-train-subway';
          matchedGtfs = true;
        }
      }

      if (!matchedGtfs && Array.isArray(okinawaTransitData.buses)) {
        let bestBus = null;
        let bestWalk = Infinity;
        okinawaTransitData.buses.forEach(bus => {
          const bA = findNearestTransitStop(bus.stops, cardA.lat, cardA.lng);
          const bB = findNearestTransitStop(bus.stops, cardB.lat, cardB.lng);
          if (bA && bB && bA.id !== bB.id && bA.km <= 1.5 && bB.km <= 1.5 && bA.km + bB.km < bestWalk) {
            bestWalk = bA.km + bB.km;
            bestBus = { bus, bA, bB };
          }
        });
        if (bestBus) {
          const rideMin = Math.abs((bestBus.bB.cumMin || 0) - (bestBus.bA.cumMin || 0));
          const walkMin = Math.round(bestWalk * 14);
          min = rideMin + (bestBus.bus.waitMin || 7) + walkMin;
          modeLabel = bestBus.bus.routeNo;
          icon = 'fa-bus';
          matchedGtfs = true;
        }
      }
    }

    if (!matchedGtfs) {
      min = Math.max(10, Math.round(km * 2.5 + 8));
      modeLabel = '大眾運輸 / 接駁';
      icon = 'fa-bus';
    }
  }

  if (itemB && itemB.customTransitMin !== null && itemB.customTransitMin !== undefined && !isNaN(Number(itemB.customTransitMin))) {
    min = Number(itemB.customTransitMin);
  }

  return { modeLabel, icon, km: Number(km.toFixed(1)), min };
}

function normalizeTimeStr(hhmm) {
  if (hhmm === null || hhmm === undefined) return '';
  return String(hhmm).replace(/：/g, ':').replace(/\s+/g, '').trim();
}

function parseMinutes(hhmm) {
  const clean = normalizeTimeStr(hhmm || '09:00');
  const parts = clean.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h)) return 9 * 60;
  return h * 60 + (isNaN(m) ? 0 : m);
}

function formatMinutes(totalMin) {
  if (isNaN(totalMin)) return '09:00';
  const wrapped = ((totalMin % 1440) + 1440) % 1440;
  const h = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const m = String(wrapped % 60).padStart(2, '0');
  return h + ':' + m;
}

function parseFlightNote(customNote) {
  const str = String(customNote || '').trim();
  if (!str.startsWith('flight|')) return null;
  const parts = str.split('|');
  const p1 = normalizeTimeStr(parts[1] || '');
  const p2 = normalizeTimeStr(parts[2] || '');
  const p3 = (parts[3] || '').trim();

  if (p1.includes('/')) {
    const [dep, arr] = p1.split('/');
    return {
      depTime: normalizeTimeStr(dep),
      arrTime: normalizeTimeStr(arr),
      airline: p3 || p2
    };
  }
  if (parts.length >= 4) {
    return {
      depTime: p1,
      arrTime: p2,
      airline: p3
    };
  }
  return {
    depTime: p1,
    arrTime: '',
    airline: p2
  };
}

// ==================== 三點動作選單控制 ====================
let openActionMenuKey = null;

export function toggleCardActionMenu(event, menuKey) {
  if (event) event.stopPropagation();
  const prevKey = openActionMenuKey;
  closeAllCardActionMenus();
  if (prevKey !== menuKey) {
    const menuEl = document.getElementById('card-menu-' + menuKey);
    if (menuEl) {
      menuEl.classList.remove('hidden');
      openActionMenuKey = menuKey;
    }
  }
}

export function closeAllCardActionMenus() {
  document.querySelectorAll('.itinerary-card-menu').forEach(el => el.classList.add('hidden'));
  openActionMenuKey = null;
}

window.toggleCardActionMenu = toggleCardActionMenu;
window.closeAllCardActionMenus = closeAllCardActionMenus;

if (!window.__echiMenuListenerAttached) {
  window.__echiMenuListenerAttached = true;
  document.addEventListener('click', () => {
    closeAllCardActionMenus();
  });
}

// ==================== 手機版左右滑動切換天數 & 長按拖曳排序 ====================
let boardGesturesInitialized = false;
let touchDragState = null;

function clearAllDropIndicators() {
  document.querySelectorAll('.itinerary-item-card').forEach(el => {
    el.style.borderTop = '';
    el.style.borderBottom = '';
    el.classList.remove('ring-2', 'ring-[#2C4D6E]', 'opacity-50', 'scale-[0.98]', 'shadow-lg');
  });
}

function getTouchTargetSlot(clientX, clientY, dayNum) {
  const cards = Array.from(
    document.querySelectorAll('.itinerary-item-card[data-day="' + dayNum + '"]')
  );
  if (cards.length === 0) return { insertIndex: 0, targetEl: null, position: 'bottom' };

  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (clientY < midY) {
      return { insertIndex: i, targetEl: cards[i], position: 'top' };
    }
  }
  return {
    insertIndex: cards.length,
    targetEl: cards[cards.length - 1],
    position: 'bottom'
  };
}

function initBoardTouchGestures(boardContainer) {
  if (boardGesturesInitialized || !boardContainer) return;
  boardGesturesInitialized = true;

  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeStartTime = 0;
  let longPressTimer = null;

  boardContainer.addEventListener(
    'touchstart',
    e => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      swipeStartX = touch.clientX;
      swipeStartY = touch.clientY;
      swipeStartTime = Date.now();

      const interactiveEl = e.target.closest('button, select, input, label, a');
      const cardEl = e.target.closest('.itinerary-item-card');

      if (cardEl && !interactiveEl) {
        const dayNum = Number(cardEl.dataset.day);
        const idx = Number(cardEl.dataset.idx);
        longPressTimer = setTimeout(() => {
          closeAllCardActionMenus();
          if (navigator.vibrate) {
            try { navigator.vibrate(25); } catch (err) {}
          }
          touchDragState = {
            dayNum,
            fromIdx: idx,
            insertIndex: idx,
            sourceEl: cardEl
          };
          cardEl.classList.add('ring-2', 'ring-[#2C4D6E]', 'opacity-50', 'scale-[0.98]', 'shadow-lg');
          showToast('上下拖動調整順序，放開即完成', 'blue');
        }, 350);
      }
    },
    { passive: true }
  );

  boardContainer.addEventListener(
    'touchmove',
    e => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dx = touch.clientX - swipeStartX;
      const dy = touch.clientY - swipeStartY;

      if (!touchDragState) {
        if (Math.hypot(dx, dy) > 10 && longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        return;
      }

      e.preventDefault();
      const { dayNum, sourceEl } = touchDragState;
      const dayColor = getDayColor(dayNum);

      document.querySelectorAll('.itinerary-item-card').forEach(el => {
        if (el !== sourceEl) {
          el.style.borderTop = '';
          el.style.borderBottom = '';
        }
      });

      const slot = getTouchTargetSlot(touch.clientX, touch.clientY, dayNum);
      touchDragState.insertIndex = slot.insertIndex;
      if (slot.targetEl) {
        if (slot.position === 'top') {
          slot.targetEl.style.borderTop = '3px solid ' + dayColor;
        } else {
          slot.targetEl.style.borderBottom = '3px solid ' + dayColor;
        }
      }

      const scrollBox = sourceEl?.closest('.day-items-scroll-area');
      if (scrollBox) {
        const boxRect = scrollBox.getBoundingClientRect();
        if (touch.clientY < boxRect.top + 45) {
          scrollBox.scrollTop -= 8;
        } else if (touch.clientY > boxRect.bottom - 45) {
          scrollBox.scrollTop += 8;
        }
      }
    },
    { passive: false }
  );

  const finishTouch = e => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    if (touchDragState) {
      const { dayNum, fromIdx, insertIndex } = touchDragState;
      touchDragState = null;
      clearAllDropIndicators();

      const list = state.itinerary[dayNum]?.items;
      if (list && list[fromIdx]) {
        const targetIdx = insertIndex > fromIdx ? insertIndex - 1 : insertIndex;
        if (targetIdx !== fromIdx && targetIdx >= 0 && targetIdx < list.length) {
          const [moved] = list.splice(fromIdx, 1);
          list.splice(targetIdx, 0, moved);
          persistState(true);
          if (typeof hooks.renderAll === 'function') hooks.renderAll();
          showToast('已調整行程順序', 'emerald');
        }
      }
      return;
    }

    if (window.innerWidth > 768 || state.boardMultiDayMode) return;
    const changedTouch = e.changedTouches && e.changedTouches[0];
    if (!changedTouch) return;

    const dx = changedTouch.clientX - swipeStartX;
    const dy = changedTouch.clientY - swipeStartY;
    const elapsed = Date.now() - swipeStartTime;

    if (elapsed < 600 && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      const totalDays = Math.max(1, Number(state.settings.totalDays) || 6);
      const currentDay = Math.min(totalDays, Math.max(1, Number(state.selectedMapDay) || 1));
      if (dx < 0 && currentDay < totalDays) {
        selectDayFocus(currentDay + 1);
      } else if (dx > 0 && currentDay > 1) {
        selectDayFocus(currentDay - 1);
      }
    }
  };

  boardContainer.addEventListener('touchend', finishTouch, { passive: true });
  boardContainer.addEventListener('touchcancel', () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    touchDragState = null;
    clearAllDropIndicators();
  });
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

  initBoardTouchGestures(boardContainer);
  openActionMenuKey = null;

  const totalDays = Math.max(1, Number(state.settings.totalDays) || 6);
  const activeDay = Math.min(totalDays, Math.max(1, Number(state.selectedMapDay) || 1));

  const pillsHtml = [];
  for (let d = 1; d <= totalDays; d++) {
    const info = getFormattedDateInfo(d);
    const count = (state.itinerary[d]?.items || []).length;
    const isSelected = !state.boardMultiDayMode && d === activeDay;
    const dayColor = getDayColor(d);
    const btnStyle = isSelected ? 'background:' + dayColor + ';border-color:' + dayColor + ';color:#ffffff;' : '';
    const dotBg = isSelected ? '#ffffff' : dayColor;
    const btnCls = isSelected
      ? 'shadow-xs'
      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100';
    const badgeCls = isSelected ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600';

    pillsHtml.push(
      '<button type="button" data-day-pill="' + d + '" onclick="selectDayFocus(' + d + ')" style="' + btnStyle + '" ' +
      'class="px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 shrink-0 transition ' + btnCls + '">' +
      '<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:' + dotBg + '"></span>' +
      '<span>Day ' + d + '</span>' +
      '<span class="opacity-85 font-medium">' + info.md + '</span>' +
      '<span class="px-1.5 py-0.2 rounded-full text-[10px] ' + badgeCls + '">' + count + '</span>' +
      '</button>'
    );
  }
  pillsBox.innerHTML = pillsHtml.join('');

  const activePillEl = pillsBox.querySelector('[data-day-pill="' + activeDay + '"]');
  if (activePillEl && typeof activePillEl.scrollIntoView === 'function') {
    activePillEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  const daysToRender = state.boardMultiDayMode
    ? Array.from({ length: totalDays }, (_, i) => i + 1)
    : [activeDay];

  const timeOptions = [];
  for (let h = 0; h < 24; h++) {
    for (const m of ['00', '30']) {
      timeOptions.push(String(h).padStart(2, '0') + ':' + m);
    }
  }

  boardContainer.innerHTML = daysToRender
    .map(dayNum => {
      const dayColor = getDayColor(dayNum);
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
            legHtml =
              '<div class="my-1.5 px-2.5 py-1.5 rounded-full bg-white border border-slate-200/90 flex items-center justify-between gap-2 text-[11px] text-slate-600 shadow-2xs">' +
              '<button type="button" onclick="cycleTransitMode(' + dayNum + ', ' + idx + ')" title="點擊切換交通方式（自動/單軌/開車/步行）" ' +
              'class="flex items-center gap-1.5 truncate hover:opacity-80 text-left">' +
              '<span class="text-slate-400">↓</span>' +
              '<i class="fa-solid ' + leg.icon + '" style="color:' + dayColor + '"></i>' +
              '<span class="truncate">' + leg.modeLabel + '｜約 ' + leg.km + ' 公里・<strong>' + leg.min + ' 分</strong></span>' +
              '</button>' +
              '<button type="button" onclick="editLegCustomTime(' + dayNum + ', ' + idx + ')" title="自訂此段交通時間" ' +
              'class="w-5 h-5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center shrink-0">' +
              '<i class="fa-solid fa-pen text-[10px]"></i>' +
              '</button>' +
              '</div>';
          }

          const flightInfo = parseFlightNote(item.customNote);
          const stayMin = Number(card.duration) || 60;
          let timeLineTop = formatMinutes(cursorMin);
          let timeLineBottom = '~ ' + formatMinutes(cursorMin + stayMin);
          let roleBadge = '';

          if (card.category === '機場') {
            if (flightInfo?.depTime && flightInfo?.arrTime) {
              timeLineTop = flightInfo.depTime + ' 報到 ~';
              timeLineBottom = flightInfo.arrTime + ' 起飛';
              roleBadge = '<span class="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 text-[10px] font-bold">出境搭機</span>';
              cursorMin = parseMinutes(flightInfo.arrTime);
            } else if (flightInfo?.arrTime) {
              const arrMin = parseMinutes(flightInfo.arrTime);
              timeLineTop = formatMinutes(arrMin) + ' 抵達 ~';
              timeLineBottom = formatMinutes(arrMin + stayMin);
              roleBadge = '<span class="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 text-[10px] font-bold">入境抵達</span>';
              cursorMin = arrMin + stayMin;
            } else if (flightInfo?.depTime) {
              const depMin = parseMinutes(flightInfo.depTime);
              timeLineTop = formatMinutes(depMin) + ' 報到 ~';
              timeLineBottom = formatMinutes(depMin + stayMin);
              roleBadge = '<span class="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 text-[10px] font-bold">出境搭機</span>';
              cursorMin = depMin + stayMin;
            } else {
              cursorMin += stayMin;
            }
          } else {
            cursorMin += stayMin;
            if (card.category === '住宿') {
              roleBadge = item.isCheckout
                ? '<span class="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-bold">退房出發</span>'
                : '<span class="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-bold">入住/返回</span>';
            }
          }

          const style = CATEGORY_STYLES[card.category] || CATEGORY_STYLES['景點'];
          const airlineTag = flightInfo?.airline ? '・' + flightInfo.airline : '';
          const menuKey = dayNum + '_' + idx;
          const noteKey = item.uid || menuKey;

          // 卡片重點亮點（must_buy）與詳細介紹（notes）
          const highlightText = String(card.must_buy || card.meta?.must_buy || '').trim();
          const detailText = String(card.notes || card.description || '').trim();
          let spotInfoBlockHtml = '';

          if (highlightText || detailText) {
            const isLongNote = detailText.length > 90;
            const isExpanded = expandedNoteKeys.has(noteKey);
            const clampCls = isLongNote && !isExpanded ? 'line-clamp-3' : '';

            const highlightHtml = highlightText
              ? '<div class="flex items-start gap-1 text-[11px] font-bold text-amber-600 leading-snug">' +
                '<i class="fa-solid fa-star text-[10px] mt-0.5 shrink-0"></i>' +
                '<span>亮點推薦：' + escapeHtml(highlightText) + '</span>' +
                '</div>'
              : '';

            const detailHtml = detailText
              ? '<div class="text-xs text-slate-600 leading-relaxed whitespace-pre-line break-words ' + clampCls + '">' +
                escapeHtml(detailText) +
                '</div>' +
                (isLongNote
                  ? '<button type="button" onclick="toggleItineraryNoteExpand(event, \'' + escapeHtml(noteKey) + '\')" ' +
                    'class="text-[11px] font-bold text-[#2C4D6E] hover:underline inline-flex items-center gap-0.5 pt-0.5">' +
                    '<span>' + (isExpanded ? '收合介紹 ▲' : '展開全文 ▾') + '</span>' +
                    '</button>'
                  : '')
              : '';

            spotInfoBlockHtml =
              '<div class="mt-2 pt-2 border-t border-slate-100 space-y-1">' +
              highlightHtml +
              detailHtml +
              '</div>';
          }

          const extraActionBtn =
            card.category === '機場'
              ? '<button type="button" onclick="editItemFlightSchedule(' + dayNum + ', ' + idx + ')" ' +
                'class="mt-1.5 px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-[11px] font-bold inline-flex items-center gap-1">' +
                '<i class="fa-solid fa-plane-departure"></i>' +
                '<span>設定 Day ' + dayNum + ' 專屬航班時刻</span>' +
                '</button>'
              : card.category === '住宿' && dayNum < totalDays
              ? '<button type="button" onclick="extendHotelToNextDay(' + dayNum + ', ' + idx + ')" ' +
                'class="mt-1.5 px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-[11px] font-bold inline-flex items-center gap-1">' +
                '<i class="fa-solid fa-bed"></i>' +
                '<span>延續為 Day ' + (dayNum + 1) + ' 退房起點</span>' +
                '</button>'
              : '';

          return (
            legHtml +
            '<div draggable="true" ' +
            'data-day="' + dayNum + '" data-idx="' + idx + '" ' +
            'ondragstart="onDragStartItineraryItem(event, ' + dayNum + ', ' + idx + ')" ' +
            'ondragend="onDragEndItineraryItem(event)" ' +
            'ondragover="onDragOverItineraryItem(event, ' + dayNum + ', ' + idx + ')" ' +
            'ondragleave="onDragLeaveItineraryItem(event)" ' +
            'ondrop="onDropOnItineraryItem(event, ' + dayNum + ', ' + idx + ')" ' +
            'class="itinerary-item-card bg-white rounded-xl border border-slate-200 p-3 shadow-2xs hover:border-slate-400 transition select-none space-y-1.5 cursor-grab active:cursor-grabbing">' +
            '<div class="flex items-start justify-between gap-1.5">' +
            '<div class="flex items-center gap-1.5 flex-wrap min-w-0">' +
            '<div class="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-bold text-[11px] leading-tight shrink-0">' +
            '<div>' + timeLineTop + '</div>' +
            '<div class="text-[10px] text-slate-500">' + timeLineBottom + '</div>' +
            '</div>' +
            roleBadge +
            '<span class="px-2 py-0.5 rounded-md text-[11px] font-bold ' + style.badge + ' shrink-0">' + card.category + '</span>' +
            '</div>' +
            '<div class="relative shrink-0">' +
            '<button type="button" onclick="toggleCardActionMenu(event, \'' + menuKey + '\')" title="更多操作" ' +
            'class="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 flex items-center justify-center text-sm transition">' +
            '<i class="fa-solid fa-ellipsis-vertical"></i>' +
            '</button>' +
            '<div id="card-menu-' + menuKey + '" onclick="event.stopPropagation()" ' +
            'class="itinerary-card-menu hidden absolute right-0 top-8 w-36 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-30 text-xs font-semibold text-slate-700">' +
            '<button type="button" onclick="closeAllCardActionMenus(); focusCardOnMap(\'' + card.id + '\')" ' +
            'class="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2">' +
            '<i class="fa-solid fa-diamond-turn-right w-3.5 text-center" style="color:' + dayColor + '"></i>' +
            '<span>在地圖定位</span>' +
            '</button>' +
            '<button type="button" onclick="closeAllCardActionMenus(); openCardModal(\'' + card.id + '\')" ' +
            'class="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2">' +
            '<i class="fa-solid fa-pen w-3.5 text-center text-slate-500"></i>' +
            '<span>編輯卡片</span>' +
            '</button>' +
            '<div class="my-0.5 border-t border-slate-100"></div>' +
            '<button type="button" onclick="closeAllCardActionMenus(); removeItineraryItem(' + dayNum + ', ' + idx + ')" ' +
            'class="w-full px-3 py-2 text-left hover:bg-rose-50 text-rose-600 flex items-center gap-2">' +
            '<i class="fa-solid fa-trash-can w-3.5 text-center"></i>' +
            '<span>移出此日行程</span>' +
            '</button>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '<div class="flex items-start gap-2 pt-0.5">' +
            '<span style="background:' + dayColor + '" class="w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">' +
            (idx + 1) +
            '</span>' +
            '<div class="min-w-0 flex-1">' +
            '<h4 class="font-bold text-sm text-slate-800 leading-snug break-words">' + escapeHtml(card.title) + '</h4>' +
            '<p class="text-[11px] text-slate-500 mt-0.5">' +
            (card.district ? escapeHtml(card.district) + '・' : '') + '停留 ' + stayMin + ' 分' + escapeHtml(airlineTag) +
            '</p>' +
            spotInfoBlockHtml +
            extraActionBtn +
            '</div>' +
            '</div>' +
            '</div>'
          );
        })
        .join('');

      const endDayStr = dayData.items.length > 0 ? formatMinutes(cursorMin) : dayData.startTime;
      const selectOpts = timeOptions
        .map(t => '<option value="' + t + '" ' + (t === (dayData.startTime || '09:00') ? 'selected' : '') + '>' + t + '</option>')
        .join('');

      const colWidthCls = state.boardMultiDayMode ? 'w-80 shrink-0' : 'w-full';
      const emptyPlaceholder =
        '<div class="h-44 flex flex-col items-center justify-center text-center text-slate-400 text-xs p-4 border-2 border-dashed border-slate-200 rounded-xl">' +
        '<i class="fa-regular fa-calendar-plus text-2xl mb-2 text-slate-300"></i>' +
        '<p class="font-semibold text-slate-500">尚未排入任何景點</p>' +
        '<p class="text-[11px] mt-1">請切換至「口袋清單」點擊「＋排入」加入行程</p>' +
        '</div>';

      return (
        '<div ondragover="onDragOverColumn(event)" ondragleave="onDragLeaveColumn(event)" ondrop="onDropOnDay(event, ' + dayNum + ')" ' +
        'style="border-top: 4px solid ' + dayColor + ';" ' +
        'class="' + colWidthCls + ' bg-white rounded-2xl border border-slate-200 shadow-2xs flex flex-col overflow-hidden">' +
        '<div class="p-3 border-b border-slate-100 bg-slate-50/60 space-y-1.5 shrink-0">' +
        '<div class="flex items-center justify-between gap-2 flex-wrap">' +
        '<div class="flex items-center gap-2">' +
        '<span class="text-base font-extrabold" style="color:' + dayColor + '">Day ' + dayNum + '</span>' +
        '<span class="text-xs font-semibold text-slate-500">' + info.md + ' (' + info.week + ')</span>' +
        '<label title="點擊自訂 Day ' + dayNum + ' 路線與看板顏色" ' +
        'class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white hover:bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-600 cursor-pointer relative overflow-hidden shadow-2xs transition">' +
        '<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:' + dayColor + '"></span>' +
        '<i class="fa-solid fa-palette text-[10px] text-slate-500"></i>' +
        '<span>路線色</span>' +
        '<input type="color" value="' + dayColor + '" onchange="updateDayColor(' + dayNum + ', this.value)" class="opacity-0 absolute inset-0 w-full h-full cursor-pointer" />' +
        '</label>' +
        '</div>' +
        '<div class="flex items-center gap-1.5 shrink-0">' +
        '<div class="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs">' +
        '<span class="text-slate-500 font-medium shrink-0">出發</span>' +
        '<select onchange="updateDayStartTime(' + dayNum + ', this.value)" class="font-bold text-slate-800 bg-transparent focus:outline-none cursor-pointer min-w-[54px]">' +
        selectOpts +
        '</select>' +
        '</div>' +
        '<button type="button" onclick="addReturnToHotel(' + dayNum + ')" class="px-2 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-700 shrink-0">' +
        '↩ 回住宿' +
        '</button>' +
        '</div>' +
        '</div>' +
        '<div class="flex items-center justify-between text-[11px] text-slate-500">' +
        '<span>共 ' + dayData.items.length + ' 個行程點</span>' +
        '<span class="font-bold" style="color:' + dayColor + '">移動 ' + totalTransitMin + ' 分・約 ' + endDayStr + ' 結束</span>' +
        '</div>' +
        '</div>' +
        '<div class="day-items-scroll-area flex-1 overflow-y-auto p-2.5 space-y-1 bg-slate-50/30">' +
        (itemsHtml || emptyPlaceholder) +
        '</div>' +
        '</div>'
      );
    })
    .join('');
}

export function addCardToDay(cardId, dayNum, insertIdx = null) {
  const d = Number(dayNum);
  if (!state.itinerary[d]) state.itinerary[d] = { startTime: '09:00', items: [] };
  const newItem = {
    uid: 'it_' + cardId + '_' + d + '_' + Date.now(),
    cardId,
    order: state.itinerary[d].items.length + 1,
    isCheckout: false,
    transitMode: 'auto',
    customTransitMin: null,
    customNote: ''
  };
  if (insertIdx !== null && insertIdx >= 0 && insertIdx <= state.itinerary[d].items.length) {
    state.itinerary[d].items.splice(insertIdx, 0, newItem);
  } else {
    state.itinerary[d].items.push(newItem);
  }
  persistState(true);
  if (typeof hooks.renderAll === 'function') hooks.renderAll();
  showToast('已排入 Day ' + d, 'emerald');
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

export function cycleTransitMode(dayNum, idx) {
  const item = state.itinerary[dayNum]?.items?.[idx];
  if (!item) return;
  const order = ['auto', 'transit', 'drive', 'walk'];
  const labels = { auto: '智慧自動', transit: '單軌/大眾運輸', drive: '自駕/計程車', walk: '步行' };
  const next = order[(order.indexOf(item.transitMode || 'auto') + 1) % order.length];
  item.transitMode = next;
  persistState(true);
  renderKanbanBoard();
  if (typeof hooks.renderMapMarkers === 'function') hooks.renderMapMarkers();
  showToast('此段交通切換為：' + labels[next], 'blue');
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
  if (typeof hooks.renderMapMarkers === 'function') hooks.renderMapMarkers();
}

export function editItemFlightSchedule(dayNum, idx) {
  const item = state.itinerary[dayNum]?.items?.[idx];
  if (!item) return;
  const current = parseFlightNote(item.customNote) || { depTime: '15:00', arrTime: '17:00', airline: '星宇航空' };
  const input = prompt(
    '請輸入航班時刻與航空公司（格式：報到或起飛時間/起飛或抵達時間|航空公司，例如 15:00/17:00|星宇 或 /19:00|星宇）：',
    current.depTime + '/' + current.arrTime + '|' + current.airline
  );
  if (input === null) return;
  const trimmed = input.trim();
  item.customNote = trimmed ? 'flight|' + trimmed : '';
  persistState(true);
  renderKanbanBoard();
  showToast('已更新航班專屬時刻', 'emerald');
}

export function extendHotelToNextDay(dayNum, idx) {
  const item = state.itinerary[dayNum]?.items?.[idx];
  const nextDay = Number(dayNum) + 1;
  if (!item || !state.itinerary[nextDay]) return;
  state.itinerary[nextDay].items.unshift({
    uid: 'it_' + item.cardId + '_' + nextDay + '_' + Date.now(),
    cardId: item.cardId,
    order: 1,
    isCheckout: true,
    transitMode: 'auto',
    customTransitMin: null,
    customNote: ''
  });
  persistState(true);
  if (typeof hooks.renderAll === 'function') hooks.renderAll();
  showToast('已將住宿設為 Day ' + nextDay + ' 退房起點', 'emerald');
}

export function addReturnToHotel(dayNum) {
  const hotelCard = state.cards.find(c => c.category === '住宿');
  if (!hotelCard) {
    showToast('口袋清單中尚無「住宿」類別卡片', 'amber');
    return;
  }
  addCardToDay(hotelCard.id, dayNum);
}

// ==================== 電腦版拖曳精準插入排序 ====================
let dragPayload = null;

export function onDragStartCard(event, cardId) {
  dragPayload = { type: 'card', cardId };
  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData('text/plain', String(cardId));
  }
}

export function onDragStartItineraryItem(event, fromDay, fromIdx) {
  closeAllCardActionMenus();
  dragPayload = { type: 'item', fromDay: Number(fromDay), fromIdx: Number(fromIdx) };
  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', fromDay + ':' + fromIdx);
  }
  if (event?.currentTarget) {
    setTimeout(() => event.currentTarget?.classList.add('opacity-50'), 0);
  }
}

export function onDragEndItineraryItem() {
  dragPayload = null;
  clearAllDropIndicators();
}

export function onDragOverItineraryItem(event, targetDay, targetIdx) {
  event.preventDefault();
  event.stopPropagation();
  if (!dragPayload) return;

  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  const isTopHalf = event.clientY < rect.top + rect.height / 2;
  const dayColor = getDayColor(targetDay);

  clearAllDropIndicators();
  if (isTopHalf) {
    el.style.borderTop = '3px solid ' + dayColor;
    el.dataset.dropPos = 'top';
  } else {
    el.style.borderBottom = '3px solid ' + dayColor;
    el.dataset.dropPos = 'bottom';
  }
}

export function onDragLeaveItineraryItem(event) {
  const el = event.currentTarget;
  if (!el.contains(event.relatedTarget)) {
    el.style.borderTop = '';
    el.style.borderBottom = '';
  }
}

export function onDropOnItineraryItem(event, targetDay, targetIdx) {
  event.preventDefault();
  event.stopPropagation();
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  const isTopHalf = event.clientY < rect.top + rect.height / 2;
  const rawInsertIdx = isTopHalf ? Number(targetIdx) : Number(targetIdx) + 1;

  clearAllDropIndicators();
  if (!dragPayload) return;

  const dTarget = Number(targetDay);
  if (dragPayload.type === 'card') {
    addCardToDay(dragPayload.cardId, dTarget, rawInsertIdx);
  } else if (dragPayload.type === 'item') {
    const { fromDay, fromIdx } = dragPayload;
    const srcList = state.itinerary[fromDay]?.items;
    if (srcList && srcList[fromIdx]) {
      const [moved] = srcList.splice(fromIdx, 1);
      if (!state.itinerary[dTarget]) state.itinerary[dTarget] = { startTime: '09:00', items: [] };
      const finalIdx = fromDay === dTarget && rawInsertIdx > fromIdx ? rawInsertIdx - 1 : rawInsertIdx;
      state.itinerary[dTarget].items.splice(Math.max(0, finalIdx), 0, moved);
      persistState(true);
      if (typeof hooks.renderAll === 'function') hooks.renderAll();
      showToast('已更新行程順序', 'emerald');
    }
  }
  dragPayload = null;
}

export function onDragOverColumn(event) {
  event.preventDefault();
}

export function onDragLeaveColumn() {}

export function onDropOnDay(event, targetDay) {
  event.preventDefault();
  clearAllDropIndicators();
  if (!dragPayload) return;

  const dTarget = Number(targetDay);
  if (dragPayload.type === 'card') {
    addCardToDay(dragPayload.cardId, dTarget);
  } else if (dragPayload.type === 'item') {
    const { fromDay, fromIdx } = dragPayload;
    const srcList = state.itinerary[fromDay]?.items;
    if (srcList && srcList[fromIdx]) {
      const [moved] = srcList.splice(fromIdx, 1);
      if (!state.itinerary[dTarget]) state.itinerary[dTarget] = { startTime: '09:00', items: [] };
      state.itinerary[dTarget].items.push(moved);
      persistState(true);
      if (typeof hooks.renderAll === 'function') hooks.renderAll();
    }
  }
  dragPayload = null;
}

window.onDragEndItineraryItem = onDragEndItineraryItem;
window.onDragOverItineraryItem = onDragOverItineraryItem;
window.onDragLeaveItineraryItem = onDragLeaveItineraryItem;
window.onDropOnItineraryItem = onDropOnItineraryItem;
