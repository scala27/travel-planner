import { CATEGORY_STYLES } from './config.js';
import {
  state,
  hooks,
  persistState,
  showToast,
  isDomesticCountry,
  normalizeCountryName,
  normalizeDistrictName,
  formatCardRegionDisplay
} from './state.js';
import {
  reverseGeocodeCoords,
  geocodePlaceName,
  extractCoordsFromText,
  normalizeTraditionalText
} from './geo.js';
import { requestSmartExtractFromGas } from './api.js';

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

  const countries = Array.from(
    new Set(state.cards.map(c => normalizeCountryName(c.country)).filter(Boolean))
  );
  countrySel.innerHTML =
    `<option value="all">全部國家 / 地區</option>` +
    countries.map(ct => `<option value="${ct}" ${ct === currentCountry ? 'selected' : ''}>${ct}</option>`).join('');

  const filteredByCountry =
    countrySel.value === 'all'
      ? state.cards
      : state.cards.filter(c => normalizeCountryName(c.country) === countrySel.value);

  const cities = Array.from(
    new Set(
      filteredByCountry
        .map(c => normalizeDistrictName(c.district, c.country))
        .filter(Boolean)
    )
  );
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
    const normCountry = normalizeCountryName(card.country);
    const normDistrict = normalizeDistrictName(card.district, card.country);
    const regionDisplay = formatCardRegionDisplay(card);

    if (q) {
      const hay = `${card.title} ${regionDisplay} ${normDistrict} ${normCountry} ${card.notes} ${card.must_buy || ''}`.toLowerCase();
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

    if (state.filters.scope === 'domestic' && !isDomesticCountry(normCountry)) return false;
    if (state.filters.scope === 'international' && isDomesticCountry(normCountry)) return false;
    if (countryVal !== 'all' && normCountry !== countryVal) return false;
    if (cityVal !== 'all' && normDistrict !== cityVal) return false;
    if (state.filters.category !== 'all' && card.category !== state.filters.category) return false;

    return true;
  });

  if (sortBy === 'unscheduled') {
    list = [...list].sort((a, b) => (scheduledMap[a.id]?.length || 0) - (scheduledMap[b.id]?.length || 0));
  } else if (sortBy === 'district') {
    list = [...list].sort((a, b) =>
      formatCardRegionDisplay(a).localeCompare(formatCardRegionDisplay(b), 'zh-Hant')
    );
  }

  return list;
}

