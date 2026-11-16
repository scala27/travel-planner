// ==================== Google 地圖連結座標與地名解析器 ====================
function extractCoordsFromGoogleMapsUrl(urlStr) {
  const raw = String(urlStr || '').trim();
  if (!raw) return null;

  let extractedName = '';
  try {
    const placeMatch = raw.match(/\/maps\/place\/([^\/\@\?]+)/);
    if (placeMatch && placeMatch[1]) {
      extractedName = decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')).trim();
    }
  } catch (e) {}

  // 1. 優先匹配精準地點圖釘座標 !3d緯度!4d經度
  const exactPinMatch = raw.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (exactPinMatch) {
    return {
      lat: parseFloat(exactPinMatch[1]).toFixed(6),
      lng: parseFloat(exactPinMatch[2]).toFixed(6),
      placeName: extractedName
    };
  }

  // 2. 匹配網址視野中心 @緯度,經度
  const atMatch = raw.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    return {
      lat: parseFloat(atMatch[1]).toFixed(6),
      lng: parseFloat(atMatch[2]).toFixed(6),
      placeName: extractedName
    };
  }

  // 3. 匹配 ?q=緯度,經度 或 ll=緯度,經度
  const queryCoordMatch = raw.match(/[?&](?:q|ll|destination)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (queryCoordMatch) {
    return {
      lat: parseFloat(queryCoordMatch[1]).toFixed(6),
      lng: parseFloat(queryCoordMatch[2]).toFixed(6),
      placeName: extractedName
    };
  }

  return extractedName ? { lat: '', lng: '', placeName: extractedName } : null;
}

// ==================== 全球座標反查標準行政區（國內/國外統一格式化） ====================
const reverseGeoCache = {};

function normalizeTraditionalTai(str) {
  return String(str || '').replace(/^台(灣|北|中|南|東)/g, '臺$1');
}

function formatAdminAreaFromNominatim(addr) {
  if (!addr) return '未分類';

  const countryCode = String(addr.country_code || '').toLowerCase();
  let country = addr.country || '';

  // 國內（台灣）：輸出「台灣 · 縣市 · 鄉鎮市區」，統一使用「臺」字
  if (countryCode === 'tw' || /台灣|臺灣|Taiwan/i.test(country)) {
    const county = normalizeTraditionalTai(addr.city || addr.county || addr.state || '');
    const district = normalizeTraditionalTai(addr.town || addr.suburb || addr.city_district || addr.village || '');
    if (county && district && county !== district) {
      return `台灣 · ${county} · ${district}`;
    }
    if (county) return `台灣 · ${county}`;
    return '台灣';
  }

  // 國外：輸出「國家 · 都道府縣/州 · 城市/町村」
  if (countryCode === 'jp' || /日本|Japan/i.test(country)) {
    country = '日本';
  } else if (countryCode === 'kr') {
    country = '韓國';
  } else if (countryCode === 'th') {
    country = '泰國';
  } else if (countryCode === 'us') {
    country = '美國';
  }

  const pref = addr.province || addr.state || addr.region || '';
  const city = addr.city || addr.town || addr.village || addr.county || addr.suburb || '';

  if (country && pref && city && pref !== city) {
    return `${country} · ${pref} · ${city}`;
  }
  if (country && (pref || city)) {
    return `${country} · ${pref || city}`;
  }
  return country || pref || city || '未分類';
}

async function reverseGeocodeAdminArea(lat, lng) {
  const numLat = parseFloat(lat);
  const numLng = parseFloat(lng);
  if (isNaN(numLat) || isNaN(numLng)) return null;

  const cacheKey = `${numLat.toFixed(3)},${numLng.toFixed(3)}`;
  if (reverseGeoCache[cacheKey]) return reverseGeoCache[cacheKey];

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${numLat}&lon=${numLng}&zoom=12&accept-language=zh-TW,ja,en`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data && data.address) {
      const formatted = formatAdminAreaFromNominatim(data.address);
      const result = {
        adminArea: formatted,
        displayName: data.display_name || ''
      };
      reverseGeoCache[cacheKey] = result;
      return result;
    }
  } catch (e) {
    console.warn('反查行政區失敗', e);
  }
  return null;
}

// ==================== 地理編碼輔助查詢 ====================
function getSearchBiasCenter() {
  if (mapInstance) {
    const c = mapInstance.getCenter();
    if (c && !isNaN(c.lat) && !isNaN(c.lng)) {
      return { lat: c.lat, lng: c.lng };
    }
  }
  return { lat: 26.215, lng: 127.685 };
}

async function smartGeocodePlace(queryText) {
  const bias = getSearchBiasCenter();
  const viewbox = `${(bias.lng - 1.2).toFixed(4)},${(bias.lat + 1.2).toFixed(4)},${(bias.lng + 1.2).toFixed(4)},${(bias.lat - 1.2).toFixed(4)}`;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&accept-language=zh-TW,ja,en&viewbox=${viewbox}&q=${encodeURIComponent(queryText)}`;
    const resp = await fetch(url);
    const candidates = await resp.json();

    if (Array.isArray(candidates) && candidates.length > 0) {
      candidates.sort((a, b) => {
        const dA = Math.hypot(parseFloat(a.lat) - bias.lat, parseFloat(a.lon) - bias.lng);
        const dB = Math.hypot(parseFloat(b.lat) - bias.lat, parseFloat(b.lon) - bias.lng);
        return dA - dB;
      });
      const best = candidates[0];
      const adminArea = best.address ? formatAdminAreaFromNominatim(best.address) : '';
      return {
        lat: parseFloat(best.lat).toFixed(6),
        lng: parseFloat(best.lon).toFixed(6),
        displayName: best.display_name || '',
        adminArea
      };
    }
  } catch (e) {
    console.warn('地理編碼查詢失敗', e);
  }
  return null;
}

