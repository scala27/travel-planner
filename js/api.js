import { CATEGORY_META, isTransportOrAirport } from './config.js';
import {
  state,
  hooks,
  persistState,
  ensureItineraryDays,
  getCardScheduledDays,
  setSyncPillStatus,
  showToast
} from './state.js';
import { normalizeAdministrativeDistrict } from './geo.js';

export function extractRowsFromGasPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) {
    if (payload.length > 0 && Array.isArray(payload[0])) {
      const headers = payload[0].map(h => String(h || '').trim());
      return payload.slice(1).map(arr => {
        const obj = {};
        headers.forEach((h, i) => { if (h) obj[h] = arr[i]; });
        return obj;
      });
    }
    return payload;
  }
  if (typeof payload === 'object') {
    const priorityKeys = ['pois', 'spots', 'Spots', 'data', 'records', 'cards', 'rows', 'items', 'list'];
    for (const key of priorityKeys) {
      if (Array.isArray(payload[key]) && payload[key].length > 0) {
        return extractRowsFromGasPayload(payload[key]);
      }
    }
    for (const val of Object.values(payload)) {
      if (Array.isArray(val) && val.length > 0) {
        const extracted = extractRowsFromGasPayload(val);
        if (extracted.length > 0 && typeof extracted[0] === 'object') return extracted;
      }
    }
  }
  return [];
}

export function normalizeSheetRowToCard(row, index) {
  const id = String(row.id || `spot_${Date.now()}_${index}`);
  const title = String(row.name || row.title || '未命名地點').trim();
  const rawArea = String(row.area || row.district || '').trim();
  let country = String(row.country || '').trim();
  if (!country) {
    if (rawArea.includes('台灣') || rawArea.includes('臺灣') || rawArea.includes('臺中') || rawArea.includes('台中') || rawArea.includes('台北')) {
      country = '台灣';
    } else {
      country = '日本';
    }
  }

  const cleanDistrict = normalizeAdministrativeDistrict(rawArea, country);
  let category = String(row.category || '景點').trim();
  if (!CATEGORY_META[category]) category = '景點';

  const rawHours = String(row.business_hours || row.businessHours || '').trim();
  const rawMustBuy = String(row.must_buy || row.mustBuy || '').trim();
  const rawParking = String(row.parking_info || row.parkingInfo || '').trim();

  let departTime = String(row.departTime || '').trim();
  let arriveTime = String(row.arriveTime || '').trim();
  let flightNo = String(row.flightNo || '').trim();
  if (isTransportOrAirport(category) && !departTime && rawHours) {
    const cleaned = rawHours.replace(/^✈️\s*/, '').replace(/^🚆\s*/, '');
    const parts = cleaned.split(/[-~→>]/).map(s => s.trim());
    if (parts.length >= 2) {
      departTime = parts[0];
      arriveTime = parts[1];
    } else {
      departTime = cleaned;
    }
  }

  const lat = parseFloat(row.lat);
  const lng = parseFloat(row.lng);
  const createdNum = parseInt(id.replace(/\D/g, '').slice(0, 13), 10);

  return {
    id,
    title,
    category,
    country,
    district: cleanDistrict,
    rawArea,
    duration: parseInt(row.estimated_duration || row.duration, 10) || 60,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    mapUrl: String(row.source_url || row.mapUrl || '').trim(),
    image: String(row.photo_url || row.image || '').trim(),
    notes: String(row.description || row.notes || '').trim(),
    mustBuy: rawMustBuy,
    businessHours: rawHours,
    parkingInfo: rawParking,
    departTime,
    arriveTime,
    flightNo: flightNo || (isTransportOrAirport(category) ? rawMustBuy : ''),
    checkInOut: String(row.checkInOut || (category === '住宿' ? rawHours : '')).trim(),
    bookingRef: String(row.bookingRef || (category === '住宿' ? rawMustBuy : '')).trim(),
    sheetStatus: String(row.status || 'pocket').trim(),
    assignedDayRaw: String(row.assigned_day || '').trim(),
    sortOrder: parseInt(row.sort_order, 10) || (index + 1),
    starred: row.starred === true || String(row.starred).toUpperCase() === 'TRUE',
    createdAt: Number.isFinite(createdNum) && createdNum > 1000000000 ? createdNum : (1700000000 + index),
    isNew: false
  };
}

