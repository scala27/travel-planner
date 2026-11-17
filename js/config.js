export const STORAGE_KEY = 'okinawa_card_planner_v2';

export const DEFAULT_SETTINGS = {
  tripTitle: '2027沖繩首發自由行',
  startDate: '2027-02-17',
  totalDays: 6,
  gasUrl: ''
};

// 智慧混搭自動判定為「步行」的最大距離門檻（公里）
export const WALK_THRESHOLD_KM = 1.2;

// 換宿移動（拖帶大型行李）自動判定為「步行」的最大距離門檻（公里）
export const LUGGAGE_WALK_THRESHOLD_KM = 0.5;

// 步行計算速度（公里/小時）：一般步行 4.5 km/h（約 13.3 分/km），拖行李 3.6 km/h（約 16.7 分/km）
export const WALK_SPEED_KMH = 4.5;
export const LUGGAGE_WALK_SPEED_KMH = 3.6;

// 沖繩都市單軌電車（Yui Rail）全線 19 站精確座標、累計分鐘數與高密度貼合軌道折點（viaPrev）
export const YUI_RAIL_STATIONS = [
  { name: '那霸機場站', lat: 26.2065, lng: 127.6523, cumMin: 0, viaPrev: [] },
  {
    name: '赤嶺站', lat: 26.1932, lng: 127.6606, cumMin: 3,
    viaPrev: [
      [26.2054, 127.6523], [26.2036, 127.6531], [26.2013, 127.6548],
      [26.1987, 127.6562], [26.1961, 127.6568], [26.1941, 127.6574], [26.1932, 127.6589]
    ]
  },
  {
    name: '小祿站', lat: 26.1965, lng: 127.6670, cumMin: 5,
    viaPrev: [[26.1936, 127.6621], [26.1950, 127.6645]]
  },
  {
    name: '奧武山公園站', lat: 26.2008, lng: 127.6754, cumMin: 7,
    viaPrev: [[26.1979, 127.6696], [26.1993, 127.6725]]
  },
  {
    name: '壺川站', lat: 26.2059, lng: 127.6787, cumMin: 9,
    viaPrev: [[26.2019, 127.6776], [26.2035, 127.6791], [26.2049, 127.6792]]
  },
  {
    name: '旭橋站', lat: 26.2119, lng: 127.6754, cumMin: 11,
    viaPrev: [[26.2072, 127.6776], [26.2091, 127.6761], [26.2106, 127.6753]]
  },
  {
    name: '縣廳前站', lat: 26.2144, lng: 127.6793, cumMin: 13,
    viaPrev: [[26.2128, 127.6765], [26.2136, 127.6779]]
  },
  {
    name: '美榮橋站', lat: 26.2194, lng: 127.6844, cumMin: 15,
    viaPrev: [[26.2158, 127.6808], [26.2176, 127.6826]]
  },
  {
    name: '牧志站', lat: 26.2173, lng: 127.6924, cumMin: 17,
    viaPrev: [[26.2190, 127.6864], [26.2175, 127.6889], [26.2170, 127.6908]]
  },
  {
    name: '安里站', lat: 26.2167, lng: 127.6958, cumMin: 19,
    viaPrev: [[26.2169, 127.6941]]
  },
  {
    name: 'おもろまち站', lat: 26.2229, lng: 127.6986, cumMin: 21,
    viaPrev: [[26.2182, 127.6968], [26.2205, 127.6978]]
  },
  {
    name: '古島站', lat: 26.2307, lng: 127.7031, cumMin: 23,
    viaPrev: [[26.2255, 127.6996], [26.2282, 127.7013]]
  },
  {
    name: '市立醫院前站', lat: 26.2275, lng: 127.7103, cumMin: 25,
    viaPrev: [[26.2303, 127.7052], [26.2290, 127.7077]]
  },
  {
    name: '儀保站', lat: 26.2248, lng: 127.7192, cumMin: 27,
    viaPrev: [[26.2265, 127.7131], [26.2257, 127.7162]]
  },
  {
    name: '首里站', lat: 26.2192, lng: 127.7254, cumMin: 29,
    viaPrev: [[26.2232, 127.7215], [26.2212, 127.7235]]
  },
  {
    name: '石嶺站', lat: 26.2286, lng: 127.7289, cumMin: 31,
    viaPrev: [[26.2218, 127.7269], [26.2252, 127.7282]]
  },
  {
    name: '經塚站', lat: 26.2367, lng: 127.7284, cumMin: 34,
    viaPrev: [[26.2315, 127.7291], [26.2342, 127.7287]]
  },
  {
    name: '浦添前田站', lat: 26.2442, lng: 127.7317, cumMin: 36,
    viaPrev: [[26.2394, 127.7293], [26.2420, 127.7306]]
  },
  {
    name: 'てだこ浦西站', lat: 26.2419, lng: 127.7418, cumMin: 38,
    viaPrev: [[26.2443, 127.7348], [26.2432, 127.7385]]
  }
];

