import {
  state,
  hooks,
  createTripObject,
  getActiveTrip,
  syncActiveTripToLegacyState,
  loadLocalState,
  persistState,
  ensureItineraryDays,
  showToast
} from './state.js';
import {
  pullFromGoogleSheets,
  pushAllToGoogleSheets,
  copyGasBackendCode,
  exportJsonBackup
} from './api.js';
import * as cardsMod from './ui-cards.js';
import * as boardMod from './ui-board.js';
import * as mapMod from './map.js';

hooks.pushAllToGoogleSheets = pushAllToGoogleSheets;
hooks.renderAll = renderAll;
hooks.renderDatabaseCards = cardsMod.renderDatabaseCards;
hooks.renderKanbanBoard = boardMod.renderKanbanBoard;
hooks.renderMapMarkers = () => {
  if (typeof mapMod.renderMapMarkers === 'function') {
    mapMod.renderMapMarkers(cardsMod.getFilteredAndSortedCards);
  }
};
hooks.renderMapCategoryToggles = mapMod.renderMapCategoryToggles;
hooks.populateRegionDropdowns = cardsMod.populateRegionDropdowns;
hooks.focusCardOnMap = (cardId, warnIfMissing = true) => {
  if (isMobileViewport()) {
    switchMobileTab('map');
  }
  if (typeof mapMod.focusCardOnMap === 'function') {
    mapMod.focusCardOnMap(cardId, warnIfMissing);
  }
};
hooks.openCardModal = cardsMod.openCardModal;
hooks.addCardToDay = boardMod.addCardToDay;
hooks.invalidateMapSize = mapMod.invalidateMapSize;

function isMobileViewport() {
  return window.innerWidth <= 768;
}

let currentMobileTab = 'trips';

function syncTripStepAttributes() {
  document.body.setAttribute('data-trip-step', state.tripViewStep);
}

