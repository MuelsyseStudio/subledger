#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  PROJECT_ROOT,
  getStorePaths,
  loadAppConfig,
  saveAppConfig,
  loadLocalData,
  saveLocalData,
  readPidInfo,
  clearPidInfo
} from '../src/store.mjs';
import {
  getSubledgerConfig,
  getDefaultRatesMap,
  getToday,
  parseLocalDate,
  formatDateISO,
  addCycles,
  computeSubMetrics,
  getMonthEvents
} from '../src/metrics.mjs';
import { startServer } from '../src/server.mjs';
import liveRatesFn from '../netlify/functions/live-rates.mjs';

const PKG = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));

// ---------- ANSI Colors & CJK Width Alignment ----------
const isTTY = Boolean(process.stdout.isTTY);
const c = {
  bold: s => (isTTY ? `\x1b[1m${s}\x1b[22m` : String(s)),
  dim: s => (isTTY ? `\x1b[2m${s}\x1b[22m` : String(s)),
  green: s => (isTTY ? `\x1b[32m${s}\x1b[39m` : String(s)),
  cyan: s => (isTTY ? `\x1b[36m${s}\x1b[39m` : String(s)),
  yellow: s => (isTTY ? `\x1b[33m${s}\x1b[39m` : String(s)),
  red: s => (isTTY ? `\x1b[31m${s}\x1b[39m` : String(s)),
  magenta: s => (isTTY ? `\x1b[35m${s}\x1b[39m` : String(s)),
  blue: s => (isTTY ? `\x1b[34m${s}\x1b[39m` : String(s))
};