// 多日同顯模式下的每日專屬路線色系
export const DAY_ROUTE_COLORS = [
  '#2563eb', // Day 1: 寶藍色
  '#7c3aed', // Day 2: 亮紫色
  '#059669', // Day 3: 翠綠色
  '#ea580c', // Day 4: 暖橘色
  '#db2777', // Day 5: 玫紅色
  '#0891b2', // Day 6: 湖水青
  '#4f46e5', // Day 7: 靛藍色
  '#ca8a04'  // Day 8: 琥珀金
];

export const PRESET_DISTRICTS = [
  '沖繩縣・那霸市', '沖繩縣・浦添市', '沖繩縣・宜野灣市', '沖繩縣・北谷町',
  '沖繩縣・嘉手納町', '沖繩縣・讀谷村', '沖繩縣・恩納村', '沖繩縣・名護市',
  '沖繩縣・本部町', '沖繩縣・今歸仁村', '沖繩縣・豐見城市', '沖繩縣・糸滿市',
  '沖繩縣・南城市', '沖繩縣・八重瀨町', '沖繩縣・西原町', '沖繩縣・沖繩市',
  '臺中市・清水區', '臺中市・西屯區', '桃園市・大園區', '臺北市・松山區'
];

export const KANJI_TO_TRADITIONAL_MAP = [
  ['沖縄県', '沖繩縣'], ['沖縄市', '沖繩市'], ['沖縄', '沖繩'],
  ['那覇市', '那霸市'], ['那覇', '那霸'],
  ['豊見城市', '豐見城市'], ['豊見城', '豐見城'],
  ['糸満市', '糸滿市'], ['糸満', '糸滿'],
  ['読谷村', '讀谷村'], ['読谷', '讀谷'],
  ['今帰仁村', '今歸仁村'], ['今帰仁', '今歸仁'],
  ['国頭村', '國頭村'], ['国頭郡', '國頭郡'],
  ['中頭郡', '中頭郡'], ['島尻郡', '島尻郡'],
  ['宜野湾市', '宜野灣市'], ['宜野湾', '宜野灣'],
  ['与那原町', '與那原町'], ['与那原', '與那原'],
  ['八重瀬町', '八重瀨町'], ['八重瀬', '八重瀨'],
  ['うるま市', '宇流麻市'],
  ['台北市', '臺北市'], ['台中市', '臺中市'], ['台南市', '臺南市'], ['台東縣', '臺東縣'],
  ['県', '縣'], ['市', '市'], ['区', '區'], ['駅', '站']
];

export const CATEGORY_LIST = ['景點', '美食', '購物', '住宿', '機場', '交通', '體驗'];

export const CATEGORY_META = {
  '景點': { color: '#10b981', pinChar: '景', emoji: '🏞️', badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  '美食': { color: '#f59e0b', pinChar: '美', emoji: '🍜', badgeBg: 'bg-amber-50 text-amber-700 border-amber-200' },
  '購物': { color: '#2563eb', pinChar: '購', emoji: '🛍️', badgeBg: 'bg-blue-50 text-blue-700 border-blue-200' },
  '住宿': { color: '#9333ea', pinChar: '宿', emoji: '🏨', badgeBg: 'bg-purple-50 text-purple-700 border-purple-200' },
  '機場': { color: '#0284c7', pinChar: '機', emoji: '✈️', badgeBg: 'bg-sky-50 text-sky-700 border-sky-200' },
  '交通': { color: '#475569', pinChar: '交', emoji: '🚆', badgeBg: 'bg-slate-100 text-slate-700 border-slate-300' },
  '體驗': { color: '#e11d48', pinChar: '驗', emoji: '🎡', badgeBg: 'bg-rose-50 text-rose-700 border-rose-200' }
};

export function isTransportOrAirport(category) {
  return category === '機場' || category === '交通';
}
