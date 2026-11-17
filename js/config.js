export const STORAGE_KEY = 'okinawa_card_planner_v2';

export const DEFAULT_SETTINGS = {
  tripTitle: '2027沖繩首發自由行',
  startDate: '2027-02-17',
  totalDays: 6,
  gasUrl: ''
};

// 智慧混搭自動判定為「步行」的最大距離門檻（公里）
export const WALK_THRESHOLD_KM = 1.2;

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
