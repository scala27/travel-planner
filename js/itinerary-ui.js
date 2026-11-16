// ==================== 機票起迄時刻與時差解析器 ====================
/**
 * 解析卡片中的航班時刻格式：例如 "✈️ 16:45-19:20 (+1h)" 或 "16:45-19:20 (-1h)"
 * 回傳 { depStr, arrStr, depMins, arrMins, tzDiff, flightMins } 或 null
 */
function parseFlightSchedule(hoursStr) {
  const raw = String(hoursStr || '').trim();
  if (!raw) return null;

  // 必須帶有 ✈️ 標記或明確的 (+Xh)/(-Xh) 時差標記，避免誤判一般機場營業時間 (如 06:00-23:00)
  const match = raw.match(/(?:✈️|航班)?\s*(\d{1,2}:\d{2})\s*[-~～→]\s*(\d{1,2}:\d{2})(?:\s*\(([+-]?\d+(?:\.\d+)?)h\))?/i);
  if (!match) return null;

  const hasFlightIndicator = /✈️|航班/.test(raw) || match[3] !== undefined;
  if (!hasFlightIndicator) return null;

  const depParts = match[1].split(':');
  const arrParts = match[2].split(':');
  const depH = parseInt(depParts[0], 10);
  const depM = parseInt(depParts[1], 10);
  const arrH = parseInt(arrParts[0], 10);
  const arrM = parseInt(arrParts[1], 10);

  if (isNaN(depH) || isNaN(arrH)) return null;

  const depStr = `${String(depH).padStart(2, '0')}:${String(depM).padStart(2, '0')}`;
  const arrStr = `${String(arrH).padStart(2, '0')}:${String(arrM).padStart(2, '0')}`;
  const depMins = depH * 60 + depM;
  const arrMins = arrH * 60 + arrM;
  const tzDiff = match[3] !== undefined ? parseFloat(match[3]) : 0;

  // 實際飛行分鐘數 = (當地抵達 - 出發起飛) - 時差*60；若跨午夜則 +1440
  let flightMins = (arrMins - depMins) - Math.round(tzDiff * 60);
  if (flightMins <= 0) flightMins += 1440;

  return { depStr, arrStr, depMins, arrMins, tzDiff, flightMins };
}

function syncFlightInputsToHoursField() {
  const depVal = document.getElementById('flight-dep-time')?.value || '';
  const arrVal = document.getElementById('flight-arr-time')?.value || '';
  const tzVal = parseFloat(document.getElementById('flight-tz-diff')?.value || '0');
  const hoursInput = document.getElementById('field-hours');
  const previewEl = document.getElementById('flight-calc-preview');

  if (!depVal || !arrVal) {
    if (previewEl) {
      previewEl.textContent = '輸入機票上的起飛與當地抵達時間後，看板將自動以此時刻為基準計算報到、實際飛行分鐘數與後續轉乘時間。';
    }
    return;
  }

  const tzTag = tzVal > 0 ? `+${tzVal}h` : `${tzVal}h`;
  const formatted = `✈️ ${depVal}-${arrVal} (${tzTag})`;
  if (hoursInput) hoursInput.value = formatted;

  const parsed = parseFlightSchedule(formatted);
  if (parsed && previewEl) {
    const stayBuffer = Number(document.getElementById('field-duration')?.value) || 0;
    const checkinStr = minutesToTimeStr(parsed.depMins - stayBuffer);
    previewEl.innerHTML = `✅ 實際飛行 <strong>${parsed.flightMins} 分鐘</strong>｜系統將自動錨定：<strong>${checkinStr} 報到 ～ ${parsed.depStr} 起飛</strong>，並於 <strong>${parsed.arrStr}</strong> 接續目的地當地時間。`;
  }
}

function populateFlightInputsFromHoursField() {
  const hoursVal = document.getElementById('field-hours')?.value || '';
  const depEl = document.getElementById('flight-dep-time');
  const arrEl = document.getElementById('flight-arr-time');
  const tzEl = document.getElementById('flight-tz-diff');
  const previewEl = document.getElementById('flight-calc-preview');
  if (!depEl || !arrEl || !tzEl) return;

  const parsed = parseFlightSchedule(hoursVal);
  if (parsed) {
    depEl.value = parsed.depStr;
    arrEl.value = parsed.arrStr;
    tzEl.value = String(parsed.tzDiff);
    if (previewEl) {
      const stayBuffer = Number(document.getElementById('field-duration')?.value) || 0;
      const checkinStr = minutesToTimeStr(parsed.depMins - stayBuffer);
      previewEl.innerHTML = `✅ 實際飛行 <strong>${parsed.flightMins} 分鐘</strong>｜系統將自動錨定：<strong>${checkinStr} 報到 ～ ${parsed.depStr} 起飛</strong>，並於 <strong>${parsed.arrStr}</strong> 接續目的地當地時間。`;
    }
  } else {
    depEl.value = '';
    arrEl.value = '';
    if (previewEl) {
      previewEl.textContent = '輸入機票上的起飛與當地抵達時間後，看板將自動以此時刻為基準計算報到、實際飛行分鐘數與後續轉乘時間。';
    }
  }
}

function clearFlightScheduleInputs() {
  const depEl = document.getElementById('flight-dep-time');
  const arrEl = document.getElementById('flight-arr-time');
  const hoursEl = document.getElementById('field-hours');
  if (depEl) depEl.value = '';
  if (arrEl) arrEl.value = '';
  if (hoursEl && parseFlightSchedule(hoursEl.value)) {
    hoursEl.value = '';
  }
  populateFlightInputsFromHoursField();
}

function handleCategoryFieldChange() {
  const cat = document.getElementById('field-category').value;
  const multiBox = document.getElementById('multi-day-stay-box');
  const singleWrap = document.getElementById('single-day-select-wrap');
  const flightBox = document.getElementById('flight-schedule-box');
  const durLabel = document.getElementById('label-duration-field');

  if (cat === '住宿') {
    multiBox.classList.remove('hidden');
    singleWrap.classList.add('opacity-40', 'pointer-events-none');
  } else {
    multiBox.classList.add('hidden');
    singleWrap.classList.remove('opacity-40', 'pointer-events-none');
  }

  if (cat === '交通') {
    flightBox.classList.remove('hidden');
    if (durLabel) durLabel.textContent = '報到/轉乘緩衝(分)';
    populateFlightInputsFromHoursField();
  } else {
    flightBox.classList.add('hidden');
    if (durLabel) durLabel.textContent = '預計停留(分)';
  }
}

// ==================== 卡片新增、編修、儲存與刪除視窗控制 ====================
let latestPlaceAddress = '';

function updateGoogleMapsPlaceLink() {
  const name = document.getElementById('field-name')?.value.trim() || '';
  const srcUrl = document.getElementById('field-source-url')?.value.trim() || '';
  const linkEl = document.getElementById('btn-open-gmaps-place');
  if (!linkEl) return;

  if (srcUrl && (srcUrl.includes('google.com/maps') || srcUrl.includes('maps.app.goo.gl'))) {
    linkEl.href = srcUrl;
  } else if (name) {
    linkEl.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
  } else {
    linkEl.href = 'https://www.google.com/maps';
  }
}

async function handleLookupPlaceAddress() {
  const name = document.getElementById('field-name')?.value.trim();
  if (!name) {
    showToast('請先輸入地點名稱再查詢地址');
    return;
  }
  const btn = document.getElementById('btn-lookup-address');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span>查詢中...</span>`;

  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=zh-TW,ja,en&q=${encodeURIComponent(name)}`);
    const data = await resp.json();
    if (data && data.length > 0) {
      const hit = data[0];
      latestPlaceAddress = hit.display_name || '';
      document.getElementById('place-address-text').textContent = latestPlaceAddress;
      document.getElementById('place-coords-text').textContent = `座標：${parseFloat(hit.lat).toFixed(5)}, ${parseFloat(hit.lon).toFixed(5)}`;
      document.getElementById('place-address-result').classList.remove('hidden');

      if (!document.getElementById('field-lat').value) document.getElementById('field-lat').value = hit.lat;
      if (!document.getElementById('field-lng').value) document.getElementById('field-lng').value = hit.lon;
    } else {
      showToast('找不到精準地址，建議直接點擊右側「開啟 Google 地圖」複製');
    }
  } catch (e) {
    showToast('地址查詢暫時無法連線，請稍後再試');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
    lucide.createIcons();
  }
}

