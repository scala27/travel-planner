import {
  KANJI_TO_TRADITIONAL_MAP,
  WALK_THRESHOLD_KM,
  LUGGAGE_WALK_THRESHOLD_KM,
  WALK_SPEED_KMH,
  LUGGAGE_WALK_SPEED_KMH,
  YUI_RAIL_STATIONS
} from './config.js';

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

// 依真實步速換算步行分鐘數（不依賴 OSRM 汽車時速）
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
    return `${meters} 公尺`;
  }
  return `${val.toFixed(1)} 公里`;
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

// 尋找距離指定座標最近的沖繩都市單軌電車（Yui Rail）車站
export function findNearestYuiRailStation(lat, lng, maxKm = 1.25) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || lat === 0) return null;
  let bestIdx = -1;
  let bestDist = Infinity;
  YUI_RAIL_STATIONS.forEach((st, idx) => {
    const d = haversineKm(lat, lng, st.lat, st.lng);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = idx;
    }
  });
  if (bestIdx >= 0 && bestDist <= maxKm) {
    return { index: bestIdx, station: YUI_RAIL_STATIONS[bestIdx], straightKm: bestDist };
  }
  return null;
}

// 組裝貼合真實單軌高架軌道的連續折線座標（含站間轉彎控制點）
function buildYuiRailTrackCoordinates(startIndex, endIndex) {
  const coords = [];
  if (startIndex === endIndex) {
    const st = YUI_RAIL_STATIONS[startIndex];
    return [[st.lat, st.lng]];
  }

  if (startIndex < endIndex) {
    coords.push([YUI_RAIL_STATIONS[startIndex].lat, YUI_RAIL_STATIONS[startIndex].lng]);
    for (let i = startIndex + 1; i <= endIndex; i++) {
      const st = YUI_RAIL_STATIONS[i];
      if (Array.isArray(st.viaPrev) && st.viaPrev.length > 0) {
        st.viaPrev.forEach(pt => coords.push([pt[0], pt[1]]));
      }
      coords.push([st.lat, st.lng]);
    }
  } else {
    coords.push([YUI_RAIL_STATIONS[startIndex].lat, YUI_RAIL_STATIONS[startIndex].lng]);
    for (let i = startIndex; i > endIndex; i--) {
      const currSt = YUI_RAIL_STATIONS[i];
      const prevSt = YUI_RAIL_STATIONS[i - 1];
      if (Array.isArray(currSt.viaPrev) && currSt.viaPrev.length > 0) {
        [...currSt.viaPrev].reverse().forEach(pt => coords.push([pt[0], pt[1]]));
      }
      coords.push([prevSt.lat, prevSt.lng]);
    }
  }
  return coords;
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
      const distanceKm = route.distance / 1000;
      const durationMin = mode === 'walk'
        ? computeWalkingMinutes(distanceKm, false)
        : Math.max(3, Math.round(route.duration / 60));

      const result = { latLngs, distanceKm, durationMin };
      osrmRouteCache[cacheKey] = result;
      return result;
    }
  } catch (e) {}

  const fallbackKm = haversineKm(lat1, lng1, lat2, lng2) * 1.25;
  return {
    latLngs: [[lat1, lng1], [lat2, lng2]],
    distanceKm: fallbackKm,
    durationMin: mode === 'walk' ? computeWalkingMinutes(fallbackKm, false) : null
  };
}

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

