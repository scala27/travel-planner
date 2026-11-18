export const STORAGE_KEY = 'okinawa_card_planner_v14';

// 步行門檻與步速參數（一般步行 1.2 km、拖行李換宿 0.5 km）
export const WALK_THRESHOLD_KM = 1.2;
export const LUGGAGE_WALK_THRESHOLD_KM = 0.5;
export const WALK_SPEED_KMH = 4.2;
export const LUGGAGE_WALK_SPEED_KMH = 3.0;

// 沖繩都市單軌電車（Yui Rail）全線 19 站座標、真實軌道折點與累計行車時間
export const YUI_RAIL_STATIONS = [
  { name: '那霸機場站', lat: 26.2064, lng: 127.6523, cumMin: 0, viaPrev: [] },
  { name: '赤嶺站', lat: 26.1932, lng: 127.6606, cumMin: 3, viaPrev: [[26.2008, 127.6552], [26.1965, 127.6584]] },
  { name: '小祿站', lat: 26.1963, lng: 127.6672, cumMin: 5, viaPrev: [[26.1945, 127.6641]] },
  { name: '奧武山公園站', lat: 26.2007, lng: 127.6752, cumMin: 7, viaPrev: [[26.1984, 127.6713]] },
  { name: '壺川站', lat: 26.2059, lng: 127.6793, cumMin: 9, viaPrev: [[26.2036, 127.6780]] },
  { name: '旭橋站', lat: 26.2121, lng: 127.6754, cumMin: 11, viaPrev: [[26.2088, 127.6786], [26.2106, 127.6766]] },
  { name: '縣廳前站', lat: 26.2145, lng: 127.6793, cumMin: 13, viaPrev: [[26.2136, 127.6769]] },
  { name: '美榮橋站', lat: 26.2192, lng: 127.6844, cumMin: 15, viaPrev: [[26.2169, 127.6819]] },
  { name: '牧志站', lat: 26.2173, lng: 127.6924, cumMin: 17, viaPrev: [[26.2188, 127.6884]] },
  { name: '安里站', lat: 26.2167, lng: 127.6958, cumMin: 18, viaPrev: [] },
  { name: '歌町站', lat: 26.2229, lng: 127.6986, cumMin: 20, viaPrev: [[26.2198, 127.6974]] },
  { name: '古島站', lat: 26.2307, lng: 127.7031, cumMin: 22, viaPrev: [[26.2268, 127.7009]] },
  { name: '市立病院前站', lat: 26.2275, lng: 127.7101, cumMin: 24, viaPrev: [[26.2295, 127.7068]] },
  { name: '儀保站', lat: 26.2246, lng: 127.7192, cumMin: 26, viaPrev: [[26.2260, 127.7148]] },
  { name: '首里站', lat: 26.2192, lng: 127.7255, cumMin: 28, viaPrev: [[26.2221, 127.7226]] },
  { name: '石嶺站', lat: 26.2269, lng: 127.7314, cumMin: 30, viaPrev: [[26.2231, 127.7286]] },
  { name: '經塚站', lat: 26.2356, lng: 127.7289, cumMin: 32, viaPrev: [[26.2314, 127.7305]] },
  { name: '浦添前田站', lat: 26.2442, lng: 127.7317, cumMin: 35, viaPrev: [[26.2401, 127.7302]] },
  { name: 'てだこ浦西站', lat: 26.2418, lng: 127.7418, cumMin: 37, viaPrev: [[26.2435, 127.7368]] }
];

export const DEFAULT_SETTINGS = {
  tripTitle: '2027沖繩首發自由行',
  startDate: '2027-02-17',
  totalDays: 6,
  gasUrl: ''
};

export const PRESET_DISTRICTS = [
  '沖繩縣・那霸市',
  '沖繩縣・浦添市',
  '沖繩縣・宜野灣市',
  '沖繩縣・北谷町',
  '沖繩縣・讀谷村',
  '沖繩縣・恩納村',
  '沖繩縣・名護市',
  '沖繩縣・本部町',
  '沖繩縣・今歸仁村',
  '沖繩縣・國頭村',
  '沖繩縣・沖繩市',
  '沖繩縣・宇流麻市',
  '沖繩縣・豐見城市',
  '沖繩縣・糸滿市',
  '沖繩縣・南城市',
  '沖繩縣・八重瀨町',
  '沖繩縣・與那原町',
  '沖繩縣・西原町',
  '臺灣・臺中市',
  '臺灣・臺北市',
  '臺灣・桃園市'
];

export const CATEGORY_LIST = ['景點', '美食', '購物', '住宿', '機場', '交通', '體驗'];

// 「體驗」採用日系青磁莫蘭迪灰綠 (#4f7b74)，呈現文青獨立書店、選物雜貨與手作工藝質感
export const CATEGORY_META = {
  '景點': { emoji: '🏞️', pinChar: '景', color: '#16a34a', badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  '美食': { emoji: '🍜', pinChar: '美', color: '#f59e0b', badgeBg: 'bg-amber-50 text-amber-700 border-amber-200' },
  '購物': { emoji: '🛍️', pinChar: '購', color: '#2563eb', badgeBg: 'bg-blue-50 text-blue-700 border-blue-200' },
  '住宿': { emoji: '🏨', pinChar: '宿', color: '#9333ea', badgeBg: 'bg-purple-50 text-purple-700 border-purple-200' },
  '機場': { emoji: '✈️', pinChar: '機', color: '#0284c7', badgeBg: 'bg-sky-50 text-sky-700 border-sky-200' },
  '交通': { emoji: '🚆', pinChar: '行', color: '#475569', badgeBg: 'bg-slate-100 text-slate-700 border-slate-300' },
  '體驗': { emoji: '🎡', pinChar: '驗', color: '#4f7b74', badgeBg: 'bg-teal-50/90 text-teal-800 border-teal-300' }
};

export const DAY_ROUTE_COLORS = [
  '#2563eb', // Day 1 藍
  '#7c3aed', // Day 2 紫
  '#059669', // Day 3 綠
  '#ea580c', // Day 4 橘
  '#db2777', // Day 5 桃紅
  '#0891b2'  // Day 6 青
];

export const KANJI_TO_TRADITIONAL_MAP = [
  ['沖縄県', '沖繩縣'], ['沖縄市', '沖繩市'], ['沖縄', '沖繩'],
  ['那覇市', '那霸市'], ['那覇', '那霸'],
  ['豊見城市', '豐見城市'], ['豊見城', '豐見城'],
  ['糸満市', '糸滿市'], ['糸満', '糸滿'],
  ['読谷村', '讀谷村'], ['読谷', '讀谷'],
  ['国頭村', '國頭村'], ['国頭', '國頭'],
  ['うるま市', '宇流麻市'], ['うるま', '宇流麻'],
  ['与那原町', '與那原町'], ['与那原', '與那原'],
  ['今帰仁村', '今歸仁村'], ['今帰仁', '今歸仁'],
  ['台中市', '臺中市'], ['台北市', '臺北市'], ['台南市', '臺南市'], ['台東縣', '臺東縣'],
  ['台湾', '台灣']
];

export function isTransportOrAirport(category) {
  return category === '機場' || category === '交通';
}
