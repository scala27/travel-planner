// ==================== 地圖初始化與選單同步 ====================
function initMap() {
  mapInstance = L.map('world-map').setView([26.215, 127.685], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(mapInstance);
  mapLayerGroup = L.layerGroup().addTo(mapInstance);
}

function populateDaySelectors(daysList) {
  const mapSel = document.getElementById('map-day-selector');
  const currentVal = mapSel.value;
  mapSel.innerHTML = `
    <option value="all">顯示全部資料庫地點（可直接點圖排程）</option>
    <option value="scheduled_all">僅顯示已納入行程地點</option>
    ${daysList.map(d => `<option value="${d.dateStr}">${d.label} (${d.shortDate}) 路線</option>`).join('')}
  `;
  if ([...mapSel.options].some(o => o.value === currentVal)) {
    mapSel.value = currentVal;
  }

  const formDaySel = document.getElementById('field-day');
  formDaySel.innerHTML = `
    <option value="pocket">📌 僅存於資料庫</option>
    ${daysList.map(d => `<option value="${d.dateStr}">${d.label} (${d.shortDate})</option>`).join('')}
  `;

  const multiBox = document.getElementById('multi-day-checkboxes');
  multiBox.innerHTML = daysList.map(d => `
    <label class="cursor-pointer inline-flex items-center gap-1.5 bg-white border border-purple-200 hover:border-purple-400 px-2.5 py-1 rounded-lg text-xs text-slate-700 select-none">
      <input type="checkbox" name="stay_days" value="${d.dateStr}" class="accent-purple-700 rounded" />
      <span>${d.label} (${d.shortDate.split(' ')[0]})</span>
    </label>
  `).join('');

  syncRadarAnchorOptions();
}

function syncRadarAnchorOptions() {
  const anchorSel = document.getElementById('radar-anchor-select');
  if (!anchorSel) return;
  const prevVal = anchorSel.value;
  const filterDay = document.getElementById('map-day-selector')?.value || 'all';
  const isSingleDay = filterDay !== 'all' && filterDay !== 'scheduled_all';

  let optionsHtml = `<option value="auto">📍 自動以當日住宿為中心</option>`;
  if (isSingleDay) {
    const dayItems = getDayItems(filterDay).filter(it => it.spot.lat && it.spot.lng);
    const seen = new Set();
    dayItems.forEach(it => {
      if (!seen.has(it.spot.id)) {
        seen.add(it.spot.id);
        optionsHtml += `<option value="${it.spot.id}">🎯 ${it.spot.name}</option>`;
      }
    });
  } else {
    spots.filter(s => s.category === '住宿' && s.lat && s.lng).forEach(h => {
      optionsHtml += `<option value="${h.id}">🏨 ${h.name}</option>`;
    });
  }
  optionsHtml += `<option value="map_center">🗺️ 目前地圖畫面中心</option>`;
  anchorSel.innerHTML = optionsHtml;
  if ([...anchorSel.options].some(o => o.value === prevVal)) {
    anchorSel.value = prevVal;
  }
}

function handleMapDayChange() {
  syncRadarAnchorOptions();
  updateMapMarkers();
}

// ==================== 空間距離、跨海航班弧線與地理圍欄 ====================
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcSlowWalkMinutes(distKm) {
  const speed = (typeof WALK_SPEED_KMH === 'number' && WALK_SPEED_KMH > 0) ? WALK_SPEED_KMH : 3.6;
  return Math.max(3, Math.round((distKm / speed) * 60));
}

function isInOkinawaGeofence(lat, lng) {
  return lat >= 26.05 && lat <= 26.88 && lng >= 127.55 && lng <= 128.35;
}

function findNearestYuiRailStation(lat, lng) {
  let bestIdx = 0;
  let minDist = Infinity;
  YUI_RAIL_STATIONS.forEach((st, idx) => {
    const d = haversineKm(parseFloat(lat), parseFloat(lng), st.lat, st.lng);
    if (d < minDist) {
      minDist = d;
      bestIdx = idx;
    }
  });
  return { station: YUI_RAIL_STATIONS[bestIdx], index: bestIdx, distKm: minDist };
}

function getYuiRailTrackSlice(stA, stB) {
  const startTrack = stA.station.trackIdx;
  const endTrack = stB.station.trackIdx;
  const step = startTrack <= endTrack ? 1 : -1;
  const coords = [];
  for (let i = startTrack; i !== endTrack + step; i += step) {
    coords.push([YUI_RAIL_TRACK[i].lat, YUI_RAIL_TRACK[i].lng]);
  }
  return coords;
}

function buildFlightArcCoords(latA, lngA, latB, lngB) {
  const pts = [];
  const steps = 40;
  const midLat = (latA + latB) / 2;
  const midLng = (lngA + lngB) / 2;
  const dLat = latB - latA;
  const dLng = lngB - lngA;
  const ctrlLat = midLat + Math.abs(dLng) * 0.14 + Math.abs(dLat) * 0.08;
  const ctrlLng = midLng - dLat * 0.12;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const invT = 1 - t;
    const lat = invT * invT * latA + 2 * invT * t * ctrlLat + t * t * latB;
    const lng = invT * invT * lngA + 2 * invT * t * ctrlLng + t * t * lngB;
    pts.push([lat, lng]);
  }
  return pts;
}

