const KANJI_TO_TRADITIONAL_MAP = [
  ['台', '臺'],
  ['駅', '站'],
  ['県', '縣'],
  ['浜', '濱'],
  ['広', '廣'],
  ['沢', '澤'],
  ['辺', '邊']
];

const WALK_THRESHOLD_KM = 1.2;
const LUGGAGE_WALK_THRESHOLD_KM = 0.6;
const WALK_SPEED_KMH = 4.2;
const LUGGAGE_WALK_SPEED_KMH = 3.2;
const YUI_RAIL_STATIONS = [];

const roadRouteCache = {};
const transitStopCache = {};
let transitDbPromise = null;
let cachedTransitDb = null;

const EXACT_SHAPE_CACHE_KEY = 'okinawa_exact_osm_shapes_v1';

// 從 OpenStreetMap 抓取單軌電車真實高密度軌道頂點，並用單向向量接龍法串成單一連續中心線
async function fetchAndStitchExactMonorailShape(stations) {
  try {
    const cachedRaw = localStorage.getItem(EXACT_SHAPE_CACHE_KEY);
    if (cachedRaw) {
      const parsed = JSON.parse(cachedRaw);
      if (Array.isArray(parsed) && parsed.length > 150) {
        return parsed;
      }
    }
  } catch (e) {}

  try {
    const query = `[out:json][timeout:10];way["railway"="monorail"](26.185,127.645,26.255,127.755);out geom;`;
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.elements) || data.elements.length === 0) return null;

    const ways = data.elements
      .filter(el => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2)
      .map(el => el.geometry.map(pt => [pt.lat, pt.lon]));

    if (ways.length === 0 || !Array.isArray(stations) || stations.length < 2) return null;

    const startPt = [stations[0].lat, stations[0].lng]; // 那霸機場站
    const endPt = [stations[stations.length - 1].lat, stations[stations.length - 1].lng]; // てだこ浦西站

    // 1. 找出距離那霸機場站最近的一段軌道作為起點
    let bestWayIdx = -1;
    let bestReverse = false;
    let minStartDist = Infinity;

    ways.forEach((pts, idx) => {
      const dFirst = haversineKm(startPt[0], startPt[1], pts[0][0], pts[0][1]);
      const dLast = haversineKm(startPt[0], startPt[1], pts[pts.length - 1][0], pts[pts.length - 1][1]);
      if (dFirst < minStartDist) {
        minStartDist = dFirst;
        bestWayIdx = idx;
        bestReverse = false;
      }
      if (dLast < minStartDist) {
        minStartDist = dLast;
        bestWayIdx = idx;
        bestReverse = true;
      }
    });

    if (bestWayIdx < 0) return null;

    const used = new Set([bestWayIdx]);
    const stitched = bestReverse ? [...ways[bestWayIdx]].reverse() : [...ways[bestWayIdx]];

    // 2. 沿前進向量接龍下一段軌道（排除對向平行雙軌的折返段）
    let guard = 0;
    while (guard++ < ways.length + 5) {
      const tail = stitched[stitched.length - 1];
      const prev = stitched[Math.max(0, stitched.length - 2)];
      const dirLat = tail[0] - prev[0];
      const dirLng = tail[1] - prev[1];

      if (haversineKm(tail[0], tail[1], endPt[0], endPt[1]) < 0.08) {
        break;
      }

      let nextIdx = -1;
      let nextReverse = false;
      let bestScore = Infinity;

      ways.forEach((pts, idx) => {
        if (used.has(idx)) return;
        const p0 = pts[0];
        const p1 = pts[pts.length - 1];

        const d0 = haversineKm(tail[0], tail[1], p0[0], p0[1]);
        if (d0 < 0.12) {
          const nextStep = pts[1] || p1;
          const vLat = nextStep[0] - p0[0];
          const vLng = nextStep[1] - p0[1];
          const dot = dirLat * vLat + dirLng * vLng;
          if (dot >= -1e-9 && d0 < bestScore) {
            bestScore = d0;
            nextIdx = idx;
            nextReverse = false;
          }
        }

        const d1 = haversineKm(tail[0], tail[1], p1[0], p1[1]);
        if (d1 < 0.12) {
          const nextStep = pts[pts.length - 2] || p0;
          const vLat = nextStep[0] - p1[0];
          const vLng = nextStep[1] - p1[1];
          const dot = dirLat * vLat + dirLng * vLng;
          if (dot >= -1e-9 && d1 < bestScore) {
            bestScore = d1;
            nextIdx = idx;
            nextReverse = true;
          }
        }
      });

      if (nextIdx < 0) break;
      used.add(nextIdx);
      const seg = nextReverse ? [...ways[nextIdx]].reverse() : [...ways[nextIdx]];
      stitched.push(...seg.slice(1));
    }

    if (stitched.length > 150) {
      try {
        localStorage.setItem(EXACT_SHAPE_CACHE_KEY, JSON.stringify(stitched));
      } catch (e) {}
      return stitched;
    }
  } catch (e) {}

  return null;
}

