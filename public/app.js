// SubLedger · 软件订阅开销管家 - 核心应用逻辑 (含 AI 截图智能识别与首期/原价双轨核算)

(function () {
  'use strict';

  const STORAGE_KEY = 'subledger_state_v1';
  const CONFIG = window.SUBLEDGER_CONFIG;
  const LOGOS = window.SUBLEDGER_LOGOS;

  // ---------- 工具函数 ----------
  function escapeHtml(val) {
    if (val === null || val === undefined) return '';
    return String(val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(url) {
    if (!url) return '';
    const trimmed = String(url).trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return '';
  }

  function getToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function parseLocalDate(str) {
    if (!str || typeof str !== 'string') return null;
    const parts = str.split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function formatDateISO(date) {
    if (!date) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatShortDate(date, refYear) {
    if (!date) return '—';
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    if (refYear && y !== refYear) {
      return `${y}年${m}月${d}日`;
    }
    return `${m}月${d}日`;
  }

  function daysBetween(d1, d2) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const utc1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const utc2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
    return Math.round((utc2 - utc1) / msPerDay);
  }

  function formatMoney(num, decimals = 2) {
    const n = Number(num) || 0;
    return n.toLocaleString('zh-CN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatSmartOrig(num) {
    const n = Number(num) || 0;
    if (Math.abs(n - Math.round(n)) < 0.001) {
      return Math.round(n).toLocaleString('zh-CN');
    }
    return formatMoney(n, 2);
  }

  function getCurrencySymbol(code) {
    return (CONFIG.DEFAULT_RATES[code] && CONFIG.DEFAULT_RATES[code].symbol) || `${code} `;
  }

  function getCategoryInfo(catId) {
    return CONFIG.CATEGORIES.find(c => c.id === catId) || CONFIG.CATEGORIES[CONFIG.CATEGORIES.length - 1];
  }

  function getCycleInfo(cycleId) {
    return CONFIG.CYCLES.find(c => c.id === cycleId) || CONFIG.CYCLES[0];
  }

  function deriveShortIcon(name) {
    const clean = (name || '').trim();
    if (!clean) return 'APP';
    if (/^[\x00-\x7F]+$/.test(clean)) {
      const words = clean.split(/\s+/).filter(Boolean);
      if (words.length >= 2) {
        return (words[0][0] + words[1][0]).toUpperCase();
      }
      return clean.slice(0, 3).toUpperCase();
    }
    return clean.slice(0, 2);
  }

  function renderAppLogoHtml(sub, sizeClass = '') {
    const logoSrc = LOGOS ? LOGOS.resolveLogoSrc(sub) : null;
    const cls = ['sub-logo-box', sizeClass].filter(Boolean).join(' ');
    const fallbackText = escapeHtml(sub.icon || deriveShortIcon(sub.name));
    const fallbackBg = escapeHtml(sub.color || '#2563EB');

    if (logoSrc) {
      return `
        <div class="${cls}" data-fallback-text="${fallbackText}" data-fallback-bg="${fallbackBg}">
          <img class="sub-logo-img" src="${escapeHtml(logoSrc)}" alt="${escapeHtml(sub.name || '')}" loading="lazy" />
        </div>
      `;
    }
    return `
      <div class="${cls}">
        <div class="sub-fallback-monogram" style="background:${fallbackBg}">${fallbackText}</div>
      </div>
    `;
  }

  function renderMiniLogoHtml(sub, imgClass = 'mini-logo-img') {
    const logoSrc = LOGOS ? LOGOS.resolveLogoSrc(sub) : null;
    if (logoSrc) {
      return `<img class="${imgClass}" src="${escapeHtml(logoSrc)}" alt="" loading="lazy" />`;
    }
    return `<span class="cat-dot" style="background:${escapeHtml(sub.color || '#2563EB')}"></span>`;
  }

  function bindImageFallbacks(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll('.sub-logo-img').forEach(img => {
      img.addEventListener('error', () => {
        const box = img.closest('.sub-logo-box');
        if (!box) return;
        const txt = box.getAttribute('data-fallback-text') || 'APP';
        const bg = box.getAttribute('data-fallback-bg') || '#2563EB';
        box.innerHTML = `<div class="sub-fallback-monogram" style="background:${escapeHtml(bg)}">${escapeHtml(txt)}</div>`;
      }, { once: true });
    });
  }

  // ---------- 周期日期推算引擎 ----------
  function addCycles(anchorDate, cycle, count) {
    if (!anchorDate || cycle === 'lifetime' || cycle === 'oneoff') return null;
    if (cycle === 'weekly') {
      return new Date(
        anchorDate.getFullYear(),
        anchorDate.getMonth(),
        anchorDate.getDate() + 7 * count
      );
    }
    const monthMap = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12, biennial: 24 };
    const stepMonths = monthMap[cycle] || 1;
    const totalMonths = anchorDate.getFullYear() * 12 + anchorDate.getMonth() + stepMonths * count;
    const targetYear = Math.floor(totalMonths / 12);
    const targetMonth = ((totalMonths % 12) + 12) % 12;
    const maxDay = new Date(targetYear, targetMonth + 1, 0).getDate();
    const targetDay = Math.min(anchorDate.getDate(), maxDay);
    return new Date(targetYear, targetMonth, targetDay);
  }

  function getEffectiveNextDate(sub, today) {
    if (!sub || sub.cycle === 'lifetime' || sub.status === 'paused') return null;
    if (sub.cycle === 'oneoff') {
      const sd = parseLocalDate(sub.startDate);
      if (!sd) return null;
      const amortMonths = Math.max(1, parseInt(sub.amortizeMonths, 10) || 1);
      return addCycles(sd, 'monthly', amortMonths);
    }
    const anchor = parseLocalDate(sub.nextBillDate);
    if (!anchor) return null;
    if (anchor >= today) return anchor;
    if (!sub.autoRenew) return anchor;

    let k = 1;
    let candidate = anchor;
    while (candidate < today && k < 2000) {
      candidate = addCycles(anchor, sub.cycle, k);
      k++;
    }
    return candidate;
  }

  // ---------- 状态管理 ----------
  function getDefaultRatesMap() {
    const map = {};
    Object.keys(CONFIG.DEFAULT_RATES).forEach(k => {
      map[k] = CONFIG.DEFAULT_RATES[k].rate;
    });
    return map;
  }

  function loadInitialState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
          monthlyBills: Array.isArray(parsed.monthlyBills) ? parsed.monthlyBills : [],
          dedupOverrides: parsed.dedupOverrides && typeof parsed.dedupOverrides === 'object' ? parsed.dedupOverrides : {},
          settings: {
            monthlyBudget: parsed.settings?.monthlyBudget ?? 3500,
            alertDays: Number(parsed.settings?.alertDays) || 14,
            rates: { ...getDefaultRatesMap(), ...(parsed.settings?.rates || {}) },
            autoSyncRates: parsed.settings?.autoSyncRates !== false,
            ratesLastSynced: parsed.settings?.ratesLastSynced || 0,
            ratesUpdatedUtc: parsed.settings?.ratesUpdatedUtc || '',
            theme: parsed.settings?.theme || 'light'
          },
          isDemo: Boolean(parsed.isDemo),
          demoBannerDismissed: Boolean(parsed.demoBannerDismissed),
          aiReviews: parsed.aiReviews || {}
        };
      }
    } catch (err) {
      console.warn('读取本地缓存失败，使用默认初始化：', err);
    }

    return {
      subscriptions: CONFIG.createDemoSubscriptions(),
      monthlyBills: [],
      dedupOverrides: {},
      settings: {
        monthlyBudget: 3500,
        alertDays: 14,
        rates: getDefaultRatesMap(),
        autoSyncRates: true,
        ratesLastSynced: 0,
        ratesUpdatedUtc: '',
        theme: window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      },
      isDemo: true,
      demoBannerDismissed: false,
      aiReviews: {}
    };
  }

  let state = loadInitialState();

  const todayInit = getToday();
  const uiState = {
    activePage: 'subs',
    statusFilter: 'all',
    categoryFilter: 'all',
    cycleFilter: 'all',
    searchQuery: '',
    sortBy: 'nextBill',
    viewMode: 'grid',
    rightTab: 'forecast',
    selectedForecastIdx: 0,
    calYear: todayInit.getFullYear(),
    calMonth: todayInit.getMonth(),
    selectedCalDate: null,
    nextBillManuallyEdited: false,
    isRecognizing: false,
    reviewMode: 'insight',
    isGeneratingReview: false,
    dailyYear: todayInit.getFullYear(),
    dailyMonth: todayInit.getMonth(),
    dailyBasis: 'cashflow',
    isRecognizingDaily: false,
    mbTotalManuallyEdited: false,
    pendingDetectedMerchants: [],
    localServerConnected: false,
    localDataPath: ''
  };

  let localSyncTimer = null;

  function pushStateToLocalServer() {
    if (!uiState.localServerConnected) return;
    if (localSyncTimer) clearTimeout(localSyncTimer);
    localSyncTimer = setTimeout(() => {
      fetch('/api/local-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state })
      }).catch(() => {});
    }, 120);
  }

  async function syncWithLocalServer() {
    if (window.location.protocol === 'file:' || /\.netlify\.app$/i.test(window.location.hostname)) {
      return false;
    }
    try {
      const res = await fetch('/api/local-store', { cache: 'no-store' });
      if (!res.ok) return false;
      const payload = await res.json();
      if (!payload || !payload.ok) return false;

      uiState.localServerConnected = true;
      uiState.localDataPath = payload.dataFile || '~/.subledger/data.json';

      if (payload.exists && payload.state && Array.isArray(payload.state.subscriptions)) {
        state = {
          ...state,
          ...payload.state,
          settings: {
            ...state.settings,
            ...(payload.state.settings || {}),
            rates: { ...getDefaultRatesMap(), ...(payload.state.settings?.rates || {}) }
          }
        };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {}
        applyTheme(state.settings.theme || 'light');
        renderAll();
      } else {
        pushStateToLocalServer();
        renderBanners();
      }
      return true;
    } catch {
      return false;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      showToast('本地存储空间不足，保存失败');
    }
    pushStateToLocalServer();
  }

  // ---------- 费用与指标计算（支持首期特惠价 + 续费恢复原价双轨制 + 单次消费/氪金按月均摊） ----------
  function computeSubMetrics(sub, today) {
    const split = Math.max(1, parseInt(sub.splitCount, 10) || 1);
    const totalOrig = Math.max(0, Number(sub.price) || 0);
    const regRaw = sub.regularPrice !== null && sub.regularPrice !== undefined && sub.regularPrice !== ''
      ? Number(sub.regularPrice)
      : 0;
    const hasRegularPrice = regRaw > 0 && Math.abs(regRaw - totalOrig) > 0.001;
    const renewTotalOrig = hasRegularPrice ? regRaw : totalOrig;

    const personalOrig = totalOrig / split;
    const renewPersonalOrig = renewTotalOrig / split;
    const rate = Number(state.settings.rates[sub.currency]) || (CONFIG.DEFAULT_RATES[sub.currency]?.rate) || 1;

    const firstCnyPerCycle = personalOrig * rate;
    // 若开启自动续费，长期均摊与下期续费按恢复原价核算；若已关闭自动续费，按当期实付价核算
    const ongoingCnyPerCycle = (sub.autoRenew !== false ? renewPersonalOrig : personalOrig) * rate;
    const renewCnyPerCycle = renewPersonalOrig * rate;

    const amortMonths = Math.max(1, parseInt(sub.amortizeMonths, 10) || 1);
    let oneoffActive = false;
    let oneoffEndDate = null;

    let baseMonthlyCny = 0;
    let baseYearlyCny = 0;

    if (sub.cycle === 'oneoff') {
      const sd = parseLocalDate(sub.startDate) || today;
      oneoffEndDate = addCycles(sd, 'monthly', amortMonths);
      oneoffActive = Boolean(oneoffEndDate && today >= sd && today < oneoffEndDate);
      if (oneoffActive && sub.status !== 'paused') {
        baseMonthlyCny = firstCnyPerCycle / amortMonths;
        baseYearlyCny = baseMonthlyCny * Math.min(12, amortMonths);
      }
    } else if (sub.cycle !== 'lifetime') {
      switch (sub.cycle) {
        case 'weekly':
          baseYearlyCny = ongoingCnyPerCycle * 52;
          baseMonthlyCny = baseYearlyCny / 12;
          break;
        case 'monthly':
          baseMonthlyCny = ongoingCnyPerCycle;
          baseYearlyCny = ongoingCnyPerCycle * 12;
          break;
        case 'quarterly':
          baseMonthlyCny = ongoingCnyPerCycle / 3;
          baseYearlyCny = ongoingCnyPerCycle * 4;
          break;
        case 'semiannual':
          baseMonthlyCny = ongoingCnyPerCycle / 6;
          baseYearlyCny = ongoingCnyPerCycle * 2;
          break;
        case 'yearly':
          baseMonthlyCny = ongoingCnyPerCycle / 12;
          baseYearlyCny = ongoingCnyPerCycle;
          break;
        case 'biennial':
          baseMonthlyCny = ongoingCnyPerCycle / 24;
          baseYearlyCny = ongoingCnyPerCycle / 2;
          break;
        default:
          baseMonthlyCny = ongoingCnyPerCycle;
          baseYearlyCny = ongoingCnyPerCycle * 12;
      }
    }

    // 核算卡片内挂载的单次氪金 / 加购均摊（期满自动归零）
    let activeAddonMonthlyCny = 0;
    let activeAddonYearlyCny = 0;
    let activeAddonCount = 0;
    let addonTotalHistoryCny = 0;
    const addonsList = Array.isArray(sub.addons) ? sub.addons : [];

    addonsList.forEach(ad => {
      const aPrice = Math.max(0, Number(ad.price) || 0);
      if (aPrice <= 0) return;
      const aRate = Number(state.settings.rates[ad.currency]) || (CONFIG.DEFAULT_RATES[ad.currency]?.rate) || 1;
      const aCny = aPrice * aRate;
      const aMonths = Math.max(1, parseInt(ad.amortizeMonths, 10) || 1);
      const asd = parseLocalDate(ad.date) || today;
      const aed = addCycles(asd, 'monthly', aMonths);

      if (asd <= today) {
        addonTotalHistoryCny += aCny;
      }
      if (sub.status !== 'paused' && aed && today >= asd && today < aed) {
        const mPart = aCny / aMonths;
        activeAddonMonthlyCny += mPart;
        activeAddonYearlyCny += mPart * Math.min(12, aMonths);
        activeAddonCount++;
      }
    });

    const monthlyCny = baseMonthlyCny + activeAddonMonthlyCny;
    const yearlyCny = baseYearlyCny + activeAddonYearlyCny;

    const effNext = getEffectiveNextDate(sub, today);
    const daysLeft = effNext ? daysBetween(today, effNext) : null;

    let cumulativeCny = null;
    let paidPeriods = 0;
    if (sub.startDate) {
      const startD = parseLocalDate(sub.startDate);
      if (startD && startD <= today) {
        if (sub.cycle === 'lifetime' || sub.cycle === 'oneoff') {
          paidPeriods = 1;
          cumulativeCny = firstCnyPerCycle;
        } else if (sub.status !== 'trial') {
          let k = 0;
          let d = startD;
          let sum = 0;
          while (d && d <= today && k < 1000) {
            sum += k === 0 ? firstCnyPerCycle : renewCnyPerCycle;
            paidPeriods++;
            k++;
            d = addCycles(startD, sub.cycle, k);
          }
          cumulativeCny = sum;
        }
      }
    }

    if (addonTotalHistoryCny > 0) {
      cumulativeCny = (cumulativeCny || 0) + addonTotalHistoryCny;
    }

    return {
      split,
      totalOrig,
      renewTotalOrig,
      hasRegularPrice,
      personalOrig,
      rate,
      cnyPerCycle: ongoingCnyPerCycle,
      firstCnyPerCycle,
      renewCnyPerCycle,
      baseMonthlyCny,
      baseYearlyCny,
      monthlyCny,
      yearlyCny,
      amortMonths,
      oneoffActive,
      oneoffEndDate,
      activeAddonMonthlyCny,
      activeAddonYearlyCny,
      activeAddonCount,
      addonTotalHistoryCny,
      effNext,
      daysLeft,
      cumulativeCny,
      paidPeriods
    };
  }

  function getMonthEvents(year, monthIndex, today) {
    const monthStart = new Date(year, monthIndex, 1);
    const monthEnd = new Date(year, monthIndex + 1, 0);
    const events = [];

    state.subscriptions.forEach(sub => {
      if (sub.status === 'paused') return;
      const metrics = computeSubMetrics(sub, today);

      // 1. 挂载的单次氪金 / 加购现金流事件
      if (Array.isArray(sub.addons) && sub.addons.length > 0) {
        sub.addons.forEach(ad => {
          const asd = parseLocalDate(ad.date);
          const aPrice = Math.max(0, Number(ad.price) || 0);
          if (!asd || aPrice <= 0) return;
          if (asd >= monthStart && asd <= monthEnd) {
            const aRate = Number(state.settings.rates[ad.currency]) || (CONFIG.DEFAULT_RATES[ad.currency]?.rate) || 1;
            events.push({
              eventKey: `${sub.id}::addon::${ad.id}`,
              date: asd,
              dateStr: formatDateISO(asd),
              sub,
              addon: ad,
              label: `${sub.name} · ${ad.title || '单次加购'}`,
              payment: ad.payment || sub.payment || '',
              currency: ad.currency || sub.currency || 'CNY',
              amountCny: aPrice * aRate,
              type: 'addon',
              isPaid: asd <= today
            });
          }
        });
      }

      // 2. 买断制一次性支付事件
      if (sub.cycle === 'lifetime') {
        const sd = parseLocalDate(sub.startDate);
        if (sd && sd >= monthStart && sd <= monthEnd) {
          const ds = formatDateISO(sd);
          events.push({
            eventKey: `${sub.id}::lifetime::${ds}`,
            date: sd,
            dateStr: ds,
            sub,
            label: `${sub.name} (买断)`,
            payment: sub.payment || '',
            currency: sub.currency || 'CNY',
            amountCny: metrics.firstCnyPerCycle,
            type: 'lifetime',
            isPaid: sd <= today
          });
        }
        return;
      }

      // 3. 独立单次消费（均摊型）当月实付事件
      if (sub.cycle === 'oneoff') {
        const sd = parseLocalDate(sub.startDate);
        if (sd && sd >= monthStart && sd <= monthEnd) {
          const ds = formatDateISO(sd);
          events.push({
            eventKey: `${sub.id}::oneoff::${ds}`,
            date: sd,
            dateStr: ds,
            sub,
            label: `${sub.name} (单次消费)`,
            payment: sub.payment || '',
            currency: sub.currency || 'CNY',
            amountCny: metrics.firstCnyPerCycle,
            type: 'oneoff',
            isPaid: sd <= today
          });
        }
        return;
      }

      const effNext = metrics.effNext;
      if (!effNext) return;
      const startD = parseLocalDate(sub.startDate);

      // 4. 向前追溯真实已发生的历史周期扣款（严格限制 d <= today）
      if (sub.status === 'active') {
        let k = -1;
        while (k > -600) {
          const d = addCycles(effNext, sub.cycle, k);
          if (!d || d < monthStart) break;
          const allowedByStart = startD ? d >= startD : (k === -1 && d <= today);
          if (d <= monthEnd && d <= today && allowedByStart) {
            const isFirstBill = startD ? daysBetween(startD, d) === 0 : k === -1;
            const ds = formatDateISO(d);
            events.push({
              eventKey: `${sub.id}::${ds}`,
              date: d,
              dateStr: ds,
              sub,
              label: sub.name,
              payment: sub.payment || '',
              currency: sub.currency || 'CNY',
              amountCny: isFirstBill ? metrics.firstCnyPerCycle : metrics.renewCnyPerCycle,
              type: 'charge',
              isPaid: true
            });
          }
          k--;
        }
      }

      // 5. 向后推算未来续费或到期事件
      let k = 0;
      while (k < 600) {
        const d = addCycles(effNext, sub.cycle, k);
        if (!d || d > monthEnd) break;
        if (d >= monthStart && (!startD || d >= startD)) {
          const ds = formatDateISO(d);
          if (sub.autoRenew) {
            events.push({
              eventKey: `${sub.id}::${ds}`,
              date: d,
              dateStr: ds,
              sub,
              label: sub.name,
              payment: sub.payment || '',
              currency: sub.currency || 'CNY',
              amountCny: metrics.renewCnyPerCycle,
              type: sub.status === 'trial' ? 'trial_charge' : 'charge',
              isPaid: d < today
            });
          } else if (k === 0) {
            events.push({
              eventKey: `${sub.id}::expire::${ds}`,
              date: d,
              dateStr: ds,
              sub,
              label: sub.name,
              payment: sub.payment || '',
              currency: sub.currency || 'CNY',
              amountCny: 0,
              type: 'expire_only',
              isPaid: false
            });
          }
        }
        k++;
      }
    });

    events.sort((a, b) => a.date - b.date);
    return events;
  }

  // ---------- Toast 提示 ----------
  function showToast(msg) {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.2s ease';
      setTimeout(() => el.remove(), 220);
    }, 2600);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    state.settings.theme = theme;
  }

  // ---------- AI 截图压缩与云端多模态识别 ----------
  function compressImageForAI(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('解析图片格式失败'));
        img.onload = () => {
          const maxEdge = 1280;
          let w = img.width;
          let h = img.height;
          if (w > maxEdge || h > maxEdge) {
            if (w >= h) {
              h = Math.round((h * maxEdge) / w);
              w = maxEdge;
            } else {
              w = Math.round((w * maxEdge) / h);
              h = maxEdge;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);

          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          const base64 = dataUrl.split(',')[1];
          resolve({ imageBase64: base64, mimeType: 'image/jpeg' });
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  function setAiVisionState(mode, title, desc) {
    const box = document.getElementById('aiVisionDropzone');
    const titleEl = document.getElementById('aiVisionTitle');
    const statusEl = document.getElementById('aiVisionStatus');
    box.classList.remove('is-loading', 'is-success');
    if (mode === 'loading') box.classList.add('is-loading');
    if (mode === 'success') box.classList.add('is-success');
    titleEl.textContent = title;
    statusEl.innerHTML = desc;
  }

  async function recognizeScreenshotFile(file) {
    if (!file || uiState.isRecognizing) return;
    if (!file.type.startsWith('image/')) {
      showToast('请上传图片格式的截图文件');
      return;
    }

    // 若弹窗尚未打开，自动打开新增弹窗
    const modal = document.getElementById('subModal');
    if (modal.classList.contains('hidden')) {
      openSubModal();
    }

    uiState.isRecognizing = true;
    setAiVisionState('loading', '正在识别截图信息…', '正在通过 AI 提取软件名称、套餐价格、币种与到期时间，请稍候 2~3 秒');

    try {
      const { imageBase64, mimeType } = await compressImageForAI(file);
      const resp = await fetch('/api/parse-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          mimeType,
          today: formatDateISO(getToday())
        })
      });

      const result = await resp.json().catch(() => ({}));
      if (!resp.ok || !result.ok || !result.data) {
        throw new Error(result.error || `请求失败 (${resp.status})`);
      }

      const d = result.data;
      const isEditing = Boolean(document.getElementById('subId').value);

      if (d.name && (!isEditing || !document.getElementById('subName').value)) {
        document.getElementById('subName').value = d.name;
      } else if (d.name && isEditing) {
        // 编辑模式下如名称为空才覆盖，保留用户原自定义名
      }
      if (!isEditing && d.name) {
        document.getElementById('subName').value = d.name;
      }

      if (d.category && CONFIG.CATEGORIES.some(c => c.id === d.category)) {
        document.getElementById('subCategory').value = d.category;
      }
      if (d.currency && CONFIG.DEFAULT_RATES[d.currency]) {
        document.getElementById('subCurrency').value = d.currency;
      }
      if (d.cycle && CONFIG.CYCLES.some(c => c.id === d.cycle)) {
        document.getElementById('subCycle').value = d.cycle;
      }
      if (d.price !== null && d.price !== undefined && Number(d.price) >= 0) {
        if (Number(d.price) > 0 || !isEditing) {
          document.getElementById('subPrice').value = d.price;
        }
      }
      if (d.regularPrice !== null && d.regularPrice !== undefined && Number(d.regularPrice) > 0) {
        document.getElementById('subRegularPrice').value = d.regularPrice;
      }
      if (d.status && ['active', 'trial', 'paused'].includes(d.status)) {
        document.getElementById('subStatus').value = d.status;
      }
      if (typeof d.autoRenew === 'boolean') {
        document.getElementById('subAutoRenew').checked = d.autoRenew;
      }
      if (d.nextBillDate && /^\d{4}-\d{2}-\d{2}$/.test(d.nextBillDate)) {
        document.getElementById('subNextBill').value = d.nextBillDate;
        uiState.nextBillManuallyEdited = true;
      }
      if (d.startDate && /^\d{4}-\d{2}-\d{2}$/.test(d.startDate)) {
        document.getElementById('subStartDate').value = d.startDate;
      }
      if (d.payment) {
        document.getElementById('subPayment').value = d.payment;
      }
      if (d.account) {
        document.getElementById('subAccount').value = d.account;
      }
      if (d.note) {
        document.getElementById('subNote').value = d.note;
      }

      // 自动重置品牌图标为智能匹配，立即浮现对应软件真实图标
      if (!isEditing) {
        document.getElementById('subBrandKey').value = 'auto';
      }

      syncSubFormDynamicUI();
      setAiVisionState(
        'success',
        `识别完成：${d.name || '已提取信息'}`,
        '已自动填入表单并匹配软件图标，请核对无误后点击下方「保存订阅」'
      );
      showToast('截图识别成功，已自动填充表单');
    } catch (err) {
      const isLocalFile = window.location.protocol === 'file:';
      const hint = isLocalFile
        ? 'file:// 静态模式不支持 AI 接口，请在终端运行 subledger 启动本地服务并配置 GEMINI_API_KEY'
        : escapeHtml(err.message || '请换一张清晰的截图重试');
      setAiVisionState('idle', 'AI 截图识别未完成', hint);
      showToast('截图识别失败，请检查提示');
    } finally {
      uiState.isRecognizing = false;
    }
  }

  // ---------- 实时汇率自动同步引擎 (服务端边缘缓存 + 客户端 6 小时定期更新) ----------
  async function syncLiveExchangeRates(manualTrigger = false) {
    let computedRates = null;
    let updatedUtc = '';

    // 1. 优先请求本站 Netlify 边缘缓存函数 /api/rates
    if (window.location.protocol !== 'file:') {
      try {
        const res = await fetch('/api/rates');
        if (res.ok) {
          const payload = await res.json();
          if (payload.ok && payload.rates) {
            computedRates = payload.rates;
            updatedUtc = payload.updatedAtUtc || '';
          }
        }
      } catch {
        // Fallback to direct public API below
      }
    }

    // 2. 兜底直连公开央行中间价接口（兼容本地桌面离线快捷方式打开）
    if (!computedRates) {
      try {
        const res = await fetch('https://open.er-api.com/v6/latest/CNY');
        if (res.ok) {
          const data = await res.json();
          if (data.rates) {
            computedRates = { CNY: 1 };
            Object.keys(CONFIG.DEFAULT_RATES).forEach(code => {
              if (code === 'CNY') return;
              const perCny = Number(data.rates[code]);
              if (perCny > 0) {
                computedRates[code] = Number((1 / perCny).toFixed(4));
              }
            });
            updatedUtc = data.time_last_update_utc || '';
          }
        }
      } catch (err) {
        if (manualTrigger) {
          showToast('实时汇率拉取失败，请检查网络连接');
        }
        return false;
      }
    }

    if (!computedRates) return false;

    state.settings.rates = { ...state.settings.rates, ...computedRates };
    state.settings.ratesLastSynced = Date.now();
    if (updatedUtc) state.settings.ratesUpdatedUtc = updatedUtc;
    saveState();

    // 若设置弹窗当前正处于打开状态，实时刷新输入框中的数字
    Object.keys(computedRates).forEach(code => {
      if (code === 'CNY') return;
      const inp = document.getElementById(`rate_${code}`);
      if (inp) inp.value = computedRates[code];
    });
    updateLiveRateStatusLabel();
    renderAll();

    if (manualTrigger) {
      showToast(`已同步最新实时汇率 (1 USD = ¥${computedRates.USD})`);
    }
    return true;
  }

  function updateLiveRateStatusLabel() {
    const statusEl = document.getElementById('liveRateStatusText');
    if (!statusEl) return;
    if (state.settings.ratesLastSynced) {
      const dt = new Date(state.settings.ratesLastSynced);
      const hm = `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
      statusEl.textContent = `上次同步于 ${hm} · 数据源每日跟随国际外汇中间价更新`;
    } else {
      statusEl.textContent = '连接全球外汇中间价接口自动更新，如手动修改汇率可关闭此开关';
    }
  }

  async function searchAppStoreIcon() {
    const name = document.getElementById('subName').value.trim();
    if (!name) {
      showToast('请先输入软件或游戏名称');
      document.getElementById('subName').focus();
      return;
    }
    const btn = document.getElementById('btnSearchAppIcon');
    const origTxt = btn.textContent;
    btn.disabled = true;
    btn.textContent = '搜索中…';
    try {
      const res = await fetch(`/api/app-icon?q=${encodeURIComponent(name)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.dataUri) {
        throw new Error(data.error || '未找到对应图标');
      }
      document.getElementById('subCustomLogo').value = data.dataUri;
      syncSubFormDynamicUI();
      showToast(`已匹配「${data.trackName || name}」官方图标`);
    } catch (err) {
      showToast('未能在线抓取到该软件图标，可上传本地图片');
    } finally {
      btn.disabled = false;
      btn.textContent = origTxt;
    }
  }

  // ---------- 渲染：顶部提示条与页脚 ----------
  function renderBanners() {
    const banner = document.getElementById('demoBanner');
    if (state.isDemo && !state.demoBannerDismissed && state.subscriptions.length > 0) {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }

    const storageHintEl = document.getElementById('footerStorageHint');
    if (storageHintEl) {
      storageHintEl.textContent = uiState.localServerConnected
        ? `SubLedger 本地模式 · 已与 CLI 实时双向同步 (${uiState.localDataPath})`
        : 'SubLedger · 数据私密存储在本地浏览器 (localStorage)，支持 subledger CLI 本地服务与 JSON / CSV 备份';
    }

    const r = state.settings.rates;
    const dot = document.getElementById('footerRateDot');
    const isAuto = state.settings.autoSyncRates !== false;
    if (dot) dot.classList.toggle('is-manual', !isAuto);

    let syncPrefix = isAuto ? '实时汇率' : '自定义汇率';
    if (isAuto && state.settings.ratesLastSynced) {
      const d = new Date(state.settings.ratesLastSynced);
      syncPrefix = `实时汇率 (${d.getMonth() + 1}/${d.getDate()} 已同步)`;
    }
    document.getElementById('footerRateHint').textContent =
      `${syncPrefix}：1 USD = ¥${r.USD} · 1 PHP = ¥${r.PHP} · 1 HKD = ¥${r.HKD}`;
  }

  // ---------- 渲染：4 张核心 KPI 卡片 ----------
  function renderKPIs(today) {
    let monthlyTotal = 0;
    let yearlyTotal = 0;
    let activeRecurringCount = 0;
    let activeOneoffMonthly = 0;
    let trialCount = 0;
    let trialMonthlyPotential = 0;
    let lifetimeCount = 0;
    let lifetimeTotalCny = 0;

    const alertDays = state.settings.alertDays || 14;
    const upcomingBills = [];

    state.subscriptions.forEach(sub => {
      const m = computeSubMetrics(sub, today);

      if (sub.cycle === 'lifetime' && sub.status !== 'paused') {
        lifetimeCount++;
        lifetimeTotalCny += m.firstCnyPerCycle;
        if (m.activeAddonMonthlyCny > 0) {
          monthlyTotal += m.activeAddonMonthlyCny;
          yearlyTotal += m.activeAddonYearlyCny;
          activeOneoffMonthly += m.activeAddonMonthlyCny;
        }
        return;
      }

      if (sub.status === 'active') {
        monthlyTotal += m.monthlyCny;
        yearlyTotal += m.yearlyCny;
        if (sub.cycle === 'oneoff') {
          activeOneoffMonthly += m.monthlyCny;
        } else {
          activeRecurringCount++;
          activeOneoffMonthly += m.activeAddonMonthlyCny;
        }
      } else if (sub.status === 'trial') {
        trialCount++;
        if (sub.autoRenew) {
          trialMonthlyPotential += m.monthlyCny;
        }
      }

      if ((sub.status === 'active' || sub.status === 'trial') && sub.cycle !== 'oneoff' && m.effNext && m.daysLeft !== null) {
        if (m.daysLeft >= 0 && m.daysLeft <= alertDays && sub.autoRenew) {
          upcomingBills.push({ sub, metrics: m });
        }
      }
    });

    upcomingBills.sort((a, b) => a.metrics.daysLeft - b.metrics.daysLeft);

    const dailyAvg = yearlyTotal / 365;
    const oneoffNote = activeOneoffMonthly > 0 ? ` · 含近期单次均摊 ¥${formatMoney(activeOneoffMonthly, 0)}` : '';
    document.getElementById('kpiMonthly').textContent = formatMoney(monthlyTotal);
    document.getElementById('kpiDailySub').textContent =
      `日均成本 ¥${formatMoney(dailyAvg)} · 生效周期订阅 ${activeRecurringCount} 项${oneoffNote}`;

    const budget = Number(state.settings.monthlyBudget) || 0;
    const budgetWrap = document.getElementById('budgetBarWrap');
    if (budget > 0) {
      budgetWrap.classList.remove('hidden');
      const pct = (monthlyTotal / budget) * 100;
      const clampedPct = Math.min(100, Math.max(0, pct));
      const fill = document.getElementById('budgetFill');
      fill.style.width = `${clampedPct.toFixed(1)}%`;
      fill.classList.remove('is-warn', 'is-over');

      let statusLabel = `月度预算 ¥${formatMoney(budget, 0)}`;
      if (pct >= 100) {
        fill.classList.add('is-over');
        statusLabel = `超出预算 ¥${formatMoney(monthlyTotal - budget)}`;
      } else if (pct >= 80) {
        fill.classList.add('is-warn');
        statusLabel = `接近预算上限 (¥${formatMoney(budget, 0)})`;
      }
      document.getElementById('budgetStatusText').textContent = statusLabel;
      document.getElementById('budgetPercentText').textContent = `${pct.toFixed(0)}%`;
    } else {
      budgetWrap.classList.add('hidden');
    }

    document.getElementById('kpiYearly').textContent = formatMoney(yearlyTotal);
    document.getElementById('kpiActiveCountPill').textContent = `${activeRecurringCount} 项周期订阅`;
    if (trialCount > 0) {
      document.getElementById('kpiTrialSub').textContent =
        `另有 ${trialCount} 项免费试用（若续订 +¥${formatMoney(trialMonthlyPotential)}/月）`;
    } else {
      document.getElementById('kpiTrialSub').textContent = '当前无免费试用期项目';
    }
    document.getElementById('kpiLifetimeSub').textContent =
      `买断制软件资产：${lifetimeCount} 项 (累计 ¥${formatMoney(lifetimeTotalCny, 0)})`;

    const curMonth = today.getMonth();
    const curYear = today.getFullYear();
    const monthEvents = getMonthEvents(curYear, curMonth, today).filter(e => e.amountCny > 0);
    let paidSum = 0;
    let remSum = 0;
    let remCount = 0;

    monthEvents.forEach(e => {
      if (e.isPaid) {
        paidSum += e.amountCny;
      } else {
        remSum += e.amountCny;
        remCount++;
      }
    });

    document.getElementById('kpiThisMonthLabel').textContent = `${curMonth + 1}月实际账单`;
    document.getElementById('kpiThisMonthCount').textContent = `共 ${monthEvents.length} 笔`;
    document.getElementById('kpiThisMonthTotal').textContent = formatMoney(paidSum + remSum);
    document.getElementById('kpiThisMonthPaid').textContent = `¥${formatMoney(paidSum)}`;
    document.getElementById('kpiThisMonthRemaining').textContent = `¥${formatMoney(remSum)}`;
    document.getElementById('kpiThisMonthHint').textContent =
      remCount > 0 ? `本月剩余时间还有 ${remCount} 笔待扣款` : '本月已无剩余待扣款账单';

    const upcomingSum = upcomingBills.reduce((acc, item) => acc + item.metrics.renewCnyPerCycle, 0);
    document.getElementById('kpiUpcomingLabel').textContent = `近 ${alertDays} 天续费预警`;
    document.getElementById('kpiUpcomingAmount').textContent = formatMoney(upcomingSum);

    const badgeEl = document.getElementById('kpiUpcomingBadge');
    const nearestEl = document.getElementById('kpiNearestItem');
    badgeEl.className = 'kpi-pill';
    nearestEl.className = 'upcoming-highlight';

    const pendingDateCount = state.subscriptions.filter(
      s => s.status === 'active' && s.cycle !== 'lifetime' && s.cycle !== 'oneoff' && !s.nextBillDate
    ).length;

    if (upcomingBills.length === 0) {
      badgeEl.textContent = '账单平稳';
      nearestEl.textContent = `未来 ${alertDays} 天内无自动扣款项`;
      document.getElementById('kpiTrialAlertText').textContent =
        pendingDateCount > 0
          ? `另有 ${pendingDateCount} 项会员待补充到期时间（可点编辑截图识别）`
          : '所有自动续费项目均在安全周期内';
    } else {
      const first = upcomingBills[0];
      const dLeft = first.metrics.daysLeft;
      const dayLabel = dLeft === 0 ? '今天扣款' : dLeft === 1 ? '明天扣款' : `${dLeft} 天后扣款`;
      const prefix = first.sub.status === 'trial' ? '[试用转正] ' : '';

      badgeEl.textContent = `${upcomingBills.length} 笔待扣`;
      if (dLeft <= 3 || first.sub.status === 'trial') {
        badgeEl.classList.add('kpi-pill-danger');
        nearestEl.classList.add('is-urgent');
      } else {
        badgeEl.classList.add('kpi-pill-warn');
        nearestEl.classList.add('is-soon');
      }

      nearestEl.textContent = `${prefix}${first.sub.name} · ${dayLabel} (¥${formatMoney(first.metrics.renewCnyPerCycle)})`;
      document.getElementById('kpiTrialAlertText').textContent =
        `最近一笔将于 ${formatShortDate(first.metrics.effNext)} 自动扣款`;
    }
  }

  // ---------- 渲染：分类占比环形图 ----------
  function renderCategoryChart(today) {
    const totalsByCat = {};
    let grandTotal = 0;

    state.subscriptions.forEach(sub => {
      if (sub.status !== 'active') return;
      const m = computeSubMetrics(sub, today);
      if (m.monthlyCny <= 0) return;
      totalsByCat[sub.category] = (totalsByCat[sub.category] || 0) + m.monthlyCny;
      grandTotal += m.monthlyCny;
    });

    const svg = document.getElementById('donutSvg');
    const legend = document.getElementById('categoryLegend');
    const center = document.getElementById('donutCenter');
    const resetBtn = document.getElementById('btnResetCatFilter');

    if (uiState.categoryFilter !== 'all') {
      resetBtn.classList.remove('hidden');
    } else {
      resetBtn.classList.add('hidden');
    }

    const items = CONFIG.CATEGORIES
      .map(cat => ({
        ...cat,
        amount: totalsByCat[cat.id] || 0,
        pct: grandTotal > 0 ? ((totalsByCat[cat.id] || 0) / grandTotal) * 100 : 0
      }))
      .filter(item => item.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    const setCenterDefault = () => {
      if (uiState.categoryFilter !== 'all') {
        const activeCat = items.find(i => i.id === uiState.categoryFilter) || getCategoryInfo(uiState.categoryFilter);
        const amt = totalsByCat[uiState.categoryFilter] || 0;
        const pct = grandTotal > 0 ? ((amt / grandTotal) * 100).toFixed(1) : '0.0';
        center.innerHTML = `
          <span class="donut-center-label">${escapeHtml(activeCat.name)}</span>
          <strong class="donut-center-value">¥${formatMoney(amt, 0)}</strong>
          <span class="donut-center-sub">占 ${pct}%</span>
        `;
      } else {
        center.innerHTML = `
          <span class="donut-center-label">月均总计</span>
          <strong class="donut-center-value">¥${formatMoney(grandTotal, 0)}</strong>
          <span class="donut-center-sub">${items.length} 个分类</span>
        `;
      }
    };

    const r = 70;
    const circumference = 2 * Math.PI * r;

    if (items.length === 0) {
      svg.innerHTML = `
        <circle cx="100" cy="100" r="${r}" fill="none" stroke="var(--border-subtle)" stroke-width="22"></circle>
      `;
      legend.innerHTML = `<div class="muted" style="font-size:13px;padding:12px 0;">暂无生效中的周期订阅数据</div>`;
      setCenterDefault();
      return;
    }

    let offset = 0;
    const gap = items.length > 1 ? 2.2 : 0;
    let svgContent = `<circle cx="100" cy="100" r="${r}" fill="none" stroke="var(--bg-hover)" stroke-width="22"></circle>`;

    items.forEach(item => {
      const sliceLen = Math.max(0, (item.pct / 100) * circumference - gap);
      const isMuted = uiState.categoryFilter !== 'all' && uiState.categoryFilter !== item.id;
      svgContent += `
        <circle
          class="donut-slice"
          data-cat-id="${escapeHtml(item.id)}"
          cx="100" cy="100" r="${r}"
          fill="none"
          stroke="${escapeHtml(item.color)}"
          stroke-width="22"
          stroke-dasharray="${sliceLen} ${circumference}"
          stroke-dashoffset="${-offset}"
          style="opacity: ${isMuted ? 0.3 : 1}"
        ></circle>
      `;
      offset += (item.pct / 100) * circumference;
    });

    svg.innerHTML = svgContent;

    legend.innerHTML = items.map(item => {
      const selectedClass = uiState.categoryFilter === item.id ? 'is-selected' : '';
      return `
        <div class="cat-legend-item ${selectedClass}" data-cat-id="${escapeHtml(item.id)}">
          <div class="cat-legend-left">
            <span class="cat-dot" style="background:${escapeHtml(item.color)}"></span>
            <span class="cat-name">${escapeHtml(item.name)}</span>
          </div>
          <div class="cat-legend-right">
            <span class="cat-amount">¥${formatMoney(item.amount)}</span>
            <span class="cat-pct">${item.pct.toFixed(1)}%</span>
          </div>
        </div>
      `;
    }).join('');

    setCenterDefault();

    const hoverHandler = (catId) => {
      const target = items.find(i => i.id === catId);
      if (!target) return;
      center.innerHTML = `
        <span class="donut-center-label">${escapeHtml(target.name)}</span>
        <strong class="donut-center-value">¥${formatMoney(target.amount)}</strong>
        <span class="donut-center-sub">占比 ${target.pct.toFixed(1)}%</span>
      `;
    };

    const toggleCatFilter = (catId) => {
      uiState.categoryFilter = uiState.categoryFilter === catId ? 'all' : catId;
      document.getElementById('categoryFilter').value = uiState.categoryFilter;
      renderAll();
    };

    svg.querySelectorAll('.donut-slice').forEach(el => {
      const cid = el.getAttribute('data-cat-id');
      el.addEventListener('mouseenter', () => hoverHandler(cid));
      el.addEventListener('mouseleave', setCenterDefault);
      el.addEventListener('click', () => toggleCatFilter(cid));
    });

    legend.querySelectorAll('.cat-legend-item').forEach(el => {
      const cid = el.getAttribute('data-cat-id');
      el.addEventListener('mouseenter', () => hoverHandler(cid));
      el.addEventListener('mouseleave', setCenterDefault);
      el.addEventListener('click', () => toggleCatFilter(cid));
    });
  }

  // ---------- 渲染：未来 12 个月现金流预测柱状图 ----------
  function renderForecastChart(today) {
    const monthsData = [];
    let maxTotal = 0;
    let sum12 = 0;

    for (let i = 0; i < 12; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const chargeEvents = getMonthEvents(y, m, today).filter(e => e.amountCny > 0);
      const total = chargeEvents.reduce((s, e) => s + e.amountCny, 0);
      if (total > maxTotal) maxTotal = total;
      sum12 += total;

      const label = m === 0 && i > 0 ? `${String(y).slice(2)}年1月` : `${m + 1}月`;
      monthsData.push({
        idx: i,
        year: y,
        month: m,
        label,
        fullLabel: `${y}年${m + 1}月`,
        total,
        events: chargeEvents
      });
    }

    const avg = sum12 / 12;
    const container = document.getElementById('forecastBars');
    const detailBar = document.getElementById('forecastDetail');

    const barsHtml = monthsData.map(item => {
      const heightPct = maxTotal > 0 ? Math.max(4, (item.total / maxTotal) * 100) : 4;
      let barClass = 'forecast-bar';
      if (item.idx === 0) barClass += ' is-current';
      else if (item.total > avg * 1.25 && item.total > 0) barClass += ' is-peak';

      const selectedClass = uiState.selectedForecastIdx === item.idx ? 'is-selected' : '';
      return `
        <div class="forecast-col ${selectedClass}" data-month-idx="${item.idx}">
          <span class="forecast-val">¥${formatMoney(item.total, 0)}</span>
          <div class="forecast-bar-track">
            <div class="${barClass}" style="height: ${heightPct.toFixed(1)}%"></div>
          </div>
          <span class="forecast-month">${escapeHtml(item.label)}</span>
        </div>
      `;
    }).join('');

    container.innerHTML = `<div class="forecast-bars-grid">${barsHtml}</div>`;

    const updateForecastDetail = (idx) => {
      const target = monthsData[idx] || monthsData[0];
      if (!target) return;

      if (target.events.length === 0) {
        detailBar.innerHTML = `
          <strong>${escapeHtml(target.fullLabel)} · 预计 ¥0.00</strong>
          <span class="muted">当月无自动扣款账单</span>
        `;
        return;
      }

      const chips = target.events.slice(0, 6).map(ev => {
        const chipTitle = ev.addon ? `${ev.sub.name}(+${ev.addon.title})` : ev.sub.name;
        return `
          <span class="forecast-chip">
            ${renderMiniLogoHtml(ev.sub)}
            <span>${escapeHtml(chipTitle)}</span>
            <strong>¥${formatMoney(ev.amountCny, 0)}</strong>
          </span>
        `;
      }).join('');

      const moreCount = target.events.length > 6 ? `<span class="muted">+${target.events.length - 6} 笔</span>` : '';

      detailBar.innerHTML = `
        <div>
          <strong>${escapeHtml(target.fullLabel)}</strong> · 共 ${target.events.length} 笔 · 合计 <strong>¥${formatMoney(target.total)}</strong>
        </div>
        <div class="forecast-bill-chips">${chips}${moreCount}</div>
      `;
    };

    updateForecastDetail(uiState.selectedForecastIdx);

    container.querySelectorAll('.forecast-col').forEach(col => {
      const idx = Number(col.getAttribute('data-month-idx'));
      col.addEventListener('mouseenter', () => updateForecastDetail(idx));
      col.addEventListener('click', () => {
        uiState.selectedForecastIdx = idx;
        container.querySelectorAll('.forecast-col').forEach(c => c.classList.remove('is-selected'));
        col.classList.add('is-selected');
        updateForecastDetail(idx);
      });
    });

    const gridEl = container.querySelector('.forecast-bars-grid');
    if (gridEl) {
      gridEl.addEventListener('mouseleave', () => {
        updateForecastDetail(uiState.selectedForecastIdx);
      });
    }
  }

  // ---------- 渲染：月度扣款日历 ----------
  function renderCalendar(today) {
    const year = uiState.calYear;
    const month = uiState.calMonth;

    document.getElementById('calMonthTitle').textContent = `${year}年 ${month + 1}月`;

    const events = getMonthEvents(year, month, today);
    const totalCharge = events.reduce((s, e) => s + e.amountCny, 0);
    const chargeCount = events.filter(e => e.amountCny > 0).length;
    document.getElementById('calMonthSummary').textContent =
      `当月预计 ¥${formatMoney(totalCharge)} (${chargeCount} 笔扣款)`;

    const eventsByDate = {};
    events.forEach(ev => {
      if (!eventsByDate[ev.dateStr]) eventsByDate[ev.dateStr] = [];
      eventsByDate[ev.dateStr].push(ev);
    });

    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startOffset = (firstDay.getDay() + 6) % 7;
    const prevMonthDays = new Date(year, month, 0).getDate();

    const todayStr = formatDateISO(today);

    if (!uiState.selectedCalDate || !uiState.selectedCalDate.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)) {
      const eventDates = Object.keys(eventsByDate).sort();
      if (eventDates.length > 0) {
        const upcomingInMonth = eventDates.find(d => d >= todayStr);
        uiState.selectedCalDate = upcomingInMonth || eventDates[0];
      } else if (year === today.getFullYear() && month === today.getMonth()) {
        uiState.selectedCalDate = todayStr;
      } else {
        uiState.selectedCalDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      }
    }

    const cells = [];

    for (let i = startOffset - 1; i >= 0; i--) {
      cells.push(`<div class="cal-cell other-month"><div class="cal-cell-head"><span class="cal-day-num">${prevMonthDays - i}</span></div></div>`);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayEvents = eventsByDate[dateStr] || [];
      const daySum = dayEvents.reduce((s, e) => s + e.amountCny, 0);

      let cls = 'cal-cell';
      if (dayEvents.length > 0) cls += ' has-bills';
      if (dateStr === todayStr) cls += ' is-today';
      if (dateStr === uiState.selectedCalDate) cls += ' is-selected';

      const pillsHtml = dayEvents.slice(0, 3).map(ev => {
        if (ev.type === 'expire_only') {
          return `<span class="cal-pill is-expire-only">${escapeHtml(ev.sub.name.slice(0, 3))}到期</span>`;
        }
        const logoSrc = LOGOS ? LOGOS.resolveLogoSrc(ev.sub) : null;
        if (logoSrc) {
          return `<img class="cal-logo-chip" src="${escapeHtml(logoSrc)}" alt="${escapeHtml(ev.sub.name)}" title="${escapeHtml(ev.label || ev.sub.name)}" />`;
        }
        return `<span class="cal-pill" style="background:${escapeHtml(ev.sub.color || '#2563EB')}">${escapeHtml(ev.sub.icon || deriveShortIcon(ev.sub.name))}</span>`;
      }).join('');

      const moreHtml = dayEvents.length > 3 ? `<span class="cal-pill is-expire-only">+${dayEvents.length - 3}</span>` : '';

      cells.push(`
        <div class="${cls}" data-cal-date="${dateStr}">
          <div class="cal-cell-head">
            <span class="cal-day-num">${day}</span>
            ${daySum > 0 ? `<span class="cal-day-total">¥${formatMoney(daySum, 0)}</span>` : ''}
          </div>
          <div class="cal-pills">${pillsHtml}${moreHtml}</div>
        </div>
      `);
    }

    const remainder = cells.length % 7;
    if (remainder !== 0) {
      const fill = 7 - remainder;
      for (let d = 1; d <= fill; d++) {
        cells.push(`<div class="cal-cell other-month"><div class="cal-cell-head"><span class="cal-day-num">${d}</span></div></div>`);
      }
    }

    const gridEl = document.getElementById('calendarGrid');
    gridEl.innerHTML = cells.join('');

    const renderDayDetail = (dateStr) => {
      const detailEl = document.getElementById('calendarDayDetail');
      const list = eventsByDate[dateStr] || [];
      const parsed = parseLocalDate(dateStr);
      const label = formatShortDate(parsed, today.getFullYear());

      if (list.length === 0) {
        detailEl.innerHTML = `<span><strong>${label}</strong> · 当日无扣款或到期记录</span>`;
        return;
      }

      const chips = list.map(ev => {
        if (ev.type === 'expire_only') {
          return `
            <span class="forecast-chip" data-edit-id="${escapeHtml(ev.sub.id)}" style="cursor:pointer" title="点击编辑">
              ${renderMiniLogoHtml(ev.sub)}
              <span>${escapeHtml(ev.sub.name)}</span>
              <span class="muted">到期停用 (¥0)</span>
            </span>
          `;
        }
        const statusNote = ev.type === 'addon'
          ? '单次加购'
          : ev.type === 'oneoff'
            ? '单次消费'
            : ev.type === 'trial_charge'
              ? '试用扣款'
              : ev.isPaid
                ? '已扣款'
                : '待扣款';
        const titleTxt = ev.addon ? `${ev.sub.name} · ${ev.addon.title}` : ev.sub.name;
        const clickAttr = ev.addon
          ? `data-addon-id="${escapeHtml(ev.sub.id)}" title="点击管理加购记录"`
          : `data-edit-id="${escapeHtml(ev.sub.id)}" title="点击编辑"`;
        return `
          <span class="forecast-chip" ${clickAttr} style="cursor:pointer">
            ${renderMiniLogoHtml(ev.sub)}
            <span>${escapeHtml(titleTxt)}</span>
            <strong>¥${formatMoney(ev.amountCny)}</strong>
            <span class="muted">(${statusNote})</span>
          </span>
        `;
      }).join('');

      detailEl.innerHTML = `
        <strong>${label} 明细：</strong>
        <div class="forecast-bill-chips">${chips}</div>
      `;

      detailEl.querySelectorAll('[data-edit-id]').forEach(chip => {
        chip.addEventListener('click', () => openSubModal(chip.getAttribute('data-edit-id')));
      });
      detailEl.querySelectorAll('[data-addon-id]').forEach(chip => {
        chip.addEventListener('click', () => openAddonModal(chip.getAttribute('data-addon-id')));
      });
    };

    renderDayDetail(uiState.selectedCalDate);

    gridEl.querySelectorAll('.cal-cell[data-cal-date]').forEach(cell => {
      cell.addEventListener('click', () => {
        uiState.selectedCalDate = cell.getAttribute('data-cal-date');
        gridEl.querySelectorAll('.cal-cell').forEach(c => c.classList.remove('is-selected'));
        cell.classList.add('is-selected');
        renderDayDetail(uiState.selectedCalDate);
      });
    });
  }

  // ---------- 渲染：订阅列表与筛选计数 ----------
  function renderSubscriptionList(today) {
    const allItems = state.subscriptions.map(sub => ({ sub, metrics: computeSubMetrics(sub, today) }));
    const isItemInactive = (sub, metrics) =>
      sub.status === 'paused' || (sub.cycle === 'oneoff' && !metrics.oneoffActive && metrics.activeAddonCount === 0);

    const counts = { all: 0, active: 0, trial: 0, lifetime: 0, paused: 0 };
    allItems.forEach(({ sub, metrics }) => {
      counts.all++;
      if (isItemInactive(sub, metrics)) counts.paused++;
      else if (sub.cycle === 'lifetime') counts.lifetime++;
      else if (sub.status === 'trial') counts.trial++;
      else counts.active++;
    });

    document.getElementById('countAll').textContent = counts.all;
    document.getElementById('countActive').textContent = counts.active;
    document.getElementById('countTrial').textContent = counts.trial;
    document.getElementById('countLifetime').textContent = counts.lifetime;
    document.getElementById('countPaused').textContent = counts.paused;

    const q = uiState.searchQuery.trim().toLowerCase();
    const filtered = allItems
      .filter(({ sub, metrics }) => {
        const inactive = isItemInactive(sub, metrics);
        if (uiState.statusFilter === 'active' && (inactive || sub.status !== 'active' || sub.cycle === 'lifetime')) return false;
        if (uiState.statusFilter === 'trial' && (inactive || sub.status !== 'trial')) return false;
        if (uiState.statusFilter === 'lifetime' && (inactive || sub.cycle !== 'lifetime')) return false;
        if (uiState.statusFilter === 'paused' && !inactive) return false;

        if (uiState.categoryFilter !== 'all' && sub.category !== uiState.categoryFilter) return false;
        if (uiState.cycleFilter !== 'all' && sub.cycle !== uiState.cycleFilter) return false;

        if (q) {
          const addonHay = Array.isArray(sub.addons) ? sub.addons.map(a => a.title || '').join(' ') : '';
          const hay = `${sub.name} ${sub.account || ''} ${sub.payment || ''} ${sub.note || ''} ${addonHay}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

    filtered.sort((a, b) => {
      switch (uiState.sortBy) {
        case 'monthlyDesc':
          return b.metrics.monthlyCny - a.metrics.monthlyCny;
        case 'monthlyAsc':
          return a.metrics.monthlyCny - b.metrics.monthlyCny;
        case 'yearlyDesc':
          return b.metrics.yearlyCny - a.metrics.yearlyCny;
        case 'nameAsc':
          return a.sub.name.localeCompare(b.sub.name, 'zh-CN');
        case 'nextBill':
        default: {
          const aInact = isItemInactive(a.sub, a.metrics);
          const bInact = isItemInactive(b.sub, b.metrics);
          const aRank = aInact ? 3 : a.sub.cycle === 'lifetime' ? 2 : a.metrics.daysLeft === null ? 1 : 0;
          const bRank = bInact ? 3 : b.sub.cycle === 'lifetime' ? 2 : b.metrics.daysLeft === null ? 1 : 0;
          if (aRank !== bRank) return aRank - bRank;
          if (a.metrics.daysLeft !== null && b.metrics.daysLeft !== null) {
            return a.metrics.daysLeft - b.metrics.daysLeft;
          }
          return b.metrics.monthlyCny - a.metrics.monthlyCny;
        }
      }
    });

    const container = document.getElementById('subscriptionListContainer');

    if (filtered.length === 0) {
      const hasAny = state.subscriptions.length > 0;
      container.innerHTML = `
        <div class="empty-state">
          <h3>${hasAny ? '没有匹配当前筛选条件的订阅' : '还没有任何软件订阅记录'}</h3>
          <p>${hasAny ? '尝试清空搜索词或切换上方状态/分类筛选条件' : '点击右上角「截图智能识别」或「新增订阅」，开始管理您的数字订阅开销'}</p>
          <button type="button" class="btn btn-primary" id="btnEmptyAction">
            ${hasAny ? '重置筛选条件' : '+ 添加第一笔订阅'}
          </button>
        </div>
      `;
      document.getElementById('btnEmptyAction').addEventListener('click', () => {
        if (hasAny) {
          uiState.statusFilter = 'all';
          uiState.categoryFilter = 'all';
          uiState.cycleFilter = 'all';
          uiState.searchQuery = '';
          document.getElementById('searchInput').value = '';
          document.getElementById('categoryFilter').value = 'all';
          document.getElementById('cycleFilter').value = 'all';
          document.querySelectorAll('.status-tab').forEach(b => b.classList.toggle('active', b.dataset.status === 'all'));
          renderAll();
        } else {
          openSubModal();
        }
      });
      return;
    }

    if (uiState.viewMode === 'table') {
      renderTableView(container, filtered, today);
    } else {
      renderGridView(container, filtered, today);
    }
    bindImageFallbacks(container);
  }

  function buildRenewalStatusInfo(sub, metrics, today) {
    if (sub.status === 'paused') {
      return { badgeClass: 'renewal-muted', fullLabel: '已暂停 / 已退订', dateStr: '' };
    }
    if (sub.cycle === 'lifetime') {
      const sd = parseLocalDate(sub.startDate);
      return {
        badgeClass: 'renewal-normal',
        fullLabel: sd ? `永久买断 · ${formatDateISO(sd)}` : '永久买断授权',
        dateStr: ''
      };
    }
    if (sub.cycle === 'oneoff') {
      const endLabel = metrics.oneoffEndDate ? formatShortDate(metrics.oneoffEndDate, today.getFullYear()) : '';
      if (metrics.oneoffActive) {
        return {
          badgeClass: 'renewal-soon',
          fullLabel: `单次均摊中 · 剩 ${metrics.daysLeft} 天 (${endLabel}止)`,
          dateStr: endLabel
        };
      }
      return {
        badgeClass: 'renewal-muted',
        fullLabel: `已均摊完毕${endLabel ? ` (${endLabel})` : ''}`,
        dateStr: endLabel
      };
    }
    if (!metrics.effNext || metrics.daysLeft === null) {
      return { badgeClass: 'renewal-soon', fullLabel: '待补充到期日', dateStr: '' };
    }

    const dLeft = metrics.daysLeft;
    const dateLabel = formatShortDate(metrics.effNext, today.getFullYear());

    if (!sub.autoRenew) {
      if (dLeft < 0) {
        return { badgeClass: 'renewal-muted', fullLabel: `${dateLabel} 已到期`, dateStr: dateLabel };
      }
      const dayTxt = dLeft === 0 ? '今天到期停用' : `${dLeft} 天后到期 · 不续费`;
      return { badgeClass: 'renewal-muted', fullLabel: `${dayTxt} (${dateLabel})`, dateStr: dateLabel };
    }

    const prefix = sub.status === 'trial' ? '试用 · ' : '';
    if (dLeft === 0) {
      return { badgeClass: 'renewal-urgent', fullLabel: `${prefix}今天扣款 · ${dateLabel}`, dateStr: dateLabel };
    }
    if (dLeft <= 3 || (sub.status === 'trial' && dLeft <= 7)) {
      return { badgeClass: 'renewal-urgent', fullLabel: `${prefix}${dLeft} 天后扣款 · ${dateLabel}`, dateStr: dateLabel };
    }
    if (dLeft <= (state.settings.alertDays || 14)) {
      return { badgeClass: 'renewal-soon', fullLabel: `${prefix}${dLeft} 天后续费 · ${dateLabel}`, dateStr: dateLabel };
    }
    return { badgeClass: 'renewal-normal', fullLabel: `${dLeft} 天后续费 · ${dateLabel}`, dateStr: dateLabel };
  }

  function renderGridView(container, items, today) {
    const html = items.map(({ sub, metrics }) => {
      const cat = getCategoryInfo(sub.category);
      const cyc = getCycleInfo(sub.cycle);
      const sym = getCurrencySymbol(sub.currency);
      const renewal = buildRenewalStatusInfo(sub, metrics, today);
      const link = safeUrl(sub.url);

      const isUrgent = renewal.badgeClass === 'renewal-urgent';
      const isInactiveOneoff = sub.cycle === 'oneoff' && !metrics.oneoffActive && metrics.activeAddonCount === 0;
      const cardClasses = [
        'sub-card',
        sub.status === 'paused' || isInactiveOneoff ? 'is-paused' : '',
        isUrgent ? 'is-urgent' : ''
      ].filter(Boolean).join(' ');

      const tags = [
        `<span class="tag" style="background:${cat.bg};color:${cat.color}">${escapeHtml(cat.name)}</span>`
      ];
      if (sub.account) {
        tags.push(`<span class="tag tag-region">${escapeHtml(sub.account)}</span>`);
      }
      if (sub.status === 'trial') tags.push(`<span class="tag tag-trial">免费试用</span>`);
      if (sub.cycle === 'oneoff') tags.push(`<span class="tag tag-trial">均摊${metrics.amortMonths}个月</span>`);
      if (metrics.split > 1) tags.push(`<span class="tag tag-split">${metrics.split}人平摊</span>`);
      if (sub.cycle === 'lifetime') tags.push(`<span class="tag tag-lifetime">买断</span>`);
      if (sub.status === 'active' && sub.cycle !== 'lifetime' && sub.cycle !== 'oneoff' && !sub.autoRenew) {
        tags.push(`<span class="tag tag-norenew">到期不续</span>`);
      }

      let primaryHtml = '';
      let secondaryTop = '';
      let secondaryBottom = '';

      if (sub.cycle === 'lifetime') {
        primaryHtml = `<span class="price-sym">¥</span><span class="price-val">${formatMoney(metrics.firstCnyPerCycle)}</span><span class="price-unit">买断</span>`;
        secondaryTop = sub.currency !== 'CNY' ? `${sym}${formatSmartOrig(metrics.totalOrig)}` : '一次性买断';
        secondaryBottom = metrics.activeAddonCount > 0
          ? `当月附加均摊 +¥${formatMoney(metrics.activeAddonMonthlyCny)}`
          : '无后续周期扣款';
      } else if (sub.cycle === 'oneoff') {
        primaryHtml = `<span class="price-sym">¥</span><span class="price-val">${formatMoney(metrics.monthlyCny)}</span><span class="price-unit">/月均摊</span>`;
        secondaryTop = `单次 ${sym}${formatSmartOrig(metrics.totalOrig)} · 均摊 ${metrics.amortMonths} 个月`;
        secondaryBottom = metrics.oneoffActive
          ? '均摊期内折算 · 期满自动归零'
          : `均摊期已结束 · 累计 ¥${formatMoney(metrics.cumulativeCny || metrics.firstCnyPerCycle, 0)}`;
      } else {
        primaryHtml = `<span class="price-sym">¥</span><span class="price-val">${formatMoney(metrics.monthlyCny)}</span><span class="price-unit">/月</span>`;
        if (metrics.hasRegularPrice) {
          secondaryTop = `首期 ${sym}${formatSmartOrig(metrics.totalOrig)} → 原价 ${sym}${formatSmartOrig(metrics.renewTotalOrig)}/${cyc.short}`;
          secondaryBottom = `续费按 ¥${formatMoney(metrics.renewCnyPerCycle, 0)}/${cyc.short} · 年化 ¥${formatMoney(metrics.yearlyCny, 0)}`;
        } else {
          secondaryTop = `${sym}${formatSmartOrig(metrics.totalOrig)} / ${cyc.short}`;
          secondaryBottom = metrics.split > 1
            ? `${metrics.split}人分摊 · 人均 ¥${formatMoney(metrics.cnyPerCycle)}/${cyc.short}`
            : `年化约 ¥${formatMoney(metrics.yearlyCny, 0)}`;
        }
      }

      const addonCountAll = Array.isArray(sub.addons) ? sub.addons.length : 0;
      let cumRight = '';
      if (metrics.cumulativeCny !== null && sub.cycle !== 'lifetime') {
        if (sub.cycle === 'oneoff') {
          cumRight = `累计实付 ¥${formatMoney(metrics.cumulativeCny, 0)}`;
        } else {
          const addonSuffix = addonCountAll > 0 ? `+加购${addonCountAll}笔` : '';
          cumRight = `已付 ${metrics.paidPeriods} 期${addonSuffix} · 累计 ¥${formatMoney(metrics.cumulativeCny, 0)}`;
        }
      }

      const addonBtnLabel = sub.category === 'game' ? '+氪金' : '+加购';
      const addonBannerHtml = metrics.activeAddonCount > 0 ? `
        <div class="addon-active-banner" data-action="addon" data-id="${escapeHtml(sub.id)}" title="点击查看或管理单次氪金/加购均摊明细">
          <span>近期单次氪金/加购 ${metrics.activeAddonCount} 笔均摊中</span>
          <span>+¥${formatMoney(metrics.activeAddonMonthlyCny)}/月 ›</span>
        </div>
      ` : '';

      const footerNotes = [];
      if (sub.payment) footerNotes.push(sub.payment);
      if (sub.note) footerNotes.push(sub.note);
      const footerLine = footerNotes.join(' · ');

      return `
        <article class="${cardClasses}" data-sub-id="${escapeHtml(sub.id)}">
          <div class="sub-card-top">
            <div class="sub-identity">
              ${renderAppLogoHtml(sub)}
              <div class="sub-title-wrap">
                <h3 class="sub-name" title="${escapeHtml(sub.name)}">${escapeHtml(sub.name)}</h3>
                <div class="sub-tags-row">${tags.join('')}</div>
              </div>
            </div>

            <div class="sub-actions">
              ${sub.status !== 'paused' ? `
                <button type="button" class="btn-addon-chip" data-action="addon" data-id="${escapeHtml(sub.id)}" title="记录一笔单次氪金、礼包或额外加购（默认均摊到当月，期满自动归零）">${addonBtnLabel}</button>
              ` : ''}
              ${link ? `
                <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" class="action-icon-btn" title="打开官网/订阅管理页">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
              ` : ''}
              <button type="button" class="action-icon-btn" data-action="edit" data-id="${escapeHtml(sub.id)}" title="编辑 / 截图补全">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button type="button" class="action-icon-btn danger" data-action="delete" data-id="${escapeHtml(sub.id)}" title="删除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>

          <div class="sub-price-box">
            <div class="sub-price-primary">${primaryHtml}</div>
            <div class="sub-price-secondary">
              <span class="orig-cycle-price">${escapeHtml(secondaryTop)}</span>
              <span class="annual-equiv-price">${escapeHtml(secondaryBottom)}</span>
            </div>
          </div>

          <div class="sub-card-footer">
            ${addonBannerHtml}
            <div class="sub-renewal-row">
              <span class="renewal-badge ${renewal.badgeClass}">${escapeHtml(renewal.fullLabel)}</span>
              ${cumRight ? `<span class="sub-cum-text">${escapeHtml(cumRight)}</span>` : ''}
            </div>
            ${footerLine ? `<div class="sub-note-footer" title="${escapeHtml(footerLine)}"><span>${escapeHtml(footerLine)}</span></div>` : ''}
          </div>
        </article>
      `;
    }).join('');

    container.innerHTML = `<div class="sub-grid">${html}</div>`;
    bindListItemActions(container);
  }

  function renderTableView(container, items, today) {
    const rows = items.map(({ sub, metrics }) => {
      const cat = getCategoryInfo(sub.category);
      const cyc = getCycleInfo(sub.cycle);
      const sym = getCurrencySymbol(sub.currency);
      const renewal = buildRenewalStatusInfo(sub, metrics, today);

      const origSpec = sub.cycle === 'oneoff'
        ? `单次 ${sym}${formatSmartOrig(metrics.totalOrig)} (均摊${metrics.amortMonths}月)`
        : metrics.hasRegularPrice
          ? `首期 ${sym}${formatSmartOrig(metrics.totalOrig)} → 原价 ${sym}${formatSmartOrig(metrics.renewTotalOrig)}/${cyc.short}`
          : `${sym}${formatSmartOrig(metrics.totalOrig)} / ${cyc.short}${metrics.split > 1 ? ` (${metrics.split}人摊)` : ''}`;
      const monthlyText = sub.cycle === 'lifetime' && metrics.monthlyCny <= 0 ? '—' : `¥${formatMoney(metrics.monthlyCny)}`;
      const yearlyText = sub.cycle === 'lifetime' ? `¥${formatMoney(metrics.firstCnyPerCycle)} (买断)` : `¥${formatMoney(metrics.yearlyCny)}`;
      const addonBtnLabel = sub.category === 'game' ? '+氪金' : '+加购';

      return `
        <tr class="${sub.status === 'paused' ? 'muted' : ''}">
          <td>
            <div class="table-service-cell">
              ${renderAppLogoHtml(sub, 'is-sm')}
              <div>
                <strong>${escapeHtml(sub.name)}</strong>
                ${sub.status === 'trial' ? `<span class="tag tag-trial" style="margin-left:4px">试用</span>` : ''}
                ${metrics.activeAddonCount > 0 ? `<span class="tag tag-trial" style="margin-left:4px">+${metrics.activeAddonCount}笔加购</span>` : ''}
              </div>
            </div>
          </td>
          <td><span class="tag" style="background:${cat.bg};color:${cat.color}">${escapeHtml(cat.name)}</span></td>
          <td>${escapeHtml(origSpec)}</td>
          <td><strong>${monthlyText}</strong></td>
          <td>${yearlyText}</td>
          <td>${escapeHtml(sub.account || sub.payment || '—')}</td>
          <td><span class="renewal-badge ${renewal.badgeClass}">${escapeHtml(renewal.fullLabel)}</span></td>
          <td>
            ${sub.cycle === 'lifetime' || sub.cycle === 'oneoff' || sub.status === 'paused'
              ? `<span class="muted">${sub.cycle === 'oneoff' ? '单次均摊' : '—'}</span>`
              : `<button type="button" class="btn btn-xs ${sub.autoRenew ? 'btn-secondary' : 'btn-ghost'}" data-action="toggleRenew" data-id="${escapeHtml(sub.id)}">${sub.autoRenew ? '自动续费中' : '到期不续'}</button>`
            }
          </td>
          <td>
            <div class="sub-actions">
              ${sub.status !== 'paused' ? `<button type="button" class="btn-addon-chip" data-action="addon" data-id="${escapeHtml(sub.id)}">${addonBtnLabel}</button>` : ''}
              <button type="button" class="action-icon-btn" data-action="edit" data-id="${escapeHtml(sub.id)}" title="编辑">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button type="button" class="action-icon-btn danger" data-action="delete" data-id="${escapeHtml(sub.id)}" title="删除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <div class="table-wrap">
        <table class="sub-table">
          <thead>
            <tr>
              <th>软件服务</th>
              <th>分类</th>
              <th>原账单规格</th>
              <th>折合月均</th>
              <th>年化 / 买断</th>
              <th>区服 / 扣款渠道</th>
              <th>下次账单状态</th>
              <th>续费策略</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    bindListItemActions(container);
  }

  function bindListItemActions(container) {
    container.querySelectorAll('[data-action="addon"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openAddonModal(btn.getAttribute('data-id'));
      });
    });

    container.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => openSubModal(btn.getAttribute('data-id')));
    });

    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const target = state.subscriptions.find(s => s.id === id);
        if (!target) return;
        if (window.confirm(`确定要删除订阅「${target.name}」吗？`)) {
          state.subscriptions = state.subscriptions.filter(s => s.id !== id);
          saveState();
          renderAll();
          showToast(`已删除「${target.name}」`);
        }
      });
    });

    container.querySelectorAll('[data-action="toggleRenew"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const target = state.subscriptions.find(s => s.id === id);
        if (!target) return;
        target.autoRenew = !target.autoRenew;
        saveState();
        renderAll();
        showToast(`${target.name}：已设为「${target.autoRenew ? '自动续费' : '到期不续'}」`);
      });
    });
  }

  // ---------- 自定义精排下拉组件 ----------
  function syncCustomSelects() {
    document.querySelectorAll('.cselect').forEach(wrap => {
      const selId = wrap.getAttribute('data-for');
      const sel = document.getElementById(selId);
      if (!sel) return;
      const activeOpt = Array.from(sel.options).find(o => o.value === sel.value) || sel.options[0];
      const labelEl = wrap.querySelector('.cselect-label');
      if (labelEl && activeOpt) {
        labelEl.textContent = activeOpt.textContent;
      }
      wrap.querySelectorAll('.cselect-opt').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-val') === sel.value);
      });
    });
  }

  function enhanceCustomSelects() {
    const closeAllMenus = () => {
      document.querySelectorAll('.cselect.is-open').forEach(w => {
        w.classList.remove('is-open');
        const m = w.querySelector('.cselect-menu');
        if (m) m.classList.add('hidden');
      });
    };

    document.querySelectorAll('select.control-select').forEach(sel => {
      sel.classList.add('sr-only-select');
      const wrap = document.createElement('div');
      wrap.className = 'cselect';
      wrap.setAttribute('data-for', sel.id);

      const curOpt = Array.from(sel.options).find(o => o.value === sel.value) || sel.options[0];
      const optsHtml = Array.from(sel.options).map(o => `
        <button type="button" class="cselect-opt ${o.value === sel.value ? 'active' : ''}" data-val="${escapeHtml(o.value)}">
          <span>${escapeHtml(o.textContent)}</span>
        </button>
      `).join('');

      wrap.innerHTML = `
        <button type="button" class="cselect-btn" aria-label="${escapeHtml(sel.getAttribute('aria-label') || '')}">
          <span class="cselect-label">${escapeHtml(curOpt ? curOpt.textContent : '')}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="cselect-menu hidden" role="listbox">${optsHtml}</div>
      `;

      sel.insertAdjacentElement('afterend', wrap);

      const triggerBtn = wrap.querySelector('.cselect-btn');
      const menuEl = wrap.querySelector('.cselect-menu');

      triggerBtn.addEventListener('click', e => {
        e.stopPropagation();
        const wasOpen = wrap.classList.contains('is-open');
        closeAllMenus();
        if (!wasOpen) {
          wrap.classList.add('is-open');
          menuEl.classList.remove('hidden');
        }
      });

      menuEl.querySelectorAll('.cselect-opt').forEach(optBtn => {
        optBtn.addEventListener('click', e => {
          e.stopPropagation();
          sel.value = optBtn.getAttribute('data-val');
          sel.dispatchEvent(new Event('change'));
          syncCustomSelects();
          closeAllMenus();
        });
      });
    });

    document.addEventListener('click', closeAllMenus);
  }

  // ---------- AI 订阅者人格画像与账单点评引擎 ----------
  function renderAiPersona() {
    const section = document.getElementById('aiPersonaSection');
    const bodyEl = document.getElementById('aiReviewBody');
    const timeEl = document.getElementById('aiReviewTimestamp');
    const btnTxt = document.getElementById('btnGenerateReviewText');
    const btnEl = document.getElementById('btnGenerateReview');

    const isRoast = uiState.reviewMode === 'roast';
    section.classList.toggle('is-roast', isRoast);

    document.querySelectorAll('[data-review-mode]').forEach(tab => {
      const active = tab.getAttribute('data-review-mode') === uiState.reviewMode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });

    if (uiState.isGeneratingReview) {
      btnEl.disabled = true;
      btnTxt.textContent = '正在点评…';
      timeEl.classList.add('hidden');
      const count = state.subscriptions.filter(s => s.status !== 'paused').length;
      bodyEl.innerHTML = `
        <div class="persona-loading">
          <div class="persona-spinner"></div>
          <span>AI 正在细品您的 ${count} 项订阅组合、跨区技巧与开销结构，生成${isRoast ? '毒舌锐评' : '专属人格画像'}中…</span>
        </div>
      `;
      return;
    }

    btnEl.disabled = false;
    const saved = state.aiReviews && state.aiReviews[uiState.reviewMode];

    if (!saved || !saved.review) {
      btnTxt.textContent = '生成 AI 点评';
      timeEl.classList.add('hidden');
      const promptDesc = isRoast
        ? '切换到「毒舌锐评」模式：看看 AI 会怎么风趣吐槽您的算力投入与游戏月卡组合'
        : '看看您的账单暴露了什么样的数字生活性格？AI 将结合您的订阅组合生成专属称号、三维度评分与省钱建议';
      bodyEl.innerHTML = `
        <div class="persona-empty-bar">
          <p>${promptDesc}</p>
          <button type="button" class="btn btn-primary btn-xs" id="btnEmptyGenReview" style="height:32px;padding:0 14px;">
            立即生成${isRoast ? '毒舌锐评' : '订阅者画像'}
          </button>
        </div>
      `;
      document.getElementById('btnEmptyGenReview').addEventListener('click', () => {
        generateAiPersona(uiState.reviewMode);
      });
      return;
    }

    btnTxt.textContent = '重新点评';
    if (saved.generatedAt) {
      const dt = new Date(saved.generatedAt);
      if (!isNaN(dt.getTime())) {
        const hm = `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
        timeEl.textContent = `更新于 ${hm}`;
        timeEl.classList.remove('hidden');
      }
    }

    const rev = saved.review;
    const tagsHtml = (Array.isArray(rev.tags) ? rev.tags.slice(0, 5) : []).map(
      t => `<span class="persona-tag">${escapeHtml(t)}</span>`
    ).join('');

    const dims = Array.isArray(rev.dimensions) ? rev.dimensions.slice(0, 3) : [];
    const scoresHtml = dims.map(d => {
      const sc = Math.min(100, Math.max(0, Math.round(Number(d.score) || 0)));
      return `
        <div class="score-row">
          <div class="score-row-head">
            <strong>${escapeHtml(d.name || '指数')}</strong>
            <span class="score-num">${sc} / 100</span>
          </div>
          <div class="score-track">
            <div class="score-fill" style="width:${sc}%"></div>
          </div>
          <div class="score-comment">${escapeHtml(d.comment || '')}</div>
        </div>
      `;
    }).join('');

    bodyEl.innerHTML = `
      <div class="persona-grid">
        <div class="persona-identity-card">
          <div>
            <div class="persona-emoji-badge">${escapeHtml(rev.badgeEmoji || '✨')}</div>
            <h3 class="persona-main-title">${escapeHtml(rev.personaTitle || '数字生活订阅家')}</h3>
            <div class="persona-sub-tag">${escapeHtml(rev.mbtiStyleTag || '')}</div>
          </div>
          <div class="persona-tags">${tagsHtml}</div>
        </div>

        <div class="persona-story-col">
          <p class="persona-summary-text">${escapeHtml(rev.summary || '')}</p>
          <div class="persona-callouts">
            <div class="persona-callout is-highlight">
              <strong>账单亮点操作</strong>
              <span>${escapeHtml(rev.highlight || '懂得在效率工具与娱乐体验之间寻找平衡。')}</span>
            </div>
            <div class="persona-callout is-tip">
              <strong>回血省钱建议</strong>
              <span>${escapeHtml(rev.savingTip || '定期检查低频使用的自动续费服务，按需切换年付或跨区方案。')}</span>
            </div>
          </div>
        </div>

        <div class="persona-scores-col">
          ${scoresHtml}
        </div>
      </div>
    `;
  }

  async function generateAiPersona(mode = uiState.reviewMode) {
    if (uiState.isGeneratingReview) return;
    const activeSubs = state.subscriptions.filter(s => s.status !== 'paused');
    if (activeSubs.length === 0) {
      showToast('请先添加至少 1 项订阅后再生成 AI 点评');
      return;
    }

    uiState.reviewMode = mode;
    uiState.isGeneratingReview = true;
    renderAiPersona();

    const today = getToday();
    let monthlyTotal = 0;
    let yearlyTotal = 0;

    const sanitizedItems = activeSubs.map(sub => {
      const m = computeSubMetrics(sub, today);
      if (sub.status === 'active' && m.monthlyCny > 0) {
        monthlyTotal += m.monthlyCny;
        yearlyTotal += m.yearlyCny;
      }
      const cyc = getCycleInfo(sub.cycle);
      const sym = getCurrencySymbol(sub.currency);
      let spec = sub.cycle === 'oneoff'
        ? `单次${sym}${formatSmartOrig(m.totalOrig)} (均摊${m.amortMonths}个月)`
        : m.hasRegularPrice
          ? `首期${sym}${formatSmartOrig(m.totalOrig)} -> 原价${sym}${formatSmartOrig(m.renewTotalOrig)}/${cyc.short}`
          : `${sym}${formatSmartOrig(m.totalOrig)}/${cyc.short}`;

      if (Array.isArray(sub.addons) && sub.addons.length > 0) {
        const addonTxt = sub.addons.slice(0, 3).map(a => `${a.title || '加购'}(${getCurrencySymbol(a.currency)}${a.price})`).join('、');
        spec += ` [附加单次氪金/加购: ${addonTxt}]`;
      }

      // 隐私脱敏：隐去邮箱字符，仅保留区服/类型描述
      const cleanRegion = String(sub.account || '').replace(/\S+@\S+\.\S+/g, '个人账号').trim();

      return {
        name: sub.name,
        category: getCategoryInfo(sub.category).name,
        spec,
        monthlyCny: m.monthlyCny.toFixed(2),
        region: cleanRegion,
        note: sub.note || ''
      };
    });

    try {
      const res = await fetch('/api/ai-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          summaryStats: {
            activeCount: activeSubs.length,
            monthlyTotal: monthlyTotal.toFixed(2),
            yearlyTotal: yearlyTotal.toFixed(2)
          },
          items: sanitizedItems
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.review) {
        throw new Error(data.error || `请求失败 (${res.status})`);
      }

      if (!state.aiReviews) state.aiReviews = {};
      state.aiReviews[mode] = {
        review: data.review,
        generatedAt: data.generatedAt || new Date().toISOString()
      };
      saveState();
      showToast(mode === 'roast' ? 'AI 毒舌锐评已出炉！' : 'AI 订阅者画像已生成！');
    } catch (err) {
      const msg = window.location.protocol === 'file:'
        ? '离线本地文件模式不支持云端 AI 点评，请在线上站点中使用'
        : (err.message || 'AI 点评生成失败，请稍后重试');
      showToast(msg);
    } finally {
      uiState.isGeneratingReview = false;
      renderAiPersona();
    }
  }

  // ---------- 主界面切换 & 全局汇总重绘 ----------
  function switchAppPage(page) {
    uiState.activePage = page === 'daily' ? 'daily' : 'subs';
    document.querySelectorAll('#appPageTabs [data-app-page]').forEach(btn => {
      const active = btn.getAttribute('data-app-page') === uiState.activePage;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    document.getElementById('subsPageView').classList.toggle('hidden', uiState.activePage !== 'subs');
    document.getElementById('dailyPageView').classList.toggle('hidden', uiState.activePage !== 'daily');
    renderAll();
  }

  function renderAll() {
    const today = getToday();
    syncCustomSelects();
    renderBanners();
    renderKPIs(today);
    renderAiPersona();
    renderCategoryChart(today);
    if (uiState.rightTab === 'calendar') {
      renderCalendar(today);
    } else {
      renderForecastChart(today);
    }
    renderSubscriptionList(today);
    renderDailyPage(today);
  }

  function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
  }

  function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
  }

  // ---------- 功能 1B：挂载单次氪金 / 加购均摊弹窗 ----------
  function renderAddonHistoryList(sub) {
    const wrap = document.getElementById('addonHistorySection');
    const listEl = document.getElementById('addonHistoryList');
    const addons = Array.isArray(sub.addons) ? sub.addons : [];
    if (addons.length === 0) {
      wrap.classList.add('hidden');
      listEl.innerHTML = '';
      return;
    }

    wrap.classList.remove('hidden');
    const today = getToday();
    const sorted = [...addons].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    listEl.innerHTML = sorted.map(ad => {
      const asd = parseLocalDate(ad.date) || today;
      const aMonths = Math.max(1, parseInt(ad.amortizeMonths, 10) || 1);
      const aed = addCycles(asd, 'monthly', aMonths);
      const isActive = Boolean(aed && today >= asd && today < aed);
      const sym = getCurrencySymbol(ad.currency || 'CNY');
      return `
        <div class="addon-history-item">
          <div>
            <strong>${escapeHtml(ad.title || '单次加购')}</strong>
            <span class="muted"> · ${escapeHtml(ad.date || '')} · 摊${aMonths}个月 (${isActive ? '均摊中' : '已期满'})</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <strong>${sym}${formatSmartOrig(ad.price)}</strong>
            <button type="button" class="action-icon-btn danger" data-del-addon="${escapeHtml(ad.id)}" title="删除这笔记录">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('[data-del-addon]').forEach(btn => {
      btn.addEventListener('click', () => {
        const aid = btn.getAttribute('data-del-addon');
        sub.addons = (sub.addons || []).filter(a => a.id !== aid);
        saveState();
        renderAddonHistoryList(sub);
        renderAll();
        showToast('已移除该笔单次消费记录');
      });
    });
  }

  function openAddonModal(subId) {
    const sub = state.subscriptions.find(s => s.id === subId);
    if (!sub) return;
    document.getElementById('addonModalTitle').textContent =
      `${sub.category === 'game' ? '记录单次氪金' : '记录单次加购'} · ${sub.name}`;
    document.getElementById('addonSubId').value = sub.id;
    document.getElementById('addonTitle').value = '';
    document.getElementById('addonPrice').value = '';
    document.getElementById('addonDate').value = formatDateISO(getToday());
    document.getElementById('addonCurrency').value = sub.currency || 'CNY';
    document.getElementById('addonAmortize').value = '1';
    document.getElementById('addonPayment').value = sub.payment || '';
    renderAddonHistoryList(sub);
    openModal('addonModal');
    setTimeout(() => document.getElementById('addonTitle').focus(), 60);
  }

  // ---------- 功能 2：独立「月度日常总账」界面与智能防重引擎 ----------
  function getDailyMonthKey() {
    return `${uiState.dailyYear}-${String(uiState.dailyMonth + 1).padStart(2, '0')}`;
  }

  function getBillSourceMeta(src) {
    const map = {
      alipay: { label: '支付宝月账单', cls: 'mb-source-alipay' },
      wechat: { label: '微信支付月账单', cls: 'mb-source-wechat' },
      card: { label: '银行卡 / 信用卡', cls: 'mb-source-card' },
      other: { label: '其他日常账单', cls: 'mb-source-other' }
    };
    return map[src] || map.other;
  }

  function shouldAutoDedupEvent(ev, billsInMonth) {
    if (!billsInMonth || billsInMonth.length === 0) return false;
    const hasAlipay = billsInMonth.some(b => b.source === 'alipay');
    const hasWechat = billsInMonth.some(b => b.source === 'wechat');
    const hasCard = billsInMonth.some(b => b.source === 'card');
    const pay = String(ev.payment || '').toLowerCase();

    if (pay.includes('支付宝') || pay.includes('花呗')) return hasAlipay;
    if (pay.includes('微信')) return hasWechat;
    if (/visa|master|stripe|银联|unionpay|信用卡|银行卡|paypal/i.test(pay)) return hasCard;

    const allMerchants = billsInMonth.flatMap(b => Array.isArray(b.detectedMerchants) ? b.detectedMerchants : []);
    if (allMerchants.some(m => m && ev.sub.name.toLowerCase().includes(String(m).toLowerCase()))) {
      return true;
    }
    if (ev.currency === 'CNY' && (hasAlipay || hasWechat) && !/apple|google/i.test(pay)) {
      return true;
    }
    return false;
  }

  function setDailyVisionState(mode, title, desc) {
    const box = document.getElementById('dailyVisionDropzone');
    const titleEl = document.getElementById('dailyVisionTitle');
    const statusEl = document.getElementById('dailyVisionStatus');
    if (!box) return;
    box.classList.remove('is-loading', 'is-success');
    if (mode === 'loading') box.classList.add('is-loading');
    if (mode === 'success') box.classList.add('is-success');
    titleEl.textContent = title;
    statusEl.innerHTML = desc;
  }

  function renderDailyPage(today) {
    const y = uiState.dailyYear;
    const m = uiState.dailyMonth;
    const monthKey = getDailyMonthKey();
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    document.getElementById('dailyMonthLabel').textContent = `${y}年 ${m + 1}月`;
    document.querySelectorAll('#dailyBasisTabs [data-daily-basis]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-daily-basis') === uiState.dailyBasis);
    });

    // 1. 获取当月订阅与单次氪金事件（现金流口径 vs 均摊口径）
    const monthChargeEvents = getMonthEvents(y, m, today).filter(e => e.amountCny > 0);
    const cashflowSubTotal = monthChargeEvents.reduce((s, e) => s + e.amountCny, 0);
    const addonEventSum = monthChargeEvents.filter(e => e.type === 'addon' || e.type === 'oneoff').reduce((s, e) => s + e.amountCny, 0);

    const refDate = (y === today.getFullYear() && m === today.getMonth()) ? today : new Date(y, m, 15);
    let amortizedSubTotal = 0;
    const subCatAmounts = {};

    if (uiState.dailyBasis === 'amortized') {
      state.subscriptions.forEach(sub => {
        if (sub.status !== 'active') return;
        const met = computeSubMetrics(sub, refDate);
        if (met.monthlyCny > 0) {
          amortizedSubTotal += met.monthlyCny;
          subCatAmounts[sub.category] = (subCatAmounts[sub.category] || 0) + met.monthlyCny;
        }
      });
    } else {
      monthChargeEvents.forEach(ev => {
        subCatAmounts[ev.sub.category] = (subCatAmounts[ev.sub.category] || 0) + ev.amountCny;
      });
    }

    const subBucket = uiState.dailyBasis === 'cashflow' ? cashflowSubTotal : amortizedSubTotal;

    // 2. 获取当月导入的微信/支付宝/银行卡月结单与防重核销状态
    const billsInMonth = (state.monthlyBills || []).filter(b => b.month === monthKey);
    const grossLiving = billsInMonth.reduce((s, b) => s + (Number(b.totalAmount) || 0), 0);

    const dedupItems = monthChargeEvents.map(ev => {
      const ovKey = `${monthKey}::${ev.eventKey}`;
      const explicit = state.dedupOverrides && typeof state.dedupOverrides[ovKey] === 'boolean'
        ? state.dedupOverrides[ovKey]
        : null;
      const checked = explicit !== null ? explicit : shouldAutoDedupEvent(ev, billsInMonth);
      return { ev, ovKey, checked };
    });

    const checkedCount = dedupItems.filter(i => i.checked).length;
    const rawCheckedSum = dedupItems.filter(i => i.checked).reduce((s, i) => s + i.ev.amountCny, 0);
    const effectiveDedup = billsInMonth.length > 0 ? Math.min(grossLiving, rawCheckedSum) : 0;
    const netLiving = Math.max(0, grossLiving - effectiveDedup);
    const grandNetTotal = subBucket + netLiving;

    // 3. 更新顶部 4 张月度总账 KPI
    document.getElementById('dkpiNetTotal').textContent = formatMoney(grandNetTotal);
    document.getElementById('dkpiDailyAvg').textContent =
      `全月 ${daysInMonth} 天 · 全口径日均 ¥${formatMoney(grandNetTotal / daysInMonth)} / 天`;

    const subSharePct = grandNetTotal > 0 ? ((subBucket / grandNetTotal) * 100).toFixed(1) : '0.0';
    const livingSharePct = grandNetTotal > 0 ? ((netLiving / grandNetTotal) * 100).toFixed(1) : '0.0';

    document.getElementById('dkpiSubBasisLabel').textContent =
      uiState.dailyBasis === 'cashflow' ? '订阅与氪金仓 (当月实付)' : '订阅与氪金仓 (月均摊销)';
    document.getElementById('dkpiSubSharePill').textContent = `占比 ${subSharePct}%`;
    document.getElementById('dkpiSubTotal').textContent = formatMoney(subBucket);
    document.getElementById('dkpiSubSubtext').textContent =
      uiState.dailyBasis === 'cashflow'
        ? `当月共发生 ${monthChargeEvents.length} 笔订阅/氪金支付`
        : `按生效订阅月均成本平滑折算`;
    document.getElementById('dkpiAddonHint').textContent =
      addonEventSum > 0 ? `其中含单次氪金/加购 ¥${formatMoney(addonEventSum)}` : '可在订阅卡片点「+氪金」记单次礼包';

    document.getElementById('dkpiLivingSharePill').textContent = `占比 ${livingSharePct}%`;
    document.getElementById('dkpiLivingNet').textContent = formatMoney(netLiving);
    document.getElementById('dkpiLivingGrossSub').textContent =
      billsInMonth.length > 0
        ? `月结单原始总额 ¥${formatMoney(grossLiving)} (${billsInMonth.length} 份账单)`
        : '尚未导入当月微信/支付宝月结单';

    document.getElementById('dkpiDedupCountPill').textContent = `${checkedCount} 笔核销`;
    document.getElementById('dkpiDedupAmount').textContent = formatMoney(effectiveDedup);

    // 4. 渲染全月真实消费构成全景条
    const panoramaEl = document.getElementById('dailyPanoramaContainer');
    const slices = [];

    // 订阅侧聚合为：AI与软件工具 vs 游戏月卡与氪金
    let aiAndSoftAmt = 0;
    let gameAmt = 0;
    Object.keys(subCatAmounts).forEach(cid => {
      if (cid === 'game') gameAmt += subCatAmounts[cid];
      else aiAndSoftAmt += subCatAmounts[cid];
    });
    if (aiAndSoftAmt > 0) slices.push({ name: 'AI 与软件会员订阅', amount: aiAndSoftAmt, color: '#2563EB' });
    if (gameAmt > 0) slices.push({ name: '游戏大小月卡与氪金', amount: gameAmt, color: '#7C3AED' });

    // 日常侧聚合各分类并按比例扣减防重额，确保净额严格等于 netLiving
    if (netLiving > 0) {
      const rawDailyCats = {};
      let catSum = 0;
      billsInMonth.forEach(b => {
        (Array.isArray(b.categories) ? b.categories : []).forEach(c => {
          const v = Math.max(0, Number(c.amount) || 0);
          if (v > 0) {
            rawDailyCats[c.type || 'other'] = (rawDailyCats[c.type || 'other'] || 0) + v;
            catSum += v;
          }
        });
      });
      if (grossLiving > catSum + 0.01) {
        rawDailyCats.other = (rawDailyCats.other || 0) + (grossLiving - catSum);
      }

      let remDedup = effectiveDedup;
      ['entertainment', 'other'].forEach(prefKey => {
        if (remDedup > 0 && rawDailyCats[prefKey] > 0) {
          const cut = Math.min(rawDailyCats[prefKey], remDedup);
          rawDailyCats[prefKey] -= cut;
          remDedup -= cut;
        }
      });

      const remSum = Object.values(rawDailyCats).reduce((s, v) => s + v, 0);
      const scale = remSum > 0 && remDedup > 0 ? Math.max(0, (remSum - remDedup) / remSum) : 1;

      CONFIG.DAILY_CATEGORIES.forEach(dc => {
        const val = (rawDailyCats[dc.id] || 0) * scale;
        if (val > 0.05) {
          slices.push({ name: dc.name, amount: val, color: dc.color });
        }
      });
    }

    slices.sort((a, b) => b.amount - a.amount);

    if (slices.length === 0 || grandNetTotal <= 0) {
      panoramaEl.innerHTML = `<div class="muted" style="font-size:13px;padding:12px 0;">当月暂无支出数据，可在右侧导入微信/支付宝月账单截图</div>`;
    } else {
      const barSegs = slices.map(s => {
        const pct = (s.amount / grandNetTotal) * 100;
        return `<div class="panorama-seg" style="width:${Math.max(1.2, pct).toFixed(1)}%;background:${escapeHtml(s.color)}" title="${escapeHtml(s.name)}: ¥${formatMoney(s.amount)} (${pct.toFixed(1)}%)"></div>`;
      }).join('');

      const legendItems = slices.map(s => {
        const pct = ((s.amount / grandNetTotal) * 100).toFixed(1);
        return `
          <div class="panorama-item">
            <div class="panorama-item-left">
              <span class="cat-dot" style="background:${escapeHtml(s.color)}"></span>
              <span>${escapeHtml(s.name)}</span>
            </div>
            <div style="font-variant-numeric:tabular-nums;flex-shrink:0;">
              <strong>¥${formatMoney(s.amount, 0)}</strong>
              <span class="muted" style="font-size:11.5px;margin-left:4px;">${pct}%</span>
            </div>
          </div>
        `;
      }).join('');

      panoramaEl.innerHTML = `
        <div class="panorama-bar-track">${barSegs}</div>
        <div class="panorama-legend-grid">${legendItems}</div>
      `;
    }

    // 5. 渲染重合防重核销清单
    const dedupEl = document.getElementById('dedupListContainer');
    if (dedupItems.length === 0) {
      dedupEl.innerHTML = `<div class="muted" style="font-size:13px;padding:10px 0;">${m + 1}月没有任何订阅或氪金扣款记录，无需防重核销</div>`;
    } else {
      const hintBanner = billsInMonth.length === 0
        ? `<div class="muted" style="font-size:12px;margin-bottom:8px;">提示：当月共有 ${dedupItems.length} 笔订阅/氪金支付。右侧导入微信或支付宝月账单后，将自动识别国内扣款渠道并剥离防重（海外信用卡账单默认不误扣）。</div>`
        : '';

      const rowsHtml = dedupItems.map(({ ev, ovKey, checked }) => {
        const payText = ev.payment || (ev.currency === 'CNY' ? '国内支付' : `${ev.currency} 外币渠道`);
        return `
          <div class="dedup-row ${checked ? 'is-deducted' : ''}" data-ov-key="${escapeHtml(ovKey)}" data-cur-checked="${checked}">
            <div class="dedup-row-left">
              <span class="dedup-check-box">
                ${checked ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
              </span>
              ${renderMiniLogoHtml(ev.sub)}
              <div class="dedup-row-title">
                <strong>${escapeHtml(ev.label || ev.sub.name)}</strong>
                <small>${escapeHtml(ev.dateStr)} · ${escapeHtml(payText)}</small>
              </div>
            </div>
            <div class="dedup-row-right">
              <strong>¥${formatMoney(ev.amountCny)}</strong>
              <small>${checked ? (billsInMonth.length > 0 ? '已从日常账单核销' : '已标记重合') : '独立渠道 / 不扣减'}</small>
            </div>
          </div>
        `;
      }).join('');

      dedupEl.innerHTML = `${hintBanner}<div class="dedup-list">${rowsHtml}</div>`;
      dedupEl.querySelectorAll('.dedup-row').forEach(row => {
        row.addEventListener('click', () => {
          const ovKey = row.getAttribute('data-ov-key');
          const cur = row.getAttribute('data-cur-checked') === 'true';
          if (!state.dedupOverrides) state.dedupOverrides = {};
          state.dedupOverrides[ovKey] = !cur;
          saveState();
          renderDailyPage(getToday());
        });
      });
    }

    // 6. 渲染右侧已导入的月度日常账单卡片列表
    const mbListEl = document.getElementById('monthlyBillsList');
    if (billsInMonth.length === 0) {
      mbListEl.innerHTML = `
        <div class="empty-state" style="padding: 32px 18px;">
          <h3 style="margin-top:0;">尚未录入 ${m + 1} 月日常账单</h3>
          <p>打开微信「我 → 服务 → 钱包 → 账单 → 统计」或支付宝「我的 → 账单 → 月账单」，截一张图粘贴到上方即可自动解析各分类开销并防重合成总账。</p>
          <button type="button" class="btn btn-secondary btn-sm" id="btnEmptyManualBill">+ 手动输入月账单总额</button>
        </div>
      `;
      document.getElementById('btnEmptyManualBill').addEventListener('click', () => openDailyBillModal());
    } else {
      const cardsHtml = billsInMonth.map(bill => {
        const meta = getBillSourceMeta(bill.source);
        const catChips = (Array.isArray(bill.categories) ? bill.categories : [])
          .filter(c => Number(c.amount) > 0)
          .map(c => {
            const dc = CONFIG.DAILY_CATEGORIES.find(d => d.id === c.type) || CONFIG.DAILY_CATEGORIES[CONFIG.DAILY_CATEGORIES.length - 1];
            return `
              <span class="forecast-chip">
                <span class="cat-dot" style="background:${escapeHtml(dc.color)}"></span>
                <span>${escapeHtml(c.name || dc.name)}</span>
                <strong>¥${formatMoney(c.amount, 0)}</strong>
              </span>
            `;
          }).join('');

        return `
          <div class="mb-card">
            <div class="mb-card-top">
              <div style="display:flex;align-items:center;gap:8px;">
                <span class="mb-source-badge ${meta.cls}">${escapeHtml(bill.sourceLabel || meta.label)}</span>
                ${bill.note ? `<span class="muted" style="font-size:12px;">${escapeHtml(bill.note)}</span>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:10px;">
                <span class="mb-amount-main">¥${formatMoney(bill.totalAmount)}</span>
                <button type="button" class="action-icon-btn" data-edit-mb="${escapeHtml(bill.id)}" title="编辑">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button type="button" class="action-icon-btn danger" data-del-mb="${escapeHtml(bill.id)}" title="删除">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
            ${catChips ? `<div class="mb-cats-wrap">${catChips}</div>` : ''}
          </div>
        `;
      }).join('');

      mbListEl.innerHTML = `<div class="mb-stack">${cardsHtml}</div>`;
      mbListEl.querySelectorAll('[data-edit-mb]').forEach(btn => {
        btn.addEventListener('click', () => openDailyBillModal(btn.getAttribute('data-edit-mb')));
      });
      mbListEl.querySelectorAll('[data-del-mb]').forEach(btn => {
        btn.addEventListener('click', () => {
          const bid = btn.getAttribute('data-del-mb');
          state.monthlyBills = (state.monthlyBills || []).filter(b => b.id !== bid);
          saveState();
          renderDailyPage(getToday());
          showToast('已删除该份月度账单');
        });
      });
    }
  }

  function openDailyBillModal(editId = null, prefill = null) {
    const form = document.getElementById('dailyBillForm');
    form.reset();
    uiState.mbTotalManuallyEdited = false;
    uiState.pendingDetectedMerchants = [];

    document.querySelectorAll('[data-mb-cat]').forEach(inp => {
      inp.value = '';
    });

    if (editId) {
      const bill = (state.monthlyBills || []).find(b => b.id === editId);
      if (!bill) return;
      document.getElementById('dailyBillModalTitle').textContent = `编辑 ${bill.month} 月度账单`;
      document.getElementById('mbId').value = bill.id;
      document.getElementById('mbSource').value = bill.source || 'alipay';
      document.getElementById('mbTotal').value = bill.totalAmount ?? '';
      document.getElementById('mbNote').value = bill.note || '';
      uiState.mbTotalManuallyEdited = true;
      uiState.pendingDetectedMerchants = Array.isArray(bill.detectedMerchants) ? bill.detectedMerchants : [];

      (Array.isArray(bill.categories) ? bill.categories : []).forEach(c => {
        const inp = document.getElementById(`mbcat_${c.type}`);
        if (inp && Number(c.amount) > 0) {
          inp.value = (Number(inp.value) || 0) + Number(c.amount);
        }
      });
    } else {
      document.getElementById('dailyBillModalTitle').textContent = `录入 ${uiState.dailyYear}年${uiState.dailyMonth + 1}月 日常账单`;
      document.getElementById('mbId').value = '';
      if (prefill) {
        if (prefill.source && ['alipay', 'wechat', 'card', 'other'].includes(prefill.source)) {
          document.getElementById('mbSource').value = prefill.source;
        }
        if (Number(prefill.totalAmount) > 0) {
          document.getElementById('mbTotal').value = Number(prefill.totalAmount).toFixed(2);
          uiState.mbTotalManuallyEdited = true;
        }
        if (prefill.note) {
          document.getElementById('mbNote').value = prefill.note;
        }
        if (Array.isArray(prefill.detectedMerchants)) {
          uiState.pendingDetectedMerchants = prefill.detectedMerchants;
        }
        (Array.isArray(prefill.categories) ? prefill.categories : []).forEach(c => {
          const key = CONFIG.DAILY_CATEGORIES.some(d => d.id === c.type) ? c.type : 'other';
          const inp = document.getElementById(`mbcat_${key}`);
          if (inp && Number(c.amount) > 0) {
            inp.value = Number(((Number(inp.value) || 0) + Number(c.amount)).toFixed(2));
          }
        });
      }
    }

    openModal('dailyBillModal');
  }

  async function recognizeMonthlyBillImage(file) {
    if (!file || uiState.isRecognizingDaily) return;
    if (!file.type.startsWith('image/')) {
      showToast('请上传图片格式的月账单截图');
      return;
    }

    if (uiState.activePage !== 'daily') {
      switchAppPage('daily');
    }

    uiState.isRecognizingDaily = true;
    setDailyVisionState('loading', 'AI 正在解析月度账单…', '正在识别总支出、餐饮/购物等分类金额及扣款渠道，请稍候 2~3 秒');

    try {
      const { imageBase64, mimeType } = await compressImageForAI(file);
      const resp = await fetch('/api/parse-monthly-bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          mimeType,
          targetMonth: getDailyMonthKey()
        })
      });

      const result = await resp.json().catch(() => ({}));
      if (!resp.ok || !result.ok || !result.data) {
        throw new Error(result.error || `请求失败 (${resp.status})`);
      }

      const d = result.data;
      if (d.month && /^\d{4}-\d{2}$/.test(d.month)) {
        const [ry, rm] = d.month.split('-').map(Number);
        if (ry >= 2020 && rm >= 1 && rm <= 12) {
          uiState.dailyYear = ry;
          uiState.dailyMonth = rm - 1;
          renderDailyPage(getToday());
        }
      }

      setDailyVisionState(
        'success',
        `识别完成：${d.sourceLabel || '月度账单'} (¥${formatMoney(d.totalAmount || 0)})`,
        '已自动填入分类明细弹窗，核对无误点击「保存月度账单」即可自动防重合成'
      );
      openDailyBillModal(null, d);
      showToast('月度账单截图解析成功！');
    } catch (err) {
      const hint = window.location.protocol === 'file:'
        ? '离线本地文件模式不支持云端 AI 识图，请在线上网址中使用'
        : escapeHtml(err.message || '请换一张清晰的月账单统计图重试');
      setDailyVisionState('idle', '月账单识别未完成', hint);
      showToast('月账单识别失败，请查看提示');
    } finally {
      uiState.isRecognizingDaily = false;
    }
  }

  // ---------- 新增 / 编辑订阅表单逻辑 ----------
  function renderPresetChips(filterText = '') {
    const q = filterText.trim().toLowerCase();
    const list = CONFIG.PRESETS.filter(p => !q || p.name.toLowerCase().includes(q) || (p.brandKey && p.brandKey.includes(q)));
    const chipsEl = document.getElementById('presetChips');

    chipsEl.innerHTML = list.map(p => {
      const src = LOGOS ? LOGOS.resolveLogoSrc(p) : null;
      const logoPart = src
        ? `<img class="preset-chip-logo" src="${escapeHtml(src)}" alt="" />`
        : `<span class="cat-dot" style="background:${escapeHtml(p.color)}"></span>`;
      return `
        <button type="button" class="preset-chip" data-preset-name="${escapeHtml(p.name)}">
          ${logoPart}
          <span>${escapeHtml(p.name)}</span>
        </button>
      `;
    }).join('');

    chipsEl.querySelectorAll('.preset-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-preset-name');
        const preset = CONFIG.PRESETS.find(p => p.name === name);
        if (!preset) return;

        document.getElementById('subName').value = preset.name;
        document.getElementById('subBrandKey').value = preset.brandKey || 'auto';
        document.getElementById('subCustomLogo').value = '';
        document.getElementById('subIcon').value = preset.icon || '';
        document.getElementById('subColor').value = preset.color || '#2563EB';
        document.getElementById('subCategory').value = preset.category;
        document.getElementById('subPrice').value = preset.price;
        document.getElementById('subRegularPrice').value = '';
        document.getElementById('subCurrency').value = preset.currency;
        document.getElementById('subCycle').value = preset.cycle;
        document.getElementById('subPayment').value = preset.payment || '';
        document.getElementById('subUrl').value = preset.url || '';

        if (!uiState.nextBillManuallyEdited && preset.cycle !== 'lifetime' && preset.cycle !== 'oneoff') {
          const baseD = parseLocalDate(document.getElementById('subStartDate').value) || getToday();
          const nextD = addCycles(baseD, preset.cycle, 1);
          document.getElementById('subNextBill').value = formatDateISO(nextD);
        }
        syncSubFormDynamicUI();
      });
    });
  }

  function syncSubFormDynamicUI() {
    const name = document.getElementById('subName').value;
    const brandKey = document.getElementById('subBrandKey').value;
    const customLogo = document.getElementById('subCustomLogo').value;
    const url = document.getElementById('subUrl').value;

    const clearBtn = document.getElementById('btnClearCustomLogo');
    clearBtn.classList.toggle('hidden', !customLogo);

    const previewSub = {
      name: name || 'App',
      brandKey,
      customLogo,
      url,
      icon: document.getElementById('subIcon').value || deriveShortIcon(name),
      color: document.getElementById('subColor').value || '#2563EB'
    };

    const previewWrap = document.getElementById('formAvatarPreviewWrap');
    previewWrap.innerHTML = renderAppLogoHtml(previewSub, 'is-lg');
    bindImageFallbacks(previewWrap);

    const cycle = document.getElementById('subCycle').value;
    const status = document.getElementById('subStatus').value;
    const nextBillWrap = document.getElementById('nextBillFieldWrap');
    const amortWrap = document.getElementById('amortizeFieldWrap');
    const autoRenewRow = document.getElementById('autoRenewRow');
    const startDateLabel = document.getElementById('subStartDateLabel');

    if (cycle === 'lifetime') {
      nextBillWrap.classList.add('hidden');
      amortWrap.classList.add('hidden');
      autoRenewRow.classList.add('hidden');
      startDateLabel.textContent = '买断购买日期 (选填)';
    } else if (cycle === 'oneoff') {
      nextBillWrap.classList.add('hidden');
      amortWrap.classList.remove('hidden');
      autoRenewRow.classList.add('hidden');
      startDateLabel.textContent = '消费发生日期';
    } else {
      nextBillWrap.classList.remove('hidden');
      amortWrap.classList.add('hidden');
      autoRenewRow.classList.toggle('hidden', status === 'paused');
      startDateLabel.textContent = '首次订阅日期 (选填)';
      document.getElementById('subNextBillLabel').textContent =
        status === 'trial' ? '试用结束 / 首次扣款日' : '下次扣款 / 到期日 (可后补)';
    }

    const tempSub = {
      price: document.getElementById('subPrice').value,
      regularPrice: document.getElementById('subRegularPrice').value,
      currency: document.getElementById('subCurrency').value,
      cycle,
      amortizeMonths: document.getElementById('subAmortizeMonths').value,
      startDate: document.getElementById('subStartDate').value || formatDateISO(getToday()),
      status: 'active',
      splitCount: document.getElementById('subSplit').value,
      autoRenew: document.getElementById('subAutoRenew').checked
    };
    const m = computeSubMetrics(tempSub, getToday());
    const previewEl = document.getElementById('liveCalcPreview');

    if (cycle === 'lifetime') {
      previewEl.innerHTML = `折算个人买断成本：<strong>¥${formatMoney(m.firstCnyPerCycle)}</strong>（一次性支出，不计入每月固定负担）`;
    } else if (cycle === 'oneoff') {
      previewEl.innerHTML =
        `单次实付 <strong>¥${formatMoney(m.firstCnyPerCycle)}</strong> · 均摊 ${m.amortMonths} 个月折合 <strong>¥${formatMoney(m.monthlyCny)} / 月</strong>（期满自动归零，不污染长期月卡预测）`;
    } else if (m.hasRegularPrice) {
      previewEl.innerHTML =
        `首期实付 <strong>¥${formatMoney(m.firstCnyPerCycle)}</strong> · 后续恢复原价折合 <strong>¥${formatMoney(m.monthlyCny)} / 月</strong>（年化 <strong>¥${formatMoney(m.yearlyCny)} / 年</strong>）`;
    } else {
      const splitNote = m.split > 1 ? `（${m.split}人平摊后每期 ¥${formatMoney(m.cnyPerCycle)}）` : '';
      previewEl.innerHTML =
        `折算个人成本：<strong>¥${formatMoney(m.monthlyCny)} / 月</strong> · 年化 <strong>¥${formatMoney(m.yearlyCny)} / 年</strong> ${splitNote}`;
    }
  }

  function openSubModal(editId = null, triggerScreenshot = false) {
    const form = document.getElementById('subForm');
    form.reset();
    document.getElementById('presetSearch').value = '';
    renderPresetChips('');

    setAiVisionState(
      'idle',
      'AI 截图智能填充',
      '拖入账单/会员中心截图，或直接按 <kbd>Ctrl+V</kbd> 粘贴截图自动识别名称、价格与到期日'
    );

    const today = getToday();

    if (editId) {
      const sub = state.subscriptions.find(s => s.id === editId);
      if (!sub) return;
      document.getElementById('subModalTitle').textContent = '编辑软件订阅';
      document.getElementById('presetSection').classList.add('hidden');
      document.getElementById('subId').value = sub.id;
      document.getElementById('subName').value = sub.name;
      document.getElementById('subCategory').value = sub.category;
      document.getElementById('subBrandKey').value = sub.brandKey || 'auto';
      document.getElementById('subCustomLogo').value = sub.customLogo || '';
      document.getElementById('subIcon').value = sub.icon || '';
      document.getElementById('subColor').value = sub.color || '#2563eb';
      document.getElementById('subPrice').value = sub.price;
      document.getElementById('subRegularPrice').value = sub.regularPrice || '';
      document.getElementById('subCurrency').value = sub.currency;
      document.getElementById('subCycle').value = sub.cycle;
      document.getElementById('subAmortizeMonths').value = sub.amortizeMonths || 1;
      document.getElementById('subSplit').value = sub.splitCount || 1;
      document.getElementById('subStatus').value = sub.status || 'active';
      const eff = getEffectiveNextDate(sub, today);
      document.getElementById('subNextBill').value = sub.cycle === 'oneoff' ? '' : (eff ? formatDateISO(eff) : (sub.nextBillDate || ''));
      document.getElementById('subStartDate').value = sub.startDate || '';
      document.getElementById('subAutoRenew').checked = sub.autoRenew !== false;
      document.getElementById('subPayment').value = sub.payment || '';
      document.getElementById('subAccount').value = sub.account || '';
      document.getElementById('subUrl').value = sub.url || '';
      document.getElementById('subNote').value = sub.note || '';
      uiState.nextBillManuallyEdited = true;
    } else {
      document.getElementById('subModalTitle').textContent = '新增软件订阅';
      document.getElementById('presetSection').classList.remove('hidden');
      document.getElementById('subId').value = '';
      document.getElementById('subBrandKey').value = 'auto';
      document.getElementById('subCustomLogo').value = '';
      document.getElementById('subIcon').value = '';
      document.getElementById('subColor').value = '#2563eb';
      document.getElementById('subRegularPrice').value = '';
      document.getElementById('subCurrency').value = 'CNY';
      document.getElementById('subCycle').value = 'monthly';
      document.getElementById('subAmortizeMonths').value = 1;
      document.getElementById('subSplit').value = 1;
      document.getElementById('subStatus').value = 'active';
      document.getElementById('subAutoRenew').checked = true;
      document.getElementById('subStartDate').value = formatDateISO(today);
      document.getElementById('subNextBill').value = formatDateISO(addCycles(today, 'monthly', 1));
      uiState.nextBillManuallyEdited = false;
    }

    syncSubFormDynamicUI();
    openModal('subModal');

    if (triggerScreenshot) {
      setTimeout(() => document.getElementById('inputScreenshotFile').click(), 80);
    } else {
      setTimeout(() => document.getElementById('subName').focus(), 60);
    }
  }

  function handleLogoFileUpload(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 96;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, size, size);

        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

        const dataUrl = canvas.toDataURL('image/png');
        document.getElementById('subCustomLogo').value = dataUrl;
        syncSubFormDynamicUI();
        showToast('已载入自定义图标图片');
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  // ---------- 预算与汇率弹窗 ----------
  function openSettingsModal() {
    document.getElementById('settingBudget').value = state.settings.monthlyBudget ?? 3500;
    document.getElementById('settingAlertDays').value = String(state.settings.alertDays || 14);
    document.getElementById('settingAutoSyncRates').checked = state.settings.autoSyncRates !== false;
    updateLiveRateStatusLabel();

    const ratesGrid = document.getElementById('ratesGrid');
    ratesGrid.innerHTML = Object.keys(CONFIG.DEFAULT_RATES)
      .filter(code => code !== 'CNY')
      .map(code => {
        const info = CONFIG.DEFAULT_RATES[code];
        const val = state.settings.rates[code] ?? info.rate;
        return `
          <div class="rate-item">
            <label for="rate_${code}">1 ${code} (${info.name})</label>
            <input type="number" id="rate_${code}" data-rate-code="${code}" step="0.0001" min="0.0001" value="${val}" required />
          </div>
        `;
      }).join('');

    openModal('settingsModal');
  }

  // ---------- 数据导入与导出 ----------
  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportJsonBackup() {
    const payload = {
      app: 'SubLedger',
      exportedAt: new Date().toISOString(),
      subscriptions: state.subscriptions,
      monthlyBills: state.monthlyBills || [],
      dedupOverrides: state.dedupOverrides || {},
      settings: state.settings
    };
    const dateTag = formatDateISO(getToday());
    downloadBlob(JSON.stringify(payload, null, 2), `SubLedger_订阅备份_${dateTag}.json`, 'application/json;charset=utf-8');
    showToast('已导出 JSON 备份文件');
  }

  function exportCsvSpreadsheet() {
    const today = getToday();
    const headers = [
      '软件名称', '分类', '状态', '计费周期', '当前/首期原价', '续费原价', '币种', '分摊人数',
      '折合月均(CNY)', '折合年化(CNY)', '自动续费', '下次账单日', '首次订阅日',
      '扣款渠道', '区服/账号', '备注'
    ];

    const escapeCsv = (val) => {
      const s = val === null || val === undefined ? '' : String(val);
      if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const statusMap = { active: '生效中', trial: '免费试用', paused: '已停用' };
    const rows = state.subscriptions.map(sub => {
      const m = computeSubMetrics(sub, today);
      const cat = getCategoryInfo(sub.category).name;
      const cyc = getCycleInfo(sub.cycle).label;
      return [
        sub.name,
        cat,
        statusMap[sub.status] || sub.status,
        cyc,
        sub.price,
        sub.regularPrice || '',
        sub.currency,
        m.split,
        sub.cycle === 'lifetime' && m.monthlyCny <= 0 ? 0 : m.monthlyCny.toFixed(2),
        sub.cycle === 'lifetime' ? m.firstCnyPerCycle.toFixed(2) : m.yearlyCny.toFixed(2),
        sub.cycle === 'lifetime' ? '买断' : sub.cycle === 'oneoff' ? `均摊${m.amortMonths}月` : (sub.autoRenew ? '是' : '否'),
        m.effNext ? formatDateISO(m.effNext) : (sub.nextBillDate || ''),
        sub.startDate || '',
        sub.payment || '',
        sub.account || '',
        sub.note || ''
      ].map(escapeCsv).join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const dateTag = formatDateISO(today);
    downloadBlob(csvContent, `软件订阅明细_${dateTag}.csv`, 'text/csv;charset=utf-8');
    showToast('已导出 Excel 兼容 CSV 表格');
  }

  // ---------- 初始化下拉框与事件监听 ----------
  function initControlsAndEvents() {
    applyTheme(state.settings.theme);

    const catFilterEl = document.getElementById('categoryFilter');
    const subCatEl = document.getElementById('subCategory');
    CONFIG.CATEGORIES.forEach(c => {
      catFilterEl.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`);
      subCatEl.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`);
    });

    const brandSelectEl = document.getElementById('subBrandKey');
    if (LOGOS && Array.isArray(LOGOS.BRANDS)) {
      LOGOS.BRANDS.forEach(b => {
        brandSelectEl.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(b.key)}">${escapeHtml(b.label)}</option>`);
      });
    }

    const subCurEl = document.getElementById('subCurrency');
    const addonCurEl = document.getElementById('addonCurrency');
    Object.values(CONFIG.DEFAULT_RATES).forEach(cur => {
      const optHtml = `<option value="${cur.code}">${cur.symbol} ${cur.name} (${cur.code})</option>`;
      subCurEl.insertAdjacentHTML('beforeend', optHtml);
      addonCurEl.insertAdjacentHTML('beforeend', optHtml);
    });

    const mbCatsGrid = document.getElementById('mbCategoriesGrid');
    CONFIG.DAILY_CATEGORIES.forEach(dc => {
      mbCatsGrid.insertAdjacentHTML(
        'beforeend',
        `<div class="rate-item">
          <label for="mbcat_${escapeHtml(dc.id)}">${escapeHtml(dc.name)}</label>
          <input type="number" id="mbcat_${escapeHtml(dc.id)}" data-mb-cat="${escapeHtml(dc.id)}" step="0.01" min="0" placeholder="0.00" />
        </div>`
      );
    });

    const subCycleEl = document.getElementById('subCycle');
    CONFIG.CYCLES.forEach(cyc => {
      subCycleEl.insertAdjacentHTML('beforeend', `<option value="${cyc.id}">${cyc.label}</option>`);
    });

    const pmDatalist = document.getElementById('paymentMethodList');
    CONFIG.PAYMENT_METHODS.forEach(pm => {
      pmDatalist.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(pm)}"></option>`);
    });

    enhanceCustomSelects();

    // 顶部双主界面切换（订阅与氪金账本 <-> 月度日常总账）
    document.querySelectorAll('#appPageTabs [data-app-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        switchAppPage(btn.getAttribute('data-app-page'));
      });
    });

    document.getElementById('btnAddSub').addEventListener('click', () => openSubModal());
    document.getElementById('btnScanScreenshot').addEventListener('click', () => openSubModal(null, true));
    document.getElementById('btnOpenSettings').addEventListener('click', openSettingsModal);
    document.getElementById('btnQuickBudget').addEventListener('click', openSettingsModal);
    document.getElementById('btnOpenData').addEventListener('click', () => openModal('dataModal'));

    document.getElementById('btnNavAiReview').addEventListener('click', () => {
      if (uiState.activePage !== 'subs') {
        switchAppPage('subs');
      }
      const sec = document.getElementById('aiPersonaSection');
      sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (!state.aiReviews?.[uiState.reviewMode]?.review) {
        generateAiPersona(uiState.reviewMode);
      }
    });

    document.getElementById('btnGenerateReview').addEventListener('click', () => {
      generateAiPersona(uiState.reviewMode);
    });

    document.querySelectorAll('[data-review-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nextMode = btn.getAttribute('data-review-mode');
        if (uiState.isGeneratingReview) return;
        uiState.reviewMode = nextMode;
        if (state.aiReviews?.[nextMode]?.review) {
          renderAiPersona();
        } else {
          generateAiPersona(nextMode);
        }
      });
    });

    // AI 截图上传、拖拽与全局 Ctrl+V 粘贴识别（自动分流订阅截图 vs 月度日常账单截图）
    document.getElementById('inputScreenshotFile').addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (file) recognizeScreenshotFile(file);
      e.target.value = '';
    });

    const dropzone = document.getElementById('aiVisionDropzone');
    ['dragenter', 'dragover'].forEach(evName => {
      dropzone.addEventListener(evName, e => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(evName => {
      dropzone.addEventListener(evName, e => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('is-dragover');
      });
    });
    dropzone.addEventListener('drop', e => {
      const file = e.dataTransfer?.files?.[0];
      if (file) recognizeScreenshotFile(file);
    });

    // 界面 2：月度日常总账交互与 AI 识图事件
    document.getElementById('btnDailyPrevMonth').addEventListener('click', () => {
      uiState.dailyMonth--;
      if (uiState.dailyMonth < 0) {
        uiState.dailyMonth = 11;
        uiState.dailyYear--;
      }
      renderDailyPage(getToday());
    });

    document.getElementById('btnDailyNextMonth').addEventListener('click', () => {
      uiState.dailyMonth++;
      if (uiState.dailyMonth > 11) {
        uiState.dailyMonth = 0;
        uiState.dailyYear++;
      }
      renderDailyPage(getToday());
    });

    document.getElementById('btnDailyThisMonth').addEventListener('click', () => {
      const t = getToday();
      uiState.dailyYear = t.getFullYear();
      uiState.dailyMonth = t.getMonth();
      renderDailyPage(t);
    });

    document.querySelectorAll('#dailyBasisTabs [data-daily-basis]').forEach(btn => {
      btn.addEventListener('click', () => {
        uiState.dailyBasis = btn.getAttribute('data-daily-basis') || 'cashflow';
        renderDailyPage(getToday());
      });
    });

    document.getElementById('btnDailyScanBill').addEventListener('click', () => {
      document.getElementById('inputMonthlyBillFile').click();
    });

    document.getElementById('btnOpenManualBill').addEventListener('click', () => {
      openDailyBillModal();
    });

    document.getElementById('inputMonthlyBillFile').addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (file) recognizeMonthlyBillImage(file);
      e.target.value = '';
    });

    const dailyDropzone = document.getElementById('dailyVisionDropzone');
    ['dragenter', 'dragover'].forEach(evName => {
      dailyDropzone.addEventListener(evName, e => {
        e.preventDefault();
        e.stopPropagation();
        dailyDropzone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(evName => {
      dailyDropzone.addEventListener(evName, e => {
        e.preventDefault();
        e.stopPropagation();
        dailyDropzone.classList.remove('is-dragover');
      });
    });
    dailyDropzone.addEventListener('drop', e => {
      const file = e.dataTransfer?.files?.[0];
      if (file) recognizeMonthlyBillImage(file);
    });

    document.addEventListener('paste', e => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            const subModalOpen = !document.getElementById('subModal').classList.contains('hidden');
            if (!subModalOpen && uiState.activePage === 'daily') {
              recognizeMonthlyBillImage(file);
            } else {
              recognizeScreenshotFile(file);
            }
            break;
          }
        }
      }
    });

    document.getElementById('btnThemeToggle').addEventListener('click', () => {
      const next = state.settings.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      saveState();
    });

    document.getElementById('btnClearDemo').addEventListener('click', () => {
      state.subscriptions = [];
      state.isDemo = false;
      saveState();
      renderAll();
      showToast('已清空示例数据，现在可以添加您的真实订阅');
    });

    document.getElementById('btnDismissDemo').addEventListener('click', () => {
      state.demoBannerDismissed = true;
      saveState();
      renderBanners();
    });

    document.getElementById('btnResetCatFilter').addEventListener('click', () => {
      uiState.categoryFilter = 'all';
      catFilterEl.value = 'all';
      renderAll();
    });

    document.querySelectorAll('[data-panel-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-panel-tab');
        uiState.rightTab = tab;
        document.querySelectorAll('[data-panel-tab]').forEach(b => {
          const active = b.getAttribute('data-panel-tab') === tab;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', String(active));
        });

        const isCal = tab === 'calendar';
        document.getElementById('forecastView').classList.toggle('hidden', isCal);
        document.getElementById('calendarView').classList.toggle('hidden', !isCal);
        document.getElementById('rightPanelTitle').textContent = isCal ? '月度扣款日历' : '未来 12 个月账单预测';
        document.getElementById('rightPanelDesc').textContent = isCal
          ? '按日期查看具体扣款与不续费到期项目，点击条目可直接编辑'
          : '包含按月扣款与年付/季付软件的集中续费高峰';
        renderAll();
      });
    });

    document.getElementById('btnCalPrev').addEventListener('click', () => {
      uiState.calMonth--;
      if (uiState.calMonth < 0) {
        uiState.calMonth = 11;
        uiState.calYear--;
      }
      uiState.selectedCalDate = null;
      renderCalendar(getToday());
    });

    document.getElementById('btnCalNext').addEventListener('click', () => {
      uiState.calMonth++;
      if (uiState.calMonth > 11) {
        uiState.calMonth = 0;
        uiState.calYear++;
      }
      uiState.selectedCalDate = null;
      renderCalendar(getToday());
    });

    document.getElementById('btnCalToday').addEventListener('click', () => {
      const t = getToday();
      uiState.calYear = t.getFullYear();
      uiState.calMonth = t.getMonth();
      uiState.selectedCalDate = formatDateISO(t);
      renderCalendar(t);
    });

    document.querySelectorAll('.status-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        uiState.statusFilter = tab.getAttribute('data-status');
        document.querySelectorAll('.status-tab').forEach(t => t.classList.toggle('active', t === tab));
        renderSubscriptionList(getToday());
      });
    });

    document.getElementById('searchInput').addEventListener('input', e => {
      uiState.searchQuery = e.target.value;
      renderSubscriptionList(getToday());
    });

    catFilterEl.addEventListener('change', e => {
      uiState.categoryFilter = e.target.value;
      renderAll();
    });

    document.getElementById('cycleFilter').addEventListener('change', e => {
      uiState.cycleFilter = e.target.value;
      renderSubscriptionList(getToday());
    });

    document.getElementById('sortSelect').addEventListener('change', e => {
      uiState.sortBy = e.target.value;
      renderSubscriptionList(getToday());
    });

    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        uiState.viewMode = btn.getAttribute('data-view');
        document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b === btn));
        renderSubscriptionList(getToday());
      });
    });

    document.getElementById('presetSearch').addEventListener('input', e => {
      renderPresetChips(e.target.value);
    });

    document.getElementById('btnSearchAppIcon').addEventListener('click', searchAppStoreIcon);

    document.getElementById('subLogoUpload').addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (file) handleLogoFileUpload(file);
      e.target.value = '';
    });

    document.getElementById('btnClearCustomLogo').addEventListener('click', () => {
      document.getElementById('subCustomLogo').value = '';
      syncSubFormDynamicUI();
    });

    document.getElementById('subNextBill').addEventListener('input', () => {
      uiState.nextBillManuallyEdited = true;
    });

    const autoSyncNextBill = () => {
      if (uiState.nextBillManuallyEdited || document.getElementById('subId').value) return;
      const cyc = document.getElementById('subCycle').value;
      if (cyc === 'lifetime' || cyc === 'oneoff') return;
      const baseD = parseLocalDate(document.getElementById('subStartDate').value) || getToday();
      const nextD = addCycles(baseD, cyc, 1);
      if (nextD) {
        document.getElementById('subNextBill').value = formatDateISO(nextD);
      }
    };

    document.getElementById('subCycle').addEventListener('change', autoSyncNextBill);
    document.getElementById('subStartDate').addEventListener('change', autoSyncNextBill);

    [
      'subName', 'subBrandKey', 'subUrl', 'subPrice', 'subRegularPrice',
      'subCurrency', 'subCycle', 'subAmortizeMonths', 'subStartDate',
      'subSplit', 'subStatus', 'subAutoRenew'
    ].forEach(id => {
      document.getElementById(id).addEventListener('input', syncSubFormDynamicUI);
      document.getElementById(id).addEventListener('change', syncSubFormDynamicUI);
    });

    document.getElementById('subForm').addEventListener('submit', e => {
      e.preventDefault();
      const id = document.getElementById('subId').value;
      const name = document.getElementById('subName').value.trim();
      if (!name) return;

      const existing = id ? state.subscriptions.find(s => s.id === id) : null;
      const cycle = document.getElementById('subCycle').value;
      const regVal = parseFloat(document.getElementById('subRegularPrice').value);
      const rawStart = document.getElementById('subStartDate').value;

      const payload = {
        id: id || `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        category: document.getElementById('subCategory').value,
        brandKey: document.getElementById('subBrandKey').value || 'auto',
        customLogo: document.getElementById('subCustomLogo').value || '',
        icon: document.getElementById('subIcon').value.trim() || deriveShortIcon(name),
        color: document.getElementById('subColor').value || '#2563EB',
        price: Math.max(0, parseFloat(document.getElementById('subPrice').value) || 0),
        regularPrice: regVal > 0 ? regVal : null,
        currency: document.getElementById('subCurrency').value,
        cycle,
        amortizeMonths: cycle === 'oneoff'
          ? Math.max(1, parseInt(document.getElementById('subAmortizeMonths').value, 10) || 1)
          : (existing?.amortizeMonths || 1),
        splitCount: Math.max(1, parseInt(document.getElementById('subSplit').value, 10) || 1),
        status: document.getElementById('subStatus').value,
        autoRenew: (cycle === 'lifetime' || cycle === 'oneoff') ? false : document.getElementById('subAutoRenew').checked,
        nextBillDate: (cycle === 'lifetime' || cycle === 'oneoff') ? '' : document.getElementById('subNextBill').value,
        startDate: cycle === 'oneoff' ? (rawStart || formatDateISO(getToday())) : rawStart,
        payment: document.getElementById('subPayment').value.trim(),
        account: document.getElementById('subAccount').value.trim(),
        url: document.getElementById('subUrl').value.trim(),
        note: document.getElementById('subNote').value.trim(),
        addons: existing && Array.isArray(existing.addons) ? existing.addons : []
      };

      if (id) {
        const idx = state.subscriptions.findIndex(s => s.id === id);
        if (idx !== -1) state.subscriptions[idx] = payload;
        showToast(`已更新「${payload.name}」`);
      } else {
        state.subscriptions.unshift(payload);
        showToast(`已添加「${payload.name}」`);
      }

      saveState();
      closeModal('subModal');
      renderAll();
    });

    // 单次氪金 / 加购表单提交
    document.getElementById('addonForm').addEventListener('submit', e => {
      e.preventDefault();
      const subId = document.getElementById('addonSubId').value;
      const sub = state.subscriptions.find(s => s.id === subId);
      if (!sub) return;

      const title = document.getElementById('addonTitle').value.trim();
      const price = Math.max(0, parseFloat(document.getElementById('addonPrice').value) || 0);
      if (!title || price <= 0) return;

      if (!Array.isArray(sub.addons)) sub.addons = [];
      sub.addons.push({
        id: `ad-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        title,
        date: document.getElementById('addonDate').value || formatDateISO(getToday()),
        price,
        currency: document.getElementById('addonCurrency').value || 'CNY',
        amortizeMonths: Math.max(1, parseInt(document.getElementById('addonAmortize').value, 10) || 1),
        payment: document.getElementById('addonPayment').value.trim()
      });

      saveState();
      closeModal('addonModal');
      renderAll();
      showToast(`已为「${sub.name}」记录单次消费：${title}`);
    });

    // 月度日常账单：分类金额输入时自动汇总到总支出
    document.getElementById('mbTotal').addEventListener('input', () => {
      uiState.mbTotalManuallyEdited = Boolean(document.getElementById('mbTotal').value);
    });

    document.querySelectorAll('[data-mb-cat]').forEach(inp => {
      inp.addEventListener('input', () => {
        let sum = 0;
        document.querySelectorAll('[data-mb-cat]').forEach(el => {
          sum += Math.max(0, parseFloat(el.value) || 0);
        });
        const totalEl = document.getElementById('mbTotal');
        if (sum > 0 && (!uiState.mbTotalManuallyEdited || (parseFloat(totalEl.value) || 0) < sum)) {
          totalEl.value = sum.toFixed(2);
        }
      });
    });

    document.getElementById('dailyBillForm').addEventListener('submit', e => {
      e.preventDefault();
      const mbId = document.getElementById('mbId').value;
      const source = document.getElementById('mbSource').value || 'alipay';
      const meta = getBillSourceMeta(source);

      const categories = [];
      let catSum = 0;
      CONFIG.DAILY_CATEGORIES.forEach(dc => {
        const inp = document.getElementById(`mbcat_${dc.id}`);
        const val = Math.max(0, parseFloat(inp?.value) || 0);
        if (val > 0) {
          categories.push({ type: dc.id, name: dc.name, amount: Number(val.toFixed(2)) });
          catSum += val;
        }
      });

      const rawTotal = Math.max(0, parseFloat(document.getElementById('mbTotal').value) || 0);
      const totalAmount = Number(Math.max(rawTotal, catSum).toFixed(2));
      if (totalAmount <= 0) {
        showToast('请填写有效的月账单总金额');
        return;
      }

      if (!Array.isArray(state.monthlyBills)) state.monthlyBills = [];
      const existing = mbId ? state.monthlyBills.find(b => b.id === mbId) : null;

      const billPayload = {
        id: mbId || `mb-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        month: existing ? existing.month : getDailyMonthKey(),
        source,
        sourceLabel: meta.label,
        totalAmount,
        categories,
        detectedMerchants: uiState.pendingDetectedMerchants || [],
        note: document.getElementById('mbNote').value.trim(),
        updatedAt: new Date().toISOString()
      };

      if (mbId) {
        const idx = state.monthlyBills.findIndex(b => b.id === mbId);
        if (idx !== -1) state.monthlyBills[idx] = billPayload;
        showToast('已更新月度日常账单');
      } else {
        state.monthlyBills.unshift(billPayload);
        showToast(`已导入「${meta.label}」并自动匹配重合项`);
      }

      saveState();
      closeModal('dailyBillModal');
      renderDailyPage(getToday());
    });

    document.getElementById('btnFetchLiveRates').addEventListener('click', () => {
      syncLiveExchangeRates(true);
    });

    document.getElementById('btnFooterSyncRates').addEventListener('click', () => {
      syncLiveExchangeRates(true);
    });

    document.getElementById('settingsForm').addEventListener('submit', e => {
      e.preventDefault();
      state.settings.monthlyBudget = Math.max(0, parseFloat(document.getElementById('settingBudget').value) || 0);
      state.settings.alertDays = Number(document.getElementById('settingAlertDays').value) || 14;
      state.settings.autoSyncRates = document.getElementById('settingAutoSyncRates').checked;

      document.querySelectorAll('[data-rate-code]').forEach(inp => {
        const code = inp.getAttribute('data-rate-code');
        const val = parseFloat(inp.value);
        if (val > 0) state.settings.rates[code] = val;
      });

      saveState();
      closeModal('settingsModal');
      renderAll();
      showToast('预算与汇率设置已更新');
    });

    document.getElementById('btnExportJson').addEventListener('click', exportJsonBackup);
    document.getElementById('btnExportCsv').addEventListener('click', exportCsvSpreadsheet);

    document.getElementById('inputImportJson').addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result));
          const importedSubs = Array.isArray(data) ? data : data.subscriptions;
          if (!Array.isArray(importedSubs)) {
            throw new Error('格式无效');
          }
          state.subscriptions = importedSubs;
          if (Array.isArray(data.monthlyBills)) {
            state.monthlyBills = data.monthlyBills;
          }
          if (data.dedupOverrides && typeof data.dedupOverrides === 'object') {
            state.dedupOverrides = data.dedupOverrides;
          }
          if (data.settings) {
            state.settings = {
              ...state.settings,
              ...data.settings,
              rates: { ...getDefaultRatesMap(), ...(data.settings.rates || {}) }
            };
            applyTheme(state.settings.theme || 'light');
          }
          state.isDemo = false;
          saveState();
          closeModal('dataModal');
          renderAll();
          showToast(`成功导入 ${importedSubs.length} 条订阅记录`);
        } catch (err) {
          window.alert('导入失败：请选择有效的 SubLedger JSON 备份文件。');
        } finally {
          e.target.value = '';
        }
      };
      reader.readAsText(file);
    });

    document.getElementById('btnLoadDemo').addEventListener('click', () => {
      if (state.subscriptions.length > 0 && !window.confirm('恢复示例数据将覆盖当前列表，是否继续？')) return;
      state.subscriptions = CONFIG.createDemoSubscriptions();
      state.isDemo = true;
      state.demoBannerDismissed = false;
      saveState();
      closeModal('dataModal');
      renderAll();
      showToast('已恢复示例订阅数据');
    });

    document.getElementById('btnClearAllData').addEventListener('click', () => {
      if (!window.confirm('确定要彻底清空所有订阅与月账单记录吗？此操作不可撤销。')) return;
      state.subscriptions = [];
      state.monthlyBills = [];
      state.dedupOverrides = {};
      state.isDemo = false;
      saveState();
      closeModal('dataModal');
      renderAll();
      showToast('已清空所有订阅与月账单记录');
    });

    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close-modal')));
    });

    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) backdrop.classList.add('hidden');
      });
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(m => m.classList.add('hidden'));
      }
      const tag = (e.target && e.target.tagName) || '';
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;
      if (!isInput && (e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const anyOpen = document.querySelector('.modal-backdrop:not(.hidden)');
        if (!anyOpen) {
          e.preventDefault();
          if (uiState.activePage === 'daily') {
            openDailyBillModal();
          } else {
            openSubModal();
          }
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initControlsAndEvents();
    renderAll();

    // 若通过本地服务 (subledger CLI) 启动，自动挂载 ~/.subledger/data.json 双向同步
    syncWithLocalServer();
    window.addEventListener('focus', () => {
      if (uiState.localServerConnected) {
        syncWithLocalServer();
      }
    });

    // 启动时若开启了自动汇率同步且距离上次同步超过 6 小时（或首次升级），自动拉取真实汇率
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    if (state.settings.autoSyncRates !== false) {
      const age = Date.now() - (state.settings.ratesLastSynced || 0);
      if (age > SIX_HOURS_MS) {
        syncLiveExchangeRates(false);
      }
    }

    // 页面长开时每 6 小时自动后台刷新汇率
    setInterval(() => {
      if (state.settings.autoSyncRates !== false) {
        syncLiveExchangeRates(false);
      }
    }, SIX_HOURS_MS);
  });
})();