export function renderDatabaseCards() {
  const container = document.getElementById('databaseCardsContainer');
  if (!container) return;

  const totalCount = state.cards.length;
  const domesticCount = state.cards.filter(c => isDomesticCountry(c.country)).length;
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
      const regionText = formatCardRegionDisplay(card);

      return `
        <div id="db-card-${card.id}" draggable="true" ondragstart="onDragStartCard(event, '${card.id}')"
          onclick="handleCardClick('${card.id}')"
          class="bg-white rounded-xl border ${days.length > 0 ? 'border-emerald-200 bg-emerald-50/15' : 'border-slate-200'} p-3 shadow-2xs hover:shadow-sm hover:border-[#2C4D6E]/40 transition flex flex-col justify-between gap-2.5 cursor-pointer">
          <div class="space-y-1.5">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-start gap-2 min-w-0">
                <span class="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style="background:${style.hex}"></span>
                <h3 class="font-bold text-sm text-slate-800 leading-snug break-words">
                  ${card.starred ? '<span class="text-amber-500 mr-0.5">★</span>' : ''}${card.title}
                </h3>
              </div>
              <span class="px-2 py-0.5 rounded-md text-[11px] font-bold ${style.badge} shrink-0">${card.category}</span>
            </div>

            <div class="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500 pl-4">
              <span>${regionText}</span>
              <span>・⏱ ${card.duration || 60}分</span>
              ${dayBadges}
            </div>

            ${
              !state.miniCardMode && card.must_buy
                ? `<div class="pl-4 text-[11px] text-amber-700 font-semibold truncate"><i class="fa-solid fa-star text-amber-400 mr-1"></i>推薦：${card.must_buy}</div>`
                : ''
            }

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
              ${
                card.mapUrl
                  ? `<a href="${card.mapUrl}" target="_blank" rel="noopener" title="開啟 Google Maps"
                      class="w-7 h-7 rounded-lg border border-slate-200 text-emerald-600 hover:bg-emerald-50 flex items-center justify-center text-xs">
                      <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    </a>`
                  : ''
              }
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

let editingCardCache = null;
let lastGeocodedCoordsKey = '';
let detectedMultiSpotsCache = [];

function bindModalCoordAutoGeocode() {
  const latEl = document.getElementById('fieldLat');
  const lngEl = document.getElementById('fieldLng');
  if (!latEl || !lngEl) return;

  if (!latEl.dataset.geoBound) {
    latEl.dataset.geoBound = '1';
    latEl.addEventListener('change', () => autoFillRegionFromModalCoords(false));
    latEl.addEventListener('blur', () => autoFillRegionFromModalCoords(false));
  }
  if (!lngEl.dataset.geoBound) {
    lngEl.dataset.geoBound = '1';
    lngEl.addEventListener('change', () => autoFillRegionFromModalCoords(false));
    lngEl.addEventListener('blur', () => autoFillRegionFromModalCoords(false));
  }
}

async function autoFillRegionFromModalCoords(force = false) {
  const latRaw = document.getElementById('fieldLat')?.value.trim() || '';
  const lngRaw = document.getElementById('fieldLng')?.value.trim() || '';
  if (!latRaw || !lngRaw) return;

  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return;

  const coordsKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (!force && coordsKey === lastGeocodedCoordsKey) return;
  lastGeocodedCoordsKey = coordsKey;

  const result = await reverseGeocodeCoords(lat, lng);
  if (result) {
    const normCountry = normalizeCountryName(result.country);
    const normDistrict = normalizeDistrictName(result.district, normCountry);
    const countryEl = document.getElementById('fieldCountry');
    const districtEl = document.getElementById('fieldDistrict');
    if (countryEl && normCountry) countryEl.value = normCountry;
    if (districtEl && normDistrict) districtEl.value = normDistrict;
    const preview = formatCardRegionDisplay({ country: normCountry, district: normDistrict });
    showToast(`已自動帶入地區：${preview}`, 'emerald');
  } else if (force) {
    showToast('反查國家與行政區失敗，請確認經緯度格式', 'rose');
  }
}

// ==================== 日本繁體地址轉日文漢字與漸進式地理編碼 ====================
function toJapaneseAddressKanji(addr) {
  const map = [
    ['沖繩', '沖縄'],
    ['那霸', '那覇'],
    ['豐見城', '豊見城'],
    ['宜野灣', '宜野湾'],
    ['糸滿', '糸満'],
    ['讀谷', '読谷'],
    ['廣島', '広島'],
    ['橫濱', '横浜'],
    ['鐮倉', '鎌倉'],
    ['輕井澤', '軽井沢'],
    ['澀谷', '渋谷'],
    ['淺草', '浅草'],
    ['神戶', '神戸'],
    ['奈良', '奈良'],
    ['金澤', '金沢'],
    ['高松', '高松'],
    ['松山', '松山'],
    ['長崎', '長崎'],
    ['熊本', '熊本'],
    ['鹿兒島', '鹿児島'],
    ['別府', '別府'],
    ['由布院', '由布院']
  ];
  let out = String(addr || '');
  for (const [trad, jp] of map) {
    out = out.replace(new RegExp(trad, 'g'), jp);
  }
  return out;
}

async function resolvePlaceCoordsAndRegion(title, address, countryHint = '') {
  const candidates = [];
  if (address) {
    const cleanAddr = address.replace(/^[📍\s]*(?:地址|Address)[：:\s]*/i, '').trim();
    const jpAddr = toJapaneseAddressKanji(cleanAddr);
    candidates.push(cleanAddr);
    if (jpAddr !== cleanAddr) candidates.push(jpAddr);

    // 去除末尾門牌番地（例如 "沖縄県那覇市牧志3-1-1" -> "沖縄県那覇市牧志"），避免地圖庫因缺門牌查無結果
    const strippedBlock = jpAddr.replace(/[\s\-－]*\d+(?:[\-－]\d+)*\s*(?:F|階|號|号)?\s*$/i, '').trim();
    if (strippedBlock && strippedBlock.length >= 4 && !candidates.includes(strippedBlock)) {
      candidates.push(strippedBlock);
    }
  }

  if (title) {
    // 清理 OCR 誤判符號後再查詢店名
    const cleanTitle = title.replace(/\([^)]*\/?>[^)]*\)/g, '').replace(/（[^）]*\/?>[^）]*）/g, '').trim();
    if (cleanTitle && !candidates.includes(cleanTitle)) {
      candidates.push(cleanTitle);
    }
  }

  for (const query of candidates) {
    const geoRes = await geocodePlaceName(query, countryHint);
    if (geoRes && geoRes.lat != null && geoRes.lng != null) {
      return geoRes;
    }
  }
  return null;
}

// ==================== 智慧快建（Google Drive 原生 OCR ＋ 單/多景點拆解 ＋ Maps 短網址） ====================
function setSmartClipStatus(text, tone = 'slate') {
  const el = document.getElementById('smartClipStatusText');
  if (!el) return;
  if (!text) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  const tones = {
    slate: 'text-slate-500',
    loading: 'text-[#2C4D6E] font-bold',
    emerald: 'text-emerald-700 font-bold',
    rose: 'text-rose-600 font-bold'
  };
  el.className = `text-[11px] leading-relaxed ${tones[tone] || tones.slate}`;
  el.textContent = text;
  el.classList.remove('hidden');
}

function hideMultiSpotBatchBox() {
  detectedMultiSpotsCache = [];
  const box = document.getElementById('multiSpotBatchBox');
  if (box) {
    box.classList.add('hidden');
    box.innerHTML = '';
  }
}

function renderMultiSpotBatchBox() {
  const box = document.getElementById('multiSpotBatchBox');
  if (!box) return;
  if (!detectedMultiSpotsCache.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }

  const selectedCount = detectedMultiSpotsCache.filter(s => s.checked).length;
  const allChecked = selectedCount === detectedMultiSpotsCache.length;

  const itemsHtml = detectedMultiSpotsCache
    .map((spot, idx) => {
      const style = CATEGORY_STYLES[spot.category] || CATEGORY_STYLES['景點'];
      return `
        <div class="flex items-start justify-between gap-2 p-2 rounded-lg bg-white border ${spot.checked ? 'border-[#2C4D6E]/40' : 'border-slate-200 opacity-65'}">
          <label class="flex items-start gap-2 min-w-0 flex-1 cursor-pointer">
            <input type="checkbox" ${spot.checked ? 'checked' : ''} onchange="toggleMultiSpotItem(${idx}, this.checked)"
              class="mt-0.5 accent-[#2C4D6E] w-3.5 h-3.5 rounded shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-bold text-slate-800 text-xs break-words">${spot.title}</span>
                <span class="px-1.5 py-0.2 rounded text-[10px] font-bold ${style.badge} shrink-0">${spot.category}</span>
              </div>
              <div class="text-[11px] text-slate-500 truncate mt-0.5">
                <i class="fa-solid fa-location-dot text-rose-400 mr-1"></i>${spot.address || '未附地址（將依店名定位）'}
              </div>
            </div>
          </label>
          <button type="button" onclick="applySingleSpotFromBatch(${idx})" title="將此店家填入下方表單單獨編輯"
            class="px-2 py-1 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[10px] font-bold text-slate-600 shrink-0">
            單筆帶入
          </button>
        </div>
      `;
    })
    .join('');

  box.innerHTML = `
    <div class="flex items-center justify-between gap-2">
      <span class="font-bold text-[#2C4D6E] text-[11px]">
        <i class="fa-solid fa-list-check mr-1"></i>偵測到 ${detectedMultiSpotsCache.length} 個地點，請勾選要建立的卡片：
      </span>
      <button type="button" onclick="toggleAllMultiSpots(${!allChecked})"
        class="text-[11px] font-bold text-[#2C4D6E] hover:underline">
        ${allChecked ? '全部取消' : '全選'}
      </button>
    </div>
    <div class="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">${itemsHtml}</div>
    <div class="flex items-center justify-between gap-2 pt-1">
      <span class="text-[10px] text-slate-500">將套用下方「排入行程」與「必去標記」設定</span>
      <button type="button" id="btnBatchCreateSpots" onclick="batchCreateSelectedSpots()"
        ${selectedCount === 0 ? 'disabled' : ''}
        class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-[11px] font-bold flex items-center gap-1 shadow-2xs transition">
        <i class="fa-solid fa-layer-group"></i>
        <span>批次建立已勾選卡片 (${selectedCount} 張)</span>
      </button>
    </div>
  `;
  box.classList.remove('hidden');
}

export function toggleMultiSpotItem(index, checked) {
  if (!detectedMultiSpotsCache[index]) return;
  detectedMultiSpotsCache[index].checked = Boolean(checked);
  renderMultiSpotBatchBox();
}

export function toggleAllMultiSpots(checked) {
  detectedMultiSpotsCache.forEach(item => {
    item.checked = Boolean(checked);
  });
  renderMultiSpotBatchBox();
}

export async function applySingleSpotFromBatch(index) {
  const spot = detectedMultiSpotsCache[index];
  if (!spot) return;

  setSmartClipStatus(`正在帶入「${spot.title}」並查詢座標...`, 'loading');
  document.getElementById('fieldTitle').value = spot.title;

  const catSel = document.getElementById('fieldCategory');
  if (catSel) {
    catSel.value = spot.category;
    onModalCategoryChange();
  }
  if (document.getElementById('fieldMustBuy')) {
    document.getElementById('fieldMustBuy').value = spot.must_buy || '';
  }
  if (document.getElementById('fieldBusinessHours')) {
    document.getElementById('fieldBusinessHours').value = spot.business_hours || '';
  }
  document.getElementById('fieldNotes').value = spot.notes || '';
  document.getElementById('fieldMapUrl').value = '';
  document.getElementById('fieldLat').value = '';
  document.getElementById('fieldLng').value = '';

  const currentCountry = document.getElementById('fieldCountry')?.value || '';
  const geoRes = await resolvePlaceCoordsAndRegion(spot.title, spot.address, currentCountry);
  if (geoRes) {
    const normCountry = normalizeCountryName(geoRes.country);
    const normDistrict = normalizeDistrictName(geoRes.district, normCountry);
    document.getElementById('fieldLat').value = geoRes.lat;
    document.getElementById('fieldLng').value = geoRes.lng;
    document.getElementById('fieldCountry').value = normCountry;
    document.getElementById('fieldDistrict').value = normDistrict;
  }

  const regionHint = document.getElementById('fieldDistrict')?.value.trim() || spot.address || '';
  const searchQuery = [spot.title, regionHint].filter(Boolean).join(' ');
  document.getElementById('fieldMapUrl').value = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`;

  setSmartClipStatus(`已將「${spot.title}」帶入下方表單，確認後按「儲存並寫入試算表」即可！`, 'emerald');
  showToast(`已帶入「${spot.title}」`, 'emerald');
}

