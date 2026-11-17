import { KANJI_TO_TRADITIONAL_MAP, WALK_THRESHOLD_KM } from './config.js';

const osrmRouteCache = {};
const transitStopCache = {};

export function normalizeTraditionalText(str) {
  let result = String(str || '').trim();
  for (const [src, target] of KANJI_TO_TRADITIONAL_MAP) {
    result = result.split(src).join(target);
  }
  return result;
}

export function normalizeAdministrativeDistrict(rawArea, country = '') {
  let text = normalizeTraditionalText(rawArea);
  if (!text) return country || '未分類';

  text = text
    .replace(/^日本\s*[・\/-]\s*/, '')
    .replace(/^台灣\s*[・\/-]\s*/, '')
    .replace(/^臺灣\s*[・\/-]\s*/, '')
    .trim();

  if (text.includes('/')) {
    const segments = text
      .split('/')
      .map(s => normalizeTraditionalText(s).trim())
      .filter(Boolean);

    const uniqueSegments = segments.filter((seg, idx) => {
      return !segments.some((other, oIdx) => oIdx !== idx && other.length > seg.length && other.includes(seg));
    });

    text = uniqueSegments.length > 0
      ? uniqueSegments[uniqueSegments.length - 1]
      : segments[segments.length - 1];
  }

  text = text.replace(/\s*[•·．]\s*/g, '・');
  text = text.replace(/^(沖繩縣)(?!・)(.+)$/, '$1・$2');
  text = text.replace(/^(臺北市|新北市|桃園市|臺中市|臺南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|臺東縣|澎湖縣|金門縣|連江縣)(?!・)(.+)$/, '$1・$2');

  const dotParts = text.split('・').map(s => s.trim()).filter(Boolean);
  const dedupedDotParts = dotParts.filter((part, idx) => idx === 0 || part !== dotParts[idx - 1]);
  text = dedupedDotParts.join('・');

  return text || country || '未分類';
}

export function parseNominatimAddress(addr = {}) {
  let country = addr.country || '日本';
  if (country.includes('臺灣') || country.includes('台灣') || addr.country_code === 'tw') country = '台灣';
  if (addr.country_code === 'jp' || country.includes('日本')) country = '日本';

  const pref = normalizeTraditionalText(addr.state || addr.province || addr.county || '');
  const city = normalizeTraditionalText(addr.city || addr.town || addr.village || addr.municipality || addr.suburb || '');
  const combined = [pref, city].filter(Boolean).join('・') || country;
  const district = normalizeAdministrativeDistrict(combined, country);
  return { country, district };
}

export async function geocodePlaceName(query, countryHint = '') {
  const cleaned = String(query).replace(/[\(（][^\)）]*[\)）]/g, '').trim();
  const queriesToTry = [
    countryHint ? `${countryHint} ${cleaned}` : cleaned,
    cleaned,
    query
  ].filter((v, i, arr) => v && arr.indexOf(v) === i);

  for (const q of queriesToTry) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(q)}`;
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

export function formatDistanceLabel(km) {
  const val = Number(km) || 0;
  if (val <= 0) return '';
  if (val < 1) {
    const meters = Math.max(10, Math.round((val * 1000) / 10) * 10);
    return `${meters} 公尺`;
  }
  return `${val.toFixed(1)} 公里`;
}

export function getTransitModeDisplay(mode, hasStopSplit = false) {
  if (mode === 'flight') return '✈️ 航空飛航';
  if (mode === 'walk') return '🚶 步行';
  if (mode === 'drive') return '🚗 自駕道路';
  return hasStopSplit ? '🚆 單軌/公車 + 🚶 步行' : '🚆 單軌/公車';
}

export function isFlightLeg(cardA, cardB, km) {
  if (!cardA || !cardB) return false;
  const isBothAirport = cardA.category === '機場' && cardB.category === '機場';
  const hasAirportKeyword = /機場|空港|Airport/i.test(cardA.title) && /機場|空港|Airport/i.test(cardB.title);
  const isCrossCountry = cardA.country && cardB.country && cardA.country !== cardB.country;
  return isBothAirport || hasAirportKeyword || isCrossCountry || km > 150;
}

// 統一判定兩點間的交通方式（支援手動覆蓋與「智慧混搭」1.2 km 步行自動判定）
export function resolveLegModeAndEstimate(cardA, cardB, manualMode = 'auto') {
  if (!cardA || !cardB) return { mode: 'transit', min: 20, km: 0 };
  const straightKm = haversineKm(cardA.lat, cardA.lng, cardB.lat, cardB.lng);

  if (isFlightLeg(cardA, cardB, straightKm)) {
    const airMin = straightKm > 0 ? Math.max(60, Math.round(straightKm / 8.2)) : 90;
    return { mode: 'flight', min: airMin, km: straightKm };
  }

  // 考慮實際道路曲折度（約 1.25 倍）判斷步行距離
  const approxRoadKm = straightKm * 1.25;
  const profile = document.getElementById('transitProfileSelect')?.value || 'smart';

  let resolvedMode = manualMode;
  if (!resolvedMode || resolvedMode === 'auto') {
    if (profile === 'walk') {
      resolvedMode = 'walk';
    } else if (profile === 'drive') {
      resolvedMode = 'drive';
    } else if (profile === 'transit') {
      resolvedMode = 'transit';
    } else {
      // 智慧混搭：1.2 公里以內自動切換為步行
      resolvedMode = (straightKm > 0 && approxRoadKm <= WALK_THRESHOLD_KM) ? 'walk' : 'transit';
    }
  }

  if (straightKm === 0) {
    return { mode: resolvedMode, min: resolvedMode === 'walk' ? 5 : 15, km: 0 };
  }

  if (resolvedMode === 'walk') {
    return {
      mode: 'walk',
      min: Math.max(2, Math.round(approxRoadKm * 13.5)),
      km: approxRoadKm
    };
  }
  if (resolvedMode === 'drive') {
    return {
      mode: 'drive',
      min: Math.max(5, Math.round(approxRoadKm * 2.1 + 4)),
      km: approxRoadKm
    };
  }
  return {
    mode: 'transit',
    min: Math.max(8, Math.round(approxRoadKm * 3.2 + 8)),
    km: approxRoadKm
  };
}

export async function fetchRealRoadPath(lat1, lng1, lat2, lng2, mode = 'drive') {
  const osrmProfile = mode === 'walk' ? 'foot' : 'driving';
  const cacheKey = `${osrmProfile}_${Number(lat1).toFixed(5)},${Number(lng1).toFixed(5)}_${Number(lat2).toFixed(5)},${Number(lng2).toFixed(5)}`;
  if (osrmRouteCache[cacheKey]) {
    return osrmRouteCache[cacheKey];
  }

  try {
    const url = `https://router.project-osrm.org/route/v1/${osrmProfile}/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const latLngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      const result = {
        latLngs,
        distanceKm: route.distance / 1000,
        durationMin: Math.max(2, Math.round(route.duration / 60))
      };
      osrmRouteCache[cacheKey] = result;
      return result;
    }
  } catch (e) {}

  return {
    latLngs: [[lat1, lng1], [lat2, lng2]],
    distanceKm: haversineKm(lat1, lng1, lat2, lng2) * 1.25,
    durationMin: null
  };
}