// 讀取靜態 GTFS 大眾運輸路線庫（data/okinawa_transit.json）並自動升級高密度軌道幾何
async function getOkinawaTransitDatabase() {
  if (cachedTransitDb) return cachedTransitDb;
  if (!transitDbPromise) {
    transitDbPromise = (async () => {
      let db = null;
      try {
        const res = await fetch('./data/okinawa_transit.json');
        if (res.ok) {
          db = await res.json();
        }
      } catch (e) {}

      if (!db) {
        db = {
          yui_rail: {
            id: 'yui_rail',
            name: '沖繩都市單軌電車 (Yui Rail)',
            color: '#dc2626',
            waitMin: 3,
            stations: YUI_RAIL_STATIONS.map((st, idx) => ({
              id: `YR${idx + 1}`, name: st.name, lat: st.lat, lng: st.lng, cumMin: st.cumMin })), shape: YUI_RAIL_STATIONS.flatMap(st => [...(st.viaPrev \vert{}\vert{} []), [st.lat, st.lng]]) }, buses: [] }; }  // 若目前單軌 shape 點數較疏（小於 150 點），自動從底圖抓取真實高密度軌道並快取 if (db.yui_rail && Array.isArray(db.yui_rail.stations) && (!db.yui_rail.shape \vert{}\vert{} db.yui_rail.shape.length < 150)) { const exactShape = await fetchAndStitchExactMonorailShape(db.yui_rail.stations); if (exactShape && exactShape.length >= 150) { db.yui_rail.shape = exactShape; } }  cachedTransitDb = db; return db; })(); } return transitDbPromise; }  // 解碼 Valhalla 精度 6（1e6）的 Polyline 折線 function decodeValhallaPolyline6(encoded) { if (!encoded \vert{}\vert{} typeof encoded !== 'string') return []; const coords = []; let index = 0; let lat = 0; let lng = 0; const factor = 1e6;  while (index < encoded.length) { let b; let shift = 0; let result = 0; do { b = encoded.charCodeAt(index++) - 63; result \vert{}= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20); const dlat = (result & 1) ? ~(result >> 1) : (result >> 1); lat += dlat;  shift = 0; result = 0; do { b = encoded.charCodeAt(index++) - 63; result \vert{}= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20); const dlng = (result & 1) ? ~(result >> 1) : (result >> 1); lng += dlng;  coords.push([lat / factor, lng / factor]); } return coords; }  // 利用 Turf.js 將上、下車站吸附到連續路線折線上並精準切片（[lat, lng] 與 [lng, lat] 自動轉換） function sliceTransitShapeWithTurf(shapeLatLngs, stopA, stopB) { if (!Array.isArray(shapeLatLngs) \vert{}\vert{} shapeLatLngs.length < 2) { return { coords: [[stopA.lat, stopA.lng], [stopB.lat, stopB.lng]], km: haversineKm(stopA.lat, stopA.lng, stopB.lat, stopB.lng) }; }  if (typeof window !== 'undefined' && window.turf) { try { const lineCoordsLngLat = shapeLatLngs.map(([lat, lng]) => [lng, lat]); const line = window.turf.lineString(lineCoordsLngLat); const ptStart = window.turf.point([stopA.lng, stopA.lat]); const ptEnd = window.turf.point([stopB.lng, stopB.lat]);  const snappedStart = window.turf.nearestPointOnLine(line, ptStart); const snappedEnd = window.turf.nearestPointOnLine(line, ptEnd); const sliced = window.turf.lineSlice(snappedStart, snappedEnd, line);  if (sliced && sliced.geometry && Array.isArray(sliced.geometry.coordinates) && sliced.geometry.coordinates.length >= 2) { const slicedLatLngs = sliced.geometry.coordinates.map(([lng, lat]) => [lat, lng]); const sliceKm = window.turf.length(sliced, { units: 'kilometers' }); return { coords: slicedLatLngs, km: Math.max(0.1, sliceKm) }; } } catch (e) {} }  // 若 Turf.js 尚未載入的備援切片 let bestIdxA = 0; let bestIdxB = shapeLatLngs.length - 1; let minDA = Infinity; let minDB = Infinity; shapeLatLngs.forEach(([lat, lng], idx) => { const dA = haversineKm(stopA.lat, stopA.lng, lat, lng); if (dA < minDA) { minDA = dA; bestIdxA = idx; } const dB = haversineKm(stopB.lat, stopB.lng, lat, lng); if (dB < minDB) { minDB = dB; bestIdxB = idx; } });  const sub = bestIdxA <= bestIdxB ? shapeLatLngs.slice(bestIdxA, bestIdxB + 1) : shapeLatLngs.slice(bestIdxB, bestIdxA + 1).reverse();  let km = 0; for (let i = 1; i < sub.length; i++) { km += haversineKm(sub[i - 1][0], sub[i - 1][1], sub[i][0], sub[i][1]); } return { coords: sub.length >= 2 ? sub : [[stopA.lat, stopA.lng], [stopB.lat, stopB.lng]], km: km \vert{}\vert{} haversineKm(stopA.lat, stopA.lng, stopB.lat, stopB.lng) }; }  export function normalizeTraditionalText(str) { let result = String(str \vert{}\vert{} '').trim(); for (const [src, target] of KANJI_TO_TRADITIONAL_MAP) { result = result.split(src).join(target); } return result; }  export function normalizeAdministrativeDistrict(rawArea, country = '') { let text = normalizeTraditionalText(rawArea); if (!text) return country \vert{}\vert{} '未分類';  text = text .replace(/^日本\s*[・\/-]\s*/, '') .replace(/^台灣\s*[・\/-]\s*/, '') .replace(/^臺灣\s*[・\/-]\s*/, '') .trim();  if (text.includes('/')) { const segments = text .split('/') .map(s => normalizeTraditionalText(s).trim()) .filter(Boolean);  const uniqueSegments = segments.filter((seg, idx) => { return !segments.some((other, oIdx) => oIdx !== idx && other.length > seg.length && other.includes(seg)); });  text = uniqueSegments.length > 0 ? uniqueSegments[uniqueSegments.length - 1] : segments[segments.length - 1]; }  text = text.replace(/\s*[•·．]\s*/g, '・'); text = text.replace(/^(沖繩縣)(?!・)(.+)$/, '$1・$2'); text = text.replace(/^(臺北市\vert{}新北市\vert{}桃園市\vert{}臺中市\vert{}臺南市\vert{}高雄市\vert{}基隆市\vert{}新竹市\vert{}嘉義市\vert{}新竹縣\vert{}苗栗縣\vert{}彰化縣\vert{}南投縣\vert{}雲林縣\vert{}嘉義縣\vert{}屏東縣\vert{}宜蘭縣\vert{}花蓮縣\vert{}臺東縣\vert{}澎湖縣\vert{}金門縣\vert{}連江縣)(?!・)(.+)$/, '$1・$2');  const dotParts = text.split('・').map(s => s.trim()).filter(Boolean); const dedupedDotParts = dotParts.filter((part, idx) => idx === 0 \vert{}\vert{} part !== dotParts[idx - 1]); text = dedupedDotParts.join('・');  return text \vert{}\vert{} country \vert{}\vert{} '未分類'; }  export function parseNominatimAddress(addr = {}) { let country = addr.country \vert{}\vert{} '日本'; if (country.includes('臺灣') \vert{}\vert{} country.includes('台灣') \vert{}\vert{} addr.country_code === 'tw') country = '台灣'; if (addr.country_code === 'jp' \vert{}\vert{} country.includes('日本')) country = '日本';  const pref = normalizeTraditionalText(addr.state \vert{}\vert{} addr.province \vert{}\vert{} addr.county \vert{}\vert{} ''); const city = normalizeTraditionalText(addr.city \vert{}\vert{} addr.town \vert{}\vert{} addr.village \vert{}\vert{} addr.municipality \vert{}\vert{} addr.suburb \vert{}\vert{} ''); const combined = [pref, city].filter(Boolean).join('・') \vert{}\vert{} country; const district = normalizeAdministrativeDistrict(combined, country); return { country, district }; }  export async function geocodePlaceName(query, countryHint = '') { const cleaned = String(query).replace(/[\(（][^\)）]*[\)）]/g, '').trim(); const queriesToTry = [ countryHint ? `${countryHint} ${cleaned}` : cleaned, cleaned, query ].filter((v, i, arr) => v && arr.indexOf(v) === i);  for (const q of queriesToTry) { try { const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'zh-TW,ja,en' } });
      const data = await res.json();
      if (data && data.length > 0) {
        const item = data[0];
        const { country, district } = parseNominatimAddress(item.address);
        return { lat: parseFloat(item.lat), lng: parseFloat(item.lon), country, district };
      }
    } catch (e) {}
  }
  return null;
}

export async function reverseGeocodeCoords(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'zh-TW,ja,en' } });
    const data = await res.json();
    if (data && data.address) {
      return parseNominatimAddress(data.address);
    }
  } catch (e) {}
  return null;
}