export function resolveAssignedDayNumbers(assignedRaw) {
  if (!assignedRaw || assignedRaw === 'pocket' || assignedRaw === 'unscheduled') return [];
  const totalDays = Number(state.settings.totalDays) || 6;
  const startParts = String(state.settings.startDate || '').split('-').map(Number);
  const startLocal = startParts.length === 3
    ? new Date(startParts[0], startParts[1] - 1, startParts[2])
    : new Date(state.settings.startDate + 'T00:00:00');

  const result = [];
  const rawStr = String(assignedRaw).trim();

  const dayTagMatches = [...rawStr.matchAll(/(?:day|d)\s*(\d+)/gi)];
  if (dayTagMatches.length > 0) {
    dayTagMatches.forEach(m => {
      const d = parseInt(m[1], 10);
      if (d >= 1 && d <= totalDays && !result.includes(d)) result.push(d);
    });
    if (result.length > 0) return result;
  }

  const tokens = rawStr.split(/[,;、\s]+/).map(s => s.trim()).filter(Boolean);
  tokens.forEach(tok => {
    if (/^\d+$/.test(tok)) {
      const d = parseInt(tok, 10);
      if (d >= 1 && d <= totalDays && !result.includes(d)) result.push(d);
      return;
    }

    let targetLocal = null;
    if (tok.includes('T')) {
      const parsedIso = new Date(tok);
      if (!isNaN(parsedIso.getTime())) {
        targetLocal = new Date(parsedIso.getFullYear(), parsedIso.getMonth(), parsedIso.getDate());
      }
    } else if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(tok)) {
      const [y, m, d] = tok.split(/[-/]/).map(Number);
      targetLocal = new Date(y, m - 1, d);
    } else {
      const fallback = new Date(tok);
      if (!isNaN(fallback.getTime())) {
        targetLocal = new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
      }
    }

    if (!isNaN(startLocal.getTime()) && targetLocal && !isNaN(targetLocal.getTime())) {
      const diffDays = Math.round((targetLocal.getTime() - startLocal.getTime()) / 86400000) + 1;
      if (diffDays >= 1 && diffDays <= totalDays && !result.includes(diffDays)) {
        result.push(diffDays);
      }
    }
  });

  return result;
}

export function serializeCardToSheetRow(card, index) {
  const scheduledDays = getCardScheduledDays(card.id);
  const isScheduled = scheduledDays.length > 0;
  let hoursCol = card.businessHours || '';
  let mustBuyCol = card.mustBuy || '';
  if (isTransportOrAirport(card.category)) {
    const prefix = card.category === '機場' ? '✈️ ' : '🚆 ';
    if (card.departTime || card.arriveTime) {
      hoursCol = `${prefix}${card.departTime || ''}${card.arriveTime ? ' ~ ' + card.arriveTime : ''}`.trim();
    }
    if (card.flightNo) mustBuyCol = card.flightNo;
  } else if (card.category === '住宿') {
    if (card.checkInOut) hoursCol = card.checkInOut;
    if (card.bookingRef) mustBuyCol = card.bookingRef;
  }

  const cleanDist = normalizeAdministrativeDistrict(card.district, card.country);
  const areaFormatted = cleanDist.startsWith(card.country) ? cleanDist : `${card.country}・${cleanDist}`;

  return {
    id: card.id,
    name: card.title,
    category: card.category,
    area: areaFormatted,
    description: card.notes || '',
    must_buy: mustBuyCol,
    business_hours: hoursCol,
    estimated_duration: card.duration || 60,
    parking_info: card.parkingInfo || '',
    source_url: card.mapUrl || '',
    photo_url: card.image || '',
    starred: !!card.starred,
    status: isScheduled ? 'scheduled' : 'pocket',
    assigned_day: isScheduled ? scheduledDays.map(d => `Day ${d}`).join(',') : 'pocket',
    sort_order: index + 1,
    lat: card.lat ?? '',
    lng: card.lng ?? ''
  };
}

