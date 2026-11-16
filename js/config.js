// ==================== 全域狀態、動態區域與國內外交通樞紐定義 ====================
const STORAGE_KEY_SPOTS = 'global_travel_planner_spots_v2';
const STORAGE_KEY_CONFIG = 'global_travel_planner_config_v2';
const STORAGE_KEY_LEG_MODES = 'global_travel_planner_leg_modes_v2';
const STORAGE_KEY_DAY_STARTS = 'global_travel_planner_day_starts_v2';

// 向下相容讀取舊版 localStorage 資料
const LEGACY_STORAGE_KEY_SPOTS = 'okinawa_planner_spots_v1';
const LEGACY_STORAGE_KEY_CONFIG = 'okinawa_planner_config_v1';

const CATEGORY_THEME = {
  '景點': { hex: '#10B981', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', borderLeft: 'border-l-emerald-500' },
  '美食': { hex: '#F59E0B', badge: 'bg-amber-50 text-amber-700 border-amber-200', borderLeft: 'border-l-amber-500' },
  '購物': { hex: '#6366F1', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200', borderLeft: 'border-l-indigo-500' },
  '住宿': { hex: '#7E22CE', badge: 'bg-purple-100 text-purple-800 border-purple-300', borderLeft: 'border-l-purple-700' },
  '交通': { hex: '#0284C7', badge: 'bg-sky-50 text-sky-700 border-sky-200', borderLeft: 'border-l-sky-600' }
};

const MODE_SHORT_LABEL = {
  flight: '✈️ 跨海/國際航班',
  monorail: '🚝 單軌+步行',
  bus: '🚌 大眾運輸/客運',
  taxi: '🚕 計程車接駁',
  walking: '🚶 步行',
  driving: '🚗 自駕'
};

// 沖繩都市單軌電車 (Yui Rail) 地理圍欄高精度軌道點序列
const YUI_RAIL_TRACK = [
  { stationIdx: 0, name: '那霸空港站', lat: 26.2064, lng: 127.6522 },
  { stationIdx: null, lat: 26.2035, lng: 127.6524 },
  { stationIdx: null, lat: 26.1992, lng: 127.6540 },
  { stationIdx: null, lat: 26.1950, lng: 127.6568 },
  { stationIdx: 1, name: '赤嶺站', lat: 26.1932, lng: 127.6606 },
  { stationIdx: null, lat: 26.1945, lng: 127.6642 },
  { stationIdx: 2, name: '小祿站', lat: 26.1965, lng: 127.6669 },
  { stationIdx: null, lat: 26.1987, lng: 127.6712 },
  { stationIdx: 3, name: '奧武山公園站', lat: 26.2007, lng: 127.6754 },
  { stationIdx: null, lat: 26.2028, lng: 127.6788 },
  { stationIdx: 4, name: '壺川站', lat: 26.2059, lng: 127.6784 },
  { stationIdx: null, lat: 26.2095, lng: 127.6752 },
  { stationIdx: 5, name: '旭橋站', lat: 26.2121, lng: 127.6754 },
  { stationIdx: 6, name: '縣廳前站', lat: 26.2145, lng: 127.6793 },
  { stationIdx: 7, name: '美榮橋站', lat: 26.2192, lng: 127.6844 },
  { stationIdx: null, lat: 26.2198, lng: 127.6886 },
  { stationIdx: 8, name: '牧志站', lat: 26.2173, lng: 127.6926 },
  { stationIdx: 9, name: '安里站', lat: 26.2167, lng: 127.6957 },
  { stationIdx: null, lat: 26.2195, lng: 127.6975 },
  { stationIdx: 10, name: 'おもろまち站 (新都心)', lat: 26.2227, lng: 127.6986 },
  { stationIdx: null, lat: 26.2270, lng: 127.7008 },
  { stationIdx: 11, name: '古島站', lat: 26.2308, lng: 127.7031 },
  { stationIdx: 12, name: '市立病院前站', lat: 26.2273, lng: 127.7101 },
  { stationIdx: 13, name: '儀保站', lat: 26.2245, lng: 127.7192 },
  { stationIdx: 14, name: '首里站', lat: 26.2192, lng: 127.7255 },
  { stationIdx: 15, name: '石嶺站', lat: 26.2266, lng: 127.7302 },
  { stationIdx: 16, name: '經塚站', lat: 26.2367, lng: 127.7289 },
  { stationIdx: 17, name: '浦添前田站', lat: 26.2449, lng: 127.7317 },
  { stationIdx: 18, name: 'てだこ浦西站', lat: 26.2419, lng: 127.7422 }
];

const YUI_RAIL_STATIONS = YUI_RAIL_TRACK
  .map((pt, trackIdx) => ({ ...pt, trackIdx }))
  .filter(pt => pt.stationIdx !== null);

// 本國出發門戶樞紐
const PRESET_TAIWAN_HUBS = [
  { name: '臺中國際機場', category: '交通', area: '台灣出發', description: '中部國際出發門戶，建議起飛前 2 小時抵達辦理登機託運。', must_buy: '護照, 機票電子憑證, eSIM 確認', business_hours: '06:00-23:00', estimated_duration: 120, lat: 24.2647, lng: 120.6206 },
  { name: '臺灣桃園國際機場 第一航廈', category: '交通', area: '台灣出發', description: '桃園機場第一航廈國際線出發/入境大廳。', must_buy: '護照, Visit Japan Web QR Code', business_hours: '24小時', estimated_duration: 150, lat: 25.0815, lng: 121.2366 },
  { name: '臺灣桃園國際機場 第二航廈', category: '交通', area: '台灣出發', description: '桃園機場第二航廈國際線出發/入境大廳。', must_buy: '護照, Visit Japan Web QR Code', business_hours: '24小時', estimated_duration: 150, lat: 25.0777, lng: 121.2328 },
  { name: '高雄國際機場', category: '交通', area: '台灣出發', description: '南部國際出發門戶（小港機場），捷運紅線直達。', must_buy: '護照, 機票憑證', business_hours: '06:00-23:30', estimated_duration: 120, lat: 22.5771, lng: 120.3500 },
  { name: '高鐵台中站', category: '交通', area: '台灣出發', description: '中部高鐵與台鐵新烏日站轉乘樞紐，可轉乘機場快線公車或計程車往臺中機場。', must_buy: '高鐵車票', business_hours: '06:00-24:00', estimated_duration: 20, lat: 24.1121, lng: 120.6157 }
];

// 沖繩交通樞紐
const PRESET_OKINAWA_STATIONS = [
  { name: '那霸空港 (國際線/國內線航廈)', category: '交通', area: '那霸市區', description: '沖繩空中門戶，入境後步行至2樓連通道即可轉乘單軌電車或公車。', must_buy: 'OKICA交通卡 / 單軌一日券', business_hours: '06:00-23:30', estimated_duration: 45, lat: 26.2064, lng: 127.6522 },
  { name: '單軌 縣廳前站', category: '交通', area: '那霸市區', description: '國際通西側入口、久茂地飯店區與琉貿百貨轉乘樞紐。', must_buy: '往美國村/恩納村公車站牌', business_hours: '06:00-23:30', estimated_duration: 10, lat: 26.2145, lng: 127.6793 },
  { name: '單軌 旭橋站 (那霸巴士總站)', category: '交通', area: '那霸市區', description: '沖繩最大長途公車轉運總站，往中部美國村、北部名護/美麗海直達車起點。', must_buy: '高速巴士/利木津巴士乘車處', business_hours: '06:00-23:30', estimated_duration: 15, lat: 26.2121, lng: 127.6754 },
  { name: '單軌 美榮橋站', category: '交通', area: '那霸市區', description: '步行至久茂地/泊港最便捷車站，搭單軌往那霸空港約15分鐘。', must_buy: '', business_hours: '06:00-23:30', estimated_duration: 10, lat: 26.2192, lng: 127.6844 },
  { name: '單軌 牧志站', category: '交通', area: '那霸市區', description: '國際通東側中心站，步行可達第一牧志公設市場與壺屋通。', must_buy: '', business_hours: '06:00-23:30', estimated_duration: 10, lat: 26.2173, lng: 127.6926 },
  { name: '單軌 おもろまち站 (新都心)', category: '交通', area: '那霸市區', description: 'DFS免稅店、Main Place購物中心與大型租車營業所集中站。', must_buy: 'OTS/ORIX租車取車點', business_hours: '06:00-23:30', estimated_duration: 15, lat: 26.2227, lng: 127.6986 },
  { name: '單軌 首里站', category: '交通', area: '那霸市區', description: '前往首里城公園與金城町石疊道最近單軌站。', must_buy: '', business_hours: '06:00-23:30', estimated_duration: 10, lat: 26.2192, lng: 127.7255 },
  { name: '單軌 てだこ浦西站', category: '交通', area: '沖繩中部', description: '單軌電車終點站，設有大型轉乘停車場，可轉搭公車或計程車前往浦添PARCO CITY。', must_buy: '', business_hours: '06:00-23:30', estimated_duration: 10, lat: 26.2419, lng: 127.7422 }
];

let appConfig = {
  gasUrl: '',
  tripTitle: '2027沖繩首發自由行',
  startDate: '2027-02-17',
  endDate: '2027-02-22',
  tripAreas: '台灣出發, 那霸市區, 沖繩中部, 沖繩北部, 沖繩南部'
};

let uiState = {
  leftVisible: true,
  rightVisible: true,
  inboxExpanded: true,
  boardCompact: true,
  mapWidthPx: 410
};

const DEFAULT_SPOTS = [
  {
    id: 'spot_001',
    name: '臺中國際機場',
    category: '交通',
    area: '台灣出發',
    description: '星宇航空直飛沖繩那霸出發機場，建議起飛前 2 小時抵達辦理登機託運。',
    must_buy: '護照, 機票電子憑證, eSIM 確認',
    business_hours: '06:00-23:00',
    estimated_duration: 120,
    parking_info: '臺中市沙鹿區中航路一段168號',
    source_url: '',
    photo_url: '',
    status: 'pocket',
    assigned_day: 'pocket',
    sort_order: '1',
    lat: 24.2647,
    lng: 120.6206
  },
  {
    id: 'spot_002',
    name: '浦添 PARCO CITY',
    category: '購物',
    area: '沖繩中部',
    description: '沖繩最大海景購物中心之一，集結超過250家品牌與無敵西海岸海景。',
    must_buy: 'San-A 超市伴手禮, Uniqlo/GU 沖繩限定T恤, 敘敘苑燒肉',
    business_hours: '10:00-22:00 (全年無休)',
    estimated_duration: 180,
    parking_info: '附設大型免費立體停車場 (MapCode: 33 341 090*28)',
    source_url: '',
    photo_url: 'https://images.unsplash.com/photo-1542051841857-5f90071e7989?auto=format&fit=crop&w=600&q=80',
    status: 'pocket',
    assigned_day: 'pocket',
    sort_order: '2',
    lat: 26.261754,
    lng: 127.698180
  }
];

let spots = [];
let legModeOverrides = {};
let dayStartTimes = {};
let latestPlaceAddress = '';
let currentCategoryFilter = '全部';
let currentAreaFilter = '全部';
let currentDbStatusFilter = 'all';
let mapInstance = null;
let mapLayerGroup = null;
let routeRequestToken = 0;

function getTripAreasList() {
  const raw = String(appConfig.tripAreas || '台灣出發, 那霸市區, 沖繩中部, 沖繩北部, 沖繩南部');
  const arr = raw.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
  return arr.length > 0 ? arr : ['台灣出發', '目的地市區'];
}

function renderDynamicAreaControls() {
  const areas = getTripAreasList();

  // 1. 快速建卡區域選單
  const quickAreaSel = document.getElementById('quick-area');
  if (quickAreaSel) {
    const prevVal = quickAreaSel.value;
    quickAreaSel.innerHTML = areas.map(a => `<option value="${a}">📍 區域：${a}</option>`).join('');
    if (areas.includes(prevVal)) quickAreaSel.value = prevVal;
  }

  // 2. 卡片編輯視窗區域選單
  const fieldAreaSel = document.getElementById('field-area');
  if (fieldAreaSel) {
    const prevVal = fieldAreaSel.value;
    fieldAreaSel.innerHTML = areas.map(a => `<option value="${a}">${a}</option>`).join('');
    if (areas.includes(prevVal)) fieldAreaSel.value = prevVal;
  }

  // 3. 左側資料庫區域篩選按鈕列
  const areaFiltersEl = document.getElementById('area-filters');
  if (areaFiltersEl) {
    if (currentAreaFilter !== '全部' && !areas.includes(currentAreaFilter)) {
      currentAreaFilter = '全部';
    }
    const allBtnClass = currentAreaFilter === '全部'
      ? 'area-btn px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-medium shrink-0'
      : 'area-btn px-2 py-0.5 rounded text-slate-500 hover:bg-slate-100 shrink-0';

    const dynamicBtns = areas.map(a => {
      const cls = currentAreaFilter === a
        ? 'area-btn px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-medium shrink-0'
        : 'area-btn px-2 py-0.5 rounded text-slate-500 hover:bg-slate-100 shrink-0';
      return `<button onclick="setFilterArea('${a.replace(/'/g, "\\'")}')" class="${cls}">${a}</button>`;
    }).join('');

    areaFiltersEl.innerHTML = `<button onclick="setFilterArea('全部')" class="${allBtnClass}">全部區域</button>${dynamicBtns}`;
  }
}