export function extractCoordsFromText(text) {
  if (!text) return null;
  const atMatch = text.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };

  const d34Match = text.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (d34Match) return { lat: parseFloat(d34Match[1]), lng: parseFloat(d34Match[2]) };

  const pairMatch = text.match(/(-?\d{1,3}\.\d{3,})\s*[,，\s]\s*(-?\d{1,3}\.\d{3,})/);
  if (pairMatch) return { lat: parseFloat(pairMatch[1]), lng: parseFloat(pairMatch[2]) };

  return null;
}

export function extractTitleFromInputLine(line) {
  let clean = line.trim();
  if (!clean) return '';
  if (clean.startsWith('http')) {
    try {
      const u = new URL(clean);
      const q = u.searchParams.get('q') || u.searchParams.get('query');
      if (q && !/^-?\d+\.\d+,/.test(q)) return decodeURIComponent(q).replace(/\+/g, ' ');
      const placeMatch = u.pathname.match(/\/place\/([^/]+)/);
      if (placeMatch && placeMatch[1]) {
        return decodeURIComponent(placeMatch[1]).replace(/\+/g, ' ');
      }
    } catch (e) {}
  }
  return clean;
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every(v => Number.isFinite(Number(v)) && Number(v) !== 0)) return 0;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeWalkingMinutes(km, hasLuggage = false) {
  const val = Number(km) || 0;
  if (val <= 0) return 2;
  const speed = hasLuggage ? LUGGAGE_WALK_SPEED_KMH : WALK_SPEED_KMH;
  return Math.max(2, Math.round((val / speed) * 60));
}