function applyAddressToParking() {
  if (!latestPlaceAddress) return;
  const parkingInput = document.getElementById('field-parking');
  parkingInput.value = parkingInput.value ? `${latestPlaceAddress} (${parkingInput.value})` : latestPlaceAddress;
  showToast('已將地址填入下方欄位！');
}

function openNewCardModal(prefill = {}) {
  const daysList = getDateRangeArray(appConfig.startDate, appConfig.endDate);
  populateDaySelectors(daysList);

  document.getElementById('card-form').reset();
  document.getElementById('modal-card-title').textContent = '新增資料庫卡片';
  document.getElementById('field-id').value = '';
  document.getElementById('field-name').value = prefill.name || '';
  document.getElementById('field-category').value = prefill.category || document.getElementById('quick-category')?.value || '景點';

  const areaSel = document.getElementById('field-area');
  const defaultArea = prefill.area || document.getElementById('quick-area')?.value || (appConfig.areas && appConfig.areas[0]) || '未分類';
  if ([...areaSel.options].some(o => o.value === defaultArea)) {
    areaSel.value = defaultArea;
  }

  document.getElementById('field-duration').value = prefill.estimated_duration !== undefined ? prefill.estimated_duration : 60;
  document.getElementById('field-day').value = prefill.assigned_day || 'pocket';
  document.getElementById('field-revisit').checked = false;
  document.getElementById('btn-delete-card').classList.add('hidden');
  document.getElementById('btn-google-nav').href = 'https://www.google.com/maps';

  document.querySelectorAll('input[name="stay_days"]').forEach(cb => { cb.checked = false; });

  resetAddressLookupUI();
  updateGoogleMapsPlaceLink();
  handleCategoryFieldChange();
  openModal('modal-card-detail');
  lucide.createIcons();
}

function openEditCardModal(id) {
  const spot = spots.find(s => String(s.id) === String(id));
  if (!spot) return;

  const daysList = getDateRangeArray(appConfig.startDate, appConfig.endDate);
  populateDaySelectors(daysList);

  document.getElementById('modal-card-title').textContent = '編輯資料庫卡片';
  document.getElementById('field-id').value = spot.id;
  document.getElementById('field-name').value = spot.name || '';
  document.getElementById('field-category').value = spot.category || '景點';

  const areaSel = document.getElementById('field-area');
  if (spot.area && ![...areaSel.options].some(o => o.value === spot.area)) {
    const opt = document.createElement('option');
    opt.value = spot.area;
    opt.textContent = spot.area;
    areaSel.appendChild(opt);
  }
  areaSel.value = spot.area || (areaSel.options[0] ? areaSel.options[0].value : '');

  document.getElementById('field-duration').value = spot.estimated_duration !== undefined ? spot.estimated_duration : 60;
  document.getElementById('field-revisit').checked = isSpotRevisit(spot);
  document.getElementById('field-description').value = spot.description || '';
  document.getElementById('field-must-buy').value = spot.must_buy || '';
  document.getElementById('field-hours').value = spot.business_hours || '';
  document.getElementById('field-parking').value = spot.parking_info || '';
  document.getElementById('field-source-url').value = spot.source_url || '';
  document.getElementById('field-photo-url').value = spot.photo_url || '';
  document.getElementById('field-lat').value = spot.lat || '';
  document.getElementById('field-lng').value = spot.lng || '';

  const assignedDays = getSpotAssignedDays(spot);
  document.getElementById('field-day').value = assignedDays[0] || 'pocket';

  document.querySelectorAll('input[name="stay_days"]').forEach(cb => {
    cb.checked = assignedDays.includes(cb.value);
  });

  const navBtn = document.getElementById('btn-google-nav');
  if (spot.lat && spot.lng) {
    navBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}`;
  } else {
    navBtn.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(spot.name || '')}`;
  }

  document.getElementById('btn-delete-card').classList.remove('hidden');

  resetAddressLookupUI();
  updateGoogleMapsPlaceLink();
  handleCategoryFieldChange();
  openModal('modal-card-detail');
  lucide.createIcons();
}