export async function batchCreateSelectedSpots() {
  const selected = detectedMultiSpotsCache.filter(s => s.checked);
  if (selected.length === 0) {
    showToast('請至少勾選一筆要建立的景點', 'amber');
    return;
  }

  const btn = document.getElementById('btnBatchCreateSpots');
  if (btn) btn.disabled = true;

  const defaultCountry = normalizeCountryName(document.getElementById('fieldCountry')?.value || '日本');
  const defaultDuration = Math.max(0, parseInt(document.getElementById('fieldDuration')?.value, 10) || 60);
  const starred = Boolean(document.getElementById('fieldStarred')?.checked);
  const assignDay = document.getElementById('fieldAssignDay')?.value || '';

  const createdCards = [];
  try {
    for (let i = 0; i < selected.length; i++) {
      const spot = selected[i];
      setSmartClipStatus(`正在定位與建立 (${i + 1}/${selected.length})：${spot.title}...`, 'loading');

      let lat = null;
      let lng = null;
      let normCountry = defaultCountry;
      let normDistrict = '';

      const geoRes = await resolvePlaceCoordsAndRegion(spot.title, spot.address, defaultCountry);
      if (geoRes) {
        lat = geoRes.lat;
        lng = geoRes.lng;
        normCountry = normalizeCountryName(geoRes.country || defaultCountry);
        normDistrict = normalizeDistrictName(geoRes.district, normCountry);
      }

      const searchQuery = [spot.title, normDistrict || spot.address].filter(Boolean).join(' ');
      const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`;

      const payload = {
        id: `spot_${Date.now()}_${i}`,
        title: spot.title,
        category: spot.category || '景點',
        country: normCountry,
        district: normDistrict,
        duration: defaultDuration,
        lat,
        lng,
        notes: spot.notes || '',
        mapUrl,
        image: '',
        starred,
        must_buy: spot.must_buy || '',
        business_hours: spot.business_hours || '',
        parking_info: '',
        meta: {}
      };
      createdCards.push(payload);

      if (i < selected.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 320));
      }
    }

    for (let i = createdCards.length - 1; i >= 0; i--) {
      state.cards.unshift(createdCards[i]);
    }
    if (assignDay && typeof hooks.addCardToDay === 'function') {
      createdCards.forEach(c => hooks.addCardToDay(c.id, Number(assignDay)));
    }

    populateRegionDropdowns();
    persistState(true);
    closeCardModal();
    if (typeof hooks.renderAll === 'function') hooks.renderAll();
    showToast(`已成功批次建立 ${createdCards.length} 張口袋卡片並同步！`, 'emerald');
  } catch (err) {
    console.error('批次建立卡片發生錯誤:', err);
    setSmartClipStatus(`批次建立異常：${err.message}`, 'rose');
    if (btn) btn.disabled = false;
  }
}

function compressImageFileToBase64(file, maxWidth = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('圖片讀取失敗'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('檔案讀取失敗'));
    reader.readAsDataURL(file);
  });
}

function inferCategoryFromText(text) {
  const t = String(text || '');
  if (/機場|空港|Airport|航廈|航班/i.test(t)) return '機場';
  if (/飯店|酒店|民宿|旅館|青旅|度假村|Hotel|Resort|Hostel|Inn/i.test(t)) return '住宿';
  if (/拉麵|燒肉|居酒屋|咖啡|甜點|蛋糕|餐廳|小吃|美食|食堂|壽司|烏龍麵|定食|早午餐|牛排|火鍋|冰|茶|酒|卷餅|肉桂捲|麵包|烘焙|霜淇淋|冰淇淋|菓子|蕨餅|牛乳餅|Cafe|Ramen|Sushi|BBQ|Buns|Bakery|Ice\s*Cream|Soft\s*Serve/i.test(t)) return '美食';
  if (/藥妝|購物|百貨|商場|伴手禮|超市|免稅|Outlet|Mall|Store|Shop|唐吉訶德|大國/i.test(t)) return '購物';
  if (/車站|單軌|地鐵|公車|巴士|渡輪|碼頭|租車|Station|Bus|Ferry/i.test(t)) return '交通';
  if (/潛水|浮潛|體驗|和服|手作|溫泉|SPA|樂園|門票|水族館|美術館|博物館/i.test(t)) return '體驗';
  return '景點';
}

function filterSocialUiNoiseLines(rawText) {
  const lines = normalizeTraditionalText(rawText)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const noiseExact = /^(追蹤|追蹤中|發送訊息|讚|留言|留言\.{2,}|留言…+|回覆|分享|收藏|儲存|查看翻譯|顯示翻譯|原始音訊|更多|展開|收合|reels|instagram|facebook|following|follow|like|comment|share|save|sponsored|贊助|廣告|\d+\s*[萬千]?\s*(次觀看|個讚|則留言|次分享))$/i;
  const statusBarNoise = /(KB\/S|MB\/S|VoLTE|5G|4G|LTE|\bWi-?Fi\b)/i;
  const socialHeaderNoise = /(?:・|\|)\s*(?:追蹤|追蹤中|Follow|Following|原始音訊|Original\s*Audio)\s*$/i;

  return lines.filter(line => {
    if (noiseExact.test(line)) return false;
    if (statusBarNoise.test(line) && line.length <= 28) return false;
    if (socialHeaderNoise.test(line) && line.length <= 45) return false;
    if (/^🎵|^♫/.test(line) && /原始音訊/.test(line)) return false;
    if (/^\d{1,2}:\d{2}$/.test(line)) return false;
    if (/^\d{1,3}%$/.test(line)) return false;
    if (/^[0-9\s.,kKmM萬千]+$/.test(line)) return false;
    if (/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF\s]+$/u.test(line)) return false;
    return true;
  });
}

function extractHoursFromLines(cleanLines) {
  const timeRangeRegex = /\d{1,2}[:：]\d{2}\s*[-~～至]\s*\d{1,2}[:：]\d{2}/;
  const closedDayRegex = /(公休|定休日|休息|休館|週[一二三四五六日天]休|星期[一二三四五六日天].{0,4}休)/;
  const explicitLabelRegex = /^(?:⏰|🕒|🕐|營業時間|營業時段|開放時間)[：:\s]*/;

  const timeIdx = cleanLines.findIndex(l => timeRangeRegex.test(l));
  if (timeIdx !== -1) {
    let result = cleanLines[timeIdx].replace(explicitLabelRegex, '').trim();
    const nextLine = cleanLines[timeIdx + 1] || '';
    if (
      nextLine &&
      nextLine.length <= 30 &&
      (closedDayRegex.test(nextLine) || /^[)）\/／]/.test(nextLine)) &&
      !/[¥￥$円]/.test(nextLine)
    ) {
      const needJoiner = !/[\/／\-－]$/.test(result) && !/^[)）\/／]/.test(nextLine);
      result = needJoiner ? `${result} / ${nextLine}` : `${result}${nextLine}`;
    }
    return result;
  }

  const labeledIdx = cleanLines.findIndex(l => explicitLabelRegex.test(l) && l.length <= 45);
  if (labeledIdx !== -1) {
    return cleanLines[labeledIdx].replace(explicitLabelRegex, '').trim();
  }

  const closedLine = cleanLines.find(l => closedDayRegex.test(l) && l.length <= 35);
  if (closedLine) {
    return closedLine.replace(explicitLabelRegex, '').trim();
  }

  return '';
}

function extractMustBuyFromLines(cleanLines) {
  const priceRegex = /(?:[¥￥$]\s*\d+|\d+\s*(?:円|日元|日圓|元))/;
  const menuIconRegex = /^[🧾🍽️🍴🍰☕🥐🍔🍜🍣]+\s*/u;
  const explicitMustRegex = /(推薦|必點|必吃|必買|招牌|人氣|菜單)[：:\s]/;

  const priceIdx = cleanLines.findIndex(l => priceRegex.test(l) || menuIconRegex.test(l));
  if (priceIdx !== -1) {
    let menuText = cleanLines[priceIdx]
      .replace(menuIconRegex, '')
      .replace(/^(菜單|價目|推薦|必點|必吃)[：:\s]*/i, '')
      .trim();

    let cursor = priceIdx + 1;
    while (cursor < cleanLines.length && cursor <= priceIdx + 2) {
      const next = cleanLines[cursor];
      if (!next || next.startsWith('*') || next.startsWith('@') || next.startsWith('#') || next.startsWith('http')) break;
      if (priceRegex.test(next) || /[\/／、]$/.test(menuText)) {
        menuText += next;
        cursor++;
      } else {
        break;
      }
    }
    return menuText.trim();
  }

  const mustLine = cleanLines.find(l => explicitMustRegex.test(l));
  if (mustLine) {
    return mustLine.replace(/^.*?(推薦|必點|必吃|必買|招牌|人氣|菜單)[：:\s]*/i, '').trim();
  }

  return '';
}

function cleanSpotHeadingLine(line) {
  return String(line || '')
    .replace(/^(?:[1-9１-９][0-9０-９]?[️⃣.、)）\s]+|[\u{1F300}-\u{1FAFF}\u2600-\u27BF•・\-]+\s*)+/u, '')
    .trim();
}

function detectMultipleSpotsFromLines(cleanLines) {
  const addrRegex = /^(?:📍\s*)?(?:地址|Address)[：:\s]+(.+)$/i;
  const addrIndices = [];
  cleanLines.forEach((line, idx) => {
    if (addrRegex.test(line)) addrIndices.push(idx);
  });

  if (addrIndices.length < 2) return [];

  const spots = [];
  for (let i = 0; i < addrIndices.length; i++) {
    const addrIdx = addrIndices[i];
    const prevAddrIdx = i === 0 ? -1 : addrIndices[i - 1];
    const address = cleanLines[addrIdx].replace(addrRegex, '$1').trim();

    let segment = cleanLines.slice(prevAddrIdx + 1, addrIdx);

    if (i === 0) {
      const bracketPos = segment.findIndex(l => /^【.+】$/.test(l));
      if (bracketPos !== -1) {
        segment = segment.slice(bracketPos + 1);
      }
      const colonIntroPos = segment.findIndex(l => /[：:]$/.test(l) && l.length >= 12);
      if (colonIntroPos !== -1 && colonIntroPos < segment.length - 1) {
        segment = segment.slice(colonIntroPos + 1);
      }
    }

    if (segment.length === 0) continue;

    let titleIdx = 0;
    let rawTitleLine = segment[0];

    if (
      segment.length >= 2 &&
      /[（(][^）)]*$/.test(rawTitleLine) &&
      /[）)]/.test(segment[1])
    ) {
      rawTitleLine = `${rawTitleLine}${segment[1]}`;
      titleIdx = 1;
    }

    const title = cleanSpotHeadingLine(rawTitleLine);
    if (!title || title.length < 2) continue;

    const descLines = segment.slice(titleIdx + 1).filter(l => !/^👉/.test(l));
    const hours = extractHoursFromLines(descLines);
    const mustBuy = extractMustBuyFromLines(descLines);
    const notesText = [...descLines, `📍 地址：${address}`].join('\n').trim();
    const category = inferCategoryFromText(`${title} ${notesText}`);

    spots.push({
      title,
      category,
      address,
      notes: notesText,
      business_hours: hours,
      must_buy: mustBuy,
      checked: true
    });
  }

  return spots.length >= 2 ? spots : [];
}

async function applyParsedFieldsToCardModal(rawText, mapInfo = null) {
  hideMultiSpotBatchBox();
  const allLines = filterSocialUiNoiseLines(rawText);

  // 先檢查是否為「懶人包／精選多間店」合集貼文
  const multiSpots = detectMultipleSpotsFromLines(allLines);
  if (multiSpots.length >= 2) {
    detectedMultiSpotsCache = multiSpots;
    renderMultiSpotBatchBox();
    return { isMultiSpot: true, count: multiSpots.length };
  }

  // 若為單一店家截圖，過濾影片畫面頂端無關的覆蓋小字（在「【店名】」之前）
  const bracketIdx = allLines.findIndex(l => /[【「《『][^】」》』\n]{2,28}[】」》』]/.test(l));
  const cleanLines =
    bracketIdx > 1 && allLines[0].length <= 16 && !/[，。！？,.!?]/.test(allLines[0])
      ? allLines.slice(1)
      : allLines;

  const fullCleanText = cleanLines.join('\n');

  // 1. 地點名稱萃取（排除 📍 地址、營業時間等欄位行，並支援最長 65 字元的雙語店名）
  const fieldPrefixNoise = /^(?:📍|⏰|🕒|🕐|🧾|🍽️|地址|Address|營業時間|營業時段|開放時間|公休|電話|TEL|官網|IG|Instagram)[：:\s]/i;
  let titleLineIndex = -1;
  let detectedTitle = mapInfo?.placeTitle ? normalizeTraditionalText(mapInfo.placeTitle) : '';

  if (!detectedTitle) {
    const bracketMatch = fullCleanText.match(/[【「《『]([^】」》』\n]{2,32})[】」》』]/);
    if (bracketMatch && bracketMatch[1]) {
      detectedTitle = bracketMatch[1].trim();
    }
  }
  if (!detectedTitle) {
    titleLineIndex = cleanLines.findIndex(
      l =>
        !l.startsWith('http') &&
        !l.startsWith('#') &&
        !l.startsWith('@') &&
        !fieldPrefixNoise.test(l) &&
        !/。/.test(l) &&
        l.length >= 2 &&
        l.length <= 65
    );
    if (titleLineIndex !== -1) {
      detectedTitle = cleanSpotHeadingLine(cleanLines[titleLineIndex])
        .split(/[｜|／—]/)[0]
        .trim();
    }
  }

  // 2. 類別推斷
  const detectedCategory = inferCategoryFromText(`${detectedTitle} ${fullCleanText}`);

  // 3. 營業時間／公休日精準萃取
  const detectedHours = extractHoursFromLines(cleanLines);

  // 4. 必點／推薦品項與菜單萃取
  const detectedMustBuy = extractMustBuyFromLines(cleanLines);

  // 5. 交通／停車資訊萃取
  let detectedParking = '';
  const parkLine = cleanLines.find(l => /(停車|停車場|步行\s*\d+\s*分|車站|單軌|捷運|公車|出口)/.test(l));
  if (parkLine) {
    detectedParking = parkLine.replace(/^(交通|停車)[：:\s]*/i, '').trim();
  }

  // 6. 地址或地區線索萃取（支援中文縣市、📍圖示行及英文日本地址，並完整清除「📍 地址：」前綴）
  let addrLine = '';
  const pinIdx = cleanLines.findIndex(l => /^(?:📍\s*)?(?:地址|Address)[：:\s]/i.test(l) || /^📍/.test(l));
  if (pinIdx !== -1) {
    addrLine = cleanLines[pinIdx].replace(/^[📍\s]*(?:地址|Address)[：:\s]*/i, '').trim();
    const nextAddr = cleanLines[pinIdx + 1] || '';
    if (nextAddr && /,/.test(nextAddr) && !/^[⏰🕒🧾*@]/.test(nextAddr)) {
      addrLine = `${addrLine} ${nextAddr}`.trim();
    }
  } else {
    const foundAddr = cleanLines.find(l =>
      /(地址|沖繩縣|東京都|大阪府|京都府|北海道|福岡縣|臺北市|新北市|桃園市|臺中市|臺南市|高雄市|宜蘭縣|花蓮縣|臺東縣|南投縣|屏東縣|澎湖縣|金門縣|Okinawa|Tokyo|Osaka|Kyoto|Hokkaido|Fukuoka)/i.test(l)
    );
    if (foundAddr) {
      addrLine = foundAddr.replace(/^[📍\s]*(?:地址|Address)[：:\s]*/i, '').trim();
    }
  }

  // 7. 精簡備註（移除純 Hashtag 行、網址行及已抽出的首行店名，保留乾淨介紹與地址）
  const noteLines = cleanLines.filter((l, idx) => idx !== titleLineIndex && !l.startsWith('http') && !/^#/.test(l));
  const summaryNotes = noteLines
    .join('\n')
    .replace(/#[^\s#]+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 500);

  // 填入表單欄位
  if (detectedTitle) {
    document.getElementById('fieldTitle').value = detectedTitle;
  }

  const catSel = document.getElementById('fieldCategory');
  if (catSel) {
    catSel.value = detectedCategory;
    onModalCategoryChange();
  }

  if (document.getElementById('fieldMustBuy')) {
    document.getElementById('fieldMustBuy').value = detectedMustBuy || '';
  }
  if (document.getElementById('fieldBusinessHours')) {
    document.getElementById('fieldBusinessHours').value = detectedHours || '';
  }
  if (document.getElementById('fieldParkingInfo')) {
    document.getElementById('fieldParkingInfo').value = detectedParking || '';
  }
  if (summaryNotes) {
    document.getElementById('fieldNotes').value = summaryNotes;
  }

  // 網址與經緯度處理
  const urlInText = rawText.match(/https?:\/\/[^\s"'<>）)】」』]+/i)?.[0] || '';
  const finalMapUrl = mapInfo?.expandedUrl || urlInText;
  if (finalMapUrl && /google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(finalMapUrl)) {
    document.getElementById('fieldMapUrl').value = finalMapUrl;
  }

  const inlineCoords = extractCoordsFromText(rawText);
  const finalLat = mapInfo?.lat ?? inlineCoords?.lat ?? null;
  const finalLng = mapInfo?.lng ?? inlineCoords?.lng ?? null;

  if (finalLat != null && finalLng != null) {
    document.getElementById('fieldLat').value = finalLat;
    document.getElementById('fieldLng').value = finalLng;
    await autoFillRegionFromModalCoords(true);
  } else {
    const currentCountry = document.getElementById('fieldCountry')?.value || '';
    const geoRes = await resolvePlaceCoordsAndRegion(detectedTitle, addrLine, currentCountry);
    if (geoRes) {
      const normCountry = normalizeCountryName(geoRes.country);
      const normDistrict = normalizeDistrictName(geoRes.district, normCountry);
      document.getElementById('fieldLat').value = geoRes.lat;
      document.getElementById('fieldLng').value = geoRes.lng;
      document.getElementById('fieldCountry').value = normCountry;
      document.getElementById('fieldDistrict').value = normDistrict;
    }
  }

  // 8. 若原圖沒有附帶 Google Maps 網址，但已解析出店名與地區，自動補齊搜尋連結方便導航
  const mapUrlInput = document.getElementById('fieldMapUrl');
  if (mapUrlInput && !mapUrlInput.value.trim() && detectedTitle) {
    const regionHint = document.getElementById('fieldDistrict')?.value.trim() || addrLine || '';
    const searchQuery = [detectedTitle, regionHint].filter(Boolean).join(' ');
    mapUrlInput.value = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`;
  }

  return { isMultiSpot: false, count: 1 };
}

export function toggleSmartClipBox() {
  const body = document.getElementById('smartClipBody');
  const chev = document.getElementById('smartClipChevron');
  if (!body) return;
  const isHidden = body.classList.contains('hidden');
  if (isHidden) {
    body.classList.remove('hidden');
    if (chev) chev.className = 'fa-solid fa-chevron-up text-[10px]';
  } else {
    body.classList.add('hidden');
    if (chev) chev.className = 'fa-solid fa-chevron-down text-[10px]';
  }
}

export function clearSmartClipBox() {
  const input = document.getElementById('smartClipTextInput');
  const fileInput = document.getElementById('smartScreenshotInput');
  if (input) input.value = '';
  if (fileInput) fileInput.value = '';
  hideMultiSpotBatchBox();
  setSmartClipStatus('', 'slate');
}

export async function runSmartTextParse() {
  const rawText = (document.getElementById('smartClipTextInput')?.value || '').trim();
  if (!rawText) {
    showToast('請先貼上 FB 貼文文字或 Google Maps 網址', 'amber');
    return;
  }

  const hasShortUrl = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/i.test(rawText);
  let mapInfo = null;

  try {
    if (hasShortUrl) {
      setSmartClipStatus('正在透過 GAS 後端展開 Google Maps 短網址...', 'loading');
      const res = await requestSmartExtractFromGas({ text: rawText });
      if (res.status === 'ok') {
        mapInfo = res.mapInfo || null;
      } else {
        showToast(res.message || '短網址展開失敗，改用文字解析', 'amber');
      }
    } else {
      setSmartClipStatus('正在拆解貼文欄位與定位地區...', 'loading');
    }

    const parseRes = await applyParsedFieldsToCardModal(rawText, mapInfo);
    if (parseRes?.isMultiSpot) {
      setSmartClipStatus(`偵測到 ${parseRes.count} 個地點合集！請勾選要建立的卡片後點擊批次建立。`, 'emerald');
      showToast(`已拆解出 ${parseRes.count} 個地點，請勾選建立`, 'emerald');
    } else {
      setSmartClipStatus('已自動拆解並帶入下方卡片欄位，請確認後儲存！', 'emerald');
      showToast('智慧拆解完成，已自動填入卡片欄位', 'emerald');
    }
  } catch (err) {
    console.error('智慧文字解析錯誤:', err);
    setSmartClipStatus(`解析發生異常：${err.message}`, 'rose');
  }
}

async function processScreenshotFileForOcr(file) {
  if (!file) return;
  try {
    setSmartClipStatus('正在壓縮截圖並呼叫 Google Drive OCR 辨識文字...', 'loading');
    const compressedDataUrl = await compressImageFileToBase64(file, 1200, 0.8);
    const existingText = (document.getElementById('smartClipTextInput')?.value || '').trim();

    const res = await requestSmartExtractFromGas({
      text: existingText,
      imageBase64: compressedDataUrl,
      mimeType: 'image/jpeg'
    });

    if (res.status !== 'ok') {
      setSmartClipStatus(res.message || 'OCR 辨識失敗，請確認 GAS 已啟用 Drive API', 'rose');
      showToast(res.message || 'OCR 辨識失敗', 'rose');
      return;
    }

    const ocrText = String(res.ocrText || '').trim();
    const combinedText = [existingText, ocrText].filter(Boolean).join('\n');
    const textBox = document.getElementById('smartClipTextInput');
    if (textBox && ocrText) {
      textBox.value = combinedText;
    }

    if (!combinedText && !res.mapInfo) {
      setSmartClipStatus('圖片中未偵測到可辨識文字，請換一張較清晰的截圖', 'rose');
      return;
    }

    const parseRes = await applyParsedFieldsToCardModal(combinedText, res.mapInfo || null);
    if (parseRes?.isMultiSpot) {
      setSmartClipStatus(`OCR 辨識完成！偵測到 ${parseRes.count} 個地點，請勾選後點擊批次建立。`, 'emerald');
      showToast(`已從截圖拆解出 ${parseRes.count} 個地點`, 'emerald');
    } else {
      setSmartClipStatus('Drive OCR 辨識完成！已自動填入店名、菜單、營業時間與地區', 'emerald');
      showToast('截圖文字辨識完成並已帶入表單', 'emerald');
    }
  } catch (err) {
    console.error('截圖 OCR 錯誤:', err);
    setSmartClipStatus(`截圖辨識失敗：${err.message}`, 'rose');
    showToast('截圖辨識失敗，請稍後再試', 'rose');
  }
}

export async function handleSmartScreenshotUpload(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  await processScreenshotFileForOcr(file);
  event.target.value = '';
}

export async function handleSmartPasteEvent(event) {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type && items[i].type.startsWith('image/')) {
      event.preventDefault();
      const file = items[i].getAsFile();
      if (file) {
        await processScreenshotFileForOcr(file);
      }
      return;
    }
  }
}

