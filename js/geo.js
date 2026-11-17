import { KANJI_TO_TRADITIONAL_MAP } from './config.js';

const osrmRouteCache = {};

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

export function isFlightLeg(cardA, cardB, km) {
  if (!cardA || !cardB) return false;
  const isBothAirport = cardA.category === '機場' && cardB.category === '機場';
  const hasAirportKeyword = /機場|空港|Airport/i.test(cardA.title) && /機場|空港|Airport/i.test(cardB.title);
  const isCrossCountry = cardA.country && cardB.country && cardA.country !== cardB.country;
  return isBothAirport || hasAirportKeyword || isCrossCountry || km > 150;
}

export function estimateTransit(cardA, cardB) {
  if (!cardA || !cardB) return { mode: 'transit', min: 20, km: 0 };
  const km = haversineKm(cardA.lat, cardA.lng, cardB.lat, cardB.lng);

  if (isFlightLeg(cardA, cardB, km)) {
    const airMin = km > 0 ? Math.max(60, Math.round(km / 8.2)) : 90;
    return { mode: 'flight', min: airMin, km };
  }

  const profile = document.getElementById('transitProfileSelect')?.value || 'smart';
  if (km === 0) return { mode: 'transit', min: 20, km: 0 };

  if (profile === 'walk' || (profile === 'smart' && km <= 1.1)) {
    return { mode: 'walk', min: Math.max(5, Math.round(km * 14)), km };
  }
  if (profile === 'drive') {
    return { mode: 'drive', min: Math.max(8, Math.round(km * 2.2 + 5)), km };
  }
  return { mode: 'transit', min: Math.max(10, Math.round(km * 3.5 + 10)), km };
}

export async function fetchRealRoadPath(cardA, cardB, mode) {
  const osrmProfile = mode === 'walk' ? 'foot' : 'driving';
  const cacheKey = `${osrmProfile}_${cardA.lat.toFixed(5)},${cardA.lng.toFixed(5)}_${cardB.lat.toFixed(5)},${cardB.lng.toFixed(5)}`;
  if (osrmRouteCache[cacheKey]) {
    return osrmRouteCache[cacheKey];
  }

  try {
    const url = `https://router.project-osrm.org/route/v1/${osrmProfile}/${cardA.lng},${cardA.lat};${cardB.lng},${cardB.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const latLngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      const result = {
        latLngs,
        distanceKm: route.distance / 1000,
        durationMin: Math.max(3, Math.round(route.duration / 60))
      };
      osrmRouteCache[cacheKey] = result;
      return result;
    }
  } catch (e) {}

  return {
    latLngs: [[cardA.lat, cardA.lng], [cardB.lat, cardB.lng]],
    distanceKm: haversineKm(cardA.lat, cardA.lng, cardB.lat, cardB.lng),
    durationMin: null
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