export function formatDistanceLabel(km) {
  const val = Number(km) || 0;
  if (val <= 0) return '';
  if (val < 1) {
    const meters = Math.max(10, Math.round((val * 1000) / 10) * 10);
    return `${meters} 公尺`; } return `${val.toFixed(1)} 公里`;
}

export function getTransitModeDisplay(mode, transitDetailLabel = '') {
  if (mode === 'flight') return '✈️ 航空飛航';
  if (mode === 'walk') return '🚶 步行';
  if (mode === 'taxi') return '🚕 計程車';
  if (mode === 'drive') return '🚗 自駕道路';
  if (transitDetailLabel) return transitDetailLabel;
  return '🚆 單軌/公車';
}

export function isFlightLeg(cardA, cardB, km) {
  if (!cardA || !cardB) return false;
  const isBothAirport = cardA.category === '機場' && cardB.category === '機場';
  const hasAirportKeyword = /機場|空港|Airport/i.test(cardA.title) && /機場|空港|Airport/i.test(cardB.title);
  const isCrossCountry = cardA.country && cardB.country && cardA.country !== cardB.country;
  return isBothAirport || hasAirportKeyword || isCrossCountry || km > 150;
}

export function isHotelTransferLeg(cardA, cardB) {
  if (!cardA || !cardB) return false;
  return cardA.category === '住宿' && cardB.category === '住宿' && cardA.id !== cardB.id;
}

