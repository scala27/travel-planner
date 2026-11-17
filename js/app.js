import { DEFAULT_SETTINGS } from './config.js';
import {
  state,
  hooks,
  loadLocalState,
  persistState,
  ensureItineraryDays,
  setSyncPillStatus,
  showToast
} from './state.js';
import {
  pullFromGoogleSheets,
  pushAllToGoogleSheets,
  copyGasBackendCode,
  exportJsonBackup
} from './api.js';
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
import {
  toggleMiniCardMode,
  toggleBatchImportBox,
  setPlanQuickFilter,
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
  extendHotelToNextDay,
  addReturnToHotel,
  selectDayFocus,
  onMapDayChange,
  recalculateAllDayTimes
} from './ui-board.js';

function renderAll() {
  renderDatabaseCards();
  if (state.mode === 'plan') {
    renderKanbanBoard();
  }
  renderMapMarkers(getFilteredAndSortedCards);
}

// 註冊跨模組共用回呼
Object.assign(hooks, {
  pushAllToGoogleSheets,
  renderAll,
  renderDatabaseCards,
  renderKanbanBoard,
  renderMapMarkers: () => renderMapMarkers(getFilteredAndSortedCards),
  renderMapCategoryToggles,
  populateRegionDropdowns,
  focusCardOnMap,
  openCardModal,
  addCardToDay
});

function updateMapDrawerVisibility() {
  const drawer = document.getElementById('mapCollapsibleDrawer');
  const routeSection = document.getElementById('planRouteLegsDrawerSection');
  const chevron = document.getElementById('mapDrawerChevron');

  if (state.mode === 'collect') {
    drawer.classList.toggle('hidden', !state.mapDrawerOpenCollect);
    routeSection.classList.add('hidden');
  } else {
    drawer.classList.toggle('hidden', !state.mapDrawerOpenPlan);
    routeSection.classList.toggle('hidden', !state.mapDrawerOpenPlan);
    if (chevron) {
      chevron.className = state.mapDrawerOpenPlan ? 'fa-solid fa-chevron-up text-[9px]' : 'fa-solid fa-chevron-down text-[9px]';
    }
  }
  setTimeout(() => invalidateMapSize(), 150);
}

function toggleMapDrawer() {
  if (state.mode === 'collect') {
    state.mapDrawerOpenCollect = !state.mapDrawerOpenCollect;
  } else {
    state.mapDrawerOpenPlan = !state.mapDrawerOpenPlan;
  }
  updateMapDrawerVisibility();
}

function switchWorkspaceMode(targetMode) {
  state.mode = targetMode;
  const tabCollect = document.getElementById('tabModeCollect');
  const tabPlan = document.getElementById('tabModePlan');
  const dbPanel = document.getElementById('databasePanel');
  const boardSection = document.getElementById('itineraryBoardSection');
  const resizerLeft = document.getElementById('resizerLeft');
  const resizerRight = document.getElementById('resizerRight');

  const dbTitleText = document.getElementById('dbPanelTitleText');
  const btnAddCard = document.getElementById('btnAddCardCollect');
  const btnBatch = document.getElementById('btnToggleBatchBox');
  const btnCollapsePocket = document.getElementById('btnCollapsePocket');
  const btnExpandPocket = document.getElementById('btnExpandPocket');
  const btnMiniCardToggle = document.getElementById('btnMiniCardToggle');
  const sortWrapper = document.getElementById('sortSelectWrapper');
  const planQuickBar = document.getElementById('planQuickFilterBar');
  const advFilters = document.getElementById('advancedFilterGroup');
  const mapHeaderCollect = document.getElementById('mapHeaderCollectMode');
  const mapHeaderPlan = document.getElementById('mapHeaderPlanMode');
  const batchBox = document.getElementById('batchImportBox');
  const cardsGrid = document.getElementById('databaseCardsContainer');

  if (targetMode === 'collect') {
    tabCollect.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all bg-blue-600 text-white shadow-xs';
    tabPlan.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all text-slate-600 hover:text-slate-900';

    dbPanel.classList.remove('hidden');
    dbPanel.style.width = '60%';
    resizerLeft.classList.remove('hidden');
    resizerRight.classList.add('hidden');
    boardSection.classList.add('hidden');
    boardSection.classList.remove('flex');

    dbTitleText.textContent = '全球口袋資料庫';
    btnAddCard.classList.remove('hidden');
    btnBatch.classList.remove('hidden');
    btnMiniCardToggle.classList.remove('hidden');
    sortWrapper.classList.remove('hidden');
    advFilters.classList.remove('hidden');
    planQuickBar.classList.add('hidden');
    planQuickBar.classList.remove('flex');

    btnCollapsePocket.classList.add('hidden');
    btnCollapsePocket.classList.remove('flex');
    btnExpandPocket.classList.add('hidden');

    mapHeaderCollect.classList.remove('hidden');
    mapHeaderPlan.classList.add('hidden');

    cardsGrid.className = state.miniCardView
      ? 'flex-1 min-h-0 overflow-y-auto p-2.5 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 items-stretch content-start bg-slate-50/40'
      : 'flex-1 min-h-0 overflow-y-auto p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-stretch content-start bg-slate-50/40';
  } else {
    tabPlan.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all bg-blue-600 text-white shadow-xs';
    tabCollect.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all text-slate-600 hover:text-slate-900';

    if (state.pocketCollapsed) {
      dbPanel.classList.add('hidden');
      resizerLeft.classList.add('hidden');
      btnExpandPocket.classList.remove('hidden');
      btnExpandPocket.classList.add('flex');
    } else {
      dbPanel.classList.remove('hidden');
      dbPanel.style.width = '265px';
      resizerLeft.classList.remove('hidden');
      btnExpandPocket.classList.add('hidden');
    }

    boardSection.classList.remove('hidden');
    boardSection.classList.add('flex');
    boardSection.style.width = '34%';
    resizerRight.classList.remove('hidden');

    dbTitleText.textContent = '口袋待排清單';
    btnAddCard.classList.add('hidden');
    btnBatch.classList.add('hidden');
    batchBox.classList.add('hidden');
    btnMiniCardToggle.classList.add('hidden');
    sortWrapper.classList.add('hidden');
    advFilters.classList.add('hidden');
    planQuickBar.classList.remove('hidden');
    planQuickBar.classList.add('flex');

    btnCollapsePocket.classList.remove('hidden');
    btnCollapsePocket.classList.add('flex');

    mapHeaderCollect.classList.add('hidden');
    mapHeaderPlan.classList.remove('hidden');

    cardsGrid.className = 'flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2 bg-slate-50/60';
  }

  updateMapDrawerVisibility();
  renderAll();
  setTimeout(() => invalidateMapSize(), 150);
}