// ==================== 多旅程專案總覽牆（建立 / 切換 / 刪除） ====================
function renderTripProjectsGrid() {
  const grid = document.getElementById('tripProjectsGrid');
  if (!grid) return;

  const badgeTrips = document.getElementById('badgeTripsCount');
  const mobileBadgeTrips = document.getElementById('mobileBadgeTrips');
  if (badgeTrips) badgeTrips.textContent = String(state.trips.length);
  if (mobileBadgeTrips) mobileBadgeTrips.textContent = String(state.trips.length);

  grid.innerHTML = state.trips
    .map(trip => {
      const isCurrent = trip.id === state.activeTripId;
      const totalDays = Number(trip.totalDays) || 5;
      const start = new Date(`${trip.startDate}T00:00:00`);
      let dateRangeText = trip.startDate || '';
      if (!isNaN(start.getTime())) {
        const end = new Date(start.getTime() + (totalDays - 1) * 86400000);
        const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
        dateRangeText = `${trip.startDate} ~ ${endStr}`;
      }

      const scheduledCount = Object.values(trip.itinerary || {}).reduce(
        (acc, dayObj) => acc + (dayObj.items ? dayObj.items.length : 0),
        0
      );

      return `
        <div onclick="selectAndOpenTrip('${trip.id}')"
          class="bg-white rounded-2xl border ${isCurrent ? 'border-[#2C4D6E] ring-2 ring-[#2C4D6E]/15' : 'border-slate-200'} p-4 shadow-2xs hover:shadow-md transition cursor-pointer flex flex-col justify-between gap-3">
          <div class="space-y-2">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="w-8 h-8 rounded-xl bg-[#2C4D6E]/10 text-[#2C4D6E] flex items-center justify-center shrink-0">
                  <i class="fa-solid fa-suitcase-rolling"></i>
                </span>
                <div>
                  <span class="text-[11px] font-bold text-[#2C4D6E]">${trip.destination || '自由行專案'}</span>
                  <h3 class="font-bold text-base text-slate-800 leading-snug">${trip.title}</h3>
                </div>
              </div>
              ${isCurrent ? '<span class="px-2 py-0.5 rounded-full bg-[#2C4D6E] text-white text-[10px] font-bold shrink-0">使用中</span>' : ''}
            </div>

            <div class="text-xs text-slate-500 space-y-1 pt-1">
              <div class="flex items-center gap-1.5">
                <i class="fa-regular fa-calendar text-slate-400"></i>
                <span>${dateRangeText}（${totalDays}天${Math.max(0, totalDays - 1)}夜）</span>
              </div>
              <div class="flex items-center gap-1.5">
                <i class="fa-solid fa-map-pin text-slate-400"></i>
                <span>已排入 <strong>${scheduledCount}</strong> 個行程點</span>
              </div>
            </div>
          </div>

          <div class="pt-2.5 border-t border-slate-100 flex items-center justify-between" onclick="event.stopPropagation()">
            <button type="button" onclick="selectAndOpenTrip('${trip.id}')"
              class="px-3 py-1.5 rounded-lg bg-[#2C4D6E] hover:bg-[#233E59] text-white text-xs font-bold flex items-center gap-1">
              <span>進入排程</span>
              <i class="fa-solid fa-arrow-right text-[10px]"></i>
            </button>

            <div class="flex items-center gap-1">
              <button type="button" onclick="openCreateTripModal('${trip.id}')" title="編輯旅程資訊"
                class="w-7 h-7 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 flex items-center justify-center text-xs">
                <i class="fa-solid fa-pen"></i>
              </button>
              ${
                state.trips.length > 1
                  ? `<button type="button" onclick="deleteTripProject('${trip.id}')" title="刪除旅程"
                      class="w-7 h-7 rounded-lg border border-slate-200 text-rose-500 hover:bg-rose-50 flex items-center justify-center text-xs">
                      <i class="fa-solid fa-trash-can"></i>
                    </button>`
                  : ''
              }
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

function openTripListOverview() {
  state.tripViewStep = 'list';
  syncTripStepAttributes();
  if (isMobileViewport()) {
    switchMobileTab('trips');
  } else {
    switchWorkspaceMode('plan');
  }
}

function selectAndOpenTrip(tripId) {
  state.activeTripId = tripId;
  syncActiveTripToLegacyState();
  state.tripViewStep = 'detail';
  syncTripStepAttributes();
  persistState(false);
  updateHeaderInfo();

  if (isMobileViewport()) {
    switchMobileTab('trips');
  } else {
    switchWorkspaceMode('plan');
  }
}

function openCreateTripModal(editId = null) {
  const modal = document.getElementById('createTripModal');
  if (!modal) return;
  if (editId) {
    const trip = state.trips.find(t => t.id === editId);
    if (!trip) return;
    document.getElementById('createTripModalTitle').innerHTML =
      '<i class="fa-solid fa-pen text-[#2C4D6E] mr-1.5"></i>編輯旅程資訊';
    document.getElementById('editTripId').value = trip.id;
    document.getElementById('newTripTitle').value = trip.title;
    document.getElementById('newTripDestination').value = trip.destination || '';
    document.getElementById('newTripStartDate').value = trip.startDate;
    document.getElementById('newTripTotalDays').value = trip.totalDays;
  } else {
    document.getElementById('createTripModalTitle').innerHTML =
      '<i class="fa-solid fa-plane-departure text-[#2C4D6E] mr-1.5"></i>建立新行程專案';
    document.getElementById('editTripId').value = '';
    document.getElementById('newTripTitle').value = '';
    document.getElementById('newTripDestination').value = '';
    document.getElementById('newTripStartDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('newTripTotalDays').value = 4;
  }
  modal.classList.remove('hidden');
}

function closeCreateTripModal() {
  document.getElementById('createTripModal')?.classList.add('hidden');
}

function saveTripProject() {
  const title = document.getElementById('newTripTitle').value.trim();
  if (!title) {
    showToast('請輸入行程名稱', 'amber');
    return;
  }
  const destination = document.getElementById('newTripDestination').value.trim();
  const startDate = document.getElementById('newTripStartDate').value || new Date().toISOString().slice(0, 10);
  const totalDays = Math.max(1, Math.min(15, parseInt(document.getElementById('newTripTotalDays').value, 10) || 4));
  const editId = document.getElementById('editTripId').value;

  if (editId) {
    const trip = state.trips.find(t => t.id === editId);
    if (trip) {
      trip.title = title;
      trip.destination = destination;
      trip.startDate = startDate;
      trip.totalDays = totalDays;
      for (let d = 1; d <= totalDays; d++) {
        if (!trip.itinerary[d]) trip.itinerary[d] = { startTime: '09:00', items: [] };
      }
      if (state.activeTripId === trip.id) syncActiveTripToLegacyState();
    }
    closeCreateTripModal();
    persistState(true);
    updateHeaderInfo();
    renderAll();
    showToast('已更新旅程資訊', 'emerald');
  } else {
    const created = createTripObject({ title, destination, startDate, totalDays });
    state.trips.unshift(created);
    closeCreateTripModal();
    persistState(true);
    selectAndOpenTrip(created.id);
    showToast(`已建立「${title}」`, 'emerald');
  }
}

function deleteTripProject(tripId) {
  if (state.trips.length <= 1) return;
  if (!confirm('確定要刪除此旅程專案嗎？（口袋清單中的景點仍會保留）')) return;
  state.trips = state.trips.filter(t => t.id !== tripId);
  if (state.activeTripId === tripId) {
    state.activeTripId = state.trips[0].id;
    syncActiveTripToLegacyState();
  }
  persistState(true);
  updateHeaderInfo();
  renderAll();
  showToast('已刪除旅程專案', 'slate');
}

// ==================== 手機端三頁籤切換 ====================
function switchMobileTab(tabName) {
  currentMobileTab = tabName;
  document.body.setAttribute('data-mobile-tab', tabName);
  syncTripStepAttributes();

  document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
    const active = btn.dataset.mobileTab === tabName;
    btn.className = active
      ? 'mobile-tab-btn flex flex-col items-center justify-center gap-0.5 text-[#2C4D6E] font-bold text-[11px] relative bg-slate-100/70'
      : 'mobile-tab-btn flex flex-col items-center justify-center gap-0.5 text-slate-500 font-semibold text-[11px] relative';
  });

  if (tabName === 'trips') {
    state.mode = 'plan';
    state.boardMultiDayMode = false;
    if (state.tripViewStep === 'list') {
      renderTripProjectsGrid();
    } else {
      boardMod.renderKanbanBoard();
    }
  } else if (tabName === 'map') {
    state.mode = 'plan';
    const mapHeaderCollect = document.getElementById('mapHeaderCollectMode');
    const mapHeaderPlan = document.getElementById('mapHeaderPlanMode');
    if (mapHeaderCollect) mapHeaderCollect.classList.add('hidden');
    if (mapHeaderPlan) mapHeaderPlan.classList.remove('hidden');
    state.overlayPocketOnPlan = true;
    updateOverlayPocketButtonUi();
    populateMapDaySelector();
    syncMapDrawerUi();
    hooks.renderMapMarkers();
    setTimeout(() => mapMod.invalidateMapSize(), 80);
  } else if (tabName === 'pocket') {
    state.mode = 'collect';
    cardsMod.renderDatabaseCards();
  }
}

function syncMobileNavBadges() {
  const pocketBadge = document.getElementById('mobileBadgePocket');
  const tripsBadge = document.getElementById('mobileBadgeTrips');
  if (pocketBadge) pocketBadge.textContent = String(state.cards.length);
  if (tripsBadge) tripsBadge.textContent = String(state.trips.length);
}

// ==================== 電腦版拖曳分隔桿 ====================
function initSplitResizers() {
  const mainEl = document.getElementById('workspaceMain');
  const dbPanel = document.getElementById('databasePanel');
  const boardPanel = document.getElementById('itineraryBoardSection');
  const resizerLeft = document.getElementById('resizerLeft');
  const resizerRight = document.getElementById('resizerRight');
  if (!mainEl || !resizerLeft || !resizerRight) return;

  let activeResizer = null;

  resizerLeft.addEventListener('mousedown', e => {
    e.preventDefault();
    activeResizer = 'left';
    resizerLeft.classList.add('is-dragging');
    document.body.style.cursor = 'col-resize';
  });

  resizerRight.addEventListener('mousedown', e => {
    e.preventDefault();
    activeResizer = 'right';
    resizerRight.classList.add('is-dragging');
    document.body.style.cursor = 'col-resize';
  });

  window.addEventListener('mousemove', e => {
    if (!activeResizer || isMobileViewport()) return;
    const rect = mainEl.getBoundingClientRect();
    const totalW = rect.width;
    if (totalW <= 0) return;

    if (activeResizer === 'left') {
      const rawPx = e.clientX - rect.left;
      const clampedPx = Math.max(220, Math.min(totalW - 280, rawPx));
      dbPanel.style.width = `${(clampedPx / totalW) * 100}%`;
    } else if (activeResizer === 'right') {
      const dbW = state.pocketCollapsed ? 0 : dbPanel.getBoundingClientRect().width;
      const rawBoardPx = e.clientX - rect.left - dbW;
      const maxBoardPx = totalW - dbW - 260;
      const clampedBoardPx = Math.max(280, Math.min(maxBoardPx, rawBoardPx));
      boardPanel.style.width = `${(clampedBoardPx / totalW) * 100}%`;
    }
    mapMod.invalidateMapSize();
  });

  window.addEventListener('mouseup', () => {
    if (!activeResizer) return;
    activeResizer = null;
    resizerLeft.classList.remove('is-dragging');
    resizerRight.classList.remove('is-dragging');
    document.body.style.cursor = '';
    mapMod.invalidateMapSize();
  });

  window.addEventListener('resize', () => {
    if (!isMobileViewport()) {
      document.body.removeAttribute('data-mobile-tab');
      switchWorkspaceMode(state.mode);
    } else if (!document.body.getAttribute('data-mobile-tab')) {
      switchMobileTab(currentMobileTab);
    }
    mapMod.invalidateMapSize();
  });
}

function updateOverlayPocketButtonUi() {
  const btn = document.getElementById('btnOverlayPocket');
  const txt = document.getElementById('overlayPocketStatusText');
  if (!btn || !txt) return;
  if (state.overlayPocketOnPlan) {
    btn.className = 'px-2 py-1 rounded-lg border border-[#2C4D6E] bg-[#2C4D6E] text-white text-[11px] font-bold flex items-center gap-1 transition';
    txt.textContent = '疊加中';
  } else {
    btn.className = 'px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-blue-50 text-slate-700 text-[11px] font-semibold flex items-center gap-1 transition';
    txt.textContent = '疊加口袋';
  }
}

function syncMapDrawerUi() {
  const drawer = document.getElementById('mapCollapsibleDrawer');
  const planLegsSec = document.getElementById('planRouteLegsDrawerSection');
  const chevron = document.getElementById('mapDrawerChevron');
  if (!drawer || !planLegsSec) return;
  const isOpen = state.mode === 'collect' ? state.mapDrawerOpenCollect : state.mapDrawerOpenPlan;

  if (isOpen) {
    drawer.classList.remove('hidden');
    if (chevron) chevron.className = 'fa-solid fa-chevron-up text-[9px]';
  } else {
    drawer.classList.add('hidden');
    if (chevron) chevron.className = 'fa-solid fa-chevron-down text-[9px]';
  }

  if (state.mode === 'plan') {
    planLegsSec.classList.remove('hidden');
  } else {
    planLegsSec.classList.add('hidden');
  }
}

function toggleMapDrawer() {
  if (state.mode === 'collect') {
    state.mapDrawerOpenCollect = !state.mapDrawerOpenCollect;
  } else {
    state.mapDrawerOpenPlan = !state.mapDrawerOpenPlan;
  }
  syncMapDrawerUi();
  setTimeout(() => mapMod.invalidateMapSize(), 80);
}

// ==================== 電腦端工作區模式切換（我的行程 / 口袋清單） ====================
function switchWorkspaceMode(targetMode) {
  state.mode = targetMode;
  syncTripStepAttributes();

  const tabCollect = document.getElementById('tabModeCollect');
  const tabPlan = document.getElementById('tabModePlan');
  const tripsSection = document.getElementById('tripProjectsSection');
  const dbPanel = document.getElementById('databasePanel');
  const resizerLeft = document.getElementById('resizerLeft');
  const boardSection = document.getElementById('itineraryBoardSection');
  const resizerRight = document.getElementById('resizerRight');
  const mapPanel = document.getElementById('mapPanel');
  const dbCardsGrid = document.getElementById('databaseCardsContainer');

  const dbTitle = document.getElementById('dbPanelTitleText');
  const btnAddCollect = document.getElementById('btnAddCardCollect');
  const btnMini = document.getElementById('btnMiniCardToggle');
  const btnCollapse = document.getElementById('btnCollapsePocket');
  const btnExpand = document.getElementById('btnExpandPocket');
  const sortWrap = document.getElementById('sortSelectWrapper');
  const advFilter = document.getElementById('advancedFilterGroup');
  const planQuickFilter = document.getElementById('planQuickFilterBar');

  const mapHeaderCollect = document.getElementById('mapHeaderCollectMode');
  const mapHeaderPlan = document.getElementById('mapHeaderPlanMode');

  if (targetMode === 'collect') {
    tabCollect.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all bg-[#2C4D6E] text-white shadow-xs';
    tabPlan.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all text-slate-600 hover:text-slate-900';

    tripsSection.classList.add('hidden');
    dbPanel.classList.remove('hidden');
    dbPanel.classList.add('flex');
    dbPanel.style.width = '62%';
    resizerLeft.classList.remove('hidden');
    boardSection.classList.add('hidden');
    boardSection.classList.remove('flex');
    resizerRight.classList.add('hidden');
    btnExpand.classList.add('hidden');
    mapPanel.classList.remove('hidden');
    mapPanel.classList.add('flex');

    dbTitle.textContent = '全球口袋資料庫';
    if (btnAddCollect) btnAddCollect.classList.remove('hidden');
    if (btnMini) btnMini.classList.remove('hidden');
    btnCollapse.classList.add('hidden');
    btnCollapse.classList.remove('flex');
    sortWrap.classList.remove('hidden');
    advFilter.classList.remove('hidden');
    planQuickFilter.classList.add('hidden');
    planQuickFilter.classList.remove('flex');

    dbCardsGrid.className = 'flex-1 min-h-0 overflow-y-auto p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-stretch content-start bg-slate-50/40';
    mapHeaderCollect.classList.remove('hidden');
    mapHeaderPlan.classList.add('hidden');
    cardsMod.updateMiniCardButtonUi();
  } else {
    tabPlan.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all bg-[#2C4D6E] text-white shadow-xs';
    tabCollect.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all text-slate-600 hover:text-slate-900';

    if (state.tripViewStep === 'list') {
      tripsSection.classList.remove('hidden');
      dbPanel.classList.add('hidden');
      dbPanel.classList.remove('flex');
      resizerLeft.classList.add('hidden');
      boardSection.classList.add('hidden');
      boardSection.classList.remove('flex');
      resizerRight.classList.add('hidden');
      mapPanel.classList.add('hidden');
      mapPanel.classList.remove('flex');
      btnExpand.classList.add('hidden');
    } else {
      tripsSection.classList.add('hidden');
      dbTitle.textContent = '口袋待排清單';
      if (btnAddCollect) btnAddCollect.classList.add('hidden');
      if (btnMini) btnMini.classList.add('hidden');
      btnCollapse.classList.remove('hidden');
      btnCollapse.classList.add('flex');
      sortWrap.classList.add('hidden');
      advFilter.classList.add('hidden');
      planQuickFilter.classList.remove('hidden');
      planQuickFilter.classList.add('flex');

      dbCardsGrid.className = 'flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1.5 bg-slate-50/60';
      boardSection.classList.remove('hidden');
      boardSection.classList.add('flex');
      resizerRight.classList.remove('hidden');
      mapPanel.classList.remove('hidden');
      mapPanel.classList.add('flex');
      mapHeaderCollect.classList.add('hidden');
      mapHeaderPlan.classList.remove('hidden');

      if (state.pocketCollapsed) {
        dbPanel.classList.add('hidden');
        dbPanel.classList.remove('flex');
        resizerLeft.classList.add('hidden');
        btnExpand.classList.remove('hidden');
        btnExpand.classList.add('flex');
        boardSection.style.width = '48%';
      } else {
        dbPanel.classList.remove('hidden');
        dbPanel.classList.add('flex');
        dbPanel.style.width = '20%';
        resizerLeft.classList.remove('hidden');
        btnExpand.classList.add('hidden');
        boardSection.style.width = '36%';
      }

      state.overlayPocketOnPlan = true;
      updateOverlayPocketButtonUi();
      populateMapDaySelector();
    }
  }

  syncMapDrawerUi();
  renderAll();
  setTimeout(() => mapMod.invalidateMapSize(), 120);
}

function togglePocketCollapse() {
  state.pocketCollapsed = !state.pocketCollapsed;
  switchWorkspaceMode('plan');
}

function populateMapDaySelector() {
  const sel = document.getElementById('mapDaySelect');
  if (!sel) return;
  const total = Number(state.settings.totalDays) || 6;
  const options = [];
  for (let d = 1; d <= total; d++) {
    const info = boardMod.getFormattedDateInfo(d);
    options.push(`<option value="${d}" ${(!state.mapOverviewAllDays && d === state.selectedMapDay) ? 'selected' : ''}>Day ${d} (${info.md} ${info.week})</option>`);
  }
  options.push(`<option value="all" ${state.mapOverviewAllDays ? 'selected' : ''}>🗺️ 全部已排行程 (多日分色)</option>`);
  sel.innerHTML = options.join('');
}

function updateHeaderInfo() {
  const active = getActiveTrip();
  document.getElementById('tripTitleDisplay').textContent = active.title || 'e-chi Go';
  const total = Number(active.totalDays) || 6;
  const start = new Date(`${active.startDate}T00:00:00`);
  if (!isNaN(start.getTime())) {
    const end = new Date(start.getTime() + (total - 1) * 86400000);
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    document.getElementById('tripDateDisplay').textContent = `${active.startDate} ~ ${endStr} (${total}天${Math.max(0, total - 1)}夜)`;
  }
}

function openSettingsModal() {
  document.getElementById('setTripTitle').value = state.settings.tripTitle || '';
  document.getElementById('setStartDate').value = state.settings.startDate || '2027-02-17';
  document.getElementById('setTotalDays').value = state.settings.totalDays || 6;
  document.getElementById('setGasUrl').value = state.settings.gasUrl || '';
  document.getElementById('settingsModal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
}

function saveSettings() {
  state.settings.tripTitle = document.getElementById('setTripTitle').value.trim() || 'e-chi Go';
  state.settings.startDate = document.getElementById('setStartDate').value || '2027-02-17';
  state.settings.totalDays = Math.max(1, Math.min(15, parseInt(document.getElementById('setTotalDays').value, 10) || 6));
  state.settings.gasUrl = document.getElementById('setGasUrl').value.trim();

  ensureItineraryDays();
  persistState(false);
  updateHeaderInfo();
  populateMapDaySelector();
  closeSettingsModal();
  if (state.settings.gasUrl) {
    pullFromGoogleSheets(true);
  } else {
    renderAll();
    showToast('已套用設定', 'emerald');
  }
}

export function renderAll() {
  renderTripProjectsGrid();
  cardsMod.renderDatabaseCards();
  syncMobileNavBadges();
  if (state.mode === 'plan' && state.tripViewStep === 'detail') {
    populateMapDaySelector();
    boardMod.renderKanbanBoard();
  }
  hooks.renderMapMarkers();
}

// 立即將所有按鈕事件掛載至 window
Object.assign(window, {
  openTripListOverview,
  selectAndOpenTrip,
  openCreateTripModal,
  closeCreateTripModal,
  saveTripProject,
  deleteTripProject,
  switchWorkspaceMode,
  switchMobileTab,
  togglePocketCollapse,
  toggleMiniCardMode: cardsMod.toggleMiniCardMode,
  toggleBatchImportBox: cardsMod.toggleBatchImportBox,
  setPlanQuickFilter: cardsMod.setPlanQuickFilter,
  togglePlanProximitySort: cardsMod.togglePlanProximitySort,
  setFilter: cardsMod.setFilter,
  clearSearch: cardsMod.clearSearch,
  toggleCardDetailExpand: cardsMod.toggleCardDetailExpand,
  renderDatabaseCards: cardsMod.renderDatabaseCards,
  handleCardClick: cardsMod.handleCardClick,
  onCountryFilterChange: cardsMod.onCountryFilterChange,
  handleBatchImport: cardsMod.handleBatchImport,
  batchUpdateAllDistricts: cardsMod.batchUpdateAllDistricts,
  handleLatLngPaste: cardsMod.handleLatLngPaste,
  extractCoordsFromMapUrlField: cardsMod.extractCoordsFromMapUrlField,
  reverseGeocodeModalCoords: cardsMod.reverseGeocodeModalCoords,
  onModalCategoryChange: cardsMod.onModalCategoryChange,
  openCardModal: cardsMod.openCardModal,
  closeCardModal: cardsMod.closeCardModal,
  saveCardFromModal: cardsMod.saveCardFromModal,
  deleteCard: cardsMod.deleteCard,
  toggleStarCard: cardsMod.toggleStarCard,
  toggleBoardMultiDayMode: boardMod.toggleBoardMultiDayMode,
  moveItineraryItem: boardMod.moveItineraryItem,
  renderKanbanBoard: boardMod.renderKanbanBoard,
  onDragStartCard: boardMod.onDragStartCard,
  onDragStartItineraryItem: boardMod.onDragStartItineraryItem,
  onDragOverColumn: boardMod.onDragOverColumn,
  onDragLeaveColumn: boardMod.onDragLeaveColumn,
  onDropOnDay: boardMod.onDropOnDay,
  quickAssignCardToDay: boardMod.quickAssignCardToDay,
  addCardToDay: boardMod.addCardToDay,
  removeItineraryItem: boardMod.removeItineraryItem,
  updateDayStartTime: boardMod.updateDayStartTime,
  cycleTransitMode: boardMod.cycleTransitMode,
  editLegCustomTime: boardMod.editLegCustomTime,
  editItemFlightSchedule: boardMod.editItemFlightSchedule,
  extendHotelToNextDay: boardMod.extendHotelToNextDay,
  addReturnToHotel: boardMod.addReturnToHotel,
  selectDayFocus: boardMod.selectDayFocus,
  onMapDayChange: boardMod.onMapDayChange,
  recalculateAllDayTimes: boardMod.recalculateAllDayTimes,
  toggleMapDrawer,
  toggleMapCategoryLayer: mapMod.toggleMapCategoryLayer,
  setOnlyAttractionsLayer: mapMod.setOnlyAttractionsLayer,
  setAllMapLayersVisible: mapMod.setAllMapLayersVisible,
  toggleOverlayPocketOnPlanMap: mapMod.toggleOverlayPocketOnPlanMap,
  renderMapMarkers: hooks.renderMapMarkers,
  fitMapToFilteredCards: mapMod.fitMapToFilteredCards,
  focusCardOnMap: hooks.focusCardOnMap,
  highlightDatabaseCard: mapMod.highlightDatabaseCard,
  pullFromGoogleSheets,
  pushAllToGoogleSheets,
  copyGasBackendCode,
  exportJsonBackup,
  openSettingsModal,
  closeSettingsModal,
  saveSettings
});

window.addEventListener('DOMContentLoaded', async () => {
  try {
    loadLocalState();
    ensureItineraryDays();
    updateHeaderInfo();
    mapMod.initLeafletMap();
    initSplitResizers();
    mapMod.renderMapCategoryToggles();
    cardsMod.populateRegionDropdowns();
    syncMapDrawerUi();

    state.tripViewStep = 'list';
    syncTripStepAttributes();

    if (isMobileViewport()) {
      switchMobileTab('trips');
    } else {
      switchWorkspaceMode('plan');
    }

    if (state.settings.gasUrl) {
      await pullFromGoogleSheets(false);
      if (isMobileViewport()) {
        switchMobileTab(currentMobileTab);
      } else {
        switchWorkspaceMode(state.mode);
      }
    }
  } catch (err) {
    console.error('初始化畫面時發生錯誤:', err);
  }
});