// 查詢距離指定座標最近的公車站牌或單軌車站（OpenStreetMap Overpass API）
export async function fetchNearestTransitStop(lat, lng) {
  const key = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
  if (transitStopCache[key] !== undefined) {
    return transitStopCache[key];
  }

  try {
    const query = `[out:json][timeout:6];(node(around:650,${lat},${lng})["highway"="bus_stop"];node(around:800,${lat},${lng})["railway"="station"];node(around:800,${lat},${lng})["station"="monorail"];);out body 5;`;
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
            name: el.tags?.['name:zh'] || el.tags?.name || (el.tags?.railway ? '單軌車站' : '公車站牌'),
            isRail: Boolean(el.tags?.railway || el.tags?.station),
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

// 建構「起點步行至站牌 → 大眾運輸乘車 → 下車站牌步行至終點」分段路徑
export async function buildMultiModalTransitSegments(cardA, cardB) {
  const [stopA, stopB] = await Promise.all([
    fetchNearestTransitStop(cardA.lat, cardA.lng),
    fetchNearestTransitStop(cardB.lat, cardB.lng)
  ]);

  const directRoad = await fetchRealRoadPath(cardA.lat, cardA.lng, cardB.lat, cardB.lng, 'drive');

  // 若兩端皆找到不同站牌，且站牌間距離大於 300 公尺，則拆分為三段路徑
  if (stopA && stopB && haversineKm(stopA.lat, stopA.lng, stopB.lat, stopB.lng) > 0.3) {
    const [walk1, ride, walk2] = await Promise.all([
      fetchRealRoadPath(cardA.lat, cardA.lng, stopA.lat, stopA.lng, 'walk'),
      fetchRealRoadPath(stopA.lat, stopA.lng, stopB.lat, stopB.lng, 'drive'),
      fetchRealRoadPath(stopB.lat, stopB.lng, cardB.lat, cardB.lng, 'walk')
    ]);

    const totalKm = (walk1.distanceKm || 0) + (ride.distanceKm || 0) + (walk2.distanceKm || 0);
    const walk1Min = walk1.durationMin || Math.max(1, Math.round((walk1.distanceKm || 0) * 13.5));
    const walk2Min = walk2.durationMin || Math.max(1, Math.round((walk2.distanceKm || 0) * 13.5));
    const rideMin = Math.max(5, Math.round((ride.durationMin || 8) * 1.25 + 4));

    return {
      hasStopSplit: true,
      stopA,
      stopB,
      walk1Path: walk1.latLngs,
      ridePath: ride.latLngs,
      walk2Path: walk2.latLngs,
      totalKm: totalKm || directRoad.distanceKm,
      totalMin: walk1Min + rideMin + walk2Min,
      walkKm: (walk1.distanceKm || 0) + (walk2.distanceKm || 0)
    };
  }

  return {
    hasStopSplit: false,
    stopA: null,
    stopB: null,
    walk1Path: [],
    ridePath: directRoad.latLngs,
    walk2Path: [],
    totalKm: directRoad.distanceKm,
    totalMin: directRoad.durationMin ? Math.max(8, Math.round(directRoad.durationMin * 1.25 + 5)) : null,
    walkKm: 0
  };
}

export function buildCurvedFlightArc(lat1, lng1, lat2, lng2) {
  const pts = [];
  const steps = 36;
  const midLat = (lat1 + lat2) / 2;
  const midLng = (lng1 + lng2) / 2;
  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  const ctrlLat = midLat - dLng * 0.14;
  const ctrlLng = midLng + dLat * 0.14;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lat = (1 - t) * (1 - t) * lat1 + 2 * (1 - t) * t * ctrlLat + t * t * lat2;
    const lng = (1 - t) * (1 - t) * lng1 + 2 * (1 - t) * t * ctrlLng + t * t * lng2;
    pts.push([lat, lng]);
  }
  return pts;
}
