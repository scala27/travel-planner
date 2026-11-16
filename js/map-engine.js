// ==================== 地圖初始化與選單同步 ====================
function initMap() {
  mapInstance = L.map('world-map').setView([25.3, 124.2], 6);
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
    <option value="all">顯示全部資料庫地點</option>
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
}

// ==================== 空間距離、跨海航班弧線與地理圍欄插件 ====================
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 判斷座標是否位於沖繩本島 Yui Rail 單軌地理圍欄內
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

// 產生跨海/國際航班的平滑二次貝茲飛行弧線座標
function buildFlightArcCoords(latA, lngA, latB, lngB) {
  const pts = [];
  const steps = 40;
  const midLat = (latA + latB) / 2;
  const midLng = (lngA + lngB) / 2;
  const dLat = latB - latA;
  const dLng = lngB - lngA;
  // 垂直於航線方向稍微向北弧起，視覺清晰美觀
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
  // 民航噴射客機巡航約 720 km/h，加上起降爬升滑行約 40 分鐘（台中-沖繩約 630km -> 約 93 分鐘）
  return Math.max(45, Math.round((km / 720) * 60 + 40));
}

// ==================== 多層次路網與跨國航班模式判斷 ====================
function getLegKey(dateStr, itemA, itemB) {
  return `${dateStr}|${itemA.spot.id}#${itemA.dayOccNum}|${itemB.spot.id}#${itemB.dayOccNum}`;
}

function resolveLegMode(dateStr, itemA, itemB, globalMode) {
  const key = getLegKey(dateStr, itemA, itemB);
  if (legModeOverrides[key]) return legModeOverrides[key];

  const spotA = itemA.spot;
  const spotB = itemB.spot;
  const latA = parseFloat(spotA.lat), lngA = parseFloat(spotA.lng);
  const latB = parseFloat(spotB.lat), lngB = parseFloat(spotB.lng);

  if (!isNaN(latA) && !isNaN(lngA) && !isNaN(latB) && !isNaN(lngB)) {
    const km = haversineKm(latA, lngA, latB, lngB);
    // 跨國或跨海長距離（> 150 km）自動啟用跨海/國際航班模式
    if (km > 150) {
      return 'flight';
    }
    if (globalMode === 'driving') return 'driving';
    if (globalMode === 'walking') return 'walking';

    if (km <= 0.15) return 'walking';

    // 僅當起迄點皆位於沖繩地理圍欄內時，啟用 Yui Rail 單軌判斷
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
  if (!spotA.lat || !spotA.lng || !spotB.lat || !spotB.lng) return { mins: 0, km: 0, mode: 'bus' };
  const latA = parseFloat(spotA.lat), lngA = parseFloat(spotA.lng);
  const latB = parseFloat(spotB.lat), lngB = parseFloat(spotB.lng);
  const km = haversineKm(latA, lngA, latB, lngB);
  const mode = resolveLegMode(dateStr, itemA, itemB, globalMode);

  if (mode === 'flight') {
    return { mins: estimateFlightMinutes(km), km: km, mode: 'flight' };
  }
  if (km <= 0.15) {
    return { mins: 2, km: km, mode: 'walking', isIndoor: true };
  }
  if (mode === 'monorail') {
    const stA = findNearestYuiRailStation(latA, lngA);
    const stB = findNearestYuiRailStation(latB, lngB);
    const hops = Math.abs(stA.index - stB.index);
    const walkMins = Math.round(((stA.distKm + stB.distKm) * 1.25 / 4.2) * 60);
    return { mins: Math.round(hops * 2.2 + 4 + walkMins), km: km * 1.2, mode };
  }
  if (mode === 'walking') {
    return { mins: Math.max(3, Math.round((km * 1.25 / 4.2) * 60)), km: km * 1.25, mode };
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
      return {
        coords: data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]),
        distKm: data.routes[0].distance / 1000,
        durMins: Math.max(1, Math.round(data.routes[0].duration / 60))
      };
    }
  } catch (e) {}
  const fallbackKm = haversineKm(latA, lngA, latB, lngB) * 1.25;
  const speed = profile === 'foot' ? 4.2 : 30;
  return {
    coords: [[latA, lngA], [latB, lngB]],
    distKm: fallbackKm,
    durMins: Math.max(1, Math.round((fallbackKm / speed) * 60))
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
  saveLocalState();
  renderAll();
}

