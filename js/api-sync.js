// ==================== 應用程式啟動與本機狀態管理 ====================
window.addEventListener('DOMContentLoaded', () => {
  loadLocalState();
  initMap();
  initResizer();
  renderAll();
  lucide.createIcons();
  registerInlinePWA();

  if (appConfig.gasUrl) {
    syncFromCloud();
  } else {
    setSyncButtonState('idle');
  }
});

function loadLocalState() {
  const savedCfg = localStorage.getItem(STORAGE_KEY_CONFIG) || localStorage.getItem(LEGACY_STORAGE_KEY_CONFIG);
  if (savedCfg) {
    appConfig = { ...appConfig, ...JSON.parse(savedCfg) };
  }

  const savedSpots = localStorage.getItem(STORAGE_KEY_SPOTS) || localStorage.getItem(LEGACY_STORAGE_KEY_SPOTS);
  spots = savedSpots ? JSON.parse(savedSpots) : [...DEFAULT_SPOTS];

  const savedLegs = localStorage.getItem(STORAGE_KEY_LEG_MODES);
  if (savedLegs) legModeOverrides = JSON.parse(savedLegs);

  const savedStarts = localStorage.getItem(STORAGE_KEY_DAY_STARTS);
  if (savedStarts) dayStartTimes = JSON.parse(savedStarts);

  renderDynamicAreaControls();
  updateHeaderUI();
  updateSyncBadge();
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY_SPOTS, JSON.stringify(spots));
  localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(appConfig));
  localStorage.setItem(STORAGE_KEY_LEG_MODES, JSON.stringify(legModeOverrides));
  localStorage.setItem(STORAGE_KEY_DAY_STARTS, JSON.stringify(dayStartTimes));
}

function updateHeaderUI() {
  document.getElementById('header-trip-title').textContent = appConfig.tripTitle;
  const daysList = getDateRangeArray(appConfig.startDate, appConfig.endDate);
  document.getElementById('header-trip-dates').textContent = 
    `${appConfig.startDate} ~ ${appConfig.endDate} (${daysList.length}天${Math.max(0, daysList.length - 1)}夜)`;

  document.getElementById('setting-gas-url').value = appConfig.gasUrl || '';
  document.getElementById('setting-trip-title').value = appConfig.tripTitle;
  document.getElementById('setting-start-date').value = appConfig.startDate;
  document.getElementById('setting-end-date').value = appConfig.endDate;
  const areasInput = document.getElementById('setting-trip-areas');
  if (areasInput) areasInput.value = appConfig.tripAreas || '台灣出發, 那霸市區, 沖繩中部, 沖繩北部, 沖繩南部';
}

function updateSyncBadge(customText, colorClass) {
  const dot = document.getElementById('sync-dot');
  const text = document.getElementById('sync-text');
  if (customText) {
    dot.className = `w-2 h-2 rounded-full ${colorClass || 'bg-amber-500'}`;
    text.textContent = customText;
    return;
  }
  if (appConfig.gasUrl) {
    dot.className = 'w-2 h-2 rounded-full bg-emerald-500';
    text.textContent = 'Google 試算表已連線';
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-amber-500';
    text.textContent = '本機離線模式';
  }
}

function setSyncButtonState(state) {
  const iconWrap = document.getElementById('sync-icon-wrap');
  const label = document.getElementById('sync-btn-label');
  if (!iconWrap) return;

  if (state === 'syncing') {
    iconWrap.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>`;
    if (label) label.textContent = '同步中...';
  } else if (state === 'synced') {
    iconWrap.innerHTML = `<i data-lucide="cloud-check" class="w-4 h-4 text-emerald-300"></i>`;
    if (label) label.textContent = '已同步';
  } else if (state === 'error') {
    iconWrap.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4 text-amber-300"></i>`;
    if (label) label.textContent = '重試同步';
  } else {
    iconWrap.innerHTML = `<i data-lucide="cloud" class="w-4 h-4"></i>`;
    if (label) label.textContent = '同步資料';
  }
  lucide.createIcons();
}

