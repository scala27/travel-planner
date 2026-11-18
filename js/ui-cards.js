import { CATEGORY_STYLES } from './config.js';
import { state, hooks, persistState, showToast } from './state.js';

export function updateMiniCardButtonUi() {
  const label = document.getElementById('miniCardBtnLabel');
  if (label) {
    label.textContent = state.miniCardMode ? '完整卡片' : '迷你卡片';
  }
}

export function toggleMiniCardMode() {
  state.miniCardMode = !state.miniCardMode;
  updateMiniCardButtonUi();
  renderDatabaseCards();
}

export function toggleBatchImportBox() {}
export function handleBatchImport() {}
export function batchUpdateAllDistricts() {}

export function setPlanQuickFilter(val) {
  state.planQuickFilter = val;
  document.querySelectorAll('.plan-q-btn').forEach(btn => {
    const active = btn.dataset.planQ === val;
    btn.className = active
      ? 'plan-q-btn px-2 py-0.5 rounded-md text-[11px] font-bold bg-[#2C4D6E] text-white'
      : 'plan-q-btn px-2 py-0.5 rounded-md text-[11px] font-medium bg-white border border-slate-200 text-slate-600';
  });
  renderDatabaseCards();
}

export function togglePlanProximitySort() {
  state.planProximitySort = !state.planProximitySort;
  renderDatabaseCards();
}

export function setFilter(type, value) {
  state.filters[type] = value;

  if (type === 'scope') {
    document.querySelectorAll('.scope-btn').forEach(btn => {
      const active = btn.dataset.filterScope === value;
      btn.className = active
        ? 'scope-btn px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-800 text-white'
        : 'scope-btn px-2 py-0.5 rounded-md text-[11px] font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50';
    });
    populateRegionDropdowns();
  }

  if (type === 'category') {
    document.querySelectorAll('.cat-btn').forEach(btn => {
      const active = btn.dataset.filterCat === value;
      btn.className = active
        ? 'cat-btn px-2 py-0.5 rounded-md text-[11px] font-bold bg-[#2C4D6E] text-white'
        : 'cat-btn px-2 py-0.5 rounded-md text-[11px] font-medium bg-white border border-slate-200 text-slate-600';
    });
  }

  renderDatabaseCards();
  if (typeof hooks.renderMapMarkers === 'function') hooks.renderMapMarkers();
}

export function clearSearch() {
  const input = document.getElementById('searchInput');
  if (input) input.value = '';
  renderDatabaseCards();
}

export function populateRegionDropdowns() {
  const countrySel = document.getElementById('countryFilter');
  const citySel = document.getElementById('cityFilter');
  if (!countrySel || !citySel) return;

  const currentCountry = countrySel.value || 'all';
  const currentCity = citySel.value || 'all';

  const countries = Array.from(new Set(state.cards.map(c => c.country).filter(Boolean)));
  countrySel.innerHTML =
    `<option value="all">全部國家 / 地區</option>` +
    countries.map(ct => `<option value="${ct}" ${ct === currentCountry ? 'selected' : ''}>${ct}</option>`).join('');

  const filteredByCountry =
    countrySel.value === 'all' ? state.cards : state.cards.filter(c => c.country === countrySel.value);
  const cities = Array.from(new Set(filteredByCountry.map(c => c.district).filter(Boolean)));
  citySel.innerHTML =
    `<option value="all">全部城市 / 町村</option>` +
    cities.map(city => `<option value="${city}" ${city === currentCity ? 'selected' : ''}>${city}</option>`).join('');
}

export function onCountryFilterChange() {
  populateRegionDropdowns();
  renderDatabaseCards();
  if (typeof hooks.renderMapMarkers === 'function') hooks.renderMapMarkers();
}

function getScheduledDaysMap() {
  const map = {};
  Object.entries(state.itinerary || {}).forEach(([dayStr, dayObj]) => {
    (dayObj.items || []).forEach(it => {
      if (!map[it.cardId]) map[it.cardId] = [];
      if (!map[it.cardId].includes(Number(dayStr))) map[it.cardId].push(Number(dayStr));
    });
  });
  return map;
}