function findNearestStopInList(stops, lat, lng, maxKm) {
  let bestIdx = -1;
  let bestDist = Infinity;
  stops.forEach((st, idx) => {
    const d = haversineKm(lat, lng, st.lat, st.lng);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = idx;
    }
  });
  if (bestIdx >= 0 && bestDist <= maxKm) {
    return { index: bestIdx, stop: stops[bestIdx], straightKm: bestDist };
  }
  return null;
}

export function resolveLegModeAndEstimate(cardA, cardB, manualMode = 'auto') {
  if (!cardA || !cardB) return { mode: 'transit', min: 20, km: 0, isHotelTransfer: false };
  const straightKm = haversineKm(cardA.lat, cardA.lng, cardB.lat, cardB.lng);
  const isHotelTransfer = isHotelTransferLeg(cardA, cardB);

  if (isFlightLeg(cardA, cardB, straightKm)) {
    const airMin = straightKm > 0 ? Math.max(60, Math.round(straightKm / 8.2)) : 90;
    return { mode: 'flight', min: airMin, km: straightKm, isHotelTransfer };
  }

  const approxRoadKm = straightKm * 1.25;
  const profile = document.getElementById('transitProfileSelect')?.value || 'smart';
  const walkLimitKm = isHotelTransfer ? LUGGAGE_WALK_THRESHOLD_KM : WALK_THRESHOLD_KM;

  let resolvedMode = manualMode;
  if (!resolvedMode || resolvedMode === 'auto') {
    if (profile === 'walk') {
      resolvedMode = 'walk';
    } else if (profile === 'taxi') {
      resolvedMode = 'taxi';
    } else if (profile === 'drive') {
      resolvedMode = 'drive';
    } else if (profile === 'transit') {
      resolvedMode = 'transit';
    } else {
      resolvedMode = (straightKm > 0 && approxRoadKm <= walkLimitKm) ? 'walk' : 'transit';
    }
  }

  if (straightKm === 0) {
    return { mode: resolvedMode, min: resolvedMode === 'walk' ? 5 : 15, km: 0, isHotelTransfer };
  }

  if (resolvedMode === 'walk') {
    return {
      mode: 'walk',
      min: computeWalkingMinutes(approxRoadKm, isHotelTransfer),
      km: approxRoadKm,
      isHotelTransfer
    };
  }
  if (resolvedMode === 'taxi') {
    return {
      mode: 'taxi',
      min: Math.max(5, Math.round(approxRoadKm * 2.2 + 3)),
      km: approxRoadKm,
      isHotelTransfer
    };
  }
  if (resolvedMode === 'drive') {
    return {
      mode: 'drive',
      min: Math.max(8, Math.round(approxRoadKm * 2.2 + 8)),
      km: approxRoadKm,
      isHotelTransfer
    };
  }
  return {
    mode: 'transit',
    min: Math.max(12, Math.round(approxRoadKm * 3.5 + 10)),
    km: approxRoadKm,
    isHotelTransfer
  };
}

