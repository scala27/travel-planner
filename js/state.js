import { STORAGE_KEY, DEFAULT_SETTINGS } from './config.js';
import { normalizeAdministrativeDistrict } from './geo.js';

export const state = {
  mode: 'collect',
  pocketCollapsed: false,
  miniCardView: false,
  boardMultiDayMode: false,
  mapDrawerOpenCollect: true,
  mapDrawerOpenPlan: false,
  overlayPocketOnPlan: false,
  selectedMapDay: 1,
  highlightedCardId: null,
  expandedCards: {},
  deletedIds: [],
  planQuickFilter: 'unscheduled',
  mapVisibleCategories: {
    '景點': true,
    '美食': true,
    '購物': true,
    '住宿': true,
    '機場': true,
    '交通': true,
    '體驗': true
  },
  filters: {
    scope: 'all',
    category: 'all',
    status: 'all'
  },
  settings: { ...DEFAULT_SETTINGS },
  cards: [],
  itinerary: {}
};

// 跨模組回呼註冊器（避免 ES6 循環相依）
export const hooks = {
  pushAllToGoogleSheets: async () => {},
  renderAll: () => {},
  renderDatabaseCards: () => {},
  renderKanbanBoard: () => {},
  renderMapMarkers: () => {},
  renderMapCategoryToggles: () => {},
  populateRegionDropdowns: () => {},
  focusCardOnMap: () => {},
  openCardModal: () => {},
  addCardToDay: () => {}
};

let autoSyncTimer = null;

export function discoverSavedGasUrl() {
  if (state.settings.gasUrl) return state.settings.gasUrl;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    const val = localStorage.getItem(k) || '';
    const match = val.match(/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/);
    if (match) return match[0];
  }
  return '';
}

export function loadLocalState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
      state.cards = Array.isArray(parsed.cards)
        ? parsed.cards.map(c => ({
            ...c,
            district: normalizeAdministrativeDistrict(c.district, c.country)
          }))
        : [];
      state.itinerary = parsed.itinerary || {};
      state.deletedIds = Array.isArray(parsed.deletedIds) ? parsed.deletedIds : [];
    } catch (e) {}
  }

  if (!state.settings.gasUrl) {
    const discovered = discoverSavedGasUrl();
    if (discovered) {
      state.settings.gasUrl = discovered;
      persistState(false);
    }
  }
}

export function persistState(triggerAutoPush = true) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    settings: state.settings,
    cards: state.cards,
    itinerary: state.itinerary,
    deletedIds: state.deletedIds
  }));

  if (triggerAutoPush && state.settings.gasUrl) {
    setSyncPillStatus('syncing', '正在自動寫入試算表...');
    clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(() => {
      hooks.pushAllToGoogleSheets(true);
    }, 500);
  }
}

export function ensureItineraryDays() {
  const total = Number(state.settings.totalDays) || 6;
  for (let d = 1; d <= total; d++) {
    if (!state.itinerary[d]) {
      state.itinerary[d] = { startTime: '09:00', items: [] };
    }
  }
}

export function getCardScheduledDays(cardId) {
  const days = [];
  const total = Number(state.settings.totalDays) || 6;
  for (let d = 1; d <= total; d++) {
    const items = state.itinerary[d]?.items || [];
    if (items.some(it => it.cardId === cardId)) {
      days.push(d);
    }
  }
  return days;
}

export function setSyncPillStatus(type, text) {
  const pill = document.getElementById('syncStatusPill');
  const dot = document.getElementById('syncStatusDot');
  const label = document.getElementById('syncStatusText');
  if (!pill || !dot || !label) return;

  label.textContent = text;
  if (type === 'syncing') {
    pill.className = 'hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200';
    dot.className = 'w-2 h-2 rounded-full bg-blue-500 animate-ping';
  } else if (type === 'warning') {
    pill.className = 'hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200';
    dot.className = 'w-2 h-2 rounded-full bg-amber-500';
  } else {
    pill.className = 'hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200';
    dot.className = 'w-2 h-2 rounded-full bg-emerald-500';
  }
}

export function showToast(msg, color = 'slate') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const colorMap = {
    emerald: 'bg-emerald-600 text-white',
    blue: 'bg-blue-600 text-white',
    amber: 'bg-amber-500 text-white',
    slate: 'bg-slate-800 text-white'
  };
  const el = document.createElement('div');
  el.className = `px-4 py-2 rounded-full shadow-lg text-xs font-bold flex items-center gap-2 transition-all ${colorMap[color] || colorMap.slate}`;
  el.innerHTML = `<i class="fa-solid fa-circle-check"></i><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