// 將每日排程序列化為獨立「每日行程排程」工作表列位（完整保留手動鎖定分鐘數與車次備註）
export function serializeItineraryToSheetRows() {
  const totalDays = Number(state.settings.totalDays) || 6;
  const rows = [];

  for (let d = 1; d <= totalDays; d++) {
    const dayObj = state.itinerary[d] || { startTime: '09:00', items: [] };
    const startTime = dayObj.startTime || '09:00';
    const items = dayObj.items || [];

    items.forEach((it, idx) => {
      rows.push({
        uid: it.uid || `it_${d}_${idx + 1}_${it.cardId}`,
        day: d,
        day_start_time: startTime,
        sort_order: idx + 1,
        card_id: it.cardId,
        is_checkout: !!it.isCheckout,
        transit_mode: it.transitMode || 'auto',
        transit_min: Number(it.transitMin) || 0,
        custom_transit_note: it.customTransitNote || '',
        custom_note: it.customNote || ''
      });
    });
  }

  return rows;
}

function getItinerarySequenceWeight(cardId) {
  const totalDays = Number(state.settings.totalDays) || 6;
  for (let d = 1; d <= totalDays; d++) {
    const items = state.itinerary[d]?.items || [];
    const idx = items.findIndex(it => it.cardId === cardId);
    if (idx !== -1) {
      return d * 1000 + idx;
    }
  }
  return 999999;
}