export function openCardModal(cardId = null) {
  const modal = document.getElementById('cardModal');
  if (!modal) return;

  bindModalCoordAutoGeocode();
  clearSmartClipBox();

  const totalDays = Math.max(1, Number(state.settings.totalDays) || 6);
  const assignSel = document.getElementById('fieldAssignDay');
  if (assignSel) {
    assignSel.innerHTML =
      `<option value="">僅存入口袋資料庫</option>` +
      Array.from({ length: totalDays }, (_, i) => `<option value="${i + 1}">Day ${i + 1}</option>`).join('');
  }

  const smartBody = document.getElementById('smartClipBody');
  const smartChev = document.getElementById('smartClipChevron');

  if (cardId) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;
    editingCardCache = card;
    const normCountry = normalizeCountryName(card.country);
    const normDistrict = normalizeDistrictName(card.district, normCountry);
    document.getElementById('cardModalTitle').textContent = '編輯口袋卡片';
    document.getElementById('editCardId').value = card.id;
    document.getElementById('fieldTitle').value = card.title || '';
    document.getElementById('fieldCategory').value = card.category || '景點';
    document.getElementById('fieldCountry').value = normCountry;
    document.getElementById('fieldDistrict').value = normDistrict;
    document.getElementById('fieldDuration').value = card.duration || 60;
    document.getElementById('fieldLat').value = card.lat ?? '';
    document.getElementById('fieldLng').value = card.lng ?? '';
    document.getElementById('fieldNotes').value = card.notes || '';
    document.getElementById('fieldMapUrl').value = card.mapUrl || '';
    document.getElementById('fieldImage').value = card.image || '';
    document.getElementById('fieldStarred').checked = Boolean(card.starred);
    lastGeocodedCoordsKey =
      card.lat != null && card.lng != null ? `${Number(card.lat).toFixed(5)},${Number(card.lng).toFixed(5)}` : '';

    if (smartBody) smartBody.classList.add('hidden');
    if (smartChev) smartChev.className = 'fa-solid fa-chevron-down text-[10px]';
  } else {
    editingCardCache = {};
    lastGeocodedCoordsKey = '';
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

    if (smartBody) smartBody.classList.remove('hidden');
    if (smartChev) smartChev.className = 'fa-solid fa-chevron-up text-[10px]';
  }

  onModalCategoryChange();
  modal.classList.remove('hidden');
}

