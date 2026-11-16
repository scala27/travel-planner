// ==================== 1. 全域狀態與旅遊設定 ====================
const STORAGE_KEY = 'global_travel_planner_v1';

let appConfig = {
  gasUrl: '',
  tripTitle: '2027沖繩首發自由行',
  startDate: '2027-02-17',
  endDate: '2027-02-22'
};

let spots = [];
let dayStartTimes = {};
let legModeOverrides = {};
let currentCategoryFilter = '全部';
let currentRegionScopeFilter = 'all'; // 'all' | 'domestic' (國內) | 'international' (國外)
let currentRegionL1Filter = '全部';    // 國內：縣市 (如 臺中市)｜國外：國家 · 州/都道府縣 (如 日本 · 沖繩縣)
let currentRegionL2Filter = '全部';    // 國內：鄉鎮市區 (如 沙鹿區)｜國外：城市/町村 (如 那霸市、浦添市)
let currentDbStatusFilter = 'all';
let mapInstance = null;
let mapLayerGroup = null;
let routeRequestToken = 0;

let uiState = {
  leftVisible: true,
  rightVisible: true,
  boardCompact: true,
  inboxExpanded: false,
  mapWidthPx: 385
};

const CATEGORY_THEME = {
  '景點': { hex: '#10B981', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', borderLeft: 'border-l-emerald-500' },
  '美食': { hex: '#F59E0B', badge: 'bg-amber-50 text-amber-700 border-amber-200', borderLeft: 'border-l-amber-500' },
  '購物': { hex: '#6366F1', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200', borderLeft: 'border-l-indigo-500' },
  '住宿': { hex: '#7E22CE', badge: 'bg-purple-50 text-purple-800 border-purple-200', borderLeft: 'border-l-purple-600' },
  '交通': { hex: '#0284C7', badge: 'bg-sky-50 text-sky-800 border-sky-200', borderLeft: 'border-l-sky-600' }
};

const MODE_SHORT_LABEL = {
  flight: '✈️ 跨海航班',
  monorail: '🚝 單軌+步行',
  bus: '🚌 大眾運輸/客運',
  taxi: '🚕 計程車接駁',
  walking: '🚶 慢活步行',
  driving: '🚗 自駕'
};

// ==================== 2. 沖繩單軌電車 (Yui Rail) 19站精準軌道幾何資料 ====================
const YUI_RAIL_TRACK = [
  { lat: 26.2065, lng: 127.6522 }, { lat: 26.2088, lng: 127.6580 }, { lat: 26.2104, lng: 127.6647 },
  { lat: 26.2121, lng: 127.6695 }, { lat: 26.2143, lng: 127.6745 }, { lat: 26.2155, lng: 127.6778 },
  { lat: 26.2151, lng: 127.6793 }, { lat: 26.2145, lng: 127.6845 }, { lat: 26.2152, lng: 127.6893 },
  { lat: 26.2165, lng: 127.6948 }, { lat: 26.2188, lng: 127.6989 }, { lat: 26.2225, lng: 127.6987 },
  { lat: 26.2261, lng: 127.7010 }, { lat: 26.2292, lng: 127.7042 }, { lat: 26.2314, lng: 127.7068 },
  { lat: 26.2305, lng: 127.7115 }, { lat: 26.2286, lng: 127.7155 }, { lat: 26.2268, lng: 127.7196 },
  { lat: 26.2232, lng: 127.7215 }, { lat: 26.2192, lng: 127.7254 }, { lat: 26.2235, lng: 127.7302 },
  { lat: 26.2281, lng: 127.7346 }, { lat: 26.2325, lng: 127.7348 }, { lat: 26.2366, lng: 127.7349 },
  { lat: 26.2412, lng: 127.7368 }, { lat: 26.2454, lng: 127.7416 }
];

const YUI_RAIL_STATIONS = [
  { name: '那霸空港站', lat: 26.2065, lng: 127.6522, trackIdx: 0 },
  { name: '赤嶺站', lat: 26.2088, lng: 127.6580, trackIdx: 1 },
  { name: '小祿站', lat: 26.2104, lng: 127.6647, trackIdx: 2 },
  { name: '奧武山公園站', lat: 26.2121, lng: 127.6695, trackIdx: 3 },
  { name: '壺川站', lat: 26.2143, lng: 127.6745, trackIdx: 4 },
  { name: '旭橋站', lat: 26.2155, lng: 127.6778, trackIdx: 5 },
  { name: '縣廳前站', lat: 26.2145, lng: 127.6845, trackIdx: 7 },
  { name: '美榮橋站', lat: 26.2188, lng: 127.6989, trackIdx: 10 },
  { name: '牧志站', lat: 26.2165, lng: 127.6948, trackIdx: 9 },
  { name: '安里站', lat: 26.2168, lng: 127.7012, trackIdx: 10 },
  { name: '歌町站', lat: 26.2261, lng: 127.7010, trackIdx: 12 },
  { name: '古島站', lat: 26.2314, lng: 127.7068, trackIdx: 14 },
  { name: '市立病院前站', lat: 26.2286, lng: 127.7155, trackIdx: 16 },
  { name: '儀保站', lat: 26.2268, lng: 127.7196, trackIdx: 17 },
  { name: '首里站', lat: 26.2192, lng: 127.7254, trackIdx: 19 },
  { name: '石嶺站', lat: 26.2281, lng: 127.7346, trackIdx: 21 },
  { name: '經塚站', lat: 26.2366, lng: 127.7349, trackIdx: 23 },
  { name: '浦添前田站', lat: 26.2412, lng: 127.7368, trackIdx: 24 },
  { name: '日子浦西站', lat: 26.2454, lng: 127.7416, trackIdx: 25 }
];

// ==================== 3. 預設範例資料 ====================
const DEFAULT_DEMO_SPOTS = [
  {
    id: 'demo_tpe_rmq',
    name: '臺中國際機場',
    category: '交通',
    area: '台灣 · 臺中市 · 沙鹿區',
    lat: 24.2646,
    lng: 120.6210,
    estimated_duration: 120,
    business_hours: '✈️ 17:00-19:30 (+1h)',
    parking_info: '第一航廈國際線櫃檯 / 機場接送',
    must_buy: '護照正本, 網卡/eSIM, 行動電源(隨身)',
    description: '國際線建議起飛前 2 小時抵達辦理報到與行李托運。',
    assigned_day: '2027-02-17',
    sort_order: '1',
    status: 'scheduled'
  },
  {
    id: 'demo_oka_airport',
    name: '那霸空港',
    category: '交通',
    area: '日本 · 沖繩縣 · 那霸市',
    lat: 26.2064,
    lng: 127.6465,
    estimated_duration: 30,
    business_hours: '06:00 - 23:30',
    parking_info: '國際線航廈 2F 連通道步行至單軌「那霸空港站」',
    must_buy: '豬肉蛋飯糰(國內線1F), Suica/OKICA交通卡',
    description: '入境後沿連通道前往單軌那霸空港站搭乘 Yui Rail 前往市區。',
    assigned_day: '2027-02-17',
    sort_order: '2',
    status: 'scheduled'
  },
  {
    id: 'demo_hotel_1',
    name: '那霸久茂地巢穴酒店 (Nest Hotel Naha Kumoji)',
    category: '住宿',
    area: '日本 · 沖繩縣 · 那霸市',
    lat: 26.2166,
    lng: 127.6828,
    estimated_duration: 0,
    business_hours: 'Check-in 15:00 / Check-out 11:00',
    parking_info: '鄰近單軌美榮橋站步行約3分鐘 / 縣廳前站步行約6分鐘',
    must_buy: '訂房確認單, 護照(全員辦理入住)',
    description: '連住2晚：鄰近國際通與美榮橋站，首日抵達與第2天出發、返回樞紐，第3天退房換飯店。',
    assigned_day: '2027-02-17,2027-02-18',
    sort_order: '3,1',
    status: 'scheduled'
  },
  {
    id: 'demo_1',
    name: '港川外人住宅區',
    category: '景點',
    area: '日本 · 沖繩縣 · 浦添市',
    lat: 26.2564,
    lng: 127.7126,
    estimated_duration: 60,
    business_hours: '11:00 - 18:00',
    parking_info: '周邊投幣式停車場（建議搭公車或計程車前往）',
    must_buy: 'oHacorté 水果塔, ippe coppe 吐司',
    description: '美軍眷屬老宅改建的文青聚落，街道編號為美國州名。',
    assigned_day: '2027-02-18',
    sort_order: '3',
    status: 'scheduled'
  },
  {
    id: 'demo_2',
    name: 'oHacorté 港川店',
    category: '美食',
    area: '日本 · 沖繩縣 · 浦添市',
    lat: 26.2568,
    lng: 127.7121,
    estimated_duration: 60,
    business_hours: '11:30 - 19:00 (週二公休)',
    parking_info: '港川18號館店前2格車位',
    must_buy: '季節限定水果塔, 招牌檸檬塔, 鐵盒手工餅乾',
    description: '隱身於港川外人住宅區的鄉村風水果塔名店，建築極具文青感。',
    assigned_day: '2027-02-18',
    sort_order: '4',
    status: 'scheduled'
  },
  {
    id: 'demo_hotel_2',
    name: '那霸西酒店 (Naha-West Inn)',
    category: '住宿',
    area: '日本 · 沖繩縣 · 那霸市',
    lat: 26.2124,
    lng: 127.6736,
    estimated_duration: 0,
    business_hours: 'Check-in 15:00 / Check-out 10:00',
    parking_info: '飯店附設付費立體停車場 / 鄰近單軌旭橋站',
    must_buy: '本館與別館入住櫃檯確認',
    description: '連住3晚：第3天至第5天住宿據點，房間寬敞且鄰近波上宮與超市。',
    assigned_day: '2027-02-19,2027-02-20,2027-02-21',
    sort_order: '90,1,1',
    status: 'scheduled'
  },
  {
    id: 'demo_daruma',
    name: '西來院達摩寺',
    category: '景點',
    area: '日本 · 沖繩縣 · 那霸市',
    lat: 26.2179,
    lng: 127.7225,
    estimated_duration: 45,
    business_hours: '09:00 - 17:00',
    parking_info: '寺院前設有免費參拜停車位，鄰近首里城',
    must_buy: '達摩不倒翁御守',
    description: '參拜超可愛的迷你千本鳥居與達摩不倒翁，鄰近首里城。',
    assigned_day: 'pocket',
    sort_order: '99',
    status: 'pocket'
  },
  {
    id: 'demo_4',
    name: '暖暮拉麵 (牧志店)',
    category: '美食',
    area: '日本 · 沖繩縣 · 那霸市',
    lat: 26.2155,
    lng: 127.6885,
    estimated_duration: 60,
    business_hours: '10:00 - 02:00',
    parking_info: '國際通周邊付費停車場',
    must_buy: '烈火拉麵, 煎餃, 溫泉蛋飯',
    description: '九州拉麵總選舉第一名，建議避開尖峰用餐時段。',
    assigned_day: 'pocket',
    sort_order: '99',
    status: 'pocket'
  }
];

// ==================== 4. 國內 / 國外三層級行政區解析與動態聯動控制 ====================
function isSpotInTaiwanCoords(spot) {
  const lat = parseFloat(spot.lat);
  const lng = parseFloat(spot.lng);
  if (isNaN(lat) || isNaN(lng)) return null;
  return lat >= 21.8 && lat <= 26.5 && lng >= 118.0 && lng <= 122.2;
}

function parseAreaHierarchy(spotOrArea) {
  const isObj = typeof spotOrArea === 'object' && spotOrArea !== null;
  const raw = String(isObj ? (spotOrArea.area || '') : (spotOrArea || '')).trim();
  const coordTaiwan = isObj ? isSpotInTaiwanCoords(spotOrArea) : null;

  if (!raw || raw === '未分類') {
    const scope = coordTaiwan === true ? 'domestic' : (coordTaiwan === false ? 'international' : 'unknown');
    return { scope, l1: '未分類', l2: '未分類', full: '未分類', shortBadge: '未分類' };
  }

  const rawParts = raw.split(/\s*[·・\/|-]\s*/).map(p => p.trim()).filter(Boolean);
  // 去除連續重複的行政區名稱（例如「沖繩縣 · 沖繩縣」自動去重為「沖繩縣」）
  const parts = rawParts.filter((item, idx) => idx === 0 || item !== rawParts[idx - 1]);

  const isDomesticText = /^(台灣|臺灣|台灣出發)/.test(parts[0]) ||
    /^(臺北市|台北市|新北市|桃園市|臺中市|台中市|臺南市|台南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|臺東縣|台東縣|澎湖縣|金門縣|連江縣)/.test(parts[0]);

  const scope = isDomesticText ? 'domestic' : (coordTaiwan === true ? 'domestic' : 'international');

  if (scope === 'domestic') {
    const cleanParts = (parts[0] === '台灣' || parts[0] === '臺灣') ? parts.slice(1) : parts;
    const l1 = cleanParts[0] || '台灣其他';
    const l2 = cleanParts[1] || '其他區';
    const full = cleanParts.length >= 2 ? `台灣 · ${l1} · ${l2}` : `台灣 · ${l1}`;
    const shortBadge = cleanParts.length >= 2 ? `${l1} · ${l2}` : l1;
    return { scope: 'domestic', l1, l2, full, shortBadge };
  }

  if (parts.length >= 3) {
    const l1 = `${parts[0]} · ${parts[1]}`;
    const l2 = parts[2];
    return { scope: 'international', l1, l2, full: `${parts[0]} · ${parts[1]} · ${parts[2]}`, shortBadge: `${parts[1]} · ${parts[2]}` };
  }
  if (parts.length === 2) {
    return { scope: 'international', l1: parts[0], l2: parts[1], full: `${parts[0]} · ${parts[1]}`, shortBadge: `${parts[0]} · ${parts[1]}` };
  }
  return { scope: 'international', l1: parts[0], l2: '其他區', full: parts[0], shortBadge: parts[0] };
}

function renderDynamicAreaControls() {
  let domesticCount = 0;
  let internationalCount = 0;
  const l1Counts = {};
  const l2MapByL1 = {};
  const allFullAreas = new Set();

  spots.forEach(s => {
    const h = parseAreaHierarchy(s);
    allFullAreas.add(h.full);
    if (h.scope === 'domestic') domesticCount++;
    else if (h.scope === 'international') internationalCount++;

    if (currentRegionScopeFilter !== 'all' && h.scope !== currentRegionScopeFilter) return;

    l1Counts[h.l1] = (l1Counts[h.l1] || 0) + 1;
    if (!l2MapByL1[h.l1]) l2MapByL1[h.l1] = {};
    l2MapByL1[h.l1][h.l2] = (l2MapByL1[h.l1][h.l2] || 0) + 1;
  });

  const elAll = document.getElementById('scope-count-all');
  const elDom = document.getElementById('scope-count-domestic');
  const elIntl = document.getElementById('scope-count-international');
  if (elAll) elAll.textContent = spots.length;
  if (elDom) elDom.textContent = domesticCount;
  if (elIntl) elIntl.textContent = internationalCount;

  const l1Sel = document.getElementById('filter-region-l1');
  const l2Sel = document.getElementById('filter-region-l2');
  const datalistEl = document.getElementById('area-suggestions-list');

  if (l1Sel) {
    const l1DefaultLabel = currentRegionScopeFilter === 'domestic'
      ? '全部台灣縣市'
      : (currentRegionScopeFilter === 'international' ? '全部國家 / 地區' : '全部縣市 / 國家');
    const sortedL1 = Object.keys(l1Counts).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    l1Sel.innerHTML = `<option value="全部">${l1DefaultLabel}</option>` +
      sortedL1.map(l1 => `<option value="${l1}">${l1} (${l1Counts[l1]})</option>`).join('');
    if ([...l1Sel.options].some(o => o.value === currentRegionL1Filter)) {
      l1Sel.value = currentRegionL1Filter;
    } else {
      currentRegionL1Filter = '全部';
      l1Sel.value = '全部';
    }
  }

  if (l2Sel) {
    const targetL2Counts = {};
    if (currentRegionL1Filter === '全部') {
      Object.values(l2MapByL1).forEach(subObj => {
        Object.entries(subObj).forEach(([k, cnt]) => {
          targetL2Counts[k] = (targetL2Counts[k] || 0) + cnt;
        });
      });
    } else if (l2MapByL1[currentRegionL1Filter]) {
      Object.assign(targetL2Counts, l2MapByL1[currentRegionL1Filter]);
    }
    const l2DefaultLabel = currentRegionScopeFilter === 'domestic' ? '全部鄉鎮市區' : '全部城市 / 町村';
    const sortedL2 = Object.keys(targetL2Counts).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    l2Sel.innerHTML = `<option value="全部">${l2DefaultLabel}</option>` +
      sortedL2.map(l2 => `<option value="${l2}">${l2} (${targetL2Counts[l2]})</option>`).join('');
    if ([...l2Sel.options].some(o => o.value === currentRegionL2Filter)) {
      l2Sel.value = currentRegionL2Filter;
    } else {
      currentRegionL2Filter = '全部';
      l2Sel.value = '全部';
    }
  }

  if (datalistEl) {
    datalistEl.innerHTML = [...allFullAreas].sort().map(a => `<option value="${a}">`).join('');
  }
}

function setFilterRegionScope(scope) {
  currentRegionScopeFilter = scope;
  currentRegionL1Filter = '全部';
  currentRegionL2Filter = '全部';

  const keys = ['all', 'domestic', 'international'];
  document.querySelectorAll('.scope-btn').forEach((btn, idx) => {
    const active = keys[idx] === scope;
    btn.className = active
      ? 'scope-btn py-1 rounded-md text-[11px] font-bold bg-white text-ai-indigo shadow-2xs transition'
      : 'scope-btn py-1 rounded-md text-[11px] font-medium text-slate-600 hover:text-ink-dark transition';
  });

  renderDynamicAreaControls();
  renderAll();
}

function handleRegionL1Change(val) {
  currentRegionL1Filter = val;
  currentRegionL2Filter = '全部';
  renderDynamicAreaControls();
  renderAll();
}

function handleRegionL2Change(val) {
  currentRegionL2Filter = val;
  renderAll();
}

// ==================== 5. 本機儲存與初始化 ====================
function loadLocalState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      appConfig = { ...appConfig, ...(parsed.appConfig || {}) };
      spots = Array.isArray(parsed.spots) && parsed.spots.length > 0 ? parsed.spots : [...DEFAULT_DEMO_SPOTS];
      dayStartTimes = parsed.dayStartTimes || {};
      legModeOverrides = parsed.legModeOverrides || {};
    } catch (e) {
      spots = [...DEFAULT_DEMO_SPOTS];
    }
  } else {
    spots = [...DEFAULT_DEMO_SPOTS];
  }

  document.getElementById('setting-gas-url').value = appConfig.gasUrl || '';
  document.getElementById('setting-trip-title').value = appConfig.tripTitle;
  document.getElementById('setting-start-date').value = appConfig.startDate;
  document.getElementById('setting-end-date').value = appConfig.endDate;
  document.getElementById('header-trip-title').textContent = appConfig.tripTitle;

  const days = getDateRangeArray(appConfig.startDate, appConfig.endDate);
  document.getElementById('header-trip-dates').textContent = `${appConfig.startDate} ~ ${appConfig.endDate} (${days.length}天${Math.max(0, days.length - 1)}夜)`;

  renderDynamicAreaControls();
  updateSyncBadge();
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    appConfig,
    spots,
    dayStartTimes,
    legModeOverrides
  }));
}