// 優先呼叫 Valhalla 開源多模式路網（支援真實步行階梯與步道），若連線逾時則無縫退回 OSRM
export async function fetchRealRoadPath(lat1, lng1, lat2, lng2, mode = 'drive') {
  const isWalk = mode === 'walk';
  const cacheKey = `${isWalk ? 'ped' : 'auto'}_${Number(lat1).toFixed(5)},${Number(lng1).toFixed(5)}_${Number(lat2).toFixed(5)},${Number(lng2).toFixed(5)}`; if (roadRouteCache[cacheKey]) { return roadRouteCache[cacheKey]; }  // 1. 嘗試 Valhalla API (valhalla1.openstreetmap.de) try { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 4500); const valhallaRes = await fetch('https://valhalla1.openstreetmap.de/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ locations: [ { lat: Number(lat1), lon: Number(lng1) }, { lat: Number(lat2), lon: Number(lng2) } ], costing: isWalk ? 'pedestrian' : 'auto', units: 'kilometers' }) }); clearTimeout(timer);  if (valhallaRes.ok) { const vData = await valhallaRes.json(); const leg = vData?.trip?.legs?.[0]; const summary = vData?.trip?.summary; if (leg && leg.shape && summary) { const latLngs = decodeValhallaPolyline6(leg.shape); const distanceKm = Number(summary.length) \vert{}\vert{} haversineKm(lat1, lng1, lat2, lng2); const durationMin = isWalk ? Math.max(2, Math.round((Number(summary.time) \vert{}\vert{} 0) / 60)) : Math.max(3, Math.round((Number(summary.time) \vert{}\vert{} 0) / 60));  if (latLngs.length >= 2) { const result = { latLngs, distanceKm, durationMin, engine: 'valhalla' }; roadRouteCache[cacheKey] = result; return result; } } } } catch (e) {}  // 2. 備援：OSRM 路網幾何與真實步速換算 try { const osrmProfile = isWalk ? 'foot' : 'driving'; const url = `https://router.project-osrm.org/route/v1/${osrmProfile}/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const latLngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      const distanceKm = route.distance / 1000;
      const durationMin = isWalk
        ? computeWalkingMinutes(distanceKm, false)
        : Math.max(3, Math.round(route.duration / 60));

      const result = { latLngs, distanceKm, durationMin, engine: 'osrm' };
      roadRouteCache[cacheKey] = result;
      return result;
    }
  } catch (e) {}

  const fallbackKm = haversineKm(lat1, lng1, lat2, lng2) * 1.25;
  return {
    latLngs: [[lat1, lng1], [lat2, lng2]],
    distanceKm: fallbackKm,
    durationMin: isWalk ? computeWalkingMinutes(fallbackKm, false) : null,
    engine: 'fallback'
  };
}

export async function fetchNearestTransitStop(lat, lng) {
  const key = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
  if (transitStopCache[key] !== undefined) {
    return transitStopCache[key];
  }

  try {
    const query = `[out:json][timeout:6];(node(around:650,${lat},${lng})["highway"="bus_stop"];node(around:800,${lat},${lng})["railway"="station"];);out body 5;`;
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query
    });
    const data = await res.json();
    if (data && Array.isArray(data.elements) && data.elements.length > 0) {
      let best = null;
      let bestDist = Infinity;
      for (const el of data.elements) {
        const d = haversineKm(lat, lng, el.lat, el.lon);
        if (d < bestDist) {
          bestDist = d;
          best = {
            lat: el.lat,
            lng: el.lon,
            name: el.tags?.['name:zh'] || el.tags?.name || '公車站牌',
            walkKm: d
          };
        }
      }
      transitStopCache[key] = best;
      return best;
    }
  } catch (e) {}

  transitStopCache[key] = null;
  return null;
}