function togglePocketCollapse() {
  state.pocketCollapsed = !state.pocketCollapsed;
  switchWorkspaceMode('plan');
}

function initSplitResizers() {
  const workspace = document.getElementById('workspaceMain');
  const dbPanel = document.getElementById('databasePanel');
  const boardSection = document.getElementById('itineraryBoardSection');
  const resizerLeft = document.getElementById('resizerLeft');
  const resizerRight = document.getElementById('resizerRight');
  const mapContainer = document.getElementById('mapContainer');

  let activeResizer = null;
  let startX = 0;
  let startDbWidth = 0;
  let startBoardWidth = 0;

  function beginDrag(resizerType, e) {
    e.preventDefault();
    activeResizer = resizerType;
    startX = e.clientX;
    startDbWidth = dbPanel.getBoundingClientRect().width;
    startBoardWidth = boardSection.getBoundingClientRect().width;
    mapContainer.style.pointerEvents = 'none';
    if (resizerType === 'left') resizerLeft.classList.add('is-dragging');
    if (resizerType === 'right') resizerRight.classList.add('is-dragging');
  }

  resizerLeft.addEventListener('mousedown', (e) => beginDrag('left', e));
  resizerRight.addEventListener('mousedown', (e) => beginDrag('right', e));

  window.addEventListener('mousemove', (e) => {
    if (!activeResizer) return;
    const totalW = workspace.getBoundingClientRect().width;
    const dx = e.clientX - startX;

    if (activeResizer === 'left') {
      if (state.mode === 'collect') {
        const newW = Math.max(260, Math.min(totalW - 280, startDbWidth + dx));
        dbPanel.style.width = `${newW}px`;
      } else {
        const newW = Math.max(220, Math.min(480, startDbWidth + dx));
        dbPanel.style.width = `${newW}px`;
      }
    } else if (activeResizer === 'right' && state.mode === 'plan') {
      const currentDbW = state.pocketCollapsed ? 0 : dbPanel.getBoundingClientRect().width;
      const maxBoardW = totalW - currentDbW - 260;
      const newBoardW = Math.max(280, Math.min(maxBoardW, startBoardWidth + dx));
      boardSection.style.width = `${newBoardW}px`;
    }

    invalidateMapSize();
  });

  window.addEventListener('mouseup', () => {
    if (!activeResizer) return;
    activeResizer = null;
    mapContainer.style.pointerEvents = '';
    resizerLeft.classList.remove('is-dragging');
    resizerRight.classList.remove('is-dragging');
    invalidateMapSize();
  });
}