// ==================== 全球地址查詢與 Google 地圖連結 ====================
function updateGoogleMapsPlaceLink() {
  const name = document.getElementById('field-name').value.trim();
  const area = document.getElementById('field-area')?.value || '';
  const sourceUrl = document.getElementById('field-source-url').value.trim();
  const linkBtn = document.getElementById('btn-open-gmaps-place');
  const navBtn = document.getElementById('btn-google-nav');

  const queryText = (area && !area.includes('出發') && name && !name.includes(area))
    ? `${area} ${name}`
    : name;

  const gmapsUrl = (sourceUrl && sourceUrl.includes('google.com/maps'))
    ? sourceUrl
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryText || 'Google Maps')}`;

  if (linkBtn) linkBtn.href = gmapsUrl;
  if (navBtn) navBtn.href = gmapsUrl;
}

async function handleLookupPlaceAddress() {
  const name = document.getElementById('field-name').value.trim();
  const area = document.getElementById('field-area').value;
  const sourceUrl = document.getElementById('field-source-url').value.trim();

  if (!name) {
    showToast('請先輸入地點名稱！');
    return;
  }
  if (!appConfig.gasUrl) {
    showToast('請先在右上角設定中連線 Google Apps Script 後端，即可查詢全球精準地址！');
    return;
  }

  const btn = document.getElementById('btn-lookup-address');
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> <span>查詢中...</span>`;
  lucide.createIcons();

  try {
    const res = await fetch(appConfig.gasUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'fetch_place_info',
        name: name,
        area: area,
        source_url: sourceUrl
      })
    });
    const data = await res.json();
    if (data.status === 'success' && data.place_info) {
      const info = data.place_info;
      latestPlaceAddress = info.address || '';
      const resBox = document.getElementById('place-address-result');
      const addrEl = document.getElementById('place-address-text');
      const coordEl = document.getElementById('place-coords-text');

      resBox.classList.remove('hidden');
      addrEl.textContent = info.address || '已定位座標（無詳細街道文字）';
      coordEl.textContent = (info.lat && info.lng)
        ? `座標：${Number(info.lat).toFixed(6)}, ${Number(info.lng).toFixed(6)}`
        : '尚未取得座標';

      if (info.lat) document.getElementById('field-lat').value = info.lat;
      if (info.lng) document.getElementById('field-lng').value = info.lng;
      if (info.maps_url) {
        document.getElementById('btn-open-gmaps-place').href = info.maps_url;
      }
      showToast('✅ 已取得精準地址與經緯度！');
    } else {
      throw new Error(data.message || '查詢失敗');
    }
  } catch (err) {
    showToast('⚠️ 地址查詢失敗：' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="locate-fixed" class="w-3.5 h-3.5"></i> <span>查詢精準地址</span>`;
    lucide.createIcons();
  }
}

function applyAddressToParking() {
  if (!latestPlaceAddress) return;
  const parkingEl = document.getElementById('field-parking');
  const cur = parkingEl.value.trim();
  if (!cur.includes(latestPlaceAddress)) {
    parkingEl.value = cur ? `${latestPlaceAddress} / ${cur}` : latestPlaceAddress;
  }
  showToast('📋 已將官方地址填入欄位！');
}

// ==================== 批次建卡與預設國內外樞紐匯入 ====================
async function handleQuickBatchAdd() {
  const inputEl = document.getElementById('quick-batch-input');
  const rawText = inputEl.value.trim();
  const category = document.getElementById('quick-category').value;
  const area = document.getElementById('quick-area').value;

  if (!rawText) {
    showToast('請輸入地點名稱（可一次輸入多行）或貼上 Google Maps 連結！');
    return;
  }

  if (!appConfig.gasUrl) {
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    lines.reverse().forEach((line, idx) => {
      const isTransport = /空港|機場|Airport|車站|高鐵|台鐵|單軌|地鐵|港口|碼頭|租車|駅|Station/i.test(line);
      const resolvedCat = isTransport ? '交通' : category;
      spots.unshift({
        id: 'spot_' + Date.now() + '_' + idx,
        name: line,
        category: resolvedCat,
        area: area,
        description: '',
        must_buy: '',
        business_hours: resolvedCat === '住宿' ? '15:00入住 / 11:00退房' : '',
        estimated_duration: resolvedCat === '購物' ? 120 : (resolvedCat === '住宿' ? 0 : (resolvedCat === '交通' ? 30 : 60)),
        parking_info: '',
        source_url: line.startsWith('http') ? line : '',
        photo_url: '',
        status: 'pocket',
        assigned_day: 'pocket',
        sort_order: '1',
        lat: '',
        lng: ''
      });
    });
    saveLocalState();
    renderAll();
    inputEl.value = '';
    showToast(`✅ 已加入 ${lines.length} 張卡片至資料庫（連線後端可自動全球定位）！`);
    return;
  }

  const btn = document.getElementById('btn-quick-add');
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> <span>全球定位入庫中...</span>`;
  lucide.createIcons();

  try {
    const res = await fetch(appConfig.gasUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'quick_batch_add',
        input: rawText,
        category: category,
        area: area
      })
    });
    const data = await res.json();
    if (data.status === 'success' && data.spots && data.spots.length > 0) {
      data.spots.reverse().forEach(s => spots.unshift(s));
      saveLocalState();
      renderAll();
      inputEl.value = '';
      const names = data.spots.map(s => s.name).join('、');
      showToast(`✅ 已定位並加入 ${data.spots.length} 張卡片至資料庫：${names}`);
    } else {
      throw new Error(data.message || '建卡失敗');
    }
  } catch (err) {
    showToast('⚠️ 建卡失敗：' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="map-pin-plus" class="w-3.5 h-3.5"></i> <span>批次自動定位並加入資料庫</span>`;
    lucide.createIcons();
  }
}

async function importPresetHubs(hubType) {
  const sourceList = hubType === 'taiwan' ? PRESET_TAIWAN_HUBS : PRESET_OKINAWA_STATIONS;
  const labelText = hubType === 'taiwan' ? '台灣出發機場與高鐵樞紐' : '沖繩單軌與機場樞紐';
  const existingNames = new Set(spots.map(s => s.name.trim()));

  const toAdd = sourceList.filter(st => !existingNames.has(st.name.trim())).map((st, idx) => ({
    ...st,
    id: `spot_hub_${hubType}_` + Date.now() + '_' + idx,
    parking_info: '',
    source_url: '',
    photo_url: '',
    status: 'pocket',
    assigned_day: 'pocket',
    sort_order: String(10 + idx)
  }));

  if (toAdd.length === 0) {
    showToast(`${labelText}已全數在資料庫中！`);
    return;
  }

  toAdd.reverse().forEach(s => spots.unshift(s));
  saveLocalState();
  renderAll();
  showToast(`🚉 已匯入 ${toAdd.length} 個${labelText}至資料庫！`);

  if (appConfig.gasUrl) {
    fetch(appConfig.gasUrl, {
      method: 'POST',
      body: JSON.stringify({ action: 'import_preset_spots', spots: toAdd })
    }).catch(err => console.error('樞紐背景同步失敗', err));
  }
}

// ==================== 卡片編輯視窗與 CRUD 操作 ====================
function openNewCardModal(prefillText = '') {
  resetAddressLookupUI();
  renderDynamicAreaControls();
  document.getElementById('modal-card-title').textContent = '新增資料庫卡片';
  document.getElementById('card-form').reset();
  document.getElementById('field-id').value = '';
  document.getElementById('field-name').value = prefillText.startsWith('http') ? '' : prefillText;
  document.getElementById('field-source-url').value = prefillText.startsWith('http') ? prefillText : '';
  document.getElementById('field-revisit').checked = false;
  document.querySelectorAll('input[name="stay_days"]').forEach(cb => { cb.checked = false; });
  toggleMultiDayStayUI();
  updateGoogleMapsPlaceLink();
  document.getElementById('btn-delete-card').classList.add('hidden');
  document.getElementById('btn-google-nav').classList.add('hidden');
  openModal('modal-card-detail');
}

function openEditCardModal(id) {
  const spot = spots.find(s => s.id === id);
  if (!spot) return;

  resetAddressLookupUI();
  renderDynamicAreaControls();
  document.getElementById('modal-card-title').textContent = '編輯資料庫卡片詳情';
  document.getElementById('field-id').value = spot.id;
  document.getElementById('field-name').value = spot.name || '';
  document.getElementById('field-category').value = spot.category || '景點';

  // 若卡片原有區域不在目前設定清單內，動態補入該選項以免遺失
  const areaSel = document.getElementById('field-area');
  if (spot.area && ![...areaSel.options].some(o => o.value === spot.area)) {
    const opt = document.createElement('option');
    opt.value = spot.area;
    opt.textContent = spot.area;
    areaSel.appendChild(opt);
  }
  areaSel.value = spot.area || getTripAreasList()[0];

  document.getElementById('field-duration').value = spot.estimated_duration !== undefined ? spot.estimated_duration : 60;
  document.getElementById('field-revisit').checked = isSpotRevisit(spot);

  const uniqueDays = getSpotUniqueDays(spot);
  document.getElementById('field-day').value = uniqueDays.length > 0 ? uniqueDays[0] : 'pocket';
  document.querySelectorAll('input[name="stay_days"]').forEach(cb => {
    cb.checked = uniqueDays.includes(cb.value);
  });
  toggleMultiDayStayUI();

  document.getElementById('field-description').value = spot.description || '';
  document.getElementById('field-must-buy').value = spot.must_buy || '';
  document.getElementById('field-hours').value = spot.business_hours || '';
  document.getElementById('field-parking').value = spot.parking_info || '';
  document.getElementById('field-source-url').value = spot.source_url || '';
  document.getElementById('field-photo-url').value = spot.photo_url || '';
  document.getElementById('field-lat').value = spot.lat || '';
  document.getElementById('field-lng').value = spot.lng || '';

  updateGoogleMapsPlaceLink();
  document.getElementById('btn-delete-card').classList.remove('hidden');
  document.getElementById('btn-google-nav').classList.remove('hidden');

  openModal('modal-card-detail');
}

async function handleSaveCard(e) {
  e.preventDefault();
  const id = document.getElementById('field-id').value;
  const category = document.getElementById('field-category').value;
  const isRevisit = document.getElementById('field-revisit').checked;
  const existingSpot = id ? spots.find(s => s.id === id) : null;

  let assignedDay = 'pocket';
  let sortOrderStr = existingSpot ? String(existingSpot.sort_order || '99') : '99';

  if (category === '住宿') {
    const checkedDays = [...document.querySelectorAll('input[name="stay_days"]:checked')].map(cb => cb.value);
    if (checkedDays.length === 0) {
      assignedDay = 'pocket';
      sortOrderStr = '99';
    } else {
      const prevOccs = existingSpot ? getSpotOccurrences(existingSpot) : [];
      const nextOccs = [];
      checkedDays.sort().forEach(dStr => {
        const matched = prevOccs.filter(o => o.dateStr === dStr);
        if (matched.length > 0) {
          nextOccs.push(...matched);
        } else {
          nextOccs.push({ dateStr: dStr, order: 1 });
        }
      });
      assignedDay = nextOccs.map(o => o.dateStr).join(',');
      sortOrderStr = nextOccs.map(o => o.order).join(',');
    }
  } else {
    const selDay = document.getElementById('field-day').value;
    assignedDay = selDay;
    if (selDay === 'pocket') {
      sortOrderStr = '99';
    } else if (existingSpot && getSpotUniqueDays(existingSpot).includes(selDay)) {
      const prevOccs = getSpotOccurrences(existingSpot).filter(o => o.dateStr === selDay);
      assignedDay = prevOccs.map(o => o.dateStr).join(',');
      sortOrderStr = prevOccs.map(o => o.order).join(',');
    }
  }

  const baseStatus = assignedDay === 'pocket' ? 'pocket' : 'scheduled';
  const finalStatus = isRevisit ? `${baseStatus}|revisit` : baseStatus;

  const cardObj = {
    id: id || ('spot_' + Date.now()),
    name: document.getElementById('field-name').value.trim(),
    category: category,
    area: document.getElementById('field-area').value,
    estimated_duration: Number(document.getElementById('field-duration').value) || 0,
    assigned_day: assignedDay,
    sort_order: sortOrderStr,
    status: finalStatus,
    description: document.getElementById('field-description').value.trim(),
    must_buy: document.getElementById('field-must-buy').value.trim(),
    business_hours: document.getElementById('field-hours').value.trim(),
    parking_info: document.getElementById('field-parking').value.trim(),
    source_url: document.getElementById('field-source-url').value.trim(),
    photo_url: document.getElementById('field-photo-url').value.trim(),
    lat: document.getElementById('field-lat').value.trim(),
    lng: document.getElementById('field-lng').value.trim()
  };

  if (id) {
    const idx = spots.findIndex(s => s.id === id);
    if (idx > -1) spots[idx] = { ...spots[idx], ...cardObj };
  } else {
    spots.unshift(cardObj);
  }

  saveLocalState();
  renderAll();
  closeModal('modal-card-detail');
  showToast('資料庫卡片已儲存！');

  if (appConfig.gasUrl) {
    try {
      const res = await fetch(appConfig.gasUrl, {
        method: 'POST',
        body: JSON.stringify({ action: id ? 'update_spot' : 'add_spot', spot: cardObj })
      });
      const data = await res.json();
      if (data.status === 'success' && data.spot) {
        const idx = spots.findIndex(s => s.id === data.spot.id);
        if (idx > -1) spots[idx] = data.spot;
        saveLocalState();
        renderAll();
      }
    } catch (err) {
      console.error('同步失敗', err);
    }
  }
}

async function handleDeleteCard() {
  const id = document.getElementById('field-id').value;
  if (!id || !confirm('確定要從資料庫永久刪除這張卡片嗎？')) return;

  spots = spots.filter(s => s.id !== id);
  saveLocalState();
  renderAll();
  closeModal('modal-card-detail');
  showToast('已從資料庫刪除卡片');

  if (appConfig.gasUrl) {
    fetch(appConfig.gasUrl, {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_spot', id })
    });
  }
}

// ==================== 雲端雙向同步與系統設定 ====================
async function syncFromCloud() {
  if (!appConfig.gasUrl) {
    openModal('modal-settings');
    showToast('請先設定 Google Apps Script 網址');
    return;
  }

  const btn = document.getElementById('btn-sync-cloud');
  btn.disabled = true;
  setSyncButtonState('syncing');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(appConfig.gasUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const contentType = res.headers.get('content-type') || '';
    const rawText = await res.text();

    if (!contentType.includes('application/json') && rawText.trim().startsWith('<')) {
      throw new Error('GAS 回傳了網頁而非 JSON，請確認部署權限「誰可以存取」已設為「所有人 (Anyone)」。');
    }

    const data = JSON.parse(rawText);
    if (data.status === 'success') {
      spots = data.spots || [];
      if (data.config) {
        if (data.config.trip_title) appConfig.tripTitle = data.config.trip_title;
        if (data.config.start_date) appConfig.startDate = String(data.config.start_date).slice(0, 10);
        if (data.config.end_date) appConfig.endDate = String(data.config.end_date).slice(0, 10);
        if (data.config.trip_areas) appConfig.tripAreas = data.config.trip_areas;
        if (data.config.day_start_times) {
          try {
            const parsedStarts = JSON.parse(data.config.day_start_times);
            dayStartTimes = { ...dayStartTimes, ...parsedStarts };
          } catch (e) {}
        }
      }
      saveLocalState();
      renderDynamicAreaControls();
      updateHeaderUI();
      updateSyncBadge('Google 試算表已連線', 'bg-emerald-500');
      renderAll();
      setSyncButtonState('synced');
      showToast(`✅ 同步完成！資料庫共 ${spots.length} 張卡片`);
    } else {
      throw new Error(data.message || '後端回傳錯誤');
    }
  } catch (err) {
    clearTimeout(timeoutId);
    updateSyncBadge('連線異常 (點擊重試)', 'bg-red-500');
    setSyncButtonState('error');
    const errMsg = err.name === 'AbortError'
      ? '連線逾時（超過15秒），請檢查網路或 GAS 部署狀態。'
      : err.message;
    showToast('⚠️ ' + errMsg);
    console.error('Sync Error:', err);
  } finally {
    btn.disabled = false;
  }
}

function saveBoardOrderToCloud() {
  handleDragEnd();
  if (!appConfig.gasUrl) {
    showToast('已儲存於本機瀏覽器');
  } else {
    setSyncButtonState('synced');
    showToast('已將最新排程順序同步至雲端試算表！');
  }
}

function saveSettings() {
  appConfig.gasUrl = document.getElementById('setting-gas-url').value.trim();
  appConfig.tripTitle = document.getElementById('setting-trip-title').value.trim() || '2027沖繩首發自由行';
  appConfig.startDate = document.getElementById('setting-start-date').value;
  appConfig.endDate = document.getElementById('setting-end-date').value;
  appConfig.tripAreas = document.getElementById('setting-trip-areas').value.trim() || '台灣出發, 那霸市區, 沖繩中部, 沖繩北部, 沖繩南部';

  saveLocalState();
  renderDynamicAreaControls();
  updateHeaderUI();
  updateSyncBadge();
  renderAll();
  closeModal('modal-settings');

  if (appConfig.gasUrl) {
    fetch(appConfig.gasUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_config',
        config: {
          trip_title: appConfig.tripTitle,
          start_date: appConfig.startDate,
          end_date: appConfig.endDate,
          trip_areas: appConfig.tripAreas,
          day_start_times: JSON.stringify(dayStartTimes)
        }
      })
    });
    syncFromCloud();
  } else {
    showToast('設定與自訂區域已儲存並套用！');
  }
}

function registerInlinePWA() {
  if ('serviceWorker' in navigator) {
    const swCode = `
      self.addEventListener('install', e => self.skipWaiting());
      self.addEventListener('fetch', e => {
        if (e.request.method !== 'GET') return;
        e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
      });
    `;
    const blob = new Blob([swCode], { type: 'application/javascript' });
    navigator.serviceWorker.register(URL.createObjectURL(blob)).catch(() => {});
  }
}
