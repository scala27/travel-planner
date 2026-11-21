import { DEFAULT_SETTINGS, STORAGE_KEY } from './config.js';

export const state = {
  isReadOnly: false, // 訪客開啟 ?share= 連結時為 true
  shareToken: '',
  shareStats: {}, // 各行程目前分享連結的瀏覽統計
  mode: 'plan', // 'plan'（我的行程） | 'collect'（口袋清單）
  tripViewStep: 'list', // 'list'（行程專案總覽牆） | 'detail'（單一行程每日排程）
  trips: [],
  activeTripId: 'trip_default',
  settings: { ...DEFAULT_SETTINGS },
  cards: [],
  itinerary: {},
  selectedMapDay: 1,
  mapOverviewAllDays: false,
  overlayPocketOnPlan: true,
  boardMultiDayMode: false,
  pocketCollapsed: false,
  miniCardMode: false,
  hierarchyViewMode: true, // true: 三層階層鑽取（國家 -> 行政區 -> 景點） | false: 全部展開扁平列表
  drillCountry: '', // 目前鑽取進入的國家名稱（'' 表示在第一層國家總覽）
  drillDistrict: '', // 目前鑽取進入的行政區名稱（'' 表示在第二層行政區總覽）
  mapDrawerOpenCollect: false,
  mapDrawerOpenPlan: false,
  filters: {
    scope: 'all',
    country: 'all',
    city: 'all',
    category: 'all',
    status: 'all'
  },
  planQuickFilter: 'unscheduled',
  planProximitySort: false,
  visibleMapLayers: {
    '景點': true,
    '美食': true,
    '購物': true,
    '住宿': true,
    '機場': true,
    '交通': true,
    '體驗': true
  }
};

export const hooks = {
  pushAllToGoogleSheets: null,
  renderAll: null,
  renderDatabaseCards: null,
  renderKanbanBoard: null,
  renderMapMarkers: null,
  renderMapCategoryToggles: null,
  populateRegionDropdowns: null,
  focusCardOnMap: null,
  openCardModal: null,
  addCardToDay: null,
  invalidateMapSize: null
};

// ==================== 地區名稱正規化與「方向 B」顯示工具 ====================
export function normalizeTaiwanTraditionalChars(str) {
  return String(str || '')
    .replace(/台灣/g, '臺灣')
    .replace(/台北市/g, '臺北市')
    .replace(/台北縣/g, '臺北縣')
    .replace(/台中市/g, '臺中市')
    .replace(/台中縣/g, '臺中縣')
    .replace(/台南市/g, '臺南市')
    .replace(/台南縣/g, '臺南縣')
    .replace(/台東縣/g, '臺東縣')
    .replace(/台東市/g, '臺東市');
}

export function isDomesticCountry(country) {
  const c = String(country || '').trim();
  return c === '台灣' || c === '臺灣' || c.toUpperCase() === 'TW' || c.toLowerCase() === 'taiwan';
}

export function normalizeCountryName(country) {
  const raw = String(country || '').trim();
  if (!raw) return '日本';
  if (isDomesticCountry(raw)) return '臺灣';
  return normalizeTaiwanTraditionalChars(raw);
}

export function normalizeDistrictName(district, country = '') {
  let d = normalizeTaiwanTraditionalChars(String(district || '').trim());
  if (!d) return '';

  // 清除開頭重複的國家名稱前綴（例如「日本・沖繩縣・那霸市」或「臺灣・臺中市」）
  d = d.replace(/^(臺灣|台灣)\s*[・‧·\-/]\s*/i, '');
  const normCountry = normalizeCountryName(country);
  if (normCountry && !isDomesticCountry(normCountry)) {
    const escapedCountry = normCountry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefixRegex = new RegExp(`^${escapedCountry}\\s*[・‧·\\-/]\\s*`, 'i');
    d = d.replace(prefixRegex, '');
  }

  // 統一階層分隔符號為「・」
  d = d
    .split(/\s*[・‧·]\s*/)
    .map(part => part.trim())
    .filter(Boolean)
    .join('・');

  return d;
}

/**
 * 方向 B 統一顯示規則：
 * - 國內（臺灣）：精簡不顯示國家，僅顯示「縣市・鄉鎮市區」（如：臺中市・沙鹿區）
 * - 國外（日本等）：統一顯示「國家・行政區」（如：日本・沖繩縣・那霸市）
 */
export function formatCardRegionDisplay(card) {
  if (!card) return '未分類地區';
  const rawCountry = String(card.country || '').trim();
  const rawDistrict = String(card.district || '').trim();
  const inferredDomestic =
    isDomesticCountry(rawCountry) ||
    (!rawCountry && /^(臺灣|台灣|臺北市|台北市|新北市|桃園市|臺中市|台中市|臺南市|台南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|臺東縣|台東縣|澎湖縣|金門縣|連江縣)/.test(rawDistrict));

  const country = inferredDomestic ? '臺灣' : normalizeCountryName(rawCountry);
  const district = normalizeDistrictName(rawDistrict, country);

  if (inferredDomestic) {
    return district || '臺灣';
  }
  if (country && district) {
    return `${country}・${district}`;
  }
  return district || country || '未分類地區';
}