function updateTripHeaderDisplay() {
  document.getElementById('tripTitleDisplay').textContent = state.settings.tripTitle;
  const days = Number(state.settings.totalDays) || 6;
  const start = new Date(state.settings.startDate + 'T00:00:00');
  let endStr = '';
  if (!isNaN(start.getTime())) {
    const end = new Date(start.getTime() + (days - 1) * 86400000);
    endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  }
  document.getElementById('tripDateDisplay').textContent = `${state.settings.startDate} ~ ${endStr} (${days}天${Math.max(0, days - 1)}夜)`;

  if (state.settings.gasUrl) {
    setSyncPillStatus('ok', 'Google 試算表已連線');
  } else {
    setSyncPillStatus('warning', '未設定 GAS 網址（點齒輪設定）');
  }
}

function populateDaySelectors() {
  const totalDays = Number(state.settings.totalDays) || 6;
  const sel = document.getElementById('mapDaySelect');
  sel.innerHTML = `<option value="all">🗺️ 全部已排行程（多日分色）</option>` +
    Array.from({ length: totalDays }, (_, i) => {
      const d = i + 1;
      const info = getFormattedDateInfo(d);
      return `<option value="${d}">Day ${d} (${info.md} ${info.week})</option>`;
    }).join('');
  sel.value = state.mapOverviewAllDays ? 'all' : String(state.selectedMapDay);
}

function openSettingsModal() {
  document.getElementById('setTripTitle').value = state.settings.tripTitle;
  document.getElementById('setStartDate').value = state.settings.startDate;
  document.getElementById('setTotalDays').value = state.settings.totalDays;
  document.getElementById('setGasUrl').value = state.settings.gasUrl || '';
  document.getElementById('settingsModal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
}

async function saveSettings() {
  state.settings.tripTitle = document.getElementById('setTripTitle').value.trim() || DEFAULT_SETTINGS.tripTitle;
  state.settings.startDate = document.getElementById('setStartDate').value || DEFAULT_SETTINGS.startDate;
  state.settings.totalDays = Math.max(1, parseInt(document.getElementById('setTotalDays').value, 10) || 6);
  state.settings.gasUrl = document.getElementById('setGasUrl').value.trim();

  ensureItineraryDays();
  persistState(false);
  updateTripHeaderDisplay();
  populateDaySelectors();
  closeSettingsModal();
  if (state.settings.gasUrl) {
    await pullFromGoogleSheets(true);
  } else {
    renderAll();
    showToast('設定已儲存', 'emerald');
  }
}

// 掛載所有供 HTML onclick / onchange / ondrag 呼叫的全域函式
Object.assign(window, {
  switchWorkspaceMode,
  openSettingsModal,
  closeSettingsModal,
  saveSettings,
  copyGasBackendCode,
  exportJsonBackup,
  pushAllToGoogleSheets,
  pullFromGoogleSheets,
  openCardModal,
  closeCardModal,
  saveCardFromModal,
  deleteCard,
  toggleStarCard,
  onModalCategoryChange,
  handleLatLngPaste,
  extractCoordsFromMapUrlField,
  reverseGeocodeModalCoords,
  toggleBatchImportBox,
  handleBatchImport,
  batchUpdateAllDistricts,
  toggleMiniCardMode,
  togglePocketCollapse,
  renderDatabaseCards,
  clearSearch,
  setPlanQuickFilter,
  setFilter,
  onCountryFilterChange,
  toggleCardDetailExpand,
  handleCardClick,
  quickAssignCardToDay,
  toggleBoardMultiDayMode,
  selectDayFocus,
  moveItineraryItem,
  removeItineraryItem,
  updateDayStartTime,
  cycleTransitMode,
  extendHotelToNextDay,
  addReturnToHotel,
  addCardToDay,
  onDragStartCard,
  onDragStartItineraryItem,
  onDragOverColumn,
  onDragLeaveColumn,
  onDropOnDay,
  toggleMapDrawer,
  fitMapToFilteredCards,
  onMapDayChange,
  recalculateAllDayTimes,
  toggleOverlayPocketOnPlanMap,
  toggleMapCategoryLayer,
  setOnlyAttractionsLayer,
  setAllMapLayersVisible,
  renderMapMarkers: () => renderMapMarkers(getFilteredAndSortedCards),
  focusCardOnMap,
  highlightDatabaseCard
});

async function initApp() {
  loadLocalState();
  ensureItineraryDays();
  initSplitResizers();
  initLeafletMap();
  renderMapCategoryToggles();
  updateTripHeaderDisplay();
  populateRegionDropdowns();
  populateDaySelectors();
  switchWorkspaceMode('collect');

  if (state.settings.gasUrl) {
    await pullFromGoogleSheets(false);
  }
}

window.addEventListener('DOMContentLoaded', initApp);