// ==================== 批次智慧匯入與一鍵清理舊行政區標籤 ====================
async function handleQuickBatchAdd() {
  const inputEl = document.getElementById('quick-batch-input');
  const rawText = inputEl.value.trim();
  if (!rawText) {
    showToast('請輸入地點名稱或貼上 Google 地圖連結！');
    return;
  }

  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const category = document.getElementById('quick-category').value;

  const btn = document.getElementById('btn-quick-add');
  const origHtml = btn.innerHTML;
  btn.disabled = true;

  let addedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> <span>定位分類中 (${i + 1}/${lines.length})...</span>`;
    lucide.createIcons();

    let cleanName = line;
    let sourceUrl = '';
    let lat = '';
    let lng = '';
    let adminArea = '未分類';

    if (line.startsWith('http://') || line.startsWith('https://')) {
      sourceUrl = line;
      const parsedUrl = extractCoordsFromGoogleMapsUrl(line);
      if (parsedUrl) {
        if (parsedUrl.placeName) cleanName = parsedUrl.placeName;
        if (parsedUrl.lat && parsedUrl.lng) {
          lat = parsedUrl.lat;
          lng = parsedUrl.lng;
        }
      }
      if (cleanName === line) {
        cleanName = `地圖收藏點位 #${spots.length + 1}`;
      }
    }

    if (lat && lng) {
      const rev = await reverseGeocodeAdminArea(lat, lng);
      if (rev && rev.adminArea) adminArea = rev.adminArea;
    } else {
      const geo = await smartGeocodePlace(cleanName);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
        if (geo.adminArea) adminArea = geo.adminArea;
      }
    }

    const newSpot = {
      id: 'spot_' + Date.now() + '_' + i,
      name: cleanName,
      category,
      area: adminArea,
      lat,
      lng,
      estimated_duration: category === '住宿' ? 0 : (category === '交通' ? 30 : 60),
      business_hours: '',
      parking_info: '',
      must_buy: '',
      description: '',
      source_url: sourceUrl,
      photo_url: '',
      assigned_day: 'pocket',
      sort_order: '99',
      status: 'pocket'
    };

    spots.unshift(newSpot);
    addedCount++;

    if (appConfig.gasUrl) {
      fetch(appConfig.gasUrl, {
        method: 'POST',
        body: JSON.stringify({ action: 'add_spot', spot: newSpot })
      }).catch(err => console.error('新增同步失敗', err));
    }

    if (i < lines.length - 1) {
      await new Promise(r => setTimeout(r, 700));
    }
  }

  inputEl.value = '';
  btn.disabled = false;
  btn.innerHTML = origHtml;

  saveLocalState();
  renderDynamicAreaControls();
  renderAll();
  showToast(`✅ 已成功定位並自動分類 ${addedCount} 筆地點至口袋資料庫！`);
}

async function batchAutoClassifyAllSpots() {
  const validSpots = spots.filter(s => s.lat && s.lng && !isNaN(parseFloat(s.lat)) && !isNaN(parseFloat(s.lng)));
  if (validSpots.length === 0) {
    showToast('資料庫中尚無包含座標的卡片');
    return;
  }

  const btn = document.getElementById('btn-batch-classify-areas');
  const origHtml = btn.innerHTML;
  btn.disabled = true;

  let updatedCount = 0;

  for (let i = 0; i < validSpots.length; i++) {
    const s = validSpots[i];
    btn.innerHTML = `<span>🧭 依座標校準行政區 (${i + 1}/${validSpots.length})...</span>`;

    const rev = await reverseGeocodeAdminArea(s.lat, s.lng);
    if (rev && rev.adminArea && rev.adminArea !== '未分類' && s.area !== rev.adminArea) {
      s.area = rev.adminArea;
      updatedCount++;
      if (appConfig.gasUrl) {
        await fetch(appConfig.gasUrl, {
          method: 'POST',
          body: JSON.stringify({ action: 'update_spot', spot: s })
        }).catch(() => {});
      }
    }
    await new Promise(r => setTimeout(r, 450));
  }

  btn.disabled = false;
  btn.innerHTML = origHtml;
  saveLocalState();
  renderDynamicAreaControls();
  renderAll();
  lucide.createIcons();
  showToast(`✅ 已依座標將 ${updatedCount} 筆舊標籤更新為標準 國內/國外行政區！`);
}

