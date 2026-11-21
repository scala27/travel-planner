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

// ==================== 智慧快建（Google Drive 原生 OCR ＋ 輕量規則拆解 ＋ Maps 短網址） ====================
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
  if (/拉麵|燒肉|居酒屋|咖啡|甜點|蛋糕|餐廳|小吃|美食|食堂|壽司|烏龍麵|定食|早午餐|牛排|火鍋|冰|茶|酒|Cafe|Ramen|Sushi|BBQ/i.test(t)) return '美食';
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

  const noiseExact = /^(追蹤|追蹤中|發送訊息|讚|留言|分享|收藏|儲存|查看翻譯|顯示翻譯|原始音訊|更多|展開|收合|reels|instagram|facebook|following|follow|like|comment|share|save|sponsored|贊助|廣告|\d+\s*[萬千]?\s*(次觀看|個讚|則留言|次分享))$/i;

  return lines.filter(line => {
    if (noiseExact.test(line)) return false;
    // 排除手機頂部狀態列時間或電量（如 14:32、98%、5G）
    if (/^\d{1,2}:\d{2}$/.test(line)) return false;
    if (/^\d{1,3}%$/.test(line)) return false;
    if (/^[0-9\s.,kKmM萬千]+$/.test(line)) return false;
    if (/^@[a-zA-Z0-9._]+$/.test(line)) return false;
    return true;
  });
}

async function applyParsedFieldsToCardModal(rawText, mapInfo = null) {
  const cleanLines = filterSocialUiNoiseLines(rawText);
  const fullCleanText = cleanLines.join('\n');

  // 1. 地點名稱萃取（優先取 Maps 地標名、引號內標題或首行非網址非 Hashtag 文字）
  let detectedTitle = mapInfo?.placeTitle ? normalizeTraditionalText(mapInfo.placeTitle) : '';
  if (!detectedTitle) {
    const bracketMatch = fullCleanText.match(/[【「《『]([^】」》』\n]{2,28})[】」》』]/);
    if (bracketMatch && bracketMatch[1]) {
      detectedTitle = bracketMatch[1].trim();
    }
  }
  if (!detectedTitle) {
    const firstCandidate = cleanLines.find(
      l => !l.startsWith('http') && !l.startsWith('#') && l.length >= 2 && l.length <= 36
    );
    if (firstCandidate) {
      detectedTitle = firstCandidate
        .replace(/^[📍🏠🍜🏞️🛍️🏨✈️🚆🎡⭐🔥✨・•\-\d.\s]+/, '')
        .split(/[｜|／\/－—]/)[0]
        .trim();
    }
  }

  // 2. 類別推斷
  const detectedCategory = inferCategoryFromText(`${detectedTitle} ${fullCleanText}`);

  // 3. 營業時間／公休日萃取
  let detectedHours = '';
  const hoursLine = cleanLines.find(l =>
    /(營業時間|營業|時間|公休|定休日|週[一二三四五六日天]休|\d{1,2}[:：]\d{2}\s*[-~～至]\s*\d{1,2}[:：]\d{2})/.test(l)
  );
  if (hoursLine) {
    detectedHours = hoursLine.replace(/^(營業時間|營業|時間)[：:\s]*/i, '').trim();
  }

  // 4. 必點／推薦品項萃取
  let detectedMustBuy = '';
  const mustLine = cleanLines.find(l => /(推薦|必點|必吃|必買|招牌|人氣)[：:\s]/.test(l));
  if (mustLine) {
    detectedMustBuy = mustLine.replace(/^.*?(推薦|必點|必吃|必買|招牌|人氣)[：:\s]*/i, '').trim();
  }

  // 5. 交通／停車資訊萃取
  let detectedParking = '';
  const parkLine = cleanLines.find(l => /(停車|停車場|步行\s*\d+\s*分|車站|單軌|捷運|公車|出口)/.test(l));
  if (parkLine) {
    detectedParking = parkLine.replace(/^(交通|停車|地址)[：:\s]*/i, '').trim();
  }

  // 6. 地址或地區線索萃取
  const addrLine = cleanLines.find(l =>
    /(地址|沖繩縣|東京都|大阪府|京都府|北海道|福岡縣|臺北市|新北市|桃園市|臺中市|臺南市|高雄市|宜蘭縣|花蓮縣|臺東縣|南投縣|屏東縣|澎湖縣|金門縣)/.test(l)
  );

  // 7. 精簡備註（移除純 Hashtag 行與網址行，保留精華內容）
  const noteLines = cleanLines.filter(l => !l.startsWith('http') && !/^#/.test(l));
  const summaryNotes = noteLines
    .join('\n')
    .replace(/#[^\s#]+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 450);

  // 填入表單欄位
  if (detectedTitle && !document.getElementById('fieldTitle').value.trim()) {
    document.getElementById('fieldTitle').value = detectedTitle;
  } else if (detectedTitle) {
    document.getElementById('fieldTitle').value = detectedTitle;
  }

  const catSel = document.getElementById('fieldCategory');
  if (catSel) {
    catSel.value = detectedCategory;
    onModalCategoryChange();
  }

  if (detectedMustBuy && document.getElementById('fieldMustBuy')) {
    document.getElementById('fieldMustBuy').value = detectedMustBuy;
  }
  if (detectedHours && document.getElementById('fieldBusinessHours')) {
    document.getElementById('fieldBusinessHours').value = detectedHours;
  }
  if (detectedParking && document.getElementById('fieldParkingInfo')) {
    document.getElementById('fieldParkingInfo').value = detectedParking;
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
    return;
  }

  // 若無直接座標，嘗試用地址或店名查詢經緯度與地區
  const geoQuery = addrLine
    ? addrLine.replace(/^地址[：:\s]*/i, '').trim()
    : detectedTitle;

  if (geoQuery) {
    const currentCountry = document.getElementById('fieldCountry')?.value || '';
    const geoRes = await geocodePlaceName(geoQuery, currentCountry);
    if (geoRes) {
      const normCountry = normalizeCountryName(geoRes.country);
      const normDistrict = normalizeDistrictName(geoRes.district, normCountry);
      document.getElementById('fieldLat').value = geoRes.lat;
      document.getElementById('fieldLng').value = geoRes.lng;
      document.getElementById('fieldCountry').value = normCountry;
      document.getElementById('fieldDistrict').value = normDistrict;
    }
  }
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

    await applyParsedFieldsToCardModal(rawText, mapInfo);
    setSmartClipStatus('已自動拆解並帶入下方卡片欄位，請確認後儲存！', 'emerald');
    showToast('智慧拆解完成，已自動填入卡片欄位', 'emerald');
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

    await applyParsedFieldsToCardModal(combinedText, res.mapInfo || null);
    setSmartClipStatus('Drive OCR 辨識完成！已自動填入店名、分類與地區', 'emerald');
    showToast('截圖文字辨識完成並已帶入表單', 'emerald');
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

    // 編輯既有卡片時預設收合智慧快建區，維持精簡畫面
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

    // 新增卡片時預設展開智慧快建區，方便手機滑社群秒存
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

  // 若貼入的是 Google Maps 手機短網址，自動呼叫 GAS 後端展開並抓出座標與店名
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