export function generateRandomShareToken() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let token = 't_';
  for (let i = 0; i < 8; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

export function createTripObject(partial = {}) {
  const id = partial.id || `trip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const totalDays = Math.max(1, Math.min(15, Number(partial.totalDays) || 5));
  const itinerary = partial.itinerary ? JSON.parse(JSON.stringify(partial.itinerary)) : {};
  for (let d = 1; d <= totalDays; d++) {
    if (!itinerary[d]) {
      itinerary[d] = { startTime: '09:00', items: [] };
    }
  }
  const dayColors = partial.dayColors && typeof partial.dayColors === 'object'
    ? { ...partial.dayColors }
    : {};
  return {
    id,
    title: partial.title || '新旅遊計畫',
    destination: partial.destination || '',
    startDate: partial.startDate || new Date().toISOString().slice(0, 10),
    totalDays,
    dayColors,
    shareToken: partial.shareToken ? String(partial.shareToken).trim() : generateRandomShareToken(),
    shareEnabled: partial.shareEnabled === true,
    itinerary
  };
}

export function getActiveTrip() {
  if (!Array.isArray(state.trips) || state.trips.length === 0) {
    const fallback = createTripObject({
      id: 'trip_default',
      title: state.settings.tripTitle || DEFAULT_SETTINGS.tripTitle,
      destination: '日本・沖繩',
      startDate: state.settings.startDate || DEFAULT_SETTINGS.startDate,
      totalDays: state.settings.totalDays || DEFAULT_SETTINGS.totalDays,
      dayColors: state.settings.dayColors || {},
      itinerary: state.itinerary
    });
    state.trips = [fallback];
    state.activeTripId = fallback.id;
  }
  let found = state.trips.find(t => t.id === state.activeTripId);
  if (!found) {
    found = state.trips[0];
    state.activeTripId = found.id;
  }
  return found;
}

export function syncActiveTripToLegacyState() {
  const active = getActiveTrip();
  state.settings.tripTitle = active.title;
  state.settings.startDate = active.startDate;
  state.settings.totalDays = active.totalDays;
  state.settings.dayColors = active.dayColors && typeof active.dayColors === 'object'
    ? { ...active.dayColors }
    : {};
  state.itinerary = active.itinerary;
  ensureItineraryDays();
}

export function syncLegacyStateBackToActiveTrip() {
  if (state.isReadOnly) return;
  const active = getActiveTrip();
  active.title = state.settings.tripTitle;
  active.startDate = state.settings.startDate;
  active.totalDays = state.settings.totalDays;
  active.dayColors = state.settings.dayColors && typeof state.settings.dayColors === 'object'
    ? { ...state.settings.dayColors }
    : {};
  active.itinerary = state.itinerary;
}

export function loadLocalState() {
  if (state.isReadOnly) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.settings) {
        state.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
      }
      if (Array.isArray(parsed.cards)) {
        state.cards = parsed.cards;
      }
      if (parsed.itinerary && typeof parsed.itinerary === 'object') {
        state.itinerary = parsed.itinerary;
      }
      if (Array.isArray(parsed.trips) && parsed.trips.length > 0) {
        state.trips = parsed.trips.map(t => createTripObject(t));
        state.activeTripId = parsed.activeTripId || state.trips[0].id;
      } else {
        const initialTrip = createTripObject({
          id: 'trip_default',
          title: state.settings.tripTitle || DEFAULT_SETTINGS.tripTitle,
          destination: '日本・沖繩',
          startDate: state.settings.startDate || DEFAULT_SETTINGS.startDate,
          totalDays: state.settings.totalDays || DEFAULT_SETTINGS.totalDays,
          dayColors: state.settings.dayColors || {},
          itinerary: state.itinerary
        });
        state.trips = [initialTrip];
        state.activeTripId = initialTrip.id;
      }
      syncActiveTripToLegacyState();
      return;
    }
  } catch (e) {
    console.warn('讀取本機快取失敗:', e);
  }
  const defaultTrip = createTripObject({
    id: 'trip_default',
    title: DEFAULT_SETTINGS.tripTitle,
    destination: '日本・沖繩',
    startDate: DEFAULT_SETTINGS.startDate,
    totalDays: DEFAULT_SETTINGS.totalDays,
    dayColors: {}
  });
  state.trips = [defaultTrip];
  state.activeTripId = defaultTrip.id;
  syncActiveTripToLegacyState();
}

export function persistState(autoPushCloud = false) {
  if (state.isReadOnly) return;
  syncLegacyStateBackToActiveTrip();
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        settings: state.settings,
        trips: state.trips,
        activeTripId: state.activeTripId,
        cards: state.cards,
        itinerary: state.itinerary
      })
    );
  } catch (e) {
    console.warn('寫入本機快取失敗:', e);
  }

  if (autoPushCloud && state.settings.gasUrl && typeof hooks.pushAllToGoogleSheets === 'function') {
    hooks.pushAllToGoogleSheets(true);
  }
}

export function ensureItineraryDays() {
  const total = Math.max(1, Math.min(15, Number(state.settings.totalDays) || 6));
  for (let d = 1; d <= total; d++) {
    if (!state.itinerary[d]) {
      state.itinerary[d] = { startTime: '09:00', items: [] };
    } else if (!Array.isArray(state.itinerary[d].items)) {
      state.itinerary[d].items = [];
    }
  }
  if (state.selectedMapDay > total) {
    state.selectedMapDay = 1;
  }
}

export function showToast(message, color = 'slate') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const colorMap = {
    slate: 'bg-slate-800 text-white',
    emerald: 'bg-emerald-600 text-white',
    amber: 'bg-amber-600 text-white',
    rose: 'bg-rose-600 text-white',
    blue: 'bg-[#2C4D6E] text-white'
  };

  const el = document.createElement('div');
  el.className = `${colorMap[color] || colorMap.slate} px-3.5 py-2 rounded-xl shadow-lg text-xs font-bold flex items-center gap-2 transition-all duration-200`;
  el.textContent = message;
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 220);
  }, 2400);
}