async function handleSaveCard(event) {
  event.preventDefault();

  const existingId = document.getElementById('field-id').value.trim();
  const name = document.getElementById('field-name').value.trim();
  if (!name) return;

  const category = document.getElementById('field-category').value;
  const area = document.getElementById('field-area').value;
  const estimated_duration = Number(document.getElementById('field-duration').value) || 0;
  const isRevisit = document.getElementById('field-revisit').checked;

  let lat = document.getElementById('field-lat').value.trim();
  let lng = document.getElementById('field-lng').value.trim();

  // 若座標留空，自動透過 Nominatim 地理編碼補齊
  if (!lat || !lng) {
    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(name)}`);
      const geo = await resp.json();
      if (geo && geo.length > 0) {
        lat = geo[0].lat;
        lng = geo[0].lon;
      }
    } catch (e) {}
  }

  let assigned_day = 'pocket';
  let sort_order = '99';

  if (category === '住宿') {
    const checkedDays = [...document.querySelectorAll('input[name="stay_days"]:checked')].map(cb => cb.value);
    if (checkedDays.length > 0) {
      assigned_day = checkedDays.join(',');
      sort_order = checkedDays.map(() => '1').join(',');
    }
  } else {
    const selectedDay = document.getElementById('field-day').value;
    if (selectedDay && selectedDay !== 'pocket') {
      const existingSpot = existingId ? spots.find(s => String(s.id) === existingId) : null;
      const prevOccs = existingSpot ? getSpotOccurrences(existingSpot) : [];
      if (prevOccs.length > 0 && prevOccs[0].dateStr === selectedDay) {
        assigned_day = existingSpot.assigned_day;
        sort_order = existingSpot.sort_order;
      } else {
        const targetDayItems = getDayItems(selectedDay);
        const nextOrder = targetDayItems.reduce((m, it) => Math.max(m, it.order), 0) + 1;
        assigned_day = selectedDay;
        sort_order = String(nextOrder);
      }
    }
  }

  const baseStatus = assigned_day === 'pocket' ? 'pocket' : 'scheduled';
  const status = isRevisit ? `${baseStatus}|revisit` : baseStatus;

  const spotData = {
    id: existingId || `spot_${Date.now()}`,
    name,
    category,
    area,
    estimated_duration,
    assigned_day,
    sort_order,
    status,
    description: document.getElementById('field-description').value.trim(),
    must_buy: document.getElementById('field-must-buy').value.trim(),
    business_hours: document.getElementById('field-hours').value.trim(),
    parking_info: document.getElementById('field-parking').value.trim(),
    source_url: document.getElementById('field-source-url').value.trim(),
    photo_url: document.getElementById('field-photo-url').value.trim(),
    lat,
    lng
  };

  const idx = spots.findIndex(s => String(s.id) === String(spotData.id));
  if (idx > -1) {
    spots[idx] = { ...spots[idx], ...spotData };
  } else {
    spots.unshift(spotData);
  }

  saveLocalState();
  renderAll();
  closeModal('modal-card-detail');
  showToast(idx > -1 ? `✅ 已更新「${name}」` : `✅ 已新增「${name}」至資料庫`);

  if (appConfig.gasUrl) {
    fetch(appConfig.gasUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: idx > -1 ? 'update_spot' : 'add_spot',
        spot: spotData
      })
    }).catch(err => console.error('雲端同步失敗', err));
  }
}

function handleDeleteCard() {
  const id = document.getElementById('field-id').value.trim();
  if (!id) return;
  const spot = spots.find(s => String(s.id) === id);
  if (!spot) return;

  if (!confirm(`確定要從資料庫永久刪除「${spot.name}」嗎？`)) return;

  spots = spots.filter(s => String(s.id) !== id);
  saveLocalState();
  renderAll();
  closeModal('modal-card-detail');
  showToast(`🗑️ 已刪除「${spot.name}」`);

  if (appConfig.gasUrl) {
    fetch(appConfig.gasUrl, {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_spot', id })
    }).catch(err => console.error('雲端刪除失敗', err));
  }
}

// ==================== 版面空間與檢視模式控制 ====================
function toggleLeftPanel() {
  uiState.leftVisible = !uiState.leftVisible;
  const panel = document.getElementById('panel-pocket');
  const btn = document.getElementById('btn-toggle-left');
  if (uiState.leftVisible) {
    panel.classList.remove('lg:hidden');
    panel.classList.add('lg:flex');
    btn.innerHTML = `<i data-lucide="panel-left-close" class="w-3.5 h-3.5"></i><span>隱藏資料庫</span>`;
    btn.className = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white text-ai-indigo shadow-2xs transition';
  } else {
    panel.classList.remove('lg:flex');
    panel.classList.add('lg:hidden');
    btn.innerHTML = `<i data-lucide="panel-left-open" class="w-3.5 h-3.5"></i><span>展開資料庫</span>`;
    btn.className = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-ai-indigo text-white shadow-2xs transition';
  }
  lucide.createIcons();
  if (mapInstance) setTimeout(() => mapInstance.invalidateSize(), 220);
}

function toggleRightPanel() {
  uiState.rightVisible = !uiState.rightVisible;
  const panel = document.getElementById('panel-map');
  const resizer = document.getElementById('mid-right-resizer');
  const btn = document.getElementById('btn-toggle-right');
  if (uiState.rightVisible) {
    panel.classList.remove('lg:hidden');
    panel.classList.add('lg:flex');
    resizer.classList.remove('lg:hidden');
    resizer.classList.add('lg:flex');
    btn.innerHTML = `<i data-lucide="panel-right-close" class="w-3.5 h-3.5"></i><span>隱藏地圖</span>`;
    btn.className = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white text-ai-indigo shadow-2xs transition';
    if (mapInstance) setTimeout(() => mapInstance.invalidateSize(), 200);
  } else {
    panel.classList.remove('lg:flex');
    panel.classList.add('lg:hidden');
    resizer.classList.remove('lg:flex');
    resizer.classList.add('lg:hidden');
    btn.innerHTML = `<i data-lucide="panel-right-open" class="w-3.5 h-3.5"></i><span>顯示地圖</span>`;
    btn.className = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-ai-indigo text-white shadow-2xs transition';
  }
  lucide.createIcons();
}

function toggleInboxDrawer() {
  uiState.inboxExpanded = !uiState.inboxExpanded;
  const body = document.getElementById('inbox-collapsible-body');
  const btn = document.getElementById('btn-toggle-inbox');
  if (uiState.inboxExpanded) {
    body.classList.remove('hidden');
    btn.innerHTML = `<i data-lucide="chevron-up" class="w-4 h-4"></i>`;
  } else {
    body.classList.add('hidden');
    btn.innerHTML = `<i data-lucide="chevron-down" class="w-4 h-4"></i>`;
  }
  lucide.createIcons();
}

function toggleBoardCompactMode() {
  uiState.boardCompact = !uiState.boardCompact;
  const btn = document.getElementById('btn-board-density');
  if (uiState.boardCompact) {
    btn.innerHTML = `<i data-lucide="list" class="w-3.5 h-3.5 text-ai-indigo"></i><span>精簡檢視</span>`;
  } else {
    btn.innerHTML = `<i data-lucide="layout-grid" class="w-3.5 h-3.5 text-ai-indigo"></i><span>完整圖文</span>`;
  }
  renderAll();
}

function initResizer() {
  const resizer = document.getElementById('mid-right-resizer');
  const mapPanel = document.getElementById('panel-map');
  const workspace = document.getElementById('main-workspace');
  if (!resizer || !mapPanel) return;

  let isResizing = false;

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizer.classList.add('resizer-active');
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const rect = workspace.getBoundingClientRect();
    const newMapWidth = rect.right - e.clientX;
    const minMapWidth = 270;
    const maxMapWidth = rect.width * 0.65;

    if (newMapWidth >= minMapWidth && newMapWidth <= maxMapWidth) {
      uiState.mapWidthPx = newMapWidth;
      mapPanel.style.width = `${newMapWidth}px`;
      if (mapInstance) mapInstance.invalidateSize();
    }
  });

  window.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      resizer.classList.remove('resizer-active');
      document.body.style.cursor = '';
      if (mapInstance) mapInstance.invalidateSize();
    }
  });
}

function scrollKanbanBy(offsetX) {
  const container = document.getElementById('days-kanban-container');
  if (container) container.scrollBy({ left: offsetX, behavior: 'smooth' });
}

function scrollToDayColumn(dateStr) {
  const col = document.getElementById(`day-col-${dateStr}`);
  if (col) {
    col.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    col.classList.add('ring-2', 'ring-ai-indigo');
    setTimeout(() => col.classList.remove('ring-2', 'ring-ai-indigo'), 1200);
  }
}

// ==================== 多時段排程解析與機票錨定時間軸 ====================
function isSpotRevisit(spot) {
  return String(spot.status || '').includes('revisit');
}

function getSpotOccurrences(spot) {
  const rawDays = String(spot.assigned_day || 'pocket').trim();
  if (!rawDays || rawDays === 'pocket') return [];
  const daysArr = rawDays.split(',').map(d => d.trim()).filter(Boolean);
  const rawOrders = String(spot.sort_order || '99').split(',').map(o => Number(o.trim()) || 99);
  return daysArr.map((dateStr, idx) => ({
    dateStr,
    order: rawOrders[idx] !== undefined ? rawOrders[idx] : (rawOrders[0] || 99)
  }));
}

function getSpotAssignedDays(spot) {
  return getSpotOccurrences(spot).map(o => o.dateStr);
}

function getSpotUniqueDays(spot) {
  return [...new Set(getSpotAssignedDays(spot))];
}

function getDayItems(dateStr) {
  const items = [];
  spots.forEach(spot => {
    const occs = getSpotOccurrences(spot);
    let dayOccCounter = 0;
    occs.forEach((occ, globalOccIdx) => {
      if (occ.dateStr === dateStr) {
        dayOccCounter++;
        items.push({
          spot,
          order: occ.order,
          globalOccIdx,
          dayOccNum: dayOccCounter
        });
      }
    });
  });
  items.sort((a, b) => a.order - b.order);
  const countBySpot = {};
  items.forEach(it => { countBySpot[it.spot.id] = (countBySpot[it.spot.id] || 0) + 1; });
  items.forEach(it => { it.totalDayOccs = countBySpot[it.spot.id]; });
  return items;
}

function getDateRangeArray(startStr, endStr) {
  const list = [];
  let curr = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  const weekNames = ['日', '一', '二', '三', '四', '五', '六'];
  let idx = 1;
  while (curr <= end && idx <= 21) {
    const yyyy = curr.getFullYear();
    const mm = String(curr.getMonth() + 1).padStart(2, '0');
    const dd = String(curr.getDate()).padStart(2, '0');
    list.push({
      dateStr: `${yyyy}-${mm}-${dd}`,
      label: `Day ${idx}`,
      shortDate: `${mm}/${dd} (週${weekNames[curr.getDay()]})`
    });
    curr.setDate(curr.getDate() + 1);
    idx++;
  }
  return list;
}

function getDayStartTime(dateStr) {
  return dayStartTimes[dateStr] || '09:00';
}

function setDayStartTime(dateStr, timeStr) {
  dayStartTimes[dateStr] = timeStr || '09:00';
  saveLocalState();
  renderAll();
  if (appConfig.gasUrl) {
    fetch(appConfig.gasUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_config',
        config: { day_start_times: JSON.stringify(dayStartTimes) }
      })
    }).catch(err => console.error('出發時間同步失敗', err));
  }
}

function timeStrToMinutes(hhmm) {
  const parts = String(hhmm || '09:00').split(':');
  return (parseInt(parts[0], 10) || 9) * 60 + (parseInt(parts[1], 10) || 0);
}

function minutesToTimeStr(totalMins) {
  const normalized = ((totalMins % 1440) + 1440) % 1440;
  const h = String(Math.floor(normalized / 60)).padStart(2, '0');
  const m = String(normalized % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function getMealWindowBadge(startMins, endMins) {
  if (endMins >= 710 && startMins <= 795) {
    return `<span class="text-[10px] px-1.5 py-0.2 rounded bg-orange-100 text-orange-800 font-bold">🍽️ 午餐時段</span>`;
  }
  if (endMins >= 1070 && startMins <= 1155) {
    return `<span class="text-[10px] px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 font-bold">🍽️ 晚餐時段</span>`;
  }
  return '';
}

function buildDayTimeline(dateStr, dayItems) {
  const globalMode = document.getElementById('map-travel-mode')?.value || 'hybrid';
  let cursorMins = timeStrToMinutes(getDayStartTime(dateStr));
  let activeInboundFlight = null;

  return dayItems.map((item, idx) => {
    const isHotel = item.spot.category === '住宿';
    const isTransport = item.spot.category === '交通';
    const isReturnLeg = item.totalDayOccs > 1 && item.dayOccNum > 1;
    const stayMins = (isHotel || isReturnLeg) ? 0 : (Number(item.spot.estimated_duration) || 0);

    // 檢查此卡片是否設定了機票起迄時刻
    const flightSched = (isTransport && !isReturnLeg) ? parseFlightSchedule(item.spot.business_hours) : null;

    let transitFromPrev = null;
    if (idx > 0) {
      const prevItem = dayItems[idx - 1];
      const legInfo = estimateSingleLegQuick(dateStr, prevItem, item, globalMode);
      // 若上一站帶有明確機票時刻，則覆寫本段航程分鐘數與標籤
      if (activeInboundFlight) {
        legInfo.mode = 'flight';
        legInfo.mins = activeInboundFlight.flightMins;
        legInfo.flightSched = activeInboundFlight;
      }
      transitFromPrev = legInfo;
      cursorMins += legInfo.mins;
    }

    let arriveMins = cursorMins;
    let departMins = arriveMins + stayMins;
    let checkinWarning = false;

    // 情境 A：本站為設定了「機票起迄時刻」的出發機場 -> 以機票起飛時間為硬錨點！
    if (flightSched) {
      const recommendedCheckinMins = flightSched.depMins - stayMins;
      if (idx === 0) {
        arriveMins = recommendedCheckinMins;
      } else {
        // 若前面行程抵達機場時間晚於建議報到時間，標記警告
        if (cursorMins > recommendedCheckinMins + 5) {
          checkinWarning = true;
        }
        arriveMins = cursorMins;
      }
      departMins = flightSched.depMins;
      activeInboundFlight = flightSched;
    } else if (activeInboundFlight) {
      // 情境 B：本站為剛下飛機的「目的地機場」 -> 直接錨定機票的當地抵達時間！
      arriveMins = activeInboundFlight.arrMins;
      departMins = arriveMins + stayMins;
      activeInboundFlight = null;
    }

    cursorMins = departMins;

    return {
      ...item,
      flightSched,
      checkinWarning,
      transitFromPrev,
      arriveMins,
      departMins,
      stayMins,
      arriveStr: minutesToTimeStr(arriveMins),
      departStr: minutesToTimeStr(departMins)
    };
  });
}

// ==================== 畫面渲染核心 ====================
function renderAll() {
  const daysList = getDateRangeArray(appConfig.startDate, appConfig.endDate);
  renderPocketList(daysList);
  renderKanbanDayNavBar(daysList);
  renderKanbanDays(daysList);
  populateDaySelectors(daysList);
  initSortableDragAndDrop();
  updateMapMarkers();
  lucide.createIcons();
}

function renderKanbanDayNavBar(daysList) {
  const navBar = document.getElementById('kanban-day-nav-bar');
  if (!navBar) return;
  navBar.innerHTML = daysList.map(d => {
    const count = getDayItems(d.dateStr).length;
    return `
      <button onclick="scrollToDayColumn('${d.dateStr}')"
        class="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 hover:bg-ai-indigo hover:text-white text-slate-700 transition shrink-0 flex items-center gap-1">
        <span>${d.label}</span>
        <span class="text-[10px] opacity-75">${d.shortDate.split(' ')[0]}</span>
        ${count > 0 ? `<span class="w-4 h-4 rounded-full bg-ai-indigo/15 text-ai-indigo text-[10px] font-bold flex items-center justify-center">${count}</span>` : ''}
      </button>
    `;
  }).join('');
}

function renderPocketList(daysList) {
  const container = document.getElementById('pocket-dropzone');
  const keyword = document.getElementById('search-input').value.trim().toLowerCase();
  const dayLabelMap = {};
  (daysList || []).forEach(d => { dayLabelMap[d.dateStr] = d.label; });

  const dbSpots = spots
    .filter(s => currentCategoryFilter === '全部' || s.category === currentCategoryFilter)
    .filter(s => currentAreaFilter === '全部' || s.area === currentAreaFilter)
    .filter(s => {
      const assigned = getSpotAssignedDays(s);
      if (currentDbStatusFilter === 'unscheduled') return assigned.length === 0;
      if (currentDbStatusFilter === 'scheduled') return assigned.length > 0;
      if (currentDbStatusFilter === 'revisit') return isSpotRevisit(s);
      return true;
    })
    .filter(s => !keyword || 
      (s.name && s.name.toLowerCase().includes(keyword)) ||
      (s.must_buy && s.must_buy.toLowerCase().includes(keyword)) ||
      (s.description && s.description.toLowerCase().includes(keyword))
    )
    .sort((a, b) => (parseInt(a.sort_order) || 99) - (parseInt(b.sort_order) || 99));

  document.getElementById('mobile-pocket-count').textContent = dbSpots.length;

  const presetBanner = currentCategoryFilter === '交通' ? `
    <div class="bg-sky-50 border border-sky-200 rounded-xl p-2.5 space-y-2">
      <div class="text-[11px] text-sky-900 font-bold flex items-center gap-1">
        <span>🛫 一鍵匯入常用出發與轉乘樞紐</span>
      </div>
      <div class="grid grid-cols-2 gap-1.5">
        <button onclick="importPresetHubs('taiwan')" class="bg-white hover:bg-sky-600 text-sky-800 hover:text-white border border-sky-300 text-[11px] font-medium px-2 py-1.5 rounded-lg transition shadow-2xs">
          🇹🇼 台灣機場/高鐵
        </button>
        <button onclick="importPresetHubs('okinawa')" class="bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-medium px-2 py-1.5 rounded-lg transition shadow-2xs">
          🇯🇵 沖繩單軌/空港
        </button>
      </div>
    </div>
  ` : '';

  if (dbSpots.length === 0) {
    container.innerHTML = presetBanner + `
      <div class="text-center py-8 px-4 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
        <p class="mb-1 font-medium">目前資料庫沒有符合條件的卡片</p>
        <p>上方輸入地點或貼上 Google Maps 連結即可建立！</p>
      </div>`;
    return;
  }

  container.innerHTML = presetBanner + dbSpots.map(spot => buildPocketDatabaseCardHTML(spot, dayLabelMap)).join('');
}

function buildPocketDatabaseCardHTML(spot, dayLabelMap) {
  const isHotel = spot.category === '住宿';
  const isTransport = spot.category === '交通';
  const isRevisit = isSpotRevisit(spot);
  const flightSched = isTransport ? parseFlightSchedule(spot.business_hours) : null;
  const assignedDays = getSpotAssignedDays(spot);
  const isIncluded = assignedDays.length > 0;
  const theme = CATEGORY_THEME[spot.category] || { hex: '#64748B', badge: 'bg-slate-100 text-slate-700' };

  const dayCounts = {};
  assignedDays.forEach(d => { dayCounts[d] = (dayCounts[d] || 0) + 1; });
  const dayNamesText = Object.keys(dayCounts).map(d => {
    const lbl = dayLabelMap[d] || d.slice(5);
    return dayCounts[d] > 1 ? `${lbl}(往返)` : lbl;
  }).join(', ');

  return `
    <div class="spot-card bg-white rounded-xl border ${isIncluded ? 'border-emerald-300/90' : 'border-slate-200/90'} shadow-2xs hover:shadow-md transition cursor-grab active:cursor-grabbing overflow-hidden group"
         data-id="${spot.id}" onclick="openEditCardModal('${spot.id}')">
      ${spot.photo_url ? `
        <div class="w-full bg-slate-200 overflow-hidden relative" style="height: 82px;">
          <img src="${spot.photo_url}" alt="${spot.name}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" onerror="this.parentElement.style.display='none'"/>
          <span class="absolute top-1.5 left-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/90 text-slate-700 shadow-2xs">${spot.area}</span>
          ${isIncluded ? `<span class="absolute bottom-1.5 left-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white shadow-2xs">✅ 已納入本次行程 (${dayNamesText})</span>` : ''}
        </div>
      ` : ''}
      <div class="p-2.5">
        ${(!spot.photo_url && (isIncluded || isRevisit)) ? `
          <div class="flex flex-wrap items-center gap-1 mb-1.5">
            ${isIncluded ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">✅ 已納入行程 (${dayNamesText})</span>` : ''}
            ${isRevisit ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">⭐ 值得二訪</span>` : ''}
          </div>
        ` : (spot.photo_url && isRevisit ? `
          <div class="mb-1">
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">⭐ 值得二訪</span>
          </div>
        ` : '')}

        <div class="flex items-start justify-between gap-1.5 mb-1">
          <h4 class="font-bold text-xs sm:text-sm text-ink-dark leading-snug">${spot.name}</h4>
          <div class="flex items-center gap-1 shrink-0">
            <button type="button" onclick="event.stopPropagation(); toggleSpotRevisit('${spot.id}')"
              class="p-1 rounded hover:bg-amber-50 transition ${isRevisit ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}"
              title="${isRevisit ? '取消值得二訪標記' : '標記為值得二訪'}">
              <i data-lucide="star" class="w-3.5 h-3.5 ${isRevisit ? 'fill-amber-400' : ''}"></i>
            </button>
            <span class="text-[10px] px-1.5 py-0.5 rounded-md border font-medium ${theme.badge}">${spot.category}</span>
          </div>
        </div>

        ${flightSched ? `
          <div class="bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-lg px-2 py-1 mb-1.5 text-[11px] font-medium">
            ✈️ 機票時刻：<strong>${flightSched.depStr}</strong> 起飛 → <strong>${flightSched.arrStr}</strong> 當地抵達 (飛行 ${flightSched.flightMins}分)
          </div>
        ` : ''}

        ${spot.description ? `<p class="text-[11px] text-slate-500 line-clamp-2 mb-1.5">${spot.description}</p>` : ''}

        ${spot.must_buy ? `
          <div class="${isHotel ? 'bg-purple-50 border-purple-200 text-purple-950' : (isTransport ? 'bg-sky-50 border-sky-200 text-sky-900' : 'bg-amber-50/70 border-amber-100 text-amber-900')} border rounded-lg px-2 py-1 mb-1.5 text-[11px]">
            <span class="font-bold">${isHotel ? '🛏️ 備註：' : (isTransport ? '🚉 交通重點：' : '🛍️ 必買/吃：')}</span>${spot.must_buy}
          </div>
        ` : ''}

        <div class="flex items-center justify-between text-[11px] text-slate-400 pt-1.5 border-t border-slate-100">
          <span class="flex items-center gap-1">
            ${isHotel 
              ? `<i data-lucide="bed-double" class="w-3 h-3 text-purple-600"></i> 住宿飯店 (可重複拖入)` 
              : (isTransport
                  ? `<i data-lucide="plane-takeoff" class="w-3 h-3 text-sky-600"></i> ${flightSched ? '已設機票時刻' : '機場/車站樞紐'}`
                  : `<i data-lucide="clock" class="w-3 h-3"></i> ${spot.estimated_duration || 60}分`)
            }
            ${!spot.photo_url ? `· ${spot.area}` : ''}
          </span>
          <div class="flex items-center gap-1.5">
            <button type="button" onclick="event.stopPropagation(); focusMapOnSpot('${spot.id}')" class="text-ai-slate hover:text-ai-indigo" title="在地圖定位">
              <i data-lucide="map-pin" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderKanbanDays(daysList) {
  const container = document.getElementById('days-kanban-container');
  container.innerHTML = daysList.map((day, dayIdx) => {
    const rawItems = getDayItems(day.dateStr);
    const timelineItems = buildDayTimeline(day.dateStr, rawItems);
    const startTimeVal = getDayStartTime(day.dateStr);

    const activityMins = timelineItems
      .filter(it => it.spot.category !== '住宿' && it.spot.category !== '交通')
      .reduce((sum, it) => sum + (Number(it.spot.estimated_duration) || 60), 0);
    const activityHours = (activityMins / 60).toFixed(1).replace('.0', '');
    const transitMins = timelineItems.reduce((sum, it) => sum + (it.transitFromPrev ? it.transitFromPrev.mins : 0), 0);
    const endTimeStr = timelineItems.length > 0 ? timelineItems[timelineItems.length - 1].departStr : '';
    const nextDayObj = daysList[dayIdx + 1] || null;

    return `
      <div id="day-col-${day.dateStr}" class="w-[285px] sm:w-[300px] bg-slate-100/90 rounded-2xl border border-slate-200/80 flex flex-col max-h-full shrink-0 transition-shadow">
        <div class="px-3 py-2 border-b border-slate-200 bg-white rounded-t-2xl space-y-1.5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              <span class="font-bold text-sm text-ai-indigo">${day.label}</span>
              <span class="text-xs font-medium text-slate-600">${day.shortDate}</span>
            </div>
            <div class="flex items-center gap-1">
              <label class="flex items-center gap-1 bg-slate-100 hover:bg-slate-200/80 px-2 py-0.5 rounded-lg text-[11px] font-medium text-slate-700 cursor-pointer" title="設定當日行程預計出發時間">
                <span>⏰ 出發</span>
                <input type="time" value="${startTimeVal}" onchange="setDayStartTime('${day.dateStr}', this.value)"
                  class="bg-transparent font-bold text-ai-indigo focus:outline-none w-[54px] cursor-pointer" />
              </label>
              <button onclick="focusMapOnDay('${day.dateStr}')" class="p-1.5 text-slate-400 hover:text-ai-indigo hover:bg-slate-100 rounded-lg" title="在地圖上檢視此日路線">
                <i data-lucide="map" class="w-4 h-4"></i>
              </button>
            </div>
          </div>
          <p class="text-[11px] text-slate-500 flex items-center justify-between">
            <span>共 ${timelineItems.length} 項 · 活動 ${activityHours}h</span>
            <span>
              ${transitMins > 0 ? `<span class="text-sky-700 font-medium">移動/航程${transitMins}分</span>` : ''}
              ${endTimeStr ? ` · <span class="text-slate-700 font-medium">約${endTimeStr}結束</span>` : ''}
            </span>
          </p>
        </div>
        
        <div class="p-2 flex-1 overflow-y-auto space-y-1.5 min-h-[180px] day-dropzone" data-day="${day.dateStr}">
          ${timelineItems.length > 0 
            ? timelineItems.map((item, idx) => buildScheduledCardHTML(item, idx + 1, timelineItems.length, { currentDay: day.dateStr, nextDay: nextDayObj })).join('') 
            : `<div class="h-28 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center text-xs text-slate-400 pointer-events-none">從左側資料庫拖曳卡片至此</div>`
          }
        </div>
      </div>
    `;
  }).join('');
}

function buildScheduledCardHTML(item, orderNum, totalItemsInDay, dayContext) {
  const spot = item.spot;
  const isHotel = spot.category === '住宿';
  const isTransport = spot.category === '交通';
  const isRevisit = isSpotRevisit(spot);
  const theme = CATEGORY_THEME[spot.category] || { hex: '#64748B', badge: 'bg-slate-100 text-slate-700', borderLeft: 'border-l-slate-400' };

  const uniqueStayNights = getSpotUniqueDays(spot).length;
  const isReturnLeg = item.totalDayOccs > 1 && item.dayOccNum > 1;
  const isOutboundLeg = item.totalDayOccs > 1 && item.dayOccNum === 1;

  const canExtendNextNight = isHotel && dayContext && dayContext.nextDay &&
    !getSpotUniqueDays(spot).includes(dayContext.nextDay.dateStr);

  const canAddReturnToday = (isHotel || isTransport) && item.totalDayOccs === 1 && totalItemsInDay > 1 && orderNum < totalItemsInDay;

  let timeBadgeHTML = '';
  if (item.flightSched) {
    timeBadgeHTML = `<span class="text-[11px] font-bold text-indigo-900 bg-indigo-50 border border-indigo-200 px-1.5 py-0.2 rounded">${item.arriveStr} 報到 ～ ${item.departStr} 起飛</span>`;
  } else if (orderNum === 1 && (isHotel || isTransport)) {
    timeBadgeHTML = `<span class="text-[11px] font-bold text-ai-indigo bg-indigo-50 border border-indigo-200/80 px-1.5 py-0.2 rounded">${item.arriveStr} 出發/報到</span>`;
  } else if (isReturnLeg) {
    timeBadgeHTML = `<span class="text-[11px] font-bold text-purple-800 bg-purple-100 border border-purple-200 px-1.5 py-0.2 rounded">約 ${item.arriveStr} 返抵</span>`;
  } else if (item.stayMins > 0) {
    timeBadgeHTML = `<span class="text-[11px] font-bold text-slate-800 bg-slate-100 border border-slate-200/80 px-1.5 py-0.2 rounded">${item.arriveStr} ~ ${item.departStr}</span>`;
  } else {
    timeBadgeHTML = `<span class="text-[11px] font-bold text-slate-800 bg-slate-100 px-1.5 py-0.2 rounded">${item.arriveStr}</span>`;
  }

  const warningBadge = item.checkinWarning
    ? `<span class="text-[10px] px-1.5 py-0.2 rounded bg-red-100 text-red-700 font-bold">⚠️ 報到時間不足</span>`
    : '';

  const mealBadge = (!isHotel && !isTransport && !isReturnLeg) ? getMealWindowBadge(item.arriveMins, item.departMins) : '';

  const isFlightLeg = item.transitFromPrev && item.transitFromPrev.mode === 'flight';
  const prevFlightSched = item.transitFromPrev && item.transitFromPrev.flightSched;
  const transitLabelText = prevFlightSched
    ? `✈️ ${prevFlightSched.depStr} 起飛 → ${prevFlightSched.arrStr} 當地抵達 (飛行 ${prevFlightSched.flightMins} 分)`
    : (item.transitFromPrev
        ? `${item.transitFromPrev.isIndoor ? '🚶 館內/緊鄰移動' : MODE_SHORT_LABEL[item.transitFromPrev.mode]} 約 ${item.transitFromPrev.mins} 分`
        : '');

  const transitConnectorHTML = item.transitFromPrev ? `
    <div class="flex items-center justify-center py-0.5 select-none pointer-events-none">
      <span class="text-[10px] ${isFlightLeg ? 'text-purple-800 bg-purple-50 border-purple-200 font-bold' : 'text-slate-500 bg-white/90 border-slate-200/80'} border rounded-full px-2 py-0.2 shadow-2xs">
        ↓ ${transitLabelText}
      </span>
    </div>
  ` : '';

  const roleTag = isReturnLeg
    ? `<span class="text-[10px] px-1.5 py-0.2 rounded bg-purple-600 text-white font-bold">回程</span>`
    : (isOutboundLeg ? `<span class="text-[10px] px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 font-bold">出發</span>` : '');

  if (uiState.boardCompact) {
    return `
      ${transitConnectorHTML}
      <div class="spot-card bg-white rounded-xl border border-slate-200/95 border-l-4 ${theme.borderLeft} shadow-2xs hover:shadow-md transition cursor-grab active:cursor-grabbing px-2.5 py-2 group"
           data-id="${spot.id}" data-occ="${item.globalOccIdx}" onclick="openEditCardModal('${spot.id}')">
        <div class="flex items-center justify-between gap-1 mb-1">
          <div class="flex items-center gap-1 flex-wrap">
            ${timeBadgeHTML}
            ${warningBadge}
            ${mealBadge}
          </div>
          <div class="flex items-center gap-1 shrink-0">
            ${roleTag}
            <span class="text-[10px] px-1.5 py-0.2 rounded border font-medium ${theme.badge}">${spot.category}</span>
            <button type="button" onclick="event.stopPropagation(); removeSpotOccurrenceFromDay('${spot.id}', '${dayContext.currentDay}', ${item.globalOccIdx})"
              class="text-slate-300 hover:text-red-500 p-0.5 rounded transition" title="移出此時段（保留於資料庫）">
              <i data-lucide="x" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between gap-1.5">
          <div class="flex items-center gap-1.5 min-w-0">
            <span style="background-color: ${theme.hex};"
              class="w-5 h-5 rounded-full text-white text-[11px] font-bold flex items-center justify-center shrink-0 shadow-2xs">
              ${isHotel ? '宿' : (isTransport ? '行' : orderNum)}
            </span>
            <h4 class="font-bold text-xs text-ink-dark truncate" title="${spot.name}">${isRevisit ? '⭐ ' : ''}${spot.name}</h4>
          </div>
          <button type="button" onclick="event.stopPropagation(); focusMapOnSpot('${spot.id}')" class="text-slate-400 hover:text-ai-indigo shrink-0" title="在地圖定位">
            <i data-lucide="map-pin" class="w-3.5 h-3.5"></i>
          </button>
        </div>

        <div class="text-[11px] text-slate-400 mt-1 pl-6 truncate">
          ${isHotel 
            ? `<span class="text-purple-700 font-medium">${isReturnLeg ? '返回飯店休息' : `連住 ${uniqueStayNights} 晚`}</span> · ${spot.area}`
            : (isTransport 
                ? `<span class="text-sky-700 font-medium">${isReturnLeg ? '返回車站/機場' : (item.flightSched ? `起飛前 ${spot.estimated_duration || 0}分報到` : `報到/轉乘 ${spot.estimated_duration || 30}分`)}</span> · ${spot.area}`
                : `${spot.area} · 停留${spot.estimated_duration || 60}分`)
          }
          ${spot.must_buy && !isReturnLeg ? ` · <span class="text-slate-600">${spot.must_buy.split(',')[0]}</span>` : ''}
        </div>

        ${(canAddReturnToday || (canExtendNextNight && !isReturnLeg)) ? `
          <div class="mt-1.5 pl-6 flex gap-1">
            ${canAddReturnToday ? `
              <button type="button" onclick="event.stopPropagation(); appendReturnStopToDay('${spot.id}', '${dayContext.currentDay}')"
                class="flex-1 py-0.5 px-1.5 rounded bg-slate-100 hover:bg-ai-indigo text-slate-700 hover:text-white border border-slate-200 text-[10px] font-medium flex items-center justify-center gap-0.5 transition">
                <i data-lucide="corner-down-left" class="w-3 h-3"></i> 加入當日回程
              </button>
            ` : ''}
            ${(canExtendNextNight && !isReturnLeg) ? `
              <button type="button" onclick="event.stopPropagation(); extendHotelToDay('${spot.id}', '${dayContext.nextDay.dateStr}', '${dayContext.nextDay.label}')"
                class="flex-1 py-0.5 px-1.5 rounded bg-purple-50 hover:bg-purple-600 text-purple-700 hover:text-white border border-purple-200 text-[10px] font-medium flex items-center justify-center gap-0.5 transition">
                <i data-lucide="calendar-plus" class="w-3 h-3"></i> 延續至 ${dayContext.nextDay.label}
              </button>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  const cardBorder = isHotel ? 'border-purple-300 bg-purple-50/30' : 'border-slate-200/90 bg-white';
  return `
    ${transitConnectorHTML}
    <div class="spot-card ${cardBorder} rounded-xl border shadow-2xs hover:shadow-md transition cursor-grab active:cursor-grabbing overflow-hidden group"
         data-id="${spot.id}" data-occ="${item.globalOccIdx}" onclick="openEditCardModal('${spot.id}')">
      <div class="p-2.5">
        <div class="flex items-center justify-between gap-1 mb-1.5">
          <div class="flex items-center gap-1 flex-wrap">
            ${timeBadgeHTML}
            ${warningBadge}
            ${mealBadge}
          </div>
          <div class="flex items-center gap-1 shrink-0">
            ${roleTag}
            <span class="text-[10px] px-1.5 py-0.2 rounded-md border font-medium ${theme.badge}">${spot.category}</span>
            <button type="button" onclick="event.stopPropagation(); removeSpotOccurrenceFromDay('${spot.id}', '${dayContext.currentDay}', ${item.globalOccIdx})"
              class="text-slate-300 hover:text-red-500 p-0.5 rounded transition" title="移出此時段">
              <i data-lucide="x" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>

        <div class="flex items-start justify-between gap-1.5 mb-1">
          <div class="flex items-center gap-1.5">
            <span style="background-color: ${theme.hex};" class="w-5 h-5 rounded-full text-white text-[11px] font-bold flex items-center justify-center shrink-0">${isHotel ? '宿' : (isTransport ? '行' : orderNum)}</span>
            <h4 class="font-bold text-xs text-ink-dark leading-snug">${isRevisit ? '⭐ ' : ''}${spot.name}</h4>
          </div>
        </div>

        ${spot.description ? `<p class="text-[11px] text-slate-500 line-clamp-2 mb-1.5">${spot.description}</p>` : ''}

        ${spot.must_buy ? `
          <div class="${isHotel ? 'bg-purple-100/60 border-purple-200 text-purple-950' : (isTransport ? 'bg-sky-50 border-sky-200 text-sky-900' : 'bg-amber-50/70 border-amber-100 text-amber-900')} border rounded-lg px-2 py-1 mb-1.5 text-[11px]">
            <span class="font-bold">${isHotel ? '🛏️ 備註：' : (isTransport ? '🚉 重點：' : '🛍️ 必買/吃：')}</span>${spot.must_buy}
          </div>
        ` : ''}

        ${(canAddReturnToday || (canExtendNextNight && !isReturnLeg)) ? `
          <div class="mb-1.5 flex gap-1.5">
            ${canAddReturnToday ? `
              <button type="button" onclick="event.stopPropagation(); appendReturnStopToDay('${spot.id}', '${dayContext.currentDay}')"
                class="flex-1 py-1 px-2 rounded-lg bg-slate-700 hover:bg-ai-indigo text-white text-[11px] font-medium flex items-center justify-center gap-1 transition">
                <i data-lucide="corner-down-left" class="w-3 h-3"></i> 加入當日回程
              </button>
            ` : ''}
            ${(canExtendNextNight && !isReturnLeg) ? `
              <button type="button" onclick="event.stopPropagation(); extendHotelToDay('${spot.id}', '${dayContext.nextDay.dateStr}', '${dayContext.nextDay.label}')"
                class="flex-1 py-1 px-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-medium flex items-center justify-center gap-1 transition">
                <i data-lucide="calendar-plus" class="w-3 h-3"></i> 延續至 ${dayContext.nextDay.label}
              </button>
            ` : ''}
          </div>
        ` : ''}

        <div class="flex items-center justify-between text-[11px] text-slate-400 pt-1.5 border-t border-slate-100">
          <span class="flex items-center gap-1">
            ${isHotel 
              ? `<i data-lucide="bed-double" class="w-3 h-3 text-purple-600"></i> <span class="text-purple-700 font-medium">${isReturnLeg ? '返回飯店' : `已排 ${uniqueStayNights} 晚`}</span>` 
              : (isTransport
                  ? `<i data-lucide="plane-takeoff" class="w-3 h-3 text-sky-600"></i> <span class="text-sky-700 font-medium">${isReturnLeg ? '返回交通節點' : (item.flightSched ? `起飛前 ${spot.estimated_duration || 0}分報到` : `報到/轉乘 ${spot.estimated_duration || 30}分`)}</span>`
                  : `<i data-lucide="clock" class="w-3 h-3"></i> ${spot.estimated_duration || 60}分`)
            }
            · ${spot.area}
          </span>
          <button type="button" onclick="event.stopPropagation(); focusMapOnSpot('${spot.id}')" class="text-ai-slate hover:text-ai-indigo" title="在地圖定位">
            <i data-lucide="map-pin" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    </div>
  `;
}

// ==================== 卡片快捷操作與拖曳排序 ====================
function toggleSpotRevisit(spotId) {
  const spot = spots.find(s => s.id === spotId);
  if (!spot) return;

  const currentlyRevisit = isSpotRevisit(spot);
  const assigned = getSpotAssignedDays(spot);
  const base = assigned.length > 0 ? 'scheduled' : 'pocket';
  spot.status = !currentlyRevisit ? `${base}|revisit` : base;

  saveLocalState();
  renderAll();
  showToast(!currentlyRevisit ? `⭐ 已將「${spot.name}」標記為值得二訪！` : `已取消「${spot.name}」的二訪標記`);

  if (appConfig.gasUrl) {
    fetch(appConfig.gasUrl, {
      method: 'POST',
      body: JSON.stringify({ action: 'update_spot', spot })
    }).catch(err => console.error('二訪狀態同步失敗', err));
  }
}

function removeSpotOccurrenceFromDay(spotId, targetDateStr, globalOccIdx) {
  const spot = spots.find(s => s.id === spotId);
  if (!spot) return;

  const occs = getSpotOccurrences(spot);
  if (globalOccIdx !== undefined && occs[globalOccIdx] && occs[globalOccIdx].dateStr === targetDateStr) {
    occs.splice(globalOccIdx, 1);
  } else {
    const idx = occs.findIndex(o => o.dateStr === targetDateStr);
    if (idx > -1) occs.splice(idx, 1);
  }

  const rev = isSpotRevisit(spot);
  spot.assigned_day = occs.length > 0 ? occs.map(o => o.dateStr).join(',') : 'pocket';
  spot.sort_order = occs.length > 0 ? occs.map(o => o.order).join(',') : '99';
  spot.status = occs.length > 0 ? (rev ? 'scheduled|revisit' : 'scheduled') : (rev ? 'pocket|revisit' : 'pocket');

  saveLocalState();
  renderAll();
  showToast(`已將「${spot.name}」移出該時段（仍保留於左側資料庫）`);

  if (appConfig.gasUrl) {
    fetch(appConfig.gasUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'sync_board',
        updates: [{ id: spot.id, assigned_day: spot.assigned_day, sort_order: spot.sort_order, is_revisit: rev }]
      })
    }).catch(err => console.error('背景同步失敗', err));
  }
}