// ==================== Google Apps Script 雙向同步 ====================
function updateSyncBadge(isLoading = false) {
  const dot = document.getElementById('sync-dot');
  const text = document.getElementById('sync-text');
  const btn = document.getElementById('btn-sync-cloud');
  const iconWrap = document.getElementById('sync-icon-wrap');
  const btnLabel = document.getElementById('sync-btn-label');

  if (!appConfig.gasUrl) {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-500';
    if (text) text.textContent = '本機模式 (未綁定試算表)';
    if (btn) btn.className = 'flex items-center gap-1.5 bg-ai-indigo hover:bg-slate-800 text-white text-xs sm:text-sm font-medium px-3 py-2 rounded-lg transition shadow-xs';
    if (iconWrap) iconWrap.innerHTML = `<i data-lucide="cloud" class="w-4 h-4"></i>`;
    if (btnLabel) btnLabel.textContent = '同步資料';
    return;
  }

  if (isLoading) {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-sky-500 animate-ping';
    if (text) text.textContent = '同步中...';
    if (btn) btn.className = 'flex items-center gap-1.5 bg-sky-600 text-white text-xs sm:text-sm font-medium px-3 py-2 rounded-lg transition shadow-xs';
    if (iconWrap) iconWrap.innerHTML = `<i data-lucide="refresh-cw" class="w-4 h-4 animate-spin"></i>`;
    if (btnLabel) btnLabel.textContent = '同步中...';
    lucide.createIcons();
    return;
  }

  if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-500';
  if (text) text.textContent = 'Google 試算表已連線';
  if (btn) btn.className = 'flex items-center gap-1.5 bg-ai-indigo hover:bg-slate-800 text-white text-xs sm:text-sm font-medium px-3 py-2 rounded-lg transition shadow-xs';
  if (iconWrap) iconWrap.innerHTML = `<i data-lucide="cloud-check" class="w-4 h-4"></i>`;
  if (btnLabel) btnLabel.textContent = '已同步';
  lucide.createIcons();
}

async function syncFromCloud() {
  if (!appConfig.gasUrl) {
    openModal('modal-settings');
    showToast('請先貼上您的 Google Apps Script 網址！');
    return;
  }

  updateSyncBadge(true);
  try {
    const resp = await fetch(`${appConfig.gasUrl}?action=get_all`);
    const data = await resp.json();
    if (data.status === 'success') {
      if (data.config) {
        if (data.config.trip_title) appConfig.tripTitle = data.config.trip_title;
        if (data.config.start_date) appConfig.startDate = String(data.config.start_date).slice(0, 10);
        if (data.config.end_date) appConfig.endDate = String(data.config.end_date).slice(0, 10);
        if (data.config.day_start_times) {
          try { dayStartTimes = JSON.parse(data.config.day_start_times); } catch (e) {}
        }
      }
      if (Array.isArray(data.spots)) {
        spots = data.spots.map(s => ({
          ...s,
          id: String(s.id),
          estimated_duration: Number(s.estimated_duration) || (s.category === '住宿' ? 0 : (s.category === '交通' ? 30 : 60)),
          sort_order: String(s.sort_order || '99'),
          assigned_day: String(s.assigned_day || 'pocket')
        }));
      }
      saveLocalState();
      loadLocalState();
      renderAll();
      showToast('☁️ 已成功與 Google 試算表完成雙向同步！');
    } else {
      throw new Error(data.message || '回傳格式錯誤');
    }
  } catch (err) {
    console.error(err);
    showToast('❌ 同步失敗，請確認 GAS 網址與權限設定');
  } finally {
    updateSyncBadge(false);
  }
}

async function saveBoardOrderToCloud() {
  saveLocalState();
  if (!appConfig.gasUrl) {
    showToast('已儲存於本機瀏覽器（尚未設定雲端網址）');
    return;
  }

  const updates = spots.map(s => ({
    id: s.id,
    assigned_day: s.assigned_day,
    sort_order: s.sort_order,
    is_revisit: isSpotRevisit(s)
  }));

  updateSyncBadge(true);
  try {
    const resp = await fetch(appConfig.gasUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'sync_board',
        updates,
        day_start_times: JSON.stringify(dayStartTimes)
      })
    });
    const res = await resp.json();
    if (res.status === 'success') {
      showToast('☁️ 每日行程排程與出發時刻已同步至試算表！');
    }
  } catch (e) {
    showToast('雲端儲存發生異常，請檢查網路連線');
  } finally {
    updateSyncBadge(false);
  }
}