export function getFilteredAndSortedCards() {
  const q = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  const sortBy = document.getElementById('sortSelect')?.value || 'newest';
  const countryVal = document.getElementById('countryFilter')?.value || 'all';
  const cityVal = document.getElementById('cityFilter')?.value || 'all';
  const scheduledMap = getScheduledDaysMap();

  let list = state.cards.filter(card => {
    if (q) {
      const hay = `${card.title} ${card.district} ${card.country} ${card.notes}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    if (state.mode === 'plan') {
      const pq = state.planQuickFilter;
      if (pq === 'unscheduled') {
        if ((scheduledMap[card.id] || []).length > 0) return false;
      } else if (pq !== 'all') {
        if (card.category !== pq) return false;
      }
      return true;
    }

    if (state.filters.scope === 'domestic' && card.country !== '台灣') return false;
    if (state.filters.scope === 'international' && card.country === '台灣') return false;
    if (countryVal !== 'all' && card.country !== countryVal) return false;
    if (cityVal !== 'all' && card.district !== cityVal) return false;
    if (state.filters.category !== 'all' && card.category !== state.filters.category) return false;

    return true;
  });

  if (sortBy === 'unscheduled') {
    list = [...list].sort((a, b) => (scheduledMap[a.id]?.length || 0) - (scheduledMap[b.id]?.length || 0));
  } else if (sortBy === 'district') {
    list = [...list].sort((a, b) => (a.district || '').localeCompare(b.district || '', 'zh-Hant'));
  }

  return list;
}

export function renderDatabaseCards() {
  const container = document.getElementById('databaseCardsContainer');
  if (!container) return;

  // 更新總數與國內/國外計數膠囊
  const totalCount = state.cards.length;
  const domesticCount = state.cards.filter(c => c.country === '台灣').length;
  const intlCount = totalCount - domesticCount;

  const badgeTotal = document.getElementById('badgeTotalCount');
  if (badgeTotal) badgeTotal.textContent = String(totalCount);

  const scopeAllBtn = document.querySelector('[data-filter-scope="all"]');
  const scopeDomBtn = document.querySelector('[data-filter-scope="domestic"]');
  const scopeIntlBtn = document.querySelector('[data-filter-scope="international"]');
  if (scopeAllBtn) scopeAllBtn.textContent = `全部 (${totalCount})`;
  if (scopeDomBtn) scopeDomBtn.textContent = `TW 國內 (${domesticCount})`;
  if (scopeIntlBtn) scopeIntlBtn.textContent = `✈️ 國外 (${intlCount})`;

  const cards = getFilteredAndSortedCards();
  const scheduledMap = getScheduledDaysMap();
  const totalDays = Math.max(1, Number(state.settings.totalDays) || 6);

  if (cards.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 flex flex-col items-center justify-center text-slate-400 text-xs">
        <i class="fa-regular fa-folder-open text-3xl mb-2 text-slate-300"></i>
        <p class="font-semibold text-slate-500">目前無符合條件的口袋卡片</p>
        <p class="mt-1">可點擊上方「＋ 新增卡片」隨時收藏景點或餐廳</p>
      </div>
    `;
    return;
  }

  const dayOptions = Array.from({ length: totalDays }, (_, i) => `<option value="${i + 1}">Day ${i + 1}</option>`).join('');

  container.innerHTML = cards
    .map(card => {
      const style = CATEGORY_STYLES[card.category] || CATEGORY_STYLES['景點'];
      const days = scheduledMap[card.id] || [];
      const dayBadges = days
        .map(d => `<span class="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">D${d}</span>`)
        .join('');

      return `
        <div id="db-card-${card.id}" draggable="true" ondragstart="onDragStartCard(event, '${card.id}')"
          onclick="handleCardClick('${card.id}')"
          class="bg-white rounded-xl border ${days.length > 0 ? 'border-emerald-200 bg-emerald-50/15' : 'border-slate-200'} p-3 shadow-2xs hover:shadow-sm hover:border-[#2C4D6E]/40 transition flex flex-col justify-between gap-2.5 cursor-pointer">
          <div class="space-y-1.5">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-start gap-2 min-w-0">
                <span class="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style="background:${style.hex}"></span>
                <h3 class="font-bold text-sm text-slate-800 leading-snug break-words">${card.title}</h3>
              </div>
              <span class="px-2 py-0.5 rounded-md text-[11px] font-bold ${style.badge} shrink-0">${card.category}</span>
            </div>

            <div class="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500 pl-4">
              <span>${card.district || card.country || '未分類地區'}</span>
              <span>・⏱ ${card.duration || 60}分</span>
              ${dayBadges}
            </div>

            ${
              !state.miniCardMode && card.notes
                ? `<p class="text-xs text-slate-600 line-clamp-2 pl-4 leading-relaxed">${card.notes}</p>`
                : ''
            }
          </div>

          <div class="pt-2 border-t border-slate-100 flex items-center justify-between gap-1.5" onclick="event.stopPropagation()">
            <select onchange="quickAssignCardToDay('${card.id}', this)"
              class="text-xs font-bold text-[#2C4D6E] bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 focus:outline-none cursor-pointer">
              <option value="">＋ 排入行程</option>
              ${dayOptions}
            </select>

            <div class="flex items-center gap-1">
              <button type="button" onclick="focusCardOnMap('${card.id}')" title="在地圖檢視"
                class="w-7 h-7 rounded-lg border border-slate-200 text-slate-600 hover:bg-blue-50 hover:text-[#2C4D6E] flex items-center justify-center text-xs">
                <i class="fa-solid fa-location-dot"></i>
              </button>
              <button type="button" onclick="openCardModal('${card.id}')" title="編輯卡片"
                class="w-7 h-7 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 flex items-center justify-center text-xs">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button type="button" onclick="deleteCard('${card.id}')" title="刪除卡片"
                class="w-7 h-7 rounded-lg border border-slate-200 text-rose-500 hover:bg-rose-50 flex items-center justify-center text-xs">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

export function handleCardClick(cardId) {
  if (typeof hooks.focusCardOnMap === 'function') {
    hooks.focusCardOnMap(cardId, false);
  }
}

export function toggleCardDetailExpand() {}

export function openCardModal(cardId = null) {
  const modal = document.getElementById('cardModal');
  if (!modal) return;

  const totalDays = Math.max(1, Number(state.settings.totalDays) || 6);
  const assignSel = document.getElementById('fieldAssignDay');
  if (assignSel) {
    assignSel.innerHTML =
      `<option value="">僅存入口袋資料庫</option>` +
      Array.from({ length: totalDays }, (_, i) => `<option value="${i + 1}">Day ${i + 1}</option>`).join('');
  }

  if (cardId) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;
    document.getElementById('cardModalTitle').textContent = '編輯口袋卡片';
    document.getElementById('editCardId').value = card.id;
    document.getElementById('fieldTitle').value = card.title || '';
    document.getElementById('fieldCategory').value = card.category || '景點';
    document.getElementById('fieldCountry').value = card.country || '日本';
    document.getElementById('fieldDistrict').value = card.district || '';
    document.getElementById('fieldDuration').value = card.duration || 60;
    document.getElementById('fieldLat').value = card.lat ?? '';
    document.getElementById('fieldLng').value = card.lng ?? '';
    document.getElementById('fieldNotes').value = card.notes || '';
    document.getElementById('fieldMapUrl').value = card.mapUrl || '';
    document.getElementById('fieldImage').value = card.image || '';
    document.getElementById('fieldStarred').checked = Boolean(card.starred);
  } else {
    document.getElementById('cardModalTitle').textContent = '新增口袋卡片';
    document.getElementById('editCardId').value = '';
    document.getElementById('fieldTitle').value = '';
    document.getElementById('fieldCategory').value = '景點';
    document.getElementById('fieldCountry').value = '日本';
    document.getElementById('fieldDistrict').value = '';
    document.getElementById('fieldDuration').value = 60;
    document.getElementById('fieldLat').value = '';
    document.getElementById('fieldLng').value = '';
    document.getElementById('fieldNotes').value = '';
    document.getElementById('fieldMapUrl').value = '';
    document.getElementById('fieldImage').value = '';
    document.getElementById('fieldStarred').checked = false;
  }

  onModalCategoryChange();
  modal.classList.remove('hidden');
}

export function closeCardModal() {
  document.getElementById('cardModal')?.classList.add('hidden');
}

export function onModalCategoryChange() {
  const box = document.getElementById('dynamicCategoryFieldsBox');
  if (box) box.classList.add('hidden');
}

export function saveCardFromModal() {
  const title = document.getElementById('fieldTitle').value.trim();
  if (!title) {
    showToast('請輸入地點或店家名稱', 'amber');
    return;
  }

  const editId = document.getElementById('editCardId').value;
  const latRaw = document.getElementById('fieldLat').value.trim();
  const lngRaw = document.getElementById('fieldLng').value.trim();
  const payload = {
    id: editId || `spot_${Date.now()}`,
    title,
    category: document.getElementById('fieldCategory').value || '景點',
    country: document.getElementById('fieldCountry').value.trim() || '日本',
    district: document.getElementById('fieldDistrict').value.trim(),
    duration: Math.max(0, parseInt(document.getElementById('fieldDuration').value, 10) || 60),
    lat: latRaw !== '' && !isNaN(Number(latRaw)) ? Number(latRaw) : null,
    lng: lngRaw !== '' && !isNaN(Number(lngRaw)) ? Number(lngRaw) : null,
    notes: document.getElementById('fieldNotes').value.trim(),
    mapUrl: document.getElementById('fieldMapUrl').value.trim(),
    image: document.getElementById('fieldImage').value.trim(),
    starred: document.getElementById('fieldStarred').checked,
    meta: {}
  };

  if (editId) {
    const idx = state.cards.findIndex(c => c.id === editId);
    if (idx !== -1) state.cards[idx] = { ...state.cards[idx], ...payload };
  } else {
    state.cards.unshift(payload);
  }

  const assignDay = document.getElementById('fieldAssignDay')?.value;
  if (assignDay && typeof hooks.addCardToDay === 'function') {
    hooks.addCardToDay(payload.id, Number(assignDay));
  }

  populateRegionDropdowns();
  persistState(true);
  closeCardModal();
  if (typeof hooks.renderAll === 'function') hooks.renderAll();
  showToast('已儲存卡片並同步', 'emerald');
}

export function deleteCard(cardId) {
  if (!confirm('確定要刪除此口袋卡片嗎？')) return;
  state.cards = state.cards.filter(c => c.id !== cardId);
  Object.values(state.itinerary).forEach(day => {
    day.items = (day.items || []).filter(it => it.cardId !== cardId);
  });
  persistState(true);
  if (typeof hooks.renderAll === 'function') hooks.renderAll();
  showToast('已刪除卡片', 'slate');
}

export function toggleStarCard(cardId) {
  const card = state.cards.find(c => c.id === cardId);
  if (!card) return;
  card.starred = !card.starred;
  persistState(true);
  renderDatabaseCards();
}

export function handleLatLngPaste(event) {
  const text = (event.clipboardData || window.clipboardData)?.getData('text') || '';
  const match = text.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  if (match) {
    event.preventDefault();
    document.getElementById('fieldLat').value = match[1];
    document.getElementById('fieldLng').value = match[2];
  }
}

export function extractCoordsFromMapUrlField() {
  const url = document.getElementById('fieldMapUrl')?.value || '';
  const match = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (match) {
    document.getElementById('fieldLat').value = match[1];
    document.getElementById('fieldLng').value = match[2];
    showToast('已從網址自動擷取經緯度', 'emerald');
  }
}

export async function reverseGeocodeModalCoords() {
  const lat = document.getElementById('fieldLat')?.value;
  const lng = document.getElementById('fieldLng')?.value;
  if (!lat || !lng) {
    showToast('請先輸入緯度與經度座標', 'amber');
    return;
  }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=zh-TW`);
    const data = await res.json();
    const addr = data.address || {};
    const area = addr.city || addr.town || addr.village || addr.county || '';
    if (area) {
      document.getElementById('fieldDistrict').value = area;
      showToast(`已反查行政區：${area}`, 'emerald');
    }
  } catch (e) {
    showToast('反查行政區失敗', 'rose');
  }
}
