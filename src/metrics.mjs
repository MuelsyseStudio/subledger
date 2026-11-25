import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESETS_PATH = path.resolve(__dirname, '../public/presets.js');

let cachedConfig = null;

export function getSubledgerConfig() {
  if (cachedConfig) return cachedConfig;
  const code = fs.readFileSync(PRESETS_PATH, 'utf8');
  const sandbox = { window: {}, Date, Math, Number, String };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  cachedConfig = sandbox.window.SUBLEDGER_CONFIG;
  return cachedConfig;
}

export function getDefaultRatesMap() {
  const cfg = getSubledgerConfig();
  const map = {};
  Object.keys(cfg.DEFAULT_RATES).forEach(k => {
    map[k] = cfg.DEFAULT_RATES[k].rate;
  });
  return map;
}

export function getToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function parseLocalDate(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

export function formatDateISO(date) {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function daysBetween(d1, d2) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const utc1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const utc2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
  return Math.round((utc2 - utc1) / msPerDay);
}

export function addCycles(anchorDate, cycle, count) {
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

export function getEffectiveNextDate(sub, today = getToday()) {
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

export function computeSubMetrics(sub, rates = {}, today = getToday()) {
  const cfg = getSubledgerConfig();
  const split = Math.max(1, parseInt(sub.splitCount, 10) || 1);
  const totalOrig = Math.max(0, Number(sub.price) || 0);
  const regRaw = sub.regularPrice !== null && sub.regularPrice !== undefined && sub.regularPrice !== ''
    ? Number(sub.regularPrice)
    : 0;
  const hasRegularPrice = regRaw > 0 && Math.abs(regRaw - totalOrig) > 0.001;
  const renewTotalOrig = hasRegularPrice ? regRaw : totalOrig;

  const personalOrig = totalOrig / split;
  const renewPersonalOrig = renewTotalOrig / split;
  const rate = Number(rates[sub.currency]) || (cfg.DEFAULT_RATES[sub.currency]?.rate) || 1;

  const firstCnyPerCycle = personalOrig * rate;
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

  let activeAddonMonthlyCny = 0;
  let activeAddonYearlyCny = 0;
  let activeAddonCount = 0;
  let addonTotalHistoryCny = 0;
  const addonsList = Array.isArray(sub.addons) ? sub.addons : [];

  addonsList.forEach(ad => {
    const aPrice = Math.max(0, Number(ad.price) || 0);
    if (aPrice <= 0) return;
    const aRate = Number(rates[ad.currency]) || (cfg.DEFAULT_RATES[ad.currency]?.rate) || 1;
    const aCny = aPrice * aRate;
    const aMonths = Math.max(1, parseInt(ad.amortizeMonths, 10) || 1);
    const asd = parseLocalDate(ad.date) || today;
    const aed = addCycles(asd, 'monthly', aMonths);

    if (asd <= today) addonTotalHistoryCny += aCny;
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

  return {
    split,
    totalOrig,
    renewTotalOrig,
    hasRegularPrice,
    rate,
    firstCnyPerCycle,
    renewCnyPerCycle,
    cnyPerCycle: ongoingCnyPerCycle,
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
    daysLeft
  };
}

export function getMonthEvents(subscriptions = [], rates = {}, year, monthIndex, today = getToday()) {
  const cfg = getSubledgerConfig();
  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd = new Date(year, monthIndex + 1, 0);
  const events = [];

  subscriptions.forEach(sub => {
    if (sub.status === 'paused') return;
    const metrics = computeSubMetrics(sub, rates, today);

    if (Array.isArray(sub.addons)) {
      sub.addons.forEach(ad => {
        const asd = parseLocalDate(ad.date);
        const aPrice = Math.max(0, Number(ad.price) || 0);
        if (!asd || aPrice <= 0) return;
        if (asd >= monthStart && asd <= monthEnd) {
          const aRate = Number(rates[ad.currency]) || (cfg.DEFAULT_RATES[ad.currency]?.rate) || 1;
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

    if (sub.cycle === 'lifetime' || sub.cycle === 'oneoff') {
      const sd = parseLocalDate(sub.startDate);
      if (sd && sd >= monthStart && sd <= monthEnd) {
        const ds = formatDateISO(sd);
        events.push({
          eventKey: `${sub.id}::${sub.cycle}::${ds}`,
          date: sd,
          dateStr: ds,
          sub,
          label: `${sub.name} (${sub.cycle === 'lifetime' ? '买断' : '单次消费'})`,
          payment: sub.payment || '',
          currency: sub.currency || 'CNY',
          amountCny: metrics.firstCnyPerCycle,
          type: sub.cycle,
          isPaid: sd <= today
        });
      }
      return;
    }

    const effNext = metrics.effNext;
    if (!effNext) return;
    const startD = parseLocalDate(sub.startDate);

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

    let k = 0;
    while (k < 600) {
      const d = addCycles(effNext, sub.cycle, k);
      if (!d || d > monthEnd) break;
      if (d >= monthStart && (!startD || d >= startD) && sub.autoRenew) {
        const ds = formatDateISO(d);
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
      }
      k++;
    }
  });

  events.sort((a, b) => a.date - b.date);
  return events;
}
