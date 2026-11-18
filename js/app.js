import { DEFAULT_SETTINGS } from './config.js';
import {
  state,
  hooks,
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
import {
  updateMiniCardButtonUi,
  toggleMiniCardMode,
  toggleBatchImportBox,
  setPlanQuickFilter,
  togglePlanProximitySort,
  setFilter,
  clearSearch,
  getFilteredAndSortedCards,
  toggleCardDetailExpand,
  renderDatabaseCards,
  handleCardClick,
  populateRegionDropdowns,
  onCountryFilterChange,
  handleBatchImport,
  batchUpdateAllDistricts,
  handleLatLngPaste,
  extractCoordsFromMapUrlField,
  reverseGeocodeModalCoords,
  onModalCategoryChange,
  openCardModal,
  closeCardModal,
  saveCardFromModal,
  deleteCard,
  toggleStarCard
} from './ui-cards.js';
import {
  getFormattedDateInfo,
  toggleBoardMultiDayMode,
  moveItineraryItem,
  renderKanbanBoard,
  onDragStartCard,
  onDragStartItineraryItem,
  onDragOverColumn,
  onDragLeaveColumn,
  onDropOnDay,
  quickAssignCardToDay,
  addCardToDay,
  removeItineraryItem,
  updateDayStartTime,
  cycleTransitMode,
  editLegCustomTime,
  editItemFlightSchedule,
  extendHotelToNextDay,
  addReturnToHotel,
  selectDayFocus,
  onMapDayChange,
  recalculateAllDayTimes
} from './ui-board.js';
import {
  initLeafletMap,
  invalidateMapSize,
  renderMapCategoryToggles,
  toggleMapCategoryLayer,
  setOnlyAttractionsLayer,
  setAllMapLayersVisible,
  toggleOverlayPocketOnPlanMap,
  renderMapMarkers,
  fitMapToFilteredCards,
  focusCardOnMap,
  highlightDatabaseCard
} from './map.js';

hooks.pushAllToGoogleSheets = pushAllToGoogleSheets;
hooks.renderAll = renderAll;
hooks.renderDatabaseCards = renderDatabaseCards;
hooks.renderKanbanBoard = renderKanbanBoard;
hooks.renderMapMarkers = () => renderMapMarkers(getFilteredAndSortedCards);
hooks.renderMapCategoryToggles = renderMapCategoryToggles;
hooks.populateRegionDropdowns = populateRegionDropdowns;
hooks.focusCardOnMap = focusCardOnMap;
hooks.openCardModal = openCardModal;
hooks.addCardToDay = addCardToDay;

function initSplitResizers() {
  const mainEl = document.getElementById('workspaceMain');
  const dbPanel = document.getElementById('databasePanel');
  const boardPanel = document.getElementById('itineraryBoardSection');
  const resizerLeft = document.getElementById('resizerLeft');
  const resizerRight = document.getElementById('resizerRight');

  let activeResizer = null;

  resizerLeft.addEventListener('mousedown', (e) => {
    e.preventDefault();
    activeResizer = 'left';
    resizerLeft.classList.add('is-dragging');
    document.body.style.cursor = 'col-resize';
  });

  resizerRight.addEventListener('mousedown', (e) => {
    e.preventDefault();
    activeResizer = 'right';
    resizerRight.classList.add('is-dragging');
    document.body.style.cursor = 'col-resize';
  });

  window.addEventListener('mousemove', (e) => {
    if (!activeResizer) return;
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
    invalidateMapSize();
  });

  window.addEventListener('mouseup', () => {
    if (!activeResizer) return;
    activeResizer = null;
    resizerLeft.classList.remove('is-dragging');
    resizerRight.classList.remove('is-dragging');
    document.body.style.cursor = '';
    invalidateMapSize();
  });
}

function updateOverlayPocketButtonUi() {
  const btn = document.getElementById('btnOverlayPocket');
  const txt = document.getElementById('overlayPocketStatusText');
  if (!btn || !txt) return;
  if (state.overlayPocketOnPlan) {
    btn.className = 'px-2 py-1 rounded-lg border border-blue-600 bg-blue-600 text-white text-[11px] font-bold flex items-center gap-1 transition';
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
  setTimeout(() => invalidateMapSize(), 80);
}

function switchWorkspaceMode(targetMode) {
  state.mode = targetMode;
  const tabCollect = document.getElementById('tabModeCollect');
  const tabPlan = document.getElementById('tabModePlan');
  const dbPanel = document.getElementById('databasePanel');
  const resizerLeft = document.getElementById('resizerLeft');
  const boardSection = document.getElementById('itineraryBoardSection');
  const resizerRight = document.getElementById('resizerRight');
  const dbCardsGrid = document.getElementById('databaseCardsContainer');

  const dbTitle = document.getElementById('dbPanelTitleText');
  const btnAddCollect = document.getElementById('btnAddCardCollect');
  const btnBatch = document.getElementById('btnToggleBatchBox');
  const btnMini = document.getElementById('btnMiniCardToggle');
  const btnCollapse = document.getElementById('btnCollapsePocket');
  const btnExpand = document.getElementById('btnExpandPocket');
  const sortWrap = document.getElementById('sortSelectWrapper');
  const advFilter = document.getElementById('advancedFilterGroup');
  const planQuickFilter = document.getElementById('planQuickFilterBar');

  const mapHeaderCollect = document.getElementById('mapHeaderCollectMode');
  const mapHeaderPlan = document.getElementById('mapHeaderPlanMode');

  if (targetMode === 'collect') {
    tabCollect.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all bg-blue-600 text-white shadow-xs';
    tabPlan.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all text-slate-600 hover:text-slate-900';

    dbPanel.classList.remove('hidden');
    dbPanel.style.width = '62%';
    resizerLeft.classList.remove('hidden');
    boardSection.classList.add('hidden');
    boardSection.classList.remove('flex');
    resizerRight.classList.add('hidden');
    btnExpand.classList.add('hidden');

    dbTitle.textContent = '全球口袋資料庫';
    btnAddCollect.classList.remove('hidden');
    btnBatch.classList.remove('hidden');
    btnMini.classList.remove('hidden');
    btnCollapse.classList.add('hidden');
    btnCollapse.classList.remove('flex');
    sortWrap.classList.remove('hidden');
    advFilter.classList.remove('hidden');
    planQuickFilter.classList.add('hidden');
    planQuickFilter.classList.remove('flex');

    dbCardsGrid.className = 'flex-1 min-h-0 overflow-y-auto p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-stretch content-start bg-slate-50/40';
    mapHeaderCollect.classList.remove('hidden');
    mapHeaderPlan.classList.add('hidden');
    updateMiniCardButtonUi();
  } else {
    tabPlan.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all bg-blue-600 text-white shadow-xs';
    tabCollect.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all text-slate-600 hover:text-slate-900';

    dbTitle.textContent = '口袋待排清單';
    btnAddCollect.classList.add('hidden');
    btnBatch.classList.add('hidden');
    btnMini.classList.add('hidden');
    document.getElementById('batchImportBox').classList.add('hidden');
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
    mapHeaderCollect.classList.add('hidden');
    mapHeaderPlan.classList.remove('hidden');

    if (state.pocketCollapsed) {
      dbPanel.classList.add('hidden');
      resizerLeft.classList.add('hidden');
      btnExpand.classList.remove('hidden');
      btnExpand.classList.add('flex');
      boardSection.style.width = '48%';
    } else {
      dbPanel.classList.remove('hidden');
      dbPanel.style.width = '18%';
      resizerLeft.classList.remove('hidden');
      btnExpand.classList.add('hidden');
      boardSection.style.width = '36%';
    }

    // 進入規劃模式時確保「疊加口袋」預設開啟，讓地圖直接呈現周邊口袋點位
    state.overlayPocketOnPlan = true;
    updateOverlayPocketButtonUi();
    populateMapDaySelector();
  }

  syncMapDrawerUi();
  renderAll();
  setTimeout(() => invalidateMapSize(), 120);
}

function togglePocketCollapse() {
  state.pocketCollapsed = !state.pocketCollapsed;
  switchWorkspaceMode('plan');
}

function populateMapDaySelector() {
  const sel = document.getElementById('mapDaySelect');
  const total = Number(state.settings.totalDays) || 6;
  const options = [];
  for (let d = 1; d <= total; d++) {
    const info = getFormattedDateInfo(d);
    options.push(`<option value="${d}" ${(!state.mapOverviewAllDays && d === state.selectedMapDay) ? 'selected' : ''}>Day ${d} (${info.md} ${info.week})</option>`);
  }
  options.push(`<option value="all" ${state.mapOverviewAllDays ? 'selected' : ''}>🗺️ 全部已排行程 (多日分色)</option>`);
  sel.innerHTML = options.join('');
}

function updateHeaderInfo() {
  document.getElementById('tripTitleDisplay').textContent = state.settings.tripTitle || DEFAULT_SETTINGS.tripTitle;
  const total = Number(state.settings.totalDays) || 6;
  const start = new Date(state.settings.startDate + 'T00:00:00');
  if (!isNaN(start.getTime())) {
    const end = new Date(start.getTime() + (total - 1) * 86400000);
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    document.getElementById('tripDateDisplay').textContent = `${state.settings.startDate} ~ ${endStr} (${total}天${total - 1}夜)`;
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
  state.settings.tripTitle = document.getElementById('setTripTitle').value.trim() || DEFAULT_SETTINGS.tripTitle;
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
  renderDatabaseCards();
  if (state.mode === 'plan') {
    populateMapDaySelector();
    renderKanbanBoard();
  }
  renderMapMarkers(getFilteredAndSortedCards);
}

Object.assign(window, {
  switchWorkspaceMode,
  togglePocketCollapse,
  toggleMiniCardMode,
  toggleBatchImportBox,
  setPlanQuickFilter,
  togglePlanProximitySort,
  setFilter,
  clearSearch,
  toggleCardDetailExpand,
  renderDatabaseCards,
  handleCardClick,
  onCountryFilterChange,
  handleBatchImport,
  batchUpdateAllDistricts,
  handleLatLngPaste,
  extractCoordsFromMapUrlField,
  reverseGeocodeModalCoords,
  onModalCategoryChange,
  openCardModal,
  closeCardModal,
  saveCardFromModal,
  deleteCard,
  toggleStarCard,
  toggleBoardMultiDayMode,
  moveItineraryItem,
  renderKanbanBoard,
  onDragStartCard,
  onDragStartItineraryItem,
  onDragOverColumn,
  onDragLeaveColumn,
  onDropOnDay,
  quickAssignCardToDay,
  addCardToDay,
  removeItineraryItem,
  updateDayStartTime,
  cycleTransitMode,
  editLegCustomTime,
  editItemFlightSchedule,
  extendHotelToNextDay,
  addReturnToHotel,
  selectDayFocus,
  onMapDayChange,
  recalculateAllDayTimes,
  toggleMapDrawer,
  toggleMapCategoryLayer,
  setOnlyAttractionsLayer,
  setAllMapLayersVisible,
  toggleOverlayPocketOnPlanMap,
  renderMapMarkers: () => renderMapMarkers(getFilteredAndSortedCards),
  fitMapToFilteredCards,
  focusCardOnMap,
  highlightDatabaseCard,
  pullFromGoogleSheets,
  pushAllToGoogleSheets,
  copyGasBackendCode,
  exportJsonBackup,
  openSettingsModal,
  closeSettingsModal,
  saveSettings
});

window.addEventListener('DOMContentLoaded', async () => {
  loadLocalState();
  ensureItineraryDays();
  updateHeaderInfo();
  initLeafletMap();
  initSplitResizers();
  renderMapCategoryToggles();
  populateRegionDropdowns();
  syncMapDrawerUi();
  renderAll();

  if (state.settings.gasUrl) {
    await pullFromGoogleSheets(false);
  }
});