// 優先嘗試「沖繩都市單軌電車（Yui Rail）」真實高架軌道與時刻表，若不在單軌沿線則自動切換為「公車站牌接駁＋步行」
export async function buildMultiModalTransitSegments(cardA, cardB, isHotelTransfer = false) {
  const railA = findNearestYuiRailStation(cardA.lat, cardA.lng, 1.25);
  const railB = findNearestYuiRailStation(cardB.lat, cardB.lng, 1.25);

  if (railA && railB && Math.abs(railA.index - railB.index) >= 2) {
    const [walk1, walk2] = await Promise.all([
      fetchRealRoadPath(cardA.lat, cardA.lng, railA.station.lat, railA.station.lng, 'walk'),
      fetchRealRoadPath(railB.station.lat, railB.station.lng, cardB.lat, cardB.lng, 'walk')
    ]);

    const railCoords = buildYuiRailTrackCoordinates(railA.index, railB.index);
    let railTrackKm = 0;
    for (let i = 1; i < railCoords.length; i++) {
      railTrackKm += haversineKm(railCoords[i - 1][0], railCoords[i - 1][1], railCoords[i][0], railCoords[i][1]);
    }

    const walk1Min = railA.straightKm < 0.12 ? 2 : computeWalkingMinutes(walk1.distanceKm, isHotelTransfer);
    const walk2Min = railB.straightKm < 0.12 ? 2 : computeWalkingMinutes(walk2.distanceKm, isHotelTransfer);
    const railRideMin = Math.abs(railB.station.cumMin - railA.station.cumMin);
    const waitAndGateMin = 3; // 單軌班距約 6-8 分鐘，平均候車緩衝 3 分鐘
    const totalKm = (walk1.distanceKm || 0) + railTrackKm + (walk2.distanceKm || 0);

    return {
      isMonorail: true,
      hasStopSplit: true,
      stopA: { lat: railA.station.lat, lng: railA.station.lng, name: railA.station.name },
      stopB: { lat: railB.station.lat, lng: railB.station.lng, name: railB.station.name },
      walk1Path: walk1.latLngs,
      ridePath: railCoords,
      walk2Path: walk2.latLngs,
      totalKm,
      totalMin: walk1Min + railRideMin + waitAndGateMin + walk2Min,
      transitDetailLabel: `🚝 單軌(${railA.station.name.replace('站', '')}→${railB.station.name.replace('站', '')}) + 🚶步行`
    };
  }

  // 非單軌沿線（例如北谷美國村、浦添 PARCO CITY）：搜尋最近公車站牌接駁＋步行
  const [stopA, stopB] = await Promise.all([
    fetchNearestTransitStop(cardA.lat, cardA.lng),
    fetchNearestTransitStop(cardB.lat, cardB.lng)
  ]);

  const directRoad = await fetchRealRoadPath(cardA.lat, cardA.lng, cardB.lat, cardB.lng, 'drive');

  if (stopA && stopB && haversineKm(stopA.lat, stopA.lng, stopB.lat, stopB.lng) > 0.35) {
    const [walk1, ride, walk2] = await Promise.all([
      fetchRealRoadPath(cardA.lat, cardA.lng, stopA.lat, stopA.lng, 'walk'),
      fetchRealRoadPath(stopA.lat, stopA.lng, stopB.lat, stopB.lng, 'drive'),
      fetchRealRoadPath(stopB.lat, stopB.lng, cardB.lat, cardB.lng, 'walk')
    ]);

    const totalKm = (walk1.distanceKm || 0) + (ride.distanceKm || 0) + (walk2.distanceKm || 0);
    const walk1Min = computeWalkingMinutes(walk1.distanceKm, isHotelTransfer);
    const walk2Min = computeWalkingMinutes(walk2.distanceKm, isHotelTransfer);
    const busRideMin = Math.max(6, Math.round((ride.durationMin || 10) * 1.45 + 7));

    return {
      isMonorail: false,
      hasStopSplit: true,
      stopA,
      stopB,
      walk1Path: walk1.latLngs,
      ridePath: ride.latLngs,
      walk2Path: walk2.latLngs,
      totalKm: totalKm || directRoad.distanceKm,
      totalMin: walk1Min + busRideMin + walk2Min,
      transitDetailLabel: '🚌 公車 + 🚶 步行'
    };
  }

  return {
    isMonorail: false,
    hasStopSplit: false,
    stopA: null,
    stopB: null,
    walk1Path: [],
    ridePath: directRoad.latLngs,
    walk2Path: [],
    totalKm: directRoad.distanceKm,
    totalMin: directRoad.durationMin ? Math.max(12, Math.round(directRoad.durationMin * 1.45 + 8)) : null,
    transitDetailLabel: '🚌 公車/大眾運輸'
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