export function closeCardModal() {
  document.getElementById('cardModal')?.classList.add('hidden');
}

export function onModalCategoryChange() {
  const box = document.getElementById('dynamicCategoryFieldsBox');
  if (!box) return;
  const cat = document.getElementById('fieldCategory')?.value || '景點';
  const cur = editingCardCache || {};

  const mustBuyLabel =
    cat === '美食' ? '必點招牌菜色 (must_buy)' : cat === '購物' ? '必買清單 / 退稅提醒 (must_buy)' : '重點亮點 / 必看項目 (must_buy)';

  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      <div>
        <label class="block font-bold text-slate-700 mb-1">${mustBuyLabel}</label>
        <input type="text" id="fieldMustBuy" value="${(cur.must_buy || '').replace(/"/g, '&quot;')}"
          placeholder="例如：塔可飯、限定伴手禮..."
          class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#2C4D6E]" />
      </div>
      <div>
        <label class="block font-bold text-slate-700 mb-1">營業時間 / 班次時段 (business_hours)</label>
        <input type="text" id="fieldBusinessHours" value="${(cur.business_hours || '').replace(/"/g, '&quot;')}"
          placeholder="例如：10:00 - 21:00（週三公休）"
          class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#2C4D6E]" />
      </div>
    </div>
    <div>
      <label class="block font-bold text-slate-700 mb-1">交通接駁 / 停車資訊 (parking_info)</label>
      <input type="text" id="fieldParkingInfo" value="${(cur.parking_info || '').replace(/"/g, '&quot;')}"
        placeholder="例如：單軌美榮橋站步行 5 分鐘 / 附設免費停車場"
        class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#2C4D6E]" />
    </div>
  `;
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
  const normCountry = normalizeCountryName(document.getElementById('fieldCountry').value);
  const normDistrict = normalizeDistrictName(document.getElementById('fieldDistrict').value, normCountry);

  const payload = {
    id: editId || `spot_${Date.now()}`,
    title,
    category: document.getElementById('fieldCategory').value || '景點',
    country: normCountry,
    district: normDistrict,
    duration: Math.max(0, parseInt(document.getElementById('fieldDuration').value, 10) || 60),
    lat: latRaw !== '' && !isNaN(Number(latRaw)) ? Number(latRaw) : null,
    lng: lngRaw !== '' && !isNaN(Number(lngRaw)) ? Number(lngRaw) : null,
    notes: document.getElementById('fieldNotes').value.trim(),
    mapUrl: document.getElementById('fieldMapUrl').value.trim(),
    image: document.getElementById('fieldImage').value.trim(),
    starred: document.getElementById('fieldStarred').checked,
    must_buy: document.getElementById('fieldMustBuy')?.value.trim() || '',
    business_hours: document.getElementById('fieldBusinessHours')?.value.trim() || '',
    parking_info: document.getElementById('fieldParkingInfo')?.value.trim() || '',
    meta: editingCardCache?.meta || {}
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
  const coords = extractCoordsFromText(text);
  if (coords) {
    event.preventDefault();
    document.getElementById('fieldLat').value = coords.lat;
    document.getElementById('fieldLng').value = coords.lng;
    autoFillRegionFromModalCoords(true);
  }
}

export async function extractCoordsFromMapUrlField() {
  const url = (document.getElementById('fieldMapUrl')?.value || '').trim();
  if (!url) return;

  const coords = extractCoordsFromText(url);
  if (coords) {
    document.getElementById('fieldLat').value = coords.lat;
    document.getElementById('fieldLng').value = coords.lng;
    showToast('已從網址自動擷取經緯度', 'emerald');
    await autoFillRegionFromModalCoords(true);
    return;
  }

  if (/https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/i.test(url)) {
    showToast('正在展開 Google Maps 短網址...', 'blue');
    try {
      const res = await requestSmartExtractFromGas({ text: url });
      if (res.status === 'ok' && res.mapInfo) {
        if (res.mapInfo.expandedUrl) {
          document.getElementById('fieldMapUrl').value = res.mapInfo.expandedUrl;
        }
        if (res.mapInfo.placeTitle && !document.getElementById('fieldTitle').value.trim()) {
          document.getElementById('fieldTitle').value = normalizeTraditionalText(res.mapInfo.placeTitle);
        }
        if (res.mapInfo.lat != null && res.mapInfo.lng != null) {
          document.getElementById('fieldLat').value = res.mapInfo.lat;
          document.getElementById('fieldLng').value = res.mapInfo.lng;
          showToast('已展開短網址並自動擷取座標', 'emerald');
          await autoFillRegionFromModalCoords(true);
        }
      }
    } catch (err) {
      console.warn('短網址展開失敗:', err);
    }
  }
}

export async function reverseGeocodeModalCoords() {
  const lat = document.getElementById('fieldLat')?.value;
  const lng = document.getElementById('fieldLng')?.value;
  if (!lat || !lng) {
    showToast('請先輸入緯度與經度座標', 'amber');
    return;
  }
  await autoFillRegionFromModalCoords(true);
}