// 結合 GTFS 路線庫、Turf.js 精準切片與 Valhalla 兩端步行的多模式大眾運輸規劃
export async function buildMultiModalTransitSegments(cardA, cardB, isHotelTransfer = false) {
  const db = await getOkinawaTransitDatabase();

  // 第一順位：沖繩都市單軌電車（Yui Rail）
  if (db && db.yui_rail && Array.isArray(db.yui_rail.stations)) {
    const railA = findNearestStopInList(db.yui_rail.stations, cardA.lat, cardA.lng, 1.25);
    const railB = findNearestStopInList(db.yui_rail.stations, cardB.lat, cardB.lng, 1.25);

    if (railA && railB && Math.abs(railA.index - railB.index) >= 1) {
      const [walk1, walk2] = await Promise.all([
        fetchRealRoadPath(cardA.lat, cardA.lng, railA.stop.lat, railA.stop.lng, 'walk'),
        fetchRealRoadPath(railB.stop.lat, railB.stop.lng, cardB.lat, cardB.lng, 'walk')
      ]);

      const slicedRail = sliceTransitShapeWithTurf(db.yui_rail.shape, railA.stop, railB.stop);
      const walk1Min = railA.straightKm < 0.12 ? 2 : computeWalkingMinutes(walk1.distanceKm, isHotelTransfer);
      const walk2Min = railB.straightKm < 0.12 ? 2 : computeWalkingMinutes(walk2.distanceKm, isHotelTransfer);
      const railRideMin = Math.abs(railB.stop.cumMin - railA.stop.cumMin);
      const waitMin = Number(db.yui_rail.waitMin) || 3;
      const totalKm = (walk1.distanceKm || 0) + slicedRail.km + (walk2.distanceKm || 0);

      return {
        isMonorail: true,
        routeColor: db.yui_rail.color || '#dc2626',
        hasStopSplit: true,
        stopA: railA.stop,
        stopB: railB.stop,
        walk1Path: walk1.latLngs,
        ridePath: slicedRail.coords,
        walk2Path: walk2.latLngs,
        totalKm,
        totalMin: walk1Min + railRideMin + waitMin + walk2Min,
        transitDetailLabel: `🚝 單軌(${railA.stop.name.replace('站', '')}→${railB.stop.name.replace('站', '')}) + 🚶步行`
      };
    }
  }

  // 第二順位：沖繩主要觀光幹線公車（GTFS 路線比對與道路真實折線貼合）
  if (db && Array.isArray(db.buses) && db.buses.length > 0) {
    let bestBusMatch = null;
    let bestWalkSum = Infinity;

    for (const bus of db.buses) {
      const stA = findNearestStopInList(bus.stops, cardA.lat, cardA.lng, 1.35);
      const stB = findNearestStopInList(bus.stops, cardB.lat, cardB.lng, 1.35);
      if (stA && stB && stA.index !== stB.index) {
        const walkSum = stA.straightKm + stB.straightKm;
        if (walkSum < bestWalkSum) {
          bestWalkSum = walkSum;
          bestBusMatch = { bus, stA, stB };
        }
      }
    }

    if (bestBusMatch) {
      const { bus, stA, stB } = bestBusMatch;
      const [walk1, busRoad, walk2] = await Promise.all([
        fetchRealRoadPath(cardA.lat, cardA.lng, stA.stop.lat, stA.stop.lng, 'walk'),
        fetchRealRoadPath(stA.stop.lat, stA.stop.lng, stB.stop.lat, stB.stop.lng, 'drive'),
        fetchRealRoadPath(stB.stop.lat, stB.stop.lng, cardB.lat, cardB.lng, 'walk')
      ]);

      const useRoadPath = busRoad && Array.isArray(busRoad.latLngs) && busRoad.latLngs.length >= 4;
      const slicedBus = useRoadPath
        ? { coords: busRoad.latLngs, km: busRoad.distanceKm }
        : sliceTransitShapeWithTurf(bus.shape, stA.stop, stB.stop);

      const walk1Min = stA.straightKm < 0.1 ? 2 : computeWalkingMinutes(walk1.distanceKm, isHotelTransfer);
      const walk2Min = stB.straightKm < 0.1 ? 2 : computeWalkingMinutes(walk2.distanceKm, isHotelTransfer);
      const busRideMin = Math.max(5, Math.abs(stB.stop.cumMin - stA.stop.cumMin));
      const waitMin = Number(bus.waitMin) || 7;
      const totalKm = (walk1.distanceKm || 0) + slicedBus.km + (walk2.distanceKm || 0);

      const shortStopA = stA.stop.name.replace(/（.*?）|\(.*?\)/g, '');
      const shortStopB = stB.stop.name.replace(/（.*?）|\(.*?\)/g, '');

      return {
        isMonorail: false,
        routeColor: bus.color || '#7c3aed',
        hasStopSplit: true,
        stopA: stA.stop,
        stopB: stB.stop,
        walk1Path: walk1.latLngs,
        ridePath: slicedBus.coords,
        walk2Path: walk2.latLngs,
        totalKm,
        totalMin: walk1Min + busRideMin + waitMin + walk2Min,
        transitDetailLabel: `🚌 ${bus.routeNo}(${shortStopA