function stripAnsi(str) {
  return String(str).replace(/\x1b\[[0-9;]*m/g, '');
}

function displayWidth(str) {
  const clean = stripAnsi(str);
  let w = 0;
  for (const ch of clean) {
    const code = ch.codePointAt(0);
    if (
      code >= 0x1100 && (
        code <= 0x115f ||
        code === 0x2329 || code === 0x232a ||
        (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe10 && code <= 0xfe19) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6)
      )
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function padEndDisplay(str, targetWidth) {
  const s = String(str);
  const diff = targetWidth - displayWidth(s);
  return diff > 0 ? s + ' '.repeat(diff) : s;
}

function padStartDisplay(str, targetWidth) {
  const s = String(str);
  const diff = targetWidth - displayWidth(s);
  return diff > 0 ? ' '.repeat(diff) + s : s;
}

function truncateDisplay(str, maxWidth) {
  const clean = String(str || '');
  if (displayWidth(clean) <= maxWidth) return clean;
  let out = '';
  let w = 0;
  for (const ch of clean) {
    const cw = displayWidth(ch);
    if (w + cw + 1 > maxWidth) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

function fmtMoney(n, decimals = 2) {
  return (Number(n) || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function parseFlags(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const short = arg[1];
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[short] = next;
        i++;
      } else {
        flags[short] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function openInBrowser(url) {
  const platform = process.platform;
  let cmd;
  let args;
  if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

async function checkServerHealth(host, port) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 900);
    const res = await fetch(`http://${host}:${port}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.ok && data?.app === 'SubLedger' ? data : null;
  } catch {
    return null;
  }
}

async function isPortBusyByOtherApp(host, port) {
  const net = await import('node:net');
  return new Promise(resolve => {
    const tester = net.default.createServer();
    tester.once('error', () => resolve(true));
    tester.once('listening', () => {
      tester.close(() => resolve(false));
    });
    tester.listen(port, host);
  });
}

async function resolveAvailablePort(host, preferredPort) {
  for (let offset = 0; offset < 15; offset++) {
    const p = preferredPort + offset;
    const subHealth = await checkServerHealth(host, p);
    if (subHealth) return { port: p, existingHealth: subHealth };
    const busy = await isPortBusyByOtherApp(host, p);
    if (!busy) return { port: p, existingHealth: null };
  }
  return { port: preferredPort, existingHealth: null };
}

async function ensureDaemonRunning(host, preferredPort) {
  const pidInfo = readPidInfo();
  if (pidInfo?.port) {
    const pidHealth = await checkServerHealth(pidInfo.host || host, pidInfo.port);
    if (pidHealth) {
      return {
        alreadyRunning: true,
        url: `http://${pidHealth.host}:${pidHealth.port}`,
        health: pidHealth
      };
    }
  }

  const { port, existingHealth } = await resolveAvailablePort(host, preferredPort);
  if (existingHealth) {
    return { alreadyRunning: true, url: `http://${host}:${port}`, health: existingHealth };
  }

  const { logFile } = getStorePaths();
  const outFd = fs.openSync(logFile, 'a');
  const serverScript = path.join(PROJECT_ROOT, 'src/server.mjs');
  const child = spawn(process.execPath, [serverScript, '--host', host, '--port', String(port)], {
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: { ...process.env }
  });
  child.unref();

  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 140));
    const health = await checkServerHealth(host, port);
    if (health) {
      fs.closeSync(outFd);
      return { alreadyRunning: false, url: `http://${host}:${port}`, health };
    }
  }
  fs.closeSync(outFd);
  throw new Error(`本地服务启动超时，请查看日志：${logFile}`);
}

// ---------- CLI Commands ----------

function printCompactBanner(state) {
  const today = getToday();
  const rates = state.settings?.rates || getDefaultRatesMap();
  let monthlyTotal = 0;
  let yearlyTotal = 0;
  let activeCount = 0;

  state.subscriptions.forEach(sub => {
    if (sub.status === 'active') {
      const m = computeSubMetrics(sub, rates, today);
      monthlyTotal += m.monthlyCny;
      yearlyTotal += m.yearlyCny;
      if (sub.cycle !== 'lifetime' && (sub.cycle !== 'oneoff' || m.oneoffActive)) {
        activeCount++;
      }
    }
  });

  console.log(
    `${c.bold(c.green('● SubLedger'))} ${c.dim(`v${PKG.version}`)}  ` +
    `生效项目 ${c.bold(activeCount)} 项 · 月均 ${c.bold(c.cyan(`¥${fmtMoney(monthlyTotal)}`))} · 年化 ${c.bold(`¥${fmtMoney(yearlyTotal, 0)}`)}`
  );
}

async function cmdOpen(flags) {
  const cfg = loadAppConfig();
  const host = flags.host || cfg.host || '127.0.0.1';
  const port = Number(flags.port || flags.p || cfg.port) || 4780;

  const { alreadyRunning, url, health } = await ensureDaemonRunning(host, port);
  const state = loadLocalData();

  printCompactBanner(state);
  console.log(
    `  ${alreadyRunning ? c.cyan('↻ 本地服务已在后台运行') : c.green('✓ 已在后台启动本地服务')}` +
    `  ${c.bold(url)} ${c.dim(`(PID: ${health.pid})`)}`
  );
  console.log(`  ${c.dim(`数据文件：${health.dataFile}`)}`);

  if (flags['no-open'] !== true && flags.open !== false) {
    openInBrowser(url);
    console.log(`  ${c.green('↗ 已在默认浏览器中打开 SubLedger 面板')} ${c.dim('(停止后台服务可执行: subledger stop)')}`);
  }
}

async function cmdServe(flags) {
  const cfg = loadAppConfig();
  const host = flags.host || cfg.host || '127.0.0.1';
  const preferredPort = Number(flags.port || flags.p || cfg.port) || 4780;

  const { port, existingHealth } = await resolveAvailablePort(host, preferredPort);
  if (existingHealth) {
    console.log(`${c.yellow('!')} 端口 ${port} 已有 SubLedger 服务运行中 (PID: ${existingHealth.pid}) -> http://${host}:${port}`);
    if (flags.open) openInBrowser(`http://${host}:${port}`);
    return;
  }

  const { url } = await startServer({ host, port, writePid: true });
  const { dataFile } = getStorePaths();
  printCompactBanner(loadLocalData());
  console.log(`  ${c.green('✓ 前台服务监听中：')}${c.bold(url)}`);
  console.log(`  ${c.dim(`本地落盘路径：${dataFile}`)}`);
  console.log(`  ${c.dim('按 Ctrl+C 停止服务')}`);

  if (flags.open) {
    openInBrowser(url);
  }
}

async function cmdStop() {
  const cfg = loadAppConfig();
  const pidInfo = readPidInfo();
  const host = pidInfo?.host || cfg.host || '127.0.0.1';
  const port = pidInfo?.port || cfg.port || 4780;

  const health = await checkServerHealth(host, port);
  const targetPid = health?.pid || pidInfo?.pid;

  if (!targetPid) {
    clearPidInfo();
    console.log(c.dim('当前没有正在后台运行的 SubLedger 本地服务。'));
    return;
  }

  try {
    process.kill(targetPid);
    clearPidInfo();
    console.log(`${c.green('✓')} 已停止 SubLedger 后台服务 (PID: ${targetPid})`);
  } catch (err) {
    clearPidInfo();
    console.log(`${c.yellow('!')} 进程 ${targetPid} 已退出 (${err.code || err.message})`);
  }
}

async function cmdStats() {
  const cfg = loadAppConfig();
  const subCfg = getSubledgerConfig();
  const { dataFile } = getStorePaths();
  const state = loadLocalData();
  const today = getToday();
  const rates = state.settings?.rates || getDefaultRatesMap();
  const pidInfo = readPidInfo();
  const health = await checkServerHealth(pidInfo?.host || cfg.host || '127.0.0.1', pidInfo?.port || cfg.port || 4780);

  let monthlyTotal = 0;
  let yearlyTotal = 0;
  let activeCount = 0;
  let lifetimeCount = 0;
  let lifetimeSum = 0;
  const upcoming = [];
  const alertDays = state.settings?.alertDays || 14;

  state.subscriptions.forEach(sub => {
    const m = computeSubMetrics(sub, rates, today);
    if (sub.cycle === 'lifetime' && sub.status !== 'paused') {
      lifetimeCount++;
      lifetimeSum += m.firstCnyPerCycle;
      monthlyTotal += m.activeAddonMonthlyCny;
      yearlyTotal += m.activeAddonYearlyCny;
      return;
    }
    if (sub.status === 'active') {
      monthlyTotal += m.monthlyCny;
      yearlyTotal += m.yearlyCny;
      if (sub.cycle !== 'oneoff' || m.oneoffActive) activeCount++;
    }
    if ((sub.status === 'active' || sub.status === 'trial') && sub.cycle !== 'oneoff' && m.daysLeft !== null && m.daysLeft >= 0 && m.daysLeft <= alertDays && sub.autoRenew) {
      upcoming.push({ sub, m });
    }
  });

  upcoming.sort((a, b) => a.m.daysLeft - b.m.daysLeft);

  const curEvents = getMonthEvents(state.subscriptions, rates, today.getFullYear(), today.getMonth(), today).filter(e => e.amountCny > 0);
  const paidSum = curEvents.filter(e => e.isPaid).reduce((s, e) => s + e.amountCny, 0);
  const remSum = curEvents.filter(e => !e.isPaid).reduce((s, e) => s + e.amountCny, 0);

  const budget = Number(state.settings?.monthlyBudget) || 0;
  const budgetPct = budget > 0 ? ((monthlyTotal / budget) * 100).toFixed(1) : null;

  console.log(`\n${c.bold('📊 SubLedger · 订阅与开销总览')}  ${c.dim(`(${formatDateISO(today)})`)}`);
  console.log(c.dim('─'.repeat(64)));
  console.log(`  服务状态  : ${health ? c.green(`运行中 (http://${health.host}:${health.port}, PID ${health.pid})`) : c.dim('未在后台启动 (运行 subledger 一键开启)')}`);
  console.log(`  AI 识图键 : ${(cfg.geminiApiKey || process.env.GEMINI_API_KEY) ? c.green('已配置 GEMINI_API_KEY') : c.yellow('未配置 (运行 subledger config --gemini-key <KEY>)')}`);
  console.log(`  数据路径  : ${c.dim(dataFile)}`);
  console.log(c.dim('─'.repeat(64)));
  console.log(`  月均总开销: ${c.bold(c.cyan(`¥${fmtMoney(monthlyTotal)} / 月`))}  ${budgetPct ? c.dim(`(月预算 ¥${fmtMoney(budget, 0)} 的 ${budgetPct}%)`) : ''}`);
  console.log(`  年化总支出: ${c.bold(`¥${fmtMoney(yearlyTotal)} / 年`)}  ${c.dim(`(日均 ¥${fmtMoney(yearlyTotal / 365)} · 生效 ${activeCount} 项)`)}`);
  console.log(`  ${today.getMonth() + 1}月实付账单: 合计 ${c.bold(`¥${fmtMoney(paidSum + remSum)}`)}  ${c.dim(`(已扣款 ¥${fmtMoney(paidSum)} / 待扣款 ¥${fmtMoney(remSum)})`)}`);
  if (lifetimeCount > 0) {
    console.log(`  买断制资产: ${lifetimeCount} 项 (累计 ¥${fmtMoney(lifetimeSum, 0)})`);
  }

  console.log(`\n${c.bold(`⏰ 近 ${alertDays} 天续费预警 (${upcoming.length} 笔)`)}`);
  if (upcoming.length === 0) {
    console.log(`  ${c.green('✓')} 未来 ${alertDays} 天内无自动扣款账单`);
  } else {
    upcoming.forEach(({ sub, m }) => {
      const sym = subCfg.DEFAULT_RATES[sub.currency]?.symbol || `${sub.currency} `;
      const dayTxt = m.daysLeft === 0 ? c.red('今天扣款') : m.daysLeft <= 3 ? c.red(`${m.daysLeft}天后`) : c.yellow(`${m.daysLeft}天后`);
      console.log(`  • ${padEndDisplay(sub.name, 22)} ${padEndDisplay(dayTxt, 10)} ${formatDateISO(m.effNext)}  ${c.bold(`¥${fmtMoney(m.renewCnyPerCycle)}`)} ${c.dim(`(${sym}${m.renewTotalOrig})`)}`);
    });
  }
  console.log('');
}

function cmdList(flags) {
  const subCfg = getSubledgerConfig();
  const state = loadLocalData();
  const today = getToday();
  const rates = state.settings?.rates || getDefaultRatesMap();

  let items = state.subscriptions.map(sub => ({
    sub,
    m: computeSubMetrics(sub, rates, today)
  }));

  if (flags.category || flags.c) {
    const cat = String(flags.category || flags.c).toLowerCase();
    items = items.filter(x => x.sub.category === cat);
  }
  if (!flags.all && !flags.a) {
    items = items.filter(x => x.sub.status !== 'paused');
  }

  if (flags.json) {
    console.log(JSON.stringify(items.map(x => ({ ...x.sub, monthlyCny: Number(x.m.monthlyCny.toFixed(2)) })), null, 2));
    return;
  }

  items.sort((a, b) => b.m.monthlyCny - a.m.monthlyCny);

  console.log('');
  printCompactBanner(state);
  console.log(c.dim('─'.repeat(88)));
  console.log(
    c.bold(
      `${padEndDisplay('软件 / 订阅名称', 24)} ${padEndDisplay('分类', 12)} ${padEndDisplay('原账单规格', 18)} ${padStartDisplay('折合月均', 11)}  ${padEndDisplay('下次账单 / 状态', 18)}`
    )
  );
  console.log(c.dim('─'.repeat(88)));

  if (items.length === 0) {
    console.log(c.dim('  暂无匹配的订阅记录。可通过 subledger add 添加或运行 subledger 在网页中管理。'));
  } else {
    items.forEach(({ sub, m }) => {
      const catName = (subCfg.CATEGORIES.find(x => x.id === sub.category)?.name || '其他').replace(/与.+$/, '');
      const cycShort = subCfg.CYCLES.find(x => x.id === sub.cycle)?.short || sub.cycle;
      const sym = subCfg.DEFAULT_RATES[sub.currency]?.symbol || `${sub.currency} `;
      const spec = sub.cycle === 'oneoff'
        ? `${sym}${m.totalOrig}/摊${m.amortMonths}月`
        : `${sym}${m.renewTotalOrig}/${cycShort}`;
      const monthlyStr = sub.cycle === 'lifetime' && m.monthlyCny <= 0 ? '买断' : `¥${fmtMoney(m.monthlyCny)}`;

      let statusStr = '';
      if (sub.status === 'paused') statusStr = c.dim('已停用');
      else if (sub.cycle === 'lifetime') statusStr = c.green('永久买断');
      else if (sub.cycle === 'oneoff') statusStr = m.oneoffActive ? c.magenta(`均摊剩${m.daysLeft}天`) : c.dim('均摊完毕');
      else if (!m.effNext) statusStr = c.yellow('待补日期');
      else if (!sub.autoRenew) statusStr = c.dim(`${formatDateISO(m.effNext)}止`);
      else if (m.daysLeft <= 3) statusStr = c.red(`${m.daysLeft}天后扣款`);
      else statusStr = `${formatDateISO(m.effNext)} (${m.daysLeft}天)`;

      const nameText = truncateDisplay(sub.name, 23);
      console.log(
        `${padEndDisplay(nameText, 24)} ${padEndDisplay(catName, 12)} ${padEndDisplay(truncateDisplay(spec, 17), 18)} ${c.cyan(padStartDisplay(monthlyStr, 11))}  ${statusStr}`
      );
    });
  }
  console.log(c.dim('─'.repeat(88)) + '\n');
}

function cmdAdd(positional, flags) {
  const subCfg = getSubledgerConfig();
  const rawName = positional.join(' ').trim() || String(flags.name || '').trim();
  if (!rawName) {
    console.error(`${c.red('✗')} 请提供订阅名称，例如：subledger add "Claude Pro" --price 20 --currency USD`);
    process.exit(1);
  }

  const preset = subCfg.PRESETS.find(
    p => p.name.toLowerCase() === rawName.toLowerCase() || p.name.toLowerCase().includes(rawName.toLowerCase())
  );

  const today = getToday();
  const cycle = flags.oneoff ? 'oneoff' : String(flags.cycle || preset?.cycle || 'monthly');
  const priceVal = flags.price !== undefined ? parseFloat(flags.price) : (preset?.price ?? 0);
  const regVal = flags['regular-price'] !== undefined ? parseFloat(flags['regular-price']) : null;
  const currency = String(flags.currency || preset?.currency || 'CNY').toUpperCase();
  const category = String(flags.category || preset?.category || 'other');
  const startDate = String(flags.start || formatDateISO(today));
  const autoRenew = (cycle === 'lifetime' || cycle === 'oneoff') ? false : (flags['no-renew'] ? false : true);

  let nextBillDate = '';
  if (cycle !== 'lifetime' && cycle !== 'oneoff') {
    if (flags.next) {
      nextBillDate = String(flags.next);
    } else {
      const sd = parseLocalDate(startDate) || today;
      const nd = addCycles(sd, cycle, 1);
      nextBillDate = nd ? formatDateISO(nd) : '';
    }
  }

  const state = loadLocalData();
  const newSub = {
    id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: rawName,
    category,
    brandKey: preset?.brandKey || 'auto',
    customLogo: '',
    icon: preset?.icon || rawName.slice(0, 2).toUpperCase(),
    color: preset?.color || '#2563EB',
    price: Math.max(0, Number(priceVal) || 0),
    regularPrice: regVal && regVal > 0 ? regVal : null,
    currency,
    cycle,
    amortizeMonths: Math.max(1, parseInt(flags.amortize || 1, 10) || 1),
    splitCount: Math.max(1, parseInt(flags.split || 1, 10) || 1),
    status: String(flags.status || 'active'),
    autoRenew,
    nextBillDate,
    startDate,
    payment: String(flags.payment || preset?.payment || ''),
    account: String(flags.account || ''),
    url: String(flags.url || preset?.url || ''),
    note: String(flags.note || ''),
    addons: []
  };

  if (state.isDemo) {
    state.subscriptions = [];
    state.isDemo = false;
  }
  state.subscriptions.unshift(newSub);
  saveLocalData(state);

  const m = computeSubMetrics(newSub, state.settings.rates, today);
  console.log(`${c.green('✓')} 已添加「${c.bold(newSub.name)}」(${newSub.currency} ${newSub.price} / ${cycle}) -> 折合月均 ${c.cyan(`¥${fmtMoney(m.monthlyCny)}`)}`);
}

function cmdTopup(positional, flags) {
  const targetQuery = String(positional[0] || '').trim();
  const amount = parseFloat(positional[1] ?? flags.price);
  if (!targetQuery || !(amount > 0)) {
    console.error(`${c.red('✗')} 用法：subledger topup <游戏或软件名关键词> <金额> [--title "礼包名"] [--months 1]`);
    process.exit(1);
  }

  const state = loadLocalData();
  const sub = state.subscriptions.find(s => s.name.toLowerCase().includes(targetQuery.toLowerCase()));
  if (!sub) {
    console.error(`${c.red('✗')} 未找到名称包含「${targetQuery}」的订阅卡片，请先用 subledger ls 查看。`);
    process.exit(1);
  }

  const months = Math.max(1, parseInt(flags.months || flags.amortize || 1, 10) || 1);
  const title = String(flags.title || '单次氪金/加购');
  const currency = String(flags.currency || sub.currency || 'CNY').toUpperCase();
  if (!Array.isArray(sub.addons)) sub.addons = [];

  sub.addons.push({
    id: `ad-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    title,
    date: String(flags.date || formatDateISO(getToday())),
    price: amount,
    currency,
    amortizeMonths: months,
    payment: String(flags.payment || sub.payment || '')
  });

  saveLocalData(state);
  console.log(`${c.green('✓')} 已为「${c.bold(sub.name)}」挂载单次消费：${title} (${currency} ${amount}，均摊 ${months} 个月)`);
}

async function cmdRates() {
  console.log(c.dim('正在拉取国际外汇实时中间价…'));
  const res = await liveRatesFn(new Request('http://localhost/api/rates'));
  const data = await res.json();
  if (!res.ok || !data.ok || !data.rates) {
    console.error(`${c.red('✗')} 汇率更新失败：${data.error || res.status}`);
    process.exit(1);
  }

  const state = loadLocalData();
  state.settings.rates = { ...state.settings.rates, ...data.rates };
  state.settings.ratesLastSynced = Date.now();
  state.settings.ratesUpdatedUtc = data.updatedAtUtc || '';
  saveLocalData(state);

  console.log(`${c.green('✓')} 实时汇率已更新并写入本地账本：`);
  const codes = ['USD', 'PHP', 'HKD', 'JPY', 'EUR', 'GBP', 'SGD', 'TWD', 'TRY'];
  console.log('  ' + codes.map(k => `1 ${k} = ${c.cyan(`¥${data.rates[k]}`)}`).join('  ·  '));
}

function cmdExport(positional, flags) {
  const state = loadLocalData();
  const dateTag = formatDateISO(getToday());
  const subCfg = getSubledgerConfig();

  if (flags.csv) {
    const outPath = path.resolve(positional[0] || `SubLedger_订阅明细_${dateTag}.csv`);
    const headers = ['软件名称', '分类', '状态', '计费周期', '当前原价', '续费原价', '币种', '折合月均(CNY)', '折合年化(CNY)', '下次账单日', '扣款渠道', '区服/账号', '备注'];
    const esc = v => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = state.subscriptions.map(sub => {
      const m = computeSubMetrics(sub, state.settings.rates, getToday());
      const cat = subCfg.CATEGORIES.find(x => x.id === sub.category)?.name || sub.category;
      const cyc = subCfg.CYCLES.find(x => x.id === sub.cycle)?.label || sub.cycle;
      return [
        sub.name, cat, sub.status, cyc, sub.price, sub.regularPrice || '', sub.currency,
        m.monthlyCny.toFixed(2), m.yearlyCny.toFixed(2),
        m.effNext ? formatDateISO(m.effNext) : (sub.nextBillDate || ''),
        sub.payment || '', sub.account || '', sub.note || ''
      ].map(esc).join(',');
    });
    fs.writeFileSync(outPath, '\uFEFF' + [headers.join(','), ...rows].join('\r\n'), 'utf8');
    console.log(`${c.green('✓')} 已导出 CSV 表格：${outPath}`);
    return;
  }

  const outPath = path.resolve(positional[0] || `SubLedger_备份_${dateTag}.json`);
  const payload = {
    app: 'SubLedger',
    exportedAt: new Date().toISOString(),
    subscriptions: state.subscriptions,
    monthlyBills: state.monthlyBills,
    dedupOverrides: state.dedupOverrides,
    settings: state.settings,
    aiReviews: state.aiReviews
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`${c.green('✓')} 已导出完整 JSON 备份：${outPath}`);
}

function cmdImport(positional) {
  const file = positional[0];
  if (!file || !fs.existsSync(file)) {
    console.error(`${c.red('✗')} 请提供有效的 JSON 备份文件路径，例如：subledger import backup.json`);
    process.exit(1);
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const subs = Array.isArray(parsed) ? parsed : parsed.subscriptions;
  if (!Array.isArray(subs)) {
    console.error(`${c.red('✗')} 备份文件格式无效：未找到 subscriptions 数组`);
    process.exit(1);
  }

  const current = loadLocalData();
  const next = {
    ...current,
    subscriptions: subs,
    monthlyBills: Array.isArray(parsed.monthlyBills) ? parsed.monthlyBills : current.monthlyBills,
    dedupOverrides: parsed.dedupOverrides || current.dedupOverrides,
    settings: parsed.settings ? { ...current.settings, ...parsed.settings } : current.settings,
    aiReviews: parsed.aiReviews || current.aiReviews,
    isDemo: false,
    demoBannerDismissed: true
  };
  saveLocalData(next);
  console.log(`${c.green('✓')} 成功导入 ${c.bold(subs.length)} 条订阅记录到本地账本！`);
}

function cmdConfig(flags) {
  const updates = {};
  if (flags['gemini-key'] !== undefined) {
    updates.geminiApiKey = String(flags['gemini-key']).trim();
  }
  if (flags['gemini-base-url'] !== undefined) {
    updates.geminiBaseUrl = String(flags['gemini-base-url']).trim();
  }
  if (flags.port !== undefined) {
    updates.port = Number(flags.port) || 4780;
  }
  if (flags.host !== undefined) {
    updates.host = String(flags.host).trim();
  }

  const { configFile, dataFile } = getStorePaths();
  const next = Object.keys(updates).length > 0 ? saveAppConfig(updates) : loadAppConfig();
  const maskedKey = next.geminiApiKey
    ? `${next.geminiApiKey.slice(0, 6)}...${next.geminiApiKey.slice(-4)}`
    : '(未设置)';

  console.log(`\n${c.bold('⚙ SubLedger 本地配置')}`);
  console.log(`  配置文件 : ${c.dim(configFile)}`);
  console.log(`  账本文件 : ${c.dim(dataFile)}`);
  console.log(`  默认监听 : http://${next.host}:${next.port}`);
  console.log(`  Gemini 键: ${next.geminiApiKey ? c.green(maskedKey) : c.yellow(maskedKey)}`);
  if (Object.keys(updates).length > 0) {
    console.log(`\n${c.green('✓')} 配置已保存（如后台服务运行中，新请求将立即生效）。\n`);
  } else {
    console.log('');
  }
}

function printHelp() {
  console.log(`
${c.bold(c.green('SubLedger'))} v${PKG.version} — 个人软件订阅、游戏氪金均摊与月度日常总账管家

${c.bold('一键启动：')}
  ${c.cyan('subledger')}                        后台启动本地服务并自动在浏览器打开面板 (默认端口 4780)
  ${c.cyan('subledger serve')} [--port 4780]    在前台启动本地 Web 与 API 服务
  ${c.cyan('subledger stop')}                   停止后台运行的本地服务进程

${c.bold('终端极速查账与记账：')}
  ${c.cyan('subledger stats')}                  终端查看月均/年化开销、本月现金流与近期续费预警
  ${c.cyan('subledger ls')} [--all] [--json]    终端表格列出当前生效订阅、跨币种月均折算与状态
  ${c.cyan('subledger add')} <名称> [选项]      命令行快速新增订阅 (支持自动匹配常见软件预设)
      示例: subledger add "Claude Pro" --price 20 --currency USD --cycle monthly
  ${c.cyan('subledger topup')} <名称> <金额>    为已有订阅/游戏挂载一笔按月均摊氪金或加购
      示例: subledger topup 明日方舟 648 --title "周年寻访礼包" --months 1
  ${c.cyan('subledger rates')}                  立即同步国际外汇实时汇率到本地账本

${c.bold('备份与本地配置：')}
  ${c.cyan('subledger export')} [--csv] [路径]  导出完整 JSON 备份或 Excel 兼容 CSV 表格
  ${c.cyan('subledger import')} <备份.json>     从备份文件导入订阅与日常月账单记录
  ${c.cyan('subledger config')} [选项]          查看或设置本地配置 (--gemini-key <KEY> --port <PORT>)
`);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const { positional, flags } = parseFlags(rawArgs);

  if (flags.help || flags.h) return printHelp();
  if (flags.version || flags.v) {
    console.log(PKG.version);
    return;
  }

  const cmd = (positional[0] || 'open').toLowerCase();
  const restPos = positional.slice(1);

  switch (cmd) {
    case 'open':
    case 'up':
    case 'start':
      return await cmdOpen(flags);
    case 'serve':
      return await cmdServe(flags);
    case 'stop':
    case 'down':
      return await cmdStop();
    case 'stats':
    case 'status':
    case 'summary':
      return await cmdStats();
    case 'ls':
    case 'list':
      return cmdList(flags);
    case 'add':
      return cmdAdd(restPos, flags);
    case 'topup':
    case 'addon':
      return cmdTopup(restPos, flags);
    case 'rates':
      return await cmdRates();
    case 'export':
      return cmdExport(restPos, flags);
    case 'import':
      return cmdImport(restPos);
    case 'config':
      return cmdConfig(flags);
    case 'help':
      return printHelp();
    default:
      console.error(`${c.red('✗')} 未知指令 "${cmd}"。运行 ${c.cyan('subledger --help')} 查看可用命令。`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`${c.red('✗ 执行出错：')}${err?.message || err}`);
  process.exit(1);
});