function resetDaySegmentOverrides() {
  const filterDay = document.getElementById('map-day-selector').value;
  Object.keys(legModeOverrides).forEach(k => {
    if (k.startsWith(filterDay + '|')) delete legModeOverrides[k];
  });
  saveLocalState();
  renderAll();
  showToast('已重設當日各分段交通方式為自動最佳組合');
}

function handleGlobalModeChange() {
  const filterDay = document.getElementById('map-day-selector').value;
  Object.keys(legModeOverrides).forEach(k => {
    if (k.startsWith(filterDay + '|')) delete legModeOverrides[k];
  });
  saveLocalState();
  renderAll();
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

    let markerHtml = '';
    if (isHotel) {
      markerHtml = `<div style="background:${theme.hex};color:#fff;width:${isRoundTrip ? 32 : 26}px;height:26px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:10px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);">${isRoundTrip ? '宿↺' : '宿'}</div>`;
    } else if (isTransport) {
      markerHtml = `<div style="background:${theme.hex};color:#fff;width:${isRoundTrip ? 32 : 26}px;height:26px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:10px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);">${isRoundTrip ? '行↺' : '行'}</div>`;
    } else if (isSingleDayRoute) {
      markerHtml = `<div style="background:${theme.hex};color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);">${index + 1}</div>`;
    } else {
      markerHtml = `<div style="background:${theme.hex};width:18px;height:18px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,0.3);"></div>`;
    }

    const customIcon = L.divIcon({ html: markerHtml, className: '', iconSize: [28, 26], iconAnchor: [14, 13] });
    const marker = L.marker([lat, lng], { icon: customIcon }).addTo(mapLayerGroup);
    marker.bindPopup(`
      <div class="text-xs">
        <strong class="text-sm text-slate-800">${spot.name}</strong>${isRoundTrip ? ' <span class="text-purple-700 font-bold">(當日出發＋回程)</span>' : ''}<br/>
        <span style="color:${theme.hex};font-weight:bold;">● ${spot.category}</span> · <span class="text-slate-500">${spot.area}</span><br/>
        ${spot.must_buy ? `<span class="text-slate-700">${isHotel ? '備註' : '重點'}：${spot.must_buy}</span>` : ''}
      </div>
    `);
  });

  if (isSingleDayRoute && dayRouteItems.length > 1) {
    summaryBox.classList.remove('hidden');
    summaryBox.classList.add('flex');
    metricsEl.textContent = '正在計算跨國航線與地面路網...';
    breakdownEl.innerHTML = '';

    const hasOverrides = Object.keys(legModeOverrides).some(k => k.startsWith(filterDay + '|'));
    if (hasOverrides) resetBtn.classList.remove('hidden');
    else resetBtn.classList.add('hidden');

    const currentToken = ++routeRequestToken;
    let totalMins = 0;
    let totalDistKm = 0;
    const allBoundsPts = [];
    const segmentCards = [];

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

        // 在航線中點加上飛機圖示標籤
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
        legMins = estimateFlightMinutes(legDistKm);
        detailNote = `跨海直飛航線 (${Math.round(legDistKm)} km)`;

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
        detailNote = `單軌(${stA.station.name.replace('站','')}→${stB.station.name.replace('站','')}) ${(walkMinsA + walkMinsB) > 0 ? `+ 步行${walkMinsA + walkMinsB}分` : ''}`;

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
        detailNote = `街道步行 (${legDistKm.toFixed(1)} km)`;

      } else {
        const drive = await fetchOsrmSegment('driving', latA, lngA, latB, lngB);
        if (currentToken !== routeRequestToken) return;
        L.polyline(drive.coords, { color: '#2B4C7E', weight: 4.5, opacity: 0.9 }).addTo(mapLayerGroup);
        allBoundsPts.push(...drive.coords);
        legDistKm = drive.distKm;
        legMins = drive.durMins;
        detailNote = `自駕行駛 (${legDistKm.toFixed(1)} km)`;
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
              <option value="walking" ${legMode === 'walking' ? 'selected' : ''}>🚶 純步行</option>
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
    lucide.createIcons();

    if (allBoundsPts.length > 0) {
      mapInstance.fitBounds(L.latLngBounds(allBoundsPts), { padding: [40, 40], maxZoom: 15 });
    }
    return;
  } else {
    summaryBox.classList.add('hidden');
    summaryBox.classList.remove('flex');
  }

  if (latLngs.length > 0) {
    mapInstance.fitBounds(L.latLngBounds(latLngs), { padding: [40, 40], maxZoom: 14 });
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
  updateMapMarkers();
  switchMobileTab('map');
}
