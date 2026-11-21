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

function getOrCreateGuestDeviceId() {
  const storageKey = 'echi_go_guest_device_id_v1';
  try {
    let existing = localStorage.getItem(storageKey);
    if (existing && existing.trim()) return existing.trim();
    const generated = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(storageKey, generated);
    return generated;
  } catch (err) {
    return `dev_sess_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function detectSimpleDeviceType() {
  const ua = navigator.userAgent || '';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  return '其他裝置';
}

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

function normalizeStartTime(val) {
  if (!val) return '09:00';
  const str = String(val).trim();
  if (/^\d{1,2}:\d{2}/.test(str)) {
    const [h, m] = str.split(':');
    return `${h.padStart(2, '0')}:${m.slice(0, 2)}`;
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return '09:00';
}

function mapRawSpotsToCards(rawSpots) {
  return (rawSpots || []).map((row, idx) => {
    const areaStr = String(row.district || row.area || '').trim();
    const inferredCountry = String(row.country || '').trim() ||
      (areaStr.startsWith('台灣') || areaStr.startsWith('臺灣') ? '臺灣' : '日本');
    return {
      id: String(row.id || `spot_${Date.now()}_${idx}`).trim(),
      title: String(row.title || row.name || '未命名地點').trim(),
      category: String(row.category || '景點').trim(),
      country: inferredCountry,
      district: areaStr,
      lat: row.lat !== '' && row.lat !== null && !isNaN(Number(row.lat)) ? Number(row.lat) : null,
      lng: row.lng !== '' && row.lng !== null && !isNaN(Number(row.lng)) ? Number(row.lng) : null,
      duration: Number(row.estimated_duration ?? row.duration) || 60,
      notes: String(row.notes || row.description || '').trim(),
      mapUrl: String(row.mapUrl || row.source_url || row.googleMapsUrl || '').trim(),
      image: String(row.image || row.photo_url || row.imageUrl || '').trim(),
      starred: row.starred === true || String(row.starred).toLowerCase() === 'true',
      must_buy: String(row.must_buy || ''),
      business_hours: String(row.business_hours || ''),
      parking_info: String(row.parking_info || ''),
      meta: typeof row.meta === 'object' && row.meta !== null ? row.meta : {}
    };
  });
}

function parseLegacyItinerary(rawItinerary, totalDays) {
  const rebuilt = {};
  for (let d = 1; d <= totalDays; d++) {
    rebuilt[d] = { startTime: '09:00', items: [] };
  }

  if (Array.isArray(rawItinerary) && rawItinerary.length > 0) {
    rawItinerary.forEach((row, idx) => {
      const dayNum = parseInt(row.day, 10);
      const cardId = String(row.card_id || row.cardId || '').trim();
      if (dayNum >= 1 && dayNum <= totalDays && cardId) {
        if (row.day_start_time) {
          rebuilt[dayNum].startTime = normalizeStartTime(row.day_start_time);
        }
        const customTransitVal = row.custom_transit ?? row.customTransitMin ?? '';
        rebuilt[dayNum].items.push({
          uid: String(row.uid || `it_${cardId}_${dayNum}_${idx}`),
          cardId,
          order: parseInt(row.sort_order ?? row.order, 10) || idx + 1,
          isCheckout: row.is_checkout === true || String(row.is_checkout).toUpperCase() === 'TRUE',
          transitMode: String(row.transit_mode || row.transitMode || 'auto'),
          customTransitMin: customTransitVal !== '' && customTransitVal !== null && !isNaN(Number(customTransitVal))
            ? Number(customTransitVal)
            : null,
          customNote: String(row.custom_note || row.customNote || '')
        });
      }
    });

    Object.keys(rebuilt).forEach(d => {
      rebuilt[d].items.sort((a, b) => a.order - b.order);
    });
    return rebuilt;
  }

  if (rawItinerary && typeof rawItinerary === 'object' && !Array.isArray(rawItinerary)) {
    Object.entries(rawItinerary).forEach(([dKey, dayObj]) => {
      const dayNum = parseInt(dKey, 10);
      if (dayNum >= 1 && dayNum <= totalDays && dayObj && Array.isArray(dayObj.items)) {
        rebuilt[dayNum] = {
          startTime: normalizeStartTime(dayObj.startTime),
          items: dayObj.items
        };
      }
    });
    return rebuilt;
  }

  return null;
}

// ==================== 智慧快建端點呼叫：GAS Drive 原生 OCR ＋ Maps 短網址展開 ====================
export async function requestSmartExtractFromGas({ text = '', imageBase64 = '', mimeType = 'image/jpeg' } = {}) {
  const url = (state.settings.gasUrl || '').trim();
  const adminKey = (state.settings.adminKey || '').trim();

  if (!url || !adminKey) {
    return {
      status: 'error',
      message: '請先於右上角「⚙ 設定」填入 Google Apps Script 網址與管理員密碼'
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'smartExtract',
      adminKey,
      text,
      imageBase64,
      mimeType
    })
  });

  if (!res.ok) {
    throw new Error(`伺服器回應異常 (${res.status})`);
  }

  return await res.json();
}

// ==================== 訪客唯讀分享模式：即時讀取單一授權行程並回報匿名裝置 ====================
export async function pullSharedTripFromGoogleSheets(gasUrl, token, manual = false) {
  const url = String(gasUrl || '').trim();
  const cleanToken = String(token || '').trim();

  if (!url || !cleanToken) {
    return { ok: false, message: '分享連結缺少必要的連線參數或驗證代碼。' };
  }

  const syncIcon = document.getElementById('syncIcon');
  if (syncIcon) syncIcon.classList.add('fa-spin');
  setSyncStatus('syncing', '正在載入最新行程...');

  try {
    const deviceId = getOrCreateGuestDeviceId();
    const deviceType = detectSimpleDeviceType();
    const endpoint = `${url}${url.includes('?') ? '&' : '?'}action=getSharedTrip&token=${encodeURIComponent(cleanToken)}&deviceId=${encodeURIComponent(deviceId)}&deviceType=${encodeURIComponent(deviceType)}&t=${Date.now()}`;
    const res = await fetch(endpoint);
    const data = await res.json();

    if (data.status !== 'ok' || !data.trip) {
      setSyncStatus('error', '分享未開放或已失效');
      return {
        ok: false,
        message: data.message || '此行程目前未開放分享，或分享連結已重設失效。'
      };
    }

    const sharedTrip = createTripObject(data.trip);
    state.trips = [sharedTrip];
    state.activeTripId = sharedTrip.id;
    state.cards = mapRawSpotsToCards(data.spots || []);
    syncActiveTripToLegacyState();
    ensureItineraryDays();

    setSyncStatus('connected', '已同步最新唯讀行程');
    if (manual) showToast('已更新至最新同步行程', 'emerald');
    return { ok: true, trip: sharedTrip };
  } catch (err) {
    console.error('讀取分享行程錯誤:', err);
    setSyncStatus('error', '連線載入失敗');
    return {
      ok: false,
      message: '無法連線至行程伺服器，請確認網路狀態或稍後再試。'
    };
  } finally {
    if (syncIcon) syncIcon.classList.remove('fa-spin');
  }
}

export async function pullFromGoogleSheets(manual = false) {
  if (state.isReadOnly) return;
  const url = (state.settings.gasUrl || '').trim();
  const adminKey = (state.settings.adminKey || '').trim();

  if (!url) {
    setSyncStatus('error', '未設定試算表網址');
    if (manual) showToast('請先於右上角設定 Google Apps Script 網址', 'amber');
    return;
  }

  if (!adminKey) {
    setSyncStatus('error', '未設定管理員密碼');
    if (manual) showToast('請先於右上角「⚙ 設定」輸入管理員密碼', 'amber');
    return;
  }

  const syncIcon = document.getElementById('syncIcon');
  if (syncIcon) syncIcon.classList.add('fa-spin');
  setSyncStatus('syncing', '正在驗證並讀取...');

  try {
    const endpoint = `${url}${url.includes('?') ? '&' : '?'}action=getAll&key=${encodeURIComponent(adminKey)}&t=${Date.now()}`;
    const res = await fetch(endpoint);
    const rawJson = await res.json();

    if (rawJson.status === 'error' || rawJson.code === 'UNAUTHORIZED') {
      setSyncStatus('error', '管理員密碼錯誤');
      showToast(rawJson.message || '管理員密碼錯誤，請檢查「⚙ 設定」中的密碼是否與 Code.gs 一致', 'rose');
      return;
    }

    const data = rawJson.data && typeof rawJson.data === 'object' ? rawJson.data : rawJson;
    state.shareStats = (data.shareStats && typeof data.shareStats === 'object') ? data.shareStats : {};

    const rawSpots = Array.isArray(data.spots) ? data.spots : (Array.isArray(data.cards) ? data.cards : []);
    if (rawSpots.length > 0) {
      state.cards = mapRawSpotsToCards(rawSpots);
    }

    const total = Number(state.settings.totalDays) || 6;
    const parsedItin = data.itinerary ? parseLegacyItinerary(data.itinerary, total) : null;
    const hasItinItems = parsedItin && Object.values(parsedItin).some(d => d.items.length > 0);

    if (Array.isArray(data.trips) && data.trips.length > 0) {
      state.trips = data.trips.map(t => createTripObject(t));
      if (!state.trips.some(t => t.id === state.activeTripId)) {
        state.activeTripId = state.trips[0].id;
      }
      syncActiveTripToLegacyState();
      const activeHasItems = Object.values(state.itinerary).some(d => d.items && d.items.length > 0);
      if (!activeHasItems && hasItinItems) {
        state.itinerary = parsedItin;
        syncLegacyStateBackToActiveTrip();
      }
    } else if (hasItinItems) {
      state.itinerary = parsedItin;
      syncLegacyStateBackToActiveTrip();
    }

    ensureItineraryDays();
    persistState(false);

    if (typeof hooks.populateRegionDropdowns === 'function') hooks.populateRegionDropdowns();
    if (typeof hooks.renderAll === 'function') hooks.renderAll();

    const scheduledTotal = Object.values(state.itinerary).reduce((sum, d) => sum + (d.items?.length || 0), 0);
    setSyncStatus('connected', 'Google 試算表已連線');
    if (manual) showToast(`已成功載入 ${state.cards.length} 筆口袋卡片與 ${scheduledTotal} 項排程`, 'emerald');
  } catch (err) {
    console.error('讀取試算表錯誤:', err);
    setSyncStatus('error', '雲端讀取失敗');
    if (manual) showToast('讀取 Google 試算表失敗，請確認 GAS 已部署為新版本', 'rose');
  } finally {
    if (syncIcon) syncIcon.classList.remove('fa-spin');
  }
}

export async function pushAllToGoogleSheets(silent = false) {
  if (state.isReadOnly) return;
  const url = (state.settings.gasUrl || '').trim();
  const adminKey = (state.settings.adminKey || '').trim();

  if (!url) {
    if (!silent) showToast('請先於設定中填入 Google Apps Script 網址', 'amber');
    return;
  }

  if (!adminKey) {
    setSyncStatus('error', '未設定管理員密碼');
    if (!silent) showToast('請先於右上角「⚙ 設定」輸入管理員密碼再寫入', 'amber');
    return;
  }

  syncLegacyStateBackToActiveTrip();
  const activeTrip = getActiveTrip();
  const pushIcon = document.getElementById('pushIcon');
  if (pushIcon) pushIcon.classList.add('fa-bounce');
  setSyncStatus('syncing', '正在寫入試算表...');

  const itineraryRows = [];
  const activeDayMap = {};
  Object.entries(activeTrip.itinerary || {}).forEach(([dayStr, dayObj]) => {
    const startTime = dayObj.startTime || '09:00';
    (dayObj.items || []).forEach((it, idx) => {
      itineraryRows.push({
        uid: it.uid || `it_${it.cardId}_${dayStr}_${idx + 1}`,
        day: Number(dayStr),
        day_start_time: startTime,
        sort_order: idx + 1,
        card_id: it.cardId,
        is_checkout: Boolean(it.isCheckout),
        transit_mode: it.transitMode || 'auto',
        transit_min: 0,
        custom_transit: it.customTransitMin ?? '',
        custom_note: it.customNote || ''
      });
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
      name: c.title,
      area: c.district || '',
      description: c.notes || '',
      estimated_duration: c.duration || 60,
      source_url: c.mapUrl || '',
      photo_url: c.image || '',
      day: sched.day,
      order: sched.order,
      transitMode: sched.transitMode,
      customTransitMin: sched.customTransitMin
    };
  });

  const safeSettings = { ...state.settings };
  delete safeSettings.adminKey;

  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'syncAll',
        adminKey,
        settings: safeSettings,
        activeTripId: state.activeTripId,
        trips: state.trips,
        spots: spotsPayload,
        itinerary: itineraryRows
      })
    });

    setSyncStatus('connected', 'Google 試算表已同步');
    if (!silent) showToast('已傳送寫入請求（若密碼正確將同步至試算表）', 'emerald');
  } catch (err) {
    console.error('寫入試算表錯誤:', err);
    setSyncStatus('error', '雲端寫入失敗');
    if (!silent) showToast('寫入 Google 試算表失敗，請稍後再試', 'rose');
  } finally {
    if (pushIcon) pushIcon.classList.remove('fa-bounce');
  }
}

export function copyGasBackendCode() {
  showToast('請直接複製對話框中提供的最新 Code.gs 程式碼', 'blue');
}

export function exportJsonBackup() {
  syncLegacyStateBackToActiveTrip();
  const safeSettings = { ...state.settings };
  delete safeSettings.adminKey;
  const blob = new Blob(
    [JSON.stringify({ settings: safeSettings, trips: state.trips, cards: state.cards }, null, 2)],
    { type: 'application/json' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `echi-go-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  showToast('已匯出 JSON 完整備份檔', 'emerald');
}