function appendReturnStopToDay(spotId, dateStr) {
  const spot = spots.find(s => s.id === spotId);
  if (!spot) return;

  const dayItems = getDayItems(dateStr);
  const maxOrder = dayItems.reduce((m, it) => Math.max(m, it.order), 0);
  const occs = getSpotOccurrences(spot);
  occs.push({ dateStr, order: maxOrder + 1 });
  occs.sort((a, b) => a.dateStr.localeCompare(b.dateStr) || a.order - b.order);

  const rev = isSpotRevisit(spot);
  spot.assigned_day = occs.map(o => o.dateStr).join(',');
  spot.sort_order = occs.map(o => o.order).join(',');
  spot.status = rev ? 'scheduled|revisit' : 'scheduled';

  saveLocalState();
  renderAll();
  showToast(`↩️ 已將「${spot.name}」加入當日最後一站（返回飯店/機場）！`);

  if (appConfig.gasUrl) {
    fetch(appConfig.gasUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'sync_board',
        updates: [{ id: spot.id, assigned_day: spot.assigned_day, sort_order: spot.sort_order, is_revisit: rev }]
      })
    }).catch(err => console.error('背景同步失敗', err));
  }
}

function extendHotelToDay(spotId, nextDateStr, nextDayLabel) {
  const spot = spots.find(s => s.id === spotId);
  if (!spot) return;
  const occs = getSpotOccurrences(spot);
  if (!occs.some(o => o.dateStr === nextDateStr)) {
    occs.push({ dateStr: nextDateStr, order: 1 });
    occs.sort((a, b) => a.dateStr.localeCompare(b.dateStr) || a.order - b.order);
    spot.assigned_day = occs.map(o => o.dateStr).join(',');
    spot.sort_order = occs.map(o => o.order).join(',');
    const rev = isSpotRevisit(spot);
    spot.status = rev ? 'scheduled|revisit' : 'scheduled';
    saveLocalState();
    renderAll();
    scrollToDayColumn(nextDateStr);
    showToast(`🏨 已將「${spot.name}」連住排入 ${nextDayLabel}！`);

    if (appConfig.gasUrl) {
      fetch(appConfig.gasUrl, {
        method: 'POST',
        body: JSON.stringify({
          action: 'sync_board',
          updates: [{ id: spot.id, assigned_day: spot.assigned_day, sort_order: spot.sort_order, is_revisit: rev }]
        })
      }).catch(err => console.error('背景同步失敗', err));
    }
  }
}