function saveSettings() {
  appConfig.gasUrl = document.getElementById('setting-gas-url').value.trim();
  appConfig.tripTitle = document.getElementById('setting-trip-title').value.trim() || '我的旅遊規劃';
  appConfig.startDate = document.getElementById('setting-start-date').value;
  appConfig.endDate = document.getElementById('setting-end-date').value;

  saveLocalState();
  loadLocalState();
  renderAll();
  closeModal('modal-settings');
  updateSyncBadge();

  if (appConfig.gasUrl) {
    fetch(appConfig.gasUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_config',
        config: {
          trip_title: appConfig.tripTitle,
          start_date: appConfig.startDate,
          end_date: appConfig.endDate,
          day_start_times: JSON.stringify(dayStartTimes)
        }
      })
    }).catch(err => console.error('設定同步失敗', err));
    syncFromCloud();
  } else {
    showToast('已更新行程設定（本機模式）');
  }
}

function importPresetHubs(regionKey) {
  const presets = regionKey === 'taiwan' ? [
    {
      name: '臺中國際機場',
      category: '交通',
      area: '台灣 · 臺中市 · 沙鹿區',
      lat: 24.2646, lng: 120.6210,
      estimated_duration: 120,
      business_hours: '✈️ 17:00-19:30 (+1h)',
      parking_info: '第一航廈國際線報到櫃檯',
      must_buy: '護照, 網卡/eSIM, 行動電源',
      description: '中台灣國際線出發樞紐，建議起飛前 2 小時抵達報到。'
    },
    {
      name: '桃園國際機場 (第一航廈)',
      category: '交通',
      area: '台灣 · 桃園市 · 大園區',
      lat: 25.0815, lng: 121.2368,
      estimated_duration: 150,
      business_hours: '✈️ 09:00-11:30 (+1h)',
      parking_info: '機場捷運 A12 站 / 航廈接送區',
      must_buy: '護照, 登機證, 外幣現鈔',
      description: '主要國際航班出發樞紐，建議起飛前 2.5 小時抵達。'
    },
    {
      name: '高鐵台中站',
      category: '交通',
      area: '台灣 · 臺中市 · 烏日區',
      lat: 24.1121, lng: 120.6157,
      estimated_duration: 20,
      business_hours: '06:00 - 24:00',
      parking_info: '台鐵新烏日站共構 / 客運轉運站',
      must_buy: '高鐵車票',
      description: '南北高速鐵路轉乘樞紐，可接駁前往桃園機場或各地。'
    }
  ] : [
    {
      name: '那霸空港',
      category: '交通',
      area: '日本 · 沖繩縣 · 那霸市',
      lat: 26.2064, lng: 127.6465,
      estimated_duration: 30,
      business_hours: '06:00 - 23:30',
      parking_info: '2F 連通道直通單軌「那霸空港站」',
      must_buy: '豬肉蛋飯糰(國內線1F), 單軌一日券',
      description: '沖繩門戶機場，出關後可搭乘單軌電車或機場利木津巴士。'
    },
    {
      name: '縣廳前站 (單軌電車)',
      category: '交通',
      area: '日本 · 沖繩縣 · 那霸市',
      lat: 26.2145, lng: 127.6845,
      estimated_duration: 15,
      business_hours: '05:30 - 23:30',
      parking_info: '國際通西側入口 / 久茂地百貨旁',
      must_buy: 'OKICA / Suica',
      description: '國際通入口與多線市區、中北部高速巴士重要轉乘站。'
    },
    {
      name: '那霸巴士總站 (旭橋站)',
      category: '交通',
      area: '日本 · 沖繩縣 · 那霸市',
      lat: 26.2155, lng: 127.6778,
      estimated_duration: 20,
      business_hours: '06:00 - 22:30',
      parking_info: '單軌旭橋站直結 (Opa 商場 1F)',
      must_buy: '沖繩巴士周遊券 / 120號公車',
      description: '前往美國村、讀谷村、名護及沖繩中北部的主要公車發車總站。'
    }
  ];

  let addedCount = 0;
  presets.forEach((p, idx) => {
    if (!spots.some(s => s.name === p.name)) {
      const newSpot = {
        id: `hub_${Date.now()}_${idx}`,
        ...p,
        assigned_day: 'pocket',
        sort_order: '99',
        status: 'pocket'
      };
      spots.unshift(newSpot);
      addedCount++;
      if (appConfig.gasUrl) {
        fetch(appConfig.gasUrl, {
          method: 'POST',
          body: JSON.stringify({ action: 'add_spot', spot: newSpot })
        }).catch(() => {});
      }
    }
  });

  saveLocalState();
  renderDynamicAreaControls();
  renderAll();
  showToast(addedCount > 0 ? `✅ 已匯入 ${addedCount} 個常用交通樞紐！` : '常用交通樞紐皆已存在於資料庫中');
}

document.addEventListener('DOMContentLoaded', () => {
  loadLocalState();
  initMap();
  initResizer();
  renderAll();
  if (appConfig.gasUrl) {
    syncFromCloud();
  }
});