async function fetchGasEndpoint(baseUrl, querySuffix = '') {
  const sep = baseUrl.includes('?') ? '&' : '?';
  const cacheBust = `_t=${Date.now()}`;
  const targetUrl = querySuffix ? `${baseUrl}${sep}${querySuffix}&${cacheBust}` : `${baseUrl}${sep}${cacheBust}`;
  const res = await fetch(targetUrl, { method: 'GET', redirect: 'follow', cache: 'no-store' });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

export async function pullFromGoogleSheets(showNotification = true) {
  if (!state.settings.gasUrl) {
    if (showNotification) showToast('請先點右上角齒輪填入 Google Apps Script 網址', 'amber');
    return;
  }
  const icon = document.getElementById('syncIcon');
  const label = document.getElementById('syncBtnLabel');
  if (icon) icon.classList.add('fa-spin');
  if (label) label.textContent = '載入中...';
  setSyncPillStatus('syncing', '正在從試算表載入...');

  try {
    const json = await fetchGasEndpoint(state.settings.gasUrl, '');
    let rows = [];
    let dualItineraryRows = null;

    if (json && typeof json === 'object' && Array.isArray(json.pois)) {
      rows = json.pois.filter(r => r && (r.name || r.title));
      if (Array.isArray(json.itinerary)) {
        dualItineraryRows = json.itinerary;
      }
    } else {
      rows = extractRowsFromGasPayload(json).filter(r => r && (r.name || r.title));
    }

    if (rows.length > 0) {
      const mappedCards = rows
        .map((r, idx) => normalizeSheetRowToCard(r, idx))
        .filter(c => !state.deletedIds.includes(c.id));

      state.cards = mappedCards;

      ensureItineraryDays();
      const totalDays = Number(state.settings.totalDays) || 6;
      const rebuilt = {};
      for (let d = 1; d <= totalDays; d++) {
        rebuilt[d] = { startTime: state.itinerary[d]?.startTime || '09:00', items: [] };
      }

      if (Array.isArray(dualItineraryRows)) {
        // 雙工作表模式：精準還原每日排程順序、出發時間與手動鎖定分鐘數
        dualItineraryRows
          .slice()
          .sort((a, b) => (Number(a.day) - Number(b.day)) || (Number(a.sort_order) - Number(b.sort_order)))
          .forEach((row, idx) => {
            const d = Number(row.day);
            const cardId = String(row.card_id || row.poiId || '').trim();
            if (!d || d < 1 || d > totalDays || !cardId) return;
            if (!mappedCards.some(c => c.id === cardId)) return;

            if (row.day_start_time && String(row.day_start_time).includes(':')) {
              rebuilt[d].startTime = String(row.day_start_time).trim().slice(0, 5);
            }

            rebuilt[d].items.push({
              uid: String(row.uid || `it_${d}_${idx + 1}_${cardId}`),
              cardId,
              customNote: String(row.custom_note || '').trim(),
              isCheckout: row.is_checkout === true || String(row.is_checkout).toUpperCase() === 'TRUE',
              transitMode: String(row.transit_mode || 'auto').trim() || 'auto',
              transitMin: Number(row.transit_min) || 0,
              customTransitNote: String(row.custom_transit_note || '').trim()
            });
          });
        state.itinerary = rebuilt;
      } else {
        // 相容舊版單表 fallback
        mappedCards
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .forEach(c => {
            const dayNums = resolveAssignedDayNumbers(c.assignedDayRaw);
            dayNums.forEach((dayNum, dIdx) => {
              if (rebuilt[dayNum]) {
                rebuilt[dayNum].items.push({
                  uid: `it_${c.id}_${dayNum}`,
                  cardId: c.id,
                  customNote: c.businessHours || '',
                  isCheckout: c.category === '住宿' && dIdx > 0,
                  transitMode: 'auto',
                  transitMin: 0,
                  customTransitNote: ''
                });
              }
            });
          });

        const hasSheetSchedule = Object.values(rebuilt).some(d => d.items.length > 0);
        if (hasSheetSchedule) {
          state.itinerary = rebuilt;
        }
      }

      state.hasUnsavedCloudChanges = false;
      persistState(false);
      hooks.populateRegionDropdowns();
      hooks.renderAll();
      const nowStr = new Date().toTimeString().slice(0, 5);
      const totalScheduledItems = Object.values(state.itinerary).reduce((sum, d) => sum + (d.items?.length || 0), 0);
      setSyncPillStatus('ok', `已載入 ${mappedCards.length} 景點 / ${totalScheduledItems} 排程 (${nowStr})`);
      if (showNotification) {
        showToast(`已成功從 Google 試算表載入 ${mappedCards.length} 筆景點與 ${totalScheduledItems} 筆排程！`, 'emerald');
      }
    } else {
      setSyncPillStatus('warning', '試算表無資料列');
      if (showNotification) {
        showToast('試算表無資料列，請確認 GAS 腳本已部署最新版本', 'amber');
      }
    }
  } catch (err) {
    console.error('GAS GET Error:', err);
    setSyncPillStatus('warning', '讀取試算表失敗');
    if (showNotification) {
      showToast('讀取試算表失敗，請確認 GAS 部署權限為「所有人」', 'amber');
    }
  } finally {
    if (icon) icon.classList.remove('fa-spin');
    if (label) label.textContent = '重新載入';
  }
}

export async function pushAllToGoogleSheets(isSilentAuto = false, extraDeletedId = null) {
  persistState(false);
  if (!state.settings.gasUrl) {
    if (!isSilentAuto) showToast('已儲存至本機；如需寫入試算表請點齒輪設定 GAS 網址', 'blue');
    return;
  }

  const pushIcon = document.getElementById('pushIcon');
  if (pushIcon) pushIcon.classList.add('fa-bounce');
  setSyncPillStatus('syncing', '正在同步雙工作表...');

  try {
    const orderedCards = state.cards
      .map((card, origIdx) => ({
        card,
        origIdx,
        seqWeight: getItinerarySequenceWeight(card.id)
      }))
      .sort((a, b) => (a.seqWeight !== b.seqWeight ? a.seqWeight - b.seqWeight : a.origIdx - b.origIdx));

    const sortOrderMap = {};
    orderedCards.forEach((entry, sortedIdx) => {
      sortOrderMap[entry.card.id] = sortedIdx;
    });

    const sheetRows = state.cards.map((c, idx) =>
      serializeCardToSheetRow(c, sortOrderMap[c.id] ?? idx)
    );
    const itineraryRows = serializeItineraryToSheetRows();

    if (extraDeletedId) {
      try {
        await fetch(state.settings.gasUrl, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'deleteSpot',
            id: extraDeletedId
          })
        });
      } catch (e) {}
    }

    const res = await fetch(state.settings.gasUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'syncAll',
        schemaVersion: '2.0',
        deletedIds: state.deletedIds,
        pois: sheetRows,
        data: sheetRows,
        itineraryRows: itineraryRows,
        itinerary: state.itinerary
      })
    });
    const respText = await res.text();
    let respJson = null;
    try { respJson = JSON.parse(respText); } catch (e) {}

    if (respJson && respJson.status === 'error') {
      throw new Error(respJson.message || 'GAS 寫入回傳錯誤');
    }

    state.hasUnsavedCloudChanges = false;
    const nowStr = new Date().toTimeString().slice(0, 5);
    setSyncPillStatus('ok', `已同步 ${sheetRows.length} 景點 / ${itineraryRows.length} 排程 (${nowStr})`);
    if (!isSilentAuto) {
      showToast(`已將 ${sheetRows.length} 筆景點與 ${itineraryRows.length} 筆每日排程完整寫入試算表！`, 'emerald');
    }
  } catch (err) {
    console.error('GAS POST Error:', err);
    setSyncPillStatus('warning', '試算表寫入異常（請檢查 GAS 部署）');
    if (!isSilentAuto) {
      showToast('寫入試算表異常，請點右上角齒輪檢查 GAS 最新雙工作表程式碼', 'amber');
    }
  } finally {
    if (pushIcon) pushIcon.classList.remove('fa-bounce');
  }
}