function estimateFlightMinutes(km) {
  return Math.max(45, Math.round((km / 720) * 60 + 40));
}

// ==================== 多層次路網判斷與左右看板時間統一 ====================
function getLegKey(dateStr, itemA, itemB) {
  return `${dateStr}|${itemA.spot.id}#${itemA.dayOccNum}|${itemB.spot.id}#${itemB.dayOccNum}`;
}

function resolveLegMode(dateStr, itemA, itemB, globalMode) {
  const key = getLegKey(dateStr, itemA, itemB);
  if (legModeOverrides[key]) return legModeOverrides[key];

  const spotA = itemA.spot;
  const spotB = itemB.spot;

  if (spotA.category === '交通' && typeof parseFlightSchedule === 'function' && parseFlightSchedule(spotA.business_hours)) {
    return 'flight';
  }

  const latA = parseFloat(spotA.lat), lngA = parseFloat(spotA.lng);
  const latB = parseFloat(spotB.lat), lngB = parseFloat(spotB.lng);

  if (!isNaN(latA) && !isNaN(lngA) && !isNaN(latB) && !isNaN(lngB)) {
    const km = haversineKm(latA, lngA, latB, lngB);
    if (km > 150) return 'flight';
    if (globalMode === 'driving') return 'driving';
    if (globalMode === 'walking') return 'walking';

    if (km <= 0.15) return 'walking';

    if (isInOkinawaGeofence(latA, lngA) && isInOkinawaGeofence(latB, lngB)) {
      const stA = findNearestYuiRailStation(latA, lngA);
      const stB = findNearestYuiRailStation(latB, lngB);
      if (stA.distKm <= 1.2 && stB.distKm <= 1.2 && stA.index !== stB.index) {
        return 'monorail';
      }
      if (globalMode === 'hybrid' && km > 0.75 && km <= 3.2 && (stA.distKm > 1.2 || stB.distKm > 1.2)) {
        return 'taxi';
      }
    }

    if (km <= 0.75) return 'walking';
  }

  if (globalMode === 'driving') return 'driving';
  if (globalMode === 'walking') return 'walking';
  return 'bus';
}

function estimateSingleLegQuick(dateStr, itemA, itemB, globalMode) {
  const spotA = itemA.spot, spotB = itemB.spot;
  const flightSched = (spotA.category === '交通' && typeof parseFlightSchedule === 'function')
    ? parseFlightSchedule(spotA.business_hours)
    : null;

  const key = getLegKey(dateStr, itemA, itemB);
  const mode = resolveLegMode(dateStr, itemA, itemB, globalMode);

  if (typeof resolvedLegCache === 'object' && resolvedLegCache[key] && resolvedLegCache[key].mode === mode) {
    return { ...resolvedLegCache[key], flightSched };
  }

  if (!spotA.lat || !spotA.lng || !spotB.lat || !spotB.lng) {
    if (flightSched) return { mins: flightSched.flightMins, km: 0, mode: 'flight', flightSched };
    return { mins: 0, km: 0, mode: 'bus' };
  }

  const latA = parseFloat(spotA.lat), lngA = parseFloat(spotA.lng);
  const latB = parseFloat(spotB.lat), lngB = parseFloat(spotB.lng);
  const km = haversineKm(latA, lngA, latB, lngB);

  if (mode === 'flight') {
    const mins = flightSched ? flightSched.flightMins : estimateFlightMinutes(km);
    return { mins, km, mode: 'flight', flightSched };
  }
  if (km <= 0.15) {
    return { mins: 2, km: km, mode: 'walking', isIndoor: true };
  }
  if (mode === 'monorail') {
    const stA = findNearestYuiRailStation(latA, lngA);
    const stB = findNearestYuiRailStation(latB, lngB);
    const hops = Math.abs(stA.index - stB.index);
    const walkMins = calcSlowWalkMinutes((stA.distKm + stB.distKm) * 1.25);
    return { mins: Math.round(hops * 2.2 + 4 + walkMins), km: km * 1.2, mode };
  }
  if (mode === 'walking') {
    const walkDistKm = km * 1.25;
    return { mins: calcSlowWalkMinutes(walkDistKm), km: walkDistKm, mode };
  }
  if (mode === 'taxi') {
    return { mins: Math.max(4, Math.round((km * 1.35 / 30) * 60 + 2)), km: km * 1.35, mode };
  }
  if (mode === 'driving') {
    return { mins: Math.max(3, Math.round((km * 1.3 / 34) * 60)), km: km * 1.3, mode };
  }
  return { mins: Math.max(8, Math.round((km * 1.3 / 24) * 60 + 8)), km: km * 1.3, mode: 'bus' };
}

