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
    const priorityKeys = ['spots', 'Spots', 'data', 'records', 'cards', 'rows', 'items', 'list'];
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

// 同時相容 "Day 1"、"1"、"2027-02-17" 與 Google 試算表自動轉型的 ISO 時區字串（如 "2027-02-16T16:00:00.000Z"）
export function resolveAssignedDayNumbers(assignedRaw) {
  if (!assignedRaw || assignedRaw === 'pocket' || assignedRaw === 'unscheduled') return [];
  const totalDays = Number(state.settings.totalDays) || 6;
  const startParts = String(state.settings.startDate || '').split('-').map(Number);
  const startLocal = startParts.length === 3
    ? new Date(startParts[0], startParts[1] - 1, startParts[2])
    : new Date(state.settings.startDate + 'T00:00:00');

  const result = [];
  const rawStr = String(assignedRaw).trim();

  // 先抓取明確的 "Day 1" / "D1" 標記
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
    status: isScheduled ? 'scheduled' : 'pocket',
    // 以 "Day 1" 純文字格式儲存，徹底避免 Google 試算表自動轉成日期物件
    assigned_day: isScheduled ? scheduledDays.map(d => `Day ${d}`).join(',') : 'pocket',
    sort_order: index + 1,
    lat: card.lat ?? '',
    lng: card.lng ?? ''
  };
}

// 計算每張卡片在當日行程中的順序權重，確保重新載入後 Day 內的卡片順序不變
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
    const candidateQueries = ['', 'sheet=Spots', 'action=getSpots', 'action=read&sheet=Spots'];
    let rows = [];

    for (const q of candidateQueries) {
      const json = await fetchGasEndpoint(state.settings.gasUrl, q);
      const extracted = extractRowsFromGasPayload(json).filter(r => r && (r.name || r.title));
      if (extracted.length > 0) {
        rows = extracted;
        break;
      }
    }

    if (rows.length > 0) {
      const mappedCards = rows
        .map((r, idx) => normalizeSheetRowToCard(r, idx))
        .filter(c => !state.deletedIds.includes(c.id));

      state.cards = mappedCards;

      ensureItineraryDays();
      const rebuilt = {};
      const totalDays = Number(state.settings.totalDays) || 6;
      for (let d = 1; d <= totalDays; d++) {
        rebuilt[d] = { startTime: state.itinerary[d]?.startTime || '09:00', items: [] };
      }

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
                transitMode: 'transit',
                transitMin: 0
              });
            }
          });
        });

      const hasSheetSchedule = Object.values(rebuilt).some(d => d.items.length > 0);
      if (hasSheetSchedule) {
        state.itinerary = rebuilt;
      }

      persistState(false);
      hooks.populateRegionDropdowns();
      hooks.renderAll();
      const nowStr = new Date().toTimeString().slice(0, 5);
      setSyncPillStatus('ok', `已載入 ${mappedCards.length} 筆 (${nowStr})`);
      if (showNotification) {
        showToast(`已成功從 Google 試算表載入 ${mappedCards.length} 筆資料！`, 'emerald');
      }
    } else {
      setSyncPillStatus('warning', '試算表無資料列');
      if (showNotification) {
        showToast('試算表無資料列，請確認 GAS 腳本是否讀取「Spots」工作表', 'amber');
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
  setSyncPillStatus('syncing', '正在覆蓋寫入試算表...');

  try {
    // 依當日行程順序賦予 sort_order，確保下次重新載入時排序完全一致
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

    if (extraDeletedId) {
      try {
        await fetch(state.settings.gasUrl, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'deleteSpot',
            sheet: 'Spots',
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
        mode: 'overwrite',
        clearRemaining: true,
        sheet: 'Spots',
        deletedIds: state.deletedIds,
        data: sheetRows,
        spots: sheetRows,
        cards: sheetRows,
        itinerary: state.itinerary
      })
    });
    const respText = await res.text();
    let respJson = null;
    try { respJson = JSON.parse(respText); } catch (e) {}

    if (respJson && respJson.status === 'error') {
      throw new Error(respJson.message || 'GAS 寫入回傳錯誤');
    }

    const nowStr = new Date().toTimeString().slice(0, 5);
    setSyncPillStatus('ok', `已寫入試算表 ${sheetRows.length} 筆 (${nowStr})`);
    if (!isSilentAuto) {
      showToast(`已將最新 ${sheetRows.length} 筆資料完整寫入 Google 試算表！`, 'emerald');
    }
  } catch (err) {
    console.error('GAS POST Error:', err);
    setSyncPillStatus('warning', '試算表寫入異常（請點齒輪檢查GAS）');
    if (!isSilentAuto) {
      showToast('寫入試算表異常，請點右上角齒輪檢查 GAS 覆蓋寫入程式碼', 'amber');
    }
  } finally {
    if (pushIcon) pushIcon.classList.remove('fa-bounce');
  }
}

export function copyGasBackendCode() {
  const gasCode = `function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Spots') || ss.getSheets()[0];
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ok', data: [] })).setMimeType(ContentService.MimeType.JSON);
  }
  const headers = values[0].map(h => String(h).trim());
  const rows = values.slice(1).filter(r => r[0] || r[1]).map(r => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = r[i]; });
    return obj;
  });
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok', data: rows })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Spots') || ss.getSheets()[0];
    const body = JSON.parse(e.postData.contents);
    const headers = ['id','name','category','area','description','must_buy','business_hours','estimated_duration','parking_info','source_url','photo_url','status','assigned_day','sort_order','lat','lng'];

    if (body.action === 'deleteSpot' && body.id) {
      const data = sheet.getDataRange().getValues();
      for (let i = data.length - 1; i >= 1; i--) {
        if (String(data[i][0]) === String(body.id)) {
          sheet.deleteRow(i + 1);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
    }

    const list = body.data || body.spots || body.cards || [];
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (list.length > 0) {
      const matrix = list.map(item => headers.map(h => item[h] !== undefined ? item[h] : ''));
      const dataRange = sheet.getRange(2, 1, matrix.length, headers.length);
      sheet.getRange(2, 13, matrix.length, 1).setNumberFormat('@');
      dataRange.setValues(matrix);
    }
    return ContentService.createTextOutput(JSON.stringify({ status: 'ok', count: list.length })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}`;
  navigator.clipboard.writeText(gasCode).then(() => {
    showToast('已複製標準 GAS 完整程式碼！請貼入 Apps Script 並部署新版本', 'emerald');
  });
}

export function exportJsonBackup() {
  const blob = new Blob([JSON.stringify({ settings: state.settings, cards: state.cards, itinerary: state.itinerary }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.settings.tripTitle}_備份.json`;
  a.click();
}