function initSortableDragAndDrop() {
  const pocketEl = document.getElementById('pocket-dropzone');
  if (pocketEl) {
    new Sortable(pocketEl, {
      group: { name: 'global-travel-cards', pull: 'clone', put: false },
      sort: false,
      animation: 180,
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag'
    });
  }

  document.querySelectorAll('.day-dropzone').forEach(zone => {
    new Sortable(zone, {
      group: 'global-travel-cards',
      draggable: '.spot-card',
      animation: 180,
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      onAdd: handleDragEnd,
      onUpdate: handleDragEnd,
      onRemove: handleDragEnd
    });
  });
}

function handleDragEnd() {
  const cardOccMap = {};
  spots.forEach(s => { cardOccMap[s.id] = []; });

  document.querySelectorAll('.day-dropzone').forEach(zone => {
    const dayStr = zone.dataset.day;
    zone.querySelectorAll('.spot-card').forEach((card, idx) => {
      const id = card.dataset.id;
      if (!cardOccMap[id]) cardOccMap[id] = [];
      cardOccMap[id].push({ dateStr: dayStr, order: idx + 1 });
    });
  });

  const updates = [];
  spots.forEach(spot => {
    const occs = cardOccMap[spot.id] || [];
    const newAssigned = occs.length > 0 ? occs.map(o => o.dateStr).join(',') : 'pocket';
    const newOrder = occs.length > 0 ? occs.map(o => o.order).join(',') : (String(spot.sort_order).split(',')[0] || '99');
    const rev = isSpotRevisit(spot);
    spot.assigned_day = newAssigned;
    spot.status = newAssigned === 'pocket'
      ? (rev ? 'pocket|revisit' : 'pocket')
      : (rev ? 'scheduled|revisit' : 'scheduled');
    spot.sort_order = newOrder;
    updates.push({ id: spot.id, assigned_day: newAssigned, sort_order: newOrder, is_revisit: rev });
  });

  saveLocalState();
  renderAll();
  showToast('已更新行程排程與時間軸！');

  if (appConfig.gasUrl) {
    fetch(appConfig.gasUrl, {
      method: 'POST',
      body: JSON.stringify({ action: 'sync_board', updates })
    }).catch(err => console.error('背景同步失敗', err));
  }
}

