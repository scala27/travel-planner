import {
  state,
  hooks,
  createTripObject,
  getActiveTrip,
  syncActiveTripToLegacyState,
  syncLegacyStateBackToActiveTrip,
  persistState,
  ensureItineraryDays,
  showToast
} from './state.js';

function setSyncStatus(status, text) {
  const pill = document.getElementById('syncStatusPill');
  const dot = document.getElementById('syncStatusDot');
  const label = document.getElementById('syncStatusText');
  if (!pill || !dot) return;

  if (status === 'syncing') {
    pill.className = 'flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200';
    dot.className = 'w-2 h-2 rounded-full bg-amber-500 animate-ping';
  } else if (status === 'error') {
    pill.className = 'flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200';
    dot.className = 'w-2 h-2 rounded-full bg-rose-500';
  } else {
    pill.className = 'flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200';
    dot.className = 'w-2 h-2 rounded-full bg-emerald-500';
  }
  if (label && text) label.textContent = text;
}

export async function pullFromGoogleSheets(manual = false) {
  const url = (state.settings.gasUrl || '').trim();
  if (!url) {
    setSyncStatus('error', '未設定試算表網址');
    if (manual) showToast('請先於右上角設定 Google Apps Script 網址', 'amber');
    return;
  }

  const syncIcon = document.getElementById('syncIcon');
  if (syncIcon) syncIcon.classList.add('fa-spin');
  setSyncStatus('syncing', '正在讀取雲端...');

  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}action=getAll&t=${Date.now()}`);
    const data = await res.json();

    const rawSpots = Array.isArray(data.spots) ? data.spots : (Array.isArray(data.cards) ? data.cards : []);
    if (rawSpots.length > 0) {
      state.cards = rawSpots.map((row, idx) => ({
        id: String(row.id || `spot_${Date.now()}_${idx}`),
        title: String(row.title || row.name || '未命名地點').trim(),
        category: String(row.category || '景點').trim(),
        country: String(row.country || '日本').trim(),
        district: String(row.district || row.area || '').trim(),
        lat: row.lat !== '' && row.lat !== null && !isNaN(Number(row.lat)) ? Number(row.lat) : null,
        lng: row.lng !== '' && row.lng !== null && !isNaN(Number(row.lng)) ? Number(row.lng) : null,
        duration: Number(row.duration) || 60,
        notes: String(row.notes || row.description || '').trim(),
        mapUrl: String(row.mapUrl || row.googleMapsUrl || '').trim(),
        image: String(row.image || row.imageUrl || '').trim(),
        starred: row.starred === true || String(row.starred).toLowerCase() === 'true',
        meta: typeof row.meta === 'object' && row.meta !== null ? row.meta : {}
      }));
    }

    // 若雲端有回傳多旅程 Trips 資料則優先載入；否則向下相容舊版 Spots 的 day/order 欄位
    if (Array.isArray(data.trips) && data.trips.length > 0) {
      state.trips = data.trips.map(t => createTripObject(t));
      if (!state.trips.some(t => t.id === state.activeTripId)) {
        state.activeTripId = state.trips[0].id;
      }
      syncActiveTripToLegacyState();
    } else if (rawSpots.length > 0) {
      const rebuiltItinerary = {};
      const total = Number(state.settings.totalDays) || 6;
      for (let d = 1; d <= total; d++) {
        rebuiltItinerary[d] = { startTime: (state.itinerary[d] && state.itinerary[d].startTime) || '09:00', items: [] };
      }

      rawSpots.forEach((row, idx) => {
        const dayNum = parseInt(row.day, 10);
        if (dayNum >= 1 && dayNum <= total) {
          const cardId = String(row.id || `spot_${Date.now()}_${idx}`);
          rebuiltItinerary[dayNum].items.push({
            uid: `it_${cardId}_${dayNum}_${idx}`,
            cardId,
            order: parseInt(row.order, 10) || 999,
            transitMode: row.transitMode || 'auto',
            customTransitMin: row.customTransitMin !== '' && row.customTransitMin != null ? Number(row.customTransitMin) : null
          });
        }
      });

      Object.keys(rebuiltItinerary).forEach(d => {
        rebuiltItinerary[d].items.sort((a, b) => a.order - b.order);
      });

      const hasCloudSchedule = Object.values(rebuiltItinerary).some(d => d.items.length > 0);
      if (hasCloudSchedule) {
        state.itinerary = rebuiltItinerary;
        syncLegacyStateBackToActiveTrip();
      }
    }

    ensureItineraryDays();
    persistState(false);

    if (typeof hooks.populateRegionDropdowns === 'function') hooks.populateRegionDropdowns();
    if (typeof hooks.renderAll === 'function') hooks.renderAll();

    setSyncStatus('connected', 'Google 試算表已連線');
    if (manual) showToast(`已從試算表同步 ${state.cards.length} 筆口袋與 ${state.trips.length} 趟行程`, 'emerald');
  } catch (err) {
    console.error('讀取試算表錯誤:', err);
    setSyncStatus('error', '雲端讀取失敗');
    if (manual) showToast('讀取 Google 試算表失敗，請檢查網路或 GAS 權限', 'rose');
  } finally {
    if (syncIcon) syncIcon.classList.remove('fa-spin');
  }
}

export async function pushAllToGoogleSheets(silent = false) {
  const url = (state.settings.gasUrl || '').trim();
  if (!url) {
    if (!silent) showToast('請先於設定中填入 Google Apps Script 網址', 'amber');
    return;
  }

  syncLegacyStateBackToActiveTrip();
  const activeTrip = getActiveTrip();
  const pushIcon = document.getElementById('pushIcon');
  if (pushIcon) pushIcon.classList.add('fa-bounce');
  setSyncStatus('syncing', '正在寫入試算表...');

  // 建立目前啟用行程的 day/order 對照表，保持與舊版 Spots 欄位 100% 向下相容
  const activeDayMap = {};
  Object.entries(activeTrip.itinerary || {}).forEach(([dayStr, dayObj]) => {
    (dayObj.items || []).forEach((it, idx) => {
      if (!activeDayMap[it.cardId]) {
        activeDayMap[it.cardId] = {
          day: Number(dayStr),
          order: idx + 1,
          transitMode: it.transitMode || 'auto',
          customTransitMin: it.customTransitMin ?? ''
        };
      }
    });
  });

  const spotsPayload = state.cards.map(c => {
    const sched = activeDayMap[c.id] || { day: '', order: '', transitMode: '', customTransitMin: '' };
    return {
      ...c,
      area: c.district || '',
      description: c.notes || '',
      googleMapsUrl: c.mapUrl || '',
      imageUrl: c.image || '',
      day: sched.day,
      order: sched.order,
      transitMode: sched.transitMode,
      customTransitMin: sched.customTransitMin
    };
  });

  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'syncAll',
        settings: state.settings,
        activeTripId: state.activeTripId,
        trips: state.trips,
        spots: spotsPayload
      })
    });

    setSyncStatus('connected', 'Google 試算表已同步');
    if (!silent) showToast('已將多旅程與口袋資料寫入 Google 試算表', 'emerald');
  } catch (err) {
    console.error('寫入試算表錯誤:', err);
    setSyncStatus('error', '雲端寫入失敗');
    if (!silent) showToast('寫入 Google 試算表失敗，請稍後再試', 'rose');
  } finally {
    if (pushIcon) pushIcon.classList.remove('fa-bounce');
  }
}

export function copyGasBackendCode() {
  const code = `function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var spotsSheet = ss.getSheetByName('Spots') || ss.insertSheet('Spots');
  var tripsSheet = ss.getSheetByName('Trips') || ss.insertSheet('Trips');

  var spotRows = spotsSheet.getDataRange().getValues();
  var spots = [];
  if (spotRows.length > 1) {
    var headers = spotRows[0];
    for (var i = 1; i < spotRows.length; i++) {
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        obj[headers[j]] = spotRows[i][j];
      }
      if (obj.meta && typeof obj.meta === 'string') {
        try { obj.meta = JSON.parse(obj.meta); } catch (err) { obj.meta = {}; }
      }
      spots.push(obj);
    }
  }

  var trips = [];
  var tripRows = tripsSheet.getDataRange().getValues();
  if (tripRows.length > 1) {
    for (var k = 1; k < tripRows.length; k++) {
      if (tripRows[k][1]) {
        try {
          trips.push(JSON.parse(tripRows[k][1]));
        } catch (err) {}
      }
    }
  }

  return ContentService.createTextOutput(JSON.stringify({ spots: spots, trips: trips }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var payload = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (Array.isArray(payload.spots)) {
    var spotsSheet = ss.getSheetByName('Spots') || ss.insertSheet('Spots');
    var headers = ['id', 'title', 'category', 'country', 'district', 'lat', 'lng', 'duration', 'notes', 'mapUrl', 'image', 'starred', 'day', 'order', 'transitMode', 'customTransitMin', 'meta'];
    spotsSheet.clearContents();
    spotsSheet.appendRow(headers);
    if (payload.spots.length > 0) {
      var rows = payload.spots.map(function(s) {
        return headers.map(function(h) {
          if (h === 'meta') return JSON.stringify(s.meta || {});
          return s[h] !== undefined && s[h] !== null ? s[h] : '';
        });
      });
      spotsSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
  }

  if (Array.isArray(payload.trips)) {
    var tripsSheet = ss.getSheetByName('Trips') || ss.insertSheet('Trips');
    tripsSheet.clearContents();
    tripsSheet.appendRow(['tripId', 'tripJson', 'updatedAt']);
    if (payload.trips.length > 0) {
      var nowStr = new Date().toISOString();
      var tripRows = payload.trips.map(function(t) {
        return [t.id, JSON.stringify(t), nowStr];
      });
      tripsSheet.getRange(2, 1, tripRows.length, 3).setValues(tripRows);
    }
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}`;

  navigator.clipboard.writeText(code).then(() => {
    showToast('已複製新版雙分頁 GAS 程式碼至剪貼簿', 'emerald');
  }).catch(() => {
    showToast('複製失敗，請手動授權剪貼簿權限', 'rose');
  });
}

export function exportJsonBackup() {
  syncLegacyStateBackToActiveTrip();
  const blob = new Blob(
    [JSON.stringify({ settings: state.settings, trips: state.trips, cards: state.cards }, null, 2)],
    { type: 'application/json' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `echi-go-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  showToast('已匯出 JSON 完整備份檔', 'emerald');
}