export function copyGasBackendCode() {
  const gasCode = `const SHEET_POIS = '景點資料庫';
const SHEET_ITINERARY = '每日行程排程';

const POI_HEADERS = [
  'id', 'name', 'category', 'area', 'description',
  'must_buy', 'business_hours', 'estimated_duration',
  'parking_info', 'source_url', 'photo_url', 'starred',
  'lat', 'lng', 'updated_at'
];

const ITINERARY_HEADERS = [
  'uid', 'day', 'day_start_time', 'sort_order', 'card_id',
  'is_checkout', 'transit_mode', 'transit_min',
  'custom_transit_note', 'custom_note', 'updated_at'
];

function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureDualSheetsAndMigrate_(ss);
    const pois = readSheetObjects_(ss.getSheetByName(SHEET_POIS), POI_HEADERS);
    const itinerary = readSheetObjects_(ss.getSheetByName(SHEET_ITINERARY), ITINERARY_HEADERS);
    itinerary.sort((a, b) => (Number(a.day || 0) - Number(b.day || 0)) || (Number(a.sort_order || 0) - Number(b.sort_order || 0)));
    return jsonResponse_({ status: 'ok', schemaVersion: '2.0', pois: pois, itinerary: itinerary });
  } catch (err) {
    return jsonResponse_({ status: 'error', message: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureDualSheetsAndMigrate_(ss);
    const poiSheet = ss.getSheetByName(SHEET_POIS);
    const itinSheet = ss.getSheetByName(SHEET_ITINERARY);
    const nowStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');

    if (body.action === 'deleteSpot' && body.id) {
      deleteRowsByColumnValue_(poiSheet, 1, String(body.id));
      deleteRowsByColumnValue_(itinSheet, 5, String(body.id));
      return jsonResponse_({ status: 'ok' });
    }

    const poiList = body.pois || body.data || body.spots || body.cards;
    if (Array.isArray(poiList)) {
      const poiMatrix = poiList.map(item => [
        String(item.id || ''), String(item.name || item.title || ''), String(item.category || '景點'),
        String(item.area || ''), String(item.description || ''), String(item.must_buy || ''),
        String(item.business_hours || ''), Number(item.estimated_duration) || 60, String(item.parking_info || ''),
        String(item.source_url || ''), String(item.photo_url || ''),
        item.starred === true || String(item.starred).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE',
        item.lat !== '' && item.lat !== null && item.lat !== undefined ? Number(item.lat) : '',
        item.lng !== '' && item.lng !== null && item.lng !== undefined ? Number(item.lng) : '',
        nowStr
      ]);
      overwriteSheetData_(poiSheet, POI_HEADERS, poiMatrix);
    }

    if (Array.isArray(body.itineraryRows)) {
      const itinMatrix = body.itineraryRows.map((row, idx) => [
        String(row.uid || \`it_\${row.day}_\${idx + 1}\`), Number(row.day) || 1, String(row.day_start_time || '09:00'),
        Number(row.sort_order !== undefined ? row.sort_order : idx + 1), String(row.card_id || ''),
        row.is_checkout === true || String(row.is_checkout).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE',
        String(row.transit_mode || 'auto'), Number(row.transit_min) || 0,
        String(row.custom_transit_note || ''), String(row.custom_note || ''), nowStr
      ]);
      overwriteSheetData_(itinSheet, ITINERARY_HEADERS, itinMatrix, [3]);
    }

    return jsonResponse_({ status: 'ok', schemaVersion: '2.0', savedAt: nowStr });
  } catch (err) {
    return jsonResponse_({ status: 'error', message: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function ensureDualSheetsAndMigrate_(ss) {
  let poiSheet = ss.getSheetByName(SHEET_POIS);
  let itinSheet = ss.getSheetByName(SHEET_ITINERARY);
  const isFirstInit = !poiSheet && !itinSheet;
  if (!poiSheet) { poiSheet = ss.insertSheet(SHEET_POIS); formatHeaderRow_(poiSheet, POI_HEADERS, '#1e40af'); }
  if (!itinSheet) { itinSheet = ss.insertSheet(SHEET_ITINERARY); formatHeaderRow_(itinSheet, ITINERARY_HEADERS, '#0f766e'); }
  if (isFirstInit) {
    const legacySheet = ss.getSheets().find(s => s.getName() !== SHEET_POIS && s.getName() !== SHEET_ITINERARY && s.getLastRow() >= 2);
    if (legacySheet) migrateLegacySheet_(legacySheet, poiSheet, itinSheet);
  }
}

function migrateLegacySheet_(legacySheet, poiSheet, itinSheet) {
  const values = legacySheet.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = values[0].map(h => String(h || '').trim());
  const idxOf = (names) => { for (const n of names) { const i = headers.findIndex(h => h.toLowerCase() === n.toLowerCase()); if (i >= 0) return i; } return -1; };
  const cId = idxOf(['id']), cName = idxOf(['name', 'title']), cCat = idxOf(['category']), cArea = idxOf(['area', 'district']);
  const cDesc = idxOf(['description', 'notes']), cMust = idxOf(['must_buy', 'mustBuy']), cHours = idxOf(['business_hours', 'businessHours']);
  const cDur = idxOf(['estimated_duration', 'duration']), cPark = idxOf(['parking_info', 'parkingInfo']), cUrl = idxOf(['source_url', 'mapUrl']);
  const cPhoto = idxOf(['photo_url', 'image']), cStar = idxOf(['starred']), cDay = idxOf(['assigned_day', 'day']), cOrder = idxOf(['sort_order', 'order']);
  const cLat = idxOf(['lat']), cLng = idxOf(['lng']);
  const nowStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  const seenIds = new Set(), poiMatrix = [], rawItinItems = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const name = cName >= 0 ? String(row[cName] || '').trim() : '';
    if (!name) continue;
    const id = cId >= 0 && String(row[cId]).trim() ? String(row[cId]).trim() : \`spot_mig_\${r}\`;
    const cat = cCat >= 0 ? String(row[cCat] || '景點').trim() : '景點';
    const sortOrder = cOrder >= 0 ? (parseInt(row[cOrder], 10) || r) : r;
    if (!seenIds.has(id)) {
      seenIds.add(id);
      poiMatrix.push([id, name, cat, cArea >= 0 ? String(row[cArea] || '').trim() : '', cDesc >= 0 ? String(row[cDesc] || '').trim() : '',
        cMust >= 0 ? String(row[cMust] || '').trim() : '', cHours >= 0 ? String(row[cHours] || '').trim() : '',
        cDur >= 0 ? (parseInt(row[cDur], 10) || 60) : 60, cPark >= 0 ? String(row[cPark] || '').trim() : '',
        cUrl >= 0 ? String(row[cUrl] || '').trim() : '', cPhoto >= 0 ? String(row[cPhoto] || '').trim() : '',
        cStar >= 0 && String(row[cStar]).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE',
        cLat >= 0 && row[cLat] !== '' ? Number(row[cLat]) : '', cLng >= 0 && row[cLng] !== '' ? Number(row[cLng]) : '', nowStr]);
    }
    const assignedRaw = cDay >= 0 ? String(row[cDay] || '').trim() : '';
    if (assignedRaw && assignedRaw !== 'pocket' && assignedRaw !== 'unscheduled') {
      const dayMatches = [...assignedRaw.matchAll(/(?:day|d)\\s*(\\d+)/gi)];
      const days = dayMatches.length > 0 ? dayMatches.map(m => parseInt(m[1], 10)).filter(n => n > 0) : assignedRaw.split(/[,，\\s]+/).map(s => parseInt(s, 10)).filter(n => n > 0 && n <= 30);
      days.forEach((d, dIdx) => rawItinItems.push({ uid: \`mig_\${id}_d\${d}_\${dIdx}\`, day: d, sort_order: sortOrder, card_id: id, is_checkout: cat === '住宿' && dIdx > 0 ? 'TRUE' : 'FALSE' }));
    }
  }
  if (poiMatrix.length > 0) overwriteSheetData_(poiSheet, POI_HEADERS, poiMatrix);
  if (rawItinItems.length > 0) {
    rawItinItems.sort((a, b) => a.day - b.day || a.sort_order - b.sort_order);
    const itinMatrix = rawItinItems.map((it, idx) => [it.uid, it.day, '09:00', idx + 1, it.card_id, it.is_checkout, 'auto', 0, '', '', nowStr]);
    overwriteSheetData_(itinSheet, ITINERARY_HEADERS, itinMatrix, [3]);
  }
}

function overwriteSheetData_(sheet, headers, matrix, textColIndices = []) {
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (matrix.length > 0) {
    textColIndices.forEach(colIdx => sheet.getRange(2, colIdx, matrix.length, 1).setNumberFormat('@'));
    sheet.getRange(2, 1, matrix.length, headers.length).setValues(matrix);
  }
}

function deleteRowsByColumnValue_(sheet, colIndex1Based, targetVal) {
  if (!sheet || sheet.getLastRow() < 2) return;
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) if (String(data[i][colIndex1Based - 1]).trim() === targetVal) sheet.deleteRow(i + 1);
}

function readSheetObjects_(sheet, headers) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const sheetHeaders = values[0].map(h => String(h || '').trim());
  const result = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.every(c => c === '' || c === null)) continue;
    const obj = {};
    headers.forEach(h => { const idx = sheetHeaders.indexOf(h); obj[h] = idx >= 0 ? row[idx] : ''; });
    result.push(obj);
  }
  return result;
}

function formatHeaderRow_(sheet, headers, bgHex) {
  const range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]); range.setBackground(bgHex); range.setFontColor('#ffffff'); range.setFontWeight('bold'); sheet.setFrozenRows(1);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}`;
  navigator.clipboard.writeText(gasCode).then(() => {
    showToast('已複製最新雙工作表 GAS 完整程式碼！請貼入 Apps Script 並部署新版本', 'emerald');
  });
}

export function exportJsonBackup() {
  const blob = new Blob([JSON.stringify({ settings: state.settings, cards: state.cards, itinerary: state.itinerary }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.settings.tripTitle}_備份.json`;
  a.click();
}