// ==================== 篩選、彈出視窗與響應式切換 ====================
function setFilterCategory(cat) {
  currentCategoryFilter = cat;
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.className = btn.textContent.includes(cat)
      ? 'cat-btn active px-2 py-0.5 rounded-full text-[11px] font-medium bg-ai-indigo text-white shrink-0'
      : 'cat-btn px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 shrink-0';
  });
  renderAll();
}

function setFilterDbStatus(st) {
  currentDbStatusFilter = st;
  const mapLabel = { all: '全部資料庫', unscheduled: '未排入', scheduled: '已納入', revisit: '值得二訪' };
  document.querySelectorAll('.db-status-btn').forEach(btn => {
    const active = btn.textContent.includes(mapLabel[st]);
    btn.className = active
      ? 'db-status-btn px-2 py-0.5 rounded bg-slate-800 text-white font-medium shrink-0'
      : 'db-status-btn px-2 py-0.5 rounded text-slate-500 hover:bg-slate-100 shrink-0';
  });
  renderAll();
}

function setFilterArea(area) {
  currentAreaFilter = area;
  renderDynamicAreaControls();
  renderAll();
}

function selectAllStayDays() {
  document.querySelectorAll('input[name="stay_days"]').forEach(cb => { cb.checked = true; });
}

function resetAddressLookupUI() {
  latestPlaceAddress = '';
  document.getElementById('place-address-result').classList.add('hidden');
}

function switchMobileTab(tab) {
  if (window.innerWidth >= 1024) return;
  const panels = {
    pocket: document.getElementById('panel-pocket'),
    itinerary: document.getElementById('panel-itinerary'),
    map: document.getElementById('panel-map')
  };
  Object.keys(panels).forEach(k => {
    if (k === tab) {
      panels[k].classList.remove('hidden');
      panels[k].classList.add('flex');
    } else {
      panels[k].classList.add('hidden');
      panels[k].classList.remove('flex');
    }
    const btn = document.getElementById(`tab-${k}`);
    btn.className = k === tab
      ? 'flex-1 py-2.5 text-center border-b-2 border-ai-indigo text-ai-indigo'
      : 'flex-1 py-2.5 text-center border-b-2 border-transparent text-slate-500';
  });
  if (tab === 'map' && mapInstance) {
    setTimeout(() => mapInstance.invalidateSize(), 150);
  }
}

function openModal(id) {
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  el.classList.add('flex');
}

function closeModal(id) {
  const el = document.getElementById(id);
  el.classList.add('hidden');
  el.classList.remove('flex');
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  toast.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0'), 4000);
}