async function fetchOsrmSegment(profile, latA, lngA, latB, lngB) {
  try {
    const url = `https://router.project-osrm.org/route/v1/${profile}/${lngA},${latA};${lngB},${latB}?overview=full&geometries=geojson`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const distKm = data.routes[0].distance / 1000;
      const durMins = profile === 'foot'
        ? calcSlowWalkMinutes(distKm)
        : Math.max(1, Math.round(data.routes[0].duration / 60));
      return {
        coords: data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]),
        distKm,
        durMins
      };
    }
  } catch (e) {}
  const fallbackKm = haversineKm(latA, lngA, latB, lngB) * 1.25;
  const durMins = profile === 'foot'
    ? calcSlowWalkMinutes(fallbackKm)
    : Math.max(1, Math.round((fallbackKm / 30) * 60));
  return {
    coords: [[latA, lngA], [latB, lngB]],
    distKm: fallbackKm,
    durMins
  };
}

function buildPointToPointGmapsUrl(latA, lngA, latB, lngB, legMode) {
  if (legMode === 'flight') {
    return `https://www.google.com/travel/flights`;
  }
  const gMode = legMode === 'walking' ? 'walking' : ((legMode === 'driving' || legMode === 'taxi') ? 'driving' : 'transit');
  const params = new URLSearchParams({
    api: '1',
    origin: `${latA},${lngA}`,
    destination: `${latB},${lngB}`,
    travelmode: gMode
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function setLegModeOverride(legKey, newMode) {
  legModeOverrides[legKey] = newMode;
  if (typeof resolvedLegCache === 'object') delete resolvedLegCache[legKey];
  saveLocalState();
  renderAll();
}

function resetDaySegmentOverrides() {
  const filterDay = document.getElementById('map-day-selector').value;
  Object.keys(legModeOverrides).forEach(k => {
    if (k.startsWith(filterDay + '|')) delete legModeOverrides[k];
  });
  if (typeof resolvedLegCache === 'object') {
    Object.keys(resolvedLegCache).forEach(k => {
      if (k.startsWith(filterDay + '|')) delete resolvedLegCache[k];
    });
  }
  saveLocalState();
  renderAll();
  showToast('已重設當日各分段交通方式為自動最佳組合');
}

function handleGlobalModeChange() {
  const filterDay = document.getElementById('map-day-selector').value;
  Object.keys(legModeOverrides).forEach(k => {
    if (k.startsWith(filterDay + '|')) delete legModeOverrides[k];
  });
  if (typeof resolvedLegCache === 'object') {
    Object.keys(resolvedLegCache).forEach(k => {
      if (k.startsWith(filterDay + '|')) delete resolvedLegCache[k];
    });
  }
  saveLocalState();
  renderAll();
}

// ==================== 🧭 周邊口袋雷達 ====================
function checkSpotBusinessWindow(spot, radarMode) {
  const rawHours = String(spot.business_hours || '').trim();
  const textBlob = `${spot.name || ''} ${spot.description || ''} ${spot.must_buy || ''} ${rawHours}`;

  if (radarMode === 'breakfast') {
    if (spot.category !== '美食') return false;
    const hasBreakfastKeyword = /早餐|早午餐|咖啡|吐司|飯糰|蛋餅|三明治|喫茶|モーニング|朝|bakery|coffee/i.test(textBlob);
    const timeRange = rawHours.match(/(\d{1,2}):(\d{2})\s*[-~～]\s*(\d{1,2}):(\d{2})/);
    if (timeRange) {
      const openMins = parseInt(timeRange[1], 10) * 60 + parseInt(timeRange[2], 10);
      let closeMins = parseInt(timeRange[3], 10) * 60 + parseInt(timeRange[4], 10);
      if (closeMins <= openMins) closeMins += 1440;
      return openMins <= 570 && closeMins >= 510;
    }
    if (/24小時|24H/i.test(rawHours)) return true;
    return hasBreakfastKeyword;
  }

  if (radarMode === 'lunch') {
    if (spot.category !== '美食') return false;
    const timeRange = rawHours.match(/(\d{1,2}):(\d{2})\s*[-~～]\s*(\d{1,2}):(\d{2})/);
    if (timeRange) {
      const openMins = parseInt(timeRange[1], 10) * 60 + parseInt(timeRange[2], 10);
      let closeMins = parseInt(timeRange[3], 10) * 60 + parseInt(timeRange[4], 10);
      if (closeMins <= openMins) closeMins += 1440;
      return openMins <= 750 && closeMins >= 720;
    }
    if (/居酒屋|宵夜/.test(textBlob) && !/午餐|午間|定食|拉麵/.test(textBlob)) return false;
    return true;
  }

  if (radarMode === 'sightseeing') {
    return spot.category === '景點' || spot.category === '購物';
  }

  return spot.category !== '住宿' && spot.category !== '交通';
}

function renderNearbyPocketRadar(filterDay, dayRouteItems) {
  const radarMode = document.getElementById('radar-filter-mode')?.value || 'off';
  const subBox = document.getElementById('radar-sub-controls');
  const statusEl = document.getElementById('radar-status-text');
  if (!subBox || !statusEl) return [];

  if (radarMode === 'off') {
    subBox.classList.add('hidden');
    subBox.classList.remove('grid');
    statusEl.classList.add('hidden');
    return [];
  }

  subBox.classList.remove('hidden');
  subBox.classList.add('grid');
  statusEl.classList.remove('hidden');

  const isSingleDay = filterDay !== 'all' && filterDay !== 'scheduled_all';
  const anchorVal = document.getElementById('radar-anchor-select')?.value || 'auto';
  const radiusMeters = Number(document.getElementById('radar-radius-select')?.value || 1000);
  const radiusKm = radiusMeters / 1000;

  let centerLat = null;
  let centerLng = null;
  let anchorLabel = '';
  let anchorSpotId = '';

  if (anchorVal === 'map_center') {
    const c = mapInstance.getCenter();
    centerLat = c.lat;
    centerLng = c.lng;
    anchorLabel = '目前地圖中心';
  } else if (anchorVal !== 'auto') {
    const targetSpot = spots.find(s => String(s.id) === String(anchorVal));
    if (targetSpot && targetSpot.lat && targetSpot.lng) {
      centerLat = parseFloat(targetSpot.lat);
      centerLng = parseFloat(targetSpot.lng);
      anchorLabel = targetSpot.name;
      anchorSpotId = targetSpot.id;
    }
  }

  if (centerLat === null) {
    const hotelItem = dayRouteItems.find(it => it.spot.category === '住宿' && it.spot.lat && it.spot.lng);
    const fallbackItem = dayRouteItems.find(it => it.spot.lat && it.spot.lng);
    const chosen = hotelItem || fallbackItem;
    if (chosen) {
      centerLat = parseFloat(chosen.spot.lat);
      centerLng = parseFloat(chosen.spot.lng);
      anchorLabel = chosen.spot.name;
      anchorSpotId = chosen.spot.id;
    } else {
      const c = mapInstance.getCenter();
      centerLat = c.lat;
      centerLng = c.lng;
      anchorLabel = '地圖中心';
    }
  }

  L.circle([centerLat, centerLng], {
    radius: radiusMeters,
    color: '#D97706',
    weight: 2,
    dashArray: '6, 6',
    fillColor: '#F59E0B',
    fillOpacity: 0.10,
    interactive: false
  }).addTo(mapLayerGroup);

  const alreadyInDayIds = new Set(isSingleDay ? dayRouteItems.map(it => it.spot.id) : []);

  const candidates = spots
    .filter(s => s.lat && s.lng && !alreadyInDayIds.has(s.id))
    .filter(s => checkSpotBusinessWindow(s, radarMode))
    .map(s => {
      const distKm = haversineKm(centerLat, centerLng, parseFloat(s.lat), parseFloat(s.lng));
      return { spot: s, distKm, walkMins: calcSlowWalkMinutes(distKm * 1.2) };
    })
    .filter(entry => entry.distKm <= radiusKm)
    .sort((a, b) => a.distKm - b.distKm);

  const radarBounds = [[centerLat, centerLng]];

  candidates.forEach(entry => {
    const s = entry.spot;
    const lat = parseFloat(s.lat);
    const lng = parseFloat(s.lng);
    radarBounds.push([lat, lng]);

    const theme = CATEGORY_THEME[s.category] || { hex: '#F59E0B' };
    const badgeEmoji = radarMode === 'breakfast' ? '🍳' : (s.category === '美食' ? '🍜' : '📍');

    const radarIcon = L.divIcon({
      html: `<div style="background:#fff;color:${theme.hex};border:2.5px dashed ${theme.hex};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 3px 8px rgba(0,0,0,0.28);">${badgeEmoji}</div>`,
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const distText = entry.distKm < 1
      ? `${Math.round(entry.distKm * 1000)}m`
      : `${entry.distKm.toFixed(1)}km`;

    const actionHtml = isSingleDay
      ? `<button type="button" onclick="quickInsertRadarSpotToDay('${s.id}', '${filterDay}', '${anchorSpotId}')"
           style="margin-top:6px;width:100%;background:#2B4C7E;color:#fff;border:none;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:bold;cursor:pointer;">
           ＋ 立即排入本日行程
         </button>`
      : buildDirectMapAssignHtml(s.id);

    const marker = L.marker([lat, lng], { icon: radarIcon }).addTo(mapLayerGroup);
    marker.bindPopup(`
      <div class="text-xs" style="min-width:185px;">
        <div style="font-size:10px;color:#B45309;font-weight:bold;">🧭 雷達推薦 · 距${anchorLabel} ${distText} (慢步約${entry.walkMins}分)</div>
        <strong class="text-sm text-slate-800">${s.name}</strong><br/>
        <span style="color:${theme.hex};font-weight:bold;">● ${s.category}</span> · <span class="text-slate-500">${s.area}</span><br/>
        ${s.business_hours ? `<span class="text-slate-600">⏰ 營業：${s.business_hours}</span><br/>` : ''}
        ${s.must_buy ? `<span class="text-slate-700">🛍️ 推薦：${s.must_buy}</span>` : ''}
        ${actionHtml}
      </div>
    `);
  });

  statusEl.innerHTML = candidates.length > 0
    ? `🎯 以「<strong>${anchorLabel}</strong>」為中心 ${radiusMeters}m 內找到 <strong>${candidates.length}</strong> 筆口袋推薦（點擊虛線圖釘可直接排入）`
    : `⚠️「<strong>${anchorLabel}</strong>」${radiusMeters}m 內暫無符合條件的口袋卡片，可試著放寬半徑至 2km`;

  return radarBounds;
}

// ==================== 地圖點位「直接排入行程」氣泡控制元件 ====================
function buildDirectMapAssignHtml(spotId) {
  const daysList = getDateRangeArray(appConfig.startDate, appConfig.endDate);
  if (!daysList || daysList.length === 0) return '';
  const optionsHtml = daysList.map(d => `<option value="${d.dateStr}">${d.label} (${d.shortDate.split(' ')[0]})</option>`).join('');
  return `
    <div style="margin-top:7px;padding-top:6px;border-top:1px solid #E2E8F0;display:flex;gap:4px;align-items:center;">
      <select id="map-popup-day-${spotId}" style="flex:1;font-size:11px;border:1px solid #CBD5E1;border-radius:6px;padding:3px 5px;background:#F8FAFC;color:#1E293B;">
        ${optionsHtml}
      </select>
      <button type="button"
        onclick="quickAssignSpotToDay('${spotId}', document.getElementById('map-popup-day-${spotId}').value)"
        style="background:#2B4C7E;color:#fff;border:none;border-radius:6px;padding:4px 8px;font-size:11px;font-weight:bold;cursor:pointer;white-space:nowrap;">
        ＋ 排入
      </button>
    </div>
  `;
}

// ==================== 地圖標記、跨海飛行弧線與多層次路網繪製 ====================
async function updateMapMarkers() {
  if (!mapInstance || !mapLayerGroup) return;
  mapLayerGroup.clearLayers();

  const filterDay = document.getElementById('map-day-selector').value;
  const globalMode = document.getElementById('map-travel-mode').value;
  const summaryBox = document.getElementById('map-route-summary');
  const metricsEl = document.getElementById('map-route-metrics');
  const breakdownEl = document.getElementById('map-segment-breakdown');
  const resetBtn = document.getElementById('btn-reset-leg-modes');

  const isSingleDayRoute = filterDay !== 'all' && filterDay !== 'scheduled_all';
  let dayRouteItems = [];

  if (isSingleDayRoute) {
    dayRouteItems = getDayItems(filterDay).filter(it => it.spot.lat && it.spot.lng);
  } else {
    let baseSpots = spots.filter(s => s.lat && s.lng);
    if (filterDay === 'scheduled_all') {
      baseSpots = baseSpots.filter(s => getSpotAssignedDays(s).length > 0);
    }
    dayRouteItems = baseSpots.map(s => ({ spot: s, dayOccNum: 1, totalDayOccs: 1 }));
  }

  const latLngs = [];
  const renderedSpotIds = new Set();

  dayRouteItems.forEach((item, index) => {
    const spot = item.spot;
    const lat = parseFloat(spot.lat);
    const lng = parseFloat(spot.lng);
    if (isNaN(lat) || isNaN(lng)) return;

    latLngs.push([lat, lng]);
    if (isSingleDayRoute && renderedSpotIds.has(spot.id)) return;
    renderedSpotIds.add(spot.id);

    const isHotel = spot.category === '住宿';
    const isTransport = spot.category === '交通';
    const theme = CATEGORY_THEME[spot.category] || { hex: '#2B4C7E' };
    const isRoundTrip = isSingleDayRoute && item.totalDayOccs > 1;
    const assignedDays = getSpotAssignedDays(spot);

    let markerHtml = '';
    if (isHotel) {
      markerHtml = `<div style="background:${theme.hex};color:#fff;width:${isRoundTrip ? 32 : 26}px;height:26px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:10px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);">${isRoundTrip ? '宿↺' : '宿'}</div>`;
    } else if (isTransport) {
      markerHtml = `<div style="background:${theme.hex};color:#fff;width:${isRoundTrip ? 32 : 26}px;height:26px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:10px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);">${isRoundTrip ? '行↺' : '行'}</div>`;
    } else if (isSingleDayRoute) {
      markerHtml = `<div style="background:${theme.hex};color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);">${index + 1}</div>`;
    } else {
      const ringStyle = assignedDays.length > 0 ? 'border:2.5px solid #10B981;' : 'border:2.5px solid #fff;';
      markerHtml = `<div style="background:${theme.hex};width:20px;height:20px;border-radius:50%;${ringStyle}box-shadow:0 2px 5px rgba(0,0,0,0.32);"></div>`;
    }

    const customIcon = L.divIcon({ html: markerHtml, className: '', iconSize: [28, 26], iconAnchor: [14, 13] });
    const marker = L.marker([lat, lng], { icon: customIcon }).addTo(mapLayerGroup);
    marker.bindPopup(`
      <div class="text-xs" style="min-width:185px;">
        <strong class="text-sm text-slate-800">${spot.name}</strong>${isRoundTrip ? ' <span class="text-purple-700 font-bold">(當日出發＋回程)</span>' : ''}<br/>
        <span style="color:${theme.hex};font-weight:bold;">● ${spot.category}</span> · <span class="text-slate-500">${spot.area}</span><br/>
        ${spot.business_hours ? `<span class="text-slate-600">⏰ ${spot.business_hours}</span><br/>` : ''}
        ${spot.must_buy ? `<span class="text-slate-700">${isHotel ? '備註' : '重點'}：${spot.must_buy}</span>` : ''}
        ${buildDirectMapAssignHtml(spot.id)}
      </div>
    `);
  });

  const radarBounds = renderNearbyPocketRadar(filterDay, dayRouteItems);

  if (isSingleDayRoute && dayRouteItems.length > 1) {
    summaryBox.classList.remove('hidden');
    summaryBox.classList.add('flex');
    metricsEl.textContent = '正在計算跨國航線與慢活路網...';
    breakdownEl.innerHTML = '';

    const hasOverrides = Object.keys(legModeOverrides).some(k => k.startsWith(filterDay + '|'));
    if (hasOverrides) resetBtn.classList.remove('hidden');
    else resetBtn.classList.add('hidden');

    const currentToken = ++routeRequestToken;
    let totalMins = 0;
    let totalDistKm = 0;
    const allBoundsPts = [...radarBounds];
    const segmentCards = [];
    let anyLegChanged = false;

    for (let i = 0; i < dayRouteItems.length - 1; i++) {
      const itemA = dayRouteItems[i];
      const itemB = dayRouteItems[i + 1];
      const pA = itemA.spot;
      const pB = itemB.spot;
      const latA = parseFloat(pA.lat), lngA = parseFloat(pA.lng);
      const latB = parseFloat(pB.lat), lngB = parseFloat(pB.lng);

      const legKey = getLegKey(filterDay, itemA, itemB);
      const legMode = resolveLegMode(filterDay, itemA, itemB, globalMode);
      const gmapsLegUrl = buildPointToPointGmapsUrl(latA, lngA, latB, lngB, legMode);
      const canUseOkinawaMonorail = isInOkinawaGeofence(latA, lngA) && isInOkinawaGeofence(latB, lngB);
      const flightSched = (pA.category === '交通' && typeof parseFlightSchedule === 'function')
        ? parseFlightSchedule(pA.business_hours)
        : null;

      let legMins = 0;
      let legDistKm = 0;
      let detailNote = '';

      if (legMode === 'flight') {
        const arcCoords = buildFlightArcCoords(latA, lngA, latB, lngB);
        L.polyline(arcCoords, {
          color: '#7E22CE',
          weight: 3.5,
          dashArray: '8, 8',
          opacity: 0.9
        }).addTo(mapLayerGroup);

        const midPt = arcCoords[Math.floor(arcCoords.length / 2)];
        const planeIcon = L.divIcon({
          html: `<div style="background:#7E22CE;color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);">✈️</div>`,
          className: '',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });
        L.marker(midPt, { icon: planeIcon, interactive: false }).addTo(mapLayerGroup);

        allBoundsPts.push(...arcCoords);
        legDistKm = haversineKm(latA, lngA, latB, lngB);
        legMins = flightSched ? flightSched.flightMins : estimateFlightMinutes(legDistKm);
        detailNote = flightSched
          ? `${flightSched.depStr}→${flightSched.arrStr} 跨海直飛 (${Math.round(legDistKm)} km)`
          : `跨海直飛航線 (${Math.round(legDistKm)} km)`;

      } else if (legMode === 'monorail' && canUseOkinawaMonorail) {
        const stA = findNearestYuiRailStation(latA, lngA);
        const stB = findNearestYuiRailStation(latB, lngB);
        const railCoords = getYuiRailTrackSlice(stA, stB);

        L.polyline(railCoords, { color: '#0284C7', weight: 5, opacity: 0.92 }).addTo(mapLayerGroup);
        allBoundsPts.push(...railCoords);

        let walkMinsA = 0, walkMinsB = 0;
        if (stA.distKm > 0.08) {
          const walkA = await fetchOsrmSegment('foot', latA, lngA, stA.station.lat, stA.station.lng);
          if (currentToken !== routeRequestToken) return;
          L.polyline(walkA.coords, { color: '#059669', weight: 3.5, dashArray: '4, 6', opacity: 0.9 }).addTo(mapLayerGroup);
          allBoundsPts.push(...walkA.coords);
          walkMinsA = walkA.durMins;
        }
        if (stB.distKm > 0.08) {
          const walkB = await fetchOsrmSegment('foot', stB.station.lat, stB.station.lng, latB, lngB);
          if (currentToken !== routeRequestToken) return;
          L.polyline(walkB.coords, { color: '#059669', weight: 3.5, dashArray: '4, 6', opacity: 0.9 }).addTo(mapLayerGroup);
          allBoundsPts.push(...walkB.coords);
          walkMinsB = walkB.durMins;
        }

        const hops = Math.abs(stA.index - stB.index);
        const railRideMins = Math.max(2, Math.round(hops * 2.2 + 4));
        legMins = railRideMins + walkMinsA + walkMinsB;
        legDistKm = haversineKm(latA, lngA, latB, lngB) * 1.25;
        detailNote = `單軌(${stA.station.name.replace('站','')}→${stB.station.name.replace('站','')}) ${(walkMinsA + walkMinsB) > 0 ? `+ 慢步${walkMinsA + walkMinsB}分` : ''}`;

      } else if (legMode === 'bus') {
        const road = await fetchOsrmSegment('driving', latA, lngA, latB, lngB);
        if (currentToken !== routeRequestToken) return;
        L.polyline(road.coords, { color: '#0284C7', weight: 4.5, dashArray: '8, 6', opacity: 0.88 }).addTo(mapLayerGroup);
        allBoundsPts.push(...road.coords);
        legDistKm = road.distKm;
        legMins = Math.max(8, Math.round(road.durMins * 1.55 + 8));
        detailNote = `大眾運輸/客運 + 步行 (${legDistKm.toFixed(1)} km)`;

      } else if (legMode === 'taxi') {
        const road = await fetchOsrmSegment('driving', latA, lngA, latB, lngB);
        if (currentToken !== routeRequestToken) return;
        L.polyline(road.coords, { color: '#D97706', weight: 4.5, opacity: 0.9 }).addTo(mapLayerGroup);
        allBoundsPts.push(...road.coords);
        legDistKm = road.distKm;
        legMins = Math.max(4, road.durMins + 2);
        detailNote = `點對點計程車接駁 (${legDistKm.toFixed(1)} km)`;

      } else if (legMode === 'walking') {
        const walk = await fetchOsrmSegment('foot', latA, lngA, latB, lngB);
        if (currentToken !== routeRequestToken) return;
        L.polyline(walk.coords, { color: '#059669', weight: 4, dashArray: '4, 6', opacity: 0.9 }).addTo(mapLayerGroup);
        allBoundsPts.push(...walk.coords);
        legDistKm = walk.distKm;
        legMins = walk.durMins;
        detailNote = `慢活街道步行 (${legDistKm.toFixed(1)} km)`;

      } else {
        const drive = await fetchOsrmSegment('driving', latA, lngA, latB, lngB);
        if (currentToken !== routeRequestToken) return;
        L.polyline(drive.coords, { color: '#2B4C7E', weight: 4.5, opacity: 0.9 }).addTo(mapLayerGroup);
        allBoundsPts.push(...drive.coords);
        legDistKm = drive.distKm;
        legMins = drive.durMins;
        detailNote = `自駕行駛 (${legDistKm.toFixed(1)} km)`;
      }

      if (typeof resolvedLegCache === 'object') {
        const prevCached = resolvedLegCache[legKey];
        if (!prevCached || prevCached.mins !== legMins || prevCached.mode !== legMode) {
          resolvedLegCache[legKey] = { mins: legMins, km: legDistKm, mode: legMode };
          anyLegChanged = true;
        }
      }

      totalMins += legMins;
      totalDistKm += legDistKm;

      const nameBDisplay = (itemB.totalDayOccs > 1 && itemB.dayOccNum > 1) ? `${pB.name} (回程)` : pB.name;

      segmentCards.push(`
        <div class="bg-slate-50 border border-slate-200/80 rounded-lg p-1.5 space-y-1">
          <div class="flex items-center justify-between gap-1">
            <span class="font-bold text-slate-800 truncate">
              ${i + 1}→${i + 2} ${pA.name} → ${nameBDisplay}
            </span>
            <span class="font-bold text-ai-indigo shrink-0">約 ${legMins} 分</span>
          </div>
          <div class="flex items-center justify-between gap-1.5">
            <select onchange="setLegModeOverride('${legKey}', this.value)"
              class="text-[10px] bg-white border border-slate-300 rounded px-1.5 py-0.5 font-medium text-slate-700 focus:outline-none">
              <option value="flight" ${legMode === 'flight' ? 'selected' : ''}>✈️ 跨海/國際航班</option>
              ${canUseOkinawaMonorail ? `<option value="monorail" ${legMode === 'monorail' ? 'selected' : ''}>🚝 單軌+步行</option>` : ''}
              <option value="bus" ${legMode === 'bus' ? 'selected' : ''}>🚌 大眾運輸/客運</option>
              <option value="taxi" ${legMode === 'taxi' ? 'selected' : ''}>🚕 計程車接駁</option>
              <option value="walking" ${legMode === 'walking' ? 'selected' : ''}>🚶 慢活步行</option>
              <option value="driving" ${legMode === 'driving' ? 'selected' : ''}>🚗 自駕</option>
            </select>
            <span class="text-slate-500 truncate flex-1">${detailNote}</span>
            <a href="${gmapsLegUrl}" target="_blank" class="text-ai-indigo hover:underline font-bold flex items-center gap-0.5 shrink-0" title="${legMode === 'flight' ? '開啟 Google 航班查詢' : '開啟 Google Maps 檢視此段實際時刻與路線'}">
              <span>${legMode === 'flight' ? '航班' : 'Google'}</span>
              <i data-lucide="external-link" class="w-2.5 h-2.5"></i>
            </a>
          </div>
        </div>
      `);
    }

    metricsEl.textContent = `🧭 當日移動總計：約 ${totalMins} 分 (${totalDistKm.toFixed(1)} km)`;
    breakdownEl.innerHTML = segmentCards.join('');

    if (anyLegChanged && typeof renderKanbanDays === 'function') {
      const daysList = getDateRangeArray(appConfig.startDate, appConfig.endDate);
      renderKanbanDays(daysList);
      initSortableDragAndDrop();
    }

    lucide.createIcons();

    if (allBoundsPts.length > 0) {
      mapInstance.fitBounds(L.latLngBounds(allBoundsPts), { padding: [36, 36], maxZoom: 15 });
    }
    return;
  } else {
    summaryBox.classList.add('hidden');
    summaryBox.classList.remove('flex');
  }

  const combinedPts = [...latLngs, ...radarBounds];
  if (combinedPts.length > 0) {
    mapInstance.fitBounds(L.latLngBounds(combinedPts), { padding: [36, 36], maxZoom: 14 });
  }
}

function focusMapOnSpot(id) {
  const spot = spots.find(s => s.id === id);
  if (!spot || !spot.lat || !spot.lng) return;
  if (window.innerWidth >= 1024 && !uiState.rightVisible) {
    toggleRightPanel();
  }
  switchMobileTab('map');
  setTimeout(() => {
    mapInstance.invalidateSize();
    mapInstance.setView([spot.lat, spot.lng], 15);
  }, 180);
}

function focusMapOnDay(dateStr) {
  if (window.innerWidth >= 1024 && !uiState.rightVisible) {
    toggleRightPanel();
  }
  document.getElementById('map-day-selector').value = dateStr;
  syncRadarAnchorOptions();
  updateMapMarkers();
  switchMobileTab('map');
}
